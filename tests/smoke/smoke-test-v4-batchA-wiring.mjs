#!/usr/bin/env node
/**
 * smoke-test-v4-batchA-wiring.mjs —— 批次 A 接线验收：事件层真的接到 refresh() 上了吗？
 *
 * 纪律：真 import 生产类 → 真构造 → 真调用 refreshEventStatePre → 断言 state 字段。
 * 不用源码字符串断言充当功能证据（末节只留一条守卫，明确标注）。
 */
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  PASS ' + m) } else { fail++; console.log('  FAIL ' + m) } }
const eq = (a, b, m) => ok(Object.is(a, b), m + '  (got=' + JSON.stringify(a) + ' want=' + JSON.stringify(b) + ')')

const require2 = createRequire(import.meta.url)
// 拿真 MemoryEngine：用 registerHooks 给 lib/index.js 追加一行导出（不改盘上文件）
const { registerHooks } = await import('node:module')
let idxMod = null
try {
  const orig = require2('node:fs').readFileSync
  registerHooks({
    load(url, context, nextLoad) {
      if (url.endsWith('/lib/index.js')) {
        const r = nextLoad(url, context)
        let src = String(r.source || '')
        if (!/export \{ MemoryEngine as __ProbeEngine \}/.test(src)) src += '\nexport { MemoryEngine as __ProbeEngine }\n'
        return { format: 'module', source: src, shortCircuit: true }
      }
      return nextLoad(url, context)
    },
  })
  idxMod = await import('../../lib/index.js')
} catch (e) { console.log('  FAIL 无法加载生产模块: ' + e.message); process.exit(1) }
const Engine = idxMod.__ProbeEngine || idxMod.MemoryEngine
ok(typeof Engine === 'function', '拿到真 MemoryEngine 类')

const root = mkdtempSync(path.join(tmpdir(), 'dam-v4-batchA-'))
const handoffDir = path.join(root, 'handoff')
const storePath = path.join(handoffDir, 'event-store.json')
mkdirSync(handoffDir, { recursive: true })

// 写一个 store：1 个 active + 1 个 closed
const ev = (id, name, status, updatedAt, extra = {}) => Object.assign({
  id, name, summary: name + ' 的摘要。第二句。', outcome: status === 'closed' ? '已完成' : null, skillRef: null,
  status, pausedReason: null,
  sections: { goal: name + '目标', doing: '进行中', deadend: '', next: '下一步' },
  checkpoints: [{ at: 1, kind: 'log', text: '检查点一', sourceRef: null, panels: [], idemKey: 'k1' }],
  userPercept: [], agentTrace: [], sharedGround: [], commitments: [], constraints: [],
  createdAt: updatedAt, updatedAt,
}, extra)
writeFileSync(storePath, JSON.stringify({ schema: 'v4_event_store_v1', events: [
  ev('evt_00000001', '活动事件', 'active', 200),
  // ★★2026-10-27 判据更新（**归因：用户裁定 Q8 覆盖旧口径**）：
  //   旧夹具把 closed 事件的 updatedAt 设为 100（1970 年）。
  //   用户 2026-10-27 裁定「注入面只列 active + **最近** closed」⇒ 1970 年的会被时间窗隐藏。
  //   这不是放宽判据，是**新裁定要求的行为**：夹具必须用「最近关闭」才符合该判据的语境。
  //   （同款修正已在 v4-b1-event-catalog 做过，并新增 C2b 验证「久远关闭的不列出」。）
  ev('evt_00000002', '已完成事件', 'closed', Date.now() - 3600 * 1000),
], updatedAt: 200 }, null, 2), 'utf8')

// 写两篇四段账本 + 一篇非四段（验证 D9 口径 A）
const ledger = '# 交接账本 · 2026-10-24\n\n## 任务状态\n- a\n\n## 目标\n- b\n\n## 已试方案与失败原因\n- c\n\n## 进度与下一步\n- d\n'
writeFileSync(path.join(handoffDir, 'handoff-20261024-100000.md'), ledger, 'utf8')
writeFileSync(path.join(handoffDir, 'handoff-20261024-110000.md'), ledger.replace('b', 'b2'), 'utf8')
writeFileSync(path.join(handoffDir, 'report.md'), '# 不是账本\n内容', 'utf8')

async function main() {
  const engine = new Engine()
  ok(!!engine.state, 'engine 有 state 对象')
  // 直接打桩 resolvePaths / config（不跑 apply，避免起心跳与网络）
  engine.resolvePaths = async () => ({ handoffDir, projectDir: root, ws: root, userFile: path.join(root, 'U.md'), notesPath: path.join(root, 'M.md'), reflectDir: path.join(root, 'r'), planPath: path.join(handoffDir, 'PLAN.md'), logPath: path.join(root, 'L.md') })
  engine.config = Object.assign({}, engine.config, { eventMaxActiveInInject: 2, eventCatalogChars: 400, eventUnarchivedScanTtlMs: 30000 })

  console.log('[W-1] refreshEventStatePre：真调用，state 四个字段被填')
  const okFlag = await engine.refreshEventStatePre({ session: { id: 's1', header: { cwd: root } } })
  eq(okFlag, true, '返回 true（未走降级）')
  ok(typeof engine.state.eventCardsText === 'string' && engine.state.eventCardsText.length > 0, 'eventCardsText 非空（T2 卡片已生成）')
  ok(engine.state.eventCardsText.includes('活动事件'), 'T2 卡片含 active 事件名')
  ok(!engine.state.eventCardsText.includes('已完成事件'), '负：T2 卡片**不含** closed 事件（契约只放 active）')
  ok(typeof engine.state.eventCatalogText === 'string' && engine.state.eventCatalogText.length > 0, 'eventCatalogText 非空')
  ok(engine.state.eventCatalogText.length <= 400, '目录段 ≤400（实测 ' + engine.state.eventCatalogText.length + '）')
  // ★2026-10-25 B1 判据更新（有意变更语义，不是放宽）：
  //   B1 之后 catalog = **目录层，只列「卡片未展开」的事件**（refreshEventStatePre 传 excludeIds: pickedIds）。
  //   本 fixture 是「1 active + 1 closed」⇒ picks=[active] ⇒ catalog 只剩 closed。
  //   旧断言「目录含全部事件（T0 不分状态）」验证的是**被推翻的语义**（那会让同一事件在卡片与目录各出现一次）。
  //   改成**双向**：正向证明 closed 在、负向证明 active **不重复**。
  ok(engine.state.eventCatalogText.includes('已完成事件'), '★目录含卡片**未展开**的事件（closed）')
  ok(!engine.state.eventCatalogText.includes('活动事件'), '★负：目录**不重复**卡片已展开的 active 事件（B1 核心：重复即错误）')
  eq(engine.state.eventActiveCount, 1, 'eventActiveCount=1')
  eq(engine.state.eventUnarchivedCount, 2, 'eventUnarchivedCount=2（只算四段账本，D9 口径 A）')
  eq(engine.state.eventUnarchivedSkipped, 1, 'eventUnarchivedSkipped=1（非四段被跳过，如实报数）')


  // ══════════════════════════════════════════════════════════════════════════════════
  // ★2026-10-25 B1 核心判据补强（Lead 追加要求）：3 个 active ⇒ catalog **只含卡片没展开的第 3 个**
  //
  //   为什么单独一测：上面对 1active+1closed 只验证了「closed 在、active 不在」；
  //   那还不能区分「按状态过滤」与「按 excludeIds 过滤」两种实现（两者在该 fixture 下结果相同）。
  //   3 个 active 才能区分：eventMaxActiveInInject=2 ⇒ picks=前 2 个 ⇒ catalog 只应剩第 3 个。
  //   （若实现是「按状态过滤」，catalog 会是空；若实现是「全量」，会是 3 个 —— 都不对。）
  // ══════════════════════════════════════════════════════════════════════════════════
  console.log('')
  console.log('[W-1b] ★B1 核心：3 个 active ⇒ catalog 只含未展开的第 3 个')
  {
    const root3 = mkdtempSync(path.join(tmpdir(), 'dam-ba3-'))
    const hd3 = path.join(root3, 'handoff')
    mkdirSync(hd3, { recursive: true })
    const e3 = (id, name, status, updatedAt) => ({
      id, name, summary: name + ' 的摘要', status,
      sections: { goal: '', doing: '', deadend: '', next: '' },
      checkpoints: [], userPercept: [], agentTrace: [], sharedGround: [], commitments: [], updatedAt,
    })
    writeFileSync(path.join(hd3, 'event-store.json'), JSON.stringify({
      version: 'event_store_pre_v1',
      events: [
        e3('evt_00000011', '甲事件', 'active', 300),
        e3('evt_00000012', '乙事件', 'active', 200),
        e3('evt_00000013', '丙事件', 'active', 100),
      ],
      updatedAt: Date.now(),
    }, null, 2))
    const eng3 = new Engine()
    // ★不要重赋 eng3.state —— MemoryEngine 的 state 是 **getter**（只有取值器），赋会抛
    //   「Cannot set property state which has only a getter」。新建实例本身就带干净 state。
    eng3.config = Object.assign({}, eng3.config, { eventMaxActiveInInject: 2, eventCatalogChars: 400 })
    eng3.resolvePaths = async () => ({ handoffDir: hd3, projectDir: root3, ws: root3, userFile: path.join(root3, 'U.md'), notesPath: path.join(root3, 'M.md'), reflectDir: path.join(root3, 'r'), planPath: path.join(hd3, 'PLAN.md'), logPath: path.join(root3, 'L.md') })
    await eng3.refreshEventStatePre({ session: { id: 's3', header: { cwd: root3 } } })
    ok(eng3.state.eventCardsText.includes('甲事件') && eng3.state.eventCardsText.includes('乙事件'), '★★W-1b-1 T2 卡片展开前 2 个（甲/乙）')
    ok(eng3.state.eventCatalogText.includes('丙事件'), '★★★W-1b-2 catalog 含第 3 个（丙）—— 卡片没展开的')
    ok(!eng3.state.eventCatalogText.includes('甲事件') && !eng3.state.eventCatalogText.includes('乙事件'), '★★★W-1b-3 负：catalog **不含**卡片已展开的甲/乙（证明是 excludeIds 过滤，不是按状态过滤）')
    // ★判别力：若实现是「按状态过滤」catalog 会是空；若是「全量」会是 3 个。两者都不满足上面两条。
    ok(eng3.state.eventCatalogText.length > 0, '★★W-1b-4 且 catalog 非空（排除「按状态过滤 ⇒ 空」这种错误实现）', 'len=' + eng3.state.eventCatalogText.length)
    try { rmSync(root3, { recursive: true, force: true }) } catch (e) {}
  }
  console.log('[W-2] 扫描节流：第二次调用不重扫（用计数器证明）')
  const firstCacheAt = engine._eventUnarchivedCache.at
  await new Promise((r) => setTimeout(r, 10))
  await engine.refreshEventStatePre({ session: { id: 's1', header: { cwd: root } } })
  eq(engine._eventUnarchivedCache.at, firstCacheAt, '30s 内不重扫（cache.at 未变）')
  // 负路径：缓存**过期**后必须重扫。
  //   ⚠️ 不能靠把配置改成 1ms —— 产线有 `Math.max(5000, ...)` 下限（防误配导致每轮扫 577 篇），
  //   改成 1 会被夹回 5000。正确做法是把缓存时间戳**回拨**到过期之前。
  engine._eventUnarchivedCache.at = Date.now() - 60000
  await engine.refreshEventStatePre({ session: { id: 's1', header: { cwd: root } } })
  ok(engine._eventUnarchivedCache.at > firstCacheAt, '缓存过期后确实重扫（cache.at 前进）')
  // 负路径 2：TTL 配置被夹到下限（证明 Math.max(5000,…) 真的生效）
  engine.config.eventUnarchivedScanTtlMs = 1
  engine._eventUnarchivedCache = null
  await engine.refreshEventStatePre({ session: { id: 's1', header: { cwd: root } } })
  const t1 = engine._eventUnarchivedCache.at
  await new Promise((r) => setTimeout(r, 20))
  await engine.refreshEventStatePre({ session: { id: 's1', header: { cwd: root } } })
  eq(engine._eventUnarchivedCache.at, t1, '负路径：TTL=1ms 被夹回 5000ms 下限 ⇒ 20ms 内不重扫')

  console.log('[W-3] 失败降级：store 损坏 ⇒ 四个字段清空，不抛')
  writeFileSync(storePath, '{ this is not json', 'utf8')
  engine._eventUnarchivedCache = null
  const ok2 = await engine.refreshEventStatePre({ session: { id: 's1', header: { cwd: root } } })
  eq(ok2, true, '损坏时仍返回 true（内部已降级，不抛）')
  eq(engine.state.eventCardsText, '', 'store 损坏 ⇒ eventCardsText 为空串')
  eq(engine.state.eventCatalogText, '', 'store 损坏 ⇒ eventCatalogText 为空串')
  eq(engine.state.eventActiveCount, 0, 'store 损坏 ⇒ eventActiveCount=0')
  ok(engine.state.eventUnarchivedCount === 2, '账本扫描不受 store 损坏影响（仍=2）')

  console.log('[W-4] store 不存在 ⇒ 事件面空，但账本面照常')
  rmSync(storePath, { force: true })
  engine._eventUnarchivedCache = null
  await engine.refreshEventStatePre({ session: { id: 's1', header: { cwd: root } } })
  eq(engine.state.eventCardsText, '', '无 store ⇒ cards 空')
  eq(engine.state.eventCatalogText, '', '无 store ⇒ catalog 空')
  eq(engine.state.eventUnarchivedCount, 2, '无 store ⇒ 账本数仍为 2')
  ok(!require2('node:fs').existsSync(storePath), '负：只读不建文件（无副作用）')

  console.log('[W-5] 守卫（非功能证据）：refresh 真的调用了 refreshEventStatePre')
  const idx = require2('node:fs').readFileSync(path.join(process.cwd(), 'lib', 'index.js'), 'utf8')
  ok(/await this\.refreshEventStatePre\(agent\)/.test(idx), '守卫：refresh() 里真的有 await this.refreshEventStatePre(agent)')
  ok(!/await this\.refreshEventStatePre/.test(idx.slice(idx.indexOf('renderMemoryDynamic(context) {'), idx.indexOf('renderMemoryStatic() {'))), '守卫：renderMemoryDynamic 体内**没有** IO（保持可被 47 套件抽取执行）')

  console.log('')
  console.log('[W] ' + pass + ' PASS / ' + fail + ' FAIL')
  rmSync(root, { recursive: true, force: true })
  process.exit(fail ? 1 : 0)
}
main().catch((e) => { console.log('  FAIL 套件异常: ' + ((e && e.stack) || e)); try { rmSync(root, { recursive: true, force: true }) } catch (_) {} ; process.exit(1) })