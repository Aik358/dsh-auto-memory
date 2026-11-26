import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { resolveDshHomePre } from '../dsh-home.js'
import { loopbackOrigin, revisionOf } from './contract.js'

const HEX_ID = /^[a-f0-9-]{36}$/
const KEY = /^[a-f0-9]{64}$/

function instanceDir(home, create) {
  const root = process.platform === 'win32'
    ? process.env.LOCALAPPDATA || path.join(homedir(), 'AppData', 'Local')
    : process.env.XDG_RUNTIME_DIR || path.join(homedir(), '.cache')
  if (!path.isAbsolute(root)) throw new Error('The account runtime directory must be absolute')
  const homeKey = revisionOf(process.platform === 'win32' ? path.resolve(home).toLowerCase() : path.resolve(home)).slice(0, 24)
  const parent = path.join(root, 'dsh-auto-memory-terminal')
  const dir = path.join(parent, homeKey)
  if (create) {
    mkdirSync(root, { recursive: true, mode: 0o700 })
    for (const entry of [parent, dir]) {
      try { mkdirSync(entry, { mode: 0o700 }) } catch (error) { if (error.code !== 'EEXIST') throw error }
      assertPrivate(lstatSync(entry), true)
    }
  } else {
    assertPrivate(lstatSync(parent), true)
    assertPrivate(lstatSync(dir), true)
  }
  return dir
}

function assertPrivate(stat, directory) {
  if (!(directory ? stat.isDirectory() : stat.isFile()) || stat.isSymbolicLink()) throw new Error('Invalid account discovery path')
  if (process.getuid && (stat.uid !== process.getuid() || (stat.mode & 0o077) !== 0)) throw new Error('Unsafe account discovery permissions')
}

export function newLocalKey() { return randomBytes(32).toString('hex') }

export function localProof(key, challenge) {
  return createHmac('sha256', Buffer.from(key, 'hex')).update(`auto-memory-terminal-v1:${challenge}`).digest('hex')
}

export function verifyKey(value, expected) {
  return typeof value === 'string' && KEY.test(value) && timingSafeEqual(Buffer.from(value, 'hex'), Buffer.from(expected, 'hex'))
}

export function publishInstance(identity, origin, key, home = resolveDshHomePre()) {
  const endpoint = loopbackOrigin(origin)
  if (!endpoint || !HEX_ID.test(identity.instanceId)) return () => {}
  const dir = instanceDir(home, true)
  const file = path.join(dir, identity.instanceId + '.json')
  writeFileSync(file, JSON.stringify({ identity, origin: endpoint.origin, key, pid: process.pid }), { flag: 'wx', mode: 0o600 })
  return () => rmSync(file, { force: true })
}

export function findLocalInstances(home = resolveDshHomePre()) {
  let dir
  try { dir = instanceDir(home, false) } catch (error) { if (error.code === 'ENOENT') return []; throw error }
  const live = []
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.json') || !HEX_ID.test(name.slice(0, -5))) continue
    try {
      const file = path.join(dir, name)
      const stat = lstatSync(file)
      assertPrivate(stat, false)
      if (stat.size > 4096) continue
      const record = JSON.parse(readFileSync(file, 'utf8'))
      if (record.identity?.instanceId !== name.slice(0, -5) || !loopbackOrigin(record.origin) || !KEY.test(record.key) || !Number.isInteger(record.pid) || record.pid <= 0) continue
      process.kill(record.pid, 0)
      live.push(record)
    } catch (error) {
      if (!['ESRCH', 'ENOENT'].includes(error.code) && !(error instanceof SyntaxError)) throw error
    }
  }
  return live
}
