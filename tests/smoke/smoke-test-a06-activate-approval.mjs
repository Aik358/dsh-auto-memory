#!/usr/bin/env node
// ★#426（2026-10-17）回归锁定：**approved 是 active 的不变量**。
//
// 真实缺陷（本套件施工前已真执行复现）：
//   lib/procedure-store.js 的 activate() 旧实现**只查 stage==='validated'，不查 approved**，
//   而 update() 在内容变更时**故意**把 stage 打回 validated（#337 的派生重置分支）⇒ 恰好把条目
//   放回 activate 的唯一入口。于是这条链完全绕过高风险门：
//     observe(high) → approve → promote → activate → update(改内容)  ← 批准被清空、stage 回 validated
//     → activate#2 ⇒ 旧实现返回 ok:true / stage=active / approved=false
//   同 store 的 promote() 却会拦（decision='ask' + reasonCodes=['high-risk-awaiting-approval']）
//   —— 同一个门在两处各写一份判据，正是本批要收掉的「半修」形态。
//   措辞侧同样失真：renderChecklist 在 approved=false 时照样输出「已确认可参考」。
//
// 本文件锁死：
//   [A] 正路径：撤销批准后 activate 必须 ok:false / reason='high-risk-awaiting-approval'
//   [B] 负路径①：重新批准后同流程成功（新门不得误伤正常通路）
//   [C] 负路径②：非高风险条目 activate 行为逐字节不变
//   [D] 负路径③：renderChecklist 文案按 approved 分岔
//   [E] 负路径④：activeProcedures「返回但标记」—— 仍返回该条，且 approvalPending===true
//   [F] 幂等分支：内存态 stage=active && approved=false 的脏条目不得被 alreadyActive 自洽掉
import { createProcedureStorePre } from '../../lib/procedure-store.js'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

let pass = 0
let fail = 0
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  ok - ' + name) }
  else { fail++; console.error('  FAIL - ' + name + (extra === undefined ? '' : ' :: ' + String(extra))) }
}

/** 造一条「低风险、够证据、可晋升」的条目并激活。 */
function activatedLowRisk() {
  const st = createProcedureStorePre()
  const { procedure: p } = st.observe({
    title: '示例流程', steps: ['第一步'], successCriteria: ['可判定'], riskLevel: 'low', origin: 'agent',
  })
  const pid = p.procedureId
  const pr = st.promote(pid, { distinctSessions: 9, successCount: 9 })
  const ar = st.activate(pid)
  return { st, pid, pr, ar }
}

console.log('[A] 正路径：撤销批准（改内容）后 activate 必须被高风险门拦下')
{
  const { st, pid } = activatedLowRisk()
  ok(st.get(pid).stage === 'active', '夹具自检：条目已 active')
  // 改内容 + 升风险 ⇒ approvalReset（#337 语义）：stage 回 validated、approved 清零
  const u = st.update(pid, { riskLevel: 'high', steps: ['危险的新版本'] })
  ok(u.ok === true, '夹具自检：update 成功', JSON.stringify({ ok: u.ok, reason: u.reason }))
  ok(u.approvalReset === true, '夹具自检：update 触发 approvalReset')
  ok(u.procedure.stage === 'validated', '夹具自检：stage 已回落到 validated（正是缺陷入口）', u.procedure.stage)
  ok(u.procedure.requiresApproval === true && u.procedure.approved === false, '夹具自检：requiresApproval=true 且 approved=false')
  const a2 = st.activate(pid)
  ok(a2.ok === false, '★ 撤销批准后 activate 必须失败（旧实现返回 ok:true ⇒ 本断言即缺陷判据）', JSON.stringify(a2))
  ok(a2.reason === 'high-risk-awaiting-approval', '★ 错误码复用 promote 的冻结码 high-risk-awaiting-approval', a2.reason)
  ok(st.get(pid).stage === 'validated', '★ 失败的 activate 不得改动 stage', st.get(pid).stage)
  ok(a2.procedure && a2.procedure.procedureId === pid, '失败回执带上条目本身（便于前端/工具展示）')
}

console.log('\n[B] 负路径①：重新批准后同流程成功（新门不得误伤正常通路）')
{
  const { st, pid } = activatedLowRisk()
  st.update(pid, { riskLevel: 'high', steps: ['危险的新版本'] })
  const blocked = st.activate(pid)
  ok(blocked.ok === false && blocked.reason === 'high-risk-awaiting-approval', '夹具自检：先被拦下')
  const ap = st.approve(pid, 'user')
  ok(ap.ok === true && ap.approved === true, '夹具自检：approved 真置真', JSON.stringify({ ok: ap.ok, approved: ap.approved }))
  const a3 = st.activate(pid)
  ok(a3.ok === true, '★ 批准后 activate 成功', JSON.stringify({ ok: a3.ok, reason: a3.reason }))
  ok(a3.procedure && a3.procedure.stage === 'active', '★ 批准后条目真进入 active', a3.procedure && a3.procedure.stage)
}

console.log('\n[C] 负路径②：非高风险条目的 activate 行为逐字节不变')
{
  const { st, pid, ar } = activatedLowRisk()
  ok(ar.ok === true && ar.procedure.stage === 'active', '非高风险 activate 仍成功')
  ok(ar.reason === undefined, '非高风险 activate 不带 reason（与旧实现同形）', ar.reason)
  ok(ar.alreadyActive === undefined, '首次激活不带 alreadyActive')
  const again = st.activate(pid)
  // 基线语义（已核对 git show HEAD:lib/procedure-store.js）：已 active 且**无**落盘失败 ⇒
  // 不进 alreadyActive 分支，而是落到 `stage !== 'validated'` ⇒ {ok:false, reason:'stage-active'}。
  // 本次修复**不得**改变这一条（非高风险条目的重复激活必须与基线逐字节相同）。
  ok(again.ok === false && again.reason === 'stage-active', '非高风险重复 activate 与基线逐字节相同（stage-active）', JSON.stringify({ ok: again.ok, reason: again.reason }))
  ok(again.alreadyActive === undefined, '此时不进入 alreadyActive 分支')
}

console.log('\n[D] 负路径③：renderChecklist 高风险文案按 approved 分岔（措辞层不得再说「已确认」）')
{
  // 造一条「内存态 stage=active 且 requiresApproval && !approved」的条目：
  // 这正是旧版本 activate 无门时留下的脏形态，用 snapshot→restore 精确复现。
  const st = createProcedureStorePre()
  const { procedure: p } = st.observe({ title: '高风险流程', steps: ['s'], successCriteria: ['c'], riskLevel: 'low', origin: 'agent' })
  const pid = p.procedureId
  st.update(pid, { riskLevel: 'high' })
  const snap = st.snapshot()
  snap.procedures.find((x) => x.procedureId === pid).stage = 'active'
  const st2 = createProcedureStorePre()
  ok(st2.restore(snap).ok === true, '夹具自检：脏快照还原成功')
  ok(st2.get(pid).stage === 'active' && st2.get(pid).approved === false, '夹具自检：脏条目 = active && approved=false')
  const cl = st2.renderChecklist(pid)
  ok(cl !== null && cl.level === 'hint', '夹具自检：高风险 active 渲染为 hint 降级')
  ok(cl.text.includes('尚未批准'), '★ 未批准文案明写「尚未批准」', cl.text)
  ok(!cl.text.includes('已确认'), '★ 未批准文案**不得**再说「已确认」', cl.text)
  ok(!cl.text.includes('已人工批准'), '★ 未批准文案不得声称已人工批准', cl.text)
  ok(cl.approvalPending === true, '★ 投影字段 approvalPending=true')
  // 批准后文案翻转
  st2.approve(pid, 'user')
  const cl2 = st2.renderChecklist(pid)
  ok(cl2.text.includes('已人工批准'), '★ 批准后文案明写「已人工批准」', cl2.text)
  ok(!cl2.text.includes('尚未批准'), '★ 批准后不得再出现「尚未批准」', cl2.text)
  ok(cl2.approvalPending === false, '批准后 approvalPending=false')
}

console.log('\n[E] 负路径④：activeProcedures「返回但标记」—— 不剔除、不降权，只标 approvalPending')
{
  const st = createProcedureStorePre()
  const { procedure: p } = st.observe({ title: '高风险流程', steps: ['s'], successCriteria: ['c'], riskLevel: 'low', origin: 'agent' })
  const pid = p.procedureId
  st.update(pid, { riskLevel: 'high' })
  const snap = st.snapshot()
  snap.procedures.find((x) => x.procedureId === pid).stage = 'active'
  const st2 = createProcedureStorePre()
  st2.restore(snap)
  const actives = st2.activeProcedures()
  ok(actives.length === 1, '★ 仍返回该条（用户裁定「返回但标记」，不剔除）', actives.length)
  ok(actives[0].procedureId === pid, '★ 返回的正是该条（不降权、不换人）')
  ok(actives[0].approvalPending === true, '★ 投影字段 approvalPending=true')
  ok(actives[0].stage === 'active', 'stage 原样保留')
  // 非高风险条目：approvalPending 必须是 false（不误标）
  const st3 = createProcedureStorePre()
  const q = st3.observe({ title: '普通流程', steps: ['s'], successCriteria: ['c'], riskLevel: 'low', origin: 'agent' })
  st3.promote(q.procedure.procedureId, { distinctSessions: 9, successCount: 9 })
  st3.activate(q.procedure.procedureId)
  const a3 = st3.activeProcedures()
  ok(a3.length === 1 && a3[0].approvalPending === false, '★ 非高风险条目的 approvalPending=false（不误标）')
}

console.log('\n[F] 幂等分支：alreadyActive 不得把「active 且未批准」的脏条目自洽掉')
{
  // 造脏条目（同 [D]），再触发 A-1b 的 alreadyActive 分支：需要「已 active + lastPersistError」。
  // 这里直接用「先让落盘失败」的方式触发，确保走的确实是 alreadyActive 那一段。
  let failNext = false
  const io = {
    save(v) { if (failNext) { failNext = false; throw new Error('simulated ENOSPC') } return true },
    load() { return null },
    clear() {},
  }
  const st = createProcedureStorePre({ io })
  const { procedure: p } = st.observe({ title: '高风险流程', steps: ['s'], successCriteria: ['c'], riskLevel: 'low', origin: 'agent' })
  const pid = p.procedureId
  st.update(pid, { riskLevel: 'high' })
  const snap = st.snapshot()
  snap.procedures.find((x) => x.procedureId === pid).stage = 'active'
  const st2 = createProcedureStorePre({ io })
  st2.restore(snap)
  ok(st2.get(pid).stage === 'active' && st2.get(pid).approved === false, '夹具自检：脏条目已就位')
  // 触发 lastPersistError：必须走一个**真会 persist** 的写操作（setPinned 只动 pinned，
  // 不改 stage/approved，正好只用来把 lastPersistError 置上）。
  failNext = true
  const pin = st2.setPinned(pid, true)
  ok(pin.persisted === false, '夹具自检：落盘失败已发生（persisted=false）', JSON.stringify({ ok: pin.ok, persisted: pin.persisted }))
  ok(st2.getStats().lastPersistError !== null, '夹具自检：lastPersistError 已置上')
  ok(st2.get(pid).stage === 'active' && st2.get(pid).approved === false, '夹具自检：脏条目仍在（active && approved=false）')
  const a2 = st2.activate(pid)     // 此刻 stage=active && lastPersistError ⇒ 旧实现走 alreadyActive
  ok(a2.ok === false, '★ alreadyActive 分支同样被高风险门拦下（不得自洽）', JSON.stringify({ ok: a2.ok, reason: a2.reason, alreadyActive: a2.alreadyActive }))
  ok(a2.reason === 'high-risk-awaiting-approval', '★ 同一冻结错误码', a2.reason)
}

console.log('\n[G] ★端到端：真 apply() 宿主后，模型通路与 hub 通路都被新门拦下')
// A–F 测的是 store 层；这一节证明 index.js 的两条 activate 通路**真的接了这道门**，
// 并且 hub 通路**没有白跑自动导出**（#426 改点明确要求跳过：否则会先写盘再失败）。
{
  const ws = mkdtempSync(path.join(tmpdir(), 'dam-a06wire-'))
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
    await procTool.execute({ action: 'write', title: '#426 端到端探针', steps: '第一步', successCriteria: '可判定' }, {})
    const storeProcs = (() => {
      for (const p of [path.join(home, 'memory', 'hub-pre', 'procedures.json'), path.join(home, 'memory', 'hub', 'procedures.json')]) {
        if (existsSync(p)) { try { const j = JSON.parse(readFileSync(p, 'utf8')); if (Array.isArray(j.procedures)) return j.procedures } catch (_) {} }
      }
      return null
    })()
    ok(Array.isArray(storeProcs) && storeProcs.length === 1, '夹具自检：真源已落盘 1 条')
    const fullId = storeProcs[0].procedureId
    await call({ action: 'force-promote', procedureId: fullId })
    const a1 = await call({ action: 'activate', procedureId: fullId, projectPath: ws })
    ok(a1 && a1.ok === true && a1.procedure.stage === 'active', '夹具自检：先正常激活到 active')
    // 升风险 + 改内容（模型 update 通路）⇒ approvalReset
    const upd = await procTool.execute({ action: 'update', procedureId: fullId, riskLevel: 'high', steps: '危险新版本' }, {})
    ok(String(upd).includes('需重新批准'), '夹具自检：update 回执已提示需重新批准', String(upd).slice(0, 120))
    // hub 通路 activate#2 ⇒ 必须被拦，且不得产出 skillExport
    const a2 = await call({ action: 'activate', procedureId: fullId, projectPath: ws })
    ok(a2 && a2.ok === false, '★ hub 通路 activate 被高风险门拦下', JSON.stringify({ ok: a2 && a2.ok, reason: a2 && a2.reason }))
    ok(a2.reason === 'high-risk-awaiting-approval', '★ 错误码 = high-risk-awaiting-approval', a2.reason)
    ok(a2.skillExport === undefined, '★ 被拦时**跳过**自动导出（不白跑一次写盘）', JSON.stringify(a2.skillExport))
    ok(a2.procedure && a2.procedure.stage === 'validated', '★ stage 未被改动', a2.procedure && a2.procedure.stage)
    // ── 模型通路（index.js:17190-17260 段）：高风险 write → activate 必须被拦 + 给可执行下一步 ──
    // 用一个**独立的**高风险条目（schema 要求 title/steps；不传会先在 schema 层返回「title 必填」，
    // 根本到不了业务分支 —— 这是既有契约，不是本次改动）。
    const highArgs = { action: 'write', title: '#426 高风险探针', steps: '危险步骤', successCriteria: '可判定', riskLevel: 'high' }
    const hw = await procTool.execute(highArgs, {})
    ok(String(hw).includes('已写入') || String(hw).includes('已并入'), '夹具自检：高风险条目已写入', String(hw).slice(0, 100))
    // 用**同一组参数**再走 activate ⇒ observe 走指纹合并进同一条（不新建），然后 promote 撞高风险门
    const mOut = await procTool.execute({ ...highArgs, action: 'activate' }, {})
    ok(String(mOut).includes('high-risk-awaiting-approval'), '★ 模型通路回执含机器码 high-risk-awaiting-approval', String(mOut).slice(0, 220))
    ok(String(mOut).includes('记忆中枢'), '★ 模型通路回执含可执行下一步（提示用户去「记忆中枢」批准）', String(mOut).slice(0, 220))
    ok(String(mOut).includes('未激活'), '★ 模型通路明确报「未激活」（不得谎报成功）', String(mOut).slice(0, 220))
    // 批准后 hub 通路可再次激活成功
    await call({ action: 'approve', procedureId: fullId })
    const a3 = await call({ action: 'activate', procedureId: fullId, projectPath: ws })
    ok(a3 && a3.ok === true && a3.procedure.stage === 'active', '★ 批准后 hub 通路激活成功（新门不误伤）')
  } finally {
    if (prevHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = prevHome
    rmSync(ws, { recursive: true, force: true })
  }
}

console.log('\n' + (fail === 0 ? 'PASS ' + pass + ' / FAIL 0' : 'PASS ' + pass + ' / FAIL ' + fail))
process.exit(fail === 0 ? 0 : 1)
