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
  eq(Object.keys(ev).length, 16, '返回事件恰好 16 个顶层字段')
  eq(EVENT_TOP_FIELDS.length, 16, '契约常量也声明 16 个')
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

  console.log('')
  console.log('[A] ' + pass + ' PASS / ' + fail + ' FAIL')
  rmSync(root, { recursive: true, force: true })
  process.exit(fail ? 1 : 0)
}
main().catch((e) => { console.log('  FAIL 套件异常: ' + ((e && e.stack) || e)); try { rmSync(root, { recursive: true, force: true }) } catch (_) {} ; process.exit(1) })