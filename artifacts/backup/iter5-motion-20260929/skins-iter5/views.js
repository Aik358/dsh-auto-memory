    // Product views: reference artwork informs layout, never invents data or actions.
    function Iter5Art(props) {
      var deep = useDeepTheme()
      return h('img', { className: props.className || 'i5-art', src: skinAssetUrl(props.slot || 'hero.welcome', deep), alt: '', 'aria-hidden': true, loading: 'lazy' })
    }
    function Iter5Stat(props) {
      return h('div', { className: 'i5-stat' }, h('div', { className: 'i5-stat-top' }, h('span', { className: 'i5-badge', 'data-hue': props.hue || 'blue' }, h(Iter5Icon, { name: props.icon || 'library' })), h('span', null, props.label)), h('strong', null, props.value === null || props.value === undefined ? '—' : props.value), h('small', null, props.hint))
    }
    function Iter5Empty(props) {
      return h('div', { className: 'i5-empty-state' },
        h('svg', { viewBox:'0 0 240 140',className:'i5-empty-art','aria-hidden':true },
          h('ellipse',{cx:120,cy:122,rx:79,ry:9,fill:'var(--i5-soft)'}),h('circle',{cx:120,cy:67,r:55,fill:'var(--i5-bg)'}),
          h('g',{transform:'rotate(-13 98 72)'},h('rect',{x:63,y:25,width:73,height:88,rx:12,fill:'var(--i5-soft)',stroke:'var(--i5-line)'})),
          h('g',{transform:'rotate(9 134 74)'},h('rect',{x:92,y:23,width:76,height:96,rx:12,fill:'var(--i5-surface)',stroke:'var(--i5-line)'}),h('rect',{x:108,y:40,width:26,height:24,rx:6,fill:'var(--i5-soft)'}),h('path',{d:'M109 80h40M109 91h30M109 102h36',stroke:'var(--i5-fill)',strokeWidth:3,strokeLinecap:'round',opacity:.35})),
          h('path',{d:'m181 27 3 9 9 3-9 3-3 9-3-9-9-3 9-3z',fill:'var(--i5-fill)',opacity:.6}),h('circle',{cx:48,cy:74,r:4,fill:'var(--i5-fill)',opacity:.3}),h('circle',{cx:190,cy:91,r:3,fill:'var(--i5-purple)',opacity:.2})),
        h('h3', null, props.title || L('还没有记录', 'No records yet')), h('p', null, props.text || L('有了新的记录，它们会出现在这里。', 'New records will appear here.')), props.children)
    }
    function Iter5Document(props) {
      var lines = String(props.text || '').split('\n'), code = false
      return h('div', { className: 'i5-document' }, lines.map(function (line, i) {
        if (line.trim().indexOf('```') === 0) { code = !code; return null }
        if (code) return h('pre', { key: i }, line || ' ')
        var heading = /^(#{1,6})\s+(.+)$/.exec(line)
        if (heading) return h(heading[1].length < 3 ? 'h3' : 'h4', { key: i }, heading[2])
        if (/^\s*[-*]\s+/.test(line)) return h('div', { key: i, className: 'i5-doc-bullet' }, h('i', { 'aria-hidden': true }), line.replace(/^\s*[-*]\s+/, ''))
        if (/^>\s?/.test(line)) return h('blockquote', { key: i }, line.replace(/^>\s?/, ''))
        return line.trim() ? h('p', { key: i }, line) : h('div', { key: i, className: 'i5-doc-space' })
      }))
    }
    function Iter5Home(props) {
      var result = useIter5Data(function () { return Promise.allSettled([iter5MemorySnapshot(), apiGet(API.handoffState, { sessionId: currentSessionIdClient() }), apiGet(API.calendar), apiGet(API.semanticStatus)]) }, [props.nonce])
      var values = result.data || []
      function data(i) { return values[i] && values[i].status === 'fulfilled' ? values[i].value : null }
      var memory = data(0), state = memory && memory[1], list = memory && memory[0], handoff = data(1), calendar = data(2), sem = data(3)
      var files = state && list ? iter5MemoryRows(list, state) : null
      var recentFiles = files && files.filter(function(r){return r.date}).sort(function(a,b){return String(b.date).localeCompare(String(a.date))})
      if (recentFiles && !recentFiles.length) recentFiles = files
      var water = handoff && handoff.waterLevel
      var known = water && water.window > 0 && Number.isFinite(water.ratio) && water.modelKnown !== false
      var pct = known ? Math.round(water.ratio * 100) : null
      var now = new Date(), day = iter5Date(now)
      var events = calendar && Array.isArray(calendar.entries) ? calendar.entries.filter(function (e) { return e.date === day }) : null
      var count = state && state.autoStats && typeof state.autoStats.count === 'number' ? state.autoStats.count : null
      var categories = [
        { key: 'user', title: L('用户偏好', 'Your preferences'), sub: L('值得长期记住的习惯、约定与规则', 'Lasting preferences, agreements and rules'), icon: 'heart', hue: 'pink', rows: files && files.filter(function (r) { return r.kind === 'user' }), quote: state && state.userText },
        { key: 'notes', title: L('项目知识', 'Project knowledge'), sub: L('当前项目的笔记与关键上下文', 'Notes and context for this workspace'), icon: 'folder', hue: 'green', rows: files && files.filter(function (r) { return r.kind === 'notes' }), quote: state && state.ws ? pathName(state.ws) : '' },
        { key: 'logs', title: L('工作轨迹', 'Work history'), sub: L('每日记录与反思，让经验有迹可循', 'Daily records and reflections, ready to revisit'), icon: 'timeline', hue: 'purple', rows: files && files.filter(function (r) { return r.kind === 'logs' || r.kind === 'reflections' }) },
      ]
      var tier = sem ? sem.resolvedTier === 'c3' ? 'C3 · Python' : sem.resolvedTier === 'c2' ? 'C2 · ' + L('内置语义', 'Built-in semantic') : 'C1 · BM25' : L('暂不可用', 'Unavailable')
      var recentCard = h(Iter5Card, { className: 'i5-activity' }, h('div', { className: 'i5-section-heading' }, h('h2', null, h(Iter5Icon, { name: 'timeline' }), L('最近记录', 'Recent records')), h('button', { className: 'i5-link', onClick: function () { props.onNav('library') } }, L('查看全部', 'View all'), ' →')),
              recentFiles && recentFiles.length ? recentFiles.slice(0,4).map(function (r) { return h('button', { className: 'i5-activity-row', key: r.path, onClick: function () { props.onNav('library', { path: r.path }) } }, h('span', { className: 'i5-badge', 'data-hue': r.kind === 'reflections' ? 'purple' : 'blue' }, h(Iter5Icon, { name: 'note' })), h('div', null, h('strong', null, r.label), h('small', null, r.kind === 'user' ? L('用户偏好', 'Preferences') : r.kind === 'reflections' ? L('反思', 'Reflection') : L('项目记忆', 'Project memory'))), h('small', null, fmtSize(r.size))) }) : h('p', { className: 'i5-muted' }, files ? L('还没有记录', 'No records yet') : L('正在读取记忆…', 'Loading memory…')))
      return h('div', { className: 'i5-home i5-vista' },
        result.error || values.some(function (r) { return r.status === 'rejected' }) ? h(Iter5Error, { error: result.error || L('部分数据暂不可用', 'Some data is unavailable'), retry: result.retry }) : null,
        h('div', { className: 'i5-home-stats', 'aria-busy': result.loading },
          h('div', { className: 'i5-memory-counts', role: 'group', 'aria-label': L('记忆文件总量及子项', 'Memory file total and subsets') }, h(Iter5Stat, { icon: 'library', hue: 'blue', label: L('记忆文件', 'Memory files'), value: files && files.length, hint: L('总量 · 含日志与反思', 'Total · includes logs and reflections') }),
          h(Iter5Stat, { icon: 'folder', hue: 'green', label: L('项目日志', 'Project logs'), value: list && list.logs ? list.logs.length : null, hint: L('记忆文件中的日志', 'Logs within memory files') }),
          h(Iter5Stat, { icon: 'recall', hue: 'purple', label: L('反思记录', 'Reflections'), value: list && list.reflections ? list.reflections.length : null, hint: L('记忆文件中的反思', 'Reflections within memory files') })),
          h(Iter5Stat, { icon: 'note', hue: 'orange', label: L('自动沉淀', 'Automatic memory'), value: count, hint: state && state.autoStats && state.autoStats.lastDate ? state.autoStats.lastDate + L(' · 宿主统计', ' · host count') : L('宿主自动记忆统计', 'Automatic memory count') })),
        h('section', { className: 'i5-memory-banner' }, h(Iter5Art, { className: 'i5-banner-landscape' }),
          h('span', { className: 'i5-banner-orb', 'aria-hidden': true }, h(Iter5Icon, { name: 'spark' })),
          h('div', { className: 'i5-banner-copy' }, h('h2', null, L('让过去的积累，成为下一次的起点', 'Turn what you learned into your next starting point')),
            h('p', null, L('从最近记录继续，或打开记忆库查找原文。', 'Continue from recent records, or find the source in memory.'))),
          h('button', { className: 'i5-primary-soft', onClick: function () { props.onNav('library') } }, L('打开记忆库', 'Explore memory'), ' →')),
        h('div', { className: 'i5-dashboard-columns' },
          // ★2026-09-28（本仓特有，勿被后续合并覆盖）：问候卡置于左栏**顶部** —— 复用经典 GreetingCard。
          //   它承载「昨日 + 今日各时段」的可展开抽屉与 AI 生活化总结（POST /summarize 按需拉取并缓存），
          //   是「今天发生了什么」的入口，理应最先看到；下方紧跟「记忆沉淀」三行。
          //   仅加 `i5-greet-host` 容器，由 skin.css 做作用域样式适配（不改经典组件内部结构）。
          h('div', { className: 'i5-recent-column' },
            h('div', { className: 'i5-greet-host', 'data-i5-greet': '' },
              h(GreetingCard, { greeting: state && state.greeting, periodSummary: state && state.periodSummary, t: t, nonce: props.nonce })),
            h(Iter5Card, { className: 'i5-knowledge' }, h('div', { className: 'i5-section-heading' }, h('h2', null, h(Iter5Icon, { name: 'spark' }), L('你的记忆，沉淀在这里', 'What your memory holds')), h('button', { className: 'i5-link', onClick: function () { props.onNav('library') } }, L('查看全部', 'View all'), ' →')),
            categories.map(function (c) { return h('button', { key: c.key, className: 'i5-knowledge-row', onClick: function () { props.onNav('library', { scope: c.key === 'user' ? 'user' : 'project', category: c.key === 'logs' ? 'all' : c.key }) } },
              h('span', { className: 'i5-badge i5-badge-lg', 'data-hue': c.hue }, h(Iter5Icon, { name: c.icon })), h('div', null, h('div', { className: 'i5-line-title' }, h('strong', null, c.title), h('small', null, c.rows ? c.rows.length + L(' 个文件', ' files') : '—')), h('p', null, c.sub), c.quote ? h('blockquote', null, (String(c.quote).split('\n').find(function(line){return line.trim()&&!/^\s*#/.test(line)})||'').replace(/^\s*[-*>]\s*/,'').slice(0, 110)) : h('small', null, c.rows && c.rows.length ? c.rows.slice().sort(function(a,b){return String(b.date||'').localeCompare(String(a.date||''))}).slice(0,2).map(function (r) { return r.label }).join(' · ') : L('还没有记录，随时可以开始', 'Ready when you are')))) }))),
          h('div', null,
            h(Iter5Card, { className: 'i5-context-card' }, h('div', { className: 'i5-section-heading' }, h('h2', null, h(Iter5Icon, { name: 'pulse' }), L('会话上下文', 'Conversation context')), h('button', { className: 'i5-link', onClick: function () { props.onNav('handoff') } }, L('查看交接', 'Handoff'), ' →')),
              h('div', { className: 'i5-ring-row' }, h('div', { className: 'i5-ring' },
                h('svg', { viewBox: '0 0 100 100', 'aria-hidden': true }, h('circle', { cx: 50, cy: 50, r: 40, className: 'i5-ring-track' }), h('circle', { cx: 50, cy: 50, r: 40, className: 'i5-ring-progress', strokeDasharray: '251.33', strokeDashoffset: known ? 251.33 * (1 - Math.min(1, Math.max(0, water.ratio))) : 251.33 })),
                h('div', null, h('strong', null, known ? pct + '%' : '—'), h('small', null, L('上下文水位', 'Context used')))),
                h('div', { className: 'i5-context-copy' }, h('strong', null, known ? L('跟随真实会话计量', 'Live session measurement') : L('等待会话计量', 'Waiting for measurement')),
                  h('p', null, known ? water.tokens.toLocaleString() + ' / ' + water.window.toLocaleString() + ' tokens' : L('模型窗口未知时，不估算百分比。', 'No percentage is estimated without a known window.')),
                  h('div', { className: 'i5-status-line' }, h('i', { 'data-tone': sem ? 'ok' : 'muted' }), L('当前检索：', 'Retrieval: '), tier),
                  h('div', { className: 'i5-status-line' }, h('i'), L('工作区：', 'Workspace: '), state && state.ws ? pathName(state.ws) : L('暂不可用', 'Unavailable'))))),
            h(Iter5Card, { className: 'i5-daily-card' }, h('div', { className: 'i5-section-heading' }, h('h2', null, h(Iter5Icon, { name: 'calendar' }), L('今日日程', "Today's schedule")), h('button', { className: 'i5-link', onClick: function () { props.onNav('calendar') } }, L('管理日程', 'Manage'), ' →')),
          events && events.length ? events.map(function (e, i) { return h('button', { className: 'i5-activity-row', key: i, onClick: function () { props.onNav('calendar') } }, h('span', { className: 'i5-event-dot', 'data-done': String(!!e.done) }, e.done ? '✓' : ''), h('small', null, e.time || '—'), h('strong', null, e.title)) }) : h('p', { className: 'i5-muted' }, events ? L('今天没有安排，留一点空间给新的想法。', 'No plans today. Leave some room for new ideas.') : L('日程暂不可用', 'Schedule unavailable'))),
            // ★2026-09-28（本仓特有布局）：最近记录挪到**右栏底部**（原在左栏顶部）。
            //   原因：左栏顶部腾给问候卡（含可展开抽屉 + AI 生活化总结，内容会长），
            //   右栏底部原本留白，正好容纳等高的「最近记录」，两栏视觉更均衡。
            recentCard)),
        h('details', { className: 'i5-card i5-secondary-details' }, h('summary', null, L('工作区概览、总结与技术详情', 'Workspace overview, summaries and technical details')), h('div', { className: 'i5-hosted' }, h(OverviewTab, { nonce: props.nonce }))))
    }
    function iter5Date(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') }
    function iter5LedgerTitle(name) {
      var value=String(name||'')
      var match=/(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})/.exec(value)
      return match?match[1]+'-'+match[2]+'-'+match[3]+' '+match[4]+':'+match[5]:value
    }
    function Iter5Dialog(props) {
      var ref = useRef(null)
      var deep = useDeepTheme()
      useEffect(function () {
        var before = document.activeElement
        var node = ref.current && ref.current.querySelector('input,button,textarea,select')
        if (node) node.focus()
        return function () { if (before && before.isConnected && before.focus) before.focus() }
      }, [])
      return kxPortal(h('div', { 'data-iter5': '', 'data-deep': deep ? 'true' : 'false', className: 'i5-overlay-root', style: { position: 'fixed', inset: 0, zIndex: 11000, height: 'auto', background: 'transparent', display: 'block' } }, h('div', { className: 'i5-dialog-backdrop', onMouseDown: function (e) { if (e.target === e.currentTarget) props.onClose() } },
        h('section', { ref: ref, className: 'i5-dialog', role: 'dialog', 'aria-modal': true, 'aria-label': props.title, onKeyDown: function (e) {
          if (e.key === 'Escape') { e.stopPropagation(); props.onClose() }
          if (e.key !== 'Tab') return
          var all = Array.from(e.currentTarget.querySelectorAll('button:not(:disabled),input:not(:disabled),textarea,select,[tabindex="0"]'))
          if (!all.length) return
          if (e.shiftKey && document.activeElement === all[0]) { e.preventDefault(); all[all.length - 1].focus() }
          else if (!e.shiftKey && document.activeElement === all[all.length - 1]) { e.preventDefault(); all[0].focus() }
        } }, h('div', { className: 'i5-section-heading' }, h('h2', null, props.title), h('button', { onClick: props.onClose, 'aria-label': L('关闭对话框', 'Close dialog') }, '×')), props.children))))
    }
    function Iter5Calendar(props) {
      var current = new Date(), today = iter5Date(current)
      var month = useState(new Date(current.getFullYear(), current.getMonth(), 1)), selected = useState(today)
      var draft = useState(null), busy = useState(false), error = useState(''), changed = useState(0)
      var response = useIter5Data(function () { return apiGet(API.calendar) }, [props.nonce, changed[0]])
      var entries = response.data && response.data.entries || []
      var identity = iter5Identity()
      var days = entries.filter(function (e) { return e.date === selected[0] }).sort(function (a,b) { return String(a.time || '').localeCompare(String(b.time || '')) })
      var monthPrefix = iter5Date(month[0]).slice(0,7), inMonth = entries.filter(function (e) { return String(e.date).indexOf(monthPrefix) === 0 })
      var counts = response.data ? [entries.filter(function (e) { return !e.done }).length, entries.filter(function (e) { return e.date === today && !e.done }).length, entries.filter(function (e) { return e.done }).length, inMonth.length] : [null,null,null,null]
      function act(body, close) {
        if (busy[0]) return
        busy[1](true); error[1]('')
        apiPost(API.calendar, body).then(function (d) {
          if (identity !== iter5Identity()) return
          if (d && (d.ok === false || d.error)) throw Error(d.error || d.reason || L('操作失败', 'Action failed'))
          if (close) draft[1](null)
          changed[1](function (n) { return n + 1 })
        }).catch(function (e) { if (identity === iter5Identity()) error[1](e.message) }).finally(function () { busy[1](false) })
      }
      function newEvent() { draft[1]({ title: '', date: selected[0], time: '09:00', quadrant: '重要不紧急', location: '', reminder: '', note: '' }) }
      function closeDraft() { if (busy[0]) return; if (draft[0] && draft[0].title && !window.confirm(L('放弃尚未添加的日程？', 'Discard this unsaved event?'))) return; draft[1](null) }
      function setField(k,v) { draft[1](function (d) { return Object.assign({}, d, (function () { var o={};o[k]=v;return o })()) }) }
      var cells = [], y = month[0].getFullYear(), m = month[0].getMonth()
      for (var i = 0; i < new Date(y,m,1).getDay(); i++) cells.push(null)
      for (var d = 1; d <= new Date(y,m+1,0).getDate(); d++) cells.push(iter5Date(new Date(y,m,d)))
      return h('div', { className: 'i5-calendar-view' },
        h('div', { className: 'i5-stats i5-stats-four' }, [
          ['calendar','blue',L('待办事项','Pending'),counts[0],L('所有未完成日程','All unfinished events')], ['timeline','orange',L('今日待办','Due today'),counts[1],L('今天需要关注的事项','Items to focus on today')], ['check','green',L('已完成','Completed'),counts[2],L('已标记完成的日程','Events marked complete')], ['calendar','purple',L('本月日程','This month'),counts[3],monthPrefix],
        ].map(function (a) { return h(Iter5Stat, { key:a[2],icon:a[0],hue:a[1],label:a[2],value:a[3],hint:a[4] }) })),
        response.error ? h(Iter5Error, { error: response.error, retry: response.retry }) : null,
        error[0] ? h(Iter5Error, { error: error[0] }) : null,
        h('div', { className: 'i5-calendar-columns' },
          h(Iter5Card, { className:'i5-month' }, h('div', { className:'i5-section-heading' }, h('h2',null,y+L(' 年 ',' / ')+(m+1)+L(' 月','')), h('div',{className:'i5-button-group'}, h('button',{'aria-label':L('上个月','Previous month'),onClick:function(){month[1](new Date(y,m-1,1))}},'‹'), h('button',{onClick:function(){month[1](new Date(current.getFullYear(),current.getMonth(),1));selected[1](today)}},L('今天','Today')),h('button',{'aria-label':L('下个月','Next month'),onClick:function(){month[1](new Date(y,m+1,1))}},'›'))),
            h('div',{className:'i5-month-grid',role:'group','aria-label':L('选择日期','Choose date')}, (locale==='zh'?['日','一','二','三','四','五','六']:['Su','Mo','Tu','We','Th','Fr','Sa']).map(function(w){return h('small',{key:w},w)}),cells.map(function(date, idx){
              if(!date)return h('span',{key:'empty'+idx})
              var es=entries.filter(function(e){return e.date===date})
              return h('button',{key:date,'aria-label':date+(es.length?' · '+es.length+L(' 项日程',' events'):''),'aria-pressed':date===selected[0],'data-today':String(date===today),onClick:function(){selected[1](date)}},h('span',null,Number(date.slice(-2))),h('div',{className:'i5-day-dots'},es.slice(0,3).map(function(e,j){return h('i',{key:j,'data-done':String(!!e.done)})})))
            })),h('div',{className:'i5-calendar-legend'},h('i'),L('有日程','Scheduled'),h('i',{'data-done':'true'}),L('已完成','Completed'))),
          h(Iter5Card,{className:'i5-day-agenda'},h('div',{className:'i5-section-heading'},h('h2',null,selected[0]),h('button',{className:'i5-primary',onClick:newEvent},'+ ',L('添加事项','Add event'))),
            response.loading ? h(Loading) : days.length ? days.map(function(e,i){return h('article',{className:'i5-event-card',key:i},h('span',{className:'i5-badge','data-hue':e.done?'green':'orange'},h(Iter5Icon,{name:e.done?'check':'calendar'})),h('div',{className:'i5-event-copy'},h('strong',null,e.title),e.note?h('p',null,e.note):null,h('div',{className:'i5-event-meta'},h('span',null,e.time||'—'),h('span',{className:'i5-tag'},e.quadrant||L('未分类','Unclassified')))),h('div',{className:'i5-event-actions'},h('button',{'aria-label':L('标记完成：','Complete: ')+e.title,disabled:busy[0]||e.done,onClick:function(){act({action:'done',date:e.date,time:e.time,title:e.title})}},e.done?'✓':L('完成','Done')),h('button',{className:'i5-link i5-danger','aria-label':L('删除日程：','Delete event: ')+e.title,disabled:busy[0],onClick:function(){if(window.confirm(L('确认删除日程：','Delete event: ')+e.title+'？'))act({action:'remove',date:e.date,time:e.time,title:e.title})}},L('删除','Delete'))))}) : h(Iter5Empty,{slot:'empty.timeline',title:L('这一天，还留着空白','Room for something new'),text:L('添加待办、会议或提醒，让重要的事按时发生。','Add a task, meeting or reminder for this day.')},h('button',{className:'i5-primary-soft',onClick:newEvent},'+ ',L('添加第一项日程','Add your first event'))))),
        draft[0]?h(Iter5Dialog,{title:L('添加日程','Add event'),onClose:closeDraft},h('form',{onSubmit:function(e){e.preventDefault();if(!draft[0].title.trim())return;var v=draft[0];act({date:v.date,time:v.time,quadrant:v.quadrant,title:v.title.trim(),note:[v.location?L('地点: ','Location: ')+v.location:'',v.reminder?L('提醒: ','Reminder: ')+v.reminder:'',v.note].filter(Boolean).join(' | ')},true)}},
          [['title',L('标题','Title'),'text'],['date',L('日期','Date'),'date'],['time',L('时间','Time'),'time'],['location',L('地点','Location'),'text'],['reminder',L('提醒说明','Reminder note'),'text']].map(function(f){return h('label',{key:f[0],className:'i5-form-field'},f[1],h('input',{required:f[0]==='title'||f[0]==='date',type:f[2],value:draft[0][f[0]],onChange:function(e){setField(f[0],e.target.value)}}))}),
          h('label',{className:'i5-form-field'},L('优先级','Priority'),h('select',{value:draft[0].quadrant,onChange:function(e){setField('quadrant',e.target.value)}},['重要紧急','重要不紧急','不重要紧急','不重要不紧急','未分类'].map(function(q){return h('option',{value:q,key:q},q)}))),
          h('label',{className:'i5-form-field'},L('备注','Notes'),h('textarea',{rows:3,value:draft[0].note,onChange:function(e){setField('note',e.target.value)}})),error[0]?h(Iter5Error,{error:error[0]}):null,h('div',{className:'i5-dialog-footer'},h('button',{type:'button',disabled:busy[0],onClick:closeDraft},L('取消','Cancel')),h('button',{className:'i5-primary',type:'submit',disabled:busy[0]},busy[0]?L('保存中…','Saving…'):L('添加日程','Add event'))))):null)
    }
    function Iter5Recall(props) {
      var response = useIter5Data(function () { return Promise.all([apiGet(API.shadowRecent), apiGet(API.reviewFeedback)]) }, [props.nonce])
      var selected = useState(''), filter = useState('all'), sent = useState({}), busy = useState(''), error = useState('')
      var rows = response.data ? (response.data[0].rows || []).slice().sort(function (a,b) { return (b.ts || 0) - (a.ts || 0) }) : []
      var feedback = response.data && response.data[1] || {}
      var visible = rows.filter(function (r) { return filter[0] === 'all' || r.decision === filter[0] })
      var chosen = visible.find(function (r) { return r.observationId === selected[0] }) || visible[0]
      var identity = iter5Identity()
      var alive = useRef(true)
      useEffect(function () { alive.current = true; return function () { alive.current = false } }, [])
      var meanings = { emit: L('投递', 'Emit'), prefetch: L('预取', 'Prefetch'), suppress: L('抑制', 'Suppress') }
      var choices = [['A',L('该激活','Activate')],['P',L('只预取','Prefetch')],['S',L('应抑制','Suppress')],['H',L('有害','Harmful')],['E',L('改目标','Retarget')]]
      function send(choice) {
        if (!chosen || busy[0]) return
        var id = chosen.observationId
        busy[1](id); error[1]('')
        apiPost(API.reviewFeedback, { observationId: id, choice: choice }).then(function (d) {
          if (!alive.current || identity !== iter5Identity()) return
          if (!d || !d.ok) throw Error(d && (d.reason || d.error) || L('反馈未被接受','Feedback rejected'))
          sent[1](function (old) { var n=Object.assign({},old);n[id]=choice;return n })
        }).catch(function (e) { if(alive.current && identity===iter5Identity())error[1](e.message) }).finally(function(){if(alive.current)busy[1]('')})
      }
      return h('div', { className:'i5-recall-view' },
        h('div',{className:'i5-stats i5-stats-four'},[
          ['recall','blue',L('最近判定','Recent decisions'),'all',L('接口返回的最近记录，最多 24 条','Latest host records, up to 24')],
          ['check','green',L('投递判定','Emit decisions'),'emit',L('决定向会话提供记忆','Decided to provide memory')],
          ['note','orange',L('预取判定','Prefetch decisions'),'prefetch',L('准备候选，等待合适时机','Prepared for a relevant moment')],
          ['pulse','purple',L('抑制判定','Suppressed decisions'),'suppress',L('本次未进入投递流程','Not sent for delivery')],
        ].map(function(s){return h(Iter5Stat,{key:s[3],icon:s[0],hue:s[1],label:s[2],value:response.data?(s[3]==='all'?rows.length:rows.filter(function(r){return r.decision===s[3]}).length):null,hint:s[4]})})),
        response.error?h(Iter5Error,{error:response.error,retry:response.retry}):null,
        h('div',{className:'i5-recall-columns'},
          h(Iter5Card,{className:'i5-recall-list'},h('div',{className:'i5-filter-chips',role:'group','aria-label':L('按判定筛选','Filter decisions')},['all','emit','prefetch','suppress'].map(function(k){return h('button',{key:k,'aria-pressed':filter[0]===k,onClick:function(){filter[1](k)}},k==='all'?L('全部','All'):meanings[k],h('span',null,k==='all'?rows.length:rows.filter(function(r){return r.decision===k}).length))})),
            response.loading?h(Loading):visible.length?h('div',{className:'i5-review-table',role:'list','aria-label':L('唤起记录','Recall records')},visible.map(function(r){return h('button',{key:r.observationId,className:'i5-review-row',role:'listitem','aria-current':chosen&&r.observationId===chosen.observationId?'true':undefined,onClick:function(){selected[1](r.observationId)}},h('span',{className:'i5-badge','data-hue':r.lane==='explicit'?'blue':'purple'},h(Iter5Icon,{name:'recall'})),h('div',{className:'i5-review-main'},h('strong',null,r.lane==='explicit'?L('明确召回','Explicit recall'):L('主动观测','Proactive observation')),h('small',null,(r.reasonCodes||[]).join(' · ')||L('未提供判定原因','No reason supplied')),h('small',null,r.ts?new Date(r.ts*1000).toLocaleString():L('时间暂不可用','Time unavailable'))),h('div',null,h('span',{className:'i5-tag','data-decision':r.decision},meanings[r.decision]||r.decision||'—'),h('small',null,r.memoryRefCount===null||r.memoryRefCount===undefined?'—':r.memoryRefCount+L(' 个引用',' references'))))})):h(Iter5Empty,{slot:'empty.recall',title:L('等待下一次记忆唤起','Ready for the next recall'),text:L('当宿主产生新的判定记录，它们会带着真实依据出现在这里。','New host decisions will appear here with their actual evidence.')})),
          chosen?h(Iter5Card,{className:'i5-review-detail'},h('div',{className:'i5-section-heading'},h('h2',null,L('唤起详情','Recall details')),h('span',{className:'i5-tag','data-decision':chosen.decision},meanings[chosen.decision]||chosen.decision)),
            h('div',{className:'i5-detail-intro'},h('span',{className:'i5-badge','data-hue':'blue'},h(Iter5Icon,{name:'recall'})),h('div',null,h('strong',null,chosen.lane==='explicit'?L('明确召回判定','Explicit recall decision'):L('主动观测判定','Proactive decision')),h('small',null,chosen.ts?new Date(chosen.ts*1000).toLocaleString():'—'))),
            h('div',{className:'i5-evidence-metrics'},[[L('意图概率','Intent probability'),chosen.intentProb],[L('间隔分值','Margin'),chosen.margin],[L('候选引用','Candidate references'),chosen.memoryRefCount]].map(function(k){return h('div',{key:k[0]},h('small',null,k[0]),h('strong',null,typeof k[1]==='number'?Number.isInteger(k[1])?k[1]:k[1].toFixed(3):'—'))})),
            h('h3',null,L('判定依据','Decision reasons')),h('div',{className:'i5-reason-list'},(chosen.reasonCodes||[]).length?(chosen.reasonCodes||[]).map(function(reason,i){return h('div',{key:i},h('span',{className:'i5-evidence-dot'}),reason)}):h('p',{className:'i5-muted'},L('宿主未提供原因码','No host reason codes'))),
            h('h3',null,L('引用锚点','Referenced anchors')),(chosen.anchors||[]).length?h('div',{className:'i5-anchor-list'},chosen.anchors.map(function(a){return h('div',{key:a},h(Iter5Icon,{name:'note'}),h('code',null,a))})):h('p',{className:'i5-muted'},L('没有返回引用锚点','No anchors returned')),
            h('div',{className:'i5-info-callout'},h(Iter5Icon,{name:'pulse'}),h('div',null,h('strong',null,chosen.delivery?L('匹配到投递记录','Matched delivery'):L('未匹配到投递记录','No delivery matched')),h('p',null,chosen.delivery?String(chosen.delivery.count)+L(' 个记忆引用；关联来自时间窗与引用交集，不作为精确因果证明。',' memory references; matching is heuristic, not a causal guarantee.'):L('投递记录按时间窗与引用交集关联，未匹配不等同于执行失败。','Delivery matching uses time and shared references; no match does not prove failure.')))),
            h('h3',null,L('你的反馈','Your feedback')),h('p',{className:'i5-muted'},L('反馈进入宿主审查队列，不直接改写记忆或策略。','Feedback enters the review queue without directly rewriting memory or policy.')),
            h('div',{className:'i5-feedback'},choices.map(function(c){return h('button',{key:c[0],disabled:!!busy[0],'aria-pressed':sent[0][chosen.observationId]===c[0],onClick:function(){send(c[0])}},h('strong',null,c[0]),h('span',null,c[1]))})),sent[0][chosen.observationId]?h('p',{className:'i5-success',role:'status'},L('已提交反馈：','Feedback submitted: ')+sent[0][chosen.observationId]):null,error[0]?h(Iter5Error,{error:error[0]}):null):null),
        feedback.queue&&feedback.queue.length||feedback.hints&&feedback.hints.length?h('details',{className:'i5-card i5-secondary-details'},h('summary',null,L('审查队列与策略提示','Review queue and policy notes')),h('div',{className:'i5-filter-chips'},choices.map(function(c){return h('span',{key:c[0],className:'i5-tag'},c[0]+' · '+((feedback.byChoice||{})[c[0]]||0))})),(feedback.hints||[]).map(function(s,i){return h('p',{key:i},s)})):null)
    }
    function Iter5Handoff(props) {
      var result = useIter5Data(function(){return apiGet(API.handoffState,{sessionId:currentSessionIdClient()})},[props.nonce])
      var chosen = useState(''), running = useState(false), status = useState(''), failure = useState('')
      var data = result.data, water = data && data.waterLevel
      var file = useIter5Data(function(){return chosen[0]?apiGet(API.handoffState,{sessionId:currentSessionIdClient(),file:chosen[0]}):Promise.resolve(null)},[chosen[0]])
      var known = water && water.window>0 && Number.isFinite(water.ratio) && water.modelKnown!==false
      var text = chosen[0] ? file.data && file.data.text : data && data.plan
      var ledgers = data && data.ledgers || [], versions = data && data.planVersions || []
      var identity = iter5Identity(), alive = useRef(true)
      useEffect(function(){return function(){alive.current=false}},[])
      function progress(message){if(alive.current && identity===iter5Identity())status[1](message)}
      async function continueNow(){
        if(running[0])return
        running[1](true);failure[1]('')
        try{var answer=await runContinueFlow({onProgress:progress});if(answer&&answer.ok===false)throw Error(answer.error||'busy');progress(L('已创建接续会话并装入交接材料','Continuation created with handoff material'))}
        catch(e){if(alive.current && identity===iter5Identity())failure[1](e.message)}
        finally{if(alive.current)running[1](false)}
      }
      var docs=[{name:'',title:L('当前 PLAN 白板','Current PLAN'),kind:'plan'}].concat(ledgers.map(function(v){return{name:v.name,title:iter5LedgerTitle(v.name),kind:'ledger'}}),versions.map(function(v){return{name:v.name,title:iter5LedgerTitle(v.name),kind:'archive'}}))
      return h('div',{className:'i5-handoff-view'},
        h('div',{className:'i5-handoff-overview'},h('div',{className:'i5-info-callout'},h(Iter5Icon,{name:'handoff'}),h('div',null,h('strong',null,L('上下文会流动，工作可以接着走','Context moves on. Your work can continue.')),h('p',null,L('白板记录当前状态，交接账本保留阶段经验。接续由宿主统一执行。','The whiteboard holds current state; handoff notes retain progress. The host owns continuation.')))),h('div',{className:'i5-mini-metric'},h('strong',null,known?Math.round(water.ratio*100)+'%':'—'),h('small',null,L('上下文水位','Context usage'))),h('div',{className:'i5-mini-metric'},h('strong',null,data?ledgers.length:'—'),h('small',null,L('交接账本','Handoff notes')))),
        result.error?h(Iter5Error,{error:result.error,retry:result.retry}):null,
        h('div',{className:'i5-handoff-columns'},
          h(Iter5Card,{className:'i5-handoff-index'},h('div',{className:'i5-section-heading'},h('h2',null,h(Iter5Icon,{name:'handoff'}),L('交接材料','Handoff materials'))),result.loading?h(Loading):docs.map(function(d){return h('button',{key:d.kind+':'+d.name,className:'i5-ledger-row','aria-current':chosen[0]===d.name?'true':undefined,onClick:function(){chosen[1](d.name)}},h('span',{className:'i5-badge','data-hue':d.kind==='archive'?'purple':'blue'},h(Iter5Icon,{name:d.kind==='plan'?'folder':'note'})),h('div',null,h('strong',null,d.title),h('small',null,d.kind==='plan'?L('持续更新的当前任务快照','Current task snapshot'):d.kind==='archive'?L('白板历史版本','Whiteboard history'):L('阶段交接记录','Saved handoff record'))))}),
            h('div',{className:'i5-info-callout'},h('div',null,h('strong',null,L('保留来源，按原文查看','Read it as recorded')),h('p',null,L('这里展示宿主返回的真实材料，不补写任务或虚构进度。','These are the actual host materials. No tasks or progress are invented.'))))),
          h(Iter5Card,{className:'i5-handoff-document'},h('div',{className:'i5-source-heading'},h('span',{className:'i5-badge i5-badge-lg','data-hue':'blue'},h(Iter5Icon,{name:'folder'})),h('div',null,h('h2',null,chosen[0]?iter5LedgerTitle(chosen[0]):L('当前任务 · PLAN 白板','Current task · PLAN')),h('small',null,data&&data.ws?pathName(data.ws):L('当前工作区','Current workspace')))),h('div',{className:'i5-source-meta'},h('span',{className:'i5-tag'},L('只读原文','Read-only source')),text?h('span',null,text.length+L(' 字符',' characters')):null),
            file.error?h(Iter5Error,{error:file.error,retry:file.retry}):result.loading||(chosen[0]&&file.loading)?h(Loading):text?h(Iter5Document,{text:text}):h(Iter5Empty,{slot:'empty.timeline',title:L('交接材料尚未生成','No handoff material yet'),text:data&&data.wsBound===false?L('当前会话尚未绑定工作区。','This session has no workspace binding.'):L('开启白板或完成一次阶段交接后，可以在这里回顾。','Enable the whiteboard or complete a handoff to review it here.')}),
            h('div',{className:'i5-handoff-actions'},h('button',{className:'i5-primary',disabled:running[0],onClick:continueNow},running[0]?L('正在接续…','Continuing…'):L('一键接续','Continue in a new session')),h('small',null,L('沿用宿主工作区与模型，交接材料自动装入新会话。','Uses the host workspace and model, and loads handoff material.'))),status[0]?h('p',{className:'i5-muted',role:'status'},status[0]):null,failure[0]?h(Iter5Error,{error:failure[0]}):null)),
        h('details',{className:'i5-card i5-secondary-details'},h('summary',null,L('接续开关、水位详情与完整白板看板','Continuation controls, measurement details and full whiteboard')),h('div',{className:'i5-hosted'},h(PlanTab))))
    }
    function Iter5External(props) {
      var revision=useState(0), selected=useState(''), busy=useState(false), message=useState(''), error=useState(''), search=useState('')
      var response=useIter5Data(function(){return Promise.all([apiGet(API.external),apiGet(API.config)])},[props.nonce,revision[0]])
      var sources=response.data&&response.data[0].sources||[]
      var source=sources.find(function(s){return s.id===selected[0]})||sources[0]
      var id=source&&source.id||''
      var detail=useIter5Data(function(){return id?apiGet(API.externalView,{source:id}):Promise.resolve(null)},[id,revision[0]])
      var identity=iter5Identity(), alive=useRef(true)
      useEffect(function(){return function(){alive.current=false}},[])
      function ok(){return alive.current&&identity===iter5Identity()}
      async function act(task){
        if(busy[0])return
        busy[1](true);message[1]('');error[1]('')
        try{var r=await task();if(!ok())return;if(r&&(r.ok===false||r.error))throw Error(r.error||r.reason||L('操作未完成','Action incomplete'));message[1](r&&r.result||L('操作已完成','Action completed'));revision[1](function(n){return n+1})}
        catch(e){if(ok())error[1](e.message)}finally{if(alive.current)busy[1](false)}
      }
      function toggle(s){act(async function(){var current=configOf(await apiGet(API.config));var values=Object.assign({},current.externalSources||{});values[s.id]=s.enabled===false;return saveConfigPatch({externalSources:values})})}
      function importOne(target){act(function(){return apiPost(API.externalImport,{source:id,target:target})})}
      function removeOne(target){if(!window.confirm(L('从已接入的记忆中移除该来源？原始来源文件不会被删除。','Remove this imported source from memory? Original files are preserved.')+'\n'+source.name))return;act(function(){return apiPost(API.externalRemove,{source:id,target:target})})}
      function findSource(){
        if(!source||busy[0])return
        busy[1](true);search[1]('');error[1]('')
        apiPost(API.recall,{query:source.name||source.tool||''}).then(function(r){if(ok())search[1](r.result||L('没有找到相关片段','No matching passages'))}).catch(function(e){if(ok())error[1](e.message)}).finally(function(){if(alive.current)busy[1](false)})
      }
      return h('div',{className:'i5-external-view'},
        h('div',{className:'i5-section-heading'},h('div',null,h('h2',null,L('外部记忆来源','External memory sources')),h('p',{className:'i5-muted'},L('将分散在工具中的积累，带回当前工作区。','Bring experience from your other tools into this workspace.'))),h('div',{className:'i5-button-group'},h('button',{onClick:response.retry,disabled:busy[0]},L('重新扫描','Rescan')),h('button',{className:'i5-primary-soft',disabled:busy[0]||!sources.length,onClick:function(){act(async function(){var rows=sources.filter(function(s){return s.kind!=='sessions'&&s.enabled!==false});for(var i=0;i<rows.length;i++){var r=await apiPost(API.externalImport,{source:rows[i].id,target:'project'});if(r&&(r.ok===false||r.error))throw Error(r.error||r.reason)}return{result:L('已接入来源数：','Imported sources: ')+rows.length}})}},L('接入全部可用来源','Import all available')))),
        response.error?h(Iter5Error,{error:response.error,retry:response.retry}):null,
        response.loading?h(Loading):sources.length?h('div',{className:'i5-source-grid'},sources.map(function(s,i){return h('section',{className:'i5-source-tile',key:s.id,'data-selected':String(id===s.id)},h('button',{className:'i5-source-select',onClick:function(){selected[1](s.id);search[1]('')}},h('span',{className:'i5-badge i5-badge-lg','data-hue':['blue','slate','orange','purple'][i%4]},String(s.tool||s.name||'M').slice(0,1).toUpperCase()),h('div',null,h('strong',null,s.tool||s.name),h('small',null,s.name)),h('span',{className:'i5-tag','data-connected':String(!!(s.importedUser||s.importedNotes))},s.importedUser||s.importedNotes?L('已接入','Imported'):L('已发现','Discovered'))),h('div',{className:'i5-source-bottom'},h('small',null,s.kind==='sessions'?String(s.fileCount===undefined?'—':s.fileCount)+L(' 个会话文件',' session files'):L('记忆文件','Memory file')),h('button',{className:'i5-source-toggle',role:'switch','aria-label':L('启用来源：','Enable source: ')+s.name,'aria-checked':s.enabled!==false,disabled:busy[0],onClick:function(){toggle(s)}},h('i'))))})):h(Iter5Empty,{slot:'empty.library',title:L('尚未发现外部记忆','No external memory discovered'),text:L('安装或使用支持的工具后，重新扫描即可查看可用来源。','Rescan after using a supported tool to discover its memory.')}),
        h('div',{className:'i5-info-callout'},h(Iter5Icon,{name:'check'}),h('div',null,h('strong',null,L('你决定接入什么，也能随时移除','Choose what to bring in, and remove it whenever needed')),h('p',null,L('按用户级或项目级接入；移除操作只处理导入片段，不删除原始来源文件。','Import to user or project memory. Removal affects imported passages, never the original files.')))),
        message[0]?h('p',{className:'i5-success',role:'status'},message[0]):null,error[0]?h(Iter5Error,{error:error[0]}):null,
        source?h(Iter5Card,{className:'i5-external-detail'},h('div',{className:'i5-section-heading'},h('h2',null,h(Iter5Icon,{name:'note'}),source.name),h('span',{className:'i5-tag'},L('只读来源','Read-only source'))),
          detail.error?h(Iter5Error,{error:detail.error,retry:detail.retry}):detail.loading?h(Loading):h(Iter5Document,{text:detail.data&&detail.data.content||L('该来源没有可展示的内容。','No displayable content in this source.')}),
          h('div',{className:'i5-handoff-actions'},source.kind!=='sessions'?h(React.Fragment,null,h('button',{className:'i5-primary-soft',disabled:busy[0],onClick:function(){source.importedUser?removeOne('user'):importOne('user')}},source.importedUser?L('移除用户级接入','Remove user import'):L('接入用户级记忆','Import to user memory')),h('button',{className:'i5-primary',disabled:busy[0],onClick:function(){source.importedNotes?removeOne('project'):importOne('project')}},source.importedNotes?L('移除项目接入','Remove project import'):L('接入项目笔记','Import to project notes'))):null,h('button',{disabled:busy[0],onClick:findSource},L('在记忆中查找','Find in memory'))),search[0]?h('div',{className:'i5-info-callout'},h(Iter5Document,{text:search[0]})):null):null)
    }
    function Iter5Note(props) {
      var draft=useState(''),busy=useState(false),error=useState(''),message=useState('')
      var identity=iter5Identity(),alive=useRef(true)
      useEffect(function(){alive.current=true;function protect(e){if(!draft[0].trim())return;e.preventDefault();e.returnValue=''}window.addEventListener('beforeunload',protect);return function(){alive.current=false;window.removeEventListener('beforeunload',protect)}},[draft[0]])
      function save(e){
        e.preventDefault();if(!draft[0].trim()||busy[0])return
        busy[1](true);error[1]('');message[1]('')
        apiPost(API.note,{content:draft[0].trim()}).then(function(r){if(!alive.current||identity!==iter5Identity())return;if(r&&(r.ok===false||r.error))throw Error(r.error||r.reason);draft[1]('');message[1](r.result||L('已追加到项目笔记','Appended to project notes'));if(props.onSaved)props.onSaved()}).catch(function(e){if(alive.current&&identity===iter5Identity())error[1](e.message)}).finally(function(){if(alive.current)busy[1](false)})
      }
      return h('form',{onSubmit:save,'data-i5-dirty':draft[0].trim()?'true':'false',className:'i5-note-form'},h('label',{className:'i5-form-field'},L('值得记住的内容','Something worth remembering'),h('textarea',{'aria-label':L('追加项目笔记','Append project note'),rows:5,value:draft[0],disabled:busy[0],placeholder:L('写下决定、发现，或下一次需要记住的细节…','A decision, a discovery, or a detail for next time…'),onChange:function(e){draft[1](e.target.value)}})),h('div',{className:'i5-toolbar'},h('button',{type:'submit',className:'i5-primary',disabled:busy[0]||!draft[0].trim()},busy[0]?L('保存中…','Saving…'):L('追加','Append')),h('small',null,L('以追加方式保存，不覆盖已有笔记。','Appends without overwriting existing notes.'))),message[0]?h('p',{className:'i5-success',role:'status'},message[0]):null,error[0]?h(Iter5Error,{error:error[0]}):null)
    }
    function Iter5Search(props) {
      var query=useState(props.intent&&props.intent.query||''),mode=useState('recall'),limit=useState(8),result=useState(null),busy=useState(false),error=useState('')
      var identity=iter5Identity(),alive=useRef(true)
      useEffect(function(){return function(){alive.current=false}},[])
      function search(e){
        e.preventDefault();if(!query[0].trim()||busy[0])return
        busy[1](true);error[1]('');result[1](null)
        var payload={query:query[0].trim()};if(mode[0]==='recall')payload.limit=limit[0]
        apiPost(mode[0]==='recall'?API.recall:API.smartRecall,payload).then(function(r){if(alive.current&&identity===iter5Identity())result[1](r)}).catch(function(e){if(alive.current&&identity===iter5Identity())error[1](e.message)}).finally(function(){if(alive.current)busy[1](false)})
      }
      return h('div',null,h(Iter5Card,{className:'i5-search-card'},h('div',{className:'i5-search-intro'},h('span',{className:'i5-badge i5-badge-lg','data-hue':'blue'},h(Iter5Icon,{name:'search'})),h('div',null,h('h2',null,L('想起一件事，从这里开始','Find the thought you are looking for')),h('p',{className:'i5-muted'},L('用关键词查找原文，或让智能检索整理相关线索。','Search source passages, or use smart recall to organize related clues.')))),
        h('form',{onSubmit:search},h('div',{className:'i5-toolbar'},h('input',{type:'search','aria-label':L('检索记忆','Search memories'),value:query[0],placeholder:L('搜索项目、决定、工作方法…','Search projects, decisions, working methods…'),onChange:function(e){query[1](e.target.value)}}),h('button',{className:'i5-primary',type:'submit',disabled:busy[0]||!query[0].trim()},busy[0]?L('检索中…','Searching…'):L('检索','Search'))),h('div',{className:'i5-toolbar'},h('label',null,L('检索方式 ','Mode '),h('select',{value:mode[0],disabled:busy[0],onChange:function(e){mode[1](e.target.value)}},h('option',{value:'recall'},L('记忆检索','Memory search')),h('option',{value:'smart'},L('智能检索','Smart recall')))),mode[0]==='recall'?h('label',null,L('结果条数 ','Results '),h('select',{value:limit[0],onChange:function(e){limit[1](Number(e.target.value))}},[5,8,12,20].map(function(n){return h('option',{value:n,key:n},n)}))):h('small',null,L('智能检索由宿主模型处理，可能需要更多时间。','Smart recall uses the host model and may take longer.'))))),
        error[0]?h(Iter5Error,{error:error[0]}):null,
        result[0]?h(Iter5Card,{title:L('检索结果','Search results')},result[0].result||result[0].answer?h(Iter5Document,{text:result[0].result||result[0].answer}):h(Iter5Empty,{slot:'empty.recall',title:L('暂时没有找到相关记录','No matching records'),text:L('换一个关键词，或尝试更具体的描述。','Try another keyword or a more specific description.')}),result[0].keywords&&result[0].keywords.length?h('div',{className:'i5-filter-chips'},result[0].keywords.map(function(k){return h('span',{className:'i5-tag',key:k},k)})):null,(result[0].hits||[]).map(function(hit,i){return h('div',{key:i,className:'i5-search-hit'},hit.mark?h('strong',{className:'i5-danger'},hit.mark):null,h('small',null,hit.where||''),h('p',null,hit.line||''))})):!busy[0]?h('div',{className:'i5-search-tip'},h(Iter5Icon,{name:'spark'}),L('记得大概意思也没关系，试着描述你想找的那件事。','A rough idea is enough. Describe what you want to find.')):null)
    }
    function Iter5History(props) {
      var busy=useState(false),error=useState(''),message=useState(''),revision=useState(0)
      function reflect(){if(busy[0])return;busy[1](true);error[1]('');message[1]('');apiPost(API.reflectAuto,{}).then(function(r){if(r&&(r.ok===false||r.error))throw Error(r.error||r.reason);message[1](r.result||L('反思已生成','Reflection generated'));revision[1](revision[0]+1)}).catch(function(e){error[1](e.message)}).finally(function(){busy[1](false)})}
      return h('div',{className:'i5-history'},props.kind==='reflections'?h('div',{className:'i5-info-callout'},h(Iter5Icon,{name:'spark'}),h('div',null,h('strong',null,L('让经历，变成下一次的经验','Turn experience into a lesson for next time')),h('p',null,L('基于已有记录生成反思，保留原文供你回顾。','Generate a reflection from existing records, and keep the source for review.'))),h('button',{className:'i5-primary-soft',disabled:busy[0],onClick:reflect},busy[0]?L('生成中…','Generating…'):L('生成反思','Generate reflection'))):null,error[0]?h(Iter5Error,{error:error[0]}):null,message[0]?h('p',{className:'i5-success',role:'status'},message[0]):null,h(Iter5Browse,{key:props.kind+revision[0],nonce:props.nonce,intent:{category:props.kind,scope:'project'}}),props.kind==='logs'?h('details',{className:'i5-card i5-secondary-details'},h('summary',null,L('长期规则与原始日志工具','Long-term rules and original log tools')),h('div',{className:'i5-hosted'},h(LogsTab))):null)
    }
    function Iter5Workspaces(props) {
      var revision=useState(0),scale=useState(1),selected=useState(null)
      var result=useIter5Data(function(){return apiPost(API.workspaces,{force:revision[0]>0})},[props.nonce,revision[0]])
      var data=result.data,workspaces=data&&data.workspaces||[]
      var current=selected[0]&&workspaces.find(function(w){return w.path===selected[0].path})||workspaces[0]
      var logs=workspaces.every(function(w){return typeof w.logCount==='number'})?workspaces.reduce(function(n,w){return n+w.logCount},0):null
      function resize(n){scale[1](Math.max(.55,Math.min(1.75,n)))}
      return h('div',{className:'i5-workspaces-view'},h('div',{className:'i5-stats i5-stats-three'},
        h(Iter5Stat,{icon:'folder',hue:'green',label:L('已发现工作区','Discovered workspaces'),value:data?workspaces.length:null,hint:L('有记忆记录的工作空间','Workspaces with memory records')}),
        h(Iter5Stat,{icon:'timeline',hue:'purple',label:L('日志文件','Log files'),value:data?logs:null,hint:L('这些工作区中的记录累计','Records in these workspaces')}),
        h(Iter5Stat,{icon:'mindmap',hue:'blue',label:L('主题关联','Topic connections'),value:data&&data.graph&&Array.isArray(data.graph.links)?data.graph.links.length:null,hint:L('宿主返回的工作区关联','Workspace connections returned by the host')})),
        result.error?h(Iter5Error,{error:result.error,retry:result.retry}):null,
        h('div',{className:'i5-map-columns'},h(Iter5Card,{className:'i5-map-card'},h('div',{className:'i5-section-heading'},h('h2',null,L('记忆之间的连接','Connections between memories')),h('div',{className:'i5-button-group'},h('button',{'aria-label':L('缩小关系图','Zoom out'),onClick:function(){resize(scale[0]-.1)}},'−'),h('span',{className:'i5-muted'},Math.round(scale[0]*100)+'%'),h('button',{'aria-label':L('放大关系图','Zoom in'),onClick:function(){resize(scale[0]+.1)}},'+'),h('button',{onClick:function(){scale[1](1)}},L('适应','Fit')))),
          result.loading?h(Loading):workspaces.length?h('div',{className:'i5-map-canvas'},h(WorkspaceGraph,{workspaces:workspaces,graph:data.graph,scale:scale[0],onSelect:selected[1]})):h(Iter5Empty,{title:L('连接，从第一份记忆开始','Connections start with your first memory'),text:L('工作区积累了日志与主题后，关系会在这里逐渐展开。','As workspaces collect records and topics, their connections appear here.')}),
          h('div',{className:'i5-map-legend'},h('span',null,L('中心：工作区','Centers: workspaces')),h('span',null,L('分支：记忆主题','Branches: topics')),h('span',null,L('虚线：共享主题','Dashed links: shared topics')))),
          current?h(Iter5Card,{className:'i5-map-detail'},h('div',{className:'i5-source-heading'},h('span',{className:'i5-badge i5-badge-lg','data-hue':'green'},h(Iter5Icon,{name:'folder'})),h('div',null,h('h2',null,current.name||pathName(current.path)),h('small',null,L('工作区记忆节点','Workspace memory node')))),
            current.summary?h(Iter5Document,{text:current.summary}):h('p',{className:'i5-muted'},L('这个工作区暂未生成摘要。','No summary has been generated for this workspace.')),
            h('h3',null,L('记忆主题','Memory topics')),(current.items||[]).length?h('div',{className:'i5-topic-list'},current.items.map(function(item,i){return h('div',{key:i},h(Iter5Icon,{name:'note'}),typeof item==='string'?item:JSON.stringify(item))})):h('p',{className:'i5-muted'},L('暂无主题','No topics yet')),
            h('div',{className:'i5-source-origin'},h('strong',null,L('工作区来源','Workspace source')),h('small',null,current.path),current.dateRange?h('small',null,current.dateRange):null),
            current.path===currentWs()?h('button',{className:'i5-primary-soft',onClick:function(){props.onNav('library')}},L('查看本工作区记忆','Open workspace memory'),' →'):h('p',{className:'i5-muted'},L('可在宿主侧栏切换到该工作区，继续查看记忆。','Switch to this workspace in the host sidebar to explore its memory.'))):null),
        h('div',{className:'i5-toolbar'},h('button',{disabled:result.loading,onClick:function(){revision[1](revision[0]+1)}},result.loading?L('更新中…','Refreshing…'):L('重新整理工作区','Refresh workspace map')),h('small',null,data&&data.generatedAt?L('生成于 ','Generated at ')+new Date(data.generatedAt).toLocaleString():L('摘要与关系来自宿主工作区汇总。','Summaries and links come from the host workspace index.'))))
    }
