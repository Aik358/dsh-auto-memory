import { spawnSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'

const [entry, binding, trace, harness = 'kimi'] = process.argv.slice(2)
const chunks = []
for await (const chunk of process.stdin) chunks.push(chunk)
const input = Buffer.concat(chunks)
const event = JSON.parse(input)
const permission = ['PermissionRequest', 'PermissionResult'].includes(event.hook_event_name)
const result = permission ? null : spawnSync(process.execPath, [entry, harness, 'hook', binding], {
  input, encoding: 'utf8', timeout: 5500, windowsHide: true,
})
appendFileSync(trace, JSON.stringify({
  name: event.hook_event_name, sessionId: event.session_id, source: event.source,
  trigger: event.trigger, reason: event.hook_event_name === 'SessionEnd' ? event.reason : undefined,
  turnId: event.turn_id, ...(permission ? { tool: event.tool_name } : {}),
  context: Boolean(result?.stdout?.trim()), code: result?.status, diagnostic: result?.stderr?.trim() || undefined,
}) + '\n')
if (result?.stdout) process.stdout.write(result.stdout)
if (result?.stderr) process.stderr.write(result.stderr)
process.exitCode = result?.status ?? 0
