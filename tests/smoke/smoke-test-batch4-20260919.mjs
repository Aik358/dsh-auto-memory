#!/usr/bin/env node
/**
 * smoke-test-batch4-20260919-pre.mjs —— 第四批上游 issue 修复套件（#68 JS/Python 分叉）
 *
 * #68：`semantic-decide.js` 的 JS 实现自称「与 Python 对齐」但有三处分叉
 * （权威实现 = `python/m7_activation_features_pre_v2.py`，两版 Python 逐字相同）：
 *   ① **1 字词**：Python `_WORD_RE = (?u)\b\w\w+\b`（≥2 字），旧 JS `+` 允许 1 字
 *   ② **全角数字**：Python `str.isalnum()` 对 `１２３` 为真，旧 JS `[a-z0-9]` 丢弃
 *   ③ **`é` 等带音标字母**：同上（Python isalnum 真，旧 JS 丢弃）
 * 另有一处**语义相反**的写法：旧 JS 把非字母数字**替换为空格**（`a-b` → `a b` 两词），
 *   而 Python 是**整删**（`a-b` → `ab` 一词）。
 */
import { normalizeText, charWbNgramCounts } from '../../lib/semantic-decide.js'
import { readFileSync } from 'node:fs'

let pass = 0, fail = 0
const ok = (c, n, x) => {
  if (c) { pass++; console.log('  ok -', n) }
  else { fail++; console.error('  FAIL -', n, x == null ? '' : x) }
}

console.log('\n[1] ① 1 字词不得进入 gram（Python `\\w\\w+` = ≥2 字）')
{
  const src = readFileSync(new URL('../../lib/semantic-decide.js', import.meta.url), 'utf8')
  ok(/\{\s*2,\s*\}/.test(src) && /_WORD_RE|WORD_RE = \/\[A-Za-z0-9_\\u4e00-\\u9fff\]\{2,\}\/g/.test(src),
    '★★ WORD_RE 已加 {2,} 下限（与 Python \\w\\w+ 对齐）')
  // 行为：单字中文/单字母不产生 gram；双字才产生
  const g1 = charWbNgramCounts('好', 1, 3)
  ok(Object.keys(g1).length === 0, '★ 单字「好」零 gram（Python 亦零）', JSON.stringify(g1))
  const g2 = charWbNgramCounts('好的', 1, 3)
  ok(Object.keys(g2).length > 0, '★ 双字「好的」有 gram')
}

console.log('\n[2] ② 全角数字必须保留（Python isalnum() 为真）')
{
  const n = normalizeText('１２３')
  ok(n === '１２３', '★★ 全角数字被保留（旧实现会整段丢弃）', JSON.stringify(n))
  ok(normalizeText('ＡＢＣ') === 'ａｂｃ', '★ 全角字母保留并小写', JSON.stringify(normalizeText('ＡＢＣ')))
}

console.log('\n[3] ③ 带音标字母必须保留（Python isalnum() 为真）')
{
  ok(normalizeText('café') === 'café', '★★ é 被保留', JSON.stringify(normalizeText('café')))
  ok(normalizeText('naïve') === 'naïve', '★ ï 被保留', JSON.stringify(normalizeText('naïve')))
}

console.log('\n[4] ④ 非字母数字必须「整删」而非「变空格」（Python 语义）')
{
  // 这是最易被判错的一条：`a-b` 在 Python 里是**一个词** ab，不是两个词
  ok(normalizeText('a-b') === 'ab', '★★ "a-b" → "ab"（整删，一个词）', JSON.stringify(normalizeText('a-b')))
  ok(normalizeText('hello, world!') === 'helloworld', '★★ 标点整删（连成一体）', JSON.stringify(normalizeText('hello, world!')))
  ok(normalizeText('部署流程 pnpm build') === '部署流程pnpmbuild',
    '★★ 中文+英文混合同样整删（Python 行为）', JSON.stringify(normalizeText('部署流程 pnpm build')))
  // 空白本身也不是 alnum ⇒ 一并整删（Python 同）
  ok(normalizeText('a  b') === 'ab', '★ 连续空白同样被整删', JSON.stringify(normalizeText('a  b')))
}

console.log('\n[5] 逐字复刻 Python 参照实现（真值表）')
{
  // 参照：python/m7_activation_features_pre_v2.py:78-79
  //   ''.join(ch for ch in str(text).lower() if ch.isalnum() or '\u4e00' <= ch <= '\u9fff')
  const pyRef = (text) => {
    let out = ''
    for (const ch of String(text).toLowerCase()) {
      const cp = ch.codePointAt(0)
      const alnum =
        (cp >= 0x30 && cp <= 0x39) || (cp >= 0x61 && cp <= 0x7a) || (cp >= 0x41 && cp <= 0x5a) ||
        (cp >= 0x4e00 && cp <= 0x9fff) || (cp >= 0xff10 && cp <= 0xff19) ||
        (cp >= 0x00c0 && cp <= 0x00ff && cp !== 0x00d7 && cp !== 0x00f7) || (cp >= 0x0100 && cp <= 0x017f)
      if (alnum) out += ch
    }
    return out
  }
  const CASES = ['a-b', 'hello, world!', '部署流程 pnpm build', 'café', '１２３', 'a  b', '', '   ', 'MiXeD_Case!', '问题：如何部署？']
  let same = 0
  for (const c of CASES) {
    const a = normalizeText(c), b = pyRef(c)
    if (a === b) same++
    else console.error('    ✗', JSON.stringify(c), 'JS=', JSON.stringify(a), 'PY=', JSON.stringify(b))
  }
  ok(same === CASES.length, `★★ 与 Python 参照真值表逐条一致（${same}/${CASES.length}）`)
}

console.log('\n[6] 反向锁：不得退回旧的分叉写法')
{
  const src = readFileSync(new URL('../../lib/semantic-decide.js', import.meta.url), 'utf8')
  ok(!/\.replace\(\/\[\^a-z0-9\\u4e00-\\u9fff\\s\]\/g, ' '\)/.test(src),
    '★★ 不再把非字母数字「变空格」（与 Python 整删相反）')
  ok(!/const WORD_RE = \/\[A-Za-z0-9_\\u4e00-\\u9fff\]\+\/g/.test(src),
    '★★ WORD_RE 不再允许 1 字词')
}

console.log(`\n[batch4-20260919] ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
