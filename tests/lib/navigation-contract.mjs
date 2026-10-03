import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const expectedClassic = {
  overview:'OverviewTab', logs:'Iter5History', refine:'RefineTab', hub:'MemoryHubTab',
  storage:'StorageTab', notes:'NotesTab', plan:'PlanTab', reflections:'ReflectionsTab',
  team:'TeamTab', connect:'ConnectTab', calendar:'CalendarTab', search:'SearchTab',
  workspaces:'WorkspaceTab', stats:'StatsTab', settings:'SettingsPage'
}
const h=(type,props,...children)=>({type,props:props||{},children:children.flat(Infinity).filter(Boolean)})
function nodes(tree,predicate) { return !tree||typeof tree!=='object'?[]:[...(predicate(tree)?[tree]:[]),...(tree.children||[]).flatMap(n=>nodes(n,predicate))] }

// Execute the actual navigation builders and classic body dispatcher. A missing
// button, wrong click destination or body fallback fails independently of text.
export function assertNavigationContract(client) {
  const globals={h,t:key=>key,L:(zh,en)=>en,L3:(zh,en)=>en,memoryDraftIdentity:()=> 'test-session|workspace'}
  const start=client.indexOf('    function MEMORY_TABS() {'),end=client.indexOf('    var damSettingsDrafts',start)
  assert(start>=0&&end>start)
  const bodyStart=client.indexOf('    function MemoryTabBody(tab, nonce) {'),bodyEnd=client.indexOf('    // ===================== L3-team:begin',bodyStart)
  for(const name of Object.values(expectedClassic))globals[name]=name
  const classic=vm.runInNewContext(client.slice(start,end)+'\n'+client.slice(bodyStart,bodyEnd)+'\n({MEMORY_TABS,DamClassicNavigation,MemoryTabBody,damPrimaryPage})',globals)
  assert.deepEqual(Array.from(classic.MEMORY_TABS(),r=>r[0]),Object.keys(expectedClassic).filter(key=>key!=='settings'))
  const reachable=new Set()
  for(const owner of ['overview','notes','plan','settings']) {
    let selected=''
    const tree=classic.DamClassicNavigation({tab:owner,setTab:tab=>{selected=tab}})
    const primary=nodes(tree,n=>Object.hasOwn(n.props,'data-dam-primary-nav'))[0]
    assert.deepEqual(primary.children.map(n=>n.children[0]),['Workbench','Memory','Tasks','Settings'])
    assert.equal(primary.children.length,4)
    if(owner==='settings')assert.equal(nodes(tree,n=>n.type==='button'&&n.children[0]==='Settings').length,1,'settings primary destination is not repeated in secondary navigation')
    for(const button of nodes(tree,n=>n.type==='button')) {button.props.onClick();reachable.add(selected)}
  }
  assert.deepEqual([...reachable].sort(),Object.keys(expectedClassic).sort(),'all 14 old tabs plus settings have a visible navigation path')
  for(const [tab,component] of Object.entries(expectedClassic))assert.equal(classic.MemoryTabBody(tab,1).type,component,'body dispatcher for '+tab)

  const modern=readFileSync(new URL('../../skins/iter5/ui.js',import.meta.url),'utf8')
  const frozen=readFileSync(new URL('../../skins/legacy/iter5-325.js.frozen',import.meta.url),'utf8')
  const ui=vm.runInNewContext(modern+'\n({ITER5_PAGES,iter5PageForTab,Iter5Destinations})',globals)
  const routes=['home','library','handoff','calendar','skills','recall','mindmap','storage','settings','team','stats','external']
  const modernReachable=new Set(['home','library','handoff','settings','team'])
  for(const page of routes) {
    const tree=ui.Iter5Destinations({page,nav:id=>modernReachable.add(id)})
    for(const button of nodes(tree,n=>n.type==='button'))button.props.onClick()
  }
  // Data maintenance owns the explicit maintenance-center action.
  assert(client.includes("props.onNav('storage')"))
  modernReachable.add('storage')
  assert.deepEqual([...modernReachable].sort(),routes.slice().sort())
  for(const source of [modern,frozen]) {
    const map=source.match(/var components = \{([^}]+)\}/)[1]
    const names=Object.fromEntries([...map.matchAll(/(\w+):\s*(\w+)/g)].map(m=>[m[1],m[2]]))
    assert.deepEqual(Object.keys(names).sort(),routes.slice().sort(),'all secondary pages have an actual component in each skin')
    assert.equal(names.external,'Iter5External','external never falls back to home')
    assert(source.includes("['home','library','handoff','settings'].indexOf"),'exact primary-page filter')
    const mapperStart=source.indexOf('    function iter5PageForTab(tab) {'),mapperEnd=source.indexOf('    function ',mapperStart+5)
    const mapper=vm.runInNewContext(source.slice(mapperStart,mapperEnd)+'\niter5PageForTab',{ITER5_PAGES:ui.ITER5_PAGES})
    assert.equal(mapper('connect'),'external')
    for(const row of ui.ITER5_PAGES)assert.equal(mapper(row[4]),row[0],'old route preserved: '+row[4])
  }
  return {primary:4,classicTabs:14,classicSettings:1,modernDestinations:12}
}
