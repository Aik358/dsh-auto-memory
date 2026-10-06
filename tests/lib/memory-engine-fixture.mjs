import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { loadIsolatedEngine } from './load-isolated-engine.mjs'

// Retain the complete production prototype, including the shared transaction
// and team policy. Only unrelated content-quality inputs may be overridden.
export async function loadMemoryFixtureFactory(home) {
  process.env.DSH_HOME = home
  const { MemoryEngine, DEFAULT_CONFIG } = await loadIsolatedEngine(home)
  let id = 0
  return (over = {}) => {
    const engine = new MemoryEngine()
    const { config = {}, ...methods } = over
    engine._configPath = path.join(home, 'fixture-settings-' + (++id) + '.json')
    engine.config = { ...DEFAULT_CONFIG, memoryRoot: home, projectMemoryDir: home,
      userMemoryDir: path.join(home, 'user'), teamEnabled: false, boardMode: 'legacy',
      handoffEnabled: true, ...config }
    engine.configLoaded = true
    writeFileSync(engine._configPath, JSON.stringify(engine.config))
    engine.projectDirOf('fixture-workspace')
    engine.userDirOf()
    assert.equal(typeof engine._withMemoryMutationPre, 'function')
    assert.equal(typeof engine._assertTeamActionPre, 'function')
    assert.equal(typeof engine._teamWriteActionPre, 'function')
    for (const name of ['_withMemoryMutationPre', '_assertTeamActionPre', '_teamWriteActionPre', 'writeFullRaw']) {
      assert(!(name in methods), name + ' must remain the production implementation')
    }
    return Object.assign(engine, methods)
  }
}
