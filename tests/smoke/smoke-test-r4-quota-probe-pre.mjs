#!/usr/bin/env node
/**
 * smoke-test-r4-quota-probe-pre —— R4 配额测量闭环（2026-09-18）
 *
 * ── 用户原话（本项的立项依据）──────────────────────────────────────
 * 「配额这个问题也困扰我很久。有的时候配额太少，效果完全没有，或者有些大条目
 *   可能就被过滤掉了，一点用都没有；有的时候配额多了，我又怕浪费 token」
 * 「确实得基于长期的观察，科学的（测量），不能拍脑子。」
 *
 * ── 本项回答的两个问题 ──────────────────────────────────────────
 *   · 某层**长期被丢** ⇒ 配额偏小（该层内容进不来）
 *   · 各层都不丢、token **远未用满** ⇒ 配额偏大（白花 token）
 *
 * ── 判据纪律（本套件锁定的核心）──────────────────────────────────
 *   ① 样本不足一律 `insufficient-data` —— **不猜**（"不能拍脑子"的机械保证）
 *   ② 判定必须**并列于**降级台账、**不得混入**（否则"有没有降级"永远非空）
 *   ③ 失败 fail-soft：观测/快照/判定抛错绝不影响主流程，且返回**结构合法**的对象
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createQuotaProbePre, deriveQuotaVerdictPre,
  QUOTA_PROBE_SCHEMA_V1, QUOTA_PROBE_CAP_V1, QUOTA_VERDICTS_V1, QUOTA_THRESHOLDS_V1,
  createDegradeSinkPre,
} from '../../lib/degrade.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SRC = readFileSync(path.resolve(HERE, '..', '..', 'lib', 'index.js'), 'utf8').replace(/\r\n/g, '\n')

let pass = 0, fail = 0
const ok = (c, n, extra) => { if (c) { pass++; console.log('  ok -', n) } else { fail++; console.error('FAIL', n, extra == null ? '' : extra) } }
const eq = (a, b, n) => ok(a === b, n + (a === b ? '' : `  (期望 ${JSON.stringify(b)}，实得 ${JSON.stringify(a)})`))

/** 造一轮 tier0Meta（形状照抄 index.js 的赋值处）。 */
const meta = (perLayer, extra = {}) => Object.assign({
  tokens: 100, maxTokens: 400, items: 3, candidates: 5, dropped: 0, perLayer,
}, extra)

// ══ 1. 常量与枚举 ═════════════════════════════════════════════════
console.log('\n[1] 常量与枚举（枚举类常量须配断言兜底 —— 本仓纪律）')
{
  eq(QUOTA_PROBE_SCHEMA_V1, 'quota_probe_v1', 'schema 常量')
  eq(QUOTA_PROBE_CAP_V1, 200, '采样环上限 200（与降级台账同口径）')
  ok(Object.isFrozen(QUOTA_VERDICTS_V1), '判定枚举被冻结')
  eq(QUOTA_VERDICTS_V1.length, 4, '判定 4 档')
  for (const v of ['under-quota', 'over-quota', 'balanced', 'insufficient-data']) {
    ok(QUOTA_VERDICTS_V1.includes(v), '枚举含 ' + v)
  }
  ok(Object.isFrozen(QUOTA_THRESHOLDS_V1), '阈值常量被冻结')
  ok(QUOTA_THRESHOLDS_V1.minSamples >= 8, '★ 最小样本量 ≥8（"长期观察"的机械下限）')
}

// ══ 2. 采集：有界、只留判据所需字段 ═══════════════════════════════
console.log('\n[2] 采集：有界、只留判据所需字段（隐私面与降级台账一致）')
{
  const p = createQuotaProbePre({ now: () => 0 })
  eq(p.snapshot().samples.length, 0, '初始无采样')
  ok(p.observe(meta({ log: { candidates: 10, picked: 3, dropped: 7, tokens: 20, cap: 3 } })) === true, 'observe 返回 true')
  const s = p.snapshot().samples[0]
  eq(s.dropped, 0, '顶层 dropped 透传')
  eq(s.perLayer.log.dropped, 7, 'perLayer 明细保留')
  eq(s.perLayer.log.candidates, 10, 'perLayer.candidates 保留')
  eq(s.perLayer.log.picked, 3, 'perLayer.picked 保留')
  ok(!('text' in s) && !('path' in s), '★ 不含正文/路径（隐私面）')

  // 有界性：超出 cap 后淘汰并可观测
  const small = createQuotaProbePre({ cap: 3, now: () => 0 })
  for (let i = 0; i < 5; i++) small.observe(meta({ log: { candidates: i, picked: 1, dropped: 0 } }))
  const ss = small.snapshot()
  eq(ss.samples.length, 3, '采样数被 cap 限制')
  eq(ss.evicted, 2, '★ 淘汰数可见（"有界"这件事本身不静默）')
}

// ══ 3. fail-soft：观测/快照永不抛，且结构合法 ═══════════════════
console.log('\n[3] fail-soft：观测/快照永不抛，且返回结构合法对象')
{
  const p = createQuotaProbePre()
  let threw = false
  try {
    ok(p.observe(null) === false, 'observe(null) 返回 false 不抛')
    ok(p.observe(undefined) === false, 'observe(undefined) 返回 false 不抛')
    ok(p.observe('nope') === false, 'observe(非对象) 返回 false 不抛')
    ok(p.observe(meta(null)) === true, 'perLayer=null 仍可观测（perLayer 置空）')
    ok(p.observe({ perLayer: { log: null, user: 'x' } }) === true, '脏 perLayer 项被跳过而非抛错')
  } catch (_) { threw = true }
  ok(!threw, '★ 脏输入不抛（观测失败绝不影响主流程）')
  const snap = p.snapshot()
  eq(snap.schemaVersion, QUOTA_PROBE_SCHEMA_V1, '快照带 schemaVersion')
  ok(Array.isArray(snap.samples), '快照 samples 恒为数组')
}

// ══ 4. ★ 判定：样本不足一律不猜 ═══════════════════════════════════
console.log('\n[4] ★ 判定：样本不足一律 insufficient-data（"不能拍脑子"的机械保证）')
{
  const few = createQuotaProbePre({ now: () => 0 })
  for (let i = 0; i < QUOTA_THRESHOLDS_V1.minSamples - 1; i++) {
    few.observe(meta({ log: { candidates: 99, picked: 1, dropped: 98 } }))   // 极端偏向 under
  }
  const v = deriveQuotaVerdictPre(few.snapshot())
  eq(v.verdict, 'insufficient-data', '★ 差 1 个样本也不下结论（哪怕数据极端偏向）')
  ok(v.reasons.join(' ').includes('样本不足'), '理由如实写明"样本不足"')

  eq(deriveQuotaVerdictPre(null).verdict, 'insufficient-data', 'null 入参 → insufficient-data（不抛）')
  eq(deriveQuotaVerdictPre(undefined).verdict, 'insufficient-data', 'undefined 入参 → insufficient-data')
  eq(deriveQuotaVerdictPre({}).verdict, 'insufficient-data', '空对象 → insufficient-data')
  eq(deriveQuotaVerdictPre('junk').verdict, 'insufficient-data', '非对象 → insufficient-data')
}

// ══ 5. ★ 判定：某层长期被丢 ⇒ under-quota ════════════════════════
console.log('\n[5] ★ 判定：某层持续被丢 ⇒ under-quota（配额偏小、内容进不来）')
{
  const p = createQuotaProbePre({ now: () => 0 })
  const N = QUOTA_THRESHOLDS_V1.minSamples
  for (let i = 0; i < N; i++) {
    p.observe(meta({ log: { candidates: 50, picked: 2, dropped: 48, tokens: 30 } }, { tokens: 300, maxTokens: 400 }))
  }
  const v = deriveQuotaVerdictPre(p.snapshot())
  eq(v.verdict, 'under-quota', '★ 层层被丢 → under-quota')
  eq(v.perLayer.log.dropRate, 1, '该层 dropRate = 1')
  ok(v.reasons.join(' ').includes('log'), '理由点名是哪一层')
  ok(v.usage > QUOTA_THRESHOLDS_V1.usageForOver, '★ 优先级：占用高也不能掩盖"被丢"（under 判据先于 over）')
}

// ══ 6. ★ 判定：都不丢 + 远未用满 ⇒ over-quota ════════════════════
console.log('\n[6] ★ 判定：各层都不丢且 token 远未用满 ⇒ over-quota（配额偏大、白花 token）')
{
  const p = createQuotaProbePre({ now: () => 0 })
  const N = QUOTA_THRESHOLDS_V1.minSamples
  for (let i = 0; i < N; i++) {
    p.observe(meta({ log: { candidates: 2, picked: 2, dropped: 0, tokens: 5 } }, { tokens: 20, maxTokens: 400 }))
  }
  const v = deriveQuotaVerdictPre(p.snapshot())
  eq(v.verdict, 'over-quota', '★ 不丢 + 占用低 → over-quota')
  ok(v.usage < QUOTA_THRESHOLDS_V1.usageForOver, 'usage 低于阈值（' + v.usage + '）')
}

// ══ 7. 判定：有丢但未持续 + 占用合理 ⇒ balanced ═══════════════════
console.log('\n[7] 判定：有丢但未持续 + 占用合理 ⇒ balanced')
{
  const p = createQuotaProbePre({ now: () => 0 })
  const N = QUOTA_THRESHOLDS_V1.minSamples
  for (let i = 0; i < N; i++) {
    // 仅前 1 轮有丢 ⇒ dropRate = 1/N < 0.5；占用高（0.75）⇒ 不落 over
    p.observe(meta({ log: { candidates: 5, picked: 4, dropped: i === 0 ? 1 : 0, tokens: 300 } }, { tokens: 300, maxTokens: 400 }))
  }
  const v = deriveQuotaVerdictPre(p.snapshot())
  eq(v.verdict, 'balanced', '偶发丢弃 + 高占用 → balanced')
  ok(v.perLayer.log.dropRate < QUOTA_THRESHOLDS_V1.dropRateForUnder, 'dropRate 低于阈值')
}

// ══ 8. ★ 判据并列不混：配额观测不得进入降级台账 ═══════════════════
console.log('\n[8] ★ 判据并列不混：配额观测绝不进入降级台账')
{
  // 独立验证两个消费者互不干扰
  const sink = createDegradeSinkPre({})
  const probe = createQuotaProbePre({ now: () => 0 })
  const N = QUOTA_THRESHOLDS_V1.minSamples + 2
  for (let i = 0; i < N; i++) probe.observe(meta({ log: { candidates: 9, picked: 1, dropped: 8 } }))
  ok(sink.isEmpty(), '★ 只观测配额，降级台账仍为空（"有没有降级"不被污染）')
  eq(sink.countOf('semantic-arm'), 0, '降级台账无配额相关 kind')

  // 源码级：采集点调用的是 observe，不是 record
  ok(SRC.includes('this._quotaProbe.observe(s.tier0Meta)'),
    '★ 采集点调用 observe()（而非 record()）')
  ok(!/record\(\s*['"]quota/.test(SRC) && !/record\(\s*['"]tier0/.test(SRC),
    '★ 全仓无把配额写进 record 的路径')
  ok(SRC.includes('createQuotaProbePre({})'), '引擎已挂 _quotaProbe')
  ok(SRC.includes('quota: this._quotaViewSnapshot()'), '★ debugInfo 暴露 quota（与 degrade 同出口）')
  ok(SRC.includes('_quotaViewSnapshot() {'), '视图方法已定义')
  ok(SRC.includes('_persistObservabilityPre(snap, quota)'), '落盘走合并写入（同一文件带 quota 键）')
  ok(SRC.includes("path.join(dshHome(), 'memory', 'degrade-pre', 'latest.json')"),
    '★ 复用同一状态文件（不新建状态源，守 S10.4）')
  // 定义顺序：视图方法先于 debugInfo
  const iQuota = SRC.indexOf('_quotaViewSnapshot() {')
  const iPersist = SRC.indexOf('_persistObservabilityPre(snap, quota) {')
  const iDebug = SRC.indexOf('async debugInfo() {')
  ok(iQuota > 0 && iPersist > 0 && iDebug > 0 && iQuota < iDebug && iPersist < iDebug,
    '视图方法定义先于 debugInfo')
}

// ══ 9. ★ 端到端：真实方法体 + 真实落盘（非仅源码匹配） ═════════════
console.log('\n[9] ★ 端到端：真实方法体执行 + 真实落盘（避免"源码接线正确但功能不存在"）')
{
  const { mkdtempSync, readFileSync: rf, existsSync, rmSync } = await import('node:fs')
  const os = await import('node:os')
  const { persistDegradeLedgerPre } = await import('../../lib/degrade.js')

  const tmp = mkdtempSync(path.join(os.tmpdir(), 'r4-quota-'))
  const file = path.join(tmp, 'degrade-pre', 'latest.json')

  // 从源码切出 `_quotaViewSnapshot()` 真实方法体（花括号配平），注入伪引擎执行
  const marker = '  _quotaViewSnapshot() {'
  const start = SRC.indexOf(marker)
  ok(start > 0, '找到 _quotaViewSnapshot 定义')
  let depth = 0, end = -1
  for (let i = start + marker.length - 1; i < SRC.length; i++) {
    if (SRC[i] === '{') depth++
    else if (SRC[i] === '}') { depth--; if (depth === 0) { end = i; break } }
  }
  const body = SRC.slice(start + marker.length - 1, end + 1)
  const fake = {
    _quotaProbe: (() => { const q = createQuotaProbePre({ now: () => 0 }); for (let i = 0; i < 10; i++) q.observe(meta({ log: { candidates: 9, picked: 1, dropped: 8 } })); return q })(),
  }
  const view = new Function('deriveQuotaVerdictPre', 'return function () ' + body)(deriveQuotaVerdictPre).call(fake)
  eq(view.verdict.verdict, 'under-quota', '★ 视图方法真实执行 → under-quota')
  eq(view.samples.length, 10, '视图带 10 条采样')

  // 真实落盘：合并写入后，文件里应同时有 degrade 键与 quota 键
  const sinkSnap = createDegradeSinkPre({}).snapshot()
  const wrote = persistDegradeLedgerPre({
    file, snapshot: Object.assign({}, sinkSnap, { quota: view }),
    mkdirSync: (await import('node:fs')).mkdirSync, writeFileSync: (await import('node:fs')).writeFileSync,
  })
  ok(wrote === true, '落盘返回 true')
  ok(existsSync(file), '★ 文件真实存在（含父目录自动创建）')
  {
    const o = JSON.parse(rf(file, 'utf8'))
    eq(o.schemaVersion, 'degrade_v1', '★ degrade 原有键保持不变（向后兼容既有读者）')
    ok(o.quota && o.quota.schemaVersion === QUOTA_PROBE_SCHEMA_V1, '★ 同一文件内带 quota 键')
    eq(o.quota.verdict.verdict, 'under-quota', '★ 落盘的判定结论正确')
  }
  rmSync(tmp, { recursive: true, force: true })
}

console.log(`\n[r4-quota-probe] ${pass}/${pass + fail} assertions passed`)
if (fail) process.exit(1)
