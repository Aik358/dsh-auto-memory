import assert from 'node:assert/strict'
import {completeClient} from '../lib/complete-client.mjs'
let pass=0,fail=0
for(const mode of ['variant','legacy'])for(const scenario of ['broadcast-success','broadcast-failure']){
 let hold=false,pending=[]
 const c0={memoryAnchorEnabled:false,associativeMemoryEnabled:false,semanticEngineMode:'js'},c1={...c0,semanticEngineMode:'python'}
 const payload=(config,key)=>({config,promptSections:[key],promptSectionMust:[key]})
 const app=await completeClient({fetch:async(url,opts)=>{
  if(/\/config(?:\?|$)/.test(url)&&!opts){if(hold)return new Promise((resolve,reject)=>pending.push({resolve:d=>resolve({ok:true,json:async()=>d}),reject}));return {ok:true,json:async()=>payload(c0,'original-section')}}
  return {ok:true,json:async()=>({})}
 }})
 const {audit,render,nodes,spin,reset}=app;audit.session('A','/isolated/A')
 const component=mode==='variant'?audit.Iter5Settings:audit.legacy.settings,props={intent:{group:'engine'},draftScope:'retained-draft'}
 try{
  let tree=render(component,props);await spin();tree=render(component,props)
  const checkbox=()=>nodes(tree,n=>n.type==='input'&&String(n.props.onChange).includes("set('memoryAnchorEnabled'"))[0]
  const save=()=>nodes(tree,n=>n.type==='button'&&n.props.onClick?.name==='save')[0]
  checkbox().props.onChange({target:{checked:true}});tree=render(component,props);assert.equal(save().props.disabled,false)
  reset();hold=true;tree=render(component,props);await spin();assert.equal(pending.length,1)
  audit.controller.togglePin();await spin();assert.equal(pending.length,2)
  if(scenario==='broadcast-success')pending[1].resolve(payload(c1,'broadcast-section'))
  else pending[1].reject(Error('controlled broadcast read failure'))
  await spin()
  pending[0].resolve(payload(c0,'initial-section'));await spin();tree=render(component,props)
  assert(checkbox(),'initialization completes despite a failed newer read');assert.equal(checkbox().props.checked,true,'unmounted draft restored by whichever successful response initializes')
  assert.equal(save().props.disabled,false,'restored edits remain dirty')
  const modeInput=nodes(tree,n=>n.type==='input'&&n.props.type==='radio'&&n.props.checked&&String(n.props.onChange).includes('onEngineModeChange'))[0]
  assert.equal(modeInput.props.value,scenario==='broadcast-success'?'python':'js','latest successful config remains base')
  nodes(tree,n=>n.props?.onChange&&n.props.items?.some?.(x=>x[0]==='memory'))[0].props.onChange('memory');tree=render(component,props)
  nodes(tree,n=>n.type==='button'&&String(n.props.onClick).includes('setPsecOpen(!psecOpen)'))[0].props.onClick();tree=render(component,props)
  const key=scenario==='broadcast-success'?'broadcast-section':'initial-section'
  assert.equal(nodes(tree,n=>n.props?.['data-dam-pswitch']===key).length,1,'winning response supplies section metadata')
  const row=nodes(tree,n=>n.props?.key===key)[0];assert.match(JSON.stringify(row),/硬性要求|mandatory/,'mandatory metadata also restored')
  console.log('PASS '+mode+' '+scenario);pass++
 }catch(e){console.error('FAIL '+mode+' '+scenario+' '+e.stack);fail++}finally{reset()}
}
console.log('PASS '+pass+' / FAIL '+fail);process.exitCode=fail?1:0
