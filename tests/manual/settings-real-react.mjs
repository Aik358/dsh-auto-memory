// Optional official renderer acceptance; install pinned packages outside the repo:
// npm install --cache=/tmp/dam-react-cache --prefix /tmp/dam-react-review --no-audit --no-fund react@19.2.0 react-test-renderer@19.2.0
// DAM_REACT_ROOT=/tmp/dam-react-review/node_modules node tests/manual/settings-real-react.mjs
import assert from 'node:assert/strict'
import {pathToFileURL} from 'node:url'
import path from 'node:path'
import {completeClient} from '../lib/complete-client.mjs'
const root=process.env.DAM_REACT_ROOT;if(!root)throw Error('DAM_REACT_ROOT required: this acceptance cannot silently skip')
const React=(await import(pathToFileURL(path.join(root,'react/index.js')))).default
const renderer=(await import(pathToFileURL(path.join(root,'react-test-renderer/index.js')))).default
const {act}=renderer;globalThis.IS_REACT_ACT_ENVIRONMENT=true
let pass=0,fail=0
for(const mode of ['variant','legacy'])for(const scenario of ['broadcast-success','broadcast-failure','save-epoch']){
 let hold=false,pending=[],post,server={memoryAnchorEnabled:false,associativeMemoryEnabled:false,semanticEngineMode:'js'}
 const payload=(config,key)=>({config,promptSections:[key],promptSectionMust:[key]})
 const app=await completeClient({react:React,fetch:async(url,opts)=>{
  if(/\/config(?:\?|$)/.test(url)){
   if(opts?.method==='POST')return new Promise(resolve=>post=()=>{server={...server,...JSON.parse(opts.body)};resolve({ok:true,json:async()=>payload(server,'saved-section')})})
   if(hold)return new Promise((resolve,reject)=>pending.push({resolve:d=>resolve({ok:true,json:async()=>d}),reject}))
   return {ok:true,json:async()=>payload(server,'initial-section')}
  }
  return {ok:true,json:async()=>({})}
 }})
 const component=mode==='variant'?app.audit.Iter5Settings:app.audit.legacy.settings,props={intent:{group:'engine'},draftScope:mode+scenario};app.audit.session('A','/isolated/A')
 let tree
 const anchor=()=>tree.root.findAll(n=>n.type==='input'&&String(n.props.onChange).includes("set('memoryAnchorEnabled'"))[0]
 const save=()=>tree.root.findAll(n=>n.type==='button'&&n.props.onClick?.name==='save')[0]
 try{
  await act(async()=>{tree=renderer.create(React.createElement(component,props))})
  await act(async()=>anchor().props.onChange({target:{checked:true}}));assert.equal(save().props.disabled,false)
  if(scenario==='save-epoch'){
   hold=true;await act(async()=>app.audit.controller.togglePin());assert.equal(pending.length,1)
   await act(async()=>save().props.onClick());assert(post)
   const count=pending.length;await act(async()=>app.audit.controller.togglePin());assert.equal(pending.length,count,'official hooks do not fetch while busy')
   await act(async()=>post());assert.equal(anchor().props.checked,true)
   await act(async()=>pending[0].resolve(payload({...server,memoryAnchorEnabled:false},'stale-section')))
   assert.equal(anchor().props.checked,true,'official scheduler retains saved C1');await act(async()=>anchor().props.onChange({target:{checked:true}}));assert.equal(save().props.disabled,true)
  }else{
   await act(async()=>tree.unmount());hold=true;await act(async()=>{tree=renderer.create(React.createElement(component,props))});assert.equal(pending.length,1)
   await act(async()=>app.audit.controller.togglePin());assert.equal(pending.length,2)
   await act(async()=>scenario==='broadcast-success'?pending[1].resolve(payload({...server,semanticEngineMode:'python'},'broadcast-section')):pending[1].reject(Error('controlled GET failure')))
   await act(async()=>pending[0].resolve(payload(server,'fallback-section')))
   assert.equal(anchor().props.checked,true,'official remount preserves draft');assert.equal(save().props.disabled,false)
   const modeInput=tree.root.findAll(n=>n.type==='input'&&n.props.type==='radio'&&n.props.checked)[0]
   assert.equal(modeInput.props.value,scenario==='broadcast-success'?'python':'js')
   const tabs=tree.root.findAll(n=>n.props.items?.some?.(x=>x[0]==='memory')&&n.props.onChange)[0];await act(async()=>tabs.props.onChange('memory'))
   const toggle=tree.root.findAll(n=>n.type==='button'&&String(n.props.onClick).includes('setPsecOpen(!psecOpen)'))[0];await act(async()=>toggle.props.onClick())
   const key=scenario==='broadcast-success'?'broadcast-section':'fallback-section';assert.equal(tree.root.findAll(n=>n.type==='input'&&n.props['data-dam-pswitch']===key).length,1)
   assert.match(JSON.stringify(tree.toJSON()),/硬性要求|mandatory/)
  }
  console.log('PASS official React '+mode+' '+scenario);pass++
 }catch(e){console.error('FAIL official React '+mode+' '+scenario+' '+e.stack);fail++}finally{if(tree)await act(async()=>tree.unmount())}
}
console.log('PASS '+pass+' / FAIL '+fail);process.exitCode=fail?1:0
