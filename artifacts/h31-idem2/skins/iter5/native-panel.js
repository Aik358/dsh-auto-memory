    // C35: a contextual record list, using the same guarded API reads as the library.
    function Iter5QuickPanel(props) {
      var result = useIter5Data(async function () {
        var snapshot = await iter5MemorySnapshot()
        var recent = iter5MemoryRows(snapshot[0], snapshot[1]).sort(function (a, b) { return String(b.date || '').localeCompare(String(a.date || '')) }).slice(0, 3)
        var previews = await Promise.allSettled(recent.map(function (r) { return apiGet(API.file, { path: r.path, ws: currentWs() }) }))
        snapshot[2] = {}
        previews.forEach(function (r, i) { if (r.status === 'fulfilled') snapshot[2][recent[i].path] = String(r.value.content || '').split('\n').filter(function (line) { return line.trim() && !/^\s*#/.test(line) }).join(' ').slice(0, 140) })
        return snapshot
      }, [props.nonce])
      var query = useState(''), selected = useState(null), writing = useState(function () { return !!iter5NoteDrafts[iter5Identity() + '|panel'] })
      var snapshot = result.data, state = snapshot && snapshot[1]
      var rows = snapshot ? iter5MemoryRows(snapshot[0], snapshot[1]) : []
      rows = rows.filter(function (r) { return (r.label + ' ' + r.path).toLowerCase().indexOf(query[0].toLowerCase()) >= 0 })
        .sort(function (a, b) { return String(b.date || '').localeCompare(String(a.date || '')) })
      var file = useIter5Data(function () { return selected[0] ? apiGet(API.file, { path: selected[0].path, ws: currentWs() }) : Promise.resolve(null) }, [selected[0] && selected[0].path, props.nonce])
      function mayLeave() {
        var root = document.querySelector('[data-native-quick-panel]')
        if (!root || !root.querySelector('[data-i5-dirty=true]')) return true
        if (!window.confirm(L('有未保存的笔记，确定放弃并离开？', 'Discard the unsaved note and leave?'))) return false
        delete iter5NoteDrafts[iter5Identity() + '|panel']
        return true
      }
      return h('div', { 'data-native-quick-panel': '', className: 'i5-native-quick' },
        h('div', { className: 'i5-quick-scroll' },
          h('div', { className: 'i5-quick-workspace' }, h(Iter5Icon, { name: 'folder' }), h('strong', null, L('当前工作区', 'Workspace')), h('span', { title: state && state.ws || '' }, state && state.ws ? pathName(state.ws) : L('尚未选择', 'Not selected'))),
          h('label', { className: 'i5-quick-search' }, h(Iter5Icon, { name: 'search' }), h('input', { type: 'search', value: query[0], placeholder: L('筛选记忆', 'Filter memories'), 'aria-label': L('筛选面板记忆', 'Filter panel memories'), onChange: function (e) { query[1](e.target.value) } })),
          result.error ? h(Iter5Error, { error: result.error, retry: result.retry }) : result.loading ? h(Loading) :
            h('div', { className: 'i5-quick-records' }, rows.length ? rows.slice(0, 3).map(function (r) {
              return h('button', { key: r.path, className: 'i5-quick-record', 'aria-expanded': !!selected[0] && selected[0].path === r.path, onClick: function () { selected[1](selected[0] && selected[0].path === r.path ? null : r) } },
                h('span', { className: 'i5-quick-icon', 'data-kind': r.kind }, h(Iter5Icon, { name: r.kind === 'logs' ? 'calendar' : 'note' })),
                h('span', { className: 'i5-quick-copy' }, h('strong', null, r.kind === 'notes' ? L('项目笔记', 'Project notes') : r.kind === 'logs' ? L('每日日志', 'Daily log') : r.kind === 'reflections' ? L('阶段反思', 'Reflections') : r.label),
                  h('span', null, snapshot[2] && snapshot[2][r.path] || r.date || r.label), h('small', null, h(Iter5Icon, { name: 'folder' }), r.scope === 'user' ? L('用户级', 'User') : state && state.ws ? pathName(state.ws) : L('本项目', 'Workspace'), ' · ', r.date || fmtSize(r.size))))
            }) : h(Iter5Empty, { title: query[0] ? L('没有匹配的记忆', 'No matching memories') : L('还没有记录', 'No records yet'), text: L('调整筛选条件，或追加项目笔记。', 'Adjust the filter or append a project note.') })),
          selected[0] ? h('section', { className: 'i5-quick-detail' }, h('h3', null, selected[0].label), file.error ? h(Iter5Error, { error: file.error, retry: file.retry }) : file.loading ? h(Loading) : h(Iter5Document, { text: file.data && file.data.content || '' })) : null,
          writing[0] ? h('section', { className: 'i5-quick-editor' }, h('h3', null, L('追加项目笔记', 'Append project note')), h(Iter5Note, { persistDraft: 'panel', onSaved: result.retry })) : null),
        h('footer', { className: 'i5-quick-actions' },
          h('button', { 'data-dam-btn': '', 'aria-expanded': writing[0], onClick: function () { if (!writing[0] || mayLeave()) writing[1](!writing[0]) } }, h(Iter5Icon, { name: 'note' }), L('追加笔记', 'Append note')),
          h('button', { 'data-dam-btn': '', onClick: function () { if (mayLeave()) props.onExpand() } }, h(Iter5Icon, { name: 'library' }), L('展开分区', 'All sections')),
          h('button', { 'data-dam-btn': '', className: 'i5-quick-open', disabled: !currentSessionIdClient(), onClick: function () { if (mayLeave()) props.onOpen() } }, h(Iter5Icon, { name: 'handoff' }), L('打开完整工作台', 'Open workbench'))))
    }
