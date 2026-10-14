import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createProcedureStorePre } from '../../lib/procedure-store.js'
import { exportSkillForPre } from '../../lib/skill-export-host.js'

const root = mkdtempSync(path.join(tmpdir(), 'dam-360-'))
try {
  const st = createProcedureStorePre()
  const { procedure: p } = st.observe({ title: 'approval', steps: ['safe'], successCriteria: ['done'], riskLevel: 'low', origin: 'agent' })
  st.promote(p.procedureId, { distinctSessions: 9, successCount: 9 })
  st.activate(p.procedureId)
  const opts = { skillsRoot: root, projectPath: root }
  const first = exportSkillForPre(st.get(p.procedureId), opts)
  assert.equal(first.ok, true)
  const original = readFileSync(first.file, 'utf8')
  const u = st.update(p.procedureId, { riskLevel: 'high', steps: ['dangerous new version'] })
  assert.equal(u.ok, true)
  assert.equal(u.approvalReset, true)
  assert.equal(exportSkillForPre(u.procedure, opts).ok, false)
  assert.equal(readFileSync(first.file, 'utf8'), original)
  st.approve(p.procedureId, 'user')
  st.promote(p.procedureId, { distinctSessions: 9, successCount: 9 })
  st.activate(p.procedureId)
  assert.equal(exportSkillForPre(st.get(p.procedureId), opts).ok, true)
  st.update(p.procedureId, { steps: ['another controlled version'] })
  assert.equal(st.get(p.procedureId).approved, false)
  assert.equal(exportSkillForPre(st.get(p.procedureId), opts).ok, false)
  console.log('PASS #360 publication requires approval of the current controlled content')
} finally { rmSync(root, { recursive: true, force: true }) }
