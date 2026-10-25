function DialogHost() {
      var tickPair = useTick()
      var dlgTick = tickPair[1] // DialogHost 自身的重渲染通道(emit 只刷主面板,刷不到弹窗——开关点击即时反映全靠它)
      // ★2026-09-28 修（与社区作者 PR #146 报出的同一缺陷、同一修法）：
      //   欢迎向导首屏原写作 `tourStep === 0 ? h(SkinHero, { deep: useDeepTheme() }) : null` ——
      //   **hook 写在三元表达式里**，只有 tourStep===0 时才执行 ⇒ 翻到第 2 步起 hook 数量变化
      //   ⇒ React error #310（rendered more hooks than expected）。表现：**重看欢迎向导时崩溃**。
      //   修法：useDeepTheme() 提到无条件调用区（本处），渲染处只读结果。
      //   这正是本函数下方注释「hooks 必须无条件调用」所要求的纪律 —— 早退在函数内已守，
      //   但**条件表达式里的 hook** 逃过了早退检查（K2 守卫覆盖该类，此处属修前存量）。
      var tourDeep = useDeepTheme()
      useEffect(function () { return onDialog(tickPair[1]) }, [])
      // 欢迎向导状态(hooks 必须无条件调用——置于 dialogState 早退之前,满足 hooks 顺序)
      var tourStepPair = useState(0)
      var tourStep = tourStepPair[0]
      var setTourStep = tourStepPair[1]
      var updateSkipPair = useState(false)
      var updateSkip = updateSkipPair[0]
      var setUpdateSkip = updateSkipPair[1]
      useEffect(function () { setUpdateSkip(false) }, [dialogState ? dialogState.kind : null])
      var wizSt = window['dsh-auto-memory.wizStatus']
      if (!wizSt) {
        wizSt = { loaded: false }
        window['dsh-auto-memory.wizStatus'] = wizSt
        refreshSem(function (s) {
          Object.assign(wizSt, s)
          try { dlgTick() } catch (e9) {}
        }, function () { Object.assign(wizSt, { loaded: true, ready: false }) })
      }
      var tourDlPhase = wizSt && wizSt.download && wizSt.download.phase
      var tourShowing = !!dialogState && (dialogState.kind === 'welcomeTour' || dialogState.kind === 'modelDownload')
      useEffect(function () {
        // 每次向导变为可见时回到第一步,并拉一份当前配置快照(开关步读写用)
        if (tourShowing) {
          setTourStep(0)
          wizSt.tourCfg = null
          wizSt.cfgLoaded = false
          fetch(API.config).then(function (r) { return r.json() }).then(function (j) {
            wizSt.tourCfg = (j && (j.config || j)) || {}
            // mode 型开关(唤起注入模式)实际存储在 embedding-config.json(semantic-emit 接口维护),
            // 需从 semantic-status 合并进来,导览开关才能显示真实当前值并与设置页联动。
            try {
              refreshSem(function (j2) {
                if (j2 && j2.activationEmitMode !== undefined) { wizSt.tourCfg.activationEmitMode = j2.activationEmitMode; try { dlgTick() } catch (e13) {} }
              })
            } catch (_) {}
            wizSt.cfgLoaded = true
            try { dlgTick() } catch (e11) {}
          }).catch(function () { wizSt.tourCfg = wizSt.tourCfg || {}; wizSt.cfgLoaded = true })
          fetch(API.external).then(function (r) { return r.json() }).then(function (j) {
            wizSt.extScan = j
            try { dlgTick() } catch (e12) {}
          }).catch(function () {})
        }
      }, [tourShowing])
      useEffect(function () {
        if (!tourShowing) return undefined
        if (wizSt.ready) return undefined // 已就绪无需轮询
        var iv = setInterval(function () {
          refreshSem(function (j) {
            Object.assign(wizSt, j); try { dlgTick() } catch (e10) {}
          })
        }, 1500)
        return function () { clearInterval(iv) }
      }, [tourShowing, tourDlPhase, wizSt.ready])
      // 无语义引擎自动引导:进入引擎下载步且引擎未就绪/未下载/未出错时,自动开始下载内置 JS 档(C2 默认)。
      // 用户可稍后在设置页手动装 Python 进阶档;词法检索 0GB 永远兜底,不阻塞。
      useEffect(function () {
        if (!tourShowing) return undefined
        var curStep = TOUR_STEPS[tourStep]
        if (!curStep || !curStep.dl) return undefined
        if (wizSt.ready || wizSt.loaded === false) return undefined
        var ph = wizSt.download && wizSt.download.phase
        if (ph === 'downloading' || ph === 'verifying' || ph === 'done' || ph === 'error') return undefined
        apiPost(API.semanticDownload, { action: 'start', mirror: 'auto' }).catch(function () {})
      }, [tourShowing, tourStep, wizSt.ready])
      // issue#40:向导展示期间装焦点陷阱(移动端浮层吞点击/Esc 关不掉的关键一环)。
      useEffect(function () {
        if (!dialogState || dialogState.kind !== 'welcomeTour') return undefined
        var root = document.querySelector('[data-dam-tour]')
        return installTourFocusPre(root, function () { dismissWelcomeTourPre('user') }, document)
      }, [dialogState ? dialogState.kind : null])
      // dam-skin(2026-09-27):TOUR_STEPS 定义+暴露整体上移到早退之前——真机实锤:v4 模式无弹窗时
      // DialogHost 在此早退,原位置(早退后)永不执行,v4 welcome 拿不到步骤(批次2 第2页空白)。
      // 单源不变;定义求值只依赖模块级 locale,经典档行为零改动(每次渲染刷新 locale 的语义保留)。
        var TOUR_STEPS = [
          { art: 'bubble', core: '', kicker: 'WELCOME',
            title: L('欢迎使用 dsh-auto-memory', 'Welcome to dsh-auto-memory'),
            text: L('这是 DeepSeek Harness 的个人联想记忆插件。接下来把所有功能向你解释清楚——每个功能都有开关，当场决定开不开；最后会告诉你在哪里随时改。', 'A personal associative-memory plugin for DeepSeek Harness. This tour explains every feature — each has a switch you flip right here; the last page tells you where to change them later.') },
          { art: 'store', core: '', kicker: L('核心能力', 'CORE'),
            title: L('记忆是怎么被想起的', 'How memories are recalled'),
            text: L('先说清楚两条互不依赖的路：①自动联想（下面的开关）——插件持续观察对话与工具事件，锚定记忆；需要回忆时经固定边界注入下一轮，不破坏前缀缓存。②就算关掉它，AI 仍会在每轮结尾默认写项目 memory（memory_log），也能用 memory_recall 主动读取；日历、问候等面板功能也独立运行。', 'Two independent paths: (1) automatic association (switch below) — the plugin anchors memories from conversations and injects relevant ones into the next turn via a fixed boundary. (2) Even with it off, the AI still writes project memory each turn (memory_log) and can read via memory_recall; calendar, greeting and other panel features run independently.') },
          { art: 'inject', core: '', kicker: L('记忆快照', 'SNAPSHOT'),
            title: L('周期性记忆注入', 'Periodic memory snapshot'),
            text: L('另一个独立机制：首次启用时会向上下文注入一段记忆提示（项目长期笔记的摘要），之后每隔一定轮次、或上下文被压缩后自动重新注入，保证模型始终带着记忆背景工作。', 'A separate mechanism: on first enable a memory prompt (long-term notes digest) is injected into context; afterwards it re-injects every N rounds or whenever the context is compacted, so the model always works with memory background.'),
            toggles: [
              { key: 'associativeMemoryEnabled', name: L('自动联想注入', 'Automatic association'), sub: L('上面①的开关——按相关性自动注入记忆（推荐开）', 'Path (1) — inject memories by relevance (recommended)'), rec: true, where: L('自动记忆引擎', 'Semantic engine') },
              { key: 'injectEnabled', name: L('周期记忆快照', 'Periodic snapshot'), sub: L('上面②的开关——定期/压缩后重注入记忆提示（推荐开）', 'Path (2) — re-inject memory digest periodically / on compaction (recommended)'), rec: true, where: L('记忆窗口', 'Memory window') },
            ] },
          { art: 'bell', core: '', kicker: L('日常体验', 'EXPERIENCE'),
            title: L('暂离问候与无人值守', 'Greeting & unattended'),
            text: L('离开超过一小时回来，自动打开记忆面板并送上问候。跑批处理/无人值守任务？开启托管后：不弹问候、不注入寒暄与行为指令、日历提醒静默——模型专注干活，上下文稳定。夜间（22:00-08:00）可自动进入托管。', 'After >1h away the memory panel auto-opens with a greeting. Running batch/unattended jobs? Turn on unattended mode: no greetings, no niceties or behavioural directives, calendar silent — the model stays focused and context stays stable. Auto-engage overnight (22:00-08:00) if you like.'),
            toggles: [
              // ★2026-09-25：此处原为 workbenchPeriod 开关 —— 它是**字符串型**配置（周期天数），而向导开关形态走 tourToggleOn 的 !!c[key] ⇒ 非空值恒判「开」、点击还会把布尔写进配置。该键改由**设置页**承载（「工作台轮换周期（天）」输入框）。
        { key: 'workbenchEnabled', name: L('记忆中枢', 'Memory hub'), sub: L('启用后台记忆工作台；完成向导后确认建立，目录可在设置中调整。', 'Enable the memory workbench. Confirm creation after this tour; adjust its directory in settings.'), where: L('自动化', 'Automation') },
              { key: 'autoPopupEnabled', name: L('暂离问候', 'Welcome-back greeting'), sub: L('暂离超 1 小时回归时自动弹出面板并问候（推荐开）', 'Auto-open the panel with a greeting after >1h away (recommended)'), rec: true, where: L('自动化', 'Automation') },
              { key: 'unattendedAuto', name: L('夜间/批量自动托管', 'Auto-unattended'), sub: L('22:00-08:00 或检测到托管任务时自动进入：零寒暄、上下文冻结、仅保留记忆存取', 'Auto-engage 22:00-08:00 or when a hosted task is detected: zero niceties, frozen context, memory only'), def: false, where: L('自动化', 'Automation') },
            ] },
          { art: 'calendar', core: '', kicker: L('每日助理', 'DAILY ASSISTANT'),
            title: L('反思与总结', 'Reflections & summaries'),
            text: L('让记忆按天组织、按时汇报：', 'Keep memories organized by day:'),
            toggles: [
              { key: 'reflectEnabled', name: L('每日反思', 'Daily reflection'), sub: L('每天第一次会话时，主动呈现前一天的工作反思', 'Present the reflection of the previous day at the first session of each day'), where: L('自动化', 'Automation') },
              { key: 'autoSummaryTimes', name: L('定时总结', 'Scheduled summaries'), sub: L('到点（12:00 / 18:00 / 22:00）自动总结本时段工作并弹窗', 'Summarize the current period at 12:00 / 18:00 / 22:00'), boolOn: ['12:00', '18:00', '22:00'], boolOff: [], where: L('自动化', 'Automation') },
            ] },
          { art: 'link', core: '', kicker: L('外部记忆', 'EXTERNAL'),
            title: L('接入别的 AI（扫描结果）', 'Other AIs (scanned)'),
            text: L('已扫描本机可读的外部来源——勾选你想让插件读取的（只存路径指针，不复制内容）：', 'Scanned sources found on this machine — tick the ones the plugin may read (path pointers only, no copying):'),
            externalScan: true },
          { art: 'engine', core: '', kicker: L('检索引擎', 'RETRIEVAL'), dl: true,
            title: L('三级语义引擎', 'Three-tier semantic engine'),
            text: L('词法检索（0GB）永远可用作保底；内置语义引擎（约 130MB 量化模型）显著提升召回；进阶 Python 引擎（BGE-M3，约 563MB）面向深度用户。以下为自动检测结果，可在此直接安装。另有一个与隐私相关的检索信号开关：', 'Lexical search (0GB) is the always-on floor; the built-in engine (~130MB quantized model) boosts recall; the advanced Python engine (BGE-M3, ~563MB) is optional. Live detection below — install right here. One privacy-related retrieval switch:'),
            toggles: [
              { key: 'reasoningObserverEnabled', name: L('思维链监听', 'Reasoning observer'), sub: L('监听模型思维链分段作为检索信号（默认开；内容比可见输出更敏感，不需要可在此关掉）', 'Watch model CoT segments as a retrieval signal (default ON; more sensitive than visible output — turn off here if unwanted)'), def: false, where: L('自动记忆引擎', 'Semantic engine') },
            ] },
          { art: 'radar', core: '', kicker: L('唤起与固化', 'ACTIVATION'),
            title: L('该出手时才出手', 'Interrupt only when it matters'),
            text: L('记忆唤起=在对话链（CoT/上下文）中直接检测回忆需求，命中即插入下一个环节；记忆固化=每轮结束把结论沉淀进记忆店，供下次唤起。每次决策都能在「唤起回顾」页复核打分。', 'Recall = detect memory needs directly in the conversation chain (CoT/context) and insert at the next boundary. Consolidation = settle conclusions into the stores each turn for later recall. Grade every decision in the Recall review tab.'),
            toggles: [
              { key: 'activationEmitMode', name: L('记忆唤起（链中检测→插入）', 'Memory recall (detect → inject)'), sub: L('开=canary 档（显式回忆注入，推荐）/ 关=shadow 档（只记录不注入）', 'On = canary (inject on explicit recall, recommended) / Off = shadow (record only)'), mode: true, rec: true, where: L('自动记忆引擎', 'Semantic engine') },
              { key: 'autoConsolidate', name: L('记忆固化（自动沉淀）', 'Memory consolidation'), sub: L('每轮对话结束自动把结论沉淀进每日日志与记忆店（推荐开）', 'Consolidate conclusions into the log & stores each turn (recommended)'), rec: true, where: L('自动化', 'Automation') },
              // ★2026-09-22 改键(设置页缺口审计 P0-2):旧键 procedurePromotionEnabled 因 DEFAULT_CONFIG
              //   恒供给布尔 procedureInjectEnabled 而**结构性不可达** ⇒ 该开关此前是摆设(会翻面、写盘成功、宿主读不到)。
              { key: 'procedureInjectEnabled', name: L('技能固化与注入', 'Skill crystallization'), sub: L('重复流程固化为 checklist 自动附上（本开关只管「附不附」；晋升审批在「唤起回顾」页，与本开关无关）', 'Turn repeated flows into auto-attached checklists (this switch only controls attaching; promotion review lives in the Recall review tab and is unrelated)'), where: L('记忆中枢', 'Memory Hub') },
              // ★T10（2026-09-20）：机械 procedure 切片开关。
              //   ★A-1（2026-09-23）：机械切片已整条删除（用户裁定弃用）⇒ 向导清单同步去掉该项，
              //   避免向导承诺一个已不存在的功能（点开找不到控件）。
            ] },
          { art: 'rocket', core: '', kicker: L('完成', 'READY'), final: true,
            title: L('一切就绪', 'All set'),
            text: L('你刚才的选择都已即时保存。改主意了？随时在这几个地方重新打开：', 'Every choice above was saved instantly. Changed your mind? Revisit them here anytime:') },
        ]
        // dam-skin(2026-09-27):TOUR_STEPS 单源暴露给 v4 款 welcome 模块(只追加,不改向导本体;每次渲染刷新 locale)
        window['dsh-auto-memory.TOUR_STEPS'] = TOUR_STEPS
      if (!dialogState) return null
      // 左下角小卡片(记忆按钮上方),高透明毛玻璃,不遮全屏
      var overlay = { position: 'fixed', left: '10px', bottom: '64px', zIndex: 2147483000, width: 'min(360px, calc(100vw - 20px))', maxHeight: 'min(46vh, 430px)', display: 'flex', flexDirection: 'column' }
      var box = {
        overflow: 'auto', borderRadius: '14px', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '6px',
        background: 'color-mix(in srgb, var(--dsw-alias-bg-layer-2, rgba(24,26,32,.9)) 58%, transparent)',
        backdropFilter: 'blur(14px) saturate(1.3)', WebkitBackdropFilter: 'blur(14px) saturate(1.3)',
        border: '1px solid color-mix(in srgb, var(--dsw-alias-border-l1, rgba(128,128,128,.35)) 45%, transparent)',
        boxShadow: '0 8px 28px var(--dam-black-18, rgba(0,0,0,.18))',
      }
      var head = { fontSize: 'calc(13px * var(--dam-scale))', fontWeight: 700, color: 'var(--dsw-alias-label-primary, inherit)' }
      var sub = { fontSize: 'calc(11px * var(--dam-scale))', opacity: .7 }
      var item = { fontSize: 'calc(11px * var(--dam-scale))', lineHeight: 1.55, padding: '1px 0 1px 16px', position: 'relative' }
      var close = { alignSelf: 'flex-end', padding: '4px 16px', borderRadius: '8px', border: '1px solid color-mix(in srgb, var(--dsw-alias-border-l1, rgba(128,128,128,.35)) 45%, transparent)', background: 'color-mix(in srgb, var(--dsw-alias-brand-primary, #4f7cff) 12%, transparent)', color: 'var(--dsw-alias-label-primary, inherit)', cursor: 'pointer', fontSize: 'calc(11.5px * var(--dam-scale))' }
      var dot = { position: 'absolute', left: '0', top: '10px', width: '7px', height: '7px', borderRadius: '50%', background: 'var(--dsw-alias-brand-primary, #4f7cff)' }
      // 通用开场舞台必须在 first/notice/update 三个分支之前完成赋值；var 只提升声明、不提升赋值。
      var skipUpdateIntro = function () { setUpdateSkip(true) }
      var introEligible = dialogState.kind === 'update' ||
        (dialogState.kind === 'notice' && !((dialogState.notice || {}).level === 'urgent'))
      var DamIntroBox = function (children) {
        if (!introEligible) return children
        return h('div', { 'data-dam-update-box': '', 'data-skip': String(updateSkip) },
          h('div', { 'data-dam-update-stage': '' },
            h('div', { 'data-dam-update-logo': '' },
              h('div', { 'data-dam-tour-bokeh': 'a' }),
              h('div', { 'data-dam-tour-bokeh': 'b' }),
              h('div', { 'data-dam-tour-bokeh': 'c' }),
              h('div', { 'data-dam-tour-stage': '' },
                h('div', { 'data-dam-tour-slab': 'bot' }),
                h('div', { 'data-dam-tour-slab': 'mid' }),
                h('div', { 'data-dam-tour-slab': 'top' }))),
            h('div', { 'data-dam-update-hint': '' }, L('点击任意处跳过', 'Click anywhere to skip'))),
          !updateSkip ? h('div', { 'data-dam-update-click': '', onClick: skipUpdateIntro }) : null,
          h('div', { 'data-dam-update-content': '' }, children))
      }
          // ═══ 记忆工作台向导（2026-09-24）══════════════════════════════════════
      // 居中弹窗，复用新手引导的 [data-dam-tour-*] 外壳（位置/毛玻璃/入场动画全部继承）。
      // 触发：启动检测 ready===false（含三重校验任一失败）。用户硬要求「不能像语义模型检测那样
      // 在左下角显示得不明显」⇒ 必须居中；「不能瞎弹或重叠」⇒ 走 openDialog 单例队列。
      if (dialogState.kind === 'workbenchSetup') {
        var wbSt = dialogState.status || {}
        var wbV = wbSt.verify || {}
        var wbReason = String(wbSt.reason || wbV.reason || 'unknown')
        // ★v3.1.8 相位机（用户裁定四条流程）：
        //   exists 已有 ⇒「已经有，直接可以使用」；offer 没有 ⇒ (a) 说明要建什么+什么权限，(b) 同意后建立；
        //   building (b)→(c) 之间的可见过程；done (c) 建立成功。
        // ★D4（2026-09-24）：暂时态（尚未加载）**不得**进入 offer 相位 —— 那会给出「同意并建立」按钮，
        //   点一下就多建一个会话（用户报障的重复会话就是这么来的）。此时按「已存在」收口，
        //   不提供任何建立入口；状态行照实说明「尚未加载、自动恢复、不会新建」。
        // ★D7（2026-09-25 真机取证）：相位判据必须以 **verify.ok 为先** —— `ready` 是宿主进程内的
        //   内存态，重启后可能尚未置位；而 `verify` 是**只读真值**。实测 `verify.ok=true` 时
        //   `ready` 仍为 false ⇒ 弹窗照旧弹「建立记忆中枢」（用户报障的就是这个）。
        //   verify 通过即代表工作台可用 ⇒ 一律收口为 exists，不提供任何建立入口。
        // ★D8：改用与开窗门**同源**的唯一判据（旧写法在此重复了一份，两处易漂移）。
        var wbPhase = dialogState.phase || ((wbExistsPre(wbSt) || wbReason === 'session-not-loaded') ? 'exists' : 'offer')
        var wbDirTxt = String(wbSt.cwd || wbSt.rootDefault || '—')
        var wbPermTxt = String(wbV.preset || (wbSt.state && wbSt.state.permission) || 'danger-full-access')
        // ★S6（2026-09-24）：原因码 → 人话（新增「工作区未登记」这一档）
        var WB_REASON_TXT = (locale === 'zh')
          ? { 'workspace-unregistered': '工作区尚未登记（点下面按钮会就地建立）', 'cwd-mismatch': '工作台会话的工作目录与设置不符', 'permission-mismatch': '工作台会话权限不是「完全访问」', 'epoch-mismatch': '期号已轮换（需建立本期工作台）', 'session-missing': '工作台会话不存在', 'session-gone': '工作台会话已不存在（需要重建）', 'session-not-loaded': '工作台会话尚未加载（宿主刚重启的暂时状态，插件会自动恢复，不会新建会话）', 'no-state': '尚未建立工作台' }
          : { 'workspace-unregistered': 'Workspace not registered yet (the button below creates it in place)', 'cwd-mismatch': 'Workbench session cwd differs from settings', 'permission-mismatch': 'Workbench permission is not full access', 'epoch-mismatch': 'Epoch rotated (a new workbench is needed)', 'session-missing': 'Workbench session is missing', 'session-gone': 'Workbench session is gone (rebuild needed)', 'session-not-loaded': 'Workbench session not loaded yet (transient right after a host restart; it recovers automatically and no new session is created)', 'no-state': 'Workbench not created yet' }
        var wbPass = !!wbV.ok
        // ★D3（2026-09-24）：行状态必须回答「这一项到底过没过」，而不是「它是不是本次失败原因」。
        //   旧写法 wbPass || wbReason !== '<本行原因>' 会让**尚未校验到的行也显示 ✓** ——
        //   用户截图即为「四行全 ✓，状态却说工作台会话不存在」，自相矛盾且看不出坏在哪。
        //   现在按真实校验顺序定级：过 ✓ / 本行即失败原因 ✗ / 尚未校验到 ·（中性）。
        var WB_RANK = { 'no-state': 0, 'epoch-mismatch': 1, 'session-missing': 2, 'session-gone': 2, 'session-not-loaded': 2, 'cwd-mismatch': 3, 'workspace-unregistered': 4, 'no-permission-service': 5, 'permission-mismatch': 6 }
        var wbFailRank = (typeof WB_RANK[wbReason] === 'number') ? WB_RANK[wbReason] : 9
        var wbRow = function (label, rank, detail) {
          var st = wbPass ? 'ok' : (rank < wbFailRank ? 'ok' : (rank === wbFailRank ? 'bad' : 'na'))
          return h('div', { 'data-dam-wb-row': '' },
            h('span', { 'data-dam-wb-dot': st, 'data-dam-wb-state': st }, st === 'ok' ? '✓' : (st === 'bad' ? '✗' : '·')),
            h('span', { 'data-dam-wb-label': '' }, label),
            h('span', { 'data-dam-wb-detail': '' }, detail || ''))
        }
        var wbBusy = !!dialogState.busy
        // 建立动作**只**发在这里（用户点「同意并建立」之后）—— 检测路径已改只读。
        var wbRun = function () {
          dialogState = Object.assign({}, dialogState, { phase: 'building', busy: true })
          notifyDialog()
          apiPost(API.workbench, { action: 'setup' }).then(function (r) {
            var ok = !!(r && r.ready)
            dialogState = Object.assign({}, dialogState, {
              phase: ok ? 'done' : 'offer', busy: false, status: r || wbSt,
            })
            notifyDialog()
          }, function () {
            dialogState = Object.assign({}, dialogState, { phase: 'offer', busy: false })
            notifyDialog()
          })
        }
        // ★2026-09-25 视觉重做：按钮样式改由 CSS 承担。原内联写法是「按钮看不清」的根源——
        //   主按钮 color:#fff 压在主题品牌色上（浅色主题下对比不足）；次按钮 background:transparent
        //   且 color:inherit 压在磨砂玻璃上 ⇒ 几乎看不见。现由 [data-dam-wb-card] 规则给出确定性对比。
        return h('div', { 'data-dam-tour-backdrop': '', 'data-dam-wb-setup': '' },
          h('div', { 'data-dam-region': 'dialog', 'data-dam-tour': '', 'data-dam-wb-card': '', role: 'dialog', 'aria-modal': true, tabIndex: -1, 'aria-label': L('记忆工作台', 'Memory workbench') },
            h('div', { 'data-dam-wb-head': '', 'data-dam-wb-phase': wbPhase }, locale === 'zh'
              ? ({ exists: '记忆中枢已就绪', offer: '建立「记忆中枢」', building: '正在建立记忆中枢…', done: '记忆中枢建立成功' }[wbPhase] || '记忆中枢')
              : ({ exists: 'Memory hub is ready', offer: 'Create the memory hub', building: 'Creating the memory hub…', done: 'Memory hub created' }[wbPhase] || 'Memory hub')),
            h('div', { 'data-dam-wb-sub': '' }, locale === 'zh'
              ? ({
                exists: '已经有「记忆中枢」了，直接可以使用。后台的记忆整理（问候 / 总结 / 沉淀 / 蒸馏）都挂在它下面运行。',
                offer: '接下来会新建一个属于插件的工作区（目录「记忆中枢」）和一个工作台会话，并把初始化对话放进去；后台的记忆整理（问候 / 总结 / 沉淀 / 蒸馏）都挂在它下面运行，这样不会再往你的会话列表里塞子对话。',
                building: '正在创建工作区与工作台会话，并把初始化对话放进去。请稍候，不要关闭本窗口。',
                done: '工作区与会话已建立，初始化对话已放入。后台记忆任务现在开始运行。',
              }[wbPhase] || '')
              : ({
                exists: 'The memory hub already exists — you can use it right away.',
                offer: 'A plugin-owned workspace (“memory hub”) and a workbench session will be created, with the init conversation seeded into it.',
                building: 'Creating the workspace and workbench session, and seeding the init conversation. Please wait.',
                done: 'Workspace and session created; the init conversation has been seeded.',
              }[wbPhase] || '')),
            wbRow(L('① 工作区位置', '① Location'), 3, wbDirTxt),
            wbRow(L('② 权限（完全访问）', '② Permission'), 6, wbPermTxt),
            wbRow(L('③ 期号（编号）', '③ Epoch'), 1, String((wbSt.state && wbSt.state.epoch) || '—') + ' → ' + String(wbSt.epochNow || '—')),
            // ★S6（2026-09-24）：第 ④ 行 = **工作区是否真的登记**（用户原话「必须检测到底有没有这个工作区**和**对话出现」）。
            wbRow(L('④ 工作区登记', '④ Workspace'), 4, String(wbV.cwd || wbSt.cwd || '—')),
            h('div', { 'data-dam-wb-reason': '' }, (L('当前状态：', 'Status: ')) + (WB_REASON_TXT[wbReason] || wbReason)),
            h('div', { 'data-dam-wb-dir': '' },
              h('strong', null, L('记忆目录：', 'Memory directory: ')),
              String(wbSt.cwd || wbSt.rootDefault || '—') + (L('（DSH 本体目录下，跨平台一致；设置留空即自动）', ' (inside the DSH home directory; empty setting = automatic)'))),
            h('div', { 'data-dam-wb-risk': '' },
              h('strong', null, L('必须「完全访问」：', 'Full access required: ')),
              // ★2026-09-25 视觉重做：原文里的 **…** 在 DOM 里被当字面量显示（显示成星号），
              //   现改为真正的 <strong>，既可读、又保住了强调意图。
              L('这个工作台会话必须使用「完全访问」权限——若用受限权限，后台任务会被沙箱拦住、', 'This workbench session must use full file access. With restricted permissions background jobs are sandbox-blocked and '),
              h('strong', null, L('读不到记忆条目', 'cannot read memory entries')),
              L('，相关功能会静默失效（界面上看不到任何报错）。若上方第 ② 行未通过，请点「一键添加并修复」重建为该权限。该会话下的后台任务只做记忆整理，不会改动你的项目代码。', ' — the features then fail silently with no error shown. If row ② above is not passing, click “Set up now” to rebuild it with that permission. Jobs in it only curate memory; they do not modify your project code.')),
            h('div', { 'data-dam-wb-actions': '' },
              h('button', { type: 'button', 'data-dam-wb-cta': wbPhase, disabled: wbBusy,
                onClick: (wbPhase === 'exists' || wbPhase === 'done') ? finishWorkbenchFlow : wbRun },
                wbPhase === 'offer' ? (L('同意并建立', 'Agree & create'))
                  : (wbPhase === 'building' ? (L('正在建立…', 'Setting up…'))
                    : (L('好，开始使用', 'OK, start using')))),
              (wbPhase === 'offer')
                ? h('button', { type: 'button', 'data-dam-wb-cta2': '', disabled: wbBusy, onClick: finishWorkbenchFlow }, L('稍后', 'Later'))
                : null),
            h('div', { 'data-dam-wb-foot': '' }, locale === 'zh'
              ? (wbPhase === 'exists' || wbPhase === 'done'
                ? '后台记忆任务已在运行。之后可在 设置 → 自动化 里改工作台目录或轮换周期。'
                : '在建立完成前，所有后台记忆任务都会暂停（不会发送任何请求）；只有你点了「同意并建立」才会写入。')
              : (wbPhase === 'exists' || wbPhase === 'done'
                ? 'Background memory jobs are running. Change the workbench directory or rotation later in Settings → Automation.'
                : 'Until you click “Agree & create”, nothing is written and all background memory jobs stay paused.'))))
      }
  if (dialogState.kind === 'welcomeTour' || dialogState.kind === 'modelDownload') {
        // 首启引导向导 v2(2026-08-31):分步功能全覆盖 + 步内功能开关(点击即时写配置)
        // + 完成步提醒「随时可在设置的哪个分区重新打开」。跳过/✕ 也先落到完成步(提醒)。
        // 语义引擎状态(wizSt 已在 DialogHost 顶部初始化;下载轮询 useEffect 同样在顶部)
        var dl = wizSt.download || { phase: 'idle' }
        var dlActive = dl.phase === 'downloading' || dl.phase === 'verifying'
        var wizReady = wizSt.ready
        var totalBytes = wizSt.manifestBytes || Math.round(130 * 1024 * 1024)
        var prog = dlActive || dl.phase === 'done'
          ? Math.min(100, Math.round(((dl.bytesDone || 0) / Math.max(1, dl.bytesTotal || totalBytes)) * 100))
          : (wizReady ? 100 : 0)
        var fmtMB = function (b) { return b ? (b / (1024 * 1024)).toFixed(1) + ' MB' : '—' }
        var dlPhaseTxt = !wizSt.loaded ? (L('检测中…', 'Detecting…'))
          : wizReady ? (L('✓ 就绪（SHA256 校验 + 推理自检已通过）', '✓ Ready (SHA256 verify + inference self-test passed)'))
          : dl.phase === 'verifying' ? t('dlVerifying')
          : dl.phase === 'downloading' ? (t('dlDownloading') + ' · ' + fmtMB(dl.bytesDone || 0) + ' / ' + fmtMB(dl.bytesTotal || totalBytes))
          : dl.phase === 'error' ? (t('dlError') + ': ' + String(dl.error || '').slice(0, 90))
          : dl.phase === 'done' ? (wizSt.assetPresent && !wizSt.peerPresent
              ? (L('模型已下载,推理库缺失——先 pnpm approve-builds(批准原生脚本),再 pnpm add @huggingface/transformers,重启生效', 'Model downloaded, inference lib missing — run pnpm approve-builds, then pnpm add @huggingface/transformers, restart'))
              : t('dlDone'))
          : (L('未下载 · 词法检索照常可用', 'Not downloaded · lexical search keeps working'))
        var startDl = function () {
          apiPost(API.semanticDownload, { action: 'start', mirror: 'auto' }).catch(function () {})
        }
        // 功能开关:读当前值(带每项默认)/点击即时写配置(乐观更新+POST,失败不回滚——下次重看向导会以真实配置为准)
        var EXT_SOURCE_KEYS = ['workbuddy-user', 'workbuddy-profile', 'codebuddy-memory', 'claude-global', 'project-conventions', 'workbuddy-sessions', 'claude-sessions', 'codex-sessions']
        var tourToggleOn = function (tg) {
          var c = wizSt.tourCfg || {}
          if (!wizSt.cfgLoaded) return false // 配置未加载完,一律视为关且禁用,避免误触默认值
          if (tg.key === 'autoSummaryTimes') return (c[tg.key] || []).length > 0
          if (tg.groupAll) { var v = c[tg.key] || {}; return !!v['workbuddy-user'] }
          if (tg.mode) { var m = c[tg.key]; if (m === undefined) return tg.def === true; return m === 'canary-explicit' || m === 'active' }
          return c[tg.key] === undefined ? tg.def !== false : !!c[tg.key]
        }
        var tourToggleClick = function (tg) {
          if (!wizSt.cfgLoaded) return // 配置未加载完,禁止写入,防止覆盖用户设置
          // ★2026-09-28 跟进 PR #146：向导开关的落盘改为**乐观更新 + 失败回滚 + 防重入 + 错误可见**。
          //   旧实现失败时静默（mode 型那支甚至是空 catch），用户以为已保存、实际没落盘；
          //   且无 busy 门，连点会并发写同一键。现：先记录 before 快照 → 乐观改 UI → 写盘 →
          //   成功清 busy；失败则**回滚 UI 到快照**并把原因写进 cfgError（向导里有可见的错误行）。
          if (wizSt.tourBusy) return
          var c = wizSt.tourCfg = wizSt.tourCfg || {}
          var on = tourToggleOn(tg)
          var patch = {}
          if (tg.key === 'autoSummaryTimes') patch[tg.key] = on ? (tg.boolOff || []) : (tg.boolOn || [])
          else if (tg.groupAll) { var o = {}; for (var i = 0; i < EXT_SOURCE_KEYS.length; i++) o[EXT_SOURCE_KEYS[i]] = !on; patch[tg.key] = o }
          else if (tg.mode) patch[tg.key] = on ? 'shadow' : 'canary-explicit'
          else patch[tg.key] = !on
          persistTourPatch(patch, !!tg.mode)
        }
        /** 向导开关落盘（乐观更新 + 失败回滚；mode 型走 semantic-emit，其余走 saveConfigPatch）。 */
        var persistTourPatch = function (patch, mode) {
          if (!wizSt.cfgLoaded || wizSt.tourBusy) return
          var before = Object.assign({}, wizSt.tourCfg)
          wizSt.tourCfg = Object.assign({}, before, patch); wizSt.tourBusy = true; wizSt.cfgError = ''; dlgTick()
          var request = mode ? apiPost(API.semanticEmit, { mode: patch.activationEmitMode }) : saveConfigPatch(patch)
          request.then(function () { wizSt.tourBusy = false; dlgTick() }, function (error) {
            wizSt.tourCfg = before; wizSt.tourBusy = false; dlgTick()
            wizSt.cfgError = L('保存失败：', 'Save failed: ') + ((error && error.message) || error || '')
            try { dlgTick() } catch (eT) {}
          })
        }
        // 外部来源单源勾选(扫描行;勾选即写 externalSources 对象)
        var tourExtToggle = function (id) {
          if (!wizSt.cfgLoaded) return // 配置未加载完,禁止写入
          var c = wizSt.tourCfg = wizSt.tourCfg || {}
          var cur = Object.assign({}, c.externalSources || {})
          cur[id] = (cur[id] !== false) ? false : true
          c.externalSources = cur
          dlgTick()
          saveConfigPatch({ externalSources: cur })
        }
        var tourExtOn = function (id) {
          var c = wizSt.tourCfg || {}
          return (c.externalSources || {})[id] !== false
        }
        var allToggles = []
        TOUR_STEPS.forEach(function (s) { if (s.toggles) allToggles = allToggles.concat(s.toggles) })
        var whereGroups = {}
        allToggles.forEach(function (tg) { var k = tg.where || '设置'; (whereGroups[k] = whereGroups[k] || []).push(tg.name) })
        var finishTour = function () {
          try { localStorage.setItem('dsh-auto-memory.semWizardDone', '1') } catch (e4) {}
          closeDialog()
          // ★v3.1.8 顺序裁定（用户原话「你的这个流程应该在 change log 之前。我怕你和那个在抢」）：
          //   向导结束 → **先**走记忆中枢初始化（说明 / 同意 / 建立）→ 收尾时才接力到更新说明。
          //   原实现在此处直接 openDialog(kind:'update')，会与初始化窗抢同一个弹窗槽。
          pendingChangelogAfterInit = true
          try { checkWorkbenchPre(true); return } catch (eWb2) {}

        }
        // issue#40:"关闭"就是关闭 —— 旧实现把 ✕ 变成"先跳到最后一步再点"，手机端体感即"关不掉"。
        // 现在 ✕ 直接撤下向导并记录**用户动作**(tourDismissed)，此后不再自动播放。
        var closeOrRemind = function () { dismissWelcomeTourPre('user') }
        var step = TOUR_STEPS[Math.min(tourStep, TOUR_STEPS.length - 1)]
        // ★R28 补 12 卷 §二 缺口：`hero.welcome`（首屏主视觉，优先级 P1）此前**定义了但 0 处调用**
        //   ⇒ 6 槽位里只有 5 个真上了页面。按 12 卷表「用在 page-welcome（欢迎引导）」挂到**首屏步**。
        //   渲染纪律（12 卷 §四 纪律二）：图未就绪时 SkinSlot 自身回**确定性占位**（不塌、不留白）。
        //   ★只挂首屏步（tourStep===0）—— 其余步零新增 DOM，既有观感逐字不变。
        var isLast = tourStep >= TOUR_STEPS.length - 1
        // 每步只生成当前图形所需 DOM；避免旧实现一次创建 22 个 span、非当前零件塌成 0/2px。
        var renderTourArt = function (type) {
          var piece = function (cls) { return h('span', { className: 'ap ' + cls }) }
          var children
          if (type === 'store') children = [piece('plate p1'), piece('plate p2'), piece('plate p3')]
          else if (type === 'inject') children = [piece('inject-capsule'), piece('inject-drop'), piece('inject-pulse')]
          else if (type === 'bell') children = [piece('bell-shell'), piece('bell-base'), piece('bell-clapper')]
          else if (type === 'calendar') children = [piece('calendar-card'), piece('calendar-bind b1'), piece('calendar-bind b2'), piece('calendar-page')]
          else if (type === 'link') children = [piece('link-ring l1'), piece('link-ring l2'), piece('link-glint')]
          else if (type === 'engine') children = [piece('engine-prism'), piece('engine-core'), piece('engine-orbit')]
          else if (type === 'radar') children = [piece('radar-outer'), piece('radar-inner'), piece('radar-sweep'), piece('radar-ping')]
          else if (type === 'rocket') children = [piece('rocket-tier t1'), piece('rocket-tier t2'), piece('rocket-tier t3'), piece('rocket-spark')]
          else children = [piece('bubble-orb'), piece('bubble-seed s1'), piece('bubble-seed s2')]
          return h('div', { 'data-dam-tour-art': type || 'bubble', key: 'art' + tourStep }, children)
        }
        return h('div', { 'data-dam-tour-backdrop': '',
            onMouseMove: function (e) {
              // Liquid Glass 动态响应:高光/图标 3D 倾斜跟随鼠标(卡内坐标百分比)
              var el = e.currentTarget.querySelector('[data-dam-tour]')
              if (!el) return
              var r = el.getBoundingClientRect()
              el.style.setProperty('--dam-mx', (((e.clientX - r.left) / r.width) * 100).toFixed(1) + '%')
              el.style.setProperty('--dam-my', (((e.clientY - r.top) / r.height) * 100).toFixed(1) + '%')
            } },
          h('div', { 'data-dam-region': 'dialog', 'data-dam-tour': '', role: 'dialog', 'aria-modal': true, tabIndex: -1, 'aria-label': L('欢迎向导', 'Welcome tour') },
            h('div', { 'data-dam-tour-glare': '' }),
            h('button', { 'data-dam-tour-close': '', title: t('close'), onClick: closeOrRemind }, '✕'),
            h('div', { 'data-dam-tour-orb-wrap': '', key: 'orb' + tourStep, 'data-step': String(tourStep), 'data-art': step.art || 'bubble' },
              h('div', { 'data-dam-tour-halo': '' }),
              h('div', { 'data-dam-tour-bokeh': 'a' }),
              h('div', { 'data-dam-tour-bokeh': 'b' }),
              h('div', { 'data-dam-tour-bokeh': 'c' }),
              step.art === 'store' ? h('div', { 'data-dam-tour-stage': '', key: 'stage' + tourStep },
                h('div', { 'data-dam-tour-slab': 'bot' }),
                h('div', { 'data-dam-tour-slab': 'mid' }),
                h('div', { 'data-dam-tour-slab': 'top' })) : h('div', { 'data-dam-tour-app-tile': '', key: 'tile' + tourStep }),
              step.art === 'store' ? null : renderTourArt(step.art || 'bubble'),
              h('div', { 'data-dam-tour-pedestal': '' })),
            h('div', { 'data-dam-tour-body': '', key: 'body' + tourStep, 'data-dam-tour-swap': '' },
              h('div', { 'data-dam-tour-head': '' },
                // ★R28：仅**首屏步**渲染 hero 主视觉（12 卷 §二 表 1「用在 page-welcome」）。
        //   其它步返回 null ⇒ 零新增 DOM（既有观感逐字不变）。
        tourStep === 0 ? h(SkinHero, { slot: 'hero.welcome', deep: tourDeep }) : null,
        h('div', { 'data-dam-tour-kicker': '' }, step.kicker),
                h('div', { 'data-dam-tour-stepchip': '' }, (tourStep + 1 < 10 ? '0' : '') + (tourStep + 1) + ' / ' + (TOUR_STEPS.length < 10 ? '0' : '') + TOUR_STEPS.length)),
              h('div', { 'data-dam-tour-title': '' }, step.title),
              h('div', { 'data-dam-tour-text': '' }, step.text),
              step.toggles ? h('div', { 'data-dam-tour-toggles': '' },
                step.toggles.map(function (tg, ti) {
                  var on = tourToggleOn(tg)
                  return h('button', { key: ti, 'data-dam-tour-tg': '', 'data-on': String(on), onClick: function () { tourToggleClick(tg) } },
                    h('div', { 'data-dam-tour-tg-txt': '' },
                      h('div', { 'data-dam-tour-tg-name': '' }, tg.name, tg.rec ? h('span', { 'data-dam-tour-rec': '' }, L('推荐', 'REC')) : null),
                      h('div', { 'data-dam-tour-tg-sub': '' }, tg.sub)),
                    h('div', { 'data-dam-tour-sw': '', 'data-on': String(on) }))
                })) : null,
              step.externalScan ? h('div', { 'data-dam-tour-toggles': '', 'data-scroll': 'true' },
                !(wizSt.extScan && wizSt.extScan.sources) ? h('div', { style: { opacity: .55, fontSize: '12px', padding: '8px 4px' } }, L('正在扫描本机来源…', 'Scanning local sources…'))
                  : (wizSt.extScan.sources || []).map(function (src) {
                    var on = tourExtOn(src.id)
                    return h('button', { key: src.id, 'data-dam-tour-tg': '', 'data-on': String(on), onClick: function () { tourExtToggle(src.id) } },
                      h('div', { 'data-dam-tour-tg-txt': '' },
                        h('div', { 'data-dam-tour-tg-name': '' }, src.name, h('span', { style: { opacity: .5, fontWeight: 400, fontSize: '10.5px', marginLeft: '6px' } }, src.tool + ' · ' + src.kind)),
                        h('div', { 'data-dam-tour-tg-sub': '' }, (L('已检测到 · ', 'found · ')) + (src.size > 1048576 ? (src.size / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(src.size / 1024)) + ' KB'))),
                      h('div', { 'data-dam-tour-sw': '', 'data-on': String(on) }))
                  })) : null,
              step.dl ? h('div', { 'data-dam-tour-dl': '' },
                h('div', { 'data-dam-tour-dl-row': '' },
                  h('span', null, dlPhaseTxt),
                  h('span', null, wizReady ? 'C2 · 129MB' : (prog + '%'))),
                wizReady ? null : h('div', { 'data-dam-tour-bar': '' },
                  h('div', { 'data-dam-tour-bar-i': '', style: { width: prog + '%', background: dl.phase === 'error' ? 'linear-gradient(90deg,var(--dam-tone-error, #c44a4a),var(--dam-tone-error-soft, #e08a8a))' : undefined } })),
                !wizReady && wizSt.loaded && !dlActive ? h('div', { 'data-dam-tour-dl-row': '', style: { marginTop: '4px' } },
                  h('span', null, (L('下载源: ', 'Source: ')) + (dl.mirrorUsed === 'cn' ? t('mCn') : dl.mirrorUsed === 'intl' ? t('mIntl') : t('mAuto')) + (L(' · 失败自动切备用源', ' · auto-failover')))) : null,
                h('div', { 'data-dam-tour-dl-tier': '' },
                  h('div', { 'data-dam-tour-dl-tier-row': '' },
                    h('b', null, L('内置 JS 档（自动）', 'Built-in JS tier (auto)')),
                    h('span', null, L('e5-small · ~129MB · 默认,正在为你安装', 'e5-small · ~129MB · default, installing for you'))),
                  h('div', { 'data-dam-tour-dl-tier-row': '' },
                    h('b', null, L('Python 进阶档（可选）', 'Python tier (optional)')),
                    h('span', null, L('BGE-M3 int8 · 563MB · 追求更高精度的发烧友可在设置页安装', 'BGE-M3 int8 · 563MB · for enthusiasts chasing higher precision — installable in Settings'))))) : null,
              step.final ? h('div', null,
                h('div', { 'data-dam-tour-chips': '' },
                  allToggles.filter(function (tg) { return tourToggleOn(tg) }).map(function (tg) {
                    return h('span', { key: tg.key, 'data-dam-tour-badge': '', style: { background: 'var(--dam-47-164-106-20, rgba(47,164,106,.20))', color: 'var(--dam-dec-emit, #7fdcb0)' } }, '✓ ' + tg.name)
                  }),
                  allToggles.filter(function (tg) { return !tourToggleOn(tg) }).map(function (tg) {
                    return h('span', { key: 'off' + tg.key, 'data-dam-tour-badge': '', style: { background: 'var(--dam-neutral-16, rgba(128,128,128,.16))', opacity: .7 } }, tg.name + (L(' 关', ' off')))
                  })),
                h('div', { 'data-dam-tour-where': '' },
                  Object.keys(whereGroups).map(function (k) {
                    return h('div', { key: k }, '· ', h('b', null, k), ' —— ' + whereGroups[k].join(L(' / ', ' / ')))
                  }),
                  h('div', null, '· ', h('b', null, L('面板页签', 'Panel tabs')), L(' —— 唤起回顾（决策打分）/ 存储管理（扫描修复）', ' — Recall review / Storage tools')))) : null),
            // ★v3.1.3：末页赞助/贡献入口（用户要求「两个小按钮 + 简短注释，不破坏原有结构」）。
            //   作为 where 的**兄弟节点追加**；文案走 inline locale（与 TOUR_STEPS 全体现有写法一致），
            //   不新增 i18n 键 ⇒ 零 i18n 表改动。
            step.final ? h('div', { 'data-dam-tour-links': '' },
              h('a', { href: 'https://htmlpreview.github.io/?https://github.com/Aik358/dsh-auto-memory/blob/main/docs/CONTRIBUTORS.html', target: '_blank', rel: 'noopener noreferrer', 'data-dam-tour-link': '' },
                L('贡献者与赞助', 'Contributors & Sponsors')),
              h('a', { href: 'https://api.dshapi.icu/register?aff=HJU27P7JL39N', target: '_blank', rel: 'noopener noreferrer', 'data-dam-tour-link': '' },
                L('DSH API 中转站', 'DSH API relay')),
              // ★v3.1.4 批 J：第三个按钮 = QQ 交流群（链接与 README / CONTRIBUTORS 同源，不新造）
              h('a', { href: 'https://qm.qq.com/q/v7Asxn6vPa', target: '_blank', rel: 'noopener noreferrer', 'data-dam-tour-link': '' },
                L('QQ 交流群', 'QQ group')),
              h('div', { 'data-dam-tour-links-note': '' },
                L('感谢为本项目出力的贡献者与基础设施赞助方。', 'Thanks to our contributors and infrastructure sponsors.'))) : null,
            h('div', { 'data-dam-tour-dots': '' },
              TOUR_STEPS.map(function (s, si) {
                return h('button', { key: si, 'data-dam-tour-dot': '', 'data-on': String(si === tourStep),
                  onClick: function () { setTourStep(si) }, title: s.kicker })
              })),
            h('div', { 'data-dam-slot': 'footer', 'data-dam-tour-foot': '' },
              h('button', { 'data-dam-tour-skip': '', onClick: closeOrRemind }, L('跳过向导', 'Skip tour')),
              h('button', { 'data-dam-tour-btn': '', 'data-primary': 'false', disabled: tourStep === 0,
                onClick: function () { setTourStep(Math.max(0, tourStep - 1)) } },
                L('‹ 上一步', '‹ Back')),
              h('button', { 'data-dam-tour-btn': '', 'data-primary': 'true',
                onClick: function () { isLast ? finishTour() : setTourStep(tourStep + 1) } },
                isLast ? (L('开始使用', 'Get started'))
                  : (L('下一步 ›', 'Next ›'))))))
      }
      if (dialogState.kind === 'notice') {
        var n = dialogState.notice || {}
        var zh = locale === 'zh' || !n.titleEn
        var nTitle = zh ? (n.title || '') : (n.titleEn || n.title || '')
        var nMsg = zh ? (n.message || '') : (n.messageEn || n.message || '')
        var isUrgent = n.level === 'urgent'
        var accent = isUrgent ? 'var(--dsw-alias-state-error-primary, #e5534b)' : 'var(--dsw-alias-brand-primary, #4f7cff)'
        var noticeButton = h('button', { 'data-dam-slot': 'actions', 'data-dam-btn': '', style: close, onClick: function () {
          try {
            var arr = []
            try { arr = JSON.parse(localStorage.getItem('dsh-auto-memory.seenNotices') || '[]') } catch (e3) {}
            if (n.id && arr.indexOf(n.id) < 0) arr.push(n.id)
            localStorage.setItem('dsh-auto-memory.seenNotices', JSON.stringify(arr))
          } catch (e3) {}
          closeDialog()
        } }, t('gotIt'))
        var noticeChildren = [
          h('div', { style: Object.assign({}, head, isUrgent ? { color: accent } : {}) }, nTitle),
          h('div', { style: { fontSize: 'calc(12px * var(--dam-scale))', lineHeight: 1.6, opacity: .92, whiteSpace: 'pre-wrap', marginTop: '4px' } }, nMsg),
          h('div', { style: { display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '6px' } },
            n.link ? h('a', { href: n.link, target: '_blank', rel: 'noreferrer', style: Object.assign({}, close, { textDecoration: 'none' }) }, t('noticeOpen')) : null,
            noticeButton),
        ]
        return h('div', { style: overlay },
          h('div', { style: box },
            DamIntroBox(noticeChildren)))
      }
      if (dialogState.kind === 'welcomeBack') {
        return h('div', { style: overlay },
          h('div', { style: box },
            h('div', { style: head }, t('awayTitle')),
            h('div', { style: { fontSize: 'calc(12px * var(--dam-scale))', lineHeight: 1.6, opacity: .92, marginTop: '4px' } }, t('awayMsg')),
            h('div', { style: { display: 'flex', justifyContent: 'flex-end', marginTop: '6px' } },
              h('button', { 'data-dam-slot': 'actions', 'data-dam-btn': '', style: close, onClick: closeDialog }, t('gotIt')))))
      }
      if (dialogState.kind === 'summary') {
        var sum = dialogState.summary || {}
        return h('div', { style: overlay },
          h('div', { style: box },
            h('div', { style: head }, t('sumTitle') + ' ' + (sum.time || '')),
            h('div', { style: { fontSize: 'calc(12px * var(--dam-scale))', lineHeight: 1.6, opacity: .92, whiteSpace: 'pre-wrap', marginTop: '4px' } }, sum.summary || ''),
            (sum.works || []).slice(0, 6).map(function (w) {
              return h('div', { style: item }, h('span', { style: dot }), w.title || '')
            }),
            h('div', { style: { display: 'flex', justifyContent: 'flex-end', marginTop: '6px' } },
              h('button', { 'data-dam-slot': 'actions', 'data-dam-btn': '', style: close, onClick: closeDialog }, t('gotIt')))))
      }
      if (dialogState.kind === 'semSetup') {
        // 打开即自动检测引导卡(0.1.37,#14 后续):快检+深扫仍未就绪时推荐补装/一键下载;
        // 深扫命中已热接入则报喜(即时生效)。关闭 = 24h 免打扰,不反复打扰。
        var sd = dialogState.result || {}
        var sdZh = locale === 'zh'
        var sdBody = { fontSize: 'calc(12px * var(--dam-scale))', lineHeight: 1.6, opacity: .92, whiteSpace: 'pre-wrap', marginTop: '4px' }
        var sdRows = []
        var sdActions = []
        var sdCmd = 'pnpm approve-builds\npnpm add @huggingface/transformers\n# 然后重启 dsh web'
        var sdSnooze = function () {
          try { localStorage.setItem('dsh-auto-memory.semDetectSnoozeUntil', String(Date.now() + 24 * 3600 * 1000)) } catch (eSn) {}
          closeDialog()
        }
        if (sd.deep && sd.deep.integrated) {
          sdRows.push(h('div', { style: sdBody }, sdZh
            ? '检测到你已安装推理库 @huggingface/transformers（常规路径此前未识别，深度扫描已命中并自动接入）。语义检索 C2 现在即可用，无需重启。'
            : 'Your installed @huggingface/transformers was found by the deep scan and hot-wired automatically. The C2 semantic tier is ready now — no restart needed.'))
        } else {
          if (sd.recommendation === 'install-peer' || sd.recommendation === 'setup-both') {
            sdRows.push(h('div', { style: sdBody }, sdZh
              ? (sd.recommendation === 'setup-both' ? '语义模型与推理库都未检测到。推理库请在安装 dsh-auto-memory 的同一目录（dsh profile）执行：' : '语义模型已下载，但推理库缺失（已含深度扫描）。请在安装 dsh-auto-memory 的同一目录（dsh profile）执行：')
              : (sd.recommendation === 'setup-both' ? 'Neither the model assets nor the inference runtime were found. For the runtime, run in the directory where dsh-auto-memory is installed (the dsh profile):' : 'Model assets found, but the inference runtime is missing (deep scan included). Run in the directory where dsh-auto-memory is installed (the dsh profile):')))
            sdActions.push(h('button', { 'data-dam-slot': 'actions', 'data-dam-btn': '', style: close, onClick: function () {
              try { if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(sdCmd) } catch (eCp) {}
            } }, sdZh ? '复制命令' : 'Copy commands'))
          }
          if (sd.recommendation === 'download-model' || sd.recommendation === 'setup-both') {
            sdRows.push(h('div', { style: sdBody }, sdZh
              ? '语义模型（内置 JS 档，约 135MB，一次即可）可一键后台下载，下载完成后语义检索自动启用：'
              : 'The built-in JS semantic model (~135MB, one-time) can be downloaded in the background; the semantic tier enables itself once done:'))
            sdActions.push(h('button', { 'data-dam-slot': 'actions', 'data-dam-btn': '', 'data-primary': 'true', style: close, onClick: function () {
              apiPost(API.semanticDownload, { action: 'start', mirror: 'auto' }).catch(function () {})
              try { localStorage.setItem('dsh-auto-memory.semDetectSnoozeUntil', String(Date.now() + 24 * 3600 * 1000)) } catch (eSn2) {}
              closeDialog()
            } }, sdZh ? '立即下载' : 'Download now'))
          }
        }
        return h('div', { style: overlay },
          h('div', { style: box },
            h('div', { style: head }, sdZh ? '自动记忆引擎检测' : 'Memory engine check'),
            sdRows,
            h('div', { style: { display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '6px' } },
              sdActions,
              h('button', { 'data-dam-slot': 'actions', 'data-dam-btn': '', style: close, onClick: (sd.deep && sd.deep.integrated) ? closeDialog : sdSnooze }, t('gotIt')))))
      }
      var versions = dialogState.versions || []
      var lastV = versions.length ? versions[versions.length - 1].version : ''
      return h('div', { style: overlay },
        h('div', { style: box },
          // 右上 ✕ 关闭(与小卡 46vh 裁剪下的底部按钮互为兜底——否则内容溢出时按钮不可达,弹窗关不掉)
          h('button', { 'data-dam-slot': 'actions', 'data-dam-btn': '', title: t('close'), onClick: function () {
            // 0.1.39:关闭时把 seenVersion 记为 currentVersion(分发时传的当前安装版本),
            // 而非卡片 lastV——0.1.30 大更新单卡的 lastV 恒 '0.1.30',会把 seen 钉回旧版本,
            // 导致「每次打开都弹更新日志」(seen≠current 无限重弹)。
            try { var seenV = (dialogState && dialogState.currentVersion) || lastV; if (seenV) localStorage.setItem('dsh-auto-memory.seenVersion', seenV) } catch (eX) {}
            closeDialog()
          }, style: { position: 'absolute', top: '8px', right: '10px', zIndex: 5, fontSize: 'calc(13px * var(--dam-scale))', opacity: .6 } }, '✕'),
          DamIntroBox([
            h('div', { style: head }, t('updateTitle') + ' v' + lastV),
            h('div', { style: sub }, t('updateSub')),
            versions.map(function (v) {
              var items = (v.items && (v.items[locale] || v.items.zh)) || []
              return h('div', null,
                h('div', { style: { fontSize: 'calc(13px * var(--dam-scale))', fontWeight: 700, margin: '6px 0 2px', opacity: .9 } }, 'v' + v.version),
                items.map(function (it) { return h('div', { style: item }, h('span', { style: dot }), it) }))
            }),
            h('button', { 'data-dam-slot': 'actions', 'data-dam-btn': '', style: close, onClick: function () {
              // 同 ✕:写 currentVersion 而非 lastV(见上方 0.1.39 说明)
              try { var seenV2 = (dialogState && dialogState.currentVersion) || lastV; if (seenV2) localStorage.setItem('dsh-auto-memory.seenVersion', seenV2) } catch (e3) {}
              closeDialog()
            } }, t('gotIt'))])))
    }