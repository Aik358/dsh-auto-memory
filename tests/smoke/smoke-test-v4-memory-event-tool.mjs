#!/usr/bin/env node
/**
 * smoke-test-v4-memory-event-tool.mjs —— 批次 B：memory_event 工具的行为验收。
 *
 * ⚠️ 抽取方式说明（为什么不用 import 拿 tools）：`tools` 是 `apply()` 内的**局部 const**，
 *    模块不导出它（导出会让生产代码外泄内部结构）。故沿用本仓既有的「源码抽取 + new Function」范式：
 *    把产线里那段 `defineTool('memory_event', …)` **原文抽出来**，用一个只做捕获的 stub defineTool 求值，
 *    得到的 execute 就是**产线同一份代码**；再用真 eventStorePre（真 import）跑真调用。
 *    断言对象是 execute 的**返回值与磁盘副作用**，不是「源码里有没有某字符串」。
 */
import { mkdtempSync, rmSync, mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { eventStorePre } from '../../lib/event-store.js'

let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  PASS ' + m) } else { fail++; console.log('  FAIL ' + m) } }
const eq = (a, b, m) => ok(Object.is(a, b), m + '  (got=' + JSON.stringify(a) + ' want=' + JSON.stringify(b) + ')')
const has = (s, sub, m) => ok(String(s).includes(sub), m)

const HERE = path.dirname(fileURLToPath(import.meta.url))
const IDX = readFileSync(path.resolve(HERE, '..', '..', 'lib', 'index.js'), 'utf8')

// 抽取 defineTool('memory_event', …) 的完整调用（括号配平，从 defineTool( 起到匹配的 ) 止）
const START = IDX.indexOf("defineTool('memory_event'")
if (START < 0) { console.log('  FAIL 未找到 memory_event 定义'); process.exit(1) }
let i = IDX.indexOf('(', START), depth = 0, end = -1
for (; i < IDX.length; i++) {
  const ch = IDX[i]
  if (ch === '(') depth++
  else if (ch === ')') { depth--; if (depth === 0) { end = i + 1; break } }
}
const callSrc = IDX.slice(START, end)
ok(callSrc.length > 1000, '抽取到 memory_event 定义（' + callSrc.length + ' 字符）')

// 用捕获型 stub defineTool 求值：拿到 name / desc / params / execute。
// engine 必须作为**工厂参数**注入 —— 抽取出来的代码体里引用了闭包变量 engine，
// 不给它就只能落成 ReferenceError（这是抽取式测试的通用纪律）。
const refreshCalls = { n: 0 }
const engineForTool = {
  resolvePaths: async () => ({ handoffDir: null, projectDir: null, ws: null }),
  refreshEventStatePre: async () => { refreshCalls.n++ },
}
let captured = null
const defineToolStub = (name, desc, params, execute) => { captured = { name, desc, params, execute }; return captured }
const factory = new Function('defineTool', 'eventStorePre', 'V4_EVENT_STORE_FILENAME', 'path', 'engine',
  'return (' + callSrc + ')')
const tool = factory(defineToolStub, eventStorePre, 'event-store.json', path, engineForTool)
ok(!!tool && tool.name === 'memory_event', '求值得到 memory_event 工具')

console.log('[B-1] schema 形状：checkpoint 必须是 type:object（defineTool 只透传 type/description）')
const props = tool.params
eq(props.checkpoint.type, 'object', 'checkpoint 声明为 object')
ok(!props.checkpoint.properties, '负：没有 properties（defineTool 会丢掉它，写了也是假象）')
ok(/idemKey/.test(props.checkpoint.description), 'idemKey 语义写在 description 里（唯一能传给模型的地方）')
eq(props.action.enum.join(','), 'create,set,append,close,rename', 'action 五值枚举')
eq(props.action.required, true, 'action 必填')
ok(/append-only/.test(tool.desc), 'description 写明 append-only 约束')

const root = mkdtempSync(path.join(tmpdir(), 'dam-v4-memevt-'))
const handoffDir = path.join(root, 'handoff')
mkdirSync(handoffDir, { recursive: true })
// （engine 已在抽取前定义；这里只把它的 resolvePaths 指向真实临时目录）
engineForTool.resolvePaths = async () => ({ handoffDir, projectDir: root, ws: root })
const exec = { agent: { session: { id: 's1', header: { cwd: root } } } }
const call = (args) => tool.execute(args, exec)
const storePath = path.join(handoffDir, 'event-store.json')

async function main() {
  console.log('[B-2] create：真调用 → 返回 evt_id + 落盘')
  const r1 = await call({ action: 'create', name: '批次 B 验收事件', summary: '验证 memory_event 工具', sections: { goal: '验证工具' } })
  has(r1, '事件已建立', 'create 返回成功文案')
  const m = /evt_[0-9a-f]{8}/.exec(r1)
  ok(!!m, '返回里含 evt_<8hex>（实测 ' + (m && m[0]) + '）')
  const id = m[0]
  const store1 = JSON.parse(readFileSync(storePath, 'utf8'))
  eq(store1.events.length, 1, '落盘 1 个事件')
  eq(store1.events[0].id, id, '落盘 id 与返回一致')
  eq(store1.events[0].sections.goal, '验证工具', 'sections 已写入')
  ok(refreshCalls.n >= 1, 'create 后触发了注入面刷新（' + refreshCalls.n + ' 次）')

  console.log('[B-3] append：真调用 → 检查点落盘；idemKey 二次 ⇒ 去重')
  const r2 = await call({ action: 'append', eventId: id, checkpoint: { kind: 'progress', text: '第一条检查点', idemKey: 'b-k1' } })
  has(r2, '+1', 'append 返回值显示 +1')
  const r2b = await call({ action: 'append', eventId: id, checkpoint: { kind: 'progress', text: '重试同一条', idemKey: 'b-k1' } })
  has(r2b, '已去重', '负路径：同 idemKey 二次 ⇒ 明确告知已去重')
  const store2 = JSON.parse(readFileSync(storePath, 'utf8'))
  eq(store2.events[0].checkpoints.length, 1, '磁盘上仍只有 1 个检查点')
  const r2c = await call({ action: 'append', eventId: id, constraint: 'rule:R12' })
  has(r2c, '+1', 'append constraint 也 +1')
  eq(JSON.parse(readFileSync(storePath, 'utf8')).events[0].constraints.length, 1, 'constraint 落盘')
  const r2d = await call({ action: 'append', eventId: id, userPercept: { kind: 'preference', stage: 'accepted', text: '用户认可' } })
  has(r2d, '+1', 'append userPercept 也 +1')
  eq(JSON.parse(readFileSync(storePath, 'utf8')).events[0].userPercept.length, 1, 'userPercept 落盘')

  console.log('[B-4] set / close / rename：真调用 + 负路径')
  const r3 = await call({ action: 'set', eventId: id, summary: '改过的摘要', sections: { doing: '进行中X' } })
  has(r3, '事件已更新', 'set 返回成功')
  const s4 = JSON.parse(readFileSync(storePath, 'utf8')).events[0]
  eq(s4.summary, '改过的摘要', 'summary 已更新')
  eq(s4.sections.doing, '进行中X', 'sections.doing 已更新')
  has(await call({ action: 'set', eventId: id, status: 'nonsense' }), '失败', '负：非法 status ⇒ 返回失败文案（不抛）')
  has(await call({ action: 'close', eventId: id }), '失败', '负：close 缺 outcome ⇒ 返回失败文案')
  has(await call({ action: 'close', eventId: id, outcome: '工具验收通过' }), '事件已收口', 'close 成功')
  has(await call({ action: 'append', eventId: id, checkpoint: { kind: 'log', text: 'closed 后' } }), '失败', '负：closed 事件 append ⇒ 返回失败文案')
  has(await call({ action: 'rename', eventId: id, name: '改名后的事件' }), '事件已改名', 'rename 成功')
  const s5 = JSON.parse(readFileSync(storePath, 'utf8')).events[0]
  eq(s5.name, '改名后的事件', 'name 已改')
  eq(s5.id, id, 'id 未变')

  console.log('[B-5] 负路径：缺参 / 未知 action / 不存在的事件')
  has(await call({ action: 'append', checkpoint: { kind: 'log', text: 'x' } }), '需要 eventId', '负：append 缺 eventId')
  has(await call({ action: 'set', eventId: id }), '至少要改一个字段', '负：set 无字段')
  has(await call({ action: 'bogus' }), '未知 action', '负：未知 action')
  has(await call({ action: 'append', eventId: 'evt_ffffffff', checkpoint: { kind: 'log', text: 'x' } }), '失败', '负：事件不存在')
  has(await call({ action: 'create', name: '   ' }), '失败', '负：create 空名')

  console.log('[B-6] 守卫（非功能证据）：5 处文档计数已同步到 20 工具')
  const docs = ['docs/WHITEPAPER.md', 'docs/HOMEPAGE-CONTENT-FOR-GM53.md', 'docs/FRONTEND-CO-CREATION.md', 'README.md', 'README.zh-CN.md']
  const cwd = path.resolve(HERE, '..', '..')
  let missing = []
  for (const f of docs) {
    const s = readFileSync(path.join(cwd, f), 'utf8')
    if (!/20/.test(s)) missing.push(f)
  }
  eq(missing.length, 0, '守卫：5 处文档都含新计数（缺：' + (missing.join(',') || '无') + '）')

  console.log('')
  console.log('[B] ' + pass + ' PASS / ' + fail + ' FAIL')
  rmSync(root, { recursive: true, force: true })
  process.exit(fail ? 1 : 0)
}
main().catch((e) => { console.log('  FAIL 套件异常: ' + ((e && e.stack) || e)); try { rmSync(root, { recursive: true, force: true }) } catch (_) {} ; process.exit(1) })