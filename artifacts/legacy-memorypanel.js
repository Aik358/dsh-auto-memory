function MemoryPanel() {
      // ★2026-09-28 跟进社区作者 PR #146：轻面板**紧凑/展开双态**。
      //   ★所有者裁定（同日）：**默认「全部分区」**（compact=false），紧凑视图作为可选项保留 ——
      //   理由是面板的核心用途是看分区内容，默认收起会让人以为功能变少；想精简的人可一键切「轻量概览」。
      //   两态语义：全部分区 = 页签条 + 当前页（原行为，一字不改）；轻量概览 = 只渲染 `OverviewTab` 且隐藏页签条。
      //   两个入口：「轻量概览/展开全部分区」切换，以及「打开完整工作台」（跳到会话「记忆」页）。
      //   hooks 必须无条件调用 ⇒ 本 useState 置于所有早退之前（与既有纪律一致）。
      var compact = useState(false)
      var tick = useTick()
      var panelRef = useRef(null)
      // 页签状态走模块级共享(2026-09-21):浮层与「记忆」会话页读同一个 panelTab ⇒ 两处切页互相同步。
      // (用户诉求原话:「两者共存…要保证同步」。不用两份 useState,从根上杜绝状态漂移。)
      var tab = controller.panelTab()
      var setTab = controller.setPanelTab
      // 刷新 nonce:每次打开面板 / 点 ⟳ 时递增,驱动各页签重拉数据
      var noncePair = useState(0)
      var nonce = noncePair[0]
      var setNonce = noncePair[1]
      var verPair = useState(null)
      var ver = verPair[0]
      var setVer = verPair[1]
      var g = controller.geom()
      var pos = controller.panelPos()
      useEffect(function () { return controller.subscribe(tick[1]) }, [])
      // 真实版本号(#15):面板头徽标不再硬编码,从 update-check 的 current(读包 version)取,失败留空
      useEffect(function () {
        var alive = true
        apiGet(API.updateCheck).then(function (d) { if (alive && d && d.current) setVer(d.current) }).catch(function () {})
        return function () { alive = false }
      }, [])
      // 可读性兜底(@ProperSAMA PR#12,适配版):DSH Desktop 增强模式 + 透明/Mica 窗口材质下,
      // 主题令牌 --dsw-alias-bg-layer-2 本身就是半透明的,面板文字几乎不可读。判别信号用
      // 「令牌自身的 alpha」(增强模式显著低于普通模式的 0.86-0.9):< 0.65 时把面板背景提升到
      // 0.96(保留色相)并弱化顶部高光。普通模式令牌不透明 → 不触发,液态玻璃观感零变化。
      // 2026-09-21:两种形态(浮层/顶部停靠条)各查一次 —— panelRef 只绑浮层,停靠条用选择器兜底,
      // 否则增强模式下顶栏模式会保持半透明、可读性退化。
      useEffect(function () {
        if (!panelOpen) return
        // 2026-09-21 二次修正:原「顶部停靠条」第二形态已废弃(改走 conversation.view 会话页),
        // 故此处只剩浮层一个元素需要兜底 —— 会话页在正常文档流里,背景由宿主给,无需提升不透明度。
        var els = panelRef.current ? [panelRef.current] : []
        for (var j = 0; j < els.length; j++) {
          var el = els[j]
          if (!el) continue
          try {
            var cs = getComputedStyle(el)
            var token = cs.getPropertyValue('--dsw-alias-bg-layer-2')
            var col = parseCssColor((token || '').trim() || cs.backgroundColor)
            if (col && col.a < 0.65) {
              el.style.background = 'rgba(' + col.r + ', ' + col.g + ', ' + col.b + ', 0.96)'
              el.setAttribute('data-solid', 'true')
            } else {
              el.style.background = ''
              el.removeAttribute('data-solid')
            }
          } catch (eEl) {}
        }
      }, [panelOpen])
      if (!panelOpen && !panelClosing) return null
      var body = MemoryTabBody(tab, nonce)
      var tabs = MEMORY_TABS()
      // 承载面(2026-09-21):①左下角浮层(可拖拽/缩放) ②「记忆」会话页(conversation.view,与「对话轨迹」并列)。
      // 两者共用同一份 tab(模块级 panelTab)/数据/刷新 nonce ⇒ 天然同步(用户要求);本函数只负责浮层节点。
      var dragMove = startPointerDrag(function (dx, dy) {
        controller.setGeom({ left: g.left + dx, top: g.top + dy })
      }, '[data-dam-btn], [data-dam-tab], [data-dam-input], [data-dam-select], textarea')
      var resizeMove = startPointerDrag(function (dx, dy) {
        controller.setGeom({ width: g.width + dx, height: g.height + dy })
      })
      var scaleAttr = fontScale in FONT_SCALES ? fontScale : 'md'
      var verBadge = ver ? 'v' + ver + '-ui' : ''
      var nodes = []
      if (pos === 'bottom-left' || pos === 'both') {
        var floatStyle = {
          left: g.left + 'px',
          top: g.top + 'px',
          width: g.width + 'px',
          height: g.height + 'px',
          '--dam-scale': FONT_SCALE_VALUES[fontScale] || '1',
          '--dam-accent': ACCENT_VALUES[accentTheme] || ACCENT_VALUES.deepseek,
        }
        nodes.push(h('div', {
          key: 'float',
          'data-dam-region': 'float', 'data-dam-panel': '',
          'data-pos': 'float',
          'data-scale': scaleAttr,
          ref: panelRef,
          style: floatStyle,
          'data-closing': panelClosing ? 'true' : undefined,
          'data-dragging': dragActive ? 'true' : undefined,
        },
          h('header', {
            title: t('dragMove'),
            onPointerDown: dragMove,
          },
            h('strong', null, t('autoMemory')),
            h('span', { 'data-dam-slot': 'hint', 'data-dam-hint': '', style: { fontSize: '10px', opacity: .55 } }, verBadge),
            h('span', { className: 'dam-spacer' }),
            // 悬浮钉(2026-09-08):钉住后点面板外不再自动收起;图标为线描 SVG,与 ⤾ ⟳ ✕ 同画风
            h('button', {
              'data-dam-slot': 'actions', 'data-dam-btn': '', 'data-pin': pinned ? 'on' : 'off',
              title: pinned ? t('unpinPanel') : t('pinPanel'),
              'aria-pressed': pinned ? 'true' : 'false',
              style: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '4px 6px' },
              onClick: function () { controller.togglePin() },
            }, h(PinIcon, { filled: pinned })),
            h('button', { 'data-dam-slot': 'actions', 'data-dam-btn': '', title: t('resetPos'), onClick: function () { controller.resetGeom() } }, '⤾'),
            h('button', { 'data-dam-slot': 'actions', 'data-dam-btn': '', title: t('refresh'), onClick: function () { setNonce(nonce + 1) } }, '⟳'),
            h('button', { 'data-dam-slot': 'actions', 'data-dam-btn': '', title: t('close'), onClick: function () { controller.close() } }, '✕')),
          // ★2026-09-28（跟进 PR #146）：紧凑态的操作行——「展开全部分区/轻量概览」双态切换 +
          //   「打开完整工作台」（跳会话的「记忆」页；找不到页签时退回面板并定位，不静默失灵）。
          h('div', { 'data-dam-panel-actions': '' },
            h('button', { 'data-dam-btn': '', 'aria-expanded': !compact[0], onClick: function () { compact[1](!compact[0]) } }, compact[0] ? L('展开全部分区', 'All sections') : L('轻量概览', 'Quick overview')),
            h('button', { 'data-dam-btn': '', disabled: !currentSessionIdClient(), title: currentSessionIdClient() ? L('返回会话的记忆页', 'Open memory in this conversation') : L('请先在宿主中选择一个会话', 'Select a conversation first'), onClick: function () { var target = document.querySelector('[role=tab][data-slot-id=auto-memory-pre-panel]'); if (!target) target = Array.prototype.find.call(document.querySelectorAll('[role=tab]'), function (el) { return el.textContent.trim() === L('记忆', 'Memory') }); if (target) { target.click(); controller.close() } else { controller.setPanelPos('both'); controller.close() } } }, L('打开完整工作台', 'Open workbench'))),
          compact[0] ? null : h(TabScroller, { key: 'ftabs', tabs: tabs, tab: tab, setTab: setTab }),
          h('div', { key: 'fbody', 'data-dam-body': '' }, compact[0] ? h(OverviewTab, { nonce: nonce }) : body),
          h('div', { 'data-dam-resize': '', title: t('dragResize'), onPointerDown: resizeMove })))
      }
      // ★2026-09-21 二次修正:「顶部通栏覆盖条」形态已**废弃**。
      //   用户实测反馈原话:「它现在是浮在整个页面上方的,而不是和对话轨迹、上下文、白板看板在一起,作为一个单独的一页」。
      //   根因:宿主只给插件 4 个槽位(sidebar/main/rightbar/shell.overlay),放在 overlay 里的东西**只能盖在界面上**,
      //   做不出「并列的一页」;要成为并列页必须注册到 conversation.view(见下面 MemoryPageView + registerSurfaces)。
      //   故此处只剩浮层一个节点;'page' / 'both' 档的「会话页」由 conversation.view 槽位承载。
      return nodes.length === 1 ? nodes[0] : h('div', { 'data-dam-panel-host': '' }, nodes)
    }