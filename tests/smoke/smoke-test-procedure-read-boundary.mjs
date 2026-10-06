import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repo = process.env.AUDIT_TEST_REPO || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const { createScopedHubIoPre } = await import(pathToFileURL(path.join(repo, 'lib/hub-io.js')))
const { createProcedureStorePre } = await import(pathToFileURL(path.join(repo, 'lib/procedure-store.js')))
const home = await fs.mkdtemp(path.join(tmpdir(), 'dam-procedure-read-'))
try {
  const globalDir = path.join(home, 'hub'), workspaceDir = path.join(home, 'workspace-hub')
  await fs.writeFile(path.join(home, 'README.md'), 'Existing user data')
  const before = await fs.readdir(home)
  const io = createScopedHubIoPre({ globalDir, resolveWorkspace: () => ({ dir: workspaceDir, key: 'workspace' }) })
  assert.equal(io.load(), null)
  assert.deepEqual(await fs.readdir(home), before, 'reading absent libraries must not create persistent memory directories')
  const store = createProcedureStorePre({ io })
  assert(store.observe({ title: 'Accepted global skill', steps: ['Perform the task'], successCriteria: ['Verify the result'], origin: 'user', scope: 'global' }).persisted)
  assert.equal(JSON.parse(await fs.readFile(path.join(globalDir, 'procedures.json'), 'utf8')).procedures[0].title, 'Accepted global skill')
  assert.equal(await fs.readFile(path.join(home, 'README.md'), 'utf8'), 'Existing user data')
  assert.deepEqual((await fs.readdir(globalDir)).sort(), ['procedures.json'])
  assert.deepEqual((await fs.readdir(workspaceDir)).sort(), [])
  console.log('PASS absent scoped library reads have no directory side effects; actual saves create guarded snapshots and leave no lock residue')
} finally {
  await fs.rm(home, { recursive: true, force: true })
}
