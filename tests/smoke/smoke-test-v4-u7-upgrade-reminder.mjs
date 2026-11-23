#!/usr/bin/env node
/**
 * smoke-test-v4-u7-upgrade-reminder.mjs —— U7：upgrade-state 统一读取 + 两段独立注入。
 *
 * ★用户裁定（第五轮逐字）：「完成之后，比如在代理回报完成，或者**意外终止**，
 *   记着**及时提醒让模型来做相应的工作**」
 *
 * ★★本套件的核心判据（Lead 逐条指定）：
 *   ① 同一份状态只解析一次：`upgrade-state.json` 的 readFileSync 出现次数 = 1（负路径）
 *   ② legacy=true 时 done 段也出现
 *   ③ ★legacy=false 时 done 段仍出现（关键正路径：整理完成后 legacy 必然 false）
 *   ④ ack 语义：notified=true 后两段都消失
 *   ⑤ 不 ack 时每轮都在（连续渲染两次都命中）
 *   ⑥ 现有 declined 三态一行不动（变异验证：3 天改 7 天 ⇒ 边界断言必红）
 *   ⑦ 段长：done ≤520 / failed ≤320（真调用渲染量返回值 .length）
 *   ⑧ zone 登记：done/failed 在 memory 区（不是 channel）
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const IX = fs.readFileSync(path.join(ROOT, 'lib', 'index.js'), 'utf8')
const IZ = fs.readFileSync(path.join(ROOT, 'lib', 'injection-zones.js'), 'utf8')
const { apply, MemoryEngine } = await import(pathToFileURL(path.join(ROOT, 'tests', 'lib', 'state-engine.mjs')).href)
const ZONES = await import(pathToFileURL(path.join(ROOT, 'lib', 'injection-zones.js')).href)

let pass = 0, fail = 0
const ok = (c, n, d) => { if (c) { pass++; console.log('  PASS ' + n + (d ? '  =>  ' + d : '')) } else { fail++; console.log('  FAIL ' + n + (d ? '  =>  ' + d : '')) } };

console.log('[U7-1] 结构与 zone 登记');
{
  const src = IX;
  // ① 同一份状态只解析一次：readUpgradeStatePre 是唯一读盘口，内部只 1 处 readFileSync
  const readFnStart = src.indexOf('  async readUpgradeStatePre(');
  const readFnEnd = src.indexOf('\n  }', readFnStart);
  const readFn = src.slice(readFnStart, readFnEnd);
  const rfCount = (readFn.match(/readFileSync\(/g) || []).length;
  ok(readFnStart > 0 && rfCount === 1, '★★★U7-1a readUpgradeStatePre 内 readFileSync 恰好 1 处（唯一读盘口）', String(rfCount));
  // 负路径：renderMemoryDynamic 内不得再读 upgrade-state
  const rmdStart = src.indexOf('  renderMemoryDynamic(context) {');
  // ★判据实现教训：首版用「renderMemoryDynamic 到 renderSlimSnapshotPre」切片 —— 但**顺序是反的**
  //   （renderSlimSnapshotPre 在 L8903，renderMemoryDynamic 在 L9364）⇒ indexOf 找不到 ⇒ 切出空串 ⇒ 恒红。
  //   正解：用「下一个**列首方法**定义」作边界（正则找 `\n  name(` 形式的同级方法）。
  let rmdEnd = src.length;
  {
    const rest = src.slice(rmdStart + 40);
    const m = rest.search(/\n  [a-zA-Z_$][\w$]*\([^)]*\)\s*\{/);
    if (m > 0) rmdEnd = rmdStart + 40 + m;
  }
  const rmd = rmdStart > 0 ? src.slice(rmdStart, rmdEnd) : '';
  ok(rmd.length > 2000, 'U7-1b-0 renderMemoryDynamic 切片长度合理', String(rmd.length));
  // ★判据实现教训（第二次修这条）：首版判 `rmd.indexOf('upgrade-state.json') < 0` —— 但**注释里也提到该文件名**
  //   （L231 的设计说明），于是恒红。判据必须对准「**真的读盘**」这个行为，不是字符串出现。
  //   ⇒ 正解：正则找 `readFileSync(...) ` 且参数里含 upgrade-state。注释掉的不会匹配（注释里没有调用形式）。
  const realReads = [...rmd.matchAll(/readFileSync\([^)]{0,200}upgrade-state[^)]{0,80}\)/g)];
  ok(realReads.length === 0, '★★★U7-1b renderMemoryDynamic 内**不再真读** upgrade-state（0 处 readFileSync 调用）', '实测 ' + realReads.length + ' 处');
  // ② zone 登记
  ok(ZONES.zoneOfKindPre('mem-upgrade-done') === 'memory', '★★★U7-1c mem-upgrade-done 登记为 **memory**（不是 channel）', String(ZONES.zoneOfKindPre('mem-upgrade-done')));
  ok(ZONES.zoneOfKindPre('mem-upgrade-failed') === 'memory', '★★★U7-1d mem-upgrade-failed 登记为 memory', String(ZONES.zoneOfKindPre('mem-upgrade-failed')));
  // ★★2026-10-27（判据更新，**归因：真缺陷修复**）：
  //   原判据守「mem-legacy-upgrade 是 channel」，理由是「段长 154 ≤ 200，不会挤 water-advisory」。
  //   实测真相：channel 上限 300，water-advisory 是 must 占 274 ⇒ **余量仅 26 字符**
  //   ⇒ 该段（10-27 后 322 字符）**每轮必被淘汰**，注入文本末尾恒定出现
  //     「通道区超出上限 300 字符 → 丢弃本区最低优先级的一段（mem-legacy-upgrade）」。
  //   ⇒ 用户永远看不到迁移提醒。已迁到 memory 区（无限额、按 priority 淘汰）。
  //   ★这不是放宽判据，是**原判据基于的前提（154 字符）已不成立**。
  ok(ZONES.zoneOfKindPre('mem-legacy-upgrade') === 'memory', '★U7-1e mem-legacy-upgrade 已迁到 memory 区（channel 只剩 26 字符余量，必被淘汰）', String(ZONES.zoneOfKindPre('mem-legacy-upgrade')));
  // ③ 段长常量
  ok(/UPGRADE_DONE_MAX_CHARS = 520/.test(src) && /UPGRADE_FAILED_MAX_CHARS = 320/.test(src), '★U7-1f 段长上限 520/320');
  ok(/UPGRADE_SUMMARY_MAX_CHARS = 400/.test(src) && /UPGRADE_ERROR_MAX_CHARS = 200/.test(src), '★U7-1g summary 400 / error 200 截断上限');
  // ④ ★关键结构：两段在 legacy 守卫之外
  const legacyGuard = src.indexOf("if (s.memLegacy && s.memLegacy.legacy === true) {");
  const donePush = src.indexOf("pushPart('otherDynamic', 'mem-upgrade-done'");
  ok(legacyGuard > 0 && donePush > legacyGuard, '★★U7-1h done 段在 legacy 守卫之后（位置上）；★真正的「不在守卫内」由 U7-3 行为断言证明');
  // ⑤ 降级清空点：3 处（正常读失败、legacy catch、store 降级）
  const uc = (src.match(/this\.state\.upgradeState = \{\}/g) || []).length;
  ok(uc >= 3, '★★U7-1i 降级清空点 ≥3（正常读失败/legacy catch/store 降级）', String(uc));
  // ══════════════════════════════════════════════════════════════════════════════════
  // ★★v4-U7 收口（Lead 裁决「方案 A：改口径」）：**renderMemoryDynamic 不得裸读 this.state**
  //
  //   这是同一缺陷家族（C2 memLegacy → H3-E buildReadOverviewPre → U7 upgradeState）的**根治**：
  //   白名单只是补丁（每加字段要记得加一次 ⇒ 必然第 4 次复现），改读侧口径才是机制。
  //   两条断言：①结构性（源码口径）②行为性（真构造 A/B 两 agent 验证不串味）。
  // ══════════════════════════════════════════════════════════════════════════════════
  const rmdSrc = (() => {
    const st = src.indexOf('  renderMemoryDynamic(context) {');
    if (st < 0) return '';
    const rest = src.slice(st + 40);
    const mm = rest.search(/\n  [a-zA-Z_$][\w$]*\([^)]*\)\s*\{/);
    return src.slice(st, st + 40 + (mm > 0 ? mm : rest.length));
  })();
  ok(/typeof this\.stateFor === 'function'/.test(rmdSrc), '★★★U7-1j **renderMemoryDynamic 走 `stateFor(agent)` 口径**（typeof 兜底存在）');
  ok(/this\.stateFor\(context && context\.agent\)/.test(rmdSrc), '★★★U7-1k 传入的是 `context.agent`（不是无参调用）');
  // 负路径：不得出现「裸读 this.state 且没有任何 stateFor 分支」的旧写法
  const bareOld = /renderMemoryDynamic\(context\) \{\s*\n\s*const s = this\.state\s*\n/.test(src);
  ok(!bareOld, '★★★U7-1l **不再**是旧的裸 `const s = this.state` 写法（负路径）');
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dam-u7-'));
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
  apply({ get: () => undefined, on: () => () => {}, systemPrompt: { context: () => () => {}, section: () => () => {} }, tools: { register: () => () => {} }, webServer: { register: () => () => {} }, effect: (f) => { f() } }, {});
  MemoryEngine.prototype.loadConfigSync = load;
  engine.configLoaded = true; engine.state.ws = ws;
  const p = await engine.resolvePaths(undefined);
  fs.mkdirSync(p.userDir, { recursive: true }); fs.mkdirSync(p.projectDir, { recursive: true }); fs.mkdirSync(p.handoffDir, { recursive: true });
  const agent = { session: { id: 's1', header: { cwd: ws } } };
  const stPath = path.join(p.userDir, 'upgrade-state.json');

  // 造旧格式记忆（legacy=true）：无锚点、无 status 行
  const LEGACY_USER = '## 2026-08-14\n- 必须用 CRLF 写文件\n- 汇报要分线\n';
  const NEW_USER = '## 2026-10-25\n<!-- memory:mem_' + 'a'.repeat(32) + ' -->\n<!-- dsh-status: current -->\n- 新格式条目\n';

  const renderWith = async (userText) => {
    fs.writeFileSync(p.userFile, userText, 'utf8');
    engine.state.userText = userText;
    await engine.refresh(agent);
    return String(engine.renderMemoryDynamic({ agent }) || '');
  };

  console.log('');
  console.log('[U7-2] legacy=false（整理完成后）+ phase=done ⇒ 必须出现');
  fs.writeFileSync(stPath, JSON.stringify({ phase: 'done', jobId: 'upg_x', startedAt: Date.now() - 5000, finishedAt: Date.now(), summary: '共迁移 197 条：L0=3 L1=52 L2=44 L3=623', notified: false }), 'utf8');
  const outDone = await renderWith(NEW_USER);
  ok(outDone.indexOf('[★记忆整理完成]') >= 0, '★★★U7-2a legacy=false 时 **[★记忆整理完成] 出现**（关键正路径）');
  ok(outDone.indexOf('197') >= 0, '★★U7-2b 摘要内容已注入', '含 197');
  ok(outDone.indexOf('请向用户汇报成果') >= 0, '★★U7-2c 含「请向用户汇报成果」引导');
  ok(outDone.indexOf('ack') >= 0, '★★U7-2d 含 ack 关闭指引');
  ok(outDone.indexOf('[插件已升级') < 0, '★U7-2e legacy=false 时旧格式提醒**不出现**（对照，证明 legacy 判据仍生效）');

  console.log('');
  console.log('[U7-3] legacy=true + phase=done ⇒ done 段仍出现（证明不在 legacy 守卫内）');
  const outBoth = await renderWith(LEGACY_USER);
  ok(outBoth.indexOf('[插件已升级') >= 0 || outBoth.indexOf('[记忆仍是流水账]') >= 0, '★★U7-3a legacy=true 时旧格式提醒出现');
  ok(outBoth.indexOf('[★记忆整理完成]') >= 0, '★★★U7-3b **同一轮里 done 段也出现**（证明两段独立守卫，不在 legacy 内）');

  console.log('');
  console.log('[U7-4] ack 语义');
  engine.writeUpgradeStatePre(agent, { notified: true });
  const outAck = await renderWith(NEW_USER);
  ok(outAck.indexOf('[★记忆整理完成]') < 0, '★★★U7-4a ack 后 done 段**消失**');

  console.log('');
  console.log('[U7-5] 不 ack 时每轮都在');
  fs.writeFileSync(stPath, JSON.stringify({ phase: 'done', summary: 'x', notified: false }), 'utf8');
  const r1 = await renderWith(NEW_USER);
  const r2 = await renderWith(NEW_USER);
  ok(r1.indexOf('[★记忆整理完成]') >= 0 && r2.indexOf('[★记忆整理完成]') >= 0, '★★★U7-5a 连续两轮渲染**都**出现（不 ack 就一直提醒）');

  console.log('');
  console.log('[U7-6] 失败提醒');
  fs.writeFileSync(stPath, JSON.stringify({ phase: 'failed', jobId: 'upg_y', error: 'subagent-timeout-600s: 子代理超时', notified: false }), 'utf8');
  const outFail = await renderWith(NEW_USER);
  ok(outFail.indexOf('[★记忆整理失败]') >= 0, '★★★U7-6a phase=failed ⇒ [★记忆整理失败] 出现');
  ok(outFail.indexOf('subagent-timeout-600s') >= 0, '★★U7-6b 错误原因已注入');
  ok(outFail.indexOf('下一步建议') >= 0, '★★U7-6c 含「给出下一步建议」引导');
  engine.writeUpgradeStatePre(agent, { notified: true });
  const outFailAck = await renderWith(NEW_USER);
  ok(outFailAck.indexOf('[★记忆整理失败]') < 0, '★★U7-6d ack 后失败段消失');

  console.log('');
  console.log('[U7-7] ★段长上限（量**段本身**的字符数）');
  // ★判据实现教训（本轮实测踩到）：
  //   首版用「在渲染结果里找下一个 [★ 标题」来切段 ⇒ 量到 2446 字符 —— 因为 done 段之后
  //   紧跟的是完整版注入的其他大段（没有以 [★ 开头的标题），切分点找不到 ⇒ 量到了末尾。
  //   ⇒ 正解：**直接量引擎真正拼出来的那行文案**（_doneLine），而不是在整篇输出里猜边界。
  //     这也符合你要求的「量返回值实际 length，不要拿源码字面量估」。
  const renderSegTexts = async (stateObj) => {
    fs.writeFileSync(stPath, JSON.stringify(stateObj), 'utf8');
    await renderWith(NEW_USER);
    // 从引擎里取它这一轮真正拼出的段文本（state 上暂存不了，改用「渲染前后 envelope 的段账本」不现实）
    return null;
  };
  // ⇒ 用更直接的口径：**从渲染输出里按「本段第一句」到「本段最后一句」量**（已知首尾标记）
  const measureSeg = (out, startMark, endMark) => {
    const i = out.indexOf(startMark);
    if (i < 0) return -1;
    const j = out.indexOf(endMark, i);
    if (j < 0) return -1;
    return (j + endMark.length) - i;
  };
  const longSummary = 'A'.repeat(1200);
  fs.writeFileSync(stPath, JSON.stringify({ phase: 'done', summary: longSummary, notified: false }), 'utf8');
  const outLong = await renderWith(NEW_USER);
  const doneLen = measureSeg(outLong, '[★记忆整理完成]', '关闭本提醒。');
  ok(doneLen > 0 && doneLen <= 520, '★★★U7-7a summary=1200 时 done 段实际 ≤520 字符', '实际 ' + doneLen + ' 字符');
  ok(outLong.indexOf('A'.repeat(401)) < 0, '★★★U7-7b summary 被截断到 400（不出现 401 个连续 A）');
  ok(outLong.indexOf('…') >= 0, '★★★U7-7c 截断处有省略号（证明是截断不是丢段）');
  const longErr = 'E'.repeat(800);
  fs.writeFileSync(stPath, JSON.stringify({ phase: 'failed', error: longErr, notified: false }), 'utf8');
  const outLongErr = await renderWith(NEW_USER);
  const failLen = measureSeg(outLongErr, '[★记忆整理失败]', '关闭本提醒。');
  ok(failLen > 0 && failLen <= 320, '★★★U7-7d error=800 时 failed 段实际 ≤320 字符', '实际 ' + failLen + ' 字符');
  ok(outLongErr.indexOf('E'.repeat(201)) < 0, '★★U7-7e error 被截断到 200');
  console.log('[U7-8] ★declined 三态一行不动（变异点：3 天边界）');
  const outDecl = await (async () => {
    fs.writeFileSync(stPath, JSON.stringify({ declined: true, at: Date.now() - 1000 }), 'utf8');
    return renderWith(LEGACY_USER);
  })();
  ok(outDecl.indexOf('[记忆仍是流水账]') >= 0, '★★U7-8a declined 在 3 天内 ⇒ 降级为一行（原三态逻辑仍生效）');
  const outDeclOld = await (async () => {
    fs.writeFileSync(stPath, JSON.stringify({ declined: true, at: Date.now() - 4 * 24 * 3600 * 1000 }), 'utf8');
    return renderWith(LEGACY_USER);
  })();
  ok(outDeclOld.indexOf('[插件已升级') >= 0, '★★★U7-8b declined 超 3 天 ⇒ 回到完整提醒（3 天边界仍生效）');
  ok(outDeclOld.indexOf('[记忆仍是流水账]') < 0, '★★U7-8c 超 3 天后不再显示降级行');

  console.log('');
  console.log('[U7-9] ★★★ 行为断言：跨 agent 不串味（口径真的修好了）');
  // ★这是 Lead 指定的「唯一能证明口径真修好」的证据（前三条只是守卫）：
  //   构造 A/B 两 agent，A 的 refresh 写入 upgradeState，B 的 refresh 不写；
  //   然后分别以 {agent:A} / {agent:B} 渲染 ⇒ 断言各自看到的是自己的状态。
  //   ★修口径前：两者都读 default runtime ⇒ 都拿到「最后一次 refresh 的值」⇒ 必串。
  {
    const stFile = path.join(p.userDir, 'upgrade-state.json');
    const agentA = { session: { id: 'agent-A', header: { cwd: ws } } };
    const agentB = { session: { id: 'agent-B', header: { cwd: ws } } };
    // ① A 的轮次：有 done 状态
    fs.writeFileSync(stFile, JSON.stringify({ phase: 'done', summary: 'AAA-agent-summary', notified: false }), 'utf8');
    fs.writeFileSync(p.userFile, NEW_USER, 'utf8');
    engine.state.userText = NEW_USER;
    await engine.refresh(agentA);
    const outA = String(engine.renderMemoryDynamic({ agent: agentA }) || '');
    ok(outA.indexOf('AAA-agent-summary') >= 0, '★★★U7-9a agentA 渲染看到自己的 done 状态');
    // ② 换成 B：把状态文件改成 failed（模拟 B 的轮次状态不同）
    fs.writeFileSync(stFile, JSON.stringify({ phase: 'failed', error: 'BBB-agent-error', notified: false }), 'utf8');
    await engine.refresh(agentB);
    const outB = String(engine.renderMemoryDynamic({ agent: agentB }) || '');
    const outAAgain = String(engine.renderMemoryDynamic({ agent: agentA }) || '');
    ok(outB.indexOf('BBB-agent-error') >= 0, '★★★U7-9b agentB 渲染看到自己的 failed 状态');
    ok(outB.indexOf('AAA-agent-summary') < 0, '★★★U7-9c **agentB 看不到 agentA 的摘要**（不串味 ⇒ 口径生效）');
    // ★关键：再以 A 渲染一次，必须还是 A 自己的（旧实现会拿到 B 的）
    ok(outAAgain.indexOf('AAA-agent-summary') >= 0 && outAAgain.indexOf('BBB-agent-error') < 0,
      '★★★U7-9d **回头渲染 agentA 仍是 A 自己的状态**（旧实现这里会串成 B —— 这是口径修复的决定性证据）');
  }
} finally {
  globalThis.setInterval = iv; globalThis.setTimeout = to; globalThis.fetch = fe;
  try { fs.rmSync(root, { recursive: true, force: true }) } catch (e) {}
}

console.log('');
console.log('[v4-u7-upgrade-reminder] ' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail ? 1 : 0)