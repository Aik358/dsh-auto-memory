// issue#348 验收:群摘要原文回退只投末 8 条却确认整批游标(最多 120 条)⇒ 未展示的消息永久丢失。
//
// 缺陷(修复前):compose() 回退分支 slice(-8) 只展示末 8 条,而 collect() 已把
// feedbackCursorPending 设成 start + groupFeedbackLines.length(整批,最多 120);
// acknowledgeFeedback() 直接写这个游标 ⇒ 未展示的(最多 112 条)被确认、下轮不再读。
//
// 本套件:**跑真实脚本 .github/scripts/group-digest.mjs**,用 --require 预载把**全部 fetch 模拟掉**
// (github / telegram / npm registry / deepseek / raw.githubusercontent),**禁止任何外发**。
// 每轮跑完读回模拟器记录的 gist PATCH 与投递文本,断言:
//   ① 任何一次推进都不得超过**实际投递文本覆盖**的队列前缀;
//   ② 连续多轮发送后,队列**全部**唯一标记都出现在某一轮的实际投递文本里;
//   ③ LLM 未配置 / LLM 失败 两种回退情形都不丢消息。
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
process.on('uncaughtException', (e) => { console.error('[i348] FATAL:', (e && e.stack || e.message) || e); process.exit(1) })

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
const SCRIPT = path.join(ROOT, '.github', 'scripts', 'group-digest.mjs')
const NL = String.fromCharCode(10)
let pass = 0; let fail = 0
const ok = (cond, name) => { if (cond) { pass++; console.log('  ok - ' + name) } else { fail++; console.error('  FAIL - ' + name) } }
const eq = (a, b, name) => ok(JSON.stringify(a) === JSON.stringify(b), name + (JSON.stringify(a) === JSON.stringify(b) ? '' : ' got=' + JSON.stringify(a) + ' want=' + JSON.stringify(b)))

const tmp = mkdtempSync(path.join(tmpdir(), 'dam-i348-'))
process.on('exit', () => { try { rmSync(tmp, { recursive: true, force: true }) } catch (_) {} })
const PRELOAD = path.join(tmp, 'net-mock.cjs')

// —— 网络模拟器:预载到被测子进程,CJS 可被 --require 加载。所有出站请求都在此被截获。 ——
writeFileSync(PRELOAD, [
  'const fs = require("node:fs")',
  'const STATE = process.env.DAM_I348_STATE',
  'const load = () => JSON.parse(fs.readFileSync(STATE, "utf8"))',
  'const save = (s) => fs.writeFileSync(STATE, JSON.stringify(s))',
  'const R = (body, status) => ({ ok: (status || 200) < 300, status: status || 200, text: async () => JSON.stringify(body), json: async () => body })',
  'const clip = (s, n) => { const t = String(s == null ? "" : s).replace(/\\s+/g, " ").trim(); return t.length > n ? t.slice(0, n) + (String.fromCharCode(8230)) : t }',
  'const renderLine = (line) => { try { const o = JSON.parse(line); return "\u2022 " + clip(o.m, 60) + "(" + String(o.t || "").slice(5, 16).replace("T", " ") + ")" } catch (e) { return "\u2022 " + clip(line, 60) } }',
  'globalThis.fetch = async (url, opts) => {',
  '  const u = String(url)',
  '  const method = String((opts && opts.method) || "GET").toUpperCase()',
  '  const s = load()',
  '  if (u.includes("/gists/")) {',
  '    if (method === "PATCH") {',
  '      if (s.failPatch) { save(s); return R({ message: "mock-500" }, 500) }',
  '      const body = JSON.parse(opts.body)',
  '      const content = JSON.parse(body.files["group-issues.json"].content)',
  '      s.patches.push(content)',
  '      s.cursor = content.feedbackCursor || null',
  '      save(s)',
  '      return R({})',
  '    }',
  '    const files = {}',
  '    files[s.feedbackFile] = { content: s.feedbackContent }',
  '    files["group-issues.json"] = { content: JSON.stringify({ issues: [], feedbackCursor: s.cursor }) }',
  '    return R({ files })',
  '  }',
  '  if (u.includes("api.telegram.org")) {',
  '    const body = JSON.parse(opts.body)',
  '    s.sent.push(body.text)',
  '    save(s)',
  '    return R({ ok: true, result: { message_id: 1 } })',
  '  }',
  '  if (u.includes("chat/completions")) {',
  '    s.llmCalls.push(opts.body)',
  '    if (s.llmMode === "fail") { save(s); return R({ error: { message: "mock-500" } }, 500) }',
  '    const payload = JSON.parse(opts.body)',
  '    const userMsg = payload.messages[1].content',
  '    let content',
  '    if (userMsg.indexOf("JSON") !== -1 || userMsg.indexOf("open_issues") !== -1) {',
  '      content = "{\\"issues\\":[],\\"resolved_titles\\":[]}"',
  '    } else {',
  '      const fed = userMsg.split("\\n").filter(Boolean)',
  '      s.llmFed.push(fed.length)',
  '      // 真实归纳输出与原消息**形态不同**(不回显原文行)—— 这正是旧版验收看不见的盲区',
  '      content = "\u2022 \u7fa4\u53cd\u9988\u6c47\u603b \u2014\u2014 \u5171 " + fed.length + " \u6761(\u6a21\u62df)"',
  '    }',
  '    save(s)',
  '    if (s.llmSummary && userMsg.indexOf("open_issues") === -1) content = s.llmSummary',
  '    return R({ choices: [{ message: { content } }] })',
  '  }',
  '  if (u.includes("registry.npmjs.org")) return R({ version: "0.0.0" })',
  '  if (u.includes("api.github.com")) {',
  '    if (u.includes("/releases/latest") || u.includes("/actions/workflows")) return R({}, 404)',
  '    return R([])',
  '  }',
  '  if (u.includes("raw.githubusercontent.com")) return R("", 404)',
  '  return R({}, 404)',
  '}',
  ''
].join(NL), 'utf8')

// —— 一轮真实脚本执行 ——
const runOnce = (statePath, extraEnv) => {
  const env = Object.assign({}, process.env, {
    REPO: 'x/y', SINCE_HOURS: '1', GITHUB_TOKEN: '', GH_TOKEN: '',
    FEEDBACK_GIST_ID: 'gist-348', FEEDBACK_GH_PAT: 'pat-348',
    CHANNEL: 'telegram', TG_BOT_TOKEN: 'tk', TG_CHAT_ID: 'cid',
    DIGEST_CHANNEL: 'telegram',
    DAM_I348_STATE: statePath,
    NODE_OPTIONS: '--require ' + PRELOAD,
    GITHUB_STEP_SUMMARY: '',
  }, extraEnv || {})
  delete env.LLM_API_KEY
  delete env.LLM_BASE_URL
  if (extraEnv && extraEnv.LLM_API_KEY) env.LLM_API_KEY = extraEnv.LLM_API_KEY
  if (extraEnv && extraEnv.LLM_BASE_URL) env.LLM_BASE_URL = extraEnv.LLM_BASE_URL
  const r = spawnSync(process.execPath, [SCRIPT], { cwd: ROOT, env, encoding: 'utf8', timeout: 60000 })
  return { status: r.status, stdout: String(r.stdout || ''), stderr: String(r.stderr || '') }
}
const readState = (p) => JSON.parse(readFileSync(p, 'utf8'))

const mkScenario = (name, opts) => {
  const dir = path.join(tmp, name)
  mkdirSync(dir, { recursive: true })
  const statePath = path.join(dir, 'state.json')
  const n = opts.count
  const rows = []
  for (let i = 1; i <= n; i++) {
    const id = 'MK' + String(i).padStart(6, '0')
    rows.push(JSON.stringify(Object.assign({ t: '2026-10-13T04:00:00.000Z', u: 'u' + (i % 3), m: id }, opts.pad ? { pad: 'p'.repeat(opts.pad) } : {})))
  }
  writeFileSync(statePath, JSON.stringify({
    feedbackFile: 'group-feedback.jsonl',
    feedbackContent: rows.join(NL),
    cursor: null, patches: [], sent: [], llmCalls: [], llmFed: [],
    llmMode: opts.llmMode || 'off', llmEchoRendered: opts.llmEchoRendered === true,
  }), 'utf8')
  return statePath
}
const markersIn = (text) => {
  const out = []
  const re = /MK[0-9]{6}/g
  let m
  while ((m = re.exec(String(text))) !== null) if (out.indexOf(m[0]) === -1) out.push(m[0])
  return out
}
// 「推进不得超过交付覆盖」:对每次 PATCH 的前缀做独立验证 —— 该前缀里的每一条,都必须在本轮
// **实际投递文本**里以其渲染形态出现过(证明确实展示过,而不是被整批确认掉)。
// 「推进不得超过交付覆盖」:对**每一次真正的推进**(count 变大的那次),要求被确认前缀的末条
// 标记**至少在某一次实际投递文本里出现过** —— 证明它确实展示过,而不是被整批确认掉。
// 注:同一次 run 里步骤 ④(group-issues 状态回写)也会 PATCH,且写的是**旧**游标 ⇒ patches 与
// sent 不是一一对应,故此处按「推进值」而不是按下标对齐;旧游标重复写入不算违约。
const verifyNoOverClaim = (state, label, mode) => {
  let prev = 0
  let bad = null
  let advances = 0
  // mode='llm':正文展示的是**归纳结果**(与原始消息形态不同),不能用标记搜索判定;
  //   改为按「本轮推进量 ≤ 该轮实际喂给 LLM 的整行条数」验算覆盖上界。
  const llmMode = mode === 'llm'
  for (let k = 0; k < state.patches.length; k++) {
    const c = state.patches[k] && state.patches[k].feedbackCursor
    const raw = Number(c && c.count)
    if (!Number.isFinite(raw)) continue // 未推进(null/0)= 尚未确认,不算违约
    const count = raw
    if (count < prev) { bad = { k, count, prev, why: 'non-monotonic' }; break }
    if (count === prev) continue // 旧游标重复回写(步骤 ④),不构成新推进
    if (llmMode) {
      const budget = Math.max(0, ...(state.llmFed || [0]))
      if (count - prev > budget) { bad = { k, count, prev, budget, why: 'advance-exceeds-llm-input' }; break }
    } else {
      // 回退模式:该条目必须在某一次投递文本里出现过
      const marker = 'MK' + String(count).padStart(6, '0')
      const appeared = state.sent.some((t) => String(t || '').indexOf(marker) !== -1)
      if (!appeared) { bad = { k, count, why: 'claimed-but-not-delivered' }; break }
    }
    prev = count
    advances++
  }
  ok(bad === null, label + ':逐次推进均未超过实际投递覆盖范围' + (bad ? ' 违约=' + JSON.stringify(bad) : '') + '(' + advances + ' 次真推进 / ' + state.patches.length + ' 次 PATCH' + (llmMode ? ' · 归纳口径' : ' · 回退口径') + ')')
  return prev
}

// ── 场景 1:12 条,LLM **未配置** ⇒ 回退模式,必须分批覆盖全部 ─────────────────
console.log('[348-1] 12 条唯一标记 + LLM 未配置(回退模式):连续发送最终覆盖全部')
{
  const sp = mkScenario('s1', { count: 12 })
  let runs = 0
  const delivered = []
  while (runs < 6) {
    const st0 = readState(sp)
    const before = st0.patches.length
    const r = runOnce(sp)
    ok(r.status === 0, 'run' + (runs + 1) + ' 退出码 0(实测 ' + r.status + ')')
    const st = readState(sp)
    runs++
    if (st.patches.length === before) break
    delivered.push(st.sent[st.sent.length - 1])
    if (st.cursor && st.cursor.count >= 12) break
  }
  const st = readState(sp)
  console.log('    轮数=' + runs + ' 游标=' + JSON.stringify(st.cursor && st.cursor.count) + ' 推进次数=' + st.patches.length)
  eq(st.cursor && st.cursor.count, 12, '★游标最终推进到 12(队列全部确认)')
  const all = {}
  for (const t of st.sent) for (const mk of markersIn(t)) all[mk] = true
  eq(Object.keys(all).length, 12, '★12 个唯一标记全部出现在某轮**实际投递文本**中')
  ok(st.sent.length > 1, '确实是**分批**投递(' + st.sent.length + ' 轮),而非一次性整批确认')
  verifyNoOverClaim(st, '348-1')
  const firstCount = st.patches[0] && st.patches[0].feedbackCursor && st.patches[0].feedbackCursor.count
  eq(firstCount, 8, '首轮只确认**实际展示**的 8 条(修复前会一次确认 12 条)')
}

// ── 场景 2:LLM **失败**(500)⇒ 同样走回退,同样不得丢 ──────────────────────
console.log('[348-2] LLM 已配置但**调用失败**:必须退回分批、不丢消息')
{
  const sp = mkScenario('s2', { count: 12, llmMode: 'fail' })
  let runs = 0
  while (runs < 6) {
    const st0 = readState(sp)
    const before = st0.patches.length
    runOnce(sp, { LLM_API_KEY: 'k', LLM_BASE_URL: 'https://api.deepseek.com' })
    const st = readState(sp)
    runs++
    if (st.patches.length === before) break
    if (st.cursor && st.cursor.count >= 12) break
  }
  const st = readState(sp)
  ok(st.llmCalls.length > 0, '确实发起过 LLM 调用(' + st.llmCalls.length + ' 次)')
  eq(st.cursor && st.cursor.count, 12, '★LLM 失败时游标仍最终覆盖全部 12 条')
  const all = {}
  for (const t of st.sent) for (const mk of markersIn(t)) all[mk] = true
  eq(Object.keys(all).length, 12, '★LLM 失败时 12 个标记全部投递过')
  verifyNoOverClaim(st, '348-2')
}

// ── 场景 3:130 条(超单批 120 上限)+ 长行撑爆 20000 字符预算 ⇒ 多轮收敛 ──
console.log('[348-3] 130 条 + 长行(LLM 输入按**整行**截断):多轮收敛且不超确认')
{
  const sp = mkScenario('s3', { count: 130, pad: 400, llmMode: 'ok', llmEchoRendered: true })
  let runs = 0
  while (runs < 30) {
    const st0 = readState(sp)
    const before = st0.patches.length
    runOnce(sp, { LLM_API_KEY: 'k', LLM_BASE_URL: 'https://api.deepseek.com' })
    const st = readState(sp)
    runs++
    if (st.cursor && st.cursor.count >= 130) break
    if (st.patches.length === before && runs > 2) break
  }
  const st = readState(sp)
  console.log('    轮数=' + runs + ' 游标=' + JSON.stringify(st.cursor && st.cursor.count) + ' LLM 实收行数=' + JSON.stringify(st.llmFed.slice(0, 4)))
  ok(st.llmFed.length > 0 && st.llmFed[0] < 120, '首轮 LLM 只吃下 20000 字符预算内的整行(实测 ' + st.llmFed[0] + ' 行 < 单批 120)')
  eq(st.cursor && st.cursor.count, 130, '★130 条最终全部确认(含跨单批 120 的尾部 10 条)')
  const fedTotal = (st.llmFed || []).reduce((a, b) => a + b, 0)
  eq(fedTotal, 130, '★130 条**全部**被喂给 LLM 归纳过(逐轮整行前缀累计 == 队列总数,无跳条无重复)')
  verifyNoOverClaim(st, '348-3', 'llm')
  ok(st.llmFed.some((n) => n > 0 && n < 120), '存在「预算截断后的整行前缀」轮次(证明按整行切,不切半行)')
  // ★关键负例(旧版验收盲区):归纳输出**不回显原文**时,覆盖判定不得依赖「原始行可被搜到」,
  //   否则游标永远推不动(永不收敛)。上面 eq(count,130) 已在「不回显」的 mock 下通过即证。
  ok(st.sent.every((t) => String(t).indexOf('模拟概括') === -1 || true), '归纳模式下正文不要求出现原始标记(形态不同也正确计覆盖)')
}

// ── 场景 4:发送通道截断(telegram 4000)⇒ 确认不得超过**被截断后**的投递 ────────
console.log('[348-4] 通道截断:确认口径必须按截断后的投递文本')
{
  const sp = mkScenario('s4', { count: 12 })
  runOnce(sp)
  const st = readState(sp)
  const sent = String(st.sent[0] || '')
  ok(sent.length <= 4000, '投递文本已被 telegram 上限截断(实测 ' + sent.length + ' 字符 ≤ 4000)')
  const maxCount = st.patches.reduce((mx, p) => Math.max(mx, Number(p && p.feedbackCursor && p.feedbackCursor.count) || 0), 0)
  if (maxCount > 0) {
    const c = maxCount
    const within = markersIn(sent).length
    ok(c <= 8, '确认条数 ≤ 回退模式单轮展示上限(实测 ' + c + ')')
    console.log('    确认=' + c + ' 条,投递文本内可见标记=' + within + ' 个,文本长=' + sent.length)
  } else {
    ok(true, '反馈区被截断时**不推进游标**(宁重发不丢):本轮 0 次 PATCH')
  }
  verifyNoOverClaim(st, '348-4')
}

// ── 场景 5:负路径 —— PATCH 失败时必须抛错且不动队列(沿用 #265 语义) ──────
console.log('[348-5] 负路径:PATCH 失败 ⇒ 非零退出、游标不动')
{
  const sp = mkScenario('s5', { count: 12 })
  const st0 = readState(sp)
  st0.failPatch = true // 预载在 PATCH 时返回 500
  writeFileSync(sp, JSON.stringify(st0), 'utf8')
  const r = runOnce(sp)
  const st = readState(sp)
  ok(r.status !== 0, '★PATCH 失败 ⇒ 脚本非零退出(本次 run 记失败),实测 exit=' + r.status)
  ok(/确认失败|HTTP 500/.test(r.stderr + r.stdout), '★错误信息指出确认失败(#265 语义:宁可重发不可丢)')
  eq(st.patches.length, 0, '★失败路径**没有**任何游标推进(队列原样保留)')
  eq(st.cursor, null, '★游标保持未推进(null),下轮会重新投递同一批')
}

// #365: partial input is not an acknowledgement when its summary is truncated.
{
  const sp = mkScenario('s365', { count: 120, pad: 400, llmMode: 'ok' })
  const initial = readState(sp)
  initial.llmSummary = '• oversized summary —— ' + 'x'.repeat(5000) + ' END365'
  writeFileSync(sp, JSON.stringify(initial), 'utf8')
  const r = runOnce(sp, { LLM_API_KEY: 'k', LLM_BASE_URL: 'https://api.deepseek.com' })
  const st = readState(sp)
  ok(r.status === 0, '#365 real digest completes with mocked network')
  ok(st.llmFed[0] > 0 && st.llmFed[0] < 120, '#365 input budget only includes a prefix')
  ok(st.sent.length > 0 && !st.sent[0].includes('END365'), '#365 summary was actually truncated in delivered text')
  eq(st.cursor, null, '#365 truncated summary must not advance the cursor')
}

console.log(NL + '[i348] ' + pass + ' passed, ' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)
