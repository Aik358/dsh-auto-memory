import path from 'node:path'
import { realpathSync, lstatSync } from 'node:fs'

/**
 * ★V2-1（AUDIT §3.0 铁律 2 / §3.4）：**路径边界判据的单一来源**。
 *
 * 背景：同一件事「这个路径是不是在那个根之下」在本仓曾有四套判据 ——
 *   ① 纯词法 `path.resolve` + `startsWith(root + sep)`（零 IO，跟随链接读取即越界）；
 *   ② `real.startsWith(declaredRoot)`（realpath 了，但**缺目录边界** ⇒ 相邻同前缀目录漏检）；
 *   ③ 只用未归一 home 做词法 inside（别名下合法目标被误拒）；
 *   ④ 直接字符串相等判迁移（物理同根被误判为跨根迁移）。
 * 四套都在改、都要改对 ⇒ 本模块把它们收敛为三个函数，**任何地方不得再新起第五套**。
 *
 * 判据四联（与 PR#230 的 `fileWithinRoots` 同源，逐字保留其语义）：
 *   rel === '' 或 rel === '..' 或以 `'..' + path.sep` 开头 或 `path.isAbsolute(rel)` ⇒ 越界。
 * 只做 `startsWith` 会在「相邻同前缀」上漏检（root=/a/b、target=/a/bc/evil 的 rel 是 '../bc/evil'，
 * 组件级判据能拦住，字符串前缀判据拦不住）——这正是 #236 的成因。
 */

/** 物理路径归一化：realpath(自身) → realpath(最近存在祖先)+缺失后缀 → path.resolve。
 *  与引擎实例方法 `_canonPath` **逐字同口径**（同一函数体，见 lib/index.js 的同名委托）。
 *  非 win32 平台逐平台保真；win32 剥离 \\?\ 扩展前缀、把 \\?\UNC\ 还原为 \\server\share ——
 *  旧版 libuv 的 realpathSync.native 会带该前缀，不剥离会与既有字面口径处处不等。 */
export function canonPath(p) {
  const s = String(p || '')
  if (!s) return ''
  const stripWinPrefix = (x) => (process.platform === 'win32'
    ? (/^\\\\\?\\UNC\\/i.test(x) ? '\\\\' + x.slice(8) : /^\\\\\?\\/.test(x) ? x.slice(4) : x)
    : x)
  let r = ''
  try { r = realpathSync.native(s) } catch (e) { r = '' }
  if (!r) { try { r = realpathSync(s) } catch (e) { r = '' } }
  if (r) return stripWinPrefix(r)
  try {
    let cur = path.resolve(s)
    const suffix = []
    while (path.dirname(cur) !== cur) {
      suffix.unshift(path.basename(cur))
      const par = path.dirname(cur)
      let pr = ''
      try { pr = realpathSync.native(par) } catch (e) { pr = '' }
      if (!pr) { try { pr = realpathSync(par) } catch (e) { pr = '' } }
      if (pr) return path.join(stripWinPrefix(pr), ...suffix)
      cur = par
    }
  } catch (e) {}
  try { return path.resolve(s) } catch (e) {}
  return s
}

/** 平台路径键：canonPath + win32 小写化。大小写**敏感**文件系统上保留原样 ——
 *  过度归一化会把两个不同目录当成同一个（有意规避）。 */
export function pathKey(p) {
  const canonical = canonPath(p)
  return process.platform === 'win32' ? canonical.toLowerCase() : canonical
}

/** 组件级包含判定：child 是否就是 root 本身或位于 root 之下（两侧均按物理路径比较）。
 *  `allowSame` 控制「等于 root」算不算在内（默认算；`inside()` 语义的场景传 false）。 */
export function withinRoot(rootPhysical, childPhysical, { allowSame = true } = {}) {
  const rel = path.relative(rootPhysical, childPhysical)
  if (rel === '') return allowSame
  return rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel)
}

/** 返回**被校验过的物理路径**，供调用方直接拿去读写 ——
 *  否则调用方会拿着原路径再去 open 一次，那个链接可能已被重定向（PR#230 的原意）。
 *
 *  @param target       待判定路径
 *  @param roots        允许的根集合（每个根自身也做 physical 归一；不可解析的根不放行任何东西）
 *  @param strict       true ⇒ 必须**真在根之下**，等于根本身也拒
 *  @param allowMissing true ⇒ target 尚不存在时可解析（用于 mkdir 之前）；
 *                      但**悬空链接（dangling link）是已存在的条目**，一律拒 —— 它不是安全的新子目录。
 *  @returns 通过 ⇒ 物理路径字符串；不通过 ⇒ null
 *
 *  判据顺序（与 PR#230 的 fileWithinRoots 逐字一致）：
 *    ① realpath(target) 成功 ⇒ 用它；
 *    ② 失败且不是 ENOENT（或未开 allowMissing） ⇒ null；
 *    ③ allowMissing 时：lstat 能成功 = 悬空链接 ⇒ null；确认 ENOENT 才把
 *       「realpath(父目录) + basename」拼回。
 *    ④ 对每个根取 realpath 后做组件级 relative 四联。 */
export function fileWithinRoots(target, roots, { strict = false, allowMissing = false } = {}) {
  let physical
  try { physical = realpathSync(target) } catch (e) {
    if (!allowMissing || e.code !== 'ENOENT') return null
    // A dangling link is an existing entry, not a safe new child directory.
    try { lstatSync(target); return null } catch (missing) { if (missing.code !== 'ENOENT') return null }
    try { physical = path.join(realpathSync(path.dirname(target)), path.basename(target)) } catch (_) { return null }
  }
  for (const root of roots) {
    try {
      const relative = path.relative(realpathSync(root), physical)
      if ((!strict || relative) && !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep)) return physical
    } catch (_) { /* An unresolvable root grants no access. */ }
  }
  return null
}
