    /** ===== 欢迎引导(屏2,2026-09-27 精修轮·概念图02) =====
     *  四页 stepper + 英雄横幅 + 核心能力真开关网格。内容源 = TOUR_STEPS 单一暴露
     *  (window['dsh-auto-memory.TOUR_STEPS']);开关全部映射真实配置键,写盘走 saveConfigPatch
     *  唯一出口、读盘经 configOf 解包——与经典向导/设置页双向同源。
     *  ★这不是首启自动弹窗:首启自动弹出的向导原样保留,这里只是把向导内容内嵌成模块。 */
    function DamSkinV4Welcome(props) {
      var onNav = (props && props.onNav) || function () {}
      var zh = locale === 'zh'
      var cfgPair = useState(null)
      var semPair = useState(null)
      var pgPair = useState(0)
      var errPair = useState('')
      var cfg = cfgPair[0]
      useEffect(function () {
        var alive = true
        apiGet(API.config).then(function (d) { if (alive) cfgPair[1](configOf(d)) }).catch(function () { if (alive) cfgPair[1]({}) })
        try { refreshSem(function (j) { if (alive && j) semPair[1](j) }) } catch (eSem) {}
        return function () { alive = false }
      }, [])
      var pg = pgPair[0]
      var setPg = pgPair[1]
      var boolOf = function (key, def) { if (!cfg) return false; var v = cfg[key]; return v === undefined ? !!def : !!v }
      var flip = function (patch) {
        errPair[1]('')
        cfgPair[1](Object.assign({}, cfg, patch))
        saveConfigPatch(patch, { onError: function (e) { errPair[1](String((e && e.message) || e || 'save failed')) } })
      }
      var flipKey = function (key, def) { var p = {}; p[key] = !boolOf(key, def); flip(p) }
      var flipMode = function (on) {
        var nx = on ? 'shadow' : 'canary-explicit'
        errPair[1]('')
        semPair[1](Object.assign({}, semPair[0], { activationEmitMode: nx }))
        apiPost(API.semanticEmit, { mode: nx }).catch(function (e) { errPair[1](String((e && e.message) || e || 'save failed')) })
      }
      var switchBtn = function (on, onClick, label) {
        return h('button', { 'data-dam-skin-v4-switch': '', 'data-on': on ? '1' : '0', 'aria-pressed': on ? 'true' : 'false', 'aria-label': label || '', disabled: !cfg, title: zh ? '点击即时保存(与经典档同一配置键)' : 'Saves instantly (same config key as classic)', onClick: onClick }, h('i', { 'aria-hidden': 'true' }))
      }
      // 核心能力六卡(概念图02):每张 = 真开关 + 真描述;键与经典向导/设置页完全同源(def 与经典档 checked 语义一致)。
      var caps = [
        { g: '🧠', tone: 'var(--skin-brand)', key: 'associativeMemoryEnabled', def: false, n: zh ? '主动唤回' : 'Active recall', d: zh ? '按相关性自动联想记忆并注入对话——档位在后续步骤里换(只记录/显式/全量)。' : 'Associate and inject memories by relevance — switch tiers in the steps below.' },
        { g: '📚', tone: 'var(--skin-info)', key: 'injectEnabled', def: false, n: zh ? '周期记忆快照' : 'Periodic snapshot', d: zh ? '定期/压缩后把记忆摘要重新注入,模型始终带着记忆背景工作。' : 'Re-inject the memory digest periodically and after compaction.' },
        { g: '📥', tone: 'var(--skin-ok)', key: 'autoConsolidate', def: true, n: zh ? '自动沉淀' : 'Auto-settle', d: zh ? '每轮对话结束把结论沉淀进每日日志与记忆店(推荐开)。' : 'Settle conclusions into the daily log and stores each turn (recommended).' },
        { g: '⚡', tone: 'var(--skin-warn)', key: 'memoryHubEnabled', def: false, n: zh ? '技能固化' : 'Skill hub', d: zh ? '把重复流程沉淀成可复用的技能,跨会话唤起。' : 'Crystallize repeated flows into reusable skills across sessions.' },
        { g: '⏰', tone: 'var(--skin-team)', key: 'consolidateScheduleEnabled', def: true, n: zh ? '定时沉淀' : 'Scheduled settle', d: zh ? '到点自动整理本时段工作(时间在设置页可调)。' : 'Consolidate the period on schedule (time adjustable in settings).' },
        { g: '🤝', tone: 'var(--skin-brand)', key: 'handoffEnabled', def: true, n: zh ? '交接账本' : 'Handoff', d: zh ? '长会话接续:白板 + 账本 + 水位感知,换会话不丢线索。' : 'Long-session handoff: whiteboard + ledger + water level, no lost threads.' },
      ]
      var steps = (typeof window !== 'undefined' && window['dsh-auto-memory.TOUR_STEPS']) || []
      var groups = [[0, 2], [2, 3], [5, 3], [8, 99]]
      var pageSteps = []
      if (steps.length) {
        var gr = groups[Math.min(pg, groups.length - 1)]
        pageSteps = steps.slice(gr[0], gr[0] + gr[1])
      }
      var stepCard = function (stp, idx) {
        var kids = [
          h('span', { 'data-dam-skin-v4-kicker': '' }, stp.kicker || (zh ? '向导' : 'TOUR')),
          h('h2', null, stp.title || ''),
          h('p', null, stp.text || ''),
        ]
        if (stp.externalScan || stp.dl) kids.push(h('p', { 'data-dam-skin-v4-note': '' }, zh ? '此步的扫描/下载交互在经典向导(首启自动弹)与设置页中,此处不重复实现。' : 'Scan/download UIs live in the classic first-run wizard and settings — not duplicated here.'))
        if (stp.toggles && stp.toggles.length) {
          kids.push(h('div', null, stp.toggles.map(function (tg) {
            var on
            if (tg.mode) { var m = (semPair[0] && semPair[0].activationEmitMode) || 'shadow'; on = m === 'canary-explicit' || m === 'active' }
            else if (tg.boolOn || (cfg && Array.isArray(cfg[tg.key]))) on = !!(cfg && cfg[tg.key] && cfg[tg.key].length)
            else on = boolOf(tg.key, tg.def)
            return h('div', { key: tg.key, 'data-dam-skin-v4-tglrow': '' }, [
              h('div', null, [h('b', null, tg.name || tg.key), h('p', null, tg.sub || '')]),
              switchBtn(on, function () {
                if (tg.mode) flipMode(on)
                else if (tg.boolOn || (cfg && Array.isArray(cfg[tg.key]))) flip((function () { var p2 = {}; p2[tg.key] = on ? (tg.boolOff || []) : (tg.boolOn || []); return p2 })())
                else flipKey(tg.key, tg.def)
              }, tg.name || tg.key),
            ])
          })))
        }
        return h('section', { key: idx, 'data-dam-skin-v4-step': '' }, kids)
      }
      var stepLabels = zh ? ['了解能力', '基础配置', '个性化设置', '完成'] : ['Basics', 'Setup', 'Personalize', 'Done']
      var stepKids = []
      for (var i = 0; i < 4; i++) {
        if (i) stepKids.push(h('span', { key: 'ln' + i, 'data-dam-skin-v4-stepline': '', 'aria-hidden': 'true' }))
        stepKids.push(h('button', { key: i, 'data-dam-skin-v4-stepdot': '', 'data-on': i === pg ? '1' : '0', onClick: (function (ii) { return function () { setPg(ii) } })(i) }, [h('i', { 'aria-hidden': 'true' }, String(i + 1)), stepLabels[i]]))
      }
      var kids = [h('div', { 'data-dam-skin-v4-steps': '' }, stepKids)]
      if (pg === 0) {
        kids.push(h('div', { 'data-dam-skin-v4-banner': '' }, [
          h('div', null, [
            h('b', null, zh ? '你好!👋 欢迎使用 dsh-auto-memory' : 'Hi there! 👋 Welcome to dsh-auto-memory'),
            h('small', null, zh ? '像一个可靠的伙伴:帮你记录、整理、唤回重要的知识与经验。' : 'A reliable companion: record, organize and recall what matters.'),
            h('div', { 'data-dam-skin-v4-chips': '' }, (zh ? ['记住重要的事', '唤回需要的时刻', '让经验持续增值'] : ['Remember what matters', 'Recall when needed', 'Grow with experience']).map(function (t) { return h('span', { key: t, 'data-dam-skin-v4-chip2': '' }, t) })),
          ]),
        ]))
        kids.push(h(SkinHero, { deep: false }))
        kids.push(h('div', { 'data-dam-skin-v4-card': '' }, [
          h('h2', null, zh ? '核心能力' : 'Core capabilities'),
          h('p', null, zh ? '开启你需要的能力——开关当场翻面、即时保存;后续可在「设置」随时调整。' : 'Flip what you need — every switch saves instantly; adjust anytime in Settings.'),
          h('div', { 'data-dam-skin-v4-caps': '' }, caps.map(function (c) {
            var on = boolOf(c.key, c.def)
            return h('div', { key: c.key, 'data-dam-skin-v4-cap': '' }, [
              h('div', { 'data-dam-skin-v4-caphd': '' }, [
                h('i', { 'data-dam-skin-v4-capg': '', 'aria-hidden': 'true', style: { background: 'color-mix(in srgb, ' + c.tone + ' 14%, transparent)' } }, c.g),
                h('b', null, c.n),
                switchBtn(on, function () { flipKey(c.key, c.def) }, c.n),
              ]),
              h('p', null, c.d),
            ])
          })),
        ]))
      }
      for (var si = 0; si < pageSteps.length; si++) kids.push(stepCard(pageSteps[si], si))
      if (pg === 3) {
        kids.push(h('div', { 'data-dam-skin-v4-card': '' }, [
          h('h2', null, zh ? '一切就绪' : 'All set'),
          h('p', null, zh ? '你刚才的选择都已即时保存。改主意了?核心能力在「设置」页随时可调;这里是几个常用入口:' : 'Every choice above was saved instantly. Core switches live in Settings; here are quick entries:'),
          h('div', { 'data-dam-skin-v4-quick': '' }, [
            h('button', { 'data-dam-skin-v4-quickbtn': '', onClick: function () { onNav('library') } }, zh ? '打开记忆库' : 'Library'),
            h('button', { 'data-dam-skin-v4-quickbtn': '', onClick: function () { onNav('timeline') } }, zh ? '打开时间线' : 'Timeline'),
            h('button', { 'data-dam-skin-v4-quickbtn': '', onClick: function () { onNav('settings') } }, zh ? '打开设置' : 'Settings'),
          ]),
        ]))
      }
      kids.push(h('div', { 'data-dam-skin-v4-wfoot': '' }, [
        h('button', { 'data-dam-skin-v4-wskip': '', onClick: function () { onNav('home') } }, zh ? '跳过引导' : 'Skip'),
        h('em', { 'data-dam-skin-v4-wcount': '' }, (pg + 1) + ' / 4'),
        h('button', { 'data-dam-skin-v4-wnext': '', onClick: function () { if (pg < 3) setPg(pg + 1); else onNav('home') } }, pg < 3 ? (zh ? '下一步' : 'Next') : (zh ? '开始使用' : 'Get started')),
      ]))
      if (errPair[0]) kids.push(h('div', { 'data-dam-skin-v4-err': '' }, errPair[0]))
      return h('div', null, kids)
    }
    /** ===== 设置(屏10,2026-09-27 精修轮·概念图10) =====
     *  可视化卡片分组,控件**全部映射真实配置键**——读经 configOf 解包、写走 saveConfigPatch
     *  唯一出口,与经典设置页同读写同一份配置文件(双向同步,改动即时生效,⟳ 可重读)。
     *  概念图中后端无对应物的控件不造假:存储环形图(无字节量接口)→真实数据规模卡;
     *  日历提醒→真实的定时沉淀/定时维护;高级项(prompt 分层/模型选择器/团队/皮肤/版本)诚实指回经典档。
     *  唤回方式不经 config 写盘(与经典档 :9529 同路径,只走 semanticEmit 端点)。 */
    function DamSkinV4Settings() {
      var zh = locale === 'zh'
      var cfgPair = useState(null)
      var semPair = useState(null)
      var stPair = useState(null)
      var wsPair = useState(null)
      var errPair = useState('')
      var cfg = cfgPair[0]
      var aliveRef = { v: true }
      var fetchAll = function (isAlive) {
        apiGet(API.config).then(function (d) { if ((!isAlive || isAlive())) cfgPair[1](configOf(d)) }).catch(function () { if ((!isAlive || isAlive())) cfgPair[1]({}) })
        try { refreshSem(function (j) { if ((!isAlive || isAlive()) && j) semPair[1](j) }) } catch (eS) {}
        apiGet(API.state, { ws: currentWs() }).then(function (s) { if ((!isAlive || isAlive()) && s) stPair[1](s) }).catch(function () {})
        apiPost(API.workspaces, { force: false }).then(function (d) { if ((!isAlive || isAlive()) && d) wsPair[1](d) }).catch(function () {})
      }
      useEffect(function () { fetchAll(function () { return aliveRef.v }); return function () { aliveRef.v = false } }, [])
      var setK = function (key, v) {
        errPair[1]('')
        var p = {}; p[key] = v
        cfgPair[1](Object.assign({}, cfg, p))
        saveConfigPatch(p, { onError: function (e) { errPair[1](String((e && e.message) || e || 'save failed')) } })
      }
      var boolOf = function (key, def) { if (!cfg) return false; var v = cfg[key]; return v === undefined ? !!def : !!v }
      var numOf = function (key, def) { if (!cfg) return def; var v = cfg[key]; return (v === undefined || v === null || v === '') ? def : v }
      var switchBtn = function (on, onClick, label) {
        return h('button', { 'data-dam-skin-v4-switch': '', 'data-on': on ? '1' : '0', 'aria-pressed': on ? 'true' : 'false', 'aria-label': label || '', disabled: !cfg, title: zh ? '点击即时保存' : 'Saves instantly', onClick: onClick }, h('i', { 'aria-hidden': 'true' }))
      }
      var row = function (label, hint, ctl, key) {
        return h('div', { key: key || label, 'data-dam-skin-v4-ctlrow': '' }, [
          h('div', null, [h('b', null, label), hint ? h('small', null, hint) : null]),
          ctl,
        ])
      }
      var rowSwitch = function (label, hint, key, def) {
        var on = boolOf(key, def)
        return row(label, hint, switchBtn(on, function () { setK(key, !on) }, label), key)
      }
      var rowNum = function (label, hint, key, def, min, max, step) {
        var cur = numOf(key, def)
        var commit = function (e) {
          var s = String(e.target.value == null ? '' : e.target.value).trim()
          if (s === '') { e.target.value = String(cur); return }
          var n = Number(s)
          if (!Number.isFinite(n)) { e.target.value = String(cur); return }
          if (min !== undefined) n = Math.max(min, n)
          if (max !== undefined) n = Math.min(max, n)
          setK(key, n)
        }
        var ctl = h('input', { 'data-dam-skin-v4-input': '', 'data-dam-key': key, type: 'number', min: min, max: max, step: step, defaultValue: String(cur), key: key + '@' + String(cur), disabled: !cfg, onBlur: commit, onKeyDown: function (e) { if (e.key === 'Enter') { try { e.target.blur() } catch (eB) {} } } })
        return row(label, hint, ctl, key)
      }
      var rowTime = function (label, hint, key, def) {
        var cur = String(numOf(key, def) || def)
        var commit = function (e) {
          var s = String(e.target.value || '').trim()
          if (/^\d{1,2}:\d{2}$/.test(s)) setK(key, s)
          else e.target.value = cur
        }
        var ctl = h('input', { 'data-dam-skin-v4-input': '', 'data-dam-key': key, type: 'text', placeholder: def, defaultValue: cur, key: key + '@' + String(cur), disabled: !cfg, onBlur: commit, onKeyDown: function (e) { if (e.key === 'Enter') { try { e.target.blur() } catch (eB) {} } } })
        return row(label, hint, ctl, key)
      }
      var rowSelect = function (label, hint, key, opts, cur) {
        var ctl = h('select', { 'data-dam-skin-v4-select': '', 'data-dam-key': key, value: cur, disabled: !cfg, onChange: function (e) { setK(key, e.target.value) } },
          opts.map(function (o) { return h('option', { key: o[0], value: o[0] }, o[1]) }))
        return row(label, hint, ctl, key)
      }
      var rowSeg = function (label, hint, opts, cur, onPick) {
        var ctl = h('div', { 'data-dam-skin-v4-seg': '', role: 'group', 'aria-label': label }, opts.map(function (o) {
          return h('button', { key: o[0], 'data-on': cur === o[0] ? '1' : '0', 'aria-pressed': cur === o[0] ? 'true' : 'false', type: 'button', onClick: function () { if (cur !== o[0]) onPick(o[0]) } }, o[1])
        }))
        return row(label, hint, ctl, label)
      }
      var card = function (glyph, tone, title, sub, kids2) {
        return h('div', { 'data-dam-skin-v4-card': '' }, [
          h('div', { 'data-dam-skin-v4-cardhd': '' }, [
            h('i', { 'data-dam-skin-v4-tile': '', 'aria-hidden': 'true', style: { background: 'color-mix(in srgb, ' + tone + ' 15%, transparent)', color: tone } }, glyph),
            h('div', null, [h('h2', null, title), sub ? h('p', null, sub) : null]),
          ]),
        ].concat(kids2 || []))
      }
      var sem = semPair[0] || {}
      var mode = sem.activationEmitMode || (cfg && cfg.activationEmitMode) || 'shadow'
      var tierTxt = !sem.loaded ? (zh ? '检测中…' : 'detecting…') : sem.resolvedTier === 'c2' ? 'C2 · JS 语义' : sem.resolvedTier === 'c3' ? 'C3 · Python' : 'C1 · 词法兜底'
      var st = stPair[0]
      var wd = wsPair[0]
      var pickMode = function (m) {
        errPair[1]('')
        semPair[1](Object.assign({}, sem, { activationEmitMode: m }))
        apiPost(API.semanticEmit, { mode: m }).catch(function (e) { errPair[1](String((e && e.message) || e || 'save failed')) })
      }
      var colL = [
        card('🧠', 'var(--skin-brand)', zh ? '主动召回' : 'Active recall', zh ? '总开关与唤回方式(经典档「语义记忆总开关」同键)。' : 'Master switch & recall mode.', [
          rowSwitch(zh ? '自动唤回' : 'Automatic recall', zh ? '按相关性自动注入记忆' : 'Inject memories by relevance', 'associativeMemoryEnabled', false),
          rowSeg(zh ? '唤回方式' : 'Recall mode', zh ? '只记录 / 显式回忆注入 / 全部注入' : 'shadow / canary / active', [['shadow', zh ? '只记录' : 'shadow'], ['canary-explicit', zh ? '显式回忆' : 'canary'], ['active', zh ? '全部注入' : 'active']], mode, pickMode),
          rowNum(zh ? '冷却轮数' : 'Cooldown rounds', 'jsDecideCooldownRounds(0-60)', 'jsDecideCooldownRounds', 1, 0, 60),
          rowNum(zh ? '摘录长度' : 'Excerpt chars', 'jsDecideExcerptChars(20-480)', 'jsDecideExcerptChars', 40, 20, 480),
        ]),
        card('📥', 'var(--skin-ok)', zh ? '自动沉淀' : 'Auto-settle', zh ? '同经典档「记忆容量与归档」的沉淀参数。' : 'Consolidation parameters.', [
          rowSwitch(zh ? '自动沉淀' : 'Enable', zh ? '每轮结束沉淀结论' : 'Settle each turn', 'autoConsolidate', true),
          rowNum(zh ? '最少字符' : 'Min chars', 'autoConsolidateMinChars(≥80)', 'autoConsolidateMinChars', 240, 80),
          rowNum(zh ? '冷却分钟' : 'Cooldown min', 'autoConsolidateCooldownMinutes(≥5)', 'autoConsolidateCooldownMinutes', 30, 5),
          rowNum(zh ? '每日上限' : 'Daily max', 'autoConsolidateDailyMax(1-50)', 'autoConsolidateDailyMax', 8, 1, 50),
        ]),
        card('🔗', 'var(--skin-team)', zh ? '外部与排除' : 'External & excludes', zh ? '窗口预算与工作区扫描(经典档「记忆窗口/存储」同键)。' : 'Budgets & scan limits.', [
          rowNum(zh ? '外部注入预算' : 'External budget', 'externalInjectionChars(≥200)', 'externalInjectionChars', 1400, 200),
          rowNum(zh ? '工作区发现上限' : 'Discover max', 'workspaceDiscoverMax(5-2000)', 'workspaceDiscoverMax', 200, 5, 2000),
          h('p', { 'data-dam-skin-v4-note': '' }, zh ? '注入排除来源(逐行)在经典档设置页编辑,此处不重复。' : 'Per-line exclude sources are edited in classic settings.'),
        ]),
      ]
      var colM = [
        card('⚡', 'var(--skin-warn)', zh ? '技能固化' : 'Skill hub', zh ? '同经典档「自动沉淀成技能」分区。' : 'Skills & promotion.', [
          rowSwitch(zh ? '记忆中枢' : 'Memory hub', 'memoryHubEnabled', 'memoryHubEnabled', false),
          rowSwitch(zh ? '流程注入总闸' : 'Inject master', zh ? 'procedureInjectEnabled(宿主真读的总闸)' : 'the real master switch', 'procedureInjectEnabled', true),
          rowSelect(zh ? '注入档位' : 'Level', 'procedureActiveLevel', 'procedureActiveLevel', [['checklist', zh ? 'checklist 完整步骤' : 'checklist'], ['excerpt', zh ? 'excerpt 摘要' : 'excerpt'], ['hint', zh ? 'hint 仅提示' : 'hint']], (cfg && cfg.procedureActiveLevel) || 'checklist'),
          rowNum(zh ? '最少会话数' : 'Min sessions', 'procedureMinSessions(1-20)', 'procedureMinSessions', 3, 1, 20),
          rowSwitch(zh ? '高风险需人工' : 'High-risk approval', 'procedureHighRiskApproval', 'procedureHighRiskApproval', true),
        ]),
        card('⏰', 'var(--skin-info)', zh ? '定时任务' : 'Schedules', zh ? '定时沉淀 / 定时维护(概念图「日历提醒」的真实同域物)。' : 'Scheduled settle & maintain.', [
          rowSwitch(zh ? '定时沉淀' : 'Scheduled settle', 'consolidateScheduleEnabled', 'consolidateScheduleEnabled', true),
          rowTime(zh ? '沉淀时间' : 'Settle at', 'consolidateScheduleTime', 'consolidateScheduleTime', '09:30'),
          rowNum(zh ? '间隔天数' : 'Every (days)', 'consolidateScheduleDays(1-60)', 'consolidateScheduleDays', 7, 1, 60),
          rowSwitch(zh ? '定时维护' : 'Scheduled maintain', 'maintainScheduleEnabled', 'maintainScheduleEnabled', true),
          rowTime(zh ? '维护时间' : 'Maintain at', 'maintainScheduleTime', 'maintainScheduleTime', '10:00'),
        ]),
        card('🤝', 'var(--skin-brand)', zh ? '交接账本' : 'Handoff', zh ? '同经典档「长会话接续」分区。' : 'Handoff & continuation.', [
          rowSwitch(zh ? '交接白板' : 'Handoff', 'handoffEnabled', 'handoffEnabled', true),
          rowSwitch(zh ? '自动接续' : 'Auto-continue', 'autoContinueEnabled', 'autoContinueEnabled', true),
          rowSwitch(zh ? '水位自动交接' : 'Auto handoff at watermark', 'waterLevelAutoHandoff', 'waterLevelAutoHandoff', true),
          rowNum(zh ? '水位阈值' : 'Watermark', 'waterLevelThreshold(0.1-1.5)', 'waterLevelThreshold', 0.75, 0.1, 1.5, 0.05),
        ]),
      ]
      var colR = [
        card('🧩', 'var(--skin-team)', zh ? '记忆引擎' : 'Engine', zh ? '引擎档位与实时生效状态。' : 'Engine mode & live tier.', [
          rowSelect(zh ? '引擎模式' : 'Engine mode', 'semanticEngineMode', 'semanticEngineMode', [['auto', zh ? 'auto 自动' : 'auto'], ['lexical', zh ? 'lexical 仅词法' : 'lexical'], ['js', zh ? 'js 内置语义' : 'js'], ['python', zh ? 'python 高级' : 'python']], (cfg && cfg.semanticEngineMode) || 'auto'),
          row(zh ? '生效档位' : 'Resolved tier', '', h('em', { 'data-dam-skin-v4-tier': '' }, tierTxt), 'tier'),
          rowSwitch(zh ? '思维链监听' : 'CoT observer', 'reasoningObserverEnabled', 'reasoningObserverEnabled', false),
          h('p', { 'data-dam-skin-v4-note': '' }, zh ? '安装向导与环境检测面板在经典档设置页(engine 分区)。' : 'Setup wizard & detection live in classic settings (engine).'),
        ]),
        card('🗂', 'var(--skin-brand)', zh ? '数据规模' : 'Data scale', zh ? '真实取数,与首页同源。' : 'Live numbers, same source as Home.', [
          row(zh ? '今日沉淀' : 'Settled today', '', h('b', { style: { fontSize: '13px' } }, st && st.autoStats ? String(st.autoStats.count || 0) : '—'), 's1'),
          row(zh ? '今日日志' : 'Logs today', '', h('b', { style: { fontSize: '13px' } }, st && typeof st.todayEntries === 'number' ? String(st.todayEntries) : '—'), 's2'),
          row(zh ? '工作区' : 'Workspaces', '', h('b', { style: { fontSize: '13px' } }, wd && wd.workspaces ? String(wd.workspaces.length) : '—'), 's3'),
        ]),
        card('🧹', 'var(--skin-ok)', zh ? '记忆卫生' : 'Hygiene', zh ? '痕迹回收与压缩重注(经典档同键)。' : 'Recycle & reinject.', [
          rowSwitch(zh ? '子代理痕迹回收' : 'Trace recycle', 'subagentGcEnabled', 'subagentGcEnabled', true),
          rowNum(zh ? '兜底保留天数' : 'Keep days', 'subagentGcKeepDays(≥0)', 'subagentGcKeepDays', 3, 0),
          rowSwitch(zh ? '压缩后重注快照' : 'Reinject on compact', 'snapshotReinjectOnCompact', 'snapshotReinjectOnCompact', true),
        ]),
        h('div', { 'data-dam-skin-v4-quote': '' }, [
          h('b', null, zh ? '你的记忆,由你掌握' : 'Your memory, yours to keep'),
          h('span', null, zh ? '本地优先 · 可导出 · 模型无关 · 安全可靠。' : 'Local-first · exportable · model-agnostic · safe.'),
        ]),
      ]
      return h('div', null, [
        h('div', { 'data-dam-skin-v4-setbar': '' }, [
          h('span', null, zh ? '与经典设置页同一份配置:这里改动即时写盘,经典档刷新即可见;反之亦然。' : 'Same config file as classic: changes here save instantly and show up in classic settings.'),
          h('button', { 'data-dam-skin-v4-wskip': '', onClick: function () { fetchAll(null) } }, zh ? '⟳ 重新读取' : '⟳ Reload'),
        ]),
        errPair[0] ? h('div', { 'data-dam-skin-v4-err': '' }, errPair[0]) : null,
        h('div', { 'data-dam-skin-v4-setcols': '' }, [
          h('div', { 'data-dam-skin-v4-setcol': '' }, colL),
          h('div', { 'data-dam-skin-v4-setcol': '' }, colM),
          h('div', { 'data-dam-skin-v4-setcol': '' }, colR),
        ]),
        h('p', { 'data-dam-skin-v4-note': '' }, zh ? '高级项(prompt 分层 / 逐段注入 / 模型选择器 / 团队协作 / 皮肤素材 / 白板模式 / 版本更新 / 调试中心)在经典档设置页管理。' : 'Advanced items (prompt layers, per-section injection, model picker, team, skin assets, board mode, updates, debug) live in classic settings.'),
      ])
    }
