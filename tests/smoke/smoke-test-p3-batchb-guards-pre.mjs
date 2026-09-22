// P3 批次 A+B 守卫（2026-09-22）—— 把本轮落地的缺陷修复钉成**可回归**的断言。
//
// 依据：docs/internal/P3-IMMEDIATE-7-WORKORDER-20260922.md（§3/§4/§5/§6/§7）
//
// 形态：**源码定位断言 + 真行为断言**双轨。
//   - 源码断言用「跨行正则锚定在函数体内」的写法，而不是全文 contains —— 否则把
//     `pathsByKey.delete(...)` 挪到别的函数里也会绿（本仓踩过「改坏仍绿」的坑）。
//   - 能真跑的一律真跑（retryRename 语义、EvidenceEventStore 节流、debugView 投影、
//     probeJsSemanticAssets 的 env 闸）；这些不需要改生产签名就能测。
//   - 本套件**不启动宿主**、不注册定时器 ⇒ 不会像 consolidate-isolation 那样空转。
//
// 零依赖（只用 node 内置 + 本仓 lib 模块）。
import { readFileSync, existsSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = process.cwd()
const rd = (p) => readFileSync(path.join(ROOT, p), 'utf8')
const load = (p) => import(pathToFileURL(path.join(ROOT, 'lib', p)).href)

let pass = 0, fail = 0
const t = (n, f) => {
  try {
    const r = f()
    if (r && typeof r.then === 'function') throw new Error('t() 不支持 async 回调（请改用 ta()）')
    pass++; console.log('  ok - ' + n)
  } catch (e) { fail++; console.log('  FAIL - ' + n + ': ' + (e && e.message)) }
}
const ta = async (n, f) => {
  try { await f(); pass++; console.log('  ok - ' + n) }
  catch (e) { fail++; console.log('  FAIL - ' + n + ': ' + (e && e.message)) }
}
const assert = (c, m) => { if (!c) throw new Error(m || 'assertion failed') }
/** 跨行：在 `start` 匹配点之后的 `span` 字符内必须出现 `needle`（用于「锚定在函数体内」）。 */
const within = (src, start, span, needle, msg) => {
  const i = src.search(start)
  assert(i >= 0, (msg || '') + '：找不到起点 ' + start)
  const seg = src.slice(i, i + span)
  assert(seg.indexOf(needle) >= 0, (msg || '') + '：起点后 ' + span + ' 字符内找不到 ' + needle)
}
const count = (s, re) => (s.match(re) || []).length

const CH = rd('lib/context-host.js')
const CI = rd('lib/config-io.js')
const SJ = rd('lib/semantic-js.js')
const SH = rd('lib/shadow-host.js')
const EV = rd('lib/evidence-store.js')
const M7 = rd('lib/m7-index-sync-host.js')
const IDX = rd('lib/index.js')

console.log('=== P3B-1 · P3-3(a) pathsByKey 必须随 disposeRuntime 释放 ===')

t('P3B-1a ★★ delete 必须在 disposeRuntime 函数体内（不是"全文某处有"）', () => {
  within(CH, /function disposeRuntime\(runtime\) \{/, 700,
    "pathsByKey.delete(String(runtime.key || ''))",
    '★ disposeRuntime 未释放 pathsByKey')
})

t('P3B-1b ★ 键口径必须与三处读点一致（String(runtime.key || \'\')）', () => {
  assert(count(CH, /pathsByKey\.get\(String\(runtime\.key \|\| ''\)\)/g) >= 3, '★ 读点键口径变了')
  assert(count(CH, /pathsByKey\.delete\(String\(runtime\.key \|\| ''\)\)/g) === 1, '★ 键口径与读点不一致')
})

t('P3B-1c ★ 写入点仍唯一（=1）；delete/clear 不得泛滥', () => {
  assert(count(CH, /pathsByKey\.set\(/g) === 1, '★ 写入点不是 1 处')
  assert(count(CH, /pathsByKey\.clear\(\)/g) === 0, '★ 出现 clear() 一刀切（会误伤未 dispose 的 runtime）')
})

console.log('\n=== P3B-2 · P3-12 异步原子写接有界退避 rename ===')

t('P3B-2a ★★ 零运行时依赖不变量 + 只动异步版（同步 renameSync 必须保留且恰好 1 处）', () => {
  // 本模块文件头声明「零运行时依赖：只用 node: 内置」，T8c-6 是它的守卫。
  // 故 P3-12 的退避 rename 必须**内联**，不得 import 兄弟模块（fs-retry.js）。
  const imports = [...CI.matchAll(/^import\s+.*?from\s+'([^']+)'/gm)].map((m) => m[1])
  const ext = imports.filter((s) => !s.startsWith('node:'))
  assert(ext.length === 0, '★ 出现非 node: 依赖（破坏零运行时依赖纪律）：' + ext.join(', '))
  assert(/async function renameBoundedRetryPre\(from, to\)/.test(CI), '★ 缺少内联的有界退避 rename')
  assert(/const RENAME_RETRY_DELAYS_V1 = Object\.freeze\(\[0, 50, 150, 400, 1000\]\)/.test(CI), '★ 退避刻度与 fs-retry-pre 不一致')
  assert(/TRANSIENT_RENAME_CODES_V1 = new Set\(\['EPERM', 'EACCES', 'EBUSY'\]\)/.test(CI), '★ 瞬时错误码集合不符')
  assert(count(CI, /renameSync\(tmp, file\)/g) === 1, '★ 同步/异步版的 renameSync 计数不是 1（同步契约被破或异步未改）')
  assert(count(CI, /await renameBoundedRetryPre\(tmp, file\)/g) === 1, '★ 异步版未接退避 rename')
  within(CI, /export async function writeTextAtomicPre\(file, text\) \{/, 500, 'await renameBoundedRetryPre(tmp, file)', '★ 接线不在异步版内')
})

await ta('P3B-2b ★★ 真行为：retryRename 对瞬时 EBUSY 必须退避重试（改回裸 rename 必红）', async () => {
  const M = await load('fs-retry.js')
  const calls = []
  const flaky = { rename: async (f, to) => { calls.push(f); if (calls.length < 3) { const e = new Error('busy'); e.code = 'EBUSY'; throw e } } }
  await M.retryRename('a', 'b', { fs: flaky, sleep: async () => {} })
  assert(calls.length === 3, '★ EBUSY 下未重试到第 3 次（实得 ' + calls.length + '）')
})

await ta('P3B-2c ★ 真行为：非瞬时错误必须立即抛出（不得无限重试掩盖真故障）', async () => {
  const M = await load('fs-retry.js')
  let n = 0
  const bad = { rename: async () => { n++; const e = new Error('nope'); e.code = 'ENOENT'; throw e } }
  let threw = false
  try { await M.retryRename('a', 'b', { fs: bad, sleep: async () => {} }) } catch (_) { threw = true }
  assert(threw, '★ ENOENT 未抛出')
  assert(n === 1, '★ ENOENT 被重试了 ' + n + ' 次（应只试 1 次）')
})

await ta('P3B-2d ★★★ 真行为：并发同路径写必须**全成功**、不产半截、不留 tmp（tmp 唯一性回归绊索）', async () => {
  const M = await load('config-io.js')
  const dir = mkdtempSync(path.join(tmpdir(), 'dam-p3b2-'))
  const target = path.join(dir, 'c.json')
  const payloads = [...Array(5)].map((_, i) => 'x' + String(i).repeat(20000))
  const rs = await Promise.all(payloads.map((p) => M.writeTextAtomicPre(target, p)))
  // 2026-09-22：tmp 名原先**只由目标路径决定**（`file + '.tmp'`）⇒ 并发互抢同一 tmp，
  //   先完成者把它改名走，后到者 rename 抛 ENOENT（非瞬时错误、按纪律不重试）⇒ 后一次保存
  //   **静默失败**（只回 {ok:false}）。已修：tmp 加唯一段（pid + 进程内自增）。
  //   本条现在钉**修复后的行为**——把 tmp 改回固定名 ⇒ 本条必红，这就是它作为绊索的价值。
  assert(rs.every((r) => r.ok === true), '★ 并发写有失败（tmp 唯一性被破坏？）：' + JSON.stringify(rs.filter((r) => !r.ok)))
  const got = readFileSync(target, 'utf8')
  assert(payloads.includes(got), '★ 目标文件既非任何一版的完整内容（出现半截/交错写入）')
  // 用「含 .tmp 子串」而非「以 .tmp 结尾」——唯一段是 `.tmp-<pid>-<n>`，
  // 只判结尾会把残留漏成假绿（这是本条存在的第二个理由）。
  const residue = readdirSync(dir).filter((n) => n.indexOf(M.ATOMIC_TMP_SUFFIX_V1) >= 0)
  assert(residue.length === 0, '★ 成功路径留下 tmp 残留：' + residue.join(', '))
})

console.log('\n=== P3B-3 · P3-14 开发树候选必须由 DAM_DEV_TREE 显式开启 ===')

t('P3B-3a ★ env 闸常量写法 + 默认关闭', () => {
  assert(/const DEV_TREE_ENABLED = process\.env\.DAM_DEV_TREE === '1'/.test(SJ), '★ env 闸不存在或写法变了')
})

t('P3B-3b ★★ 生产候选形态的 m7-live-pre 只剩 1 处（且必须在 devTreeRoot 内）', () => {
  const hits = [...SJ.matchAll(/path\.join\([^)]*m7-live-pre[^)]*\)/g)].map((m) => m[0])
  assert(hits.length === 1, '★ 候选形态 m7-live-pre 命中 ' + hits.length + '（期望 1）\n' + hits.join('\n'))
  within(SJ, /function devTreeRoot\(pluginDir\) \{/, 300, 'm7-live-pre', '★ 唯一那处不在 devTreeRoot 内')
})

// ★2026-09-22 P10-C 契约变更（用户裁定）：dev 树候选的闸门由「环境变量显式开启」统一为
//   **存在性判定**（`devTreeRoot(pluginDir)`）—— 同文件另外两处在 P10-B 已改成存在性，唯独
//   探针这处漏改 ⇒ 开发机上 peer 能解析、资产恒判 missing（面板假报「JS ✗ 未就绪」）。
//   保护意图不变、判据更严：用户机上该目录结构性不存在 ⇒ 发布包行为不变。
//   正反两向均用**一次性临时 DSH_HOME + 临时 pluginDir** 验证，不再依赖本仓库自身那棵树
//   （旧写法是「本机绿、别机红」的隐患）。
await ta('P3B-3c ★★ 真行为：dev 树闸门=存在性（无目录→不回落；有目录→无环境变量也命中）', async () => {
  const M = await load('semantic-js.js')
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const tmp = mkdtempSync(path.join(tmpdir(), 'dam-p3b3c-'))
  const oldHome = process.env.DSH_HOME
  const oldDev = process.env.DAM_DEV_TREE
  try {
    process.env.DSH_HOME = path.join(tmp, 'dshhome') // 用户级候选指向不存在的位
    delete process.env.DAM_DEV_TREE                  // 关掉显式开关，只考验存在性判定
    const pluginDir = path.join(tmp, 'lib')

    // ① 反例：dev 树不存在 ⇒ 不得回落到开发树路径（发布包保护，原断言保留）
    const r0 = M.probeJsSemanticAssets(pluginDir, [], '')
    assert(r0 && typeof r0 === 'object', '★ 探针返回值异常')
    assert(r0.assetPresent === false, '★ 无任何候选存在时 assetPresent 应为 false')
    assert(String(r0.assetPath).indexOf('m7-live-pre') < 0, '★ dev 树不存在时 assetPath 仍指向它：' + r0.assetPath)

    // ② 正例：把 dev 树造出来 ⇒ 无环境变量也必须命中（维护者机上的真实形态）
    const onnx = path.join(tmp, 'artifacts', 'm7-live-pre', 'js-semantic-trial', 'models', 'multilingual-e5-small', 'onnx')
    mkdirSync(onnx, { recursive: true })
    writeFileSync(path.join(onnx, 'model_quantized.onnx'), 'stub')
    const r1 = M.probeJsSemanticAssets(pluginDir, [], '')
    assert(r1.assetPresent === true, '★★ P10-C 回归：dev 树存在时 assetPresent 必须 true（否则面板假报「JS ✗ 未就绪」）')
    assert(String(r1.assetPath).indexOf('m7-live-pre') >= 0, '★ assetPath 未解析到 dev 树：' + r1.assetPath)
  } finally {
    if (oldHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = oldHome
    if (oldDev === undefined) delete process.env.DAM_DEV_TREE
    else process.env.DAM_DEV_TREE = oldDev
    rmSync(tmp, { recursive: true, force: true })
  }
})

console.log('\n=== P3B-4 · P3-9 组2 跨模块诊断必须节流化且可注入 ===')

t('P3B-4a ★ shadow-host 裸 console.error 已消失 + 调用点带 key', () => {
  assert(count(SH, /console\.error\('\[shadow-diag\] no-paths'\)/g) === 0, '★ 旧裸 console.error 仍在')
  assert(count(SH, /reportDiag\('shadow:no-paths'/g) === 1, '★ 调用点未带 key')
  // ★2026-09-22 锚点放宽（**不削弱判据**）：新增 `recallStats = null` 形参（召回统计三通路埋点，
  //   可选依赖注入）使原精确串失配。守卫意图 =「onDiag 仍在、且带向后兼容默认值」，
  //   ⇒ 改为**形参表内允许多带参数**，`onDiag = null` 仍须逐字存在（意图未变松）。
  assert(/export function createShadowHost\(\{[^}]*\bonDiag = null\b[^}]*\}\)/.test(SH), '★ 构造签名未加 onDiag（向后兼容默认值缺失）')
})

t('P3B-4b ★ evidence-store 裸 console.error 已消失 + 走实例方法', () => {
  assert(count(EV, /console\.error\('\[evidence-store\] write-failed: '/g) === 0, '★ 旧裸 console.error 仍在')
  assert(/reportDiag\(key, msg\) \{/.test(EV), '★ 无 reportDiag 实例方法')
  within(EV, /reportDiag\(key, msg\) \{/, 400, 'if (!shouldReportDiag(key)) return', '★ reportDiag 未先过闸（等于没节流）')
})

t('P3B-4c ★ 节流表必须在模块级（同进程多实例共享，否则各自双写）', () => {
  for (const [name, src] of [['shadow-host', SH], ['evidence-store', EV]]) {
    const i = src.indexOf('const _diagAt = new Map()')
    assert(i >= 0, '★ ' + name + ' 无模块级节流表')
    const fnStart = src.search(/export (function createShadowHost|class EvidenceEventStore)/)
    assert(fnStart > i, '★ ' + name + ' 的节流表不在模块级（落在工厂/类之后）')
    assert(/DIAG_THROTTLE_MS_V1 = 300000/.test(src), '★ ' + name + ' 节流窗口不是 5 分钟')
  }
})

t('P3B-4d ★★ 宿主侧接线：_shadowHost 与 evidence store 都要真的注入 onDiag', () => {
  // ★2026-09-22 锚点放宽（**不削弱判据**）：同一调用新增 `recallStats: engine._recallStats` 实参。
  //   守卫意图 =「onDiag 接线仍在且形态正确」⇒ 只要求 onDiag 以该形态出现，不再要求它是**唯一**实参。
  assert(/createShadowHost\(\{ engine, onDiag: \(key, msg\) => diagThrottled\(key, msg\)/.test(IDX), '★ _shadowHost 未接线 onDiag')
  assert(/onDiag: \(key, msg\) => \{ try \{ diagCtx\(msg\) \} catch \(_\) \{\} \}/.test(CH), '★ EvidenceEventStore 未接线 onDiag')
})

await ta('P3B-4e ★★ 真行为：连续 2 次写失败只透出 1 条诊断（首条立即、次条被节流）', async () => {
  const M = await load('evidence-store.js')
  const dir = mkdtempSync(path.join(tmpdir(), 'dam-p3b4-'))
  const blocker = path.join(dir, 'blocker')
  writeFileSync(blocker, 'x')  // root 指向一个**文件** ⇒ root/events 无法建立
  const calls = []
  const store = new M.EvidenceEventStore({ root: blocker, onDiag: (k, m) => calls.push({ k, m }) })
  const r1 = await store._writeLine('{"a":1}')
  const r2 = await store._writeLine('{"a":1}')
  assert(r1 === false && r2 === false, '★ 前置失败：写本应失败（r1=' + r1 + ' r2=' + r2 + '）')
  assert(calls.length === 1, '★ 节流失效：2 次失败透出 ' + calls.length + ' 条（期望 1）')
  assert(calls[0].k === 'evidence:write-failed', '★ 键不对：' + calls[0].k)
  assert(typeof calls[0].m === 'string' && calls[0].m.indexOf('[evidence-store] write-failed: ') === 0, '★ 消息形态变了：' + calls[0].m)
  assert(store.stats.writeFailed === 2, '★ 计数未累加（节流不该影响计数，实得 ' + store.stats.writeFailed + '）')
})

console.log('\n=== P3B-5 · m7 恒空死投影必须删除 ===')

t('P3B-5a ★ 三个符号在 m7 模块内必须 0 命中', () => {
  for (const k of ['enabledKeys', 'MAX_PATH_KEYS', 'capturedPathKeys']) {
    assert(M7.indexOf(k) < 0, '★ ' + k + ' 残留')
  }
})

t('P3B-5b ★ 反向对照：删的确实是死集合（该文件 .add( 本就 0 命中）', () => {
  assert(count(M7, /\.add\(/g) === 0, '★ .add( 命中 ' + count(M7, /\.add\(/g) + ' ⇒ 该 Set 可能不是死集合，删除需重估')
})

t('P3B-5c ★ 反向对照：context-host 的同名投影是**活的**，不得被误删', () => {
  assert(/capturedPathKeys: \[\.\.\.pathsByKey\.keys\(\)\]\.slice\(0, 8\)/.test(CH), '★ 误删了 live 投影（smoke-test-m78 会红）')
})

await ta('P3B-5d ★★ 真行为：debugView 开门后不得再投影该字段（且确实走到了真投影分支）', async () => {
  const M = await load('m7-index-sync-host.js')
  const engine = {
    config: { associativeMemoryEnabled: true, contextBridgeEnabled: true, pythonBackendEnabled: true, contextSinkMode: 'python' },
    _pythonSidecar: null,
  }
  const host = M.createIndexSyncHostPre({ engine, switchPersistPath: '' })
  const v = host.debugView()
  assert(v && v.enabled === true, '★ 未走到真投影分支（debugView.enabled=' + (v && v.enabled) + '）')
  assert(!('capturedPathKeys' in v), '★ 死投影仍在 debugView 里')
  assert('ready' in v && 'inFlightCount' in v && 'recentDrops' in v, '★ debugView 结构被破坏')
  assert(typeof host.ensureIndexReady === 'function' && typeof host.dispose === 'function', '★ 导出面被破坏')
})

console.log('\n=== P3B-6 · 批次 A 反向对照（本轮不该撤回的几处）===')

t('P3B-6a ★ 批次 A 的修复必须仍在 lib/index.js 内', () => {
  assert(count(IDX, /diagThrottled\('recall-best'/g) === 1, '★ P3-9 组1 recall-best 丢失')
  assert(count(IDX, /diagThrottled\('evidence-agg'/g) === 1, '★ P3-9 组1 evidence-agg 丢失')
  assert(count(IDX, /diagThrottled\('temporal-parse'/g) === 1, '★ P3-9 组1 temporal-parse 丢失')
  assert(count(IDX, /queueLength: q,/g) === 1, '★ P3-6 丢失（仍应为裸 q，不是 q.length）')
  assert(count(IDX, /runtime\.disposed \|\| !callId/g) === 1, '★ P3-1② 丢失')
})

console.log('\n[p3-batchb] ' + pass + ' passed, ' + fail + ' failed')
process.exit(fail ? 1 : 0)

