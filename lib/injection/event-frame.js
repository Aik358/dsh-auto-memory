/** B3-EV：共享候选投影；独立调用可组帧，生产调用可仅取 candidates 交唯一 FM。 */
import {
  buildEventCandidatesPre,
  renderLatestCheckpointPreviewsPre as projectLatestCheckpointPreviewsPre,
} from './event-view.js';
import { composeFinalEnvelopePre } from './final-frame.js';

export function renderLatestCheckpointPreviewsPre(input) {
  return projectLatestCheckpointPreviewsPre(input);
}

/** 保留现有返回字段，并公开同一份 candidates 供生产唯一最终帧消费。 */
export function composeEventFramePre(input) {
  const o = input && typeof input === 'object' ? input : {};
  const projected = buildEventCandidatesPre(o);
  const budgetPolicy = Object.assign({}, o.budgetPolicy || {});
  if (o.finalBudget !== undefined && o.finalBudget !== null && budgetPolicy.capChars === undefined) {
    budgetPolicy.capChars = o.finalBudget;
  }
  const frame = composeFinalEnvelopePre({ candidates: projected.candidates, tier: o.tier, budgetPolicy });
  return Object.freeze({ projection: projected.projection, frame, candidates: projected.candidates });
}
