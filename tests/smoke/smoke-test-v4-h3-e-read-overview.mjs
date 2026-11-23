#!/usr/bin/env node
/**
 * smoke-test-v4-h3-e-read-overview.mjs —— H3-E：memory_read 先给全貌。
 *
 * ★用户裁定 E（2026-10-25 逐字）：
 *   「①精简的最近激活事件的标题和内容（不是最细节的，而是比较高一级的内容）
 *     ②本项目的总体说法（在交接账本里）」
 *
 * ★设计：正文**之前**加 ≤600 字全貌：
 *   · 最近激活事件 T1 一行级 ≤3 条（**不是 T2 详情** —— 那就又变成细节了）；
 *   · 项目总览 = PLAN 的「这是什么」段 + 账本的「目标」段；
 *   · **kind=plan 不加**（PLAN 本身就是全貌）；
 *   · 空则零字节；fail-soft（算不出来不影响正文）。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const IX = fs.readFileSync(path.join(ROOT, 'lib', 'index.js'), 'utf8')
const { apply, MemoryEngine } = await import(pathToFileURL(path.join(ROOT, 'tests', 'lib', 'state-engine.mjs')).href)
const ES = await import(pathToFileURL(path.join(ROOT, 'lib', 'event-store.js')).href)

let pass = 0, fail = 0
const ok = (c, n, d) => { if (c) { pass++; console.log('  PASS ' + n + (d ? '  =>  ' + d : '')) } else { fail++; console.log('  FAIL ' + n + (d ? '  =>  ' + d : '')) } };

// ══════════════════════════════════════════════════════════════════════
// E-1 结构守卫
// ══════════════════════════════════════════════════════════════════════
console.log('[E-1] 结构守卫');
{
  ok(IX.indexOf('buildReadOverviewPre(agent)') >= 0, '★★E-1a 全貌构建方法存在');
  ok(/const overview = engine\.buildReadOverviewPre\(exec\.agent\)/.test(IX), '★★E-1b memory_read 调用它');
  ok(/return overview \+ \(text\.length > cap/.test(IX), '★★E-1c 全貌**前置**拼接（overview + 正文）');
  // ★kind=plan 必须早退在 overview 之前
  const iPlan = IX.indexOf("if (kind === 'plan')");
  const iOverview = IX.indexOf('const overview = engine.buildReadOverviewPre');
  ok(iPlan >= 0 && iOverview > iPlan, '★★★E-1d kind=plan 的早退在全貌之前 ⇒ PLAN 不加全貌（自身即全貌）', 'plan@' + iPlan + ' < overview@' + iOverview);
  ok(/if \(text\.length > 600\)/.test(IX) || /text\.length > 600/.test(IX), '★★E-1e 有 ≤600 硬上限');
  // ★判据实现修正（本轮实测踩到）：原写法在函数起始**后 3000 字符**窗口内找 `catch … return ''`，
  //   但 `buildReadOverviewPre` 的函数体有 ~2600 字符 + U7 又在其前插了代码 ⇒ 边界外 ⇒ 恒红。
  //   正解：**按函数真实边界切片**（起点 → 下一个同级方法定义），在整段函数体里找 fail-soft。
  {
    const bStart = IX.indexOf('  buildReadOverviewPre(agent) {');
    let bEnd = IX.length;
    if (bStart > 0) {
      const rest = IX.slice(bStart + 40);
      const mm = rest.search(/\n  [a-zA-Z_$][\w$]*\([^)]*\)\s*\{/);
      if (mm > 0) bEnd = bStart + 40 + mm;
    }
    const bBody = bStart > 0 ? IX.slice(bStart, bEnd) : '';
    ok(bBody.length > 1500, 'E-1f-0 函数体切片长度合理', String(bBody.length));
    ok(/catch \(e\) \{[\s\S]{0,120}return ''/.test(bBody), '★★E-1f fail-soft（算不出来返回空串，不挡正文）');
  }
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dam-h3e-'));
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
  const mr = tools.find((t) => String(t.name) === 'memory_read');

  console.log('');
  console.log('[E-2] 真引擎：全貌内容');
  ok(!!mr && typeof mr.execute === 'function', 'E-2a memory_read 可执行');

  // 建 2 个事件
  const storePath = path.join(p.handoffDir, 'event-store.json');
  await ES.eventStorePre.create(storePath, { name: '事件甲：完成 H3-D', summary: '把注入 Prompt 补上三问', status: 'active' });
  await ES.eventStorePre.create(storePath, { name: '事件乙：完成 H3-B', summary: '规约分组渲染', status: 'active' });
  fs.writeFileSync(p.planPath, '# 白板\n\n## 这是什么\n项目总体说明内容。\n\n## 无关\n不该出现\n', 'utf8');
  fs.writeFileSync(path.join(p.handoffDir, 'handoff-x.md'), '# 账本\n\n## 目标\n项目目标段落内容。\n\n## 无关\n不该出现\n', 'utf8');
  fs.writeFileSync(p.userFile, '<!-- memory:mem_' + 'a'.repeat(32) + ' -->\n- 用户规则甲\n', 'utf8');
  await engine.refresh(agent);

  const ov = engine.buildReadOverviewPre(agent);
  ok(ov.length > 0, '★★★E-2b 全貌非空', 'len=' + ov.length);
  ok(ov.length <= 600, '★★★E-2c 全貌 ≤600 字符（用户/Lead 硬约束）', '实测 ' + ov.length);
  ok(ov.indexOf('[最近事件]') >= 0, '★★★E-2d 含「最近事件」（裁定 E 第①条）');
  ok(ov.indexOf('[项目总览]') >= 0, '★★★E-2e 含「项目总览」（裁定 E 第②条）');
  ok(/把注入 Prompt 补上三问|规约分组渲染|事件甲|事件乙/.test(ov), '★★E-2f 事件行来自真事件库（不是硬编码）');
  ok(ov.indexOf('项目总体说明内容') >= 0, '★★★E-2g 项目总览取 PLAN 的「这是什么」段');
  // 负路径：不该带无关段
  ok(ov.indexOf('不该出现') < 0, '★★★E-2h 不夹带无关段落（只取「这是什么」/「目标」两段）');
  // 事件是 T1 一行级，不是 T2 详情
  ok(ov.indexOf('把注入 Prompt 补上三问') >= 0, '★★E-2i 事件行含 summary（T1 一行级）');

  console.log('');
  console.log('[E-3] memory_read 返回值');
  const t1 = String(await mr.execute({ kind: 'user' }, { agent }));
  ok(t1.indexOf('[最近事件]') >= 0 || t1.indexOf('[项目总览]') >= 0, '★★★E-3a memory_read 返回里含全貌');
  ok(t1.indexOf('用户规则甲') >= 0, '★★E-3b 正文也在');
  const iOv = Math.max(t1.indexOf('[最近事件]'), t1.indexOf('[项目总览]'));
  ok(iOv >= 0 && iOv < t1.indexOf('用户规则甲'), '★★★E-3c **全貌在正文之前**（先全貌、再细节）');

  // ★kind=plan 不加全貌
  const t2 = String(await mr.execute({ kind: 'plan' }, { agent }));
  ok(t2.indexOf('[项目总览]') < 0 && t2.indexOf('[最近事件]') < 0, '★★★E-3d **kind=plan 不加全貌**（PLAN 自身即全貌）');
  ok(t2.indexOf('项目总体说明内容') >= 0, '★★E-3e 但 PLAN 正文正常返回');

  // ★★E-3g 功能断言：构造**超长**内容 ⇒ 全貌仍 ≤600（不能只靠结构守卫）
  //   ★为什么必须功能断言：只断言源码里有 `if (text.length > 600)` 是**恒真守卫** ——
  //     把条件改成 `if (false)` 它照样绿（实测变异②：只有结构守卫红=判据太弱）。
  //     必须真造超量数据、真调用、真断言输出长度。
  {
    // 造 8 个长名事件 + 超长 PLAN「这是什么」段 + 超长账本「目标」段
    for (let i = 0; i < 8; i += 1) {
      await ES.eventStorePre.create(storePath, { name: '超长事件' + i + '：条目', summary: 'S'.repeat(180), status: 'active' });
    }
    fs.writeFileSync(p.planPath, '# 白板\n\n## 这是什么\n' + 'P'.repeat(900) + '\n', 'utf8');
    fs.writeFileSync(path.join(p.handoffDir, 'handoff-x.md'), '# 账本\n\n## 目标\n' + 'G'.repeat(900) + '\n', 'utf8');
    await engine.refresh(agent);
    const ovBig = engine.buildReadOverviewPre(agent);
    ok(ovBig.length > 0 && ovBig.length <= 600, '★★★E-3g 超长输入下全貌仍 ≤600（功能断言，不是结构守卫）', '实测 ' + ovBig.length);
    ok(ovBig.indexOf('…') >= 0 || ovBig.length < 600, '★★E-3h 超长时给出「…」截断标记（不切半个字）', JSON.stringify(ovBig.slice(-20)));
  }

  // ★空场景：无事件无白板 ⇒ 零字节（不占预算）
  fs.writeFileSync(p.planPath, '', 'utf8');
  try { fs.unlinkSync(path.join(p.handoffDir, 'handoff-x.md')) } catch (e) {}
  const storePath2 = path.join(p.handoffDir, 'event-store.json');
  try { fs.unlinkSync(storePath2) } catch (e) {}
  await engine.refresh(agent);
  const ovEmpty = engine.buildReadOverviewPre(agent);
  ok(ovEmpty === '', '★★★E-3f 空场景（无事件无白板）⇒ **零字节**（不占预算）', JSON.stringify(ovEmpty));
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
console.log('[v4-h3-e-read-overview] ' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail ? 1 : 0)