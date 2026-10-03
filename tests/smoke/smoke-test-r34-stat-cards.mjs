/**
 * R34 · 看板层「统计卡」真执行验收（70 卷 R12 / 48 卷 L78–L89）。
 *
 * CR-10：真 import → 真构造 → 真调用 → 断言返回值 + 负路径 + 可复算物理量。
 * 判据（70 卷 L93 逐字）：统计数与真实数据一致（可复算）；空态不崩。
 * 四类口径（48 卷图上 / 源码注释 L1002–L1006）：今日活动=条 / 本周交接=次 / 协作成员=人 / 历史归档=篇。
 */
const { buildStatCardsPre } = await import(new URL('../../lib/wb-sidecar.js', import.meta.url).href)

let p = 0, f = 0; const fails = []
const ok = (c, m) => { if (c) p++; else { f++; fails.push(m) } }
const eq = (a, b, m) => ok(Object.is(a, b), m + ' [got=' + JSON.stringify(a) + ' want=' + JSON.stringify(b) + ']')

/* ── 固定时间锚：2026-09-23（周三）12:00 本地时 —— 周一=09-21，周日=09-27 ── */
const NOW = new Date(2026, 8, 23, 12, 0, 0).getTime()
const DAY = 86400000
const at = (d, h) => new Date(2026, 8, d, h ?? 12, 0, 0).getTime()
// ★#176②：夹具自证 —— 旧写法 `h || 12` 把 0 当缺省，边界卡 at(23,0) 会落到 12:00，遮蔽 today 判据 `>=`→`>` 的变异。
ok(new Date(at(23, 0)).getHours() === 0 && new Date(at(23, 0)).getMinutes() === 0,
  '★0 夹具自证: at(23,0) = 当日 00:00 边界（实 ' + new Date(at(23, 0)).toString() + '）')
const card = (m, src, extra) => Object.assign({ id: 'mem_' + String(m).slice(-8).padStart(32, '0'), source: src, mtime: m }, extra || {})

/* ── ① 真构造：跨日/跨周精确落点 ── */
const cards = [
  card(at(23, 9), 'a.md'),           // 今日 ✅
  card(at(23, 18), 'a.md'),          // 今日 ✅ 同 source
  card(at(23, 0), 'b.md'),           // 今日边界（含）✅
  card(at(22, 23), 'c.md'),          // 今日边界外（本周内，昨日）
  card(at(21, 10), 'd.md'),          // 周一（本周首日）
  card(at(20, 10), 'e.md'),          // 上周日 ⇒ 不进本周
]
const r = buildStatCardsPre(cards, { now: NOW, archiveCount: 292 })
ok(r && Array.isArray(r.cards) && r.values && typeof r.values === 'object', '★1 ★真调用返回 {cards:[...], values:{...}}（形状正确）')

/* ── ② 四类数值：与**手工复算**逐条一致 ── */
const expToday = cards.filter((c) => c.mtime >= new Date(2026, 8, 23).getTime() && c.mtime < new Date(2026, 8, 23).getTime() + DAY).length
const expWeekDocs = new Set(cards.filter((c) => {
  const ws = new Date(2026, 8, 21).getTime(), de = new Date(2026, 8, 23).getTime() + DAY;
  return c.mtime >= ws && c.mtime < de && c.source;
}).map((c) => c.source)).size
eq(r.values.today, expToday, '★2 今日活动 = 手工复算（' + expToday + ' 条，含 00:00 边界、同 source 不并）')
eq(r.values.weekDocs, expWeekDocs, '★3 本周交接 = 不同 source 文档数（' + expWeekDocs + ' 篇；同一 source 两条只算 1）')
eq(r.values.today, 3, '★4 精确落点校验：今日恰 3 条')
eq(r.values.weekDocs, 4, '★5 本周（周一起）恰 4 篇不同 source：a/b/c/d')
eq(r.values.archived, 292, '★6 历史归档 = opts.archiveCount 透传（292 篇）')
eq(r.values.members, 0, '★7 协作成员：个人版无 member/actor/author ⇒ **恒 0**（44 卷 §二）')

/* ── ③ 四张卡的形态（label / unit / key）与 48 卷 L78–L89 图面一致 ── */
eq(r.cards.length, 4, '★8 恰 4 张统计卡')
const KEYS = r.cards.map((c) => c.key).join(',');
const LABELS = r.cards.map((c) => c.label).join(',');
const UNITS = r.cards.map((c) => c.unit).join(',');
eq(KEYS, 'today,week,members,archived', '★9 key 次序固定（today,week,members,archived）')
eq(LABELS, '今日活动,本周交接,协作成员,历史归档', '★10 ★label 与 48 卷图上**逐字一致**')
eq(UNITS, '条,次,人,篇', '★11 ★单位与 48 卷图上**逐字一致**')
ok(r.cards.every((c) => Number.isFinite(c.value)), '★12 四张卡的 value 均为有限数（可渲染）')
// ★口径修正：cards[].key 是**短键**（week），values 字段叫 weekDocs（语义=文档数）⇒ 名称本就不同，
//   不是缺陷。判据改为**按语义映射**逐条校验（卡的 value 必须等于对应语义的 values 字段）。
const VAL_OF = { today: 'today', week: 'weekDocs', members: 'members', archived: 'archived' };
ok(r.cards.every((c) => c.value === r.values[VAL_OF[c.key]]), '★13 ★cards 与 values **同源**（按语义映射逐条相等，不各算一份）')
ok(r.cards.every((c) => VAL_OF[c.key] !== undefined), '★13b 四张卡的 key 都能映射到 values 字段（无孤立卡）')
eq(r.cards[0].value, r.values.today, '★14 cards[0].value === values.today（同源）')

/* ── ④ 周起点口径：周一（getDay 0=周日 ⇒ 偏移 (day+6)%7） ── */
const sunday = new Date(2026, 8, 27, 12).getTime()  // 2026-09-27 是周日
const r2 = buildStatCardsPre([card(at(21, 10), 'x.md')], { now: sunday });
eq(r2.values.weekDocs, 1, '★15 ★周日看：周一(09-21)仍在**本周**（周起点=周一，不是滚动 7 天）')
const r3 = buildStatCardsPre([card(at(20, 10), 'y.md')], { now: sunday });
eq(r3.values.weekDocs, 0, '★16 ★同一次调用：上周日(09-20) **不在**本周 ⇒ 0')

/* ── ⑤ ★空态不崩（70 卷 L93 逐字判据） ── */
const EMPTY = [null, undefined, 0, '', 'x', [], {}, NaN, [null], [undefined], [{}, {}]]
let threw = 0, bad = 0
EMPTY.forEach((x) => { try { const q = buildStatCardsPre(x, { now: NOW }); if (!q || !Array.isArray(q.cards) || q.cards.length !== 4) bad++ } catch (e) { threw++ } })
eq(threw, 0, '★17 ★★空态不崩：' + EMPTY.length + ' 种畸形输入**零抛错**')
eq(bad, 0, '★18 ★★空态仍返回**完整 4 张卡**（恒不返回残缺结构）')
const e0 = buildStatCardsPre([], { now: NOW });
eq(e0.values.today, 0, '★19 空数组 ⇒ 今日 0')
eq(e0.values.weekDocs, 0, '★20 空数组 ⇒ 本周 0')
eq(e0.values.members, 0, '★21 空数组 ⇒ 成员 0')
eq(e0.values.archived, 0, '★22 空数组 ⇒ 归档 0（未传 archiveCount）')
ok(e0.cards.every((c) => c.value === 0), '★23 ★空态四张卡 value 全 0（可渲染的空态，非 undefined）')

/* ── ⑥ opts 边界 ── */
eq(buildStatCardsPre(cards, { now: NOW, archiveCount: -5 }).values.archived, 0, '★24 archiveCount 负数 ⇒ 0（不显示 -5）')
eq(buildStatCardsPre(cards, { now: NOW, archiveCount: 'abc' }).values.archived, 0, '★25 archiveCount 非数 ⇒ 0')
eq(buildStatCardsPre(cards, { now: NOW, archiveCount: '0' }).values.archived, 0, '★26 archiveCount 字符串 0 ⇒ 0')
ok(buildStatCardsPre(cards, 'bad-opts').cards.length === 4, '★27 opts 非对象 ⇒ 安全回落（仍 4 卡）')
const noNow = buildStatCardsPre(cards, {});
ok(Number.isFinite(noNow.values.today), '★28 不传 now ⇒ 回落 Date.now()（value 仍为有限数，不 NaN）')
eq(buildStatCardsPre(cards, { now: 'not-a-date' }).values.today, 0, '★29 now 非法 ⇒ 归 0（不 NaN 溢出）')
eq(buildStatCardsPre(cards, { now: NaN }).values.today, 0, '★30 now=NaN ⇒ 归 0')
eq(buildStatCardsPre(cards, { now: NOW, archiveCount: 3.9 }).values.archived, 3.9, '★31 archiveCount 小数原样透传（不擅自取整）')

/* ── ⑦ 成员聚合（teamwork 版才有值） ── */
const tm = [card(at(23, 9), 'a.md', { member: '甲' }), card(at(23, 10), 'b.md', { member: '乙' }), card(at(23, 11), 'c.md', { member: '甲' })]
eq(buildStatCardsPre(tm, { now: NOW }).values.members, 2, '★32 ★成员去重：甲乙+甲 ⇒ **2 人**')
const ac = [card(at(23, 9), 'a.md', { actor: 'P' }), card(at(23, 10), 'b.md', { author: 'Q' }), card(at(23, 11), 'c.md', { member: 'P' })]
eq(buildStatCardsPre(ac, { now: NOW }).values.members, 2, '★33 ★三字段合并去重（actor P + author Q + member P ⇒ 2）')
eq(buildStatCardsPre([card(at(23, 9), 'a.md', { member: '  ' })], { now: NOW }).values.members, 0, '★34 空白成员名 ⇒ 不计入（trim 后空）')

/* ── ⑧ 幂等 / 确定性 ── */
eq(JSON.stringify(buildStatCardsPre(cards, { now: NOW, archiveCount: 292 })), JSON.stringify(r), '★35 同输入同输出（确定性，可复算）')
ok(Object.is(buildStatCardsPre([], { now: NOW }).cards[0].value, 0), '★36 空态幂等（0 是数字 0，非 -0/NaN）')

console.log('PASS ' + p + ' / FAIL ' + f)
fails.forEach((x) => console.log('  FAIL: ' + x))
process.exit(f === 0 ? 0 : 1)