// P1-⑮ 注入侧 0-1 相似度可见性(2026-09-14)。
// 动机:用户报告"注入里的 0-1 相似度排序怎么没了"——分值在 packet 里**存在**
// (references[].score 由 act.candidates[].score 落地),却在 renderReferenceTail 渲染时被丢弃,
// 注入文本只剩 Source/Reason/Reference 三行,看得到"要不要注入"、看不到"到底多像"。
// 本套件是可失败的验收(capability reachability):删掉 Score 行、写错排名、或漏计这几行的字节,
// 都必须报红——不允许"声明了就算过"。
process.on('uncaughtException', (e) => { console.error('[TAILSCORE-TEST] FATAL:', (e && (e.stack || e.message)) || e); process.exit(1) })
process.on('unhandledRejection', (r) => { console.error('[TAILSCORE-TEST] REJ:', r); process.exit(1) })

const { readFileSync } = await import('node:fs')
const A = await import('../../lib/activation-inbox.js')
let pass = 0; let fail = 0
function ok(cond, name) { if (cond) { pass++; console.log('  ok - ' + name) } else { fail++; console.error('  FAIL - ' + name) } }
function eq(a, b, name) { const ja = JSON.stringify(a); const jb = JSON.stringify(b); ok(ja === jb, name + (ja === jb ? '' : ' got=' + ja + ' want=' + jb)) }

const memA = 'mem_' + 'aa'.repeat(16)
const memB = 'mem_' + 'bb'.repeat(16)
const memC = 'mem_' + 'cc'.repeat(16)
const fd = 'e'.repeat(64)
function mkCand(mid, score, tag) {
  return {
    candidateId: 'cand_' + mid.slice(4, 10), memoryId: mid, anchorId: 'memory:' + mid,
    scope: 'Workspace', sourceRef: 'workspace:MEMORY.md', sourceEpoch: 'ep-1', sourceVersion: 2,
    fileDigest: fd, recordDigest: 'd'.repeat(63) + tag, score, excerpt: '参考正文 ' + tag,
  }
}
function mkReq(cands) {
  return {
    schemaVersion: 1, namespace: A.NAMESPACE, kind: 'activation_request',
    activationId: A.ACTIVATION_ID_PREFIX + 'ab'.repeat(16),
    observationId: 'obs_' + 'cd'.repeat(16),
    workerEpoch: 'worker-e1', sessionId: 'sess-9', agentId: 'agent-9', workspaceKey: 'd:/ws',
    scope: 'Workspace', contextVersion: 7,
    memoryIndexVersion: 'idx_' + 'ab'.repeat(16),
    threshold: { policyVersion: 'thr_v1', score: 0.91, threshold: 0.8, reason: 'fv2 lane=explicit emit intent=0.91 dense=0.88 margin=0.21 explicit_lane' },
    level: 'excerpt',
    candidates: cands,
    ttlSteps: 2, createdAt: 1700000000000, expiresAt: 1700000000120000,
  }
}

console.log('[S1] Score 行存在、格式为 0-1 两位小数')
const cands = [mkCand(memA, 0.91, 'a'), mkCand(memB, 0.72, 'b'), mkCand(memC, 0.54, 'c')]
const built = A.buildReferenceTailPacketPre({ request: mkReq(cands), triggerReason: 'explicit recall', nowStep: 100 })
ok(built.ok, 'packet 构建成功')
const text = built.rendered
ok(/(^|\n)Score: 0\.91 \(rank 1\/3\)\n/.test(text), '含 `Score: 0.91 (rank 1/3)`(能力可达:注入里看得见 0-1 分值)')
ok(/(^|\n)Score: 0\.72 \(rank 2\/3\)\n/.test(text), '含 `Score: 0.72 (rank 2/3)`')
ok(/(^|\n)Score: 0\.54 \(rank 3\/3\)\n/.test(text), '含 `Score: 0.54 (rank 3/3)`')
eq((text.match(/\nScore: /g) || []).length, 3, '每条引用恰好一个 Score 行')

console.log('[S2] 0-1 相似度**排序**=文档顺序降序、排名递增')
const scores = [...text.matchAll(/\nScore: ([0-9.]+) \(rank (\d+)\/(\d+)\)/g)].map((m) => ({ s: Number(m[1]), r: Number(m[2]), t: Number(m[3]) }))
eq(scores.map((x) => x.s), [0.91, 0.72, 0.54], '分值按文档顺序严格降序')
eq(scores.map((x) => x.r), [1, 2, 3], 'rank 从 1 递增')
eq(scores.map((x) => x.t), [3, 3, 3], 'rank 分母=批内条数')
// 乱序输入也必须被排序(否则"排序"是假象:入参恰好有序的测试是真空通过)
const shuffled = A.buildReferenceTailPacketPre({ request: mkReq([mkCand(memC, 0.54, 'c'), mkCand(memA, 0.91, 'a'), mkCand(memB, 0.72, 'b')]), triggerReason: 'x', nowStep: 100 })
ok(/Score: 0\.91 \(rank 1\/3\)[\s\S]*Score: 0\.72 \(rank 2\/3\)[\s\S]*Score: 0\.54 \(rank 3\/3\)/.test(shuffled.rendered), '乱序输入 → 渲染后仍为降序排名')

console.log('[S3] Score 行夹在 Reason 与 Reference 之间(固定边界契约不变)')
const block = text.split(A.TAIL_MARKER_LINE_V1)[1].split('\n').filter(Boolean)
eq(block.map((l) => l.split(':')[0]), ['Source', 'Reason', 'Score', 'Reference'], '块内四行顺序 = Source/Reason/Score/Reference')
ok(text.split('\n').filter((l) => l === A.TAIL_MARKER_LINE_V1).length === 3, '标记行仍每条一个(3 条)')
ok(text.endsWith(A.TAIL_VERIFY_LINE_V1), 'Verify 收尾行仍在末尾')

console.log('[S4] 分值非法 → 整行省略(与旧版逐字节一致的降级,不注入 NaN/undefined)')
const bare = A.renderReferenceTail([
  { memoryId: memA, scope: 'Workspace', sourceVersion: 1, recordDigest: 'd'.repeat(64), reference: '无分引用' },
], { reason: 'r', budgetBytes: 4096 })
ok(bare.ok, '裸 item 可渲染(向后兼容:无 score 字段)')
ok(!/Score:/.test(bare.text), '缺 score → 无 Score 行')
const nan = A.renderReferenceTail([
  { memoryId: memA, scope: 'Workspace', sourceVersion: 1, recordDigest: 'd'.repeat(64), score: NaN, reference: 'x' },
], { reason: 'r', budgetBytes: 4096 })
ok(!/Score:/.test(nan.text), 'NaN → 无 Score 行(不写 NaN)')
ok(!/undefined/.test(nan.text), '无 undefined 泄漏')

console.log('[S5] 字节预算把这些新行一并计价(不得静默超预算)')
const used = Buffer.byteLength(text, 'utf8')
eq(built.packet.budgetBytes, used, 'budgetBytes=实际渲染字节')
const tight = A.buildReferenceTailPacketPre({ request: mkReq(cands), triggerReason: 'x', nowStep: 100, budgetBytes: used - 1 })
ok(tight.ok && tight.rendered.length < text.length, '预算少 1 字节 → 至少丢一条(证明 Score 行计入成本)')
ok(Buffer.byteLength(tight.rendered, 'utf8') <= used - 1, '紧凑渲染不超预算')
ok(tight.droppedByBudget && tight.droppedByBudget.length >= 1, '被丢条目登记在 droppedByBudget')

console.log('[S6] 确定性 + exactDigest 自洽')
const again = A.buildReferenceTailPacketPre({ request: mkReq(cands), triggerReason: 'explicit recall', nowStep: 100 })
eq(again.rendered, text, '同输入两次渲染逐字节一致')
eq(built.packet.exactDigest, A.computeExactDigest(text), 'exactDigest=渲染文本 sha256')
eq(again.packet.packetId, built.packet.packetId, 'packetId 确定')

console.log('[S7] 接线可达性:注入 reason 串必须带 0-1 分值(JS 判定核路径)')
const jsHost = readFileSync(new URL('../../lib/context-host.js', import.meta.url), 'utf8')
ok(/js-decide lane=/.test(jsHost), 'context-host.js 仍构造 js-decide reason')
ok(/intent=' \+ num2\(/.test(jsHost) && /dense=' \+ num2\(/.test(jsHost) && /margin=' \+ num2\(/.test(jsHost), 'reason 串拼入 intent/dense/margin 数值')
ok(/reason: jsReason/.test(jsHost), 'threshold.reason 实际取用 jsReason(不是声明了却没接线)')
const pyHost = readFileSync(new URL('../../python/worker_semantic_v1.py', import.meta.url), 'utf8')
ok(/intent=%\.2f dense=%\.2f margin=%\.2f/.test(pyHost), 'Python fv2 reason 串拼入 intent/dense/margin')
ok(pyHost.indexOf('intent=%.2f') < pyHost.indexOf('reasons))[:160'), '数值段在 reasonCodes 之前(160 字符截断只砍代码列表)')

const src = readFileSync(new URL('../../lib/activation-inbox.js', import.meta.url), 'utf8')
ok(!src.includes('\uFEFF'), '源文件无 BOM')

console.log('\n[tail-score-visible-pre] pass=' + pass + ' fail=' + fail)
process.exit(fail ? 1 : 0)
