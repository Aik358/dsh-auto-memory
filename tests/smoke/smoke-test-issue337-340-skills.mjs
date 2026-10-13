#!/usr/bin/env node
/**
 * smoke-test-issue337-340-skills.mjs —— 技能库四缺陷（#337 #338 #339 #340）的**真执行**契约。
 *
 * 纪律（CR-10）：每一条都真 import → 真构造 → 真调用 → 断言返回值；
 *   「源码里含某字符串」一律不作功能验收（本套件不含源码字符串充数断言）。
 *
 * ① #337：风险 low→high 升级必须重置人工批准，使 promote 回到 decision='ask'
 * ② #338：写盘失败必须回滚内存，使「同参重试」不再被 no-effective-change 截断
 * ③ #339：同一 procedure 改名后只留一份有效导出；别人的导出与用户手写目录一律不碰
 * ④ #340：memory_procedure schema 不再强制 title/steps（update 语义自洽），
 *         且 write/activate 缺字段仍被**运行时**明确拒绝
 *
 * 全程临时 DSH_HOME + 临时 skillsRoot，真实记忆目录零接触。
 */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

let pass = 0, fail = 0
function ok(cond, label, extra) {
  if (cond) { pass++; console.log('PASS ' + label) }
  else { fail++; console.log('FAIL ' + label + (extra !== undefined ? ' :: ' + String(extra) : '')) }
}
const eq = (a, b, label) => ok(a === b, label, 'got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b))

// ══════════════════════════ #337 / #338：procedure-store（真 store） ══════════════════════════
const storeMod = await import('../../lib/procedure-store.js')
const { createProcedureStorePre } = storeMod
ok(typeof createProcedureStorePre === 'function', '[0] procedure-store 真 import 到工厂函数')

/** 可注入落盘失败的 IO（#338 用）。load 返回上一次成功保存的快照。 */
function makeIo() {
  let saved = null
  let failNext = false
  return {
    io: {
      save: (s) => { if (failNext) return { ok: false, error: 'disk full' }; saved = s; return true },
      load: () => saved,
      clear: () => { saved = null; return true },
    },
    failOnce() { failNext = true },
    heal() { failNext = false },
    get saved() { return saved },
  }
}
const RICH = (over = {}) => ({ title: '候选流程', steps: ['第一步'], successCriteria: ['可判定'], riskLevel: 'low', origin: 'agent', ...over })

// ── #337 ──
console.log('\n=== #337 风险升级到 high 必须重置人工批准 ===')

/** 把条目推到指定 stage（真调用 promote/activate）。 */
function makeAtStage(stage, io, gates) {
  const st = createProcedureStorePre(gates ? { io, gates } : { io })
  const w = st.observe(RICH())
  const pid = w.procedure.procedureId
  st.promote(pid, { distinctSessions: 9, successCount: 9 })
  if (stage === 'validated') return { st, pid }
  st.activate(pid)
  return { st, pid }
}

for (const stage of ['observed', 'validated', 'active']) {
  const { io } = makeIo()
  const st = createProcedureStorePre({ io })
  const w = st.observe(RICH())
  const pid = w.procedure.procedureId
  if (stage !== 'observed') {
    st.promote(pid, { distinctSessions: 9, successCount: 9 })
    if (stage === 'active') st.activate(pid)
  }
  eq(st.get(pid).stage, stage, '[337] 前置：条目真处于 ' + stage)
  eq(st.get(pid).approved, true, '[337] 前置：low 入库时 approved=true（缺陷起点）')
  const u = st.update(pid, { riskLevel: 'high' })
  ok(u.ok === true && u.approvalReset === true, '[337/' + stage + '] update 报告 approvalReset=true', JSON.stringify({ ok: u.ok, approvalReset: u.approvalReset }))
  const p = st.get(pid)
  eq(p.requiresApproval, true, '[337/' + stage + '] requiresApproval 已同步为 true')
  eq(p.approved, false, '[337/' + stage + '] ★ approved 被重置为 false（不再绕过人工批准）')
  eq(JSON.stringify(p.approvals), '[]', '[337/' + stage + '] approvals 留痕已清空')
  eq(p.approvedAt, undefined, '[337/' + stage + '] approvedAt 已清除')
  eq(p.approvedBy, undefined, '[337/' + stage + '] approvedBy 已清除')
  const pr = st.promote(pid, { distinctSessions: 9, successCount: 9 })
  eq(pr.promoted, false, '[337/' + stage + '] ★ promote 不再晋升')
  eq(pr.decision, 'ask', '[337/' + stage + '] ★ promote 返回 decision=ask')
  ok((pr.reasonCodes || []).includes('high-risk-awaiting-approval'), '[337/' + stage + '] 原因码含 high-risk-awaiting-approval', JSON.stringify(pr.reasonCodes))
}

// 合法人工批准不受影响：升级 → approve → promote 可晋升
{
  const { io } = makeIo()
  const st = createProcedureStorePre({ io })
  const w = st.observe(RICH())
  const pid = w.procedure.procedureId
  st.update(pid, { riskLevel: 'high' })
  const ap = st.approve(pid, 'user')
  ok(ap.ok === true && ap.approved === true, '[337] 升级后人工 approve 仍可开门', JSON.stringify(ap))
  eq(st.get(pid).approved, true, '[337] 人工批准后 approved=true')
  eq(st.get(pid).approvedBy, 'user', '[337] approvedBy 留痕正确')
  const pr = st.promote(pid, { distinctSessions: 9, successCount: 9 })
  eq(pr.decision, 'promote', '[337] ★ 人工批准后 promote 正常晋升（未被新逻辑误伤）')
}

// 原始 high + 已批准 ⇒ 再次 update（含 riskLevel 重复传 high）不得重置批准
{
  const { io } = makeIo()
  const st = createProcedureStorePre({ io })
  const w = st.observe(RICH({ riskLevel: 'high' }))
  const pid = w.procedure.procedureId
  eq(st.get(pid).approved, false, '[337] 原始 high 入库 approved=false')
  st.approve(pid, 'user')
  const u = st.update(pid, { riskLevel: 'high', title: '改个标题' })
  ok(u.ok === true, '[337] 原始 high 条目仍可改标题', JSON.stringify(u))
  eq(st.get(pid).approved, true, '[337] ★ 原始 high 的既有人工批准未被重置')
  eq(st.get(pid).approvedBy, 'user', '[337] 原始 high 的批准留痕保留')
}

// 双签模式不受影响
{
  const { io } = makeIo()
  const st = createProcedureStorePre({ io, gates: { highRiskDualApproval: true, highRiskRequiresApproval: true, minSessionDiversity: 3, minSuccessCount: 2, maxCorrectionRate: 0.3, maxContradictions: 0 } })
  const w = st.observe(RICH())
  const pid = w.procedure.procedureId
  st.update(pid, { riskLevel: 'high' })
  eq(st.get(pid).approved, false, '[337] 双签：升级后 approved=false')
  const a1 = st.approve(pid, 'alice')
  eq(a1.approved, false, '[337] 双签：一人批准门未开')
  eq(a1.pendingApproval, true, '[337] 双签：返回 pendingApproval')
  const a2 = st.approve(pid, 'bob')
  eq(a2.approved, true, '[337] 双签：两人批准后门开')
  eq(JSON.stringify(st.get(pid).approvals), '["alice","bob"]', '[337] 双签留痕两人')
}

// 负路径：非升级路径不得误清批准（条件必须是「跨入需批准」而非「改了 riskLevel」）
{
  const { io } = makeIo()
  const st = createProcedureStorePre({ io })
  const w = st.observe(RICH({ riskLevel: 'high' }))
  const pid = w.procedure.procedureId
  st.approve(pid, 'user')
  st.update(pid, { riskLevel: 'medium' })   // high → medium：本身不需批准
  eq(st.get(pid).requiresApproval, false, '[337-负] 降为 medium 后 requiresApproval=false')
  eq(st.get(pid).approved, true, '[337-负] ★ 降级不误清既有人工批准（未误伤）')
  // 再升回 high ⇒ 必须重新走批准
  st.update(pid, { riskLevel: 'high' })
  eq(st.get(pid).approved, false, '[337-负] 重新升回 high ⇒ 批准被重置（需重新批准）')
  eq(st.promote(pid, { distinctSessions: 9, successCount: 9 }).decision, 'ask', '[337-负] 重新升级后 promote 回到 ask')
}

// ── #338 ──
console.log('\n=== #338 写盘失败必须回滚内存（同参重试可用）===')
{
  const m = makeIo()
  const st = createProcedureStorePre({ io: m.io })
  const w = st.observe(RICH({ title: 'ORIGINAL' }))
  const pid = w.procedure.procedureId
  m.failOnce()
  const u1 = st.update(pid, { title: 'NEW' })
  ok(u1.ok === false && u1.persisted === false, '[338] 首次写盘失败 ⇒ ok=false / persisted=false', JSON.stringify({ ok: u1.ok, reason: u1.reason }))
  eq(u1.reason, 'persist-failed', '[338] 失败原因码为 persist-failed')
  eq(u1.reverted, true, '[338] ★ 返回值报告 reverted=true')
  eq(st.get(pid).title, 'ORIGINAL', '[338] ★ 内存已回滚到改动前（不是 NEW）')
  m.heal()
  const u2 = st.update(pid, { title: 'NEW' })
  ok(u2.ok === true && u2.persisted === true, '[338] ★ 同参重试真的生效（不再被 no-effective-change 截断）', JSON.stringify({ ok: u2.ok, reason: u2.reason }))
  eq(u2.parsed.join(','), 'title', '[338] 重试报告 parsed=[title]')
  eq(st.get(pid).title, 'NEW', '[338] 重试后内存为 NEW')
  eq(!!(m.saved && JSON.stringify(m.saved).includes('NEW')), true, '[338] ★ 磁盘快照里真出现 NEW')
  // 已成功保存的同值更新仍按无改动处理
  const u3 = st.update(pid, { title: 'NEW' })
  ok(u3.ok === false && u3.reason === 'no-effective-change', '[338] 已保存的同值更新仍报 no-effective-change', JSON.stringify(u3))
}
// 负路径：无读回通道（io 无 load）时保持既有语义，绝不静默丢弃改动
{
  const st = createProcedureStorePre({ io: { save: () => ({ ok: false, error: 'x' }) } })
  const w = st.observe(RICH({ title: 'ORIG' }))
  const pid = w.procedure.procedureId
  const u = st.update(pid, { title: 'NEW' })
  eq(u.reverted, undefined, '[338-负] 无 load 通道 ⇒ 不报告 reverted')
  eq(u.revertSkipped, 'no-load-channel', '[338-负] 无 load 通道 ⇒ 显式报告 revertSkipped')
  eq(st.get(pid).title, 'NEW', '[338-负] 无 load 通道 ⇒ 改动不被静默丢弃（保持既有语义）')
}
// 负路径：成功保存时不得出现 reverted 字段
{
  const m = makeIo()
  const st = createProcedureStorePre({ io: m.io })
  const w = st.observe(RICH({ title: 'A' }))
  const u = st.update(w.procedure.procedureId, { title: 'B' })
  ok(u.ok === true && u.reverted === undefined, '[338-负] 成功路径不带 reverted', JSON.stringify({ ok: u.ok, reverted: u.reverted }))
}

// ══════════════════════════ #339：skill-export-host（真写盘） ══════════════════════════
console.log('\n=== #339 改名后只留一份有效导出 ===')
const hostMod = await import('../../lib/skill-export-host.js')
const seMod = await import('../../lib/skill-export.js')
const { exportSkillForPre, listExportedSkillsPre, SKILL_EXPORT_STAMP_PRE_V1, sweepStaleSkillExportsPre } = hostMod
const { skillDirNamePre } = seMod

const ROOT339 = mkdtempSync(path.join(tmpdir(), 'dam-i339-'))
const PID_A = 'proc_pre_' + 'a'.repeat(32)
const PID_B = 'proc_pre_' + 'b'.repeat(32)
const mkProc = (pid, title) => ({ procedureId: pid, title, stage: 'active', riskLevel: 'low', steps: ['步骤一'], checks: ['检查一'], successCriteria: ['判据一'], preconditions: [], rollback: [], sourceEpisodes: [] })
const listing = () => readdirSync(ROOT339).filter((n) => n.startsWith('mem-skill-')).sort()
try {
  const e1 = exportSkillForPre(mkProc(PID_A, 'Alpha flow'), { skillsRoot: ROOT339, projectName: 'p', projectPath: 'D:/p' })
  ok(e1.ok === true, '[339] 首次导出成功', JSON.stringify(e1).slice(0, 120))
  eq(JSON.stringify(e1.removed), '[]', '[339] 首次导出无历史目录可清')
  const e2 = exportSkillForPre(mkProc(PID_A, 'Beta flow'), { skillsRoot: ROOT339, projectName: 'p', projectPath: 'D:/p' })
  eq(JSON.stringify(e2.removed), JSON.stringify([e1.dirName]), '[339] 第二次导出清理掉第一次的目录')
  const e3 = exportSkillForPre(mkProc(PID_A, 'Gamma flow'), { skillsRoot: ROOT339, projectName: 'p', projectPath: 'D:/p' })
  const dirs = listing()
  eq(dirs.length, 1, '[339] ★ 连续改名两次后只剩 1 个导出目录', JSON.stringify(dirs))
  eq(dirs[0], e3.dirName, '[339] ★ 剩下的正是最终版目录')
  const finalMd = readFileSync(path.join(ROOT339, e3.dirName, 'SKILL.md'), 'utf8')
  ok(finalMd.includes('Gamma flow') && !finalMd.includes('Alpha flow'), '[339] ★ 留存内容是最终版（Gamma 而非 Alpha）')
  eq(listExportedSkillsPre(ROOT339).length, 1, '[339] ★ 插件视角只剩 1 个有效技能（旧版不再被加载）')
  const keptReasons = (e3.kept || []).filter((k) => k.reason === 'current').map((k) => k.dirName)
  eq(JSON.stringify(keptReasons), JSON.stringify([e3.dirName]), '[339] kept 如实报告本次目录 reason=current')

  // 用户手写目录（无自检标记）一律不动
  const hand = path.join(ROOT339, 'mem-skill-handwritten-mine')
  mkdirSync(hand, { recursive: true })
  writeFileSync(path.join(hand, 'SKILL.md'), '# 用户手写\n', 'utf8')
  const e4 = exportSkillForPre(mkProc(PID_A, 'Delta flow'), { skillsRoot: ROOT339, projectName: 'p', projectPath: 'D:/p' })
  ok(existsSync(path.join(hand, 'SKILL.md')), '[339] ★ 用户手写目录未被删除')
  eq(readFileSync(path.join(hand, 'SKILL.md'), 'utf8').includes('用户手写'), true, '[339] ★ 用户手写内容未被破坏')
  ok(!(e4.removed || []).includes('mem-skill-handwritten-mine'), '[339] 用户手写目录不出现在 removed')
  ok((e4.kept || []).some((k) => k.dirName === 'mem-skill-handwritten-mine' && k.reason === 'foreign'), '[339] kept 如实报告 foreign 原因', JSON.stringify(e4.kept))

  // ★最危险回归：别的 procedureId 的导出绝不能被误删
  const eB = exportSkillForPre(mkProc(PID_B, 'Other procedure'), { skillsRoot: ROOT339, projectName: 'p', projectPath: 'D:/p' })
  ok(eB.ok === true, '[339] 另一条 procedure 正常导出')
  const e5 = exportSkillForPre(mkProc(PID_A, 'Epsilon flow'), { skillsRoot: ROOT339, projectName: 'p', projectPath: 'D:/p' })
  ok(existsSync(path.join(ROOT339, eB.dirName, 'SKILL.md')), '[339] ★★ 别的 procedureId 的导出目录未被误删', JSON.stringify(listing()))
  ok(!(e5.removed || []).includes(eB.dirName), '[339] ★★ 别的 procedure 不出现在 removed')
  ok((e5.kept || []).some((k) => k.dirName === eB.dirName && k.reason === 'other-procedure'), '[339] ★★ kept 明确报告 other-procedure', JSON.stringify(e5.kept))
  eq(listing().length, 3, '[339] 清理后目录数 = A最终版 + B + 手写', JSON.stringify(listing()))

  // 负路径：落盘失败 ⇒ 一个都不删（顺序：先写成功再清扫）
  const newDirName = skillDirNamePre(mkProc(PID_A, 'Zeta flow'))
  writeFileSync(path.join(ROOT339, newDirName), 'blocker', 'utf8')
  const beforeList = listing()
  const e6 = exportSkillForPre(mkProc(PID_A, 'Zeta flow'), { skillsRoot: ROOT339, projectName: 'p', projectPath: 'D:/p' })
  ok(e6.ok === false, '[339-负] 新目录被占 ⇒ 导出失败', JSON.stringify(e6).slice(0, 120))
  eq(JSON.stringify(listing()), JSON.stringify(beforeList), '[339-负] ★ 写盘失败时旧导出一个都没被删（不会「技能凭空消失」）')
  rmSync(path.join(ROOT339, newDirName), { force: true })

  // 负路径：procedureId 缺失 ⇒ 不清扫任何东西
  const sw = sweepStaleSkillExportsPre(ROOT339, 'nonexistent-dir', '')
  eq(JSON.stringify(sw.removed), '[]', '[339-负] procedureId 为空 ⇒ 不清扫（fail closed）')
  eq(sw.kept.length, 0, '[339-负] procedureId 为空 ⇒ 不产出 kept（未做扫描）')
} finally {
  rmSync(ROOT339, { recursive: true, force: true })
}

// ══════════════════════════ #340：schema + 运行时双面 ══════════════════════════
console.log('\n=== #340 schema 与 update 语义自洽 ===')
process.on('uncaughtException', (e) => { console.error('FATAL uncaughtException', (e && e.stack) || e); process.exit(1) })
globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({}) })

const ws1 = mkdtempSync(path.join(tmpdir(), 'dam-i340-'))
const home = path.join(ws1, '.dsh-home')
mkdirSync(home, { recursive: true })
writeFileSync(path.join(home, 'dsh-auto-memory.json'), JSON.stringify({
  memoryRoot: path.join(ws1, '.memory'), userMemoryDir: path.join(ws1, '.user'),
  projectMemoryDir: '.project-memory', externalSources: {},
}), 'utf8')
process.env.DSH_HOME = home

const registeredTools = []
const ctx = {
  get() { return undefined }, on() { return () => {} }, effect() { return () => {} },
  systemPrompt: { section() { return () => {} }, context() { return () => {} } },
  tools: { register(def) { registeredTools.push(def); return () => {} } },
  webServer: { register() { return () => {} } },
}
const idxMod = await import('../../lib/index.js')
idxMod.apply(ctx, {})
const procTool = registeredTools.find((t) => t && t.name === 'memory_procedure')
ok(!!procTool, '[340] memory_procedure 真注册到工具表')

const req = (procTool && procTool.parameters && procTool.parameters.required) || []
eq(JSON.stringify(req), '[]', '[340] ★ 注册产物 required 不再强制 title/steps', JSON.stringify(req))
const props = (procTool && procTool.parameters && procTool.parameters.properties) || {}
ok(!!props.title && !!props.steps, '[340] title/steps 仍是可用参数（只是不再强制）', JSON.stringify(Object.keys(props)))

// 运行时：先真写一条，再用「只改 riskLevel」的 update —— 正是缺陷场景
let pid20 = ''
try {
  const out = await procTool.execute({ action: 'write', title: '#340 样例流程', steps: '第一步\n第二步', successCriteria: '可判定' }, {})
  const m = /\[id=([^\]]+)\]/.exec(String(out))
  ok(!!m, '[340] action=write 真写入并返回 20 位短码 id', String(out).slice(0, 120))
  pid20 = m ? m[1] : ''
  const upd = await procTool.execute({ action: 'update', procedureId: pid20, riskLevel: 'medium' }, {})
  ok(String(upd).includes('已修订'), '[340] ★★ 仅改 riskLevel 的 update 通过 schema 且真执行成功', String(upd).slice(0, 160))
  ok(String(upd).includes('riskLevel'), '[340] 回执列出真被改的字段 riskLevel', String(upd).slice(0, 160))
  const upd2 = await procTool.execute({ action: 'update', procedureId: pid20, checks: '检查点一' }, {})
  ok(String(upd2).includes('已修订'), '[340] ★★ 仅改 checks 的 update 同样通过（无 title/steps）', String(upd2).slice(0, 160))
} catch (e) {
  ok(false, '[340] update 真执行不得抛异常', String(e && e.message))
}
// 负路径：write/activate 缺 title/steps 仍须明确拒绝（运行时守卫，schema 放宽不等于放行）
try {
  const a = await procTool.execute({ action: 'write', steps: '只有步骤' }, {})
  ok(String(a).includes('title 必填'), '[340-负] write 缺 title ⇒ 明确拒绝', String(a).slice(0, 100))
  const b = await procTool.execute({ action: 'write', title: '只有标题' }, {})
  ok(String(b).includes('steps 必填'), '[340-负] write 缺 steps ⇒ 明确拒绝', String(b).slice(0, 100))
  const c = await procTool.execute({ action: 'activate', title: '只有标题' }, {})
  ok(String(c).includes('steps 必填'), '[340-负] activate 缺 steps ⇒ 明确拒绝', String(c).slice(0, 100))
  const d = await procTool.execute({ action: 'activate', steps: '只有步骤' }, {})
  ok(String(d).includes('title 必填'), '[340-负] activate 缺 title ⇒ 明确拒绝', String(d).slice(0, 100))
} catch (e) {
  ok(false, '[340-负] 缺字段应返回明确文案而非抛异常', String(e && e.message))
}

rmSync(ws1, { recursive: true, force: true })

console.log('\n=== ' + pass + ' PASS / ' + fail + ' FAIL ===')
process.exit(fail === 0 ? 0 : 1)
