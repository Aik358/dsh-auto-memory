import { createHash } from 'node:crypto'
import path from 'node:path'

export function workspaceIdentity(ws) {
  const raw = String(ws || '')
  const windows = /^[A-Za-z]:[\\/]/.test(raw) || raw.startsWith('\\\\')
  const value = (windows ? path.win32 : path.posix).resolve(raw)
  return windows ? value.replace(/\\/g, '/').toLowerCase() : value
}

export function workspaceKey(ws) {
  if (!ws) return 'default'
  return 'ws-v2-' + createHash('sha256').update(workspaceIdentity(ws)).digest('hex')
}

export function legacyWorkspaceKey(ws) {
  if (!ws) return 'default'
  return '--' + String(ws).replace(/[\\/:*?"<>|]/g, '-') + '--'
}
