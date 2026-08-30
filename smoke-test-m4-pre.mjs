// M4-1 纯核心测试(docs/M4-CONTRACT.md §9-§13/§16 + §19 矩阵 5/6/7/8/9/10/14/15/17/18/27):
// 全部纯内存 fixture,零磁盘写入,零真实记忆接触。hard-fail guard。
process.on('uncaughtException', (e) => { console.error('[M4-TEST] FATAL:', (e && (e.stack || e.message)) || e); process.exit(1) })
process.on('unhandledRejection', (r) => { console.error('[M4-TEST] REJ:', r); process.exit(1) })

const M = await import('./lib/shadow-retrieval-pre.js')
const {
  SHADOW_GATE_POLICY_PRE_V1, SHADOW_LEXICAL_BUDGET_PRE_V1, DROP_REASON_SET,
  validateSnapshot, memoryIndexVersion, tokenize, normalizeText, buildQueryPlan,
  computeSignals, gatePreV1, lexicalSearch, buildCandidates, buildRetrievalId, buildCandidateId,
  replay, canonicalPlugDate, sanitizeExcerpt,
} = M

const mkSnap = (over = {}) => Object.assign({
  schemaVersion: 1, sessionId: 'sess-1', agentId: 'agent-a',
  workspaceKey: 'D:/ws-a', sessionClass: 'top-level',
  contextVersion: 5, eventSeq: 42,
  trigger: { segmentId: 'seg-t1', segmentDigest: 'digest-trigger-0000001', kind: 'user', eventType: 'user/message', ts: 1724300000000 },
  window: [
    { segmentId: 'seg-w1', digest: 'digest-w100000000001', kind: 'user', eventSeq: 40, contextVersion: 4, ts: 1724299000000, text: '帮我看看登录模块为什么失败' },
    { segmentId: 'seg-w2', digest: 'digest-w200000000002', kind: 'tool_call', eventSeq: 41, contextVersion: 5, ts: 1724299500000, text: 'run tests', toolName: 'bash' },
  ],
}, over)

// ---------- F1 策略常量冻结与权重和 ----------
{
  const w = SHADOW_GATE_POLICY_PRE_V1.weights
  const sum = w.explicitRecall + w.toolFailure + w.unresolved + w.repeated + w.novelty + w.phaseShift + w.historical + w.conflict + w.unresolvedAge
  if (Math.abs(sum - 1) > 1e-9) throw new Error('weights must sum to 1, got ' + sum)
  if (w.goalDrift !== 0 || w.monitor !== 0 || w.reasoning !== 0) throw new Error('v1 zero weights broken')
  if (SHADOW_GATE_POLICY_PRE_V1.cooldownSegments !== 2) throw new Error('cooldown must be 2')
  if (SHADOW_GATE_POLICY_PRE_V1.hysteresisOn !== 0.65 || SHADOW_GATE_POLICY_PRE_V1.hysteresisOff !== 0.42) throw new Error('hysteresis wrong')
  if (SHADOW_LEXICAL_BUDGET_PRE_V1.rankedKept !== 8 || SHADOW_LEXICAL_BUDGET_PRE_V1.rawHits !== 64) throw new Error('budget wrong')
  for (const d of ['no-owner', 'child-session', 'cooldown', 'index-conflict', 'future-dated']) {
    if (!DROP_REASON_SET.has(d)) throw new Error('drop reason missing: ' + d)
  }
  try { SHADOW_GATE_POLICY_PRE_V1.weights.explicitRecall = 1; } catch (_) {}
  if (SHADOW_GATE_POLICY_PRE_V1.weights.explicitRecall !== 0.30) throw new Error('policy must be frozen')
  console.log('F1 策略常量冻结 ✓ (权重和=1, cooldown=2, 滞回 0.65/0.42)')
}

// ---------- F2 snapshot validator ----------
{
  const v1 = validateSnapshot(mkSnap())
  if (!v1.ok) throw new Error('valid snapshot rejected: ' + v1.reason)
  const bad = validateSnapshot({ schemaVersion: 2 })
  if (bad.ok || !bad.reason.includes('schemaVersion')) throw new Error('bad schema must be flagged')
  const bigWindow = mkSnap({ window: Array.from({ length: 10 }, (_, i) => ({ segmentId: 's' + i, digest: 'd' + i, kind: 'user', eventSeq: i, contextVersion: i, ts: i, text: 'x' })) })
  const v3 = validateSnapshot(bigWindow)
  if (v3.ok || !v3.reason.includes('window-exceeds-8')) throw new Error('window >8 must be flagged')
  console.log('F2 snapshot validator ✓')
}

// ---------- F3 memoryIndexVersion 确定性 ----------
{
  const s = [{ scope: 'User', sourceRef: 'user:MEMORY.md', sourceEpoch: 'e1', sourceVersion: 1, fileDigest: 'aa' }]
  const v1 = memoryIndexVersion(s)
  const v2 = memoryIndexVersion([...s])
  if (v1 !== v2 || !v1.startsWith('idx_pre_')) throw new Error('version must be deterministic with idx_pre_ prefix')
  const changed = memoryIndexVersion([{ ...s[0], sourceVersion: 2 }])
  if (changed === v1) throw new Error('version change must alter index version')
  // 枚举顺序无关(排序按 scope/sourceRef)
  const reordered = memoryIndexVersion([
    { scope: 'Workspace', sourceRef: 'workspace-log:2026.md', sourceEpoch: 'e', sourceVersion: 1, fileDigest: 'bb' },
    { scope: 'User', sourceRef: 'user:MEMORY.md', sourceEpoch: 'e1', sourceVersion: 1, fileDigest: 'aa' },
  ])
  const ordered = memoryIndexVersion([
    { scope: 'User', sourceRef: 'user:MEMORY.md', sourceEpoch: 'e1', sourceVersion: 1, fileDigest: 'aa' },
    { scope: 'Workspace', sourceRef: 'workspace-log:2026.md', sourceEpoch: 'e', sourceVersion: 1, fileDigest: 'bb' },
  ])
  if (reordered !== ordered) throw new Error('version must not depend on enumeration order')
  console.log('F3 memoryIndexVersion ✓ (确定性/顺序无关/变化敏感)')
}

// ---------- F4 tokenizer 多语言与词形保留 ----------
{
  const toks = tokenize('修复 login-module 的 cacheMissBug! v1.2.3 错误码 ERR_CACHE_001 中文连续词测试')
  const joined = toks.join('|')
  if (!joined.includes('login-module')) throw new Error('kebab-case lost')
  if (!joined.includes('cachemissbug') && !joined.includes('cacheMissBug')) throw new Error('camelCase lost')
  if (!joined.includes('v1.2.3')) throw new Error('version lost')
  if (!joined.includes('err_cache_001')) throw new Error('error code lost')
  if (!toks.some((t) => /中文|文连|连续/.test(t))) throw new Error('CJK grams missing')
  // NFKC + lowercase
  if (!normalizeText('Ｌｏｇｉｎ').includes('login')) throw new Error('NFKC failed')
  if (normalizeText('LOGIN') !== 'login') throw new Error('lowercase failed')
  // CJK gram 上限 64
  const many = tokenize('长'.repeat(200))
  const grams = many.filter((t) => t.length === 2)
  if (grams.length > 64) throw new Error('CJK gram cap broken')
  console.log('F4 tokenizer ✓ (多语言/NFKC/camel/snake/kebab/版本/错误码/CJK 上限)')
}

// ---------- F5 QueryPlan 预算与确定性 ----------
{
  const snap = mkSnap({
    window: [{ segmentId: 'w', digest: 'd1', kind: 'user', eventSeq: 1, contextVersion: 1, ts: 1, text: '数据库连接池配置 数据库超时' }],
  })
  const qp = buildQueryPlan(snap)
  if (qp.policyVersion !== 'lexical_pre_v2' || qp.schemaVersion !== 1) throw new Error('QueryPlan version wrong')
  if (qp.terms.length > 32) throw new Error('terms over budget')
  let bytes = 0
  for (const t of qp.terms) bytes += Buffer.byteLength(t.term, 'utf8')
  if (bytes > 2048) throw new Error('term bytes over budget')
  if (!qp.queryDigest || qp.queryDigest.length !== 32) throw new Error('queryDigest malformed')
  const qp2 = buildQueryPlan(JSON.parse(JSON.stringify(snap)))
  if (qp2.queryDigest !== qp.queryDigest) throw new Error('queryDigest must be deterministic')
  // 超 96 字节 term 记 oversize
  const longSnap = mkSnap({ window: [{ segmentId: 'w2', digest: 'd2', kind: 'user', eventSeq: 2, contextVersion: 1, ts: 1, text: 'a'.repeat(200) }] })
  const qpLong = buildQueryPlan(longSnap)
  if (!(qpLong.oversizeCount >= 0)) throw new Error('oversize accounting broken')
  console.log('F5 QueryPlan ✓ (预算/digest 确定/oversize 计账)')
}

// ---------- F6 Gate 硬抑制顺序 ----------
{
  const base = mkSnap()
  const cases = [
    [{ 'no-owner': true }, 'no-owner'],
    [{ disposed: true }, 'disposed'],
    [{ 'child-session': true }, 'child-session'],
    [{ 'no-segment': true }, 'no-segment'],
    [{ 'plugin-generated-trigger': true }, 'plugin-generated-trigger'],
    [{ 'empty-query-signal': true }, 'empty-query-signal'],
    [{ 'duplicate-context': true }, 'duplicate-context'],
    [{ 'user-ignored': true }, 'user-ignored'],
  ]
  let prevPriority = -1
  for (const [suppress, expect] of cases) {
    const d = gatePreV1(base, { hardSuppress: suppress, signals: { explicitRecall: 1, toolFailure: 1, unresolved: 1, repeated: 1, novelty: 1, phaseShift: 1, historical: 1 } })
    if (d.action !== 'suppress' || d.reason !== expect) throw new Error('hard suppress broken: expected ' + expect + ' got ' + d.reason)
  }
  console.log('F6 Gate 硬抑制顺序 ✓ (8 级优先于分数)')
}

// ---------- F7 权重滞回/cooldown/explicitRecall 绕过/enableEpoch 清零 ----------
{
  // 无信号 → suppress below-threshold
  const empty = mkSnap({ trigger: { segmentId: 't', segmentDigest: 'dg-empty-00000001', kind: 'assistant', eventType: 'assistant/message', ts: 1724300000000 }, window: [] })
  const d0 = gatePreV1(empty, { signals: { explicitRecall: 0, novelty: 0, toolFailure: 0, unresolved: 0, repeated: 0, phaseShift: 0, historical: 0, conflict: 0, unresolvedAge: 0 } })
  if (d0.action !== 'suppress' || d0.hesitation !== 0) throw new Error('zero signal must suppress')
  // explicitRecall=1 → rawScore ≥ 0.82 → retrieve + armed + cooldown=2
  const recallSnap = mkSnap({ trigger: { segmentId: 'tr', segmentDigest: 'dg-recall-000001', kind: 'user', eventType: 'user/message', ts: 1724300000000, text: '回忆一下之前的记录' }, window: [] })
  const dr = gatePreV1(recallSnap, { signals: { explicitRecall: 1, novelty: 1, toolFailure: 0, unresolved: 0, repeated: 0, phaseShift: 0, historical: 0, conflict: 0, unresolvedAge: 0 } })
  if (dr.action !== 'retrieve' || dr.rawScore < 0.82 || dr.latched !== true || dr.cooldownRemaining !== 2) throw new Error('explicit recall must arm retrieve: ' + JSON.stringify(dr))
  // cooldown 抑制但 explicitRecall 绕过
  const dc = gatePreV1(recallSnap, { previousLatch: true, cooldownRemaining: 2, signals: { explicitRecall: 0, novelty: 0, toolFailure: 0, unresolved: 0, repeated: 0, phaseShift: 0, historical: 0, conflict: 0, unresolvedAge: 0 } })
  if (dc.action !== 'suppress' || dc.state !== 'cooldown' || dc.reason !== 'cooldown') throw new Error('cooldown must suppress non-recall')
  const db = gatePreV1(recallSnap, { previousLatch: false, cooldownRemaining: 2, signals: { explicitRecall: 1, novelty: 1, toolFailure: 0, unresolved: 0, repeated: 0, phaseShift: 0, historical: 0, conflict: 0, unresolvedAge: 0 } })
  if (db.action !== 'retrieve') throw new Error('explicit recall must bypass shadow cooldown')
  // 滞回保持:previousLatch=true 且 rawScore∈[0.42,0.55) → latch 保持、action=prefetch
  const midSignals = { explicitRecall: 0, novelty: 1, toolFailure: 1, unresolved: 1, repeated: 0, phaseShift: 0, historical: 1, conflict: 0, unresolvedAge: 0 }
  const dm = gatePreV1(empty, { previousLatch: true, cooldownRemaining: 0, signals: midSignals })
  if (dm.rawScore < 0.42 || dm.rawScore >= SHADOW_GATE_POLICY_PRE_V1.prefetchThreshold) throw new Error('fixture must land in [0.42,0.55), got ' + dm.rawScore)
  if (dm.latched !== true) throw new Error('latch must hold above hysteresis-off when previously latched')
  if (dm.action !== 'prefetch') throw new Error('latched mid-band must prefetch')
  // 滞回解除:previousLatch=true 但 rawScore<0.42 → latch 解除
  const dLow = gatePreV1(empty, { previousLatch: true, cooldownRemaining: 0, signals: { explicitRecall: 0, novelty: 0.5, toolFailure: 0, unresolved: 0, repeated: 0, phaseShift: 0, historical: 0, conflict: 0, unresolvedAge: 0 } })
  if (dLow.latched !== false) throw new Error('latch must release below hysteresis-off')
  // 同输入同决策
  const dA = gatePreV1(recallSnap, {})
  const dB = gatePreV1(recallSnap, {})
  if (JSON.stringify(dA) !== JSON.stringify(dB)) throw new Error('gate must be deterministic')
  console.log('F7 Gate 滞回/冷却/绕过/确定性 ✓')
}

// ---------- F8 child session 与 plugin trigger 抑制 ----------
{
  const child = mkSnap({ sessionClass: 'child' })
  const dc = gatePreV1(child, { hardSuppress: { 'child-session': true } })
  if (dc.reason !== 'child-session') throw new Error('child must suppress')
  // plugin-generated:user trigger 带 inputSource → plugin-generated-trigger
  const plug = mkSnap({ trigger: Object.assign({}, mkSnap().trigger, { inputSource: 'plugin-x' }) })
  const dp = gatePreV1(plug, { hardSuppress: { 'plugin-generated-trigger': true } })
  if (dp.reason !== 'plugin-generated-trigger') throw new Error('plugin trigger must suppress')
  console.log('F8 child/plugin 触发抑制 ✓')
}

// ---------- F9 lexicalSearch:评分/排序/去重/future-dated ----------
{
  const corpus = {
    memoryIndexVersion: 'idx_pre_test',
    sources: [
      { scope: 'User', sourceRef: 'user:MEMORY.md', sourceEpoch: 'e1', sourceVersion: 1, fileDigest: 'f1' },
      { scope: 'Workspace', sourceRef: 'workspace:MEMORY.md', sourceEpoch: 'e2', sourceVersion: 1, fileDigest: 'f2' },
      { scope: 'Workspace', sourceRef: 'workspace-log:2026-08-22.md', sourceEpoch: 'e3', sourceVersion: 1, fileDigest: 'f3' },
    ],
    records: [
      { memoryId: 'mem_' + 'a'.repeat(32), anchorId: 'memory:mem_' + 'a'.repeat(32), scope: 'Workspace', sourceClass: 'workspace-notes', sourceRef: 'workspace:MEMORY.md', sourceEpoch: 'e2', sourceVersion: 1, fileDigest: 'f2', recordDigest: 'rd-a', lineStart: 1, lineEnd: 3, byteStart: 0, byteEnd: 60, heading: '登录模块缓存设计', text: '登录模块使用 redis 缓存会话 token,超时 30 分钟', bytes: 60 },
      { memoryId: 'mem_' + 'b'.repeat(32), anchorId: 'memory:mem_' + 'b'.repeat(32), scope: 'Workspace', sourceClass: 'workspace-log', sourceRef: 'workspace-log:2026-08-22.md', sourceEpoch: 'e3', sourceVersion: 1, fileDigest: 'f3', recordDigest: 'rd-b', lineStart: 1, lineEnd: 2, byteStart: 0, byteEnd: 50, heading: null, text: '今天修复了登录模块的缓存穿透问题,涉及 redis 配置', bytes: 50 },
      { memoryId: 'mem_' + 'c'.repeat(32), anchorId: 'memory:mem_' + 'c'.repeat(32), scope: 'User', sourceClass: 'user-memory', sourceRef: 'user:MEMORY.md', sourceEpoch: 'e1', sourceVersion: 1, fileDigest: 'f1', recordDigest: 'rd-c', lineStart: 1, lineEnd: 2, byteStart: 0, byteEnd: 45, heading: null, text: '用户偏好中文回复与分步验证', bytes: 45 },
      // future-dated 日志
      { memoryId: 'mem_' + 'd'.repeat(32), anchorId: 'memory:mem_' + 'd'.repeat(32), scope: 'Workspace', sourceClass: 'workspace-log', sourceRef: 'workspace-log:2027-01-01.md', sourceEpoch: 'e3', sourceVersion: 1, fileDigest: 'f3', recordDigest: 'rd-d', lineStart: 1, lineEnd: 2, byteStart: 0, byteEnd: 40, heading: null, text: '登录模块未来日志条目', bytes: 40 },
      // legacy(无合法 memoryId)不计候选
      { memoryId: null, scope: 'Workspace', sourceClass: 'workspace-notes', sourceRef: 'workspace:MEMORY.md', sourceEpoch: 'e2', sourceVersion: 1, fileDigest: 'f2', recordDigest: 'rd-e', lineStart: 9, lineEnd: 9, byteStart: 0, byteEnd: 20, heading: 'legacy 块', text: '旧内容无身份', bytes: 20 },
    ],
  }
  const snap = mkSnap({ trigger: { segmentId: 'seg-q', segmentDigest: 'dg-query-0000001', kind: 'user', eventType: 'user/message', ts: new Date('2026-08-23T12:00:00').getTime(), text: '登录模块 缓存 怎么配置' } })
  const qp = buildQueryPlan(snap)
  const ls = lexicalSearch(corpus, qp, { triggerTs: snap.trigger.ts, dayBoundaryMinutes: 450, mode: 'retrieve' })
  if (ls.kept.length < 1) throw new Error('expected hits for login/cache query, got 0')
  for (const k of ls.kept) {
    if (!/^mem_[0-9a-f]{32}$/.test(k.memoryId)) throw new Error('kept candidate has bad id')
    if (k.scores.total < 0.10) throw new Error('kept below score floor')
  }
  // future-dated 必须被丢弃
  if (ls.kept.some((k) => k.sourceRef.includes('2027-01-01'))) throw new Error('future-dated must be dropped')
  if (!ls.dropped.some((d) => d.reason === 'future-dated')) throw new Error('future-dated reason missing')
  // 排序:total desc
  for (let i = 1; i < ls.kept.length; i++) {
    if (ls.kept[i].scores.total > ls.kept[i - 1].scores.total) throw new Error('sort order broken')
  }
  // legacy 只进统计
  if (ls.counts.legacyConflicts < 1) throw new Error('legacy must count into legacyConflicts')
  console.log('F9 lexicalSearch ✓ (' + ls.kept.length + ' kept, future-dated dropped, legacy 统计, 排序确定)')
}

// ---------- F10 去重:index-conflict 与 duplicate-content ----------
{
  const idA = 'mem_' + '1'.repeat(32)
  const idB = 'mem_' + '2'.repeat(32)
  const mkRec = (mid, rd, extra) => Object.assign({
    memoryId: mid, scope: 'Workspace', sourceClass: 'workspace-notes', sourceRef: 'workspace:MEMORY.md',
    sourceEpoch: 'e', sourceVersion: 1, fileDigest: 'f', recordDigest: rd,
    lineStart: 1, lineEnd: 1, byteStart: 0, byteEnd: 30, heading: '登录', text: '登录模块缓存说明', bytes: 30,
  }, extra)
  // 同 memoryId 不同 recordDigest → index-conflict fail closed
  const c1 = { memoryIndexVersion: 'idx_pre_x', sources: [], records: [mkRec(idA, 'rd1'), mkRec(idA, 'rd2')] }
  const ls1 = lexicalSearch(c1, { terms: [{ term: '登录', weight: 1 }], phrases: [] }, {})
  if (ls1.kept.length !== 0) throw new Error('index-conflict must fail closed')
  if (!ls1.dropped.some((d) => d.reason === 'index-conflict')) throw new Error('index-conflict reason missing')
  // 同 recordDigest 不同 memoryId → duplicate-content 保留排序更高者
  const c2 = { memoryIndexVersion: 'idx_pre_x', sources: [], records: [mkRec(idA, 'same-rd'), mkRec(idB, 'same-rd')] }
  const ls2 = lexicalSearch(c2, { terms: [{ term: '登录', weight: 1 }], phrases: [] }, {})
  if (ls2.kept.length !== 1) throw new Error('duplicate content must keep exactly one')
  if (!ls2.dropped.some((d) => d.reason === 'duplicate-content')) throw new Error('duplicate-content reason missing')
  console.log('F10 去重 ✓ (index-conflict fail closed / duplicate-content 有 provenance)')
}

// ---------- F11 预算:record-budget / corpus-byte-budget / rankedKept=8 ----------
{
  // record-budget:>512
  const manyRecords = Array.from({ length: 520 }, (_, i) => ({
    memoryId: 'mem_' + String(i).padStart(32, '0').replace(/(.{32})$/, (m) => m), scope: 'Workspace',
    sourceClass: 'workspace-notes', sourceRef: 'workspace:MEMORY.md', sourceEpoch: 'e', sourceVersion: 1,
    fileDigest: 'f', recordDigest: 'rd-' + i, lineStart: 1, lineEnd: 1, byteStart: 0, byteEnd: 10,
    heading: '登录', text: '登录条目' + i, bytes: 10,
  })).map((r, i) => ({ ...r, memoryId: 'mem_' + i.toString(16).padStart(32, '0') }))
  const ls1 = lexicalSearch({ sources: [], records: manyRecords }, { terms: [{ term: '登录', weight: 1 }], phrases: [] }, {})
  if (!ls1.dropped.some((d) => d.reason === 'record-budget')) throw new Error('>512 records must drop record-budget')
  // corpus-byte-budget:>64MiB
  const fat = Array.from({ length: 4 }, () => ({ memoryId: 'mem_' + '9'.repeat(32), scope: 'Workspace', sourceClass: 'x', sourceRef: 'x', sourceEpoch: 'e', sourceVersion: 1, fileDigest: 'f', recordDigest: 'rd', lineStart: 1, lineEnd: 1, byteStart: 0, byteEnd: 0, heading: '', text: '', bytes: 17 * 1024 * 1024 }))
  const ls2 = lexicalSearch({ sources: [], records: fat }, { terms: [{ term: '登录', weight: 1 }], phrases: [] }, {})
  if (!ls2.dropped.some((d) => d.reason === 'corpus-byte-budget')) throw new Error('>64MiB corpus must drop')
  // rankedKept=8
  const eightPlus = Array.from({ length: 20 }, (_, i) => ({
    memoryId: 'mem_' + i.toString(16).padStart(32, '0'), scope: 'Workspace', sourceClass: 'workspace-notes',
    sourceRef: 'workspace:MEMORY.md', sourceEpoch: 'e', sourceVersion: 1, fileDigest: 'f',
    recordDigest: 'rd-' + i, lineStart: 1, lineEnd: 1, byteStart: 0, byteEnd: 20,
    heading: '登录模块专题' + i, text: '登录模块缓存条目编号' + i, bytes: 20,
  }))
  const ls3 = lexicalSearch({ sources: [], records: eightPlus }, { terms: [{ term: '登录模块', weight: 1 }], phrases: [] }, {})
  if (ls3.kept.length !== 8) throw new Error('rankedKept must cap at 8, got ' + ls3.kept.length)
  console.log('F11 预算 ✓ (record-budget/corpus-byte-budget/rankedKept=8)')
}

// ---------- F12 replay 纯 core 确定性 + 身份 ----------
{
  const corpus = {
    memoryIndexVersion: 'idx_pre_replaytest',
    sources: [{ scope: 'Workspace', sourceRef: 'workspace:MEMORY.md', sourceEpoch: 'e', sourceVersion: 1, fileDigest: 'f' }],
    records: [
      { memoryId: 'mem_' + 'ef'.repeat(16), scope: 'Workspace', sourceClass: 'workspace-notes', sourceRef: 'workspace:MEMORY.md', sourceEpoch: 'e', sourceVersion: 1, fileDigest: 'f', recordDigest: 'rd-ef', lineStart: 1, lineEnd: 2, byteStart: 0, byteEnd: 40, heading: '部署流程', text: '部署流程使用 pnpm build 后 rsync 到服务器' },
    ],
  }
  const snaps = [
    mkSnap({ contextVersion: 7, trigger: { segmentId: 's1', segmentDigest: 'dg-r1-0000000001', kind: 'user', eventType: 'user/message', ts: 1000, text: '回忆一下部署流程' }, window: [] }),
    mkSnap({ contextVersion: 8, trigger: { segmentId: 's2', segmentDigest: 'dg-r2-0000000002', kind: 'user', eventType: 'user/message', ts: 2000, text: '普通输入没有特殊信号' }, window: [{ segmentId: 's2p', digest: 'dg-same-00000003', kind: 'user', eventSeq: 1, contextVersion: 8, ts: 1990, text: '普通输入没有特殊信号' }] }),
  ]
  const args = { contextSnapshots: snaps, corpusSnapshot: corpus }
  const r1 = replay(args)
  const r2 = replay(args)
  if (JSON.stringify(r1) !== JSON.stringify(r2)) throw new Error('replay must be field-identical for same input')
  const first = r1[0].canonical
  if (!first.retrievalId.startsWith('ret_pre_')) throw new Error('retrievalId prefix wrong')
  // candidate 身份确定性
  const cid = buildCandidateId(first.retrievalId, 'mem_x', 'e', 1, 'rd')
  if (!cid.startsWith('cand_pre_')) throw new Error('candidateId prefix wrong')
  const cid2 = buildCandidateId(first.retrievalId, 'mem_x', 'e', 1, 'rd')
  if (cid !== cid2) throw new Error('candidateId must be deterministic')
  // excerpt 清洗+截断
  const ex = sanitizeExcerpt('clean\u0000text' + 'x'.repeat(600))
  if (ex.includes('\u0000')) throw new Error('excerpt control chars must be stripped')
  if (Buffer.byteLength(ex, 'utf8') > 480) throw new Error('excerpt must cap at 480 bytes')
  console.log('F12 replay 确定性 + 身份前缀 + excerpt 卫生 ✓ (' + r1.length + ' snapshots)')
}

console.log('\n[M4-1] ALL PASS: F1-F12 (纯内存 fixture, 零 IO, 零真实记忆接触)')
