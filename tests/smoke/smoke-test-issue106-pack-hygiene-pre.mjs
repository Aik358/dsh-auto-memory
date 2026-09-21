/**
 * issue #106 回归锁：发布产物卫生（npm 包内容边界）。
 *
 * 缺陷形状：`package.json` 的 `files` 只有 `docs` 一条正向声明，而 **`.gitignore` 不参与 `npm pack`**
 * ⇒ 仓库 2026-09-21 自己定下的「发布基座不得含备份文件」对产物完全无效：实测 6 个 tracked `.bak`
 * 随包发布；上一版宣传图（v3）在 v4 落地后仍躺在库里并被打进包。
 *
 * ★ 同时锁住**反方向**：`files` 含 `docs/` 是有意的既有决策（`lib/client.js:822` 的更新说明：
 *   用户文档随包发布，README 的「📖 用户文档」链接在 GitHub 与 npm 包页都要能点开）。
 *   因此本套件既拦「多余的东西进包」，也拦「把用户要看的文档误挤出包」。
 *
 * 不跑 npm（保持零依赖与确定性）：用「files 规则 + 磁盘现状 + README 引用」三方夹同一不变量。
 * 运行：node tests/smoke/smoke-test-issue106-pack-hygiene-pre.mjs
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)))
let pass = 0
let fail = 0
function ok(cond, name) {
  if (cond) { pass++; console.log('  ok - ' + name) } else { fail++; console.error('  FAIL - ' + name) }
}

const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
const files = Array.isArray(pkg.files) ? pkg.files : []
const POS = files.filter((f) => !f.startsWith('!'))
const NEG = files.filter((f) => f.startsWith('!'))

/** 递归列出目录内文件（相对 ROOT）；跳过依赖、VCS、隐藏目录与未跟踪的本地产物。 */
function walk(dir) {
  const out = []
  let entries
  try { entries = readdirSync(path.join(ROOT, dir), { withFileTypes: true }) } catch (_) { return out }
  for (const e of entries) {
    if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === 'artifacts') continue
    const rel = dir ? dir + '/' + e.name : e.name
    if (e.isDirectory()) out.push(...walk(rel))
    else out.push(rel)
  }
  return out
}
/** 该相对路径是否被 files 规则收进包（正向前缀命中且无负向命中）。 */
function packed(rel) {
  const inc = POS.some((f) => rel === f || rel.startsWith(f + '/'))
  if (!inc) return false
  return !NEG.some((g) => negHits(g.slice(1), rel))
}
/** 无通配的负向条目按**目录前缀**语义（npm 自己也这么解释 `!docs/internal`）；有通配才转正则。 */
function negHits(g, rel) {
  if (!/[*?]/.test(g)) return rel === g || rel.startsWith(g + '/')
  const re = new RegExp('^' + g.split('**').map((seg) => seg.split('*').map(escapeRe).join('[^/]*')).join('.*') + '$')
  return re.test(rel)
}
function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }

console.log('[H1] 仓库内不得有备份文件（.gitignore 的 *.bak 规则挡不住 npm pack）')
{
  const hits = [...walk('docs'), ...walk('tests'), ...walk('lib'), ...walk('python')].filter((f) => /\.bak($|[-.])/.test(f))
  ok(hits.length === 0, '工作树内零个 `.bak*` 文件（实得 ' + hits.length + '：' + hits.slice(0, 3).join(', ') + '）')
}

console.log('[H2] files 声明：既要有负向排除，正向条目也不能悬空')
{
  ok(NEG.some((f) => /bak/.test(f)), '存在 `.bak` 负向排除（因为 npm pack 不读 .gitignore）')
  ok(NEG.includes('!docs/internal'), '排除 docs/internal（内部事故记录不随包外发）')
  for (const f of POS) ok(existsSync(path.join(ROOT, f)), '正向条目真实存在（不写已失效的路径）: ' + f)
}

console.log('[H3] 入口与 exports 必须落在包内（exit 0 不等于装得上）')
{
  for (const [k, v] of Object.entries(pkg.exports || {})) {
    const rel = String(v).replace(/^\.\//, '')
    ok(existsSync(path.join(ROOT, rel)), 'exports["' + k + '"] 文件存在: ' + rel)
    ok(k === './package.json' || packed(rel), 'exports["' + k + '"] 会被打进包: ' + rel)
  }
  ok(packed('lib/index.js'), 'lib/index.js（宿主半边入口）在包内')
  ok(packed('lib/client.js'), 'lib/client.js（浏览器半边）在包内')
  ok(packed('cordis.patch.yml'), 'cordis.patch.yml（bundle 补丁）在包内')
  ok(existsSync(path.join(ROOT, 'python')) && packed('python/worker_v1.py'), 'python 侧车脚本在包内')
}

console.log('[H4] 反方向锁：用户要看的文档不能被误挤出包（client.js:822 的既有决策）')
{
  for (const f of ['docs/USER-GUIDE.zh-CN.md', 'docs/USER-GUIDE.en.md', 'docs/HANDBOOK.md', 'README.md']) {
    ok(existsSync(path.join(ROOT, f)), '存在于仓库: ' + f)
  }
  for (const f of ['docs/USER-GUIDE.zh-CN.md', 'docs/USER-GUIDE.en.md']) {
    ok(packed(f), '★ 仍在包内（README「📖 用户文档」链接要在 npm 包页点开）: ' + f)
  }
  ok(!packed('docs/internal/FEATURE-INVENTORY.md'), 'docs/internal 已不在包内')
}

console.log('[H5] 素材引用闭合：引用的必须在，素材目录里不许留孤儿')
{
  // 「被引用」按全仓文本口径算（README 与 docs 页/落地页/lib 都算），与人工核对 v3 banner 时同一把尺子。
  let corpus = ''
  for (const f of walk('')) {
    if (!/\.(md|html|js|mjs|json|yml)$/i.test(f)) continue
    try {
      const p = path.join(ROOT, f)
      if (statSync(p).size > 2 * 1024 * 1024) continue
      corpus += readFileSync(p, 'utf8')
    } catch (_) {}
  }
  const readmePair = readFileSync(path.join(ROOT, 'README.md'), 'utf8') + '\n' + readFileSync(path.join(ROOT, 'README.zh-CN.md'), 'utf8')
  const refs = [...new Set([...readmePair.matchAll(/docs\/[A-Za-z0-9._/\-]+\.(?:png|jpe?g|svg|gif)/g)].map((m) => m[0]))]
  ok(refs.length > 0, 'README 双版本共引用 ' + refs.length + ' 个 docs 素材（为 0 说明夹具失效，本锁失去意义）')
  const missing = refs.filter((r) => !existsSync(path.join(ROOT, r)))
  ok(missing.length === 0, '★ 被引用的素材都在盘上（缺 ' + missing.length + '：' + missing.slice(0, 3).join(', ') + '）')
  const shots = walk('docs/screenshots').filter((f) => /\.(png|jpe?g|svg)$/.test(f))
  // 白名单 = 本仓外可能仍被引用（GitHub profile / 站点仓库）的**历史双语截图**，2026-09-21 起挂账待确认。
  // 只用于放过存量，**新**孤儿一律拦下（v3 banner 就是删了 v2 之外又留下的那张）。
  const LEGACY_UNREFERENCED = [
    'docs/screenshots/calendar-en.png',
    'docs/screenshots/main-connect-en.png',
    'docs/screenshots/main-connect-zh.png',
    'docs/screenshots/overview-en.png',
    'docs/screenshots/overview-zh.png',
    'docs/screenshots/reflections-en.png',
    'docs/screenshots/search-zh.png',
    'docs/screenshots/settings-debug-zh.png',
  ]
  const orphan = shots.filter((f) => !corpus.includes(path.basename(f)) && !LEGACY_UNREFERENCED.includes(f))
  ok(orphan.length === 0, '★ 截图零新孤儿（孤儿 = 随包外发的死重量，v3 banner 即如此：' + orphan.join(', ') + '）')
  const staleAllow = LEGACY_UNREFERENCED.filter((f) => !existsSync(path.join(ROOT, f)))
  ok(staleAllow.length === 0, '★ 白名单不悬空（文件已删就把它从名单里划掉：' + staleAllow.join(', ') + '）')
}

console.log('\n--- issue #106 发布产物卫生 ---')
console.log('pass=' + pass + ' fail=' + fail)
process.exit(fail ? 1 : 0)
