    // Source embedded by tools/build-iter5-skin.mjs inside the host React factory.
    var ITER5_PAGES = [
      ['home', '工作台', 'Workbench', 'blue', 'overview'],
      ['library', '记忆库', 'Memory', 'indigo', 'logs'],
      ['handoff', '接续', 'Continue', 'cyan', 'plan'],
      ['calendar', '日程', 'Calendar', 'orange', 'calendar'],
      ['skills', '技能', 'Skills', 'green', 'hub'],
      ['recall', '唤起回顾', 'Recall review', 'purple', 'refine'],
      ['mindmap', '工作区关系', 'Workspaces', 'pink', 'workspaces'],
      ['storage', '存储与维护', 'Storage', 'slate', 'storage'],
      ['settings', '设置', 'Settings', 'slate', 'settings'],
    ]
    function iter5Identity() { return String(currentSessionIdClient() || '') + '|' + String(currentWs() || '') }
    function iter5PageForTab(tab) {
      if (['notes', 'logs', 'reflections', 'search'].indexOf(tab) >= 0) return 'library'
      if (tab === 'connect') return 'handoff'
      if (tab === 'team' || tab === 'stats') return tab
      var row = ITER5_PAGES.filter(function (p) { return p[4] === tab })[0]
      return row ? row[0] : 'home'
    }
    function Iter5Icon(props) {
      var paths = {
        spark: 'm12 2 2.6 7.4L22 12l-7.4 2.6L12 22l-2.6-7.4L2 12l7.4-2.6zM20 2v4M18 4h4',
        heart: 'M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8z',
        folder: 'M3 7V4h6l3 3h9v13H3zM3 9h18',
        timeline: 'M12 3a9 9 0 1 1-6.4 2.6M3 3v6h6M12 7v5l3 2',
        pulse: 'M2 12h5l3-8 4 16 3-8h5',
        note: 'M6 3h8l4 4v14H6zM14 3v5h5M9 12h6M9 16h6',
        search: 'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
        check: 'm5 12 4 4L19 6M21 12a9 9 0 1 1-5-8',
        home: 'M3 11 12 3l9 8M5 10v11h5v-7h4v7h5V10',
        library: 'M4 4h16v16H4zM8 8h8M8 12h6',
        handoff: 'M7 7h10v10H7zM3 12V3h9M21 12v9h-9M10 14l4-4',
        calendar: 'M4 5h16v16H4zM8 3v4M16 3v4M4 11h16',
        skills: 'm12 3 3 6 6 3-6 3-3 6-3-6-6-3 6-3z',
        recall: 'M4 5h16v12H9l-5 4zM8 9h8M8 13h5',
        mindmap: 'M4 4h5v5H4zM15 15h5v5h-5zM4 15h5v5H4zM6 9v6M9 6h8v9',
        storage: 'M4 5h16v5H4zM4 14h16v5H4zM7 7h2M7 16h2',
        settings: 'M4 6h16M4 12h16M4 18h16M8 3v6M16 9v6M10 15v6',
        lock: 'M5 10h14v11H5zM8 10V6a4 4 0 0 1 8 0v4M12 14v3',
      }
      return h('svg', { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }, h('path', { d: paths[props.name] || paths.library }))
    }
    function Iter5Tabs(props) {
      return h('div', { className: 'i5-tabs', role: 'tablist', 'aria-label': props.label }, props.items.map(function (it, idx) {
        var selected = props.value === it[0]
        return h('button', { key: it[0], id: props.id + '-tab-' + it[0], role: 'tab', type: 'button', 'aria-selected': selected, 'aria-controls': props.id + '-panel', tabIndex: selected ? 0 : -1,
          onClick: function () { props.onChange(it[0]) },
          onKeyDown: function (e) {
            var next = e.key === 'Home' ? 0 : e.key === 'End' ? props.items.length - 1 : e.key === 'ArrowRight' ? (idx + 1) % props.items.length : e.key === 'ArrowLeft' ? (idx + props.items.length - 1) % props.items.length : -1
            if (next < 0) return
            e.preventDefault(); props.onChange(props.items[next][0])
            var node = e.currentTarget.parentNode.children[next]; if (node) node.focus()
          } }, it[1], it[2] ? h('span', { className: 'i5-dirty-dot', 'aria-label': L('未保存', 'Unsaved') }) : null)
      }))
    }
    function Iter5Screws() { return h(React.Fragment, null, ['tl','tr','bl','br'].map(function (corner) { return h('span', { key: corner, className: 'i5-screw i5-screw-' + corner, 'aria-hidden': true }) })) }
    function Iter5Card(props) { return h('section', { className: 'i5-card ' + (props.className || '') }, props.title ? h('h2', { className: 'i5-card-title' }, props.icon ? h('span', { className: 'i5-badge', 'data-hue': props.hue || 'blue' }, h(Iter5Icon, { name: props.icon })) : null, props.title) : null, props.children) }
    function Iter5Error(props) {
      // Only an explicit denial identifies this state; an unavailable service is not a permission failure.
      var denied = /\b(?:EACCES|EPERM|forbidden)\b|HTTP 403\b|权限不足|拒绝访问/i.test(String(props.error || ''))
      return h('div', { className: 'i5-error', 'data-denied': denied ? 'true' : undefined, role: 'alert' },
        denied ? h(Iter5Icon, { name: 'lock' }) : null,
        h('div', { className: 'i5-error-copy' }, h('strong', null, denied ? L('访问被拒绝', 'Access denied') : props.title || L('操作未完成', 'Action incomplete')), h('p', null, props.error), denied ? h('p', null, L('请核对当前目录和宿主的访问权限；权限恢复后可重试。', 'Check the current directory and host access permissions, then retry once access is restored.')) : null),
        props.retry ? h('button', { type: 'button', onClick: props.retry }, L('重试', 'Retry')) : null)
    }
    // Never accept a response issued for a different session/workspace or an unmounted view.
    function useIter5Data(loader, deps) {
      var pair = useState({ data: null, error: '', loading: true })
      var retry = useState(0)
      var identity = iter5Identity()
      var requestKey = JSON.stringify([identity, retry[0]].concat(deps || []))
      useEffect(function () {
        var alive = true
        pair[1]({ key: requestKey, data: null, error: '', loading: true })
        Promise.resolve().then(loader).then(function (data) {
          if (alive && identity === iter5Identity()) pair[1]({ key: requestKey, data: data, error: '', loading: false })
        }, function (e) {
          if (alive && identity === iter5Identity()) pair[1]({ key: requestKey, data: null, error: String(e && e.message || e), loading: false })
        })
        return function () { alive = false }
      }, [identity, retry[0]].concat(deps || []))
      // Do not show the previous file under a new selection before the effect runs.
      return Object.assign({}, pair[0].key === requestKey ? pair[0] : { data: null, error: '', loading: true }, { retry: function () { retry[1](function (n) { return n + 1 }) } })
    }
    function iter5MemoryRows(list, state) {
      var out = []
      if (state.userFile && list.userSize > 0) out.push({ path: state.userFile, label: L('用户偏好', 'User memory'), kind: 'user', scope: 'user', size: list.userSize })
      if (state.notesPath && list.notesSize > 0) out.push({ path: state.notesPath, label: L('项目笔记', 'Project notes'), kind: 'notes', scope: 'project', size: list.notesSize })
      ;(list.logs || []).forEach(function (r) { out.push({ path: list.projectDir ? list.projectDir + '/' + r.name : r.name, label: r.date || r.name, date: r.date, kind: 'logs', scope: 'project', size: r.size }) })
      ;(list.reflections || []).forEach(function (r) { out.push({ path: (list.projectDir ? list.projectDir + '/' : '') + 'reflections/' + r.name, label: r.date || r.name, date: r.date, kind: 'reflections', scope: 'project', size: r.size }) })
      return out
    }
    async function iter5MemorySnapshot() {
      // /list has no workspace parameter on upstream 3.2.1. Prime the current
      // workspace through /state, then reject any list from a different root.
      // ★批次 Y（#212 claim2 前端）：快照注入 noteSessionId —— 笔记表单据此发
      //   sessionId + expectedNotesPath（服务端 X2 两字段必填，缺失即 400）。
      var noteSessionId = currentSessionIdClient()
      var state = await apiGet(API.state, { ws: currentWs(), sessionId: currentSessionIdClient() })
      state = Object.assign({}, state, { noteSessionId: noteSessionId })
      var list = await apiGet(API.list)
      var expected = String(state.notesPath || '').replace(/[\\/][^\\/]+$/, '').replace(/\\/g, '/')
      var actual = String(list.projectDir || '').replace(/\\/g, '/')
      if (expected && actual && expected !== actual) throw Error(L('工作区数据正在切换，请刷新后重试。', 'Workspace data changed. Refresh and try again.'))
      return [list, state]
    }
    function Iter5Browse(props) {
      var rowsData = useIter5Data(iter5MemorySnapshot, [props.nonce])
      var intent = props.intent || {}
      var filter = useState(intent.category || 'all'), scope = useState(intent.scope || 'all'), query = useState(''), selected = useState(intent.path || '')
      var append = useState(function(){return !!memoryNoteDrafts[memoryDraftIdentity()]})
      var reader = useRef(null)
      var rows = rowsData.data ? iter5MemoryRows(rowsData.data[0], rowsData.data[1]).filter(function (r) {
        return (filter[0] === 'all' || r.kind === filter[0]) && (scope[0] === 'all' || r.scope === scope[0]) && (r.label + ' ' + r.path).toLowerCase().indexOf(query[0].toLowerCase()) >= 0
      }) : []
      var chosen = rows.filter(function (r) { return r.path === selected[0] })[0] || rows[0]
      var path = chosen && chosen.path || ''
      var file = useIter5Data(function () { return path ? apiGet(API.file, { path: path, ws: currentWs() }) : Promise.resolve(null) }, [path, props.nonce])
      useEffect(function () {
        var el = reader.current, main = el && el.closest('.i5-main')
        if (!main) return
        function fit() {
          var top = el.getBoundingClientRect().top - main.getBoundingClientRect().top + main.scrollTop
          el.style.setProperty('--i5-reading-height', Math.max(260, main.clientHeight - top - 20) + 'px')
        }
        fit()
        var observer = typeof ResizeObserver === 'function' ? new ResizeObserver(fit) : null
        if (observer) {
          observer.observe(main)
          if (main.firstElementChild) observer.observe(main.firstElementChild)
          var toolbar = el.parentElement.previousElementSibling
          if (toolbar) observer.observe(toolbar)
        }
        return function () { if (observer) observer.disconnect() }
      }, [rowsData.loading, append[0], props.nonce])
      function selectFile(next) {
        selected[1](next)
        var el = reader.current, main = el && el.closest('.i5-main')
        if (main && main.clientWidth - 40 < 740) requestAnimationFrame(function () {
          if (!el.isConnected) return
          el.scrollIntoView({ block: 'start', behavior: 'instant' })
          el.querySelector('h2').focus({ preventScroll: true })
        })
      }
      if (rowsData.error) return h(Iter5Error, { error: rowsData.error, retry: rowsData.retry })
      if (rowsData.loading) return h(Iter5MemoryLoading)
      if (append[0]) return h('section', { className: 'i5-note-page' },
        h('h2', null, L('追加项目笔记', 'Append project note')),
        h('p', { className: 'i5-muted' }, L('记录决定、补充信息与下一步行动。', 'Record decisions, supporting details and next actions.')),
        h(Iter5Note, { source: rowsData.data[1].notesPath, sessionId: rowsData.data[1].noteSessionId, onSaved: rowsData.retry, onClose: function () { append[1](false) } }))
      return h('div', { className: 'i5-panel i5-instrument' }, h(Iter5Screws),
        h('div', { className: 'i5-ph' }, h('h2', null, L('记忆文件', 'Memory files')), h('span', { className: 'i5-ph-right i5-num' }, rows.length)),
        h('div', { className: 'i5-toolbar' },
          h('input', { type: 'search', placeholder: L('按标题或路径筛选', 'Filter titles or paths'), 'aria-label': L('筛选记忆文件', 'Filter memory files'), value: query[0], onChange: function (e) { query[1](e.target.value) } }),
          h('select', { 'aria-label': L('记忆范围', 'Memory scope'), value: scope[0], onChange: function (e) { scope[1](e.target.value) } }, [['all', L('全部范围', 'All scopes')], ['user', L('用户级', 'User')], ['project', L('本项目', 'This project')]].map(function (x) { return h('option', { key: x[0], value: x[0] }, x[1]) })),
          h('select', { 'aria-label': L('记忆分类', 'Memory category'), value: filter[0], onChange: function (e) { filter[1](e.target.value) } }, [['all', L('全部分类', 'All categories')], ['user', L('用户偏好', 'Preferences')], ['notes', L('项目笔记', 'Notes')], ['logs', L('日志', 'Logs')], ['reflections', L('反思', 'Reflections')]].map(function (x) { return h('option', { key: x[0], value: x[0] }, x[1]) })),
          h('button', { onClick: function () { if (append[0] && !window.confirm(L('关闭笔记编辑区？未保存的内容将丢失。', 'Close the note editor and discard unsaved text?'))) return; append[1](!append[0]) }, 'aria-expanded': append[0] }, L('追加笔记', 'Append note'))),
        h('div', { className: 'i5-list-detail', 'data-empty': String(rows.length === 0) },
          h('div', { className: 'i5-card i5-file-list', 'aria-label': L('记忆文件', 'Memory files') }, rows.length ? rows.map(function (r) {
              return h('button', { key: r.path, className: 'i5-file', 'aria-current': r.path === path ? 'true' : undefined, onClick: function () { selectFile(r.path) } }, h('span', { className: 'i5-type-led', 'aria-hidden': true, 'data-hue': r.kind === 'user' ? 'pink' : r.kind === 'reflections' ? 'purple' : 'blue' }, h(Iter5Icon, { name: r.kind === 'user' ? 'heart' : 'note' })), h('span', { className: 'i5-file-copy' }, h('strong', null, r.label), h('small', null, r.kind === 'user' ? L('长期偏好与规则', 'Lasting preferences and rules') : r.kind === 'notes' ? L('项目笔记', 'Project notes') : r.kind === 'logs' ? L('每日日志', 'Daily log') : L('反思记录', 'Reflection')), h('span', { className: 'i5-tag' }, r.scope === 'user' ? L('用户级', 'User') : L('本项目', 'Workspace'))), h('small', null, fmtSize(r.size)))
          }) : h('p', { className: 'i5-empty' }, L('没有符合条件的记忆文件', 'No matching memory files'))),
          h('section', { ref: reader, className: 'i5-card i5-source-card', 'aria-label': L('记忆详情', 'Memory detail') },
            h('div', { className: 'i5-source-heading' }, h('span', { className: 'i5-badge', 'data-hue': 'blue' }, h(Iter5Icon, { name: 'note' })), h('h2', { tabIndex: -1 }, chosen ? chosen.label : L('记忆详情', 'Memory detail'))),
            chosen ? h('div', { className: 'i5-source-meta' }, h('span', { className: 'i5-tag' }, chosen.scope === 'user' ? L('用户偏好', 'User preferences') : L('项目记忆', 'Project memory')), h('span', null, fmtSize(chosen.size)), chosen.date ? h('time', null, chosen.date) : null) : null,
            file.error ? h(Iter5Error, { title: L('读取失败', 'Unable to read'), error: file.error, retry: file.retry }) : file.loading && path ? h(Loading) : chosen && file.data ? h(Iter5Document, { text: file.data.content || L('文件暂无内容。', 'This file is empty.') }) : h(Iter5Empty, { title: query[0] || filter[0] !== 'all' || scope[0] !== 'all' ? L('没有符合条件的记忆文件', 'No matching memory files') : L('暂无记忆记录', 'No memory records yet'), text: L('调整筛选条件，或追加新的项目笔记。', 'Adjust the filters or append a project note.') }, h('button', { className: 'i5-primary', onClick: function () { append[1](true) } }, L('追加笔记', 'Append note'))),
            chosen ? h('div', { className: 'i5-source-origin' }, h('strong', null, L('文件来源', 'Source file')), h('small', null, file.data && file.data.path || path)) : null)))
    }
    function Iter5Memory(props) {
      var initial = { reflections: 'reflections', search: 'search', notes: 'browse' }[controller.panelTab()] || 'browse'
      var tab = useState(initial)
      var root = useRef(null)
      var items = [['browse', L('浏览', 'Browse')], ['logs', L('日志', 'Logs')], ['reflections', L('反思', 'Reflections')], ['search', L('检索', 'Search')]]
      var component = tab[0] === 'browse' ? Iter5Browse : tab[0] === 'search' ? Iter5Search : Iter5History
      return h('div', { ref: root }, h(Iter5Tabs, { id: 'i5-memory', label: L('记忆库分区', 'Memory sections'), items: items, value: tab[0], onChange: function(next) { if(root.current&&root.current.querySelector('[data-i5-dirty="true"]')&&!window.confirm(L('有未保存的笔记，确定切换？','Discard the unsaved note and switch?')))return;tab[1](next) } }),
        h('div', { role: 'tabpanel', id: 'i5-memory-panel', 'aria-labelledby': 'i5-memory-tab-' + tab[0] }, h(component, { key: tab[0], kind: tab[0], nonce: props.nonce, intent: props.intent })))
    }
    function Iter5Continue(props) {
      var tab = useState(controller.panelTab() === 'connect' ? 'external' : 'task')
      var items = [['task', L('当前任务', 'Current task')], ['board', L('白板', 'Whiteboard')], ['external', L('外部来源', 'External sources')]]
      return h('div', null, h(Iter5Tabs, { id: 'i5-continue', label: L('接续分区', 'Continuation sections'), items: items, value: tab[0], onChange: tab[1] }),
        h('div', { role: 'tabpanel', id: 'i5-continue-panel', 'aria-labelledby': 'i5-continue-tab-' + tab[0], className: 'i5-continue-content' },
          tab[0] === 'external' ? h(Iter5External, { nonce: props.nonce }) : h(Iter5Handoff, { key: tab[0], nonce: props.nonce, boardOnly: tab[0] === 'board' })))
    }
    function Iter5Page(props) {
      var page = useState(function () { return iter5PageForTab(controller.panelTab()) })
      var refresh = useState(0), menu = useState(false), identityState = useState(iter5Identity), intent = useState(null), focus = useState(false)
      var lastTab = useRef(controller.panelTab())
      var root = useRef(null), menuButton = useRef(null)
      var content = useRef(null)
      var deep = useIter5Theme(), skinStyle = useIter5Style(), identity = iter5Identity()
      useEffect(function () {
        var el = root.current
        if (!el) return
        function measure() { el.setAttribute('data-narrow', String(el.clientWidth < 900)) }
        measure()
        var observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null
        if (observer) observer.observe(el)
        return function () { if (observer) observer.disconnect() }
      }, [])
      // The host conversation surface scrolls above a floating composer. Use its
      // measured padding so our own scroller and save bar remain above that composer.
      useEffect(function () {
        var el = root.current, area = el && el.closest('[data-conversation-scroll]')
        if (!el || !area) return
        function fit() {
          var style = getComputedStyle(area)
          var height = area.clientHeight - (parseFloat(style.paddingBottom) || 0) - (parseFloat(style.paddingTop) || 0)
          var composer = document.querySelector('[data-composer-card]')
          if (composer) {
            var boundary = composer.getBoundingClientRect().top - area.getBoundingClientRect().top
            if (boundary > 0) height = Math.min(height, boundary)
          }
          el.style.height = Math.max(240, height) + 'px'
          el.style.maxHeight = Math.max(240, height) + 'px'
        }
        fit()
        var ro = typeof ResizeObserver === 'function' ? new ResizeObserver(fit) : null
        var mo = typeof MutationObserver === 'function' ? new MutationObserver(fit) : null
        if (ro) ro.observe(area)
        var composer = document.querySelector('[data-composer-card]')
        if (ro && composer) ro.observe(composer)
        if (mo) mo.observe(area, { attributes: true, attributeFilter: ['style', 'class'] })
        window.addEventListener('resize', fit)
        return function () { if (ro) ro.disconnect(); if (mo) mo.disconnect(); window.removeEventListener('resize', fit) }
      }, [])
      useEffect(function () { return controller.subscribe(function () {
        var next = controller.panelTab()
        if (next !== lastTab.current) { lastTab.current = next; page[1](iter5PageForTab(next)) }
      }) }, [])
      useEffect(function () { var timer = setInterval(function () { identityState[1](iter5Identity()) }, 500); return function () { clearInterval(timer) } }, [])
      useEffect(function () { if (content.current) content.current.scrollTop = 0 }, [page[0]])
      function nav(id, options) {
        if (root.current && root.current.querySelector('[data-i5-dirty="true"]') && !window.confirm(L('有未保存的修改，确定离开？', 'Discard unsaved changes and leave?'))) return
        if (page[0] === 'settings') delete iter5SettingsDrafts[iter5Identity() + '|workbench']
        intent[1](options || null); page[1](id); menu[1](false)
        var row = ITER5_PAGES.filter(function (p) { return p[0] === id })[0]
        if (row && id !== 'settings') controller.setPanelTab(row[4])
        if (id === 'team' || id === 'stats') controller.setPanelTab(id)
      }
      var meta = ITER5_PAGES.filter(function (p) { return p[0] === page[0] })[0]
      var title = meta ? L(meta[1], meta[2]) : page[0] === 'team' ? L('团队协作', 'Teamwork') : L('统计', 'Statistics')
      var nonce = String(props.nonce || 0) + ':' + refresh[0]
      var components = { home: Iter5Home, library: Iter5Memory, handoff: Iter5Continue, calendar: Iter5Calendar, skills: Iter5Skills, recall: Iter5Recall, mindmap: Iter5Workspaces, storage: Iter5Storage, settings: Iter5Settings, team: Iter5Team, stats: Iter5Stats }
      var Component = components[page[0]] || Iter5Home
      function closeMenu() { menu[1](false); if (menuButton.current) menuButton.current.focus() }
      useEffect(function () {
        if (!menu[0] || !root.current) return
        var close = root.current.querySelector('[data-i5-close-nav]'); if (close) close.focus()
      }, [menu[0]])
      // 顶部仪器导轨读数窗:会话 / 检索档 / 自动沉淀计数 / 日期,全部为真实宿主数据
      var railData = useIter5Data(function () { return Promise.allSettled([apiGet(API.state, { ws: currentWs(), sessionId:currentSessionIdClient() }), apiGet(API.semanticStatus)]) }, [props.nonce])
      var railValues = railData.data || []
      var railState = railValues[0] && railValues[0].status === 'fulfilled' ? railValues[0].value : null
      var railSem = railValues[1] && railValues[1].status === 'fulfilled' ? railValues[1].value : null
      var railTier = railSem ? railSem.resolvedTier === 'c3' ? 'C3 · Python' : railSem.resolvedTier === 'c2' ? 'C2 · ' + L('内置语义', 'Semantic') : 'C1 · BM25' : '—'
      var railNow = new Date()
      var railWD = L('周日|周一|周二|周三|周四|周五|周六', 'Sun|Mon|Tue|Wed|Thu|Fri|Sat').split('|')
      function railBtn(id, zh, en, icon) {
        return h('button', { key: id, className: 'i5-rail-btn', 'data-i5-nav': id, 'aria-current': page[0] === id ? 'page' : undefined, onClick: function () { nav(id) } }, h('span', null, L(zh, en)))
      }
      function pageActions() { return h('div', { className: 'i5-page-actions' }, h('button', { 'aria-label': focus[0] ? L('退出专注查看', 'Exit focused view') : L('专注查看', 'Focused view'), 'aria-pressed': focus[0], onClick: function () { focus[1](!focus[0]) } }, h('svg', { width:16,height:16,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:1.5,'aria-hidden':true },h('path',{d:focus[0]?'M4 9h5V4M20 9h-5V4M4 15h5v5M20 15h-5v5':'M9 4H4v5M15 4h5v5M4 15v5h5M20 15v5h-5'}))), h('button', { 'aria-label': L('刷新当前页', 'Refresh current page'), onClick: function () { if (root.current.querySelector('[data-i5-dirty="true"]') && !window.confirm(L('刷新会放弃未保存修改，继续？', 'Discard changes and refresh?'))) return; if (page[0] === 'settings') delete iter5SettingsDrafts[iter5Identity() + '|workbench']; refresh[1](refresh[0] + 1) } }, h(Iter5Icon,{name:'timeline'}))) }
      function railReadout(k, v) { return h('div', { className: 'i5-rs', key: k }, h('span', { className: 'i5-rs-k' }, k), h('span', { className: 'i5-rs-v i5-num' }, v)) }
      function exitClassic() {
        if (root.current && root.current.querySelector('[data-i5-dirty="true"]') && !window.confirm(L('有未保存的修改，确定切回旧款？', 'Discard unsaved changes and return to the classic new UI?'))) return
        if (page[0] === 'settings') delete iter5SettingsDrafts[iter5Identity() + '|workbench']
        // ★2026-09-30（用户裁定）：三套新皮肤里的「返回」回**旧款**（3.2.5 的新款 UI），
        //   而不是直接回经典；旧款里的「返回经典皮肤」保持原样。两者语义不同，不得合并。
        iter5SetStyle('legacy'); props.onExit()
      }
      return h('div', { ref: root, 'data-iter5': '', 'data-native-workbench': '', 'data-i5-style': skinStyle, 'data-page': page[0], 'data-deep': deep ? 'true' : 'false', 'data-focus': String(focus[0]), role: focus[0] ? 'dialog' : undefined, 'aria-modal': focus[0] ? true : undefined, 'aria-label': focus[0] ? L('记忆工作台', 'Memory workbench') : undefined, onKeyDown: function (e) {
        if (!focus[0]) return
        if (e.key === 'Escape' && !menu[0] && !root.current.querySelector('.i5-dialog')) { e.stopPropagation(); focus[1](false) }
        if (e.key === 'Tab') {
          var nodes = Array.from(root.current.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea,[tabindex="0"]')).filter(function (n) { return n.offsetParent !== null && n.tabIndex >= 0 })
          if (!nodes.length) return
          if (e.shiftKey && document.activeElement === nodes[0]) { e.preventDefault(); nodes[nodes.length - 1].focus() }
          else if (!e.shiftKey && document.activeElement === nodes[nodes.length - 1]) { e.preventDefault(); nodes[0].focus() }
        }
      }, style: { '--dam-user-scale': FONT_SCALE_VALUES[fontScale] || '1', '--i5-blue': accentTheme !== 'deepseek' && ACCENT_VALUES[accentTheme] ? 'color-mix(in srgb, ' + ACCENT_VALUES[accentTheme] + ' 70%, var(--i5-text))' : undefined, '--i5-fill': accentTheme !== 'deepseek' ? ACCENT_VALUES[accentTheme] : undefined } },
        h('header', { className: 'i5-rail' },
          h('div', { className: 'i5-rail-brand' },
            h('svg', { viewBox: '0 0 32 32', 'aria-hidden': true },
              h('circle', { cx: 16, cy: 16, r: 13, strokeWidth: 2.2, style: { fill: 'var(--i5-recess)', stroke: 'var(--i5-tick-micro)' } }),
              h('circle', { cx: 16, cy: 16, r: 9.4, fill: 'none', strokeWidth: 1, style: { stroke: 'var(--i5-line)' } }),
              h('path', { d: 'M 8.2 23.8 A 11 11 0 0 1 16 5', fill: 'none', strokeWidth: 1.6, strokeLinecap: 'round', style: { stroke: 'var(--i5-text)' } }),
              h('path', { d: 'M 23.5 24.2 A 11 11 0 0 0 25.9 18.6', fill: 'none', strokeWidth: 2.6, strokeLinecap: 'butt', style: { stroke: 'var(--i5-orange)' } }),
              h('line', { x1: 16, y1: 16, x2: 9.4, y2: 22.6, strokeWidth: 2, strokeLinecap: 'round', style: { stroke: 'var(--i5-blue)' } }),
              h('circle', { cx: 16, cy: 16, r: 2, style: { fill: 'var(--i5-text)' } })),
            h('div', null, h('b', null, L('自动记忆', 'Auto Memory')), h('span', null, 'DSH-AUTO-MEMORY'))),
          h('nav', { className: 'i5-rail-nav', 'aria-label': L('记忆导航', 'Memory navigation') },
            h('div', { className: 'i5-rail-group' }, ITER5_PAGES.slice(0, 4).map(function (p) { return railBtn(p[0], p[1], p[2], p[0]) })),
            h('div', { className: 'i5-rail-group' }, ITER5_PAGES.slice(4, 8).map(function (p) { return railBtn(p[0], p[1], p[2], p[0]) })),
            h('div', { className: 'i5-rail-group' }, [railBtn('settings', '设置', 'Settings', 'settings'), railBtn('team', '团队', 'Team', 'mindmap'), railBtn('stats', '统计', 'Stats', 'pulse')])),
          h('div', { className: 'i5-rail-status' },
            railReadout(L('当前会话', 'Session'), currentWs() ? pathName(currentWs()) : L('尚未选择', 'Not selected')),
            railReadout(L('检索', 'Retrieval'), railTier),
            railReadout(L('自动沉淀', 'Auto memory'), railState && railState.autoStats && typeof railState.autoStats.count === 'number' ? String(railState.autoStats.count) : '—'),
            railReadout(L('日期', 'Date'), iter5Date(railNow) + ' ' + railWD[railNow.getDay()])),
          h(Iter5StylePicker), h(Iter5ModePicker), pageActions(),
          h('button', { className: 'i5-rail-exit', 'data-dam-skin-v4-exit': '', onClick: exitClassic }, L('返回经典', 'Classic'))),
        h('button', { className: 'i5-mobile-menu', ref: menuButton, 'aria-expanded': menu[0], 'aria-label': L('打开导航', 'Open navigation'), onClick: function () { menu[1](!menu[0]) } }, '☰ ', L('记忆中枢', 'Memory')),
        menu[0] ? h('div', { className: 'i5-nav-backdrop', onClick: closeMenu }) : null,
        h('aside', { className: 'i5-sidebar', 'data-open': menu[0] ? 'true' : 'false', onKeyDown: function (e) {
          if (!menu[0]) return
          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeMenu() }
          if (e.key === 'Tab') {
            var nodes = e.currentTarget.querySelectorAll('button'), first = nodes[0], last = nodes[nodes.length - 1]
            if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
            else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
          }
        } },
          h('button', { className: 'i5-close-nav', 'data-i5-close-nav': '', onClick: closeMenu }, L('关闭导航', 'Close navigation')),
          h('nav', { 'aria-label': L('记忆导航', 'Memory navigation') }, ITER5_PAGES.map(function (p, i) { return h(React.Fragment, { key: p[0] }, i === 4 ? h('small', { className: 'i5-nav-label' }, i === 0 ? L('工作', 'Work') : L('扩展', 'More')) : null,
            h('button', { 'data-i5-nav': p[0], 'aria-current': page[0] === p[0] ? 'page' : undefined, onClick: function () { nav(p[0]) } }, h('span', { className: 'i5-badge', 'data-hue': p[3] }, h(Iter5Icon, { name: p[0] })), L(p[1], p[2]))) })),
          h('div', { className: 'i5-sidebar-foot' }, h('div', { className: 'i5-side-tools' }, h('button', { onClick: function () { nav('team') }, 'aria-current': page[0] === 'team' ? 'page' : undefined }, h(Iter5Icon, { name: 'mindmap' }), L('团队', 'Team')), h('button', { onClick: function () { nav('stats') }, 'aria-current': page[0] === 'stats' ? 'page' : undefined }, h(Iter5Icon, { name: 'pulse' }), L('统计', 'Stats'))),
            h('button', { 'data-dam-skin-v4-exit': '', onClick: exitClassic }, L('返回经典皮肤', 'Back to classic')))),
        h('main', { ref: content, className: 'i5-main', key: identity, 'aria-label': title },
          h('header', { className: 'i5-page-head' }, h('div', null, h('h1', null, title), h('p', null, locale === 'zh' ? ({ home: '查看最近记录、今日日程与当前会话，继续手头的工作。', library: '集中查看用户偏好、项目笔记、每日日志与反思记录。', handoff: '让当前的目标、进度与经验，在下一段会话中继续。', calendar: '把待办与重要时刻放在一起，让每一天更从容。', recall: '回顾每一次记忆唤起，查看判定依据并留下反馈。', skills: '让反复验证的经验，沉淀为可复用的工作方法。', mindmap: '从工作区与记忆之间，发现持续连接的脉络。', storage: '查看记忆语料、维护索引，以及迁移你的积累。', settings: '决定记忆如何记录、唤回与接续，让它更适合你。' }[page[0]] || '记忆与任务，按当前工作区呈现') : 'Memory and tasks for the current workspace')),
            null),
          h('div', { className: '' }, h(Component, { key: page[0] + ':' + nonce + ':' + JSON.stringify(intent[0]), nonce: nonce, onNav: nav, intent: intent[0] })),
          page[0] === 'storage' ? h('details', { className: 'i5-card' }, h('summary', null, L('调试中心', 'Diagnostics')), h(DebugCenter), h('button', { onClick: function () { nav('settings', { group: 'behavior' }) } }, L('检查更新与高级设置', 'Updates and advanced settings'))) : null))
    }
