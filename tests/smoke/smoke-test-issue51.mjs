#!/usr/bin/env node
/** Issue #51: exercise the shipped ranker, not a copied filename predicate.
 * Real fs fixtures cover recovery/temporary/backup names and the caller's top-8
 * sampling boundary. No DSH installation, network, credentials or dependencies.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, writeFile, readFile, readdir, stat, utimes, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { rankWorkspacesByMemoryRecencyPre as rank } from '../../lib/ws-overview-rank.js'

const OLD = Date.parse('2026-08-20T12:00:00Z')
const REAL = Date.parse('2026-09-01T12:00:00Z')
const JUNK = Date.parse('2026-09-16T12:00:00Z')
const rejectedNames = [
  '.dam-failed-1789544804923-ada1e4e1-0b5c-4ae0-bde9-ae95b677e243-2026-09-16.md.tmp',
  '.dam-pre-tmp-ada1e4e1-2026-09-16.md',
  '.dam-pre-tmp-ada1e4e1-2026-09-16.md.tmp',
  '2026-09-16.md.tmp',
  '2026-09-16.tmp',
  '2026-09-16.md.bak',
  '2026-09-16.md~',
  'notes-2026-09-16.md',
  '2026-09-16-extra.md',
  '2026-09-16.MD',
  '2026-09-16.json',
  '2026-09-16.md.md',
  'x2026-09-16',
  '2026-09-16x',
  '2026-9-16.md',
  '2026-09-6.md',
  'MEMORY.md',
  '.dam-failed-1789544804923-ada1e4e1-MEMORY.md.tmp',
  'PLAN.md',
]

async function fixture(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dam-issue51-中文 space-'))
  const dirOf = (cwd) => path.join(root, cwd)
  async function put(cwd, name, time, text = '- fixture memory\n') {
    const dir = dirOf(cwd)
    await mkdir(dir, { recursive: true })
    const file = path.join(dir, name)
    await writeFile(file, text, 'utf8')
    await utimes(file, new Date(time), new Date(time))
    return file
  }
  try { await run({ dirOf, put }) }
  finally { await rm(root, { recursive: true, force: true }) }
}

for (const name of rejectedNames) {
  test('ignore non-log entry: ' + name, async () => fixture(async ({ dirOf, put }) => {
    await put('ws-real', '2026-08-20.md', REAL)
    const junk = await put('ws-junk', name, JUNK, 'RECOVERY-CANDIDATE-MUST-SURVIVE\n')
    const before = await readFile(junk)
    const touched = []
    const result = await rank(['ws-empty', 'ws-junk', 'ws-real'], dirOf, readdir, async (file) => {
      touched.push(file)
      return stat(file)
    })
    // An ignored entry must have exactly zero influence, not merely rank lower.
    assert.deepEqual(result, ['ws-real', 'ws-empty', 'ws-junk'])
    assert.deepEqual(touched, [path.join(dirOf('ws-real'), '2026-08-20.md')])
    assert.deepEqual(await readFile(junk), before, 'recovery/backup bytes are untouched')
  }))
}

for (const name of ['2026-09-16.md', '2026-09-16']) {
  test('preserve existing date-stem acceptance: ' + name, async () => fixture(async ({ dirOf, put }) => {
    await put('ws-old', '2026-08-20.md', OLD)
    await put('ws-active', name, REAL)
    assert.deepEqual(await rank(['ws-old', 'ws-active'], dirOf, readdir, stat), ['ws-active', 'ws-old'])
  }))
}

test('latest legitimate mtime wins, not lexicographically latest date', async () => fixture(async ({ dirOf, put }) => {
  await put('ws-edited', '2026-08-20.md', REAL)
  await put('ws-date-newer', '2026-09-16.md', OLD)
  assert.deepEqual(await rank(['ws-date-newer', 'ws-edited'], dirOf, readdir, stat), ['ws-edited', 'ws-date-newer'])
}))

test('take maximum legitimate mtime within a workspace', async () => fixture(async ({ dirOf, put }) => {
  await put('ws-many', '2026-08-20.md', JUNK)
  await put('ws-many', '2026-09-16.md', OLD)
  await put('ws-middle', '2026-09-01.md', REAL)
  assert.deepEqual(await rank(['ws-middle', 'ws-many'], dirOf, readdir, stat), ['ws-many', 'ws-middle'])
}))

test('new failed candidate cannot promote a workspace with only an old real log', async () => fixture(async ({ dirOf, put }) => {
  await put('ws-old', '2026-08-20.md', OLD)
  await put('ws-old', rejectedNames[0], JUNK)
  await put('ws-real', '2026-09-01.md', REAL)
  assert.deepEqual(await rank(['ws-old', 'ws-real'], dirOf, readdir, stat), ['ws-real', 'ws-old'])
}))

test('top 8 contain real workspaces even with 10 newer recovery-only workspaces', async () => fixture(async ({ dirOf, put }) => {
  const real = [], junk = []
  for (let i = 0; i < 10; i++) {
    real.push('real-' + i)
    junk.push('junk-' + i)
    await put(real[i], '2026-08-20.md', REAL + i * 10000)
    await put(junk[i], rejectedNames[i % 3], JUNK + i * 10000)
  }
  const input = Object.freeze([...junk, ...real])
  const before = [...input]
  const result = await rank(input, dirOf, readdir, stat)
  assert.deepEqual(result.slice(0, 8), [...real].reverse().slice(0, 8))
  assert.deepEqual(result.slice(0, 10), [...real].reverse())
  assert.deepEqual(result.slice(10), junk, 'zero-score ties preserve discovery order')
  assert.deepEqual([...result].sort(), [...input].sort(), 'no truncation or lost workspaces')
  assert.deepEqual(input, before, 'input array is not mutated')
}))

test('equal real mtimes retain original order, not a new alphabetical order', async () => fixture(async ({ dirOf, put }) => {
  await put('ws-z', '2026-09-16.md', REAL)
  await put('ws-a', '2026-09-16.md', REAL)
  const input = ['ws-z', 'ws-a', 'empty-z', 'empty-a']
  for (let i = 0; i < 3; i++) assert.deepEqual(await rank(input, dirOf, readdir, stat), input)
}))

test('reject junk before stat so its IO failure cannot hide a later real log', async () => fixture(async ({ dirOf, put }) => {
  await put('ws-real', '2026-09-16.md', REAL)
  const result = await rank(['ws-empty', 'ws-real'], dirOf,
    async (dir) => dir === dirOf('ws-real') ? [rejectedNames[0], '2026-09-16.md'] : [],
    async (file) => {
      assert.equal(path.basename(file), '2026-09-16.md', 'must not stat recovery candidate')
      return stat(file)
    })
  assert.deepEqual(result, ['ws-real', 'ws-empty'])
}))

test('missing directories and readdir/stat failures stay workspace-local', async () => fixture(async ({ dirOf, put }) => {
  await put('ws-real', '2026-09-16.md', REAL)
  const input = ['missing', 'bad-readdir', 'bad-stat', 'ws-real']
  const result = await rank(input, dirOf, async (dir) => {
    if (dir === dirOf('bad-readdir')) throw Object.assign(new Error('fixture'), { code: 'EACCES' })
    if (dir === dirOf('bad-stat')) return ['2026-09-16.md']
    return readdir(dir)
  }, stat)
  assert.deepEqual(result, ['ws-real', 'missing', 'bad-readdir', 'bad-stat'])
}))

test('empty/non-array inputs remain safe and never issue IO', async () => {
  const forbidden = () => { throw new Error('unexpected IO') }
  for (const input of [[], null, undefined, {}, 'ws-real']) {
    assert.deepEqual(await rank(input, forbidden, forbidden, forbidden), [])
  }
})
