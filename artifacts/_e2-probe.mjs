/* ★E2 行为探针（只读真源码 + 临时 DSH_HOME，真实调函数）：证明归属门四条判据都成立，且**负路径真的会拒**。
 *  这是「恒真守卫」的解药 —— 只断言源码文本包含 wbOwnerOf 是不够的，必须让**旧期**真的被拒。
 *  切函数体的纪律（E1-fix 的教训）：
 *    ① 函数体含 await ⇒ 必须用 AsyncFunction 构造器；
 *    ② 直接拿**完整函数文本**当对象方法简写，绝不用 fn.slice(indexOf('(')) 切签名（会剥掉 async）；
 *    ③ AsyncFunction 调用返回 Promise ⇒ 必须 await。
 *  用法：node artifacts/_e2-probe.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC = fs.readFileSync(path.join(ROOT, 'lib', 'index.js'), 'utf8')

let pass = 0, fail = 0
const ck = (name, ok, detail) => { ok ? pass++ : fail++; console.log(`${ok ? '  ✓' : '  ✗'} ${name}${detail ? '  — ' + detail : ''}`) }

function sliceFn(text, signature) {
  const start = text.indexOf(signature)
  if (start < 0) throw new Error('找不到 ' + signature)
  const open = text.indexOf('{', start)
  let d = 0
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') d++
    else if (text[i] === '}') { d--; if (d === 0) return text.slice(start, i + 1) }
  }
  throw new Error('花括号未配平 ' + signature)
}
/** 切片 → 包成对象方法简写：保留 async 关键字（起始锚点含 `async`）。 */
const asMethod = (src, sig) => sliceFn(src, sig)

const tokFn = asMethod(SRC, '_workbenchEpoch(nowMs) {')
const tokOfFn = asMethod(SRC, '_workbenchEpochToken(epoch, sessionId) {')
const stFn = asMethod(SRC, '_wbStateOf(st) {')
const ownerFn = asMethod(SRC, 'wbOwnerOf(sessionId, st) {')
const wbTokenFn = asMethod(SRC, '_wbTokenOf(st) {')
const wrFn = asMethod(SRC, 'async _writeWorkbench(st) {')
const rdFn = asMethod(SRC, 'async _readWorkbench() {')
console.log(`切片：epoch ${tokFn.length} / token ${tokOfFn.length} / state ${stFn.length} / owner ${ownerFn.length} / tokenOf ${wbTokenFn.length} / write ${wrFn.length} / read ${rdFn.length} 字符\n`)

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'dam-e2-'))
fs.mkdirSync(path.join(TMP, 'memory'), { recursive: true })

const diagLog = []
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
// ★2026-09-26：`_writeWorkbench` 已改为调用**裸标识符** `writeTextAtomicPre(...)`（源码里是同模块顶层 import）。
//   抽真源码真跑时该依赖**必须作为 AsyncFunction 的形参注入** —— 塞进 `return {…}` 对象属性无效（裸名不去对象里找），
//   缺它会抛 ReferenceError 被 _writeWorkbench 自身 catch 吞掉 ⇒ 写盘从未发生 ⇒ 后续 _readWorkbench 得 null ⇒ 探针崩。
//   （本轮实测：_e1fix-probe 与 _e2-probe 都因此假红/崩，源码本身无回归。）
const host = await new AsyncFunction('createHash', 'fs', 'path', 'diag', 'dshHome', 'writeTextAtomicPre', [
  'return {',
  '  ' + tokFn + ',',
  '  ' + tokOfFn + ',',
  '  ' + stFn + ',',
  '  ' + ownerFn + ',',
  '  ' + wbTokenFn + ',',
  '  ' + wrFn + ',',
  '  ' + rdFn + ',',
  '  _workbenchPeriodDays() { return 2 },',
  "  _workbenchFile() { return path.join(dshHome(), 'memory', 'workbench.json') },",
  "  async readTextSafe(f) { try { return fs.readFileSync(f, 'utf8') } catch (e) { return '' } }",
  '}',
].join('\n'))(
  createHash, fs, path,
  (m) => diagLog.push(String(m)),
  () => TMP,
  // 与 config-io.js 同形的原子写（tmp 唯一段 + rename）
  async function writeTextAtomicPre(file, text) {
    const tmp = file + '.tmp-' + process.pid + '-' + (++writeTextAtomicPre._n || (writeTextAtomicPre._n = 1))
    try {
      await fs.promises.mkdir(path.dirname(file), { recursive: true })
      await fs.promises.writeFile(tmp, String(text), 'utf8')
      await fs.promises.rename(tmp, file)
      return { ok: true, path: file }
    } catch (e) {
      try { fs.rmSync(tmp, { force: true }) } catch (_) {}
      return { ok: false, error: String((e && e.message) || e) }
    }
  },
)

const WB = path.join(TMP, 'memory', 'workbench.json')
const SID_CUR = 'session-aaaa1111-2222-3333-4444-555566667777'
const SID_OLD = 'session-9999xxxx-8888-7777-6666-555544443333'
const SID_FOR = 'session-00001111-2222-3333-4444-555566667777'

/* 复刻 E2 门控的**判定逻辑**（与源码同构；源码文本一致性由下面的静态断言钉死）。 */
async function gate(sid) {
  const st = await host._readWorkbench()
  const owner = host.wbOwnerOf(sid, st)
  if (owner !== 'current') return { ok: false, why: 'owner=' + owner, owner }
  const tok = host._wbTokenOf(st)
  const now = host._workbenchEpochToken(host._workbenchEpoch(Date.now()), sid)
  if (tok && tok !== now) return { ok: false, why: 'epoch-token mismatch', owner }
  return { ok: true, why: 'pass', owner }
}

console.log('【① current（本期的写路径）⇒ 必须放行】')
const epochNow = host._workbenchEpoch(Date.now())
await host._writeWorkbench({ version: 2, epoch: epochNow, sessionId: SID_CUR, cwd: TMP, permission: 'danger-full-access', createdAt: new Date().toISOString(), periodDays: 2, greetCount: 0 })
let r = await gate(SID_CUR)
ck('① 本期会话放行', r.ok === true, r.why)
ck('① 期牌已落盘（迁移后收敛）', !!host._wbTokenOf(await host._readWorkbench()))

console.log('\n【② 旧期会话（previous / sealed）⇒ 必须拒绝】')
let st = await host._readWorkbench()
st.previous = { sessionId: SID_OLD, sealedAt: new Date().toISOString() }
st.current = { sessionId: SID_CUR, openedAt: new Date().toISOString() }
await host._writeWorkbench(st)
r = await gate(SID_OLD)
ck('② sealed 被拒', r.ok === false && r.owner === 'sealed', r.why)

console.log('\n【③ 无关会话（orphan）⇒ 必须拒绝】')
r = await gate(SID_FOR)
ck('③ orphan 被拒', r.ok === false && r.owner === 'orphan', r.why)

console.log('\n【④ 期牌错位（同一 current，但落盘期牌属另一期）⇒ 必须拒绝】')
st = await host._readWorkbench()
st.current = { sessionId: SID_CUR, openedAt: new Date().toISOString() }
st.previous = null
st.epochToken = 'deadbeefdeadbeef' // 伪造：属旧期
await host._writeWorkbench(st)
r = await gate(SID_CUR)
ck('④ 期牌不符被拒（本期的会话也拦得住）', r.ok === false && r.why === 'epoch-token mismatch', r.why + ' / token=' + host._wbTokenOf(await host._readWorkbench()))

console.log('\n【⑤ 迁移态：落盘期牌为空 ⇒ 必须放行（否则死锁：门拒 ⇒ 不写盘 ⇒ 期牌永远补不上）】')
fs.writeFileSync(WB, JSON.stringify({ version: 1, sessionId: SID_CUR, epoch: epochNow, cwd: TMP, createdAt: new Date().toISOString(), periodDays: 2 }, null, 2), 'utf8')
st = await host._readWorkbench()
ck('⑤ 旧形状（v1 无期牌）时 token 为空', host._wbTokenOf(st) === '', JSON.stringify(host._wbTokenOf(st)))
r = await gate(SID_CUR)
ck('⑤ 空期牌 ⇒ 放行（迁移态）', r.ok === true, r.why)
await host._writeWorkbench(st)
ck('⑤ 放行后经唯一写入口补上期牌（下一单即受门保护）', host._wbTokenOf(await host._readWorkbench()) !== '')

console.log('\n【⑥ 真源码静态判据：门确实接在六个写路径的汇聚点（runSubagent）上】')
const runSub = sliceFn(SRC, 'async runSubagent(text, label, agent, timeoutMs) {')
ck('⑥ runSubagent 内含归属门', runSub.includes('wbOwnerOf(') && runSub.includes('_wbTokenOf('))
ck('⑥ 门只对六个写路径生效（白名单常量）', SRC.includes("const WB_GATED_JOBS = ['greet', 'fold', 'summarize', 'consolidate', 'consolidate-logs', 'distill']"))
ck('⑥ 门内拒绝对 owner 非 current', /_wbGateOwner\s*!==\s*'current'/.test(runSub))
ck('⑥ 门内拒绝期牌不符', /_wbGateToken\s*!==\s*_wbGateNow/.test(runSub))
ck('⑥ 只在 WB_GATED_JOBS 命中时才过门', runSub.includes('WB_GATED_JOBS.indexOf(job) >= 0'))
ck('⑥ 门异常时 fail-open（不停摆全部记忆功能）', runSub.includes('ownership gate error (fail-open)'))
/* 调用点计数：runSubagent 共 9 处；其中写路径用 `prompt` 变量（7 处），
 * smart-kw/smart-ans 用 kwPrompt/ansPrompt（2 处，非写路径、不过门）。 */
const sitesAll = (SRC.match(/this\.runSubagent\(/g) || []).length
const sitesPrompt = (SRC.match(/runSubagent\(prompt, 'auto-memory-/g) || []).length
ck('⑥ runSubagent 调用点总数 = 9（门在其内部，未增删调用点）', sitesAll === 9, 'total=' + sitesAll)
ck('⑥ 写路径型调用点 = 7', sitesPrompt === 7, 'prompt 型=' + sitesPrompt)

try { fs.rmSync(TMP, { recursive: true, force: true }) } catch (e) {}
console.log(`\n═══ 结果：${pass} PASS / ${fail} FAIL ═══`)
console.log('（临时目录已清理，真实 ~/.dsh 零接触；diag 条数=' + diagLog.length + '）')
process.exit(fail ? 1 : 0)
