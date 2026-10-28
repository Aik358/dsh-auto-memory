#!/usr/bin/env node
/**
 * smoke-test-i332-write-contract.mjs —— #332 吸收（2026-10-12）：主记忆写入的**确定性行为契约**。
 *
 * 报告人（Minervaowl7）要吸收的第二项：把「写入结果」的判定行为用**确定性测试**钉住。
 * 本套件**真执行** lib/index.js 里 memory_note 的 plan/handoff 分支片段（源码抽取后运行），
 * 断言**返回值分类**，并做**反向对照**证明断言有鉴别力（把保护逻辑打坏 ⇒ 必红）。
 *
 * 覆盖（报告人点名的「组合缺口」）：
 *   ① 正文提交成功 + sidecar/派生索引失败 ⇒ 必须**如实区分**（不得当成"完全没写"、也不得静默）；
 *   ② 正文写盘失败 ⇒ 必须报失败，且**不得**声称已保存或给出 revision；
 *   ③ 重试（同参二次调用）⇒ 判定**幂等**、分类一致（重启/重试路径）；
 *   ④ 后续 IO 必须全部结束（无悬挂异步）；
 *   ⑤ handoff 分支的截断告警不得回归（A-2）。
 *
 * 纪律：只读产线源码 + 注入替身写入器，**不触碰真实记忆文件**；零运行时变化（本套件不随包发布）。
 */
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import pathModule from 'node:path'
import { fileURLToPath } from 'node:url'

// ★2026-10-13 #344：URL.pathname 百分号编码（中文/空格）⇒ 路径不存在。改用 fileURLToPath。
const ROOT = pathModule.join(pathModule.dirname(fileURLToPath(import.meta.url)), '..', '..')
const SRC = readFileSync(pathModule.join(ROOT, 'lib', 'index.js'), 'utf8')

let pass = 0, fail = 0
const ok = (c, n, d) => { if (c) { pass++; console.log('  ok - ' + n) } else { fail++; console.log('  FAIL - ' + n + (d ? ' :: ' + d : '')) } }

// ── 真抽取：memory_note 的 plan/handoff 分支（从 `const content =` 到该分支闭合）──
function extractBranch(src) {
  // 2026-10-27 判据更新（fromEvents 白板渲染接入后锚点前移）：
  // 旧锚 `const content = ...` 已改为 `let content = ...` + 渲染块；改锚到分支入口，覆盖面更完整。
  const a = src.indexOf("      let content = args.kind === 'plan' ? String(args.content || '') : String(args.content || '').trim()")
  const marker = "      const replace = args.action === 'replace'";
  const b = src.indexOf(marker, a)
  assert.ok(a > 0 && b > a, '抽取 plan/handoff 分支命中')
  return src.slice(a, b).trimEnd()
}
const BRANCH = extractBranch(SRC)
ok(/indexStale/.test(BRANCH), '① 抽取段含 indexStale 判定（正文/索引区分）')
ok(/gateH\.truncated/.test(BRANCH), '① 抽取段含账本截断告警（A-2）')

// ── 可执行壳：注入替身（真源片段 + 受控写入器）──
// ★2026-10-25 C1 判据更新（Lead 复查指出）：C1 在该分支里新增了三个模块级符号
//   （appendHandoffCheckpointPre / eventStorePathOfPre / diagThrottled）⇒ 抽取壳必须同步注入，
//   否则「xxx is not defined」会让 ⑥⑧ 连带红（那是**测试壳问题**，不是产品缺陷）。
//
//   ★桩**必须返回真实形状** —— `()=>{}`（返回 undefined）会让断言永远绿，
//     这正是 wb-ui-v4 刚踩过的「vm 抽取加新依赖必须同步补桩」。
//   ★产品侧已同步简化：Phase1/Phase3 不再各自 resolvePaths，直接复用分支开头的 `p`
//     ⇒ 抽取分支不再引用 `exec` ⇒ 壳里不必注入 agent 对象（契约更干净）。
const WAL_LOG = { calls: [] }
function makeRunner(branch, over = {}) {
  const appendHandoffCheckpointPre = (over && over.appendHandoffCheckpointPre)
    || (async (storePath, opts) => {
      WAL_LOG.calls.push({ fn: 'append', storePath: storePath, kind: (opts && opts.kind) || 'handoff' })
      return { ok: true, eventId: 'evt_test0001', deduped: false }
    })
  const eventStorePathOfPre = (handoffDir) => String(handoffDir || '') + '\\event-store.json'
  const diagThrottled = () => {}
  const factory = new Function(
    'sanitizeForWrite', 'writeGateRefusalTextPre', 'nowHm',
    'appendHandoffCheckpointPre', 'eventStorePathOfPre', 'diagThrottled',
    'return async function (args, engine, p) {' + branch + '\n}')
  const sanitizeForWrite = (t, o) => ({ ok: true, clean: t, truncated: false })
  const writeGateRefusalTextPre = (n, g) => (n + ': ' + ((g && g.reason) || 'gate'))
  const nowHm = () => '16:00'
  const fn = factory(sanitizeForWrite, writeGateRefusalTextPre, nowHm,
    appendHandoffCheckpointPre, eventStorePathOfPre, diagThrottled)
  return (args, engine) => fn(args, engine, { projectDir: 'D:\\proj', handoffDir: 'D:\\proj\\handoff' })
}

const P_ = { projectDir: 'D:\\proj' }
function baseEngine(over = {}) {
  return Object.assign({
    memToday: () => '2026-10-12',
    // 2026-10-27 补桩：分支入口的 settings-root-changed 前置判定需要它
    projectDirOf: (ws) => String(ws || '\\proj').replace(/\\handoff$/, ''),
    state: {},
    async writePlanSnapshot() { return { ok: true, committed: true, revision: 'R1', indexStale: false, path: 'D:\\proj\\handoff\\PLAN.md', final: '# x' } },
    async writeHandoffLedger() { return { ok: true, path: 'D:\\proj\\handoff\\h.md', clean: 'body' } },
  }, over)
}

// ═══ ① 正文提交成功 + 派生索引失败：必须如实区分（本项目 #330 起的既有语义）═══
{
  const run = makeRunner(BRANCH)
  const r = await run({ kind: 'plan', content: '# 白板\n\n## 段\n内容足够长足够长' },
    baseEngine({ async writePlanSnapshot() { return { ok: true, committed: true, revision: 'R9', indexStale: true, path: 'D:\\proj\\handoff\\PLAN.md', final: '# x' } } }))
  ok(/已更新/.test(r), '① 正文成功 ⇒ 回执为「已更新」（不得报成失败）', JSON.stringify(r).slice(0, 90))
  ok(/派生索引更新失败/.test(r), '① 派生索引失败被**显式**告知（不静默）')
  ok(/revision: R9/.test(r), '① 仍给出 revision（正文确已提交）')
  ok(!/未写入|失败\(/.test(r), '① 负路径：不得把「正文已写但索引失败」当成未写入')
}

// ═══ ② 对照：索引正常时**不得**出现索引告警（防"恒报警"假绿）═══
{
  const run = makeRunner(BRANCH)
  const r = await run({ kind: 'plan', content: '# 白板\n\n## 段\n内容足够长足够长' }, baseEngine())
  ok(!/派生索引更新失败/.test(r), '② 负路径：索引正常时无索引告警')
  ok(/revision: R1/.test(r), '② 正常路径给出 revision')
}

// ═══ ③ 正文写盘失败：必须报失败，且不得声称已保存 ═══
{
  const run = makeRunner(BRANCH)
  const r = await run({ kind: 'plan', content: '# 白板\n\n## 段\n内容足够长足够长' },
    baseEngine({ async writePlanSnapshot() { return { ok: false, error: 'plan-write-failed' } } }))
  ok(/失败/.test(r), '③ 写盘失败被报出', JSON.stringify(r).slice(0, 90))
  ok(!/已更新/.test(r) && !/revision:/.test(r), '③ 负路径：失败时不得声称已保存/给出 revision')
  ok(/plan-write-failed/.test(r), '③ 失败原因透传（可排查）')
}

// ═══ ④ 重试幂等：同参二次调用，分类一致且无残留状态 ═══
{
  let calls = 0
  const engine = baseEngine({ async writePlanSnapshot() { calls++; return { ok: true, committed: true, revision: 'R1', indexStale: false, path: 'p', final: '# x' } } })
  const run = makeRunner(BRANCH)
  const args = { kind: 'plan', content: '# 白板\n\n## 段\n内容足够长足够长' }
  const r1 = await run(args, engine)
  const r2 = await run(args, engine)
  ok(calls === 2, '④ 重试真的再次提交（未被本地状态短路）', 'calls=' + calls)
  ok(r1 === r2, '④ 重试判定幂等：两次回执逐字一致')
}

// ═══ ⑤ 后续 IO 必须全部结束（无悬挂异步）═══
{
  let pending = 0
  const engine = baseEngine({
    async writePlanSnapshot() { pending++; try { await new Promise((r) => setTimeout(r, 5)); return { ok: true, committed: true, revision: 'R1', indexStale: false, path: 'p', final: '# x' } } finally { pending-- } },
  })
  const run = makeRunner(BRANCH)
  await run({ kind: 'plan', content: '# 白板\n\n## 段\n内容足够长足够长' }, engine)
  await new Promise((r) => setImmediate(r));
  ok(pending === 0, '⑤ 返回时后续 IO 已全部结束（无悬挂）', 'pending=' + pending)
}

// ═══ ⑥ handoff 分支：成功回执照写路径；截断必须显式告警（A-2 不回归）═══
{
  const run = makeRunner(BRANCH)
  const r = await run({ kind: 'handoff', content: '## 任务状态\n- x' }, baseEngine())
  ok(/交接账本已写入/.test(r) && /h\.md/.test(r), '⑥ handoff 成功回执照写路径', JSON.stringify(r).slice(0, 80))
  ok(!/截断/.test(r), '⑥ 负路径：未截断时不得出现截断告警')
}

// ═══ ⑦ 反向对照：把保护逻辑打坏 ⇒ 本套件必须变红（证明断言有鉴别力）═══
{
  const broken = BRANCH.replace("const planSaveLine = (r && r.indexStale ?", "const planSaveLine = (false ?")
  ok(broken !== BRANCH, '⑦ 变异锚命中（indexStale 判定）')
  const runB = makeRunner(broken)
  const rb = await runB({ kind: 'plan', content: '# 白板\n\n## 段\n内容足够长足够长' },
    baseEngine({ async writePlanSnapshot() { return { ok: true, committed: true, revision: 'R9', indexStale: true, path: 'p', final: '# x' } } }))
  ok(!/派生索引更新失败/.test(rb), '⑦ 变异后①的索引告警消失 ⇒ ①确有鉴别力（非恒真）')
  // ★★C1 后 ③ 的失败路径变成**两条**（真语义变化，不是测试问题）：
  //   ①早退分支 `if (!r || !r.ok) { … return 'memory_note: 白板写入失败(' + detail + ')。' }`
  //   ②Phase3 补偿块（同一 `if (!r || !r.ok)` 里 append plan-write-failed），不 return，
  //     但紧随其后的共用 return **仍会产出**「白板写入失败」。
  //   ⇒ 只改 ① 的话 ②仍存在、文案照样含「白板写入失败」⇒ 变异**无鉴别力**（实测连红 3 次才定位）。
  //   要验 ③ 的鉴别力，必须把**两条**都打掉：①条件恒假 + ②失败文案改名。
  const broken2 = BRANCH
    .replace('if (!r || !r.ok) {', 'if (false) {')
    .replace("return 'memory_note: 白板写入失败('", "return 'memory_note: XX('")
  ok(broken2 !== BRANCH, '⑦ 变异锚命中（失败早退 + 失败文案）', '差异 ' + (BRANCH.length - broken2.length) + ' 字符')
  const runB2 = makeRunner(broken2)
  const rb2 = await runB2({ kind: 'plan', content: '# 白板\n\n## 段\n内容足够长足够长' },
    baseEngine({ async writePlanSnapshot() { return { ok: false, error: 'plan-write-failed' } } }))
  ok(!/白板写入失败/.test(rb2), '⑦ 变异后③的失败回执消失 ⇒ ③确有鉴别力（非恒真）', JSON.stringify(String(rb2).slice(0, 60)))
}

// ═══ ⑨ ★C1 WAL 顺序：append 必须早于 writePlanSnapshot（真从被测代码记录）═══
{
  // ★数据源：patch **产品分支实际调用到的** engine.writePlanSnapshot，在入口里记「append 是否已发生」。
  //   WAL_LOG.calls 由注入桩 appendHandoffCheckpointPre 写入（桩被产品代码调用才记）
  WAL_LOG.calls.length = 0
  let appendSeenAtWrite = null
  let writeCalled = 0
  const engine = baseEngine({
    async writePlanSnapshot() {
      writeCalled += 1
      appendSeenAtWrite = WAL_LOG.calls.filter((x) => x.fn === 'append').length
      return { ok: true, committed: true, revision: 'R1', indexStale: false, path: 'p', final: '# x' }
    },
  })
  const run = makeRunner(BRANCH)
  await run({ kind: 'plan', content: '# 白板\n\n## 段\n内容足够长足够长' }, engine)
  ok(writeCalled === 1, '⑨a 探针真的进入了 writePlanSnapshot（防「探针没命中 ⇒ 断言无意义」）', 'writeCalled=' + writeCalled)
  ok(appendSeenAtWrite >= 1, '★★★⑨b WAL 顺序：进入 writePlanSnapshot 时 append **已发生**（事件优先）', 'append 数=' + appendSeenAtWrite)
  // 对照：kind 必须是 plan（不是把账本通道误用）
  const kinds = WAL_LOG.calls.filter((x) => x.fn === 'append').map((x) => x.kind)
  ok(kinds.every((k) => k === 'plan'), '★★⑨c append 的 kind 是 \'plan\'（不是 handoff）', JSON.stringify(kinds))
}

// ═══ ⑩ ★C1 Phase1 失败即中止：append 抛错 ⇒ writePlanSnapshot 一次都不能被调用 ═══
{
  WAL_LOG.calls.length = 0
  let writeCalled = 0
  const runFail = makeRunner(BRANCH, {
    appendHandoffCheckpointPre: async () => { throw new Error('store 不可写（模拟）') },
  })
  const engine = baseEngine({
    async writePlanSnapshot() { writeCalled += 1; return { ok: true, committed: true, revision: 'R1', path: 'p', final: '# x' } },
  })
  const r = await runFail({ kind: 'plan', content: '# 白板\n\n## 段\n内容足够长足够长' }, engine)
  ok(writeCalled === 0, '★★★⑩a Phase1 失败 ⇒ writePlanSnapshot **一次都没被调用**（事件优先，失败即中止）', 'writeCalled=' + writeCalled)
  ok(/失败/.test(String(r)), '★★⑩b 且如实报错（不静默）', JSON.stringify(String(r).slice(0, 70)))
  ok(!/已更新|已写入/.test(String(r)), '★★⑩c 负路径：不得声称成功', JSON.stringify(String(r).slice(0, 60)))
}
// ═══ ⑧ 开发期契约检查器必须通过（#332 第一项；真执行，非静态断言）═══
{
  const checker = pathModule.join(ROOT, 'tools', 'check-write-contract.mjs')
  ok(existsSync(checker), '⑧ 契约检查器文件存在')
  let code = 0, output = ''
  try { output = execFileSync(process.execPath, [checker], { encoding: 'utf8' }) }
  catch (e) { code = (e && e.status) || 1; output = String((e && e.stdout) || '') + String((e && e.stderr) || '') }
  ok(code === 0, '⑧ 契约检查器退出码 0（真执行子进程）', output.slice(0, 160))
  ok(/写入契约检查通过/.test(output), '⑧ 检查器确实跑了并自报通过（防「文件存在但空跑」）')
}
console.log('\n结果: ' + pass + ' PASS / ' + fail + ' FAIL')
process.exit(fail ? 1 : 0)
