import { mkdir, realpath, lstat, readFile, readdir, open, rename, rm } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { withSharedStateLock } from '../../lib/shared-state-lock.js'
import { decodeEnvelope, encodeEnvelope, IndexStorageError } from './codec.js'

const MANIFEST_SCHEMA = 'sidecar_manifest_v1'
const CHECKPOINT_SCHEMA = 'sidecar_checkpoint_v1'
const JOURNAL_SCHEMA = 'sidecar_journal_v1'
const GENERATION = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/
const RETRY_CODES = new Set(['UNKNOWN', 'EPERM', 'EACCES', 'EBUSY'])
const RETRY_DELAYS = [0, 10, 40, 100, 250]

async function retry(job) {
  for (let attempt = 0; ; attempt++) {
    if (RETRY_DELAYS[attempt]) await delay(RETRY_DELAYS[attempt])
    try { return await job() } catch (error) {
      if (!RETRY_CODES.has(error.code) || attempt === RETRY_DELAYS.length - 1) throw error
    }
  }
}

async function assertRegularFile(file) {
  const info = await lstat(file)
  if (!info.isFile() || info.isSymbolicLink()) throw new IndexStorageError('INDEX_UNSAFE_PATH', 'Index data must be a regular file: ' + file)
}

async function readRegular(file) {
  await assertRegularFile(file)
  return retry(() => readFile(file))
}

async function publishedFile(job, file) {
  try { return await job() } catch (error) {
    if (error.code === 'ENOENT') throw new IndexStorageError('INDEX_CORRUPT', 'A published index file is missing: ' + file, { cause: error })
    throw error
  }
}

async function atomicWrite(file, text, durable) {
  const temporary = file + '.' + process.pid + '.' + randomUUID() + '.tmp'
  let published = false
  try {
    await retry(async () => {
      const fd = await open(temporary, 'w')
      try { await fd.writeFile(text, 'utf8'); if (durable) await fd.sync() } finally { await fd.close() }
    })
    await retry(() => rename(temporary, file))
    published = true
  } finally {
    if (!published) await rm(temporary, { force: true }).catch(() => {})
  }
}

function requireArgument(condition, message) {
  if (!condition) throw new IndexStorageError('INDEX_INVALID_ARGUMENT', message)
}

function requireValid(condition, message) {
  if (!condition) throw new IndexStorageError('INDEX_CORRUPT', message)
}

/**
 * A local, cooperating-process journal backend. Public consumers use SidecarStore.
 * Every disk operation is obtained through withLock(); complete invalid rows are
 * rejected, only an unterminated final row may be truncated under that lock.
 * File sync is optional and does not claim parent-directory/power-loss safety.
 */
export class JournalStorage {
  #directory
  #workspaceKey
  #durable
  #lockTimeoutMs
  #fault
  #cursor = null
  #queue = Promise.resolve()
  #closed = false
  #paths = null
  #everInitialized = false

  static async open({ directory, workspaceKey, durable = true, lockTimeoutMs = 10000, fault } = {}) {
    requireArgument(typeof directory === 'string' && directory.length > 0, 'directory is required')
    requireArgument(typeof workspaceKey === 'string' && workspaceKey.length > 0, 'workspaceKey is required')
    requireArgument(typeof durable === 'boolean', 'durable must be boolean')
    requireArgument(Number.isFinite(lockTimeoutMs) && lockTimeoutMs > 0, 'lockTimeoutMs must be positive')
    requireArgument(fault === undefined || typeof fault === 'function', 'fault must be a function')
    const absolute = path.resolve(directory)
    await mkdir(absolute, { recursive: true })
    const physical = await realpath(absolute)
    return new JournalStorage({ directory: physical, workspaceKey, durable, lockTimeoutMs, fault })
  }

  constructor({ directory, workspaceKey, durable, lockTimeoutMs, fault }) {
    this.#directory = directory
    this.#workspaceKey = workspaceKey
    this.#durable = durable
    this.#lockTimeoutMs = lockTimeoutMs
    this.#fault = fault
  }

  getInfo() {
    return {
      directory: this.#directory,
      manifestPath: path.join(this.#directory, 'manifest.json'),
      lockPath: path.join(this.#directory, 'manifest.json.lock'),
      checkpointPath: this.#paths?.checkpointPath ?? null,
      journalPath: this.#paths?.journalPath ?? null,
      generation: this.#cursor?.generation ?? null,
      seq: this.#cursor?.seq ?? 0,
      journalBytes: this.#cursor?.offset ?? 0,
      durable: this.#durable,
    }
  }

  invalidate() { this.#cursor = null; this.#paths = null }

  /** A callback's transaction handle expires before releasing the shared lock. */
  async withLock(callback) {
    requireArgument(typeof callback === 'function', 'withLock requires a callback')
    if (this.#closed) throw new IndexStorageError('INDEX_CLOSED', 'The journal storage is closed')
    const task = this.#queue.then(() => withSharedStateLock(this.getInfo().manifestPath, async () => {
      let active = true
      const guard = job => (...args) => {
        if (!active) throw new IndexStorageError('INDEX_TRANSACTION_CLOSED', 'The journal transaction has ended')
        return job(...args)
      }
      const tx = Object.freeze({
        read: guard(() => this.#read()),
        initialize: guard(checkpoint => this.#initialize(checkpoint)),
        append: guard(payload => this.#append(payload)),
        compact: guard(checkpoint => this.#compact(checkpoint)),
        info: guard(() => this.getInfo()),
      })
      try { return await callback(tx) } catch (error) { this.invalidate(); throw error } finally { active = false }
    }, { timeoutMs: this.#lockTimeoutMs }))
    this.#queue = task.catch(() => {})
    return task
  }

  async close() { this.#closed = true; await this.#queue; this.invalidate() }

  async #manifest() {
    let bytes
    try { bytes = await readRegular(this.getInfo().manifestPath) } catch (error) {
      if (error.code === 'ENOENT') {
        const files = await readdir(this.#directory)
        const hasGenerationFiles = files.some(name => name.startsWith('checkpoint-') || name.startsWith('journal-'))
        if (this.#everInitialized || hasGenerationFiles) {
          throw new IndexStorageError('INDEX_CORRUPT', 'Index manifest is missing while generation data remains; explicit recovery is required')
        }
        return null
      }
      throw error
    }
    const manifest = decodeEnvelope(bytes, 'index manifest')
    requireValid(manifest.schema === MANIFEST_SCHEMA, 'Unsupported index manifest schema')
    requireValid(manifest.ws === this.#workspaceKey, 'Index manifest workspace does not match the requested workspace')
    requireValid(typeof manifest.generation === 'string' && GENERATION.test(manifest.generation), 'Invalid index generation')
    requireValid(manifest.checkpoint === `checkpoint-${manifest.generation}.json`, 'Invalid checkpoint filename')
    requireValid(manifest.journal === `journal-${manifest.generation}.jsonl`, 'Invalid journal filename')
    this.#everInitialized = true
    return manifest
  }

  async #read() {
    const manifest = await this.#manifest()
    if (!manifest) {
      if (this.#cursor) throw new IndexStorageError('INDEX_CORRUPT', 'An initialized index manifest disappeared')
      return { initialized: false, checkpoint: null, records: [], generation: null, seq: 0, journalBytes: 0, recoveredTailBytes: 0 }
    }
    const paths = {
      checkpointPath: path.join(this.#directory, manifest.checkpoint),
      journalPath: path.join(this.#directory, manifest.journal),
    }
    let checkpoint = null
    let cursor = this.#cursor
    if (!cursor || cursor.generation !== manifest.generation) {
      const envelope = decodeEnvelope(await publishedFile(() => readRegular(paths.checkpointPath), paths.checkpointPath), 'index checkpoint')
      requireValid(envelope.schema === CHECKPOINT_SCHEMA && envelope.generation === manifest.generation && envelope.ws === this.#workspaceKey, 'Checkpoint does not belong to the published generation')
      requireValid(Number.isSafeInteger(envelope.seq) && envelope.seq >= 0, 'Invalid checkpoint sequence')
      requireValid(envelope.payload && typeof envelope.payload === 'object' && envelope.payload.seq === envelope.seq && envelope.payload.view?.ws === this.#workspaceKey, 'Invalid checkpoint payload identity')
      checkpoint = envelope.payload
      cursor = { generation: manifest.generation, seq: envelope.seq, offset: 0 }
    }
    await publishedFile(() => assertRegularFile(paths.journalPath), paths.journalPath)
    const fd = await publishedFile(() => retry(() => open(paths.journalPath, 'r+')), paths.journalPath)
    let recoveredTailBytes = 0
    const records = []
    let offset = cursor.offset
    let seq = cursor.seq
    try {
      const info = await fd.stat()
      requireValid(info.size >= offset, 'The current generation journal shrank before its verified offset')
      const suffix = Buffer.alloc(info.size - offset)
      let read = 0
      while (read < suffix.length) {
        const part = await fd.read(suffix, read, suffix.length - read, offset + read)
        requireValid(part.bytesRead > 0, 'Index journal changed while reading under the index lock')
        read += part.bytesRead
      }
      const completeLength = suffix.lastIndexOf(0x0a) + 1
      let start = 0
      while (start < completeLength) {
        const end = suffix.indexOf(0x0a, start)
        requireValid(end > start, 'Empty committed journal row')
        const record = decodeEnvelope(suffix.subarray(start, end), `journal row at byte ${offset + start}`)
        requireValid(record.schema === JOURNAL_SCHEMA && record.generation === manifest.generation, 'Journal record belongs to another schema or generation')
        requireValid(record.seq === seq + 1, 'Journal sequence is missing, duplicated, or reordered')
        requireValid(typeof record.operationId === 'string' && record.operationId.length > 0 && typeof record.requestHash === 'string' && /^[a-f0-9]{64}$/.test(record.requestHash) && Array.isArray(record.changes) && typeof record.parserVersion === 'string' && record.parserVersion.length > 0 && typeof record.rebuiltAt === 'string', 'Invalid journal transaction payload')
        records.push(record)
        seq = record.seq
        start = end + 1
      }
      recoveredTailBytes = suffix.length - completeLength
      if (recoveredTailBytes) {
        await fd.truncate(offset + completeLength)
      }
      // A writer may have failed after writing a complete line but before sync.
      // Replayed receipts must cross the file sync barrier before a durable
      // reader can acknowledge a retry as already applied.
      if (this.#durable && (recoveredTailBytes || records.length)) await fd.sync()
      offset += completeLength
    } finally { await fd.close() }
    this.#cursor = { generation: manifest.generation, seq, offset }
    this.#paths = paths
    return { initialized: true, checkpoint, records, generation: manifest.generation, seq, journalBytes: offset, recoveredTailBytes }
  }

  async #initialize(checkpoint) {
    const existing = await this.#manifest()
    if (existing) throw new IndexStorageError('INDEX_ALREADY_INITIALIZED', 'The index already has a published generation')
    requireArgument(checkpoint?.seq === 0, 'The initial checkpoint sequence must be zero')
    return this.#publish(checkpoint, 'initialize')
  }

  async #append(payload) {
    const current = await this.#read()
    if (!current.initialized) throw new IndexStorageError('INDEX_NOT_INITIALIZED', 'Initialize a checkpoint before appending')
    requireArgument(payload && typeof payload === 'object' && !Array.isArray(payload), 'append requires a transaction payload')
    for (const key of ['schema', 'generation', 'seq', 'checksum']) requireArgument(!Object.hasOwn(payload, key), 'Reserved journal key: ' + key)
    requireArgument(typeof payload.operationId === 'string' && payload.operationId.length > 0, 'operationId is required')
    requireArgument(typeof payload.requestHash === 'string' && /^[a-f0-9]{64}$/.test(payload.requestHash), 'requestHash must be SHA-256 hex')
    requireArgument(Array.isArray(payload.changes), 'changes must be an array')
    requireArgument(typeof payload.parserVersion === 'string' && payload.parserVersion.length > 0, 'parserVersion must be a nonempty string')
    requireArgument(typeof payload.rebuiltAt === 'string', 'rebuiltAt must be a string')
    requireValid(current.seq < Number.MAX_SAFE_INTEGER, 'Journal sequence exhausted the safe integer range')
    const core = { schema: JOURNAL_SCHEMA, generation: current.generation, seq: current.seq + 1, ...payload }
    const line = encodeEnvelope(core) + '\n'
    const record = decodeEnvelope(line, 'new journal transaction')
    const bytesWritten = Buffer.byteLength(line)
    const fd = await retry(() => open(this.#paths.journalPath, 'a'))
    try {
      await fd.writeFile(line, 'utf8')
      await this.#fault?.('appendAfterWrite', { ...this.getInfo(), seq: record.seq, bytesWritten })
      if (this.#durable) await fd.sync()
    } finally { await fd.close() }
    this.#cursor = { generation: current.generation, seq: record.seq, offset: current.journalBytes + bytesWritten }
    return { record, bytesWritten, seq: record.seq, generation: current.generation, journalBytes: this.#cursor.offset, recoveredTailBytes: current.recoveredTailBytes }
  }

  async #compact(checkpoint) {
    const current = await this.#read()
    if (!current.initialized) throw new IndexStorageError('INDEX_NOT_INITIALIZED', 'Initialize a checkpoint before compacting')
    requireArgument(checkpoint?.seq === current.seq, 'Compaction checkpoint must include the current committed sequence')
    return this.#publish(checkpoint, 'compact')
  }

  async #publish(checkpoint, reason) {
    requireArgument(checkpoint && typeof checkpoint === 'object' && checkpoint.view?.ws === this.#workspaceKey, 'Checkpoint workspace must match storage workspace')
    requireArgument(Number.isSafeInteger(checkpoint.seq) && checkpoint.seq >= 0, 'Invalid checkpoint sequence')
    const generation = randomUUID()
    const checkpointName = `checkpoint-${generation}.json`
    const journalName = `journal-${generation}.jsonl`
    const checkpointPath = path.join(this.#directory, checkpointName)
    const journalPath = path.join(this.#directory, journalName)
    const envelope = { schema: CHECKPOINT_SCHEMA, generation, seq: checkpoint.seq, ws: this.#workspaceKey, payload: checkpoint }
    await atomicWrite(checkpointPath, encodeEnvelope(envelope) + '\n', this.#durable)
    const log = await open(journalPath, 'wx')
    try { if (this.#durable) await log.sync() } finally { await log.close() }
    const faultData = { generation, seq: checkpoint.seq, checkpointPath, journalPath, manifestPath: this.getInfo().manifestPath, reason }
    if (reason === 'compact') await this.#fault?.('compactBeforeManifest', faultData)
    const manifest = { schema: MANIFEST_SCHEMA, ws: this.#workspaceKey, generation, checkpoint: checkpointName, journal: journalName }
    await atomicWrite(this.getInfo().manifestPath, encodeEnvelope(manifest) + '\n', this.#durable)
    // Publication may succeed even if a caller is interrupted immediately after it.
    this.invalidate()
    if (reason === 'compact') await this.#fault?.('compactAfterManifest', faultData)
    return this.#read()
  }
}
