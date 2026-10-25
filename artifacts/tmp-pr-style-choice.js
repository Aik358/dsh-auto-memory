    var ITER5_STYLE_KEY = 'dsh-auto-memory.presentation.v1'
    var ITER5_STYLE_IDS = ['instrument', 'editorial', 'water']
    var iter5StyleListeners = new Set()
    var iter5StyleValue
    function iter5NormalizeStyle(value) { return ITER5_STYLE_IDS.indexOf(value) >= 0 ? value : 'instrument' }
    function iter5ReadStyle() {
      if (iter5StyleValue === undefined) {
        try { iter5StyleValue = iter5NormalizeStyle(localStorage.getItem(ITER5_STYLE_KEY)) } catch (e) { iter5StyleValue = 'instrument' }
      }
      return iter5StyleValue
    }
    function iter5SetStyle(value, persist) {
      var next = iter5NormalizeStyle(value)
      iter5StyleValue = next
      if (persist !== false) { try { localStorage.setItem(ITER5_STYLE_KEY, next) } catch (e) {} }
      iter5StyleListeners.forEach(function (listener) { listener(next) })
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
      return locale === 'zh' ? ['界面皮肤', '仪器', '编辑', '活水'] : locale === 'ja' ? ['スキン', '計器', '編集', 'ウォーター'] : ['Interface skin', 'Instrument', 'Editorial', 'Water']
    }
    function Iter5StylePicker() {
      var value = useIter5Style(), labels = iter5StyleLabels()
      return h('select', { className: 'i5-style-picker', 'aria-label': labels[0], title: labels[0], value: value, onChange: function (e) { iter5SetStyle(e.target.value) } }, ITER5_STYLE_IDS.map(function (id, i) { return h('option', { key: id, value: id }, labels[i + 1]) }))
    }

    var ITER5_MODE_KEY = 'dsh-auto-memory.appearance.v1'
    var iter5ModeValue
    var iter5ModeListeners = new Set()
    function iter5NormalizeMode(value) { return ['system','light','dark'].indexOf(value) >= 0 ? value : 'system' }
    function iter5ReadMode() {
      if (iter5ModeValue === undefined) {
        try {
          var saved = localStorage.getItem(ITER5_MODE_KEY)
          // Preserve preferences set by upstream 3.2.x on the first upgrade.
          if (saved == null) {
            saved = iter5NormalizeMode(localStorage.getItem('dam-skin-theme'))
            localStorage.setItem(ITER5_MODE_KEY, saved)
          }
          iter5ModeValue = iter5NormalizeMode(saved)
        } catch (e) { iter5ModeValue = 'system' }
      }
      return iter5ModeValue
    }
    function iter5SetMode(value, persist) { var next = iter5NormalizeMode(value); iter5ModeValue = next; if (persist !== false) { try { localStorage.setItem(ITER5_MODE_KEY, next) } catch (e) {} } iter5ModeListeners.forEach(function (listener) { listener(next) }) }
    function useIter5Mode() {
      var pair = useState(iter5ReadMode)
      useEffect(function () {
        iter5ModeListeners.add(pair[1]); pair[1](iter5ReadMode())
        function sync(e) { if (e.key === ITER5_MODE_KEY || e.key === null) { if (e.key === null) { iter5ModeValue = undefined; iter5SetMode(iter5ReadMode(), false) } else iter5SetMode(e.newValue, false) } }
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
