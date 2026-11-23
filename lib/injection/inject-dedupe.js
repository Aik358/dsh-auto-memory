import { computeExactDigest } from '../activation-inbox.js'

export function normalizeDeliveryBodyPre(text) {
  return text.replace(/\r\n/g, '\n').trim()
}

/** Map full, admitted ledger bodies to their owners without matching markup or prefixes. */
export function ledgerBodyCoveragePre(bodies) {
  const fingerprints = new Set()
  for (const body of bodies) {
    for (const paragraph of new Set([body, ...body.split(/\n[^\S\n]*\n/)])) {
      const text = normalizeDeliveryBodyPre(paragraph)
      if (!text || /^type:(?:goal|progress|dead-end|state)$/u.test(text)) continue
      fingerprints.add(computeExactDigest(text))
    }
  }
  return (body) => fingerprints.has(computeExactDigest(normalizeDeliveryBodyPre(body)))
}

/** Use the authored field boundaries to preserve neighboring checkpoint fields. */
export function removeCoveredCheckpointFieldsPre(text, fields, covers) {
  if (fields === null) return text
  if (!fields) return covers(text) ? '' : text
  return fields.filter(({ bodyStart, end }) => !covers(text.slice(bodyStart, end)))
    .map(({ start, end }) => text.slice(start, end)).join('\n')
}
