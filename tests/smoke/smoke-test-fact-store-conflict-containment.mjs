import assert from 'node:assert/strict'
import {
  createFactStorePre,
  detectNonTriplePre,
  NON_TRIPLE_SUBJECT_PRE_V1,
} from '../../lib/fact-store.js'

/**
 * 批次 1.1 / 1.3a / 1.3b 回归：facts.json 冲突库止血。
 *
 * 背景（2026-11-08 实测）：facts.json 里 66,533 条 conflicts 只来自 20 个
 * (scope,subject,predicate) 三元组，100% 是 non-triple-subject（最大污染源
 * subject 是 `<!-- dsh-status: current -->`，predicate 恒为「记录要点」）。
 * 这些不是事实三元组，是日志正文被解析成了 subject/predicate。
 *
 * 本套件覆盖三件事：
 *   1.3b 形态守卫：非三元组不判冲突；正常三元组仍判（负路径，防"一律拒绝"假绿）
 *   1.3a 去重键：同 5 元组不重复追加
 *   1.1  容量上限：超上限按 resolved 优先 / detectedAt 最旧淘汰
 *
 * 每条断言都是**真执行**（真 import → 真构造 → 真 upsert → 断言返回值/副作用），
 * 不是源码字符串匹配。
 */

const mk = (cfg) => createFactStorePre({
  config: cfg || {},
  io: { save() {}, load() { return null }, clear() {} },
})
const NP = (subject, predicate) => detectNonTriplePre({ subject, predicate })

let pass = 0
let fail = 0
function t(name, fn) {
  try { fn(); pass++; console.log('  ok   - ' + name) }
  catch (e) { fail++; console.log('  FAIL - ' + name + ': ' + (e && e.message)) }
}

// ---------- 1.3b 形态守卫（纯函数层） ----------
console.log('[1.3b] 形态守卫 detectNonTriplePre')
t('HTML 注释 subject ⇒ 挡下（实测最大污染源）', () => {
  assert.equal(NP('<!-- dsh-status: current -->', '记录要点').notTriple, true)
  assert.equal(NP('<!-- dsh-status: current -->', '记录要点').reason, 'non-triple-subject')
})
t('纯日期 subject ⇒ 挡下', () => {
  assert.equal(NP('2026-09-22', '记录要点').notTriple, true)
  assert.equal(NP('2026-09-22', '记录要点').notTriple, true)
})
t('列表符 + 行内时间戳开头 ⇒ 挡下', () => {
  assert.equal(NP('- 14:39 [kind:fact] procedural', '记录要点').notTriple, true)
  assert.equal(NP('14:39', '记录要点').notTriple, true)
})
t('markdown 结构残留 ⇒ 挡下（标题/表格/引用）', () => {
  assert.equal(NP('## 标题', 'x').notTriple, true)
  assert.equal(NP('| a | b |', 'x').notTriple, true)
  assert.equal(NP('> 引用', 'x').notTriple, true)
})
t('空 subject / 空 predicate ⇒ 挡下', () => {
  assert.equal(NP('', 'x').reason, 'empty-subject')
  assert.equal(NP('   ', 'x').reason, 'empty-subject')
  assert.equal(NP('项目', '').reason, 'empty-predicate')
})
t('★ 负路径：正常三元组不得被误挡（防"一律拒绝"恒绿）', () => {
  assert.equal(NP('dsh-auto-memory', '构建工具').notTriple, false)
  assert.equal(NP('项目', '端口').notTriple, false)
  assert.equal(NP('v3.4.0', '版本').notTriple, false)
  assert.equal(NP('issue #557', '状态').notTriple, false)
})
t('非对象/缺失字段 ⇒ 不抛错且不判 non-triple', () => {
  assert.equal(detectNonTriplePre(null).notTriple, false)
  assert.equal(detectNonTriplePre(undefined).notTriple, false)
  assert.equal(detectNonTriplePre({}).notTriple, true) // 空 subject
})

// ---------- 1.3b 端到端 ----------
console.log('[1.3b] 端到端：非三元组不再产生冲突')
t('★ HTML 注释 subject 连写 20 次 ⇒ 冲突恒为 0（旧实现 +19）', () => {
  const s = mk()
  for (let i = 0; i < 20; i++) {
    s.upsert({ scope: 'Workspace', subject: '<!-- dsh-status: current -->', predicate: '记录要点', object: 'v' + i, sourceKind: 'explicit' })
  }
  assert.equal(s.conflictCount, 0)
  assert.ok(s.getStats().conflictNonTriple >= 1, 'conflictNonTriple 必须被计数，不得静默')
  assert.equal(s.getLastNonTriple().reason, 'non-triple-subject')
})
t('★ 负路径：正常三元组 object 不同 ⇒ 仍产生冲突（守卫不越权）', () => {
  const s = mk()
  s.upsert({ scope: 'Workspace', subject: 'dsh-auto-memory', predicate: '构建工具', object: 'esbuild', sourceKind: 'explicit' })
  const r = s.upsert({ scope: 'Workspace', subject: 'dsh-auto-memory', predicate: '构建工具', object: 'rollup', sourceKind: 'explicit' })
  assert.equal(s.conflictCount, 1)
  assert.equal(r.outcome, 'conflict-added')
})

// ---------- 1.3a 去重键 ----------
console.log('[1.3a] 去重键：同 5 元组不重复追加')
t('★ 同 5 元组写 20 次 ⇒ 冲突只 1 条（旧实现 10 条）', () => {
  const s = mk()
  for (let i = 0; i < 20; i++) {
    s.upsert({ scope: 'Workspace', subject: 'dsh-auto-memory', predicate: '构建工具', object: i % 2 ? 'rollup' : 'esbuild', sourceKind: 'explicit' })
  }
  assert.equal(s.conflictCount, 1)
  assert.equal(s.getStats().conflictAdded, 1)
  assert.ok(s.getStats().conflictDeduped >= 1, 'conflictDeduped 必须被计数')
})
t('不同 5 元组仍各自建冲突（去重不误伤）', () => {
  const s = mk()
  s.upsert({ scope: 'Workspace', subject: 'a', predicate: 'p', object: '1', sourceKind: 'explicit' })
  s.upsert({ scope: 'Workspace', subject: 'a', predicate: 'p', object: '2', sourceKind: 'explicit' })
  s.upsert({ scope: 'Workspace', subject: 'b', predicate: 'p', object: '1', sourceKind: 'explicit' })
  s.upsert({ scope: 'Workspace', subject: 'b', predicate: 'p', object: '2', sourceKind: 'explicit' })
  assert.equal(s.conflictCount, 2)
})

// ---------- 1.1 容量上限 ----------
console.log('[1.1] 冲突集容量上限')
t('★ 上限 10 ⇒ 写入 60 组后 conflictCount <= 10', () => {
  const s = mk({ maxConflicts: 10 })
  for (let i = 0; i < 60; i++) {
    s.upsert({ scope: 'Workspace', subject: 'k' + i, predicate: 'has', object: 'a', sourceKind: 'explicit' })
    s.upsert({ scope: 'Workspace', subject: 'k' + i, predicate: 'has', object: 'b', sourceKind: 'explicit' })
  }
  assert.ok(s.conflictCount <= 10, 'got=' + s.conflictCount)
})
t('非法/缺省值回落默认 2000（口径与 facts 的 retentionLimit 一致）', () => {
  assert.equal(mk({}).conflictRetentionLimit(), 2000)
  assert.equal(mk({ maxConflicts: 0 }).conflictRetentionLimit(), 2000)
  assert.equal(mk({ maxConflicts: -1 }).conflictRetentionLimit(), 2000)
  assert.equal(mk({ maxConflicts: 'abc' }).conflictRetentionLimit(), 2000)
  assert.equal(mk({ maxConflicts: 5 }).conflictRetentionLimit(), 5)
})
t('默认上限下 15 组冲突不被裁剪（未超限就不动手）', () => {
  const s = mk()
  for (let i = 0; i < 15; i++) {
    s.upsert({ scope: 'Workspace', subject: 'z' + i, predicate: 'has', object: 'a', sourceKind: 'explicit' })
    s.upsert({ scope: 'Workspace', subject: 'z' + i, predicate: 'has', object: 'b', sourceKind: 'explicit' })
  }
  assert.equal(s.conflictCount, 15)
})
t('淘汰详情可读（不静默）', () => {
  const s = mk({ maxConflicts: 5 })
  for (let i = 0; i < 20; i++) {
    s.upsert({ scope: 'Workspace', subject: 'q' + i, predicate: 'has', object: 'a', sourceKind: 'explicit' })
    s.upsert({ scope: 'Workspace', subject: 'q' + i, predicate: 'has', object: 'b', sourceKind: 'explicit' })
  }
  const lp = s.getLastConflictPrune()
  assert.ok(lp, 'getLastConflictPrune 不得为 null')
  assert.ok(lp.pruned > 0 && lp.limit === 5, JSON.stringify(lp))
})

console.log('')
console.log('[fact-store-conflict-containment] pass=' + pass + ' fail=' + fail)
if (fail) process.exitCode = 1
