import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, renameSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

globalThis.fetch = async () => { throw Error('Network is forbidden in this offline regression') }
const sourceRoot = process.env.SEMANTIC_REPAIR_ROOT || fileURLToPath(new URL('../..', import.meta.url))
const { createJsSemanticEnginePre, probeJsSemanticAssets } = await import(pathToFileURL(path.join(sourceRoot, 'lib/semantic-js.js')))
// ★本仓 CRLF：归一化后再按 LF 边界提取
const source = readFileSync(path.join(sourceRoot, 'lib/index.js'), 'utf8').replace(/\r\n/g, '\n')
// Execute the exact three production assignments together, without replacing the
// resolver/probe/JS rank with a test stub. Only the unrelated Python arm returns null. In particular l0IndexEnabled=false never embeds.
function attachHost(engine, pluginDir) {
  const take = (start, end) => {
    const a = source.indexOf(start), b = source.indexOf(end, a)
    assert(a >= 0 && b > a, 'production host wiring must remain discoverable')
    return source.slice(a, b)
  }
  const body = take('engine.semanticAssetProbe =', '// 打开即自动检测') +
    take('engine.resolveSemanticTier =', '// context-host refs') +
    take('engine._jsSemanticRank =', '// P13(') +
    take('engine._semanticRankBest =', '// JS 端判定核')
  new Function('engine', 'pluginDir', 'probeJsSemanticAssets', 'path', body)(engine, pluginDir, probeJsSemanticAssets, path)
  return engine
}
const realNow = Date.now.bind(Date)
async function until(fn) {
  const start = realNow()
  while (!fn()) {
    assert(realNow() - start < 10000, 'fake peer did not reach its barrier')
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}
function fixture() {
  const dir = mkdtempSync(path.join(tmpdir(), 'js host 恢复-')), pluginDir = path.join(dir, 'pkg', 'lib')
  const peer = path.join(dir, 'pkg', 'node_modules', '@huggingface', 'transformers')
  const models = path.join(dir, 'home', 'models', 'js-semantic'), asset = path.join(models, 'multilingual-e5-small', 'onnx', 'model_quantized.onnx')
  const controlFile = path.join(dir, 'control.json'), logFile = path.join(dir, 'calls.jsonl')
  const oldHome = process.env.DSH_HOME
  process.env.DSH_HOME = path.join(dir, 'home')
  mkdirSync(pluginDir, { recursive:true }); mkdirSync(peer, { recursive:true }); mkdirSync(path.dirname(asset), { recursive:true })
  writeFileSync(asset, 'offline fixture only')
  // The child polls this file while initialization is paused. Publish a whole
  // JSON value atomically; truncating the live file can invent a peer failure.
  const control = value => {
    const tmp = controlFile + '.tmp'
    writeFileSync(tmp, JSON.stringify(value))
    renameSync(tmp, controlFile)
  }
  control({})
  writeFileSync(path.join(peer, 'package.json'), JSON.stringify({name:'@huggingface/transformers',type:'module',main:'./index.js',exports:{'.':'./index.js'}}))
  writeFileSync(path.join(peer, 'index.js'), `
    import { readFileSync, appendFileSync } from 'node:fs'
    const read = () => JSON.parse(readFileSync(${JSON.stringify(controlFile)}, 'utf8'))
    const record = (kind,text) => appendFileSync(${JSON.stringify(logFile)}, JSON.stringify({kind,text,pid:process.pid})+'\\n')
    globalThis.DAM_HOST_RECOVERY_PEER_PID = process.pid
    record('import')
    export const env = {}
    export async function pipeline() {
      record('pipeline')
      if (env.allowRemoteModels !== false) throw Error('offline policy missing')
      while (read().initWait) await new Promise(resolve => setTimeout(resolve, 10))
      if (read().initError) throw Error('fixture init failure')
      return async text => {
        record('embed',text)
        if (text.includes('__crash__')) process.exit(17)
        if (text.includes('__disconnect__')) { process.disconnect(); return new Promise(() => {}) }
        if (text.includes('__hang__')) return new Promise(() => {})
        const data = new Float32Array(384); data[0] = 1; return {data}
      }
    }
  `)
  const semantic = createJsSemanticEnginePre({pluginDir, modelsDirCandidates:[models],peerDirCandidates:[peer], startupTimeoutMs:5000,requestTimeoutMs:200})
  const host = attachHost({config:{semanticEngineMode:'js',l0IndexEnabled:false}, _jsSemantic:semantic, _peerExtraDirs:[peer], _pySemanticRank:async()=>null}, pluginDir)
  const snap = {memoryIndexVersion:'idx_pre_'+'a'.repeat(32), records:[{memoryId:'A',text:'alpha'},{memoryId:'B',text:'beta'}]}
  const logs = () => existsSync(logFile) ? readFileSync(logFile,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : []
  const starts = () => logs().filter(row => row.kind === 'pipeline').length
  return {host,semantic,snap,control,logs,starts,peer,asset,async dispose(){
    semantic.dispose(); await until(() => logs().every(row => {try{process.kill(row.pid,0);return false}catch{return true}}))
    if(oldHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = oldHome
    rmSync(dir,{recursive:true,force:true})
  }}
}

for (const failure of ['__crash__','__disconnect__','__hang__']) await test(`normal host recall recovers ${failure} after 60s with concurrent single-flight retry`, async t => {
  const f = fixture(); let offset = 0
  t.mock.method(Date, 'now', () => realNow() + offset)
  try {
    assert((await f.host._semanticRankBest(f.snap,'warm')).scores instanceof Map)
    const pid = f.semantic.status().workerPid, passages = f.logs().filter(row=>row.text && row.text.startsWith('passage: ')).length
    assert.equal(await f.host._semanticRankBest(f.snap,failure),null)
    assert(f.semantic.status().degraded); assert.equal((await f.host.semanticAssetProbe()).ready,false)
    assert.equal(await f.host.resolveSemanticTier(),'c1')
    for (let i=0;i<8;i++) assert.equal(await f.host._semanticRankBest(f.snap,'cooldown'),null)
    assert.equal(f.starts(),1)
    offset += 60001
    // A status read cannot clear degradation, spawn, or call a healthy asset probe ready.
    assert.equal((await f.host.semanticAssetProbe()).ready,false); assert.equal(await f.host.resolveSemanticTier(),'c1')
    f.control({initWait:true})
    const recalls = Promise.all(Array.from({length:8},()=>f.host._semanticRankBest(f.snap,'ordinary recall')))
    await until(()=>f.starts()===2)
    assert.equal((await f.host.semanticAssetProbe()).ready,false,'Pending recovery remains degraded')
    f.control({})
    const results = await recalls
    assert(results.every(result=>result && result.scores instanceof Map && result.scores.size===2))
    assert.equal(f.starts(),2); assert.notEqual(f.semantic.status().workerPid,pid)
    assert.equal(f.semantic.status().degradedRetries,1); assert.equal(await f.host.resolveSemanticTier(),'c2')
    assert.equal(f.semantic.status().degraded,''); assert.equal(globalThis.DAM_HOST_RECOVERY_PEER_PID,undefined)
    assert(f.logs().filter(row=>row.text && row.text.startsWith('passage: ')).length === passages, 'Host cache is retained across restart')
    const cached = await f.host._semanticRankBest(f.snap,'cached'); assert.equal(cached.scores.get('A'),1)
  } finally {await f.dispose()}
})

await test('failed host retry restarts cooldown; no storms and a later ordinary recall can recover', async t => {
  const f=fixture();let offset=0;t.mock.method(Date,'now',()=>realNow()+offset)
  try {
    await f.host._semanticRankBest(f.snap,'warm'); await f.host._semanticRankBest(f.snap,'__crash__'); offset+=60001
    f.control({initError:true})
    const results=await Promise.all(Array.from({length:8},()=>f.host._semanticRankBest(f.snap,'retry')))
    assert(results.every(result=>result===null));assert.equal(f.starts(),2)
    const failedAt=f.semantic.status().degradedAt
    f.control({})
    for(let i=0;i<8;i++) assert.equal(await f.host._semanticRankBest(f.snap,'cooldown'),null)
    assert.equal(f.starts(),2);assert.equal(f.semantic.status().degradedAt,failedAt)
    offset+=60001
    assert((await f.host._semanticRankBest(f.snap,'later')).scores instanceof Map);assert.equal(f.starts(),3)
  }finally{await f.dispose()}
})

await test('missing model/peer and non-JS modes never enter the expired runtime retry',async t=>{
  const f=fixture();let offset=0;t.mock.method(Date,'now',()=>realNow()+offset)
  try{
    await f.host._semanticRankBest(f.snap,'warm');await f.host._semanticRankBest(f.snap,'__crash__');offset+=60001
    for(const file of [f.asset,f.peer]){
      renameSync(file,file+'.held')
      assert.equal(await f.host._semanticRankBest(f.snap,'missing'),null);assert.equal(f.starts(),1)
      assert.equal((await f.host.semanticAssetProbe()).filesReady,false)
      renameSync(file+'.held',file)
    }
    f.host.config.semanticEngineMode='lexical'
    assert.equal(await f.host._semanticRankBest(f.snap,'lexical'),null);assert.equal(f.starts(),1)
    f.host.config.semanticEngineMode='auto'
    assert((await f.host._semanticRankBest(f.snap,'restored')).scores instanceof Map);assert.equal(f.starts(),2)
  }finally{await f.dispose()}
})

await test('disposed host remains unready and cannot revive, including disposal during retry',async t=>{
  for(const state of ['healthy','degraded','retrying']){
    const f=fixture();let offset=0;t.mock.method(Date,'now',()=>realNow()+offset)
    try{
      await f.host._semanticRankBest(f.snap,'warm')
      if(state !== 'healthy') await f.host._semanticRankBest(f.snap,'__crash__')
      offset+=60001
      let pending
      if(state === 'retrying'){f.control({initWait:true});pending=f.host._semanticRankBest(f.snap,'retry');await until(()=>f.starts()===2)}
      f.semantic.dispose();if(pending)assert.equal(await pending,null)
      const starts=f.starts()
      assert.equal((await f.host.semanticAssetProbe()).ready,false);assert.equal(await f.host.resolveSemanticTier(),'c1')
      for(let i=0;i<8;i++)assert.equal(await f.host._semanticRankBest(f.snap,'disposed'),null)
      assert.equal(f.starts(),starts)
    }finally{await f.dispose();t.mock.restoreAll()}
  }
})
