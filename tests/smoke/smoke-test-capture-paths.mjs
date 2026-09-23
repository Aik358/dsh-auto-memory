// P1 附带修复 · no-paths-captured 降级（2026-09-15 用户裁定并入 P1 范围）。
//
// 病症（本机实测证据，非推断）：诊断日志 `ctx-host drop: no-paths-captured cv=1 key=session:…`
// 共 21 次，**全部 cv=1**（历史会话回放形态），key 形如 `session:session-aa9ba629-…`（双前缀）。
// 表现：子会话/子代理/被观测的历史会话，注入头工作区显示 `(未知)`、证据层与语义命中全空。
//
// 根因（两点）：
//   ① `refreshAll`（index.js:8014）只在 agent/session-start 与 agent/turn-stopping 触发，
//      历史会话被观测（replay）时不会为它单独 refresh ⇒ 该 runtime 永不 capturePaths。
//   ② capturePaths 原本挂在 `engine.state.ws` 门后，而 state 是**单例共享对象**（_doRefresh 覆盖），
//      竞态/刷新失败时门恒假 ⇒ 静默不注册。
// 修法：新增 `MemoryEngine.capturePathsFor(agent)` —— 把**已解析好**的当前工作区 paths 按
//       **该 agent 自己的 runtime.key** 注册一次（纯内存、零 IO、幂等），并在 systemPrompt.context
//       回调（每个 agent 注入时必经）里调用。
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const HERE = path.dirname(fileURLToPath(import.meta.url))
const SRC = readFileSync(path.join(HERE, '..', '..', 'lib', 'index.js'), 'utf8')

let pass = 0, fail = 0
function ok(cond, name) { if (cond) { pass++; console.log('  ok - ' + name) } else { fail++; console.error('  FAIL - ' + name) } }

/** 花括号配平抽取(与其它套件同源)。 */
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

console.log('[capture-paths] S0 源码守卫:方法定义与注入回调接线同源')

// 定义存在
const defCount = (SRC.match(/^\s*capturePathsFor\(agent\)\s*\{/gm) || []).length
ok(defCount === 1, '★capturePathsFor 定义恰好 1 处（重复定义会让后定义覆盖前者）实得 ' + defCount)

// 注入回调里必须有调用（否则方法定义了也永远不执行 —— 这正是本 bug 的形态）
ok(SRC.includes('engine.capturePathsFor(agent)'), '★systemPrompt.context 回调里实际调用 capturePathsFor（接线的"能失败"点）')

// 旧的三处 refreshAll 内 capturePaths 仍在（不回归：正常路径照旧）
const refreshHostSites = (SRC.match(/engine\._(shadowHost|contextHost|activationHost)\.capturePaths\(/g) || []).length
ok(refreshHostSites >= 3, 'refreshAll 内三处 capturePaths 未被删除（正常会话路径不回归），实得 ' + refreshHostSites)

console.log('[capture-paths] S1 行为:按该 agent 自己的 runtime.key 注册')

const body = extractFn('capturePathsFor(agent) {')

/** 造一个假 engine：runtimeFor 返回指定 key；三个 host 记录调用。 */
function makeFakeEngine({ key, ws }) {
  const calls = []
  const host = { capturePaths: (k, p) => calls.push({ host: 'h', key: k, ws: p && p.ws }) }
  return {
    _calls: calls,
    state: ws === undefined ? {} : { ws, userDir: '/u', notesPath: '/n', logPath: '/l' },
    runtimeFor: () => (key === undefined ? undefined : { key }),
    _shadowHost: host,
    _contextHost: { capturePaths: (k, p) => calls.push({ host: 'c', key: k, ws: p && p.ws }) },
    _activationHost: { capturePaths: (k, p) => calls.push({ host: 'a', key: k, ws: p && p.ws }) },
  }
}
const run = (fake, agent) => {
  // 抽取的方法体是 `capturePathsFor(agent) {…}` 形式 ⇒ 包成对象字面量再 bind
  const fn = new Function('return {' + body + '};')()
  return fn.capturePathsFor.call(fake, agent)
}

{
  const fake = makeFakeEngine({ key: 'session:abc', ws: '/ws1' })
  const r = run(fake, { id: 'a1' })
  ok(r === true, 'B1 正常路径返回 true')
  ok(fake._calls.length === 3, 'B2 三个 host 各注册一次（shadow/context/activation），实得 ' + fake._calls.length)
  ok(fake._calls.every((c) => c.key === 'session:abc'), 'B3 ★key 取该 agent 自己的 runtime.key（不是 default）')
  ok(fake._calls.every((c) => c.ws === '/ws1'), 'B4 注册的是已解析的 state（含 ws）')
}

console.log('[capture-paths] S2 边界:不猜测路径(fail-closed)')

{
  const fake = makeFakeEngine({ key: 'session:abc' })   // ws 缺失
  ok(run(fake, { id: 'a1' }) === false, 'B5 ★state.ws 未就绪 ⇒ 返回 false，不注册（不造默认路径）')
  ok(fake._calls.length === 0, 'B6 未就绪时零注册（不污染 pathsByKey）')
}
{
  const fake = makeFakeEngine({ key: 'session:abc', ws: '/ws1' })
  ok(run(fake, null) === false, 'B7 agent 为空 ⇒ false（不落到 default runtime）')
  ok(fake._calls.length === 0, 'B8 空 agent 时零注册')
}
{
  const fake = makeFakeEngine({ key: undefined, ws: '/ws1' })  // runtimeFor 返回 undefined
  ok(run(fake, { id: 'a1' }) === false, 'B9 runtime 取不到 ⇒ false（无 key 不注册）')
  ok(fake._calls.length === 0, 'B10 无 key 时零注册')
}
{
  // 幂等：连调两次不报错、调用数翻倍但不产生副作用（真实 capturePaths 是 Map.set 覆盖）
  const fake = makeFakeEngine({ key: 'session:abc', ws: '/ws1' })
  run(fake, { id: 'a1' }); run(fake, { id: 'a1' })
  ok(fake._calls.length === 6, 'B11 幂等：重复调用安全（Map.set 覆盖语义），实得 ' + fake._calls.length)
}
{
  // host 抛错必须被吞掉——注入回调不能被它打断（否则整个记忆块消失）
  const fake = makeFakeEngine({ key: 'session:abc', ws: '/ws1' })
  fake._shadowHost = { capturePaths: () => { throw new Error('boom') } }
  fake._contextHost = null; fake._activationHost = null
  let threw = false
  let r = null
  try { r = run(fake, { id: 'a1' }) } catch (e) { threw = true }
  ok(!threw && r === false, '★B12 host 抛错被吞成 false（不打断注入回调）')
}

console.log('[capture-paths] ' + pass + '/' + (pass + fail) + ' assertions passed')
process.exit(fail === 0 ? 0 : 1)
