#!/usr/bin/env node
/**
 * smoke-test-batch6-20260919-pre.mjs —— 第六批（#76 诊断/卫生 P3 两项）
 *
 * **#76-5 hub 死委托分支**：`memory-hub.js:81-84` 用
 *   `typeof stores.facts.factCandidateFromJudgementRow === 'function'` 决定是否委托，
 *   但该函数此前**只是模块级导出**、不在 `createFactStorePre()` 返回对象上
 *   ⇒ **委托分支恒假** ⇒ hub 恒走本地副本 `factCandidateFromRow`（**丢 ttl 字段**）
 *   ⇒ 两适配器各自演化。
 *
 * **#76-6c clear() 漏重置统计**：`fact-store.js` 的 `stats` 有 8 个字段
 *   （upserts/created/merged/superseded/conflictAdded/inferenceBlocked/expiredIgnored/revoked），
 *   而 `clear()` 只归零 3 个 ⇒ 其余 5 个残留，诊断读数失真。
 */
import { createFactStorePre, factCandidateFromJudgementRow } from '../../lib/fact-store.js'
import { readFileSync } from 'node:fs'

let pass = 0, fail = 0
const ok = (c, n, x) => {
  if (c) { pass++; console.log('  ok -', n) }
  else { fail++; console.error('  FAIL -', n, x == null ? '' : x) }
}
const src = (p) => readFileSync(new URL('../../lib/' + p, import.meta.url), 'utf8')
const codeOnly = (t) => String(t).split(/\r?\n/)
  .filter((l) => { const s = l.trim(); return !(s.startsWith('//') || s.startsWith('*') || s.startsWith('/*')) }).join('\n')

console.log('\n[1] #76-5 store 实例必须暴露 judgement-row 消费器（否则 hub 委托恒假）')
{
  const store = createFactStorePre({})
  ok(typeof store.factCandidateFromJudgementRow === 'function',
    '★★ store 实例上有 factCandidateFromJudgementRow')
  ok(store.factCandidateFromJudgementRow === factCandidateFromJudgementRow,
    '★ 与模块级导出同一函数（语义统一到 store 实现）')

  // hub 的委托判据现在为真
  const hubSrc = codeOnly(src('memory-hub.js'))
  ok(/typeof stores\.facts\.factCandidateFromJudgementRow === 'function'/.test(hubSrc),
    '★ hub 侧委托判据仍在（修的是被委托方，不是把判据删掉）')

  // ttl 保真（issue 实测：store 版 ttl=60000、hub 本地副本无 ttl）
  const row = { kindCandidate: 'semantic_candidate', sourceIds: ['src-1'], subject: 's', predicate: 'p', object: 'o', ttl: 60000 }
  const cand = store.factCandidateFromJudgementRow(row)
  ok(cand && cand.ttl === 60000, '★★ ttl 字段被保留（委托后不再丢失）', String(cand && cand.ttl))
  ok(cand && cand.sourceKind === 'inference', '★ sourceKind=inference 不变')
}

console.log('\n[2] #76-6c clear() 必须把**全部**统计字段归零')
{
  const store = createFactStorePre({})
  await store.upsert({
    scope: 'Workspace', subject: 'a', predicate: 'p', object: '1',
    sourceKind: 'explicit', sourceClass: 'user-memory', provenance: ['x'],
  })
  const before = store.getStats()
  ok(Object.values(before).some((v) => v > 0), 'clear 前存在非零计数', JSON.stringify(before))
  store.clear()
  const after = store.getStats()
  ok(Object.values(after).every((v) => v === 0), '★★ clear() 后全部统计字段归零',
    JSON.stringify(Object.entries(after).filter(([, v]) => v !== 0)))

  // 反向锁：不得退回「只写死三个字段」的写法
  const code = codeOnly(src('fact-store.js'))
  ok(!/stats\.created = 0; stats\.merged = 0; stats\.superseded = 0/.test(code),
    '★★ 不再硬写三个字段（改按现有键遍历归零）')
  ok(/for \(const k of Object\.keys\(stats\)\) stats\[k\] = 0/.test(code),
    '★★ 按现有键遍历归零（将来新增字段也不会漏）')
}

console.log('\n[3] 退化安全：clear() 仍返回结构化成功 + 仍清空数据')
{
  const store = createFactStorePre({})
  await store.upsert({
    scope: 'Workspace', subject: 'b', predicate: 'p', object: '2',
    sourceKind: 'explicit', sourceClass: 'user-memory', provenance: ['y'],
  })
  ok(store.size > 0, 'clear 前 size > 0', String(store.size))
  const r = store.clear()
  ok(r && r.ok === true, 'clear() 仍返回 { ok: true }', JSON.stringify(r))
  ok(store.size === 0, '★ clear 后数据被清空（size=0）', String(store.size))
}

console.log(`\n[batch6-20260919] ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
