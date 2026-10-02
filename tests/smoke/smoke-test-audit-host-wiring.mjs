import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { MemoryEngine } from '../lib/audit-engine.mjs'
import { createActivationInboxPre } from '../../lib/activation-inbox-state.js'
import { makeFakeActivationRequestPre } from '../../lib/activation-inbox.js'
import { buildPackPre } from '../../lib/migrate-pack.js'
const src = await readFile(new URL('../../lib/index.js', import.meta.url), 'utf8')
const root = await mkdtemp(path.join(os.tmpdir(), 'dam-audit-host-'))
const previous = process.env.DSH_HOME; process.env.DSH_HOME = root
try {
  const engine = new MemoryEngine(); engine.configLoaded = true
  Object.assign(engine.config, { memoryRoot: path.join(root,'memory'), userMemoryDir: path.join(root,'user'), officialCompactionRatio: undefined, officialHeadroomTokens: undefined, autoContinueEnabled: true, autoContinueThreshold: .95 })
  engine._officialParamsPre = () => ({ ratio: .6, headroomTokens: 5000, source: 'test-preset' })
  assert.equal(engine._resolveWaterLevelPre(100000, 1000, {}).source, 'test-preset')
  engine.config.officialCompactionRatio = .8; engine.config.officialHeadroomTokens = 0
  assert.equal(engine._resolveWaterLevelPre(100000,1000,{}).source,'plugin-config')
  assert.equal(engine._resolveWaterLevelPre(100000,1000,{}).officialRatio,.8)
  engine.isContinuedSession = () => false
  engine.armAutoContinue({ session: { id: 'test', header: { cwd: root } } }, { window: 1000000, tokens: 600000, ratio: .6, hard: true, modelKnown: true })
  assert.equal(engine._autoContState.armed.sessionId,'test')
  engine._autoContState = {}; engine.armAutoContinue({ session: { id: 'test', header: { cwd: root } } }, { window: 1000000, tokens: 600000, ratio: .6, hard: false, modelKnown: true })
  assert.equal(engine._autoContState.armed, undefined)
  const req = makeFakeActivationRequestPre({ sessionId:'s', agentId:'a', workspaceKey:root, contextVersion:1, memoryIndexVersion:'idx_pre_'+'a'.repeat(32), records:[{memoryId:'mem_'+'a'.repeat(32), anchorId:'anc_pre_1234567890abcdef', scope:'Workspace', sourceRef:'workspace:MEMORY.md', sourceEpoch:'33333333-3333-4333-8333-333333333333', sourceVersion:1, fileDigest:'a'.repeat(64), recordDigest:'b'.repeat(64), excerpt:'test'}], now:Date.now(), seed:'stale',ttlSteps:10 })
  const box = createActivationInboxPre({ sessionId:'s',agentId:'a',workspaceKey:root })
  assert.equal(box.offerActivation(req).ok,true)
  assert.equal(box.claim({ nowStep:1,currentContextVersion:1,currentMemoryIndexVersion:req.memoryIndexVersion }).ok,true)
  assert.equal(box.claim({ nowStep:2,currentMemoryIndexVersion:'idx_pre_'+'b'.repeat(32) }).reason,'stale-index')
  assert.equal(box.debugView().claimedPacketId,null)
  const start = src.indexOf('            const pid = String((body && body.procedureId)'); const end = src.indexOf('            // M9 审批动作', start)
  let transferred
  const route = new Function('engine','body','action','res','writeJson','diag',src.slice(start,end))
  assert.equal(route({ _scopedProcedureIo:{ migrate: rows => { transferred=rows;return {ok:true} } }, rehydrateProcedureScopes:()=>({ok:true}) },{procedureId:'proc_test',scope:'workspace'},'transfer-scope',{},(_res,status,data)=>({status,data}),()=>{}).status,200)
  assert.equal(transferred[0].procedureId,'proc_test')
  const pStart=src.indexOf('    pathsOf: () => (engine.state');const pEnd=src.indexOf('\n    activationHostOf:',pStart)
  const getter=new Function('engine','canonicalize','path','return ('+src.slice(pStart,pEnd).trim().replace(/^pathsOf: /,'').replace(/,$/,'')+')')({state:{ws:root,notesPath:'notes',logPath:'log'}}, x=>x,path)
  assert.equal(getter().notesPath,'notes'); assert.equal(getter().logPath,'log')
  const rich={id:'mem_test',source:'PLAN.md',title:'流程',tags:['topic:deploy'],cues:['rsync'],preview:'流程正文',kind:'plan'}
  const index=await engine._writeSidecarIndexPre(root,{entries:[rich]})
  assert.deepEqual(index.by_tag['topic:deploy'],[rich.id]);assert.deepEqual(index.by_cue.rsync,[rich.id])
  const pack=buildPackPre({ws:root,files:{'MEMORY.md':'new'},pluginVersion:'3.2.7',now:1}).pack
  engine._readPack=async()=>({ok:true,pack});let existing={'MEMORY.md':'old'}
  engine._readExistingWorkspaceFiles=async()=>existing
  const inspected=await engine.migrateInspect({packPath:'fake',targetWs:root,onConflict:'overwrite'})
  assert.equal((await engine.migrateImport({packPath:'fake',targetWs:root,onConflict:'overwrite'})).error,'preview-stale')
  existing={'MEMORY.md':'changed after preview'}
  assert.equal((await engine.migrateImport({packPath:'fake',targetWs:root,onConflict:'overwrite',previewToken:inspected.previewToken})).error,'preview-stale')
  const degrade=src.slice(src.indexOf('      const dg = (this._indexDegradeBySession'),src.indexOf('      const semanticArm =',src.indexOf('      const dg = (this._indexDegradeBySession')))
  const diagnostic=new Function('agentSessionId',degrade+'return indexNotReady')
  assert.equal(diagnostic.call({_lastIndexDegrade:{at:Date.now(),reason:'foreign'},_indexDegradeBySession:new Map()},'current'),null)
  engine.external.briefDetectSyncPre=()=>{ engine._testBrief=(engine._testBrief||0)+1; return 'external brief' }
  engine.config.globalBriefEnabled=true; engine.renderMemoryDynamic({})
  assert.equal(engine._testBrief,1)
  assert.ok(!src.includes('await this.latestLedgerNamePre('));assert.ok(src.includes("await engine.readTextSafe(path.join(prof.dir, 'node_modules'"))
  console.log('PASS F09 F10 F11 F15 F16 F17 F22 F28 R02 R04: host routes, stale claims, presets, hard overflow, indexes, preview CAS, diagnostics')
} finally { await rm(root,{recursive:true,force:true});if(previous===undefined)delete process.env.DSH_HOME;else process.env.DSH_HOME=previous }
