// issue#349 验收:同会话切换模型/provider/contextWindow/maxTokens 后,窗口缓存必须立即失效。
//
// 缺陷(修复前):reusableWindowCachePre(cached, sid, eventsLen, now, ttlMs) 只比 sid + TTL,
// 不比对 model/provider/contextWindow/maxTokens ⇒ 同会话换模型后仍沿用**旧模型**的窗口:
//   ① 大窗口→小窗口:分母偏大 ⇒ 水位被系统性低估,该触发接续时不触发;
//   ② 同模型改预留(maxTokens):硬墙判据 estTokens + reserve > triggerWin 用错预留。
//
// 本套件是**功能验收**:
//   - 真 import sessionModelSigPre / reusableWindowCachePre 并断言返回值;
//   - **完整 MemoryEngine.checkWaterLevel 真调用**(用 grab 从 lib/index.js 抽取真实方法体执行,
//     与仓内 smoke-test-handoff / smoke-test-switch-decouple 同法,非源码字符串断言);
//   - 源码字符串只用于**接线守卫**,并单列标注(不充当功能证据)。
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
process.on('uncaughtException', (e) => { console.error('[i349] FATAL:', (e && e.stack || e.message) || e); process.exit(1) })
process.on('unhandledRejection', (r) => { console.error('[i349] REJ:', r); process.exit(1) })

const HERE = path.dirname(fileURLToPath(import.meta.url))
const INDEX_PATH = path.resolve(HERE, '..', '..', 'lib', 'index.js')
const INDEX_SRC = readFileSync(INDEX_PATH, 'utf8')
const WW = await import('../../lib/water-window.js')
const { sessionModelSigPre, reusableWindowCachePre, findSessionModelPre, parseModelWindowsPre, pickWindowPre, scanPressureSignalsPre, findOfficialContextWindowPre } = WW

let pass = 0; let fail = 0
const ok = (cond, name) => { if (cond) { pass++; console.log('  ok - ' + name) } else { fail++; console.error('  FAIL - ' + name) } }
const eq = (a, b, name) => ok(JSON.stringify(a) === JSON.stringify(b), name + (JSON.stringify(a) === JSON.stringify(b) ? '' : ' got=' + JSON.stringify(a) + ' want=' + JSON.stringify(b)))
const NUL = String.fromCharCode(0)
const NL = String.fromCharCode(10)

// 从 lib/index.js 抽取真实方法体并真执行(花括号配平 + 跳过字符串字面量)。
function grab(src, head) {
  const i = src.indexOf(head)
  if (i < 0) throw new Error('missing: ' + head)
  let d = 0, started = false
  for (let j = i; j < src.length; j++) {
    const c = src[j]
    if (c === '{') { d++; started = true; continue }
    if (c === '}') { d--; if (started && d === 0) return src.slice(i, j + 1); continue }
    if (c === String.fromCharCode(39) || c === '"' || c === String.fromCharCode(96)) {
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
// 方法简写 → 具名函数表达式(否则 new Function(body) 报 Unexpected token '{')
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

const tmpRoot = mkdtempSync(path.join(tmpdir(), 'dam-i349-'))
process.on('exit', () => { try { rmSync(tmpRoot, { recursive: true, force: true }) } catch (_) {} })
const fakeHome = path.join(tmpRoot, 'home')
mkdirSync(fakeHome, { recursive: true })

// ── [A] 纯函数:签名覆盖 4 项,任一变化即变 ────────────────────────────────
console.log('[349-A] sessionModelSigPre 覆盖 provider/model/contextWindow/maxTokens')
const base = { provider: 'p1', model: 'm1', contextWindow: 1000000, maxTokens: 384000 }
const sigOf = (o) => sessionModelSigPre(Object.assign({}, base, o))
ok(sigOf({}) === sigOf({}), '同参签名稳定(可复算)')
ok(sigOf({ provider: 'p2' }) !== sigOf({}), '★provider 变化 ⇒ 签名变化')
ok(sigOf({ model: 'm2' }) !== sigOf({}), '★model 变化 ⇒ 签名变化')
ok(sigOf({ contextWindow: 262144 }) !== sigOf({}), '★contextWindow 变化 ⇒ 签名变化')
ok(sigOf({ maxTokens: 4096 }) !== sigOf({}), '★maxTokens 变化 ⇒ 签名变化')
ok(sigOf({ contextWindow: 0 }) === sessionModelSigPre({ provider: 'p1', model: 'm1', contextWindow: 0, maxTokens: 384000 }), 'contextWindow=0 与缺省同为「未知」口径')
ok(sessionModelSigPre(null) === '' && sessionModelSigPre(undefined) === '', '负路径:null/undefined 返回确定空串')
ok(sessionModelSigPre({ provider: '', model: '', contextWindow: 0, maxTokens: 0 }) !== '', '全空模型仍是确定签名(不等于 null 签名)')
ok(sessionModelSigPre({ provider: 'a|b', model: 'c' }) !== sessionModelSigPre({ provider: 'a', model: 'b|c' }), '★负路径:含分隔符内容无跨字段碰撞(编码为单射)')
ok(sessionModelSigPre({ provider: 'a', model: '' }) !== sessionModelSigPre({ provider: 'a', model: NUL }), '负路径:空串与含 NUL 值可区分')

// ── [B] 纯函数:复用判定的三组场景 + 缺省语义 ───────────────────────────────
console.log('[349-B] reusableWindowCachePre:模型签名参与判定')
const t0 = 5000000
const mkCache = (over) => Object.assign({ sid: 's1', at: t0, info: { provider: 'p1', model: 'm1', contextWindow: 1000000, maxTokens: 384000 }, events: 13 }, over)
const SIG_BIG = sessionModelSigPre({ provider: 'p1', model: 'm1', contextWindow: 1000000, maxTokens: 384000 })
const SIG_SMALL = sessionModelSigPre({ provider: 'p1', model: 'm2', contextWindow: 262144, maxTokens: 4096 })
const SIG_PLUS = sessionModelSigPre({ provider: 'p1', model: 'm1', contextWindow: 1000000, maxTokens: 4096 })
ok(reusableWindowCachePre(mkCache({ modelSig: SIG_BIG }), 's1', 13, t0 + 1000, 300000, SIG_BIG) === true, '场景1 同模型 → 复用')
ok(reusableWindowCachePre(mkCache({ modelSig: SIG_BIG }), 's1', 13, t0 + 1000, 300000, SIG_SMALL) === false, '★场景1 大窗口→小窗口,同会话 → 缓存必须失效')
ok(reusableWindowCachePre(mkCache({ modelSig: SIG_BIG }), 's1', 13, t0 + 1000, 300000, SIG_PLUS) === false, '★场景2 同模型改预留 → 缓存必须失效')
ok(reusableWindowCachePre(mkCache({ modelSig: SIG_BIG }), 's2', 13, t0 + 1000, 300000, SIG_BIG) === false, '场景3 不同会话 → 不复用')
const EMPTY_INFO = { provider: 'p1', model: 'm1', contextWindow: 0, maxTokens: 384000 }
ok(reusableWindowCachePre(mkCache({ info: EMPTY_INFO }), 's1', 13, t0 + 1000) === true, '★缺省(undefined)保持旧语义:空结果+事件数未变 ⇒ 复用')
ok(reusableWindowCachePre(mkCache({ info: EMPTY_INFO }), 's1', 14, t0 + 1000) === false, '★缺省(undefined)保持旧语义:空结果+事件数增长 ⇒ 不复用')
ok(reusableWindowCachePre(mkCache({ info: { provider: '', model: '', contextWindow: 0 } }), 's1', 13, t0 + 1000) === true, '★缺省(undefined)老缓存对象(无 modelSig)照旧复用')
ok(reusableWindowCachePre(mkCache(), 's1', 13, t0 + 1000, 300000, SIG_BIG) === false, '负路径:传签名 + 旧缓存缺 modelSig ⇒ 不复用(安全降级)')
ok(reusableWindowCachePre(null, 's1', 13, t0 + 1000, 300000, SIG_BIG) === false, '负路径:无缓存 ⇒ 不复用')
ok(reusableWindowCachePre(mkCache({ modelSig: SIG_BIG }), 's1', 13, t0 + 300001, 300000, SIG_BIG) === false, '负路径:超 TTL ⇒ 不复用(即便签名一致)')

// ── [C] 完整 MemoryEngine.checkWaterLevel 真调用 ─────────────────────────
console.log('[349-C] 完整 checkWaterLevel 真调用(真实方法体 + 真实缓存状态)')
const waterDeps = { parseModelWindowsPre, pickWindowPre }
const makeFake = (config) => {
  const rt = { disposed: false }
  return {
    config, state: {}, _rt: rt,
    runtimeFor: () => rt,
    diag: () => {},
    writeHandoffLedger: async () => ({ ok: true }),
    rememberWaterRecord: function (sid, rec) { if (!this._waterRecords) this._waterRecords = {}; if (sid) this._waterRecords[sid] = rec },
    _officialParamsPre: () => ({ ratio: 0.8, headroomTokens: 65536, source: 'test-injected' }),
    _resolveWaterLevelPre: (W, O) => {
      const w = Number(W) || 0, o = Math.max(0, Number(O) || 0)
      const fixed = Number(config.waterLevelThreshold) || 0.75
      const officialRatio = Math.min(0.8, ((w - o) - 65536) / w)
      if (!(officialRatio > 0)) return { mode: 'fixed', threshold: fixed, officialRatio: 0, officialTokens: 0, margin: 0, source: 'test-fallback' }
      return { mode: 'auto', threshold: Math.min(Math.max(officialRatio * 0.9, 0.1), 0.95), officialRatio, officialTokens: Math.floor(officialRatio * w), margin: 0.9, source: 'test-injected' }
    },
  }
}
const wlBind = (fake) => {
  fake.estimateSessionTokens = bindMethod('estimateSessionTokens(messages) {', fake, {})
  fake.resolveWaterWindow = bindMethod("async resolveWaterWindow(providerOverride = '', modelOverride = '') {", fake, Object.assign({ dshHome: () => fakeHome }, waterDeps))
  const sessionEventsOfFn = new Function(grab(INDEX_SRC, 'function sessionEventsOf(session) {') + NL + 'return sessionEventsOf;')()
  return bindMethod('async checkWaterLevel(agent) {', fake, {
    extractSessionMessages: (a) => a.messages, diag: () => {}, reflectionDigest: () => '',
    truncateHead: (s) => s, sessionEventsOf: sessionEventsOfFn,
    findOfficialContextWindowPre, findSessionModelPre, scanPressureSignalsPre,
    reusableWindowCachePre, sessionModelSigPre,
  })
}
writeFileSync(path.join(fakeHome, 'settings.yaml'), [
  'llm-x:',
  '  models:',
  '    - id: big-model',
  '      contextWindow: 1000000',
  '    - id: small-model',
  '      contextWindow: 262144',
].join(NL), 'utf8')
const agentWith = (model, cw, texts) => ({
  session: {
    id: 'session-349',
    events: [{ type: 'request/context', seq: 1, data: { contextWindow: cw, header: { config: { provider: 'llm-x', model, maxTokens: 1000 } } } }],
  },
  messages: texts.map((t) => ({ text: t })),
})
const MSG = 'x'.repeat(240000)
const fake = makeFake({ handoffEnabled: false })
const wl = wlBind(fake)
await wl(agentWith('big-model', 1000000, [MSG]))
const ratio1 = Number(fake.state.waterLevelRatio || 0)
const cache1 = fake._officialWindowCache
ok(!!cache1 && cache1.sid === 'session-349', '第 1 次测量写入了会话窗口缓存')
ok(typeof cache1.modelSig === 'string' && cache1.modelSig.length > 0, '缓存带 modelSig 字段(实测 ' + cache1.modelSig + ')')
eq(cache1.modelSig, sessionModelSigPre({ provider: 'llm-x', model: 'big-model', contextWindow: 1000000, maxTokens: 1000 }), '缓存签名 == 当前事件算出的签名')
ok(ratio1 > 0 && ratio1 < 0.15, '第 1 次(1M 窗口)水位很低(实测 ' + ratio1.toFixed(4) + ')')
await wl(agentWith('small-model', 262144, [MSG]))
const ratio2 = Number(fake.state.waterLevelRatio || 0)
const cache2 = fake._officialWindowCache
console.log('    同会话 ratio(1M)=' + ratio1.toFixed(4) + ' → ratio(262144)=' + ratio2.toFixed(4))
ok(ratio2 > ratio1 * 2, '★同会话换小模型后水位显著抬升(' + ratio1.toFixed(4) + ' → ' + ratio2.toFixed(4) + ')')
ok(cache2.modelSig !== cache1.modelSig, '★缓存已被重写为新模型签名')
await wl(agentWith('big-model', 1000000, [MSG]))
const ratio3 = Number(fake.state.waterLevelRatio || 0)
ok(Math.abs(ratio3 - ratio1) < 1e-6, '★切回大模型后水位回到与首次一致(实测 ' + ratio3.toFixed(4) + ' ≈ ' + ratio1.toFixed(4) + ')')

// ── [D] 接线守卫(源码字符串,仅守卫,不充当功能证据)────────────────────────
console.log('[349-D] 接线守卫(守卫,非功能证据)')
const REUSE_CALL = 'reusableWindowCachePre(cached, sid, eventsForModel.length, Date.now(), undefined, modelSrcSig)'
ok(INDEX_SRC.includes('sessionModelSigPre') && INDEX_SRC.includes("from './water-window.js'"), '宿主已导入 sessionModelSigPre')
ok(INDEX_SRC.includes(REUSE_CALL), '调用点传入当前签名')
ok(INDEX_SRC.includes('const modelSrcSig = sessionModelSigPre(authModel)') && INDEX_SRC.includes('sessModel = authModel'), '判定与写入共用同一签名变量')
ok(INDEX_SRC.includes('modelSig: modelSrcSig'), '缓存写入带 modelSig')
const NO_CALL = INDEX_SRC.replace('if (' + REUSE_CALL + ') {', 'if (false) {')
ok(NO_CALL !== INDEX_SRC && !NO_CALL.includes(REUSE_CALL), '负路径:删掉宿主调用后守卫失配(证明不是恒真守卫)')

console.log(NL + '[i349] ' + pass + ' passed, ' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)
