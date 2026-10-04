#!/usr/bin/env node
/** [audit-G-filter] #167 自动沉淀：解析层确定性过滤 + [USER] 待确认区（真执行）。
 *
 * 审计 §G1 判据：
 *   ① 过滤**不得依赖模型判断** —— 纯函数、零随机/时钟，同输入多次结果逐字节一致（本套件自证）；
 *   ② [USER] 类内容**不得直接落全局用户级 MEMORY.md**，必须先入待确认区。
 *
 * 覆盖：A 确定性自证 / B 四类穿透过滤 / C 负路径（正常要点不得误杀）/
 *       D [USER] 门槛真实写盘行为（真 apply + 真 turn-stopping + 假模型）/
 *       E 接线守卫（consolidateTurn 里确实调用了过滤与门槛，调用点计数 != 0）。
 */
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { filterPointsPre, hasKeptPointsPre, userGatePre, MIN_POINT_CHARS_PRE_V1, CONSOLIDATE_FILTER_RES_PRE_V1 } from '../../lib/consolidate-filter.js'

let pass = 0, fail = 0
const ok = (c, n, d) => { if (c) { pass++; console.log('  ok -', n) } else { fail++; console.error('  FAIL -', n, d === undefined ? '' : d) } }

// ── A. 确定性自证：同输入 5 次结果逐字节一致（审计硬要求） ──
console.log('[audit-G-filter] A 确定性自证（同输入多次结果一致）')
{
  const input = [
    '无', '暂无', '没有值得记录的',
    '我排查了索引写入失败的原因', '尝试先改缓存再重试',
    '', '   ', '短句',
    '批次 G 已把三处裸写改为原子写并补按路径串行',
    '批次 G 已把三处裸写改为原子写并补按路径串行',
    undefined, null, 12345,
    'node tools/run-smoke.mjs 全量通过 262/0',
  ]
  const runs = []
  for (let i = 0; i < 5; i++) runs.push(JSON.stringify(filterPointsPre(input)))
  ok(new Set(runs).size === 1, '确定性自证：同一输入连续 5 次输出逐字节一致', 'distinct=' + new Set(runs).size)
  const r = filterPointsPre(input)
  ok(r.kept.length === 2, '仅保留 2 条实质要点', JSON.stringify(r.kept))
  ok(r.kept[0] === '批次 G 已把三处裸写改为原子写并补按路径串行' && r.kept[1] === 'node tools/run-smoke.mjs 全量通过 262/0', '保序保留', JSON.stringify(r.kept))
}

// ── B. 四类穿透（审计 §G1 观察点①②③④） ──
console.log('[audit-G-filter] B 空壳变体 / 过程叙述 / 过短 / 重复')
{
  const r = filterPointsPre(['(无)', '（暂无）', '没有', 'none', 'N/A', '我查看了日志', '分析了根因', '太短', '这是一条足够长的有效结论要点', '这是一条足够长的有效结论要点'])
  const reasons = r.dropped.map((d) => d.reason)
  ok(r.dropped.length === 9, '9 条被拦（四类合计）', JSON.stringify(r.dropped))
  ok(reasons.filter((x) => x === 'empty-shell').length === 5, '空壳变体 5 条（含旧实现拦不住的「无」「暂无」「没有」「none」「N/A」）', JSON.stringify(reasons))
  ok(reasons.filter((x) => x === 'action-narration').length === 2, '过程叙述开头 2 条', JSON.stringify(reasons))
  ok(reasons.filter((x) => x === 'too-short').length === 1, '过短要点 1 条（min=' + MIN_POINT_CHARS_PRE_V1 + '）', JSON.stringify(reasons))
  ok(reasons.filter((x) => x === 'duplicate').length === 1, '同段重复 1 条', JSON.stringify(reasons))
  ok(r.kept.length === 1, '仅 1 条存活', JSON.stringify(r.kept))
}

// ── C. 负路径：正常结论不得被误杀 ──
console.log('[audit-G-filter] C 负路径（不误杀）')
{
  const good = '把 continued-sessions.json 的读改写改为按路径串行 + tmp→rename 原子落盘'
  ok(filterPointsPre([good]).kept[0] === good, '正常长结论原样保留')
  ok(hasKeptPointsPre([good]) === true, 'hasKeptPointsPre 对有效内容为 true')
  ok(hasKeptPointsPre(['无']) === false, 'hasKeptPointsPre 对空壳段为 false（空段不写）')
  ok(filterPointsPre([]).kept.length === 0, '空数组 → 空结果（无异常）')
  ok(filterPointsPre(null).kept.length === 0, '非数组输入 fail-safe 视为空')
  ok(filterPointsPre([good], { minChars: 2 }).kept.length === 1, 'minChars 可覆盖（审计 ④ 的 N 可配）')
  // 正则导出面确实存在（供守卫复用），且是真正则
  ok(CONSOLIDATE_FILTER_RES_PRE_V1.emptyShell instanceof RegExp && CONSOLIDATE_FILTER_RES_PRE_V1.actionLead instanceof RegExp, '过滤正则已导出且为真 RegExp')
}

// ── E. 接线守卫：consolidateTurn 内确有调用点（防「机制建好但零调用」） ──
console.log('[audit-G-filter] E 接线守卫（定义处 + 调用点）')
{
  const src = readFileSync(new URL('../../lib/index.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
  const callFilter = (src.match(/filterPointsPre\(/g) || []).length
  const callGate = (src.match(/userGatePre\(/g) || []).length
  ok(callFilter >= 3, 'consolidateTurn 对 log/note/user 三档各调用一次 filterPointsPre（调用点=' + callFilter + '）')
  ok(callGate >= 1, 'userGatePre 有真实调用点（调用点=' + callGate + '，非仅 import）')
  ok(/PENDING-USER-MEMORY\.md/.test(src), '[USER] 候选落到待确认区文件名')
  // 负路径：**自动沉淀**里旧的 [USER] 直写全局分支必须已消失。
  //   刻意按「该分支内紧跟的 appendText(p.userFile)」这一相邻形态断言，而不是只匹配
  //   ensureBudget(...,'user',...) —— 后者在**做梦式固化**（consolidateMemory）里同样是该写法，
  //   故此处的正确判据是「ensureBudget(user) 的下一行不再是直写 p.userFile（同一分支内）」。
  ok(!/ensureBudget\(agent, 'user', userPts\.map\(\(x\) => '- ' \+ x\)\.join\('\\n'\)\)[\s\S]{0,160}?appendText\(p\.userFile/.test(src),
    '负路径：自动沉淀里旧的 [USER] 直写全局记忆分支已不存在')
  ok(/userGatePre\(userPts\)/.test(src), '自动沉淀改用 userGatePre 计算待确认区')
  ok(!/const r = await this\.ensureBudget\(agent, 'user', userPts\.map/.test(src),
    '负路径：自动沉淀不再对 [USER] 走 ensureBudget(user) 直写通道')
}

// ── D. 真实写盘行为：真 apply + 真 turn-stopping + 假模型 ──
console.log('[audit-G-filter] D [USER] 门槛真执行（端到端）')
{
  const ws = mkdtempSync(path.join(tmpdir(), 'dam-audit-g-'))
  const home = path.join(ws, '.dsh-home')
  mkdirSync(home, { recursive: true })
  writeFileSync(path.join(home, 'dsh-auto-memory.json'), JSON.stringify({
    memoryRoot: path.join(ws, '.memory-root'),
    userMemoryDir: path.join(ws, '.user-root'),
    projectMemoryDir: '.project-memory',
    externalSources: {},
    autoConsolidateCooldownMinutes: 0,
    autoConsolidateMinChars: 80,
  }), 'utf8')
  process.env.DSH_HOME = home
  globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({}) })

  const USER_POINT = '跨项目通用偏好：所有新开关必须即时回显'
  const subagents = {
    list() { return ['spawn'] },
    async start() {
      const text = ['[TOPIC] 批次 G 门槛回归', '[LOG]', '- 三处裸写改为原子写并按路径串行落盘', '[USER]', '- ' + USER_POINT].join('\n')
      return { result: Promise.resolve({ output: [{ type: 'text', text }] }) }
    },
  }
  // 工作台门控（2026-09-24）要求若干宿主服务就绪，否则 runSubagent 返回空串 ⇒ consolidateTurn
  // 根本走不到解析层。本套件要验的是**过滤与门槛**，故须给出真实前置：agents 服务 + 已就绪的
  // 工作台父会话（sessionController 可建），并在 stop 后显式 consent 建立。
  const wbSid = 'audit-g-workbench'
  // 工作台目录口径 = dshHome()/aik_auto_memory_use（WORKBENCH_DIRNAME）；会话 cwd 必须与之一致，
  // 否则 _verifyWorkbench 判 cwd-mismatch ⇒ 建期失败、子代理继续被门控。
  const workbenchWsPath = path.join(home, 'aik_auto_memory_use')
  const workbenchAgent = { session: { id: wbSid, header: { id: wbSid, cwd: workbenchWsPath } }, ctx: { get: () => undefined } }
  // agents 注册表契约（index.js:10081）：必须有 create()；建期走该降级分支拿到 agent 句柄。
  const agentsSvc = {
    create: async () => ({ agent: workbenchAgent }),
    get: (id) => (String(id) === wbSid ? workbenchAgent : undefined),
    list: () => [workbenchAgent],
    resolveAgent: () => workbenchAgent,
  }
  const sessionController = {
    cancel: async () => {},
    create: async () => ({ sessionId: wbSid }),
    rename: async () => {},
    selectModel: async () => {},
    prompt: async () => ({ accepted: true }),
  }
  // 权限预设服务（契约 index.js:9847）：current(session) 必须返回 'danger-full-access'，
  //   否则 _verifyWorkbench 停在 no-permission-service ⇒ 工作台永不就绪。
  const permissionPresets = {
    current: () => 'danger-full-access',
    set: () => {},
  }
  // 工作区登记表：建期后 _verifyWorkbench 会复验工作区归属，缺登记会停在 workspace-unregistered。
  const workspaceRegistry = {
    list: () => [{ id: 'ws-audit-g', path: workbenchWsPath, sessionIds: [wbSid] }],
    create: async () => ({ id: 'ws-audit-g', path: workbenchWsPath }),
    resolve: () => ({ id: 'ws-audit-g', path: workbenchWsPath }),
    archivedSessionIds: [],
  }
  const handlers = new Map()
  const disposers = []
  const routes = []
  const ctx = {
    get(name) {
      if (name === 'subagents') return subagents
      if (name === 'agents') return agentsSvc
      if (name === 'sessionController') return sessionController
      if (name === 'workspaceRegistry') return workspaceRegistry
      if (name === 'permissionPresets') return permissionPresets
      return undefined
    },
    on(name, fn) { handlers.set(name, fn); return () => handlers.delete(name) },
    effect(fn) { disposers.push(fn); return () => {} },
    systemPrompt: { section() { return () => {} }, context() { return () => {} } },
    tools: { register() { return () => {} } },
    webServer: { register(route) { routes.push(route); return () => {} } },
  }
  const { apply } = await import('../../lib/index.js')
  apply(ctx, {})
  const stopping = handlers.get('agent/turn-stopping')
  assert.equal(typeof stopping, 'function', 'turn-stopping hook missing')
  const agent = {
    id: 'audit-g-agent',
    ctx: { get: () => undefined },
    session: {
      id: 'audit-g-agent-session',
      header: { id: 'audit-g-agent-session', cwd: path.join(ws, 'proj') },
      surface: { nodes: [0, 1] },
      events: [
        { type: 'user/message', data: { role: 'user', content: [{ type: 'text', text: '审计批次 G：自动沉淀要把 [USER] 候选挡住，不能直接写全局用户级记忆，必须先进待确认区等人工确认，这条用户消息本身足够长以通过最小字符门槛校验。' }] } },
        { type: 'assistant/message', data: { message: { role: 'assistant', content: [{ type: 'text', text: '已实现解析层确定性过滤与 [USER] 写入门槛，三处裸写改为原子写；验证：过滤纯函数同输入 5 次一致，门槛端到端落待确认区。' }] } } },
      ],
    },
  }
  // 建立工作台（真实前置）：走**唯一被授权的同意入口** —— POST /workbench {action:'setup'}。
  //   runSubagent 的惰性门控拿不到 consent（全仓唯一 consent 调用点就是该路由），
  //   所以不先建工作台，consolidate 只会拿到空串、根本走不到解析层。
  const wbRoute = routes.find((r) => r.path === '/api/dsh-auto-memory/workbench')
  assert.ok(wbRoute, 'workbench route missing')
  {
    const req = { socket: { remoteAddress: '127.0.0.1' }, headers: { host: '127.0.0.1:3080' }, method: 'POST', url: '/api/dsh-auto-memory/workbench' }
    req[Symbol.asyncIterator] = async function* () { yield Buffer.from(JSON.stringify({ action: 'setup' })) }
    let out = null
    await wbRoute.handler(req, { writeHead() {}, end(b) { out = JSON.parse(b) } })
    ok(!!(out && out.setup), '工作台 setup 路由已响应（真实前置建立）', JSON.stringify(out && out.setup))
  }
  await stopping({ agent, turn: 1, signal: new AbortController().signal })
  const userMemory = path.join(ws, '.user-root', 'MEMORY.md')
  const pending = path.join(ws, '.user-root', 'PENDING-USER-MEMORY.md')
  const waitUntil = async (pred, ms = 8000) => {
    const end = Date.now() + ms
    for (;;) { try { if (pred()) return true } catch (e) {} if (Date.now() >= end) return false; await new Promise((r) => setTimeout(r, 20)) }
  }
  const gotPending = await waitUntil(() => existsSync(pending))
  ok(gotPending, '端到端：[USER] 候选落 PENDING-USER-MEMORY.md', pending)
  const pendingText = gotPending ? readFileSync(pending, 'utf8') : ''
  ok(pendingText.includes(USER_POINT), '待确认区含该 [USER] 要点原文')
  const userText = existsSync(userMemory) ? readFileSync(userMemory, 'utf8') : ''
  ok(!userText.includes(USER_POINT), '★全局用户级 MEMORY.md 不含该 [USER] 要点（门槛生效）', userText.slice(0, 200))
  ok(pendingText.includes('待人工确认'), '待确认区标注为「待人工确认」')
  for (const d of disposers) { try { const t = d(); if (typeof t === 'function') t() } catch (e) {} }
  rmSync(ws, { recursive: true, force: true })
}

console.log('\n[audit-G-filter] ' + pass + ' passed, ' + fail + ' failed')
process.exit(fail > 0 ? 1 : 0)
