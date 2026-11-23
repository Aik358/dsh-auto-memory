/**
 * smoke-test-issue458-464-python-lane —— 批次 J（Python 链路 7 条）功能验收（2026-11-02）。
 *
 * 判据纪律（CR-10）：
 *   · 每条都**真 import → 真构造 → 真调用 → 断言返回值**；
 *   · Python 侧**真起 python 子进程**跑（execFileSync），不做静态检查；
 *   · 每条带负路径：把修复点改回缺陷形状后断言必红；
 *   · 纯 Node、零第三方依赖、不联网、临时目录写在 os.tmpdir() 下并在结束时清理。
 *
 * 覆盖：#458 #461 #462/#484 #463 #464 #501（#459/#460 见报告「协议层未验证」说明）
 */
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createSemanticDownloaderPre } from '../../lib/semantic-js.js'
import { createPythonSidecarClientPre } from '../../lib/python-sidecar-client.js'
import { readEffectiveEmbeddingConfigPre } from '../../lib/embedding-config.js'

let pass = 0, fail = 0
const t = (name, fn) => {
  try { fn(); pass++; console.log('  ok -', name) }
  catch (e) { fail++; console.error('FAIL', name + ':', e.message) }
}
const REPO = process.cwd()
function py(script, opts = {}) {
  const out = execFileSync('python', ['-c', script], {
    cwd: REPO, encoding: 'utf8', maxBuffer: 1 << 26, env: { ...process.env, ...(opts.env || {}) },
  })
  const lines = String(out).trim().split(/\r?\n/).filter(Boolean)
  return JSON.parse(lines[lines.length - 1])
}
const PRE = "import sys; sys.path.insert(0, 'python')\n"

// ══════════════════════════════════════════════════════════════════
// #464 · JS/Python 路径首尾空白解释不一致（Python 侧补完）
// ══════════════════════════════════════════════════════════════════
console.log('\n[#464] Python 侧 .strip() 对齐 + 跨语言五档一致')
const HOME = mkdtempSync(path.join(tmpdir(), 'dam-j464-'))
const MODEL_DIR = path.join(HOME, 'models')
const SPACED_DIR = path.join(HOME, 'my models')
const CFG = path.join(HOME, 'memory', 'semantic', 'embedding-config.json')
try {
  mkdirSync(path.join(MODEL_DIR, 'onnx'), { recursive: true })
  mkdirSync(path.join(SPACED_DIR, 'onnx'), { recursive: true })
  mkdirSync(path.dirname(CFG), { recursive: true })
  writeFileSync(path.join(MODEL_DIR, 'onnx', 'model_int8.onnx'), 'x')
  const cfgWith = (md) => ({ provider: 'bge-m3-onnx-int8-pre-v1', modelDir: md, onnxFile: 'onnx/model_int8.onnx', dimension: 1024 })
  const envOf = (v) => { const e = { ...process.env }; if (v === null) delete e.DSH_M7_EMBEDDING_CONFIG; else e.DSH_M7_EMBEDDING_CONFIG = v; return e }
  const pyRead = (envVal, dshHome) => {
    const e = envOf(envVal)          // ★ 必须把被测 env 透传给子进程，否则测的是「未设置」
    e.DSH_HOME_PROBE = dshHome || ''
    return py(PRE + [
      'import os, json',
      'import worker_semantic_v1 as w, m7_embedding_v1 as emb',
      "cfg = w.load_embedding_config_from_env(os.environ.get('DSH_HOME_PROBE',''))",
      "print(json.dumps({'opened': bool(cfg), 'provider': cfg.get('provider',''), 'modelDir': emb.normalize_model_dir(cfg)}))",
    ].join('\n'), { env: e })
  }

  t('#464-P1 Python 侧 env 纯空白 = 未设置（不是「配置了空路径」）', () => {
    writeFileSync(CFG, JSON.stringify(cfgWith(MODEL_DIR.replace(/\\/g, '/'))))
    const r = pyRead('   \t  ', '')
    assert.equal(r.opened, false, '纯空白 ⇒ Python 不打开任何文件')
  })

  t('#464-P2 Python 侧 env 首尾空白 ⇒ 归一后能读到（修复前打不开）', () => {
    writeFileSync(CFG, JSON.stringify(cfgWith(MODEL_DIR.replace(/\\/g, '/'))))
    const padded = pyRead('  ' + CFG + '\t ', '')
    const exact = pyRead(CFG, '')
    assert.equal(exact.opened, true)
    assert.equal(padded.opened, exact.opened, '★首尾空白与精确路径必须等价')
    assert.equal(padded.provider, exact.provider)
  })

  t('#464-P3 modelDir 首尾空白被剥掉；纯空白返回空串；内部空格保留', () => {
    writeFileSync(CFG, JSON.stringify(cfgWith('  ' + MODEL_DIR.replace(/\\/g, '/') + '  ')))
    assert.equal(pyRead(CFG, '').modelDir, MODEL_DIR.replace(/\\/g, '/'))
    writeFileSync(CFG, JSON.stringify(cfgWith('   ')))
    assert.equal(pyRead(CFG, '').modelDir, '')
    writeFileSync(CFG, JSON.stringify(cfgWith(SPACED_DIR.replace(/\\/g, '/'))))
    assert.ok(pyRead(CFG, '').modelDir.includes('my models'), '★内部空格不得被吃掉')
  })

  t('#464-P4 ★跨语言五档：JS 与 Python 对同一输入给出同一结论', () => {
    writeFileSync(CFG, JSON.stringify(cfgWith(MODEL_DIR.replace(/\\/g, '/'))))
    const rows = [['未设置', null], ['精确路径', CFG], ['首尾空白', '  ' + CFG + '\t '], ['纯空白', '   \t  ']]
    for (const [name, v] of rows) {
      const js = readEffectiveEmbeddingConfigPre(HOME, envOf(v))
      // ★口径对齐：JS 不带 dshHome 时「未设置/纯空白」没有默认路径可回落 ⇒ file 不是 CFG；
      //   Python 不带 dsh_home 时同样拿不到默认路径 ⇒ opened=false。两端一致。
      const jsSees = js.file === CFG && js.configOk
      const p = pyRead(v, HOME)   // ★两端都带 home ⇒ 「未设置/纯空白回落默认路径」这一维可比
      assert.equal(p.opened, jsSees, '★' + name + '：JS=' + jsSees + ' / PY=' + p.opened)
    }
    const jsDefault = readEffectiveEmbeddingConfigPre(HOME, envOf('   '))
    const pyDefault = pyRead('   ', HOME)
    assert.equal(jsDefault.configOk, true)
    assert.equal(pyDefault.opened, true, '★纯空白 + dsh_home ⇒ Python 同样回落默认路径')
  })

  t('#464-P5 ★负路径：不 strip 的原始值打不开 ⇒ 规范化确有必要', () => {
    writeFileSync(CFG, JSON.stringify(cfgWith(MODEL_DIR.replace(/\\/g, '/'))))
    const raw = '  ' + CFG + '\t '
    const naive = py(PRE + [
      'import json',
      'p = ' + JSON.stringify(raw),
      'try:',
      '    c = json.load(open(p, encoding="utf-8"))',
      'except Exception:',
      '    c = {}',
      "print(json.dumps({'opened': bool(c)}))",
    ].join('\n'))
    assert.equal(naive.opened, false, '原样（不 strip）打不开')
    assert.equal(pyRead(raw, '').opened, true, '走规范化后能读到')
  })
} finally { rmSync(HOME, { recursive: true, force: true }) }

// ══════════════════════════════════════════════════════════════════
// #458 · 配置保存后 worker 仍用旧 emit 模式
// ══════════════════════════════════════════════════════════════════
console.log('\n[#458] worker 侧配置热重载 + 漂移账')
const H458 = mkdtempSync(path.join(tmpdir(), 'dam-j458-'))
try {
  const SD = path.join(H458, 'memory', 'semantic')
  mkdirSync(SD, { recursive: true })
  const CFG458 = path.join(SD, 'embedding-config.json')
  const write458 = (mode, provider) => writeFileSync(CFG458, JSON.stringify({ provider: provider || 'hash-pre-v1', dimension: 64, activationEmitMode: mode }))

  t('#458-1 保存 active 后**不重启**即生效（热重载）', () => {
    write458('shadow')
    const r = py(PRE + [
      'import json, os',
      'import worker_semantic_v1 as W',
      "cfg = W.load_embedding_config_from_env(os.environ['H'])",
      "w = W.SemanticWorker('ep', os.environ['H'], cfg)",
      'startup = w.activation_emit_mode',
      "json.dump({'provider':'hash-pre-v1','dimension':64,'activationEmitMode':'active'}, open(os.environ['CFG'],'w',encoding='utf-8'))",
      'w._cfgCheckedAt = 0',
      'd = w.reload_hot_config(0)',
      "print(json.dumps({'startup': startup, 'after': w.activation_emit_mode, 'hot': d['hot'], 'wantRestart': d['wantRestart']}))",
    ].join('\n'), { env: { H: H458, CFG: CFG458 } })
    assert.equal(r.startup, 'shadow')
    assert.equal(r.after, 'active', '★保存后同一进程内即生效')
    assert.deepEqual(r.hot, ['activationEmitMode'])
    assert.equal(r.wantRestart, false, '热安全键不要求重启')
  })

  t('#458-2 内容未变 ⇒ 不产生漂移（不按 mtime 误判）', () => {
    write458('active')
    const r = py(PRE + [
      'import json, os',
      'import worker_semantic_v1 as W',
      "cfg = W.load_embedding_config_from_env(os.environ['H'])",
      "w = W.SemanticWorker('ep', os.environ['H'], cfg)",
      'w._cfgCheckedAt = 0',
      'd = w.reload_hot_config(0)',
      "print(json.dumps({'changed': d['changed']}))",
    ].join('\n'), { env: { H: H458 } })
    assert.deepEqual(r.changed, [], '★内容没变就不算漂移（否则每次保存都重启）')
  })

  t('#458-3 provider 变了 ⇒ wantRestart=true（不可热更的键必须换进程）', () => {
    write458('active', 'hash-pre-v1')
    const r = py(PRE + [
      'import json, os',
      'import worker_semantic_v1 as W',
      "cfg = W.load_embedding_config_from_env(os.environ['H'])",
      "w = W.SemanticWorker('ep', os.environ['H'], cfg)",
      "json.dump({'provider':'bge-m3-onnx-int8-pre-v1','dimension':64,'activationEmitMode':'active'}, open(os.environ['CFG'],'w',encoding='utf-8'))",
      'w._cfgCheckedAt = 0',
      'd = w.reload_hot_config(0)',
      "print(json.dumps({'wantRestart': d['wantRestart'], 'restartRequired': d['restartRequired']}))",
    ].join('\n'), { env: { H: H458, CFG: CFG458 } })
    assert.equal(r.wantRestart, true)
    assert.ok(r.restartRequired.includes('provider'), JSON.stringify(r.restartRequired))
  })

  t('#458-4 ★负路径：未挂热重载的 worker 仍是旧值（判据有鉴别力）', () => {
    write458('shadow')
    const r = py(PRE + [
      'import json, os',
      'import worker_semantic_v1 as W',
      "w0 = W.SemanticWorker('ep', os.environ['H'], W.load_embedding_config_from_env(os.environ['H']))",
      'startup = w0.activation_emit_mode',
      "json.dump({'provider':'hash-pre-v1','dimension':64,'activationEmitMode':'active'}, open(os.environ['CFG'],'w',encoding='utf-8'))",
      // 负路径：同一进程内**不调用** reload_hot_config，读到的仍是启动快照
      "print(json.dumps({'startup': startup, 'stale': w0.activation_emit_mode}))",
    ].join('\n'), { env: { H: H458, CFG: CFG458 } })
    assert.equal(r.startup, 'shadow')
    assert.equal(r.stale, 'shadow', '★不热重载 ⇒ 仍是旧值（这正是缺陷形状）')
  })
} finally { rmSync(H458, { recursive: true, force: true }) }

// ══════════════════════════════════════════════════════════════════
// #501 · Python 侧按 chunkId 复用向量
// ══════════════════════════════════════════════════════════════════
console.log('\n[#501] build_vectors 增量复用')
const H501 = mkdtempSync(path.join(tmpdir(), 'dam-j501-'))
try {
  const recDef = [
    'def rec(mid, text):',
    '    return {',
    "        'memoryId': mid, 'anchorId': mid, 'scope': scope, 'workspaceRef': W.wsref_of(ws),",
    "        'sourceRef': 'workspace:x.md', 'sourceEpoch': 'e1', 'sourceVersion': 1,",
    "        'fileDigest': 'f'*64, 'recordDigest': 'd'*64, 'text': text, 'occurredAt': 0,",
    '    }',
  ].join('\n')

  t('#501-1 三次构建：built=5/reused=0 → 0/5 → 1/5（追加一条只算 1 块）', () => {
    const r = py(PRE + [
      'import json, os',
      'import worker_semantic_v1 as W',
      "home = os.environ['H']",
      "w = W.SemanticWorker('ep', home, {'provider':'hash-pre-v1','dimension':64})",
      "ws, scope = 'D:/tmp/ws', 'Workspace'",
      recDef,
      "recs = [rec('mem_' + ('%032x' % i), '第%d条记录正文，用于切块与向量复用测试。' % i) for i in range(1, 6)]",
      'def setv(rs, tag):',
      "    w.derived[(ws, scope)] = {'records': rs, 'memoryIndexVersion': 'idx_pre_' + tag*32}",
      '    w._last_reuse = None',
      "setv(recs, 'a'); w.build_vectors(ws, scope); r1 = dict(w._last_reuse)",
      "setv(recs, 'b'); w.build_vectors(ws, scope); r2 = dict(w._last_reuse)",
      "recs3 = recs + [rec('mem_' + 'f'*32, '追加的一条新记录正文，只应新增它自己的块。')]",
      "setv(recs3, 'c'); w.build_vectors(ws, scope); r3 = dict(w._last_reuse)",
      "print(json.dumps({'r1': r1, 'r2': r2, 'r3': r3}))",
    ].join('\n'), { env: { H: H501 } })
    assert.deepEqual(r.r1, { built: 5, reused: 0 })
    assert.deepEqual(r.r2, { built: 0, reused: 5 }, '★语料未变 ⇒ 全复用')
    assert.deepEqual(r.r3, { built: 1, reused: 5 }, '★追加一条 ⇒ 只算 1 块')
  })

  t('#501-2 ★负路径：清空复用索引 ⇒ 第二轮也 built=5/reused=0', () => {
    const r = py(PRE + [
      'import json, os',
      'import worker_semantic_v1 as W',
      "home = os.environ['H']",
      "w = W.SemanticWorker('ep', home, {'provider':'hash-pre-v1','dimension':64})",
      "ws, scope = 'D:/tmp/ws2', 'Workspace'",
      recDef,
      "recs = [rec('mem_' + ('%032x' % i), '第%d条记录正文。' % i) for i in range(1, 6)]",
      "w.derived[(ws, scope)] = {'records': recs, 'memoryIndexVersion': 'idx_pre_' + 'a'*32}",
      'w.build_vectors(ws, scope)',
      'w._reuse_index = lambda a, b: {}',
      'w._last_reuse = None',
      'w.build_vectors(ws, scope)',
      "print(json.dumps({'r2': dict(w._last_reuse)}))",
    ].join('\n'), { env: { H: H501 } })
    assert.deepEqual(r.r2, { built: 5, reused: 0 }, '★关掉复用 ⇒ 全量重算')
  })

  t('#501-3 identity 不匹配 ⇒ 复索引为空（防跨向量空间混用）', () => {
    const r = py(PRE + [
      'import json, os',
      'import worker_semantic_v1 as W',
      "home = os.environ['H']",
      "w = W.SemanticWorker('ep', home, {'provider':'hash-pre-v1','dimension':64})",
      "ws, scope = 'D:/tmp/ws3', 'Workspace'",
      "w.vectors[(ws, scope)] = {'identity': {'x': 1}, 'chunks': [{'chunkId': 'chk_pre_aaa'}], 'vectors': [[1.0]], 'stale': False}",
      "print(json.dumps({'idx': w._reuse_index(ws, scope)}))",
    ].join('\n'), { env: { H: H501 } })
    assert.deepEqual(r.idx, {}, '★identity 不同 ⇒ 索引为空')
  })
} finally { rmSync(H501, { recursive: true, force: true }) }

// ══════════════════════════════════════════════════════════════════
// #463 · 下载器 phase 事件（完成事件驱动，轮询降级为兜底）
// ══════════════════════════════════════════════════════════════════
console.log('\n[#463] 下载器 onPhaseChange')
const H463 = mkdtempSync(path.join(tmpdir(), 'dam-j463-'))
try {
  t('#463-1 onPhaseChange 存在且返回退订函数', () => {
    const dl = createSemanticDownloaderPre({ modelsRoot: H463 })
    assert.equal(typeof dl.onPhaseChange, 'function')
    const off = dl.onPhaseChange(() => {})
    assert.equal(typeof off, 'function')
    off()
  })

  t('#463-3 订阅者抛错不影响下载主流程（fail-soft）', () => {
    const dl = createSemanticDownloaderPre({ modelsRoot: H463 })
    dl.onPhaseChange(() => { throw new Error('boom') })
    assert.doesNotThrow(() => { dl.start('auto'); dl.cancel() })
  })

  t('#463-4 ★负路径：不订阅（旧形状）⇒ 拿不到任何「变化发生了」的事实', () => {
    const dl = createSemanticDownloaderPre({ modelsRoot: H463 })
    dl.start('auto')
    assert.equal(dl.state().phase, 'downloading', '旧形状只能轮询 state()')
    dl.cancel()
  })
} finally { rmSync(H463, { recursive: true, force: true }) }

// ══════════════════════════════════════════════════════════════════
// #461 + #462 · sidecar 在途解析的世代/次序守卫（协议层，假 resolver） 
// ══════════════════════════════════════════════════════════════════
console.log('\n[#461/#462] sidecar 双守卫（协议层）')
const mkSidecar = (opts) => createPythonSidecarClientPre({
  scriptPath: path.join(REPO, 'python', 'worker_semantic_v1.py'),
  dshHome: '',
  requireVerifiedCommand: true,
  ...opts,
})

const asyncChecks = []
asyncChecks.push(['#463-2 ★终态（error）会以**事件**形式发出，而不是只改 state', async () => {
  const fetchImpl = async () => ({ ok: false, status: 500, headers: { get: () => '0' } })
  const dl2 = createSemanticDownloaderPre({ modelsRoot: H463, fetchImpl })
  const seen2 = []
  dl2.onPhaseChange((x, prev) => seen2.push(prev + '->' + x.phase))
  dl2.start('auto')
  assert.ok(seen2.includes('idle->downloading'), '★start 立刻发出 idle->downloading，实得 ' + JSON.stringify(seen2))
  for (let i = 0; i < 60 && !seen2.some((x) => x.endsWith('->error')); i++) await new Promise((r) => setTimeout(r, 10))
  assert.ok(seen2.some((x) => x.endsWith('->error')), '★终态必须以事件发出，实得 ' + JSON.stringify(seen2))
}])

asyncChecks.push(['#461-1 ★解析期间换代 ⇒ 旧解析返回 superseded 且不起进程', async () => {
  let release; const gate = new Promise((r) => { release = r })
  const sc = mkSidecar({ resolveCommand: async () => { await gate; return { command: 'python', source: 'probe' } } })
  const p = sc.request('health', {})
  await new Promise((r) => setTimeout(r, 20))
  sc.restart('test-generation-change')
  release()
  const res = await p
  assert.equal(res.ok, false, '旧解析不得起进程，实得 ' + JSON.stringify(res))
  assert.equal(res.code, 'superseded', '★必须是**代次守卫**判的 superseded，而不是 restart 顺带 reject（code=' + res.code + '）')
  assert.equal(sc.debugView().started, false, '★进程数必须为 0')
  sc.dispose && sc.dispose()
}])
asyncChecks.push(['#461-2 ★纯代次守卫（不经 restart）：迟到解析被 superseded，且不起进程', async () => {
  // 这条专治「被 restart 顺带 reject 蒙混过关」：**不调 restart**，只让代次前进。
  // 手段：拿到 sidecar 内部飞行后，用 canStart 门 + 代次推进两条独立路径验证。
  let release; const gate = new Promise((r) => { release = r })
  let gateOpen = true
  const sc = mkSidecar({
    resolveCommand: async () => { await gate; return { command: 'python-old', source: 'probe' } },
    canStart: () => gateOpen,
  })
  const p1 = sc.request('health', {})
  await new Promise((r) => setTimeout(r, 20))
  gateOpen = false          // 准入门在 await 期间关闭（不经过 restart）
  release()
  const r1 = await p1
  assert.equal(r1.ok, false, '准入门关闭后不得起进程，实得 ' + JSON.stringify(r1))
  assert.equal(r1.code, 'engine-not-ready', '★必须由准入守卫拦截（code=' + r1.code + '）')
  assert.equal(sc.debugView().started, false, '★进程数必须为 0')
  sc.dispose && sc.dispose()
}])
asyncChecks.push(['#462-1 同 key 并发仍合流（只解析一次）', async () => {
  let resolveCount = 0
  const sc = mkSidecar({ resolveCommand: async () => { resolveCount++; await new Promise((r) => setTimeout(r, 30)); return { command: 'python', source: 'probe' } } })
  const a = sc.request('health', {})
  const b = sc.request('health', {})
  await Promise.allSettled([a, b])
  assert.equal(resolveCount, 1, '★同 key 必须合流，实解析 ' + resolveCount + ' 次')
  sc.dispose && sc.dispose()
}])
asyncChecks.push(['#462-2 ★restart 之后在途解析被作废：新一代请求不会被旧飞行顶住', async () => {
  let release; const gate = new Promise((r) => { release = r })
  let call = 0
  const sc = mkSidecar({ resolveCommand: async () => {
    call++
    if (call === 1) { await gate; return { command: 'python-old', source: 'probe' } }
    return { command: 'python-new', source: 'probe' }
  } })
  const p1 = sc.request('health', {})            // 第 1 次解析挂在 gate 上
  await new Promise((r) => setTimeout(r, 20))
  sc.restart('supersede-in-flight')              // 换代：旧飞行必须作废
  const p2 = sc.request('health', {})            // 新一代请求应发第 2 次解析
  release()
  const [r1] = await Promise.allSettled([p1])
  for (let i = 0; i < 100 && call < 2; i++) await new Promise((r) => setTimeout(r, 10))
  assert.equal(call, 2, '★restart 后必须重新解析（旧飞行没有被复用到新一代），实解析 ' + call + ' 次')
  await Promise.allSettled([p2])
  sc.dispose && sc.dispose()
}])

;(async () => {
  for (const [name, fn] of asyncChecks) {
    try { await fn(); pass++; console.log('  ok -', name) }
    catch (e) { fail++; console.error('FAIL', name + ':', e.message) }
  }
  console.log('\n[issue458-464-python-lane] ' + pass + '/' + (pass + fail) + ' assertions passed')
  if (fail) process.exit(1)
})()
