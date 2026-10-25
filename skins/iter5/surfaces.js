    // ═══════════════════════════════════════════════════════════════════════════
    // ★★E8-6（2026-10-25）fullpage 标记改**引用计数**
    //
    // 【真缺陷（用户直接报「输入框没隐藏」）】
    //   conversation.view 同时注册了多个 kind='page' 的 surface：
    //     记忆页(order 78) / 白板看板页(order 80) / 白板画布(order 81, 默认关)
    //   每个 surface 都各跑一段**相同的** IntersectionObserver：
    //     可见   → body.setAttribute('data-dam-fullpage','true')
    //     不可见 → body.removeAttribute('data-dam-fullpage')
    //   ⇒ last-writer-wins：切到白板页时记忆页的 IO 也会回报 isIntersecting=false，
    //     它的 mark(false) 把刚打上的 true 摘掉 ⇒ 白板页输入框没隐藏。
    //
    // 【修法】模块级 Set 记录「当前可见的 page 元素」：
    //   Set 非空 ⇒ 打标记；Set 变空 ⇒ 摘标记。每个 surface 只增删自己那一个元素。
    //   ★卸载时也必须从 Set 删自己（cleanup）—— 否则残留会让标记永远摘不掉，
    //     那会让用户在「对话」页永远打不了字（比不隐藏严重得多）。
    // ═══════════════════════════════════════════════════════════════════════════
    var EV4_VISIBLE_PAGES = (typeof Set === 'function') ? new Set() : null
    /** 按 Set 现状同步 body 属性（唯一写入口，避免多处直接 setAttribute 造成竞争）。 */
    function ev4SyncFullpageAttr() {
      try {
        var on = !!(EV4_VISIBLE_PAGES && EV4_VISIBLE_PAGES.size > 0)
        if (on) document.body.setAttribute('data-dam-fullpage', 'true')
        else document.body.removeAttribute('data-dam-fullpage')
      } catch (e) { /* fail-soft：DOM 不可用时不抛 */ }
    }
    // ═══════════════════════════════════════════════════════════════════════════
    // ★P3（task-32）全屏高度计算 —— 纯函数，可 node 单测（不依赖 DOM）
    //
    // 【为什么要抽出来】原实现把「算高度」写在 fit() 里，只能靠真浏览器验；
    //   而本任务的真因排查（composer 被 display:none 后 rect 是否异常）**必须可复算**。
    //   抽成纯函数后：①两种情形（composer 可见/隐藏）都能单测 ②真 Chrome 只需验输入值。
    //
    // 【参数语义】
    //   areaH       : [data-conversation-scroll] 的 clientHeight（含内边距）
    //   padTop/padB : 该元素的 computed padding（要扣掉，否则内容会溢出）
    //   hostTop     : 宿主容器（[data-dam-fullpage-host]）getBoundingClientRect().top
    //   composerTop : 宿主发送栏 getBoundingClientRect().top；**没有 composer 时传 null**
    //   fullpageOn  : body[data-dam-fullpage] 是否生效（全屏态）
    //   minH        : 兜底最小高（原实现是 160）
    //
    // 【★关键决策：全屏态不再用 composer 夹取】
    //   全屏态下 composer 是 display:none（CSS L4028：seat 与 card 都 none!important），
    //   此时它的 getBoundingClientRect() 语义不可靠：
    //     · 多数引擎返回全 0 ⇒ top = 0 - hostTop ⇒ 负值 ⇒ `if (top>0)` 不成立 ⇒ 不夹取
    //     · 但一旦返回非 0（如父级仍占位、或引擎实现差异）⇒ top 可能是正值 ⇒ 把高度压小
    //   ⇒ 全屏态的**语义**就是「占满可用高度、不管 composer」，所以这里直接跳过夹取。
    //   非全屏态保持原行为（那时 composer 真的占着位置，必须让开）。
    // ★签名按 Lead 裁决（P3）：(areaH, padT, padB, composerTop, elTop, fullpageOn) ⇒ number
    function computeFullpageHeightPre(areaH, padT, padB, composerTop, elTop, fullpageOn) {
      var h = Number(areaH)
      if (!isFinite(h)) h = 0
      if (isFinite(Number(padT))) h -= Number(padT)
      if (isFinite(Number(padB))) h -= Number(padB)
      // ★只在**非全屏态**才用 composer 几何夹高度。
      //   全屏态的判据本身就是「composer 已被 display:none 隐藏」——
      //   在一个「composer 被隐藏」的态里用它的几何约束高度，无论 rect 返回 0 还是真实值，
      //   都是逻辑错误：返回 0 时是「碰巧不生效」（潜在脆弱），返回真实值时是「压缩高度」（当前症状）。
      if (!fullpageOn && Number(composerTop) > 0 && Number(composerTop) - Number(elTop) > 0) {
        h = Math.min(h, Number(composerTop) - Number(elTop) - 8)
      }
      if (!(h > 160)) h = 160
      return Math.round(h)
    }

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
        // ★v4 E7（2026-10-25）：第三个选择器是 EventView 的根标记。
        //   真缺陷：白板看板页现在渲染的是 **EventView**，根属性是 data-dam-event-view，
        //   旧的两个选择器一个都不匹配 ⇒ el = null ⇒ fit() 整段 return ⇒
        //   **composer 被隐藏了但内容区没撑满**（用户实报「太拥挤」正是这个）。
        //   保留前两个（旧看板资产不能删）；新名字 data-dam-fullpage-host 语义独立，不复用 kanban-view。
        var el = boundary.current.querySelector('[data-dam-kanban-view],[data-dam-wbg-wrap],[data-dam-fullpage-host]')
        var area = el && el.closest('[data-conversation-scroll]')
        if (!el || !area) return
        function fit() {
          var style = getComputedStyle(area)
          // ★P3：全屏态读 body[data-dam-fullpage]；是 'true' 才跳过 composer 夹取。
          //   判据：data-dam-fullpage 是 ev4SyncFullpageAttr() 的唯一产物，读它不会错位。
          var fullpageOn = false
          try { fullpageOn = document.body.getAttribute('data-dam-fullpage') === 'true' } catch (e) { fullpageOn = false }
          var composer = document.querySelector('[data-composer-card]')
          var fitH = computeFullpageHeightPre(
            area.clientHeight,
            parseFloat(style.paddingTop) || 0,
            parseFloat(style.paddingBottom) || 0,
            composer ? composer.getBoundingClientRect().top : 0,
            el.getBoundingClientRect().top,
            fullpageOn
          )
          el.style.height = fitH + 'px'
          el.style.maxHeight = fitH + 'px'
          // 供真 Chrome 断言直接读取（不靠推断）
          try {
            el.setAttribute('data-dam-fit-h', String(fitH))
            el.setAttribute('data-dam-fit-fullpage', fullpageOn ? '1' : '0')
          } catch (e) {}
        }
        fit()
        var observer = typeof ResizeObserver === 'function' ? new ResizeObserver(fit) : null
        if (observer) { observer.observe(area); var composer = document.querySelector('[data-composer-card]'); if (composer) observer.observe(composer) }
        window.addEventListener('resize', fit)
        return function () { if (observer) observer.disconnect(); window.removeEventListener('resize', fit) }
      }, [props.kind])
      // ★2026-10-08（会话页铺满）：kind='page' 的会话页**可见**期间给 body 打标记，
      //   由 client.js 手写 CSS 隐藏宿主发送栏 ⇒ 记忆页 / 白板看板页占满右侧整列。
      //   为什么按可见性而不是只在挂载时置位：宿主可能保留非活动视图的 DOM；
      //   IntersectionObserver 在视图被隐藏 / 切走时回调 isIntersecting=false，自动摘掉标记。
      //   零副作用：切回「对话」标签页标记消失，输入栏原样恢复。
      useEffect(function () {
        if (props.kind !== 'page') return
        var el = boundary.current
        if (!el) return
        // ★E8-6：不再直接 setAttribute/removeAttribute —— 走引用计数 EV4_VISIBLE_PAGES。
        function mark(on) {
          try {
            if (!EV4_VISIBLE_PAGES) {
              // 极老环境无 Set：退回旧行为（保底，不白屏）
              if (on) document.body.setAttribute('data-dam-fullpage', 'true')
              else document.body.removeAttribute('data-dam-fullpage')
              return
            }
            if (on) EV4_VISIBLE_PAGES.add(el)
            else EV4_VISIBLE_PAGES.delete(el)
            ev4SyncFullpageAttr()
          } catch (e) {}
        }
        // ═══════════════════════════════════════════════════════════════════════
        // ★P3（task-32）默认全屏：进入白板页即全屏，**不再依赖 IntersectionObserver 恰好命中**。
        //
        // 【旧行为的问题（用户原话「现在白板看板还是没有全屏」）】
        //   只在 IO 回调 isIntersecting=true 时才 mark(true)。而宿主布局下：
        //     · 白板页刚挂载时可能还在 0 尺寸/过渡态 ⇒ 首次回调 isIntersecting=false
        //     · 之后若视图没有被真正滚动/切换，IO **不会再次回调** ⇒ 永远不打标记
        //   ⇒ 表现为「切到白板页，但它不是全屏」。
        //
        // 【新策略：以「挂载即可见」为默认，IO 只负责**撤销**】
        //   1. 挂载后立即 mark(true)（默认全屏）—— 满足「不需要点任何东西即全屏」。
        //   2. IO 仍保留，但只在**明确的不可见**时才 mark(false)；
        //      且用「连续 2 次不可见」确认，避免过渡帧的假阴性把标记闪掉。
        //   3. 卸载 cleanup 必然 mark(false) —— 这是「切回对话页 composer 必须恢复」的保证。
        //
        // 【★为什么这个顺序是安全的（防「标记摘不掉导致打不了字」）】
        //   EV4_VISIBLE_PAGES 是**引用计数** Set：每个 page surface 只增删自己那一个元素，
        //   ev4SyncFullpageAttr() 按 Set 是否为空决定打/摘标记。
        //   ⇒ 本 surface 卸载时 mark(false) 只删自己；只有当**所有** page 都不可见时，
        //      body[data-dam-fullpage] 才会被摘掉 ⇒ 对话页 composer 必然恢复。
        //   ⇒ 即便 IO 永不回调（无 IntersectionObserver 的老环境），cleanup 也一定会摘。
        // ═══════════════════════════════════════════════════════════════════════
        // ═══════════════════════════════════════════════════════════════════════════
        // ★★P3 安全闸门（Lead 2026-10-25 指出，比原 bug 更严重的风险）
        //
        // 【危险面】conversation.view 同时注册了 **多个** kind='page' 的 surface
        //   （记忆页 order 78 / 白板看板页 order 80 / 白板画布 order 81，默认关）。
        //   若宿主「全部挂载、只切显隐」，那么用户在**对话页**时白板页组件也已挂载
        //   ⇒ 若此时无条件 mark(true) ⇒ body[data-dam-fullpage] 被打上
        //   ⇒ composer display:none ⇒ **用户在对话页永远打不了字**。
        //   （这正是本文件下方 cleanup 注释里写过的原话：「比不隐藏严重得多」。）
        //
        // 【为什么必须加闸门而不能只靠 IO 的迟滞】
        //   IO 的「连续 2 次不可见才摘」是**防抖**（防过渡帧闪掉标记），是**事后**的；
        //   闸门是**防错**（从一开始就不该打），是**事前**的。两者职责不同，都要有。
        //
        // 【闸门判据】**不得引用 el 自身高度**（否则与 fit() 构成死循环，见下方实现处详注）：
        //   · el.offsetWidth > 0                     —— 宽度，fit() 从不改 width
        //   · computed display/visibility 非隐藏      —— 宿主/CSS 决定
        //   · 祖先 [data-conversation-scroll] 有高度  —— 宿主决定
        //   三者任一不满足 ⇒ 不打标。取不到（异常/旧环境）⇒ **保守不打标**
        //   （宁可白板页不全屏，也绝不能让对话页打不了字）。
        // ═══════════════════════════════════════════════════════════════════════════
        // ★★修正（2026-10-25 用户实报「全屏还是不生效」）：判据**不得引用 el 自身高度**。
        //
        // 【死循环（上一版真缺陷）】
        //   el 的高度是 fit() 写的；fit() 的 CSS 高度链 [data-dam-fullpage-host]{height:100%}
        //   只在打标后父级有高度时才生效；打标又要先过「el 有高度」闸门 ⇒ **永远不达标**。
        //   真 Chrome 复刻页之所以绿：复刻页里 el 一开始就有高度 ⇒ 复刻页把循环依赖掩盖了。
        //
        // 【新判据：只依赖「与 el 自身高度无关」的两个信号】
        //   ① el.offsetWidth > 0 —— **宽度不受 fit 影响**（fit 只写 height/maxHeight）
        //   ② getComputedStyle(el).display !== 'none' && visibility !== 'hidden'
        //   ③ el 的**祖先 scroll 容器**有高度（scroll 高度由宿主决定，与 el 无关）
        //   ⇒ 三者都不引入「el 高度」⇒ 无循环依赖。
        function elLooksVisible() {
          try {
            // ① 宽度（fit 从不改 width ⇒ 安全信号）
            if (!(el.offsetWidth > 0)) return false
            // ② 显隐（display/visibility 由宿主与 CSS 决定，与 fit 无关）
            var cs = getComputedStyle(el)
            if (cs && (cs.display === 'none' || cs.visibility === 'hidden')) return false
            // ③ 祖先滚动容器有高度（宿主给的，与 el 高度无关）
            var area = el.closest && el.closest('[data-conversation-scroll]')
            if (area) {
              var ar = area.clientHeight
              if (!(ar > 0)) return false
            }
            return true
          } catch (e) {
            // fail-closed：拿不到信号 ⇒ 视为不可见，**不打标**
            return false
          }
        }
        // ① 挂载时：只有**确认可见**才打标（默认全屏，但绝不误伤对话页）
        if (elLooksVisible()) mark(true)
        // ② IO 只负责撤销：连续 2 次不可见才摘（抗过渡帧假阴性）
        if (typeof IntersectionObserver !== 'function') {
          return function () { mark(false) }
        }
        var missStreak = 0
        var io = new IntersectionObserver(function (entries) {
          for (var k = 0; k < entries.length; k += 1) {
            if (entries[k].isIntersecting) {
              missStreak = 0
              // ★闸门同样作用于 IO 正路径：isIntersecting 只说明「进了视口」，
              //   不说明「有布局尺寸」。以闸门为准，避免 0 尺寸时误打标。
              if (elLooksVisible()) mark(true)
            } else {
              missStreak += 1
              // 连续 2 次不可见才认定「真的切走了」（首帧 0 尺寸只算 1 次）
              if (missStreak >= 2) mark(false)
            }
          }
        })
        io.observe(el)
        return function () {
          try { io.disconnect() } catch (e) {}
          // ★E8-6：卸载时**必须把自己从 Set 删掉**（mark(false) 内部就是 delete(el)）——
          //   不是无脑 removeAttribute，否则另一个 page 还可见时也会被误摘标记。
          mark(false)
        }
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
      // ★★E8-1（2026-10-25）整页承载面必须带 data-dam-page
      //
      // 【真缺陷】[data-dam-page] 开头的 CSS 规则实测 **58 条**（布局/折叠/滚动条/动效刻度/
      //   按钮态/窄宽容器两套样式…），但全仓 data-dam-page 赋值原本只有 1 处 —— 在经典记忆页。
      //   白板看板页的 surface 根节点**没有**这个属性 ⇒ 这 58 条规则一条都不生效。
      //   ★其中包括 E7 补的 4 条高度链 [data-dam-page] [data-dam-fullpage-host]{height:100%}
      //     ⇒ 这也是「没撑满」的真实原因之一（E7 的 21/0 只测了 inline height，没测 CSS 规则生效）。
      //
      // 【修法】在这里统一加：kind === 'page' 才带（overlay/panel 保持原样，不误伤浮层）。
      //   ★不加在 EventView 内部，因为记忆页/白板页/画布页三个整页面都要这份基座样式。
      var node = h('div', { ref: boundary, 'data-dam-theme': props.kind || 'overlay', 'data-i5-style': skinStyle, 'data-deep': String(deep),
        'data-dam-page': props.kind === 'page' ? '' : undefined,
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
      var expanded = useState(false)
      var settingsTop = useState(16)
      var autoExpanded = useRef(false)
      var target = useState(function () { return createPortal ? document.createElement('div') : null })[0]
      function availableTop() {
        var top = 16, dialog = slot.current && slot.current.closest('[role=dialog]')
        if (dialog) top = Math.max(top, dialog.getBoundingClientRect().top)
        if (!dialog && props && props.inPluginDetail) {
          var area = slot.current && slot.current.parentElement
          while (area && area !== document.body) {
            var rect = area.getBoundingClientRect(), overflow = getComputedStyle(area).overflowY
            if (rect.height > 160 && (overflow === 'auto' || overflow === 'scroll')) { top = Math.max(top, rect.top + 8); break }
            area = area.parentElement
          }
        }
        var overlay = typeof navigator !== 'undefined' && navigator.windowControlsOverlay
        if (overlay && overlay.visible && typeof overlay.getTitlebarAreaRect === 'function') {
          var rect = overlay.getTitlebarAreaRect(); top = Math.max(top, rect.y + rect.height)
        }
        return Math.ceil(top)
      }
      useEffect(function () {
        var el = slot.current
        if (!el || !target) return
        function measure() {
          settingsTop[1](availableTop())
          if (!autoExpanded.current && el.clientWidth > 0 && el.clientWidth < 360) { autoExpanded.current = true; expanded[1](true) }
        }
        measure()
        var observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null
        if (observer) observer.observe(el)
        window.addEventListener('resize', measure)
        return function () { if (observer) observer.disconnect(); window.removeEventListener('resize', measure); target.remove() }
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
            e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); autoExpanded.current = true; expanded[1](false); return
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
          style: expanded[0] ? { top: settingsTop[0] + 'px', left: '12px', right: '12px', bottom: '12px', height: 'auto' } : undefined,
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
            h('button', { 'data-i5-settings-return': '', onClick: function () { autoExpanded.current = true; settingsTop[1](availableTop()); expanded[1](!expanded[0]) } }, expanded[0] ? L('返回宿主设置', 'Back to host settings') : L('展开设置', 'Expand settings'))),
          h('div', { className: 'i5-main' }, h(Iter5Settings, { key: identity[0], draftScope: 'host', close: props && props.close }))))
      return h('div', { ref: slot, 'data-i5-settings-slot': '' },
        expanded[0] ? h('button', { onClick: function () { if (root.current) root.current.querySelector('button').focus() } }, L('记忆设置已展开', 'Memory settings expanded')) : null,
        target ? createPortal(form, target) : form)
    }
    // Keep unsaved edits across host-driven unmounts, scoped to session/workspace.
    // Never persist configuration (which may include credentials) to browser storage.
    var iter5SettingsDrafts = Object.create(null)
    var iter5SettingsSequence = 0
