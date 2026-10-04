import assert from 'node:assert/strict'
import * as fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { migrateSettingsTree } from '../../lib/settings-safety.js'
import { withCalendarLock } from '../../lib/calendar-lock.js'

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-settings-migration-boundaries-'))
try {
  const source = path.join(root, 'old'), target = path.join(root, 'new')
  const oldPlan = path.join(source, 'workspace', 'handoff', 'PLAN.md')
  const newPlan = path.join(target, 'workspace', 'handoff', 'PLAN.md')
  await fs.mkdir(path.dirname(oldPlan), {recursive:true})
  await fs.writeFile(oldPlan, 'existing plan')
  await fs.writeFile(path.join(source, 'workspace', 'writer.lock.acquire'), 'active gate')
  await fs.writeFile(path.join(source, 'workspace', 'writer.tmp-1'), 'partial write')
  await fs.writeFile(path.join(source, 'workspace', 'writer.tmp.1'), 'partial write')
  await withCalendarLock(oldPlan, () => migrateSettingsTree(source, target))
  for (const relative of ['handoff/PLAN.md.lock', 'writer.lock.acquire', 'writer.tmp-1', 'writer.tmp.1']) {
    await assert.rejects(fs.stat(path.join(target, 'workspace', relative)), {code:'ENOENT'})
  }
  await withCalendarLock(newPlan, () => fs.appendFile(newPlan, '\nnew-root edit'), {timeoutMs:100})
  assert.equal(await fs.readFile(newPlan, 'utf8'), 'existing plan\nnew-root edit')
  assert.equal(await fs.readFile(oldPlan, 'utf8'), 'existing plan')
  console.log('PASS active source PLAN lock is not migrated; new-root writes acquire their own lock')

  const userSource = path.join(root, 'user-old'), userTarget = path.join(root, 'user-new')
  await fs.mkdir(userSource)
  await fs.writeFile(path.join(userSource, 'MEMORY.md'), 'accepted memory')
  await fs.writeFile(path.join(userSource, 'PENDING-USER-MEMORY.md'), 'pending candidate')
  await migrateSettingsTree(userSource, userTarget, {user:true})
  assert.equal(await fs.readFile(path.join(userTarget, 'PENDING-USER-MEMORY.md'), 'utf8'), 'pending candidate')
  assert.equal(await fs.readFile(path.join(userSource, 'PENDING-USER-MEMORY.md'), 'utf8'), 'pending candidate')
  await fs.writeFile(path.join(userTarget, 'PENDING-USER-MEMORY.md'), 'existing destination candidate')
  await migrateSettingsTree(userSource, userTarget, {user:true})
  assert.equal(await fs.readFile(path.join(userTarget, 'PENDING-USER-MEMORY.md'), 'utf8'), 'existing destination candidate')
  console.log('PASS pending user candidates migrate with source preservation and existing-target retention')
} finally {
  await fs.rm(root, {recursive:true, force:true})
}
