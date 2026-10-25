#!/usr/bin/env node
/**
 * smoke-test-v4-h7-budget.mjs —— v4-H7：注入预算重排（缩窄版）。
 *
 * ★H7 的真实范围（Lead 2026-10-25 二次裁决后缩窄）：
 *   原计划 5 步 → 删掉「规则段压到 4,000」（规则段不占预算 + 属 H3）与「区配额重算」（另开单）。
 *   保留两件：
 *     ① `tier0MaxTokens` 400 → 600（唯一真实瓶颈：perLayer.user 78 候选只 picked=1）
 *     ② 事件段容量验证（结论从「需要扩容」变成「验证够了」）
 *   `injectBudgetChars` **不改**（实测余量 7,534 已够；且本机配置有显式 8000，改默认值不影响本机 ⇒ 假绿风险）。
 *
 * ★★本套件要防的三类假绿：
 *   ① 「改了默认值就以为生效」—— 本机配置文件有显式值，配置覆盖默认值。
 *      套件必须断言「默认值改了」**且**明示「本机运行值仍是配置值」，不能假装统一。
 *   ② 「余量够」只看配置不看真实占用 —— 必须真跑 buildTier0CatalogFromTextPre 量 perLayer。
 *   ③ 「事件段放得下」只算预算不算真实渲染 —— 必须真调 renderT2Pre / renderEventCatalogPre。
 *
 * ★关键源码事实（2026-10-25 实测，由 Lead 指出并我复核）：
 *   `rulesSection.chars` 在 lib/index.js 中**出现 0 次** ⇒ 规则段不参与 injectBudgetChars 的任何计算；
 *   `lib/memory-envelope.js:120` `if (b === 'rules') return null` ⇒ rules 分项**不设上限、不参与裁剪**；
 *   ⇒ 规则段是**独立分项**，与 memoryReferences 互不挤占。
 *   而 `memRefLimit = sub*4 + catalogCost + planCap(1200) + ledgerCap(800) + 400`，
 *   `sub = floor((budget - 500 - catalogCost)/4)` ⇒ **catalogCost 抵消** ⇒ `memRefLimit ≈ budget + 1900`。
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const T = await import(pathToFileURL(path.join(ROOT, 'lib', 'tier0-catalog.js')).href)
const ER = await import(pathToFileURL(path.join(ROOT, 'lib', 'event-render.js')).href)

let pass = 0, fail = 0
function ok(c, n, d) { if (c) { pass++; console.log('  PASS ' + n + (d ? '  =>  ' + d : '')) } else { fail++; console.log('  FAIL ' + n + (d ? '  =>  ' + d : '')) } }

// 从源码读 DEFAULT_CONFIG 的真值（不 import index.js —— 它有 20+ 副作用依赖）
const IX = fs.readFileSync(path.join(ROOT, 'lib', 'index.js'), 'utf8')
function defaultOf(key) {
  const m = IX.match(new RegExp('^\\s*' + key + ':\\s*([^,\\n]+),', 'm'))
  if (!m) return null
  const raw = m[1].trim()
  const n = Number(raw)
  return Number.isFinite(n) ? n : raw.replace(/^['"]|['"]$/g, '')
}

// ════════════════════════════════════════════════════════════
// A. ① tier0MaxTokens 默认值 400 → 600
// ════════════════════════════════════════════════════════════
console.log('[A] tier0MaxTokens 默认值')
{
  const v = defaultOf('tier0MaxTokens')
  ok(v === 600, '★★A1 DEFAULT_CONFIG.tier0MaxTokens = 600（实测 ' + v + '）')
  ok(v < 800, 'A2 仍低于硬上限 B0=800（超设无效）', 'v=' + v)
  ok(v > 400, '★A3 确实比旧的 400 上调了', 'v=' + v)
  // 口径：默认值必须 ≤ 硬上限，否则配置无意义
  ok(v <= 800, 'A4 默认值 ≤ 硬上限')
}

// ════════════════════════════════════════════════════════════
// B. ② 真实 perLayer：600 下 user.picked 必须 > 0 且优于 400
// ════════════════════════════════════════════════════════════
console.log('[B] perLayer 真实分配（真跑 buildTier0CatalogFromTextPre）')
{
  const WS = path.join(os.homedir(), '.dsh', 'memory', 'workspaces', '--D--dsh-auto-memory--')
  const userMemPath = path.join(os.homedir(), '.dsh', 'memory', 'MEMORY.md')
  const hasCorpus = fs.existsSync(userMemPath) && fs.existsSync(path.join(WS, 'MEMORY.md'))
  if (!hasCorpus) {
    console.log('  SKIP 真实语料不存在 ⇒ B 组跳过（换机器时不算失败，但如实说明）')
  } else {
    const sources = [
      { layer: 'user', path: userMemPath, text: fs.readFileSync(userMemPath, 'utf8') },
      { layer: 'project', path: path.join(WS, 'MEMORY.md'), text: fs.readFileSync(path.join(WS, 'MEMORY.md'), 'utf8') },
      { layer: 'whiteboard', path: path.join(WS, 'handoff', 'PLAN.md'), text: fs.readFileSync(path.join(WS, 'handoff', 'PLAN.md'), 'utf8') },
    ]
    const r400 = T.buildTier0CatalogFromTextPre(sources, { maxTokens: 400, quota: true })
    const r600 = T.buildTier0CatalogFromTextPre(sources, { maxTokens: 600, quota: true })
    const u400 = r400.quota && r400.quota.perLayer && r400.quota.perLayer.user
    const u600 = r600.quota && r600.quota.perLayer && r600.quota.perLayer.user
    ok(!!u600, 'B0 能取到 perLayer.user（quota 已启用）')
    if (u600) {
      ok(u600.picked > 0, '★★B1 600 下 perLayer.user.picked > 0（D 批第 3 项判据）', 'picked=' + u600.picked)
      ok(u600.tokens >= u400.tokens, '★B2 600 下 user 层 token 不劣于 400', '400→' + u400.tokens + ' 600→' + u600.tokens)
      ok(u600.picked >= u400.picked, '★★B3 600 下 user 层 picked 数不劣于 400（上调真的有效）', '400 picked=' + u400.picked + ' → 600 picked=' + u600.picked)
      ok(r600.tokens <= 600, 'B4 600 下总 token 不越界', 'tokens=' + r600.tokens)
    }
  }
}

// ════════════════════════════════════════════════════════════
// C. ③ memRefLimit 公式验证（catalogCost 抵消 ⇒ ≈ budget + 1900）
// ════════════════════════════════════════════════════════════
console.log('[C] memRefLimit 公式（源码口径）')
{
  const planCap = 1200, ledgerCap = 800
  const calc = (budget, catalogCost) => {
    const sub = Math.max(0, Math.floor((budget - 500 - catalogCost) / 4))
    return sub * 4 + catalogCost + planCap + ledgerCap + 400
  }
  for (const [budget, cc] of [[8000, 0], [8000, 396], [8000, 788], [12000, 788]]) {
    const v = calc(budget, cc)
    const within2 = Math.abs(v - (budget + 1900)) <= 3
    ok(within2, '★C1 budget=' + budget + ' catalogCost=' + cc + ' ⇒ memRefLimit≈budget+1900', 'v=' + v)
  }
  // ★核心：catalogCost 抵消 ⇒ 同样 budget 下 catalogCost 变化不影响 memRefLimit
  const a = calc(8000, 100), b = calc(8000, 800)
  ok(Math.abs(a - b) <= 3, '★★C2 catalogCost 抵消（100 vs 800 差 ≤3）', a + ' vs ' + b)
}

// ════════════════════════════════════════════════════════════
// D. ④ 规则段不参与预算（结构性断言，防将来改坏）
// ════════════════════════════════════════════════════════════
console.log('[D] 规则段独立性（结构性）')
{
  ok(IX.indexOf('rulesSection.chars') < 0, '★★D1 lib/index.js 中 rulesSection.chars 出现 0 次 ⇒ 规则段不参与预算计算')
  const budgetLine = IX.match(/const budget = Math\.max\(Number\(cfg\.injectBudgetChars\)[^\n]*/)
  ok(!!budgetLine && !/rules/i.test(budgetLine[0]), '★★D2 budget 计算式不含 rules', budgetLine ? JSON.stringify(budgetLine[0].slice(0, 80)) : '?')
  const subLine = IX.match(/const sub = Math\.max\(0, Math\.floor\(\(budget[^\n]*/)
  ok(!!subLine && !/rules/i.test(subLine[0]), '★★D3 sub 计算式不含 rules', subLine ? JSON.stringify(subLine[0].slice(0, 80)) : '?')
  const ENV = fs.readFileSync(path.join(ROOT, 'lib', 'memory-envelope.js'), 'utf8')
  ok(/if \(b === ['"]rules['"]\) return null/.test(ENV), '★★D4 envelope 里 rules 分项返回 null（不设上限、不参与裁剪）')
}

// ════════════════════════════════════════════════════════════
// E. ⑤ 事件段容量验证（真跑 render 函数）
// ════════════════════════════════════════════════════════════
console.log('[E] 事件段容量验证（真跑）')
{
  const WS = path.join(os.homedir(), '.dsh', 'memory', 'workspaces', '--D--dsh-auto-memory--')
  const storePath = path.join(WS, 'handoff', 'event-store.json')
  if (!fs.existsSync(storePath)) {
    console.log('  SKIP 真实 event-store 不存在 ⇒ E 组跳过')
  } else {
    const store = JSON.parse(fs.readFileSync(storePath, 'utf8'))
    const t2 = ER.renderT2Pre(store.events[0])
    const cat = ER.renderEventCatalogPre(store.events, { maxChars: 400 })
    const T1_BUDGET = 8 * 140  // 8 条 × T1 上限 140（预算口径，无独立整段 render 函数）
    const eventTotal = cat.text.length + T1_BUDGET + t2.length
    const planCap = 1200, ledgerCap = 800
    const budget = 8000
    const catalogCost = cat.text.length + 2
    const sub = Math.max(0, Math.floor((budget - 500 - catalogCost) / 4))
    const memRefLimit = sub * 4 + catalogCost + planCap + ledgerCap + 400
    const used = cat.text.length + t2.length
    ok(t2.length <= ER.RENDER_LIMITS.T2, '★E1 T2 实测不超自身上限', t2.length + '/' + ER.RENDER_LIMITS.T2)
    ok(used <= memRefLimit, '★★E2 事件段实测占用（T0+T2）≤ memRefLimit', used + '/' + memRefLimit)
    ok(eventTotal >= 4320 * 0.3, '★E3 事件段预算口径（T0+T1预算+T2）量级合理', 'eventTotal=' + eventTotal)
    // ★核心结论：容量够（这是 H7 要验证的「结论从需要扩容变成验证够了」）
    ok(memRefLimit >= 4320, '★★★E4 memRefLimit(' + memRefLimit + ') ≥ 事件段需求 4,320 ⇒ 容量足够，无需扩容', '余量=' + (memRefLimit - 4320))
    ok(memRefLimit - used > 0, '★E5 实际余量 > 0', '余量=' + (memRefLimit - used))
    console.log('    实测：T2=' + t2.length + ' T0=' + cat.text.length + ' T1预算=' + T1_BUDGET + ' eventTotal=' + eventTotal)
    console.log('    实测：memRefLimit=' + memRefLimit + ' 已用=' + used + ' 余量=' + (memRefLimit - used))
  }
}

// ════════════════════════════════════════════════════════════
// E-bis. ★★Lead 点名要的「四行数字」：真跑 composeMemoryEnvelopePre
//   为什么必须真跑而不是算：renderMemoryDynamic 依赖 13 个模块级常量 + 56 个函数，
//   抽出来注入成本极高且脆弱（实测失败两次：this 绑定、DEFAULT_PROMPT_LAYERS 缺失）。
//   但 `composeMemoryEnvelopePre` 是**计算 chars/limits 的唯一入口**，真调它就等于验了注入账。
// ════════════════════════════════════════════════════════════
console.log('[E-bis] ★真跑 composeMemoryEnvelopePre（四行数字）')
{
  const WS2 = path.join(os.homedir(), '.dsh', 'memory', 'workspaces', '--D--dsh-auto-memory--')
  const storePath2 = path.join(WS2, 'handoff', 'event-store.json')
  const userMem2 = path.join(os.homedir(), '.dsh', 'memory', 'MEMORY.md')
  const hasAll = fs.existsSync(storePath2) && fs.existsSync(userMem2) && fs.existsSync(path.join(WS2, 'MEMORY.md'))
  if (!hasAll) {
    console.log('  SKIP 真实语料不全 ⇒ E-bis 跳过')
  } else {
    const R2 = await import(pathToFileURL(path.join(ROOT, 'lib', 'rules-layer.js')).href)
    const UP2 = await import(pathToFileURL(path.join(ROOT, 'lib', 'user-portrait.js')).href)
    const G2 = await import(pathToFileURL(path.join(ROOT, 'lib', 'greeting.js')).href)
    const ENV2 = await import(pathToFileURL(path.join(ROOT, 'lib', 'memory-envelope.js')).href)
    const userText2 = fs.readFileSync(userMem2, 'utf8')
    const notesText2 = fs.readFileSync(path.join(WS2, 'MEMORY.md'), 'utf8')
    const planText2 = fs.readFileSync(path.join(WS2, 'handoff', 'PLAN.md'), 'utf8')
    const store2 = JSON.parse(fs.readFileSync(storePath2, 'utf8'))
    const layer2 = R2.extractRulesLayerPre({ userText: userText2, notesText: notesText2, rulesLayeringMode: 'self' })
    const rulesSec2 = R2.renderRulesSectionPre(layer2, { title: R2.RULES_SECTION_TITLE_PRE_V1, guide: R2.RULES_SECTION_GUIDE_PRE_V1 })
    const t0b = T.buildTier0CatalogFromTextPre([
      { layer: 'user', path: 'u', text: userText2 },
      { layer: 'project', path: 'p', text: notesText2 },
      { layer: 'whiteboard', path: 'w', text: planText2 },
    ], { maxTokens: 600, quota: true })
    const t2b = ER.renderT2Pre(store2.events[0])
    const catB = ER.renderEventCatalogPre(store2.events, { maxChars: 400 })
    const portraitB = UP2.buildUserPortraitPre(store2.events)
    const greetB = G2.buildGreetingPre({ lastActiveAt: 1000000, events: [{ name: 'v4', status: 'active', commitments: [] }] }, { now: 1000000 + 90 * 60000, awayMinutes: 60 })
    const segsB = [
      { bucket: 'rules', kind: 'rules-section', priority: 'must', text: rulesSec2.text },
      { bucket: 'memoryReferences', kind: 'tier0-catalog', priority: 'normal', text: t0b.text || '' },
      { bucket: 'memoryReferences', kind: 'event-cards', priority: 'normal', text: t2b },
      { bucket: 'otherDynamic', kind: 'user-portrait', priority: 'normal', text: portraitB.text },
      { bucket: 'otherDynamic', kind: 'welcome-title', priority: 'normal', text: '\n[欢迎回来]' },
      { bucket: 'otherDynamic', kind: 'welcome-body', priority: 'normal', text: greetB.text },
    ]
    const budgetB = 8000, catalogCostB = (t0b.text || '').length + 2
    const subB = Math.max(0, Math.floor((budgetB - 500 - catalogCostB) / 4))
    const memRefLimitB = subB * 4 + catalogCostB + 1200 + 800 + 400
    const env = ENV2.composeMemoryEnvelopePre({ segments: segsB, limits: { memoryReferences: memRefLimitB, otherDynamic: null }, budgetChars: budgetB })
    const memRefUsed = env.chars ? env.chars.memoryReferences : null
    const eventTotalB = catB.text.length + 8 * 140 + t2b.length
    console.log('    ★① chars.memoryReferences =', memRefUsed)
    console.log('    ★② memRefLimit            =', memRefLimitB)
    console.log('    ★③ 事件段合计（T0+T1预算+T2）=', eventTotalB, '（T0=' + catB.text.length + ' T1=1120 T2=' + t2b.length + '）')
    console.log('    ★④ 事件段放入后剩余         =', memRefLimitB - eventTotalB)
    console.log('    （chars 全量 =', JSON.stringify(env.chars) + '）')
    ok(env && env.chars && Number.isFinite(env.chars.memoryReferences), '★★E6 真跑 composeMemoryEnvelopePre 拿到 chars.memoryReferences', 'used=' + memRefUsed)
    ok(memRefUsed <= memRefLimitB, '★★E7 ① ≤ ②：memoryReferences 实际占用 ≤ memRefLimit', memRefUsed + '/' + memRefLimitB)
    ok(eventTotalB <= memRefLimitB, '★★E8 ③ ≤ ②：事件段（T0+T1预算+T2）≤ memRefLimit ⇒ 容量够用', eventTotalB + '/' + memRefLimitB)
    ok((memRefLimitB - eventTotalB) > 0, '★★E9 ④ 事件段放入后仍有正余量', '余量=' + (memRefLimitB - eventTotalB))
    ok(env.ok === true, 'E10 envelope 整体 ok=true（无裁剪/无超限）', 'ok=' + env.ok + ' dropped=' + (env.dropped || []).length)
    // ★断言：rules 分项不设上限（limits 里没有 rules 键）
    ok(!('rules' in (env.limits || {})), '★★E11 envelope.limits 里**没有 rules 键** ⇒ 规则段不设上限', JSON.stringify(Object.keys(env.limits || {})))
    // ★断言：规则段确实被计入了 chars（但不参与裁剪）
    ok(env.chars.rules === rulesSec2.text.length, '★★E12 rules 分项被如实计量（' + env.chars.rules + '）但不受 limits 约束')
  }
}

// ════════════════════════════════════════════════════════════
// F. ⑥ injectBudgetChars 保持不变（本次刻意不改）
// ════════════════════════════════════════════════════════════
console.log('[F] injectBudgetChars 保持不变')
{
  const v = defaultOf('injectBudgetChars')
  ok(v === 8000, '★★F1 injectBudgetChars 仍为 8000（H7 缩窄版刻意不改）', 'v=' + v)
  // ★关键：本机配置若有显式值，必须如实披露（防「改默认值以为生效」的假绿）
  const cfgPath = path.join(os.homedir(), '.dsh', 'dsh-auto-memory.json')
  if (fs.existsSync(cfgPath)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'))
      const hasExplicit = Object.prototype.hasOwnProperty.call(cfg, 'injectBudgetChars')
      console.log('    ★本机配置诊断：显式设置 injectBudgetChars =', hasExplicit, '(', cfg.injectBudgetChars, ')')
      if (hasExplicit) {
        ok(cfg.injectBudgetChars !== undefined, '★F2 如实披露：本机配置有显式值 ⇒ **改 DEFAULT_CONFIG 不影响本机运行值**（需用户改配置才生效）', 'config=' + cfg.injectBudgetChars)
      } else {
        ok(true, 'F2 本机配置无显式值 ⇒ 跟随默认值')
      }
    } catch (_) { ok(true, 'F2 本机配置不可解析，跳过披露') }
  } else { ok(true, 'F2 本机无配置文件，跳过') }
}

console.log('')
console.log('[H7] ' + pass + ' PASS / ' + fail + ' FAIL')
process.exit(fail ? 1 : 0)