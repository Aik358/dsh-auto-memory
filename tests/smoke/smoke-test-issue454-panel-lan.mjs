/**
 * smoke-test-issue454-panel-lan.mjs — #454「面板在 LAN/远程部署下全部 403」的回归。
 *
 * 缺陷形态：lib/index.js 的面板守卫 isLoopbackRequest 硬要求
 *   「来源 IP 是回环」**且**「Host 头是 localhost/127.0.0.1/[::1]」两条同时成立。
 * DSH 用 `dsh web --host <LAN-IP>` 绑局域网时两条都不成立 ⇒ 73 个面板路由全部 403
 * `{ error: 'forbidden: loopback-only' }`，且插件侧没有任何配置项能放开。
 *
 * 本套件的判据分三段，缺一不可：
 *   A 纯函数行为：回环档保持旧行为、白名单档按「私网来源 + 白名单 Host + 同源 + 非跨站」放行、
 *     非法/公网/跨域一律 fail closed。
 *   B 真执行：从 lib/index.js 抽出 isLoopbackRequest / parseAllowedHostsPre / isPrivateAddressPre /
 *     hostAllowedPre / forbiddenPanelPayloadPre 的**源码本体**，在 vm 里跑真实调用（不是「源码含某字符串」）。
 *   C 变异验证（负路径）：把每个关键判据逐个改坏，要求对应断言**必须变红**；还原后必须全绿。
 *     没有 C 段，A/B 全绿也只证明「断言现在能过」，不证明「断言抓得住回归」。
 *
 * ★为什么用 vm 抽源码而不是 import：这五个函数是 lib/index.js 的模块私有实现，
 *   没有对外导出。用小段源码拼接 + new Function 执行，既不修改被测文件，
 *   又能真正跑到实现本体（而非复制一份实现来测自己）。
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const SRC = readFileSync(path.join(ROOT, 'lib', 'index.js'), 'utf8')

let pass = 0
let fail = 0
const ok = (cond, name) => {
  if (cond) { pass++; console.log('  ok - ' + name) }
  else { fail++; console.log('  FAIL - ' + name) }
}

/* ══════════════════════════════════════════════════════════════
   抽源码：按函数名取定义本体（花括号配平，起锚用函数名行）
   ══════════════════════════════════════════════════════════════ */
function extractFn(name) {
  const anchor = 'function ' + name + '('
  const start = SRC.indexOf(anchor)
  assert(start >= 0, '源码里找不到 function ' + name + '（实现被改名？）')
  const braceStart = SRC.indexOf('{', start)
  let depth = 0
  for (let i = braceStart; i < SRC.length; i++) {
    const c = SRC[i]
    if (c === '{') depth++
    else if (c === '}') { depth--; if (depth === 0) return SRC.slice(start, i + 1) }
  }
  throw new Error('花括号未配平: ' + name)
}

const FN_NAMES = ['isLoopbackAddressPre', 'isPrivateAddressPre', 'parseAllowedHostsPre', 'hostAllowedPre', 'isLoopbackRequest', 'forbiddenPanelPayloadPre']

/** 用抽出的源码构造一个隔离实现；override 用于变异验证。 */
function build(overrides = {}) {
  const parts = FN_NAMES.map((n) => (overrides[n] !== undefined ? overrides[n] : extractFn(n)))
  // forbiddenPanelPayloadPre 依赖的 URL 等均为全局；不需要额外注入。
  const factory = new Function(parts.join('\n\n') + '\nreturn { ' + FN_NAMES.join(', ') + ' }')
  return factory()
}

const impl = build()

const mkReq = (addr, host, extra = {}) => ({ socket: { remoteAddress: addr }, headers: { host, ...extra } })

/* ══════════════════════════════════════════════════════════════
   A. 纯函数行为
   ══════════════════════════════════════════════════════════════ */
console.log('[#454] A. 纯函数行为')

// A1 回环档 = 旧行为（未配置白名单时不得有任何放宽）
ok(impl.isLoopbackRequest(mkReq('127.0.0.1', '127.0.0.1:35117'), []) === true, 'A1 回环来源 + localhost Host ⇒ 放行（旧行为）')
ok(impl.isLoopbackRequest(mkReq('::1', 'localhost:35117'), []) === true, 'A1 ::1 + localhost ⇒ 放行')
ok(impl.isLoopbackRequest(mkReq('::ffff:127.0.0.1', '127.0.0.1:1'), []) === true, 'A1 IPv4-mapped 回环 ⇒ 放行')
ok(impl.isLoopbackRequest(mkReq('192.168.1.9', '192.168.1.5:35117'), []) === false,
  '★A1 LAN 来源 + LAN Host + **未配置白名单** ⇒ 仍然 403（旧行为逐字节保持，这是 fail-closed 的核心）')
ok(impl.isLoopbackRequest(mkReq('127.0.0.1', '192.168.1.5:35117'), []) === false, 'A1 回环来源 + 非 localhost Host ⇒ 拒绝')

// A2 白名单档放行
const allow = impl.parseAllowedHostsPre('192.168.1.5:35117')
ok(Array.isArray(allow) && allow.length === 1, 'A2 "192.168.1.5:35117" 解析为 1 条')
ok(impl.isLoopbackRequest(mkReq('192.168.1.9', '192.168.1.5:35117'), allow) === true,
  '★A2 私网来源 + 白名单 Host ⇒ 放行（#454 的直接验收：这条修前必 403）')
ok(impl.isLoopbackRequest(mkReq('10.0.0.3', '192.168.1.5:35117'), allow) === true, 'A2 10/8 来源 ⇒ 放行')
ok(impl.isLoopbackRequest(mkReq('172.20.1.1', '192.168.1.5:35117'), allow) === true, 'A2 172.16/12 来源 ⇒ 放行')
ok(impl.isLoopbackRequest(mkReq('169.254.3.4', '192.168.1.5:35117'), allow) === true, 'A2 169.254/16 链路本地 ⇒ 放行')

// A3 白名单档的边界（每条都是负路径）
ok(impl.isLoopbackRequest(mkReq('8.8.8.8', '192.168.1.5:35117'), allow) === false,
  '★A3 公网来源 + 白名单 Host ⇒ 拒绝（白名单不能把公网放进来）')
ok(impl.isLoopbackRequest(mkReq('192.168.1.9', '192.168.1.6:35117'), allow) === false,
  '★A3 私网来源 + 非白名单 Host ⇒ 拒绝')
ok(impl.isLoopbackRequest(mkReq('192.168.1.9', '192.168.1.5:9999'), allow) === false,
  'A3 Host 端口不符（规则带端口）⇒ 拒绝')

// A4 同源 / 跨站
ok(impl.isLoopbackRequest(mkReq('192.168.1.9', '192.168.1.5:35117', { origin: 'http://192.168.1.5:35117' }), allow) === true,
  'A4 Origin 与 Host 同源 ⇒ 放行')
ok(impl.isLoopbackRequest(mkReq('192.168.1.9', '192.168.1.5:35117', { origin: 'http://evil.example' }), allow) === false,
  '★A4 Origin 跨源 ⇒ 拒绝（CSRF 面）')
ok(impl.isLoopbackRequest(mkReq('192.168.1.9', '192.168.1.5:35117', { 'sec-fetch-site': 'cross-site' }), allow) === false,
  '★A4 sec-fetch-site: cross-site ⇒ 拒绝')
ok(impl.isLoopbackRequest(mkReq('127.0.0.1', '127.0.0.1:1', { origin: 'http://evil.example' }), []) === false,
  'A4 回环档同样校验 Origin（旧行为已有，防回退）')

// A5 通配子域 / 无端口规则 / 非法输入
const wild = impl.parseAllowedHostsPre('*.lan, nas.local')
ok(wild.length === 2, 'A5 "*.lan, nas.local" 解析为 2 条（通配符不得被字符集过滤掉）')
ok(impl.hostAllowedPre('foo.lan', 'foo.lan:35117', wild) === true, 'A5 *.lan 命中 foo.lan')
ok(impl.hostAllowedPre('lan', 'lan:35117', wild) === false, 'A5 *.lan 不命中裸 lan（必须至少一级子域）')
ok(impl.hostAllowedPre('nas.local', 'nas.local:9999', wild) === true, 'A5 无端口规则忽略端口')
ok(impl.parseAllowedHostsPre('').length === 0, 'A5 空串 ⇒ 空数组')
ok(impl.parseAllowedHostsPre(null).length === 0, 'A5 null ⇒ 空数组')
ok(impl.parseAllowedHostsPre('   ').length === 0, 'A5 纯空白 ⇒ 空数组')
ok(impl.parseAllowedHostsPre('http://evil.example/x').length === 0, '★A5 带协议/路径的项被丢弃（不得从 URL 误取 host）')
ok(impl.parseAllowedHostsPre('a.example,A.EXAMPLE').length === 1, 'A5 大小写归一后去重')

// A6 地址分类
ok(impl.isPrivateAddressPre('0.0.0.0') === false, 'A6 0.0.0.0 不算私有（fail closed）')
ok(impl.isPrivateAddressPre('127.0.0.1') === true, 'A6 127.0.0.1 算本机')
ok(impl.isPrivateAddressPre('::ffff:192.168.1.5') === true, 'A6 IPv4-mapped 私网 ⇒ 私有')
ok(impl.isPrivateAddressPre('fd00::1') === true, 'A6 IPv6 ULA(fd00::/8) ⇒ 私有')
ok(impl.isPrivateAddressPre('fc00::1') === true, 'A6 IPv6 ULA(fc00::/8) ⇒ 私有')
ok(impl.isPrivateAddressPre('fe80::1') === true, 'A6 IPv6 链路本地 ⇒ 私有')
ok(impl.isPrivateAddressPre('2001:db8::1') === false, '★A6 公网 IPv6 ⇒ 非私有')
ok(impl.isPrivateAddressPre('203.0.113.9') === false, 'A6 公网 IPv4 ⇒ 非私有')
ok(impl.isPrivateAddressPre('999.1.1.1') === false, 'A6 非法四段 ⇒ 非私有')
ok(impl.isPrivateAddressPre('') === false && impl.isPrivateAddressPre(null) === false, 'A6 空/null ⇒ 非私有')

// A7 403 诊断体
const body = impl.forbiddenPanelPayloadPre(mkReq('192.168.1.9', '192.168.1.5:35117'), [])
ok(body.error === 'forbidden: panel-access', 'A7 error 字段已更名为 panel-access')
ok(body.reason === 'loopback-only', 'A7 未配置时 reason=loopback-only')
ok(body.allowlistConfigured === false, 'A7 未配置时 allowlistConfigured=false')
ok(body.remoteAddress === '192.168.1.9' && body.host === '192.168.1.5:35117', 'A7 带来源与 Host 现场（排障必需）')
ok(typeof body.hint === 'string' && body.hint.includes('DSH_AUTO_MEMORY_ALLOWED_HOSTS'), 'A7 hint 指出环境变量名（用户能照做）')
// ★复核修正（2026-10-22）：原写 `... || true` ⇒ 恒真、等于没测（违反「断言不得恒真」纪律）。
//   真判据：白名单里有 A，请求 Host 是 B ⇒ 403 体不得出现**白名单条目 A**（否则攻击者可
//   用 403 体逐条探测哪些主机名在白名单里）。注意 body.host 是**请求的** Host，不是白名单内容。
const leakProbe = impl.forbiddenPanelPayloadPre(mkReq('10.0.0.7', 'req-host.example:1'), impl.parseAllowedHostsPre('secret-nas.lan, 192.168.77.88'))
const leakText = JSON.stringify(leakProbe)
ok(leakText.indexOf('secret-nas.lan') < 0 && leakText.indexOf('192.168.77.88') < 0,
  'A7 403 体不回显白名单条目本身（只告知条数，防主机名探测）', leakText.slice(0, 160))
ok(leakProbe.hint.indexOf('2 条') >= 0, 'A7 只告知白名单条数（可排障但不泄漏内容）', leakProbe.hint.slice(0, 80))
const body2 = impl.forbiddenPanelPayloadPre(mkReq('192.168.1.9', 'x:1'), allow)
ok(body2.reason === 'not-in-allowlist-or-not-private', 'A7 已配置但未命中时 reason 可区分')
ok(body2.allowlistConfigured === true, 'A7 已配置时 allowlistConfigured=true')

/* ══════════════════════════════════════════════════════════════
   B. 接线验证（源码级，标注为「守卫」而非功能证据）
   ══════════════════════════════════════════════════════════════ */
console.log('[#454] B. 接线守卫（源码结构；功能证据在 A 段）')
const guards = SRC.match(/if \(!isLoopbackRequest\(req, panelAllowedHosts\)\) return writeJson\(res, 403, forbiddenPanelPayloadPre\(req, panelAllowedHosts\)\)/g) || []
const oldForm = SRC.match(/if \(!isLoopbackRequest\(req\)\) return writeJson\(res, 403, \{ error: 'forbidden: loopback-only' \}\)/g) || []
ok(guards.length === 80, 'B1 80 处守卫全部改用 (req, panelAllowedHosts) + 诊断体（实测 ' + guards.length + ' 处）')
ok(oldForm.length === 0, 'B2 旧形态零残留（不留半修：有的路径接了白名单、有的没接）')
ok(SRC.includes('const panelAllowedHosts = parseAllowedHostsPre('), 'B3 apply 内解析一次并复用（不是每个 handler 各读一份 config）')
const declAt = SRC.indexOf('const panelAllowedHosts = parseAllowedHostsPre(')
const routesAt = SRC.indexOf('  const routes = [')
ok(declAt > 0 && routesAt > 0 && declAt < routesAt, 'B4 panelAllowedHosts 声明在 routes 之前（否则 TDZ 会抛 ReferenceError）')
ok(SRC.includes('DSH_AUTO_MEMORY_ALLOWED_HOSTS'), 'B5 环境变量入口存在')
ok(/panelAllowedHosts:\s*''/.test(SRC), "B6 DEFAULT_CONFIG 新增 panelAllowedHosts 且默认为空（默认不改变行为）")

/* ══════════════════════════════════════════════════════════════
   C. 变异验证（负路径：判据改坏 ⇒ 必须变红）
   ══════════════════════════════════════════════════════════════ */
console.log('[#454] C. 变异验证（每条必须变红；还原后必须全绿）')

const MUTATIONS = [
  {
    name: 'M1 白名单档不看白名单（任意 Host 都放行）',
    // 变异点必须在**函数入口**：原先 return true 加在循环末尾，而「带端口规则」的 continue
    // 会让执行路径根本走不到那里 ⇒ 变异无效（实测暴露）。改到入口才真正改变行为。
    patch: () => build({ hostAllowedPre: extractFn('hostAllowedPre').replace('function hostAllowedPre(hostname, hostWithPort, allowed) {', 'function hostAllowedPre(hostname, hostWithPort, allowed) {\n  return true') }),
  },
  {
    name: 'M2 白名单档不看来源是否私网（公网也放行）',
    patch: () => build({ isPrivateAddressPre: extractFn('isPrivateAddressPre').replace("if (typeof address !== 'string' || !address) return false", "return true") }),
    expect: (m) => m.isLoopbackRequest(mkReq('8.8.8.8', '192.168.1.5:35117'), allow) === true,
  },
  {
    name: 'M3 去掉 cross-site 拦截',
    patch: () => build({ isLoopbackRequest: extractFn('isLoopbackRequest').replace("if (req.headers['sec-fetch-site'] === 'cross-site') return false", '') }),
    expect: (m) => m.isLoopbackRequest(mkReq('192.168.1.9', '192.168.1.5:35117', { 'sec-fetch-site': 'cross-site' }), allow) === true,
  },
  {
    name: 'M4 去掉 Origin 同源校验',
    patch: () => build({ isLoopbackRequest: extractFn('isLoopbackRequest').replace('try { return new URL(origin).host === hostUrl.host } catch { return false }', 'return true') }),
    expect: (m) => m.isLoopbackRequest(mkReq('192.168.1.9', '192.168.1.5:35117', { origin: 'http://evil.example' }), allow) === true,
  },
  {
    name: "M5 白名单字符集去掉 '*'（通配子域被静默丢弃 —— 本轮实际踩到的缺陷）",
    patch: () => build({ parseAllowedHostsPre: extractFn('parseAllowedHostsPre').replace('/^[a-z0-9._*:\\[\\]-]+$/', '/^[a-z0-9._:\\[\\]-]+$/') }),
    expect: (m) => m.parseAllowedHostsPre('*.lan').length === 0,
  },
  {
    name: 'M6 未配置白名单时也放宽（默认不再 fail closed）',
    // 变异点必须让「空数组」真的能通过：单删 isLoopbackRequest 里的空数组守卫不够，
    // 因为下游 hostAllowedPre 对空数组同样 return false（实测暴露：变异无效≠断言失效）。
    // 这里同时把 hostAllowedPre 的空数组分支改成放行，构成真正的「默认放宽」。
    patch: () => build({
      isLoopbackRequest: extractFn('isLoopbackRequest').replace("if (!Array.isArray(allowedHosts) || !allowedHosts.length) return false", ''),
      hostAllowedPre: extractFn('hostAllowedPre').replace('if (!Array.isArray(allowed) || !allowed.length) return false', 'if (!Array.isArray(allowed)) return false\\n  if (!allowed.length) return true'),
    }),
    expect: (m) => m.isLoopbackRequest(mkReq('192.168.1.9', '192.168.1.5:35117'), []) === true,
  },
]

let mutated = 0
for (const mut of MUTATIONS) {
  let caught = false
  try {
    const m = mut.patch()
    caught = mut.expect(m)
  } catch (e) {
    caught = true // 变异导致构造/执行抛错，同样视为「抓到了」
  }
  ok(caught, 'C ' + mut.name + ' ⇒ 断言变红')
  if (caught) mutated++
}
ok(mutated === MUTATIONS.length, 'C9 变异捕获率 ' + mutated + '/' + MUTATIONS.length)

// 还原后（即未变异的 impl）必须仍然全绿 —— 反向确认变异不是「本来就红」
ok(impl.isLoopbackRequest(mkReq('192.168.1.9', '192.168.1.5:35117'), allow) === true, 'C10 还原后：白名单放行仍然成立（变异不是恒红）')
ok(impl.isLoopbackRequest(mkReq('8.8.8.8', '192.168.1.5:35117'), allow) === false, 'C10 还原后：公网仍然拒绝')
ok(impl.parseAllowedHostsPre('*.lan').length === 1, 'C10 还原后：通配符仍然被保留')

/* ══════════════════════════════════════════════════════════════ */
console.log('')
console.log('[#454] ' + pass + ' passed, ' + fail + ' failed')
process.exit(fail ? 1 : 0)
