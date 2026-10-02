import assert from 'node:assert/strict'
import vm from 'node:vm'
import {readFile} from 'node:fs/promises'
const src=await readFile(new URL('../../lib/client.js',import.meta.url),'utf8')
const start=src.indexOf('    function teamFromState(st) {'),end=src.indexOf('// ===================== L3-team:end',start)
let hook=0;const states=[], calls=[],posts=[];let copied='',continued=0,healthy=false
const sb={locale:'zh',L:(zh)=>zh,L3:(zh)=>zh,t:x=>x,useTick:()=>[0,()=>{}],useEffect:()=>{},useState:v=>{const n=hook++;if(!(n in states))states[n]=v;return [states[n],v=>{states[n]=v}]},
 h:(tag,props,...children)=>({tag,props:props||{},children}),API:{teamState:'state',teamAttribution:'attribution',teamConflicts:'conflicts',teamSyncDebug:'debug',teamControl:'control'},configOf:x=>x,
 apiGet:async url=>{calls.push(url);return {state:{enabled:true,configured:true,member:{id:'a',name:'Alice'},sync:healthy?{lastOk:12345,lastAt:12000,lastError:''}:{lastOk:null,lastError:'http-503'},pull:{since:42},outbox:{size:healthy?0:2}},attribution:{attribution:{items:[{key:'real',memberId:'a'}]}},conflicts:{conflicts:healthy?[]:[{id:'c1',scope:'plan',local:{body:'local'},remote:{body:'remote'},status:'pending'}]},debug:{sync:{lastError:'http-503'}}}[url]},
 apiPost:async(url,body)=>{posts.push({url,body});return {ok:true}},runContinueFlow:async()=>{continued++},navigator:{clipboard:{writeText:async text=>{copied=text}}},SkinSyncIllust:()=>null,Date,Promise,Object,Array,JSON,Math,String,Number}
vm.createContext(sb);vm.runInContext(src.slice(start,end)+'\nthis.exports={fetchTeamState,TeamTab,TeamDebugPanel,TeamScreensR18,TeamScreensR19,TeamSyncStatusBar,TeamLedgerScreen,TeamConflictScreen};',sb)
const [a,b]=await Promise.all([sb.exports.fetchTeamState(),sb.exports.fetchTeamState()]);assert.equal(a,b);assert.equal(calls.length,4)
assert.equal(a.team.queue,2);assert.equal(a.team.phase,'conflict');assert.equal(JSON.parse(a.team.conflictItems[0].mine).body,'local');assert.equal(typeof a.team.conflictItems[0].local,'string');assert.match(JSON.stringify(a.team.debug),/http-503/)
function render(fn,props){hook=0;return fn(props)}
const tree=render(sb.exports.TeamTab,{})
function find(tree,key){if(!tree)return null;if(Array.isArray(tree)){for(const t of tree){const r=find(t,key);if(r)return r}return null}if(tree.props?.[key]!==undefined)return tree;return find(tree.children,key)}
const r18=tree.children.find(x=>x?.tag===sb.exports.TeamScreensR18),r19=tree.children.find(x=>x?.tag===sb.exports.TeamScreensR19)
assert.ok(r18&&r19)
const pauseTree=render(sb.exports.TeamSyncStatusBar,{team:a.team,onPause:r18.props.onPause});await find(pauseTree,'data-dam-team-pause').props.onChange({target:{checked:true}});await new Promise(r=>setImmediate(r));assert.equal(posts[0].body.action,'pause')
const ledger=render(sb.exports.TeamLedgerScreen,{onTakeover:r19.props.onTakeover});await find(ledger,'data-dam-team-takeover').props.onClick();await new Promise(r=>setImmediate(r));assert.equal(continued,1)
// Separate hook state for the actual two-step reset component.
states.length=0;let debug=render(sb.exports.TeamDebugPanel,{debug:a.team.debug,onCopy:r19.props.onDebugCopy,onReset:r19.props.onDebugReset})
await find(debug,'data-dam-team-debug-copy').props.onClick();await new Promise(r=>setImmediate(r));assert.match(copied,/http-503/)
find(debug,'data-dam-team-debug-reset').props.onClick();assert.equal(posts.length,1)
debug=render(sb.exports.TeamDebugPanel,{debug:a.team.debug,onReset:r19.props.onDebugReset});find(debug,'data-dam-team-debug-reset').props.onClick();await new Promise(r=>setImmediate(r));assert.equal(posts[1].body.action,'reset-cursor');assert.equal(posts[1].body.confirm,true)
const conflictTree=render(sb.exports.TeamConflictScreen,{items:a.team.conflictItems});assert.equal(find(conflictTree,'data-dam-team-verdict-keep-local').props.disabled,true)
healthy=true;const success=await sb.exports.fetchTeamState();assert.equal(success.team.phase,'synced');assert.equal(success.team.syncAt,12345)
console.log('PASS #174: real TeamTab assembly/click handlers, single-flight real state, conflict/error/queue projection, pause/takeover/clipboard and confirmed reset')
