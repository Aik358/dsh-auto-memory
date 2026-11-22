    // Build results from the actual form, including rows in inactive tabs and closed details.
    function iter5SettingsSearchIndexPre(root, sections, policyPages) {
      var entries = []
      if (!root) return entries
      root.querySelectorAll('[data-dam-settings-content] > [id]').forEach(function (section) {
        var key = Object.keys(sections).find(function (name) {
          return section.id === 'dam-settings-' + name || section.id.endsWith('-section-' + name)
        })
        if (!key) return
        var heading = section.querySelector(':scope > h3')
        var title = heading ? heading.textContent.trim() : sections[key]
        entries.push({ key: key, label: title, aliases: sections[key], target: section })
        if (key === 'policy') {
          policyPages.forEach(function (page) {
            entries.push({ key: key, page: page.id, label: page.label, section: title, aliases: page.search })
          })
          return
        }
        section.querySelectorAll('[data-dam-settings-row]').forEach(function (row) {
          var label = row.querySelector('label')
          var text = label ? label.textContent.trim() : row.getAttribute('data-i5-field')
          if (!text) return
          var detail = row.querySelector('[data-dam-hint]')
          var control = row.querySelector('[data-dam-key],[data-dam-policy-legacy-key],[data-dam-policy-legacy-readonly],[data-dam-legacy-readonly]')
          var fieldKey = control && (control.getAttribute('data-dam-key') || control.getAttribute('data-dam-policy-legacy-key')
            || control.getAttribute('data-dam-policy-legacy-readonly') || control.getAttribute('data-dam-legacy-readonly'))
          entries.push({ key: key, label: text, section: title, target: row,
            aliases: [row.getAttribute('data-i5-field'), fieldKey].filter(Boolean).join(' '), hint: detail ? detail.textContent : '' })
        })
      })
      return entries
    }

    function iter5SettingsSearchMatchesPre(entries, query) {
      function normalize(value) { return String(value || '').normalize('NFKC').trim().toLowerCase() }
      var phrase = normalize(query)
      if (!phrase) return []
      var terms = phrase.split(/\s+/)
      return entries.map(function (entry) {
        var label = normalize(entry.label)
        var aliases = normalize(entry.aliases)
        var hint = normalize(entry.hint)
        var score = 0
        for (var term of terms) {
          if (label.includes(term)) score += 8
          else if (aliases.includes(term)) score += 4
          else if (hint.includes(term)) score += 1
          else return null
        }
        if (label === phrase) score += 24
        else if (label.startsWith(phrase)) score += 8
        return { entry: entry, score: score }
      }).filter(Boolean).sort(function (a, b) { return b.score - a.score }).map(function (result) { return result.entry })
    }

    function Iter5SettingsSearch(props) {
      var search = useState('')
      var results = useState([])
      var input = useRef(null)
      var pending = useRef(null)
      useEffect(function () {
        return function () { if (pending.current !== null) cancelAnimationFrame(pending.current) }
      }, [])
      function update(value) {
        search[1](value)
        results[1](value.trim()
          ? iter5SettingsSearchMatchesPre(iter5SettingsSearchIndexPre(props.root.current, props.sections, props.policyPages), value)
          : [])
      }
      function jump(entry) {
        if (!entry) return
        update('')
        props.onSelect(entry.key, entry.page)
        if (!entry.target || entry.key === 'policy' && entry.page) return
        if (pending.current !== null) cancelAnimationFrame(pending.current)
        pending.current = requestAnimationFrame(function () {
          pending.current = null
          var target = entry.target
          var root = props.root.current
          if (!root || !root.contains(target)) return
          for (var ancestor = target.parentElement; ancestor && ancestor !== root; ancestor = ancestor.parentElement) {
            if (ancestor.tagName === 'DETAILS') ancestor.open = true
          }
          // Focus the matched row without activating a switch or opening a picker.
          target.setAttribute('tabindex', '-1')
          target.focus({ preventScroll: true })
          target.scrollIntoView({ block: 'center' })
        })
      }
      var label = L('搜索设置', 'Search settings')
      var count = results[0].length
      var limit = 16
      return h('div', { className: 'i5-settings-search', role: 'search', 'aria-label': label },
        h('div', { className: 'i5-settings-search-line' },
          h(Iter5Icon, { name: 'search' }),
          h('input', { ref: input, type: 'search', 'data-dam-input': '', 'aria-label': label,
            placeholder: L('搜索设置，如：投递模式、冷却', 'Search settings, e.g. delivery mode or cooldown'),
            value: search[0], maxLength: 120, onChange: function (event) { update(event.target.value) },
            onKeyDown: function (event) {
              if (event.key === 'Enter' && !event.nativeEvent.isComposing && count) {
                event.preventDefault()
                jump(results[0][0])
              }
            } }),
          search[0] ? h('button', { type: 'button', 'data-dam-btn': '',
            onClick: function () { update(''); if (input.current) input.current.focus() } }, L('清除', 'Clear')) : null),
        search[0].trim() ? h('div', { className: 'i5-settings-search-results' },
          h('p', { className: 'i5-settings-search-status', role: 'status' }, !count
            ? L('没有匹配的设置，试试其他关键词。', 'No matching settings. Try another keyword.')
            : count > limit ? L('显示前 ' + limit + ' 项，共 ' + count + ' 项', 'Showing ' + limit + ' of ' + count + ' results')
              : L(count + ' 项匹配', count + (count === 1 ? ' result' : ' results'))),
          results[0].slice(0, limit).map(function (entry, index) {
            return h('button', { key: index, type: 'button', className: 'i5-settings-search-result', onClick: function () { jump(entry) } },
              h('strong', null, entry.label), entry.section ? h('small', null, entry.section) : null)
          })) : null)
    }
