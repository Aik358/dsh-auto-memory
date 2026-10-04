/** Durable continuation state. Old JSON files remain readable and untouched on
 * errors. New source latches are sharded: permanent identity, bounded record and
 * no growing in-memory Set or rewrite of all historical sources.
 * ★批次 W（2026-10-05，PR#210 拆取）：在 PR 原版基础上增加 (mtime,size) 读取缓存 ——
 *   isContinuedSession 每回合都会查闩（热路径），PR 原版每次都重读+重解析两个文件；
 *   现按「路径 → (mtimeMs,size,校验器,值)」缓存成功读取，writeStateJson 成功后失效，
 *   从未落盘/被外部改写由 mtime+size 变化自然击穿（同刻同长改写为已知取舍）。 */
import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { withSharedStateLock } from './shared-state-lock.js'

export function stateError(message, cause) {
  return Object.assign(new Error(message, cause ? { cause } : undefined), { statePersistence: true, code: cause?.code || 'STATE_INVALID' })
}
function rejectFileAlias(file) {
  try { if (fs.lstatSync(file).isSymbolicLink()) throw stateError('state-file-symlink refused: ' + file) }
  catch (e) { if (e.code !== 'ENOENT') throw e }
}
// ★批次 W：状态读取缓存（模块级；仅缓存「校验通过的成功读取」）。
const stateReadCache = new Map()
const STATE_READ_CACHE_MAX = 1024
// 缓存命中必须返回**副本**：调用方（如 allocContSeq）会对读出的状态就地改写，
// 若共享同一对象，一次写失败的中间态就会污染缓存（实测 cont-seq 复现过 32≠31）。
const cloneStateValue = (v) => (v && typeof v === 'object' ? structuredClone(v) : v)
function cachedStateRead(file, st, validate, compute) {
  const hit = stateReadCache.get(file)
  if (hit && hit.validate === validate && hit.mtimeMs === st.mtimeMs && hit.size === st.size) {
    // LRU 触碰：命中项移到末尾，避免高频项被冷项挤出。
    stateReadCache.delete(file); stateReadCache.set(file, hit)
    return cloneStateValue(hit.value)
  }
  const value = compute()
  if (stateReadCache.size >= STATE_READ_CACHE_MAX) stateReadCache.delete(stateReadCache.keys().next().value)
  stateReadCache.set(file, { mtimeMs: st.mtimeMs, size: st.size, validate, value })
  return cloneStateValue(value)
}
export function readStateJson(file, missing, validate, maxBytes = 32 * 1024 * 1024) {
  let st = null
  try { st = fs.statSync(file) } catch (e) { if (e.code === 'ENOENT') return missing }
  if (st) {
    try {
      return cachedStateRead(file, st, validate, () => {
        rejectFileAlias(file)
        if (st.size > maxBytes) throw new Error('state file exceeds safe read limit')
        const raw = fs.readFileSync(file)
        return validate(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)))
      })
    } catch (e) {
      if (e.code === 'ENOENT') return missing
      throw stateError('state read failed: ' + file + ': ' + e.message, e)
    }
  }
  // stat 失败但非 ENOENT（权限等）：不做缓存，走严格读路径如实报错。
  try {
    rejectFileAlias(file)
    const raw = fs.readFileSync(file)
    return validate(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)))
  } catch (e) {
    if (e.code === 'ENOENT') return missing
    throw stateError('state read failed: ' + file + ': ' + e.message, e)
  }
}
export function writeStateJson(file, value) {
  const tmp = file + '.' + randomUUID() + '.tmp'
  let fd, created = false
  try {
    rejectFileAlias(file)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fd = fs.openSync(tmp, 'wx', 0o600); created = true
    const serialized = JSON.stringify(value, null, 2)
    if (Buffer.byteLength(serialized) > 32 * 1024 * 1024) throw new Error('state file exceeds safe write limit')
    fs.writeFileSync(fd, serialized, 'utf8')
    fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined
    rejectFileAlias(file)
    fs.renameSync(tmp, file)
    stateReadCache.delete(file) // ★批次 W：写入成功即失效缓存，下一读以盘上真相重建
  } catch (e) { throw stateError('state persist failed: ' + file + ': ' + e.message, e) }
  finally {
    if (fd !== undefined) { try { fs.closeSync(fd) } catch (_) {} }
    if (created) { try { fs.unlinkSync(tmp) } catch (e) { if (e.code !== 'ENOENT') {/* old committed state remains authoritative */} } }
  }
}
const object = v => v && typeof v === 'object' && !Array.isArray(v)
const counter = v => Number.isSafeInteger(v) && v >= 0
export function parseContState(v) {
  if (!object(v) || !counter(v.last) || (v.byWorkspace !== undefined && !object(v.byWorkspace))) throw new Error('invalid continuation counter')
  const byWs = Object.create(null)
  for (const [k,n] of Object.entries(v.byWorkspace || {})) {
    if (!counter(n)) throw new Error('invalid workspace counter')
    byWs[k] = n
  }
  return { last: v.last, byWs }
}
export function parseArchiveLedger(v) {
  if (!object(v)) throw new Error('invalid archive ledger')
  const out = Object.create(null)
  for (const [id, at] of Object.entries(v)) {
    if (!Number.isFinite(at) || at <= 0) throw new Error('invalid archive timestamp')
    out[id] = at
  }
  return out
}
// ★批次 W：校验器提升为具名函数 —— 缓存按函数同一性命中，内联闭包每次新建会永远 miss。
export function parseLegacySessions(value) {
  const records = Array.isArray(value) ? value : object(value) && Array.isArray(value.sessions) ? value.sessions : null
  if (!records) throw new Error('invalid continued-session state')
  return records.map(r => {
    const from = typeof r === 'string' ? r : object(r) ? r.from : null
    if (typeof from !== 'string' || !from.trim()) throw new Error('invalid continued source')
    return from.replace(/^session-/, '')
  })
}
export function validateSourceRecord(v) {
  if (!object(v) || (v.successorFormat !== undefined && v.successorFormat !== 'raw') || typeof v.from !== 'string' || !v.from || !['pending','done'].includes(v.status) || !Number.isFinite(v.at) || v.at <= 0 || (v.to !== undefined && (typeof v.to !== 'string' || Buffer.byteLength(v.to) > 4096)) || (v.status === 'pending' && (typeof v.token !== 'string' || !v.token))) throw new Error('invalid continued-source record')
  return v
}
export function legacyContinuedSessions(file) {
  return readStateJson(file, [], parseLegacySessions)
}
export function continuedSourceFile(file, sid) {
  if (typeof sid !== 'string' || !sid || Buffer.byteLength(sid) > 4096) throw stateError('invalid source identity')
  return path.join(path.dirname(file), 'auto-continue-done.d', createHash('sha256').update(sid).digest('hex') + '.json')
}
export function continuedSourceState(file, sid) {
  // Validate old evidence even when a modern record exists: corrupted old state
  // is never silently replaced or treated as "not continued".
  const legacy = legacyContinuedSessions(file)
  const record = readStateJson(continuedSourceFile(file,sid), null, validateSourceRecord, 65536)
  if (record && record.from !== sid) throw stateError('state read failed: ' + continuedSourceFile(file,sid) + ': invalid continued-source record')
  return record || (legacy.includes(sid) ? { from: sid, status: 'done', legacy: true } : null)
}
export async function reserveContinuedSource(file, sid) {
  return withSharedStateLock(continuedSourceFile(file,sid), async () => {
    if (continuedSourceState(file,sid)) throw stateError('source already continued or continuation pending: ' + sid)
    const token=randomUUID()
    writeStateJson(continuedSourceFile(file,sid),{from:sid,status:'pending',token,at:Date.now()})
    return token
  })
}
export async function finishContinuedSource(file, sid, to, token) {
  return withSharedStateLock(continuedSourceFile(file,sid), async () => {
    const old=continuedSourceState(file,sid)
    if (old?.status === 'done') return false
    if (!old && token) throw stateError('continuation reservation missing')
    if (old && old.token !== token) throw stateError('continuation reservation mismatch')
    if (Buffer.byteLength(to) > 4096) throw stateError('invalid successor identity')
    writeStateJson(continuedSourceFile(file,sid),{from:sid,to,successorFormat:'raw',status:'done',at:Date.now()})
    return true
  })
}
export async function releaseContinuedSource(file, sid, token) {
  return withSharedStateLock(continuedSourceFile(file,sid), async () => {
    const old=continuedSourceState(file,sid)
    if (old?.status !== 'pending' || old.token !== token) throw stateError('continuation reservation mismatch')
    try { fs.unlinkSync(continuedSourceFile(file,sid)); stateReadCache.delete(continuedSourceFile(file,sid)) } catch(e) { throw stateError('continuation reservation release failed',e) }
  })
}

export async function setContinuedSourceTarget(file, sid, to, token) {
  return withSharedStateLock(continuedSourceFile(file,sid), async () => {
    const old=continuedSourceState(file,sid)
    if (old?.status !== 'pending' || old.token !== token) throw stateError('continuation reservation mismatch')
    if (Buffer.byteLength(to) > 4096) throw stateError('invalid successor identity')
    writeStateJson(continuedSourceFile(file,sid),{...old,to,successorFormat:'raw'})
  })
}

// Official maintenance entry point. Verification is supplied explicitly by the
// operator; the plugin never infers non-delivery from age, PID or error strings.
export async function recoverContinuedSource(file, sid, { action, token, expectedSuccessor, successor, confirmed }) {
  if (!confirmed || !['complete','release'].includes(action) || typeof expectedSuccessor !== 'string') throw stateError('explicit verification and expected successor are required')
  return withSharedStateLock(continuedSourceFile(file,sid)+'.active', () => withSharedStateLock(continuedSourceFile(file,sid), async () => {
    const old=continuedSourceState(file,sid)
    if (old?.status !== 'pending' || old.token !== token || (old.to || '') !== expectedSuccessor) throw stateError('stale or mismatched pending record')
    if (action === 'complete') {
      if (typeof successor !== 'string' || !successor || Buffer.byteLength(successor)>4096) throw stateError('verified raw successor required')
      if (old.to && (old.successorFormat==='raw' ? old.to!==successor : old.to.replace(/^session-/, '')!==successor.replace(/^session-/, ''))) throw stateError('successor mismatch')
      writeStateJson(continuedSourceFile(file,sid),{from:sid,to:successor,successorFormat:'raw',status:'done',at:Date.now()})
    } else {
      fs.unlinkSync(continuedSourceFile(file,sid))
      stateReadCache.delete(continuedSourceFile(file,sid))
    }
    return {ok:true,action,source:sid,successor:action==='complete'?successor:null}
  }), {timeoutMs:500})
}
export function continuedSourceView(file,sid,state=continuedSourceState(file,sid)) {
  if (!state || state.status!=='pending') return null
  return {source:sid,status:'pending',token:state.token,expectedSuccessor:state.to || '',successorId:state.successorFormat==='raw'?state.to || null:null,successorKey:state.to?.replace(/^session-/, '') || null,at:state.at,recoveryCommand:'node lib/continuation-maintenance.js status --source <SOURCE_ID>'}
}
