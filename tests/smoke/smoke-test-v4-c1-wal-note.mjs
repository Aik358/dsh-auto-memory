#!/usr/bin/env node
/**
 * smoke-test-v4-c1-wal-note.mjs —— C1：memory_note(plan/handoff) 改事件优先（WAL 三步）。
 *
 * ★用户裁定（2026-10-25 逐字）：「把这个问题1的这个 memory note 还是要**追加在事件下**，
 *   反正都是以事件为中心了，这样能理得更清楚一点，只要保证这个语义唤回引擎能够触及到足够
 *   的唤回细节就行了。」
 *
 * ★改动前的两个真缺陷（本套件把两条都变成可红的断言）：
 *   ① 方向反了：.md 主写、事件镜像。
 *   ② plan 的镜像调 `mirrorPlanSectionsPre(storePath, { sections })`，而该函数入参是 **planText**
 *      ⇒ 内部 parseLedgerSectionsPre('') 得空四段 ⇒ 走「无可镜像」早退
 *      ⇒ 事件里连 sections 都没更新，更没有「白板被更新过」的时间线。
 *
 * ★WAL 三步：Phase1 先 append 事件检查点 → Phase2 再写 .md（CAS/M1/锚点门一字不动）
 *   → Phase3 .md 被门拦下 ⇒ 追加 plan-write-failed 补偿 + 如实报错。
 *
 * ★不要假设 renderMemoryDynamic 的返回形状（纯字符串），本套件不涉及注入。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const { apply, MemoryEngine } = await import(pathToFileURL(path.join(ROOT, 'tests', 'lib', 'state-engine.mjs')).href)
const esp = (await import(pathToFileURL(path.join(ROOT, 'lib', 'event-store.js')).href)).eventStorePre
const IX = fs.readFileSync(path.join(ROOT, 'lib', 'index.js'), 'utf8')

let pass = 0, fail = 0
const ok = (c, n, d) => { if (c) { pass++; console.log('  PASS ' + n + (d ? '  =>  ' + d : '')) } else { fail++; console.log('  FAIL ' + n + (d ? '  =>  ' + d : '')) } };

// ══════════════════════════════════════════════════════════════════════
// 真引擎 + 真工具（memory_note 是 tool.execute，不是 route）
// ══════════════════════════════════════════════════════════════════════
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dam-c1-'));
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

let hd = '', storePath = '', note = null, agent = null;
const cps = async () => {
  const all = await esp.list(storePath, { all: true });
  const ev = (all.events || [])[0];
  if (!ev) return [];
  const d = await esp.detail(storePath, ev.id);
  return ((d.event && d.event.checkpoints) || []);
};
const kindsOf = (arr) => arr.map((x) => String(x.kind));
const secsOf = async () => {
  const all = await esp.list(storePath, { all: true });
  const ev = (all.events || [])[0];
  if (!ev) return {};
  const d = await esp.detail(storePath, ev.id);
  return (d.event && d.event.sections) || {};
};
// ★P-H1 要求每个 ## 节 >= 20 非空白字符
const mkPlan = (doing) => ['# 白板 · 测试项目', '', '## 目标', '这是一个足够长的目标段落用于通过内容门禁的检查', '', '## 进行中', doing, '', '## 失败与弯路', '目前没有失败的方案需要记录在案的情况', '', '## 下一步', '下一步继续推进当前的改造工作任务内容'].join('\n');
// ★H2 判据要求**每段 chars >= 20**（实测：写短了会被判据门拦下，产生 handoff-write-failed 补偿）
const mkLedger = () => ['# 交接账本 · 测试', '', '## 任务状态', '- 当前正在推进 C1 的事件优先改造工作，已完成 WAL 三步接线与端到端验证', '', '## 目标', '让 memory_note 以事件为第一等单元记录内容，保证语义唤回引擎能触及足够细节', '', '## 已试方案与失败原因', '- 目前没有失败的方案需要记录在案，所有改动均已通过套件断言', '', '## 进度与下一步', '- 继续推进 C2/C3/C4 三张卡，先跑 /tests/smoke 下的相关套件再汇报给负责人'].join('\n');

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
  globalThis.setInterval = iv; globalThis.setTimeout = to; globalThis.fetch = fe;
  MemoryEngine.prototype.loadConfigSync = load;
  engine.configLoaded = true;
  engine.state.ws = ws;
  const paths = await engine.resolvePaths(undefined);
  hd = paths.handoffDir;
  fs.mkdirSync(hd, { recursive: true });
  storePath = path.join(hd, 'event-store.json');
  note = tools.find((t) => String(t.name) === 'memory_note');
  agent = { session: { id: 's1', header: { cwd: ws } } };

  // ── C1-0 前置：工具与引擎就位 ──
  console.log('[C1-0] 前置');
  ok(!!note && typeof note.execute === 'function', 'C1-0a memory_note 工具已注册且可 execute');
  ok(IX.indexOf('WAL 三步') >= 0 && IX.indexOf('Phase 1') >= 0, 'C1-0b 源码含 WAL 三步标记（守卫，非功能证据）');

  // ── C1-1 ★核心：plan 写入后 checkpoints +1，kind=plan ──
  console.log('');
  console.log('[C1-1] ★核心：plan ⇒ 事件 checkpoints +1');
  const c0 = await cps();
  ok(c0.length === 0, 'C1-1a 前置：空库 checkpoints=0', String(c0.length));
  const r1 = await note.execute({ kind: 'plan', content: mkPlan('- 正在做 C1 改造的第一步工作') }, { agent });
  const c1 = await cps();
  ok(c1.length === c0.length + 1, '★★★C1-1b plan 写入后 checkpoints 恰 +1（改动前只 set sections ⇒ +0）', `${c0.length} → ${c1.length}`);
  ok(kindsOf(c1).includes('plan'), '★★C1-1c 该检查点 kind === \'plan\'（明确语义，不是泛化 log）', JSON.stringify(kindsOf(c1)));
  ok(String(r1).indexOf('已更新') >= 0, 'C1-1d 返回成功文案', JSON.stringify(String(r1).slice(0, 40)));

  // ── C1-2 检查点 text 含 PLAN 全文可检索片段 ──
  console.log('');
  console.log('[C1-2] 检查点 text 含 PLAN 全文（语义唤回要能取到细节）');
  const planCk = c1.filter((x) => String(x.kind) === 'plan').pop();
  ok(!!planCk, 'C1-2a 找到 kind=plan 的检查点');
  const ckText = String((planCk && planCk.text) || '');
  ok(ckText.indexOf('正在做 C1 改造的第一步工作') >= 0, '★★C1-2b 检查点 text 含 PLAN 的「进行中」正文（不是摘要）', 'len=' + ckText.length);
  ok(ckText.indexOf('## 目标') >= 0 || ckText.indexOf('这一步') >= 0 || ckText.length > 100, '★★C1-2c 检查点保存的是**全文**（长度 > 100）', 'len=' + ckText.length);

  // ── C1-7 ★修的真缺陷：sections 是否真镜像（旧代码传 sections ⇒ 恒空）──
  console.log('');
  console.log('[C1-7] ★真缺陷回归：plan 的 sections 必须真镜像进事件头');
  const s1 = await secsOf();
  ok(String(s1.goal || '').indexOf('足够长的目标段落') >= 0, '★★★C1-7a 事件头 sections.goal 已镜像（旧代码传 sections ⇒ 恒空）', JSON.stringify(String(s1.goal || '')));
  ok(String(s1.doing || '').indexOf('正在做 C1') >= 0, '★★C1-7b sections.doing 已镜像', JSON.stringify(String(s1.doing || '')));
  ok(String(s1.next || '').length > 5, 'C1-7c sections.next 已镜像', JSON.stringify(String(s1.next || '').slice(0, 30)));

  // ── C1-3 ★顺序断言：事件 append 必须在 writePlanSnapshot 之前 ──
  console.log('');
  console.log('[C1-3] ★顺序：Phase1(事件) 必须早于 Phase2(.md)');
  // ★数据源审计（Lead 2026-10-25 问「是不是真的从被测代码记录的，而不是桩自己排的」）：
  //   是。做法 = **patch 产品方法** `engine.writePlanSnapshot` 的入口，在入口里 `await cps()`
  //   **真读 event-store.json**。所以 ckAtWriteTime 反映的是「真实 store 在那一刻已写入几条」，
  //   不是桩自己记账。若 Phase1 没先 append，这里读到的只会是 before3。
  let ckAtWriteTime = -1;
  let writeCalled = 0;
  const origWrite = engine.writePlanSnapshot.bind(engine);
  engine.writePlanSnapshot = async (...args) => {
    writeCalled += 1;
    ckAtWriteTime = (await cps()).length;
    return origWrite(...args);
  };
  const before3 = (await cps()).length;
  await note.execute({ kind: 'plan', content: mkPlan('- 顺序探针用的第二轮进行中内容') }, { agent });
  engine.writePlanSnapshot = origWrite;
  // ★先证「探针真的命中了入口」（否则 ckAtWriteTime 恒 -1，下面的断言会假绿/假红都说不清）
  ok(writeCalled >= 1, '★★C1-3a0 探针确实进入了 writePlanSnapshot（防「探针没命中 ⇒ 断言无意义」）', 'writeCalled=' + writeCalled);
  ok(ckAtWriteTime > before3, '★★★C1-3a 进入 writePlanSnapshot 时事件里**已有**新检查点（证明 append 在前）', `写入时=${ckAtWriteTime} 之前=${before3}`);

  // ── C1-4 ★负路径：.md 被门拦下 ⇒ 补偿 checkpoint + 如实报错 ──
  console.log('');
  console.log('[C1-4] ★负路径：门拦下 ⇒ 补偿检查点 + 报错含原因');
  const before4 = (await cps()).length;
  const badPlan = ['# 白板 · 测试项目', '', '## 目标', '短', '', '## 进行中', '短', '', '## 下一步', '短'].join('\n');
  const r4 = await note.execute({ kind: 'plan', content: badPlan }, { agent });
  const c4 = await cps();
  ok(kindsOf(c4).includes('plan-write-failed'), '★★★C1-4a 门拦下后追加了 plan-write-failed 补偿检查点', JSON.stringify(kindsOf(c4)));
  ok(/失败|拦截|拦下/.test(String(r4)), '★★C1-4b 返回文案**如实报错**（含失败/拦截字样）', JSON.stringify(String(r4).slice(0, 60)));
  ok(c4.length >= before4 + 1, 'C1-4c 补偿检查点确实新增（事件先记全，不丢内容）', `${before4} → ${c4.length}`);

  // ── C1-5 幂等：同内容重复调用，kind=plan 检查点不重复 ──
  console.log('');
  console.log('[C1-5] 幂等：同内容重放，plan 检查点不重复');
  const planCount = (await cps()).filter((x) => String(x.kind) === 'plan').length;
  const P_SAME = mkPlan('- 幂等测试专用的稳定进行中内容文本');
  await note.execute({ kind: 'plan', content: P_SAME }, { agent });
  const pc1 = (await cps()).filter((x) => String(x.kind) === 'plan').length;
  await note.execute({ kind: 'plan', content: P_SAME }, { agent });
  const pc2 = (await cps()).filter((x) => String(x.kind) === 'plan').length;
  ok(pc2 === pc1, '★★C1-5a 同内容重放两次，kind=plan 检查点数不变（idemKey 去重）', `${pc1} → ${pc2}`);

  // ── C1-6 handoff：同样 +1 / kind / 幂等 ──
  console.log('');
  console.log('[C1-6] handoff：+1 / kind=handoff / 幂等');
  const h0 = (await cps()).length;
  const rh = await note.execute({ kind: 'handoff', content: mkLedger() }, { agent });
  const h1 = (await cps()).length;
  ok(h1 === h0 + 1, '★★C1-6a handoff 写入后 checkpoints **恰** +1（无补偿检查点 = .md 真写成功）', `${h0} → ${h1}`);
  ok(!kindsOf(await cps()).includes('handoff-write-failed'), '★★C1-6a2 且**无** handoff-write-failed 补偿（证明 .md 写入成功，测的是正常路径）', JSON.stringify(kindsOf(await cps())));
  ok(kindsOf(await cps()).includes('handoff'), '★★C1-6b kind === \'handoff\'', JSON.stringify(kindsOf(await cps())));
  const hc0 = (await cps()).filter((x) => String(x.kind) === 'handoff').length;
  await note.execute({ kind: 'handoff', content: mkLedger() }, { agent });
  const hc1 = (await cps()).filter((x) => String(x.kind) === 'handoff').length;
  ok(hc1 === hc0, '★★C1-6c 同内容重放，handoff 检查点数不变', `${hc0} → ${hc1}`);
} finally {
  // ★★2026-10-25 修（全量回归实测抓到 · 进程退出崩溃）：**必须在 finally 恢复被 patch 的全局定时器/fetch**。
  //   实测：全量并行时本套件概率 exit=3221226505（0xC0000409 / libuv `UV_HANDLE_CLOSING` 断言），
  //   而套件自身断言全绿 ⇒ 不是判据问题，是**进程退出时崩溃**。
  //   根因：本套件在 try **中间**恢复（`globalThis.setInterval = iv` 等），一旦 try 中途抛异常
  //   就**恢复不到** ⇒ 后续/libuv 内部拿到假的定时器 ⇒ 退出时句柄状态不一致 ⇒ 崩溃。
  //   ★这是全仓同类套件的**通病**，已一次性修 8 个（其余 6 个本来就把恢复写在 finally 里）。
  globalThis.setInterval = iv;
  globalThis.setTimeout = to;
  globalThis.fetch = fe;
  try { fs.rmSync(root, { recursive: true, force: true }) } catch (e) {}
}

console.log('');
console.log('[v4-c1-wal-note] ' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail ? 1 : 0)