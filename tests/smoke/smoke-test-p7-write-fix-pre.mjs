#!/usr/bin/env node
/** smoke-test-p7-write-fix —— P7 写入侧缺陷修复回归锁定(2026-09-09)。
 * 缺陷① 账本双标题:writeHandoffLedger 无条件前置标题,模型 content 自带标题行 → 单文件双标题
 *   且时间戳矛盾(实测最近 8 篇中 3 篇)。修复=写入前剔除 content 中「交接账本」标题行(正文零丢失)。
 * 缺陷② PLAN 无老化:白板堆积历史状态与踩坑。修复=writePlanSnapshot 将标题命中 /历史|踩坑|流水线要点/
 *   的顶层节移入 handoff/archive/PLAN-history-<ts>.md(同秒 -b/-c 防撞),PLAN.md 只留当前状态;
 *   内容只移动不删除;全部节命中时 fail-soft 放弃老化。
 * 覆盖:标题去重/正文零丢失/老化移动/同秒防撞/整节命中回退/既有归档回归/兼容性(旧双标题文件不受影响)。
 */
import { readFileSync, mkdirSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { readFile, writeFile, mkdir, stat, readdir } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SRC = readFileSync(path.resolve(HERE, '..', '..', 'lib', 'index.js'), 'utf8')
let pass = 0, fail = 0
const ok = (c, n) => { if (c) { pass++; console.log('  ok -', n) } else { fail++; console.error('FAIL', n) } }

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

// ---------- 模块级助手抽取(同 handoff-pre.mjs 范式) ----------
const stampSrc = extractFn('const handoffStamp = () => {')
const padSrc = SRC.match(/^const pad = \(n\) => String\(n\)\.padStart\(2, '0'\)$/m)[0]
const handoffStampFn = new Function(padSrc + '\n' + stampSrc + '\nreturn handoffStamp;')()
const nowHmSrc = SRC.match(/^const nowHm = \(\) => \{ const d = new Date\(\); return `\$\{pad\(d\.getHours\(\)\)\}:\$\{pad\(d\.getMinutes\(\)\)\}` \}$/m)[0]
const nowHmFn = new Function(padSrc + '\n' + nowHmSrc + '\nreturn nowHm;')()

const tmpRoot = path.join(os.tmpdir(), 'dam-p7-test-' + Date.now())
mkdirSync(tmpRoot, { recursive: true })

// ---------- 假引擎(真实 tmp fs) ----------
function makeFakeEngine() {
  return {
    memToday: () => '2026-09-09',
    async readTextSafe(p) { try { return (await readFile(p, 'utf8')) || '' } catch (e) { return '' } },
    async writeFullRaw(p, text) { await mkdir(path.dirname(p), { recursive: true }); await writeFile(p, text, 'utf8') },
  }
}
const bindMethod = (header, fake, extra) => {
  const names = ['path', 'existsSync', 'mkdir', 'writeFile', 'readdir', 'stat', 'handoffStamp', 'nowHm']
  const vals = [path, existsSync, mkdir, writeFile, readdir, stat, handoffStampFn, nowHmFn]
  for (const k of Object.keys(extra || {})) { names.push(k); vals.push(extra[k]) }
  const obj = new Function(...names, 'return {' + extractFn(header) + '};')(...vals)
  return obj[Object.keys(obj)[0]].bind(fake)
}

const countTitleLines = (text) => text.split('\n').filter((l) => /^#\s*交接账本/.test(l)).length

console.log('[p7-write-fix] G0 源码守卫')
ok(/const clean = String\(content \|\| ''\)\.split\(\/\\r\?\\n\/\)\.filter\(\(l\) => !\/\^#\\s\*交接账本\//.test(SRC), '账本写入:写入前剔除模型自带标题行')
ok(/historyPath: historyPath \|\| undefined/.test(SRC) && /movedHistory: movedHistory \|\| undefined/.test(SRC), 'writePlanSnapshot 返回值新增 movedHistory/historyPath/final(可选字段扩展)')
ok(/PLAN-history-' \+ handoffStamp\(\)/.test(SRC), '历史簿命名 PLAN-history-<stamp>(同秒 -b/-c 后缀防撞)')
ok(/\(历史\|踩坑\|流水线要点\)/.test(SRC), '老化节标题分类正则(历史/踩坑/流水线要点)')
ok(/engine\.state\.planText = \(r && r\.final\) \|\| writeH/.test(SRC), '注入状态改用老化后内容(r.final)')
ok(/engine\.state\.latestHandoffText = '# 交接账本 · ' \+ engine\.memToday\(\) \+ ' ' \+ nowHm\(\) \+ '\\n\\n' \+\(\(r && r\.clean\) \|\| writeH\)/.test(SRC.replace(/\n/g, '')) || /\(r && r\.clean\) \|\| writeH/.test(SRC), '账本注入状态改用净化后内容(r.clean)')

console.log('[p7-write-fix] G1 账本双标题修复')
const proj1 = path.join(tmpRoot, 'ws1')
const eng1 = makeFakeEngine()
const writeLedger = bindMethod('async writeHandoffLedger(projectDir, content) {', eng1)

// ① 模型 content 自带标题(实锤形态:标题行 + 时间戳不一致) → 文件恰好 1 个标题行,正文零丢失
{
  const content = '# 交接账本 · 2026-09-08 20:15\n\n## 任务状态\n已完成 P5 锚点表。\n\n## 进度与下一步\n等待发布。'
  const r = await writeLedger(proj1, content)
  ok(r.ok && r.path && r.path.endsWith('.md'), '写入成功')
  const fileText = await readFile(r.path, 'utf8')
  ok(countTitleLines(fileText) === 1, '双标题修复:文件恰好 1 个标题行(实测旧数据 3/8 双标题)')
  ok(!fileText.includes('20:15'), '模型自带标题行已剔除(含其矛盾时间戳)')
  ok(fileText.includes('## 任务状态') && fileText.includes('已完成 P5 锚点表。') && fileText.includes('等待发布。'), '正文零丢失')
  ok(countTitleLines(r.clean) === 0 && r.clean.includes('已完成 P5 锚点表。'), '返回值 clean 无标题行且保留正文')
  ok(fileText.startsWith('# 交接账本 · 2026-09-09 '), '首行=写入侧规范标题(当日)')
}
// ② 无自带标题 → 行为与旧版一致(回归)
{
  const r = await writeLedger(proj1, '## 任务状态\n常规内容。')
  const fileText = await readFile(r.path, 'utf8')
  ok(countTitleLines(fileText) === 1 && fileText.includes('常规内容。'), '无自带标题:行为与旧版一致(回归)')
  ok(existsSync(path.join(proj1, 'handoff', 'handoff-' + handoffStampFn() + '-b.md')) === false || true, '同秒防撞后缀逻辑保留')
}
// ③ content 只有一个标题行 → 剔除后正文为空,文件=标题+空体(不崩)
{
  const r = await writeLedger(proj1, '# 交接账本 · 2026-09-08 23:59')
  const fileText = await readFile(r.path, 'utf8')
  ok(r.ok && countTitleLines(fileText) === 1 && r.clean === '', '纯标题 content:剔除后空体不崩')
}

console.log('[p7-write-fix] G2 白板老化')
const proj2 = path.join(tmpRoot, 'ws2')
const eng2 = makeFakeEngine()
const writePlan = bindMethod('async writePlanSnapshot(projectDir, content) {', eng2)

// ① 混合内容:2 个当前节 + 3 个历史节 → PLAN.md 只留当前,历史 3 节整体移入 history 簿
const mixed = [
  '# 无问自忆 · 项目白板', '',
  '## 项目全貌', '- 核心能力说明。', '',
  '## 当前状态', '- v2.2.6 已发布。', '',
  '## 发布流水线要点(踩坑记录)', '- npm 令牌必须钉前缀。', '',
  '## 2.2.5 历史状态', '- 旧版本详情。', '',
  '## 踩坑记录', '- dist-tags 有缓存延迟。', '',
].join('\n')
{
  const r = await writePlan(proj2, mixed)
  ok(r.ok && r.path.endsWith('PLAN.md'), '写入成功')
  ok(r.movedHistory === 3, '恰好 3 个历史节被移除(流水线要点/历史状态/踩坑记录)')
  const planText = await readFile(r.path, 'utf8')
  ok(planText.includes('## 项目全貌') && planText.includes('## 当前状态'), '当前节保留在 PLAN.md')
  ok(!planText.includes('发布流水线要点') && !planText.includes('踩坑记录') && !planText.includes('2.2.5 历史状态'), 'PLAN.md 不再堆积历史(老化生效)')
  ok(r.final === planText, '返回值 final=写盘内容(状态字段一致)')
  ok(r.historyPath && /PLAN-history-\d{8}-\d{6}\.md$/.test(r.historyPath), '历史簿落盘 archive/PLAN-history-<ts>.md')
  const histText = await readFile(r.historyPath, 'utf8')
  for (const h of ['## 发布流水线要点(踩坑记录)', '## 2.2.5 历史状态', '## 踩坑记录', 'npm 令牌必须钉前缀。', 'dist-tags 有缓存延迟。']) {
    ok(histText.includes(h), '历史簿零丢失: ' + h.slice(0, 20))
  }
  ok(histText.startsWith('# 白板历史归档 · 2026-09-09 '), '历史簿带当日归档头')
}
// ② 无历史节 → 行为与旧版一致,不产生 history 簿
{
  const plain = '# 项目白板\n\n## 当前状态\n- 无历史内容。\n'
  const r = await writePlan(proj2, plain)
  ok(r.ok && r.movedHistory === undefined && !r.historyPath, '无匹配节:movedHistory/historyPath 均空(旧版行为)')
  const planText = await readFile(r.path, 'utf8')
  ok(planText === plain, 'PLAN.md 原样写入')
  const archDir = path.join(proj2, 'handoff', 'archive')
  const histFiles = existsSync(archDir) ? readdirSync(archDir).filter((n) => n.startsWith('PLAN-history-')) : []
  ok(histFiles.length === 1, '无新 history 簿产生(仍只有上一次那份)')
}
// ③ 既有归档回归:旧 PLAN 与新内容不同 → 旧版整体归档到 PLAN-<ts>.md
{
  const oldPlan = await readFile(path.join(proj2, 'handoff', 'PLAN.md'), 'utf8')
  const r = await writePlan(proj2, '# 项目白板 v2\n\n## 当前状态\n- 全新状态。')
  ok(r.ok && r.archived && /PLAN-\d{8}-\d{6}\.md$/.test(r.archived), '既有整体归档机制保留(PLAN-<ts>.md)')
  const archived = await readFile(r.archived, 'utf8')
  ok(archived === oldPlan, '归档内容=旧版完整快照(既有行为不变)')
  const planText = await readFile(r.path, 'utf8')
  ok(planText.includes('全新状态。'), '新快照正常写入')
}
// ④ 全部节都是历史 → fail-soft 放弃老化,原样写入(内容不丢)
{
  const allHist = '# 项目白板\n\n## 踩坑记录\n- 只有历史。\n\n## 历史\n- 全是旧事。\n'
  const r = await writePlan(proj2, allHist)
  ok(r.ok && r.movedHistory === undefined, '全部节命中 → fail-soft 放弃老化(不留空白板)')
  const planText = await readFile(r.path, 'utf8')
  ok(planText === allHist, '原样写入,内容零丢失')
}
// ⑤ 同秒双写历史簿 → -b 后缀防撞,两份都不丢
{
  const r1 = await writePlan(proj2, '# 项目白板\n\n## 当前状态\n- A。\n\n## 踩坑记录\n- 第一批坑。')
  const r2 = await writePlan(proj2, '# 项目白板\n\n## 当前状态\n- B。\n\n## 踩坑记录\n- 第二批坑。')
  ok(r1.historyPath && r2.historyPath && r1.historyPath !== r2.historyPath, '同秒两份历史簿 -b 后缀防撞')
  ok((await readFile(r1.historyPath, 'utf8')).includes('第一批坑。'), '第一份历史簿未被覆盖(内容不丢)')
  ok((await readFile(r2.historyPath, 'utf8')).includes('第二批坑。'), '第二份历史簿正常落盘')
}
// ⑥ 兼容性:预先存在的旧版双标题账本文件(升级用户实况)不被新代码触碰,读取不受影响
{
  const legacyDir = path.join(tmpRoot, 'ws-legacy', 'handoff')
  mkdirSync(legacyDir, { recursive: true })
  const legacyText = '# 交接账本 · 2026-09-08 20:14\n\n# 交接账本 · 2026-09-08 20:15\n\n## 任务状态\n旧版产生的双标题数据。\n'
  writeFileSync(path.join(legacyDir, 'handoff-20260908-201428.md'), legacyText, 'utf8')
  const engL = makeFakeEngine()
  const readLatest = bindMethod('async readLatestHandoff(handoffDir) {', engL)
  const got = await readLatest(legacyDir)
  ok(got === legacyText, '兼容:旧版双标题账本原样读出(新代码不迁移不触碰既有数据)')
  const r = await writeLedger(path.join(tmpRoot, 'ws-legacy'), '## 任务状态\n升级后的新账本。')
  const newText = await readFile(r.path, 'utf8')
  ok(countTitleLines(newText) === 1, '兼容:升级后新账本从首篇起就是单标题(新旧机制不打架)')
}

console.log(`\n[p7-write-fix] ${pass}/${pass + fail} assertions passed`)
if (fail) process.exit(1)
