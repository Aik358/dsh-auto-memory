import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
const script = (await readFile(new URL('../../.github/scripts/report-sync.mjs',import.meta.url),'utf8')).replace(/^import .*$/gm,'')
const run = new Function('return Object.getPrototypeOf(async function(){}).constructor')()('readFileSync','sendGroupText','process','fetch','console',script)
for (const name of ['issues','pull_request']) {
  const calls=[]
  const event = name==='issues' ? {action:'closed',issue:{number:10,title:'fake',labels:[{name:'group-report'}]}} : {action:'opened',pull_request:{number:20,title:'fix #10',body:''}}
  await run(()=>JSON.stringify(event),()=>assert.fail('must not send QQ'),{env:{GITHUB_EVENT_NAME:name,GITHUB_EVENT_PATH:'fake',GITHUB_REPOSITORY:'isolated/repo',GITHUB_TOKEN:'fake'},exit:()=>assert.fail('matching event must run')},async(url,opts={})=>{calls.push({url,method:opts.method||'GET'});return{ok:true,status:200,json:async()=>({labels:[{name:'group-report'}]})}},{log(){},warn(){},error(){}})
  assert.equal(calls.filter(c=>c.method==='POST').length,1)
}
console.log('PASS F29: Actions event name from env, fake GitHub transport, QQ disabled')
