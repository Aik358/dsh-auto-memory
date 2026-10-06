/** Portable chain: real Python processes and temporary venvs.
 * Fixture imports test selection, not model quality; installed C2/C3 acceptance
 * remains in smoke-test-py-runtime-live.mjs.
 */
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { probePythonPre, probePythonWithRetryPre, buildPythonCandidatesPre, resolvePythonInterpreterPre } from '../../lib/python-runtime.js'

const root = mkdtempSync(path.join(tmpdir(), 'dam-python-chain-'))
const previousEnv = {PYTHONPATH:process.env.PYTHONPATH, PYTHONNOUSERSITE:process.env.PYTHONNOUSERSITE, PYTHONIOENCODING:process.env.PYTHONIOENCODING}
process.env.PYTHONPATH = ''
process.env.PYTHONNOUSERSITE = '1'
process.env.PYTHONIOENCODING = 'utf-8'
const python = process.env.DSH_TEST_PYTHON || (process.platform === 'win32' ? 'python' : 'python3')
const interpreter = dir => path.join(dir, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python')
async function makeVenv(dir, ready) {
  const result = await probePythonPre(python, ['-m', 'venv', '--without-pip', dir], 15000)
  assert.equal(result.ok, true, 'temporary standard-library venv: ' + result.reason)
  const py = interpreter(dir)
  if (ready) {
    const site = await probePythonPre(py, ['-c', 'import sysconfig; print(sysconfig.get_path("purelib"))'], 5000)
    assert.equal(site.ok, true, site.reason)
    mkdirSync(site.out, {recursive:true})
    for (const name of ['transformers', 'onnxruntime', 'numpy']) writeFileSync(path.join(site.out, name + '.py'), '# Test fixture import only; no model implementation.\n')
  }
  return py
}
try {
  const version = await probePythonPre(python, ['-c', 'import sys; print(sys.version_info.major)'], 5000)
  assert.equal(version.ok, true, 'Python prerequisite: ' + version.reason)
  assert.equal(version.out, '3')
  const bad = await probePythonPre(path.join(root, 'missing-python'), ['-c', 'import sys'], 5000)
  assert.equal(bad.ok, false)
  assert.ok(bad.reason.length > 0)
  console.log('PASS nonexistent interpreter has an attributable failure')

  const slow = await probePythonPre(python, ['-c', 'import time; time.sleep(30)'], 1500)
  assert.equal(slow.ok, false)
  assert.equal(slow.timedOut, true)
  assert.match(slow.reason, /超时|timeout/i)
  const count = path.join(root, 'import-count')
  const missingImport = 'import pathlib; p=pathlib.Path(' + JSON.stringify(count) + '); p.write_text(str(int(p.read_text())+1) if p.exists() else "1"); import __dam_missing_dependency_zz__'
  const noDeps = await probePythonWithRetryPre(python, ['-c', missingImport], 5000, 2)
  assert.equal(noDeps.ok, false)
  assert.equal(noDeps.timedOut, false)
  assert.match(noDeps.reason, /ModuleNotFoundError/)
  assert.equal(readFileSync(count, 'utf8'), '1', 'dependency failure must not retry')
  const retryFile = path.join(root, 'retry-count')
  const retryScript = 'import pathlib,time; p=pathlib.Path(' + JSON.stringify(retryFile) + '); n=int(p.read_text())+1 if p.exists() else 1; p.write_text(str(n)); time.sleep(2) if n==1 else print("retried")'
  const retry = await probePythonWithRetryPre(python, ['-c', retryScript], 700, 1)
  assert.equal(retry.ok, true, retry.reason)
  assert.equal(retry.out, 'retried')
  assert.equal(readFileSync(retryFile, 'utf8'), '2')
  console.log('PASS actual timeout attributed; only transient failures retry; dependency failures execute once')

  const home = path.join(root, 'user'), plugin = path.join(root, 'plugin')
  const userVenv = path.join(home, 'python-engine', '.venv')
  const devVenv = path.join(plugin, 'python', 'bench', '.venv')
  const bare = await makeVenv(userVenv, false), ready = await makeVenv(devVenv, true)
  const candidates = buildPythonCandidatesPre({configured:path.join(root, 'missing'), dshHome:home, pluginDir:plugin})
  assert.equal(candidates[0].kind, 'configured')
  assert.equal(new Set(candidates.map(c => c.path)).size, candidates.length)
  assert.ok(candidates.some(c => c.kind === 'system'))
  const result = await resolvePythonInterpreterPre(candidates.filter(c => c.kind !== 'system'), {timeoutMs:5000})
  assert.equal(result.chosen, ready)
  assert.equal(result.chosenIsDev, true)
  assert.deepEqual(result.probed.map(c => c.status), ['missing', 'no-deps', 'ready'])
  assert.equal(result.probed[1].path, bare)
  assert.ok(result.probed.every(c => c.deps || c.reason.length > 0))
  const priority = await resolvePythonInterpreterPre([{path:ready, kind:'configured', isDev:false}, {path:bare, kind:'system', isDev:false}], {timeoutMs:5000})
  assert.equal(priority.chosen, ready)
  assert.equal(priority.chosenIsDev, false)
  assert.equal(priority.probed.length, 2, 'later failure must remain visible after selecting a ready interpreter')
  const allFailed = await resolvePythonInterpreterPre([{path:bare, kind:'system', isDev:false}], {timeoutMs:5000})
  assert.equal(allFailed.chosen, '')
  assert.equal(allFailed.probed[0].status, 'no-deps')
  assert.ok(allFailed.probed[0].reason.length > 0)
  assert.equal(buildPythonCandidatesPre({configured:'python'}).filter(c => c.path === 'python').length, 1)
  console.log('PASS real temporary venv selection, priority, dependency refusal, complete failure records and deduplication')
  console.log('PASS portable runtime chain; fixture imports do not establish installed C2/C3 model acceptance')
} finally {
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  rmSync(root, {recursive:true, force:true})
}
