#!/usr/bin/env node
/** Local, explicit recovery; no model/network/controller requests. */
import path from 'node:path'
import { resolveDshHomePre } from './dsh-home.js'
import { continuedSourceView, continuedSourceState, recoverContinuedSource, readStateJson, writeStateJson, parseContState } from './continuation-state.js'
import { withSharedStateLock } from './shared-state-lock.js'
const [action,...args]=process.argv.slice(2), opts=Object.create(null)
try {
 const flags=new Set(['--confirmed-delivered','--confirmed-not-delivered','--confirmed-history-reviewed'])
 const values=new Set(['--source','--token','--expected-successor','--successor','--last'])
 for(let i=0;i<args.length;i++) {
  const key=args[i];if(Object.hasOwn(opts,key))throw Error('duplicate argument '+key)
  if(flags.has(key))opts[key]=true
  else if(values.has(key)&&i+1<args.length)opts[key]=args[++i]
  else throw Error('unknown or incomplete argument '+key)
 }
 if(action==='complete' && (opts['--confirmed-not-delivered']||opts['--confirmed-history-reviewed']))throw Error('complete requires only delivered verification')
 if(action==='release' && (opts['--confirmed-delivered']||opts['--confirmed-history-reviewed']))throw Error('release requires only non-delivery verification')
 const file=path.join(resolveDshHomePre(),'memory','auto-continue-done.json')
 let result
 if(action==='seed-counter') {
  const last=Number(opts['--last'])
  if(!opts['--confirmed-history-reviewed']||opts['--last']===undefined||!Number.isSafeInteger(last)||last<0)throw Error('verified safe history maximum required')
  const counter=path.join(resolveDshHomePre(),'memory','cont-seq.json')
  result=await withSharedStateLock(counter,async()=>{
   const old=readStateJson(counter,null,parseContState)
   if(old&&Math.max(old.last,...Object.values(old.byWs))>last)throw Error('seed cannot lower existing high-water')
   // Zero cannot bypass cold history verification.
   if(last===0)throw Error('positive verified seed required; empty SQLite needs an explicit first reservation')
   writeStateJson(counter,{last,byWorkspace:old?.byWs||{},updatedAt:Date.now()});return {ok:true,last}
  })
 } else {
  const sid=opts['--source']?.replace(/^session-/,'');if(!sid)throw Error('--source required')
  if(action==='status') { const record=continuedSourceState(file,sid); result={ok:true,pending:continuedSourceView(file,sid,record),completed:record?.status==='done' ? {source:sid,successorId:record.successorFormat==='raw'?record.to:null,successorKey:record.to?.replace(/^session-/,'')||null,at:record.at||null}:null} }
  else result=await recoverContinuedSource(file,sid,{action,token:opts['--token'],expectedSuccessor:opts['--expected-successor'],successor:opts['--successor'],confirmed:action==='complete'?opts['--confirmed-delivered']:opts['--confirmed-not-delivered']})
 }
 console.log(JSON.stringify(result))
} catch(e) { console.error(JSON.stringify({ok:false,error:e.message}));process.exitCode=1 }
