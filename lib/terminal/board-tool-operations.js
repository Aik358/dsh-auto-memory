import { EVENT_CONFIDENCES, EVENT_KINDS, EVENT_STATUSES, PANEL_KINDS, PERCEPT_STAGES, eventRevisionPre } from '../event-store.js'
import { ContractError, arrayOf, boolean, integer, object, oneOfValues, string, text } from './contract.js'

const id = { type: 'string', pattern: '^evt_[0-9a-f]{8}$' }
const revision = { type: 'string', pattern: '^[0-9a-f]{64}$' }
const nonBlank = { ...text, pattern: '\\S' }
const nullableString = { type: ['string', 'null'] }
const timestamp = integer(0, 8_640_000_000_000_000)
const sourceLine = integer(1, Number.MAX_SAFE_INTEGER)
const quote = { ...string, maxLength: 4000 }
const fingerprint = { type: 'string', pattern: '^(?:sha256:)?[0-9a-f]{64}$' }
const sections = object({ goal: string, doing: string, deadend: string, next: string })
const perceptionFields = { at: timestamp, sourceRef: nullableString }
const userPercept = object({
  ...perceptionFields, kind: { ...text, description: 'For example, preference, state, unfinished-goal or authorResponse.' },
  stage: { ...oneOfValues(...PERCEPT_STAGES), default: 'mentioned' }, text: string,
}, ['kind', 'text'])
const commitment = object({
  ...perceptionFields, promise: string, boundary: nullableString,
  state: { ...oneOfValues('open', 'kept', 'dropped'), default: 'open' },
}, ['promise'])

const checkpoint = {
  ...object({
    at: timestamp,
    kind: { ...nonBlank, default: 'log' },
    text: string,
    sourceRef: nullableString,
    panels: arrayOf(object({ kind: oneOfValues(...PANEL_KINDS), text: string }, ['kind', 'text'])),
    idemKey: nonBlank,
    goal: quote,
    state: quote,
    dead: quote,
    next: quote,
    quoteRef: quote,
    quoteLine: sourceLine,
    rel: { ...nonBlank, description: 'Relative path to the source document.' },
    bytes: integer(0, Number.MAX_SAFE_INTEGER),
    sha256: fingerprint,
    rawSha256: fingerprint,
    normalizedSha256: fingerprint,
    date: string,
    time: string,
  }),
  minProperties: 1,
}

const common = {
  name: { ...nonBlank, maxLength: 80 },
  summary: { ...string, maxLength: 400 },
  sections,
  skillRef: nullableString,
  startMs: timestamp,
  endMs: timestamp,
  members: { ...arrayOf(string), maxItems: 500 },
  rationale: { ...string, maxLength: 600 },
  kind: oneOfValues(...EVENT_KINDS),
  confidence: oneOfValues(...EVENT_CONFIDENCES),
  outcomes: { ...arrayOf(string), maxItems: 50 },
  skills: arrayOf(string),
}
const target = {
  eventId: id,
  expectedRevision: { ...revision, description: 'Revision from board.events.detail or the last successful event write.' },
}
const targetRequired = Object.keys(target)
const resultSchema = object({ eventId: id, revision, message: text }, ['eventId', 'revision', 'message'])
const setSchema = {
  ...object({
    ...target,
    ...common,
    sections: { ...sections, minProperties: 1 },
    outcome: nullableString,
    status: oneOfValues(...EVENT_STATUSES),
    pausedReason: nullableString,
  }, targetRequired),
  minProperties: targetRequired.length + 1,
  // The store also checks required outcome/reason against the full post-update event.
  allOf: [
    { if: { required: ['status'], properties: { status: { const: 'paused' } } },
      then: { properties: { pausedReason: nonBlank } } },
    { if: { required: ['status'], properties: { status: { const: 'active' } } },
      then: { properties: { pausedReason: { type: 'null' } } } },
    { if: { required: ['status'], properties: { status: { const: 'closed' } } },
      then: { properties: { outcome: nonBlank } } },
  ],
}
const appendFields = {
  checkpoint,
  constraint: nonBlank,
  userPercept,
  agentTrace: object({ ...perceptionFields, action: string, result: nullableString, wasRefuted: boolean }, ['action']),
  sharedGround: object({ ...perceptionFields, claim: string, confirmedBy: nullableString, correction: nullableString }, ['claim']),
  commitment,
}
const appendSchema = {
  ...object({ ...target, ...appendFields, quoteRef: quote, quoteLine: sourceLine }, targetRequired),
  anyOf: Object.keys(appendFields).map(field => ({ required: [field] })),
  dependentRequired: { quoteRef: ['checkpoint'], quoteLine: ['checkpoint'] },
}

export function boardEventStoreOptions(replay) {
  if (!replay?.terminalEventReceipt) return undefined
  return { expectedRevision: replay.terminalExpectedEventRevision, receipt: replay.terminalEventReceipt }
}

export function projectBoardEventDetail(detail) {
  if (!detail?.event) return detail
  return { ...detail, revision: eventRevisionPre(detail.event) }
}

async function executeEventAction(action, { expectedRevision, quoteRef, quoteLine, ...fields }, ctx) {
  const replay = { terminalExpectedEventRevision: expectedRevision, terminalEventReceipt: {}, terminalEventScope: ctx.scope }
  const args = { ...fields, action }
  if (args.checkpoint && (quoteRef !== undefined || quoteLine !== undefined)) {
    args.checkpoint = {
      ...(quoteRef !== undefined ? { quoteRef } : {}),
      ...(quoteLine !== undefined ? { quoteLine } : {}),
      ...args.checkpoint,
    }
  }
  const message = await ctx.tool('memory_event', args, replay)
  const { eventId, revision, error } = replay.terminalEventReceipt
  if (eventId) return { eventId, revision, message }
  if (error?.code === 'event-not-found') throw new ContractError(error.code, error.message, 404)
  if (['event-version-conflict', 'event-upgrade-running', 'workspace-mismatch'].includes(error?.code)) {
    throw new ContractError(error.code, error.message, 409)
  }
  if (error?.code === 'invalid-event-revision') throw new ContractError(error.code, error.message)
  throw new ContractError('event-write-rejected', message, 409)
}

export function boardToolOperations(operation) {
  const definitions = [
    ['create', 'Create a whiteboard event', object({
      ...common, constraints: arrayOf(string), ordinal: integer(Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER),
    }, ['name'])],
    ['set', 'Edit the current revision of an event', setSchema],
    ['append', 'Append a checkpoint, constraint or observation', appendSchema],
    ['close', 'Close an event with its outcome', object({ ...target, outcome: nonBlank }, [...targetRequired, 'outcome'])],
    ['rename', 'Rename an event', object({ ...target, name: common.name }, [...targetRequired, 'name'])],
  ]
  return definitions.map(([action, title, inputSchema]) => operation(
    'board.events.' + action, title, 'board', 'session', 'write', inputSchema, resultSchema,
    (args, ctx) => executeEventAction(action, args, ctx), { kind: 'tool', key: 'memory_event' },
  ))
}
