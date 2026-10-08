import path from 'node:path'
import { AsyncLocalStorage } from 'node:async_hooks'
import { withConfigReadLock, readConfigSnapshot } from './config-lock.js'
import { withinRoot } from './file-boundary.js'

// #320: admission belongs to one request, never to another route's global flight.
// Queue admission precedes the shared root lease covering validation and all IO.
// Settings drains local admissions before acquiring its exclusive config-lock.
const context = new AsyncLocalStorage()
const bindingKeys = ['memoryRoot', 'userMemoryDir', 'projectMemoryDir']

function pathKey(engine, value) {
  if (!value) return ''
  const expanded = engine.expandUserPath(value)
  return expanded ? (typeof engine._pathKey === 'function' ? engine._pathKey(expanded) : path.resolve(expanded)) : ''
}

function bindingsPre(engine, config) {
  const project = String(config.projectMemoryDir || '')
  return {
    memoryRoot: pathKey(engine, config.memoryRoot),
    userMemoryDir: pathKey(engine, config.userMemoryDir),
    projectMemoryDir: path.isAbsolute(project) ? pathKey(engine, project) : project,
  }
}

function liveScope(engine) {
  const scope = context.getStore()
  return scope?.active && scope.engine === engine ? scope : null
}

export async function withMemoryAdmissionScopePre(engine, job) {
  const scope = { engine, active: true, admitted: bindingsPre(engine, engine.config || {}) }
  return context.run(scope, async () => { try { return await job() } finally { scope.active = false } })
}

/** Record the roots used when resolving a directory, including stale destinations. */
export function bindMemoryDirectoryPre(engine, dir, kind = 'project') {
  const abs = pathKey(engine, dir)
  if (!engine._memoryPathBindings) engine._memoryPathBindings = new Map()
  engine._memoryPathBindings.delete(abs)
  engine._memoryPathBindings.set(abs, { kind: kind === 'user' ? 'user' : 'project', admitted: bindingsPre(engine, engine.config || {}) })
  while (engine._memoryPathBindings.size > 512) engine._memoryPathBindings.delete(engine._memoryPathBindings.keys().next().value)
  return dir
}

function destinationBinding(engine, target) {
  const physical = pathKey(engine, target)
  let selected, length = -1
  for (const [dir, binding] of engine._memoryPathBindings || []) {
    if (dir.length > length && withinRoot(dir, physical)) {
      selected = binding; length = dir.length
    }
  }
  return selected
}

/** Synchronous acceptance and registration, before any document queue wait. */
export function captureMemoryMutationPre(engine, file) {
  const target = path.resolve(String(file))
  const scope = liveScope(engine)
  const binding = destinationBinding(engine, target)
  const migrationActive = engine._settingsMigrationActive === true && !scope
  if (migrationActive) throw migrationConflict()
  return {
    target, migrationActive,
    admitted: binding?.admitted || scope?.admitted || bindingsPre(engine, engine.config || {}),
    kind: binding?.kind || null,
    ...registerMemoryMutationFlightPre(engine, target),
  }
}

export function registerMemoryMutationFlightPre(engine, target) {
  if (!engine._memoryMutationFlights) engine._memoryMutationFlights = new Set()
  const flights = engine._memoryMutationFlights
  let finish
  const flight = new Promise(resolve => { finish = resolve })
  flight.__damTarget = target
  flights.add(flight)
  return { flight, settle() { if (flights.delete(flight)) finish() } }
}

/** Bounded drain, including nested writes admitted by already accepted requests. */
export async function drainMemoryMutationFlightsPre(engine, { timeoutMs = 5000, includeRoutes = false } = {}) {
  let timer, waited = 0
  const timeout = new Promise(resolve => { timer = setTimeout(() => resolve(false), timeoutMs) })
  try {
    for (;;) {
      const pending = [...(engine._memoryMutationFlights || [])]
      if (includeRoutes) pending.push(...(engine._settingsNoteFlights || []), ...(engine._settingsPlanFlights || []))
      if (!pending.length) return { waited, settled: true }
      waited += pending.length
      const settled = await Promise.race([Promise.all(pending.map(p => Promise.resolve(p).catch(() => {}))).then(() => true), timeout])
      if (!settled) return { waited, settled: false }
      // Route owners remove their flights in finally; recapture newly nested writes.
    }
  } finally { clearTimeout(timer) }
}

function migrationConflict() {
  return Object.assign(new Error('settings-migration-active'), {
    code: 'SETTINGS_MIGRATION_ACTIVE', statusCode: 409,
    details: 'Keep the content and retry after migration.',
  })
}

function assertRootUnchanged(engine, admission, config, target) {
  const now = bindingsPre(engine, config)
  let keys = bindingKeys
  if (admission.kind === 'user') keys = ['userMemoryDir']
  if (admission.kind === 'project') keys = path.isAbsolute(admission.admitted.projectMemoryDir) ? ['projectMemoryDir'] : ['memoryRoot', 'projectMemoryDir']
  if (keys.some(key => admission.admitted[key] !== now[key])) {
    throw Object.assign(new Error('settings-root-changed'), {
      code: 'SETTINGS_ROOT_CHANGED', statusCode: 409, target,
      details: 'The destination belongs to an earlier memory root. Resolve the active destination and retry.',
    })
  }
}

/** Durable root check before IO; exclude cross-process cutovers through completion. */
export async function withMemoryMutationPre(engine, file, job, admission = captureMemoryMutationPre(engine, file)) {
  try {
    if (typeof engine._assertPluginLivePre === 'function') engine._assertPluginLivePre()
    if (admission.migrationActive) throw migrationConflict()
    const target = admission.target || file
    return await withConfigReadLock(engine._configPath, async () => {
      assertRootUnchanged(engine, admission, readConfigSnapshot(engine._configPath) || engine.config || {}, target)
      const scope = { engine, active: true, admitted: admission.admitted }
      return context.run(scope, async () => {
        try {
          const out = await job(target)
          assertRootUnchanged(engine, admission, readConfigSnapshot(engine._configPath) || engine.config || {}, target)
          return out
        } finally { scope.active = false }
      })
    })
  } finally { admission.settle?.() }
}

export default withMemoryMutationPre
