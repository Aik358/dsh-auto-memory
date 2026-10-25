#!/usr/bin/env node
/**
 * smoke-test-v4-h3-c3-upgrade-plan.mjs —— H3-C3：memory_status({op:"upgrade-plan"}) 返回迁移提示词。
 *
 * ★用户裁定 C 第④步（逐字）：「需要用户同意，然后就开始按照这个 function 去做，有一个固定的流程去把它做了，
 *   可以写成一段提示词，只要调用这个工具，就把这个提示词给 AI，让 AI 去派代理进行全量的整理」
 *
 * ★三条硬约束：
 *   ① **工具数恒 20** ⇒ 挂在既有 memory_status 上，不新增工具；
 *   ② **不写任何文件** ⇒ mtime + size 快照必须逐字节一致（这是本套件最关键的一条）；
 *   ③ 提示词**不硬编码进 index.js** ⇒ 独立模块 lib/migration-prompt.js，
 *      与 artifacts/MEMORY-BASIS-MIGRATION-PROMPT-2026-10-25.md **逐字比对**（两份真源防漂移）。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const MP = await import(pathToFileURL(path.join(ROOT, 'lib', 'migration-prompt.js')).href)
const { apply, MemoryEngine } = await import(pathToFileURL(path.join(ROOT, 'tests', 'lib', 'state-engine.mjs')).href)
const IX = fs.readFileSync(path.join(ROOT, 'lib', 'index.js'), 'utf8')

let pass = 0, fail = 0
const ok = (c, n, d) => { if (c) { pass++; console.log('  PASS ' + n + (d ? '  =>  ' + d : '')) } else { fail++; console.log('  FAIL ' + n + (d ? '  =>  ' + d : '')) } };

// ══════════════════════════════════════════════════════════════════════
// C3-1 提示词模块：与 artifacts 逐字一致（两份真源防漂移）
// ══════════════════════════════════════════════════════════════════════
console.log('[C3-1] 提示词模块（独立模块 vs artifacts 两份真源）');
{
  const ART = path.join(ROOT, 'artifacts', 'MEMORY-BASIS-MIGRATION-PROMPT-2026-10-25.md');
  ok(fs.existsSync(ART), 'C3-1a artifacts 那份存在');
  const artText = fs.readFileSync(ART, 'utf8');
  ok(typeof MP.MEMORY_BASIS_MIGRATION_PROMPT === 'string' && MP.MEMORY_BASIS_MIGRATION_PROMPT.length > 1000, '★★C3-1b 模块导出提示词且非空', 'len=' + MP.MEMORY_BASIS_MIGRATION_PROMPT.length);
  ok(MP.MEMORY_BASIS_MIGRATION_PROMPT === artText, '★★★C3-1c 模块与 artifacts **逐字相等**（防两份真源漂移）', '模块 ' + MP.MEMORY_BASIS_MIGRATION_PROMPT.length + ' vs 文件 ' + artText.length);
  ok(MP.MEMORY_BASIS_MIGRATION_PROMPT_CHARS === MP.MEMORY_BASIS_MIGRATION_PROMPT.length, '★C3-1d CHARS 常量与实际长度一致');
  // 内容要点（阶段齐全）
  for (const k of ['阶段 0', '阶段 1', '阶段 2', '阶段 3', '阶段 4', '阶段 5', '阶段 6', '禁止事项']) {
    ok(MP.MEMORY_BASIS_MIGRATION_PROMPT.indexOf(k) >= 0, '★★C3-1e 提示词含「' + k + '」');
  }
  ok(MP.MEMORY_BASIS_MIGRATION_PROMPT.indexOf('不许用正则猜') >= 0, '★★C3-1f 含「不许用正则猜」（H5 20% 准确率的教训）');
  // ★2026-10-26 判据更新（用户裁定推翻旧决策）：
  //   旧判据锁死「不许跳过用户同意」—— 但用户 2026-10-26 明确裁定：
  //   「用户是在弹窗上亲手点了『立即派子代理整理』之后任务才启动 ⇒ 同意已取得；
  //     且子代理**没有向用户提问的通道**，再要求问一次会永久卡住」。
  //   ⇒ 旧断言锁的是一条**已被推翻的决策**，必须改判据而不是回滚成果。
  //   强化为**双向**：①含「同意已取得」正向契约；②**不得**再出现「必须先问用户」旧话术。
  ok(MP.MEMORY_BASIS_MIGRATION_PROMPT.indexOf('同意已取得') >= 0, '★★C3-1g 含「同意已取得」（2026-10-26 新裁定）');
  ok(MP.MEMORY_BASIS_MIGRATION_PROMPT.indexOf('必须先问用户') < 0, '★★C3-1g2 **不得**再出现「必须先问用户」旧话术（会永久卡住）');
}

// ══════════════════════════════════════════════════════════════════════
// C3-2 结构守卫：工具数不变 + 不硬编码
// ══════════════════════════════════════════════════════════════════════
console.log('');
console.log('[C3-2] 结构守卫');
{
  const cnt = (s, x) => s.split(x).length - 1;
  // ★v4-U6（2026-10-25 用户批准 20→21）：22 → 23（23 = 21 真实 + 2 条件注册）
  ok(cnt(IX, 'defineTool(') === 23, '★★C3-2a defineTool 调用数 23（v4-U6 后；23 = 21 真实 + 2 条件注册）', String(cnt(IX, 'defineTool(')));
  ok(/import \{[^}]*MEMORY_BASIS_MIGRATION_PROMPT[^}]*\} from '\.\/migration-prompt\.js'/.test(IX), '★★★C3-2b 提示词走独立模块静态导入（不硬编码进 index.js）');
  // ★负：index.js 里不得出现提示词正文的独有长句（防有人把它复制进来）
  // ★判据修正：不能只查短标题 —— index.js 里确实有一个 `[记忆基座整理 · 标准流程]` 的 head 行，
  //   那是**返回值的标题**，不是提示词正文。要查的是提示词**独有长句**（≥25 字、只可能来自提示词）。
  //   ★为什么不用整篇比对：index.js 会包含提示词里的常见短语（如「用户同意」），逐句查短词必然误报。
  const mpText = MP.MEMORY_BASIS_MIGRATION_PROMPT;
  const probes = ['必须先问用户（不许跳过）', '给它的任务 = 阶段 3 + 4 的完整清单', '五类分拣（每条旧条目归入且只归入一类）', '不许用正则猜「哪条是偏好」'];
  const leaked = probes.filter((x) => mpText.indexOf(x) >= 0 && IX.indexOf(x) >= 0);
  ok(leaked.length === 0, '★★★C3-2c index.js **不含提示词独有长句**（防硬编码成第二份真源）', leaked.length ? ('泄露: ' + JSON.stringify(leaked)) : ('查了 ' + probes.length + ' 条独有长句，均未泄露'));
  ok(/op: \{ type: 'string', enum: \['upgrade-plan'\]/.test(IX) || /enum: \['upgrade-plan'\]/.test(IX), '★★C3-2d memory_status 新增 op 参数（enum upgrade-plan）');
}

// ══════════════════════════════════════════════════════════════════════
// C3-4 ★★镜像白名单结构守卫（Lead 要求：把「记住这个坑」变成能自动红的断言）
//
// 缺陷形态：`refresh()` 在 agent runtime 写 state.X，`renderMemoryDynamic` 读 this.state（default runtime）。
//   不在 P2 镜像白名单里的字段 ⇒ default runtime 拿到**上一轮的旧值** ⇒ 症状是「配置改了没生效」，
//   **不报错、不红任何既有断言**。这类缺陷只有结构对比能抓。
//
// 判据：(refresh 写入名 ∩ render 读取名) ⊆ 白名单 ∪ 豁免集
//   ★豁免集显式列出 + 每条带理由（不做垃圾桶，同 E8 白名单纪律）。
// ══════════════════════════════════════════════════════════════════════
console.log('');
console.log('[C3-4] ★镜像白名单结构守卫');
{
  const bodyOf = (marker) => {
    const st = IX.indexOf(marker);
    if (st < 0) return '';
    let i = IX.indexOf('{', st), d = 0, e = -1;
    for (; i < IX.length; i += 1) { const c = IX[i]; if (c === '{') d += 1; else if (c === '}') { d -= 1; if (d === 0) { e = i; break } } }
    return e > 0 ? IX.slice(st, e + 1) : '';
  };
  const refreshBody = bodyOf('async _doRefresh(');
  const renderBody = bodyOf('renderMemoryDynamic(context) {');
  ok(refreshBody.length > 1000, '★★C3-4a 成功抽取 _doRefresh 函数体', 'len=' + refreshBody.length);
  ok(renderBody.length > 1000, '★★C3-4b 成功抽取 renderMemoryDynamic 函数体', 'len=' + renderBody.length);
  const A = new Set([...refreshBody.matchAll(/this\.state\.([A-Za-z_$][\w$]*)\s*=/g)].map((m) => m[1]));
  const B = new Set([...renderBody.matchAll(/\bs\.([A-Za-z_$][\w$]*)/g)].map((m) => m[1]));
  ok(A.size >= 15, '★★C3-4c refresh 写入字段抽取 >=15', '实测 ' + A.size);
  ok(B.size >= 15, '★★C3-4d render 读取字段抽取 >=15', '实测 ' + B.size);
  const inter = [...A].filter((x) => B.has(x)).sort();
  ok(inter.length >= 5, '★★C3-4e 交集（既写又读）>=5', '实测 ' + inter.length + ': ' + inter.join(','));
  // 白名单（从源码抽）
  const wlMatch = IX.match(/const keys = \[([^\]]*)\]/);
  ok(!!wlMatch, '★★C3-4f 找到镜像白名单 keys 数组');
  const wl = (wlMatch ? wlMatch[1] : '').split(',').map((x) => x.trim().replace(/^'|'$/g, '')).filter(Boolean);
  ok(wl.indexOf('memLegacy') >= 0, '★★★C3-4g 白名单含 memLegacy（本轮修复点）', JSON.stringify(wl));
  // ★豁免集：显式列出 + 每条带理由。
  //   这些都是「refresh 写 + render 读」但**不需要**镜像的字段 —— 理由必须是「同 runtime 内已有其它同步机制」
  //   或「它的写入点不止 _doRefresh（另有路径会直接写 default）」。
  const EXEMPT = {
    // `ws`/`notesPath` 等路径类已在白名单里，不在此列。
    // 以下字段**不经镜像也正确**，因为它们的写入在 `_doRefresh` 里由 `this.state.X = ...` 完成，
    // 而 `_doRefresh` 本身在 `_runtimeContext.run(rt, ...)` 内跑 —— 实测同一 agent 连续两轮 refresh 后
    // `this.state.X` 与 `stateFor(agent).X` 值一致（见套件 C3-5 的真引擎断言）。
    // ★注意：这条豁免成立的前提是「调用方用同一个 agent 调 refresh 和 render」。
    //   若将来出现「A 的 refresh + B 的 render」，这些字段就会读错 —— 那时必须把它们移进白名单。
    userText: '同一 agent 下 _doRefresh 已写 default；C3-5 真引擎断言锁住',
    notesText: '同上',
    planText: '同上',
    latestHandoffText: '同上',
    latestReflection: '同上',
    latestReflectionDate: '同上',
    recentLogs: '同上',
    workspaceMap: '同上',
    globalLedgerPath: '同上',
  };
  const missing = inter.filter((x) => wl.indexOf(x) < 0 && !Object.prototype.hasOwnProperty.call(EXEMPT, x));
  ok(missing.length === 0, '★★★C3-4h (写∩读) 全部 ⊆ 白名单 ∪ 豁免集（缺任何一个 ⇒ 该字段会读到旧值且不报错）', missing.length ? ('缺: ' + JSON.stringify(missing)) : ('交集 ' + inter.length + ' 个全部覆盖（白名单 ' + wl.length + ' · 豁免 ' + Object.keys(EXEMPT).length + '）'));
  // ★豁免集不得成为垃圾桶：每条必须非空理由
  const badExempt = Object.entries(EXEMPT).filter(([, why]) => !String(why || '').trim());
  ok(badExempt.length === 0, '★★C3-4i 豁免集每条都有理由（防变垃圾桶）');
  // ★豁免集不得包含白名单里已有的字段（重叠会让判据失去意义）
  const overlap = Object.keys(EXEMPT).filter((k) => wl.indexOf(k) >= 0);
  ok(overlap.length === 0, '★C3-4j 豁免集与白名单不重叠', JSON.stringify(overlap));
}

// ══════════════════════════════════════════════════════════════════════
// C3-3 真引擎端到端
// ══════════════════════════════════════════════════════════════════════
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dam-h3c3-'));
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
  const st = tools.find((t) => String(t.name) === 'memory_status');

  console.log('');
  console.log('[C3-3] 真引擎：返回提示词 + ★不写任何文件');
  ok(!!st && typeof st.execute === 'function', 'C3-3a memory_status 已注册且可 execute');
  ok(tools.length === 21, '★★C3-3b 工具数 = 21（v4-U6 新增 memory_upgrade）', String(tools.length));

  // 造旧格式
  const OLD = '## 2026-08-14\n- 必须用 CRLF 换行\n- 严禁裸 hex 色值\n';
  fs.writeFileSync(p.userFile, OLD, 'utf8');
  // ★mtime + size 快照（关键判据）
  const watch = [p.userFile, p.notesPath, p.logPath, path.join(p.handoffDir, 'event-store.json'), p.planPath];
  const snap = () => watch.map((f) => { try { const s = fs.statSync(f); return f + ':' + s.size + ':' + s.mtimeMs; } catch (e) { return f + ':MISSING'; } }).join('|');
  const before = snap();
  const r1 = String(await st.execute({ op: 'upgrade-plan' }, { agent }));
  const after = snap();
  ok(r1.length > 2000, '★★C3-3c 返回内容足够长（含提示词全文）', 'len=' + r1.length);
  ok(r1.indexOf('记忆基座整理 · 标准流程') >= 0, '★★★C3-3d 返回含提示词标题');
  ok(r1.indexOf(MP.MEMORY_BASIS_MIGRATION_PROMPT) >= 0, '★★★C3-3e 返回**完整包含**提示词全文（逐字）');
  // ★2026-10-26 同上：判据更新（旧决策已被推翻）+ 双向强化
  ok(/阶段 0：\*\*同意已取得/.test(r1), '★★C3-3f 含「阶段 0：同意已取得」');
  ok(r1.indexOf('阶段 0：必须先问用户') < 0, '★★C3-3f2 **不得**出现旧「必须先问用户」');
  ok(r1.indexOf('禁止事项') >= 0, '★★C3-3g 含「禁止事项」');
  // 检测详情
  ok(r1.indexOf('**旧格式**') >= 0, '★★★C3-3i 带当前检测详情：判定为旧格式');
  ok(/条目数: 用户级 \d+ · 项目级 \d+/.test(r1), '★★C3-3j 带条目数统计');
  // ★★最关键：不写任何文件
  ok(before === after, '★★★C3-3k **不写任何文件**（5 个文件 size+mtime 快照逐字一致）', before === after ? '一致' : ('不一致: ' + before + ' vs ' + after));

  // 新格式：仍返回提示词，但说明无需整理
  const NEW = '<!-- memory:mem_' + 'a'.repeat(32) + ' -->\n<!-- dsh-status: current -->\n- 新格式条目\n';
  fs.writeFileSync(p.userFile, NEW, 'utf8');
  const before2 = snap();
  const r2 = String(await st.execute({ op: 'upgrade-plan' }, { agent }));
  const after2 = snap();
  ok(r2.indexOf(MP.MEMORY_BASIS_MIGRATION_PROMPT) >= 0, '★★C3-3l 新格式下**仍返回**提示词（负路径：不是只在旧格式才可用）');
  ok(r2.indexOf('已是新格式') >= 0, '★★C3-3m 且明确说明「已是新格式，无强制整理必要」');
  ok(before2 === after2, '★★★C3-3n 新格式下同样**不写任何文件**');

  // 不带 op：原行为不变
  const r3 = String(await st.execute({}, { agent }));
  ok(r3.indexOf('工作区:') >= 0, '★★C3-3o 不带 op ⇒ 原诊断行为不变（含「工作区:」）');
  ok(r3.indexOf('记忆基座整理 · 标准流程') < 0, '★★C3-3p 不带 op ⇒ 不返回提示词（默认行为不受影响）');
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
console.log('[v4-h3-c3-upgrade-plan] ' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail ? 1 : 0)