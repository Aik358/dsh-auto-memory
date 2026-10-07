import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { lstatSync, readFileSync, readdirSync, mkdirSync, copyFileSync, renameSync, writeFileSync, rmSync, constants } from 'node:fs'
import { pathKey, resolvePhysicalTarget, physicalChildTarget } from './file-boundary.js'
import { withConfigLockSync } from './config-lock.js'

const OWNER_FILE = '.workspace-identity.json'
export const workspaceIdentityPre = ws => ws ? pathKey(String(ws)) : ''
export const legacyWorkspaceKeyPre = ws => ws ? '--' + String(ws).replace(/[\\/:*?"<>|]/g, '-') + '--' : 'default'

// Bound the readable label; the complete identity, including literal hyphens,
// separators and platform case semantics, participates in the suffix.
export function workspaceKeyPre(ws) {
  if (!ws) return 'default'
  const identity = workspaceIdentityPre(ws)
  const label = path.basename(identity).replace(/[\\/:*?"<>|]/g, '-').slice(0, 48) || 'workspace'
  return '--' + label + '--' + createHash('sha256').update(identity).digest('hex') + '--'
}

function entry(file) {
  try { return lstatSync(file) } catch (e) { if (e.code === 'ENOENT') return null; throw e }
}
function copyOwnedTree(source, target) {
  mkdirSync(target, { recursive: true })
  for (const item of readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, item.name), to = path.join(target, item.name)
    // A migration must not dereference unknown aliases or copy writer artifacts.
    if (item.isDirectory()) copyOwnedTree(from, to)
    else if (item.isFile()) {
      if (/\.(?:lock(?:\.acquire)?|tmp(?:[-.]\d+(?:[-.]\d+)*)?)$/.test(item.name)) continue
      copyFileSync(from, to, constants.COPYFILE_EXCL)
    } else throw new Error('workspace-migration-special-entry: ' + from)
  }
}

/** Legacy names lose information. Never assign an unowned historical library
 * to the first caller or clone it into two workspaces. A verified owner receipt
 * permits a staged, non-destructive copy; otherwise give explicit recovery paths.
 * After verifying a single owner, record
 * {schemaVersion:1,workspace:<exact path>} in OWNER_FILE and refresh.
 * A mixed historical bucket requires manual separation into distinct targets. */
export function workspaceDirectoryPre(root, ws, opts = {}) {
  const identity = workspaceIdentityPre(ws)
  const target = physicalChildTarget(root, path.join(root, workspaceKeyPre(ws)))
  const candidates = [...new Set([String(ws || ''), identity].map(value => path.join(root, legacyWorkspaceKeyPre(value))))]
  const legacy = candidates.find(file => entry(file)) || candidates[0]
  if (pathKey(target) === pathKey(legacy) || entry(target) || !entry(legacy)) return target
  const original = physicalChildTarget(root, legacy)
  const recovery = () => Object.assign(new Error(
    'workspace-legacy-owner-required: 旧目录键存在歧义，原记忆已保留。核对唯一归属后在原目录的 .workspace-identity.json 写入 {schemaVersion:1,workspace:工作区完整路径} 并刷新以无损迁移；混合记忆须人工拆分，勿给两个工作区重复指定同一原库。原目录=' + original + '；目标目录=' + target),
  { code: 'WORKSPACE_LEGACY_OWNER_REQUIRED', statusCode: 409, legacyDir: original, targetDir: target })
  let owner
  const ownReceipt = physicalChildTarget(original, path.join(original, OWNER_FILE))
  const ownerFile = entry(ownReceipt) ? ownReceipt : opts.ownerFile || ownReceipt
  try { owner = JSON.parse(readFileSync(ownerFile, 'utf8')) } catch (e) {
    if (e.code === 'ENOENT' || e instanceof SyntaxError) throw recovery()
    throw e
  }
  if (!owner || typeof owner !== 'object' || Array.isArray(owner) || owner.schemaVersion !== 1 || typeof owner.workspace !== 'string' || workspaceIdentityPre(owner.workspace) !== identity) throw recovery()
  return withConfigLockSync(target, () => {
    if (entry(target)) return target
    const physical = resolvePhysicalTarget(original)
    const stage = physicalChildTarget(root, target + '.migration-' + randomUUID())
    try {
      copyOwnedTree(physical, stage)
      // Translate only the historical reference in an explicitly owned library.
      // IDs/provenance and all other fields stay unchanged.
      const procedures = path.join(stage, 'hub', 'procedures.json')
      if (entry(procedures)) {
        const data = JSON.parse(readFileSync(procedures, 'utf8'))
        if (!Array.isArray(data.procedures)) throw new Error('workspace-migration-invalid-procedures')
        const refKey = value => process.platform === 'win32' ? String(value).toLowerCase() : String(value)
        const ownedRefs = new Set([path.basename(legacy), legacyWorkspaceKeyPre(ws), legacyWorkspaceKeyPre(identity), legacyWorkspaceKeyPre(owner.workspace)].map(refKey))
        for (const row of data.procedures) {
          if (row.scope === 'workspace' && ownedRefs.has(refKey(row.workspaceRef))) row.workspaceRef = workspaceKeyPre(ws)
        }
        writeFileSync(procedures, JSON.stringify(data), 'utf8')
      }
      writeFileSync(path.join(stage, OWNER_FILE), JSON.stringify({ schemaVersion: 1, workspace: identity }), 'utf8')
      renameSync(stage, target)
      return target
    } finally {
      if (entry(stage)) rmSync(stage, { recursive: true, force: true })
    }
  })
}
