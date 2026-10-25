/**
 * smoke-test-task35-workspace-session.mjs —— task-35 缺陷 B：白板必须取「本会话所属工作区」
 *
 * 真缺陷（用户实报「工作区还是取错」+ Lead 真机证据）：
 *   /event-list 返回 _resolved = { ws: "...aik_auto_memory_use", fallbackCompat: true }
 *   ⇒ ① 前端没传 sessionId（currentSessionIdClient() 返回空串）
 *      ② 即使不空，mainViewSessionIdClient() 也是「retainedBy.mainView>0 里 updatedAt 最大」
 *         ⇒ 多工作区并行时选中**最近活跃的别的会话**
 *
 * 修法（三级解析，优先级从高到低）：
 *   ① props.sessionId（宿主权威）
 *   ② sessions 快照里 cwd === currentWs() 精确匹配
 *   ③ mainViewSessionIdClient()（旧兜底，保底不白屏）
 *
 * 判据（真执行 + 变异）：
 *   T35-1 sessionIdForWorkspaceClient 真跑：cwd 精确匹配、大小写/斜杠归一、多会话取最近
 *   T35-2 pageSessionIdClient 三级优先级真跑
 *   T35-3 静态接线：EventView 用 evSid；surface 透传 props.sessionId
 *   T35-4 变异：删掉工作区匹配级 ⇒ T35-2 必红
 */
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import assert from 'node:assert/strict'
const ROOT = 'D:/dsh-auto-memory'
const SRC = fs.readFileSync(path.join(ROOT, 'lib/client.js'), 'utf8').replace(/\r\n/g, '\n')
const LINES = SRC.split(String.fromCharCode(10))
const NL = String.fromCharCode(10)
let pass = 0, fail = 0
const ok = (m, fn) => { try { fn(); pass++; console.log('  PASS ' + m) } catch (e) { fail++; console.log('  FAIL ' + m + ' :: ' + (e && e.message)) } }

function extractFnByLine (lines, name) {
  const head = new RegExp('^\\s*function ' + name + '\\s*\\(')
  let start = -1
  for (let i = 0; i < lines.length; i += 1) if (head.test(lines[i])) { start = i; break }
  if (start < 0) return null
  let depth = 0, started = false, out = []
  for (let i = start; i < lines.length; i += 1) {
    const line = lines[i]
    out.push(line)
    let inS = 0, q = '', esc = false
    for (let k = 0; k < line.length; k += 1) {
      const c = line[k]
      if (inS) { if (esc) { esc = false; continue } if (c === String.fromCharCode(92)) { esc = true; continue } if (c === q) inS = 0; continue }
      if (c === '/' && line[k + 1] === '/') break
      if (c === String.fromCharCode(34) || c === String.fromCharCode(39)) { inS = 1; q = c; continue }
      if (c === '{') { depth += 1; started = true; continue }
      if (c === '}') { depth -= 1; if (started && depth === 0) return out.join(NL) }
    }
  }
  return null
}

console.log('')
console.log('== T35-1 sessionIdForWorkspaceClient 真跑 ==')
const wsFnSrc = extractFnByLine(LINES, 'sessionIdForWorkspaceClient')
ok('函数可抽取', () => assert.ok(wsFnSrc && wsFnSrc.length > 300))

function makeResolver (sessionsSnapshot) {
  const sandbox = { sessions: { list: { getSnapshot: () => sessionsSnapshot } } }
  const ctx = vm.createContext(sandbox)
  vm.runInContext(wsFnSrc + ';globalThis.__F = sessionIdForWorkspaceClient;', ctx)
  return ctx.__F
}

const SNAP = {
  ids: ['sid-aik', 'sid-dam-old', 'sid-dam-new', 'sid-other'],
  byId: {
    'sid-aik':     { cwd: 'C:\\Users\\JH Z\\.dsh\\aik_auto_memory_use', updatedAt: 9999 },
    'sid-dam-old': { cwd: 'D:\\dsh-auto-memory', updatedAt: 100 },
    'sid-dam-new': { cwd: 'D:/dsh-auto-memory/', updatedAt: 500 },
    'sid-other':   { cwd: 'D:\\other-project', updatedAt: 800 }
  }
}
const F = makeResolver(SNAP)
ok('★目标工作区命中，且同工作区取 updatedAt 最大（不是全局最大）', () => {
  assert.equal(F('D:\\dsh-auto-memory'), 'sid-dam-new')
})
ok('★大小写 + 正反斜杠 + 尾斜杠归一', () => {
  assert.equal(F('d:/DSH-AUTO-MEMORY/'), 'sid-dam-new')
})
ok('★不会选中「最近活跃但工作区不对」的会话（核心缺陷）', () => {
  assert.notEqual(F('D:\\dsh-auto-memory'), 'sid-aik')
  assert.notEqual(F('D:\\dsh-auto-memory'), 'sid-other')
})
ok('未知工作区 ⇒ 空串（不瞎猜）', () => {
  assert.equal(F('D:\\nope'), '')
})
ok('空入参 ⇒ 空串', () => { assert.equal(F(''), '') })

console.log('')
console.log('== T35-2 pageSessionIdClient 三级优先级真跑 ==')
const pageFnSrc = extractFnByLine(LINES, 'pageSessionIdClient')
ok('函数可抽取', () => assert.ok(pageFnSrc && pageFnSrc.length > 200))
function makePage (snapshot, curWs, fallbackSid) {
  const sandbox = {
    sessions: { list: { getSnapshot: () => snapshot } },
    currentWs: () => curWs,
    mainViewSessionIdClient: () => fallbackSid
  }
  const ctx = vm.createContext(sandbox)
  vm.runInContext(wsFnSrc + NL + pageFnSrc + ';globalThis.__F = pageSessionIdClient;', ctx)
  return ctx.__F
}
const P = makePage(SNAP, 'D:\\dsh-auto-memory', 'sid-aik')
ok('★① props.sessionId 最优先（宿主权威）', () => {
  assert.equal(P({ sessionId: 'sid-from-host' }), 'sid-from-host')
})
ok('★① props.session.id 也认', () => {
  assert.equal(P({ session: { id: 'sid-nested' } }), 'sid-nested')
})
ok('★★② 无 props ⇒ 走工作区匹配（不是旧兜底的 sid-aik）', () => {
  assert.equal(P({}), 'sid-dam-new')
  assert.equal(P(null), 'sid-dam-new')
})
ok('★★③ 工作区匹配不到 ⇒ 才回落旧兜底', () => {
  const P2 = makePage({ ids: [], byId: {} }, 'D:\\dsh-auto-memory', 'sid-aik')
  assert.equal(P2({}), 'sid-aik')
})
ok('★props 里空 sessionId ⇒ 视为无，继续下一级', () => {
  assert.equal(P({ sessionId: '' }), 'sid-dam-new')
  assert.equal(P({ sessionId: '   ' }), 'sid-dam-new')
})

console.log('')
console.log('== T35-3 接线（静态守卫，非功能证据）==')
ok('EventView 入口解析 evSid', () => {
  const i = SRC.indexOf('var evSid = pageSessionIdClient(props)')
  assert.ok(i > 0)
})
ok('eventDetail / eventList 都用 evSid（不再各算一次）', () => {
  assert.ok(/apiGet\(API\.eventDetail, \{ id: String\(selectedId\), sessionId: evSid \}/.test(SRC))
  assert.ok(/apiGet\(API\.eventList, \{ all: 1, sessionId: evSid \}/.test(SRC))
})
ok('surface 注册处透传 props.sessionId / props.session', () => {
  assert.ok(SRC.indexOf('sessionId: props && (props.sessionId || (props.session && (props.session.id || props.session.sessionId)))') > 0)
})

console.log('')
console.log('== T35-4 变异：删掉工作区匹配级 ⇒ 必红 ==')
const MUT = pageFnSrc.replace(/var byWs = sessionIdForWorkspaceClient\(currentWs\(\)\)/, 'var byWs = \'\'')
ok('变异成功', () => assert.notEqual(MUT, pageFnSrc))
ok('★[变异必红] 变异版不再按工作区匹配 ⇒ 会回落 sid-aik（错误会话）', () => {
  const sandbox = { sessions: { list: { getSnapshot: () => SNAP } }, currentWs: () => 'D:\\dsh-auto-memory', mainViewSessionIdClient: () => 'sid-aik' }
  const ctx = vm.createContext(sandbox)
  vm.runInContext(wsFnSrc + NL + MUT + ';globalThis.__F = pageSessionIdClient;', ctx)
  const got = ctx.__F({})
  assert.equal(got, 'sid-aik', '变异版应回落旧兜底')
  assert.notEqual(got, 'sid-dam-new')
})

console.log('')
console.log('SUMMARY  PASS ' + pass + ' / FAIL ' + fail)
if (fail > 0) process.exit(1)