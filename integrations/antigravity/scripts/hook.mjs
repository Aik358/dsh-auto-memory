import { spawnSync } from 'node:child_process'
import { isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const eventName = process.argv[2]
const emptyOutput = eventName === 'Stop' ? '{"decision":"stop"}\n' : '{}\n'
const chunks = []
let bytes = 0

for await (const chunk of process.stdin) {
  bytes += chunk.length
  if (bytes > 1024 * 1024) {
    process.stdout.write(emptyOutput)
    process.exit(0)
  }
  chunks.push(chunk)
}

try {
  const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  if (!Array.isArray(payload?.workspacePaths) || payload.workspacePaths.length !== 1) {
    throw new Error('invalid workspace')
  }
  const [workspace] = payload.workspacePaths
  if (typeof workspace !== 'string' || !isAbsolute(workspace)) throw new Error('invalid workspace')

  const root = fileURLToPath(new URL('..', import.meta.url))
  const entry = join(root, 'lib', 'harness', 'external-entry.js')
  const binding = join(workspace, '.agents', 'auto-memory-antigravity.json')
  const result = spawnSync(process.execPath, [entry, 'antigravity', 'hook', binding, eventName], {
    cwd: workspace,
    input: JSON.stringify(payload),
    encoding: 'utf8',
    timeout: 4500,
    windowsHide: true,
  })

  process.stdout.write(result.stdout || emptyOutput)
  if (result.stderr) process.stderr.write(result.stderr)
} catch {
  process.stdout.write(emptyOutput)
}
