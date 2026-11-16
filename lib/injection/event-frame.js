/** B3-EV：多检查点最新优先预览，以及事件投影到 FM 的唯一预算适配。 */
import { renderCheckpointPreviewPre, selectEventProjectionPre } from './event-view.js';
import { composeFinalEnvelopePre } from './final-frame.js';

export function renderLatestCheckpointPreviewsPre(input) {
  const list = Array.isArray(input && input.checkpoints) ? input.checkpoints : [];
  const sorted = list.map((cp, index) => ({ cp, index })).sort((a, b) => {
    const at = Number(b.cp && (b.cp.at ?? b.cp.updatedAt)) || 0;
    const bt = Number(a.cp && (a.cp.at ?? a.cp.updatedAt)) || 0;
    return at - bt || b.index - a.index;
  });
  return Object.freeze(sorted.map(({ cp }, rank) => Object.freeze({
    rank,
    preview: renderCheckpointPreviewPre({ checkpoint: cp, budget: input.budget, sourceRef: input.sourceRef }),
  })));
}

/** 事件选择与预览只产生候选，最终预算/计量由FM统一负责。 */
export function composeEventFramePre(input) {
  const projection = selectEventProjectionPre(input);
  const candidates = [];
  for (const card of projection.cards) {
    const lines = ['[' + card.id + '] ' + card.name + ' · ' + card.label];
    for (const section of card.sections) lines.push(section.title + '：' + section.text);
    const event = (input.events || []).find((ev) => ev.id === card.id);
    const previews = renderLatestCheckpointPreviewsPre({ checkpoints: event && event.checkpoints, budget: input.checkpointBudget });
    for (const cp of previews) lines.push(cp.preview.text);
    candidates.push({ id: card.id, kind: 'body', bucket: 'event-cards', priority: Number(input.eventPriority) || 0, text: lines.join('\n') });
  }
  if (projection.catalog.length) {
    candidates.push({ id: 'event-catalog', kind: 'body', bucket: 'event-catalog', priority: Number(input.catalogPriority) || 0,
      text: projection.catalog.map((item) => '- ' + item.name + '（' + item.id + '）· ' + item.label).join('\n') });
  }
  const budgetPolicy = Object.assign({}, input.budgetPolicy || {});
  if (input.finalBudget !== undefined && input.finalBudget !== null && budgetPolicy.capChars === undefined) budgetPolicy.capChars = input.finalBudget;
  const frame = composeFinalEnvelopePre({ candidates, tier: input.tier, budgetPolicy });
  return Object.freeze({ projection, frame });
}
