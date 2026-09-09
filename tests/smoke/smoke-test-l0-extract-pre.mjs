/**
 * smoke-test-l0-extract-pre —— L0 抽取纯核心（l0_extract_v1）回归锁定。
 * 纯 Node、零依赖、不联网；全部用例确定性（同输入同输出）。
 * 覆盖：锚点切分 / 三级 fallback / 时间戳剥离 / 短句并接 / 边界 / 确定性。
 */
import assert from 'node:assert/strict'
import { parseMemoryItemsPre, extractL0Pre, buildL0IndexPre, L0_EXTRACT_VERSION } from '../../lib/l0-extract.js'

let pass = 0, fail = 0
const t = (name, fn) => { try { fn(); pass++ } catch (e) { fail++; console.error(`FAIL ${name}: ${e.message}`) } }
const id = (c) => 'mem_' + c.repeat(32)
const anchor = (c) => `<!-- memory:mem_${c.repeat(32)} -->`

// ---------- 版本 ----------
t('version', () => assert.equal(L0_EXTRACT_VERSION, 'l0_extract_v1'))

// ---------- parseMemoryItemsPre ----------
t('parse: 单锚点单条目', () => {
  const r = parseMemoryItemsPre(`${anchor('a')}\n- 12:01 内容甲`)
  assert.equal(r.anchors, 1)
  assert.equal(r.items.length, 1)
  assert.equal(r.items[0].id, id('a'))
  assert.match(r.items[0].body, /内容甲/)
})
t('parse: 多锚点多条目', () => {
  const r = parseMemoryItemsPre(`${anchor('a')}内容一${anchor('b')}内容二${anchor('c')}内容三`)
  assert.equal(r.items.length, 3)
  assert.equal(r.items[0].body, '内容一')
  assert.equal(r.items[2].id, id('c'))
})
t('parse: 锚点前游离内容归 preamble', () => {
  const r = parseMemoryItemsPre(`游离头${anchor('a')}正文`)
  assert.equal(r.preamble, '游离头')
  assert.equal(r.items[0].body, '正文')
})
t('parse: 无锚点 → 全部归 preamble，零条目', () => {
  const r = parseMemoryItemsPre('纯文本，没有锚点。')
  assert.equal(r.items.length, 0)
  assert.equal(r.anchors, 0)
  assert.match(r.preamble, /纯文本/)
})
t('parse: 锚点紧邻 → 空体条目被跳过', () => {
  const r = parseMemoryItemsPre(`${anchor('a')}${anchor('b')}B 内容`)
  assert.equal(r.items.length, 1)
  assert.equal(r.items[0].id, id('b'))
})
t('parse: 空输入 / null → 零条目不抛', () => {
  assert.equal(parseMemoryItemsPre('').items.length, 0)
  assert.equal(parseMemoryItemsPre(null).items.length, 0)
})

// ---------- extractL0Pre ----------
t('l0: ① 主题块标题优先，剥离（HH:MM）后缀', () => {
  const r = extractL0Pre('## 召回提醒强度实验命题入档（12:02）\n- 要点甲')
  assert.equal(r.source, 'heading')
  assert.equal(r.l0, '召回提醒强度实验命题入档')
})
t('l0: ② 首条目首句 + 时间戳剥离', () => {
  const r = extractL0Pre('- 14:23 用户报告了发布管道问题需要立即处理')
  assert.equal(r.source, 'firstSentence')
  assert.equal(r.l0, '用户报告了发布管道问题需要立即处理')
})
t('l0: ② 短首句并接后续句，并剥列表标记与时间戳', () => {
  const r = extractL0Pre('- 09:01 完成。\n- 09:02 另一件事开始做了很多工作')
  assert.equal(r.source, 'firstSentence')
  assert.equal(r.l0, '完成。另一件事开始做了很多工作')
})
t('l0: ② 无时间戳的条目不受影响', () => {
  const r = extractL0Pre('- 修复了某个紧急 bug 并且验证通过')
  assert.equal(r.l0, '修复了某个紧急 bug 并且验证通过')
})
t('l0: ③ 无标题无条目 → 截断兜底', () => {
  const r = extractL0Pre('普通段落文本。')
  assert.equal(r.source, 'truncate')
  assert.equal(r.l0, '普通段落文本。')
})
t('l0: maxChars 截断带省略号', () => {
  const r = extractL0Pre('## ' + '很长的标题'.repeat(40))
  assert.ok(r.l0.length <= 160)
  assert.ok(r.l0.endsWith('…'))
})
t('l0: 空体 / null → empty 不抛', () => {
  assert.equal(extractL0Pre('').source, 'empty')
  assert.equal(extractL0Pre(null).source, 'empty')
})

// ---------- buildL0IndexPre ----------
t('index: 全字段结构 + 按 id 升序', () => {
  const r = buildL0IndexPre(`${anchor('b')}## 主题乙\n- 条目${anchor('a')}- 12:01 内容甲很长很长很长`)
  assert.equal(r.length, 2)
  assert.equal(r[0].id, id('a')) // a < b
  assert.equal(r[0].source, 'firstSentence')
  assert.equal(r[1].source, 'heading')
  for (const x of r) {
    for (const k of ['id', 'l0', 'source', 'chars', 'bodyChars']) assert.ok(k in x)
    assert.equal(x.chars, x.l0.length)
  }
})
t('index: 确定性（同输入两次全等）', () => {
  const text = `${anchor('a')}- 12:01 内容甲${anchor('b')}## 主题乙（13:00）\n- 条目乙`
  assert.deepEqual(buildL0IndexPre(text), buildL0IndexPre(text))
})
t('l0: 中文句读切分（首句够长则不并接）', () => {
  const r = extractL0Pre('- 内容甲很长很长很长很长很长很长很长很长的第一句话；内容乙；内容丙')
  assert.equal(r.l0, '内容甲很长很长很长很长很长很长很长很长的第一句话')
})
t('l0: 长条目首句过短时并接到 minChars', () => {
  const r = extractL0Pre('- 内容甲；内容乙；内容丙继续说明到很长为止超过十五个字')
  assert.equal(r.l0, '内容甲。内容乙。内容丙继续说明到很长为止超过十五个字')
})

// ---------- 汇总 ----------
console.log(`[l0-extract-pre] pass=${pass} fail=${fail}`)
if (fail) process.exit(1)
