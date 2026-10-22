#!/usr/bin/env node
/**
 * smoke-test-team-compliance.mjs —— ★G-F3（E2E 明示）+ G-F5（不上报）· CR-10 真执行档
 *
 * ## 用户裁定（2026-09-27）
 * 「**脱敏无所谓，现在明文上就行**。这都是小公司，没有什么大的保密要求」
 *   ⇒ 不做脱敏；**但「不可用时必须明示」这条要落地**（严禁静默降级）。
 * 「**主要还是供给个人使用，公司是顺带的**」⇒ 默认档位必须是「不拦任何东西」。
 *
 * ## 方法（照抄 smoke-test-team-routes.mjs 的③级方法）
 * 抽产线 handler 源码 → `new Function` 真构造 → **真 await 调用** → 断言真 JSON。
 * ⇒ 断言对象是**产线代码的执行结果**，不是副本。
 *
 * ## 判据（含负路径）
 *  R 路由注册与形状真存在
 *  D1 off 档：明文 + ok:true（设计如此，不是错误）
 *  D2 ★unsupported 档：**ok:false + 明确原因码**（明示不可用，绝不静默降级为明文）
 *  D3 G-F5：默认不上报 + **即便开启也零出网**
 *  D4 teamEnabled=false：enabled:false（老用户无感）
 */
import { readFileSync } from 'node:fs'

let pass = 0, fail = 0
const failures = []
function ok(cond, name, got) {
  if (cond) { pass++ } else { fail++; failures.push(name + (got === undefined ? '' : ' | got=' + JSON.stringify(got))) }
}
function eq(a, b, name) { ok(a === b, name, { got: a, want: b }) }

const idx = readFileSync(new URL('../../lib/index.js', import.meta.url), 'utf8')

/** 括号/引号感知扫描取配对 `}`（照抄 team-routes 的权威写法）。 */
function scanBalanced(s, open) {
  let d = 0, q = null, esc = false
  for (let i = open; i < s.length; i++) {
    const ch = s[i]
    if (esc) { esc = false; continue }
    if (ch === '\\') { esc = true; continue }
    if (q) { if (ch === q) q = null; continue }
    if (ch === '"' || ch === "'" || ch === String.fromCharCode(96)) { q = ch; continue }
    if (ch === '{') d++
    else if (ch === '}') { d--; if (d === 0) return { end: i } }
  }
  return null
}

// ── R 路由形状 ─────────────────────────────────────────────────────────
ok(idx.includes("teamCompliance: '/api/dsh-auto-memory/team-compliance'"), 'R1 API 常量 teamCompliance 存在')
const start = idx.indexOf("path: API['teamCompliance'],")
ok(start > 0, 'R2 handler 挂在 API.teamCompliance 上')
const rest = idx.slice(start)
const hs = rest.indexOf('handler: async (req, res) => {')
ok(hs > 0, 'R3 handler 形如 async (req, res)')
const open = hs + 'handler: async (req, res) => {'.length - 1
const sc = scanBalanced(rest, open)
ok(!!sc, 'R4 括号配对扫描成功')
const handlerSrc = rest.slice(hs + 'handler: '.length, sc.end + 1)

/** 真构造 + 真调用（★必须 await —— handler 是 async，漏 await 会静默拿到 undefined）。 */
async function invoke(cfg) {
  const calls = []
  const writeJson = (res, code, body) => { calls.push({ code, body }) }
  const isLoopbackRequest = () => true
  const API = { teamCompliance: '/api/dsh-auto-memory/team-compliance' }
  const engine = { config: cfg }
  const fn = new Function('engine', 'writeJson', 'isLoopbackRequest', 'API', 'panelAllowedHosts', 'forbiddenPanelPayloadPre', 'return ' + handlerSrc)
  await fn(engine, writeJson, isLoopbackRequest, API, [], (req) => ({ error: 'forbidden: panel-access' }))({}, {})
  return calls
}

// ── D1 默认档位：明文（用户裁定）──────────────────────────────────────────
{
  const calls = await invoke({ teamEnabled: true, teamE2E: 'off', teamUsageReport: false })
  const r = calls[0]
  ok(!!r, 'D1a handler 真被调用（await 生效）')
  eq(r.code, 200, 'D1b 返回 200')
  eq(r.body.encryption.mode, 'off', 'D1c ★默认加密档位=off（明文，用户裁定）')
  eq(r.body.encryption.ok, true, 'D1d off 是与设计一致 ⇒ ok:true')
  eq(r.body.encryption.reason, 'plaintext-by-design', 'D1e 原因码正确')
}

// ── D2 ★负路径：客户要 E2E 但本版本没有 ⇒ 必须明示不可用 ─────────────────
{
  const calls = await invoke({ teamEnabled: true, teamE2E: 'unsupported' })
  const r = calls[0]
  eq(r.body.encryption.mode, 'unsupported', 'D2a 如实回传 unsupported')
  eq(r.body.encryption.ok, false, 'D2b ★★ok:false（明示不可用，绝不静默降级为明文）')
  eq(r.body.encryption.reason, 'e2e-unsupported', 'D2c 原因码明确')
}

// ── D3 G-F5：上报 ──────────────────────────────────────────────────────
{
  const r0 = (await invoke({ teamEnabled: true, teamUsageReport: false }))[0]
  eq(r0.body.reporting.enabled, false, 'D3a ★G-F5 默认不上报')
  eq(r0.body.reporting.everSendsNetwork, false, 'D3b ★零出网保证（默认）')
  const r1 = (await invoke({ teamEnabled: true, teamUsageReport: true, teamUsageLog: 'C:/tmp/u.log' }))[0]
  eq(r1.body.reporting.enabled, true, 'D3c 开启后开关生效')
  eq(r1.body.reporting.everSendsNetwork, false, 'D3d ★★即便开启，仍保证零出网')
  eq(r1.body.reporting.logPath, 'C:/tmp/u.log', 'D3e 显示本机日志路径')
}

// ── D4 个人用户：团队关闭 ───────────────────────────────────────────────
{
  const r = (await invoke({ teamEnabled: false }))[0]
  eq(r.body.enabled, false, 'D4 ★teamEnabled=false ⇒ enabled:false（老用户无感）')
}

if (fail) {
  console.log('FAIL ' + fail + ' / PASS ' + pass)
  for (const f of failures) console.log('  ✗ ' + f)
  process.exit(1)
}
console.log('PASS ' + pass + ' / FAIL 0  （G-F3 E2E 明示 + G-F5 零出网）')
