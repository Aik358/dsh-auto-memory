import assert from 'node:assert/strict'
import {completeClient} from '../lib/complete-client.mjs'
const requests=[]
const app=await completeClient({fetch:async(url,opts)=>{requests.push({url,opts});return {ok:true,json:async()=>opts?{result:'saved'}:{notesPath:'/isolated/A/MEMORY.md'}}}})
const {audit,render,reset,nodes,spin}=app
audit.session('A','/isolated/A')
for(const [name,component]of [['classic',audit.NotesTab],['variant',audit.Iter5Note],['legacy',audit.legacy.note]]){
 reset();requests.length=0
 const props={source:'/isolated/A/MEMORY.md',sessionId:'A'}
 let tree=render(component,props);await spin();tree=render(component,props)
 nodes(tree,n=>n.type==='textarea')[0].props.onChange({target:{value:'decision for A'}});tree=render(component,props)
 const form=nodes(tree,n=>n.type==='form')[0]
 if(form)form.props.onSubmit({preventDefault(){}});else nodes(tree,n=>n.type==='button')[0].props.onClick()
 await spin()
 const body=JSON.parse(requests.find(r=>r.opts?.method==='POST').opts.body)
 assert.equal(body.sessionId,'A',name);assert.equal(body.expectedNotesPath,'/isolated/A/MEMORY.md',name);assert.equal(body.content,'decision for A')
 // A real client identity change must not submit the old rendered form.
 requests.length=0;audit.session('B','/isolated/B');tree=render(component,props)
 nodes(tree,n=>n.type==='textarea')[0].props.onChange({target:{value:'stale edit'}});tree=render(component,props)
 const stale=nodes(tree,n=>n.type==='form')[0];if(stale)stale.props.onSubmit({preventDefault(){}});else nodes(tree,n=>n.type==='button')[0].props.onClick()
 await spin();assert(!requests.some(r=>r.opts?.method==='POST'),name+' rejects stale form')
 audit.session('A','/isolated/A');console.log('PASS '+name+' note binding and stale form rejection')
}
reset()
