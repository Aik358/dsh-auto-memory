#!/usr/bin/env node
/**
 * smoke-test-issue536-false-green.mjs —— #536：测试收尾抛异常却 exit 0（假绿防线）。
 *
 * ============================ 两条根因 ============================
 * 根因①（个案）：tests/smoke/smoke-test-v4-h10-curate-apply.mjs:231-233 把保存成
 *   `interval/timeout/fetch` 的引用恢复成 `iv/to/fe` —— 三个名字从未定义 ⇒ 每次跑都抛
 *   `ReferenceError: iv is not defined`。
 * 根因②（**结构性的，才是重点**）：lib/index.js:19774 插件 apply() 挂的
 *   `process.on('uncaughtException')` 是**生产容错**（不能禁），但它只记日志不改退出码 ⇒
 *   **任何**套件在收尾阶段抛异常都会被吞掉 ⇒ 子进程 exit 0 ⇒ 回归判 PASS。
 *   实测：`node <h10套件>; echo $?` ⇒ **0**，stderr 里却有 ReferenceError。
 *
 * ============================ 本套件的验收（故障注入，真起子进程）============================
 *  C-1 正常运行：完整汇总、无 ReferenceError、**exit 0**
 *  C-2 **主测试体故意抛错 ⇒ exit 非 0**（子进程真跑）
 *  C-3 **finally/清理阶段故意抛错 ⇒ exit 非 0**
 *  C-4 失败路径仍恢复能恢复的全局状态、清理临时资源
 *  C-5 运行器边界：**未接入护栏**的旧式套件抛异常 ⇒ tools/run-smoke 判 FAIL（不只靠 opt-in）
 *  C-6 不变生产行为：插件仍挂着 uncaughtException 处理器，且**未被移除**
 *  MUT-536a 把 :231-233 改回 iv/to/fe ⇒ C-1 必红（子进程 exit 1）
 *  MUT-536b 撤掉运行器边界判据 ⇒ C-5 必红（假绿复现）
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const HERE = path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1')
const ROOT = path.resolve(HERE, '..', '..')
const SMOKE = path.join(ROOT, 'tests', 'smoke')
const LIB = path.join(ROOT, 'lib')
const H10 = path.join(SMOKE, 'smoke-test-v4-h10-curate-apply.mjs')
const RUNNER = path.join(ROOT, 'tools', 'run-smoke.mjs')
const GUARD = path.join(SMOKE, '_exit-guard.mjs')

let pass = 0, fail = 0, skip = 0
const ok = (c, name, d) => { if (c) { pass++; console.log('  ok   - ' + name + (d ? '  :: ' + d : '')) } else { fail++; console.error('  FAIL - ' + name + (d ? '  :: ' + d : '')) } };
const skipped = (name, why) => { skip++; console.log('  SKIP - ' + name + '  :: ' + why) };

const tmpRoot = fs.mkdtempSync(path.join(process.env.TEMP || '/tmp', 'dam-536-'));
process.on('exit', () => { try { fs.rmSync(tmpRoot, { recursive: true, force: true }) } catch (_) {} });

/** 真起子进程跑一个脚本，拿到**真实退出码**与输出。 */
function runNode(file, env) {
  const r = spawnSync(process.execPath, [file], {
    cwd: ROOT, encoding: 'utf8', timeout: 180000,
    env: Object.assign({}, process.env, env || {}),
  });
  return { code: r.status, out: String(r.stdout || ''), err: String(r.stderr || '') };
}

// ══════════════════════════════════════════════════════════════
console.log('[C-0] 修后的根因①：源码里不再出现 iv/to/fe 三个未定义名');
// ══════════════════════════════════════════════════════════════
{
  const src = fs.readFileSync(H10, 'utf8');
  const codeLines = src.split(/\r?\n/);
  const bad = codeLines.map((l, i) => ({ l, n: i + 1 }))
    .filter((x) => !/^\s*(\/\/|\*)/.test(x.l))
    .filter((x) => /\bglobalThis\.(setInterval|setTimeout|fetch)\s*=\s*(iv|to|fe)\b/.test(x.l));
  ok(bad.length === 0, 'C-0a 代码行里没有 `globalThis.X = iv|to|fe`（未定义引用已清除）', 'hit=' + bad.length + (bad[0] ? ' @L' + bad[0].n : ''));
  ok(/globalThis\.setInterval = interval/.test(src), 'C-0b 恢复语句用的是实际保存的 `interval`');
  ok(/globalThis\.setTimeout = timeout/.test(src), 'C-0c 恢复语句用的是实际保存的 `timeout`');
  ok(/globalThis\.fetch = fetch/.test(src), 'C-0d 恢复语句用的是实际保存的 `fetch`');
  ok(src.indexOf('installExitGuard') > 0, 'C-0e 套件已接入 _exit-guard（测试侧护栏）');
}

// ══════════════════════════════════════════════════════════════
console.log('[C-1] 正常运行：完整汇总 + 无 ReferenceError + **exit 0**');
// ══════════════════════════════════════════════════════════════
{
  const r = runNode(H10);
  ok(r.code === 0, '★★C-1a 修后 exit code === 0（这是 issue 要求的正常路径）', 'code=' + r.code);
  ok(!/ReferenceError/.test(r.out + r.err), '★★C-1b 输出里**不再有** ReferenceError', (/ReferenceError/.test(r.out + r.err) ? (r.err.match(/ReferenceError[^\n]*/) || [''])[0] : 'clean'));
  ok(/viv|PASS/.test(r.out.replace(/viv/g, 'PASS')) || /PASS/.test(r.out), 'C-1c 有完整汇总（含 PASS/FALSE 计数行）', (r.out.split('\n').filter((l) => /PASS \/.*FAIL/.test(l))[0] || '').slice(0, 90));
  ok(/exit-guard: no fatal test exception/.test(r.out), 'C-1d 护栏自报「无致命测试异常」', (r.out.split('\n').filter((l) => /exit-guard:/.test(l))[0] || '').slice(0, 90));
}

// ══════════════════════════════════════════════════════════════
console.log('[C-2] 故障注入：**主测试体**抛错 ⇒ 退出码必须非 0');
// ══════════════════════════════════════════════════════════════
{
  const f = path.join(tmpRoot, 'inject-body.mjs');
  fs.writeFileSync(f, [
    "import { installExitGuard } from " + JSON.stringify(pathToFileURL(GUARD).href) + "",
    "const G = installExitGuard({ suite: 'inject-body' })",
    "try {",
    "  console.log('body start')",
    "  throw new Error('INJECTED: body failure')",
    "} finally {",
    "  console.log('[guard] ' + G.summary())",
    "}",
    "console.log('SHOULD NOT REACH HERE')",
    "process.exit(0)   // ★故意写 exit 0：护栏必须能压过它",
  ].join('\n'), 'utf8');
  const r = runNode(f);
  ok(r.code !== 0, '★★C-2a 主测试体抛错 ⇒ **exit 非 0**（不是只在日志里写一句）', 'code=' + r.code);
  ok(/INJECTED: body failure/.test(r.out + r.err), 'C-2b 异常信息可见（stderr 或 stdout）');
  ok(!/SHOULD NOT REACH HERE/.test(r.out), 'C-2c 抛错后的语句未被执行（真中断）');
}

// ══════════════════════════════════════════════════════════════
console.log('[C-3] 故障注入：**finally/清理阶段**抛错 ⇒ 退出码必须非 0');
// ══════════════════════════════════════════════════════════════
{
  const f = path.join(tmpRoot, 'inject-finally.mjs');
  fs.writeFileSync(f, [
    "import { installExitGuard, guardCleanup } from " + JSON.stringify(pathToFileURL(GUARD).href) + "",
    "const G = installExitGuard({ suite: 'inject-finally' })",
    "try { console.log('body ok') }",
    "finally {",
    "  guardCleanup(G, 'cleanup-throws', () => { throw new Error('INJECTED: cleanup failure') })",
    "  guardCleanup(G, 'cleanup-ok', () => { console.log('second cleanup still ran') })",
    "  console.log('[guard] ' + G.summary())",
    "}",
    "process.exit(0)   // ★同样故意 exit 0",
  ].join('\n'), 'utf8');
  const r = runNode(f);
  ok(r.code !== 0, '★★C-3a 清理阶段抛错 ⇒ **exit 非 0**', 'code=' + r.code);
  ok(/INJECTED: cleanup failure/.test(r.out + r.err), 'C-3b 清理失败信息可见');
  ok(/second cleanup still ran/.test(r.out), '★C-3c 第一个清理炸了，**后续清理仍执行**（不是一炸全停）');
  ok(/cleanup\/cleanup-throws/.test(r.out), 'C-3d 护栏记账里点名了失败的清理步骤', (r.out.split('\n').filter((l) => /fatal test exception/.test(l))[0] || '').slice(0, 100));
}

// ══════════════════════════════════════════════════════════════
console.log('[C-4] 失败路径仍恢复全局、清理临时资源');
// ══════════════════════════════════════════════════════════════
{
  const f = path.join(tmpRoot, 'inject-restore.mjs');
  const marker = path.join(tmpRoot, 'cleanup-happened.txt');
  fs.writeFileSync(f, [
    "import fs from 'node:fs'",
    "import { installExitGuard, guardCleanup } from " + JSON.stringify(pathToFileURL(GUARD).href) + "",
    "const G = installExitGuard({ suite: 'inject-restore' })",
    "const orig = globalThis.setInterval",
    "globalThis.setInterval = () => ({ unref() {} })",
    "try {",
    "  throw new Error('INJECTED: body dies')",
    "} finally {",
    "  guardCleanup(G, 'restore', () => { globalThis.setInterval = orig })",
    "  guardCleanup(G, 'verify-restored', () => {",
    "    if (globalThis.setInterval !== orig) throw new Error('global not restored')",
    "    fs.writeFileSync(" + JSON.stringify(marker) + ", 'restored=' + (globalThis.setInterval === orig))",
    "  })",
    "}",
    "process.exit(0)",
  ].join('\n'), 'utf8');
  const r = runNode(f);
  ok(r.code !== 0, 'C-4a 仍然非零退出', 'code=' + r.code);
  ok(fs.existsSync(marker), '★★C-4b 清理阶段**真的执行了**（成功恢复了全局并留下证据文件）', fs.existsSync(marker) ? fs.readFileSync(marker, 'utf8') : 'marker missing');
}

// ══════════════════════════════════════════════════════════════
console.log('[C-5] 运行器边界：**未接入护栏**的旧式套件抛异常 ⇒ run-smoke 必须判 FAIL');
// ══════════════════════════════════════════════════════════════
{
  // 造一个「旧式」套件：只依赖插件容错、自己不接护栏 —— 这正是全仓 550 个历史套件的形态
  // ★首版夹具写错（已修）：没调 apply() 时异常**自然传播** ⇒ exit 天然非零 ⇒ 根本没复现假绿。
  //   必须像 h10 一样真调 apply() 让插件挂上 uncaughtException，才是「被吞掉」的真实场景。
  const legacyName = 'smoke-test-zz-inject-legacy-#536.mjs';
  const legacyFile = path.join(SMOKE, legacyName);
  const runnerSrc = fs.readFileSync(RUNNER, 'utf8');
  const hasDefense = /FATAL_MARKERS/.test(runnerSrc) && /fatalMarkerIn/.test(runnerSrc);
  ok(hasDefense, 'C-5a 运行器已具备致命标记判据（FATAL_MARKERS + fatalMarkerIn）');
  // ★首版踩坑（已修）：判据一度连 **stdout** 一起扫 ⇒ 把「套件 echo 证据」误判成假绿（本套件自己先中招）。
  //   正解：插件处理器写 stderr，只在 stderr 上找。
  // ★2026-11-05（用户裁定 · 显式标记前缀）· 判据修正（C 类）：close 分支的调用形态由
  //   `fatalMarkerIn(err)`（单值）升级为 `scanFatalLines(err)`（按行扫描 + 信用抵扣）。
  //   **判据意图完全不变**：仍然只在 **stderr** 上找致命标记、绝不用 stdout。
  //   ⇒ 断言对象随之改为「close 分支调用的是接受 stderr 的扫描入口」。
  const closeBlock = runnerSrc.slice(runnerSrc.indexOf("child.on('close'"), runnerSrc.indexOf("child.on('close'") + 900);
  ok(/scanFatalLines\(err\)|fatalMarkerIn\(err\)/.test(closeBlock), '★C-5a2 close 分支用 stderr 判据（scanFatalLines/fatalMarkerIn 均接受 err）');
  ok(!/scanFatalLines\(out\)|fatalMarkerIn\(out\)/.test(closeBlock), '★C-5a3 close 分支**不**用 stdout 判据（否则套件 echo 证据会被误判）');
  try {
    fs.writeFileSync(legacyFile, [
      "import { apply, MemoryEngine } from '../lib/state-engine.mjs'",
      "const iv = globalThis.setInterval, to = globalThis.setTimeout, fe = globalThis.fetch",
      "const load = MemoryEngine.prototype.loadConfigSync",
      "globalThis.setInterval = globalThis.setTimeout = () => ({ unref() {} })",
      "globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({}) })",
      "MemoryEngine.prototype.loadConfigSync = function () { return load.call(this) }",
      "apply({ get: () => undefined, on: () => () => {}, systemPrompt: { context: () => () => {}, section: () => () => {} }, tools: { register: () => () => {} }, webServer: { register: () => () => {} }, effect: (f) => { f() } }, {})",
      "globalThis.setInterval = iv; globalThis.setTimeout = to; globalThis.fetch = fe",
      "MemoryEngine.prototype.loadConfigSync = load",
      "// ★等价于 h10 的 :231 —— 插件已挂 uncaughtException，这行抛错会被吞掉",
      "globalThis.setInterval = NOT_DEFINED_LEGACY_MARKER",
      "console.log('[legacy] ALL PASS — PASS=1 FAIL=0')",
      "process.exit(0)   // 旧式套件：自己报绿，异常已被插件吞掉 ⇒ 假绿",
    ].join('\n'), 'utf8');
    const r = spawnSync(process.execPath, [RUNNER, '--filter=inject-legacy-#536', '--jobs=1', '--lanes=off'], {
      cwd: ROOT, encoding: 'utf8', timeout: 180000,
    });
    const all = String(r.stdout || '') + String(r.stderr || '');
    ok(/FAIL/.test(all) && !/\[PASS   \] smoke-test-zz-inject-legacy/.test(all),
      '★★★C-5b **未接入护栏**的旧式套件（exit 0 + 抛过异常）被运行器判 FAIL', (all.split('\n').filter((l) => /inject-legacy/.test(l)).join(' ; ') || '').slice(0, 170));
    ok(/假绿防线命中/.test(all), '★★C-5c 输出里点名「假绿防线命中」并给出命中的标记', (all.split('\n').filter((l) => /假绿防线命中/.test(l))[0] || '').slice(0, 130));
    ok(r.status !== 0, '★C-5d 运行器自身退出码非零（回归不会静默放行）', 'runnerExit=' + r.status);
  } finally {
    try { fs.unlinkSync(legacyFile) } catch (_) {}
  }
  ok(!fs.existsSync(legacyFile), 'C-5e 注入的临时套件已删除（未污染 tests/smoke）');
}

// ══════════════════════════════════════════════════════════════
console.log('[C-6] 未改变生产行为：插件仍挂 uncaughtException，且未被移除');
// ══════════════════════════════════════════════════════════════
{
  const idx = fs.readFileSync(path.join(LIB, 'index.js'), 'utf8');
  ok(/process\.on\('uncaughtException', hUncaught\)/.test(idx), '★C-6a 插件的生产容错处理器**仍在**（没有为了修 bug 去掉它）');
  ok(!/removeAllListeners\(\s*['"]uncaughtException/.test(idx), '★★C-6b 没有 `removeAllListeners(uncaughtException)` 这类改变生产行为的写法');
  const guardSrc = fs.readFileSync(GUARD, 'utf8');
  // ⚠只看**代码行**：头注里为了说明纪律写了「不得用 removeAllListeners(…)」，那是文档不是实现
  const guardCodeHits = guardSrc.split(/\r?\n/)
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .filter((l) => /removeAllListeners/.test(l));
  ok(guardCodeHits.length === 0, '★★C-6c 测试侧护栏的**代码**里没有 removeAllListeners（分层而非取代插件监听）', 'codeHits=' + guardCodeHits.length);
  // 运行时：插件挂完后，进程上应至少有 2 个 uncaughtException 监听器（插件 1 + 护栏 1）
  const h10src = fs.readFileSync(H10, 'utf8');
  ok(/installExitGuard\s*\(/.test(h10src) && /apply\(\{/.test(h10src), 'C-6d h10 里护栏与插件 apply 同时存在（两层监听，各司其职）');
}

// ══════════════════════════════════════════════════════════════
console.log('[MUT-536] 变异验证');
// ══════════════════════════════════════════════════════════════
{
  // ── 变异 A：把 :231-233 改回 iv/to/fe ⇒ C-1 应红（子进程 exit 非 0，且无完整汇总）──
  const orig = fs.readFileSync(H10, 'utf8');
  const mutFile = path.join(tmpRoot, 'h10-mut.mjs');
  const mutSrc = orig
    .replace('globalThis.setInterval = interval }', 'globalThis.setInterval = iv }')
    .replace('globalThis.setTimeout = timeout }', 'globalThis.setTimeout = to }')
    .replace('globalThis.fetch = fetch }', 'globalThis.fetch = fe }')
  const changed = mutSrc !== orig;
  ok(changed, 'MUT-536a-0 三个恢复点均已变异');
  if (changed) {
    // 副本放回 tests/smoke 下（套件用相对 import '../lib/...'）；文件名不匹配 smoke-test-* 也不会被 run-smoke 扫到
    const mutInSmoke = path.join(SMOKE, '_mut536-' + process.pid + '.mjs');
    try {
      fs.writeFileSync(mutInSmoke, mutSrc, 'utf8');
      const r = runNode(mutInSmoke);
      ok(r.code !== 0, '★★MUT-536a 改回 iv/to/fe ⇒ **exit 非 0**（假绿被消除；修前同类错误是 exit 0）', 'code=' + r.code);
      ok(/ReferenceError/.test(r.out + r.err) || /smoke-fatal/.test(r.err), '★MUT-536a-2 失败原因可见（ReferenceError 或 smoke-fatal 标记）', (r.err.split('\n').filter((l) => /ReferenceError|smoke-fatal/.test(l))[0] || '').slice(0, 110));
    } finally { try { fs.unlinkSync(mutInSmoke) } catch (_) {} }
  }
  ok(fs.readFileSync(H10, 'utf8') === orig, 'MUT-536a-3 产品源文件全程未被改动（变异只在副本上）');
}
{
  // ── 变异 B：撤掉运行器边界判据 ⇒ C-5b 应红（假绿复现）──
  const origRunner = fs.readFileSync(RUNNER, 'utf8');
  // ★变异副本必须放在 **tools/ 里**：run-smoke.mjs 用相对路径 import './smoke-impact.mjs'，
  //   换到别的目录会 ERR_MODULE_NOT_FOUND（同一坑在 #539 也踩过：相对 import 的模块不能挪窝）
  const mutRunner = path.join(ROOT, 'tools', '_run-smoke-mut536-' + process.pid + '.mjs');
  // ★判据随产线更新：现在 close 分支用的是 `fatalMarkerIn(err)`（只查 stderr，见 C-5a2/a3）
  // ★2026-11-05（用户裁定 · 显式标记前缀）· 判据修正（C 类）：锚串随产线演进同步更新。
  //   close 分支现形态（信用抵扣版）：
  //       const { violations, exempted } = scanFatalLines(err)
  //       if (violations.length) {
  //         return finish('FAIL', code, signal, violations[0] + …)
  //       }
  //       finish('PASS', code, signal, exempted ? … : undefined)
  //   摘除整块 ⇒ 假绿必然复现（C-5b 的语义未变）。
  //   ⚠️ 教训：**凡「按精确字符串摘除产线代码」的变异，产线一改就必须同步锚串**，
  //      否则 changedB=false、assert 恒红，看起来像产品 bug，实为判据过期。
  const reverted = origRunner.replace(
    "      // ★★2026-11-05（用户裁定）：按**行**扫，用 \`[smoke-expected-fatal]\` 信用抵扣。\n      //   没有任何套件被整体放行；只有「主动声明过的那几次异常」被抵扣。\n      const { violations, exempted } = scanFatalLines(err)\n      if (violations.length) {\n        return finish('FAIL', code, signal, violations[0] + (violations.length > 1 ? ' (+' + (violations.length - 1) + ' more)' : ''))\n      }\n      finish('PASS', code, signal, exempted ? 'exempted-expected-fatal:' + exempted : undefined)\n",
    '');
  const changedB = reverted !== origRunner;
  ok(changedB, 'MUT-536b-0 运行器判据已被摘除');
  if (changedB) {
    fs.writeFileSync(mutRunner, reverted, 'utf8');
    const legacyName2 = 'smoke-test-zz-inject-legacy2-#536.mjs';
    const legacyFile2 = path.join(SMOKE, legacyName2);
    try {
      fs.writeFileSync(legacyFile2, [
        "import { apply, MemoryEngine } from '../lib/state-engine.mjs'",
        "const load = MemoryEngine.prototype.loadConfigSync",
        "globalThis.setInterval = globalThis.setTimeout = () => ({ unref() {} })",
        "globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({}) })",
        "MemoryEngine.prototype.loadConfigSync = function () { return load.call(this) }",
        "apply({ get: () => undefined, on: () => () => {}, systemPrompt: { context: () => () => {}, section: () => () => {} }, tools: { register: () => () => {} }, webServer: { register: () => () => {} }, effect: (f) => { f() } }, {})",
        "globalThis.setInterval = NOT_DEFINED_LEGACY2",
        "process.exit(0)",
      ].join('\n'), 'utf8');
      const r = spawnSync(process.execPath, [mutRunner, '--filter=inject-legacy2-#536', '--jobs=1', '--lanes=off'], {
        cwd: ROOT, encoding: 'utf8', timeout: 180000,
      });
      const all = String(r.stdout || '') + String(r.stderr || '');
      // ★2026-11-05（显式标记前缀）· 判据修正（C 类），**不是放宽**：
      //   变异 B 的语义是「撤掉判据 ⇒ 该抛异常套件**不再被判 FAIL**」（假绿复现）。
      //   旧写法要求字面 `[PASS   ]`。但注入套件末尾是 `globalThis.setInterval = NOT_DEFINED_LEGACY2`，
      //   而插件生产处理器（uncaughtException）已挂上 ⇒ 异常被吞、进程**既不退出也不报错**
      //   ⇒ 撤掉判据后它会一直挂到 run-smoke 的 per-suite timeout，被记为 `[TIMEOUT]`。
      //   「TIMEOUT」同样证明**判据确实被摘掉了**（否则会因 stderr 有致命标记而立刻 FAIL）。
      //   故判据改为「**未出现 [FAIL] 对该注入套件的判定**」——这才是变异 B 要证明的东西。
      const _failLine = /\[FAIL   \] smoke-test-zz-inject-legacy2/.test(all)
      const _passOrTimeout = /\[PASS   \] smoke-test-zz-inject-legacy2/.test(all) || /\[TIMEOUT\] smoke-test-zz-inject-legacy2/.test(all)
      ok(!_failLine && _passOrTimeout,
        '★★MUT-536b 撤掉判据后，同一个抛异常的套件**不再被判 FAIL**（PASS 或 TIMEOUT 均说明防线已摘除）⇒ 证明 C-5b 抓的是真缺陷',
        (all.split('\n').filter((l) => /inject-legacy2/.test(l)).join(' ; ') || '').slice(0, 140));
    } finally { try { fs.unlinkSync(legacyFile2) } catch (_) {} }
  }
  try { fs.unlinkSync(mutRunner) } catch (_) {}
  ok(!fs.existsSync(mutRunner), 'MUT-536b-1 变异副本已删除（未污染 tools/）');
  ok(fs.readFileSync(RUNNER, 'utf8') === origRunner, 'MUT-536b-2 运行器源文件全程未被改动');
}

console.log('');
console.log('[536] ' + pass + ' PASS / ' + fail + ' FAIL / ' + skip + ' SKIP');
process.exit(fail ? 1 : 0)
