import assert from 'node:assert/strict'
import * as fs from 'node:fs/promises'
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
  await fs.writeFile(path.join(old,'ws','handoff','PLAN.md'),'plan')
  await fs.mkdir(path.join(target,'ws'),{recursive:true})
  await fs.writeFile(path.join(target,'ws','MEMORY.md'),'existing target notes')
  await fs.mkdir(path.join(user,'summaries'),{recursive:true})
  await fs.mkdir(path.join(user,'greetings'),{recursive:true})
  await fs.mkdir(path.join(user,'semantic'),{recursive:true})
  await fs.writeFile(path.join(user,'MEMORY.md'),'user memory')
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
  await fs.rm(path.join(target,'ws','handoff'))
  // Actual refresh is independent of the persisted commit, and an injected failure must be explicit.
  engine.refresh=async()=>{throw Error('injected refresh fault')}
  const saved=await engine.saveConfig({memoryRoot:target,userMemoryDir:nextUser})
  assert(saved.warning.includes('saved'))
  assert.equal(engine.config.memoryRoot,target)
  assert.equal(await fs.readFile(path.join(target,'ws','handoff','PLAN.md'),'utf8'),'plan')
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
  await fs.chmod(home,0o555)
  try {
    await assert.rejects(engine.saveConfig({locale:'ja'}),/Configuration save failed/)
    assert.equal(engine.config.locale,beforeLocale)
    assert.equal(await fs.readFile(configPath,'utf8'),beforeWriteFailure)
  } finally { await fs.chmod(home,0o755) }
  console.log('PASS actual atomic config writer: unwritable directory preserves durable bytes and live config')
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
  await fs.symlink(tmpdir(),path.join(home,'escape'),'dir')
  assert((await validateSettingsPaths({memoryRoot:path.join(home,'escape','external')},home,expand)).memoryRoot)
  await fs.writeFile(path.join(home,'plain-file'),'file');await fs.symlink(path.join(home,'plain-file'),path.join(home,'file-link'))
  assert((await validateSettingsPaths({workbenchRoot:path.join(home,'file-link','child')},home,expand)).workbenchRoot)
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

} finally {
  if(previousHome===undefined)delete process.env.DSH_HOME;else process.env.DSH_HOME=previousHome
  await fs.rm(home,{recursive:true,force:true})
}
