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
client=client.replace('    return module.exports', `    var fixtureSession='fixture-session',fixtureWorkspace='/fixture/project';sessions={list:{getSnapshot:function(){return {current:fixtureSession,byId:{[fixtureSession]:{cwd:fixtureWorkspace,retainedBy:{mainView:1}}}}}}}
    window.dshTest={setSession:function(sid){fixtureSession=sid;emit()},setWorkspace:function(ws){fixtureWorkspace=ws;emit()},Panel:MemoryPanel,broadcast:emit,Schema:ITER5_SETTINGS_SCHEMA,Surface:Iter5Surface,Workbench:MemoryPageView,HostSettings:Iter5HostSettings,Page:Iter5Page,LegacyPage:Legacy5Page,ClassicPage:MemoryPageView,Settings:Iter5Settings,LegacySettings:LEGACY_SKIN_NS.Settings,ClassicSettings:SettingsPage,Note:Iter5Note,LegacyNote:LEGACY_SKIN_NS.Note,ClassicNote:NotesTab,Calendar:Iter5Calendar,LegacyCalendar:LEGACY_SKIN_NS.Calendar,ClassicCalendar:CalendarTab,External:Iter5External,ClassicExternal:ConnectTab,controller:controller,locale:applyLocalePref,t:t,copy:iter5SettingCopy,baseStyles:CSS,skin:function(value){iter5SetStyle(value==='classic'?'legacy':value);damSkinSet(value==='classic'?'classic':'v4');damSkinEnsureCss();emit()}}
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
window.mount=function(name,options){let Component=dshTest[name];uiRoot.render(React.createElement(dshTest.Surface,{kind:'page'},React.createElement('div',{'data-iter5':'','data-deep':'false',style:{height:'100vh'}},React.createElement('style',{'data-fixture-base-css':''},dshTest.baseStyles),React.createElement('main',{className:'i5-main'},React.createElement(Component,Object.assign({key:name+'-'+fixtureNonce,source:'/fixture/notes/MEMORY.md',nonce:fixtureNonce,onNav:function(){},onExit:function(){}},options||{}))))))};
window.remount=function(name,options){fixtureNonce++;mount(name,options)};
window.settingsPair=function(){fixtureNonce++;uiRoot.render(React.createElement(dshTest.Surface,{kind:'page'},React.createElement('style',{'data-fixture-base-css':''},dshTest.baseStyles),React.createElement('div',{'data-fixture-host':''},React.createElement(dshTest.HostSettings,{key:'host-'+fixtureNonce})),React.createElement('div',{'data-fixture-workbench':''},React.createElement(dshTest.ClassicSettings,{key:'workbench-'+fixtureNonce}))))};
</script>`
const server=createServer((req,res)=>{
  res.setHeader('Content-Type',req.url.endsWith('.js')?'text/javascript':'text/html')
  res.end(req.url==='/react.js'?readFileSync(reactPath):req.url==='/react-dom.js'?readFileSync(domPath):req.url==='/client.js'?client:html)
})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
const url='http://127.0.0.1:'+server.address().port
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium',headless:true,args:['--no-sandbox']})
const artifacts=path.join(root,'artifacts/ui-v3-20261003');mkdirSync(artifacts,{recursive:true})
const evidence=[], pageErrors=[]
let config={boardMode:'graph',semanticEngineMode:'auto',associativeMemoryEnabled:true,activationInboxEnabled:true,injectEnabled:true,injectBudgetChars:8000,jsDecideCandidateScheme:'balanced',jsDecideExcerptChars:75,dayBoundaryMinutes:450,workbenchLoopShort:10,workbenchLoopLong:24,memoryRoot:'/fixture/notes',userMemoryDir:'/fixture/user',teamEnabled:true,teamSyncTransport:'s3',teamSecretAccessKey:'fixture-secret-never-persist',autoSummaryTimes:[],injectExcludeSources:[],waterLevelThresholdMode:'auto'}
let mode='shadow',failConfig=false,holdNote=null,holdCalendar=null,browseResolvers=[],recallResolvers=[],configResolvers=[],holdConfig=false,configSaveResolvers=[],holdConfigSave=false,semanticResolvers=[],holdSemantic=false,noteWrites=0,calendarWrites=0,holdHandoff=false,handoffResolvers=[]
let water={live:true,window:1000000,threshold:.67,thresholdMode:'auto'}
const indexSource=readFileSync(path.join(root,'lib/index.js'),'utf8')
const promptSections=[...indexSource.match(/PROMPT_SECTION_KEYS_PRE_V1 = Object.freeze\(\[([\s\S]*?)\]\)/)[1].matchAll(/^\s*'([^']+)'/gm)].map(m=>m[1])
const promptMust=[...indexSource.match(/PROMPT_SECTION_MUST_PRE_V1 = Object.freeze\(\[([\s\S]*?)\]\)/)[1].matchAll(/^\s*'([^']+)'/gm)].map(m=>m[1])
const page=await browser.newPage({viewport:{width:1280,height:900}})
page.on('pageerror',e=>pageErrors.push(e.message))
await page.route('**/api/dsh-auto-memory/**',async route=>{
 const request=route.request(),pathname=new URL(request.url()).pathname.split('/').pop(),body=request.postDataJSON()
 const respond=(json,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(json)})
 if(pathname==='config'){
  if(request.method()==='GET'){
   const snapshot=structuredClone(config)
   if(holdConfig){const resume=()=>respond({config:snapshot,promptSections,promptSectionMust:promptMust});resume.dailyMax=snapshot.autoConsolidateDailyMax;configResolvers.push(resume);return}
   return respond({config:snapshot,promptSections,promptSectionMust:promptMust})
  }
  if(failConfig)return respond({error:'injected save failure: memoryRoot',fields:{memoryRoot:'invalid directory'}},400)
  if(holdConfigSave){const snapshot={...config,...body};configSaveResolvers.push(fail=>respond(fail?{error:'injected identity-save failure'}:{config:snapshot},fail?500:200));return}
  config={...config,...body};return respond({config:structuredClone(config)})
 }
 if(pathname==='semantic-status'){
  const snapshot={ready:false,pythonInt8Present:false,activationEmitMode:mode,resolvedTier:'c1',download:{phase:'idle'}}
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
async function mounted(name,options={}){await page.evaluate(([name,options])=>{dshTest.skin(name.startsWith('Classic')?'classic':name.startsWith('Legacy')?'legacy':'instrument');window.remount(name,options)},[name,options]);await page.waitForTimeout(80);if(name.includes('Settings'))await page.locator('[data-settings-v3]').waitFor()}
async function tab(group){group=({engine:'find',memory:'find',behavior:'continuity'})[group]||group;const mobile=page.locator('.i5-settings-mobile select').first();if(await mobile.isVisible())await mobile.selectOption(group);else await page.locator('[role=tab][id$="-tab-'+group+'"]').first().click();await page.locator('.i5-settings-advanced').evaluateAll(nodes=>nodes.forEach(n=>n.open=true))}
const field=key=>page.locator('[data-i5-field]').filter({has:page.locator('label')}).filter({hasText:key})
const row=key=>page.locator('[data-i5-field]').filter({hasText:key}).first()
const save=()=>page.locator('[data-dam-savebar] button[data-dirty]').first().click()
page.setDefaultTimeout(8000)
try{
 await page.goto(url);await page.waitForFunction(()=>window.dshTest)
 await page.evaluate(()=>dshTest.locale('en'))
 await mounted('Settings')
 assert.equal(await page.getByRole('tab').count(),7)
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
 await tab('advanced')
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
 config.teamSyncTransport='http';await mounted('Settings');await tab('advanced');assert.equal(await secret.count(),0);assert.equal(await transport.inputValue(),'http')
 config.teamSyncTransport='s3';await mounted('Settings');await tab('advanced')
 evidence.push('PASS provider+model identity, modal Escape/focus, secret masking/visibility/no localStorage, unsupported folder unavailable, transport-specific fields')
 // Native fallback and browse close/reopen: obsolete path must not win.
 await tab('maintenance')
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
 await tab('find');assert.equal(await page.locator('[data-i5-field]').filter({hasText:'How to use matches'}).locator('select').inputValue(),'active')
 await tab('record');assert.equal(await page.locator('[data-i5-field='+JSON.stringify(await page.evaluate(()=>dshTest.t('fDayBoundary')))+'] input').inputValue(),'702')
 holdConfig=false;holdSemantic=false;mode='shadow'
 evidence.push('PASS actual React settings and semantic GET disorder: older snapshots cannot replace newer state')
 // Both mounted settings instances receive semantic-emit broadcasts.
 await page.evaluate(()=>{fixtureNonce++;uiRoot.render(React.createElement('div',{'data-iter5':'','data-i5-style':'instrument','data-deep':'false'},React.createElement('style',null,dshTest.styles),React.createElement('main',{className:'i5-main'},React.createElement(dshTest.Settings,{key:'one',draftScope:'one'}),React.createElement(dshTest.Settings,{key:'two',draftScope:'two'}))))})
 await page.waitForTimeout(100)
 await page.locator('[role=tab][id$="-tab-find"]').evaluateAll(nodes=>nodes.forEach(n=>n.click()));await page.waitForTimeout(30)
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
  await mounted(surface);await tab('continuity')
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
  // Shared classic/frozen settings now remount immediately for identity changes;
  // their new effect issues one additional read. Raw component fixture stays put.
  assert([4,5].includes(handoffResolvers.length),'old read plus new identity read(s) were issued')
  await tab('continuity')
  assert(!(await readout.textContent()).includes('220'),'previous session value clears immediately')
  await handoffResolvers[2]();await page.waitForTimeout(30);assert(!(await readout.textContent()).includes('330'))
  for(const resume of handoffResolvers.slice(3).reverse())await resume()
  await page.waitForTimeout(30);assert((await readout.textContent()).includes('94%'))
  holdHandoff=false;await page.evaluate(()=>dshTest.setSession('fixture-session'));await page.waitForTimeout(40)
 }
 evidence.push('PASS current/frozen/classic settings: handoff-state request disorder, changed session clears prior value and rejects old-session response')
 for(const language of ['zh','en','ja']){
  await page.evaluate(language=>dshTest.locale(language),language);await mounted('Settings')
  for(const group of ['common','record','find','continuity','maintenance','appearance','advanced']){await tab(group);assert.equal(await page.getByRole('tab',{selected:true}).count(),1)}
  await page.setViewportSize({width:390,height:844});await tab('appearance');await page.screenshot({path:path.join(artifacts,'settings-'+language+'-390.png')})
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth+2)
  assert.equal(overflow,false,'no page horizontal overflow for '+language)
  await page.keyboard.press('Tab');assert(await page.evaluate(()=>document.activeElement!==document.body))
  await page.setViewportSize({width:1280,height:900});await page.screenshot({path:path.join(artifacts,'settings-'+language+'-1280.png')})
  evidence.push('PASS '+language+': current Settings seven-section navigation; appearance at 390/1280, Tab moves focus, no appearance page horizontal overflow (not full keyboard/all-page layout acceptance)')
 }
 // V3 acceptance uses these same shipped React components and fixture APIs.
 await page.evaluate(()=>dshTest.locale('en'));await mounted('Settings')
 assert.equal(await page.getByRole('tab').count(),7)
 if(await page.locator('[data-dam-savebar]').isVisible())await page.getByRole('button',{name:'Discard changes',exact:true}).click()
 assert.equal(await page.locator('[data-dam-savebar]').isVisible(),false,'clean settings do not show a save bar')
 const search=()=>page.getByRole('combobox',{name:'Search settings or configuration keys',exact:true})
 const keys=await page.evaluate(()=>dshTest.Schema.map(d=>d.key))
 assert.equal(keys.length,359)
 for(const key of keys){
  await search().fill(key);await search().press('ArrowDown');await search().press('Enter')
  try {await page.waitForFunction(key=>{const el=document.activeElement,keys=el?.dataset.i5Keys?.split(' ')||[];return el?.dataset.i5CatalogKey===key || keys.includes(key) || keys.includes(key.split('.')[0]) || el?.dataset.i5EditorKeys?.split(' ').includes(key)},key)}
  catch(error){throw new Error('V3 key did not locate: '+key,{cause:error})}
  if(await page.locator('[data-native-model-picker]').count())await page.keyboard.press('Escape')
 }
 evidence.push('PASS V3: all 359 source-backed keys locate a real field or explicit compatibility directory entry with ArrowDown + Enter')
 for(const language of ['zh','en','ja']){
  await page.evaluate(language=>dshTest.locale(language),language)
  await mounted('Settings')
  const labels=[]
  for(const group of ['record','find','continuity','maintenance','appearance','advanced']){
   await tab(group)
   labels.push(...await page.locator('[data-i5-keys]').evaluateAll(rows=>rows.filter(row=>row.dataset.i5Keys).map(row=>({key:row.dataset.i5Keys.split(' ')[0],shown:row.querySelector('.i5-setting-copy>label')?.textContent,old:row.dataset.i5Field}))))
  }
  await tab('common')
  console.log('Checking V3 cross-section labels: '+language+' ('+labels.length+' controls)')
  for(const {key,shown,old} of labels)for(const label of new Set([shown,old])){
   if(!label)continue
   await page.getByRole('combobox').fill(label)
   const matches=await page.locator('.i5-search-results code').allTextContents()
   assert(matches.includes(key),'cross-section '+language+' label must find '+key+': '+label)
  }
  await page.getByRole('combobox').press('Escape')
 }
 await page.evaluate(()=>dshTest.locale('en'))
 await mounted('Settings')
 for(const key of ['promptLayerOverrides.snapshotHead','promptSectionToggles.rules-section','subagentProvider','subagentReasoningEffortLong','subagentReasoningEffortShort']){
  await tab('common');await search().fill(key);await search().press('ArrowDown');await search().press('Enter')
  await page.waitForFunction(key=>document.activeElement?.dataset.i5EditorKeys?.split(' ').includes(key),key)
  if(await page.locator('[data-native-model-picker]').count())await page.keyboard.press('Escape')
 }
 evidence.push('PASS V3: every mounted control label and original label remains searchable from Common in zh/en/ja; nested prompt switches/layers and model provider/effort keys open and focus real editors')
 await search().fill('autoConsolidate');await search().press('ArrowDown');await search().press('ArrowUp');await search().press('Escape')
 assert.equal(await search().getAttribute('aria-expanded'),'false')
 assert.equal(await page.locator('[data-settings-v3]').count(),1,'Escape closes search without leaving the settings surface')
 // Progressive disclosure and known dependency gates retain stored values.
 await tab('record');await page.locator('.i5-settings-advanced').evaluateAll(nodes=>nodes.forEach(n=>n.open=false))
 const recording=page.locator('[data-i5-keys="autoConsolidate"] input')
 const maxCalls=page.locator('[data-i5-keys="autoConsolidateDailyMax"] input')
 await recording.uncheck();assert(await maxCalls.isDisabled());assert(await page.locator('[data-dam-savebar]').isVisible())
 await page.getByRole('button',{name:'Discard changes',exact:true}).click();assert.equal(await page.locator('[data-dam-savebar]').isVisible(),false)
 await tab('maintenance');const lifecycle=page.locator('[data-i5-keys="sessionArchiveEnabled"] input')
 const archiveDays=page.locator('[data-i5-keys="autoArchiveDays"] input')
 const deletionDays=page.locator('[data-i5-keys="autoDeleteDays"] input')
 const beforeArchive=await archiveDays.inputValue(),beforeDelete=await deletionDays.inputValue()
 await lifecycle.uncheck();assert(await archiveDays.isDisabled());assert(await deletionDays.isDisabled())
 assert.equal(await archiveDays.inputValue(),beforeArchive);assert.equal(await deletionDays.inputValue(),beforeDelete)
 await page.getByRole('button',{name:'Discard changes',exact:true}).click()
 // Opening the actual shipped setup must reveal its UI under the same section.
 await tab('find');await page.getByRole('radio',{name:'Meaning (requires a local model)',exact:true}).click()
 await page.waitForFunction(()=>document.querySelector('input[type=radio][value=js]')?.checked)
 await page.locator('[data-native-engine-guide="js"]').waitFor({state:'visible'})
 assert.equal(await page.locator('[data-dam-savebar]').isVisible(),false,'immediate mode changes remain independent of the normal save bar')
 await page.locator('input[type=radio][value=auto]').click()
 await page.waitForFunction(()=>document.querySelector('input[type=radio][value=auto]')?.checked)
 evidence.push('PASS V3: dirty-only save bar, Cancel, recording/lifecycle dependency gates retain values, missing model setup opens visibly after immediate mode change')
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:width===390?844:1000})
  await page.evaluate(()=>dshTest.locale('zh'));await mounted('Settings')
  for(const group of ['common','record','find','continuity','maintenance','appearance','advanced']){
   await tab(group);await page.locator('.i5-settings-advanced').evaluateAll(nodes=>nodes.forEach(n=>n.open=false))
   await page.locator('.i5-main').first().evaluate(el=>{el.scrollTop=0})
   await page.screenshot({path:path.join(artifacts,'v3-'+group+'-'+width+'.png')})
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false,'no horizontal page overflow: '+group+' '+width)
   if(width===390)assert(await page.locator('.i5-settings-mobile select').isVisible())
  }
 }
 evidence.push('PASS V3: every settings section rendered and captured at 1440×1000 and 390×844; mobile selector and horizontal overflow checked')
 await page.setViewportSize({width:1440,height:1000});await page.evaluate(()=>dshTest.locale('en'))
 const acceptRouteLeave=dialog=>dialog.accept()
 page.on('dialog',acceptRouteLeave)
 for(const surface of ['Page','LegacyPage','ClassicPage']){
  await page.evaluate(()=>{dshTest.controller.setPanelTab('overview')});await mounted(surface)
  if(surface==='ClassicPage'){
   assert.equal(await page.locator('[data-dam-primary-nav] button').count(),4)
   await page.locator('[data-dam-primary-nav] button').filter({hasText:'Settings'}).click()
   await page.locator('[data-settings-v3]').waitFor()
  }else{
   const nav=surface==='Page'?page.locator('.i5-rail-nav'):page.locator('.i5-sidebar nav')
   const ids=await nav.locator('[data-i5-nav]').evaluateAll(nodes=>nodes.map(n=>n.dataset.i5Nav).filter(id=>id!=='team'))
   assert.deepEqual(ids,['home','library','handoff','settings'])
   await nav.locator('[data-i5-nav="library"]').click()
   await page.getByRole('button',{name:'Skills & approval',exact:true}).click()
   await page.locator('[data-page="skills"]').waitFor()
   await page.getByRole('button',{name:'Recall review',exact:true}).click()
   await page.locator('[data-page="recall"]').waitFor()
   await page.getByRole('button',{name:'External sources',exact:true}).click()
   await page.locator('[data-page="external"]').waitFor()
   await page.getByText('Source A',{exact:true}).first().waitFor()
   await page.getByRole('button',{name:'Workspace relationships',exact:true}).click()
   await page.locator('[data-page="mindmap"]').waitFor()
   await nav.locator('[data-i5-nav="handoff"]').click()
   await page.locator('.i5-secondary-nav').getByRole('button',{name:'Calendar',exact:true}).click()
   await page.locator('[data-page="calendar"]').waitFor()
   // The previous safety matrix deliberately left a recoverable calendar draft.
   // Use its genuine Cancel action and confirmation before navigating away.
   if(await page.locator('.i5-dialog').count())await page.locator('.i5-dialog').getByRole('button',{name:'Cancel',exact:true}).click()
   await nav.locator('[data-i5-nav="home"]').click()
   await page.getByRole('button',{name:'Statistics & calls',exact:true}).click()
   await page.locator('[data-page="stats"]').waitFor()
   await nav.locator('[data-i5-nav="settings"]').click();await tab('maintenance')
   await page.getByRole('button',{name:'Open maintenance center',exact:true}).click()
   await page.locator('[data-page="storage"]').waitFor()
   await page.locator('[data-i5-nav="team"]').click()
   await page.locator('[data-page="team"]').waitFor()
  }
 }
 page.off('dialog',acceptRouteLeave)
 evidence.push('PASS V3: current/frozen/classic ship four primary destinations; actual secondary relationship/calendar/statistics/maintenance routes remain reachable')

 // Exercise the real MemoryPageView skin dispatcher and actual stylesheet path.
 // Only base CSS is supplied by the fixture; the shipped Surface, skin selector
 // and shared settings form are responsible for every remaining stylesheet.
 await page.evaluate(()=>{dshTest.setSession('v3-workbench-scope');dshTest.controller.setPanelTab('settings')})
 async function workbench(skin){await page.evaluate(skin=>{dshTest.skin(skin);remount('Workbench')},skin);await page.locator('[data-settings-v3]').waitFor();await tab('record')}
 await workbench('classic')
 const calls=()=>page.locator('[data-i5-keys="autoConsolidateDailyMax"] input')
 await calls().fill('14')
 for(const skin of ['legacy','instrument','editorial','water','classic']){
  await workbench(skin);assert.equal(await calls().inputValue(),'14','workbench draft survives skin '+skin)
  assert(await page.locator('[data-dam-settings-css]').count(),'settings form owns shared stylesheet')
  const flavor=await page.locator('#dam-shared-ui-style').getAttribute('data-dam-flavor')
  const shared=await page.locator('#dam-shared-ui-style').textContent()
  if(['classic','legacy'].includes(skin))assert(!shared.includes('[data-settings-v3]'),'legacy base sheet is not replaced by the variant stylesheet')
  assert.equal(await page.locator('[data-i5-keys="autoConsolidateDailyMax"] .i5-setting-field').evaluate(el=>getComputedStyle(el).display),'grid')
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:width===390?844:1000});await tab('record')
   await page.screenshot({path:path.join(artifacts,'actual-'+skin+'-record-'+width+'.png')})
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false,'actual '+skin+' '+width+' horizontal overflow')
   if(width===390)assert(await page.locator('.i5-settings-mobile select').isVisible())
  }
 }
 await page.setViewportSize({width:1440,height:1000})
 await page.getByRole('button',{name:'Discard changes',exact:true}).click()
 await page.evaluate(()=>{dshTest.setSession('v3-isolated-settings');dshTest.skin('classic');settingsPair()})
 await page.locator('[data-fixture-host] [data-settings-v3]').waitFor()
 const host=page.locator('[data-fixture-host]'),work=page.locator('[data-fixture-workbench]')
 async function pairRecord(){await host.locator('[role=tab][id$="-tab-record"]').click();await work.locator('[role=tab][id$="-tab-record"]').click()}
 const hostCalls=()=>host.locator('[data-i5-keys="autoConsolidateDailyMax"] input'),workCalls=()=>work.locator('[data-i5-keys="autoConsolidateDailyMax"] input')
 await pairRecord();const savedCalls=await workCalls().inputValue()
 await hostCalls().fill('11');assert.equal(await workCalls().inputValue(),savedCalls,'host draft does not leak into classic workbench')
 await workCalls().fill('12');await page.evaluate(()=>settingsPair());await pairRecord()
 assert.equal(await hostCalls().inputValue(),'11');assert.equal(await workCalls().inputValue(),'12')
 await host.getByRole('button',{name:'Discard changes',exact:true}).click();await page.evaluate(()=>settingsPair());await pairRecord()
 assert.equal(await hostCalls().inputValue(),savedCalls);assert.equal(await workCalls().inputValue(),'12','host Cancel leaves workbench recovery record intact')
 await hostCalls().fill('13');await host.locator('[data-dam-savebar] button[data-dirty]').click()
  await page.waitForFunction(()=>!document.querySelector('[data-fixture-host] [data-i5-dirty=true]'))
  await work.getByText(/Changes detected from another entry:/).waitFor()
 assert.equal(await workCalls().inputValue(),'12','saving host retains workbench raw draft')
 await work.getByRole('button',{name:'Discard changes',exact:true}).click();assert.equal(await workCalls().inputValue(),'13','Cancel uses synchronized committed state')
 evidence.push('PASS V3: actual classic/legacy/three variants load their own shipped CSS; 1440/390 record screenshots and mobile controls; workbench drafts survive all skin switches; simultaneous classic workbench and host scopes stay isolated through remount, Cancel, save and broadcast')

 for(const surface of ['Workbench','Panel'])for(const fail of [false,true])for(const axis of ['session','workspace']){
  const sessionA='/fixture/identity-'+surface+'-'+fail+'-'+axis+'-A',sessionB='/fixture/identity-'+surface+'-'+fail+'-'+axis+'-B'
  const switchIdentity=value=>page.evaluate(([axis,value])=>{if(axis==='workspace')dshTest.setWorkspace(value);else dshTest.setSession(value)},[axis,value])
  config={...config,autoConsolidateDailyMax:20}
  await page.evaluate(([surface,axis,identity])=>{dshTest.skin('classic');dshTest.setWorkspace('/fixture/project');dshTest.setSession(identity);if(axis==='workspace')dshTest.setWorkspace(identity);dshTest.controller.setPanelTab('settings');dshTest.controller.open();remount(surface)},[surface,axis,sessionA])
  await page.locator('[data-settings-v3]').waitFor();await tab('record');assert.equal(await calls().inputValue(),'20')
  if(surface==='Panel'){
   assert(await page.locator('[data-settings-v3]').evaluate(el=>el.getBoundingClientRect().width>300),'actual floating settings form keeps its available width')
   assert(await page.locator('.i5-settings-mobile select').isVisible(),'floating settings uses its container width for the section selector')
  }
  const mounting=await page.evaluate(()=>fixtureNonce)
  await calls().fill('21')
  holdConfig=true;configResolvers=[];await page.evaluate(()=>dshTest.broadcast());await page.waitForTimeout(40)
  assert(configResolvers.length,'old-identity reads are held')
  config={...config,autoConsolidateDailyMax:30}
  await switchIdentity(sessionB)
  await page.waitForFunction(()=>document.querySelector('[data-settings-v3]')===null)
  await page.waitForTimeout(60)
  const newer=configResolvers.filter(resume=>resume.dailyMax===30),older=configResolvers.filter(resume=>resume.dailyMax===20)
  assert(newer.length&&older.length)
  for(const resume of newer)await resume()
  await page.locator('[data-settings-v3]').waitFor();await tab('record');assert.equal(await calls().inputValue(),'30')
  await calls().fill('31')
  for(const resume of older)await resume()
  await page.waitForTimeout(40);assert.equal(await calls().inputValue(),'31','old GET cannot replace the new identity draft')
  holdConfig=false;configResolvers=[]
  config={...config,autoConsolidateDailyMax:20}
  await switchIdentity(sessionA)
  await page.locator('[data-settings-v3]').waitFor();await tab('record')
  await page.waitForFunction(()=>document.querySelector('[data-i5-keys="autoConsolidateDailyMax"] input')?.value==='21')
  assert.equal(await page.evaluate(()=>fixtureNonce),mounting,'outer workbench/panel stays mounted through A → B → A')
  holdConfigSave=true;configSaveResolvers=[];await save();await page.waitForTimeout(50);assert.equal(configSaveResolvers.length,1)
  config={...config,autoConsolidateDailyMax:30}
  await switchIdentity(sessionB)
  await page.locator('[data-settings-v3]').waitFor();await tab('record')
  await page.waitForFunction(()=>document.querySelector('[data-i5-keys="autoConsolidateDailyMax"] input')?.value==='31')
  await configSaveResolvers[0](fail);await page.waitForTimeout(60)
  assert.equal(await calls().inputValue(),'31','late save result never overwrites the other identity')
  assert.equal(await calls().isDisabled(),false,'old pending operation does not lock the new identity')
  holdConfigSave=false;configSaveResolvers=[]
  config={...config,autoConsolidateDailyMax:fail?20:21}
  await switchIdentity(sessionA)
  await page.locator('[data-settings-v3]').waitFor();await tab('record')
  await page.waitForFunction(()=>document.querySelector('[data-i5-keys="autoConsolidateDailyMax"] input')?.value==='21')
  assert.equal(await page.locator('[data-dam-savebar]').isVisible(),fail,'only failed save retains the original identity recovery record')
 }
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:width===390?844:1000});await tab('record')
  await page.screenshot({path:path.join(artifacts,'actual-classic-panel-record-'+width+'.png')})
  assert.equal(await page.locator('[data-dam-body]').evaluate(el=>el.scrollWidth>el.clientWidth+2),false,'floating settings has no horizontal overflow')
 }
 evidence.push('PASS V3: actual classic workbench/panel remain mounted A → B → A for session and workspace switches; distinct raw drafts, delayed old GETs and success/failure save results cannot cross identity or lock the new form')

 assert.deepEqual(pageErrors,[],'no browser exceptions')
 writeFileSync(path.join(artifacts,'browser-results.json'),JSON.stringify({environment:'Chromium + React 18; fixture host APIs',browser:browser.version(),evidence,noteWrites,pageErrors},null,2)+'\n')
 console.log(evidence.join('\n'))
} catch(e) { console.log(evidence.join('\n'));await page.screenshot({path:path.join(artifacts,'failure.png')});console.log('Browser errors:',JSON.stringify(pageErrors));throw e } finally { await browser.close();await new Promise(resolve=>server.close(resolve)) }
