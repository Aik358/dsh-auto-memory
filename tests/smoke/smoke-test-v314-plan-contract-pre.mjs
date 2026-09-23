/**
 * v3.1.4 批 I 永久守卫：白板重写「契约可见性」（A + B + C-修）。
 *
 * 钉死三件事（都是用户报障「每次都重试」的真实成因）：
 *   I1 工具描述里必须写明「plan 重写前先 read 磁盘原文抄回锚点」（A）
 *   I2 M1 拒绝时回吐**缺失卡片原文块**（B）——真跑纯函数，不用字符串断言糊弄
 *   I3 拒绝文案给出**两条真出路**（原样带回 / 声明归档）：批 I 删旧句时 archivedIds 尚未接通，
 *      同批的批 J 已把它接进工具 ⇒ 只给一条出路会与实现和 t0-8:119 互相打脸。
 *
 * ★本套件同时是「三处根因」的回归网（2026-09-22 实测踩到，已记入工程纪律）：
 *   · 探针串必须逐字复制目标文本（首版 '必须 read' vs 实际 '必须先 read' ⇒ 假红）
 *   · 计数断言要把替换文本自身的贡献算进去（注释里复述被删句 ⇒ 计数不为 0）
 *   · 卡片判据是 `### ` 起步（`## ` 是节）—— 取样/断言都必须回抄解析器口径，不得自造
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mutationRefusalTextPre } from '../../lib/memory-mutation.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
const IX = path.join(ROOT, 'lib', 'index.js')
const MM = path.join(ROOT, 'lib', 'memory-mutation.js')

let pass = 0, fail = 0
const ok = (c, n, d) => { if (c) { pass++; console.log('  ✓ ' + n) } else { fail++; console.error('  ✗ ' + n + (d ? ' — ' + d : '')) } }
const cnt = (h, n) => { let c = 0, i = 0; for (;;) { const p = h.indexOf(n, i); if (p < 0) return c; c++; i = p + n.length } }

const ix = fs.readFileSync(IX, 'utf8')
const mm = fs.readFileSync(MM, 'utf8')

console.log('=== I1 工具描述写明契约（A）===')
ok(ix.includes('必须先 read 磁盘 handoff/PLAN.md'), 'I1a ★描述含「先 read 磁盘原文」')
ok(ix.includes('注入快照会被截断'), 'I1b 说明为何必须读原文（快照会截断）')
// ★v3.1.4 审校修正：本批同时把白板 M1 丢卡**降级为警示**（批 J），原断言
//   「缺锚点会被保护门拒绝」是与本批行为自相矛盾的假陈述 —— 模型照它行动会以为
//   漏抄也没关系，或反过来以为 archivedIds 无用。故改钉真实后果，并加反向锁防复发。
ok(ix.includes('漏抄锚点=卡片消失') && ix.includes('不再硬拒'), 'I1c ★丢卡后果写明为「照写 + 警示」（与批 J 一致）')
ok(ix.includes('仍会硬拒的是两类'), 'I1c2 同时写明仍硬拒的两类（用户备注区未带回 / 卡片 id 重复）')
ok(!ix.includes('缺锚点会被保护门拒绝'), 'I1c3 ★反向锁：不得再声称丢卡会被直接拒绝')
// 锚点：该描述必须在 memory_note 的 kind 参数行里（不是别处）
{
  const i = ix.indexOf("defineTool('memory_note'")
  const j = ix.indexOf("enum: ['note', 'handoff', 'plan']")
  ok(i > 0 && j > i && (j - i) < 6000, 'I1d 契约落在 memory_note 的 kind 参数内（间距 ' + (j - i) + '）')
}

console.log('\n=== I2 拒绝时回吐缺失卡片原文块（B）===')
ok(ix.includes('missingCardsExcerptPre(beforeText, res)'), 'I2a 拒绝路径接线了切块函数')
// 精确计两次：函数**定义**（`missingCardsExcerptPre(beforeText, res) {`）+ 拒绝路径**调用**。
// ⚠️ 计数坑（本轮第二次踩）：`missingCardsExcerptPre(beforeText, res)` 这个串在**定义行里也有**，
//   所以它出现 2 次而非 1 次 —— 要区分调用点必须带上赋值前缀 `excerpt = `。
// ★v3.1.4 批 J 修正：判据改成**下界 ≥2**（定义 + 至少一处调用）。后续批次在同一函数里
//   新增调用点是合法演进（批 J 就加了一处），钉死精确值会让守卫变成"改别处就红"的脆断言。
ok(cnt(ix, 'missingCardsExcerptPre') >= 2, 'I2b 定义 + 至少一处调用（实得 ' + cnt(ix, 'missingCardsExcerptPre') + '）')
ok(cnt(ix, 'excerpt = missingCardsExcerptPre(beforeText, res)') === 1, 'I2b2 拒绝路径调用点唯一且在拒绝路径（带赋值前缀）')
ok(ix.includes('let excerpt ='), 'I2b3 有 excerpt 局部声明（拒绝分支）')
// 真跑：抽函数体
try {
  const start = ix.indexOf('  missingCardsExcerptPre(beforeText, res) {')
  const retTok = ix.indexOf('为便于一轮补齐，以下是消失卡片的原文块', start)
  const end = ix.indexOf('\n  }', retTok) + 5
  const body = ix.slice(start, end).replace('  missingCardsExcerptPre(beforeText, res) {', 'missingCardsExcerptPre(beforeText, res) {')
  const obj = new Function('return ({' + body + '})')()
  const F = (t, r) => obj.missingCardsExcerptPre(t, r)
  // ⚠️ 样例必须与真实白板同构：## 是节、### 是卡（判据 /^#{3,}\s+\S/）
  const SAMPLE = [
    '# 白板', '',
    '## 节一',
    '### 卡甲',
    '<!--memory:mem_aaa -->',
    '卡甲正文。',
    '<!-- user -->',
    '用户备注，须逐字节带回。',
    '<!-- /user -->', '',
    '## 节二',
    '### 卡乙',
    '<!--memory:mem_bbb -->',
    '卡乙正文。', '',
    '### 卡丙',
    '<!--memory:mem_ccc -->',
    '卡丙正文。',
  ].join('\n')
  const r1 = F(SAMPLE, { hard: [{ id: 'M1', pass: false, missing: ['mem_bbb'] }] })
  ok(r1.includes('为便于一轮补齐'), 'I2c ★有缺失时产出回吐提示头')
  ok(r1.includes('mem_bbb') && r1.includes('卡乙正文'), 'I2d ★含缺失卡的锚点与正文')
  ok(!r1.includes('卡丙正文'), 'I2e 不夹带未缺失的卡')
  const r2 = F(SAMPLE, { hard: [{ id: 'M1', pass: false, missing: ['mem_aaa'] }] })
  ok(r2.includes('用户备注，须逐字节带回'), 'I2f ★连带用户备注区一起回吐')
  ok(F(SAMPLE, { hard: [{ id: 'M1', pass: true, missing: [] }] }) === '', 'I2g 无缺失时返回空串')
  ok(F('', { hard: [{ id: 'M1', pass: false, missing: ['mem_x'] }] }) === '', 'I2h 空原文 fail-soft')
  ok(F(SAMPLE, { hard: [{ id: 'M1', pass: false, missing: ['mem_zzz'] }] }) === '', 'I2i 找不到该卡时不抛错')
} catch (e) { ok(false, 'I2 纯函数真跑异常', String((e && e.message) || e).slice(0, 200)) }

console.log('\n=== I3 拒绝文案按失败类型给真出路 ===')
ok(!mm.includes('显式写入归档集合'), 'I3a 不再使用旧的不可达措辞')
ok(mm.includes('请逐项修正后重试'), 'I3b ★混合失败必须逐项修，不再误写成万能二选一')
ok(mm.includes('archivedIds 不能修复用户区丢失或改写'), 'I3b1 M2 明确 archivedIds 无效')
ok(mm.includes('archivedIds 不能修复重复 id'), 'I3b2 M3 明确 archivedIds 无效')
ok(mm.includes('先 read 磁盘 handoff/PLAN.md'), 'I3c 指引模型先读原文')
ok(mm.includes('原文件未改动'), 'I3d 保留「原文件未改动」')
{
  const mk = (...ids) => ({ hard: ids.map((id) => ({ id, pass: false, detail: 'probe-' + id })) })
  const m1 = mutationRefusalTextPre(mk('M1'))
  const m2 = mutationRefusalTextPre(mk('M2'))
  const m3 = mutationRefusalTextPre(mk('M3'))
  const mixed = mutationRefusalTextPre(mk('M1', 'M2'))
  ok(m1.includes('若确属有意移除') && m1.includes('archivedIds'), 'I3e ★M1 才给「有意移除 → archivedIds」真出路')
  ok(m2.includes('[M2]') && m2.includes('archivedIds 不能修复') && !m2.includes('若确属有意移除'),
    'I3f ★M2 不会误导模型靠 archivedIds 重试')
  ok(m3.includes('[M3]') && m3.includes('archivedIds 不能修复') && !m3.includes('若确属有意移除'),
    'I3g ★M3 不会误导模型靠 archivedIds 重试')
  ok(mixed.includes('[M1]') && mixed.includes('[M2]') && mixed.includes('请逐项修正后重试'),
    'I3h ★M1+M2 混合失败要求两项都修，不再宣称二选一')
}

console.log('\n=== I4 卡片判据同源（防再次自造形态）===')
{
  const wb = fs.readFileSync(path.join(ROOT, 'lib', 'wb-contract.js'), 'utf8')
  ok(/isCardTitle = \(line\) => \/\^#\{3,\}\\s\+\\S\//.test(wb), 'I4a 解析器判据确为 ### 起步')
  ok(/if \(\/\^#\{3,\}\\s\+\\S\/\.test\(lines\[i\]\.replace\(\/\\r\$\/, ''\)\)\) starts\.push\(i\)/.test(ix),
    'I4b ★切块函数与解析器同口径（同样 regex，非自造）')
}

console.log('\n[汇总] ' + pass + ' passed, ' + fail + ' failed')
process.exit(fail ? 1 : 0)
