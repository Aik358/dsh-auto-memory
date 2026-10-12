    // Preserve first-seen topic order; normalize only whitespace/case for duplicate labels.
    function iter5TopicLabel(topic) { return String(typeof topic === 'string' ? topic : topic && topic.label || JSON.stringify(topic) || '').trim() }
    function iter5UniqueTopics(topics) {
      var seen = new Set()
      return topics.filter(function (topic) { var key = iter5TopicLabel(topic).replace(/\s+/g, ' ').toLocaleLowerCase(); if (!key || seen.has(key)) return false; seen.add(key); return true })
    }
    function iter5MapLabel(label) {
      function units(text) { return Array.from(text).reduce(function (n, ch) { return n + (/[^\x00-\xff]/.test(ch) ? 2 : 1) }, 0) }
      var words = String(label).trim().match(/[A-Za-z0-9_-]+|[^\s]/gu) || [], lines = ['']
      words.forEach(function (word) {
        var tokens = Array.from(word).length > 18 ? Array.from(word) : [word]
        tokens.forEach(function (token) {
          var last = lines.length - 1, gap = /[A-Za-z0-9]$/.test(lines[last]) && /^[A-Za-z0-9]/.test(token) && tokens.length === 1 ? ' ' : ''
          if (units(lines[last] + gap + token) > 18 && lines[last]) lines.push(token)
          else lines[last] += gap + token
        })
      })
      if (lines.length > 2) lines[1] = Array.from(lines[1]).slice(0, 17).join('') + '…'
      return lines.slice(0, 2)
    }
    // Inspired by dsh-context's Agent Network: centered parents, wrapped bands and curved links.
    // Workspaces remain separate roots; wrapping never implies a topic-to-topic relationship.
    function iter5WorkspaceLayout(workspaces, graph, stageWidth) {
      var nodes = [], edges = [], centers = [], top = 32
      var width = Math.max(248, Number(stageWidth) || 1000), gap = graphDensity === 'compact' ? 16 : 24
      var columns = Math.max(1, Math.min(4, Math.floor((width - 32 + gap) / (208 + gap))))
      var cardW = Math.min(248, (width - 32 - (columns - 1) * gap) / columns), cardH = 112
      workspaces.forEach(function (ws, index) {
        var topics = iter5UniqueTopics(ws.graphTopics && ws.graphTopics.length ? ws.graphTopics : ws.items || [])
        var center = { x: width / 2, y: top + cardH / 2, width: cardW, height: cardH, workspace: ws, label: ws.name || pathName(ws.path), kind: 'workspace', id: 'w' + index, topicCount: topics.length }
        nodes.push(center); centers.push(center)
        topics.forEach(function (topic, i) {
          var row = Math.floor(i / columns), count = Math.min(columns, topics.length - row * columns)
          var node = { x: width / 2 + (i % columns - (count - 1) / 2) * (cardW + gap), y: center.y + (row + 1) * (cardH + 72), width: cardW, height: cardH, label: iter5TopicLabel(topic), detail: String(topic && topic.detail || ''), workspace: ws, kind: 'topic', id: 't' + index + '-' + i, hue: i % 6 }
          nodes.push(node); edges.push({ from: center, to: node, shared: false, hue: node.hue })
        })
        top += cardH + Math.ceil(topics.length / columns) * (cardH + 72) + 80
      })
      function find(value) { var matches = centers.filter(function (node) { return node.workspace.path === value || node.workspace.name === value }); return matches.length === 1 ? matches[0] : null }
      ;(graph && graph.links || []).forEach(function (link) { var from = find(link.from), to = find(link.to); if (from && to && from !== to) edges.push({ from: from, to: to, shared: true, label: link.label || '' }) })
      return { nodes: nodes, edges: edges, width: width, height: Math.max(248, top - 48) }
    }
    function Iter5WorkspaceGraph(props) {
      var root = useRef(null), width = useState(1000), drag = useRef(null), overview = useState(!!props.allWorkspaces), selected = useState(null)
      var current = props.current || (props.workspaces || []).find(function (ws) { return selected[0] && ws.path === selected[0].path }) || (props.workspaces || [])[0]
      function choose(ws) { selected[1](ws); if (props.onSelect) props.onSelect(ws) }
      var shown = overview[0] ? props.workspaces || [] : current ? [current] : []
      var layout = iter5WorkspaceLayout(shown, props.graph, Math.max(248, width[0] - 32))
      var fit = Math.min(1, (width[0] - 32) / layout.width), factor = Math.max(.01, fit) * Math.max(.25, Number(props.scale) || 1)
      useEffect(function () {
        var el = root.current
        if (!el) return
        function measure() { width[1](Math.max(1, el.clientWidth)) }
        measure()
        var observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null
        if (observer) observer.observe(el)
        return function () { if (observer) observer.disconnect() }
      }, [])
      useEffect(function () { if (root.current) { root.current.scrollLeft = 0; root.current.scrollTop = 0 } }, [props.fitKey, overview[0], overview[0] ? '' : current && current.path])
      function release(e) { if (!drag.current || e.pointerId !== drag.current.id) return; drag.current = null; if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId) }
      var colors = ['var(--i5-pink, var(--dam-accent-purple))', 'var(--i5-cyan, var(--dam-accent-ai2))', 'var(--i5-green, var(--dam-lane-state))', 'var(--i5-purple, var(--dam-accent-purple))', 'var(--i5-orange, var(--dam-lane-progress))', 'var(--i5-blue, var(--dam-accent))']
      return h('div', { className: 'i5-native-map-root', 'data-dam-network': '' },
        h('div', { 'data-dam-network-head': '' },
          h('label', { className: 'i5-native-map-scope' }, L('查看范围 ', 'View '), h('select', { 'aria-label': L('关系图范围', 'Graph scope'), value: overview[0] ? '__all' : current && current.path || '', onChange: function (e) { overview[1](e.target.value === '__all'); var target = (props.workspaces || []).find(function (ws) { return ws.path === e.target.value }); if (target) choose(target) } }, (props.workspaces || []).map(function (ws) { return h('option', { key: ws.path, value: ws.path }, ws.name || pathName(ws.path)) }), h('option', { value: '__all' }, L('全部工作区', 'All workspaces')))),
          h('div', { 'data-dam-network-counts': '' }, h('span', null, shown.length + L(' 个工作区', ' workspaces')), h('span', null, layout.nodes.length - shown.length + L(' 个主题', ' topics')))),
        h('div', { className: 'i5-native-map', 'data-dam-graph': '', ref: root, 'data-fit-scale': fit,
        onPointerDown: function (e) { if (e.button !== 0 || e.target.closest('[data-native-map-node]')) return; drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, left: e.currentTarget.scrollLeft, top: e.currentTarget.scrollTop }; e.currentTarget.setPointerCapture(e.pointerId) },
        onPointerMove: function (e) { var start = drag.current; if (!start || start.id !== e.pointerId) return; e.currentTarget.scrollLeft = start.left + start.x - e.clientX; e.currentTarget.scrollTop = start.top + start.y - e.clientY },
        onPointerUp: release, onPointerCancel: release, onLostPointerCapture: function () { drag.current = null } },
        h('svg', { viewBox: '0 0 ' + layout.width + ' ' + layout.height, width: layout.width * factor, height: layout.height * factor, role: 'group', 'aria-label': L('工作区与记忆主题关系图', 'Workspace and memory topic graph') },
          layout.edges.map(function (edge, i) {
            var x1 = edge.from.x, y1 = edge.from.y + edge.from.height / 2, x2 = edge.to.x, y2 = edge.to.y - edge.to.height / 2
            var bend = Math.min(96, Math.max(24, (y2 - y1) / 2)), color = edge.shared ? 'var(--i5-secondary, var(--dsw-alias-label-secondary))' : colors[edge.hue]
            // Shared links use the left gutter so they do not cut through topic cards.
            var d = edge.shared ? 'M ' + (x1 - edge.from.width / 2) + ' ' + edge.from.y + ' C 0 ' + edge.from.y + ', 0 ' + edge.to.y + ', ' + (x2 - edge.to.width / 2) + ' ' + edge.to.y : 'M ' + x1 + ' ' + y1 + ' C ' + x1 + ' ' + (y1 + bend) + ', ' + x2 + ' ' + (y2 - bend) + ', ' + x2 + ' ' + y2
            return h('g', { key: 'e' + i, 'data-dam-network-link': edge.shared ? 'shared' : 'topic' }, h('title', null, edge.label || ''), h('path', { d: d, stroke: color, strokeOpacity: .55, strokeWidth: 1.5, fill: 'none', strokeDasharray: edge.shared ? '5 5' : undefined }), edge.shared ? h('text', { x: 12, y: (edge.from.y + edge.to.y) / 2, fill: 'var(--i5-secondary, var(--dsw-alias-label-secondary))', fontSize: 11 }, String(edge.label || '').slice(0, 18)) : h('circle', { cx: x2, cy: y2, r: 3, fill: color }))
          }),
          layout.nodes.map(function (node) {
            var active = node.kind === 'workspace', picked = active && current && node.workspace.path === current.path
            function select() { choose(node.workspace) }
            return h('g', { key: node.id, 'data-native-map-node': node.kind, 'data-dam-graph-node': active ? '' : undefined, 'data-dam-network-selected': picked ? 'true' : undefined, role: active ? 'button' : 'img', tabIndex: active ? 0 : undefined, 'aria-label': node.label + (node.detail ? ': ' + node.detail : ''), 'aria-pressed': active ? !!picked : undefined, onClick: active ? select : undefined, onKeyDown: active ? function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select() } } : undefined },
              h('title', null, node.label + (node.detail ? '\n' + node.detail : '') + (active ? '\n' + node.workspace.path : '')),
              h('foreignObject', { x: node.x - node.width / 2, y: node.y - node.height / 2, width: node.width, height: node.height },
                h('div', { xmlns: 'http://www.w3.org/1999/xhtml', 'data-dam-network-card': '' },
                  h('div', { 'data-dam-network-title': '' }, h('i', { style: { background: active ? 'var(--i5-blue, var(--dam-accent))' : colors[node.hue] } }), h('span', null, node.label)),
                  active ? h('strong', null, typeof node.workspace.logCount === 'number' ? node.workspace.logCount + L(' 份日志', ' logs') : L('工作区', 'Workspace')) : h('p', null, node.detail),
                  h('div', { 'data-dam-network-meta': '' }, h('span', null, active ? node.topicCount + L(' 个记忆主题', ' memory topics') : L('记忆主题', 'Memory topic')), picked ? h('span', { 'data-dam-network-badge': '' }, L('已选', 'Selected')) : null))))
          }))),
        h('div', { className: 'i5-native-map-topics' }, layout.nodes.filter(function (node) { return node.kind === 'topic' }).map(function (node) { return h('span', { key: node.id, title: node.detail }, node.label) })))
    }
