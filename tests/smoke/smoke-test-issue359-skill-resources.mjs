import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { exportSkillForPre, listExportedSkillsPre } from '../../lib/skill-export-host.js'

const root = mkdtempSync(path.join(tmpdir(), 'dam-359-'))
try {
  const p = { procedureId: 'procedure-resource-preservation', title: 'old title', stage: 'active', steps: ['step'], successCriteria: ['done'], riskLevel: 'low' }
  const opts = { skillsRoot: root, projectPath: root }
  const first = exportSkillForPre(p, opts)
  assert.equal(first.ok, true)
  mkdirSync(path.join(first.dir, 'scripts'))
  const user = path.join(first.dir, 'scripts', 'user.js')
  writeFileSync(user, 'user-owned bytes')
  const next = exportSkillForPre({ ...p, title: 'new title' }, opts)
  assert.equal(next.ok, true)
  assert.equal(readFileSync(user, 'utf8'), 'user-owned bytes')
  assert.equal(existsSync(first.file), false)
  assert.equal(listExportedSkillsPre(root).length, 1)
  console.log('PASS #359 rename preserves user resources and retires stale entry')
} finally { rmSync(root, { recursive: true, force: true }) }
