import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const file = path.join(root, 'lib/client.js')
let client = readFileSync(file, 'utf8')
const newline = client.includes('\r\n') ? '\r\n' : '\n'
client = client.replace(/\r\n/g, '\n')
const begin = '    // ITER5-GENERATED:BEGIN'
const end = '    // ITER5-GENERATED:END'
if (client.includes(begin)) client = client.slice(0, client.indexOf(begin)) + client.slice(client.indexOf(end) + end.length + 1)
function replaceOnce(text, old, value) {
  if (text.split(old).length !== 2) throw new Error('Expected exactly one settings seam: ' + old.slice(0, 90))
  return text.replace(old, value)
}
let settings = client.slice(client.indexOf('    function SettingsPage() {'), client.indexOf('    // ───────────────────────── 插件挂载'))
settings = replaceOnce(settings, 'function SettingsPage()', 'function Iter5Settings(props)')
settings = replaceOnce(settings, "var guidePair = useState('')", "var guidePair = useState('js')")
settings = replaceOnce(settings, '      var tickPair = useTick()', `      var tickPair = useTick()
      var i5Group = useState(props && props.intent && ['engine', 'memory', 'appearance', 'behavior'].indexOf(props.intent.group) >= 0 ? props.intent.group : 'engine')
      var i5Base = useRef(null)
      var i5Draft = useRef({})
      var i5Groups = useRef({})
      var i5Alive = useRef(true)
      var i5Identity = iter5Identity()
      var i5GroupsDef = { engine: ['engine'], memory: ['window', 'capacity', 'skills'], appearance: ['store', 'look', 'skin'], behavior: ['handoff', 'auto', 'team', 'about'] }
      useEffect(function () {
        i5Alive.current = true
        function before(e) { if (!Object.keys(i5Draft.current).length) return; e.preventDefault(); e.returnValue = '' }
        window.addEventListener('beforeunload', before)
        return function () { i5Alive.current = false; window.removeEventListener('beforeunload', before) }
      }, [])
      function i5Ok() { return i5Alive.current && i5Identity === iter5Identity() }
      function i5Record(key, value) {
        if (JSON.stringify(value) === JSON.stringify((i5Base.current || {})[key])) { delete i5Draft.current[key]; delete i5Groups.current[key] }
        else { i5Draft.current[key] = value; i5Groups.current[key] = i5Group[0] }
        setDirty(Object.keys(i5Draft.current).length > 0)
      }
      function i5Cancel() { i5Draft.current = {}; i5Groups.current = {}; setCfg(Object.assign({}, i5Base.current)); setDirty(false); setErr(''); setMsg('') }`)
settings = replaceOnce(settings, '          setCfg(d.config)', '          if (!i5Ok()) return\n          i5Base.current = configOf(d)\n          setCfg(configOf(d))')
settings = replaceOnce(settings,
  'function set(key, value) { setCfg(function (prev) { var next = Object.assign({}, prev); next[key] = value; return next }); setDirty(true) }',
  `function set(key, value) {
        if (busy) return
        if (key === 'associativeMemoryEnabled' && value === false && cfg.associativeMemoryEnabled && !window.confirm(L('关闭自动记忆引擎并保存后，将清零全部观察数据。记忆正文保留。确定关闭？', 'Saving with the engine disabled clears all observation data. Memory files are preserved. Disable?'))) return
        i5Record(key, value)
        setCfg(function (prev) { var next = Object.assign({}, prev); next[key] = value; return next })
      }`)
settings = replaceOnce(settings, 'function setMany(patch) { setCfg(function (prev) { return Object.assign({}, prev, patch) }); setDirty(true) }', 'function setMany(patch) { if (busy) return; Object.keys(patch).forEach(function (k) { i5Record(k, patch[k]) }); setCfg(function (prev) { return Object.assign({}, prev, patch) }) }')
const saveStart = settings.indexOf('      function save() {')
const fieldStart = settings.indexOf('      function field(')
settings = settings.slice(0, saveStart) + `      function save() {
        if (busy || !Object.keys(i5Draft.current).length) return
        setBusy(true); setMsg(''); setErr('')
        var patch = Object.assign({}, i5Draft.current)
        saveConfigPatch(patch, {
          onSaved: function (d) {
            if (!i5Ok()) return
            i5Base.current = configOf(d)
            i5Draft.current = {}; i5Groups.current = {}
            setCfg(configOf(d)); setDirty(false); setBusy(false); setMsg(t('saved'))
            if (configOf(d).locale) applyLocalePref(configOf(d).locale)
            refreshSem(setSem)
          },
          onError: function (e) { if (i5Ok()) { setErr(e.message); setBusy(false) } }
        })
      }
` + settings.slice(fieldStart)
settings = replaceOnce(settings, "      function field(label, control, hint) {\n        return", `      function field(label, control, hint) {
        if (control && (control.type === 'input' || control.type === 'select' || control.type === 'textarea')) control = React.cloneElement(control, { 'aria-label': label, disabled: busy || control.props.disabled, role: control.type === 'input' && control.props.type === 'checkbox' ? 'switch' : undefined })
        return`)
settings = replaceOnce(settings, "return h('div', { 'data-dam-settings-row': '' },", "return h('div', { 'data-dam-settings-row': '', 'data-i5-field': label },")
const modeStart = settings.indexOf('      function onEngineModeChange(e) {')
const modeEnd = settings.indexOf('      var sectionLabels =', modeStart)
settings = settings.slice(0, modeStart) + `      function onEngineModeChange(e) {
        var v = e.target.value
        if (busy) return
        setBusy(true); setErr(''); setMsg('')
        saveConfigPatch({ semanticEngineMode: v }, {
          onSaved: function (d) {
            if (!i5Ok()) return
            i5Base.current = configOf(d)
            setCfg(Object.assign({}, configOf(d), i5Draft.current)); setBusy(false)
            setMsg(L('检索模式已即时生效', 'Retrieval mode saved immediately'))
            refreshSem(function (s) {
              if (!i5Ok()) return
              setSem(s)
              setGuide(v === 'js' && !s.ready ? 'js' : v === 'python' && !s.pythonInt8Present ? 'python' : '')
            })
          }, onError: function (e) { if (i5Ok()) { setErr(e.message); setBusy(false) } }
        })
      }
` + settings.slice(modeEnd)
settings = replaceOnce(settings,
  "function section(key, title, content) { return h('section', { id: 'dam-settings-' + key, 'data-dam-settings-group': '' }, h('h3', null, title), content) }",
  `var i5WelcomeControl = null
      function section(key, title, content) {
        if (key === 'auto') content = content.filter(function (node) { if (node && node.props && node.props['data-i5-field'] === t('fWelcomeTour')) { i5WelcomeControl = node; return false } return true })
        if (key === 'look' && i5WelcomeControl) content = [i5WelcomeControl].concat(content)
        var hidden = i5GroupsDef[i5Group[0]].indexOf(key) < 0
        if (key === 'engine') {
          var mode = [], primary = [], advanced = [], support = []
          content.forEach(function (node) {
            if (!node) return
            var label = node.props && node.props['data-i5-field']
            if (label === t('semMode')) mode.push(node)
            else if (label === t('fAssocEngine') || label === t('fAnchorIndex')) primary.push(node)
            else if (label) advanced.push(node)
            else support.push(node)
          })
          return h('div', { id: 'dam-settings-' + key, className: 'i5-engine-grid', hidden: hidden },
            h(Iter5Card, { className: 'i5-mode-card', title: L('检索模式', 'Retrieval mode'), icon: 'search', hue: 'blue' }, mode),
            h(Iter5Card, { className: 'i5-setup-card', title: L('引擎状态与安装', 'Engine status & setup'), icon: 'spark', hue: 'purple' }, support),
            h(Iter5Card, { title: title, icon: 'pulse', hue: 'green' }, primary, h('details', null, h('summary', null, L('高级：发射模式、判定参数与观测', 'Advanced: emission, thresholds & observation')), advanced)))
        }
        var icons = { window: 'library', capacity: 'storage', skills: 'skills', handoff: 'handoff', auto: 'timeline', store: 'folder', look: 'settings', team: 'mindmap', skin: 'spark', about: 'note' }
        return h('section', { id: 'dam-settings-' + key, 'data-dam-settings-group': '', hidden: hidden }, h('h3', { className: 'i5-card-title' }, h('span', { className: 'i5-badge', 'data-hue': key === 'skills' ? 'green' : key === 'handoff' ? 'cyan' : key === 'auto' ? 'orange' : 'blue' }, h(Iter5Icon, { name: icons[key] || 'settings' })), title), content)
      }`)
settings = replaceOnce(settings, "      return h('div', { 'data-dam-settings': '' },", `      return h('div', { 'data-dam-settings': '', 'data-i5-dirty': dirty ? 'true' : 'false' },
        h(Iter5Tabs, { id: 'i5-settings', label: L('设置分组', 'Settings groups'), value: i5Group[0], onChange: i5Group[1], items: [['engine', L('引擎', 'Engine')], ['memory', L('记忆', 'Memory')], ['appearance', L('外观与目录', 'Appearance & paths')], ['behavior', L('行为与维护', 'Behavior & maintenance')]].map(function (r) { return [r[0], r[1], Object.keys(i5Groups.current).some(function (k) { return i5Groups.current[k] === r[0] })] }) }),`)
settings = replaceOnce(settings, "h('div', { 'data-dam-settings-content': '' },", "h('div', { 'data-dam-settings-content': '', role: 'tabpanel', id: 'i5-settings-panel', 'aria-labelledby': 'i5-settings-tab-' + i5Group[0] },")
const radioOld = `h('select', { 'data-dam-select': '', style: { flex: 1 }, value: cfg.semanticEngineMode || 'auto', onChange: onEngineModeChange },
              h('option', { value: 'auto' }, t('semAuto')),
              h('option', { value: 'lexical' }, t('semLexOnly')),
              h('option', { value: 'js' }, t('semJs')),
              h('option', { value: 'python' }, t('semPy')))`
settings = replaceOnce(settings, radioOld, `h('div', { className: 'i5-engine-radios', role: 'radiogroup', 'aria-label': L('检索模式（即时生效）', 'Retrieval mode (immediate)') },
              [['auto', t('semAuto')], ['lexical', t('semLexOnly')], ['js', t('semJs')], ['python', t('semPy')]].map(function (r) { return h('label', { className: 'i5-engine-choice', key: r[0] }, h('input', { type: 'radio', name: 'i5-engine', value: r[0], checked: (cfg.semanticEngineMode || 'auto') === r[0], disabled: busy, onChange: onEngineModeChange }), h('span', null, r[1])) }))`)
// The wizard's shortcut uses the same immediate save path, never a separate draft write.
const shortcut = "setGuide(''); var n2 = Object.assign({}, cfg); n2.semanticEngineMode = guide; if (guide === 'js') { n2.activationSource = 'js'; n2.contextSinkMode = 'null' } else if (guide === 'python') { n2.activationSource = 'python'; n2.contextSinkMode = 'python' } setCfg(n2); setDirty(true)"
settings = replaceOnce(settings, shortcut, "onEngineModeChange({ target: { value: guide } })")
settings = replaceOnce(settings, "h('div', { 'data-dam-savebar': '' },", "h('div', { 'data-dam-savebar': '', role: 'status' },\n          h('button', { onClick: i5Cancel, disabled: busy || !dirty }, L('取消修改', 'Discard changes')),")
settings = replaceOnce(settings, 'onClick: save, disabled: busy', 'onClick: save, disabled: busy || !dirty')
settings = replaceOnce(settings, "L('有未保存的更改', 'Unsaved changes')", "String(new Set(Object.keys(i5Groups.current).map(function (k) { return i5Groups.current[k] })).size) + L(' 个分区有未保存修改', ' sections with unsaved changes')")
settings = replaceOnce(settings, "apiPost(API.semanticEmit, { mode: m }).then(function () { refreshSem(setSem) }).catch(function () {})", "apiPost(API.semanticEmit, { mode: m }).then(function () { if (i5Ok()) refreshSem(setSem) }).catch(function (e) { if (i5Ok()) setErr(e.message) })")
settings = settings.replace("'tauHi 0.45 · tauLo 0.35 · deltaExp 0.03 · deltaPro 0.05'", "L('阈值由宿主校准策略管理；当前接口未提供有效数值', 'Thresholds are managed by the host policy; current values are unavailable')")
settings = replaceOnce(settings, "try { openDialog({ kind: 'welcomeTour' }) } catch (eTour) {}", "try { openManualWelcomeTourPre() } catch (eTour) {}")
// Avoid global selector collisions with the classic settings surface.
settings = settings.replaceAll("id: 'dam-settings-'", "id: 'i5-settings-section-'")
let storage = client.slice(client.indexOf('    function StorageTab(props) {'), client.indexOf('    function NotesTab() {'))
storage = replaceOnce(storage, 'function StorageTab(props)', 'function Iter5Storage(props)')
storage = storage.replaceAll(".then(function (r) { return r.json() })", ".then(function (r) { return r.json().then(function (j) { if (!r.ok || (j && j.error)) throw Error(j && (j.error || j.reason) || 'Request failed'); return j }) })")
storage = replaceOnce(storage, "      function act(action, payload, onDone) {\n        setMsg('')", `      function act(action, payload, onDone) {
        if (action === 'delete' && !window.confirm(L('确认删除记忆？正文将删除，在途唤起包将清理，派生事实将撤销；已产生的 seen 证据不改写。此操作不能撤销。', 'Delete this memory and revoke derived facts and pending packets? Existing seen evidence is preserved. This cannot be undone.') + '\\n' + payload.filePath + '\\n' + payload.memoryId)) return
        if (action === 'repair' && !window.confirm(L('确认仅重建以下文件的索引副本（正文不变）？', 'Rebuild index copies for these files? Source text is unchanged.') + '\\n' + (payload.items || []).map(function (s) { return s.file || s.sourceRef }).join('\\n'))) return
        setMsg('')`)
storage = replaceOnce(storage, "            setMsg(action + ': ' + reason)\n            if (onDone) onDone(j)", `            setMsg(action + ': ' + reason + (j && j.cascade ? ' · cascade: ' + JSON.stringify(j.cascade) : ''))
            if (j && j.ok !== false && onDone) onDone(j)`)
storage = replaceOnce(storage, "return h('div', { 'data-dam-slot': 'timeline', 'data-dam-flow': '' }, rows)", `return h('div', { className: 'i5-storage-view' },
        h('div', { className: 'i5-stats i5-stats-four' },
          h(Iter5Stat, { icon: 'storage', hue: 'blue', label: L('扫描来源', 'Scanned sources'), value: data.counts ? counts.total : null, hint: L('当前语料来源数', 'Current corpus sources') }),
          h(Iter5Stat, { icon: 'check', hue: 'green', label: L('索引一致', 'Consistent'), value: data.indexEnabled === false ? null : data.counts ? counts.ok : null, hint: data.indexEnabled === false ? L('索引尚未启用', 'Index disabled') : L('正文与索引校验一致', 'Source and index agree') }),
          h(Iter5Stat, { icon: 'pulse', hue: 'orange', label: L('等待修复', 'Needs repair'), value: data.indexEnabled === false ? null : data.counts ? counts.stale : null, hint: L('可以重建的索引副本', 'Rebuildable index copies') }),
          h(Iter5Stat, { icon: 'note', hue: 'purple', label: L('需人工检查', 'Needs inspection'), value: data.indexEnabled === false ? null : data.counts ? counts.unrepairable : null, hint: L('无法自动修复的来源', 'Sources needing manual review') })),
        h('div', { className: 'i5-hosted i5-maintenance-grid', 'data-dam-slot': 'timeline', 'data-dam-flow': '' }, rows))`)
let skills = client.slice(client.indexOf('    function MemoryHubTab(props) {'), client.indexOf('    function StorageTab(props) {'))
skills = replaceOnce(skills, 'function MemoryHubTab(props)', 'function Iter5Skills(props)')
skills = replaceOnce(skills, "      function hubAct(action, procedureId, v) {", `      function hubAct(action, procedureId, v) {
        var names = { promote: L('晋升技能', 'Promote skill'), approve: L('人工批准技能', 'Approve skill'), 'force-promote': L('强制晋升技能', 'Force promotion'), activate: L('激活技能', 'Activate skill'), deprecate: L('弃用技能', 'Deprecate skill') }
        if (names[action] && !window.confirm(names[action] + '？' + L('此操作将改变技能的可用状态。', 'This changes the skill availability.'))) return`)
skills = replaceOnce(skills, "      var nonce = props && props.nonce ? props.nonce : 0", "      var nonce = props && props.nonce ? props.nonce : 0\n      var i5Filter = useState('all')")
skills = replaceOnce(skills, "h(SkinEmpty, { slot: 'empty.library', size: skinSlotSize('empty.library') }, t('hubSkillsEmpty'))", "h(Iter5Empty, { title: L('经验，会慢慢长成技能', 'Experience grows into skills'), text: t('hubSkillsEmpty') })")
skills = replaceOnce(skills, "return h('div', { 'data-dam-slot': 'timeline', 'data-dam-flow': '' }, rows)", `return h('div', { className: 'i5-skills-view' },
        h('div', { className: 'i5-stats i5-stats-four' },
          h(Iter5Stat, { icon: 'skills', hue: 'green', label: L('已生效技能', 'Active skills'), value: procs ? activeList.length : null, hint: L('可复用的工作方法', 'Reusable working methods') }),
          h(Iter5Stat, { icon: 'pulse', hue: 'orange', label: L('观察与审批', 'Under review'), value: procs ? pipeline.length : null, hint: L('等待积累或人工确认', 'Awaiting evidence or approval') }),
          h(Iter5Stat, { icon: 'library', hue: 'blue', label: L('事实记忆', 'Facts'), value: facts ? facts.size : null, hint: L('宿主提取的事实记录', 'Facts extracted by the host') }),
          h(Iter5Stat, { icon: 'timeline', hue: 'purple', label: L('经历记录', 'Episodes'), value: epis ? epis.size : null, hint: L('已有的执行与反馈经验', 'Recorded actions and outcomes') })),
        h('div', { className: 'i5-filter-chips', role: 'group', 'aria-label': L('技能筛选', 'Skill filter') }, [['all', L('全部', 'All')], ['pending', L('观察与审批', 'Under review')], ['active', L('已生效', 'Active')]].map(function (r) { return h('button', { key: r[0], 'aria-pressed': i5Filter[0] === r[0], onClick: function () { i5Filter[1](r[0]) } }, r[1]) })),
        h('div', { className: 'i5-hosted i5-skills-grid', 'data-dam-slot': 'timeline', 'data-dam-flow': '' }, rows.filter(function (node) {
          var title = node && node.props && node.props.title
          if (typeof title !== 'string') return true
          if (i5Filter[0] === 'pending' && title.indexOf(t('hubSkills')) === 0) return false
          if (i5Filter[0] === 'active' && title.indexOf(L('技能审批队列', 'Skill approval queue')) === 0) return false
          return true
        })))`)
// ★2026-09-28 收窄（所有者反馈「小面板在暗色下仍是乳白不透明，切回经典就正常」）：
//   原实现把皮肤 token 挂到**全部覆盖层**上，而 token 块里除了 --i5-* 还包含四行
//   **宿主别名改写**（--dsw-alias-label-primary / bg-layer-1 / bg-layer-2 / border-l1），
//   它们指向皮肤的 --i5-text/--i5-bg/--i5-surface/--i5-line。轻面板（[data-dam-panel]）
//   自身正是用 --dsw-alias-bg-layer-2 画背景 ⇒ 被强行换成皮肤的浅色 --i5-surface(#FFFFFF)
//   ⇒ 暗色下也呈乳白不透明；深色那条只覆盖 --i5-*、不改 --dsw-alias-*，故救不回来。
//   修法：**只给向导（[data-dam-tour]）挂 token** —— 实测皮肤样式表里唯一真正消费 --i5-*
//   的覆盖层就是向导（标题/正文/开关/按钮等十余条规则）；轻面板与自动接续卡不需要，
//   让它们保留宿主自己的 --dsw-alias-*（本就随主题自适应，且自带液态玻璃）。
const overlayRoots = '[data-dam-tour]'
const css = readFileSync(path.join(root, 'skins/iter5/skin.css'), 'utf8').trim()
  .replace('[data-iter5]{--i5-blue:', '[data-iter5],body:has([data-iter5]) :is(' + overlayRoots + '){--i5-blue:')
  .replace('[data-iter5][data-deep=true]{--i5-blue:', '[data-iter5][data-deep=true],body:has([data-iter5][data-deep=true]) :is(' + overlayRoots + '){--i5-blue:')
  .replaceAll('body:has([data-iter5])', 'html:has(#dam-skin-v4-style)')
  // 深色判据：优选用皮肤镜像到 <html> 的权威标记 `[data-i5-deep=true]`（见 ui.js 的同步 effect，
  // 它合并了「皮肤三态偏好 + 宿主主题」，比猜宿主类名更准）；同时保留宿主三重标记兜底
  // （皮肤未挂载时镜像不跑，但样式表仍在，此时靠宿主标记）。
  .replaceAll('body:has([data-iter5][data-deep=true])', 'html[data-i5-deep=true],html:has(#dam-skin-v4-style):is([data-dsh-theme=dark],[data-theme=dark],.dark)')
const ui = readFileSync(path.join(root, 'skins/iter5/ui.js'), 'utf8').trimEnd() + '\n' + readFileSync(path.join(root, 'skins/iter5/views.js'), 'utf8').trimEnd()
const generated = begin + '\n    var ITER5_CSS = ' + JSON.stringify(css) + '\n' + ui + '\n' + settings + storage + skills + end + '\n'
const seam = '    // ===================== dam-skin:end (v4) ====================='
client = replaceOnce(client, seam, generated + seam)
// Only the opt-in skin mount and its stylesheet gain the new implementation.
client = client.replace("+ DAM_SKIN_V4_CSS + '\\n/* dam-skin:end (v4) */'", "+ DAM_SKIN_V4_CSS + '\\n' + ITER5_CSS + '\\n/* dam-skin:end (v4) */'")
client = client.replace("h(DamSkinV4Page, { nonce: nonce, onExit:", "h(Iter5Page, { nonce: nonce, onExit:")
client = client.replace('try { ensureStyle() } catch', "try { ensureStyle(); if (damSkinActive() === 'v4') damSkinEnsureCss() } catch")
// ★2026-09-28 接缝（幂等）：切回经典时一并撤掉 html 级深浅镜像 `data-i5-deep`。
//   该标记由皮肤写到 <html>（用于给**宿主渲染的轻面板**换色，见 ui.js 的同步 effect）。
//   不移除的话，切回经典后轻面板仍会按皮肤配色渲染（经典档外观被污染）。
//   幂等判据：只在尚未加过该清理时施加；重复运行不会叠加。
{
  const REMOVE_OLD = "        var el = document.getElementById('dam-skin-v4-style')\n        if (el && el.parentNode) el.parentNode.removeChild(el)\n"
  const REMOVE_NEW = REMOVE_OLD + "        document.documentElement.removeAttribute('data-i5-deep')\n"
  if (client.includes("document.documentElement.removeAttribute('data-i5-deep')")) {
    // 已修过，跳过
  } else if (client.includes(REMOVE_OLD)) {
    client = client.replace(REMOVE_OLD, REMOVE_NEW)
  } else {
    throw new Error('Skin teardown seam not found: damSkinRemoveCss shape changed')
  }
}
// Upstream welcome branch called a hook after its early return, causing React #310
// on first replay. Keep the hook unconditional; all tour actions stay unchanged.
// ★2026-09-28 幂等化（本仓已手工修过同一缺陷，见 lib/client.js DialogHost 处的说明注释）：
//   原实现是无条件 `client.replace(...)` —— 若上游/本仓**已经**修好，它会再加一份
//   `var tourDeep = useDeepTheme()`（repeat 声明，`var` 不报错但属于脏代码，且与既有注释分裂）。
//   改为：仅在**尚未修复**时施加，且在两种已知写法下都收敛到「hook 提为无条件 + 渲染处用变量」。
const TOUR_HOOK_BAD = "tourStep === 0 ? h(SkinHero, { slot: 'hero.welcome', deep: useDeepTheme() })"
const TOUR_HOOK_GOOD = "tourStep === 0 ? h(SkinHero, { slot: 'hero.welcome', deep: tourDeep })"
if (client.includes(TOUR_HOOK_BAD)) {
  const alreadyDeclared = /function DialogHost\(\) \{[\s\S]{0,600}?var tourDeep = useDeepTheme\(\)/.test(client)
  if (!alreadyDeclared) {
    client = client.replace('function DialogHost() {\n      var tickPair = useTick()', 'function DialogHost() {\n      var tourDeep = useDeepTheme()\n      var tickPair = useTick()')
  }
  client = client.replace(TOUR_HOOK_BAD, TOUR_HOOK_GOOD)
} else if (!client.includes(TOUR_HOOK_GOOD)) {
  throw new Error('Tour hook seam not found: neither the buggy nor the fixed welcome-tour line is present')
}
const output = client.replace(/\n/g, newline)
if (process.argv.includes('--check')) {
  if (readFileSync(file, 'utf8') !== output) throw new Error('Embedded iter5 skin is stale; run node tools/build-iter5-skin.mjs')
  console.log('iter5 bundle source is up to date')
} else {
  writeFileSync(file, output)
  console.log('Embedded iter5 skin (' + Buffer.byteLength(generated) + ' bytes)')
}
