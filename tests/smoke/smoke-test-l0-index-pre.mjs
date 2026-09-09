/**
 * smoke-test-l0-index —— L0 向量索引（l0_index_v1）回归锁定。
 * 纯 Node、零依赖、不联网；IO 与 embedding 全注入（内存 Map + 确定性假 embedder）。
 * 覆盖：全量零丢失 / 增量仅重算变化条 / 失效移除 / fail-soft / 确定性 / 不存原文 / 计数语义。
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  createL0IndexPre, computeL0IndexVersionPre,
  L0_INDEX_VERSION, L0_INDEX_SCHEMA_VERSION,
} from '../../lib/l0-index.js'

let pass = 0, fail = 0
const t = (name, fn) => { try { fn(); pass++; console.log('  ok -', name) } catch (e) { fail++; console.error('FAIL', name + ':', e.message) } }
const ta = async (name, fn) => { try { await fn(); pass++; console.log('  ok -', name) } catch (e) { fail++; console.error('FAIL', name + ':', e.message) } }

const sha256 = (s) => createHash('sha256').update(String(s), 'utf8').digest('hex')
const mem = (c) => 'mem_' + c.repeat(32)
const anchor = (c) => `<!-- memory:mem_${c.repeat(32)} -->`

// ---------- 注入件 ----------
/** 确定性假 embedder:dim=4,同文本同向量,文本变向量变。 */
function fakeEmbed(text) {
  const s = String(text || '')
  const v = new Float32Array(4)
  for (let i = 0; i < s.length; i++) v[i % 4] += (s.charCodeAt(i) % 97) / 97
  let n = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2] + v[3] * v[3]) || 1
  for (let i = 0; i < 4; i++) v[i] = v[i] / n
  return v
}
const embedder = { embedPassages: async (texts) => texts.map(fakeEmbed) }

/** 内存 IO(readJson 同步;缺失抛 ENOENT;writeJson 深克隆模拟 JSON 往返)。 */
function makeIO() {
  const store = new Map()
  return {
    store,
    readJson(p) {
      const v = store.get(String(p))
      if (v === undefined) throw new Error('ENOENT: ' + p)
      return v
    },
    writeJson(p, obj) { store.set(String(p), JSON.parse(JSON.stringify(obj))) },
  }
}

const PATH = '/mem/index/files/l0-index.json'
const mkText = (defs) => defs.map(([c, body]) => `${anchor(c)}${body}`).join('\n')
const mkEngine = (io, now) => createL0IndexPre({ io, embedder, ...(now ? { now } : {}) })

const T0 = 1750000000000
let clock = T0
const tickNow = () => ++clock

// ---------- 语料 ----------
const V1 = [
  ['a', '## 主题甲（12:01）\n- 12:01 第一条绝密原文标记XYZ不要出现在索引里'],
  ['b', '- 09:30 第二条记忆的正文内容'],
  ['c', '第三条纯文本正文,没有标题也没有列表,足够长以便触发截断兜底路径。'],
]
const textV1 = mkText(V1)

// ---------- 版本 ----------
t('version constants', () => {
  assert.equal(L0_INDEX_VERSION, 'l0_index_v1')
  assert.equal(L0_INDEX_SCHEMA_VERSION, 1)
})

// ---------- 全量建索引:零丢失 ----------
await ta('buildFull: 3 条全量入库零丢失,字段齐全', async () => {
  const io = makeIO()
  const eng = mkEngine(io)
  const r = await eng.buildFull({ path: PATH, text: textV1 })
  assert.equal(r.ok, true, r.error)
  assert.equal(r.count, 3)
  assert.equal(r.added, 3)
  assert.equal(r.recomputed, 3)
  assert.equal(r.removed, 0)
  assert.equal(r.skipped, 0)
  const loaded = eng.load({ path: PATH })
  assert.equal(loaded.ok, true, loaded.reason)
  assert.equal(loaded.entries.length, 3)
  const ids = loaded.entries.map((e) => e.id)
  assert.deepEqual(ids, [mem('a'), mem('b'), mem('c')].sort())
  for (const e of loaded.entries) {
    assert.ok(e.id && typeof e.l0 === 'string' && typeof e.source === 'string')
    assert.equal(e.l0Hash, sha256(e.l0), 'l0Hash=sha256(l0)')
    assert.ok(Number.isFinite(e.updatedAt) && e.updatedAt > 0)
    assert.ok(Array.isArray(e.vector) && e.vector.length === 4 && e.vector.every((n) => Number.isFinite(n)))
  }
})

await ta('buildFull: 向量来自 embedder(裸文本,不加前缀)', async () => {
  const io = makeIO()
  const eng = mkEngine(io)
  await eng.buildFull({ path: PATH, text: textV1 })
  const { entries } = eng.load({ path: PATH })
  const byId = new Map(entries.map((e) => [e.id, e]))
  const expected = Array.from(fakeEmbed(byId.get(mem('a')).l0))
  assert.deepEqual(byId.get(mem('a')).vector, expected)
})

// ---------- 索引文件 schema:只存 URI+向量+元数据,不含原文 ----------
await ta('索引文件: schemaVersion/l0IndexVersion/无 body/不含原文串', async () => {
  const io = makeIO()
  const eng = mkEngine(io)
  await eng.buildFull({ path: PATH, text: textV1 })
  const fileObj = io.store.get(PATH)
  assert.equal(fileObj.schemaVersion, L0_INDEX_SCHEMA_VERSION)
  assert.match(fileObj.l0IndexVersion, /^l0idx_[0-9a-f]{32}$/)
  for (const e of fileObj.entries) {
    assert.deepEqual(Object.keys(e).sort(), ['id', 'l0', 'l0Hash', 'source', 'updatedAt', 'vector'])
  }
  const raw = JSON.stringify(fileObj)
  assert.ok(!raw.includes('绝密原文标记XYZ'), '索引不得含记忆原文')
  // l0IndexVersion 与 computeL0IndexVersionPre 一致
  assert.equal(fileObj.l0IndexVersion, computeL0IndexVersionPre(fileObj.entries))
})

// ---------- 增量:仅重算变化条 ----------
await ta('update: 改 1 条 → 仅重算该条(skipped=2),其余条目向量与 updatedAt 原样保留', async () => {
  const io = makeIO()
  const eng = mkEngine(io, tickNow)
  await eng.buildFull({ path: PATH, text: textV1 })
  const before = eng.load({ path: PATH })
  const beforeById = new Map(before.entries.map((e) => [e.id, e]))

  const textV2 = mkText([
    ['a', '## 主题甲已改写（12:05）\n- 12:05 第一条内容被修改'],
    ['b', V1[1][1]],
    ['c', V1[2][1]],
  ])
  const r = await eng.update({ path: PATH, text: textV2 })
  assert.equal(r.ok, true, r.error)
  assert.equal(r.recomputed, 1, '仅变化条重算')
  assert.equal(r.skipped, 2)
  assert.equal(r.added, 0)
  assert.equal(r.removed, 0)
  assert.equal(r.count, 3)
  const after = eng.load({ path: PATH })
  const afterById = new Map(after.entries.map((e) => [e.id, e]))
  // 未变条:updatedAt 与 vector 完全保留(证明走了复用路径)
  for (const id of [mem('b'), mem('c')]) {
    assert.equal(afterById.get(id).updatedAt, beforeById.get(id).updatedAt, '未变条 updatedAt 不变')
    assert.deepEqual(afterById.get(id).vector, beforeById.get(id).vector, '未变条 vector 不变')
  }
  // 变化条:vector 变了
  assert.notDeepEqual(afterById.get(mem('a')).vector, beforeById.get(mem('a')).vector)
  assert.equal(afterById.get(mem('a')).l0Hash, sha256(afterById.get(mem('a')).l0))
})

await ta('update: 新增 1 条 + 删除 1 条 → added=1/removed=1/recomputed=0', async () => {
  const io = makeIO()
  const eng = mkEngine(io, tickNow)
  await eng.buildFull({ path: PATH, text: textV1 })
  const textV3 = mkText([
    ['b', V1[1][1]],
    ['c', V1[2][1]],
    ['d', '## 新条目丁（13:00）'],
  ])
  const r = await eng.update({ path: PATH, text: textV3 })
  assert.equal(r.ok, true, r.error)
  assert.equal(r.added, 1)
  assert.equal(r.removed, 1)
  // recomputed = 本次实际重新 embedding 的条数(新增+变化)——新条目 d 需要算向量
  assert.equal(r.recomputed, 1)
  assert.equal(r.count, 3)
  const { entries } = eng.load({ path: PATH })
  assert.deepEqual(entries.map((e) => e.id), [mem('b'), mem('c'), mem('d')].sort())
})

await ta('update: 幂等(同文本再跑) → 全 skipped,l0IndexVersion 不变', async () => {
  const io = makeIO()
  const eng = mkEngine(io, tickNow)
  await eng.buildFull({ path: PATH, text: textV1 })
  const v1 = eng.load({ path: PATH }).l0IndexVersion
  const r = await eng.update({ path: PATH, text: textV1 })
  assert.equal(r.ok, true)
  assert.equal(r.recomputed, 0)
  assert.equal(r.added, 0)
  assert.equal(r.removed, 0)
  assert.equal(r.skipped, 3)
  assert.equal(r.l0IndexVersion, v1, '内容未变 → 版本不变')
})

// ---------- 失效条目显式移除 ----------
await ta('remove: 显式移除 1 条 → removed=1,版本随之变化', async () => {
  const io = makeIO()
  const eng = mkEngine(io, tickNow)
  await eng.buildFull({ path: PATH, text: textV1 })
  const vBefore = eng.load({ path: PATH }).l0IndexVersion
  const r = await eng.remove({ path: PATH, ids: [mem('b')] })
  assert.equal(r.ok, true, r.error)
  assert.equal(r.removed, 1)
  assert.equal(r.count, 2)
  assert.notEqual(r.l0IndexVersion, vBefore)
  const { entries } = eng.load({ path: PATH })
  assert.ok(!entries.some((e) => e.id === mem('b')))
  // 移除不存在的 id:removed=0
  const r2 = await eng.remove({ path: PATH, ids: [mem('z')] })
  assert.equal(r2.ok, true)
  assert.equal(r2.removed, 0)
})

// ---------- fail-soft:任何索引缺失/非法都不抛、不阻塞调用方 ----------
await ta('load fail-soft: 缺文件/损坏 JSON/schema 不符/条目非法 → ok:false + 空数组,不抛', async () => {
  // 缺文件(io 返回 null 约定)
  const ioNull = makeIO()
  ioNull.readJson = () => null
  const rNull = mkEngine(ioNull).load({ path: PATH })
  assert.equal(rNull.ok, false)
  assert.equal(rNull.reason, 'missing')
  assert.deepEqual(rNull.entries, [])
  // 损坏 JSON(readJson 抛错)
  const ioBad = makeIO()
  ioBad.readJson = () => { throw new Error('Unexpected token in JSON') }
  const rBad = mkEngine(ioBad).load({ path: PATH })
  assert.equal(rBad.ok, false)
  assert.equal(rBad.reason, 'read-error')
  // schemaVersion 不符
  const ioSchema = makeIO()
  ioSchema.writeJson(PATH, { schemaVersion: 99, l0IndexVersion: 'l0idx_' + '0'.repeat(32), updatedAt: T0, entries: [] })
  assert.equal(mkEngine(ioSchema).load({ path: PATH }).reason, 'schema')
  // entries 非数组
  const ioArr = makeIO()
  ioArr.writeJson(PATH, { schemaVersion: 1, l0IndexVersion: 'l0idx_' + '0'.repeat(32), updatedAt: T0, entries: 'nope' })
  assert.equal(mkEngine(ioArr).load({ path: PATH }).reason, 'entries')
  // 条目向量含非数值(JSON 往返会把 NaN 变 null,故用字符串构造非法值)
  const ioVec = makeIO()
  ioVec.writeJson(PATH, {
    schemaVersion: 1, l0IndexVersion: 'l0idx_' + '0'.repeat(32), updatedAt: T0,
    entries: [{ id: mem('a'), vector: [0.1, 'oops', 0.3, 0.4], l0: 'x', source: 'heading', l0Hash: sha256('x'), updatedAt: T0 }],
  })
  assert.equal(mkEngine(ioVec).load({ path: PATH }).reason, 'entry.vector')
})

await ta('update: 旧索引损坏 → fail-soft 退化为全量重建(recovered:true),不阻塞', async () => {
  const io = makeIO()
  io.writeJson(PATH, { broken: true })
  const eng = mkEngine(io, tickNow)
  const r = await eng.update({ path: PATH, text: textV1 })
  assert.equal(r.ok, true, r.error)
  assert.equal(r.recovered, true)
  assert.equal(r.count, 3)
  assert.equal(eng.load({ path: PATH }).entries.length, 3)
})

await ta('embedder 抛错 → buildFull ok:false 不抛、不写盘', async () => {
  const io = makeIO()
  const badEng = createL0IndexPre({
    io,
    embedder: { embedPassages: async () => { throw new Error('model gone') } },
  })
  const r = await badEng.buildFull({ path: PATH, text: textV1 })
  assert.equal(r.ok, false)
  assert.match(r.error, /model gone/)
  assert.equal(io.store.has(PATH), false, '失败不写盘')
})

// ---------- 确定性 ----------
await ta('确定性: 同输入两次全量 → l0IndexVersion 相同;内容不同 → 不同', async () => {
  const io1 = makeIO(); const io2 = makeIO()
  const r1 = await mkEngine(io1, () => T0).buildFull({ path: PATH, text: textV1 })
  const r2 = await mkEngine(io2, () => T0).buildFull({ path: PATH, text: textV1 })
  assert.equal(r1.ok && r2.ok, true)
  assert.equal(r1.l0IndexVersion, r2.l0IndexVersion)
  const r3 = await mkEngine(io2, () => T0).buildFull({ path: PATH, text: textV1 + anchor('e') + '## 追加条目（14:00）' })
  assert.notEqual(r3.l0IndexVersion, r1.l0IndexVersion)
})

await ta('空文本 → ok:true count=0 空索引可写盘可读回', async () => {
  const io = makeIO()
  const eng = mkEngine(io)
  const r = await eng.buildFull({ path: PATH, text: '没有任何锚点的纯文本。' })
  assert.equal(r.ok, true)
  assert.equal(r.count, 0)
  const loaded = eng.load({ path: PATH })
  assert.equal(loaded.ok, true)
  assert.deepEqual(loaded.entries, [])
})

// ---------- status ----------
await ta('status: count/version/updatedAt;损坏索引 → ok:false', async () => {
  const io = makeIO()
  const eng = mkEngine(io)
  await eng.buildFull({ path: PATH, text: textV1 })
  const s = eng.status({ path: PATH })
  assert.equal(s.ok, true)
  assert.equal(s.count, 3)
  assert.match(s.l0IndexVersion, /^l0idx_[0-9a-f]{32}$/)
  assert.equal(eng.status({ path: '/other/missing.json' }).ok, false)
})

// ---------- 工厂守卫 ----------
t('工厂: 缺 io → 抛(组装错误非运行期 fail-soft 范畴)', () => {
  assert.throws(() => createL0IndexPre({ embedder }), /io\.readJson/)
})

console.log(`\n[l0-index] ${pass}/${pass + fail} assertions passed`)
if (fail) process.exit(1)
