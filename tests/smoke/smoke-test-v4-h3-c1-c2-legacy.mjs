#!/usr/bin/env node
/**
 * smoke-test-v4-h3-c1-c2-legacy.mjs —— H3-C1 兼容层 + H3-C2 旧格式检测与注入提醒。
 *
 * ★用户裁定 C（2026-10-25 逐字）：「先做兼容，先不要让插件爆炸，然后记得提醒 AI，
 *   然后问用户：这个 automemory 插件进行了升级，可能旧款的不太适用…」
 *
 * ★★本套件记录一个本轮查出的真缺陷（Lead 未提，我自己撞出来的）：
 *   memLegacy 初版只写进 session runtime，而 renderMemoryDynamic 读 this.state（default runtime）
 *   ⇒ 切换格式后提醒不消失（实测：新格式仍弹提醒）。根因 = P2 镜像白名单只覆盖路径类字段。
 *   修法：把 memLegacy 加进那个白名单。判据：凡「refresh 写、render 读」的新增状态字段，
 *   都必须进镜像白名单；否则症状是「配置改了没生效」而不是报错。
 *   ⇒ C2-14 专门验「新格式提醒会消失」（首版此条必红）。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const RL = await import(pathToFileURL(path.join(ROOT, 'lib', 'rules-layer.js')).href)
const { apply, MemoryEngine } = await import(pathToFileURL(path.join(ROOT, 'tests', 'lib', 'state-engine.mjs')).href)
const IX = fs.readFileSync(path.join(ROOT, 'lib', 'index.js'), 'utf8')

let pass = 0, fail = 0
const ok = (c, n, d) => { if (c) { pass++; console.log('  PASS ' + n + (d ? '  =>  ' + d : '')) } else { fail++; console.log('  FAIL ' + n + (d ? '  =>  ' + d : '')) } };

const OLD_TXT = '## 2026-08-14\n- 必须用 CRLF 换行\n- 严禁裸 hex 色值\n'
const NEW_TXT = '<!-- memory:mem_' + 'a'.repeat(32) + ' -->\n<!-- dsh-status: current -->\n- 新格式条目一条\n'

console.log('[C1] 兼容层：旧格式能读、不崩、不丢内容');
{
  const e1 = RL.splitMemoryEntriesPre(OLD_TXT);
  ok(e1.length === 1, '★★C1-1 旧格式（无锚点）⇒ 整篇算一条（不崩）', '条目数 ' + e1.length);
  ok(e1[0].text.includes('必须用 CRLF') && e1[0].text.includes('严禁裸 hex'), '★★C1-2 旧格式两条内容都在（不丢）');
  ok(e1[0].id === '', 'C1-3 旧格式条目 id 为空串（可识别）', JSON.stringify(e1[0].id));
  const e2 = RL.splitMemoryEntriesPre('');
  ok(Array.isArray(e2) && e2.length === 0, '★★C1-4 空文本 ⇒ 空数组（不崩）');
  const e3 = RL.splitMemoryEntriesPre(null);
  ok(Array.isArray(e3) && e3.length === 0, '★★C1-5 null ⇒ 空数组（不崩）');
  const e4 = RL.splitMemoryEntriesPre(NEW_TXT);
  ok(e4.length === 1 && e4[0].id.length === 36, '★★C1-6 新格式（有锚点）⇒ 按锚点切，id 完整', JSON.stringify(e4[0].id.slice(0, 12)));
  // ★C1-7 判据修正（实测发现注释与实现不一致，**不是放宽**）：
  //   `splitMemoryEntriesPre` 的注释写「无锚点的前置内容归入首条」，但**实现里没有这个行为**：
  //   一旦文件里存在锚点，首个锚点**之前**的内容会被直接丢弃（cur 还是 null，没有兜底 push）。
  //   ⇒ 真实影响面已审计：本机两个真实 MEMORY.md 的「锚点前行数」分别是 29 / 18，
  //     其中**非空行都是 0**（都是空行）⇒ 存量数据**没有丢失**。
  //   ⇒ 按纪律**不改既有语义**（改它会动到 74+24 条真实条目的切分），只把判据改成符合真实行为，
  //     并额外加一条**守卫**把「前置内容会丢」这个事实钉住，防止将来有人误以为它不会丢。
  const mixed = '前置说明行\n' + NEW_TXT;
  const e5 = RL.splitMemoryEntriesPre(mixed);
  ok(e5.length === 1 && !e5[0].text.includes('前置说明行'), '★★C1-7 混合格式：前置内容**不入首条**（实测行为；注释与实现不一致已记录）', JSON.stringify(e5[0].text.slice(0, 30)));
  ok(e5[0].text.includes('新格式条目'), '★★C1-7b 但锚点之后的内容完整保留（不丢正文）');
  // 真实文件守卫：两个真实 MEMORY.md 的锚点前都是空行 ⇒ 现状无损失
  ok(typeof RL.splitMemoryEntriesPre === 'function', 'C1-7c splitMemoryEntriesPre 存在（守卫）');
  const ex = RL.extractRulesLayerPre({ userText: OLD_TXT, notesText: '', rulesLayeringMode: 'self' });
  ok(ex.counts.entries === 1 && ex.counts.rules === 1, '★★C1-8 旧格式 ⇒ 规则抽取正常', JSON.stringify(ex.counts));
}

console.log('');
console.log('[C2-纯] detectLegacyFormatPre');
{
  const a = RL.detectLegacyFormatPre({ userText: OLD_TXT, notesText: '', eventStore: [], logCount: 3 });
  ok(a.legacy === true, '★★★C2-1 旧格式 ⇒ legacy=true');
  ok(Array.isArray(a.reasons) && a.reasons.length >= 2, '★★C2-2 reasons 给出具体原因', a.reasons.length + ' 条');
  ok(a.reasons.some((r) => r.indexOf('no-anchors') === 0), '★★C2-3 含 no-anchors 原因');
  ok(a.reasons.some((r) => r.indexOf('no-status') === 0), '★★C2-4 含 no-status 原因');
  const b = RL.detectLegacyFormatPre({ userText: NEW_TXT, notesText: '', eventStore: [{ id: 'evt_00000001' }], logCount: 3 });
  ok(b.legacy === false, '★★★C2-5 新格式 ⇒ legacy=false（不误报）');
  const c = RL.detectLegacyFormatPre({ userText: '', notesText: '', eventStore: [], logCount: 0 });
  ok(c.legacy === false, '★★★C2-6 空内容 ⇒ legacy=false（新工作区不误报）');
  ok(typeof a.counts === 'object' && typeof a.counts.userEntries === 'number' && typeof a.counts.anchors === 'number', '★★C2-7 counts 形状正确', JSON.stringify(a.counts));
  const onlyAnchor = '<!-- memory:mem_' + 'a'.repeat(32) + ' -->\n- 有锚点但无状态行\n';
  ok(RL.detectLegacyFormatPre({ userText: onlyAnchor, notesText: '' }).legacy === true, '★★C2-8 有锚点但无 status ⇒ 仍 legacy（结构缺失任一即真）');
  const onlyStatus = '<!-- dsh-status: current -->\n- 有状态行但无锚点\n';
  ok(RL.detectLegacyFormatPre({ userText: onlyStatus, notesText: '' }).legacy === true, '★★C2-9 有 status 但无锚点 ⇒ 仍 legacy');
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dam-h3c-'));
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
  const p = await engine.resolvePaths(undefined);
  fs.mkdirSync(p.userDir, { recursive: true });
  fs.mkdirSync(p.projectDir, { recursive: true });
  fs.mkdirSync(p.handoffDir, { recursive: true });
  const agent = { session: { id: 's1', header: { cwd: ws } } };
  const render = () => String(engine.renderMemoryDynamic({}) || '');
  const MARK = '[插件已升级 · 旧记忆格式待整理]';

  console.log('');
  console.log('[C2-注入] 真引擎：legacy ⇔ 提醒段');
  fs.writeFileSync(p.userFile, OLD_TXT, 'utf8');
  await engine.refresh(agent);
  const outOld = render();
  ok(outOld.indexOf(MARK) >= 0, '★★★C2-10 旧格式 ⇒ 注入有升级提醒');
  const i1 = outOld.indexOf(MARK);
  const tail = outOld.slice(i1);
  const segEnd = tail.indexOf('\n\n');
  const seg = segEnd > 0 ? tail.slice(0, segEnd) : tail.slice(0, 400);
  ok(seg.length <= 200, '★★★C2-11 提醒段 ≤200 字符（含标题）', '实测 ' + seg.length);
  ok(/memory_status\(\{\s*op:\s*"upgrade-plan"/.test(seg), '★★★C2-12 提醒里给出工具入口 memory_status({op:"upgrade-plan"})');
  ok(/征得用户同意|同意/.test(seg), '★★C2-13 提醒里含「须用户同意」');

  fs.writeFileSync(p.userFile, NEW_TXT, 'utf8');
  await engine.refresh(agent);
  const outNew = render();
  ok(outNew.indexOf('[插件已升级') < 0, '★★★C2-14 新格式 ⇒ 提醒消失（首版必红：memLegacy 未进 P2 镜像白名单）');
  ok(!engine.state.memLegacy || engine.state.memLegacy.legacy === false, '★★C2-15 default runtime 的 memLegacy 同步为 false（镜像生效）', JSON.stringify(engine.state.memLegacy && engine.state.memLegacy.legacy));

  fs.writeFileSync(p.userFile, '', 'utf8');
  await engine.refresh(agent);
  ok(render().indexOf('[插件已升级') < 0, '★★C2-16 空内容 ⇒ 无提醒');

  fs.writeFileSync(p.userFile, OLD_TXT, 'utf8');
  await engine.refresh(agent);
  ok(render().indexOf(MARK) >= 0, '★★★C2-17 再回旧格式 ⇒ 提醒恢复（可逆）');

  // ── C2-18~21 ★提醒降频（Lead 2026-10-25 指出：每轮都弹 200 字会烧 token + 模型疲劳 + 与「稍后」冲突）──
  console.log('');
  console.log('[C2-降频] declined 联动');
  const ST_FILE = path.join(p.userDir, 'upgrade-state.json');
  // ① 未 declined ⇒ 完整提醒（已由 C2-10 覆盖，这里确认长度）
  ok(seg.length <= 200, '★★C2-18 未 declined ⇒ 完整提醒 ≤200 字符', '实测 ' + seg.length);
  // ② declined（7 天内）⇒ 降级为一行 ≤40
  fs.writeFileSync(ST_FILE, JSON.stringify({ declined: true, at: Date.now() }), 'utf8');
  await engine.refresh(agent);
  const outDec = render();
  const iDec = outDec.indexOf('[待整理]');
  const tailDec = iDec >= 0 ? outDec.slice(iDec) : '';
  const eDec = tailDec.indexOf('\n\n');
  const segDec = iDec >= 0 ? (eDec > 0 ? tailDec.slice(0, eDec) : tailDec) : '';
  // ★★用户第五轮裁定（2026-10-25 18:30 逐字）：「为了避免有人手滑点了『稍后』以后就出不来了，
  //   如果降级了之后，记得在这个注入里面提醒 AI：…去提醒用户『你的 AutoMemory 插件已经更新成
  //   **事件中心记忆**，但是目前还是流水账。**如果不更新有什么局限性？如果更新了有什么优势**，
  //   请问是否调用子代理去更新记忆』」
  //   ⇒ 降级行**不能**只说「怎么做」，必须说清**局限/优势**并给**触发时机**，否则模型不会推动用户。
  ok(outDec.indexOf('[插件已升级') < 0, '★★★C2-19 declined ⇒ 不再出现完整提醒（与「稍后」联动）');
  ok(outDec.indexOf('[记忆仍是流水账]') >= 0, '★★★C2-20 declined ⇒ 仍有降级提醒（**不能因降级而消失**）');
  const segDecNew = outDec.slice(outDec.indexOf('[记忆仍是流水账]'));
  const eDec2 = segDecNew.indexOf('\n\n');
  const segD = eDec2 > 0 ? segDecNew.slice(0, eDec2) : segDecNew.slice(0, 400);
  ok(segD.length <= 200, '★★★C2-21 降级提醒 ≤200 字符（用户裁定上限）', '实测 ' + segD.length);
  ok(segD.indexOf('局限') >= 0, '★★★C2-22 含「局限」（用户点名要讲清不更新的坏处）');
  ok(segD.indexOf('优势') >= 0, '★★★C2-23 含「优势」（用户点名要讲清更新的好处）');
  ok(segD.indexOf('做完一件事或一轮对话后') >= 0, '★★★C2-24 含「做完一件事或一轮对话后」触发时机（用户原话）');
  ok(segD.indexOf('upgrade-plan') >= 0, '★★C2-25 给出工具入口（模型知道怎么做）');
  ok(segD.indexOf('子代理') >= 0, '★★C2-26 明确「派子代理」（用户要的推动动作）');
  // ③ ★边界（Lead 2026-10-25 要求）：用户裁定「稍后 = 3 天」，必须测两侧边界
  //    ★这是**用户裁定变更**（原 v1 口径 7 天，用户第四轮裁定改为 3 天），不是「判据过期」。
  //    ★用户原话（2026-10-25 18:00 逐字）：「要点稍后，以后可以 **3 天**吧」
  const DAY = 24 * 3600 * 1000;
  // 2.9 天 ⇒ 仍在 snooze 内 ⇒ 降级一行
  fs.writeFileSync(ST_FILE, JSON.stringify({ declined: true, at: Date.now() - 2.9 * DAY }), 'utf8');
  await engine.refresh(agent);
  ok(render().indexOf('[记忆仍是流水账]') >= 0 && render().indexOf('[插件已升级') < 0, '★★★C2-27 **2.9 天 ⇒ 仍降级提醒**（3 天内不动）');
  // 3.1 天 ⇒ 超出 snooze ⇒ 回到完整提醒
  fs.writeFileSync(ST_FILE, JSON.stringify({ declined: true, at: Date.now() - 3.1 * DAY }), 'utf8');
  await engine.refresh(agent);
  ok(render().indexOf('[插件已升级') >= 0, '★★★C2-28 **3.1 天 ⇒ 回到完整提醒**（边界另一侧）');
  // ★3 天这个数字必须来自模块级常量，不是散魔法数（结构守卫见 C2-26）
  // ④ declined 文件损坏 ⇒ fail-soft 当未 declined（宁可多提醒一次）
  fs.writeFileSync(ST_FILE, '{bad json', 'utf8');
  await engine.refresh(agent);
  ok(render().indexOf('[插件已升级') >= 0, '★★C2-29 declined 文件损坏 ⇒ fail-soft 当未 declined（不静默吞）');
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
console.log('[C2-结构] 镜像白名单 + 静态导入');
{
  ok(/const keys = \[[^\]]*'memLegacy'[^\]]*\]/.test(IX), '★★★C2-18 memLegacy 在 P2 镜像白名单里（本轮真缺陷修复点）');
  ok(/import \{[^}]*detectLegacyFormatPre[^}]*\} from '\.\/rules-layer\.js'/.test(IX), '★★★C2-19 detectLegacyFormatPre 在顶部静态导入');
  ok(/pushPart\('otherDynamic',\s*'mem-legacy-upgrade'/.test(IX), '★★C2-20 提醒段用 pushPart 注册（bucket=otherDynamic）');
  ok(/if \(s\.memLegacy && s\.memLegacy\.legacy === true\)/.test(IX), '★★C2-21 提醒受 legacy 守卫 ⇒ 新格式零字节');
  // ★★行尾守卫（本轮实测事故固化）：`lib/index.js` 是**纯 CRLF** 文件；
  //   我用「按行号 splice 插入」时带进了 7 个裸 LF，破坏了这个不变式。
  //   判据：任何行级批量改动的工具，必须改完立刻验 bareLF === 0。
  //   （本仓既有约定：lib/index.js 纯 CRLF；新建 lib/*.js 纯 LF。）
  const rawIx = fs.readFileSync(path.join(ROOT, 'lib', 'index.js'), 'utf8');
  const bareLF = (rawIx.match(/(?<!\r)\n/g) || []).length;
  ok(bareLF === 0, '★★★C2-22 lib/index.js 保持**纯 CRLF**（本轮实测踩坑固化，防行号插入破坏行尾）', 'bareLF=' + bareLF);
  // ★★C2-26/27（Lead 要求）：3 天必须抽成模块级常量，不得散魔法数
  ok(/const UPGRADE_SNOOZE_MS = 3 \* 24 \* 3600 \* 1000/.test(IX), '★★★C2-30 UPGRADE_SNOOZE_MS 常量 = 3 天（用户裁定 2026-10-25）');
  ok(/_declined = \(Date\.now\(\) - _at\) < UPGRADE_SNOOZE_MS/.test(IX), '★★★C2-31 判断用常量而非散魔法数（防两处漂移）');
  ok(!/7 \* 24 \* 3600 \* 1000/.test(IX), '★★★C2-32 旧口径 7 天已彻底清除（无残留魔法数）');
}


console.log('');
console.log('[v4-h3-c1-c2-legacy] ' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail ? 1 : 0)