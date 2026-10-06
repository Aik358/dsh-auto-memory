import assert from 'node:assert/strict'
import { fork } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
const { MemoryDocumentStore } = await import(process.env.MEMORY_WRITER_SOURCE || new URL('../../lib/memory-writer.js', import.meta.url))

const self = fileURLToPath(import.meta.url)
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

if (process.argv[2] === '--writer') {
  const [file, mode, label, sidecarDir] = process.argv.slice(3)
  let reads = 0
  const api = { ...fs, async readFile(target, ...args) {
    const value = await fs.readFile(target, ...args)
    if (target === file && ++reads === (mode === 'raw' ? 2 : 1)) {
      process.send({ phase: 'snapshot' })
      await new Promise(resolve => process.once('message', resolve))
    }
    return value
  } }
  const store = new MemoryDocumentStore({ fs: api, sidecarDir: sidecarDir || null })
  process.send({ phase: 'attempt' })
  try {
    const result = await (mode === 'raw' ? store.appendRaw(file, label) : store.append(file, label))
    process.send({ phase: 'result', result }, () => process.disconnect())
  } catch (error) {
    process.send({ phase: 'error', error: String(error) }, () => process.disconnect())
  }
} else {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dam-writer-process-'))
  const children = []
  function writer(file, mode, label, sidecarDir) {
    const child = fork(self, ['--writer', file, mode, label, sidecarDir || ''], { execArgv: [], stdio: ['ignore', 'ignore', 'pipe', 'ipc'] })
    children.push(child)
    const messages = [], waiters = new Set()
    let error = ''
    child.stderr.on('data', chunk => { error += chunk })
    child.on('message', message => { messages.push(message); for (const notify of waiters) notify() })
    child.on('error', e => { error += e; for (const notify of waiters) notify() })
    return { child, messages, async wait(phase, timeoutMs = 10000) {
      const deadline = Date.now() + timeoutMs
      while (!messages.some(message => message.phase === phase)) {
        assert(Date.now() < deadline, `worker waiting for ${phase}: ${error}`)
        assert(!messages.some(message => message.phase === 'error'), JSON.stringify(messages))
        await new Promise(resolve => { const timer = setTimeout(done, 20); function done() { clearTimeout(timer); waiters.delete(done); resolve() } waiters.add(done) })
      }
      return messages.find(message => message.phase === phase)
    } }
  }
  try {
    for (const mode of ['raw', 'anchored', 'alias']) {
      const dir = path.join(root, mode), file = path.join(dir, 'notes.md')
      await fs.mkdir(dir)
      await fs.writeFile(file, '')
      let other = file
      if (mode === 'alias') {
        const alias = path.join(root, 'directory-alias')
        await fs.symlink(dir, alias, process.platform === 'win32' ? 'junction' : 'dir')
        other = path.join(alias, 'notes.md')
      }
      const kind = mode === 'raw' ? 'raw' : 'anchored'
      const sidecarDir = kind === 'anchored' ? path.join(root, 'sidecars-' + mode) : ''
      const a = writer(file, kind, 'record_A', sidecarDir)
      await a.wait('snapshot')
      const b = writer(other, kind, 'record_B', sidecarDir)
      await b.wait('attempt')
      // Old code lets B capture A's old snapshot. Correct code blocks B's first
      // read until A has committed; release A after this bounded observation.
      await Promise.race([b.wait('snapshot', 1500).catch(() => {}), delay(250)])
      a.child.send('commit')
      assert.equal((await a.wait('result')).result.ok, true)
      await b.wait('snapshot')
      b.child.send('commit')
      assert.equal((await b.wait('result')).result.ok, true)
      const text = await fs.readFile(file, 'utf8')
      assert(text.includes('record_A') && text.includes('record_B'), `${mode}: successful append lost a record`)
      assert.equal((await fs.readdir(dir)).some(name => name.endsWith('.lock') || name.endsWith('.acquire')), false)
      if (mode === 'anchored') {
        const store = new MemoryDocumentStore({ sidecarDir })
        const saved = await store.readSidecar(file)
        assert.equal(saved.sidecar.sourceVersion, 2)
        assert.equal(saved.sidecar.fileDigest, createHash('sha256').update(text).digest('hex'))
      }
      console.log(`PASS ${mode}: two processes retain both successful records`)
    }
    const file = path.join(root, 'external-edit.md')
    await fs.writeFile(file, '')
    const store = new MemoryDocumentStore({ atomicOptions: { beforeRename: () => fs.writeFile(file, 'external edit\n') } })
    const result = await store.append(file, 'plugin edit')
    assert.equal(result.ok, false)
    assert.equal(result.reason, 'conflict-external-edit')
    assert.equal(await fs.readFile(file, 'utf8'), 'external edit\n')
    console.log('PASS anchored append rejects an external edit during commit')
  } finally {
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) {
        const closed = new Promise(resolve => child.once('close', resolve))
        child.kill('SIGKILL'); await closed
      }
    }
    await fs.rm(root, { recursive: true, force: true })
  }
}
