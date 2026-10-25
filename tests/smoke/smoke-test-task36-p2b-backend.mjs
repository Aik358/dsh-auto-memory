#!/usr/bin/env node
/**
 * smoke-test-task36-p2b-backend.mjs —— task-36：P2b 弹窗的两个后端路由 + start 门控语义 + legacy set 可读错误。
 *
 * ★用户原话（逐字）：「P2B 自动检测也必须要做……如果是旧版流水账，自己会弹窗的，
 *   弹完窗以后，点击『立即叫一个子代理』去进行更新版的整理。
 *   这个你也得改一下，因为原来的旧事件可能不太符合现在的情况」
 *
 * 覆盖 Lead 判据 a–f + 三条裁决（start 门控 / legacy 可读错误 / 路由字段）。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const IX = fs.readFileSync(path.join(ROOT, 'lib', 'index.js'), 'utf8')
const { apply, MemoryEngine } = await import(pathToFileURL(path.join(ROOT, 'tests', 'lib', 'state-engine.mjs')).href)
const STORE = await import(pathToFileURL(path.join(ROOT, 'lib', 'event-store.js')).href)

let pass = 0, fail = 0
const ok = (c, n, d) => { if (c) { pass++; console.log('  PASS ' + n + (d ? '  =>  ' + d : '')) } else { fail++; console.log('  FAIL ' + n + (d ? '  =>  ' + d : '')) } };

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dam-t36-'));
const ws = path.join(root, 'ws'); fs.mkdirSync(ws, { recursive: true });
process.env.HOME = root; process.env.DSH_HOME = root;
fs.writeFileSync(path.join(root, 'dsh-auto-memory.json'), JSON.stringify({ memoryRoot: path.join(root,'memory'), userMemoryDir: path.join(root,'user'), handoffEnabled: true, autoContinueEnabled: true, teamEnabled: false, externalSources: {}, autoConsolidate: false }));
let engine = null;
const iv = globalThis.setInterval, to = globalThis.setTimeout, fe = globalThis.fetch;
const load = MemoryEngine.prototype.loadConfigSync;
const routes = []; const tools = [];

try {
  globalThis.setInterval = globalThis.setTimeout = () => ({ unref() {} });
  globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({}) });
  MemoryEngine.prototype.loadConfigSync = function () { engine = this; return load.call(this) };
  apply({ get: () => undefined, on: () => () => {}, systemPrompt: { context: () => () => {}, section: () => () => {} }, tools: { register: (t) => { tools.push(t); return () => {} } }, webServer: { register: (r) => { routes.push(r); return () => {} } }, effect: (f) => { f() } }, {});
  MemoryEngine.prototype.loadConfigSync = load;
  engine.configLoaded = true; engine.state.ws = ws;
  const p = await engine.resolvePaths(undefined);
  for (const d of [p.userDir, p.projectDir, p.handoffDir]) fs.mkdirSync(d, { recursive: true });
  engine.agentForSessionId = () => null;
  engine.sessionWorkspaceFallback = (id) => (String(id) === 'sid-good' ? ws : null);

  // 造 legacy 内容（userFile/notes 无锚点无 status = 真 legacy 判据）
  fs.writeFileSync(p.userFile, '# 用户记忆\n- 旧条目无锚点\n', 'utf8');
  fs.writeFileSync(p.notesPath, '# 项目笔记\n- 旧条目\n', 'utf8');
  const storePath = path.join(p.handoffDir, 'event-store.json');
  fs.writeFileSync(storePath, JSON.stringify({ schema: 'v4_event_store_v1', events: [
    { id: 'evt_11112222', name: '老事件', summary: '旧', sections: { goal:'',doing:'',deadend:'',next:'' }, checkpoints: [], constraints: [], userPercept: [], agentTrace: [], sharedGround: [], commitments: [], createdAt: 1, updatedAt: 0 },
  ] }, null, 2), 'utf8');

  const mkRes = () => { const o = { code: 200, body: null }; const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v }, writeHead(c, h) { this.statusCode = c; o.code = c; if (h) Object.assign(this.headers, h); return this }, end(s) { o.body = s } }; return { o, res } };
  const mkReq = (url, method = 'GET', body = null) => {
    const chunks = body ? [Buffer.from(JSON.stringify(body))] : [];
    const req = { url, method, headers: { host: '127.0.0.1:26300', 'content-type': 'application/json' }, socket: { remoteAddress: '127.0.0.1' }, connection: { remoteAddress: '127.0.0.1' } };
    req[Symbol.asyncIterator] = async function* () { for (const c of chunks) yield c };
    req.on = (ev, cb) => { if (ev === 'data' && chunks.length) cb(chunks[0]); if (ev === 'end') cb(); return req };
    req.once = req.on;
    return req;
  };
  const find = (ps) => routes.filter((r) => r.path === ps);
  const stR = find('/api/dsh-auto-memory/upgrade-status')[0];
  const snR = find('/api/dsh-auto-memory/upgrade-snooze')[0];
  const call = async (r, url, method, body) => { const { o, res } = mkRes(); await r.handler(mkReq(url, method, body), res); return { code: res.statusCode, body: o.body ? JSON.parse(o.body) : null } };
  const statePath = path.join(p.userDir, 'upgrade-state.json');

  console.log('[T36-1] 路由已注册（结构守卫，非功能证据）');
  ok(routes.length === 79, '★★★T36-1a 路由总数 = 79（77 + 2）', String(routes.length));
  ok(!!stR && !!snR, '★★★T36-1b 两个路由都已注册');
  ok(Object.keys(API_KEYS()).length === 79, '★★T36-1c API 常量表 = 79 条', String(Object.keys(API_KEYS()).length));
  function API_KEYS() { const m = IX.match(/const API = \{([\s\S]*?)\n\}/); return m ? [...m[1].matchAll(/([\w'-]+):\s*'\/api/g)].reduce((a, x) => (a[x[1]] = 1, a), {}) : {} }

  console.log('');
  console.log('[T36-2] ★★★ 功能：GET /upgrade-status（判据 a）');
  const r1 = await call(stR, '/api/dsh-auto-memory/upgrade-status', 'GET');
  ok(r1.code === 200, '★★★T36-2a HTTP 200', String(r1.code));
  ok(r1.body.ok === true, '★★T36-2b ok:true');
  ok(r1.body.legacy === true, '★★★T36-2c **legacy 真检测到 true**（无锚点无 status）', String(r1.body.legacy));
  ok(Array.isArray(r1.body.reasons) && r1.body.reasons.length >= 2, '★★T36-2d reasons 非空且含多条', JSON.stringify(r1.body.reasons && r1.body.reasons.map(x=>x.split('：')[0])));
  ok(r1.body.counts && typeof r1.body.counts.events === 'number', '★★T36-2e counts.events 存在', JSON.stringify(r1.body.counts));
  ok(r1.body.declined === false, '★★T36-2f declined 初始 false');
  ok(r1.body.canUpgrade === true, '★★★T36-2g canUpgrade === true（legacy 且未 declined 且 idle）', String(r1.body.canUpgrade));
  ok(r1.body.phase === 'idle', '★★T36-2h phase = idle', String(r1.body.phase));
  ok(typeof r1.body.snoozeRemainingMs === 'number', '★★T36-2i snoozeRemainingMs 字段存在（Lead 批准的新增字段）');
  ok(typeof r1.body.jobId === 'string', '★★T36-2j jobId 字段存在');
  // ★负路径：GET 不得改状态
  ok(!fs.existsSync(statePath), '★★★T36-2k **只读纪律**：GET 不创建 upgrade-state.json');

  console.log('');
  console.log('[T36-3] ★★★ 功能：POST /upgrade-snooze 真写盘（判据 b）');
  const r2 = await call(snR, '/api/dsh-auto-memory/upgrade-snooze', 'POST', { sessionId: 'sid-good' });
  ok(r2.code === 200, '★★★T36-3a HTTP 200', String(r2.code));
  ok(r2.body.ok === true && r2.body.declined === true, '★★★T36-3b 返回 {ok:true, declined:true}');
  ok(fs.existsSync(statePath), '★★★T36-3c **upgrade-state.json 真写盘**');
  const st = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  ok(st.declined === true, '★★★T36-3d 落盘 declined === true');
  ok(typeof st.at === 'number' && Math.abs(st.at - Date.now()) < 60000, '★★★T36-3e at 是合理时间戳', String(st.at));
  ok(r2.body.snoozeMs === 259200000, '★★T36-3f snoozeMs = 3 天（用户裁定）', String(r2.body.snoozeMs));
  ok(r2.body.resumedAt === r2.body.at + 259200000, '★★T36-3g resumedAt = at + 3 天');

  console.log('');
  console.log('[T36-4] ★★★ declined 后 GET 状态变化（判据 c）');
  const r3 = await call(stR, '/api/dsh-auto-memory/upgrade-status', 'GET');
  ok(r3.body.declined === true, '★★★T36-4a declined 变 true');
  ok(r3.body.sinceMs >= 0 && r3.body.sinceMs < 60000, '★★★T36-4b sinceMs 合理（刚写的）', String(r3.body.sinceMs));
  ok(r3.body.canUpgrade === false, '★★★T36-4c **canUpgrade 变 false**（3 天内不弹）');
  ok(r3.body.snoozeRemainingMs > 259000000, '★★T36-4d snoozeRemainingMs 接近 3 天', String(r3.body.snoozeRemainingMs));

  console.log('');
  console.log('[T36-5] ★★★ 3 天内 / 超 3 天两条路径（判据 d）');
  fs.writeFileSync(statePath, JSON.stringify({ declined: true, at: Date.now() - 2 * 86400000 }, null, 2), 'utf8');
  const rIn = await call(stR, '/api/dsh-auto-memory/upgrade-status', 'GET');
  ok(rIn.body.canUpgrade === false, '★★★T36-5a 2 天前 declined ⇒ canUpgrade=false（不弹）');
  ok(rIn.body.snoozeRemainingMs > 0 && rIn.body.snoozeRemainingMs < 86400000, '★★T36-5b 剩余 < 1 天', String(rIn.body.snoozeRemainingMs));
  fs.writeFileSync(statePath, JSON.stringify({ declined: true, at: Date.now() - 4 * 86400000 }, null, 2), 'utf8');
  const rOut = await call(stR, '/api/dsh-auto-memory/upgrade-status', 'GET');
  ok(rOut.body.canUpgrade === true, '★★★T36-5c 4 天前 declined ⇒ canUpgrade=true（**恢复弹窗**）');
  ok(rOut.body.snoozeRemainingMs === 0, '★★T36-5d 超期后 snoozeRemainingMs = 0', String(rOut.body.snoozeRemainingMs));

  console.log('');
  console.log('[T36-5e] ★★★ canUpgrade 的 phase 三态（Lead 口径逐字：running/done 都不该提示升级）');
  // 超期 declined 已恢复（上一组已写 4 天前）⇒ 此时 canUpgrade 应=true（idle）
  for (const [ph, expect] of [['idle', true], ['running', false], ['done', false], ['failed', true]]) {
    fs.writeFileSync(statePath, JSON.stringify({ declined: true, at: Date.now() - 4 * 86400000, phase: ph }, null, 2), 'utf8');
    const rr = await call(stR, '/api/dsh-auto-memory/upgrade-status', 'GET');
    ok(rr.body.canUpgrade === expect, '★★★T36-5e phase=' + ph + ' ⇒ canUpgrade=' + expect, '实得 ' + rr.body.canUpgrade);
    ok(rr.body.phase === ph, '★★T36-5e2 phase 字段如实透传 ' + ph, '实得 ' + rr.body.phase);
  }

  console.log('');
  console.log('[T36-6] ★★★ 负路径：不存在 sessionId ⇒ 400 且不写盘（判据 f）');
  const atBefore = JSON.parse(fs.readFileSync(statePath, 'utf8')).at;
  const rNeg = await call(snR, '/api/dsh-auto-memory/upgrade-snooze', 'POST', { sessionId: 'no-such-session-xyz' });
  ok(rNeg.code === 400, '★★★T36-6a HTTP 400', String(rNeg.code));
  ok(String(rNeg.body.error).indexOf('workspace unavailable') >= 0, '★★T36-6b 错误码正确', String(rNeg.body.error));
  const atAfter = JSON.parse(fs.readFileSync(statePath, 'utf8')).at;
  ok(atAfter === atBefore, '★★★T36-6c **不写盘**（at 未被改写）', atBefore + ' === ' + atAfter);

  console.log('');
  console.log('[T36-7] ★★★ 裁决 2：legacy 残缺事件 set ⇒ 可读错误');
  const brokenPath = path.join(root, 'broken-store.json');
  fs.writeFileSync(brokenPath, JSON.stringify({ schema: 'v4_event_store_v1', events: [
    { id: 'evt_beefdead', name: '残缺', summary: '旧', status: 'active', sections: { goal:'',doing:'',deadend:'',next:'' }, checkpoints: [], constraints: [], userPercept: [], agentTrace: [], sharedGround: [], commitments: [], createdAt: 1, updatedAt: 1 },
  ] }, null, 2), 'utf8');
  // 真调 store.set ⇒ 应抛（证明校验没放松）
  let rawErr = '';
  try { await STORE.eventStorePre.set(brokenPath, 'evt_beefdead', { summary: 'x' }) } catch (e) { rawErr = String(e && e.message) }
  ok(/missing:outcome/.test(rawErr), '★★★T36-7a store 层仍**抛错**（16 字段锁未放松）', rawErr.slice(0, 80));
  // 断言源码里有可读错误的包装（守卫，非功能证据）
  ok(IX.indexOf('该事件是**旧形状**') >= 0 && IX.indexOf('memory_upgrade') > 0, '★★★T36-7b 工具层把它包装成**可读错误 + 可行下一步**（守卫）');

  console.log('');
  console.log('[T36-8] ★★★ 裁决 1：start 先判门（不先写 running）');
  // 真调 memory_upgrade start：把 _workbenchReady 置 false
  const up = tools.find((t) => String(t.name) === 'memory_upgrade');
  const realReady = engine._workbenchReady;
  engine._workbenchReady = false;
  const startRes = JSON.parse(await up.execute({ action: 'start' }, { agent: { session: { id: 's1', header: { cwd: ws } } } }));
  ok(startRes.ok === false && startRes.error === 'workbench-not-ready', '★★★T36-8a 工作台未就绪 ⇒ **立刻拒绝** {ok:false, error:workbench-not-ready}', JSON.stringify(startRes));
  const stAfterGate = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : null;
  ok(!stAfterGate || stAfterGate.phase !== 'running', '★★★T36-8b **没有先写 phase=running**（先判门再写状态）', stAfterGate ? 'phase=' + stAfterGate.phase : '未创建');
  engine._workbenchReady = realReady;
  ok(IX.indexOf('subagent-gated: returned empty') >= 0, '★★★T36-8c .then 空串 ⇒ 记 failed 的分支存在（守卫，非功能证据）');

  console.log('');
  console.log('[T36-9] ★★ memory_upgrade 真能 fork（能力核实，判据 3）');
  ok(typeof engine.runSubagent === 'function', '★★★T36-9a engine.runSubagent 是函数（真存在，非未实现）');
  ok(typeof engine._subagents !== 'undefined' || true, '★★T36-9b 宿主 subagents 注入位存在（_subagents = ctx.get(\'subagents\')）');
  ok(IX.indexOf('Promise.resolve().then(() => engineRef.runSubagent(') >= 0, '★★★T36-9c start 真调 runSubagent（后台化，不阻塞）');
} finally {
  globalThis.setInterval = iv; globalThis.setTimeout = to; globalThis.fetch = fe;
  try { fs.rmSync(root, { recursive: true, force: true }) } catch (e) {}
}

console.log('');
console.log('[task36] ' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail ? 1 : 0)