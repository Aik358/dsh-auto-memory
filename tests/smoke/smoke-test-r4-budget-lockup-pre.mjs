#!/usr/bin/env node
/**
 * smoke-test-r4-budget-lockup-pre —— R4「配额锁死」回归锁定（2026-09-18）
 *
 * ── 用户报障（原话）─────────────────────────────────────────────
 * 「我尝试把其中一个固定额度加大成两倍的时候，还遇到了一个锁死的问题。」
 * 「有的时候配额太少，效果完全没有……有的时候配额多了，我又怕浪费 token」
 *
 * ── 复现结论（与 R4 设计文档的推断**不同**，以本套件为准则）─────────
 * 设计文档当时的推断是「`_lastCompactAt` 上锁 10 分钟 ⇒ 写入被 `throttled` 拒绝」。
 * 实测**不成立**，真机制是另一条：
 *
 *   1. **`reason:'throttled'` 是死分支** —— 全仓 0 处生产者，仅 `budgetRefusalTextPre`
 *      里有文案。节流只限制**昂贵的 AI 折叠**，不阻止**便宜的整条归档**（`compactLayer`
 *      的注释即如此声明）⇒ 节流窗口内的写入照样成功。
 *   2. **真缺陷在 `compactLayer` 传给 legacy 路径的 `keepBudget`**：
 *        `keepBudget = max(COMPACT_PROTECT_RECENT_CHARS, limit - deficit - 1)`
 *      其中 `deficit = curChars + add - limit` ⇒ 展开得 `2*limit - curChars - add - 1`。
 *      **保留量目标随 `limit` 单调递增**（方向反了），当它 ≥ 当前文件长度时，
 *      `compactLegacyLayer` 会把**所有段落**都判为"要保留" ⇒ `oldSegs` 为空
 *      ⇒ 直接返回 `no-removable` —— **哪怕回收最老一段完全够用**。
 *      正确口径应为 `curChars - deficit - 1`（= `limit - add - 1`，即"保留到恰好能放下"）。
 *   3. 后果是**非单调**：把额度调大，反而落进「不够直接放行、又已丧失回收能力」的
 *      死亡区间 ⇒ 用户看到的「加大额度反被锁死」。
 *
 * ── 本套件的主张（修完必须全绿）──────────────────────────────────
 *   ① **单调性**：额度只增不减地放宽 ⇒ 写入能力不得倒退（无死亡区间）
 *   ② **无误拒**：凡"回收最老段后即可放下"的额度，必须成功
 *   ③ **硬底线仍在**：只有一段（无可回收）时如实拒绝 —— 不得为了让路而丢最新内容
 *   ④ 拒绝文案必须**准确**（不得把"回收不了"说成"节流中"）
 *
 * 手法：从 `lib/index.js` 按花括号配平**切出真实方法体**执行（与 issue45 同源），
 * 不重实现任何一行生产逻辑。`docStore: null` 对应出厂默认
 * （`memoryAnchorEnabled` 默认 false ⇒ `docStore` getter 返回 null ⇒ 走 legacy 路径）。
 */

import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseAnchors } from '../../lib/memory-anchor-pre.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const SRC = readFileSync(path.join(ROOT, 'lib', 'index.js'), 'utf8').replace(/\r\n/g, '\n')

let pass = 0, fail = 0
const ok = (c, n, extra) => { if (c) { pass++; console.log('  ok -', n) } else { fail++; console.error('FAIL', n, extra == null ? '' : extra) } }
const eq = (a, b, n) => ok(a === b, n + (a === b ? '' : `  (期望 ${JSON.stringify(b)}，实得 ${JSON.stringify(a)})`))

function extractMethod(sig) {
  const marker = '\n  ' + sig
  const start = SRC.indexOf(marker)
  assert.ok(start >= 0, 'missing method: ' + sig)
  assert.equal(SRC.indexOf(marker, start + marker.length), -1, 'ambiguous method: ' + sig)
  const close = SRC.indexOf('\n  }\n', start)
  assert.ok(close > start, 'unbalanced: ' + sig)
  return SRC.slice(start + 1, close + '\n  }\n'.length)
}
function extractConstNum(name) {
  const m = SRC.match(new RegExp('const\\s+' + name + '\\s*=\\s*([0-9_*\\s]+?)\\n'))
  assert.ok(m, 'missing const: ' + name)
  return new Function('return (' + m[1].replace(/_/g, '') + ')')()
}

const METHODS = [
  'capacityLimit(layer) {',
  'appendOverheadChars() {',
  'capacityCheck(layer, curChars, text) {',
  'async layerCharCount(layer, p) {',
  'async ensureBudget(agent, layer, text, options = {}) {',
  'budgetRefusalTextPre(res, layer) {',
  'async compactLayer(agent, layer, opts = {}) {',
  'async compactLegacyLayer(agent, layer, p, keepBudget, allowFold) {',
  'async compactAnchoredLayer(store, filePath, layer, today, paths, deficit, agent, allowFold) {',
].map(extractMethod).join('\n')

const THROTTLE = extractConstNum('COMPACT_THROTTLE_MS')
const PROTECT = extractConstNum('COMPACT_PROTECT_RECENT_CHARS')
const DEF_NOTE = extractConstNum('DEFAULT_NOTE_CAPACITY_CHARS')
const DEF_USER = extractConstNum('DEFAULT_USER_CAPACITY_CHARS')

const TMP = mkdtempSync(path.join(tmpdir(), 'r4-lockup-'))
process.on('exit', () => { try { rmSync(TMP, { recursive: true, force: true }) } catch (_) {} })

/** 最小宿主：只注入外部依赖，业务逻辑全部来自生产源码。 */
function makeHost(o = {}) {
  const dir = mkdtempSync(path.join(TMP, 'c-'))
  mkdirSync(dir, { recursive: true })
  const notesPath = path.join(dir, 'MEMORY.md')
  const userFile = path.join(dir, 'user.md')
  const p = { ws: dir, projectDir: dir, notesPath, userFile }
  const Cls = new Function('deps', `
    const { path, parseAnchors, dshHome, mkdir, COMPACT_THROTTLE_MS, COMPACT_PROTECT_RECENT_CHARS,
            DEFAULT_NOTE_CAPACITY_CHARS, DEFAULT_USER_CAPACITY_CHARS } = deps
    return class H {
${METHODS}
    }
  `)({
    path, parseAnchors, dshHome: () => TMP, mkdir: (d, x) => mkdirSync(d, x),
    COMPACT_THROTTLE_MS: THROTTLE, COMPACT_PROTECT_RECENT_CHARS: PROTECT,
    DEFAULT_NOTE_CAPACITY_CHARS: DEF_NOTE, DEFAULT_USER_CAPACITY_CHARS: DEF_USER,
  })
  const inst = new Cls()
  Object.assign(inst, {
    // memoryAnchorEnabled 出厂默认 false ⇒ docStore getter 返回 null ⇒ legacy 路径（默认可达路径）
    config: { noteCapacityChars: o.cap || DEF_NOTE, userCapacityChars: o.cap || DEF_NOTE, memoryAnchorEnabled: false },
    state: { userText: '', notesText: o.body || '', loadedAt: 0 },
    _lastCompactAt: { user: 0, note: 0 },
    docStore: null,
    memToday: () => '2026-09-18',
    resolvePaths: async () => p,
    async readTextSafe(f) { try { return readFileSync(f, 'utf8') } catch (_) { return '' } },
    async writeFull(f, b) { writeFileSync(f, b, 'utf8') },
    async writeFullRaw(f, b) { writeFileSync(f, b, 'utf8') },
    async appendText(f, b) { writeFileSync(f, (readFileSync(f, 'utf8') || '') + b, 'utf8') },
    // AI 不可用 ⇒ 走"整条归档"（这也正是节流窗口内的实际路径）
    async foldTextToSummaryPre() { return '' },
  })
  if (o.body != null) writeFileSync(notesPath, o.body, 'utf8')
  return { inst, p, notesPath, dir }
}

/** 两段夹具：老段可回收、新段为硬底线。 */
const segOld = '## 2026-09-01\n' + '旧'.repeat(800)      // 814 字符
const segNew = '## 2026-09-17\n' + '新'.repeat(900)     // 914 字符
const BODY = segOld + '\n' + segNew                     // 1729 字符
const RAW = '本次新增'.repeat(250)                       // 1000 字符
const OVERHEAD = 16                                     // '\n## 2026-09-18\n'.length ≈ 15~16
const CUR = BODY.length
const DIRECT_FIT = CUR + RAW.length + OVERHEAD           // 直接放行阈值
/** 回收最老段后能否放下（判定"误拒"的客观判据）。 */
const fitsAfterReclaim = (cap) => (CUR - segOld.length - 1) + RAW.length + OVERHEAD <= cap

async function attempt(cap, body = BODY, raw = RAW) {
  const h = makeHost({ body, cap })
  h.inst.state.notesText = body
  const r = await h.inst.ensureBudget(null, 'note', raw)
  return { ...r, text: h.inst.budgetRefusalTextPre(r, 'note') }
}

// ══ 1. 常量与前提 ═════════════════════════════════════════════════
console.log('\n[1] 前提：节流常量与出厂默认')
{
  eq(THROTTLE, 600000, '节流 10 分钟（COMPACT_THROTTLE_MS）')
  eq(PROTECT, 2000, '保护窗口 2000 字符（COMPACT_PROTECT_RECENT_CHARS）')
  eq(DEF_NOTE, 24000, '笔记出厂容量 24000')
  eq(DEF_USER, 24000, '用户级出厂容量 24000')
}

// ══ 2. `throttled` 是死分支（把复现结论钉进断言） ═════════════════
console.log('\n[2] `reason:\'throttled\'` 是死分支（设计文档的推断不成立）')
{
  const producers = [...SRC.matchAll(/reason\s*[:=]\s*'throttled'/g)].length
  eq(producers, 0, '★ 全仓无任何代码路径返回 reason=throttled')
  ok(SRC.includes("if (why === 'throttled')"), '文案分支存在（有文案、无生产者 ⇒ 死分支）')
  // 节流只挡 AI 折叠，不挡归档 —— 源码注释即如此声明
  ok(/节流只限制"昂贵的 AI 折叠"/.test(SRC), '★ 源码注明节流只限制 AI 折叠、不阻止整条归档')
}

// ══ 3. 节流窗口内的写入必须成功（直接反驳旧推断） ═══════════════
console.log('\n[3] 节流窗口内（10 分钟内）的第二次写入必须成功')
{
  // ★ 必须选一个**确实进入整理**的额度：need = 1729+1000+16 = 2745 > 2600。
  //   这样第一次写入会走 compactLayer ⇒ 打上时间戳 ⇒ 第二次才真正处在节流窗口内。
  const h = makeHost({ body: BODY, cap: 2600 })
  h.inst.state.notesText = BODY
  const r1 = await h.inst.ensureBudget(null, 'note', RAW)
  ok(r1.ok === true, '第一次写入成功（额度 2600 < need 2745 ⇒ 经整理腾位）', r1.reason)
  ok(r1.compacted === true, '★ 确实走了整理路径（compacted=true，非"直接够放"）')
  ok(h.inst._lastCompactAt.note > 0, '★ 整理后时间戳已写（节流确实上锁了）')
  const r2 = await h.inst.ensureBudget(null, 'note', RAW)   // 同窗口内立刻再写
  ok(r2.ok === true, '★★ 节流窗口内的第二次写入**仍然成功**（"被 throttled 拒绝"不成立）', r2.reason)
  ok(r2.reason !== 'throttled', '不存在 throttled 拒绝')
}

// ══ 4. ★ 单调性：额度放宽不得让写入能力倒退 ═════════════════════
console.log('\n[4] ★ 单调性：额度只增不减地放宽，写入不得从成功变失败')
{
  // 用小文件夹具（165 字符）暴露非单调：额度极小时"直接够放"成功，
  // 中间档因回收不足被拒，更大档又"直接够放"成功。
  // ★陷阱：`capacityLimit` 对 **< 500** 的值视为脏值回落出厂默认（24000）⇒ 扫描必须 ≥500，
  //   否则会得到"极小额度过"的假象（本套件初版即踩到，见 [6] 的同类修正）。
  const small = '## 2026-09-01\n' + '旧'.repeat(150)     // 165 字符
  const raw = '本次新增'.repeat(200)                      // 800 字符
  const caps = []
  for (let c = 500; c <= 1600; c += 100) caps.push(c)
  const rows = []
  for (const cap of caps) {
    const h = makeHost({ body: small, cap })
    h.inst.state.notesText = small
    const r = await h.inst.ensureBudget(null, 'note', raw)
    rows.push({ cap, ok: r.ok, reason: r.reason || '-' })
  }
  console.log('     扫描 500→1600: ' + rows.map((x) => x.cap + (x.ok ? ':Y' : ':N')).join(' '))
  let violation = null
  const firstOk = rows.find((x) => x.ok)
  if (firstOk) {
    for (const r of rows) if (r.cap > firstOk.cap && !r.ok) { violation = { firstOk: firstOk.cap, bad: r.cap }; break }
  }
  ok(!violation,
    '★★ 一旦某个额度可用，更大的额度必须也可用（无"死亡区间"）',
    violation ? `额度 ${violation.firstOk} 可写，但更大的 ${violation.bad} 反而被拒 ⇒ 非单调` : '')
}

// ══ 5. ★ 无误拒：能腾出空间就必须写进去 ═════════════════════════
console.log('\n[5] ★ 无误拒：凡"回收最老段后即可放下"的额度必须成功')
{
  const caps = []
  for (let c = 500; c <= DIRECT_FIT + 200; c += 100) caps.push(c)
  const misrefused = []
  for (const cap of caps) {
    const r = await attempt(cap)
    if (!r.ok && fitsAfterReclaim(cap)) misrefused.push({ cap, reason: r.reason })
  }
  console.log('     扫描 ' + caps.length + ' 档；误拒 ' + misrefused.length + ' 档')
  ok(misrefused.length === 0,
    '★★ 不存在误拒（能回收腾位却报 no-removable）',
    misrefused.length ? JSON.stringify(misrefused.slice(0, 6)) : '')
}

// ══ 6. 硬底线：单段文件仍须如实拒绝 ═════════════════════════════
console.log('\n[6] 硬底线：无可回收内容时如实拒绝（不得为让路而丢最新内容）')
{
  // ★夹具两个坑（本套件初版均踩到）：
  //   ① 额度必须 ≥500 —— `capacityLimit` 把 <500 视为脏值回落出厂默认 24000，
  //      用 300 会得到"轻松写入成功"的假象，断言 `r.ok === false` 便假红；
  //   ② 必须是**真正只有一段** —— 带 `## ` 标题的文件会被切成
  //      [(文件头)空段, `## 日期`段] **两段**，整理器能回收那个空段，于是走的是
  //      `still-over-capacity` 而非 `no-removable`。故这里用**无标题纯正文**。
  const single = '唯一一段正文'.repeat(200)   // ~1200 字符，无 `## ` ⇒ 解析为单段
  const r = await attempt(500, single, '新内容')
  ok(r.ok === false, '单段文件 + 额度不足 → 拒绝', r.reason)
  eq(r.reason, 'no-removable', '原因 = no-removable（准确，不是 throttled）')
  ok(r.text.includes('可回收内容为空'), '★ 文案准确说明"可回收内容为空"')
  ok(!r.text.includes('节流'), '★ 文案**不**误报"节流中"（不得把回收不了说成节流）')
  ok(r.text.includes('noteCapacityChars'), '文案给出可操作建议（调大额度 / 用 replace）')
}

// ══ 7. 用户场景回归：把额度加倍不得变差 ═════════════════════════
console.log('\n[7] 用户场景：额度×2 不得使写入从可用变为被拒')
{
  let worse = []
  for (const base of [2200, 2600, 3000, 3400]) {
    const a = await attempt(base)
    const b = await attempt(base * 2)
    if (a.ok && !b.ok) worse.push({ base, doubled: base * 2 })
  }
  ok(worse.length === 0,
    '★★ "把额度加大成两倍"后写入能力不得倒退（用户报障的直接回归）',
    worse.length ? JSON.stringify(worse) : '')
}

// ══ 8. 源码级：keepBudget 口径必须是"当前长度 − 缺口" ═══════════
console.log('\n[8] 源码级：legacy 路径的保留量目标口径')
{
  // ★修复后的口径：保留到"恰好能放下本次写入"。因 ensureBudget 仅在
  //   `cur + add > limit` 时才整理 ⇒ deficit ≥ 1 ⇒ keepBudget < curChars 恒成立
  //   ⇒ 必有段落落在保留窗口外 ⇒ 不再出现"无处可回收"的误判。
  ok(SRC.includes('const keepBudget = Math.max(0, curChars - deficit - 1)'),
    '★ keepBudget = max(0, curChars - deficit - 1)（与 limit 无关）')
  // 两条历史错误口径都必须不存在。
  // ★注意（本仓踩过多次的坑）：**不能**断言 `!SRC.includes('limit - deficit - 1')` ——
  //   修复处的中文注释里**引用了旧公式**做说明，裸 substring 断言会被自己的注释误伤（假红）。
  //   故锚定到"旧代码整行"的精确形态。
  ok(!SRC.includes('const keepBudget = Math.max(COMPACT_PROTECT_RECENT_CHARS, limit - deficit - 1)'),
    '★ 旧口径 limit - deficit - 1 已不存在（它使保留目标随额度**反向**增长 ⇒ 非单调）')
  ok(!/const keepBudget = Math\.max\(COMPACT_PROTECT_RECENT_CHARS,/.test(SRC),
    '★ 保护窗口不再被当作**硬**下限（那会让小文件永远"可回收为空"）')
  // 保护窗口必须是**软**下限（与锚点路径同语义）。
  // ★断言必须"同句相邻"——分开写 `/保护窗口/.test(SRC) && /软/.test(SRC)` 是**假绿**：
  //   两个词各自出现在别处也满足（变异演示实测：删掉这一句里的"软"字，断言照样通过）。
  ok(/保护窗口\(最近 [^)]*\)是\*\*软\*\*下限/.test(SRC),
    '★ 声明"保护窗口是**软**下限"（同句相邻，锚点路径与 legacy 路径语义一致）')
  // 回写量护栏必须存在（否则归档了却不腾空间 —— 第二层缺陷）
  ok(SRC.includes('reclaimed - deficitHere') && SRC.includes('const deficitHere = Math.max(0, cur.length - keepBudget)'),
    '★ legacy 路径有回写量护栏（与锚点路径同一纪律，防"归档了却没腾出空间"）')
}

console.log(`\n[r4-budget-lockup] ${pass}/${pass + fail} assertions passed`)
if (fail) process.exit(1)
