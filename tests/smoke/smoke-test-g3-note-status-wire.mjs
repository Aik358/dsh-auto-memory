/**
 * G3 结论层状态写入 · **接线锁**（源码级 + 行为级）
 *
 * 与 `smoke-test-note-status.mjs` 的分工：
 *   - 那个验**形态**（语法/渲染/解析/剥离，纯函数）
 *   - 本套件验**接线**（index.js 是否真的把它接上、接在哪、缺一不可的每一环）
 *
 * 为什么接线必须单独锁：本仓铁律「源码接线正确 + 回归全绿 ≠ 功能存在」。
 * G3 的链路有**四个环**，缺任一环都表现为"静默无效果"：
 *   ① 写侧：`memory_note` 收 `supersedes`/`restore` 参数
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
console.log('\n[1] 写侧 · memory_note 参数')
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
  // ★2026-10-01 判据更新（移植上游 #162）：catch 块内先落诊断再赋值 statusNote，不再是单行写法。
  //   判据从「字面单行」改为「语义等价」：catch 块内必须给 statusNote 赋兜底文案。
  ok(/catch \(e\) \{[\s\S]{0,400}?statusNote = /.test(CODE), '有 try/catch 兜住(且给 statusNote 兜底)')
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
  // ★2026-10-01 判据更新（移植上游 #162）：catch 内新增 recordDiagnosticErrorPre 落诊断，
  //   再依据 statusSaved 二分返回兜底文案；判据改为「catch 内最终返回兜底说明、且不抛」。
  ok(/catch \(e\) \{[\s\S]{0,600}?return statusSaved[\s\S]{0,200}?状态写入失败/.test(body)
    && !/catch \(e\) \{[\s\S]{0,600}?throw /.test(body), '★ 兜底返回说明而非抛出')
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
  const INJ = readFileSync(new URL('tier-layer-inject.js', LIB), 'utf8')
  ok(INJ.includes('isCurrentPre'), '★ 注入侧仍用 isCurrentPre')
  ok(!INJ.includes('note-status-apply-pre'), '★ 注入侧未引入 G3 读侧（避免把过时条目装进常驻预算）')
})
await t('#5-2 memory_log **零改动**（日志是流水，append 本正确）', () => {
  const i = CODE.indexOf("defineTool('memory_log'")
  const j = CODE.indexOf("defineTool('memory_note'")
  const seg = CODE.slice(i, j)
  ok(!/supersedes|restore|applyNoteStatusPre|note-status/.test(seg),
    '★ 日志工具段内**零** G3 痕迹（设计稿硬约束）')
})


// ═══ 6. ★ 运行时产物：真实注册的 tool 定义 ═══
// ★2026-10-04（Gemini 路由 HTTP 400 事故）：本仓**已有**产物断言（smoke-test.mjs:88-90 查注册产物
//   memory_log.parameters、graph-mode.mjs:95-101 查 expand/trace 产物、issue164-plan-tools.mjs:18
//   查 read.kind.enum / note.expectedRevision / note.cardId），但**没有任何一条覆盖 `items` 透传**。
//   `defineTool` 把 spec 表**重建**成 JSON Schema，它不透传某个键，源码写得再对产物里也没有 ——
//   `items` 就是这么丢的：memory_note 的 4 个 array 参数在产物里退化成 `{ type: 'array' }`，
//   Google Vertex 校验 function declaration 时**直接拒**整轮请求：
//     GenerateContentRequest.tools[0].function_declarations[N].parameters.properties[X].items: missing field
//   ⇒ 本段补的正是这条缺口，走仓库既有路子：**真实 apply 后从注册产物上断言**。
//   ★为什么不用"正则提取源码 + new Function 求值"：那个方案已被实测证伪 —— 剥注释的正则不是词法器，
//     会删掉字符串里的 `/*` `//`（`items.description:'/*must preserve*/'` 变成空串）、漏掉
//     `defineTool ('x', …)` 这种合法写法、把模板插值名当字面名；更糟的是下面这个反例里
//        const marker1='/*';  defineTool('future','d',{x:{type:'array'}},()=>{});  const marker2='*/';
//     剥注释会把**真调用一起删掉** ⇒ 提取数与裸计数同时少一个，"两边相同"照样假绿。
//   ★为什么采集要放进 worker（同进程方案已被实证否掉）：apply 启动的异步任务
//     （末尾的 void engine.checkUpdate(false) → 真网络、fetchNotices、diag 写盘）在 apply 返回后才跑，
//     同进程里一旦恢复 globals 或删临时目录就会与之竞争 —— 实测会打到真实网络、rm 抛 ENOTEMPTY
//     并重建目录、还会残留 3 个进程监听器。worker 独占 stub 与临时 home，采集完即 terminate，
//     父进程随后删目录不存在竞争。详见 tests/lib/collect-tool-schemas.mjs 的段首注释。
//   判据只覆盖**已证实**的形态：`items` 缺失已实测被 Vertex 拒并导致整轮 400；`items` 不是对象
//   （true / 'junk'）被本机 DSH 的 assertSupportedJsonSchema 拒（"must be a schema object"）。
//   而 `items: {}` 在 DSH 侧合法（它就是原始 schema 里"任意 JSON"的写法），Vertex 对它的行为
//   **未证实**，故只作提示、不计失败。注意本段**不声称**是完整合法性验证 —— 例如 `{evil:1}`
//   这类"非法关键词对象"只有 DSH 校验器才认得出，这里不做等价断言。
console.log('\n[6] 运行时产物 · 真实注册的 tool schema（★ 防"源码对、产物缺"）')

const REGISTERED_TOOLS = []
/** armAutoContinue 守卫探针的回收结果（由 worker 回传）。 */
let ARM_PROBE = null
{
  const { mkdtemp, rm } = await import('node:fs/promises')
  const osMod = await import('node:os')
  const pathMod = await import('node:path')
  const { Worker } = await import('node:worker_threads')
  const root6 = await mkdtemp(pathMod.join(osMod.tmpdir(), 'dam-g3-tools-'))
  const worker = new Worker(new URL('../lib/collect-tool-schemas.mjs', import.meta.url), {
    workerData: { home: root6 },
  })
  let collected = null
  try {
    collected = await new Promise((resolve, reject) => {
      worker.once('message', resolve)
      worker.once('error', reject)
    })
  } catch (e) {
    // worker 失败不向上抛：让 #6-1~#6-5 以正常 FAIL 计入套件统计，而非未捕获异常中断整个文件
    console.log('  note - 采集 worker 失败：' + String((e && e.message) || e))
  } finally {
    await worker.terminate() // 残留的启动异步任务随 worker 一起消失（这是同进程方案给不了的确定性）
  }
  for (const t of (collected && collected.tools) || []) REGISTERED_TOOLS.push(t)
  ARM_PROBE = (collected && collected.armProbe) || null
  // worker 已终止 ⇒ 删临时目录不再与写盘竞争
  try { await rm(root6, { recursive: true, force: true }) } catch { /* 删不掉就留给系统清理，不让套件失败 */ }
}

/** JSON Schema 的基本类型（本机 DSH 校验器实测：type:'json' 之类的自定义名会被拒）。 */
const BASE_TYPES = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null'])
/** items 必须是**对象**：DSH 接受 `{}`（任意 JSON）与 `{description}`，拒绝 true/'junk'（不是 schema 对象）。 */
const validItems = (it) => !!it && typeof it === 'object' && !Array.isArray(it)
/** 空 items 对象：DSH 合法、Vertex 未证实 —— 提示而非失败。 */
const isEmptyItemsObj = (it) => validItems(it) && Object.keys(it).length === 0

/** 递归收集问题节点：array 缺合法 items、以及非法的 type 取值（含嵌套 properties / items / 组合子）。 */
function collectSchemaProblems(node, where, out) {
  if (!node || typeof node !== 'object') return
  if (node.type !== undefined && !BASE_TYPES.has(node.type)) {
    out.push(where + '：type=' + JSON.stringify(node.type) + ' 不是 JSON Schema 基本类型')
  }
  if (node.type === 'array' && !validItems(node.items)) {
    out.push(where + '：array 的 items=' + JSON.stringify(node.items) + '（缺失或不是对象）')
  }
  for (const [k, v] of Object.entries(node.properties || {})) collectSchemaProblems(v, where + '.' + k, out)
  if (node.items && typeof node.items === 'object') collectSchemaProblems(node.items, where + '[]', out)
  for (const kw of ['oneOf', 'anyOf', 'allOf']) {
    const branches = node[kw]
    if (Array.isArray(branches)) branches.forEach((v, i) => collectSchemaProblems(v, where + '.' + kw + '[' + i + ']', out))
  }
}
/** 递归收集"空 items 对象"的 array 节点（提示用，含组合子）。 */
function collectEmptyItemsNodes(node, where, out) {
  if (!node || typeof node !== 'object') return
  if (node.type === 'array' && isEmptyItemsObj(node.items)) out.push(where)
  for (const [k, v] of Object.entries(node.properties || {})) collectEmptyItemsNodes(v, where + '.' + k, out)
  if (node.items && typeof node.items === 'object') collectEmptyItemsNodes(node.items, where + '[]', out)
  for (const kw of ['oneOf', 'anyOf', 'allOf']) {
    const branches = node[kw]
    if (Array.isArray(branches)) branches.forEach((v, i) => collectEmptyItemsNodes(v, where + '.' + kw + '[' + i + ']', out))
  }
}

await t('#6-1 真实 apply 后拿到注册产物（断言对象是插件交给 DSH 的那一份）', () => {
  ok(REGISTERED_TOOLS.length >= 19, '注册工具 ' + REGISTERED_TOOLS.length + ' 个（≥19）')
  ok(REGISTERED_TOOLS.every((x) => x && x.parameters && x.parameters.type === 'object'),
    '每个注册工具的 parameters 都是 object root')
  ok(REGISTERED_TOOLS.filter((x) => x.name === 'memory_note').length === 1, 'memory_note 恰好注册一次')
})

await t('#6-2 ★★★ memory_note 的 4 个 array 参数在产物里带 items.type=string（Gemini 400 的直接成因）', () => {
  const note = REGISTERED_TOOLS.find((x) => x.name === 'memory_note')
  ok(!!note, 'memory_note 已注册')
  if (!note) return
  for (const key of ['supersedes', 'retract', 'restore', 'archivedIds']) {
    const p = note.parameters.properties[key]
    ok(!!p && p.type === 'array', 'memory_note.' + key + ' 是 array')
    ok(!!p && !!p.items && p.items.type === 'string', '★ memory_note.' + key + '.items.type === string')
  }
})

await t('#6-3 ★★ 全部注册产物里，array 节点的 items 必须存在且是对象（递归，含嵌套与组合子）', () => {
  const bad = []
  for (const x of REGISTERED_TOOLS) collectSchemaProblems(x.parameters, x.name, bad)
  ok(bad.length === 0, '★ 无 array 缺 items / items 不是对象 / 非法 type' + (bad.length ? '；违规：' + bad.join('；') : ''))
})

await t('#6-4 ★ 注册的工具名稳定（防注册退化被静默吞掉）', () => {
  const names = REGISTERED_TOOLS.map((x) => x.name).sort()
  ok(names.includes('memory_note') && names.includes('memory_read') && names.includes('memory_expand'),
    '核心工具都在（memory_note / memory_read / memory_expand）')
  ok(new Set(names).size === names.length, '工具名无重复（' + names.length + ' 个）')
})

await t('#6-5 ★★ armAutoContinue 必须拒绝子代理会话、且不误伤普通会话', () => {
  ok(!!ARM_PROBE, '探针已回传')
  if (!ARM_PROBE) return
  ok(ARM_PROBE.ok === true, '探针执行无异常' + (ARM_PROBE.error ? '：' + ARM_PROBE.error : ''))
  ok(ARM_PROBE.hasEngine === true, '已捕获 MemoryEngine 实例')
  ok(ARM_PROBE.armedForSubAgent === false,
    '★ 子代理会话不得 arm（否则接续走通用 session 路由必被宿主拒，且失败不落闩 ⇒ 反复报错）')
  ok(ARM_PROBE.armedForNormal === true, '普通会话仍能 arm（守卫未误伤正常路径）')
})

console.log('\n--- g3-wire 回归锁 ---')
console.log('pass=' + pass + ' fail=' + fail)
process.exit(fail ? 1 : 0)
