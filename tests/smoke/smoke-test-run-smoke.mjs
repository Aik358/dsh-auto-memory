// Exercise the shipped CLI and its imports in an isolated, dependency-free repo.
import assert from 'node:assert/strict'
import { spawnSync, execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../..', import.meta.url))
const fixture = mkdtempSync(path.join(tmpdir(), 'dam-smoke-runner-'))
const write = (name, src) => writeFileSync(path.join(fixture, name), src, 'utf8')
const run = (...args) => {
  const result = spawnSync(process.execPath, ['tools/run-smoke.mjs', ...args], {
    cwd: fixture, encoding: 'utf8', timeout: 15000, windowsHide: true,
  })
  assert.ifError(result.error)
  return { code: result.status, output: result.stdout + result.stderr }
}
const git = (...args) => execFileSync('git', args, { cwd: fixture, stdio: 'pipe', windowsHide: true })

try {
  // Execute the release copy loop itself against the fixture to catch a future
  // release sync dropping an import while keeping its dependent entry point.
  const release = readFileSync(path.join(root, 'tools/release.mjs'), 'utf8')
  const copyLoop = release.match(/for \(const toolFile of '[^']+'\.split\(','\)\) \{[\s\S]*?\n\}/)
  assert.ok(copyLoop, 'release tool copy loop must remain identifiable')
  const releaseTools = path.join(fixture, 'released')
  write('release-copy.mjs', "import { existsSync, mkdirSync, cpSync } from 'node:fs'\nimport path from 'node:path'\nconst DEV = process.argv[2], REL = process.argv[3]\n" + copyLoop[0])
  const copy = spawnSync(process.execPath, [path.join(fixture, 'release-copy.mjs'), root, releaseTools], { encoding: 'utf8', timeout: 5000, windowsHide: true })
  assert.ifError(copy.error)
  assert.equal(copy.status, 0, copy.stdout + copy.stderr)
  const releasedHelp = spawnSync(process.execPath, [path.join(releaseTools, 'tools/run-smoke.mjs'), '--help'], { encoding: 'utf8', timeout: 5000, windowsHide: true })
  assert.ifError(releasedHelp.error)
  assert.equal(releasedHelp.status, 0, releasedHelp.stdout + releasedHelp.stderr)
  for (const dir of ['tools', 'lib', 'tests/smoke']) mkdirSync(path.join(fixture, dir), { recursive: true })
  for (const name of ['run-smoke.mjs', 'smoke-impact.mjs']) {
    copyFileSync(path.join(root, 'tools', name), path.join(fixture, 'tools', name))
  }
  write('lib/index.js', 'export const value = 1\n')
  write('lib/中文.js', 'export const value = 1\n')
  write('tests/smoke/pass.mjs', "// readFileSync('lib/中文.js')\nconsole.log('fixture pass')\n")
  write('tests/smoke/fail.mjs', "console.error('fixture failure'); process.exit(7)\n")
  write('tests/smoke/hang.mjs', 'setInterval(() => {}, 1000)\n')
  write('tests/smoke/lock.mjs', "// createHash('sha256')\nconsole.log('fixture lock')\n")
  git('init', '--quiet')
  git('add', '.')
  git('-c', 'user.name=Smoke Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'fixture')
  git('mv', 'lib/中文.js', 'lib/中文 新.js')
  write('lib/index.js', 'export const value = 2\n')

  const help = run('--help')
  assert.equal(help.code, 0, help.output)
  assert.match(help.output, /usage:/)

  const impact = run('--impact', '--impact-all')
  assert.equal(impact.code, 0, impact.output)
  assert.match(impact.output, /lib\/中文 新\.js/)
  assert.match(impact.output, /lib\/中文\.js/)
  assert.match(impact.output, /pass\.mjs\s+<- lib\/中文\.js/)
  assert.match(impact.output, /\* lock\.mjs/)
  assert.doesNotMatch(impact.output, /\[PASS|fixture failure/)

  const focused = run('--impact-run', '--jobs=1')
  assert.equal(focused.code, 0, focused.output)
  assert.match(focused.output, /PASS 2 \/ FAIL 0 \/ TIMEOUT 0/)

  const pass = run('--jobs=1', '--filter=pass')
  assert.equal(pass.code, 0, pass.output)
  assert.match(pass.output, /PASS 1 \/ FAIL 0 \/ TIMEOUT 0/)

  const excluded = run('--jobs=1', '--exclude=fail', '--exclude=hang')
  assert.equal(excluded.code, 0, excluded.output)
  assert.match(excluded.output, /PASS 2 \/ FAIL 0 \/ TIMEOUT 0/)

  const failure = run('--filter=fail')
  assert.equal(failure.code, 1, failure.output)
  assert.match(failure.output, /FAILED: fail\.mjs/)
  assert.match(failure.output, /fixture failure/)

  const timeout = run('--filter=hang', '--timeout=100')
  assert.equal(timeout.code, 1, timeout.output)
  assert.match(timeout.output, /PASS 0 \/ FAIL 0 \/ TIMEOUT 1/)
  assert.match(timeout.output, /FAILED: hang\.mjs/)
  assert.equal(run('--filter=absent').code, 2)
  console.log('[run-smoke] CLI imports, impact, filtering, failures and timeout: PASS')
} finally {
  rmSync(fixture, { recursive: true, force: true })
}
