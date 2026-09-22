/**
 * smoke-test-plan-seed-pre.mjs —— 白板「自动首建 + 自动维护」守卫（2026-09-22 用户拍板）
 *
 * 缺口背景（docs/internal/TODO-NEXT-20260922.md §C.4）：
 *   写盘链路完整（含首建），但四处给模型的指令**只描述「重写」**⇒ 没有 PLAN.md 的工作区里触发条件
 *   结构性恒假；且注入条件 `planText || latestHandoffText` 为假时整段白板提示都不注入
 *   ⇒ 8 工作区实测「除本仓库外 PLAN 写事件恒为 0」。
 *
 * 本守卫锁两件事，**红了就说明"新工作区自动建白板"又断了**：
 *   ① 骨架文本本身能过**真判据门**（P-H1）——否则"首建"会被写入门拒掉，白板永远建不起来；
 *   ② `ensurePlanBoardPre` 在**真 fs 临时工作区**上的端到端行为：空目录建、已有跳过、开关关不建。
 *
 * 断言的归属纪律（本仓固有条文）：守卫守**不变量**（能不能建、会不会覆盖、开关是否解耦），
 *   不守拼写；`instructionText()` 里的措辞断言只保证"创建语义还在"，改词可以、删语义不行。
 */
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { readFile, mkdir, writeFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { checkPlanCriteriaPre } from '../../lib/wb-contract.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
const SRC = readFileSync(path.join(ROOT, 'lib', 'index.js'), 'utf8')
const CSRC = readFileSync(path.join(ROOT, 'lib', 'client.js'), 'utf8')

let pass = 0, fail = 0
const ok = (c, n) => { if (c) { pass++; console.log('  ok -', n) } else { fail++; console.log('  FAIL -', n) } }
const tmpRoot = (() => { const d = path.join(os.tmpdir(), 'dam-planseed-' + Date.now()); mkdirSync(d, { recursive: true }); return d })()

// —— 源码抽取（花括号配平；与 smoke-test-handoff-pre.mjs 同款手法）——
function extractFn(header) {
  const start = SRC.indexOf(header)
  if (start < 0) throw new Error('not found: ' + header)
  let depth = 0, end = -1
  for (let i = start + header.length - 1; i < SRC.length; i++) {
    if (SRC[i] === '{') depth++
    else if (SRC[i] === '}') { depth--; if (depth === 0) { end = i; break } }
  }
  if (end < 0) throw new Error('unbalanced: ' + header)
  return SRC.slice(start, end + 1)
}
const padSrc = SRC.match(/^const pad = \(n\) => String\(n\)\.padStart\(2, '0'\)$/m)[0]
const handoffStampFn = new Function(padSrc + '\n' + extractFn('const handoffStamp = () => {') + '\nreturn handoffStamp;')()
const nowHmSrc = SRC.match(/^const nowHm = \(\) => \{ const d = new Date\(\); return `\$\{pad\(d\.getHours\(\)\)\}:\$\{pad\(d\.getMinutes\(\)\)\}` \}$/m)[0]
const nowHmFn = new Function(padSrc + '\n' + nowHmSrc + '\nreturn nowHm;')()
const bindMethod = (header, fake, extra) => {
  const names = ['path', 'existsSync', 'mkdir', 'writeFile', 'readdir', 'stat', 'handoffStamp', 'nowHm']
  const vals = [path, existsSync, mkdir, writeFile, readdir, stat, handoffStampFn, nowHmFn]
  for (const k of Object.keys(extra || {})) { names.push(k); vals.push(extra[k]) }
  const obj = new Function(...names, 'return {' + extractFn(header) + '};')(...vals)
  return obj[Object.keys(obj)[0]].bind(fake)
}

// —— G0：接线（静态；这几条是"能不能被触发"的结构前提）——
console.log('[plan-seed] G0 接线完整')
const nSeed = SRC.split('async ensurePlanBoardPre(projectDir) {').length - 1
const nSkel = SRC.split('skeletonPlanTextPre() {').length - 1
const nAgent = SRC.split('async ensurePlanBoardForAgentPre(agent) {').length - 1
ok(nSeed === 1 && nSkel === 1 && nAgent === 1, '首建三件套各定义 1 次（定义/骨架/agent 包装）')
ok(SRC.split('async writePlanSnapshot(projectDir, content, opts) {').length - 1 === 1 &&
  SRC.indexOf('await this.writePlanSnapshot(projectDir, this.skeletonPlanTextPre())') !== -1,
  '首建复用唯一白板写盘口 writePlanSnapshot（不自建第二条写盘路径）')
// 首建必须挂在轮末（agent/turn-stopping）且**先于**水位测量：首建是"产物存在性"兜底，与水位阈值无关。
const iHook = SRC.indexOf('void engine.ensurePlanBoardForAgentPre(agent)')
const iWater = SRC.indexOf('// M-CM4 水位感知')
ok(iHook > 0 && SRC.split('void engine.ensurePlanBoardForAgentPre(agent).catch(function () {})').length - 1 === 1,
  '轮末 turn-stopping 挂了首建（且只挂一次）')
ok(iHook > 0 && iWater > 0 && iHook < iWater, '首建在水位测量之前（不受水位阈值门控）')
// 解耦纪律：白板是**产物层**，只判 handoffEnabled，不得被 boardMode / autoContinueEnabled 牵连。
const iSeedBody = SRC.indexOf('async ensurePlanBoardPre(projectDir) {')
const seedBody = SRC.slice(iSeedBody, SRC.indexOf('skeletonPlanTextPre() {', iSeedBody))
ok(seedBody.indexOf('handoffEnabled === false') !== -1 &&
  seedBody.indexOf('boardMode') === -1 && seedBody.indexOf('autoContinueEnabled') === -1,
  '首建闸门只判 handoffEnabled（不含 boardMode/autoContinueEnabled，符合开关解耦纪律）')

// —— G1：骨架文本过真判据门 ——
console.log('[plan-seed] G1 骨架文本（真判据门 + 老化免疫）')
const skelSvc = bindMethod('skeletonPlanTextPre() {', {})
const skel = skelSvc()
ok(typeof skel === 'string' && skel.length > 80, '骨架是非空字符串（' + String(skel).length + ' 字符）')
ok(skel.indexOf('自动建立 · 待模型重写') !== -1, '骨架带识别标记（模型与前端据此判定"还是骨架"）')
ok(skel.split(/\n(?=## )/).filter((s) => /^## /.test(s)).length >= 2, '骨架 ≥2 个 ## 顶层节（判据 P-H1 与看板都有内容）')
// ★真行为：喂给生产代码的判据门，必须 ok===true。否则首建会被写入门拒掉、白板永远建不起来。
const crit = checkPlanCriteriaPre(skel)
ok(crit && crit.ok === true, '★ 骨架通过真判据门 checkPlanCriteriaPre（P-H1），首建不会被写入门拒绝')
ok(crit.hard.filter((h) => !h.pass).length === 0, '骨架硬判据零失败（' + crit.hard.map((h) => h.id + ':' + h.pass).join(' ') + '）')
// ★真行为：writePlanSnapshot 的白板老化只搬 /历史|踩坑|流水线要点/ 的顶节；骨架不能被搬走。
const agedHeads = skel.split(/(?=^## )/m).map((s) => String(s.split('\n', 1)[0] || ''))
  .filter((h) => /^## .*(历史|踩坑|流水线要点)/.test(h))
ok(agedHeads.length === 0, '骨架节标题不命中老化正则（不会被"写完就被搬空"）')
ok(/type:state/.test(skel) && /type:progress/.test(skel), '骨架含看板泳道 tag（type:state / type:progress）')

// —— G2：ensurePlanBoardPre 端到端（真 fs）——
console.log('[plan-seed] G2 ensurePlanBoardPre 端到端（真 fs 临时工作区）')
function makeFake(over) {
  const f = {
    config: { handoffEnabled: true },
    checkMutationPre: () => ({ ok: true }),
    async readTextSafe(p) { try { return (await readFile(p, 'utf8')) || '' } catch (_) { return '' } },
    async writeFullRaw(p, text) { await mkdir(path.dirname(p), { recursive: true }); await writeFile(p, text, 'utf8') },
    async writeSidecarEntryPre() {},
    async appendSidecarEventPre() {},
    wbWsKeyPre: () => 'test-ws',
    memToday: () => '2026-09-22',
  }
  Object.assign(f, over || {})
  // 沙箱里 `this.xxx` 必须自己挂上：真引擎上这两个是类方法，抽取式沙箱没有原型链。
  f.skeletonPlanTextPre = bindMethod('skeletonPlanTextPre() {', f)
  f.writePlanSnapshot = bindMethod('async writePlanSnapshot(projectDir, content, opts) {', f, { path })
  if (over && over.writePlanSnapshot) f.writePlanSnapshot = over.writePlanSnapshot
  return f
}
const ensure = (fake) => bindMethod('async ensurePlanBoardPre(projectDir) {', fake, { path })

// 12. 空工作区 → 真建文件
const ws1 = path.join(tmpRoot, 'fresh')
const f1 = makeFake()
const r1 = await ensure(f1)(ws1)
const plan1 = path.join(ws1, 'handoff', 'PLAN.md')
ok(r1 && r1.ok === true && r1.seeded === true, '★ 空工作区首建返回 {ok:true, seeded:true}')
ok(existsSync(plan1), '★ PLAN.md 真落盘（端到端，不是只返回 ok）')
const t1 = existsSync(plan1) ? await readFile(plan1, 'utf8') : ''
ok(t1.indexOf('自动建立 · 待模型重写') !== -1, '落盘内容=骨架（带识别标记）')

// 13/14. 幂等：已有即跳过，且模型重写过的白板绝不被骨架覆盖
const r2 = await ensure(f1)(ws1)
ok(r2 && r2.ok === true && r2.skipped === 'exists', '二次调用跳过（幂等，不重复写）')
await writeFile(plan1, '# 项目全貌 · 模型写的真内容\n\n## 这是什么\ntype:state\n这是模型重写后的真实白板内容，足够长以过判据门。\n', 'utf8')
const r3 = await ensure(f1)(ws1)
const t3 = await readFile(plan1, 'utf8')
ok(r3 && r3.skipped === 'exists' && t3.indexOf('模型重写后的真实白板内容') !== -1 &&
  t3.indexOf('自动建立 · 待模型重写') === -1,
  '★ 模型重写后仍跳过且内容原样保留（骨架永不覆盖真白板）')

// 15/16. 产物层闸门：handoffEnabled=false ⇒ 不建（功能开关解耦）
const ws2 = path.join(tmpRoot, 'disabled')
const f2 = makeFake({ config: { handoffEnabled: false } })
const r4 = await ensure(f2)(ws2)
ok(r4 && r4.ok === true && r4.skipped === 'handoff-disabled', 'handoffEnabled=false ⇒ 跳过并如实回因')
ok(!existsSync(path.join(ws2, 'handoff', 'PLAN.md')), '★ 开关关时**一个字节都不写**（解耦纪律）')

// 17/18. fail-soft + 委托写盘口
const r5 = await ensure(f1)('')
ok(r5 && r5.ok === false && r5.error === 'no-project-dir', '缺 projectDir ⇒ {ok:false}（不抛、fail-soft）')
const ws3 = path.join(tmpRoot, 'delegated')
const calls = []
const f3 = makeFake({ writePlanSnapshot: async (dir, text) => { calls.push({ dir, text }); return { ok: true } } })
const r6 = await ensure(f3)(ws3)
ok(r6 && r6.seeded === true && calls.length === 1 && calls[0].dir === ws3 &&
  String(calls[0].text).indexOf('自动建立 · 待模型重写') !== -1,
  '★ 首建把骨架文本交给 writePlanSnapshot（唯一写盘口），未自建写盘路径')
// 骨架与"运行时真用的骨架"必须同源：不能测试里一份、生产里另一份。
ok(f1.skeletonPlanTextPre() === calls[0].text, '测试取到的骨架与 ensurePlanBoardPre 实际写入的逐字节一致')

// —— G3：指令层「创建语义」在位（防日后被改回纯重写口径）——
console.log('[plan-seed] G3 指令层创建语义 + 前端承诺一致')
const iGuidance = SRC.indexOf('维护时机（**条件触发，不是每轮**）')
const guidanceSeg = SRC.slice(iGuidance, iGuidance + 900)
ok(iGuidance > 0 && guidanceSeg.indexOf('先把它重写成真内容') !== -1 && guidanceSeg.indexOf('不要停在骨架') !== -1,
  'GUIDANCE 维护时机含「尚无白板时先建一版」+「不要停在骨架」')
ok(SRC.indexOf('那只是占位——你理解项目全貌后要用 memory_note(kind=plan) 把它重写成真内容') !== -1,
  '每轮尾部提醒含「骨架只是占位，要重写成真内容」')
ok(SRC.indexOf('**首建亦可**') !== -1, 'memory_note 工具描述含「首建亦可」')
ok(SRC.indexOf('还是上面那种自动骨架') !== -1, '注入快照标题含骨架识别语义')
ok(CSRC.indexOf('the host seeds a skeleton board when a turn first ends in this workspace') !== -1 &&
  CSRC.indexOf('宿主会在该工作区第一次会话结束时自动落一版骨架') !== -1,
  '前端空态中英双语与后端事实一致（"会自动写"已改为"宿主落骨架+模型重写"）')

console.log('[plan-seed] pass=' + pass + ' fail=' + fail)
if (fail) process.exit(1)
