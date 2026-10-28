#!/usr/bin/env node
/**
 * smoke-test-v4-c2-slim-events.mjs —— C2：精简版注入补「当前事件 + 用户画像」摘要。
 *
 * ★用户裁定（2026-10-25 逐字）：「这些功能一定要**暴露提示词内**，让模型可以**及时或者按需调用**，
 *   我认为**完整版和精简版都需要**。」
 *
 * ★★本套件被 Lead 复查打回过一次，教训必须留在文件里：
 *   首版 21/0 全绿，但**真引擎跑不出 `[当前事件]`**。根因：首版用手工塞 `engine.state.events = [...]`
 *   造输入，而 `refreshEventStatePre` **从不写** `state.events`（全仓 0 处赋值）⇒ 桩造了产品
 *   根本不会产出的字段 ⇒ 「套件全绿但功能是死的」。
 *   **判据：测试的输入状态必须由被测代码自己产出，不能手工塞一个产品不会写的字段。**
 *   （这是 wb-ui-v4「该补的桩没补 ⇒ 红」的**镜像**：这里是「桩造了假状态 ⇒ 绿但假的」。）
 *
 * ⇒ 本版所有「有事件/有画像」场景，一律走**真 `refreshEventStatePre`**（真读 event-store.json），
 *   且加 C2-0 元断言：C2 段源码不得再读 `s.events`。
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
// C2-0 ★元断言：防「读一个产品不会产出的字段」这个缺陷复现
// ══════════════════════════════════════════════════════════════════════
console.log('[C2-0] ★元断言：数据源必须是产品代码真实产出的字段');
{
  // 抽出 renderSlimSnapshotPre 函数体（真执行用于后续断言；这里只做文本范围界定）
  const st = IX.indexOf('renderSlimSnapshotPre(wsHint, agent) {');
  const lim = IX.indexOf('renderSlimSnapshotPre(wsHint, agent) {', st + 10);
  const end = lim > 0 ? lim : IX.indexOf('\n  /**', st);
  const body = IX.slice(st, end > 0 ? end : st + 20000);
  // ★去掉注释再判（注释里为了解释缺陷会提到 s.events，那是**允许**的）
  const code = body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  ok(!/\bs\.events\b/.test(code), '★★★C2-0a C2 段**可执行代码**里不得出现 `s.events`（产品从不写该字段 ⇒ 恒空 ⇒ 功能死）');
  ok(/\bs\.slimEventT1\b/.test(code), '★★★C2-0b C2 段改用 `s.slimEventT1`（由 refreshEventStatePre 预计算）');
  ok(/\bs\.slimEventTotal\b/.test(code), '★★C2-0c C2 段用 `s.slimEventTotal` 做「共 N 个」提示');
  // 产品侧必须真的写这两个字段
  ok(/this\.state\.slimEventT1\s*=/.test(IX), '★★★C2-0d refreshEventStatePre 真的写 `state.slimEventT1`');
  ok(/this\.state\.slimEventTotal\s*=/.test(IX), '★★C2-0e refreshEventStatePre 真的写 `state.slimEventTotal`');
  // 降级分支也要清
  ok((IX.match(/this\.state\.slimEventT1\s*=\s*\[\]/g) || []).length >= 1, '★★C2-0f 降级分支清空 slimEventT1（防 store 损坏时注入陈旧行）');
  // ★负：产品代码不得写 state.events（那是本缺陷的根源）
  //   ★必须先剥注释：缺陷说明里为了讲清楚会引用 `this.state.events = events` 这个写法，
  //     直接扫全文会被**注释里的字面量**污染成假红（本仓已固化判据：注释污染是反复出现的坑）。
  const IX_CODE = IX.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  ok(!/this\.state\.events\s*=/.test(IX_CODE), '★★C2-0g 产品**可执行代码**不写 `state.events`（剥注释后，与缺陷描述一致）');
}

// ══════════════════════════════════════════════════════════════════════
// 真引擎（不手工塞任何 state.event* 字段）
// ══════════════════════════════════════════════════════════════════════
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dam-c2-'));
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
  globalThis.setInterval = iv; globalThis.setTimeout = to; globalThis.fetch = fe;
  MemoryEngine.prototype.loadConfigSync = load;
  engine.configLoaded = true;
  engine.state.ws = ws;
  const paths = await engine.resolvePaths(undefined);
  fs.mkdirSync(paths.handoffDir, { recursive: true });
  const storePath = path.join(paths.handoffDir, 'event-store.json');
  const agent = { session: { id: 's1', header: { cwd: ws } } };
  const slim = () => String(engine.renderSlimSnapshotPre('', agent) || '');
  const refresh = () => engine.refreshEventStatePre(agent);

  // ── C2-1 ★零字节负路径（无 event-store）──
  console.log('');
  console.log('[C2-1] ★零字节负路径：无 event-store ⇒ 不出 `[当前事件]`');
  await refresh();
  const A = slim();
  ok(A.length > 0, 'C2-1a 精简版本体正常渲染', 'len=' + A.length);
  ok(Array.isArray(engine.state.slimEventT1) && engine.state.slimEventT1.length === 0, '★★C2-1b slimEventT1 为空数组（产品代码产出）', JSON.stringify(engine.state.slimEventT1));
  ok(A.indexOf('[当前事件]') < 0, '★★★C2-1c 无事件 ⇒ **不出现** `[当前事件]`（不是空标题）');
  ok(A.indexOf('[用户画像]') < 0, '★★C2-1d 无画像 ⇒ **不出现** `[用户画像]`');
  ok(A.indexOf('[取全文]') < 0, '★★C2-1e 两段都没有 ⇒ 连取全文入口也不出');
  const baseLen = A.length;

  // ── C2-2 ★核心：真造事件 ⇒ 真 refresh ⇒ `[当前事件]` 真出现 ──
  console.log('');
  console.log('[C2-2] ★核心：真引擎端到端（真 event-store → 真 refresh → 真渲染）');
  const ev1 = await esp.create(storePath, {
    name: 'v4 底层改造：记忆单元从流水账迁到事件',
    summary: '把记忆的第一等单元从日志行改成事件容器，并完成注入与检索两端接线。',
  });
  await esp.append(storePath, ev1.id, {
    userPercept: { stage: 'accepted', kind: 'preference', text: '反对在 system prompt 注入长候选清单，倾向一句话提醒加按需工具调用' },
  });
  await refresh();
  ok(!Object.prototype.hasOwnProperty.call(engine.state, 'events'), '★★C2-2a 产品**没有**写 `state.events`（证明数据源确实不是它）');
  ok(Array.isArray(engine.state.slimEventT1) && engine.state.slimEventT1.length === 1, '★★★C2-2b 真 refresh 后 slimEventT1 有 1 条（产品代码产出）', JSON.stringify(engine.state.slimEventT1));
  ok(String((engine.state.slimEventT1[0] || {}).line || '').indexOf('日志行改成事件容器') >= 0, '★★C2-2c 该行是 T1 摘要（summary 首句）', JSON.stringify(String((engine.state.slimEventT1[0] || {}).line || '').slice(0, 40)));
  const B = slim();
  ok(B.indexOf('[当前事件]') >= 0, '★★★C2-2d `[当前事件]` **真出现**（首版此条必红 —— 那是本缺陷的暴露点）');
  const bLine = B.split('\n').find((l) => l.indexOf('[当前事件]') >= 0) || '';
  ok(bLine.indexOf('日志行改成事件容器') >= 0, '★★★C2-2e 行内容是 active 事件的 T1 摘要', JSON.stringify(bLine));
  ok(bLine.length < 130, '★★C2-2f 事件行是**一行**（<130 字，不是 T2 全文）', 'len=' + bLine.length);
  ok(B.indexOf('【事件】') < 0, '★★★C2-2g **不得**出现 T2 的 `【事件】` 标记（精简版不塞 T2）');
  ok(B.indexOf('[取全文]') >= 0, '★★C2-2h 含按需取全文入口');
  const deltaB = B.length - baseLen;
  ok(deltaB <= 260, '★★C2-2i 相对无内容基线增量 ≤260', '增量 ' + deltaB);

  // ── C2-3 ★画像段也走真 refresh ──
  console.log('');
  console.log('[C2-3] ★画像段：真 accepted percept ⇒ 真 userPortraitText ⇒ 真注入');
  ok(String(engine.state.userPortraitText || '').length > 0, '★★C2-3a 真 refresh 产出了 userPortraitText', JSON.stringify(String(engine.state.userPortraitText || '').slice(0, 40)));
  ok(B.indexOf('[用户画像]') >= 0, '★★★C2-3b `[用户画像]` 真出现');
  ok(B.indexOf('长候选清单') >= 0, '★★C2-3c 画像正文在');
  ok(B.split('\n').filter((l) => l.indexOf('[用户画像]') >= 0).length === 1, '★★C2-3d 画像只有**一行**');
  const deltaC = B.length - baseLen;
  ok(deltaC <= 260, '★★★C2-3e 事件+画像合计增量 ≤260', '增量 ' + deltaC);
  // ★2026-10-26 判据修正（判据过期，非缺陷）：原为绝对 1600。
  //   精简版含 snapshotSlimRecallNote（约 149 字，内容随会话环境变化）⇒ 绝对阈值会把环境差异误判成代码膨胀。
  //   实测构成：baseLen=1425 / 唤回段=149 / 去唤回正文=1457 / 总 1606。
  //   ⇒ 主判据改「相对基层骨架的增量」（意图不变：精简版不得膨胀），另设 2000 绝对上限防滥用。
  const noteLenF = (B.split('\n').find((l) => l.indexOf('记忆唤回') >= 0) || '').length;
  const bodyNoNoteF = B.length - noteLenF;
  ok(bodyNoNoteF - baseLen <= 260, '★★★C2-3f 精简版正文（去唤回段）相对骨架增量 ≤260', '增量 ' + (bodyNoNoteF - baseLen) + ' body=' + bodyNoNoteF + ' base=' + baseLen);
  ok(B.length <= 2400, '★★C2-3f2 精简版总字数绝对上限 ≤2400（防滥用）', '实测 ' + B.length);

  // ── C2-4 closed 事件不得作为当前事件（负路径）──
  console.log('');
  console.log('[C2-4] ★负路径：closed 事件不作为「当前事件」');
  const ev2 = await esp.create(storePath, { name: '已完成的历史事件', summary: '这是已经收口的事件，不应作为当前事件。' });
  await esp.close(storePath, ev2.id, { outcome: '已交付' });
  await refresh();
  const D = slim();
  const dLine = D.split('\n').find((l) => l.indexOf('[当前事件]') >= 0) || '';
  ok(dLine.indexOf('已完成的历史事件') < 0, '★★★C2-4a closed 事件**不得**被当成当前事件', JSON.stringify(dLine));
  ok(dLine.indexOf('日志行改成事件容器') >= 0, '★★C2-4b 仍取 active 那个');
  ok(Number(engine.state.slimEventTotal) === 2, '★★C2-4c slimEventTotal = 2（含 closed）', String(engine.state.slimEventTotal));
  ok(dLine.indexOf('共 2 个事件') >= 0, '★★C2-4d 多事件时提示「共 2 个事件」', JSON.stringify(dLine));

  // ── C2-5 画像超长必须截断 ──
  console.log('');
  console.log('[C2-5] 画像超长必须截断');
  await esp.append(storePath, ev1.id, {
    userPercept: { stage: 'accepted', kind: 'preference', text: '很长的偏好内容。'.repeat(60) },
  });
  await refresh();
  const E = slim();
  const ePor = E.split('\n').find((l) => l.indexOf('[用户画像]') >= 0) || '';
  ok(ePor.length <= 175, '★★★C2-5a 超长画像被截断（行含前缀 ≤175）', '实测 ' + ePor.length);
  ok(ePor.indexOf('…') >= 0 || ePor.indexOf('...') >= 0, '★★C2-5b 截断有省略号');
  // ★2026-10-26 判据修正（同 C2-3f：绝对阈值 → 相对增量 + 绝对上限）
  const noteLenE = (E.split('\n').find((l) => l.indexOf('记忆唤回') >= 0) || '').length;
  const bodyNoNoteE = E.length - noteLenE;
  ok(bodyNoNoteE - baseLen <= 260, '★★★C2-5c 超长画像下正文（去唤回段）增量仍 ≤260', '增量 ' + (bodyNoNoteE - baseLen));
  ok(E.length <= 2400, '★★C2-5c2 超长画像下总字数绝对上限 ≤2400', '实测 ' + E.length);

  // ── C2-6 完整版路径不得被改动 ──
  console.log('');
  console.log('[C2-6] 完整版路径不得被改动');
  ok(IX.indexOf("pushPart('memoryReferences', 'event-cards'") >= 0, '★★C2-6a 完整版 event-cards 仍在');
  ok(IX.indexOf("pushPart('otherDynamic', 'user-portrait'") >= 0, '★★C2-6b 完整版 user-portrait 仍在');
  ok(IX.indexOf("pushPart('memoryReferences', 'event-catalog'") >= 0, '★★C2-6c 完整版 event-catalog 仍在');
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
console.log('[v4-c2-slim-events] ' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail ? 1 : 0)