    function Iter5StatsOverview(props) {
      return h('details', { className: 'i5-card i5-secondary-details' }, h('summary', null, L('统计范围、分布与清理', 'Scope, distribution and reset')), props.children)
    }
    function Iter5Team(props) {
      var state = useTeamTick(), team = state.team, author = useState(''), operation = useState('')
      var env = team && team.attribution || {}
      var entries = Array.isArray(env.items) ? env.items : Array.isArray(env) ? env : []
      var people = Array.from(new Set(entries.map(function (entry) { return entry.memberName || entry.memberId || '' }).filter(Boolean)))
      var operations = Array.from(new Set(entries.map(function (entry) { return entry.op || '' }).filter(Boolean)))
      var rows = entries.filter(function (entry) { return (!author[0] || (entry.memberName || entry.memberId) === author[0]) && (!operation[0] || entry.op === operation[0]) })
      var local = !team || team.localOnly === true
      return h('div', { className: 'i5-native-team i5-panel i5-instrument' },h(Iter5Screws),
        h('section', { className: 'i5-card i5-native-team-banner' }, h('span', { className: 'i5-badge' }, h(Iter5Icon, { name: 'mindmap' })), h('div', null, h('h2', null, local ? L('未连接团队', 'Team not connected') : L('团队协作', 'Teamwork')), h('p', null, local ? L('当前显示本机归属记录。多人同步与成员在场需配置团队服务。', 'Showing local attribution. Configure the team service for synchronization and presence.') : L('查看成员的归属记录，处理同步与协作事项。', 'Review attribution and manage synchronization and collaboration.'))), h('button', { className: 'i5-primary', onClick: function () { props.onNav('settings', { group: 'behavior' }) } }, L('进入团队设置', 'Team settings'), ' →')),
        h('h2', null, local ? L('本机记录', 'Local records') : L('团队记录', 'Team records')),
        h('div', { className: 'i5-toolbar' },
          h('label', null, L('按作者 ', 'Author '), h('select', { value: author[0], onChange: function (e) { author[1](e.target.value) } }, h('option', { value: '' }, L('全部', 'All')), people.map(function (name) { return h('option', { key: name, value: name }, name) }))),
          h('label', null, L('按操作 ', 'Operation '), h('select', { value: operation[0], onChange: function (e) { operation[1](e.target.value) } }, h('option', { value: '' }, L('全部操作', 'All operations')), operations.map(function (op) { return h('option', { key: op, value: op }, op) })))),
        h('div', { className: 'i5-stats i5-stats-three' }, h(Iter5Stat, { icon: 'note', label: L('归属记录', 'Attribution records'), value: rows.length, hint: L('当前筛选范围', 'Current filter') }), h(Iter5Stat, { icon: 'timeline', label: L('同步队列', 'Sync queue'), value: team && typeof team.queue === 'number' ? team.queue : null, hint: L('宿主待同步计数', 'Host pending count') }), h(Iter5Stat, { icon: 'storage', label: L('连接状态', 'Connection'), value: local ? L('本机模式', 'Local mode') : (TEAM_PHASE_ZH[teamPhaseOf(team)] && locale === 'zh' ? TEAM_PHASE_ZH[teamPhaseOf(team)] : TEAM_PHASE_EN[teamPhaseOf(team)] || teamPhaseOf(team)), hint: local ? L('可继续使用本机记录', 'Local records remain available') : L('状态由宿主提供', 'State supplied by host') })),
        h('div', { className: 'i5-card i5-native-team-table' }, h('table', { className: 'i5-storage-table' },
          h('thead', null, h('tr', null, [L('记录', 'Record'),L('作者', 'Author'),L('操作', 'Operation'),L('时间', 'Time')].map(function (label) { return h('th', { key: label, scope: 'col' }, label) }))),
          h('tbody', null, rows.length ? rows.map(function (entry, i) { return h('tr', { key: entry.key || i }, h('td', null, entry.key || '—'), h('td', null, h(TeamBadge, { name: entry.memberName || entry.memberId || '' })), h('td', null, entry.op || '—'), h('td', null, entry.at ? fmtAgoShort(entry.at) : '—')) }) : h('tr', null, h('td', { colSpan: 4 }, h(Iter5Empty, { title: L('暂无记录', 'No records'), text: L('当前筛选条件下没有归属记录。', 'No attribution records match the current filter.') })))))),
        h('details', { className: 'i5-card i5-secondary-details' }, h('summary', null, L('成员、冲突、技能审批与同步诊断', 'Members, conflicts, skill review and sync diagnostics')), h('div', { className: 'i5-hosted' }, h(TeamTab, props))))
    }
