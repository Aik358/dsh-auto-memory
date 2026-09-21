#!/usr/bin/env node
/**
 * [issue112] 冒烟套件家目录隔离守卫(上游 #112 的回归锁)。
 *
 * 背景:`smoke-test-peer-probe-pre.mjs` / `smoke-test-m81-c2-wiring-pre.mjs` /
 * `smoke-test-m81-fact-metadata-pre.mjs` 曾读**真实 `~/.dsh`**(其中 fact-metadata 还手拼
 * `process.env.USERPROFILE || process.env.HOME`),后果是「本机绿、别机红」——
 * 「回归全绿」不可判定,因为绿灯描述的是**这台机器恰好有什么**,不是代码是否正确。
 *
 * 本守卫钉住四件事:
 *   ① 家目录口径唯一:`lib/dsh-home-pre.js` 的 `resolveDshHomePre()` 必须认 `DSH_HOME`
 *      (环境变量名从该模块的导出常量取,不硬编码)。
 *   ② 三个套件**不得再手拼家目录**:去注释后不得出现 `USERPROFILE` / `process.env.HOME` /
 *      `homedir` / `'.dsh'` 字面量——一律走 `DSH_HOME` 指向的一次性临时目录。
 *   ③ 三个套件必须**确实设置了** `DSH_HOME`,且位置足够靠前(在任何探测之前)。
 *   ④ 「空库/前提不成立」不得写成硬断言:旧写法 `... facts.length >= 1, '真实数据存在'` 消失,
 *      且隔离后有前提的套件必须给出**显式跳过**通道(空库是完全合法的状态)。
 *
 * ★断言前一律**去注释**:本仓教训——注释里引用旧写法会让守卫变成永久假红。
 *   去注释同时负责吃掉 CRLF 的 `\r`(逐行 `\r$` 剥离),否则行尾匹配会带 `\r`。
 *
 * 只读、零网络、零副作用。
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveDshHomePre, DSH_HOME_ENV_PRE_V1 } from '../../lib/dsh-home-pre.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
let pass = 0, fail = 0
const ok = (cond, name, detail) => {
  if (cond) { pass++; console.log('  ok -', name) }
  else { fail++; console.error('  FAIL -', name); if (detail) console.error('         ' + detail) }
}
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8')

/** 去注释(行尾 `\r` 一并剥离)。用于"注释里引用旧写法 ⇒ 永久假红"这一类源码文本断言。 */
function stripComments(src) {
  const noBlock = src.replace(/\/\*[\s\S]*?\*\//g, ' ')
  return noBlock.split('\n').map((l) => l.replace(/\r$/, '')).map((l) => l.replace(/\/\/.*$/, '')).join('\n')
}

// ---------- ① 家目录口径唯一(从代码取常量,不硬编码) ----------
ok(DSH_HOME_ENV_PRE_V1 === 'DSH_HOME', `环境变量名由 dsh-home-pre.js 导出(${DSH_HOME_ENV_PRE_V1})`)
const ORIGINAL = process.env[DSH_HOME_ENV_PRE_V1]
const PROBE = path.join(ROOT, '.vision-tmp') // 任意非空路径即可,只验证"认这个变量"
process.env[DSH_HOME_ENV_PRE_V1] = PROBE
ok(resolveDshHomePre() === PROBE, 'resolveDshHomePre() 认 DSH_HOME(钉临时目录即生效)')
ok(resolveDshHomePre(path.join(PROBE, 'x')).endsWith('x'), 'resolveDshHomePre(override) 显式入参优先于环境变量')
if (ORIGINAL === undefined) delete process.env[DSH_HOME_ENV_PRE_V1]
else process.env[DSH_HOME_ENV_PRE_V1] = ORIGINAL

// ---------- ②③④ 三个套件的源码文本断言(去注释后) ----------
const SUITES = [
  'tests/smoke/smoke-test-peer-probe-pre.mjs',
  'tests/smoke/smoke-test-m81-c2-wiring-pre.mjs',
  'tests/smoke/smoke-test-m81-fact-metadata-pre.mjs',
]
/** 手拼家目录的指纹:命中任一即说明它又去读真实 `~/.dsh` 了。 */
const HAND_BUILT = [
  ['USERPROFILE', '手拼 USERPROFILE'],
  ['process.env.HOME', '手拼 process.env.HOME'],
  ['homedir', '用 os.homedir() 拼家目录'],
  ["'.dsh'", "字面量 '.dsh'(家目录拼接)"],
]
/** 有环境的套件必须有显式跳过通道(空库/环境噪音不是 FAIL)。 */
const NEEDS_SKIP = ['tests/smoke/smoke-test-peer-probe-pre.mjs', 'tests/smoke/smoke-test-m81-fact-metadata-pre.mjs']

for (const rel of SUITES) {
  const raw = read(rel)
  const code = stripComments(raw)
  const codeLines = code.split('\n')
  const name = path.basename(rel)

  const hits = HAND_BUILT.filter(([needle]) => code.includes(needle)).map(([, why]) => why)
  ok(hits.length === 0, `${name}: 不再手拼家目录(去注释后)`, hits.join(' / '))

  // ★必须匹配**赋值**而不是子串:常量名 `HERMETIC_DSH_HOME` 自身就含 `DSH_HOME`,
  //   只判 includes() 会在「把赋值整行删掉」时依然绿(变异实测踩到)。
  const assignRe = new RegExp(`process\\.env\\.${DSH_HOME_ENV_PRE_V1}\\s*=|process\\.env\\[['"]${DSH_HOME_ENV_PRE_V1}['"]\\]\\s*=`)
  ok(assignRe.test(code), `${name}: 确实把 ${DSH_HOME_ENV_PRE_V1} **赋值**为一次性临时目录(而非仅出现名字)`)
  const firstAt = codeLines.findIndex((l) => assignRe.test(l))
  ok(firstAt >= 0 && firstAt < 60, `${name}: ${DSH_HOME_ENV_PRE_V1} 的赋值在文件前部(<60 行,先于任何探测)`, `实际第 ${firstAt + 1} 行`)

  // 旧硬断言(「真实库 ≥1 条」)必须消失
  ok(!/facts\.length\s*>=\s*1/.test(code), `${name}: 不再有 \`.facts.length >= 1\` 式硬断言`)
  ok(!code.includes('真实数据存在'), `${name}: 不再有 '真实数据存在' 前提硬断言`)

  if (NEEDS_SKIP.includes(rel)) {
    ok(/skipped\(/.test(code), `${name}: 前提不成立时有**显式跳过**通道(skipped(...))`)
  }
}

// 反向:旧写法本身必须已被清掉(否则上一条可能因为换了个变量名而"看起来"通过)
const fm = stripComments(read('tests/smoke/smoke-test-m81-fact-metadata-pre.mjs'))
ok(!/USERPROFILE\s*\|\|\s*process\.env\.HOME/.test(fm), 'fact-metadata: 旧的 `USERPROFILE || HOME` 家目录链已消失')
ok(fm.includes('resolveDshHomePre()'), 'fact-metadata: 夹具路径改走唯一口径 resolveDshHomePre()')

console.log(`\n[issue112-hermetic] pass=${pass} fail=${fail}`)
process.exit(fail ? 1 : 0)
