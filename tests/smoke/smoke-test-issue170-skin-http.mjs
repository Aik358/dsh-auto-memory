import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import http from 'node:http'
import { apply, API } from '../../lib/index.js'
import { SKIN_ASSETS } from '../../lib/skin-assets.js'
const root=await mkdtemp(path.join(os.tmpdir(),'dam-skin-http-'))
const previous={home:process.env.HOME,dsh:process.env.DSH_HOME,fetch:globalThis.fetch,interval:globalThis.setInterval,timeout:globalThis.setTimeout}
const listeners=new Map(['uncaughtException','unhandledRejection','exit'].map(e=>[e,new Set(process.listeners(e))]))
const routes=[],cleanups=[],dispose=[];let server
try {
 process.env.HOME=root;process.env.DSH_HOME=root
 await writeFile(path.join(root,'dsh-auto-memory.json'),JSON.stringify({memoryRoot:path.join(root,'memory'),userMemoryDir:path.join(root,'user'),globalBriefEnabled:false,teamEnabled:false,externalSources:{},greetingEnabled:false}))
 globalThis.fetch=async()=>{throw Error('external network forbidden in skin regression')}
 globalThis.setInterval=globalThis.setTimeout=()=>({unref(){}})
 apply({get:()=>undefined,on:(name,f)=>{if(name==='dispose')dispose.push(f)},systemPrompt:{context:()=>()=>{},section:()=>()=>{}},tools:{register:()=>()=>{}},webServer:{register:r=>{routes.push(r);return()=>{}}},effect:f=>cleanups.push(f())},{})
 globalThis.setInterval=previous.interval;globalThis.setTimeout=previous.timeout
 for(const [event,old]of listeners)for(const listener of process.listeners(event))if(!old.has(listener))process.removeListener(event,listener)
 const route=routes.find(r=>r.path===API.skinAsset);assert.ok(route)
 server=http.createServer((req,res)=>void route.handler(req,res).catch(e=>{res.writeHead(500);res.end(String(e))}))
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port
 for(const key of Object.keys(SKIN_ASSETS))for(const deep of [0,1]) {
  const result=await new Promise((resolve,reject)=>http.get({host:'127.0.0.1',port,agent:false,path:API.skinAsset+'?key='+encodeURIComponent(key)+'&deep='+deep},res=>{let bytes=0;res.on('data',b=>{bytes+=b.length});res.on('end',()=>resolve({status:res.statusCode,bytes,type:res.headers['content-type']}))}).on('error',reject))
  assert.equal(result.status,200,key+' deep='+deep);assert.ok(result.bytes>1000);assert.match(result.type,/image\//)
 }
 console.log('PASS #170: actual registered loopback HTTP route serves all six ready slots in light/dark modes')
} finally {
 for(const f of dispose)f();for(const f of cleanups)f?.()
 if(server)await new Promise(r=>server.close(r))
 globalThis.fetch=previous.fetch;globalThis.setInterval=previous.interval;globalThis.setTimeout=previous.timeout
 for(const [event,old]of listeners)for(const listener of process.listeners(event))if(!old.has(listener))process.removeListener(event,listener)
 await new Promise(r=>setTimeout(r,100));await rm(root,{recursive:true,force:true})
 for(const [k,v]of [['HOME',previous.home],['DSH_HOME',previous.dsh]])if(v===undefined)delete process.env[k];else process.env[k]=v
}
