const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

export function recallAgentFromContextPre(context) {
  if (!isRecord(context)) return { agent: null, source: 'none' }
  if (isRecord(context.agent)) return { agent: context.agent, source: 'context.agent' }
  if (isRecord(context.scope) && isRecord(context.scope.session)) {
    return { agent: context.scope, source: 'context.scope' }
  }
  return { agent: null, source: 'none' }
}

export function countReferenceTailItemsPre(text) {
  return (String(text || '').match(/^\s*Source:\s/gm) || []).length
}

function normalizeDecisionRow(row, source) {
  if (!isRecord(row)) return null
  const features = isRecord(row.features) ? row.features : {}
  const rawTime = Number(source === 'js' ? row.t : row.ts)
  if (!Number.isFinite(rawTime)) return null
  const ts = rawTime > 1e12 ? rawTime / 1000 : rawTime
  const provenance = Array.isArray(row.candidateProvenance) ? row.candidateProvenance : []
  const reasonCodes = Array.isArray(row.reasonCodes) ? row.reasonCodes.filter((x) => typeof x === 'string').slice(0, 6) : []
  return {
    observationId: typeof row.observationId === 'string' ? row.observationId : '',
    source,
    decision: typeof row.decision === 'string' ? row.decision : null,
    reasonCodes,
    lane: typeof row.lane === 'string' ? row.lane : (typeof features.lane === 'string' ? features.lane : null),
    intentProb: Number.isFinite(Number(row.intentProb ?? features.intentProb)) ? Number(row.intentProb ?? features.intentProb) : null,
    margin: Number.isFinite(Number(row.margin ?? row._margin ?? features.margin)) ? Number(row.margin ?? row._margin ?? features.margin) : null,
    candidateHit: typeof row.candidateHit === 'boolean' ? row.candidateHit : (typeof row.hit === 'boolean' ? row.hit : null),
    maxLexRaw: Number.isFinite(Number(row.maxLexRaw ?? row.denseTop)) ? Number(row.maxLexRaw ?? row.denseTop) : null,
    memoryRefCount: provenance.length || (Number.isSafeInteger(row.candN) && row.candN >= 0 ? row.candN : null),
    anchors: provenance.slice(0, 3).map((entry) => entry && entry.memoryId ? String(entry.memoryId).slice(0, 12) : null).filter(Boolean),
    queryChars: Number.isSafeInteger(row.queryChars) && row.queryChars >= 0 ? row.queryChars : null,
    ts,
  }
}

export function mergeRecallDecisionRowsPre(input = {}) {
  const o = isRecord(input) ? input : {}
  const rows = []
  for (const row of Array.isArray(o.pythonRows) ? o.pythonRows : []) {
    const normalized = normalizeDecisionRow(row, 'python')
    if (normalized) rows.push(normalized)
  }
  for (const row of Array.isArray(o.jsRows) ? o.jsRows : []) {
    const normalized = normalizeDecisionRow(row, 'js')
    if (normalized) rows.push(normalized)
  }

  const receipts = new Map()
  for (const receipt of Array.isArray(o.deliveries) ? o.deliveries : []) {
    if (!isRecord(receipt) || typeof receipt.observationId !== 'string' || !receipt.observationId) continue
    receipts.set(receipt.observationId, receipt)
  }
  for (const row of rows) {
    const receipt = row.observationId ? receipts.get(row.observationId) : null
    row.delivery = receipt ? {
      at: Number.isFinite(Number(receipt.at)) ? Number(receipt.at) : null,
      count: Number.isSafeInteger(receipt.referenceCount) && receipt.referenceCount >= 0 ? receipt.referenceCount : null,
      skill: receipt.skill === true,
    } : null
  }
  rows.sort((a, b) => b.ts - a.ts || a.source.localeCompare(b.source))
  const requestedLimit = Number(o.limit)
  const limit = Number.isSafeInteger(requestedLimit) ? Math.max(1, Math.min(requestedLimit, 100)) : 24
  return rows.slice(0, limit)
}

export function recallHealthPre(activationView, tailSurface) {
  const activation = isRecord(activationView) ? activationView : {}
  const tail = isRecord(tailSurface) ? tailSurface : {}
  const stats = isRecord(activation.stats) ? activation.stats : {}
  return {
    enabled: activation.enabled === true,
    delivered: Number.isSafeInteger(stats.delivered) && stats.delivered >= 0 ? stats.delivered : 0,
    noAgentSkips: Number.isSafeInteger(tail.noAgentSkips) && tail.noAgentSkips >= 0 ? tail.noAgentSkips : 0,
    scopeFallbacks: Number.isSafeInteger(tail.scopeFallbacks) && tail.scopeFallbacks >= 0 ? tail.scopeFallbacks : 0,
  }
}
