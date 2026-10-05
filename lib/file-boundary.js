import path from 'node:path'
import { realpathSync, lstatSync } from 'node:fs'

// Return the physical path that was checked, so callers do not read or write
// through the original, potentially retargeted symlink/junction afterwards.
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
