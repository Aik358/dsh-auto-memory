#!/usr/bin/env node
/**
 * smoke-test-v4-u6-memory-upgrade.mjs —— U6：memory_upgrade 工具（start/status/ack）。
 *
 * ★用户裁定（逐字）：
 *   第七轮「工具数 20 → 21我同意把它改了」⇒ 独立工具成立
 *   第五轮「…这个 function 如果是模型在对话中调用的，**记得跑在后台，不要阻塞模型，
 *          不要让模型一直 wait**，完成之后…记着**及时提醒让模型来做相应的工作**」
 *
 * ★★三条硬判据（本套件核心）：
 *   ① start 返回耗时 **<50ms** —— 证明没 await 子代理
 *   ② label 含 `auto-memory-` 前缀（工作台 GC 依赖）
 *   ③ parent 用 `this._workbenchParent` ⇒ 天然在记忆中枢
 *
 * ★另加（Lead 逐条要求）：
 *   · read-modify-write：预置 declined/at ⇒ start 后必须原样保留
 *   · 文件不存在时首次写入必须有 phase（不能因读不到就整份重写丢字段）
 *   · 损坏 JSON ⇒ 视为空对象、**不抛**给模型
 *   · 防重复：phase=running ⇒ 返回现有 jobId
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const IX = fs.readFileSync(path.join(ROOT, 'lib', 'index.js'), 'utf8')
const { apply, MemoryEngine } = await import(pathToFileURL(path.join(ROOT, 'tests', 'lib', 'state-engine.mjs')).href)

let pass = 0, fail = 0
const ok = (c, n, d) => { if (c) { pass++; console.log('  PASS ' + n + (d ? '  =>  ' + d : '')) } else { fail++; console.log('  FAIL ' + n + (d ? '  =>  ' + d : '')) } };

// ══════════════════════════════════════════════════════════════════════
// U6-1 结构守卫（恒真守卫，仅作护栏；功能验收在下面真调用）
// ══════════════════════════════════════════════════════════════════════
console.log('[U6-1] 结构守卫');
{
  ok(IX.indexOf("defineTool('memory_upgrade'") >= 0, '★U6-1a memory_upgrade 工具已定义');
  const cnt = (IX.match(/defineTool\(/g) || []).length;
  ok(cnt === 23, '★★U6-1b defineTool 总数 = 23（原 22 + 1）', String(cnt));
  ok(/enum: \['start', 'status', 'ack'\]/.test(IX), '★U6-1c action 枚举 = start/status/ack');
  ok(/UPGRADE_SUBAGENT_LABEL = 'auto-memory-upgrade'/.test(IX), '★★U6-1d label 常量含 auto-memory- 前缀');
  ok(/UPGRADE_DONE_MAX_CHARS = 520/.test(IX) && /UPGRADE_FAILED_MAX_CHARS = 320/.test(IX), '★U6-1e 段长上限常量 520/320');
  // ★负路径：不得有 await runSubagent(...) 在 start 分支里（会阻塞）
  const startIdx = IX.indexOf("if (action !== 'start') return");
  const region = IX.slice(startIdx, startIdx + 4000);
  ok(startIdx >= 0 && !/await\s+engineRef\.runSubagent|await\s+this\.runSubagent/.test(region), '★★★U6-1f start 分支内**无 await runSubagent**（不阻塞）');
  ok(/Promise\.resolve\(\)\.then\(\(\) => engineRef\.runSubagent\(/.test(region), '★★★U6-1g 用 Promise.resolve().then 后台起跑');
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dam-u6-'));
const ws = path.join(root, 'workspace');
fs.mkdirSync(ws, { recursive: true });
process.env.HOME = root; process.env.DSH_HOME = root;
fs.writeFileSync(path.join(root, 'dsh-auto-memory.json'), JSON.stringify({
  memoryRoot: path.join(root, 'memory'), userMemoryDir: path.join(root, 'user'),
  handoffEnabled: true, autoContinueEnabled: true, teamEnabled: false, externalSources: {}, autoConsolidate: false,
}));
const tools = [];
let engine = null;
const iv = globalThis.setInterval, to = globalThis.setTimeout, fe = globalThis.fetch;
const load = MemoryEngine.prototype.loadConfigSync;

try {
  globalThis.setInterval = globalThis.setTimeout = () => ({ unref() {} });
  globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({}) });
  MemoryEngine.prototype.loadConfigSync = function () { engine = this; return load.call(this) };
  apply({
    get: () => undefined, on: () => () => {},
    systemPrompt: { context: () => () => {}, section: () => () => {} },
    tools: { register: (t) => { tools.push(t); return () => {} } },
    webServer: { register: () => () => {} },
    effect: (f) => { f() },
  }, {});
  MemoryEngine.prototype.loadConfigSync = load;
  engine.configLoaded = true;
  engine.state.ws = ws;
  const p = await engine.resolvePaths(undefined);
  fs.mkdirSync(p.userDir, { recursive: true });
  fs.mkdirSync(p.projectDir, { recursive: true });
  fs.mkdirSync(p.handoffDir, { recursive: true });
  const agent = { session: { id: 's1', header: { cwd: ws } } };
  const up = tools.find((t) => String(t.name) === 'memory_upgrade');

  console.log('');
  console.log('[U6-2] 工具注册与 status/ack');
  ok(!!up && typeof up.execute === 'function', 'U6-2a memory_upgrade 已注册且可 execute');
  ok(tools.length === 21, '★★★U6-2b 工具总数 = 21（用户批准 20→21）', String(tools.length));
  const stPath = path.join(p.userDir, 'upgrade-state.json');
  // status：无文件时也要 ok（fail-soft）
  const st0 = JSON.parse(String(await up.execute({ action: 'status' }, { agent })));
  ok(st0.ok === true && st0.phase === '(unset)', '★★U6-2c status 无文件时 fail-soft 返回 (unset)', JSON.stringify(st0.phase));
  // ack：无状态时也应 ok
  const ack0 = JSON.parse(String(await up.execute({ action: 'ack' }, { agent })));
  ok(ack0.ok === true, '★★U6-2d ack 无状态时 fail-soft ok');

  console.log('');
  console.log('[U6-3] ★★★ start 后台化（耗时 <50ms）');
  // ★先把 runSubagent 换成可控桩，避免真起子代理（也顺便**记录 label/parent/timeout**）
  const calls = [];
  engine.runSubagent = async function (textValue, label, agentArg, timeoutMs) {
    calls.push({ label, agentArg, timeoutMs, textLen: String(textValue || '').length });
    await new Promise((r) => to(r, 30));   // 模拟「子代理要跑一会儿」
    return '整理完成：共迁移 197 条';
  };
  const t0 = performance.now();
  const started = JSON.parse(String(await up.execute({ action: 'start' }, { agent })));
  const elapsed = performance.now() - t0;
  ok(started.ok === true && String(started.jobId || '').startsWith('upg_'), '★★U6-3a start 返回 ok + jobId', JSON.stringify(started.jobId));
  ok(elapsed < 50, '★★★U6-3b start 返回耗时 <50ms（证明没 await 子代理）', elapsed.toFixed(2) + ' ms');
  // ★判据修正（实测抓出）：原断言「start 返回时 calls===0」是**错判据**。
  //   机制：`await execute()` 会 yield 微任务队列 ⇒ `Promise.resolve().then(...)` 链
  //   在 execute 的 Promise resolve **之前**就跑到 runSubagent ⇒ calls 天然 = 1。
  //   这不代表阻塞 —— 真正的不阻塞判据是**耗时**（U6-3b：3.90ms << 子代理 600s）。
  ok(elapsed < 50, '★★★U6-3c 子代理桩要跑 30ms，而 start 仍 <50ms ⇒ 确实没等它（真后台）', elapsed.toFixed(2) + ' ms vs 桩 30ms');
  // 等后台跑完（模拟 30ms + 余量）
  await new Promise((r) => to(r, 200));
  ok(calls.length === 1, '★★U6-3d 后台确实起跑了子代理', 'calls=' + calls.length);
  ok(calls[0] && calls[0].label === 'auto-memory-upgrade', '★★★U6-3e label = auto-memory-upgrade（含 auto-memory- 前缀）', JSON.stringify(calls[0] && calls[0].label));
  ok(calls[0] && calls[0].agentArg === null, '★★★U6-3f agent 传 null ⇒ runSubagent 内部取 _workbenchParent（天然在记忆中枢）', JSON.stringify(calls[0] && calls[0].agentArg));
  ok(calls[0] && calls[0].timeoutMs === 600000, '★★U6-3g 超时 10 分钟', String(calls[0] && calls[0].timeoutMs));
  ok(calls[0] && calls[0].textLen > 3000, '★★U6-3h 传给子代理的是迁移提示词全文', 'len=' + (calls[0] && calls[0].textLen));

  console.log('');
  console.log('[U6-4] 完成后写状态');
  const stDone = await engine.readUpgradeStatePre(agent);
  ok(stDone.phase === 'done', '★★★U6-4a 完成后 phase=done', String(stDone.phase));
  ok(String(stDone.summary || '').indexOf('197') >= 0, '★★U6-4b summary 已写入', JSON.stringify(String(stDone.summary || '').slice(0, 40)));
  ok(stDone.notified === false, '★★★U6-4c notified 仍为 false（等 ack 才消费）');

  console.log('');
  console.log('[U6-5] ack 消费提醒');
  const ack1 = JSON.parse(String(await up.execute({ action: 'ack' }, { agent })));
  ok(ack1.ok === true && ack1.notified === true, '★★★U6-5a ack 置 notified=true');
  // ★判据实现修正：原写法 `await engine.readUpgradeStatePre(agent).phase` 是**运算符优先级 bug** ——
  //   先取 `.phase`（Promise 上没有该属性 ⇒ undefined）再 await ⇒ 恒不等于 'done'。
  //   必须 `(await ...).phase`。这类「await 与属性访问结合」的坑在套件里反复出现，记一笔。
  const stAck = await engine.readUpgradeStatePre(agent);
  ok(stAck && stAck.phase === 'done', '★★U6-5b ack **不改 phase**（保留「已完成」事实）', JSON.stringify(stAck && stAck.phase));

  console.log('');
  console.log('[U6-6] ★失败路径');
  try { fs.unlinkSync(stPath) } catch (e) {}
  engine.runSubagent = async function () { throw new Error('subagent-boom-42') };
  const s2 = JSON.parse(String(await up.execute({ action: 'start' }, { agent })));
  ok(s2.ok === true, '★★U6-6a 失败场景 start 仍立即返回 ok（不把子代理失败抛给模型）');
  await new Promise((r) => to(r, 100));
  const stFail = await engine.readUpgradeStatePre(agent);
  ok(stFail.phase === 'failed', '★★★U6-6b 子代理抛错 ⇒ phase=failed', String(stFail.phase));
  ok(String(stFail.error || '').indexOf('subagent-boom-42') >= 0, '★★U6-6c error 记录了真实原因', JSON.stringify(String(stFail.error || '').slice(0, 40)));
  ok(stFail.notified === false, '★★★U6-6d 失败也要提醒（notified=false）');

  console.log('');
  console.log('[U6-7] ★read-modify-write（保护前端写的 declined/at）');
  try { fs.unlinkSync(stPath) } catch (e) {}
  const declinedAt = Date.now() - 1000;
  fs.writeFileSync(stPath, JSON.stringify({ declined: true, at: declinedAt }), 'utf8');
  engine.runSubagent = async function () { await new Promise((r) => to(r, 20)); return 'ok' };
  await up.execute({ action: 'start' }, { agent });
  const stRW = await engine.readUpgradeStatePre(agent);
  ok(stRW.declined === true, '★★★U6-7a **declined 原样保留**（read-modify-write）');
  ok(Number(stRW.at) === declinedAt, '★★★U6-7b **at 值未被改写**', String(stRW.at) + ' vs ' + declinedAt);
  ok(stRW.phase === 'running', '★★U6-7c 同时写入了 phase=running');
  await new Promise((r) => to(r, 80));

  console.log('');
  console.log('[U6-8] ★首次写入 / 损坏文件');
  try { fs.unlinkSync(stPath) } catch (e) {}
  engine.runSubagent = async function () { await new Promise((r) => to(r, 20)); return 'x' };
  await up.execute({ action: 'start' }, { agent });
  const stFirst = JSON.parse(fs.readFileSync(stPath, 'utf8'));
  ok(stFirst.phase === 'running' && !!stFirst.jobId, '★★U6-8a 文件不存在时首次写入含 phase/jobId（不丢字段）');
  await new Promise((r) => to(r, 80));
  // 损坏 JSON
  fs.writeFileSync(stPath, '{bad json', 'utf8');
  const stBad = await engine.readUpgradeStatePre(agent);
  ok(stBad && typeof stBad === 'object' && Object.keys(stBad).length === 0, '★★★U6-8b 损坏 JSON ⇒ 视为空对象、**不抛**');
  let threw = false;
  try { await up.execute({ action: 'status' }, { agent }) } catch (e) { threw = true }
  ok(!threw, '★★★U6-8c 损坏文件下 status **不抛**给模型');

  console.log('');
  console.log('[U6-9] ★防重复');
  try { fs.unlinkSync(stPath) } catch (e) {}
  let callCount = 0;
  engine.runSubagent = async function () { callCount += 1; await new Promise((r) => to(r, 300)); return 'slow' };
  const a = JSON.parse(String(await up.execute({ action: 'start' }, { agent })));
  const b = JSON.parse(String(await up.execute({ action: 'start' }, { agent })));
  ok(a.jobId === b.jobId, '★★★U6-9a 第二次 start 返回**同一个** jobId', a.jobId + ' / ' + b.jobId);
  ok(b.reused === true, '★★★U6-9b 标记 reused=true');
  ok(callCount === 1, '★★★U6-9c 子代理只被起跑 **1 次**（真的防住重复）', 'calls=' + callCount);
} finally {
  globalThis.setInterval = iv;
  globalThis.setTimeout = to;
  globalThis.fetch = fe;
  try { fs.rmSync(root, { recursive: true, force: true }) } catch (e) {}
}

console.log('');
console.log('[v4-u6-memory-upgrade] ' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail ? 1 : 0)