/**
 * G3 结论层状态写入 · **接线锁**（源码级 + 行为级）
 *
 * 与 `smoke-test-note-status-pre.mjs` 的分工：
 *   - 那个验**形态**（语法/渲染/解析/剥离，纯函数）
 *   - 本套件验**接线**（index.js 是否真的把它接上、接在哪、缺一不可的每一环）
 *
 * 为什么接线必须单独锁：本仓铁律「源码接线正确 + 回归全绿 ≠ 功能存在」。
 * G3 的链路有**四个环**，缺任一环都表现为"静默无效果"：
 *   ① 写侧：`memory_note_pre` 收 `supersedes`/`restore` 参数
 *   ② 写侧：调用 `applyNoteStatusPre`
 *   ③ 读侧：`pushL0` 经 `statusOf` 解析磁盘状态
 *   ④ 读侧：语义臂同源传 `statusOf`
 * ④ 尤其易漏 —— 两臂不同源会让「词法臂能看见、语义臂看不见」。
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const LIB = new URL('../../lib/', import.meta.url)
const IDX = readFileSync(new URL('index.js', LIB), 'utf8').replace(/\r\n/g, '\n')

/** 剥注释（防注释误伤 —— 本仓纪律）。 */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}
const CODE = stripComments(IDX)

let pass = 0, fail = 0
const ok = (c, n, x) => { if (c) { pass++; console.log('  ok -', n) } else { fail++; console.error('  FAIL -', n, x == null ? '' : x) } }
async function t(name, fn) { try { await fn() } catch (e) { fail++; console.error('  THREW -', name, (e && e.stack) || e) } }

console.log('\n=== G3 接线锁 ===')

// ═══ 1. 写侧：工具 schema ═══
console.log('\n[1] 写侧 · memory_note_pre 参数')
await t('#1-1 收 supersedes / restore 两个可选参数', () => {
  ok(/supersedes:\s*\{\s*type:\s*'array'/.test(CODE), 'supersedes 参数已声明')
  ok(/restore:\s*\{\s*type:\s*'array'/.test(CODE), 'restore 参数已声明（撤销通道）')
})
await t('#1-2 ★ 两个参数都**非 required**（不传 ⇒ 行为与从前逐字节相同）', () => {
  const seg = CODE.slice(CODE.indexOf('supersedes: {'), CODE.indexOf('}, async (args, exec) => {', CODE.indexOf('supersedes: {')))
  ok(!/supersedes:[\s\S]{0,200}required:\s*true/.test(seg), 'supersedes 非必填')
  ok(!/restore:[\s\S]{0,200}required:\s*true/.test(seg), 'restore 非必填')
})

// ═══ 2. 写侧：调用点 ═══
console.log('\n[2] 写侧 · 调用与顺序')
await t('#2-1 调用 applyNoteStatusPre', () => {
  ok(/await engine\.applyNoteStatusPre\(/.test(CODE), '已接线调用')
})
await t('#2-2 ★ 只在显式传参时执行（否则零自动行为）', () => {
  // ★T6（2026-09-20）：G3 原本只锁两门 `sup || res`；T6 新增 retract 通道后门变成三门。
  //   语义**未变**（仍是"至少一个非空才执行"），但锁必须同步 —— 且此处**加严**：
  //   逐个断言三个参数都真的在门里，避免"门里漏掉某一个"这种静默失效。
  ok(/if \(sup\.length \|\| ret\.length \|\| res\.length\)/.test(CODE), '★ 有 `if (sup.length || ret.length || res.length)` 门')
  for (const v of ['sup', 'ret', 'res']) {
    ok(new RegExp('if \\([^)]*' + v + '\\.length[^)]*\\)').test(CODE), '★ 门内须含 ' + v + '.length')
  }
})
await t('#2-3 ★★ 顺序：**先写入笔记成功，再改状态**', () => {
  const iWrite = CODE.indexOf("body = await engine.appendText(p.notesPath")
  const iStatus = CODE.indexOf('await engine.applyNoteStatusPre(')
  ok(iWrite > 0 && iStatus > 0 && iStatus > iWrite,
    '★ 状态应用在笔记写入之后（写入失败就不该动状态 —— 防"新结论没进去、旧结论却被标废"）')
})
await t('#2-4 ★ 状态失败**不得影响**已成功的笔记写入', () => {
  ok(/catch \(e\) \{ statusNote = /.test(CODE), '有 try/catch 兜住')
  ok(!/applyNoteStatusPre[\s\S]{0,400}throw /.test(CODE.slice(CODE.indexOf('await engine.applyNoteStatusPre('), CODE.indexOf('await engine.applyNoteStatusPre(') + 400)),
    '调用点附近不抛')
})

// ═══ 3. 写侧：方法体纪律 ═══
console.log('\n[3] 写侧 · applyNoteStatusPre 实现纪律')
await t('#3-1 走既有写入通道（不绕过事务/备份）', () => {
  const i = CODE.indexOf('async applyNoteStatusPre(')
  ok(i > 0, '方法存在')
  const body = CODE.slice(i, i + 4000)
  ok(/await this\.writeFull\(notesPath, text\)/.test(body), '★ 用 writeFull（既有事务）')
  ok(!/writeFile\(notesPath/.test(body), '★ 未直接 writeFile 绕过通道')
})
await t('#3-2 ★ 只动目标条目（其余字节不变）', () => {
  const i = CODE.indexOf('async applyNoteStatusPre(')
  const body = CODE.slice(i, i + 4000)
  ok(/applyStatusToRecordPre\(/.test(body), '经纯函数生成新文（该函数保证其余字节不变）')
})
await t('#3-3 ★ 留痕（不新建状态源）', () => {
  const i = CODE.indexOf('async applyNoteStatusPre(')
  const body = CODE.slice(i, i + 4000)
  ok(/STATUS-CHANGES\.log/.test(body), '每次变更写一行留痕')
  ok(/appendText\(/.test(body), '走 append-only')
})
await t('#3-4 fail-soft：任何异常不抛出', () => {
  const i = CODE.indexOf('async applyNoteStatusPre(')
  const body = CODE.slice(i, i + 4000)
  ok(/catch \(e\) \{[\s\S]{0,300}return '\\n\(状态写入失败/.test(body), '★ 兜底返回说明而非抛出')
})

// ═══ 4. 读侧：★ 声明位置（本仓「标识符作用域」类缺陷） ═══
console.log('\n[4] 读侧 · 声明位置（★ 本轮实际踩到的坑）')
await t('#4-1 statusOfNotePre 在 recall 方法体顶层声明', () => {
  const iRecall = CODE.indexOf("async recall(query, limit = 8, agent, scope = 'all', opts = null) {")
  const iDecl = CODE.indexOf('const { readRecordStatusPre: statusOfNotePre }')
  const iL0 = CODE.indexOf('if (l0Mode) {', iRecall)
  ok(iRecall > 0, 'recall 方法存在')
  ok(iDecl > iRecall, '声明在 recall 内')
  ok(iDecl < iL0,
    '★★ 声明在 `if (l0Mode)` **之前**（放进分支 ⇒ 另一分支 ReferenceError ⇒ 语义臂静默失效）')
})
await t('#4-2 词法臂经 statusOf 读磁盘状态', () => {
  ok(/statusOf: \(id\) => statusOfNotePre\(text, id\)/.test(CODE), 'pushL0 注入 statusOf')
})
await t('#4-3 ★ 语义臂**同源**（缺它 ⇒ 两臂判据漂移）', () => {
  ok(/const st = typeof env\.statusOf === 'function'/.test(CODE), '语义臂接受 env.statusOf')
  ok(/statusOf: \(id\) => st\(text, id\)/.test(CODE), '★ 语义臂也注入 statusOf')
  ok(/statusOf: statusOfNotePre, createHash/.test(CODE), '★ 调用点把 statusOfNotePre 传进 env')
})

// ═══ 5. 契约：与外层一致性 ═══
console.log('\n[5] 契约一致性')
await t('#5-1 ★ 注入侧未被牵连（两处判据不同是有意为之）', async () => {
  const INJ = readFileSync(new URL('tier-layer-inject-pre.js', LIB), 'utf8')
  ok(INJ.includes('isCurrentPre'), '★ 注入侧仍用 isCurrentPre')
  ok(!INJ.includes('note-status-apply-pre'), '★ 注入侧未引入 G3 读侧（避免把过时条目装进常驻预算）')
})
await t('#5-2 memory_log_pre **零改动**（日志是流水，append 本正确）', () => {
  const i = CODE.indexOf("defineTool('memory_log_pre'")
  const j = CODE.indexOf("defineTool('memory_note_pre'")
  const seg = CODE.slice(i, j)
  ok(!/supersedes|restore|applyNoteStatusPre|note-status/.test(seg),
    '★ 日志工具段内**零** G3 痕迹（设计稿硬约束）')
})

console.log('\n--- g3-wire 回归锁 ---')
console.log('pass=' + pass + ' fail=' + fail)
process.exit(fail ? 1 : 0)
