    function iter5SkillContent(nodes, id) {
      if (!nodes) return null
      if (Array.isArray(nodes)) {
        for (var i = 0; i < nodes.length; i++) { var found = iter5SkillContent(nodes[i], id); if (found) return found }
      } else if (typeof nodes === 'object' && nodes.props) {
        if (nodes.key === String(id) && nodes.props['data-dam-content'] !== undefined) return nodes
        return iter5SkillContent(nodes.props.children, id)
      }
      return null
    }
    function Iter5SkillBrowser(props) {
      var selected = useState(''), filter = useState('all'), query = useState('')
      var all = (props.active || []).map(function (p) { return { item: p, active: true } }).concat((props.pipeline || []).map(function (p) { return { item: p, active: false } }))
      var visible = all.filter(function (row) { return (filter[0] === 'all' || row.active === (filter[0] === 'active')) && String(row.item.title || '').toLowerCase().indexOf(query[0].toLowerCase()) >= 0 })
      var current = visible.find(function (row) { return row.item.procedureId === selected[0] }) || visible[0]
      var p = current && current.item
      var extra = props.rows.filter(function (node) {
        var title = node && node.props && node.props.title
        if (typeof title === 'string' && (title.indexOf(t('hubSkills')) === 0 || title.indexOf(L('技能审批队列', 'Skill approval queue')) === 0)) return false
        return !(node && node.props && node.props['data-dam-hint'] !== undefined && node.props.children === t('hubSkills'))
      })
      return h('div', { className: 'i5-native-skills' },
        h('div', { className: 'i5-native-skill-toolbar' }, h('div', { className: 'i5-filter-chips', role: 'group', 'aria-label': L('技能筛选', 'Skill filter') }, [['all',L('全部','All'),all.length],['pending',L('观察与审批','Under review'),(props.pipeline || []).length],['active',L('已生效','Active'),(props.active || []).length]].map(function (entry) { return h('button', { key: entry[0], 'aria-pressed': filter[0] === entry[0], onClick: function () { filter[1](entry[0]) } }, entry[1], ' ('+entry[2]+')') })),
          h('input', { type: 'search', 'aria-label': L('筛选技能', 'Filter skills'), value: query[0], placeholder: L('搜索技能名称…', 'Search skill names…'), onChange: function (e) { query[1](e.target.value) } })),
        h('div', { className: 'i5-native-skill-columns' },
          h('section', { className: 'i5-card i5-native-skill-list', 'aria-label': L('技能列表', 'Skills') },
            h('h2', null, L('技能', 'Skills'), ' ('+visible.length+')'),
            visible.length ? visible.map(function (row) { return h('button', { key: row.item.procedureId, className: 'i5-native-skill-row', 'aria-current': current === row ? 'true' : undefined, onClick: function () { selected[1](row.item.procedureId) } }, h('span', { className: 'i5-badge' }, h(Iter5Icon, { name: 'skills' })), h('span', null, h('strong', null, row.item.title || row.item.procedureId), h('small', null, row.active ? L('已生效', 'Active') : stageLabel(row.item.stage)), h('small', null, row.item.scope === 'workspace' ? t('hubScopeWorkspace') : t('hubScopeGlobal')))) }) : h(Iter5Empty, { title: L('暂无匹配技能', 'No matching skills'), text: t('hubSkillsEmpty') })),
          h('section', { className: 'i5-card i5-native-skill-detail' }, p ? h(React.Fragment, null,
            h('div', { className: 'i5-source-heading' }, h('span', { className: 'i5-badge' }, h(Iter5Icon, { name: 'note' })), h('h2', null, p.title || p.procedureId), h('span', { className: 'i5-tag' }, current.active ? L('已生效', 'Active') : stageLabel(p.stage))),
            h('h3', null, L('执行步骤', 'Steps')), (p.steps || []).length ? h('ol', null, p.steps.map(function (step, i) { return h('li', { key: i }, typeof step === 'string' ? step : JSON.stringify(step)) })) : h('p', { className: 'i5-muted' }, t('hubNoSteps')),
            h('h3', null, L('成功条件', 'Success criteria')), (p.successCriteria || []).length ? h('ul', null, p.successCriteria.map(function (criterion, i) { return h('li', { key: i }, typeof criterion === 'string' ? criterion : JSON.stringify(criterion)) })) : h('p', { className: 'i5-muted' }, L('尚未提供成功条件。', 'No success criteria supplied.')),
            h('h3', null, L('来源、依据与操作', 'Evidence and actions')), h('div', { className: 'i5-hosted i5-native-skill-actions' }, iter5SkillContent(props.rows, p.procedureId))) : h(Iter5Empty, { title: L('选择技能查看详情', 'Select a skill'), text: L('技能步骤、依据和可执行操作会显示在这里。', 'Steps, evidence and available actions appear here.') }))),
        h('details', { className: 'i5-card i5-secondary-details' }, h('summary', null, L('记忆库归属、事实与经历', 'Library scope, facts and episodes')), h('div', { className: 'i5-hosted' }, extra)))
    }
