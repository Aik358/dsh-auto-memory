/**
 * release-spec.js —— registry 版本串的**信任边界校验**（纯函数，无副作用）。
 *
 * ============================ 为什么需要这个模块 ============================
 * 2026-11-23 安全报告（update-route-rce）实证：
 *   `lib/index.js` 的一键更新路由把 `dist-tags.latest`（**网络输入**）直接拼进
 *   `child_process.exec` 的命令字符串，而 exec 走 shell ⇒ `&` 可串联任意命令。
 *   实测：target = "3.4.3 & echo INJECTED > PWNED.txt & rem" 后半段照常执行。
 *
 * 根因不是「少加了引号」，而是**输入端跨了信任边界却没有校验**：
 * registry 的返回值属于不可信输入，绝不能进入 shell 命令构造。
 *
 * ============================ 本模块的职责（单一）============================
 * 只做一件事：判定一个 registry 版本串**是否可安全用于包安装规格**。
 * 不负责发请求、不负责拼命令、不写盘 —— 便于真 import → 真调用 → 断言返回值。
 *
 * ============================ 判据 ============================
 * 严格 semver：`MAJOR.MINOR.PATCH` + 可选 prerelease + 可选 build。
 * 额外限制（比 semver 规范更严，因为用途是 npm 规格串）：
 *   - 只允许 `[0-9A-Za-z.-]`（prerelease/build 内），杜绝 `& | ; $ \` 空格 引号 重定向`
 *   - 总长 ≤ 64（防御构造超长串）
 *   - 不得以 `.` 或 `-` 开头/结尾的片段（避免 `..` 之类）
 */

/** 严格版本串白名单：整串锚定，不允许任何 shell 元字符进入。 */
export const SAFE_VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/

/** 版本串长度上限（semver 实际用不到这么长，超出即视为异常输入）。 */
export const MAX_VERSION_LEN = 64

/**
 * 判定版本串是否可安全用于 `pkg@<version>` 规格。
 *
 * @param {unknown} raw registry 返回的原始值（可能任意类型）
 * @returns {{ ok: boolean, version: string, reason: string }}
 *   ok=true 时 version 是可安全使用的**规范化后**版本串（已 trim）；
 *   ok=false 时 version 恒为 ''，reason 说明拒绝原因（供诊断，不含原文以免日志注入）。
 */
export function validateReleaseVersionPre(raw) {
  if (typeof raw !== 'string') {
    return { ok: false, version: '', reason: 'not-a-string:' + (raw === null ? 'null' : typeof raw) }
  }
  const v = raw.trim()
  if (!v) return { ok: false, version: '', reason: 'empty' }
  if (v.length > MAX_VERSION_LEN) {
    return { ok: false, version: '', reason: 'too-long:' + v.length }
  }
  if (!SAFE_VERSION_RE.test(v)) {
    // 诊断里只回传**首发非法字符的类别**，不回传原文：
    //   原文可能含换行/控制字符，回传会把日志本身变成注入面。
    const bad = firstUnsafeCharCategory(v)
    return { ok: false, version: '', reason: 'unsafe-charset:' + bad }
  }
  // 片段级检查：'..' / 首尾 '.' 或 '-' 一律拒（semver 规范上合法但用途上没必要）
  if (/[.-]{2}|\.-|-\./.test(v) || /^[.-]|[.-]$/.test(v)) {
    return { ok: false, version: '', reason: 'bad-segment' }
  }
  return { ok: true, version: v, reason: '' }
}

/** 归类首个非法字符（只给类别，不给原文）。 */
function firstUnsafeCharCategory(s) {
  for (const ch of s) {
    if (!/[0-9A-Za-z.+-]/.test(ch)) {
      if (ch === '&' || ch === '|' || ch === ';') return 'shell-separator'
      if (ch === '$' || ch === '`') return 'shell-expansion'
      if (ch === '<' || ch === '>') return 'shell-redirect'
      if (ch === '"' || ch === "'" || ch === '\\') return 'shell-quote'
      if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') return 'whitespace'
      if (ch.charCodeAt(0) < 0x20 || ch.charCodeAt(0) === 0x7f) return 'control'
      return 'other'
    }
  }
  return 'unknown'
}

/**
 * 构造包安装**规格串**（`@scope/name@version`）。版本非法时**不产出规格**，
 * 由调用方走 ok:false 分支 —— 绝不降级成 `@latest` 静默继续。
 *
 * @param {string} pkgName 固定包名（应为本插件名，非网络值）
 * @param {unknown} rawVersion registry 返回的版本串
 * @returns {{ ok: boolean, spec: string, version: string, reason: string }}
 */
export function buildInstallSpecPre(pkgName, rawVersion) {
  const name = String(pkgName || '').trim()
  if (!name || !/^@?[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)?$/.test(name)) {
    return { ok: false, spec: '', version: '', reason: 'bad-package-name' }
  }
  const r = validateReleaseVersionPre(rawVersion)
  if (!r.ok) return { ok: false, spec: '', version: '', reason: r.reason }
  return { ok: true, spec: name + '@' + r.version, version: r.version, reason: '' }
}
