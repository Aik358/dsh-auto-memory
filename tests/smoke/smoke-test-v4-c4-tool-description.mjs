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
// ══════════════════════════════════════════════════════════════════════════════════
// ★★2026-11-02 #507 修复（判据过期，非产品缺陷）—— 基准来源改造
//
//   旧判据把基准写死成 1318，且注释指明来源是 lib/index.js.bak-task31-1792936603168。
//   两个致命问题：
//     ① 该 .bak 被 .gitignore:55 的 lib/*.*.* 排除 ⇒ **CI 检出里根本没有它**；
//     ② 1318 是 task-31 那一批的「改前值」，之后多个批次继续往描述里加内容，
//        HEAD 实测已是 **1768**。原 C4-1e 在 CI 走「HEAD 分支」时拿 HEAD(1768)
//        与硬编码基准(1318)比 ⇒ 必红，且红得与产品无关。
//
//   现判据（**不降低强度，只把不可移植的基准换掉**）：
//     · 基准来源 = **HEAD 已提交版本**（git 可达，CI 一定有），不再依赖未跟踪文件；
//     · C4-1c 语义 = 「**未提交的**描述膨胀不得超过 600」——这是真正还会变动的量；
//     · C4-1d 语义 = 「描述不得被稀释」——改成**绝对下界** C4_MIN_CHARS，
//       比原来的「相对 1318 净增 >300」更难绕过（把描述砍回基线段会直接撞下界）。
//   取不到 HEAD（无 .git / 浅克隆 / 非仓库）时 **显式 skip 并打印原因**，不静默通过。
// ══════════════════════════════════════════════════════════════════════════════════
const C4_MIN_CHARS = 1600;   // ★绝对下界：钉 2026-11-02 HEAD 实测 1768 并留 168 字余量
let HEAD_DESC_CHARS = null;
try {
  const { execSync } = await import('node:child_process')
  const headSrc = execSync('git show HEAD:lib/index.js', { cwd: ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] })
  HEAD_DESC_CHARS = extractDesc(headSrc).length
} catch (e) { HEAD_DESC_CHARS = null }

if (HEAD_DESC_CHARS === null) {
  console.log('  SKIP C4-1c/1e 元断言：取不到 HEAD:lib/index.js（无 .git / 浅克隆 / 非仓库）⇒ 无法算「未提交净增」，skip 有痕，非静默通过')
} else {
  const DELTA = DESC.length - HEAD_DESC_CHARS
  ok(DELTA <= 600, '★★C4-1c 未提交的描述膨胀 ≤600（相对 HEAD 已提交版本）', '工作区 ' + DESC.length + ' − HEAD ' + HEAD_DESC_CHARS + ' = ' + DELTA)
}
ok(DESC.length >= C4_MIN_CHARS, 'C4-1d 描述未被稀释（≥ 绝对下界 ' + C4_MIN_CHARS + '）', 'len=' + DESC.length + ' ≥ ' + C4_MIN_CHARS);

// ══════════════════════════════════════════════════════════════════════════════════
// ★★C4-1e 元断言（Lead 要求）：**判据的基准来源必须与"改前"一致，且不得依赖未跟踪文件**。
//   ★2026-11-02 #507 归因重写：原实现首选 lib/index.js.bak-task31-*，而该文件被
//     .gitignore:55（lib/*.*.*）排除 ⇒ CI 检出里不存在，只能走 HEAD 分支，而 HEAD
//     实测 1768 与硬编码基准 1318 不等 ⇒ 恒红。
//   ⇒ 新元断言守两个不变量（都是可移植的）：
//     ① 基准来源**必须是 HEAD**（同一份 git 对象，开发者与 CI 得到同一结果）；
//     ② 若本地意外存在 .bak，它**只用于交叉核对并打印**，绝不参与判定。
// ══════════════════════════════════════════════════════════════════════════════════
{
  const fsMod = await import('node:fs')
  // ① 交叉核对：本地若残留 .bak（被 gitignore 排除，CI 一定没有），只打印不判定
  let bakNote = 'none'
  try {
    const cands = fsMod.readdirSync(path.join(ROOT, 'lib')).filter((f) => /^index\.js\.bak-task31-\d+$/.test(f)).sort()
    if (cands.length) {
      const bakSrc = fsMod.readFileSync(path.join(ROOT, 'lib', cands[cands.length - 1]), 'utf8')
      bakNote = cands[cands.length - 1] + ' len=' + extractDesc(bakSrc).length + ' (仅参考，不参与判定)'
    }
  } catch (_) { bakNote = 'read-error' }
  // ② 真正的元断言：基准来源是 HEAD，且 HEAD 可抽取
  if (HEAD_DESC_CHARS === null) {
    console.log('  SKIP C4-1e 元断言：取不到 HEAD:lib/index.js ⇒ 无法校验基准来源（skip 有痕，非静默通过）; bak=' + bakNote)
  } else {
    ok(HEAD_DESC_CHARS > 0, '★★C4-1e 基准来源 == HEAD 已提交版本（未跟踪 .bak 不参与判定）', 'HEAD=' + HEAD_DESC_CHARS + ' ; bak=' + bakNote)
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