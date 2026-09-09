#!/usr/bin/env node
/** smoke-test-m81-fact-metadata —— M8-1 Fact 层元数据补强回归锁定(2026-09-09)。
 * 三组新字段(时间三价/认识论状态/趋势),全部可选、向后兼容:
 *   ① 旧数据可读:无新字段的既有记录 restore 正常(不报错不丢弃);真实 facts.json 实测(存在时)
 *   ② 校验函数接受新字段(可选),不因新字段拒绝旧结构
 *   ③ 创建透传 + 合并回填(旧记录首次合并补 ingestedAt=原 confirmedAt)
 * 纯内存驱动(io 注入),不落盘不改真实数据。
 */
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createFactStorePre, validateFactCandidatePre, validateFactPre,
  FACT_EPISTEMIC_STATUSES_PRE_V1, FACT_TRENDS_PRE_V1,
} from '../../lib/fact-store-pre.js'

let pass = 0, fail = 0
const t = (name, fn) => { try { fn(); pass++; console.log('  ok -', name) } catch (e) { fail++; console.error('FAIL', name + ':', e.message) } }
const ta = async (name, fn) => { try { await fn(); pass++; console.log('  ok -', name) } catch (e) { fail++; console.error('FAIL', name + ':', e.message) } }
const HERE = path.dirname(fileURLToPath(import.meta.url))

const memIo = () => { let saved = null; return { save(d) { saved = d }, load() { return saved }, get saved() { return saved } } }
const cand = (over = {}) => ({
  scope: 'Workspace', subject: '测试主体', predicate: '使用框架', object: 'React',
  sourceKind: 'explicit', provenance: ['mem_' + 'a'.repeat(32)], ...over,
})
const T0 = 1750000000000

// ---------- 枚举冻结 ----------
t('枚举冻结且值正确', () => {
  assert.deepEqual([...FACT_EPISTEMIC_STATUSES_PRE_V1], ['fact', 'observation', 'directive'])
  assert.deepEqual([...FACT_TRENDS_PRE_V1], ['new', 'strengthening', 'stable', 'weakening', 'stale'])
  assert.ok(Object.isFrozen(FACT_EPISTEMIC_STATUSES_PRE_V1) && Object.isFrozen(FACT_TRENDS_PRE_V1))
})

// ---------- 验收3:校验函数接受新字段(可选) 且 不拒绝旧结构 ----------
t('candidate 校验:旧结构(无新字段)照常通过', () => {
  const v = validateFactCandidatePre(cand())
  assert.ok(v.ok, v.reason)
})
t('candidate 校验:合法新字段通过', () => {
  const v = validateFactCandidatePre(cand({ occurredAt: T0, mentionedAt: T0 + 5, ingestedAt: T0 + 9, epistemicStatus: 'observation', trend: 'new' }))
  assert.ok(v.ok, v.reason)
})
t('candidate 校验:非法新字段拒绝(reason 指明字段)', () => {
  assert.match(validateFactCandidatePre(cand({ occurredAt: '不是数字' })).reason, /occurredAt/)
  assert.match(validateFactCandidatePre(cand({ mentionedAt: NaN })).reason, /mentionedAt/)
  assert.match(validateFactCandidatePre(cand({ ingestedAt: -1 })).reason, /ingestedAt/)
  assert.match(validateFactCandidatePre(cand({ epistemicStatus: 'bogus' })).reason, /epistemicStatus/)
  assert.match(validateFactCandidatePre(cand({ trend: 'bogus' })).reason, /trend/)
})
t('fact 校验:旧结构(无新字段)照常通过;非法新字段拒绝', () => {
  const base = {
    factId: 'fact_pre_' + 'a'.repeat(32), scope: 'User', subject: 's', predicate: 'p',
    provenance: ['src'], confirmedAt: T0,
  }
  assert.ok(validateFactPre(base).ok)
  assert.match(validateFactPre({ ...base, ingestedAt: 'oops' }).reason, /ingestedAt/)
  assert.match(validateFactPre({ ...base, epistemicStatus: 'bogus' }).reason, /epistemicStatus/)
  assert.match(validateFactPre({ ...base, trend: 'bogus' }).reason, /trend/)
})

// ---------- 验收2:创建透传 + 时间三价 ----------
t('upsert 创建:ingestedAt 必填且=confirmedAt;提供 occurredAt/mentionedAt 则透传', () => {
  const s = createFactStorePre({ io: memIo(), now: () => T0 })
  const r = s.upsert(cand({ occurredAt: T0 - 86400000, mentionedAt: T0 - 1000, epistemicStatus: 'directive', trend: 'new' }))
  assert.equal(r.outcome, 'created')
  const f = r.fact
  assert.equal(f.ingestedAt, T0)
  assert.equal(f.confirmedAt, T0)
  assert.equal(f.occurredAt, T0 - 86400000)
  assert.equal(f.mentionedAt, T0 - 1000)
  assert.equal(f.epistemicStatus, 'directive')
  assert.equal(f.trend, 'new')
})
t('upsert 创建:不提供新字段 → 既有结构不变(occurredAt/mentionedAt 缺省),仅多 ingestedAt', () => {
  const s = createFactStorePre({ io: memIo(), now: () => T0 })
  const r = s.upsert(cand())
  assert.equal(r.fact.ingestedAt, T0)
  assert.equal(r.fact.occurredAt, undefined)
  assert.equal(r.fact.mentionedAt, undefined)
  assert.equal(r.fact.epistemicStatus, undefined)
  assert.equal(r.fact.trend, undefined)
  // 快照 JSON 不含 undefined 字段(与旧形状兼容)
  const snap = s.snapshot({ includeRevoked: true })
  const raw = JSON.stringify(snap)
  assert.ok(raw.includes('ingestedAt') && !raw.includes('occurredAt') && !raw.includes('epistemicStatus'))
})

// ---------- 验收1:旧数据可读 + 合并回填 ----------
t('restore:无新字段的旧记录全部读回,不报错不丢弃', () => {
  const s = createFactStorePre({ io: memIo() })
  const old = {
    schemaVersion: 1, namespace: 'dsh-auto-memory-pre', policyVersion: 'fact_store_pre_v1', savedAt: T0,
    facts: [
      { factId: 'fact_pre_' + 'b'.repeat(32), scope: 'User', subject: '旧主体', predicate: '旧谓词', object: null, sourceKind: 'explicit', sourceClass: 'user-memory', provenance: ['x'], confidence: null, confirmedAt: T0, ttl: 0, revoked: false },
      { factId: 'fact_pre_' + 'c'.repeat(32), scope: 'Workspace', subject: '旧主体2', predicate: '旧谓词2', object: '值', sourceKind: 'inference', provenance: [], confidence: 0.5, confirmedAt: T0 - 9, ttl: 0, revoked: false },
    ],
    conflicts: [],
  }
  const r = s.restore(old)
  assert.equal(r.ok, true)
  assert.equal(r.restored, 2, '两条旧记录全量读回')
})
t('restore:带非法新字段的记录按既有 fail-closed 语义跳过(幂等恢复不变)', () => {
  const s = createFactStorePre({ io: memIo() })
  const bad = {
    schemaVersion: 1,
    facts: [{ factId: 'fact_pre_' + 'd'.repeat(32), scope: 'User', subject: 's', predicate: 'p', provenance: [], confirmedAt: T0, epistemicStatus: 'bogus' }],
  }
  const r = s.restore(bad)
  assert.equal(r.ok, true)
  assert.equal(r.restored, 0, '损坏记录跳过(既有语义),不整体失败')
})
t('merge:旧记录(无 ingestedAt)首次合并回填 ingestedAt=原 confirmedAt;confirmedAt 正常更新', () => {
  const oldConfirmed = T0 - 100000
  const s = createFactStorePre({ io: memIo(), now: () => T0 })
  s.restore({
    schemaVersion: 1,
    facts: [{ factId: 'fact_pre_' + 'e'.repeat(32), scope: 'Workspace', subject: '测试主体', predicate: '使用框架', object: 'React', sourceKind: 'inference', provenance: ['old'], confidence: 0.4, confirmedAt: oldConfirmed, ttl: 0 }],
  })
  const r = s.upsert(cand({ mentionedAt: T0 - 5 })) // 同 subject+predicate+object → merge
  assert.equal(r.outcome, 'merged')
  assert.equal(r.fact.confirmedAt, T0, '合并重新确认(既有语义不变)')
  assert.equal(r.fact.ingestedAt, oldConfirmed, '回填=原 confirmedAt(首次入库时间保留)')
  assert.equal(r.fact.mentionedAt, T0 - 5, '合并透传可选陈述时间')
})
t('merge:新记录(已有 ingestedAt)合并时保留首次入库时间', () => {
  // 可设定时钟(upsert 内部会多次取 now,固定值避免计数漂移)
  let n = T0
  const s = createFactStorePre({ io: memIo(), now: () => n })
  s.upsert(cand()) // ingestedAt=T0
  n = T0 + 1000
  const r = s.upsert(cand()) // merge at T0+1000
  assert.equal(r.outcome, 'merged')
  assert.equal(r.fact.confirmedAt, T0 + 1000)
  assert.equal(r.fact.ingestedAt, T0, '入库时间不随合并漂移(三价语义核心)')
})

// ---------- 既有语义零改动(冲突/取代/撤销回归) ----------
t('既有语义回归:冲突判定/ supersede / inference-blocked 结果与旧版一致', () => {
  const s = createFactStorePre({ io: memIo(), now: () => T0 })
  s.upsert(cand())
  const c = s.upsert(cand({ object: 'Vue' })) // 同主体谓词不同 object → 冲突
  assert.equal(c.outcome, 'conflict-added')
  const sup = s.supersede(cand({ object: 'Vue' }))
  assert.equal(sup.outcome, 'created', 'supersede 后新建(既有语义)')
  const blk = s.upsert(cand({ object: 'Svelte', sourceKind: 'inference', subject: '另一主体' }))
  assert.equal(blk.outcome, 'created', '新主体不受影响')
})

// ---------- 向后兼容:真实 facts.json 实测(存在时;不存在则跳过) ----------
await ta('真实 facts.json 兼容实测(只读)', async () => {
  const f = path.join(process.env.USERPROFILE || process.env.HOME, '.dsh', 'memory', 'hub-pre', 'facts.json')
  if (!existsSync(f)) { console.log('    (本机无 facts.json,跳过实测)'); return }
  const data = JSON.parse(readFileSync(f, 'utf8'))
  assert.ok(Array.isArray(data.facts) && data.facts.length >= 1, '真实数据存在')
  const s = createFactStorePre({ io: memIo() })
  const r = s.restore(data)
  assert.equal(r.ok, true)
  assert.equal(r.restored, data.facts.length, '真实旧记录全量读回零丢弃')
  assert.ok(data.facts.every((x) => x.ingestedAt === undefined), '实测对象确为旧结构(无新字段)')
})

console.log(`\n[m81-fact-metadata] ${pass}/${pass + fail} assertions passed`)
if (fail) process.exit(1)
