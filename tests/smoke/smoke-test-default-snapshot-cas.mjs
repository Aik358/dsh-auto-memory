// #321: an external edit after rendering must not be silently overwritten by
// default anchored writes. Real Store and production Engine entry points.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const BASE = 'bda0dad8fa9f7219e1f725e2f828e76e29da7fe4'
const repo = fileURLToPath(new URL('../../', import.meta.url))
const root = fs.mkdtempSync(path.join(repo, '.tmp-default-cas-'))
const baseline = process.argv.includes('--baseline')
const previousHome = process.env.DSH_HOME
const previousSource = process.env.DAM_AUDIT_ENGINE_SOURCE
process.env.DSH_HOME = path.join(root, 'home')
fs.mkdirSync(process.env.DSH_HOME)
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
let checks = 0, defects = 0

try {
  let writerUrl = new URL('../../lib/memory-writer.js', import.meta.url)
  if (baseline) {
    const originalUrl = writerUrl
    const rewrite = (source, origin) => source.replace(/from '(\.\/[^']+)'/g,
      (_, relative) => 'from ' + JSON.stringify(new URL(relative, origin).href))
    const originalWriter = execFileSync('git', ['show', BASE + ':lib/memory-writer.js'], { cwd: repo, encoding: 'utf8' })
    const writerFile = path.join(root, 'baseline-writer.mjs')
    fs.writeFileSync(writerFile, rewrite(originalWriter, originalUrl))
    writerUrl = pathToFileURL(writerFile)
    const indexUrl = new URL('../../lib/index.js', import.meta.url)
    const originalIndex = execFileSync('git', ['show', BASE + ':lib/index.js'], { cwd: repo, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 })
      .replace("from './memory-writer.js'", 'from ' + JSON.stringify(writerUrl.href))
    const engineFile = path.join(root, 'baseline-index.mjs')
    fs.writeFileSync(engineFile, rewrite(originalIndex, indexUrl))
    process.env.DAM_AUDIT_ENGINE_SOURCE = engineFile
  } else delete process.env.DAM_AUDIT_ENGINE_SOURCE
  const { MemoryDocumentStore } = await import(writerUrl.href)
  const { MemoryEngine } = await import('../lib/audit-engine.mjs')
  const { planMigration } = await import('../../lib/memory-anchor.js')
  const initial = Buffer.from('## Before\n- initial record\n')
  const external = Buffer.from('## External\n- acknowledged edit\n')
  const body = '## After\n- intended record\n'

  for (const mode of ['store', 'engine']) {
    for (const method of ['append', 'replace', 'replaceSingle', 'applyPlan']) {
      for (const scenario of ['default-race', 'explicit-race', 'normal', 'stale-precondition']) {
        const dir = path.join(root, mode + '-' + method + '-' + scenario)
        fs.mkdirSync(dir)
        const file = path.join(dir, 'MEMORY.md')
        fs.writeFileSync(file, initial)
        let store, engine
        if (mode === 'engine') {
          engine = new MemoryEngine()
          engine.configLoaded = true
          engine.config.memoryAnchorEnabled = true
          engine.config.teamEnabled = false
          store = engine.docStore
        } else store = new MemoryDocumentStore({ sidecarDir: path.join(dir, 'sidecars') })
        assert.equal((await store.rebuildSidecar(file)).ok, true)
        const sidecarPath = store.sidecarPath(file)
        const sidecarBefore = fs.readFileSync(sidecarPath)
        const plan = planMigration(file, initial)
        assert.ok(plan.operations.length > 0 && !plan.aborted)
        const opts = {}
        if (scenario === 'explicit-race') opts.expectedDigest = sha(initial)
        if (scenario === 'stale-precondition') opts.expectedDigest = 'stale'
        let edited = false
        if (scenario !== 'normal') store.atomicOptions = { beforeRename: () => {
          // Sidecar publication also uses atomicReplace. Inject exactly once so
          // the fixture represents one acknowledged edit, not a second write.
          if (!edited) { edited = true; fs.writeFileSync(file, external) }
        } }
        // Engine's appendText/writeFullSingle do not accept caller CAS options.
        // Their explicit controls use the same production docStore method.
        // applyPlan is exposed by the Engine's configured docStore, not a wrapper.
        async function invoke() {
          if (mode === 'engine' && method === 'replace') return engine.writeFull(file, body, opts)
          if (mode === 'engine' && (scenario === 'default-race' || scenario === 'normal')) {
            if (method === 'append') return engine.appendText(file, body)
            if (method === 'replaceSingle') return engine.writeFullSingle(file, body)
          }
          return store[method](file, method === 'applyPlan' ? plan : body, opts)
        }
        let result, error
        try { result = await invoke() } catch (caught) { error = caught }
        const succeeded = !error && !(result && typeof result === 'object' && result.ok === false)
        const raced = scenario === 'default-race' || scenario === 'explicit-race'
        const reject = scenario === 'stale-precondition' || scenario === 'explicit-race' || (scenario === 'default-race' && !baseline)
        assert.equal(succeeded, !reject, mode + '/' + method + '/' + scenario + ': ' + JSON.stringify(result || error?.message))
        if (raced) assert.equal(edited, true)
        if (reject) {
          const reason = error ? error.message : result.reason
          assert.match(reason, /conflict-external-edit/)
          assert.deepEqual(fs.readFileSync(file), raced ? external : initial)
          assert.deepEqual(fs.readFileSync(sidecarPath), sidecarBefore, 'rejected write must not publish a sidecar')
          if (raced) {
            assert.equal(error ? error.written : result.written, false)
            assert.equal(error ? error.fsCode : result.fsCode, 'MEMORY_CONFLICT')
          } else assert.equal(edited, false, 'stale caller precondition rejects before rename')
        } else {
          const content = fs.readFileSync(file)
          assert.ok(content.includes(method === 'applyPlan' ? 'initial record' : 'intended record'))
          assert.ok(content.includes('<!-- memory:mem_'))
          const sidecar = await store.readSidecar(file)
          assert.equal(sidecar.ok, true)
          assert.equal(sidecar.sidecar.fileDigest, sha(content))
          if (scenario === 'default-race') {
            assert.equal(content.includes('acknowledged edit'), false)
            defects++
          }
        }
        checks++
        console.log((baseline && scenario === 'default-race' ? 'DEFECT CONFIRMED ' : 'PASS ') + mode + '/' + method + '/' + scenario)
      }
    }
  }
  assert.equal(defects, baseline ? 8 : 0)
  console.log(baseline ? BASE + ': ' + defects + ' defects confirmed + ' + (checks - defects) + ' controls passed'
    : checks + ' PASS / 0 FAIL')
} finally {
  if (previousHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = previousHome
  if (previousSource === undefined) delete process.env.DAM_AUDIT_ENGINE_SOURCE; else process.env.DAM_AUDIT_ENGINE_SOURCE = previousSource
  fs.rmSync(root, { recursive: true, force: true })
}
