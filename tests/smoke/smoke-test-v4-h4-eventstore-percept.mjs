#!/usr/bin/env node
/**
 * smoke-test-v4-h4-eventstore-percept.mjs —— H4 后端数据层：list() 的 percept 投影验收。
 *
 * 判据来源：V4-CODE-LEVEL-SPEC §6（四 percept 接线）+ MASTER-PLAN §3.1（严格 16 顶层字段）
 * 风险来源（Lead 实测）：list() 有 6 处调用点 ⇒ 必须**可选开关、默认关闭**，
 *   否则接续/指纹/未归档扫描 5 处内部调用点的返回形状全变。
 *
 * 纪律（CR-10）：
 *   ① 真 import → 真构造 → 真调用 → 断言返回值（禁止「源码含某字符串」当功能验收）；
 *   ② 每条正向都配负路径；
 *   ③ 变异验证：把默认改 true ⇒ 负路径**必红**；还原 ⇒ 必绿（双向，子进程实跑）；
 *   ④ 全部在临时目录里跑，绝不碰真实 handoff/。
 *
 * 覆盖 Lead 特别点名的「半修」风险：**all 分支与分页分支两个都要测**。
 */
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  eventStorePre, EVENT_STORE_FILENAME, writeStorePre, emptyEventPre,
  PERCEPT_LIST_TAIL, PANEL_DIGEST_CHECKPOINT_TAIL, PERCEPT_ITEM_FIELDS,
} from '../../lib/event-store.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const STORE_SRC = path.join(HERE, '..', '..', 'lib', 'event-store.js')
const INDEX_SRC = path.join(HERE, '..', '..', 'lib', 'index.js')

let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  PASS ' + m) } else { fail++; console.log('  FAIL ' + m) } }
const eq = (a, b, m) => ok(Object.is(a, b), m + '  (got=' + JSON.stringify(a) + ' want=' + JSON.stringify(b) + ')')

const root = mkdtempSync(path.join(tmpdir(), 'dam-v4-h4-percept-'))
const storePath = path.join(root, 'handoff', EVENT_STORE_FILENAME)

// ── 造数：一个事件，含 4 个 percept 各 7 条（>5，用来验 slice(-5)）+ 5 个检查点（>3，验 slice(-3)）
async function seed() {
  const ev = await eventStorePre.create(storePath, {
    name: 'H4 验收事件', summary: '用于验证 list(withPercept) 的投影',
    sections: { goal: '验证四 percept 能到前端', doing: '造数', deadend: '', next: '' },
  })
  for (let i = 1; i <= 7; i++) {
    await eventStorePre.append(storePath, ev.id, { userPercept: { stage: 'accepted', kind: 'preference', text: '用户偏好X' + i } })
    await eventStorePre.append(storePath, ev.id, { agentTrace: { action: 'act' + i, result: 'r' + i, wasRefuted: false } })
    await eventStorePre.append(storePath, ev.id, { sharedGround: { claim: 'claim' + i, confirmedBy: 'user' } })
    await eventStorePre.append(storePath, ev.id, { commitment: { promise: 'promise' + i, boundary: 'b' + i, state: 'open' } })
  }
  for (let i = 1; i <= 5; i++) {
    await eventStorePre.append(storePath, ev.id, {
      checkpoint: {
        kind: 'log', text: '第' + i + '个检查点', idemKey: 'ck' + i,
        panels: [{ kind: 'state', text: '状态' + i }, { kind: 'log', text: '日志' + i }],
      },
    })
  }
  return ev.id
}

async function main() {
  const evId = await seed()

  // ══════════ 正向 ══════════
  console.log('[P-1] 正向·分页分支：withPercept:true 回传四个 percept')
  const paged = await eventStorePre.list(storePath, { limit: 1, withPercept: true })
  eq(paged.events.length, 1, '分页分支返回 1 条')
  const evP = paged.events[0]
  for (const k of ['userPercept', 'agentTrace', 'sharedGround', 'commitments']) {
    ok(Array.isArray(evP[k]), '分页分支含 ' + k + ' 数组')
  }
  ok(evP.userPercept.length === PERCEPT_LIST_TAIL, 'userPercept 被裁到最近 ' + PERCEPT_LIST_TAIL + ' 条（原 7 条）')
  eq(evP.userPercept[evP.userPercept.length - 1].text, '用户偏好X7', '裁的是**最近**的（末条=第7条，不是第1条）')
  eq(evP.userPercept[0].stage, 'accepted', 'stage 字段保留（SPEC-v2 §2.2 硬要求）')
  eq(evP.userPercept[0].kind, 'preference', 'kind 字段保留')
  eq(evP.agentTrace.length, PERCEPT_LIST_TAIL, 'agentTrace 同样裁到 ' + PERCEPT_LIST_TAIL)
  eq(evP.sharedGround.length, PERCEPT_LIST_TAIL, 'sharedGround 同样裁到 ' + PERCEPT_LIST_TAIL)
  eq(evP.commitments.length, PERCEPT_LIST_TAIL, 'commitments 同样裁到 ' + PERCEPT_LIST_TAIL)
  eq(evP.commitments[0].promise, 'promise3', 'commitments 保留最近 5 条（第3..7条 ⇒ 首条 promise3）')

  console.log('[P-2] 正向·all 分支：withPercept:true 同样回传（防「只改一个分支」半修）')
  const allRes = await eventStorePre.list(storePath, { all: true, withPercept: true })
  eq(allRes.events.length, 1, 'all 分支返回 1 条')
  const evAll = allRes.events[0]
  for (const k of ['userPercept', 'agentTrace', 'sharedGround', 'commitments']) {
    ok(Array.isArray(evAll[k]), 'all 分支含 ' + k + ' 数组')
  }
  eq(evAll.userPercept.length, PERCEPT_LIST_TAIL, 'all 分支 userPercept 也裁到 ' + PERCEPT_LIST_TAIL)
  eq(JSON.stringify(evAll.userPercept), JSON.stringify(evP.userPercept), '两个分支的 percept 投影逐字节相同（同源实现）')

  console.log('[P-3] 正向·panelDigest：从最近 3 个检查点的 panels 扁平汇总')
  ok(Array.isArray(evAll.panelDigest), 'panelDigest 是数组')
  // 5 个检查点各 2 个 panel，只取最近 3 个 ⇒ 6 条
  eq(evAll.panelDigest.length, PANEL_DIGEST_CHECKPOINT_TAIL * 2, 'panelDigest 条数 = 最近 ' + PANEL_DIGEST_CHECKPOINT_TAIL + ' 检查点 × 2 panel')
  eq(evAll.panelDigest[0].kind, 'state', '第 1 条 panel kind=state')
  eq(evAll.panelDigest[0].text, '状态3', '第 1 条来自第 3 个检查点（最近 3 个 = 3,4,5）')
  eq(evAll.panelDigest[5].text, '日志5', '末条来自第 5 个检查点')
  ok(Object.keys(evAll.panelDigest[0]).sort().join(',') === 'kind,text', 'panelDigest 条目**只有** kind+text（不含 at/sourceRef/idemKey）')

  console.log('[P-4] 正向·基础 7 字段仍在（附加而非替换）')
  const BASE7 = ['id', 'name', 'summary', 'status', 'sections', 'updatedAt', 'checkpointCount']
  for (const k of BASE7) ok(k in evAll, 'withPercept:true 时基础字段仍在：' + k)
  eq(evAll.checkpointCount, 5, 'checkpointCount=5（仍是数字，不是正文）')
  ok(!('checkpoints' in evAll), 'withPercept:true **仍不**回传 checkpoints 正文（正文走 /event-detail）')

  console.log('[P-5] 正向·未知字段被丢弃（防将来塞大对象撑爆响应）')
  const dirtyPath = path.join(root, 'dirty', EVENT_STORE_FILENAME)
  const dirty = emptyEventPre('脏数据事件', { id: 'evt_0a0b0c0d' })
  dirty.userPercept = [{ at: 1, kind: 'x', stage: 'accepted', text: 'T', sourceRef: null, HUGE_BLOB: { big: 'x'.repeat(5000) }, extraKey: 1 }]
  dirty.agentTrace = [{ at: 1, action: 'a', result: null, wasRefuted: false, sourceRef: null, nope: 'n'.repeat(5000) }]
  dirty.checkpoints = [{ at: 1, kind: 'log', text: 'c', sourceRef: null, panels: [{ kind: 'state', text: 'p' }], idemKey: null }]
  await writeStorePre(dirtyPath, { schema: 'v4_event_store_v1', events: [dirty], updatedAt: 1 })
  const dirtyRes = await eventStorePre.list(dirtyPath, { all: true, withPercept: true })
  const dEv = dirtyRes.events[0]
  ok(!('HUGE_BLOB' in dEv.userPercept[0]), '负向守卫：未知字段 HUGE_BLOB 被丢弃')
  ok(!('extraKey' in dEv.userPercept[0]), '未知字段 extraKey 被丢弃')
  eq(Object.keys(dEv.userPercept[0]).sort().join(','), PERCEPT_ITEM_FIELDS.userPercept.slice().sort().join(','), 'userPercept 条目字段集 == 契约白名单')
  eq(Object.keys(dEv.agentTrace[0]).sort().join(','), PERCEPT_ITEM_FIELDS.agentTrace.slice().sort().join(','), 'agentTrace 条目字段集 == 契约白名单')
  ok(JSON.stringify(dEv).length < 2000, '整条投影 < 2000 字符（大对象确实没被带出）实测=' + JSON.stringify(dEv).length)

  console.log('[P-6] 正向·空 percept 不炸且 panelDigest=[]')
  const plainPath = path.join(root, 'plain', EVENT_STORE_FILENAME)
  const plain = emptyEventPre('空 percept 事件', { id: 'evt_0e0f0a0b' })
  await writeStorePre(plainPath, { schema: 'v4_event_store_v1', events: [plain], updatedAt: 1 })
  const plainRes = await eventStorePre.list(plainPath, { all: true, withPercept: true })
  eq(plainRes.events[0].userPercept.length, 0, '空 userPercept ⇒ []')
  eq(plainRes.events[0].panelDigest.length, 0, '无检查点 ⇒ panelDigest=[]')
  ok(plainRes.ok === true, '不抛错、ok=true')

  // ══════════ 负向（向后兼容硬判据） ══════════
  console.log('[N-1] 负向·默认关闭：list(p,{}) 不含任何 percept 字段')
  const dflt = await eventStorePre.list(storePath, {})
  const dEvt = dflt.events[0]
  for (const k of ['userPercept', 'agentTrace', 'sharedGround', 'commitments', 'panelDigest']) {
    ok(!(k in dEvt), '默认 list 返回体**不含** ' + k)
  }

  console.log('[N-2] 负向·all 分支默认也关闭')
  const dfltAll = await eventStorePre.list(storePath, { all: true })
  for (const k of ['userPercept', 'agentTrace', 'sharedGround', 'commitments', 'panelDigest']) {
    ok(!(k in dfltAll.events[0]), 'all 分支默认**不含** ' + k)
  }

  console.log('[N-3] 负向·默认返回形状与旧契约**逐字节等价**（key 顺序也一致）')
  const OLD_KEYS = ['id', 'name', 'summary', 'status', 'sections', 'updatedAt', 'checkpointCount']
  eq(Object.keys(dEvt).join(','), OLD_KEYS.join(','), '默认返回 key 顺序 == 旧契约顺序')
  eq(Object.keys(dfltAll.events[0]).join(','), OLD_KEYS.join(','), 'all 分支 key 顺序也一致')
  eq(Object.keys(dEvt).length, 7, '默认返回恰好 7 个 key')

  console.log('[N-4] 负向·withPercept:false 显式传入 == 不传')
  const explicitFalse = await eventStorePre.list(storePath, { all: true, withPercept: false })
  eq(JSON.stringify(explicitFalse.events[0]), JSON.stringify(dfltAll.events[0]), '显式 false 与缺省输出逐字节相同')

  console.log('[N-5] 负向·withPercept 用真值判断，非 true 一律不加（含 1/"yes" 等宽松值）')
  for (const v of [1, 'yes', 'true', {}]) {
    const r = await eventStorePre.list(storePath, { all: true, withPercept: v })
    ok(!('userPercept' in r.events[0]), 'withPercept=' + JSON.stringify(v) + ' ⇒ 不加字段（严格 === true）')
  }

  console.log('[N-6] 负向·5 处内部调用点源码不得出现 withPercept')
  const idxSrc = readFileSync(INDEX_SRC, 'utf8')
  // ⚠️ 不能用 /list\(([^)]*)\)/ —— event-list 路由的参数里含 Number(q.get('cursor')) 这种嵌套括号，
  //   非配平正则会把它截断成 "…Number(q.get('cursor'" ⇒ 看不到后面的 withPercept ⇒ 假红（本轮实测踩过）。
  //   这里做**括号配平扫描**：从每个 "eventStorePre.list(" 起点走到配平的右括号。
  const calls = []
  {
    const NEEDLE = 'eventStorePre.list('
    let from = 0
    for (;;) {
      const at = idxSrc.indexOf(NEEDLE, from)
      if (at < 0) break
      let i = at + NEEDLE.length
      let depth = 1
      let quote = ''
      while (i < idxSrc.length && depth > 0) {
        const ch = idxSrc[i]
        if (quote) { if (ch === '\\') { i += 2; continue } if (ch === quote) quote = '' }
        else if (ch === "'" || ch === '"' || ch === '`') quote = ch
        else if (ch === '(') depth++
        else if (ch === ')') depth--
        i++
      }
      calls.push(idxSrc.slice(at + NEEDLE.length, i - 1).replace(/\s+/g, ' ').trim())
      from = i
    }
  }
  // ★2026-10-25 判据更新（v4-H10-b，属**判据过期**不是缺陷）：A 线新增 `writeCuratedEventsPre` 时
  //   为做「幂等前置（先算已归档集合）」新增了 **1 处** `eventStorePre.list(storePath, { all: true })`，
  //   位置在 L7251。本锁的**意图**是「既有内部调用点不得被 withPercept 污染」，不是钉死总数；
  //   新增一个**不带宽字段**的内部调用点不违反该意图 ⇒ 计数随功能演进上调（6 → 7）。
  //   下面的「只有 1 处带 withPercept」断言**保持不变**，那才是真正的不变量。
  // ★2026-10-25 判据更新（第二次，v4-H3-C3，同属**判据过期**不是缺陷）：
  //   H3-C3 的 `memory_status({op:"upgrade-plan"})` 需要读「当前有几个事件」来填检测详情，
  //   在工具分支里新增了 **1 处** `eventStorePre.list(_st, { all: true })`。
  //   ★该调用点**不带宽字段**（不带 withPercept）⇒ 不违反本锁的意图（既有内部调用点不得被污染）。
  //   ⇒ 计数 7 → 8。「只有 1 处带 withPercept」这条不变量**保持不变**。
  eq(calls.length, 8, 'index.js 里 eventStorePre.list 调用点恰好 8 处（H10-b 幂等前置 1 + H3-C3 检测详情 1）')
  const withP = calls.filter((c) => c.includes('withPercept'))
  eq(withP.length, 1, '其中只有 1 处带 withPercept')
  ok(withP[0] && withP[0].includes("q.get('cursor')"), '带 withPercept 的那处是 event-list 路由（按 q.get(cursor) 识别）')
  // 逐个点名 5 处内部调用点：调用文本必须逐字等于旧写法（不含 withPercept）
  const INTERNAL = [
    'eventStorePre.list(_evStore, { all: true })',
    'eventStorePre.list(_evp, { all: true })',
    'eventStorePre.list(evStorePath, { all: true })',
  ]
  for (const lit of INTERNAL) ok(idxSrc.includes(lit), '内部调用点保持旧写法逐字未变：' + lit)
  // ★2026-10-25 同源上调（2 → 3）：新增的 L7251 那处也是 `list(storePath, { all: true })` 逐字写法，
  //   与既有 2 处同口径（证明新代码复用了既有读法，而不是另造一个读法）。
  eq(idxSrc.split('eventStorePre.list(storePath, { all: true })').length - 1, 3, 'list(storePath,{all:true}) 共 3 处且逐字一致（含 H10-b 新增的 1 处）')

  // ══════════ 变异验证（子进程实跑，双向） ══════════
  console.log('[M-1] 变异：把 withPercept 默认改成 true ⇒ 负路径**必红**')
  const original = readFileSync(STORE_SRC, 'utf8')
  const origSha = createHash('sha256').update(original).digest('hex')
  const mutant = original.replace('status = null, withPercept = false }', 'status = null, withPercept = true }')
  ok(mutant !== original, '变异点命中（默认值被改写）')
  ok(original.split('withPercept = false').length - 1 === 1, '默认值字面在源码里恰好 1 处（变异可定位）')

  // 负路径探针：默认调用必须**不含** userPercept；含 ⇒ exit 1
  const probePath = path.join(root, 'probe-default-neg.mjs')
  writeFileSync(probePath, [
    'import { eventStorePre, writeStorePre, emptyEventPre } from ' + JSON.stringify(pathToFileURL(STORE_SRC).href),
    'const p = ' + JSON.stringify(path.join(root, 'probe', EVENT_STORE_FILENAME)),
    'const ev = emptyEventPre("探针事件", { id: "evt_11112222" })',
    'ev.userPercept = [{ at: 1, kind: "x", stage: "accepted", text: "T", sourceRef: null }]',
    'await writeStorePre(p, { schema: "v4_event_store_v1", events: [ev], updatedAt: 1 })',
    'const r = await eventStorePre.list(p, {})',
    'const has = Object.prototype.hasOwnProperty.call(r.events[0], "userPercept")',
    'console.log("probe has userPercept(default)=" + has)',
    'process.exit(has ? 1 : 0)',
  ].join('\n'), 'utf8')

  let mutatedOk = false
  try {
    writeFileSync(STORE_SRC, mutant, 'utf8')
    const bad = spawnSync(process.execPath, [probePath], { encoding: 'utf8' })
    mutatedOk = bad.status === 1
    ok(mutatedOk, '变异体下负路径探针 exit=1（**必红**，实测 status=' + bad.status + '）')
    ok(String(bad.stdout || '').includes('has userPercept(default)=true'), '探针输出确认默认调用带出了 userPercept（变异生效的正面证据）')
  } finally {
    writeFileSync(STORE_SRC, original, 'utf8')
  }
  const restored = readFileSync(STORE_SRC, 'utf8')
  eq(createHash('sha256').update(restored).digest('hex'), origSha, '还原后 sha256 与快照一致（文件逐字节复原）')

  console.log('[M-2] 还原后复跑同一探针 ⇒ 必绿（双向闭合）')
  const good = spawnSync(process.execPath, [probePath], { encoding: 'utf8' })
  eq(good.status, 0, '还原后负路径探针 exit=0（实测 status=' + good.status + '）')
  ok(String(good.stdout || '').includes('has userPercept(default)=false'), '探针输出确认默认调用不带 userPercept')

  console.log('')
  console.log('[H4-BE] ' + pass + ' PASS / ' + fail + ' FAIL')
  rmSync(root, { recursive: true, force: true })
  process.exit(fail ? 1 : 0)
}

main().catch((e) => {
  console.log('  FAIL 套件异常: ' + ((e && e.stack) || e))
  try { rmSync(root, { recursive: true, force: true }) } catch (_) {}
  process.exit(1)
})
