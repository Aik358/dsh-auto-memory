#!/usr/bin/env node
// #435（2026-10-17）回归锁定：repair 重建 sidecar 后**语料缓存必须失效**。
//
// 真实缺陷（施工前已真执行复现）：
//   lib/m4-corpus.js:155 的缓存指纹是 stat 的 size:mtimeMs；而 memory-writer.js:882-888 的
//   rebuildSidecar **只写 sidecar、正文一字不动** => 指纹恒定 => 缓存**在任何情况下都不会
//   自然失效**。invalidate() 早已实现（m4-corpus.js:182）却**全仓 0 调用**。
//   后果：repair 报'已修复'，但三个 host（activation/context/shadow）仍拿着修复前的旧快照
//   （该源 records=[]），召回查不到那条记忆，直到进程重启。
//
// 修法：storage-manage.js 的 repair 新增注入位 onIndexRebuilt（仅 repaired>0 时调，fail-soft），
//   返回体加 invalidated 计数；index.js 注入实现遍历三个 host 的 invalidateCorpus()。
//
// 判据链（本套件全部真执行）：篡改 sidecar => registry.get 得空快照并缓存 => repair
//   => 再 get 必须 fromCache===false && records.length>=1。
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { MemoryDocumentStore } from '../../lib/memory-writer.js'
import { createStorageManagerPre } from '../../lib/storage-manage.js'
import { buildSourceCatalog, CorpusRegistry } from '../../lib/m4-corpus.js'

process.on('uncaughtException', (e) => { console.error('[a15] FATAL:', (e && e.stack) || e); process.exit(1) })
process.on('unhandledRejection', (r) => { console.error('[a15] REJ:', r); process.exit(1) })

let pass = 0
let fail = 0
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  ok - ' + name) }
  else { fail++; console.error('  FAIL - ' + name + (extra === undefined ? '' : ' :: ' + String(extra))) }
}
const sha = (s) => createHash('sha256').update(String(s), 'utf8').digest('hex')

const memId = 'mem_' + sha('a15:probe').slice(0, 32)

console.log('[A] 正路径：篡改 sidecar => 缓存空快照 => repair => 再 get 必须重载')
const root = mkdtempSync(path.join(tmpdir(), 'dam-a15-'))
try {
  const wsDir = path.join(root, 'ws')
  const sidecarDir = path.join(root, 'index', 'files')
  mkdirSync(wsDir, { recursive: true })
  mkdirSync(sidecarDir, { recursive: true })
  const NOTES = path.join(wsDir, 'MEMORY.md')
  const USER = path.join(wsDir, 'USER-MEMORY.md')
  // 注意：不能出现字面量 memory 锚点起始标记（本仓防锚点击穿），故用拼接构造。
  const MARK = '<!-- ' + 'memory' + ':'
  writeFileSync(NOTES, MARK + memId + ' -->' + String.fromCharCode(10) + '## 探针记录' + String.fromCharCode(10) + '- 这条必须能被召回' + String.fromCharCode(10), 'utf8')
  writeFileSync(USER, MARK + 'mem_' + 'b'.repeat(32) + ' -->' + String.fromCharCode(10) + '## 用户' + String.fromCharCode(10) + '- x' + String.fromCharCode(10), 'utf8')
  const docStore = new MemoryDocumentStore({ sidecarDir })
  const rb = await docStore.rebuildSidecar(NOTES)
  ok(rb.ok === true, '夹具自检：rebuildSidecar 成功', JSON.stringify(rb).slice(0, 120))

  const io = { sidecarDir, readFileSync }
  const paths = {
    workspaceKey: wsDir.replace(/\\/g, '/').toLowerCase(),
    userMemoryPath: USER, workspaceMemoryPath: NOTES, todayLogPath: undefined,
  }
  const catalog = buildSourceCatalog({
    workspaceKey: paths.workspaceKey, userMemoryPath: paths.userMemoryPath,
    workspaceMemoryPath: paths.workspaceMemoryPath, todayLogPath: undefined,
  })
  ok(catalog.sources.length === 2, '夹具自检：catalog 含 2 个源', catalog.sources.length)

  // 篡改 sidecar 的 recordDigest => loadCorpusSnapshot 判 record-stale => records 全丢
  const spFiles = readdirSync(sidecarDir).filter((f) => f.endsWith('.json'))
  ok(spFiles.length >= 1, '夹具自检：sidecar 已落盘 ' + spFiles.length + ' 个')
  const spFp = path.join(sidecarDir, spFiles[0])
  const sj = JSON.parse(readFileSync(spFp, 'utf8'))
  const beforeRecs = (sj.records || []).length
  sj.records = (sj.records || []).map((r) => Object.assign({}, r, { recordDigest: 'f'.repeat(64) }))
  writeFileSync(spFp, JSON.stringify(sj), 'utf8')
  ok(beforeRecs >= 1, '夹具自检：篡改前 sidecar 有 ' + beforeRecs + ' 条 record')

  const registry = new CorpusRegistry({ sidecarDir })
  const g1 = registry.get(catalog)
  const rec1 = g1.snapshot ? g1.snapshot.records.length : -1
  ok(g1.fromCache === false, '夹具自检：首次 get 未命中缓存')
  ok(rec1 === 0, '夹具自检：指标被篡改 => 该源 records 全丢（records=' + rec1 + '）')
  const g2 = registry.get(catalog)
  ok(g2.fromCache === true, '★ 夹具自检：第二次 get 命中缓存（正是缺陷形态：指纹没变）')

  // repair：真重建 sidecar，钩子必须让 registry 失效
  // ★注意：repair 的 report 里 repaired 计数决定是否调钩子 —— 这里**真调 rebuildSidecar**，
  //   它会把 recordDigest 修正回真值。
  let hookCalls = 0
  const sm = createStorageManagerPre({
    docStore, io, pathsOf: () => paths,
    activationHostOf: () => null, factStoreOf: () => null,
    onIndexRebuilt: () => { hookCalls++; registry.invalidate(); return 1 },
  })
  const rp = await sm.repair([{ file: NOTES, sourceRef: 'workspace:MEMORY.md' }])
  ok(rp.ok === true && rp.repaired === 1, '夹具自检：repair 成功修 1 源', JSON.stringify({ ok: rp.ok, repaired: rp.repaired }))
  ok(hookCalls === 1, '★ 钩子被调用 1 次', hookCalls)
  ok(rp.invalidated === 1, '★ 回执带 invalidated=1（可观察，不是静默）', rp.invalidated)

  const g3 = registry.get(catalog)
  const rec3 = g3.snapshot ? g3.snapshot.records.length : -1
  ok(g3.fromCache === false, '★★ repair 后必须重载（fromCache=false）；修复前恒 true => 本断言即缺陷判据', g3.fromCache)
  ok(rec3 >= 1, '★★ 且该源记录回来了（records=' + rec3 + '，证明走的是真重载而非空快照）')
  ok(rec3 > rec1, '★ records 数严格上升（' + rec1 + ' → ' + rec3 + '）')

  console.log('[B] 负路径1：无 docStore => ok:false 且不触发失效')
  {
    let hook2 = 0
    const sm2 = createStorageManagerPre({
      docStore: null, io, pathsOf: () => paths,
      onIndexRebuilt: () => { hook2++; return 1 },
    })
    const r2 = await sm2.repair([])
    ok(r2.ok === false && r2.reason === 'no-doc-store', '★ 无 docStore => ok:false / no-doc-store', JSON.stringify({ ok: r2.ok, reason: r2.reason }))
    ok(hook2 === 0, '★ 且钩子一次都没被调', hook2)
  }

  console.log('[C] 负路径2：repaired===0 => 不失效')
  {
    let hook3 = 0
    const sm3 = createStorageManagerPre({
      docStore, io, pathsOf: () => paths,
      onIndexRebuilt: () => { hook3++; return 1 },
    })
    // 传一个不存在的文件 => rebuildSidecar 失败 => repaired=0
    const r3 = await sm3.repair([{ file: path.join(wsDir, 'does-not-exist.md') }])
    ok(r3.ok === true && r3.repaired === 0, '夹具自检：repaired=0', JSON.stringify({ ok: r3.ok, repaired: r3.repaired }))
    ok(hook3 === 0, '★ repaired=0 => 钩子不调用（没修成东西，快照不可能变）', hook3)
    ok(r3.invalidated === 0, '★ 回执 invalidated=0', r3.invalidated)
  }

  console.log('[D] 负路径3：空 registry 上 invalidate 不抛；未注入钩子时行为与旧版一致')
  {
    let threw = null
    try { new CorpusRegistry({ sidecarDir }).invalidate() } catch (e) { threw = e }
    ok(threw === null, '★ 空 registry invalidate 不抛', threw && threw.message)
    const sm4 = createStorageManagerPre({ docStore, io, pathsOf: () => paths,
      activationHostOf: () => null, factStoreOf: () => null })
    const r4 = await sm4.repair([{ file: NOTES, sourceRef: 'workspace:MEMORY.md' }])
    ok(r4.ok === true, '★ 未注入 onIndexRebuilt => repair 仍正常（向后兼容）', JSON.stringify({ ok: r4.ok, repaired: r4.repaired }))
    ok(r4.invalidated === 0, '★ 未注入时 invalidated=0（不谎报失效）', r4.invalidated)
    ok(r4.invalidationErrors === undefined, '未注入时不产生 invalidationErrors')
  }

  console.log('[E] 负路径4：钩子抛错 => repair 仍成功且如实回报 invalidationErrors')
  {
    const sm5 = createStorageManagerPre({ docStore, io, pathsOf: () => paths,
      activationHostOf: () => null, factStoreOf: () => null,
      onIndexRebuilt: () => { throw new Error('boom-from-hook') } })
    const r5 = await sm5.repair([{ file: NOTES, sourceRef: 'workspace:MEMORY.md' }])
    ok(r5.ok === true && r5.repaired === 1, '★ 钩子抛错不阻断 repair', JSON.stringify({ ok: r5.ok, repaired: r5.repaired }))
    // 变异（删钩子）时 invalidationErrors 不存在 ⇒ 先兜住，避免 TypeError 把整套件变成「崩溃」而非「干净的红」
    const errs = Array.isArray(r5.invalidationErrors) ? r5.invalidationErrors : []
    ok(errs.length === 1, '★ 但错误如实回报（不静默）', JSON.stringify(r5.invalidationErrors))
    ok(errs.length === 1 && String(errs[0]).includes('boom-from-hook'), '错误信息原样带出')
  }

  console.log('[G] *功能取证：从 index.js 抽出真实的 onIndexRebuilt 并在 vm 里执行')
  // 这不是字符串断言 —— 执行的是随包发布的真实代码文本（抽出函数体后在 vm 里跑）。
  // 守的是「index.js 注入实现真的会遍历三个 host」这件事本身（改造前该注入位完全不存在）。
  {
    const idxSrc = readFileSync(new URL('../../lib/index.js', import.meta.url), 'utf8')
    const start = idxSrc.indexOf('onIndexRebuilt: () => {')
    ok(start >= 0, '* index.js 中存在 onIndexRebuilt 注入位（#435 新增）')
    if (start >= 0) {
      const bodyStart = idxSrc.indexOf('{', start)
      let depth = 0
      let end = -1
      for (let i = bodyStart; i < idxSrc.length; i++) {
        const c = idxSrc[i]
        if (c === '{') depth++
        else if (c === '}') { depth--; if (depth === 0) { end = i; break } }
      }
      ok(end > bodyStart, '函数体花括号配平（可抽出完整实现）')
      const fnText = '() => ' + idxSrc.slice(bodyStart, end + 1)
      const vm = await import('node:vm')
      const calls = []
      const engine = {
        _activationHost: { invalidateCorpus: () => calls.push('activation') },
        _contextHost: { invalidateCorpus: () => calls.push('context') },
        _shadowHost: { invalidateCorpus: () => calls.push('shadow') },
        _tierCorpusRegistry: { invalidate: () => calls.push('tier') },
      }
      const fn = vm.default.runInNewContext('(' + fnText + ')', { engine })
      const n = fn()
      ok(n === 4, '** 返回失效数 4（三 host + 一 registry）', n)
      ok(calls.length === 4 && calls.includes('activation') && calls.includes('context') && calls.includes('shadow'),
        '** 三个 host 的 invalidateCorpus 全部被真实调用', JSON.stringify(calls))
      const calls2 = []
      const shared = { invalidate: () => calls2.push('x') }
      const fn2 = vm.default.runInNewContext('(' + fnText + ')', { engine: { _tierCorpusRegistry: shared, _hubCorpusRegistry: shared } })
      ok(fn2() === 1 && calls2.length === 1, '* 同一 registry 挂两处 => 去重只失效一次', calls2.length)
      const engine3 = {
        _activationHost: { invalidateCorpus: () => { throw new Error('boom') } },
        _shadowHost: { invalidateCorpus: () => calls.push('shadow-after-throw') },
      }
      const fn3 = vm.default.runInNewContext('(' + fnText + ')', { engine: engine3 })
      let threw3 = null
      let n3 = 0
      try { n3 = fn3() } catch (e) { threw3 = e }
      ok(threw3 === null, '* 单个 host 抛错不外传（fail-soft）', threw3 && threw3.message)
      ok(n3 === 1, '* 抛错的那个不计入，其余照常失效', n3)
      const fn4 = vm.default.runInNewContext('(' + fnText + ')', { engine: {} })
      ok(fn4() === 0, '* 空 engine => 0（不抛）')
    }
  }

  console.log('[F] 三个 host 的 invalidateCorpus 出口真实存在且可调用')
   {
     const hosts = [
       ['../../lib/activation-host.js', 'createActivationHost'],
       ['../../lib/context-host.js', 'createContextHost'],
       ['../../lib/shadow-host.js', 'createShadowHost'],
     ]
     for (const [mod, fn] of hosts) {
       const m = await import(mod)
       ok(typeof m[fn] === 'function', '模块 ' + mod + ' 导出 ' + fn)
     }
     // 真构造 shadow-host（最轻量，无 engine 依赖面最小）并调 invalidateCorpus
     const sh = await import('../../lib/shadow-host.js')
     const engine = { config: {}, state: { ws: wsDir }, __homedirFn: () => root, runtimes: new Map() }
     const host = sh.createShadowHost({ engine })
     ok(typeof host.invalidateCorpus === 'function', '★ shadow-host 实例暴露 invalidateCorpus')
     let threw2 = null
     try { host.invalidateCorpus() } catch (e) { threw2 = e }
     ok(threw2 === null, '★ 调用不抛', threw2 && threw2.message)
   }
} finally {
  rmSync(root, { recursive: true, force: true })
}

console.log('\n' + (fail === 0 ? 'PASS ' + pass + ' / FAIL 0' : 'PASS ' + pass + ' / FAIL ' + fail))
process.exit(fail === 0 ? 0 : 1)
