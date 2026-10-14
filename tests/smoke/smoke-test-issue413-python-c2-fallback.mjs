import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

const source = fs.readFileSync(new URL('../../lib/index.js', import.meta.url), 'utf8')
let jsCalls = 0, pyThrows = false, jsThrows = false, assets = true
const engine = {
  config: { semanticEngineMode: 'python' }, resolveSemanticTier: async () => 'c1',
  semanticAssetProbe: async () => ({ ready: assets, filesReady: assets }),
  _pySemanticRank: async () => { if (pyThrows) throw Error('fixture Python unavailable'); return null },
  _jsSemantic: { rank: async () => { jsCalls++; if (jsThrows) throw Error('fixture JS unavailable'); return { scores: new Map([['mem-fixture', 0.9]]), source: 'c2' } }, status: () => ({}) },
}
const env = { engine, String }, context = vm.createContext(env)
const jsStart = source.indexOf('    engine._jsSemanticRank = async')
vm.runInContext(source.slice(jsStart, source.indexOf('    // P13(', jsStart)), context)
const bestStart = source.indexOf('    engine._semanticRankBest = async')
vm.runInContext(source.slice(bestStart, source.indexOf('    // JS 端判定核', bestStart)), context)
assert.equal((await engine._semanticRankBest({}, 'fixture query')).source, 'c2')
assert.match(engine._rankPath, /c2\(js\)/)
pyThrows = true
assert.equal((await engine._semanticRankBest({}, 'fixture query')).source, 'c2')
jsThrows = true
assert.equal(await engine._semanticRankBest({}, 'fixture query'), null)
assert.match(engine._rankPath, /词法/)
assets = false; jsThrows = false
const before = jsCalls
assert.equal(await engine._semanticRankBest({}, 'fixture query'), null)
assert.equal(jsCalls, before, 'unavailable JS assets are never forced')
engine.config.semanticEngineMode = 'lexical'; assets = true
assert.equal(await engine._semanticRankBest({}, 'fixture query'), null)
assert.equal(jsCalls, before, 'explicit lexical mode remains authoritative')
console.log('PASS #413 Python failure uses healthy C2 and preserves missing-assets and lexical gates')
