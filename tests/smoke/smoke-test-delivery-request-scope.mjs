import assert from 'node:assert/strict';
import test from 'node:test';
import { claimedHuman, deliveryRequestScope, isUserInput, retainedSection } from '../../lib/injection/request-scope.js';

const event = (seq, type, data = {}) => ({ seq, type, data });
const ref = 'dsh:auto-memory-pre';
const turn = event(1, 'turn/start', { turn: 1 });
const first = event(2, 'step/start', { turn: 1, step: 1 });
const user = event(3, 'user/message', { role: 'user', source: { kind: 'user' } });
const end = event(4, 'step/end', { turn: 1, step: 1 });
const next = event(5, 'step/start', { turn: 1, step: 2 });

test('one boundary key spans proposal and admission but never a later step or turn', () => {
  const a = deliveryRequestScope([turn]);
  const b = deliveryRequestScope([turn, first, user]);
  assert.equal(a.phase, 'proposal');
  assert.equal(b.phase, 'open');
  assert.equal(a.key, b.key);
  assert.equal(b.humanSeq, 3);
  const c = deliveryRequestScope([turn, first, user, end, next]);
  assert.notEqual(b.key, c.key);
  assert.equal(c.humanSeq, null);
  assert(!claimedHuman(c, { ...b, human: true }));
  assert(claimedHuman(c, { ...c, human: true }));
  assert(!claimedHuman(c, { ...c, position: b.position, human: true }));
  const d = deliveryRequestScope([turn, first, user, end, event(7, 'turn/start', { turn: 2 })]);
  assert.notEqual(c.key, d.key);
});

test('only user messages from the current scope provide input evidence', () => {
  assert(isUserInput({ role: 'user' }));
  assert(isUserInput({ role: 'user', source: 'user' }));
  for (const source of ['agent-message', 'runtime-context', 'tool', 'time-context']) {
    assert(!isUserInput({ role: 'user', source: { kind: source } }));
  }
  assert(!isUserInput({ role: 'assistant', source: { kind: 'user' } }));
  assert(!deliveryRequestScope([turn, first, user, end]).human);
  assert(!deliveryRequestScope([first, user, next]).human);
  assert(!deliveryRequestScope([]).human);
});

test('the proposal keeps only the most recent retained named section', () => {
  const snapshot = (seq, sections) => event(seq, 'user/message', { source: { kind: 'runtime-context', form: 'snapshot', sections } });
  const older = snapshot(8, [{ name: ref, text: 'v1' }]);
  const newer = snapshot(9, [{ name: 'm6', text: 'independent tail' }, { name: ref, text: 'v2' }]);
  assert.equal(retainedSection([older, newer, event(10, 'tool/result', { text: ref })], ref), 'v2');
  assert.equal(retainedSection([older, newer, snapshot(11, [{ name: 'm6', text: 'tail only' }])], ref), '');
  assert.equal(retainedSection([newer, { ...event(12, 'user/message'), surfaceOp: { op: 'replace' }, sourceEventSeqs: [9] }], ref), '');
  assert.equal(retainedSection([older, event(12, 'compaction/summary')], ref), '');
});
