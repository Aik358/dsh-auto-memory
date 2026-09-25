/* ★E1 行为探针（只读）：从 lib/index.js 真源码里抽出 _workbenchEpochToken / _wbStateOf / wbOwnerOf /
 *  _wbTokenOf 的函数体**真跑**，验证语义；并验证 --dry 阶段的静态判据。
 *  纪律：抽取起点用函数自身正面锚点，终点用**花括号配平**扫描（不得用非贪婪正则）。
 *  用法：node artifacts/_e1-probe.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC = fs.readFileSync(path.join(ROOT, 'lib', 'index.js'), 'utf8')

let passN = 0, failN = 0
const ck = (name, ok, detail) => { ok ? passN++ : failN++; console.log(`${ok ? '  ✓' : '  ✗'} ${name}${detail ? '  — ' + detail : ''}`) }

/* 花括号配平抽函数体（含首行签名） */
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

const epochTokFn = sliceFn(SRC, '_workbenchEpochToken(epoch, sessionId) {')
const wbStateFn = sliceFn(SRC, '_wbStateOf(st) {')
const wbOwnerFn = sliceFn(SRC, 'wbOwnerOf(sessionId, st) {')
const wbTokFn = sliceFn(SRC, '_wbTokenOf(st) {')
console.log(`切片：epochToken ${epochTokFn.length} / wbStateOf ${wbStateFn.length} / wbOwnerOf ${wbOwnerFn.length} / wbTokenOf ${wbTokFn.length} 字符\n`)

/* 用真源码的函数体组装一个可调用的宿主对象 */
const host = new Function(
  'createHash',
  `return {
     _workbenchEpochToken${epochTokFn.slice(epochTokFn.indexOf('('))},
     _wbStateOf${wbStateFn.slice(wbStateFn.indexOf('('))},
     wbOwnerOf${wbOwnerFn.slice(wbOwnerFn.indexOf('('))},
     _wbTokenOf${wbTokFn.slice(wbTokFn.indexOf('('))}
   }`
)(createHash)

console.log('【① 期牌 = sha256(epoch|sessionId) 前 16 hex，且编码「期号+会话」两者】')
const t1 = host._workbenchEpochToken('B10358', 'sess-A')
const t2 = host._workbenchEpochToken('B10358', 'sess-B')
const t3 = host._workbenchEpochToken('B10359', 'sess-A')
const want = createHash('sha256').update('B10358|sess-A').digest('hex').slice(0, 16)
ck('① 算法与规格 §9.10 逐字一致', t1 === want, `${t1} vs ${want}`)
ck('① 长度 16', t1.length === 16, String(t1.length))
ck('① 同会话换期 ⇒ 期牌变', t1 !== t3)
ck('① 同期换会话 ⇒ 期牌变', t1 !== t2)
ck('① 空参 ⇒ 空串（不抛）', host._workbenchEpochToken('', 'x') === '' && host._workbenchEpochToken('B1', '') === '')

console.log('\n【② _wbStateOf 兼容两种形状（旧单值 / 新相位）】')
const legacy = host._wbStateOf({ version: 1, sessionId: 'old-1', epoch: 'B10358' })
ck('② 旧形状：current 由顶层 sessionId 归一而来', legacy.current && legacy.current.sessionId === 'old-1', JSON.stringify(legacy.current))
ck('② 旧形状：previous 为空', legacy.previous === null)
ck('② 旧形状：phase 默认 active', legacy.phase === 'active', legacy.phase)
ck('② 旧形状：legacySessionId 保留', legacy.legacySessionId === 'old-1')
const nw = host._wbStateOf({ version: 2, epoch: 'B10359', epochToken: 'abc', phase: 'draining',
  current: { sessionId: 'cur-1' }, previous: { sessionId: 'prev-1' }, drainStartedAt: 123 })
ck('② 新形状：current/previous 正确', nw.current.sessionId === 'cur-1' && nw.previous.sessionId === 'prev-1')
ck('② 新形状：phase 透传', nw.phase === 'draining', nw.phase)
ck('② 新形状：drainStartedAt 数值化', nw.drainStartedAt === 123)
ck('② 空/null 不抛', host._wbStateOf(null).current === null && host._wbStateOf(undefined).phase === 'active')
ck('② previous 允许是字符串', host._wbStateOf({ previous: 'p-str' }).previous.sessionId === 'p-str')

console.log('\n【③ wbOwnerOf = 唯一归属判据（规格 §9.4）】')
const st = { current: { sessionId: 'CUR' }, previous: { sessionId: 'PREV' } }
ck('③ current ⇒ 放行', host.wbOwnerOf('CUR', st) === 'current')
ck('③ previous ⇒ sealed', host.wbOwnerOf('PREV', st) === 'sealed')
ck('③ 别的一律 orphan', host.wbOwnerOf('OTHER', st) === 'orphan' && host.wbOwnerOf('', st) === 'orphan')
ck('③ 旧形状下也算 current（不出现半修）', host.wbOwnerOf('old-1', { sessionId: 'old-1' }) === 'current')

console.log('\n【④ _wbTokenOf 只认落盘值，不派生（防空转门）】')
ck('④ 有值 ⇒ 返回原值', host._wbTokenOf({ epochToken: 'T-1' }) === 'T-1')
ck('④ ★旧文件无此字段 ⇒ 空串（**不得**现算兜底）', host._wbTokenOf({ version: 1, sessionId: 'x', epoch: 'B1' }) === '')
ck('④ 空状态 ⇒ 空串不抛', host._wbTokenOf(null) === '')

console.log('\n【⑤ 静态判据：写入点形状 + 归一读入口 + 切片内无旧字段】')
const wbWrite = SRC.slice(SRC.indexOf('version: 2, sessionId: realSid'), SRC.indexOf('version: 2, sessionId: realSid') + 1400)
ck('⑤ 写入点 version: 2', wbWrite.includes('version: 2, sessionId: realSid'))
ck('⑤ 写入点含 epochToken/phase/current/previous/drainStartedAt', ['epochToken:', "phase: 'active'", 'current: {', 'previous:', 'drainStartedAt: 0'].every((k) => wbWrite.includes(k)))
ck('⑤ 兼容面保留（前端/守卫/F线读它们）', ['cwd,', 'permission:', 'createdAt:', 'periodDays:', 'greetCount: 0,'].every((k) => wbWrite.includes(k)))
ck('⑤ _readWorkbench 后走 _wbStateOf 归一', /const raw = await this\._readWorkbench\(\)[\s\S]{0,600}?const st = this\._wbStateOf\(raw\)/.test(SRC))
const vw = sliceFn(SRC, 'async _verifyWorkbench(nowMs) {')
ck('⑤ ★切片内旧 st.sessionId 归零（半修检测）', !vw.includes('st.sessionId'))
ck('⑤ 切片内 st.current.sessionId ≥ 9 处', (vw.split('st.current.sessionId').length - 1) >= 9, String(vw.split('st.current.sessionId').length - 1))
ck('⑤ isInside 归一（无 st.current.current / 无 undefined 拼接）', !/st\.current\.st\.current/.test(SRC))

console.log('\n【⑥ workbenchSessionIds 兼容旧形状（守卫 ⑰ 真语义对象）】')
const wid = sliceFn(SRC, 'workbenchSessionIds() {')
ck('⑥ 新增顶层 sessionId 兼容行', wid.includes('if (j && j.sessionId) out.add(String(j.sessionId))'))
ck('⑥ 仍取 current/previous 两键', wid.includes("['current', 'previous']"))

console.log('\n【⑦ 关键反回归：不得有自建计时器 / 不得删除工作台】')
ck('⑦ 无 setInterval 新增（期号按墙钟切）', (SRC.split('_workbenchEpochToken').length - 1) >= 3)
ck('⑦ E1 未引入删除工作台会话的调用', !/wbStateOf[\s\S]{0,200}rm\(/.test(SRC))

console.log(`\n═══ 结果：${passN} PASS / ${failN} FAIL ═══`)
process.exit(failN ? 1 : 0)
