#!/usr/bin/env node
/**
 * Issue #57 回归:restore 不校验 data.current 形状 → 损坏的 current 让巩固链路永久停摆。
 *
 * 根因(修前):`restore()` 逐条校验 `data.episodes`(validateEpisodePre),但对 `current`
 *   只做 `current = data.current || null`。接线处 hubIo.load() 只保证 JSON.parse 成功,
 *   不校验 schema ⇒ 若 episodes.json 的 current 损坏成 `{}`(手改/半损坏但仍可解析),
 *   restore「成功」,随后每次 consolidate() 读 `current.segments.length` 抛 TypeError;
 *   调用方 catch + diag 后 current **仍未被置空** ⇒ 每轮都炸,巩固链路静默停摆到重启。
 *
 * 修复口径:restore 时按 append 的同等规则校验 current,不合格**置 null**
 *   (丢弃一个未巩固段,优于卡死整条巩固链路)。
 * 本套件锁定:
 *   A. 损坏 current 被丢弃后 store 立即可用(consolidate 走正常空态,不抛)。
 *   B. 合法 current 被完整保留(不得为了自愈把有效数据也丢掉)。
 *   C. 各种损坏形态都归 null(含"部分合法"的形态)。
 *   D. validateEpisodeCurrentPre 的判定与 append 产出的形状互洽(单一真相)。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

const E = await import('../../lib/episodic-store.js')
const { createEpisodicStorePre, validateEpisodeCurrentPre } = E

/** 内存 IO:可预置 load() 返回内容,并记录 save() 快照。 */
function memIo(loadValue) {
  const saved = []
  return { saved, load: () => loadValue, save: (s) => saved.push(JSON.parse(JSON.stringify(s))), clear() {} }
}
const snap = (current) => ({ schemaVersion: 1, episodes: [], current })
/** 与 append() 产出的 current 同形的合法夹具。 */
const GOOD_CURRENT = {
  sessionRef: 'sesr_deadbeef', startedAt: 1700000000000,
  segments: [{ kind: 'user', eventSeq: 1, contextVersion: 1, userText: '帮我查一下', assistantText: '', ts: 1700000000001 }],
  userTexts: ['帮我查一下'], assistantTexts: [],
}

test('A1 ★current 损坏为 {} 时:restore 成功但丢弃 current,consolidate 不再抛 TypeError', () => {
  const st = createEpisodicStorePre({ io: memIo(snap({})) })
  const r = st.restore(snap({}))
  assert.equal(r.ok, true, 'episodes 侧仍应恢复成功(不因 current 整块拒绝)')
  assert.equal(st.hasCurrent, false, '★损坏 current 被丢弃')
  assert.deepEqual(st.consolidate(), { ok: false, reason: 'nothing-to-consolidate' }, '★巩固链路可用(修前抛 TypeError)')
  assert.deepEqual(st.flush(), { ok: false, reason: 'nothing-to-consolidate' })
  assert.equal(st.getStats().droppedCurrent, 1, '丢弃计入 stats(不留完全静默的数据丢失)')
})

test('A2 损坏 current 被丢弃后,新会话段照常累积并巩固(不是"一次性降级")', () => {
  const io = memIo(snap({ segments: 'not-an-array' }))
  const st = createEpisodicStorePre({ io, now: () => 1700000000000 })
  st.restore(io.load())
  assert.equal(st.hasCurrent, false)
  for (const t of ['第一条', '第二条']) {
    assert.equal(st.append({ kind: 'user', userText: t, eventSeq: 1, contextVersion: 1 }).ok, true)
  }
  const c = st.consolidate()
  assert.equal(c.ok, true, '★巩固成功(修前:每次 TypeError)')
  assert.equal(st.size, 1)
})

test('A3 未过校验的 current 不落盘成"看似有内容"的快照', () => {
  const io = memIo(snap({ sessionRef: 's', startedAt: 1, segments: [], userTexts: [], assistantTexts: [] }))
  const st = createEpisodicStorePre({ io })
  st.restore(io.load())
  assert.equal(JSON.stringify(st.snapshot().current), JSON.stringify(io.load().current), '夹具:该 current 合法,原样保留')
  const bad = createEpisodicStorePre({ io })
  bad.restore(snap({ sessionRef: 's', startedAt: 1, segments: null, userTexts: [], assistantTexts: [] }))
  assert.equal(bad.snapshot().current, null, '★丢弃后快照写回 null,磁盘可自愈')
})

test('B1 合法 current 完整保留(sessionRef/startedAt/三类数组)', () => {
  const io = memIo(snap(GOOD_CURRENT))
  const st = createEpisodicStorePre({ io })
  const r = st.restore(io.load())
  assert.equal(r.ok, true)
  assert.equal(st.hasCurrent, true, '★有效未巩固段不得被误丢')
  st.append({ kind: 'assistant', assistantText: '已经查好了', eventSeq: 2, contextVersion: 2 })
  st.append({ kind: 'user', userText: '谢谢', eventSeq: 3, contextVersion: 3 })
  const c = st.consolidate()
  assert.equal(c.ok, true, '接续未巩固段一起巩固')
  assert.equal(c.episode.sessionRef, GOOD_CURRENT.sessionRef, 'sessionRef 继承自恢复的 current')
  assert.equal(c.episode.startedAt, GOOD_CURRENT.startedAt, 'startedAt 继承')
  assert.equal(st.size, 1)
})

test('C1 各类损坏形态一律归 null', () => {
  const cases = [
    ['null', null],
    ['数组', []],
    ['字符串', 'oops'],
    ['数字', 1],
    ['缺 segments', { sessionRef: 's', startedAt: 1, userTexts: [], assistantTexts: [] }],
    ['缺 userTexts', { sessionRef: 's', startedAt: 1, segments: [], assistantTexts: [] }],
    ['缺 assistantTexts', { sessionRef: 's', startedAt: 1, segments: [], userTexts: [] }],
    ['sessionRef 非字符串', { sessionRef: 7, startedAt: 1, segments: [], userTexts: [], assistantTexts: [] }],
    ['sessionRef 空串', { sessionRef: '', startedAt: 1, segments: [], userTexts: [], assistantTexts: [] }],
    ['startedAt 非有限', { sessionRef: 's', startedAt: NaN, segments: [], userTexts: [], assistantTexts: [] }],
    ['startedAt 字符串', { sessionRef: 's', startedAt: '1700000000000', segments: [], userTexts: [], assistantTexts: [] }],
    ['segments 是对象', { sessionRef: 's', startedAt: 1, segments: {}, userTexts: [], assistantTexts: [] }],
  ]
  for (const [name, current] of cases) {
    const io = memIo(snap(current))
    const st = createEpisodicStorePre({ io })
    const r = st.restore(io.load())
    assert.equal(r.ok, true, name + ':restore 仍应成功(episode 侧不受累)')
    assert.equal(st.hasCurrent, false, name + ':★current 归 null')
    assert.doesNotThrow(() => st.consolidate(), name + ':consolidate 不抛')
    assert.doesNotThrow(() => st.append({ kind: 'user', userText: 'x', eventSeq: 1, contextVersion: 1 }), name + ':append 不抛')
  }
})

test('C2 episodes 侧的既有校验不回归(坏 episode 逐条跳过,整块仍恢复)', () => {
  const st = createEpisodicStorePre({ io: memIo(null) })
  const good = { episodeId: 'epi_' + 'a'.repeat(32), sessionRef: 's1', intent: 'i', actions: [], entities: [], unresolved: [], outcome: 'unknown', provenance: [], startedAt: 1 }
  const r = st.restore({ schemaVersion: 1, episodes: [good, { junk: true }], current: {} })
  assert.equal(r.ok, true)
  assert.equal(r.restored, 1, '一条有效一条无效')
  assert.equal(st.hasCurrent, false)
})

test('D1 validateEpisodeCurrentPre 与 append 产出形状互洽', () => {
  const st = createEpisodicStorePre({ io: memIo(null), now: () => 1700000000000 })
  st.append({ kind: 'user', userText: '一段', eventSeq: 1, contextVersion: 1 })
  const cur = st.snapshot().current
  assert.equal(validateEpisodeCurrentPre(cur).ok, true, '★append 产出的 current 必须过同一校验')
  assert.equal(validateEpisodeCurrentPre(null).ok, false, 'null 不是合法 current(restore 里另有 null 快路径)')
  assert.equal(validateEpisodeCurrentPre(undefined).ok, false)
  assert.equal(validateEpisodeCurrentPre(GOOD_CURRENT).ok, true)
})

console.log('\nissue57-episodic-current: done')
