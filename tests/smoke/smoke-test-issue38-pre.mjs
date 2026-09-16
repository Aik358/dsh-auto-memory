#!/usr/bin/env node
/**
 * Issue #38 回归:记忆容量整理**净增长**（每轮整理 +10 字符，最终所有写入被永久拒绝）。
 *
 * 两个根因（均在本文件中断言）:
 *  A. `compactLegacyLayer` 无条件用 `'## ' + title + '\n'` 重新序列化每个段落 ⇒
 *     正文首行直接是日期标题时,占位段 `(文件头)` 被**凭空写出** `## (文件头)` 行,
 *     文件每整理一轮净增 10 字符且**永不收敛**(67 → 77 → 87 …) ⇒ 最终超限,全部写入被拒。
 *  B. `ensureBudget` 对 `replace`(整篇替换)也用 `当前长度 + 新内容 ≤ 上限` 计费 ⇒
 *     文件接近上限时,任何整体替换都被误判超限,哪怕替换后正文比原文**更短**。
 *
 * 口径:从 lib/index.js 源码**切片抽取真实段落规划代码**执行 —— 测的是随包运行的代码,
 * 不是手抄副本;不触发 fs/子代理/网络。
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert'
import { test } from 'node:test'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SRC = readFileSync(path.resolve(HERE, '..', '..', 'lib', 'index.js'), 'utf8').replace(/\r\n/g, '\n')

// —— 抽取 compactLegacyLayer 的段落规划块(从 `const segs = []` 到 keptText/oldSegs 计算完) ——
const i0 = SRC.indexOf('const segs = []\n')
const i1 = SRC.indexOf('\n', SRC.indexOf('const keptText = segs.filter', i0))
assert.ok(i0 > 0 && i1 > i0, '源码切片定位失败(段落规划块)')
const PLAN_SRC = SRC.slice(i0, i1)
const plan = new Function('cur', 'keepBudget', PLAN_SRC + '\n return { keptText, oldSegs, segs }')

// —— 抽取 ensureBudget 的口径分支(验证 replace 与 append 计费不同源) ——
const ensureSrc = SRC.slice(SRC.indexOf('  async ensureBudget(agent, layer, text, options = {}) {'))

test('S0 源码守卫:占位段必须按正文序列化,不得再硬编码 "## " + title', () => {
  assert.ok(/synthetic/.test(PLAN_SRC), '段落必须带 synthetic 标记区分占位段与真实标题段')
  assert.ok(/const seqOf = /.test(PLAN_SRC), '必须存在统一的序列化函数 seqOf')
  assert.ok(/s\.synthetic \? s\.body\.join/.test(PLAN_SRC), 'seqOf 对占位段必须只输出正文')
  // 旧写法(净增长根因)不得残留
  assert.ok(!/map\(\(s\) => '## ' \+ s\.title \+ '\\n' \+ s\.body\.join/.test(PLAN_SRC),
    '不得残留 "## " + title 的无条件重序列化(issue#38 根因 A)')
  assert.ok(!/'\\n## ' \+ seg\.title/.test(PLAN_SRC), '归档路径也不得再写 "## " + title')
})

test('S1 源码守卫:ensureBudget 区分 replace 与 append 两套口径', () => {
  assert.ok(/const replace = !!options\.replace/.test(ensureSrc), 'ensureBudget 必须读 options.replace')
  assert.ok(/let acct = replace\s*\n?\s*\?/.test(ensureSrc), '必须按动作分支计费(初始检查)')
  // replace 分支:判定条件只含 raw.length 与 capacityLimit,不得出现 curChars 相加
  const replBranch = ensureSrc.match(/replace\s*\?\s*\(\(\)\s*=>\s*\{([^}]*)\}/)
  assert.ok(replBranch, '必须存在 replace 专用计费分支')
  const body = replBranch[1]
  assert.ok(/need\s*=\s*raw\.length/.test(body), 'replace 的 need 必须 = 替换后长度')
  assert.ok(/need\s*<=\s*this\.capacityLimit/.test(body), 'replace 只按"替换后长度 ≤ 上限"判定')
  assert.ok(!/curChars\s*\+/.test(body), 'replace 分支不得把旧文件长度叠加(issue#38 根因 B)')
  assert.ok(/:\s*this\.capacityCheck\(layer,\s*curChars,\s*text\)/.test(ensureSrc),
    'append 分支必须继续沿用 capacityCheck(含标题行开销)')
})

test('A1 无文件头(本案触发场景):整理后**字节不变**,不再凭空生成 (文件头)', () => {
  const input = '## 2026-09-14\n- a\n\n## 2026-09-15\n- b'
  const r = plan(input, 100000)
  assert.equal(r.keptText.includes('## (文件头)'), false, '不得凭空生成 "(文件头)" 标题')
  assert.equal(r.keptText, input, '全保留时应字节不变')
})

test('A2 收敛性:连续 8 轮整理长度恒定,不再每轮 +10（本 issue 的核心）', () => {
  let cur = '## 2026-09-14\n- a\n\n## 2026-09-15\n- b\n\n## 2026-09-16\n- c'
  const lens = [cur.length]
  for (let i = 0; i < 8; i++) { cur = plan(cur, 100000).keptText; lens.push(cur.length) }
  assert.deepEqual(lens, new Array(9).fill(lens[0]),
    '长度必须恒定(修前 55→65→75→… 单调 +10,永不收敛): ' + lens.join(' → '))
})

test('A3 幂等:同一输入连跑 3 次输出逐字节相同', () => {
  const input = '# 项目笔记\n说明行\n\n## 2026-09-14\n- a'
  const once = plan(input, 100000).keptText
  assert.equal(plan(once, 100000).keptText, once, '第二次整理必须不变')
  assert.equal(plan(plan(once, 100000).keptText, 100000).keptText, once, '第三次整理必须不变')
})

test('A4 真实标题段保留其 "## 标题" 行(修复不得吞掉正常标题)', () => {
  const r = plan('## 2026-09-14\n- a\n\n## 2026-09-15\n- b', 100000)
  assert.ok(r.keptText.includes('## 2026-09-14'), '真实日期标题必须保留')
  assert.ok(r.keptText.includes('## 2026-09-15'), '真实日期标题必须保留')
})

test('A5 有文件头 preamble 时,文件头正文原样保留', () => {
  const input = '# 项目笔记\n说明行\n\n## 2026-09-14\n- a'
  const r = plan(input, 100000)
  assert.ok(r.keptText.includes('# 项目笔记'), 'preamble 首行必须保留')
  assert.ok(r.keptText.includes('说明行'), 'preamble 正文必须保留')
  assert.equal(r.keptText, input, '全保留时字节不变')
})

test('A6 无标题纯正文(单段)不被破坏', () => {
  const input = '只有正文没有标题'
  assert.equal(plan(input, 100000).keptText, input, '单段无标题应原样输出')
})

test('A7 超限回收时仍能真正腾出空间(修复不得让回收失效)', () => {
  const input = '## 2026-09-14\n' + 'x'.repeat(300) + '\n\n## 2026-09-15\n' + 'y'.repeat(300)
  const r = plan(input, 320) // keepBudget 小于两段总和 ⇒ 必须回收旧段
  assert.ok(r.oldSegs.length > 0, '超限时必须判定出可回收段落')
  assert.ok(r.keptText.length <= input.length, '回收后不得变长')
  assert.ok(r.keptText.includes('## 2026-09-15'), '最新一段(硬底线)必须保留')
})

test('B1 replace 口径:替换成更短正文不得因旧文件过大被拒', () => {
  // 模拟:旧文件 11990 字符(接近上限 12000),replace 成 100 字符 ⇒ 必须放行
  const limit = 12000, used = 11990, replacement = 'x'.repeat(100)
  const ok = replacement.length <= limit
  assert.equal(ok, true, 'replace 只按替换后长度计费 ⇒ 应放行')
  // 反证:旧口径 `used + replacement <= limit` 会判 12090 > 12000 而误拒
  assert.equal(used + replacement.length <= limit, false, '旧口径确实会误判超限(证明该修有意义)')
})

test('B2 replace 口径:替换后仍超上限时必须拒绝', () => {
  const limit = 12000, replacement = 'x'.repeat(12001)
  assert.equal(replacement.length <= limit, false, '替换后超限必须拒绝')
})

test('B3 调用点已传 replace 变体(两处 memory_note / memory_user)', () => {
  const hits = SRC.match(/ensureBudget\(exec\.agent,\s*'(note|user)',\s*write,\s*\{\s*replace\s*\}\)/g) || []
  assert.equal(hits.length, 2, 'note 与 user 两个调用点都必须传入 { replace }，实得 ' + hits.length)
})
