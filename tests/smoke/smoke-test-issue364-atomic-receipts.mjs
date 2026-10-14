import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { createHubIoPre } from '../../lib/hub-io.js'
import { createFactStorePre } from '../../lib/fact-store.js'

const root = fs.mkdtempSync(path.join(tmpdir(), 'dam-364-receipts-'))
try {
  let denied = false
  const io = createHubIoPre({ dir: root, fsApi: { renameSync: (from, to) => { if (denied) throw Object.assign(Error('fixture rename denied'), { code: 'EPERM' }); fs.renameSync(from, to) } } })
  const store = createFactStorePre({ io: io('facts.json') })
  const candidate = object => ({ scope: 'Workspace', subject: 'receipt project', predicate: 'uses', object, sourceKind: 'explicit', provenance: ['fixture'] })
  const context = { teamId: 'team-fixture', cursor: 10, index: 0 }
  const event = { eventId: 'conflict-event-364' }
  assert.equal(store.upsert(candidate('Node.js')).ok, true)
  const file = path.join(root, 'facts.json'), before = fs.readFileSync(file, 'utf8')
  denied = true
  assert.equal(store.applyTeamChange(candidate('Python'), event, context).ok, false)
  assert.equal(fs.readFileSync(file, 'utf8'), before); assert.equal(store.pendingConflicts().length, 0)
  assert.equal(Object.keys(store.snapshot().teamReceipts).length, 0)
  denied = false
  assert.equal(store.applyTeamChange(candidate('Python'), event, context).ok, true)
  assert.equal(store.pendingConflicts().length, 1)
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import {createHubIoPre} from ${JSON.stringify(new URL('../../lib/hub-io.js', import.meta.url).href)};
    import {createFactStorePre} from ${JSON.stringify(new URL('../../lib/fact-store.js', import.meta.url).href)};
    const io=createHubIoPre({dir:process.argv[1]}),store=createFactStorePre({io:io('facts.json')});
    const r=store.applyTeamChange(${JSON.stringify(candidate('Python'))},${JSON.stringify(event)},${JSON.stringify(context)});
    assert.equal(r.ok,true);assert.equal(r.outcome,'duplicate');assert.equal(store.pendingConflicts().length,1);
  `, root], { encoding: 'utf8', timeout: 10000 })
  assert.equal(child.status, 0, child.stderr)
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).conflicts.length, 1)
  console.log('PASS #364 receipt+conflict atomic rollback, durable retry and independent-process duplicate replay')
} finally { fs.rmSync(root, { recursive: true, force: true }) }
