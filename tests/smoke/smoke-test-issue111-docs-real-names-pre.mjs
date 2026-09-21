/**
 * issue #111 回归锁：运维文档里的路径 / 前缀 / 数量必须由代码派生，不能各写一份。
 *
 * 缺陷形状：de-`-pre` 改名（fbc14fb）后，`docs/HANDBOOK.md`（新接手者首读）与
 * `docs/USER-GUIDE.{zh-CN,en}.md`（用户取日志的清单）仍写 `/api/dsh-auto-memory-pre/`、
 * `~/.dsh/memory/dsh-auto-memory-pre-diagnose.log`、`hub-pre\`、`evidence-pre\`，
 * 并把一条**必然空输出**的 grep 命令当作"以代码为准"的自证手段。后果：用户按清单打包日志
 * 交出空文件，维护者据此误判"插件零诊断输出"；接手者 curl 全 404，把"端点消失"当故障查。
 *
 * 本套件的做法是**把文档里的每个事实都重新从代码取一遍**，而不是硬编码新值——硬编码只是把
 * 下一次漂移往后推。运行：node tests/smoke/smoke-test-issue111-docs-real-names-pre.mjs
 */
import { API } from '../../lib/index.js'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)))
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8')

let pass = 0
let fail = 0
function ok(cond, name) {
  if (cond) { pass++; console.log('  ok - ' + name) } else { fail++; console.error('  FAIL - ' + name) }
}

const DOC_FILES = ['docs/HANDBOOK.md', 'docs/USER-GUIDE.zh-CN.md', 'docs/USER-GUIDE.en.md']
const docs = DOC_FILES.map((f) => ({ f, src: read(f) }))

// ── 代码侧真值（全部派生，不写死） ─────────────────────────────────────────
const prefixes = [...new Set(Object.values(API).map((v) => String(v).replace(/^(\/api\/[a-z-]+)\/.*$/, '$1')))]
ok(prefixes.length === 1, '代码里的端点前缀唯一：' + prefixes.join(', '))
const REAL_PREFIX = prefixes[0]
const REAL_ROUTES = Object.keys(API).length
const idxSrc = read('lib/index.js')
const diagName = (idxSrc.match(/'(dsh-auto-memory[a-z-]*\.log)'/) || [])[1]
ok(!!diagName, "从 lib/index.js 抓到诊断日志文件名：" + String(diagName))
const hubDir = (idxSrc.match(/path\.join\(dshHome\(\), 'memory', 'hub'\)/) ? 'memory/hub' : '')
ok(hubDir === 'memory/hub', 'M8 快照目录由代码确认为 memory/hub（无 -pre）')

console.log('[D1] 运维文档不得再出现 -pre 端点/日志/配置名（代码里已不存在）')
for (const { f, src } of docs) {
  ok(!/dsh-auto-memory-pre/.test(src), f + ' 零 `dsh-auto-memory-pre` 字样')
}
ok(!/dsh-auto-memory-pre/.test(idxSrc), '（前提）lib/index.js 里也确实没有该前缀 ⇒ 文档口径与代码一致')

console.log('[D2] 端点前缀与数量：文档写的必须等于代码派生值')
for (const { f, src } of docs.filter((d) => d.f.endsWith('HANDBOOK.md'))) {
  ok(src.includes(REAL_PREFIX + '/'), f + ' 使用代码里的真实前缀 ' + REAL_PREFIX + '/')
  ok(new RegExp('注册 ' + REAL_ROUTES + ' 个').test(src), f + ' 声明的端点数量 == Object.keys(API).length（' + REAL_ROUTES + '）')
  // 同一事实只允许一个值：手册里**每一处**「端点…N 个」都要等于派生值，防止只改 §5.1 而别处仍写 39
  const claims = [...src.matchAll(/端点[^。\n]{0,24}?(\d+)\s*个/g)].map((m) => Number(m[1]))
  ok(claims.length > 0, f + ' 共 ' + claims.length + ' 处端点数量声明（为 0 说明夹具失效）')
  ok(claims.every((n) => n === REAL_ROUTES),
    f + ' 所有端点数量声明都等于 ' + REAL_ROUTES + '（实得：' + [...new Set(claims)].join(', ') + '）')
}

console.log('[D3] 诊断日志：文件名对、层级也对（不在 memory/ 下）')
for (const { f, src } of docs) {
  if (!/诊断日志|Diagnostics log|拿日志|grab logs/.test(src)) continue
  ok(src.includes('~/.dsh/' + diagName), f + ' 指向 ~/.dsh/' + diagName)
  ok(!new RegExp('~/.dsh/memory/' + diagName).test(src), f + ' 没把日志错放到 memory/ 子目录')
}

console.log('[D4] 数据目录：文档写的 hub / evidence 路径必须与代码一致')
{
  const hand = docs.find((d) => d.f.endsWith('HANDBOOK.md')).src
  ok(/memory.hub.\{?episodes/.test(hand) || /memory\\\\hub/.test(hand), 'HANDBOOK 的 M8 目录写作 memory/hub（不带 -pre）')
  ok(/memory.evidence.(events|\\\\events)/.test(hand), 'HANDBOOK 的证据目录写作 memory/evidence/events（不带 -pre）')
  ok(!/hub-pre|evidence-pre/.test(hand), 'HANDBOOK 不再出现 hub-pre / evidence-pre')
}

console.log('[D5] 不再拿"必然空输出"的命令当自证手段')
{
  const hand = docs.find((d) => d.f.endsWith('HANDBOOK.md')).src
  const selfCheck = hand.includes('lib/index.js | sort -u')
  ok(selfCheck, '自证命令仍在（保留有用，前提是它取的是真前缀）')
  // 由代码派生期望串：`'<真前缀>/[a-z0-9-]+'` —— 不硬编码，避免文档与测试同时漂移
  ok(hand.includes(`'${REAL_PREFIX}/[a-z0-9-]+'`), '★ 自证命令里的前缀 == 代码真前缀 ⇒ 现在跑得出结果，不会把接手者引向"端点消失"')
  ok(/smoke-test-api-paths-pre\.mjs/.test(hand), '★ 手册另指了权威核对手段（api-paths 套件把两侧端点集锁在一起）')
}

console.log('[D6] 不把维护者机器路径写进公开手册')
{
  for (const { f, src } of docs) {
    const hits = src.match(/C:\\\\Users\\\\(?!JH Z)[^`"'|\s]*/g) || []
    void hits
    ok(!/C:\\\\Users\\\\JH Z/.test(src), f + ' 无写死的维护者用户名路径（改 ~/.dsh/ 或 %USERPROFILE%）')
    ok(!/~\/\.dsh\\\\|\.dsh\\\\memory\\\\dsh-auto-memory-diagnose/.test(src), f + ' 无 POSIX 前缀混反斜杠的半截路径')
  }
}

console.log('[D7] 磁盘上确实还带 -pre 的目录：文档若提到，必须与代码一致（防整体替换式"修错"）')
{
  const stillPre = [...idxSrc.matchAll(/'memory', '(degrade-pre|retrieval-pre)'/g)].map((m) => 'memory/' + m[1])
  ok(stillPre.length > 0, '代码里确有仍带 -pre 的落盘目录（本条前提）：' + [...new Set(stillPre)].join(', '))
  for (const { f, src } of docs) {
    const bad = [...src.matchAll(/memory[\\/](degrade|retrieval)(?!-pre)[a-z-]*/g)].map((m) => m[0])
    ok(bad.length === 0, f + ' 没把仍在用的 *-pre 目录写成裸名（改错方向 ⇒ 手册引向不存在的目录）：' + bad.join(', '))
  }
}

console.log('\n--- issue #111 运维文档口径 ---')
console.log('pass=' + pass + ' fail=' + fail)
process.exit(fail ? 1 : 0)
