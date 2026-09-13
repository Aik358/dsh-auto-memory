#!/usr/bin/env node
/** [contseq] 接续序号 v2 · 持久计数器回归(2026-09-13,NEXT-VERSION-TODO 改点2)。
 *
 * 背景:旧口径 contSeq = handoff 目录里 prev-session-*.md 文件数 +1,在落盘失败/跨工作区
 * (handoffDir 按工作区解析)/carry 复用时不递增、重复或为空 —— 为空即 rename 被跳过,
 * 新会话标题退回自动生成(用户两次实机观察到「新窗口序号不对」)。
 * 新口径:~/.dsh/memory/cont-seq.json 持久计数器,全局单调(跨工作区不重号),缺失时从
 * 历史「接续 #N」标题解析兜底;分配→写包→失败回滚,保证不跳号。
 *
 * 用真 apply(ctx) + 真实临时 DSH_HOME 驱动,验证:
 *   S0 源码守卫:接线完整(先分配后写包/失败回滚/取值链/rename fail-soft)
 *   S1 同工作区连续接续:contSeq 依次 1,2;计数器文件落盘
 *   S2 换工作区接续:不重复已有序号(全局单调 3),byWorkspace 记账
 *   S3 包落盘失败:回滚计数器,不跳号(重试复用同一序号)
 *   S4 计数器缺失:从历史标题「接续 #5」解析兜底 → 下一号 6
 *   S5 重启后(新 engine 实例):持久计数器继续递增(7)
 */
import { apply } from '../../lib/index.js'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({}) })
process.on('uncaughtException', (e) => { console.error('\n[contseq] FATAL uncaughtException:', (e && (e.stack || e.message)) || e); process.exit(1) })
process.on('unhandledRejection', (r) => { console.error('\n[contseq] FATAL unhandledRejection:', (r && (r.stack || r.message)) || r); process.exit(1) })

let pass = 0, fail = 0
const ok = (c, n) => { if (c) { pass++; console.log('  ok -', n) } else { fail++; console.error('  FAIL -', n) } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ── 环境隔离:临时 DSH_HOME ─────────────────────────────────────────
const root = mkdtempSync(path.join(tmpdir(), 'dam-contseq-'))
const home = path.join(root, '.dsh-home')
mkdirSync(home, { recursive: true })
writeFileSync(path.join(home, 'dsh-auto-memory-pre.json'), JSON.stringify({
  memoryRoot: path.join(root, '.memory-root'),
  userMemoryDir: path.join(root, '.user-root'),
  projectMemoryDir: '.project-memory',
  handoffEnabled: true,
  externalSources: {},
}), 'utf8')
process.env.DSH_HOME = home

const WS_A = 'D:\\dam-contseq-proj-a'
const WS_B = 'D:\\dam-contseq-proj-b'
const SID_A = 'session-contseq-a-0001'
const SID_B = 'session-contseq-b-0002'

// 两个工作区各放一个旧会话持久化文件(转写包来源)
function mkSession(wsDir, sid, cwd) {
  const dir = path.join(home, 'sessions', wsDir, sid)
  mkdirSync(dir, { recursive: true })
  const lines = [JSON.stringify({ agentPreset: 'default', cwd })]
  for (let i = 0; i < 4; i++) lines.push(JSON.stringify({ type: i % 2 === 0 ? 'user/message' : 'assistant/message', data: { message: { role: i % 2 === 0 ? 'user' : 'assistant', content: [{ type: 'text', text: '消息' + i }] } } }))
  writeFileSync(path.join(dir, 'session.jsonl'), lines.join('\n') + '\n', 'utf8')
}
mkSession('wsA', SID_A, WS_A)
mkSession('wsB', SID_B, WS_B)

const routes = []
const handlers = {}
const effects = []
const ctx = {
  get() { return undefined },
  on(ev, fn) { handlers[ev] = fn; return () => {} },
  effect(fn) { effects.push(fn); return () => {} },
  systemPrompt: { section() { return () => {} }, context() { return () => {} } },
  tools: { register() { return () => {} } },
  webServer: { register(route) { routes.push(route); return () => {} } },
}
apply(ctx, {})

const API = {
  config: '/api/dsh-auto-memory-pre/config',
  state: '/api/dsh-auto-memory-pre/handoff-state',
  cont: '/api/dsh-auto-memory-pre/handoff-continue',
}
const call = async (p, method) => {
  let body = null
  const route = routes.find((r) => r.path === p)
  if (!route) throw new Error('route not registered: ' + p)
  await route.handler({ socket: { remoteAddress: '127.0.0.1' }, headers: { host: '127.0.0.1:3080' }, method, url: p }, { writeHead() {}, end(b) { body = JSON.parse(b) } })
  return body
}
const seqFile = path.join(home, 'memory', 'cont-seq.json')
const readSeq = () => { try { return JSON.parse(readFileSync(seqFile, 'utf8')) } catch (e) { return null } }
const sessionStart = async (sid, cwd) => { handlers['agent/session-start']({ agent: { session: { id: sid, header: { cwd } } }, source: 'test' }); await sleep(500) }

console.log('[contseq] S0 源码守卫')
{
  const SRC = readFileSync(new URL('../../lib/index.js', import.meta.url), 'utf8')
  ok(/contSeqFile\(\) \{ return path\.join\(dshHome\(\), 'memory', 'cont-seq\.json'\) \}/.test(SRC),
    '计数器文件在全局记忆根(~/.dsh/memory/cont-seq.json),不随工作区 handoffDir 漂移')
  ok(/let contSeq = 0\s*\n\s*try \{ contSeq = await this\.allocContSeq\(p\.ws\) \} catch \(eSeq\)/.test(SRC),
    'buildPrevSessionPack:写包前先分配序号')
  ok(/catch \(eW\) \{[\s\S]{0,200}?rollbackContSeq\(p\.ws, contSeq\)[\s\S]{0,120}?throw eW\s*\}/.test(SRC),
    'buildPrevSessionPack:写包失败回滚(不跳号)')
  ok(/let contSeq = Number\(pack && pack\.contSeq\) \|\| 0[\s\S]{0,400}?if \(!contSeq\) contSeq = 1/.test(SRC),
    'buildContinueCarry 取值链:pack → 持久计数器 → 旧文件数+1 → 1(contSeq 恒非空,rename 不再被跳过)')
  ok(/if \(d\.contSeq && typeof sc\.rename === 'function'\)/.test(SRC), '宿主 rename 保留 fail-soft(旧 harness 不炸)')
  ok(/allocContSeq\(wsKey\) \{[\s\S]{0,600}?scanMaxContSeq\(\)/.test(SRC), '计数器缺失时从历史标题解析兜底(兼容老数据)')
}

console.log('[contseq] S1 同工作区连续接续:1,2 + 落盘')
await call(API.config, 'GET')   // 先加载配置(隔离路径)
await sessionStart(SID_A, WS_A)
const r1 = await call(API.cont, 'POST')
ok(r1 && r1.ok === true && r1.contSeq === 1, '第 1 次接续 contSeq=1(旧口径会给出 2:把刚写的包也数进去)')
ok(r1 && r1.transcriptPath && existsSync(r1.transcriptPath), '转写包正常落盘')
await sleep(1100)               // 避开同秒 stamp 撞名
const r2 = await call(API.cont, 'POST')
ok(r2 && r2.ok === true && r2.contSeq === 2, '第 2 次接续 contSeq=2(严格递增)')
let seq = readSeq()
ok(seq && seq.last === 2, '计数器持久化:last=2')
ok(seq && Number(seq.byWorkspace[WS_A]) === 2, 'byWorkspace 记账:工作区 A → 2')

console.log('[contseq] S2 换工作区接续:不重复已有序号')
await sessionStart(SID_B, WS_B)
const stB = await call(API.state, 'GET')
ok(stB && stB.planPath && stB.planPath.includes('--D--dam-contseq-proj-b--'), '切换后 handoff-state 指向新工作区(B 的记忆目录)')
const r3 = await call(API.cont, 'POST')
ok(r3 && r3.ok === true && r3.contSeq === 3, '工作区 B 首次接续 contSeq=3(全局单调,不与 A 重复)')
seq = readSeq()
ok(seq && Number(seq.byWorkspace[WS_B]) === 3 && seq.last === 3, 'byWorkspace 记账:工作区 B → 3')

console.log('[contseq] S3 包落盘失败:回滚计数器,不跳号')
// 用「同名文件占位」堵死工作区 B 的 handoff 目录(mkdir/writeFile 必败,跨平台可靠)
const handoffDirB = path.dirname(stB.planPath)
rmSync(handoffDirB, { recursive: true, force: true })
writeFileSync(handoffDirB, 'blocker', 'utf8')
const r4 = await call(API.cont, 'POST')
ok(r4 && r4.ok === false, 'handoff 目录被堵死 → 本次接续无材料(ok:false)')
seq = readSeq()
ok(seq && seq.last === 3, '分配已回滚:last 停在 3,不跳号(不烧掉 4)')
rmSync(handoffDirB, { force: true })   // 撤除堵死的文件(此刻必为文件)
const r5 = await call(API.cont, 'POST')
ok(r5 && r5.ok === true && r5.contSeq === 4, '恢复后重试 → contSeq=4(复用被回滚的号,无空洞)')

console.log('[contseq] S4 计数器缺失:从历史标题解析兜底')
// 伪造一个带「接续 #5」标题的历史会话日志(v2.4.2 老数据形态)
const fakeDir = path.join(home, 'sessions', 'wsFake', 'session-contseq-old')
mkdirSync(fakeDir, { recursive: true })
writeFileSync(path.join(fakeDir, 'session.jsonl'), [
  JSON.stringify({ agentPreset: 'default', cwd: WS_A }),
  JSON.stringify({ type: 'session/title', data: { title: '接续 #5 · proj' } }),
].join('\n') + '\n', 'utf8')
rmSync(seqFile, { force: true })   // 模拟计数器文件缺失(老机器首次升级)
const r6 = await call(API.cont, 'POST')
ok(r6 && r6.ok === true && r6.contSeq === 6, '标题扫描兜底:历史最大 #5 → 下一号 6(不从头重用 1)')
seq = readSeq()
ok(seq && seq.last === 6, '兜底结果已持久化:last=6')

console.log('[contseq] S5 重启后(新 engine 实例):持久计数器继续递增')
const routes2 = [], handlers2 = [], effects2 = []
const ctx2 = {
  get() { return undefined },
  on(ev, fn) { handlers2[ev] = fn; return () => {} },
  effect(fn) { effects2.push(fn); return () => {} },
  systemPrompt: { section() { return () => {} }, context() { return () => {} } },
  tools: { register() { return () => {} } },
  webServer: { register(route) { routes2.push(route); return () => {} } },
}
apply(ctx2, {})
const call2 = async (p, method) => {
  let body = null
  const route = routes2.find((x) => x.path === p)
  if (!route) throw new Error('route not registered (instance 2): ' + p)
  await route.handler({ socket: { remoteAddress: '127.0.0.1' }, headers: { host: '127.0.0.1:3080' }, method, url: p }, { writeHead() {}, end(b) { body = JSON.parse(b) } })
  return body
}
await call2(API.config, 'GET')
handlers2['agent/session-start']({ agent: { session: { id: SID_A, header: { cwd: WS_A } } }, source: 'test' })
await sleep(500)
const r7 = await call2(API.cont, 'POST')
ok(r7 && r7.ok === true && r7.contSeq === 7, '重启后接续 contSeq=7(计数器跨实例持久,不回退)')

for (const d of [...effects, ...effects2]) { try { if (typeof d === 'function') d() } catch (e) {} }
console.log('\n[contseq] ' + pass + ' passed, ' + fail + ' failed')
process.exit(fail > 0 ? 1 : 0)
