/**
 * C2 内置语义引擎宿主(js_semantic_engine_pre_v1)+ 资产下载器(js_semantic_dl_pre_v1)。
 * 2026-08-26 用户裁定:C2 是默认主路径,本模块把 js-semantic-trial 试验模块接入生产。
 *
 * 组成:
 *   1) fuseD6Pre —— 与 Python sidecar 同一契约的 minmax 加权融合(dense 0.7 / lexical 0.3,D6);
 *   2) createJsSemanticEnginePre —— 懒加载 e5-small q8(peer 多候选路径解析)、miv 键索引缓存
 *      (trial 版每次全库重嵌,此处修复)、cosine 排名;任何失败 → degraded + null,调用方回退词法;
 *   3) createSemanticDownloaderPre —— 五文件资产清单(SHA256 冻结)双源下载
 *      (cn=hf-mirror 国内 / intl=huggingface 国际;auto=国内优先),流式进度 + 哈希校验 + 原子落位;
 *
 * 边界(与 M7-CLOSED-LOOP-WIRING.md 一致):本模块只做检索排序,绝不做激活决策;
 * 「要不要打断」仍属两车道策略(Python sidecar 在场时)。全部函数对非法输入 fail closed。
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { resolveDshHomePre } from './dsh-home.js'
import { createJsSemanticProcessPre } from './semantic-js-process.js'

export const JS_SEMANTIC_ENGINE_VERSION = 'js_semantic_engine_pre_v1'
export const JS_SEMANTIC_DL_VERSION = 'js_semantic_dl_pre_v1'
/** D6 冻结融合权重(与 worker DEFAULT_SEARCH_POLICY 一致)。 */
export const D6_FUSION_WEIGHTS_PRE_V1 = Object.freeze({ dense: 0.7, lexical: 0.3 })

// ========== 1) D6 minmax 融合(纯函数) ==========

/**
 * pairs: [{memoryId, dense:number|null, lex:number|null}]
 * 两臂各自在非空值域上 minmax 归一(单值/零极差 → 该臂非空值记 0.5);缺失记 0。
 * 返回 [{memoryId, fused, denseN, lexN}] 按 fused 降序、平局 memoryId 升序(确定性)。
 */
export function fuseD6Pre(pairs) {
  const list = Array.isArray(pairs) ? pairs.filter((p) => p && typeof p.memoryId === 'string') : []
  const normArm = (key) => {
    const vals = list.map((p) => (typeof p[key] === 'number' && Number.isFinite(p[key]) ? p[key] : null)).filter((v) => v !== null)
    if (!vals.length) return { lo: 0, hi: -1 } // 空臂:全部归 0(下方 missing 分支覆盖)
    const lo = Math.min(...vals)
    const hi = Math.max(...vals)
    return hi > lo ? { lo, hi } : { lo, hi: lo, flat: true }
  }
  const dn = normArm('dense')
  const ln = normArm('lex')
  const normOf = (v, arm) => {
    if (typeof v !== 'number' || !Number.isFinite(v)) return 0
    const a = arm === 'dense' ? dn : ln
    if (a.hi < a.lo) return 0
    if (a.flat) return 0.5
    return (v - a.lo) / (a.hi - a.lo)
  }
  return list
    .map((p) => {
      const denseN = normOf(p.dense, 'dense')
      const lexN = normOf(p.lex, 'lex')
      return {
        memoryId: p.memoryId,
        denseN,
        lexN,
        fused: D6_FUSION_WEIGHTS_PRE_V1.dense * denseN + D6_FUSION_WEIGHTS_PRE_V1.lexical * lexN,
      }
    })
    .sort((x, y) => (y.fused !== x.fused ? y.fused - x.fused : (x.memoryId < y.memoryId ? -1 : 1)))
}

// ========== 2) 引擎宿主 ==========

const E5_MODELS_SUBDIR = 'multilingual-e5-small'

/**
 * ★P3-14（2026-09-22）→ **P10-B 修正（同日晚）**：`artifacts/m7-live-pre/js-semantic-trial` 是**纯维护者机器路径**
 * （`.gitignore` 已排除其 models/ 与 node_modules/，用户机上结构性不存在）。
 * P3-14 原用「环境变量 `DAM_DEV_TREE=1` 显式开启」来排除发布包 —— 但那个开关**把维护者本机也一起排除了**
 * （实测：开发机该目录有 112.8MB 模型 + peer，却因开关默认关而报 `setup-both`）。
 * ⇒ 改为**存在性判定**：目录存在即视为开发树；用户机上该目录结构性不存在 ⇒ 发布包行为不变。
 * `DAM_DEV_TREE=1` 保留为**显式强制开启**（离线调试且目录另置时用）。
 */
const DEV_TREE_ENABLED = process.env.DAM_DEV_TREE === '1'

/**
 * ★P10-B（2026-09-22）+ ★E 批修正（2026-09-30，真机实证）：
 *   `artifacts/m7-live-pre/js-semantic-trial` 是**维护者机器路径**（.gitignore 排除 models/ 与
 *   node_modules/，用户机结构性不存在）。判定从「环境变量显式开启」改为**存在性判定**。
 *   E 批修的是**层级口径**：本函数的 `pluginDir` 参数有两个来源 ——
 *     ① `createJsSemanticEnginePre({ pluginDir })` 传的是 `pluginRootDir()` = <包根>；
 *     ② 另一些调用点传的是 `<包根>/lib`（模块自身所在目录）。
 *   原实现固定用 `path.join(pluginDir, "..", "artifacts", ...)`，即假定入参是 `<包根>/lib`；
 *   于是从 ① 调用时解析成 `<包根的上级>/artifacts/...`（实测得到 `D:\artifacts\...`）⇒
 *   存在性判定恒 false ⇒ **开发机上 C2 语义臂被判「模型缺失」**，而模型（112.8MB e5-small q8）
 *   其实就在 `<包根>/artifacts/m7-live-pre/js-semantic-trial/models/`。
 *   实测证据（2026-09-30，真执行 probeJsSemanticAssets）：
 *     assetPresent=false, assetPath=<dshHome>/models/js-semantic/...onnx, peerPresent=true
 *     embedPassages 抛 "model asset missing under ~/.dsh/models/js-semantic"
 *   ⇒ 改为「逐级上溯探测」：对入参本身、其上一级两种解释都试，命中即用（纯存在性，零耦合调用方）。
 *   发布包行为不变：用户机上两处都不存在 ⇒ 仍返回 null。
 */
function devTreeRoot(pluginDir) {
  const bases = [String(pluginDir || "")]
  try {
    const up = path.resolve(String(pluginDir || ""), "..")
    if (up && !bases.includes(up)) bases.push(up)
  } catch (_) {}
  for (const base of bases) {
    const root = path.join(base, "artifacts", "m7-live-pre", "js-semantic-trial")
    if (DEV_TREE_ENABLED || existsSync(root)) return root
  }
  return null
}

function defaultModelsDirCandidates(pluginDir) {
  // 用户目录优先(#15 后续/B 修复):~/.dsh/models/js-semantic/ 跨插件升级存活——
  // 包目录(lib/models)在 npm 更新时会被整体重装,下载的 130MB 模型曾被冲掉。
  // ★#86-3：统一口径
  const dshHome = resolveDshHomePre()
  return [
    path.join(dshHome, 'models', 'js-semantic'),
    path.join(pluginDir, 'models'),
  ].concat(devTreeRoot(pluginDir) ? [path.join(devTreeRoot(pluginDir), 'models')] : [])
}

function defaultPeerDirCandidates(pluginDir) {
  // pluginDir = <pkg>/lib(2026-09-02 issue 复核修正:此前上溯层级错位 → peerPresent 恒 false)。
  // 静态候选仅作兜底,主路径是 resolvePeerTransformersDir 的真实解析:
  //   1) lib/node_modules —— issue 临时 junction 绕过位(向后兼容)
  //   2) <pkg>/node_modules —— 包内邻接位(lib 上 1 级再进 node_modules)
  //   3) lib 上 3 级直拼 @huggingface —— 标准布局即 <root>/node_modules(pnpm hoisted/npm 提升),
  //      pnpm isolated 下即虚拟存储包内位 .pnpm/<hash>/node_modules
  //   4) 开发树 artifacts（★P3-14：仅 DAM_DEV_TREE=1 时纳入；该路径 .gitignore 排除、用户机恒不存在）
  return [
    path.join(pluginDir, 'node_modules', '@huggingface', 'transformers'),
    path.join(pluginDir, '..', 'node_modules', '@huggingface', 'transformers'),
    path.join(pluginDir, '..', '..', '..', '@huggingface', 'transformers'),
  ].concat(devTreeRoot(pluginDir) ? [path.join(devTreeRoot(pluginDir), 'node_modules', '@huggingface', 'transformers')] : [])
}

/**
 * peer 探测(2026-09-02 issue 修正):真实解析优先 —— createRequire 从 lib/ 起走 Node 标准
 * 解析,天然覆盖 npm/pnpm(hoisted/isolated 虚拟存储)/junction 全部布局,且不执行模块本体
 * (require.resolve 只解析不加载);静态候选仅作 exports 损坏等极端情形的兜底;
 * extraDirs = 深度扫描(semanticDeepDetect)热接入的额外目录,最后兜底检查。
 * 返回命中的包目录,''=未找到。
 */
export function resolvePeerTransformersDir(pluginDir, extraDirs) {
  try {
    const req = createRequire(path.join(pluginDir, 'noop.js'))
    const entry = req.resolve('@huggingface/transformers')
    // entry 是包 main 文件(可能在任意子目录,如 dist/transformers.node.cjs):
    // 从 entry 向上走到 package.json 所在层 = 包目录
    if (entry && existsSync(entry)) {
      let dir = path.dirname(entry)
      while (dir && !existsSync(path.join(dir, 'package.json'))) {
        const up = path.dirname(dir)
        if (up === dir) { dir = ''; break }
        dir = up
      }
      if (dir) return dir
    }
  } catch (_) { /* 静态候选兜底 */ }
  const hit = defaultPeerDirCandidates(pluginDir).find((c) => existsSync(c))
  if (hit) return hit
  for (const d of Array.isArray(extraDirs) ? extraDirs : []) {
    if (typeof d === 'string' && d && existsSync(d)) return d
  }
  return ''
}

/**
 * 深度扫描(0.1.37「打开即自动检测」;issue #14 后续):零依赖手扫常见安装根。
 * 每个 root 探两层:root 自身的 node_modules(直传 profile 根/包根时命中)+ 一级子目录
 * (直传 ~/.dsh/profiles 时枚举各 profile);每个落位再探 node_modules/@huggingface/
 * transformers、pnpm 虚拟存储 .pnpm/node_modules/... 与 .pnpm/@huggingface+transformers@版本
 * /node_modules/...(isolated 模式包体落位)。返回存在的包目录列表(去重,保持扫描序)。
 */
export function deepScanPeerTransformers(roots) {
  const out = []
  const seen = new Set()
  const push = (p) => { if (p && !seen.has(p) && existsSync(p)) { seen.add(p); out.push(p) } }
  const probeDir = (base) => {
    if (!base || typeof base !== 'string') return
    push(path.join(base, 'node_modules', '@huggingface', 'transformers'))
    push(path.join(base, 'node_modules', '.pnpm', 'node_modules', '@huggingface', 'transformers'))
    const pnpmDir = path.join(base, 'node_modules', '.pnpm')
    let entries = []
    try { entries = readdirSync(pnpmDir) } catch (_) { /* base 无 .pnpm 虚拟存储 */ }
    for (const e of entries) {
      if (/^@huggingface\+transformers@/.test(e)) push(path.join(pnpmDir, e, 'node_modules', '@huggingface', 'transformers'))
    }
  }
  for (const root of Array.isArray(roots) ? roots : []) {
    if (!root || typeof root !== 'string') continue
    probeDir(root)
    let children = []
    try { children = readdirSync(root) } catch (_) { /* root 不可枚举 */ }
    for (const c of children.slice(0, 64)) probeDir(path.join(root, c))
  }
  return out
}

/**
 * semanticAssetProbe 共享实现(index.js 的 status API / 档位解析 / 引导卡同源):
 * 模型资产=发行包 lib/models 优先,其次开发树;peer=resolvePeerTransformersDir。
 * extraDirs 透传给 peer 探测(深度扫描热接入位)。返回形状与 v0.1.36 完全一致。
 *
 * ★ issue #70 修复（2026-09-19）：新增 `degraded` 字段。
 *   旧实现是纯 `existsSync` 探测 —— **资产在磁盘上存在 ≠ 引擎可用**：
 *   一旦运行期 `ensureTier()` 失败（onnx 损坏 / 维度不符 / peer 加载失败），引擎置 `degraded`
 *   并此后恒抛；但探针只回 `ready = assetPresent && peerPresent` ⇒
 *   **引导卡显示「✓ 就绪」、档位解析给出 c2，而实际每次检索都在静默走词法兜底**（状态自相矛盾）。
 *   现把降级状态并进 `ready`（并单列 `degraded` 供诊断），使三条用户可见路径（引导卡 / 档位 / status）一致。
 * @param {string} pluginDir
 * @param {string[]} [extraDirs]
 * @param {string} [degradedReason] 当前引擎的降级原因（空串=未降级）
 */
export function probeJsSemanticAssets(pluginDir, extraDirs, degradedReason) {
  // ★#86-3：统一口径
  const dshHome = resolveDshHomePre()
  const modelCands = [
    path.join(dshHome, 'models', 'js-semantic', E5_MODELS_SUBDIR, 'onnx', 'model_quantized.onnx'),
    path.join(pluginDir, 'models', E5_MODELS_SUBDIR, 'onnx', 'model_quantized.onnx'),
  // ★P10-C（2026-09-22，用户裁定）：dev 树闸门从「环境变量显式开启」统一为**存在性判定**。
  //   P10-B 只改了本文件另外两处（defaultModelsDirCandidates / defaultPeerDirCandidates），
  //   **探针这处漏改** ⇒ 开发机上 peer 已可解析（面板不再报 setup-both），但资产恒判 missing
  //   ⇒ 面板显示「JS 引擎模型 ✗ 未就绪」（用户报障）。三处口径现已一致。
  //   保护意图不变：用户机上 `artifacts/m7-live-pre/` 结构性不存在 ⇒ 发布包行为零变化。
  ].concat(devTreeRoot(pluginDir) ? [path.join(devTreeRoot(pluginDir), 'models', E5_MODELS_SUBDIR, 'onnx', 'model_quantized.onnx')] : [])
  const modelOnnx = modelCands.find((c) => existsSync(c)) || modelCands[0]
  const assetPresent = existsSync(modelOnnx)
  const peerDir = resolvePeerTransformersDir(pluginDir, extraDirs)
  const filesReady = Boolean(assetPresent && peerDir)
  const degraded = String(degradedReason || '')
  return {
    assetPresent,
    peerPresent: Boolean(peerDir),
    // ★ 资产齐备**且未降级**才算就绪（否则 UI 报"就绪"而实际降级）
    ready: filesReady && !degraded,
    filesReady,
    degraded,
    assetBytes: assetPresent ? statSync(modelOnnx).size : 0,
    assetPath: modelOnnx,
  }
}

/**
 * opts: { pluginDir, modelsDirCandidates?, peerDirCandidates?, injectEmbedder? }
 * injectEmbedder: 测试注入 {embedQuery(text)→Float32Array, embedPassages(texts)→Float32Array[]};
 * 注入时跳过真实模型加载(冒烟测试离线跑全逻辑)。
 */
export function createJsSemanticEnginePre(opts = {}) {
  const pluginDir = opts.pluginDir
  const modelDirCands = opts.modelsDirCandidates || defaultModelsDirCandidates(pluginDir)
  const peerDirCands = opts.peerDirCandidates || defaultPeerDirCandidates(pluginDir)
  let tier = null            // {embedQuery, embedPassages, model}
  let tierPromise = null
  let workerClient = null
  let disposed = false
  let generation = 0 // Invalidates in-flight initialization/results after dispose, reset or failure.
  let degraded = ''          // 非空 = 初始化失败原因(调用方回退词法)
  let degradedAt = 0         // ★ issue #70：最近一次置位的时刻（用于有界自动重试的冷却判定）
  let statsRetries = 0       // ★ issue #70：因冷却到期而清空降级态的累计次数（诊断用）
  let lastRankError = ''     // 运行期排名失败原因(诊断用;rank 恒返回 null 由调用方回退)
  // ★2026-09-29（C2 增量嵌入）：`idx` 由「整份快照」升级为「**按输入 hash 索引的向量池**」。
  //   旧结构 {miv, entries[{memoryId, vec}]} 只有一个全集指纹 ⇒ 语料一变（记忆是活的：自动沉淀
  //   每轮写日志）就必须重嵌全部条目，即便 99% 的 L0 文本一字未动。
  //   新结构把「向量」与「语料组成」解耦——向量的真身份是**输入文本**（e5 确定性：同输入必同向量，
  //   本仓已有实测 cosine=1.000000），因此用 sha256(编码输入) 当池子的键，与 l0-index.js 的
  //   l0Hash 复用同一套语义（两层：同 id 同 hash / 跨 id 同 hash）。
  //   收益（本机真机实测 1111 条语料）：语料变更后通常只新增/改动 0–20 条 ⇒ 嵌入成本
  //   从「全量 ≈0.9s」降到「增量 ≈0–16ms」；追加一行日志的实测 hash 复用率 100%。
  //   缓存仍以 miv 为**失效信号**：miv 未变直接命中；miv 变了也只为新 hash 付钱。
  let idx = { miv: null, byHash: new Map(), entries: [] } // entries [{memoryId, vec}] 由 byHash 投影
  let poolHits = 0           // 诊断：hash 池命中次数（避免重复嵌入的实证计数）
  let poolMisses = 0         // 诊断：真实嵌入次数
  let rebuilding = null      // 单飞行重建 promise

  function modelsDir() {
    return (modelDirCands.find((c) => existsSync(path.join(c, E5_MODELS_SUBDIR))) || modelDirCands[0])
  }

  function assertCurrent(epoch) {
    if (disposed || epoch !== generation) {
      const error = new Error('js-semantic-engine: engine disposed or worker replaced')
      error.code = 'JS_SEMANTIC_DISPOSED'
      throw error
    }
  }

  function degrade(error) {
    generation++
    tier = null
    tierPromise = null
    const previous = workerClient
    workerClient = null
    if (previous) previous.dispose()
    degraded = String(error && error.message || error).slice(0, 160)
    degradedAt = Date.now()
  }

  function retryDelayMs() {
    const ms = Number(opts.degradedRetryMs)
    return Number.isFinite(ms) && ms > 0 ? ms : 60000
  }

  function retryEligible() {
    return !disposed && Boolean(degraded) && !tierPromise && Date.now() - degradedAt >= retryDelayMs()
  }

  async function ensureTier() {
    assertCurrent(generation)
    if (tier) return tier
    // ★ issue #70 修复（2026-09-19）：`degraded` 由**单向闩锁**改为**有界自动重试**。
    //   旧行为：首次 `ensureTier()` 失败 ⇒ `degraded` 置位 ⇒ 此后恒抛，
    //   **唯一清除出口是测试钩子 `_resetForTest`** ⇒ 用户补齐资产 / 修好 onnx 后，
    //   本进程内**永久** C2 降级（只能重启宿主），且 UI 仍显示"✓ 就绪"（见 probeJsSemanticAssets 的修复）。
    //   现行为：冷却期（默认 60s，可配 `degradedRetryMs`）过后允许**再试一次**；
    //   重试仍失败则更新时间戳继续冷却 —— 既不会每轮都去加载大模型，也不会永久闩死。
    if (degraded && !tierPromise) {
      if (!retryEligible()) throw new Error(degraded)
      // Keep health degraded until initialization succeeds; other callers join tierPromise.
      statsRetries++
    }
    const epoch = generation
    if (!tierPromise) {
      tierPromise = (async () => {
        if (opts.injectEmbedder) return opts.injectEmbedder
        const md = modelsDir()
        if (!existsSync(path.join(md, E5_MODELS_SUBDIR, 'onnx', 'model_quantized.onnx'))) {
          throw new Error('js-semantic-engine: model asset missing under ' + md)
        }
        // #156: only the child imports transformers/onnx/sharp. Never fall back to a host import.
        const built = createJsSemanticProcessPre({
          pluginDir,
          modelsDir: md,
          peerDirs: peerDirCands.slice(),
          startupTimeoutMs: opts.startupTimeoutMs,
          requestTimeoutMs: opts.requestTimeoutMs,
          onFailure(error) {
            if (!disposed && workerClient === built) degrade(error)
          },
        })
        workerClient = built
        // The child performs the offline 384-dimensional, unit-norm self-test before replying.
        await built.initialize()
        assertCurrent(epoch)
        return built
      })()
    }
    try {
      const built = await tierPromise
      assertCurrent(epoch)
      tier = built
      degraded = ''
      degradedAt = 0
      return tier
    } catch (e) {
      if (!disposed && epoch === generation) degrade(e)
      throw e
    }
  }

  /**
   * 建/更新索引（★2026-09-29 起为**真增量**：只嵌 hash 池里没有的输入）。
   *
   * 语义（与 l0-index.js 的 assemble 同源，两级复用）：
   *   ① miv 未变 → 直接命中（旧行为保留）；
   *   ② miv 变了 → 逐条算 sha256(编码输入)，**池里有该 hash 就直接复用向量**（同 id 同 hash、
   *      跨 id 同 hash 都走这一条），只有 hash 没见过才真正送进 embedder。
   * 池子只增不缩（上限见 POOL_MAX），因为「同 hash ⇒ 同向量」永真，多余条目只占内存不损正确性。
   *
   * 回退开关 `incremental`（宿主 config.semanticEmbedIncremental，默认 true）：false 时每轮
   * 语料变化都全量重嵌（旧行为，逐字节等价），用于对照/排障。
   */
  const POOL_MAX = 20000 // 内存上限保护：384 float × 4B × 2 万 ≈ 30MB，远超实际语料
  async function buildIndexIfStale(miv, records) {
    if (idx.miv === miv) return idx
    if (rebuilding) return rebuilding
    const epoch = generation
    rebuilding = (async () => {
      const incremental = opts.incremental !== false
      const t = await ensureTier()
      const seen = new Set()
      const items = []
      for (const r of Array.isArray(records) ? records : []) {
        if (!r || typeof r.memoryId !== 'string' || seen.has(r.memoryId)) continue
        seen.add(r.memoryId)
        items.push({ memoryId: r.memoryId, text: String(r.text || '').slice(0, 1200) })
      }
      // ① 逐条算 hash，能复用就直接拿；不能复用且批内未出现过才排队嵌入
      //    hash 口径 = **编码输入的归一化文本**（与 embedPassages 内部的 clean() 同源；前缀
      //    'passage: ' 对所有条目恒同，一一对应故不入 hash）。这样「会让 e5 产出同一向量的输入」
      //    与「同一 hash」严格等价，命中率最高且绝不会错用。
      const byHash = (incremental && idx.byHash instanceof Map) ? idx.byHash : new Map()
      const need = []            // [{hash, text}]
      const queued = new Set()
      const entries = []
      for (const it of items) {
        const enc = clean(it.text)
        // 变量名刻意不用 `hash`：下方下载器有源码级顺序守卫（indexOf 取首个常量名），
        // 同名会让「清理在哈希累积之前」的既有断言假红（2026-09-29 实测踩过）。
        const contentKey = createHash('sha256').update(enc, 'utf8').digest('hex')
        const hash = contentKey // eslint-disable-line no-unused-vars -- 保留语义别名便于阅读
        let vec = byHash.get(hash)
        if (vec) {
          poolHits++
        } else if (!queued.has(hash)) {
          queued.add(hash)
          need.push({ hash, text: enc })
        }
        entries.push({ memoryId: it.memoryId, hash, vec: vec || null })
      }
      // ② 只嵌缺失的（need 为空不调用 embedder —— 不变更新零嵌入）
      if (need.length) {
        poolMisses += need.length
        const vecs = await t.embedPassages(need.map((x) => x.text))
        // ★2026-09-29（增量批）：**长度契约必须显式校验**，不得靠下游 `if (!v) continue` 兜掉。
        //   旧实现是 `embedPassages(全部)` + 直接按位取用，长度不符会自然炸成异常 ⇒ 走 catch ⇒
        //   rank 返回 null + lastRankError（调用方回退词法）。增量化后若只做「取不到就跳过」，
        //   坏 embedder（返回 []/短数组）会退化成**静默产出空索引**——半套排序，比报错更糟
        //   （m81 套件的反例正是这个：`embedPassages` 抛错必须让整轮失败）。
        if (!Array.isArray(vecs) || vecs.length !== need.length) {
          throw new Error('js-semantic-engine: embedder returned '
            + (Array.isArray(vecs) ? vecs.length : 'non-array')
            + ' vectors for ' + need.length + ' passages')
        }
        for (let i = 0; i < need.length; i++) {
          const v = vecs[i]
          if (!v) throw new Error('js-semantic-engine: embedder produced invalid vector at index ' + i)
          byHash.set(need[i].hash, v)
          for (const e of entries) if (e.hash === need[i].hash && !e.vec) e.vec = v
        }
        // 池子上限：超限丢最早插入的（Map 保序）
        while (byHash.size > POOL_MAX) {
          const oldest = byHash.keys().next().value
          byHash.delete(oldest)
        }
      }
      assertCurrent(epoch)
      idx = {
        miv: String(miv || ''),
        byHash,
        entries: entries.filter((e) => e.vec).map((e) => ({ memoryId: e.memoryId, vec: e.vec })),
        lastEmbedded: need.length,
      }
      return idx
    })()
    const currentBuild = rebuilding
    try {
      return await currentBuild
    } finally {
      if (rebuilding === currentBuild) rebuilding = null
    }
  }

  return {
    version: JS_SEMANTIC_ENGINE_VERSION,
    /** 探测状态(不触发加载):ready 仅表示「可尝试」,真实可用性以 rank 成功为准。 */
    status() {
      return {
        version: JS_SEMANTIC_ENGINE_VERSION,
        assetPresent: existsSync(path.join(modelsDir(), E5_MODELS_SUBDIR, 'onnx', 'model_quantized.onnx')),
        ready: !!tier,
        disposed,
        retryEligible: retryEligible(),
        retrying: !disposed && Boolean(degraded && tierPromise),
        execution: opts.injectEmbedder ? 'injected' : 'child-process',
        workerPid: workerClient ? workerClient.status().pid : null,
        degraded,
        // ★ issue #70：暴露降级时刻与重试计数，供面板/诊断判断"是否处于冷却期、下次何时可重试"
        degradedAt: degraded ? degradedAt : 0,
        degradedRetryMs: retryDelayMs(),
        degradedRetries: statsRetries,
        lastRankError,
        model: tier ? tier.model : null,
        indexedRecords: idx.entries.length,
        miv: idx.miv,
        embedding: !!rebuilding,
        // ★2026-09-29 增量账（诊断）：池命中 / 真实嵌入 / 本批实嵌条数 / 池规模
        poolHits,
        poolMisses,
        lastEmbedded: Number(idx.lastEmbedded) || 0,
        poolSize: idx.byHash instanceof Map ? idx.byHash.size : 0,
      }
    },
    /** 深度扫描热接入(0.1.37):把扫描发现的额外 peer 目录并入加载候选(去重,立即生效)。 */
    addPeerDirCandidates(dirs) {
      for (const d of Array.isArray(dirs) ? dirs : []) {
        if (typeof d === 'string' && d && !peerDirCands.includes(d)) peerDirCands.push(d)
      }
    },
    /**
     * 对语料做稠密排名。返回 {miv, scores:Map(memoryId→cosine)};失败返回 null(调用方回退词法)。
     */
    async rank(corpusSnap, queryText) {
      const epoch = generation
      try {
        const miv = String((corpusSnap && corpusSnap.memoryIndexVersion) || '')
        if (!miv || !/^idx_pre_[0-9a-f]{32}$/.test(miv)) return null
        const t = await ensureTier()
        const built = await buildIndexIfStale(miv, corpusSnap && corpusSnap.records)
        assertCurrent(epoch)
        if (!built.entries.length) return { miv, scores: new Map() }
        const qv = await t.embedQuery(String(queryText || '').slice(0, 2000))
        assertCurrent(epoch)
        const scores = new Map()
        for (const en of built.entries) {
          if (!en.vec || en.vec.length !== qv.length) continue
          let d = 0
          for (let i = 0; i < qv.length; i++) d += qv[i] * en.vec[i]
          scores.set(en.memoryId, d)
        }
        return { miv, scores }
      } catch (e) {
        lastRankError = String(e && e.message || e).slice(0, 160)
        return null // fail closed:词法回退由调用方自然发生
      }
    },
    /**
     * 2026-09-14（三层契约 C3）：暴露**批量段落嵌入**通道 —— L0 向量索引接线
     * （`lib/l0-index-sync.js`）需要把 L0 摘要本身变成向量，而 rank() 只返回
     * 「查询 vs 内部缓存索引」的余弦分，**不产出向量**（此前宿主没有任何拿向量的口子，
     * 这是 `createL0IndexPre` 一直零引用、无法接线的原因之一）。
     *
     * 语义：裸文本数组 → `Float32Array[]`（e5 口径为 384 维已归一化；前缀 `passage: ` 由引擎内部加，
     * 与 rank 的 `query: ` 前缀对称，调用方传**裸文本**）。
     * 失败语义：模型资产缺失/加载失败 → 抛错（**不吞**）—— 由调用方 fail-soft（索引侧只 diag 一行，
     * 不阻塞任何检索路径）。本方法不改任何内部状态（不缓存、不动 idx），纯计算。
     */
    async embedPassages(texts) {
      const epoch = generation
      const t = await ensureTier()
      const vectors = await t.embedPassages(Array.isArray(texts) ? texts : [])
      assertCurrent(epoch)
      return vectors
    },
    /**
     * ★2026-09-29（C3-读侧配套）：公开**单条查询嵌入**出口 —— 与 embedPassages 同批新增的
     * 对称面。此前外部只有 rank()（内部 query 嵌入 + 全库打分一体），读侧捷径
     * （index.js recallL0CachedRank）只需"查询向量自己算、语料向量从盘上读"，
     * 没有这个口子就得为了一次查询嵌入去跑整个 rank。纯计算、不改内部状态（不缓存不动 idx）。
     * 失败语义同 embedPassages：模型资产缺失/加载失败 → 抛错（不吞），调用方 fail-soft。
     */
    async embedQuery(text) {
      const epoch = generation
      const t = await ensureTier()
      const vector = await t.embedQuery(String(text || ''))
      assertCurrent(epoch)
      return vector
    },
    dispose() {
      if (disposed) return
      disposed = true
      generation++
      if (workerClient) workerClient.dispose()
      workerClient = null
      tier = null
      tierPromise = null
      idx = { miv: null, byHash: new Map(), entries: [] }
      rebuilding = null
    },
    _resetForTest() { generation++; if (workerClient) workerClient.dispose(); workerClient = null; disposed = false; tier = null; tierPromise = null; degraded = ''; degradedAt = 0; statsRetries = 0; idx = { miv: null, byHash: new Map(), entries: [] }; poolHits = 0; poolMisses = 0; rebuilding = null },
  }
}

function clean(t) {
  return String(t || '').replace(/\s+/g, ' ').trim().slice(0, 1200)
}

// ========== 3) 资产下载器 ==========

/** 资产清单:SHA256 于 2026-08-26 从已验证开发树副本冻结(Xenova/multilingual-e5-small q8)。 */
const E5_SMALL_Q8_FILES_PRE_V1 = Object.freeze([
  Object.freeze({ rel: 'multilingual-e5-small/onnx/model_quantized.onnx', bytes: 118308185, sha256: 'f80102d3f2a1229f387d3c81909990d8945513e347b0eab049f7de3c6f98c193' }),
  Object.freeze({ rel: 'multilingual-e5-small/tokenizer.json', bytes: 17082730, sha256: '0b44a9d7b51c3c62626640cda0e2c2f70fdacdc25bbbd68038369d14ebdf4c39' }),
  Object.freeze({ rel: 'multilingual-e5-small/config.json', bytes: 658, sha256: 'cb99455288675345e1a4f411438d5d0adbba5fbd3a67ea4fb03c015433b996c1' }),
  Object.freeze({ rel: 'multilingual-e5-small/special_tokens_map.json', bytes: 167, sha256: 'd05497f1da52c5e09554c0cd874037a083e1dc1b9cfd48034d1c717f1afc07a7' }),
  Object.freeze({ rel: 'multilingual-e5-small/tokenizer_config.json', bytes: 443, sha256: 'a1d6bc8734a6f635dc158508bef000f8e2e5a759c7d92f984b2c86e5ff53425b' }),
])
export const E5_SMALL_Q8_MANIFEST_PRE_V1 = Object.freeze({
  model: E5_MODELS_SUBDIR,
  dtype: 'q8',
  files: E5_SMALL_Q8_FILES_PRE_V1,
  totalBytes: E5_SMALL_Q8_FILES_PRE_V1.reduce((s, f) => s + f.bytes, 0),
})

/** 双通道:cn=hf-mirror(国内可达)/ intl=huggingface 官方。auto=国内优先(用户群主体)。 */
export const SEMANTIC_DL_MIRRORS_PRE_V1 = Object.freeze({
  cn: 'https://hf-mirror.com/Xenova/multilingual-e5-small/resolve/main/',
  intl: 'https://huggingface.co/Xenova/multilingual-e5-small/resolve/main/',
})

/**
 * opts: { modelsRoot(下载落位根目录), manifest?, mirrors?, fetchImpl?, chunkBytes? }
 * 状态机: idle → downloading → verifying → done | error | cancelled;单飞行。
 */
export function createSemanticDownloaderPre(opts = {}) {
  const modelsRoot = String(opts.modelsRoot || '')
  const manifest = opts.manifest || E5_SMALL_Q8_MANIFEST_PRE_V1
  const doFetch = opts.fetchImpl || ((u, o) => fetch(u, o))
  let st = { phase: 'idle', file: '', bytesDone: 0, bytesTotal: manifest.totalBytes, mirrorUsed: '', error: '', startedAt: 0 }
  let cancelFlag = false

  function setState(patch) { st = Object.assign({}, st, patch) }

  function tmpDir() { return path.join(modelsRoot, '.tmp-dl') }

  async function fetchToFile(fileRec, base) {
    // 镜像 base 已含模型子目录(Xenova/multilingual-e5-small/resolve/main/),
    // rel 带 multilingual-e5-small/ 前缀用于落位;URL 拼接时剥掉前缀避免路径重复 404。
    const urlRel = fileRec.rel.indexOf(E5_MODELS_SUBDIR + '/') === 0 ? fileRec.rel.slice(E5_MODELS_SUBDIR.length + 1) : fileRec.rel
    const res = await doFetch(base + fileRelUrl(urlRel), { redirect: 'follow' })
    if (!res.ok) throw new Error('http-' + res.status)
    if (!res.body) throw new Error('no-body')
    const total = Number(res.headers.get('content-length')) || fileRec.bytes
    mkdirSync(tmpDir(), { recursive: true })
    const dst = path.join(tmpDir(), path.basename(fileRec.rel))
    // ★ 每次尝试从零开始（2026-09-19 上游 PR #79 / issue #65 同步落地）：
    //   tmp 只在 run() 开始清一次，但 fetchToFile 会被**多个镜像依次调用**；
    //   而写入用 flag:'a' 追加 ⇒ 源 A 断流留下的半截文件会被续上源 B 的完整流。
    //   致命处：sha256 只对**网络流**累积（hash.update）、**不回读文件** ⇒ 拼接体校验照样通过并落位，
    //   直到加载期才失败。故每次尝试前必须清掉残留。
    try { rmSync(dst, { force: true }) } catch (_) {}
    const hash = createHash('sha256')
    const reader = res.body.getReader()
    let buf = Buffer.alloc(0)
    let n = 0
    for (;;) {
      if (cancelFlag) throw new Error('cancelled')
      const { done, value } = await reader.read()
      if (done) break
      buf = Buffer.concat([buf, Buffer.from(value)])
      n += value.byteLength
      hash.update(Buffer.from(value))
      setState({ file: fileRec.rel, bytesDone: st.bytesDoneBase + n, bytesTotal: st.bytesTotalBase + Math.max(0, total - fileRec.bytes) })
      if (buf.length >= (opts.chunkBytes || 1 << 20)) {
        appendChunk(dst, buf); buf = Buffer.alloc(0)
      }
    }
    if (buf.length) appendChunk(dst, buf)
    const hex = hash.digest('hex')
    if (hex !== fileRec.sha256) {
      try { unlinkSync(dst) } catch (_) {}
      const e = new Error('sha256-mismatch:' + hex.slice(0, 12))
      e.code = 'SHA256_MISMATCH'
      throw e
    }
    return { dst, got: n }
  }

  function appendChunk(dst, buf) {
    // writeFileSync flag 'a':追加;首块前由调用方确保不存在
    writeFileSync(dst, buf, { flag: 'a' })
  }

  function fileRelUrl(rel) { return rel.split('\\').join('/') }

  async function run(order) {
    setState({ phase: 'downloading', bytesDone: 0, error: '', startedAt: Date.now() })
    rmSync(tmpDir(), { recursive: true, force: true })
    let cum = 0
    for (const f of manifest.files) {
      st.bytesDoneBase = cum
      st.bytesTotalBase = cum + f.bytes
      let ok = false
      let lastErr = ''
      for (const m of order) {
        if (cancelFlag) break
        try {
          setState({ mirrorUsed: m })
          const r = await fetchToFile(f, SEMANTIC_DL_MIRRORS_PRE_V1[m])
          const final = path.join(modelsRoot, f.rel)
          mkdirSync(path.dirname(final), { recursive: true })
          try { unlinkSync(final) } catch (_) {}
          renameSync(r.dst, final)
          ok = true
          break
        } catch (e) {
          lastErr = (e && e.code === 'SHA256_MISMATCH' ? e.message : String(e && e.message || e)).slice(0, 140)
          if (e && e.message === 'cancelled') break
        }
      }
      if (cancelFlag) { setState({ phase: 'cancelled', error: 'user-cancelled', file: f.rel }); return }
      if (!ok) { setState({ phase: 'error', error: (f.rel + ' ← ' + lastErr) }); return }
      setState({ phase: 'verifying' })
      cum += f.bytes
      setState({ bytesDone: cum, bytesTotalBase: cum, bytesDoneBase: cum })
    }
    rmSync(tmpDir(), { recursive: true, force: true })
    setState({ phase: 'done', mirrorUsed: st.mirrorUsed, error: '' })
  }

  return {
    version: JS_SEMANTIC_DL_VERSION,
    start(mirror) {
      const m = String(mirror || 'auto')
      if (!['auto', 'cn', 'intl'].includes(m)) return { ok: false, reason: 'bad-mirror' }
      if (st.phase === 'downloading' || st.phase === 'verifying') return { ok: false, reason: 'already-running' }
      if (!modelsRoot) return { ok: false, reason: 'no-models-root' }
      cancelFlag = false
      const order = m === 'auto' ? ['cn', 'intl'] : [m]
      void run(order).catch((e) => setState({ phase: 'error', error: String(e && e.message || e).slice(0, 160) }))
      return { ok: true }
    },
    cancel() {
      if (st.phase !== 'downloading' && st.phase !== 'verifying') return { ok: false, reason: 'not-running' }
      cancelFlag = true
      return { ok: true }
    },
    state() { return Object.assign({}, st) },
  }
}
