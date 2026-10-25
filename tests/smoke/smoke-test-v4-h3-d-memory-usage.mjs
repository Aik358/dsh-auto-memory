#!/usr/bin/env node
/**
 * smoke-test-v4-h3-d-memory-usage.mjs —— H3-D：注入 Prompt 补「三问」。
 *
 * ★用户裁定 D（2026-10-25 逐字）：注入 Prompt 太简练，要补**三问**——
 *   「①这些内容该怎么用 ②为什么要在里面加上 ③什么情况下需要加上」
 *
 * ★现状缺口（本轮测绘）：注入只有「**怎么读**」（snapshotHead / snapshotSlimGuide），
 *   缺「**怎么用 / 为什么 / 何时**」⇒ 模型知道有这些数据，但不知道怎么用、为什么有。
 *
 * ★本段设计：覆盖**四类记忆各自的**三问（用户记忆 / 情感记忆 / 事件记忆 / calendar），
 *   每类都给「**用来**做什么」+「**不要**做什么」（负路径，防误用）。
 *   总增 ≤800 字符（Lead 硬约束，实测 344）。
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

const MARK = '[记忆用途 — 怎么用 / 为什么要加 / 什么时候用]';

// ══════════════════════════════════════════════════════════════════════
// D-1 结构守卫
// ══════════════════════════════════════════════════════════════════════
console.log('[D-1] 结构守卫');
{
  ok(IX.indexOf('[记忆用途 — 怎么用 / 为什么要加 / 什么时候用]') >= 0, '★★D-1a 段文案在源码里（内联字面量）');
  ok(/pushPart\('memoryReferences',\s*'memory-usage'/.test(IX), '★★D-1b 已注册注入段（bucket=memoryReferences）');
  // ★★★D-1c 最关键的架构约束（本轮踩了两次坑才定下来）：
  //   ① 不能进 `DEFAULT_PROMPT_LAYERS`（那是客户端逐键镜像契约表 ⇒ 服务端 28 ≠ 客户端 26 ⇒ G4-6d 红）；
  //   ② 不能是模块级常量（`renderMemoryDynamic` 被 **20 个套件**用 `new Function` 抽出执行，
  //      沙箱里没有模块级 const ⇒ ReferenceError；实测 a13-inject-seg-chars 就是这么红的）。
  //   ⇒ 只能**内联字面量**：函数自包含，抽取式测试零改动。
  {
    const { DEFAULT_PROMPT_LAYERS } = await import(pathToFileURL(path.join(ROOT, 'lib', 'index.js')).href);
    ok(!Object.prototype.hasOwnProperty.call(DEFAULT_PROMPT_LAYERS, 'snapshotMemoryUsage'), '★★★D-1c **不进 DEFAULT_PROMPT_LAYERS**（客户端镜像契约表，加了会红 G4-6d）');
    ok(Object.keys(DEFAULT_PROMPT_LAYERS).length === 27, '★★★D-1d 服务端层数仍 = 27（与客户端镜像一致）', String(Object.keys(DEFAULT_PROMPT_LAYERS).length));
  }
  const USAGE_LINE = (IX.match(/pushPart\('memoryReferences',\s*'memory-usage'[\s\S]{0,1200}?'normal'\)/) || [''])[0];
  ok(USAGE_LINE.indexOf("'normal'") >= 0, '★★★D-1e priority=normal（预算紧时先丢它，不挤压 must 的规则段）');
  // ★D-1f：本段引用的所有标识符都必须是**函数内可见的**（不能有模块级依赖）
  const modLevelRefs = ['MEMORY_USAGE_TEXT_PRE_V1', 'snapshotMemoryUsage'].filter((k) => USAGE_LINE.indexOf(k) >= 0);
  ok(modLevelRefs.length === 0, '★★★D-1f 段内**不引用任何模块级/层表标识符**（抽取式测试零改动的前提）', JSON.stringify(modLevelRefs));
}
// ══════════════════════════════════════════════════════════════════════
// D-2 真引擎：完整版里有这段，且四类记忆都有「用来/不要」
// ══════════════════════════════════════════════════════════════════════
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dam-h3d-'));
const ws = path.join(root, 'workspace');
fs.mkdirSync(ws, { recursive: true });
process.env.HOME = root; process.env.DSH_HOME = root;
fs.writeFileSync(path.join(root, 'dsh-auto-memory.json'), JSON.stringify({
  memoryRoot: path.join(root, 'memory'), userMemoryDir: path.join(root, 'user'),
  handoffEnabled: true, autoContinueEnabled: true, teamEnabled: false, externalSources: {}, autoConsolidate: false,
}));
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
    tools: { register: () => () => {} },
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
  fs.writeFileSync(p.userFile, '## 测试\n- 用户规则必须遵守\n', 'utf8');
  fs.writeFileSync(p.notesPath, '## 测试\n- 项目规则必须遵守\n', 'utf8');
  const agent = { session: { id: 's1', header: { cwd: ws } } };
  await engine.refresh(agent);
  const out = String(engine.renderMemoryDynamic({}) || '');

  console.log('');
  console.log('[D-2] 真引擎：完整版含记忆用途段');
  ok(out.indexOf(MARK) >= 0, '★★★D-2a 完整版注入**含**「记忆用途」段');
  const i = out.indexOf(MARK);
  let seg = out.slice(i);
  const j = seg.indexOf('\n\n');
  if (j > 0) seg = seg.slice(0, j);
  ok(seg.length <= 800, '★★★D-2b 段长 ≤800 字符（Lead 硬约束）', '实测 ' + seg.length);
  ok(seg.length > 200, '★★D-2c 段不是敷衍（>200 字符）', '实测 ' + seg.length);
  // ★四类记忆各自的三问
  ok(seg.indexOf('用户记忆') >= 0, '★★★D-2d 覆盖「用户记忆」');
  ok(seg.indexOf('情感记忆') >= 0, '★★★D-2e 覆盖「情感记忆」');
  ok(seg.indexOf('事件记忆') >= 0, '★★★D-2f 覆盖「事件记忆」');
  ok(seg.indexOf('calendar') >= 0, '★★★D-2g 覆盖「calendar」');
  // ★「怎么用」—— 每类都要有「用来」
  const uses = (seg.match(/用来/g) || []).length;
  ok(uses >= 4, '★★★D-2h 四类各有「用来」=「怎么用」', uses + ' 处');
  // ★负路径「不要」—— 防误用（用户裁定 D 的精髓：不说清楚就会用错）
  const donts = (seg.match(/不要/g) || []).length;
  ok(donts >= 4, '★★★D-2i 四类各有「不要」=负路径（防把画像当技术规范等）', donts + ' 处');
  // ★「为什么」
  ok(seg.indexOf('为什么') >= 0, '★★★D-2j 含「为什么要有这一段」= 裁定 D 第②问');
  // ★具体负路径语义（用户最担心的三类误用）
  ok(/不要\*\*当项目技术规范|不要.*技术规范/.test(seg), '★★D-2k 明确「不要把用户记忆当项目技术规范」');
  ok(/编造/.test(seg), '★★D-2l 明确「不要编造未发生的事」');
  ok(/待办清单/.test(seg), '★★D-2m 明确「不要把事件记忆当待办清单」');

// ══════════════════════════════════════════════════════════════════════
// D-3 精简版不受影响（预算紧，本段只挂完整版）
// ══════════════════════════════════════════════════════════════════════
  console.log('');
  console.log('[D-3] 精简版预算');
  // ★精简版实测 1,337 字符（上限 1,600），加 344 会到 1,681 > 1,600
  //   ⇒ 本段只挂完整版；精简版靠 snapshotSlimGuide 的「随时可用工具取全文」
  const slim = String(engine.renderSlimSnapshotPre(ws) || '');
  ok(slim.length <= 1600, '★★★D-3a 精简版仍 ≤1,600 字符（未被本段撑爆）', '实测 ' + slim.length);
  ok(slim.indexOf(MARK) < 0, '★★D-3b 精简版不含本段（设计如此：预算不够，且有 guide 兜底）');
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
console.log('[v4-h3-d-memory-usage] ' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail ? 1 : 0)