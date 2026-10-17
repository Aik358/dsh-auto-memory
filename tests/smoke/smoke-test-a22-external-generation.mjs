#!/usr/bin/env node
/**
 * smoke-test-a22-external-generation.mjs —— #442（A22）外部来源关闭期间旧扫描仍可发布。
 *
 * ## 缺陷（issue 的三处独立缺口，缺一都复现）
 *  ① 配置保存**无缓存失效**：saveConfig 只给 team 建 epoch，externalSources 改了无人知晓
 *     ⇒ 旧 cache 与在途扫描的产物继续被消费。
 *  ② `discover(force)` 的 force **排在「复用在途 Promise」之后，等于失效**：
 *     配置刚关掉某源并调 discover(true)，拿回的正是按旧配置扫的那条在途 Promise。
 *  ③ 发布与消费都不按当前配置过滤：cache 无条件写、search/injectionText/importInto/注入段直用。
 *  实测症状：enabledNow=false，但 cachedSources 仍含该源、searchHits 仍命中它。
 *
 * ## 验收方式（真执行）
 * 从 `lib/index.js` 抽出**产线**的 `class ExternalMemory`（含 discover / enabled /
 * filterEnabledPre / invalidatePre / injectionText / search），真构造实例，**把 IO 面
 * （homedir/stat/readFile/globOne/listSessionFiles/listMdFiles）换成可控夹具** ⇒
 * 真实走一遍「扫描中关源 / 旧扫描发布 / 消费面读取」的完整时序。
 * `_externalSourcesChangedPre` 从源码抽取后真执行（它是 saveConfig 的判据）。
 *
 * ## 判据
 *  正路径：A 开 B 关 ⇒ discover 不含 B；关 A 后 epoch 递增且 discover(true) 新起扫描（不是同一 Promise）
 *  负路径：① 在途扫描（readFile 挂起期间关源 + 放行）⇒ cache 不含该源、返回不含它
 *          ② 构造 cache=[已禁用源] ⇒ search 与 injectionText 都不含；summarize 仍列出它（enabled:false）
 *          ③ force=true 不得返回同一 Promise
 *          ④ externalSources 未变 ⇒ 不递增 epoch（防每次保存全量重扫）
 *  变异负路径（自带）：去掉 force 的「不复用在途」判据 ⇒ ③ 红；去掉 gen 判据 ⇒ ① 红；
 *                      去掉消费面过滤 ⇒ ② 红。
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SRC = readFileSync(path.resolve(HERE, '..', '..', 'lib', 'index.js'), 'utf8')

let pass = 0, fail = 0
const ok = (c, n, x) => { if (c) { pass++; console.log('  ok - ' + n) } else { fail++; console.error('  FAIL - ' + n + (x == null ? '' : ' << ' + x)) } }

// ── 抽取器（纯内容锚点）──
function extractClass(src, header) {
  const a = src.indexOf(header)
  if (a < 0) throw new Error('class not found: ' + header)
  let depth = 0, started = false
  for (let i = a + header.length - 1; i < src.length; i++) {
    if (src[i] === '{') { depth++; started = true }
    else if (src[i] === '}') { depth--; if (started && depth === 0) return src.slice(a, i + 1) }
  }
  throw new Error('unbalanced class: ' + header)
}
function extractFn(src, header) {
  const a = src.indexOf(header)
  if (a < 0) throw new Error('function not found: ' + header)
  let depth = 0, started = false
  for (let i = a + header.length - 1; i < src.length; i++) {
    if (src[i] === '{') { depth++; started = true }
    else if (src[i] === '}') { depth--; if (started && depth === 0) return src.slice(a, i + 1) }
  }
  throw new Error('unbalanced function: ' + header)
}

const CLASS_SRC = extractClass(SRC, 'class ExternalMemory {')
const CHANGED_SRC = extractFn(SRC, 'function externalSourcesChangedPre(prev, next) {')

// ── 构建可执行副本：IO 面全部可控（其余逐字用产线代码）──
function buildSandbox(mutate) {
  let cls = CLASS_SRC
  if (mutate === 'force') cls = cls.replace('if (bucket.scanning && !force) return bucket.scanning.then((srcs) => this.filterEnabledPre(srcs))', 'if (bucket.scanning) return bucket.scanning')
  if (mutate === 'gen') cls = cls.replace('if (gen !== (this.engine._externalEpoch || 0)) return []', '')
  if (mutate === 'consume') {
    // 全部过滤点退回恒等（= 修复前的「发布与消费都不按当前配置过滤」）
    cls = cls.split('this.filterEnabledPre(').join('((x) => x)(')
  }
  if (mutate && cls === CLASS_SRC) throw new Error('mutation anchor missed: ' + mutate)
  const factory = new Function('homedir', 'stat', 'readFile', 'globOne', 'path', 'truncateHead', 'createReadStream', 'createInterface', 'extractJsonText',
    CHANGED_SRC + '\n' + cls + '\nreturn { ExternalMemory, externalSourcesChangedPre }')
  return factory
}

/** 可控 IO：fixture 控制「哪些源存在」以及「readFile 是否挂起」。 */
function makeIo(fixture) {
  const io = {
    files: fixture.files,            // PathLike 的绝对路径集合（用 posix 字符串比较）
    gates: new Map(),                // path -> {promise, release}
    reads: [],
    stat: async (p) => {
      const key = String(p)
      if (!io.files.has(key)) { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e }
      return { isFile: () => true, size: (io.files.get ? 0 : 0) || 12, mtimeMs: 1000 }
    },
    readFile: async (p) => {
      const key = String(p)
      io.reads.push(key)
      const g = io.gates.get(key)
      if (g) await g.promise
      if (!io.files.has(key)) { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e }
      return 'BODY:' + key
    },
    globOne: async () => [],
  }
  return io
}

function makeEngine(cfg) {
  return { config: cfg, state: { ws: 'D:\\ws' }, wsKey: (ws) => 'k:' + ws,
    // summarize/importStatus 会解析路径并读这两个文件；ENOENT 在产线里是「未接入」的合法形态
    resolvePaths: async () => ({ notesPath: '/tmp/notes.md', userFile: '/tmp/user.md' }) }
}
function makePathStub() {
  const posix = { join: (...a) => a.map((x) => String(x)).join('/').replace(/\/{2,}/g, '/'), basename: (p) => String(p).split('/').pop() }
  return posix
}

function newExternal(engine, io, factory) {
  const stub = { homedir: () => '/home/u', stat: io.stat, readFile: io.readFile, globOne: io.globOne, path: makePathStub(),
    truncateHead: (s, n) => String(s == null ? '' : s).slice(0, n === undefined ? 400 : n),
    createReadStream: () => { throw new Error('unused') }, createInterface: () => { throw new Error('unused') }, extractJsonText: () => '' }
  const mod = factory(stub.homedir, stub.stat, stub.readFile, stub.globOne, stub.path, stub.truncateHead,
    stub.createReadStream, stub.createInterface, stub.extractJsonText)
  const ext = new mod.ExternalMemory(engine)
  // 会话类源对本判据无关：统一空实现（产线自己也不会在没有目录时产出会话源）
  ext.listSessionFiles = async () => []
  ext.listMdFiles = async () => []
  return { ext, mod }
}

const H = '/home/u'
const KEY = {
  wbUser: H + '/.workbuddy/MEMORY.md',
  claudeGlobal: H + '/.claude/CLAUDE.md',
}
function filesWith(ids) {
  const m = new Map()
  if (ids.indexOf('workbuddy-user') >= 0) m.set(KEY.wbUser, 1)
  if (ids.indexOf('claude-global') >= 0) m.set(KEY.claudeGlobal, 1)
  return m
}
const factoryNormal = buildSandbox(null)

// ═══ 正路径 ═══
console.log('[A22-1] 正路径：A 开 B 关 ⇒ discover 不含 B')
{
  const io = makeIo({})
  io.files = filesWith(['workbuddy-user', 'claude-global'])
  const engine = makeEngine({ externalSources: { 'workbuddy-user': true, 'claude-global': false } })
  const { ext } = newExternal(engine, io, factoryNormal)
  const srcs = await ext.discover(true)
  const ids = srcs.map((s) => s.id)
  ok(ids.indexOf('workbuddy-user') >= 0, 'A22-1a 启用的源在结果里', JSON.stringify(ids))
  ok(ids.indexOf('claude-global') < 0, 'A22-1b ★ 关闭的源不在结果里', JSON.stringify(ids))
  ok(ext.cache.filter((s) => s.id === 'claude-global').length === 0, 'A22-1c cache 里也没有（扫描期即按当前配置跳过）')
}

console.log('[A22-2] 正路径：关源 ⇒ epoch 递增 + 清缓存；discover(true) 另起扫描')
{
  const io = makeIo({})
  io.files = filesWith(['workbuddy-user', 'claude-global'])
  const engine = makeEngine({ externalSources: { 'workbuddy-user': true, 'claude-global': true } })
  const { ext, mod } = newExternal(engine, io, factoryNormal)
  await ext.discover(true)
  ok(ext.cache.length === 2, 'A22-2a 两个源都在缓存里（前提）', 'len=' + ext.cache.length)
  // 模拟 saveConfig 里的失效分支（真执行抽出来的产线判据）
  const prev = { 'workbuddy-user': true, 'claude-global': true }
  const next = { 'workbuddy-user': true, 'claude-global': false }
  ok(mod.externalSourcesChangedPre(prev, next) === true, 'A22-2b ★ 子键变化 ⇒ 判据为真（真执行产线函数）')
  engine.config.externalSources = next   // 与 saveConfig 一致：先落内存配置，再失效
  engine._externalEpoch = (engine._externalEpoch || 0) + 1
  ext.invalidatePre('settings-changed')
  ok(ext.cache === undefined, 'A22-2c ★ 失效后缓存已清空', String(ext.cache))
  const srcs2 = await ext.discover(true)
  const ids2 = srcs2.map((s) => s.id)
  ok(ids2.indexOf('claude-global') < 0, 'A22-2d ★ 重扫不再包含已关闭源', JSON.stringify(ids2))
}

// ═══ 负路径①：在途扫描期间关源 ═══
console.log('[A22-3] 负路径①：在途扫描（readFile 挂起）期间关源 + 放行 ⇒ 旧结果不得发布')
{
  const io = makeIo({})
  io.files = filesWith(['workbuddy-user', 'claude-global'])
  const engine = makeEngine({ externalSources: { 'workbuddy-user': true, 'claude-global': true } })
  const { ext } = newExternal(engine, io, factoryNormal)
  // 让第一个源的 readFile 挂住，模拟「扫描正在等待 IO」
  let release
  const gate = { promise: new Promise((r) => { release = r }) }
  io.gates.set(KEY.wbUser, gate)
  const inflight = ext.discover(false)
  await new Promise((r) => setTimeout(r, 5))
  // 此刻配置关闭 workbuddy-user（模拟 saveConfig：epoch +1 + 清缓存）
  engine.config.externalSources = { 'workbuddy-user': false, 'claude-global': true }
  engine._externalEpoch = (engine._externalEpoch || 0) + 1
  ext.invalidatePre('settings-changed')
  release()
  const got = await inflight
  ok(got.map((s) => s.id).indexOf('workbuddy-user') < 0, 'A22-3a ★ 过期扫描的**返回值**不含已关闭源', JSON.stringify(got.map((s) => s.id)))
  ok(ext.cache === undefined || ext.cache.map((s) => s.id).indexOf('workbuddy-user') < 0,
    'A22-3b ★ 过期扫描**没有发布**到 cache', JSON.stringify(ext.cache && ext.cache.map((s) => s.id)))
}

// ═══ 负路径②：旧 cache 里残留已禁用源 ⇒ 消费面必须过滤，summarize 仍可见 ═══
console.log('[A22-4] 负路径②：cache 残留已禁用源 ⇒ search / injectionText 不含；summarize 仍列出（enabled:false）')
{
  const io = makeIo({})
  io.files = filesWith(['workbuddy-user'])
  const engine = makeEngine({ externalSources: { 'workbuddy-user': true, 'claude-global': false } })
  const { ext } = newExternal(engine, io, factoryNormal)
  // 直接构造「失效前写入的旧缓存」，绕过 discover（cachedAt 必须新鲜，否则被判过期而重扫）
  ext.cachedAt = Date.now()
  ext.cache = [
    { id: 'workbuddy-user', name: 'WorkBuddy 用户记忆', tool: 'WorkBuddy', kind: 'user', files: [{ path: KEY.wbUser }], content: 'CONFIDENTIAL-MARKER workbuddy body', size: 30, mtime: 1 },
    { id: 'claude-global', name: 'Claude Code 全局记忆', tool: 'Claude Code', kind: 'user', files: [{ path: KEY.claudeGlobal }], content: 'CONFIDENTIAL-MARKER claude body', size: 28, mtime: 1 },
  ]
  const hits = await ext.search('CONFIDENTIAL-MARKER', 10)
  const hitSources = hits.map((h) => h.source)
  ok(hitSources.indexOf('Claude Code 全局记忆') < 0, 'A22-4a ★ search 不再命中已禁用源', JSON.stringify(hitSources))
  ok(hitSources.indexOf('WorkBuddy 用户记忆') >= 0, 'A22-4b 启用的源仍能命中（不是把 search 整个掐掉）', JSON.stringify(hitSources))
  const inj = await ext.injectionText(2000)
  ok(inj.indexOf('Claude Code') < 0, 'A22-4c ★ injectionText 不含已禁用源', inj.slice(0, 120))
  ok(inj.indexOf('WorkBuddy') >= 0, 'A22-4d 启用的源仍在注入文本里')
  const sum = await ext.summarize()
  const sumIds = sum.map((s) => s.id)
  ok(sumIds.indexOf('claude-global') >= 0, 'A22-4e ★ summarize **不过滤**：已禁用源仍列出（前端开关行才可见）', JSON.stringify(sumIds))
  const row = sum.find((s) => s.id === 'claude-global')
  ok(row && row.enabled === false, 'A22-4f ★ 该行带 enabled:false（前端据此显示关闭态）', JSON.stringify(row && row.enabled))
  const imp = await ext.importInto('claude-global', 'project', { resolvePaths: async () => ({ notesPath: '/tmp/x.md', userFile: '/tmp/u.md' }), state: {} }, null)
  ok(String(imp).indexOf('外部源不存在') >= 0, 'A22-4g ★ importInto 拒绝接入已禁用源', String(imp).slice(0, 80))
}

// ═══ 正路径②：真执行 saveConfig 的失效分支（#442 缺口①）═══
console.log('[A22-2B] 真执行产线 saveConfig 的失效分支 ⇒ epoch 递增 + 缓存清空')
{
  // 抽取产线那一段（内容锚定；含前置 if 与三行体），包成可执行函数后**真调用**。
  const START = '    if (externalSourcesChangedPre(oldConfig.externalSources, next.externalSources)) {'
  const a = SRC.indexOf(START)
  // ★不 throw：分支缺失就是**缺陷复现**（#442 缺口① 未落地）⇒ 记 FAIL 后整节跳过，
  //   这样「回退生产代码」的实验给出可复算的 FAIL 计数，而不是一个无法归因的加载期异常。
  if (a < 0) {
    ok(false, 'A22-2B-0 ★ 产线 saveConfig 里找不到 externalSources 失效分支（缺口① 未落地）')
  } else {
  const b = SRC.indexOf('    this.config = next', a)
  if (b < 0) throw new Error('失效分支的终点锚缺失')
  const BRANCH = SRC.slice(a, b)
  const enableStart = SRC.indexOf('function externalSourcesChangedPre(prev, next) {')
  if (enableStart < 0) throw new Error('externalSourcesChangedPre 定义缺失')
  let depth = 0, started = false, enableEnd = -1
  for (let i = enableStart + 'function externalSourcesChangedPre(prev, next) {'.length - 1; i < SRC.length; i++) {
    if (SRC[i] === '{') { depth++; started = true }
    else if (SRC[i] === '}') { depth--; if (started && depth === 0) { enableEnd = i; break } }
  }
  const ENABLE = SRC.slice(enableStart, enableEnd + 1)
  const runner = new Function('oldConfig', 'next', 'engine',
    ENABLE + '\n' +
    // ★分支体里用的是 `this._externalEpoch` / `this.external` ⇒ 必须绑定到 engine 实体
    'return function () {\n' + BRANCH + '\n}')
  // 场景①：子键变化 ⇒ epoch +1 且缓存清空
  const io = makeIo({})
  io.files = filesWith(['workbuddy-user', 'claude-global'])
  const engine = makeEngine({ externalSources: { 'workbuddy-user': true, 'claude-global': true } })
  const { ext } = newExternal(engine, io, factoryNormal)
  engine.external = ext   // 产线里 engine.external 就是同一个实例（constructor 里 this.external = new ExternalMemory(this)）
  await ext.discover(true)
  ok(ext.cache.length === 2, 'A22-2B-a 前提：两源已在缓存', 'len=' + ext.cache.length)
  const oldCfg = { externalSources: { 'workbuddy-user': true, 'claude-global': true } }
  const newCfg = { externalSources: { 'workbuddy-user': true, 'claude-global': false } }
  runner(oldCfg, newCfg, engine).call(engine, engine)
  ok(engine._externalEpoch === 1, 'A22-2B-b ★ 真跑产线分支 ⇒ _externalEpoch 增到 1（改前恒 undefined）', String(engine._externalEpoch))
  ok(ext.cache === undefined, 'A22-2B-c ★ 真跑产线分支 ⇒ 外部缓存被清空', String(ext.cache))
  // 场景②：未变化 ⇒ 不递增（防每次保存全量重扫）
  const engine2 = makeEngine({ externalSources: { 'workbuddy-user': true } })
  engine2._externalEpoch = 0
  engine2.external = { invalidatePre() { engine2._invalidateCalled = (engine2._invalidateCalled || 0) + 1 } }
  runner({ externalSources: { 'workbuddy-user': true } }, { externalSources: { 'workbuddy-user': true } }, engine2)()
  ok(engine2._externalEpoch === 0, 'A22-2B-d ★ 配置未变 ⇒ epoch 不动（不白扫）', String(engine2._externalEpoch))
  }
}

// ═══ 负路径③：force 不得复用在途 Promise ═══
console.log('[A22-5] 负路径③：force=true 不得返回同一 Promise（改前 force 完全失效）')
{
  const io = makeIo({})
  io.files = filesWith(['workbuddy-user'])
  const engine = makeEngine({ externalSources: { 'workbuddy-user': true } })
  const { ext } = newExternal(engine, io, factoryNormal)
  let release
  io.gates.set(KEY.wbUser, { promise: new Promise((r) => { release = r }) })
  const p1 = ext.discover(false)
  for (let i = 0; i < 50 && io.reads.length === 0; i++) await new Promise((r) => setTimeout(r, 5))
  ok(io.reads.length > 0, 'A22-5-前提 第一次扫描已进入 IO（在途）', 'reads=' + io.reads.length)
  const readsBefore = io.reads.length
  const p2 = ext.discover(true)
  // ★判据必须是**物理量**：discover 是 async 函数，任何 return 都会包一层新 Promise，
  //   所以 `p1 !== p2` 恒真、对缺陷没有鉴别力（首版就踩了这个坑）。
  //   真正的差别是「force 有没有新起一次扫描」⇒ 看它是否重新读盘（readFile 次数增长）。
  for (let i = 0; i < 50 && io.reads.length === readsBefore; i++) await new Promise((r) => setTimeout(r, 5))
  ok(io.reads.length > readsBefore, 'A22-5a ★ force=true 另起扫描（重新读盘，不是复用在途结果）', 'readsBefore=' + readsBefore + ' now=' + io.reads.length)
  release()
  io.gates.delete(KEY.wbUser)
  const [r1, r2] = await Promise.all([p1, p2].map((p) => p.catch(() => [])))
  ok(Array.isArray(r1) && Array.isArray(r2), 'A22-5b 两条扫描都正常返回')
}

// ═══ 负路径④：externalSources 未变 ⇒ 不递增 epoch ═══
console.log('[A22-6] 负路径④：配置未变 ⇒ 不递增（防每次保存都全量重扫）')
{
  const factory = buildSandbox(null)
  const holder = new Function('return ' + CHANGED_SRC)()
  ok(holder({ a: true }, { a: true }) === false, 'A22-6a ★ 同内容 ⇒ false', String(holder({ a: true }, { a: true })))
  ok(holder({ a: true }, { a: false }) === true, 'A22-6b 值变化 ⇒ true')
  ok(holder({ a: true }, { a: true, b: true }) === true, 'A22-6c 新增子键 ⇒ true')
  ok(holder({ a: true }, {}) === true, 'A22-6d 删除子键 ⇒ true')
  // 键序不同但内容相同 ⇒ 不得误判变化（JSON.stringify 方案会误判）
  ok(holder({ a: true, b: false }, { b: false, a: true }) === false, 'A22-6e ★ 键序不同但内容相同 ⇒ false（键序无关）')
  ok(holder(undefined, {}) === false, 'A22-6f 两侧空 ⇒ false（不抛）')
}

// ═══ 变异负路径 ═══
console.log('[A22-MUT-1] 变异：force 不复用在途判据退化为旧语义 ⇒ A22-5a 的同款实验必红')
{
  const fMut = buildSandbox('force')
  const io = makeIo({})
  io.files = filesWith(['workbuddy-user'])
  const engine = makeEngine({ externalSources: { 'workbuddy-user': true } })
  const { ext } = newExternal(engine, io, fMut)
  let release
  io.gates.set(KEY.wbUser, { promise: new Promise((r) => { release = r }) })
  const p1 = ext.discover(false)
  for (let i = 0; i < 50 && io.reads.length === 0; i++) await new Promise((r) => setTimeout(r, 5))
  ok(io.reads.length > 0, 'A22-5-前提 第一次扫描已进入 IO（在途）', 'reads=' + io.reads.length)
  const readsBefore = io.reads.length
  const p2 = ext.discover(true)
  await new Promise((r) => setTimeout(r, 30))
  ok(io.reads.length === readsBefore, 'A22-MUT-1 ★ 退回旧语义后 force **没有**新起扫描（复用旧 Promise ⇒ force 失效，缺陷复现）', 'readsBefore=' + readsBefore + ' now=' + io.reads.length)
  release(); io.gates.delete(KEY.wbUser)
  await Promise.all([p1, p2].map((p) => p.catch(() => [])))
}

console.log('[A22-MUT-2] 变异：删掉 gen 判据 ⇒ 过期扫描会发布（A22-3b 同款实验必红）')
{
  const fMut = buildSandbox('gen')
  const io = makeIo({})
  io.files = filesWith(['workbuddy-user', 'claude-global'])
  const engine = makeEngine({ externalSources: { 'workbuddy-user': true, 'claude-global': true } })
  const { ext } = newExternal(engine, io, fMut)
  let release
  io.gates.set(KEY.wbUser, { promise: new Promise((r) => { release = r }) })
  const inflight = ext.discover(false)
  await new Promise((r) => setTimeout(r, 5))
  engine.config.externalSources = { 'workbuddy-user': false, 'claude-global': true }
  engine._externalEpoch = (engine._externalEpoch || 0) + 1
  ext.invalidatePre('settings-changed')
  release()
  const got = await inflight
  const published = ext.cache && ext.cache.map((s) => s.id) || []
  ok(published.indexOf('workbuddy-user') >= 0 || got.map((s) => s.id).indexOf('workbuddy-user') >= 0,
    'A22-MUT-2 ★ 删除 gen 判据后过期结果被发布/返回（缺陷复现）', JSON.stringify(published))
}

console.log('[A22-MUT-3] 变异：删掉消费面过滤 ⇒ search 命中已禁用源（A22-4a 必红）')
{
  const fMut = buildSandbox('consume')
  const io = makeIo({})
  io.files = filesWith(['workbuddy-user'])
  const engine = makeEngine({ externalSources: { 'workbuddy-user': true, 'claude-global': false } })
  const { ext } = newExternal(engine, io, fMut)
  ext.cachedAt = Date.now()
  ext.cache = [
    { id: 'claude-global', name: 'Claude Code 全局记忆', tool: 'Claude Code', kind: 'user', files: [{ path: KEY.claudeGlobal }], content: 'CONFIDENTIAL-MARKER claude body', size: 28, mtime: 1 },
  ]
  const hits = await ext.search('CONFIDENTIAL-MARKER', 10)
  ok(hits.map((h) => h.source).indexOf('Claude Code 全局记忆') >= 0,
    'A22-MUT-3 ★ 去掉消费面过滤后 search 命中已禁用源（缺陷复现）', JSON.stringify(hits.map((h) => h.source)))
}

console.log('\nPASS ' + pass + ' / FAIL ' + fail)
if (fail) process.exit(1)
