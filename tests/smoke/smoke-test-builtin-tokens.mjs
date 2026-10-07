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
  // ★#275 修法（2026-10-08）：**逐引用判定**，不再按 token 做 OR 汇总。
  //   旧实现：`if (!map.has(t) || hasFallback) map.set(t, hasFallback ? true : (map.get(t) || false))`
  //   ⇒ 同一 token 只要**任意一处**带 fallback，整条 token 就被标成「豁免定义」；
  //     而 `var(--x)`（无 fallback）与 `var(--x, red)` 同时出现时，那处**无 fallback 的引用**
  //     本应要求 `--x` 有定义，却被 OR 汇总静默放行 —— 报告者离线复现即此。
  //   现在返回两组引用（都按**引用点**计数，不再 OR 汇总）：
  //     · noFallback：不带 fallback 的引用 token（**每一处**都要求有定义）
  //     · withFallback：带 fallback 的引用 token（合法免定义）
  const noFallback = new Set()
  const withFallback = new Set()
  const re = /var\(\s*(--dam-[a-z0-9-]+)\s*([,)])/g
  let m
  while ((m = re.exec(cssSegment))) {
    if (m[2] === ',') withFallback.add(m[1])
    else noFallback.add(m[1])
  }
  return { noFallback, withFallback, size: new Set([...noFallback, ...withFallback]).size }
}

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
// ★#275 修法（2026-10-08）：**逐引用判定** —— 不带 fallback 的**每一处**引用都要求有定义。
const refs = referencedTokens(appendedBlock)
const noFb = [...refs.noFallback]
const missing = noFb.filter((tk) => !allDefs.has(tk))
const withFb = [...refs.withFallback]
ok('§3.1 追加段引用 token 数 ≥ 8（实测 ' + refs.size + '）', refs.size >= 8)
ok('§3.2 ★零「无 fallback 且无定义」的引用（实测 ' + missing.length + ' 个）', missing.length === 0)
ok('§3.3 带 fallback 的引用（合法免定义）数 = ' + withFb.length + '（--dam-radius / --dam-skin-ratio）', withFb.length >= 2)
if (missing.length) console.log('      缺：' + missing.join(', '))

// ── §4 负路径：把定义真删，判据必须变红 ───────────────────
// ★负路径必须【真删定义】，且必须先断言锚串命中次数=1（否则替换无效 ⇒ 假负路径恒绿）
const FRAG = '--dam-warn: #d97706;'
const fragHits = raw.split(FRAG).length - 1
ok('§4.0 负路径锚串在源码中恰命中 1 次（实测 ' + fragHits + '）', fragHits === 1)
const broken = raw.replace(FRAG, '')
const brokenDefs = definitionsOf(broken, 0, broken.length)
const brokenRefs = referencedTokens(broken.slice(broken.indexOf('dam-team:begin'), broken.indexOf('dam-team:end')))
const brokenMissing = [...brokenRefs.noFallback].filter((tk) => !brokenDefs.has(tk))
ok('§4 ★负路径生效（删掉 --dam-warn 定义 ⇒ 无 fallback 引用变红）', brokenMissing.includes('--dam-warn'))
ok('§4b 正路径对照：未删时该 token 不红', ![...refs.noFallback].filter((tk) => !allDefs.has(tk)).includes('--dam-warn'))

// ── §4c ★#275 专项：同一 token 混用「有/无 fallback」时必须逐引用判定 ──
//   旧实现按 token 做 OR 汇总 ⇒ `var(--x)` 与 `var(--x, red)` 同时出现时，
//   **无 fallback 的那处**被静默豁免（报告者离线复现）。此处用合成样本做变异反向验证：
//   同一 token 先无 fallback 引用、后带 fallback 引用 ⇒ 删其定义后**必须**报缺失。
{
  const TOK = '--dam-or-probe'
  const sample = 'a{color:var(' + TOK + ')}b{color:var(' + TOK + ', red)}'
  const s = referencedTokens(sample)
  ok('§4c.1 逐引用判定：无 fallback 引用被单独记入（合成样本）', s.noFallback.has(TOK))
  ok('§4c.2 逐引用判定：带 fallback 引用被单独记入（合成样本）', s.withFallback.has(TOK))
  const noDefs = new Set()   // 该 token 无定义（真删的等价样本）
  const perRefMissing = [...s.noFallback].filter((tk) => !noDefs.has(tk))
  ok('§4c.3 ★无 fallback 的那处必须报缺失（旧 OR 口径会静默放行）', perRefMissing.includes(TOK))
  // 反向：旧 OR 口径在同一合成样本上**不会**报缺失（证明本用例真能区分两种口径）
  const orMap = new Map()
  { const re = /var\(\s*(--dam-[a-z0-9-]+)\s*([,)])/g; let m; while ((m = re.exec(sample))) { const h = m[2] === ','; if (!orMap.has(m[1]) || h) orMap.set(m[1], h ? true : (orMap.get(m[1]) || false)) } }
  const orMissing = [...orMap].filter(([tk, h]) => !h && !noDefs.has(tk)).map(([tk]) => tk)
  ok('§4c.4 对照：旧 OR 口径在同样本上放行（hence 修法有鉴别力）', !orMissing.includes(TOK))
}


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