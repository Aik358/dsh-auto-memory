/**
 * issue #113 / #114 / #115 / #116 回归锁：QQ webhook 公开面的默认值与顺序。
 *
 * 这个文件是**部署在腾讯云函数上的公网服务**（CommonJS，`require` 即 `server.listen()`，
 * 且缺环境变量就 `process.exit(1)`），所以本套件不能把它 import 进来跑运行时断言。
 * 这里做的是**结构性守卫**：把四条缺陷各自的"修法形状"钉住，防止下一次改配置默认值时
 * 又漂回开放态（本轮四条里有三条正是"默认不安全"而非"代码写错"）。
 *
 * ★ 运行期行为（401/403 实际返回、验签通过路径、SCF 定时触发器带密钥）必须在部署侧按
 *   PR 描述里的 env 矩阵实测一遍，本套件不冒充那一步。
 *
 * 运行：node tests/smoke/smoke-test-issue113-116-webhook-guards-pre.mjs
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)))
const SRC = readFileSync(path.join(ROOT, '.github', 'cloud', 'qq-webhook', 'index.js'), 'utf8')
const code = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '') // 去注释：防注释自证

let pass = 0
let fail = 0
function ok(cond, name) {
  if (cond) { pass++; console.log('  ok - ' + name) } else { fail++; console.error('  FAIL - ' + name) }
}

console.log('[V1] 验签默认严格（issue #113）')
{
  ok(/strictVerify: process\.env\.STRICT_VERIFY !== '0'/.test(code), "★ STRICT_VERIFY 默认开（!== '0'）")
  ok(!/strictVerify: process\.env\.STRICT_VERIFY === '1'/.test(code), "旧的「显式设 '1' 才严格」写法已移除")
  ok(/if \(!ok && CFG\.strictVerify\)[\s\S]{0,120}writeHead\(401\)/.test(code), '验签失败且严格模式 ⇒ 401 且不再往下走')
  ok(/STRICT_VERIFY=0 显式放行,仅限本地联调/.test(SRC), '非严格分支的措辞已改为"显式放行的本地联调"（不再叫"继续处理"）')
}

console.log('[V2] 额度默认有限（issue #113 的第二半）')
{
  ok(/AI_MAX_PER_HOUR[\s\S]{0,180}\? 6 :/.test(code), '★ AI_MAX_PER_HOUR 默认 6（旧默认 0 = 不限额）')
  ok(!/maxPerHour: Number\(process\.env\.AI_MAX_PER_HOUR \|\| 0\)/.test(code), '旧的 `|| 0` 写法已移除')
  ok(/if \(CFG\.ai\.maxPerHour > 0\)/.test(code), '限流判据仍是 `> 0` ⇒ 默认 6 会真的生效')
}

console.log('[V3] 原始报文采集：默认关 + 顺序在验签之后（issue #116）')
{
  ok(/RAW_DEBUG = process\.env\.RAW_DEBUG === '1'/.test(code), '★ RAW_DEBUG 默认关（=== 1 才开）')
  ok(!/process\.env\.RAW_DEBUG \|\| '1'/.test(code), "旧的「默认 '1'」写法已移除")
  const verifyAt = code.search(/if \(!ok && CFG\.strictVerify\)/)
  const captureAt = code.search(/rawDebug\(req, raw\)\.catch/)
  ok(verifyAt > 0 && captureAt > verifyAt, '★ 采集点在验签判定**之后**（旧顺序在任何鉴权之前，匿名流量即可灌 gist）')
}

console.log('[V4] timer 入口 fail closed（issue #114）')
{
  ok(/TIMER_SECRET 未配置 ⇒ 定时入口一律拒绝/.test(code), '★ 未配 TIMER_SECRET ⇒ 直接拒绝（旧实现是 `CFG.timer.secret &&` 短路放行）')
  ok(!/if \(viaQuery && CFG\.timer\.secret &&/.test(code), '旧的「空密钥跳过校验」写法已移除')
  ok(!/CFG\.timer\.triggerName && tn &&/.test(code), '旧的「载荷省略 TriggerName 就跳过」写法已移除')
  ok(/missing timer secret/.test(code), 'POST 分支同样要求密钥（旧实现 POST 根本不查 key）')
  ok(code.includes("reason: 'trigger 不匹配: '"), '触发名不匹配会被拒绝')
  ok(code.includes("(载荷未带 TriggerName)"), '★ 载荷省略 TriggerName 不再等于跳过校验，原因里会写清')
}

console.log('[V5] 人用端点要凭据（issue #115）')
{
  ok(/function diagnosticsAuthorized\(req\)/.test(code), '存在统一的准入门函数')
  ok(/if \(!tok\) return false/.test(code), '★ 未配 ROUTE_TOKEN ⇒ return false（拒绝），而不是"门不存在"')
  const gate = code.search(/if \(!diagnosticsAuthorized\(req\)\)/g)
  ok(gate > 0, 'report/diag 分支引用了这道门')
  const reportAt = code.search(/includes\('report='\)/)
  const diagAt = code.search(/includes\('diag=1'\)/)
  ok(reportAt > 0 && diagAt > 0, '两个端点分支都还在（守卫范围有效）')
  const body = code.slice(reportAt, reportAt + 700)
  ok(/diagnosticsAuthorized\(req\)/.test(body), 'report 分支内即刻校验（读群聊原文之前）')
  const dbg = code.slice(diagAt, diagAt + 900)
  ok(/diagnosticsAuthorized\(req\)/.test(dbg), 'diag 分支内即刻校验（含 write=1 的匿名写）')
}

console.log('[V6] 诊断响应不再回显密钥形状与身份标识（issue #115）')
{
  ok(!/tail=\$\{CFG\.llm\.key\.slice\(-4\)\}/.test(code), '★ 不再回显 LLM key 的头 3 / 尾 4 / 长度')
  ok(!/ghTokenPrefix/.test(code), '★ 不再回显 ghToken 前 14 字符')
  // 只审 diag 响应体（`:112` 的 `{appId: CFG.appId, clientSecret}` 是**出站**换 token 的请求体，
  // 那是协议要求，不能一并禁掉）——把断言圈在 diag 对象里，避免守卫过宽变成假红来源。
  const diagObj = code.slice(code.search(/const diag = \{/), code.search(/gistProbe/))
  ok(diagObj.length > 100, '已定位到 diag 响应对象（守卫范围）')
  ok(!/appId: CFG\.appId\b/.test(diagObj), '★ diag 不再回显完整 appId（改为尾 4 位形状描述）')
  ok(!/gistId: CFG\.gistId\b/.test(diagObj), '★ diag 不再回显完整 gistId')
  ok(/appIdShape/.test(diagObj) && /gistIdShape/.test(diagObj), 'appId/gistId 以"配没配 + 尾 4 位"呈现')
  ok(!/botMentionId: CFG\.botMentionId\.slice/.test(code), '★ 不再回显机器人 mention 标识片段')
  ok(/keyFlags/.test(code), '密钥诊断降为布尔判据（含空白 / 已含 Bearer 前缀）')
  ok(/ghTokenConfigured: !!CFG\.ghToken/.test(code), 'diag 改为"配没配"布尔')
}

console.log('[V7] 请求体上限与部署标记')
{
  ok(/MAX_BODY = 1024 \* 1024/.test(code), '入站 body 上限 1MB（旧实现无界累积后 concat）')
  ok(/req\.on\('error'[\s\S]{0,160}413/.test(code), '超限走 413 结构化响应')
  const v = (SRC.match(/const VERSION = '([^']+)'/) || [])[1] || ''
  ok(/^webhook-[a-z]+-2026(09[2-9]|09(2[1-9]))/.test(v) || v > 'webhook-gist-20260914a', '★ 部署核对标记 VERSION 已随本轮安全改动前进：' + v)
}

console.log('\n--- issue #113-#116 webhook 默认值与顺序 ---')
console.log('pass=' + pass + ' fail=' + fail)
process.exit(fail ? 1 : 0)
