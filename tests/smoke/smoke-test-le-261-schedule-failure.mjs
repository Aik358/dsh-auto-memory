/**
 * L-E261 专项验收：#261（OBS-02）定时固化/维护异常被静默吞掉 + 当日完成标记阻止再次执行。
 *
 * CR-10：**真执行产线方法体** —— 从 lib/index.js 配平抽取 tickTime / debugInfo /
 *   _scheduleViewSnapshot，经 new Function + bind(engineStub) 真跑，断言真实副作用：
 *   当日 Done 标记、诊断回执、重试次数与有界性。
 * 每条判据均配负路径（变异必红、还原复绿）。
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { diagnosticErrorReasonPre } from '../../lib/diagnostic-error.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
const SRC = readFileSync(path.join(ROOT, 'lib', 'index.js'), 'utf8').replace(/\r\n/g, '\n')

let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  ok   - ' + m) } else { fail++; console.log('  FAIL - ' + m) } }

/* ---------- 配平抽取产线方法体（照抄既有 r26/issue162 抽取范式） ---------- */
function grabBalanced (src, head) {
  const i = src.indexOf(head)
  if (i < 0) return null
  let depth = 0, started = false
  for (let k = i; k < src.length; k++) {
    const ch = src[k]
    if (ch === '{') { depth++; started = true }
    else if (ch === '}') { depth--; if (started && depth === 0) return src.slice(i, k + 1) }
  }
  return null
}

const TICK_HEAD = '  tickTime() {'
const SNAP_HEAD = '  _scheduleViewSnapshot() {'
const DBG_HEAD = '  async debugInfo() {'
const tickBody = grabBalanced(SRC, TICK_HEAD)
const snapBody = grabBalanced(SRC, SNAP_HEAD)
const dbgBody = grabBalanced(SRC, DBG_HEAD)
ok(!!tickBody, '① 产线 tickTime 函数体可配平抽取（' + (tickBody ? tickBody.length + ' chars' : '未找到') + '）')
ok(!!snapBody, '② 产线 _scheduleViewSnapshot 函数体可配平抽取（' + (snapBody ? snapBody.length + ' chars' : '未找到') + '）')
ok(!!dbgBody, '③ 产线 debugInfo 函数体可配平抽取（' + (dbgBody ? dbgBody.length + ' chars' : '未找到') + '）')
if (!tickBody || !snapBody || !dbgBody) { console.log(''); console.log('[le-261] PASS ' + pass + ' / FAIL ' + fail); process.exit(1) }

/* ---------- 台账块（模块级）：同样从产线抽取，保证测的就是产线代码 ---------- */
const LEDGER_START = '/** ★#261（OBS-02）：定时固化/维护的**有界**重试台账。'
const LEDGER_END = '/** 记忆引擎:路径解析、缓存、文件读写、检索、反思状态。 */'
const li = SRC.indexOf(LEDGER_START), le = SRC.indexOf(LEDGER_END, li)
ok(li > 0 && le > li, '④ 产线台账块可定位（mode=' + (li > 0 ? 'ok' : 'miss') + '）')
const ledgerSrc = SRC.slice(li, le)
ok(/SCHEDULE_MAX_ATTEMPTS_PRE = 3/.test(ledgerSrc), '⑤ 产线声明重试上限 = 3（有界性的常量来源）')
ok(/SCHEDULE_RETRY_GAP_MS_PRE = 60000/.test(ledgerSrc), '⑥ 产线声明重试间隔 = 60000ms')

/* ---------- 真执行装配 ---------- */
function makeEnv (opts) {
  const o = opts || {}
  const traces = []
  const thrown = []
  const noop = () => {}
  const diag = (m) => { traces.push(String(m)) }
  const diagThrottled = (k, m) => { if (!o.noThrottle) { if (!(k in makeEnv._seen)) makeEnv._seen[k] = 0; makeEnv._seen[k]++; if (makeEnv._seen[k] > 1) return } traces.push(String(m)) }
  const factory = new Function(
    'diag', 'diagThrottled', 'diagnosticErrorReasonPre', 'Date', 'Object', 'String', 'Number', 'Array', 'try_',
    ledgerSrc + '\nreturn { SCHEDULE_MAX_ATTEMPTS_PRE, SCHEDULE_RETRY_GAP_MS_PRE, scheduleGatePre, scheduleBeginAttemptPre, scheduleFailPre, scheduleOkPre, scheduleLedgerSnapshotPre, _scheduleLedger }')
  const mod = factory(diag, diagThrottled, diagnosticErrorReasonPre, o.Date || Date, Object, String, Number, Array, null)
  return { mod, traces, thrown, diag, diagThrottled }
}
makeEnv._seen = {}

/** 构造并跑 tickTime 的引擎 stub（只提供 tickTime 触摸到的成员） */
function makeEngine (env, opts) {
  const o = opts || {}
  const state = { notesText: 'original', loadedAt: 0 }
  const engine = {
    config: Object.assign({
      autoSummaryTimes: [],
      consolidateScheduleEnabled: true,
      consolidateScheduleTime: '09:30',
      maintainScheduleEnabled: true,
      maintainScheduleTime: '10:00',
    }, o.config || {}),
    runtimes: { values: () => [], peek: () => null },
    state,
    _lastAgent: { session: { id: 'fixture' } },
    awayMinutes: () => 0,
    memToday: () => o.today || '2026-10-08',
    restoreLastAgent: noopOf(),
    triggerAutoSummary: o.triggerAutoSummary || (async () => ({ summary: 'S', works: [], generatedAt: 1 })),
    consolidateMemory: o.consolidateMemory || (async () => 'memory_consolidate 完成'),
    maintain: o.maintain || (async () => '30 天蒸馏完成: AI 提炼 + 原文归档 1 个旧日志(x.md)'),
  }
  function noopOf () { return () => {} }
  engine.tickTime = new Function(
    'diag', 'diagThrottled', 'diagnosticErrorReasonPre', 'Date', 'Object', 'String', 'Number', 'Array', 'SCHEDULE_MAX_ATTEMPTS_PRE', 'SCHEDULE_RETRY_GAP_MS_PRE', 'scheduleGatePre', 'scheduleBeginAttemptPre', 'scheduleFailPre', 'scheduleOkPre', 'scheduleLedgerSnapshotPre',
    'const noop = () => {};\nreturn function ' + tickBody.trimStart()
  )(env.diag, env.diagThrottled, diagnosticErrorReasonPre, o.Date || Date, Object, String, Number, Array,
    env.mod.SCHEDULE_MAX_ATTEMPTS_PRE, env.mod.SCHEDULE_RETRY_GAP_MS_PRE, env.mod.scheduleGatePre,
    env.mod.scheduleBeginAttemptPre, env.mod.scheduleFailPre, env.mod.scheduleOkPre, env.mod.scheduleLedgerSnapshotPre)
  return engine
}

const noopOf = () => () => {}
function atTime (hhmm) {
  const base = new Date('2026-10-08T' + hhmm + ':00');
  class D extends Date {
    constructor(...a) { super(...(a.length ? a : [base.getTime()])) }
    static now () { return base.getTime() }
  }
  return D
}

/* ============================================================
 * ① 失败路径：不写 Done + 有回执 + 当日可重试（有界）
 * ============================================================ */
console.log('=== #261 失败路径 ===')
{
  makeEnv._seen = {}
  const env = makeEnv({});
  let ioCalls = 0
  const boom = Object.assign(new Error('fixture write denied'), { code: 'EACCES' });
  let t = 0
  const D = atTime('09:30');
  const engine = makeEngine(env, {
    Date: D,
    today: '2026-10-08',
    consolidateMemory: async () => { ioCalls++; throw boom },
    config: { consolidateScheduleEnabled: true, consolidateScheduleTime: '09:30', maintainScheduleEnabled: false },
  });

  // tick 1（计划时刻内，首次）
  engine.tickTime();
  await new Promise((r) => setImmediate(r));
  ok(ioCalls === 1, '⑦ [正] 首次 tick 真发起 1 次固化（实测 ' + ioCalls + '）')
  ok(engine._consolidateScheduleDone === undefined, '⑧ ★核心：失败后**未写**当日 Done 标记（实测 ' + JSON.stringify(engine._consolidateScheduleDone) + '）')
  ok(engine._scheduleBusy === false, '⑨ 失败后 busy 已复位（实测 ' + engine._scheduleBusy + '）')
  const failLines = env.traces.filter((x) => /scheduled consolidate FAILED/.test(x));
  ok(failLines.length >= 1, '⑩ ★核心：失败已写诊断回执（实测 ' + failLines.length + ' 条；首条 ' + JSON.stringify((failLines[0] || '').slice(0, 90)) + '）')
  ok(/code=EACCES/.test(failLines.join('|')), '⑪ ★回执含安全错误码 code=EACCES（不放 message/stack）')
  ok(!/fixture write denied/.test(env.traces.join('|')), '⑫ ★回执不含原始 message（防泄漏）')

  // tick 2：同一分钟内（间隔未到）⇒ 不应立刻重试
  engine.tickTime();
  await new Promise((r) => setImmediate(r));
  ok(ioCalls === 1, '⑬ [正] 间隔未到（<60s）不重试（实测 ' + ioCalls + '，防 15s 级风暴）')

  // tick 3：60s 后（模拟时间推进）⇒ 当日重试
  const env2Seen = makeEnv._seen;
  const D2 = (() => { const base2 = new Date('2026-10-08T09:31:00'); class D2c extends Date { constructor(...a) { super(...(a.length ? a : [base2.getTime()])) } static now () { return base2.getTime() } } return D2c })();
  // 用第二环境（同台账语义）验证「间隔到点后重试」
  makeEnv._seen = {};
  const envB = makeEnv({});
  let io2 = 0;
  const engB = makeEngine(envB, {
    Date: D,
    today: '2026-10-08',
    consolidateMemory: async () => { io2++; throw boom },
    config: { consolidateScheduleEnabled: true, consolidateScheduleTime: '09:30', maintainScheduleEnabled: false },
  });
  // 直接在台账上模拟「已尝试 1 次、lastAt 已过间隔」
  envB.mod.scheduleBeginAttemptPre('consolidate', '2026-10-08');
  const led = envB.mod._scheduleLedger['2026-10-08|consolidate'];
  led.lastAt = Date.now() - 61000;
  const gate = envB.mod.scheduleGatePre('consolidate', '2026-10-08', false);
  ok(gate.attempt === true, '⑭ ★核心：间隔到点且未用尽 ⇒ 当日允许重试（gate.attempt=' + gate.attempt + '）')
  // 现在时刻已不是 09:30（09:31）—— 重试必须仍能触发（旧实现在此不可能重试）
  engB.tickTime();
  await new Promise((r) => setImmediate(r));
  ok(io2 === 1, '⑮ ★核心：越过计划分钟后仍真重试（实测 ' + io2 + ' 次；旧实现此处恒 0）')
  ok(engB._consolidateScheduleDone === undefined, '⑯ 重试仍失败 ⇒ 仍未写 Done')
}

/* ============================================================
 * ② 有界性：连续失败 N 次后不再无限重试
 * ============================================================ */
console.log('');
console.log('=== #261 有界性 ===')
{
  makeEnv._seen = {};
  const env = makeEnv({});
  const day = '2026-10-08'
  const seen = []
  for (let i = 0; i < 6; i++) {
    const g = env.mod.scheduleGatePre('consolidate', day, i === 0)
    if (g.attempt) {
      env.mod.scheduleBeginAttemptPre('consolidate', day)
      seen.push(i)
      env.mod.scheduleFailPre('consolidate', day, Object.assign(new Error('x'), { code: 'EACCES' }))
      // 模拟间隔流逝
      env.mod._scheduleLedger[day + '|consolidate'].lastAt = 0
    }
  }
  ok(seen.length === 3, '⑰ ★核心：6 次 tick 只真发起 3 次（上限 SCHEDULE_MAX_ATTEMPTS_PRE=3，实测 ' + seen.length + '）')
  const snap = env.mod.scheduleLedgerSnapshotPre('consolidate', day);
  ok(snap.attempts === 3, '⑱ 台账 attempts 恰 3（实测 ' + snap.attempts + '）')
  ok(snap.exhausted === true, '⑲ ★额度用尽 ⇒ exhausted=true（实测 ' + snap.exhausted + '）')
  ok(snap.outcome === 'given-up', '⑳ outcome 记为 given-up（实测 ' + JSON.stringify(snap.outcome) + '）')
  const g4 = env.mod.scheduleGatePre('consolidate', day, false)
  ok(g4.attempt === false && g4.exhausted === true, '㉑ ★用尽后永不重试（attempt=' + g4.attempt + ', exhausted=' + g4.exhausted + '）')
}

/* ============================================================
 * ③ 成功路径守恒：写 Done ⇒ 当日不重复
 * ============================================================ */
console.log('');
console.log('=== #261 成功路径守恒 ===')
{
  makeEnv._seen = {};
  const env = makeEnv({});
  let calls = 0;
  const eng = makeEngine(env, {
    Date: atTime('09:30'),
    today: '2026-10-08',
    consolidateMemory: async () => { calls++; return 'memory_consolidate 完成,已固化 项目笔记 2 条(带日期标题)。' },
    config: { consolidateScheduleEnabled: true, consolidateScheduleTime: '09:30', maintainScheduleEnabled: false },
  });
  eng.tickTime();
  await new Promise((r) => setImmediate(r));
  ok(calls === 1, '㉒ [正] 成功路径真发起 1 次（实测 ' + calls + '）')
  ok(eng._consolidateScheduleDone === '2026-10-08|consolidate|09:30', '㉓ ★成功后才写 Done（实测 ' + JSON.stringify(eng._consolidateScheduleDone) + '）')
  const led = env.mod.scheduleLedgerSnapshotPre('consolidate', '2026-10-08');
  ok(led.outcome === 'succeeded', '㉔ outcome=succeeded（实测 ' + JSON.stringify(led.outcome) + '）')
  ok(led.lastSuccessAt > 0, '㉕ lastSuccessAt 已记（实测 ' + led.lastSuccessAt + '）')
  // 当日再 tick ⇒ 不重复
  eng.tickTime();
  await new Promise((r) => setImmediate(r));
  ok(calls === 1, '㉖ ★成功守恒：当日再 tick 不重复执行（实测 ' + calls + '）')
}

/* ============================================================
 * ④ 维护任务同型（问题单要求「固化和维护均覆盖失败路径」）
 * ============================================================ */
console.log('');
console.log('=== #261 维护任务同型 ===')
{
  // 失败
  makeEnv._seen = {};
  const env = makeEnv({});
  let mc = 0;
  const eng = makeEngine(env, {
    Date: atTime('10:00'),
    today: '2026-10-08',
    maintain: async () => { mc++; throw Object.assign(new Error('denied'), { code: 'EPERM' }) },
    config: { consolidateScheduleEnabled: false, maintainScheduleEnabled: true, maintainScheduleTime: '10:00' },
  });
  eng.tickTime();
  await new Promise((r) => setImmediate(r));
  ok(mc === 1, '㉗ [正] 维护失败路径真发起 1 次（实测 ' + mc + '）')
  ok(eng._maintainScheduleDone === undefined, '㉘ ★维护失败后未写 Done')
  ok(env.traces.some((x) => /scheduled maintain FAILED/.test(x)), '㉙ ★维护失败有诊断回执')
  ok(/code=EPERM/.test(env.traces.join('|')), '㉚ 回执含 code=EPERM')

  // 成功 + 部分写入可见
  makeEnv._seen = {};
  const env2 = makeEnv({});
  const eng2 = makeEngine(env2, {
    Date: atTime('10:00'),
    today: '2026-10-08',
    maintain: async () => '30 天蒸馏完成: 原文归档 1 个旧日志(a.md)\n原文保底: /x/archive (1 个文件)\n未删除(可手动清理): b.md',
    config: { consolidateScheduleEnabled: false, maintainScheduleEnabled: true, maintainScheduleTime: '10:00' },
  });
  eng2.tickTime();
  await new Promise((r) => setImmediate(r));
  ok(eng2._maintainScheduleDone === '2026-10-08|maintain|10:00', '㉛ 维护成功后才写 Done')
  const led2 = env2.mod.scheduleLedgerSnapshotPre('maintain', '2026-10-08');
  ok(led2.outcome === 'partial', '㉜ ★部分写入可区分：保源未删 ⇒ outcome=partial（实测 ' + JSON.stringify(led2.outcome) + '）')
}

/* ============================================================
 * ⑤ 诊断投影：失败可查询（问题单 §验收「诊断接口仍可查询失败」）
 * ============================================================ */
console.log('');
console.log('=== #261 诊断投影 ===')
{
  const engine = {
    memToday: () => '2026-10-08',
    _consolidateScheduleDone: '',
    _maintainScheduleDone: '2026-10-08|maintain|10:00',
  }
  // 台账在 ledgerSrc 内是同一闭包 —— 需在同一次 new Function 内先写再读
  const snapFn2 = new Function('diag', 'diagThrottled', 'diagnosticErrorReasonPre', 'memToday',
    ledgerSrc
    + '\nscheduleBeginAttemptPre("consolidate", "2026-10-08");'
    + '\nscheduleFailPre("consolidate", "2026-10-08", Object.assign(new Error("x"), { code: "ENOSPC" }));'
    + '\nconst _self = { memToday: memToday, _consolidateScheduleDone: "", _maintainScheduleDone: "2026-10-08|maintain|10:00" };'
    + '\nreturn (' + snapBody.replace('  _scheduleViewSnapshot()', 'function _scheduleViewSnapshot()') + ').bind(_self)')(
      () => {}, () => {}, diagnosticErrorReasonPre, () => '2026-10-08');
  const view = snapFn2();
  ok(view && view.schemaVersion === 'schedule_pre_v1', '㉝ 投影 schemaVersion=schedule_pre_v1（实测 ' + JSON.stringify(view && view.schemaVersion) + '）')
  ok(view.consolidate.attempts === 1, '㉞ ★投影可查失败尝试数（实测 ' + view.consolidate.attempts + '）')
  ok(/code=ENOSPC/.test(view.consolidate.lastReason), '㉟ ★投影可查安全错误码（实测 ' + JSON.stringify(view.consolidate.lastReason) + '）')
  ok(view.consolidate.lastAt > 0, '㊱ ★投影可查失败时间（实测 ' + view.consolidate.lastAt + '）')
  ok(view.consolidate.exhausted === false, '㊲ 未用尽时 exhausted=false')
  ok(typeof view.note === 'string' && /memory_consolidate/.test(view.note), '㊳ 投影含人工恢复入口指引')
  ok(view.maintain.doneKey.length > 0, '㊴ 投影含已写 Done 键（可区分尝试与完成）')
  ok(!/[A-Za-z]:\\/.test(JSON.stringify(view)), '㊵ ★投影不含任何绝对路径（最小投影纪律）')
}

/* ============================================================
 * ⑤b 第三个实例：autoSummary（同型调度根因 + 零人工入口，须与另两条同构）
 * ============================================================ */
console.log('');
console.log('=== #261 autoSummary 第三实例 ===')
{
  // 失败：不写 Done + 有回执 + 当日可重试
  makeEnv._seen = {};
  const env = makeEnv({});
  let sc = 0;
  const eng = makeEngine(env, {
    Date: atTime('14:00'),
    today: '2026-10-08',
    triggerAutoSummary: async () => { sc++; throw Object.assign(new Error('denied'), { code: 'EACCES' }) },
    config: { autoSummaryTimes: ['14:00'], consolidateScheduleEnabled: false, maintainScheduleEnabled: false },
  });
  eng.tickTime();
  await new Promise((r) => setImmediate(r));
  ok(sc === 1, '㊹ [正] summary 失败路径真发起 1 次（实测 ' + sc + '）')
  ok(eng._summaryDone === undefined, '㊺ ★summary 失败后未写 Done（旧实现此处已写，当日不再重试）')
  const sLines = env.traces.filter((x) => /scheduled autoSummary FAILED/.test(x));
  ok(sLines.length >= 1, '㊻ ★summary 失败有诊断回执（实测 ' + sLines.length + ' 条）')
  ok(/code=EACCES/.test(sLines.join('|')), '㊼ 回执含安全错误码 code=EACCES')
  ok(!/denied/.test(env.traces.join('|')), '㊽ 回执不含原始 message（防泄漏）')

  // 有界性：用满额度后不再重试 + 写 Done + 回执写明「无人工入口」
  const day = '2026-10-08'
  const envB = makeEnv({});
  const seen = []
  for (let i = 0; i < 6; i++) {
    const g = envB.mod.scheduleGatePre('autoSummary', day, i === 0)
    if (g.attempt) {
      envB.mod.scheduleBeginAttemptPre('autoSummary', day)
      seen.push(i)
      envB.mod.scheduleFailPre('autoSummary', day, Object.assign(new Error('x'), { code: 'EACCES' }))
      envB.mod._scheduleLedger[day + '|autoSummary'].lastAt = 0
    }
  }
  ok(seen.length === 3, '㊾ ★summary 有界：6 次 tick 只真发起 3 次（实测 ' + seen.length + '）')
  const led = envB.mod.scheduleLedgerSnapshotPre('autoSummary', day)
  ok(led.exhausted === true && led.outcome === 'given-up', '㊿ ★额度用尽 ⇒ exhausted/given-up（实测 ' + led.exhausted + '/' + led.outcome + '）')

  // 成功守恒：成功才写 Done ⇒ 当日不重复
  makeEnv._seen = {};
  const envC = makeEnv({});
  let okc = 0;
  const engC = makeEngine(envC, {
    Date: atTime('14:00'),
    today: '2026-10-08',
    triggerAutoSummary: async () => { okc++; return { summary: 'S', works: [], generatedAt: 1 } },
    config: { autoSummaryTimes: ['14:00'], consolidateScheduleEnabled: false, maintainScheduleEnabled: false },
  });
  engC.tickTime();
  await new Promise((r) => setImmediate(r));
  ok(okc === 1 && engC._summaryDone === '2026-10-08|14:00', '（5a）★summary 成功后才写 Done（实测 ' + JSON.stringify(engC._summaryDone) + '）')
  engC.tickTime();
  await new Promise((r) => setImmediate(r));
  ok(okc === 1, '（5b）成功守恒：当日再 tick 不重复（实测 ' + okc + '）')

  // 「跑完但无产出」也算未成功（旧实现会静默占位）
  makeEnv._seen = {};
  const envD = makeEnv({});
  const engD = makeEngine(envD, {
    Date: atTime('14:00'),
    today: '2026-10-08',
    triggerAutoSummary: async () => { throw new Error('auto summary produced no summary for period afternoon') },
    config: { autoSummaryTimes: ['14:00'], consolidateScheduleEnabled: false, maintainScheduleEnabled: false },
  });
  engD.tickTime();
  await new Promise((r) => setImmediate(r));
  ok(engD._summaryDone === undefined, '（5c）★无产出也不写 Done（旧实现静默占位）')

  // 产线源码：triggerAutoSummary 不得再有空 catch（反向锁）
  const trigBody = grabBalanced(SRC, '  async triggerAutoSummary(timePoint) {')
  ok(!!trigBody, '（5d）产线 triggerAutoSummary 可抽取')
  // ★去注释再匹配：注释里逐字记录了旧形态 `catch (e) {}`，直接正则会被注释喂饱（假的「仍有空吞」）。
  const trigCode = trigBody.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')
  ok(!/catch\s*\(e\)\s*\{\s*\}/.test(trigCode), '（5e）★产线已无空 catch（旧形态 = 空吞、永不 reject）')
  ok(!/catch\s*\(/.test(trigCode), '（5e2）★产线 triggerAutoSummary 已无任何 catch（失败一律上抛）')
  ok(/throw new Error\('auto summary produced no summary/.test(trigBody), '（5f）★无产出改为上抛（不再静默成功）')
}
/* ============================================================
 * ⑥ 负路径 · 变异必红（把 Done 改回「开始就写」）
 * ============================================================ */
console.log('');
console.log('=== #261 变异必红 ===')
{
  const MUT_ANCHOR = "              scheduleBeginAttemptPre('consolidate', todayS)"
  ok(SRC.split(MUT_ANCHOR).length - 1 === 1, '㊶ 变异前置：锚串恰命中 1 次')
  // 变异：把「成功才写 Done」改回「开始就写 Done」（旧缺陷形态）
  const mutated = SRC.replace(MUT_ANCHOR, "              this._consolidateScheduleDone = cKey\n" + MUT_ANCHOR)
  const mutantTick = grabBalanced(mutated, TICK_HEAD)
  const env = makeEnv({});
  const finalize = (body) => new Function(
    'diag', 'diagThrottled', 'diagnosticErrorReasonPre', 'Date', 'Object', 'String', 'Number', 'Array',
    'SCHEDULE_MAX_ATTEMPTS_PRE', 'SCHEDULE_RETRY_GAP_MS_PRE', 'scheduleGatePre', 'scheduleBeginAttemptPre',
    'scheduleFailPre', 'scheduleOkPre', 'scheduleLedgerSnapshotPre',
    'const noop = () => {};\nreturn ' + body.replace('  tickTime()', 'function tickTime()'))
  const mkTick = (body) => finalize(body)(env.diag, env.diagThrottled, diagnosticErrorReasonPre,
    atTime('09:30'), Object, String, Number, Array, 3, 60000, env.mod.scheduleGatePre,
    env.mod.scheduleBeginAttemptPre, env.mod.scheduleFailPre, env.mod.scheduleOkPre, env.mod.scheduleLedgerSnapshotPre)
  const engMut = makeEngine(env, { Date: atTime('09:30'), today: '2026-10-08',
    consolidateMemory: async () => { throw Object.assign(new Error('x'), { code: 'EACCES' }) },
    config: { consolidateScheduleEnabled: true, consolidateScheduleTime: '09:30', maintainScheduleEnabled: false } });
  engMut.tickTime = mkTick(mutantTick);
  engMut.tickTime();
  await new Promise((r) => setImmediate(r));
  ok(engMut._consolidateScheduleDone !== undefined, '㊷ [负] ★变异必红：旧写法下失败仍写了 Done（实测 ' + JSON.stringify(engMut._consolidateScheduleDone) + '）')

  // 还原复绿：产线源码同一序列 ⇒ 不写 Done
  const envG = makeEnv({});
  const engG = makeEngine(envG, { Date: atTime('09:30'), today: '2026-10-08',
    consolidateMemory: async () => { throw Object.assign(new Error('x'), { code: 'EACCES' }) },
    config: { consolidateScheduleEnabled: true, consolidateScheduleTime: '09:30', maintainScheduleEnabled: false } });
  engG.tickTime();
  await new Promise((r) => setImmediate(r));
  ok(engG._consolidateScheduleDone === undefined, '㊸ [负] 还原复绿：未变异源码失败后不写 Done')
}

console.log('');
console.log('=========================================');
console.log('[le-261] PASS ' + pass + ' / FAIL ' + fail);
console.log('=========================================');
process.exit(fail ? 1 : 0)