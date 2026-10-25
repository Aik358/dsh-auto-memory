/**
 * 永久守卫：召回统计（③）—— 埋点 / 落盘 / 路由 / 前端页签与图表
 *
 * ★本轮的设计红线（用户 2026-09-22 拍板「先只记录、不加权」）：
 *   统计**绝不能影响召回排序**。故本守卫的第一组断言全部围绕"只读"：
 *   ① observe() 不改入参（逐字节比对）；② 埋点位置在排序定型之后；
 *   ③ 埋点内部无对命中对象的写操作。
 *
 * ★为什么做真行为断言而不是源码字符串断言：本仓血泪教训 ——
 *   只断言"调用了 X"的守卫钉不住"X 是否真的可达/真的没副作用"（#104 就是被这种守卫放过的）。
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { createRecallStatsPre, RECALL_STATS_VERSION_PRE } from '../../lib/recall-stats.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../..')
let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  ok   - ' + m) } else { fail++; console.log('  FAIL - ' + m) } }
const cnt = (h, n) => { let c = 0, i = 0; for (;;) { const p = h.indexOf(n, i); if (p < 0) return c; c++; i = p + n.length } }
const IX = fs.readFileSync(path.join(ROOT, 'lib/index.js'), 'utf8')
const CL = fs.readFileSync(path.join(ROOT, 'lib/client.js'), 'utf8')

console.log('[S1] 统计模块：只读入参（红线）')
{
  const f = path.join(os.tmpdir(), 'dam-guard-stats-' + process.pid + '.json')
  try { fs.rmSync(f, { force: true }) } catch (_) {}
  const s = createRecallStatsPre({ file: () => f })
  const hits = [
    { id: 'mem_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', layer: 'project', score: 0.91, reason: '语义×0.91' },
    { id: 'mem_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', layer: 'log', score: 3, reason: '词法×3' },
  ]
  const before = JSON.stringify(hits)
  const orderBefore = hits.map((x) => x.id).join(',')
  s.observe(hits, { channel: 'model' })
  ok(JSON.stringify(hits) === before, 'S1a observe() 未修改入参对象（逐字节相同）')
  ok(hits.map((x) => x.id).join(',') === orderBefore, 'S1b observe() 未改动入参数组顺序（排序红线）')
  // 零命中也要记（"检索了但没东西"是最重要的一类信号）
  s.observe([], { channel: 'model' })
  // ★2026-09-22：三条通路**必须分账**（用户拍板「不能混为一谈，各用各自口径」）
  s.observeInjection([{ name: '规则段', chars: 7634 }, { name: 'Tier-0', chars: 1249 }])
  s.observe([{ id: 'mem_cccccccccccccccccccccccccccccccc', layer: 'shadow' }], { channel: 'shadow' })
  const snap = s.snapshot()
  ok(JSON.stringify(snap.channelIds) === JSON.stringify(['model', 'inject', 'shadow']), 'S1c 三通道 id 齐全且顺序稳定')
  ok(snap.channels.model.events === 2, 'S1d model 检索次数计 2（含零命中那次）')
  ok(snap.channels.model.zeroHit === 1, 'S1e model 零命中单独计数（' + snap.channels.model.zeroHit + '）')
  ok(snap.channels.model.distinct === 2 && snap.channels.model.hits === 2, 'S1f model 条目数与命中总数正确')
  ok(snap.channels.inject.hits === 2 && snap.channels.inject.distinct === 2, 'S1g inject 通道按段名记账 2 段')
  {
    // ★核心红线：三条通路**互不串味**——合并口径会把「模型没检索」误读成「不重要」并污染加权
    const mIds = snap.channels.model.top.map((x) => x.id)
    const iIds = snap.channels.inject.top.map((x) => x.id)
    const hIds = snap.channels.shadow.top.map((x) => x.id)
    ok(mIds.length === 2, 'S1h ★model 通道只含自己的 2 条（实得 ' + JSON.stringify(mIds) + '）')
    ok(iIds.length === 2 && iIds.every((x) => x.startsWith('seg:')), 'S1i ★inject 通道按段名记账（' + JSON.stringify(iIds) + '）')
    ok(hIds.length === 1 && hIds[0] === 'mem_cccccccccccccccccccccccccccccccc', 'S1j ★shadow 通道只含自己那条')
    ok(!mIds.some((x) => iIds.includes(x)), 'S1k ★model 与 inject 条目集合无交集（分开计算的核心保证）')
  }
  ok(snap.channels.model.byLayer.length === 2 && snap.channels.model.byDay.length === 1, 'S1l 按层/按天分布已生成（面板图表数据源）')
  ok(snap.channels.model.ids === undefined, 'S1m 不对外暴露内部 ids 字段（只读视图形状）')
  ok(snap.channels.model.top.length === 2, 'S1n top 列表可输出')

  console.log('\n[S2] 真落盘 + 真重载（原子写）')
  ok(s.save() === true, 'S2a save() 写入成功')
  ok(fs.existsSync(f) && fs.statSync(f).size > 0, 'S2b 文件真的落盘（' + (fs.existsSync(f) ? fs.statSync(f).size : 0) + ' B）')
  const raw = JSON.parse(fs.readFileSync(f, 'utf8'))
  ok(raw.version === RECALL_STATS_VERSION_PRE, 'S2c 落盘带版本号（' + raw.version + '）')
  const s2 = createRecallStatsPre({ file: () => f })
  ok(s2.snapshot().channels.model.events === 2, 'S2d 重载后计数保持（真持久化，非内存态）')
  // 坏文件不阻塞：写一段脏 JSON 后重建，必须 fail-soft 且不抛
  fs.writeFileSync(f, '{ this is not json', 'utf8')
  let threw = false
  let s3 = null
  try { s3 = createRecallStatsPre({ file: () => f }); s3.snapshot() } catch (_) { threw = true }
  ok(!threw && s3 && s3.snapshot().channels.model.events === 0, 'S2e 坏文件 fail-soft（不抛、从零开始）')
  // 不存在的路径也不能抛（用户机首次运行）
  let threw2 = false
  try { const s4 = createRecallStatsPre({ file: () => path.join(os.tmpdir(), 'dam-no-such-dir-' + process.pid, 'x.json') }); s4.observe([{ id: 'mem_cccccccccccccccccccccccccccccccc' }]); s4.snapshot() } catch (_) { threw2 = true }
  ok(!threw2, 'S2f 目录不存在也不抛（fail-soft，用户机首次运行安全）')
  // ★旧结构迁移：早期落盘的扁平口径（queries/hits/byLayer…）不得丢数据
  fs.writeFileSync(f, JSON.stringify({
    version: RECALL_STATS_VERSION_PRE, since: 1, queries: 5, zeroHit: 2,
    hits: { mem_old: { count: 3, first: 1, last: 2, layer: 'log', score: 0, reason: '' } },
    byLayer: { log: 3 }, byDay: { '2026-09-01': 3 }, sources: { l0: 3 }, lastQueryAt: 9,
  }))
  const s5 = createRecallStatsPre({ file: () => f })
  const v5 = s5.snapshot()
  ok(v5.channels.model.events === 5 && v5.channels.model.zeroHit === 2, 'S2g ★旧扁平结构迁移到 model 通道且不丢计数（5/2）')
  ok(v5.channels.model.distinct === 1 && v5.channels.model.top[0].count === 3, 'S2h ★旧 hits 条目数与计数保住')
  ok(v5.channels.inject.events === 0 && v5.channels.shadow.events === 0, 'S2i ★迁移后另两通道干净归零（不伪造数据）')
  try { fs.rmSync(f, { force: true }) } catch (_) {}
}

console.log('\n[S3] 宿主埋点：位置正确 + 只读')
ok(cnt(IX, "from './recall-stats.js'") === 1, 'S3a 统计模块已 import')
ok(cnt(IX, 'engine._recallStats = createRecallStatsPre(') === 1, 'S3b engine._recallStats 已创建（哨兵：声明存在）')
ok(cnt(IX, 'this._recallStats.observe(') === 1, 'S3c 埋点调用存在（命中 1）')
{
  const iObs = IX.indexOf('this._recallStats.observe(')
  // ★断言方向修正（2026-09-22 实测）：补丁把埋点插在 `if (l0Top.length) {` **之前**，
  //   所以"埋点之前存在 if"恒为假。正确判据是**区间**：
  //   埋点必须落在「两段排序之后」且「渲染输出之前」。
  //   排序两段：① RRF 融合 `const l0Top = fusion.map(`；② 降级回退 `if (!l0Top) {` 块。
  const iFusion = IX.indexOf('l0Top = fusion.map((f) => byId.get(f.memoryId))')
  const iFallback = IX.indexOf('if (!l0Top) {')
  const iRender = IX.indexOf('if (l0Top.length) {', iObs)
  ok(iFusion > 0 && iFusion < iObs, 'S3d-1 埋点在 RRF 融合排序之后')
  ok(iFallback > 0 && iFallback < iObs, 'S3d-2 埋点在降级排序分支之后')
  ok(iRender > iObs, 'S3d-3 埋点在渲染输出（if (l0Top.length)）之前')
  // ★S3d-1 锚点修正（2026-09-22 实测）：`const l0Top` 并不存在 —— 真实写法是先 `l0Top = null`
  //   再在 try 内 `l0Top = fusion.map(...)`。原锚点取不到 ⇒ indexOf 返回 -1 ⇒ 假红。
  //   按「红先怀疑断言」的纪律，改锚点为**真实赋值语句**。
  const chunk = IX.slice(iObs, iObs + 700)
  ok(!/c\.(fused|finalRank|lex|sem)\s*=(?!=)/.test(chunk), 'S3e 埋点内部无对命中对象的写操作（排序红线）')
  ok(/c\.sem === 'number'/.test(chunk), 'S3f 对照：埋点确实只读 c.sem（证明 S3e 测的是真东西）')
  // fail-soft：埋点必须被 try 包住（统计坏了不能影响召回）
  const around = IX.slice(Math.max(0, iObs - 400), iObs + 700)
  ok(/try\s*\{/.test(around) && /catch\s*\(_\)\s*\{\}/.test(around), 'S3g 埋点被 try/catch 包住（fail-soft，绝不影响召回）')
}
ok(cnt(IX, 'path: API.recallStats,') === 1, 'S3h 只读路由已注册（命中 1）')
ok(cnt(IX, "recallStats: '/api/dsh-auto-memory/recall-stats'") === 1, 'S3i API 路径键存在（A1/A4 路径锁要求）')
ok(/path: API\.recallStats,[\s\S]{0,900}?isLoopbackRequest\(req, panelAllowedHosts\)/.test(IX), 'S3j 路由仍是 loopback-only（安全不变量）')

console.log('\n[S3b] 三条通路埋点齐备（2026-09-22 用户拍板「分开计算」）')
ok(cnt(IX, "this._recallStats.observe(") === 1 && IX.includes("channel: 'model'"), 'S3b1 model 通道埋点（模型主动检索）显式标通道')
ok(cnt(IX, 'this._recallStats.observeInjection(') === 1, 'S3b2 inject 通道埋点存在（每轮注入）')
{
  const iObs = IX.indexOf('this._recallStats.observeInjection(')
  const iEnv = IX.lastIndexOf('const envelope = composeMemoryEnvelopePre({', iObs)
  const iRet = IX.indexOf('return envelope.text', iObs)
  ok(iEnv > 0 && iEnv < iObs, 'S3b3 inject 埋点在 envelope 组装之后（记的是真进 prompt 的段）')
  ok(iRet > iObs, 'S3b4 inject 埋点在 return 之前')
  ok(!/envelope\.(segments|text|chars)\s*=(?!=)/.test(IX.slice(iObs, iObs + 1400)), 'S3b5 inject 埋点只读 envelope（不改注入文本）')
}
ok(cnt(IX, 'recallStats: engine._recallStats') === 1, 'S3b6 shadow 通路：统计实例已注入 createShadowHost')
{
  const iStats = IX.indexOf('engine._recallStats = createRecallStatsPre(')
  const iShadow = IX.indexOf('recallStats: engine._recallStats')
  ok(iStats > 0 && iStats < iShadow, 'S3b7 ★哨兵：_recallStats 先创建、后注入（否则注入 undefined ⇒ shadow 埋点静默失效）')
}
const SH = fs.readFileSync(path.join(ROOT, 'lib/shadow-host.js'), 'utf8')
ok(cnt(SH, "channel: 'shadow'") === 1, 'S3b8 shadow 通道埋点在 shadow-host.js（命中 1）')
ok(/recallStats = null/.test(SH), 'S3b9 shadow 形参可空（不传即整段跳过，行为与从前一致）')
ok(/typeof recallStats\.observe === 'function'/.test(SH), 'S3b10 shadow 埋点有存在性守卫（依赖注入，非模块级单例）')

console.log('\n[S4] 前端：页签 + 三通路分卡 + 图表 + 动效 token')
ok(cnt(CL, "recallStats: ROUTE_PREFIX + '/recall-stats'") === 1, 'S4a 客户端 API 键存在（A1 客户端⊆宿主）')
ok(cnt(CL, "['stats', t('statsTab')]") === 1, 'S4b 页签已注册（命中 1）')
ok(cnt(CL, "if (tab === 'stats') return h(StatsTab)") === 1, 'S4c 渲染分发已接（命中 1）')
ok(cnt(CL, 'function StatsTab() {') === 1, 'S4d 组件定义存在（命中 1）')
{
  const iDef = CL.indexOf('function StatsTab() {')
  const iUse = CL.indexOf("if (tab === 'stats') return h(StatsTab)")
  ok(iDef > 0 && iUse > iDef, 'S4e 哨兵：组件定义先于使用（否则运行期 ReferenceError）')
}
// 四种图表都必须"定义 + 被调用"成对（防定义了没接上）
for (const g of ['DamDonut', 'DamBars', 'DamSpark', 'DamHeat', 'DamStat']) {
  ok(cnt(CL, 'function ' + g + '(props) {') === 1 && CL.indexOf('h(' + g) > 0, 'S4f ' + g + ' 定义与调用成对')
}
ok(cnt(CL, "statsTab: '统计'") === 1 && cnt(CL, "statsTab: 'Stats'") === 1, 'S4g i18n 中英双语齐全')
// ★用户要求：三条通路分开呈现、看得懂、有图表
// ★S4g2 判据演进（#149，2026-09-30）：旧判据锁「data.channels 出现 1 次」——那正是 bug 本身
//   （宿主返回 {enabled, stats: snapshot()}，channels 嵌在 stats 之下，直读 data.channels 恒 {}）。
//   现全文件不再有旧扁平直读；StatsTab 与新皮肤 Iter5Stats 均经解包后的 st.* 读（同一 bug 的两个现场）。
ok(cnt(CL, 'data.channels') === 0, 'S4g2 旧扁平直读 data.channels 已彻底移除（演进自「出现1次」）')
{
  const i5s = CL.slice(CL.indexOf('function Iter5Stats() {'), CL.indexOf('function Iter5Stats() {') + 4000)
  ok(!i5s.includes('data.channels') && i5s.includes('st.channels'), 'S4g2b 新皮肤 Iter5Stats 同步解包 stats（新组件未复制旧有的恒 0 读法）')
} 
{
  // ★S4g3 判据修正（2026-09-22 实测）：全局 `data.stats` 有 2 处命中，但它们在 **DebugCenter 的
  //   「Hub stats」行**（那里的 `data` 是 debug 路由应答体，与统计页无关）⇒ 全局计数是假红。
  //   正确判据是**作用域内**：StatsTab 函数体内不得再读旧扁平口径。
  const iS = CL.indexOf('function StatsTab() {')
  const iNext = CL.indexOf('\nfunction WorkspaceTab() {', iS)
  const tabBody = CL.slice(iS, iNext > iS ? iNext : iS + 9000)
  // ★S4g3 判据演进（#149，2026-09-30）：旧判据「StatsTab 内 data.stats 计数=0」把 bug 焊死了——
  //   它把 DebugCenter 作用域混淆的教训错误推广成「StatsTab 不得读 data.stats」，而宿主返回的
  //   恰是 { enabled, stats: snapshot() } ⇒ 只许读 data.* ⇒ 三通路恒 0 + 空态文案（3.2.3 起即错）。
  //   新判据：**先解包**（var st = ... ? data.stats : data），字段一律读 st.*；旧直读必须为 0。
  ok(cnt(tabBody, "var st = (data && data.stats && typeof data.stats === 'object') ? data.stats : data") === 1,
    'S4g3 ★StatsTab 先解包 data.stats（宿主形状 {enabled, stats: snapshot()}；兼容旧扁平形状）')
  ok(cnt(tabBody, 'st.channels') === 1 && cnt(tabBody, 'st.channelIds') === 1 && cnt(tabBody, 'st.since') >= 1,
    'S4g3b StatsTab 字段改读 st.*（channels/channelIds/since 都嵌在 stats 一层之下）')
  ok(cnt(tabBody, 'data.channels') === 0 && cnt(tabBody, 'data.channelIds') === 0 && cnt(tabBody, 'var since = data.since') === 0,
    'S4g3c 旧扁平直读已彻底消失（防回退到恒 0 的读法）')
}
ok(/chCard\(model, 'model'/.test(CL) && /chCard\(inject, 'inject'/.test(CL) && /chCard\(shadow, 'shadow'/.test(CL), 'S4g4 三条通路各有独立卡片（model / inject / shadow）')
// ★S4g5 判据修正（2026-09-22 实测）：hint 键每个共 3 处 = zh 定义 + en 定义 + META 里的 t(...) 引用。
//   正确判据：**定义形式**（带冒号引号）各 2 份（中英），且**使用**至少 1 次。
for (const k of ['statsChModelHint', 'statsChInjectHint', 'statsChShadowHint']) {
  ok(cnt(CL, k + ": '") === 2 && cnt(CL, "t('" + k + "')") >= 1, 'S4g5 ' + k + ' 中英定义齐 + 被使用')
}
ok(cnt(CL, 'statsChannels:') === 2, 'S4g6 总览标题中英双语齐全（命中 2）')
ok(cnt(CL, 'h(DamDonut') >= 2 && cnt(CL, 'h(DamBars') >= 2 && cnt(CL, 'h(DamSpark') >= 1 && cnt(CL, 'h(DamHeat') >= 1, 'S4g7 四类图表都在用（环形/条形/折线/热力）')
ok(/it\.score \|\| 0/.test(CL), 'S4g8 ★注入侧按字符数度量（回答「谁最占预算」），不是次数')
// 动效必须走项目既有 token（skill 教义：对齐既有刻度，不引入第二套）
ok(cnt(CL, '@keyframes dam-stat-') === 6, 'S4h 新增 6 个统计专用 keyframes（命中 6）')
{
  // ═══════════════════════════════════════════════════════════════════════════
  // ★S4i/S4j 判据改造（2026-10-25，C 线 E 批收口）
  //
  // 【为什么改】旧判据用**位置切片**取 region：
  //     const iStats = CL.indexOf('function StatsTab() {')      // ≈ 836,939
  //     const iCss   = CL.indexOf('@keyframes dam-stat-num')    // ≈ 348,442
  //     const region = CL.slice(min, max + 8000)                // ≈ 496,188 字符
  //   2026-10-25 E1 把**原型 EV4_CSS（≈45KB）插在两者之间**，位置切片把整段
  //   EV4_CSS 吞了进来 ⇒ S4j 抓到的 `animation:ev4-lm-spin 800ms`（L5143，属原型照搬）
  //   被误判成「StatsTab 硬编码裸毫秒」。
  //   位置切片的**根本问题**：任何人往这两点之间插东西，region 就会悄悄扩大，
  //   判据范围随代码布局漂移 —— 这不是「严格」，是**不可控**。
  //
  // 【改成什么】改为**内容锚定**（三段精确拼接，不再靠位置跨度）：
  //     ① stats 的 6 个 @keyframes（花括号配平，265 字符级别）
  //     ② stats 动效的**真实调用点**（animation: 'dam-stat-*' 那几处，≈14.5KB）
  //     ③ StatsTab 函数体（花括号配平，≈7.2KB）
  //   ★同时加长度上限断言：region < 60,000 字符。一旦又吞进别的东西（比如有人再插
  //     一段大 CSS），这条会立刻红 —— 位置切片时代缺的正是这道闸。
  // ═══════════════════════════════════════════════════════════════════════════
  /** 从 startAt 之后第一个 `{` 起做花括号配平，返回匹配 `}` 之后的位置。 */
  function matchBrace (src, startAt) {
    const i = src.indexOf('{', startAt)
    if (i < 0) return -1
    let depth = 1
    for (let j = i + 1; j < src.length; j += 1) {
      const c = src[j]
      if (c === '{') depth += 1
      else if (c === '}') { depth -= 1; if (depth === 0) return j + 1 }
    }
    return -1
  }

  // ① stats 的 6 个 keyframes（已是 S4h 的判据对象，这里复用其边界）
  const kfIdx = [...CL.matchAll(/@keyframes dam-stat-[\w-]+/g)].map((m) => m.index)
  ok(kfIdx.length === 6, 'S4i-pre ★stats keyframes 恰 6 个（实测 ' + kfIdx.length + '）')
  const statsCss = CL.slice(kfIdx[0], matchBrace(CL, kfIdx[kfIdx.length - 1]))
  ok(statsCss.length > 200 && statsCss.length < 5000, 'S4i-pre ★stats keyframes 段长度合理（实测 ' + statsCss.length + ' 字符）')

  // ② stats 动效的真实调用点：所有 `animation: 'dam-stat-*` 用法
  const animUses = [...CL.matchAll(/animation:\s*'?dam-stat-[\w-]+/g)].map((m) => m.index)
  ok(animUses.length >= 5, 'S4i-pre ★stats 动效调用点 >= 5 处（实测 ' + animUses.length + '）')

  // ③ StatsTab 函数体（花括号配平，不用固定 +8000 这类魔数）
  const iStats = CL.indexOf('function StatsTab() {')
  ok(iStats > 0, 'S4i-pre ★StatsTab 可定位')
  const iStatsEnd = matchBrace(CL, iStats)
  ok(iStatsEnd > iStats, 'S4i-pre ★StatsTab 函数体可配平（' + (iStatsEnd - iStats) + ' 字符）')

  // ★内容锚定拼接：从「第一个 stats 动效调用点」到 StatsTab 结束，中间不跨越大段无关 CSS
  const firstUse = Math.min.apply(null, animUses)
  const useRegion = CL.slice(firstUse - 2000, iStatsEnd)
  const region = statsCss + '\n' + useRegion

  // ★★长度闸（这是位置切片时代缺的那道防线）
  ok(region.length < 60000, 'S4i-pre ★region 长度 < 60,000 字符（实测 ' + region.length + '）—— 超了说明又吞了别的东西')
  ok(!region.includes('--ev4-root-fs') && !region.includes('.dam-ev4'), 'S4i-pre ★region 不含 EV4_CSS（位置切片时代它吞了整段 ≈45KB 原型 CSS）')
  ok(!region.includes('ITER5_CSS') && !region.includes('function MemoryPanel'), 'S4i-pre ★region 不含无关大块（ITER5_CSS / MemoryPanel）')

  ok(/var\(--dam-dur-slow\)/.test(region) && /var\(--dam-ease-out\)/.test(region), 'S4i 动效走既有 token（--dam-dur-slow / --dam-ease-out）')
  ok(!/animation:[^;]*\b[0-9]{3,4}ms\b/.test(region), 'S4j 动效未硬编码裸毫秒（统一走 token）')
  // ★负路径加强：region 内只允许 dam-stat-* 相关的 animation（防把别处动画算进来）
  const animDecls = (region.match(/animation:[^;\n]*/g) || [])
  const nonStatsAnim = animDecls.filter((d) => !/dam-stat-/.test(d) && /[0-9]{3,4}ms/.test(d))
  ok(nonStatsAnim.length === 0, 'S4j2 ★[负] region 内非 stats 的裸毫秒 animation = 0（实测 ' + nonStatsAnim.length + '）')
}

{
  // ★S4j-token（2026-10-25 新增）：.lm-spin 的 800ms 已提为 EV4 token，视觉必须逐像素不变。
  //   判据分两层：①token 定义存在且值为 800ms；②规则引用 token 而**不再**写字面量。
  const tokenDef = CL.match(/--ev4-dur-spin\s*:\s*([^;"]+)/)
  ok(!!tokenDef, 'S4j-token-a ★--ev4-dur-spin token 已定义')
  ok(tokenDef && tokenDef[1].trim() === '800ms', 'S4j-token-b ★token 值 = 800ms（实测 ' + (tokenDef ? tokenDef[1].trim() : 'N/A') + '）—— 视觉不变')
  const spinRule = (CL.match(/\.dam-ev4 \.lm-spin\{[^}]*\}/) || [''])[0]
  ok(/\.dam-ev4 \.lm-spin\{/.test(spinRule), 'S4j-token-c ★.dam-ev4 .lm-spin 规则存在')
  ok(/animation:ev4-lm-spin var\(--ev4-dur-spin\)/.test(spinRule), 'S4j-token-d ★规则引用 token（animation:ev4-lm-spin var(--ev4-dur-spin)）')
  ok(!/animation:ev4-lm-spin 800ms/.test(spinRule), 'S4j-token-e ★[负] 规则内**不再**写 800ms 字面量')
  // ★EV4 token 不是配置键：不得出现在 DEFAULT_PROMPT_LAYERS 契约表里（配置键 163 守恒的另一面）
  ok(!/--ev4-dur-spin/.test(CL.slice(CL.indexOf('DEFAULT_PROMPT_LAYERS'), CL.indexOf('DEFAULT_PROMPT_LAYERS') + 20000)), 'S4j-token-f ★[负] token 未混进配置键契约表（不影响 163 守恒）')

  // ═══ 变异（必须必红，证明判据非恒真）═══
  // 变异 A：把 token 值改成 100ms ⇒ S4j-token-b 必红（且视觉会变，说明这条断言真的守着「视觉不变」）
  const mutToken = CL.replace(/--ev4-dur-spin\s*:\s*800ms/, '--ev4-dur-spin:100ms')
  ok(mutToken !== CL, 'S4j-mut-a0 [变异A] 成功把 --ev4-dur-spin 改成 100ms')
  const mutDef = mutToken.match(/--ev4-dur-spin\s*:\s*([^;"]+)/)
  ok(mutDef && mutDef[1].trim() !== '800ms', 'S4j-mut-a1 ★★[变异A] 改 100ms ⇒ S4j-token-b 必红（实测 ' + (mutDef ? mutDef[1].trim() : 'N/A') + '）')

  // 变异 B：把 region 退回旧的「位置切片 + 8000」写法 ⇒ 长度闸必红
  const oldRegionLen = (function () {
    const mStats = CL.indexOf('function StatsTab() {')
    const mCss = CL.indexOf('@keyframes dam-stat-num')
    return CL.slice(Math.min(mStats, mCss), Math.max(mStats, mCss) + 8000).length
  })()
  ok(oldRegionLen > 60000, 'S4j-mut-b0 ★★★[变异B] 旧位置切片写法 region = ' + oldRegionLen + ' 字符 > 60,000 ⇒ 长度闸必红（实测新写法 15,131）')
  ok(oldRegionLen > 400000, 'S4j-mut-b1 ★[变异B] 旧写法实际吞了约 ' + Math.round(oldRegionLen / 1000) + 'KB（含整段 EV4_CSS）')
}
// 只读姿势：统计页不得出现写配置/写召回的调用
{
  const iStats = CL.indexOf('function StatsTab() {')
  const body = CL.slice(iStats, iStats + 8000)
  ok(!/saveConfigPatch|setCfg|memory_note|POST[^']*recall'/.test(body), 'S4k 统计页无写配置/写召回调用（唯一写操作是统计清零）')
  ok(/reset=1/.test(body), 'S4l 清零按钮走 ?reset=1（与宿主路由约定一致）')
}

console.log('[recall-stats] S10 #149 服务端形状与客户端解包对拍（2026-09-30）')
{
  ok(IX.includes('{ enabled: true, stats: engine._recallStats.snapshot() }'),
    'S10 宿主形状不变：{ enabled, stats: snapshot() }（客户端适配宿主，而非改宿主迁就旧客户端）')
  ok(CL.includes("typeof data.stats === 'object'"),
    'S10 客户端解包带 typeof 守卫（stats 缺失时按旧扁平形状兜底）')
}

console.log('\n[recall-stats] ' + pass + ' passed, ' + fail + ' failed')
if (fail) process.exit(1)
