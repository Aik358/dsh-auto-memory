#!/usr/bin/env node
/**
 * Release-source reconciliation, retained from the #103–#112 port safeguards.
 * Source names are now release names. Git remotes and historical orphan SHAs
 * are not release inputs: a source archive must pass the same local gate.
 * --strict exits nonzero for missing artifacts, markers or unresolved pre files.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const RECONCILIATION_VERSION = 1
const REQUIRED_ARTIFACTS = [
  { p: 'lib/jsonl-tail-cursor.js', why: '#103 fingerprint cursor' },
  { p: 'lib/hub-io.js', why: '#110 observable hub writes' },
  { p: 'tests/smoke/smoke-test-issue103-105-portfix.mjs', why: '#103/#104/#105 regression' },
  { p: 'tests/smoke/smoke-test-issue110-hub-io.mjs', why: '#110 regression' },
  { p: 'tests/smoke/smoke-test-issue112-hermetic-home.mjs', why: '#112 isolated tests' },
  ...['release.mjs', 'reconcile-upstream.mjs', 'run-smoke.mjs', 'smoke-impact.mjs', 'build-iter5-skin.mjs', 'lib/appearance-scan.mjs']
    .map(name => ({ p: 'tools/' + name, why: 'self-contained release and verification tools' })),
]
const REQUIRED_MARKERS = [
  { p: 'lib/index.js', needle: 'engine.runtimes._shadowHost = engine._shadowHost', why: '#104 shadow host wiring' },
  { p: 'lib/index.js', needle: 'engine.runtimes._activationHost = engine._activationHost', why: '#104 activation host wiring' },
  { p: 'lib/index.js', needle: 'createJsonlTailCursorPre({ maxSeen: 1024 })', why: '#103 bounded fingerprint cursor' },
  { p: 'lib/index.js', needle: 'workspaceDiscoverMax', why: '#102 bounded workspace discovery' },
  { p: 'lib/python-setup.js', needle: 'Readable.fromWeb(resp.body)', why: '#105 WHATWG stream adapter' },
  { p: 'lib/python-setup.js', needle: 'await pipeline(src, createWriteStream(part', why: '#105 streamed payload write' },
]

export function reconcileReleaseSource(root) {
  const artifacts = REQUIRED_ARTIFACTS.map(a => {
    let present = false
    try { present = statSync(path.join(root, a.p)).isFile() } catch (_) {}
    return { ...a, present }
  })
  for (const marker of REQUIRED_MARKERS) {
    let present = false
    try { present = readFileSync(path.join(root, marker.p), 'utf8').includes(marker.needle) } catch (_) {}
    artifacts.push({ ...marker, present })
  }
  let unregistered
  try {
    unregistered = readdirSync(path.join(root, 'lib')).filter(name => name.endsWith('-pre.js'))
      .filter(name => {
        try { return !statSync(path.join(root, 'lib', name.replace(/-pre\.js$/, '.js'))).isFile() } catch (_) { return true }
      })
  } catch (_) { unregistered = ['lib/ unavailable'] }
  return { version: RECONCILIATION_VERSION, artifacts, unregistered }
}

const ownFile = fileURLToPath(import.meta.url)
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(ownFile)) {
  const args = process.argv.slice(2)
  if (args.some(arg => !['--json', '--strict'].includes(arg))) {
    console.error('usage: node tools/reconcile-upstream.mjs [--json] [--strict]')
    process.exitCode = 2
  } else {
    const result = reconcileReleaseSource(path.resolve(path.dirname(ownFile), '..'))
    const missing = result.artifacts.filter(a => !a.present)
    if (args.includes('--json')) console.log(JSON.stringify(result))
    else {
      for (const item of missing) console.error(item.p + (item.needle ? ': ' + item.needle : '') + ' — ' + item.why)
      for (const name of result.unregistered) console.error('unresolved pre module: ' + name)
      console.log('release source: ' + result.artifacts.length + ' checks; missing=' + missing.length + '; unresolved=' + result.unregistered.length)
    }
    if (args.includes('--strict') && (missing.length || result.unregistered.length)) {
      if (args.includes('--json')) {
        for (const item of missing) console.error('Missing release requirement: ' + item.p + ' — ' + item.why)
        for (const name of result.unregistered) console.error('Unresolved pre module: ' + name)
      }
      process.exitCode = 1
    }
  }
}
