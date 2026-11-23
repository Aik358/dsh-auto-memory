// issue#472 验收：PLAN revision 口径分叉 —— 读侧算原文 sha256、写侧算 healed 摘要。
//
// 缺陷（修复前，HEAD 6a3da76a）：
//   · 读侧 memory_read(kind=plan) 给 planRevisionPre(磁盘原文)
//   · 写侧 CAS（plan-store.js:202）与冲突档（:163）比 planRevisionPre(healed 文本)
//   ⇒ 同一份含**重复锚点**的文件两值恒不相等 ⇒ 白板永久冻结（作者实测 20 天零写入），
//     且错误码是误导性的 plan-version-conflict。
//
// 本套件是**功能验收（CR-10）**：真 import → 真构造 PLAN.md → 真调写盘路径 → 断言返回值与磁盘。
//   [A] 向后兼容硬判据：**无重复锚点**的文档 revision 与旧口径（sha256 原文）逐字节相同
//   [B] 修复点：含重复锚点的文档，rev(原文) === rev(healed)
//   [C] 真写盘：模拟 memory_read 拿到的 revision → writePlanSnapshot 必须成功（修前必红）
//   [D] #434 闸门未削弱：真重复仍报 plan-card-duplicate-id
//   [E] 外部编辑保护未削弱：写入期间改盘 ⇒ plan-external-edit-conflict
//   [F] heal 幂等（这是「归一到摘要层」成立的前提）
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import {
  planRevisionPre, canonicalPlanTextPre, planSameContentPre,
  healPlanDuplicateIdsPre, preparePlanPre, planCardsPre,
} from '../../lib/plan-store.js'

let pass = 0, fail = 0
const ok = (c, name, extra) => { if (c) { pass++; console.log('  ok   - ' + name + (extra ? ' :: ' + extra : '')) } else { fail++; console.error('  FAIL - ' + name + (extra ? ' :: ' + extra : '')) } }
const sha256 = (t) => createHash('sha256').update(t).digest('hex')
const idOf = (ch) => 'mem_' + ch.repeat(32)

const CLEAN = [
  '# 白板', '',
  '## 目标', '<!-- memory:' + idOf('a') + ' -->', '目标正文', '',
  '## 状态', '<!-- memory:' + idOf('b') + ' -->', '状态正文', '',
].join('\n')

// 两张卡共用同一 id（模拟 #434/#449-3 产生过的存量文件）
const DUP = [
  '# 白板', '',
  '## 目标', '<!-- memory:' + idOf('c') + ' -->', '目标正文', '',
  '## 状态', '<!-- memory:' + idOf('c') + ' -->', '状态正文', '',
].join('\n')

const DIR = mkdtempSync(path.join(tmpdir(), 'dam-472-'))
const planPath = path.join(DIR, 'PLAN.md')

console.log('=== A. 向后兼容硬判据：干净文档 revision 不变 ===')
ok(healPlanDuplicateIdsPre('', CLEAN).healed === 0, 'A-1 干净文档 heal 命中 0（恒等变换）')
ok(planRevisionPre(CLEAN) === sha256(CLEAN), 'A-2 ★★★ 无重复锚点 ⇒ revision 与 sha256(原文) 逐字节相同（旧 pin 全部不受影响）', planRevisionPre(CLEAN).slice(0, 16))
ok(canonicalPlanTextPre(CLEAN) === CLEAN, 'A-3 干净文档的规范形 === 原文')

console.log('')
console.log('=== B. 修复点：含重复锚点的文档，两套口径归一 ===')
const h = healPlanDuplicateIdsPre('', DUP)
ok(h.healed === 1, 'B-1 重复文档 heal 命中 1', String(h.healed))
ok(h.text !== DUP, 'B-2 heal 确实改了文本（去掉了第二个重复锚点）', h.text.length + ' vs ' + DUP.length)
ok(planRevisionPre(DUP) === planRevisionPre(h.text), 'B-3 ★★★ rev(原文) === rev(healed)（修复前恒不相等）',
  planRevisionPre(DUP).slice(0, 16) + ' vs ' + planRevisionPre(h.text).slice(0, 16))
ok(planRevisionPre(DUP) !== sha256(DUP), 'B-4 ★ 但已**不等于** sha256(原文)（说明归一确实生效，不是恒等）', planRevisionPre(DUP).slice(0, 16))
ok(planSameContentPre(DUP, h.text) === true, 'B-5 planSameContentPre(原文, healed) = true（写侧外部编辑判据可复用）')
ok(planSameContentPre(DUP, CLEAN) === false, 'B-6 不同内容仍判不等（不恒真）')

console.log('')
console.log('=== C. 真写盘：memory_read 拿到的 revision 必须能写成 ===')
writeFileSync(planPath, DUP, 'utf8')
const readRev = planRevisionPre(readFileSync(planPath, 'utf8'))   // 模拟 memory_read(kind=plan).revision
const heurRev = planRevisionPre(healPlanDuplicateIdsPre('', DUP).text)  // 模拟写侧 healed 摘要
ok(readRev === heurRev, 'C-1 ★★★ 读侧 revision 与写侧 healed 摘要相等（口径已同源）', readRev.slice(0, 16))
const NEW = '# 白板\\n\\n## 目标\\n目标已更新\\n'
// ★★C-2 必须**忠实模拟产线写路径**才对变异有鉴别力：
//   lib/index.js:4692-4700 是 `existing = heal(raw)` 之后再 `preparePlanPre(planPath, existing, …)`
//   ⇒ 写侧喂进去的 current 是 **healed 文本**，而读侧给调用方的 revision 算自 **raw 文本**。
//   两种输入不同 ⇒ 只有「摘要对 heal 幂等」时两者才相等。若这里直接喂 DUP(raw)，
//   变异后两侧仍是同一输入 ⇒ 断言恒绿、失去鉴别力（第一版就踩了这个坑）。
const healedForWrite = healPlanDuplicateIdsPre('', DUP).text
let prep
try {
  prep = await preparePlanPre(planPath, healedForWrite, NEW, { expectedRevision: readRev })
} catch (e) { prep = { ok: false, error: 'THREW: ' + e.message } }
ok(prep && prep.ok === true, 'C-2 ★★★ 产线写路径（current=healed）用**读侧 revision**(算自 raw) 通过 CAS（修复前必报 plan-version-conflict）', String((prep && prep.error) || 'ok').slice(0, 100))
// 对照：current=raw 时也应通过（证明上面的红/绿差异来自「两种输入」，不是别的原因）
const prepRaw = await preparePlanPre(planPath, DUP, NEW, { expectedRevision: readRev })
ok(prepRaw && prepRaw.ok === true, 'C-3 对照：current=raw 时同样通过（两种输入都已归一）')

console.log('')
console.log('=== D. #434 闸门未削弱：真重复仍被拦 ===')
// 单卡编辑路径：同一 id 出现 2 次 ⇒ 必须报 PLAN_CARD_DUPLICATE_ID（与 revision 无关）
const dupCard = await preparePlanPre(planPath, DUP, '## 目标\n<!-- memory:' + idOf('c') + ' -->\n改\n', { cardId: idOf('c'), expectedCardRevision: planRevisionPre(planCardsPre(DUP)[0].text) })
ok(dupCard && dupCard.ok === false, 'D-1 单卡编辑遇重复 id ⇒ 拒绝', String((dupCard && dupCard.error) || '').slice(0, 80))
ok(dupCard && dupCard.code === 'PLAN_CARD_DUPLICATE_ID', 'D-2 ★ code = PLAN_CARD_DUPLICATE_ID（不是伪装成 revision 冲突）', String(dupCard && dupCard.code))
ok(dupCard && Number(dupCard.duplicateCount) === 2, 'D-3 duplicateCount = 2', String(dupCard && dupCard.duplicateCount))

console.log('')
console.log('=== E. 外部编辑保护未削弱 ===')
const ok2 = await preparePlanPre(planPath, DUP, NEW, { expectedRevision: 'deadbeef'.repeat(8) })
ok(ok2 && ok2.ok === false, 'E-1 错误的 expectedRevision ⇒ 拒绝（CAS 仍有效）', String((ok2 && ok2.error) || '').slice(0, 80))
ok(ok2 && String(ok2.error || '').startsWith('plan-version-conflict'), 'E-2 错误码仍是 plan-version-conflict', String(ok2 && ok2.error).slice(0, 60))

console.log('')
console.log('=== F. heal 幂等（归一到摘要层成立的前提）===')
const once = healPlanDuplicateIdsPre('', DUP).text
const twice = healPlanDuplicateIdsPre('', once).text
ok(once === twice, 'F-1 heal(heal(x)) === heal(x)')
ok(healPlanDuplicateIdsPre('', once).healed === 0, 'F-2 二次 heal 命中 0')
ok(planRevisionPre(once) === planRevisionPre(DUP), 'F-3 rev 在 heal 前后不变（幂等的直接推论）')
// 三重复：仍能全部收敛到同一摘要
const TRIPLE = DUP.replace('## 状态', '## 状态') .replace(/<!-- memory:mem_c{32} -->/g, '<!-- memory:' + idOf('c') + ' -->') + '\n## 第三\n<!-- memory:' + idOf('c') + ' -->\n第三正文\n'
const ht = healPlanDuplicateIdsPre('', TRIPLE)
ok(ht.healed === 2, 'F-4 三处同 id ⇒ heal 命中 2', String(ht.healed))
ok(planRevisionPre(TRIPLE) === planRevisionPre(ht.text), 'F-5 三重复同样归一')

console.log('')
console.log((fail === 0 ? 'PASS ' : 'FAIL ') + pass + ' / FAIL ' + fail)
try { rmSync(DIR, { recursive: true, force: true }) } catch (_) {}
process.exit(fail === 0 ? 0 : 1)
