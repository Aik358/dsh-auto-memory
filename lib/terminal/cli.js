#!/usr/bin/env node
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { parseArgs } from 'node:util'
import { connectDsh } from './client.js'
import { BODY_LIMIT, ContractError } from './contract.js'
import { clean } from './tui-text.js'
import { EXTERNAL_HARNESSES } from '../harness/external-hosts.js'

const installed = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8')).version
const harnesses = ['dsh', ...EXTERNAL_HARNESSES]
const help = `Auto Memory

  dam                                      Open the terminal workbench at the workspace picker
  dam status [--watch]                     Read live state
  dam doctor                               Check the active instance and scope
  dam api list | describe ID | call ID     Discover or call a plugin operation
  dam api receipt REQUEST_ID               Get the outcome of a write
  dam memory list | read | recall | source | note | storage
  dam board events | event | kanban | card | ledger | source | checkpoint
  dam jobs maintain | get
  dam settings get | set

Options
  --profile NAME          Select a running DSH profile
  --instance ID           Pin the selected plugin generation
  --expect-host-version V Require a specific running DSH version
  --url ORIGIN            Select a loopback DSH origin
  --dsh-home PATH         Select the DSH home used for local discovery
  --harness MODE          ${harnesses.join(', ')}
  --binding PATH          Use a bound external-host workspace
  --session ID            Select a verified DSH session when needed
  --workspace PATH        Browse a registered workspace
  --workspace-ref ID       Use the DSH workspace registry reference
  --input JSON            Supply operation arguments as an object
  --input-file PATH       Read UTF-8 JSON arguments (use - for stdin)
  --yes                   Confirm the exact operation and destination
  --request-id ID         Reuse the ID of an interrupted write
  --json                  Emit stable JSON (one record per line with --watch)
  --interval MS           Watch interval, at least 500 ms (default 2000)
  --help                  Show command help
  --version               Show the installed CLI version

Connection
  Start DSH with Auto Memory loaded. The CLI discovers the running local profile.
  Set DSH_CONNECT_URL with the official DSH launch URL for explicit authentication.
  Browse with --workspace or --workspace-ref. Pass --session for session-specific actions.
`

const options = Object.fromEntries([
  ...['help', 'version', 'json', 'yes', 'watch'].map(name => [name, { type: 'boolean' }]),
  ...['profile', 'instance', 'expect-host-version', 'url', 'dsh-home', 'harness', 'session', 'workspace', 'workspace-ref', 'input', 'input-file', 'interval', 'request-id',
    'binding'].map(name => [name, { type: 'string' }]),
])
options.help.short = 'h'
const aliases = new Map(Object.entries({
  'memory list': 'memory.list', 'memory overview': 'memory.overview', 'memory read': 'memory.read',
  'memory recall': 'memory.recall', 'memory source': 'memory.source', 'memory note': 'memory.note',
  'memory storage': 'memory.storage',
  'board events': 'board.events.list', 'board event': 'board.events.detail', 'board kanban': 'board.kanban',
  'board card': 'board.card', 'board ledger': 'board.ledger', 'board source': 'memory.source', 'board checkpoint': 'board.checkpoint.read',
  'jobs maintain': 'jobs.maintain.start', 'jobs get': 'jobs.get', 'settings get': 'settings.get',
  'settings set': 'settings.set',
}))

async function getInput(values) {
  if (values.input !== undefined && values['input-file'] !== undefined) {
    throw new ContractError('invalid-arguments', 'Choose --input or --input-file')
  }
  let content = values.input
  if (values['input-file'] === '-') {
    const chunks = []
    let bytes = 0
    for await (const chunk of process.stdin) {
      bytes += chunk.length
      if (bytes > BODY_LIMIT) throw new ContractError('input-too-large', 'Input exceeds the maximum body size')
      chunks.push(chunk)
    }
    content = Buffer.concat(chunks).toString('utf8')
  } else if (values['input-file'] !== undefined) content = await readFile(values['input-file'], 'utf8')
  if (content === undefined) return {}
  if (Buffer.byteLength(content) > BODY_LIMIT) throw new ContractError('input-too-large', 'Input exceeds the maximum body size')
  try {
    const parsed = JSON.parse(content.replace(/^\uFEFF/, ''))
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed
  } catch {}
  throw new ContractError('invalid-input', 'Provide one JSON object as input')
}

function json(value, indent) {
  return JSON.stringify(value, null, indent).replace(/[\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g,
    character => '\\u' + character.charCodeAt(0).toString(16).padStart(4, '0'))
}

function print(value, machine) {
  const output = machine ? json(value) : typeof value === 'string' ? clean(value) : json(value, 2)
  process.stdout.write(output + '\n')
}

function exitCode(error) {
  if (error.status === 400 || error.status === 413 || error.status === 415 || error.code?.startsWith('ERR_PARSE_ARGS')) return 2
  if (error.status === 401 || error.status === 403) return 3
  if (error.status === 404) return 4
  if (error.status === 409) return 5
  if (error.status >= 500) return 6
  return 1
}

async function run(argv) {
  const { positionals, values } = parseArgs({ args: argv, options, allowPositionals: true })
  const [top, child, identifier, ...extra] = positionals
  const harness = values.harness || 'dsh'
  if (values.help || top === 'help') return print(help.trimEnd(), false)
  if (values.version) return print(values.json ? { version: installed } : installed, values.json)
  if (!harnesses.includes(harness)) {
    throw new ContractError('unknown-harness', 'Choose ' + harnesses.join(', '))
  }
  if (extra.length) throw new ContractError('invalid-arguments', 'Unexpected positional argument')
  const interval = Number(values.interval ?? '2000')
  if (!Number.isSafeInteger(interval) || interval < 500 || interval > 3600000) {
    throw new ContractError('invalid-interval', 'Select an interval between 500 and 3600000 milliseconds')
  }
  if (values.watch && top !== 'status') throw new ContractError('invalid-arguments', '--watch is available for status')
  if (top === undefined && (values.json || !process.stdin.isTTY || !process.stdout.isTTY)) return print(help.trimEnd(), false)

  const { DSH_SESSION_ID, DSH_CONNECT_URL } = process.env
  const explicitWorkspace = values.workspace || values['workspace-ref']
  const browseWorkspaces = top === undefined && harness === 'dsh' && !values.session && !explicitWorkspace
  const sessionId = values.session || (harness === 'dsh' && !explicitWorkspace && !browseWorkspaces ? DSH_SESSION_ID : undefined)
  const scope = { ...(sessionId && { sessionId }), ...(values.workspace && { workspace: path.resolve(values.workspace) }),
    ...(values['workspace-ref'] && { workspaceRef: values['workspace-ref'] }) }
  let client
  if (harness === 'dsh') {
    client = connectDsh({
      profile: values.profile, instance: values.instance, url: values.url,
      connectUrl: values.url ? undefined : DSH_CONNECT_URL, home: values['dsh-home'], expectedHostVersion: values['expect-host-version'],
    })
  } else {
    const { connectExternalDsh } = await import('../harness/external-dsh-proxy.js')
    const bindingFile = values.binding || process.env.DAM_HARNESS_BINDING
    if (!bindingFile) throw new ContractError('binding-required', 'Provide --binding or DAM_HARNESS_BINDING for the selected host')
    client = await connectExternalDsh({ harness, bindingFile: path.resolve(bindingFile) })
  }
  if (top === undefined) {
    const { runTui } = await import('./tui.js')
    process.exitCode = await runTui({ client, scope, interval, browseWorkspaces })
    return
  }
  const controller = new AbortController()
  const signal = controller.signal
  const stop = () => controller.abort()
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
  let writeRequest
  try {
    const manifest = await client.discover({ scope, signal })
    const callOptions = { scope, signal, instanceId: manifest.identity.instanceId }
    if (top === 'doctor' && child === undefined) {
      const status = await client.call('status', {}, callOptions)
      return print({
        cliVersion: installed, mode: manifest.mode || harness, contractVersion: manifest.contractVersion, manifestVersion: manifest.manifestVersion,
        identity: manifest.identity, scope: manifest.scope || scope, status,
      }, values.json)
    }
    if (top === 'status' && child === undefined) {
      let previous
      do {
        const status = await client.call('status', {}, callOptions)
        if (status.revision !== previous || previous === undefined) print(status, values.json || values.watch)
        previous = status.revision
        if (values.watch) await delay(interval, undefined, { signal })
      } while (values.watch && !signal.aborted)
      return
    }
    if (top === 'api') {
      if (child === 'list' && identifier === undefined) return print(manifest, values.json)
      if (child === 'describe' && identifier) {
        const operation = manifest.operations.find(op => op.id === identifier)
        if (!operation) throw new ContractError('operation-not-found', 'Operation is outside the manifest', 404)
        return print(operation, values.json)
      }
      if (child === 'receipt' && identifier) {
        return print(await client.call('receipt', { requestId: identifier }, callOptions), values.json)
      }
    }
    const id = top === 'api' && child === 'call' ? identifier : identifier === undefined && aliases.get(top + ' ' + child)
    if (!id) throw new ContractError('unknown-command', 'Unknown command. Run dam --help')
    const args = await getInput(values)
    const operation = manifest.operations.find(op => op.id === id)
    if (!operation) throw new ContractError('operation-not-found', 'Operation is outside the manifest', 404)
    if (operation.status !== 'available') throw new ContractError('operation-unavailable', operation.reason || 'Operation is unavailable', 409)
    const requestId = values['request-id'] || (values.yes && operation.access !== 'read' ? randomUUID() : undefined)
    if (operation.access !== 'read' && values.yes) writeRequest = { requestId, instanceId: manifest.identity.instanceId }
    if (operation.access !== 'read' && values.yes && !values['request-id'] && !values.json) {
      process.stderr.write('Write request ' + requestId + '\n')
    }
    const result = await client.call(id, args, { ...callOptions, approved: values.yes, requestId })
    print(requestId && values.json ? { result, receipt: { requestId, state: 'finished' } } : result, values.json)
  } catch (error) {
    if (!signal.aborted) throw error
    if (writeRequest) {
      process.stderr.write((values.json ? json({ error: { code: 'interrupted-write', details: writeRequest } })
        : 'Interrupted write ' + writeRequest.requestId + '. Query its receipt before retrying.') + '\n')
    }
    process.exitCode = 130
  } finally {
    process.removeListener('SIGINT', stop)
    process.removeListener('SIGTERM', stop)
  }
}

process.stdout.on('error', error => {
  if (error.code === 'EPIPE') process.exit(0)
  throw error
})

try {
  await run(process.argv.slice(2))
} catch (error) {
  const code = error.code || 'error'
  const message = clean(error.message || error).replace(/\n/g, ' ')
  const detail = error.details
  const asJson = process.argv.includes('--json')
  process.stderr.write((asJson ? json({ error: { code, message, ...(detail && { details: detail }) } })
    : code + ' ' + message + (detail ? '\n' + json(detail, 2) : '')) + '\n')
  process.exitCode = exitCode(error)
}
