import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import vm from 'node:vm'
import { SKIN_ASSETS } from '../../lib/skin-assets.js'

const root = fileURLToPath(new URL('../..', import.meta.url))
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
const npm = process.platform === 'win32' ? 'cmd.exe' : 'npm'
const args = process.platform === 'win32'
  ? ['/d', '/s', '/c', 'npm pack --dry-run --json --ignore-scripts']
  : ['pack', '--dry-run', '--json', '--ignore-scripts']
const run = spawnSync(npm, args, {
  cwd: root, encoding: 'utf8', timeout: 30000,
})
assert.equal(run.status, 0, run.error?.message || run.stderr)
const result = JSON.parse(run.stdout)
const pack = Array.isArray(result) ? result[0] : result.files ? result : result[pkg.name]
assert.ok(pack?.files.length > 0, 'npm must return a nonempty package')
const files = new Set(pack.files.map(f => f.path))
const active = new Set(Object.values(SKIN_ASSETS).flatMap(e => [e.file, e.fileDark]).filter(Boolean))
assert.ok(active.size > 0, 'active slot inventory must be nonempty')
for (const file of active) assert.ok(files.has('lib/assets/skin/' + file), 'missing active image: ' + file)
for (const prefix of ['skins/iter5/', 'skins/legacy/', 'docs/', 'tests/', 'tools/', 'python/bench/']) {
  assert.ok(![...files].some(f => f.startsWith(prefix)), 'development payload included: ' + prefix)
}
for (const file of ['slots/hero.welcome.png', 'slots/hero.welcome-memory-v2.png', 'slots/empty.library.png', 'slots-dark/hero.welcome.webp']) {
  assert.ok(!active.has(file), 'excluded image became active: ' + file)
  assert.ok(existsSync(path.join(root, 'lib/assets/skin', file)), 'source image must remain available')
  assert.ok(!files.has('lib/assets/skin/' + file), 'obsolete image included: ' + file)
}
for (const file of ['lib/index.js', 'lib/client.js', 'icon.svg', 'locale/en.json', 'locale/zh.json', 'cordis.patch.yml', 'skins/classic/theme.json', 'skins/v4/theme.json', 'skins/v4/skin.css', 'python/worker_v1.py', 'python/worker_semantic_v1.py']) {
  assert.ok(files.has(file), 'runtime payload missing: ' + file)
}
for (const dir of ['lib', 'python']) for (const name of ['activation_policy_v2', 'recall_intent_lr_v1']) {
  const file = dir + '/policies/' + name + '.json'
  assert.ok(files.has(file), 'semantic policy missing: ' + file)
}

// Run the real manifest-writing phase without the unrelated copy/reconcile gates.
// A future exclusion must survive release generation without changing this test.
const release = readFileSync(path.join(root, 'tools/release.mjs'), 'utf8')
const start = release.indexOf('// ---------- 4. 生成正式 package.json ----------')
const end = release.indexOf('// ---------- 4.5 ', start)
assert.ok(start >= 0 && end > start)
function generated(files) {
  let output
  vm.runInNewContext(release.slice(start, end), {
    DEV: '/source', REL: '/staging', version: pkg.version, path,
    readFileSync: () => JSON.stringify({ files }),
    writeFileSync: (_, text) => { output = JSON.parse(text) },
    console: { error() {} }, process: { exit() { throw new Error('invalid files') } },
  })
  return output
}
const future = [...pkg.files, '!lib/assets/future-development-only']
assert.deepEqual(generated(future).files, future)
for (const invalid of [undefined, [], 'lib', ['lib', null], ['lib', ' ']]) {
  assert.throws(() => generated(invalid), /invalid files/)
}
console.log('PASS npm payload: active slots/runtime retained; obsolete images/build sources excluded; release preserves future exclusions and rejects invalid manifests')
