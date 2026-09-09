#!/usr/bin/env node
/** smoke-test-p2-semantic-recall —— P2 语义臂接入 recall 回归锁定(2026-09-09)。
 * 语义臂=recall() 内联闭包 semanticArm(env):L0 语料(idx_pre_ miv)→ _jsSemanticRank → 阈值 0.5 → 确定性排序。
 * 覆盖:词法不重合但语义相关的记录可召回 / 词法臂零改动(源码守卫)/ fail-soft(rank=null→[]) /
 * 阈值过滤 / miv 稳定且格式合法 / 语料=L0 非全文 / 确定性 / 上限与截断。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { buildL0IndexPre } from '../../lib/l0-extract-pre.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SRC = readFileSync(path.resolve(HERE, '..', '..', 'lib', 'index.js'), 'utf8')
let pass = 0, fail = 0
const ok = (c, n) => { if (c) { pass++; console.log('  ok -', n) } else { fail++; console.error('FAIL', n) } }
const ta = async (name, fn) => { try { await fn(); pass++; console.log('  ok -', name) } catch (e) { fail++; console.error('FAIL', name + ':', e.message) } }

function extractFn(header) {
  const start = SRC.indexOf(header)
  if (start < 0) throw new Error('not found: ' + header)
  let depth = 0, end = -1
  for (let i = start + header.length - 1; i < SRC.length; i++) {
    if (SRC[i] === '{') depth++
    else if (SRC[i] === '}') { depth--; if (depth === 0) { end = i; break } }
  }
  if (end < 0) throw new Error('unbalanced: ' + header)
  return SRC.slice(start, end + 1)
}

// ---------- G0 源码守卫 ----------
console.log('[p2-semantic-recall] G0 源码守卫')
ok(SRC.includes('async recall(query, limit = 8, agent, scope = \'all\') {'), 'recall() 签名不变')
ok(SRC.includes("defineTool('memory_recall_pre'"), 'memory_recall_pre 工具定义仍在(schema 零改动)')
ok(SRC.includes("const { buildL0IndexPre } = await import('./l0-extract-pre.js')"), 'T1 经函数内动态 import 引入')
ok(SRC.includes("await import('node:crypto')"), 'node:crypto 函数内动态 import(miv 计算)')
ok(/catch \(eSem\) \{\}/.test(SRC), '整块 fail-soft try/catch(非 C2/异常 → 跳过语义节)')
ok(SRC.includes("minScore: 0.5") && SRC.includes("maxRecords: 256"), '阈值 0.5 + 语料上限 256')
ok(SRC.includes("'idx_pre_' + env.createHash"), 'miv 前缀 idx_pre_(匹配 rank() 校验)')
ok(SRC.includes("== 语义命中(L0 摘要,按相关度;可按锚点下钻) =="), '语义节输出格式')
// 词法臂保留:scanFile 词法扫描与全文行输出原样存在
ok(SRC.includes("const matched = []") && SRC.includes("low.includes(t) ? 1 : 0"), '词法臂保留(逐行 includes 计分,打全文)')
ok(SRC.includes("out.push('· ' + h.where + ':"), '词法命中按文件+整行展示(全文,未改)')

// ---------- 行为:抽取 semanticArm 闭包,绑定假引擎 ----------
const closureSrc = extractFn('const semanticArm = async (env) => {')
const arrowSrc = closureSrc.slice(closureSrc.indexOf('= ') + 2)
function makeSemanticArm(fake) {
  const factory = new Function('return { semanticArm: ' + arrowSrc + '};')
  return factory.call(fake).semanticArm
}

const anchor = (c) => `<!-- memory:mem_${c.repeat(32)} -->`
const mem = (c) => 'mem_' + c.repeat(32)
// 文件 A:两条记忆,其 L0 与查询「发布踩坑」词法不重合(不含"发布"/"踩坑"字样),但主题相关(模拟语义命中)
const FILE_A = [
  anchor('a') + '## 版本迭代教训汇总\n- 15:38 发版流程里令牌选择与缓存延迟两次返工的完整记录,细节都在这里',
  anchor('b') + '- 09:30 数据库连接池参数调优过程,含连接泄漏定位',
].join('\n')
// 文件 B:词法命中(含"踩坑"字样)
const FILE_B = anchor('c') + '- 11:00 发布踩坑:令牌必须钉前缀,缓存要轮询'

function fakeEngine({ rankImpl }) {
  return {
    readTextSafe: async (p) => (p.includes('2026-09-09') ? FILE_A : p.includes('2026-09-08') ? FILE_B : ''),
    _jsSemanticRank: rankImpl,
  }
}
const mkEnv = (over = {}) => ({
  sources: [
    { label: '2026-09-09.md', path: '/ws/2026-09-09.md' },
    { label: '2026-09-08.md', path: '/ws/2026-09-08.md' },
  ],
  buildL0IndexPre, createHash, query: '发布踩坑', limit: 5, maxRecords: 256, minScore: 0.5,
  ...over,
})

await ta('语义命中:词法不重合(L0 无查询词)但高 cosine 的记录被召回', async () => {
  const l0a = buildL0IndexPre(FILE_A)[0].l0 // '版本迭代教训汇总'
  assert.ok(!l0a.includes('发布') && !l0a.includes('踩坑'), '夹具自检:L0 与查询词法不重合')
  let seenSnap = null
  const fake = fakeEngine({ rankImpl: async (snap, q) => {
    seenSnap = { snap, q }
    return { scores: new Map([[mem('a'), 0.72], [mem('b'), 0.41]]) }
  } })
  const hits = await makeSemanticArm(fake)(mkEnv())
  assert.equal(hits.length, 1, '低于阈值 0.41 被过滤,仅 0.72 入选')
  assert.equal(hits[0].id8, 'a'.repeat(8))
  assert.equal(hits[0].label, '2026-09-09.md')
  assert.equal(hits[0].score, 0.72)
  assert.equal(hits[0].l0, l0a, '展示文本=L0(非全文)')
  // 语料送入 rank 的是 L0,绝非全文(全文含「发布踩坑」字样与完整正文)
  assert.ok(seenSnap.snap.records.every((r) => r.text.length <= 200 && !r.text.includes('完整记录,细节都在这里')), '语料文本=L0,不含全文正文')
  assert.match(seenSnap.snap.memoryIndexVersion, /^idx_pre_[0-9a-f]{32}$/, 'miv 格式合法(rank() 校验通过)')
  assert.equal(seenSnap.q, '发布踩坑', '查询原文送嵌入(query: 前缀由引擎内部加)')
})

await ta('确定性:同输入两次调用输出完全一致(含 miv)', async () => {
  const snaps = []
  const fake = fakeEngine({ rankImpl: async (snap) => { snaps.push(snap.memoryIndexVersion); return { scores: new Map([[mem('a'), 0.72]]) } } })
  const arm = makeSemanticArm(fake)
  const h1 = await arm(mkEnv())
  const h2 = await arm(mkEnv())
  assert.deepEqual(h1, h2)
  assert.equal(snaps[0], snaps[1], '同语料同 miv(引擎嵌入缓存可命中)')
})

await ta('fail-soft:rank 返回 null(非 C2/无模型) → 空数组不抛', async () => {
  const fake = fakeEngine({ rankImpl: async () => null })
  assert.deepEqual(await makeSemanticArm(fake)(mkEnv()), [])
})
await ta('fail-soft:语料为空(文件缺失) → 空数组,不调 rank', async () => {
  let called = 0
  const fake = { readTextSafe: async () => '', _jsSemanticRank: async () => { called++; return { scores: new Map() } } }
  assert.deepEqual(await makeSemanticArm(fake)(mkEnv()), [])
  assert.equal(called, 0, '空语料不触发嵌入')
})
await ta('上限:maxRecords 截断语料;limit 截断命中数', async () => {
  // 锚点 id 必须是恰好 32 个十六进制字符:anchor() 对单字符 repeat(32),12 个不同 hex 字符足够
  const HEXC = '0123456789abcdef'
  const big = Array.from({ length: 12 }, (_, i) => anchor(HEXC[i % 16]) + `- 0${i % 10}:00 条目${i}的内容描述足够长`).join('\n')
  const seen = []
  const fake = { readTextSafe: async () => big, _jsSemanticRank: async (snap) => { seen.push(snap.records.length); return { scores: new Map(snap.records.map((r, i) => [r.memoryId, 0.9 - i * 0.01])) } } }
  await makeSemanticArm(fake)(mkEnv({ maxRecords: 8, limit: 3 }))
  assert.equal(seen[0], 8, '语料截断到 maxRecords=8')
  const fake2 = { readTextSafe: async () => big, _jsSemanticRank: async (snap) => ({ scores: new Map(snap.records.map((r, i) => [r.memoryId, 0.8 - i * 0.01])) }) }
  const hits = await makeSemanticArm(fake2)(mkEnv({ limit: 3 }))
  assert.equal(hits.length, 3, '命中数截断到 limit=3')
  assert.ok(hits[0].score >= hits[1].score && hits[1].score >= hits[2].score, '按分数降序')
})

console.log(`\n[p2-semantic-recall] ${pass}/${pass + fail} assertions passed`)
if (fail) process.exit(1)
