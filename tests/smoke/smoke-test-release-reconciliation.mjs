import assert from 'node:assert/strict'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = fileURLToPath(new URL('../..', import.meta.url))
const temporary = mkdtempSync(path.join(tmpdir(), 'dam-release-reconcile-'))
const source = path.join(temporary, 'source')
const home = path.join(temporary, 'home')
const staging = []
mkdirSync(source)
mkdirSync(home)
const env = { ...process.env, HOME: home, USERPROFILE: home, DSH_HOME: path.join(home, '.dsh'), DSH_AUTO_MEMORY_DEV: source }

function release(version, cwd = source) {
  const run = spawnSync(process.execPath, [path.join(cwd, 'tools/release.mjs'), version, '--dry-run'], {
    cwd, env: { ...env, DSH_AUTO_MEMORY_DEV: cwd }, encoding: 'utf8', timeout: 30000,
  })
  const stage = run.stdout?.match(/staging 目录: (.+)/)?.[1]?.trim()
  if (stage) staging.push(stage)
  assert.ifError(run.error)
  return { ...run, stage, output: run.stdout + run.stderr }
}
function mutate(file, transform, check) {
  const target = path.join(source, file)
  const original = readFileSync(target)
  try { transform(target, original); check() }
  finally { writeFileSync(target, original) }
}
function rejected(pattern) {
  const run = release(version)
  assert.equal(run.status, 1, run.output)
  assert.match(run.output, pattern)
}

const version = JSON.parse(readFileSync(path.join(repo, 'package.json'), 'utf8')).version
try {
  // A source archive has no git directory, remotes, models or private artifacts.
  for (const name of ['lib', 'python', 'skins', 'tests', 'tools', '.github', 'docs', 'package.json', 'cordis.patch.yml', 'CHANGELOG.md', 'README.md', 'README.zh-CN.md', 'LICENSE', 'icon.svg', 'locale', 'notices.json', 'social-preview.html']) {
    if (existsSync(path.join(repo, name))) cpSync(path.join(repo, name), path.join(source, name), { recursive: true })
  }
  assert.equal(existsSync(path.join(source, '.git')), false)
  const successful = release(version)
  assert.equal(successful.status, 0, successful.output)
  for (const message of ['上游回流: OK', '版本标识一致性: OK', '凭据泄露闸门 ✓', 'python/ 运行时完整 ✓', 'dry-run 完成']) assert.ok(successful.output.includes(message), message)
  for (const file of ['reconcile-upstream.mjs', 'release.mjs', 'run-smoke.mjs', 'smoke-impact.mjs', 'build-iter5-skin.mjs', 'lib/appearance-scan.mjs']) {
    assert.ok(existsSync(path.join(successful.stage, 'tools', file)), 'staged tool missing: ' + file)
  }
  // Staging itself must be a complete source for a later dry-run.
  const repeated = release(version, successful.stage)
  assert.equal(repeated.status, 0, repeated.output)
  console.log('PASS source without git and its release staging both finish all release gates')

  mutate('tools/reconcile-upstream.mjs', file => rmSync(file), () => rejected(/reconcile-upstream\.mjs[\s\S]*MODULE_NOT_FOUND|Cannot find module/))
  mutate('lib/jsonl-tail-cursor.js', file => rmSync(file), () => rejected(/Missing release requirement: lib\/jsonl-tail-cursor\.js/))
  mutate('lib/index.js', (file, original) => {
    const text = original.toString('utf8')
    const marker = 'engine.runtimes._shadowHost = engine._shadowHost'
    assert.ok(text.includes(marker))
    writeFileSync(file, text.replace(marker, 'void engine._shadowHost'))
  }, () => rejected(/#104 shadow host wiring/))
  mutate('tools/reconcile-upstream.mjs', file => writeFileSync(file, 'console.log(JSON.stringify({}))'), () => rejected(/Invalid release reconciliation result/))
  console.log('PASS missing helper, upstream module, upstream fix marker and empty evidence all fail closed')

  const wrongVersion = release('999.999.999')
  assert.equal(wrongVersion.status, 1, wrongVersion.output)
  assert.match(wrongVersion.output, /版本标识未同步/)
  const credentialFile = path.join(source, 'docs', 'release-credential-negative.md')
  mkdirSync(path.dirname(credentialFile), { recursive: true })
  try {
    writeFileSync(credentialFile, 'ghp_' + 'x'.repeat(36))
    rejected(/发布树内检出疑似凭据/)
  } finally { rmSync(credentialFile) }
  mutate('python/worker_semantic_v1.py', file => rmSync(file), () => rejected(/python\/ 运行时缺失: worker_semantic_v1\.py/))
  console.log('PASS version, credential and runtime-payload gates remain effective after reconciliation')
} finally {
  for (const dir of staging) {
    // Only remove exact staging paths emitted by our dry-run children.
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(tmpdir()))
    assert.ok(path.basename(dir).startsWith('dam-release-staging-'))
    rmSync(dir, { recursive: true, force: true })
  }
  assert.equal(path.dirname(temporary), path.resolve(tmpdir()))
  rmSync(temporary, { recursive: true, force: true })
}
