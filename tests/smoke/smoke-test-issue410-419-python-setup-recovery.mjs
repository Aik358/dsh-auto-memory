import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import cp from 'node:child_process'
import { promisify } from 'node:util'
import { syncBuiltinESMExports } from 'node:module'

const dir = fs.mkdtempSync(path.join(tmpdir(), 'dam-python-recovery-'))
const originalExec = cp.execFile, originalStat = fs.statSync
let pipFailures = 0
const fakeExec = () => {}
fakeExec[promisify.custom] = async (_, args) => {
  if (args.includes('pip') && pipFailures-- > 0) throw Error('fixture pip failed')
  return { stdout: '3.12', stderr: '' }
}
cp.execFile = fakeExec; syncBuiltinESMExports()
const { createPythonSetupPre } = await import('../../lib/python-setup.js')
const modelBytes = 568456694
function writeArtifact(file) { fs.mkdirSync(path.dirname(file), { recursive: true }); if (file.endsWith('.onnx')) { fs.writeFileSync(file, ''); fs.truncateSync(file, modelBytes) } else fs.writeFileSync(file, file.endsWith('.json') ? '{}' : 'xx') }
try {
  const home = path.join(dir, 'retry'), downloads = []
  let tokenFailure = true
  const setup = createPythonSetupPre({ dshHome: home, download: async (_, file) => { downloads.push(path.basename(file)); if (file.endsWith('tokenizer.json') && tokenFailure) throw Error('fixture tokenizer network failure'); writeArtifact(file) } })
  const failed = await setup.downloadModel()
  assert.equal(failed.phase, 'error'); assert.equal(failed.modelReady, false)
  assert.equal(downloads.filter((name) => name.endsWith('.onnx')).length, 1, 'a tokenizer failure must retain the verified model')
  assert.ok(fs.existsSync(setup.modelPath()))
  tokenFailure = false; downloads.length = 0
  const ready = await setup.downloadModel()
  assert.equal(ready.modelReady, true); assert.equal(ready.configOk, true)
  assert.ok(!downloads.some((name) => name.endsWith('.onnx')), 'retry downloads only missing artifacts')
  const cfg = path.join(home, 'memory', 'semantic', 'embedding-config.json')
  const saved = fs.readFileSync(cfg, 'utf8'); fs.writeFileSync(cfg, '{broken')
  const configFailure = await setup.repairConfig()
  assert.equal(configFailure.phase, 'error'); assert.equal(configFailure.modelReady, true)
  assert.equal(fs.readFileSync(cfg, 'utf8'), '{broken')
  fs.writeFileSync(cfg, saved); downloads.length = 0
  assert.equal((await setup.repairConfig()).configOk, true)
  assert.equal(downloads.length, 0, 'configuration repair does not redownload assets')
  const cancelHome = path.join(dir, 'cancel')
  let cancelSetup, tokenizerCalls = 0, modelStats = 0
  fs.statSync = (file, ...args) => {
    const result = originalStat(file, ...args)
    if (String(file) === path.join(cancelHome, 'python-engine', 'models', 'model_int8.onnx') && ++modelStats === 1) queueMicrotask(() => cancelSetup.cancelDownload())
    return result
  }
  syncBuiltinESMExports()
  cancelSetup = createPythonSetupPre({ dshHome: cancelHome, download: async (_, file) => { if (!file.endsWith('.onnx')) tokenizerCalls++; writeArtifact(file) } })
  const cancelled = await cancelSetup.downloadModel()
  assert.equal(cancelled.activeOperation, ''); assert.equal(cancelled.phase, 'idle')
  assert.equal(tokenizerCalls, 0, 'one cancellation at the verification boundary prevents the next transfer')
  fs.statSync = originalStat; syncBuiltinESMExports()
  const pipHome = path.join(dir, 'pip')
  const venv = path.join(pipHome, 'python-engine', '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python')
  fs.mkdirSync(path.dirname(venv), { recursive: true }); fs.writeFileSync(venv, 'fixture interpreter')
  const pip = createPythonSetupPre({ dshHome: pipHome })
  await pip.detect(); pipFailures = 2
  assert.match((await pip.ensureDeps({ gpu: false })).error, /fixture pip failed/)
  const recovered = await pip.ensureDeps({ gpu: false })
  assert.equal(recovered.depsOk, true); assert.equal(recovered.error, '')
  console.log('PASS #410/#417/#418/#419 Python setup preserves verified assets and recovers config, cancellation and retries')
} finally { cp.execFile = originalExec; fs.statSync = originalStat; syncBuiltinESMExports(); fs.rmSync(dir, { recursive: true, force: true }) }
