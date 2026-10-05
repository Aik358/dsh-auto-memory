import { readdirSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'

/**
 * 影响面预检：只读工作区改动，按套件中的路径引用寻找候选回归。
 * 这是保守的文本启发式，并非完整的 JavaScript 依赖图。
 *
 * 输出：
 *   changed —— 本次改动的受管源码（lib/tests/tools/python/skins 下的源码类文件）
 *   hit     —— 依赖这些改动文件的套件（附命中的文件）
 *   lock    —— 基线锁套件（sha 哈希 / 路由计数 / 端点条数）。
 *
 * 命中集仅用于 --impact-run 的局部反馈；默认全量路径不据此排除任何套件。
 */
const LOCK_RE = /createHash\('sha256'\)|sha16|registeredRoutes\.length|expected \d+ routes|基线守恒|端点条数/
const MANAGED_RE = /^(lib|tests|tools|python|skins)\//
const SOURCE_RE = /\.(mjs|cjs|js|json|py|css)$/

function git(root, args) { return execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28 }) }

/**
 * 解析 `git status --porcelain -z` 的原样输出，返回涉及的文件路径（rename/copy 的新旧路径都给）。
 *
 * ★2026-10-04：改用 `-z`，因为默认 `--porcelain` 会把**非 ASCII 路径做八进制转义并加引号** ——
 *   中文名 `lib/中文.js` 会变成 `"lib/\344\270\255\346\226\207.js"`。此前实现只去掉首尾引号，
 *   于是拿到 `lib//344/270/255/346/226/207.js` 这种不存在的路径 ⇒ **中文文件名一律漏命中**
 *   （本机是中文环境，仓库路径也常含中文）。
 *   `-z` 用 NUL 分隔且不做路径转义；在该格式下 rename/copy 会**多跟一条源路径记录**
 *   （那条本身没有 `XY ` 前缀），所以不能按行解析。
 *   注意：`-z` 下路径保留原样（第 3 个字符起），**不要 trim** —— 路径本身可以以空格开头。
 *
 * @param raw `git status --porcelain -z` 的输出
 * @returns 文件路径数组（未去重、未过滤）
 */
export function parsePorcelainZ(raw) {
  const parts = String(raw).split('\0')
  const out = []
  for (let i = 0; i < parts.length; i++) {
    const rec = parts[i]
    if (!rec || rec.length < 4) continue // 最短形态 `XY P`
    const xy = rec.slice(0, 2)
    const p = rec.slice(3)
    if (!p) continue
    out.push(p)
    if (xy[0] === 'R' || xy[0] === 'C' || xy[1] === 'R' || xy[1] === 'C') {
      const from = parts[i + 1] // rename/copy 的源路径
      if (from) { out.push(from); i++ }
    }
  }
  return out
}

function changedManaged(root) {
  return [...new Set(parsePorcelainZ(git(root, ['status', '--porcelain', '-z']))
    .map((p) => p.replace(/\\/g, '/'))
    .filter((p) => !p.endsWith('/') && MANAGED_RE.test(p) && SOURCE_RE.test(p)))]
}

/** 抽出套件正文里所有「看起来像本地文件路径」的字符串字面量。 */
function referencedPaths(src) {
  const out = new Set()
  const push = (s) => {
    if (typeof s !== 'string' || !s) return
    if (!/[./]/.test(s)) return
    if (/^(node:|https?:|data:)/.test(s)) return
    out.add(s.replace(/\\/g, '/'))
  }
  for (const m of src.matchAll(/from\s+'([^']+)'/g)) push(m[1])
  for (const m of src.matchAll(/from\s+"([^"]+)"/g)) push(m[1])
  for (const m of src.matchAll(/['"]([^'"]*?(?:lib|skins|tools|python)\/[^'"]+)['"]/g)) push(m[1])
  return [...out]
}

/** 把引用串解析为仓库相对路径（粗解析，允许 ./ ../ 与裸相对路径）。 */
export function resolveRef(ref, suiteRelDir) {
  if (!ref.startsWith('.')) return ref.replace(/^\.\//, '')
  const joined = path.posix.normalize(path.posix.join(suiteRelDir, ref))
  return joined
}

export function analyzeImpact({ root, smokeDir }) {
  const changed = changedManaged(root)
  const changedSet = new Set(changed)
  const suites = readdirSync(smokeDir).filter((n) => n.endsWith('.mjs')).sort()
  const hit = new Map()
  const lock = []
  for (const name of suites) {
    let src = ''
    try { src = readFileSync(path.join(smokeDir, name), 'utf8') } catch (_) { continue }
    const suiteRel = 'tests/smoke'
    const reasons = new Set()
    for (const ref of referencedPaths(src)) {
      const rel = resolveRef(ref, suiteRel)
      if (changedSet.has(rel)) reasons.add(rel)
      // 也接受「指向仓库根的相对路径」写法（如 new URL('../../lib/x.js') 已被上面归一）。
      const base = rel.replace(/^\.\.\//, '')
      if (changedSet.has(base)) reasons.add(base)
    }
    if (changedSet.has(suiteRel + '/' + name)) reasons.add(suiteRel + '/' + name)
    if (reasons.size) hit.set(name, [...reasons])
    if (LOCK_RE.test(src)) lock.push(name)
  }
  const coreTouched = changed.some((c) => c === 'lib/index.js' || c === 'lib/client.js')
  return { changed, hit, lock, coreTouched }
}

export { analyzeImpact as default }
