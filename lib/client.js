/* dsh-auto-memory — browser half (hand-written __ModuleLoader__ bundle).
 * Registers three additive surfaces:
 *   1. sidebar.footer.action — 「记忆」入口按钮(开关左下角浮层面板)
 *   2. shell.overlay         — 记忆面板:概览 / 日志 / 笔记 / 反思 / 检索
 *                              液态玻璃视觉(backdrop-filter + --dsw-alias-* 主题令牌),
 *                              可拖动 / 右下角缩放 / 开关缩放动画 / 位置大小持久化。
 *   3. settings.section      — 自动记忆设置页(存储位置、注入、反思风格)
 * Data flows over /api/dsh-auto-memory/* (loopback-only host routes).
 */
window.__ModuleLoader__.load({
  id: '@a9i5k4/dsh-auto-memory',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    var React = require('react')
    var h = React.createElement
    var useState = React.useState
    var useEffect = React.useEffect
    var useReducer = React.useReducer

    // ───────────────────────── 控制器 ─────────────────────────
    var listeners = new Set()
    var panelOpen = false
    var panelClosing = false
    var closeTimer = null
    // 几何状态:left/top/width/height,持久化到 localStorage(用户可拖动/缩放)
    var GEOM_KEY = 'dsh-auto-memory.panel.geom'
    var DEFAULT_W = 440
    var DEFAULT_H = 560
    var DEFAULT_GAP = 16
    function defaultGeom() {
      var vh = window.innerHeight || 800
      return {
        left: DEFAULT_GAP,
        top: Math.max(DEFAULT_GAP, vh - DEFAULT_H - DEFAULT_GAP),
        width: DEFAULT_W,
        height: DEFAULT_H,
      }
    }
    var geom = null
    function clampGeom(g) {
      var vw = window.innerWidth || 1280
      var vh = window.innerHeight || 800
      var w = Math.max(300, Math.min(g.width || DEFAULT_W, vw - DEFAULT_GAP * 2))
      var h = Math.max(240, Math.min(g.height || DEFAULT_H, vh - DEFAULT_GAP * 2))
      return {
        left: Math.max(DEFAULT_GAP, Math.min(g.left !== undefined ? g.left : DEFAULT_GAP, vw - w - DEFAULT_GAP)),
        top: Math.max(DEFAULT_GAP, Math.min(g.top !== undefined ? g.top : DEFAULT_GAP, vh - h - DEFAULT_GAP)),
        width: w,
        height: h,
      }
    }
    function loadGeom() {
      try {
        var raw = localStorage.getItem(GEOM_KEY)
        if (raw) return clampGeom(JSON.parse(raw))
      } catch (e) {}
      return clampGeom(defaultGeom())
    }
    function persistGeom() { if (geom) { try { localStorage.setItem(GEOM_KEY, JSON.stringify(geom)) } catch (e) {} } }
    function emit() { listeners.forEach(function (fn) { try { fn() } catch (e) {} }) }
    var controller = {
      isOpen: function () { return panelOpen },
      isClosing: function () { return panelClosing },
      geom: function () { if (!geom) geom = loadGeom(); return geom },
      setGeom: function (partial) {
        var cur = controller.geom()
        geom = clampGeom({
          left: partial.left !== undefined ? partial.left : cur.left,
          top: partial.top !== undefined ? partial.top : cur.top,
          width: partial.width !== undefined ? partial.width : cur.width,
          height: partial.height !== undefined ? partial.height : cur.height,
        })
        emit()
      },
      flushGeom: function () { persistGeom() },
      resetGeom: function () { geom = clampGeom(defaultGeom()); persistGeom(); emit() },
      toggle: function () { if (panelOpen) controller.close(); else controller.open() },
      open: function () {
        if (closeTimer) { clearTimeout(closeTimer); closeTimer = null }
        panelOpen = true; panelClosing = false; emit()
      },
      close: function () {
        if (!panelOpen || panelClosing) return
        panelClosing = true; emit()
        closeTimer = setTimeout(function () {
          panelOpen = false; panelClosing = false; closeTimer = null; emit()
        }, 170)
      },
      subscribe: function (fn) { listeners.add(fn); return function () { listeners.delete(fn) } },
    }

    // ───────────────────────── 国际化 ─────────────────────────
    var I18N = {
      zh: {
        loading: '加载中…',
        memoryPanel: '记忆面板',
        memory: '记忆',
        autoMemory: '自动记忆',
        overview: '概览', logs: '日志', notes: '笔记', reflections: '反思', connect: '接续', search: '检索',
        refresh: '刷新', close: '关闭', dragMove: '拖动移动', dragResize: '拖动调整大小', resetPos: '恢复默认位置',
        generated: '已生成', failed: '失败: ',
        pendingReflection: '待生成反思: ',
        pendingReflectionHint: ' —— 可点下方「一键反思」立即生成。',
        todayWork: '今日工作', logEntries: ' 条日志',
        dailyReflection: '每日反思', notYet: '(还没有)',
        workspace: '工作区',
        reflecting: '反思生成中…', oneClickReflect: '一键反思',
        reflectHint: '用最近日志自动生成反思',
        quickLinks: '快捷入口:日志页签看每日记录 · 笔记页签追加项目笔记 · 接续页签接入其他 AI 记忆 · 检索页签全文搜索。',
        collapseTech: '收起技术信息 ▴', expandTech: '技术信息 ▾',
        userMemory: '用户级记忆', projectNotes: '项目笔记', todayLog: '今日日志', configFile: '配置文件',
        readFailed: '读取失败: ', ok: '正常', refreshTime: '刷新时间', notYetShort: '尚未',
        empty: '(空)', back: '← 返回', view: '查看',
        clickDateViewLog: '点击日期查看当日日志(append-only):',
        appended: '已追加', notesPathLabel: '项目笔记: ',
        notesPlaceholder: '想追加到项目笔记的内容…(保存时自动带日期标题)',
        saving: '保存中…', append: '追加',
        notesHint: '建议直接用对话让 agent 调 memory_note;此处为手动追加。',
        reflectionTitle: '反思 ', generating: '生成中…',
        reflectAutoHint: '自动用最近日志生成反思草稿(便于测试)',
        noReflection: '还没有反思。每天第一次会话时,agent 会主动呈现前一天的工作反思。',
        searchFailed: '检索失败: ', searchPlaceholder: '搜记忆:关键词或自包含描述…', searchBtn: '检索', resultTitle: '结果',
        projectFiles: '项目文件', aiAssistant: 'AI 助手',
        imported: '接入完成', importing: '正在接入 ', importingSuffix: ' 个源…', allImported: '全部接入完成',
        noExternal: '未检测到其他 AI 工具的记忆文件(CodeBuddy/Claude Code/Codex 等)。',
        sessionSource: '会话源:共 ', sessionSourceSuffix: ' 个会话文件,用 memory_recall 按需检索',
        importingOne: '接入中…', importToNotes: '接入项目笔记', importToUser: '接入用户记忆',
        disabled: ' · 已停用', filesCount: ' 个文件 · ',
        connectHint: '把其他 AI 工具(CodeBuddy / Claude Code / Codex / 项目约定文件等)积累的记忆接入当前 DSH 工作。接入后内容写入本地记忆并自动标注来源,后续会随会话自动注入。',
        importAll: '一键接入全部', rescan: '重新扫描',
        styleAuto: '由内容决定', styleLife: '生活化', styleProfessional: '专业性',
        todayGreetingTitle: '问候',
        yesterdayTimeline: '昨天(', pendingReflectionShort: '昨天的工作还没复盘(',
        saved: '已保存',
        settingsHeader: '记忆存储与行为设置(保存到 DSH 主目录 dsh-auto-memory.json):',
        fUserDir: '用户记忆目录', fUserDirHint: '跨项目规则存放处,支持 ~ 开头;需有文件写权限。',
        fProjectDir: '项目记忆目录', fProjectDirHint: '相对各工作区的目录名(默认 .dsh-memory)。',
        fInject: '注入记忆上下文', fInjectHint: '每次组装提示词时自动注入 <memory_system> 块。',
        fBudget: '注入预算(字符)', fBudgetHint: '记忆块总预算,超出部分截断。',
        fDays: '注入最近日志天数', fDaysHint: '会话开始时注入最近 N 天的工作日志尾部。',
        fReflect: '每日反思', fReflectHint: '昨天有工作日志时,会话首轮主动呈现昨日反思。',
        fStyle: '反思风格', fStyleHint: '生活化 / 专业性 / 由内容决定。',
        fLocale: '界面语言', fLocaleHint: '切换插件面板与设置页的显示语言。',
        saveSettings: '保存设置',
        zh: '中文', en: 'English',
        calendar: '日历', addItem: '添加', save: '保存', cancel: '取消', needTitle: '请填写事项标题', itemTitle: '事项标题…',
        segMorning: '早晨', segForenoon: '上午', segNoon: '中午', segAfternoon: '下午', segEvening: '晚上',
        segPrefix: '今日', segMorningHint: '(昨日摘要)',
        welcomeBack: '欢迎回来!这段时间你完成了这些工作:',
        yesterdayDrawer: '昨天',
        greetMorning: '新的一天开始啦,先看看昨天做了什么。', greetForenoon: '上午好,今天也在稳步推进。', greetNoon: '中午好,歇口气再继续。', greetAfternoon: '下午好,下午也要元气满满。', greetEvening: '晚上好,辛苦一天了。',
        greetSummary: '今天已经完成了 ', greetThings: ' 件工作,点开看看:',
        qUrgentImportant: '重要紧急', qImportant: '重要不紧急', qUrgent: '紧急不重要', qNone: '不重要不紧急', qUncategorized: '未分类',
      },
      en: {
        loading: 'Loading…',
        memoryPanel: 'Memory Panel',
        memory: 'Memory',
        autoMemory: 'Auto Memory',
        overview: 'Overview', logs: 'Logs', notes: 'Notes', reflections: 'Reflections', connect: 'Connect', search: 'Search',
        refresh: 'Refresh', close: 'Close', dragMove: 'Drag to move', dragResize: 'Drag to resize', resetPos: 'Reset position',
        generated: 'Generated', failed: 'Failed: ',
        pendingReflection: 'Pending reflection: ',
        pendingReflectionHint: ' — click "One-click Reflect" below to generate now.',
        todayWork: 'Today', logEntries: ' log entries',
        dailyReflection: 'Daily reflection', notYet: '(none yet)',
        workspace: 'Workspace',
        reflecting: 'Generating…', oneClickReflect: 'One-click Reflect',
        reflectHint: 'Auto-generate reflection from recent logs',
        quickLinks: 'Quick access: Logs tab for daily records · Notes tab to append project notes · Connect tab to import AI memories · Search tab for full-text search.',
        collapseTech: 'Collapse details ▴', expandTech: 'Details ▾',
        userMemory: 'User memory', projectNotes: 'Project notes', todayLog: 'Today log', configFile: 'Config file',
        readFailed: 'Read failed: ', ok: 'OK', refreshTime: 'Refreshed', notYetShort: 'never',
        empty: '(empty)', back: '← Back', view: 'View',
        clickDateViewLog: 'Click a date to view the daily log (append-only):',
        appended: 'Appended', notesPathLabel: 'Project notes: ',
        notesPlaceholder: 'Content to append to project notes…(date heading added on save)',
        saving: 'Saving…', append: 'Append',
        notesHint: 'Tip: ask the agent to call memory_note in chat; this is a manual fallback.',
        reflectionTitle: 'Reflection ', generating: 'Generating…',
        reflectAutoHint: 'Auto-generate a reflection draft from recent logs (for testing)',
        noReflection: "No reflections yet. On the first session each day, the agent presents the previous day's reflection.",
        searchFailed: 'Search failed: ', searchPlaceholder: 'Search memory: keyword or self-contained description…', searchBtn: 'Search', resultTitle: 'Results',
        projectFiles: 'Project files', aiAssistant: 'AI Assistant',
        imported: 'Imported', importing: 'Importing ', importingSuffix: ' sources…', allImported: 'All imported',
        noExternal: 'No memory files found from other AI tools (CodeBuddy/Claude Code/Codex etc.).',
        sessionSource: 'Session source: ', sessionSourceSuffix: ' session files, search on demand with memory_recall',
        importingOne: 'Importing…', importToNotes: 'Import to notes', importToUser: 'Import to user memory',
        disabled: ' · disabled', filesCount: ' files · ',
        connectHint: 'Import memories accumulated by other AI tools (CodeBuddy / Claude Code / Codex / project convention files) into the current DSH workspace. Imported content is written to local memory with its source noted, and is auto-injected in future sessions.',
        importAll: 'Import all', rescan: 'Rescan',
        styleAuto: 'Auto', styleLife: 'Life-style', styleProfessional: 'Professional',
        todayGreetingTitle: 'Greeting',
        yesterdayTimeline: 'Yesterday (', pendingReflectionShort: 'Yesterday\'s work not reviewed (',
        saved: 'Saved',
        settingsHeader: 'Memory storage & behavior (saved to ~/.dsh/dsh-auto-memory.json):',
        fUserDir: 'User memory dir', fUserDirHint: 'Cross-project rules; supports ~ prefix; needs write permission.',
        fProjectDir: 'Project memory dir', fProjectDirHint: 'Directory name relative to each workspace (default .dsh-memory).',
        fInject: 'Inject memory context', fInjectHint: 'Auto-inject <memory_system> block into every prompt.',
        fBudget: 'Injection budget (chars)', fBudgetHint: 'Total budget for the memory block; excess is truncated.',
        fDays: 'Recent days injected', fDaysHint: 'Inject tails of the last N days of work logs at session start.',
        fReflect: 'Daily reflection', fReflectHint: 'When yesterday has logs, the agent presents the reflection at session start.',
        fStyle: 'Reflection style', fStyleHint: 'Life-style / Professional / Auto.',
        fLocale: 'UI language', fLocaleHint: 'Switch the display language of the panel and settings page.',
        saveSettings: 'Save settings',
        zh: '中文', en: 'English',
        calendar: 'Calendar', addItem: 'Add', save: 'Save', cancel: 'Cancel', needTitle: 'Title is required', itemTitle: 'Item title…',
        segMorning: 'Morning', segForenoon: 'Forenoon', segNoon: 'Noon', segAfternoon: 'Afternoon', segEvening: 'Evening',
        segPrefix: 'Today ', segMorningHint: ' (yesterday summary)',
        welcomeBack: 'Welcome back! While you were away, you finished:',
        yesterdayDrawer: 'Yesterday',
        greetMorning: 'A fresh day! Let us look back at yesterday first.', greetForenoon: 'Good morning, steady progress today.', greetNoon: 'Good noon, take a break and keep going.', greetAfternoon: 'Good afternoon, keep up the good energy.', greetEvening: 'Good evening, well done today.',
        greetSummary: 'You have completed ', greetThings: ' things today. Tap to expand:',
        qUrgentImportant: 'Urgent & Important', qImportant: 'Important', qUrgent: 'Urgent', qNone: 'Neither', qUncategorized: 'Uncategorized',
      }
    }
    var locale = 'zh'
    var localeListeners = new Set()
    function t(key) { return (I18N[locale] && I18N[locale][key]) || I18N.zh[key] || key }
    function setLocale(l) { if (l !== 'zh' && l !== 'en') return; if (l === locale) return; locale = l; localeListeners.forEach(function (fn) { try { fn(l) } catch (e) {} }) }
    function onLocale(fn) { localeListeners.add(fn); return function () { localeListeners.delete(fn) } }

    // ───────────────────────── API ─────────────────────────
    var API = {
      state: '/api/dsh-auto-memory/state',
      list: '/api/dsh-auto-memory/list',
      file: '/api/dsh-auto-memory/file',
      recall: '/api/dsh-auto-memory/recall',
      config: '/api/dsh-auto-memory/config',
      reflect: '/api/dsh-auto-memory/reflect',
      reflectAuto: '/api/dsh-auto-memory/reflect-auto',
      note: '/api/dsh-auto-memory/note',
      external: '/api/dsh-auto-memory/external',
      externalImport: '/api/dsh-auto-memory/external-import',
    }
    function query(params) {
      var search = new URLSearchParams()
      for (var key in params) if (params[key] !== undefined && params[key] !== '') search.set(key, String(params[key]))
      var text = search.toString()
      return text ? '?' + text : ''
    }
    async function apiGet(path, params) {
      var res = await fetch(path + query(params))
      var body = await res.json().catch(function () { return {} })
      if (!res.ok) throw new Error(body.error || ('HTTP ' + res.status))
      return body
    }
    async function apiPost(path, payload) {
      var res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
      var body = await res.json().catch(function () { return {} })
      if (!res.ok) throw new Error(body.error || ('HTTP ' + res.status))
      return body
    }

    // ───────────────────────── 样式 ─────────────────────────
    // 视觉:液态玻璃(毛玻璃)—— backdrop-filter + DSH 主题令牌(--dsw-alias-*),
    // 跟随亮/暗主题与页面背景自适应;位置/尺寸由 JS 几何状态驱动(可拖动、可缩放)。
    var CSS = [
      '[data-dam-panel] { position: fixed; left: 16px; width: 440px; height: 560px;',
      '  max-width: calc(100vw - 32px); max-height: calc(100vh - 32px);',
      '  display: flex; flex-direction: column; overflow: hidden; z-index: 3000; pointer-events: auto;',
      '  border-radius: 16px; font: 13px/1.55 system-ui, "Segoe UI", sans-serif;',
      '  background: color-mix(in srgb, var(--dsw-alias-bg-overlay, rgba(255,255,255,.86)) 58%, transparent);',
      '  -webkit-backdrop-filter: blur(28px) saturate(1.55); backdrop-filter: blur(28px) saturate(1.55);',
      '  border: 1px solid color-mix(in srgb, var(--dsw-alias-border-l1, rgba(128,128,128,.35)) 65%, transparent);',
      '  box-shadow: 0 24px 64px rgba(0,0,0,.22), 0 4px 16px rgba(0,0,0,.10), inset 0 1px 0 rgba(255,255,255,.22);',
      '  color: var(--dsw-alias-label-primary, #1f2328);',
      '  animation: dam-in .2s cubic-bezier(.2,.9,.3,1.15) both; transform-origin: left bottom; }',
      '@keyframes dam-in { from { opacity: 0; transform: scale(.92) translateY(10px); } to { opacity: 1; transform: none; } }',
      '@keyframes dam-out { from { opacity: 1; transform: none; } to { opacity: 0; transform: scale(.95) translateY(6px); } }',
      '[data-dam-panel][data-closing="true"] { animation: dam-out .16s ease-in both; }',
      '[data-dam-panel]::before { content: ""; position: absolute; inset: 0 0 auto 0; height: 64%; pointer-events: none;',
      '  background: linear-gradient(180deg, rgba(255,255,255,.13), rgba(255,255,255,0) 70%); border-radius: 16px 16px 0 0; }',
      '[data-dam-panel][data-dragging="true"] { user-select: none; }',
      '[data-dam-panel] header { display: flex; align-items: center; gap: 8px; padding: 10px 14px; cursor: grab;',
      '  border-bottom: 1px solid color-mix(in srgb, var(--dsw-alias-border-l1, rgba(128,128,128,.25)) 55%, transparent); }',
      '[data-dam-panel][data-dragging="true"] header { cursor: grabbing; }',
      '[data-dam-panel] header strong { font-size: 14px; }',
      '[data-dam-panel] header .dam-spacer { flex: 1; }',
      '[data-dam-resize] { position: absolute; right: 0; bottom: 0; width: 22px; height: 22px; cursor: nwse-resize;',
      '  opacity: .55; z-index: 2; border-radius: 0 0 16px 0;',
      '  background: linear-gradient(135deg, transparent 50%, color-mix(in srgb, var(--dsw-alias-label-secondary, #666) 45%, transparent) 50%); }',
      '[data-dam-resize]:hover { opacity: 1; }',
      '[data-dam-btn] { border: none; background: transparent; cursor: pointer; color: inherit; opacity: .75; font-size: 13px; padding: 4px 8px; border-radius: 6px; }',
      '[data-dam-btn]:hover { opacity: 1; background: color-mix(in srgb, var(--dsw-alias-label-secondary, #666) 16%, transparent); }',
      '[data-dam-tabs] { display: flex; gap: 2px; padding: 6px 10px; border-bottom: 1px solid color-mix(in srgb, var(--dsw-alias-border-l1, rgba(128,128,128,.2)) 55%, transparent); }',
      '[data-dam-tab] { border: none; background: transparent; cursor: pointer; color: inherit; opacity: .6; padding: 5px 10px; border-radius: 7px; font-size: 12.5px; }',
      '[data-dam-tab][data-active="true"] { opacity: 1; background: color-mix(in srgb, var(--dsw-alias-label-secondary, #666) 18%, transparent); font-weight: 600; }',
      '[data-dam-body] { flex: 1; overflow: auto; padding: 12px 14px; }',
      '[data-dam-kv] { display: grid; grid-template-columns: auto 1fr; gap: 4px 12px; font-size: 12.5px; }',
      '[data-dam-kv] b { opacity: .55; font-weight: 500; }',
      '[data-dam-card] { border: 1px solid color-mix(in srgb, var(--dsw-alias-border-l1, rgba(128,128,128,.22)) 60%, transparent); border-radius: 9px; padding: 8px 10px; margin-bottom: 8px; font-size: 12.5px;',
      '  background: color-mix(in srgb, var(--dsw-alias-bg-layer-1, rgba(128,128,128,.06)) 40%, transparent); }',
      '[data-dam-card] .dam-date { font-weight: 600; margin-bottom: 4px; }',
      '[data-dam-card] .dam-content { white-space: pre-wrap; word-break: break-word; max-height: 220px; overflow: auto; }',
      '[data-dam-banner] { border: 1px solid color-mix(in srgb, var(--dsw-alias-state-warn-primary, #e6a23c) 55%, transparent);',
      '  background: color-mix(in srgb, var(--dsw-alias-state-warn-primary, #e6a23c) 13%, transparent); border-radius: 9px; padding: 8px 10px; margin-bottom: 10px; font-size: 12.5px; }',
      '[data-dam-input], [data-dam-select] { width: 100%; box-sizing: border-box; background: color-mix(in srgb, var(--dsw-alias-bg-layer-1, rgba(128,128,128,.08)) 45%, transparent); color: inherit; border: 1px solid color-mix(in srgb, var(--dsw-alias-border-l1, rgba(128,128,128,.3)) 60%, transparent); border-radius: 7px; padding: 6px 8px; font: inherit; }',
      '[data-dam-row] { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }',
      '[data-dam-row] label { flex: 0 0 110px; opacity: .8; font-size: 12.5px; }',
      '[data-dam-hint] { opacity: .5; font-size: 11.5px; margin-top: 2px; }',
      '[data-dam-sidebar-btn] { display: flex; align-items: center; gap: 6px; width: 100%; border: none; background: transparent; color: inherit; cursor: pointer; padding: 6px 10px; border-radius: 8px; font: inherit; font-size: 13px; opacity: .8; }',
      '[data-dam-sidebar-btn]:hover { background: color-mix(in srgb, var(--dsw-alias-label-secondary, #666) 14%, transparent); opacity: 1; }',
      '[data-dam-sidebar-btn][data-active="true"] { opacity: 1; background: color-mix(in srgb, var(--dsw-alias-brand-primary, #4f7cff) 16%, transparent); color: var(--dsw-alias-brand-primary, #4f7cff); }',
      '[data-dam-error] { color: var(--dsw-alias-state-error-primary, #d64545); font-size: 12px; margin-top: 6px; white-space: pre-wrap; }',
      '[data-dam-muted] { opacity: .55; }',
      '@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {',
      '  [data-dam-panel] { background: var(--dsw-alias-bg-overlay, #ffffff); } }',
    ].join('\n')
    var STYLE_ID = 'dsh-auto-memory-css'
    function ensureStyle() {
      if (document.getElementById(STYLE_ID)) return
      var tag = document.createElement('style')
      tag.id = STYLE_ID
      tag.dataset.plugin = '@a9i5k4/dsh-auto-memory'
      tag.textContent = CSS
      document.head.appendChild(tag)
    }

    // ───────────────────────── 通用小组件 ─────────────────────────
    function useTick() { return useReducer(function (x) { return x + 1 }, 0) }

    function Banner(props) {
      return h('div', { 'data-dam-banner': '' }, props.children)
    }

    function Card(props) {
      return h('div', { 'data-dam-card': '' },
        h('div', { className: 'dam-date' }, props.title),
        h('div', { className: 'dam-content' }, props.children))
    }

    function Loading() { return h('div', { 'data-dam-muted': '' }, t('loading')) }

    // ───────────────────────── 侧边栏入口 ─────────────────────────
    function SidebarButton() {
      var tick = useTick()
      useEffect(function () { return controller.subscribe(tick[1]) }, [])
      return h('button', {
        'data-dam-sidebar-btn': '',
        title: t('memoryPanel'),
        'data-active': (panelOpen || panelClosing) ? 'true' : undefined,
        onClick: function () { controller.toggle() },
      }, h('span', null, t('memory')))
    }

    // ───────────────────────── 记忆面板 ─────────────────────────
    function fmtSize(n) {
      if (n >= 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB'
      if (n >= 1024) return (n / 1024).toFixed(1) + ' KB'
      return n + ' B'
    }

    function GreetingCard(props) {
      var g = props.greeting
      var ps = props.periodSummary
      if (!g) return null
      var openPair = useState({})
      var openMap = openPair[0]
      var setOpenMap = openPair[1]
      // 智能时段判定
      var hour = new Date().getHours()
      var seg = hour < 9 ? 'morning' : hour < 12 ? 'forenoon' : hour < 14 ? 'noon' : hour < 18 ? 'afternoon' : 'evening'
      var segLabel = { morning: t('segMorning'), forenoon: t('segForenoon'), noon: t('segNoon'), afternoon: t('segAfternoon'), evening: t('segEvening') }[seg]
      // 收集抽屉: {key, label, hint, items, withTime}
      var drawers = []
      var curSegName = { morning: '早晨', forenoon: '上午', noon: '中午', afternoon: '下午', evening: '晚上' }[seg]
      // 昨天抽屉(早晨显示)
      if (seg === 'morning' && g.entries.length) {
        drawers.push({ key: 'yesterday', label: t('yesterdayDrawer') + (g.yesterdayDate || ''), hint: '', items: g.entries, withTime: true, defaultOpen: true })
      }
      // 今天各时段抽屉(已过的时段)
      var seenSeg = { '早晨': seg !== 'morning', '上午': (seg === 'forenoon' || seg === 'noon' || seg === 'afternoon' || seg === 'evening'), '中午': (seg === 'noon' || seg === 'afternoon' || seg === 'evening'), '下午': (seg === 'afternoon' || seg === 'evening'), '晚上': seg === 'evening' }
      var segOrder = ['早晨', '上午', '中午', '下午', '晚上']
      for (var si = 0; si < segOrder.length; si++) {
        var sname = segOrder[si]
        if (!seenSeg[sname]) continue
        var items = (ps && ps.groups && ps.groups[sname]) || []
        if (!items.length) continue
        drawers.push({ key: 'seg-' + sname, label: t('segPrefix') + sname, hint: '', items: items.map(function (x) { return { time: '', text: x } }), withTime: false, defaultOpen: sname === curSegName })
      }
      // 外层:生活化问候
      var totalCount = 0
      for (var d0 = 0; d0 < drawers.length; d0++) totalCount += drawers[d0].items.length
      var greetLine = g.greeting && String(g.greeting).trim()
        ? String(g.greeting).trim()
        : (function () {
          if (away()) return t('welcomeBack')
          var base = { morning: t('greetMorning'), forenoon: t('greetForenoon'), noon: t('greetNoon'), afternoon: t('greetAfternoon'), evening: t('greetEvening') }[seg]
          if (totalCount > 0) base += t('greetSummary') + totalCount + t('greetThings')
          return base
        })()
      // 离开>1小时后回来
      function away() {
        var lastSeen = 0
        try { lastSeen = Number(localStorage.getItem('dsh-auto-memory.lastActive') || 0) } catch (e) {}
        return lastSeen > 0 && (Date.now() - lastSeen) > 3600000
      }
      var rows = []
      rows.push(h('div', { 'data-dam-content': '' }, greetLine))
      // 抽屉列表
      for (var d = 0; d < drawers.length; d++) {
        (function (dr) {
          var isOpen = openMap[dr.key] !== undefined ? openMap[dr.key] : dr.defaultOpen
          rows.push(h('div', { key: dr.key, style: { marginTop: '8px' } },
            h('button', {
              'data-dam-btn': '',
              onClick: function () { var n = Object.assign({}, openMap); n[dr.key] = !isOpen; setOpenMap(n) },
              style: { width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 8px', borderRadius: '7px', background: 'color-mix(in srgb, var(--dsw-alias-bg-layer-1, rgba(128,128,128,.08)) 45%, transparent)', border: '1px solid color-mix(in srgb, var(--dsw-alias-border-l1, rgba(128,128,128,.3)) 50%, transparent)' },
            },
              h('span', { style: { fontWeight: 600, fontSize: '12.5px' } }, (isOpen ? '▼ ' : '▶ ') + dr.label),
              h('span', { 'data-dam-muted': '', style: { fontSize: '11.5px' } }, dr.items.length + t('logEntries'))),
            isOpen ? h('div', { style: { padding: '6px 4px 2px 10px' } },
              dr.items.map(function (en) {
                return h('div', { key: (en.time || '') + en.text, style: { marginBottom: '3px', fontSize: '12.5px', lineHeight: 1.5 } },
                  dr.withTime && en.time ? h('span', { 'data-dam-muted': '', style: { fontFamily: 'monospace', fontSize: '11px', marginRight: '6px' } }, en.time) : null,
                  h('span', { style: { wordBreak: 'break-word' } }, en.text))
              })) : null))
        })(drawers[d])
      }
      // 待反思提醒
      if (g.pendingReflectionDate) {
        rows.push(h('div', { 'data-dam-hint': '', style: { marginTop: '8px' } }, t('pendingReflectionShort') + g.pendingReflectionDate))
      }
      return h(Card, { title: (g.period || '') + ' · ' + segLabel }, rows)
    }

    function OverviewTab() {
      var statePair = useState(null)
      var state = statePair[0]
      var setState = statePair[1]
      var detailPair = useState(false)
      var showDetail = detailPair[0]
      var setShowDetail = detailPair[1]
      var reflectBusyPair = useState(false)
      var reflectBusy = reflectBusyPair[0]
      var setReflectBusy = reflectBusyPair[1]
      var actMsgPair = useState('')
      var actMsg = actMsgPair[0]
      var setActMsg = actMsgPair[1]
      useEffect(function () {
        var alive = true
        apiGet(API.state).then(function (s) { if (alive) setState(s) }).catch(function () {})
        return function () { alive = false }
      }, [])
      useEffect(function () {
        // 记录本次活动时间;下次打开若相隔>1小时,GreetingCard 显示"欢迎回来"
        try { localStorage.setItem('dsh-auto-memory.lastActive', String(Date.now())) } catch (e) {}
      }, [])
      if (!state) return h(Loading)
      function oneClickReflect() {
        if (reflectBusy) return
        setReflectBusy(true); setActMsg('')
        apiPost(API.reflectAuto, {}).then(function (d) {
          setActMsg(d.result || t('generated')); setReflectBusy(false)
          apiGet(API.state).then(function (s) { if (s) setState(s) }).catch(function () {})
        }).catch(function (e) { setActMsg(t('failed') + e.message); setReflectBusy(false) })
      }
      return h('div', null,
        // 今日问候卡:问候语 + 昨天时间轴 + 提醒(纯 GUI 渲染,不干扰对话流)
        h(GreetingCard, { greeting: state.greeting, periodSummary: state.periodSummary, t: t }),
        state.pendingReflection
          ? h(Banner, null, t('pendingReflection') + state.pendingReflection + t('pendingReflectionHint'))
          : null,
        // 状态行:今日工作 / 反思 / 笔记
        h('div', { 'data-dam-kv': '' },
          h('b', null, t('todayWork')), h('span', null, state.todayEntries + t('logEntries')),
          h('b', null, t('dailyReflection')), h('span', null, state.latestReflectionDate || t('notYet')),
          h('b', null, t('workspace')), h('span', null, state.ws)),
        // 快捷操作
        h('div', { 'data-dam-row': '' },
          h('button', { 'data-dam-btn': '', onClick: oneClickReflect, disabled: reflectBusy }, reflectBusy ? t('reflecting') : t('oneClickReflect')),
          h('span', { 'data-dam-hint': '' }, t('reflectHint'))),
        actMsg ? h('div', { 'data-dam-hint': '' }, actMsg) : null,
        h('div', { 'data-dam-hint': '' }, t('quickLinks')),
        // 技术细节(折叠)
        h('div', null,
          h('button', { 'data-dam-btn': '', onClick: function () { setShowDetail(!showDetail) } }, showDetail ? t('collapseTech') : t('expandTech'))),
        showDetail ? h('div', { 'data-dam-kv': '' },
          h('b', null, t('userMemory')), h('span', null, state.userFile + ' (' + fmtSize(state.sizes.user) + ')'),
          h('b', null, t('projectNotes')), h('span', null, state.notesPath + ' (' + fmtSize(state.sizes.notes) + ')'),
          h('b', null, t('todayLog')), h('span', null, state.logPath + ' (' + fmtSize(state.sizes.log) + ')'),
          h('b', null, t('configFile')), h('span', null, state.configReadError ? (t('readFailed') + state.configReadError) : t('ok')),
          h('b', null, t('refreshTime')), h('span', null, state.refreshedAt ? new Date(state.refreshedAt).toLocaleString() : t('notYetShort'))) : null)
    }

    function LogsTab() {
      var dataPair = useState(null)
      var data = dataPair[0]
      var setData = dataPair[1]
      var openPair = useState(null)
      var open = openPair[0]
      var setOpen = openPair[1]
      var contentPair = useState('')
      var content = contentPair[0]
      var setContent = contentPair[1]
      useEffect(function () {
        var alive = true
        apiGet(API.list).then(function (d) { if (alive) setData(d) }).catch(function () {})
        return function () { alive = false }
      }, [])
      useEffect(function () {
        if (!open) return
        var alive = true
        apiGet(API.file, { path: open }).then(function (d) { if (alive) setContent(d.content) }).catch(function () {})
        return function () { alive = false }
      }, [open])
      if (!data) return h(Loading)
      var rows = []
      if (open) {
        rows.push(h(Card, { title: pathName(open) },
          h('div', { 'data-dam-content': '' }, content || t('empty')),
          h('button', { 'data-dam-btn': '', onClick: function () { setOpen(null); setContent('') } }, t('back'))))
      } else {
        rows.push(h('div', { 'data-dam-hint': '' }, t('clickDateViewLog')))
        for (var i = 0; i < data.logs.length; i++) {
          (function (log) {
            rows.push(h(Card, { title: log.date + ' · ' + fmtSize(log.size) },
              h('button', { 'data-dam-btn': '', onClick: function () { setOpen(log.date + '.md') } }, t('view'))))
          })(data.logs[i])
        }
      }
      return h('div', null, rows)
    }
    function pathName(p) { var parts = String(p).split(/[\\/]/); return parts[parts.length - 1] }

    function NotesTab() {
      var dataPair = useState(null)
      var data = dataPair[0]
      var setData = dataPair[1]
      var draftPair = useState('')
      var draft = draftPair[0]
      var setDraft = draftPair[1]
      var savingPair = useState(false)
      var saving = savingPair[0]
      var setSaving = savingPair[1]
      var msgPair = useState('')
      var msg = msgPair[0]
      var setMsg = msgPair[1]
      var errPair = useState('')
      var err = errPair[0]
      var setErr = errPair[1]
      useEffect(function () {
        var alive = true
        apiGet(API.state).then(function (s) { if (alive) setData(s) }).catch(function () {})
        return function () { alive = false }
      }, [])
      if (!data) return h(Loading)
      function save() {
        if (!draft.trim() || saving) return
        setSaving(true); setMsg(''); setErr('')
        apiPost(API.note, { content: draft.trim() }).then(function (d) {
          setMsg(d.result || t('appended')); setDraft(''); setSaving(false)
        }).catch(function (e) { setErr(e.message); setSaving(false) })
      }
      return h('div', null,
        h('div', { 'data-dam-hint': '' }, t('notesPathLabel') + data.notesPath),
        h('textarea', { 'data-dam-input': '', rows: 6, placeholder: t('notesPlaceholder'), value: draft, onChange: function (e) { setDraft(e.target.value) } }),
        h('div', { 'data-dam-row': '' },
          h('button', { 'data-dam-btn': '', onClick: save, disabled: saving }, saving ? t('saving') : t('append')),
          h('span', { 'data-dam-hint': '' }, t('notesHint'))),
        msg ? h('div', null, msg) : null,
        err ? h('div', { 'data-dam-error': '' }, err) : null)
    }

    function ReflectionsTab() {
      var dataPair = useState(null)
      var data = dataPair[0]
      var setData = dataPair[1]
      var openPair = useState(null)
      var open = openPair[0]
      var setOpen = openPair[1]
      var contentPair = useState('')
      var content = contentPair[0]
      var setContent = contentPair[1]
      var busyPair = useState(false)
      var busy = busyPair[0]
      var setBusy = busyPair[1]
      var msgPair = useState('')
      var msg = msgPair[0]
      var setMsg = msgPair[1]
      useEffect(function () {
        var alive = true
        apiGet(API.list).then(function (d) { if (alive) setData(d) }).catch(function () {})
        return function () { alive = false }
      }, [])
      useEffect(function () {
        if (!open) return
        var alive = true
        apiGet(API.file, { path: open }).then(function (d) { if (alive) setContent(d.content) }).catch(function () {})
        return function () { alive = false }
      }, [open])
      if (!data) return h(Loading)
      function oneClickReflect() {
        if (busy) return
        setBusy(true); setMsg('')
        apiPost(API.reflectAuto, {}).then(function (d) {
          setMsg(d.result || t('generated')); setBusy(false)
          apiGet(API.list).then(function (dd) { if (dd) setData(dd) }).catch(function () {})
        }).catch(function (e) { setMsg(t('failed') + e.message); setBusy(false) })
      }
      var rows = []
      if (open) {
        rows.push(h(Card, { title: t('reflectionTitle') + pathName(open) }, h('div', { 'data-dam-content': '' }, content || t('empty'))))
        rows.push(h('button', { 'data-dam-btn': '', onClick: function () { setOpen(null); setContent('') } }, t('back')))
      } else {
        rows.push(h('div', { 'data-dam-row': '' },
          h('button', { 'data-dam-btn': '', onClick: oneClickReflect, disabled: busy }, busy ? t('generating') : t('oneClickReflect')),
          h('span', { 'data-dam-hint': '' }, t('reflectAutoHint'))))
        if (msg) rows.push(h('div', null, msg))
        if (!data.reflections.length) rows.push(h('div', { 'data-dam-muted': '' }, t('noReflection')))
        for (var i = 0; i < data.reflections.length; i++) {
          (function (r) {
            rows.push(h(Card, { title: r.date + ' · ' + fmtSize(r.size) },
              h('button', { 'data-dam-btn': '', onClick: function () { setOpen('reflections/' + r.name) } }, t('view'))))
          })(data.reflections[i])
        }
      }
      return h('div', null, rows)
    }

    function SearchTab() {
      var qPair = useState('')
      var q = qPair[0]
      var setQ = qPair[1]
      var resultPair = useState(null)
      var result = resultPair[0]
      var setResult = resultPair[1]
      var busyPair = useState(false)
      var busy = busyPair[0]
      var setBusy = busyPair[1]
      function search() {
        if (!q.trim() || busy) return
        setBusy(true); setResult(null)
        apiPost(API.recall, { query: q.trim() }).then(function (d) { setResult(d.result); setBusy(false) })
          .catch(function (e) { setResult(t('searchFailed') + e.message); setBusy(false) })
      }
      return h('div', null,
        h('div', { 'data-dam-row': '' },
          h('input', { 'data-dam-input': '', placeholder: t('searchPlaceholder'), value: q, onChange: function (e) { setQ(e.target.value) }, onKeyDown: function (e) { if (e.key === 'Enter') search() } }),
          h('button', { 'data-dam-btn': '', onClick: search, disabled: busy }, t('searchBtn'))),
        result ? h(Card, { title: t('resultTitle') }, h('div', { 'data-dam-content': '' }, result)) : null)
    }

    // ───────────────────────── 日历页签 ─────────────────────────
    var QUADRANT_STYLE = {
      '重要紧急': { color: 'var(--dsw-alias-state-error-primary, #d64545)', label: t('qUrgentImportant') },
      '重要不紧急': { color: 'var(--dsw-alias-brand-primary, #4f7cff)', label: t('qImportant') },
      '紧急不重要': { color: 'var(--dsw-alias-state-warn-primary, #e6a23c)', label: t('qUrgent') },
      '不重要不紧急': { color: 'var(--dsw-alias-label-secondary, #8a94a6)', label: t('qNone') },
      '未分类': { color: 'var(--dsw-alias-label-secondary, #8a94a6)', label: t('qUncategorized') },
    }
    function CalendarTab() {
      var dataPair = useState(null)
      var data = dataPair[0]
      var setData = dataPair[1]
      var monthPair = useState(null)
      var month = monthPair[0]  // {year, mon} 1-12
      var setMonth = monthPair[1]
      var draftPair = useState(null)
      var draft = draftPair[0]  // {date, time, quadrant, title}
      var setDraft = draftPair[1]
      var msgPair = useState('')
      var msg = msgPair[0]
      var setMsg = msgPair[1]
      function load() {
        apiGet(API.calendar).then(function (d) { if (d) setData(d) }).catch(function () {})
      }
      useEffect(function () {
        load()
        var now = new Date()
        setMonth({ year: now.getFullYear(), mon: now.getMonth() + 1 })
      }, [])
      if (!data || !month) return h(Loading)
      function dayEntries(date) {
        return (data.entries || []).filter(function (en) { return en.date === date })
      }
      function moveMonth(delta) {
        var y = month.year, m = month.mon + delta
        if (m < 1) { m = 12; y-- }
        if (m > 12) { m = 1; y++ }
        setMonth({ year: y, mon: m })
      }
      function fmtDate(y, m, d) { return y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0') }
      // 月网格
      var firstDay = new Date(month.year, month.mon - 1, 1)
      var startDow = firstDay.getDay()
      var daysInMonth = new Date(month.year, month.mon, 0).getDate()
      var cells = []
      var today = fmtDate(new Date().getFullYear(), new Date().getMonth() + 1, new Date().getDate())
      for (var i = 0; i < startDow; i++) cells.push(null)
      for (var d = 1; d <= daysInMonth; d++) cells.push(fmtDate(month.year, month.mon, d))
      var dowLabels = locale === 'zh' ? ['日', '一', '二', '三', '四', '五', '六'] : ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
      var rows = []
      // 顶部:月份切换 + 添加按钮
      rows.push(h('div', { 'data-dam-row': '' },
        h('button', { 'data-dam-btn': '', onClick: function () { moveMonth(-1) } }, '◀'),
        h('span', { style: { fontWeight: 700, flex: 1, textAlign: 'center' } }, month.year + ' / ' + String(month.mon).padStart(2, '0')),
        h('button', { 'data-dam-btn': '', onClick: function () { moveMonth(1) } }, '▶'),
        h('button', { 'data-dam-btn': '', onClick: function () { setDraft({ date: today, time: '09:00', quadrant: '重要不紧急', title: '' }) } }, '+ ' + t('addItem'))))
      // 图例
      rows.push(h('div', { 'data-dam-row': '', style: { flexWrap: 'wrap' } },
        Object.keys(QUADRANT_STYLE).map(function (q) {
          return h('span', { key: q, style: { fontSize: '11px', opacity: 0.8, marginRight: '10px' } },
            h('span', { style: { display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: QUADRANT_STYLE[q].color, marginRight: 4 } }), QUADRANT_STYLE[q].label)
        })))
      // 星期表头
      rows.push(h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '3px', marginBottom: '4px' } },
        dowLabels.map(function (dl) { return h('div', { key: dl, style: { textAlign: 'center', fontSize: '11px', opacity: 0.55 } }, dl) })))
      // 日历格子
      var gridRows = []
      for (var ci = 0; ci < cells.length; ci += 7) {
        var week = []
        for (var cj = 0; cj < 7; cj++) {
          (function (cell) {
            if (!cell) { week.push(h('div', { key: 'empty' + cj })); return }
            var es = dayEntries(cell)
            var isToday = cell === today
            var dayNum = Number(cell.slice(8))
            week.push(h('div', {
              key: cell,
              onClick: function () { setDraft({ date: cell, time: '09:00', quadrant: '重要不紧急', title: '' }) },
              style: {
                minHeight: '64px', padding: '4px', cursor: 'pointer', borderRadius: '8px',
                border: '1px solid ' + (isToday ? 'var(--dsw-alias-brand-primary, #4f7cff)' : 'color-mix(in srgb, var(--dsw-alias-border-l1, rgba(128,128,128,.3)) 55%, transparent)'),
                background: isToday ? 'color-mix(in srgb, var(--dsw-alias-brand-primary, #4f7cff) 10%, transparent)' : 'color-mix(in srgb, var(--dsw-alias-bg-layer-1, rgba(128,128,128,.06)) 40%, transparent)',
                overflow: 'hidden',
              },
            },
              h('div', { style: { fontSize: '11.5px', fontWeight: isToday ? 700 : 500, opacity: isToday ? 1 : 0.7, marginBottom: '3px' } }, dayNum),
              es.slice(0, 3).map(function (en) {
                var qs = QUADRANT_STYLE[en.quadrant] || QUADRANT_STYLE['未分类']
                return h('div', {
                  key: en.time + en.title,
                  title: en.time + ' ' + en.title,
                  onClick: function (ev) { ev.stopPropagation(); toggleDone(en) },
                  style: {
                    fontSize: '10.5px', lineHeight: 1.35, padding: '1px 4px', borderRadius: 4, marginBottom: 2,
                    background: 'color-mix(in srgb, ' + qs.color + ' 18%, transparent)',
                    color: qs.color, textDecoration: en.done ? 'line-through' : 'none',
                    opacity: en.done ? 0.5 : 1, cursor: 'pointer', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  },
                }, (en.time && en.time !== '--:--' ? en.time + ' ' : '') + en.title)
              }),
              es.length > 3 ? h('div', { style: { fontSize: '10px', opacity: 0.5 } }, '+' + (es.length - 3)) : null))
          })(cells[ci + cj])
        }
        gridRows.push(h('div', { key: 'w' + ci, style: { display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '3px' } }, week))
      }
      rows.push(h('div', null, gridRows))
      function toggleDone(en) {
        apiPost(API.calendar, { action: en.done ? 'remove' : 'done', date: en.date, time: en.time, title: en.title }).then(function (d) {
          setMsg(d.result || ''); load()
        }).catch(function (e) { setMsg(t('failed') + e.message) })
      }
      function saveDraft() {
        if (!draft || !draft.title.trim()) { setMsg(t('needTitle')); return }
        apiPost(API.calendar, { date: draft.date, time: draft.time, quadrant: draft.quadrant, title: draft.title.trim(), note: draft.note || '' }).then(function (d) {
          setMsg(d.result || t('saved')); setDraft(null); load()
        }).catch(function (e) { setMsg(t('failed') + e.message) })
      }
      // 添加/编辑浮层(液态玻璃)
      if (draft) {
        rows.push(h('div', {
          style: {
            position: 'absolute', inset: 0, zIndex: 10, borderRadius: '16px',
            background: 'color-mix(in srgb, var(--dsw-alias-bg-overlay, rgba(255,255,255,.9)) 70%, transparent)',
            backdropFilter: 'blur(20px) saturate(1.4)', WebkitBackdropFilter: 'blur(20px) saturate(1.4)',
            display: 'flex', flexDirection: 'column', padding: '18px', gap: '10px',
            border: '1px solid color-mix(in srgb, var(--dsw-alias-border-l1, rgba(128,128,128,.35)) 60%, transparent)',
          },
        },
          h('div', { style: { fontWeight: 700 } }, t('addItem') + ' · ' + draft.date),
          h('input', { 'data-dam-input': '', placeholder: t('itemTitle'), value: draft.title, autoFocus: true, onChange: function (e) { var n = Object.assign({}, draft); n.title = e.target.value; setDraft(n) } }),
          h('div', { 'data-dam-row': '' },
            h('input', { 'data-dam-input': '', type: 'time', value: draft.time, onChange: function (e) { var n = Object.assign({}, draft); n.time = e.target.value || '09:00'; setDraft(n) } }),
            h('select', { 'data-dam-select': '', value: draft.quadrant, onChange: function (e) { var n = Object.assign({}, draft); n.quadrant = e.target.value; setDraft(n) } },
              ['重要紧急', '重要不紧急', '紧急不重要', '不重要不紧急'].map(function (q) { return h('option', { key: q, value: q }, QUADRANT_STYLE[q].label) }))),
          h('div', { 'data-dam-row': '' },
            h('button', { 'data-dam-btn': '', onClick: saveDraft }, t('save')),
            h('button', { 'data-dam-btn': '', onClick: function () { setDraft(null) } }, t('cancel')))))
      }
      msg ? h('div', { 'data-dam-hint': '' }, msg) : null
      return h('div', { style: { position: 'relative' } }, rows)
    }

    var TOOL_LABEL = { workbuddy: t('aiAssistant'), codebuddy: 'CodeBuddy', claude: 'Claude Code', codex: 'Codex', 'project-files': t('projectFiles') }
    function ConnectTab() {
      var sourcesPair = useState(null)
      var sources = sourcesPair[0]
      var setSources = sourcesPair[1]
      var busyPair = useState({})
      var busy = busyPair[0]
      var setBusy = busyPair[1]
      var msgPair = useState('')
      var msg = msgPair[0]
      var setMsg = msgPair[1]
      var errPair = useState('')
      var err = errPair[0]
      var setErr = errPair[1]
      function load() {
        apiGet(API.external).then(function (d) { setSources(d.sources || []) }).catch(function (e) { setErr(e.message) })
      }
      useEffect(function () { load(); var t = setInterval(load, 60000); return function () { clearInterval(t) } }, [])
      if (!sources) return err ? h('div', { 'data-dam-error': '' }, err) : h(Loading)
      function doImport(source, target) {
        var next = Object.assign({}, busy); next[source] = true
        setBusy(next); setMsg(''); setErr('')
        apiPost(API.externalImport, { source: source, target: target }).then(function (d) {
          var done = Object.assign({}, busy); done[source] = false
          setBusy(done); setMsg(d.result || t('imported'))
        }).catch(function (e) { var done = Object.assign({}, busy); done[source] = false; setBusy(done); setErr(e.message) })
      }
      function importAll() {
        var md = sources.filter(function (s) { return s.kind !== 'sessions' && s.enabled !== false })
        setMsg(t('importing') + md.length + t('importingSuffix')); setErr('')
        var chain = Promise.resolve()
        md.forEach(function (s) { chain = chain.then(function () { return apiPost(API.externalImport, { source: s.id, target: 'project' }) }) })
        chain.then(function () { setMsg(t('allImported')) }).catch(function (e) { setErr(e.message) })
      }
      var cards = []
      if (!sources.length) {
        cards.push(h('div', { 'data-dam-muted': '' }, t('noExternal')))
      }
      for (var i = 0; i < sources.length; i++) {
        (function (s) {
          var actions = []
          if (s.kind === 'sessions') {
            actions.push(h('span', { 'data-dam-hint': '' }, t('sessionSource') + s.fileCount + t('sessionSourceSuffix')))
          } else {
            actions.push(h('button', { 'data-dam-btn': '', disabled: !!busy[s.id], onClick: function () { doImport(s.id, 'project') } }, busy[s.id] ? t('importingOne') : t('importToNotes')))
            actions.push(h('button', { 'data-dam-btn': '', disabled: !!busy[s.id], onClick: function () { doImport(s.id, 'user') } }, t('importToUser')))
          }
          cards.push(h(Card, { title: s.name + ' · ' + s.tool + (s.enabled === false ? t('disabled') : '') },
            h('div', { 'data-dam-hint': '' }, s.kind + ' · ' + s.fileCount + t('filesCount') + fmtSize(s.size)),
            s.preview ? h('div', { 'data-dam-content': '' }, s.preview) : null,
            h('div', { 'data-dam-row': '' }, actions)))
        })(sources[i])
      }
      return h('div', null,
        h('div', { 'data-dam-hint': '' }, t('connectHint')),
        h('div', { 'data-dam-row': '' },
          h('button', { 'data-dam-btn': '', onClick: importAll }, t('importAll')),
          h('button', { 'data-dam-btn': '', onClick: load }, t('rescan'))),
        msg ? h('div', null, msg) : null,
        err ? h('div', { 'data-dam-error': '' }, err) : null,
        cards)
    }

    // ───────────────────────── 拖动/缩放辅助 ─────────────────────────
    var dragActive = false
    function startPointerDrag(onMove, interactiveSel) {
      return function (e) {
        // 命中交互控件(按钮/输入框等)时不启动拖动
        if (interactiveSel && e.target && e.target.closest && e.target.closest(interactiveSel)) return
        e.preventDefault()
        e.stopPropagation()
        var startX = e.clientX
        var startY = e.clientY
        var moved = false
        function move(ev) {
          var dx = ev.clientX - startX
          var dy = ev.clientY - startY
          if (!moved && Math.abs(dx) < 2 && Math.abs(dy) < 2) return
          moved = true
          if (!dragActive) { dragActive = true; emit() }
          onMove(dx, dy)
        }
        function up() {
          window.removeEventListener('pointermove', move)
          window.removeEventListener('pointerup', up)
          if (dragActive) { dragActive = false; emit() }
          controller.flushGeom()
        }
        window.addEventListener('pointermove', move)
        window.addEventListener('pointerup', up)
      }
    }

    function MemoryPanel() {
      var tick = useTick()
      var tabPair = useState('overview')
      var tab = tabPair[0]
      var setTab = tabPair[1]
      var g = controller.geom()
      useEffect(function () { return controller.subscribe(tick[1]) }, [])
      if (!panelOpen && !panelClosing) return null
      var body
      if (tab === 'overview') body = h(OverviewTab)
      else if (tab === 'logs') body = h(LogsTab)
      else if (tab === 'notes') body = h(NotesTab)
      else if (tab === 'reflections') body = h(ReflectionsTab)
      else if (tab === 'connect') body = h(ConnectTab)
      else if (tab === 'calendar') body = h(CalendarTab)
      else body = h(SearchTab)
      var tabs = [['overview', t('overview')], ['logs', t('logs')], ['notes', t('notes')], ['reflections', t('reflections')], ['connect', t('connect')], ['calendar', t('calendar')], ['search', t('search')]]
      var style = {
        left: g.left + 'px',
        top: g.top + 'px',
        width: g.width + 'px',
        height: g.height + 'px',
      }
      var dragMove = startPointerDrag(function (dx, dy) {
        controller.setGeom({ left: g.left + dx, top: g.top + dy })
      }, '[data-dam-btn], [data-dam-tab], [data-dam-input], [data-dam-select], textarea')
      var resizeMove = startPointerDrag(function (dx, dy) {
        controller.setGeom({ width: g.width + dx, height: g.height + dy })
      })
      return h('div', {
        'data-dam-panel': '',
        style: style,
        'data-closing': panelClosing ? 'true' : undefined,
        'data-dragging': dragActive ? 'true' : undefined,
      },
        h('header', {
          title: t('dragMove'),
          onPointerDown: dragMove,
        },
          h('strong', null, t('autoMemory')),
          h('span', { className: 'dam-spacer' }),
          h('button', { 'data-dam-btn': '', title: t('resetPos'), onClick: function () { controller.resetGeom() } }, '⤾'),
          h('button', { 'data-dam-btn': '', title: t('refresh'), onClick: function () { tick[1]() } }, '⟳'),
          h('button', { 'data-dam-btn': '', title: t('close'), onClick: function () { controller.close() } }, '✕')),
        h('div', { 'data-dam-tabs': '' }, tabs.map(function (t) {
          return h('button', { key: t[0], 'data-dam-tab': '', 'data-active': tab === t[0] ? 'true' : undefined, onClick: function () { setTab(t[0]) } }, t[1])
        })),
        h('div', { 'data-dam-body': '' }, body),
        h('div', { 'data-dam-resize': '', title: t('dragResize'), onPointerDown: resizeMove }))
    }

    // ───────────────────────── 设置页 ─────────────────────────
    var STYLE_OPTIONS = [['auto', t('styleAuto')], ['life', t('styleLife')], ['professional', t('styleProfessional')]]
    var LOCALE_OPTIONS = [['zh', t('zh')], ['en', t('en')]]
    function SettingsPage() {
      var cfgPair = useState(null)
      var cfg = cfgPair[0]
      var setCfg = cfgPair[1]
      var busyPair = useState(false)
      var busy = busyPair[0]
      var setBusy = busyPair[1]
      var msgPair = useState('')
      var msg = msgPair[0]
      var setMsg = msgPair[1]
      var errPair = useState('')
      var err = errPair[0]
      var setErr = errPair[1]
      useEffect(function () {
        var alive = true
        apiGet(API.config).then(function (d) { if (alive) setCfg(d.config) }).catch(function (e) { setErr(e.message) })
        return function () { alive = false }
      }, [])
      if (!cfg) return err ? h('div', { 'data-dam-error': '' }, err) : h(Loading)
      function set(key, value) { var next = Object.assign({}, cfg); next[key] = value; setCfg(next) }
      function save() {
        if (busy) return
        setBusy(true); setMsg(''); setErr('')
        apiPost(API.config, cfg).then(function (d) { setCfg(d.config); setMsg(t('saved')); setBusy(false) })
          .catch(function (e) { setErr(e.message); setBusy(false) })
      }
      function field(label, control, hint) {
        return h('div', null,
          h('div', { 'data-dam-row': '' }, h('label', null, label), control),
          hint ? h('div', { 'data-dam-hint': '' }, hint) : null)
      }
      return h('div', null,
        h('div', { 'data-dam-hint': '' }, t('settingsHeader')),
        field(t('fLocale'), h('select', { 'data-dam-select': '', value: cfg.locale || 'zh', onChange: function (e) { set('locale', e.target.value); setLocale(e.target.value) } },
          LOCALE_OPTIONS.map(function (o) { return h('option', { key: o[0], value: o[0] }, o[1]) })), t('fLocaleHint')),
        field(t('fUserDir'), h('input', { 'data-dam-input': '', value: cfg.userMemoryDir, onChange: function (e) { set('userMemoryDir', e.target.value) } }), t('fUserDirHint')),
        field(t('fProjectDir'), h('input', { 'data-dam-input': '', value: cfg.projectMemoryDir, onChange: function (e) { set('projectMemoryDir', e.target.value) } }), t('fProjectDirHint')),
        field(t('fInject'), h('input', { type: 'checkbox', checked: !!cfg.injectEnabled, onChange: function (e) { set('injectEnabled', e.target.checked) } }), t('fInjectHint')),
        field(t('fBudget'), h('input', { 'data-dam-input': '', type: 'number', min: 400, value: cfg.injectBudgetChars, onChange: function (e) { set('injectBudgetChars', Number(e.target.value) || 2400) } }), t('fBudgetHint')),
        field(t('fDays'), h('input', { 'data-dam-input': '', type: 'number', min: 1, max: 14, value: cfg.recentDaysInjected, onChange: function (e) { set('recentDaysInjected', Number(e.target.value) || 3) } }), t('fDaysHint')),
        field(t('fReflect'), h('input', { type: 'checkbox', checked: !!cfg.reflectEnabled, onChange: function (e) { set('reflectEnabled', e.target.checked) } }), t('fReflectHint')),
        field(t('fStyle'), h('select', { 'data-dam-select': '', value: cfg.reflectStyle, onChange: function (e) { set('reflectStyle', e.target.value) } },
          STYLE_OPTIONS.map(function (o) { return h('option', { key: o[0], value: o[0] }, o[1]) })), t('fStyleHint')),
        h('div', { 'data-dam-row': '' },
          h('button', { 'data-dam-btn': '', onClick: save, disabled: busy }, busy ? t('saving') : t('saveSettings')),
          msg ? h('span', null, msg) : null),
        err ? h('div', { 'data-dam-error': '' }, err) : null)
    }

    // ───────────────────────── 插件挂载 ─────────────────────────
    function apply(ctx) {
      try { ensureStyle() } catch (e) { console.warn('[dsh-auto-memory] style inject failed', e) }
      ctx.effect(function () {
        return function () {
          var tag = document.getElementById(STYLE_ID)
          if (tag) tag.remove()
          if (closeTimer) { clearTimeout(closeTimer); closeTimer = null }
        }
      }, 'dsh-auto-memory: styles')

      var slots = ctx.slots
      if (!slots) { console.warn('[dsh-auto-memory] slots service unavailable'); return }

      // 初始化界面语言(从 host 配置读取,持久化到 localStorage 以便即时生效)
      try {
        var savedLocale = localStorage.getItem('dsh-auto-memory.locale')
        if (savedLocale === 'zh' || savedLocale === 'en') locale = savedLocale
        apiGet(API.config).then(function (d) {
          if (d && d.config && d.config.locale) {
            var l = d.config.locale
            if (l !== locale) { locale = l; try { localStorage.setItem('dsh-auto-memory.locale', l) } catch (e2) {}; emit() }
          }
        }).catch(function () {})
      } catch (e1) {}
      // 语言切换时通知所有订阅者重渲染
      onLocale(function () { emit() })

      try {
        slots.inject('sidebar.footer.action', function () {
          return slots.register({ name: 'sidebar.footer.action', id: 'auto-memory', order: 5, label: t('memory') }, function () { return h(SidebarButton) })
        })
        slots.inject('shell.overlay', function () {
          return slots.register({ name: 'shell.overlay', id: 'auto-memory', order: 5 }, function () { return h(MemoryPanel) })
        })
        slots.inject('settings.section', function () {
          return slots.register({ name: 'settings.section', id: 'auto-memory', order: 25, label: t('autoMemory') }, function (props) { return h(SettingsPage, { close: props && props.close }) })
        })
      } catch (e) {
        console.warn('[dsh-auto-memory] slot registration failed', e)
      }
      console.log('[dsh-auto-memory] client ready: sidebar entry + panel + settings page')
    }

    exports.inject = ['slots']
    exports.apply = apply
    return module.exports
  },
})
