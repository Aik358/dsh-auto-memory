function Iter5Settings(props) {
        var tickPair = useTick()
        var i5SettingsId = useRef('i5-settings-' + (++iter5SettingsSequence)).current
        var i5Group = useState(props && props.intent && ['engine', 'memory', 'appearance', 'behavior'].indexOf(props.intent.group) >= 0 ? props.intent.group : 'engine')
        var i5Base = useRef(null)
        var i5Draft = useRef({})
        var i5Groups = useRef({})
        var i5Alive = useRef(true)
        var i5Identity = iter5Identity()
        var i5DraftKey = i5Identity + '|' + (props && props.draftScope || 'workbench')
        var i5GroupsDef = { engine: ['engine'], memory: ['window', 'capacity', 'skills'], appearance: ['store', 'look', 'skin'], behavior: ['handoff', 'auto', 'team', 'about'] }
        useEffect(function () {
          i5Alive.current = true
          function before(e) { if (!Object.keys(i5Draft.current).length) return; e.preventDefault(); e.returnValue = '' }
          window.addEventListener('beforeunload', before)
          return function () { i5Alive.current = false; window.removeEventListener('beforeunload', before) }
        }, [])
        // ★2026-09-30（D2 · 用户裁定「设置页必须全量同步」）：订阅唯一写出口的广播（见 saveConfigPatch 内 emit）。
        //   两个入口此前各持挂载时快照 ⇒ A 保存后 B 还是旧值；现在任何地方保存成功即重取远端配置。
        //   三条安全线：①有未保存草稿时不覆盖用户输入（只提示）；②busy 中不重取；③身份不符放弃。
        useEffect(function () {
          return controller.subscribe(function () {
            if (busy) return
            if (!i5Ok()) return
            apiGet(API.config).then(function (d) {
              if (!i5Ok()) return
              var remote = configOf(d)
              i5Base.current = remote
              if (Object.keys(i5Draft.current).length) {
                var changed = Object.keys(i5Draft.current).filter(function (key) { return JSON.stringify(remote[key]) !== JSON.stringify(i5Draft.current[key]) })
                if (changed.length) setMsg(L("检测到其他入口的修改：", "Changes detected from another entry: ") + changed.join(", ") + L("。你的未保存输入未被覆盖。", " Your unsaved edits were not overwritten."))
                setCfg(function (prev) { return Object.assign({}, remote, i5Draft.current) })
              } else {
                setCfg(remote)
                setDirty(false)
              }
            }).catch(function () {})
          })
        }, [busy])

        function i5Ok() { return i5Alive.current && i5Identity === iter5Identity() }
        function i5Record(key, value) {
          if (JSON.stringify(value) === JSON.stringify((i5Base.current || {})[key])) { delete i5Draft.current[key]; delete i5Groups.current[key] }
          else { i5Draft.current[key] = value; i5Groups.current[key] = i5Group[0] }
          setDirty(Object.keys(i5Draft.current).length > 0)
          if (Object.keys(i5Draft.current).length) iter5SettingsDrafts[i5DraftKey] = { patch: Object.assign({}, i5Draft.current), groups: Object.assign({}, i5Groups.current), base: Object.assign({}, i5Base.current) }
          else delete iter5SettingsDrafts[i5DraftKey]
        }
        function i5Cancel() { delete iter5SettingsDrafts[i5DraftKey]; i5Draft.current = {}; i5Groups.current = {}; setCfg(Object.assign({}, i5Base.current)); setDirty(false); setErr(''); setMsg('') }
        var cfgPair = useState(null)
        var cfg = cfgPair[0]
        var setCfg = cfgPair[1]
        var busyPair = useState(false)
        var busy = busyPair[0]
        var setBusy = busyPair[1]
        var msgPair = useState('')
        var msg = msgPair[0]
        var setMsg = msgPair[1]
        var errPair = useState('')
        var err = errPair[0]
        var setErr = errPair[1]
        var dirtyPair = useState(false)
        var dirty = dirtyPair[0]
        var setDirty = dirtyPair[1]
        var dbgOpenPair = useState(false)
        var dbgOpen = dbgOpenPair[0]
        var setDbgOpen = dbgOpenPair[1]
        var settingsSectionPair = useState('engine')
        var settingsSection = settingsSectionPair[0]
        var setSettingsSection = settingsSectionPair[1]
        var browseOpenPair = useState(false)
        var browseOpen = browseOpenPair[0]
        var setBrowseOpen = browseOpenPair[1]
        var browsePathPair = useState('')
        var browsePath = browsePathPair[0]
        var setBrowsePath = browsePathPair[1]
        // ★S1 解耦：内嵌浏览器回填到哪个键（'memoryRoot' | 'workbenchRoot'）
        var browseKeyPair = useState('memoryRoot')
        var browseKey = browseKeyPair[0]
        var setBrowseKey = browseKeyPair[1]
        var browseParentPair = useState('')
        var browseParent = browseParentPair[0]
        var setBrowseParent = browseParentPair[1]
        var browseDirsPair = useState(null)
        var browseDirs = browseDirsPair[0]
        var setBrowseDirs = browseDirsPair[1]
        // 「总结/问候默认模型」模型抽屉状态
        var mdlOpenPair = useState(false)
        var mdlOpen = mdlOpenPair[0]
        var setMdlOpen = mdlOpenPair[1]
        var mdlLoadPair = useState(false)
        var mdlLoading = mdlLoadPair[0]
        var setMdlLoading = mdlLoadPair[1]
        var mdlDataPair = useState(null)
        var mdlData = mdlDataPair[0]
        var setMdlData = mdlDataPair[1]
        var mdlErrPair = useState('')
        var mdlErr = mdlErrPair[0]
        var setMdlErr = mdlErrPair[1]
        function openModels() {
          setMdlOpen(true)
          setMdlErr('')
          if (mdlData) return // 已加载过目录,直接展示(保存后重开设置页会重新挂载)
          setMdlLoading(true)
          apiGet(API.models).then(function (d) {
            setMdlData(d || { providers: [] })
            setMdlLoading(false)
          }).catch(function (e) {
            setMdlErr(String(e && e.message ? e.message : e))
            setMdlLoading(false)
          })
        }
        function browseTo(p) {
          setBrowsePath(p)
          apiPost(API.browseDir, { path: p }).then(function (d) {
            if (d) { setBrowsePath(d.path); setBrowseParent(d.parent); setBrowseDirs(d.dirs || []) }
          }).catch(function () { setBrowseDirs([]) })
        }
        // openBrowser(targetKey)：targetKey = 回填到哪个配置键（默认 memoryRoot）。
        // ★S1 解耦（2026-09-24，用户纪律「单一开关不得顺带改变其他功能的行为」）：
        //   选择器被两行复用（记忆根目录 / 工作台工作区）时，**必须只写调用方指定那一个键**——
        //   早先版本同时 set('memoryRoot') 与 set('workbenchRoot')，会让「选工作台目录」顺带改掉记忆根目录。
        function openBrowser(targetKey) {
          var _targetKey = targetKey || 'memoryRoot'
          // 优先弹系统原生文件夹选择器(native 后端);不可用(远程/无显示)回退内嵌浏览
          apiPost(API.pickDir, {}).then(function (d) {
            if (d && d.native && d.dir) {
              set(_targetKey, d.dir)
              setMsg(t('pickedDir') + ' ' + d.dir + ' ' + t('rememberSave'))
            } else if (d && d.native) {
              // 用户在系统对话框点了取消:保持原值,不动作
            } else {
              setMsg(t('pickerUnavailable'))
              setBrowseOpen(true)
              setBrowseKey(_targetKey)
              browseTo((_targetKey === 'memoryRoot' ? cfg.memoryRoot : cfg.workbenchRoot) || '')
            }
          }).catch(function () {
            setMsg(t('pickerUnavailable'))
            setBrowseOpen(true)
            setBrowseKey(_targetKey)
            browseTo((_targetKey === 'memoryRoot' ? cfg.memoryRoot : cfg.workbenchRoot) || '')
          })
        }
        // 「总结/问候默认模型」抽屉(复审轮2新增功能的选型 UI):自动检测 llm 目录,分组展示,点选即设
        function buildModelDrawer() {
          var panelStyle = { border: '1px solid color-mix(in srgb, var(--dsw-alias-border-l1, rgba(128,128,128,.25)) 60%, transparent)', borderRadius: '8px', padding: '8px', marginBottom: '8px', maxHeight: '260px', overflow: 'auto', background: 'color-mix(in srgb, var(--dsw-alias-bg-layer-1, rgba(128,128,128,.06)) 40%, transparent)' }
          var kids = []
          kids.push(h('div', { 'data-dam-slot': 'list', 'data-dam-row': '', style: { marginBottom: '4px' } },
            h('b', { style: { flex: 1, fontSize: 'calc(12px * var(--dam-scale))' } }, L('选择模型（自动检测）', 'Pick a model (auto-detected)')),
            h('button', { 'data-dam-slot': 'actions', 'data-dam-btn': '', onClick: function () { setMdlOpen(false) } }, t('close'))))
          if (mdlLoading) kids.push(h('div', { 'data-dam-slot': 'hint', 'data-dam-hint': '' }, L('正在检测可用模型…', 'Detecting models…')))
          if (mdlErr) kids.push(h('div', { 'data-dam-error': '' }, mdlErr))
          if (!mdlLoading && !mdlErr && mdlData) {
            kids.push(h('button', { key: '__default__', 'data-dam-slot': 'actions', 'data-dam-btn': '', style: { display: 'block', width: '100%', textAlign: 'left', padding: '4px 6px', opacity: cfg.subagentModel ? 1 : 0.75 }, onClick: function () { setMany({ subagentModel: '', subagentProvider: '' }); setMdlOpen(false) } },
              L('跟随路由默认（留空）', 'Follow routing default (empty)')))
            ;(mdlData.providers || []).forEach(function (p) {
              var modelBtns = (p.models || []).length
                ? p.models.map(function (m) {
                    return h('button', { key: p.id + '/' + m.id, 'data-dam-slot': 'actions', 'data-dam-btn': '', style: { display: 'block', width: '100%', textAlign: 'left', padding: '3px 6px', fontWeight: cfg.subagentModel === m.id ? 700 : 400 }, onClick: function () { setMany({ subagentModel: m.id, subagentProvider: p.id }); setMdlOpen(false) } },
                      m.id + (m.name && m.name !== m.id ? ' · ' + m.name : '') + (cfg.subagentModel === m.id ? ' ✓' : ''))
                  })
                : [h('div', { key: 'none', 'data-dam-slot': 'hint', 'data-dam-hint': '' }, L('（该 provider 未列出模型）', '(no models advertised)'))]
              kids.push(h('div', { key: 'g-' + p.id, style: { marginTop: '6px' } },
                h('div', { style: { fontSize: 'calc(11px * var(--dam-scale))', fontWeight: 700, opacity: 0.75, margin: '2px 0' } }, p.name || p.id),
                modelBtns))
            })
            ;(mdlData.failures || []).forEach(function (f) {
              kids.push(h('div', { key: 'f-' + f.id, 'data-dam-slot': 'hint', 'data-dam-hint': '', style: { opacity: 0.65 } }, '⚠ ' + (f.name || f.id) + ': ' + f.message))
            })
            if (!(mdlData.providers || []).length && !(mdlData.failures || []).length) {
              kids.push(h('div', { 'data-dam-slot': 'hint', 'data-dam-hint': '' }, L('未检测到 provider;可直接在下方手动输入。', 'No providers detected; use manual input below.')))
            }
            kids.push(h('input', { key: '__manual__', 'data-dam-slot': 'form', 'data-dam-input': '', style: { marginTop: '6px', width: '100%' }, value: cfg.subagentModel || '', placeholder: L('手动输入(可选,provider 跟随路由默认)', 'manual entry (optional, provider follows routing default)'), onChange: function (e) { setMany({ subagentModel: String(e.target.value || '').trim(), subagentProvider: '' }) } }))
          }
          // 思考强度(DSH 0.1.5 agentOptions.reasoningEffort):与模型成对下发给子代理;留空=跟随模型默认。
          // 合法值按 DeepSeek 适配器口径 off|low|high|max(默认 high)——服务端同样做白名单过滤。
          var effortOpts = [
            ['', L('跟随默认', 'default')],
            ['off', 'off'],
            ['low', 'low'],
            ['high', 'high'],
            ['max', 'max'],
          ]
          var effortKeys = [
            ['subagentReasoningEffort', L('全部子代理（兜底）', 'All subagents (fallback)'),
              L('两条轴都没单独设置时用它。留空 = 跟随模型默认。', 'Used when neither lane is set. Empty follows the model default.')],
            ['subagentReasoningEffortLong', L('长期轴 · 写长期记忆', 'Long lane · writes long-term memory'),
              L('consolidate / consolidate-logs / distill / fold —— 它们产出项目笔记与用户级记忆，值得多花思考。', 'consolidate / consolidate-logs / distill / fold — these write project notes and user-level memory, so they are worth more thinking.')],
            ['subagentReasoningEffortShort', L('短期轴 · 用完即弃', 'Short lane · throwaway'),
              L('greet / summarize / smart-kw / smart-ans / ws-map —— 展示与检索类，调低更快更省。', 'greet / summarize / smart-kw / smart-ans / ws-map — display and recall jobs; a lower setting is faster and cheaper.')],
          ]
          kids.push(h('div', { key: '__effort__', style: { marginTop: '10px', paddingTop: '8px', borderTop: '1px solid color-mix(in srgb, var(--dsw-alias-border-l1, rgba(128,128,128,.25)) 45%, transparent)' } },
            h('b', { style: { display: 'block', fontSize: 'calc(12px * var(--dam-scale))' } }, L('思考强度（按记忆寿命分两轴）', 'Reasoning effort (by memory lifespan)')),
            effortKeys.map(function (row) {
              var cur = String(cfg[row[0]] || '').toLowerCase()
              return h('div', { key: 'effrow-' + row[0], style: { marginTop: '6px' } },
                h('div', { style: { fontSize: 'calc(11px * var(--dam-scale))', opacity: 0.85 } }, row[1]),
                h('div', { 'data-dam-slot': 'list', 'data-dam-row': '', style: { flexWrap: 'wrap', marginTop: '3px' } },
                  effortOpts.map(function (o) {
                    return h('button', {
                      key: 'eff-' + row[0] + '-' + (o[0] || 'def'), 'data-dam-slot': 'actions', 'data-dam-btn': '',
                      style: { padding: '3px 9px', fontWeight: cur === o[0] ? 700 : 400, opacity: cur === o[0] ? 1 : 0.72 },
                      onClick: function () { set(row[0], o[0]) },
                    }, o[1] + (cur === o[0] ? ' ✓' : ''))
                  })),
                h('div', { 'data-dam-slot': 'hint', 'data-dam-hint': '' }, row[2]))
            }),
            h('div', { 'data-dam-slot': 'hint', 'data-dam-hint': '' }, L('off=关闭思维链，low/high/max 递增思考深度（DeepSeek 默认 high）；两轴留空 = 回落到「全部子代理」那一档。只作用于本插件的子代理，不影响主对话。', 'off disables thinking; low/high/max increase depth (DeepSeek default: high). An empty lane falls back to the “All subagents” row. Applies only to this plugin`s subagents, never the main conversation.'))))
          return h('div', { style: panelStyle }, kids)
        }
        var verPair = useState(null)
        var verInfo = verPair[0]
        var setVerInfo = verPair[1]
        var checkingPair = useState(false)
        var checkingUpdate = checkingPair[0]
        var setCheckingUpdate = checkingPair[1]
        var upBusyPair = useState(false)
        var upBusy = upBusyPair[0]
        var setUpBusy = upBusyPair[1]
        var upMsgPair = useState('')
        var upMsg = upMsgPair[0]
        var setUpMsg = upMsgPair[1]
        useEffect(function () { return controller.subscribe(tickPair[1]) }, [])
        useEffect(function () {
          var alive = true
          apiGet(API.config).then(function (d) {
            if (!alive) return
            if (!i5Ok()) return
            i5Base.current = configOf(d)
            var recovered = iter5SettingsDrafts[i5DraftKey]
            if (recovered) {
              i5Draft.current = Object.assign({}, recovered.patch); i5Groups.current = Object.assign({}, recovered.groups)
              setCfg(Object.assign({}, configOf(d), recovered.patch)); setDirty(true)
              setMsg(L('已恢复此会话未保存的修改，请核对后保存或取消。', 'Unsaved edits for this session were restored. Review before saving or discarding.'))
              var conflict = Object.keys(recovered.patch).some(function (key) { return JSON.stringify(configOf(d)[key]) !== JSON.stringify(recovered.base[key]) })
              if (conflict) setErr(L('部分设置已在其他入口变更；恢复的草稿尚未覆盖服务器，请核对。', 'Some settings changed elsewhere. Restored edits have not overwritten the server; review them.'))
            } else setCfg(configOf(d))
            // ★P10-T1：分区清单随 config 应答体下发（宿主唯一真源；取不到就留空 ⇒ 面板给 fail-soft 提示）
            setPsecKeys(Array.isArray(d.promptSections) ? d.promptSections : [])
            setPsecMust(Array.isArray(d.promptSectionMust) ? d.promptSectionMust : [])
          }).catch(function (e) { setErr(e.message) })
          // 打开设置页自动检查更新(host 有 12h 缓存,不重复查网)
          apiGet(API.updateCheck).then(function (d) { if (alive) setVerInfo(d) }).catch(function () {})
          return function () { alive = false }
        }, [])
        // M7.5 语义引擎资产状态与安装引导(Hooks 必须位于任何条件 return 之前——React 规则,
        // 否则 cfg 未加载时提前 return 会跳过这些 useState,二次渲染 hooks 数量不一致 → error #310)
        var semPair = useState({ loaded: false, ready: false, assetPresent: false, peerPresent: false, pythonInt8Present: false })
        var sem = semPair[0]
        var setSem = semPair[1]
        var guidePair = useState('js')
        var promptEditPair = useState(false)
        var promptEditOpen = promptEditPair[0]
        var setPromptEditOpen = promptEditPair[1]
        var guide = guidePair[0]
        var setGuide = guidePair[1]
        var mirrorPair = useState('auto')
        var mirror = mirrorPair[0]
        var setMirror = mirrorPair[1]
        // M-CM6-B v3·环境检测面板状态(2026-09-08)——必须挂在下方 if (!cfg) 早退之前:
        // hooks 挂在早退后会在 cfg 加载完成的首帧多执行,React 报 hooks 数量不一致,整棵设置树崩溃(设置页整体消失)。
        var detOpenPair = useState(false)
        var detOpen = detOpenPair[0]
        var setDetOpen = detOpenPair[1]
        var detPair = useState(null)
        var det = detPair[0]
        var setDet = detPair[1]
        var detBusyPair = useState(false)
        var detBusy = detBusyPair[0]
        var setDetBusy = detBusyPair[1]
        // ★P10-T1（2026-09-22）：注入分区开关的**二级页**状态 + 清单。
        //   清单来自宿主常量（经 /config 应答体 promptSections 下发），前端不硬编码成员。
        //   同 det* 的理由：必须挂在下方 if (!cfg) 早退之前，否则 hooks 数量不一致 → error #310。
        var psecOpenPair = useState(false)
        var psecOpen = psecOpenPair[0]
        var setPsecOpen = psecOpenPair[1]
        var psecKeysPair = useState([])
        var psecKeys = psecKeysPair[0]
        var setPsecKeys = psecKeysPair[1]
        var psecMustPair = useState([])
        var psecMust = psecMustPair[0]
        var setPsecMust = psecMustPair[1]
        useEffect(function () {
          refreshSem(setSem, function () { setSem({ loaded: true, ready: false }) })
          return function () {}
        }, [])
        // 下载进行中每 1.5s 轮询真实进度(服务端流式记账 bytesDone/bytesTotal/mirrorUsed)
        useEffect(function () {
          var ph = sem && sem.download && sem.download.phase
          if (ph !== 'downloading' && ph !== 'verifying') return function () {}
          var iv = setInterval(function () {
            refreshSem(setSem)
          }, 1500)
          return function () { clearInterval(iv) }
        }, [sem && sem.download && sem.download.phase])
        if (!cfg) return err ? h('div', { 'data-dam-error': '' }, err) : h(Loading)
      // issue #52:旧实现 `var next = Object.assign({}, cfg); next[key] = value` 读的是**本次渲染的闭包快照**。
      // 同一个事件里连续调 `set('subagentModel', m); set('subagentProvider', p)` 时,React 批处理两次
      // 更新,而第二次仍基于同一个旧 cfg ⇒ 把第一次写进去的值**覆盖回旧值**。
      // 典型症状:subagentModel 存过一个后来被删除的模型后,无论换模型/清空/手输都无法覆盖,
      // 插件持续按已删除模型派子代理(issue #52)。
      // 修法:改用函数式更新,基于**最新** prev 派生 next,成对字段不再互相覆盖。
      function set(key, value) {
          if (busy) return
          if (key === 'associativeMemoryEnabled' && value === false && cfg.associativeMemoryEnabled && !window.confirm(L('关闭自动记忆引擎并保存后，将清零全部观察数据。记忆正文保留。确定关闭？', 'Saving with the engine disabled clears all observation data. Memory files are preserved. Disable?'))) return
          i5Record(key, value)
          setCfg(function (prev) { var next = Object.assign({}, prev); next[key] = value; return next })
        }
      /** 原子更新多个字段(issue #52 建议口径):一次函数式更新写入成对字段,避免先后覆盖。 */
      function setMany(patch) { if (busy) return; Object.keys(patch).forEach(function (k) { i5Record(k, patch[k]) }); setCfg(function (prev) { return Object.assign({}, prev, patch) }) }
        function checkUpdate() {
          if (checkingUpdate) return
          setCheckingUpdate(true)
          apiGet(API.updateCheck + '?force=1').then(function (d) { setVerInfo(d); setCheckingUpdate(false) })
            .catch(function (e) { setVerInfo({ error: e.message }); setCheckingUpdate(false) })
        }
        function doUpdate() {
          if (upBusy) return
          setUpBusy(true); setUpMsg('')
          apiPost(API.update, {}).then(function (d) {
            setUpBusy(false)
            if (d && d.ok) { setUpMsg(t('updateDone')); setVerInfo(null); checkUpdate() }
            else setUpMsg(t('updateFailed') + (d && d.message ? d.message : t('unknown')))
          }).catch(function (e) { setUpBusy(false); setUpMsg(t('updateFailed') + e.message) })
        }
        function save() {
          if (busy || !Object.keys(i5Draft.current).length) return
          setBusy(true); setMsg(''); setErr('')
          var patch = Object.assign({}, i5Draft.current)
          saveConfigPatch(patch, {
            onSaved: function (d) {
              if (!i5Ok()) return
              i5Base.current = configOf(d)
              delete iter5SettingsDrafts[i5DraftKey]
              i5Draft.current = {}; i5Groups.current = {}
              setCfg(configOf(d)); setDirty(false); setBusy(false); setMsg(t('saved'))
              if (configOf(d).locale) applyLocalePref(configOf(d).locale)
              refreshSem(setSem)
            },
            onError: function (e) { if (i5Ok()) { setErr(e.message); setBusy(false) } }
          })
        }
        function field(label, control, hint) {
          if (control && (control.type === 'input' || control.type === 'select' || control.type === 'textarea')) control = React.cloneElement(control, { 'aria-label': label, disabled: busy || control.props.disabled, role: control.type === 'input' && control.props.type === 'checkbox' ? 'switch' : undefined })
          return h('div', { 'data-dam-settings-row': '', 'data-i5-field': label },
            h('div', { 'data-dam-slot': 'list', 'data-dam-row': '' }, h('label', null, label), control),
            hint ? h('div', { 'data-dam-slot': 'hint', 'data-dam-hint': '' }, hint) : null)
        }
        function setAccent(value) {
          accentTheme = ACCENT_VALUES[value] ? value : 'deepseek'
          try { localStorage.setItem('dsh-auto-memory.accentTheme.v1', accentTheme) } catch (e) {}
          emit()
        }
        function setDensity(value) {
          graphDensity = value === 'compact' ? 'compact' : 'relaxed'
          try { localStorage.setItem('dsh-auto-memory.graphDensity.v1', graphDensity) } catch (e) {}
          emit()
        }
        // M-CM6-B v3·环境检测面板(2026-09-08):semMode 下拉旁 ⟳ 按钮 → 自动检索环境 → 联动安装助手(美学对齐安装向导卡)
        // (det* hooks 已上移到 if (!cfg) 早退之前,见 mirrorPair 后——此处只放事件函数)
        function runDetect() {
          if (detBusy) return
          setDetOpen(true)
          setDetBusy(true)
          apiGet(API.semanticDeepDetect).then(function (d) {
            setDet(d || {}); setDetBusy(false)
            // 2026-09-08:检测发现缺失时按当前模式自动打开对应安装引导卡(兑现「缺失时自动弹安装引导」)
            var rec = d && d.recommendation
            var mode = (cfg && cfg.semanticEngineMode) || 'auto'
            if (rec === 'setup-python' && mode === 'python') setGuide('python')
            else if ((rec === 'download-model' || rec === 'install-peer' || rec === 'setup-both') && mode !== 'python') setGuide('js')
            else if (rec === 'setup-both' && mode === 'python') setGuide('python')
          }).catch(function () { setDet({ failed: true }); setDetBusy(false) })
          refreshSem(setSem)
        }
        function onEngineModeChange(e) {
          var v = e.target.value
          if (busy) return
          setBusy(true); setErr(''); setMsg('')
          saveConfigPatch({ semanticEngineMode: v }, {
            onSaved: function (d) {
              if (!i5Ok()) return
              i5Base.current = configOf(d)
              setCfg(Object.assign({}, configOf(d), i5Draft.current)); setBusy(false)
              setMsg(L('检索模式已即时生效', 'Retrieval mode saved immediately'))
              refreshSem(function (s) {
                if (!i5Ok()) return
                setSem(s)
                setGuide(v === 'js' && !s.ready ? 'js' : v === 'python' && !s.pythonInt8Present ? 'python' : '')
              })
            }, onError: function (e) { if (i5Ok()) { setErr(e.message); setBusy(false) } }
          })
        }
        var sectionLabels = {
          engine: L('语义记忆总开关', 'Memory engine'),
          window: L('记忆窗口（注入什么）', 'Memory window'),
          capacity: L('记忆容量与归档', 'Capacity & retention'),
          skills: L('自动沉淀成技能', 'Skills & promotion'),
          handoff: L('长会话接续', 'Handoff & continuation'),
          auto: L('自动化与免打扰', 'Automation'),
          store: L('存储与外部记忆', 'Storage'),
          look: L('外观与交互', 'Appearance'),
          team: L('团队协作', 'Teamwork'),
          team: L('团队协作', 'Teamwork'),
          skin: L('皮肤素材', 'Skin assets'),
        }
        var i5WelcomeControl = null
        function section(key, title, content) {
          if (key === 'auto') content = content.filter(function (node) { if (node && node.props && node.props['data-i5-field'] === t('fWelcomeTour')) { i5WelcomeControl = node; return false } return true })
          if (key === 'look' && i5WelcomeControl) content = [i5WelcomeControl].concat(content)
          var hidden = i5GroupsDef[i5Group[0]].indexOf(key) < 0
          if (key === 'engine') {
            var mode = [], primary = [], advanced = [], support = []
            content.forEach(function (node) {
              if (!node) return
              var label = node.props && node.props['data-i5-field']
              if (label === t('semMode')) mode.push(node)
              else if (label === t('fAssocEngine') || label === t('fAnchorIndex')) primary.push(node)
              else if (label) advanced.push(node)
              else support.push(node)
            })
            return h('div', { id: i5SettingsId + '-section-' + key, className: 'i5-engine-grid', hidden: hidden },
              h(Iter5Card, { className: 'i5-mode-card', title: L('检索模式', 'Retrieval mode'), icon: 'search', hue: 'blue' }, mode),
              h(Iter5Card, { className: 'i5-setup-card', title: L('引擎状态与安装', 'Engine status & setup'), icon: 'spark', hue: 'purple' }, support),
              h(Iter5Card, { title: title, icon: 'pulse', hue: 'green' }, primary, h('details', null, h('summary', null, L('高级：发射模式、判定参数与观测', 'Advanced: emission, thresholds & observation')), advanced)))
          }
          var icons = { window: 'library', capacity: 'storage', skills: 'skills', handoff: 'handoff', auto: 'timeline', store: 'folder', look: 'settings', team: 'mindmap', skin: 'spark', about: 'note' }
          return h('section', { id: i5SettingsId + '-section-' + key, 'data-dam-settings-group': '', hidden: hidden }, h('h3', { className: 'i5-card-title' }, h('span', { className: 'i5-badge', 'data-hue': key === 'skills' ? 'green' : key === 'handoff' ? 'cyan' : key === 'auto' ? 'orange' : 'blue' }, h(Iter5Icon, { name: icons[key] || 'settings' })), title), content)
        }
        function jumpToSection(key) {
          setSettingsSection(key)
          try { var el = document.getElementById('dam-settings-' + key); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }) } catch (e) {}
        }
        return h('div', { 'data-dam-settings': '', 'data-i5-dirty': dirty ? 'true' : 'false' },
          h(Iter5Tabs, { id: i5SettingsId, label: L('设置分组', 'Settings groups'), value: i5Group[0], onChange: i5Group[1], items: [['engine', L('引擎', 'Engine')], ['memory', L('记忆', 'Memory')], ['appearance', L('外观与目录', 'Appearance & paths')], ['behavior', L('行为与维护', 'Behavior & maintenance')]].map(function (r) { return [r[0], r[1], Object.keys(i5Groups.current).some(function (k) { return i5Groups.current[k] === r[0] })] }) }),
          h('nav', { 'data-dam-region': 'settings', 'data-dam-settings-nav': '', 'aria-label': L('设置分组', 'Settings sections') }, Object.keys(sectionLabels).map(function (key) {
            return h('button', { key: key, 'data-dam-slot': 'actions', 'data-dam-btn': '', 'data-active': settingsSection === key ? 'true' : undefined, onClick: function () { jumpToSection(key) } }, sectionLabels[key])
          })),
          h('div', { 'data-dam-settings-content': '', role: 'tabpanel', id: i5SettingsId + '-panel', 'aria-labelledby': i5SettingsId + '-tab-' + i5Group[0] },
          section('engine', sectionLabels.engine, [
            field(t('fAssocEngine'), h('input', { type: 'checkbox', checked: !!cfg.associativeMemoryEnabled, onChange: function (e) { set('associativeMemoryEnabled', e.target.checked) } }), t('fAssocEngineHint')),
            field(t('fAnchorIndex'), h('input', { type: 'checkbox', checked: !!cfg.memoryAnchorEnabled, onChange: function (e) { set('memoryAnchorEnabled', e.target.checked) } }), t('fAnchorIndexHint')),
            field(t('fJsCooldown'), h('input', { 'data-dam-slot': 'form', 'data-dam-input': '', type: 'number', min: 0, max: 60, value: cfg.jsDecideCooldownRounds === undefined ? 1 : cfg.jsDecideCooldownRounds, onChange: function (e) { set('jsDecideCooldownRounds', (function () { var v = Number(e.target.value); return (Number.isFinite(v) && v >= 0) ? v : 1 })())  /* #19: 0=不冷却 是合法值,|| 1 会吃掉 0 */ } }), t('fJsCooldownHint')),
            field(t('fJsDelta'), h('input', { 'data-dam-slot': 'form', 'data-dam-input': '', type: 'number', min: 0, max: 1, step: 0.005, value: cfg.jsDecideDeltaExp === undefined ? 0.01 : cfg.jsDecideDeltaExp, onChange: function (e) { var v = Number(e.target.value); set('jsDecideDeltaExp', Number.isFinite(v) && v >= 0 ? v : 0.01) } }), t('fJsDeltaHint')),
            field(t('fJsExcerpt'), h('input', { 'data-dam-slot': 'form', 'data-dam-input': '', type: 'number', min: 20, max: 480, value: cfg.jsDecideExcerptChars === undefined ? 40 : cfg.jsDecideExcerptChars, onChange: function (e) { set('jsDecideExcerptChars', Math.max(20, Math.min(480, Number(e.target.value) || 40))) } }), t('fJsExcerptHint')),
            field(t('fEmitMode'), h('select', { 'data-dam-select': '', value: (sem && sem.activationEmitMode) || 'shadow', onChange: function (e) { var m = e.target.value; apiPost(API.semanticEmit, { mode: m }).then(function () { if (i5Ok()) refreshSem(setSem) }).catch(function (e) { if (i5Ok()) setErr(e.message) }) } },
              h('option', { value: 'shadow' }, L('shadow 只记录', 'shadow (record only)')),
              h('option', { value: 'canary-explicit' }, L('canary 显式回忆注入', 'canary (explicit recall)')),
              h('option', { value: 'active' }, L('active 全部注入', 'active (all)'))), t('fEmitModeHint')),
            // ★2026-09-30（C1 · 用户裁定：设置面必须全量、不得缺项）——
            //   唤起链路的**四道真闸门**此前只有宿主读、没有任何 UI 入口（实测 client.js 零引用）：
            //   ① activationInboxEnabled = 「记忆唤回」总闸（activation-host effectiveEnabled 的第二个条件，
            //      关着则 pre-step claim / reference-tail 渲染 / 状态三处全早退 ⇒ 设置显示正常但唤回永不投递）；
            //   ② shadowRetrievalEnabled = 主动唤起的影子检索（shadow-host）；
            //   ③ contextBridgeEnabled = 上下文桥（context-host）；
            //   ④ l0IndexEnabled = L0 向量索引接线（l0-index-sync）。
            //   ⚠️ 不给 pythonBackendEnabled / activationSource / contextSinkMode 独立控件：
            //   它们是 semanticEngineMode 的**联动派生值**（index.js 自动对齐），单独可改会互相打架。
            field(t('fInboxGate'), h('input', { type: 'checkbox', 'data-dam-gate': 'activationInboxEnabled', checked: cfg.activationInboxEnabled === true, onChange: function (e) { set('activationInboxEnabled', e.target.checked) } }), t('fInboxGateHint')),
            field(t('fShadowRetrieval'), h('input', { type: 'checkbox', 'data-dam-gate': 'shadowRetrievalEnabled', checked: cfg.shadowRetrievalEnabled === true, onChange: function (e) { set('shadowRetrievalEnabled', e.target.checked) } }), t('fShadowRetrievalHint')),
            field(t('fContextBridge'), h('input', { type: 'checkbox', 'data-dam-gate': 'contextBridgeEnabled', checked: cfg.contextBridgeEnabled === true, onChange: function (e) { set('contextBridgeEnabled', e.target.checked) } }), t('fContextBridgeHint')),
            field(t('fL0Index'), h('input', { type: 'checkbox', 'data-dam-gate': 'l0IndexEnabled', checked: cfg.l0IndexEnabled !== false, onChange: function (e) { set('l0IndexEnabled', e.target.checked) } }), t('fL0IndexHint')),
            // 只读诊断：把「三道门 + 当前档位」如实显示，消除「设置显示正常但不生效」的盲区。
            // ★2026-09-30 真机教训：settings 面板曾显示「一切就绪」而 Python sidecar 根本没进程 ——
            //   故此处**以宿主探测结果为准**（pythonInt8Present / resolvedTier / activationEmitMode），不猜。
            (function () {
              var rows = []
              var emitMode = (sem && sem.activationEmitMode) || 'shadow'
              var tier = (sem && sem.resolvedTier) || ''
              var gateOk = cfg.associativeMemoryEnabled === true && cfg.activationInboxEnabled === true
              rows.push(L('总闸（自动记忆 + 收件箱）', 'Master gate (associative + inbox)') + '：' + (gateOk ? L('已开', 'ON') : L('关（唤回不会投递）', 'OFF (recall will not be delivered)')))
              rows.push(L('唤起注入模式', 'Emit mode') + '：' + emitMode)
              rows.push(L('当前档位', 'Resolved tier') + '：' + (tier === 'c3' ? 'C3 · Python' : tier === 'c2' ? 'C2 · JS' : tier ? ('C1 · ' + tier) : L('检测中', 'detecting')))
              if (sem && sem.pythonRuntime) {
                var rt = sem.pythonRuntime
                var pyOk = rt.state === 'ready' && rt.depsOk !== false
                rows.push(L('Python 运行时', 'Python runtime') + '：' + (pyOk ? L('可用', 'available') : (L('不可用', 'unavailable') + (rt.state ? ' (' + rt.state + ')' : ''))))
              }
              return h('div', { 'data-dam-gate-readout': '', 'data-dam-slot': 'hint', 'data-dam-hint': '', style: { fontSize: 'calc(11.5px * var(--dam-scale))', lineHeight: 1.8, opacity: .82, marginTop: '4px' } },
                rows.map(function (line, i) { return h('div', { key: 'r' + i }, line) }))
            })(),
            field(t('fCandScheme'), h('select', { 'data-dam-select': '', value: cfg.jsDecideCandidateScheme || 'balanced', onChange: function (e) { set('jsDecideCandidateScheme', e.target.value) } },
              h('option', { value: 'balanced' }, L('balanced 3×40', 'balanced 3×40')),
              h('option', { value: 'dense' }, L('dense 6×20', 'dense 6×20')),
              h('option', { value: 'custom' }, L('custom 自定义', 'custom'))), t('fCandSchemeHint')),
            (cfg.jsDecideCandidateScheme === 'custom') ? field(t('fCandN'), h('input', { 'data-dam-slot': 'form', 'data-dam-input': '', type: 'number', min: 1, max: 8, value: cfg.jsDecideCandidatesN === undefined ? 4 : cfg.jsDecideCandidatesN, onChange: function (e) { set('jsDecideCandidatesN', Math.max(1, Math.min(8, Number(e.target.value) || 4))) } }), t('fCandNHint')) : null,
            field(t('semMode'), h('div', { style: { display: 'flex', gap: '6px', alignItems: 'center' } }, [
              h('div', { className: 'i5-engine-radios', role: 'radiogroup', 'aria-label': L('检索模式（即时生效）', 'Retrieval mode (immediate)') },
                [['auto', t('semAuto')], ['lexical', t('semLexOnly')], ['js', t('semJs')], ['python', t('semPy')]].map(function (r) { return h('label', { className: 'i5-engine-choice', key: r[0] }, h('input', { type: 'radio', name: 'i5-engine', value: r[0], checked: (cfg.semanticEngineMode || 'auto') === r[0], disabled: busy, onChange: onEngineModeChange }), h('span', null, r[1])) })),
              h('button', { 'data-dam-slot': 'actions', 'data-dam-btn': '', title: L('自动检测本机语义引擎环境(JS/Python 资产+推理库),并联动安装助手', 'Auto-detect local semantic engine assets & runtime, with setup assistant'), disabled: detBusy, onClick: function () { void runDetect() } }, detBusy ? '⏳' : '⟳ 检测'),
              // 2026-09-10:向导入口原先只在"资产未就绪"时自动弹出,已装好的用户反而进不去(想重装/换布局无处可点)。
              // 现在常驻一个显式开关,永远可达;已就绪时打开也只是复用同一套下载/校验步骤。
              h('button', { 'data-dam-slot': 'actions', 'data-dam-btn': '', title: L('打开/收起安装向导(按当前引擎选择:JS 模型 或 Python 引擎)', 'Open/collapse setup wizard (follows the selected engine)'), onClick: function () { setGuide(guide ? '' : ((cfg.semanticEngineMode === 'python') ? 'python' : 'js')) } },
                guide ? (L('收起向导', 'Hide wizard')) : (L('🧩 安装向导', '🧩 Setup'))),
            ]), t('semModeHint')),
            field(t('fIncEmbed'), h('input', { type: 'checkbox', checked: cfg.semanticEmbedIncremental !== false, onChange: function (e) { set('semanticEmbedIncremental', e.target.checked) } }), t('fIncEmbedHint')),
            // M-CM6-B v3·环境检测面板:⟳ 按钮触发,自动检索环境(快检+深扫+热接入),联动安装助手;美学对齐安装向导卡
            detOpen ? (function () {
              var panelStyle = { border: '1px solid color-mix(in srgb, var(--dsw-alias-border-l1, rgba(128,128,128,.25)) 60%, transparent)', borderRadius: '10px', padding: '12px', marginBottom: '10px', background: 'color-mix(in srgb, var(--dsw-alias-bg-layer-1, rgba(128,128,128,.06)) 55%, transparent)', backdropFilter: 'blur(14px) saturate(1.3)', WebkitBackdropFilter: 'blur(14px) saturate(1.3)' }
              var row = function (label, val) { return h('div', { style: { display: 'flex', gap: '8px', fontSize: 'calc(12px * var(--dam-scale))', lineHeight: 1.7 } }, [h('span', { style: { opacity: .7, minWidth: '120px', flexShrink: 0 } }, label), h('span', { style: { wordBreak: 'break-all' } }, val)]) }
              var tierText = det && det.resolvedTier === 'c2' ? 'C2 · JS 语义' : det && det.resolvedTier === 'c3' ? 'C3 · Python' : 'C1 · 词法兜底'
              var kids = [h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '6px' } }, [
                h('b', { style: { flex: 1, fontSize: 'calc(12px * var(--dam-scale))' } }, L('语义引擎环境检测', 'Semantic engine environment check')),
                h('button', { 'data-dam-slot': 'actions', 'data-dam-btn': '', disabled: detBusy, onClick: function () { void runDetect() } }, detBusy ? (L('检测中…', 'Scanning…')) : (L('重新检测', 'Rescan'))),
                h('button', { 'data-dam-slot': 'actions', 'data-dam-btn': '', onClick: function () { setDetOpen(false) } }, t('close')),
              ])]
              if (detBusy && !det) {
                kids.push(h('div', { 'data-dam-slot': 'hint', 'data-dam-hint': '' }, L('正在检测本地资产与推理库(快检 + 失败自动深度扫描 ~/.dsh/profiles 与 pnpm 虚拟存储)…', 'Scanning local assets and inference runtime (quick scan + deep scan of ~/.dsh/profiles and pnpm store)…')))
              } else if (det && det.failed) {
                kids.push(h('div', { 'data-dam-error': '' }, L('✗ 检测失败,请稍后重试。', '✗ Detection failed, please retry.')))
              } else if (det) {
                kids.push(row('JS 引擎模型', det.ready ? '✓ 就绪' : '✗ 未就绪'))
                if (det.assetPath) kids.push(row('模型路径', String(det.assetPath).slice(-72) + (det.assetBytes ? ' (' + Math.round(det.assetBytes / 1048576) + 'MB)' : '')))
                // ★2026-09-30（用户原则①「真跑通才算通过」+ 原则②「失败把报错摆出来」）：
                //   Python 行的**三态显示** —— 不再拿"文件在不在"冒充就绪。判据来自后端
                //   probePythonRuntime（解释器链 deps 探测 + worker health 真反馈）。
                var pr = det && det.pythonRuntime
                var pyState, pyHint = ''
                if (pr) {
                  // ★2026-09-30 三态以**后端权威 state** 为准（verified-ok/ready-unverified/
                  //   start-failed/deps-failed/no-files），前端不再自行拼接判据 —— 面板与档位同源，不再矛盾。
                  if (pr.state === 'verified-ok') {
                    pyState = L('✓ 就绪（已实测启动）', '✓ Ready (verified)')
                    pyHint = (pr.chosenLabel || '') + (pr.chosenIsDev ? L(' · 检测到开发值，欢迎开发者', ' · dev tree detected') : '')
                    if (pr.worker && pr.worker.vectorReady === false) pyHint += L(' · 向量待索引重建（正常）', ' · vectors pending rebuild')
                  } else if (pr.state === 'ready-unverified') {
                    pyState = L('✓ 就绪（依赖通过，尚未实测启动）', '✓ Ready (deps ok, not yet verified)')
                    pyHint = (pr.chosenLabel || '') + (pr.chosenIsDev ? L(' · 检测到开发值，欢迎开发者', ' · dev tree detected') : '')
                  } else if (pr.state === 'start-failed') {
                    pyState = L('⚠ 有文件但未能启动', '⚠ Files present, failed to start')
                    pyHint = (pr.worker && pr.worker.reason) ? pr.worker.reason : (pr.error || L('启动探测未通过', 'startup probe failed'))
                  } else if (pr.state === 'deps-failed') {
                    pyState = L('⚠ 有文件但未能启动', '⚠ Files present, failed to start')
                    var noDep = (pr.probed || []).filter(function (x) { return x.deps !== true }).length
                    pyHint = pr.error || L('无可用解释器（' + noDep + ' 个候选缺依赖 transformers/onnxruntime/numpy）', noDep + ' interpreter candidate(s) lack deps')
                    if (pr.chosenIsDev) pyHint += L(' · 检测到开发值，欢迎开发者', ' · dev tree detected')
                  } else {
                    pyState = L('✗ 未安装', '✗ Not installed')
                    pyHint = pr.error || L('模型文件缺失', 'model file missing')
                  }
                } else {
                  var pyReady2 = (det && det.pythonInt8Present !== undefined) ? det.pythonInt8Present : sem.pythonInt8Present
                  pyState = (pyReady2 === undefined || pyReady2 === null) ? L('状态未知', 'unknown') : (pyReady2 ? '✓ 就绪' : '✗ 未就绪')
                }
                kids.push(row('Python 模型(int8)', pyState))
                if (pyHint) kids.push(row('　', pyHint.length > 200 ? pyHint.slice(0, 200) + '…' : pyHint))
                kids.push(row('当前生效档位', tierText))
                if (det.deep && det.deep.integrated) kids.push(row('深度扫描', locale === 'zh' ? '发现并热接入 ' + (det.deep.foundDirs || []).length + ' 处推理库(无需重启即生效)' : 'Hot-adopted ' + (det.deep.foundDirs || []).length + ' runtime dir(s) (no restart needed)'))
                if (det.recommendation && det.recommendation !== 'none') {
                  kids.push(h('div', { 'data-dam-slot': 'hint', 'data-dam-hint': '', style: { margin: '8px 0 6px' } }, L('检测到缺失项,联动安装助手:', 'Missing assets detected — open the setup assistant:')))
                  var btns = []
                  if (det.recommendation === 'download-model' || det.recommendation === 'setup-both') btns.push(h('button', { key: 'js', 'data-dam-slot': 'actions', 'data-dam-btn': '', style: { marginRight: '6px' }, onClick: function () { setGuide('js'); setDetOpen(false) } }, L('打开 JS 安装引导', 'Open JS setup')))
                  if (det.recommendation === 'setup-both' || det.recommendation === 'setup-python') btns.push(h('button', { key: 'py', 'data-dam-slot': 'actions', 'data-dam-btn': '', onClick: function () { setGuide('python'); setDetOpen(false) } }, L('打开 Python 向导', 'Open Python wizard')))
                  if (det.recommendation === 'install-peer') kids.push(h('div', { 'data-dam-slot': 'hint', 'data-dam-hint': '', style: { marginTop: '4px' } }, L('模型已就绪但推理库(@huggingface/transformers)缺失:请在其它设备安装后重试检测,或按 JS 引导重装。', 'Model ready but runtime (@huggingface/transformers) missing: install it and re-scan, or reinstall via JS setup.')))
                  if (btns.length) kids.push(h('div', { style: { display: 'flex', gap: '6px' } }, btns))
                } else if (det.ready && det.pythonInt8Present !== false && !(det.pythonRuntime && (det.pythonRuntime.state === 'start-failed' || det.pythonRuntime.state === 'deps-failed'))) {
                  kids.push(h('div', { 'data-dam-slot': 'hint', 'data-dam-hint': '', style: { marginTop: '8px' } }, L('✓ 一切就绪,无需安装。', '✓ Everything is ready.')))
                } else if (det.ready) {
                  // 2026-09-08 修复:JS 就绪但 Python 缺失不再显示「一切就绪」(此前 recommendation=none 导致矛盾+无引导)
                  // ★2026-09-30 文案按**运行时状态**区分（修真机矛盾：状态明明是"有文件未能启动"，却提示"未安装、当前模式不受影响"）
                  var pyBad = det.pythonRuntime && (det.pythonRuntime.state === 'start-failed' || det.pythonRuntime.state === 'deps-failed')
                  var pyModeNow = cfg.semanticEngineMode === 'python'
                  kids.push(h('div', { 'data-dam-slot': 'hint', 'data-dam-hint': '', style: { margin: '8px 0 6px' } }, pyBad
                    ? (pyModeNow
                      ? L('JS 引擎就绪;Python 档有文件但未能启动（原因见上）——当前选的就是 Python 档,语义检索将回退到内置引擎/词法档。', 'JS engine ready; Python has files but failed to start (see reason above) — Python mode is selected, so retrieval falls back to the built-in engine / lexical.')
                      : L('JS 引擎就绪;Python 档有文件但未能启动（原因见上）——仅影响 Python 引擎模式,当前模式不受影响。', 'JS engine ready; Python has files but failed to start (see reason above) — only the Python engine mode is affected.'))
                    : L('JS 引擎就绪;Python 模型未安装——仅影响 Python 引擎模式,当前模式不受影响。', 'JS engine ready; the Python model is not installed — only the Python engine mode is affected.')))
                  kids.push(h('div', { style: { display: 'flex', gap: '6px' } }, [h('button', { 'data-dam-slot': 'actions', 'data-dam-btn': '', onClick: function () { setGuide('python'); setDetOpen(false) } }, L('打开 Python 向导', 'Open Python wizard'))]))
                }
              }
              return h('div', { 'data-dam-detect-panel': '', style: panelStyle }, kids)
            })() : null,
            guide === 'python' ? h(PySetupWizard) : null,
            guide === 'js' || guide === 'python' ? (function () {
              // 安装引导卡(对齐 ui-assets 原型:进度条/下载源/体积/状态)——资产检测由 sem 状态机驱动
              var isJs = guide === 'js'
              var title = isJs ? (L('内置语义引擎 · 安装引导', 'Built-in semantic engine · setup')) : (L('高级 Python 引擎 · 安装引导', 'Advanced Python engine · setup'))
              var desc = isJs
                ? (L('下载约130MB本地量化模型（multilingual-e5-small），校验后离线运行——记忆不出电脑。下载期间词法检索照常可用，完成后自动启用。', 'Downloads a ~130MB local quantized model (multilingual-e5-small), verifies and runs fully offline — memories never leave this machine. Lexical search keeps working during setup; the engine switches on automatically when ready.'))
                : (L('高级引擎通过本地 Python sidecar 运行 BGE-M3 int8（约563MB），召回质量最高。需要引导式安装（Python 环境 + 模型），适合深度用户；不安装不影响内置引擎。', 'The advanced engine runs BGE-M3 int8 (~563MB) via a local Python sidecar for maximum recall. Guided install required (Python runtime + model); optional for power users.'))
              var ready = isJs ? sem.ready : sem.pythonInt8Present
              var bytes = isJs ? (sem.assetBytes || 0) : (sem.pythonInt8Bytes || 0)
              var dl = (isJs && sem.download) ? sem.download : { phase: 'idle' }
              var dlActive = dl.phase === 'downloading' || dl.phase === 'verifying'
              // 规范 G 七态之「建库中」:SHA256 过了但引擎还在后台编码全量语料(jsSemantic.embedding)
              var building = isJs && sem.jsSemantic && sem.jsSemantic.embedding === true
              var totalJs = sem.manifestBytes || Math.round(130 * 1024 * 1024)
              var stateTxt, stateBg
              if (!sem.loaded) { stateTxt = L('检测中…', 'Detecting…'); stateBg = 'var(--dam-neutral-16, rgba(128,128,128,.16))' }
              else if (ready && building) { stateTxt = L('已就绪 · 建库中…', 'Ready · building index…'); stateBg = 'var(--dam-36-86-196-2, rgba(36,86,196,.2))' }
              else if (ready) { stateTxt = L('已就绪 ✓', 'Ready ✓'); stateBg = 'var(--dam-47-164-106-24, rgba(47,164,106,.24))' }
              else if (dl.phase === 'error') { stateTxt = t('dlError'); stateBg = 'var(--dam-196-74-74-22, rgba(196,74,74,.22))' }
              else if (dl.phase === 'cancelled') { stateTxt = t('dlCancelled'); stateBg = 'var(--dam-196-138-42-2, rgba(196,138,42,.2))' }
              else if (isJs && dlActive) { stateTxt = dl.phase === 'verifying' ? t('dlVerifying') : t('dlDownloading'); stateBg = 'var(--dam-36-86-196-2, rgba(36,86,196,.2))' }
              // ★ issue #70（2026-09-19）：资产齐备但引擎**已降级** —— 必须与「未下载」区分开。
              //   旧实现只看文件存在性 ⇒ 这种状态会显示「已就绪 ✓」而实际每次检索都在词法兜底。
              else if (isJs && sem.degraded) { stateTxt = locale === 'zh' ? ('引擎降级（词法兜底）— ' + String(sem.degraded).slice(0, 60)) : ('Engine degraded (lexical fallback) — ' + String(sem.degraded).slice(0, 60)); stateBg = 'var(--dam-196-74-74-22, rgba(196,74,74,.22))' }
              else if (isJs && sem.assetPresent && !sem.peerPresent) { stateTxt = L('模型已存在,缺推理库——pnpm approve-builds 后 pnpm add @huggingface/transformers', 'Model present, runtime missing — pnpm approve-builds && pnpm add @huggingface/transformers'); stateBg = 'var(--dam-196-138-42-2, rgba(196,138,42,.2))' }
              else { stateTxt = L('未下载', 'Not downloaded'); stateBg = 'var(--dam-196-138-42-2, rgba(196,138,42,.2))' }
              var progress = dlActive || (isJs && dl.phase === 'done')
                ? Math.min(100, Math.round(((dl.bytesDone || 0) / Math.max(1, dl.bytesTotal || totalJs)) * 100))
                : (bytes && !ready ? Math.min(100, Math.round(bytes / ((isJs ? 130 : 563) * 1024 * 1024) * 100)) : (ready ? 100 : 0))
              var fmtMB = function (b) { return b ? (b / (1024 * 1024)).toFixed(1) + ' MB' : '—' }
              var mirrorName = function (m) { return m === 'cn' ? t('mCn') : m === 'intl' ? t('mIntl') : t('mAuto') }
              var phaseLine = dlActive
                ? ((dl.phase === 'verifying' ? t('dlVerifying') : t('dlDownloading')) + ' · ' + fmtMB(dl.bytesDone || 0) + ' / ' + fmtMB(dl.bytesTotal || totalJs) + ' · ' + mirrorName(dl.mirrorUsed))
                : (dl.phase === 'error' ? (t('dlError') + ': ' + String(dl.error || '').slice(0, 120))
                  : (dl.phase === 'cancelled' ? t('dlCancelled')
                    : (isJs && dl.phase === 'done' && !ready ? t('dlDone') + (L('（缺运行库时需安装 @huggingface/transformers）', ' (install @huggingface/transformers if runtime missing)'))
                      : (L('下载进度', 'Download progress')))))
              // ★2026-09-20 移植（issue #89 / PR #95）：局部 var refreshSem 遮蔽模块级
              //   refreshSem(apply, onError) ⇒ 自递归爆栈被 .catch 吞 ⇒ 点「开始下载/取消」后
              //   sem 永不刷新、轮询闸也永不启动。改名引用模块级函数。
              var refreshSemNow = function () {
                refreshSem(setSem)
              }
              var startDl = function () {
                apiPost(API.semanticDownload, { action: 'start', mirror: mirror }).then(refreshSemNow).catch(function () {})
              }
              var cancelDl = function () {
                apiPost(API.semanticDownload, { action: 'cancel', mirror: mirror }).then(refreshSemNow).catch(function () {})
              }
              return h('div', { style: { border: '1px solid color-mix(in srgb, var(--dam-accent, #2456c4) 40%, transparent)', borderRadius: '10px', padding: '10px 12px', marginBottom: '8px', fontSize: 'calc(11.5px * var(--dam-scale))', lineHeight: 1.6 } },
                h('div', { 'data-dam-slot': 'list', 'data-dam-row': '', style: { alignItems: 'center' } },
                  h('b', null, title),
                  h('span', { style: { marginLeft: 'auto', fontSize: 'calc(10.5px * var(--dam-scale))', padding: '2px 8px', borderRadius: '6px', background: stateBg, fontWeight: 700 } }, stateTxt)),
                h('div', { style: { opacity: .85, marginTop: '4px' } }, desc),
                ready ? null : h('div', { style: { marginTop: '8px' } },
                  h('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: 'calc(10px * var(--dam-scale))', opacity: .7, marginBottom: '3px', gap: '8px' } },
                    h('span', null, phaseLine),
                    h('span', null, progress + '%')),
                  h('div', { style: { height: '7px', borderRadius: '99px', background: 'var(--dam-rgba-14, rgba(128,128,128,.14))', overflow: 'hidden' } },
                    h('div', { style: { height: '100%', width: progress + '%', borderRadius: '99px', background: dl.phase === 'error' ? 'linear-gradient(90deg,var(--dam-tone-error, #c44a4a),var(--dam-tone-error-soft, #e08a8a))' : 'linear-gradient(90deg, var(--dam-accent, #2456c4), var(--dam-progress-bar, #6f9bff))', transition: 'width .4s ease' } })),
                  h('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: 'calc(10px * var(--dam-scale))', opacity: .6, marginTop: '3px' } },
                    h('span', null, L('体积', 'Size'), ': ', isJs ? fmtMB(totalJs) + '（5 个文件，SHA256 校验后离线运行）' : '~563MB'),
                    h('span', null, L('下载源', 'Source'), ': ', isJs ? mirrorName(mirror) + (L(' · 失败自动切备用源', ' · auto-failover')) : (L('GitHub Releases 多通道', 'GitHub Releases multi-mirror'))))),
                h('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: '6px', alignItems: 'center', marginTop: '8px' } },
                  !ready && isJs && !dlActive ? h('select', { 'data-dam-select': '', value: mirror, onChange: function (e) { setMirror(e.target.value) }, style: { marginRight: 'auto' } },
                    h('option', { value: 'auto' }, t('mAuto')),
                    h('option', { value: 'cn' }, t('mCn')),
                    h('option', { value: 'intl' }, t('mIntl'))) : null,
                  // ★2026-09-22 删死键(设置页缺口审计 P0-7):pythonGpu 不在 DEFAULT_CONFIG 白名单,
                  //   /config 会静默丢弃、宿主 lib/ 零读取 ⇒ 写入无任何效果,故移除该段(行为零变化)。
                  ready ? h('button', { 'data-dam-slot': 'actions', 'data-dam-btn': '', onClick: function () { onEngineModeChange({ target: { value: guide } }) } }, L('启用并继续', 'Enable & continue')) : null,
                  !ready && isJs && !dlActive ? h('button', { 'data-dam-slot': 'actions', 'data-dam-btn': '', onClick: startDl }, (dl.phase === 'error' || dl.phase === 'cancelled') ? t('semDlRetry') : t('semDlStart')) : null,
                  !ready && isJs && dlActive ? h('button', { 'data-dam-slot': 'actions', 'data-dam-btn': '', onClick: cancelDl }, t('semDlCancel')) : null,
                  h('button', { 'data-dam-slot': 'actions', 'data-dam-btn': '', onClick: function () { setGuide('') } }, t('gotIt'))))
            })()
              : null,
            sem.loaded ? h('div', { 'data-dam-slot': 'hint', 'data-dam-hint': '', style: { marginTop: '-4px', marginBottom: '8px' } },
              t('semResolved') + ': ' + (sem.resolvedTier === 'c2' ? t('tierC2') + ' ✓' : sem.resolvedTier === 'c3' ? t('tierC3') + ' ✓' : t('tierC1')))
              : null,
            // 2026-09-08 检测联动:所选模式与资产就绪状态不符时显式标注(不再静默掉回词法兜底)
            (sem.loaded && cfg.semanticEngineMode === 'js' && sem.ready === false) ? h('div', { 'data-dam-error': '', style: { marginTop: '-4px', marginBottom: '8px' } },
              L('⚠ 已选 JS 引擎,但本地模型未就绪——当前实际生效:词法兜底。下方安装引导卡可下载模型(约130MB),完成后自动启用。', '⚠ JS engine selected but the local model is not ready — lexical fallback is active. Use the setup card below to download the model (~130MB); it engages automatically when done.')) : null,
            (sem.loaded && cfg.semanticEngineMode === 'python' && sem.pythonInt8Present === false) ? h('div', { 'data-dam-error': '', style: { marginTop: '-4px', marginBottom: '8px' } },
              L('⚠ 已选 Python 引擎,但 BGE-M3 int8 模型未就绪——当前实际生效:词法兜底。下方安装向导可引导安装;若本机无法安装(如架构不支持),请改用 JS 引擎或 auto。', '⚠ Python engine selected but the BGE-M3 int8 model is not ready — lexical fallback is active. Use the wizard below; if this machine cannot install it, switch to the JS engine or auto.')) : null,
            field(t('fReasoning'), h('input', { type: 'checkbox', checked: !!cfg.reasoningObserverEnabled, onChange: function (e) { set('reasoningObserverEnabled', e.target.checked) } }), t('fReasoningHint')),
            field(L('唤起阈值（校准策略）', 'Activation thresholds (calibrated)'), h('div', null,
              h('span', null, L('阈值由宿主校准策略管理；当前接口未提供有效数值', 'Thresholds are managed by the host policy; current values are unavailable') + (sem.loaded ? ((L(' · 发射模式:', ' · emit: ')) + (sem.activationEmitMode || 'shadow')) : ''))),
              t('fTuningHint')),
          ]),
          section('window', sectionLabels.window, [
            // ★P10-T1/T2/T3（2026-09-22）注入分区开关：**一级只放入口**（中性文案，不推荐用户改），
            //   13 个开关全在二级页；成员/顺序取自宿主下发的 psecKeys（前端不硬编码）。
            field(t('fPromptSections'), h('button', { 'data-dam-slot': 'actions', 'data-dam-btn': '', onClick: function () { setPsecOpen(!psecOpen) } }, psecOpen ? (L('收起', 'Collapse')) : (L('高级：逐段注入控制…', 'Advanced: per-section injection…'))), t('fPromptSectionsHint')),
            psecOpen ? (function () {
              var toggles = (cfg.promptSectionToggles && typeof cfg.promptSectionToggles === 'object') ? cfg.promptSectionToggles : {}
              var pText = function (k) { var m = PROMPT_SECTION_TEXT[k]; return m ? (locale === 'zh' ? m.zh : m.en) : k }
              var pOff = function (k) {
                var m = PROMPT_SECTION_TEXT[k]
                var z = m ? (locale === 'zh' ? m.offZh : m.offEn) : ''
                if (z) return z
                return L('关掉后本轮不再注入该段落。', 'When off, this section is not injected this round.')
              }
              return h('div', { 'data-dam-prompt-sections': '', style: { border: '1px solid color-mix(in srgb, var(--dsw-alias-border-l1, rgba(128,128,128,.25)) 60%, transparent)', borderRadius: '10px', padding: '12px', marginBottom: '10px', background: 'color-mix(in srgb, var(--dsw-alias-bg-layer-1, rgba(128,128,128,.06)) 55%, transparent)' } }, [
                h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '6px' } }, [
                  h('b', { style: { flex: 1, fontSize: 'calc(12px * var(--dam-scale))' } }, L('逐段注入控制（高级）', 'Per-section injection (advanced)')),
                  h('button', { 'data-dam-slot': 'actions', 'data-dam-btn': '', onClick: function () { set('promptSectionToggles', {}) } }, L('全部恢复全开', 'Restore all')),
                  h('button', { 'data-dam-slot': 'actions', 'data-dam-btn': '', onClick: function () { setPsecOpen(false) } }, t('close')),
                ]),
                h('div', { 'data-dam-slot': 'hint', 'data-dam-hint': '', style: { marginBottom: '8px' } }, L('控制每一轮注入里包含哪些段落。默认全部开启；不推荐修改 —— 关掉某段会让模型少掉对应的上下文或纪律。', 'Which sections each round injects. All on by default; not recommended to change — turning one off drops the matching context or discipline.')),
                psecKeys.length ? psecKeys.map(function (k) {
                  return h('div', { key: k, 'data-dam-slot': 'list', 'data-dam-row': '', style: { alignItems: 'flex-start' } }, [
                    h('label', { style: { display: 'flex', gap: '6px', alignItems: 'center', flex: 1, cursor: 'pointer' } }, [
                      h('input', { type: 'checkbox', 'data-dam-pswitch': k, checked: toggles[k] !== false, onChange: function (e) {
                        var t2 = Object.assign({}, toggles)
                        if (e.target.checked) delete t2[k]; else t2[k] = false
                        set('promptSectionToggles', t2)
                      } }),
                      h('span', { style: { fontSize: 'calc(12px * var(--dam-scale))' } }, pText(k) + (psecMust.indexOf(k) >= 0 ? (L(' · 硬性要求', ' · mandatory')) : '')),
                    ]),
                    h('div', { 'data-dam-slot': 'hint', 'data-dam-hint': '', style: { flex: 1, opacity: .8 } }, pOff(k)),
                  ])
                }) : h('div', { 'data-dam-slot': 'hint', 'data-dam-hint': '' }, L('未能从宿主取到分区清单（请重启宿主后重试）。', 'Section list unavailable (restart the host and retry).')),
              ])
            })() : null,
    field(t('fInject'), h('input', { type: 'checkbox', checked: !!cfg.injectEnabled, onChange: function (e) { set('injectEnabled', e.target.checked) } }), t('fInjectHint')),
            field(t('fBudget'), h('input', { 'data-dam-slot': 'form', 'data-dam-input': '', type: 'number', min: 400, value: cfg.injectBudgetChars, onChange: function (e) { set('injectBudgetChars', Number(e.target.value) || 2400) } }), t('fBudgetHint')),
            // 2026-09-22 补接线(设置页缺口审计 P0-3/P0-4/P0-6):目录层与规则分层此前只有后端实现。
            field(t('fTier0Catalog'), h('input', { type: 'checkbox', 'data-dam-key': 'tier0CatalogEnabled', checked: cfg.tier0CatalogEnabled !== false, onChange: function (e) { set('tier0CatalogEnabled', e.target.checked) } }), t('fTier0CatalogHint')),
            field(t('fTier0Max'), h('input', { 'data-dam-slot': 'form', 'data-dam-input': '', type: 'number', min: 100, value: cfg.tier0MaxTokens === undefined ? 400 : cfg.tier0MaxTokens, onChange: function (e) { set('tier0MaxTokens', Math.max(100, Number(e.target.value) || 400)) } }), t('fTier0MaxHint')),
            field(t('fRulesLayering'), h('input', { type: 'checkbox', 'data-dam-key': 'rulesLayeringMode', checked: String(cfg.rulesLayeringMode || 'self').toLowerCase() !== 'off', onChange: function (e) { set('rulesLayeringMode', e.target.checked ? 'self' : 'off') } }), t('fRulesLayeringHint')),
            field(t('fDays'), h('input', { 'data-dam-slot': 'form', 'data-dam-input': '', type: 'number', min: 1, max: 14, value: cfg.recentDaysInjected, onChange: function (e) { set('recentDaysInjected', Number(e.target.value) || 1) } }), t('fDaysHint')),
            field(t('fExtBudget'), h('input', { 'data-dam-slot': 'form', 'data-dam-input': '', type: 'number', min: 200, value: cfg.externalInjectionChars === undefined ? 1400 : cfg.externalInjectionChars, onChange: function (e) { set('externalInjectionChars', Number(e.target.value) || 1400) } }), t('fExtBudgetHint')),
            field(t('fSnapGap'), h('input', { 'data-dam-slot': 'form', 'data-dam-input': '', type: 'number', min: 0, max: 50, value: cfg.snapshotMinGapRounds === undefined ? 5 : cfg.snapshotMinGapRounds, onChange: function (e) { set('snapshotMinGapRounds', Number(e.target.value) || 5) } }), t('fSnapGapHint')),
            field(t('fReinjectOnCompact'), h('input', { type: 'checkbox', checked: cfg.snapshotReinjectOnCompact !== false, onChange: function (e) { set('snapshotReinjectOnCompact', e.target.checked) } }), t('fReinjectOnCompactHint')),
            // ★2026-09-30（C2 · 用户裁定：设置面必须全量，不得缺项）——注入预算/白板账本/水位四组键，
            //   此前只有宿主读、无 UI 入口（实测 client.js 零引用）：
            //   ① tier0BudgetShare = Tier-0 目录占注入预算的比例（与 tier0MaxTokens 取小生效）；
            //   ② slimPlanChars / slimLedgerChars = 精简版注入里白板/账本的字符上限；
            //   ③ snapshotTieredInject = 分级注入总开关（关掉=每轮全量快照，token 成本显著上升）；
            //   ④ waterLevelThresholdMode / officialCompactionRatio / officialHeadroomTokens / waterLevelAutoMargin
            //      = 上下文水位与压缩的四个人为旋钮（auto 档校准用）。
            //   全部写 DEFAULT_CONFIG 内既有键（宿主白名单通过）。
            field(t('fTier0Share'), h('input', { 'data-dam-slot': 'form', 'data-dam-input': '', type: 'number', min: 0, max: 1, step: 0.05, value: cfg.tier0BudgetShare === undefined ? 0.25 : cfg.tier0BudgetShare, onChange: function (e) { set('tier0BudgetShare', Math.max(0, Number(e.target.value) || 0.25)) } }), t('fTier0ShareHint')),
            field(t('fSlimPlan'), h('input', { 'data-dam-slot': 'form', 'data-dam-input': '', type: 'number', min: 0, max: 4000, value: cfg.slimPlanChars === undefined ? 400 : cfg.slimPlanChars, onChange: function (e) { set('slimPlanChars', Math.max(0, Number(e.target.value) || 400)) } }), t('fSlimPlanHint')),
            field(t('fSlimLedger'), h('input', { 'data-dam-slot': 'form', 'data-dam-input': '', type: 'number', min: 0, max: 4000, value: cfg.slimLedgerChars === undefined ? 300 : cfg.slimLedgerChars, onChange: function (e) { set('slimLedgerChars', Math.max(0, Number(e.target.value) || 300)) } }), t('fSlimLedgerHint')),
            field(t('fTieredInject'), h('input', { type: 'checkbox', 'data-dam-key': 'snapshotTieredInject', checked: cfg.snapshotTieredInject !== false, onChange: function (e) { set('snapshotTieredInject', e.target.checked) } }), t('fTieredInjectHint')),
            field(t('fWaterMode'), h('select', { 'data-dam-select': '', value: String(cfg.waterLevelThresholdMode || 'auto'), onChange: function (e) { set('waterLevelThresholdMode', e.target.value) } },
              h('option', { value: 'auto' }, L('auto 自动校准（推荐）', 'auto (calibrated)')),
              h('option', { value: 'fixed' }, L('fixed 固定阈值（旧行为）', 'fixed threshold (legacy)'))), t('fWaterModeHint')),
            field(t('fCompactionRatio'), h('input', { 'data-dam-slot': 'form', 'data-dam-input': '', type: 'number', min: 0.1, max: 1, step: 0.05, value: cfg.officialCompactionRatio === undefined ? 0.8 : cfg.officialCompactionRatio, onChange: function (e) { set('officialCompactionRatio', Math.max(0.1, Number(e.target.value) || 0.8)) } }), t('fCompactionRatioHint')),
            field(t('fOfficialHeadroom'), h('input', { 'data-dam-slot': 'form', 'data-dam-input': '', type: 'number', min: 0, max: 1000000, step: 1024, value: cfg.officialHeadroomTokens === undefined ? 65536 : cfg.officialHeadroomTokens, onChange: function (e) { set('officialHeadroomTokens', Math.max(0, Number(e.target.value) || 65536)) } }), t('fOfficialHeadroomHint')),
            field(t('fAutoMargin'), h('input', { 'data-dam-slot': 'form', 'data-dam-input': '', type: 'number', min: 0.1, max: 1, step: 0.05, value: cfg.waterLevelAutoMargin === undefined ? 0.9 : cfg.waterLevelAutoMargin, onChange: function (e) { set('waterLevelAutoMargin', Math.max(0.1, Number(e.target.value) || 0.9)) } }), t('fAutoMarginHint')),
            field(t('fPromptCustom'), h('button', { 'data-dam-slot': 'actions', 'data-dam-btn': '', onClick: function () { setPromptEditOpen(!promptEditOpen) } }, (promptEditOpen ? (L('收起', 'Collapse')) : (L('编辑 prompt 层', 'Edit prompt layers')))), t('fPromptCustomHint')),
            promptEditOpen ? [
              h('div', { key: '__layers', style: { padding: '6px 0 2px', width: '100%' } },
              (Object.keys(DEFAULT_PROMPT_LAYERS_CLIENT)).map(function (k) {
                return h('div', { key: k, style: { marginBottom: '6px' } },
                  h('div', { 'data-dam-slot': 'hint', 'data-dam-hint': '', style: { fontWeight: 700, marginBottom: '2px' } }, k),
                  h('textarea', { 'data-dam-slot': 'form', 'data-dam-input': '', rows: 2, style: { width: '100%', fontFamily: 'monospace', fontSize: 'calc(11px * var(--dam-scale))' }, value: (cfg.promptLayerOverrides || {})[k] || '', placeholder: DEFAULT_PROMPT_LAYERS_CLIENT[k] || '(默认文案)', onChange: function (e) { var ov = Object.assign({}, cfg.promptLayerOverrides || {}); if (e.target.value.trim() === '') delete ov[k]; else ov[k] = e.target.value; set('promptLayerOverrides', ov) } }))
              })),
              h('div', { key: '__reset', 'data-dam-slot': 'list', 'data-dam-row': '', style: { marginTop: '6px' } },
                h('button', { 'data-dam-slot': 'actions', 'data-dam-btn': '', onClick: function () { set('promptLayerOverrides', {}) } }, L('一键恢复默认', 'Reset to defaults')))
            ] : null,
          ]),
          section('capacity', sectionLabels.capacity, [
            field(t('fChildObs'), h('input', { type: 'checkbox', checked: !!cfg.contextBridgeObserveChildSessions, onChange: function (e) { set('contextBridgeObserveChildSessions', e.target.checked) } }), t('fChildObsHint')),
            field(t('fEpisodicRet'), h('input', { 'data-dam-slot': 'form', 'data-dam-input': '', type: 'number', min: 16, max: 4096, value: cfg.episodicRetention === undefined ? 256 : cfg.episodicRetention, onChange: function (e) { set('episodicRetention', Math.max(16, Math.min(4096, Number(e.target.value) || 256))) } }), t('fEpisodicRetHint')),
            // 2026-09-22 补接线(P0-4):facts 淘汰上限(fact-store.js pruneIfNeeded)。
            field(t('fFactRetention'), h('input', { 'data-dam-slot': 'form', 'data-dam-input': '', type: 'number', min: 10, value: cfg.factRetentionMax === undefined ? 1000 : cfg.factRetentionMax, onChange: function (e) { set('factRetentionMax', Math.max(10, Number(e.target.value) || 1000)) } }), t('fFactRetentionHint')),
            field(t('fNoteCap'), h('input', { 'data-dam-slot': 'form', 'data-dam-input': '', type: 'number', min: 500, value: cfg.noteCapacityChars === undefined ? 24000 : cfg.noteCapacityChars, onChange: function (e) { set('noteCapacityChars', Number(e.target.value) || 24000) } }), t('fNoteCapHint')),
            field(t('fUserCap'), h('input', { 'data-dam-slot': 'form', 'data-dam-input': '', type: 'number', min: 500, value: cfg.userCapacityChars === undefined ? 24000 : cfg.userCapacityChars, onChange: function (e) { set('userCapacityChars', Number(e.target.value) || 24000) } }), t('fUserCapHint')),
    field(t('fConsolidateMin'), h('input', { 'data-dam-slot': 'form', 'data-dam-input': '', type: 'number', min: 80, value: cfg.autoConsolidateMinChars === undefined ? 240 : cfg.autoConsolidateMinChars, onChange: function (e) { set('autoConsolidateMinChars', Number(e.target.value) || 240) } }), t('fConsolidateMinHint')),
            field(t('fAutoConsolidate'), h('input', { type: 'checkbox', checked: cfg.autoConsolidate !== false, onChange: function (e) { set('autoConsolidate', e.target.checked) } }), t('fAutoConsolidateHint')),
            field(t('fConsolidate'), h('input', { 'data-dam-slot': 'form', 'data-dam-input': '', type: 'number', min: 5, value: cfg.autoConsolidateCooldownMinutes === undefined ? 30 : cfg.autoConsolidateCooldownMinutes, onChange: function (e) { set('autoConsolidateCooldownMinutes', Number(e.target.value) || 30) } }), t('fConsolidateHint')),
            field(t('fConsolidateMax'), h('input', { 'data-dam-slot': 'form', 'data-dam-input': '', type: 'number', min: 1, max: 50, value: cfg.autoConsolidateDailyMax === undefined ? 8 : cfg.autoConsolidateDailyMax, onChange: function (e) { set('autoConsolidateDailyMax', Number(e.target.value) || 8) } }), t('fConsolidateMaxHint')),
            field(t('fMemFileIndex'), h('input', { type: 'checkbox', 'data-dam-key': 'memoryFileIndexEnabled', checked: cfg.memoryFileIndexEnabled === true, onChange: function (e) { set('memoryFileIndexEnabled', e.target.checked) } }), t('fMemFileIndexHint')),
            // 2026-09-14 解耦:交接白板与自动接续各自独立成项(旧实现只在白板页有接续按钮,且 enabled 还被
            // handoffEnabled 二次与运算)。两者出厂默认均为 false(功能仍在测试期),这里与白板页读写完全相同的配置键。
          ]),
          section('skills', sectionLabels.skills, [
            h('div', { 'data-dam-slot': 'hint', 'data-dam-hint': '' }, t('secMemoryHubHint')),
            field(t('fMemoryHub'), h('input', { type: 'checkbox', checked: !!cfg.memoryHubEnabled, onChange: function (e) { set('memoryHubEnabled', e.target.checked) } }), t('fMemoryHubHint')),
            field(t('fEpisodicMin'), h('input', { 'data-dam-slot': 'form', 'data-dam-input': '', type: 'number', min: 1, max: 16, value: cfg.episodicMinSegments === undefined ? 2 : cfg.episodicMinSegments, onChange: function (e) { set('episodicMinSegments', Math.max(1, Math.min(16, Number(e.target.value) || 2))) } }), t('fEpisodicMinHint')),
            field(t('fProcSessions'), h('input', { 'data-dam-slot': 'form', 'data-dam-input': '', type: 'number', min: 1, max: 20, value: cfg.procedureMinSessions === undefined ? 3 : cfg.procedureMinSessions, onChange: function (e) { set('procedureMinSessions', Math.max(1, Math.min(20, Number(e.target.value) || 3))) } }), t('fProcSessionsHint')),
            field(t('fProcSuccess'), h('input', { 'data-dam-slot': 'form', 'data-dam-input': '', type: 'number', min: 1, max: 20, value: cfg.procedureMinSuccess === undefined ? 2 : cfg.procedureMinSuccess, onChange: function (e) { set('procedureMinSuccess', Math.max(1, Math.min(20, Number(e.target.value) || 2))) } }), t('fProcSuccessHint')),
            field(t('fProcCorr'), h('input', { 'data-dam-slot': 'form', 'data-dam-input': '', type: 'number', min: 0, max: 1, step: 0.05, value: cfg.procedureCorrectionCap === undefined ? 0.3 : cfg.procedureCorrectionCap, onChange: function (e) { set('procedureCorrectionCap', Math.max(0, Math.min(1, Number(e.target.value) || 0.3))) } }), t('fProcCorrHint')),
            field(t('fProcRisk'), h('input', { type: 'checkbox', checked: cfg.procedureHighRiskApproval !== false, onChange: function (e) { set('procedureHighRiskApproval', e.target.checked) } }), t('fProcRiskHint')),
            // 2026-09-22 补接线(设置页缺口审计 P0-1):procedureInjectEnabled 才是宿主真读的总闸
            //   (procedure-switch.js 先判它);此前设置页只有旧键 ⇒ 用户改了也无效(灰控件)。
            field(t('fProcInject'), h('input', { type: 'checkbox', 'data-dam-key': 'procedureInjectEnabled', checked: cfg.procedureInjectEnabled !== false, onChange: function (e) { set('procedureInjectEnabled', e.target.checked) } }), t('fProcInjectHint')),
            // ★A-1（2026-09-23）：此处原有「机械流程切片」复选框 —— 该功能已整条删除
            //   （用户裁定「机械通路已被我弃用」，memory-hub.js 分支 + index.js getter 同步移除）。
            //   控件一并删掉：留着它会「写盘成功但界面无变化」（读到的键已无消费者）——
            //   正是用户明确列为「功能坏了」的那种表现。
            field(t('fProcLevel'), h('select', { 'data-dam-select': '', value: cfg.procedureActiveLevel || 'checklist', onChange: function (e) { set('procedureActiveLevel', e.target.value) } },
              h('option', { value: 'checklist' }, L('checklist 完整步骤', 'checklist (full steps)')),
              h('option', { value: 'excerpt' }, L('excerpt 摘要', 'excerpt (summary)')),
              h('option', { value: 'hint' }, L('hint 仅提示', 'hint (hint only)'))), t('fProcLevelHint')),
            h('div', { 'data-dam-slot': 'hint', 'data-dam-hint': '', style: { marginTop: '4px' } }, t('memoryHubViewHint')),
          ]),
          section('handoff', sectionLabels.handoff, [
    field(t('fHandoff'), h('input', { type: 'checkbox', 'data-dam-key': 'handoffEnabled', checked: cfg.handoffEnabled !== false, onChange: function (e) { set('handoffEnabled', e.target.checked) } }), t('fHandoffHint')),
            field(t('fAutoContinue'), h('input', { type: 'checkbox', 'data-dam-key': 'autoContinueEnabled', checked: cfg.autoContinueEnabled !== false, onChange: function (e) { set('autoContinueEnabled', e.target.checked) } }), t('fAutoContinueHint')),
            field(t('fHandoffPlan'), h('input', { 'data-dam-slot': 'form', 'data-dam-input': '', type: 'number', min: 200, value: cfg.handoffPlanChars === undefined ? 1200 : cfg.handoffPlanChars, onChange: function (e) { set('handoffPlanChars', Number(e.target.value) || 1200) } }), t('fHandoffPlanHint')),
            // 2026-09-22 补接线(设置页缺口审计 P0-5):criteriaGate 此前只能改文件才能退。
            field(t('fCriteriaGate'), h('input', { type: 'checkbox', 'data-dam-key': 'criteriaGate', checked: cfg.criteriaGate !== false, onChange: function (e) { set('criteriaGate', e.target.checked) } }), t('fCriteriaGateHint')),
            field(t('fHandoffLedger'), h('input', { 'data-dam-slot': 'form', 'data-dam-input': '', type: 'number', min: 100, value: cfg.handoffLedgerChars === undefined ? 800 : cfg.handoffLedgerChars, onChange: function (e) { set('handoffLedgerChars', Number(e.target.value) || 800) } }), t('fHandoffLedgerHint')),
            field(t('fWaterWindow'), h('input', { 'data-dam-slot': 'form', 'data-dam-input': '', type: 'number', min: 0, value: cfg.waterLevelWindowTokens === undefined ? 65536 : cfg.waterLevelWindowTokens, onChange: function (e) { set('waterLevelWindowTokens', Number(e.target.value) || 0) } }), t('fWaterWindowHint')),
            field(t('fWaterThreshold'), h('input', { 'data-dam-slot': 'form', 'data-dam-input': '', type: 'number', min: 0.1, max: 1.5, step: 0.05, value: cfg.waterLevelThreshold === undefined ? 0.75 : cfg.waterLevelThreshold, onChange: function (e) { set('waterLevelThreshold', Number(e.target.value) || 0.75) } }), t('fWaterThresholdHint')),
            field(t('fWaterAdvisory'), h('input', { type: 'checkbox', checked: cfg.waterLevelAdvisory !== false, onChange: function (e) { set('waterLevelAdvisory', e.target.checked) } }), t('fWaterAdvisoryHint')),
            field(t('fWaterAuto'), h('input', { type: 'checkbox', checked: cfg.waterLevelAutoHandoff !== false, onChange: function (e) { set('waterLevelAutoHandoff', e.target.checked) } }), t('fWaterAutoHint')),
            field(L('子代理痕迹回收', 'Subagent trace recycle'), h('input', { type: 'checkbox', checked: cfg.subagentGcEnabled !== false, onChange: function (e) { set('subagentGcEnabled', e.target.checked) } }),
              L('本插件的一次性子代理(自动沉淀 / 时段总结 / 问候 / 蒸馏)每跑一次都会在 ~/.dsh/sessions 留下一个持久化会话;数量上千后会话列表会明显变慢。开启后任务一结束就把这些痕迹移入 ~/.dsh/subagent-gc-backup 备份(可回滚),不影响子代理结果。默认开。', 'Every one-shot subagent this plugin spawns (auto-consolidation, scheduled summary, greeting, distillation) leaves a persisted session under ~/.dsh/sessions; hundreds of them slow the session list down. When on, each trace is moved into ~/.dsh/subagent-gc-backup right after the task ends (reversible), never affecting the subagent result. On by default.')),
            field(L('兜底回收保留天数', 'Fallback recycle keep days'), h('input', { 'data-dam-slot': 'form', 'data-dam-input': '', type: 'number', min: 0, value: cfg.subagentGcKeepDays === undefined ? 3 : cfg.subagentGcKeepDays, onChange: function (e) { set('subagentGcKeepDays', Number(e.target.value) || 0) } }),
              L('每天巡检一次,回收超过该天数仍残留的痕迹(比如任务异常中断没删掉的);0 = 不按时间,只靠任务结束即删。', 'A daily sweep recycles traces older than this many days (e.g. leftovers from interrupted tasks); 0 = rely on the end-of-task recycle only.')),
          ]),
          section('auto', sectionLabels.auto, [
            // 欢迎向导:开关(首启自动播放)+ 立即重看按钮(闭包内直调 openDialog——同一作用域,点击立即弹;
            // 不走 window 全局入口,避免多实例时序导致"点了没反应要刷新")+ 查看更新日志(走 update 弹窗,
            // 带 Logo 开场动画;versions 取 CHANGELOG 最新一条)
            field(t('fWelcomeTour'), h('div', { 'data-dam-slot': 'list', 'data-dam-row': '' },
              h('input', { type: 'checkbox', checked: cfg.welcomeTourEnabled !== false, onChange: function (e) { set('welcomeTourEnabled', e.target.checked) } }),
              h('button', { 'data-dam-slot': 'actions', 'data-dam-btn': '', onClick: function () { try { openManualWelcomeTourPre() } catch (eTour) {} } }, t('tourReplay')),
              h('button', { 'data-dam-slot': 'actions', 'data-dam-btn': '', onClick: function () {
                try {
                  var keys = Object.keys(CHANGELOG)
                  if (!keys.length) return
                  var latest = keys.sort(cmpVersion)[keys.length - 1]
                  openDialog({ kind: 'update', versions: [{ version: latest, items: CHANGELOG[latest] }], currentVersion: latest })
                } catch (eLog) {}
              } }, L('查看更新日志', 'View changelog'))), t('fWelcomeTourHint')),
            field(t('fAutoPopup'), h('input', { type: 'checkbox', checked: cfg.autoPopupEnabled !== false, onChange: function (e) { set('autoPopupEnabled', e.target.checked) } }), t('fAutoPopupHint')),
            field(t('fUnattended'), h('input', { type: 'checkbox', checked: !!cfg.unattendedMode, onChange: function (e) { set('unattendedMode', e.target.checked) } }), t('fUnattendedHint')),
            field(t('fUnattendedAuto'), h('input', { type: 'checkbox', checked: !!cfg.unattendedAuto, onChange: function (e) { set('unattendedAuto', e.target.checked) } }), t('fUnattendedAutoHint')),
            // ★2026-09-30（C2 续）接续/归档/工作台六键（宿主均已读、此前无 UI 入口）：
            //   autoContinueConfirmSeconds / autoContinueCooldownMinutes（接续确认与冷却）、
            //   autoArchiveCheckMin（归档巡检周期）、workbenchLoopShort/Long（工作台轮询节奏）、
            //   workbenchRetryMs（工作台重试间隔）。
            field(t('fAutoContinueConfirm'), h('input', { 'data-dam-slot': 'form', 'data-dam-input': '', type: 'number', min: 5, max: 600, value: cfg.autoContinueConfirmSeconds === undefined ? 35 : cfg.autoContinueConfirmSeconds, onChange: function (e) { set('autoContinueConfirmSeconds', Math.max(5, Number(e.target.value) || 35)) } }), t('fAutoContinueConfirmHint')),
            field(t('fAutoContinueCooldown'), h('input', { 'data-dam-slot': 'form', 'data-dam-input': '', type: 'number', min: 1, max: 1440, value: cfg.autoContinueCooldownMinutes === undefined ? 30 : cfg.autoContinueCooldownMinutes, onChange: function (e) { set('autoContinueCooldownMinutes', Math.max(1, Number(e.target.value) || 30)) } }), t('fAutoContinueCooldownHint')),
            field(t('fArchiveCheckMin'), h('input', { 'data-dam-slot': 'form', 'data-dam-input': '', type: 'number', min: 1, max: 1440, value: cfg.autoArchiveCheckMin === undefined ? 60 : cfg.autoArchiveCheckMin, onChange: function (e) { set('autoArchiveCheckMin', Math.max(1, Number(e.target.value) || 60)) } }), t('fArchiveCheckMinHint')),
            field(t('fWorkbenchLoopShort'), h('input', { 'data-dam-slot': 'form', 'data-dam-input': '', type: 'number', min: 1, max: 240, value: cfg.workbenchLoopShort === undefined ? 10 : cfg.workbenchLoopShort, onChange: function (e) { set('workbenchLoopShort', Math.max(1, Number(e.target.value) || 10)) } }), t('fWorkbenchLoopShortHint')),
            field(t('fWorkbenchLoopLong'), h('input', { 'data-dam-slot': 'form', 'data-dam-input': '', type: 'number', min: 1, max: 720, value: cfg.workbenchLoopLong === undefined ? 24 : cfg.workbenchLoopLong, onChange: function (e) { set('workbenchLoopLong', Math.max(1, Number(e.target.value) || 24)) } }), t('fWorkbenchLoopLongHint')),
            field(t('fWorkbenchRetryMs'), h('input', { 'data-dam-slot': 'form', 'data-dam-input': '', type: 'number', min: 1000, max: 600000, step: 1000, value: cfg.workbenchRetryMs === undefined ? 30000 : cfg.workbenchRetryMs, onChange: function (e) { set('workbenchRetryMs', Math.max(1000, Number(e.target.value) || 30000)) } }), t('fWorkbenchRetryMsHint')),
            // ★E5（2026-09-25 用户口径）：轮换周期 = **天**，默认 2。用系统墙钟切期（不用自建计时器）；
            //   到期后旧工作台整份弃掉、下一期新建 —— 母会话条目数因此有上界。
            //   为什么默认 2 天：旧工作台会话要「先静默才可能被归档」，而静默的前提是不再有子代理挂上去，
            //   也就是必须等本期轮换掉。周期越长，归档/删除链条被拖得越久（轮换 → 静默 → 归档 → 删除）。
            //   ★E3-FIX-3（2026-09-26 二合一）：本项**不再可独立设置**，改为**跟随「归档阈值」**的只读显示。
            //   为什么合并（用户原话「这两个 2 是不是得二合一，不然还会耦合」）：两者本就是同一段生命周期的
            //   两个阶段，各配一个数必然失配——轮换慢于归档 ⇒ 旧工作台永不静默、归档链断裂；快于归档 ⇒ 白建会话。
            //   ⇒ 设置页只剩「归档阈值」一个旋钮，本项恒等于它（相等即最优），不再写回 workbenchPeriodDays。
            field(
              L('工作台轮换周期（天）', 'Workbench rotation period (days)'),
              h('input', { 'data-dam-slot': 'form', 'data-dam-input': '', type: 'number', min: 1, max: 3650, value: (cfg.workbenchPeriodDays === undefined ? 2 : cfg.workbenchPeriodDays), readOnly: true, disabled: true, style: { opacity: 0.6, cursor: 'not-allowed' } }),
              L('**跟随上一项「归档阈值」**，不再单独设置（默认 **2** 天）。★两者本是同一段生命周期的两个阶段：轮换慢了，旧工作台会话永远等不到「静默」，也就永远进不了「归档 → 删除」；轮换快了则白建会话。⇒ 只留一个旋钮，这里恒等于归档阈值。范围 1–3650。', '**Follows "Archive after (days)" above** — no longer set separately (default **2** days). ★The two are phases of one lifecycle: a slower rotation means old workbench sessions never go idle and thus never reach the archive → delete chain; a faster one just creates sessions needlessly. So there is a single knob, and this value always equals the archive threshold. Range 1–3650.')),
            // ★S1（2026-09-24，对齐 WORKBENCH-SPEC）：工作台**工作区路径**可配（用户原话「只不过是在插件设置的工作区里面」）。
            //   变更后下一期在新路径建工作区；旧会话就地保留（守卫⑰：不删）。
            field(
              L('工作台工作区', 'Workbench workspace'),
              h('div', { 'data-dam-slot': 'list', 'data-dam-row': '', style: { flex: 1 } },
                h('input', { 'data-dam-slot': 'form', 'data-dam-input': '', style: { flex: 1 }, placeholder: 'aik_auto_memory_use', value: (cfg.workbenchRoot || ''), onChange: function (e) { set('workbenchRoot', e.target.value) } }),
                h('button', { 'data-dam-slot': 'actions', 'data-dam-btn': '', onClick: function () { openBrowser('workbenchRoot') } }, t('fBrowse'))),
              L('留空 = 自动使用 **DSH 本体目录**下的 aik_auto_memory_use（Windows / macOS / Linux 都能匹配到，与 DSH 自己的数据同根，无需改盘符或家目录）。也可指定别的路径，但必须位于 DSH 本体目录之内。后台的记忆整理任务都在这里跑，不会出现在你的会话列表里。', 'Leave empty to use aik_auto_memory_use inside the **DSH home directory** (works on Windows / macOS / Linux, same root as the data DSH itself owns — no drive or home-path edits needed). You may point it elsewhere as long as it stays inside the DSH home directory. Background memory jobs run there and never show up in your session list.')),
            field(t('fAway'), h('input', { 'data-dam-slot': 'form', 'data-dam-input': '', type: 'number', min: 0, value: (Number(cfg.awayMinutes) === 0 ? 0 : (cfg.awayMinutes || 60)), onChange: function (e) { var v = Number(e.target.value); set('awayMinutes', Number.isFinite(v) && v >= 0 ? v : 60) } }), t('fAwayHint')),
            field(t('fAutoSum'), h('input', { 'data-dam-slot': 'form', 'data-dam-input': '', value: (cfg.autoSummaryTimes || []).join(','), onChange: function (e) { set('autoSummaryTimes', String(e.target.value || '').split(',').map(function (s) { return s.trim() }).filter(Boolean)) } }), t('fAutoSumHint')),
            field(t('fConsSchedule'), h('input', { type: 'checkbox', checked: cfg.consolidateScheduleEnabled !== false, onChange: function (e) { set('consolidateScheduleEnabled', e.target.checked) } }), t('fConsScheduleHint')),
            field(t('fConsScheduleTime'), h('input', { 'data-dam-slot': 'form', 'data-dam-input': '', placeholder: '09:30', value: cfg.consolidateScheduleTime === undefined ? '09:30' : cfg.consolidateScheduleTime, onChange: function (e) { set('consolidateScheduleTime', String(e.target.value || '').trim()) } }), t('fConsScheduleTimeHint')),
            field(t('fConsScheduleDays'), h('input', { 'data-dam-slot': 'form', 'data-dam-input': '', type: 'number', min: 1, max: 60, value: cfg.consolidateScheduleDays === undefined ? 7 : cfg.consolidateScheduleDays, onChange: function (e) { set('consolidateScheduleDays', Number(e.target.value) || 7) } }), t('fConsScheduleDaysHint')),
            field(t('fMaintSchedule'), h('input', { type: 'checkbox', checked: cfg.maintainScheduleEnabled !== false, onChange: function (e) { set('maintainScheduleEnabled', e.target.checked) } }), t('fMaintScheduleHint')),
            field(t('fMaintScheduleTime'), h('input', { 'data-dam-slot': 'form', 'data-dam-input': '', placeholder: '10:00', value: cfg.maintainScheduleTime === undefined ? '10:00' : cfg.maintainScheduleTime, onChange: function (e) { set('maintainScheduleTime', String(e.target.value || '').trim()) } }), t('fMaintScheduleTimeHint')),
            // ★F3（2026-09-25 用户拍板）：归档 / 删除**自持**开关与天数。
            //   用户原话「这个归档和删除需要走我自己的插件里的设置页面」「客户的机器不一定装了这个插件」
            //   ⇒ 控件落本插件设置页，不依赖 @linxin666/dsh-session-archive。
            //   生命周期 = 子代理跑完**保留** → N 天自动归档 → 归档后 M 天自动删除。
            //   ★保护面（守卫 ⑰）：工作台会话、运行中会话、归档时间未知的历史归档**永不自动删除**。
            //   纯追加：不改任何既有 field / 不加分区 key / 不动分区顺序（smoke-test-s2-settings-panels.mjs:102 锁）。
            field(
              L('会话归档与删除（自持）', 'Session archive & delete (self-held)'),
              h('input', { type: 'checkbox', checked: cfg.sessionArchiveEnabled !== false, onChange: function (e) { set('sessionArchiveEnabled', e.target.checked) } }),
              L('总开关。开启后本插件自己按下面的天数归档并清理会话，**不依赖任何外部会话管理插件**；关掉则两条策略都不跑。', 'Master switch. When on, this plugin itself archives and cleans sessions by the day counts below — no external session-manager plugin required. Off disables both policies.'),
            ),
            field(
              L('自动归档', 'Auto-archive'),
              h('input', { type: 'checkbox', checked: cfg.autoArchiveEnabled !== false, onChange: function (e) { set('autoArchiveEnabled', e.target.checked) } }),
              L('子代理跑完后先**保留**；超过右边的天数未再活动即自动归档（归档 = 移出默认视野、可恢复，不是删除）。', 'Finished subagent sessions are kept first; once idle longer than the days on the right they are archived (hidden from the default view, reversible — not deleted).'),
            ),
            field(
              L('归档阈值（天）', 'Archive after (days)'),
              h('input', { 'data-dam-slot': 'form', 'data-dam-input': '', type: 'number', min: 1, max: 3650, value: cfg.autoArchiveDays === undefined ? 2 : cfg.autoArchiveDays, onChange: function (e) { var v = Number(e.target.value); set('autoArchiveDays', Number.isFinite(v) && v >= 1 && v <= 3650 ? Math.round(v) : 2) } }),
              L('默认 **2** 天（用户口径）。范围 1–3650。', 'Default **2** days. Range 1–3650.'),
            ),
            field(
              L('自动删除', 'Auto-delete'),
              h('input', { type: 'checkbox', checked: cfg.autoDeleteEnabled !== false, onChange: function (e) { set('autoDeleteEnabled', e.target.checked) } }),
              L('归档后超过右边天数才**物理删除**（不可恢复）。★只删「由本插件归档且记录了归档时刻」的会话；启用本功能之前的历史归档**永不**自动删除。', 'Deletes a session for good once it has been archived longer than the days on the right. Only sessions archived by this plugin (with a recorded archive time) qualify; archives from before this feature are never auto-deleted.'),
            ),
            field(
              L('归档后保留（天）', 'Delete after archiving (days)'),
              h('input', { 'data-dam-slot': 'form', 'data-dam-input': '', type: 'number', min: 1, max: 3650, value: cfg.autoDeleteDays === undefined ? 7 : cfg.autoDeleteDays, onChange: function (e) { var v = Number(e.target.value); set('autoDeleteDays', Number.isFinite(v) && v >= 1 && v <= 3650 ? Math.round(v) : 7) } }),
              L('默认 **7** 天（用户口径）。范围 1–3650。工作台会话与运行中的会话始终受保护。', 'Default **7** days. Range 1–3650. Workbench and running sessions are always protected.'),
            ),
          ]),
          section('store', sectionLabels.store, [
    field(t('fUserDir'), h('input', { 'data-dam-slot': 'form', 'data-dam-input': '', value: cfg.userMemoryDir, onChange: function (e) { set('userMemoryDir', e.target.value) } }), t('fUserDirHint')),
            field(t('fProjectDir'), h('input', { 'data-dam-slot': 'form', 'data-dam-input': '', value: cfg.projectMemoryDir, onChange: function (e) { set('projectMemoryDir', e.target.value) } }), t('fProjectDirHint')),
            field(t('fMemoryRoot'), h('div', { 'data-dam-slot': 'list', 'data-dam-row': '', style: { flex: 1 } },
              h('input', { 'data-dam-slot': 'form', 'data-dam-input': '', style: { flex: 1 }, value: cfg.memoryRoot || '', onChange: function (e) { set('memoryRoot', e.target.value) } }),
              h('button', { 'data-dam-slot': 'actions', 'data-dam-btn': '', onClick: function () { openBrowser() } }, t('fBrowse'))), t('fMemoryRootHint')),
            browseOpen ? h('div', { style: { border: '1px solid color-mix(in srgb, var(--dsw-alias-border-l1, rgba(128,128,128,.25)) 60%, transparent)', borderRadius: '8px', padding: '8px', marginBottom: '8px', background: 'color-mix(in srgb, var(--dsw-alias-bg-layer-1, rgba(128,128,128,.06)) 40%, transparent)' } },
              h('div', { 'data-dam-slot': 'list', 'data-dam-row': '' },
                h('b', { style: { fontSize: 'calc(12px * var(--dam-scale))', wordBreak: 'break-all', flex: 1 } }, browsePath || '…'),
                h('button', { 'data-dam-slot': 'actions', 'data-dam-btn': '', onClick: function () { browseTo(browseParent) }, disabled: browseParent === browsePath }, t('fUp'))),
              h('div', { style: { maxHeight: '160px', overflow: 'auto', marginTop: '4px' } },
                (browseDirs || []).map(function (d) {
                  return h('button', { key: d.path, 'data-dam-slot': 'actions', 'data-dam-btn': '', style: { display: 'block', width: '100%', textAlign: 'left', padding: '3px 6px' }, onClick: function () { browseTo(d.path) } }, '📁 ' + d.name)
                }).concat(browseDirs && !browseDirs.length ? [h('div', { key: 'e', 'data-dam-slot': 'hint', 'data-dam-hint': '' }, t('empty'))] : [])),
              h('div', { 'data-dam-slot': 'list', 'data-dam-row': '', style: { marginTop: '6px' } },
                // ★S1 解耦：内嵌浏览器的「选择」按 browseKey 回填（哪一行开的就写哪一行）
                h('button', { 'data-dam-slot': 'actions', 'data-dam-btn': '', onClick: function () { set(browseKey || 'memoryRoot', browsePath); setBrowseOpen(false) } }, t('fSelectDir')),
                h('button', { 'data-dam-slot': 'actions', 'data-dam-btn': '', onClick: function () { setBrowseOpen(false) } }, t('close'))))
              : null,
            field(t('fDayBoundary'), h('input', { 'data-dam-slot': 'form', 'data-dam-input': '', type: 'number', min: 0, max: 1439, value: (cfg.dayBoundaryMinutes === undefined ? 450 : cfg.dayBoundaryMinutes), onChange: function (e) { set('dayBoundaryMinutes', parseInt(e.target.value || '0', 10)) } }), t('fDayBoundaryHint')),
            field(t('fReflect'), h('input', { type: 'checkbox', checked: !!cfg.reflectEnabled, onChange: function (e) { set('reflectEnabled', e.target.checked) } }), t('fReflectHint')),
            field(t('fStyle'), h('select', { 'data-dam-select': '', value: cfg.reflectStyle, onChange: function (e) { set('reflectStyle', e.target.value) } },
              STYLE_IDS.map(function (id) { return h('option', { key: id, value: id }, t('style' + id.charAt(0).toUpperCase() + id.slice(1))) })), t('fStyleHint')),
            // 2026-09-22 补接线(设置页缺口审计 P1/P2):扫描上限与索引快照前端零命中。
            field(t('fWsDiscover'), h('input', { 'data-dam-slot': 'form', 'data-dam-input': '', type: 'number', min: 5, max: 2000, value: cfg.workspaceDiscoverMax === undefined ? 200 : cfg.workspaceDiscoverMax, onChange: function (e) { set('workspaceDiscoverMax', Math.max(5, Math.min(2000, Number(e.target.value) || 200))) } }), t('fWsDiscoverHint')),
          ]),
          section('look', sectionLabels.look, [
            h('div', { 'data-dam-slot': 'hint', 'data-dam-hint': '' }, t('settingsHeader')),
            field(t('fLocale'), h('select', { 'data-dam-select': '', value: cfg.locale || 'system', onChange: function (e) { set('locale', e.target.value) } },
              LOCALE_IDS_LIST.map(function (id) { return h('option', { key: id, value: id }, id === 'system' ? t('followSystem') : t(id)) })), t('fLocaleHint')),
            field(t('fFontSize'), h('select', { 'data-dam-select': '', value: fontScale, onChange: function (e) { fontScale = e.target.value; try { localStorage.setItem('dsh-auto-memory.fontScale.v2', fontScale) } catch (ee) {}; try { var pp = document.querySelector('[data-dam-panel]'); if (pp) pp.style.setProperty('--dam-scale', FONT_SCALE_VALUES[fontScale] || '1') } catch (ee2) {}; emit() } },
              Object.keys(FONT_SCALES).map(function (k) { return h('option', { key: k, value: k }, t('fs' + k.charAt(0).toUpperCase() + k.slice(1))) })), t('fFontSizeHint')),
            // 面板位置(2026-09-21):左下角 / 顶部 / 两者共存。改动立即生效并同步两处形态(用户硬规则:即时回显)。
            field(t('fPanelPos'), h('select', { 'data-dam-select': '', value: controller.panelPos(), onChange: function (e) { controller.setPanelPos(e.target.value) } },
              h('option', { value: 'bottom-left' }, t('posBottomLeft')), h('option', { value: 'page' }, t('posPage')), h('option', { value: 'both' }, t('posBoth'))), t('fPanelPosHint')),
            field(L('强调色', 'Accent color'), h('select', { 'data-dam-select': '', value: accentTheme, onChange: function (e) { setAccent(e.target.value) } },
              h('option', { value: 'deepseek' }, L('DeepSeek 蓝', 'DeepSeek blue')), h('option', { value: 'graphite' }, L('石墨灰', 'Graphite')), h('option', { value: 'violet' }, L('雾紫', 'Violet'))), L('默认使用 DeepSeek 蓝；日历与状态颜色保持语义色。', 'DeepSeek blue by default; calendar and status colors stay semantic.')),
            field(L('关系图密度', 'Graph density'), h('select', { 'data-dam-select': '', value: graphDensity, onChange: function (e) { setDensity(e.target.value) } },
              h('option', { value: 'relaxed' }, L('舒展', 'Relaxed')), h('option', { value: 'compact' }, L('紧凑', 'Compact'))), L('影响工作区关系图的节点间距和显示数量。', 'Controls node spacing and detail in the workspace graph.')),
            // 群反馈第 4 条:排除来源(每行一条)。textarea 便于粘贴多行路径;
            // 空行/纯空白在写回时被过滤,避免"看起来配了其实没配"。
            field(t('fExclude'), h('textarea', {
              'data-dam-slot': 'form', 'data-dam-input': '', rows: 3,
              style: { width: '100%', resize: 'vertical', fontFamily: 'inherit' },
              value: (Array.isArray(cfg.injectExcludeSources) ? cfg.injectExcludeSources : []).join('\n'),
              placeholder: 'mem_0123456789abcdef0123456789abcdef\nD:\\ws\\.dsh-memory\\archive\\\nlog',
              onChange: function (e) {
                var lines = String(e.target.value || '').split('\n').map(function (x) { return x.trim() }).filter(Boolean)
                set('injectExcludeSources', lines)
              },
            }), t('fExcludeHint')),
            field(L('子代理模型 / 思考强度', 'Subagent model & reasoning effort'), h('div', { 'data-dam-slot': 'list', 'data-dam-row': '', style: { flex: 1 } },
              h('span', { style: { flex: 1, fontSize: 'calc(12px * var(--dam-scale))', wordBreak: 'break-all', opacity: cfg.subagentModel ? 1 : 0.6 } }, (cfg.subagentModel || (L('跟随路由默认', 'routing default'))) + (String(cfg.subagentReasoningEffort || '') ? ' · ' + String(cfg.subagentReasoningEffort) : '')),
              h('button', { 'data-dam-slot': 'actions', 'data-dam-btn': '', onClick: openModels }, L('选择模型 / 强度', 'Pick model / effort'))),
              L('★作用域=「记忆中枢」工作区(aik_auto_memory_use)下所有会话的默认模型与思考强度;后台子代理(问候/总结/沉淀/蒸馏)挂在该工作区下运行,因此也跟随这里。思考强度 off/low/high/max 只作用于本插件的子代理,不改你的主对话。留空=跟随宿主部署默认(agent-default-model)。保存后生效。', 'Scope: the DEFAULT model & reasoning effort for every session in the "Memory Hub" workspace (aik_auto_memory_use). Background subagents (greeting / summary / consolidation / distillation) run under that workspace, so they follow this too. Effort (off/low/high/max) applies only to this plugin`s subagents, never your main conversation. Empty = follow the deployment default (agent-default-model). Applies after saving.')),
            mdlOpen ? buildModelDrawer() : null,
          ]),
          section('team', sectionLabels.team, [
            renderTeamSettings({ cfg: cfg, set: set, field: field }),
          ]),
          section('skin', sectionLabels.skin, [
            // ★2026-09-28（用户第 1 大点）：本分区升格为「皮肤选择（皮肤中心）」——选择器置顶。
            h(SkinPicker, { onSwitch: function () { try { setNonce(function (n) { return n + 1 }) } catch (ePick) {} } }),
            h('div', { 'data-dam-slot': 'hint', 'data-dam-hint': '', style: { fontSize: 'calc(11.5px * var(--dam-scale))', opacity: .72, margin: '10px 0 4px' } },
              L('素材槽位（换图子功能，与皮肤选择正交）', 'Asset slots (image swapping; orthogonal to skin choice)')),
            // ★S2 皮肤(2026-09-27):6 槽位**真实渲染为 <img>**,取图走宿主只读路由
            // /api/dsh-auto-memory/skin-asset?key=<槽位>(loopback-only + 白名单)。
            h('div', { 'data-dam-slot': 'hint', 'data-dam-hint': '', style: { fontSize: 'calc(11.5px * var(--dam-scale))', opacity: .72, marginBottom: '6px' } },
              L('下面 6 张图来自插件的 lib/assets/skin/。换图只需改 lib/skin-assets.js 里对应槽位的 file 一行，本页与所有结构代码零改动。图未就绪时显示确定性占位（不塌、不留白）。', 'These six images come from the plugin lib/assets/skin/. To swap one, edit the file field for that slot in lib/skin-assets.js — no other code changes. Unready slots show a deterministic placeholder.')),
            h(SkinCenterPanel, null),
            h(SkinSlotRows, null),
            h(SkinSection, null),
          ]),
          section('about', sectionLabels.about, [
            // WB-GRAPH 白板线一键切换(2026-09-16, board_mode_pre_v1): 旧版白板(默认) / 新版看板(dsh-graph vendor
            // + sidecar + 遍历工具, 工具数 14→16)。开关解耦: 只管白板线; 切换需重启 dsh web 生效(工具注册在启动期)。
            field(L('白板模式（旧版白板 / 新版看板）', 'Board mode (legacy / graph)'), (function () {
              var cur = cfg.boardMode === 'graph' ? 'graph' : 'legacy'
              // ★2026-09-16 修 BUG-3(设置页切换不落盘): 旧实现 `set('boardMode', m)` 只改**本地 React 态**
              // 然后 reload —— 配置从未写到服务端, 刷新后仍是旧值(界面回跳原档), 用户会判定"开关坏了"。
              // 正解: 走与接续面板同一个写入路径 `saveConfigPatch(API.config, patch)`(见 :999 定义),
              // 写盘成功后再 reload; 失败则在界面提示, 不静默假装成功。
              // 同时满足用户硬性偏好: 开关类改动必须**即时回显**(写盘后立即 reload 呈现新档)。
              function pick(m) {
                set('boardMode', m) // 先本地回显(即时反馈)
                saveConfigPatch({ boardMode: m }, {
                  onSaved: function () { window.setTimeout(function () { window.location.reload() }, 350) },
                  onError: function (e) { setErr(String((e && e.message) || e || 'save failed')) },
                })
              }
              return h('div', { 'data-dam-slot': 'list', 'data-dam-row': '' },
                h('button', { 'data-dam-slot': 'actions', 'data-dam-btn': '', 'data-dam-key': 'boardMode', style: { fontWeight: cur === 'legacy' ? 700 : 400, opacity: cur === 'legacy' ? 1 : 0.65 }, onClick: function () { if (cur !== 'legacy') pick('legacy') } }, L('旧版白板', 'Legacy board')),
                h('button', { 'data-dam-slot': 'actions', 'data-dam-btn': '', 'data-dam-key': 'boardModeGraph', style: { marginLeft: '6px', fontWeight: cur === 'graph' ? 700 : 400, opacity: cur === 'graph' ? 1 : 0.65 }, onClick: function () { if (cur !== 'graph') pick('graph') } }, L('新版看板（dsh-graph）', 'Graph board (dsh-graph)')))
            })(),
              L('一键切换白板形态。默认「旧版白板」=一切行为不变；切到「新版看板」后启用 dsh-graph 看板、白板结构化索引（handoff/index.json）与两个遍历工具（memory_expand / memory_trace，工具数 14→16）。切换后需重启 dsh web 生效；再点回旧版即完全回滚。', 'One-click switch for the board form. Default "Legacy board" keeps everything unchanged; "Graph board" enables the dsh-graph kanban, the structured handoff index (handoff/index.json) and two traversal tools (memory_expand / memory_trace, tool count 14→16). Restart dsh web after switching; switch back to fully roll back.')),
    field(t('fVersion'), h('div', { 'data-dam-slot': 'list', 'data-dam-row': '' },
              h('span', { style: { flex: 1 } }, verInfo ? (verInfo.current || '?') + (verInfo.latest ? ' → ' + verInfo.latest + (verInfo.upToDate ? ' ' + t('upToDate') : ' ' + t('hasUpdate')) : '') : (checkingUpdate ? t('checking') : '—')),
              h('button', { 'data-dam-slot': 'actions', 'data-dam-btn': '', onClick: checkUpdate, disabled: checkingUpdate }, checkingUpdate ? t('checking') : t('checkUpdate')),
              (verInfo && verInfo.latest && !verInfo.upToDate && verInfo.installKind === 'registry') ? h('button', { 'data-dam-slot': 'actions', 'data-dam-btn': '', onClick: doUpdate, disabled: upBusy, style: { marginLeft: '4px' } }, upBusy ? t('updating') : t('updateNow')) : null,
              // ★v3.1.2：dev-link（开发树挂载）无法「一键更新」，但也必须让用户看见线上是否有新版 ——
              //   此前此处恒为 null，用户既看不到按钮也看不到「有新版」，反馈「按钮消失且不知道为什么」。
              (verInfo && verInfo.installKind === 'dev-link' && verInfo.latest && verInfo.devVersion && verInfo.latest !== verInfo.devVersion)
                ? h('span', { 'data-dam-slot': 'hint', 'data-dam-hint': '', style: { marginLeft: '6px' } }, (L('开发树 v', 'dev tree v')) + verInfo.devVersion + ' → ' + (L('线上 v', 'registry v')) + verInfo.latest + (L('，请同步开发源码后重新构建', ' — sync source and rebuild')))
                : null,
              upMsg ? h('span', { 'data-dam-slot': 'hint', 'data-dam-hint': '' }, upMsg) : null),
              t('versionCmdHint') + (verInfo && verInfo.error ? ' ' + t('versionError') + verInfo.error : '') + (verInfo && verInfo.installKind === 'dev-link' ? ' ' + t('devLinkHint') : '') + (verInfo && !verInfo.installKind ? ' ' + t('noProfileHint') : '')),
            field(L('交流群', 'Community'), h('div', { 'data-dam-slot': 'list', 'data-dam-row': '' },
              h('span', { style: { flex: 1 } }, L('反馈问题、交流使用技巧——加群响应比 issue 更快。', 'Share feedback and tips with other users — the group responds faster than GitHub issues.')),
              h('a', { href: 'https://qm.qq.com/q/v7Asxn6vPa', target: '_blank', rel: 'noreferrer', style: { textDecoration: 'none', color: 'var(--dam-accent, #4f7cff)' } }, L('点击加入 QQ 交流群', 'Join the QQ community group'))),
              L('点击链接一键加群。', 'One-click join via the QQ invite link.')),
          ]),
          h('div', { 'data-dam-savebar': '', role: 'status' },
            h('button', { onClick: i5Cancel, disabled: busy || !dirty }, L('取消修改', 'Discard changes')),
            h('button', { 'data-dam-slot': 'actions', 'data-dam-btn': '', 'data-dirty': dirty ? 'true' : undefined, onClick: save, disabled: busy || !dirty }, busy ? t('saving') : (dirty ? (L('保存更改', 'Save changes')) : t('saveSettings'))),
            dirty ? h('span', { 'data-dam-slot': 'hint', 'data-dam-hint': '' }, String(new Set(Object.keys(i5Groups.current).map(function (k) { return i5Groups.current[k] })).size) + L(' 个分区有未保存修改', ' sections with unsaved changes')) : null,
            msg ? h('span', { 'data-dam-slot': 'hint', 'data-dam-hint': '' }, msg) : null),
          // 调试中心(折叠):模块状态一览,方便排查问题/提 issue
          h('div', { style: { marginTop: '14px', borderTop: '1px solid color-mix(in srgb, var(--dsw-alias-border-l1, rgba(128,128,128,.2)) 55%, transparent)', paddingTop: '10px' } },
            h('button', { 'data-dam-slot': 'actions', 'data-dam-btn': '', onClick: function () { setDbgOpen(!dbgOpen) } }, (dbgOpen ? '▴ ' : '▾ ') + t('debugCenter')),
            dbgOpen ? h('div', { style: { marginTop: '8px' } }, h(DebugCenter)) : null),
          err ? h('div', { 'data-dam-error': '' }, err) : null))
      }