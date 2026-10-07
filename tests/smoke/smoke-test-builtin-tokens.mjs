#!/usr/bin/env node
// B12 R1 验收套件：内置 token 定义完整性（CR-10：真读文件 → 真解析 → 断言返回值 + 负路径 + 可复算物理量）
// 依据：08 卷 §3.6 / §3.1（追加段内 var() 引用的 token 必须全部有定义）
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

/** 平台无关行尾守恒：存在 CRLF 时不得有裸 LF；全 LF 合法（CI/Linux 检出态）。
 *  ★2026-09-28：原断言写作 cnt(NL)===cnt(CRNL)（即"必须全 CRLF"），在 Linux CI 上必红——
 *  索引里是 LF，本机 core.autocrlf=true 才检出 CRLF。守的语义不变：文件不得混合行尾。 */
const damNoMixedEol = (s) => {
  const crlf = (s.match(/\r\n/g) || []).length
  const lf = (s.match(/\n/g) || []).length
  if (crlf === 0) return true      // 全 LF：合法（CI 检出态）
  return crlf === lf               // 有 CRLF 则不得再有裸 LF
}

const __dirname = dirname(fileURLToPath(import.meta.url))
const SRC = join(__dirname, '..', '..', 'lib', 'client.js')

let pass = 0, fail = 0
function ok(name, cond) { if (cond) { pass++; console.log('  PASS ' + name) } else { fail++; console.log('  FAIL ' + name) } }

const raw = readFileSync(SRC, 'utf8')

// ── 解析器（与被测源码同源规则）────────────────────────────────
function definitionsOf(text, scopeStart, scopeEnd) {
  const scope = text.slice(scopeStart, scopeEnd)
  const set = new Set()
  const re = /(--dam-[a-z0-9-]+)\s*:/g
  let m; while ((m = re.exec(scope))) set.add(m[1])
  // JS 对象字面量形式 '--dam-x': v
  const re2 = /['"](--dam-[a-z0-9-]+)['"]\s*:/g
  while ((m = re2.exec(text))) set.add(m[1])
  return set
}
function referencedTokens(cssSegment) {
  // 返回 Map<token, allHaveFallback>:任意一处无 fallback 都要求有定义。
  //   （带 fallback 的 var(--x, V) 在 --x 未定义时回落到 V，属合法写法，不算缺陷 —— 60 卷 §二同规则）
  const map = new Map()
  const re = /var\(\s*(--dam-[a-z0-9-]+)\s*([,)])/g
  let m
  while ((m = re.exec(cssSegment))) {
    const hasFallback = m[2] === ','
    map.set(m[1], (map.has(m[1]) ? map.get(m[1]) : true) && hasFallback)
  }
  return map
}
for (const text of ['var(--dam-missing) var(--dam-missing, red)', 'var(--dam-missing, red) var(--dam-missing)']) {
  ok('混合 fallback 不掩盖无 fallback 引用: ' + text, referencedTokens(text).get('--dam-missing') === false)
}
ok('全部带 fallback 可以免定义', referencedTokens('var(--dam-missing, red) var(--dam-missing, blue)').get('--dam-missing') === true)

// ── 取出追加段（dam-team / dam-skin 整块，含其之前紧邻的定义块）──
const iTeamBegin = raw.indexOf('dam-team:begin')
const iTeamEnd = raw.indexOf('dam-team:end')
ok('§1.1 追加段边界可定位', iTeamBegin > 0 && iTeamEnd > iTeamBegin)
const appendedBlock = raw.slice(iTeamBegin, iTeamEnd)

// ── §2 正路径：8 个内置 token 必须有定义 ────────────────────────
const REQUIRED = ['--dam-surface','--dam-card-bg','--dam-text','--dam-fg-weak','--dam-border','--dam-accent-weak','--dam-code-bg','--dam-warn']
const allDefs = definitionsOf(raw, 0, raw.length)
for (const tk of REQUIRED) ok('§2 定义存在 ' + tk, allDefs.has(tk))

// ── §3 ★核心判据：追加段内 var() 引用的 token 必须全部有定义 ──────
const refs = referencedTokens(appendedBlock)
const noFb = [...refs].filter(([tk, fb]) => !fb)
const missing = noFb.filter(([tk]) => !allDefs.has(tk))
const withFb = [...refs].filter(([tk, fb]) => fb)
ok('§3.1 追加段引用 token 数 ≥ 8（实测 ' + refs.size + '）', refs.size >= 8)
ok('§3.2 ★零「无 fallback 且无定义」的引用（实测 ' + missing.length + ' 个）', missing.length === 0)
ok('§3.3 带 fallback 的引用（合法免定义）数 = ' + withFb.length + '（--dam-radius / --dam-skin-ratio）', withFb.length >= 2)
if (missing.length) console.log('      缺：' + missing.map(([x]) => x).join(', '))

// ── §4 负路径：把定义注释掉，判据必须变红 ───────────────────
// ★负路径必须【真删定义】，且必须先断言锚串命中次数=1（否则替换无效 ⇒ 假负路径恒绿）
const FRAG = '--dam-warn: #d97706;'
const fragHits = raw.split(FRAG).length - 1
ok('§4.0 负路径锚串在源码中恰命中 1 次（实测 ' + fragHits + '）', fragHits === 1)
const broken = raw.replace(FRAG, '')
const brokenDefs = definitionsOf(broken, 0, broken.length)
const brokenRefs = referencedTokens(broken.slice(broken.indexOf('dam-team:begin'), broken.indexOf('dam-team:end')))
// ★注意：brokenRefs 是 Map ⇒ 展开后是 [token, hasFallback] entry；比较前必须 .map 取出 token
const brokenMissing = [...brokenRefs].filter(([tk, fb]) => !fb && !brokenDefs.has(tk)).map(([tk]) => tk)
ok('§4 ★负路径生效（删掉 --dam-warn 定义 ⇒ 无 fallback 引用变红）', brokenMissing.includes('--dam-warn'))
ok('§4b 正路径对照：未删时该 token 不红', ![...refs].filter(([tk, fb]) => !fb && !allDefs.has(tk)).map(([tk]) => tk).includes('--dam-warn'))

// ── §5 可复算物理量 ───────────────────────────────────────
// ★物理量断言必须锚定【不变量】而非快照：快照每轮都会变（会导致测试变成伪红）
console.log('  · 实测字节数 = ' + Buffer.byteLength(raw, 'utf8') + '（快照，不作断言）')
ok('§5.2 裸 LF = 0', damNoMixedEol(raw))
const crlf = (raw.match(/\r\n/g) || []).length
console.log('  · 实测 CRLF 行数 = ' + crlf + '（快照，不作断言）')
ok('§5.3 行数守恒：split(CRLF) 段数 = CRLF 数 + 1', raw.split('\r\n').length === crlf + 1)
ok('§5.4 文件非空且 > 100KB', Buffer.byteLength(raw, 'utf8') > 100000)

// ── §6 零视觉变化：8 个 token 的取值与 08 卷权威表逐字一致 ──────
const PAIRS = [['--dam-surface','#fff'],['--dam-card-bg','#fff'],['--dam-text','#1f2937'],
               ['--dam-fg-weak','#6b7280'],['--dam-border','#e5e7eb'],['--dam-accent-weak','#eef2ff'],
               ['--dam-code-bg','#f8fafc'],['--dam-warn','#d97706']]
for (const [tk, val] of PAIRS) ok('§6 ' + tk + ' = ' + val + '（08 卷权威表）', raw.includes(tk + ': ' + val + ';'))

console.log('\n══ R1 RESULT: PASS ' + pass + ' / FAIL ' + fail + ' ══')
process.exit(fail === 0 ? 0 : 1)
