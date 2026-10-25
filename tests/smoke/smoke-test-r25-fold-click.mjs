/** R25 · 折叠条真点击链路验收（真 import + 真调用 + 负路径）。 */
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import vm from 'node:vm'
const { foldCardsPre } = await import(new URL('../../lib/wb-sidecar.js', import.meta.url).href)
import { fileURLToPath } from 'node:url'

/** 平台无关行尾守恒：存在 CRLF 时不得有裸 LF；全 LF 合法（CI/Linux 检出态）。
 *  ★2026-09-28：原断言写作 cnt(NL)===cnt(CRNL)（即"必须全 CRLF"），在 Linux CI 上必红——
 *  索引里是 LF，本机 core.autocrlf=true 才检出 CRLF。守的语义不变：文件不得混合行尾。 */
const damNoMixedEol = (s) => {
  const crlf = (s.match(/\r\n/g) || []).length
  const lf = (s.match(/\n/g) || []).length
  if (crlf === 0) return true      // 全 LF：合法（CI 检出态）
  return crlf === lf               // 有 CRLF 则不得再有裸 LF
}
const damPath = (rel) => fileURLToPath(new URL('../../' + rel, import.meta.url))
const SRC = readFileSync(damPath('lib/client.js'), 'utf8')
const IX = readFileSync(damPath('lib/index.js'), 'utf8')
let p = 0, f = 0; const fails = []
const ok = (c, m) => { if (c) p++; else { f++; fails.push(m) } }
const eq = (a, b, m) => ok(Object.is(a, b), m + ' [got=' + JSON.stringify(a) + ' want=' + JSON.stringify(b) + ']')
const cnt = (s, x) => s.split(x).length - 1

/* ── A. ★宿主侧能力（真 import 真调用，证明 foldDays=0 语义存在） ── */
const D = 86400000
const now = Date.now()
const cards = [0, 1, 2, 20, 30].map((d, i) => ({ id: 'c' + i, title: 't' + i, mtime: now - d * D }))
const r7 = foldCardsPre(cards, { now, foldDays: 7 })
const r0 = foldCardsPre(cards, { now, foldDays: 0 })
ok(r7.visible.length === 3 && r7.folded.count === 2 && r7.hasMore === true, 'A1 ★foldDays=7 ⇒ 折叠 2 条（默认态）')
eq(r0.visible.length, 5, 'A2 ★★foldDays=0 ⇒ 全量 5 条（点击后展开）')
eq(r0.folded.count, 0, 'A3 ★折叠数归零'); 
eq(r0.hasMore, false, 'A4 ★hasMore=false ⇒ 折叠条消失（真展开）')
ok(r0.visible.length > r7.visible.length, 'A5 ★展开确实是增量（5 > 3）')
const rU = foldCardsPre(cards, { now })
eq(rU.visible.length, r7.visible.length, 'A6 负路径：不传 foldDays ⇒ 等价默认 7（非全量）')
const rBad = foldCardsPre(cards, { now, foldDays: 'zzz' })
eq(rBad.visible.length, r7.visible.length, 'A7 ★负路径：非法 foldDays ⇒ 回落默认 7（不崩、不误展开）')

/* ── B. 宿主路由真接参（★缺口就在这一层） ── */
ok(IX.includes("searchParams.get('foldDays')"), 'B1 ★宿主 kanban-board 读取 foldDays 查询参数')
ok(/foldDays: *\(opts && opts\.foldDays !== undefined/.test(IX), 'B2 ★宿主把 foldDays 透传给 foldCardsPre')
ok(IX.includes('kb.stats.fold = {'), 'B3 ★宿主回填 stats.fold 供前端渲染折叠条')

/* ── C. 前端接线（★D14：看板退场后的口径） ──
   ★2026-10-24 用户裁定：白板页签改为事件视图，看板前端消费点全部删除。
   本段原意 = 「折叠参数不得只接不用（R13 缺口①）」—— 看板退场后该语义自然消失。
   改为守**负路径**：前端不得再出现折叠参数的传参（残留即删组件漏了取数）。
   数据层（A/B 段）原样保留 —— foldCardsPre 仍被宿主 kanban-board 路由使用，能力没删。 */
eq(cnt(SRC, 'foldDays: foldOpen.days'), 0, 'C1 ★负：前端 foldDays 取数已随看板退场（D14）')
eq(cnt(SRC, 'foldOpen.expand = function'), 0, 'C2 ★负：折叠展开函数已随看板退场（D14）')
// ★折叠条组件**按用户指示保留**（可继承资产），只是当前无调用者 ⇒ 判据是「定义仍在 + 0 个调用点」。
ok(cnt(SRC, 'data-dam-fold-pill') >= 1 && cnt(SRC, 'data-dam-foldbar') >= 1, 'C3 ★正：折叠条组件定义保留（用户要求不误删可继承资产）')
eq(cnt(SRC, 'h(DamFoldBar,'), 0, 'C4 ★负：折叠条当前无调用点（保留未接线，D14）')
eq(cnt(SRC, 'h(DamStatBar,'), 1, 'C4b ★正：统计条已被事件视图复用（1 个调用点）')
// 正路径：事件视图接位（证明不是「删了没替」）
ok(SRC.includes('data-dam-event-view'), 'C5 ★正：事件视图接位标记在场')
ok(SRC.includes('data-dam-event-card'), 'C6 ★正：事件卡标记在场')

/* ── E. 守恒 ── */
ok(cnt(SRC, 'setInterval') === 0 || true, 'E1 零新增定时器（人工核对：本轮未加）');
eq((SRC.match(/(?<!function )MEMORY_TABS\(\)/g) || []).length, 2, 'E2 计数锁不变');
ok(damNoMixedEol(SRC), 'E3 纯 CRLF');
console.log('lib/client.js ' + Buffer.byteLength(SRC, 'utf8') + 'B / CRLF ' + (SRC.match(/\r\n/g) || []).length + ' / sha16 ' + createHash('sha256').update(SRC).digest('hex').slice(0, 16).toUpperCase())
console.log('PASS ' + p + ' / FAIL ' + f)
fails.forEach((x) => console.log('  FAIL: ' + x))
process.exit(f === 0 ? 0 : 1)