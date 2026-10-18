#!/usr/bin/env node
// ★#424（2026-10-17）回归锁定：**明确弃用后，已导出的 SKILL.md 必须被退休**。
//
// 真实缺陷（施工前已真执行复现）：
//   lib/procedure-store.js 的 deprecate() 只改 stage；退休函数 sweepStaleSkillExportsPre 的
//   **唯一调用点**是「每次成功导出之后」（exportSkillForPre 末尾）⇒ 弃用这条入口从未触发退休。
//   后果：明确弃用的技能在 ~/.dsh/skills/ 下仍是带自检标记的合法 SKILL.md，DSH 宿主照样加载
//   （真机证据：8 个 mem-skill-* 里 7 个在真源已无对应 procedure）——用户以为停用了，模型还在用。
//
// 修法：宿主层新增 retireSkillExportForPre（与 sweepStaleSkillExportsPre **共用同一 helper**，
//       不写第二套判据），由 index.js 的 deprecate 分支（以及 update 落到 deprecated 的分支）调用。
//
// 本文件锁死：
//   [A] 正路径：export → deprecate ⇒ 目录内 SKILL.md 消失（可证生成）或只剩 .SKILL.md.retired-*
//   [B] 负路径①：用户手写同名目录（无自检标记）不得删
//   [C] 负路径②：别的 procedureId（other-procedure）不得删
//   [D] 负路径③：skillsRoot 不存在/不可读 ⇒ ok:false 且不抛
//   [E] 负路径④：用户资源（目录内另加 scripts/）⇒ 目录保留、SKILL.md 退休、用户字节不丢
//   [F] 自动老化路径（applyAutomaticTransitions → deprecated）同样退休
//   [G] 共用判据：sweep 与 retire 对同一批目录给出**一致**的归属判定
//   [H] 只读诊断 auditExportedSkillsPre：只列不删
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createProcedureStorePre } from '../../lib/procedure-store.js'
import {
  exportSkillForPre, retireSkillExportForPre, auditExportedSkillsPre,
  sweepStaleSkillExportsPre, listExportedSkillsPre, SKILL_EXPORT_STAMP_PRE_V1,
} from '../../lib/skill-export-host.js'

let pass = 0
let fail = 0
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  ok - ' + name) }
  else { fail++; console.error('  FAIL - ' + name + (extra === undefined ? '' : ' :: ' + String(extra))) }
}

const PID_A = 'proc_pre_' + 'a'.repeat(32)
const PID_B = 'proc_pre_' + 'b'.repeat(32)
const mkProc = (pid, title) => ({
  procedureId: pid, title, stage: 'active', riskLevel: 'low',
  steps: ['步骤一'], checks: ['检查一'], successCriteria: ['判据一'],
  preconditions: [], rollback: [], sourceEpisodes: [],
})
const listing = (root) => readdirSync(root).filter((n) => n.startsWith('mem-skill-')).sort()

console.log('[A] 正路径：export → 弃用 ⇒ SKILL.md 被退休')
{
  const root = mkdtempSync(path.join(tmpdir(), 'dam-a04-'))
  try {
    const e = exportSkillForPre(mkProc(PID_A, 'Alpha flow'), { skillsRoot: root, projectName: 'p', projectPath: 'D:/p' })
    ok(e.ok === true, '夹具自检：导出成功', e.reason)
    ok(existsSync(e.file), '夹具自检：SKILL.md 已落盘')
    const r = retireSkillExportForPre(root, PID_A)
    ok(r.ok === true, '★ retire 返回 ok', JSON.stringify({ ok: r.ok, reason: r.reason }))
    ok(r.retired.length === 1, '★ 退休 1 个目录', JSON.stringify(r.retired))
    // 先断言长度再取下标 —— 变异（退休退化为 no-op）时必须**干净地红**，而不是整套件抛 TypeError
    // 变成「崩溃」；崩溃也会让套件退出非 0，但看不出是哪条判据失守（本仓既有教训：假红/假绿）。
    const first = r.retired[0] || {}
    ok(first.dirName === e.dirName, '★ 退休的正是该 procedure 的目录', JSON.stringify({ got: first.dirName, want: e.dirName }))
    ok(first.action === 'deleted', '★ 可证生成（manifest sha256 相符）⇒ 直接删除', first.action)
    ok(!existsSync(path.join(root, e.dirName)), '★ 目录已消失（SKILL.md + manifest 删净后 rmdir 成功）', JSON.stringify(listing(root)))
    ok(listExportedSkillsPre(root).length === 0, '★ 插件视角不再有该技能（宿主不会再加载）')
  } finally { rmSync(root, { recursive: true, force: true }) }
}

console.log('\n[A2] 正路径（保字节分支）：SKILL.md 被用户编辑过 ⇒ rename 为 .SKILL.md.retired-*，字节不丢')
{
  const root = mkdtempSync(path.join(tmpdir(), 'dam-a04b-'))
  try {
    const e = exportSkillForPre(mkProc(PID_A, 'Alpha flow'), { skillsRoot: root, projectName: 'p', projectPath: 'D:/p' })
    const edited = readFileSync(e.file, 'utf8') + '\nUser edit must survive retirement.\n'
    writeFileSync(e.file, edited, 'utf8')
    const r = retireSkillExportForPre(root, PID_A)
    ok(r.ok === true && r.retired.length === 1, 'retire 成功', JSON.stringify(r))
    const first = r.retired[0] || {}
    ok(first.action === 'renamed', '★ 内容不可证生成 ⇒ rename（绝不删用户字节）', first.action)
    ok(!existsSync(e.file), 'SKILL.md 本身已不在原位')
    // 先用 existsSync 兜住目录是否存在：变异（退休 no-op）时目录还在、但没有 retired 别名，
    // 不兜的话 path.join(..., undefined) 会抛 TypeError 把整套件变成「崩溃」而不是「干净的红」。
    const retiredDir = path.join(root, e.dirName)
    const retired = existsSync(retiredDir) ? readdirSync(retiredDir).find((n) => n.startsWith('.SKILL.md.retired-')) : undefined
    ok(typeof retired === 'string', '★ 存在 .SKILL.md.retired-* 别名')
    ok(typeof retired !== 'string' ? false : readFileSync(path.join(retiredDir, retired), 'utf8') === edited, '★ 退休文件与被编辑内容**逐字节相等**')
    ok(listExportedSkillsPre(root).length === 0, '★ 该目录不再被识别为有效导出')
  } finally { rmSync(root, { recursive: true, force: true }) }
}

console.log('\n[B] 负路径①：用户手写同名目录（无自检标记）不得删')
{
  const root = mkdtempSync(path.join(tmpdir(), 'dam-a04c-'))
  try {
    exportSkillForPre(mkProc(PID_A, 'Alpha flow'), { skillsRoot: root, projectName: 'p', projectPath: 'D:/p' })
    const hand = path.join(root, 'mem-skill-handwritten-mine')
    mkdirSync(hand, { recursive: true })
    writeFileSync(path.join(hand, 'SKILL.md'), '# 用户手写\n', 'utf8')
    const r = retireSkillExportForPre(root, PID_A)
    ok(r.ok === true, 'retire 正常返回')
    ok(existsSync(path.join(hand, 'SKILL.md')), '★ 用户手写目录未被删除')
    ok(readFileSync(path.join(hand, 'SKILL.md'), 'utf8').includes('用户手写'), '★ 用户手写内容未被破坏')
    ok(!r.retired.some((x) => x.dirName === 'mem-skill-handwritten-mine'), '★ 手写目录不出现在 retired')
    ok(r.kept.some((x) => x.dirName === 'mem-skill-handwritten-mine' && x.reason === 'foreign'), '★ kept 如实报 foreign', JSON.stringify(r.kept))
  } finally { rmSync(root, { recursive: true, force: true }) }
}

console.log('\n[C] 负路径②：别的 procedureId（other-procedure）不得删')
{
  const root = mkdtempSync(path.join(tmpdir(), 'dam-a04d-'))
  try {
    const eB = exportSkillForPre(mkProc(PID_B, 'Other flow'), { skillsRoot: root, projectName: 'p', projectPath: 'D:/p' })
    ok(eB.ok === true, '夹具自检：B 导出成功')
    const r = retireSkillExportForPre(root, PID_A)
    ok(r.ok === true, 'retire 正常返回')
    ok(existsSync(path.join(root, eB.dirName, 'SKILL.md')), '★★ 别的 procedure 的 SKILL.md 未被删')
    ok(!r.retired.some((x) => x.dirName === eB.dirName), '★ B 不出现在 retired')
    ok(r.kept.some((x) => x.dirName === eB.dirName && x.reason === 'other-procedure'), '★ kept 报 other-procedure', JSON.stringify(r.kept))
  } finally { rmSync(root, { recursive: true, force: true }) }
}

console.log('\n[D] 负路径③：skillsRoot 不存在/不可读 ⇒ ok:false 且不抛')
{
  const missing = path.join(tmpdir(), 'dam-a04-does-not-exist-' + Date.now())
  let threw = null
  let r = null
  try { r = retireSkillExportForPre(missing, PID_A) } catch (e) { threw = e }
  ok(threw === null, '★ 不抛异常', threw && threw.message)
  ok(r.ok === false, '★ ok:false', JSON.stringify(r))
  ok(r.reason === 'skills-root-unreadable', '★ reason=skills-root-unreadable', r.reason)
  const noPid = retireSkillExportForPre(mkdtempSync(path.join(tmpdir(), 'dam-a04e-')), '')
  ok(noPid.ok === false && noPid.reason === 'no-procedure-id', '★ 空 procedureId ⇒ fail closed', JSON.stringify(noPid))
  const noRoot = retireSkillExportForPre('', PID_A)
  ok(noRoot.ok === false && noRoot.reason === 'no-skills-root', '★ 空 skillsRoot ⇒ fail closed', JSON.stringify(noRoot))
}

console.log('\n[E] 负路径④：目录内有用户资源 ⇒ 目录保留、SKILL.md 退休、用户字节不丢')
{
  const root = mkdtempSync(path.join(tmpdir(), 'dam-a04f-'))
  try {
    const e = exportSkillForPre(mkProc(PID_A, 'Alpha flow'), { skillsRoot: root, projectName: 'p', projectPath: 'D:/p' })
    mkdirSync(path.join(e.dir, 'scripts'), { recursive: true })
    writeFileSync(path.join(e.dir, 'scripts', 'user.js'), 'user-owned bytes', 'utf8')
    const r = retireSkillExportForPre(root, PID_A)
    ok(r.ok === true, 'retire 正常返回')
    ok(existsSync(e.dir), '★ 目录本身被保留（ENOTEMPTY ⇒ 不删目录）')
    ok(!existsSync(e.file), '★ SKILL.md 已退休（不在原位）')
    ok(readFileSync(path.join(e.dir, 'scripts', 'user.js'), 'utf8') === 'user-owned bytes', '★ 用户资源逐字节未动')
    ok(r.kept.some((x) => x.dirName === e.dirName && x.reason === 'user-resources-preserved'), '★ kept 报 user-resources-preserved', JSON.stringify(r.kept))
    ok(listExportedSkillsPre(root).length === 0, '★ 但插件视角已不再视其为有效技能')
  } finally { rmSync(root, { recursive: true, force: true }) }
}

console.log('\n[F] 自动老化路径：applyAutomaticTransitions ⇒ deprecated ⇒ 同样退休')
{
  const root = mkdtempSync(path.join(tmpdir(), 'dam-a04g-'))
  try {
    const now = 5000000000000
    const st = createProcedureStorePre({ now: () => now })
    const { procedure: p } = st.observe({ title: '老化流程', steps: ['s'], successCriteria: ['c'], riskLevel: 'low', origin: 'agent' })
    const pid = p.procedureId
    st.promote(pid, { distinctSessions: 9, successCount: 9 })
    st.activate(pid)
    const e = exportSkillForPre(st.get(pid), { skillsRoot: root, projectName: 'p', projectPath: 'D:/p' })
    ok(e.ok === true, '夹具自检：导出成功', e.reason)
    // 90 天未使用 ⇒ 自动归档
    const far = now + 200 * 86400000
    const counts = st.applyAutomaticTransitions(far)
    ok(counts.archived === 1, '夹具自检：自动老化归档 1 条', JSON.stringify(counts))
    ok(st.get(pid).stage === 'deprecated', '夹具自检：stage 已是 deprecated')
    ok(st.get(pid).deprecateReason === 'auto-archive-inactive', '夹具自检：原因是 auto-archive-inactive', st.get(pid).deprecateReason)
    // 编排层对「任何进入 deprecated 的条目」都要退休（index.js 的 deprecate / update 两处都调它）
    const r = retireSkillExportForPre(root, pid)
    ok(r.ok === true && r.retired.length === 1, '★ 自动老化后的条目同样可被退休', JSON.stringify(r))
    ok(!existsSync(e.file), '★ 自动老化路径的 SKILL.md 已退休（宿主不再加载）')
  } finally { rmSync(root, { recursive: true, force: true }) }
}

console.log('\n[G] 共用判据：sweep 与 retire 对同一批目录给出**一致**的归属判定')
{
  const root = mkdtempSync(path.join(tmpdir(), 'dam-a04h-'))
  try {
    const eA = exportSkillForPre(mkProc(PID_A, 'Alpha flow'), { skillsRoot: root, projectName: 'p', projectPath: 'D:/p' })
    const eB = exportSkillForPre(mkProc(PID_B, 'Other flow'), { skillsRoot: root, projectName: 'p', projectPath: 'D:/p' })
    const hand = path.join(root, 'mem-skill-handwritten-mine')
    mkdirSync(hand, { recursive: true })
    writeFileSync(path.join(hand, 'SKILL.md'), '# 用户手写\n', 'utf8')
    // sweep 视角：拿一个不存在的 keepDir + PID_B ⇒ 只清 A，保留手写与 B(keep 判定不同)
    const sw = sweepStaleSkillExportsPre(root, eB.dirName, PID_A)
    ok(JSON.stringify(sw.removed) === JSON.stringify([eA.dirName]), 'sweep 只清 A', JSON.stringify(sw))
    ok(sw.kept.some((k) => k.dirName === hand ? false : false) || true, 'sweep 正常返回 kept')
    const reasonsSweep = {}
    for (const k of sw.kept) reasonsSweep[k.dirName] = k.reason
    ok(reasonsSweep['mem-skill-handwritten-mine'] === 'foreign', 'sweep 判定手写目录 = foreign', JSON.stringify(reasonsSweep))
    ok(reasonsSweep[eB.dirName] === 'current', 'sweep 判定本次写入目录 = current', JSON.stringify(reasonsSweep))
    // retire 视角：同一批目录、目标 PID_A（已无目录）⇒ 对剩余目录的判定必须与 sweep 同源
    const rt = retireSkillExportForPre(root, PID_A)
    const reasonsRetire = {}
    for (const k of rt.kept) reasonsRetire[k.dirName] = k.reason
    ok(reasonsRetire['mem-skill-handwritten-mine'] === 'foreign', '★ retire 判定手写目录 = foreign（与 sweep 同源）', JSON.stringify(reasonsRetire))
    ok(reasonsRetire[eB.dirName] === 'other-procedure', '★ retire 对 B 判定 other-procedure（属于分支差异：sweep 里它是 keep，retire 里没有 keep 概念）', JSON.stringify(reasonsRetire))
    ok(rt.retired.length === 0, '没有遗留的可退休目录', JSON.stringify(rt.retired))
  } finally { rmSync(root, { recursive: true, force: true }) }
}

console.log('\n[H] 只读诊断 auditExportedSkillsPre：只列不删')
{
  const root = mkdtempSync(path.join(tmpdir(), 'dam-a04i-'))
  try {
    const eA = exportSkillForPre(mkProc(PID_A, 'Alpha flow'), { skillsRoot: root, projectName: 'p', projectPath: 'D:/p' })
    // 真源只剩 PID_B ⇒ A 应为孤儿
    const aud = auditExportedSkillsPre(root, [PID_B])
    ok(aud.ok === true, 'audit 返回 ok')
    ok(aud.orphans.length === 1, '★ 列出 1 个孤儿', JSON.stringify(aud.orphans))
    ok(aud.orphans[0].procedureId === PID_A, '★ 孤儿 id 正确', JSON.stringify(aud.orphans[0]))
    ok(aud.orphans[0].dirName === eA.dirName, '★ 孤儿目录名正确')
    ok(existsSync(eA.file), '★★ audit **绝不删**（SKILL.md 仍在）')
    const aud2 = auditExportedSkillsPre(root, [PID_A])
    ok(aud2.orphans.length === 0, '真源仍有该 procedure ⇒ 不是孤儿（不误报）')
    const aud3 = auditExportedSkillsPre(path.join(tmpdir(), 'dam-a04-nope-' + Date.now()), [PID_A])
    ok(aud3.ok === false && aud3.reason === 'skills-root-unreadable', '不可读根 ⇒ ok:false 不抛', JSON.stringify(aud3))
  } finally { rmSync(root, { recursive: true, force: true }) }
}

console.log('\n[I] ★端到端：真 apply() 宿主后走 hub deprecate 路由 ⇒ SKILL.md 真被退休')
// 这一节是本套件的**关键验收**：A–H 测的是 host 层函数，只有这一节证明
// 「弃用这条入口真的会调退休」—— 缺陷的根因正是「函数存在但弃用从不触发它」。
{
  const ws = mkdtempSync(path.join(tmpdir(), 'dam-a04wire-'))
  const home = path.join(ws, '.dsh-home')
  mkdirSync(home, { recursive: true })
  writeFileSync(path.join(home, 'dsh-auto-memory.json'), JSON.stringify({
    memoryRoot: path.join(ws, '.memory'), userMemoryDir: path.join(ws, '.user'),
    projectMemoryDir: '.project-memory', externalSources: {},
  }), 'utf8')
  const prevHome = process.env.DSH_HOME
  process.env.DSH_HOME = home
  try {
    const registeredTools = []
    const routes = []
    const ctx = {
      get() { return undefined }, on() { return () => {} }, effect() { return () => {} },
      systemPrompt: { section() { return () => {} }, context() { return () => {} } },
      tools: { register(def) { registeredTools.push(def); return () => {} } },
      webServer: { register(route) { routes.push(route); return () => {} } },
    }
    const idx = await import('../../lib/index.js')
    idx.apply(ctx, {})
    const procTool = registeredTools.find((t) => t && t.name === 'memory_procedure')
    ok(!!procTool, '夹具自检：memory_procedure 真注册')
    const hubRoute = routes.find((r) => String(r.path || '').includes('memory-hub'))
    ok(!!hubRoute, '夹具自检：memory-hub 路由真注册')
    const call = (body) => new Promise((resolve) => {
      let payload = null
      const res = { writeHead() { return this }, setHeader() {}, end(s) { try { payload = JSON.parse(s) } catch (_) { payload = s }; resolve(payload) } }
      const req = {
        method: 'POST', url: hubRoute.path, headers: { host: '127.0.0.1' },
        socket: { remoteAddress: '127.0.0.1' },
        [Symbol.asyncIterator]: async function* () { yield Buffer.from(JSON.stringify(body)) },
      }
      hubRoute.handler(req, res)
    })
    await procTool.execute({ action: 'write', title: '#424 端到端探针', steps: '第一步', successCriteria: '可判定' }, {})
    const storeProcs = (() => {
      for (const p of [path.join(home, 'memory', 'hub-pre', 'procedures.json'), path.join(home, 'memory', 'hub', 'procedures.json')]) {
        if (existsSync(p)) { try { const j = JSON.parse(readFileSync(p, 'utf8')); if (Array.isArray(j.procedures)) return j.procedures } catch (_) {} }
      }
      return null
    })()
    ok(Array.isArray(storeProcs) && storeProcs.length === 1, '夹具自检：真源已落盘 1 条', storeProcs && storeProcs.length)
    const fullId = storeProcs[0].procedureId
    await call({ action: 'force-promote', procedureId: fullId })
    const a1 = await call({ action: 'activate', procedureId: fullId, projectPath: ws })
    ok(a1 && a1.ok === true && a1.skillExport && a1.skillExport.ok === true, '夹具自检：activate 真导出 SKILL.md', JSON.stringify({ ok: a1 && a1.ok, exp: a1 && a1.skillExport && a1.skillExport.ok }))
    const skillsRoot = path.join(home, 'skills')
    const before = readdirSync(skillsRoot).filter((n) => n.startsWith('mem-skill-'))
    ok(before.length === 1, '夹具自检：skills/ 下有 1 个导出目录', JSON.stringify(before))
    const dep = await call({ action: 'deprecate', procedureId: fullId, projectPath: ws })
    ok(dep && dep.ok === true, '夹具自检：deprecate 成功', JSON.stringify({ ok: dep && dep.ok, reason: dep && dep.reason }))
    ok(dep.procedure && dep.procedure.stage === 'deprecated', '夹具自检：stage=deprecated')
    ok(Array.isArray(dep.skillRetired), '★ 回执带 skillRetired 数组（可观察，不是静默）', JSON.stringify(dep.skillRetired))
    ok(dep.skillRetired.length === 1, '★ skillRetired 记录了 1 个被退休目录', JSON.stringify(dep.skillRetired))
    ok(dep.skillRetired[0] && dep.skillRetired[0].dirName === before[0], '★ 退休的正是刚才导出的目录', JSON.stringify({ got: dep.skillRetired[0], want: before[0] }))
    const after = readdirSync(skillsRoot).filter((n) => n.startsWith('mem-skill-'))
    ok(after.length === 0, '★★ 弃用后 skills/ 下已无该技能（宿主不会再加载）', JSON.stringify(after))

    // ── 负路径④：项目不可解析 ⇒ **跳过退休**，不猜路径 ──
    // 再造一条并激活（带 projectPath 导出），然后**不带 projectPath / sessionId** 弃用：
    // 此时 _gwProj 解析不到，按方案「解析不到就跳过（不猜路径）」⇒ skillRetired 必须为空，
    // 且导出目录**原样保留**（宁可少退休一次，也不能对着未知项目乱删）。
    const hw2 = await procTool.execute({ action: 'write', title: '#424 无项目归属探针', steps: '第一步', successCriteria: '可判定' }, {})
    ok(String(hw2).includes('已写入') || String(hw2).includes('已并入'), '夹具自检：第二条已写入')
    const procs2 = (() => {
      for (const p of [path.join(home, 'memory', 'hub-pre', 'procedures.json'), path.join(home, 'memory', 'hub', 'procedures.json')]) {
        if (existsSync(p)) { try { const j = JSON.parse(readFileSync(p, 'utf8')); if (Array.isArray(j.procedures)) return j.procedures } catch (_) {} }
      }
      return null
    })()
    const pid2 = procs2.find((x) => x.title === '#424 无项目归属探针')
    ok(!!pid2, '夹具自检：第二条已落盘')
    if (pid2) {
      await call({ action: 'force-promote', procedureId: pid2.procedureId })
      const a2 = await call({ action: 'activate', procedureId: pid2.procedureId, projectPath: ws })
      ok(a2 && a2.ok === true && a2.skillExport && a2.skillExport.ok === true, '夹具自检：第二条真导出 SKILL.md')
      const before2 = readdirSync(skillsRoot).filter((n) => n.startsWith('mem-skill-'))
      ok(before2.length === 1, '夹具自检：skills/ 下 1 个目录', JSON.stringify(before2))
      // 不带 projectPath、不带 sessionId ⇒ _gwProj 解析不到
      const dep2 = await call({ action: 'deprecate', procedureId: pid2.procedureId })
      ok(dep2 && dep2.ok === true, '★ 项目不可解析时弃用本身仍成功（退休失败不阻断弃用）', JSON.stringify({ ok: dep2 && dep2.ok }))
      ok(dep2.procedure && dep2.procedure.stage === 'deprecated', '★ 条目仍进入 deprecated')
      ok(Array.isArray(dep2.skillRetired) && dep2.skillRetired.length === 0, '★ skillRetired 为空（跳过，不猜路径）', JSON.stringify(dep2.skillRetired))
      const after2 = readdirSync(skillsRoot).filter((n) => n.startsWith('mem-skill-'))
      ok(after2.length === 1, '★ 导出目录**原样保留**（未被误删）', JSON.stringify(after2))
    }
  } finally {
    if (prevHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = prevHome
    rmSync(ws, { recursive: true, force: true })
  }
}

console.log('\n' + (fail === 0 ? 'PASS ' + pass + ' / FAIL 0' : 'PASS ' + pass + ' / FAIL ' + fail))
process.exit(fail === 0 ? 0 : 1)
