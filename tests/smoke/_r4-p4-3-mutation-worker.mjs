import assert from 'node:assert/strict'
import { createP43Fixture, makeP43Engine, updateP43Document, P43_MUTATION_ROOT, P43_DOC_ID } from './_r4-p4-3-fixtures.mjs'
import * as fs from 'node:fs/promises'
import path from 'node:path'

const caseName = process.argv[2] || 'clean'
const fixture = await createP43Fixture('worker-' + caseName, { base: path.join(P43_MUTATION_ROOT, 'cases') })
const engine = await makeP43Engine(fixture)
const detect = () => engine.external.briefDetectSyncPre()

try {
  if (caseName === 'brief-revision-not-updated') {
    assert.equal(detect(), '')
    const updated = await updateP43Document(fixture, 'mutant must miss this revision', { preserveMtime: true })
    const text = detect()
    const snapshot = engine._briefSnapshots.get(engine.wsKey(engine.state.ws))
    assert.ok(text.includes(P43_DOC_ID), 'brief did not expose the document ID')
    assert.equal(snapshot.changed[0]?.revision, updated.revision, 'brief did not expose the new revision')
    assert.equal(snapshot.maintenanceDocuments[0]?.revision, updated.revision, 'snapshot revision stayed stale')
  } else if (caseName === 'mtime-only-false-positive') {
    assert.equal(detect(), '')
    const file = path.join(fixture.documentsDir, P43_DOC_ID + '.md')
    const stat = await fs.stat(file)
    await fs.utimes(file, stat.atime, new Date(stat.mtimeMs + 9000))
    assert.equal(detect(), '', 'mtime-only change produced an external-change brief')
  } else if (caseName === 'maintenance-listed-as-legacy') {
    const result = await engine.listUnarchivedPre({ paths: { handoffDir: fixture.handoffDir }, limit: 50 })
    assert.equal(result.maintenanceDocuments.length, 1)
    assert.equal(result.items.length, 1)
    assert.ok(result.items.every((item) => item.name !== P43_DOC_ID + '.md' && !item.rel.includes('/documents/')), 'maintenance document entered legacy candidates')
  } else if (caseName === 'clean') {
    assert.equal(detect(), '')
    const file = path.join(fixture.documentsDir, P43_DOC_ID + '.md')
    const stat = await fs.stat(file)
    await fs.utimes(file, stat.atime, new Date(stat.mtimeMs + 9000))
    assert.equal(detect(), '')
    const updated = await updateP43Document(fixture, 'clean external revision', { preserveMtime: true })
    const text = detect()
    const snapshot = engine._briefSnapshots.get(engine.wsKey(engine.state.ws))
    assert.ok(text.includes(P43_DOC_ID))
    assert.equal(snapshot.changed[0]?.revision, updated.revision)
    assert.equal(snapshot.maintenanceDocuments[0]?.revision, updated.revision)
    const result = await engine.listUnarchivedPre({ paths: { handoffDir: fixture.handoffDir }, limit: 50 })
    assert.equal(result.maintenanceDocuments.length, 1)
    assert.equal(result.items.length, 1)
    assert.ok(result.items.every((item) => item.name !== P43_DOC_ID + '.md' && !item.rel.includes('/documents/')))
  } else throw new Error('unknown mutation case: ' + caseName)
  if (caseName === 'clean') console.log('CLEAN_GREEN')
  else console.log('UNEXPECTED_GREEN ' + caseName)
} catch (error) {
  console.log('EXPECTED_RED ' + caseName + ' :: ' + error.message)
  process.exitCode = 2
}
