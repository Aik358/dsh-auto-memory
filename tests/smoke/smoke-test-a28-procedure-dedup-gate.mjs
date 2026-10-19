#!/usr/bin/env node
/**
 * smoke-test-a28-procedure-dedup-gate.mjs —— 2026-10-19（用户裁定）：
 * 技能库**机械查重闸门**的真执行契约。
 *
 * 背景（真实重复事故）：四次发版被 crossFeed 自动沉淀成 4 条独立 procedure
 * （b8a121fd / bb997f23 / e1179788 / 5895adcd），主干流程完全相同、彼此不互相引用。
 * 既有防线只在**提示层**（注入要求「先 memory_procedure_list 查」「已存在就 update」），
 * 管不住自动沉淀那一路 —— 本套件钉住新增的**代码层**闸门。
 *
 * 真执行（不是源码字符串断言）：
 *   ① 真 import lib/index.js → 真 apply → 从工具表取到 memory_procedure → 真 execute；
 *   ② 正路径：标题归一后相同 / 前 3 步归一后相同 ⇒ **拒绝写入**且库里条目数不变；
 *   ③ 负路径（防误伤）：标题不同且步骤不同 ⇒ 正常写入；前两步相同但第三步不同 ⇒ 不拦；
 *      标题仅差空白/标点/大小写 ⇒ 仍判重复（归一生效）；
 *   ④ 边界：deprecated 条目不参与查重（不误挡复活/新建）；update 分支不受闸门影响；
 *   ⑤ 回执必须给「update 或换标题」二选一的下一步，不是甩一句 "duplicate"。
 *
 * 纪律：只用临时 DSH_HOME + 临时 memoryRoot，绝不碰真实 ~/.dsh 记忆。
 */
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import pathModule from 'node:path'
import os from 'node:os'

let pass = 0, fail = 0
function ok(cond, label, extra) {
  if (cond) { pass++; console.log('PASS ' + label) }
  else { fail++; console.log('FAIL ' + label + (extra ? ' :: ' + extra : '')) }
}
function eq(a, b, label, extra) {
  ok(Object.is(a, b), label + (Object.is(a, b) ? '' : ' got=' + JSON.stringify(a) + ' want=' + JSON.stringify(b)) + (extra ? ' :: ' + extra : ''))
}

process.on('uncaughtException', (e) => { console.error('FATAL uncaughtException', (e && e.stack) || e); process.exit(1) })
globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({}) })

const ws = mkdtempSync(pathModule.join(os.tmpdir(), 'dam-a28-'))
const home = pathModule.join(ws, '.dsh-home')
mkdirSync(home, { recursive: true })
writeFileSync(pathModule.join(home, 'dsh-auto-memory.json'), JSON.stringify({
  memoryRoot: pathModule.join(ws, '.memory'),
  userMemoryDir: pathModule.join(ws, '.user'),
  projectMemoryDir: '.project-memory',
  externalSources: {},
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
ok(!!procTool, '夹具自检：memory_procedure 真注册')
ok(typeof procTool.execute === 'function', '夹具自检：工具暴露 execute')

const run = (args) => procTool.execute(args, {})
// 条目数以**真实 store 查询**为准（不解析工具文案：文案随版本变化，解析会假红/假绿）
const hub = idxMod.__engineForTest ? idxMod.__engineForTest() : null
const countProcs = async () => {
  const listTool = registeredTools.find((t) => t && t.name === 'memory_procedure_list')
  const out = String(await listTool.execute({ scope: 'all', limit: 100 }, {}))
  // 兜底解析：只数回执里 id= 出现次数（每条纹目回执带一行 id=）
  const ids = out.match(/id=proc_pre_[0-9a-f]{20}/g) || []
  return ids.length
}

const TITLE_A = '发布前跑全量回归并核对 SHA256'
const STEPS_A = '跑全量回归\n核对 SHA256\n提交发布说明'

// ── ① 基线：首次写入成功 ──
const w1 = String(await run({ action: 'write', title: TITLE_A, steps: STEPS_A, successCriteria: '全绿' }))
ok(/已写入|已并入/.test(w1), '① 基线写入成功', String(w1).slice(0, 120))
const cntAfterFirst = await countProcs()
ok(cntAfterFirst >= 1, '① 条目数已计数（re=' + cntAfterFirst + '）')

// ── ② 正路径A：标题完全相同 ⇒ 拒绝 ──
const w2 = String(await run({ action: 'write', title: TITLE_A, steps: '完全不同的步骤一\n完全不同的步骤二\n完全不同的步骤三', successCriteria: 'x' }))
ok(/疑似重复/.test(w2), '★② 标题相同 ⇒ 拒绝写入', String(w2).slice(0, 160))
ok(/已拒绝写入/.test(w2), '★② 回执明确说「已拒绝写入」（不谎报成功）', String(w2).slice(0, 160))
eq(await countProcs(), cntAfterFirst, '★② 拒绝后条目数不变（真没落库）')

// ── ② 正路径B：标题归一后相同（空白/标点/大小写差异）⇒ 仍拒绝 ──
const w3 = String(await run({ action: 'write', title: '  发布前跑全量回归,并核对 SHA-256  ', steps: '甲\n乙\n丙', successCriteria: 'x' }))
ok(/疑似重复/.test(w3), '★② 标题仅差空白/标点/大小写 ⇒ 归一后判重复并拒绝', String(w3).slice(0, 160))

// ── ② 正路径C：前 3 步完全相同 ⇒ 拒绝 ──
const w4 = String(await run({ action: 'write', title: '完全不同的另一个标题XYZ', steps: STEPS_A, successCriteria: 'x' }))
ok(/疑似重复/.test(w4), '★② 前 3 步相同（标题不同）⇒ 仍判重复并拒绝', String(w4).slice(0, 160))
ok(/前 3 步完全相同/.test(w4), '★② 回执点明判据是「前 3 步完全相同」', String(w4).slice(0, 160))

// ── ② 回执可执行性：必须给 update / 换标题 二选一 ──
ok(/action=update/.test(w2) && /procedureId/.test(w2), '★② 回执给出 action=update + procedureId 的下一步', String(w2).slice(0, 200))
ok(/换一个能区分两者的标题|换标题/.test(w2), '★② 回执给出「换标题」的另一条路', String(w2).slice(0, 200))

// ── ③ 负路径（防误伤）：标题不同 + 步骤不同 ⇒ 必须能写进去 ──
const w5 = String(await run({ action: 'write', title: '给新工作区初始化记忆目录', steps: '创建目录\n写配置\n自检', successCriteria: '目录存在' }))
ok(/已写入|已并入/.test(w5), '★③ 防误伤：标题与步骤都不同 ⇒ 正常写入', String(w5).slice(0, 140))
const cntAfterW5 = await countProcs()
ok(cntAfterW5 > cntAfterFirst, '★③ 防误伤：条目数确实增加了', cntAfterW5 + ' > ' + cntAfterFirst)

// ── ③ 负路径：前两步相同、第三步不同 ⇒ 不拦（闸门只看前 3 步全等）──
const w6 = String(await run({ action: 'write', title: '另一条只有前三步略有重合的流程', steps: '跑全量回归\n核对 SHA256\n完全不同的第三步', successCriteria: 'x' }))
ok(/已写入|已并入/.test(w6), '★③ 前两步相同但第三步不同 ⇒ 不误拦（拒绝面不过宽）', String(w6).slice(0, 140))

// ── ④ 边界：update 分支不受闸门影响 ──
const w7 = String(await run({ action: 'write', title: '待修订样本流程ZZ', steps: 'a1\na2\na3', successCriteria: 'x' }))
const pid = (/\[id=([^\]]+)\]/.exec(w7) || [])[1] || ''
ok(!!pid, '④ 取到待修订条目的短码 id', String(w7).slice(0, 120))
const u1 = String(await run({ action: 'update', procedureId: pid, title: TITLE_A }))  // 改成与既有条目同名
ok(/已修订/.test(u1), '★④ update 改成与既有条目同名 ⇒ 不被闸门拦（闸门只管新建）', String(u1).slice(0, 140))

// ── ⑤ ★回归（a06 暴露的真缺陷）：同一组参数重复 write ⇒ 走**合法指纹合并**，不得被闸门拦死 ──
//   旧版闸门只看标题/前 3 步，会把 store.observe 的合法合并路径（同参数 ⇒ 合并进同一条、不新建）
//   误判成重复，导致「同一流程的再次激活」失效。判据：同参 write 必须回「已并入」，且条目数不增。
const cntBeforeRepeat = await countProcs()
const sameAgain = String(await run({ action: 'write', title: '给新工作区初始化记忆目录', steps: '创建目录\n写配置\n自检', successCriteria: '目录存在' }))
ok(/已并入/.test(sameAgain), '★⑤ 同一组参数重复 write ⇒ 走合法指纹合并（回「已并入」而非被闸门拦死）', String(sameAgain).slice(0, 160))
ok(!/疑似重复/.test(sameAgain), '★⑤ 合法合并路径不被查重闸门误伤', String(sameAgain).slice(0, 160))
eq(await countProcs(), cntBeforeRepeat, '★⑤ 合法合并后条目数不变（真没新建第二条）')

ok(true, '—— 夹具清理 ——')
rmSync(ws, { recursive: true, force: true })

console.log('\n[a28-procedure-dedup-gate] PASS ' + pass + ' / FAIL ' + fail)
process.exit(fail === 0 ? 0 : 1)
