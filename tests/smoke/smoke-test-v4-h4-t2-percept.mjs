#!/usr/bin/env node
/**
 * smoke-test-v4-h4-t2-percept.mjs —— v4-H 批次 H4：T2 渲染接四个 percept + panels + 分段预算。
 *
 * 设计依据：V4-CODE-LEVEL-SPEC §6（含 2026-10-25 两处勘误：§6.2 agentTrace 取值、§6.3 分段预算）
 *
 * 为什么这个套件必须存在（Lead 2026-10-25 判据）：
 *   旧 renderT2Pre 只有总限 2,400，**没有分段配额** ⇒ 真实数据下 headroom = 0，
 *   新增的 percept(≤200)+panels(≤150) 无论放哪儿都会被总限截掉 ⇒ H4 白做。
 *
 * ★本套件的关键设计：**断言「分段实际占用」时必须直调子函数**，不能只看 renderT2Pre 的最终字符串。
 *   因为「四段拼了 1,500 但被总限切掉」和「四段真的被压到 900」在最终字符串上无法区分（假绿）。
 *   ⇒ 用 buildSectionsBlockPre(ev).used 这类**未经总限裁剪**的物理量做断言。
 *
 * 纪律（CR-10）：真 import → 真调用 → 断言返回值/副作用；每条正向都配负路径。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const ER = await import(pathToFileURL(path.join(ROOT, 'lib', 'event-render.js')).href)
const {
  renderT2Pre, buildSectionsBlockPre, buildPerceptBlockPre, buildCheckpointsBlockPre,
  T2_BUDGET, RENDER_LIMITS,
} = ER

let pass = 0, fail = 0
function ok(c, n, d) { if (c) { pass++; console.log('  PASS ' + n + (d ? '  =>  ' + d : '')) } else { fail++; console.log('  FAIL ' + n + (d ? '  =>  ' + d : '')) } }

const mk = (o) => Object.assign({
  id: 'evt_00000001', name: '测试事件', status: 'active',
  sections: { goal: '目标', doing: '', deadend: '', next: '' },
  checkpoints: [], outcome: null, updatedAt: 1,
}, o)

// ══════════════════════════════════════════════════════════════════
// A. 四个 percept 渲染（含 §6.2 缺陷专防）
// ══════════════════════════════════════════════════════════════════
console.log('[A] 四个 percept 渲染')
{
  const ev = mk({
    userPercept:  [{ at: 1, stage: 'accepted', text: '用户偏好 X' }],
    agentTrace:   [{ at: 2, action: '改了 A 文件' }],
    sharedGround: [{ at: 3, claim: '双方认可 Y' }],
    commitments:  [{ at: 4, promise: '答应做 Z', state: 'open' }],
  })
  const out = renderT2Pre(ev)
  ok(out.includes('用户记忆'), 'A1 含标题「用户记忆」')
  ok(out.includes('用户偏好 X'), 'A2 userPercept 用 text 能渲染')
  ok(out.includes('Agent 经历'), 'A3 含标题「Agent 经历」')
  // ★★这条专防 §6.2 文档缺陷复活：agentTrace 的文本载体是 action，不是 text/promise/claim
  ok(out.includes('改了 A 文件'), '★★A4 agentTrace 用 **action** 能渲染（专防 §6.2 缺陷复活）')
  ok(out.includes('共同认知') && out.includes('双方认可 Y'), 'A5 sharedGround 用 claim 能渲染')
  ok(out.includes('关系约定') && out.includes('答应做 Z'), 'A6 commitments 用 promise 能渲染')
  ok(out.includes('[accepted]'), 'A7 userPercept 的 stage 标记可见')
  ok(out.includes('[open]'), 'A8 commitments 的 state 标记可见')
}

// ══════════════════════════════════════════════════════════════════
// B. 负路径：空字段不发标题 / stage 不过滤
// ══════════════════════════════════════════════════════════════════
console.log('[B] 负路径')
{
  const out = renderT2Pre(mk({}))
  for (const t of ['用户记忆', 'Agent 经历', '共同认知', '关系约定']) {
    ok(!out.includes(t), 'B 负路径：四字段全空 ⇒ 不输出标题「' + t + '」')
  }
  // ★防将来有人偷偷加 stage 优先级过滤（排序 = 双重裁剪 = 静默丢数据）
  const retr = mk({ userPercept: [{ at: 1, stage: 'retrieved', text: '只是被检索到的记忆' }] })
  ok(renderT2Pre(retr).includes('只是被检索到的记忆'), '★B5 负路径：stage=retrieved 仍渲染（不按 stage 过滤）')
}

// ══════════════════════════════════════════════════════════════════
// C. 分段预算（★核心：用子函数直测 used，防「被总限切掉」的假绿）
// ══════════════════════════════════════════════════════════════════
console.log('[C] 分段预算（子函数直测）')
{
  // 极大事件：sections 各 3,000 字、检查点各 5,000 字 × 3
  const huge = mk({
    sections: { goal: 'g'.repeat(3000), doing: 'd'.repeat(3000), deadend: 'e'.repeat(3000), next: 'n'.repeat(3000) },
    checkpoints: [
      { kind: 'log', text: 'a'.repeat(5000) },
      { kind: 'log', text: 'b'.repeat(5000) },
      { kind: 'log', text: 'c'.repeat(5000) },
    ],
    userPercept: [{ at: 1, stage: 'used', text: 'p'.repeat(500) }],
  })
  const sec = buildSectionsBlockPre(huge)
  const ck = buildCheckpointsBlockPre(huge, 3)
  const out = renderT2Pre(huge)
  ok(sec.used <= T2_BUDGET.SECTIONS, '★C1 四段实际占用 ≤ ' + T2_BUDGET.SECTIONS + '（子函数直测，未经总限）', 'used=' + sec.used)
  ok(ck.used <= T2_BUDGET.CHECKPOINTS, '★C2 检查点块实际占用 ≤ ' + T2_BUDGET.CHECKPOINTS, 'used=' + ck.used)
  ok(out.length <= RENDER_LIMITS.T2, 'C3 极大事件总长 ≤ ' + RENDER_LIMITS.T2, 'len=' + out.length)
  ok(out.includes('p'.repeat(20)), '★C4 极大事件下 percept 仍可见（未被前面的段饿死）')
  ok(out.includes('另有 ') || ck.dropped === 0, 'C5 检查点被预算丢弃时如实标注（不静默）')

  // 单条检查点上界
  const oneBig = mk({ checkpoints: [{ kind: 'log', text: 'x'.repeat(10000) }] })
  const ckOne = buildCheckpointsBlockPre(oneBig, 3)
  const ckLine = ckOne.lines.find((l) => l.startsWith('  - [')) || ''
  ok(ckLine.length <= T2_BUDGET.CHECKPOINT_ITEM + 20, '★C6 单条检查点 ≤ ' + T2_BUDGET.CHECKPOINT_ITEM + '（+标记开销）', 'len=' + ckLine.length)
  // ★Lead 硬要求：至少保留 1 条（先保条数，再保单条长度）
  ok(ckOne.lines.filter((l) => l.startsWith('  - [')).length >= 1, '★C7 单条超大时仍保留 ≥1 条检查点（先保条数）')
}

// ══════════════════════════════════════════════════════════════════
// D. panels 归属（结构性断言，不是「≤3 行」魔数）
// ══════════════════════════════════════════════════════════════════
console.log('[D] panels 归属')
{
  const ev = mk({
    checkpoints: [
      { kind: 'log', text: 'CK-A 内容', panels: [{ kind: 'state', text: 'PANEL-A1' }, { kind: 'next', text: 'PANEL-A2' }] },
      { kind: 'log', text: 'CK-B 内容', panels: [{ kind: 'deadend', text: 'PANEL-B1' }] },
    ],
  })
  const ls = renderT2Pre(ev).split('\n')
  const iA = ls.findIndex((l) => l.includes('CK-A 内容'))
  const iB = ls.findIndex((l) => l.includes('CK-B 内容'))
  const pA1 = ls.findIndex((l) => l.includes('PANEL-A1'))
  const pA2 = ls.findIndex((l) => l.includes('PANEL-A2'))
  const pB1 = ls.findIndex((l) => l.includes('PANEL-B1'))
  // ★结构性判据：panel 必须在「其宿主检查点之后、下一个检查点之前」
  ok(iA >= 0 && pA1 > iA && pA1 < iB, '★D1 PANEL-A1 在其宿主 CK-A 之后、下一个检查点 CK-B 之前', 'iA=' + iA + ' pA1=' + pA1 + ' iB=' + iB)
  ok(pA2 > iA && pA2 < iB, '★D2 PANEL-A2 同样归属 CK-A')
  ok(pB1 > iB, '★D3 PANEL-B1 归属 CK-B')
  ok((ls[pA1] || '').startsWith('    · ['), 'D4 panel 行缩进比检查点行更深（4 空格 vs 2 空格）')
  // 负路径：无 panels 时不得出现 panel 行
  const noPanel = renderT2Pre(mk({ checkpoints: [{ kind: 'log', text: 'CK-ONLY' }] }))
  ok(!noPanel.split('\n').some((l) => l.startsWith('    · [')), 'D5 负路径：无 panels 时不输出 panel 行')
}

// ══════════════════════════════════════════════════════════════════
// F. ★2026-10-25 修 4 个 Lead 实测问题（语义级 + 可测性）
// ══════════════════════════════════════════════════════════════════
console.log('[F] 4 个修复（保最新/panelsUsed/used解耦/correction正文）')
{
  // ── F1 问题2：panelsUsed / 两个 dropped 分开暴露 ──
  const base = buildCheckpointsBlockPre(mk({ checkpoints: [{ kind: 'log', text: 'x' }] }), 3)
  ok('panelsUsed' in base, '★F1a 返回值含 panelsUsed（否则「panels ≤150」无法测）')
  ok('checkpointsDropped' in base, '★F1b 含 checkpointsDropped（与 panelsDropped 分开）')
  ok('panelsDropped' in base, '★F1c 含 panelsDropped')

  // ── F2 问题3：used 只算检查点行，不含 panel ──
  const noP = buildCheckpointsBlockPre(mk({ checkpoints: [{ kind: 'log', text: '同样内容' }] }), 3)
  const withP = buildCheckpointsBlockPre(mk({
    checkpoints: [{ kind: 'log', text: '同样内容', panels: [
      { kind: 'state', text: 'P1' }, { kind: 'next', text: 'P2' }, { kind: 'log', text: 'P3' },
    ] }],
  }), 3)
  ok(withP.used - noP.used === 0, '★★F2 used 不含 panel 行（3 panel vs 0 panel 的 used 增量必须 = 0）', '增量=' + (withP.used - noP.used))
  ok(withP.panelsUsed > 0, 'F3 panelsUsed 独立累加 > 0', 'panelsUsed=' + withP.panelsUsed)
  ok(withP.panelsUsed <= T2_BUDGET.PANELS_TOTAL, '★F4 panelsUsed ≤ ' + T2_BUDGET.PANELS_TOTAL + '（子函数直测）', 'used=' + withP.panelsUsed)

  // ── F5 问题4：correction 正文必须渲出来 ──
  const corr = renderT2Pre(mk({ sharedGround: [{ at: 1, claim: '双方认可 Y', correction: '用户纠正了X' }] }))
  ok(corr.includes('[corrected]'), 'F5a 含 [corrected] 标记')
  ok(corr.includes('用户纠正了X'), '★★F5b correction **正文**出现在输出里（不能只标 corrected）')
  ok(/（纠正：.*）/.test(corr), 'F5c correction 用「（纠正：…）」括号格式')
  // 负路径：无 correction 时不得出现「纠正：」
  const noCorr = renderT2Pre(mk({ sharedGround: [{ at: 1, claim: '只是共识' }] }))
  ok(!noCorr.includes('纠正：'), 'F5d 负路径：无 correction 时不输出「纠正：」')

  // ── F6 ★顺序结构断言（Lead 要求：不依赖是否被截断，永远可测）──
  const ord = renderT2Pre(mk({
    sections: { goal: '目标X', doing: '', deadend: '', next: '' },
    userPercept: [{ at: 1, stage: 'used', text: '感知X' }],
    checkpoints: [{ kind: 'log', text: '检查点X' }],
  })).split('\n')
  const iPercept = ord.findIndex((l) => l.startsWith('· 用户记忆：'))
  const iCkHead = ord.findIndex((l) => l.startsWith('· 最近检查点：'))
  ok(iPercept >= 0 && iCkHead >= 0 && iPercept < iCkHead,
    '★★F6 顺序：percept 行号 < 检查点标题行号（静态位置断言，不依赖截断）',
    'percept@' + iPercept + ' ck@' + iCkHead)
}

// ══════════════════════════════════════════════════════════════════
// E. 真实数据（★断言 1：不写死数字，用同次运行内的自证）
// ══════════════════════════════════════════════════════════════════
console.log('[E] 真实数据（D 盘实际 event-store.json）')
{
  const WS = 'C:/Users/JH Z/.dsh/memory/workspaces/--D--dsh-auto-memory--'
  const storePath = path.join(WS, 'handoff', 'event-store.json')
  if (!fs.existsSync(storePath)) {
    // 换机器/换工作区时不算失败，但要如实说明跳过（不静默）
    console.log('  SKIP 真实 store 不存在（' + storePath + '）⇒ 本组跳过；其余组仍有效')
  } else {
    const store = JSON.parse(fs.readFileSync(storePath, 'utf8'))
    const ev = store.events && store.events[0]
    ok(!!ev, 'E0 真实 store 能读到事件')
    if (ev) {
      // ★前置自证（不写死任何数字）：必须量「**压缩前**的原始需求」，不是压缩后的 used。
      //   为什么：压缩后的 used 已被本实现压到预算内（这是修复效果），拿它做自证会永远不成立。
      //   自证要回答的是「**旧实现（只有总限）**会不会把新增块截掉」⇒ 必须看原始输入有多长。
      const rawSecLen = ['goal', 'doing', 'deadend', 'next']
        .reduce((a, k) => a + String((ev.sections || {})[k] || '').length, 0)
      const last3 = (Array.isArray(ev.checkpoints) ? ev.checkpoints : []).slice(-3)
      const rawCkLen = last3.reduce((a, c) => a + String((c && c.text) || '').length, 0)
      const newBlocks = T2_BUDGET.PERCEPT_TOTAL + T2_BUDGET.PANELS_TOTAL
      const threshold = RENDER_LIMITS.T2 - newBlocks
      ok(rawSecLen + rawCkLen > threshold,
        '★E1 前置自证：真实数据**压缩前**原始需求已超 (总限 - percept - panels) ⇒ 旧实现必然截掉新增块',
        'rawSec=' + rawSecLen + ' rawCk=' + rawCkLen + ' 合计=' + (rawSecLen + rawCkLen) + ' 门限=' + threshold)
      const out = renderT2Pre(ev)
      // ★★E2 判据修正（Lead 2026-10-25 诊断 · **判据缺陷，不是代码缺陷**）：
      //   原判据 `!out.endsWith('…')` 把「**段内配额截断**」误判成「**总限截断**」。
      //   真实数据 outcome 原文 1,172 字 ⇒ 被 outcome 段自己的配额截断 ⇒ 结尾「…」是**正常的**。
      //   ⇒ 拆成两条（这才是 E2 真正想守的两件事）：
      //     ① 总限未触发：`out.length <= RENDER_LIMITS.T2`
      //     ② 干净样本不以省略号结尾：**另造 outcome 很短的 fixture**（真实数据天然会被段配额截断，不适合）
      ok(out.length <= RENDER_LIMITS.T2, '★★E2a 真实数据下 T2 **总限未触发**（这才是原判据真正想守的）', 'len=' + out.length + ' ≤ ' + RENDER_LIMITS.T2)
      // 干净样本：outcome 很短 ⇒ 任何段都不会截断 ⇒ 可以断言「不以省略号结尾」
      const cleanEv = { name: '干净样本', status: 'active', sections: {}, checkpoints: [], outcome: '已完成' }
      const cleanOut = renderT2Pre(cleanEv)
      ok(!cleanOut.endsWith('\u2026'), '★★E2b 干净样本（outcome 很短）T2 **不以省略号结尾**', JSON.stringify(cleanOut.slice(-20)))
      // ★E2c 用户/Lead 要求的 outcome 回收验证
      const oi2 = out.indexOf('· 成果：')
      const usedBefore2 = oi2 >= 0 ? out.slice(0, oi2).length : out.length
      const roomNow = Math.max(T2_BUDGET.OUTCOME, Math.min(400, RENDER_LIMITS.T2 - usedBefore2 - 4))
      ok(roomNow > T2_BUDGET.OUTCOME, '★★★E2c outcome **可回收空间 > 保底 120**（旧实现白浪费）', '实得 ' + roomNow + '（保底 ' + T2_BUDGET.OUTCOME + '，回收 ' + (roomNow - T2_BUDGET.OUTCOME) + '）')
      ok(out.length < RENDER_LIMITS.T2, '★★E3 真实数据下 T2 总长 < ' + RENDER_LIMITS.T2, 'len=' + out.length)
      ok(out.includes('最近检查点'), 'E4 真实数据下检查点块在场')
      // ★★Lead 要求：预算不足时**最新那条必须仍在**、被丢的必须是更旧的（真实数据刚好 dropped=1，是天然样本）
      const last3ForNewest = (Array.isArray(ev.checkpoints) ? ev.checkpoints : []).slice(-3)
      const newestRaw = String((last3ForNewest[last3ForNewest.length - 1] || {}).text || '')
      const ckRes = buildCheckpointsBlockPre(ev, 3)
      const ckRows = ckRes.lines.filter((l) => l.startsWith('  - ['))
      // ★★2026-10-25 修（Lead 诊断 · H4 断言设计缺陷）：原来这里是**硬前置**
      //   `ok(ckRes.checkpointsDropped > 0, '真实数据确实触发了丢弃')`。
      //   但真实数据会随使用演化 —— 两小时内 append 后「最近 3 条」从 2,381 字降到 1,382 字，
      //   dropped 从 1 变 0 ⇒ 断言红。**把「当前数据恰好满足」当成「永远满足」是错的。**
      //   判据：断言不得依赖真实数据的当前形状 ⇒ 真实数据只做**附加证据**（条件断言），
      //         必要前置改由**测试自造固定形状**（E5b/E6b/E6c）承担。
      if (ckRes.checkpointsDropped > 0) {
        ok(ckRows.some((l) => newestRaw && l.includes(newestRaw.slice(0, 30))),
          '★★E6a 真实数据（dropped=' + ckRes.checkpointsDropped + '）下最新那条仍在输出里（保最新）')
      } else {
        ok(ckRows.length === Math.min(3, last3ForNewest.length),
          'E6a′ 真实数据未触发丢弃（dropped=0）⇒ 3 条全渲，方向断言由 E6b/E6c 覆盖',
          'rows=' + ckRows.length)
      }
      ok(ckRows.length >= 1, 'E7 至少渲染 1 条检查点')

      // ══════════════════════════════════════════════════════════════
      // ★★E5b/E6b/E6c：**造数定形状**（不依赖真实数据）
      //   3 条各 400 字 ⇒ 3×400=1,200 > CHECKPOINTS(900) ⇒ 必然触发丢弃。
      //   ★E6c 是关键：它第一次真正证明「丢的是最旧」——
      //     原 E6 只证「最新在」，若实现改回「从头部遍历但只丢最后一条」，E6 仍绿。
      // ══════════════════════════════════════════════════════════════
      const bigCk = Array.from({ length: 3 }, (_, i) => ({ kind: 'log', text: 'CK' + (i + 1) + ' ' + 'x'.repeat(400) }))
      const bigRes = buildCheckpointsBlockPre(mk({ checkpoints: bigCk }), 3)
      const bigRows = bigRes.lines.filter((l) => l.startsWith('  - ['))
      ok(bigRes.checkpointsDropped >= 1,
        '★★E5b 造数（3 条 × 400 字）必定触发丢弃 ⇒ 天然样本可由测试自己造',
        'dropped=' + bigRes.checkpointsDropped)
      ok(bigRows.some((l) => l.includes('CK3')),
        '★★E6b 造数下**最新那条（CK3）仍在**输出里')
      ok(!bigRows.some((l) => l.includes('CK1')),
        '★★★E6c 造数下**最旧那条（CK1）被丢弃** —— 证明是「保最新丢最旧」而不是「保最旧」',
        'rows=' + bigRows.map((r) => (r.match(/CK\d/) || [''])[0]).join(','))
    }
  }
}

console.log('')
console.log('[h4-t2-percept] ' + pass + ' PASS / ' + fail + ' FAIL')
process.exit(fail ? 1 : 0)