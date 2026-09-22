// Regression tests for migration rewriting and rename collisions. Pure engine only:
// no DSH host, real home directory, filesystem writes, or external dependencies.
import assert from 'node:assert/strict'
import {
  buildPackPre, planImportPre, rewritePathsInTextPre, rewritePackForTargetPre,
  workspaceSlugPre, renameForConflictPre,
} from '../../lib/migrate-pack.js'

let passed = 0, failed = 0
function check(name, run) {
  try { run(); passed++; console.log('ok - ' + name) }
  catch (error) { failed++; console.error('FAIL - ' + name + '\n' + error.stack) }
}
const slash = (p) => p.replace(/\\/g, '/')
const escaped = (p) => p.replace(/\\/g, '\\\\')
const url = (p) => 'file:///' + slash(p)
function pack(files) {
  const result = buildPackPre({ ws: 'D:\\project', files, now: 1 })
  assert.equal(result.ok, true)
  return result.pack
}
function plan(files, existingFiles = {}, onConflict = 'rename') {
  return planImportPre(pack(files), { targetWs: 'D:\\project', existingFiles, onConflict })
}

const short = 'C:\\work'
const deep = 'D:\\a\\b\\c\\d\\e\\f\\g\\h\\i\\project'
for (const [fromPath, toPath, direction] of [[deep, short, 'deep-to-short'], [short, deep, 'short-to-deep']]) {
  for (const [label, form] of [['raw', (p) => p], ['slash', slash], ['JSON', escaped], ['URL', url]]) {
    check(direction + ' keeps ' + label + ' representation', () => {
      assert.deepEqual(rewritePathsInTextPre(form(fromPath), { fromPath, toPath }), { text: form(toPath), hits: 1 })
    })
  }
  check(direction + ' keeps JSON parseable and its path value correct', () => {
    const result = rewritePathsInTextPre(JSON.stringify({ path: fromPath, other: 'unchanged' }), { fromPath, toPath })
    assert.deepEqual(JSON.parse(result.text), { path: toPath, other: 'unchanged' })
    assert.equal(result.hits, 1)
  })
}

check('target containing source is substituted once per original match', () => {
  const fromPath = 'D:\\project', toPath = 'D:\\project\\child'
  const forms = [(p) => p, slash, escaped, url]
  const source = forms.map((form) => form(fromPath)).join('\n')
  assert.deepEqual(rewritePathsInTextPre(source, { fromPath, toPath }), {
    text: forms.map((form) => form(toPath)).join('\n'), hits: 4,
  })
})
check('replacement text is not scanned again for source slugs', () => {
  assert.deepEqual(rewritePathsInTextPre('D:\\old --D--old--', {
    fromPath: 'D:\\old', toPath: 'E:\\--D--old--\\new',
    fromSlug: '--D--old--', toSlug: '--E--new--',
  }), { text: 'E:\\--D--old--\\new --E--new--', hits: 2 })
})
check('metacharacters and replacement dollar signs stay literal', () => {
  const fromPath = 'D:\\a[1]\\project+', toPath = 'E:\\$&\\$1\\new'
  assert.deepEqual(rewritePathsInTextPre(fromPath + '\nD:\\a1\\project+', { fromPath, toPath }), {
    text: toPath + '\nD:\\a1\\project+', hits: 1,
  })
})
check('Windows-to-POSIX JSON remains JSON, not a file URL', () => {
  const fromPath = deep, toPath = '/home/me/work'
  const result = rewritePathsInTextPre(JSON.stringify({ path: fromPath }), { fromPath, toPath })
  assert.deepEqual(JSON.parse(result.text), { path: toPath })
  assert.equal(result.hits, 1)
})
check('same path, empty options, and null input retain existing no-op semantics', () => {
  assert.deepEqual(rewritePathsInTextPre(short, { fromPath: short, toPath: short }), { text: short, hits: 0 })
  assert.deepEqual(rewritePathsInTextPre('untouched'), { text: 'untouched', hits: 0 })
  assert.deepEqual(rewritePathsInTextPre(null), { text: '', hits: 0 })
})
check('pack rewrite preserves no-op and rewriteBody=false behavior', () => {
  const original = pack({ 'MEMORY.md': 'D:\\project --D--project--' })
  const before = JSON.stringify(original)
  assert.deepEqual(rewritePackForTargetPre(original, { targetWs: 'D:\\project' }).files, original.files)
  assert.deepEqual(rewritePackForTargetPre(original, { targetWs: short, rewriteBody: false }).files, original.files)
  assert.equal(JSON.stringify(original), before)
})
check('pack rewrite reports original occurrences and retains source data', () => {
  const fromPath = deep, toPath = short
  const original = buildPackPre({ ws: fromPath, files: {
    'MEMORY.md': JSON.stringify({ path: fromPath, slug: workspaceSlugPre(fromPath) }),
    'notes.md': url(fromPath),
  }, now: 1 }).pack
  const before = JSON.stringify(original)
  const result = rewritePackForTargetPre(original, { targetWs: toPath })
  assert.deepEqual(JSON.parse(result.files['MEMORY.md']), { path: toPath, slug: workspaceSlugPre(toPath) })
  assert.equal(result.files['notes.md'], url(toPath))
  assert.equal(result.plan.totalHits, 3)
  assert.equal(result.plan.rewriteFiles.length, 2)
  assert.equal(JSON.stringify(original), before)
})

check('rename never overwrites an existing .from-pack backup', () => {
  const existing = { 'MEMORY.md': 'local', 'MEMORY.from-pack.md': 'previous import' }
  const before = JSON.stringify(existing)
  const result = plan({ 'MEMORY.md': 'incoming' }, existing)
  assert.deepEqual(result.writeFiles, { 'MEMORY.from-pack-2.md': 'incoming' })
  assert.deepEqual(result.overwrites, [])
  assert.equal(result.additions[0].renamedFrom, 'MEMORY.md')
  assert.equal(result.additions[0].path, 'MEMORY.from-pack-2.md')
  assert.equal(JSON.stringify(existing), before)
})
for (const reverse of [false, true]) {
  check('reserve incoming original names regardless of insertion order: reverse=' + reverse, () => {
    const entries = [['MEMORY.md', 'incoming main'], ['MEMORY.from-pack.md', 'incoming backup']]
    if (reverse) entries.reverse()
    const result = plan(Object.fromEntries(entries), { 'MEMORY.md': 'local' })
    assert.deepEqual(result.writeFiles, {
      'MEMORY.from-pack-2.md': 'incoming main', 'MEMORY.from-pack.md': 'incoming backup',
    })
    assert.equal(result.stats.willWrite, 2)
    assert.equal(new Set(result.additions.map((row) => row.path)).size, 2)
  })
}
check('numbered fallback skips existing and incoming reserved names', () => {
  const result = plan({ 'MEMORY.md': 'new main', 'MEMORY.from-pack-3.md': 'pack file' }, {
    'MEMORY.md': 'local', 'MEMORY.from-pack.md': 'old 1', 'MEMORY.from-pack-2.md': 'old 2',
  })
  assert.deepEqual(result.writeFiles, { 'MEMORY.from-pack-4.md': 'new main', 'MEMORY.from-pack-3.md': 'pack file' })
})
check('rename still uses the original name when the first backup slot is free', () => {
  assert.deepEqual(plan({ 'MEMORY.md': 'new' }, { 'MEMORY.md': 'local' }).writeFiles, { 'MEMORY.from-pack.md': 'new' })
  assert.equal(renameForConflictPre('handoff/PLAN.md'), 'handoff/PLAN.from-pack.md')
})
check('collision allocation preserves extensionless names and dotted directories', () => {
  assert.deepEqual(plan({ 'dir.v1/PLAN': 'new' }, {
    'dir.v1/PLAN': 'local', 'dir.v1/PLAN.from-pack': 'old backup',
  }).writeFiles, { 'dir.v1/PLAN.from-pack-2': 'new' })
})
check('keep, overwrite, and identical-content policies remain unchanged', () => {
  const files = { 'MEMORY.md': 'new', 'notes.md': 'same' }
  const existing = { 'MEMORY.md': 'local', 'notes.md': 'same', 'MEMORY.from-pack.md': 'backup' }
  assert.deepEqual(plan(files, existing, 'keep').writeFiles, { 'notes.md': 'same' })
  const result = plan(files, existing, 'overwrite')
  assert.deepEqual(result.writeFiles, files)
  assert.equal(result.overwrites.length, 1)
  assert.equal(result.overwrites[0].path, 'MEMORY.md')
})
check('applying rename plan preserves every pre-existing file', () => {
  const existing = { 'MEMORY.md': 'local', 'MEMORY.from-pack.md': 'older', 'notes.md': 'local notes' }
  const result = plan({ 'MEMORY.md': 'incoming', 'notes.md': 'other incoming' }, existing)
  const after = { ...existing, ...result.writeFiles }
  for (const [name, value] of Object.entries(existing)) assert.equal(after[name], value)
  assert.equal(after['MEMORY.from-pack-2.md'], 'incoming')
  assert.equal(after['notes.from-pack.md'], 'other incoming')
  assert.equal(result.stats.willWrite, Object.keys(result.writeFiles).length)
})

console.log('\n[migrate-pack-safe-import] ' + passed + ' passed, ' + failed + ' failed')
if (failed) process.exitCode = 1
