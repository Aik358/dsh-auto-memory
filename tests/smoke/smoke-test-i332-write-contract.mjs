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

const ROOT = pathModule.join(pathModule.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..')
const SRC = readFileSync(pathModule.join(ROOT, 'lib', 'index.js'), 'utf8')

let pass = 0, fail = 0
const ok = (c, n, d) => { if (c) { pass++; console.log('  ok - ' + n) } else { fail++; console.log('  FAIL - ' + n + (d ? ' :: ' + d : '')) } }

// ── 真抽取：memory_note 的 plan/handoff 分支（从 `const content =` 到该分支闭合）──
function extractBranch(src) {
  const a = src.indexOf("      const content = args.kind === 'plan' ? String(args.content || '') : String(args.content || '').trim()")
  const marker = "      const replace = args.action === 'replace'";
  const b = src.indexOf(marker, a)
  assert.ok(a > 0 && b > a, '抽取 plan/handoff 分支命中')
  return src.slice(a, b).trimEnd()
}
const BRANCH = extractBranch(SRC)
ok(/indexStale/.test(BRANCH), '① 抽取段含 indexStale 判定（正文/索引区分）')
ok(/gateH\.truncated/.test(BRANCH), '① 抽取段含账本截断告警（A-2）')

// ── 可执行壳：注入替身（真源片段 + 受控写入器）──
function makeRunner(branch) {
  const factory = new Function('sanitizeForWrite', 'writeGateRefusalTextPre', 'nowHm',
    'return async function (args, engine, p) {' + branch + '\n}')
  const sanitizeForWrite = (t, o) => ({ ok: true, clean: t, truncated: false })
  const writeGateRefusalTextPre = (n, g) => (n + ': ' + ((g && g.reason) || 'gate'))
  const nowHm = () => '16:00'
  const fn = factory(sanitizeForWrite, writeGateRefusalTextPre, nowHm)
  return (args, engine) => fn(args, engine, { projectDir: 'D:\\proj' })
}

const P_ = { projectDir: 'D:\\proj' }
function baseEngine(over = {}) {
  return Object.assign({
    memToday: () => '2026-10-12',
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
  const broken2 = BRANCH.replace("if (!r || !r.ok) {", "if (false) {")
  ok(broken2 !== BRANCH, '⑦ 变异锚命中（失败早退）')
  const runB2 = makeRunner(broken2)
  const rb2 = await runB2({ kind: 'plan', content: '# 白板\n\n## 段\n内容足够长足够长' },
    baseEngine({ async writePlanSnapshot() { return { ok: false, error: 'plan-write-failed' } } }))
  ok(!/失败/.test(rb2), '⑦ 变异后③的失败回执消失 ⇒ ③确有鉴别力（非恒真）')
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
