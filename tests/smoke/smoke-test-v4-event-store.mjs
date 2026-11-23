#!/usr/bin/env node
/**
 * smoke-test-v4-event-store.mjs —— 批次 A 数据层：lib/event-store.js 的行为验收。
 *
 * 纪律（CR-10）：真 import → 真构造 → 真调用 → 断言返回值/副作用；每条正向都配负路径。
 * 全部在**临时目录**里跑，绝不碰真实 handoff/。
 */
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  eventStorePre, EVENT_STORE_FILENAME, EVENT_TOP_FIELDS, PANEL_KINDS, PERCEPT_STAGES,
  readStorePre, validateEventPre, emptyEventPre,
} from '../../lib/event-store.js'

let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  PASS ' + m) } else { fail++; console.log('  FAIL ' + m) } }
const eq = (a, b, m) => ok(Object.is(a, b), m + '  (got=' + JSON.stringify(a) + ' want=' + JSON.stringify(b) + ')')
const throws = async (fn, re, m) => {
  try { await fn(); ok(false, m + ' —— 期望抛错但没有') }
  catch (e) { ok(re.test(String(e.message)), m + '  (message=' + String(e.message).slice(0, 90) + ')') }
}

const root = mkdtempSync(path.join(tmpdir(), 'dam-v4-eventstore-'))
const storePath = path.join(root, 'handoff', EVENT_STORE_FILENAME)

async function main() {
  console.log('[A-1] create：返回严格 16 字段 + 落盘 + 原子写（无 .tmp 残留）')
  const ev = await eventStorePre.create(storePath, { name: '演示事件', summary: '一段总览' })
  // ★2026-10-27 v2：字段数 16 → 26（对齐 prototype：+startMs/endMs/members/rationale/kind/confidence/outcomes/ordinal/skills/idemTag）
  eq(Object.keys(ev).length, 26, '返回事件恰好 26 个顶层字段')
  eq(EVENT_TOP_FIELDS.length, 26, '契约常量也声明 26 个')
  ok(/^evt_[0-9a-f]{8}$/.test(ev.id), 'id 形如 evt_<8hex>（不带 pre）id=' + ev.id)
  eq(ev.status, 'active', 'create 默认 active')
  const store1 = JSON.parse(readFileSync(storePath, 'utf8'))
  eq(store1.events.length, 1, '落盘 1 个事件')
  eq(store1.events[0].id, ev.id, '落盘 id 与返回值一致')
  ok(!existsSync(storePath + '.tmp'), '无 .tmp 文件残留（原子写）')
  await throws(() => eventStorePre.create(storePath, { name: '   ' }), /name 不能为空/, '负：name 全空白 ⇒ 报错')
  await throws(() => eventStorePre.create(storePath, {}), /name 不能为空/, '负：缺 name ⇒ 报错')

  console.log('[A-2] append checkpoint：length +1；idemKey 二次 ⇒ 去重不重复加')
  const a1 = await eventStorePre.append(storePath, ev.id, { checkpoint: { kind: 'progress', text: '第一条', idemKey: 'k1' } })
  eq(a1.appended, 1, '第一次 append +1')
  eq(a1.checkpointCount, 1, 'checkpointCount=1')
  const a2 = await eventStorePre.append(storePath, ev.id, { checkpoint: { kind: 'progress', text: '第一条重试', idemKey: 'k1' } })
  eq(a2.appended, 0, '负路径：同 idemKey 二次 append 不重复加（appended=0）')
  eq(a2.deduped, true, '且显式报告 deduped=true（不静默）')
  eq(a2.checkpointCount, 1, 'checkpointCount 仍为 1')
  const a3 = await eventStorePre.append(storePath, ev.id, { checkpoint: { kind: 'log', text: '第二条' } })
  eq(a3.checkpointCount, 2, '不同 key ⇒ 正常 +1')
  await throws(() => eventStorePre.append(storePath, ev.id, { checkpoint: { kind: 'x', text: 'y', panels: [{ kind: 'never-registered', text: 't' }] } }), /未注册的 panel kind/, '负：未注册 panel kind ⇒ 报错')
  await throws(() => eventStorePre.append(storePath, ev.id, { userPercept: { stage: 'emotionally-touched' } }), /非法 stage/, '负：非法 stage ⇒ 报错')
  await throws(() => eventStorePre.append(storePath, ev.id, {}), /没有任何可追加的内容/, '负：空 append ⇒ 报错')

  console.log('[A-3] set：字段更新 + updatedAt 变；非法字段 ⇒ 报错')
  const before = (await eventStorePre.detail(storePath, ev.id)).event.updatedAt
  await new Promise((r) => setTimeout(r, 5))
  const s1 = await eventStorePre.set(storePath, ev.id, { summary: '改过的总览', sections: { goal: '目标A' } })
  eq(s1.summary, '改过的总览', 'summary 已更新')
  eq(s1.sections.goal, '目标A', 'sections.goal 已更新')
  ok(s1.updatedAt > before, 'updatedAt 确实变大（' + before + ' → ' + s1.updatedAt + '）')
  await throws(() => eventStorePre.set(storePath, ev.id, { id: 'evt_00000000' }), /非法字段 id/, '负：试图改 id ⇒ 拒绝')
  await throws(() => eventStorePre.set(storePath, ev.id, { checkpoints: [] }), /非法字段 checkpoints/, '负：试图改 checkpoints ⇒ 拒绝（append-only）')
  await throws(() => eventStorePre.set(storePath, ev.id, {}), /patch 不能为空/, '负：空 patch ⇒ 报错')
  await throws(() => eventStorePre.set(storePath, 'evt_ffffffff', { summary: 'x' }), /事件不存在/, '负：不存在的事件 ⇒ 报错')

  console.log('[A-4] close：缺 outcome ⇒ 报错；成功后 status=closed；再 close 幂等')
  await throws(() => eventStorePre.close(storePath, ev.id, ''), /缺 outcome/, '负：缺 outcome ⇒ 报错')
  await throws(() => eventStorePre.close(storePath, ev.id), /缺 outcome/, '负：不传 outcome ⇒ 报错')
  const c1 = await eventStorePre.close(storePath, ev.id, '完成并通过验收')
  eq(c1.ok, true, 'close 成功')
  eq(c1.event.status, 'closed', 'status=closed')
  eq(c1.event.outcome, '完成并通过验收', 'outcome 已写入')
  const c2 = await eventStorePre.close(storePath, ev.id, '再说一次')
  eq(c2.alreadyClosed, true, '重复 close 幂等（alreadyClosed=true）')
  eq(c2.event.outcome, '完成并通过验收', '重复 close 不改写 outcome')
  await throws(() => eventStorePre.append(storePath, ev.id, { checkpoint: { kind: 'log', text: 'closed 后追加' } }), /已 closed/, '负：closed 事件 append ⇒ 报错')

  console.log('[A-5] rename：name 变、id 不变；空名/超长 ⇒ 报错')
  const ev2 = await eventStorePre.create(storePath, { name: '旧名字' })
  const r1 = await eventStorePre.rename(storePath, ev2.id, '新名字')
  eq(r1.name, '新名字', 'name 已更新')
  eq(r1.id, ev2.id, 'id 不变')
  await throws(() => eventStorePre.rename(storePath, ev2.id, '  '), /不能为空/, '负：空名 ⇒ 报错')
  await throws(() => eventStorePre.rename(storePath, ev2.id, 'x'.repeat(81)), /超过 80 字/, '负：超长 ⇒ 报错')

  console.log('[A-6] list / detail：分页、all=1 精简字段、checkpointCount 正确')
  const l1 = await eventStorePre.list(storePath, { limit: 1 })
  eq(l1.total, 2, 'total=2')
  eq(l1.events.length, 1, 'limit=1 ⇒ 本页 1 条')
  eq(l1.nextCursor, 1, 'nextCursor=1（还有下一页）')
  ok(!('checkpoints' in l1.events[0]), '列表项**不含** checkpoints 正文（精简）')
  eq(l1.events[0].checkpointCount >= 0, true, '列表项含 checkpointCount')
  const lAll = await eventStorePre.list(storePath, { all: true })
  eq(lAll.events.length, 2, 'all=1 ⇒ 全部 2 条')
  eq(lAll.nextCursor, null, 'all=1 ⇒ nextCursor=null')
  const d1 = await eventStorePre.detail(storePath, ev.id)
  eq(d1.ok, true, 'detail ok')
  ok(Array.isArray(d1.event.checkpoints), 'detail 含 checkpoints 正文')
  eq(d1.event.checkpoints.length, 2, 'detail checkpoint 数 = 2')
  const dMiss = await eventStorePre.detail(storePath, 'evt_ffffffff')
  eq(dMiss.ok, false, '负：detail 不存在 ⇒ ok:false')

  console.log('[A-7] 校验器：合法通过 / 非法逐项抓住（真调用 validateEventPre）')
  const good = emptyEventPre('校验用', { id: 'evt_00000001' })
  eq(validateEventPre(good).length, 0, '空骨架合法')
  const bad1 = JSON.parse(JSON.stringify(good)); delete bad1.status
  ok(validateEventPre(bad1).some((x) => x === 'missing:status'), '负：缺字段被抓住')
  const bad2 = JSON.parse(JSON.stringify(good)); bad2.status = 'closed'
  ok(validateEventPre(bad2).some((x) => x === 'closed-needs-outcome'), '负：closed 缺 outcome 被抓住')
  const bad3 = JSON.parse(JSON.stringify(good)); bad3.extraField = 1
  ok(validateEventPre(bad3).some((x) => x === 'unknown:extraField'), '负：多余字段被抓住（严格 16 字段）')
  const bad4 = JSON.parse(JSON.stringify(good)); bad4.checkpoints = [{ at: 1, kind: 'x', text: 't', panels: [{ kind: 'bogus', text: 't' }] }]
  ok(validateEventPre(bad4).some((x) => String(x).startsWith('bad-panel-kind')), '负：未注册 panel kind 被抓住')

  console.log('[A-8] 原子写：中途失败不破坏原文件（真注入非法数据触发写前校验）')
  const snapshot = readFileSync(storePath, 'utf8')
  // 直接塞一个非法事件绕不过 mutatePre 的写前校验 ⇒ 用它制造「写失败」，再断言原文件逐字节未变
  const broken = JSON.parse(snapshot)
  broken.events[0].status = 'not-a-status'
  writeFileSync(storePath, JSON.stringify(broken, null, 2), 'utf8')
  const corrupted = readFileSync(storePath, 'utf8')
  await throws(() => eventStorePre.set(storePath, broken.events[0].id, { summary: 'z' }), /校验失败/, '负：仓内已有非法事件 ⇒ 任何写操作都被写前校验拒绝')
  ok(readFileSync(storePath, 'utf8') === corrupted, '写被拒绝后原文件逐字节未变（没有半个文件）')
  writeFileSync(storePath, snapshot, 'utf8')
  ok(readFileSync(storePath, 'utf8') === snapshot, '还原后与快照逐字节一致')

  console.log('[A-9] 空 store：不存在 ⇒ 空骨架（不崩、不建文件）')
  const fresh = path.join(root, 'fresh', EVENT_STORE_FILENAME)
  const empty = await readStorePre(fresh)
  eq(empty.events.length, 0, '不存在 ⇒ events=[]')
  ok(!existsSync(fresh), '只读不建文件（无副作用）')
  const lEmpty = await eventStorePre.list(fresh, { all: true })
  eq(lEmpty.total, 0, '空 store list total=0')

  // ★块级隔离（2026-11-04）：A-10/A-11/A-12 三块各自包在 sub() 里。
  //   理由：三块都是「一次真调用链」，任何一步抛错会中断整个套件 ⇒ 变异验证只能看到
  //   一个笼统的「套件异常」，无法逐条定位。用 sub() 把抛错变成该块的**断言红**，
  //   后面的块照常跑 —— 这是为了**让证据更细**，不是放松断言。
  const sub = async (label, fn) => {
    try { await fn() } catch (e) { ok(false, label + ' 块内未捕获异常：' + String((e && e.message) || e).slice(0, 160)) }
  }

  await sub('A-10', async () => {
  console.log('[A-10] ★#529 closed 后重放同 idemKey ⇒ deduped（不是抛错）')
  // 归因（独立行，不塞进被测字符串）：修复前这里抛「事件已 closed」⇒ 批内 append+close 已成功后
  // 重拉该批永远过不去（游标卡死）。修法=把 idemKey 重放检测提到 closed 检查之前。
  const sp529 = path.join(root, 'a529', EVENT_STORE_FILENAME)
  const ev529 = await eventStorePre.create(sp529, { name: '#529 批内重放' })
  const ck529 = { kind: 'log', text: '批内第一条', idemKey: 'batch-529-1' }
  await eventStorePre.append(sp529, ev529.id, { checkpoint: ck529 })
  await eventStorePre.close(sp529, ev529.id, '该批已收口')
  const r529 = await eventStorePre.append(sp529, ev529.id, { checkpoint: ck529 })
  eq(r529.appended, 0, '#529 重放不再抛错，appended=0')
  eq(r529.deduped, true, '#529 显式 deduped=true')
  eq(r529.replayed, true, '#529 显式 replayed=true（可重放语义，供上层区分「已做过」）')
  eq(r529.checkpointCount, 1, '#529 检查点数仍为 1（重放一个字节都不加）')
  const d529 = JSON.parse(readFileSync(sp529, 'utf8'))
  eq(d529.events[0].checkpoints.length, 1, '#529 磁盘上仍只有 1 个检查点')
  await throws(() => eventStorePre.append(sp529, ev529.id, { checkpoint: { kind: 'log', text: 'closed 后新内容' } }),
    /已 closed/, '负：#529 修复不得放开「closed 后追加新内容」')
  await throws(() => eventStorePre.append(sp529, ev529.id, { checkpoint: { kind: 'log', text: 'x', idemKey: 'batch-529-2' } }),
    /已 closed/, '负：#529 closed 后**新** idemKey 仍必须被拒')

  })

  await sub('A-11', async () => {
  console.log('[A-11] ★#535 v1 事件（16 顶层字段）四条写路径全部可用')
  // 归因（独立行）：修复前 append/set/rename/close 四条**全部**抛
  // 「事件写入前校验失败（missing:startMs,...）」⇒ 老库里的事件永远无法再被写入，连收口都做不到。
  const sp535 = path.join(root, 'a535', EVENT_STORE_FILENAME)
  const v1Event = {
    id: 'evt_aaaaaaaa', name: 'v1 老事件', summary: 'v1', outcome: null, skillRef: null,
    status: 'active', pausedReason: null,
    sections: { goal: 'g', doing: 'd', deadend: '', next: 'n' },
    checkpoints: [], userPercept: [], agentTrace: [], sharedGround: [], commitments: [], constraints: [],
    createdAt: 1, updatedAt: 1,
  }
  const { mkdirSync } = await import('node:fs')
  mkdirSync(path.dirname(sp535), { recursive: true })
  writeFileSync(sp535, JSON.stringify({ schema: 'v4_event_store_v1', updatedAt: 1, events: [v1Event] }, null, 2), 'utf8')
  eq(Object.keys(JSON.parse(readFileSync(sp535, 'utf8')).events[0]).length, 16, '#535 前置：磁盘事件确为 16 个 v1 字段')
  await eventStorePre.append(sp535, 'evt_aaaaaaaa', { checkpoint: { kind: 'log', text: 'v1 上追加' } })
  eq(JSON.parse(readFileSync(sp535, 'utf8')).events[0].checkpoints.length, 1, '#535 append 成功且磁盘检查点数=1')
  await eventStorePre.set(sp535, 'evt_aaaaaaaa', { summary: 'v1 改过' })
  eq(JSON.parse(readFileSync(sp535, 'utf8')).events[0].summary, 'v1 改过', '#535 set 成功且落盘')
  await eventStorePre.rename(sp535, 'evt_aaaaaaaa', 'v1 新名')
  eq(JSON.parse(readFileSync(sp535, 'utf8')).events[0].name, 'v1 新名', '#535 rename 成功且落盘')
  await eventStorePre.close(sp535, 'evt_aaaaaaaa', 'v1 收口')
  const d535 = JSON.parse(readFileSync(sp535, 'utf8')).events[0]
  eq(d535.status, 'closed', '#535 close 成功且落盘')
  eq(Object.keys(d535).length, 26, '#535 落盘后补齐为 26 字段（10 个 v2 字段升级）')
  ok(EVENT_TOP_FIELDS.every((f) => Object.prototype.hasOwnProperty.call(d535, f)), '#535 26 个契约字段全在')

  const sp535b = path.join(root, 'a535b', EVENT_STORE_FILENAME)
  mkdirSync(path.dirname(sp535b), { recursive: true })
  writeFileSync(sp535b, JSON.stringify({ schema: 'v4_event_store_v1', updatedAt: 1, events: [Object.assign({}, v1Event, { kind: 'bogus-kind' })] }, null, 2), 'utf8')
  const corruptBefore = readFileSync(sp535b, 'utf8')
  await throws(() => eventStorePre.set(sp535b, 'evt_aaaaaaaa', { summary: 'x' }),
    /bad-kind/, '负：#535 字段**存在但非法**仍被拒（升级不得覆盖非法值）')
  ok(readFileSync(sp535b, 'utf8') === corruptBefore, '负：#535 被拒后磁盘逐字节未变（没有半成品升级）')

  const sp535c = path.join(root, 'a535c', EVENT_STORE_FILENAME)
  mkdirSync(path.dirname(sp535c), { recursive: true })
  writeFileSync(sp535c, JSON.stringify({
    schema: 'v4_event_store_v1', updatedAt: 1,
    events: [
      Object.assign({}, v1Event, { id: 'evt_bbbbbbbb', name: '存量坏事件', status: 'not-a-status' }),
      Object.assign({}, v1Event, { id: 'evt_cccccccc', name: '好事件' }),
    ],
  }, null, 2), 'utf8')
  const r535c = await eventStorePre.append(sp535c, 'evt_cccccccc', { checkpoint: { kind: 'log', text: '好事件追加' } })
  eq(r535c.appended, 1, '负：#535 存量坏事件**不阻断**好事件写入（隔离边界未被升级逻辑打红）')
  ok(Array.isArray(r535c.quarantined) && r535c.quarantined.some((q) => q.id === 'evt_bbbbbbbb'), '负：#535 且隔离清单点名该坏事件（不静默）')
  ok(JSON.parse(readFileSync(sp535c, 'utf8')).events[0].kind === undefined, '负：#535 **未被触碰**的存量坏事件不得被升级（不给它补 v2 字段）')

  })

  await sub('A-12', async () => {
  console.log('[A-12] ★#526 操作级去重台账（opId；idemKey 一字未改）')
  // 归因（独立行）：修复前同一 payload 打三次 ⇒ 检查点 1/1/1，但四类感知 1→2→3 全翻倍，
  // 而 applier 仍返回 deduped:true（上层被告知已去重、数据已变形）。修法=store 顶层 appliedOps 台账。
  const sp526 = path.join(root, 'a526', EVENT_STORE_FILENAME)
  const ev526 = await eventStorePre.create(sp526, { name: '#526 opId' })
  const payload526 = () => ({
    checkpoint: { kind: 'progress', text: '同一批内容', goal: 'G', state: 'S', dead: '', next: 'N' },
    userPercept: { stage: 'accepted', kind: 'preference', text: '偏好X' },
    agentTrace: { action: '动作A', result: '结果A' },
    sharedGround: { claim: '共识A', confirmedBy: 'user' },
    commitment: { promise: '承诺A', state: 'open' },
  })
  const o1 = await eventStorePre.append(sp526, ev526.id, Object.assign({ opId: 'op-1' }, payload526()))
  const o2 = await eventStorePre.append(sp526, ev526.id, Object.assign({ opId: 'op-1' }, payload526()))
  const o3 = await eventStorePre.append(sp526, ev526.id, Object.assign({ opId: 'op-1' }, payload526()))
  ok(JSON.stringify([o1.replayed, o2.replayed, o3.replayed]) === JSON.stringify([false, true, true]),
    '#526 首次 replayed=false，两次重放 replayed=true  (got=' + JSON.stringify([o1.replayed, o2.replayed, o3.replayed]) + ')')
  ok(JSON.stringify([o2.deduped, o3.deduped]) === JSON.stringify([true, true]),
    '#526 重放 deduped=true  (got=' + JSON.stringify([o2.deduped, o3.deduped]) + ')')
  const ev526Disk = JSON.parse(readFileSync(sp526, 'utf8')).events[0]
  eq(ev526Disk.checkpoints.length, 1, '#526 检查点 1（重放不 push）')
  eq(ev526Disk.userPercept.length, 1, '★#526 userPercept 1（修复前为 3）')
  eq(ev526Disk.agentTrace.length, 1, '★#526 agentTrace 1（修复前为 3）')
  eq(ev526Disk.sharedGround.length, 1, '★#526 sharedGround 1（修复前为 3）')
  eq(ev526Disk.commitments.length, 1, '★#526 commitments 1（修复前为 3）')
  // ★负路径（最关键的一条）：不能按文本去重 —— 不同 opId 但内容完全相同必须各自写入
  const o4 = await eventStorePre.append(sp526, ev526.id, Object.assign({ opId: 'op-2' }, payload526()))
  const ev526b = JSON.parse(readFileSync(sp526, 'utf8')).events[0]
  eq(o4.replayed, false, '#526 不同 opId ⇒ 不是重放')
  eq(ev526b.userPercept.length, 2, '★#526 不同 opId 但内容相同必须各自写入（userPercept=2）')
  eq(ev526b.checkpoints.length, 2, '★#526 检查点也各自写入（=2）')
  const store526 = JSON.parse(readFileSync(sp526, 'utf8'))
  ok(store526.appliedOps && typeof store526.appliedOps === 'object' && !Array.isArray(store526.appliedOps),
    '#526 appliedOps 落在 store **顶层**（不是事件字段）')
  eq(Object.keys(store526.appliedOps || {}).length, 2, '#526 台账登记 2 条（op-1 与 op-2）')
  eq(Object.keys(ev526b).length, 26, '#526 事件仍是严格 26 字段（台账没进第 27 字段）')
  ok(ev526b.appliedOps === undefined, '#526 事件上没有 appliedOps 字段')
  // 负：不同事件用同一个 opId 不得串台
  const ev526c = await eventStorePre.create(sp526, { name: '#526 第二个事件' })
  const o5 = await eventStorePre.append(sp526, ev526c.id, { checkpoint: { kind: 'log', text: 't' }, opId: 'op-1' })
  eq(o5.replayed, false, '负：#526 同 opId 但不同事件不得被判为重放')
  eq(JSON.parse(readFileSync(sp526, 'utf8')).events.filter((e) => e.id === ev526c.id)[0].checkpoints.length, 1,
    '负：#526 第二个事件照常写入 1 个检查点')
  // 向后兼容：不传 opId 的首次写入，返回值**不得**多出 replayed 键
  const o6 = await eventStorePre.append(sp526, ev526c.id, { checkpoint: { kind: 'log', text: '无 opId' } })
  ok(!Object.prototype.hasOwnProperty.call(o6, 'replayed'), '#526 无 opId 的正常写入返回值不含 replayed 键（与旧版逐字段一致）')
  ok(Object.prototype.hasOwnProperty.call(o6, 'deduped'), '#526 但 deduped 键仍在（旧字段一个不少）')

  })

  console.log('')
  console.log('[A] ' + pass + ' PASS / ' + fail + ' FAIL')
  rmSync(root, { recursive: true, force: true })
  process.exit(fail ? 1 : 0)
}
main().catch((e) => { console.log('  FAIL 套件异常: ' + ((e && e.stack) || e)); try { rmSync(root, { recursive: true, force: true }) } catch (_) {} ; process.exit(1) })