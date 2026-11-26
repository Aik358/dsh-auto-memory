import { execFile } from 'node:child_process'
import { constants } from 'node:fs'
import { access, open, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { connectExternalDsh } from '../harness/external-dsh-proxy.js'
import { EXTERNAL_HARNESSES } from '../harness/external-hosts.js'
import { ContractError } from './contract.js'

const exec = promisify(execFile)
const windows = process.platform === 'win32'
const catalog = [
  { id: 'dsh', name: 'DeepSeek Harness', commands: ['dsh'], processes: ['DeepSeek Harness', 'dsh'], configs: ['~/.dsh/profiles/desktop/package.json'] },
  { id: 'codex', name: 'Codex', commands: ['codex'], configs: ['$CODEX_HOME/config.toml', '$CODEX_HOME/hooks.json', '~/.codex/config.toml', '~/.codex/hooks.json', '.codex/config.toml', '.codex/hooks.json'] },
  { id: 'claude', name: 'Claude Code', commands: ['claude'], configs: ['$CLAUDE_CONFIG_DIR/settings.json', '~/.claude/settings.json', '~/.claude.json', '.claude/settings.json', '.claude/settings.local.json', '.mcp.json'] },
  { id: 'zcode', name: 'ZCode', commands: ['zcode'], configs: ['~/.zcode/settings.json', '~/.zcode/mcp.json', '.zcode-plugin/plugin.json', 'hooks/hooks.json'] },
  { id: 'opencode', name: 'OpenCode', commands: ['opencode'], configs: ['$OPENCODE_CONFIG', '$XDG_CONFIG_HOME/opencode/opencode.json', '~/.config/opencode/opencode.json', '~/.config/opencode/opencode.jsonc', 'opencode.json', 'opencode.jsonc'] },
  { id: 'kimi', name: 'Kimi Code', commands: ['kimi', 'kimi-code'], configs: ['$KIMI_CODE_HOME/config.toml', '$KIMI_CODE_HOME/mcp.json', '~/.kimi-code/config.toml', '~/.kimi-code/mcp.json', '.kimi-code/mcp.json'] },
  { id: 'antigravity', name: 'Antigravity', commands: ['antigravity', 'agy'], configs: ['~/.gemini/antigravity/mcp_config.json', '~/.gemini/antigravity-cli/settings.json', '.antigravity/mcp_config.json'], apps: ['Antigravity'] },
  { id: 'cloud-code', name: 'Cloud Code', commands: ['cloud-code'], configs: [] },
  { id: 'claude-desktop', name: 'Claude Desktop', commands: [], processes: ['claude-desktop'],
    apps: ['Claude'], configs: ['$APPDATA/Claude/claude_desktop_config.json', '~/Library/Application Support/Claude/claude_desktop_config.json'] },
  { id: 'gemini', name: 'Gemini CLI', commands: ['gemini'], configs: ['~/.gemini/settings.json', '.gemini/settings.json'] },
  { id: 'openclaw', name: 'OpenClaw', commands: ['openclaw'], configs: ['$OPENCLAW_CONFIG_PATH', '~/.openclaw/openclaw.json'] },
  { id: 'hermes', name: 'Hermes Agent', commands: ['hermes'], configs: ['$HERMES_HOME/config.yaml', '~/.hermes/config.yaml'] },
  { id: 'pi', name: 'Pi', commands: ['pi'], configs: ['$PI_CODING_AGENT_DIR/settings.json', '~/.pi/agent/settings.json', '~/.pi/agent/models.json'] },
  { id: 'mcode', name: 'MiniMax Code', commands: ['mcode'], configs: ['$MINIMAX_DATA_DIR/config.yaml', '$MAVIS_DATA_DIR/config.yaml', '~/.minimax/config.yaml'] },
  { id: 'omp', name: 'Oh My Pi', commands: ['omp'], configs: ['~/.omp/agent/models.yml'] },
  { id: 'copilot', name: 'GitHub Copilot', commands: ['copilot'], configs: ['~/.copilot/config.json'] },
  { id: 'codebuddy', name: 'CodeBuddy', commands: ['codebuddy'], configs: ['~/.codebuddy/settings.json', '~/.codebuddycn/settings.json'], apps: ['CodeBuddy'] },
  { id: 'workbuddy', name: 'WorkBuddy', commands: ['workbuddy'], configs: ['~/.workbuddy/settings.json'], apps: ['WorkBuddy'] },
  { id: 'grok', name: 'Grok Build', commands: ['grok', 'grokbuild'], configs: ['~/.grok/config.toml'] },
]

const readLimit = 1024 * 1024

function localPath(template, env, cwd) {
  if (template.startsWith('~/')) return path.join(homedir(), template.slice(2))
  const variable = /^\$(\w+)(?:\/(.*))?$/.exec(template)
  if (!variable) return path.resolve(cwd, template)
  const value = env[variable[1]]
  if (value && path.isAbsolute(value)) return path.join(value, variable[2] ?? '')
}

async function fileExists(file, mode) {
  if (!file) return false
  try {
    if (mode !== undefined) await access(file, mode)
    return (await stat(file)).isFile()
  } catch {
    return false
  }
}

async function readConfig(file) {
  let handle
  try {
    handle = await open(file, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0))
    const info = await handle.stat()
    if (!info.isFile() || info.size > readLimit) return ''
    const buffer = Buffer.alloc(info.size)
    const { bytesRead } = await handle.read(buffer)
    return buffer.toString('utf8', 0, bytesRead)
  } catch {
    return ''
  } finally {
    await handle?.close()
  }
}

function normalize(name) {
  return path.basename(name.trim()).replace(/\.(?:exe|cmd|bat|ps1)$/iu, '').toLowerCase()
}

const windowsInventory = String.raw`
$session = (Get-Process -Id $PID).SessionId
Get-Process | Where-Object SessionId -eq $session | ForEach-Object { "P:" + $_.ProcessName }
$keys = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
        'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
        'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'
Get-ItemProperty -Path $keys -ErrorAction SilentlyContinue | Where-Object {
    $_.DisplayName -and $_.InstallLocation -and (Test-Path -LiteralPath $_.InstallLocation -PathType Container)
} | ForEach-Object { "A:" + $_.DisplayName }
`

async function systemInventory(env, signal) {
  try {
    const program = windows ? path.join(env.SystemRoot ?? 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe') : 'ps'
    const args = windows
      ? ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', windowsInventory]
      : ['-u', String(process.getuid()), '-o', 'comm=']
    const { stdout } = await exec(program, args, { env, signal, windowsHide: true, timeout: 3500, maxBuffer: 256 * 1024 })
    const lines = stdout.split(/\r?\n/u)
    return {
      names: new Set((windows ? lines.filter(line => line.startsWith('P:')).map(line => line.slice(2)) : lines).map(normalize)),
      applications: new Set(lines.filter(line => line.startsWith('A:')).map(line => normalize(line.slice(2)))),
    }
  } catch {
    return {}
  }
}

async function executable(host, env) {
  const dirs = (env.PATH ?? env.Path ?? '').split(path.delimiter).map(dir => dir.replace(/^"|"$/gu, '')).filter(path.isAbsolute)
  const extensions = windows ? ['.exe', '.cmd', '.bat', '.ps1'] : ['']
  const candidates = dirs.flatMap(dir => host.commands.flatMap(command => extensions.map(ext => path.join(dir, command + ext))))
  for (const name of host.apps ?? []) {
    if (windows && env.LOCALAPPDATA) candidates.push(path.join(env.LOCALAPPDATA, 'Programs', name, name + '.exe'))
    if (process.platform === 'darwin') candidates.push(path.join('/Applications', name + '.app', 'Contents', 'MacOS', name))
  }
  const matches = await Promise.all(candidates.map(file => fileExists(file, windows ? constants.F_OK : constants.X_OK)))
  return candidates[matches.indexOf(true)]
}

function bridgeRegistration(content, id) {
  const config = content.replace(/^\s*(?:#|\/\/).*$/gmu, '')
  // Require the documented bridge entry plus its host selector.
  const command = new RegExp(`external-entry\\.js(?:\\\\)?["']?[\\s,]+["']?${id}["']?[\\s,]+["']?(?:hook|mcp)\\b`, 'iu')
  return command.test(config) || (id === 'opencode' && /[/\\]harness[/\\]opencode\.js/iu.test(config))
}

async function bridgeStatus(host, registered, bindingFile, signal) {
  if (!EXTERNAL_HARNESSES.includes(host.id)) return { state: 'observe-only' }
  if (!bindingFile) return { state: registered ? 'registered' : 'unbound' }
  try {
    const content = await readConfig(bindingFile)
    const binding = JSON.parse(content)
    if (binding?.harness !== host.id || binding.version !== 1 || !path.isAbsolute(binding.workspace ?? '')) {
      return { state: 'binding-error', reason: 'invalid-binding' }
    }
    const adapter = await connectExternalDsh({ harness: host.id, bindingFile, cwd: binding.workspace, signal })
    const manifest = await adapter.discover({ signal })
    const status = manifest.operations.find(operation => operation.id === 'status')
    if (!status) return { state: 'binding-error', reason: 'status-unavailable' }
    await adapter.call('status', {}, { signal, instanceId: manifest.identity.instanceId })
    return { state: 'connected', workspace: adapter.boundHost.workspace, operations: manifest.operations.length }
  } catch (error) {
    return { state: 'binding-error', reason: error instanceof ContractError ? error.code : 'binding-unavailable' }
  }
}

export async function scanHarnesses({ cwd = process.cwd(), env = process.env, signal, client, bindingFile, bindingHarness } = {}) {
  const system = systemInventory(env, signal)
  const requested = bindingFile || env.DAM_HARNESS_BINDING
  const bindingRoot = env.DAM_BINDINGS_DIR || (windows && env.LOCALAPPDATA
    ? path.join(env.LOCALAPPDATA, 'AutoMemory', 'bindings')
    : path.join(env.XDG_CONFIG_HOME || path.join(homedir(), '.config'), 'auto-memory', 'bindings'))
  let requestedHost = bindingHarness
  if (requested && !requestedHost) {
    try { requestedHost = JSON.parse(await readConfig(path.resolve(cwd, requested))).harness } catch {}
  }
  const rows = await Promise.all(catalog.map(async host => {
    const [{ names, applications }, command] = await Promise.all([system, executable(host, env)])
    const aliases = [...host.commands, ...(host.processes ?? []), ...(host.apps ?? [])].map(normalize)
    const ambiguousClaude = ['claude', 'claude-desktop'].includes(host.id) && names?.has('claude') && !names.has('claude-desktop')
    const running = names && !ambiguousClaude ? aliases.some(name => names.has(name)) : null
    const registeredApp = [host.name, ...(host.apps ?? [])].some(name => applications?.has(normalize(name)))
    const configs = [...new Set(host.configs.map(file => localPath(file, env, cwd)).filter(Boolean))]
    const files = (await Promise.all(configs.map(async file => await fileExists(file) ? file : undefined))).filter(Boolean)
    const registered = EXTERNAL_HARNESSES.includes(host.id) &&
      (await Promise.all(files.map(async file => bridgeRegistration(await readConfig(file), host.id)))).some(Boolean)
    let memory
    if (host.id === 'dsh') {
      memory = { state: 'checking' }
      if (client) {
        try {
          const manifest = await client.discover({ signal })
          await client.call('status', {}, { signal, instanceId: manifest.identity.instanceId })
          memory = { state: manifest.mode === 'dsh-legacy' ? 'legacy' : 'connected', operations: manifest.operations.length }
        } catch (error) {
          memory = { state: 'offline', reason: error.code ?? 'connection-failed' }
        }
      }
    } else {
      const defaultBinding = path.resolve(bindingRoot, host.id + '.json')
      const file = requested && requestedHost === host.id ? path.resolve(cwd, requested)
        : await fileExists(defaultBinding) ? defaultBinding : undefined
      const deadline = AbortSignal.timeout(3800)
      memory = await bridgeStatus(host, registered, file, signal ? AbortSignal.any([signal, deadline]) : deadline)
    }
    return { id: host.id, name: host.name, installed: Boolean(command || running || registeredApp), running,
      executable: command, configFiles: files, memory }
  }))
  signal?.throwIfAborted()
  return { version: 1, harnesses: rows }
}
