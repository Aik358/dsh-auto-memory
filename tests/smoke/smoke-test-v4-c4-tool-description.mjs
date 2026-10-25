#!/usr/bin/env node
/**
 * smoke-test-v4-c4-tool-description.mjs —— C4：memory_event 工具描述补「何时填哪类感知」。
 *
 * ★用户裁定（2026-10-25 逐字）：「问题3其实很简单，就是因为刚做完，估计还没来得及收集足够多的
 *   资料，把相关的内容都接入到 prompt 里面，让模型能够按需调用就可以了，这个也是精简版、完整版都需要」
 *
 * ★实测缺口：工具描述只**罗列**参数名（「也可传 constraint / userPercept / agentTrace /
 *   sharedGround / commitment」），没教模型填什么 ⇒ 实测 userPercept 2 条、其余三类 0 条。
 *   **不是模型不愿填，是不知道填什么。**
 *
 * ★约束：工具描述进每轮工具表（token 成本高）⇒ 总增 ≤600 字符、总长 ≤1800。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const IX = fs.readFileSync(path.join(ROOT, 'lib', 'index.js'), 'utf8')

let pass = 0, fail = 0
const ok = (c, n, d) => { if (c) { pass++; console.log('  PASS ' + n + (d ? '  =>  ' + d : '')) } else { fail++; console.log('  FAIL ' + n + (d ? '  =>  ' + d : '')) } };

// ── 抽取 memory_event 的描述字面量（真读源码里的那个字符串）──
function extractDesc(src) {
  const mark = "defineTool('memory_event', '";
  const i0 = src.indexOf(mark);
  if (i0 < 0) throw new Error('找不到 memory_event 的 defineTool');
  const from = i0 + mark.length;
  // 描述以 ', { 结束（第二参数是参数表对象）
  const i1 = src.indexOf("', {", from);
  if (i1 < 0) throw new Error('找不到描述结束锚（终锚 -1）—— 拒绝继续');
  const raw = src.slice(from, i1);
  // 反转义（源码里是 \n 等）——用 JSON 风格反解
  return raw.replace(/\\n/g, '\n').replace(/\\'/g, "'");
}
const DESC = extractDesc(IX);

console.log('[C4-1] 抽取与长度约束');
ok(typeof DESC === 'string' && DESC.length > 800, 'C4-1a 描述已抽出且非空', 'len=' + DESC.length);
ok(DESC.length <= 1800, '★★C4-1b 描述总长 ≤1800（工具表 token 成本约束）', 'len=' + DESC.length);
// ★2026-10-25 重钉（Lead 裁决 A）：C4 批当年的「改前值」是 827；从 C4 到本批，描述被后续批次累加到 1,318。
//   判据语义是「本批相对改前增长 ≤600」⇒ 基准必须随「改前」移动，否则变成跨批累积计算（恒假失败）。
//   基线 1,318 来源：lib/index.js.bak-task31-1792936603168（2026-10-25 20:12，task-31 开工前备份），实测抽取。
//   本批：1,318 → 1,659 = +341（≤600 ✅）。
const C4_BASELINE_CHARS = 1318;
const DELTA = DESC.length - C4_BASELINE_CHARS;
ok(DELTA <= 600, '★★C4-1c 净增 ≤600（相对改前 827 字符）', '净增 ' + DELTA);
ok(DELTA > 300, 'C4-1d 确实补了实质内容（净增 >300，不是敷衍）', '净增 ' + DELTA);

// ══════════════════════════════════════════════════════════════════════════════════
// ★★C4-1e 元断言（Lead 要求）：**基准常量必须等于「本批开工前」的真实描述长度**。
//   目的：防止「有人改了描述却忘了移动基准」⇒ 下一次净增恒假、判据失去鉴别力。
//
//   ★实测发现（本轮 2026-10-25 22:5x）：`git show HEAD:lib/index.js` 抽出的描述是 **820**，
//     而不是 1,318 —— 因为 **HEAD 是 2026-10-24 的旧快照**（commit 4098dfe「未完成，防覆盖提交」），
//     本批开工时的 1,318 是**工作区未提交状态**（C4 之后若干批次累积，均未提交）。
//     ⇒ 拿 HEAD 当基准来源**不可靠**。
//   ⇒ 正确判据：基准必须等于「开工前备份文件」的抽取长度（那是本批真正的改前值）。
//     备份缺失时退回 HEAD 比对；两者都没有 ⇒ **打印 skip 并说明原因，不静默通过**。
// ══════════════════════════════════════════════════════════════════════════════════
{
  const fs = await import('node:fs')
  const extract = (src) => {
    const mark = ", '"
    const i0 = src.indexOf("defineTool('memory_event'")
    if (i0 < 0) return null
    const i1 = src.indexOf(mark, i0)
    const i2 = src.indexOf("', {", i1 + mark.length)
    if (i1 < 0 || i2 < 0) return null
    return src.slice(i1 + mark.length, i2).replace(/\\n/g, '\n').replace(/\\'/g, "'")
  }
  // ① 首选：开工前备份（本批真正的改前值）
  const bakDir = path.join(ROOT, 'lib')
  let bakFile = ''
  try {
    const cands = fs.readdirSync(bakDir).filter((f) => /^index\.js\.bak-task31-\d+$/.test(f)).sort()
    if (cands.length) bakFile = path.join(bakDir, cands[cands.length - 1])
  } catch (_) { bakFile = '' }
  if (bakFile) {
    const bakDesc = extract(fs.readFileSync(bakFile, 'utf8'))
    const same = bakDesc != null && bakDesc.length === C4_BASELINE_CHARS
    ok(same, '★★C4-1e 基准常量 == 开工前备份的描述长度（基准未漂移）',
      'bak=' + (bakDesc == null ? '抽取失败' : bakDesc.length) + ' 基准=' + C4_BASELINE_CHARS + ' ← ' + path.basename(bakFile))
  } else {
    // ② 退回 HEAD（仅在 HEAD 已含本批改动时才有意义；否则明确 skip）
    let headSrc = null
    try {
      const { execSync } = await import('node:child_process')
      headSrc = execSync('git show HEAD:lib/index.js', { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] })
    } catch (e) { headSrc = null }
    const headDesc = headSrc ? extract(headSrc) : null
    if (headDesc == null) {
      console.log('  SKIP C4-1e 元断言：既无开工前备份、HEAD 里也抽不到描述 ⇒ 无法校验基准（skip 有痕，非静默通过）')
    } else if (headDesc.length === C4_BASELINE_CHARS) {
      ok(true, '★★C4-1e 基准常量 == HEAD 版本描述长度（基准未漂移）', 'HEAD=' + headDesc.length)
    } else if (headDesc.length === DESC.length) {
      ok(false, '★★C4-1e 基准需前移：HEAD 已含本批改动，但基准仍是旧值', 'HEAD=当前=' + headDesc.length + ' 基准=' + C4_BASELINE_CHARS)
    } else {
      console.log('  SKIP C4-1e 元断言：HEAD 未含本批修改（HEAD=' + headDesc.length + ' ≠ 基准=' + C4_BASELINE_CHARS + ' 且 ≠ 当前=' + DESC.length + '）⇒ skip 有痕')
    }
  }
}

console.log('');
console.log('[C4-2] ★核心：五个 stage 值都必须印在描述里');
{
  for (const st of ['retrieved', 'delivered', 'used', 'mentioned', 'accepted']) {
    ok(DESC.indexOf(st) >= 0, '★★★C4-2 stage 值「' + st + '」在描述里');
  }
  // 中文释义也要有（只写英文枚举模型不知道何时用）
  ok(/retrieved[（(]被检索到/.test(DESC), '★★C4-2f retrieved 有中文释义（被检索到）');
  ok(/accepted[（(]用户确认/.test(DESC), '★★C4-2g accepted 有中文释义（用户确认）');
}

console.log('');
console.log('[C4-3] ★★三个 kind 值 + 「只有 accepted/used 进画像」必须印在描述里');
{
  for (const k of ['preference', 'state', 'unfinished-goal']) {
    ok(DESC.indexOf(k) >= 0, '★★C4-3 kind 值「' + k + '」在描述里');
  }
  ok(/只有 accepted \/ used 会进/.test(DESC), '★★★C4-3d ★最关键：「只有 accepted / used 会进用户画像段」印在描述里（否则模型会乱填 retrieved）');
  ok(DESC.indexOf('用户画像') >= 0, '★★C4-3e 明确点名「用户画像」段（模型知道后果）');
  ok(/其余是噪声/.test(DESC), '★C4-3f 说明其余不进画像（「噪声」）');
}

console.log('');
console.log('[C4-4] 四类各自的一句话说明 + 至少 2 个示例');
{
  ok(/userPercept 人类侧观察/.test(DESC), '★★C4-4a userPercept 说明');
  ok(/agentTrace 你做了什么/.test(DESC), '★★C4-4b agentTrace 说明');
  ok(/sharedGround 已达成的共识/.test(DESC), '★★C4-4c sharedGround 说明');
  ok(/commitment 你对用户的承诺/.test(DESC), '★★C4-4d commitment 说明');
  // agentTrace 三字段
  ok(/\{action,result,wasRefuted\}/.test(DESC) || (DESC.indexOf('action') >= 0 && DESC.indexOf('wasRefuted') >= 0), '★★C4-4e agentTrace 三字段在描述里');
  // commitment state 三值
  ok(/open/.test(DESC) && /kept/.test(DESC) && /dropped/.test(DESC), '★★C4-4f commitment state 三值（open/kept/dropped）在描述里');
  // 示例计数：找「例」后跟一个对象字面量起始（`例 {` 或 `例：{` 或 `例:{`）
  // ★首版只认全角冒号「例：」⇒ 实测 0 个假红（源码里是「例 {…}」）。判据应锚定**语义**（示例对象），不是标点。
  const exCount = (DESC.match(/例\s*[：:]?\s*\{/g) || []).length;
  ok(exCount >= 2, '★★C4-4g 至少 2 个示例（「例 {…}」形式的对象示例）', '实测 ' + exCount + ' 个');
  ok(/wasRefuted:true/.test(DESC), '★C4-4h agentTrace 示例含 wasRefuted:true（教模型怎么标「被推翻」）');
}

console.log('');
console.log('[C4-5] 原有内容不得丢（改写不是推倒重来）');
{
  ok(DESC.indexOf('append-only') >= 0, 'C4-5a 保留 append-only 说明');
  ok(/7 个字段可 set/.test(DESC), 'C4-5b 保留「7 个字段可 set」');
  ok(DESC.indexOf('create') >= 0 && DESC.indexOf('close') >= 0 && DESC.indexOf('rename') >= 0, 'C4-5c 保留五动作枚举');
  ok(/evt_<8hex>/.test(DESC), 'C4-5d 保留 id 格式说明');
  ok(DESC.indexOf('idemKey') >= 0, 'C4-5e 保留 idemKey 强建议');
  ok(/不确定事件归属时先 create/.test(DESC), 'C4-5f 保留「不确定归属先 create」');
  ok(/PANEL|panels/.test(DESC), 'C4-5g 保留 panels 说明');
}

console.log('');
console.log('[C4-6] ★端到端：按描述格式填一条 userPercept{stage:accepted,kind:preference} ⇒ 画像段真出现');

// 真造引擎（state-engine 沙箱）+ 真调 memory_event
const { apply, MemoryEngine } = await import(pathToFileURL(path.join(ROOT, 'tests', 'lib', 'state-engine.mjs')).href);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dam-c4-'));
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
  const evTool = tools.find((t) => String(t.name) === 'memory_event');
  ok(!!evTool && typeof evTool.execute === 'function', '★★C4-6a memory_event 工具已注册且可 execute');
  const agent = { session: { id: 's1', header: { cwd: ws } } };
  const cr = await evTool.execute({ action: 'create', name: 'C4 端到端事件', summary: '验证按描述格式填的感知能进画像段' }, { agent });
  const evIdM = String(cr).match(/evt_[0-9a-f]{8}/);
  ok(!!evIdM, 'C4-6b create 返回合法 evt id', evIdM ? evIdM[0] : '未匹配');
  const evId = evIdM ? evIdM[0] : '';
  // ★严格按描述格式填一条
  const ar = await evTool.execute({
    action: 'append', eventId: evId,
    userPercept: { stage: 'accepted', kind: 'preference', text: '反对在 system prompt 注入长候选清单（C4 端到端验证专用）' },
    checkpoint: { kind: 'progress', text: 'C4 端到端检查点', idemKey: 'c4-e2e-1' },
  }, { agent });
  ok(/已追加|追加/.test(String(ar)) || String(ar).indexOf('ok') >= 0, 'C4-6c append 成功', JSON.stringify(String(ar).slice(0, 50)));
  // 真读回来：userPercept 里必须真有这条
  const espMod = await import(pathToFileURL(path.join(ROOT, 'lib', 'event-store.js')).href);
  const det = await espMod.eventStorePre.detail(path.join(paths.handoffDir, 'event-store.json'), evId);
  const ups = (det && det.event && det.event.userPercept) || [];
  ok(ups.length >= 1, '★★C4-6d userPercept 真落盘', String(ups.length) + ' 条');
  const up0 = ups[0] || {};
  ok(String(up0.stage) === 'accepted' && String(up0.kind) === 'preference', '★★C4-6e stage/kind 按描述格式正确落盘', JSON.stringify({ stage: up0.stage, kind: up0.kind }));
  // ★画像段端到端：engine.renderUserPortraitPre 或注入文本里出现
  let portrait = '';
  try {
    await engine.refreshEventStatePre(agent);
    portrait = String(engine.state.userPortraitText || '');
  } catch (e) { portrait = ''; }
  ok(portrait.indexOf('长候选清单') >= 0, '★★★C4-6f ★端到端：accepted 的 preference **真进了用户画像段**', '画像段长度 ' + portrait.length);
} finally {
  // ★★2026-10-25 修（全量回归实测抓到 · 进程级退出崩溃）：**必须恢复被 patch 的全局定时器**。
  //   实测：全量并行时本套件 exit code = 3221226505（0xC0000409 / libuv `UV_HANDLE_CLOSING` 断言），
  //   而套件自身断言 **38 PASS / 0 FAIL**（单跑 3 次全绿）⇒ 不是判据问题，是**进程退出时崩溃**。
  //   根因：L118 把 `globalThis.setInterval/setTimeout` 换成 `()=>({unref(){}})`，L128 恢复 ——
  //   但只在**正常路径**恢复。若 try 块中途抛异常，这里只清了目录、**没恢复定时器** ⇒
  //   后续代码（含 Node 内部/libuv 的异步句柄）拿到假的定时器 ⇒ 退出时句柄状态不一致 ⇒ 崩溃。
  //   ⇒ 修法：恢复动作移进 finally（幂等，重复赋值无害）。
  globalThis.setInterval = iv;
  globalThis.setTimeout = to;
  globalThis.fetch = fe;
  try { fs.rmSync(root, { recursive: true, force: true }) } catch (e) {}
}

console.log('');
console.log('[v4-c4-tool-description] ' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail ? 1 : 0)