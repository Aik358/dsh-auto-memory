import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createInterface } from 'node:readline'

export async function withKimiAcp(kimi, cwd, env, exercise) {
  const child = spawn(process.execPath, [kimi, 'acp'], {
    cwd, env: { ...env, KIMI_CODE_TRUST_WORKSPACE: '1' }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
  })
  const pending = new Map()
  const approvals = []
  const updates = []
  let stderr = ''
  let id = 0
  let failure
  child.stderr.setEncoding('utf8').on('data', chunk => { stderr = (stderr + chunk).slice(-8000) })
  child.stdin.on('error', () => {})
  function abort(error) {
    failure = error
    for (const deferred of pending.values()) deferred.reject(error)
  }
  child.on('error', abort)
  const closed = once(child, 'close')
  closed.then(([code]) => abort(Error('Kimi ACP closed with ' + code + '\n' + stderr)), abort)
  const write = message => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n')
  const lines = createInterface({ input: child.stdout })
  lines.on('line', line => {
    try {
      const message = JSON.parse(line)
      if (message.method === 'session/request_permission') {
        const tool = message.params.toolCall
        const reject = message.params.options.find(option => option.kind === 'reject_once')
        assert.ok(reject, 'Kimi must offer the option to deny a tool call')
        approvals.push({ title: tool.title, toolCallId: tool.toolCallId, outcome: reject.kind })
        write({ id: message.id, result: { outcome: { outcome: 'selected', optionId: reject.optionId } } })
      } else if (message.method === 'session/update') {
        updates.push(message.params.update)
      } else if (message.id !== undefined && message.method !== undefined) {
        write({ id: message.id, error: { code: -32601, message: 'Method not implemented by QA client' } })
      } else {
        const deferred = pending.get(message.id)
        if (message.error) deferred?.reject(Error(JSON.stringify(message.error)))
        else deferred?.resolve(message.result)
      }
    } catch (error) {
      abort(error)
    }
  })
  async function request(method, params) {
    if (failure) throw failure
    const current = ++id
    const deferred = Promise.withResolvers()
    pending.set(current, deferred)
    const timer = setTimeout(() => deferred.reject(Error(method + ' timed out\n' + stderr)), 20_000)
    try {
      write({ id: current, method, params })
      return await deferred.promise
    } finally {
      clearTimeout(timer)
      pending.delete(current)
    }
  }
  try {
    const initialized = await request('initialize', { protocolVersion: 1, clientCapabilities: {} })
    assert.equal(initialized.protocolVersion, 1)
    return await exercise({ request, approvals, updates })
  } finally {
    lines.close()
    child.stdin.end()
    const timer = setTimeout(() => child.kill(), 5_000)
    try { await closed } finally { clearTimeout(timer) }
  }
}
