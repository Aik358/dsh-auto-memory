import assert from 'node:assert/strict'
import * as fs from 'node:fs/promises'
import mutableFs from 'node:fs/promises'
import { syncBuiltinESMExports } from 'node:module'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { loadPrivateEngine } from '../lib/load-private-engine.mjs'
import { migrateSettingsTree, validateSettingsPatch, validateSettingsPaths } from '../../lib/settings-safety.js'
const home = await fs.mkdtemp(path.join(tmpdir(), 'dsh-settings-safe-'))
const previousHome = process.env.DSH_HOME
process.env.DSH_HOME = home
try {
  const {MemoryEngine, DEFAULT_CONFIG} = await loadPrivateEngine()
  const engine = new MemoryEngine()
  const old = path.join(home,'old'), target=path.join(home,'new'), user=path.join(home,'user'), nextUser=path.join(home,'next-user')
  await fs.mkdir(path.join(old,'ws','handoff'),{recursive:true})
  await fs.writeFile(path.join(old,'ws','MEMORY.md'),'original notes')
  await fs.writeFile(path.join(old,'ws','a.md'),'A before failed migration')
  await fs.writeFile(path.join(old,'ws','handoff','PLAN.md'),'plan')
  await fs.mkdir(path.join(target,'ws'),{recursive:true})
  await fs.writeFile(path.join(target,'ws','MEMORY.md'),'existing target notes')
  await fs.mkdir(path.join(user,'summaries'),{recursive:true})
  await fs.mkdir(path.join(user,'greetings'),{recursive:true})
  await fs.mkdir(path.join(user,'semantic'),{recursive:true})
  await fs.writeFile(path.join(user,'MEMORY.md'),'user memory')
  await fs.writeFile(path.join(user,'PENDING-USER-MEMORY.md'),'pending user candidate')
  await fs.writeFile(path.join(user,'summaries','2026-10-03.md'),'summary')
  await fs.writeFile(path.join(user,'greetings','2026-10-03.json'),'{}')
  await fs.writeFile(path.join(user,'semantic','cache.json'),'runtime')
  engine.config = {...DEFAULT_CONFIG,memoryRoot:old,userMemoryDir:user}
  const configPath=engine._configPath
  await fs.writeFile(configPath,JSON.stringify(engine.config))
  const initial=await fs.readFile(configPath,'utf8')
  // Real fault in a nested destination after at least one sibling was copied.
  await fs.writeFile(path.join(target,'ws','handoff'),'directory blocker')
  await assert.rejects(engine.saveConfig({memoryRoot:target}), /migration failed/)
  assert.equal(engine.config.memoryRoot,old)
  assert.equal(await fs.readFile(configPath,'utf8'),initial)
  assert.equal(await fs.readFile(path.join(target,'ws','MEMORY.md'),'utf8'),'existing target notes')
  await assert.rejects(fs.stat(path.join(target,'ws','a.md')),{code:'ENOENT'})
  await fs.writeFile(path.join(old,'ws','a.md'),'A updated after migration failure')
  await fs.rm(path.join(target,'ws','handoff'))
  // Actual refresh is independent of the persisted commit, and an injected failure must be explicit.
  engine.refresh=async()=>{throw Error('injected refresh fault')}
  const saved=await engine.saveConfig({memoryRoot:target,userMemoryDir:nextUser})
  assert(saved.warning.includes('saved'))
  assert.equal(engine.config.memoryRoot,target)
  assert.equal(await fs.readFile(path.join(target,'ws','handoff','PLAN.md'),'utf8'),'plan')
  assert.equal(await fs.readFile(path.join(nextUser,'PENDING-USER-MEMORY.md'),'utf8'),'pending user candidate')
  assert.equal(await fs.readFile(path.join(target,'ws','a.md'),'utf8'),'A updated after migration failure')
  assert.equal(await fs.readFile(path.join(nextUser,'summaries','2026-10-03.md'),'utf8'),'summary')
  assert.equal(await fs.readFile(path.join(nextUser,'greetings','2026-10-03.json'),'utf8'),'{}')
  await assert.rejects(fs.stat(path.join(nextUser,'semantic')), {code:'ENOENT'})
  console.log('PASS actual MemoryEngine: failure preserves old config; retry fills nested gaps; target preserved; durable user subdirectories only')
  const durable=await fs.readFile(configPath,'utf8')
  engine._configPath=path.join(home,'block','settings.json')
  await fs.writeFile(path.join(home,'block'),'blocker')
  await assert.rejects(engine.saveConfig({memoryRoot:old}), /ENOTDIR|save failed/)
  assert.equal(engine.config.memoryRoot,target)
  engine._configPath=configPath
  assert.equal(await fs.readFile(configPath,'utf8'),durable)
  await Promise.all([engine.saveConfig({injectBudgetChars:1234}),engine.saveConfig({noteCapacityChars:4321})])
  const concurrent=JSON.parse(await fs.readFile(configPath,'utf8'))
  assert.equal(concurrent.injectBudgetChars,1234);assert.equal(concurrent.noteCapacityChars,4321)
  const beforeWriteFailure=await fs.readFile(configPath,'utf8'),beforeLocale=engine.config.locale
  const rollbackTarget=path.join(home,'config-failure-target')
  await fs.mkdir(rollbackTarget)
  const renameBefore = mutableFs.rename
  let deniedCommits = 0
  mutableFs.rename = async (from, to) => {
    if (to === configPath) {
      deniedCommits++
      throw Object.assign(new Error('injected configuration commit denied'), {code:'EPERM'})
    }
    return renameBefore(from, to)
  }
  syncBuiltinESMExports()
  try {
    await assert.rejects(engine.saveConfig({locale:'ja',memoryRoot:rollbackTarget}),/Configuration save failed/)
    assert.equal(engine.config.locale,beforeLocale)
    assert.equal(engine.config.memoryRoot,target)
    assert.equal(await fs.readFile(configPath,'utf8'),beforeWriteFailure)
    await assert.rejects(fs.stat(path.join(rollbackTarget,'ws','a.md')),{code:'ENOENT'})
    await assert.rejects(fs.stat(path.join(rollbackTarget,'.dsh-settings-migration.json')),{code:'ENOENT'})
    assert(deniedCommits > 0, 'fault reaches the atomic config commit after migration')
  } finally { mutableFs.rename = renameBefore; syncBuiltinESMExports() }
  console.log('PASS actual atomic config writer: denied commit preserves durable bytes and live config')
  const firstRoot=path.join(home,'first-complete'),secondRoot=path.join(home,'second-failure')
  await fs.mkdir(secondRoot);await fs.writeFile(path.join(secondRoot,'greetings'),'directory blocker')
  await assert.rejects(engine.saveConfig({memoryRoot:firstRoot,userMemoryDir:secondRoot}),/userMemoryDir: migration failed/)
  assert.equal(engine.config.memoryRoot,target);assert.equal(engine.config.userMemoryDir,nextUser)
  assert.equal(await fs.readFile(configPath,'utf8'),beforeWriteFailure)
  await assert.rejects(fs.stat(path.join(firstRoot,'ws','a.md')),{code:'ENOENT'})
  await assert.rejects(fs.stat(path.join(firstRoot,'.dsh-settings-migration.json')),{code:'ENOENT'})
  assert.equal(await fs.readFile(path.join(secondRoot,'greetings'),'utf8'),'directory blocker')
  console.log('PASS multi-root transaction: second migration failure rolls back completed first migration without touching preexisting data')
  await fs.writeFile(configPath,'broken JSON')
  await assert.rejects(engine.saveConfig({locale:'ja'}))
  assert.equal(await fs.readFile(configPath,'utf8'),'broken JSON')
  console.log('PASS actual MemoryEngine: write failure, concurrent saves, corrupt config preservation')
  assert.deepEqual(validateSettingsPatch({workbenchLoopShort:1000,workbenchLoopLong:2000}),{})
  engine.config.workbenchLoopShort=1000;engine.config.workbenchLoopLong=2000
  assert.equal(engine._subagentLoopSize('short'),1000);assert.equal(engine._subagentLoopSize('long'),2000)
  const good={dayBoundaryMinutes:0,workbenchLoopShort:2,workbenchLoopLong:720,autoSummaryTimes:[]}
  assert.deepEqual(validateSettingsPatch(good),{})
  assert.deepEqual(validateSettingsPatch({...good,dayBoundaryMinutes:1439,autoSummaryTimes:['00:00','23:59']}),{})
  for(const patch of [{dayBoundaryMinutes:-1},{dayBoundaryMinutes:1440},{dayBoundaryMinutes:0.5},{workbenchLoopShort:1},{workbenchLoopLong:2.5},{autoSummaryTimes:['24:00']},{autoSummaryTimes:['09:7']},{autoSummaryTimes:['12:00','']},{consolidateScheduleTime:'99:99'},{maintainScheduleTime:'7:00'}]) assert(Object.keys(validateSettingsPatch(patch)).length)
  const expand=value=>path.resolve(value)
  assert.deepEqual(await validateSettingsPaths({memoryRoot:path.join(home,'valid')},home,expand),{})
  assert((await validateSettingsPaths({memoryRoot:home+'-escape'},home,expand)).memoryRoot)
  assert((await validateSettingsPaths({userMemoryDir:''},home,expand)).userMemoryDir)
  assert.deepEqual(await validateSettingsPaths({workbenchRoot:''},home,expand),{})
  await fs.symlink(tmpdir(),path.join(home,'escape'),process.platform==='win32'?'junction':'dir')
  assert((await validateSettingsPaths({memoryRoot:path.join(home,'escape','external')},home,expand)).memoryRoot)
  await fs.writeFile(path.join(home,'plain-file'),'file')
  assert((await validateSettingsPaths({workbenchRoot:path.join(home,'plain-file','child')},home,expand)).workbenchRoot)
  let fileSymlinkAvailable = true
  try { await fs.symlink(path.join(home,'plain-file'),path.join(home,'file-link')) }
  catch (e) {
    if (process.platform !== 'win32' || e.code !== 'EPERM') throw e
    fileSymlinkAvailable = false
    console.log('SKIP file-symlink validation: Windows file-symlink permission unavailable')
  }
  if (fileSymlinkAvailable) assert((await validateSettingsPaths({workbenchRoot:path.join(home,'file-link','child')},home,expand)).workbenchRoot)
  console.log('PASS validation: HH:MM, empty off array, integer boundaries, DSH_HOME and symlink escape')
  // Fault injection into real copy workflow: a partial temporary must never land as a final file.
  const injectSrc=path.join(home,'inject-src'),injectDst=path.join(home,'inject-dst')
  await fs.mkdir(injectSrc);await fs.writeFile(path.join(injectSrc,'MEMORY.md'),'complete')
  await assert.rejects(migrateSettingsTree(injectSrc,injectDst,{io:{...fs,copyFile:async(from,to)=>{await fs.writeFile(to,'partial');throw Error('injected copy failure')}}}),/injected copy failure/)
  assert.deepEqual(await fs.readdir(injectDst),[])
  const readFailure={...fs,readdir:async()=>{throw Object.assign(Error('injected read denial'),{code:'EACCES'})}}
  await assert.rejects(migrateSettingsTree(injectSrc,injectDst,{io:readFailure}),/read denial/)
  await migrateSettingsTree(injectSrc,injectDst)
  assert.equal(await fs.readFile(path.join(injectDst,'MEMORY.md'),'utf8'),'complete')
  console.log('PASS migration fault injection: read errors observable, partial copy cleanup, complete retry')
  // A file copied early must not change unnoticed while later siblings copy.
  const changeSrc=path.join(home,'change-src'),changeDst=path.join(home,'change-dst')
  await fs.mkdir(changeSrc);await fs.writeFile(path.join(changeSrc,'a.md'),'original A');await fs.writeFile(path.join(changeSrc,'b.md'),'original B')
  const changingIO={...fs,copyFile:async(from,to,flags)=>{await fs.copyFile(from,to,flags);if(from.endsWith('b.md'))await fs.writeFile(path.join(changeSrc,'a.md'),'A changed during migration')}}
  await assert.rejects(migrateSettingsTree(changeSrc,changeDst,{io:changingIO}),/source or destination changed/)
  assert.equal(await fs.readFile(path.join(changeSrc,'a.md'),'utf8'),'A changed during migration')
  console.log('PASS migration final verification: early copied files cannot silently change during later copying')

  // Simulate a failed rollback, then resume with a fresh invocation (durable provenance).
  const retrySrc=path.join(home,'retry-src'),retryDst=path.join(home,'retry-dst')
  await fs.mkdir(retrySrc);await fs.mkdir(retryDst)
  await fs.writeFile(path.join(retrySrc,'a.md'),'old A');await fs.writeFile(path.join(retrySrc,'b.md'),'B')
  await fs.writeFile(path.join(retrySrc,'c.md'),'source C');await fs.writeFile(path.join(retryDst,'c.md'),'preexisting target C')
  const failedCleanup={...fs,copyFile:async(from,to,flags)=>{if(from.endsWith('b.md'))throw Error('injected B failure');return fs.copyFile(from,to,flags)},unlink:async()=>{throw Error('injected rollback denial')}}
  await assert.rejects(migrateSettingsTree(retrySrc,retryDst,{io:failedCleanup}),/rollback pending/)
  assert.equal(await fs.readFile(path.join(retryDst,'a.md'),'utf8'),'old A')
  await fs.writeFile(path.join(retrySrc,'a.md'),'new A after failure')
  await migrateSettingsTree(retrySrc,retryDst)
  assert.equal(await fs.readFile(path.join(retryDst,'a.md'),'utf8'),'new A after failure')
  assert.equal(await fs.readFile(path.join(retryDst,'c.md'),'utf8'),'preexisting target C')
  await assert.rejects(fs.stat(path.join(retryDst,'.dsh-settings-migration.json')),{code:'ENOENT'})
  console.log('PASS durable migration ownership: failed rollback, updated source, fresh retry; preexisting target never overwritten')
  // An outside edit to a migration-owned file must be preserved and block publication.
  const editedDst=path.join(home,'edited-target');await fs.mkdir(editedDst)
  await assert.rejects(migrateSettingsTree(retrySrc,editedDst,{io:failedCleanup}),/rollback pending/)
  await fs.writeFile(path.join(editedDst,'a.md'),'external target edit')
  await assert.rejects(migrateSettingsTree(retrySrc,editedDst),/modified externally/)
  assert.equal(await fs.readFile(path.join(editedDst,'a.md'),'utf8'),'external target edit')
  console.log('PASS migration rollback preserves externally edited owned files and refuses uncertain publication')
  // Real DSH_HOME symlink aliases: reject equality and either containment before mkdir.
  const canonicalRoot=path.join(home,'canonical'),alias=path.join(home,'alias')
  await fs.mkdir(path.join(canonicalRoot,'mem'),{recursive:true});await fs.symlink(canonicalRoot,alias,process.platform==='win32'?'junction':'dir')
  const canonicalSrc=path.join(canonicalRoot,'mem'),nestedAlias=path.join(alias,'mem','nested')
  assert.deepEqual(await validateSettingsPaths({memoryRoot:nestedAlias},home,expand),{})
  for(const [from,to] of [[canonicalSrc,nestedAlias],[canonicalSrc,path.join(alias,'mem')],[path.join(canonicalSrc,'missing'),alias]])await assert.rejects(migrateSettingsTree(from,to),/must not overlap/)
  await assert.rejects(fs.stat(path.join(canonicalSrc,'nested')),{code:'ENOENT'})
  await assert.rejects(fs.stat(path.join(canonicalSrc,'missing')),{code:'ENOENT'})
  console.log('PASS canonical overlap: symlink equality and both nesting directions rejected before directory creation')

} finally {
  if(previousHome===undefined)delete process.env.DSH_HOME;else process.env.DSH_HOME=previousHome
  await fs.rm(home,{recursive:true,force:true})
}
