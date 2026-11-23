import { SidecarStore } from '../index.js'
import { createHash } from 'node:crypto'

const [mode, directory, workspaceKey, parameter = ''] = process.argv.slice(2)
const id = text => 'mem_' + createHash('sha256').update(text).digest('hex').slice(0, 32)
const entry = (source, text) => ({ id: id(text), source, kind: 'ledger', title: text, section: text, preview: text, tags: ['topic:parallel'], cues: ['worker:' + text] })
const fault = async stage => {
  if (mode === 'crash' && stage === parameter) {
    // A real process termination after the backend reaches the named boundary.
    await new Promise((resolve, reject) => {
      process.stdout.write(JSON.stringify({ faultReached: stage, termination: 'SIGKILL' }) + '\n', error => {
        if (error) reject(error)
        else process.kill(process.pid, 'SIGKILL')
      })
    })
  }
}
const store = await SidecarStore.open({ directory, workspaceKey, durable: true, lockTimeoutMs: 30000, fault })
try {
  if (mode === 'writer') {
    const prefix = parameter
    for (let i = 0; i < 12; i++) {
      const source = `handoff/handoff-20261109-${prefix}${String(i).padStart(4, '0')}.md`
      await store.replaceSource({ source, expectedRevision: null, sourceRevision: `${prefix}:${i}`, entries: [entry(source, `${prefix}:${i}`)] }, { operationId: `${prefix}:${i}` })
    }
    console.log(JSON.stringify({ ok: true, written: 12 }))
  } else if (mode === 'cas') {
    const source = 'handoff/PLAN.md'
    try {
      await store.replaceSource({ source, expectedRevision: null, sourceRevision: parameter, entries: [entry(source, parameter)] }, { operationId: parameter })
      console.log(JSON.stringify({ ok: true, committed: true }))
    } catch (error) {
      console.log(JSON.stringify({ ok: true, committed: false, code: error.code, message: error.message }))
    }
  } else if (mode === 'crash') {
    if (parameter === 'appendAfterWrite') {
      const source = 'handoff/crash.md'
      await store.replaceSource({ source, expectedRevision: null, sourceRevision: 'crash:1', entries: [entry(source, 'crash:1')] }, { operationId: 'crash-append' })
    } else {
      await store.compact()
    }
    throw new Error('Fault hook was not reached: ' + parameter)
  } else {
    throw new Error('Unknown worker mode: ' + mode)
  }
} finally {
  await store.close()
}
