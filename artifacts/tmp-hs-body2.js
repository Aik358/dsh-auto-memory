function Iter5HostSettings(props) {
      var skinStyle = useIter5Style()
      var identity = useState(iter5Identity)
      var root = useRef(null)
      var slot = useRef(null)
      var expanded = useState(false)
      var target = useState(function () { return createPortal ? document.createElement('div') : null })[0]
      useEffect(function () {
        var el = slot.current
        if (!el || !target) return
        function measure() { if (el.clientWidth > 0 && el.clientWidth < 360) expanded[1](true) }
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
            e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); expanded[1](false); return
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
            h('button', { 'data-i5-settings-return': '', onClick: function () { expanded[1](!expanded[0]) } }, expanded[0] ? L('返回宿主设置', 'Back to host settings') : L('展开设置', 'Expand settings'))),
          h('div', { className: 'i5-main' }, h(Iter5Settings, { key: identity[0], draftScope: 'host', close: props && props.close }))))
      return h('div', { ref: slot, 'data-i5-settings-slot': '' },
        expanded[0] ? h('button', { onClick: function () { if (root.current) root.current.querySelector('button').focus() } }, L('记忆设置已展开', 'Memory settings expanded')) : null,
        target ? createPortal(form, target) : form)
    }