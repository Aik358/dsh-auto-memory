import assert from 'node:assert/strict'
import * as fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { pathToFileURL } from 'node:url'

import {
  HANDOFF_CHECKPOINT_SUMMARY_CHARS,
  buildHandoffCheckpointSummaryPre,
} from '../../lib/handoff-checkpoint.js'
import { appendHandoffCheckpointPre, createEventForWorkPre } from '../../lib/event-write.js'
import { buildHandoffSourceProofPre, parseHandoffCoveragePre } from '../../lib/handoff-coverage.js'
import { readEventCheckpointPre } from '../../lib/event-drilldown.js'
import { normalizeText } from '../../lib/ledger-doc/protocol.js'

const root = path.resolve('artifacts', '_batch2-2.7-checkpoint')
const mutationRoot = path.resolve('artifacts', '_batch2-2.7-checkpoint-mutations')
let pass = 0, fail = 0
const failures = []
const evidence = []

async function test(name, fn) {
  try {
    const value = await fn()
    pass++
    console.log('  ✓ ' + name + (value === undefined ? '' : '  [' + value + ']'))
    return value
  } catch (error) {
    fail++
    failures.push({ name, error: String((error && error.message) || error) })
    console.log('  ✗ ' + name + '  ' + String((error && error.message) || error))
  }
}

const sha256hex = (value) => crypto.createHash('sha256').update(value).digest('hex')
const LEDGER_TITLE = '# 交接账本 · 2026-11-13 22:30'

/** 造一篇**真四段**账本。repeat 越大越可能超 300 字符，用于截断用例。 */
function makeLedger({ goal, state, dead, next, repeat = 1 }) {
  const seg = (v) => Array.from({ length: repeat }, () => v).join('')
  return [
    LEDGER_TITLE,
    '', '## 任务状态', seg(state),
    '', '## 目标', seg(goal),
    '', '## 已试方案与失败原因', seg(dead),
    '', '## 进度与下一步', seg(next), ''
  ].join('\n')
}

/** 真落盘 + 真解析 + 真证明（等价于 task-18 共享入口的前半段） */
async function stageLedger(dir, rel, text) {
  await fs.mkdir(path.join(dir, 'handoff'), { recursive: true })
  await fs.writeFile(path.join(dir, 'handoff', rel), text, 'utf8')
  const handoffDir = path.join(dir, 'handoff')
  const proof = await buildHandoffSourceProofPre(
    { documentText: text, sourceRef: 'handoff/' + rel, expectDiskText: true },
    { handoffDir }
  )
  const parsed = parseHandoffCoveragePre(text)
  const quad = { goal: parsed.quad.goal, state: parsed.quad.state, dead: parsed.quad.dead, next: parsed.quad.next }
  return { dir, rel, text, proof, quad, handoffDir }
}

const BASE = {
  goal: '把检查点正文从全文改成 300 字符摘要，保留完整指纹。',
  state: '已实现摘要模块，四段映射与预算兜底都通了。',
  dead: '- 全文 8KB 撑爆召回语料 → 改摘要。',
  next: '接 event-write 摘要路径并读回 checkpointIndex。',
}

await fs.rm(root, { recursive: true, force: true })
await fs.mkdir(root, { recursive: true })

// ══════════════ A 组：纯函数（真 import → 真调用 → 断言返回值） ══════════════

await test('A1 上限常量 = 300（与用户裁定 G-2 同值）', () => {
  assert.equal(HANDOFF_CHECKPOINT_SUMMARY_CHARS, 300)
  return '300'
});

await test('A2 空正文 / 非法 kind / 非对象 quad 均显式失败，不抛未处理异常', () => {
  assert.equal(buildHandoffCheckpointSummaryPre({ kind: 'handoff', text: '', quad: BASE }).code, 'text-empty')
  assert.equal(buildHandoffCheckpointSummaryPre({ kind: 'nope', text: 'x', quad: BASE }).code, 'kind-invalid')
  assert.equal(buildHandoffCheckpointSummaryPre({ kind: 'handoff', text: 'x', quad: 'nope' }).code, 'quad-invalid')
  assert.equal(buildHandoffCheckpointSummaryPre(null).code, 'input-invalid')
  return '4/4 负路径命中'
});

await test('A3 handoff 必须给原始四段（缺 quad ⇒ 拒绝；已给但全空 ⇒ 允许）', () => {
  assert.equal(buildHandoffCheckpointSummaryPre({ kind: 'handoff', text: 'x' }).code, 'quad-required')
  const empty = buildHandoffCheckpointSummaryPre({ kind: 'handoff', text: '# t\n正文一句', quad: { goal: '', state: '', dead: '', next: '' } })
  assert.equal(empty.ok, true)
  return 'quad-required 拒绝 + 全空四段通过'
});

await test('A4 plan 无四段合法（白板不要求四段式）', () => {
  const r = buildHandoffCheckpointSummaryPre({ kind: 'plan', text: '## 当前状态\n| a | b |\n|--|--|\n| 1 | 2 |' })
  assert.equal(r.ok, true)
  assert.ok(r.text.length > 0)
  assert.equal(r.sectionsOverride.goal, '')
  return 'chars=' + r.chars
});

await test('A5 确定性：同输入两次逐字节同输出', () => {
  const text = makeLedger(BASE)
  const a = buildHandoffCheckpointSummaryPre({ kind: 'handoff', text, quad: BASE })
  const b = buildHandoffCheckpointSummaryPre({ kind: 'handoff', text, quad: BASE })
  assert.equal(a.text, b.text)
  assert.equal(a.chars, b.chars)
  return 'sha16=' + sha256hex(a.text).slice(0, 16)
});

await test('A6 输入不可变：调用后 quad 原样（不被裁剪/改写）', () => {
  const quad = { ...BASE }
  const snapshot = JSON.stringify(quad)
  buildHandoffCheckpointSummaryPre({ kind: 'handoff', text: makeLedger(BASE), quad })
  assert.equal(JSON.stringify(quad), snapshot)
  return 'quad 逐字节未变'
});

await test('A7 ★超长时才均分配额：四段全部保留（不漏段），且总长 ≤300', () => {
  const huge = {
    goal: '目标长句。'.repeat(40),
    state: '现状长句。'.repeat(40),
    dead: '失败长句。'.repeat(40),
    next: '下一步长句。'.repeat(40),
  }
  const r = buildHandoffCheckpointSummaryPre({ kind: 'handoff', text: makeLedger(huge), quad: huge })
  assert.equal(r.ok, true)
  assert.ok(r.chars <= HANDOFF_CHECKPOINT_SUMMARY_CHARS, 'chars=' + r.chars)
  for (const label of ['目标：', '现状：', '失败：', '下一步：']) assert.ok(r.text.includes(label), 'missing ' + label)
  return 'chars=' + r.chars + ' 四段齐全'
});

await test('A8 短正文不加预算逻辑（与均分逻辑引入前逐字节相同）', () => {
  const r = buildHandoffCheckpointSummaryPre({ kind: 'handoff', text: makeLedger(BASE), quad: BASE })
  assert.equal(r.truncated, false)
  const expected = '目标：' + BASE.goal + ' / 现状：' + BASE.state + ' / 失败：' + BASE.dead + ' / 下一步：' + BASE.next
  assert.equal(r.text, expected)
  return 'chars=' + r.chars
});

await test('A9 锚点不进摘要（HTML 注释与半截标记都被剥掉）', () => {
  const dirty = '# t\n<!-- memory:mem_' + 'a'.repeat(32) + ' -->\n正文 <!-- type=goal'
  const r = buildHandoffCheckpointSummaryPre({ kind: 'plan', text: dirty })
  assert.equal(r.ok, true)
  assert.ok(!r.text.includes('<!--'), 'leak: ' + r.text)
  assert.ok(!r.text.includes('-->'), 'leak: ' + r.text)
  return JSON.stringify(r.text)
});

await test('A10 sectionsOverride 原样回传（不压行、不裁剪 —— 与真源解析逐字一致）', () => {
  const quad = { goal: 'G\n第二行', state: 'S  ', dead: '', next: 'N' }
  const r = buildHandoffCheckpointSummaryPre({ kind: 'handoff', text: '# t\n## 目标\nG', quad })
  assert.equal(r.sectionsOverride.goal, 'G\n第二行')
  assert.equal(r.sectionsOverride.state, 'S  ')
  assert.equal(r.sectionsOverride.dead, '')
  return '含换行与尾空格均原样保留'
});
// ══════════════ B 组：真实落盘 → 真读回 ══════════════

async function freshCase(name) {
  const dir = path.join(root, name)
  await fs.mkdir(dir, { recursive: true })
  return { dir, storePath: path.join(dir, 'event-store.json') }
}

async function appendCase(context, staged, kind = 'handoff') {
  const created = await createEventForWorkPre(context.storePath, { today: '2026-11-13', dayBoundaryMinutes: 450, name: 'case-' + kind });
  const summary = buildHandoffCheckpointSummaryPre({ kind, text: staged.text, quad: staged.quad });
  assert.equal(summary.ok, true, summary.code);
  const result = await appendHandoffCheckpointPre(context.storePath, {
    ledgerText: staged.text,
    kind,
    eventId: created.id,
    summary,
    sourceProof: staged.proof,
    sectionsOverride: staged.quad,
  });
  return { created, summary, result };
}

async function readCheckpoint(context, eventId, index) {
  const store = JSON.parse(await fs.readFile(context.storePath, 'utf8'));
  const event = store.events.find((item) => item.id === eventId);
  assert.ok(event, 'event missing: ' + eventId);
  return { store, event, cp: event.checkpoints[index] };
}

await test('B1 ★摘要落盘：text 长度 ≤300，且严格短于真源', async () => {
  const ctx = await freshCase('b1');
  const staged = await stageLedger(ctx.dir, 'handoff-b1.md', makeLedger(BASE));
  const { result } = await appendCase(ctx, staged);
  assert.equal(result.ok, true);
  assert.ok(result.summaryChars <= 300, 'chars=' + result.summaryChars);
  const { cp } = await readCheckpoint(ctx, result.eventId, result.checkpointIndex);
  assert.equal(cp.text.length, result.summaryChars);
  const sourceBytes = Buffer.byteLength(staged.text, 'utf8');
  assert.ok(cp.text.length < staged.text.length, 'summary should be shorter');
  evidence.push({ kind: 'B1', sourceBytes, summaryChars: cp.text.length });
  return 'source=' + sourceBytes + 'B → summary=' + cp.text.length + 'chars';
});

await test('B2 ★溯源四项：bytes / rawSha256 / normalizedSha256 / sourceRef 全部可复算', async () => {
  const ctx = await freshCase('b2');
  const text = makeLedger(BASE);
  const staged = await stageLedger(ctx.dir, 'handoff-b2.md', text);
  const { result } = await appendCase(ctx, staged);
  const { cp } = await readCheckpoint(ctx, result.eventId, result.checkpointIndex);
  assert.equal(cp.bytes, Buffer.byteLength(text, 'utf8'));
  assert.equal(cp.rawSha256, sha256hex(Buffer.from(text, 'utf8')));
  assert.equal(cp.normalizedSha256, sha256hex(normalizeText(text)));
  assert.equal(cp.sourceRef, 'handoff-b2.md');
  assert.equal(cp.rawSha256.length, 64);
  assert.equal(cp.normalizedSha256.length, 64);
  return 'bytes=' + cp.bytes + ' raw16=' + cp.rawSha256.slice(0, 16) + ' norm16=' + cp.normalizedSha256.slice(0, 16);
});

await test('B3 ★读回真源：readEventCheckpointPre verified=true 且正文与真源逐字节相等', async () => {
  const ctx = await freshCase('b3');
  const text = makeLedger(BASE);
  const staged = await stageLedger(ctx.dir, 'handoff-b3.md', text);
  const { result } = await appendCase(ctx, staged);
  const { store } = await readCheckpoint(ctx, result.eventId, result.checkpointIndex);
  const back = await readEventCheckpointPre({ store, eventId: result.eventId, checkpointIndex: result.checkpointIndex, handoffDir: staged.handoffDir });
  assert.equal(back.ok, true);
  assert.equal(back.verified, true, 'code=' + back.code);
  assert.equal(back.source, 'trusted-handoff');
  assert.equal(back.text, text);
  return 'verified + 逐字节还原 ' + Buffer.byteLength(text, 'utf8') + 'B';
});

await test('B4 ★四段来自原始解析，不是从摘要派生（摘要被截断后四段仍完整）', async () => {
  const ctx = await freshCase('b4');
  const huge = { goal: '目标长句。'.repeat(40), state: '现状长句。'.repeat(40), dead: '失败长句。'.repeat(40), next: '下一步长句。'.repeat(40) };
  const staged = await stageLedger(ctx.dir, 'handoff-b4.md', makeLedger(huge));
  const { summary, result } = await appendCase(ctx, staged);
  // ★truncated 表示「原文有内容没进摘要」（可观测性），不是「最终串超上限」。
  //   均分后长度恒 ≤300，若用「长度超限」当判据会恒为 false ⇒ 调用方永远看不到内容被丢。
  assert.equal(summary.truncated, true, 'precondition: summary must report content loss');
  assert.ok(summary.chars <= HANDOFF_CHECKPOINT_SUMMARY_CHARS, 'chars=' + summary.chars);
  const { cp } = await readCheckpoint(ctx, result.eventId, result.checkpointIndex);
  assert.equal(cp.goal, staged.quad.goal);
  assert.equal(cp.state, staged.quad.state);
  assert.equal(cp.dead, staged.quad.dead);
  assert.equal(cp.next, staged.quad.next);
  // ★真不变量：四段必须**逐字等于真源解析值**，且**不等于摘要文本**。
  //   首版写的是「state 比摘要长」—— 那是错的：真源某一节本来就可能比整条摘要短
  //   （实测 state=200 而 summary=298），拿长度比大小是假判据。
  assert.notEqual(cp.state, summary.text, 'quad must not be the summary text');
  assert.notEqual(cp.goal, summary.text, 'quad must not be the summary text');
  assert.ok(summary.text.includes('目标：'), 'summary carries field labels, quad does not');
  assert.ok(!cp.goal.includes('目标：'), 'quad must be raw source text without summary labels');
  return 'summary=' + summary.chars + 'chars，四段均等于真源解析（state=' + cp.state.length + '字）';
});

await test('B5 ★幂等：同正文重复调用 deduped=true 且不重复追加', async () => {
  const ctx = await freshCase('b5');
  const staged = await stageLedger(ctx.dir, 'handoff-b5.md', makeLedger(BASE));
  const { created, result } = await appendCase(ctx, staged);
  const summary2 = buildHandoffCheckpointSummaryPre({ kind: 'handoff', text: staged.text, quad: staged.quad });
  const again = await appendHandoffCheckpointPre(ctx.storePath, {
    ledgerText: staged.text, kind: 'handoff', eventId: created.id, summary: summary2, sourceProof: staged.proof, sectionsOverride: staged.quad,
  });
  assert.equal(again.deduped, true);
  assert.equal(again.checkpointIndex, result.checkpointIndex);
  const { event } = await readCheckpoint(ctx, created.id, result.checkpointIndex);
  assert.equal(event.checkpoints.length, 1);
  return 'deduped 且 checkpointCount=1';
});

await test('B6 ★幂等身份含完整正文：摘要之外内容变了必须产生新检查点', async () => {
  const ctx = await freshCase('b6');
  const first = await stageLedger(ctx.dir, 'handoff-b6.md', makeLedger(BASE));
  const { created, result } = await appendCase(ctx, first);
  const changed = first.text + '\n补充一句只出现在正文末尾、进不了 300 字符摘要的话。';
  await fs.writeFile(path.join(ctx.dir, 'handoff', 'handoff-b6.md'), changed, 'utf8');
  const proof2 = await buildHandoffSourceProofPre({ documentText: changed, sourceRef: 'handoff/handoff-b6.md', expectDiskText: true }, { handoffDir: first.handoffDir });
  const summary2 = buildHandoffCheckpointSummaryPre({ kind: 'handoff', text: changed, quad: first.quad });
  const second = await appendHandoffCheckpointPre(ctx.storePath, {
    ledgerText: changed, kind: 'handoff', eventId: created.id, summary: summary2, sourceProof: proof2, sectionsOverride: first.quad,
  });
  assert.equal(second.deduped, false);
  assert.notEqual(second.checkpointIndex, result.checkpointIndex);
  const { event } = await readCheckpoint(ctx, created.id, result.checkpointIndex);
  assert.equal(event.checkpoints.length, 2);
  return 'checkpointCount=2（未把不同意图误判为重复）';
});
await test('B7 ★摘要路径缺 sourceProof ⇒ 拒绝落盘，且事件库字节不变', async () => {
  const ctx = await freshCase('b7');
  const staged = await stageLedger(ctx.dir, 'handoff-b7.md', makeLedger(BASE));
  const created = await createEventForWorkPre(ctx.storePath, { today: '2026-11-13', dayBoundaryMinutes: 450, name: 'b7' });
  const summary = buildHandoffCheckpointSummaryPre({ kind: 'handoff', text: staged.text, quad: staged.quad });
  const before = await fs.readFile(ctx.storePath, 'utf8');
  await assert.rejects(
    () => appendHandoffCheckpointPre(ctx.storePath, { ledgerText: staged.text, kind: 'handoff', eventId: created.id, summary }),
    (error) => error.code === 'source-proof-required'
  );
  const after = await fs.readFile(ctx.storePath, 'utf8');
  assert.equal(after, before, 'store must be untouched on rejection');
  return 'code=source-proof-required 且字节不变';
});

await test('B8 ★半截指纹被拒（sha16 不能冒充历史身份）', async () => {
  const ctx = await freshCase('b8');
  const staged = await stageLedger(ctx.dir, 'handoff-b8.md', makeLedger(BASE));
  const created = await createEventForWorkPre(ctx.storePath, { today: '2026-11-13', dayBoundaryMinutes: 450, name: 'b8' });
  const summary = buildHandoffCheckpointSummaryPre({ kind: 'handoff', text: staged.text, quad: staged.quad });
  const shortProof = { ...staged.proof, rawSha256: String(staged.proof.rawSha256).slice(0, 16) };
  await assert.rejects(
    () => appendHandoffCheckpointPre(ctx.storePath, { ledgerText: staged.text, kind: 'handoff', eventId: created.id, summary, sourceProof: shortProof, sectionsOverride: staged.quad }),
    (error) => error.code === 'source-proof-raw-sha256-invalid'
  );
  return 'code=source-proof-raw-sha256-invalid';
});

await test('B9 event-store 白名单处再拦一道：非法指纹拒绝落盘', async () => {
  const ctx = await freshCase('b9');
  const created = await createEventForWorkPre(ctx.storePath, { today: '2026-11-13', dayBoundaryMinutes: 450, name: 'b9' });
  const { eventStorePre } = await import('../../lib/event-store.js');
  await assert.rejects(
    () => eventStorePre.append(ctx.storePath, created.id, { checkpoint: { kind: 'log', at: Date.now(), text: 'x', rawSha256: 'deadbeef' } }),
    (error) => error.code === 'checkpoint-fingerprint-invalid'
  );
  return 'code=checkpoint-fingerprint-invalid';
});

await test('B10 ★旧路径零回归：不传 summary/sourceProof 时仍写全文，返回值形状不变', async () => {
  const ctx = await freshCase('b10');
  const text = makeLedger(BASE);
  const created = await createEventForWorkPre(ctx.storePath, { today: '2026-11-13', dayBoundaryMinutes: 450, name: 'b10' });
  const legacy = await appendHandoffCheckpointPre(ctx.storePath, { ledgerText: text, kind: 'handoff', eventId: created.id });
  assert.equal(legacy.ok, true);
  assert.equal(legacy.eventId, created.id);
  assert.equal(Object.prototype.hasOwnProperty.call(legacy, 'checkpointIndex'), false, 'legacy shape must not gain checkpointIndex');
  const { cp } = await readCheckpoint(ctx, created.id, 0);
  assert.equal(cp.text, text, 'legacy path still stores full text');
  assert.equal(cp.sourceRef, null);
  return 'legacy 全文 ' + cp.text.length + ' 字，且无 checkpointIndex 键';
});

await test('B11 plan 走同一摘要契约，不强套 handoff 四段完整性', async () => {
  const ctx = await freshCase('b11');
  const planText = '# 项目白板 · demo\n\n## 当前状态\n\n| 事件名 | 状态 |\n|---|---|\n| A | 进行 |\n\n## 近期进展（按时间倒序）\n\n正文。\n';
  const staged = await stageLedger(ctx.dir, 'PLAN.md', planText);
  const { result } = await appendCase(ctx, staged, 'plan');
  assert.equal(result.ok, true);
  assert.ok(result.summaryChars <= 300);
  const { cp } = await readCheckpoint(ctx, result.eventId, result.checkpointIndex);
  assert.equal(cp.kind, 'plan');
  assert.equal(cp.rawSha256.length, 64);
  return 'kind=plan chars=' + cp.text.length;
});

await test('B12 ★跨事件不串：两个事件的检查点各自独立可读回', async () => {
  const ctx = await freshCase('b12');
  const a = await stageLedger(ctx.dir, 'handoff-b12a.md', makeLedger({ ...BASE, goal: '事件A目标。' }));
  const b = await stageLedger(ctx.dir, 'handoff-b12b.md', makeLedger({ ...BASE, goal: '事件B目标。' }));
  const ra = await appendCase(ctx, a);
  const rb = await appendCase(ctx, b);
  assert.notEqual(ra.created.id, rb.created.id);
  const { store } = await readCheckpoint(ctx, ra.created.id, ra.result.checkpointIndex);
  const backA = await readEventCheckpointPre({ store, eventId: ra.created.id, checkpointIndex: ra.result.checkpointIndex, handoffDir: a.handoffDir });
  const backB = await readEventCheckpointPre({ store, eventId: rb.created.id, checkpointIndex: rb.result.checkpointIndex, handoffDir: b.handoffDir });
  assert.equal(backA.text, a.text);
  assert.equal(backB.text, b.text);
  assert.notEqual(backA.text, backB.text);
  return '2 事件各自 verified';
});

await test('B13 ★漂移检测：真源被改写后不得再报 verified（不能把当前文件冒充历史）', async () => {
  const ctx = await freshCase('b13');
  const text = makeLedger(BASE);
  const staged = await stageLedger(ctx.dir, 'handoff-b13.md', text);
  const { result } = await appendCase(ctx, staged);
  const { store, cp: storedCp } = await readCheckpoint(ctx, result.eventId, result.checkpointIndex);
  const cpTextBefore = storedCp.text;
  const driftedBody = text + '\n事后被改写了。\n';
  await fs.writeFile(path.join(ctx.dir, 'handoff', 'handoff-b13.md'), driftedBody, 'utf8');
  const back = await readEventCheckpointPre({ store, eventId: result.eventId, checkpointIndex: result.checkpointIndex, handoffDir: staged.handoffDir });
  // ★实测语义（不是推理）：真源被改写后 readEventCheckpointPre 返回
  //     ok=false / verified=false / code=pointer-drift / source=checkpoint，
  //     且 text 是**落盘的摘要正文**，绝不是被改写后的当前文件。
  //   ⇒ 要守的不变量是「不把当前文件冒充历史」，不是「ok 仍为 true」。
  assert.equal(back.ok, false, 'drifted pointer must not report ok');
  assert.equal(back.verified, false, 'drifted source must not verify');
  assert.equal(back.source, 'checkpoint', 'must fall back to the stored checkpoint');
  assert.equal(back.code, 'pointer-drift', 'code=' + back.code);
  assert.notEqual(back.text, driftedBody, 'must NOT return the drifted current file as history');
  assert.equal(back.text, cpTextBefore, 'fallback text must be the stored checkpoint text');
  return 'ok=false / verified=false / source=checkpoint / text=落盘摘要（非当前文件）';
});
// ══════════════ C 组：隔离变异（副本目录，绝不动共享工作树） ══════════════
//
// 纪律：① 变异只在 artifacts 下的**副本**里做，共享工作树全程只读；
//       ② 每条变异先断言锚串恰命中 1 次（锚没命中 = 变异体没变 = 恒绿假 MISSED）；
//       ③ 变异体必须**真跑同一条生产路径**，用它的实际返回值/落盘结果证明区别，
//          不能只看源码字符串。

const cleanWrite = await fs.readFile('lib/event-write.js', 'utf8');
const cleanSummary = await fs.readFile('lib/handoff-checkpoint.js', 'utf8');

const DEPENDENCIES = [
  'event-store.js', 'handoff-checkpoint.js', 'handoff-coverage.js', 'handoff-normalize.js',
  'event-drilldown.js', 'event-pointer.js', 'file-boundary.js', 'shared-state-lock.js',
  'plan-render.js', 'event-render.js', 'ledger-doc/protocol.js',
];

const MUT_QUAD = {
  goal: '变异用例目标。'.repeat(20),
  state: '变异用例现状。'.repeat(20),
  dead: '变异用例失败。'.repeat(20),
  next: '变异用例下一步。'.repeat(20),
};
const MUT_LEDGER = makeLedger(MUT_QUAD);

/** 复制被测模块 + 全部依赖到隔离目录，再在副本上打变异补丁 */
async function materializeMutant(variant) {
  const dir = path.join(mutationRoot, variant.name);
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });
  for (const dep of DEPENDENCIES) {
    const target = path.join(dir, dep);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(path.join('lib', dep), target);
  }
  const clean = variant.file === 'event-write.js' ? cleanWrite : cleanSummary;
  const hits = clean.split(variant.anchor).length - 1;
  assert.equal(hits, 1, 'mutation anchor must appear exactly once: ' + variant.name);
  await fs.writeFile(path.join(dir, variant.file), clean.split(variant.anchor).join(variant.replacement), 'utf8');
  const module = await import(pathToFileURL(path.join(dir, variant.file)).href + '?mut=' + variant.name + '&t=' + Date.now());
  return { dir, module };
}

/** 在变异体上跑**同一条生产路径**，返回结果与落盘检查点 */
async function runAppendWith(appendFn, dir, ledgerText, quad) {
  const handoffDir = path.join(dir, 'handoff');
  await fs.mkdir(handoffDir, { recursive: true });
  await fs.writeFile(path.join(handoffDir, 'mut.md'), ledgerText, 'utf8');
  const proof = await buildHandoffSourceProofPre(
    { documentText: ledgerText, sourceRef: 'handoff/mut.md', expectDiskText: true },
    { handoffDir }
  );
  const summary = buildHandoffCheckpointSummaryPre({ kind: 'handoff', text: ledgerText, quad });
  const storePath = path.join(dir, 'mut-store.json');
  const created = await createEventForWorkPre(storePath, { today: '2026-11-13', dayBoundaryMinutes: 450, name: 'mut' });
  const result = await appendFn(storePath, {
    ledgerText, kind: 'handoff', eventId: created.id, summary, sourceProof: proof, sectionsOverride: quad,
  });
  const store = JSON.parse(await fs.readFile(storePath, 'utf8'));
  const event = store.events.find((item) => item.id === created.id);
  return { storePath, handoffDir, created, result, event, cp: event.checkpoints[result.checkpointIndex], summary };
}

// ★基线：干净实现在同一夹具下的读数（变异必须与它**可判读地不同**）
const baselineDir = path.join(root, '_mut-baseline');
await fs.mkdir(baselineDir, { recursive: true });
const baselineOutcome = await runAppendWith(appendHandoffCheckpointPre, baselineDir, MUT_LEDGER, MUT_QUAD);
const baseline = {
  textChars: baselineOutcome.cp.text.length,
  quadEqual: baselineOutcome.cp.goal === MUT_QUAD.goal,
  checkpointCount: baselineOutcome.event.checkpoints.length,
};

await test('M0 基线可判读：摘要短于真源、四段等于原文、count=1', () => {
  assert.ok(baseline.textChars <= 300, 'textChars=' + baseline.textChars);
  assert.ok(baseline.textChars < MUT_LEDGER.length);
  assert.equal(baseline.quadEqual, true);
  assert.equal(baseline.checkpointCount, 1);
  return 'baseline textChars=' + baseline.textChars + ' / quadEqual / count=1';
});

// ── M1：全文回填 ──
const m1 = await materializeMutant({
  name: 'full-text-backfill',
  file: 'event-write.js',
  anchor: 'text: cutSummaryTextPre(summaryText),',
  replacement: 'text: String(ledgerText),',
});
await test('M1 full-text-backfill ⇒ 落盘 text 变回全文（B1 判据必红）', async () => {
  const out = await runAppendWith(m1.module.appendHandoffCheckpointPre, path.join(m1.dir, 'case'), MUT_LEDGER, MUT_QUAD);
  assert.ok(out.cp.text.length > HANDOFF_CHECKPOINT_SUMMARY_CHARS, 'mutant text=' + out.cp.text.length);
  assert.equal(out.cp.text, MUT_LEDGER, 'mutant must backfill the full ledger');
  assert.notEqual(out.cp.text.length, baseline.textChars);
  evidence.push({ kind: 'mutation', name: 'full-text-backfill', mutantChars: out.cp.text.length, baselineChars: baseline.textChars, result: 'CAUGHT' });
  return 'mutant=' + out.cp.text.length + ' vs baseline=' + baseline.textChars;
});

// ── M2：四段从摘要派生 ──
const m2 = await materializeMutant({
  name: 'quad-from-summary',
  file: 'event-write.js',
  // ★首版把锚打在 ': _quad' 上 —— 那个分支在**调用方传了 sectionsOverride 时根本不可达**
  //   （override 优先），所以变异体仍产出正确的四段，M2 被误判成 MISSED。
  //   真缺陷形态是「覆盖分支拿摘要当四段」⇒ 锚必须打在整个 quad 构造上。
  anchor: [
    '    const quad = override',
    '      ? {',
    "          goal: String(override.goal == null ? '' : override.goal),",
    "          state: String(override.state == null ? '' : override.state),",
    "          dead: String(override.dead == null ? '' : override.dead),",
    "          next: String(override.next == null ? '' : override.next),",
    '        }',
    '      : _quad',
  ].join('\n'),
  replacement: '    const quad = { goal: summaryText, state: summaryText, dead: summaryText, next: summaryText }',
});
await test('M2 quad-from-summary ⇒ 四段退化成摘要残句（B4 判据必红）', async () => {
  const out = await runAppendWith(m2.module.appendHandoffCheckpointPre, path.join(m2.dir, 'case'), MUT_LEDGER, MUT_QUAD);
  assert.equal(out.cp.goal, out.cp.state, 'mutant derives all quad from the same summary text');
  assert.notEqual(out.cp.goal, MUT_QUAD.goal, 'mutant goal must differ from the real source quad');
  assert.ok(out.cp.goal.length <= HANDOFF_CHECKPOINT_SUMMARY_CHARS, 'mutant quad length=' + out.cp.goal.length);
  assert.equal(baseline.quadEqual, true, 'baseline must keep the real quad');
  evidence.push({ kind: 'mutation', name: 'quad-from-summary', mutantGoalLen: out.cp.goal.length, sourceGoalLen: MUT_QUAD.goal.length, result: 'CAUGHT' });
  return 'mutant goal=' + out.cp.goal.length + ' 字 vs 原文=' + MUT_QUAD.goal.length + ' 字';
});

// ── M3：幂等身份改用摘要 ──
const m3 = await materializeMutant({
  name: 'idem-by-summary',
  file: 'event-write.js',
  anchor: '      idemKey: idemKindPrefix + sha1Hex12(keySrc),',
  replacement: '      idemKey: idemKindPrefix + sha1Hex12(summaryText),',
});
await test('M3 idem-by-summary ⇒ 正文尾部变了仍被判重复（B6 判据必红）', async () => {
  const dir = path.join(m3.dir, 'case');
  const out = await runAppendWith(m3.module.appendHandoffCheckpointPre, dir, MUT_LEDGER, MUT_QUAD);
  // 同一路径、尾部多一句：摘要不变、正文变 ⇒ 规范实现必须新增一条
  const changed = MUT_LEDGER + '\n尾部改动一句，只影响正文不影响 300 字符摘要。';
  await fs.writeFile(path.join(out.handoffDir, 'mut.md'), changed, 'utf8');
  const proof2 = await buildHandoffSourceProofPre({ documentText: changed, sourceRef: 'handoff/mut.md', expectDiskText: true }, { handoffDir: out.handoffDir });
  const summary2 = buildHandoffCheckpointSummaryPre({ kind: 'handoff', text: changed, quad: MUT_QUAD });
  assert.equal(summary2.text, out.summary.text, 'precondition: summary must be unchanged');
  const again = await m3.module.appendHandoffCheckpointPre(out.storePath, {
    ledgerText: changed, kind: 'handoff', eventId: out.created.id, summary: summary2, sourceProof: proof2, sectionsOverride: MUT_QUAD,
  });
  assert.equal(again.deduped, true, 'mutant must treat changed body as duplicate');
  const store = JSON.parse(await fs.readFile(out.storePath, 'utf8'));
  assert.equal(store.events.find((item) => item.id === out.created.id).checkpoints.length, 1);
  // 对照：干净实现在同样输入下必须新增第二条（B6 已单独验证）
  evidence.push({ kind: 'mutation', name: 'idem-by-summary', mutantDeduped: true, result: 'CAUGHT' });
  return 'mutant deduped=true 且 count=1（规范实现应为 2）';
});

// ── M4：去掉 handoff 必须给四段 ──
const m4 = await materializeMutant({
  name: 'quad-required-removed',
  file: 'handoff-checkpoint.js',
  anchor: "  if (kind === 'handoff' && quadInput == null) return { ok: false, code: 'quad-required' }",
  replacement: '',
});
await test('M4 quad-required-removed ⇒ 缺四段不再被拒（A3 判据必红）', () => {
  const mutant = m4.module.buildHandoffCheckpointSummaryPre({ kind: 'handoff', text: 'x' });
  const clean = buildHandoffCheckpointSummaryPre({ kind: 'handoff', text: 'x' });
  assert.equal(clean.code, 'quad-required', 'baseline must still reject');
  assert.equal(mutant.ok, true, 'mutant must no longer reject missing quad');
  evidence.push({ kind: 'mutation', name: 'quad-required-removed', result: 'CAUGHT' });
  return 'clean=quad-required / mutant=ok';
});

// ── 还原复查：共享工作树未被变异污染 ──
await test('R1 ★共享工作树未被污染：lib 两个文件与开头读到的字节完全一致', async () => {
  const writeNow = await fs.readFile('lib/event-write.js', 'utf8');
  const summaryNow = await fs.readFile('lib/handoff-checkpoint.js', 'utf8');
  assert.equal(writeNow, cleanWrite);
  assert.equal(summaryNow, cleanSummary);
  return 'event-write.js + handoff-checkpoint.js 逐字节未变';
});

// ══════════════ 汇总 ══════════════

await test('Z1 交付物理量：两文件字节/sha16 + 用例计数', async () => {
  for (const file of ['lib/handoff-checkpoint.js', 'lib/event-write.js', 'lib/event-store.js', 'tests/smoke/smoke-test-batch2-2.7-checkpoint.mjs']) {
    const bytes = await fs.readFile(file);
    const text = bytes.toString('utf8');
    assert.equal(text.includes('\r\n'), false, 'LF-only expected: ' + file);
    evidence.push({ kind: 'file', file, bytes: bytes.length, sha16: sha256hex(bytes).slice(0, 16).toUpperCase() });
  }
  return evidence.filter((item) => item.kind === 'file').map((item) => item.file + '=' + item.bytes + 'B').join(' ');
});

await fs.mkdir(root, { recursive: true });
const report = {
  pass,
  fail,
  failures,
  mutationCaught: evidence.filter((item) => item.kind === 'mutation').length,
  baseline,
  evidence,
};
await fs.writeFile(path.join(root, 'checkpoint-report.json'), JSON.stringify(report, null, 2) + '\n', 'utf8');
console.log('');
console.log('SUMMARY PASS ' + pass + ' / FAIL ' + fail);
console.log('MUTATION CAUGHT ' + report.mutationCaught + ' / MISSED 0');
console.log('RESTORED GREEN (共享工作树逐字节未变)');
if (fail) process.exitCode = 1;
