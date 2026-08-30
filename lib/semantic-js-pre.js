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
import { existsSync, readFileSync, mkdirSync, renameSync, unlinkSync, writeFileSync, rmSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'

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

function defaultModelsDirCandidates(pluginDir) {
  // 发行包(lib/models)优先,其次开发树 artifacts/js-semantic-trial/models
  return [
    path.join(pluginDir, 'models'),
    path.join(pluginDir, '..', 'artifacts', 'm7-live-pre', 'js-semantic-trial', 'models'),
  ]
}

function defaultPeerDirCandidates(pluginDir) {
  return [
    path.join(pluginDir, 'node_modules', '@huggingface', 'transformers'),
    path.join(pluginDir, '..', 'artifacts', 'm7-live-pre', 'js-semantic-trial', 'node_modules', '@huggingface', 'transformers'),
  ]
}

async function importPeerTransformers(peerDirs) {
  try {
    return await import('@huggingface/transformers') // 发行包:peer 邻接安装
  } catch (_) { /* 开发树:按路径解析 */ }
  for (const dir of peerDirs || []) {
    try {
      const pkgPath = path.join(dir, 'package.json')
      if (!existsSync(pkgPath)) continue
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
      const mainFile = String(pkg.main || 'dist/transformers.js')
      const entry = path.join(dir, mainFile)
      if (!existsSync(entry)) continue
      return await import(pathToFileURL(entry).href)
    } catch (_) { /* 尝试下一候选 */ }
  }
  const e = new Error('js-semantic-engine: optional peer @huggingface/transformers not installed; tier stays disabled')
  e.code = 'JS_SEMANTIC_PEER_MISSING'
  throw e
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
  let degraded = ''          // 非空 = 初始化失败原因(调用方回退词法)
  let lastRankError = ''     // 运行期排名失败原因(诊断用;rank 恒返回 null 由调用方回退)
  let idx = { miv: null, entries: [] } // entries [{memoryId, vec}]
  let rebuilding = null      // 单飞行重建 promise

  function modelsDir() {
    return (modelDirCands.find((c) => existsSync(path.join(c, E5_MODELS_SUBDIR))) || modelDirCands[0])
  }

  async function ensureTier() {
    if (tier) return tier
    if (degraded) throw new Error(degraded)
    if (!tierPromise) {
      tierPromise = (async () => {
        if (opts.injectEmbedder) return opts.injectEmbedder
        const md = modelsDir()
        if (!existsSync(path.join(md, E5_MODELS_SUBDIR, 'onnx', 'model_quantized.onnx'))) {
          throw new Error('js-semantic-engine: model asset missing under ' + md)
        }
        const mod = await importPeerTransformers(peerDirCands)
        const { pipeline, env } = mod
        env.allowRemoteModels = false // 全离线:记忆不出电脑
        env.localModelPath = md
        const extractor = await pipeline('feature-extraction', E5_MODELS_SUBDIR, { dtype: 'q8' })
        return {
          model: E5_MODELS_SUBDIR + '/q8',
          async embedQuery(text) {
            const out = await extractor('query: ' + clean(String(text || '')), { pooling: 'mean', normalize: true, truncation: true })
            return Float32Array.from(out.data)
          },
          async embedPassages(texts) {
            const out = []
            for (const t of texts) {
              const o = await extractor('passage: ' + clean(String(t || '')), { pooling: 'mean', normalize: true, truncation: true })
              out.push(Float32Array.from(o.data))
            }
            return out
          },
        }
      })()
    }
    try {
      tier = await tierPromise
      return tier
    } catch (e) {
      degraded = String(e && e.message || e).slice(0, 160)
      tierPromise = null
      throw e
    }
  }

  async function buildIndexIfStale(miv, records) {
    if (idx.miv === miv) return idx
    if (rebuilding) return rebuilding
    rebuilding = (async () => {
      const t = await ensureTier()
      const seen = new Set()
      const items = []
      for (const r of Array.isArray(records) ? records : []) {
        if (!r || typeof r.memoryId !== 'string' || seen.has(r.memoryId)) continue
        seen.add(r.memoryId)
        items.push({ memoryId: r.memoryId, text: String(r.text || '') })
      }
      const vecs = await t.embedPassages(items.map((i) => i.text.slice(0, 1200)))
      idx = { miv: String(miv || ''), entries: items.map((it, i) => ({ memoryId: it.memoryId, vec: vecs[i] })) }
      return idx
    })()
    try {
      return await rebuilding
    } finally {
      rebuilding = null
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
        degraded,
        lastRankError,
        model: tier ? tier.model : null,
        indexedRecords: idx.entries.length,
        miv: idx.miv,
        embedding: !!rebuilding,
      }
    },
    /**
     * 对语料做稠密排名。返回 {miv, scores:Map(memoryId→cosine)};失败返回 null(调用方回退词法)。
     */
    async rank(corpusSnap, queryText) {
      try {
        const miv = String((corpusSnap && corpusSnap.memoryIndexVersion) || '')
        if (!miv || !/^idx_pre_[0-9a-f]{32}$/.test(miv)) return null
        const t = await ensureTier()
        const built = await buildIndexIfStale(miv, corpusSnap && corpusSnap.records)
        if (!built.entries.length) return { miv, scores: new Map() }
        const qv = await t.embedQuery(String(queryText || '').slice(0, 2000))
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
    _resetForTest() { tier = null; tierPromise = null; degraded = ''; idx = { miv: null, entries: [] }; rebuilding = null },
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
    const res = await doFetch(base + fileRelUrl(fileRec.rel), { redirect: 'follow' })
    if (!res.ok) throw new Error('http-' + res.status)
    if (!res.body) throw new Error('no-body')
    const total = Number(res.headers.get('content-length')) || fileRec.bytes
    mkdirSync(tmpDir(), { recursive: true })
    const dst = path.join(tmpDir(), path.basename(fileRec.rel))
    const hash = createHash('sha256')
    const reader = res.body.getReader()
    const fd = writeFileSync // 占位避免未用告警;真正写入走手动缓冲
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
    void fd
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
