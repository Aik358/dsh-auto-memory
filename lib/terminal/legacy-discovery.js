import { execFile } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)
const desktopListeners = String.raw`
$currentSession = (Get-Process -Id $PID).SessionId
$owners = @(Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue |
    Where-Object SessionId -eq $currentSession | Select-Object -ExpandProperty Id)
if ($owners.Count) {
    Get-NetTCPConnection -OwningProcess $owners -State Listen -ErrorAction SilentlyContinue |
        Where-Object LocalAddress -eq '127.0.0.1' | Select-Object -ExpandProperty LocalPort -Unique
}
`

let probe
let validUntil = 0

export function detectDesktopOrigins() {
  if (process.platform !== 'win32' || !process.env.SystemRoot) return Promise.resolve([])
  if (Date.now() >= validUntil) {
    validUntil = Date.now() + 8000
    probe = scan()
  }
  return probe
}

async function scan() {
  const shell = path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  const { stdout } = await run(shell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', desktopListeners],
    { windowsHide: true, timeout: 5000, maxBuffer: 8192 }).catch(() => ({ stdout: '' }))
  const ports = stdout.split(/\s+/u).filter(port => /^[1-9]\d{0,4}$/.test(port) && Number(port) < 65536)
  const found = await Promise.all([...new Set(ports)].slice(0, 32).map(async port => {
    const origin = 'http://127.0.0.1:' + port
    const response = await fetch(origin + '/api/dsh-auto-memory/state', {
      method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(1000),
    }).catch(() => undefined)
    if (response?.status === 405 && response.headers.get('content-type')?.includes('application/json')) return origin
  }))
  return found.filter(Boolean)
}
