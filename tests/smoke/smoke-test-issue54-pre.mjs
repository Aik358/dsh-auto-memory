#!/usr/bin/env node
/**
 * Issue #54 回归:写入侧保留语法过滤 + 可诊断性。
 *
 * 根因(修前):`appendAnchoredRecord()` 只对**文件已有内容**跑 parseAnchors(),
 * 从不校验本次要写入的 text ⇒ 含 MARKER_OPEN 的正文落盘后,从下一次写入起
 * parseAnchors 判 orphan-content fail-closed ⇒ 该文件**全部写入被永久拒绝**。
 *
 * 本套件锁定:
 *  A. 三个写入原语对保留语法**立即拒绝**(不落盘、不静默改写);
 *  B. 拒绝后**后续良性写入不受影响**(核心:不是"丢一条",而是"整体中断");
 *  C. 可诊断性 —— 错误带行号(line)与 detail,且保留 `conflict:` 前缀兼容既有断言;
 *  D. 边界:良性的普通文本、空、含部分前缀(如 `<-- memory:`)不受误伤。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  appendAnchoredRecord, replaceSingleRecord, renderReplace,
} from '../../lib/memory-writer-pre.js'
import { checkReservedSyntaxInContent, MARKER_OPEN, newMemoryId } from '../../lib/memory-anchor-pre.js'

let seq = 0
/** 每次返回**唯一**的合法 memoryId(固定 rnd 会返回同一 id，造成 duplicate-id 假失败)。 */
const ID = () => {
  seq += 1
  return newMemoryId(String(seq).padStart(32, '0'))
}
/** 合法 marker 行(mem_ + 32 hex):用于构造"文件已有内容"的干净/脏夹具。 */
const mk = (ch) => '<!-- memory:mem_' + ch.repeat(32) + ' -->'
/** 含保留语法开标记的**待写正文**(issue #54 要拦的正是它)。 */
const RESERVED = '<!-- memory:' + 'a'.repeat(32) + ' -->'

test('A1 appendAnchoredRecord 拒绝含保留语法的正文', () => {
  const r = appendAnchoredRecord('', { memoryId: ID(), text: '正常一行\n' + RESERVED + '\n又一行' })
  assert.equal(r.ok, false)
  assert.equal(r.reason, 'reserved-syntax-in-content')
  assert.equal(r.line, 2, '行号应为正文内相对行号 2')
  assert.ok(r.detail && r.detail.includes(MARKER_OPEN), 'detail 应含保留语法字样')
})

test('A2 replaceSingleRecord 拒绝含保留语法的正文', () => {
  const r = replaceSingleRecord('', '正文含 ' + RESERVED)
  assert.equal(r.ok, false)
  assert.equal(r.reason, 'reserved-syntax-in-content')
  assert.equal(r.line, 1)
})

test('A3 行内(非行首)保留语法同样拒绝 —— parseAnchors 用 includes 判定', () => {
  // 关键:反引号包裹也救不了(includes 照样命中),故写入侧必须一律拒绝。
  const r = appendAnchoredRecord('', { memoryId: ID(), text: '引用写法 `' + RESERVED + '` 也不行' })
  assert.equal(r.ok, false)
  assert.equal(r.reason, 'reserved-syntax-in-content')
})

test('B1 被拒后**落盘内容为空**,没有半个字节写进去', () => {
  const before = mk('b') + '\n\n旧内容\n'
  const r = appendAnchoredRecord(before, { memoryId: ID(), text: RESERVED })
  assert.equal(r.ok, false)
  assert.equal(r.text, undefined, '拒绝时不得返回任何写入产物')
})

test('B2 被拒后**后续良性写入不受影响**（本 issue 的核心危害：整体中断）', () => {
  const good = mk('c') + '\n\n已有记录\n'
  // 第一次:恶意正文被拒
  const bad = appendAnchoredRecord(good, { memoryId: ID(), text: '陷阱 ' + RESERVED })
  assert.equal(bad.ok, false)
  // 第二次:良性写入必须照常成功(修前若坏内容已落盘,这里会 conflict:orphan-content)
  const ok2 = appendAnchoredRecord(good, { memoryId: ID(), text: '良性记录' })
  assert.equal(ok2.ok, true, '良性写入必须成功，实得 ' + ok2.reason)
  const ok3 = appendAnchoredRecord(ok2.text, { memoryId: ID(), text: '再来一条' })
  assert.equal(ok3.ok, true, '连续良性写入必须持续成功')
})

test('C1 保留 conflict: 前缀,兼容既有断言 reason.startsWith(conflict)', () => {
  // 构造一个文件**本身**就脏的场景（模拟已逃逸的历史遗留：行内含保留语法）
  const dirty = mk('d') + '\n\n内容里有 <!-- memory: 片段\n'
  const r = appendAnchoredRecord(dirty, { memoryId: ID(), text: '良性' })
  assert.equal(r.ok, false)
  assert.ok(r.reason.startsWith('conflict'), '必须保持 conflict: 前缀，实得 ' + r.reason)
})

test('C2 P1 可诊断性：conflict reason 带行号,且回传 conflicts 明细', () => {
  const dirty = '头\n' + mk('e') + '\n\n内容里有 <!-- memory: 片段\n'
  const r = appendAnchoredRecord(dirty, { memoryId: ID(), text: '良性' })
  assert.equal(r.ok, false)
  assert.ok(/conflict:[a-z-]+@\d+/.test(r.reason), 'reason 应带 @行号，实得 ' + r.reason)
  assert.ok(r.reason.includes('orphan-content@4'), '应精确定位到第 4 行，实得 ' + r.reason)
  assert.ok(Array.isArray(r.conflicts) && r.conflicts.length > 0, '应回传 conflicts 明细')
  const c = r.conflicts[0]
  assert.ok(Number.isFinite(c.line), 'conflict 应带 line')
  assert.ok(Number.isFinite(c.byteStart) && Number.isFinite(c.byteEnd), 'conflict 应带字节区间')
})

test('D1 良性文本不受误伤（含换行/中文/反引号/普通 HTML 注释）', () => {
  const cases = [
    '普通中文记忆条目',
    '含 <!-- 普通注释 --> 但非保留语法',
    '代码块 ```\nconst a = 1\n```',
    '形似前缀 <-- memory: 少一横',
    'memory: 没有尖括号',
    '<!-- memory -->',
    '',
  ]
  for (const text of cases) {
    const r = checkReservedSyntaxInContent(text)
    const expectOk = !text.includes(MARKER_OPEN)
    assert.equal(r.ok, expectOk, '误判: ' + JSON.stringify(text.slice(0, 40)))
  }
})

test('D2 保留语法检测:整行合法 marker 也算保留语法（写入侧一律不放行）', () => {
  const r = checkReservedSyntaxInContent('正文\n' + mk('f'))
  assert.equal(r.ok, false, '写入正文含 marker 行必须拒绝(marker 只能由写入原语生成)')
  assert.equal(r.line, 2)
})

test('D3 renderReplace 的 replacement 是整篇文档 ⇒ 合法 anchor 不拦截(语义正确)', () => {
  const replacement = '正文块\n\n' + mk('a') + '\n\n另一块\n'
  const r = renderReplace('', replacement, { idFactory: ID })
  assert.equal(r.ok, true, '整篇替换里带合法 anchor 是正常语义，不应被 #54 守卫拦截: ' + r.reason)
})

test('D4 空/非字符串入参安全,不抛异常', () => {
  for (const v of [null, undefined, '', 0, false]) {
    const r = checkReservedSyntaxInContent(v)
    assert.equal(r.ok, true)
  }
})

test('E1 三重防线:append / replaceSingle / check 全部覆盖', () => {
  const payload = '前\n' + RESERVED + '\n后'
  assert.equal(appendAnchoredRecord('', { memoryId: ID(), text: payload }).ok, false)
  assert.equal(replaceSingleRecord('', payload).ok, false)
  assert.equal(checkReservedSyntaxInContent(payload).ok, false)
})
