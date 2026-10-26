/**
 * smoke-test-v4-percept-onecall.mjs
 *
 * ★★2026-10-26（用户裁定「一次调用写完全部」）验收套件。
 *
 * 背景（实测）：白板事件卡的四类感知（userPercept/agentTrace/sharedGround/commitments）
 * 在真实数据里长期是 0 —— 不是渲染坏了，是**写入链路没传**：
 *   event-store.append() 早就支持 4 类，且与 checkpoint 在同一个 mutatePre 事务；
 *   但 appendHandoffCheckpointPre 只传了 { checkpoint }，memory_note 也没有 4 个参数。
 * 修法：memory_note 加 4 个可选参数 → appendHandoffCheckpointPre 透传 → eventStorePre.append。
 *
 * 本套件判据（全部真调，不静态断言）：
 *  A. 四段 + 四感知一次调用全部落盘（真写盘后读回）
 *  B. 原子性：同一次 append 里 sections 与 4 类感知都能读到
 *  C. 负路径：不传 ⇒ 全 0（证明参数真起作用，判据非恒真）
 *  D. 负路径：只传 1 类 ⇒ 不串道
 *  E. 负路径：非法 stage ⇒ 明确报错（不是静默接受）
 *  F. 向后兼容：旧调用点（只 ledgerText）不报错
 *  G. 元断言：memory_note schema 里 4 个参数都在（防回退）
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = 'D:/dsh-auto-memory'
let pass = 0, fail = 0
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  ok   - ' + name + (extra ? ' :: ' + extra : '')) }
  else { fail++; console.log('  FAIL - ' + name + (extra ? ' :: ' + extra : '')) }
}

const EW = await import(pathToFileURL(path.join(ROOT, 'lib', 'event-write.js')).href)
const ES = await import(pathToFileURL(path.join(ROOT, 'lib', 'event-store.js')).href)

const LEDGER = [
  '# 交接账本 · 测试', '',
  '## 任务状态', '<!-- type=state -->', '- 进行中',
  '## 目标', '<!-- type=goal -->', '- 验证一次写全部',
  '## 已试方案与失败原因', '<!-- type=dead-end -->', '- 无',
  '## 进度与下一步', '<!-- type=progress -->', '- 收口',
].join('\n')

const tmp = fs.mkdtempSync(path.join(ROOT, 'artifacts', '_perc-smoke-'))
const mk = async (name) => {
  const p = path.join(tmp, name + '.json')
  await ES.eventStorePre.create(p, { name: 'E-' + name })
  return p
}
const readEv = (p) => JSON.parse(fs.readFileSync(p, 'utf8')).events[0]

console.log('== A. 四段 + 四感知 一次调用全部落盘 ==')
{
  const store = await mk('a')
  const r = await EW.appendHandoffCheckpointPre(store, {
    ledgerText: LEDGER,
    userPercept: { stage: 'accepted', kind: 'preference', text: '用户要求一次调用写完全部' },
    agentTrace: { action: '加感知参数', result: '落盘成功' },
    sharedGround: { claim: '四段与四感知同事务', confirmedBy: 'user' },
    commitment: { promise: '一次调用写完全部', boundary: 'handoff 路径', state: 'open' },
  })
  ok(r && r.ok === true, 'A-1 append 返回 ok', JSON.stringify(r && r.eventId))
  const ev = readEv(store)
  ok(ev.userPercept.length === 1, 'A-2 userPercept 落盘 1 条', 'n=' + ev.userPercept.length)
  ok(ev.agentTrace.length === 1, 'A-3 agentTrace 落盘 1 条', 'n=' + ev.agentTrace.length)
  ok(ev.sharedGround.length === 1, 'A-4 sharedGround 落盘 1 条', 'n=' + ev.sharedGround.length)
  ok(ev.commitments.length === 1, 'A-5 commitments 落盘 1 条', 'n=' + ev.commitments.length)
  ok(ev.userPercept[0].stage === 'accepted' && ev.userPercept[0].kind === 'preference',
    'A-6 userPercept 字段保真', JSON.stringify(ev.userPercept[0]))
}

console.log('')
console.log('== B. 原子性：四段与四感知同一次 append ==')
{
  const store = await mk('b')
  const before = readEv(store)
  const cpBefore = before.checkpoints.length, upBefore = before.userPercept.length
  await EW.appendHandoffCheckpointPre(store, {
    ledgerText: LEDGER,
    userPercept: { stage: 'used', kind: 'state', text: 'B 用例' },
    commitment: { promise: 'B 用例承诺' },
  })
  const ev = readEv(store)
  ok(ev.checkpoints.length === cpBefore + 1, 'B-1 检查点 +1', cpBefore + '→' + ev.checkpoints.length)
  ok(ev.userPercept.length === upBefore + 1, 'B-2 userPercept 与检查点同批落盘', upBefore + '→' + ev.userPercept.length)
  ok(ev.commitments.length === 1, 'B-3 commitments 同批落盘')
}

console.log('')
console.log('== C. 负路径：不传感知 ⇒ 四类必须全 0（判据非恒真）==')
{
  const store = await mk('c')
  await EW.appendHandoffCheckpointPre(store, { ledgerText: LEDGER })
  const ev = readEv(store)
  const counts = [ev.userPercept.length, ev.agentTrace.length, ev.sharedGround.length, ev.commitments.length]
  ok(counts.every((n) => n === 0), 'C-1 不传 ⇒ 四类全 0（证明参数真起作用）', counts.join(','))
}

console.log('')
console.log('== D. 负路径：只传 1 类 ⇒ 不串道 ==')
{
  const store = await mk('d')
  await EW.appendHandoffCheckpointPre(store, { ledgerText: LEDGER, commitment: { promise: '只传承诺' } })
  const ev = readEv(store)
  ok(ev.userPercept.length === 0 && ev.agentTrace.length === 0 && ev.sharedGround.length === 0 && ev.commitments.length === 1,
    'D-1 只有 commitments=1，其余 0', [ev.userPercept.length, ev.agentTrace.length, ev.sharedGround.length, ev.commitments.length].join(','))
}

console.log('')
console.log('== E. 负路径：非法 stage ⇒ 明确报错 ==')
{
  const store = await mk('e')
  let threw = null
  try { await EW.appendHandoffCheckpointPre(store, { ledgerText: LEDGER, userPercept: { stage: 'bogus', text: 'x' } }) }
  catch (e) { threw = String(e.message) }
  ok(threw !== null && /stage/i.test(threw), 'E-1 非法 stage 被拒（非静默）', threw ? threw.slice(0, 60) : '未抛错')
}

console.log('')
console.log('== F. 向后兼容：旧调用点不报错 ==')
{
  const store = await mk('f')
  const r = await EW.appendHandoffCheckpointPre(store, { ledgerText: LEDGER, kind: 'plan' })
  ok(r && r.ok === true, 'F-1 旧形态（只 ledgerText + kind）仍工作', r && r.eventId)
}

console.log('')
console.log('== G. 元断言：工具 schema 与透传都在（防回退）==')
{
  const idx = fs.readFileSync(path.join(ROOT, 'lib', 'index.js'), 'utf8')
  const ew = fs.readFileSync(path.join(ROOT, 'lib', 'event-write.js'), 'utf8')
  // ★必须锚在 defineTool('memory_note' —— 只找 'memory_note' 会命中描述文本里的引用（实测踩过）
  const iNote = idx.indexOf("defineTool('memory_note'")
  if (iNote < 0) { ok(false, 'G-1 找不到 defineTool(memory_note) 定义'); }
  const noteSeg = iNote >= 0 ? idx.slice(iNote, idx.indexOf("defineTool('", iNote + 20)) : ''
  for (const k of ['userPercept', 'agentTrace', 'sharedGround', 'commitment']) {
    ok(noteSeg.indexOf(k + ':') >= 0, 'G-1 memory_note schema 含 ' + k)
  }
  ok(/for \(const k of \['userPercept', 'agentTrace', 'sharedGround', 'commitment'\]\)/.test(ew),
    'G-2 appendHandoffCheckpointPre 有透传循环')
  ok(/\.\.\.perceptArgs/.test(ew), 'G-3 透传参数真的 spread 进 eventStorePre.append')
}

fs.rmSync(tmp, { recursive: true, force: true })
console.log('')
console.log('SUMMARY  PASS ' + pass + ' / FAIL ' + fail)
process.exit(fail === 0 ? 0 : 1)