// Real maintain/append paths, isolated homes, and IPC/file-read barriers.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fork } from 'node:child_process'
import { syncBuiltinESMExports } from 'node:module'
import { fileURLToPath } from 'node:url'

const self = fileURLToPath(import.meta.url)
const name = '2020-01-01.md'
const marker = 'accepted-concurrent-archive-record'
const originalText = '## Original\n- preserved-old-record\n'
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }

function engineAt(MemoryEngine, root, anchored) {
  const e = new MemoryEngine()
  e.configLoaded = true
  Object.assign(e.config, {
    memoryRoot: path.join(root, 'memory'), userMemoryDir: path.join(root, 'user'),
    memoryAnchorEnabled: anchored, associativeMemoryEnabled: false,
    teamEnabled: false, pythonBackendEnabled: false,
  })
  e._configPath = path.join(root, 'config.json')
  e.refresh = async () => {}
  // No model call. A summary need not duplicate every raw record, so the archive
  // itself must preserve the successful append, even when notes contain a summary.
  e._subagents = {}
  e.runSubagent = async () => '### Decision\n- retained general decision.'
  return e
}

if (process.argv[2] === '--writer') {
  const [root, file, anchorFlag] = process.argv.slice(3)
  process.env.DSH_HOME = root
  const open = fs.openSync
  let notified = false
  fs.openSync = function(target, ...args) {
    try { return open(target, ...args) } catch (error) {
      if (String(target) === file + '.lock.lock' && !notified) {
        notified = true
        process.send({ event: 'blocked', code: error.code })
      }
      throw error
    }
  }
  syncBuiltinESMExports()
  try {
    const { MemoryEngine } = await import('../lib/audit-engine.mjs')
    await engineAt(MemoryEngine, root, anchorFlag === 'true').appendText(file, '\n- ' + marker + '\n')
    process.send({ event: 'done' })
  } catch (error) { process.send({ event: 'error', message: error.stack }); process.exitCode = 1 }
  finally { fs.openSync = open; syncBuiltinESMExports(); process.disconnect() }
} else {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dam-issue319-'))
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = home
  const { MemoryEngine } = await import('../lib/audit-engine.mjs')
  const text = file => fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
  let pass = 0, sequence = 0
  async function fixture(anchored) {
    const root = path.join(home, String(++sequence))
    const e = engineAt(MemoryEngine, root, anchored)
    const p = await e.resolvePaths(null)
    const src = path.join(p.projectDir, name), archive = path.join(p.projectDir, 'archive', name)
    fs.mkdirSync(p.projectDir, { recursive: true })
    fs.writeFileSync(src, originalText)
    return { e, root, p, src, archive }
  }
  try {
    for (const anchored of [false, true]) {
      const normal = await fixture(anchored)
      const msg = await normal.e.maintain(30, {})
      assert.equal(fs.existsSync(normal.src), false)
      assert.ok(text(normal.archive).includes('preserved-old-record'))
      assert.ok(text(normal.p.notesPath).includes('retained general decision'))
      assert.ok(!msg.includes('未删除'))
      if (!anchored) assert.equal(text(normal.archive), originalText)
      console.log('PASS normal archival, anchor=' + anchored); pass++

      const f = await fixture(anchored), reached = deferred(), resume = deferred()
      const read = fsp.readFile
      let sourceReads = 0, gated = false, maintenance, child, exited
      fsp.readFile = async function(file, ...args) {
        const value = await read(file, ...args)
        // First source read is the AI input; second is archive publication.
        if (path.resolve(String(file)) === f.src && ++sourceReads === 2 && !gated) {
          gated = true; reached.resolve(); await resume.promise
        }
        return value
      }
      syncBuiltinESMExports()
      try {
        maintenance = f.e.maintain(30, {})
        await reached.promise
        child = fork(self, ['--writer', f.root, f.src, String(anchored)], { env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true })
        let stderr = ''
        child.stderr.on('data', data => { stderr += data })
        const first = deferred(), done = deferred()
        child.on('message', message => { first.resolve(message); if (message.event === 'done' || message.event === 'error') done.resolve(message) })
        exited = new Promise(resolve => child.once('exit', code => { first.resolve({ event: 'exited', code, stderr }); done.resolve({ event: 'exited', code, stderr }); resolve(code) }))
        // Only a hung-test watchdog; no elapsed time determines the IO order.
        const watchdog = setTimeout(() => { first.resolve({ event: 'timeout' }); child.kill(); resume.resolve() }, 20000)
        try {
          const event = await first.promise
          const newer = engineAt(MemoryEngine, f.root, anchored)
          if (event.event === 'done') {
            // Baseline: B archives the successful append before A publishes its
            // old snapshot. There is no append failure to explain away the loss.
            await newer.maintain(30, {})
            resume.resolve()
            await maintenance
          } else {
            assert.equal(event.event, 'blocked', JSON.stringify(event))
            resume.resolve()
            await maintenance
            assert.equal((await done.promise).event, 'done')
            await newer.maintain(30, {})
          }
          assert.equal(await exited, 0, stderr)
          assert.ok([f.src, f.archive, f.p.notesPath].some(file => text(file).includes(marker)), 'stale publisher destroyed the newer successful archive')
          assert.ok(text(f.archive).includes(marker), 'successful raw record must remain in the archive')
          console.log('PASS cross-process stale publisher, anchor=' + anchored); pass++
        } finally { clearTimeout(watchdog) }
      } finally {
        resume.resolve(); if (child && child.exitCode === null) child.kill()
        await Promise.allSettled([maintenance, exited])
        fsp.readFile = read; syncBuiltinESMExports()
      }
    }
    console.log('issue319: ' + pass + ' PASS')
  } finally {
    if (previousHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = previousHome
    fs.rmSync(home, { recursive: true, force: true })
  }
}
