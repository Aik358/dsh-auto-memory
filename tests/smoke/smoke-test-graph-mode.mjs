/**
 * WB-GRAPH graph 档端到端验收(2026-09-16) —— 抓「结构性假绿」的那一条套件。
 *
 * 为什么必须单独存在(自审漏报 4 条致命的根因):
 *   新工具全挂在 `boardMode==='graph'` 闸门后, 而既有回归**全跑 legacy 档** ⇒ graph 分支一行不执行;
 *   P23 套件的 M6 只比「同源 rebuild 自洽」、M7 手工拼 index.json **绕过引擎两咽喉**。
 *   ⇒ 那两个套件断言的是"纯函数自洽", 不是"档位端到端", 于是:
 *     - BUG-1/11(注册闸门结构性恒假): 工具永不注册, 却无断言
 *     - BUG-10(同一账本 write/rebuild 两个 id): 两条路径从未对撞
 *   本套件把 boardMode 置为 graph, **走真实 apply()**, 并做 write→rebuild→trace 闭环。
 *
 * 权威依据: WB-GRAPH-INTEGRATION-PLAN §5(P2-1..P3-3) + WB-FORMAT-CONVENTION §2/§3/§8
 *          + MASTER-PLAN-3.0 §6 交付纪律(能失败断言 / 开关回退 / 落点到函数名)。
 */
import { apply } from '../../lib/index.js'
import { buildKanbanMatrixPre as buildMatrixForTest } from '../../lib/wb-sidecar.js'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({}) })
process.on('uncaughtException', (e) => { console.error('\n[GRAPH-FATAL] uncaughtException:', (e && (e.stack || e.message)) || e); process.exit(1) })
process.on('unhandledRejection', (r) => { console.error('\n[GRAPH-FATAL] unhandledRejection:', (r && (r.stack || r.message)) || r); process.exit(1) })

let pass = 0, fail = 0
// ★ 2026-09-16 晚修: 异步断言必须被**收集并在汇总前 await**。
//   原实现 `const ta = async (...) => {...}` 调用处不 await ⇒ 汇总行在 F8/G4/G5 完成前就打印,
//   它们的失败被漏计(甚至可能 exit 0) —— 与「断言文本在场 ≠ 运行时可跑」同类的假绿形态。
const pending = []
const t = (name, fn) => {
  try { fn(); pass++; console.log('  ok - ' + name) }
  catch (e) { fail++; console.log('  FAIL - ' + name + ': ' + (e && e.message || e)) }
}
const ta = (name, fn) => {
  const p = (async () => {
    try { await fn(); pass++; console.log('  ok - ' + name) }
    catch (e) { fail++; console.log('  FAIL - ' + name + ': ' + (e && e.message || e)) }
  })()
  pending.push(p)
  return p
}
const assert = (c, m) => { if (!c) throw new Error(m) }

/** 在临时 DSH_HOME 内 boot 一个插件实例(真 apply), 返回注册表 + engine 句柄。 */
function bootPre(boardMode) {
  const ws = mkdtempSync(path.join(tmpdir(), 'dam-graph-'))
  const home = path.join(ws, '.dsh-home')
  mkdirSync(home, { recursive: true })
  const memRoot = path.join(ws, '.memory-root')
  writeFileSync(path.join(home, 'dsh-auto-memory.json'), JSON.stringify({
    memoryRoot: memRoot,
    userMemoryDir: path.join(ws, '.user-root'),
    projectMemoryDir: '.project-memory',
    externalSources: {},
    boardMode,
    // 看板路由要求 handoff 开启(与 legacy 一致的门); 不开则返回 {enabled:false, reason:'handoff-disabled'}
    handoffEnabled: true,
  }), 'utf8')
  const prevHome = process.env.DSH_HOME
  process.env.DSH_HOME = home
  const tools = [], routes = [], sections = [], contexts = [], effects = [], disposers = []
  const ctx = {
    get() { return undefined },
    on() { return () => {} },
    effect(fn, label) { effects.push(label); if (typeof fn === 'function') disposers.push(fn); return () => {} },
    systemPrompt: {
      section(s) { sections.push(s); return () => {} },
      context(c) { contexts.push(c); return () => {} },
    },
    tools: { register(d) { tools.push(d); return () => {} } },
    webServer: { register(r) { routes.push(r); return () => {} } },
  }
  apply(ctx, {})
  return { ws, home, memRoot, tools, routes, sections, contexts, effects, disposers, prevHome }
}

const cleanup = (b) => {
  for (const d of b.disposers || []) { try { d() } catch (_) {} }
  if (b.prevHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = b.prevHome
  try { rmSync(b.ws, { recursive: true, force: true }) } catch (_) {}
}

console.log('=== WB-GRAPH graph 档端到端 ===')

// ─────────────────────────────────────────────────────────────
// A. graph 档: 工具数 14 → 16, 两个遍历工具**真的注册**(修 BUG-1/11 的验收)
// ─────────────────────────────────────────────────────────────
const bg = bootPre('graph')
t('A1 graph 档工具数 = 19(13 旧 + 2 遍历 + 1 ? + T4 + P9 + M8-B) —— 断言「至少含两遍历工具」且计数一致', () => {
  const names = bg.tools.map((x) => x.name)
  assert(names.includes('memory_expand'), 'graph 档必须注册 memory_expand(修 BUG-1: 此前闸门恒假, 永不注册)')
  assert(names.includes('memory_trace'), 'graph 档必须注册 memory_trace')
  assert(bg.tools.length === 19, 'graph 档工具数应为 19, 实为 ' + bg.tools.length + ': ' + names.join(','))
})
t('A2 两遍历工具契约完整(parameters.id/tag + execute 是函数)', () => {
  const ex = bg.tools.find((x) => x.name === 'memory_expand')
  const tr = bg.tools.find((x) => x.name === 'memory_trace')
  assert(ex.parameters && ex.parameters.properties && ex.parameters.properties.tag, 'expand 需 tag 参数')
  assert(typeof ex.execute === 'function', 'expand.execute 必须是函数')
  assert(tr.parameters && tr.parameters.properties && tr.parameters.properties.id, 'trace 需 id 参数')
  assert(typeof tr.execute === 'function', 'trace.execute 必须是函数')
})
t('A3 闸门来源是**同步读到的真配置**(boardMode=graph), 而非构造期默认 legacy', () => {
  // 若 loadConfigSync 未生效, apply 内读到的仍是 DEFAULT_CONFIG.boardMode='legacy' ⇒ 工具数 14。
  // 故 A1 的 16 本身就是该修复的行为断言; 此处再直接核源码存在同步载入调用。
  const src = readFileSync('lib/index.js', 'utf8')
  assert(/engine\.loadConfigSync\(\)/.test(src), 'apply 构建 tools 前必须调用 engine.loadConfigSync()(同步, 因为 apply 非 async 且 cordis 不 await 其返回值)')
  assert(/_mergeConfigPre/.test(src), 'loadConfig/loadConfigSync 必须共用合并单源(防双源漂移)')
})

// ─────────────────────────────────────────────────────────────
// B. 纯函数层: 契约补齐(BUG-7/12/13/14) —— index.json 必须含 §3.3 全套字段
// ─────────────────────────────────────────────────────────────
const sb = await import('../../lib/wb-sidecar.js')
t('B1 §3.3 index 结构: ws/rebuilt_at/entries + by_tag/by_cue/versions 全部在场', () => {
  const idx = sb.rebuildSidecarIndexPre('ws1', [
    { relPath: 'handoff/PLAN.md', text: '## 进度\ntype:dead-end 与 topic:登录 相关\n', title: '白板 PLAN', kind: 'plan' },
  ])
  for (const k of ['version', 'ws', 'rebuilt_at', 'entries', 'by_tag', 'by_cue', 'versions']) {
    assert(k in idx, 'index.json 缺字段 ' + k + '(§3.3 契约)')
  }
  assert(Object.keys(idx.by_tag).length > 0, 'by_tag 倒排不得为空')
})
t('B2 §4.1 条目字段: id/kind/source/section/tags/cues/preview/mtime/criteria 齐备', () => {
  const e = sb.buildSidecarEntryPre({
    workspaceKey: 'ws1', relPath: 'handoff/PLAN.md', title: '白板 PLAN',
    text: '## 卡片甲\n<!-- x -->\n见 src/lib/foo.js 与 `bar()` 调用\n', kind: 'plan', criteria: 'passed',
  })
  for (const k of ['id', 'kind', 'source', 'section', 'tags', 'cues', 'preview', 'mtime', 'criteria']) {
    assert(k in e, '条目缺字段 ' + k + '(§4.1 契约)')
  }
  assert(e.cues.length > 0, 'cues 应抽到路径/代码线索(入口 Cue)')
})
t('B3 BUG-13 tag 正则: 中文标点紧邻写法必须采到', () => {
  assert(sb.extractTagsPre('（topic:登录流程）').includes('topic:登录流程'), '中文括号紧邻应采到')
  assert(sb.extractTagsPre('格式：type:dead-end').includes('type:dead-end'), '中文冒号紧邻应采到')
  assert(sb.extractTagsPre('用 type:dead-end 表示').includes('type:dead-end'), '空白分隔仍应采到(不回退)')
  // 假阳性: 前缀左侧紧邻字母/汉字 ⇒ 属更长单词的一部分, 必须拒绝。
  // (注: `a:type:x` 不在此列 —— 左侧是冒号分隔符, 按约定接受; 见实现注释。)
  assert(!sb.extractTagsPre('xxxtype:dead-end').includes('type:dead-end'), 'xxxtype: 类假阳性须拒绝')
  assert(!sb.extractTagsPre('中文type:dead-end').includes('type:dead-end'), '汉字紧贴前缀须拒绝(仍属更长词)')
})
t('B4 BUG-14/12 返回契约: expand 带 preview/mtime/cues/criteria/total/truncated/hint', () => {
  const idx = sb.rebuildSidecarIndexPre('ws1', [
    { relPath: 'handoff/PLAN.md', text: 'type:dead-end AAA\n', title: '白板 PLAN', kind: 'plan' },
  ])
  const r = sb.expandByTagPre(idx, 'type:dead-end', 10)
  assert(r.total === 1, 'total 应为 1')
  for (const k of ['preview', 'source', 'mtime', 'cues', 'criteria']) {
    assert(k in r.entries[0], 'expand 条目缺 ' + k + '(规划 §4.1 要求)')
  }
  assert('truncated' in r && 'remaining' in r && 'hint' in r, 'expand 顶层缺 truncated/remaining/hint')
})
t('B5 BUG-12 trace 顶层字段: entry/cues/tags/neighbors/versions/hint', () => {
  const idx = sb.rebuildSidecarIndexPre('ws1', [
    { relPath: 'handoff/PLAN.md', text: 'type:dead-end AAA\n', title: '白板 PLAN', kind: 'plan' },
  ])
  const id = idx.entries[0].id
  const r = sb.traceByIdPre(idx, id)
  assert(r.found === true, 'found 应为 true')
  for (const k of ['entry', 'cues', 'tags', 'neighbors', 'versions', 'hint']) {
    assert(k in r, 'trace 顶层缺 ' + k + '(规划 §4.1 要求)')
  }
  assert(Array.isArray(r.versions), 'versions 必须是数组(归档链)')
})
t('B6 锚点契约 §2: applyAnchorsPre 幂等 + 重排不变 id + 改标题换 id', () => {
  const txt = '# 标题\n\n## 卡甲\n正文甲\n\n## 卡乙\n正文乙\n'
  const a1 = sb.applyAnchorsPre('ws1', 'handoff/PLAN.md', txt)
  assert(a1.added === 2, '两个 ## 卡应各加一锚点, 实为 ' + a1.added)
  const a2 = sb.applyAnchorsPre('ws1', 'handoff/PLAN.md', a1.text)
  assert(a2.text === a1.text, '幂等: 二次应用必须逐字节相同')
  assert(a2.added === 0 && a2.unchanged === 2, '二次应用应全部 unchanged')
  // 重排: 交换两卡顺序, id 集合不变
  const swapped = '# 标题\n\n## 卡乙\n正文乙\n\n## 卡甲\n正文甲\n'
  const a3 = sb.applyAnchorsPre('ws1', 'handoff/PLAN.md', swapped)
  const ids1 = sb.collectAnchorIdsPre(a1.text).sort()
  const ids3 = sb.collectAnchorIdsPre(a3.text).sort()
  assert(JSON.stringify(ids1) === JSON.stringify(ids3), '重排后 id 集合必须不变(§2 核心性质)')
  // 改标题 ⇒ 新 id
  const renamed = a1.text.replace('## 卡甲', '## 卡甲改名')
  const a4 = sb.applyAnchorsPre('ws1', 'handoff/PLAN.md', renamed)
  const ids4 = sb.collectAnchorIdsPre(a4.text)
  assert(ids4.filter((x) => ids1.includes(x)).length === 1, '改名后旧 id 应只剩 1 个(另一个换新)')
  assert(a4.updated === 1, '改名应触发 updated=1')
})
t('B7 锚点写在标题正下方, 且不碰 fenced code 内的 ## 行', () => {
  const txt = '## 卡甲\n\n```\n## 这不是标题\n```\n'
  const r = sb.applyAnchorsPre('ws1', 'handoff/PLAN.md', txt)
  const lines = r.text.split('\n')
  assert(/^<!-- memory:mem_[0-9a-f]{32} -->$/.test(lines[1]), '锚点必须紧跟标题行(第 2 行)')
  assert(r.added === 1, '代码块内的 ## 不得产生锚点')
})

// ─────────────────────────────────────────────────────────────
// C. BUG-10 对撞: 同一条目在 write 与 rebuild **两条路径**必须算出同一 id
// ─────────────────────────────────────────────────────────────
t('C1 BUG-10 write/rebuild 两路径 id 一致(正/反斜杠 + title 前缀差异已归一)', () => {
  const wsKey = '--D--dsh-auto-memory--'
  const fileName = 'handoff-20260916-020000.md'
  // write 侧(旧口径): path.relative 在 Windows 得反斜杠 + basename(含 handoff- 前缀)
  const writeRef = sb.wbRefPre('handoff\\' + fileName, '交接账本 ' + fileName)
  // rebuild 侧: 'handoff/' + f
  const rbRef = sb.wbRefPre('handoff/' + fileName, '交接账本 ' + fileName)
  assert(writeRef.relPath === rbRef.relPath, 'relPath 归一后必须相同(write=' + writeRef.relPath + ' rebuild=' + rbRef.relPath + ')')
  assert(writeRef.title === rbRef.title, 'title 归一后必须相同(write=' + writeRef.title + ' rebuild=' + rbRef.title + ')')
  const idW = sb.wbEntryIdPre(wsKey, writeRef.relPath, writeRef.title)
  const idR = sb.wbEntryIdPre(wsKey, rbRef.relPath, rbRef.title)
  assert(idW === idR, 'BUG-10: 同一账本两条路径必须同一 id, 实为 ' + idW + ' vs ' + idR)
})

// ─────────────────────────────────────────────────────────────
// D. legacy 对照(开关回退): 工具数**必须仍是 14**, 零行为变化
// ─────────────────────────────────────────────────────────────
// ★ T4(2026-09-19): 14→15 / 16→17 —— memory_procedure **无条件注册**(不属白板 P3 闸门),
//   故 legacy 与 graph 两档同时 +1;本节断言的**意图**(legacy ≠ graph, 证明闸门真的在起作用)不变。
t('D1 legacy 档工具数 = 17(与 graph 档 19 形成对照, 证明闸门真的在起作用)', () => {
  const bl = bootPre('legacy')
  try {
    const names = bl.tools.map((x) => x.name)
    assert(bl.tools.length === 17, 'legacy 档必须仍为 17 工具(15 + T4 memory_procedure + P9 memory_rules + M8-B memory_procedure_list), 实为 ' + bl.tools.length)
    assert(!names.includes('memory_expand'), 'legacy 档不得注册 memory_expand')
    assert(!names.includes('memory_trace'), 'legacy 档不得注册 memory_trace')
    // T4 工具**不属**白板闸门 ⇒ legacy 档也必须在场(反向保证:别把它错当 graph-only)
    assert(names.includes('memory_procedure'), 'legacy 档也必须注册 memory_procedure(它不受 boardMode 闸门管)')
    assert(names.includes('memory_procedure_list'), 'legacy 档也必须注册 memory_procedure_list(只读浏览同样不受 boardMode 闸门管)')
  } finally { cleanup(bl) }
})
t('D2 非法档位值 fail closed → legacy(17), 绝不猜 graph', () => {
  const bx = bootPre('bogus-mode')
  try {
    assert(bx.tools.length === 17, '非法值必须回落 legacy(17), 实为 ' + bx.tools.length)
  } finally { cleanup(bx) }
})

// ─────────────────────────────────────────────────────────────
// E. P2/P3 输入端与检索端接线(2026-09-16 补) —— 规划 §5 P2-3/P2-4/P2-5/P3-2
//    这四条共同特征: **函数写了但没人调用**(绿灯测不出来, 因为无副作用)。
//    ⇒ 断言口径必须是"调用点在场", 而不是"函数存在"。
// ─────────────────────────────────────────────────────────────
const IDX_SRC = readFileSync(new URL('../../lib/index.js', import.meta.url), 'utf8')
const CLI_SRC = readFileSync(new URL('../../lib/client.js', import.meta.url), 'utf8')

t('E1 P2-4 注入端真的调用了 whiteboardTagMapPre(不是只定义)', () => {
  // 定义处 `async whiteboardTagMapPre(` 不算数; 调用处必须是 `this.whiteboardTagMapPre(`
  const calls = (IDX_SRC.match(/this\.whiteboardTagMapPre\(/g) || []).length
  assert(calls >= 1, 'P2-4 接线: 注入端必须实际调用 whiteboardTagMapPre, 实为 ' + calls + ' 处')
  assert(IDX_SRC.includes('【白板 tag 地图(结构化导航)】'), 'P2-4 注入行文案不在场')
})

t('E2 P3-2 第3层唤醒句在场(且指明两工具名)', () => {
  assert(IDX_SRC.includes('【白板结构化检索(优先于通读第3层)】'), 'P3-2 唤醒句不在场')
  assert(IDX_SRC.includes('memory_expand(tag=') && IDX_SRC.includes('memory_trace(id)'),
    'P3-2 唤醒句必须同时点名 memory_expand 与 memory_trace')
})

t('E3 P2-3 searchHandoffCorpus 已升 tag/段级优先(结构化臂 + 词法兜底两段都在)', () => {
  const i = IDX_SRC.indexOf('async searchHandoffCorpus(')
  assert(i > 0, 'searchHandoffCorpus 不在场')
  const body = IDX_SRC.slice(i, i + 3000)
  assert(body.includes('by_tag') || body.includes('byTag'), 'P2-3: 结构化臂必须消费 by_tag 倒排')
  assert(body.includes('白板结构化/'), 'P2-3: 结构化命中必须带可辨识 label(白板结构化/)')
  assert(body.includes('const scan = async (label, filePath, maxMatches)'), 'P2-3: 词法臂(兜底)必须原样保留')
})

t('E4 P2-5 后端返回 structured + boardMode; 前端据 structured 渲染且 legacy 不渲染', () => {
  assert(IDX_SRC.includes('boardMode: (String((this.config || {}).boardMode'), 'P2-5: handoffPanelData 必须回传 boardMode')
  assert(/structured\s*=\s*\{[\s\S]{0,400}?tags:\s*tagRows/.test(IDX_SRC), 'P2-5: structured 必须含 tags 视图')
  assert(IDX_SRC.includes("sections: ['plan', 'ledger', 'archive']"), 'P2-5: structured 必须含按 kind 的段视图')
  // v2(2026-09-16 晚): 文字卡改为「真看板在场时退位」—— structured 仍条件渲染(legacy 不出现),
  //   且必须带 !kbData 守卫(避免与真看板同屏争位, 这是用户「就是没有图」的另一半原因)。
  assert(/if\s*\(data\.structured\s*&&\s*!kbData\)/.test(CLI_SRC), 'P2-5 前端: structured 卡必须**条件渲染**且在看板在场时退位(legacy 下不出现)')
})

t('E5 切换按键仍在白板页(开关回退入口不可丢)', () => {
  assert(CLI_SRC.includes("saveConfigPatch({ boardMode: next }"), '白板页切换按钮必须走 saveConfigPatch 落盘')
  assert(CLI_SRC.includes("'data-dam-key': 'boardMode'"), '切换按钮的 data-dam-key 必须仍是 boardMode')
})

// ─────────────────────────────────────────────────────────────
// F. 白板看板(2026-09-16「兼并 dsh-graph」) —— 可视化长在自己身上, 不挂第二个插件。
//    口径同 E 组: 断言**调用点/渲染守卫在场**, 而非函数存在。
// ─────────────────────────────────────────────────────────────
t('F1 看板投影纯函数在场且能分列(目标/进行中/失败与弯路/进度/归档)', () => {
  assert(typeof sb.buildKanbanPre === 'function', 'buildKanbanPre 必须导出')
  assert(Array.isArray(sb.WB_KANBAN_LANES_PRE_V1), '泳道定义必须导出')
  const lanes = sb.WB_KANBAN_LANES_PRE_V1.map((l) => l.key)
  for (const k of ['goal', 'state', 'deadend', 'progress', 'archive']) {
    assert(lanes.includes(k), '泳道缺少 ' + k)
  }
  const A = 'mem_' + 'a'.repeat(32)
  const kb = sb.buildKanbanPre({
    entries: [{ id: A, kind: 'ledger', source: 'handoff/handoff-1.md', section: '已试方案与失败原因', tags: ['type:dead-end'], title: 't', preview: 'p', criteria: 'passed', mtime: 1, chars: 1 }],
    by_tag: {}, versions: {},
  }, { now: 'T' })
  assert(kb.lanes.find((l) => l.key === 'deadend').count === 1, '失败与弯路泳道必须收到该条目')
  assert(kb.stats.total === 1 && kb.stats.passed === 1, 'stats 必须统计 total/passed')
})

t('F2 看板投影确定性(打乱输入顺序 → 输出仍逐字节相同; 同序断言太弱, 会被稳定排序骗过)', () => {
  const mk = (rev) => {
    const items = [
      { id: 'mem_' + 'b'.repeat(32), kind: 'plan', source: 'handoff/PLAN.md', section: '目标', tags: ['type:goal'], title: 'x', preview: '', criteria: 'unknown', mtime: 5, chars: 1 },
      { id: 'mem_' + 'a'.repeat(32), kind: 'plan', source: 'handoff/PLAN.md', section: '目标', tags: ['type:goal'], title: 'y', preview: '', criteria: 'unknown', mtime: 5, chars: 1 },
      { id: 'mem_' + 'c'.repeat(32), kind: 'plan', source: 'handoff/PLAN.md', section: '目标', tags: ['type:goal'], title: 'z', preview: '', criteria: 'unknown', mtime: 5, chars: 1 },
    ]
    return { entries: rev ? items.slice().reverse() : items, by_tag: {}, versions: {} }
  }
  const k1 = JSON.stringify(sb.buildKanbanPre(mk(false), { now: 'T' }))
  const k2 = JSON.stringify(sb.buildKanbanPre(mk(true), { now: 'T' }))
  assert(k1 === k2, '同一集合无论输入顺序如何, 输出必须相同(需 id 破平, 不能只比 mtime)')
})

t('F3 宿主侧 kanbanBoardData 挂载 + REST 路由 + 两侧路径表同步', () => {
  assert(IDX_SRC.includes('async kanbanBoardData('), 'kanbanBoardData 方法不在场')
  assert(IDX_SRC.includes("'kanban-board': '/api/dsh-auto-memory/kanban-board'"), '宿主 API 表缺 kanban-board')
  assert(IDX_SRC.includes("path: API['kanban-board']"), 'REST 路由未注册')
  assert(CLI_SRC.includes("kanbanBoard: ROUTE_PREFIX + '/kanban-board'"), '客户端 API 表缺 kanbanBoard')
})

t('F4 前端渲染: 看板组件在场 + graph 档才渲染(legacy 逐字节不变)', () => {
  assert(CLI_SRC.includes('function KanbanBoard(props)'), 'KanbanBoard 组件不在场')
  assert(CLI_SRC.includes('function KanbanCard(props)'), 'KanbanCard 组件不在场')
  assert(CLI_SRC.includes('data-dam-kanban'), '看板容器标记不在场')
  assert(CLI_SRC.includes('apiGet(API.kanbanBoard, { sessionId: sid })'), '看板数据未拉取')
  assert(CLI_SRC.includes('if (kbData) {'), '看板块必须**条件渲染**(legacy 下不出现)')
  assert(CLI_SRC.includes('setKbData(k && k.enabled ? k : null)'), 'legacy 档必须落回 null(不渲染)')
})

// ─────────────────────────────────────────────────────────────
// F. 白板看板 v2(2026-09-16 「大刀阔斧」批) —— **「看得见」口径**:
//    不再只断言结构正确, 而是断言内容真的呈现出来(小节数==卡数 / 主键唯一 / 乱序不变 /
//    泳道判据含小节标题 / 不静默丢卡 / 缩放与展开交互在场)。
//    教训来源: v1 的 22 条断言全绿却漏掉「三条泳道恒空 + 静默丢 19 条」——绿灯不是证据。
// ─────────────────────────────────────────────────────────────
t('F1 看板投影纯函数在场且能分列(目标/进行中/失败与弯路/进度/归档)', () => {
  assert(typeof sb.buildKanbanPre === 'function', 'buildKanbanPre 必须导出')
  assert(Array.isArray(sb.WB_KANBAN_LANES_PRE_V1), '泳道定义必须导出')
  const lanes = sb.WB_KANBAN_LANES_PRE_V1.map((l) => l.key)
  for (const k of ['goal', 'state', 'deadend', 'progress', 'archive']) {
    assert(lanes.includes(k), '泳道缺少 ' + k)
  }
  const A = 'mem_' + 'a'.repeat(32)
  const kb = sb.buildKanbanPre({
    entries: [{ id: A, kind: 'ledger', source: 'handoff/handoff-1.md', section: '已试方案与失败原因', tags: ['type:dead-end'], title: 't', preview: 'p', criteria: 'passed', mtime: 1, chars: 1 }],
    by_tag: {}, versions: {},
  }, { now: 'T' })
  assert(kb.lanes.find((l) => l.key === 'deadend').count === 1, '失败与弯路泳道必须收到该条目')
  assert(kb.stats.total === 1 && kb.stats.passed === 1, 'stats 必须统计 total/passed')
})

t('F2 小节切分: 每个 ## 一张卡 + 无 ## 时整篇回落 + 文档标题不成垃圾卡', () => {
  assert(typeof sb.splitSectionsPre === 'function', 'splitSectionsPre 必须导出')
  assert(typeof sb.buildSectionCardsPre === 'function', 'buildSectionCardsPre 必须导出')
  const doc = '# 账本标题\n## 任务状态\n- a\n## 已试方案与失败原因\n- b\n## 进度与下一步\n- c'
  const cards = sb.buildSectionCardsPre('ws', [{ relPath: 'handoff/h1.md', text: doc, kind: 'ledger', mtime: 1 }])
  assert(cards.length === 3, '三个 ## 小节必须切成三张卡, 实为 ' + cards.length)
  const titles = cards.map((c) => c.title)
  assert(titles.join('|') === '任务状态|已试方案与失败原因|进度与下一步', '卡片标题必须是小节标题, 实为 ' + titles.join('|'))
  assert(titles.indexOf('账本标题') < 0, '# 文档标题不得变成垃圾卡')
  const noH2 = sb.buildSectionCardsPre('ws', [{ relPath: 'handoff/x.md', text: '# 标题\n内容甲\n- 乙', kind: 'ledger' }])
  assert(noH2.length === 1 && noH2[0].preview.indexOf('内容甲') >= 0, '无 ## 的文档必须整篇回落成一节且不丢正文')
})

t('F3 卡主键: 唯一 + 可复算 + 乱序不变(野外锚点不唯一, 不得当主键)', () => {
  // 构造两个**不同文件、同小节名、同锚点 id** 的文档 —— 真实数据里实测到的形态
  const ANCHOR = 'mem_' + 'f'.repeat(32)
  const mk = (rev) => {
    const docs = [
      { relPath: 'handoff/a.md', text: '## 目标\n<!-- memory:' + ANCHOR + ' -->\n- 甲', kind: 'ledger', mtime: 7 },
      { relPath: 'handoff/b.md', text: '## 目标\n<!-- memory:' + ANCHOR + ' -->\n- 乙', kind: 'ledger', mtime: 7 },
      { relPath: 'handoff/c.md', text: '## 目标\n- 丙', kind: 'ledger', mtime: 7 },
    ]
    return rev ? docs.slice().reverse() : docs
  }
  const c1 = sb.buildSectionCardsPre('ws', mk(false))
  const ids = c1.map((c) => c.id)
  assert(new Set(ids).size === ids.length, '卡片主键必须唯一(重复: ' + ids.length + '->' + new Set(ids).size + ')')
  c1.forEach((c) => assert(/^mem_[0-9a-f]{32}/.test(c.id), '主键必须是规范式 mem_<hex>: ' + c.id))
  assert(c1[0].anchorId === ANCHOR, '锚点必须降级保留为 anchorId 参照字段')
  const empty = { entries: [], by_tag: {}, versions: {} }
  const k1 = JSON.stringify(sb.buildKanbanPre(empty, { cards: c1, now: 'T' }))
  const k2 = JSON.stringify(sb.buildKanbanPre(empty, { cards: sb.buildSectionCardsPre('ws', mk(true)), now: 'T' }))
  assert(k1 === k2, '同一集合无论输入顺序, 输出必须逐字节相同(需主键破平)')
})

t('F4 泳道判据含小节标题(不是只看 tag: 白板正文几乎没有语义 tag)', () => {
  const laneOf = sb.laneOfEntryPre
  assert(laneOf({ title: '已试方案与失败原因' }) === 'deadend', '失败小节必须进 deadend')
  assert(laneOf({ title: '关键坑(血泪)' }) === 'deadend', '「坑/血泪」类小节必须进 deadend')
  assert(laneOf({ title: '任务状态' }) === 'state', '任务状态必须进 state')
  assert(laneOf({ title: '目标' }) === 'goal', '目标必须进 goal')
  assert(laneOf({ title: '进度与下一步' }) === 'progress', '进度必须进 progress')
  assert(laneOf({ kind: 'archive', title: '随便' }) === 'archive', '归档 kind 优先')
})

t('F5 看板不静默丢卡(count 为真实数, 截断时回收进 omitted)', () => {
  const cards = []
  for (let i = 0; i < 12; i++) cards.push({ id: 'mem_' + String(i).padStart(32, '0'), title: '目标', section: '目标', kind: 'ledger', mtime: i, criteria: 'unknown' })
  const kb = sb.buildKanbanPre({ entries: [], by_tag: {}, versions: {} }, { cards, perLaneCap: 5, now: 'T' })
  const goal = kb.lanes.find((l) => l.key === 'goal')
  assert(goal.count === 12, 'count 必须是真实总数 12, 实为 ' + goal.count)
  assert(goal.shown === 5 && goal.omitted === 7, '截断必须显式回收: shown=5 omitted=7, 实为 ' + goal.shown + '/' + goal.omitted)
  assert(kb.stats.omitted === 7, 'stats.omitted 必须汇总')
  assert(Array.isArray(kb.recent) && kb.recent.length > 0, '必须有跨泳道「最近更新」聚合视图')
})

t('F6 宿主侧 kanbanBoardData 挂载 + **被调符号必须已 import** + 路由两侧同步', () => {
  assert(IDX_SRC.includes('async kanbanBoardData('), 'kanbanBoardData 方法不在场')
  assert(IDX_SRC.includes('_collectWhiteboardDocsPre('), '读盘必须走共用口径')
  const cn = (IDX_SRC.match(/buildSectionCardsPre\(/g) || []).length
  assert(cn >= 1, 'buildSectionCardsPre 调用点必须 >=1, 实为 ' + cn)
  assert(IDX_SRC.includes("'kanban-board': '/api/dsh-auto-memory/kanban-board'"), '宿主 API 表缺 kanban-board')
  assert(IDX_SRC.includes("path: API['kanban-board']"), 'REST 路由未注册')
  assert(CLI_SRC.includes("kanbanBoard: ROUTE_PREFIX + '/kanban-board'"), '客户端 API 表缺 kanbanBoard')
  // ★ 2026-09-16 晚补(真实事故): 上面全是「文本在场」, 抓不到 ReferenceError。
  //   本轮真实故障 = 调了 buildSectionCardsPre 但**忘了 import** ⇒ 路由返回
  //   {enabled:false, reason:'error', error:'buildSectionCardsPre is not defined'}
  //   ⇒ 前端 setKbData(null) ⇒ 看板完全不渲染, 而当时 29 条断言**全绿**。
  //   教训(泛化): 「调用点在场」还不够, 跨模块调用必须同时断言**被调符号在本模块 import 表里**。
  const imp = /import\s*\{([\s\S]*?)\}\s*from\s*'\.\/wb-sidecar\.js'/.exec(IDX_SRC)
  assert(imp, '未找到 wb-sidecar.js 的 import 语句')
  const imported = imp[1].split(',').map((s) => s.trim()).filter(Boolean)
  for (const sym of ['buildKanbanPre', 'buildSectionCardsPre']) {
    assert(imported.includes(sym), 'lib/index.js 调用了 ' + sym + ' 但**没有 import** ⇒ 运行时 ReferenceError(真实事故)')
  }
})

ta('F8 看板路由**端到端真调用**: graph 档返回 enabled=true 且 cardSource=section(绝不是 error)', async () => {
  const b = bootPre('graph')
  try {
    const route = b.routes.find((r) => String(r.path).indexOf('/kanban-board') >= 0)
    assert(route, 'kanban-board 路由未注册')
    let body = null
    const res = {
      writeHead() {}, setHeader() {}, statusCode: 0,
      end(s) { try { body = JSON.parse(s) } catch (_) { body = { raw: String(s).slice(0, 200) } } },
    }
    await route.handler({
      url: '/api/dsh-auto-memory/kanban-board', method: 'GET',
      headers: { host: '127.0.0.1:3080' }, socket: { remoteAddress: '127.0.0.1' },
    }, res)
    assert(body, '路由没有返回响应体')
    // ★ 核心: 绝不能是 error —— 这正是「就是没有图」的真实根因形态
    assert(body.reason !== 'error', '看板路由返回 error: ' + JSON.stringify(body.error || body))
    assert(body.enabled === true, 'graph 档看板必须 enabled=true, 实为 ' + JSON.stringify(body).slice(0, 200))
    assert(body.boardMode === 'graph', 'boardMode 必须回显 graph')
    assert(Array.isArray(body.lanes) && body.lanes.length > 0, '必须至少有一条泳道')
    // 空工作区 total=0 是合法态(cardSource 回落 file); 有内容时必须是小节卡数据源
    if (body.stats && body.stats.total > 0) {
      assert(body.stats.cardSource === 'section', '有内容时数据源必须是 section, 实为 ' + body.stats.cardSource)
    }
  } finally { cleanup(b) }
})

t('F7 前端 v2 交互: 缩放(字号+列宽) + 布局切换 + 展开全文 + 搜索 + 聚合视图 + 条件渲染', () => {
  assert(CLI_SRC.includes('function KanbanBoard(props)'), 'KanbanBoard 组件不在场')
  assert(CLI_SRC.includes('function KanbanCard(props)'), 'KanbanCard 组件不在场')
  assert(CLI_SRC.includes('data-dam-kanban'), '看板容器标记不在场')
  assert(CLI_SRC.includes("apiGet(API.kanbanBoard, { sessionId: sid })"), '看板数据未拉取')
  assert(CLI_SRC.includes('if (kbData) {'), '看板块必须**条件渲染**(legacy 下不出现)')
  assert(CLI_SRC.includes('setKbData(k && k.enabled ? k : null)'), 'legacy 档必须落回 null(不渲染)')
  // 缩放(P5/P6): 字号与列宽均可调且持久化
  assert(CLI_SRC.includes('KANBAN_ZOOM_KEY') && CLI_SRC.includes('KANBAN_COL_KEY'), '缩放/列宽偏好键不在场')
  assert(CLI_SRC.includes('localStorage.setItem'), '缩放偏好必须持久化(不能一刷新就回退)')
  // 布局(P7): 默认纵向堆叠
  assert(CLI_SRC.includes("|| 'stack'"), '默认布局必须是纵向堆叠(440px 面板里横向只看得到 2 列)')
  assert(CLI_SRC.includes('KANBAN_LAYOUT_KEY'), '布局偏好键不在场')
  // 展开(P12) + 搜索(P13) + 折叠(P14)
  assert(CLI_SRC.includes('展开全文'), '卡片必须可展开看全文')
  assert(CLI_SRC.includes("var viewPair = useState('lanes')"), '必须支持泳道/最近视图切换')
  assert(CLI_SRC.includes('data-dam-lane'), '泳道必须可折叠(带 data-dam-lane 标记)')
})

// ─────────────────────────────────────────────────────────────
// G. 双承载面(2026-09-16 晚批): conversation.view 整页看板 + 矩阵视图
//    背景: 侧边面板固定 440px 装不下矩阵(首列 + 5 列 ≈ 1000px+),
//          必须另开宽容器承载面 —— 否则矩阵只能挤在窄面板里。
//    本组口径 = F6/F8 同款: **调用点在场 + 被调符号已 import + 端到端真调用**,
//    绝不退回「函数已定义就算数」的假绿。
// ─────────────────────────────────────────────────────────────
t('G1 前端注册 conversation.view 槽位(整页看板唯一落点)', () => {
  assert(CLI_SRC.includes("slots.inject('conversation.view'"), '必须 inject conversation.view —— 否则整页看板永不出现(「函数写了没人调用」的老病)')
  assert(/slots\.register\(\s*\{\s*name:\s*'conversation\.view'/.test(CLI_SRC), "register 的 name 必须是 'conversation.view'(与 inject 同名)")
  assert(/id:\s*'auto-memory-pre-kanban'/.test(CLI_SRC), '槽位 id 不在场')
  assert(/label:\s*function\s*\(\)\s*\{\s*return\s+locale\s*===\s*'zh'/.test(CLI_SRC), 'label 必须是 locale 跟随函数(否则显示 undefined/切语言不重算)')
})

t('G2 整页组件与矩阵元素在场(看得见的口径)', () => {
  assert(CLI_SRC.includes('function KanbanView(props)'), 'KanbanView 组件不在场')
  assert(CLI_SRC.includes('function KanbanMatrixCard(props)'), '紧凑卡组件不在场')
  assert(CLI_SRC.includes('data-dam-kanban-view'), '整页容器标记不在场')
  assert(CLI_SRC.includes('data-dam-kx-head'), '矩阵表头标记不在场')
  assert(CLI_SRC.includes('data-dam-kx-row'), '矩阵行标记不在场(行折叠依赖)')
  assert(CLI_SRC.includes('data-dam-kx-cell'), '矩阵单元格标记不在场')
  assert(CLI_SRC.includes('data-dam-kx-card'), '矩阵紧凑卡标记不在场')
  assert(CLI_SRC.includes('data-dam-kx-drawer'), '抽屉标记不在场(宽屏看全文的核心增量)')
  assert(CLI_SRC.includes('gridTemplateColumns'), '必须是 CSS Grid 矩阵布局(原版同款范式)')
})

t('G3 矩阵投影: 数据层 export + **被调符号已 import** + host 载荷回传', () => {
  const WBS = readFileSync(new URL('../../lib/wb-sidecar.js', import.meta.url), 'utf8')
  assert(/export function buildKanbanMatrixPre\(/.test(WBS), 'buildKanbanMatrixPre 必须 export')
  assert(/export function ledgerDateOfPre\(/.test(WBS), 'ledgerDateOfPre 必须 export')
  const imp = /import\s*\{([\s\S]*?)\}\s*from\s*'\.\/wb-sidecar\.js'/.exec(IDX_SRC)
  assert(imp, '未找到 wb-sidecar.js import')
  const imported = imp[1].split(',').map((s) => s.trim()).filter(Boolean)
  assert(imported.includes('buildKanbanMatrixPre'), '调了 buildKanbanMatrixPre 但没 import ⇒ 运行时 ReferenceError')
  assert(IDX_SRC.includes('const matrix = buildKanbanMatrixPre('), 'host 必须真的调用矩阵投影')
  assert(/boardMode:\s*'graph',\s*cardSource:\s*'section',\s*matrix\s*\}/.test(IDX_SRC), '载荷必须带 matrix 字段')
})

ta('G4 矩阵端到端真调用: 返回 matrix / columns 非空 / rows 是数组', async () => {
  const b = bootPre('graph')
  try {
    const route = b.routes.find((r) => String(r.path).indexOf('/kanban-board') >= 0)
    assert(route, 'kanban-board 路由未注册')
    let body = null
    await route.handler({
      url: '/api/dsh-auto-memory/kanban-board', method: 'GET',
      headers: { host: '127.0.0.1:3080' }, socket: { remoteAddress: '127.0.0.1' },
    }, { writeHead() {}, setHeader() {}, statusCode: 0, end(s) { try { body = JSON.parse(s) } catch (_) { body = null } } })
    assert(body, '路由没返回响应体')
    assert(body.reason !== 'error', '看板路由返回 error: ' + JSON.stringify(body.error || body))
    assert(body.matrix, 'graph 档载荷必须含 matrix(整页看板的数据源)')
    assert(Array.isArray(body.matrix.columns) && body.matrix.columns.length > 0, 'matrix.columns 必须非空')
    assert(Array.isArray(body.matrix.rows), 'matrix.rows 必须是数组')
    assert(body.matrix.columns.some((c) => c.key === 'misc'), '必须有 misc 兜底列(否则非泳道卡全丢)')
    assert(body.matrix.stats && typeof body.matrix.stats.totalCards === 'number', 'stats.totalCards 不在场')
  } finally { cleanup(b) }
})

ta('G5 **带真实卡**的投影不变量: 列合计 == 总卡数 + 每卡必落一格(零静默丢失)', async () => {
  // ★ G4 的教训: 空工作区下 totalCards=0, "0===0" 恒真 ⇒ 该断言等于没测。
  //   必须喂**真实的多泳道卡**才能验证「没有卡落不进任何列」这条不变量。
  //   (另: 本断言必须用 ta() + 静态 import —— 在同步 t() 里 await import 会让
  //    assert 抛出逃逸成 unhandledRejection, 表现为「先报 33 passed 再崩」, 那是坏的失败形态。)
  const mk = (id, title, source, tags) => ({
    id: 'mem_' + id.padEnd(32, '0'), title, source, tags: tags || [], body: 'x', bullets: 1,
    criteria: 'unknown', mtime: 1, docTitle: 'doc', anchored: false, kind: 'ledger',
  })
  const cards = [
    mk('a1', '目标', 'handoff/handoff-20260916-120000.md', ['sec:目标']),
    mk('a2', '任务状态', 'handoff/handoff-20260916-120000.md', ['sec:任务状态']),
    mk('a3', '失败与弯路', 'handoff/handoff-20260915-120000.md', ['sec:失败与弯路']),
    mk('a4', '进度与下一步', 'handoff/handoff-20260915-120000.md', ['sec:进度与下一步']),
    mk('a5', '版本归档', 'handoff/handoff-20260914-120000.md', ['sec:版本归档']),
    mk('b1', '这是什么', 'handoff/PLAN.md', ['sec:这是什么']),           // 无日期 + 非泳道 ⇒ 必须落 misc
    mk('b2', '零散笔记', 'handoff/handoff-20260914-130000.md', []),      // 无 tag ⇒ 必须落 misc
  ]
  const mx = buildMatrixForTest(cards, { now: 'T' })
  const sum = mx.columns.reduce((a, c) => a + c.count, 0)
  assert(sum === cards.length, '列合计 ' + sum + ' != 卡数 ' + cards.length + '(有卡落不进任何列 ⇒ 矩阵里看不见)')
  assert(mx.stats.totalCards === cards.length, 'totalCards 必须等于输入卡数')
  // 逐卡核对: 每张卡都能在某个 (行,列) 格子里找到 —— 这是「看得见」的最终口径
  const seen = new Set()
  for (const r of mx.rows) for (const k of Object.keys(r.cells)) for (const c of r.cells[k]) seen.add(c.id)
  assert(seen.size === cards.length, '实际落格 ' + seen.size + ' != 卡数 ' + cards.length + '(有卡丢失)')
  // 无日期文档必须进 __undated__ 行
  assert(mx.rows.some((r) => r.key === '__undated__'), '无日期文档(PLAN/归档)必须有归属行')
  // 行按日期倒序
  const dated = mx.rows.filter((r) => r.key !== '__undated__').map((r) => r.key)
  assert(JSON.stringify(dated) === JSON.stringify([...dated].sort().reverse()), '行必须按日期倒序, 实为 ' + dated.join(','))
  // 确定性
  assert(JSON.stringify(buildMatrixForTest(cards, { now: 'T' })) === JSON.stringify(mx), '同输入两次必须同输出')
})

cleanup(bg)

// ★ 汇总前必须等全部异步断言落定, 否则 F8/G4/G5 的失败会被漏计(汇总行提前打印 = 假绿)
await Promise.all(pending)

console.log('\n[graph-mode] ' + pass + ' passed, ' + fail + ' failed')
if (fail) process.exit(1)

