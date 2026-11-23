#!/usr/bin/env node
/**
 * smoke-test-task31-p0p2.mjs —— task-31：P0 白板取对工作区 + P2 L0 总览可随时重写。
 *
 * ★用户裁定（逐字）：
 *   P0：「这个白板看板工作区判断有问题」
 *   P2：「让大模型重写的是一个事件的名字，就是高一层的那个简介一类的东西」
 *       「L0相当于总览，需要让模型按时更新——比如在更新事件时，或者觉得事情的总览
 *        （相当于标题）需要改变时，可以随时改、随时加」
 *
 * ★硬禁区：event-store 顶层 16 字段锁不得动；不得新增顶层字段。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const IX = fs.readFileSync(path.join(ROOT, 'lib', 'index.js'), 'utf8')
const ES = fs.readFileSync(path.join(ROOT, 'lib', 'event-store.js'), 'utf8')
const { apply, MemoryEngine } = await import(pathToFileURL(path.join(ROOT, 'tests', 'lib', 'state-engine.mjs')).href)
const STORE = await import(pathToFileURL(path.join(ROOT, 'lib', 'event-store.js')).href)

let pass = 0, fail = 0
const ok = (c, n, d) => { if (c) { pass++; console.log('  PASS ' + n + (d ? '  =>  ' + d : '')) } else { fail++; console.log('  FAIL ' + n + (d ? '  =>  ' + d : '')) } };

// ═══════════════════════════════════════════════════════════════════
console.log('[T31-1] P0 结构守卫（守卫，非功能证据）');
{
  const helper = IX.indexOf('  async resolvePathsForRequestPre(sessionId) {');
  ok(helper > 0, '★T31-1a resolvePathsForRequestPre 辅助方法存在');
  // 两 handler 区间内不得再有 resolvePaths(undefined)
  const iList = IX.indexOf("path: API['event-list']");
  const iDetail = IX.indexOf("path: API['event-detail']");
  // ★切片终点必须**紧贴 event-detail handler 结束**，不能拿「下一个路由」当锚点 ——
  //   task-36 在 event-detail 与 rules-list 之间插入了 upgrade-status / upgrade-snooze，
  //   用 rules-list 当终点会把新路由也纳进来 ⇒ 计数变成 4/2（假红）。
  //   ⇒ 从 iDetail 起找它自己的 handler 结束（`      },\n    },` 第一次出现）。
  const _detailHandlerEnd = IX.indexOf('\r\n      },\r\n    },', iDetail);
  if (_detailHandlerEnd < 0) throw new Error('event-detail handler 结束锚未找到');
  const region = IX.slice(iList, _detailHandlerEnd + 16);
  const hits = (region.match(/resolvePaths\(undefined\)/g) || []).length;
  ok(hits === 0, '★★★T31-1b event-list+event-detail 区间内 `resolvePaths(undefined)` 命中 **0**', String(hits));
  const calls = (region.match(/resolvePathsForRequestPre\(/g) || []).length;
  ok(calls === 2, '★★★T31-1c 两 handler 各调用一次 resolvePathsForRequestPre', String(calls));
  const guard = (region.match(/wsBound === false/g) || []).length;
  ok(guard === 2, '★★★T31-1d 两 handler 都有 wsBound===false ⇒ 400 的守卫', String(guard));
  ok(/error: 'workspace unavailable for this session'/.test(region), '★★T31-1e 400 错误码文案正确');
  // 兼容路径必须在注释里写清
  ok(/兼容路径/.test(IX.slice(helper - 400, helper + 1200)), '★★T31-1f 兼容路径有注释说明');
}

console.log('');
console.log('[T31-2] P2 结构守卫（守卫，非功能证据）');
{
  // 三条注入通路各有一条「L0 总览要重写」
  ok(IX.indexOf('L0 总览，要由你按时重写') >= 0, '★★★T31-2a 通路①GUIDANCE 含总览重写指引');
  // ★Lead 裁决（2026-10-25 22:2x）：铭文**不承载** P2 —— 铭文每轮都注入且已超 1500（既有欠账），
  //   P2 的价值由 GUIDANCE / 精简版 / 工具描述 三条通路承担，铭文这条「价值最低、成本最高」⇒ 撤除。
  //   ⇒ 判据改为**负路径**：铭文里不得再出现 P2 段（防止后人误加回去撑爆 1500）。
  ok(IX.indexOf('L0 总览，由你按时重写') < 0, '★★★T31-2b 铭文**不承载** P2（Lead 裁决：价值最低成本最高，已撤）');
  ok(IX.indexOf('L0 总览，要按时重写') >= 0, '★★★T31-2c 通路③精简版含总览重写指引');
  ok(/何时重写/.test(IX) && /可以随时改、随时加/.test(IX), '★★T31-2d 工具描述含「何时重写」判据 + 用户原话');
  // ★硬禁区：16 字段锁不得动
  const m = ES.match(/export const EVENT_TOP_FIELDS = Object\.freeze\(\[([\s\S]*?)\]\)/);
  const fields = m ? [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]) : [];
  ok(fields.length === 26, '★★★T31-2e **event-store 顶层字段仍恰好 26 个**（v6 B1 扩展，硬禁区已按裁定上移）', String(fields.length));
}

// ═══════════════════════════════════════════════════════════════════
// 真构造引擎（P0 用真 HTTP handler 逻辑 / P2 用真 store）
// ═══════════════════════════════════════════════════════════════════
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dam-t31-'));
const wsA = path.join(root, 'wsA'), wsB = path.join(root, 'wsB');
fs.mkdirSync(wsA, { recursive: true }); fs.mkdirSync(wsB, { recursive: true });
process.env.HOME = root; process.env.DSH_HOME = root;
fs.writeFileSync(path.join(root, 'dsh-auto-memory.json'), JSON.stringify({ memoryRoot: path.join(root, 'memory'), userMemoryDir: path.join(root, 'user'), handoffEnabled: true, autoContinueEnabled: true, teamEnabled: false, externalSources: {}, autoConsolidate: false }));
let engine = null;
const iv = globalThis.setInterval, to = globalThis.setTimeout, fe = globalThis.fetch;
const load = MemoryEngine.prototype.loadConfigSync;

try {
  globalThis.setInterval = globalThis.setTimeout = () => ({ unref() {} });
  globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({}) });
  MemoryEngine.prototype.loadConfigSync = function () { engine = this; return load.call(this) };
  apply({ get: () => undefined, on: () => () => {}, systemPrompt: { context: () => () => {}, section: () => () => {} }, tools: { register: () => () => {} }, webServer: { register: () => () => {} }, effect: (f) => { f() } }, {});
  MemoryEngine.prototype.loadConfigSync = load;
  engine.configLoaded = true; engine.state.ws = wsA;
  const pA = await engine.resolvePaths(undefined);
  fs.mkdirSync(pA.userDir, { recursive: true }); fs.mkdirSync(pA.projectDir, { recursive: true }); fs.mkdirSync(pA.handoffDir, { recursive: true });

  console.log('');
  console.log('[T31-3] ★★★ P0 行为：两工作区不串（真函数调用）');
  // 分别给 wsA / wsB 造两个不同的事件库
  const storeA = path.join(pA.handoffDir, 'event-store.json');
  // ★桩顺序修正：**先**解析 rB 拿到它自己的 handoffDir，**再**造 store（首版手算路径 ⇒ 算错）。
  await STORE.eventStorePre.create(storeA, { name: 'AAAA-事件', summary: 'A 工作区的事件' });
  // 用 resolvePathsForRequestPre 模拟 handler 的解析（真方法，不是字符串）
  engine.agentForSessionId = () => null;   // 无活 agent ⇒ 走 sessionWorkspaceFallback
  engine.sessionWorkspaceFallback = (id) => (String(id) === 'sidA' ? wsA : String(id) === 'sidB' ? wsB : null);
  const rA = await engine.resolvePathsForRequestPre('sidA');
  const rB = await engine.resolvePathsForRequestPre('sidB');
  // ★用 rB 自己解析出的 handoffDir 造 store（不手算路径）
  fs.mkdirSync(rB.pa.handoffDir, { recursive: true });
  const storeB = path.join(rB.pa.handoffDir, 'event-store.json');
  await STORE.eventStorePre.create(storeB, { name: 'BBBB-事件', summary: 'B 工作区的事件' });
  ok(rA.pa.wsBound === true && rB.pa.wsBound === true, '★★T31-3a 两个已知会话都 wsBound=true');
  const listA = await STORE.eventStorePre.list(path.join(rA.pa.handoffDir, 'event-store.json'), { all: true, withPercept: true });
  const listB = await STORE.eventStorePre.list(path.join(rB.pa.handoffDir, 'event-store.json'), { all: true, withPercept: true });
  ok(listA.events.length === 1 && listA.events[0].name === 'AAAA-事件', '★★★T31-3b 会话A 只看到自己的事件', JSON.stringify(listA.events.map((e) => e.name)));
  ok(listB.events.length === 1 && listB.events[0].name === 'BBBB-事件', '★★★T31-3c 会话B 只看到自己的事件', JSON.stringify(listB.events.map((e) => e.name)));
  ok(listA.events[0].name !== listB.events[0].name, '★★★T31-3d **两工作区不串味**（决定性证据）');
  // ★负路径：伪造 sessionId
  const rBad = await engine.resolvePathsForRequestPre('fake-sid-xyz');
  ok(rBad.pa.wsBound === false, '★★★T31-3e 伪造 sessionId ⇒ **wsBound=false**（不是拿全局值冒充）', String(rBad.pa.wsBound));
  // 单工作区无回归：不传 sessionId ⇒ 走兼容路径
  const rCompat = await engine.resolvePathsForRequestPre('');
  ok(rCompat.fallbackCompat === true, '★★T31-3f 不传 sessionId ⇒ fallbackCompat=true（兼容旧前端）');

  console.log('');
  console.log('[T31-4] ★★★ P2 行为：summary 可单独改、name 不变');
  const evA = listA.events[0];
  const oldNameA = evA.name;
  const beforeLen = 'A 工作区的事件'.length;
  await STORE.eventStorePre.set(storeA, evA.id, { summary: '这是重写后的新总览，代表当前状态' });
  const after = await STORE.eventStorePre.detail(storeA, evA.id);
  ok(after.event.summary === '这是重写后的新总览，代表当前状态', '★★★T31-4a summary 真的被改写了', JSON.stringify(after.event.summary));
  ok(after.event.name === oldNameA, '★★★T31-4b **name 未被改动**（set 只动 summary）', JSON.stringify(after.event.name));
  ok(after.event.updatedAt > evA.updatedAt, '★★T31-4c updatedAt 前进了');

  console.log('');
  console.log('[T31-5] rename：id 不变、name 变');
  const beforeRenameId = after.event.id;
  await STORE.eventStorePre.rename(storeA, beforeRenameId, 'AAAA-事件-改名后');
  const afterRename = await STORE.eventStorePre.detail(storeA, beforeRenameId);
  ok(afterRename.event.name === 'AAAA-事件-改名后', '★★★T31-5a name 改了', JSON.stringify(afterRename.event.name));
  ok(afterRename.event.id === beforeRenameId, '★★★T31-5b **id 不变**（用户要的是改标题不是换容器）', afterRename.event.id);
  ok(afterRename.event.summary === '这是重写后的新总览，代表当前状态', '★★T31-5c rename 不动 summary');

  console.log('');
  console.log('[T31-6] ★负路径：closed 事件的 set / rename 行为');
  await STORE.eventStorePre.close(storeA, beforeRenameId, '已完成');
  // set summary 在 closed 后仍允许（事件 store 契约：set 未禁 closed）—— 记录真实行为
  let closedSetOk = false, closedSetErr = '';
  try { await STORE.eventStorePre.set(storeA, beforeRenameId, { summary: '收口后的最终总览' }); closedSetOk = true } catch (e) { closedSetErr = String(e && e.message) }
  ok(closedSetOk === true, '★★T31-6a closed 后 set summary **允许**（这是「close 前必须写成果进总览」的兜底：忘了也能补）', closedSetOk ? '允许' : closedSetErr);
  // append 在 closed 后必须拒绝（既有契约，回归）
  let appendRejected = false;
  try { await STORE.eventStorePre.append(storeA, beforeRenameId, { checkpoint: { text: 'x' } }) } catch (e) { appendRejected = /closed/.test(String(e && e.message)) }
  ok(appendRejected, '★★★T31-6b closed 后 append **必须拒绝**（既有契约未破坏）');
  // 空 summary / 超长 name 的边界
  let emptyNameRejected = false;
  try { await STORE.eventStorePre.rename(storeA, beforeRenameId, '') } catch (e) { emptyNameRejected = true }
  ok(emptyNameRejected, '★★T31-6c rename 空名必须拒绝');
  let longNameRejected = false;
  try { await STORE.eventStorePre.rename(storeA, beforeRenameId, 'x'.repeat(81)) } catch (e) { longNameRejected = true }
  ok(longNameRejected, '★★T31-6d rename >80 字必须拒绝（契约 ≤80）');
  // 非法字段
  let badFieldRejected = false;
  try { await STORE.eventStorePre.set(storeA, beforeRenameId, { notAField: 1 }) } catch (e) { badFieldRejected = true }
  ok(badFieldRejected, '★★★T31-6e set 非法字段必须拒绝（ALLOWED 白名单）');

  console.log('');
  console.log('[T31-7] ★硬禁区回归：16 字段锁 + schema 未变');
  const freshStore = path.join(root, 'fresh-store.json');
  const created = await STORE.eventStorePre.create(freshStore, { name: 'n', summary: 's' });
  const topKeys = Object.keys(created).sort();
  ok(topKeys.length === 26, '★★★T31-7a 新建事件顶层键 = 26（v6 B1）', String(topKeys.length));
  ok(STORE.EVENT_TOP_FIELDS.length === 26, '★★★T31-7b EVENT_TOP_FIELDS 长度 = 26');
  ok(STORE.EVENT_STORE_SCHEMA === 'v4_event_store_v2', '★★T31-7c schema 升至 v2（v6 B1，读兼容 v1）');
} finally {
  globalThis.setInterval = iv; globalThis.setTimeout = to; globalThis.fetch = fe;
  try { fs.rmSync(root, { recursive: true, force: true }) } catch (e) {}
}

console.log('');
console.log('[task31-p0p2] ' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail ? 1 : 0)