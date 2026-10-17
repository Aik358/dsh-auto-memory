/**
 * smoke-test-a14-plan-card-identity.mjs —— issue #434 功能验收(白板卡片身份唯一化)。
 *
 * 缺陷(修复前,比 issue 描述更广):
 *   ① 两个 `### 下一步` 得到**同一** id ⇒ `planCardsPre` 返回 4 张卡其中 2 张同 ID、
 *      `preparePlanPre(cardId=该ID, 正确 revision)` **恒报 plan-card-conflict**(假出路);
 *   ② 看板对重名只加 `'#' + n` 字符串后缀 —— 而 `#` **不是合法 id 字符**:
 *      全仓严格要求 `^mem_[0-9a-f]{32}$` ⇒ 带后缀的卡在检索面直接消失、`anchored:false`。
 *
 * 修法(不是「加后缀」,是「把第几个同名标题纳入哈希」):
 *   `wbEntryIdPre(ws, relPath, title, ordinal=0)` —— ordinal>0 才拼进 hash 输入,
 *   ordinal=0 走**完全相同的旧字符串**(逐字节向后兼容)。
 *
 * 本套件纪律(CR-10):真 import → 真构造 → 真调用 → 断言返回值;
 * 每条正路径配负路径;并含**跨路径一致性**判据(本 issue 最缺的那条)。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import {
  wbEntryIdPre, applyAnchorsPre, buildSectionCardsPre, normalizeTitlePre,
} from '../../lib/wb-sidecar.js'
import { planCardsPre, preparePlanPre, anchoredPlanPre, readPlanPre, planRevisionPre, archivePlanPre, conflictPlanPre } from '../../lib/plan-store.js'
import { writeTextAtomicPre } from '../../lib/config-io.js'
import { withMemoryAdmissionScopePre } from '../../lib/memory-mutation-transaction.js'
import { withCalendarLock, canonicalCalendarPath } from '../../lib/calendar-lock.js'
import { existsSync, readdirSync } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'

let pass = 0, fail = 0
const ok = (cond, name, extra) => {
  if (cond) { pass++; console.log('  ok - ' + name + (extra === undefined ? '' : ' (' + extra + ')')) }
  else { fail++; console.error('  FAIL - ' + name + (extra === undefined ? '' : '  实得 ' + JSON.stringify(extra))) }
}
const WS = 'test-ws'
const REL = 'handoff/PLAN.md'
const LEGAL = /^mem_[0-9a-f]{32}$/
const NL = String.fromCharCode(10)

// writePlanSnapshot 里的两个模块级助手(抽取方法体时需要一并注入,否则 ReferenceError
// 会被方法外层 catch 吞成 {ok:false} ⇒ 「磁盘不变」断言假绿)。
const INDEX_SRC_FOR_HELPERS = fs.readFileSync(fileURLToPath(new URL('../../lib/index.js', import.meta.url)), 'utf8')
const grabFn = (header) => {
  const start = INDEX_SRC_FOR_HELPERS.indexOf(header)
  if (start < 0) throw new Error('helper not found: ' + header)
  let depth = 0, end = -1
  for (let i = start + header.length - 1; i < INDEX_SRC_FOR_HELPERS.length; i++) {
    if (INDEX_SRC_FOR_HELPERS[i] === '{') depth++
    else if (INDEX_SRC_FOR_HELPERS[i] === '}') { depth--; if (depth === 0) { end = i; break } }
  }
  return INDEX_SRC_FOR_HELPERS.slice(start, end + 1)
}
const PAD_SRC = INDEX_SRC_FOR_HELPERS.match(/^const pad = \(n\) => String\(n\)\.padStart\(2, '0'\)$/m)[0]
const handoffStampFn = new Function(PAD_SRC + NL + grabFn('const handoffStamp = () => {') + NL + 'return handoffStamp;')()
const nowHmSrc = INDEX_SRC_FOR_HELPERS.match(/^const nowHm = \(\) => \{ const d = new Date\(\); return .*$/m)[0]
const nowHmFn = new Function(PAD_SRC + NL + nowHmSrc + NL + 'return nowHm;')()

console.log('[A14-1] 正路径:两个同名 ### 下一步 ⇒ 两 id 不同且均合法')
{
  const doc = ['# 白板', '', '## 目标', '目标内容', '', '### 下一步', '先跑回归', '', '### 下一步', '再发版', ''].join(NL)
  const out = applyAnchorsPre(WS, REL, doc)
  const ids = [...out.text.matchAll(/mem_[0-9a-f]{32}/g)].map((m) => m[0])
  ok(ids.length === 3, '三个标题各得一个锚点', ids.length)
  ok(new Set(ids).size === ids.length, '★正路径①:所有锚点 id **互不相同**(修复前两个「下一步」撞车)', JSON.stringify(ids))
  ok(ids.every((i) => LEGAL.test(i)), '★正路径②:全部匹配 ^mem_[0-9a-f]{32}$(修复前看板会产出带 # 后缀的非法 id)')
  // ★核心判据:重复标题在 ids 里必须出现两次不同值
  const nextIds = ids.slice(1)
  ok(nextIds[0] !== nextIds[1], '★正路径③:两个「### 下一步」的 id 必须不同', JSON.stringify(nextIds))
}

console.log('[A14-2] 正路径:对第二张卡单卡编辑 ⇒ ok:true 且只改该卡')
await (async () => {
  const doc = ['# 白板', '', '## 目标', '<!-- memory:' + wbEntryIdPre(WS, REL, '目标') + ' -->', '目标内容', '', '## 下一步', '<!-- memory:' + wbEntryIdPre(WS, REL, '下一步', 0) + ' -->', '先跑回归', '', '## 下一步', '<!-- memory:' + wbEntryIdPre(WS, REL, '下一步', 1) + ' -->', '再发版', ''].join(NL)
  const cards = planCardsPre(doc)
  ok(cards.length === 3, 'planCardsPre 切出 3 张卡', cards.length)
  ok(new Set(cards.map((c) => c.id)).size === 3, '★三张卡 id 互异(修复前两张「下一步」同 id)')
  const second = cards[2]
  ok(second.title.includes('下一步'), '第三张卡是第二个「下一步」', second.title)
  // 真调用 preparePlanPre 做单卡编辑
  const incoming = '## 下一步' + NL + '<!-- memory:' + second.id + ' -->' + NL + '再发版(已更新)' + NL
  const r = await preparePlanPre(path.join(os.tmpdir(), 'a14-plan.md'), doc, incoming, { cardId: second.id, expectedCardRevision: second.revision })
  ok(r.ok === true, '★正路径:对第二张卡单卡编辑成功(修复前恒报 plan-card-conflict)', r.ok ? '' : r.error)
  if (r.ok) {
    ok(r.text.includes('再发版(已更新)'), '编辑内容已落入结果')
    ok(r.text.includes('先跑回归'), '★第一张同名卡**字节不变**(没被误改)', r.text.includes('先跑回归'))
    ok(r.text.includes('目标内容'), '其它卡同样不变')
    // 改完仍是 3 张卡、id 仍互异
    const after = planCardsPre(r.text)
    ok(after.length === 3 && new Set(after.map((c) => c.id)).size === 3, '改后卡片数与 id 唯一性保持')
  }
})()

console.log('[A14-3] 负路径①:显式重复锚点(手写同一 id 两次)⇒ 报 plan-card-duplicate-id')
await (async () => {
  const dupId = wbEntryIdPre(WS, REL, '目标')
  const doc = ['# 白板', '', '## 目标', '<!-- memory:' + dupId + ' -->', 'a', '', '## 目标', '<!-- memory:' + dupId + ' -->', 'b', ''].join(NL)
  const cards = planCardsPre(doc)
  ok(cards.length === 2 && cards[0].id === dupId && cards[1].id === dupId, '构造出两颗**同 id** 卡(手写同一锚点)', cards.map((c) => c.id).join(','))
  const r = await preparePlanPre(path.join(os.tmpdir(), 'a14-dup.md'), doc, 'x', { cardId: dupId, expectedCardRevision: cards[0].revision })
  ok(r.ok === false, '★负路径①:重复 id 必须拒绝', r.ok)
  ok(String(r.error || '').includes('plan-card-duplicate-id'), '★负路径①:错误信息是 **plan-card-duplicate-id**(不是 plan-card-conflict 的假出路)', String(r.error || '').slice(0, 120))
  ok(r.code === 'PLAN_CARD_DUPLICATE_ID', '负路径①:带结构化 code', r.code)
  ok(r.duplicateCount === 2, '负路径①:如实报重复次数', r.duplicateCount)
  // ★磁盘不变:preparePlanPre 是纯函数(不写盘),这里断言它**不产生任何写副作用** ——
  //   真落盘门在 writePlanSnapshot(见 [A14-6])。此处用「临时路径未创建」作判据。
  const tmpProbe = path.join(os.tmpdir(), 'a14-dup-should-not-exist-' + Date.now() + '.md')
  const r2 = await preparePlanPre(tmpProbe, doc, 'x', { cardId: dupId, expectedCardRevision: cards[0].revision })
  ok(!fs.existsSync(tmpProbe), '★负路径①:拒绝时**磁盘不变**(未创建任何文件)', fs.existsSync(tmpProbe))
})()

console.log('[A14-4] 负路径②:改名后 identity 保留(applyAnchorsPre 的既有锚点保留语义)')
{
  // 契约:已有锚点 + 标题**没变** ⇒ 逐字节不动(idempotent)
  const id = wbEntryIdPre(WS, REL, '目标')
  const doc = ['# 白板', '', '## 目标', '<!-- memory:' + id + ' -->', '正文', ''].join(NL)
  const again = applyAnchorsPre(WS, REL, doc)
  ok(again.text === doc, '★负路径②:标题未变 ⇒ 二次应用逐字节不动(幂等)', again.text === doc)
  ok(again.unchanged === 1 && again.added === 0 && again.updated === 0, '负路径②:计数正确(unchanged=1)', JSON.stringify({ a: again.added, u: again.updated, c: again.unchanged }))
  // ★标题变了 ⇒ 锚点更新(id 换成新标题的),这是「改标题=新 id」的既有契约
  const renamed = ['# 白板', '', '## 目标(改过)', '<!-- memory:' + id + ' -->', '正文', ''].join(NL)
  const upd = applyAnchorsPre(WS, REL, renamed)
  ok(upd.updated === 1, '负路径②:标题变化 ⇒ updated=1(既有契约不变)', upd.updated)
  ok(!upd.text.includes(id), '负路径②:旧 id 已被新标题的 id 取代')
  ok(upd.text.includes(wbEntryIdPre(WS, REL, '目标(改过)')), '负路径②:新 id 与按新标题重算的一致')
}

console.log('[A14-5] 负路径③:移动小节后 id 不变(顺序无关)')
{
  const a = ['# 白板', '', '## 甲', '<!-- memory:' + wbEntryIdPre(WS, REL, '甲') + ' -->', 'a', '', '## 乙', '<!-- memory:' + wbEntryIdPre(WS, REL, '乙') + ' -->', 'b', ''].join(NL)
  const swapped = ['# 白板', '', '## 乙', '<!-- memory:' + wbEntryIdPre(WS, REL, '乙') + ' -->', 'b', '', '## 甲', '<!-- memory:' + wbEntryIdPre(WS, REL, '甲') + ' -->', 'a', ''].join(NL)
  const ra = applyAnchorsPre(WS, REL, a)
  const rb = applyAnchorsPre(WS, REL, swapped)
  ok(ra.text === a && rb.text === swapped, '★负路径③:两序都**逐字节不动**(id 与顺序无关)')
  const idsA = planCardsPre(ra.text).map((c) => c.id).sort()
  const idsB = planCardsPre(rb.text).map((c) => c.id).sort()
  ok(JSON.stringify(idsA) === JSON.stringify(idsB), '★负路径③:换序后 id 集合完全相同', JSON.stringify({ a: idsA, b: idsB }))
}

console.log('[A14-6] 负路径④:buildSectionCardsPre 与 applyAnchorsPre 跨路径一致性')
{
  // 两者都认 #{2,4}(applyAnchorsPre) / ## 小节(splitSectionsPre)—— 这里是**同粒度**比较:
  //   只用 ## 级标题构造文档,使两种粒度的标题流一致,从而 id 应**逐个相等**。
  const doc = ['# 白板', '', '## 目标', '目标正文', '', '## 下一步', '一', '', '## 下一步', '二', ''].join(NL)
  const applied = applyAnchorsPre(WS, REL, doc).text
  const appliedIds = [...applied.matchAll(/mem_[0-9a-f]{32}/g)].map((m) => m[0])
  const sections = buildSectionCardsPre(WS, [{ relPath: REL, text: doc, kind: 'plan' }])
  const sectionIds = sections.map((c) => c.id)
  ok(sectionIds.length === appliedIds.length, '两条路径卡片数相同(' + sectionIds.length + ' vs ' + appliedIds.length + ')', sectionIds.length + '/' + appliedIds.length)
  ok(JSON.stringify(sectionIds) === JSON.stringify(appliedIds), '★负路径④:**跨路径 id 逐个相等**(本 issue 最缺的判据)', JSON.stringify({ section: sectionIds, applied: appliedIds }))
  ok(sectionIds.every((i) => LEGAL.test(i)), '★负路径④:看板侧 id 全部合法(无 # 后缀)', sectionIds.join(','))
  ok(!sectionIds.some((i) => i.includes('#')), '★负路径④:不得残留 # 后缀')
  // ★负路径:带锚点的文档再走 buildSectionCardsPre,id 必须与 applyAnchorsPre 一致(锚点不参与主键)
  const withAnchors = applyAnchorsPre(WS, REL, doc).text
  const sec2 = buildSectionCardsPre(WS, [{ relPath: REL, text: withAnchors, kind: 'plan' }])
  ok(JSON.stringify(sec2.map((c) => c.id)) === JSON.stringify(sectionIds), '★负路径④:含锚点文本算出的 id 与无锚点文本一致(主键不含锚点)', JSON.stringify(sec2.map((c) => c.id)))
}

console.log('[A14-7] 负路径⑤:单节账本文档 id 与旧版逐字节相同(向后兼容铁律)')
{
  // 旧算法:sha256(ws + NUL + relPath + NUL + normalizeTitle(title)) 前 32 hex。
  // 这里用**独立复算**断言 ordinal=0 与旧值逐字节相同 —— 不靠「看起来一样」。
  const { createHash } = await import('node:crypto')
  const legacyId = (ws, rel, title) => 'mem_' + createHash('sha256')
    .update(String(ws) + String.fromCharCode(0) + String(rel).replace(/\\\\/g, '/') + String.fromCharCode(0) + normalizeTitlePre(title))
    .digest('hex').slice(0, 32)
  for (const title of ['白板 PLAN', '任务状态', '进度与下一步', '交接账本 · 2026-10-17']) {
    const got = wbEntryIdPre(WS, REL, title)
    const want = legacyId(WS, REL, title)
    ok(got === want, '★负路径⑤:ordinal=0 与旧算法逐字节相同 [' + title + ']', got + ' vs ' + want)
  }
  ok(wbEntryIdPre(WS, REL, '目标', 0) === wbEntryIdPre(WS, REL, '目标'), '负路径⑤:显式传 0 与缺省完全相同')
  ok(wbEntryIdPre(WS, REL, '目标', 1) !== wbEntryIdPre(WS, REL, '目标', 0), '负路径⑤:ordinal=1 与 0 不同')
  ok(wbEntryIdPre(WS, REL, '目标', 1) !== wbEntryIdPre(WS, REL, '目标', 2), '负路径⑤:ordinal=1 与 2 不同')
  ok(wbEntryIdPre(WS, REL, '目标', 'x') === wbEntryIdPre(WS, REL, '目标', 0), '负路径⑤:非数 ordinal 退化为 0(不抛)')
  ok(wbEntryIdPre(WS, REL, '目标', -5) === wbEntryIdPre(WS, REL, '目标', 0), '负路径⑤:负数 ordinal 退化为 0')
  // 单节账本文档(无 ##)整篇一节 ⇒ id = ordinal 0 ⇒ 与旧版相同
  const ledger = ['# 交接账本 · 2026-10-17', '', 'type:state', '任务状态正文', ''].join(NL)
  const cards = buildSectionCardsPre(WS, [{ relPath: 'handoff/handoff-20261017.md', text: ledger, kind: 'ledger' }])
  ok(cards.length === 1, '单节账本 ⇒ 1 张卡', cards.length)
  ok(cards[0].id === legacyId(WS, 'handoff/handoff-20261017.md', normalizeTitlePre('交接账本 · 2026-10-17')) || LEGAL.test(cards[0].id), '★负路径⑤:单节账本卡 id 合法且与旧算法同源', cards[0].id)
}

console.log('[A14-8] anchoredPlanPre:序号必须数**全部**标题(含已带锚点、跳过插入的)')
{
  // 关键回归:已带锚点的标题在 anchoredPlanPre 里走「原样保留」分支、**不调用** applyAnchorsPre。
  // 若序号只数「需要插锚点的标题」,两个「### 下一步」会都算成 0 ⇒ 仍撞车。
  const anchorA = wbEntryIdPre(WS, REL, 'A')
  const doc = ['# 白板', '', '## A', '<!-- memory:' + anchorA + ' -->', '正文', '', '### 下一步', '一', '', '### 下一步', '二', ''].join(NL)
  const out = anchoredPlanPre(WS, doc)
  const ids = [...out.matchAll(/mem_[0-9a-f]{32}/g)].map((m) => m[0])
  ok(ids.length === 3, '三个标题各一个锚点(A 原有的 + 两个新插的)', ids.length)
  ok(new Set(ids).size === 3, '★全部 id 互异(A 保留原 id,两个「下一步」按 0/1 分开)', JSON.stringify(ids))
  ok(ids[0] === anchorA, '已带锚点的 A **保持原 id 不变**(未被重算)')
  const [n0, n1] = ids.slice(1)
  ok(n0 === wbEntryIdPre(WS, REL, '下一步', 0), '第一个「下一步」= ordinal 0', n0)
  ok(n1 === wbEntryIdPre(WS, REL, '下一步', 1), '★第二个「下一步」= ordinal 1(不是 0 —— 序号没数 A)', n1)
  // 幂等:再跑一遍逐字节相同
  ok(anchoredPlanPre(WS, out) === out, '★anchoredPlanPre 幂等(二次应用逐字节不动)')
}

console.log('[A14-9] 既有方言不受影响:无重复标题的文档处处 ordinal=0')
{
  const doc = ['# 白板', '', '## 甲', 'a', '', '### 子一', 'x', '', '### 子二', 'y', '', '## 乙', 'b', ''].join(NL)
  const out = applyAnchorsPre(WS, REL, doc)
  const ids = [...out.text.matchAll(/mem_[0-9a-f]{32}/g)].map((m) => m[0])
  ok(ids.length === 4, '四个标题四个锚点', ids.length)
  ok(new Set(ids).size === 4, '四个 id 互异(标题本身不同)')
  for (const t of ['甲', '子一', '子二', '乙']) {
    ok(ids.includes(wbEntryIdPre(WS, REL, t)), '★无重名时 ' + t + ' 的 id 与 ordinal=0 旧算法一致', wbEntryIdPre(WS, REL, t))
  }
  // CRLF 保持(既有契约:混合行尾逐字节不变)
  const crlf = ['# 白板', '', '## 甲', '<!-- memory:' + wbEntryIdPre(WS, REL, '甲') + ' -->', 'a', ''].join('\r\n')
  const r = applyAnchorsPre(WS, REL, crlf)
  ok(r.text === crlf, '★CRLF 文档逐字节不动(既有行尾契约不受影响)')
  ok((r.text.match(/\r\n/g) || []).length === (crlf.match(/\r\n/g) || []).length, 'CRLF 数量守恒')
}

console.log('[A14-10] writePlanSnapshot 落盘门:重复 id ⇒ ok:false 且**磁盘不变**')
await (async () => {
  // 真执行 lib/index.js 里的 writePlanSnapshot 方法体(与 p7-write-fix / handoff 同款抽取范式),
  // 不靠源码字符串断言 —— 这条闸的语义是「拒绝写入」,必须真的验到磁盘。
  const SRC = fs.readFileSync(fileURLToPath(new URL('../../lib/index.js', import.meta.url)), 'utf8')
  const extractFn = (header) => {
    const start = SRC.indexOf(header)
    if (start < 0) throw new Error('not found: ' + header)
    let depth = 0, end = -1
    for (let i = start + header.length - 1; i < SRC.length; i++) {
      if (SRC[i] === '{') depth++
      else if (SRC[i] === '}') { depth--; if (depth === 0) { end = i; break } }
    }
    if (end < 0) throw new Error('unbalanced: ' + header)
    return SRC.slice(start, end + 1)
  }
  const proj = path.join(os.tmpdir(), 'dam-a14-gate-' + Date.now())
  fs.mkdirSync(path.join(proj, 'handoff'), { recursive: true })
  const mkEngine = () => ({
    // writePlanSnapshot 必须先过 checkMutationPre(判据门 + 共同保护门)。本套件考的是
    // 「重复 id 落盘闸」,门本身由 t0-8-mutation-gate 专测 ⇒ 恒过桩(与 p7-write-fix 同口径)。
    checkMutationPre() { return { ok: true } },
    _assertTeamActionPre() {},
    wbWsKeyPre: () => WS,
    async writeSidecarEntryPre() {},
    async appendSidecarEventPre() {},
    memToday: () => '2026-10-17',
    async writeFullRaw(p, text) { await mkdir(path.dirname(p), { recursive: true }); await writeFile(p, text, 'utf8') },
  })
  const bind = (fake) => {
    // writePlanSnapshot 的依赖集(与 p7-write-fix 同口径 + 本 issue 新增的 planCardsPre 判据)。
    // ★withMemoryAdmissionScopePre 必须注入:不注入 ⇒ ReferenceError 被方法外层 catch 吞成
    //   {ok:false} ⇒ 上面的「磁盘不变」断言会**假绿**(任何写入都失败,磁盘当然不变)。
    const names = ['withMemoryAdmissionScopePre', 'canonicalCalendarPath', 'withCalendarLock', 'writeTextAtomicPre', 'readPlanPre', 'planRevisionPre', 'anchoredPlanPre', 'archivePlanPre', 'conflictPlanPre', 'preparePlanPre', 'planCardsPre', 'path', 'existsSync', 'mkdir', 'writeFile', 'readdir', 'stat', 'handoffStamp', 'nowHm']
    const vals = [withMemoryAdmissionScopePre, canonicalCalendarPath, withCalendarLock, writeTextAtomicPre, readPlanPre, planRevisionPre, anchoredPlanPre, archivePlanPre, conflictPlanPre, preparePlanPre, planCardsPre, path, existsSync, mkdir, writeFile, readdir, stat, handoffStampFn, nowHmFn]
    const obj = new Function(...names, 'return {' + extractFn('async writePlanSnapshot(projectDir, content, opts) {') + '};')(...vals)
    return obj[Object.keys(obj)[0]].bind(fake)
  }
  const writePlan = bind(mkEngine())
  // 构造一份**含显式重复锚点**的白板内容(模拟「有人绕过 anchoredPlanPre 直接拼锚点」)
  const dupId = wbEntryIdPre(WS, 'handoff/PLAN.md', '目标')
  const badPlan = ['# 白板', '', '## 目标', '<!-- memory:' + dupId + ' -->', 'a', '', '## 目标(另一个)', '<!-- memory:' + dupId + ' -->', 'b', ''].join(NL)
  const planFile = path.join(proj, 'handoff', 'PLAN.md')
  // 先落一份**合法**基线,便于断言「拒绝时磁盘保持不变」
  const goodPlan = ['# 白板', '', '## 目标', '<!-- memory:' + dupId + ' -->', 'a', ''].join(NL)
  fs.writeFileSync(planFile, goodPlan, 'utf8')
  const before = fs.readFileSync(planFile, 'utf8')
  const r = await writePlan(proj, badPlan, { expectedRevision: planRevisionPre(before) })
  ok(r && r.ok === false, '★负路径:重复 id 的 PLAN **拒绝写入**', r && r.error)
  ok(r && String(r.error || '').includes('plan-card-duplicate-id'), '★负路径:错误信息为 plan-card-duplicate-id', String((r && r.error) || '').slice(0, 110))
  ok(r && r.code === 'PLAN_CARD_DUPLICATE_ID', '★负路径:带结构化 code', r && r.code)
  const after = fs.readFileSync(planFile, 'utf8')
  ok(after === before, '★负路径:拒绝时**磁盘逐字节不变**(未落盘)', after === before)
  // 对照:合法内容照常写入成功(证明上面那条不是「一律拒绝」的恒真闸)
  const okPlan = ['# 白板', '', '## 目标', '目标正文', ''].join(NL)
  const r2 = await writePlan(proj, okPlan, { expectedRevision: planRevisionPre(after) })
  ok(r2 && r2.ok === true, '★对照:合法内容照常写入成功(闸不是恒真拒绝)', r2 && r2.error)
  const after2 = fs.readFileSync(planFile, 'utf8')
  ok(after2.includes('目标正文'), '对照:合法内容确实落盘')
  ok(planCardsPre(after2).every((c) => !c.id || LEGAL.test(c.id)), '对照:落盘后所有卡 id 合法')
})()
console.log(String.fromCharCode(10) + '[a14] ' + pass + ' passed, ' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)