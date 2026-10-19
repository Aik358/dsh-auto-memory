// issue#451 验收：billion-context **代理型**压缩插件的水位兼容兜底。
//
// 缺陷（修复前）：该插件在服务端压缩历史、并禁用宿主原生 compaction，但**不写会话事件流**
// （源码 grep 实证：proxy 从不 session.append）⇒ dsh-token-meter 的守卫
//   baseline = usageTokens(usage) >= estimatedAnchorTokens ? 'usage' : 'estimated'
// 恒假 ⇒ baseline 永远 estimated、anchor.nodes 仍是未压缩全量 ⇒ 水位恒虚高十余倍
// ⇒ hardWall 恒真 ⇒ 每轮写骨架账本 + arm 自动接续。
//
// 本套件是**功能验收**：
//   [A] 真 import 五个纯函数并断言返回值（正/负路径各一组）；
//   [B] 真构造假 agent + **完整 MemoryEngine.checkWaterLevel 真调用**（grab 抽取真实方法体执行，
//       与仓内 smoke-test-issue349-water-window-cache 同法），四组场景：
//         ① 无插件（普通用户）⇒ 分子与基线逐字节不变 —— **零影响的结构性证据**
//         ② 有插件 + estimated ⇒ 分子换成真实 usage
//         ③ 有插件但 baseline=usage ⇒ 不动（原生链路已正确）
//         ④ 有插件但末条 usage 之后有原生压缩事件 ⇒ 不兜底（否则反向高估）
//         ⑤ 有插件但 usage 形状不可校验 ⇒ fail-open 保持原值
//         ⑥ 开关关闭 ⇒ 不兜底
//   [C] 变异验证：把四闸之一的判据改坏 ⇒ 对应断言必红（防恒真守卫）。
//   [D] 接线守卫（**不充当功能证据**，仅防止接线丢失）：源码含配置键/state/调试投影/前端三面行。
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
process.on('uncaughtException', (e) => { console.error('[a30] FATAL:', (e && e.stack || e.message) || e); process.exit(1) })
process.on('unhandledRejection', (r) => { console.error('[a30] REJ:', r); process.exit(1) })

const HERE = path.dirname(fileURLToPath(import.meta.url))
const INDEX_SRC = readFileSync(path.resolve(HERE, '..', '..', 'lib', 'index.js'), 'utf8')
const CLIENT_SRC = readFileSync(path.resolve(HERE, '..', '..', 'lib', 'client.js'), 'utf8')
const FROZEN_SRC = readFileSync(path.resolve(HERE, '..', '..', 'skins', 'legacy', 'iter5-325.js.frozen'), 'utf8')
const WW = await import('../../lib/water-window.js')
const {
  detectProxyCompactionPre, usageShapeTokensPre, findLastUsagePre, hasCompactionAfterPre, resolveProxyUsagePre,
} = WW

let pass = 0; let fail = 0
const ok = (cond, name) => { if (cond) { pass++; console.log('  ok - ' + name) } else { fail++; console.error('  FAIL - ' + name) } }
const eq = (a, b, name) => ok(JSON.stringify(a) === JSON.stringify(b), name + (JSON.stringify(a) === JSON.stringify(b) ? '' : ' got=' + JSON.stringify(a) + ' want=' + JSON.stringify(b)))

// ── 抽取工具（花括号配平 + 跳过字符串字面量）────────────────────────────
function grab(src, head) {
  const i = src.indexOf(head)
  if (i < 0) throw new Error('missing: ' + head)
  let d = 0; let started = false
  for (let j = i; j < src.length; j++) {
    const c = src[j]
    if (c === '{') { d++; started = true; continue }
    if (c === '}') { d--; if (started && d === 0) return src.slice(i, j + 1); continue }
    if (c === "'" || c === '"' || c === String.fromCharCode(96)) {
      const q = c
      for (j++; j < src.length; j++) {
        const c2 = src[j]
        if (c2 === String.fromCharCode(92)) { j++; continue }
        if (c2 === q) break
      }
    }
  }
  throw new Error('unclosed: ' + head)
}
// 方法简写 → 具名函数表达式，并注入依赖。
const bindMethod = (head, self, deps) => {
  const seg = grab(INDEX_SRC, head)
  const braceAt = seg.indexOf('{')
  const sig = seg.slice(0, braceAt).trim()
  const body = seg.slice(braceAt)
  const isAsync = sig.indexOf('async ') === 0
  const decl = isAsync ? sig.slice(6).trim() : sig
  const names = Object.keys(deps)
  const factory = new Function(...names, 'return ' + (isAsync ? 'async function ' : 'function ') + decl + ' ' + body + ';')
  return factory(...names.map((n) => deps[n])).bind(self)
}

const tmpRoot = mkdtempSync(path.join(tmpdir(), 'dam-a30-'))
process.on('exit', () => { try { rmSync(tmpRoot, { recursive: true, force: true }) } catch (_) {} })
const fakeHome = path.join(tmpRoot, 'home')
mkdirSync(fakeHome, { recursive: true })
writeFileSync(path.join(fakeHome, 'settings.yaml'), [
  'llm-x:',
  '  models:',
  '    - id: big-model',
  '      contextWindow: 1000000',
].join(String.fromCharCode(10)), 'utf8')

// ══════════════════════════════════════════════════════════════════════
// [A] 纯函数：真 import + 真调用 + 正负路径
// ══════════════════════════════════════════════════════════════════════
console.log('[A1] detectProxyCompactionPre：只读全局符号，缺失即 false')
const SYM_FI = Symbol.for('billion-context.native-fetch-intercept')
const SYM_ST = Symbol.for('billion-context.native-intercept-state')
const gPos = {}; gPos[SYM_FI] = true
eq(detectProxyCompactionPre(gPos), { detected: true, reason: 'fetch-intercept' }, '正路径：fetch-intercept 标记为 true ⇒ 命中')
const gPos2 = {}; gPos2[SYM_ST] = { origin: 'http://127.0.0.1:1' }
eq(detectProxyCompactionPre(gPos2), { detected: true, reason: 'live-state' }, '正路径：live-state 槽存在 ⇒ 命中')
eq(detectProxyCompactionPre({}), { detected: false, reason: 'absent' }, '★负路径：空对象（未安装插件的普通用户）⇒ 不命中')
eq(detectProxyCompactionPre(), { detected: false, reason: 'absent' }, '★负路径：默认参数（真实 globalThis，本机无该插件）⇒ 不命中')
eq(detectProxyCompactionPre(null), { detected: false, reason: 'no-global' }, '负路径：null ⇒ 不命中且不抛')
const gFalse = {}; gFalse[SYM_FI] = false
eq(detectProxyCompactionPre(gFalse).detected, false, '负路径：标记存在但为 false（未 install）⇒ 不命中')
const gNullSlots = {}; gNullSlots[SYM_ST] = null
eq(detectProxyCompactionPre(gNullSlots).detected, false, '负路径：state 槽已被 teardown 清空(null) ⇒ 不命中')

console.log('[A2] usageShapeTokensPre：口径与 token-meter usageTokens() 逐字对齐')
eq(usageShapeTokensPre({ inputTokens: 1000, cacheReadTokens: 500, cacheWriteTokens: 0, outputTokens: 200, totalTokens: 1700 }), 1700, '正路径：四桶齐 + total 相符 ⇒ 1700')
eq(usageShapeTokensPre({ inputTokens: 10, outputTokens: 5 }), 15, '正路径：缺 cache 两桶按 0（同 ?? 0 语义）')
eq(usageShapeTokensPre({ inputTokens: 10, cacheReadTokens: 5, outputTokens: 5 }), 20, '正路径：缺 cacheWrite 按 0')
eq(usageShapeTokensPre({ inputTokens: 1, outputTokens: 1, totalTokens: 999 }), null, '★负路径：total 与四桶之和不符 ⇒ 不用（不认识的口径）')
eq(usageShapeTokensPre({ inputTokens: 1 }), null, '★负路径：缺 outputTokens（必需桶）⇒ 不用')
eq(usageShapeTokensPre({ inputTokens: -1, outputTokens: 5 }), null, '★负路径：负数桶 ⇒ 不用')
eq(usageShapeTokensPre({ inputTokens: 0, outputTokens: 0 }), null, '★负路径：全零 ⇒ 不用（无信息量）')
eq(usageShapeTokensPre(null), null, '负路径：null ⇒ null 且不抛')
eq(usageShapeTokensPre('x'), null, '负路径：非对象 ⇒ null')

console.log('[A3] findLastUsagePre：逆序取最近一条可信 usage')
const mkUsage = (n) => ({ inputTokens: n, outputTokens: 1, totalTokens: n + 1 })
const evA = { seq: 1, type: 'assistant/message', data: { usage: mkUsage(100) } }
const evB = { seq: 2, type: 'assistant/message', data: { usage: mkUsage(200) } }
eq(findLastUsagePre([evA, evB]), { tokens: 201, seq: 2 }, '正路径：两条 ⇒ 取最后一条')
eq(findLastUsagePre([evA, evB, { seq: 3, type: 'user/message', data: {} }]), { tokens: 201, seq: 2 }, '正路径：尾部非 usage 事件被跳过')
eq(findLastUsagePre([evA, { seq: 5, type: 'assistant/message', data: { usage: { inputTokens: 1, outputTokens: 1, totalTokens: 99 } } }]), { tokens: 101, seq: 1 }, '正路径：末条形状不可信 ⇒ 继续往前找')
eq(findLastUsagePre([{ seq: 7, type: 'assistant/attempt', data: { stream: [{ type: 'chunk', chunk: { type: 'text' } }, { type: 'chunk', chunk: { type: 'usage', usage: mkUsage(300) } }] } }]), { tokens: 301, seq: 7 }, '正路径：assistant/attempt 的 stream 里 chunk.type=usage')
eq(findLastUsagePre([]), null, '★负路径：空事件 ⇒ null')
eq(findLastUsagePre(null), null, '★负路径：null ⇒ null 且不抛')
eq(findLastUsagePre([{ seq: 1, type: 'assistant/message', data: {} }]), null, '★负路径：无 usage 字段 ⇒ null')

console.log('[A4] hasCompactionAfterPre：基准 seq 之后的原生压缩检测')
const evs = [{ seq: 1, type: 'assistant/message', data: { usage: mkUsage(9) } }]
eq(hasCompactionAfterPre(evs, 1), false, '负路径：其后无压缩事件 ⇒ false')
eq(hasCompactionAfterPre([...evs, { seq: 2, type: 'compaction/start', data: {} }], 1), true, '★正路径：compaction/start 在基准之后 ⇒ true')
eq(hasCompactionAfterPre([...evs, { seq: 2, type: 'compaction/summary', data: {} }], 1), true, '★正路径：compaction/summary ⇒ true')
eq(hasCompactionAfterPre([{ seq: 0, type: 'compaction/start', data: {} }, ...evs], 1), false, '负路径：压缩事件在基准**之前** ⇒ false（已是旧状态）')
eq(hasCompactionAfterPre(evs, 0), false, '负路径：基准 seq=0 ⇒ 视为无基准，false')

console.log('[A5] resolveProxyUsagePre：四闸合成')
const RS_EVENTS = [{ seq: 10, type: 'assistant/message', data: { usage: { inputTokens: 160000, outputTokens: 1000, totalTokens: 161000 } } }]
const rsBase = { events: RS_EVENTS, baselineKind: 'estimated', baselineTokens: 2177730, meterTotal: 2178000, proxyDetected: true }
const rsPos = resolveProxyUsagePre(rsBase)
ok(rsPos.ok === true && rsPos.tokens === 161000 + (2178000 - 2177730), '★正路径：代理链路 ⇒ tokens = usage + surfaceDelta（实测 ' + JSON.stringify(rsPos) + '）')
eq(rsPos.usageTokens, 161000, '正路径：usageTokens 保留真实 usage 原值')
eq(rsPos.surfaceDelta, 270, '正路径：surfaceDelta = meterTotal - baselineTokens')
eq(resolveProxyUsagePre(Object.assign({}, rsBase, { baselineKind: 'usage' })), { ok: false, reason: 'not-estimated' }, '★负路径 闸①：baseline=usage（正常链路）⇒ 不动')
eq(resolveProxyUsagePre(Object.assign({}, rsBase, { proxyDetected: false })), { ok: false, reason: 'no-proxy-plugin' }, '★负路径 闸②：没装插件（普通用户）⇒ 不动')
eq(resolveProxyUsagePre(Object.assign({}, rsBase, { events: [] })), { ok: false, reason: 'no-usable-usage' }, '★负路径 闸③：无可用 usage ⇒ 放弃')
eq(resolveProxyUsagePre(Object.assign({}, rsBase, { events: [...RS_EVENTS, { seq: 11, type: 'compaction/start', data: {} }] })), { ok: false, reason: 'native-compaction-after-usage' }, '★负路径 闸④：usage 之后有原生压缩 ⇒ 放弃')
eq(resolveProxyUsagePre(null), { ok: false, reason: 'not-estimated' }, '负路径：null 入参 ⇒ 安全拒绝')
ok(resolveProxyUsagePre({ get events() { throw new Error('boom') } }).ok === false, '负路径：getter 抛错 ⇒ 被 catch，返回 ok:false（不冒泡）')

// ══════════════════════════════════════════════════════════════════════
// [B] 完整 MemoryEngine.checkWaterLevel 真调用
// ══════════════════════════════════════════════════════════════════════
console.log('[B] 完整 checkWaterLevel 真调用：六组场景')

// 可切换的假 meter：baseline.kind + totalTokens 由场景决定
const mkMeter = (kind, estimatedTokens, usageAnchorTokens) => ({
  measure() {
    const baseline = kind === 'usage'
      ? { kind: 'usage', tokens: usageAnchorTokens, usage: {} }
      : { kind: 'estimated', tokens: estimatedTokens }
    return {
      baseline,
      totalTokens: (baseline.tokens) + 50,   // 恒定 surfaceDelta = 50，便于逐字节复算
    }
  },
})

const makeEngine = (config, meter, proxyGlobal) => {
  const rt = { disposed: false }
  const eng = {
    config, state: {}, _rt: rt,
    runtimeFor: () => rt,
    diag: (line) => { eng._diags = eng._diags || []; eng._diags.push(String(line)) },
    writeHandoffLedger: async () => ({ ok: true }),
    rememberWaterRecord: function (sid, rec) { if (!this._waterRecords) this._waterRecords = {}; if (sid) this._waterRecords[sid] = rec },
    _officialParamsPre: () => ({ ratio: 0.8, headroomTokens: 65536, source: 'test-injected' }),
    _resolveWaterLevelPre: (W, O) => {
      const w = Number(W) || 0; const o = Math.max(0, Number(O) || 0)
      const fixed = Number(config.waterLevelThreshold) || 0.75
      const officialRatio = Math.min(0.8, ((w - o) - 65536) / w)
      if (!(officialRatio > 0)) return { mode: 'fixed', threshold: fixed, officialRatio: 0, officialTokens: 0, margin: 0, source: 'test-fallback' }
      return { mode: 'auto', threshold: Math.min(Math.max(officialRatio * 0.9, 0.1), 0.95), officialRatio, officialTokens: Math.floor(officialRatio * w), margin: 0.9, source: 'test-injected' }
    },
    _meter: meter,
    _proxyGlobal: proxyGlobal,
  }
  return eng
}

const wlBind = (fake) => {
  CURRENT_METER = fake._meter
  fake.estimateSessionTokens = bindMethod('estimateSessionTokens(messages) {', fake, {})
  fake.resolveWaterWindow = bindMethod("async resolveWaterWindow(providerOverride = '', modelOverride = '') {", fake, { dshHome: () => fakeHome })
  const sessionEventsOfFn = new Function(grab(INDEX_SRC, 'function sessionEventsOf(session) {') + String.fromCharCode(10) + 'return sessionEventsOf;')()
  return bindMethod('async checkWaterLevel(agent) {', fake, {
    extractSessionMessages: (a) => a.messages,
    diag: () => {},
    reflectionDigest: () => '',
    truncateHead: (s) => s,
    sessionEventsOf: sessionEventsOfFn,
    findOfficialContextWindowPre: WW.findOfficialContextWindowPre,
    findSessionModelPre: WW.findSessionModelPre,
    scanPressureSignalsPre: WW.scanPressureSignalsPre,
    reusableWindowCachePre: WW.reusableWindowCachePre,
    sessionModelSigPre: WW.sessionModelSigPre,
    // ★本批新增依赖：抽出的方法体引用这两个符号时必须注入，否则 ReferenceError 被
    //   同函数外的 try/catch 静默吞掉 ⇒ 兜底恒不生效而测试仍绿（issue349 同型坑）。
    detectProxyCompactionPre: () => detectProxyCompactionPre(fake._proxyGlobal),
    resolveProxyUsagePre,
  })
}

const HUGE = 2177730        // 压缩链路下 token-meter 给出的「未压缩全量估算」
const REAL_USAGE = 161000   // provider 实际回报的用量
let CURRENT_METER = null
const agentFor = (events, meter) => ({
  session: {
    id: 'session-a30',
    events: [
      { type: 'request/context', seq: 1, data: { contextWindow: 1000000, header: { config: { provider: 'llm-x', model: 'big-model', maxTokens: 1000 } } } },
      ...events,
    ],
  },
  messages: [{ text: 'x'.repeat(100) }],
  // 宿主 ctx.get('tokenMeter') —— 真实 checkWaterLevel 的取数入口，必须提供否则退化为 heuristic。
  ctx: { get: (name) => (name === 'tokenMeter' ? (meter || CURRENT_METER) : null) },
})
const usageEvent = (seq, n) => ({ seq, type: 'assistant/message', data: { usage: { inputTokens: n, outputTokens: 0, totalTokens: n } } })

// 场景① 无插件（普通用户）—— 零影响的结构性证据
{
  const eng = makeEngine({ handoffEnabled: false }, mkMeter('estimated', HUGE), {})
  const wl = wlBind(eng)
  await wl(agentFor([usageEvent(2, REAL_USAGE)]))
  eq(eng.state.waterLevelMeter, 'official:estimated', '★场景① 无插件 ⇒ meter 仍是 official:estimated（与修复前逐字节一致）')
  eq(eng.state.waterLevelMeasuredTokens, HUGE + 50, '★场景① 无插件 ⇒ 分子仍是 token-meter 全量估算（未被改动）')
  ok(!eng._proxyCompatLast, '★场景① 无插件 ⇒ 连留证记录都不产生（整段新逻辑未执行）')
}

// 场景② 有插件 + estimated ⇒ 兜底生效
{
  const g = {}; g[SYM_FI] = true
  const eng = makeEngine({ handoffEnabled: false }, mkMeter('estimated', HUGE), g)
  const wl = wlBind(eng)
  await wl(agentFor([usageEvent(2, REAL_USAGE)]))
  eq(eng.state.waterLevelMeter, 'official:proxyUsage', '★场景② 有插件 + estimated ⇒ meter 标 official:proxyUsage')
  eq(eng.state.waterLevelMeasuredTokens, REAL_USAGE + 50, '★场景② 分子 = 真实 usage + surfaceDelta（' + (REAL_USAGE + 50) + '）')
  ok(eng.state.waterLevelRatio > 0.15 && eng.state.waterLevelRatio < 0.17, '★场景② 水位回到真实量级（实测 ratio=' + eng.state.waterLevelRatio + '）')
  ok(eng.state.waterLevelRatio < 1, '★场景② 水位不再虚高到 >1（修复前 ' + (HUGE / 1e6).toFixed(2) + ' 倍）')
  eq(eng.state.waterLevelProxyCompat && eng.state.waterLevelProxyCompat.applied, true, '★场景② state.waterLevelProxyCompat.applied=true')
  eq(eng.state.waterLevelProxyCompat.estimated, HUGE + 50, '★场景② 留证：写入走兜底前的官方估算值')
}

// 场景③ 有插件但 baseline=usage（原生链路已经正确）⇒ 一字不动
{
  const g = {}; g[SYM_FI] = true
  const eng = makeEngine({ handoffEnabled: false }, mkMeter('usage', HUGE, 500000), g)
  const wl = wlBind(eng)
  await wl(agentFor([usageEvent(2, REAL_USAGE)]))
  eq(eng.state.waterLevelMeter, 'official:usage', '★场景③ baseline=usage ⇒ meter 保持 official:usage（不介入）')
  eq(eng.state.waterLevelMeasuredTokens, 500050, '★场景③ 分子仍是 token-meter 的值（未替换）')
}

// 场景④ 有插件 + estimated，但末条 usage 之后有原生压缩 ⇒ 不兜底
{
  const g = {}; g[SYM_FI] = true
  const eng = makeEngine({ handoffEnabled: false }, mkMeter('estimated', HUGE), g)
  const wl = wlBind(eng)
  await wl(agentFor([usageEvent(2, REAL_USAGE), { seq: 3, type: 'compaction/start', data: {} }, { seq: 4, type: 'compaction/end', data: {} }]))
  eq(eng.state.waterLevelMeter, 'official:estimated', '★场景④ 原生压缩之后 ⇒ 放弃兜底，meter 保持 estimated')
  eq(eng.state.waterLevelMeasuredTokens, HUGE + 50, '★场景④ 分子保持 token-meter 原值（避免用压缩前 usage 反向高估）')
  ok(eng.state.waterLevelProxyCompat && eng.state.waterLevelProxyCompat.applied === false, '★场景④ 留证记录 applied=false')
}

// 场景⑤ 有插件，但 usage 形状不可校验 ⇒ fail-open
{
  const g = {}; g[SYM_FI] = true
  const eng = makeEngine({ handoffEnabled: false }, mkMeter('estimated', HUGE), g)
  const wl = wlBind(eng)
  await wl(agentFor([{ seq: 2, type: 'assistant/message', data: { usage: { inputTokens: 5, outputTokens: 5, totalTokens: 999 } } }]))
  eq(eng.state.waterLevelMeter, 'official:estimated', '★场景⑤ usage 形状不自洽 ⇒ 放弃兜底（fail-open）')
  eq(eng.state.waterLevelMeasuredTokens, HUGE + 50, '★场景⑤ 分子保持原值')
}

// 场景⑥ 开关关闭 ⇒ 即使有插件也不兜底
{
  const g = {}; g[SYM_FI] = true
  const eng = makeEngine({ handoffEnabled: false, waterLevelProxyCompat: false }, mkMeter('estimated', HUGE), g)
  const wl = wlBind(eng)
  await wl(agentFor([usageEvent(2, REAL_USAGE)]))
  eq(eng.state.waterLevelMeter, 'official:estimated', '★场景⑥ 配置关 ⇒ 完全不探测、不兜底')
  eq(eng.state.waterLevelMeasuredTokens, HUGE + 50, '★场景⑥ 分子保持原值')
}

// ══════════════════════════════════════════════════════════════════════
// [C] 变异验证：把每个闸改坏 ⇒ 对应用例必红（证明判据非恒真）
// ══════════════════════════════════════════════════════════════════════
console.log('[C] 变异验证（改坏判据 ⇒ 断言必红）')
const mutateAndExpect = (label, makeFn, expectFn) => {
  const pos = makeFn(false)
  const neg = makeFn(true)
  ok(expectFn(pos) === true, '[变异基线] ' + label + '：正常实现下判据成立')
  ok(expectFn(neg) === false, '★[变异必红] ' + label + '：判据改坏后不再成立')
}
// C1：闸② 改坏 —— 把 proxyDetected 恒当 true
mutateAndExpect('闸②代理探测', (bad) => (input) => resolveProxyUsagePre(Object.assign({}, input, bad ? { proxyDetected: true } : {})),
  (fn) => fn({ events: RS_EVENTS, baselineKind: 'estimated', baselineTokens: 1, meterTotal: 2, proxyDetected: false }).ok === false)
// C2：闸① 改坏 —— 去掉 estimated 前置判断
mutateAndExpect('闸①baseline 类型', (bad) => (input) => (bad ? { ok: true } : resolveProxyUsagePre(input)),
  (fn) => fn({ events: RS_EVENTS, baselineKind: 'usage', proxyDetected: true }).ok === false)
// C3：闸④ 改坏 —— 忽略原生压缩事件
mutateAndExpect('闸④原生压缩', (bad) => (events, seq) => (bad ? false : hasCompactionAfterPre(events, seq)),
  (fn) => fn([{ seq: 0, type: 'x' }, { seq: 2, type: 'compaction/start' }], 1) === true)
// C4：usage 形状校验改坏 —— 不做 total 一致性检查
mutateAndExpect('usage 形状校验', (bad) => (u) => (bad ? (Number(u.inputTokens) || 0) + (Number(u.outputTokens) || 0) : usageShapeTokensPre(u)),
  (fn) => fn({ inputTokens: 1, outputTokens: 1, totalTokens: 999 }) === null)
// C5：探测改坏 —— 无条件认定装了插件
mutateAndExpect('探测全局符号', (bad) => (g) => (bad ? { detected: true } : detectProxyCompactionPre(g)),
  (fn) => fn({}).detected === false)

// ══════════════════════════════════════════════════════════════════════
// [D] 接线守卫（**不充当功能证据**，仅防止接线丢失后静默退化）
// ══════════════════════════════════════════════════════════════════════
console.log('[D] 接线守卫（守卫，非功能证据）')
ok(/waterLevelProxyCompat: true,/.test(INDEX_SRC), 'D1 DEFAULT_CONFIG 含 waterLevelProxyCompat（默认 true）')
ok(/this\.config\.waterLevelProxyCompat !== false/.test(INDEX_SRC), 'D2 兜底分支受配置开关门控')
ok(/proxyCompaction: \(\(\) =>/.test(INDEX_SRC) && /_proxyCompatView\(\)/.test(INDEX_SRC), 'D3 debugInfo 暴露 proxyCompaction 投影（fail-soft：局部 this 缺桩时降级为 detected:false，不让 /debug 整体 500）')
ok(/_proxyCompatProbeNow\(\)/.test(INDEX_SRC), 'D4 探测有缓存入口')
ok(/' proxyCompat=on estimated='/.test(INDEX_SRC), 'D5 advisory 行同时打印 estimated 与真实 usage 两个数')
ok(/meterViaProxy: !!proxyUsage/.test(INDEX_SRC), 'D6 water record 记录是否走了兜底')
// ★半修守卫（本轮实测踩到）：记录里写了新字段，但 handoff-state 的两条投影都不读 ⇒ 写了个没人读的字段。
//   判据不看「源码里有没有那个字符串」，而是数**读取点个数**：两条投影（rec / state）都必须透出。
const projReads = (INDEX_SRC.match(/meterViaProxy: /g) || []).length
ok(projReads === 3, 'D6b 记录 1 处 + 两条投影各 1 处 = 3（实测 ' + projReads + '）')
ok((INDEX_SRC.match(/estimatedTokens: Number/g) || []).length === 2, 'D6c 两条投影都透出 estimatedTokens')
ok((INDEX_SRC.match(/realUsageTokens: Number/g) || []).length === 2, 'D6d 两条投影都透出 realUsageTokens')
ok((INDEX_SRC.match(/waterLevelProxyCompat/g) || []).length >= 5, 'D7 state/debug/配置多处引用（实测 ' + (INDEX_SRC.match(/waterLevelProxyCompat/g) || []).length + ' 处）')
// 前端三面 + 文案 + 弹窗
const rows = (s, re) => (s.match(re) || []).length
ok(rows(CLIENT_SRC, /field\(t\('fWaterProxyCompat'\)/g) === 3, 'D8 三面设置页各有 1 个控件（实测 ' + rows(CLIENT_SRC, /field\(t\('fWaterProxyCompat'\)/g) + ' 处）')
ok(rows(FROZEN_SRC, /field\(t\('fWaterProxyCompat'\)/g) === 1, 'D9 冻结基线档也补了控件（settings-parity 三面同步）')
ok(/waterMeterProxy/.test(CLIENT_SRC), 'D10 水位卡 meter 文案含代理档')
ok(/'dsh-auto-memory\.proxyCompatOffer'/.test(CLIENT_SRC), 'D11 弹窗去重标记存在（accepted/never/later 三态）')
ok(/dialogState\.kind === 'proxyCompat'/.test(CLIENT_SRC), 'D12 弹窗渲染分支存在')
ok(/d\.kind === 'proxyCompat'\) return 40/.test(CLIENT_SRC), 'D13 弹窗优先级已登记（低于语义检测 45）')
ok(/checkProxyCompatOffer/.test(CLIENT_SRC) && /s\.waterLevelProxyCompatDetected !== true\) return/.test(CLIENT_SRC), 'D14 弹窗只在 detected=true 时打开')

console.log('')
console.log((fail === 0 ? 'PASS ' : 'FAIL ') + pass + ' / FAIL ' + fail)
process.exit(fail === 0 ? 0 : 1)
