/**
 * #560 回归锁 —— `subagentTimeoutSeconds`（子代理等待上限）+ 可区分报错。
 *
 * ## 背景与**先决纠正**（本套件的第一件事就是把这个写死）
 * issue #560 与派活任务书都断言「`_runSubagentOnce` 有 90000ms = 90s 硬超时，长日志必然超时」。
 * 实测**不成立**：旧写法 `Math.max(_tRaw || 90000, 1000)` 里的 `|| 90000` 是**死代码** ——
 * 走到 `Math.max(...)` 那一支时 `_tRaw` 必为「有限且 > 0」；`_tRaw || 90000` 只在 `_tRaw === 0`
 * 时取 90000，而 0 已被 `_noTimeout` 拦走 ⇒ **永不取到**。未传 timeoutMs ⇒ NaN ⇒ `_noTimeout`
 * ⇒ `tMs = 0`、`timer = null` ⇒ **根本不注册定时器**（不是 90s，也不是任何值）。
 * ⇒ 因此「把 `|| 90000` 改读配置」会**给一条原本无上限的链路新加 240s 上限**（行为反向变化）。
 *   本批的正确语义是：
 *     · 显式给 timeoutMs（含 Infinity / <=0）⇒ **完全沿用旧语义**（Infinity 走不注册定时器）；
 *     · **未给**（undefined / null）⇒ 读 `subagentTimeoutSeconds`，夹到 30–900 后生效。
 *
 * ## 本套件钉住的判据（全部真执行，无一条靠读源码字符串当功能证据）
 *   A. 真构造 engine 读 `config.subagentTimeoutSeconds` = 240，且该键**在 DEFAULT_CONFIG 白名单内**；
 *   B. 真跑 `_runSubagentOnce` 抓**全局 setTimeout 实参**：未给值时注册 240000（实测值）；
 *   C. 负路径夹取：5000 → 900000、10 → 30000、非数值 → 240000（全部给实测毫秒）；
 *   D. ★Infinity 负路径：传 POSITIVE_INFINITY 时**不注册任何定时器**，不得被夹成 900；
 *   E. 产物侧设置页：从 **lib/client.js 的生成产物**里真解析 min/max/默认值（不是断言源码含串）；
 *   F. 可区分报错：超时 / 无正文 两条文案真跑 `consolidateMemory` 拿到并断言**互不相同且各自可行动**；
 *   G. 变异反向验证（在**副本**里做，不就地改生产文件）——见文件尾。
 *
 * 运行：node tests/smoke/smoke-test-subagent-timeout-560.mjs
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { MemoryEngine, apply } from '../lib/audit-engine.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../..')
let pass = 0, fail = 0
const ok = (c, n, extra) => {
  if (c) { pass++; console.log('  ok - ' + n) }
  else { fail++; console.error('  FAIL - ' + n + (extra === undefined ? '' : ' :: ' + JSON.stringify(extra))) }
}

// ══════════ 夹具：真构造 engine（走真实 DEFAULT_CONFIG 合并路径）══════════
const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'dam-560-'))
const realTimeout = globalThis.setTimeout
const realInterval = globalThis.setInterval
let engine = null
const requested = [];
let spawnCount = 0;
let nextOutput = [{ type: 'text', text: '[PROJECT]\n- x' }];
let neverResolve = false;

try {
  process.env.DSH_HOME = root
  await fsp.writeFile(path.join(root, 'dsh-auto-memory.json'), JSON.stringify({ memoryRoot: path.join(root, 'memory') }))
  const prevLoad = MemoryEngine.prototype.loadConfigSync
  MemoryEngine.prototype.loadConfigSync = function () { engine = this; return prevLoad.call(this) }
  globalThis.setInterval = globalThis.setTimeout = (cb, ms) => ({ callback: cb, ms, unref() {} })
  apply({
    get: () => undefined, credentials: {}, on: () => {},
    systemPrompt: { context: () => () => {}, section: () => () => {} },
    tools: { register: () => () => {} },
    webServer: { register: () => () => {} },
    effect: () => {},
  }, {})
  globalThis.setTimeout = realTimeout;
  globalThis.setInterval = realInterval;
  assert.ok(engine, 'engine must be constructed during apply()')

  // 桩 subagents：记录调用并返回可控结果
  engine._subagents = {
    list: () => ['spawn'],
    startActivation: async () => {
      spawnCount++;
      return {
        childId: 'c1', messageId: 'm1', dispose: () => {},
        result: neverResolve ? new Promise(() => {}) : Promise.resolve({ output: nextOutput }),
      };
    },
  };
  engine._workbenchReady = true;
  engine._readWorkbench = async () => ({});
  engine.wbOwnerOf = () => 'current';
  engine._wbTokenOf = () => '';
  engine._workbenchParent = { session: { id: 'sid-560' }, ctx: { get: () => undefined } };
  engine._subagentCircuit = null;

  /** 跑一次 _runSubagentOnce，返回它向全局 setTimeout 请求过的**长定时器**毫秒表。
   *  ★为什么可能是 2 条：生产代码里同一等待上限被注册**两次**——① _runSubagentOnce 的 abort 定时器
   *  （超时即 controller.abort）② withTimeout(run.result, tMs, null) 的结果兜底。两者同源同值，
   *  这是既有实现（不是本批引入），故判据写成「非空 + 每一条都等于期望值」。 */
  const trial = async (timeoutMs, cfgSec) => {
    if (cfgSec !== undefined) engine.config.subagentTimeoutSeconds = cfgSec;
    requested.length = 0;
    engine._subagentInflight = 0;
    engine._subagentCircuit = null;
    globalThis.setTimeout = (cb, ms, ...a) => { requested.push(ms); return realTimeout(cb, ms, ...a) };
    try {
      await Promise.race([
        engine._runSubagentOnce('probe', 'auto-memory-consolidate-logs', null, timeoutMs),
        new Promise((r) => realTimeout(r, 400)),
      ]);
    } finally { globalThis.setTimeout = realTimeout }
    // 只保留 >=1000ms 的长定时器：短的是去抖/退避，与本判据无关
    return requested.filter((ms) => ms >= 1000);
  };

  // ══════════ A 组：DEFAULT_CONFIG 实测值 ══════════
  console.log('A 组：真构造 engine 后读默认配置（不是读源码字符串）')
  ok(engine.config.subagentTimeoutSeconds === 240,
    'A1 subagentTimeoutSeconds 默认 = 240（实测 engine.config）', engine.config.subagentTimeoutSeconds)
  ok(Object.prototype.hasOwnProperty.call(engine.config, 'subagentTimeoutSeconds'),
    'A2 该键真在配置对象上（hasOwnProperty，不是 undefined 真值判断）')
  ok(engine.config.autoContinueRefreshTimeoutSeconds === 240,
    'A3 ★未越界：autoContinueRefreshTimeoutSeconds 仍是 240（另一条链路，本批一个字都没动）',
    engine.config.autoContinueRefreshTimeoutSeconds)

  // ══════════ B 组：未显式给值 ⇒ 用配置（实测毫秒） ══════════
  console.log('B 组：未传 timeoutMs 时真的按配置注册定时器')
  const same = (arr, want) => arr.length >= 1 && arr.every((v) => v === want)
  const defaultMs = await trial(undefined);
  ok(same(defaultMs, 240000),
    'B1 未传 timeoutMs ⇒ 注册 240000ms（实测：默认 240 秒 × 1000）', defaultMs)
  const cfgMs = await trial(undefined, 500);
  ok(same(cfgMs, 500000),
    'B2 配置改成 500 ⇒ 注册 500000ms（配置真的驱动了等待上限，不是写死）', cfgMs)

  // ══════════ C 组：负路径夹取（给实测值） ══════════
  console.log('C 组：越界夹取 —— 给夹取后的实测毫秒')
  const hi = await trial(undefined, 5000);
  ok(same(hi, 900000), 'C1 传 5000 ⇒ 夹到 900 秒 = 900000ms（实测）', hi)
  const lo = await trial(undefined, 10);
  ok(same(lo, 30000), 'C2 传 10 ⇒ 夹到 30 秒 = 30000ms（实测）', lo)
  const bad = await trial(undefined, 'not-a-number');
  ok(same(bad, 240000), 'C3 传非数值 ⇒ 回落 240 秒 = 240000ms（实测）', bad)
  const nan = await trial(undefined, Number.NaN);
  ok(same(nan, 240000), 'C4 传 NaN ⇒ 回落 240 秒 = 240000ms（实测）', nan)

  // ══════════ D 组：★Infinity 负路径（2026-10-26 回归的守护） ══════════
  console.log('D 组：Infinity 不得被夹成 900，必须仍走「不注册定时器」')
  const inf = await trial(Number.POSITIVE_INFINITY);
  ok(inf.length === 0, 'D1 传 POSITIVE_INFINITY ⇒ 一个长定时器都不注册（实测为空表），绝不能被夹成 900000', inf)
  const zero = await trial(0);
  ok(zero.length === 0, 'D2 传 0 ⇒ 同旧语义「不设超时」= 不注册定时器（实测为空表）', zero)

  // ══════════ E 组：从**生成产物**真解析设置页 min/max/默认 ══════════
  console.log('E 组：从 lib/client.js 生成产物里真解析字段属性（不是断言源码含串）')
  const clientSrc = fs.readFileSync(path.join(ROOT, 'lib/client.js'), 'utf8').replace(/\r\n/g, '\n')
  // 只从**生成区**里取（ITER5-GENERATED 块），证明字段真进了产物而不只是真源
  const gBegin = clientSrc.indexOf('    // ITER5-GENERATED:BEGIN\n');
  const gEnd = clientSrc.indexOf('    // ITER5-GENERATED:END\n');
  ok(gBegin > 0 && gEnd > gBegin, 'E0 生成区标记存在（前提）')
  const genBlock = clientSrc.slice(gBegin, gEnd);
  const m = genBlock.match(/type: 'number', min: (\d+), max: (\d+), value: cfg\.subagentTimeoutSeconds === undefined \? (\d+) :/);
  ok(!!m, 'E1 生成产物里真有 subagentTimeoutSeconds 的 number 输入框（正则解析成功）')
  ok(m && Number(m[1]) === 30, 'E2 产物里 min = 30（解析值）', m && m[1])
  ok(m && Number(m[2]) === 900, 'E3 产物里 max = 900（解析值）', m && m[2])
  ok(m && Number(m[3]) === 240, 'E4 产物里默认值 = 240（解析值）', m && m[3])
  ok(genBlock.includes("set('subagentTimeoutSeconds'"), 'E5 产物里控件真的写这个键（可存下来）')

  // ══════════ F 组：可区分报错（超时 vs 模型没出正文） ══════════
  console.log('F 组：memory_consolidate 的失败文案必须可区分、可行动')
  // 需要至少一天有内容的日志，否则会先命中「没有可提炼的内容」。
  // ★日志文件名必须匹配 DATE_RE（YYYY-MM-DD.md），否则 listDailyLogs 返回空 ⇒
  //   consolidateMemory 会先命中「没有日志」分支，永远走不到失败文案（首版即栽在这里）。
  const pj = await engine.resolvePaths({})
  await fsp.mkdir(pj.projectDir, { recursive: true })
  const todayLog = engine.memToday() + '.md'
  await fsp.writeFile(path.join(pj.projectDir, todayLog), '# 今日\n- 有内容的一行\n', 'utf8')
  const seen2 = await engine.listDailyLogs(pj.projectDir, 60)
  assert.ok(seen2.length >= 1, '夹具：日志文件必须被 listDailyLogs 识别（实测 ' + seen2.length + ' 篇，文件名 ' + todayLog + '）')

  // F1：模型正常返回但**没有 text 块** ⇒ 必须报「没有正文」，且**不得**报超时
  neverResolve = false
  nextOutput = [{ type: 'reasoning', text: 'only thinking' }]
  engine.config.subagentTimeoutSeconds = 240
  engine._subagentLastTimeout = false
  let msgNoText = ''
  try { msgNoText = await engine.consolidateMemory(null, 1) } catch (e) { msgNoText = 'THREW: ' + e.message }
  ok(/没有正文/.test(msgNoText), 'F1 「0 个 text 块」⇒ 报「没有正文」（实测文案）', msgNoText)
  // ★不能简单地禁止「超时」二字：无正文那条文案**必须**提到超时（「这不是超时，调大超时无效」），
  //   那是给用户的可行动指引。判据要认的是**走了哪一支**，故比对超时支路独有的措辞。
  ok(!/秒内没有返回/.test(msgNoText), 'F1b 无正文那条**不走**超时支路（无「N 秒内没有返回」）', msgNoText)
  ok(/调大超时无效/.test(msgNoText), 'F1c 且给出可行动指引「调大超时无效」（不是让用户瞎调）', msgNoText)

  // ★F2pre：**真超时**下标记是否真的被置位（不是靠读源码认定）——
  //   把配置压到下限 30 秒会太慢，故直接用可控时钟：把 setTimeout 换成「登记 + 立即 flush」。
  //   这里验的是「abort 定时器触发 ⇒ _subagentLastTimeout 变 true」这一条因果。
  {
    const origST = globalThis.setTimeout
    const reg = []
    globalThis.setTimeout = (cb, ms, ...a) => { reg.push({ cb, ms }); return origST(() => {}, 0) }
    engine._subagentInflight = 0
    engine._subagentCircuit = null
    engine._subagentLastTimeout = false
    neverResolve = true
    let p
    try {
      p = engine._runSubagentOnce('x', 'auto-memory-consolidate-logs', null)
      await new Promise((r) => origST(r, 60))
      const abortTimer = reg.find((x) => x.ms === 240000)
      ok(!!abortTimer, 'F0a 未给值时为 abort 定时器登记了 240000ms（前提）', reg.map((x) => x.ms))
      ok(engine._subagentLastTimeout === false, 'F0b 定时器**未触发**时标记保持 false（不预先置位）')
      if (abortTimer) abortTimer.cb()
      ok(engine._subagentLastTimeout === true, 'F0c ★abort 定时器真正触发后标记变 true ⇒「超时」有真实事实来源')
    } finally {
      globalThis.setTimeout = origST
      neverResolve = false
      try { await Promise.race([p, new Promise((r) => origST(r, 100))]) } catch (e) {}
    }
  }

  // F2：真超时 ⇒ 必须报「超时」并指向配置项
  neverResolve = true
  engine.config.subagentTimeoutSeconds = 30
  requested.length = 0
  engine._subagentInflight = 0
  engine._subagentCircuit = null
  globalThis.setTimeout = (cb, ms, ...a) => { requested.push(ms); return realTimeout(cb, ms, ...a) }
  let msgTimeout = ''
  try {
    // 直接把「超时」这一事实注入：生产里由 abort 定时器置位，这里等价地置位后调用，
    // 避免真的等 30 秒（判据对象是**文案分支**，不是定时器本身 —— 定时器已由 D 组覆盖）。
    const origRun = engine.runSubagent.bind(engine)
    engine.runSubagent = async function () { this._subagentLastTimeout = true; return '' }
    msgTimeout = await engine.consolidateMemory(null, 1)
    engine.runSubagent = origRun
  } catch (e) { msgTimeout = 'THREW: ' + e.message } finally { globalThis.setTimeout = realTimeout }
  ok(/超时/.test(msgTimeout), 'F2 超时分支 ⇒ 报「超时」（实测文案）', msgTimeout)
  ok(/subagentTimeoutSeconds/.test(msgTimeout), 'F2b 文案里点名配置键 subagentTimeoutSeconds（可行动）', msgTimeout)
  ok(/\b30\b/.test(msgTimeout), 'F2c 并报出当前生效值 30（用户知道现在是多少）', msgTimeout)
  ok(msgTimeout !== msgNoText, 'F3 ★两条文案**必须不同**（这正是 issue 要求的可区分）')
  neverResolve = false


} finally {
  // 清理：引擎在 Windows 上可能仍持有临时目录句柄（ENOTEMPTY）。
  // 清理失败**不得**冒泡成 uncaughtException —— 它会盖掉真正的 PASS/FAIL 汇总。
  try { await fsp.rm(root, { recursive: true, force: true, maxRetries: 5 }) } catch (eCl) {}
}

// ══════════ G 组：变异反向验证（在**副本**里做，绝不就地改生产文件） ══════════
//   两条必红：
//     ① 去掉 clamp ⇒ C 组（越界夹取）必红；
//     ② 去掉「超时 vs 无正文」的区分 ⇒ F 组（可区分）必红。
//   ★变异必须让**语义失效而非结构崩塌**：整段切除会让断言塌成「定位失败」，那是假红。
//     定位一律用 indexOf/slice，**禁用跨行正则**（CRLF 下 . 不匹配 \r，正则静默不命中会造假绿）。
//   ★副本落在 **lib/ 内**：被测模块走相对 import（from './x.js'），挪到别处即 ERR_MODULE_NOT_FOUND。
//   ★怎么让副本生效：`tests/lib/audit-engine.mjs` 已支持 `DAM_AUDIT_ENGINE_SOURCE` 环境变量指定源文件
//     （见其第 7 行）⇒ 直接用它，**不要复制套件源码做字符串替换** ——
//     首版就是那样做的，替换串恰好也命中了变异装置自身的文本，把装置改坏 ⇒ 报的是 SyntaxError 的假红。
if (!process.env.DAM560_MUTATION) {
  console.log('G 组：变异反向验证（副本内进行）')
  const PROD = path.join(ROOT, 'lib/index.js')
  const prodSrc = fs.readFileSync(PROD, 'utf8')
  const SELF = fileURLToPath(import.meta.url)

  const runMutation = (label, mutate, tag) => {
    let mutated
    try {
      mutated = mutate(prodSrc)
    } catch (e) {
      // ★变异装置自身失败 ⇒ 记为一条 FAIL 并返回「红」，不抛未捕获异常
      //   （抛出去会让本套件 exit 0 却带 uncaughtException，撞假绿防线，属噪声）
      ok(false, '[' + label + '] 变异装置定位失败：' + (e && e.message))
      return { status: 1, out: '' }
    }
    assert.notEqual(mutated, prodSrc, '[变异装置] ' + label + ' 必须真的改到源码（否则假红/假绿）')
    const mutIdx = path.join(ROOT, 'lib', '_index_mut560_' + tag + '.mjs')
    try {
      fs.writeFileSync(mutIdx, mutated, 'utf8')
      const r = spawnSync(process.execPath, [SELF], {
        cwd: ROOT, encoding: 'utf8', timeout: 180000,
        env: { ...process.env, DAM560_MUTATION: '1', DAM_AUDIT_ENGINE_SOURCE: mutIdx },
      })
      return { status: r.status, out: (r.stdout || '') + (r.stderr || '') }
    } finally { try { fs.rmSync(mutIdx, { force: true }) } catch (e) {} }
  }

  // ── 变异 ①：去掉 clamp（直接取值，不再夹到 30–900）──
  const CLAMP_ANCHOR = '      ? Math.min(SUBAGENT_TIMEOUT_MAX_SECONDS, Math.max(SUBAGENT_TIMEOUT_MIN_SECONDS, _cfgSecRaw))'
  const m1 = runMutation('去掉 clamp', (src) => {
    const i = src.indexOf(CLAMP_ANCHOR)
    assert.ok(i >= 0, '[变异装置] clamp 锚点必须存在（命中 ' + i + '）——否则是定位失败，不是有效变异')
    return src.slice(0, i) + '      ? _cfgSecRaw' + src.slice(i + CLAMP_ANCHOR.length)
  }, 'm1')
  ok(m1.status !== 0, 'G1 ★变异①「去掉 clamp」⇒ 套件必红（实测 exit=' + m1.status + '）')
  ok(/FAIL - C1/.test(m1.out), 'G1b 且红在 C1（5000 应夹到 900 却原样放过）⇒ 负路径断言真的抓到了它')
  // ★子进程可能带 Windows 上已知的 libuv 退出断言（UV_HANDLE_CLOSING）而以非 1 退出码收尾；
  //   判据要求它**跑到了汇总行**，证明红来自断言而不是进程半路崩掉。
  ok(/PASS \d+ \/ FAIL \d+/.test(m1.out), 'G1d 子进程跑到了 PASS/FAIL 汇总行 ⇒ 红是断言给的，不是半路崩的')
  ok(!/SyntaxError|ERR_MODULE_NOT_FOUND/.test(m1.out), 'G1c ★红不是语法/解析崩（那是假红，不是语义失效）')

  // ── 变异 ②：去掉「超时 vs 无正文」的区分（合并回原来那句）──
  const m2 = runMutation('去掉报错区分', (src) => {
    const start = src.indexOf('      if (_timedOut) {')
    assert.ok(start >= 0, '[变异装置] 区分分支起点必须存在（命中 ' + start + '）')
    const endMark = '请重试一次并检查模型路由与并发占用。"'
    const end = src.indexOf(endMark, start)
    assert.ok(end > start, '[变异装置] 区分分支终点必须存在（命中 ' + end + '）')
    const merged = '      return "memory_consolidate: AI 提炼失败(超时或 subagent 不可用),未写入任何内容。"'
    return src.slice(0, start) + merged + src.slice(end + endMark.length + 1)
  }, 'm2')
  ok(m2.status !== 0, 'G2 ★变异②「去掉报错区分」⇒ 套件必红（实测 exit=' + m2.status + '）')
  ok(/FAIL - F1/.test(m2.out), 'G2b 且红在 F1（0 个 text 块应报「没有正文」却报成合并句）⇒ 区分数断言真的抓到了它')
  ok(/PASS \d+ \/ FAIL \d+/.test(m2.out), 'G2d 子进程跑到了 PASS/FAIL 汇总行 ⇒ 红是断言给的')
  ok(!/SyntaxError|ERR_MODULE_NOT_FOUND/.test(m2.out), 'G2c ★红不是语法/解析崩（那是假红）')
  ok(m1.out !== m2.out, 'G3 两次变异红在**不同**断言上（各自独立，不是同一处崩）')
}

console.log('PASS ' + pass + ' / FAIL ' + fail)
process.exit(fail === 0 ? 0 : 1)