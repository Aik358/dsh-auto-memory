#!/usr/bin/env node
/** smoke-test-m81-fact-metadata —— M8-1 Fact 层元数据补强回归锁定(2026-09-09)。
 * 三组新字段(时间三价/认识论状态/趋势),全部可选、向后兼容:
 *   ① 旧数据可读:无新字段的既有记录 restore 正常(不报错不丢弃);用**自造夹具**实测(见下)
 *   ② 校验函数接受新字段(可选),不因新字段拒绝旧结构
 *   ③ 创建透传 + 合并回填(旧记录首次合并补 ingestedAt=原 confirmedAt)
 * 纯内存驱动(io 注入),不落盘不改真实数据。
 *
 * ★上游 issue #112(隔离):本套件**钉一次性 DSH_HOME**,绝不读真实 `~/.dsh`。
 *   旧写法手拼 `process.env.USERPROFILE || process.env.HOME` + 真实 `~/.dsh/memory/hub-pre/facts.json`,
 *   并把「真实库 ≥1 条」写成硬断言 ⇒ 结果依赖「本机恰好有库」,别机/空库必红。
 *   现在:家目录口径唯一(`DSH_HOME`,与 `lib/dsh-home-pre.js` 同源)、夹具由本套件自造、
 *   前提不成立(空库/缺夹具)改为**显式跳过 + 说明**——空库是完全合法的状态。
 */
import assert from 'node:assert/strict'
import { readFileSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createFactStorePre, validateFactCandidatePre, validateFactPre,
  FACT_EPISTEMIC_STATUSES_PRE_V1, FACT_TRENDS_PRE_V1,
} from '../../lib/fact-store-pre.js'
import { resolveDshHomePre } from '../../lib/dsh-home-pre.js'

let pass = 0, fail = 0, skip = 0
const t = (name, fn) => { try { fn(); pass++; console.log('  ok -', name) } catch (e) { fail++; console.error('FAIL', name + ':', e.message) } }
const ta = async (name, fn) => { try { await fn(); pass++; console.log('  ok -', name) } catch (e) { fail++; console.error('FAIL', name + ':', e.message) } }
/** 前提不成立 ⇒ 显式跳过并说明(issue #112:空库/缺夹具不是契约回归,不判红也不静默)。 */
const skipped = (name, detail) => { skip++; console.log('  SKIP -', name); if (detail) console.log('        ' + detail) }
const HERE = path.dirname(fileURLToPath(import.meta.url))

// ---------- 隔离前置(上游 issue #112)----------
const HERMETIC_DSH_HOME = mkdtempSync(path.join(tmpdir(), 'm81-fact-home-'))
process.env.DSH_HOME = HERMETIC_DSH_HOME
/** 夹具路径**只用唯一口径** `resolveDshHomePre()` 拼(它读的正是 DSH_HOME),不手拼家目录。 */
const FIXTURE_FACTS = path.join(resolveDshHomePre(), 'memory', 'hub-pre', 'facts.json')
console.log('[m81-fact-metadata] 隔离: DSH_HOME →', path.basename(HERMETIC_DSH_HOME), '(一次性临时目录)')

const memIo = () => { let saved = null; return { save(d) { saved = d }, load() { return saved }, get saved() { return saved } } }
const cand = (over = {}) => ({
  scope: 'Workspace', subject: '测试主体', predicate: '使用框架', object: 'React',
  sourceKind: 'explicit', provenance: ['mem_' + 'a'.repeat(32)], ...over,
})
const T0 = 1750000000000

// ---------- 夹具(自造,替代原「真实 facts.json」;上游 issue #112)----------
// 混装:2 条旧结构(无 ingestedAt) + 1 条新结构(有 ingestedAt) ——「混装」正是本套件最该覆盖的场景。
// 两条旧结构分别取 explicit 与 inference 来源,用于验证 B-4 的 restore 回填规则(fact / observation)。
const FIXTURE_OLD_EXPLICIT = { factId: 'fact_pre_' + '1'.repeat(32), scope: 'User', subject: '夹具旧主体A', predicate: '旧谓词A', object: null, sourceKind: 'explicit', sourceClass: 'user-memory', provenance: ['fixture'], confidence: null, confirmedAt: T0, ttl: 0, revoked: false }
const FIXTURE_OLD_INFERENCE = { factId: 'fact_pre_' + '2'.repeat(32), scope: 'Workspace', subject: '夹具旧主体B', predicate: '旧谓词B', object: '值', sourceKind: 'inference', provenance: [], confidence: 0.5, confirmedAt: T0 - 9, ttl: 0, revoked: false }
const FIXTURE_NEW = { factId: 'fact_pre_' + '3'.repeat(32), scope: 'User', subject: '夹具新主体C', predicate: '新谓词C', object: null, sourceKind: 'explicit', provenance: ['fixture'], confidence: null, confirmedAt: T0, ttl: 0, revoked: false, ingestedAt: T0 - 1 }
{
  mkdirSync(path.dirname(FIXTURE_FACTS), { recursive: true })
  writeFileSync(FIXTURE_FACTS, JSON.stringify({
    schemaVersion: 1, namespace: 'dsh-auto-memory-pre', policyVersion: 'fact_store_pre_v1', savedAt: T0,
    facts: [FIXTURE_OLD_EXPLICIT, FIXTURE_OLD_INFERENCE, FIXTURE_NEW], conflicts: [],
  }), 'utf8')
}

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
t('upsert 创建:不提供新字段 → occurredAt/mentionedAt/trend 缺省,新增 ingestedAt 与 epistemicStatus(B-4)', () => {
  const s = createFactStorePre({ io: memIo(), now: () => T0 })
  const r = s.upsert(cand())
  assert.equal(r.fact.ingestedAt, T0)
  assert.equal(r.fact.occurredAt, undefined)
  assert.equal(r.fact.mentionedAt, undefined)
  assert.equal(r.fact.trend, undefined)
  // ★B-4(2026-09-22)契约变更:epistemicStatus 现在**必带默认值**(explicit/user-memory → 'fact')。
  //   trend 仍是「缺省不写」,保持原样断言 —— 只翻被改的那一半。
  assert.equal(r.fact.epistemicStatus, 'fact', '★B-4:缺省即补默认(explicit → fact)')
  // 快照 JSON 不含 undefined 字段(与旧形状兼容);epistemicStatus 已必填故必须出现
  const snap = s.snapshot({ includeRevoked: true })
  const raw = JSON.stringify(snap)
  assert.ok(raw.includes('ingestedAt') && raw.includes('epistemicStatus') && !raw.includes('occurredAt') && !raw.includes('trend'),
    '★B-4:epistemicStatus 已必填;occurredAt/trend 仍缺省不写')
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

// ---------- 向后兼容:夹具 facts.json 实测(一次性 DSH_HOME;前提不成立则显式跳过) ----------
await ta('夹具 facts.json 兼容实测(hermetic DSH_HOME)', async () => {
  // ★issue #112:此前手拼 `process.env.USERPROFILE || process.env.HOME` + 真实 `~/.dsh`
  //   ⇒ 断言依赖「本机恰好有库」,别机/空库必红,「回归全绿」不可判定。
  //   现在:路径只走唯一口径 `resolveDshHomePre()`(读的正是本套件设置的 DSH_HOME),夹具由本套件自造。
  if (!existsSync(FIXTURE_FACTS)) {
    skipped('夹具 facts.json 未落盘(前提不成立,跳过实测)', FIXTURE_FACTS)
    return
  }
  const data = JSON.parse(readFileSync(FIXTURE_FACTS, 'utf8'))
  if (!Array.isArray(data.facts) || data.facts.length === 0) {
    // ★空库是**完全合法**的状态:不再把「库里有数据」写成硬断言
    //   (旧写法 `assert.ok(... && data.facts.length >= 1, '真实数据存在')` 会在空库误红)。
    skipped('夹具 facts 为空数组 —— 空库合法,跳过「全量读回」实测', '')
    return
  }
  const s = createFactStorePre({ io: memIo() })
  const r = s.restore(data)
  assert.equal(r.ok, true)
  assert.equal(r.restored, data.facts.length, '夹具旧记录全量读回零丢弃')
  // ★2026-09-17 修正（非本批引入的既有缺陷，实测暴露）：
  // 原断言 `data.facts.every(x => x.ingestedAt === undefined)`（「实测对象确为旧结构」）把
  // **测试前提**写成了**硬断言** —— 插件自身一旦按新结构写过一条记录，该文件就变成新旧混装，
  // 这条前提自然失效并永久假红（本机实测：4 条中 1 条已带 ingestedAt）。
  // 而「混装文件」恰恰是向后兼容最该覆盖的场景。改为钉真正要保的语义：
  //   ① 结构统计自洽（防数组被写坏）② 新结构记录的字段本身合法（防写坏成非数值）
  // 旧结构记录仍零丢弃已由上一行的 restored === length 覆盖。
  const oldOnes = data.facts.filter((x) => x.ingestedAt === undefined)
  const newOnes = data.facts.filter((x) => x.ingestedAt !== undefined)
  console.log(`    (实测文件结构: 旧结构 ${oldOnes.length} 条 / 新结构 ${newOnes.length} 条 — 混装本就要支持)`)
  assert.equal(oldOnes.length + newOnes.length, data.facts.length, '新旧结构统计自洽')
  assert.ok(newOnes.every((x) => typeof x.ingestedAt === 'number'), '新结构记录的 ingestedAt 为数值(未被写坏)')

  // ★B-4(2026-09-22)新契约:restore() 对旧快照按写入侧同一套规则回填 epistemicStatus。
  //   这里钉住它的**可观察结果**与**作用范围**(只回填这一个字段,不动 ingestedAt)。
  const snap = s.snapshot({ includeRevoked: true })
  const restoredFacts = Array.isArray(snap.facts) ? snap.facts : []
  assert.equal(restoredFacts.length, data.facts.length, '回填不增删记录(条数与夹具一致)')
  assert.ok(restoredFacts.every((x) => typeof x.epistemicStatus === 'string' && x.epistemicStatus.length > 0),
    '★B-4:restore 后每条都带 epistemicStatus(旧结构按规则回填,不留 undefined)')
  const byId = new Map(restoredFacts.map((x) => [x.factId, x]))
  assert.equal((byId.get(FIXTURE_OLD_EXPLICIT.factId) || {}).epistemicStatus, 'fact', '★B-4:explicit/user-memory → fact')
  assert.equal((byId.get(FIXTURE_OLD_INFERENCE.factId) || {}).epistemicStatus, 'observation', '★B-4:inference → observation')
  assert.equal((byId.get(FIXTURE_OLD_INFERENCE.factId) || {}).ingestedAt, undefined,
    '★B-4 作用范围:只回填 epistemicStatus,不凭空补 ingestedAt')
  assert.equal((byId.get(FIXTURE_NEW.factId) || {}).epistemicStatus, 'fact', '夹具新结构记录原值保留')
})

try { rmSync(HERMETIC_DSH_HOME, { recursive: true, force: true }) } catch (_) { /* 一次性临时目录,清理尽力而为 */ }

console.log(`\n[m81-fact-metadata] ${pass}/${pass + fail} assertions passed` + (skip ? `, ${skip} skipped(前提不成立,非失败)` : ''))
if (fail) process.exit(1)
