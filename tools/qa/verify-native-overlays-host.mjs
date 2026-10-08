import { createRequire } from 'node:module'
import { readFileSync, writeFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import path from 'node:path'
const deps=process.argv.find(arg=>arg.startsWith('--deps='))?.slice(7);assert.ok(deps,'Pass --deps=<isolated dependency directory>')
const require=createRequire(path.resolve(deps,'package.json')),{chromium}=require('playwright-core')
// Start a DSH web host with isolated DSH_HOME/USERPROFILE/HOME and this bundle.
// ISSUE282_HOST_URL is its authenticated localhost URL. All plugin APIs use fixtures.
const url=process.env.ISSUE282_HOST_URL
assert.ok(url)
const bundle=readFileSync('lib/client.js','utf8').replace('    return module.exports', `
    window.qaHost={open:openDialog,close:closeDialog,state:function(){return {dialog:dialogState,queue:dialogQueue}},clear:function(){dialogState=null;dialogQueue=[];notifyDialog()}};
    return module.exports`)
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true})
const rows=[],errors=[]
try {
  for(const mode of ['legacy','classic'])for(const theme of ['light','dark'])for(const viewport of [{width:1280,height:900},{width:390,height:844}]){
    let state='idle',done='fixture-1'
    const context=await browser.newContext({viewport}),page=await context.newPage()
    page.on('pageerror',e=>errors.push(e.message))
    await page.addInitScript(({mode,theme})=>{
      localStorage.setItem('dam-skin',mode==='classic'?'classic':'v4');localStorage.setItem('dam-skin-style','legacy');
      localStorage.setItem('dsh-auto-memory.appearance.v1',theme);localStorage.setItem('dam-skin-theme',theme);
      localStorage.setItem('dsh-auto-memory.seenVersion','3.2.11');localStorage.setItem('dsh-auto-memory.firstRunDone','1');
    },{mode,theme})
    await page.route('**/plugins/**',async route=>{
      if(new URL(route.request().url()).pathname==='/plugins/events')return route.continue()
      const response=await route.fetch(),text=await response.text()
      if(text.includes('function AutoContinueHost()'))await route.fulfill({response,body:bundle})
      else await route.fulfill({response})
    })
    await page.route('**/api/dsh-auto-memory/**',route=>{
      const endpoint=new URL(route.request().url()).pathname.split('/').pop();let data={}
      if(endpoint==='config')data={config:{autoContinueEnabled:true,autoContinueThreshold:.75,welcomeTourEnabled:false,workbenchEnabled:false,semanticEngineMode:'lexical',memoryRoot:'/fixture'}}
      if(endpoint==='auto-continue-state')data=state==='idle'?{}:state==='confirm'?{armed:{ratio:.8,tokens:80000,window:100000,ring:.8,wall:110000,edgeAt:1,expiresAt:Date.now()+35000}}:state==='progress'?{executing:true}:{lastOk:{at:0,sessionId:done,model:'fixture'}}
      if(endpoint==='version')data={current:'3.2.11'}
      if(endpoint==='notices')data={notices:[]}
      if(endpoint==='workbench-status')data={ready:true}
      if(endpoint==='state')data={files:[],recent:[],counts:{},logs:[],ws:'/fixture'}
      if(endpoint==='auto-continue-decide'){state='success';data={ok:true}}
      return route.fulfill({contentType:'application/json',body:JSON.stringify(data)})
    })
    await page.goto(url)
    await page.waitForFunction(()=>!!window.qaHost,{},{timeout:30000})
    await page.evaluate(()=>qaHost.clear())
    const intro=page.getByRole('button',{name:'继续',exact:true})
    if(await intro.count())await intro.click()
    for(const kind of ['success','confirm','progress','notice','welcomeBack']){
      await page.evaluate(()=>qaHost.clear())
      state=kind;done='fixture-'+kind
      const selector=kind==='notice'||kind==='welcomeBack'?'.i5-native-notice':'[data-dam-autocont]'
      if(kind==='notice'||kind==='welcomeBack')await page.evaluate(kind=>{qaHost.clear();qaHost.open({kind,notice:{id:'fixture',title:'插件通知',message:'隔离 DSH 宿主验证。'}})},kind)
      else await page.waitForFunction(kind=>document.querySelector('[data-native-continuation]')?.getAttribute('data-native-continuation')===(kind==='confirm'?'confirm':kind==='progress'?'progress':'notice'),kind)
      try {await page.locator(selector).waitFor({timeout:8000})}catch(e){console.log(JSON.stringify(await page.evaluate(()=>({state:qaHost.state(),text:document.body.innerText.slice(-4000)}))));throw e}
      const m=await page.locator(selector).evaluate(el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return {position:s.position,top:r.top,bottom:r.bottom,left:r.left,right:r.right,header:getComputedStyle(el.querySelector('header')).display,deep:el.closest('[data-dam-theme]').dataset.deep,buttons:[...el.querySelectorAll('button')].map(b=>{const q=b.getBoundingClientRect();return {top:q.top,bottom:q.bottom,left:q.left,right:q.right}})}})
      rows.push({mode,theme,viewport,kind,...m});assert.equal(m.position,'fixed');assert.equal(m.header,'flex');assert.equal(m.deep,String(theme==='dark'))
      assert.ok(m.top>=0&&m.bottom<=viewport.height&&m.left>=0&&m.right<=viewport.width)
      assert.ok(m.buttons.every(b=>b.top>=0&&b.bottom<=viewport.height&&b.left>=0&&b.right<=viewport.width))
      if(kind==='confirm')await page.screenshot({path:'artifacts/issue282/host-'+mode+'-'+theme+'-'+viewport.width+'.png'})
      await page.locator(selector+(kind==='notice'||kind==='welcomeBack'?' button':' [data-dam-autocont-close]')).first().click()
      await page.locator(selector).waitFor({state:'detached'})
      if(kind==='notice'||kind==='welcomeBack'){
        await page.evaluate(kind=>qaHost.open({kind,notice:{id:'fixture-again',title:'再次通知',message:'关闭后重新打开'}}),kind)
        await page.locator(selector).waitFor();await page.locator(selector+' button').first().click();await page.locator(selector).waitFor({state:'detached'})
      }
    }
    await context.close()
  }
  writeFileSync('artifacts/issue282/host.json',JSON.stringify({rows,errors},null,2));console.log(JSON.stringify({cases:rows.length,errors}));assert.equal(errors.length,0)
}finally{await browser.close()}
