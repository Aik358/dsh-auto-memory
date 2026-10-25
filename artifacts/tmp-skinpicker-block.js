    /**
     * ★2026-09-28 皮肤选择器（用户第 1 大点：「将设置里的『皮肤资源』窗口改为『皮肤选择』窗口，
     *   相当于皮肤中心。现有的 V4 开发版皮肤和正式版皮肤都可在此切换」）。
     *
     * 数据源：内置两项（classic / v4 恒在）+ 宿主 skinCenter.layers 扫到的用户/团队皮肤
     *   （~/.dsh/memory/skins/<name>/，由宿主 readSkinCenterPre 三层扫描；本组件只读不重扫）。
     * 切换：写 localStorage 的 dam-skin / dam-skin-variant，再经 props.onSwitch 触发重渲染（不 reload）。
     * 如实边界：非 classic/v4 条目目前提供的是 theme tokens（经宿主合成），渲染本体仍为 v4 那套；
     *   条目描述里标注「主题层」，不谎称是完整皮肤。
     */
    function SkinPicker(props) {
      var sc = useSkinCenter()
      var zh = locale === 'zh'
      var cur = damSkinActive()
      var layers = (sc && sc.layers) || []
      var fRepo = useState('Aik358/dsh-auto-memory')
      var fName = useState('')
      var fBusy = useState(false)
      var fMsg = useState('')
      var repo = fRepo[0], setRepo = fRepo[1]
      var name = fName[0], setName = fName[1]
      var busy = fBusy[0], setBusy = fBusy[1]
      var msg = fMsg[0], setMsg = fMsg[1]
      var variant = ''
      try { variant = localStorage.getItem('dam-skin-variant') || '' } catch (eV) {}
      var items = [
        { id: 'classic', label: zh ? '正式版（经典）' : 'Classic (stable)', desc: zh ? '出厂默认皮肤：深色、信息密集。' : 'Factory default: dark, information-dense.' },
        { id: 'v4', label: zh ? '开发版（新款）' : 'Dev preview (v4)', desc: zh ? '按客户概念图实现，仍在开发中。' : 'Built to the concept art; still in development.' },
      ].concat(layers.filter(function (l) {
        return String(l.name) !== 'v4' && String(l.name) !== 'classic'
      }).map(function (l) {
        return { id: String(l.name), label: String(l.name) + (l.layer === 'team' ? (zh ? '（团队）' : ' (team)') : ''), desc: (zh ? '主题层 · ' : 'theme layer · ') + String(l.tokenCount || 0) + ' token', theme: true }
      }))
      var pick = function (it) {
        try {
          if (it.theme) { localStorage.setItem('dam-skin', 'v4'); localStorage.setItem('dam-skin-variant', it.id) }
          else { localStorage.setItem('dam-skin', it.id === 'v4' ? 'v4' : 'classic'); localStorage.removeItem('dam-skin-variant') }
        } catch (e0) {}
        if (props && props.onSwitch) props.onSwitch()
      }
      var callLib = function (action) {
        if (busy) return
        setBusy(true); setMsg('')
        apiPost(API.skinLibraryFetch, { repo: String(repo || '').trim(), action: action, name: String(name || '').trim() }).then(function (r) {
          if (r && r.ok && action === 'list') {
            var list = Array.isArray(r.skins) ? r.skins : []
            setMsg(list.length ? ((zh ? '皮肤库条目：' : 'library: ') + list.join(', ')) : (zh ? '皮肤库为空（或该仓库没有 skins/ 目录）' : 'library empty (or no skins/ dir)'))
          } else if (r && r.ok) {
            setMsg((zh ? '✓ 已安装到 ' : '✓ installed to ') + String(r.dir || '') + (zh ? ' —— 重开设置页即可在上方选择' : ' — reopen settings to pick it'))
          } else {
            setMsg('✗ ' + String((r && r.error) || (zh ? '失败' : 'failed')))
          }
          setBusy(false)
        }).catch(function (e) { setMsg('✗ ' + String((e && e.message) || e)); setBusy(false) })
      }
      return h('div', { 'data-dam-skin-picker': '1' }, [
        h('div', { key: 'items', 'data-dam-skin-picker-items': '1', style: { display: 'grid', gap: '8px', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', marginBottom: '10px' } },
          items.map(function (it) {
            var on = it.theme ? (cur === 'v4' && variant === it.id) : (cur === it.id && !variant)
            return h('button', {
              key: it.id, 'data-dam-skin-pick': it.id, 'data-dam-skin-pick-active': on ? '1' : '0',
              onClick: function () { pick(it) },
              style: {
                textAlign: 'left', cursor: 'pointer', padding: '10px 12px', borderRadius: '10px', font: 'inherit', color: 'inherit',
                border: '1px solid ' + (on ? 'var(--dam-accent, #4f7cff)' : 'var(--dsw-alias-border-l1, rgba(128,128,128,.28))'),
                background: on ? 'color-mix(in srgb, var(--dam-accent, #4f7cff) 10%, transparent)' : 'transparent',
              },
            }, [
              h('div', { key: 't', style: { fontWeight: 650, fontSize: 'calc(12.5px * var(--dam-scale))', marginBottom: '3px' } }, it.label + (on ? (zh ? '  ✓ 当前' : '  ✓ current') : '')),
              h('div', { key: 'd', style: { fontSize: 'calc(11px * var(--dam-scale))', opacity: .68, lineHeight: 1.5 } }, it.desc),
            ])
          })),
        h('div', { key: 'lib', 'data-dam-skin-library': '1', style: { border: '1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.28))', borderRadius: '10px', padding: '10px 12px' } }, [
          h('div', { key: 'h', style: { fontWeight: 650, fontSize: 'calc(12px * var(--dam-scale))', marginBottom: '6px' } }, zh ? '从皮肤库获取（GitHub）' : 'Get skins from the library (GitHub)'),
          h('div', { key: 'hint', style: { fontSize: 'calc(11px * var(--dam-scale))', opacity: .68, marginBottom: '8px', lineHeight: 1.55 } },
            zh ? '皮肤库 = 插件仓库的 skins/ 目录（开发者按皮肤规范提 PR）。可「列出」查看，或填皮肤名「安装」到 ~/.dsh/memory/skins/；也可手动拷贝皮肤目录到该位置。'
              : 'The library is the skins/ folder of the plugin repo (PRs welcome). List to browse, or install by name into ~/.dsh/memory/skins/; manual copy works too.'),
          h('div', { key: 'row', style: { display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' } }, [
            h('input', { key: 'repo', 'data-dam-skin-lib-repo': '1', value: repo, spellCheck: false, placeholder: 'owner/repo', onChange: function (e) { setRepo(e.target.value) }, style: { flex: '1 1 150px', minWidth: '130px' } }),
            h('button', { key: 'list', 'data-dam-skin-lib-list': '1', 'data-dam-slot': 'actions', 'data-dam-btn': '', disabled: busy, onClick: function () { callLib('list') } }, busy ? (zh ? '处理中…' : 'working…') : (zh ? '列出皮肤' : 'List')),
            h('input', { key: 'name', 'data-dam-skin-lib-name': '1', value: name, spellCheck: false, placeholder: zh ? '皮肤名' : 'skin name', onChange: function (e) { setName(e.target.value) }, style: { flex: '0 1 110px' } }),
            h('button', { key: 'get', 'data-dam-skin-lib-get': '1', 'data-dam-slot': 'actions', 'data-dam-btn': '', disabled: busy || !String(name).trim(), onClick: function () { callLib('install') } }, zh ? '安装' : 'Install'),
          ]),
          msg ? h('div', { key: 'msg', 'data-dam-skin-lib-msg': '1', style: { fontSize: 'calc(11px * var(--dam-scale))', marginTop: '6px', opacity: .82, wordBreak: 'break-all' } }, msg) : null,
        ]),
      ])
    }
