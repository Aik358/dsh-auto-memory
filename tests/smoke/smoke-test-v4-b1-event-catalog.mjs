#!/usr/bin/env node
/**
 * smoke-test-v4-b1-event-catalog.mjs —— v4-B1：`event-catalog` 从死数据接上注入。
 *
 * ★缺陷（Lead 2026-10-25 真引擎实测定位）：
 *   `eventCatalogText` 在 `refreshEventStatePre` 里算了（27 字），但 `renderMemoryDynamic`
 *   里 **0 处 pushPart** —— 唯一引用是注释/赋值/清空 ⇒ **每轮白算一次，从不注入**。
 *
 * ★修法（Lead 裁决：路 A + 排除已展开事件 + 剩余为空则零字节）：
 *   ① `renderEventCatalogPre` 加 `opts.excludeIds` —— 先滤掉「已被 T2 卡片展开的事件」再渲染
 *   ② `refreshEventStatePre` 传 `pickedIds`
 *   ③ 注入点：`if (s.eventCatalogText) pushPart('memoryReferences','event-catalog', ..., 'normal')`
 *      —— 空串 ⇒ 整段零字节（连标题都不出）；bucket 必须 memoryReferences（区 III 300 上限放不下）
 *
 * ★为什么不能用「included > picks.length」判（Lead 指出的反例）：
 *   3 个 active 事件时 included=3 > picks=2，但目录前 2 行与卡片**完全重复**，
 *   只有第 3 行是新信息 ⇒ 数量比较会漏掉「部分重复」。正确口径 = 排除后还剩什么。
 *
 * ★分工：卡片 = 当前进行中的 1–2 个事件展开全文；目录 = 卡片没展开的其他事件的索引行。
 *   两者**互斥不重叠** ⇒ 同一事件名不会出现两次（验收 ④ 计数断言）。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const SE = await import(pathToFileURL(path.join(ROOT, 'tests', 'lib', 'state-engine.mjs')).href)
const { apply, MemoryEngine } = SE
const ER = await import(pathToFileURL(path.join(ROOT, 'lib', 'event-render.js')).href)
const Z = await import(pathToFileURL(path.join(ROOT, 'lib', 'injection-zones.js')).href)
const IX = fs.readFileSync(path.join(ROOT, 'lib', 'index.js'), 'utf8')

let pass = 0, fail = 0
const ok = (c, n, d) => { if (c) { pass++; console.log('  PASS ' + n + (d ? '  =>  ' + d : '')) } else { fail++; console.log('  FAIL ' + n + (d ? '  =>  ' + d : '')) } }

// ════════════════════════════════════════════════════════════
// A. 单元层：renderEventCatalogPre 的 excludeIds（纯函数，可直接测）
// ════════════════════════════════════════════════════════════
console.log('[A] renderEventCatalogPre 的 excludeIds');
{
  const evs = [
    { id: 'evt_aaaaaaaa', name: 'A 甲', status: 'active', updatedAt: 300 },
    { id: 'evt_bbbbbbbb', name: 'B 乙', status: 'closed', updatedAt: 200 },
    { id: 'evt_cccccccc', name: 'C 丙', status: 'closed', updatedAt: 100 },
  ]
  const all = ER.renderEventCatalogPre(evs, { maxChars: 400 });
  ok(all.included === 3, 'A1 不传 excludeIds ⇒ included=3（全量）', String(all.included));
  const ex = ER.renderEventCatalogPre(evs, { maxChars: 400, excludeIds: ['evt_aaaaaaaa'] });
  ok(ex.included === 2, '★A2 排除 1 个 ⇒ included=2', String(ex.included));
  ok(!ex.text.includes('A 甲') && ex.text.includes('B 乙'), '★★A3 被排除的 A 不在文本里，B 仍在', JSON.stringify(ex.text));
  const exAll = ER.renderEventCatalogPre(evs, { maxChars: 400, excludeIds: ['evt_aaaaaaaa','evt_bbbbbbbb','evt_cccccccc'] });
  ok(exAll.included === 0 && exAll.text === '', '★★A4 全部排除 ⇒ included=0 且 text 为空串（零字节基础）', JSON.stringify(exAll.text));
  const empty = ER.renderEventCatalogPre([], { maxChars: 400, excludeIds: ['x'] });
  ok(empty.included === 0 && empty.text === '', 'A5 空事件数组 ⇒ 空串');
  // ★语义不变：排序仍是 updatedAt 降序
  ok(all.text.split('\n')[0].includes('A 甲'), 'A6 排序不受 excludeIds 影响（仍 updatedAt 降序，首行是 A）');
}

// ════════════════════════════════════════════════════════════
// B. 结构层：注入点与 zone 登记
// ════════════════════════════════════════════════════════════
console.log('[B] 注入点与 zone 登记');
{
  ok(Object.prototype.hasOwnProperty.call(Z.ZONE_BY_KIND_PRE_V1, 'event-catalog'), '★★B1 event-catalog 已**显式登记**进 ZONE_BY_KIND_PRE_V1（不靠 fail-safe）');
  ok(Z.ZONE_BY_KIND_PRE_V1['event-catalog'] === 'memory', '★★B2 登记为 memory（不是 channel —— 区 III 300 上限放不下）', String(Z.ZONE_BY_KIND_PRE_V1['event-catalog']));
  ok(Z.zoneOfKindPre('event-catalog') === 'memory', 'B3 真调 zoneOfKindPre 返回 memory', Z.zoneOfKindPre('event-catalog'));
  ok(/pushPart\('memoryReferences',\s*'event-catalog'/.test(IX), '★★B4 index.js 里真有 pushPart 调用（不是只登记不用）');
  ok(/if \(s\.eventCatalogText\)\s*\{/.test(IX), '★★B5 注入受 `if (s.eventCatalogText)` 守卫 ⇒ 空串零字节（连标题都不出）');
  // ★bucket 必须是 memoryReferences
  const m = IX.match(/pushPart\('([^']+)',\s*'event-catalog'/);
  ok(m && m[1] === 'memoryReferences', '★★B6 bucket = memoryReferences（不是 otherDynamic/channel）', m ? m[1] : '未找到');
  // ★不得新增配置键：标题是字面量
  ok(!/snapshotEventCatalogTitle/.test(IX), '★★B7 没有新增 DEFAULT_PROMPT_LAYERS 键（配置键数恒 163）—— 标题用字面量');
  // ★refreshEventStatePre 里确实传了 excludeIds
  ok(/renderEventCatalogPre\(events,\s*\{[^}]*excludeIds:\s*pickedIds/.test(IX), '★★B8 refreshEventStatePre 传了 excludeIds: pickedIds');
  ok(/const pickedIds = picks\.map/.test(IX), 'B9 pickedIds 由 picks 计算（与卡片同源，不是另算一份）');
}

// ════════════════════════════════════════════════════════════
// C. 真引擎端到端：refreshEventStatePre → renderMemoryDynamic
// ════════════════════════════════════════════════════════════
console.log('[C] 真引擎端到端（真造 store + 真跑 refresh）');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dam-b1-'));
const workspace = path.join(root, 'workspace');
fs.mkdirSync(workspace, { recursive: true });
process.env.HOME = root; process.env.DSH_HOME = root;
fs.writeFileSync(path.join(root, 'dsh-auto-memory.json'), JSON.stringify({
  memoryRoot: path.join(root, 'memory'), userMemoryDir: path.join(root, 'user'),
  handoffEnabled: true, autoContinueEnabled: true, teamEnabled: false, externalSources: {},
}));
const iv = globalThis.setInterval, to = globalThis.setTimeout, fe = globalThis.fetch;
const load = MemoryEngine.prototype.loadConfigSync;
let engine = null;
let handoffDir = '';
const mkEv = (id, name, status, updatedAt) => ({
  id, name, summary: '这是 ' + name + ' 的摘要', status,
  sections: { goal: name + ' 的目标', doing: '', deadend: '', next: '' },
  checkpoints: [], userPercept: [], agentTrace: [], sharedGround: [], commitments: [], updatedAt,
});
const writeStore = (evs) => fs.writeFileSync(path.join(handoffDir, 'event-store.json'), JSON.stringify({ version: 'event_store_pre_v1', events: evs, updatedAt: Date.now() }, null, 2));
const refresh = () => engine.refreshEventStatePre({ session: { id: 's1', header: { cwd: workspace } } });

try {
  globalThis.setInterval = globalThis.setTimeout = () => ({ unref() {} });
  globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({}) });
  MemoryEngine.prototype.loadConfigSync = function () { engine = this; return load.call(this) };
  apply({
    get: () => undefined, on: () => () => {},
    systemPrompt: { context: () => () => {}, section: () => () => {} },
    tools: { register: () => () => {} },
    webServer: { register: () => () => {} },
    effect: (f) => { f() },
  }, {});
  globalThis.setInterval = iv; globalThis.setTimeout = to; globalThis.fetch = fe;
  MemoryEngine.prototype.loadConfigSync = load;
  engine.configLoaded = true;
  engine.state.ws = workspace;
  const paths = await engine.resolvePaths(undefined);
  handoffDir = paths.handoffDir;
  fs.mkdirSync(handoffDir, { recursive: true });
  fs.writeFileSync(path.join(handoffDir, 'PLAN.md'), '# 白板\n\n## 是什么\n测试用。\n');

  // ★场景 1：只有 1 个 active ⇒ 目录零字节（验收 ①）
  writeStore([mkEv('evt_00000001', '事件甲', 'active', 300)]);
  await refresh();
  ok(engine.state.eventCatalogText === '', '★★★C1 验收①零字节负路径：1 个 active ⇒ eventCatalogText === \'\'', JSON.stringify(engine.state.eventCatalogText));
  ok(Number(engine.state.eventCatalogIncluded) === 0, '★C1b included = 0', String(engine.state.eventCatalogIncluded));
  // 渲染文本里不得出现该段标题
  // ★注意：renderMemoryDynamic 返回的是**纯字符串**（`return envelope.text + ...`），不是 {text} 对象。
  //   首版写成 `snap.text` ⇒ 恒空串 ⇒ C1c/C4b/C4c/C5/C5c 全部假红（实测抓出并修正）。
  const txt1 = String(engine.renderMemoryDynamic({}) || '');
  ok(txt1.indexOf('其他事件') < 0, '★★★C1c 注入文本**不含**该段标题（真 renderMemoryDynamic 输出）', '总长 ' + txt1.length);

  // ★场景 2：1 active + 1 closed ⇒ 只列 closed（验收 ②）
  writeStore([mkEv('evt_00000001', '事件甲', 'active', 300), mkEv('evt_00000002', '事件乙', 'closed', 200)]);
  await refresh();
  ok(engine.state.eventCatalogText.includes('事件乙'), '★★C2 验收②：有非活跃事件 ⇒ 目录列它', JSON.stringify(engine.state.eventCatalogText));
  ok(!engine.state.eventCatalogText.includes('事件甲'), '★★C2b 且**不列**已展开的 active 那个（不重复）');

  // ★场景 3：3 active ⇒ 目录只列第 3 个（验收 ③）
  writeStore([
    mkEv('evt_00000001', '事件甲', 'active', 300),
    mkEv('evt_00000002', '事件乙', 'active', 200),
    mkEv('evt_00000003', '事件丙', 'active', 100),
  ]);
  await refresh();
  ok(engine.state.eventCatalogText.includes('事件丙'), '★★★C3 验收③：3 active ⇒ 目录列卡片没展开的第 3 个', JSON.stringify(engine.state.eventCatalogText));
  ok(!engine.state.eventCatalogText.includes('事件甲') && !engine.state.eventCatalogText.includes('事件乙'), '★★★C3b 且**不列**卡片已展开的前两个');
  ok(String(engine.state.eventCardsText).includes('事件甲'), 'C3c 对照：卡片里确实有事件甲（证明排除不是靠它不存在）');

  // ★场景 4：截断要显式告知（验收：dropped > 0 时标题补「共 N 个，下列 M 个」）
  const many = [mkEv('evt_00000001', '主事件', 'active', 9000)];
  for (let i = 0; i < 30; i += 1) many.push(mkEv('evt_' + String(i + 10).padStart(8, '0'), '批量事件' + i, 'closed', 1000 - i));
  writeStore(many);
  await refresh();
  ok(Number(engine.state.eventCatalogDropped) > 0, '★C4 30+ closed ⇒ 发生截断（dropped > 0）', 'included=' + engine.state.eventCatalogIncluded + ' dropped=' + engine.state.eventCatalogDropped);
  const txt4 = String(engine.renderMemoryDynamic({}) || '');
  ok(/共 \d+ 个，下列 \d+ 个/.test(txt4), '★★★C4b 验收：截断时标题行**显式告知**「共 N 个，下列 M 个」（不静默截断）');
  ok(txt4.indexOf('其他事件') >= 0, '★C4c 该段真的出现在注入文本里', '总长 ' + txt4.length);

  // ★场景 5（验收 ④）：不重复 —— 目录与卡片不得有同一事件名
  writeStore([
    mkEv('evt_00000001', '甲事件', 'active', 300),
    mkEv('evt_00000002', '乙事件', 'active', 200),
    mkEv('evt_00000003', '丙事件', 'active', 100),
  ]);
  await refresh();
  const txt5 = String(engine.renderMemoryDynamic({}) || '');
  const countOf = (name) => (txt5.match(new RegExp(name, 'g')) || []).length;
  ok(countOf('丙事件') >= 1, '★C5 丙事件在注入文本里（目录段）', '出现 ' + countOf('丙事件') + ' 次');
  // 卡片里的甲/乙，其**事件名标题**只应出现 1 次（卡片），目录不得再来一行
  ok(countOf('· 甲事件 ') === 0, '★★★C5b 验收④：目录段不以「· 甲事件 」形式重复卡片里的事件', '出现 ' + countOf('· 甲事件 ') + ' 次');
  ok(countOf('· 丙事件 ') === 1, '★★★C5c 且丙只以目录行出现 1 次（不重复）', '出现 ' + countOf('· 丙事件 ') + ' 次');
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

console.log('')
console.log('[v4-b1-event-catalog] ' + pass + ' PASS / ' + fail + ' FAIL')
process.exit(fail ? 1 : 0)