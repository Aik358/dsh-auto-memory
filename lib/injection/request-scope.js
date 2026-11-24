/** Host request identity for the dynamic memory section. No disk, clock or transcript text parsing. */
export function isUserInput(message) {
  if (!message || typeof message !== 'object' || (message.role != null && message.role !== 'user')) return false;
  const source = message.source;
  if (source == null) return message.role === 'user'; // legacy user envelope
  return typeof source === 'string' ? source === 'user' : source.kind === 'user';
}

const isSequence = n => Number.isSafeInteger(n) && n >= 0;
const position = data => data && isSequence(data.turn) && isSequence(data.step) ? data.turn + ':' + data.step : '';

// Both assemblies follow the same turn/start or previous step/end. Stop at the actual
// boundary, even when hundreds of tool and notification events lie between it and the tail.
export function deliveryRequestScope(events) {
  let open, newestHuman, openHuman;
  let key = '';
  if (Array.isArray(events)) for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (!e) continue;
    if (e.type === 'step/end' || e.type === 'turn/start' || e.type === 'turn/end') {
      const prefix = e.type === 'step/end' ? 'e:' : e.type === 'turn/start' ? 't:' : 'closed:';
      if (isSequence(e.seq)) key = prefix + e.seq;
      return { key, position: position(open?.data), phase: open ? 'open' : 'proposal',
        human: e.type !== 'turn/end' && !!newestHuman, humanSeq: e.type !== 'turn/end' ? newestHuman?.seq ?? null : null };
    }
    if (e.type === 'step/start') {
      if (open) break;
      open = e;
      openHuman = newestHuman;
    } else if (!newestHuman && e.type === 'user/message' && isUserInput(e.data)) {
      newestHuman = e;
    }
  }
  return { key: open && isSequence(open.seq) ? 's:' + open.seq : '', position: position(open?.data),
    phase: open ? 'open' : 'unknown', human: !!openHuman, humanSeq: openHuman?.seq ?? null };
}

export function claimedHuman(scope, claim) {
  if (scope.phase === 'open' && scope.position && claim?.position === scope.position &&
      (!claim.key || !scope.key || claim.key === scope.key)) return claim.human === true;
  return scope.human === true;
}

// The first assembly only proposes a request. Returning the last retained text avoids both
// spending a grant and introducing a main-section change just to open an otherwise empty step.
export function retainedSection(events, name) {
  if (!Array.isArray(events)) return '';
  let replaced;
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (!e) continue;
    if (e.type === 'compaction/summary') return '';
    if (e.surfaceOp?.op === 'replace' && Array.isArray(e.sourceEventSeqs)) {
      replaced ??= new Set();
      for (const seq of e.sourceEventSeqs) replaced.add(seq);
    }
    const src = e.type === 'user/message' && e.data?.source;
    if (src?.kind === 'runtime-context' && src.form === 'snapshot') {
      if (replaced?.has(e.seq)) return '';
      const text = Array.isArray(src.sections) && src.sections.find(s => s?.name === name)?.text;
      return typeof text === 'string' ? text : '';
    }
  }
  return '';
}
