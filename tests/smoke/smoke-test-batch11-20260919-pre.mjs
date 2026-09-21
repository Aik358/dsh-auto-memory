#!/usr/bin/env node
/**
 * smoke-test-batch11-20260919-pre.mjs —— 第十一批（⑩-a/⑩-b 修复 + ⑨ 漏网追加）
 *
 * **背景**：⑨ 判定为「修得不完整」——真机实测 `procedures.size` 12→14、`pipeline` 3→5，
 * 用户截图的「技能审批队列 (5)」**不是旧快照，是真的又长回来了**。
 *
 * 本批三类改动（取证见 `docs/internal/ISSUE9-RESIDUAL-FORENSICS-20260919.md`
 * 与 `docs/internal/ISSUE10B-FORENSICS-20260919.md`）：
 *
 *  **T1-0 —— F3 判据「太具体」**
 *    新增两条脏 title：`Source: me`（`Source: mem_<32hex>` 被 slice 截断的残片）
 *    与 `Reference: ## 2026-09-18 - dsh-auto-memo`（F3 **完全没有** `^Reference:` 这一条）。
 *    根因：`^Source:\s*mem_[0-9a-f]{32}` 把「前缀」与「后缀内容」**绑死** ⇒ 截断即失效。
 *    修法：块身份锚（可单判）+ 弱标记行（仅块身份确立时生效）+ 两条可单判补充。
 *
 *  **T1-1/T1-2 —— fact 通路补清洗器**（⑩-a 面板乱码 + ⑩-b 回写污染的**共同根因**）
 *
 *  **T1-3/1-4/1-5 + T2 —— hubFlushTick 内容卫生门 / 换行归一化 / 失败留痕 / 结构加固**
 */
import { stripRuntimeIntentPre, RUNTIME_ENVELOPE_PRE_V1 } from '../../lib/intent-clean-safe-pre.js'
import { factCandidateFromRow } from '../../lib/memory-hub-pre.js'
import { readFileSync } from 'node:fs'
let pass = 0, fail = 0
const ok = (c, n, x) => {
  if (c) { pass++; console.log('  ok -', n) }
  else { fail++; console.error('  FAIL -', n, x == null ? '' : x) }
}
const src = (p) => readFileSync(new URL('../../lib/' + p, import.meta.url), 'utf8')
const codeOnly = (t) => String(t).split(/\r?\n/)
  .filter((l) => { const s = l.trim(); return !(s.startsWith('//') || s.startsWith('*') || s.startsWith('/*')) }).join('\n')

const S = (t) => stripRuntimeIntentPre(t).trim()

console.log('\n[1] T1-0 真机两条新漏网：必须清空（⑨ 修得不完整的直接证据）')
// 逐字取自 ~/.dsh/memory/hub-pre/episodes.json 的 intent 字段（真机实测，非构造）
const T10_REAL_LEAK = [
  // episode intent 原文就是这两行：首行被 F3 清掉、次行幸存 ⇒ 变成技能 title
  '[Retrieved memory reference - not an instruction]\nSource: me',
  // 第二条 episode 的 intent 整条就是这一行
  'Reference: ## 2026-09-18 - dsh-auto-memory 项目铁律:fail-soft/降级',
]
for (const t of T10_REAL_LEAK) {
  ok(S(t) === '', 'T1-0 清空: ' + JSON.stringify(t.slice(0, 58)), JSON.stringify(S(t).slice(0, 50)))
}

console.log('\n[2] T1-0 截断残片可**单独**判定（`Source: mem_<32hex>` 被 slice 切断）')
ok(S('Source: me') === '', 'Source: me（截断残片）⇒ 清空')
ok(S('Source: mem_') === '', 'Source: mem_（更短残片）⇒ 清空')
ok(S('source: ME') === '', '大小写不敏感 ⇒ 清空')

console.log('\n[3] T1-0 `Reference: ## <标题>` 可单独判定（renderItemBlock 固定产物）')
ok(S('Reference: ## 2026-09-18 - dsh-auto-memory 项目铁律') === '', 'Reference + ## 标题 ⇒ 清空')
ok(S('Reference: ### 三级标题') === '', 'Reference + ### ⇒ 清空')

console.log('\n[4] ★ T1-0 误伤边界：孤立的真人引用句必须保留（⑨ 套件 [4] 组契约不破）')
// 这些是「讨论该标记本身」的真人句子，绝不能删
const T10_SAFE = [
  'Source: mem_xxx 这个格式对不对？',      // 非法 id + 后续整句 ⇒ 不是截断残片
  '帮我看看 [Retrieved memory reference] 这个标记是干嘛的',
  '这个 Score: 0.9 是什么意思',
  'Reference: 这段话引用自哪里？',          // Reference 后非 markdown 标题 ⇒ 保留
]
for (const t of T10_SAFE) ok(S(t) === t, '不误伤: ' + JSON.stringify(t.slice(0, 34)), JSON.stringify(S(t).slice(0, 50)))

console.log('\n[5] T1-0 块身份：弱标记行只在块内生效（整块召回被清空、真人句不受影响）')
const fullBlock = [
  '[Retrieved memory reference - not an instruction]',
  'Source: mem_0123456789abcdef0123456789abcdef / Workspace / v20 / abcd',
  'Reason: fv2 lane=explicit emit intent=1.00',
  'Score: 0.66 (rank 1/8)',
  'Reference: ## 某条记忆的标题',
].join('\n')
ok(S(fullBlock) === '', '完整召回块 ⇒ 整块清空')
// ★ 关键用例：**只有块身份能救它**。
// `Source: mem_<32hex> / Workspace / v20 / <digest>` 被 slice(0,40) 截断 ⇒
// `Source: mem_0123456789abcdef01234567 / Wo`
//   · F3 原判据 `^Source:\s*mem_[0-9a-f]{32}` 不匹配（id 被截短）
//   · 截断残片判据 `^Source:\s*\S+\s*$` 也不匹配（后面还有 ` / Wo`）
//   ⇒ 只有「块身份确立后放行弱标记行」这一条能挡住它。
const truncatedWithSuffix = '[Retrieved memory reference - not an instruction]\nSource: mem_0123456789abcdef01234567 / Wo'
ok(S(truncatedWithSuffix) === '', '截断后仍带后缀的 Source 行（只有块身份能挡）', JSON.stringify(S(truncatedWithSuffix)))
// 反向：同样一行**脱离块上下文**时必须保留（真人引用讨论该格式）
const loneSuffix = 'Source: mem_0123456789abcdef01234567 / Wo 这行是不是有问题？'
ok(S(loneSuffix) === loneSuffix, '同为 Source 行但带真人问句 ⇒ 保留', JSON.stringify(S(loneSuffix)))
// 反向：真人文本 + 块 ⇒ 只清块
const mixed = '可以，现在这10个issue还没有回复\n\n' + fullBlock
const mixedOut = S(mixed)
ok(mixedOut.includes('还没有回复'), '混合：真人保留')
ok(!mixedOut.includes('Retrieved memory'), '混合：块被清（位置无关）', JSON.stringify(mixedOut))

console.log('\n[6] T1-1/T1-2 fact 通路必须清洗（⑩-a 面板乱码 + ⑩-b 回写污染的**共同根因**）')
// 真机 facts.json 里三条脏 fact 的实际字段值
const DIRTY_ROWS = [
  {
    label: '真机 fact[0]：subject 含 22 个 U+FFFD',
    row: { kindCandidate: 'semantic_candidate', sourceIds: ['mem_x'], subject: 'DSH \uFFFD'.repeat(22), predicate: 'has three modes', object: 'shadow' },
  },
  {
    label: '真机 fact[1]：object 内嵌运行时信封',
    row: { kindCandidate: 'semantic_candidate', sourceIds: ['mem_x'], subject: '让我自己去试吧。现在是什么情况？', predicate: '有未决事项', object: '现在是什么情况？ Current DSH file policy: danger-full-access. The DS' },
  },
  {
    label: '真机 fact[3]：object 内嵌审批信封',
    row: { kindCandidate: 'semantic_candidate', sourceIds: ['mem_x'], subject: 'Approval prompts are disabled', predicate: '有未决事项', object: 'Approval prompts are disabled in this session: actions that' },
  },
]
for (const { label, row } of DIRTY_ROWS) {
  const c = factCandidateFromRow(row)
  const s = JSON.stringify({ s: c.subject, p: c.predicate, o: c.object })
  const hasFFFD = /\uFFFD/.test(s)
  const hasEnv = /Current DSH file policy|Approval prompts are disabled|Current runtime context|Retrieved memory ref/i.test(s)
  ok(!hasFFFD && !hasEnv, label, s)
}

console.log('\n[7] T1-2 不误伤：正常 fact candidate 字段必须原样保留')
const cleanRow = {
  kindCandidate: 'semantic_candidate', sourceIds: ['mem_0123456789abcdef0123456789abcdef'],
  subject: '正常主语', predicate: '正常谓语', object: '正常宾语', confidence: 0.9,
}
const cc = factCandidateFromRow(cleanRow)
ok(cc && cc.subject === '正常主语' && cc.predicate === '正常谓语' && cc.object === '正常宾语',
  '正常字段原样保留', JSON.stringify({ s: cc.subject, p: cc.predicate, o: cc.object }))
ok(cc && cc.confidence === 0.9 && cc.sourceClass === 'semantic-candidate', 'confidence/sourceClass 未受影响')
// 空值回退语义必须保持（原实现是 `String(row.subject || sourceIds[0])`）
const emptyRow = { kindCandidate: 'semantic_candidate', sourceIds: ['mem_fallback'], subject: '', predicate: '', object: null }
const ce = factCandidateFromRow(emptyRow)
ok(ce && ce.subject === 'mem_fallback', 'subject 空 ⇒ 回退 sourceIds[0]（保持原语义）', ce && ce.subject)
ok(ce && ce.predicate === 'relation', 'predicate 空 ⇒ 回退 relation（保持原语义）', ce && ce.predicate)
ok(ce && ce.object === null, 'object 空 ⇒ null（保持原语义）', ce && JSON.stringify(ce.object))
// 非候选行必须仍返回 null
ok(factCandidateFromRow({ kindCandidate: 'other', sourceIds: ['x'] }) === null, '非候选 kind ⇒ null')
ok(factCandidateFromRow({ kindCandidate: 'semantic_candidate', sourceIds: [] }) === null, '无 sourceIds ⇒ null')

console.log('\n[8] T1-1/T1-3/T1-4/T1-5（源码级接线锁；★ 均断言**完整表达式**，因首轮变异演示暴露「只断言字面量存在」太弱）')
const idx = src('index.js')
const idxCode = codeOnly(idx)
const hubCode = codeOnly(src('memory-hub-pre.js'))
// T1-1 crossFeed 的 fact 分支（首轮变异演示发现：原套件只测了 T1-2，漏测本处）
ok(hubCode.includes("const factIntent = looksRuntimeResiduePre(rawIntent) ? '' : stripRuntimeIntentPre(rawIntent).trim()"),
  'T1-1 crossFeed fact 分支 subject：完整表达式（F5 + 清洗）')
ok(hubCode.includes("const factObject = looksRuntimeResiduePre(rawObject) ? '' : stripRuntimeIntentPre(rawObject).trim()"),
  'T1-1 crossFeed fact 分支 object：完整表达式')
ok(hubCode.includes('const rawIntent = String(ep.intent == null'), 'T1-1 先取原始值再判定（不就地改语义）')
// T1-2 factCandidateFromRow（三条字段都要完整表达式）
ok(hubCode.includes("const cSubject = looksRuntimeResiduePre(rawSubject) ? '' : stripRuntimeIntentPre(rawSubject).trim()"),
  'T1-2 factCandidateFromRow subject：完整表达式')
ok(hubCode.includes("const cPredicate = looksRuntimeResiduePre(rawPredicate) ? '' : stripRuntimeIntentPre(rawPredicate).trim()"),
  'T1-2 factCandidateFromRow predicate：完整表达式')
ok(hubCode.includes(': (looksRuntimeResiduePre(rawObject) ? null : (stripRuntimeIntentPre(rawObject).trim() || null))'),
  'T1-2 factCandidateFromRow object：完整表达式')
// T1-3 卫生门
ok(idxCode.includes('stripRuntimeIntentPre(subj)'), 'T1-3 卫生门：对 subject 调清洗器')
ok(idxCode.includes('stripRuntimeIntentPre(objRaw)'), 'T1-3 卫生门：对 object 调清洗器')
ok(idxCode.includes('|| looksRuntimeResiduePre(subj) || looksRuntimeResiduePre(objRaw) || looksRuntimeResiduePre(predRaw)'),
  'T1-3 脏判定完整表达式含 F5 三项（行内残留也判脏）')
ok(/if \(dirty\) \{/.test(idxCode), 'T1-3 脏则走 skip 分支')
ok(idxCode.includes("diag('hub flush skip(hygiene)"), 'T1-3 跳过留痕（diag）')
ok(idxCode.includes("_degradePre.record('hub-flush'"), 'T1-3 跳过写 degrade 台账')
// T1-4 换行归一化：三字段完整表达式 + 拼接确实用了归一化变量
ok(idxCode.includes("const subj1 = cSubj.replace(/\\s*[\\r\\n]+\\s*/g, ' ').trim()"), 'T1-4 subject 归一化完整表达式')
ok(idxCode.includes("const pred1 = cPred.replace(/\\s*[\\r\\n]+\\s*/g, ' ').trim()"), 'T1-4 predicate 归一化完整表达式')
ok(idxCode.includes("const obj1 = cObj.replace(/\\s*[\\r\\n]+\\s*/g, ' ').trim()"), 'T1-4 object 归一化完整表达式')
ok(idxCode.includes("'\\n## ' + subj1 + '（M8 固化）\\n- ' + pred1 + (obj1 ? '：' + obj1 : '')"),
  'T1-4 拼接用的是归一化后的变量（否则归一化白做）')
// T1-5 失败留痕
ok(idxCode.includes('} catch (eFlush) {'), 'T1-5 失败不再被空 catch 吞（具名异常变量）')
ok(idxCode.includes("diag('hub flush FAIL: fact '"), 'T1-5 失败留痕（diag）')
ok(idxCode.includes("_degradePre.record('hub-flush', 'append-failed:'"), 'T1-5 失败写 degrade 台账（完整表达式）')
const oldSilent = /\} catch \(_\) \{\}\s*\n\s*\}\s*\n\s*hubFlushSave\(\)/.test(idxCode)
ok(!oldSilent, 'T1-5 反证：原 `catch (_) {}` + 无条件 hubFlushSave 组合已不存在')

console.log('\n[9] T2 四项结构加固（均断言完整表达式）')
// T2-3：锚点必须**限定在 hubFlushSave 内**（全仓 renameSync 有两处，仅断言 `renameSync(tmp, f)` 会假绿）
const flushSaveBody = (() => {
  const i = idxCode.indexOf('const hubFlushSave = () => {')
  return i < 0 ? '' : idxCode.slice(i, i + 700)
})()
ok(flushSaveBody.includes("const tmp = f + '.tmp'"), 'T2-3 hubFlushSave 内有临时文件名')
ok(flushSaveBody.includes('renameSync(tmp, f)'), 'T2-3 hubFlushSave 内 tmp→rename 原子替换（限定作用域内断言）')
ok(/flush-state|flushed: hubFlushState\.flushed/.test(flushSaveBody), 'T2-3 确认锁定的是 flush-state 那段（非邻近代码）')
// T2-4 重入保护
ok(idxCode.includes('let hubFlushInFlight = false'), 'T2-4 重入标志初始化')
ok(idxCode.includes('if (hubFlushInFlight) {'), 'T2-4 重入判定完整表达式')
ok(idxCode.includes('try { await hubFlushTick() } finally { hubFlushInFlight = false }'), 'T2-4 finally 复位（异常也不卡死）')
ok(idxCode.includes('setInterval(() => { void hubFlushTickGuarded() }'), 'T2-4 定时器改走 guarded 版本（完整表达式）')
ok(idxCode.includes('hubBootTimer = setTimeout(() => { hubFeedTick(); void hubFlushTickGuarded() }'), 'T2-4 boot 也走 guarded')
// T2-2 disposer
ok(idxCode.includes('clearInterval(hubFeedTimer); clearInterval(hubFlushTimer); clearTimeout(hubBootTimer)'),
  'T2-2 disposer 完整表达式含 clearTimeout(hubBootTimer)')
// T2-1
ok(idxCode.includes("diag('hub flush skip(already-in-body)"), 'T2-1 「已在正文」分支不再静默（有留痕）')

console.log('\n[10] 判据导出与向后兼容（⑨ 的既有契约不得破）')
const R = RUNTIME_ENVELOPE_PRE_V1
ok(R && typeof R.isEnvelopeLinePre === 'function', 'isEnvelopeLinePre 仍可调用')
ok(R.PLUGIN_TAIL_MARKER_RE instanceof RegExp, 'F3 原正则仍导出（名未变）')
ok(typeof R.looksEncodingCorruptedPre === 'function', 'F4 判据仍导出')
ok(R.EXACT_ENVELOPE_RE instanceof RegExp && R.HARNESS_HEAD_RE instanceof RegExp, 'F1/F2 判据未丢')
// ③ 的老形态仍必须被挡住（回归保护）
ok(S('Current runtime context. This snapshot s') === '', '③ 信封仍被挡')
ok(S('Approval prompts are disabled in this se') === '', '③ 截断信封仍被挡')
ok(S('\uFFFD\uFFFD\uFFFD乱码') === '', 'F4 三个 U+FFFD 仍清空')

console.log('\n[11] ★ F5 行内残留（本套件 [6] 组曾跑出的真 FAIL 所暴露的缺口）')
// 由来：清洗器是**按行**判断的，真人与信封挤在同一行时整行必须保留（删了丢人话）
// ⇒ 「清洗后是否变化」对行内混合**天然无效**。真机 fact[1] 的 object 正是这个形态。
const F5 = RUNTIME_ENVELOPE_PRE_V1.looksRuntimeResiduePre
ok(typeof F5 === 'function', 'F5 判据已导出')
// 真机两例：必须判脏（这些值确实存在于 facts.json）
ok(F5('现在是什么情况？ Current DSH file policy: danger-full-access. The DS') === true, '真机 fact[1] object ⇒ 判脏')
ok(F5('Approval prompts are disabled in this session: actions that') === true, '真机 fact[3] object ⇒ 判脏')
// 边界：F5 只管「信封痕迹」，U+FFFD 由 F4 负责
ok(F5('DSH \uFFFD\uFFFD\uFFFD | has three modes') === false, 'F5 不管 U+FFFD（F4 职责，已覆盖）')
// 反向：干净文本必须放行
for (const t of ['现在是什么情况？', '这是一句正常的话', 'Current 这个词本身没问题', '']) {
  ok(F5(t) === false, 'F5 放行: ' + JSON.stringify(t.slice(0, 24)))
}
// 端到端：行内混信封的字段被丢弃，同条干净字段不受牵连
const inlineDirty = factCandidateFromRow({
  kindCandidate: 'semantic_candidate', sourceIds: ['mem_x'],
  subject: '正常主语', predicate: '有未决事项',
  object: '现在是什么情况？ Current DSH file policy: danger-full-access. The DS',
})
ok(inlineDirty && inlineDirty.object === null, 'T1-2 + F5：行内混信封的 object ⇒ 置 null', JSON.stringify(inlineDirty && inlineDirty.object))
ok(inlineDirty && inlineDirty.subject === '正常主语', 'T1-2 + F5：同条干净字段不受牵连')

console.log(`\n=== PASS ${pass} / FAIL ${fail} ===`)
process.exit(fail === 0 ? 0 : 1)

