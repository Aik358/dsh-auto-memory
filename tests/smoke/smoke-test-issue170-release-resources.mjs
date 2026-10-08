import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const root=fileURLToPath(new URL('../..',import.meta.url))
const fixture=mkdtempSync(path.join(tmpdir(),'dam-release-resource-'))
let staging
try {
 for(const dir of ['lib/assets/skin','lib/policies','tests','python','tools'])mkdirSync(path.join(fixture,dir),{recursive:true})
 const samples={'lib/index.js':'export const fixture = true','lib/client.js':'export const fixture = true','lib/client.js.scratch':'must drop','lib/copy.old.js':'must drop','lib/runtime.js':'export const runtime = true','lib/assets/skin/icon.multiple.dots.png':'binary fixture','lib/policies/policy.json':'{"mode":"safe"}','tools/build-iter5-skin.mjs':'// fixture'}
 const debugNames=['GOOD-1533','PRE-GEN-1556','badcss','curtest','headtest','pregen-1522','scratch'].map(n=>'lib/client.js.'+n)
 for(const name of debugNames)samples[name]='must drop'
 for(const [name,body]of Object.entries(samples))writeFileSync(path.join(fixture,name),body)
 writeFileSync(path.join(fixture,'cordis.patch.yml'),'- id: auto-memory\n  package: "@a9i5k4/dsh-auto-memory"\n')
 writeFileSync(path.join(fixture,'CHANGELOG.md'),'## [3.2.7]\n')
 for(const name of ['worker_v1.py','worker_semantic_v1.py','m7_activation_features_v2.py','m7_embedding_v1.py'])writeFileSync(path.join(fixture,'python',name),'# fixture\n')
 for(const name of ['run-smoke.mjs','smoke-impact.mjs','release.mjs'])writeFileSync(path.join(fixture,'tools',name),'// fixture\n')
 writeFileSync(path.join(fixture,'tools/reconcile-upstream.mjs'),'console.log(JSON.stringify({artifacts:[],unregistered:[]}))\n')
 // Exercise the real copy/filter phase with complete mandatory copy inputs.
 // Version metadata is deliberately incomplete; this is not a successful release build.
 const run=spawnSync(process.execPath,[path.join(root,'tools/release.mjs'),'3.2.7','--dry-run'],{env:{...process.env,DSH_AUTO_MEMORY_DEV:fixture},encoding:'utf8'})
 staging=run.stdout.match(/staging 目录: (.+)/)?.[1]?.trim();assert.ok(staging,run.stdout+run.stderr)
 for(const name of ['lib/assets/skin/icon.multiple.dots.png','lib/policies/policy.json','lib/runtime.js'])assert.equal(readFileSync(path.join(staging,name),'utf8'),samples[name])
 for(const name of [...debugNames,'lib/copy.old.js'])assert.equal(existsSync(path.join(staging,name)),false)
 const files=dir=>readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.join(dir,e.name)):[path.join(dir,e.name)])
 assert.equal(files(path.join(root,'lib/assets')).length,82)
 assert.equal(files(path.join(root,'lib/policies')).length,2)
 console.log('PASS #170: 82 assets and 2 policies present; real release copy phase preserves binary/dotted resources and drops debug copies')
} finally {rmSync(fixture,{recursive:true,force:true});if(staging)rmSync(staging,{recursive:true,force:true})}
