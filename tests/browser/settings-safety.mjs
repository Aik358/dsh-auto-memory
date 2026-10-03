// Real Chromium + React, using the shipped client factory and fixture host APIs.
// This is browser UI coverage, not a full DSH host / model / Windows acceptance.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { createServer } from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const require = createRequire(path.join(process.env.DSH_BROWSER_TOOLS || '/tmp/dsh-browser-tools', 'package.json'))
const { chromium } = require('playwright-core')
const reactPath=path.join(path.dirname(require.resolve('react/package.json')),'umd/react.development.js')
const domPath=path.join(path.dirname(require.resolve('react-dom/package.json')),'umd/react-dom.development.js')
let client=readFileSync(path.join(root,'lib/client.js'),'utf8')
// Controlled scheduling seam: keep real React renders/commits, but defer only
// this hook's subscription effect until after the actual request completes.
// This verifies the render-to-subscription gap; it is not natural-scheduler timing.
const operationStart=client.indexOf('    function useMemoryOperation('),operationEnd=client.indexOf('    function submitMemoryOperation(',operationStart)
assert(operationStart>=0 && operationEnd>operationStart)
client=client.slice(0,operationStart)+client.slice(operationStart,operationEnd).replace('useEffect(function(){','operationEffect(function(){')+client.slice(operationEnd)
client=client.replace('return { page: Iter5Page, css: ITER5_CSS }', 'return { page: Iter5Page, css: ITER5_CSS, Settings: Iter5Settings, Note: Iter5Note, Calendar: Iter5Calendar }')
client=client.replace('    return module.exports', `    var fixtureSession='fixture-session';sessions={list:{getSnapshot:function(){return {current:fixtureSession,byId:{[fixtureSession]:{cwd:'/fixture/project',retainedBy:{mainView:1}}}}}}}
    window.dshTest={setSession:function(sid){fixtureSession=sid;emit()},Panel:MemoryPanel,broadcast:emit,Settings:Iter5Settings,LegacySettings:LEGACY_SKIN_NS.Settings,ClassicSettings:SettingsPage,Note:Iter5Note,LegacyNote:LEGACY_SKIN_NS.Note,ClassicNote:NotesTab,Calendar:Iter5Calendar,LegacyCalendar:LEGACY_SKIN_NS.Calendar,ClassicCalendar:CalendarTab,External:Iter5External,ClassicExternal:ConnectTab,controller:controller,locale:applyLocalePref,t:t,styles:CSS+'\\n'+ITER5_CSS,legacyStyles:LEGACY_ITER5_CSS}
    return module.exports`)
// Detect symbol names rather than silently omitting a surface.
assert(client.includes('function Iter5External('))
const html=`<!doctype html><meta charset="utf-8"><div id="root"></div><script src="/react.js"></script><script src="/react-dom.js"></script><script>window.__ModuleLoader__={load:function(item){item.factory(function(name){if(name==='react')return React;if(name==='react-dom')return ReactDOM;return {}})}};</script><script src="/client.js"></script><script>
let uiRoot=ReactDOM.createRoot(document.getElementById('root')),fixtureNonce=0;
window.deferOperationSubscription=false;window.pendingOperationSubscriptions=[];
window.operationEffect=function(effect,deps){React.useEffect(function(){
 if(!window.deferOperationSubscription)return effect();
 let ticket={effect:effect,cleanup:null};pendingOperationSubscriptions.push(ticket);
 return function(){pendingOperationSubscriptions=pendingOperationSubscriptions.filter(x=>x!==ticket);if(ticket.cleanup)ticket.cleanup()};
},deps)};
window.flushOperationSubscriptions=function(){deferOperationSubscription=false;let tickets=pendingOperationSubscriptions.slice();pendingOperationSubscriptions=[];tickets.forEach(ticket=>{ticket.cleanup=ticket.effect()})};
window.mount=function(name,options){let Component=dshTest[name];uiRoot.render(React.createElement('div',{'data-iter5':'','data-i5-style':'instrument','data-deep':'false',style:{height:'100vh'}},React.createElement('style',null,dshTest.styles),React.createElement('main',{className:'i5-main'},React.createElement(Component,Object.assign({key:name+'-'+fixtureNonce,source:'/fixture/notes/MEMORY.md',nonce:fixtureNonce,onNav:function(){},onExit:function(){}},options||{})))))};
window.remount=function(name,options){fixtureNonce++;mount(name,options)};
</script>`
const server=createServer((req,res)=>{
  res.setHeader('Content-Type',req.url.endsWith('.js')?'text/javascript':'text/html')
  res.end(req.url==='/react.js'?readFileSync(reactPath):req.url==='/react-dom.js'?readFileSync(domPath):req.url==='/client.js'?client:html)
})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
const url='http://127.0.0.1:'+server.address().port
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium',headless:true,args:['--no-sandbox']})
const artifacts=path.join(root,'artifacts/ui-settings-20261003');mkdirSync(artifacts,{recursive:true})
const evidence=[], pageErrors=[]
let config={boardMode:'graph',semanticEngineMode:'auto',associativeMemoryEnabled:true,activationInboxEnabled:true,jsDecideCandidateScheme:'balanced',jsDecideExcerptChars:75,dayBoundaryMinutes:450,workbenchLoopShort:10,workbenchLoopLong:24,memoryRoot:'/fixture/notes',userMemoryDir:'/fixture/user',teamEnabled:true,teamSyncTransport:'s3',teamSecretAccessKey:'fixture-secret-never-persist',autoSummaryTimes:[],injectExcludeSources:[],waterLevelThresholdMode:'auto'}
let mode='shadow',failConfig=false,holdNote=null,holdCalendar=null,browseResolvers=[],recallResolvers=[],configResolvers=[],holdConfig=false,semanticResolvers=[],holdSemantic=false,noteWrites=0,calendarWrites=0,holdHandoff=false,handoffResolvers=[]
let water={live:true,window:1000000,threshold:.67,thresholdMode:'auto'}
const page=await browser.newPage({viewport:{width:1280,height:900}})
page.on('pageerror',e=>pageErrors.push(e.message))
await page.route('**/api/dsh-auto-memory/**',async route=>{
 const request=route.request(),pathname=new URL(request.url()).pathname.split('/').pop(),body=request.postDataJSON()
 const respond=(json,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(json)})
 if(pathname==='config'){
  if(request.method()==='GET'){
   const snapshot=structuredClone(config)
   if(holdConfig){configResolvers.push(()=>respond({config:snapshot,promptSections:[],promptSectionMust:[]}));return}
   return respond({config:snapshot,promptSections:[],promptSectionMust:[]})
  }
  if(failConfig)return respond({error:'injected save failure: memoryRoot',fields:{memoryRoot:'invalid directory'}},400)
  config={...config,...body};return respond({config:structuredClone(config)})
 }
 if(pathname==='semantic-status'){
  const snapshot={activationEmitMode:mode,resolvedTier:'c1',download:{phase:'idle'}}
  if(holdSemantic){semanticResolvers.push(()=>respond(snapshot));return}
  return respond(snapshot)
 }
 if(pathname==='semantic-emit'){mode=body.mode;return respond({ok:true,mode})}
 if(pathname==='handoff-state'){
  const snapshot={enabled:true,waterLevel:structuredClone(water),ledgers:[]}
  if(holdHandoff){handoffResolvers.push(()=>respond(snapshot));return}
  return respond(snapshot)
 }
 if(pathname==='state')return respond({ws:'/fixture/project',notesPath:'/fixture/notes/MEMORY.md',userDir:'/fixture/user'})
 if(pathname==='note'){noteWrites++;if(holdNote){const holder=holdNote;holdNote=null;holder.resolve=(fail=false)=>respond(fail?{error:'injected pending note failure'}:{result:'appended'},fail?500:200);return}return respond({result:'appended'})}
 if(pathname==='calendar'){
  if(request.method()==='POST'){
   calendarWrites++
   if(holdCalendar){const holder=holdCalendar;holdCalendar=null;holder.resolve=(fail=false)=>respond(fail?{error:'injected pending calendar failure'}:{result:'calendar appended',ok:true},fail?500:200);return}
  }
  return respond({entries:[],ok:true})
 }
 if(pathname==='models')return respond({providers:[{id:'p1',name:'Provider 1',models:[{id:'shared-model'}]},{id:'p2',name:'Provider 2',models:[{id:'shared-model'}]}]})
 if(pathname==='pick-dir')return respond({native:false})
 if(pathname==='browse-dir'){const id=browseResolvers.length+1;browseResolvers.push(()=>respond({path:body.path,parent:'/fixture',dirs:[{name:'response-'+id,path:body.path+'/response-'+id}]}));return}
 if(pathname==='external')return respond({sources:[{id:'A',name:'Source A',tool:'fixture',kind:'memory'},{id:'B',name:'Source B',tool:'fixture',kind:'memory'}]})
 if(pathname==='external-view')return respond({content:'fixture source',path:'/fixture/external'})
 if(pathname==='recall'){recallResolvers.push(()=>respond({result:'result for '+body.query}));return}
 return respond({})
})
async function mounted(name,options={}){await page.evaluate(([name,options])=>window.remount(name,options),[name,options]);await page.waitForTimeout(80)}
async function tab(group){await page.locator('[role=tab][id$="-tab-'+group+'"]').first().click()}
const field=key=>page.locator('[data-i5-field]').filter({has:page.locator('label')}).filter({hasText:key})
const row=key=>page.locator('[data-i5-field]').filter({hasText:key}).first()
const save=()=>page.locator('[data-dam-savebar] button[data-dirty]').first().click()
page.setDefaultTimeout(8000)
try{
 await page.goto(url);await page.waitForFunction(()=>window.dshTest)
 await page.evaluate(()=>dshTest.locale('en'))
 await mounted('Settings')
 assert.equal(await page.getByRole('tab').count(),4)
 await tab('memory')
 const exclude=row('Memory sources AI should not use').locator('textarea')
 await exclude.fill('source-A\n\n');assert.equal(await exclude.inputValue(),'source-A\n\n')
 await tab('behavior')
 const times=page.locator('[data-i5-field]').filter({hasText:'Auto summary times'}).locator('input')
 await times.fill('12:00,');assert.equal(await times.inputValue(),'12:00,')
 failConfig=true;await save();await page.getByText('injected save failure: memoryRoot',{exact:true}).waitFor()
 assert.equal(await times.inputValue(),'12:00,')
 await mounted('Settings');await tab('behavior');assert.equal(await times.inputValue(),'12:00,')
 failConfig=false;await times.fill('12:00,18:00');await save()
 await page.waitForFunction(()=>!document.querySelector('[data-i5-dirty=true]'))
 assert.deepEqual(config.autoSummaryTimes,['12:00','18:00']);assert.deepEqual(config.injectExcludeSources,['source-A'])
 await times.fill('');await save();await page.waitForTimeout(80);assert.deepEqual(config.autoSummaryTimes,[])
 evidence.push('PASS raw newline/comma editing, failure retention, remount recovery, normalized save, empty-array off')
 // Model identity compares provider as well as model ID.
 await page.getByRole('button',{name:'Pick model / effort',exact:true}).click()
 await page.getByRole('button',{name:'shared-model',exact:true}).first().click()
 await page.getByRole('button',{name:'Pick model / effort',exact:true}).click()
 const modelButtons=page.locator('[data-native-model-picker] button').filter({hasText:'shared-model'})
 assert.equal(await modelButtons.filter({hasText:'✓'}).count(),1)
 assert.equal(await modelButtons.nth(0).getAttribute('aria-pressed'),'true')
 assert.equal(await modelButtons.nth(1).getAttribute('aria-pressed'),'false')
 await page.keyboard.press('Escape');assert.equal(await page.locator('.i5-dialog').count(),0)
 const secret=page.locator('input[data-dam-key=teamSecretAccessKey]')
 assert.equal(await secret.getAttribute('type'),'password')
 await page.getByRole('button',{name:'Show secret',exact:true}).click();assert.equal(await secret.getAttribute('type'),'text')
 await page.getByRole('button',{name:'Hide secret',exact:true}).click()
 assert.equal(await page.evaluate(()=>JSON.stringify(localStorage).includes('fixture-secret-never-persist')),false)
 const transport=page.locator('select[data-dam-key=teamSyncTransport]')
 assert.equal(await transport.locator('option[value=folder]').isDisabled(),true)
 assert.equal(await transport.locator('option[value=http]').isDisabled(),true)
 config.teamSyncTransport='http';await mounted('Settings');await tab('behavior');assert.equal(await secret.count(),0);assert.equal(await transport.inputValue(),'http')
 config.teamSyncTransport='s3';await mounted('Settings');await tab('behavior')
 evidence.push('PASS provider+model identity, modal Escape/focus, secret masking/visibility/no localStorage, unsupported folder unavailable, transport-specific fields')
 // Native fallback and browse close/reopen: obsolete path must not win.
 await tab('appearance')
 await page.locator('[data-i5-field]').filter({hasText:'Where workspace memories are stored'}).getByRole('button').click()
 await page.waitForFunction(()=>document.querySelector('[data-native-path-browser]'))
 await page.waitForTimeout(30);assert.equal(browseResolvers.length,1)
 await page.keyboard.press('Escape')
 await page.locator('[data-i5-field]').filter({hasText:'Where workspace memories are stored'}).getByRole('button').click();await page.waitForTimeout(40)
 assert.equal(browseResolvers.length,2)
 await browseResolvers[1]();await page.waitForTimeout(30)
 await browseResolvers[0]();await page.waitForTimeout(30)
 assert.equal(await page.locator('[data-native-path-browser]').count(),1)
 assert.equal(await page.getByRole('button',{name:/response-2/}).count(),1);assert.equal(await page.getByRole('button',{name:/response-1/}).count(),0)
 await page.screenshot({path:path.join(artifacts,'directory-picker-en.png')})
 await page.keyboard.press('Escape')
 evidence.push('PASS directory picker close/reopen generations reject late obsolete response')
 // Real React unmounts and asynchronous note completion, with continued editing.
 await mounted('ClassicNote');const classicNote=page.locator('textarea')
 await classicNote.fill('A submitted note');const pending={};holdNote=pending
 await page.getByRole('button',{name:'Append',exact:true}).evaluate(el=>{el.click();el.click()});await page.waitForTimeout(30);assert.equal(noteWrites,1,'duplicate click only sends one note request')
 await classicNote.fill('B newer draft');await pending.resolve();await page.waitForTimeout(50)
 assert.equal(await classicNote.inputValue(),'B newer draft')
 await mounted('Note');assert.equal(await page.locator('textarea').inputValue(),'B newer draft')
 await mounted('LegacyNote');assert.equal(await page.locator('textarea').inputValue(),'B newer draft')
 await mounted('ClassicNote');assert.equal(await page.locator('textarea').inputValue(),'B newer draft')
 evidence.push('PASS actual React: saving A then typing B preserves B; classic/new/frozen note remount recovery')
 // Mount the shipped floating panel: page switches and close/reopen keep the note.
 await page.evaluate(()=>{dshTest.controller.setPanelPos('bottom-left');dshTest.controller.setPanelTab('notes');dshTest.controller.open()});await mounted('Panel')
 assert.equal(await page.locator('[data-dam-panel] textarea').inputValue(),'B newer draft')
 await page.evaluate(()=>dshTest.controller.setPanelTab('calendar'));await page.waitForTimeout(40)
 await page.evaluate(()=>dshTest.controller.setPanelTab('notes'));await page.waitForTimeout(40)
 assert.equal(await page.locator('[data-dam-panel] textarea').inputValue(),'B newer draft')
 page.once('dialog',d=>d.dismiss());await page.locator('[data-dam-panel] header button').last().click();assert.equal(await page.locator('[data-dam-panel]').count(),1)
 page.once('dialog',d=>d.accept());await page.locator('[data-dam-panel] header button').last().click();await page.waitForTimeout(200);assert.equal(await page.locator('[data-dam-panel]').count(),0)
 await page.evaluate(()=>dshTest.controller.open());await page.waitForTimeout(60);assert.equal(await page.locator('[data-dam-panel] textarea').inputValue(),'B newer draft')
 await page.evaluate(()=>dshTest.setSession('second-session'));await page.waitForTimeout(60);assert.equal(await page.locator('[data-dam-panel] textarea').inputValue(),'')
 await page.locator('[data-dam-panel] textarea').fill('second session draft')
 await page.evaluate(()=>dshTest.setSession('fixture-session'));await page.waitForTimeout(60);assert.equal(await page.locator('[data-dam-panel] textarea').inputValue(),'B newer draft')
 evidence.push('PASS shipped floating panel: page/identity switches, close confirmation, accepted close and reopen restore scoped drafts')
 // An explicit note Cancel discards its shared draft, after confirmation.
 await page.evaluate(()=>window.remount('Note',{source:'/fixture/notes/MEMORY.md',onClose:function(){window.noteClosed=true}}));await page.waitForTimeout(60)
 page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Cancel',exact:true}).click();assert.equal(await page.evaluate(()=>window.noteClosed),true)
 await mounted('ClassicNote');assert.equal(await page.locator('textarea').inputValue(),'')
 evidence.push('PASS explicit note Cancel clears its confirmed shared draft')
 // Calendar: a location-only draft counts; Escape denial and accepted discard.
 await mounted('Calendar');await page.getByRole('button',{name:/Add event/}).click()
 await page.getByLabel('Location',{exact:true}).fill('location-only draft')
 page.once('dialog',d=>d.dismiss());await page.keyboard.press('Escape');assert.equal(await page.locator('.i5-dialog').count(),1)
 await mounted('LegacyCalendar');assert.equal(await page.getByLabel('Location',{exact:true}).inputValue(),'location-only draft')
 page.once('dialog',d=>d.accept());await page.keyboard.press('Escape');assert.equal(await page.locator('.i5-dialog').count(),0)
 await mounted('ClassicCalendar');await page.getByRole('button',{name:'+ Add',exact:true}).click()
 await page.getByPlaceholder('Location (optional)').fill('classic location')
 page.once('dialog',d=>d.dismiss());await page.getByRole('button',{name:'Cancel',exact:true}).click();assert.equal(await page.getByPlaceholder('Location (optional)').inputValue(),'classic location')
 await mounted('Calendar');assert.equal(await page.getByLabel('Location',{exact:true}).inputValue(),'classic location')
 page.once('dialog',d=>d.accept());await page.keyboard.press('Escape')
 evidence.push('PASS calendar location-only protection: Escape/Cancel, classic/new/frozen draft recovery and explicit discard')
 // External lookups switch A -> B while A is pending. Late A cannot render in B.
 await mounted('External');await page.getByRole('button',{name:'Find in memory',exact:true}).click();await page.waitForTimeout(30)
 await page.locator('.i5-external-select').filter({hasText:'Source B'}).click();await page.waitForTimeout(30)
 await page.getByRole('button',{name:'Find in memory',exact:true}).click();await page.waitForTimeout(30)
 assert.equal(recallResolvers.length,2)
 await recallResolvers[1]();await page.waitForTimeout(30);await recallResolvers[0]();await page.waitForTimeout(30)
 assert(await page.getByText('result for Source B',{exact:true}).count())
 assert.equal(await page.getByText('result for Source A',{exact:true}).count(),0)
 evidence.push('PASS external lookup out-of-order completion, source selection identity')
 // Real browser request disorder on one settings instance: new response wins.
 await mounted('Settings');holdConfig=true;holdSemantic=true
 config.dayBoundaryMinutes=701;mode='shadow';await page.evaluate(()=>dshTest.broadcast());await page.waitForTimeout(40)
 config.dayBoundaryMinutes=702;mode='active';await page.evaluate(()=>dshTest.broadcast());await page.waitForTimeout(40)
 assert.equal(configResolvers.length,2);assert.equal(semanticResolvers.length,2)
 await configResolvers[1]();await semanticResolvers[1]();await page.waitForTimeout(30)
 await configResolvers[0]();await semanticResolvers[0]();await page.waitForTimeout(30)
 assert.equal(await page.locator('[data-i5-field]').filter({hasText:'How to use matches'}).locator('select').inputValue(),'active')
 await tab('behavior');assert.equal(await page.locator('[data-i5-field='+JSON.stringify(await page.evaluate(()=>dshTest.t('fDayBoundary')))+'] input').inputValue(),'702')
 holdConfig=false;holdSemantic=false;mode='shadow'
 evidence.push('PASS actual React settings and semantic GET disorder: older snapshots cannot replace newer state')
 // Both mounted settings instances receive semantic-emit broadcasts.
 await page.evaluate(()=>{fixtureNonce++;uiRoot.render(React.createElement('div',{'data-iter5':'','data-i5-style':'instrument','data-deep':'false'},React.createElement('style',null,dshTest.styles),React.createElement('main',{className:'i5-main'},React.createElement(dshTest.Settings,{key:'one',draftScope:'one'}),React.createElement(dshTest.Settings,{key:'two',draftScope:'two'}))))})
 await page.waitForTimeout(100)
 const emitSelects=page.locator('[data-i5-field]').filter({hasText:'How to use matches'}).locator('select')
 assert.equal(await emitSelects.count(),2);await emitSelects.nth(0).selectOption('active');await page.waitForTimeout(100)
 assert.equal(await emitSelects.nth(1).inputValue(),'active')
 evidence.push('PASS semantic state synchronizes across simultaneous settings instances')
 // Resolve AFTER a new instance mounts, for all note/calendar implementations.
 // Each surface covers success/failure with the submitted A and continued B.
 for(const destination of ['ClassicNote','Note','LegacyNote']){
  for(const fail of [false,true])for(const newer of [false,true]){
   await mounted('ClassicNote');const a='pending A '+destination+' '+fail+' '+newer,b='new B '+a
   await page.locator('textarea').fill(a);const holder={};holdNote=holder;const before=noteWrites
   await page.getByRole('button',{name:'Append',exact:true}).click();await page.waitForTimeout(30)
   assert.equal(noteWrites,before+1)
   await mounted(destination);assert.equal(await page.locator('textarea').inputValue(),a)
   assert(await page.getByRole('button',{name:/Saving/}).isDisabled())
   if(newer)await page.locator('textarea').fill(b)
   await holder.resolve(fail);await page.waitForTimeout(50)
   assert.equal(await page.locator('textarea').inputValue(),newer?b:fail?a:'')
   if(fail)assert(await page.getByText('injected pending note failure',{exact:true}).count())
   else assert(await page.getByRole('status').filter({hasText:'appended'}).count())
   assert.equal(noteWrites,before+1,'remount cannot resubmit the pending note')
  }
 }
 evidence.push('PASS pending note remount matrix: classic/new/frozen × success/failure × unchanged A/new B; status and outcome synchronized')
 for(const destination of ['ClassicCalendar','Calendar','LegacyCalendar']){
  for(const fail of [false,true])for(const newer of [false,true]){
   await mounted('Calendar');if(!await page.locator('.i5-calendar-form').count())await page.getByRole('button',{name:/Add event/}).click()
   const a='pending calendar A '+destination+' '+fail+' '+newer,b='new B '+a
   await page.getByLabel('Title',{exact:true}).fill(a);const holder={};holdCalendar=holder;const before=calendarWrites
   await page.locator('.i5-calendar-form button[type=submit]').click();await page.waitForTimeout(30)
   await mounted(destination)
   const title=destination==='ClassicCalendar'?page.getByPlaceholder('Item title…'):page.getByLabel('Title',{exact:true})
   assert.equal(await title.inputValue(),a);assert(await page.getByRole('button',{name:/Saving/}).isDisabled())
   if(newer)await title.fill(b)
   await holder.resolve(fail);await page.waitForTimeout(50)
   if(newer || fail)assert.equal(await title.inputValue(),newer?b:a)
   else assert.equal(await title.count(),0,'saved A dialog closes in the new instance')
   if(fail)assert(await page.getByText('injected pending calendar failure',{exact:true}).count())
   else assert(await page.getByText('calendar appended',{exact:true}).count())
   assert.equal(calendarWrites,before+1,'remount cannot resubmit the pending calendar event')
  }
 }
 evidence.push('PASS pending calendar remount matrix: classic/new/frozen × success/failure × unchanged A/new B; status and outcome synchronized')
 // Request completes after the new instance renders/commits but before its
 // controlled subscription effect runs. Keep initial replay for old saved ops.
 for(const kind of ['note','calendar'])for(const destination of kind==='note'?['ClassicNote','Note','LegacyNote']:['ClassicCalendar','Calendar','LegacyCalendar']){
  for(const fail of [false,true])for(const newer of [false,true]){
   const a='effect gap A '+kind+' '+destination+' '+fail+' '+newer,b='new B '+a,holder={}
   if(kind==='note'){
    await mounted('ClassicNote');await page.locator('textarea').fill(a);holdNote=holder
    await page.getByRole('button',{name:'Append',exact:true}).click()
   }else{
    await mounted('Calendar');if(!await page.locator('.i5-calendar-form').count())await page.getByRole('button',{name:/Add event/}).click()
    await page.getByLabel('Title',{exact:true}).fill(a);holdCalendar=holder
    await page.locator('.i5-calendar-form button[type=submit]').click()
   }
   await page.waitForTimeout(30)
   await page.evaluate(()=>{deferOperationSubscription=true});await mounted(destination)
   const editor=kind==='note'?page.locator('textarea'):destination==='ClassicCalendar'?page.getByPlaceholder('Item title…'):page.getByLabel('Title',{exact:true})
   assert.equal(await editor.inputValue(),a)
   assert.equal(await page.evaluate(()=>pendingOperationSubscriptions.length),1)
   if(newer)await editor.fill(b)
   await holder.resolve(fail);await page.waitForTimeout(40)
   assert.equal(await editor.inputValue(),newer?b:a,'controlled effect has not subscribed yet')
   await page.evaluate(()=>flushOperationSubscriptions());await page.waitForTimeout(40)
   if(kind==='calendar' && !newer && !fail)assert.equal(await editor.count(),0)
   else assert.equal(await editor.inputValue(),newer?b:fail?a:'')
   assert(await page.getByText(fail?'injected pending '+kind+' failure':kind==='note'?'appended':'calendar appended',{exact:true}).count())
   // A new draft equal to an older saved submission is a distinct edit. A saved
   // operation already present at render must not clear it during initial replay.
   if(kind==='note' && !fail){
    await editor.fill(a);await mounted(destination);assert.equal(await page.locator('textarea').inputValue(),a)
   }
  }
 }
 evidence.push('PASS controlled React render/commit-to-subscription gap: note/calendar × three implementations × success/failure × A/B; old completed operation replay preserves new same-text note')
 // Water display ordering and identity for each shipped settings implementation.
 for(const surface of ['Settings','LegacySettings','ClassicSettings']){
  await mounted(surface);if(surface!=='ClassicSettings')await tab('behavior')
  const readout=page.locator('[data-dam-effective-water]').first()
  assert(await readout.count(),'effective readout exists in '+surface)
  holdHandoff=true;handoffResolvers=[]
  water={live:true,window:110,threshold:.61,thresholdMode:'fixed'};await page.evaluate(()=>dshTest.broadcast());await page.waitForTimeout(40)
  water={live:true,window:220,threshold:.72,thresholdMode:'auto'};await page.evaluate(()=>dshTest.broadcast());await page.waitForTimeout(40)
  assert.equal(handoffResolvers.length,2)
  await handoffResolvers[1]();await page.waitForTimeout(30);await handoffResolvers[0]();await page.waitForTimeout(30)
  assert((await readout.textContent()).includes('72%'));assert((await readout.textContent()).includes('220'))
  water={live:true,window:330,threshold:.83,thresholdMode:'fixed'};await page.evaluate(()=>dshTest.broadcast());await page.waitForTimeout(40)
  water={live:true,window:440,threshold:.94,thresholdMode:'auto'};await page.evaluate(()=>dshTest.setSession('water-session'));await page.waitForTimeout(40)
  assert.equal(handoffResolvers.length,4)
  assert(!(await readout.textContent()).includes('220'),'previous session value clears immediately')
  await handoffResolvers[2]();await page.waitForTimeout(30);assert(!(await readout.textContent()).includes('330'))
  await handoffResolvers[3]();await page.waitForTimeout(30);assert((await readout.textContent()).includes('94%'))
  holdHandoff=false;await page.evaluate(()=>dshTest.setSession('fixture-session'));await page.waitForTimeout(40)
 }
 evidence.push('PASS current/frozen/classic settings: handoff-state request disorder, changed session clears prior value and rejects old-session response')
 for(const language of ['zh','en','ja']){
  await page.evaluate(language=>dshTest.locale(language),language);await mounted('Settings')
  for(const group of ['engine','memory','appearance','behavior']){await tab(group);assert.equal(await page.getByRole('tab',{selected:true}).count(),1)}
  await page.setViewportSize({width:390,height:844});await tab('appearance');await page.screenshot({path:path.join(artifacts,'settings-'+language+'-390.png')})
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth+2)
  assert.equal(overflow,false,'no page horizontal overflow for '+language)
  await page.keyboard.press('Tab');assert(await page.evaluate(()=>document.activeElement!==document.body))
  await page.setViewportSize({width:1280,height:900});await page.screenshot({path:path.join(artifacts,'settings-'+language+'-1280.png')})
  evidence.push('PASS '+language+': current Settings four-tab navigation; appearance at 390/1280, Tab moves focus, no appearance page horizontal overflow (not full keyboard/all-page layout acceptance)')
 }
 assert.deepEqual(pageErrors,[],'no browser exceptions')
 writeFileSync(path.join(artifacts,'browser-results.json'),JSON.stringify({environment:'Chromium + React 18; fixture host APIs',browser:browser.version(),evidence,noteWrites,pageErrors},null,2)+'\n')
 console.log(evidence.join('\n'))
} catch(e) { console.log(evidence.join('\n'));await page.screenshot({path:path.join(artifacts,'failure.png')});console.log('Browser errors:',JSON.stringify(pageErrors));throw e } finally { await browser.close();await new Promise(resolve=>server.close(resolve)) }
