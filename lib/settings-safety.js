import path from 'node:path'
import * as fs from 'node:fs/promises'
import { constants } from 'node:fs'
import { randomUUID, createHash } from 'node:crypto'

// Saving reads strictly and leaves a corrupt/unreadable original in place.
// Startup still uses config-io's quarantine reader; a save must not reset defaults.
export async function readSettingsForSave(file) {
  try {
    const value=JSON.parse(await fs.readFile(file,'utf8'))
    if(!value || typeof value!=='object' || Array.isArray(value))throw Error('Invalid configuration; existing file preserved')
    return value
  } catch(e) {if(e.code==='ENOENT')return null;throw e}
}

export function validateSettingsPatch(patch) {
  const errors = {}
  const time = (v) => typeof v === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(v)
  for (const key of ['consolidateScheduleTime', 'maintainScheduleTime']) {
    if (patch[key] !== undefined && !time(patch[key])) errors[key] = 'Use HH:MM (00:00–23:59).'
  }
  if (patch.autoSummaryTimes !== undefined && (!Array.isArray(patch.autoSummaryTimes) || patch.autoSummaryTimes.some(v => !time(v)))) errors.autoSummaryTimes = 'Use an array of HH:MM times; [] disables summaries.'
  if (patch.injectExcludeSources !== undefined && (!Array.isArray(patch.injectExcludeSources) || patch.injectExcludeSources.some(v => typeof v !== 'string'))) errors.injectExcludeSources = 'Use one source string per entry.'
  const limits = { dayBoundaryMinutes: [0, 1439] }
  for (const [key, [min, max]] of Object.entries(limits)) {
    if (patch[key] !== undefined && (!Number.isInteger(patch[key]) || patch[key] < min || patch[key] > max)) errors[key] = `Use an integer from ${min} to ${max}.`
  }
  for (const key of ['workbenchLoopShort', 'workbenchLoopLong']) {
    if (patch[key] !== undefined && (!Number.isSafeInteger(patch[key]) || patch[key] < 2)) errors[key] = 'Use an integer of at least 2 (the runtime minimum).'
  }
  if (patch.semanticEngineMode !== undefined && !['auto', 'lexical', 'js', 'python'].includes(patch.semanticEngineMode)) errors.semanticEngineMode = 'Unknown search mode.'
  return errors
}

const inside = (root, value) => { const rel = path.relative(root, value); return rel !== '' && rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel) }
async function optionalStat(file) { try { return await fs.lstat(file) } catch (e) { if (e.code === 'ENOENT') return null; throw e } }

// Check existing ancestors too: a symlink must not bypass the dshHome restriction.
export async function validateSettingsPaths(patch, home, expand) {
  const errors = {}
  if (!['memoryRoot','userMemoryDir','workbenchRoot'].some(key => patch[key] !== undefined)) return errors
  const realHome = await fs.realpath(home)
  for (const key of ['memoryRoot', 'userMemoryDir', 'workbenchRoot']) {
    if (patch[key] === undefined) continue
    if (key === 'workbenchRoot' && patch[key] === '') continue
    try {
      if (typeof patch[key] !== 'string' || !patch[key].trim()) throw Error('Choose a nonempty directory.')
      const target = expand(patch[key])
      if (!path.isAbsolute(target) || !inside(home, target)) throw Error('Directory must be inside DSH_HOME.')
      let ancestor = target
      let st
      while (!(st = await optionalStat(ancestor))) ancestor = path.dirname(ancestor)
      if (!st.isDirectory() && !st.isSymbolicLink()) throw Error('Directory is occupied by a file.')
      const real = await fs.realpath(ancestor)
      if (!(await fs.stat(real)).isDirectory()) throw Error('Directory is occupied by a file.')
      if (real !== realHome && !inside(realHome, real)) throw Error('Directory resolves outside DSH_HOME.')
    } catch (e) { errors[key] = e.message }
  }
  return errors
}

// Resolve missing suffixes against the nearest real ancestor before any mkdir.
// Lexical paths alone cannot detect aliases pointing back into the source tree.
async function canonicalDirectory(file, io) {
  let ancestor = path.resolve(file), suffix = []
  for (;;) {
    try { return path.join(await io.realpath(ancestor), ...suffix.reverse()) }
    catch (e) {
      if (e.code !== 'ENOENT') throw e
      const parent = path.dirname(ancestor)
      if (parent === ancestor) throw e
      suffix.push(path.basename(ancestor)); ancestor = parent
    }
  }
}

// A durable ownership journal distinguishes preexisting user data from copies
// left by a failed migration/config commit, including after a process restart.
// Only files with the recorded identity AND contents may be rolled back.
const MIGRATION_JOURNAL = '.dsh-settings-migration.json'
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
export async function migrateSettingsTree(source, target, { user = false, io = fs, pendingCommit = false } = {}) {
  source = await canonicalDirectory(source, io)
  target = await canonicalDirectory(target, io)
  if (source === target || inside(source, target) || inside(target, source)) throw Error('Migration source and target must not overlap.')
  let copied = 0, retained = 0
  const directories = [], files = []
  const included = (name, level) => !(user && level === 0 && !(/^(?:MEMORY|CALENDAR)\.md$/.test(name) || ['summaries', 'greetings'].includes(name))) && !/\.tmp(?:-|$)/.test(name) && name !== MIGRATION_JOURNAL && name !== 'node_modules' && name !== '__pycache__'
  async function statOrMissing(file) { try { return await io.lstat(file) } catch (e) { if (e.code === 'ENOENT') return null; throw e } }
  const journalPath = path.join(target, MIGRATION_JOURNAL)
  let journal = { version: 1, source, target, user, entries: [] }, journalCreated = false
  const identity = st => [String(st.dev), String(st.ino)]
  async function writeJournal() {
    const temp = journalPath + '.' + randomUUID() + '.tmp'
    try {
      await io.writeFile(temp, JSON.stringify(journal), { flag: 'wx' })
      if (!journalCreated) await io.link(temp, journalPath)
      else await io.rename(temp, journalPath)
      journalCreated = true
    } finally { await io.rm(temp, { force: true }) }
  }
  async function rollback() {
    for (const entry of journal.entries) {
      const file = path.join(target, entry.relative)
      if (await canonicalDirectory(path.dirname(file), io) !== path.dirname(file)) throw Error('Migration rollback directory changed; preserved: ' + file)
      const st = await statOrMissing(file)
      if (!st || JSON.stringify(identity(st)) !== JSON.stringify(entry.identity)) continue
      if (!st.isFile() || digest(await io.readFile(file)) !== entry.digest) throw Error('Migration copy was modified externally; preserved: ' + file)
      await io.unlink(file)
    }
    if (journalCreated) await io.rm(journalPath)
    journalCreated = false; journal.entries = []
  }
  const existingJournal = await statOrMissing(journalPath)
  if (existingJournal) {
    if (!existingJournal.isFile()) throw Error('Invalid migration ownership journal; target preserved.')
    const saved = JSON.parse(await io.readFile(journalPath, 'utf8'))
    if (saved.version !== 1 || saved.source !== source || saved.target !== target || saved.user !== user || !Array.isArray(saved.entries) || saved.entries.some(en => !en || typeof en.relative !== 'string' || !inside(target, path.resolve(target, en.relative)) || !Array.isArray(en.identity) || en.identity.length !== 2 || typeof en.digest !== 'string')) throw Error('Conflicting migration ownership journal; target preserved.')
    journal = saved; journalCreated = true
    await rollback()
  }
  async function walk(src, dst, level = 0) {
    const srcStat = await statOrMissing(src)
    if (!srcStat) { if (level === 0) return; throw Error('Migration source disappeared: ' + src) }
    if (!srcStat.isDirectory()) throw Error('Migration source is not a directory: ' + src)
    const destStat = await statOrMissing(dst)
    if (destStat && !destStat.isDirectory()) throw Error('Migration target is not a directory: ' + dst)
    await io.mkdir(dst, { recursive: true })
    const entries = (await io.readdir(src, { withFileTypes: true })).filter(en => included(en.name, level)).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
    directories.push({ src, level, names: entries.map(en => en.name).sort() })
    for (const en of entries) {
      const from = path.join(src, en.name), to = path.join(dst, en.name)
      if (en.isSymbolicLink()) throw Error('Migration refuses symlinks: ' + from)
      if (en.isDirectory()) { await walk(from, to, level + 1); continue }
      if (!en.isFile()) throw Error('Unsupported migration entry: ' + from)
      const existing = await statOrMissing(to)
      if (existing) { if (!existing.isFile()) throw Error('Migration file target is not a regular file: ' + to); retained++; continue }
      const temp = to + '.' + randomUUID() + '.tmp'
      try {
        const before = await io.readFile(from)
        await io.copyFile(from, temp, constants.COPYFILE_EXCL)
        const after = await io.readFile(from), landed = await io.readFile(temp)
        if (!before.equals(after) || !before.equals(landed)) throw Error('Migration source changed or copy incomplete: ' + from)
        const owned = { relative: path.relative(target, to), identity: identity(await io.lstat(temp)), digest: digest(before) }
        journal.entries.push(owned)
        await writeJournal() // Write ahead: a crash after link still has ownership.
        try { await io.link(temp, to); files.push({ from, to, bytes: before }); copied++ } catch (e) { if (e.code !== 'EEXIST') throw e; const other = await io.lstat(to); if (!other.isFile()) throw e; retained++ }
      } finally { await io.rm(temp, { force: true }) }
    }
  }
  try {
  await walk(source, target)
  // Recheck the complete copied set before publishing a new root, including files
  // copied early in the walk while later siblings were still being migrated.
  for (const entry of directories) {
    const names = (await io.readdir(entry.src)).filter(name => included(name, entry.level)).sort()
    if (JSON.stringify(names) !== JSON.stringify(entry.names)) throw Error('Migration source directory changed: ' + entry.src)
  }
  for (const entry of files) {
    const original = await io.readFile(entry.from), destination = await io.readFile(entry.to)
    if (!original.equals(entry.bytes) || !destination.equals(entry.bytes)) throw Error('Migration source or destination changed: ' + entry.from)
  }
  } catch (e) {
    try { await rollback() } catch (cleanup) { throw Error(e.message + '; rollback pending: ' + cleanup.message) }
    throw e
  }
  async function commit() { if (journalCreated) await io.rm(journalPath); journalCreated = false }
  if (!pendingCommit) await commit()
  return { copied, retained, rollback, commit }
}
