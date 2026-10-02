import assert from 'node:assert/strict'
import { extractTier0ItemsPre, splitTier0UnitsPre } from '../../lib/tier0-catalog.js'
const cards=Array.from({length:13},(_,i)=>({title:'卡片 '+i,body:'自身结论 '+i,id:'mem_'+i.toString(16).padStart(32,'0')}))
for(const layer of ['whiteboard','project','log','reflection'])for(const eol of ['\n','\r\n']) {
 const source=cards.map(c=>`### ${c.title}\n<!-- memory:${c.id} -->\n${c.body}`).join('\n').replaceAll('\n',eol)
 const rows=extractTier0ItemsPre(source,layer,{path:'handoff/PLAN.md'})
 assert.deepEqual(splitTier0UnitsPre(source).groups,cards.map(c=>['### '+c.title,'',c.body]))
 assert.equal(rows.length,13)
 for(let i=0;i<13;i++){assert.equal(rows[i].title,cards[i].title);assert.ok(JSON.stringify(rows[i]).includes(cards[i].body));assert.ok(!JSON.stringify(rows[i]).includes(cards[(i+1)%13].title))}
}
assert.deepEqual(splitTier0UnitsPre('### A\na\n### B\nb\n### C\nc').groups,[['### A','a'],['### B','b'],['### C','c']])
assert.equal(splitTier0UnitsPre('- first\n- second').groups.length,2)
const bare='<!-- memory:mem_'+ 'a'.repeat(32)+' -->\nold body\n<!-- memory:mem_'+'b'.repeat(32)+' -->\nother body'
assert.deepEqual(splitTier0UnitsPre(bare).groups,[['old body'],['other body']])
assert.deepEqual(splitTier0UnitsPre('### 单卡\n<!-- memory:mem_'+ 'c'.repeat(32)+' -->\n唯一结论').groups,[['### 单卡','','唯一结论']])
console.log('PASS #177: 13-card title/body alignment in four source layers, LF/CRLF, old bare anchors and unanchored invariants')
