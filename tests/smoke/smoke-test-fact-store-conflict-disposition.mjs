import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  createFactStorePre,
  classifyConflictLikelihoodPre,
  CONFLICT_LIKELIHOOD_PRE_V1,
} from '../../lib/fact-store.js'

/**
 * 1.2 第2步（resolveConflict 审计留痕）+ 第3步（冲突可能性分层）验收。
 *
 * 用户裁定（2026-11-09）：「对 conflict 的判断可能要稍微严格一点，在 conflict 的可能性
 * 比较高的时候再提醒」；以及审计要求：B 方案让模型调 resolve 后必须能追责。
 *
 * 全部断言为真执行：真 import → 真调用 → 断言返回值与副作用。
 */

let pass = 0
let fail = 0
function t(name, fn) {
  try { fn(); pass++; console.log('  ok   - ' + name) }
  catch (e) { fail++; console.log('  FAIL - ' + name + ': ' + (e && e.message)) }
}
const mk = (cfg = {}, opts = {}) => createFactStorePre({
  config: cfg,
  io: opts.io || { save() {}, load() { return null }, clear() {} },
  conflictsIo: opts.conflictsIo || { save() {}, load() { return null }, clear() {} },
})
const L = classifyConflictLikelihoodPre

console.log('[3] 冲突可能性分层 classifyConflictLikelihoodPre')
t('★ high：两条互不包含的实质文本（端口 3080 vs 端口 8080）', () => {
  const r = L('端口 3080', '端口 8080')
  assert.equal(r.level, 'high')
  assert.equal(r.reason, 'distinct-claims')
})
t('★ high：两个不同的构建工具名', () => {
  assert.equal(L('esbuild', 'rollup').level, 'high')
})
t('★ low：版本号推进（3.3.6 → 3.4.0）⇒ 是更新不是矛盾', () => {
  const r = L('3.3.6', '3.4.0')
  assert.equal(r.level, 'low')
  assert.equal(r.reason, 'version-update')
})
t('★ low：日期推进', () => {
  assert.equal(L('2026-09-22', '2026-09-23').level, 'low')
  assert.equal(L('2026-09-22', '2026-09-23').reason, 'date-update')
})
t('★ low：纯数字差异（字数 100 vs 200）', () => {
  assert.equal(L('100', '200').level, 'low')
  assert.equal(L('100', '200').reason, 'numeric-update')
})
t('low：一方是另一方的子串 ⇒ 更像细化', () => {
  const r = L('esbuild', 'esbuild 用于构建')
  assert.equal(r.level, 'low')
  assert.equal(r.reason, 'substring-refinement')
})
t('low：过短的 object（<4）不足以判矛盾', () => {
  assert.equal(L('a', 'b').level, 'low')
  assert.equal(L('a', 'b').reason, 'short-object')
})
t('none：空值 / 相同值', () => {
  assert.equal(L('', 'x').reason, 'empty-object')
  assert.equal(L(null, 'x').reason, 'empty-object')
  assert.equal(L('x', 'x').reason, 'same-object')
})
t('★ 负路径：常量表三档齐全（枚举写错不会报错，须断言兜底）', () => {
  assert.equal(CONFLICT_LIKELIHOOD_PRE_V1.HIGH, 'high')
  assert.equal(CONFLICT_LIKELIHOOD_PRE_V1.LOW, 'low')
  assert.equal(CONFLICT_LIKELIHOOD_PRE_V1.NONE, 'none')
  assert.equal(Object.keys(CONFLICT_LIKELIHOOD_PRE_V1).length, 3)
})

console.log('[3] 端到端：只有 high 才允许提醒')
t('★ high 对 ⇒ 冲突 likelihood = high，可提醒计数 = 1', () => {
  const s = mk()
  s.upsert({ scope: 'Workspace', subject: '服务', predicate: '端口', object: '端口 3080', sourceKind: 'explicit' })
  s.upsert({ scope: 'Workspace', subject: '服务', predicate: '端口', object: '端口 8080', sourceKind: 'explicit' })
  assert.equal(s.conflictCount, 1)
  assert.equal(s.pendingConflicts()[0].likelihood, 'high')
  assert.equal(s.getHighLikelihoodCount(), 1)
})
t('★ low 对（版本号）⇒ 仍记录冲突，但**不允许提醒**', () => {
  const s = mk()
  s.upsert({ scope: 'Workspace', subject: 'dsh', predicate: '版本', object: '3.3.6', sourceKind: 'explicit' })
  s.upsert({ scope: 'Workspace', subject: 'dsh', predicate: '版本', object: '3.4.0', sourceKind: 'explicit' })
  assert.equal(s.conflictCount, 1, 'low 仍须记录：丢给 mergeInto 会静默丢掉更新（它不改 object）')
  assert.equal(s.pendingConflicts()[0].likelihood, 'low')
  assert.equal(s.getHighLikelihoodCount(), 0, 'low 不得计入可提醒')
  assert.ok(s.getStats().conflictLowLikelihood >= 1, 'low 必须被计数，不得静默')
  assert.equal(s.getLastLowLikelihood().reason, 'version-update')
})
t('★ none（同值）⇒ 不产生冲突', () => {
  const s = mk()
  s.upsert({ scope: 'Workspace', subject: 'x', predicate: 'y', object: 'same', sourceKind: 'explicit' })
  s.upsert({ scope: 'Workspace', subject: 'x', predicate: 'y', object: 'same', sourceKind: 'explicit' })
  assert.equal(s.conflictCount, 0)
})

console.log('[2] resolveConflict 审计留痕')
t('★ left：记录 resolvedBy / resolvedNote / revokedFactId=null', () => {
  const s = mk()
  s.upsert({ scope: 'Workspace', subject: '服务', predicate: '端口', object: '端口 3080', sourceKind: 'explicit' })
  s.upsert({ scope: 'Workspace', subject: '服务', predicate: '端口', object: '端口 8080', sourceKind: 'explicit' })
  const cid = s.pendingConflicts()[0].conflictId
  const r = s.resolveConflict(cid, 'left', { resolvedBy: 'user-panel', resolvedNote: '3080 是正式端口' })
  assert.equal(r.ok, true)
  assert.equal(r.conflict.resolvedBy, 'user-panel')
  assert.equal(r.conflict.resolvedNote, '3080 是正式端口')
  assert.equal(r.conflict.revokedFactId, null, 'left 不撤销任何事实')
  assert.equal(s.get('Workspace', '服务', '端口').object, '端口 3080')
})
t('★ right：记录被撤销的 factId（可追溯模型误调）', () => {
  const s = mk()
  s.upsert({ scope: 'Workspace', subject: '服务', predicate: '端口', object: '端口 3080', sourceKind: 'explicit' })
  const oldId = s.get('Workspace', '服务', '端口').factId
  s.upsert({ scope: 'Workspace', subject: '服务', predicate: '端口', object: '端口 8080', sourceKind: 'explicit' })
  const cid = s.pendingConflicts()[0].conflictId
  const r = s.resolveConflict(cid, 'right', { resolvedBy: 'model', resolvedNote: '模型判断 8080 更新' })
  assert.equal(r.ok, true)
  assert.equal(r.conflict.resolvedBy, 'model')
  assert.equal(r.conflict.revokedFactId, oldId, 'revokedFactId 必须精确指向被撤销的那条')
  assert.equal(s.get('Workspace', '服务', '端口').object, '端口 8080')
})
t('不传 opts ⇒ resolvedBy 回落 unknown（不静默无痕）', () => {
  const s = mk()
  s.upsert({ scope: 'Workspace', subject: '服务', predicate: '端口', object: '端口 3080', sourceKind: 'explicit' })
  s.upsert({ scope: 'Workspace', subject: '服务', predicate: '端口', object: '端口 8080', sourceKind: 'explicit' })
  const cid = s.pendingConflicts()[0].conflictId
  const r = s.resolveConflict(cid, 'left')
  assert.equal(r.conflict.resolvedBy, 'unknown')
})
t('★ 负路径：已 resolved 再 resolve ⇒ 拒绝', () => {
  const s = mk()
  s.upsert({ scope: 'Workspace', subject: '服务', predicate: '端口', object: '端口 3080', sourceKind: 'explicit' })
  s.upsert({ scope: 'Workspace', subject: '服务', predicate: '端口', object: '端口 8080', sourceKind: 'explicit' })
  const cid = s.pendingConflicts()[0].conflictId
  s.resolveConflict(cid, 'left', { resolvedBy: 'user-panel' })
  const r2 = s.resolveConflict(cid, 'right', { resolvedBy: 'user-panel' })
  assert.equal(r2.ok, false)
  assert.equal(r2.reason, 'already-resolved')
})
t('负路径：非法 choice ⇒ 拒绝', () => {
  const s = mk()
  s.upsert({ scope: 'Workspace', subject: '服务', predicate: '端口', object: '端口 3080', sourceKind: 'explicit' })
  s.upsert({ scope: 'Workspace', subject: '服务', predicate: '端口', object: '端口 8080', sourceKind: 'explicit' })
  const cid = s.pendingConflicts()[0].conflictId
  assert.equal(s.resolveConflict(cid, 'middle').reason, 'invalid-choice')
})

// ---------- 变异反向验证（隔离副本，不就地改生产文件） ----------
console.log('[MUT] 变异反向验证')
function makeMutant(mutate, tag) {
  const src = fs.readFileSync(new URL('../../lib/fact-store.js', import.meta.url), 'utf8')
  const dir = fs.mkdtempSync(path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\//, '')), '..', '..', 'artifacts', '_mut23-'))
  const mutated = mutate(src)
  if (mutated === src) throw new Error('变异未生效: ' + tag)
  const target = path.join(dir, 'fact-store.js')
  fs.writeFileSync(target, mutated, 'utf8')
  // 依赖模块一起复制（fact-store 只依赖自身与几个同目录模块）
  for (const f of fs.readdirSync(path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\//, '')), '..', '..', 'lib'))) {
    if (f.endsWith('.js') && f !== 'fact-store.js') {
      try { fs.copyFileSync(path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\//, '')), '..', '..', 'lib', f), path.join(dir, f)) } catch (_) {}
    }
  }
  return { dir, target }
}

async function runMutation() {
  // 变异 A：把分层器改成恒返回 high ⇒ 版本号那对会变成可提醒
  const a = makeMutant((s) => s.replace(
    "  if (vx && vy) return { level: CONFLICT_LIKELIHOOD_PRE_V1.LOW, reason: 'version-update' }",
    "  if (vx && vy) return { level: CONFLICT_LIKELIHOOD_PRE_V1.HIGH, reason: 'version-update' }"
  ), 'A')
  const mA = await import(pathToFileURL(a.target).href)
  const sa = mA.createFactStorePre({ config: {}, io: { save() {}, load() { return null }, clear() {} }, conflictsIo: { save() {}, load() { return null }, clear() {} } })
  sa.upsert({ scope: 'Workspace', subject: 'dsh', predicate: '版本', object: '3.3.6', sourceKind: 'explicit' })
  sa.upsert({ scope: 'Workspace', subject: 'dsh', predicate: '版本', object: '3.4.0', sourceKind: 'explicit' })
  const proto = mk()
  proto.upsert({ scope: 'Workspace', subject: 'dsh', predicate: '版本', object: '3.3.6', sourceKind: 'explicit' })
  proto.upsert({ scope: 'Workspace', subject: 'dsh', predicate: '版本', object: '3.4.0', sourceKind: 'explicit' })
  const caughtA = proto.getHighLikelihoodCount() === 0 && sa.getHighLikelihoodCount() === 1
  console.log('  [high 门] 原型可提醒=' + proto.getHighLikelihoodCount() + ' 变异可提醒=' + sa.getHighLikelihoodCount() + ' => ' + (caughtA ? 'CAUGHT' : 'MISSED'))

  // 变异 B：删掉 resolveConflict 的 resolvedBy 写入 ⇒ 审计字段消失
  const b = makeMutant((s) => s.replace('      c.resolvedBy = _rby; c.resolvedNote = _rnote; c.revokedFactId = _revokedId', ''), 'B')
  const mB = await import(pathToFileURL(b.target).href)
  const sb = mB.createFactStorePre({ config: {}, io: { save() {}, load() { return null }, clear() {} }, conflictsIo: { save() {}, load() { return null }, clear() {} } })
  sb.upsert({ scope: 'Workspace', subject: '服务', predicate: '端口', object: '端口 3080', sourceKind: 'explicit' })
  sb.upsert({ scope: 'Workspace', subject: '服务', predicate: '端口', object: '端口 8080', sourceKind: 'explicit' })
  const cidB = sb.pendingConflicts()[0].conflictId
  const rb = sb.resolveConflict(cidB, 'right', { resolvedBy: 'user-panel' })
  const caughtB = rb.conflict.resolvedBy === undefined
  console.log('  [审计字段] 变异后 resolvedBy=' + String(rb.conflict.resolvedBy) + ' => ' + (caughtB ? 'CAUGHT' : 'MISSED'))

  fs.rmSync(a.dir, { recursive: true, force: true })
  fs.rmSync(b.dir, { recursive: true, force: true })
  return { caughtA, caughtB }
}

const mut = await runMutation()
t('★ 变异 A：分层器失效（恒 high）⇒ 断言必红', () => assert.equal(mut.caughtA, true))
t('★ 变异 B：删掉审计字段写入 ⇒ 断言必红', () => assert.equal(mut.caughtB, true))

console.log('')
console.log('[fact-store-conflict-disposition] pass=' + pass + ' fail=' + fail)
if (fail) process.exitCode = 1
