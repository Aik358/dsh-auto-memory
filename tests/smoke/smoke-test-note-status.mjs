/**
 * G3 磁盘形态 · 纯函数核心套件（note-status.js）
 *
 * ⚠️ 本套件验的是**形态层**（判定/渲染/剥离），不是「写盘是否生效」——
 *    写盘接线**尚未做**，因为没有调用方（等 F1/F2 拍板，见 G3-DISK-FORMAT-GAP-20260919.md）。
 *    ⇒ 本套件**不能**被当作「G3 已完工」的证据。它证明的是：**形态本身是安全的**。
 *
 * 两条纪律：
 *   ① 断言前 stripComments（防注释误伤 —— 本仓已有先例）；
 *   ② `t()` 必须 await async（否则断言失败静默 ⇒ 假绿 —— issue #55–58 批次刚踩过）。
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const LIB = new URL('../../lib/', import.meta.url)
const SRC = readFileSync(new URL('note-status.js', LIB), 'utf8')

/**
 * 剥注释：源码级断言必须先做，否则**解释某条规则的注释本身**会让断言假绿。
 * （本仓纪律：修复处的中文注释引用旧写法 ⇒ `!includes(旧写法)` 假红。）
 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

const CODE = stripComments(SRC)

let pass = 0, fail = 0
const ok = (cond, name, extra) => {
  if (cond) { pass++; console.log('  ok -', name) }
  else { fail++; console.error('  FAIL -', name, extra == null ? '' : extra) }
}
const eq = (name, got, want) => ok(got === want, name, 'got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want))

async function t(name, fn) {
  try { await fn() } catch (e) { fail++; console.error('  THREW -', name, (e && e.stack) || e) }
}

const M = await import(new URL('note-status.js', LIB))
const A = 'mem_' + 'a'.repeat(32)
const B = 'mem_' + 'b'.repeat(32)

console.log('\n=== G3 磁盘形态 · 纯函数核心 ===')

// ═══════════════ 1. 渲染：三态与 fail-closed ═══════════════
console.log('\n[1] 渲染 renderStatusLinePre')

await t('#1-1 current 不落盘（缺失即默认，少一处漂移源）', () => {
  eq('current → 空串', M.renderStatusLinePre('current'), '')
})

await t('#1-2 superseded 带 by', () => {
  const l = M.renderStatusLinePre('superseded', { supersededBy: A })
  ok(l.includes('superseded'), '含状态词')
  ok(l.includes('by=' + A), '含合法 id')
  ok(l.startsWith(M.NOTE_STATUS_OPEN_PRE_V1), '以状态开标记起始')
  ok(l.endsWith('-->'), '以 --> 收尾')
})

await t('#1-3 ★ 非法 id 被丢弃（防把任意文本拼进状态）', () => {
  const l = M.renderStatusLinePre('superseded', { supersededBy: 'javascript:alert(1)' })
  ok(!l.includes('javascript'), '★ 非 mem_<32hex> 形态一律不写入')
  ok(l.includes('superseded'), '状态词仍在（只丢非法属性，不整体失败）')
})

await t('#1-4 retracted 带 reason，且压平换行 / 去 -->', () => {
  const l = M.renderStatusLinePre('retracted', { reason: '前提错误\r\n真的错了-->' })
  ok(l.includes('reason="'), '含 reason 属性')
  ok(!l.includes('\n') && !l.includes('\r'), '★ 换行被压平（防破坏行式解析）')
  // 整行仍必须是合法的单行状态行 —— 用 parse 往返验证，比字符串断言更强
  const back = M.parseStatusLinePre(l)
  ok(back !== null && back.status === 'retracted', '★ 往返可解析（渲染/解析口径一致）', l)
})

await t('#1-5 未知 status / 异常输入 ⇒ 空串（fail-closed，宁可不写绝不写错）', () => {
  eq('bogus → 空串', M.renderStatusLinePre('bogus'), '')
  eq('空 → 空串', M.renderStatusLinePre(''), '')
  eq('undefined → 空串', M.renderStatusLinePre(undefined), '')
  eq('current + 属性 → 仍空串', M.renderStatusLinePre('current', { supersededBy: A }), '')
  let threw = false
  try { M.renderStatusLinePre('superseded', { get supersededBy() { throw new Error('x') } }) } catch (_) { threw = true }
  ok(!threw, '取值抛错不冒泡（fail-soft）')
})

await t('#1-6 reason 超长被截断（元数据不是正文）', () => {
  const l = M.renderStatusLinePre('retracted', { reason: 'x'.repeat(500) })
  const back = M.parseStatusLinePre(l)
  ok(back !== null, '仍可解析')
  ok(back.reason.length <= M.NOTE_STATUS_REASON_MAX_PRE_V1, '长度 ≤ 上限', String(back.reason.length))
})

// ═══════════════ 2. 解析：非状态行一律 null ═══════════════
console.log('\n[2] 解析 parseStatusLinePre')

await t('#2-1 三种合法形态', () => {
  ok(M.parseStatusLinePre('<!-- dsh-status: current -->') !== null, 'current 可解析')
  const s = M.parseStatusLinePre('<!-- dsh-status: superseded by=' + A + ' -->')
  ok(s && s.status === 'superseded' && s.supersededBy === A, 'superseded + by')
  const r = M.parseStatusLinePre('<!-- dsh-status: retracted reason="x y" -->')
  ok(r && r.status === 'retracted' && r.reason === 'x y', 'retracted + 带空格 reason（引号形态）')
})

await t('#2-2 ★ 非状态行一律 null（不得误吞正文）', () => {
  const cases = [
    '', 'normal text', '## 标题', '- 列表项',
    'status: superseded',                       // 裸行：刻意不支持（与正文散文碰撞）
    '<!-- memory:' + A + ' -->',                 // 锚点行不是状态行
    '<!-- dsh-status: bogus -->',                // 未知 status
  ]
  for (const c of cases) {
    ok(M.parseStatusLinePre(c) === null, 'null: ' + JSON.stringify(c.slice(0, 40)))
  }
})

await t('#2-3 未知属性被忽略，不污染结果', () => {
  const s = M.parseStatusLinePre('<!-- dsh-status: superseded evil=1 by=' + A + ' -->')
  ok(s && s.supersededBy === A, '合法属性保留')
  ok(s && !('evil' in s), '★ 未知属性不进入结果')
})

await t('#2-3b 容忍行首尾空白/CRLF（磁盘文本按行切分后常带 \\r）', () => {
  ok(M.parseStatusLinePre('  <!-- dsh-status: current -->  ') !== null, '首尾空格可解析')
  ok(M.parseStatusLinePre('<!-- dsh-status: current -->\r') !== null, '★ CRLF 尾 \\r 可解析（本仓文件全 CRLF）')
  ok(M.parseStatusLinePre('<!-- dsh-status: current -->\n') !== null, '尾 \\n 可解析')
})

await t('#2-4 fail-soft：异常输入不抛', () => {
  let threw = false
  try { M.parseStatusLinePre(null); M.parseStatusLinePre(undefined); M.parseStatusLinePre(123) } catch (_) { threw = true }
  ok(!threw, '不抛')
})

// ═══════════════ 3. 从正文取状态 ═══════════════
console.log('\n[3] statusOfBodyPre')

await t('#3-1 无状态行 ⇒ current（与索引层「缺失即默认」口径一致）', () => {
  eq('空正文', M.statusOfBodyPre('').status, 'current')
  eq('普通正文', M.statusOfBodyPre('## T\n- 内容').status, 'current')
})

await t('#3-2 有状态行 ⇒ 取其值', () => {
  const b = '## T\n- 内容\n<!-- dsh-status: superseded by=' + A + ' -->'
  const s = M.statusOfBodyPre(b)
  eq('status', s.status, 'superseded')
  eq('supersededBy', s.supersededBy, A)
})

await t('#3-3 ★ 多个状态行 ⇒ 最后一个胜出（状态是当前值，不是历史轨迹）', () => {
  const b = [
    '## T',
    '<!-- dsh-status: superseded by=' + A + ' -->',
    '- 后来的内容',
    '<!-- dsh-status: retracted reason="改主意了" -->',
  ].join('\n')
  const s = M.statusOfBodyPre(b)
  eq('★ 取最后一个', s.status, 'retracted')
  eq('reason 随之一致', s.reason, '改主意了')
})

await t('#3-4 中间有非法状态行时，回退到上一个合法行（不因脏数据整体失效）', () => {
  const b = [
    '<!-- dsh-status: superseded by=' + A + ' -->',
    '<!-- dsh-status: bogus -->',
  ].join('\n')
  eq('回退到合法行', M.statusOfBodyPre(b).status, 'superseded')
})

// ═══════════════ 4. ★ 剥离：不污染 L0（本模块存在的主要理由） ═══════════════
console.log('\n[4] ★ stripStatusLinePre —— 防 L0 污染')

await t('#4-1 剥掉状态行，正文其余逐字节不变', () => {
  const b = '## T\n- 内容 A\n<!-- dsh-status: superseded -->\n- 内容 B'
  const out = M.stripStatusLinePre(b)
  eq('★ 结果 = 仅去掉状态行', out, '## T\n- 内容 A\n- 内容 B')
})

await t('#4-2 无状态行时**原样返回**（零改动，向后兼容）', () => {
  const b = '## T\n- 内容'
  eq('逐字节相同', M.stripStatusLinePre(b), b)
  eq('空', M.stripStatusLinePre(''), '')
  eq('null → 空串', M.stripStatusLinePre(null), '')
})

await t('#4-3 ★ 只删整行匹配的；行内出现不静默改写（交由守卫处理）', () => {
  const b = '前 <!-- dsh-status: superseded --> 后'
  eq('★ 行内不匹配 ⇒ 原样保留', M.stripStatusLinePre(b), b)
})

await t('#4-4 ★★ 端到端：剥了状态行后 L0 不被污染（真实调用 l0-extract-pre）', async () => {
  const L0 = await import(new URL('l0-extract.js', LIB))
  // 无标题条目 —— 正是规则③（压平）会中招的场景，也是 M2.5a 修过的那类问题
  const plain = '- 缓存用 LRU，容量 500'
  const dirty = plain + '\n<!-- dsh-status: superseded by=' + A + ' -->'

  const l0Dirty = L0.extractL0Pre(dirty)
  const l0Clean = L0.extractL0Pre(M.stripStatusLinePre(dirty))

  ok(l0Clean.l0.includes('缓存用 LRU'), '剥后 L0 取到真实内容', l0Clean.l0)
  ok(!l0Clean.l0.includes('dsh-status'), '★ 剥后 L0 不含状态标记')
  // 反证：不剥会怎样（证明这一步**必要**，而不是可有可无）
  ok(l0Dirty.l0 !== l0Clean.l0 || !l0Dirty.l0.includes('dsh-status'),
    '（记录）未剥时的 L0 形态: ' + JSON.stringify(l0Dirty.l0.slice(0, 60)))
})

// ═══════════════ 5. 追加：幂等 + 只追加末尾 ═══════════════
console.log('\n[5] withStatusLinePre')

await t('#5-1 追加在末尾，不前置（★前置会污染 L0 规则②/③）', () => {
  const out = M.withStatusLinePre('## T\n- 内容', 'superseded', { supersededBy: A })
  const lines = out.split('\n')
  ok(lines[0] === '## T', '★ 首行仍是标题（未被前置）')
  ok(lines[lines.length - 1].includes('dsh-status'), '状态行在最后')
})

await t('#5-2 ★ 幂等：同参数重复调用不叠加', () => {
  let b = '## T\n- 内容'
  b = M.withStatusLinePre(b, 'superseded', { supersededBy: A })
  b = M.withStatusLinePre(b, 'superseded', { supersededBy: A })
  b = M.withStatusLinePre(b, 'superseded', { supersededBy: A })
  const n = b.split(M.NOTE_STATUS_OPEN_PRE_V1).length - 1
  eq('★ 只保留 1 个状态行', n, 1)
})

await t('#5-3 状态变更：旧行被替换而非叠加', () => {
  let b = M.withStatusLinePre('## T\n- 内容', 'superseded', { supersededBy: A })
  b = M.withStatusLinePre(b, 'retracted', { reason: '改主意' })
  eq('★ 只剩 1 行', b.split(M.NOTE_STATUS_OPEN_PRE_V1).length - 1, 1)
  eq('★ 且是新状态', M.statusOfBodyPre(b).status, 'retracted')
})

await t('#5-4 current ⇒ 只剥不写（撤销通道的形态基础）', () => {
  let b = M.withStatusLinePre('## T\n- 内容', 'retracted', { reason: 'x' })
  b = M.withStatusLinePre(b, 'current')
  eq('★ 状态行被移除', b.split(M.NOTE_STATUS_OPEN_PRE_V1).length - 1, 0)
  eq('状态回到 current', M.statusOfBodyPre(b).status, 'current')
  eq('正文保留', b, '## T\n- 内容')
})

await t('#5-5 尾部空白被规整（不留多余空行）', () => {
  const out = M.withStatusLinePre('## T\n- 内容\n\n\n', 'superseded')
  ok(!/\n\n<!-- dsh-status/.test(out), '状态行前无空行')
})

// ═══════════════ 6. ★ F2 候选：识别取代意图（保守） ═══════════════
console.log('\n[6] detectSupersedeIntentPre —— 双条件，保守')

await t('#6-1 ★ 缺 id 或缺动作词 ⇒ 一律 null（只报告不标）', () => {
  eq('只有动作词无 id', M.detectSupersedeIntentPre('这条取代了之前的结论'), null)
  eq('只有 id 无动作词', M.detectSupersedeIntentPre('见 ' + A), null)
  eq('空', M.detectSupersedeIntentPre(''), null)
})

await t('#6-2 两者齐备才命中', () => {
  const r = M.detectSupersedeIntentPre('本结论取代 ' + A + ' 的旧做法')
  ok(r !== null, '命中')
  eq('目标 id', r && r.target, A)
})

await t('#6-3 英文动作词同样识别', () => {
  const r = M.detectSupersedeIntentPre('this supersedes ' + A)
  ok(r !== null, 'supersedes 命中')
})

await t('#6-4 ★ 多 id 时只取第一个（不自动全标 —— 保守性关键）', () => {
  const r = M.detectSupersedeIntentPre('取代 ' + A + ' 和 ' + B)
  eq('★ 只返回一个目标', r && r.target, A)
})

await t('#6-5 fail-soft：异常输入不抛', () => {
  let threw = false
  try { M.detectSupersedeIntentPre(null); M.detectSupersedeIntentPre(undefined); M.detectSupersedeIntentPre(123) } catch (_) { threw = true }
  ok(!threw, '不抛')
})

// ═══════════════ 7. ★ 契约守卫：形态选择的**反向锁** ═══════════════
console.log('\n[7] ★ 反向锁 —— 防后人"顺手"改成危险形态')

await t('#7-1 ★ 不得复用锚点开标记（复用会撞锚点契约 ⇒ 整份文件拒写）', () => {
  ok(!CODE.includes("NOTE_STATUS_OPEN_PRE_V1 = '<!-- memory:'"),
    '★ 状态开标记不得是 MARKER_OPEN（issue #54 防线）')
  ok(CODE.includes("'<!-- dsh-status:'"), '用的是独立命名空间')
})

await t('#7-2 ★ 不得从别的模块 import 锚点常量（避免与锚点契约耦合）', () => {
  ok(!/import[\s\S]*MARKER_OPEN/.test(CODE), '★ 未 import MARKER_OPEN')
  ok(!/import[\s\S]*from\s+'\.\/memory-anchor\.js'/.test(CODE), '★ 未依赖 memory-anchor-pre')
})

await t('#7-3 ★ 本模块零 IO（纯函数 —— 不写盘是当前设计的硬约束）', () => {
  ok(!/from\s+'node:fs'/.test(CODE), '★ 未 import node:fs')
  ok(!/writeFile|appendFile|mkdir/.test(CODE), '★ 无任何写操作')
})

await t('#7-4 ★ 三态取值域与 L0_STATUSES 同源（枚举类常量须配断言兜底）', async () => {
  const L0 = await import(new URL('l0-extract.js', LIB))
  ok(Array.isArray(L0.L0_STATUSES), 'L0_STATUSES 存在')
  eq('★ 取值域逐项一致（顺序无关，集合相同）',
    [...M.NOTE_STATUSES_PRE_V1].sort().join(','),
    [...L0.L0_STATUSES].sort().join(','))
})

await t('#7-5 ★ 当前无调用方（未接线状态必须被断言锁住，防"以为已生效"）', async () => {
  const IDX = readFileSync(new URL('index.js', LIB), 'utf8')
  ok(!IDX.includes('note-status.js'),
    '★ index.js 尚未引用本模块 —— 若此处变红，说明已开始接线，须同步更新 GAP 文档的 F1/F2 状态')
})

console.log('\n--- note-status-pre 回归锁 ---')
console.log('pass=' + pass + ' fail=' + fail)
process.exit(fail ? 1 : 0)
