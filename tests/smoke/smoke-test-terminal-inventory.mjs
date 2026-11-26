import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const fixture = await mkdtemp(path.join(tmpdir(), 'dam-terminal-inventory-test-'))
const inventoryPath = 'tools/inventory-auto-memory.mjs'
const matrixPath = 'docs/internal/auto-memory-cli-coverage.json'
const terminalOperations = path.join(fixture, 'lib/terminal/operations.js')

function inventory(...args) {
  const run = spawnSync(process.execPath, [inventoryPath, ...args], {
    cwd: fixture, encoding: 'utf8', timeout: 45000,
  })
  if (run.error) throw run.error
  return run
}

try {
  await mkdir(path.join(fixture, 'tools'), { recursive: true })
  await mkdir(path.join(fixture, 'docs/internal'), { recursive: true })
  await Promise.all(['lib', 'package.json', inventoryPath, matrixPath].map(relative =>
    cp(path.join(root, relative), path.join(fixture, relative), { recursive: true })))

  const original = await readFile(terminalOperations, 'utf8')
  const sourceAnchor = '  const table = new Map()'
  assert.equal(original.split(sourceAnchor).length, 2)
  const mutated = original.replace(sourceAnchor, `
  const statusOperation = operations.find(operation => operation.id === 'status')
  statusOperation.inputSchema = object({ example: boolean })
  operations.splice(operations.findIndex(operation => operation.id === 'jobs.get'), 1)
  operations.push(operation('inventory.fixture.read', 'Read fixture', 'system', global, read,
    empty, string, () => 'fixture', { kind: 'service', key: 'inventoryFixture' }))
${sourceAnchor}`)
  await writeFile(terminalOperations, mutated)

  const check = inventory('--check')
  assert.equal(check.status, 1, check.stderr)
  assert.match(check.stderr, /changed public status \(inputSchema\)/)
  assert.match(check.stderr, /removed public jobs\.get/)
  assert.match(check.stderr, /added public inventory\.fixture\.read/)
  assert.match(check.stderr, /unmapped public inventory\.fixture\.read/)

  const refresh = inventory('--write')
  assert.equal(refresh.status, 0, refresh.stderr)
  const refreshed = JSON.parse(await readFile(path.join(fixture, matrixPath), 'utf8'))
  assert.ok(refreshed.terminalManifest.operations['inventory.fixture.read'])
  assert.ok(refreshed.terminalCoverage.unmappedPublic.includes('inventory.fixture.read'))
  assert.equal(refreshed.terminalManifest.operations['jobs.get'], undefined)
  const review = inventory('--check')
  assert.equal(review.status, 1, review.stderr)
  assert.match(review.stderr, /unmapped public inventory\.fixture\.read/)
  assert.match(review.stderr, /public jobs\.get is linked but no longer registered/)
  console.log('PASS production terminal manifest drift and coverage review after refresh')
} finally {
  await rm(fixture, { recursive: true, force: true })
}
