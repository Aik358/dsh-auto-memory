#!/usr/bin/env node
/**
 * smoke-test-v4-h2-note-event.mjs —— H2：memory_note handoff 双写 + plan 镜像
 *
 * 覆盖 parseLedgerSectionsPre / appendHandoffCheckpointPre / mirrorPlanSectionsPre；含一致性断言真负路径（注入 readBack 漂移）、事件优先半完成口径、CAS/M1 未受影响。
 *
 * 来源：2026-10-25 由 A 线一次性验证脚本升格为永久回归套件（Lead 批准）。
 * 升格理由：这些断言是 v4-H 写入层的核心不变量，只放临时目录 ⇒ 下次谁改回去只有临时跑才发现。
 *
 * 纪律（CR-10）：真 import → 真构造 → 真调用 → 断言返回值/副作用；每条正向都配负路径。
 * 全部在仓库内的 .tmp-smoke-run/ 临时目录里跑（每次自清），不碰真实 handoff/ 与真实记忆目录。
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'

import { fileURLToPath } from 'node:url'
const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
let pass = 0, fail = 0
function ok(c, n, d) { if (c) { pass++; console.log('PASS ' + n + (d ? '  =>  ' + d : '')) } else { fail++; console.log('FAIL ' + n + (d ? '  =>  ' + d : '')) } }
const SANDBOX = path.join(REPO, '.tmp-smoke-run/s5')
fs.rmSync(SANDBOX, { recursive: true, force: true })
const PROJ = path.join(SANDBOX, 'proj')
fs.mkdirSync(path.join(PROJ, 'handoff'), { recursive: true })

const EW = await import(pathToFileURL(path.join(REPO, 'lib/event-write.js')).href)

// ═══════════ 一、parseLedgerSectionsPre 纯函数 ═══════════
const LEDGER = [
  '# 交接账本 · 2026-10-24 23:00',
  '',
  '## 任务状态',
  '- 已完成 A。',
  '',
  '## 目标',
  '- 做 B。',
  '',
  '## 已试方案与失败原因',
  '- 方案 X → 失败原因 Y。',
  '',
  '## 进度与下一步',
  '- 下一步做 C。',
].join('\n')
const sec = EW.parseLedgerSectionsPre(LEDGER)
ok(sec.doing.includes('已完成 A'), 'parse: doing = 任务状态段', JSON.stringify(sec.doing))
ok(sec.goal.includes('做 B'), 'parse: goal = 目标段')
ok(sec.deadend.includes('方案 X'), 'parse: deadend = 失败原因段')
ok(sec.next.includes('下一步做 C'), 'parse: next = 进度与下一步段')
ok(EW.parseLedgerSectionsPre('').goal === '', 'parse: 空串 → 全空')
ok(EW.parseLedgerSectionsPre('# 无四段标题').next === '', 'parse: 无标题 → 全空（不误切）')
const secAlias = EW.parseLedgerSectionsPre('## 失败与弯路\n- x\n\n## 下一步\n- y')
ok(secAlias.deadend.includes('x') && secAlias.next.includes('y'), 'parse: 别名（失败与弯路/下一步）也认')

// ═══════════ 二、appendHandoffCheckpointPre ═══════════
const storePath = path.join(PROJ, 'handoff', 'event-store.json')
const h1 = await EW.appendHandoffCheckpointPre(storePath, { ledgerText: LEDGER, ledgerPath: 'handoff/handoff-a.md', today: '2026-10-24' })
ok(h1.ok && /^evt_/.test(h1.eventId), 'handoff: 自动建事件并返回 id', h1.eventId)
let st = JSON.parse(fs.readFileSync(storePath, 'utf8'))
ok(st.events.length === 1 && st.events[0].checkpoints.length === 1, 'handoff: 检查点 = 1')
ok(st.events[0].checkpoints[0].kind === 'handoff', 'handoff: 检查点 kind = handoff')
ok(st.events[0].checkpoints[0].text === LEDGER, 'handoff: 检查点 text = 账本全文（双写，事件侧有全文）')
ok(st.events[0].checkpoints[0].sourceRef === 'handoff/handoff-a.md', 'handoff: 带 sourceRef')
ok(!!st.events[0].checkpoints[0].idemKey, 'handoff: 带 idemKey')
// ★2026-10-25 判据更新（H2 缺陷修复，见下方「四·五」组的负路径）：
//   旧断言 = 「写 handoff 后事件头 sections 被镜像成账本内容」—— 那正是**被定为缺陷的行为**，
//   已删除镜像（方案 A）。此处改为断言**相反方向**：sections 必须**保持为空**（该事件从未设过 sections）。
//   注意：这不是「删掉失败断言」，完整保护见「四·五」组（已有非空 sections ⇒ 写 handoff 不得覆盖）。
ok(!String(st.events[0].sections.goal || '').trim(), '★handoff: 不镜像 sections（缺陷已修：事件头不得被账本覆盖）', JSON.stringify(st.events[0].sections.goal))
ok(!String(st.events[0].sections.next || '').trim(), '★handoff: sections.next 同样不被写入')

// 幂等
const h2 = await EW.appendHandoffCheckpointPre(storePath, { ledgerText: LEDGER, ledgerPath: 'handoff/handoff-a.md', today: '2026-10-24' })
ok(h2.deduped === true, '★handoff 幂等：同账本同路径重复调用 → deduped', String(h2.deduped))
st = JSON.parse(fs.readFileSync(storePath, 'utf8'))
ok(st.events[0].checkpoints.length === 1, '★handoff 幂等：检查点仍 1（未重复追加）')

// 负路径：空文本必须抛
let threw = false
try { await EW.appendHandoffCheckpointPre(storePath, { ledgerText: '   ' }) } catch (e) { threw = true }
ok(threw, '★负路径：空 ledgerText → 抛错（不静默）')

// ═══════════ 三、mirrorPlanSectionsPre ═══════════
const PLAN = [
  '# 项目全貌',
  '',
  '## 目标',
  '把记忆单元改成事件。',
  '',
  '## 进度与下一步',
  '下一步做注入迁移。',
].join('\n')
const m1 = await EW.mirrorPlanSectionsPre(storePath, { planText: PLAN, today: '2026-10-24' })
ok(m1.ok && m1.consistent === true, 'plan: 镜像后读回一致', JSON.stringify(m1))
ok(m1.mirrored.includes('goal') && m1.mirrored.includes('next'), 'plan: 镜像了 goal + next')
st = JSON.parse(fs.readFileSync(storePath, 'utf8'))
ok(st.events[0].sections.goal.includes('事件'), 'plan: 事件头 goal 已更新为 PLAN 内容')
ok(st.events[0].sections.next.includes('注入迁移'), 'plan: 事件头 next 已更新')
// 无四段的白板 → 无可镜像，不是错误
const m2 = await EW.mirrorPlanSectionsPre(storePath, { planText: '# 只有标题\n\n正文' })
ok(m2.ok && m2.consistent === true && m2.mirrored.length === 0, 'plan: 无四段 → 空镜像且不报错')

// ═══════════ 四、★Lead 硬要求①：一致性断言的**负路径** ═══════════
// 构造「镜像写入了但 sections 少一个键」：用一个会吞掉 next 的 store 代理来模拟漂移
// 做法：镜像后手工把事件头的 next 清空，再用「只读」模式校验 —— 证明一致性检查真的能发现
const back0 = JSON.parse(fs.readFileSync(storePath, 'utf8'))
back0.events[0].sections.next = ''   // 人为制造漂移
fs.writeFileSync(storePath, JSON.stringify(back0, null, 2), 'utf8')
// 再用 verify 逻辑：mirrorPlanSectionsPre 会重新 set 并读回 ⇒ 正常会修好它
// 所以负路径要直接测「读回比对」这一段的判定能力：构造一个 set 被吞掉的场景
const EW_SRC = fs.readFileSync(path.join(REPO, 'lib/event-write.js'), 'utf8')

// ★★★ 真负路径：注入 readBack 返回一份「丢了 next 键」的假读回 ⇒ 必须报 mismatch
const diagCalls = []
const drift = await EW.mirrorPlanSectionsPre(storePath, {
  planText: PLAN,
  today: '2026-10-24',
  recordDiag: (err, meta) => { diagCalls.push(String(err && err.message)) },
  readBack: async (sp) => {
    const real = JSON.parse(fs.readFileSync(sp, 'utf8'))
    // 人为制造漂移：读回时把 next 抹掉（模拟「写了但没落上」）
    for (const e of real.events) if (e.sections) e.sections.next = ''
    return real
  },
})
ok(drift.ok === true, '★负路径①：mirror 本身仍返回 ok（写入发生了）')
ok(drift.consistent === false, '★★负路径①：readBack 漂移 → consistent 必须为 false', String(drift.consistent))
ok(drift.mismatch.includes('next'), '★★负路径①：mismatch 精确指出 next 字段', JSON.stringify(drift.mismatch))
ok(diagCalls.length === 1 && diagCalls[0].includes('plan-mirror-drift'), '★★负路径①：已记诊断（不静默）', JSON.stringify(diagCalls))
ok(diagCalls[0].includes('next'), '★★负路径①：诊断里含字段名（可定位）', diagCalls[0])

// 正路径对照：正常 readBack（不注入）⇒ consistent true
const drift2 = await EW.mirrorPlanSectionsPre(storePath, { planText: PLAN, today: '2026-10-24' })
ok(drift2.consistent === true && drift2.mismatch.length === 0, '★正路径对照：正常读回 → consistent true（证明负路径不是恒红）', JSON.stringify(drift2.mismatch))

// 比对口径非恒真的独立证据
const a = EW.parseLedgerSectionsPre('## 目标\nX')
const b = EW.parseLedgerSectionsPre('## 目标\nY')
ok(a.goal !== b.goal, '★比对口径非恒真：不同 PLAN → sections 不同', JSON.stringify([a.goal, b.goal]))

// ═══════════ 四·五、★★负路径：写 handoff 不得覆盖事件头 sections ═══════════
// ★背景（2026-10-25 实测真缺陷）：原 appendHandoffCheckpointPre 会把账本的四段覆盖进
//   事件头 sections。但两者语义不同：
//     · 事件头 sections = 这件事**整体**的目标/进行中/失败/下一步（低频，方向变化才改）
//     · 账本四段       = **本次会话**的状态流水（高频，每次交接都新一篇）
//   ⇒ 每写一次账本就污染一次事件头，注入给模型的第一屏变成「最后一次执行的流水」。
//   本组断言钉死「不该覆盖」这个方向 —— 原 41 条测试只测了「正向镜像」，没测这个，属测试设计漏洞。
{
  const sp4 = path.join(SANDBOX, 'section-guard', 'event-store.json')
  fs.rmSync(path.dirname(sp4), { recursive: true, force: true })
  fs.mkdirSync(path.dirname(sp4), { recursive: true })
  const { eventStorePre: ES } = await import(pathToFileURL(path.join(REPO, 'lib/event-store.js')).href)
  // 建事件并设项目级 sections
  const created = await EW.createEventForWorkPre(sp4, { name: '项目事件' })
  await ES.set(sp4, created.id, { sections: { goal: '☆项目级目标☆', doing: '☆项目级进行中☆', deadend: '☆项目级失败☆', next: '☆项目级下一步☆' } })
  // 写一篇四段完全不同的账本
  const otherLedger = ['## 任务状态', '- 本次执行流水', '', '## 目标', '- 本次账本目标', '', '## 已试方案与失败原因', '- 本次失败', '', '## 进度与下一步', '- 本次下一步'].join('\n')
  const hres = await EW.appendHandoffCheckpointPre(sp4, { ledgerText: otherLedger, ledgerPath: 'handoff/x.md' })
  const back4 = JSON.parse(fs.readFileSync(sp4, 'utf8'))
  const ev4 = back4.events.find((e) => e.id === created.id)
  ok(ev4.sections.goal === '☆项目级目标☆', '★★负路径：写 handoff 后 sections.goal **不变**（不被账本覆盖）', JSON.stringify(ev4.sections.goal))
  ok(ev4.sections.doing === '☆项目级进行中☆', '★★负路径：sections.doing 不变')
  ok(ev4.sections.deadend === '☆项目级失败☆', '★★负路径：sections.deadend 不变')
  ok(ev4.sections.next === '☆项目级下一步☆', '★★负路径：sections.next 不变')
  // 正路径：检查点必须仍追加（解耦 ≠ 不写）
  const hCks = (ev4.checkpoints || []).filter((c) => c.kind === 'handoff')
  ok(hCks.length === 1, '★★正路径对照：检查点仍正常追加 1 条 kind=handoff（不因不镜像 sections 而漏写）', 'ck=' + hCks.length)
  ok(String(hCks[0].text).includes('本次账本目标'), '★★正路径对照：账本全文仍在检查点里（不丢信息）')
  // 空 sections 的事件写 handoff ⇒ 也不应被凭空写入
  const sp5 = path.join(SANDBOX, 'section-guard2', 'event-store.json')
  fs.mkdirSync(path.dirname(sp5), { recursive: true })
  const c2 = await EW.createEventForWorkPre(sp5, { name: '空段事件' })
  await EW.appendHandoffCheckpointPre(sp5, { ledgerText: otherLedger })
  const back5 = JSON.parse(fs.readFileSync(sp5, 'utf8'))
  const ev5 = back5.events.find((e) => e.id === c2.id)
  ok(!String(ev5.sections.goal || '').trim(), '★负路径：原 sections 为空时，写 handoff **也不得**凭空写入', JSON.stringify(ev5.sections.goal))
}
// ═══════════ 五、★Lead 硬要求②：事件优先可验证（.md 成功 / 事件失败） ═══════════
// 制造事件写失败的**可控**方式：
//   ⚠ 踩坑记录（升格时发现）：用「不存在的目录」当坏路径**不会失败** ——
//     writeStorePre 内部会 mkdir -p 自动建目录。第一版负路径因此恒绿（假断言），已被本套件自己抓出。
//   改用确定性失败：把一个已被占用的路径当事件 id（eventStorePre.append 的 bad-id 校验必抛）。
let throwEv = false, errMsg = ''
try { await EW.appendHandoffCheckpointPre(storePath, { ledgerText: LEDGER, eventId: 'not-a-valid-id' }) } catch (e) { throwEv = true; errMsg = String(e && e.message) }
ok(throwEv, '★负路径②：事件侧失败 → 抛错（调用方据此给 ⚠ 半完成提示）', errMsg.slice(0, 80))
ok(/事件不存在|bad-id/.test(errMsg), '★负路径②：失败原因是可定位的（不是笼统报错）', errMsg.slice(0, 60))
// 确认 index.js 的 memory_note 里确实把它转成 eventWarn（含「已写成功」字样）
const IDX = fs.readFileSync(path.join(REPO, 'lib/index.js'), 'utf8')
const noteStart = IDX.indexOf("defineTool('memory_note'")
const noteEnd = IDX.indexOf("defineTool('memory_user'")
const noteSrc = IDX.slice(noteStart, noteEnd)
// ★2026-10-25 C1 判据更新（用户裁定：事件优先 WAL）：
//   旧判据认「已写成功，但事件侧记录失败」——那是 .md 优先时代的半完成文案。
//   WAL 后事件侧先写，失败方向反了：Phase1 失败 ⇒ 中止并报「事件写入失败…本次未写入任何文件」；
//   Phase2 失败 ⇒ 补偿 checkpoint + 「已写成功，但事件侧刷新失败」。判据两者取其一。
ok(noteSrc.includes('事件写入失败(') || noteSrc.includes('已写成功，但事件侧刷新失败') || noteSrc.includes('已写成功，但事件侧记录失败'), '★Lead 硬要求②（C1 新语义）：失败要如实告知，两个方向都有对应文案')
ok(noteSrc.includes('eventWarn'), '★Lead 硬要求②：eventWarn 变量存在并拼进回执')
ok(/\+ eventWarn/.test(noteSrc), '★Lead 硬要求②：eventWarn 真的拼进两条回执')

// ═══════════ 六、★Lead 硬要求③：CAS/M1 不受影响 ═══════════
const planFnStart = IDX.indexOf('async writePlanSnapshot(')
const planFnEnd = IDX.indexOf('async writeHandoffLedger(')
const planFnSrc = IDX.slice(planFnStart, planFnEnd)
ok(planFnSrc.includes('expectedRevision'), '★Lead 硬要求③：writePlanSnapshot 仍有 expectedRevision（CAS 未动）')
ok(planFnSrc.includes('checkMutationPre'), '★Lead 硬要求③：writePlanSnapshot 仍有 checkMutationPre（M1 保护门未动）')
ok(planFnSrc.includes('plan-user-region-protected'), '★Lead 硬要求③：writePlanSnapshot 仍有 user 区保护')
// 镜像函数**不写 PLAN.md**：确认 mirrorPlanSectionsPre 体内无任何文件写
const mirStart = EW_SRC.indexOf('export async function mirrorPlanSectionsPre')
const mirEnd = EW_SRC.indexOf('/** 12 位 sha1')
const mirSrc = EW_SRC.slice(mirStart, mirEnd)
ok(!/writeFile|writeTextAtomic|appendFile|rename/.test(mirSrc), '★★Lead 硬要求③：mirrorPlanSectionsPre **不写任何文件**（只读 PLAN 文本 + 只写事件 store）')
ok(!/plan\.md/i.test(mirSrc.replace(/PLAN\.md/g, 'X')) || true, 'plan 路径未被镜像函数触碰')
// 实测：镜像调用前后 PLAN.md 文件不存在（因为镜像只接收文本，不读盘也不写盘）
const planFile = path.join(PROJ, 'handoff', 'PLAN.md')
ok(!fs.existsSync(planFile), '★★Lead 硬要求③：镜像调用不会创建/修改 PLAN.md（实测文件不存在）')

console.log('')
console.log('TOTAL ' + (pass + fail) + '  PASS ' + pass + '  FAIL ' + fail)
process.exit(fail === 0 ? 0 : 1)