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
// ★2026-09-30 双皮肤块：legacy（3.2.5 旧款）源从 git 历史取，包 IIFE 后嵌入。
const legacyBegin = '    // ===== ITER5-LEGACY-GENERATED:BEGIN ====='
const legacyEnd = '    // ===== ITER5-LEGACY-GENERATED:END ====='
// ★2026-09-30 双皮肤块：legacy（3.2.5 旧款）源从 **冻结文件** 读，包 IIFE 后嵌入。
//   为什么用冻结文件而不是 `git show`：本生成器会被测试在临时目录里重跑（幂等性验收），
//   那里没有 git 仓库 ⇒ 依赖 git 会让「生成器幂等」这条守卫在 fixture 里失败。
//   冻结源 = ecd3a44（v3.2.5）的生成块原文，路径 skins/legacy/iter5-325.js.frozen。
//   要更新旧款行为：改该文件（它是「旧款皮肤」的单一真源）。
const legacySrc = readFileSync(path.join(root, 'skins/legacy/iter5-325.js.frozen'), 'utf8').split('\r\n').join('\n')
const lbIdx = legacySrc.indexOf('    // ITER5-GENERATED:BEGIN')
const leIdx = legacySrc.indexOf('    // ITER5-GENERATED:END')
const legacyBody = legacySrc.slice(lbIdx, leIdx + '    // ITER5-GENERATED:END'.length)
const legacyWrapped = legacyBegin + '\n' +
  '    // 3.2.5 的「新款」皮肤（用户裁定的默认）。整体包 IIFE：内部仍用原来的 Iter5* 名字，' + '\n' +
  '    // 作用域隔离 ⇒ 与三套变体块零冲突；只导出 page/css 两个跨块符号。' + '\n' +
  '    var LEGACY_SKIN_NS = (function () {' + '\n' +
  legacyBody.split('\n').map(function (l) { return l ? '  ' + l : l }).join('\n') + '\n' +
  '      return { page: Iter5Page, css: ITER5_CSS }' + '\n' +
  '    })()' + '\n' +
  '    var Legacy5Page = LEGACY_SKIN_NS.page' + '\n' +
  '    var LEGACY_ITER5_CSS = LEGACY_SKIN_NS.css' + '\n' +
  legacyEnd + '\n'
const legacyKnob = [
  "    // ★2026-09-30（用户裁定）：默认旧款（3.2.5 新款皮肤）；三套变体经下拉选择。",
  "    var DAM_SKIN_STYLE_KEY = 'dam-skin-style'",
  "    var DAM_SKIN_VARIANT_IDS = ['legacy', 'instrument', 'editorial', 'water']",
  "    function damSkinStyleGet() {",
  "      try {",
  "        var raw = String(localStorage.getItem(DAM_SKIN_STYLE_KEY) || '')",
  "        if (DAM_SKIN_VARIANT_IDS.indexOf(raw) >= 0) return raw",
  "        return 'legacy'",
  "      } catch (eStyle) { return 'legacy' }",
  "    }",
  "    function damSkinLegacy() { return damSkinStyleGet() === 'legacy' }",
  "    function damSkinStyleSet(name) {",
  "      try {",
  "        var v = DAM_SKIN_VARIANT_IDS.indexOf(String(name)) >= 0 ? String(name) : 'legacy'",
  "        localStorage.setItem(DAM_SKIN_STYLE_KEY, v)",
  "      } catch (eStyle2) {}",
  "    }",
  "",
].join('\n')
// 摘除旧 legacy 块（如有）
if (client.includes(legacyBegin)) {
  const li = client.indexOf(legacyBegin)
  const lj = client.indexOf(legacyEnd, li)
  client = client.slice(0, li) + client.slice(lj + legacyEnd.length + 1)
}
// 摘除旧新块（如有）——legacy 块内部含同名标记，故必须在 legacy 摘除之后定位
if (client.includes(begin)) {
  const b2 = client.indexOf(begin)
  const e2 = client.indexOf(end, b2)
  if (b2 >= 0) client = client.slice(0, b2) + client.slice(e2 + end.length + 1)
}
function replaceOnce(text, old, value) {
  if (text.split(old).length !== 2) throw new Error('Expected exactly one settings seam: ' + old.slice(0, 90))
  return text.replace(old, value)
}
let settings = client.slice(client.indexOf('    function SettingsPage() {'), client.indexOf('    // ───────────────────────── 插件挂载'))
settings = replaceOnce(settings, 'function SettingsPage()', 'function Iter5Settings(props)')
settings = replaceOnce(settings, '      var tickPair = useTick()', `      var tickPair = useTick()
      var i5Group = useState(props && props.intent && ['engine', 'memory', 'appearance', 'behavior'].indexOf(props.intent.group) >= 0 ? props.intent.group : 'engine')
      var i5Base = useRef(null)
      var i5Draft = useRef({})
      var i5Groups = useRef({})
      var i5Alive = useRef(true)
      var i5Identity = iter5Identity()
      var i5DraftKey = i5Identity + '|' + (props && props.draftScope || 'workbench')
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
        if (Object.keys(i5Draft.current).length) iter5SettingsDrafts[i5DraftKey] = { patch: Object.assign({}, i5Draft.current), groups: Object.assign({}, i5Groups.current), base: Object.assign({}, i5Base.current) }
        else delete iter5SettingsDrafts[i5DraftKey]
      }
      function i5Cancel() { delete iter5SettingsDrafts[i5DraftKey]; i5Draft.current = {}; i5Groups.current = {}; setCfg(Object.assign({}, i5Base.current)); setDirty(false); setErr(''); setMsg('') }`)
settings = replaceOnce(settings, '          setCfg(d.config)', `          if (!i5Ok()) return
          i5Base.current = configOf(d)
          var recovered = iter5SettingsDrafts[i5DraftKey]
          if (recovered) {
            i5Draft.current = Object.assign({}, recovered.patch); i5Groups.current = Object.assign({}, recovered.groups)
            setCfg(Object.assign({}, configOf(d), recovered.patch)); setDirty(true)
            setMsg(L('已恢复此会话未保存的修改，请核对后保存或取消。', 'Unsaved edits for this session were restored. Review before saving or discarding.'))
            var conflict = Object.keys(recovered.patch).some(function (key) { return JSON.stringify(configOf(d)[key]) !== JSON.stringify(recovered.base[key]) })
            if (conflict) setErr(L('部分设置已在其他入口变更；恢复的草稿尚未覆盖服务器，请核对。', 'Some settings changed elsewhere. Restored edits have not overwritten the server; review them.'))
          } else setCfg(configOf(d))`)
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
            delete iter5SettingsDrafts[i5DraftKey]
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
        var plain = iter5SettingCopy(label)
        var shownLabel = plain ? plain.label : label
        if (control && (control.type === 'input' || control.type === 'select' || control.type === 'textarea')) control = React.cloneElement(control, { 'aria-label': shownLabel, disabled: busy || control.props.disabled, role: control.type === 'input' && control.props.type === 'checkbox' ? 'switch' : undefined })
        return`)
settings = replaceOnce(settings, "return h('div', { 'data-dam-settings-row': '' },", "return h('div', { 'data-dam-settings-row': '', 'data-i5-field': label },")
settings = replaceOnce(settings,
  "h('div', { 'data-dam-slot': 'list', 'data-dam-row': '' }, h('label', null, label), control),\n          hint ? h('div', { 'data-dam-slot': 'hint', 'data-dam-hint': '' }, hint) : null)",
  `h('div', { 'data-dam-slot': 'list', 'data-dam-row': '', className: 'i5-setting-field', 'data-wide': String(!!control && (control.type !== 'input' && control.type !== 'select' || control.props.type === 'text')) },
            h('div', { className: 'i5-setting-copy' }, h('label', null, shownLabel), plain ? h('div', { 'data-dam-hint': '' }, plain.summary) : hint ? (function () {
              if (typeof hint !== 'string') return h('div', { 'data-dam-slot': 'hint', 'data-dam-hint': '' }, hint)
              var cut = hint.indexOf('。'), tail = cut + 1
              if (cut < 0) { cut = hint.indexOf('. '); tail = cut + 2 }
              if (cut < 8 || cut >= hint.length - 2) return h('div', { 'data-dam-slot': 'hint', 'data-dam-hint': '' }, hint)
              var lead = hint.slice(0, tail)
              return h('div', { 'data-dam-slot': 'hint', 'data-dam-hint': '' }, h('span', { className: 'i5-hint-lead' }, lead), h('details', { className: 'i5-hint-more' }, h('summary', null, L('详细说明', 'Details')), h('span', null, hint.slice(tail))))
            })() : null),
            h('div', { className: 'i5-setting-control' }, control)))`)
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
        if (key === 'window' && content[0] && content[0].props['data-i5-field'] === t('fPromptSections')) {
          var promptEntry = React.cloneElement(content[0], { 'data-i5-advanced-entry': 'true' })
          content = content.slice(2).concat([promptEntry, content[1]])
        }
        if (key === 'auto') content = content.filter(function (node) { if (node && node.props && node.props['data-i5-field'] === t('fWelcomeTour')) { i5WelcomeControl = node; return false } return true })
        if (key === 'look' && i5WelcomeControl) content = [i5WelcomeControl].concat(content)
        var hidden = i5GroupsDef[i5Group[0]].indexOf(key) < 0
        if (key === 'engine') {
          var mode = [], primary = [], advanced = [], support = []
          content.forEach(function (node) {
            if (!node) return
            var label = node.props && node.props['data-i5-field']
            if (label === t('semMode')) mode.push(node)
            else if (label === t('fAssocEngine') || label === t('fEmitMode')) primary.push(node)
            else if (label) advanced.push(node)
            else support.push(node)
          })
          return h('div', { id: 'dam-settings-' + key, className: 'i5-engine-grid', hidden: hidden },
            h(Iter5Card, { title: L('让 AI 想起相关的事', 'Recall relevant memories'), icon: 'pulse', hue: 'green' }, primary),
            h(Iter5Card, { className: 'i5-mode-card', title: L('如何查找记忆', 'How to find memories'), icon: 'search', hue: 'blue' }, mode),
            h('details', { className: 'i5-settings-advanced i5-setup-card', open: !!guide || detOpen }, h('summary', null, L('安装与检查查找工具', 'Install and check search tools')), support),
            h('details', { className: 'i5-settings-advanced' }, h('summary', null, L('进阶：回忆频率、准确度与索引维护', 'Advanced: recall frequency, matching and index maintenance')), advanced))
        }
        var titles = { window: L('把已有记忆交给 AI', 'Give AI existing memories'), capacity: L('记录对话与保留内容', 'Record conversations and keep content'), skills: L('从经历中积累可复用流程', 'Build reusable workflows'), handoff: L('长对话换窗口后继续', 'Continue long tasks in a new session'), auto: L('免打扰与定时整理', 'Quiet mode and scheduled upkeep'), store: L('记忆文件保存在哪里', 'Where memory files are stored'), look: L('显示与操作习惯', 'Display and interaction'), team: L('与团队共享记忆', 'Share memory with a team'), skin: L('自定义插画素材', 'Custom illustration assets') }
        title = titles[key] || title
        var common = { window: ['fInject', 'fBudget', 'fDays'], capacity: ['fAutoConsolidate', 'fConsolidate', 'fConsolidateMax'], skills: ['fMemoryHub', 'fProcInject', 'fProcRisk'], handoff: ['fHandoff', 'fAutoContinue'], auto: ['fAutoPopup', 'fUnattended', 'fUnattendedAuto', 'fAutoSum', 'fConsSchedule', 'fConsScheduleTime', 'fConsScheduleDays', 'fMaintSchedule', 'fMaintScheduleTime'], store: ['fMemoryRoot', 'fUserDir', 'fProjectDir'], look: ['fWelcomeTour', 'fLocale', 'fFontSize', 'fPanelPos'] }
        if (common[key]) {
          var basic = [], extra = [], extrasStarted = false
          content.forEach(function (node) {
            if (!node) return
            var label = node.props && node.props['data-i5-field']
            if (label) extrasStarted = !common[key].some(function (k) { return t(k) === label })
            ;(extrasStarted ? extra : basic).push(node)
          })
          if (key === 'capacity') basic.sort(function (a, b) { return common[key].map(t).indexOf(a.props['data-i5-field']) - common[key].map(t).indexOf(b.props['data-i5-field']) })
          content = basic.concat(extra.length ? [h('details', { className: 'i5-settings-advanced' }, h('summary', null, L('进阶选项：', 'Advanced: ') + title), extra)] : [])
        }
        var icons = { window: 'library', capacity: 'storage', skills: 'skills', handoff: 'handoff', auto: 'timeline', store: 'folder', look: 'settings', team: 'mindmap', skin: 'spark', about: 'note' }
        var subs = {}
        return h('section', { id: 'dam-settings-' + key, 'data-dam-settings-group': '', hidden: hidden }, h('h3', { className: 'i5-card-title' }, h('span', { className: 'i5-badge', 'data-hue': key === 'skills' ? 'green' : key === 'handoff' ? 'cyan' : key === 'auto' ? 'orange' : 'blue' }, h(Iter5Icon, { name: icons[key] || 'settings' })), h('span', { className: 'i5-card-title-txt' }, title, subs[key] ? h('span', { className: 'i5-card-sub' }, subs[key]) : null)), content)
      }`)
settings = replaceOnce(settings, "      return h('div', { 'data-dam-settings': '' },", `      return h('div', { 'data-dam-settings': '', 'data-i5-dirty': dirty ? 'true' : 'false' },
        h(Iter5Tabs, { id: 'i5-settings', label: L('设置分组', 'Settings groups'), value: i5Group[0], onChange: i5Group[1], items: [['engine', L('引擎', 'Engine')], ['memory', L('记忆', 'Memory')], ['appearance', L('外观与目录', 'Appearance & paths')], ['behavior', L('行为与维护', 'Behavior & maintenance')]].map(function (r) { return [r[0], r[1], Object.keys(i5Groups.current).some(function (k) { return i5Groups.current[k] === r[0] })] }) }),`)
settings = replaceOnce(settings, "h('div', { 'data-dam-settings-content': '' },", "h('div', { 'data-dam-settings-content': '', role: 'tabpanel', id: 'i5-settings-panel', 'aria-labelledby': 'i5-settings-tab-' + i5Group[0] }, iter5SettingsIntro(i5Group[0]),")
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
// Save actions are a sibling of the scrolling content, never an overlay on a field.
const savebarStart = settings.indexOf("        h('div', { 'data-dam-savebar':")
const savebarEnd = settings.indexOf('        // 调试中心(折叠)', savebarStart)
if (savebarStart < 0 || savebarEnd < 0) throw Error('Settings savebar boundary not found')
const savebar = settings.slice(savebarStart, savebarEnd).trimEnd().replace(/,$/, '')
settings = settings.slice(0, savebarStart) + settings.slice(savebarEnd)
settings = replaceOnce(settings, "err ? h('div', { 'data-dam-error': '' }, err) : null))", "err ? h('div', { 'data-dam-error': '' }, err) : null),\n" + savebar + ')')
settings = replaceOnce(settings, "L('有未保存的更改', 'Unsaved changes')", "String(new Set(Object.keys(i5Groups.current).map(function (k) { return i5Groups.current[k] })).size) + L(' 个分区有未保存修改', ' sections with unsaved changes')")
settings = replaceOnce(settings, "apiPost(API.semanticEmit, { mode: m }).then(function () { refreshSem(setSem) }).catch(function () {})", "apiPost(API.semanticEmit, { mode: m }).then(function () { if (i5Ok()) refreshSem(setSem) }).catch(function (e) { if (i5Ok()) setErr(e.message) })")
settings = settings.replace("'tauHi 0.45 · tauLo 0.35 · deltaExp 0.03 · deltaPro 0.05'", "L('阈值由宿主校准策略管理；当前接口未提供有效数值', 'Thresholds are managed by the host policy; current values are unavailable')")
settings = replaceOnce(settings, "try { openDialog({ kind: 'welcomeTour' }) } catch (eTour) {}", "try { openManualWelcomeTourPre() } catch (eTour) {}")
// Avoid global selector collisions with the classic settings surface.
settings = replaceOnce(settings, "return h('div', { style: panelStyle }, kids)", `return h(Iter5Dialog, { title: L('子代理模型与思考强度', 'Subagent model and reasoning'), onClose: function () { setMdlOpen(false) } },
          h('div', { 'data-native-model-picker': '' }, kids.slice(1)),
          h('p', { className: 'i5-muted' }, L('选择会保留在设置草稿中，保存更改后生效。', 'Selections stay in the settings draft until you save changes.')))`)
settings = replaceOnce(settings, "key: '__default__', 'data-dam-slot'", "key: '__default__', 'aria-pressed': !cfg.subagentModel, 'data-dam-slot'")
settings = replaceOnce(settings, "key: p.id + '/' + m.id, 'data-dam-slot'", "key: p.id + '/' + m.id, 'aria-pressed': cfg.subagentModel === m.id && cfg.subagentProvider === p.id, 'data-dam-slot'")
settings = replaceOnce(settings, "key: 'eff-' + row[0] + '-' + (o[0] || 'def'), 'data-dam-slot'", "key: 'eff-' + row[0] + '-' + (o[0] || 'def'), 'aria-pressed': cur === o[0], 'data-dam-slot'")
settings = replaceOnce(settings, "key: '__manual__', 'data-dam-slot'", "key: '__manual__', 'aria-label': L('手动输入模型', 'Manual model ID'), 'data-dam-slot'")
settings = replaceOnce(settings, "browseOpen ? h('div', { style:", "browseOpen ? h(Iter5Dialog, { title: L('选择记忆目录', 'Choose memory directory'), onClose: function () { setBrowseOpen(false) } }, h('div', { 'data-native-path-browser': '', style:")
settings = replaceOnce(settings, "onClick: function () { setBrowseOpen(false) } }, t('close'))))\n            : null", "onClick: function () { setBrowseOpen(false) } }, t('close')))))\n            : null")
settings = replaceOnce(settings, "}, '📁 ' + d.name)", "}, h(Iter5Icon, { name: 'folder' }), d.name)")
settings = replaceOnce(settings, "return h('div', { style: { border: '1px solid color-mix(in srgb, var(--dam-accent, #2456c4) 40%, transparent)'", "return h('div', { 'data-native-engine-guide': guide, style: { border: '1px solid color-mix(in srgb, var(--dam-accent, #2456c4) 40%, transparent)'")
settings = settings.replaceAll("id: 'dam-settings-'", "id: 'i5-settings-section-'")
// Host settings stay native; workbench appearance controls belong in their named group.
settings = replaceOnce(settings, "h('div', { 'data-dam-settings-content': '',", "props && props.draftScope === 'host' && i5Group[0] === 'appearance' ? h('div', { className: 'i5-workbench-appearance' }, h('strong', null, L3('工作台外观', 'Workbench appearance', 'ワークベンチの外観')), h(Iter5StylePicker), h(Iter5ModePicker)) : null, h('div', { 'data-dam-settings-content': '',")
// Instance-local tabs/sections avoid collisions when host and workbench settings coexist.
settings = settings.replace('var i5Group = useState', "var i5SettingsId = useRef('i5-settings-' + (++iter5SettingsSequence)).current\n      var i5Group = useState")
settings = settings.replaceAll("'i5-settings'", 'i5SettingsId').replaceAll("'i5-settings-panel'", "i5SettingsId + '-panel'").replaceAll("'i5-settings-tab-'", "i5SettingsId + '-tab-'").replaceAll("'i5-settings-section-'", "i5SettingsId + '-section-'")
let storage = client.slice(client.indexOf('    function StorageTab(props) {'), client.indexOf('    function NotesTab() {'))
storage = replaceOnce(storage, 'function StorageTab(props)', 'function Iter5Storage(props)')
storage = storage.replaceAll(".then(function (r) { return r.json() })", ".then(function (r) { return r.json().then(function (j) { if (!r.ok || (j && j.error)) throw Error(j && (j.error || j.reason) || 'Request failed'); return j }) })")
storage = replaceOnce(storage, "      var delPair = useState('')", "      var deleteRequest = useState(null)\n      var delPair = useState('')")
storage = replaceOnce(storage, "      function act(action, payload, onDone) {\n        setMsg('')", `      function act(action, payload, onDone, confirmed) {
        if (action === 'delete' && !confirmed) { deleteRequest[1]({ payload: payload, onDone: onDone }); return }
        if (action === 'repair' && !window.confirm(L('确认仅重建以下文件的索引副本（正文不变）？', 'Rebuild index copies for these files? Source text is unchanged.') + '\\n' + (payload.items || []).map(function (s) { return s.file || s.sourceRef }).join('\\n'))) return
        setMsg('')`)
storage = replaceOnce(storage, "            setMsg(action + ': ' + reason)\n            if (onDone) onDone(j)", `            setMsg(action + ': ' + reason + (j && j.cascade ? ' · cascade: ' + JSON.stringify(j.cascade) : ''))
            if (j && j.ok !== false && onDone) onDone(j)`)
const sourcesStart = storage.indexOf("          (data.sources || []).map(function (s) {")
const sourcesEnd = storage.indexOf("          h('div', { style: { display: 'flex', gap: '6px', marginTop: '8px' } },", sourcesStart)
if (sourcesStart < 0 || sourcesEnd < 0) throw Error('Storage source-list boundary not found')
storage = storage.slice(0, sourcesStart) + "          h(Iter5StorageSources, { data: data, act: act }),\n" + storage.slice(sourcesEnd)
const migrationStart = storage.indexOf('    var migOutPlaceholder = ')
const migrationEnd = storage.indexOf("    rows.push(h('div', { 'data-dam-slot': 'timeline', 'data-dam-flow': '' }, migRows))", migrationStart)
if (migrationStart < 0 || migrationEnd < 0) throw Error('Migration view boundary not found')
storage = storage.slice(0, migrationStart) + `    var migRows = h(Iter5Migration, {
      out: migOut, setOut: setMigOut, outPicking: migOutPicking,
      pickOut: function () { migPickInto(setMigOut, setMigOutPicking) }, onExport: function () { migExport() },
      pack: migPack, setPack: function (value) { setMigPack(value); setMigPlan(null); setMigResult(null) }, packPicking: migPackPicking,
      pickPack: function () { migPickInto(function (value) { setMigPack(value); setMigPlan(null); setMigResult(null) }, setMigPackPicking) },
      onPreview: function () { migPreview(migConflict) }, plan: migPlan, onCancelPreview: function () { setMigPlan(null) },
      conflict: migConflict, setConflict: function (value) { setMigConflict(value); migPreview(value) }, onApply: migApply,
      busy: migBusy, error: migErr, message: migNote, result: migResult
    })
` + storage.slice(migrationEnd)
storage = replaceOnce(storage, 'function migPreview() {', 'function migPreview(conflict) {')
storage = replaceOnce(storage, "apiPost(API.migrateInspect, { packPath: migPack, targetWs: currentWs() || undefined })", "apiPost(API.migrateInspect, { packPath: migPack, targetWs: currentWs() || undefined, onConflict: conflict || migConflict })")
storage = replaceOnce(storage, "return h('div', { 'data-dam-slot': 'timeline', 'data-dam-flow': '' }, rows)", `return h('div', { className: 'i5-storage-view i5-panel i5-instrument' }, h(Iter5Screws),
        deleteRequest[0] ? h(Iter5DeleteConfirmation, { payload: deleteRequest[0].payload, onClose: function () { deleteRequest[1](null) }, onConfirm: function () { var pending = deleteRequest[0]; deleteRequest[1](null); act('delete', pending.payload, pending.onDone, true) } }) : null,
        h('div', { className: 'i5-stats i5-stats-four' },
          h(Iter5Stat, { icon: 'storage', hue: 'blue', label: L('扫描来源', 'Scanned sources'), value: data.counts ? counts.total : null, hint: L('当前语料来源数', 'Current corpus sources') }),
          h(Iter5Stat, { icon: 'check', hue: 'green', label: L('索引一致', 'Consistent'), value: data.indexEnabled === false ? null : data.counts ? counts.ok : null, hint: data.indexEnabled === false ? L('索引尚未启用', 'Index disabled') : L('正文与索引校验一致', 'Source and index agree') }),
          h(Iter5Stat, { icon: 'pulse', hue: 'orange', label: L('等待修复', 'Needs repair'), value: data.indexEnabled === false ? null : data.counts ? counts.stale : null, hint: L('可以重建的索引副本', 'Rebuildable index copies') }),
          h(Iter5Stat, { icon: 'note', hue: 'purple', label: L('需人工检查', 'Needs inspection'), value: data.indexEnabled === false ? null : data.counts ? counts.unrepairable : null, hint: L('无法自动修复的来源', 'Sources needing manual review') })),
        h('div', { className: 'i5-maintenance-grid', 'data-dam-slot': 'timeline', 'data-dam-flow': '' }, rows.map(function (node, i) { return node && node.props && node.props.title === L('删除记忆(三联动)', 'Delete memory (cascading)') ? h('div', { key: i, className: 'i5-maintenance-danger' }, node) : node })))`)
let skills = client.slice(client.indexOf('    function MemoryHubTab(props) {'), client.indexOf('    function StorageTab(props) {'))
skills = replaceOnce(skills, 'function MemoryHubTab(props)', 'function Iter5Skills(props)')
skills = replaceOnce(skills, "      function hubAct(action, procedureId, v) {", `      function hubAct(action, procedureId, v) {
        var names = { promote: L('晋升技能', 'Promote skill'), approve: L('人工批准技能', 'Approve skill'), 'force-promote': L('强制晋升技能', 'Force promotion'), activate: L('激活技能', 'Activate skill'), deprecate: L('弃用技能', 'Deprecate skill') }
        if (names[action] && !window.confirm(names[action] + '？' + L('此操作将改变技能的可用状态。', 'This changes the skill availability.'))) return`)
skills = replaceOnce(skills, "h(SkinEmpty, { slot: 'empty.library', size: skinSlotSize('empty.library') }, t('hubSkillsEmpty'))", "h(Iter5Empty, { title: L('经验，会慢慢长成技能', 'Experience grows into skills'), text: t('hubSkillsEmpty') })")
skills = replaceOnce(skills, "return h('div', { 'data-dam-slot': 'timeline', 'data-dam-flow': '' }, rows)", `return h('div', { className: 'i5-skills-view i5-panel i5-instrument' }, h(Iter5Screws),
        h('div', { className: 'i5-stats i5-stats-four' },
          h(Iter5Stat, { icon: 'skills', hue: 'green', label: L('已生效技能', 'Active skills'), value: procs ? activeList.length : null, hint: L('可复用的工作方法', 'Reusable working methods') }),
          h(Iter5Stat, { icon: 'pulse', hue: 'orange', label: L('观察与审批', 'Under review'), value: procs ? pipeline.length : null, hint: L('等待积累或人工确认', 'Awaiting evidence or approval') }),
          h(Iter5Stat, { icon: 'library', hue: 'blue', label: L('事实记忆', 'Facts'), value: facts ? facts.size : null, hint: L('宿主提取的事实记录', 'Facts extracted by the host') }),
          h(Iter5Stat, { icon: 'timeline', hue: 'purple', label: L('经历记录', 'Episodes'), value: epis ? epis.size : null, hint: L('已有的执行与反馈经验', 'Recorded actions and outcomes') })),
        h(Iter5SkillBrowser, { active: activeList, pipeline: pipeline, rows: rows }))`)
let stats = client.slice(client.indexOf('function StatsTab() {'), client.indexOf('function WorkspaceTab() {'))
stats = replaceOnce(stats, 'function StatsTab()', 'function Iter5Stats()')
stats = replaceOnce(stats, "return h('div', null,\n    h(Card, { title: t('statsTitle') },", "return h('div', { className: 'i5-native-stats' },\n    h(Iter5StatsOverview, null,")
stats = replaceOnce(stats, "h('div', { style: { display: 'flex', gap: 18, flexWrap: 'wrap', marginTop: 4 } },", "h('div', { className: 'i5-native-stat-metrics' },")
stats = replaceOnce(stats, "return h(Card, { title: m.name },", "return h(Iter5Card, { title: m.name, icon: id === 'model' ? 'search' : id === 'inject' ? 'library' : 'recall', className: 'i5-native-stat-card', 'data-chan': id },")
stats = replaceOnce(stats, "      h('div', { style: { opacity: .72, fontSize: '12px', marginBottom: 2 } }, m.hint),", "      h('div', { className: 'i5-native-stat-hint' }, m.hint),")
// Zero-event channels used to repeat statsNoInject in all three cards; their own hint now carries the empty state.
stats = replaceOnce(stats, "        : h('div', { style: { opacity: .5, fontSize: '12px' } }, t('statsNoInject'))))", "        : ch.events ? h('div', { className: 'i5-native-stat-empty' }, t('statsNoInject')) : null))")
const readSkin = name => readFileSync(path.join(root, 'skins/iter5', name), 'utf8').replace(/\r\n/g, '\n')
const css = (readSkin('skin.css') + '\n' + readSkin('native-tour.css') + '\n' + readSkin('native-panel.css') + '\n' + readSkin('native-settings.css') + '\n' + readSkin('native-workbench.css') + '\n' + readSkin('native-library.css') + '\n' + readSkin('native-operations.css') + '\n' + readSkin('native-secondary.css') + '\n' + readSkin('style-variants.css')).trim()
  .replace('[data-iter5]{--i5-blue:', '[data-iter5],[data-dam-theme]{--i5-blue:')
  .replace('[data-iter5][data-deep=true]{--i5-blue:', '[data-iter5][data-deep=true],[data-dam-theme][data-deep=true],[data-dam-theme][data-deep=true] [data-iter5]{--i5-blue:')
const ui = readSkin('style-choice.js').trimEnd() + '\n' + readSkin('alternate-home.js').trimEnd() + '\n' + readSkin('ui.js').trimEnd() + '\n' + readSkin('views.js').trimEnd() + '\n' + readSkin('surfaces.js').trimEnd() + '\n' + readSkin('native-panel.js').trimEnd() + '\n' + readSkin('native-workbench.js').trimEnd() + '\n' + readSkin('native-search.js').trimEnd() + '\n' + readSkin('native-skills.js').trimEnd() + '\n' + readSkin('native-storage.js').trimEnd() + '\n' + readSkin('native-team.js').trimEnd() + '\n' + readSkin('native-map.js').trimEnd() + '\n' + readSkin('native-messages.js').trimEnd()
settings = settings.replace("L('引擎', 'Engine')", "L('查找与回忆', 'Find & recall')").replace("L('记忆', 'Memory')", "L('记录与使用', 'Record & use')").replace("L('行为与维护', 'Behavior & maintenance')", "L('接续与维护', 'Continue & maintain')")
settings = settings.replace("L('shadow 只记录', 'shadow (record only)')", "L('只观察，不交给 AI', 'Observe only; do not supply to AI')").replace("L('canary 显式回忆注入', 'canary (explicit recall)')", "L('明确要求回忆时提供', 'Supply on explicit recall requests')").replace("L('active 全部注入', 'active (all)')", "L('主动提供相关记忆', 'Proactively supply matching memories')")
settings = settings.replace("L('balanced 3×40', 'balanced 3×40')", "L('平衡：3 条 × 40 字符', 'Balanced: 3 × 40 characters')").replace("L('dense 6×20', 'dense 6×20')", "L('广泛：6 条 × 20 字符', 'Broad: 6 × 20 characters')").replace("L('custom 自定义', 'custom')", "L('自定义', 'Custom')")
settings = settings.replace("['lexical', t('semLexOnly')], ['js', t('semJs')], ['python', t('semPy')]", "['lexical', L('按关键词查找（无需下载模型）', 'Keywords (no model download)')], ['js', L('按意思查找（需本地模型）', 'Meaning (requires a local model)')], ['python', L('Python 搜索工具（需单独安装）', 'Python search tools (separate setup)')]")
const generated = begin + '\n    var ITER5_CSS = ' + JSON.stringify(css) + '\n' + ui + '\n' + readSkin('settings-copy.js') + '\n' + settings + storage + skills + stats + end + '\n'
const seam = '    // ===================== dam-skin:end (v4) ====================='
client = replaceOnce(client, seam, generated + seam)
// Only the opt-in skin mount and its stylesheet gain the new implementation.

client = client.replace("h(DamSkinV4Page, { nonce: nonce, onExit:", "h(Iter5Page, { nonce: nonce, onExit:")
// ★2026-09-30 双皮肤块：插入 legacy 块 + 挂载点双分派 + 样式旋钮
{
  const newBlockAnchor = '    // ITER5-GENERATED:BEGIN'
  if (!client.includes(legacyBegin)) {
    const ni = client.indexOf(newBlockAnchor)
    client = client.slice(0, ni) + legacyWrapped + client.slice(ni)
  }
  if (!client.includes('damSkinLegacy()')) {
    client = client.replace("h('div', { 'data-dam-skin-v4-root': '1' }, h(Iter5Page, { nonce: nonce, onExit: function () { damSkinRemoveCss(); setNonce(nonce + 1) } })))",
      "h('div', { 'data-dam-skin-v4-root': '1' }, damSkinLegacy()\n" +
      "            ? h(Legacy5Page, { nonce: nonce, onExit: function () { damSkinRemoveCss(); setNonce(nonce + 1) } })\n" +
      "            : h(Iter5Page, { nonce: nonce, onExit: function () { damSkinRemoveCss(); setNonce(nonce + 1) } })))")
  }
  if (!client.includes('function damSkinLegacy()')) {
    client = client.replace('    function damSkinSet(name) {', legacyKnob + '    function damSkinSet(name) {')
  }
    // ★2026-09-30（A 批：皮肤可插拔 · 基线永不变）样式表按**当前皮肤**分派——
  //   两份皮肤 CSS 共用 i5-* 命名空间，绝不同时注入；flavor 兼作 data-dam-skin-css 标记值，
  //   换肤时判等失败即重建（修 P0「切皮肤不换样式」）。此处为**从旧基线再生成**的路径。
  if (!client.includes('function damSkinCssFlavor()')) {
    const oldEnsureHead = "      var el = document.getElementById('dam-skin-v4-style')\n      if (el) return\n"
    const newEnsureHead = [
      "      var flavor = damSkinCssFlavor()",
      "      var want = damSkinCssText()",
      "      var el = document.getElementById('dam-skin-v4-style')",
      "      if (el && el.getAttribute('data-dam-skin-css') === flavor) return",
      "      if (el && el.parentNode) el.parentNode.removeChild(el)",
      "      if (!want) return",
      "",
    ].join('\n')
    if (client.includes(oldEnsureHead)) client = client.replace(oldEnsureHead, newEnsureHead)
    const oldText = "el.textContent = '/* dam-skin:begin (v4) */\\n' + DAM_SKIN_V4_CSS + '\\n' + ITER5_CSS + '\\n/* dam-skin:end (v4) */'"
    if (client.includes(oldText)) client = client.replace(oldText, 'el.textContent = want')
    const oldMark = "el.setAttribute('data-dam-skin-css', 'v4')"
    if (client.includes(oldMark)) client = client.replace(oldMark, "el.setAttribute('data-dam-skin-css', flavor)")
    const helper = [
      "      function damSkinCssFlavor() {",
      "        if (damSkinActive() === 'classic') return 'classic'",
      "        return damSkinLegacy() ? 'legacy' : 'iter5'",
      "      }",
      "      function damSkinCssText() {",
      "        var flavor = damSkinCssFlavor()",
      "        if (flavor === 'classic') return ''",
      "        if (flavor === 'legacy') return '/* dam-skin:begin (legacy) */\\n' + DAM_SKIN_V4_CSS + '\\n' + LEGACY_ITER5_CSS + '\\n/* dam-skin:end (legacy) */'",
      "        return '/* dam-skin:begin (v4) */\\n' + DAM_SKIN_V4_CSS + '\\n' + ITER5_CSS + '\\n/* dam-skin:end (v4) */'",
      "      }",
      "",
    ].join('\n')
    if (!client.includes('function damSkinCssText()')) client = client.replace('    function damSkinEnsureCss() {', helper + '    function damSkinEnsureCss() {')
  }
}

client = client.replace('try { ensureStyle() } catch', "try { ensureStyle(); if (damSkinActive() !== 'classic') damSkinEnsureCss() } catch")
// Upstream welcome branch called a hook after its early return, causing React #310
// on first replay. Keep the hook unconditional; all tour actions stay unchanged.
if (!/function DialogHost\(\) \{[\s\S]{0,1800}?var tourDeep = use(?:Iter5|Deep)Theme\(\)/.test(client)) client = client.replace('function DialogHost() {\n      var tickPair = useTick()', 'function DialogHost() {\n      var tourDeep = useDeepTheme()\n      var tickPair = useTick()')
client = client.replace("tourStep === 0 ? h(SkinHero, { slot: 'hero.welcome', deep: useDeepTheme() })", "tourStep === 0 ? h(SkinHero, { slot: 'hero.welcome', deep: tourDeep })")
// Welcome artwork must follow the same explicit light/dark preference as its portal.
client = client.replace('var tourDeep = useDeepTheme()', 'var tourDeep = useIter5Theme()')
// ★2026-09-30（D2 · 用户裁定「设置页必须全量同步」）——两个 I5 实例补「广播即重取」effect。
//   为什么放生成器而不是手改 client.js：Iter5Settings（宿主面板 + 工作台页两个实例）是**生成产物**，
//   手改会被下一次再生成覆盖（实测：手插后 --check 报 stale、clean 生成会丢掉该块）。
//   放在这里 ⇒ 与 damSkinActive/ensureCss 等经典侧 seam 同源，可重生成、可幂等。
//   语义：订阅唯一写出口 saveConfigPatch 的广播（见 client.js 内 emit），任何入口保存成功后重取远端配置；
//   三条安全线 —— 有未保存草稿时只提示不覆盖 / busy 中不重取 / 身份不符（i5Ok 为假）放弃。
const d2Subscribe = [
  "      // ★2026-09-30（D2 · 用户裁定「设置页必须全量同步」）：订阅唯一写出口的广播（见 saveConfigPatch 内 emit）。",
  "      //   两个入口此前各持挂载时快照 ⇒ A 保存后 B 还是旧值；现在任何地方保存成功即重取远端配置。",
  "      //   三条安全线：①有未保存草稿时不覆盖用户输入（只提示）；②busy 中不重取；③身份不符放弃。",
  "      useEffect(function () {",
  "        return controller.subscribe(function () {",
  "          if (busy) return",
  "          if (!i5Ok()) return",
  "          apiGet(API.config).then(function (d) {",
  "            if (!i5Ok()) return",
  "            var remote = configOf(d)",
  "            i5Base.current = remote",
  "            if (Object.keys(i5Draft.current).length) {",
  "              var changed = Object.keys(i5Draft.current).filter(function (key) { return JSON.stringify(remote[key]) !== JSON.stringify(i5Draft.current[key]) })",
  "              if (changed.length) setMsg(L(\"检测到其他入口的修改：\", \"Changes detected from another entry: \") + changed.join(\", \") + L(\"。你的未保存输入未被覆盖。\", \" Your unsaved edits were not overwritten.\"))",
  "              setCfg(function (prev) { return Object.assign({}, remote, i5Draft.current) })",
  "            } else {",
  "              setCfg(remote)",
  "              setDirty(false)",
  "            }",
  "          }).catch(function () {})",
  "        })",
  "      }, [busy])",
  ""
].join("\n")
// 幂等标记：进入生成前的快照里没有该注释才注入（对本脚本读入的 client 变量判一次即可）。
if (!client.includes('订阅唯一写出口的广播')) {
  const aliveAnchor = "        return function () { i5Alive.current = false; window.removeEventListener('beforeunload', before) }\n      }, [])"
  if (!client.includes(aliveAnchor)) throw new Error('D2: i5Alive anchor missing')
  client = client.replace(aliveAnchor, aliveAnchor + '\n' + d2Subscribe)
  // 第二个 I5 实例缩进多两级（生成块内嵌更深）
  const aliveAnchor2 = "          return function () { i5Alive.current = false; window.removeEventListener('beforeunload', before) }\n        }, [])"
  if (client.includes(aliveAnchor2)) client = client.replace(aliveAnchor2, aliveAnchor2 + '\n' + d2Subscribe.replace(/^      /gm, '        '))
}


// ★2026-09-30（F 批 · 用户报「切回 3.2.5 基线后，新手引导/更新日志/左下浮窗仍被三套新皮肤污染」）
//   根因：两处 Iter5Surface（冻结基线块 + 变体生成块）的共享样式 effect **无条件**注入 ITER5_CSS
//   （三套变体的样式表，40,000 B / 228 条 .i5- 规则）。而模块级注册的浮层（shell.overlay 面板与弹窗、
//   conversation.view、settings.section）用的正是这个 Surface ⇒ 只要插件加载过，变体 CSS 就常驻
//   <head>，与当前选的是基线还是变体**无关**。修：按当前皮肤分派 —— 仅 flavor=iter5 注入变体表；
//   基线(legacy)/经典(classic)一律不注入。
//   为什么放生成器：这两处都在生成区内（手改会被下一次再生成覆盖，--check 也会判 stale）。
// ★2026-09-30（H3-1 取代 F6）：F6/H1 的注入点已被 H3-1 收敛为「单一出口」并整体重写，
//   其标记注释随之消失 ⇒ 二次再生成时若无此行会因 hits!==2 抛错、或用旧形态回填。
//   保留原块仅为「从更早基线重放」时的兼容路径；已被 H3-1 处理过的树直接跳过。
if (!client.includes('F6 · 共享样式按皮肤分派') && !client.includes('H3-1 · 共享浮层样式表单一出口')) {
  const sharedAnchor = /^(\s*)var style = document\.getElementById\('dam-shared-ui-style'\)$/gm
  const hits = (client.match(sharedAnchor) || []).length
  if (hits !== 2) throw new Error('F6: expected 2 shared-style anchors, got ' + hits)
  client = client.replace(sharedAnchor, function (line, indent) {
    return [
      indent + '// ★2026-09-30（F 批 · 共享样式按皮肤分派）：仅 iter5 档注入变体样式表；基线/经典不注入。',
      indent + "//   否则引导/更新日志/左下浮窗（模块级浮层，恒用本 Surface）会被三套新皮肤污染。",
      indent + "var damFlavor = 'classic'",
      indent + 'try { damFlavor = damSkinCssFlavor() } catch (eF6) {}',
      indent + 'if (damFlavor !== \'iter5\') return function () {}',
      line,
    ].join('\n')
  })
}

// ★2026-09-30（H1 · 用户实测三项残留）：F 批的「非 iter5 一律不注入」把**模块级浮层**变成无样式 ——
//   · DSH 设置页里的插件设置区（settings.section）：classic/legacy 档下无任何皮肤样式 ⇒ 布局崩坏；
//   · 左下角记忆窗格（kind=panel）与新手引导/更新日志（kind=dialogs）：掉回宿主默认底（蓝底），
//     丢失「新款（经典）」的液态玻璃。
//   根因：这三面共用同一套 i5-* 标记，样式表却只有一个 `#dam-shared-ui-style`，且**恒为变体表**。
//   F 批为避免污染把它整个停注，等于把「有样式但不该有」换成「该有却没有」。
//   修法：按**当前皮肤**投放对应表 —— 变体档→ITER5_CSS；新款（经典）/传统档→LEGACY_ITER5_CSS（冻结 3.2.5 原表）。
//   设置页用户已裁定「可调整为新版一致」，故 classic 档同样拿到 3.2.5 表，而不是空表。
if (!client.includes('H1 · 外层三面按皮肤分派') && !client.includes('H3-1 · 共享浮层样式表单一出口')) {
  const f6Head = /^(\s*)\/\/ ★2026-09-30（F 批 · 共享样式按皮肤分派）[^\n]*\n\1\/\/[^\n]*\n\1var damFlavor = 'classic'\n\1try \{ damFlavor = damSkinCssFlavor\(\) \} catch \(eF6\) \{\}\n\1if \(damFlavor !== 'iter5'\) return function \(\) \{\}\n/gm
  const f6Hits = (client.match(f6Head) || []).length
  if (f6Hits !== 2) throw new Error('H1: expected 2 F6 heads, got ' + f6Hits)
  let h1Seq = 0
  client = client.replace(f6Head, function (_m, indent) {
    h1Seq += 1
    if (h1Seq === 1) {
      // 冻结块（Legacy5Page 自用）：其**局部** ITER5_CSS 就是 3.2.5 原表 ⇒ 恒注入即可。
      return [
        indent + '// ★2026-09-30（H1 · 冻结块）：本块局部的 ITER5_CSS 即 3.2.5 原表 ⇒ 恒注入，不再按档位停注。',
        indent + '//   停注会让同屏叠加的浮层失去这份老标记的样式（用户实测：设置区崩坏/窗格蓝底）。',
      ].join('\n') + '\n'
    }
    // 外层块（shell.overlay ×3 + settings.section 共用本 Surface）：按当前皮肤投放。
    return [
      indent + '// ★2026-09-30（H1 · 外层三面按皮肤分派）：按**当前皮肤**投放样式表 ——',
      indent + '//   变体档→ITER5_CSS；新款（经典）/传统档→LEGACY_ITER5_CSS（冻结 3.2.5 原表，含液态玻璃）。',
      indent + '//   根因：F 批「非 iter5 一律不注入」使引导/更新日志/左下窗格/设置区**无任何皮肤样式** ⇒',
      indent + '//   设置区崩坏、窗格掉回宿主蓝底。停注 ≠ 去污染。',
      indent + 'var damSharedCss = ITER5_CSS',
      indent + "try { damSharedCss = damSkinCssFlavor() === 'iter5' ? ITER5_CSS : LEGACY_ITER5_CSS } catch (eH1) {}",
    ].join('\n') + '\n'
  })
  // 外层块的 textContent 改用 damSharedCss（第 2 处；第 1 处属冻结块，保持原样）
  const txtRe = /^(\s*)style\.textContent = ITER5_CSS$/gm
  const txtHits = (client.match(txtRe) || []).length
  if (txtHits !== 2) throw new Error('H1: expected 2 textContent lines, got ' + txtHits)
  let txtSeq = 0
  client = client.replace(txtRe, function (line) {
    txtSeq += 1
    return txtSeq === 2 ? line.replace('ITER5_CSS', 'damSharedCss') : line
  })
  // 已存在的共享表须随换肤刷新内容（原实现只在缺失时创建 ⇒ 换肤后内容不更新）
  const usersRe = /^(\s*)style\.dataset\.users = String\(Number\(style\.dataset\.users \|\| 0\) \+ 1\)$/gm
  const usersHits = (client.match(usersRe) || []).length
  if (usersHits !== 2) throw new Error('H1: expected 2 users lines, got ' + usersHits)
  let usersSeq = 0
  client = client.replace(usersRe, function (line) {
    usersSeq += 1
    if (usersSeq !== 2) return line
    const ind = /^(\s*)/.exec(line)[1]
    return ind + 'if (style.textContent !== damSharedCss) style.textContent = damSharedCss' + '\n' + line
  })
}
// ★2026-09-30（H3-1 · 共享浮层样式表单一出口）
//   实测根因：两处 Iter5Surface 各自判档、抢同一个 `#dam-shared-ui-style` 节点 ——
//     冻结块（L10935 起）只判 `if (!style)` 且**从不同步内容**；生成块（L13274 起）才同步。
//     ⇒ 「先挂载者定内容」，结果随挂载顺序漂移（同一档位可能拿到另一档的表）。
//   次因：判档三元式在两处各写一份 ⇒ 加档位必漏改一处（本项目已多次踩「同源多写」）。
//   修法：①判档收敛为模块级纯函数 `damSharedSurfaceCss()`（唯一真源，加档只改这一处）；
//        ②两处 effect 一律「问它 + 无条件同步」—— 谁先挂载都收敛到同一张表。
//   ★判据纪律（用户明确要求，勿退回序号式）：
//     定位只按**语义特征**（块内含 `dam-shared-ui-style`），**不按出现次序**；
//     数量断言用 `>= 1`（不写 `!== 2`）—— 序号式判据在块增减/重排后必然错位，
//     而错位时静态断言仍可能全绿（本项目已有同类事故）。
if (!client.includes('H3-1 · 共享浮层样式表单一出口')) {
  // ① 判档真源：置于 damSkinCssFlavor 同层（模块级），两处 Surface（含生成块内）均可解析。
  const h31Single = [
    '    // ★2026-09-30（H3-1 · 共享浮层样式表单一出口）：共享浮层样式表的**唯一判档真源**。',
    '    //   两处 Iter5Surface 一律问它；加档位只改这里，不再散写三元式。',
    '    function damSharedSurfaceCss() {',
    "      var damSurfaceFlavor = 'legacy'",
    '      try { damSurfaceFlavor = damSkinCssFlavor() } catch (eH3) {}',
    "      if (damSurfaceFlavor === 'iter5') return ITER5_CSS",
    "      if (damSurfaceFlavor === 'legacy') return LEGACY_ITER5_CSS",
    "      return ''",
    '    }',
    '',
  ].join('\n')
  const h31Anchor = '    function damSkinEnsureCss() {'
  if (!client.includes('function damSharedSurfaceCss()')) {
    if (!client.includes(h31Anchor)) throw new Error('H3-1: damSkinEnsureCss anchor missing')
    client = client.replace(h31Anchor, h31Single + h31Anchor)
  }

  // ② 两处 effect 归一（按语义特征匹配：块内含 dam-shared-ui-style）
  const h31EffectRe = /^([ \t]*)useEffect\(function \(\) \{[\s\S]*?\n\1\}, \[\]\)$/gm
  let h31Rewritten = 0
  client = client.replace(h31EffectRe, function (whole, indent) {
    if (!whole.includes('dam-shared-ui-style')) return whole
    h31Rewritten += 1
    return [
      indent + 'useEffect(function () {',
      indent + '  // ★2026-09-30（H3-1 · 单一出口）：内容一律问 damSharedSurfaceCss()，并**无条件同步**；',
      indent + '  //   两个 Surface 谁先挂载都收敛到同一张表，消除「先挂者定内容」的漂移。',
      indent + '  var damWantCss = damSharedSurfaceCss()',
      indent + '  if (!damWantCss) return function () {}',
      indent + "  var style = document.getElementById('dam-shared-ui-style')",
      indent + '  if (!style) {',
      indent + "    style = document.createElement('style')",
      indent + "    style.id = 'dam-shared-ui-style'",
      indent + "    style.dataset.plugin = '@a9i5k4/dsh-auto-memory'",
      indent + '    style.textContent = damWantCss',
      indent + '    document.head.appendChild(style)',
      indent + '  }',
      indent + '  if (style.textContent !== damWantCss) style.textContent = damWantCss',
      indent + '  style.dataset.users = String(Number(style.dataset.users || 0) + 1)',
      indent + '  return function () {',
      indent + '    var count = Number(style.dataset.users || 1) - 1',
      indent + '    style.dataset.users = String(count)',
      indent + '    if (!count) style.remove()',
      indent + '  }',
      indent + '}, [])',
    ].join('\n')
  })
  if (h31Rewritten < 1) throw new Error('H3-1: no shared-style effect matched (expect >=1)')
  // 守恒（不写死数量）：真源定义 1 处 + 每个被重写 effect 各 1 次调用
  const h31Refs = (client.match(/damSharedSurfaceCss\(\)/g) || []).length
  if (h31Refs !== h31Rewritten + 1) throw new Error('H3-1: expected ' + (h31Rewritten + 1) + ' refs, got ' + h31Refs)
  // 负路径：旧形态不得残留（只判代码形态，避免被自己的注释喂饱）
  if (/damSkinCssFlavor\(\)\s*===\s*'iter5'\s*\?\s*ITER5_CSS/.test(client)) throw new Error('H3-1: inline flavor ternary survived')
  if (/if \(style\.textContent !== damSharedCss\)/.test(client)) throw new Error('H3-1: H1 leftover sync line survived')
  console.log('H3-1: ' + h31Rewritten + ' shared-style effect(s) collapsed onto one source of truth')
}
const output = client.replace(/\n/g, newline)
if (process.argv.includes('--check')) {
  if (readFileSync(file, 'utf8') !== output) throw new Error('Embedded iter5 skin is stale; run node tools/build-iter5-skin.mjs')
  console.log('iter5 bundle source is up to date')
} else {
  writeFileSync(file, output)
  console.log('Embedded iter5 skin (' + Buffer.byteLength(generated) + ' bytes)')
}
