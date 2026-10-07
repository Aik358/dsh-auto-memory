import path from 'node:path'
import { withConfigLock } from './config-lock.js'
import { readSettingsForSave } from './settings-safety.js'
import { pathKey, withinRoot, resolvePhysicalTarget, assertPhysicalTarget } from './file-boundary.js'

function bindings(engine, config) {
  return {
    memoryRoot: pathKey(engine.expandUserPath(config.memoryRoot) || ''),
    userMemoryDir: pathKey(engine.expandUserPath(config.userMemoryDir) || ''),
    projectMemoryDir: path.isAbsolute(String(config.projectMemoryDir || ''))
      ? pathKey(config.projectMemoryDir) : String(config.projectMemoryDir || ''),
  }
}

function changed(a, b) {
  return Object.keys(a).some(key => a[key] !== b[key])
}

export function bindMemoryDirectoryPre(engine, dir, kind) {
  const directory = pathKey(dir)
  const lexical = path.resolve(dir)
  engine._memoryPathBindingsPre ||= new Map()
  engine._memoryPathBindingsPre.delete(lexical)
  engine._memoryPathBindingsPre.set(lexical, { directory, lexical, kind, bindings: bindings(engine, engine.config || {}) })
  while (engine._memoryPathBindingsPre.size > 512) engine._memoryPathBindingsPre.delete(engine._memoryPathBindingsPre.keys().next().value)
  return dir
}

function destinationBinding(engine, file, target, current) {
  const lexical = path.resolve(file)
  const depth = entry => Math.min(...[
    withinRoot(entry.lexical, lexical) ? path.relative(entry.lexical, lexical).split(path.sep).length : Infinity,
    withinRoot(entry.directory, target) ? path.relative(entry.directory, target).split(path.sep).length : Infinity,
  ])
  const carried = [...(engine._memoryPathBindingsPre?.values() || [])]
    .filter(entry => withinRoot(entry.lexical, lexical) || withinRoot(entry.directory, target))
    .sort((a, b) => depth(a) - depth(b))[0]
  const userDestination = root => {
    const relative = path.relative(root, target), pieces = relative.split(path.sep)
    return root && withinRoot(root, target) && (relative === '' || (pieces.length === 1 && /\.[^.]+$/.test(relative)) || ['summaries', 'greetings', 'reflections'].includes(pieces[0]))
  }
  if (carried) return carried.kind === 'user' && !userDestination(carried.directory) ? null : carried
  // Low-level explicit destinations have no resolver receipt. Do not let the
  // user root (normally an ancestor of workspaces) authorize arbitrary trees.
  const projects = [current.memoryRoot, path.isAbsolute(current.projectMemoryDir) ? current.projectMemoryDir : '']
  if (projects.some(root => root && withinRoot(root, target))) return { kind: 'project', bindings: current }
  return null
}

// Configuration is the shared outer transaction: migration holds this same
// canonical lock from its fresh read through copying and publishing bindings.
// File locks are acquired only inside it; model computation stays outside it.
export function captureMemoryMutationPre(engine, file) {
  const admitted = bindings(engine, engine.config || {})
  const physicalTarget = resolvePhysicalTarget(file)
  const target = pathKey(physicalTarget)
  return { admitted, target, physicalTarget, destination: destinationBinding(engine, file, target, admitted) }
}

export async function withMemoryMutationPre(engine, file, job, admission = captureMemoryMutationPre(engine, file)) {
  if (typeof engine._assertPluginLivePre === 'function') engine._assertPluginLivePre()
  if (engine._settingsMigrationActive) throw Object.assign(new Error('settings-migration-active'), { code: 'SETTINGS_MIGRATION_ACTIVE', statusCode: 409, details: 'Keep the content and retry after migration.' })
  const { admitted, target, physicalTarget = target, destination } = admission
  return withConfigLock(engine._configPath, async () => {
    const durable = await readSettingsForSave(engine._configPath)
    const config = durable ? { ...engine.config, ...durable } : engine.config
    const fresh = bindings(engine, config || {})
    const roots = destination?.kind === 'project'
      ? [fresh.memoryRoot, path.isAbsolute(fresh.projectMemoryDir) ? fresh.projectMemoryDir : '']
      : [fresh.userMemoryDir]
    // With no persisted configuration, the caller owns its explicit paths
    // (startup and isolated low-level fixtures). Published bindings are strict.
    const stalePath = durable && (!destination || !roots.some(root => root && withinRoot(root, target)))
    const sourceChanged = destination && changed(destination.bindings, fresh)
    if (pathKey(file) !== target || changed(admitted, fresh) || sourceChanged || stalePath) {
      if (durable) {
        engine.config = config
        engine.configLoaded = true
        for (const runtime of engine.runtimes?.values?.() || []) runtime.state.loadedAt = 0
      }
      throw Object.assign(new Error('settings-root-changed'), { code: 'SETTINGS_ROOT_CHANGED', statusCode: 409, details: 'Destination is stale; reload paths and retry with the saved content.' })
    }
    // Team policy owns the action mapping. Its authoritative check receives the
    // same fresh durable configuration used for the binding check above.
    if (typeof engine._assertTeamActionPre === 'function') {
      engine._assertTeamActionPre(engine._teamWriteActionPre(file), config)
    }
    // A queued write must not start new IO after its plugin owner was released.
    if (typeof engine._assertPluginLivePre === 'function') engine._assertPluginLivePre()
    // The checked identity is also the actual IO destination. Reusing file here
    // would re-resolve its directory aliases after every await.
    assertPhysicalTarget(physicalTarget)
    return job(physicalTarget)
  })
}
