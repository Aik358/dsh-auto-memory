import assert from 'node:assert/strict'
import vm from 'node:vm'
import {readFile} from 'node:fs/promises'
const source=await readFile(new URL('../../lib/client.js',import.meta.url),'utf8')
const start=source.indexOf('    function teamFromState(st) {'),end=source.indexOf('// ===================== L3-team:end',start)
const views=new Map(),timers=new Map();let current,h=0,e=0,requests=0,timerSequence=0,missing='',paused=false,queue=0
const sb={API:{teamState:'state',teamAttribution:'attr',teamConflicts:'conflicts',teamSyncDebug:'debug'},Object,Array,Number,JSON,Promise,
 useTick:()=>[0,()=>{}],useState:value=>{const i=h++,owner=current;if(!owner.states[i])owner.states[i]={value,set:v=>{owner.states[i].value=v}};return[owner.states[i].value,owner.states[i].set]},
 useEffect:fn=>{const i=e++;if(!current.effects[i])current.effects[i]={cleanup:fn()}},
 setInterval:fn=>{const id=++timerSequence;timers.set(id,fn);return id},clearInterval:id=>timers.delete(id),
 apiGet:async key=>{requests++;const state={enabled:true,configured:true,paused,member:{id:'self',name:'Alice'},sync:{lastOk:12345,lastError:''},pull:{since:4},outbox:{size:queue,lastError:'send: old 503'}};if(missing==='outbox')delete state.outbox;return {state,attr:missing==='attr'?{}:{attribution:{items:[]}},conflicts:missing==='conflicts'?{}:{conflicts:[]},debug:{outbox:{lastError:'send: old 503'}}}[key]}}
vm.createContext(sb);vm.runInContext(source.slice(start,end)+'\nthis.exports={useTeamTick,fetchTeamState};',sb)
function render(id){if(!views.has(id))views.set(id,{states:[],effects:[]});current=views.get(id);h=e=0;return sb.exports.useTeamTick()}
const a=render('a'),b=render('b');await sb.exports.fetchTeamState();assert.equal(requests,4);assert.equal(timers.size,1)
assert.equal(render('a').team.phase,'synced');assert.equal(render('b').team.members[0].id,'self')
// An action refresh is broadcast to both continuously mounted hook consumers.
paused=true;await a.tick[1]();assert.equal(render('a').team.phase,'paused');assert.equal(render('b').team.phase,'paused')
// A background host change is observed through the single shared read-only poll.
paused=false;queue=3;const before=requests;[...timers.values()][0]();await Promise.all([sb.exports.fetchTeamState(),b.tick[1]()]);assert.equal(requests-before,4);assert.equal(render('a').team.queue,3);assert.equal(render('b').team.queue,3)
for(missing of ['outbox','attr','conflicts']){assert.equal(await sb.exports.fetchTeamState(),null);assert.equal(render('a').team,null);assert.equal(render('b').team,null)}
missing='';queue=0;await sb.exports.fetchTeamState();assert.equal(render('a').team.phase,'synced');assert.match(JSON.stringify(render('b').team.debug),/old 503/)
for(const effect of views.get('a').effects)effect.cleanup?.();assert.equal(timers.size,1)
for(const effect of views.get('b').effects)effect.cleanup?.();assert.equal(timers.size,0)
console.log('PASS #174: persistent paired subscribers, one poll/single-flight, action/background broadcast, strict nested missingness, historical error recovery and final unmount cleanup')
