    // Each registered surface owns a theme boundary, including sibling overlays.
    function Iter5Surface(props) {
      // ★H36：契约（L10374）要求皮肤内取深/浅一律同源；原 settings 分支直取宿主 ⇒ 设置页
      //   永远不随皮肤档变化（用户实报「这也没啥变化」）。四类外壳统一走 skinDeep。
      var skinDeep = useIter5Theme(), skinStyle = useIter5Style()
      var deep = skinDeep
      var tick = useTick()
      var boundary = useRef(null)
      useEffect(function () { return controller.subscribe(tick[1]) }, [])
      useEffect(function () {
        if (props.kind !== 'page' || !boundary.current) return
        var el = boundary.current.querySelector('[data-dam-kanban-view],[data-dam-wbg-wrap]')
        var area = el && el.closest('[data-conversation-scroll]')
        if (!el || !area) return
        function fit() {
          var style = getComputedStyle(area)
          var height = area.clientHeight - (parseFloat(style.paddingBottom) || 0) - (parseFloat(style.paddingTop) || 0)
          var composer = document.querySelector('[data-composer-card]')
          if (composer) { var top = composer.getBoundingClientRect().top - el.getBoundingClientRect().top; if (top > 0) height = Math.min(height, top - 8) }
          el.style.height = Math.max(160, height) + 'px'
          el.style.maxHeight = Math.max(160, height) + 'px'
        }
        fit()
        var observer = typeof ResizeObserver === 'function' ? new ResizeObserver(fit) : null
        if (observer) { observer.observe(area); var composer = document.querySelector('[data-composer-card]'); if (composer) observer.observe(composer) }
        window.addEventListener('resize', fit)
        return function () { if (observer) observer.disconnect(); window.removeEventListener('resize', fit) }
      }, [props.kind])
      useEffect(function () {
        var style = document.getElementById('dam-shared-ui-style')
        if (!style) {
          style = document.createElement('style')
          style.id = 'dam-shared-ui-style'
          style.dataset.plugin = '@a9i5k4/dsh-auto-memory'
          style.textContent = ITER5_CSS
          document.head.appendChild(style)
        }
        style.dataset.users = String(Number(style.dataset.users || 0) + 1)
        return function () {
          var count = Number(style.dataset.users || 1) - 1
          style.dataset.users = String(count)
          if (!count) style.remove()
        }
      }, [])
      var node = h('div', { ref: boundary, 'data-dam-theme': props.kind || 'overlay', 'data-i5-style': skinStyle, 'data-deep': String(deep),
        style: { '--dam-user-scale': FONT_SCALE_VALUES[fontScale] || '1' } }, props.children)
      // shell.overlay lives in a z-index:20 host stacking context, below settings.
      // Portal the boundary too, so sibling dialogs retain their theme tokens.
      return createPortal && ['panel', 'dialogs', 'autocont'].indexOf(props.kind) >= 0
        ? createPortal(node, document.body) : node
    }
    function Iter5HostSettings(props) {
      var skinStyle = useIter5Style()
      var identity = useState(iter5Identity)
      var root = useRef(null)
      var slot = useRef(null)
      var autoExpand = useRef(true)
      var expanded = useState(false)
      var target = useState(function () { return createPortal ? document.createElement('div') : null })[0]
      useEffect(function () {
        var el = slot.current
        if (!el || !target) return
        function measure() {
          if (autoExpand.current && el.clientWidth > 0 && el.clientWidth < 360) {
            autoExpand.current = false
            expanded[1](true)
          }
        }
        measure()
        var observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null
        if (observer) observer.observe(el)
        return function () { if (observer) observer.disconnect(); target.remove() }
      }, [])
      useEffect(function () {
        if (!target || !slot.current) return
        // Move a stable portal container, not the React form. Drafts and focus survive.
        ;(expanded[0] ? document.body : slot.current).appendChild(target)
        var el = root.current
        if (expanded[0] && el && !dialogState && !document.querySelector('.i5-overlay-root')) {
          var previous = document.activeElement
          var close = el.querySelector('[data-i5-settings-return]')
          if (close) close.focus()
          return function () { if (previous && previous.isConnected) previous.focus() }
        }
      }, [expanded[0]])
      useEffect(function () {
        function guard(e) {
          // A sibling portal dialog owns focus and Escape until it closes.
          if (document.querySelector('.i5-overlay-root')) return
          var el = root.current, dialog = slot.current && slot.current.closest('[role=dialog]')
          if (e.type === 'keydown' && e.key === 'Escape' && expanded[0] && !dialogState) {
            e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); autoExpand.current = false; expanded[1](false); return
          }
          if (!el || !dialog || !el.querySelector('[data-i5-dirty=true]')) return
          if (e.type === 'click' && (!dialog.contains(e.target) || el.contains(e.target) || !e.target.closest('button'))) return
          if (e.type === 'keydown' && (e.key !== 'Escape' || dialogState)) return
          if (!window.confirm(L('有未保存的修改，确定离开？', 'Discard unsaved changes and leave?'))) {
            e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation()
          } else delete iter5SettingsDrafts[iter5Identity() + '|host']
        }
        window.addEventListener('click', guard, true)
        window.addEventListener('keydown', guard, true)
        return function () { window.removeEventListener('click', guard, true); window.removeEventListener('keydown', guard, true) }
      }, [expanded[0]])
      useEffect(function () {
        var timer = setInterval(function () { identity[1](iter5Identity()) }, 500)
        return function () { clearInterval(timer) }
      }, [])
      var form = h(Iter5Surface, { kind: 'settings' },
        h('div', { ref: root, 'data-iter5': '', 'data-i5-embedded': '', 'data-i5-style': skinStyle, 'data-expanded': String(expanded[0]),
          role: expanded[0] ? 'dialog' : undefined, 'aria-modal': expanded[0] ? true : undefined,
          'aria-label': L('记忆设置', 'Memory settings'),
          onKeyDown: function (e) {
            if (!expanded[0] || e.key !== 'Tab') return
            var nodes = Array.from(e.currentTarget.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]')).filter(function (n) { return n.offsetParent !== null && n.tabIndex >= 0 })
            if (!nodes.length) return
            if (e.shiftKey && document.activeElement === nodes[0]) { e.preventDefault(); nodes[nodes.length - 1].focus() }
            else if (!e.shiftKey && document.activeElement === nodes[nodes.length - 1]) { e.preventDefault(); nodes[0].focus() }
          } },
          h('header', { className: 'i5-settings-frame-head' }, h('strong', null, L('记忆设置', 'Memory settings')),
            h('button', { 'data-i5-settings-return': '', onClick: function () { autoExpand.current = false; expanded[1](!expanded[0]) } }, expanded[0] ? L('返回宿主设置', 'Back to host settings') : L('展开设置', 'Expand settings'))),
          h('div', { className: 'i5-main' }, h(Iter5Settings, { key: identity[0], draftScope: 'host', close: props && props.close }))))
      return h('div', { ref: slot, 'data-i5-settings-slot': '' },
        expanded[0] ? h('button', { onClick: function () { if (root.current) root.current.querySelector('button').focus() } }, L('记忆设置已展开', 'Memory settings expanded')) : null,
        target ? createPortal(form, target) : form)
    }
    // Keep unsaved edits across host-driven unmounts, scoped to session/workspace.
    // Never persist configuration (which may include credentials) to browser storage.
    var iter5SettingsDrafts = Object.create(null)
    var iter5SettingsSequence = 0
