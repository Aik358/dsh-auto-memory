#!/usr/bin/env node
/**
 * smoke-test-legacy-520.mjs —— #520 P0：legacy 判据修正的**真调用**验收。
 *
 * 依据：
 *   · docs/internal/PLAN-UPGRADE-WIZARD-20261103.md §6 第 1 行 / §7 P0 验收
 *   · docs/internal/VERIFY-520-CONCLUSIONS-20261103.md §1（实测证据：status 行只随新追加记录产生，
 *     全库没有为「已有锚点 + 0 status」的存量条目回填 status 的路径，且升级/迁移不写 MEMORY.md）
 *
 * 修正内容（lib/rules-layer.js detectLegacyFormatPre）：
 *   旧：`legacy = !anchors || !statuses` —— statuses 缺失也算旧格式 ⇒ 「有锚点 + 0 status」的库
 *       整理成功后 legacy 仍为 true ⇒ 弹窗永不消失（#520 报告人形态：78 条、有锚点、0 status）。
 *   新：`legacy = !anchors` —— **只有无锚点才判旧格式**；statuses 缺失降级为 advisory reason
 *       （文案保留 `no-status：退役标记不可用`），并新增 `eventized = events > 0`
 *       供「是否待迁移」与「尚未事件化」两类提示分家；`no-events` 保留为补充理由。
 *
 * 断言纪律（CR-10）：真 import → 真构造 → 真调用 → 断言**返回值**；不用「源码含某字符串」充数。
 * 变异对应关系：若把判据改回 `!anchors || !statuses`，L520-4 / L520-12 / L520-14 必红（本套件的反面输入）。
 */
import { createHarness } from './_harness.mjs'
import { detectLegacyFormatPre } from '../../lib/rules-layer.js'

const T = createHarness('legacy-520')

const A1 = '<!-- memory:mem_' + 'a'.repeat(32) + ' -->'
const A2 = '<!-- memory:mem_' + 'b'.repeat(32) + ' -->'
const STATUS = '<!-- dsh-status: current -->'
const OLD = '## 2026-08-14\n- 必须用 CRLF 换行\n- 严禁裸 hex 色值\n'
const hasReason = (r, prefix) => Array.isArray(r.reasons) && r.reasons.some((x) => String(x).indexOf(prefix) === 0)

// ═══════════════ 三条必验（任务书逐条） ═══════════════
// ① 全新空库 ⇒ legacy=false
{
  const r = detectLegacyFormatPre({ userText: '', notesText: '', eventStore: [], logCount: 0 })
  T.eq(r.legacy, false, '★★★L520-1 全新空库 ⇒ legacy=false（新工作区不误报）')
  T.eq(r.reasons, [], '★L520-2 空库 reasons 为空')
  T.eq(r.eventized, false, '★L520-3 空库 eventized=false')
}

// ② 有锚点 + events>0 + statuses=0 ⇒ **legacy=false**（这是本次修复的核心反面）
{
  const anchorsTxt = A1 + '\n- 新格式条目一条\n'
  const notesTxt = A2 + '\n- 项目条目一条\n'
  const evs = Array.from({ length: 14 }, (_, i) => ({ id: 'evt_' + String(i).padStart(8, '0') }))
  const r = detectLegacyFormatPre({ userText: anchorsTxt, notesText: notesTxt, eventStore: evs, logCount: 8 })
  T.eq(r.counts.anchors, 2, '★★L520-4 前置：锚点 = 2（实得 ' + r.counts.anchors + '）')
  T.eq(r.counts.statuses, 0, '★★L520-5 前置：statuses = 0（#520 报告人形态）')
  T.eq(r.counts.events, 14, '★★L520-6 前置：events = 14（真实裸数组形态）')
  T.eq(r.legacy, false, '★★★L520-7 有锚点 + 14 事件 + 0 status ⇒ legacy=false（★核心修复：statuses 不再决定 legacy）')
  T.ok(hasReason(r, 'no-status'), '★★L520-8 statuses=0 仍作为 advisory reason 出现（文案保留 no-status：退役标记不可用）')
  T.ok(String(r.reasons.find((x) => String(x).indexOf('no-status') === 0) || '').indexOf('退役标记不可用') >= 0,
    '★L520-9 advisory 文案含「退役标记不可用」')
  T.eq(r.eventized, true, '★★L520-10 eventized=true（已事件化）')
  T.ok(!hasReason(r, 'no-events'), '★L520-11 已事件化 ⇒ 不再给 no-events 补充理由')
}

// ③ 有日志无事件（旧格式） ⇒ legacy=true 且 reasons 含 no-events
{
  const r = detectLegacyFormatPre({ userText: OLD, notesText: '', eventStore: [], logCount: 12 })
  T.eq(r.legacy, true, '★★★L520-12 旧格式（无锚点）⇒ legacy=true')
  T.ok(hasReason(r, 'no-events'), '★★★L520-13 有日志无事件 ⇒ reasons 含 no-events（实得 ' + JSON.stringify(r.reasons) + '）')
  T.eq(r.counts.logs, 12, '★L520-14 前置：logs = 12')
  T.eq(r.eventized, false, '★L520-15 eventized=false（尚未事件化）')
  T.ok(hasReason(r, 'no-anchors'), '★★L520-16 reasons 含 no-anchors')
  T.ok(hasReason(r, 'no-status'), '★L520-17 reasons 含 no-status（advisory，同时存在）')
}

// ═══════════════ 回归：既有语义（有 status 无锚点仍 legacy；锚点单独决定）═══════════════
{
  const onlyStatus = detectLegacyFormatPre({ userText: STATUS + '\n- 有状态行但无锚点\n', notesText: '', eventStore: [], logCount: 0 })
  T.eq(onlyStatus.legacy, true, '★★L520-18 有 status 无锚点 ⇒ legacy=true（锚点仍是唯一结构判据）')
  T.ok(hasReason(onlyStatus, 'no-anchors'), '★L520-19 该情形 reasons 含 no-anchors')

  // ★这一条就是旧判据下的 true：旧实现 `!anchors || !statuses` 会把「有锚点无 status」判 legacy。
  //   新判据必须为 false（否则 #520 死循环未修）。
  const onlyAnchor = detectLegacyFormatPre({ userText: A1 + '\n- 仅锚点，无 status\n', notesText: '', eventStore: [], logCount: 0 })
  T.eq(onlyAnchor.legacy, false, '★★★L520-20 有锚点 + 0 status + 0 事件 + 0 日志 ⇒ false（旧判据下此为 true = 变异必红点）')
  T.ok(hasReason(onlyAnchor, 'no-status'), '★L520-21 但 statuses 缺失仍如实给出 advisory reason')

  // 有锚点+status，无事件无日志 ⇒ false（不误报）
  const anchoredStatus = detectLegacyFormatPre({ userText: A1 + '\n' + STATUS + '\n- 条目\n', notesText: '', eventStore: [], logCount: 0 })
  T.eq(anchoredStatus.legacy, false, '★★L520-22 有锚点 + 有 status ⇒ false（不误报）')
}

// ═══════════════ 补充理由（advisory）不决定 legacy ═══════════════
{
  const longEntry = detectLegacyFormatPre({
    userText: A1 + '\n' + '这是一条很长的条目'.repeat(30), notesText: '', eventStore: [{}], logCount: 1,
  })
  T.eq(longEntry.legacy, false, '★★L520-23 long-entries 是 advisory ⇒ 不影响 legacy')
  T.ok(hasReason(longEntry, 'long-entries'), '★L520-24 long-entries 理由仍在（' + longEntry.reasons.length + ' 条 reasons）')

  const realLike = detectLegacyFormatPre({
    userText: A1 + '\n' + STATUS + '\n- 条目一\n' + A2 + '\n' + STATUS + '\n- 条目二\n',
    notesText: '', eventStore: { events: [{}] }, logCount: 9,
  })
  T.eq(realLike.legacy, false, '★★L520-25 真实库形态（锚点/status 成对 + ≥1 事件）⇒ false')
}

// ═══════════════ 输入健壮性（不得 throw） + eventStore 三形态 ═══════════════
{
  let threw = false
  let out
  try { out = detectLegacyFormatPre() } catch (e) { threw = true }
  T.ok(threw === false && out && out.legacy === false, '★★L520-26 无参调用不 throw 且 legacy=false')
  T.ok(detectLegacyFormatPre(null) && detectLegacyFormatPre(null).legacy === false, '★L520-27 null 入参不 throw')

  const num = detectLegacyFormatPre({ userText: A1 + '\n- x\n', eventStore: 3, logCount: 2 })
  const arr = detectLegacyFormatPre({ userText: A1 + '\n- x\n', eventStore: [{}, {}, {}], logCount: 2 })
  const obj = detectLegacyFormatPre({ userText: A1 + '\n- x\n', eventStore: { events: [{}, {}, {}] }, logCount: 2 })
  T.eq(num.counts.events, 3, '★L520-28 eventStore=number ⇒ events=3')
  T.eq(arr.counts.events, 3, '★L520-29 eventStore=裸数组 ⇒ events=3（v5-P5 修复仍有效）')
  T.eq(obj.counts.events, 3, '★L520-30 eventStore={events:[]} ⇒ events=3')
  T.eq([num.legacy, arr.legacy, obj.legacy], [false, false, false], '★★L520-31 三形态的 legacy 一致（均为 false）')
  T.eq([num.eventized, arr.eventized, obj.eventized], [true, true, true], '★L520-32 三形态 eventized 一致（均为 true）')

  // 空白文本 ⇒ 无内容短路（不算旧格式）
  const blank = detectLegacyFormatPre({ userText: '   \n\t\n', notesText: '  ', eventStore: [], logCount: 5 })
  T.eq(blank.legacy, false, '★★L520-33 纯空白文本 ⇒ legacy=false（hasContent 短路）')
  T.eq(blank.reasons, [], '★L520-34 纯空白 ⇒ reasons 为空')
}

T.done()
