#!/usr/bin/env node
/**
 * smoke-test-issue523-inflight-param.mjs —— #523：inflight 集合参数名不一致 ⇒ 在跑任务被判孤儿并重启。
 *
 * ============================ 根因（实测定位）============================
 *   lib/index.js:10919        inflightJobIds: Array.from(this._inflightUpgradeJobs.keys())   ← 传的是 inflightJobIds
 *   lib/team-baseline.js:490  Array.isArray(i.inflightIds) ? …                               ← 读的是 inflightIds
 * ⇒ `ids` 恒为 [] ⇒ `ids.indexOf(jobId) < 0` 恒真 ⇒ 同世代在跑的任务也被判 orphan/jobid-not-inflight
 *   ⇒ 每点一次「立即整理」都记 failed 并重启新任务（旧任务仍在跑）。
 * 修法：调用方改传 `inflightIds`（team-baseline.js:461 的 JSDoc 写的就是 inflightIds，改它更合原设计）。
 *
 * ============================ 验收判据（issue 原文特别强调：不要只测纯判断函数）============================
 *  J-1 **第一次 startUpgradeJobPre 未完成**时再调一次 ⇒ 返回**同一 jobId** / reused:true
 *  J-2 第二次调用**不改写状态**（磁盘 phase/jobId/startedAt 保持第一次的原值）
 *  J-3 第二次调用**不再调用 runSubagent**（真 runSubagent 被包一层计数）
 *  J-4 **真孤儿仍可恢复**：磁盘写着 running 但 epoch 与当前世代不同 ⇒ 判 orphan ⇒ 照常重启（修复不得把该能力弄坏）
 *  J-5 同世代但 jobId **不在**在飞集合 ⇒ 仍判孤儿并重启（负路径：修复不得让判定放宽成恒 reused）
 *  J-6 磁盘 phase 非 running ⇒ 正常 start（负路径：不得被上一条吞掉）
 *  MUT-523 变异：把调用方参数名改回 `inflightJobIds` ⇒ J-1/J-2/J-3 必红
 */
import assert from 'node:assert'
import fsm from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const HERE = path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1')
const ROOT = path.resolve(HERE, '..', '..')
const ENGINE_PATH = path.join(ROOT, 'lib', 'index.js')

let pass = 0, fail = 0, skip = 0
const ok = (cond, name, detail) => {
  if (cond) { pass++; console.log('  ok - ' + name + (detail ? '  :: ' + detail : '')) }
  else { fail++; console.error('  FAIL - ' + name + (detail ? '  :: ' + detail : '')) }
}
const skipped = (name, why) => { skip++; console.log('  SKIP - ' + name + '  :: ' + why) }

// ── 隔离 DSH_HOME：绝不碰真实用户目录 ──
const HOME = (() => {
  const mk = (base) => { try { fsm.mkdirSync(base, { recursive: true }); return fsm.mkdtempSync(path.join(base, 'dam-523-')) } catch (_) { return null } }
  return mk(process.env.TEMP || '/tmp') || mk(path.join(ROOT, '.verify-tmp'))
})()
if (!HOME) { console.log('[523] 0 PASS / 0 FAIL / 1 SKIP  :: 无法创建隔离目录'); process.exit(0) }
process.env.DSH_HOME = HOME
process.env.HOME = HOME
process.on('exit', () => { try { fsm.rmSync(HOME, { recursive: true, force: true }) } catch (_) {} })

// ── 与 tests/lib/audit-engine.mjs 同源：把相对 import 改成绝对 URL，再补导出 ──
const indexUrl = pathToFileURL(ENGINE_PATH).href
const source = (await fsp.readFile(ENGINE_PATH, 'utf8'))
const rewritten = source
  .replace(/from '(\.\/[^']+)'/g, (_, rel) => 'from ' + JSON.stringify(new URL(rel, indexUrl).href))
  .replace(/import\('(\.\/[^']+)'\)/g, (_, rel) => 'import(' + JSON.stringify(new URL(rel, indexUrl).href) + ')');
const modFile = path.join(HOME, 'engine.mjs')
await fsp.writeFile(modFile, rewritten + '\nexport { MemoryEngine, diag };');

let MemoryEngine = null
try { ({ MemoryEngine } = await import(pathToFileURL(modFile).href)) }
catch (e) {
  skipped('J-* / MUT-523', '引擎无法真加载：' + String((e && e.message) || e).slice(0, 120));
  console.log('[523] ' + pass + ' PASS / ' + fail + ' FAIL / ' + skip + ' SKIP');
  process.exit(0);
}

// ── 构造最小引擎：只保留 startUpgradeJobPre 真正走到的依赖 ──
function makeEngine({ stateFile, scopeRows = [], runLog = [] } = {}) {
  const eng = Object.create(MemoryEngine.prototype);
  eng.config = {
    memoryRoot: path.join(HOME, 'memory'), userMemoryDir: path.join(HOME, 'user'),
    handoffEnabled: true, autoContinueEnabled: false, unattendedMode: true,
  };
  eng.configLoaded = true;
  eng._disposed = false;
  eng._subagents = { list: () => [] };          // 非 null ⇒ 过 10904 的 subagents-unavailable 门
  eng._inflightUpgradeJobs = new Map();
  eng._upgradeEpoch = '';
  eng._subagentInflight = 0;
  eng._workbenchReady = true;
  eng._workbenchParent = null;
  // 磁盘态：由测试直接落到升级状态文件（readUpgradeStatePre 读的就是它）
  eng.readUpgradeStatePre = async () => {
    try { return JSON.parse(fsm.readFileSync(stateFile, 'utf8')) } catch (_) { return {} }
  };
  eng.writeUpgradeStatePre = async (_agent, patch) => {
    let prev = {};
    try { prev = JSON.parse(fsm.readFileSync(stateFile, 'utf8')) } catch (_) {}
    const next = Object.assign({}, prev, patch || {});
    fsm.writeFileSync(stateFile, JSON.stringify(next, null, 2), 'utf8');
    return { ok: true, path: stateFile };
  };
  // 其余依赖全部打桩（本套件只验「是否复用」，不验清单/子代理本体）
  eng.resolvePaths = async () => ({ ws: path.join(HOME, 'ws'), userDir: path.dirname(stateFile) });
  eng.buildWorkspaceInventoryPre = async () => ({ rows: scopeRows });
  eng.resolveUpgradeScopeRowsPre = () => ({ rows: scopeRows });
  eng.buildWorkspaceManifestPre = async () => 'MANIFEST-STUB';
  // ★真 runSubagent 计数：J-3 的判据就是「第二次不得再进这里」
  eng.runSubagent = async (...args) => { runLog.push(args); return 'subagent-summary-stub' };
  eng.finishUpgradeJobPre = async () => ({ ok: true });
  return eng;
}

console.log('[J-0] 模块契约')
ok(typeof MemoryEngine === 'function', 'J-0a MemoryEngine 真加载成功')
ok(typeof MemoryEngine.prototype.startUpgradeJobPre === 'function', 'J-0b 原型上有 startUpgradeJobPre')

// ══════════════════════════════════════════════════════════════════
console.log('[J-1..J-3] 首次真启动后**第二次**真调用 ⇒ 必须复用同一 jobId、不改状态、不再派子代理');
// ══════════════════════════════════════════════════════════════════
{
  const stateFile = path.join(HOME, 'upgrade-state.json');
  try { fsm.unlinkSync(stateFile) } catch (_) {}
  const runLog = [];
  const eng = makeEngine({ stateFile, runLog });
  const agent = { session: { id: 'sess-523', header: { cwd: path.join(HOME, 'ws') } } };

  // 第一次：真启动（把子代理 Promise 挂住 ⇒ 任务保持「未完成」）
  let releaseFirst = null;
  const firstGate = new Promise((res) => { releaseFirst = res });
  const realRun = eng.runSubagent;
  eng.runSubagent = async (...a) => { runLog.push(a); await firstGate; return 'first-summary' };
  const r1 = await eng.startUpgradeJobPre(agent, { scope: 'all' });
  ok(r1 && r1.ok === true && !!r1.jobId, 'J-1a 第一次启动成功并返回 jobId', JSON.stringify({ ok: r1 && r1.ok, jobId: r1 && r1.jobId, reused: r1 && r1.reused }))
  const jobId1 = r1 && r1.jobId;
  // 等一帧，确保 startUpgradeJobPre 内的 Promise.resolve().then(...) 链已经进到 runSubagent（并把 jobId 放进在飞集）
  for (let i = 0; i < 20 && runLog.length === 0; i++) await new Promise((r) => setTimeout(r, 10));
  const inflightSize = eng._inflightUpgradeJobs.size;
  ok(inflightSize >= 1, 'J-1b 在飞集合里已有该 jobId（前置条件）', 'size=' + inflightSize + ' runSubagentCalls=' + runLog.length)
  const stBefore = JSON.parse(fsm.readFileSync(stateFile, 'utf8'));
  const callsBefore = runLog.length;

  // 第二次：任务**未完成**时再点一次 —— 这是 issue 的核心场景
  const r2 = await eng.startUpgradeJobPre(agent, { scope: 'all' });
  ok(r2 && r2.ok === true, 'J-1c 第二次调用成功返回', JSON.stringify(r2).slice(0, 140))
  ok(!!(r2 && r2.reused === true), '★J-1d 第二次 reused:true（复用在跑任务，不是新起）', 'reused=' + (r2 && r2.reused))
  ok(!!(r2 && r2.jobId === jobId1), '★★J-1e 第二次返回**同一个 jobId**', 'got=' + (r2 && r2.jobId) + ' want=' + jobId1)
  ok(!(r2 && r2.error), 'J-1f 第二次没有 error 字段', r2 && r2.error)

  const stAfter = JSON.parse(fsm.readFileSync(stateFile, 'utf8'));
  ok(stAfter.phase === stBefore.phase, 'J-2a 磁盘 phase 未被改写', before_after(stBefore.phase, stAfter.phase));
  ok(stAfter.jobId === stBefore.jobId, 'J-2b 磁盘 jobId 未被改写', before_after(stBefore.jobId, stAfter.jobId));
  ok(stAfter.startedAt === stBefore.startedAt, 'J-2c 磁盘 startedAt 未被改写（没有被当成孤儿重启）', before_after(stBefore.startedAt, stAfter.startedAt));
  ok(!String(stAfter.error || '').includes('orphan-restart'), '★J-2d 没有被写成 orphan-restart', 'error=' + String(stAfter.error || '').slice(0, 80));

  ok(runLog.length === callsBefore, '★★J-3 第二次**不再调用 runSubagent**', 'callsBefore=' + callsBefore + ' callsAfter=' + runLog.length);
  releaseFirst();
  await new Promise((r) => setTimeout(r, 30));
}

// ══════════════════════════════════════════════════════════════════
console.log('[J-4] 真孤儿仍可恢复：epoch 不同 ⇒ orphan ⇒ 照常重启（修复不得弄坏该能力）');
// ══════════════════════════════════════════════════════════════════
{
  const stateFile = path.join(HOME, 'upgrade-state-j4.json');
  fsm.writeFileSync(stateFile, JSON.stringify({ phase: 'running', jobId: 'upg_old_j4', epoch: 'ep_OLD_GENERATION', startedAt: 111, at: 111 }), 'utf8');
  const runLog = [];
  const eng = makeEngine({ stateFile, runLog });
  eng._upgradeEpoch = 'ep_NEW_GENERATION';   // 与磁盘 epoch 不同 ⇒ 世代不匹配
  const agent = { session: { id: 'sess-j4', header: { cwd: path.join(HOME, 'ws') } } };
  const r = await eng.startUpgradeJobPre(agent, { scope: 'all' });
  ok(r && r.ok === true, 'J-4a 孤儿场景仍能启动新任务', JSON.stringify(r).slice(0, 120))
  ok(!!(r && r.jobId && r.jobId !== 'upg_old_j4'), '★J-4b 起的是**新 jobId**（不是复用僵尸）', 'got=' + (r && r.jobId))
  ok(!(r && r.reused === true), 'J-4c 孤儿场景 reused 不为 true', 'reused=' + (r && r.reused))
  for (let i = 0; i < 20 && runLog.length === 0; i++) await new Promise((x) => setTimeout(x, 10));
  ok(runLog.length === 1, '★J-4d 孤儿重启真的派了子代理（1 次）', 'calls=' + runLog.length);
  const st = JSON.parse(fsm.readFileSync(stateFile, 'utf8'));
  ok(String(st.error || '').includes('orphan-restart') || st.phase === 'running', 'J-4e 孤儿被标记并重启（phase=' + st.phase + '）')
}

// ══════════════════════════════════════════════════════════════════
console.log('[J-5] 同世代但 jobId 不在在飞集合 ⇒ 仍判孤儿（负路径：修复不得放宽成恒 reused）');
// ══════════════════════════════════════════════════════════════════
{
  const stateFile = path.join(HOME, 'upgrade-state-j5.json');
  fsm.writeFileSync(stateFile, JSON.stringify({ phase: 'running', jobId: 'upg_ghost_j5', epoch: 'ep_SAME', startedAt: 222, at: 222 }), 'utf8');
  const runLog = [];
  const eng = makeEngine({ stateFile, runLog });
  eng._upgradeEpoch = 'ep_SAME';                 // 世代相同
  eng._inflightUpgradeJobs = new Map();          // 但该 jobId **不在**在飞集合
  const agent = { session: { id: 'sess-j5', header: { cwd: path.join(HOME, 'ws') } } };
  const r = await eng.startUpgradeJobPre(agent, { scope: 'all' });
  ok(r && r.ok === true && r.jobId !== 'upg_ghost_j5', '★J-5a 同世代但不在在飞 ⇒ 起新任务（不复用）', 'jobId=' + (r && r.jobId) + ' reused=' + (r && r.reused));
  ok(!(r && r.reused === true), '★J-5b reused 不为 true（判定未被放宽）', 'reused=' + (r && r.reused))
}

// ══════════════════════════════════════════════════════════════════
console.log('[J-6] 磁盘 phase 非 running ⇒ 正常 start（负路径）');
// ══════════════════════════════════════════════════════════════════
{
  const stateFile = path.join(HOME, 'upgrade-state-j6.json');
  fsm.writeFileSync(stateFile, JSON.stringify({ phase: 'done', jobId: 'upg_done_j6', epoch: 'ep_SAME', startedAt: 333 }), 'utf8');
  const runLog = [];
  const eng = makeEngine({ stateFile, runLog });
  eng._upgradeEpoch = 'ep_SAME';
  const agent = { session: { id: 'sess-j6', header: { cwd: path.join(HOME, 'ws') } } };
  const r = await eng.startUpgradeJobPre(agent, { scope: 'all' });
  ok(r && r.ok === true && r.jobId !== 'upg_done_j6' && r.reused !== true, 'J-6a done 状态 ⇒ 起新任务', 'jobId=' + (r && r.jobId));
}

// ══════════════════════════════════════════════════════════════════
console.log('[MUT-523] 变异：把调用方参数名改回 inflightJobIds ⇒ J-1d/J-1e/J-2c/J-3 必红');
// ══════════════════════════════════════════════════════════════════
{
  const orig = fsm.readFileSync(ENGINE_PATH, 'utf8');
  const fixedAnchor = '        inflightIds: Array.from(this._inflightUpgradeJobs.keys()),';
  const n = orig.split(fixedAnchor).length - 1;
  ok(n === 1, 'MUT-523a 修复锚串在源码中恰命中 1 次', 'scope=' + n);
  if (n !== 1) {
    skipped('MUT-523b', '锚串未唯一命中，拒绝施加变异');
  } else {
    const mutSrc = orig.replace(fixedAnchor, '        inflightJobIds: Array.from(this._inflightUpgradeJobs.keys()),');
    const mutFile = path.join(HOME, 'engine-mut523.mjs');
    const mutRewritten = mutSrc
      .replace(/from '(\.\/[^']+)'/g, (_, rel) => 'from ' + JSON.stringify(new URL(rel, indexUrl).href))
      .replace(/import\('(\.\/[^']+)'\)/g, (_, rel) => 'import(' + JSON.stringify(new URL(rel, indexUrl).href) + ')');
    fsm.writeFileSync(mutFile, mutRewritten + '\nexport { MemoryEngine };');
    const MUT = await import(pathToFileURL(mutFile).href);
    const stateFile = path.join(HOME, 'upgrade-state-mut.json');
    try { fsm.unlinkSync(stateFile) } catch (_) {}
    const runLog = [];
    const eng = Object.create(MUT.MemoryEngine.prototype);
    const proto = makeEngine({ stateFile, runLog });
    Object.assign(eng, proto);
    // 记录**每一次**状态写入的 patch（瞬态判定要靠它，不能只看最终文件）
    const _baseWrite = proto.writeUpgradeStatePre;
    const patches = [];
    eng.writeUpgradeStatePre = async (ag2, patch) => { patches.push(Object.assign({}, patch || {})); return _baseWrite(ag2, patch) };
    let releaseMut = null;
    const gateMut = new Promise((res) => { releaseMut = res });
    eng.runSubagent = async (...a) => { runLog.push(a); await gateMut; return 'x' };
    const agent = { session: { id: 'sess-mut', header: { cwd: path.join(HOME, 'ws') } } };
    const m1 = await eng.startUpgradeJobPre(agent, { scope: 'all' });
    for (let i = 0; i < 20 && runLog.length === 0; i++) await new Promise((x) => setTimeout(x, 10));
    const m2 = await eng.startUpgradeJobPre(agent, { scope: 'all' });
    ok(!(m2 && m2.reused === true), '★★MUT-523b 变异体（参数名不一致）第二次 **reused 不为 true** ⇒ 缺陷可复现', 'reused=' + (m2 && m2.reused) + ' jobId=' + (m2 && m2.jobId) + ' 原jobId=' + (m1 && m1.jobId));
    ok(!(m2 && m2.jobId === m1.jobId), '★★MUT-523c 变异体第二次返回**不同 jobId**（把在跑任务当孤儿重启了）', 'm1=' + (m1 && m1.jobId) + ' m2=' + (m2 && m2.jobId));
    // ★判据修正（首版写错，已修）：orphan-restart 标记是**瞬态**的 —— 先写 failed(带 orphan-restart)，
    //   紧接着同一次调用又写 running(error:'') 覆盖掉 ⇒ 只看最终 state 会误判成「没发生孤儿化」。
    //   正确判据：**捕获每一次状态写入的 patch**，断言其中确实出现过 orphan-restart。
    ok(patches.some((p) => String(p.error || '').includes('orphan-restart')),
      '★MUT-523d 变异体把在跑任务判定为 orphan 并写入 orphan-restart 标记', 'patches=' + patches.length + ' withOrphan=' + patches.filter((p) => String(p.error || '').includes('orphan-restart')).length);
    // 第二次启动后的 Promise 链要跑几拍才进 runSubagent ⇒ 必须等，否则会误判成「没双跑」
    for (let i = 0; i < 30 && runLog.length < 2; i++) await new Promise((r) => setTimeout(r, 10));
    ok(runLog.length >= 2, '★★MUT-523d2 变异体起了**第二个**子代理（原任务仍在跑 ⇒ 双跑）', 'runSubagentCalls=' + runLog.length);
    releaseMut();
    await new Promise((r) => setTimeout(r, 20));
  }
  ok(fsm.readFileSync(ENGINE_PATH, 'utf8') === orig, 'MUT-523e 产品源文件全程未被改动（变异只在副本上）');
}

console.log('');
console.log('[523] ' + pass + ' PASS / ' + fail + ' FAIL / ' + skip + ' SKIP')
process.exit(fail ? 1 : 0)

function before_after(a, b) { return 'before=' + String(a) + ' after=' + String(b) }
