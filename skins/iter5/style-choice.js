    var ITER5_STYLE_KEY = 'dsh-auto-memory.presentation.v1'
    // ★2026-09-30（用户裁定）：下拉框同管**四款**——旧款（3.2.5 的「新款」，默认）
    //   + 仪器 / 编辑 / 活水三套变体。旧款不属于本块的样式系统，
    //   故它改变的是**挂载点分派**（damSkinStyleSet）而非样式变量；
    //   三套变体则走本块的 ITER5_STYLE_KEY（两者互斥，切换时互相写对方）。
    var ITER5_STYLE_IDS = ['instrument', 'editorial', 'water']
    var ITER5_ALL_SKINS = ['legacy', 'instrument', 'editorial', 'water']
    var iter5StyleListeners = new Set()
    var iter5StyleValue
    function iter5NormalizeStyle(value) { return ITER5_ALL_SKINS.indexOf(value) >= 0 ? value : 'legacy' }
    function iter5ReadStyle() {
      if (iter5StyleValue === undefined) {
        try { var rawStyle = localStorage.getItem(ITER5_STYLE_KEY); iter5StyleValue = rawStyle ? iter5NormalizeStyle(rawStyle) : 'legacy' } catch (e) { iter5StyleValue = 'legacy' }
      }
      return iter5StyleValue
    }
    function iter5SetStyle(value, persist) {
      var next = iter5NormalizeStyle(value)
      iter5StyleValue = next
      if (persist !== false) {
        try { localStorage.setItem(ITER5_STYLE_KEY, next) } catch (e) {}
        // 两个开关互斥保持同步：选 legacy 则挂载点走旧块，否则走本块。
        try { if (typeof damSkinStyleSet === 'function') damSkinStyleSet(next) } catch (e2) {}
      }
      iter5StyleListeners.forEach(function (listener) { listener(next) })
      try { window.dispatchEvent(new Event('dam-skin-changed')) } catch (eSkin) {}
    }
    function useIter5Style() {
      var pair = useState(iter5ReadStyle)
      useEffect(function () {
        iter5StyleListeners.add(pair[1]); pair[1](iter5ReadStyle())
        function sync(e) { if (e.key === ITER5_STYLE_KEY || e.key === null) { if (e.key === null) { iter5StyleValue = undefined; iter5SetStyle(iter5ReadStyle(), false) } else iter5SetStyle(e.newValue, false) } }
        window.addEventListener('storage', sync)
        return function () { iter5StyleListeners.delete(pair[1]); window.removeEventListener('storage', sync) }
      }, [])
      return pair[0]
    }
    function iter5StyleLabels() {
      return locale === 'zh' ? ['界面皮肤', '新款（经典）', '仪器', '编辑', '活水'] : locale === 'ja' ? ['スキン', 'ニュー（クラシック）', '計器', '編集', 'ウォーター'] : ['Interface skin', 'New (classic)', 'Instrument', 'Editorial', 'Water']
    }
    function Iter5StylePicker() {
      var value = useIter5Style(), labels = iter5StyleLabels()
      return h('select', { className: 'i5-style-picker', 'aria-label': labels[0], title: labels[0], value: value, onChange: function (e) { iter5SetStyle(e.target.value) } }, ITER5_ALL_SKINS.map(function (id, i) { return h('option', { key: id, value: id }, labels[i + 1]) }))
    }

    var ITER5_MODE_KEY = 'dsh-auto-memory.appearance.v1'
    // ★H36（2026-10-01）：3.2.5 冻结页与本块原本各读各的主题键 ⇒ 同一「深/浅」两处不一致
    //   （用户实报「明暗不同、亮暗没有正常转化」）。此键是冻结页的存储键，本块**双向镜像**它：
    //   写时同步写、storage 事件时反向采纳，两键恒等 ⇒ 一处切换处处一致（L10374 契约）。
    var ITER5_LEGACY_THEME_KEY = 'dam-skin-theme'
    var iter5ModeValue
    var iter5ModeListeners = new Set()
    function iter5NormalizeMode(value) { return ['system','light','dark'].indexOf(value) >= 0 ? value : 'system' }
    function iter5ReadMode() {
      if (iter5ModeValue === undefined) {
        try {
          var saved = localStorage.getItem(ITER5_MODE_KEY)
          // ★H36：冻结页的键非空即采纳 —— 只可能是冻结页按钮刚写、或本块镜像写（两者同值）。
          var legacy = localStorage.getItem(ITER5_LEGACY_THEME_KEY)
          if (legacy != null) {
            iter5ModeValue = iter5NormalizeMode(legacy)
            localStorage.setItem(ITER5_MODE_KEY, iter5ModeValue)
          } else {
            // Preserve preferences set by upstream 3.2.x on the first upgrade.
            if (saved == null) {
              saved = iter5NormalizeMode(legacy)
              localStorage.setItem(ITER5_MODE_KEY, saved)
            }
            iter5ModeValue = iter5NormalizeMode(saved)
          }
        } catch (e) { iter5ModeValue = 'system' }
      }
      return iter5ModeValue
    }
    function iter5SetMode(value, persist) { var next = iter5NormalizeMode(value); iter5ModeValue = next; if (persist !== false) { try { localStorage.setItem(ITER5_MODE_KEY, next) } catch (e) {} try { localStorage.setItem(ITER5_LEGACY_THEME_KEY, next === 'system' ? 'auto' : next) } catch (e2) {} } iter5ModeListeners.forEach(function (listener) { listener(next) }) }
    function useIter5Mode() {
      var pair = useState(iter5ReadMode)
      useEffect(function () {
        iter5ModeListeners.add(pair[1]); pair[1](iter5ReadMode())
        function sync(e) {
          if (e.key === ITER5_LEGACY_THEME_KEY) { iter5SetMode(e.newValue == null ? 'system' : e.newValue, true); return }
          if (e.key === ITER5_MODE_KEY || e.key === null) { if (e.key === null) { iter5ModeValue = undefined; iter5SetMode(iter5ReadMode(), false) } else iter5SetMode(e.newValue, false) }
        }
        window.addEventListener('storage', sync)
        return function () { iter5ModeListeners.delete(pair[1]); window.removeEventListener('storage', sync) }
      }, [])
      return pair[0]
    }
    function useIter5Theme() { var host = useDeepTheme(), mode = useIter5Mode(); return mode === 'system' ? host : mode === 'dark' }
    function Iter5ModePicker() {
      var mode = useIter5Mode(), labels = locale === 'zh' ? ['明暗模式','跟随宿主','浅色','深色'] : locale === 'ja' ? ['表示モード','ホストに従う','ライト','ダーク'] : ['Color mode','Follow host','Light','Dark']
      return h('select', { className:'i5-mode-picker','aria-label':labels[0],title:labels[0],value:mode,onChange:function(e){iter5SetMode(e.target.value)} },['system','light','dark'].map(function(id,i){return h('option',{value:id,key:id},labels[i+1])}))
    }
