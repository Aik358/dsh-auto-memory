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
  id: '@aik358/dsh-auto-memory',
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
      tag.dataset.plugin = '@aik358/dsh-auto-memory'
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

    function Loading() { return h('div', { 'data-dam-muted': '' }, '加载中…') }

    // ───────────────────────── 侧边栏入口 ─────────────────────────
    function SidebarButton() {
      var tick = useTick()
      useEffect(function () { return controller.subscribe(tick[1]) }, [])
      return h('button', {
        'data-dam-sidebar-btn': '',
        title: '记忆面板',
        'data-active': (panelOpen || panelClosing) ? 'true' : undefined,
        onClick: function () { controller.toggle() },
      }, h('span', null, '记忆'))
    }

    // ───────────────────────── 记忆面板 ─────────────────────────
    function fmtSize(n) {
      if (n >= 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB'
      if (n >= 1024) return (n / 1024).toFixed(1) + ' KB'
      return n + ' B'
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
      if (!state) return h(Loading)
      function oneClickReflect() {
        if (reflectBusy) return
        setReflectBusy(true); setActMsg('')
        apiPost(API.reflectAuto, {}).then(function (d) {
          setActMsg(d.result || '已生成'); setReflectBusy(false)
          apiGet(API.state).then(function (s) { if (s) setState(s) }).catch(function () {})
        }).catch(function (e) { setActMsg('失败: ' + e.message); setReflectBusy(false) })
      }
      return h('div', null,
        state.pendingReflection
          ? h(Banner, null, '待生成反思: ' + state.pendingReflection + ' —— 可点下方「一键反思」立即生成。')
          : null,
        // 状态行:今日工作 / 反思 / 笔记
        h('div', { 'data-dam-kv': '' },
          h('b', null, '今日工作'), h('span', null, state.todayEntries + ' 条日志'),
          h('b', null, '每日反思'), h('span', null, state.latestReflectionDate || '(还没有)'),
          h('b', null, '工作区'), h('span', null, state.ws)),
        // 快捷操作
        h('div', { 'data-dam-row': '' },
          h('button', { 'data-dam-btn': '', onClick: oneClickReflect, disabled: reflectBusy }, reflectBusy ? '反思生成中…' : '一键反思'),
          h('span', { 'data-dam-hint': '' }, '用最近日志自动生成反思')),
        actMsg ? h('div', { 'data-dam-hint': '' }, actMsg) : null,
        h('div', { 'data-dam-hint': '' },
          '快捷入口:日志页签看每日记录 · 笔记页签追加项目笔记 · 接续页签接入其他 AI 记忆 · 检索页签全文搜索。'),
        // 技术细节(折叠)
        h('div', null,
          h('button', { 'data-dam-btn': '', onClick: function () { setShowDetail(!showDetail) } }, showDetail ? '收起技术信息 ▴' : '技术信息 ▾')),
        showDetail ? h('div', { 'data-dam-kv': '' },
          h('b', null, '用户级记忆'), h('span', null, state.userFile + ' (' + fmtSize(state.sizes.user) + ')'),
          h('b', null, '项目笔记'), h('span', null, state.notesPath + ' (' + fmtSize(state.sizes.notes) + ')'),
          h('b', null, '今日日志'), h('span', null, state.logPath + ' (' + fmtSize(state.sizes.log) + ')'),
          h('b', null, '配置文件'), h('span', null, state.configReadError ? ('读取失败: ' + state.configReadError) : '正常'),
          h('b', null, '刷新时间'), h('span', null, state.refreshedAt ? new Date(state.refreshedAt).toLocaleString() : '尚未')) : null)
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
          h('div', { 'data-dam-content': '' }, content || '(空)'),
          h('button', { 'data-dam-btn': '', onClick: function () { setOpen(null); setContent('') } }, '← 返回')))
      } else {
        rows.push(h('div', { 'data-dam-hint': '' }, '点击日期查看当日日志(append-only):'))
        for (var i = 0; i < data.logs.length; i++) {
          (function (log) {
            rows.push(h(Card, { title: log.date + ' · ' + fmtSize(log.size) },
              h('button', { 'data-dam-btn': '', onClick: function () { setOpen(log.date + '.md') } }, '查看')))
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
          setMsg(d.result || '已追加 ✓'); setDraft(''); setSaving(false)
        }).catch(function (e) { setErr(e.message); setSaving(false) })
      }
      return h('div', null,
        h('div', { 'data-dam-hint': '' }, '项目笔记: ' + data.notesPath),
        h('textarea', { 'data-dam-input': '', rows: 6, placeholder: '想追加到项目笔记的内容…(保存时自动带日期标题)', value: draft, onChange: function (e) { setDraft(e.target.value) } }),
        h('div', { 'data-dam-row': '' },
          h('button', { 'data-dam-btn': '', onClick: save, disabled: saving }, saving ? '保存中…' : '追加'),
          h('span', { 'data-dam-hint': '' }, '建议直接用对话让 agent 调 memory_note;此处为手动追加。')),
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
          setMsg(d.result || '已生成'); setBusy(false)
          apiGet(API.list).then(function (dd) { if (dd) setData(dd) }).catch(function () {})
        }).catch(function (e) { setMsg('失败: ' + e.message); setBusy(false) })
      }
      var rows = []
      if (open) {
        rows.push(h(Card, { title: '反思 ' + pathName(open) }, h('div', { 'data-dam-content': '' }, content || '(空)')))
        rows.push(h('button', { 'data-dam-btn': '', onClick: function () { setOpen(null); setContent('') } }, '← 返回'))
      } else {
        rows.push(h('div', { 'data-dam-row': '' },
          h('button', { 'data-dam-btn': '', onClick: oneClickReflect, disabled: busy }, busy ? '生成中…' : '一键反思'),
          h('span', { 'data-dam-hint': '' }, '自动用最近日志生成反思草稿(便于测试)')))
        if (msg) rows.push(h('div', null, msg))
        if (!data.reflections.length) rows.push(h('div', { 'data-dam-muted': '' }, '还没有反思。每天第一次会话时,agent 会主动呈现前一天的工作反思。'))
        for (var i = 0; i < data.reflections.length; i++) {
          (function (r) {
            rows.push(h(Card, { title: r.date + ' · ' + fmtSize(r.size) },
              h('button', { 'data-dam-btn': '', onClick: function () { setOpen('reflections/' + r.name) } }, '查看')))
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
          .catch(function (e) { setResult('检索失败: ' + e.message); setBusy(false) })
      }
      return h('div', null,
        h('div', { 'data-dam-row': '' },
          h('input', { 'data-dam-input': '', placeholder: '搜记忆:关键词或自包含描述…', value: q, onChange: function (e) { setQ(e.target.value) }, onKeyDown: function (e) { if (e.key === 'Enter') search() } }),
          h('button', { 'data-dam-btn': '', onClick: search, disabled: busy }, '检索')),
        result ? h(Card, { title: '结果' }, h('div', { 'data-dam-content': '' }, result)) : null)
    }

    var TOOL_LABEL = { workbuddy: 'AI 助手', codebuddy: 'CodeBuddy', claude: 'Claude Code', codex: 'Codex', 'project-files': '项目文件' }
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
          setBusy(done); setMsg(d.result || '接入完成')
        }).catch(function (e) { var done = Object.assign({}, busy); done[source] = false; setBusy(done); setErr(e.message) })
      }
      function importAll() {
        var md = sources.filter(function (s) { return s.kind !== 'sessions' && s.enabled !== false })
        setMsg('正在接入 ' + md.length + ' 个源…'); setErr('')
        var chain = Promise.resolve()
        md.forEach(function (s) { chain = chain.then(function () { return apiPost(API.externalImport, { source: s.id, target: 'project' }) }) })
        chain.then(function () { setMsg('全部接入完成 ✓') }).catch(function (e) { setErr(e.message) })
      }
      var cards = []
      if (!sources.length) {
        cards.push(h('div', { 'data-dam-muted': '' }, '未检测到其他 AI 工具的记忆文件(CodeBuddy/Claude Code/Codex 等)。'))
      }
      for (var i = 0; i < sources.length; i++) {
        (function (s) {
          var actions = []
          if (s.kind === 'sessions') {
            actions.push(h('span', { 'data-dam-hint': '' }, '会话源:共 ' + s.fileCount + ' 个会话文件,用 memory_recall 按需检索'))
          } else {
            actions.push(h('button', { 'data-dam-btn': '', disabled: !!busy[s.id], onClick: function () { doImport(s.id, 'project') } }, busy[s.id] ? '接入中…' : '接入项目笔记'))
            actions.push(h('button', { 'data-dam-btn': '', disabled: !!busy[s.id], onClick: function () { doImport(s.id, 'user') } }, '接入用户记忆'))
          }
          cards.push(h(Card, { title: s.name + ' · ' + s.tool + (s.enabled === false ? ' · 已停用' : '') },
            h('div', { 'data-dam-hint': '' }, s.kind + ' · ' + s.fileCount + ' 个文件 · ' + fmtSize(s.size)),
            s.preview ? h('div', { 'data-dam-content': '' }, s.preview) : null,
            h('div', { 'data-dam-row': '' }, actions)))
        })(sources[i])
      }
      return h('div', null,
        h('div', { 'data-dam-hint': '' }, '把其他 AI 工具(CodeBuddy / Claude Code / Codex / 项目约定文件等)积累的记忆接入当前 DSH 工作。接入后内容写入本地记忆并自动标注来源,后续会随会话自动注入。'),
        h('div', { 'data-dam-row': '' },
          h('button', { 'data-dam-btn': '', onClick: importAll }, '一键接入全部'),
          h('button', { 'data-dam-btn': '', onClick: load }, '重新扫描')),
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
      else body = h(SearchTab)
      var tabs = [['overview', '概览'], ['logs', '日志'], ['notes', '笔记'], ['reflections', '反思'], ['connect', '接续'], ['search', '检索']]
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
          title: '拖动移动',
          onPointerDown: dragMove,
        },
          h('strong', null, '自动记忆'),
          h('span', { className: 'dam-spacer' }),
          h('button', { 'data-dam-btn': '', title: '恢复默认位置', onClick: function () { controller.resetGeom() } }, '⤾'),
          h('button', { 'data-dam-btn': '', title: '刷新', onClick: function () { tick[1]() } }, '⟳'),
          h('button', { 'data-dam-btn': '', title: '关闭', onClick: function () { controller.close() } }, '✕')),
        h('div', { 'data-dam-tabs': '' }, tabs.map(function (t) {
          return h('button', { key: t[0], 'data-dam-tab': '', 'data-active': tab === t[0] ? 'true' : undefined, onClick: function () { setTab(t[0]) } }, t[1])
        })),
        h('div', { 'data-dam-body': '' }, body),
        h('div', { 'data-dam-resize': '', title: '拖动调整大小', onPointerDown: resizeMove }))
    }

    // ───────────────────────── 设置页 ─────────────────────────
    var STYLE_OPTIONS = [['auto', '由内容决定'], ['life', '生活化'], ['professional', '专业性']]
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
        apiPost(API.config, cfg).then(function (d) { setCfg(d.config); setMsg('已保存 ✓'); setBusy(false) })
          .catch(function (e) { setErr(e.message); setBusy(false) })
      }
      function field(label, control, hint) {
        return h('div', null,
          h('div', { 'data-dam-row': '' }, h('label', null, label), control),
          hint ? h('div', { 'data-dam-hint': '' }, hint) : null)
      }
      return h('div', null,
        h('div', { 'data-dam-hint': '' }, '记忆存储与行为设置(保存到 DSH 主目录 dsh-auto-memory.json):'),
        field('用户记忆目录', h('input', { 'data-dam-input': '', value: cfg.userMemoryDir, onChange: function (e) { set('userMemoryDir', e.target.value) } }), '跨项目规则存放处,支持 ~ 开头;需有文件写权限。'),
        field('项目记忆目录', h('input', { 'data-dam-input': '', value: cfg.projectMemoryDir, onChange: function (e) { set('projectMemoryDir', e.target.value) } }), '相对各工作区的目录名(默认 .dsh-memory)。'),
        field('注入记忆上下文', h('input', { type: 'checkbox', checked: !!cfg.injectEnabled, onChange: function (e) { set('injectEnabled', e.target.checked) } }), '每次组装提示词时自动注入 <memory_system> 块。'),
        field('注入预算(字符)', h('input', { 'data-dam-input': '', type: 'number', min: 400, value: cfg.injectBudgetChars, onChange: function (e) { set('injectBudgetChars', Number(e.target.value) || 2400) } }), '记忆块总预算,超出部分截断。'),
        field('注入最近日志天数', h('input', { 'data-dam-input': '', type: 'number', min: 1, max: 14, value: cfg.recentDaysInjected, onChange: function (e) { set('recentDaysInjected', Number(e.target.value) || 3) } }), '会话开始时注入最近 N 天的工作日志尾部。'),
        field('每日反思', h('input', { type: 'checkbox', checked: !!cfg.reflectEnabled, onChange: function (e) { set('reflectEnabled', e.target.checked) } }), '昨天有工作日志时,会话首轮主动呈现昨日反思。'),
        field('反思风格', h('select', { 'data-dam-select': '', value: cfg.reflectStyle, onChange: function (e) { set('reflectStyle', e.target.value) } },
          STYLE_OPTIONS.map(function (o) { return h('option', { key: o[0], value: o[0] }, o[1]) })), '生活化 / 专业性 / 由内容决定。'),
        h('div', { 'data-dam-row': '' },
          h('button', { 'data-dam-btn': '', onClick: save, disabled: busy }, busy ? '保存中…' : '保存设置'),
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

      try {
        slots.inject('sidebar.footer.action', function () {
          return slots.register({ name: 'sidebar.footer.action', id: 'auto-memory', order: 5, label: '记忆' }, function () { return h(SidebarButton) })
        })
        slots.inject('shell.overlay', function () {
          return slots.register({ name: 'shell.overlay', id: 'auto-memory', order: 5 }, function () { return h(MemoryPanel) })
        })
        slots.inject('settings.section', function () {
          return slots.register({ name: 'settings.section', id: 'auto-memory', order: 25, label: '自动记忆' }, function (props) { return h(SettingsPage, { close: props && props.close }) })
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
