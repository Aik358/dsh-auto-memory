#!/usr/bin/env node
/**
 * smoke-test-v4-d-events-recall.mjs —— 批次 D：memory_recall 的 scope='events' 验收。
 *
 * 纪律：真 import MemoryEngine → 真构造 → 真调 recall(q, n, agent, 'events') → 断言返回文本。
 * 不碰真实工作区：把 resolvePaths 打桩到临时目录。
 */
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  PASS ' + m) } else { fail++; console.log('  FAIL ' + m) } }
const eq = (a, b, m) => ok(Object.is(a, b), m + '  (got=' + JSON.stringify(a) + ' want=' + JSON.stringify(b) + ')')

const require2 = createRequire(import.meta.url)
const { registerHooks } = await import('node:module')
let mod = null
try {
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
  mod = await import('../../lib/index.js')
} catch (e) { console.log('  FAIL 加载失败: ' + e.message); process.exit(1) }
const Engine = mod.__ProbeEngine || mod.MemoryEngine

const root = mkdtempSync(path.join(tmpdir(), 'dam-v4-devrec-'))
const handoffDir = path.join(root, 'handoff')
mkdirSync(handoffDir, { recursive: true })
const storePath = path.join(handoffDir, 'event-store.json')

const ev = (id, name, summary, status, updatedAt, sections, checkpoints) => ({
  id, name, summary, outcome: status === 'closed' ? '已完成' : null, skillRef: null, status, pausedReason: null,
  sections: sections || { goal: '', doing: '', deadend: '', next: '' },
  checkpoints: checkpoints || [], userPercept: [], agentTrace: [], sharedGround: [], commitments: [], constraints: [],
  createdAt: updatedAt, updatedAt,
})
const writeStore = (events) => writeFileSync(storePath, JSON.stringify({ schema: 'v4_event_store_v1', events, updatedAt: Date.now() }, null, 2), 'utf8')

const mkEngine = () => {
  const e = new Engine()
  e.resolvePaths = async () => ({ handoffDir, projectDir: root, ws: root, userFile: path.join(root, 'U.md'), notesPath: path.join(root, 'M.md'), reflectDir: path.join(root, 'r'), planPath: path.join(handoffDir, 'PLAN.md'), logPath: path.join(root, 'L.md') })
  return e
}
const agent = { session: { id: 's1', header: { cwd: root } } }

async function main() {
  console.log('[D-1] 无事件 ⇒ 明确说明「还没有事件」，不是「未命中」')
  writeStore([])
  const r0 = await mkEngine().recall('事件', 8, agent, 'events')
  ok(r0.includes('还没有任何事件'), '正：空库返回可执行指引（建第一个事件）')
  ok(r0.includes('memory_event(action=create)'), '正：指引里点名建事件的工具与动作')
  ok(!r0.includes('未命中'), '负：空库**不**说「未命中」（那是「有事件但没匹配」的措辞）')

  console.log('[D-2] 命中标题：真调用返回事件 id + 名称 + 状态')
  writeStore([
    ev('evt_00000001', '实现事件检索', '把 memory_recall 加上 events scope。第二句。', 'active', 200,
      { goal: '让模型能按事件检索', doing: '写分支', deadend: '', next: '补验收' },
      [{ at: 1, kind: 'progress', text: '事件分支已写完', sourceRef: null, panels: [], idemKey: 'k1' }]),
    ev('evt_00000002', '不相关的另一件事', '完全无关的内容。', 'closed', 100, { goal: '别的事' }),
  ])
  const r1 = await mkEngine().recall('事件检索', 8, agent, 'events')
  ok(r1.includes('实现事件检索'), '★正：命中含目标事件名')
  ok(r1.includes('evt_00000001'), '★正：返回里带事件 id（可用于后续 memory_event 操作）')
  ok(r1.includes('[进行]'), '正：带中文状态标')
  ok(!r1.includes('不相关的另一件事'), '负：不相关事件不被带出（词法未命中）')

  console.log('[D-3] 命中四段/检查点正文（不只标题）')
  const r2 = await mkEngine().recall('事件分支已写完', 8, agent, 'events')
  ok(r2.includes('evt_00000001'), '★正：检查点正文也能被搜到（不是只搜标题）')
  ok(r2.includes('事件分支已写完'), '正：命中行回显了检查点原文')
  const r3 = await mkEngine().recall('让模型能按事件检索', 8, agent, 'events')
  ok(r3.includes('evt_00000001'), '★正：sections.goal 正文也能被搜到')

  console.log('[D-4] 排序：命中词多的优先；同分按 updatedAt 降序')
  writeStore([
    ev('evt_0000000a', '甲 只提一次 alpha', '', 'active', 100, { goal: 'alpha' }),
    ev('evt_0000000b', '乙 alpha beta gamma', '', 'active', 50, { goal: 'alpha beta' }),
  ])
  const r4 = await mkEngine().recall('alpha beta', 8, agent, 'events')
  const iB = r4.indexOf('evt_0000000b'), iA = r4.indexOf('evt_0000000a')
  ok(iB >= 0 && iA >= 0, '正：两个事件都命中')
  ok(iB < iA, '★正：命中词多的（乙）排在前面')
  // ★关键（2026-10-24 变异测试抓出）：两个事件必须**得分完全相同**，否则测不到二级排序。
  //   首版写了两个都含 "alpha" 的事件，但文本长度不同 ⇒ recallPassagesPre 得分不同 ⇒
  //   去掉 updatedAt 二级排序后断言仍绿（MUT-D2 未被捕获）。现改为**文本逐字节相同、只有 updatedAt 不同**。
  // ⚠️ 顺序很关键：**旧的放数组前面**。否则去掉二级排序后插入顺序恰好是「新的在前」，
  //   断言会恒绿（本轮连踩两次：第一次词频不同，第二次顺序凑巧正确）。
  writeStore([
    ev('evt_0000000d', '同分事件', '同一段摘要。', 'active', 100, { goal: '同一个目标' }),
    ev('evt_0000000c', '同分事件', '同一段摘要。', 'active', 900, { goal: '同一个目标' }),
  ])
  const r5 = await mkEngine().recall('同一个目标', 8, agent, 'events')
  ok(r5.includes('evt_0000000c') && r5.includes('evt_0000000d'), '正：两个同分事件都命中')
  ok(r5.indexOf('evt_0000000c') < r5.indexOf('evt_0000000d'), '★正：同分时较新的（updatedAt 大）在前')

  console.log('[D-5] limit 生效')
  writeStore(Array.from({ length: 12 }, (_, i) => ev('evt_' + String(i).padStart(8, '0'), '事件' + i + ' 关键词', '', 'active', 100 + i, { goal: '关键词' })))
  const r6 = await mkEngine().recall('关键词', 3, agent, 'events')
  const hitCount = (r6.match(/^· \[evt_/gm) || []).length
  ok(hitCount > 0 && hitCount <= 3, '正：limit=3 ⇒ 最多 3 条（实测 ' + hitCount + '）')
  ok(r6.includes('12 个'), '正：如实报总事件数 12')

  console.log('[D-6] 负路径：store 损坏 ⇒ **显式报错**，不静默成「未命中」')
  writeFileSync(storePath, '{ this is not json', 'utf8')
  const r7 = await mkEngine().recall('关键词', 8, agent, 'events')
  ok(r7.includes('读取失败'), '★负路径：损坏 ⇒ 明确说「读取失败」')
  ok(!r7.includes('未命中'), '★负路径：损坏**不**伪装成「未命中」（R0 纪律：失败 ≠ 空结果）')

  console.log('[D-7] 负路径：store 不存在 ⇒ 按空库处理（不报错）')
  rmSync(storePath, { force: true })
  const r8 = await mkEngine().recall('任何', 8, agent, 'events')
  ok(r8.includes('还没有任何事件'), '负：文件不存在 ⇒ 空库语义')

  console.log('[D-8] 与其它 scope 互不干扰（events 不并入 all）')
  writeStore([ev('evt_00000001', '只在事件里的独特词 zetauniquetoken', '', 'active', 100, { goal: 'zetauniquetoken' })])
  const rAll = await mkEngine().recall('zetauniquetoken', 8, agent, 'all')
  ok(typeof rAll === 'string' && rAll.length > 0, 'all 能正常返回（不崩）')
  // ★2026-10-25 v4-H9（Lead 裁决 A）：本条语义**有意变更** —— H9 的目的就是让 all 包含事件。
  //   旧断言「all 不含事件」是 H9 之前的事实，现已过期；改成「all 现在**包含**事件」。
  //   ★但不丢覆盖：紧接着补一条**新负路径**（删事件后 all 不再命中），证明它是真读事件库。
  ok(rAll.includes('evt_00000001'), '★★正（v4-H9 新语义）：all **包含**事件命中')
  writeStore([])
  const rAllEmpty = await mkEngine().recall('zetauniquetoken', 8, agent, 'all')
  ok(!rAllEmpty.includes('evt_00000001'), '★★负（新补）：删掉事件后 all 不再命中该 id（证明真读事件库，非恒真）')
  writeStore([ev('evt_00000001', '只在事件里的独特词 zetauniquetoken', '', 'active', 100, { goal: 'zetauniquetoken' })])
  const rEv = await mkEngine().recall('zetauniquetoken', 8, agent, 'events')
  ok(rEv.includes('evt_00000001'), '★正：events 通道能命中同一个词')

  console.log('')
  console.log('[D] ' + pass + ' PASS / ' + fail + ' FAIL')
  rmSync(root, { recursive: true, force: true })
  process.exit(fail ? 1 : 0)
}
main().catch((e) => { console.log('  FAIL 套件异常: ' + ((e && e.stack) || e)); try { rmSync(root, { recursive: true, force: true }) } catch (_) {} ; process.exit(1) })