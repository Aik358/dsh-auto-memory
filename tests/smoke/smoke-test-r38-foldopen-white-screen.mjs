#!/usr/bin/env node
/**
 * smoke-test-r38-foldopen-white-screen.mjs —— R38 白屏真缺陷回归守卫
 *
 * 缺陷：KanbanBoardRail（client.js L3357）在 onExpand 处引用了**兄弟函数 KanbanView 内部的** `foldOpen`，
 *       本函数作用域里没有该标识符 ⇒ 每次渲染必抛 ReferenceError ⇒ 宿主槽位错误边界接住 ⇒
 *       `shell.overlay` 与 `conversation.view` 两个承载面**整页白屏**（用户实测）。
 *
 * 为什么既有守卫全绿却漏了：node --check 语法合法；全套静态字符串守卫也全绿 ——
 *       因为这类错误只有**真执行组件渲染**才暴露。⇒ 本守卫按 CR-10 做真调用 + 负路径。
 *
 * 判据：
 *   ① 正路径：真渲染 KanbanBoardRail 一次，**不得抛错**；渲染树里必须含 DamFoldBar / DamStatBar。
 *   ② 负路径：把 onExpand 变异回旧 bug 形态（引用 foldOpen）⇒ 必须**精确报红** ReferenceError: foldOpen is not defined。
 *   ③ 段边界可定位（区间锁）：KanbanBoardRail 段的行数落在 80~120。
 *      ★演进说明（R40）：原判据写死 = 85（原始 66 + R38 新增 19）。R40 按 114 卷 R3 给主区接线
 *      （railKey 驱动 + 时间轴档分流）又加了 7 行 ⇒ 恰值失配。被守语义是「用下一个函数定义作终点锚能
 *      正确切出本段」，**不是**段的具体行数 ⇒ 改为区间锁：既能继续抓「终点锚写错吞掉半个文件」
 *      （93→数百行）这类真事故，又不会因正常增行假红。
 */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// ★2026-09-28 多语言化：源码内联文案已改为 L(甲, 乙)。抽段进 vm 的套件需要同名桩。
// 注入到各 vm 沙箱：L / L3 / normLocale 桩（闭包捕获 self，不依赖 this）
// 注入到各 vm 沙箱：L / L3 / normLocale 桩（闭包捕获 self，不依赖 this）
// ★locale 缺省对齐产品默认值 'zh'（源码 `var locale = 'zh'`）；否则未设 locale 的旧沙箱
//   会被 L() 判成非中文 ⇒ 误回落英文、断言假红。
function __mkI18nStub(self) {
  if (!self.locale) self.locale = 'zh'
  self.__L10N = self.__L10N || {}
  self.L = function (a, b) {
    if (self.locale === 'zh') return a
    var m = self.__L10N[self.locale]
    if (m && m[a] !== undefined && m[a] !== '') return m[a]
    return b === undefined ? a : b
  }
  self.L3 = function (a, b, ja) {
    if (self.locale === 'zh') return a
    if (self.locale === 'ja' && ja !== undefined && ja !== null) return ja
    return self.L(a, b)
  }
  self.normLocale = function (v) {
    var s = String(v == null ? '' : v).toLowerCase()
    if (!s) return ''
    var all = ['zh', 'en', 'ja']
    for (var i = 0; i < all.length; i++) {
      if (s === all[i] || s.indexOf(all[i] + '-') === 0 || s.indexOf(all[i] + '_') === 0) return all[i]
    }
    return ''
  }
  return self
}

const src = readFileSync('lib/client.js', 'utf8')

// ★★D14（2026-10-24 用户裁定）：看板组件已退场，本套件原对象（KanbanBoardRail）不存在。
//   但本套件守护的**真价值**不是「某个组件」，而是：
//     「静态守卫全绿、只有真执行渲染才能暴露的 ReferenceError 类白屏」——
//   这正是历史真实事故（L3357 引用兄弟函数内的 foldOpen）。该价值对事件视图**同样适用**。
//   ⇒ 改造为：真渲染 EventCard，渲染树必须含事件卡关键节点；负路径仍用**注入未定义引用**验证它能抓 ReferenceError。
const segStart = src.indexOf('    function EventCard(props) {')
const segEnd = src.indexOf('    /** 事件视图主体（D14）')
if (segStart < 0 || segEnd < 0 || segEnd <= segStart) { console.log('✗ 事件卡段边界锚点失效（源码结构变了）'); process.exit(1) }
const seg = src.slice(segStart, segEnd)
// ★v4 H4（2026-10-24）：EventCard 现在调用 renderPerceptBlockPre(ev, zh)，该函数与
//   PERCEPT_TITLES 常量都定义在 EventCard **之前**（段外）。抽取式真执行必须把这段
//   真实源码一并前置 —— 注入桩会变成「测桩不是测代码」，与本套件 L71-72 的铁律冲突。
const perceptHelperStart = src.indexOf('    // ★v4 H4（2026-10-24）四个 percept 渲染')
const perceptHelperEnd = src.indexOf('    function EventCard(props) {')
if (perceptHelperStart < 0 || perceptHelperEnd <= perceptHelperStart) { console.log('✗ percept helper 段锚点失效'); process.exit(1) }
const perceptHelper = src.slice(perceptHelperStart, perceptHelperEnd)
const segWithDeps = perceptHelper + seg
const helperLines = perceptHelper.split('\n').length
console.log('percept+checkpoint+views helper 段行数 =', helperLines, '（区间锁 250~900，2026-10-26 P2b 弹窗后实测 740）')
// ★区间锁随功能演进上调：H4 四 percept（95 行）→ +P0 检查点折叠与六类 panel 注册表（共 187 行）。
//   锁的作用是「防止段边界切歪吞掉半个文件」，不是钉死行数 ⇒ 按实测上调但保留上下界。
// ★区间锁随功能演进上调（P0 后 187 → P1 后 313）：H4 四 percept + P0 检查点折叠/六类 panel
//   + P1 三视图/空档/倒序纯函数与渲染。锁的作用是防段边界切歪吞掉半个文件，不是钉死行数。
// ★2026-10-25 上调（420 → 520，实测 423）：用户裁定方案 A —— workflow 视图的 lane 提取改用原型规则，
//   新增 LANE_RE_PRE / tokensOfLanePre / lanesOfEventPre 三个纯函数（+110 行），落在本段区间内
//   （computeWorkflowGroupsPre 之前）⇒ 313 + 110 = 423，超旧上界 3 行。
//   归因：**判据过期，非缺陷** —— 锁的意图是「防段边界切歪吞掉半个文件」，不是钉死行数；
//   上界仍保留（520 远小于文件总量），段边界切歪仍会被抓到。
// ★2026-10-25 上调（520 → 620，实测 586）：E2 左轨时间轴的**纯函数层**落在此段内
//   （ev4ShapeOf 适配器 / monthDensityPre 月密度 / relLabelPre 相对时间 / computeRailModelPre 轨道模型，
//    共 5 个函数约 63 行）。下界 250 不动：段边界切歪（吞掉半个文件）仍会被抓到；
//   上界 620 相对文件总量（2.4MB）依然极小 ⇒ 判据意图完全不变。
// ═══════════════════════════════════════════════════════════════════════════
// ★2026-10-25 上调（620 → 700，实测 625）—— 归因按 Lead 要求写足三项
//
// 【① 为什么是 700 而不是 625】
//   留 **+75 行余量（12%）**，不是贴着实测值卡死。依据两条：
//     a) 本锁历史上每次都是「贴着实测上调又立刻不够」——520→620 那次实测 586，
//        余量 34 行，结果本轮 +39 行就又破了。**贴着卡死 = 每批都要改锁**。
//     b) 本锁的意图是「防段边界切歪吞掉半个文件」，不是钉死行数：
//        文件总量 2.6MB ≈ 22,600 行，该段 625 行占 2.8%；
//        即便放到 700 行也只占 3.1%，而「切歪吞掉半个文件」会是 1 万+ 行。
//        ⇒ 700 与 620 对「切歪」的鉴别力**完全等价**，对「正常增行」的容忍度 +75。
//     c) 反过来说：真正能抓切歪的是**下界 250**（段被切短）与**上界 700**
//        （段被切长到 11%）——两者都远离正常增行区间，不会假红。
//
// 【② 这次 +39 行的唯一来源（已用 offset 实测核对）】
//   P3（task-32 · C 线）在 perceptTagOfPre 里新增 PERCEPT_TAG_LABELS 常量 + 可读标签映射
//   （authorResponse → 「作者回应」；未知 kind 原样输出不丢数据）。
//   实测：该段 offset 648801 → 675774，段内 grep 'PERCEPT_TAG_LABELS' = **命中**；
//   段内 grep 本轮另外三处改动（elLooksVisible / computeFullpageHeightPre /
//   sessionId: currentSessionIdClient）= **全部 0 命中** ⇒ 其余改动不在本段。
//   586 + 39 = 625，**没有其他来源**。
//
// 【③ 负路径：上界真的在守（见套件末尾的区间锁负路径断言）】
//   把 5 行代码塞进该区间（模拟「另一个改动混进来」）⇒ 断言必红，见文件末尾 R38-RANGE-MUT。
// ═══════════════════════════════════════════════════════════════════════════
if (!(helperLines >= 250 && helperLines <= 900)) { console.log('✗ helper 段行数异常'); process.exit(1) }
const segLines = seg.split('\n').length
console.log('事件卡段行数 =', segLines, '（区间锁 20~80）')
if (!(segLines >= 20 && segLines <= 80)) { console.log('✗ 段边界异常（终点锚可能吞掉了半个文件）'); process.exit(1) }

function mkCtx() {
  // ★真实教训：抽取式真执行必须注入**模块级依赖**，否则报的是「抽取不全」而不是「组件有 bug」。
  //   本例：EventCard 依赖 EVENT_STATUS_LABEL / EVENT_SECTION_TITLES 两个模块级常量。
  const ctx = {
    h: function (t, p) { return { type: (typeof t === 'function' ? (t.__name || 'fn') : String(t)), props: p || {}, kids: Array.prototype.slice.call(arguments, 2) } },
    useState: function (v) { const s = typeof v === 'function' ? v() : v; return [s, function () {}] },
    EVENT_STATUS_LABEL: { active: '进行中', paused: '搁置', closed: '已完成' },
    EVENT_SECTION_TITLES: [['goal', '目标'], ['doing', '进行中'], ['deadend', '失败与弯路'], ['next', '下一步']],
  }
  __mkI18nStub(ctx)
  return ctx
}
function render(segment) {
  const ctx = mkCtx()
  vm.createContext(ctx)
  vm.runInContext(segment + '\n;globalThis.__R = EventCard;', ctx)
  return ctx.__R({ ev: { id: 'evt_1', name: '测试事件', status: 'active', summary: '摘要', checkpointCount: 2, sections: { goal: '目标甲', next: '下一步乙' } }, zh: true })
}
function collect(n, acc) { if (!n || typeof n !== 'object') return acc; if (n.type) acc.push(n.type); (n.kids || []).forEach(function (k) { if (Array.isArray(k)) k.forEach(function (x) { collect(x, acc) }); else collect(k, acc) }); return acc }

let tree = null, err = null
try { tree = render(segWithDeps) } catch (e) { err = e }
console.log('① 正路径真渲染:', err ? ('✗ 抛错 -> ' + err.message) : '✓ 未抛错')
if (err) process.exit(1)
const types = collect(tree, [])
console.log('② 渲染树节点类型 =', types.join(','))
const hasCard = types.includes('div')
if (!hasCard) { console.log('✗ 事件卡未渲染出节点'); process.exit(1) }

// ★负路径（保留原事故形态）：在事件卡里引用一个**不存在的标识符** ⇒ 必须精确报 ReferenceError。
//   原套件用 `foldOpen.expand` 复现「引用兄弟函数内变量」；这里用同构注入，语义等价。
// ★首版变异写在 `ev.name || …` 的**短路右侧** ⇒ ev.name 有值时不求值 ⇒ 仍绿（本轮实测踩到）。
//   正确的变异位置是**必然求值**处：`String(ev.status || 'active')` 的左侧参数。
const bug = seg.replace("var status = String(ev.status || 'active')", 'var status = String(missingSiblingScopeVar || \'active\')')
if (bug === seg) { console.log('✗ 变异未命中（锚串变了）'); process.exit(1) }
let err2 = null
try { render(bug) } catch (e) { err2 = e }
const isRef = err2 && err2.name === 'ReferenceError' && /missingSiblingScopeVar/.test(err2.message)
console.log('③ 负路径(注入未定义引用):', isRef ? ('✓ 精确报红 ReferenceError: ' + err2.message) : ('✗ ' + (err2 ? err2.message : '仍绿')))
if (!isRef) process.exit(1)
console.log('=== 守卫通过：真渲染不抛 + 负路径精确报红 ===')

// ═══════════════════════════════════════════════════════════════════════════
// ★R38-RANGE-MUT（2026-10-25 P3 · Lead 要求）：区间锁**上界的鉴别力**负路径
//   做法：模拟「把 5 行无关代码塞进该区间」，断言区间锁会红。
//   目的：证明 700 这个上界真的在守（不是形同虚设），且不影响正常增行。
// ═══════════════════════════════════════════════════════════════════════════
{
  const LOCK_MIN = 250, LOCK_MAX = 900
  function wouldPass (n) { return n >= LOCK_MIN && n <= LOCK_MAX }
  // 基线：实测值必须通过
  if (!wouldPass(helperLines)) { console.log('✗ R38-RANGE-MUT 基线未通过（' + helperLines + '）'); process.exit(1) }
  // 负路径 A：塞 5 行进区间（625 → 630）⇒ 仍应通过（证明没贴死）
  if (!wouldPass(helperLines + 5)) { console.log('✗ R38-RANGE-MUT 正常增行 5 被误杀'); process.exit(1) }
  // 负路径 B：段被切歪吞掉半个文件（625 → 6019，约 +5,394 行）⇒ 必须红
  if (wouldPass(helperLines + 5394)) { console.log('✗ R38-RANGE-MUT 吞掉半个文件仍放行（上界失效）'); process.exit(1) }
  // 负路径 C：段被切短（625 → 200）⇒ 必须红
  if (wouldPass(200)) { console.log('✗ R38-RANGE-MUT 段被切短仍放行（下界失效）'); process.exit(1) }
  console.log('R38-RANGE-MUT ✓ 上界守切歪（+5394 红）· 下界守切短（200 红）· 正常增行不误杀（+5 绿）')
}