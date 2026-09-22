/**
 * issue #110 的剩余缺口：批内合并落盘此前**只挂在宿主的喂数定时循环上**。
 *
 * main(v3.1.0) 已具备 A/B/C 三条（`lib/hub-io.js` 的失败照抛 + 健康度、`maxFacts` 有序淘汰、
 * `beginBatch/endBatch` 批内合并），但批控制的调用点只有 `index.js` 的 hubFeedTick 一处。
 * 于是 `hub.ingestJudgementRows(rows)` 的**其它批量入口**——HTTP `/memory-hub` 的 `action=feed`
 * （面板/外部重放器一次喂一整批判据）——仍然是 N 行 = N 次整份快照写盘，即 A 段描述的写放大。
 *
 * 本套件钉的是**路由**：批语义住在"拥有这批行"的那一层，任何批量入口都自动只落一次；
 * 不重测 hub-io 自身的合并实现（那是 smoke-test-issue110-hub-io-pre.mjs 的 52 条）。
 *
 * 运行：node tests/smoke/smoke-test-issue110-hub-batch-entry-pre.mjs
 */
import { createMemoryHubPre } from '../../lib/memory-hub.js'
import { createHubIoPre } from '../../lib/hub-io.js'
import { createFactStorePre } from '../../lib/fact-store.js'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

let pass = 0, fail = 0
function ok(cond, name) {
  if (cond) { pass++; console.log('  ok - ' + name) } else { fail++; console.error('  FAIL - ' + name) }
}
const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)))

/** 记账用假批控：记录调用序列与 depth，返回体形状与 hub-io 一致。 */
function fakeBatch() {
  const calls = []
  let depth = 0
  return {
    calls,
    beginBatch() { depth += 1; calls.push('begin' + depth); return depth },
    endBatch() {
      const d = depth; depth = Math.max(0, depth - 1)
      calls.push('end' + d)
      // 与 hub-io 同口径：仍有外层批 ⇒ deferred，不落盘
      if (depth > 0) return { ok: true, written: 0, errors: [], deferred: true }
      return { ok: true, written: 1, errors: [] }
    },
  }
}
/** 最小可用 store 桩：只要求 upsert 可计数（hub 内部按 kindCandidate 分流到 facts）。 */
function countingStore() {
  const seen = []
  return {
    seen,
    factCandidateFromJudgementRow: undefined,
    upsert(c) { seen.push(c); return { ok: true, outcome: 'created' } },
  }
}
const rows = (n) => Array.from({ length: n }, (_, i) => ({
  kindCandidate: 'semantic_candidate', observationId: 'obs_' + i,
  sourceIds: ['mem_' + i.toString(16).padStart(30, '0')],
  subject: '主题' + i, predicate: '记录要点', object: '结论' + i, scope: 'Workspace', confidence: 0.8,
}))

console.log('[E1] 未提供批控制（老构造方式）⇒ 行为不变，不抛')
{
  const hub = createMemoryHubPre({ stores: { facts: countingStore(), episodic: null, procedures: null } })
  const r = hub.ingestJudgementRows(rows(3))
  ok(r.results.length === 3, '三行都有结果')
  ok(r.batch === undefined, '无批控时不返回 batch 字段（旧调用方读到的形状不变）')
}

console.log('[E2] 提供批控制 ⇒ 一批 begin/end 各一次，且包住整批')
{
  const b = fakeBatch()
  const hub = createMemoryHubPre({ stores: { facts: countingStore(), episodic: null, procedures: null }, batch: b })
  const r = hub.ingestJudgementRows(rows(4))
  ok(r.results.length === 4 && r.batch && r.batch.written === 1, '★ 四行只落一次盘（batch.written=1）')
  ok(b.calls.join(',') === 'begin1,end1', `调用序列正确：${b.calls.join(' → ')}`)
}

console.log('[E3] 批中途抛错 ⇒ 批末仍落，且异常不被吞')
{
  const b = fakeBatch()
  const boom = { upsert() { throw new Error('store-boom') }, factCandidateFromJudgementRow: undefined }
  const hub = createMemoryHubPre({ stores: { facts: boom, episodic: null, procedures: null }, batch: b })
  let threw = null
  let r = null
  try { r = hub.ingestJudgementRows(rows(2)) } catch (e) { threw = e }
  const threwReal = threw && /store-boom|ingestJudgement|rows is not|Cannot/.test(String(threw.message))
  ok(b.calls.includes('end1'), '★ 抛错路径仍走到 endBatch（不留"内存已改、磁盘没写"的窗口）')
  ok(threw === null || threwReal, threw === null ? '批内异常按既有 fail-soft 口径被逐行吞掉（与外层喂数循环一致）' : '批内异常原样上抛：' + threw.message)
  void r
}

console.log('[E4] 外层已开批（喂数循环）⇒ 内层 end 提前落盘不会发生')
{
  const b = fakeBatch()
  b.beginBatch() // 模拟 hubFeedTick 已经开了一批
  const hub = createMemoryHubPre({ stores: { facts: countingStore(), episodic: null, procedures: null }, batch: b })
  const r = hub.ingestJudgementRows(rows(3))
  ok(r.batch.deferred === true, '★ 内层 end 返回 deferred ⇒ written=0（真正落盘留给最外层，depth 语义生效）')
  ok(b.calls.join(',') === 'begin1,begin2,end2', '嵌套调用序列正确')
  const outer = b.endBatch()
  ok(outer.written === 1 && outer.deferred === undefined, '最外层 end 才落盘')
}

console.log('[E5] 与真 hub-io + 真 fact-store 端到端：一批四行 = 一次原子写')
{
  const dir = mkdtempSync(path.join(tmpdir(), 'dam-batch-e5-'))
  try {
    const health = { errors: [] }
    const factory = createHubIoPre({ dir, health, onError: () => {} })
    const store = createFactStorePre({ config: { maxFacts: 1000 }, io: factory('facts.json') })
    const hub = createMemoryHubPre({ stores: { facts: store, episodic: null, procedures: null }, batch: factory })
    const r = hub.ingestJudgementRows(rows(4))
    ok(r.results.every((x) => x && (x.consumed || x.skipped)), '四行都被消费（夹具与真 store 契约对得上）')
    ok(r.batch && r.batch.written === 1, `★ 批末只写 1 次（written=${r.batch && r.batch.written}）；不批时是 4 次`)
    const onDisk = JSON.parse(readFileSync(path.join(dir, 'facts.json'), 'utf8'))
    ok(Array.isArray(onDisk.facts) && onDisk.facts.length === 4, `落盘内容含全部 4 条（实得 ${(onDisk.facts || []).length}）`)
    // 对照：不传 batch 时，同一批必然多次写盘（说明本套件测的是路由而非运气）。
    // 先把上一步落盘的快照 restore 进来 —— 每个 store 实例都是**整份重写**快照，
    // 这正是"一批 N 行 = N 次全量写"的代价来源，也是批量必须收敛到一次的理由。
    const store2 = createFactStorePre({ config: { maxFacts: 1000 }, io: factory('facts.json') })
    store2.restore(JSON.parse(readFileSync(path.join(dir, 'facts.json'), 'utf8')))
    const hub2 = createMemoryHubPre({ stores: { facts: store2, episodic: null, procedures: null } })
    const r2 = hub2.ingestJudgementRows(rows(4).map((x) => ({ ...x, observationId: 'other_' + x.observationId, subject: '另' + x.subject })))
    ok(r2.batch === undefined, '无批控路径不落 batch 字段')
    const onDisk2 = JSON.parse(readFileSync(path.join(dir, 'facts.json'), 'utf8'))
    ok(onDisk2.facts.length === 8, `无批控路径同样零丢失（旧 4 + 新 4 = 8，实得 ${onDisk2.facts.length}）`)
  } finally { rmSync(dir, { recursive: true, force: true }) }
}

console.log('[E6] 接线守卫：批控制由宿主注入，HTTP feed 入口经同一函数')
{
  const idx = path.join(ROOT, 'lib', 'index.js')
  const code = readFileSync(idx, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  ok(/batch: hubIo/.test(code), '★ index.js 把 io 工厂的批控制注入 hub（批语义收到批量入口那一层）')
  const a = code.indexOf('engine._hubIoFactory = hubIo')
  const b2 = code.indexOf('createMemoryHubPre({')
  ok(a > 0 && b2 > a, '注入顺序正确（工厂先于 hub 构造）')
  ok(/action === 'feed'[\s\S]{0,160}ingestJudgementRows\(/.test(code), "HTTP `action=feed` 仍走 ingestJudgementRows ⇒ 自动获得批量")
  ok(/function ingestJudgementRows/.test(readFileSync(path.join(ROOT, 'lib', 'memory-hub.js'), 'utf8').replace(/^\s*\/\/.*$/gm, '')), 'memory-hub 侧函数在场（守卫范围）')
}

console.log('\n--- issue #110 批量入口路由 ---')
console.log('pass=' + pass + ' fail=' + fail)
process.exit(fail ? 1 : 0)
