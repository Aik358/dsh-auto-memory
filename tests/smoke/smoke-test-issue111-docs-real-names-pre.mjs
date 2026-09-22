#!/usr/bin/env node
/**
 * [issue111] 文档 → 代码真值 守卫(上游 #111 的回归锁)。
 *
 * 背景:docs/HANDBOOK.md / USER-GUIDE.zh-CN.md / USER-GUIDE.en.md 曾把使用者指向
 * **不存在的路径**(端点前缀、诊断日志、hub/evidence 目录写成 pre 开发树的拼写),
 * 后果是用户按「附日志」清单打包交出空文件、维护者据此误判「插件零诊断输出」。
 *
 * ★本守卫的立场:**文档里每个事实都重新从代码取一遍**,不硬编码新值
 *   (硬编码只是把下一次漂移往后推)。推导链:
 *     ① 从 `tools/release.mjs` 解析**发布转换表**(`['pre 名','发布名']` 对)
 *     ② 从 `lib/index.js` 取 pre 树真值(端点字面量、诊断日志、配置名、memory 子目录)
 *     ③ 用①把②换成**发布名**——这正是用户装到的那个
 *     ④ 断言三个文档陈述的就是③
 *   ⇒ 将来代码/转换表任何一侧漂移,本守卫立刻红;而 docs 无需跟着改脚本。
 *
 * ★另外钉住两个"最容易改错"的点:
 *   · **不能整体替换 `-pre`**:`memory/degrade-pre/` 在转换表里没有对应规则,
 *     发布物里仍叫 `degrade-pre`。文档若写成 `memory/degrade/` 就是把人引向不存在的目录。
 *   · 不得出现写死维护者用户名的机器绝对路径(`C:\Users\<某人>\...`)。
 *
 * 只读、零网络、零副作用(不写任何文件,不改 process.env)。
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
let pass = 0, fail = 0
const ok = (cond, name, detail) => {
  if (cond) { pass++; console.log('  ok -', name) }
  else { fail++; console.error('  FAIL -', name); if (detail) console.error('         ' + detail) }
}
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8')
/** 文档里路径分隔符混用(表格用 `\`、正文用 `/`);比较前一律归一成 `/`,否则同一事实两种写法只认一种。 */
const norm = (s) => s.replace(/\\/g, '/')

// ---------- ① 发布转换表(唯一权威:tools/release.mjs) ----------
// ★缺 tools/release.mjs 时**显式跳过**（发布线未含 tools/），不要 ENOENT 崩：
//   崩溃会让「这条守卫在保护什么」彻底失焦；跳过会留下一行可读事实（今天哪一批没跑）。
let releaseSrc = ''
try { releaseSrc = read('tools/release.mjs') } catch (_) { releaseSrc = '' }
if (!releaseSrc) {
  console.log('[issue111-docs] SKIP：缺 tools/release.mjs（发布线未含 tools/）⇒ 转换口径检查今天未执行')
  console.log('[issue111-docs] pass=0 fail=0 skipped=1')
  process.exit(0)
}
// ★只扫 `const transforms = [` 到该数组收尾行之间的**表体**，不扫全文：早期实现扫全文，
//   于是注释/散文里任何「方括号 + 两个单引号字符串」都会被当成一条转换对并入表，且**先于真表生效**
//   ——实测一个示例短对把 a→b 混进表，relName() 随即把 /api/dsh-auto-memory/ 推成
//   /bpi/dsh-buto-memory-pre/，本套件 8 条断言集体假红（而真表一条没变）。
const TX0 = releaseSrc.indexOf('const transforms = [')
let txRegion = releaseSrc
if (TX0 >= 0) {
  const rest = releaseSrc.slice(TX0)
  const endM = /^\]\s*$/m.exec(rest)
  txRegion = endM ? rest.slice(0, endM.index) : rest
}
const TRANSFORMS = [...txRegion.matchAll(/\['([^']+)',\s*'([^']+)'\]/g)].map((m) => [m[1], m[2]])
ok(TRANSFORMS.length > 50, `解析到发布转换表(${TRANSFORMS.length} 条)`, 'tools/release.mjs 里 [pre 名, 发布名] 的字面量表')
/** 按发布流水线的顺序做**字符串替换** —— 与 release.mjs 对源码做的事同构。 */
const relName = (s) => { let o = String(s); for (const [a, b] of TRANSFORMS) o = o.split(a).join(b); return o }
// ★不变式哨兵：**不含任何 pre 标记的字符串不得被转换表改动**。真表每条 from 都带 -pre / _pre /
//   版本标记，故对纯发布名恒等；一旦表里混进伪对（如那个短对），这条立刻红。
const PROBE_NO_MARK = 'dsh-auto-memory'
ok(relName(PROBE_NO_MARK) === PROBE_NO_MARK,
  '★转换表不得改动不含 pre 标记的字符串（伪转换对会在此暴露）',
  `relName(${PROBE_NO_MARK}) = ${relName(PROBE_NO_MARK)}`)

// ---------- ② 源码真值(lib/index.js;pre 树) ----------
const src = read('lib/index.js')
const endpointLiterals = [...new Set([...src.matchAll(/'(\/api\/dsh-auto-memory[^']*)'/g)].map((m) => m[1]))]
ok(endpointLiterals.length > 0, `从 lib/index.js 取到端点字面量(${endpointLiterals.length} 条)`)
const PRE_PREFIX = endpointLiterals[0].split('/').slice(0, 3).join('/') + '/'
const REL_PREFIX = relName(PRE_PREFIX)
const diagPre = (src.match(/'dsh-auto-memory[^']*diagnose\.log'/) || [''])[0].slice(1, -1)
const cfgPre = (src.match(/'dsh-auto-memory[^']*\.json'/) || [''])[0].slice(1, -1)
ok(diagPre && cfgPre, '从 lib/index.js 取到诊断日志与配置文件名', `${diagPre} / ${cfgPre}`)
const memoryDirs = [...new Set([...src.matchAll(/path(?:Mod)?\.join\(dshHome\(\), 'memory', '([a-z-]+)'/g)].map((m) => m[1]))]

// ---------- ③ 期望的发布名 ----------
const REL_DIAG = relName(diagPre)
const REL_CFG = relName(cfgPre)
const REL_HUB = relName('hub')
const REL_EVIDENCE = relName('evidence')
ok(REL_PREFIX === '/api/dsh-auto-memory/', '端点前缀发布名由转换表推出', `实得 ${REL_PREFIX}`)
ok(REL_DIAG === 'dsh-auto-memory-diagnose.log', '诊断日志发布名由转换表推出', `实得 ${REL_DIAG}`)

// ---------- ④ 文档断言 ----------
const DOCS = ['docs/HANDBOOK.md', 'docs/USER-GUIDE.zh-CN.md', 'docs/USER-GUIDE.en.md']
const docs = new Map(DOCS.map((f) => [f, norm(read(f))]))

for (const [f, text] of docs) {
  ok(text.includes(REL_DIAG), `${f}: 诊断日志给的是发布名 ${REL_DIAG}`)
  // ★必须连**目录分隔符**一起匹配:`memory/hub` 是 `memory/hub` 的前缀,
  //   只比裸名会被 pre 写法"蹭"过去(变异实测:把 hub/ 全换成 hub/ 时裸名断言仍绿)。
  ok(text.includes(`memory/${REL_HUB}/`), `${f}: hub 目录给的是分隔完整的发布名 memory/${REL_HUB}/`)
  // 证据目录:HANDBOOK 记录了它,发布名必须到 events 一级
  if (text.includes('evidence')) {
    ok(text.includes(`memory/${REL_EVIDENCE}/events`), `${f}: 证据事件给的是发布名 memory/${REL_EVIDENCE}/events`)
  }
  ok(!text.includes('memory/degrade/'), `${f}: 不得把 degrade-pre 整体替换成 degrade(该目录在发布物里仍带 -pre)`)
  ok(!/C:\\Users\\/.test(text), `${f}: 无写死维护者用户名的机器绝对路径`)
}

// 端点前缀与条数:只对确实写端点的文档断言(HANDBOOK),条数从代码数出来
const hb = docs.get('docs/HANDBOOK.md')
ok(hb.includes(REL_PREFIX), `HANDBOOK: 端点前缀给的是发布名 ${REL_PREFIX}`)
const m51 = hb.match(/### 5\.1 主要端点（[^）]*共\s*\*\*(\d+)\*\*\s*条/)
ok(Boolean(m51), 'HANDBOOK: §5.1 端点条数以「共 **N** 条」形式给出')
if (m51) ok(Number(m51[1]) === endpointLiterals.length, 'HANDBOOK: §5.1 端点条数 = 代码里 unique 端点字面量数', `文档 ${m51[1]} vs 代码 ${endpointLiterals.length}`)
// 所有出现「端点」的行若带数量,都必须等于代码真值(防只改一处、别处留旧数)
for (const line of hb.split('\n')) {
  if (!line.includes('端点')) continue
  for (const m of line.matchAll(/(\d+)\s*条/g)) {
    ok(Number(m[1]) === endpointLiterals.length, 'HANDBOOK: 含「端点」的行内数量与代码一致', line.trim().slice(0, 90))
  }
}

// 工具数:从源码数 defineTool('name') 调用,再与 §6 标题/表格行数对账
const toolCalls = [...src.matchAll(/defineTool\('([a-z_]+)'/g)].map((m) => m[1])
const m6 = hb.match(/## 6\. 工具（模型可调用，(\d+) 个）/)
ok(Boolean(m6), 'HANDBOOK: §6 标题给出工具总数')
if (m6) {
  ok(Number(m6[1]) === toolCalls.length, 'HANDBOOK: §6 工具总数 = 源码 defineTool 调用数', `文档 ${m6[1]} vs 代码 ${toolCalls.length}`)
  const rows = [...hb.matchAll(/^\| `([a-z_]+)` \| `([a-z_]+)` \|/gm)]
  ok(rows.length === toolCalls.length, 'HANDBOOK: §6 表格行数 = 工具数(发布名 + pre 名 双列)', `表 ${rows.length} 行 vs 代码 ${toolCalls.length}`)
  const badPairs = rows.filter(([, rel, pre]) => relName(pre) !== rel)
  ok(badPairs.length === 0, 'HANDBOOK: §6 每行的「发布名 ↔ pre 名」符合发布转换表', badPairs.map((r) => r[0]).join(', ') || '')
}

// `memory/degrade-pre/` 的例外必须被显式写出来(否则下一个人整体替换时没人拦)
ok(memoryDirs.includes('degrade-pre'), 'degrade-pre 仍存在于源码 memory 子目录集合', memoryDirs.join(', '))
ok(relName('degrade-pre') === 'degrade-pre', '转换表确实不给 degrade-pre 改名(与文档的例外说明一致)')
ok(hb.includes('memory/degrade-pre/'), 'HANDBOOK: 显式记录了 memory/degrade-pre/ 这条例外')

// 「人能自己核」:文档必须内联**可运行的自核命令**(只断言存在,不在此执行——
// 冒烟套件里 spawn shell 会把「别机红」重新引回来,正是 #112 要消除的)。
ok(/node -e "/.test(hb), 'HANDBOOK: 内联了 node -e 自核命令(端点条数/前缀)')
ok(hb.includes('tools/release.mjs'), 'HANDBOOK: 自核命令读的是发布转换表(而不是硬编码新值)')

console.log(`\n[issue111-docs] pass=${pass} fail=${fail}`)
process.exit(fail ? 1 : 0)
