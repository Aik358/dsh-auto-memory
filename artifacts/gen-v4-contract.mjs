import fs from 'node:fs'
import path from 'node:path'
const OUT = 'D:/dsh-auto-memory/artifacts/v4-contract'
fs.mkdirSync(path.join(OUT, 'fixtures'), { recursive: true })

// ---- 21 top-level fields (single source: MASTER-PLAN §3.1) ----
const FIELDS = [
  { name: 'id', type: 'string', pattern: '^evt_[0-9a-f]{8}$', required: true, note: 'D2 最终值：不带 pre' },
  { name: 'name', type: 'string', maxChars: 80, required: true },
  { name: 'summary', type: 'string', maxChars: 400, required: true },
  { name: 'outcome', type: ['string', 'null'], required: false, note: 'closed 时必填（跨字段约束）' },
  { name: 'skillRef', type: ['string', 'null'], required: true, note: 'null / proc_pre_xxx' },
  { name: 'status', type: 'string', enum: ['active', 'paused', 'closed'], required: true },
  { name: 'pausedReason', type: ['string', 'null'], required: false, note: 'status=paused 时必填' },
  { name: 'sections', type: 'object', required: true, shape: { goal: 'string', doing: 'string', deadend: 'string', next: 'string' } },
  { name: 'checkpoints', type: 'array', required: true, item: { at: 'number', kind: 'string', text: 'string', sourceRef: ['string', 'null'], panels: 'array', idemKey: ['string', 'null'] } },
  { name: 'userPercept', type: 'array', required: true, item: { at: 'number', kind: 'string', stage: 'string', text: 'string', sourceRef: ['string', 'null'] } },
  { name: 'agentTrace', type: 'array', required: true, item: { at: 'number', action: 'string', result: ['string', 'null'], wasRefuted: 'boolean', sourceRef: ['string', 'null'] } },
  { name: 'sharedGround', type: 'array', required: true, item: { at: 'number', claim: 'string', confirmedBy: ['string', 'null'], correction: ['string', 'null'], sourceRef: ['string', 'null'] } },
  { name: 'commitments', type: 'array', required: true, item: { at: 'number', promise: 'string', boundary: ['string', 'null'], state: 'string', sourceRef: ['string', 'null'] } },
  { name: 'constraints', type: 'array', required: true, item: 'string', note: 'rule:<id> / spec:<id>' },
  { name: 'createdAt', type: 'number', required: true },
  { name: 'updatedAt', type: 'number', required: true },
]
// ★口径归因（2026-10-24 批次 0 实测）：MASTER-PLAN §3.1 标题写「21 字段」，但**逐个数只有 16 个顶层键**：
//   id / name / summary / outcome / skillRef / status / pausedReason / sections / checkpoints /
//   userPercept / agentTrace / sharedGround / commitments / constraints / createdAt / updatedAt
// 21 这个数只有在「16 顶层 + 4 个 sections 子键 + 1 个 PANEL_KINDS 注册表」这种**混口径**下才成立。
// 按 §0.1「四处冲突一律取实测值」：契约以 16 为严格可断言值；21 只作文档口径保留，不作断言。
const TOP = FIELDS.map(f => f.name)

const STAGE = ['retrieved', 'delivered', 'used', 'mentioned', 'accepted']
const PANEL_KINDS = ['state', 'log', 'deadend', 'next', 'userPercept', 'commitment']

const schema = {
  $schema: 'v4-event-contract/1',
  frozenAt: '2026-10-24',
  source: 'artifacts/V4-MASTER-PLAN-2026-10-24.md §3.1 / §3.2 / §3.3 / §3.4',
  decisions: { D1: 'event-store.json', D2: 'evt_ (no pre)', D3: 'boardMode=event only', D4: 'no skin pack', D5: '/api/dsh-auto-memory/event-*', D6: 'event-catalog separate segment <=400', D7: 'inscription into rules bucket', D9: 'unarchived = four-section ledgers only', D10: 'curation batch 40' },
  topLevelFieldCount: TOP.length,
  topLevelFields: TOP,
  fieldCountReconciliation: {
    planDocumentSays: 21,
    planDocumentRef: 'artifacts/V4-MASTER-PLAN-2026-10-24.md §3.1 标题',
    strictTopLevelCount: TOP.length,
    measuredAt: '2026-10-24 batch 0',
    explanation: '21 只在「16 顶层 + 4 个 sections 子键 + 1 个 PANEL_KINDS 注册表」的混口径下成立；契约一律以 16 为严格可断言值（§0.1 取实测值纪律）。',
    ruling: 'strict = 16; 21 仅作文档口径，不作断言',
  },
  event: { type: 'object', required: TOP, properties: Object.fromEntries(FIELDS.map(f => [f.name, { type: f.type, ...(f.enum ? { enum: f.enum } : {}), ...(f.shape ? { shape: f.shape } : {}), ...(f.item ? { item: f.item } : {}), ...(f.maxChars ? { maxChars: f.maxChars } : {}), ...(f.pattern ? { pattern: f.pattern } : {}), ...(f.note ? { note: f.note } : {}) }])) },
  crossFieldRules: [
    'status=closed ⇒ outcome 必须是非空字符串',
    'status=paused ⇒ pausedReason 必须是非空字符串',
    'status=active ⇒ pausedReason 必须为 null',
    'checkpoints[].panels[].kind ∈ PANEL_KINDS',
    'userPercept[].stage ∈ STAGE',
    'checkpoints[].idemKey 非空时全局唯一（append-only 不可撤销，靠它防重试重复追加）',
  ],
  renderTiers: {
    T0: { maxChars: 80, content: 'name + status', target: 'event-catalog segment (<=400 chars total)' },
    T1: { maxChars: 140, content: 'summary first sentence', target: 'Tier-1 hit summary' },
    T2: { maxChars: 2400, content: 'full sections + latest 3 checkpoints', target: 'event-cards segment (active 1-2 only)' },
  },
  routes: [
    { path: '/api/dsh-auto-memory/event-list', method: 'GET', query: '?all=1 ⇒ return all events with lean fields (no checkpoints body, only count); default 50/page', returns: '{ ok, total, events: [{id,name,summary,status,sections,updatedAt,checkpointCount}], nextCursor }' },
    { path: '/api/dsh-auto-memory/event-detail', method: 'GET', query: '?id=evt_xxx', returns: '{ ok, event }' },
    { path: '/api/dsh-auto-memory/event-unarchived', method: 'GET', returns: '{ ok, total, items, estimatedInputTokens, estimatedOutputTokens }' },
    { path: '/api/dsh-auto-memory/event-curate', method: 'POST', body: '{ batchSize<=40, confirmToken }', returns: '{ ok, drafts } | 409 when confirmToken missing/invalid' },
  ],
  storage: { dir: '<projectDir>/handoff/', eventStore: 'event-store.json', curationLog: 'event-curation-log.jsonl', atomicWrite: 'tmp -> rename (same as facts.json, index.js:3280)' },
  panelKinds: PANEL_KINDS,
  stageEnum: STAGE,
}
fs.writeFileSync(path.join(OUT, 'event-schema.json'), JSON.stringify(schema, null, 2))

// ---- fixture builder (shared by both fixtures) ----
function mkEvent(over) {
  const base = {
    id: 'evt_' + (over.idHex || 'a1b2c3d4'),
    name: over.name || '示例事件',
    summary: over.summary || '一句话总览。',
    outcome: over.outcome === undefined ? null : over.outcome,
    skillRef: null,
    status: over.status || 'active',
    pausedReason: over.pausedReason === undefined ? null : over.pausedReason,
    sections: over.sections || { goal: '目标', doing: '进行中', deadend: '无', next: '下一步' },
    checkpoints: over.checkpoints || [],
    userPercept: over.userPercept || [],
    agentTrace: over.agentTrace || [],
    sharedGround: over.sharedGround || [],
    commitments: over.commitments || [],
    constraints: over.constraints || [],
    createdAt: over.createdAt || 1793000000000,
    updatedAt: over.updatedAt || 1793000000000,
  }
  return base
}

// fixture 1: minimal active event (all empty arrays)
const f1 = mkEvent({ idHex: '00000001', name: '最小合法事件', summary: '所有集合为空的最小形态。' })
// fixture 2: full event — every optional branch filled (closed + outcome + checkpoints with panels + 4 human-side arrays)
const f2 = mkEvent({
  idHex: '00000002',
  name: '完整事件（全部字段填充）',
  summary: '覆盖 closed 状态、outcome、3 个检查点（含六类 panels 中的四类）、userPercept/agentTrace/sharedGround/commitments 各至少一条。',
  status: 'closed',
  outcome: '完成并通过验收。',
  sections: { goal: '验证契约完整性', doing: '逐字段填充', deadend: '无', next: '无（已 closed）' },
  checkpoints: [
    { at: 1793000001000, kind: 'progress', text: '第一条检查点', sourceRef: 'handoff/handoff-20261024-120000.md#L1-L20', panels: [{ kind: 'state', text: '进行中' }, { kind: 'next', text: '继续' }], idemKey: 'chk-1' },
    { at: 1793000002000, kind: 'deadend', text: '第二条检查点', sourceRef: 'handoff/handoff-20261024-130000.md#L5-L9', panels: [{ kind: 'deadend', text: '方案 A 失败' }], idemKey: 'chk-2' },
    { at: 1793000003000, kind: 'log', text: '第三条检查点', sourceRef: null, panels: [{ kind: 'log', text: '记录' }], idemKey: null },
  ],
  userPercept: [{ at: 1793000004000, kind: 'preference', stage: 'accepted', text: '用户偏好简洁', sourceRef: 'MEMORY.md#L10' }],
  agentTrace: [{ at: 1793000005000, action: '修改方案', result: '通过', wasRefuted: false, sourceRef: null }],
  sharedGround: [{ at: 1793000006000, claim: '用户要求先修 recall', confirmedBy: '用户原话', correction: null, sourceRef: null }],
  commitments: [{ at: 1793000007000, promise: '先修可用性再谈效果', boundary: '不含评测集', state: 'fulfilled', sourceRef: null }],
  constraints: ['rule:R12', 'spec:v4-3.1'],
})
fs.writeFileSync(path.join(OUT, 'fixtures', 'minimal-active.json'), JSON.stringify(f1, null, 2))
fs.writeFileSync(path.join(OUT, 'fixtures', 'full-closed.json'), JSON.stringify(f2, null, 2))
console.log(JSON.stringify({ topLevelFields: TOP.length, files: 3 }))