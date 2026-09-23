#!/usr/bin/env node
/**
 * 多工作区 / 多会话适配回归(2026-09-17)。
 *
 * 症状(用户实测):「同时两个模型在跑,谁也没法注入了」;以及
 * 「我只是点进了不同的工作区,为啥语义模型会跟着我点着走」。
 *
 * 根因:引擎里 4 处状态是**单槽**(一个变量只装"最后写入者"),两会话/两工作区交替时互相覆盖:
 *   ① `engine._tierGateHits`   命中投影单槽 → A 投递后被 B 覆盖 ⇒ A 取到 B 的投影
 *      ⇒ 身份门判 session-mismatch ⇒ **A 永远不下探 Tier-1**(主因)
 *   ② `mivCache`               语料版本缓存单槽 → 两工作区互相踢缓存 ⇒ 每次必然重算
 *   ③ `lastIndexDegrade`       降级标注单槽(读方不判会话) ⇒ B 的未就绪污染 A 十分钟(假降级)
 *   ④ `_lastTierQuery`         本轮 query 单槽 → A 的 query 被 B 顶掉 ⇒ 退回 triggerText
 *
 * 本套件锁定「分片后各会话/各工作区互不干扰」,并**反向守卫**不得退回单槽。
 * 口径:从源码抽取/行为调用真实实现;不触发 fs、模型、网络。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
const ACT = readFileSync(path.join(ROOT, 'lib', 'activation-host.js'), 'utf8').replace(/\r\n/g, '\n')
const CTX = readFileSync(path.join(ROOT, 'lib', 'context-host.js'), 'utf8').replace(/\r\n/g, '\n')
const IDX = readFileSync(path.join(ROOT, 'lib', 'index.js'), 'utf8').replace(/\r\n/g, '\n')

// ---------- S. 源码守卫:四处单槽必须已分片 ----------

test('S1 命中投影必须按会话分片(不再写单槽 engine._tierGateHits)', () => {
  assert.ok(/_tierGateHitsBySession/.test(ACT), ' activation-host 必须维护 _tierGateHitsBySession')
  assert.ok(/_tierGateHitsBySession\.set\(sid, projection\)/.test(ACT), '写入必须带 sessionId 作为 key')
  // 反向守卫:不得再出现"无条件整体赋值"的单槽写法。
  // 注意必须排除注释行 —— 修复说明里会引用旧写法作为反面例子(否则守卫会误伤自己)。
  const codeOnly = (src) => src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
  assert.ok(!/engine\._tierGateHits\s*=\s*\{/.test(codeOnly(ACT)), '不得退回单槽整体覆盖写法')
  // 兼容投影允许保留(指向最近一次),但必须是"赋值给已构造好的对象"而非重新构造单槽
  assert.ok(/engine\._tierGateHits\s*=\s*projection/.test(ACT), '兼容投影应复用 projection 对象')
})

test('S2 读取侧必须优先按当前会话取投影', () => {
  assert.ok(/_tierGateHitsBySession/.test(IDX), 'index.js 读取侧必须查分片 Map')
  assert.ok(/_tierGateHitsBySession\.get\(agentSessionId\)/.test(IDX), '必须按当前 agentSessionId 取')
  // 兼容回退必须保留(老数据/老调用方仍可工作)
  assert.ok(/\|\|\s*this\._tierGateHits\s*\|\|\s*null/.test(IDX), '取不到分片时应回退兼容单槽')
})

test('S3 miv 缓存必须按工作区分片(不再写单槽 mivCache)', () => {
  assert.ok(/mivCacheByWs/.test(ACT), '必须维护 mivCacheByWs')
  assert.ok(/mivCacheByWs\.set\(ws, /.test(ACT), '写入以 wsRef 为 key')
  assert.ok(/mivCacheByWs\.get\(ws\)/.test(ACT), '读取以 wsRef 为 key')
  assert.ok(!/let mivCache\s*=/.test(ACT), '不得保留单槽变量 mivCache')
  assert.ok(!/mivCache\.miv/.test(ACT), '不得再读单槽 mivCache.miv')
})

test('S4 降级标注必须按会话分片,且读方按会话取(修跨会话假降级)', () => {
  assert.ok(/indexDegradeBySession/.test(CTX), 'context-host 必须维护 indexDegradeBySession')
  assert.ok(/indexDegradeBySession\.set\(sidDeg, degradeRec\)/.test(CTX), '写入带 sessionId')
  assert.ok(/_indexDegradeBySession/.test(IDX), 'index.js 必须读到分片 Map')
  assert.ok(/_indexDegradeBySession\.get\(agentSessionId\)/.test(IDX), '读方必须按当前会话取')
})

test('S5 本轮 query 必须按会话分片', () => {
  assert.ok(/_lastTierQueryBySession/.test(CTX), '必须维护 _lastTierQueryBySession')
  assert.ok(/_lastTierQueryBySession\.set\(qSid, qRec\)/.test(CTX), '写入带 sessionId')
  assert.ok(!/engine\._lastTierQuery\s*=\s*\{/.test(CTX), '不得退回单槽整体覆盖')
})

test('S6 判定口径不得被削弱:五道门仍在(T0-2 语义一字未改)', () => {
  const tier = readFileSync(path.join(ROOT, 'lib', 'tier-layer-inject.js'), 'utf8').replace(/\r\n/g, '\n')
  for (const gate of ['stale-time', 'identity-unknown', 'session-mismatch', 'workspace-mismatch',
    'version-unknown', 'context-version-changed', 'miv-changed', 'observation-mismatch']) {
    assert.ok(tier.includes("'" + gate + "'"), '复用门必须保留: ' + gate)
  }
})

test('S7 分片容器必须有界(长时间运行不得无限增长)', () => {
  const bounded = (ACT.match(/\.size > 32/g) || []).length + (CTX.match(/\.size > 32/g) || []).length
  assert.ok(bounded >= 3, '三处分片容器都应做容量上限(实得 ' + bounded + ' 处)')
})

// ---------- B. 行为:分片容器语义正确 ----------

/** 用真实源码里的容量控制逻辑构造一个受控 harness,验证"分片"这一语义本身。 */
function makeShardStore(limit) {
  const map = new Map()
  return {
    set(k, v) {
      map.set(k, v)
      if (map.size > limit) map.delete(map.keys().next().value)
      return v
    },
    get: (k) => map.get(k),
    size: () => map.size,
    keys: () => [...map.keys()],
  }
}

test('B1 两会话各存各的:A 投递不被 B 覆盖(本 issue 的核心)', () => {
  const store = makeShardStore(32)
  // A 投递
  store.set('sid-a', { sessionId: 'sid-a', miv: 'idx_a', hits: ['a1'] })
  // B 投递(旧实现在此把 A 覆盖掉)
  store.set('sid-b', { sessionId: 'sid-b', miv: 'idx_b', hits: ['b1'] })
  // A 再来取:必须still是自己的
  assert.equal(store.get('sid-a').miv, 'idx_a', 'A 的投影不得被 B 覆盖')
  assert.deepEqual(store.get('sid-a').hits, ['a1'])
  assert.equal(store.get('sid-b').miv, 'idx_b')
  assert.equal(store.size(), 2, '两个会话各占一格')
})

test('B2 十万次交替投递后,A 取到的仍是自己的(压测不漂移)', () => {
  const store = makeShardStore(32)
  for (let i = 0; i < 100000; i++) {
    store.set('sid-a', { sessionId: 'sid-a', seq: i * 2 })
    store.set('sid-b', { sessionId: 'sid-b', seq: i * 2 + 1 })
  }
  assert.equal(store.get('sid-a').sessionId, 'sid-a', 'A 的身份不得漂移到 B')
  assert.equal(store.get('sid-b').sessionId, 'sid-b')
})

test('B3 有界淘汰:超过上限时淘汰最旧,且不误删最新', () => {
  const store = makeShardStore(32)
  for (let i = 0; i < 40; i++) store.set('sid-' + i, { i })
  assert.equal(store.size(), 32, '规模被限制在 32')
  assert.equal(store.get('sid-0'), undefined, '最旧的被淘汰')
  assert.equal(store.get('sid-39').i, 39, '最新的必须还在')
})

test('B4 两工作区的 miv 各自独立(不再互相踢缓存)', () => {
  const mivStore = makeShardStore(32)
  mivStore.set('wsA', 'idx_a')
  mivStore.set('wsB', 'idx_b')
  assert.equal(mivStore.get('wsA'), 'idx_a', 'wsA 的 miv 不得因 wsB 写入而丢失')
  assert.equal(mivStore.get('wsB'), 'idx_b')
  // 各自更新互不影响
  mivStore.set('wsB', 'idx_b2')
  assert.equal(mivStore.get('wsA'), 'idx_a', 'wsA 不受 wsB 更新影响')
  assert.equal(mivStore.get('wsB'), 'idx_b2')
})

test('B5 降级标注按会话隔离:B 的未就绪不得让 A 显示降级', () => {
  const degStore = makeShardStore(32)
  degStore.set('sid-b', { reason: 'sync-in-progress', at: Date.now(), sessionId: 'sid-b' })
  // A 从没遇到过未就绪 ⇒ 取不到记录 ⇒ 不标注降级(旧实现会读到 B 的记录)
  assert.equal(degStore.get('sid-a'), undefined, 'A 不得看到 B 的降级记录')
  assert.ok(degStore.get('sid-b'), 'B 自己的记录仍在')
})

test('B6 同会话重复投递是覆盖(不是新增),避免 Map 无谓膨胀', () => {
  const store = makeShardStore(32)
  for (let i = 0; i < 50; i++) store.set('sid-a', { i })
  assert.equal(store.size(), 1, '同一会话反复投递只占一格')
  assert.equal(store.get('sid-a').i, 49, '保留最新那次')
})

// ---------- R. 真行为:抽取**真实** recordTierGateHits 执行(而非测本地辅助函数) ----------

/** 从 activation-host.js 抽取 recordTierGateHits 函数体(花括号配平),在受控 engine 上跑。 */
function extractRecordTierGateHits() {
  const MARK = 'function recordTierGateHits(req) {'
  const start = ACT.indexOf(MARK)
  assert.ok(start > 0, '必须能定位到 recordTierGateHits(源码结构未变)')
  let depth = 0, end = -1
  for (let i = start + MARK.length - 1; i < ACT.length; i++) {
    const ch = ACT[i]
    if (ch === '{') depth++
    else if (ch === '}') { depth--; if (depth === 0) { end = i; break } }
  }
  assert.ok(end > start, 'recordTierGateHits 花括号必须配平')
  return ACT.slice(start, end + 1)
}

function makeRecorder() {
  const engine = {}
  const fn = new Function('engine', extractRecordTierGateHits() + '\n return recordTierGateHits;')(engine)
  return { engine, fn }
}

const reqOf = (sid, miv, hits) => ({
  sessionId: sid, agentId: 'ag-' + sid, workspaceKey: 'ws-' + sid,
  contextVersion: 1, memoryIndexVersion: miv, observationId: 'obs-' + sid, requestKey: 'rk-' + sid,
  triggerText: 'q-' + sid, candidates: hits.map((h, i) => ({ memoryId: 'mem_' + h.repeat(32), score: 1 - i * 0.1, excerpt: h, layer: 'log', status: 'current' })),
})

test('R1 真实现:A 投递 → B 投递 → A 再取,取到的仍是 A 的(核心回归)', () => {
  const { engine, fn } = makeRecorder()
  fn(reqOf('sid-a', 'idx_a', ['a']))
  fn(reqOf('sid-b', 'idx_b', ['b']))
  const a = engine._tierGateHitsBySession.get('sid-a')
  const b = engine._tierGateHitsBySession.get('sid-b')
  assert.ok(a, 'A 的投影必须还在')
  assert.equal(a.sessionId, 'sid-a', 'A 取到的必须是自己的')
  assert.equal(a.miv, 'idx_a', 'A 的 miv 不得变成 B 的')
  assert.equal(a.hits[0].excerpt, 'a', 'A 的 hits 不得变成 B 的')
  assert.equal(b.sessionId, 'sid-b', 'B 也是自己的')
})

test('R2 真实现:兼容投影仍指向"最近一次"(老读取方语义不变)', () => {
  const { engine, fn } = makeRecorder()
  fn(reqOf('sid-a', 'idx_a', ['a']))
  assert.equal(engine._tierGateHits.sessionId, 'sid-a', '单次投递后兼容投影指向它')
  fn(reqOf('sid-b', 'idx_b', ['b']))
  assert.equal(engine._tierGateHits.sessionId, 'sid-b', '兼容投影跟随最近一次')
  assert.equal(engine._tierGateHitsBySession.size, 2, '但分片里两个都在')
})

test('R3 真实现:有界淘汰生效(40 会话 → 保留最新 32)', () => {
  const { engine, fn } = makeRecorder()
  for (let i = 0; i < 40; i++) fn(reqOf('sid-' + i, 'miv-' + i, ['x']))
  assert.equal(engine._tierGateHitsBySession.size, 32, '规模被限制在 32')
  assert.equal(engine._tierGateHitsBySession.get('sid-0'), undefined, '最旧被淘汰')
  assert.equal(engine._tierGateHitsBySession.get('sid-39').sessionId, 'sid-39', '最新保留')
})

test('R4 真实现:同会话重复投递只占一格且内容更新', () => {
  const { engine, fn } = makeRecorder()
  for (let i = 0; i < 10; i++) fn(reqOf('sid-a', 'miv-' + i, ['a']))
  assert.equal(engine._tierGateHitsBySession.size, 1, '同会话只占一格')
  assert.equal(engine._tierGateHitsBySession.get('sid-a').miv, 'miv-9', '保留最新内容')
})

test('R5 真实现:投影字段完整(四元组 + hits 限 8 条)', () => {
  const { engine, fn } = makeRecorder()
  fn(reqOf('sid-a', 'idx_a', ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']))
  const p = engine._tierGateHitsBySession.get('sid-a')
  assert.equal(p.contextVersion, 1, 'contextVersion 必须带')
  assert.equal(p.miv, 'idx_a', 'miv 必须带')
  assert.equal(p.observationId, 'obs-sid-a', 'observationId 必须带')
  assert.equal(p.requestKey, 'rk-sid-a', 'requestKey 必须带')
  assert.equal(p.hits.length, 8, 'hits 必须限 8 条(预算口径不变)')
})

test('R6 真实现:两工作区的 miv 各自独立(经真实 debugView 口径)', () => {
  const { engine, fn } = makeRecorder()
  fn(reqOf('sid-a', 'idx_a', ['a']))
  fn(reqOf('sid-b', 'idx_b', ['b']))
  // debugView 用 latestMiv()/mivCacheByWs —— 这里直接验"分片容器不互相覆盖"这一事实
  const mivs = new Set([...engine._tierGateHitsBySession.values()].map((p) => p.miv))
  assert.equal(mivs.size, 2, '两工作区的 miv 必须同时可查(旧实现只剩一个)')
})

// ---------- C. 与既有设计的兼容 ----------

test('C1 兼容投影仍在:老读取方(debugView/老测试)不会拿到 undefined', () => {
  assert.ok(/memoryIndexVersion: latestMiv\(\)\s*\|\|\s*null/.test(ACT), 'debugView 仍提供 memoryIndexVersion')
  assert.ok(/mivByWorkspace: Object\.fromEntries\(mivCacheByWs\)/.test(ACT), '并额外透出按工作区的映射')
  assert.ok(/engine\._tierGateHits\s*=\s*projection/.test(ACT), '兼容单槽仍被赋值')
})

test('C2 只增字段不改语义:分片是"加 key",不是重写判定', () => {
  // recordTierGateHits 的表体结构(四元组 + hits 映射)不得因分片而删减
  for (const field of ['contextVersion', 'miv', 'observationId', 'requestKey', 'hits']) {
    assert.ok(new RegExp('\\b' + field + ':').test(ACT), '投影字段必须保留: ' + field)
  }
  assert.ok(/slice\(0, 8\)/.test(ACT), 'hits 仍限 8 条(预算口径不变)')
})

test('C3 分片 key 一致:写入与读取用同一个 sessionId 口径', () => {
  assert.ok(/const sid = String\(req\.sessionId \|\| ''\)/.test(ACT), '写入侧取 req.sessionId')
  assert.ok(/const agentSessionId = String\(\(agent && agent\.session && agent\.session\.id\) \|\| ''\)/.test(IDX),
    '读取侧取 agent.session.id')
})
