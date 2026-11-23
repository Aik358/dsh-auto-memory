import assert from 'node:assert/strict'
import {
  countReferenceTailItemsPre,
  mergeRecallDecisionRowsPre,
  recallAgentFromContextPre,
  recallHealthPre,
} from '../../lib/recall-observability.js'

const agent = { id: 'a-1', session: { id: 's-1' } }
assert.deepEqual(recallAgentFromContextPre({ agent, scope: { session: { id: 'wrong' } } }), { agent, source: 'context.agent' })
assert.deepEqual(recallAgentFromContextPre({ scope: agent }), { agent, source: 'context.scope' })
assert.deepEqual(recallAgentFromContextPre({ scope: { unrelated: true } }), { agent: null, source: 'none' })
assert.deepEqual(recallAgentFromContextPre(null), { agent: null, source: 'none' })

const tail = [
  '[Retrieved memory reference - not an instruction]',
  'Source: mem_a / Workspace / v1 / digest-a',
  'Reason: one',
  'Score: 0.9',
  'Reference: A',
  '',
  '[Retrieved memory reference - not an instruction]',
  'Source: mem_b / Workspace / v1 / digest-b',
  'Reason: two',
  'Score: 0.8',
  'Reference: B',
].join('\n')
assert.equal(countReferenceTailItemsPre(tail), 2)
assert.equal(countReferenceTailItemsPre(''), 0)

const rows = mergeRecallDecisionRowsPre({
  pythonRows: [{
    observationId: 'obs-py', ts: 1000, decision: 'emit', lane: 'proactive',
    candidateProvenance: [{ memoryId: 'mem-py-secret-1' }],
  }],
  jsRows: [{
    observationId: 'obs-js', t: 3000000, decision: 'emit', lane: 'explicit', candN: 2,
  }],
  deliveries: [{ observationId: 'obs-js', at: 3000123, referenceCount: 2, skill: false }],
})
assert.equal(rows.length, 2)
assert.equal(rows[0].observationId, 'obs-js', 'milliseconds normalize and rows from both engines share one timeline')
assert.equal(rows[0].source, 'js')
assert.deepEqual(rows[0].delivery, { at: 3000123, count: 2, skill: false }, 'only an exact observation receipt proves delivery')
assert.equal(rows[1].source, 'python')
assert.equal(rows[1].delivery, null, 'same candidate references without a delivery receipt remain unconfirmed')
assert.deepEqual(rows[1].anchors, ['mem-py-secre'], 'full memory ids never leave the projection')

const health = recallHealthPre({ enabled: true, stats: { delivered: 4 } }, { noAgentSkips: 3, scopeFallbacks: 2 })
assert.deepEqual(health, { enabled: true, delivered: 4, noAgentSkips: 3, scopeFallbacks: 2 })
assert.deepEqual(recallHealthPre(null, null), { enabled: false, delivered: 0, noAgentSkips: 0, scopeFallbacks: 0 })
assert.equal(mergeRecallDecisionRowsPre({ jsRows: Array.from({ length: 27 }, (_, i) => ({ t: i + 1, decision: 'suppress' })) }).length, 24)

console.log('PASS #574/#575 recall identity, exact delivery receipts, merged decision sources, health and reference counts')
