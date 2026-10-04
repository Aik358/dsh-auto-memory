// Load the whole shipped browser factory. Expose closure-local components only
// in the VM test copy; hooks/DOM/HTTP are controlled boundaries, not a browser.
import fs from 'node:fs/promises'
import vm from 'node:vm'
export async function completeClient({fetch,source,react}={}) {
  source ||= await fs.readFile(process.env.DAM_CLIENT_AUDIT_SOURCE || new URL('../../lib/client.js',import.meta.url),'utf8')
  let slots=[],cursor=0,effects=[],exposed
  const React=react||{Fragment:Symbol('Fragment'),createElement:(type,props,...children)=>({type,props:{...props,children}}),cloneElement:(node,props)=>({...node,props:{...node.props,...props}}),
    useState(initial){const i=cursor++;if(!slots[i])slots[i]={value:typeof initial==='function'?initial():initial};return [slots[i].value,value=>slots[i].value=typeof value==='function'?value(slots[i].value):value]},
    useRef(initial){return React.useState(()=>({current:initial}))[0]},useReducer(fn,initial){const [state,set]=React.useState(initial);return [state,action=>set(s=>fn(s,action))]},
    useEffect(fn,deps){const i=cursor++,old=slots[i];if(!old||!deps||deps.some((d,n)=>!Object.is(d,old.deps?.[n]))){if(old?.cleanup)old.cleanup();const state=slots[i]={deps};effects.push(()=>state.cleanup=fn())}}}
  const localStorage={getItem:()=>null,setItem(){},removeItem(){},length:0}
  const document={documentElement:{getAttribute:()=>'',style:{setProperty(){}},classList:{contains:()=>false}},querySelector:()=>null,getElementById:()=>null}
  const window={localStorage,addEventListener(){},removeEventListener(){},confirm:()=>true,__ModuleLoader__:{load:def=>exposed=def.factory(name=>{if(name==='react')return React;throw Error('test module unavailable '+name)})}}
  const context=vm.createContext({window,document,localStorage,console:{log(){},warn(){},info(){},error(){}},navigator:{language:'zh-CN'},URL,URLSearchParams,requestAnimationFrame:fn=>fn(),setTimeout,clearTimeout,setInterval:()=>1,clearInterval(){},fetch:fetch||(()=>{throw Error('unexpected HTTP')})})
  source=source.replace('return { page: Iter5Page, css: ITER5_CSS }','return { page: Iter5Page, css: ITER5_CSS, note: Iter5Note, settings: Iter5Settings }')
  source=source.replace('    return module.exports',`    exports.audit = { NotesTab: NotesTab, Iter5Note: Iter5Note, Iter5Settings: Iter5Settings, legacy: LEGACY_SKIN_NS, controller: controller,
      session: function(id,ws) { sessions = { list: { getSnapshot: function() { var byId={};byId[id]={cwd:ws};return { current:id,byId:byId } } } } } }
    return module.exports`)
  vm.runInContext(source,context,{filename:'complete-production-client.js'})
  const render=(component,props={})=>{cursor=0;let tree=component(props);function unwrap(n,depth=0){if(!n||typeof n!=='object')return n;if(depth>8)throw Error('component wrapper cycle');if(Array.isArray(n))return n.map(x=>unwrap(x,depth));if(typeof n.type==='function'&&['Iter5Settings','DamSharedSettings'].includes(n.type.name))return unwrap(n.type(n.props),depth+1);if(n.props?.children)n.props.children=unwrap(n.props.children,depth);return n}tree=unwrap(tree);effects.splice(0).forEach(f=>f());return tree}
  const reset=()=>{for(const s of slots)if(s?.cleanup)s.cleanup();slots=[];cursor=0;effects=[]}
  const nodes=(tree,predicate)=>{const out=[];const walk=n=>{if(!n||typeof n!=='object')return;if(Array.isArray(n)){n.forEach(walk);return}if(predicate(n))out.push(n);walk(n.props?.children)};walk(tree);return out}
  const spin=async()=>{for(let i=0;i<12;i++)await Promise.resolve()}
  return {audit:exposed.audit,render,reset,nodes,spin,context,sharedSettings:source.includes('function DamSharedSettings(')}
}
