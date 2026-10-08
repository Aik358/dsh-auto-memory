import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, lstatSync, readlinkSync, existsSync, rmSync, symlinkSync, cpSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// Optional script argument runs the same assertions against an isolated baseline copy.
const release = process.argv[2] ? path.resolve(process.argv[2]) : fileURLToPath(new URL('../../tools/release.mjs', import.meta.url))
const fixture = mkdtempSync(path.join(tmpdir(), 'dam-323-preflight-'))
const version = '9.9.9'
let passed = 0, failed = 0, skipped = 0
const put = (file, value) => { mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, value) }
const sourceAt = (dir) => {
  for (const name of ['lib', 'tests', 'python', 'tools']) mkdirSync(path.join(dir, name), { recursive: true })
  const files = {
    'lib/index.js': 'export const fixture = true\n',
    'lib/client.js': `export const fixture = true\n// '${version}': { zh: [\n// client v${version} fingerprint\n`,
    'lib/marker.txt': 'source-must-survive',
    'package.json': '{"version":"9.9.8"}\n',
    'cordis.patch.yml': '- id: auto-memory\n  package: "@a9i5k4/dsh-auto-memory"\n',
    'CHANGELOG.md': `## [${version}]\n`,
    'tools/run-smoke.mjs': '// fixture\n',
    'tools/smoke-impact.mjs': '// fixture\n',
    'tools/build-iter5-skin.mjs': '// fixture\n',
    'tools/reconcile-upstream.mjs': 'console.log(JSON.stringify({ artifacts: [], unregistered: [] }))\n',
  }
  for (const name of ['worker_v1.py', 'worker_semantic_v1.py', 'm7_activation_features_v2.py', 'm7_embedding_v1.py']) files['python/' + name] = '# fixture\n'
  for (const [name, value] of Object.entries(files)) put(path.join(dir, name), value)
  cpSync(release, path.join(dir, 'tools', 'release.mjs'))
  return dir
}
// Snapshot regular files without following aliases. Negative cases must preserve every byte.
const snapshot = (dir) => {
  const entries = []
  const walk = (base) => {
    for (const name of readdirSync(base).sort()) {
      const file = path.join(base, name), st = lstatSync(file)
      if (st.isSymbolicLink()) { entries.push([path.relative(dir, file), 'alias', readlinkSync(file)]); continue }
      if (st.isDirectory()) { entries.push([path.relative(dir, file), 'directory']); walk(file) }
      else entries.push([path.relative(dir, file), createHash('sha256').update(readFileSync(file)).digest('hex')])
    }
  }
  walk(dir)
  return entries
}
const run = (dev, rel, base, dryRun = false, script = release, preload = '') => {
  const result = spawnSync(process.execPath, [...(preload ? ['--import', pathToFileURL(preload).href] : []), script, version, ...(dryRun ? ['--dry-run'] : [])], {
    cwd: base, encoding: 'utf8', timeout: 15000, windowsHide: true,
    env: { ...process.env, DSH_HOME: path.join(base, 'isolated-home'), DSH_AUTO_MEMORY_DEV: dev,
      DSH_AUTO_MEMORY_REL: rel, TMP: base, TEMP: base, TMPDIR: base },
  })
  assert.ifError(result.error)
  return { ...result, output: result.stdout + result.stderr }
}
const reject = (base, dev, rel, reason, preload = '') => {
  const before = snapshot(base), result = run(dev, rel, base, false, release, preload)
  assert.notEqual(result.status, 0, 'unsafe release inputs were accepted')
  assert.deepEqual(snapshot(base), before, 'release modified the fixture before rejecting it')
  assert.match(result.output, reason)
}
const check = (name, test) => {
  const base = path.join(fixture, String(passed + failed + skipped) + '-' + name)
  mkdirSync(base)
  try { test(base); passed++; console.log('PASS ' + name) }
  catch (error) {
    if (error.code === 'ALIAS_UNAVAILABLE') { skipped++; console.log('SKIP ' + name + ': ' + error.message) }
    else { failed++; console.error('FAIL ' + name + ': ' + error.message.slice(0, 300)) }
  }
}
const alias = (target, link, type) => {
  try { symlinkSync(target, link, type) }
  catch (error) {
    if (!['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) throw error
    const unavailable = new Error(type + ' creation unavailable: ' + error.code)
    unavailable.code = 'ALIAS_UNAVAILABLE'
    throw unavailable
  }
}
const overlap = /同一个目录|包含|内部|重叠/
try {
  check('source-inside-target', (base) => reject(base, sourceAt(path.join(base, 'rel', 'source')), path.join(base, 'rel'), overlap))
  check('target-inside-source', (base) => {
    const dev = sourceAt(path.join(base, 'source')), rel = path.join(dev, 'rel')
    put(path.join(rel, 'old.txt'), 'preserve-target')
    reject(base, dev, rel, overlap)
  })
  check('missing-target-inside-source', (base) => {
    const dev = sourceAt(path.join(base, 'source'))
    reject(base, dev, path.join(dev, 'missing', 'nested'), overlap)
  })
  check('same-with-trailing-separator', (base) => {
    const dev = sourceAt(path.join(base, 'source'))
    reject(base, dev + path.sep, dev + path.sep + path.sep, overlap)
  })
  if (process.platform === 'win32') check('windows-case-and-separators', (base) => {
    const dev = sourceAt(path.join(base, 'MiXeD-source'))
    reject(base, dev.toLowerCase().replace(/\\/g, '/'), dev.toUpperCase() + '\\', overlap)
  })
  check('missing-source', (base) => {
    const rel = path.join(base, 'rel'); put(path.join(rel, 'old.txt'), 'preserve-target')
    reject(base, path.join(base, 'missing'), rel, /源目录|ENOENT/)
  })
  check('file-as-source', (base) => {
    const dev = path.join(base, 'source-file'), rel = path.join(base, 'rel')
    put(dev, 'file'); put(path.join(rel, 'old.txt'), 'preserve-target')
    reject(base, dev, rel, /源目录|目录|ENOTDIR/)
  })
  check('incomplete-source', (base) => {
    const dev = sourceAt(path.join(base, 'source')), rel = path.join(base, 'rel')
    rmSync(path.join(dev, 'python'), { recursive: true }); put(path.join(rel, 'old.txt'), 'preserve-target')
    reject(base, dev, rel, /源|python/)
  })
  check('missing-required-tool', (base) => {
    const dev = sourceAt(path.join(base, 'source')), rel = path.join(base, 'rel')
    rmSync(path.join(dev, 'tools', 'reconcile-upstream.mjs')); put(path.join(rel, 'old.txt'), 'preserve-target')
    reject(base, dev, rel, /reconcile-upstream/)
  })
  check('missing-required-runtime', (base) => {
    const dev = sourceAt(path.join(base, 'source')), rel = path.join(base, 'rel')
    rmSync(path.join(dev, 'python', 'worker_v1.py')); put(path.join(rel, 'old.txt'), 'preserve-target')
    reject(base, dev, rel, /worker_v1/)
  })
  // Deterministic read failures in the actual CLI process, without changing ACLs.
  for (const [name, method, entry] of [
    ['unreadable-required-file', 'readFileSync', 'lib/client.js'],
    ['unreadable-required-directory', 'readdirSync', 'lib'],
  ]) check(name, (base) => {
    const dev = sourceAt(path.join(base, 'source')), rel = path.join(base, 'rel')
    put(path.join(rel, 'old.txt'), 'preserve-target')
    const preload = path.join(base, 'inject-read-failure.mjs')
    put(preload, `import fs from 'node:fs'\nimport { syncBuiltinESMExports } from 'node:module'\n` +
      `const original = fs.${method}, target = ${JSON.stringify(path.join(dev, entry))}\n` +
      `fs.${method} = function(file, ...args) {\n` +
      `  if (String(file) === target) { const e = new Error('fixture EACCES: ' + target); e.code = 'EACCES'; throw e }\n` +
      `  return original.call(this, file, ...args)\n}\nsyncBuiltinESMExports()\n`)
    reject(base, dev, rel, /EACCES/, preload)
  })
  check('file-as-target', (base) => {
    const dev = sourceAt(path.join(base, 'source')), rel = path.join(base, 'target-file')
    put(rel, 'preserve-target'); reject(base, dev, rel, /目录|EEXIST|ENOTDIR/)
  })
  // Exercise both Windows junctions (no symlink privilege required) and real symlinks.
  for (const type of process.platform === 'win32' ? ['junction', 'dir'] : ['dir']) {
    check(type + '-same-source', (base) => {
      const dev = sourceAt(path.join(base, 'source')), rel = path.join(base, 'alias')
      alias(dev, rel, type); reject(base, dev, rel, overlap)
    })
    check(type + '-target-ancestor', (base) => {
      const dev = sourceAt(path.join(base, 'container', 'source')), rel = path.join(base, 'alias')
      alias(path.dirname(dev), rel, type); reject(base, dev, rel, overlap)
    })
    check(type + '-missing-target-descendant', (base) => {
      const dev = sourceAt(path.join(base, 'source')), link = path.join(base, 'alias')
      alias(dev, link, type); reject(base, dev, path.join(link, 'missing', 'nested'), overlap)
    })
    check(type + '-source-alias-inside-target', (base) => {
      const physical = sourceAt(path.join(base, 'rel', 'source')), dev = path.join(base, 'alias')
      alias(physical, dev, type); reject(base, dev, path.dirname(physical), overlap)
    })
    check(type + '-dangling-target', (base) => {
      const dev = sourceAt(path.join(base, 'source')), rel = path.join(base, 'dangling')
      const absent = path.join(base, 'absent'); mkdirSync(absent)
      alias(absent, rel, type); rmSync(absent, { recursive: true })
      reject(base, dev, rel, /路径|ENOENT/)
    })
  }
  check('legal-prefix-sibling-release', (base) => {
    const dev = sourceAt(path.join(base, 'source')), rel = path.join(base, 'source-release')
    put(path.join(rel, 'old.txt'), 'remove-me'); put(path.join(rel, '.git', 'sentinel'), 'keep-git'); put(path.join(rel, '.gitignore'), 'keep-ignore')
    const result = run(dev, rel, base)
    assert.equal(result.status, 0, result.output)
    assert.equal(existsSync(path.join(rel, 'old.txt')), false)
    assert.equal(readFileSync(path.join(rel, '.git', 'sentinel'), 'utf8'), 'keep-git')
    assert.equal(readFileSync(path.join(rel, '.gitignore'), 'utf8'), 'keep-ignore')
    assert.equal(readFileSync(path.join(rel, 'lib', 'marker.txt'), 'utf8'), 'source-must-survive')
    assert.equal(JSON.parse(readFileSync(path.join(dev, 'package.json'), 'utf8')).version, version)
  })
  check('legal-missing-target-and-source-alias', (base) => {
    const physical = sourceAt(path.join(base, 'source')), dev = path.join(base, 'alias'), rel = path.join(base, 'new', 'nested', 'release')
    alias(physical, dev, process.platform === 'win32' ? 'junction' : 'dir')
    const result = run(dev, rel, base)
    assert.equal(result.status, 0, result.output)
    assert.equal(readFileSync(path.join(rel, 'lib', 'marker.txt'), 'utf8'), 'source-must-survive')
  })
  check('legal-target-alias', (base) => {
    const dev = sourceAt(path.join(base, 'source')), target = path.join(base, 'target'), rel = path.join(base, 'alias')
    put(path.join(target, 'old.txt'), 'remove-me'); put(path.join(target, '.git', 'sentinel'), 'keep-git')
    alias(target, rel, process.platform === 'win32' ? 'junction' : 'dir')
    const result = run(dev, rel, base)
    assert.equal(result.status, 0, result.output)
    assert.equal(lstatSync(rel).isSymbolicLink(), true)
    assert.equal(existsSync(path.join(target, 'old.txt')), false)
    assert.equal(readFileSync(path.join(target, '.git', 'sentinel'), 'utf8'), 'keep-git')
    assert.equal(readFileSync(path.join(target, 'lib', 'marker.txt'), 'utf8'), 'source-must-survive')
  })
  check('dry-run-ignores-configured-overlap', (base) => {
    const dev = sourceAt(path.join(base, 'source')), before = snapshot(dev)
    // Default source resolution from a copied release script must still work.
    const result = run('', dev, base, true, path.join(dev, 'tools', 'release.mjs'))
    assert.equal(result.status, 0, result.output)
    assert.deepEqual(snapshot(dev), before)
    const staging = result.output.match(/staging 目录: (.+)/)?.[1]?.trim()
    assert.ok(staging && path.relative(base, staging).startsWith('dam-release-staging-'), result.output)
    assert.equal(readFileSync(path.join(staging, 'lib', 'marker.txt'), 'utf8'), 'source-must-survive')
  })
} finally {
  // This is the single mkdtemp-owned fixture root; never clean configured release paths.
  assert.ok(path.dirname(fixture) === path.resolve(tmpdir()) && path.basename(fixture).startsWith('dam-323-preflight-'))
  rmSync(fixture, { recursive: true, force: true })
}
console.log(`#323: ${passed} passed, ${failed} failed, ${skipped} skipped`)
process.exitCode = failed ? 1 : 0
