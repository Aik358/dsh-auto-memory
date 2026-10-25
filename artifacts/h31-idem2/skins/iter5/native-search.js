    function Iter5Highlight(props) {
      var text = String(props.text || ''), term = String(props.term || '').trim()
      if (!term) return text
      var out = [], from = 0, at, lower = text.toLowerCase(), needle = term.toLowerCase()
      while ((at = lower.indexOf(needle, from)) >= 0) {
        out.push(text.slice(from, at), h('mark', { key: at }, text.slice(at, at + term.length)))
        from = at + term.length
      }
      out.push(text.slice(from))
      return h(React.Fragment, null, out)
    }
    function iter5SearchEntries(response, mode) {
      var entries = Array.isArray(response.hits) ? response.hits.map(function (hit) { return { title: hit.where || L('记忆片段', 'Memory passage'), text: hit.line || '', mark: hit.mark || '' } }) : []
      var summary = response.result || response.answer
      // Lexical recall returns a readable source-grouped transcript, not `hits`.
      // Preserve that transcript while exposing its exact source sections for selection.
      if (!entries.length && mode === 'recall' && typeof response.result === 'string') {
        var current = null
        response.result.split('\n').forEach(function (line) {
          var source = /^·\s+(.+):\s*$/.exec(line)
          if (source) { current = { title: source[1], text: '' }; entries.push(current) }
          else if (/^==/.test(line)) current = null
          else if (current) current.text += (current.text ? '\n' : '') + line
        })
        entries = entries.filter(function (entry) { entry.text = entry.text.trim(); return entry.text })
      }
      if (summary) entries.push({ title: mode === 'smart' ? L('检索摘要', 'Search summary') : L('检索原文', 'Search output'), text: String(summary), summary: true })
      return entries
    }
    function Iter5Search(props) {
      var query = useState(props.intent && props.intent.query || ''), mode = useState('recall'), limit = useState(8)
      var result = useState(null), busy = useState(false), error = useState(''), selected = useState(0), copied = useState('')
      var identity = iter5Identity(), alive = useRef(true), detail = useRef(null)
      useEffect(function () { alive.current = true; return function () { alive.current = false } }, [])
      function valid() { return alive.current && identity === iter5Identity() }
      function search(e) {
        e.preventDefault()
        if (!query[0].trim() || busy[0]) return
        var submitted = query[0].trim(), started = Date.now(), payload = { query: submitted }
        if (mode[0] === 'recall') payload.limit = limit[0]
        busy[1](true); error[1](''); copied[1](''); result[1](null); selected[1](0)
        apiPost(mode[0] === 'recall' ? API.recall : API.smartRecall, payload).then(function (r) {
          if (!valid()) return
          if (r && (r.ok === false || r.error)) throw Error(r.error || r.reason || L('检索失败', 'Search failed'))
          result[1]({ response: r || {}, query: submitted, elapsed: (Date.now() - started) / 1000, mode: mode[0] })
        }).catch(function (e) { if (valid()) error[1](e.message) }).finally(function () { if (valid()) busy[1](false) })
      }
      var response = result[0] && result[0].response
      var entries = response ? iter5SearchEntries(response, result[0].mode) : []
      var summary = response && (response.result || response.answer)
      var chosen = entries[selected[0]] || entries[0]
      function select(i) {
        selected[1](i); copied[1]('')
        requestAnimationFrame(function () {
          var node = detail.current
          if (!node) return
          if (node.parentElement.clientWidth < 680) node.scrollIntoView({ block: 'start', behavior: 'instant' })
          var title = node.querySelector('h2'); if (title) title.focus({ preventScroll: true })
        })
      }
      function copy() {
        if (!chosen || !navigator.clipboard) { copied[1](L('无法访问剪贴板，请选择正文复制。', 'Clipboard unavailable. Select and copy the text.')); return }
        navigator.clipboard.writeText(chosen.text).then(function () { if (valid()) copied[1](L('已复制当前内容', 'Content copied')) }, function () { if (valid()) copied[1](L('复制失败，请选择正文复制。', 'Copy failed. Select and copy the text.')) })
      }
      return h('div', { className: 'i5-native-search i5-panel i5-instrument' }, h(Iter5Screws),
        h('div', { className: 'i5-ph' }, h('h2', null, L('检索记忆', 'Search memories')), h('span', { className: 'i5-ph-right i5-num i5-search-count', role: 'status' }, response ? entries.filter(function (entry) { return !entry.summary }).length + L(' 组来源片段', ' source passages') + ' · ' + result[0].elapsed.toFixed(2) + L(' 秒', ' s') : '—')),
        h('form', { className: 'i5-native-search-form', onSubmit: search },
          h('label', { className: 'i5-native-query' }, h(Iter5Icon, { name: 'search' }), h('input', { type: 'search', 'aria-label': L('检索记忆', 'Search memories'), value: query[0], placeholder: L('搜索项目、决定、工作方法…', 'Search projects, decisions, working methods…'), onChange: function (e) { query[1](e.target.value) } })),
          h('button', { className: 'i5-primary', type: 'submit', disabled: busy[0] || !query[0].trim() }, busy[0] ? L('检索中…', 'Searching…') : L('检索', 'Search')),
          h('select', { 'aria-label': L('检索方式', 'Search mode'), value: mode[0], disabled: busy[0], onChange: function (e) { mode[1](e.target.value) } }, h('option', { value: 'recall' }, L('记忆检索', 'Memory search')), h('option', { value: 'smart' }, L('智能检索', 'Smart recall'))),
          mode[0] === 'recall' ? h('select', { 'aria-label': L('结果条数', 'Result limit'), value: limit[0], onChange: function (e) { limit[1](Number(e.target.value)) } }, [5,8,12,20].map(function (n) { return h('option', { key: n, value: n }, n + L(' 条结果', ' results')) })) : null),
        mode[0] === 'smart' ? h('p', { className: 'i5-muted' }, L('智能检索使用宿主模型，可能产生调用费用；命中片段和综合摘要分别显示。', 'Smart recall uses the host model and may incur usage costs. Passages and the summary are shown separately.')) : null,
        error[0] ? h(Iter5Error, { error: error[0] }) : null,
        busy[0] ? h('div', { role: 'status', className: 'i5-search-tip' }, h(Loading), L('正在检索当前工作区…', 'Searching this workspace…')) : null,
        response ? h(React.Fragment, null,
          entries.length ? h('div', { className: 'i5-search-columns' },
            h('div', { className: 'i5-search-results', 'aria-label': L('检索结果', 'Search results') }, entries.map(function (entry, i) { return h('button', { className: 'i5-search-result', key: i, 'aria-current': chosen === entry ? 'true' : undefined, onClick: function () { select(i) } }, h('i', { className: 'i5-type-led', 'aria-hidden': true }), h('span', null, h('strong', null, entry.title), entry.mark ? h('small', null, entry.mark) : null, h('span', { className: 'i5-search-excerpt' }, h(Iter5Highlight, { text: entry.text, term: result[0].query })))) })),
            h('section', { className: 'i5-card i5-search-detail', ref: detail, 'aria-label': L('检索详情', 'Search detail') },
              h('div', { className: 'i5-source-heading' }, h('span', { className: 'i5-badge' }, h(Iter5Icon, { name: 'note' })), h('h2', { tabIndex: -1 }, chosen.title)),
              h('div', { className: 'i5-search-content' }, h(Iter5Highlight, { text: chosen.text, term: result[0].query })),
              response.keywords && response.keywords.length ? h('div', { className: 'i5-filter-chips' }, response.keywords.map(function (k, i) { return h('span', { className: 'i5-tag', key: i }, k) })) : null,
              h('div', { className: 'i5-search-detail-actions' }, h('button', { className: 'i5-primary', onClick: copy }, L('复制当前内容', 'Copy content')), h('span', { role: 'status' }, copied[0])))) : h(Iter5Empty, { title: L('暂时没有找到相关记录', 'No matching records'), text: L('换一个关键词，或尝试更具体的描述。', 'Try another keyword or a more specific description.') })) : !busy[0] ? h('div', { className: 'i5-search-tip' }, h(Iter5Icon, { name: 'search' }), L('输入关键词，查找当前工作区中的记忆原文。', 'Enter keywords to search memory in this workspace.')) : null)
    }
