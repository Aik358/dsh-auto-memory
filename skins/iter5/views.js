    // Product views: reference artwork informs layout, never invents data or actions.
    function Iter5Art(props) {
      var deep = useIter5Theme()
      return h('img', { className: props.className || 'i5-art', src: skinAssetUrl(props.slot || 'hero.welcome', deep), alt: '', 'aria-hidden': true, loading: 'lazy' })
    }
    function Iter5Stat(props) {
      return h('div', { className: 'i5-stat' }, h('div', { className: 'i5-stat-top' }, h('span', { className: 'i5-badge', 'data-hue': props.hue || 'blue' }, h(Iter5Icon, { name: props.icon || 'library' })), h('span', null, props.label)), h('strong', null, props.value === null || props.value === undefined ? '—' : props.value), h('small', null, props.hint))
    }
    function Iter5Empty(props) {
      return h('div', { className: 'i5-empty-state' },
        h(Iter5Art, { slot: 'empty.library', className: 'i5-empty-art' }),
        h('h3', null, props.title || L('还没有记录', 'No records yet')), h('p', null, props.text || L('有了新的记录，它们会出现在这里。', 'New records will appear here.')), props.children)
    }
    function Iter5MemoryLoading() {
      return h('div', { className: 'i5-memory-loading', role: 'status', 'aria-busy': true },
        h('div', { className: 'i5-loading-list', 'aria-hidden': true }, [0,1,2,3,4].map(function (i) { return h('div', { key: i }, h('i'), h('span')) })),
        h('div', { className: 'i5-loading-content' }, h(Loading, { label: L('正在读取记忆…', 'Reading memory…') }), h('p', null, L('正在加载本地记忆文件，请稍候。', 'Loading local memory files. Please wait.'))))
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
    function iter5Date(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') }
    function iter5LedgerTitle(name) {
      var value=String(name||'')
      var match=/(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})/.exec(value)
      return match?match[1]+'-'+match[2]+'-'+match[3]+' '+match[4]+':'+match[5]:value
    }
    function Iter5Dialog(props) {
      var ref = useRef(null)
      var deep = useIter5Theme(), skinStyle = useIter5Style()
      useEffect(function () {
        var before = document.activeElement
        var node = ref.current && (ref.current.querySelector('input:not(:disabled),textarea:not(:disabled),select:not(:disabled)') || ref.current.querySelector('button'))
        if (node) node.focus()
        return function () { if (before && before.isConnected && before.focus) before.focus() }
      }, [])
      return kxPortal(h('div', { 'data-iter5': '', 'data-deep': deep ? 'true' : 'false', className: 'i5-overlay-root', 'data-i5-style': skinStyle, style: { position: 'fixed', inset: 0, zIndex: 2147483200, height: 'auto', background: 'transparent', display: 'block' } }, h('div', { className: 'i5-dialog-backdrop', onMouseDown: function (e) { if (e.target === e.currentTarget) props.onClose() } },
        h('section', { ref: ref, className: 'i5-dialog', role: 'dialog', 'aria-modal': true, 'aria-label': props.title, onKeyDown: function (e) {
          if (e.key === 'Escape') { e.stopPropagation(); props.onClose() }
          if (e.key !== 'Tab') return
          var all = Array.from(e.currentTarget.querySelectorAll('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),[tabindex="0"]')).filter(function (node) { return node.offsetParent !== null })
          if (!all.length) return
          if (e.shiftKey && document.activeElement === all[0]) { e.preventDefault(); all[all.length - 1].focus() }
          else if (!e.shiftKey && document.activeElement === all[all.length - 1]) { e.preventDefault(); all[0].focus() }
        } }, h('div', { className: 'i5-section-heading' }, h('h2', null, props.title), h('button', { onClick: props.onClose, 'aria-label': L('关闭对话框', 'Close dialog') }, h('svg', { width: 10, height: 10, viewBox: '0 0 10 10', 'aria-hidden': true }, h('path', { d: 'M1 1L9 9M9 1L1 9', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5 })))), props.children))))
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
      while (cells.length % 7) cells.push(null)
      return h('div', { className: 'i5-calendar-view i5-panel i5-instrument' },h(Iter5Screws),
        response.error ? h(Iter5Error, { error: response.error, retry: response.retry }) : null,
        error[0] ? h(Iter5Error, { error: error[0] }) : null,
        h('div', { className: 'i5-calendar-columns' },
          h(Iter5Card, { className:'i5-month' }, h('div', { className:'i5-section-heading' }, h('h2',null,y+L(' 年 ',' / ')+(m+1)+L(' 月','')), h('div',{className:'i5-button-group'}, h('button',{'aria-label':L('上个月','Previous month'),onClick:function(){month[1](new Date(y,m-1,1))}},'‹'), h('button',{onClick:function(){month[1](new Date(current.getFullYear(),current.getMonth(),1));selected[1](today)}},L('今天','Today')),h('button',{'aria-label':L('下个月','Next month'),onClick:function(){month[1](new Date(y,m+1,1))}},'›'))),
            h('div',{className:'i5-month-grid',role:'group','aria-label':L('选择日期','Choose date')}, (locale==='zh'?['日','一','二','三','四','五','六']:['Su','Mo','Tu','We','Th','Fr','Sa']).map(function(w){return h('small',{key:w},w)}),cells.map(function(date, idx){
              if(!date)return h('span',{key:'empty'+idx})
              var es=entries.filter(function(e){return e.date===date})
              return h('button',{key:date,'aria-label':date+(es.length?' · '+es.length+L(' 项日程',' events'):''),'aria-pressed':date===selected[0],'data-today':String(date===today),onClick:function(){selected[1](date)}},h('span',null,Number(date.slice(-2))),h('div',{className:'i5-day-dots'},es.slice(0,3).map(function(e,j){return h('i',{key:j,'data-done':String(!!e.done)})}),es.length>3?h('small',{className:'i5-day-overflow'},'+'+(es.length-3)):null))
            })),h('div',{className:'i5-calendar-legend'},h('i'),L('有日程','Scheduled'),h('i',{'data-done':'true'}),L('已完成','Completed'))),
          h(Iter5Card,{className:'i5-day-agenda'},h('div',{className:'i5-section-heading'},h('h2',null,selected[0]),h('button',{className:'i5-primary',onClick:newEvent},'+ ',L('添加事项','Add event'))),
            response.loading ? h(Loading) : days.length ? days.map(function(e,i){return h('article',{className:'i5-event-card',key:i},h('span',{className:'i5-lamp','data-lit':String(!e.done),'aria-hidden':true}),h('div',{className:'i5-event-copy'},h('strong',null,e.title),e.note?h('p',null,e.note):null,h('div',{className:'i5-event-meta'},h('span',null,e.time||'—'),h('span',{className:'i5-tag'},e.quadrant||L('未分类','Unclassified')))),h('div',{className:'i5-event-actions'},h('button',{'aria-label':L('标记完成：','Complete: ')+e.title,disabled:busy[0]||e.done,onClick:function(){act({action:'done',date:e.date,time:e.time,title:e.title})}},e.done?'✓':L('完成','Done')),h('button',{className:'i5-link i5-danger','aria-label':L('删除日程：','Delete event: ')+e.title,disabled:busy[0],onClick:function(){if(window.confirm(L('确认删除日程：','Delete event: ')+e.title+'？'))act({action:'remove',date:e.date,time:e.time,title:e.title})}},L('删除','Delete'))))}) : h(Iter5Empty,{slot:'empty.timeline',title:L('这一天，还留着空白','Room for something new'),text:L('添加待办、会议或提醒，让重要的事按时发生。','Add a task, meeting or reminder for this day.')},h('button',{className:'i5-primary-soft',onClick:newEvent},'+ ',L('添加第一项日程','Add your first event'))))),
        h('details', { className: 'i5-card i5-secondary-details' }, h('summary', null, L('日程统计', 'Schedule statistics')), h('div', { className: 'i5-stats i5-stats-four' }, [
          ['calendar','blue',L('待办事项','Pending'),counts[0],L('所有未完成日程','All unfinished events')], ['timeline','orange',L('今日待办','Due today'),counts[1],L('今天需要关注的事项','Items to focus on today')], ['check','green',L('已完成','Completed'),counts[2],L('已标记完成的日程','Events marked complete')], ['calendar','purple',L('本月日程','This month'),counts[3],monthPrefix],
        ].map(function (a) { return h(Iter5Stat, { key:a[2],icon:a[0],hue:a[1],label:a[2],value:a[3],hint:a[4] }) }))),
        draft[0]?h(Iter5Dialog,{title:L('添加日程','Add event'),onClose:closeDraft},h('form',{className:'i5-calendar-form',onSubmit:function(e){e.preventDefault();if(!draft[0].title.trim())return;var v=draft[0];act({date:v.date,time:v.time,quadrant:v.quadrant,title:v.title.trim(),note:[v.location?L('地点: ','Location: ')+v.location:'',v.reminder?L('提醒: ','Reminder: ')+v.reminder:'',v.note].filter(Boolean).join(' | ')},true)}},
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
      return h('div', { className:'i5-recall-view i5-panel i5-instrument' },h(Iter5Screws), h('div',{className:'i5-ph'},h('h2',null,L('唤起记录','Recall records')),h('span',{className:'i5-ph-right i5-num'},visible.length)),
        h('details', { className: 'i5-native-summary' }, h('summary', null, L('判定统计', 'Decision statistics')), h('div',{className:'i5-stats i5-stats-four'},[
          ['recall','blue',L('最近判定','Recent decisions'),'all',L('接口返回的最近记录，最多 24 条','Latest host records, up to 24')],
          ['check','green',L('投递判定','Emit decisions'),'emit',L('决定向会话提供记忆','Decided to provide memory')],
          ['note','orange',L('预取判定','Prefetch decisions'),'prefetch',L('准备候选，等待合适时机','Prepared for a relevant moment')],
          ['pulse','purple',L('抑制判定','Suppressed decisions'),'suppress',L('本次未进入投递流程','Not sent for delivery')],
        ].map(function(s){return h(Iter5Stat,{key:s[3],icon:s[0],hue:s[1],label:s[2],value:response.data?(s[3]==='all'?rows.length:rows.filter(function(r){return r.decision===s[3]}).length):null,hint:s[4]})}))),
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
      return h('div',{className:'i5-handoff-view i5-panel i5-instrument'+(props.boardOnly?' i5-board-reference':'')},h(Iter5Screws),
        h('div', { className: 'i5-native-handoff-banner' }, h('div', null, h('strong', null, L('接续让上下文不断档', 'Continue with your context')), h('p', null, L('将白板和交接材料带入新会话，继续当前任务。', 'Carry the whiteboard and handoff material into a new session.'))), h('div',{className:'i5-handoff-actions'},h('button',{className:'i5-primary',disabled:running[0],onClick:continueNow},running[0]?L('正在接续…','Continuing…'):L('一键接续','Continue in a new session')),h('small',null,L('沿用宿主工作区与模型，交接材料自动装入新会话。','Uses the host workspace and model, and loads handoff material.')))),
        h('div', { className: 'i5-native-handoff-status' }, L('上下文水位：', 'Context usage: '), known ? Math.round(water.ratio*100)+'%' : L('尚无可靠计量', 'Not measured'), ' · ', ledgers.length, L(' 份交接账本', ' handoff records')),
        result.error?h(Iter5Error,{error:result.error,retry:result.retry}):null,
        h('div',{className:'i5-handoff-columns'},
          h(Iter5Card,{className:'i5-handoff-index'},h('div',{className:'i5-section-heading'},h('h2',null,h(Iter5Icon,{name:'handoff'}),L('交接材料','Handoff materials'))),result.loading?h(Loading):docs.map(function(d){return h('button',{key:d.kind+':'+d.name,className:'i5-ledger-row','aria-current':chosen[0]===d.name?'true':undefined,onClick:function(){chosen[1](d.name)}},h('span',{className:'i5-badge','data-hue':d.kind==='archive'?'purple':'blue'},h(Iter5Icon,{name:d.kind==='plan'?'folder':'note'})),h('div',null,h('strong',null,d.title),h('small',null,d.kind==='plan'?L('持续更新的当前任务快照','Current task snapshot'):d.kind==='archive'?L('白板历史版本','Whiteboard history'):L('阶段交接记录','Saved handoff record'))))}),
            h('div',{className:'i5-info-callout'},h('div',null,h('strong',null,L('保留来源，按原文查看','Read it as recorded')),h('p',null,L('这里展示宿主返回的真实材料，不补写任务或虚构进度。','These are the actual host materials. No tasks or progress are invented.'))))),
          h(Iter5Card,{className:'i5-handoff-document'},h('div',{className:'i5-source-heading'},h('span',{className:'i5-badge i5-badge-lg','data-hue':'blue'},h(Iter5Icon,{name:'folder'})),h('div',null,h('h2',null,chosen[0]?iter5LedgerTitle(chosen[0]):L('当前任务 · PLAN 白板','Current task · PLAN')),h('small',null,data&&data.ws?pathName(data.ws):L('当前工作区','Current workspace')))),h('div',{className:'i5-source-meta'},h('span',{className:'i5-tag'},L('只读原文','Read-only source')),text?h('span',null,text.length+L(' 字符',' characters')):null),
            file.error?h(Iter5Error,{error:file.error,retry:file.retry}):result.loading||(chosen[0]&&file.loading)?h(Loading):text?h(Iter5Document,{text:text}):h(Iter5Empty,{slot:'empty.timeline',title:L('交接材料尚未生成','No handoff material yet'),text:data&&data.wsBound===false?L('当前会话尚未绑定工作区。','This session has no workspace binding.'):L('开启白板或完成一次阶段交接后，可以在这里回顾。','Enable the whiteboard or complete a handoff to review it here.')}),
status[0]?h('p',{className:'i5-muted',role:'status'},status[0]):null,failure[0]?h(Iter5Error,{error:failure[0]}):null)),
        h('details',{className:'i5-card i5-secondary-details'},h('summary',null,L('接续开关、水位详情与完整白板看板','Continuation controls, measurement details and full whiteboard')),h('div',{className:'i5-hosted'},h('div',{className:'i5-engr i5-hosted-label'},L('白板','Whiteboard')),h(PlanTab))))
    }
    function Iter5External(props) {
      var revision=useState(0), selected=useState(''), busy=useState(false), message=useState(''), error=useState(''), search=useState('')
      var response=useIter5Data(function(){return Promise.all([apiGet(API.external),apiGet(API.config)])},[props.nonce,revision[0]])
      var sources=response.data&&response.data[0].sources||[]
      var source=sources.find(function(s){return s.id===selected[0]})||sources[0]
      var id=source&&source.id||''
      var detail=useIter5Data(function(){return id?apiGet(API.externalView,{source:id}):Promise.resolve(null)},[id,revision[0]])
      // ★2026-10-01（用户裁定 B 方案）：全局简报状态 —— 与「外部来源」同页展示。
      //   语义归位：简报 = 继承其他 Agent 的记忆，属「外部记忆」而非「长会话接续」。
      //   形态：**一行汇总 + 抽屉展开**（展开后是逐条清单），故取数与渲染都放在本组件内。
      var briefData=useIter5Data(function(){return apiGet(API.globalBrief, { sessionId: currentSessionIdClient() })},[props.nonce,revision[0]])
      var briefOpen=useState(false)
      var brief=briefData.data||null
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
      var briefChanged=brief&&brief.changed||[]
      var briefCount=briefChanged.length
      var briefWhen=brief&&brief.at?new Date(brief.at).toLocaleTimeString():''
      var briefOn=brief&&brief.enabled===true
      // 一行汇总：状态 + 计数 + 上次检查时间；点箭头抽屉展开（展开后是逐条清单 = A 形态）
      var briefRow=h('div',{className:'i5-brief-row','data-dam-brief':''},
        h('button',{className:'i5-brief-head',type:'button','data-dam-brief-toggle':'','aria-expanded':briefOpen[0]?'true':'false',onClick:function(){briefOpen[1](!briefOpen[0])}},
          h(Iter5Icon,{name:briefCount?'note':'check'}),
          h('div',{className:'i5-brief-title'},
            h('strong',null,L('接续其他 Agent 记忆文档','Inherit other agents\' memory docs')),
            h('small',null,
              !briefOn?L('未开启：到设置里打开后才会检测','Off: enable it in settings to start watching')
              :briefCount?L('检测到 ','Detected ')+briefCount+L(' 处变化',' changes')+(briefWhen?' · '+L('上次检查 ','last check ')+briefWhen:'')
              :L('暂无变化','No changes yet')+(briefWhen?' · '+L('上次检查 ','last check ')+briefWhen:''))),
          h('i',{className:'i5-brief-caret','data-open':briefOpen[0]?'true':'false'})),
        // 详情（抽屉）：逐条列「路径 · 类型 · 来源」；未开启时给去设置的行动提示
        briefOpen[0]?h('div',{className:'i5-brief-body','data-dam-brief-body':''},
          !briefOn?h('p',{className:'i5-muted'},L('该功能已被关闭。可在「设置 → 存储与外部记忆 → 接续其他 Agent 记忆文档」重新开启；开启后这里会列出被检测到的文件变化。','This feature is off by default. Enable it under Settings → Storage → Inherit other agents\' memory docs; changes will then be listed here.'))
          :briefChanged.length?h('ul',{className:'i5-brief-list'},
            briefChanged.map(function(c,i){return h('li',{key:String(c.path||i),'data-dam-brief-item':''},
              h('span',{className:'i5-brief-kind','data-kind':String(c.kind||'')},c.kind==='added'?L('新增','added'):c.kind==='removed'?L('移除','removed'):L('变更','changed')),
              h('code',{className:'i5-brief-path'},String(c.path||'')),
              c.source?h('span',{className:'i5-brief-src'},String(c.source)):null)}) )
          :h('p',{className:'i5-muted'},L('自上次检查以来没有变化。','No changes since the last check.')),
          h('p',{className:'i5-muted i5-brief-foot'},L('只报位置与时间，不摘录内容；模型按需读取绝对路径。','Reports locations and times only, never content; the model reads absolute paths on demand.')))
        :null)
      return h('div',{className:'i5-external-view'},
        briefRow,
        h('div',{className:'i5-info-callout'},h(Iter5Icon,{name:'handoff'}),h('div',null,h('h2',null,L('接入外部来源','Connect external sources')),h('p',null,L('查看已发现的工具记忆，按用户级或项目级接入。','Review discovered tool memories and import them to user or project memory.'))),h('button',{onClick:response.retry,disabled:busy[0]},L('重新扫描','Rescan'))),
        response.error?h(Iter5Error,{error:response.error,retry:response.retry}):null,
        message[0]?h('p',{className:'i5-success',role:'status'},message[0]):null,error[0]?h(Iter5Error,{error:error[0]}):null,
        response.loading?h(Loading):sources.length?h('div',{className:'i5-external-columns'},
          h('section',{className:'i5-card i5-external-index','aria-label':L('外部来源列表','External source list')},h('h2',null,L('我的来源','My sources'),' (',sources.length,')'),
            sources.map(function(s){return h('div',{className:'i5-external-source',key:s.id,'data-selected':String(id===s.id)},
              h('button',{className:'i5-external-select','aria-current':id===s.id?'true':undefined,onClick:function(){selected[1](s.id);search[1]('')}},h(Iter5Icon,{name:s.kind==='sessions'?'timeline':'folder'}),h('div',null,h('strong',null,s.name),h('small',null,s.tool),h('span',{className:'i5-tag'},s.importedUser||s.importedNotes?L('已接入','Imported'):L('已发现','Discovered')))),
              h('button',{className:'i5-source-toggle',role:'switch','aria-label':L('启用来源：','Enable source: ')+s.name,'aria-checked':s.enabled!==false,disabled:busy[0],onClick:function(){toggle(s)}},h('i')))}),
            h('button',{className:'i5-primary-soft',disabled:busy[0]||!sources.length,onClick:function(){act(async function(){var rows=sources.filter(function(s){return s.kind!=='sessions'&&s.enabled!==false});for(var i=0;i<rows.length;i++){var r=await apiPost(API.externalImport,{source:rows[i].id,target:'project'});if(r&&(r.ok===false||r.error))throw Error(r.error||r.reason)}return{result:L('已接入来源数：','Imported sources: ')+rows.length}})}},L('接入全部可用来源','Import all available'))),
          source?h(Iter5Card,{className:'i5-external-detail'},h('div',{className:'i5-section-heading'},h('h2',null,h(Iter5Icon,{name:'folder'}),source.name),h('span',{className:'i5-tag'},L('只读来源','Read-only source'))),
            h('div',{className:'i5-source-meta'},h('span',null,source.tool||''),h('span',null,source.kind==='sessions'?String(source.fileCount===undefined?'—':source.fileCount)+L(' 个会话文件',' session files'):L('记忆文件','Memory file'))),
            h('div',{className:'i5-external-content'},detail.error?h(Iter5Error,{error:detail.error,retry:detail.retry}):detail.loading?h(Loading):h(Iter5Document,{text:detail.data&&detail.data.content||L('该来源没有可展示的内容。','No displayable content in this source.')})),
            h('div',{className:'i5-info-callout'},h(Iter5Icon,{name:'check'}),h('p',null,L('接入会复制记忆片段；移除只处理已导入的片段，不删除原始来源文件。','Import copies memory passages. Removal affects imported passages, never original source files.'))),
            h('div',{className:'i5-handoff-actions'},source.kind!=='sessions'?h(React.Fragment,null,h('button',{className:'i5-primary-soft',disabled:busy[0],onClick:function(){source.importedUser?removeOne('user'):importOne('user')}},source.importedUser?L('移除用户级接入','Remove user import'):L('接入用户级记忆','Import to user memory')),h('button',{className:'i5-primary',disabled:busy[0],onClick:function(){source.importedNotes?removeOne('project'):importOne('project')}},source.importedNotes?L('移除项目接入','Remove project import'):L('接入项目笔记','Import to project notes'))):null,h('button',{disabled:busy[0],onClick:findSource},L('在记忆中查找','Find in memory'))),search[0]?h('div',{className:'i5-info-callout'},h(Iter5Document,{text:search[0]})):null):null)
          :h(Iter5Empty,{title:L('尚未发现外部记忆','No external memory discovered'),text:L('安装或使用支持的工具后，重新扫描即可查看可用来源。','Rescan after using a supported tool to discover its memory.')}))
    }
    var iter5NoteDrafts = Object.create(null)
    function Iter5Note(props) {
      var identity=iter5Identity(),draftKey=props.persistDraft ? identity + '|' + props.persistDraft : ''
      var draft=useState(function(){return draftKey && iter5NoteDrafts[draftKey] || ''}),busy=useState(false),error=useState(''),message=useState('')
      var alive=useRef(true)
      useEffect(function(){alive.current=true;function protect(e){if(!draft[0].trim())return;e.preventDefault();e.returnValue=''}window.addEventListener('beforeunload',protect);return function(){alive.current=false;window.removeEventListener('beforeunload',protect)}},[draft[0]])
      function save(e){
        e.preventDefault();if(!draft[0].trim()||busy[0])return
        busy[1](true);error[1]('');message[1]('')
        apiPost(API.note,{content:draft[0].trim()}).then(function(r){if(!alive.current||identity!==iter5Identity())return;if(r&&(r.ok===false||r.error))throw Error(r.error||r.reason);if(draftKey)delete iter5NoteDrafts[draftKey];draft[1]('');message[1](r.result||L('已追加到项目笔记','Appended to project notes'));if(props.onSaved)props.onSaved()}).catch(function(e){if(alive.current&&identity===iter5Identity())error[1](e.message)}).finally(function(){if(alive.current)busy[1](false)})
      }
      return h('form',{onSubmit:save,'data-i5-dirty':draft[0].trim()?'true':'false',className:'i5-note-form'},props.source?h('div',{className:'i5-note-destination'},h(Iter5Icon,{name:'note'}),h('div',null,h('strong',null,L('项目笔记','Project notes')),h('small',null,props.source))):null,h('label',{className:'i5-form-field'},L('值得记住的内容','Something worth remembering'),h('textarea',{'aria-label':L('追加项目笔记','Append project note'),rows:5,value:draft[0],disabled:busy[0],placeholder:L('写下决定、发现，或下一次需要记住的细节…','A decision, a discovery, or a detail for next time…'),onChange:function(e){draft[1](e.target.value);if(draftKey){if(e.target.value)iter5NoteDrafts[draftKey]=e.target.value;else delete iter5NoteDrafts[draftKey]}}})),h('div',{className:'i5-toolbar i5-note-footer'},props.onClose?h('button',{type:'button',disabled:busy[0],onClick:function(){if(draft[0].trim()&&!window.confirm(L('放弃尚未保存的笔记？','Discard this unsaved note?')))return;props.onClose()}},L('取消','Cancel')):null,h('button',{type:'submit',className:'i5-primary',disabled:busy[0]||!draft[0].trim()},busy[0]?L('保存中…','Saving…'):L('追加','Append')),h('small',null,L('以追加方式保存，不覆盖已有笔记。','Appends without overwriting existing notes.'))),message[0]?h('p',{className:'i5-success',role:'status'},message[0]):null,error[0]?h(Iter5Error,{error:error[0]}):null)
    }
    function Iter5History(props) {
      var busy=useState(false),error=useState(''),message=useState(''),revision=useState(0)
      function reflect(){if(busy[0])return;busy[1](true);error[1]('');message[1]('');apiPost(API.reflectAuto,{}).then(function(r){if(r&&(r.ok===false||r.error))throw Error(r.error||r.reason);message[1](r.result||L('反思已生成','Reflection generated'));revision[1](revision[0]+1)}).catch(function(e){error[1](e.message)}).finally(function(){busy[1](false)})}
      return h('div',{className:'i5-history'},props.kind==='reflections'?h('div',{className:'i5-info-callout'},h(Iter5Icon,{name:'spark'}),h('div',null,h('strong',null,L('让经历，变成下一次的经验','Turn experience into a lesson for next time')),h('p',null,L('基于已有记录生成反思，保留原文供你回顾。','Generate a reflection from existing records, and keep the source for review.'))),h('button',{className:'i5-primary-soft',disabled:busy[0],onClick:reflect},busy[0]?L('生成中…','Generating…'):L('生成反思','Generate reflection'))):null,error[0]?h(Iter5Error,{error:error[0]}):null,message[0]?h('p',{className:'i5-success',role:'status'},message[0]):null,h(Iter5Browse,{key:props.kind+revision[0],nonce:props.nonce,intent:{category:props.kind,scope:'project'}}),props.kind==='logs'?h('details',{className:'i5-card i5-secondary-details'},h('summary',null,L('长期规则与原始日志工具','Long-term rules and original log tools')),h('div',{className:'i5-hosted'},h(LogsTab))):null)
    }
    function Iter5Workspaces(props) {
      var revision=useState(0),scale=useState(1),selected=useState(null),fitKey=useState(0)
      var result=useIter5Data(function(){return apiPost(API.workspaces,{force:revision[0]>0})},[props.nonce,revision[0]])
      var data=result.data,workspaces=data&&data.workspaces||[]
      var current=selected[0]&&workspaces.find(function(w){return w.path===selected[0].path})||workspaces[0]
      var logs=workspaces.every(function(w){return typeof w.logCount==='number'})?workspaces.reduce(function(n,w){return n+w.logCount},0):null
      function resize(n){scale[1](Math.max(.55,Math.min(1.75,n)))}
      return h('div',{className:'i5-workspaces-view i5-panel i5-instrument'},h(Iter5Screws),h('details', { className: 'i5-native-summary' }, h('summary', null, L('工作区统计', 'Workspace statistics')), h('div',{className:'i5-stats i5-stats-three'},
        h(Iter5Stat,{icon:'folder',hue:'green',label:L('已发现工作区','Discovered workspaces'),value:data?workspaces.length:null,hint:L('有记忆记录的工作空间','Workspaces with memory records')}),
        h(Iter5Stat,{icon:'timeline',hue:'purple',label:L('日志文件','Log files'),value:data?logs:null,hint:L('这些工作区中的记录累计','Records in these workspaces')}),
        h(Iter5Stat,{icon:'mindmap',hue:'blue',label:L('主题关联','Topic connections'),value:data&&data.graph&&Array.isArray(data.graph.links)?data.graph.links.length:null,hint:L('宿主返回的工作区关联','Workspace connections returned by the host')}))),
        result.error?h(Iter5Error,{error:result.error,retry:result.retry}):null,
        h('div',{className:'i5-map-columns'},h(Iter5Card,{className:'i5-map-card'},h('div',{className:'i5-section-heading'},h('h2',null,L('记忆之间的连接','Connections between memories')),h('div',{className:'i5-button-group'},h('button',{'aria-label':L('缩小关系图','Zoom out'),onClick:function(){resize(scale[0]-.1)}},'−'),h('span',{className:'i5-muted'},Math.round(scale[0]*100)+'%'),h('button',{'aria-label':L('放大关系图','Zoom in'),onClick:function(){resize(scale[0]+.1)}},'+'),h('button',{onClick:function(){scale[1](1);fitKey[1](fitKey[0]+1)}},L('适应','Fit')))),
          result.loading?h(Loading):workspaces.length?h('div',{className:'i5-map-canvas'},h(Iter5WorkspaceGraph,{current:current,workspaces:workspaces,graph:data.graph,scale:scale[0],fitKey:fitKey[0],onSelect:selected[1]})):h(Iter5Empty,{title:L('连接，从第一份记忆开始','Connections start with your first memory'),text:L('工作区积累了日志与主题后，关系会在这里逐渐展开。','As workspaces collect records and topics, their connections appear here.')}),
          h('div',{className:'i5-map-legend'},h('span',null,L('中心：工作区','Centers: workspaces')),h('span',null,L('分支：记忆主题','Branches: topics')),h('span',null,L('虚线：共享主题','Dashed links: shared topics')))),
          current?h(Iter5Card,{className:'i5-map-detail'},h('div',{className:'i5-source-heading'},h('span',{className:'i5-badge i5-badge-lg','data-hue':'green'},h(Iter5Icon,{name:'folder'})),h('div',null,h('h2',null,current.name||pathName(current.path)),h('small',null,L('工作区记忆节点','Workspace memory node')))),
            current.summary?h(Iter5Document,{text:current.summary}):h('p',{className:'i5-muted'},L('这个工作区暂未生成摘要。','No summary has been generated for this workspace.')),
            h('h3',null,L('记忆主题','Memory topics')),iter5UniqueTopics(current.items||[]).length?h('div',{className:'i5-topic-list'},iter5UniqueTopics(current.items||[]).map(function(item,i){return h('div',{key:i},h(Iter5Icon,{name:'note'}),typeof item==='string'?item:JSON.stringify(item))})):h('p',{className:'i5-muted'},L('暂无主题','No topics yet')),
            h('div',{className:'i5-source-origin'},h('strong',null,L('工作区来源','Workspace source')),h('small',null,current.path),current.dateRange?h('small',null,current.dateRange):null),
            current.path===currentWs()?h('button',{className:'i5-primary-soft',onClick:function(){props.onNav('library')}},L('查看本工作区记忆','Open workspace memory'),' →'):h('p',{className:'i5-muted'},L('可在宿主侧栏切换到该工作区，继续查看记忆。','Switch to this workspace in the host sidebar to explore its memory.'))):null),
        h('div',{className:'i5-toolbar'},h('button',{disabled:result.loading,onClick:function(){revision[1](revision[0]+1)}},result.loading?L('更新中…','Refreshing…'):L('重新整理工作区','Refresh workspace map')),h('small',null,data&&data.generatedAt?L('生成于 ','Generated at ')+new Date(data.generatedAt).toLocaleString():L('摘要与关系来自宿主工作区汇总。','Summaries and links come from the host workspace index.'))))
    }
