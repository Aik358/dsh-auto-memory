#!/usr/bin/env node
/**
 * smoke-test-i335-procedure-update.mjs —— #335 第二批（2026-10-12）：
 * 技能库「原地修订」通路（memory_procedure action=update）的**真执行**契约。
 *
 * 背景（真实事故）：memory_procedure 此前只有 write/activate ⇒ 修正一条已存在技能只能
 * 「再写一版 + 删旧的」，实测直接产生**两条同名技能**与**两个 SKILL.md 导出目录**。
 * 本套件钉住 store.update() 的语义边界与宿主的 id 解析/接线。
 *
 * 真执行（不是源码字符串断言）：
 *   ① 真 import lib/procedure-store.js → 真构造 store（内存 IO，不碰真实 ~/.dsh）→ 真调用 update()；
 *   ② 断言「改了该改的」且「没动不该动的」（procedureId/stage/evidence/createdAt）；
 *   ③ 负路径：受保护字段 / 未知字段 / 空 patch / 空数组 / 不存在 id / 非法 riskLevel 全部被拒；
 *   ④ 落盘失败必须如实（ok=false + persisted=false），不得谎报成功；
 *   ⑤ 宿主侧：enum 含 update、procedureId 参数在、helper **定义在函数体内**（首次修复曾放进
 *      「工具数组元素位置」⇒ 运行时 SyntaxError，而当时 node --check 只查了 client.js ⇒ 假绿）。
 *
 * 纪律：零运行时变化；不读写真实记忆目录（io 为内存替身）。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import pathModule from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const STORE = pathModule.join(ROOT, 'lib', 'procedure-store.js')
const IDX = readFileSync(pathModule.join(ROOT, 'lib', 'index.js'), 'utf8')

let pass = 0, fail = 0
function ok(cond, label) {
  if (cond) { pass++; console.log('PASS ' + label) }
  else { fail++; console.log('FAIL ' + label) }
}

const mod = await import(pathToFileURL(STORE).href)
const createStore = mod.createProcedureStorePre
assert.equal(typeof createStore, 'function', '必须能从 procedure-store.js 取到 createProcedureStorePre（真 import）')

const memIo = { save() { return true }, load() { return null }, clear() { return true } }
const store = createStore({ io: memIo })

// ── ① 真写入 + 真修订 ──
const w = store.observe({ title: '待修订的流程', steps: ['旧步骤一'], successCriteria: ['旧判据'], riskLevel: 'low' })
ok(!!(w && w.ok), '① observe 真写入成功')
const pid = w.procedure.procedureId
ok(typeof pid === 'string' && pid.length > 0, '① 取到 procedureId')
const before = store.get(pid)

const u = store.update(pid, { steps: ['新步骤一', '新步骤二'], title: '修订后的流程' })
ok(u && u.ok === true && u.updated === true, '① update 真调用返回 ok+updated')
ok(Array.isArray(u.parsed) && u.parsed.includes('steps') && u.parsed.includes('title'), '① parsed 如实列出被改字段')
const after = store.get(pid)
ok(after.title === '修订后的流程', '① title 真被改')
ok(after.steps.length === 2 && after.steps[0] === '新步骤一', '① steps 真被改')
ok(after.successCriteria.length === 1 && after.successCriteria[0] === '旧判据', '① 未传的字段不被误清（successCriteria 保持原值）')

// ── ② 不变量：身份/生命周期/证据不得被 update 改动 ──
ok(after.procedureId === pid, '② procedureId 不变')
ok(after.stage === before.stage && after.stage === 'observed', '② stage 不变（晋升走 promote/activate 专用通路）')
ok(JSON.stringify(after.evidence) === JSON.stringify(before.evidence), '② evidence 不变')
ok(after.createdAt === before.createdAt, '② createdAt 不变')
ok(after.updatedAt >= before.updatedAt, '② updatedAt 已刷新（唯一可见副作用）')
ok(store.query({}).length === 1, '② 未新增条目（update 不产生新行 ⇒ 从机制上杜绝「同名双条」）')

// ── ③ 负路径 ──
const prot = store.update(pid, { stage: 'active' })
ok(prot.ok === false && String(prot.reason).startsWith('protected-field:'), '③ 负路径：受保护字段 stage 被整次拒绝')
ok(store.get(pid).stage === 'observed', '③ 负路径：拒绝后 stage 确实未被改动')
ok(store.update(pid, { evidence: { success: 99 } }).ok === false, '③ 负路径：evidence 被拒')
ok(store.update(pid, { procedureId: 'x' }).ok === false, '③ 负路径：procedureId 被拒')
const unk = store.update(pid, { stepz: ['拼错'] })
ok(unk.ok === false && String(unk.reason).startsWith('unknown-field:'), '③ 负路径：未知字段被拒（不静默吞拼写错误）')
ok(store.update(pid, {}).ok === false, '③ 负路径：空 patch 被拒（不产生虚假「已更新」回执）')
const empty = store.update(pid, { steps: [] })
ok(empty.ok === false && empty.reason === 'no-effective-change', '③ 负路径：空数组=不改（防把条目改成无步骤空壳）')
ok(store.get(pid).steps.length === 2, '③ 负路径：空数组后 steps 仍完好')
ok(store.update('proc_pre_不存在', { title: 'x' }).reason === 'not-found', '③ 负路径：不存在 id 被拒')
ok(store.update('', { title: 'x' }).ok === false, '③ 负路径：空 id 被拒')
ok(store.update(pid, { riskLevel: 'huge' }).reason === 'bad-riskLevel', '③ 负路径：非法 riskLevel 被拒')
const hi = store.update(pid, { riskLevel: 'high' })
ok(hi.ok === true && store.get(pid).riskLevel === 'high', '③ riskLevel 可改为 high')
ok(store.get(pid).requiresApproval === true, '③ 风险升为 high 后 requiresApproval 同步（否则晋级门与实际风险不一致）')

// ── ③b ★2026-10-12 自检修出的真缺陷：失败路径必须**零副作用** ──
//   原实现边循环边写 p ⇒ 多字段 patch 里后面的字段非法时，前面已落笔：返回 ok:false
//   但内存已改脏，且内存态是权威 ⇒ 会被后续任意一次 persist 写进磁盘。
const sFix = createStore({ io: memIo })
const wf = sFix.observe({ title: '原子性样本', steps: ['orig'], successCriteria: ['c'], preconditions: ['p'], riskLevel: 'low' })
const fid = wf.procedure.procedureId
const snapFix = () => JSON.stringify(sFix.get(fid))
const bFix = snapFix()
const rBadRisk = sFix.update(fid, { steps: ['MUTATED'], riskLevel: 'huge' })
ok(rBadRisk.ok === false, '③b 多字段中 riskLevel 非法 ⇒ 整次拒绝')
ok(snapFix() === bFix, '★③b 拒绝后内存**零改动**（steps 未被部分写入）')
const rBadType = sFix.update(fid, { steps: ['changed'], preconditions: 'NOT-AN-ARRAY' })
ok(rBadType.ok === false && String(rBadType.reason).startsWith('bad-field-type:'), '③b 结构性字段类型错 ⇒ 显式拒绝（不静默忽略）')
ok(snapFix() === bFix, '★③b 类型错拒绝后内存零改动')
// 与现值相同 ⇒ 不算改动（否则产生虚假的「已修订」回执）
const rSame = sFix.update(fid, { steps: ['orig'] })
ok(rSame.ok === false && rSame.reason === 'no-effective-change', '③b 传与现值相同的值 ⇒ no-effective-change')
ok(snapFix() === bFix, '③b 同值拒绝后内存零改动')

// ── ④ 落盘失败必须如实 ──
const failStore = createStore({ io: { save() { return { ok: false, error: 'disk full' } }, load() { return null }, clear() { return true } } })
const w2 = failStore.observe({ title: '落盘失败样本', steps: ['a'], successCriteria: ['x'] })
const uf = failStore.update(w2.procedure.procedureId, { steps: ['b'] })
ok(uf.ok === false && uf.persisted === false, '④ 落盘失败 ⇒ ok 转 false 且 persisted=false（不谎报成功）')
// ★#338（2026-10-13）语义收敛：update 落盘失败时**回滚内存**。
//   旧断言曾锁「落盘失败但内存已改」——那正是 #338 的缺陷形态：内存已是新值 ⇒ 调用方按提示「同参重试」时
//   differs() 全 false，被 no-effective-change 截断，磁盘永远停在旧值（一次瞬时写失败 = 修订永久丢失）。
//   现判据：失败 ⇒ 已回滚（reverted=true）+ 内存为改动前的值；同参重试必须真的写下去。
ok(uf.reverted === true, '④ 落盘失败 ⇒ 返回值报告 reverted=true')
ok(failStore.get(w2.procedure.procedureId).steps[0] === 'a', '④ 落盘失败 ⇒ 内存已回滚到改动前的值（#338）')
const uf2 = failStore.update(w2.procedure.procedureId, { steps: ['b'] })
ok(uf2.ok === false && uf2.persisted === false, '④ 同参重试仍如实报失败（磁盘依旧不可写，不谎报成功）')

// ── ⑤ 宿主接线（含首次修复的语法事故回归） ──
ok(IDX.includes("enum: ['write', 'activate', 'update']"), '⑤ 宿主工具 enum 已含 update')
ok(IDX.includes('procedureId: { type: \'string\''), '⑤ 宿主工具已暴露 procedureId 参数')
ok(IDX.includes("const isUpdate = args.action === 'update'"), '⑤ 宿主侧有 update 分支开关')
// 窗口按实测距离设定（isUpdate → procs.update 实测相隔 1467 字符；窗口过窄会假红）
ok(/if \(isUpdate\) \{[\s\S]{0,2500}procs\.update\(/.test(IDX), '⑤ update 分支真调用 store.update()')
ok(/function proceduresFindByIdPre\(procs, id\) \{/.test(IDX), '⑤ ① id 解析 helper 有**定义**（不只是调用）')
ok(/function proceduresFindByPrefixPre\(procs, prefix\) \{/.test(IDX), '⑤ ② 前缀解析 helper 有定义')
// ★首次修复事故：helper 若落在「工具数组元素位置」（缩进 4）⇒ 运行时 SyntaxError
const defIndent = (IDX.match(/\n( *)function proceduresFindByIdPre/) || [])[1] || ''
ok(defIndent.length >= 8, '⑤ helper 定义缩进 ≥8 ⇒ 确实在函数体内（首次事故是落在 4 空格元素位 ⇒ SyntaxError）')
ok(IDX.indexOf('function proceduresFindByIdPre') < IDX.indexOf('function proceduresFindByPrefixPre'), '⑤ 两个 helper 顺序稳定')
const helperInside = IDX.indexOf('function proceduresFindByIdPre') > IDX.indexOf("defineTool('memory_procedure'")
ok(helperInside, '⑤ helper 定义位于 memory_procedure 工具定义之后（就近可用）')

// ── ⑥ 尾部铭文：必须告知模型 update/activate 两条通路 ──
const ins = /snapshotInscription: '([\s\S]*?)',\r?\n/.exec(IDX)
assert(ins, '⑥ 应能抽出 snapshotInscription')
const tpl = ins[1]
const ins_evalled = (await import(pathToFileURL(pathModule.join(ROOT, 'lib', 'index.js')).href)).DEFAULT_PROMPT_LAYERS.snapshotInscription
ok(tpl.includes('action=update'), '⑥ 铭文提示「已存在就用 action=update 改」')
ok(tpl.includes('action=activate'), '⑥ 铭文提示「确信可复用就 action=activate 主动晋升」')
ok(tpl.includes('别另写同名新条'), '⑥ 铭文显式禁止「另写同名新条」（正是本次事故的成因）')
// ★2026-10-24 两处修正（均判据过期，非缺陷）：
//   ① 上限一直是 **1500**，不是 1400（MASTER-PLAN §9 ① 已裁定取实测）。
//   ② **不能量源码字面量**：正则抽出来的是带 `\n` 转义与 `+ '...'` 拼接的源码片段，
//      比模板**求值后**的真长多出十几字符（实测源码 1506 vs 真值 1489）。
//      判据对象应是模型每轮真正看到的字符数 ⇒ 改为求值后量（真 import，非静态）。
const tplLen = ins_evalled.length
ok(tplLen <= 1500, '⑥ 铭文仍守住每轮成本 ≤1500 字符（求值后实测 ' + tplLen + '）')

console.log('--- ' + pass + ' PASS / ' + fail + ' FAIL')
process.exit(fail ? 1 : 0)
