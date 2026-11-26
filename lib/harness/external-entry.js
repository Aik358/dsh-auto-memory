import { ExternalHostError } from './external-hosts.js'
import { connectExternalDsh } from './external-dsh-proxy.js'
import { serveExternalMcp } from './external-mcp.js'
import { formatKimiHookOutput } from './kimi.js'
import { formatAntigravityHookOutput } from './antigravity.js'

async function hookInput(signal) {
  const chunks = []
  let bytes = 0
  const onAbort = () => process.stdin.destroy()
  signal.addEventListener('abort', onAbort, { once: true })
  try {
    for await (const chunk of process.stdin) {
      bytes += chunk.length
      if (bytes > 1024 * 1024) throw new ExternalHostError('invalid-hook-event')
      chunks.push(chunk)
    }
    const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new ExternalHostError('invalid-hook-event')
    }
    return payload
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
}

const [harness, mode, bindingFile, hookEventName] = process.argv.slice(2)
const messageHookFormat = harness === 'kimi' || harness === 'cloud-code'
const emptyHookOutput = harness === 'antigravity' && hookEventName === 'Stop' ? '{"decision":"stop"}\n' : '{}\n'
try {
  if (!['hook', 'mcp'].includes(mode)) {
    throw new ExternalHostError('binding-unavailable')
  }
  const signal = AbortSignal.timeout(4_000)
  const payload = mode === 'hook' ? await hookInput(signal) : undefined
  const cwd = harness === 'antigravity' && payload?.workspacePaths?.length === 1
    ? payload.workspacePaths[0] : undefined
  const adapter = await connectExternalDsh({ harness, bindingFile, signal, ...(cwd ? { cwd } : {}) })
  if (mode === 'hook') {
    const result = await adapter.handleHook(payload, { signal, hookEventName })
    const output = messageHookFormat ? formatKimiHookOutput(result)
      : harness === 'antigravity' ? formatAntigravityHookOutput(result)
        : JSON.stringify(result.output ?? {}) + '\n'
    if (output) process.stdout.write(output)
    if (result.status === 'lifecycle-unavailable' || result.status === 'unavailable') {
      process.stderr.write('auto-memory: lifecycle-unavailable\n')
    }
  } else {
    await serveExternalMcp(adapter)
  }
} catch (error) {
  const code = error instanceof ExternalHostError ? error.code : 'binding-or-live-api-unavailable'
  process.stderr.write(`auto-memory: ${code}\n`)
  if (mode === 'hook') {
    if (!messageHookFormat) process.stdout.write(emptyHookOutput)
  }
  else process.exitCode = 1
}
