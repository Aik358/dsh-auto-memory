import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { auditTemp, mountAuditHost, callAuditRoute } from '../lib/audit-host-fixture.mjs'
const root = await auditTemp('dam-boundary-routes-')
const host = await mountAuditHost(root)
try {
  const memory = path.join(root, 'memory'), outside = path.join(root, 'outside')
  await fs.mkdir(memory); await fs.mkdir(outside)
  await fs.writeFile(path.join(outside, 'fixture.txt'), 'OUTSIDE_SECRET_FIXTURE')
  await fs.writeFile(path.join(memory, 'fixture.txt'), 'INSIDE_FIXTURE')
  await fs.symlink(outside, path.join(memory, 'escape'), process.platform === 'win32' ? 'junction' : 'dir')
  await fs.symlink(memory, path.join(root, 'memory-alias'), process.platform === 'win32' ? 'junction' : 'dir')
  host.engine.userDirOf = () => path.join(root, 'memory-alias')
  host.engine.state.projectDir = memory
  host.engine.refresh = async () => {}
  host.engine.resolvePaths = async () => ({ projectDir: memory })
  for (const target of [path.join(memory, 'escape', 'fixture.txt'), path.join(outside, 'fixture.txt')]) {
    assert.equal((await callAuditRoute(host, 'file', undefined, '?path=' + encodeURIComponent(target))).status, 403)
  }
  const good = await callAuditRoute(host, 'file', undefined, '?path=' + encodeURIComponent(path.join(memory, 'fixture.txt')))
  assert.equal(good.status, 200); assert.equal(good.body.content, 'INSIDE_FIXTURE')
  if (process.platform !== 'win32') {
    await fs.symlink(path.join(outside, 'fixture.txt'), path.join(memory, 'file-escape'))
    assert.equal((await callAuditRoute(host, 'file', undefined, '?path=' + encodeURIComponent(path.join(memory, 'file-escape')))).status, 403)
  }
  const skinRoot = path.join(process.env.DSH_HOME, 'memory', 'skins')
  const preserved = path.join(process.env.DSH_HOME, 'memory', 'theme.json')
  await fs.mkdir(skinRoot, { recursive: true }); await fs.writeFile(preserved, 'PRESERVE_SIBLING')
  let requests = 0
  globalThis.fetch = async () => { requests++; return new Response('FIXTURE_SKIN_FILE', { status: 200 }) }
  for (const name of ['.', '..']) {
    assert.equal((await callAuditRoute(host, 'skinLibraryFetch', { repo: 'fixture-owner/fixture-repo', action: 'install', name })).status, 400)
  }
  await fs.symlink(outside, path.join(skinRoot, 'escape'), process.platform === 'win32' ? 'junction' : 'dir')
  assert.equal((await callAuditRoute(host, 'skinLibraryFetch', { repo: 'fixture-owner/fixture-repo', action: 'install', name: 'escape' })).status, 400)
  assert.equal(requests, 0, 'reject before downloading')
  // A link created during the download must be checked again before each write.
  let retargeted = false
  globalThis.fetch = async () => {
    if (!retargeted) {
      retargeted = true
      await fs.symlink(outside, path.join(skinRoot, 'retargeted'), process.platform === 'win32' ? 'junction' : 'dir')
    }
    return new Response('FIXTURE_SKIN_FILE', { status: 200 })
  }
  const raced = await callAuditRoute(host, 'skinLibraryFetch', { repo: 'fixture-owner/fixture-repo', action: 'install', name: 'retargeted' })
  assert.equal(raced.body.ok, false)
  globalThis.fetch = async () => new Response('FIXTURE_SKIN_FILE', { status: 200 })
  const installed = await callAuditRoute(host, 'skinLibraryFetch', { repo: 'fixture-owner/fixture-repo', action: 'install', name: 'valid-skin' })
  assert.equal(installed.body.ok, true)
  assert.equal(await fs.readFile(path.join(skinRoot, 'valid-skin', 'theme.json'), 'utf8'), 'FIXTURE_SKIN_FILE')
  assert.equal(await fs.readFile(preserved, 'utf8'), 'PRESERVE_SIBLING')
  assert.equal((await fs.readdir(outside)).includes('theme.json'), false)
  console.log('PASS physical file boundaries, root aliases, dot-name rejection, skin link rejection and valid install')
} finally { host.dispose(); await fs.rm(root, { recursive: true, force: true }) }
