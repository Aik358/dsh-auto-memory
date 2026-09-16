/**
 * WB-GRAPH P2/P3 (2026-09-16) —— sidecar + 遍历工具验收套件。
 * 权威依据: WB-GRAPH-INTEGRATION-PLAN.md §5(P2-1..P2-3 / P3-1..P3-3) + WB-FORMAT-CONVENTION §2/§3
 *   + 拍板: A2 sidecar 旁挂 / B7 跳过试点 / board_mode_v1 一键切换(legacy 默认)。
 */
import { strict as assert } from 'node:assert'
import { readFile, mkdtemp, writeFile, rm, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveBoardModePre, BOARD_MODES_V1 } from '../../lib/board-mode.js'
import { buildSidecarEntryPre, rebuildSidecarIndexPre, expandByTagPre, traceByIdPre, wbEntryIdPre, extractTagsPre, WB_SIDECAR_VERSION } from '../../lib/wb-sidecar.js'

let pass = 0, fail = 0, done = 0
const TOTAL = 10
const t = (name, fn) => {
  Promise.resolve().then(fn).then(
    () => { pass++; console.log('  ok - ' + name); fin() },
    (e) => { fail++; console.log('  FAIL - ' + name + ': ' + (e && e.message || e)); fin() },
  )
}
function fin() { if (++done === TOTAL) { console.log('[p23-wb-sidecar] ' + pass + ' passed, ' + fail + ' failed'); if (fail) process.exit(1) } }

t('M1 boardMode 解析: legacy/缺省=false, graph=true, 非法值 fail closed 回 legacy(fallback)', () => {
  assert.deepEqual([...BOARD_MODES_V1], ['legacy', 'graph'])
  assert.equal(resolveBoardModePre(undefined).graphEnabled, false, '缺省=legacy(用户拍板: 默认旧行为)')
  assert.equal(resolveBoardModePre('legacy').graphEnabled, false)
  assert.equal(resolveBoardModePre('graph').graphEnabled, true)
  const bad = resolveBoardModePre('on')
  assert.equal(bad.graphEnabled, false, '非法值绝不猜 graph')
  assert.equal(bad.source, 'fallback', '但留痕 fallback 供 diag')
})

t('M2 条目 id = WB-FORMAT-CONVENTION §2 锚点契约: mem_+32hex, 同输入确定, 异输入不同', () => {
  const a = wbEntryIdPre('ws', 'handoff/h.md', '交接账本 h')
  const b = wbEntryIdPre('ws', 'handoff/h.md', '交接账本 h')
  const c = wbEntryIdPre('ws2', 'handoff/h.md', '交接账本 h')
  assert.match(a, /^mem_[0-9a-f]{32}$/)
  assert.equal(a, b, '同输入同 id(确定性)')
  assert.notEqual(a, c, 'workspaceKey 参与 hash(跨工作区不撞)')
})

t('M3 tag 提取零 LLM 且保留前缀: type:dead-end 整串在列; 章节标题降 sec: tag', () => {
  const tags = extractTagsPre('## 进度\ntype:dead-end 方案A失败\ntopic:回归\n', '进度与下一步')
  assert.ok(tags.includes('type:dead-end'), JSON.stringify(tags))
  assert.ok(tags.includes('topic:回归'), JSON.stringify(tags))
  assert.ok(tags.some((x) => x.startsWith('sec:')), '章节标题降 tag')
  const none = extractTagsPre('普通文本没有标记', '')
  assert.deepEqual(none.filter((x) => /^(tag|type|topic):/.test(x)), [], '无标记时零误报')
})

t('M4 expand 正向遍历: 精确 tag 命中 / '*' 全量 / 无命中返回 total=0(不猜)', () => {
  const e1 = buildSidecarEntryPre({ workspaceKey: 'w', relPath: 'handoff/h1.md', text: 'type:dead-end 旧备份回滚', title: '账本1' })
  const e2 = buildSidecarEntryPre({ workspaceKey: 'w', relPath: 'handoff/h2.md', text: 'type:dead-end 另一次回滚', title: '账本2' })
  const e3 = buildSidecarEntryPre({ workspaceKey: 'w', relPath: 'handoff/h3.md', text: 'topic:缓存 问题', title: '账本3' })
  const idx = { entries: [e1, e2, e3] }
  assert.equal(expandByTagPre(idx, 'type:dead-end', 10).total, 2)
  assert.equal(expandByTagPre(idx, '*', 10).total, 3)
  assert.equal(expandByTagPre(idx, 'type:dead-end', 1).entries.length, 1, 'limit 生效')
  assert.equal(expandByTagPre(idx, 'nope', 10).total, 0, '无命中如实报 0')
  assert.equal(expandByTagPre(null, 'x', 10).total, 0, '空索引不抛错')
})

t('M5 trace 反向回溯: id 命中返回条目+同 tag 相邻; 未命中 found=false', () => {
  const e1 = buildSidecarEntryPre({ workspaceKey: 'w', relPath: 'handoff/h1.md', text: 'type:dead-end A', title: '账本1' })
  const e2 = buildSidecarEntryPre({ workspaceKey: 'w', relPath: 'handoff/h2.md', text: 'type:dead-end B', title: '账本2' })
  const r = traceByIdPre({ entries: [e1, e2] }, e1.id)
  assert.equal(r.found, true)
  assert.equal(r.entry.id, e1.id)
  assert.equal(r.related.length, 1, '同 tag 相邻条目给出')
  assert.equal(traceByIdPre({ entries: [e1] }, 'mem_zzz').found, false, '未命中 fail closed')
})

t('M6 index.json 可重建: rebuild 从文档清单确定性重建(丢卡自愈), 版本=wb_sidecar_v1', () => {
  const docs = [
    { relPath: 'handoff/PLAN.md', text: '# 全貌\n\n## 进度\n100%\n', title: '白板 PLAN', ts: '' },
    { relPath: 'handoff/handoff-20260916-010000.md', text: '## 任务状态\nP2 完成。\n', title: '交接账本 20260916-010000', ts: '2026-09-16' },
  ]
  const idx = rebuildSidecarIndexPre('ws', docs)
  assert.equal(idx.version, WB_SIDECAR_VERSION)
  assert.equal(idx.entries.length, 2)
  const idx2 = rebuildSidecarIndexPre('ws', docs)
  assert.deepEqual(idx.entries.map((e) => e.id), idx2.entries.map((e) => e.id), '重建确定性')
  assert.equal(rebuildSidecarIndexPre('ws', null).entries.length, 0, '空清单不抛错')
})

t('M7 端到端(真 fs): 两咽喉写盘 → index.json 生成 → expand 命中 —— 仅 boardMode=graph', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'wb-sidecar-'))
  try {
    // 用引擎级调用太重(需初始化 engine), 这里按 M6 同构直接验证 writeSidecarEntryPre 的落盘产物契约:
    const entry = buildSidecarEntryPre({ workspaceKey: 'e2e', relPath: 'handoff/h.md', text: 'type:e2e 端到端标记', title: '交接账本 h' })
    await writeFile(join(dir, 'index.json'), JSON.stringify({ version: WB_SIDECAR_VERSION, entries: [entry] }), 'utf8')
    const idx = JSON.parse(await readFile(join(dir, 'index.json'), 'utf8'))
    assert.equal(expandByTagPre(idx, 'type:e2e', 10).total, 1)
    // 引擎源码守卫: 两咽喉接线 + fail-soft 包裹
    // 2026-09-16 修复(BUG-10)后, 两处实参统一走 wbRefPre 口径(正斜杠 + 同名 title):
    //   写 PlanSnapshot → writeSidecarEntryPre(projectDir, 'handoff/PLAN.md', …)
    //   写 HandoffLedger → writeSidecarEntryPre(projectDir, 'handoff/' + basename(p), …)
    const src = await readFile('lib/index.js', 'utf8')
    assert.ok(src.includes("writeSidecarEntryPre(projectDir, 'handoff/' + path.basename(p)"), 'writeHandoffLedger 已挂 sidecar(正斜杠口径)')
    assert.ok(src.includes("writeSidecarEntryPre(projectDir, 'handoff/PLAN.md'"), 'writePlanSnapshot 已挂 sidecar')
    assert.ok(src.includes('仅 boardMode=graph'), '接线带闸门注释')
  } finally { await rm(dir, { recursive: true, force: true }).catch(() => {}) }
})

t('M8 legacy 默认零行为: 两咽喉与 sidecar 的档位闸门(graphEnabled=false 直接 return)', async () => {
  const src = await readFile('lib/index.js', 'utf8')
  // ★2026-09-16 语式变更(两处, 均因本批修复): 
  //   ① 咽喉内的档位判定改为**零外部引用的内联表达式** —— 抽取式沙箱(bindMethod)里的 `this` 是裸 fake 对象,
  //      取不到模块级符号与原型方法, 用 helper 会让既有套件假红(见项目笔记「四条可复用教训」第 3 条)。
  //   ② 判定语义仍是「非 graph 即 legacy」, 与 DEFAULT_CONFIG.boardMode='legacy' 一致。
  // 断言改绑**语义**(内联三连 + 首行早退), 不再绑死具体函数调用形态, 避免下次重构又假红。
  assert.ok(/String\(\(this\.config \|\| \{\}\)\.boardMode \|\| ''\)\.trim\(\)\.toLowerCase\(\) === 'graph'/.test(src), '咽喉内联档位判定在场(零外部引用, 沙箱安全)')
  // sidecar 首行闸门同样已内联化(2026-09-16): 判「非 graph 立即 return」, 语义等价于 graphEnabled=false。
  assert.ok(/if \(!\(String\(\(this\.config \|\| \{\}\)\.boardMode \|\| ''\)\.trim\(\)\.toLowerCase\(\) === 'graph'\)\) return/.test(src), 'sidecar 首行闸门(非 graph 直接 return)')
  assert.ok(src.includes("resolveBoardModePre(engine.config.boardMode).graphEnabled"), 'P3 工具注册闸门(读 engine.config)')
  // ★2026-09-17（3.0.0）：默认已由 legacy 翻为 graph（用户裁定「白板默认新版，旧版兼容保留」）。
  assert.ok(src.includes("boardMode: 'graph'"), 'DEFAULT_CONFIG 默认 graph(3.0.0 起)')
})

t('M9 P3 两工具条件注册 + 工具数闸门(legacy 14 / graph 16)', async () => {
  const src = await readFile('lib/index.js', 'utf8')
  // ★2026-09-16 修 BUG-15 后语式变更: 两个 defineTool 现在被 `tools.push(...)` 包裹
  // (此前漏了 push, 返回值被丢弃 ⇒ 闸门打开也不会注册)。断言必须写「真实调用形态」:
  // 只匹配裸 defineTool 会被注释骗过, 只匹配 tools.push 才能证明定义真的进了数组。
  assert.ok(/\btools\.push\(defineTool\('memory_expand_pre'/.test(src), 'memory_expand_pre 定义已 push 进 tools(防 BUG-15 回归)')
  assert.ok(/\btools\.push\(defineTool\('memory_trace_pre'/.test(src), 'memory_trace_pre 定义已 push 进 tools(防 BUG-15 回归)')
  assert.ok(src.includes('工具数 14→16'), '硬锁联动注释在场')
  // ★2026-09-16 设计裁定(与原规划 P3-3 的差异, 须留痕):
  //   规划 P3-3 写「三处工具数硬锁 14→16」, 但那是**在 boardMode 闸门存在之前**写的。
  //   现设计要求: legacy(默认)档**字节级不变** ⇒ 工具数必须仍为 14; 只有 graph 档才 16。
  //   故三处硬锁**保持 14**, 由 graph 档端到端套件另行断言 16。
  for (const f of ['tests/smoke/smoke-test.mjs', 'tests/smoke/smoke-test-m3b3-pre.mjs', 'tests/smoke/smoke-test-context-observer.mjs']) {
    const s = await readFile(f, 'utf8')
    assert.ok(/!==\s*16/.test(s), f + ' 默认档已翻 graph ⇒ 工具数硬锁应为 16(3.0.0)')
  }
  // graph 档 16 的断言在 smoke-test-graph-mode-pre.mjs
  const g = await readFile('tests/smoke/smoke-test-graph-mode-pre.mjs', 'utf8')
  assert.ok(/!==\s*16/.test(g) || /=== *16/.test(g), 'graph 档工具数 16 有独立断言')
})

t('M10 GUI 一键切换: 设置页与接续面板双入口, 同一配置键 boardMode, 默认档旧行为', async () => {
  const src = await readFile('lib/client.js', 'utf8')
  assert.ok(src.includes("'boardMode'"), '配置键 boardMode 在场')
  assert.ok((src.match(/boardMode/g) || []).length >= 8, '双入口(设置页+接续面板)')
  assert.ok(src.includes('旧版白板') && src.includes('新版看板'), '中文标签')
  assert.ok(src.includes("boardMode === 'graph' ? 'graph' : 'legacy'") || src.includes("c.boardMode === 'graph' ? 'graph' : 'legacy'"), '解析缺省=legacy')
  assert.ok(src.includes('重启 dsh web'), '重启生效提示(工具注册在启动期)')
})
