import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { MemoryDocumentStore } from '../../lib/memory-writer.js'
import { canonicalize, canonicalScopeGuard } from '../../lib/m4-corpus.js'
import { workspaceRefOf } from '../../lib/evidence-store.js'

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dam-371-'))
try {
  const upper = path.join(root, 'Project', 'MEMORY.md')
  const lower = path.join(root, 'project', 'MEMORY.md')
  const store = new MemoryDocumentStore({ sidecarDir: path.join(root, 'sidecars') })
  if (process.platform === 'win32') {
    assert.equal(canonicalize(upper), canonicalize(lower))
    assert.equal(workspaceRefOf(upper), workspaceRefOf(lower))
    console.log('PASS #371 Windows compatibility; case-sensitive filesystem checks run on POSIX CI')
  } else {
    assert.notEqual(store.sidecarPath(upper), store.sidecarPath(lower))
    assert.notEqual(workspaceRefOf(upper), workspaceRefOf(lower))
    await fs.mkdir(path.dirname(upper)); await fs.mkdir(path.dirname(lower))
    await fs.writeFile(upper, '# Upper\n'); await fs.writeFile(lower, '# Lower\n')
    await store.rebuildSidecar(upper); await store.rebuildSidecar(lower)
    assert.equal((await store.readSidecar(upper)).ok, true)
    assert.equal((await store.readSidecar(lower)).ok, true)
    const link = path.join(root, 'Project', 'link.md')
    await fs.symlink(lower, link)
    assert.equal(canonicalScopeGuard({ file: link }, link).ok, false)
    assert.equal(await fs.readFile(upper, 'utf8'), '# Upper\n')
    console.log('PASS #371 case-distinct source identities, sidecars, and symlink boundaries')
  }
} finally { await fs.rm(root, { recursive: true, force: true }) }
