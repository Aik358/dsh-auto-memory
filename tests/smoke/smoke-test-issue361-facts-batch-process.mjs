import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { createHubIoPre } from '../../lib/hub-io.js'
import { createFactStorePre } from '../../lib/fact-store.js'

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
  console.log('PASS #361 outer batches cannot overwrite another process facts')
} finally { fs.rmSync(dir, { recursive: true, force: true }) }
