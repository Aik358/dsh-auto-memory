import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { createHubIoPre } from '../../lib/hub-io.js'
import { createFactStorePre } from '../../lib/fact-store.js'
import { withConfigLockSync } from '../../lib/config-lock.js'

const dir = fs.mkdtempSync(path.join(tmpdir(), 'dam-361-'))
const candidate = (subject) => ({ scope: 'Workspace', subject, predicate: 'uses', object: 'Node.js', sourceKind: 'explicit', provenance: ['test'], confidence: 1 })
try {
  const io = createHubIoPre({ dir })
  const store = createFactStorePre({ io: io('facts.json') })
  io.beginBatch()
  assert.equal(store.upsert(candidate('alpha')).ok, true)
  const source = `import {createHubIoPre} from ${JSON.stringify(new URL('../../lib/hub-io.js', import.meta.url).href)};
    import {createFactStorePre} from ${JSON.stringify(new URL('../../lib/fact-store.js', import.meta.url).href)};
    const io=createHubIoPre({dir:process.argv[1]});
    const r=createFactStorePre({io:io('facts.json')}).upsert(${JSON.stringify(candidate('beta'))});
    if(!r.ok) throw new Error(JSON.stringify(r));`
  const other = spawnSync(process.execPath, ['--input-type=module', '-e', source, dir], { encoding: 'utf8', timeout: 10000 })
  assert.equal(other.status, 0, other.stderr)
  assert.equal(io.endBatch().ok, true)
  const reloaded = createFactStorePre({ io: io('facts.json') })
  reloaded.restore(io('facts.json').load())
  assert.deepEqual(reloaded.query({}).map((f) => f.subject).sort(), ['alpha', 'beta'])
  const factFile = path.join(dir, 'facts.json')
  const reload = () => { const fresh = createFactStorePre({ io: io('facts.json') }); fresh.restore(io('facts.json').load()); return fresh }
  const run = (job, expectFailure = false) => {
    const code = `import assert from 'node:assert/strict';
      import {createHubIoPre} from ${JSON.stringify(new URL('../../lib/hub-io.js', import.meta.url).href)};
      import {createFactStorePre} from ${JSON.stringify(new URL('../../lib/fact-store.js', import.meta.url).href)};
      const io=createHubIoPre({dir:process.argv[1]}),store=createFactStorePre({io:io('facts.json')});io.beginBatch();
      const result=${job}; assert.equal(result.ok,${!expectFailure},JSON.stringify(result));
      ${expectFailure ? "assert.equal(result.reason,'transaction-failed');assert.match(result.error,/CONFIG_LOCK_BUSY|config-lock-busy/);" : ''}
      assert.equal(io.endBatch().ok,true);`
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', code, dir], { encoding: 'utf8', timeout: 10000 })
    assert.equal(child.status, 0, child.stderr)
  }
  // Each B mutation commits while A's outer batch is still open. A then mutates
  // from its old in-memory view; the transaction must reload B's latest state.
  io.beginBatch()
  store.upsert(candidate('updated'))
  run(`store.supersede(${JSON.stringify({ ...candidate('updated'), object: 'Python' })})`)
  assert.equal(reload().get('Workspace', 'updated', 'uses').object, 'Python')
  store.upsert(candidate('after-update')); assert.equal(io.endBatch().ok, true)
  assert.equal(reload().get('Workspace', 'updated', 'uses').object, 'Python')
  io.beginBatch(); store.upsert({ ...candidate('retracted'), provenance: ['source-to-delete'] })
  run("store.revokeBySource('source-to-delete')")
  store.upsert(candidate('after-retract')); io.endBatch()
  assert.equal(reload().get('Workspace', 'retracted', 'uses'), null)
  assert.equal(reload().snapshot({ includeRevoked: true }).facts.find(f => f.subject === 'retracted').revoked, true)
  io.beginBatch(); store.upsert(candidate('conflicted'))
  run(`store.upsert(${JSON.stringify({ ...candidate('conflicted'), object: 'Python' })})`)
  store.upsert(candidate('after-conflict')); io.endBatch()
  const conflict = reload().pendingConflicts().find(c => c.subject === 'conflicted')
  assert.ok(conflict); assert.equal(conflict.left.object, 'Node.js'); assert.equal(conflict.right.object, 'Python')
  io.beginBatch(); store.upsert(candidate('before-resolve'))
  run(`store.resolveConflict(${JSON.stringify(conflict.conflictId)},'right')`)
  store.upsert(candidate('after-resolve')); io.endBatch()
  assert.equal(reload().get('Workspace', 'conflicted', 'uses').object, 'Python'); assert.equal(reload().pendingConflicts().length, 0)
  // A real live owner holds the same lock. A second process must visibly fail;
  // neither batching nor cleanup may turn that into an unlocked write.
  const before = fs.readFileSync(factFile, 'utf8')
  withConfigLockSync(factFile, () => run(`store.upsert(${JSON.stringify(candidate('must-not-write'))})`, true))
  assert.equal(fs.readFileSync(factFile, 'utf8'), before); assert.equal(reload().get('Workspace', 'must-not-write', 'uses'), null)
  run(`store.upsert(${JSON.stringify(candidate('retry-after-lock'))})`)
  assert.ok(reload().get('Workspace', 'retry-after-lock', 'uses'))
  console.log('PASS #361 independent-process insert/update/retract/conflict/resolve, locked reload+commit, visible busy failure and retry')
} finally { fs.rmSync(dir, { recursive: true, force: true }) }
