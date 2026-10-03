import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const source = readFileSync(new URL('../../lib/client.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
// ★2026-09-30 双皮肤块（用户裁定：旧款为默认 + 三套变体经下拉选择）：
//   生成区现有**两块**（legacy 旧款 + 三套变体）——本快照关心「剥掉生成区后的经典侧」，
//   故两块都要拆；并把**分派行**归一回单分支形态，否则比对的就不是「经典档」而是「双块集成形态」。
const classic = source
  .replace(/    \/\/ ===== ITER5-LEGACY-GENERATED:BEGIN =====[\s\S]*?    \/\/ ===== ITER5-LEGACY-GENERATED:END =====\n/, '')
  .replace(/    \/\/ ITER5-GENERATED:BEGIN[\s\S]*?    \/\/ ITER5-GENERATED:END\n/, '')
  .replace("+ DAM_SKIN_V4_CSS + '\\n' + (damSkinLegacy() ? LEGACY_ITER5_CSS : ITER5_CSS) + '\\n/* dam-skin:end (v4) */'", "+ DAM_SKIN_V4_CSS + '\\n/* dam-skin:end (v4) */'")
  .replace("h('div', { 'data-dam-skin-v4-root': '1' }, damSkinLegacy()\n            ? h(Legacy5Page, { nonce: nonce, onExit: function () { damSkinRemoveCss(); setNonce(nonce + 1) } })\n            : h(Iter5Page, { nonce: nonce, onExit:", "h('div', { 'data-dam-skin-v4-root': '1' }, h(DamSkinV4Page, { nonce: nonce, onExit:")
  .replace('h(Iter5Page, { nonce: nonce, onExit:', 'h(DamSkinV4Page, { nonce: nonce, onExit:')
  .replace("try { ensureStyle(); if (damSkinActive() === 'v4') damSkinEnsureCss() } catch", 'try { ensureStyle() } catch')
  .replace('function DialogHost() {\n      var tourDeep = useDeepTheme()\n      var tickPair = useTick()', 'function DialogHost() {\n      var tickPair = useTick()')
  .replace("tourStep === 0 ? h(SkinHero, { slot: 'hero.welcome', deep: tourDeep })", "tourStep === 0 ? h(SkinHero, { slot: 'hero.welcome', deep: useDeepTheme() })")
// ★2026-09-30：本快照基线演进（PR #150 移植到 3.2.5 之上）——生成块**之外**的 client.js 现包含 3.2.5 的合法修复
//   （接续身份钉死 clickedSid、StatsTab/Iter5Stats 解包 data.stats），故快照哈希随之变化；
//   守卫语义不变：生成块之外的任何**非意外**改动仍会被本锁抓住。
// ★2026-09-30（B 批 · 皮肤可插拔入口，同一裁定续批）本快照第三次演进，归因：
//   SkinPicker 新增「皮肤族四款直选」（基线 / 仪器 / 编辑 / 活水）+ 高亮口径覆盖四款；
//   pick() 改写：家族档写 dam-skin-style（基线档还删 dam-skin 回到「未显式选过」语义，
//   与三值模型一致）；主题层（用户自装）保持 dam-skin=v4 + dam-skin-variant 不变。
//   动因：四款下拉原先只在变体页侧栏，默认档（基线块）无任何入口 ⇒ 皮肤切换死锁。
//   功能性验收另见 smoke-test-skin-pluggable.mjs（真执行 flavor/pick 语义 + 变异必红）。
// ★2026-09-30（C1 · 设置面补全，用户「三面必须全量同步」）本快照第四次演进，归因：
//   经典档 SettingsPage 的 engine 分区新增 4 道真闸门控件（激活收件箱/影子检索/上下文桥/L0 索引）
//   + 1 个只读诊断块（总闸·模式·档位·Python 运行时），并补 zh/en 字典条目。
//   同期同内容已落到冻结基线块（skins/legacy/iter5-325.js.frozen）与生成变体块（跑生成器继承）。
//   三面同步由 smoke-test-settings-parity.mjs 守卫（逐控件计数：4 键 x 3 面 = 12，缺一即红）。
// ★2026-09-30（C2 · 注入预算/水位/接续归档 14 键）本快照第五次演进：经典档 engine/window 分区
//   新增 14 个控件 + zh/en 各 28 条字典；同步落到冻结基线块与生成变体块（三面 14x3=42 处 set()）。
//   三面同步守卫同步扩到 99 键（原 85），缺一即红。
// ★2026-09-30（C3 · 团队/同步 23 键）本快照第六次演进：renderTeamSettings 单点定义（三面共用）扩展
//   键表 9→23、字段表同步、新增三类渲染分支（selectTrans/selectE2E/number）、zh/en 各 23 条标签。
//   同批修复守卫自身缺陷：l3-team 的键提取正则 [a-zA-Z]+ 漏掉含数字键（teamE2E）⇒ 改为 [A-Za-z0-9_$]+。
// ★2026-09-30（D2 · 设置双向实时同步）本快照第七次演进：saveConfigPatch 成功后 emit 广播（唯一写出口
//   一处收口）；两个 I5 入口（宿主设置面板 / 工作台设置页）各增一个「广播即重取」effect，含三条安全线
//   （有草稿不覆盖用户输入 / busy 不重取 / 身份不符放弃）。功能性验收见 smoke-test-settings-sync.mjs。
// 2026-10-03 reviewed update: draft persistence/CAS, strict save errors, raw editor strings, request generations, settings grouping, secret masking, truthful current defaults. See docs/ui-settings-20261003/REVIEW.md.
// ★2026-09-30（D3 · 提示词层镜像 12→23 逐字一致）本快照第八次演进：DEFAULT_PROMPT_LAYERS_CLIENT
//   由 12 层扩为与服务端同键序的 23 层、逐字一致（此前 snapshotHead/snapshotWelcomeBody 为截断版）。
//   守卫升级：g4-whiteboard 新增 G4-6d（键集相等 + 逐键求值比对），并把原 G4-6b 的键序假设改为花括号配对抽取。
// ★2026-09-30（A 批 · 皮肤可插拔重构，用户裁定「基线永不变」）本快照再次演进，归因五条：
//   (1) damSkinActive 由二值改三值（classic / v4 / iter5 = 默认）；
//   (2) 新增 damSkinCssFlavor + damSkinCssText：样式表按当前皮肤分派，两份 CSS 绝不同时注入；
//   (3) damSkinEnsureCss 由「有元素即 return」改为按 data-dam-skin-css 标记判等重建（修 P0：换肤不刷新）；
//   (4) 挂载门与挂载期注入门由 === v4 放宽为 !== classic（否则默认档被挡在门外，皮肤整个不见）；
//   (5) 经典侧入口按钮口径改为「经典 <-> 新皮肤族」。
//   守卫语义不变：生成块之外的任何**非意外**改动仍会被本锁抓住。
// ★2026-09-30 本快照第九次演进（F 批 · 皮肤可插拔收尾，增量归因）：
//   (1) SkinPicker 旧「总卡」退场（用户报「两个对勾同时存在」根因：旧卡判据 cur===it.id 与族卡同时命中）；
//   (2) pick() 家族档改**双写**：直接落 presentation.v1 + 调 iter5SetStyle（修「选了没反应」——
//       变体块用模块级缓存读样式且靠广播重渲染，裸写盘不触发）；
//   (3) 高亮判据收敛为「主题层 / 家族档 / 经典」三类互斥（旧总卡退场后不再需要第四支）；
//   (4) 随之删除失效 i18n 词条（旧总卡标签，退场后零消费点）。
//   守卫语义不变：生成块之外的任何**非意外**改动仍会被本锁抓住。
// ★2026-09-30 本快照第十次演进（H2 批 · 向导 where 分区名对齐，用户裁定「留在向导，只把 where 改成与设置页一致」）：
//   (1) TOUR_STEPS 内 7 处 where: L('自动记忆引擎', 'Semantic engine') ⇒ L('语义记忆总开关', 'Memory engine')——
//       与设置页 sectionLabels.engine 实名对齐（该实名自合并后即为「语义记忆总开关」）；
//       其中 3 处为既有、4 处为 F 批新增，同源同错，一并改完（避免半修）；
//   (2) 附「向导 where ⇒ 设置页实名单」对照核验：11 个分区名逐条比对，本批后 4 种 where 取值中
//       「语义记忆总开关」命中最多次（7 次），其余 3 种（记忆窗口 / 自动化 / 记忆中枢）为**批前既有**，未在本批范围内。
//   守卫语义不变：生成块之外的任何**非意外**改动仍会被本锁抓住；本批期望值随之上移。
// V3 reviewed changes outside generated blocks: four destinations, shared settings,
// isolated workbench drafts and search Escape handling. Other edits remain locked.
assert.equal(createHash('sha256').update(classic).digest('hex'), '05080632796fda07918847df214ea4c9e53ee9683f0b412d681038d8a5ed94ce', 'V3 reviewed classic navigation / shared-settings source baseline')
console.log('PASS V3 shared settings / four-entry classic source baseline preserved')

const css = readFileSync(new URL('../../skins/iter5/skin.css', import.meta.url), 'utf8')
for (const line of css.split('\n')) {
  const consumers = line.replace(/--i5-[\w-]+:[^;}]+/g, '')
  assert(!/#[0-9a-f]{3,8}\b|rgba?\(/i.test(consumers), 'Colors must use named tokens: ' + line)
}
assert(!source.includes('BData.'), 'No demo data shipped')
const embeddedCss=JSON.parse(source.match(/var ITER5_CSS = (.+)\n/)[1])
const sharedTokens=embeddedCss.match(/\[data-iter5\],\[data-dam-theme\]\{([^}]+)\}/)[1]
assert(sharedTokens.split(';').filter(Boolean).every(declaration=>declaration.startsWith('--')),'Overlay token sharing must not include page flex/height/position styles')
console.log('PASS scoped token colors and no demo data')

// Execute the shipped factory with a small hook harness. No network, real memory,
// browser globals, or production exports are modified by this test.
let states = [], effects = [], cursor = 0, exposed, accept = true, confirmCount = 0
let requests = [], failSave = false
let config = { semanticEngineMode: 'auto', associativeMemoryEnabled: true, memoryAnchorEnabled: false, jsDecideCooldownRounds: 1, injectEnabled: true, locale: 'zh', externalSources: {} }
const React = {
  Fragment: Symbol('Fragment'),
  createElement: (type, props, ...children) => ({ type, props: { ...(props || {}), children } }),
  cloneElement: (node, props) => ({ ...node, props: { ...node.props, ...props } }),
  useState(initial) { const i = cursor++; if (!(i in states)) states[i] = typeof initial === 'function' ? initial() : initial; return [states[i], value => { states[i] = typeof value === 'function' ? value(states[i]) : value }] },
  useRef(initial) { const [ref] = React.useState(() => ({ current: initial })); return ref },
  useReducer(fn, initial) { const [state, set] = React.useState(initial); return [state, action => set(old => fn(old, action))] },
  useEffect(fn, deps) { const i = cursor++; const old = states[i]; if (!old || deps.some((d, n) => !Object.is(d, old[n]))) { states[i] = deps; effects.push(fn) } },
}
// ★2026-09-30（用户裁定）：默认皮肤改为 legacy（旧款）。本套件验收的是**仪器变体**的首页，
//   故模拟存储显式给出 instrument（否则 Iter5Home 会按新默认走 legacy 分支——那是另一套首页，
//   本套件的断言对象不在那里）。守卫语义不变：仪器首页必须保留日历与最近记录。
const localStorage = { getItem: (k) => (k === 'dsh-auto-memory.presentation.v1' ? 'instrument' : null), setItem() {}, removeItem() {}, length: 0 }
const document = { documentElement: { getAttribute: () => '', style: { setProperty() {} }, classList: { contains: () => false } }, querySelector: () => null, getElementById: () => null }
const window = { localStorage, addEventListener() {}, removeEventListener() {}, confirm() { confirmCount++; return accept }, __ModuleLoader__: { load(def) { exposed = def.factory(name => { if (name === 'react') return React; throw Error('Test module unavailable: ' + name) }) } } }
const context = vm.createContext({ window, document, localStorage, console: { log() {}, warn() {}, info() {}, error() {} }, navigator: { language: 'zh-CN' }, URL, URLSearchParams, requestAnimationFrame: fn=>fn(), setTimeout, clearTimeout, setInterval: () => 1, clearInterval() {}, fetch: () => { throw Error('Unexpected raw fetch') } })
vm.runInContext(source.replace('    return module.exports', `    exports._i5test = { Iter5Notice: Iter5Notice, Iter5Summary: Iter5Summary, Iter5AutoContinue: Iter5AutoContinue, Iter5Storage: Iter5Storage, Iter5Migration: Iter5Migration, Iter5DeleteConfirmation: Iter5DeleteConfirmation, iter5WorkspaceLayout: iter5WorkspaceLayout, iter5MapLabel: iter5MapLabel, Iter5WorkspaceGraph: Iter5WorkspaceGraph, iter5SkillContent: iter5SkillContent, Iter5SkillBrowser: Iter5SkillBrowser, iter5SearchEntries: iter5SearchEntries, Iter5Note: Iter5Note, Iter5Search: Iter5Search, useIter5Data: useIter5Data, Iter5Home: Iter5Home, Iter5Settings: Iter5Settings, Iter5Tabs: Iter5Tabs, iter5MemoryRows: iter5MemoryRows, iter5MemorySnapshot: iter5MemorySnapshot, iter5LedgerTitle: iter5LedgerTitle, DialogHost: DialogHost, setDialog: function (d) { dialogState = d }, t: t,
      transport: function (get, post) { apiGet = get; apiPost = post }, identity: function (value) { iter5Identity = function () { return value }; memoryDraftIdentity = function () { return value } } }
    return module.exports`), context, { filename: fileURLToPath(new URL('../../lib/client.js', import.meta.url)) })
const test = exposed._i5test
// Execute the host theme reader against both current DSH and older host markers.
const themeReader = vm.runInContext('(' + source.slice(source.indexOf('    function readHostDeep()'), source.indexOf('    function useDeepTheme()')) + ')', context)
assert.equal(themeReader(), false)
document.body = { hasAttribute: name => name === 'data-ds-dark-theme' }
assert.equal(themeReader(), true, 'Current host body theme marker is recognized')
document.body = { hasAttribute: () => false }
document.documentElement.style.colorScheme = 'dark'
assert.equal(themeReader(), true, 'Current host color-scheme is recognized')
document.documentElement.style.colorScheme = 'light'
assert.equal(themeReader(), false, 'Switching back to light clears dark theme')
assert(!embeddedCss.includes('body:has([data-iter5])'), 'Independent roots never depend on a workbench being mounted')
assert(!embeddedCss.includes('html:has(#dam-skin-v4-style)'), 'Shared overlays do not depend on opt-in stylesheet lifetime')
console.log('PASS actual host theme markers and standalone entry styles')
test.transport(async url => {
  if (url.includes('/config')) return { config: { ...config } }
  if (url.includes('/semantic-status')) return { loaded: true, ready: false, resolvedTier: 'c1', download: { phase: 'idle' } }
  if (url.includes('/update-check')) return { current: '3.2.1' }
  return {}
}, async (url, patch) => {
  requests.push({ url, patch: JSON.parse(JSON.stringify(patch)) })
  if (failSave) throw Error('injected save failure')
  config = { ...config, ...patch }
  return { config: { ...config } }
})
function render() { cursor = 0; const tree = test.Iter5Settings(); const pending = effects; effects = []; pending.forEach(fn => fn()); return tree }
async function settle() { for (let i = 0; i < 5; i++) await new Promise(resolve => setTimeout(resolve, 0)); return render() }
function nodes(tree, predicate, out = []) { if (!tree || typeof tree !== 'object') return out; if (Array.isArray(tree)) tree.forEach(x => nodes(x, predicate, out)); else { if (predicate(tree)) out.push(tree); nodes(tree.props?.children, predicate, out) } return out }
function field(tree, key) { const label = test.t(key); const row = nodes(tree, n => n.props?.['data-i5-field'] === label)[0]; const found = nodes(row, n => n.type === 'input'); assert(found.length, 'Input exists: ' + label); return found[0] }
function button(tree, label) { const found = nodes(tree, n => n.type === 'button' && n.props.children.flat(Infinity).includes(label)); assert(found.length, 'Button exists: ' + label); return found[0] }
render(); let tree = await settle()
function select(group){const tabs=nodes(tree,n=>n.type===test.Iter5Tabs)[0];tabs.props.onChange(group);tree=render();return tree}
select('maintenance')
assert.equal(field(tree, 'fNoteCap').props.value, 24000)
assert.equal(field(tree, 'fUserCap').props.value, 24000)
console.log('PASS generated settings preserve both upstream capacity defaults')
select('find')
const engineSections = nodes(tree,n=>n.type==='section'&&n.props.id?.endsWith('-section-engine'))[0]
const engineAdvanced = nodes(engineSections, n => n.type === 'details' && n.props.className === 'i5-settings-advanced')[0]
assert.equal(nodes(engineAdvanced, n => n.props?.['data-i5-field'] === test.t('fEmitMode')).length, 0, 'Actual delivery mode must not be hidden in advanced settings')
assert.equal(nodes(engineAdvanced, n => n.props?.['data-i5-field'] === test.t('fJsCooldown')).length, 1, 'Tuning remains available in advanced settings')
assert.equal(field(tree, 'fAssocEngine').props['aria-label'], '主动查找相关记忆', 'Accessible name matches plain-language visible label')
select('record')
const memorySection = nodes(tree, n => n.type === 'section' && n.props.id?.endsWith('-section-capacity'))[0]
assert.equal(nodes(memorySection, n => n.props?.['data-i5-field'] === test.t('fAutoConsolidate')).length, 1, 'Automatic recording stays reachable after regrouping')
assert.equal(nodes(memorySection, n => n.type === 'details' && n.props.className === 'i5-settings-advanced').length, 1)
console.log('PASS beginner settings expose recall delivery and preserve advanced controls')
select('appearance')
const appearance=tree
assert(button(appearance,test.t('tourReplay')),'Manual welcome entry stays in appearance group')
console.log('PASS welcome replay is reachable under appearance settings')
select('find')
field(tree, 'fJsCooldown').props.onChange({ target: { value: '7' } })
tree = render()
assert.equal(tree.props['data-i5-dirty'], 'true')
const radio = nodes(tree, n => n.type === 'input' && n.props.type === 'radio' && n.props.value === 'lexical')[0]
radio.props.onChange({ target: { value: 'lexical' } }); tree = await settle()
assert.deepEqual(requests.at(-1).patch, { semanticEngineMode: 'lexical' })
assert.equal(field(tree, 'fJsCooldown').props.value, 7, 'Immediate engine change retains other drafts')
config.injectEnabled = false // Simulate another surface updating an unrelated key.
button(tree, '保存更改').props.onClick(); tree = await settle()
assert.deepEqual(requests.at(-1).patch, { jsDecideCooldownRounds: 7 })
assert.equal(config.injectEnabled, false, 'Unrelated concurrent changes survive save')
assert.equal(tree.props['data-i5-dirty'], 'false')
console.log('PASS immediate engine, draft retention, patch-only save, concurrent unrelated config')

field(tree, 'fJsCooldown').props.onChange({ target: { value: '9' } }); tree = render()
failSave = true
button(tree, '保存更改').props.onClick(); tree = await settle()
assert.equal(tree.props['data-i5-dirty'], 'true')
assert.equal(field(tree, 'fJsCooldown').props.value, 9)
assert(nodes(tree, n => n.props?.['data-dam-error'] === '').some(n => n.props.children.includes('injected save failure')))
button(tree, '取消修改').props.onClick(); tree = render()
assert.equal(field(tree, 'fJsCooldown').props.value, 7)
assert.equal(tree.props['data-i5-dirty'], 'false')
console.log('PASS failed save preserves draft and exposes error; cancel restores last saved config')

// Host-driven unmount must not erase pending edits. Recovery remains in memory,
// not localStorage, and must not write a stale patch without explicit save.
field(tree, 'fJsCooldown').props.onChange({ target: { value: '11' } }); tree = render()
const postsBeforeRemount = requests.length
states = []; effects = []; cursor = 0
tree = render(); tree = await settle();select('find')
assert.equal(field(tree, 'fJsCooldown').props.value, 11)
assert.equal(tree.props['data-i5-dirty'], 'true')
assert.equal(requests.length, postsBeforeRemount, 'Recovery cannot auto-save')
button(tree, '取消修改').props.onClick(); tree = render()
states = []; effects = []; cursor = 0
tree = render(); tree = await settle();select('find')
assert.equal(field(tree, 'fJsCooldown').props.value, 7)
assert.equal(tree.props['data-i5-dirty'], 'false', 'Discard removes recovery draft')
console.log('PASS host remount restores unsaved edits without browser persistence or automatic writes')

accept = false
field(tree, 'fAssocEngine').props.onChange({ target: { checked: false } }); tree = render()
assert.equal(field(tree, 'fAssocEngine').props.checked, true)
accept = true
field(tree, 'fAssocEngine').props.onChange({ target: { checked: false } }); tree = render()
assert.equal(field(tree, 'fAssocEngine').props.checked, false)
assert.equal(confirmCount, 2)
assert.equal(config.associativeMemoryEnabled, true, 'Confirmation creates a draft; saving performs the write')
console.log('PASS engine-disable confirmation and cancellation')

const built = test.iter5MemoryRows({ userSize: 10, logs: [{ name: '2026-09-28.md', date: '2026-09-28', size: 20 }], reflections: [] }, { userFile: 'fixture/MEMORY.md' })
assert.equal(built.length, 2)
assert.equal(built[0].scope, 'user')
assert.equal(built[1].path, '2026-09-28.md')
console.log('PASS memory-file rows preserve source scope and file route paths')
const boundRows=test.iter5MemoryRows({projectDir:'C:/isolated/project-a',logs:[{name:'2026-09-28.md',date:'2026-09-28',size:20}],reflections:[]},{})
assert.equal(boundRows[0].path,'C:/isolated/project-a/2026-09-28.md','File reads bind to the returned absolute project root')
assert.equal(test.iter5LedgerTitle('handoff-20260928-090000.md'),'2026-09-28 09:00')
let reads=[]
test.transport(async url=>{reads.push(url);return url.endsWith('/state')?{notesPath:'C:/isolated/project-a/MEMORY.md'}:{projectDir:'C:/isolated/project-b',logs:[],reflections:[]}},async()=>{})
await assert.rejects(test.iter5MemorySnapshot(),/工作区数据正在切换/)
assert(reads[0].endsWith('/state')&&reads[1].endsWith('/list'),'State is read before workspace-global list')
console.log('PASS handoff naming and cross-workspace read mismatch rejection')
states=[];effects=[];cursor=0
window['dsh-auto-memory.wizStatus']={loaded:true,ready:false,download:{phase:'idle'}}
test.setDialog(null);test.DialogHost();const hiddenHooks=cursor
cursor=0;test.setDialog({kind:'welcomeTour',manual:true});const tour=test.DialogHost()
assert(tour,'Welcome tour renders')
// ★2026-10-01 判据升级（用户裁定「那就修守卫」）：原断言锚在**容器标识** data-native-tour-nav 上，
//   而它要守的真实语义是「欢迎向导每一步都可达 + 当前步唯一」。H33 批按用户裁定恢复 3.2.5 观感、
//   把步骤胶囊换成圆点条（data-dam-tour-dots）后**功能未变、容器名变了** ⇒ 锚点型断言转红。
//   判据纪律：断言对象若是「某 class/属性名是否存在」即恒真守卫，不构成功能验收。
//   此处改为**直接断言功能**，并接受两种容器名（旧 nav 条 / 新圆点条）：
//   ① 步骤导航容器存在；② 步骤按钮数 = 实际步数；③ 每个步骤按钮都**真的可点**（有 onClick）；④ 当前步唯一。
const navC=nodes(tour,n=>n.props?.['data-native-tour-nav']===''||n.props?.['data-dam-tour-dots']==='')[0]
assert(navC,'Welcome provides step navigation (nav bar or dot rail)')
const stepBtns=nodes(navC,n=>n.type==='button')
assert.equal(stepBtns.length,9,'All actual welcome steps remain reachable')
assert(stepBtns.every(n=>typeof n.props?.onClick==='function'),'Every welcome step is actually reachable (clickable)')
assert.equal(stepBtns.filter(n=>n.props?.['aria-current']==='step').length,1,'Exactly one step is current')
// ★2026-10-03（G3）：原断言读 window['dsh-auto-memory.TOUR_STEPS'] —— 那是**写给已摘除死壳 welcome 的
//   暴露**（唯一消费者）。改判据为「不依赖任何 window 暴露」，直接从**真渲染出的向导步骤**按配置键收集：
//   遍历每步导航按钮（真点击 → 真重渲染），收集该步 tour toggle 按钮上的 data-dam-tour-key。
//   守卫语义不变（仍守「workbenchEnabled 在场、workbenchRoot 不得作为布尔写入」），且比原来更贴近真行为。
// 取「末页汇总」里**真渲染出的**开关徽标（data-dam-tour-badge 文本 = 开关名 + 开/关）。
//   末页汇总由 allToggles（= TOUR_STEPS 各步 toggles 的并集）派生 ⇒ 与「向导里到底有哪些开关」同源，
//   但不依赖任何 window 暴露，也不需要逐页点击。
// 末页汇总在**最后一步**才渲染 ⇒ 先真点最后一步导航，取该步**真渲染出的整棵树**做判据。
stepBtns[stepBtns.length-1].props.onClick()
cursor=0
const lastStepText=JSON.stringify(test.DialogHost())
// 判据（均在真渲染结果上判定，不读源码字符串、不依赖 window 暴露）：
//   ① 向导里存在「记忆中枢」这一真开关（workbenchEnabled 的用户可见面）；
//   ② 不存在「工作台目录」开关 —— 目录是字符串配置，把它当布尔写进配置是**曾经的缺陷形态**。
assert(lastStepText.indexOf('记忆中枢')>=0,'Welcome tour exposes the memory-hub switch (workbenchEnabled)')
assert(lastStepText.indexOf('工作台目录')<0,'Directory setting cannot be written as a boolean')
assert.equal(cursor,hiddenHooks,'Hidden-to-visible welcome transition must not add hooks')
cursor=0;test.setDialog(null);test.DialogHost()
assert.equal(cursor,hiddenHooks,'Closing the welcome tour must not remove hooks')
console.log('PASS real DialogHost hook count stable when opening and closing welcome tour')

states=[];effects=[];cursor=0
const firstLoad=()=>Promise.resolve({content:'File A'})
test.useIter5Data(firstLoad,['a'])
effects.splice(0).forEach(fn=>fn())
await new Promise(resolve=>setTimeout(resolve,0))
cursor=0
assert.equal(test.useIter5Data(firstLoad,['a']).data.content,'File A')
cursor=0
const switched=test.useIter5Data(()=>Promise.resolve({content:'File B'}),['b'])
assert.equal(switched.data,null,'Changing a file masks the previous result before effects run')
assert.equal(switched.loading,true)
effects.splice(0).forEach(fn=>fn())
await new Promise(resolve=>setTimeout(resolve,0))
cursor=0
assert.equal(test.useIter5Data(()=>Promise.resolve(null),['b']).data.content,'File B')
console.log('PASS file transitions cannot display stale content under a new title')

states=[];effects=[];cursor=0
const home=test.Iter5Home({nonce:0,onNav(){}})
assert.equal(nodes(home,n=>n.props?.className==='i5-daily-card').length,1,'Home retains its real calendar section')
assert.equal(nodes(home,n=>n.props?.className==='i5-native-recent').length,1,'Home retains recent records')
console.log('PASS refined home retains recent records and calendar entry points')

states=[];effects=[];cursor=0
test.identity('session-a|workspace-a')
let resolveOld
test.useIter5Data(()=>new Promise(resolve=>{resolveOld=resolve}),[])
effects.splice(0).forEach(fn=>fn())
await Promise.resolve()
test.identity('session-b|workspace-b');cursor=0
assert.equal(test.useIter5Data(()=>Promise.resolve('workspace-b'),[]).data,null)
effects.splice(0).forEach(fn=>fn())
await new Promise(resolve=>setTimeout(resolve,0))
resolveOld('workspace-a');await new Promise(resolve=>setTimeout(resolve,0));cursor=0
assert.equal(test.useIter5Data(()=>Promise.resolve(null),[]).data,'workspace-b','Late prior-workspace data must not replace the active scope')
console.log('PASS late results cannot cross session/workspace identity')


// Execute panel draft and selectable search behavior through the shipped components.
function renderNative(component, props) { cursor=0;const tree=component(props);effects.splice(0).forEach(fn=>fn());return tree }
function resetNative() { states=[];effects=[];cursor=0 }
resetNative();test.identity('note-session-a|workspace-a')
let note=renderNative(test.Iter5Note,{persistDraft:'panel'})
nodes(note,n=>n.type==='textarea')[0].props.onChange({target:{value:'Keep this unsaved note'}})
resetNative();test.identity('note-session-b|workspace-b')
note=renderNative(test.Iter5Note,{persistDraft:'panel'})
assert.equal(nodes(note,n=>n.type==='textarea')[0].props.value,'','A different session never receives the panel draft')
resetNative();test.identity('note-session-a|workspace-a')
note=renderNative(test.Iter5Note,{persistDraft:'panel'})
assert.equal(nodes(note,n=>n.type==='textarea')[0].props.value,'Keep this unsaved note','Closing and remounting restores the same-session draft')
test.transport(async()=>({}),async()=>({ok:true}))
note.props.onSubmit({preventDefault(){}})
await new Promise(resolve=>setTimeout(resolve,0))
resetNative();note=renderNative(test.Iter5Note,{persistDraft:'panel'})
assert.equal(nodes(note,n=>n.type==='textarea')[0].props.value,'','A successful append clears the recovered draft')
console.log('PASS panel drafts survive remount, isolate identities and clear only after append')
resetNative()
test.transport(async()=>({}),async()=>({answer:'Host summary',hits:[{where:'log-a.md',line:'First source passage'},{where:'log-b.md',line:'Second source passage'}],keywords:['source']}))
let search=renderNative(test.Iter5Search,{nonce:0})
nodes(search,n=>n.type==='input')[0].props.onChange({target:{value:'source'}})
search=renderNative(test.Iter5Search,{nonce:0})
nodes(search,n=>n.type==='form')[0].props.onSubmit({preventDefault(){}})
await new Promise(resolve=>setTimeout(resolve,0))
search=renderNative(test.Iter5Search,{nonce:0})
const results=nodes(search,n=>n.props?.className==='i5-search-result')
assert.equal(results.length,3,'The host summary and both source passages are independently selectable')
results[1].props.onClick()
search=renderNative(test.Iter5Search,{nonce:0})
assert.equal(nodes(search,n=>n.props?.className==='i5-search-result'&&n.props['aria-current']==='true').length,1)
assert.equal(nodes(search,n=>n.type==='h2'&&n.props.tabIndex===-1)[0].props.children[0],'log-b.md','Selecting a source updates the detail heading')
const lexical=test.iter5SearchEntries({result:'[记忆检索] 验收\n== 本地记忆文件命中 ==\n· log-a.md:\n  - exact source A\n· log-b.md:\n  - exact source B'},'recall')
assert.equal(lexical.length,3)
assert.equal(lexical[0].title,'log-a.md')
assert.equal(lexical[1].text,'- exact source B')
assert.equal(lexical[2].summary,true,'The complete host transcript remains available')
console.log('PASS search renders real source passages as selectable results')


resetNative()
const actionNode={key:'skill-1',props:{'data-dam-content':'',children:[{type:'button',props:{children:['Approve'],onClick(){}}}]}}
const skillRows=[{props:{title:'Skill group',children:[actionNode]}}]
assert.equal(test.iter5SkillContent(skillRows,'skill-1'),actionNode,'Original gated action node is reused without reimplementing its handlers')
let skillTree=renderNative(test.Iter5SkillBrowser,{active:[],pipeline:[{procedureId:'skill-1',title:'Reviewed process',stage:'candidate',steps:['Actual step'],successCriteria:['Actual criterion']}],rows:skillRows})
assert.equal(nodes(skillTree,n=>n.props?.className==='i5-native-skill-row').length,1)
assert.equal(nodes(skillTree,n=>n.type==='li')[0].props.children[0],'Actual step')
nodes(skillTree,n=>n.type==='input')[0].props.onChange({target:{value:'absent'}})
skillTree=renderNative(test.Iter5SkillBrowser,{active:[],pipeline:[{procedureId:'skill-1',title:'Reviewed process'}],rows:skillRows})
assert.equal(nodes(skillTree,n=>n.props?.className==='i5-native-skill-row').length,0)
console.log('PASS native skills preserve gated action content and title filtering')


for (const count of [1,2,5]) {
 const workspaces=Array.from({length:count},(_,i)=>({path:'ws-'+i,name:'Workspace '+i,graphTopics:Array.from({length:i===0?14:4},(_,n)=>({label:'Topic '+n}))}))
 const graph=test.iter5WorkspaceLayout(workspaces,{links:count>1?[{from:'ws-0',to:'ws-1',label:'shared'}]:[]})
 assert.equal(graph.nodes.filter(n=>n.kind==='workspace').length,count)
 assert.equal(graph.nodes.filter(n=>n.kind==='topic').length,14+4*(count-1),'Every actual topic is represented')
 for (const node of graph.nodes) assert(node.x-node.width/2>=0&&node.x+node.width/2<=graph.width&&node.y-node.height/2>=0&&node.y+node.height/2<=graph.height,'All graph node rectangles fit the viewBox')
 assert.equal(graph.edges.filter(e=>e.shared).length,count>1?1:0)
}
console.log('PASS native graph retains all topics and bounds every node inside its canvas')

// Replanning must follow the selected policy; changing packs invalidates the preview.
resetNative()
const storageCalls=[],migrationCalls=[]
context.fetch=async(url,opts)=>{if(opts?.body)storageCalls.push(JSON.parse(opts.body));return {ok:true,json:async()=>({ok:true,sources:[{file:'fixture/MEMORY.md',sourceRef:'notes:MEMORY.md',status:'ok'}],counts:{total:1,ok:1,stale:0,unrepairable:0}})}}
test.transport(async()=>({}),async(url,body)=>{migrationCalls.push({url,body});return {ok:true,plan:{onConflict:body.onConflict,additions:[],overwrites:[],stats:{willWrite:0}}}})
let storageTree=renderNative(test.Iter5Storage,{nonce:0})
await new Promise(resolve=>setTimeout(resolve,0))
storageTree=renderNative(test.Iter5Storage,{nonce:0})
const migrationProps=()=>nodes(storageTree,n=>n.type===test.Iter5Migration)[0].props
migrationProps().setPack('fixture/backup.dam-pack')
storageTree=renderNative(test.Iter5Storage,{nonce:0});migrationProps().onPreview()
await new Promise(resolve=>setTimeout(resolve,0));storageTree=renderNative(test.Iter5Storage,{nonce:0})
assert.equal(migrationCalls.at(-1).body.onConflict,'keep')
migrationProps().setConflict('overwrite')
await new Promise(resolve=>setTimeout(resolve,0));storageTree=renderNative(test.Iter5Storage,{nonce:0})
assert.equal(migrationCalls.at(-1).body.onConflict,'overwrite','Changing policy obtains a new host plan')
assert.equal(migrationProps().plan.onConflict,'overwrite')
migrationProps().setPack('fixture/another.dam-pack');storageTree=renderNative(test.Iter5Storage,{nonce:0})
assert.equal(migrationProps().plan,null,'A new pack cannot reuse the previous pack preview')
const selects=nodes(storageTree,n=>n.type==='select')
selects[0].props.onChange({target:{value:'fixture/MEMORY.md'}})
nodes(storageTree,n=>n.type==='input'&&String(n.props.placeholder).startsWith('mem_'))[0].props.onChange({target:{value:'memory-fixture'}})
storageTree=renderNative(test.Iter5Storage,{nonce:0});button(storageTree,'删除').props.onClick()
storageTree=renderNative(test.Iter5Storage,{nonce:0})
let confirmNode=nodes(storageTree,n=>n.type===test.Iter5DeleteConfirmation)[0]
assert.equal(confirmNode.props.payload.memoryId,'memory-fixture')
assert.equal(storageCalls.length,0,'Opening confirmation is read-only')
confirmNode.props.onClose();storageTree=renderNative(test.Iter5Storage,{nonce:0})
assert.equal(nodes(storageTree,n=>n.type===test.Iter5DeleteConfirmation).length,0)
assert.equal(storageCalls.length,0,'Canceling cannot delete')
button(storageTree,'删除').props.onClick();storageTree=renderNative(test.Iter5Storage,{nonce:0})
nodes(storageTree,n=>n.type===test.Iter5DeleteConfirmation)[0].props.onConfirm()
await new Promise(resolve=>setTimeout(resolve,0))
assert.equal(storageCalls.length,1)
assert.equal(storageCalls[0].memoryId,'memory-fixture')
console.log('PASS migration policy replans, pack changes invalidate preview, and deletion requires explicit confirmation')

resetNative();test.setDialog({kind:'notice',notice:{title:'Host notice',message:'Actual message'}})
const noticeElement=renderNative(test.DialogHost,{})
const notice=test.Iter5Notice(noticeElement.props)
assert.equal(notice.props['data-native-dialog'],'notice')
assert.equal(nodes(notice,n=>n.props?.['data-native-dialog']==='notice').length,1,'Sibling notices have an independently styleable native surface')
test.setDialog(null)

const summary=test.Iter5Summary({summary:{summary:'Actual host summary',works:Array.from({length:8},(_,i)=>({title:'Work '+i,points:['Point '+i]}))},onClose(){}})
assert.equal(nodes(summary,n=>n.type==='li').length,8,'Summary retains every actual work item and its points')
const progress=test.Iter5AutoContinue({executing:true,status:'Host is continuing',onDismiss(){}})
assert.equal(nodes(progress,n=>n.props?.role==='progressbar').length,1)
assert.equal(nodes(progress,n=>n.props?.['aria-valuenow']!==undefined).length,0,'No fake percentage when host does not report step progress')
console.log('PASS summary retains all host work details and continuation uses indeterminate progress')

// Git may check out skin sources as CRLF on Windows and LF on Linux.
// ★2026-10-01 移除（用户裁定「把那一个失败删掉，不然以后还会有误解」）：
//   原「生成器幂等」段（实测约 26 行）在临时 fixture 里**真跑 tools/build-iter5-skin.mjs**，
//   而该生成器当前**在真实 client.js 上会把整个生成块吞掉**——根因是它用非贪婪跨行正则
//   /^([ \t]*)useEffect\(\)\{[\s\S]*?\n\1\}, \[\]\)$/gm 配对 useEffect 起止：
//   它靠**缩进相同**猜嵌套，遇到 2477 行的块（内含同缩进 useEffect）就从块首一路吃到最远的
//   `}, [])`，实测吞掉 523,664 字符（含整个生成块）⇒ 产物从 1.79M 缩到 1.50M、回归 2→11 红。
//   ⇒ 该守卫在生成器修好前**恒为红**，留下的唯一作用是把「生成器坏了」这件事误报成
//   「皮肤功能退化」，让后续排查走偏。故整段移除；待生成器改正则配对后由维护者按需恢复
//   （判据：生成器能在当前 client.js 上幂等重跑，且 --check 通过）。
//   注：生成器本身的另外两个缺陷已在本轮修复（计数被注释喂饱 / 摘块丢弃插入锚）。
//
//   ★2026-10-02 恢复（G0-4）：判据已实测满足——生成器改用**括号配平**找块边界（不再依赖缩进
//   猜嵌套），在当前 client.js 上真实重跑逐字节不变、--check 绿（SYNC-OK）。
//   恢复后的守卫**不放在本套件内**，而是独立成 tests/smoke/smoke-test-generator-idempotent.mjs：
//   它真跑生成器（backup/finally 还原）、断言 H1 === H0，并补 R2 负路径（默认停机 / --force 覆盖）。
//   放在独立套件的原因：本套件是皮肤**产物**守卫，生成器**幂等**守卫应当各自独立计时与归因
//   ——2026-10-01 的教训正是「生成器坏了」被误报成「皮肤功能退化」。

// Topic deduplication, readable labels and non-actionable topic semantics.
const uniqueGraph = test.iter5WorkspaceLayout([{path:'/fixture',name:'Fixture',items:['Topic',' Topic ', 'Other']}], {})
assert.equal(uniqueGraph.nodes.filter(n=>n.kind==='topic').length, 2)
assert.equal(Array.from(test.iter5MapLabel('Long workspace title with meaningful word boundaries')).length, 2)
assert(test.iter5MapLabel('Long workspace title with meaningful word boundaries')[1].endsWith('…'))
assert.deepEqual(Array.from(test.iter5MapLabel('Memory search')), ['Memory search'])
console.log('PASS instrument topic deduplication and word-boundary labels')

resetNative()
const topicTree=renderNative(test.Iter5WorkspaceGraph,{workspaces:[{path:'/fixture',name:'Fixture',items:['Topic']}],onSelect(){throw Error('Topic must not switch workspace')},scale:1})
const topicNode=nodes(topicTree,n=>n.props?.['data-native-map-node']==='topic')[0]
assert.equal(topicNode.props.onClick,undefined)
assert.equal(topicNode.props.tabIndex,undefined)
assert.equal(topicNode.props.role,'img')
console.log('PASS topic nodes expose content without a misleading workspace action')
