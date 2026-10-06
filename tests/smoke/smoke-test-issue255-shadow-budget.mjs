/** #255: production shadow ranking, full-corpus conflict visibility and existing budgets. */
import assert from 'node:assert/strict'
import { test, after } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const sandbox = await mkdtemp(path.join(tmpdir(), 'shadow255-'))
const savedEnv = Object.fromEntries(['HOME', 'USERPROFILE', 'DSH_HOME'].map(k => [k, process.env[k]]))
for (const key of Object.keys(savedEnv)) process.env[key] = path.join(sandbox, key)
after(async () => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  await rm(sandbox, { recursive: true, force: true })
})
const root = path.resolve(process.env.AUDIT_SOURCE_ROOT || fileURLToPath(new URL('../../', import.meta.url)))
const { lexicalSearch, SHADOW_LEXICAL_BUDGET_PRE_V1: budget } = await import(pathToFileURL(path.join(root, 'lib/shadow-retrieval.js')).href)
const id = n => 'mem_' + n.toString(16).padStart(32, '0')
const record = (n, patch = {}) => ({ memoryId: id(n), text: 'alpha ' + Array(60).fill('filler').join(' ') + ' item' + n,
  heading: 'noise', recordDigest: n.toString(16).padStart(64, '0'), bytes: 435,
  scope: 'User', sourceRef: 'user:MEMORY.md', sourceEpoch: 'e1', sourceVersion: 1,
  lineStart: n, byteStart: n * 500, ...patch })
const low = Array.from({ length: 64 }, (_, i) => record(i + 1))
const target = record(65, { text: 'alpha', heading: 'alpha', bytes: 5,
  scope: 'Workspace', sourceRef: 'workspace:MEMORY.md', sourceEpoch: 'e2' })
const corpus = records => ({ sources: [{ sourceRef: 'user:MEMORY.md' }, { sourceRef: 'workspace:MEMORY.md' }], records })
const query = { terms: [{ term: 'alpha', weight: 1 }], phrases: ['alpha'] }
const search = records => lexicalSearch(corpus(records), query, { triggerTs: 1791345600000 })
test('higher-score 65th workspace hit survives; raw and kept are permutation independent', () => {
  const late = search([...low, target])
  assert.equal(late.kept[0].memoryId, target.memoryId)
  assert.equal(late.rawHits.length, 64)
  assert.equal(late.kept.length, 8)
  for (const records of [[target, ...low], [...low, target].reverse(), [...low.slice(25), target, ...low.slice(0, 25)]]) {
    const result = search(records)
    assert.deepEqual(result.rawHits, late.rawHits)
    assert.deepEqual(result.kept, late.kept)
  }
})
test('same-ID conflicting tail is rejected even when tail has no lexical match', () => {
  const match = record(200, { text: 'alpha', heading: 'alpha', bytes: 5 })
  for (const text of ['alpha', 'unrelated-content']) {
    const conflict = { ...match, text, heading: 'other', recordDigest: 'f'.repeat(64) }
    for (const records of [[match, ...low, conflict], [conflict, ...low, match]]) {
      const result = search(records)
      assert(!result.rawHits.some(r => r.memoryId === match.memoryId))
      assert(!result.kept.some(r => r.memoryId === match.memoryId))
      assert(result.dropped.some(d => d.memoryId === match.memoryId && d.reason === 'index-conflict'))
    }
  }
})
test('same-digest duplicates choose ranked provenance and never consume budget before ranking', () => {
  const user = record(80, { text: 'alpha', heading: 'alpha', bytes: 5 })
  const workspace = { ...user, scope: 'Workspace', sourceRef: 'workspace:MEMORY.md', sourceEpoch: 'e2' }
  const first = search([user, ...low, workspace])
  const reverse = search([workspace, ...low, user])
  assert.deepEqual(first.kept, reverse.kept)
  assert.equal(first.kept[0].scope, 'Workspace')
  assert.equal(first.rawHits.filter(r => r.memoryId === user.memoryId).length, 1)
  const otherId = { ...workspace, memoryId: id(81) }
  const dedupe = search([otherId, ...low, workspace])
  assert.equal(dedupe.kept.filter(r => r.recordDigest === workspace.recordDigest).length, 1)
})
test('existing score contract and 512 corpus / 64 raw / 8 kept budgets remain', () => {
  const single = search([record(1, { text: 'alpha', heading: 'alpha', bytes: 5 })])
  assert.equal(single.kept[0].scores.termCoverage, 0.4545454545454546)
  assert.equal(single.kept[0].scores.headingCoverage, 0.4545454545454546)
  assert.equal(single.kept[0].scores.total, 0.5004545454545455)
  const atLimit = search(Array.from({ length: 512 }, (_, i) => record(i + 1)))
  assert.equal(atLimit.rawHits.length, budget.rawHits)
  assert.equal(atLimit.kept.length, budget.rankedKept)
  const over = search(Array.from({ length: 513 }, (_, i) => record(i + 1)))
  assert.equal(over.kept.length, 0)
  assert.equal(over.dropped[0].reason, 'record-budget')
})
