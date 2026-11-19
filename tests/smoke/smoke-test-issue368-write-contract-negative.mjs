import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dam-368-'))
// ★2026-10-14 吸收 PR#420：该套件检查的是「写入调用必须 await/return」，与开发树既有的
//   tools/check-write-contract.mjs（#332 吸收：ok/committed/indexStale/error 契约 + 变异对照）
//   是同名异物 ⇒ 本文件改用重命名后的 check-write-contract-await.mjs，两者并存互不覆盖。
const checker = fileURLToPath(new URL('../../tools/check-write-contract-await.mjs', import.meta.url))
try {
  const source = fs.readFileSync(new URL('../../lib/index.js', import.meta.url), 'utf8')
  const file = path.join(root, 'index.js')
  const good = spawnSync(process.execPath, [checker], { encoding: 'utf8' })
  assert.equal(good.status, 0, good.stderr)
  console.log('PASS #368 production: ' + good.stdout.trim())

  function rejects(label, from, to, writer) {
    assert.equal(source.split(from).length - 1, 1, label + ': mutation anchor must be unique')
    assert.notEqual(from, to, label)
    fs.writeFileSync(file, source.replace(from, to))
    const bad = spawnSync(process.execPath, [checker, file], { encoding: 'utf8' })
    assert.equal(bad.status, 1, label + ': ' + bad.stdout + bad.stderr)
    assert.equal(bad.stderr.trim().replace(/^\d+: /, ''), writer + ' must be awaited or returned', label)
    console.log('PASS #368 ' + label + ': ' + bad.stderr.trim())
  }

  rejects('missing await', 'await engine.writeFull(targetFile, r.text', 'engine.writeFull(targetFile, r.text', 'writeFull')
  const arrow = '=> engine.writePlanSnapshot(dir, content, opts), workspaceKey:'
  rejects('block drops writer result', arrow, '=> { engine.writePlanSnapshot(dir, content, opts) }, workspaceKey:', 'writePlanSnapshot')
  rejects('preceding arrow does not return writer result', arrow, '=> { (() => true)(); engine.writePlanSnapshot(dir, content, opts) }, workspaceKey:', 'writePlanSnapshot')
  rejects('arrow uses writer result as condition', arrow, '=> engine.writePlanSnapshot(dir, content, opts) ? 1 : 0, workspaceKey:', 'writePlanSnapshot')
  const eol = source.includes('\r\n') ? '\r\n' : '\n'
  rejects('condition continues on next line', arrow, '=> engine.writePlanSnapshot(dir, content, opts)' + eol + '            ? 1 : 0, workspaceKey:', 'writePlanSnapshot')
} finally { fs.rmSync(root, { recursive: true, force: true }) }
