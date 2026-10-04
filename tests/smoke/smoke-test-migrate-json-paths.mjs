import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildPackPre,rewritePackForTargetPre } from '../../lib/migrate-pack.js'
for(const [from,to]of [['/home/u/project','D:\\projects\\app'],['D:\\temp\\new','/home/u/project'],['/home/u/project','D:\\temp\\new']]){
 await test('format-aware JSON and JSONL migration: '+from+' -> '+to,()=>{
  const value={workspace:from,steps:[{path:from+'/task',literal:'tab\t newline\n backslash\\ untouched'}],uri:'file:///'+from.replace(/\\/g,'/')}
  const raw=JSON.stringify(value),pack=buildPackPre({ws:from,files:{'.workspace-owner.json':raw,'hub/procedures.json':raw,'history.jsonl':raw+'\r\n'+JSON.stringify({path:from})+'\r\n','MEMORY.md':'plain '+from}}).pack
  const result=rewritePackForTargetPre(pack,{targetWs:to})
  for(const name of ['.workspace-owner.json','hub/procedures.json']){const actual=JSON.parse(result.files[name]);assert.equal(actual.workspace,to);assert.equal(actual.steps[0].path,to+'/task');assert.equal(actual.steps[0].literal,value.steps[0].literal);assert.equal(actual.uri,'file:///'+to.replace(/\\/g,'/'))}
  const lines=result.files['history.jsonl'].trim().split(/\r?\n/).map(s=>JSON.parse(s));assert.equal(lines[0].workspace,to);assert.equal(lines[1].path,to)
  assert.equal(result.files['history.jsonl'].split('\r\n').length,3)
  assert.equal(result.files['MEMORY.md'],'plain '+to)
  assert.deepEqual(rewritePackForTargetPre(pack,{targetWs:to,rewriteBody:false}).files,pack.files)
 })
}
await test('JSON rewriting preserves untouched numeric and escaped string tokens',()=>{
 const pack=buildPackPre({ws:'/home/u/project',files:{'hub/procedures.json':'{"path":"\\/home\\/u\\/project","number":9007199254740993123,"literal":"\\t\\n\\\\"}'}}).pack
 const result=rewritePackForTargetPre(pack,{targetWs:'D:\\temp\\new'}).files['hub/procedures.json']
 assert.equal(JSON.parse(result).path,'D:\\temp\\new')
 assert(result.includes('9007199254740993123'));assert(result.includes('"literal":"\\t\\n\\\\"'))
})
