#!/usr/bin/env node
/**
 * smoke-test-v4-h9-event-in-all.mjs —— v4-H9：事件入 all 检索。
 *
 * ★为什么必须独立进程真跑（不靠宿主工具调用）：
 *   DSH 插件按**模块缓存**加载，改 lib/*.js 不会热更新到运行中宿主。
 *   所有「写入侧/检索侧」改动的活体验证在重启前都是假绿/假红。
 *   ⇒ 本套件真 import lib/event-recall.js + 真调 collectEventHitsPre/eventToL0CorpusPre。
 *
 * ★核心设计（Lead 批准）：把事件当 l0Corpus 条目注入，而不是在 all 末尾 append 独立段。
 *   ① 共享 limit ⇒ 输出不无界膨胀  ② 格式归一零成本  ③ 排序统一
 *   ④ 聚合天然成立（一个事件 push 一条，id=eventId）
 *   ⑤ _recallStats.observe(l0Top) 自动计入召回统计
 *
 * ★★layer 用 'log' 不用 'event'（Lead 实测定）：L0_LAYERS 是闭合词表，
 *   classifyLayerPre 对不在词表的值返回 null（不是原样返回）⇒ 写 'event' 会落到「未分层」组。
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const ER = await import(pathToFileURL(path.join(ROOT, 'lib', 'event-recall.js')).href)
const RP = await import(pathToFileURL(path.join(ROOT, 'lib', 'recall-passages.js')).href)
const L0 = await import(pathToFileURL(path.join(ROOT, 'lib', 'l0-extract.js')).href)
const { textOfEventPre, collectEventHitsPre, eventToL0CorpusPre } = ER

let pass = 0, fail = 0
function ok(c, n, d) { if (c) { pass++; console.log('  PASS ' + n + (d ? '  =>  ' + d : '')) } else { fail++; console.log('  FAIL ' + n + (d ? '  =>  ' + d : '')) } }

// ═══════ A. 基础形状与打分 ═══════
console.log('[A] 基础形状与打分')
{
  const ev = {
    id: 'evt_00000001', name: 'UNIQ_KW_9f3a 事件', status: 'active',
    summary: '总览含 UNIQ_KW_9f3a', sections: { goal: '目标', doing: '', deadend: '', next: '' },
    checkpoints: [{ kind: 'log', text: '检查点正文含 UNIQ_KW_9f3a' }], updatedAt: 100,
  }
  const t = textOfEventPre(ev)
  ok(typeof t === 'string' && t.length > 0, 'A1 textOfEventPre 返回非空字符串', 'len=' + t.length)
  ok(t.includes('UNIQ_KW_9f3a'), 'A2 可检索文本含事件名')
  // ★A3 修正：不能断言「四段标题都在」—— 实现会**正确跳过空段**（doing/deadend/next 为空）。
  //   原断言写成「含 ## 目标 且含 ## 进行中」⇒ 因 doing 为空而假红（是断言错，不是实现错）。
  //   正确判据：非空段有标题、空段无标题（这才是「空段跳过」的真含义）。
  ok(t.includes('## 目标'), 'A3a 非空段有标题（目标）')
  ok(!t.includes('## 进行中'), '★A3b 空段**无**标题（doing 为空 ⇒ 不输出 ## 进行中，证明「空段跳过」）')
  ok(t.includes('检查点正文'), 'A4 含检查点正文')
  const { hits, readFailures } = collectEventHitsPre([ev], ['uniq_kw_9f3a'], RP.recallPassagesPre)
  ok(hits.length === 1, 'A5 命中 1 个事件', 'hits=' + hits.length)
  ok(readFailures.length === 0, 'A6 无读失败')
  ok(hits[0].score > 0, 'A7 score > 0', 'score=' + hits[0].score)
  ok(hits[0].ev.id === ev.id, 'A8 hits[0].ev 是原事件对象')
  ok(collectEventHitsPre([ev], ['绝不可能命中的词_zzz'], RP.recallPassagesPre).hits.length === 0, 'A9 未命中 ⇒ hits 为空')
  const ev2 = { id: 'evt_00000002', name: 'UNIQ_KW_9f3a UNIQ_KW_9f3a UNIQ_KW_9f3a', status: 'active', sections: {}, checkpoints: [], updatedAt: 200 }
  const multi = collectEventHitsPre([ev, ev2], ['uniq_kw_9f3a'], RP.recallPassagesPre)
  ok(multi.hits.length === 2 && multi.hits[0].score >= multi.hits[1].score, 'A10 多事件按 score 降序')
}

// ═══════ B. ★★聚合（Lead 验收第 3 条 + 补充 2）═══════
console.log('[B] 聚合（一个事件只出一条）')
{
  const ev = {
    id: 'evt_00000003', name: 'KW_A KW_A', status: 'active', summary: 'KW_A KW_A',
    sections: { goal: 'KW_A', doing: '', deadend: '', next: '' },
    checkpoints: [{ kind: 'log', text: 'KW_A 检查点一' }, { kind: 'log', text: 'KW_A 检查点二' }], updatedAt: 100,
  }
  const { hits } = collectEventHitsPre([ev], ['kw_a'], RP.recallPassagesPre)
  ok(hits.length === 1, '★B1 同一事件多处命中 ⇒ 仍只出 1 条', 'hits=' + hits.length)
  ok(eventToL0CorpusPre(hits[0]).id === ev.id, '★B2 转 l0Corpus 后 id = eventId（聚合键）')
  const evDual = {
    id: 'evt_00000004', name: '事件双词', status: 'active', summary: '',
    sections: { goal: '', doing: '', deadend: '', next: '' },
    checkpoints: [{ kind: 'log', text: '检查点含 ALPHA_ONE' }, { kind: 'log', text: '检查点含 BETA_TWO' }], updatedAt: 100,
  }
  const dual = collectEventHitsPre([evDual], ['alpha_one', 'beta_two'], RP.recallPassagesPre)
  ok(dual.hits.length === 1, '★★B3 两个不同检查点各含不同关键词、同时命中两者 ⇒ 仍只 1 条（证明聚合不是碰巧）', 'hits=' + dual.hits.length)
  ok(dual.hits[0].passages.length >= 2, '★B4 且 passages 含 ≥2 处命中（确实两处都打到）', 'passages=' + dual.hits[0].passages.length)
}

// ═══════ C. ★layer 闭合词表纪律 ═══════
console.log('[C] layer 闭合词表纪律')
{
  const entry = eventToL0CorpusPre({ ev: { id: 'evt_00000005', name: 'N', status: 'active', sections: {}, checkpoints: [] }, passages: [{ line: 'x' }], score: 1 })
  ok(entry.layer === 'log', '★★C1 layer 用已有层 log（不是 event）', 'layer=' + entry.layer)
  ok(L0.L0_LAYERS.includes(entry.layer), '★★C2 layer 在 L0_LAYERS 闭合词表内', JSON.stringify(L0.L0_LAYERS))
  ok(L0.classifyLayerPre(entry.layer) === 'log', '★★C3 classifyLayerPre(layer) 非 null（不会降级）', String(L0.classifyLayerPre(entry.layer)))
  ok(L0.classifyLayerPre('event') === null, '★★C4 负路径对照：classifyLayerPre(event) 返回 null ⇒ 写 event 会降级（证明 C1 有必要）', String(L0.classifyLayerPre('event')))
  ok(String(entry.label).startsWith('事件 · '), '★C5 label 以「事件 · 」开头', JSON.stringify(entry.label))
  ok(/^evt_/.test(entry.id), 'C6 id 以 evt_ 开头（与 mem_ 可区分）', entry.id)
}

// ═══════ D. 真跑正/负路径（Lead 验收 1/2）═══════
console.log('[D] 真跑正/负路径（造事件 → 命中 → 删事件 → 不命中）')
{
  const UNIQ = 'H9UNIQ_' + Date.now().toString(36)
  const mkEv = () => ({
    id: 'evt_0000000a', name: UNIQ + ' 事件', status: 'active',
    summary: '总览 ' + UNIQ, sections: { goal: '', doing: '', deadend: '', next: '' },
    checkpoints: [{ kind: 'log', text: '检查点 ' + UNIQ }], updatedAt: 500,
  })
  const runAll = (events) => {
    const { hits } = collectEventHitsPre(events, [UNIQ.toLowerCase()], RP.recallPassagesPre)
    return hits.map(eventToL0CorpusPre).map((c) => '· [' + c.id + '] ' + c.label + ' — ' + c.l0).join('\n')
  }
  const outWith = runAll([mkEv()])
  ok(outWith.includes(UNIQ), '★★D1 正：造含唯一关键词的事件 ⇒ 命中它', JSON.stringify(outWith.slice(0, 80)))
  ok(outWith.includes('事件 · '), 'D2 且 label 标为「事件 · 」')
  ok(!runAll([]).includes(UNIQ), '★★D2b 负：删掉该事件 ⇒ 不再命中（同一函数前后对比，证明真的读事件）')
  const other = { id: 'evt_0000000b', name: '完全无关的事件', status: 'active', sections: {}, checkpoints: [] }
  ok(!runAll([other]).includes(UNIQ), '★D3 负：换成无关事件 ⇒ 仍不命中')
}

// ═══════ E. 接线结构断言（防「只写函数没接线」）═══════
console.log('[E] 接线结构断言')
{
  const IX = fs.readFileSync(path.join(ROOT, 'lib', 'index.js'), 'utf8')
  ok(/import \{[^}]*collectEventHitsPre as collectEventHitsPreH9/.test(IX), '★E1 index.js 已 import collectEventHitsPre')
  ok(/import \{[^}]*eventToL0CorpusPre as eventToL0CorpusPreH9/.test(IX), '★E2 index.js 已 import eventToL0CorpusPre')
  ok(IX.includes('l0Corpus.push(eventToL0CorpusPreH9(h9))'), '★★E3 事件条目真的 push 进 l0Corpus（不是只定义函数）')
  const pushAt = IX.indexOf('l0Corpus.push(eventToL0CorpusPreH9(h9))')
  const scoreLoopAt = IX.indexOf('for (const c of l0Corpus) {')
  ok(pushAt > 0 && scoreLoopAt > 0 && pushAt < scoreLoopAt, '★★E4 push 在 l0Corpus 打分循环**之前**（否则不参与排名）', 'push@' + pushAt + ' loop@' + scoreLoopAt)
  const guardAt = IX.lastIndexOf("if (scope === 'all') {", pushAt)
  ok(guardAt > 0, '★★E5 push 受 `if (scope === all)` 守卫（不是无条件执行）', 'guard@' + guardAt)
  ok(IX.includes("'recall-event-side'"), '★★E6 事件读取失败进 _degradeSink 留痕（区分「没有事件」与「读不到事件」）')
}

// ═══════ F. 真实 event-store 实测 ═══════
console.log('[F] 真实 event-store 实测')
{
  const WS = path.join(os.homedir(), '.dsh', 'memory', 'workspaces', '--D--dsh-auto-memory--')
  const storePath = path.join(WS, 'handoff', 'event-store.json')
  if (!fs.existsSync(storePath)) {
    console.log('  SKIP 真实 event-store 不存在 ⇒ F 组跳过')
  } else {
    const store = JSON.parse(fs.readFileSync(storePath, 'utf8'))
    const evs = Array.isArray(store.events) ? store.events : []
    ok(evs.length > 0, 'F0 前置：真实库有事件', 'events=' + evs.length)
    const { hits } = collectEventHitsPre(evs, ['事件', '记忆'], RP.recallPassagesPre)
    ok(hits.length > 0, '★★F1 真实库上「事件 记忆」现在能命中事件（改前 all 命中 0 条）', 'hits=' + hits.length)
    const corpus = hits.map(eventToL0CorpusPre)
    const ids = corpus.map((c) => c.id)
    ok(corpus.length === hits.length, 'F2 每个命中只转出 1 条 l0Corpus 条目', 'corpus=' + corpus.length)
    ok(new Set(ids).size === ids.length, '★★F3 真实库上 corpus 的 eventId 无重复（聚合有效）', 'ids=' + ids.join(','))
  }
}

console.log('')
console.log('[H9] ' + pass + ' PASS / ' + fail + ' FAIL')
process.exit(fail ? 1 : 0)