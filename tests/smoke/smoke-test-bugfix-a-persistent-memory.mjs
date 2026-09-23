/**
 * 长期记忆系统 A 批修复守卫 —— 纯源码/纯函数断言,不起浏览器、不写盘。
 *
 * 覆盖 9 条确定性 bug（详见 docs/internal/BUGLIST-persistent-memory-20260921.md）：
 *   A-1 清洗器漏网 `Reference: - HH:MM [kind:x]` 残片（真实脏串实测）
 *   A-2 handoff 账本超长静默截断（返回值必须外显 truncated）
 *   A-3 factId 重复主键（upsert 复活而非 push 第二条）
 *   A-4 状态行写入破坏 CRLF
 *   A-5 procedureCorrectionCap 的 `|| 0.3` 让「0」不可表达
 *   A-6 validateProcedurePre 缺 evidence 校验
 *   A-7 episodic current 不按 sessionRef 隔离
 *   A-8 persist() 吞掉落盘失败
 *   A-9 前端晋升按钮条件 ≠ 真实门限
 *
 * 纪律：本套件只读源码 + 跑纯函数；任何一条修复被回退都必须立刻变红。
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { looksRuntimeResiduePre, stripRuntimeIntentPre } from '../../lib/intent-clean-safe.js'
import { stripStatusLinePre } from '../../lib/note-status.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
const read = (p) => readFileSync(path.join(ROOT, 'lib', p), 'utf8')

const CLIENT = read('client.js')
const INDEX = read('index.js')
const CLEAN = read('intent-clean-safe.js')
const NOTE_STATUS = read('note-status.js')
const FACT = read('fact-store.js')
const EPISODIC = read('episodic-store.js')
const PROC = read('procedure-store.js')

let pass = 0, fail = 0
const ok = (cond, msg) => { if (cond) { pass++; console.log('  ✓ ' + msg) } else { fail++; console.log('  ✗ FAIL: ' + msg) } }

// ─────────────────────────────────────────────────────────────
console.log('== A-1 清洗器必须识别召回残片（真实脏串，行为断言） ==')
// 这条是 facts.json 里真实出现过的漏网串（fact_pre_9a706422e, 09-20 写入）
const REAL_DIRTY = [
  'Reference: - 20:16 [kind:todo]',
  'Reference: - 20:16 [kind:fact]',
  'Source: - 09:30 [kind:rule]',
  '20:16 [kind:todo]',
  '[kind:fact]',
]
for (const s of REAL_DIRTY) ok(looksRuntimeResiduePre(s) === true, `识别残片: ${JSON.stringify(s)}`)
// 反向: 正常人话不得被误判（防止把正则放宽到误杀）
const CLEAN_TEXT = [
  '你好，现在是什么情况？',
  '这是一个正常的句子，不该被清掉。',
  '请参考 README 里的说明',
  'kind: 记录类型',
]
for (const s of CLEAN_TEXT) ok(looksRuntimeResiduePre(s) === false, `不误杀: ${JSON.stringify(s)}`)
ok(/Reference\|Source\|Reason/.test(CLEAN), 'RUNTIME_RESIDUE_RE 含 Reference/Source/Reason 前缀族')

// ─────────────────────────────────────────────────────────────
console.log('== A-2 handoff 账本超长必须外显截断（不得静默） ==')
ok(/gateH\.truncated/.test(INDEX), 'handoff 分支读取 gateH.truncated')
ok(/账本超长已截断到/.test(INDEX), '返回值含截断提示文案')
ok(/进度与下一步/.test(INDEX) && /可能已丢失/.test(INDEX), '提示明确点出「进度与下一步」风险')

// ─────────────────────────────────────────────────────────────
console.log('== A-3 factId 不得重复（upsert 先查同 id） ==')
ok(/facts\.some\(|facts\.find\(/.test(FACT), 'upsert/restore 存在按 factId 查重')
ok(!/facts\.push\(fv\.fact\)\s*\/\/ no-check/.test(FACT), '不见「无检查直接 push」的旧注释')
ok(/restore[\s\S]{0,600}(seen|Set|factId)/.test(FACT), 'restore 按 factId 去重（含 seen/Set）')

// ─────────────────────────────────────────────────────────────
console.log('== A-4 状态行剥离必须保持 CRLF（行为断言） ==')
{
  const src = '## t1\r\n- l1\r\n<!-- dsh-status: superseded by=x -->\r\n\r\n## t2\r\n- l2\r\n'
  const out = stripStatusLinePre(src)
  const crlfBefore = (src.match(/\r\n/g) || []).length
  const crlfAfter = (out.match(/\r\n/g) || []).length
  const bareAfter = (out.match(/(?<!\r)\n/g) || []).length
  ok(bareAfter === 0, 'CRLF 文档剥离后不产生裸 LF')
  ok(crlfAfter === crlfBefore - 1, `只少掉状态行那一行 CRLF（${crlfBefore} → ${crlfAfter}）`)
  ok(!out.includes('dsh-status'), '状态行确实被剥除')
  const lf = '## t1\n- l1\n<!-- dsh-status: retracted reason=x -->\n'
  const o2 = stripStatusLinePre(lf)
  ok((o2.match(/\r/g) || []).length === 0, 'LF 文档不被改成 CRLF（双向安全）')
  ok(!o2.includes('dsh-status'), 'LF 文档状态行也被剥除')
}
ok(/includes\('\\r\\n'\)/.test(NOTE_STATUS), 'note-status-pre 探测原文换行风格')

// ─────────────────────────────────────────────────────────────
console.log('== A-5 procedureCorrectionCap 的 0 必须可表达 ==')
ok(!/Number\(engine\.config\.procedureCorrectionCap\)\s*\|\|\s*0\.3/.test(INDEX),
  '不再使用 `|| 0.3`（会让 0 被静默改回默认）')
ok(/procedureCorrectionCap[\s\S]{0,160}Number\.isFinite/.test(INDEX), '改用有限性判据')

// ─────────────────────────────────────────────────────────────
console.log('== A-6 procedure evidence 必须有校验/容错 ==')
ok(/addEvidence[\s\S]{0,900}normalizeEvidencePre\(p\.evidence\)/.test(PROC),
  'addEvidence 自增前规范化 evidence（防 NaN / TypeError 被吞）')
ok(/'evidence'/.test(PROC) || /q\.push\('evidence'\)/.test(PROC), 'validateProcedurePre 提及 evidence 校验')

// ─────────────────────────────────────────────────────────────
console.log('== A-7 episodic 必须按 sessionRef 隔离 ==')
// 断言按**意图**写：不管比较写在哪一侧（`current.sessionRef !== incomingRef` 或反之），
// 只要 append 真的做了「本段会话引用 vs 当前缓冲会话引用」的比较即可。
const hasSessionRefCompare =
  /current\.sessionRef\s*!==\s*[A-Za-z_$][\w$]*/.test(EPISODIC) ||
  /[A-Za-z_$][\w$]*\s*!==\s*current\.sessionRef/.test(EPISODIC)
ok(hasSessionRefCompare, 'append 检测 sessionRef 变化（不再跨会话并进同一 episode）')
ok(/if\s*\(\s*current\s*&&[^)]*sessionRef[^)]*\)\s*\{\s*\n?\s*consolidate\(\)/.test(EPISODIC),
  '检测到变化时先 consolidate（而非把旧会话段并进新 episode）')
// 反向验证：新开的 current 必须用**新的** incomingRef 作 sessionRef（旧实现是沿用旧引用）
ok(/sessionRef:\s*incomingRef/.test(EPISODIC),
  '新 current 绑定到新的 sessionRef（不再沿用上一会话的引用）')

// ─────────────────────────────────────────────────────────────
console.log('== A-8 persist() 不得静默吞掉落盘失败 ==')
ok(!/function persist\(\)\s*\{\s*try\s*\{\s*io\.save\(snapshot\(\)\)\s*\}\s*catch\s*\(_\)\s*\{\s*\}\s*\}/.test(FACT),
  'fact-store persist 不再是「空 catch 无返回」')
ok(!/function persist\(\)\s*\{\s*try\s*\{\s*io\.save\(snapshot\(\)\)\s*\}\s*catch\s*\(_\)\s*\{\s*\}\s*\}/.test(EPISODIC),
  'episodic-store persist 不再是「空 catch 无返回」')

// ─────────────────────────────────────────────────────────────
console.log('== A-9 前端晋升按钮必须与真实门限一致 ==')
ok(/p\.promotion\s*&&\s*p\.promotion\.decision\s*===\s*'promote'|!p\.promotion\s*\|\|\s*p\.promotion\.decision\s*===\s*'promote'/.test(CLIENT),
  '晋升按钮依赖只读投影 p.promotion.decision')
ok(/fail-soft/.test(CLIENT), '保留了投影缺失时的降级说明（不硬拦旧宿主）')

// ─────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────
// 断言用的「去注释源码」—— 修复说明里会引用旧代码原文，直接在全文上匹配会假阳性。
// 只去掉行注释与块注释，保留代码本身。
// ⚠️ CRLF 陷阱（本次实测踩到）：本仓文件是 CRLF，若按 '\n' 切行，行尾残留 '\r'，
// 而 `/\/\/.*$/` 无 m 标志时 `$` 只匹配字符串末尾、`.` 不吃 '\r' ⇒ **行注释根本剥不掉**，
// 于是「旧代码写在注释里」会污染负向断言（实测 P2-3 假红）。按 /\r?\n/ 切行即可修掉。
const stripComments = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split(/\r?\n/).map((l) => l.replace(/\/\/.*$/, '')).join('\n')
const PROC_CODE = stripComments(PROC)

console.log('== P2-5 promote() 必须区分 ok 与 promoted ==')
ok(/promoted:\s*true,\s*decision:\s*'promote'/.test(PROC_CODE), '成功分支带 promoted:true')
ok(/promoted:\s*false,\s*decision:\s*'keep'/.test(PROC_CODE), '拒绝分支带 promoted:false（不再全是 ok:true 假阳性）')
ok(/ok 与 promoted 的语义差异/.test(PROC), '文件头说明二者语义差异')

// ─────────────────────────────────────────────────────────────
console.log('== P2-7 checklist 截断必须可见 ==')
ok(/renderChecklistTextPre/.test(PROC_CODE), '存在 renderChecklistTextPre 封装')
ok(!/lines\.join\('\\n'\)\.slice\(0, 2000\)/.test(PROC_CODE), '不再裸 slice(0,2000) 静默砍尾')
ok(/截断/.test(PROC) && /未展开/.test(PROC), '截断时追加显式标记行')

// ─────────────────────────────────────────────────────────────
console.log('== P2-3 candidate 死状态已移除 ==')
ok(!/'candidate'/.test(PROC_CODE.match(/PROCEDURE_STAGES_PRE_V1 = Object\.freeze\(\[[^\]]*\]\)/)?.[0] || 'x'),
  'PROCEDURE_STAGES_PRE_V1 不再含 candidate')
// ⚠️ 断言形状修正（2026-09-21）：真实形态是 stats 对象字面量里的**键** `candidates: 0`，
// 不是 `stats.candidates`。原来的 `stats\.candidates` 只能命中 proc-fixer 写的注释文案，
// 对真实的死字段毫无约束（HEAD 已验证：`const stats = { observed: 0, candidates: 0, ... }`）。
// 现按**标识符**断言：任何地方重新引入 candidates（键/读取/赋值）都会红。
ok(!/\bcandidates\b/.test(PROC_CODE), 'stats 的候选态死字段 candidates 已彻底移除（标识符级，注释不计）')
ok(/stage === 'candidate'/.test(PROC_CODE), 'restore 对旧快照的 candidate 做迁移（不静默丢条目）')

// ─────────────────────────────────────────────────────────────
console.log('== A-6b 作用域完整性（模块级函数不得引用工厂内私有名） ==')
// 背景：proc-fixer 报告 emptyEvidencePre 定义在 createProcedureStorePre 内、
// 却可能被 module-level 的 validateProcedurePre 引用 ⇒ 运行时 ReferenceError。
// 断言方式：模块级区段（第一个 export function 之前 + validate* 两函数体）不得出现这两个名字的**调用**。
const factoryStart = PROC_CODE.indexOf('export function createProcedureStorePre')
const moduleLevel = PROC_CODE.slice(0, factoryStart)
ok(!/\bemptyEvidencePre\s*\(/.test(moduleLevel), '模块级代码不调用工厂内的 emptyEvidencePre')
ok(!/\bnormalizeEvidencePre\s*\(/.test(moduleLevel), '模块级代码不调用工厂内的 normalizeEvidencePre')

// ─────────────────────────────────────────────────────────────
console.log(`\n结果: PASS ${pass} / FAIL ${fail}`)
process.exit(fail === 0 ? 0 : 1)
