import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

// Probe only the capability in a fresh writable test directory. Actual links
// are created normally afterwards, so their unexpected setup errors still fail.
export function probeFileSymlinks(root, { required = process.platform !== 'win32' || process.env.DSH_REQUIRE_FILE_SYMLINK === '1' } = {}) {
  const dir = fs.mkdtempSync(path.join(path.resolve(root), 'file-link-probe-'))
  assert.equal(path.dirname(dir), path.resolve(root))
  try {
    const target = path.join(dir, 'target.txt'), link = path.join(dir, 'link.txt')
    fs.writeFileSync(target, 'SYNTHETIC_LINK_CAPABILITY')
    try { fs.symlinkSync(target, link, 'file') } catch (error) {
      const unsupported = process.platform === 'win32' && ['EPERM', 'ENOTSUP', 'ENOSYS'].includes(error.code)
      if (!unsupported || required) throw error
      const result = { available: false, platform: process.platform, reason: error.code }
      console.log('CAPABILITY file-symlink ' + JSON.stringify(result))
      return result
    }
    assert(fs.lstatSync(link).isSymbolicLink(), 'probe must create a real file symlink')
    assert.equal(fs.realpathSync(link), fs.realpathSync(target))
    assert.equal(fs.readFileSync(link, 'utf8'), 'SYNTHETIC_LINK_CAPABILITY')
    const result = { available: true, platform: process.platform }
    console.log('CAPABILITY file-symlink ' + JSON.stringify(result))
    return result
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
}

export function directoryLink(target, link) {
  fs.symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir')
  assert(fs.lstatSync(link).isSymbolicLink(), 'directory boundary fixture must be a real link')
}

export function unprovenFileLink(capability, label) {
  assert.equal(capability.available, false, 'only an unavailable capability can leave a file-link case unproven')
  console.log('UNPROVEN file-symlink case: ' + label + ' (' + capability.platform + '/' + capability.reason + '); directory-link and ordinary-path controls still run')
}
