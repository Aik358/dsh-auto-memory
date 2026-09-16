#!/usr/bin/env node
/** Direct imports of production coordinator + host adapter, not source-extracted copies.
 * node:test reports each T1–T12 path; setup exceptions and zero-assertion exits fail.
 */
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
// Wiring fix (2026-09-16): pin the TAP reporter. Node's default test reporter is
// version/TTY dependent -- Node 24 emits the spec reporter ("tests 73" with an info
// glyph) while this harness (and compare-smoke.py) parse TAP ("# tests 73"), so the
// summary came back all-null and a fully green 73/275 run was reported as a failure.
const result = spawnSync(process.execPath, ['--test', '--test-concurrency=1', '--test-reporter=tap',
  'tests/fixtures.test.mjs', 'tests/continuation.test.mjs', 'tests/host-adapter.test.mjs'],
  { cwd: root, encoding: 'utf8', timeout: 45000, maxBuffer: 16 * 1024 * 1024 })
const text = (result.stdout || '') + (result.stderr || '')
process.stdout.write(text)
const get = name => Number([...text.matchAll(new RegExp('^# ' + name + ' (\\d+)$', 'gm'))].at(-1)?.[1] ?? NaN)
const assertions = [...text.matchAll(/ASSERTIONS_EXECUTED=(\d+)/g)].reduce((n, m) => n + Number(m[1]), 0)
const complete = get('tests') >= 73 && get('pass') === get('tests') && get('fail') === 0 && get('skipped') === 0 && get('cancelled') === 0 && assertions >= 275
console.log('AUTOCONT_HARNESS_SUMMARY=' + JSON.stringify({ tests: get('tests'), assertions, skipped: get('skipped'),
  cancelled: get('cancelled'), child_exit: result.status, setup_throw: /testCodeFailure|MODULE_NOT_FOUND|ERR_MODULE_NOT_FOUND/.test(text),
  production_path: 'direct imports: continuation-safety.js + continuation-host.js', complete }))
if (result.error) console.error(result.error)
process.exit(result.status === 0 && complete && !result.error ? 0 : 1)
