/**
 * smoke-test-v6-b3-quad-render.mjs —— B3：检查点四段进入注入渲染（v6 / 2026-10-27）
 *
 * 背景（真缺陷，不是文档缺陷）：
 *   lib/event-store.js 的检查点已能落 goal/state/dead/next + quoteRef/quoteLine/rel/bytes/sha256，
 *   但 lib/event-render.js 的 buildCheckpointsBlockPre 原先**只读 c.kind 与 c.text**
 *   ⇒ 补了字段，注入面一个字也看不见（「只存不用」家族再复现一次）。
 *
 * 判据纪律（本仓铁律）：
 *   ① 真 import → 真构造 → 真调 renderT2Pre → 断言**返回值**（不做「源码含某字符串」式验收）；
 *   ② 每条正向都配负路径：四段 ↔ 无四段/四段全空；有 ‖ ↔ 无 ‖；
 *   ③ 预算类断言必须量**未经总限裁剪**的物理量（buildCheckpointsBlockPre().used），
 *      否则「被总限切掉」与「真的压到预算内」在最终字符串上无法区分（假绿）；
 *   ④ 变异验证是**真变异**：把四段分支替换掉写成临时模块真 import，断言原判据变红；
 *      且先断言锚串恰命中 1 次（防「注释包住定义」式假变异：注释里的文本仍会被解析器命中）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { renderT2Pre, buildCheckpointsBlockPre, RENDER_LIMITS, T2_BUDGET } from '../../lib/event-render.js'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const SRC_PATH = path.join(ROOT, 'lib', 'event-render.js')

let pass = 0, fail = 0
const ok = (c, n, e) => { if (c) { pass++; console.log('  ok   - ' + n + (e ? ' :: ' + e : '')) } else { fail++; console.log('  FAIL - ' + n + (e ? ' :: ' + e : '')) } }

const mkEv = (cks) => ({
  id: 'evt_aaaaaaaa', name: '测试事件', summary: '一句话摘要。', status: 'active',
  sections: { goal: 'G', doing: 'D', deadend: '', next: 'N' },
  userPercept: [], agentTrace: [], sharedGround: [], commitments: [], constraints: [],
  checkpoints: cks, startMs: 0, endMs: 0, members: [], rationale: '',
  kind: 'ledger', confidence: 'high', outcomes: [], ordinal: 0, skills: {}, createdAt: 1, updatedAt: 1,
})
/** 取检查点正文行（不含标题 / 丢弃提示） */
const ckRows = (res) => res.lines.filter((l) => l.startsWith('  - ['))

// ══════════════════════════════════════════════════════════════════
// A. 预算台账（用户裁定 CHECKPOINTS 900 → 1800）
// ══════════════════════════════════════════════════════════════════
console.log('=== A. 预算台账 ===')
ok(T2_BUDGET.CHECKPOINTS === 1800, 'A-1 CHECKPOINTS = 1800（用户裁定，原 900）', T2_BUDGET.CHECKPOINTS + '')
ok(RENDER_LIMITS.T2 === 2400, 'A-2 T2 总上限仍 2400（对外注入契约未动）', RENDER_LIMITS.T2 + '')
{
  const rawSum = Object.keys(T2_BUDGET).reduce((a, k) => a + T2_BUDGET[k], 0)
  const HEAD = 60          // 【事件】行估
  const CK_HEAD = 10       // 「· 最近检查点：」
  const eff = T2_BUDGET.SECTIONS + T2_BUDGET.PERCEPT_TOTAL + T2_BUDGET.PANELS_TOTAL + T2_BUDGET.CHECKPOINTS + T2_BUDGET.OUTCOME
  const effWithHead = eff + HEAD + CK_HEAD
  console.log('  [预算] 原始分项和=' + rawSum + '（含 PERCEPT_ITEM/PANEL/CHECKPOINT_ITEM 等单条上限，不参与段合计）')
  console.log('  [预算] 内容段合计=' + eff + '  + 头60+标题10 = ' + effWithHead + '  vs T2=' + RENDER_LIMITS.T2 + '  ⇒ 缺口 ' + (effWithHead - RENDER_LIMITS.T2))
  // ★预算台账锁：改任一分项必须同步改本行并在 PR 说明（本仓「计数锁」惯例）
  ok(rawSum === 3520, 'A-3 原始分项和 = 3520（台账锁）', rawSum + '')
  ok(effWithHead === 3240, 'A-4 有效占用合计 = 3240（台账锁）', effWithHead + '')
  ok(effWithHead > RENDER_LIMITS.T2, 'A-5 ★冲突已量化：3240 > 2400，缺口 840（总限兜底仍在 ⇒ 见 B-9/C-1）', (effWithHead - RENDER_LIMITS.T2) + '')
}

// ══════════════════════════════════════════════════════════════════
// B. ★正路径：有四段 ⇒ 用四段（真 import → 真构造 → 真渲染）
// ══════════════════════════════════════════════════════════════════
console.log('')
console.log('=== B. 正路径：四段优先 ===')
const QUAD_CK = {
  at: 1, kind: 'ledger', text: '原始正文不应优先',
  goal: 'QGOAL 把三路工作移交 ZCode',
  state: 'QSTATE 改 site/index.html',
  dead: 'QDEAD 无',
  next: 'QNEXT 等接手',
}
const out1 = renderT2Pre(mkEv([QUAD_CK]))
ok(out1.indexOf('QGOAL') >= 0, 'B-1 ★goal 出现在注入文本')
ok(out1.indexOf('QSTATE') >= 0, 'B-2 ★state 出现')
ok(out1.indexOf('QDEAD') >= 0, 'B-3 ★dead 出现（原套件漏测的一段）')
ok(out1.indexOf('QNEXT') >= 0, 'B-4 ★next 出现')
ok(out1.indexOf('‖') >= 0, 'B-5 ★四段用 ‖ 分隔')
ok(out1.indexOf('原始正文不应优先') < 0, 'B-6 ★有四段时不回落 text（负方向）')
{
  const i1 = out1.indexOf('QGOAL'), i2 = out1.indexOf('QSTATE'), i3 = out1.indexOf('QDEAD'), i4 = out1.indexOf('QNEXT')
  ok(i1 >= 0 && i1 < i2 && i2 < i3 && i3 < i4, 'B-7 ★四段顺序 = goal→state→dead→next（不是按对象键序乱排）', [i1, i2, i3, i4].join('<'))
}
{
  // dead 为空是常态 ⇒ 只滤该段，不能整条回落
  const outNoDead = renderT2Pre(mkEv([{ at: 1, kind: 'ledger', text: 'X', goal: 'G-ONLY', state: 'S-ONLY', dead: '', next: 'N-ONLY' }]))
  const row = ckRows(buildCheckpointsBlockPre(mkEv([{ at: 1, kind: 'ledger', text: 'X', goal: 'G-ONLY', state: 'S-ONLY', dead: '', next: 'N-ONLY' }]), 3))[0] || ''
  ok(outNoDead.indexOf('G-ONLY') >= 0 && (row.split('‖').length - 1) === 2,
    'B-8 ★dead 为空 ⇒ 只滤该段（3 段、2 个 ‖），不是整条回落 text', JSON.stringify(row))
}
ok(out1.length <= RENDER_LIMITS.T2, 'B-9 输出长度 ≤ T2', out1.length + '/' + RENDER_LIMITS.T2)

// ══════════════════════════════════════════════════════════════════
// C. 长度 / 分段预算（量未经总限裁剪的 used）
// ══════════════════════════════════════════════════════════════════
console.log('')
console.log('=== C. 长度与分段预算 ===')
{
  const big = 'B'.repeat(4000)
  const huge = mkEv(Array.from({ length: 3 }, (_, i) => ({
    at: i + 1, kind: 'ledger', text: 'T'.repeat(4000), goal: big, state: big, dead: big, next: big,
  })))
  const out = renderT2Pre(huge)
  const ck = buildCheckpointsBlockPre(huge, 3)
  ok(out.length <= RENDER_LIMITS.T2, 'C-1 ★3 条超大四段检查点 ⇒ 输出 ≤ T2（总限兜底生效）', out.length + '/' + RENDER_LIMITS.T2)
  ok(ck.used <= T2_BUDGET.CHECKPOINTS, 'C-2 ★检查点块 used ≤ CHECKPOINTS（子函数直测，未经总限）', ck.used + '/' + T2_BUDGET.CHECKPOINTS)
  const row = ckRows(ck)[0] || ''
  ok(row.length <= T2_BUDGET.CHECKPOINT_ITEM + 20, 'C-3 单条检查点行 ≤ CHECKPOINT_ITEM(+标记开销)', row.length + '/' + T2_BUDGET.CHECKPOINT_ITEM)
}
{
  // ★功能性证据：预算 900→1800 真的生效了（若回退 900，第三条必被丢、used 掉到 ~631）
  const rows3 = Array.from({ length: 3 }, (_, i) => ({
    at: i + 1, kind: 'ledger', text: '', goal: 'CKG' + (i + 1) + ' ' + 'x'.repeat(400), state: '', dead: '', next: '',
  }))
  const res = buildCheckpointsBlockPre(mkEv(rows3), 3)
  ok(res.used > 900 && res.used <= 1800 && res.checkpointsDropped === 0,
    'C-4 ★★预算放宽的功能性证据：3 条 × 400+ 字 ⇒ used>900 且 dropped=0（回退 900 必红）',
    'used=' + res.used + ' dropped=' + res.checkpointsDropped + ' rows=' + ckRows(res).length)

  // ★预算仍是「活的」：默认 maxCk=3 时 1,800 不会绑（3×~313=939），但放大到 6 条必触发丢弃。
  //   这条同时守住「保最新丢最旧」的语义没有被 1,800 改坏（原 h4 套件的 E5b/E6c 就是用它做的判据）。
  const six = Array.from({ length: 6 }, (_, i) => ({ at: i + 1, kind: 'ledger', text: '', goal: 'SIX' + (i + 1) + ' ' + 'z'.repeat(900), state: '', dead: '', next: '' }))
  const res6 = buildCheckpointsBlockPre(mkEv(six), 6)
  const rows6 = ckRows(res6)
  ok(res6.used <= 1800 && res6.checkpointsDropped >= 1 && res6.lines.some((l) => l.indexOf('另有') >= 0),
    'C-5 ★预算仍会绑定（maxCk=6、6×900 字）⇒ used ≤ 1800、有丢弃且**如实标注**（不静默）',
    'used=' + res6.used + ' dropped=' + res6.checkpointsDropped + ' rows=' + rows6.length)
  ok(rows6.some((l) => l.indexOf('SIX6') >= 0) && !rows6.some((l) => l.indexOf('SIX1') >= 0),
    'C-6 ★★丢弃方向仍是「保最新丢最旧」（SIX6 在、SIX1 不在）', 'rows=' + rows6.map((r) => (r.match(/SIX\d/) || [''])[0]).join(','))
}

// ══════════════════════════════════════════════════════════════════
// D. ★负路径 1：无四段的检查点 ⇒ 回落 text，且不含 ‖
// ══════════════════════════════════════════════════════════════════
console.log('')
console.log('=== D. 负路径：无四段 ⇒ 回落 text ===')
{
  const out = renderT2Pre(mkEv([{ at: 1, kind: 'log', text: '只有正文的检查点' }]))
  ok(out.indexOf('只有正文的检查点') >= 0, 'D-1 回落 text 内容')
  ok(out.indexOf('‖') < 0, 'D-2 ★负路径：无四段时**不出现** ‖')
  ok(out.length <= RENDER_LIMITS.T2, 'D-3 输出长度 ≤ T2', out.length + '')
  const outNl = renderT2Pre(mkEv([{ at: 1, kind: 'log', text: '第一行\n第二行' }]))
  ok(outNl.indexOf('第一行 / 第二行') >= 0 && outNl.indexOf('\n第二行') < 0,
    'D-4 ★回落分支仍做防裸换行替换（改造不得丢掉原有行为）')
}

// ══════════════════════════════════════════════════════════════════
// E. ★负路径 2：四段全空但 text 有值 ⇒ 仍渲染 text
// ══════════════════════════════════════════════════════════════════
console.log('')
console.log('=== E. 负路径：四段全空 + text ===')
{
  const out = renderT2Pre(mkEv([{ at: 1, kind: 'log', goal: '', state: '', dead: '', next: '', text: '兜底正文' }]))
  ok(out.indexOf('兜底正文') >= 0, 'E-1 ★四段全空时回落 text')
  ok(out.indexOf('‖') < 0, 'E-2 不出现空分隔符 ‖')
  const res = buildCheckpointsBlockPre(mkEv([{ at: 1, kind: 'log', goal: '', state: '', dead: '', next: '', text: '兜底正文' }]), 3)
  ok(ckRows(res).length === 1 && (ckRows(res)[0].match(/\[\]/g) || []).length === 0,
    'E-3 四段全空 ⇒ 仍渲染 1 行正文（不产生空段 [], 也不静默丢条）', JSON.stringify(ckRows(res)))
  // 边界：四段全空 + text 也空 ⇒ 不炸、不产生 ‖
  const outEmpty = renderT2Pre(mkEv([{ at: 1, kind: 'log', goal: '', state: '', dead: '', next: '', text: '' }]))
  ok(typeof outEmpty === 'string' && outEmpty.indexOf('‖') < 0, 'E-4 边界：四段与 text 全空 ⇒ 不抛错、无 ‖')
}

// ══════════════════════════════════════════════════════════════════
// F. 裸换行防护（四段分支，注入面不允许破坏块结构）
// ══════════════════════════════════════════════════════════════════
console.log('')
console.log('=== F. 四段分支的裸换行防护 ===')
{
  const ev = mkEv([{ at: 1, kind: 'log', goal: '第一行\n第二行', state: 'S\n\nT', dead: '', next: 'N' }])
  const row = ckRows(buildCheckpointsBlockPre(ev, 3))[0] || ''
  ok(row.indexOf('\n') < 0, 'F-1 ★四段内的换行不得留在行内（否则注入块结构被破坏）', JSON.stringify(row))
  ok(row.indexOf('第一行 / 第二行') >= 0 && row.indexOf('S / T') >= 0, 'F-2 换行被替换为 " / "', JSON.stringify(row))
  const out = renderT2Pre(ev)
  ok(out.split('\n').filter((l) => l.indexOf('最近检查点') >= 0).length === 1, 'F-3 输出里「最近检查点」标题只出现 1 次（未被换行撑出伪块）')
}

// ══════════════════════════════════════════════════════════════════
// G. 真实数据（真实 event-store.json；不存在则如实跳过，不算失败）
// ══════════════════════════════════════════════════════════════════
console.log('')
console.log('=== G. 真实数据 ===')
{
  const WS = 'C:/Users/JH Z/.dsh/memory/workspaces/--D--dsh-auto-memory--'
  const storePath = path.join(WS, 'handoff', 'event-store.json')
  if (!fs.existsSync(storePath)) {
    console.log('  SKIP 真实 store 不存在（' + storePath + '）')
  } else {
    const store = JSON.parse(fs.readFileSync(storePath, 'utf8'))
    const ev = (store.events || [])[0]
    ok(!!ev, 'G-0 真实 store 读到事件')
    if (ev) {
      const out = renderT2Pre(ev)
      const last3 = (ev.checkpoints || []).slice(-3)
      const hasQuad = last3.some((c) => ['goal', 'state', 'dead', 'next'].some((k) => String((c && c[k]) || '').trim()))
      ok(out.length <= RENDER_LIMITS.T2, 'G-1 真实数据输出 ≤ T2', out.length + '/' + RENDER_LIMITS.T2)
      if (!hasQuad) ok(out.indexOf('‖') < 0, 'G-2 真实数据（最近 3 条无四段）⇒ 走回落分支、无 ‖', 'checkpoints=' + (ev.checkpoints || []).length)
      else console.log('  SKIP G-2 真实数据最近 3 条已含四段 ⇒ 本断言不适用')
      console.log('  [真实] name=' + ev.name + ' sections/percept/checkpoints=' + JSON.stringify({
        sec: (out.match(/^· (目标|进行中|失败与弯路|下一步)：/gm) || []).length,
        ckRows: (out.match(/^  - \[/gm) || []).length,
      }))
    }
  }
}

// ══════════════════════════════════════════════════════════════════
// H. ★变异验证（真变异 ⇒ 真 import ⇒ 断言原判据必红）
// ══════════════════════════════════════════════════════════════════
console.log('')
console.log('=== H. 变异验证 ===')
const MUT_DIR = path.join(ROOT, 'artifacts', '_b3test')
const MUT_PATH = path.join(MUT_DIR, 'event-render.mutant.mjs')
try {
  const src = fs.readFileSync(SRC_PATH, 'utf8')
  const ANCHOR = 'const quad = CHECKPOINT_QUAD_KEYS.map('
  const hits = src.split(ANCHOR).length - 1
  ok(hits === 1, 'H-0 变异锚串在源码中恰命中 1 次（防注释包住定义式假变异）', 'hits=' + hits)

  const RAW_OLD = "const rawText = quad.length ? quad.join(' ‖ ') : String(c.text || '').replace(/\\s*\\n+\\s*/g, ' / ').trim()"
  ok(src.split(RAW_OLD).length - 1 === 1, 'H-1 待变异语句也恰命中 1 次', 'hits=' + (src.split(RAW_OLD).length - 1))
  let mut = src.replace(ANCHOR, '// [MUTANT] ' + ANCHOR)
  mut = mut.replace(RAW_OLD, "const rawText = String(c.text || '').replace(/\\s*\\n+\\s*/g, ' / ').trim()")
  ok(mut.indexOf('[MUTANT]') >= 0 && mut.indexOf(RAW_OLD) < 0, 'H-2 变异体已生成（四段分支被注释掉，rawText 只走 text）')

  fs.mkdirSync(MUT_DIR, { recursive: true })
  fs.writeFileSync(MUT_PATH, mut, 'utf8')
  const MUT = await import(pathToFileURL(MUT_PATH).href + '?t=' + Date.now() + Math.random())
  ok(typeof MUT.renderT2Pre === 'function', 'H-3 变异体可真 import（不是只做文本替换）')

  const mutOut = MUT.renderT2Pre(mkEv([QUAD_CK]))
  ok(mutOut.indexOf('QGOAL') < 0 && mutOut.indexOf('QSTATE') < 0 && mutOut.indexOf('‖') < 0,
    'H-4 ★★原正路径判据在变异体上**变红**（四段不再出现，只剩 text）', JSON.stringify(mutOut.split('\n').slice(-2)))
  ok(mutOut.indexOf('原始正文不应优先') >= 0, 'H-5 变异体仍输出 text ⇒ 变异是「精准移除四段分支」而非把整函数打烂')

  const orgOut = renderT2Pre(mkEv([QUAD_CK]))
  ok(orgOut.indexOf('QGOAL') >= 0 && orgOut.indexOf('‖') >= 0, 'H-6 还原（原模块）后四段仍可见 ⇒ 变异前后的差异只来自该分支')
} finally {
  try { fs.rmSync(MUT_DIR, { recursive: true, force: true }) } catch (e) {}
}

// ══════════════════════════════════════════════════════════════════
// I. 契约守卫（**声明：静态守卫，非功能证据**）
// ══════════════════════════════════════════════════════════════════
console.log('')
console.log('=== I. 契约守卫（静态，非功能证据）===')
{
  const src = fs.readFileSync(SRC_PATH, 'utf8')
  ok(!/^import /m.test(src), '[守卫] event-render.js 仍是零依赖模块（无顶层 import；功能证据见 B/H 组）')
  ok(/CHECKPOINT_QUAD_KEYS/.test(src), '[守卫] 四段字段表以模块内常量存在（不从 event-store import）')
}

console.log('')
console.log('SUMMARY  PASS ' + pass + ' / FAIL ' + fail)
process.exit(fail === 0 ? 0 : 1)
