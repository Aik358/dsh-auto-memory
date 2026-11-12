import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { cp, mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const node = execFileSync('node', ['-p', 'process.execPath'], { encoding: 'utf8' }).trim()
const nodeVersion = execFileSync(node, ['--version'], { encoding: 'utf8' }).trim()
const prototype = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const repo = path.resolve(prototype, '../..')
const output = path.join(repo, 'artifacts/_index-gov-20261109/out')
const reportPath = path.join(output, 'prototype-mutations.json')
await mkdir(output, { recursive: true })
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
const protectedFiles = ['index-state.js', 'sidecar-store.js', 'markdown-adapter.js', 'journal-storage.js', 'codec.js']
const cleanBefore = Object.fromEntries(await Promise.all(protectedFiles.map(async name => [name, sha256(await readFile(path.join(prototype, name)))])))

function isolatedRepo(mutant) {
  // The mutation stays under prototypes/ so its ../../../lib dependency is real,
  // while the original implementation, production lib and test runner stay intact.
  return mkdtemp(path.join(repo, 'prototypes', '.sidecar-mutation-')).then(async temporary => {
    const moduleRoot = path.join(temporary, 'sidecar-store')
    await cp(prototype, moduleRoot, { recursive: true, filter: source => !path.basename(source).startsWith('.sidecar-mutation-') })
    const tests = path.join(moduleRoot, 'tests')
    const update = async (name, job) => {
      const file = path.join(tests, name)
      const text = await readFile(file, 'utf8')
      const updated = job(text)
      assert.notEqual(updated, text, name + ': isolation rewrite must apply')
      await writeFile(file, updated)
    }
    // Rewrite only the clone's read-only production imports, never lib itself.
    for (const name of ['journal-storage.js', 'markdown-adapter.js']) {
      const target = path.join(moduleRoot, name)
      const text = await readFile(target, 'utf8')
      assert(text.includes('../../lib/'))
      await writeFile(target, text.replaceAll('../../lib/', '../../../lib/'))
    }
    for (const name of ['adapter.test.mjs', 'blockers.test.mjs', 'contract.test.mjs', 'lock-holder.mjs']) {
      await update(name, text => text.replaceAll('../../../lib/', '../../../../lib/').replaceAll("'../../..'", "'../../../..'"))
    }
    await update('contract.test.mjs', text => text.replaceAll("repo, 'artifacts/_index-gov-20261109/prototype-tests'", 'repo, ' + JSON.stringify(path.relative(repo, path.join(output, 'mutations', mutant, 'work')).replaceAll('\\', '/'))).replaceAll("repo, 'artifacts/_index-gov-20261109/work/poc-a/base.json'", 'repo, ' + JSON.stringify('artifacts/_index-gov-20261109/work/poc-a/base.json')).replaceAll("repo, 'artifacts/_index-gov-20261109/out/fixture-meta.json'", 'repo, ' + JSON.stringify('artifacts/_index-gov-20261109/out/fixture-meta.json')))
    await update('blockers.test.mjs', text => text.replaceAll("repo, 'artifacts/_index-gov-20261109/prototype-tests'", 'repo, ' + JSON.stringify(path.relative(repo, path.join(output, 'mutations', mutant, 'work')).replaceAll('\\', '/'))).replaceAll("repo, 'prototypes/sidecar-store/index.d.ts'", 'repo, ' + JSON.stringify(path.relative(repo, path.join(moduleRoot, 'index.d.ts')).replaceAll('\\', '/'))))
    await update('adapter.test.mjs', text => text.replaceAll("repo, 'artifacts/_index-gov-20261109/prototype-tests'", 'repo, ' + JSON.stringify(path.relative(repo, path.join(output, 'mutations', mutant, 'work')).replaceAll('\\', '/'))))
    return { temporary, moduleRoot }
  })
}

const mutations = [
  { id: 'B1-delete-lineage', file: 'index-state.js', from: "          if (!lineage.includes(entry.source)) this.#versions.set(entry.id, [...lineage, entry.source])", to: "          this.#versions.set(entry.id, [entry.source])" },
  { id: 'B2-remove-getter', file: 'sidecar-store.js', from: '  get parserVersion() { return this.#parserVersion }', to: '' },
  { id: 'B3-disable-approved-root', file: 'markdown-adapter.js', from: '    const physicalRoot = await realpath(approvedRoot)', to: '    const physicalRoot = process.platform === \'never\' ? approvedRoot : \'\\\n\'' },
  { id: 'B3-raw-json', file: 'markdown-adapter.js', from: "      throw new IndexStorageError('INDEX_INVALID_DATA', 'Invalid legacy JSON: ' + cause.message, { cause })", to: '      throw cause' },
  { id: 'B4-native-lock-error', file: 'journal-storage.js', from: '    return task.catch(error => { throw storageFailure(error) })', to: '    return task' },
  { id: 'B4-native-filesystem-error', file: 'journal-storage.js', from: '    return task.catch(error => { throw storageFailure(error) })', to: "    return task.catch(error => { if (error.message?.startsWith('state-lock-timeout:')) throw storageFailure(error); throw error })" },
]
async function isolatedTests(moduleRoot) {
  const child = spawn(node, ['--test', '--test-reporter=tap', path.join(moduleRoot, 'tests/adapter.test.mjs'), path.join(moduleRoot, 'tests/blockers.test.mjs'), path.join(moduleRoot, 'tests/contract.test.mjs')], { cwd: repo, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  let stdout = '', stderr = ''
  child.stdout.on('data', chunk => { stdout += chunk })
  child.stderr.on('data', chunk => { stderr += chunk })
  const [exitCode, signal] = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', (code, signal) => resolve([code, signal])) })
  return { exitCode, signal, stdout, stderr }
}

const results = []
const { temporary: cleanTemp, moduleRoot: cleanRoot } = await isolatedRepo('clean-control')
const clean = await isolatedTests(cleanRoot)
const cleanCount = name => Number(clean.stdout.match(new RegExp('^# ' + name + ' (\\d+)$', 'm'))?.[1] ?? 0)
assert.equal(clean.exitCode, 0, 'Unmutated isolation control must pass: ' + clean.stdout + clean.stderr)
assert.equal(cleanCount('tests'), 37)
assert.equal(cleanCount('skipped'), 0)
const control = { exitCode: clean.exitCode, tests: cleanCount('tests'), passed: cleanCount('pass'), failed: cleanCount('fail'), skipped: cleanCount('skipped') }
await mkdir(path.join(output, 'mutations/clean-control'), { recursive: true })
await writeFile(path.join(output, 'mutations/clean-control/tests.tap'), clean.stdout)
await cp(cleanTemp, path.join(output, 'mutations/clean-control/evidence'), { recursive: true })
for (const mutation of mutations) {
  const { temporary, moduleRoot } = await isolatedRepo(mutation.id)
  try {
    const target = path.join(moduleRoot, mutation.file)
    const original = await readFile(target, 'utf8')
    assert.equal(original.split(mutation.from).length - 1, 1, mutation.id + ': exact one mutation anchor')
    await writeFile(target, original.replace(mutation.from, mutation.to))
    const { exitCode, signal, stdout, stderr } = await isolatedTests(moduleRoot)
    const count = name => Number(stdout.match(new RegExp('^# ' + name + ' (\\d+)$', 'm'))?.[1] ?? 0)
    const failedNames = [...stdout.matchAll(/^not ok \d+ - (.+)$/gm)].map(match => match[1])
    assert.notEqual(exitCode, 0, mutation.id + ': suite must detect the broken behavior')
    results.push({ id: mutation.id, file: mutation.file, exitCode, signal, tests: count('tests'), passed: count('pass'), failed: count('fail'), skipped: count('skipped'), failedNames, stderr, caught: true })
    console.log('MUTATION_RESULT ' + JSON.stringify(results.at(-1)))
    await mkdir(path.join(output, 'mutations', mutation.id), { recursive: true })
    await writeFile(path.join(output, 'mutations', mutation.id, 'tests.tap'), stdout)
  } finally {
    // Keep evidence outside the shared prototype; never mutate its sources.
    const evidence = path.join(output, 'mutations', mutation.id, 'evidence')
    await mkdir(path.dirname(evidence), { recursive: true })
    await cp(temporary, evidence, { recursive: true })
  }
}
const cleanAfter = Object.fromEntries(await Promise.all(protectedFiles.map(async name => [name, sha256(await readFile(path.join(prototype, name)))])))
assert.deepEqual(cleanAfter, cleanBefore, 'Shared implementation bytes changed during isolated mutation testing')
const report = { runtime: nodeVersion, base: '64b4ac9b53ba799260e2a3e09cc2dda53734a03d', control, caught: results.length, missed: 0, results, sharedSourceUnchanged: true, cleanAfter }
await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(report, null, 2))
