#!/usr/bin/env node
/**
 * verify-v4-contract.mjs —— 批次 0 冻结契约的验收器。
 *
 * 纪律（CR-10）：不写「源码含某字符串」式断言。这里全部是**对产物文件做真实结构校验**：
 * JSON.parse → 逐字段类型/范围 → 跨字段约束 → 故意注入 5 类畸形看是否真被抓住（负路径）。
 *
 * 用法：node artifacts/v4-contract/verify.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DIR = path.dirname(fileURLToPath(import.meta.url))
let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  PASS ' + m) } else { fail++; console.log('  FAIL ' + m) } }
const eq = (a, b, m) => ok(Object.is(a, b), m + '  (got=' + JSON.stringify(a) + ' want=' + JSON.stringify(b) + ')')

const schema = JSON.parse(fs.readFileSync(path.join(DIR, 'event-schema.json'), 'utf8'))
const TOP = schema.topLevelFields

console.log('[0] 契约自洽')
eq(schema.topLevelFieldCount, 16, '顶层字段严格计数 = 16')
eq(TOP.length, 16, 'topLevelFields 数组长度 = 16')
eq(schema.fieldCountReconciliation.planDocumentSays, 21, '文档口径 21 已被显式记录（不是悄悄改掉）')
eq(schema.fieldCountReconciliation.strictTopLevelCount, 16, '严格口径 = 16 且与 planDocumentSays 并列留档')
ok(/不作断言/.test(schema.fieldCountReconciliation.ruling), '明确写出「21 不作断言」防后来者照抄')
eq(schema.panelKinds.length, 6, 'PANEL_KINDS 六类注册表')
eq(schema.stageEnum.length, 5, 'stage 五值枚举')
eq(schema.renderTiers.T0.maxChars, 80, 'T0 上限 80')
eq(schema.renderTiers.T1.maxChars, 140, 'T1 上限 140')
eq(schema.renderTiers.T2.maxChars, 2400, 'T2 上限 2400')
eq(schema.routes.length, 4, '事件路由 4 条（list/detail/unarchived/curate）')
ok(schema.routes.some(r => r.path.endsWith('/event-list')), 'event-list 在契约里（这是原四份文档的缺口）')
ok(schema.storage.eventStore === 'event-store.json', 'D1：存储文件名 event-store.json')
ok(/tmp -> rename/.test(schema.storage.atomicWrite), '原子写口径写进契约')

// ---- 校验器（真实实现，供两道 fixture 与负路径共用）----
const TYPES = { string: 'string', number: 'number', boolean: 'boolean', object: 'object', array: 'object' }
function typeOk(v, spec) {
  const list = Array.isArray(spec) ? spec : [spec]
  return list.some(t => {
    if (t === 'null') return v === null
    if (t === 'array') return Array.isArray(v)
    if (t === 'object') return v !== null && typeof v === 'object' && !Array.isArray(v)
    return typeof v === t
  })
}
function badFields(obj) {
  const bad = []
  for (const f of TOP) if (!Object.prototype.hasOwnProperty.call(obj, f)) bad.push('missing:' + f)
  for (const [name, p] of Object.entries(schema.event.properties)) {
    if (!Object.prototype.hasOwnProperty.call(obj, name)) continue
    if (!typeOk(obj[name], p.type)) bad.push('type:' + name)
    if (p.pattern && typeof obj[name] === 'string' && !new RegExp(p.pattern).test(obj[name])) bad.push('pattern:' + name)
    if (p.maxChars && typeof obj[name] === 'string' && obj[name].length > p.maxChars) bad.push('maxChars:' + name)
    if (p.enum && !p.enum.includes(obj[name])) bad.push('enum:' + name)
  }
  for (const c of (obj.checkpoints || [])) {
    for (const k of ['at', 'kind', 'text', 'panels']) if (!(k in c)) bad.push('checkpoint missing:' + k)
    for (const pn of (c.panels || [])) if (!schema.panelKinds.includes(pn.kind)) bad.push('panel kind:' + pn.kind)
  }
  for (const u of (obj.userPercept || [])) if (!schema.stageEnum.includes(u.stage)) bad.push('stage:' + u.stage)
  if (obj.status === 'closed' && !(typeof obj.outcome === 'string' && obj.outcome.trim())) bad.push('rule:closed needs outcome')
  if (obj.status === 'paused' && !(typeof obj.pausedReason === 'string' && obj.pausedReason.trim())) bad.push('rule:paused needs pausedReason')
  if (obj.status === 'active' && obj.pausedReason !== null) bad.push('rule:active pausedReason must be null')
  const keys = (obj.checkpoints || []).map(c => c.idemKey).filter(Boolean)
  if (new Set(keys).size !== keys.length) bad.push('rule:duplicate idemKey')
  return bad
}

console.log('[1] fixture 合法（真 JSON.parse + 全字段校验）')
const fixtures = fs.readdirSync(path.join(DIR, 'fixtures')).filter(f => f.endsWith('.json')).sort()
ok(fixtures.length >= 2, '至少 2 个 fixture（实测 ' + fixtures.length + '）')
for (const f of fixtures) {
  const ev = JSON.parse(fs.readFileSync(path.join(DIR, 'fixtures', f), 'utf8'))
  const bad = badFields(ev)
  ok(bad.length === 0, f + ' 全量校验通过' + (bad.length ? ' → ' + bad.join(',') : ''))
}

console.log('[2] 负路径：校验器真的抓得住（不是恒绿）')
const base = JSON.parse(fs.readFileSync(path.join(DIR, 'fixtures', 'full-closed.json'), 'utf8'))
const clone = () => JSON.parse(JSON.stringify(base))

let m = clone(); delete m.status
ok(badFields(m).some(x => x.startsWith('missing:status')), '删 status ⇒ 抓「缺字段」')

m = clone(); m.id = 'evt_pre_deadbeef'
ok(badFields(m).some(x => x.startsWith('pattern:id')), 'id 带 pre ⇒ 抓「格式错」（D2 新代码不带 pre）')

m = clone(); m.status = 'closed'; m.outcome = null
ok(badFields(m).some(x => x.includes('closed needs outcome')), 'closed 缺 outcome ⇒ 抓跨字段约束')

m = clone(); m.status = 'active'; m.pausedReason = '不该有'
ok(badFields(m).some(x => x.includes('active pausedReason must be null')), 'active 带 pausedReason ⇒ 抓跨字段约束')

m = clone(); m.checkpoints.push({ at: 1, kind: 'x', text: 'dup', panels: [], idemKey: 'chk-1' })
ok(badFields(m).some(x => x.includes('duplicate idemKey')), '重复 idemKey ⇒ 抓唯一性（append-only 不可撤销的唯一防线）')

m = clone(); m.userPercept.push({ at: 1, kind: 'k', stage: 'emotionally-touched', text: 't', sourceRef: null })
ok(badFields(m).some(x => x.startsWith('stage:')), 'stage 非法值 ⇒ 抓枚举')

m = clone(); m.checkpoints[0].panels.push({ kind: 'never-registered', text: 't' })
ok(badFields(m).some(x => x.startsWith('panel kind:')), 'panel kind 未注册 ⇒ 抓注册表')

m = clone(); m.name = 'x'.repeat(81)
ok(badFields(m).some(x => x.startsWith('maxChars:name')), 'name 超 80 字 ⇒ 抓长度上限')

console.log('')
console.log('[contract] ' + pass + ' PASS / ' + fail + ' FAIL')
process.exit(fail ? 1 : 0)