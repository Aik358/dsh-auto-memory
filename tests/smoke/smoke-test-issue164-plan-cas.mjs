import assert from 'node:assert/strict'
import {mkdtemp,readFile,writeFile,mkdir,rm,readdir} from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import {createHash} from 'node:crypto'
import {buildPackPre} from '../../lib/migrate-pack.js'
import {MemoryEngine} from '../lib/audit-engine.mjs'
import {planCardsPre,planRevisionPre,anchoredPlanPre,archivePlanPre} from '../../lib/plan-store.js'
const root=await mkdtemp(path.join(os.tmpdir(),'dam-plan-cas-'))
const home=process.env.DSH_HOME;process.env.DSH_HOME=root
try {
 const a=new MemoryEngine(),b=new MemoryEngine();for(const e of[a,b]){e.configLoaded=true;e.config.criteriaGate=false;e.config.boardMode='graph'}
 const project=path.join(root,'project'),file=path.join(project,'handoff','PLAN.md')
 const original='# Board\r\n\r\n## Alpha\r\n'+'Stable original Alpha body sufficiently detailed for criteria.\r\n<!--user-->Keep  two spaces\r\n<!--/user-->\r\n\r\n## Beta\r\nStable original Beta body sufficiently detailed for criteria.\r\n'
 const created=await a.writePlanSnapshot(project,original);assert.equal(created.ok,true,created.error)
 const seed=await readFile(file,'utf8');assert.equal(created.revision,createHash('sha256').update(seed).digest('hex'));assert.ok(seed.includes('\r\n'));assert.ok(!seed.replace(/\r\n/g,'').includes('\n'))
 const cards=planCardsPre(seed);assert.equal(cards.length,2);assert.ok(cards.every(c=>c.id))
 const alpha=cards[0].text.replace('original Alpha','updated Alpha'),beta=cards[1].text.replace('original Beta','updated Beta')
 const [ra,rb]=await Promise.all([a.writePlanSnapshot(project,alpha,{cardId:cards[0].id,expectedCardRevision:cards[0].revision}),b.writePlanSnapshot(project,beta,{cardId:cards[1].id,expectedCardRevision:cards[1].revision})]);assert.equal(ra.ok,true,ra.error);assert.equal(rb.ok,true,rb.error)
 const combined=await readFile(file,'utf8');assert.ok(combined.includes('updated Alpha'));assert.ok(combined.includes('updated Beta'));assert.ok(combined.includes('<!--user-->Keep  two spaces\r\n<!--/user-->'))
 const conflict=await b.writePlanSnapshot(project,cards[0].text.replace('original Alpha','stale Alpha'),{cardId:cards[0].id,expectedCardRevision:cards[0].revision});assert.equal(conflict.ok,false);assert.ok(conflict.conflictPath);assert.equal(await readFile(file,'utf8'),combined)
 const persisted=JSON.parse(await readFile(conflict.conflictPath,'utf8'));assert.equal(persisted.current,combined);assert.ok(persisted.proposed.includes('stale Alpha'))
 // The unique archive namespace remains safe beyond the old 26-suffix limit.
 const many=await Promise.all(Array.from({length:30},(_,i)=>archivePlanPre(path.join(root,'archive-stress'),'PLAN-same-second',String(i))))
 assert.equal(new Set(many).size,30)
 for(let i=0;i<many.length;i++)assert.equal(await readFile(many[i],'utf8'),String(i))
 const mixed='# Legacy\r\n## First\r\nbytes stay\n## Second\nother bytes'
 const anchoredMixed=anchoredPlanPre('mixed',mixed)
 assert.equal(anchoredMixed.replace(/<!-- memory:mem_[a-f0-9]{32} -->\r?\n/g,''),mixed)
 const userExample='## Example\n<!--user-->\n### private title\nkeep  user text\n<!--/user-->\nbody'
 assert.ok(anchoredPlanPre('user',userExample).includes('<!--user-->\n### private title\nkeep  user text\n<!--/user-->'))
 const renamed=anchoredPlanPre('renamed',latestPlaceholder())
 function latestPlaceholder(){return cards[0].text.replace('## Alpha','## Renamed Alpha')}
 assert.equal(planCardsPre(renamed)[0].id,cards[0].id)
 const noProof=await a.writePlanSnapshot(project,combined.replace('updated Beta','unsafe Beta'));assert.equal(noProof.ok,false);assert.match(noProof.error,/version-conflict/)
 const latest=planCardsPre(combined)[0]
 const changedUser=await a.writePlanSnapshot(project,latest.text.replace('Keep  two spaces','change user'),{cardId:latest.id,expectedCardRevision:latest.revision});assert.equal(changedUser.ok,false);assert.equal(await readFile(file,'utf8'),combined)
 assert.equal((await b.ensurePlanBoardPre(project)).skipped,'exists');assert.equal(await readFile(file,'utf8'),combined)
 const archives=await readdir(path.join(project,'handoff','archive'));assert.equal(new Set(archives).size,archives.length);assert.equal(archives.length,2)
 const index=JSON.parse(await readFile(path.join(project,'handoff','index.json'),'utf8'));assert.equal(index.sourceRevisions['handoff/PLAN.md'],planRevisionPre(combined))
 a.writeSidecarEntryPre=async()=>{throw new Error('index unavailable')}
 const save=await a.writePlanSnapshot(project,combined.replace('updated Alpha','latest Alpha'),{expectedRevision:planRevisionPre(combined)});assert.equal(save.ok,true);assert.equal(save.indexStale,true);assert.equal(save.committed,true)
 const rebuilt=await b._loadSidecarIndexPre(project)
 assert.equal(rebuilt.sourceRevisions['handoff/PLAN.md'],planRevisionPre(await readFile(file,'utf8')))
 // An IO error is not interpreted as a missing board.
 const bad=path.join(root,'unreadable');await mkdir(path.join(bad,'handoff','PLAN.md'),{recursive:true});assert.equal((await a.writePlanSnapshot(bad,original)).ok,false)
 const invalid=path.join(root,'invalid');await mkdir(path.join(invalid,'handoff'),{recursive:true});const invalidFile=path.join(invalid,'handoff','PLAN.md'),invalidBytes=Buffer.from([255,254,10]);await writeFile(invalidFile,invalidBytes);assert.equal((await a.writePlanSnapshot(invalid,original)).ok,false);assert.deepEqual(await readFile(invalidFile),invalidBytes)
 // External edits invalidate the actual bytes read earlier.
 const current=await readFile(file,'utf8');await writeFile(file,current+'external edit\r\n');const stale=await b.writePlanSnapshot(project,current,{expectedRevision:planRevisionPre(current)});assert.equal(stale.ok,false);assert.match(await readFile(file,'utf8'),/external edit/)
 // A target edit during the real backup must not be overwritten by import.
 const targetWs=path.join(root,'migration-workspace'),targetDir=b.projectDirOf(targetWs),targetPlan=path.join(targetDir,'handoff','PLAN.md')
 await mkdir(path.dirname(targetPlan),{recursive:true});await writeFile(targetPlan,original)
 const pack=buildPackPre({ws:targetWs,files:{'handoff/PLAN.md':original.replace('original Alpha','imported Alpha')},pluginVersion:'3.2.7',now:1}).pack
 b._readPack=async()=>({ok:true,pack})
 const preview=await b.migrateInspect({packPath:'fixture',targetWs,onConflict:'overwrite'})
 assert.equal(preview.ok,true);assert.ok(preview.previewToken)
 const copyDir=b.copyDir.bind(b);b.copyDir=async(...args)=>{await copyDir(...args);await writeFile(targetPlan,original+'changed during backup\r\n')}
 const imported=await b.migrateImport({packPath:'fixture',targetWs,onConflict:'overwrite',previewToken:preview.previewToken})
 assert.equal(imported.ok,false);assert.match(imported.detail,/plan-import-preview-conflict/)
 assert.equal(await readFile(targetPlan,'utf8'),original+'changed during backup\r\n')
 const importConflicts=await readdir(path.join(targetDir,'handoff','conflicts'));assert.equal(importConflicts.length,1)
 const importConflict=JSON.parse(await readFile(path.join(targetDir,'handoff','conflicts',importConflicts[0]),'utf8'));assert.ok(importConflict.current.includes('changed during backup'));assert.ok(importConflict.proposed.includes('imported Alpha'))
 console.log('PASS #164: real production CAS, concurrent different cards, persisted stale conflict, read-before-write, CRLF/user bytes, seeds/archive uniqueness, actual-byte revision/index failure and external edits')
}finally{if(home===undefined)delete process.env.DSH_HOME;else process.env.DSH_HOME=home;await rm(root,{recursive:true,force:true})}
