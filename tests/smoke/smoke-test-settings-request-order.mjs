import assert from 'node:assert/strict'
import {completeClient} from '../lib/complete-client.mjs'
let pass=0,fail=0
for(const mode of ['variant','legacy'])for(const scenario of ['busy','late-before-save','get-order','draft-merge']){
 let pending=[],server={memoryAnchorEnabled:false,associativeMemoryEnabled:false,semanticEngineMode:'js'},hold=false,post
 const app=await completeClient({fetch:async(url,opts)=>{
  if(/\/config(?:\?|$)/.test(url)){
   if(opts?.method==='POST'){return new Promise(resolve=>post=()=>{server={...server,...JSON.parse(opts.body)};resolve({ok:true,json:async()=>({config:server})})})}
   if(hold)return new Promise(resolve=>pending.push(value=>resolve({ok:true,json:async()=>({config:value})})))
   return {ok:true,json:async()=>({config:server})}
  }
  return {ok:true,json:async()=>({})}
 }})
 const {audit,render,nodes,spin,reset}=app; audit.session('A','/isolated/A')
 const component=mode==='variant'?audit.Iter5Settings:audit.legacy.settings
 const props={intent:{group:'engine'},draftScope:mode+scenario}
 try{
  let tree=render(component,props);await spin();tree=render(component,props)
  const checkbox=()=>nodes(tree,n=>n.type==='input'&&String(n.props.onChange).includes("set('memoryAnchorEnabled'"))[0]
  const save=()=>nodes(tree,n=>n.type==='button'&&n.props.onClick?.name==='save')[0]
  assert(checkbox(),'actual anchor setting rendered')
  hold=true;audit.controller.togglePin();await spin();assert.equal(pending.length,1,'old C0 GET pending')
  if(scenario==='get-order'){
   audit.controller.togglePin();await spin();assert.equal(pending.length,2)
   pending[1]({...server,memoryAnchorEnabled:true});await spin();pending[0](server);await spin()
   tree=render(component,props);assert.equal(checkbox().props.checked,true,'latest request wins')
  }else{
   checkbox().props.onChange({target:{checked:true}});tree=render(component,props)
   if(scenario==='draft-merge'){
    pending[0]({...server,semanticEngineMode:'python'});await spin();tree=render(component,props)
    assert.equal(checkbox().props.checked,true,'remote GET retains unsaved draft');assert.equal(save().props.disabled,false)
   }else{
    save().props.onClick();tree=render(component,props);await spin();assert(post,'actual POST submitted')
    if(scenario==='busy'){
     const before=pending.length;audit.controller.togglePin();await spin();assert.equal(pending.length,before,'busy subscriber must not fetch')
    }else{
     post();await spin();tree=render(component,props);assert.equal(checkbox().props.checked,true)
     // A subsequent post-save read is held. An older request must never replace the saved base.
     pending[0]({...server,memoryAnchorEnabled:false});await spin();tree=render(component,props)
     assert.equal(checkbox().props.checked,true,'old C0 response cannot undo saved C1')
     checkbox().props.onChange({target:{checked:true}});tree=render(component,props)
     assert.equal(save().props.disabled,true,'saved base remains C1, same value creates no draft')
    }
   }
  }
  console.log('PASS '+mode+' '+scenario);pass++
 }catch(e){console.error('FAIL '+mode+' '+scenario+' '+e.stack);fail++}finally{reset()}
}
console.log('PASS '+pass+' / FAIL '+fail);process.exitCode=fail?1:0
