import assert from 'node:assert/strict';
import { renderLatestCheckpointPreviewsPre, composeEventFramePre } from '../../lib/injection/event-frame.js';
const checkpoints = [
  { at: 100, goal: '旧', state: '旧状态', dead: '旧失败', next: '旧下一步', text: '旧检查点' },
  { at: 200, goal: '新', state: '新状态', dead: '新失败', next: '新下一步', text: '新检查点' },
];
const latest = renderLatestCheckpointPreviewsPre({ checkpoints, budget: { capChars: 30 } });
assert.equal(latest.length, 2); assert.equal(latest[0].preview.text.includes('新检查点'), true);
const events = [
  { id: 'evt_new', name: '新事件', status: 'active', updatedAt: 200, sections: { goal: 'g', doing: 'd', deadend: 'x', next: 'n' }, checkpoints },
  { id: 'evt_old', name: '旧事件', status: 'paused', updatedAt: 100, sections: {} },
];
const { projection, frame } = composeEventFramePre({ events, activeLimit: 1, catalogChars: 80, finalBudget: 60, budgetPolicy: { mode: 'hard', separator: '\n' }, eventPriority: 50 });
assert.equal(projection.cards.length, 1);
assert.equal(frame.text.length, frame.chars.total);
assert.equal(frame.chars.total <= 60, true);
assert.equal(Object.values(frame.chars.byBucket).reduce((a,b)=>a+b,0), frame.chars.total);
assert.equal(frame.text.includes('旧事件'), false);
console.log('PASS latest checkpoints + event projection through final frame');
