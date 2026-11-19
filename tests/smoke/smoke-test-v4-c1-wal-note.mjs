#!/usr/bin/env node
/**
 * C1：通过真实 memory_note 工具验证旧 plan/handoff 的事件归档。
 * 2.8/2.9 定稿：可预期拒绝零写入；成功落盘后才写摘要和来源指纹；
 * 终检意外失败仅在显式有效事件留下失败检查点，不能伪造成功正文。
 */
import fs from 'node:fs'
import { createHash } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { eventStorePre as esp, readStorePre } from '../../lib/event-store.js'
import { readEventCheckpointPre } from '../../lib/event-drilldown.js'
import { normalizeText } from '../../lib/ledger-doc/protocol.js'
import { planRevisionPre } from '../../lib/plan-store.js'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const { apply, MemoryEngine } = await import(pathToFileURL(path.join(ROOT, 'tests', 'lib', 'state-engine.mjs')).href)
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
  handoffEnabled: true, ledgerDocEnabled: false, autoContinueEnabled: true, teamEnabled: false, externalSources: {}, autoConsolidate: false,
}));
const tools = [];
let engine = null;
const iv = globalThis.setInterval, to = globalThis.setTimeout, fe = globalThis.fetch;
const load = MemoryEngine.prototype.loadConfigSync;

let hd = '', storePath = '', note = null, agent = null;
const eventDetail = async () => {
  const all = await esp.list(storePath, { all: true });
  const ev = (all.events || [])[0];
  if (!ev) return null;
  const d = await esp.detail(storePath, ev.id);
  return d.event;
};
const cps = async () => (await eventDetail())?.checkpoints || [];
const kindsOf = (arr) => arr.map((x) => String(x.kind));
const hash = (value) => createHash('sha256').update(value).digest('hex');
const planBytes = () => fs.readFileSync(path.join(hd, 'PLAN.md'));
const revision = () => planRevisionPre(planBytes().toString('utf8'));
async function probePlan(input, probe) {
  const original = engine.writePlanSnapshot;
  engine.writePlanSnapshot = (...args) => probe(original.bind(engine), args);
  try { return await note.execute({ kind: 'plan', ...input }, { agent }); }
  finally { engine.writePlanSnapshot = original; }
}
// P-H1 要求至少一个二级节的正文达 20 字符。
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

  // ── C1-2 摘要能索引关键信息，来源指针能完整读回磁盘正文 ──
  console.log('');
  console.log('[C1-2] 摘要索引 + 已验证的全文读回');
  const planCk = c1.filter((x) => String(x.kind) === 'plan').pop();
  ok(!!planCk, 'C1-2a 找到 kind=plan 的检查点');
  const ckText = String((planCk && planCk.text) || '');
  ok(ckText.includes('正在做 C1 改造的第一步工作'), '★★C1-2b 检查点摘要保留 PLAN 的「进行中」正文', 'len=' + ckText.length);
  const firstBytes = planBytes();
  const firstText = firstBytes.toString('utf8');
  const eventId = (await eventDetail())?.id;
  const readback = await readEventCheckpointPre({ store: await readStorePre(storePath), eventId, checkpointIndex: c1.indexOf(planCk), handoffDir: hd });
  ok(ckText.length > 0 && ckText.length <= 300 && ckText !== firstText, 'C1-2c1 检查点保存至多 300 字符的摘要，不复制全文');
  ok(planCk?.sourceRef === 'PLAN.md' && planCk.bytes === firstBytes.length && planCk.rawSha256 === hash(firstBytes)
    && planCk.normalizedSha256 === hash(normalizeText(firstText)), 'C1-2c2 真源路径、字节数和两个完整 SHA-256 均对上磁盘');
  ok(readback.ok === true && readback.verified === true && readback.source === 'trusted-handoff'
    && Buffer.from(readback.text).equals(firstBytes), 'C1-2c3 经来源指针逐字节还原 PLAN 全文');

  // ── C1-7 ★修的真缺陷：sections 是否真镜像（旧代码传 sections ⇒ 恒空）──
  console.log('');
  console.log('[C1-7] ★真缺陷回归：plan 的 sections 必须真镜像进事件头');
  const s1 = (await eventDetail())?.sections || {};
  ok(String(s1.goal || '').indexOf('足够长的目标段落') >= 0, '★★★C1-7a 事件头 sections.goal 已镜像（旧代码传 sections ⇒ 恒空）', JSON.stringify(String(s1.goal || '')));
  ok(String(s1.doing || '').indexOf('正在做 C1') >= 0, '★★C1-7b sections.doing 已镜像', JSON.stringify(String(s1.doing || '')));
  ok(String(s1.next || '').length > 5, 'C1-7c sections.next 已镜像', JSON.stringify(String(s1.next || '').slice(0, 30)));

  // ── C1-3 落盘之后才有可信检查点 ──
  console.log('');
  console.log('[C1-3] 顺序：.md 先落盘，随后新增可信检查点');
  let ckAtWriterEntry = -1;
  let ckAtWriterReturn = -1;
  let writeCalled = 0;
  let writerResult;
  let bytesAtWriterReturn;
  const before3 = (await cps()).length;
  const plan2 = mkPlan('- 顺序探针用的第二轮进行中内容');
  const r3 = await probePlan({ content: plan2, expectedRevision: revision(), eventId }, async (write, args) => {
    writeCalled += 1;
    ckAtWriterEntry = (await cps()).length;
    writerResult = await write(...args);
    bytesAtWriterReturn = planBytes();
    ckAtWriterReturn = (await cps()).length;
    return writerResult;
  });
  ok(writeCalled === 1 && writerResult?.committed === true && String(r3).includes('PLAN.md 已更新'), 'C1-3a0 真写入命中且提交成功', `${writeCalled}: ${r3}`);
  ok(ckAtWriterEntry === before3 && ckAtWriterReturn === before3 && bytesAtWriterReturn?.includes('顺序探针用的第二轮进行中内容'),
    'C1-3a1 真读事件库和文件：writer 返回时文件已更新，事件还未追加', `${ckAtWriterEntry} → ${ckAtWriterReturn}`);
  const c3 = await cps();
  ok(c3.length === before3 + 1 && c3.at(-1)?.kind === 'plan' && bytesAtWriterReturn && c3.at(-1).rawSha256 === hash(bytesAtWriterReturn),
    'C1-3a2 工具返回时恰新增一条引用已提交文件的检查点', `${before3} → ${c3.length}`);
  const stalePointer = await readEventCheckpointPre({ store: await readStorePre(storePath), eventId, checkpointIndex: c1.indexOf(planCk), handoffDir: hd });
  ok(stalePointer.code === 'pointer-drift' && stalePointer.verified === false && stalePointer.text === ckText,
    'C1-3b 旧指针不能冒认更新后的白板，回读明确返回旧摘要');

  // ── C1-4 预检拒绝零落盘；正式写入失败只在显式事件里留痕 ──
  console.log('');
  console.log('[C1-4] 负路径：预检拒绝、正式写入失败、无归属');
  const before4 = await cps();
  const bytes4 = planBytes();
  const badPlan = ['# 白板 · 测试项目', '', '## 目标', '短', '', '## 进行中', '短', '', '## 下一步', '短'].join('\n');
  let preflightWriterCalls = 0;
  const r4Pre = await probePlan({ content: badPlan, expectedRevision: revision(), eventId }, (write, args) => {
    preflightWriterCalls++;
    return write(...args);
  });
  ok(String(r4Pre).includes('白板预检拒绝') && String(r4Pre).includes('P-H1') && preflightWriterCalls === 0,
    'C1-4a1 正确 revision 的无效正文被真实 P-H1 预检拒绝，未调用正式 writer', String(r4Pre));
  ok(JSON.stringify(await cps()) === JSON.stringify(before4) && planBytes().equals(bytes4), 'C1-4a2 预检失败事件内容与白板字节均不变');
  const failInWriter = async (target) => {
    let code;
    const response = await probePlan({ content: plan2, expectedRevision: revision(), ...(target ? { eventId: target } : {}) }, async (write, args) => {
      const old = engine._settingsMigrationActive;
      engine._settingsMigrationActive = true;
      try { const result = await write(...args); code = result.error; return result; }
      finally { engine._settingsMigrationActive = old; }
    });
    return { response: String(response), code };
  };
  const r4 = await failInWriter(eventId);
  const c4 = await cps();
  ok(r4.code === 'settings-migration-active' && r4.response.includes('白板写入失败(settings-migration-active)'), 'C1-4b 实际 writer 拒写且错误码透传', r4.response);
  ok(c4.length === before4.length + 1 && c4.at(-1)?.kind === 'plan-write-failed'
    && c4.at(-1).text.includes('settings-migration-active') && c4.at(-1).text.includes('事件侧未记录本次正文'),
    'C1-4c 显式事件只加一条可追溯失败，不伪造原文检查点', JSON.stringify(kindsOf(c4)));
  const r4NoTarget = await failInWriter();
  ok(r4NoTarget.code === r4.code && r4NoTarget.response === r4.response && JSON.stringify(await cps()) === JSON.stringify(c4)
    && planBytes().equals(bytes4), 'C1-4d 无显式事件仍如实报错，无补偿或文件副作用');

  // ── C1-5 幂等：同内容重复调用，kind=plan 检查点不重复 ──
  console.log('');
  console.log('[C1-5] 幂等：同内容重放，plan 检查点不重复');
  const planCount = (await cps()).filter((x) => String(x.kind) === 'plan').length;
  const P_SAME = mkPlan('- 幂等测试专用的稳定进行中内容文本');
  const r5a = await note.execute({ kind: 'plan', content: P_SAME, expectedRevision: revision(), eventId }, { agent });
  const pc1 = (await cps()).filter((x) => String(x.kind) === 'plan').length;
  const r5b = await note.execute({ kind: 'plan', content: P_SAME, expectedRevision: revision(), eventId }, { agent });
  const pc2 = (await cps()).filter((x) => String(x.kind) === 'plan').length;
  ok(String(r5a).includes('PLAN.md 已更新') && pc1 === planCount + 1, 'C1-5a0 首次实写新内容，证明幂等检查命中写入路径');
  ok(String(r5b).includes('PLAN.md 已更新') && pc2 === pc1, 'C1-5a 同内容重放两次，kind=plan 检查点数不变（idemKey 去重）', `${pc1} → ${pc2}`);

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
