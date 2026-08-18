/* dsh-auto-memory — browser half (hand-written __ModuleLoader__ bundle).
 * Registers three additive surfaces:
 *   1. sidebar.footer.action — 「记忆」入口按钮(开关左下角浮层面板)
 *   2. shell.overlay         — 记忆面板:概览 / 日志 / 笔记 / 反思 / 检索
 *                              液态玻璃视觉(backdrop-filter + --dsw-alias-* 主题令牌),
 *                              可拖动 / 右下角缩放 / 开关缩放动画 / 位置大小持久化。
 *   3. settings.section      — 自动记忆设置页(存储位置、注入、反思风格)
 * Data flows over /api/dsh-auto-memory/* (loopback-only host routes).
 */
console.log('[dsh-auto-memory] client v0.1.13 fingerprint: drawer-summary-ok')
window.__ModuleLoader__.load({
  id: '@a9i5k4/dsh-auto-memory',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    var React = require('react')
    var h = React.createElement
    var useState = React.useState
    var useEffect = React.useEffect
    var useReducer = React.useReducer
    var useRef = React.useRef

    // ───────────────────────── 控制器 ─────────────────────────
    var listeners = new Set()
    var panelOpen = false
    var panelClosing = false
    var closeTimer = null
    // 几何状态:left/top/width/height,持久化到 localStorage(用户可拖动/缩放)
    var GEOM_KEY = 'dsh-auto-memory.panel.geom'
    var DEFAULT_W = 440
    var DEFAULT_H = 560
    var DEFAULT_GAP = 16
    function defaultGeom() {
      var vh = window.innerHeight || 800
      return {
        left: DEFAULT_GAP,
        top: Math.max(DEFAULT_GAP, vh - DEFAULT_H - DEFAULT_GAP),
        width: DEFAULT_W,
        height: DEFAULT_H,
      }
    }
    var geom = null
    function clampGeom(g) {
      var vw = window.innerWidth || 1280
      var vh = window.innerHeight || 800
      var w = Math.max(300, Math.min(g.width || DEFAULT_W, vw - DEFAULT_GAP * 2))
      var h = Math.max(240, Math.min(g.height || DEFAULT_H, vh - DEFAULT_GAP * 2))
      return {
        left: Math.max(DEFAULT_GAP, Math.min(g.left !== undefined ? g.left : DEFAULT_GAP, vw - w - DEFAULT_GAP)),
        top: Math.max(DEFAULT_GAP, Math.min(g.top !== undefined ? g.top : DEFAULT_GAP, vh - h - DEFAULT_GAP)),
        width: w,
        height: h,
      }
    }
    function loadGeom() {
      try {
        var raw = localStorage.getItem(GEOM_KEY)
        if (raw) return clampGeom(JSON.parse(raw))
      } catch (e) {}
      return clampGeom(defaultGeom())
    }
    function persistGeom() { if (geom) { try { localStorage.setItem(GEOM_KEY, JSON.stringify(geom)) } catch (e) {} } }
    function emit() { listeners.forEach(function (fn) { try { fn() } catch (e) {} }) }
    var controller = {
      isOpen: function () { return panelOpen },
      isClosing: function () { return panelClosing },
      geom: function () { if (!geom) geom = loadGeom(); return geom },
      setGeom: function (partial) {
        var cur = controller.geom()
        geom = clampGeom({
          left: partial.left !== undefined ? partial.left : cur.left,
          top: partial.top !== undefined ? partial.top : cur.top,
          width: partial.width !== undefined ? partial.width : cur.width,
          height: partial.height !== undefined ? partial.height : cur.height,
        })
        emit()
      },
      flushGeom: function () { persistGeom() },
      resetGeom: function () { geom = clampGeom(defaultGeom()); persistGeom(); emit() },
      toggle: function () { if (panelOpen) controller.close(); else controller.open() },
      open: function () {
        if (closeTimer) { clearTimeout(closeTimer); closeTimer = null }
        panelOpen = true; panelClosing = false; emit()
      },
      close: function () {
        if (!panelOpen || panelClosing) return
        panelClosing = true; emit()
        closeTimer = setTimeout(function () {
          panelOpen = false; panelClosing = false; closeTimer = null; emit()
          // 面板关闭时记录本次活动时间:离开>1小时再回来时自动弹开+欢迎语
          try { localStorage.setItem('dsh-auto-memory.lastActive', String(Date.now())) } catch (e) {}
        }, 170)
      },
      subscribe: function (fn) { listeners.add(fn); return function () { listeners.delete(fn) } },
    }

    // ───────────────────────── 国际化 ─────────────────────────
    var I18N = {
      zh: {
        loading: '加载中…',
        memoryPanel: '记忆面板',
        memory: '记忆',
        autoMemory: '自动记忆',
        overview: '概览', logs: '日志', notes: '笔记', reflections: '反思', connect: '接续', calendar: '日历', search: '检索', workspaces: '工作区',
        wsGenerating: '正在生成各工作区总结(每个工作区一次 AI 调用,可能稍慢)…', wsNone: '未发现带记忆的工作区', wsNoSummary: '(无总结)', wsOverview: '工作区总结(跨工作区)',
        debugCenter: '调试中心', dbgLoading: '加载诊断信息…', dbgRefresh: '刷新', dbgRefreshing: '刷新中…',
        fMemoryRoot: '记忆根目录', fMemoryRootHint: '集中式存储:所有工作区记忆统一放在此目录下(每工作区一个子目录),旧版分散的记忆会自动迁移。',
        fBrowse: '浏览…', browseTitle: '选择记忆根目录', fUp: '上级', fSelectDir: '选择此目录',
        pickedDir: '已选择目录:', rememberSave: '(点击「保存设置」后生效)', pickerUnavailable: '系统文件夹选择器不可用,改用内嵌浏览。',
        fDayBoundary: '日界(分钟)', fDayBoundaryHint: '从 0 点起算:凌晨在此之前的活儿归前一天。默认 450=早上 7:30 进入新一天;改 480=8:00;0=按午夜切日。',
        fVersion: '插件版本', checkUpdate: '检查更新', checking: '检查中…', upToDate: '(已是最新)', hasUpdate: '(有新版本)', versionError: '版本检查失败: ', versionCmdHint: '更新命令: cd ~/.dsh/profiles/web && pnpm up @a9i5k4/dsh-auto-memory,然后重启 dsh web 生效。',
        updateNow: '一键更新', updating: '更新中…', updateDone: '更新完成,请重启 dsh web 生效。', updateFailed: '更新失败: ', devLinkHint: '(当前为本地开发链接,请直接同步开发源码)', noProfileHint: '(未找到 dsh profile,无法自动更新)',
        kvVersion: '插件版本', kvUnreadable: '(读不到)', kvPid: 'PID / 启动', kvRestart: 'Host 需重启?', kvRestartYes: '是(代码比进程新)', kvRestartNo: '否',
        kvHeartbeat: '轮询心跳', hbAliveAgo: '存活(上次 ', hbSecAgo: ' 秒前)', hbAlive: '存活', hbNone: '无心跳文件',
        kvQueue: '沉淀重试队列', kvCountSuffix: ' 条', kvToday: '今日沉淀', kvRecentPrefix: ' 条 / 最近 ', kvBusy: '正在沉淀中', kvYes: '是', kvNo: '否',
        kvAvail: '可用', kvUnavail: '不可用', kvDup: '项目笔记重复标题', kvDupCount: ' 个',
        kvMem: '记忆文件', kvMemUser: '用户', kvMemNotes: '笔记', kvMemLog: '日志', kvMemMissing: '缺失',
        kvWs: '当前工作区', kvWsUnknown: '(未取到)', kvApi: 'API 连通', unknown: '(未知)',
        guideTitle: '欢迎使用 dsh-auto-memory', guideSub: '这个插件能干什么:',
        gFeat1: '三层记忆自动注入与检索:用户级 / 项目笔记 / 每日日志,每轮对话自动读、自动写',
        gFeat2: '每轮对话结束自动沉淀:修了什么 bug、做了哪些决策,自动按主题写进今日日志',
        gFeat3: 'AI 时段问候与三级抽屉:打开「记忆」面板,AI 按时段向你汇报当天进展',
        gFeat4: '智能检索与日历:自然语言提问找记忆;AI 自动把 deadline 记进日历并提醒',
        gFeat5: '接续其他 AI 工具的记忆:CodeBuddy / Claude Code / Codex 等的历史记忆一键接入',
        gFeat6: '自动检查更新:启动时检测新版本,设置页可一键更新',
        guideTip: '打开侧边栏「记忆」按钮即可使用;所有记忆都是本地明文文件,可随时查看修改。',
        updateTitle: 'dsh-auto-memory 已更新', updateSub: '本次更新内容:', gotIt: '知道了', noticeOpen: '了解更多',
        refresh: '刷新', refreshing: '刷新中…', close: '关闭', dragMove: '拖动移动', dragResize: '拖动调整大小', resetPos: '恢复默认位置',
        generated: '已生成', failed: '失败: ',
        generatedAt: '生成于 ',
        pointsCount: ' 项', summarizing: 'AI 总结生成中…', summaryFailed: 'AI 总结生成失败,点 ⟳ 重试',
        pendingReflection: '待生成反思: ',
        pendingReflectionHint: ' —— 可点下方「一键反思」立即生成。',
        todayWork: '今日工作', logEntries: ' 条日志',
        autoSettledToday: '今日已自动沉淀 ', autoSettledSuffix: ' 条要点',
        autoSettledRecent: '最近: ', autoSettledNone: '本轮对话暂无自动沉淀',
        dailyReflection: '每日反思', notYet: '(还没有)',
        workspace: '工作区',
        reflecting: '反思生成中…', oneClickReflect: '一键反思',
        reflectHint: '用最近日志自动生成反思',
        quickLinks: '快捷入口:日志页签看每日记录 · 笔记页签追加项目笔记 · 接续页签接入其他 AI 记忆 · 检索页签全文搜索。',
        collapseTech: '收起技术信息 ▴', expandTech: '技术信息 ▾',
        userMemory: '用户级记忆', projectNotes: '项目笔记', todayLog: '今日日志', configFile: '配置文件',
        readFailed: '读取失败: ', ok: '正常', refreshTime: '刷新时间', notYetShort: '尚未',
        empty: '(空)', back: '← 返回', view: '查看',
        clickDateViewLog: '点击日期查看当日日志(append-only):',
        userMemoryBlock: '用户记忆(用户画像 · 跨项目):', userMemoryEmpty: '(空)', userMemoryTruncated: '(内容过长,已截断显示)',
        appended: '已追加', notesPathLabel: '项目笔记: ',
        notesPlaceholder: '想追加到项目笔记的内容…(保存时自动带日期标题)',
        saving: '保存中…', append: '追加',
        notesHint: '建议直接用对话让 agent 调 memory_note;此处为手动追加。',
        reflectionTitle: '反思 ', generating: '生成中…',
        reflectAutoHint: '自动用最近日志生成反思草稿(便于测试)',
        noReflection: '还没有反思。每天第一次会话时,agent 会主动呈现前一天的工作反思。',
        searchFailed: '检索失败: ', searchPlaceholder: '搜记忆:关键词或自包含描述…', searchBtn: '检索', resultTitle: '结果',
        smartSearch: '智能检索', smartAnswer: '智能回答', keywordsLabel: '关键词: ',
        projectFiles: '项目文件', aiAssistant: 'AI 助手',
        imported: '接入完成', importing: '正在接入 ', importingSuffix: ' 个源…', allImported: '全部接入完成',
        noExternal: '未检测到其他 AI 工具的记忆文件(CodeBuddy/Claude Code/Codex 等)。',
        sessionSource: '会话源:共 ', sessionSourceSuffix: ' 个会话文件,用 memory_recall 按需检索',
        importingOne: '接入中…', importToNotes: '接入项目笔记', importToUser: '接入用户记忆',
        disabled: ' · 已停用', filesCount: ' 个文件 · ',
        connectHint: '把其他 AI 工具(CodeBuddy / Claude Code / Codex / 项目约定文件等)积累的记忆接入当前 DSH 工作。接入后内容写入本地记忆并自动标注来源,后续会随会话自动注入。',
        importAll: '一键接入全部', rescan: '重新扫描',
        styleAuto: '由内容决定', styleLife: '生活化', styleProfessional: '专业性',
        todayGreetingTitle: '问候',
        yesterdayTimeline: '昨天(', pendingReflectionShort: '昨天的工作还没复盘(',
        saved: '已保存',
        settingsHeader: '记忆存储与行为设置(保存到 DSH 主目录 dsh-auto-memory.json):',
        fFontSize: '界面字号', fFontSizeHint: '记忆面板文字大小(立即生效,仅本机)', fsSm: '小', fsMd: '标准', fsLg: '大', fsXl: '特大',
        fUserDir: '用户记忆目录', fUserDirHint: '跨项目规则存放处,支持 ~ 开头;需有文件写权限。',
        fProjectDir: '项目记忆目录', fProjectDirHint: '相对各工作区的目录名(默认 .dsh-memory)。',
        fInject: '注入记忆上下文', fInjectHint: '每次组装提示词时自动注入 <memory_system> 块。',
        fBudget: '注入预算(字符)', fBudgetHint: '记忆块总预算,超出部分截断。',
        fDays: '注入最近日志天数', fDaysHint: '会话开始时注入最近 N 天的工作日志尾部。默认 1。',
        fExtBudget: '外部记忆注入预算(字符)', fExtBudgetHint: '外部记忆来源在上下文中的注入预算。默认 1400(路径模式下影响有限)。',
        fConsolidateMin: '自动沉淀内容门槛(字符)', fConsolidateMinHint: '本轮 user+assistant 总字符低于此值视为寒暄跳过。默认 240。',
        fAway: '暂离阈值(分钟)', fAwayHint: '距上次活动超过该值视为暂离,回归时自动弹出记忆窗口。默认 60。',
        fAutoConsolidate: '自动沉淀(每轮对话结束AI评估)', fAutoConsolidateHint: '关闭后每轮对话结束不再自动调用 AI 评估与写入今日日志。',
        fConsolidate: '自动沉淀间隔(分钟)', fConsolidateHint: '两轮自动沉淀之间的最短间隔。默认 30;非工作时间(22:00-08:00)自动翻倍,避免短时间耗尽每日额度。',
        fConsolidateMax: '自动沉淀每日额度(次)', fConsolidateMaxHint: '每天最多触发自动沉淀的次数,到点后当天不再调用。默认 8。',
        fAutoSum: '自动总结时间点(HH:MM,逗号分隔)', fAutoSumHint: '到点自动生成本时段总结并弹窗展示,如 12:00,18:00,22:00。空=关闭。',
        awayTitle: '欢迎回来', awayMsg: '你离开的这段时间,我已经帮你把日志整理好了。记忆窗口已打开,可以看看这段时间的状况。',
        sumTitle: '时段总结',
        fReflect: '每日反思', fReflectHint: '昨天有工作日志时,会话首轮主动呈现昨日反思。',
        fStyle: '反思风格', fStyleHint: '生活化 / 专业性 / 由内容决定。',
        fLocale: '界面语言', fLocaleHint: '默认跟随 DSH 系统语言;也可手动指定中文 / English。', followSystem: '跟随系统语言',
        saveSettings: '保存设置',
        zh: '中文', en: 'English',
        calendar: '日历', addItem: '添加', save: '保存', cancel: '取消', needTitle: '请填写事项标题', itemTitle: '事项标题…',
        segMorning: '早晨', segForenoon: '上午', segNoon: '中午', segAfternoon: '下午', segEvening: '晚上',
        segPrefix: '今日', segMorningHint: '(昨日摘要)',
        welcomeBack: '欢迎回来!这段时间你完成了这些工作:',
        yesterdayDrawer: '昨天',
        greetMorning: '新的一天开始啦,先看看昨天做了什么。', greetForenoon: '上午好,今天也在稳步推进。', greetNoon: '中午好,歇口气再继续。', greetAfternoon: '下午好,下午也要元气满满。', greetEvening: '晚上好,辛苦一天了。',
        greetSummary: '今天已经完成了 ', greetThings: ' 件工作,点开看看:',
        qUrgentImportant: '重要紧急', qImportant: '重要不紧急', qUrgent: '紧急不重要', qNone: '不重要不紧急', qUncategorized: '未分类',
      },
      en: {
        loading: 'Loading…',
        memoryPanel: 'Memory Panel',
        memory: 'Memory',
        autoMemory: 'Auto Memory',
        overview: 'Overview', logs: 'Logs', notes: 'Notes', reflections: 'Reflections', connect: 'Connect', calendar: 'Calendar', search: 'Search', workspaces: 'Workspaces',
        wsGenerating: 'Generating per-workspace summaries (one AI call each, may take a while)…', wsNone: 'No workspace with memory found', wsNoSummary: '(no summary)', wsOverview: 'Workspace summaries (all workspaces)',
        debugCenter: 'Debug Center', dbgLoading: 'Loading diagnostics…', dbgRefresh: 'Refresh', dbgRefreshing: 'Refreshing…',
        fMemoryRoot: 'Memory root', fMemoryRootHint: 'Centralized storage: all workspace memories live here (one subdir per workspace); legacy memories are auto-migrated.',
        fBrowse: 'Browse…', browseTitle: 'Choose memory root', fUp: 'Up', fSelectDir: 'Select this folder',
      pickedDir: 'Selected folder:', rememberSave: '(click Save to apply)', pickerUnavailable: 'Native folder picker unavailable, falling back to in-app browser.',
      fDayBoundary: 'Day boundary (minutes)', fDayBoundaryHint: 'Minutes from midnight: work before it counts as the previous day. Default 450 = 7:30 AM starts the new day; 480 = 8:00; 0 = midnight cut.',
      fVersion: 'Plugin version', checkUpdate: 'Check for updates', checking: 'Checking…', upToDate: '(up to date)', hasUpdate: '(update available)', versionError: 'Version check failed: ', versionCmdHint: 'Update: cd ~/.dsh/profiles/web && pnpm up @a9i5k4/dsh-auto-memory, then restart dsh web.',
      updateNow: 'Update now', updating: 'Updating…', updateDone: 'Update finished, restart dsh web to apply.', updateFailed: 'Update failed: ', devLinkHint: '(local dev link, sync source instead)', noProfileHint: '(no dsh profile found, cannot auto-update)',
      kvVersion: 'Plugin version', kvUnreadable: '(unreadable)', kvPid: 'PID / Started', kvRestart: 'Host restart needed?', kvRestartYes: 'yes (code newer than process)', kvRestartNo: 'no',
      kvHeartbeat: 'Heartbeat', hbAliveAgo: 'alive (last ', hbSecAgo: ' s ago)', hbAlive: 'alive', hbNone: 'no heartbeat file',
      kvQueue: 'Consolidation retry queue', kvCountSuffix: ' item(s)', kvToday: 'Consolidated today', kvRecentPrefix: ' item(s) / latest ', kvBusy: 'Consolidating now', kvYes: 'yes', kvNo: 'no',
      kvAvail: 'available', kvUnavail: 'unavailable', kvDup: 'Duplicate note headings', kvDupCount: '',
      kvMem: 'Memory files', kvMemUser: 'user', kvMemNotes: 'notes', kvMemLog: 'log', kvMemMissing: 'missing',
      kvWs: 'Current workspace', kvWsUnknown: '(unknown)', kvApi: 'API probes', unknown: '(unknown)',
      guideTitle: 'Welcome to dsh-auto-memory', guideSub: 'What this plugin does:',
      gFeat1: 'Three-layer memory with automatic injection & retrieval: user / project notes / daily logs',
      gFeat2: 'Auto-consolidation after every turn: bugs fixed and decisions made are written into today\'s log automatically',
      gFeat3: 'AI period greetings with three-level drawers: open the Memory panel for a period-by-period digest',
      gFeat4: 'Smart search & calendar: ask in natural language; AI files deadlines into the calendar and reminds you',
      gFeat5: 'Inherit memories from other AI tools: CodeBuddy / Claude Code / Codex etc. in one click',
      gFeat6: 'Auto update check at boot, one-click update in settings',
      guideTip: 'Click the Memory button in the sidebar to start; all memories are plain local Markdown files you can inspect anytime.',
      updateTitle: 'dsh-auto-memory Updated', updateSub: 'What\'s new in this update:', gotIt: 'Got it', noticeOpen: 'Learn more',
        refresh: 'Refresh', refreshing: 'Refreshing…', close: 'Close', dragMove: 'Drag to move', dragResize: 'Drag to resize', resetPos: 'Reset position',
        generated: 'Generated', failed: 'Failed: ',
        generatedAt: 'Generated ',
        pointsCount: ' items', summarizing: 'AI summary generating…', summaryFailed: 'Summary failed, press refresh to retry',
        pendingReflection: 'Pending reflection: ',
        pendingReflectionHint: ' — click "One-click Reflect" below to generate now.',
        todayWork: 'Today', logEntries: ' log entries',
        autoSettledToday: 'Auto-consolidated ', autoSettledSuffix: ' points today',
        autoSettledRecent: 'Latest: ', autoSettledNone: 'Nothing auto-consolidated this turn',
        dailyReflection: 'Daily reflection', notYet: '(none yet)',
        workspace: 'Workspace',
        reflecting: 'Generating…', oneClickReflect: 'One-click Reflect',
        reflectHint: 'Auto-generate reflection from recent logs',
        quickLinks: 'Quick access: Logs tab for daily records · Notes tab to append project notes · Connect tab to import AI memories · Search tab for full-text search.',
        collapseTech: 'Collapse details ▴', expandTech: 'Details ▾',
        userMemory: 'User memory', projectNotes: 'Project notes', todayLog: 'Today log', configFile: 'Config file',
        readFailed: 'Read failed: ', ok: 'OK', refreshTime: 'Refreshed', notYetShort: 'never',
        empty: '(empty)', back: '← Back', view: 'View',
        clickDateViewLog: 'Click a date to view the daily log (append-only):',
        userMemoryBlock: 'User memory (profile · cross-project):', userMemoryEmpty: '(empty)', userMemoryTruncated: '(content truncated for display)',
        appended: 'Appended', notesPathLabel: 'Project notes: ',
        notesPlaceholder: 'Content to append to project notes…(date heading added on save)',
        saving: 'Saving…', append: 'Append',
        notesHint: 'Tip: ask the agent to call memory_note in chat; this is a manual fallback.',
        reflectionTitle: 'Reflection ', generating: 'Generating…',
        reflectAutoHint: 'Auto-generate a reflection draft from recent logs (for testing)',
        noReflection: "No reflections yet. On the first session each day, the agent presents the previous day's reflection.",
        searchFailed: 'Search failed: ', searchPlaceholder: 'Search memory: keyword or self-contained description…', searchBtn: 'Search', resultTitle: 'Results',
        smartSearch: 'Smart search', smartAnswer: 'AI Answer', keywordsLabel: 'Keywords: ',
        projectFiles: 'Project files', aiAssistant: 'AI Assistant',
        imported: 'Imported', importing: 'Importing ', importingSuffix: ' sources…', allImported: 'All imported',
        noExternal: 'No memory files found from other AI tools (CodeBuddy/Claude Code/Codex etc.).',
        sessionSource: 'Session source: ', sessionSourceSuffix: ' session files, search on demand with memory_recall',
        importingOne: 'Importing…', importToNotes: 'Import to notes', importToUser: 'Import to user memory',
        disabled: ' · disabled', filesCount: ' files · ',
        connectHint: 'Import memories accumulated by other AI tools (CodeBuddy / Claude Code / Codex / project convention files) into the current DSH workspace. Imported content is written to local memory with its source noted, and is auto-injected in future sessions.',
        importAll: 'Import all', rescan: 'Rescan',
        styleAuto: 'Auto', styleLife: 'Life-style', styleProfessional: 'Professional',
        todayGreetingTitle: 'Greeting',
        yesterdayTimeline: 'Yesterday (', pendingReflectionShort: 'Yesterday\'s work not reviewed (',
        saved: 'Saved',
        settingsHeader: 'Memory storage & behavior (saved to ~/.dsh/dsh-auto-memory.json):',
        fFontSize: 'Panel font size', fFontSizeHint: 'Memory panel text size (applies immediately, this device only)', fsSm: 'Small', fsMd: 'Normal', fsLg: 'Large', fsXl: 'Extra large',
        fUserDir: 'User memory dir', fUserDirHint: 'Cross-project rules; supports ~ prefix; needs write permission.',
        fProjectDir: 'Project memory dir', fProjectDirHint: 'Directory name relative to each workspace (default .dsh-memory).',
        fInject: 'Inject memory context', fInjectHint: 'Auto-inject <memory_system> block into every prompt.',
        fBudget: 'Injection budget (chars)', fBudgetHint: 'Total budget for the memory block; excess is truncated.',
        fDays: 'Recent days injected', fDaysHint: 'Inject tails of the last N days of work logs at session start. Default 1.',
        fExtBudget: 'External memory injection budget (chars)', fExtBudgetHint: 'Budget for external memory sources in context. Default 1400 (limited effect with path mode).',
        fConsolidateMin: 'Auto-consolidation content threshold (chars)', fConsolidateMinHint: 'Turns with fewer combined user+assistant chars are treated as chit-chat and skipped. Default 240.',
      fAway: 'Away threshold (minutes)', fAwayHint: 'Marked away when inactive longer than this; the memory panel auto-opens on return. Default 60.',
      fAutoConsolidate: 'Auto-consolidation (AI review each turn end)', fAutoConsolidateHint: 'When off, no automatic AI review or daily-log writes at turn end.',
      fConsolidate: 'Auto-consolidate interval (minutes)', fConsolidateHint: 'Minimum gap between auto-consolidations. Default 30; doubled automatically outside work hours (22:00-08:00).',
      fConsolidateMax: 'Daily auto-consolidate quota', fConsolidateMaxHint: 'Max auto-consolidation runs per day; no more runs after the quota is reached. Default 8.',
      fAutoSum: 'Auto summary times (HH:MM, comma-separated)', fAutoSumHint: 'Auto-generate and show a period summary at these times, e.g. 12:00,18:00,22:00. Empty = off.',
      awayTitle: 'Welcome back', awayMsg: 'While you were away, I tidied up your logs. The memory panel is open — take a look at what happened.',
      sumTitle: 'Period summary',
        fReflect: 'Daily reflection', fReflectHint: 'When yesterday has logs, the agent presents the reflection at session start.',
        fStyle: 'Reflection style', fStyleHint: 'Life-style / Professional / Auto.',
        fLocale: 'UI language', fLocaleHint: 'Follows the DSH system language by default; you can also pin Chinese / English.', followSystem: 'Follow system language',
        saveSettings: 'Save settings',
        zh: '中文', en: 'English',
        calendar: 'Calendar', addItem: 'Add', save: 'Save', cancel: 'Cancel', needTitle: 'Title is required', itemTitle: 'Item title…',
        segMorning: 'Morning', segForenoon: 'Forenoon', segNoon: 'Noon', segAfternoon: 'Afternoon', segEvening: 'Evening',
        segPrefix: 'Today ', segMorningHint: ' (yesterday summary)',
        welcomeBack: 'Welcome back! While you were away, you finished:',
        yesterdayDrawer: 'Yesterday',
        greetMorning: 'A fresh day! Let us look back at yesterday first.', greetForenoon: 'Good morning, steady progress today.', greetNoon: 'Good noon, take a break and keep going.', greetAfternoon: 'Good afternoon, keep up the good energy.', greetEvening: 'Good evening, well done today.',
        greetSummary: 'You have completed ', greetThings: ' things today. Tap to expand:',
        qUrgentImportant: 'Urgent & Important', qImportant: 'Important', qUrgent: 'Urgent', qNone: 'Neither', qUncategorized: 'Uncategorized',
      }
    }
    var locale = 'zh'
    var localeMode = 'system' // 'system'=跟随 DSH 系统语言 | 'zh' | 'en'
    var sysLocale = 'zh' // DSH 系统语言(跟随模式使用)
    function applyLocalePref(m) {
      if (m !== 'zh' && m !== 'en' && m !== 'system') m = 'system'
      localeMode = m
      var target = m === 'system' ? sysLocale : m
      if (locale !== target) { locale = target; localeListeners.forEach(function (fn) { try { fn() } catch (e) {} }) }
    }
    var sessions = null
    // 当前会话工作区(跟随 GUI 切换工作区):从 sessions 服务拿,供 state/summarize/greet 请求使用
    function currentWs() {
      try {
        var snap = sessions && sessions.list && sessions.list.getSnapshot()
        if (!snap) return ''
        var id = snap.current
        if (id === undefined || id === null) return ''
        var s = snap.byId && snap.byId[id]
        return (s && typeof s.cwd === 'string') ? s.cwd : ''
      } catch (e) { return '' }
    }
    var fontScale = 'lg'
    var FONT_SCALES = { sm: '小', md: '标准', lg: '大', xl: '特大' }
    var FONT_SCALE_VALUES = { sm: '0.9', md: '1', lg: '1.15', xl: '1.3' }
    var accentTheme = 'deepseek'
    var graphDensity = 'relaxed'
    var ACCENT_VALUES = { deepseek: '#1d4ed8', graphite: '#8b949e', violet: '#9b8cff' }
    try {
      var savedAccent = localStorage.getItem('dsh-auto-memory.accentTheme.v1')
      var savedDensity = localStorage.getItem('dsh-auto-memory.graphDensity.v1')
      if (ACCENT_VALUES[savedAccent]) accentTheme = savedAccent
      if (savedDensity === 'relaxed' || savedDensity === 'compact') graphDensity = savedDensity
    } catch (e) {}
    var localeListeners = new Set()
    function t(key) { return (I18N[locale] && I18N[locale][key]) || I18N.zh[key] || key }
    function setLocale(l) { if (l !== 'zh' && l !== 'en') return; if (l === locale) return; locale = l; localeListeners.forEach(function (fn) { try { fn(l) } catch (e) {} }) }
    function onLocale(fn) { localeListeners.add(fn); return function () { localeListeners.delete(fn) } }
    // 暂离检测:优先用 host 定时检测的 away 状态(阈值可配 awayMinutes),回退本地 lastActive 旧逻辑
    var hostAway = false
    var hostAwayReady = false
    function isAway() {
      if (hostAwayReady) return hostAway
      var lastSeen = 0
      try { lastSeen = Number(localStorage.getItem('dsh-auto-memory.lastActive') || 0) } catch (e) {}
      return lastSeen > 0 && (Date.now() - lastSeen) > 3600000
    }

    // ───────────────────────── 更新弹窗 / 首次指导 ─────────────────────────
    var CHANGELOG = {
      '0.1.28': { zh: [
        '脏 token 检查器(prion-scan 四类启发式整合):mojibake GBK 残骸特征表补全至 34 项(与 prion-scan.mjs 逐字一致),写入闸门新增 raw JSON envelope(memoryBlock/"uid"/updatedAt/"role")与 base64 残骸行拒写——外部 AI 工具画像无法再整段混入。',
        '新增「扫描脏 token」:设置页调试中心一键扫描用户级/项目笔记/每日日志/反思,按行区间返回 mojibake / raw JSON / 超长行 / base64 / 重复块报告(只给位置,不含正文)。',
      ], en: [
        'Dirty-token checker (prion-scan heuristics integrated): the GBK mojibake residue table is completed to 34 features (verbatim identical to prion-scan.mjs); the write gate now also rejects raw JSON envelopes (memoryBlock/"uid"/updatedAt/"role") and base64 residue lines — external AI tool profiles can no longer be pasted in wholesale.',
        'New "Scan dirty tokens": one-click scan of user/notes/log/reflection files in Settings → Debug Center, reporting mojibake / raw JSON / long lines / base64 / duplicate blocks by line range (location only, no content).',
      ] },
      '0.1.27': { zh: [
        '记忆卫生闸门(写端):memory_log/note/user 三个写入工具先过 sanitizeForWrite——疑似乱码(GBK 错误编码往返)/复读退化(词/字符循环,含跨标点)/连续重复行(≥3)拒绝并中文回执;append 单条上限 8000 字、replace 整篇 20 万字;追加前 tailHas 与文件尾部近 60 行做包含式复读去重。',
        '全写入口审计:唯一漏网=API.note(概览页手动追加)已补同套闸门,回归 42 用例全过。',
        '外部记忆接入只存路径指针,不再复制内容;注入端清洗乱码行/代码块/复读行;注入块加"记忆定位/读法"与语体纪律(条目一律第三人称客观陈述)。',
      ], en: [
        'Memory hygiene write gate: the three write tools (log/note/user) run through sanitizeForWrite — suspected mojibake (GBK round-trip), stutter degeneration (including punctuation-separated) and consecutive duplicate lines (≥3) are rejected with a reason; appends cap at 8,000 chars, rewrites at 200,000; appends are deduped against the last ~60 lines (tailHas).',
        'Full write-entry audit: the only leak (API.note manual append) now goes through the same gate; 42 regression cases all pass.',
        'External memory import records only path pointers; injection scrubs mojibake/code-block/stutter lines; the injected block adds "how to read memory" and the voice discipline (entries must be third-person objective statements).',
      ] },
      '0.1.20': { zh: [
        '修复:正式发布流程 cordis.patch.yml(loader 入口 id + 包名)转换事故——发布包与开发版 identity 完全隔离,不再互相撞车。',
      ], en: [
        'Fix: cordis.patch.yml conversion mishap in the release pipeline (loader entry id + package name) — published package identity is now fully isolated from the dev build.',
      ] },
      '0.1.26': { zh: [
        '文档:README 定位改为「技术先行 + 人性化」——intro 强调缓存友好三层记忆引擎,新增「底层工程」章节(前缀缓存友好/注入精简/AI限频/凭据过滤/跨工具),与「主动懂你的伙伴」章节互补。',
      ], en: [
        'Docs: README repositioned as tech-first with human touch — intro highlights the cache-friendly three-layer memory engine; a new "Under the hood" section (prefix-cache friendly / lean injection / rate-limited AI / credential filtering / cross-tool) complements the "companion that takes initiative" section.',
      ] },
      '0.1.25': { zh: [
        '文档:README 界面截图更新为最新实机截图(记忆面板概览/接续/日历/工作区导图/设置),中英双语说明。',
      ], en: [
        'Docs: README screenshots refreshed with the latest real captures (panel overview / connect / calendar / workspace mind map / settings) with bilingual captions.',
      ] },
      '0.1.24': { zh: [
        '记忆面板:全新液态玻璃 UI——模块箭头滚动、抽屉丝滑展开/收起、工作区 AI 思维导图(拖动画布+缩放)、日历当天时间轴(07:00-22:00)+地点/提醒字段。',
        '注入精简:只注入最近 1 天日志与反思精华,外部记忆改为绝对路径按需读取,新增 memory_read 工具;敏感段落(令牌/密钥)不再注入 prompt。',
        '接续页:按来源查看内容/接入/移除(笔记与用户级独立),已接入来源显示 ✓;不再整段注入外部记忆。',
        '设置页:全部参数可调(注入预算/天数/外部预算、自动沉淀开关/门槛/间隔/额度),浮动保存栏未保存时高亮。',
        '稳定性:修复对话结束时 host 卡死/崩溃(惰性投影移除、超时兜底、延迟启动),自动沉淀恢复正常并每日限频。',
      ], en: [
        'Memory panel: brand-new liquid-glass UI — arrow tab scrolling, smooth drawer transitions, AI workspace mind map (pan + zoom), day timeline (07:00-22:00) with location/reminder fields.',
        'Lean injection: only the last day of logs and a reflection digest; external memory is read by absolute path on demand via the new memory_read tool; credentials/tokens are filtered out of the prompt.',
        'Connect tab: per-source view/import/remove (notes vs user-level independently), imported sources show ✓; external memory is no longer injected in bulk.',
        'Settings: every parameter is now adjustable (injection budget/days/external budget, auto-consolidation toggle/threshold/interval/quota) with a floating save bar that highlights unsaved changes.',
        'Stability: fixed host freezes/crashes at turn end (lazy projection removed, timeout fallbacks, delayed start); auto-consolidation recovered with daily rate limiting.',
      ] },
      '0.1.23': { zh: [
        '修复:正式发布包首次欢迎文案仍显示“开发版”；发布转换与残留校验已加强，确保开发版和正式版身份完全隔离。',
      ], en: [
        'Fix: the published first-run guide still showed a dev label; release conversion and residual checks now enforce complete dev/release identity isolation.',
      ] },
      '0.1.22': { zh: [
        '修复:更新说明可能被公告、欢迎或自动总结弹窗覆盖，导致升级后没有看到 changelog。',
        '优化:更新说明现在优先展示并排队其他弹窗，只有点击“知道了”后才标记为已读；未确认时重启仍会再次显示。',
      ], en: [
        'Fix: the update changelog could be replaced by notice, welcome, or summary dialogs during startup.',
        'Polish: update notes now take priority and queue other dialogs; the version is marked seen only after acknowledgement, so it appears again after restart when unconfirmed.',
      ] },
      '0.1.21': { zh: [
        '上下文与缓存:动态记忆改为运行时快照，静态规则保持稳定；切换模型、跨天和记忆刷新不再反复击穿前缀缓存。',
        '记忆系统:三层记忆、普通检索与多关键词 recall、自动沉淀已完成运行时验证，写入、读取和检索链路稳定。',
        '可靠性与成本:修复重启后与会话消息提取问题；自动沉淀增加最小内容门槛、冷却时间、每日上限和反递归保护，减少无效子代理调用。',
      ], en: [
        'Context and cache: dynamic memory now uses runtime snapshots while static rules stay stable; model switches, day changes, and refreshes no longer repeatedly break prefix caching.',
        'Memory system: three-layer memory, standard search, multi-keyword recall, and auto-consolidation have passed runtime verification for writing, reading, and retrieval.',
        'Reliability and cost: fixed restart and session-message extraction issues; auto-consolidation now has a content threshold, cooldown, daily cap, and recursion guard to reduce unnecessary subagent calls.',
      ] },
      '0.1.19': { zh: [
        '稳定版:整合 0.1.16~0.1.19 全部修复与优化',
        '核心:上下文缓存策略重写——记忆注入迁至运行时上下文快照,系统提示词保持稳定,DeepSeek 前缀缓存全程命中,不再白白消耗 token(命中率恢复 95%+)',
        '新增:时间检测——暂离阈值可配置(回归自动弹出记忆窗口并欢迎),自动总结时间点(到点自动生成时段总结并弹窗展示),自动沉淀定时兜底恢复',
        '新增:动态通知中心——发布者重要提醒(重大 bug/升级建议)自动推送,无需等待发版',
        '修复:自动沉淀在重启恢复会话后失效(agent 引用定时恢复,双保险)',
        '提示:pnpm v11 默认限制安装发布不足 1 天的版本,想立即获取新版请在 pnpm-workspace.yaml 设 minimumReleaseAge: 0 或使用显式版本号',
      ], en: [
        'Stable release: consolidates 0.1.16~0.1.19 fixes and polish',
        'Core: context-cache strategy rewrite — memory injection moved to runtime-context snapshot, system prompt stays byte-stable, DeepSeek prefix cache hits throughout, no more wasted tokens (hit rate back to 95%+)',
        'New: time detection — configurable away threshold (auto-open memory panel with welcome on return), auto summary times (auto-generate period summary popup), timed fallback recovery for auto-consolidation',
        'New: dynamic notice center — publisher alerts (major bugs / upgrade advice) pushed automatically, no need to wait for a release',
        'Fix: auto-consolidation failing after restart-resumed sessions (agent reference restored by timer, double insurance)',
        'Note: pnpm v11 blocks packages published <1 day ago by default; set minimumReleaseAge: 0 in pnpm-workspace.yaml or use an explicit version for the latest immediately',
      ] },
      '0.1.18': { zh: [
        '稳定版:整合 0.1.13~0.1.17 全部修复与优化',
        '核心:上下文缓存策略重写——记忆注入迁至运行时上下文快照,系统提示词保持稳定,DeepSeek 前缀缓存全程命中,不再白白消耗 token(命中率恢复 95%+)',
        '修复:秒级时间戳击穿前缀缓存(改日期级)',
        '修复:npm 安装后客户端面板无法加载(bundle 注册名)',
        '新增:更新说明弹窗/首次安装指导/暂离回归自动打开记忆窗口/动态通知中心',
        '提示:pnpm v11 默认限制安装发布不足 1 天的版本,想立即获取新版请在 pnpm-workspace.yaml 设 minimumReleaseAge: 0 或使用显式版本号',
      ], en: [
        'Stable release: consolidates 0.1.13~0.1.17 fixes and polish',
        'Core: context-cache strategy rewrite — memory injection moved to runtime-context snapshot, system prompt stays byte-stable, DeepSeek prefix cache hits throughout, no more wasted tokens (hit rate back to 95%+)',
        'Fix: second-level timestamp breaking prefix cache (now date-level)',
        'Fix: client panel not loading after npm install (bundle registration id)',
        'New: update dialog / first-run guide / memory panel auto-opens after >1h away / dynamic notice center',
        'Note: pnpm v11 blocks packages published <1 day ago by default; set minimumReleaseAge: 0 in pnpm-workspace.yaml or use an explicit version for the latest immediately',
      ] },
      '0.1.17': { zh: [
        '新增:动态通知中心——插件自动拉取发布者的重要提醒(重大 bug/升级建议),特定时间窗口内显示,无需等待发版即可收到推送',
        '优化:0.1.14 及以下旧版本已全部弃用(缓存击穿浪费 token),升级到 0.1.16+ 彻底解决',
      ], en: [
        'New: dynamic notice center — the plugin auto-fetches publisher alerts (major bugs / upgrade advice), shown within the configured time window, no need to wait for a release',
        'Polish: all versions below 0.1.14 are deprecated (cache-breaking token waste); upgrade to 0.1.16+ fixes it',
      ] },
      '0.1.16': { zh: [
        '稳定版:整合今日 0.1.13~0.1.15 全部修复与优化',
        '核心:上下文缓存策略重写——记忆注入迁至运行时上下文快照,系统提示词保持稳定,DeepSeek 前缀缓存全程命中,不再白白消耗 token(命中率恢复 95%+)',
        '修复:秒级时间戳击穿前缀缓存(改日期级)',
        '修复:npm 安装后客户端面板无法加载(bundle 注册名)',
        '新增:更新说明弹窗/首次安装指导/暂离回归自动打开记忆窗口',
        '提示:pnpm v11 默认限制安装发布不足 1 天的版本,想立即获取新版请在 pnpm-workspace.yaml 设 minimumReleaseAge: 0 或使用显式版本号',
      ], en: [
        'Stable release: consolidates today\'s 0.1.13~0.1.15 fixes and polish',
        'Core: context-cache strategy rewrite — memory injection moved to runtime-context snapshot, system prompt stays byte-stable, DeepSeek prefix cache hits throughout, no more wasted tokens (hit rate back to 95%+)',
        'Fix: second-level timestamp breaking prefix cache (now date-level)',
        'Fix: client panel not loading after npm install (bundle registration id)',
        'New: update dialog / first-run guide / memory panel auto-opens after >1h away',
        'Note: pnpm v11 blocks packages published <1 day ago by default; set minimumReleaseAge: 0 in pnpm-workspace.yaml or use an explicit version for the latest immediately',
      ] },
      '0.1.15': { zh: ['优化:记忆注入迁至运行时上下文快照(systemPrompt.context),system prompt 保持字节级稳定 → DeepSeek 前缀缓存全程命中,自动沉淀/跨天/切换模型都不再击穿缓存,进一步降低 token 消耗', '优化:动态记忆内容不变时不重复注入,会话上下文更精简'], en: ['Optimize: memory injection moved to runtime-context snapshot (systemPrompt.context), system prompt stays byte-stable → DeepSeek prefix cache hits throughout, auto-consolidation/day-crossing/model-switch no longer break the cache, lower token usage', 'Optimize: unchanged dynamic memory is not re-injected, leaner session context'] },
      '0.1.14': { zh: ['新增:更新后自动弹出更新说明窗口,首次安装有功能指导窗口', '新增:暂离超过 1 小时回来,记忆窗口自动打开并显示 AI 总结', '优化:弹窗改为左下角毛玻璃小卡片,更透明更轻量'], en: ['New: update dialog shows what changed after an upgrade; first-run guide dialog for new installs', 'New: the memory panel auto-opens with an AI summary after returning from >1h away', 'Polish: dialogs are now compact frosted-glass cards in the bottom-left corner'] },
      '0.1.13': { zh: ['修复 npm 安装后客户端面板无法加载(bundle 注册名拼写)', '修复秒级时间戳击穿 DeepSeek 前缀缓存(改日期级,大幅节省 token)', '修复记忆接续导入报错'], en: ['Fix client panel not loading after npm install (bundle registration id)', 'Fix second-level timestamp breaking DeepSeek prefix cache (date-level now, big token savings)', 'Fix memory import error (inherit external memory)'] },
      '0.1.12': { zh: ['声明 @deepseek-ai/cordis 为 peerDependency(插件市场收录规范)'], en: ['Declare @deepseek-ai/cordis as peerDependency (plugin market checklist)'] },
      '0.1.11': { zh: ['界面语言跟随 DSH 系统语言,实时切换', 'README 重构:宣传图/真实截图/快速安装', '修复设置页加载崩溃'], en: ['UI language follows the DSH system language', 'README overhaul: banner, real screenshots, quick install', 'Fix settings page crash'] },
      '0.1.10': { zh: ['自动检查更新 + 设置页一键更新', '日界:凌晨的活儿归前一天(默认 7:30)', '记忆根目录系统文件夹选择器,换位置自动迁移', '每日写入预算,超限自动压缩旧内容', '30 天 AI 蒸馏'], en: ['Auto update check + one-click update in settings', 'Day boundary: late-night work logs to yesterday (default 07:30)', 'Native OS folder picker for memory root, auto-migration', 'Daily write budget with auto-compaction', '30-day AI distillation'] },
    }
    var dialogListeners = new Set()
    var dialogState = null // 当前展示的弹窗
    var dialogQueue = [] // 启动期多个异步弹窗按优先级排队,不相互覆盖
    function dialogPriority(d) {
      if (!d) return 0
      if (d.kind === 'update') return 100
      if (d.kind === 'first') return 90
      if (d.kind === 'notice') return d.notice && d.notice.level === 'urgent' ? 80 : 70
      if (d.kind === 'summary') return 60
      if (d.kind === 'welcomeBack') return 50
      return 10
    }
    function dialogKey(d) {
      if (!d) return ''
      if (d.kind === 'update') return 'update:' + (d.currentVersion || '')
      if (d.kind === 'notice') return 'notice:' + ((d.notice && d.notice.id) || '')
      if (d.kind === 'summary') return 'summary:' + ((d.summary && d.summary.date) || '') + ':' + ((d.summary && d.summary.time) || '')
      return d.kind
    }
    function notifyDialog() { dialogListeners.forEach(function (fn) { try { fn() } catch (e) {} }) }
    function openDialog(d) {
      if (!d) return
      var key = dialogKey(d)
      if ((dialogState && dialogKey(dialogState) === key) || dialogQueue.some(function (x) { return dialogKey(x) === key })) return
      if (!dialogState) dialogState = d
      else if (dialogPriority(d) > dialogPriority(dialogState)) { dialogQueue.unshift(dialogState); dialogState = d }
      else dialogQueue.push(d)
      notifyDialog()
    }
    function closeDialog() { dialogState = dialogQueue.shift() || null; notifyDialog() }
    function onDialog(fn) { dialogListeners.add(fn); return function () { dialogListeners.delete(fn) } }
    function cmpVersion(a, b) {
      var pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number)
      for (var i = 0; i < 3; i++) {
        var x = pa[i] || 0, y = pb[i] || 0
        if (x > y) return 1
        if (x < y) return -1
      }
      return 0
    }
    function changelogBetween(fromVer, toVer) {
      var keys = Object.keys(CHANGELOG).filter(function (v) { return cmpVersion(v, fromVer) > 0 && cmpVersion(v, toVer) <= 0 })
      keys.sort(function (a, b) { return cmpVersion(a, b) })
      return keys.map(function (v) { return { version: v, items: CHANGELOG[v] } })
    }

    // ───────────────────────── API ─────────────────────────
    var API = {
      state: '/api/dsh-auto-memory/state',
      list: '/api/dsh-auto-memory/list',
      file: '/api/dsh-auto-memory/file',
      recall: '/api/dsh-auto-memory/recall',
      smartRecall: '/api/dsh-auto-memory/smart-recall',
      workspaces: '/api/dsh-auto-memory/workspaces',
      debug: '/api/dsh-auto-memory/debug',
      scanDirty: '/api/dsh-auto-memory/scan-dirty',
      browseDir: '/api/dsh-auto-memory/browse-dir',
      pickDir: '/api/dsh-auto-memory/pick-dir',
      updateCheck: '/api/dsh-auto-memory/update-check',
      update: '/api/dsh-auto-memory/update',
      config: '/api/dsh-auto-memory/config',
      reflect: '/api/dsh-auto-memory/reflect',
      reflectAuto: '/api/dsh-auto-memory/reflect-auto',
      note: '/api/dsh-auto-memory/note',
      external: '/api/dsh-auto-memory/external',
      externalView: '/api/dsh-auto-memory/external-view',
      externalRemove: '/api/dsh-auto-memory/external-remove',
      externalImport: '/api/dsh-auto-memory/external-import',
      calendar: '/api/dsh-auto-memory/calendar',
      summarize: '/api/dsh-auto-memory/summarize',
      greet: '/api/dsh-auto-memory/greet',
      notices: '/api/dsh-auto-memory/notices',
    }
    function query(params) {
      var search = new URLSearchParams()
      for (var key in params) if (params[key] !== undefined && params[key] !== '') search.set(key, String(params[key]))
      var text = search.toString()
      return text ? '?' + text : ''
    }
    async function apiGet(path, params) {
      var res = await fetch(path + query(params))
      var body = await res.json().catch(function () { return {} })
      if (!res.ok) throw new Error(body.error || ('GET ' + path + ' → HTTP ' + res.status))
      return body
    }
    async function apiPost(path, payload) {
      var res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
      var body = await res.json().catch(function () { return {} })
      if (!res.ok) throw new Error(body.error || ('POST ' + path + ' → HTTP ' + res.status))
      return body
    }

    // ───────────────────────── 样式 ─────────────────────────
    // 视觉:液态玻璃(毛玻璃)—— backdrop-filter + DSH 主题令牌(--dsw-alias-*),
    // 跟随亮/暗主题与页面背景自适应;位置/尺寸由 JS 几何状态驱动(可拖动、可缩放)。
    var CSS = [
      '[data-dam-panel] { position: fixed; left: 16px; width: 440px; height: 560px; --dam-scale: 1;',
      '  max-width: calc(100vw - 32px); max-height: calc(100vh - 32px);',
      '  display: flex; flex-direction: column; overflow: hidden; z-index: 3000; pointer-events: auto;',
      '  border-radius: 16px; font: 13px/1.55 system-ui, "Segoe UI", sans-serif;',
      '  background: color-mix(in srgb, var(--dsw-alias-bg-overlay, rgba(255,255,255,.86)) 58%, transparent);',
      '  -webkit-backdrop-filter: blur(28px) saturate(1.55); backdrop-filter: blur(28px) saturate(1.55);',
      '  border: 1px solid color-mix(in srgb, var(--dsw-alias-border-l1, rgba(128,128,128,.35)) 65%, transparent);',
      '  box-shadow: 0 24px 64px rgba(0,0,0,.22), 0 4px 16px rgba(0,0,0,.10), inset 0 1px 0 rgba(255,255,255,.22);',
      '  color: var(--dsw-alias-label-primary, #1f2328);',
      '  animation: dam-in .2s cubic-bezier(.2,.9,.3,1.15) both; transform-origin: left bottom; }',
      '@keyframes dam-in { from { opacity: 0; transform: scale(.92) translateY(10px); } to { opacity: 1; transform: none; } }',
      '@keyframes dam-out { from { opacity: 1; transform: none; } to { opacity: 0; transform: scale(.95) translateY(6px); } }',
      '[data-dam-panel][data-closing="true"] { animation: dam-out .16s ease-in both; }',
      '[data-dam-panel][data-scale="sm"] { --dam-scale: .9; }',
      '[data-dam-panel][data-scale="lg"] { --dam-scale: 1.15; }',
      '[data-dam-panel][data-scale="xl"] { --dam-scale: 1.3; }',
      '[data-dam-panel]::before { content: ""; position: absolute; inset: 0 0 auto 0; height: 64%; pointer-events: none;',
      '  background: linear-gradient(180deg, rgba(255,255,255,.13), rgba(255,255,255,0) 70%); border-radius: 16px 16px 0 0; }',
      '[data-dam-panel][data-dragging="true"] { user-select: none; }',
      '[data-dam-panel] header { display: flex; align-items: center; gap: 8px; padding: 10px 14px; cursor: grab;',
      '  border-bottom: 1px solid color-mix(in srgb, var(--dsw-alias-border-l1, rgba(128,128,128,.25)) 55%, transparent); }',
      '[data-dam-panel][data-dragging="true"] header { cursor: grabbing; }',
      '[data-dam-panel] header strong { font-size: calc(14px * var(--dam-scale)); }',
      '[data-dam-panel] header .dam-spacer { flex: 1; }',
      '[data-dam-resize] { position: absolute; right: 0; bottom: 0; width: 22px; height: 22px; cursor: nwse-resize;',
      '  opacity: .55; z-index: 2; border-radius: 0 0 16px 0;',
      '  background: linear-gradient(135deg, transparent 50%, color-mix(in srgb, var(--dsw-alias-label-secondary, #666) 45%, transparent) 50%); }',
      '[data-dam-resize]:hover { opacity: 1; }',
      '[data-dam-btn] { border: none; background: transparent; cursor: pointer; color: inherit; opacity: .75; font-size: calc(13px * var(--dam-scale)); padding: 4px 8px; border-radius: 6px; }',
      '[data-dam-btn]:hover { opacity: 1; background: color-mix(in srgb, var(--dsw-alias-label-secondary, #666) 16%, transparent); }',
      '[data-dam-tabs-wrap] { display: flex; align-items: center; min-width: 0; border-bottom: 1px solid color-mix(in srgb, var(--dsw-alias-border-l1, rgba(128,128,128,.2)) 55%, transparent); }',
      '[data-dam-tabs] { flex: 1; min-width: 0; overflow: hidden; padding: 5px 4px; scrollbar-width: none; -ms-overflow-style: none; }',
      '[data-dam-tabs]::-webkit-scrollbar { display: none; }',
      '[data-dam-tab-strip] { display: flex; width: max-content; transition: transform .42s cubic-bezier(.22,.8,.2,1); will-change: transform; }',
      '[data-dam-tab] { flex: 0 0 auto; min-width: max-content; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; border: none; background: transparent; cursor: pointer; color: inherit; opacity: .68; padding: 6px 9px; border-radius: 7px; font-size: calc(12.5px * var(--dam-scale)); transition: color .25s ease, background .25s ease, opacity .25s ease, transform .25s ease; }',
      '[data-dam-tabs-arrow] { flex: 0 0 26px; height: 30px; border: 0; background: transparent; color: inherit; cursor: pointer; opacity: .55; font-size: 18px; }',
      '[data-dam-tabs-arrow]:hover:not(:disabled) { opacity: 1; background: color-mix(in srgb, var(--dam-accent, #2456c4) 16%, transparent); transform: scale(1.12); }',
      '[data-dam-tabs-arrow]:active:not(:disabled) { transform: scale(.92); }',
      '[data-dam-tab][data-active="true"] { position: relative; opacity: 1; background: var(--dam-accent, #2456c4); color: #fff; font-weight: 700; box-shadow: 0 3px 10px color-mix(in srgb, var(--dam-accent, #2456c4) 30%, transparent); transform: translateY(-1px); }',
      '[data-dam-tab][data-active="true"]::before { content: ""; position: absolute; left: 3px; top: 7px; bottom: 7px; width: 3px; border-radius: 3px; background: rgba(255,255,255,.9); }',
      '[data-dam-body] { flex: 1 1 auto; min-width: 0; min-height: 0; overflow: auto; padding: 16px; }',
      '[data-dam-settings] { display: grid; grid-template-columns: 92px minmax(0, 1fr); gap: 18px; min-height: 100%; }',
      '[data-dam-settings-nav] { position: sticky; top: 0; align-self: start; display: flex; flex-direction: column; gap: 4px; padding-top: 2px; }',
      '[data-dam-settings-nav] button { border: 0; background: transparent; color: inherit; text-align: left; padding: 8px 9px; border-radius: 8px; cursor: pointer; opacity: .58; font: inherit; font-size: calc(11.5px * var(--dam-scale)); }',
      '[data-dam-settings-nav] button[data-active="true"] { opacity: 1; color: var(--dam-accent, var(--dsw-alias-brand-primary, #4f7cff)); background: color-mix(in srgb, var(--dam-accent, #4f7cff) 11%, transparent); font-weight: 650; }',
      '[data-dam-settings-content] { min-width: 0; padding-bottom: 24px; }',
      '[data-dam-settings-group] { scroll-margin-top: 12px; padding-bottom: 22px; margin-bottom: 24px; border-bottom: 1px solid color-mix(in srgb, var(--dsw-alias-border-l1, #c5cbd3) 38%, transparent); }',
      '[data-dam-settings-group] h3 { margin: 0; color: var(--dsw-alias-label-primary, #1f2328); font-size: calc(14px * var(--dam-scale)); }',
      '[data-dam-settings-group] p { margin: 4px 0 14px; color: var(--dsw-alias-label-secondary, #68717d); font-size: calc(11.5px * var(--dam-scale)); line-height: 1.5; }',
      '[data-dam-settings-row] { padding: 10px 0; }',
      '[data-dam-savebar] { position: sticky; bottom: 0; z-index: 3; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 10px 14px; margin: 6px -16px -16px; background: color-mix(in srgb, var(--dsw-alias-bg-overlay, rgba(255,255,255,.92)) 74%, transparent); backdrop-filter: blur(16px) saturate(1.4); -webkit-backdrop-filter: blur(16px) saturate(1.4); border-top: 1px solid color-mix(in srgb, var(--dsw-alias-border-l1, #c5cbd3) 38%, transparent); border-radius: 0 0 14px 14px; transition: background .25s ease; }',
      '[data-dam-savebar] button { opacity: .5; transition: opacity .2s ease, background .2s ease, color .2s ease; }',
      '[data-dam-savebar] button[data-dirty="true"] { opacity: 1; background: var(--dam-accent, #1d4ed8); color: #fff; font-weight: 650; box-shadow: 0 3px 12px color-mix(in srgb, var(--dam-accent, #1d4ed8) 35%, transparent); }',
      '[data-dam-settings-row] > [data-dam-row] { margin-bottom: 3px; }',
      '[data-dam-graph-toolbar] { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-bottom: 1px solid color-mix(in srgb, var(--dsw-alias-border-l1, #c5cbd3) 38%, transparent); }',
      '[data-dam-graph-toolbar] input[type="range"] { flex: 1; min-width: 90px; accent-color: var(--dam-accent, #6b98ff); }',
      '[data-dam-graph] { position: relative; min-height: 420px; overflow: hidden; border: 1px solid color-mix(in srgb, var(--dsw-alias-border-l1, #c5cbd3) 42%, transparent); border-radius: 12px; background: color-mix(in srgb, var(--dsw-alias-bg-layer-1, #f5f6f7) 42%, transparent); }',
      '[data-dam-graph] { cursor: grab; }',
      '[data-dam-graph][data-panning="true"] { cursor: grabbing; user-select: none; }',
      '[data-dam-graph] svg { display: block; width: auto; max-width: none; height: auto; min-height: 520px; transform-origin: 0 0; }',
      '[data-dam-graph-node] { cursor: pointer; }',
      '[data-dam-graph-legend] { display: flex; gap: 12px; flex-wrap: wrap; margin: 10px 0 14px; color: var(--dsw-alias-label-secondary, #68717d); font-size: calc(11px * var(--dam-scale)); }',
      '[data-dam-legend-dot] { display: inline-block; width: 7px; height: 7px; border-radius: 50%; margin-right: 4px; background: var(--dam-accent, #4f7cff); }',
      '[data-dam-legend-dot="branch"] { background: #7d8793; }',
      '[data-dam-legend-dot="leaf"] { background: #b0b7c0; }',
      '[data-dam-kv] { display: grid; grid-template-columns: auto 1fr; gap: 4px 12px; font-size: calc(12.5px * var(--dam-scale)); }',
      '[data-dam-kv] b { opacity: .55; font-weight: 500; }',
      '[data-dam-card] { border: 1px solid color-mix(in srgb, var(--dsw-alias-border-l1, rgba(128,128,128,.22)) 60%, transparent); border-radius: 9px; padding: 8px 10px; margin-bottom: 8px; font-size: calc(12.5px * var(--dam-scale));',
      '  background: color-mix(in srgb, var(--dsw-alias-bg-layer-1, rgba(128,128,128,.06)) 40%, transparent); }',
      '[data-dam-card] .dam-date { font-weight: 600; margin-bottom: 4px; }',
      '[data-dam-card] .dam-content { white-space: pre-wrap; word-break: break-word; max-height: 220px; overflow: auto; }',
      '[data-dam-disclosure] { overflow: hidden; opacity: 0; max-height: 0; transform: translateY(-5px) scale(.985); transition: max-height .32s cubic-bezier(.22,.8,.2,1), opacity .2s ease, transform .28s cubic-bezier(.22,.8,.2,1); }',
      '[data-dam-disclosure][data-phase="open"] { opacity: 1; max-height: 1800px; transform: translateY(0) scale(1); }',
      '[data-dam-disclosure][data-phase="closing"] { opacity: 0; max-height: 0; transform: translateY(-5px) scale(.985); }',
      '[data-dam-card], [data-dam-banner] { animation: dam-rise .34s cubic-bezier(.22,.8,.2,1) both; }',
      '@keyframes dam-rise { from { opacity: 0; transform: translateY(7px) scale(.988); } to { opacity: 1; transform: translateY(0) scale(1); } }',
      '@media (prefers-reduced-motion: reduce) { [data-dam-tab-strip], [data-dam-tab], [data-dam-disclosure], [data-dam-card], [data-dam-banner] { transition: none !important; animation: none !important; } }',
      '[data-dam-calendar] { animation: dam-rise .34s cubic-bezier(.22,.8,.2,1) both; }',
      '[data-dam-calendar] [data-dam-calendar-day] { transition: transform .18s ease, border-color .2s ease, background .2s ease, box-shadow .2s ease; }',
      '[data-dam-calendar] [data-dam-calendar-day]:hover { transform: translateY(-1px); border-color: var(--dam-accent, #1d4ed8) !important; box-shadow: 0 4px 12px rgba(0,0,0,.08); }',
      '[data-dam-calendar-event] { animation: dam-event-in .25s cubic-bezier(.22,.8,.2,1) both; transition: transform .18s ease, filter .18s ease; }',
      '[data-dam-calendar-event]:hover { transform: translateX(2px); filter: brightness(1.06); }',
      '[data-dam-calendar-modal] { animation: dam-modal-in .26s cubic-bezier(.22,.8,.2,1) both; }',
      '@keyframes dam-event-in { from { opacity: 0; transform: translateX(-5px); } to { opacity: 1; transform: none; } }',
      '@keyframes dam-modal-in { from { opacity: 0; transform: translateY(10px) scale(.98); } to { opacity: 1; transform: none; } }',
      '[data-dam-banner] { border: 1px solid color-mix(in srgb, var(--dsw-alias-state-warn-primary, #e6a23c) 55%, transparent);',
      '  background: color-mix(in srgb, var(--dsw-alias-state-warn-primary, #e6a23c) 13%, transparent); border-radius: 9px; padding: 8px 10px; margin-bottom: 10px; font-size: calc(12.5px * var(--dam-scale)); }',
      '[data-dam-input], [data-dam-select] { width: 100%; box-sizing: border-box; background: color-mix(in srgb, var(--dsw-alias-bg-layer-1, rgba(128,128,128,.08)) 45%, transparent); color: inherit; border: 1px solid color-mix(in srgb, var(--dsw-alias-border-l1, rgba(128,128,128,.3)) 60%, transparent); border-radius: 7px; padding: 6px 8px; font: inherit; }',
      '[data-dam-row] { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }',
      '[data-dam-row] label { flex: 0 0 110px; opacity: .8; font-size: calc(12.5px * var(--dam-scale)); }',
      '[data-dam-hint] { opacity: .5; font-size: calc(11.5px * var(--dam-scale)); margin-top: 2px; }',
      '[data-dam-sidebar-btn] { display: flex; align-items: center; gap: 6px; width: 100%; border: none; background: transparent; color: inherit; cursor: pointer; padding: 6px 10px; border-radius: 8px; font: inherit; font-size: 13px; opacity: .8; }',
      '[data-dam-sidebar-btn]:hover { background: color-mix(in srgb, var(--dsw-alias-label-secondary, #666) 14%, transparent); opacity: 1; }',
      '[data-dam-sidebar-btn][data-active="true"] { opacity: 1; background: color-mix(in srgb, var(--dsw-alias-brand-primary, #4f7cff) 16%, transparent); color: var(--dsw-alias-brand-primary, #4f7cff); }',
      '[data-dam-error] { color: var(--dsw-alias-state-error-primary, #d64545); font-size: 12px; margin-top: 6px; white-space: pre-wrap; }',
      '[data-dam-muted] { opacity: .55; }',
      '[data-dam-loading] { display: flex; align-items: center; justify-content: center; gap: 9px; min-height: 96px; color: var(--dsw-alias-label-secondary, #7d8793); font-size: calc(12px * var(--dam-scale)); }',
      '[data-dam-spinner] { width: 18px; height: 18px; border: 2px solid color-mix(in srgb, var(--dam-accent, #4f7cff) 22%, transparent); border-top-color: var(--dam-accent, #4f7cff); border-radius: 50%; animation: dam-spin .8s linear infinite; }',
      '@keyframes dam-spin { to { transform: rotate(360deg); } }',
      '@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {',
      '  [data-dam-panel] { background: var(--dsw-alias-bg-overlay, #ffffff); } }',
    ].join('\n')
    var STYLE_ID = 'dsh-auto-memory-css'
    function ensureStyle() {
      if (document.getElementById(STYLE_ID)) return
      var tag = document.createElement('style')
      tag.id = STYLE_ID
      tag.dataset.plugin = '@a9i5k4/dsh-auto-memory'
      tag.textContent = CSS
      document.head.appendChild(tag)
    }

    // ───────────────────────── 通用小组件 ─────────────────────────
    function useTick() { return useReducer(function (x) { return x + 1 }, 0) }

    function Banner(props) {
      return h('div', { 'data-dam-banner': '' }, props.children)
    }

    function Card(props) {
      return h('div', { 'data-dam-card': '' },
        h('div', { className: 'dam-date' }, props.title),
        h('div', { className: 'dam-content' }, props.children))
    }

    function Loading(props) {
      var label = props && props.label ? props.label : t('loading')
      return h('div', { 'data-dam-loading': '' }, h('span', { 'data-dam-spinner': '', 'aria-hidden': 'true' }), h('span', null, label))
    }
    function AnimatedDisclosure(props) {
      var open = !!props.open
      var shownPair = useState(open)
      var shown = shownPair[0]
      var setShown = shownPair[1]
      var phasePair = useState(open ? 'open' : 'closed')
      var phase = phasePair[0]
      var setPhase = phasePair[1]
      useEffect(function () {
        var timer
        if (open) {
          setShown(true)
          timer = setTimeout(function () { setPhase('open') }, 16)
        } else if (shown) {
          setPhase('closing')
          timer = setTimeout(function () { setShown(false); setPhase('closed') }, 260)
        }
        return function () { if (timer) clearTimeout(timer) }
      }, [open])
      if (!shown) return null
      return h('div', { 'data-dam-disclosure': '', 'data-phase': phase }, props.children)
    }

    // ───────────────────────── 侧边栏入口 ─────────────────────────
    function SidebarButton() {
      var tick = useTick()
      useEffect(function () { return controller.subscribe(tick[1]) }, [])
      return h('button', {
        'data-dam-sidebar-btn': '',
        title: t('memoryPanel'),
        'data-active': (panelOpen || panelClosing) ? 'true' : undefined,
        onClick: function () { controller.toggle() },
      }, h('span', null, t('memory')))
    }

    // ───────────────────────── 记忆面板 ─────────────────────────
    function fmtSize(n) {
      if (n >= 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB'
      if (n >= 1024) return (n / 1024).toFixed(1) + ' KB'
      return n + ' B'
    }

    function GreetingCard(props) {
      var g = props.greeting
      var ps = props.periodSummary
      if (!g) return null
      var openPair = useState({})
      var openMap = openPair[0]
      var setOpenMap = openPair[1]
      var subOpenPair = useState({})
      var subOpenMap = subOpenPair[0]
      var setSubOpenMap = subOpenPair[1]
      // 智能时段判定
      var hour = new Date().getHours()
      var seg = hour < 9 ? 'morning' : hour < 12 ? 'forenoon' : hour < 14 ? 'noon' : hour < 18 ? 'afternoon' : 'evening'
      var segLabel = { morning: t('segMorning'), forenoon: t('segForenoon'), noon: t('segNoon'), afternoon: t('segAfternoon'), evening: t('segEvening') }[seg]
      // 收集抽屉: {key, label, hint, items, withTime}
      var drawers = []
      var curSegName = { morning: '早晨', forenoon: '上午', noon: '中午', afternoon: '下午', evening: '晚上' }[seg]
      // 昨天抽屉(早晨显示)
      if (seg === 'morning' && g.entries.length) {
        drawers.push({ key: 'yesterday', label: t('yesterdayDrawer') + (g.yesterdayDate || ''), hint: '', items: g.entries, withTime: true, defaultOpen: true, period: '昨天' })
      }
      // 今天各时段抽屉(已过的时段)
      var seenSeg = { '早晨': seg !== 'morning', '上午': (seg === 'forenoon' || seg === 'noon' || seg === 'afternoon' || seg === 'evening'), '中午': (seg === 'noon' || seg === 'afternoon' || seg === 'evening'), '下午': (seg === 'afternoon' || seg === 'evening'), '晚上': seg === 'evening' }
      var segOrder = ['早晨', '上午', '中午', '下午', '晚上']
      for (var si = 0; si < segOrder.length; si++) {
        var sname = segOrder[si]
        if (!seenSeg[sname]) continue
        var items = (ps && ps.groups && ps.groups[sname]) || []
        if (!items.length) continue
        var segEn = { '早晨': 'morning', '上午': 'forenoon', '中午': 'noon', '下午': 'afternoon', '晚上': 'evening' }[sname] || sname
        drawers.push({ key: 'seg-' + sname, label: t('segPrefix') + t('seg' + segEn.charAt(0).toUpperCase() + segEn.slice(1)), hint: '', items: items.map(function (x) { return { time: '', text: x } }), withTime: false, defaultOpen: sname === curSegName, period: sname })
      }
      // 外层:生活化问候
      var totalCount = 0
      for (var d0 = 0; d0 < drawers.length; d0++) totalCount += drawers[d0].items.length
      var greetLine = g.greeting && String(g.greeting).trim()
        ? String(g.greeting).trim()
        : (function () {
          if (away()) return t('welcomeBack')
          var base = { morning: t('greetMorning'), forenoon: t('greetForenoon'), noon: t('greetNoon'), afternoon: t('greetAfternoon'), evening: t('greetEvening') }[seg]
          if (totalCount > 0) base += t('greetSummary') + totalCount + t('greetThings')
          return base
        })()
      // 离开>1小时后回来
      function away() { return isAway() }
      var rows = []
      rows.push(h('div', { 'data-dam-content': '' }, greetLine))
      // 抽屉列表(AI 生活化总结缓存)
      var sumCachePair = useState({})
      var sumCache = sumCachePair[0]
      var setSumCache = sumCachePair[1]
      function requestSummary(key, period, force) {
        if (!force && sumCache[key] !== undefined) return
        apiPost(API.summarize, { period: period, force: !!force, ws: currentWs() }).then(function (d) {
          if (d && (d.summary || (d.works && d.works.length))) {
            var n = Object.assign({}, sumCache)
            n[key] = { summary: d.summary || d.result || '', works: d.works || [], at: d.generatedAt || Date.now(), failed: false }
            setSumCache(n)
          }
        }).catch(function () {
          var n = Object.assign({}, sumCache)
          n[key] = { summary: '', works: [], at: 0, failed: true }
          setSumCache(n)
        })
      }
      // 面板刷新键(nonce 变化):已缓存的展开抽屉 force 重新生成
      useEffect(function () {
        if (!props.nonce) return
        for (var d = 0; d < drawers.length; d++) {
          var dr = drawers[d]
          var isOpen = openMap[dr.key] !== undefined ? openMap[dr.key] : dr.defaultOpen
          if (isOpen && sumCache[dr.key] !== undefined) requestSummary(dr.key, dr.period, true)
        }
      }, [props.nonce])
      for (var d = 0; d < drawers.length; d++) {
        (function (dr) {
          var isOpen = openMap[dr.key] !== undefined ? openMap[dr.key] : dr.defaultOpen
          if (isOpen && sumCache[dr.key] === undefined) requestSummary(dr.key, dr.period, false)
          var cached = sumCache[dr.key]
          // 大抽屉标题:有 AI 总结时用总结内容(用户要求),否则用时段名
          var bigTitle = cached && cached.summary ? cached.summary : dr.label
          rows.push(h('div', { key: dr.key, style: { marginTop: '8px' } },
            h('button', {
              'data-dam-btn': '',
              onClick: function () { var n = Object.assign({}, openMap); n[dr.key] = !isOpen; setOpenMap(n) },
              style: { width: '100%', textAlign: 'left', padding: '7px 9px', borderRadius: '8px', background: 'color-mix(in srgb, var(--dsw-alias-bg-layer-1, rgba(128,128,128,.08)) 45%, transparent)', border: '1px solid color-mix(in srgb, var(--dsw-alias-border-l1, rgba(128,128,128,.3)) 50%, transparent)' },
            },
              h('div', { style: { fontWeight: 600, fontSize: 'calc(12.5px * var(--dam-scale))', lineHeight: 1.5 } }, (isOpen ? '▼ ' : '▶ ') + bigTitle),
              h('div', { 'data-dam-muted': '', style: { fontSize: 'calc(11px * var(--dam-scale))', marginTop: '2px' } },
                dr.label + ' · ' + dr.items.length + t('logEntries') + (cached && cached.at ? ' · ' + t('generatedAt') + new Date(cached.at).toLocaleTimeString() : ''))),
            h(AnimatedDisclosure, { open: isOpen }, h('div', { style: { padding: '4px 2px 2px 8px' } },
              cached && cached.works && cached.works.length ? cached.works.map(function (w, wi) {
                var sk = dr.key + ':w' + wi
                var sOpen = subOpenMap[sk] !== undefined ? subOpenMap[sk] : false
                return h('div', { key: sk, style: { marginTop: '5px' } },
                  h('button', {
                    'data-dam-btn': '',
                    onClick: function () { var n = Object.assign({}, subOpenMap); n[sk] = !sOpen; setSubOpenMap(n) },
                    style: { width: '100%', textAlign: 'left', padding: '4px 8px', borderRadius: '6px', background: 'color-mix(in srgb, var(--dsw-alias-bg-layer-1, rgba(128,128,128,.06)) 40%, transparent)', border: '1px solid color-mix(in srgb, var(--dsw-alias-border-l1, rgba(128,128,128,.22)) 45%, transparent)' },
                  },
                    h('span', { style: { fontWeight: 600, fontSize: 'calc(12px * var(--dam-scale))' } }, (sOpen ? '▾ ' : '▸ ') + w.title),
                    h('span', { 'data-dam-muted': '', style: { fontSize: 'calc(11px * var(--dam-scale))', marginLeft: '6px' } }, w.points.length + t('pointsCount'))),
                  sOpen ? h('div', { style: { padding: '4px 4px 2px 14px' } },
                    w.points.map(function (pt, pi) {
                      return h('div', { key: pi, style: { fontSize: 'calc(12px * var(--dam-scale))', lineHeight: 1.5, marginBottom: '2px' } }, '· ' + pt)
                    })) : null)
              }) : cached && cached.failed ? h('div', { 'data-dam-hint': '', style: { padding: '4px 6px' } }, t('summaryFailed'))
                : cached && cached.summary ? h('div', { 'data-dam-hint': '', style: { padding: '4px 6px' } }, cached.summary)
                : h('div', { 'data-dam-hint': '', style: { padding: '4px 6px' } }, t('summarizing'))))))
        })(drawers[d])
      }
      // 待反思提醒
      if (g.pendingReflectionDate) {
        rows.push(h('div', { 'data-dam-hint': '', style: { marginTop: '8px' } }, t('pendingReflectionShort') + g.pendingReflectionDate))
      }
      return h(Card, { title: (g.period || '') + ' · ' + segLabel }, rows)
    }

    function OverviewTab(props) {
      var statePair = useState(null)
      var state = statePair[0]
      var setState = statePair[1]
      var detailPair = useState(false)
      var showDetail = detailPair[0]
      var setShowDetail = detailPair[1]
      var reflectBusyPair = useState(false)
      var reflectBusy = reflectBusyPair[0]
      var setReflectBusy = reflectBusyPair[1]
      var actMsgPair = useState('')
      var actMsg = actMsgPair[0]
      var setActMsg = actMsgPair[1]
      var wsPair = useState(null)
      var wsData = wsPair[0]
      var setWsData = wsPair[1]
      var wsOpenPair = useState(false)
      var wsOpen = wsOpenPair[0]
      var setWsOpen = wsOpenPair[1]
      // 每次进入面板 / 点刷新(nonce 变化)/ 面板打开期间每 30s 自动重拉,保证自动沉淀等数据新鲜
      useEffect(function () {
        var alive = true
        // 跨工作区总结(概览页集成:所有工作区的小总结+细分;读缓存)
        apiPost(API.workspaces, { force: false }).then(function (d) { if (d && alive) setWsData(d) }).catch(function () {})
        apiGet(API.state, { ws: currentWs() }).then(function (s) {
          if (alive) setState(s)
          // 无 AI 问候 → 自动生成一次(host 按时段缓存,不会重复生成)
          if (s && s.greeting && !s.greeting.greeting) {
            apiPost(API.greet, { ws: currentWs() }).then(function (d) {
              if (d && d.greeting && alive) {
                setState(function (prev) {
                  var g0 = (prev && prev.greeting) || {}
                  return Object.assign({}, prev, { greeting: Object.assign({}, g0, { greeting: d.greeting, hasGreeting: true }) })
                })
              }
            }).catch(function () {})
          }
        }).catch(function () {})
        return function () { alive = false }
      }, [props && props.nonce])
      useEffect(function () {
        var timer = setInterval(function () {
          apiGet(API.state, { ws: currentWs() }).then(function (s) { setState(s) }).catch(function () {})
        }, 30000)
        return function () { clearInterval(timer) }
      }, [])

      if (!state) return h(Loading)
      function oneClickReflect() {
        if (reflectBusy) return
        setReflectBusy(true); setActMsg('')
        apiPost(API.reflectAuto, {}).then(function (d) {
          setActMsg(d.result || t('generated')); setReflectBusy(false)
          apiGet(API.state, { ws: currentWs() }).then(function (s) { if (s) setState(s) }).catch(function () {})
        }).catch(function (e) { setActMsg(t('failed') + e.message); setReflectBusy(false) })
      }
      return h('div', null,
        // 今日问候卡:问候语 + 昨天时间轴 + 提醒(纯 GUI 渲染,不干扰对话流)
        h(GreetingCard, { greeting: state.greeting, periodSummary: state.periodSummary, t: t, nonce: props && props.nonce }),
        // 跨工作区总结默认折叠，首页把空间留给问候与今日状态
        h('div', { 'data-dam-collapsible': '', style: { marginTop: '16px' } },
          h('button', { 'data-dam-btn': '', onClick: function () { setWsOpen(!wsOpen) }, style: { width: '100%', textAlign: 'left', padding: '11px 12px', fontWeight: 650, borderBottom: '1px solid color-mix(in srgb, var(--dsw-alias-border-l1, #c5cbd3) 38%, transparent)' } }, (wsOpen ? '▾ ' : '▸ ') + t('wsOverview')),
          h(AnimatedDisclosure, { open: wsOpen }, wsData && wsData.workspaces && wsData.workspaces.length
            ? h('div', { style: { paddingTop: '10px' } }, h(WorkspaceGraph, { workspaces: wsData.workspaces, graph: wsData.graph, onSelect: function () {} }))
            : h(Loading, { label: locale === 'zh' ? '正在生成跨工作区总结…' : 'Generating workspace overview…' }))),
        state.pendingReflection
          ? h(Banner, null, t('pendingReflection') + state.pendingReflection + t('pendingReflectionHint'))
          : null,
        // 状态行:今日工作 / 反思 / 笔记
        h('div', { 'data-dam-kv': '' },
          h('b', null, t('todayWork')), h('span', null, state.todayEntries + t('logEntries')),
          h('b', null, t('dailyReflection')), h('span', null, state.latestReflectionDate || t('notYet')),
          h('b', null, t('workspace')), h('span', null, state.ws)),
        // 自动沉淀即时反馈(本轮/今日沉淀了多少条、最近一次时间)
        state.autoStats && state.autoStats.count > 0
          ? h('div', { 'data-dam-hint': '', style: { marginTop: '2px' } },
              t('autoSettledToday') + state.autoStats.count + t('autoSettledSuffix') +
              (state.autoStats.lastAt ? ' (' + t('autoSettledRecent') + new Date(state.autoStats.lastAt).toLocaleTimeString() + ')' : ''))
          : h('div', { 'data-dam-hint': '', style: { marginTop: '2px' } }, t('autoSettledNone')),
        // 快捷操作
        h('div', { 'data-dam-row': '' },
          h('button', { 'data-dam-btn': '', onClick: oneClickReflect, disabled: reflectBusy }, reflectBusy ? t('reflecting') : t('oneClickReflect')),
          h('span', { 'data-dam-hint': '' }, t('reflectHint'))),
        actMsg ? h('div', { 'data-dam-hint': '' }, actMsg) : null,
        h('div', { 'data-dam-hint': '' }, t('quickLinks')),
        // 技术细节(折叠)
        h('div', null,
          h('button', { 'data-dam-btn': '', onClick: function () { setShowDetail(!showDetail) } }, showDetail ? t('collapseTech') : t('expandTech'))),
        showDetail ? h('div', { 'data-dam-kv': '' },
          h('b', null, t('userMemory')), h('span', null, state.userFile + ' (' + fmtSize(state.sizes.user) + ')'),
          h('b', null, t('projectNotes')), h('span', null, state.notesPath + ' (' + fmtSize(state.sizes.notes) + ')'),
          h('b', null, t('todayLog')), h('span', null, state.logPath + ' (' + fmtSize(state.sizes.log) + ')'),
          h('b', null, t('configFile')), h('span', null, state.configReadError ? (t('readFailed') + state.configReadError) : t('ok')),
          h('b', null, t('refreshTime')), h('span', null, state.refreshedAt ? new Date(state.refreshedAt).toLocaleString() : t('notYetShort'))) : null)
    }

    function LogsTab() {
      var dataPair = useState(null)
      var data = dataPair[0]
      var setData = dataPair[1]
      var openPair = useState(null)
      var open = openPair[0]
      var setOpen = openPair[1]
      var contentPair = useState('')
      var content = contentPair[0]
      var setContent = contentPair[1]
      var userPair = useState('')
      var userText = userPair[0]
      var setUserText = userPair[1]
      var userTruncPair = useState(false)
      var userTruncated = userTruncPair[0]
      var setUserTruncated = userTruncPair[1]
      useEffect(function () {
        var alive = true
        apiGet(API.list).then(function (d) { if (alive) setData(d) }).catch(function () {})
        apiGet(API.state).then(function (s) { if (alive && s) { if (typeof s.userText === 'string') setUserText(s.userText); setUserTruncated(!!s.userTextTruncated) } }).catch(function () {})
        return function () { alive = false }
      }, [])
      useEffect(function () {
        if (!open) return
        var alive = true
        apiGet(API.file, { path: open }).then(function (d) { if (alive) setContent(d.content) }).catch(function () {})
        return function () { alive = false }
      }, [open])
      if (!data) return h(Loading)
      var rows = []
      if (open) {
        rows.push(h(Card, { title: pathName(open) },
          h('div', { 'data-dam-content': '' }, content || t('empty')),
          h('button', { 'data-dam-btn': '', onClick: function () { setOpen(null); setContent('') } }, t('back'))))
      } else {
        rows.push(h('div', { 'data-dam-hint': '' }, t('clickDateViewLog')))
        for (var i = 0; i < data.logs.length; i++) {
          (function (log) {
            rows.push(h(Card, { title: log.date + ' · ' + fmtSize(log.size) },
              h('button', { 'data-dam-btn': '', onClick: function () { setOpen(log.date + '.md') } }, t('view'))))
          })(data.logs[i])
        }
        // 三级记忆之用户级:当日日志下方展示用户画像(跨项目规则/偏好)
        rows.push(h('div', { 'data-dam-hint': '', style: { marginTop: '12px' } }, t('userMemoryBlock')))
        rows.push(h(Card, { title: 'MEMORY.md (' + (locale === 'zh' ? '用户级' : 'user-level') + ')' },
          h('div', { 'data-dam-content': '' }, userText || t('userMemoryEmpty')),
          userTruncated ? h('div', { 'data-dam-hint': '' }, t('userMemoryTruncated')) : null))
      }
      return h('div', null, rows)
    }
    function pathName(p) { var parts = String(p).split(/[\\/]/); return parts[parts.length - 1] }

    function NotesTab() {
      var dataPair = useState(null)
      var data = dataPair[0]
      var setData = dataPair[1]
      var draftPair = useState('')
      var draft = draftPair[0]
      var setDraft = draftPair[1]
      var savingPair = useState(false)
      var saving = savingPair[0]
      var setSaving = savingPair[1]
      var msgPair = useState('')
      var msg = msgPair[0]
      var setMsg = msgPair[1]
      var errPair = useState('')
      var err = errPair[0]
      var setErr = errPair[1]
      useEffect(function () {
        var alive = true
        apiGet(API.state).then(function (s) { if (alive) setData(s) }).catch(function () {})
        return function () { alive = false }
      }, [])
      if (!data) return h(Loading)
      function save() {
        if (!draft.trim() || saving) return
        setSaving(true); setMsg(''); setErr('')
        apiPost(API.note, { content: draft.trim() }).then(function (d) {
          setMsg(d.result || t('appended')); setDraft(''); setSaving(false)
        }).catch(function (e) { setErr(e.message); setSaving(false) })
      }
      return h('div', null,
        h('div', { 'data-dam-hint': '' }, t('notesPathLabel') + data.notesPath),
        h('textarea', { 'data-dam-input': '', rows: 6, placeholder: t('notesPlaceholder'), value: draft, onChange: function (e) { setDraft(e.target.value) } }),
        h('div', { 'data-dam-row': '' },
          h('button', { 'data-dam-btn': '', onClick: save, disabled: saving }, saving ? t('saving') : t('append')),
          h('span', { 'data-dam-hint': '' }, t('notesHint'))),
        msg ? h('div', null, msg) : null,
        err ? h('div', { 'data-dam-error': '' }, err) : null)
    }

    function ReflectionsTab() {
      var dataPair = useState(null)
      var data = dataPair[0]
      var setData = dataPair[1]
      var openPair = useState(null)
      var open = openPair[0]
      var setOpen = openPair[1]
      var contentPair = useState('')
      var content = contentPair[0]
      var setContent = contentPair[1]
      var busyPair = useState(false)
      var busy = busyPair[0]
      var setBusy = busyPair[1]
      var msgPair = useState('')
      var msg = msgPair[0]
      var setMsg = msgPair[1]
      useEffect(function () {
        var alive = true
        apiGet(API.list).then(function (d) { if (alive) setData(d) }).catch(function () {})
        return function () { alive = false }
      }, [])
      useEffect(function () {
        if (!open) return
        var alive = true
        apiGet(API.file, { path: open }).then(function (d) { if (alive) setContent(d.content) }).catch(function () {})
        return function () { alive = false }
      }, [open])
      if (!data) return h(Loading)
      function oneClickReflect() {
        if (busy) return
        setBusy(true); setMsg('')
        apiPost(API.reflectAuto, {}).then(function (d) {
          setMsg(d.result || t('generated')); setBusy(false)
          apiGet(API.list).then(function (dd) { if (dd) setData(dd) }).catch(function () {})
        }).catch(function (e) { setMsg(t('failed') + e.message); setBusy(false) })
      }
      var rows = []
      if (open) {
        rows.push(h(Card, { title: t('reflectionTitle') + pathName(open) }, h('div', { 'data-dam-content': '' }, content || t('empty'))))
        rows.push(h('button', { 'data-dam-btn': '', onClick: function () { setOpen(null); setContent('') } }, t('back')))
      } else {
        rows.push(h('div', { 'data-dam-row': '' },
          h('button', { 'data-dam-btn': '', onClick: oneClickReflect, disabled: busy }, busy ? t('generating') : t('oneClickReflect')),
          h('span', { 'data-dam-hint': '' }, t('reflectAutoHint'))))
        if (msg) rows.push(h('div', null, msg))
        if (!data.reflections.length) rows.push(h('div', { 'data-dam-muted': '' }, t('noReflection')))
        for (var i = 0; i < data.reflections.length; i++) {
          (function (r) {
            rows.push(h(Card, { title: r.date + ' · ' + fmtSize(r.size) },
              h('button', { 'data-dam-btn': '', onClick: function () { setOpen('reflections/' + r.name) } }, t('view'))))
          })(data.reflections[i])
        }
      }
      return h('div', null, rows)
    }

    function SearchTab() {
      var qPair = useState('')
      var q = qPair[0]
      var setQ = qPair[1]
      var resultPair = useState(null)
      var result = resultPair[0]
      var setResult = resultPair[1]
      var smartPair = useState(null)
      var smart = smartPair[0]
      var setSmart = smartPair[1]
      var busyPair = useState(false)
      var busy = busyPair[0]
      var setBusy = busyPair[1]
      function search() {
        if (!q.trim() || busy) return
        setBusy(true); setResult(null); setSmart(null)
        apiPost(API.recall, { query: q.trim() }).then(function (d) { setResult(d.result); setBusy(false) })
          .catch(function (e) { setResult(t('searchFailed') + e.message); setBusy(false) })
      }
      function smartSearch() {
        if (!q.trim() || busy) return
        setBusy(true); setResult(null); setSmart(null)
        apiPost(API.smartRecall, { query: q.trim() }).then(function (d) { setSmart(d); setBusy(false) })
          .catch(function (e) { setSmart({ answer: t('searchFailed') + e.message, keywords: [], hits: [] }); setBusy(false) })
      }
      return h('div', null,
        h('div', { 'data-dam-row': '' },
          h('input', { 'data-dam-input': '', placeholder: t('searchPlaceholder'), value: q, onChange: function (e) { setQ(e.target.value) }, onKeyDown: function (e) { if (e.key === 'Enter') search() } }),
          h('button', { 'data-dam-btn': '', onClick: search, disabled: busy }, t('searchBtn')),
          h('button', { 'data-dam-btn': '', onClick: smartSearch, disabled: busy }, t('smartSearch'))),
        busy ? h(Loading, { label: locale === 'zh' ? 'AI 正在分析记忆…' : 'AI is analyzing memory…' }) : null,
        smart ? h(Card, { title: t('smartAnswer') },
          h('div', { 'data-dam-content': '' }, smart.answer || t('empty')),
          smart.keywords && smart.keywords.length ? h('div', { 'data-dam-hint': '', style: { marginTop: '6px' } }, t('keywordsLabel') + smart.keywords.join(' / ')) : null,
          Array.isArray(smart.hits) && smart.hits.length ? h('div', { 'data-dam-hint': '', style: { marginTop: '6px' } },
            smart.hits.map(function (hit, i) { return hit && typeof hit === 'object' ? h('div', { key: i, style: { marginTop: '3px', overflowWrap: 'anywhere' } }, '· [' + String(hit.where || '') + '] ' + String(hit.line || '')) : null })) : null)
          : null,
        result ? h(Card, { title: t('resultTitle') }, h('div', { 'data-dam-content': '' }, result)) : null)
    }

    // ───────────────────────── 工作区总览页签(跨工作区全局总结) ─────────────────────────
    function graphKeywords(text) {
      return String(text || '').toLowerCase().split(/[\s,，。:：;；/|()[\]{}]+/).filter(function (x) { return x.length >= 3 }).slice(0, 18)
    }
    function WorkspaceGraph(props) {
      var workspaces = props.workspaces || []
      var panPair = useState({ x: 0, y: 0 })
      var pan = panPair[0]
      var setPan = panPair[1]
      var dragPair = useState(false)
      var panning = dragPair[0]
      var setPanning = dragPair[1]
      var startPair = useState(null)
      var dragStart = startPair[0]
      var setDragStart = startPair[1]
      function pointerDown(ev) {
        if (ev.button !== 0 || (ev.target && ev.target.closest && ev.target.closest('[data-dam-graph-node]'))) return
        ev.preventDefault()
        try { if (ev.currentTarget.setPointerCapture) ev.currentTarget.setPointerCapture(ev.pointerId) } catch (e) {}
        setPanning(true)
        setDragStart({ x: ev.clientX, y: ev.clientY, px: pan.x, py: pan.y, moved: false, pointerId: ev.pointerId })
      }
      function pointerMove(ev) {
        if (!panning || !dragStart || ev.pointerId !== dragStart.pointerId) return
        var dx = ev.clientX - dragStart.x, dy = ev.clientY - dragStart.y
        if (!dragStart.moved && Math.abs(dx) + Math.abs(dy) < 3) return
        if (!dragStart.moved) { dragStart = Object.assign({}, dragStart, { moved: true }); setDragStart(dragStart) }
        setPan({ x: dragStart.px + dx, y: dragStart.py + dy })
      }
      function pointerUp(ev) {
        if (!panning || !dragStart || (ev && ev.pointerId !== dragStart.pointerId)) return
        try { if (ev.currentTarget.releasePointerCapture) ev.currentTarget.releasePointerCapture(dragStart.pointerId) } catch (e) {}
        setPanning(false); setDragStart(null)
      }
      var onSelect = props.onSelect || function () {}
      var graph = props.graph || {}
      var scale = Number(props.scale) || 1.2
      var compact = graphDensity === 'compact'
      var columns = Math.min(2, Math.max(1, workspaces.length))
      var rows = Math.ceil(workspaces.length / columns)
      var width = 920
      var colGap = 420
      var rowGap = compact ? 220 : 270
      var height = Math.max(420, rows * rowGap + 80)
      var centers = workspaces.map(function (ws, i) {
        var col = i % columns, row = Math.floor(i / columns)
        return { ws: ws, x: 160 + col * colGap, y: 72 + row * rowGap, i: i }
      })
      var edges = []
      ;(graph.links || []).forEach(function (link) {
        var from = centers.find(function (c) { return c.ws.name === link.from })
        var to = centers.find(function (c) { return c.ws.name === link.to })
        if (from && to) edges.push([from, to, link.label || ''])
      })
      var children = []
      centers.forEach(function (c) {
        var topics = c.ws.graphTopics && c.ws.graphTopics.length ? c.ws.graphTopics : (c.ws.items || []).map(function (x) { return { label: x, detail: '' } })
        topics.slice(0, compact ? 3 : 4).forEach(function (topic, j) {
          var col = j % 2, row = Math.floor(j / 2)
          children.push({ center: c, item: topic, x: c.x - 105 + col * 210, y: c.y + 82 + row * 56, j: j })
        })
      })
      return h('div', { 'data-dam-graph': '', 'data-panning': panning ? 'true' : undefined, onPointerDown: pointerDown, onPointerMove: pointerMove, onPointerUp: pointerUp, onPointerCancel: pointerUp, onLostPointerCapture: pointerUp },
        h('svg', { viewBox: '0 0 ' + width + ' ' + height, width: Math.round(width * scale), height: Math.round(height * scale), role: 'img', 'aria-label': t('wsOverview'), style: { touchAction: 'none', userSelect: 'none' } },
          h('g', { transform: 'translate(' + (pan.x / scale) + ' ' + (pan.y / scale) + ')' },
          h('g', null, edges.map(function (e, i) {
            return h('g', { key: 'cross-' + i }, h('line', { x1: e[0].x, y1: e[0].y, x2: e[1].x, y2: e[1].y, stroke: 'var(--dam-accent, #4f7cff)', strokeOpacity: .35, strokeWidth: 1.5, strokeDasharray: '5 6' }), e[2] ? h('text', { x: (e[0].x + e[1].x) / 2, y: (e[0].y + e[1].y) / 2 - 4, textAnchor: 'middle', fontSize: 8, fill: 'var(--dam-accent, #4f7cff)' }, e[2].slice(0, 16)) : null)
          })),
          h('g', null, children.map(function (n, i) {
            return h('g', { key: 'branch-' + i },
              h('line', { x1: n.center.x, y1: n.center.y + 38, x2: n.x, y2: n.y - 22, stroke: '#8b949e', strokeOpacity: .48, strokeWidth: 1.2 }),
              h('rect', { x: n.x - (compact ? 82 : 92), y: n.y - 22, width: compact ? 164 : 184, height: 44, rx: 10, fill: 'color-mix(in srgb, var(--dsw-alias-bg-overlay, #fff) 92%, transparent)', stroke: 'color-mix(in srgb, var(--dam-accent, #1d4ed8) 42%, #8b949e)', strokeOpacity: .8 }),
              h('text', { x: n.x, y: n.y - 5, textAnchor: 'middle', fontSize: compact ? 9.5 : 10.5, fontWeight: 650, fill: 'currentColor' }, String(n.item && n.item.label || n.item || '').slice(0, 22)),
              h('text', { x: n.x, y: n.y + 10, textAnchor: 'middle', fontSize: 8, fill: '#7d8793' }, String(n.item && n.item.detail || '').slice(0, 26)))
          })),
          h('g', null, centers.map(function (c) {
            return h('g', { key: c.ws.path, 'data-dam-graph-node': '', onPointerDown: function (ev) { ev.stopPropagation() }, onClick: function () { onSelect(c.ws) } },
              h('rect', { x: c.x - 100, y: c.y - 38, width: 200, height: 76, rx: 16, fill: 'color-mix(in srgb, var(--dam-accent, #1d4ed8) 22%, var(--dsw-alias-bg-overlay, #fff))', stroke: 'var(--dam-accent, #1d4ed8)', strokeWidth: 2 }),
              h('text', { x: c.x, y: c.y - 5, textAnchor: 'middle', fontSize: compact ? 10.5 : 12, fontWeight: 650, fill: 'currentColor' }, h('tspan', { x: c.x, dy: 0 }, String(c.ws.name || '').slice(0, 12)), h('tspan', { x: c.x, dy: 13 }, String(c.ws.name || '').slice(12, 24))),
              h('text', { x: c.x, y: c.y + 15, textAnchor: 'middle', fontSize: 8, fill: '#7d8793' }, (c.ws.logCount || 0) + ' ' + t('logEntries')))
          }))))
          )
    }
    function WorkspaceTab() {
      var dataPair = useState(null)
      var data = dataPair[0]
      var setData = dataPair[1]
      var busyPair = useState(false)
      var busy = busyPair[0]
      var setBusy = busyPair[1]
      function load(force) {
        if (busy) return
        setBusy(true)
        apiPost(API.workspaces, { force: !!force }).then(function (d) { if (d) setData(d); setBusy(false) })
          .catch(function () { setBusy(false) })
      }
      useEffect(function () { load(false) }, [])
      var selectedPair = useState(null)
      var selected = selectedPair[0]
      var setSelected = selectedPair[1]
      var collapsedPair = useState({})
      var collapsedByPath = collapsedPair[0]
      var setCollapsedByPath = collapsedPair[1]
      var graphScalePair = useState(1.0)
      var graphScale = graphScalePair[0]
      var setGraphScale = graphScalePair[1]
      if (!data) return h('div', null, busy ? h(Loading, { label: locale === 'zh' ? 'AI 正在整理工作区…' : 'AI is mapping workspaces…' }) : h(Loading))
      var workspaces = data.workspaces || []
      return h('div', null,
        h('div', { 'data-dam-row': '' },
          h('button', { 'data-dam-btn': '', onClick: function () { load(true) }, disabled: busy }, busy ? t('refreshing') : t('refresh')),
          h('span', { 'data-dam-hint': '' }, data.cached ? (t('generatedAt') + new Date(data.generatedAt).toLocaleTimeString()) : '')),
        workspaces.length ? h('div', null,
          h('div', { 'data-dam-hint': '', style: { margin: '5px 0 8px' } }, locale === 'zh' ? '中心节点代表工作区；分支为记忆主题；虚线表示共享主题。' : 'Centers are workspaces, branches are topics, and dashed links show shared themes.'),
          h('div', { 'data-dam-graph-toolbar': '' }, h('span', { 'data-dam-hint': '' }, locale === 'zh' ? '思维导图大小' : 'Map size'), h('input', { type: 'range', min: '0.55', max: '1.75', step: '0.05', value: graphScale, 'aria-label': locale === 'zh' ? '调整思维导图大小' : 'Adjust map size', onChange: function (e) { setGraphScale(Number(e.target.value) || 1.0) } }), h('span', { 'data-dam-hint': '' }, Math.round(graphScale * 100) + '%'), h('button', { 'data-dam-btn': '', title: locale === 'zh' ? '重置视图' : 'Reset view', onClick: function () { setGraphScale(1.0) } }, '⌂')),
          h('div', { 'data-dam-hint': '' }, locale === 'zh' ? '点击工作区卡片查看摘要；拖动滑块调整图的大小。' : 'Select a workspace card for details; use the slider to resize the map.'),
          h(WorkspaceGraph, { workspaces: workspaces, graph: data.graph, scale: graphScale, onSelect: function (ws) { setSelected(ws); var n = Object.assign({}, collapsedByPath); n[ws.path] = false; setCollapsedByPath(n) } }),
          h('div', { style: { marginTop: '12px' } }, workspaces.map(function (ws) {
            var open = collapsedByPath[ws.path] === false
            return h('div', { key: ws.path, 'data-dam-card': '', style: { marginBottom: '8px', padding: '0' } },
              h('button', { 'data-dam-btn': '', 'aria-expanded': open ? 'true' : 'false', onClick: function () { var n = Object.assign({}, collapsedByPath); n[ws.path] = !open; setCollapsedByPath(n); setSelected(ws) }, style: { width: '100%', textAlign: 'left', padding: '10px 12px', fontWeight: 650 } }, (open ? '▾ ' : '▸ ') + ws.name + (ws.dateRange ? ' · ' + ws.dateRange : '')),
              h(AnimatedDisclosure, { open: open }, h('div', { style: { padding: '4px 12px 12px' } }, ws.summary ? h('div', { 'data-dam-content': '' }, ws.summary) : null, (ws.items || []).map(function (it, i) { return h('div', { key: i, style: { fontSize: 'calc(12px * var(--dam-scale))', marginTop: '4px', lineHeight: 1.55 } }, '· ' + it) }), h('div', { 'data-dam-hint': '' }, ws.path + ' · ' + (ws.logCount || 0) + t('logEntries')))))
          })) ) : h('div', { 'data-dam-hint': '' }, t('wsNone')))
    }

    // ───────────────────────── 日历页签 ─────────────────────────
    var QUADRANT_I18N = { '重要紧急': 'qUrgentImportant', '重要不紧急': 'qImportant', '紧急不重要': 'qUrgent', '不重要不紧急': 'qNone', '未分类': 'qUncategorized' }
    var QUADRANT_STYLE = {
      '重要紧急': { color: 'var(--dsw-alias-state-error-primary, #d64545)' },
      '重要不紧急': { color: 'var(--dsw-alias-brand-primary, #4f7cff)' },
      '紧急不重要': { color: 'var(--dsw-alias-state-warn-primary, #e6a23c)' },
      '不重要不紧急': { color: 'var(--dsw-alias-label-secondary, #8a94a6)' },
      '未分类': { color: 'var(--dsw-alias-label-secondary, #8a94a6)' },
    }
    function CalendarTab() {
      var dataPair = useState(null)
      var data = dataPair[0]
      var setData = dataPair[1]
      var monthPair = useState(null)
      var month = monthPair[0]  // {year, mon} 1-12
      var setMonth = monthPair[1]
      var draftPair = useState(null)
      var draft = draftPair[0]  // {date, time, quadrant, title}
      var setDraft = draftPair[1]
      var dayViewPair = useState(null)
      var dayView = dayViewPair[0]
      var setDayView = dayViewPair[1]
      var msgPair = useState('')
      var msg = msgPair[0]
      var setMsg = msgPair[1]
      var savingPair = useState(false)
      var saving = savingPair[0]
      var setSaving = savingPair[1]
      var calErrorPair = useState('')
      var calError = calErrorPair[0]
      var setCalError = calErrorPair[1]
      function load() {
        apiGet(API.calendar).then(function (d) { if (d) { setData(d); setCalError('') } }).catch(function (e) { setCalError(t('failed') + e.message) })
      }
      useEffect(function () {
        load()
        var now = new Date()
        setMonth({ year: now.getFullYear(), mon: now.getMonth() + 1 })
      }, [])
      if (!data || !month) return h(Loading)
      function dayEntries(date) {
        return (data.entries || []).filter(function (en) { return en.date === date })
      }
      function moveMonth(delta) {
        var y = month.year, m = month.mon + delta
        if (m < 1) { m = 12; y-- }
        if (m > 12) { m = 1; y++ }
        setMonth({ year: y, mon: m })
      }
      function fmtDate(y, m, d) { return y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0') }
      // 月网格
      var firstDay = new Date(month.year, month.mon - 1, 1)
      var startDow = firstDay.getDay()
      var daysInMonth = new Date(month.year, month.mon, 0).getDate()
      var cells = []
      var today = fmtDate(new Date().getFullYear(), new Date().getMonth() + 1, new Date().getDate())
      for (var i = 0; i < startDow; i++) cells.push(null)
      for (var d = 1; d <= daysInMonth; d++) cells.push(fmtDate(month.year, month.mon, d))
      var dowLabels = locale === 'zh' ? ['日', '一', '二', '三', '四', '五', '六'] : ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
      var rows = []
      // 顶部:月份切换 + 添加按钮
      rows.push(h('div', { 'data-dam-row': '' },
        h('button', { 'data-dam-btn': '', onClick: function () { moveMonth(-1) } }, '◀'),
        h('span', { style: { fontWeight: 700, flex: 1, textAlign: 'center' } }, month.year + ' / ' + String(month.mon).padStart(2, '0')),
        h('button', { 'data-dam-btn': '', onClick: function () { moveMonth(1) } }, '▶'),
        h('button', { 'data-dam-btn': '', onClick: function () { setDraft({ date: today, time: '09:00', quadrant: '重要不紧急', title: '', location: '', reminder: '', note: '' }) } }, '+ ' + t('addItem'))))
      // 图例
      rows.push(h('div', { 'data-dam-row': '', style: { flexWrap: 'wrap' } },
        Object.keys(QUADRANT_STYLE).map(function (q) {
          return h('span', { key: q, style: { fontSize: 'calc(11px * var(--dam-scale))', opacity: 0.8, marginRight: '10px' } },
            h('span', { style: { display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: QUADRANT_STYLE[q].color, marginRight: 4 } }), t(QUADRANT_I18N[q]))
        })))
      // 星期表头
      rows.push(h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '3px', marginBottom: '4px' } },
        dowLabels.map(function (dl) { return h('div', { key: dl, style: { textAlign: 'center', fontSize: 'calc(11px * var(--dam-scale))', opacity: 0.55 } }, dl) })))
      // 日历格子
      var gridRows = []
      for (var ci = 0; ci < cells.length; ci += 7) {
        var week = []
        for (var cj = 0; cj < 7; cj++) {
          (function (cell) {
            if (!cell) { week.push(h('div', { key: 'empty' + cj })); return }
            var es = dayEntries(cell)
            var isToday = cell === today
            var dayNum = Number(cell.slice(8))
            week.push(h('div', {
              key: cell,
              'data-dam-calendar-day': '',
              onClick: function () { setDayView(cell) },
              style: {
                minHeight: '64px', padding: '4px', cursor: 'pointer', borderRadius: '8px',
                border: '1px solid ' + (isToday ? 'var(--dsw-alias-brand-primary, #4f7cff)' : 'color-mix(in srgb, var(--dsw-alias-border-l1, rgba(128,128,128,.3)) 55%, transparent)'),
                background: isToday ? 'color-mix(in srgb, var(--dsw-alias-brand-primary, #4f7cff) 10%, transparent)' : 'color-mix(in srgb, var(--dsw-alias-bg-layer-1, rgba(128,128,128,.06)) 40%, transparent)',
                overflow: 'hidden',
              },
            },
              h('div', { style: { fontSize: 'calc(11.5px * var(--dam-scale))', fontWeight: isToday ? 700 : 500, opacity: isToday ? 1 : 0.7, marginBottom: '3px' } }, dayNum),
              es.slice(0, 3).map(function (en) {
                var qs = QUADRANT_STYLE[en.quadrant] || QUADRANT_STYLE['未分类']
                return h('div', {
                  key: en.time + en.title,
                  'data-dam-calendar-event': '',
                  title: en.time + ' ' + en.title,
                  onClick: function (ev) { ev.stopPropagation(); toggleDone(en) },
                  style: {
                    fontSize: 'calc(10.5px * var(--dam-scale))', lineHeight: 1.35, padding: '1px 4px', borderRadius: 4, marginBottom: 2,
                    background: 'color-mix(in srgb, ' + qs.color + ' 18%, transparent)',
                    color: qs.color, textDecoration: en.done ? 'line-through' : 'none',
                    opacity: en.done ? 0.5 : 1, cursor: 'pointer', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  },
                }, (en.time && en.time !== '--:--' ? en.time + ' ' : '') + en.title)
              }),
              es.length > 3 ? h('div', { style: { fontSize: 'calc(10px * var(--dam-scale))', opacity: 0.5 } }, '+' + (es.length - 3)) : null))
          })(cells[ci + cj])
        }
        gridRows.push(h('div', { key: 'w' + ci, style: { display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '3px' } }, week))
      }
      rows.push(h('div', null, gridRows))
      function toggleDone(en) {
        if (saving) return
        setSaving(true); setCalError('')
        apiPost(API.calendar, { action: en.done ? 'remove' : 'done', date: en.date, time: en.time, title: en.title }).then(function (d) {
          setMsg(d.result || ''); setSaving(false); load()
        }).catch(function (e) { setSaving(false); setCalError(t('failed') + e.message) })
      }
      function saveDraft() {
        if (!draft || !draft.title.trim()) { setCalError(t('needTitle')); return }
        if (saving) return
        setSaving(true); setCalError('')
        apiPost(API.calendar, { date: draft.date, time: draft.time, quadrant: draft.quadrant, title: draft.title.trim(), note: [draft.location ? (locale === 'zh' ? '地点: ' : 'Location: ') + draft.location : '', draft.reminder ? (locale === 'zh' ? '提醒: ' : 'Reminder: ') + draft.reminder : '', draft.note || ''].filter(Boolean).join(' | ') }).then(function (d) {
          setMsg(d.result || t('saved')); setSaving(false); setDraft(null); load()
        }).catch(function (e) { setSaving(false); setCalError(t('failed') + e.message) })
      }
      // 日期格先打开当天时间轴；点击某个时间槽才创建事件。
      if (dayView) {
        var timeline = []
        for (var hourSlot = 7; hourSlot <= 22; hourSlot++) {
          (function (hourValue) {
            var hourText = String(hourValue).padStart(2, '0') + ':00'
            var hourEvents = dayEntries(dayView).filter(function (en) { return String(en.time || '').slice(0, 2) === String(hourValue).padStart(2, '0') })
            timeline.push(h('div', { key: hourText, 'data-dam-calendar-slot': '', onClick: function () { setDayView(null); setDraft({ date: dayView, time: hourText, quadrant: '重要不紧急', title: '', location: '', reminder: '', note: '' }) } },
              h('div', { style: { flex: '0 0 50px', fontSize: 'calc(11px * var(--dam-scale))', opacity: .65 } }, hourText),
              h('div', { style: { minHeight: '34px', flex: 1, borderLeft: '2px solid color-mix(in srgb, var(--dam-accent, #1d4ed8) 24%, transparent)', paddingLeft: '9px' } }, hourEvents.length ? hourEvents.map(function (en) { var qs = QUADRANT_STYLE[en.quadrant] || QUADRANT_STYLE['未分类']; return h('div', { key: en.time + en.title, 'data-dam-calendar-event': '', onClick: function (ev) { ev.stopPropagation(); toggleDone(en) }, style: { marginBottom: '4px', padding: '4px 7px', borderRadius: 6, background: 'color-mix(in srgb, ' + qs.color + ' 18%, transparent)', color: qs.color, textDecoration: en.done ? 'line-through' : 'none' } }, (en.time || '') + '  ' + en.title + (en.note ? ' · ' + en.note : '')) }) : h('span', { 'data-dam-hint': '' }, locale === 'zh' ? '点击添加事件' : 'Click to add event'))))
          })(hourSlot)
        }
        rows.push(h('div', { 'data-dam-calendar-modal': '', style: { position: 'absolute', inset: 0, zIndex: 10, overflow: 'auto', borderRadius: '16px', background: 'color-mix(in srgb, var(--dsw-alias-bg-overlay, rgba(255,255,255,.9)) 78%, transparent)', backdropFilter: 'blur(20px) saturate(1.4)', WebkitBackdropFilter: 'blur(20px) saturate(1.4)', padding: '16px' } }, h('div', { 'data-dam-row': '' }, h('div', { style: { fontWeight: 700, flex: 1 } }, dayView + ' · ' + (locale === 'zh' ? '当天安排' : 'Day schedule')), h('button', { 'data-dam-btn': '', onClick: function () { setDayView(null) } }, '✕')), timeline))
      }
      // 添加/编辑浮层(液态玻璃)
      if (draft) {
        rows.push(h('div', {
          'data-dam-calendar-modal': '',
          style: {
            position: 'absolute', inset: 0, zIndex: 10, borderRadius: '16px',
            background: 'color-mix(in srgb, var(--dsw-alias-bg-overlay, rgba(255,255,255,.9)) 70%, transparent)',
            backdropFilter: 'blur(20px) saturate(1.4)', WebkitBackdropFilter: 'blur(20px) saturate(1.4)',
            display: 'flex', flexDirection: 'column', padding: '18px', gap: '10px',
            border: '1px solid color-mix(in srgb, var(--dsw-alias-border-l1, rgba(128,128,128,.35)) 60%, transparent)',
          },
        },
          h('div', { style: { fontWeight: 700 } }, t('addItem') + ' · ' + draft.date),
          h('input', { 'data-dam-input': '', placeholder: t('itemTitle'), value: draft.title, autoFocus: true, onChange: function (e) { var n = Object.assign({}, draft); n.title = e.target.value; setDraft(n) } }),
          h('div', { 'data-dam-row': '' },
            h('input', { 'data-dam-input': '', type: 'time', value: draft.time, onChange: function (e) { var n = Object.assign({}, draft); n.time = e.target.value || '09:00'; setDraft(n) } }),
            h('select', { 'data-dam-select': '', value: draft.quadrant, onChange: function (e) { var n = Object.assign({}, draft); n.quadrant = e.target.value; setDraft(n) } },
              ['重要紧急', '重要不紧急', '紧急不重要', '不重要不紧急'].map(function (q) { return h('option', { key: q, value: q }, t(QUADRANT_I18N[q])) }))),
          h('input', { 'data-dam-input': '', placeholder: locale === 'zh' ? '地点（可选）' : 'Location (optional)', value: draft.location || '', onChange: function (e) { var n = Object.assign({}, draft); n.location = e.target.value; setDraft(n) } }),
          h('input', { 'data-dam-input': '', placeholder: locale === 'zh' ? '提醒内容（可选）' : 'Reminder note (optional)', value: draft.reminder || '', onChange: function (e) { var n = Object.assign({}, draft); n.reminder = e.target.value; setDraft(n) } }),
          h('textarea', { 'data-dam-input': '', rows: 2, placeholder: locale === 'zh' ? '补充说明（可选）' : 'Details (optional)', value: draft.note || '', onChange: function (e) { var n = Object.assign({}, draft); n.note = e.target.value; setDraft(n) } }),
          h('div', { 'data-dam-row': '' },
            h('button', { 'data-dam-btn': '', onClick: saveDraft, disabled: saving }, saving ? (locale === 'zh' ? '保存中…' : 'Saving…') : t('save')),
            h('button', { 'data-dam-btn': '', onClick: function () { if (!saving) setDraft(null) }, disabled: saving }, t('cancel')),
            calError ? h('div', { 'data-dam-error': '' }, calError) : null)))
      }
      if (msg) rows.push(h('div', { 'data-dam-hint': '', style: { marginTop: '8px' } }, msg))
      if (calError && !draft) rows.push(h('div', { 'data-dam-error': '' }, calError))
      return h('div', { 'data-dam-calendar': '', style: { position: 'relative' } }, rows)
    }

    var TOOL_LABEL = { workbuddy: t('aiAssistant'), codebuddy: 'CodeBuddy', claude: 'Claude Code', codex: 'Codex', 'project-files': t('projectFiles') }
    function ConnectTab() {
      var sourcesPair = useState(null)
      var sources = sourcesPair[0]
      var setSources = sourcesPair[1]
      var busyPair = useState({})
      var busy = busyPair[0]
      var setBusy = busyPair[1]
      var msgPair = useState('')
      var msg = msgPair[0]
      var setMsg = msgPair[1]
      var errPair = useState('')
      var err = errPair[0]
      var setErr = errPair[1]
      var expandedPair = useState(null)
      var expanded = expandedPair[0]
      var setExpanded = expandedPair[1]
      var viewCachePair = useState({})
      var viewCache = viewCachePair[0]
      var setViewCache = viewCachePair[1]
      var removeArmPair = useState('')
      var removeArm = removeArmPair[0]
      var setRemoveArm = removeArmPair[1]
      var hitsCachePair = useState({})
      var hitsCache = hitsCachePair[0]
      var setHitsCache = hitsCachePair[1]
      var hitsBusyForPair = useState(null)
      var hitsBusyFor = hitsBusyForPair[0]
      var setHitsBusyFor = hitsBusyForPair[1]
      function load() {
        apiGet(API.external).then(function (d) { setSources(d.sources || []) }).catch(function (e) { setErr(e.message) })
      }
      useEffect(function () { load() }, [])
      if (!sources) return err ? h('div', { 'data-dam-error': '' }, err) : h(Loading)
      function doImport(source, target) {
        var next = Object.assign({}, busy); next[source] = true
        setBusy(next); setMsg(''); setErr('')
        apiPost(API.externalImport, { source: source, target: target }).then(function (d) {
          var done = Object.assign({}, busy); done[source] = false
          setBusy(done); setMsg(d.result || t('imported'))
          setSources(function (prev) { return (prev || []).map(function (x) { return x.id === source ? Object.assign({}, x, target === 'user' ? { importedUser: true } : { importedNotes: true }) : x }) })
          load()
        }).catch(function (e) { var done = Object.assign({}, busy); done[source] = false; setBusy(done); setErr(e.message) })
      }
      function toggleView(source) {
        if (expanded === source.id) { setExpanded(null); return }
        setExpanded(source.id); setRemoveArm('')
        if (viewCache[source.id] !== undefined) return
        var n = Object.assign({}, viewCache); n[source.id] = { source: source, loading: true }
        setViewCache(n)
        apiGet(API.externalView, { source: source.id }).then(function (d) {
          var m = Object.assign({}, viewCache); m[source.id] = Object.assign({ source: source }, d, { loading: false })
          setViewCache(m)
        }).catch(function (e) {
          var m = Object.assign({}, viewCache); m[source.id] = { source: source, loading: false, error: e.message }
          setViewCache(m)
        })
      }
      function removeImported(source, target) {
        var key = source.id + ':' + (target || '')
        if (removeArm !== key) { setRemoveArm(key); setMsg(''); return }
        setRemoveArm('')
        apiPost(API.externalRemove, { source: source.id, target: target }).then(function (d) {
          setMsg(d.result || ''); setExpanded(null); load()
          setSources(function (prev) { return (prev || []).map(function (x) { return x.id === source.id ? Object.assign({}, x, target === 'user' ? { importedUser: false } : target === 'project' ? { importedNotes: false } : { importedUser: false, importedNotes: false }) : x }) })
        }).catch(function (e) { setErr(t('failed') + e.message) })
      }
      function findImported(source) {
        if (!source) return
        setHitsBusyFor(source.id)
        apiPost(API.recall, { query: source.name || source.tool || '' }).then(function (d) {
          var n = Object.assign({}, hitsCache); n[source.id] = d && d.result ? d.result : (locale === 'zh' ? '未找到相关片段' : 'No matches')
          setHitsCache(n); setHitsBusyFor(null)
        }).catch(function (e) {
          var n = Object.assign({}, hitsCache); n[source.id] = t('failed') + e.message
          setHitsCache(n); setHitsBusyFor(null)
        })
      }
      function importAll() {
        var md = sources.filter(function (s) { return s.kind !== 'sessions' && s.enabled !== false })
        setMsg(t('importing') + md.length + t('importingSuffix')); setErr('')
        var chain = Promise.resolve()
        md.forEach(function (s) { chain = chain.then(function () { return apiPost(API.externalImport, { source: s.id, target: 'project' }) }) })
        chain.then(function () { setMsg(t('allImported')) }).catch(function (e) { setErr(e.message) })
      }
      var cards = []
      if (!sources.length) {
        cards.push(h('div', { 'data-dam-muted': '' }, t('noExternal')))
      }
      for (var i = 0; i < sources.length; i++) {
        (function (s) {
          var isOpen = expanded === s.id
          var v = viewCache[s.id]
          var actions = []
          actions.push(h('button', { 'data-dam-btn': '', title: locale === 'zh' ? '只读查看该来源的内容' : 'Read-only view of this source', onClick: function () { toggleView(s) } }, isOpen ? (locale === 'zh' ? '收起' : 'Collapse') : (locale === 'zh' ? '查看内容' : 'View content')))
          if (s.kind === 'sessions') {
            actions.push(h('span', { 'data-dam-hint': '' }, t('sessionSource') + s.fileCount + t('sessionSourceSuffix')))
          } else {
            actions.push(s.importedUser ? h('button', { 'data-dam-btn': '', title: locale === 'zh' ? '从用户级记忆删除已导入段落' : 'Delete the imported section from user-level memory', onClick: function () { removeImported(s, 'user') }, style: removeArm === s.id + ':user' ? { background: 'color-mix(in srgb, var(--dsw-alias-state-error-primary, #d64545) 22%, transparent)', color: 'var(--dsw-alias-state-error-primary, #d64545)' } : undefined }, removeArm === s.id + ':user' ? (locale === 'zh' ? '确认删除？' : 'Confirm?') : (locale === 'zh' ? '从 prompt 删除' : 'Delete')) : h('button', { 'data-dam-btn': '', disabled: !!busy[s.id], onClick: function () { doImport(s.id, 'user') } }, t('importToUser')))
            actions.push(s.importedNotes ? h('button', { 'data-dam-btn': '', title: locale === 'zh' ? '从项目笔记删除已导入段落' : 'Delete the imported section from project notes', onClick: function () { removeImported(s, 'project') }, style: removeArm === s.id + ':project' ? { background: 'color-mix(in srgb, var(--dsw-alias-state-error-primary, #d64545) 22%, transparent)', color: 'var(--dsw-alias-state-error-primary, #d64545)' } : undefined }, removeArm === s.id + ':project' ? (locale === 'zh' ? '确认删除？' : 'Confirm?') : (locale === 'zh' ? '从 prompt 删除' : 'Delete')) : h('button', { 'data-dam-btn': '', disabled: !!busy[s.id], onClick: function () { doImport(s.id, 'project') } }, busy[s.id] ? t('importingOne') : t('importToNotes')))

          }
          cards.push(h(Card, { key: s.id, title: s.name + ' · ' + s.tool + (s.enabled === false ? t('disabled') : '') },
            h('div', { 'data-dam-row': '', style: { marginBottom: '2px' } }, actions),
            h(AnimatedDisclosure, { open: isOpen },
              v && v.loading ? h(Loading, { label: locale === 'zh' ? '正在读取来源…' : 'Reading source…' })
              : v && v.error ? h('div', { 'data-dam-error': '' }, v.error)
              : v ? h('div', null,
                h('div', { 'data-dam-content': '' }, v.content || t('empty')),
                v.imported !== undefined ? h('div', { 'data-dam-hint': '', style: { marginTop: '6px' } },
                  (locale === 'zh' ? '已接入位置：' : 'Imported at: ') + (v.imported ? (v.locations || []).join(' ; ') : (locale === 'zh' ? '尚未接入' : 'Not imported'))) : null,
                h('div', { 'data-dam-row': '', style: { marginTop: '8px' } },
                  h('button', { 'data-dam-btn': '', onClick: function () { findImported(s) } }, hitsBusyFor === s.id ? (locale === 'zh' ? '检索中…' : 'Searching…') : (locale === 'zh' ? '在记忆中查找' : 'Find in memory'))),
                hitsCache[s.id] ? h('div', { 'data-dam-content': '', style: { marginTop: '6px' } }, String(hitsCache[s.id])) : null,
                h('div', { 'data-dam-hint': '', style: { marginTop: '8px' } }, locale === 'zh' ? '提示：接入后按钮会变成「从 prompt 删除」，可单独删除用户级或项目笔记里的已导入段落；不会删除来源文件。' : 'Note: after import the button becomes "Delete" for that target; source files are never touched.'))
              : null)))
        })(sources[i])
      }
      return h('div', null,
        h('div', { 'data-dam-hint': '' }, t('connectHint')),
        h('div', { 'data-dam-row': '' },
          h('button', { 'data-dam-btn': '', onClick: importAll }, t('importAll')),
          h('button', { 'data-dam-btn': '', onClick: load }, t('rescan'))),
        msg ? h('div', null, msg) : null,
        err ? h('div', { 'data-dam-error': '' }, err) : null,
        cards)
    }

    // ───────────────────────── 拖动/缩放辅助 ─────────────────────────
    var dragActive = false
    function startPointerDrag(onMove, interactiveSel) {
      return function (e) {
        // 命中交互控件(按钮/输入框等)时不启动拖动
        if (interactiveSel && e.target && e.target.closest && e.target.closest(interactiveSel)) return
        e.preventDefault()
        e.stopPropagation()
        var startX = e.clientX
        var startY = e.clientY
        var moved = false
        function move(ev) {
          var dx = ev.clientX - startX
          var dy = ev.clientY - startY
          if (!moved && Math.abs(dx) < 2 && Math.abs(dy) < 2) return
          moved = true
          if (!dragActive) { dragActive = true; emit() }
          onMove(dx, dy)
        }
        function up() {
          window.removeEventListener('pointermove', move)
          window.removeEventListener('pointerup', up)
          if (dragActive) { dragActive = false; emit() }
          controller.flushGeom()
        }
        window.addEventListener('pointermove', move)
        window.addEventListener('pointerup', up)
      }
    }

    function TabScroller(props) {
      var tabs = props.tabs || []
      var tab = props.tab
      var setTab = props.setTab
      var viewportRef = useRef(null)
      var canLeftPair = useState(false)
      var canLeft = canLeftPair[0]
      var setCanLeft = canLeftPair[1]
      var canRightPair = useState(false)
      var canRight = canRightPair[0]
      var setCanRight = canRightPair[1]
      function refreshArrows() {
        var vp = viewportRef.current
        if (!vp) return
        setCanLeft(vp.scrollLeft > 2)
        setCanRight(vp.scrollLeft + vp.clientWidth < vp.scrollWidth - 2)
      }
      useEffect(function () {
        var vp = viewportRef.current
        if (!vp) return
        refreshArrows()
        vp.addEventListener('scroll', refreshArrows)
        var ro = null
        if (typeof ResizeObserver !== 'undefined') { try { ro = new ResizeObserver(refreshArrows); ro.observe(vp) } catch (e) {} }
        return function () { vp.removeEventListener('scroll', refreshArrows); if (ro) ro.disconnect() }
      }, [tabs.length])
      useEffect(function () {
        var vp = viewportRef.current
        if (!vp) return
        var activeEl = vp.querySelector('[data-active="true"]')
        if (!activeEl) return
        var l = activeEl.offsetLeft, w = activeEl.offsetWidth
        if (l < vp.scrollLeft) vp.scrollTo({ left: Math.max(0, l - 8), behavior: 'smooth' })
        else if (l + w > vp.scrollLeft + vp.clientWidth) vp.scrollTo({ left: l + w - vp.clientWidth + 8, behavior: 'smooth' })
      }, [tab])
      function step(dir) {
        var vp = viewportRef.current
        if (!vp) return
        try { vp.scrollBy({ left: dir * Math.max(90, vp.clientWidth * 0.6), behavior: 'smooth' }) } catch (e) { vp.scrollLeft += dir * 90 }
      }
      return h('div', { 'data-dam-tabs-wrap': '' },
        h('button', { 'data-dam-tabs-arrow': '', title: locale === 'zh' ? '向左滚动模块' : 'Scroll modules left', 'aria-label': locale === 'zh' ? '向左滚动模块' : 'Scroll modules left', disabled: !canLeft, onClick: function () { step(-1) } }, '‹'),
        h('div', { 'data-dam-tabs': '', ref: viewportRef }, h('div', { 'data-dam-tab-strip': '' }, tabs.map(function (item) { return h('button', { key: item[0], 'data-dam-tab': '', 'data-active': tab === item[0] ? 'true' : undefined, onClick: function () { setTab(item[0]) } }, item[1]) }))),
        h('button', { 'data-dam-tabs-arrow': '', title: locale === 'zh' ? '向右滚动模块' : 'Scroll modules right', 'aria-label': locale === 'zh' ? '向右滚动模块' : 'Scroll modules right', disabled: !canRight, onClick: function () { step(1) } }, '›'))
    }

    function MemoryPanel() {
      var tick = useTick()
      var tabPair = useState('overview')
      var tab = tabPair[0]
      var setTab = tabPair[1]
      // 刷新 nonce:每次打开面板 / 点 ⟳ 时递增,驱动各页签重拉数据
      var noncePair = useState(0)
      var nonce = noncePair[0]
      var setNonce = noncePair[1]
      var g = controller.geom()
      useEffect(function () { return controller.subscribe(tick[1]) }, [])
      if (!panelOpen && !panelClosing) return null
      var body
      if (tab === 'overview') body = h(OverviewTab, { nonce: nonce })
      else if (tab === 'logs') body = h(LogsTab)
      else if (tab === 'notes') body = h(NotesTab)
      else if (tab === 'reflections') body = h(ReflectionsTab)
      else if (tab === 'connect') body = h(ConnectTab)
      else if (tab === 'calendar') body = h(CalendarTab)
      else if (tab === 'workspaces') body = h(WorkspaceTab)
      else body = h(SearchTab)
      var tabs = [['overview', t('overview')], ['logs', t('logs')], ['notes', t('notes')], ['reflections', t('reflections')], ['connect', t('connect')], ['calendar', t('calendar')], ['search', t('search')], ['workspaces', t('workspaces')]]
      var style = {
        left: g.left + 'px',
        top: g.top + 'px',
        width: g.width + 'px',
        height: g.height + 'px',
        '--dam-scale': FONT_SCALE_VALUES[fontScale] || '1',
        '--dam-accent': ACCENT_VALUES[accentTheme] || ACCENT_VALUES.deepseek,
      }
      var dragMove = startPointerDrag(function (dx, dy) {
        controller.setGeom({ left: g.left + dx, top: g.top + dy })
      }, '[data-dam-btn], [data-dam-tab], [data-dam-input], [data-dam-select], textarea')
      var resizeMove = startPointerDrag(function (dx, dy) {
        controller.setGeom({ width: g.width + dx, height: g.height + dy })
      })
      return h('div', {
        'data-dam-panel': '',
        'data-scale': fontScale in FONT_SCALES ? fontScale : 'md',
        style: style,
        'data-closing': panelClosing ? 'true' : undefined,
        'data-dragging': dragActive ? 'true' : undefined,
      },
        h('header', {
          title: t('dragMove'),
          onPointerDown: dragMove,
        },
          h('strong', null, t('autoMemory')),
          h('span', { 'data-dam-hint': '', style: { fontSize: '10px', opacity: .55 } }, 'v0.1.23-ui'),
          h('span', { className: 'dam-spacer' }),
          h('button', { 'data-dam-btn': '', title: t('resetPos'), onClick: function () { controller.resetGeom() } }, '⤾'),
          h('button', { 'data-dam-btn': '', title: t('refresh'), onClick: function () { setNonce(nonce + 1) } }, '⟳'),
          h('button', { 'data-dam-btn': '', title: t('close'), onClick: function () { controller.close() } }, '✕')),
        h(TabScroller, { tabs: tabs, tab: tab, setTab: setTab }),
        h('div', { 'data-dam-body': '' }, body),
        h('div', { 'data-dam-resize': '', title: t('dragResize'), onPointerDown: resizeMove }))
    }

    // ───────────────────────── 调试中心(为提 issue 提供诊断) ─────────────────────────
    function DebugCenter() {
      var dataPair = useState(null)
      var data = dataPair[0]
      var setData = dataPair[1]
      var probesPair = useState(null)
      var probes = probesPair[0]
      var setProbes = probesPair[1]
      var busyPair = useState(false)
      var busy = busyPair[0]
      var setBusy = busyPair[1]
      var scanPair = useState(null)
      var scan = scanPair[0]
      var setScan = scanPair[1]
      var scanBusyPair = useState(false)
      var scanBusy = scanBusyPair[0]
      var setScanBusy = scanBusyPair[1]
      var scanFiles = scan && scan.files ? scan.files : null
      var filesTotal = scan && scan.files ? scan.files.length : 0
      var totalFindings = scan ? (scan.totalFindings || 0) : 0
      var scanError = scan && scan.error ? scan.error : ''
      function runScan() {
        if (scanBusy) return
        setScanBusy(true)
        setScan(null)
        fetch(API.scanDirty).then(function (r) { return r.json() }).then(function (d) {
          setScan(d || {})
          setScanBusy(false)
        }).catch(function (e) { setScan({ error: String(e && e.message || e) }); setScanBusy(false) })
      }
      function refresh() {
        if (busy) return
        setBusy(true)
        var probesDone = {}
        var probeList = [
          ['state', API.state, 'GET'], ['config', API.config, 'GET'], ['list', API.list, 'GET'],
          ['file', API.file, 'GET'], ['calendar', API.calendar, 'GET'], ['debug', API.debug, 'GET'],
          ['recall', API.recall, 'POST'], ['summarize', API.summarize, 'POST'], ['greet', API.greet, 'POST'],
          ['workspaces', API.workspaces, 'POST'], ['reflectAuto', API.reflectAuto, 'POST'],
        ]
        Promise.all(probeList.map(function (pr) {
          var t0 = Date.now()
          return fetch(pr[1], pr[2] === 'POST' ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' } : undefined)
            .then(function (r) { probesDone[pr[0]] = { status: r.status, ms: Date.now() - t0 } })
            .catch(function (e) { probesDone[pr[0]] = { error: e.message } })
        })).then(function () {
          setProbes(probesDone)
          return apiGet(API.debug)
        }).then(function (d) { setData(d); setBusy(false) }).catch(function () { setBusy(false) })
      }
      useEffect(function () { refresh() }, [])
      if (!data) return h('div', { 'data-dam-hint': '' }, t('dbgLoading'))
      function kv(label, value, warn) {
        return h('div', { 'data-dam-row': '', style: { marginBottom: '3px' } },
          h('span', { style: { flex: '0 0 140px', opacity: .7, fontSize: 'calc(11.5px * var(--dam-scale))' } }, label),
          h('span', { style: { fontSize: 'calc(11.5px * var(--dam-scale))', wordBreak: 'break-all', color: warn ? 'var(--dsw-alias-state-warn-primary, #e6a23c)' : undefined } }, String(value)))
      }
      var hb = data.heartbeat || {}
      var hbAge = hb.exists && hb.heartbeatAt ? Math.round((Date.now() - hb.heartbeatAt) / 1000) : -1
      var apiBad = probes && Object.keys(probes).some(function (k) { return probes[k].status === 404 || probes[k].error })
      return h('div', null,
        h('div', { 'data-dam-row': '' },
          h('button', { 'data-dam-btn': '', onClick: refresh, disabled: busy }, busy ? t('dbgRefreshing') : t('dbgRefresh')),
          h('span', { 'data-dam-hint': '' }, data.host.indexPath || '')),
        kv(t('kvVersion'), data.host.version || t('kvUnreadable'), false),
        kv(t('kvPid'), data.host.pid + ' / ' + (data.host.startTime ? new Date(data.host.startTime).toLocaleTimeString() : ''), false),
        kv(t('kvRestart'), data.host.needsRestart ? t('kvRestartYes') : t('kvRestartNo'), data.host.needsRestart),
        kv(t('kvHeartbeat'), hb.exists ? (hbAge >= 0 ? t('hbAliveAgo') + hbAge + t('hbSecAgo') : t('hbAlive')) : t('hbNone'), !hb.exists || hbAge > 360),
        kv(t('kvQueue'), data.autoConsolidate.pendingQueue + t('kvCountSuffix'), data.autoConsolidate.pendingQueue > 0),
        kv(t('kvToday'), data.autoConsolidate.stats.count + t('kvRecentPrefix') + (data.autoConsolidate.stats.lastAt ? new Date(data.autoConsolidate.stats.lastAt).toLocaleTimeString() : '—'), false),
        kv(t('kvBusy'), data.autoConsolidate.consolidating ? t('kvYes') : t('kvNo'), data.autoConsolidate.consolidating),
        kv('subagents', data.subagents.available ? (data.subagents.providers.join(', ') || t('kvAvail')) : t('kvUnavail'), !data.subagents.available),
        kv(t('kvDup'), data.duplicateHeadings + t('kvDupCount'), data.duplicateHeadings > 0),
        kv(t('kvMem'), t('kvMemUser') + ' ' + (data.memoryFiles.user.exists ? fmtSize(data.memoryFiles.user.size) : t('kvMemMissing')) + ' · ' + t('kvMemNotes') + ' ' + (data.memoryFiles.notes.exists ? fmtSize(data.memoryFiles.notes.size) : t('kvMemMissing')) + ' · ' + t('kvMemLog') + ' ' + (data.memoryFiles.log.exists ? fmtSize(data.memoryFiles.log.size) : t('kvMemMissing')), !data.memoryFiles.log.exists),
        kv(t('kvWs'), currentWs() || t('kvWsUnknown'), false),
        kv(t('kvApi'), probes ? Object.keys(probes).map(function (k) { return k + '=' + (probes[k].status !== undefined ? probes[k].status : probes[k].error) }).join('  ') : '…', apiBad),
        h('div', { 'data-dam-row': '', style: { marginTop: '6px', alignItems: 'flex-start', flexDirection: 'column' } },
          h('div', { 'data-dam-row': '' },
            h('button', { 'data-dam-btn': '', title: 'prion-scan 式四类启发式,只报位置不含正文', onClick: runScan, disabled: scanBusy }, scanBusy ? (locale === 'zh' ? '扫描中…' : 'Scanning…') : (locale === 'zh' ? '扫描脏 token' : 'Scan dirty tokens')),
            h('span', { 'data-dam-hint': '', style: { marginLeft: '8px' } }, scanError ? scanError : (scan === null ? (locale === 'zh' ? '检查用户级/笔记/日志/反思的 mojibake / raw JSON / 超长行 / base64 / 重复块' : 'Check user/notes/log/reflections: mojibake, raw JSON, long lines, base64, duplicates') : (scanFiles && scanFiles.length ? (locale === 'zh' ? '共 ' + filesTotal + ' 个文件,命中 ' + totalFindings + ' 处' : filesTotal + ' files, ' + totalFindings + ' findings') : (locale === 'zh' ? '✓ 未发现脏 token' : '✓ no dirty tokens'))))),
          scanFiles && scanFiles.length ? scanFiles.map(function (sf) {
            return h('div', { 'data-dam-row': '', style: { alignItems: 'flex-start', flexDirection: 'column', gap: '2px', marginTop: '4px' } },
              h('span', { style: { fontWeight: 600, fontSize: 'calc(11px * var(--dam-scale))' } }, sf.name + ' [' + sf.sizeKB + 'KB, ' + sf.lines + ' 行]'),
              sf.findings.map(function (fd) { return h('div', { 'data-dam-hint': '', style: { whiteSpace: 'pre-wrap' } }, '行 ' + fd.range + ' ｜ ' + fd.type) }))
          }) : null))
    }

    // ───────────────────────── 更新弹窗 / 首次指导(毛玻璃) ─────────────────────────
    function DialogHost() {
      var tickPair = useTick()
      useEffect(function () { return onDialog(tickPair[1]) }, [])
      if (!dialogState) return null
      // 左下角小卡片(记忆按钮上方),高透明毛玻璃,不遮全屏
      var overlay = { position: 'fixed', left: '10px', bottom: '64px', zIndex: 2147483000, width: 'min(360px, calc(100vw - 20px))', maxHeight: 'min(46vh, 430px)', display: 'flex', flexDirection: 'column' }
      var box = {
        overflow: 'auto', borderRadius: '14px', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '6px',
        background: 'color-mix(in srgb, var(--dsw-alias-bg-overlay, rgba(24,26,32,.9)) 58%, transparent)',
        backdropFilter: 'blur(14px) saturate(1.3)', WebkitBackdropFilter: 'blur(14px) saturate(1.3)',
        border: '1px solid color-mix(in srgb, var(--dsw-alias-border-l1, rgba(128,128,128,.35)) 45%, transparent)',
        boxShadow: '0 8px 28px rgba(0,0,0,.18)',
      }
      var head = { fontSize: 'calc(13px * var(--dam-scale))', fontWeight: 700, color: 'var(--dsw-alias-text-primary, inherit)' }
      var sub = { fontSize: 'calc(11px * var(--dam-scale))', opacity: .7 }
      var item = { fontSize: 'calc(11px * var(--dam-scale))', lineHeight: 1.55, padding: '1px 0 1px 16px', position: 'relative' }
      var close = { alignSelf: 'flex-end', padding: '4px 16px', borderRadius: '8px', border: '1px solid color-mix(in srgb, var(--dsw-alias-border-l1, rgba(128,128,128,.35)) 45%, transparent)', background: 'color-mix(in srgb, var(--dsw-alias-brand-primary, #4f7cff) 12%, transparent)', color: 'var(--dsw-alias-text-primary, inherit)', cursor: 'pointer', fontSize: 'calc(11.5px * var(--dam-scale))' }
      var dot = { position: 'absolute', left: '0', top: '10px', width: '7px', height: '7px', borderRadius: '50%', background: 'var(--dsw-alias-brand-primary, #4f7cff)' }
      if (dialogState.kind === 'first') {
        var feats = [t('gFeat1'), t('gFeat2'), t('gFeat3'), t('gFeat4'), t('gFeat5'), t('gFeat6')]
        return h('div', { style: overlay },
          h('div', { style: box },
            h('div', { style: head }, t('guideTitle')),
            h('div', { style: sub }, t('guideSub')),
            feats.map(function (f) { return h('div', { style: item }, h('span', { style: dot }), f) }),
            h('div', { style: { fontSize: 'calc(12px * var(--dam-scale))', opacity: .8, marginTop: '4px' } }, t('guideTip')),
            h('button', { 'data-dam-btn': '', style: close, onClick: function () {
              try {
                localStorage.setItem('dsh-auto-memory.firstRunDone', '1')
                if (dialogState && dialogState.currentVersion) localStorage.setItem('dsh-auto-memory.seenVersion', dialogState.currentVersion)
              } catch (e3) {}
              closeDialog()
            } }, t('gotIt'))))
      }
      if (dialogState.kind === 'notice') {
        var n = dialogState.notice || {}
        var zh = locale === 'zh' || !n.titleEn
        var nTitle = zh ? (n.title || '') : (n.titleEn || n.title || '')
        var nMsg = zh ? (n.message || '') : (n.messageEn || n.message || '')
        var isUrgent = n.level === 'urgent'
        var accent = isUrgent ? 'var(--dsw-alias-danger, #e5534b)' : 'var(--dsw-alias-brand-primary, #4f7cff)'
        return h('div', { style: overlay },
          h('div', { style: box },
            h('div', { style: Object.assign({}, head, isUrgent ? { color: accent } : {}) }, nTitle),
            h('div', { style: { fontSize: 'calc(12px * var(--dam-scale))', lineHeight: 1.6, opacity: .92, whiteSpace: 'pre-wrap', marginTop: '4px' } }, nMsg),
            h('div', { style: { display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '6px' } },
              n.link ? h('a', { href: n.link, target: '_blank', rel: 'noreferrer', style: Object.assign({}, close, { textDecoration: 'none' }) }, t('noticeOpen')) : null,
              h('button', { 'data-dam-btn': '', style: close, onClick: function () {
                try {
                  var arr = []
                  try { arr = JSON.parse(localStorage.getItem('dsh-auto-memory.seenNotices') || '[]') } catch (e3) {}
                  if (n.id && arr.indexOf(n.id) < 0) arr.push(n.id)
                  localStorage.setItem('dsh-auto-memory.seenNotices', JSON.stringify(arr))
                } catch (e3) {}
                closeDialog()
              } }, t('gotIt')))))
      }
      if (dialogState.kind === 'welcomeBack') {
        return h('div', { style: overlay },
          h('div', { style: box },
            h('div', { style: head }, t('awayTitle')),
            h('div', { style: { fontSize: 'calc(12px * var(--dam-scale))', lineHeight: 1.6, opacity: .92, marginTop: '4px' } }, t('awayMsg')),
            h('div', { style: { display: 'flex', justifyContent: 'flex-end', marginTop: '6px' } },
              h('button', { 'data-dam-btn': '', style: close, onClick: closeDialog }, t('gotIt')))))
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
              h('button', { 'data-dam-btn': '', style: close, onClick: closeDialog }, t('gotIt')))))
      }
      var versions = dialogState.versions || []
      var lastV = versions.length ? versions[versions.length - 1].version : ''
      return h('div', { style: overlay },
        h('div', { style: box },
          h('div', { style: head }, t('updateTitle') + ' v' + lastV),
          h('div', { style: sub }, t('updateSub')),
          versions.map(function (v) {
            var items = (v.items && (v.items[locale] || v.items.zh)) || []
            return h('div', null,
              h('div', { style: { fontSize: 'calc(13px * var(--dam-scale))', fontWeight: 700, margin: '6px 0 2px', opacity: .9 } }, 'v' + v.version),
              items.map(function (it) { return h('div', { style: item }, h('span', { style: dot }), it) }))
          }),
          h('button', { 'data-dam-btn': '', style: close, onClick: function () {
            try { if (lastV) localStorage.setItem('dsh-auto-memory.seenVersion', lastV) } catch (e3) {}
            closeDialog()
          } }, t('gotIt'))))
    }

    // ───────────────────────── 设置页 ─────────────────────────
    var STYLE_IDS = ['auto', 'life', 'professional']
    var LOCALE_IDS_LIST = ['system', 'zh', 'en']
    function SettingsPage() {
      var tickPair = useTick()
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
      var settingsSectionPair = useState('appearance')
      var settingsSection = settingsSectionPair[0]
      var setSettingsSection = settingsSectionPair[1]
      var browseOpenPair = useState(false)
      var browseOpen = browseOpenPair[0]
      var setBrowseOpen = browseOpenPair[1]
      var browsePathPair = useState('')
      var browsePath = browsePathPair[0]
      var setBrowsePath = browsePathPair[1]
      var browseParentPair = useState('')
      var browseParent = browseParentPair[0]
      var setBrowseParent = browseParentPair[1]
      var browseDirsPair = useState(null)
      var browseDirs = browseDirsPair[0]
      var setBrowseDirs = browseDirsPair[1]
      function browseTo(p) {
        setBrowsePath(p)
        apiPost(API.browseDir, { path: p }).then(function (d) {
          if (d) { setBrowsePath(d.path); setBrowseParent(d.parent); setBrowseDirs(d.dirs || []) }
        }).catch(function () { setBrowseDirs([]) })
      }
      function openBrowser() {
        // 优先弹系统原生文件夹选择器(native 后端);不可用(远程/无显示)回退内嵌浏览
        apiPost(API.pickDir, {}).then(function (d) {
          if (d && d.native && d.dir) {
            set('memoryRoot', d.dir)
            setMsg(t('pickedDir') + ' ' + d.dir + ' ' + t('rememberSave'))
          } else if (d && d.native) {
            // 用户在系统对话框点了取消:保持原值,不动作
          } else {
            setMsg(t('pickerUnavailable'))
            setBrowseOpen(true)
            browseTo(cfg.memoryRoot || '')
          }
        }).catch(function () {
          setMsg(t('pickerUnavailable'))
          setBrowseOpen(true)
          browseTo(cfg.memoryRoot || '')
        })
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
        apiGet(API.config).then(function (d) { if (alive) setCfg(d.config) }).catch(function (e) { setErr(e.message) })
        // 打开设置页自动检查更新(host 有 12h 缓存,不重复查网)
        apiGet(API.updateCheck).then(function (d) { if (alive) setVerInfo(d) }).catch(function () {})
        return function () { alive = false }
      }, [])
      if (!cfg) return err ? h('div', { 'data-dam-error': '' }, err) : h(Loading)
      function set(key, value) { var next = Object.assign({}, cfg); next[key] = value; setCfg(next); setDirty(true) }
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
        if (busy) return
        setBusy(true); setMsg(''); setErr('')
        apiPost(API.config, cfg).then(function (d) { setCfg(d.config); setDirty(false); setMsg(t('saved') + (d.migrated ? ' ' + d.migrated : '')); setBusy(false); if (d && d.config && d.config.locale) applyLocalePref(d.config.locale) })
          .catch(function (e) { setErr(e.message); setBusy(false) })
      }
      function field(label, control, hint) {
        return h('div', { 'data-dam-settings-row': '' },
          h('div', { 'data-dam-row': '' }, h('label', null, label), control),
          hint ? h('div', { 'data-dam-hint': '' }, hint) : null)
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
      var sectionLabels = {
        appearance: locale === 'zh' ? '外观' : 'Appearance', storage: locale === 'zh' ? '存储' : 'Storage',
        injection: locale === 'zh' ? '记忆窗口' : 'Memory window', automation: locale === 'zh' ? '自动化' : 'Automation',
        maintenance: locale === 'zh' ? '维护' : 'Maintenance'
      }
      function section(key, title, content) { return h('section', { id: 'dam-settings-' + key, 'data-dam-settings-group': '' }, h('h3', null, title), content) }
      function jumpToSection(key) {
        setSettingsSection(key)
        try { var el = document.getElementById('dam-settings-' + key); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }) } catch (e) {}
      }
      return h('div', { 'data-dam-settings': '' },
        h('nav', { 'data-dam-settings-nav': '', 'aria-label': locale === 'zh' ? '设置分组' : 'Settings sections' }, Object.keys(sectionLabels).map(function (key) {
          return h('button', { key: key, 'data-dam-btn': '', 'data-active': settingsSection === key ? 'true' : undefined, onClick: function () { jumpToSection(key) } }, sectionLabels[key])
        })),
        h('div', { 'data-dam-settings-content': '' },
        section('appearance', sectionLabels.appearance, [
          h('div', { 'data-dam-hint': '' }, t('settingsHeader')),
          field(t('fLocale'), h('select', { 'data-dam-select': '', value: cfg.locale || 'system', onChange: function (e) { set('locale', e.target.value) } },
            LOCALE_IDS_LIST.map(function (id) { return h('option', { key: id, value: id }, id === 'system' ? t('followSystem') : t(id)) })), t('fLocaleHint')),
          field(t('fFontSize'), h('select', { 'data-dam-select': '', value: fontScale, onChange: function (e) { fontScale = e.target.value; try { localStorage.setItem('dsh-auto-memory.fontScale.v2', fontScale) } catch (ee) {}; try { var pp = document.querySelector('[data-dam-panel]'); if (pp) pp.style.setProperty('--dam-scale', FONT_SCALE_VALUES[fontScale] || '1') } catch (ee2) {}; emit() } },
            Object.keys(FONT_SCALES).map(function (k) { return h('option', { key: k, value: k }, t('fs' + k.charAt(0).toUpperCase() + k.slice(1))) })), t('fFontSizeHint')),
          field(locale === 'zh' ? '强调色' : 'Accent color', h('select', { 'data-dam-select': '', value: accentTheme, onChange: function (e) { setAccent(e.target.value) } },
            h('option', { value: 'deepseek' }, locale === 'zh' ? 'DeepSeek 蓝' : 'DeepSeek blue'), h('option', { value: 'graphite' }, locale === 'zh' ? '石墨灰' : 'Graphite'), h('option', { value: 'violet' }, locale === 'zh' ? '雾紫' : 'Violet')), locale === 'zh' ? '默认使用 DeepSeek 蓝；日历与状态颜色保持语义色。' : 'DeepSeek blue by default; calendar and status colors stay semantic.'),
          field(locale === 'zh' ? '关系图密度' : 'Graph density', h('select', { 'data-dam-select': '', value: graphDensity, onChange: function (e) { setDensity(e.target.value) } },
            h('option', { value: 'relaxed' }, locale === 'zh' ? '舒展' : 'Relaxed'), h('option', { value: 'compact' }, locale === 'zh' ? '紧凑' : 'Compact')), locale === 'zh' ? '影响工作区关系图的节点间距和显示数量。' : 'Controls node spacing and detail in the workspace graph.')
        ]),
        section('storage', sectionLabels.storage, [field(t('fUserDir'), h('input', { 'data-dam-input': '', value: cfg.userMemoryDir, onChange: function (e) { set('userMemoryDir', e.target.value) } }), t('fUserDirHint')),
        field(t('fProjectDir'), h('input', { 'data-dam-input': '', value: cfg.projectMemoryDir, onChange: function (e) { set('projectMemoryDir', e.target.value) } }), t('fProjectDirHint')),
        field(t('fMemoryRoot'), h('div', { 'data-dam-row': '', style: { flex: 1 } },
          h('input', { 'data-dam-input': '', style: { flex: 1 }, value: cfg.memoryRoot || '', onChange: function (e) { set('memoryRoot', e.target.value) } }),
          h('button', { 'data-dam-btn': '', onClick: function () { openBrowser() } }, t('fBrowse'))), t('fMemoryRootHint')),
        browseOpen ? h('div', { style: { border: '1px solid color-mix(in srgb, var(--dsw-alias-border-l1, rgba(128,128,128,.25)) 60%, transparent)', borderRadius: '8px', padding: '8px', marginBottom: '8px', background: 'color-mix(in srgb, var(--dsw-alias-bg-layer-1, rgba(128,128,128,.06)) 40%, transparent)' } },
          h('div', { 'data-dam-row': '' },
            h('b', { style: { fontSize: 'calc(12px * var(--dam-scale))', wordBreak: 'break-all', flex: 1 } }, browsePath || '…'),
            h('button', { 'data-dam-btn': '', onClick: function () { browseTo(browseParent) }, disabled: browseParent === browsePath }, t('fUp'))),
          h('div', { style: { maxHeight: '160px', overflow: 'auto', marginTop: '4px' } },
            (browseDirs || []).map(function (d) {
              return h('button', { key: d.path, 'data-dam-btn': '', style: { display: 'block', width: '100%', textAlign: 'left', padding: '3px 6px' }, onClick: function () { browseTo(d.path) } }, '📁 ' + d.name)
            }).concat(browseDirs && !browseDirs.length ? [h('div', { key: 'e', 'data-dam-hint': '' }, t('empty'))] : [])),
          h('div', { 'data-dam-row': '', style: { marginTop: '6px' } },
            h('button', { 'data-dam-btn': '', onClick: function () { set('memoryRoot', browsePath); setBrowseOpen(false) } }, t('fSelectDir')),
            h('button', { 'data-dam-btn': '', onClick: function () { setBrowseOpen(false) } }, t('close'))))
          : null]),
        section('injection', sectionLabels.injection, [field(t('fInject'), h('input', { type: 'checkbox', checked: !!cfg.injectEnabled, onChange: function (e) { set('injectEnabled', e.target.checked) } }), t('fInjectHint')),
        field(t('fBudget'), h('input', { 'data-dam-input': '', type: 'number', min: 400, value: cfg.injectBudgetChars, onChange: function (e) { set('injectBudgetChars', Number(e.target.value) || 2400) } }), t('fBudgetHint')),
        field(t('fDays'), h('input', { 'data-dam-input': '', type: 'number', min: 1, max: 14, value: cfg.recentDaysInjected, onChange: function (e) { set('recentDaysInjected', Number(e.target.value) || 1) } }), t('fDaysHint')),
        field(t('fExtBudget'), h('input', { 'data-dam-input': '', type: 'number', min: 200, value: cfg.externalInjectionChars === undefined ? 1400 : cfg.externalInjectionChars, onChange: function (e) { set('externalInjectionChars', Number(e.target.value) || 1400) } }), t('fExtBudgetHint'))]),
        section('automation', sectionLabels.automation, [field(t('fConsolidateMin'), h('input', { 'data-dam-input': '', type: 'number', min: 80, value: cfg.autoConsolidateMinChars === undefined ? 240 : cfg.autoConsolidateMinChars, onChange: function (e) { set('autoConsolidateMinChars', Number(e.target.value) || 240) } }), t('fConsolidateMinHint')),
        field(t('fAutoConsolidate'), h('input', { type: 'checkbox', checked: cfg.autoConsolidate !== false, onChange: function (e) { set('autoConsolidate', e.target.checked) } }), t('fAutoConsolidateHint')),
        field(t('fConsolidate'), h('input', { 'data-dam-input': '', type: 'number', min: 5, value: cfg.autoConsolidateCooldownMinutes === undefined ? 30 : cfg.autoConsolidateCooldownMinutes, onChange: function (e) { set('autoConsolidateCooldownMinutes', Number(e.target.value) || 30) } }), t('fConsolidateHint')),
        field(t('fConsolidateMax'), h('input', { 'data-dam-input': '', type: 'number', min: 1, max: 50, value: cfg.autoConsolidateDailyMax === undefined ? 8 : cfg.autoConsolidateDailyMax, onChange: function (e) { set('autoConsolidateDailyMax', Number(e.target.value) || 8) } }), t('fConsolidateMaxHint')),
        field(t('fAway'), h('input', { 'data-dam-input': '', type: 'number', min: 1, value: cfg.awayMinutes || 60, onChange: function (e) { set('awayMinutes', Number(e.target.value) || 60) } }), t('fAwayHint')),
        field(t('fAutoSum'), h('input', { 'data-dam-input': '', value: (cfg.autoSummaryTimes || []).join(','), onChange: function (e) { set('autoSummaryTimes', String(e.target.value || '').split(',').map(function (s) { return s.trim() }).filter(Boolean)) } }), t('fAutoSumHint')),
        field(t('fDayBoundary'), h('input', { 'data-dam-input': '', type: 'number', min: 0, max: 1439, value: (cfg.dayBoundaryMinutes === undefined ? 450 : cfg.dayBoundaryMinutes), onChange: function (e) { set('dayBoundaryMinutes', parseInt(e.target.value || '0', 10)) } }), t('fDayBoundaryHint')),
        field(t('fReflect'), h('input', { type: 'checkbox', checked: !!cfg.reflectEnabled, onChange: function (e) { set('reflectEnabled', e.target.checked) } }), t('fReflectHint')),
        field(t('fStyle'), h('select', { 'data-dam-select': '', value: cfg.reflectStyle, onChange: function (e) { set('reflectStyle', e.target.value) } },
          STYLE_IDS.map(function (id) { return h('option', { key: id, value: id }, t('style' + id.charAt(0).toUpperCase() + id.slice(1))) })), t('fStyleHint'))]),
        section('maintenance', sectionLabels.maintenance, [field(t('fVersion'), h('div', { 'data-dam-row': '' },
          h('span', { style: { flex: 1 } }, verInfo ? (verInfo.current || '?') + (verInfo.latest ? ' → ' + verInfo.latest + (verInfo.upToDate ? ' ' + t('upToDate') : ' ' + t('hasUpdate')) : '') : (checkingUpdate ? t('checking') : '—')),
          h('button', { 'data-dam-btn': '', onClick: checkUpdate, disabled: checkingUpdate }, checkingUpdate ? t('checking') : t('checkUpdate')),
          (verInfo && verInfo.latest && !verInfo.upToDate && verInfo.installKind === 'registry') ? h('button', { 'data-dam-btn': '', onClick: doUpdate, disabled: upBusy, style: { marginLeft: '4px' } }, upBusy ? t('updating') : t('updateNow')) : null,
          upMsg ? h('span', { 'data-dam-hint': '' }, upMsg) : null),
          t('versionCmdHint') + (verInfo && verInfo.error ? ' ' + t('versionError') + verInfo.error : '') + (verInfo && verInfo.installKind === 'dev-link' ? ' ' + t('devLinkHint') : '') + (verInfo && !verInfo.installKind ? ' ' + t('noProfileHint') : ''))]),
        h('div', { 'data-dam-savebar': '' },
          h('button', { 'data-dam-btn': '', 'data-dirty': dirty ? 'true' : undefined, onClick: save, disabled: busy }, busy ? t('saving') : (dirty ? (locale === 'zh' ? '保存更改' : 'Save changes') : t('saveSettings'))),
          dirty ? h('span', { 'data-dam-hint': '' }, locale === 'zh' ? '有未保存的更改' : 'Unsaved changes') : null,
          msg ? h('span', { 'data-dam-hint': '' }, msg) : null),
        // 调试中心(折叠):模块状态一览,方便排查问题/提 issue
        h('div', { style: { marginTop: '14px', borderTop: '1px solid color-mix(in srgb, var(--dsw-alias-border-l1, rgba(128,128,128,.2)) 55%, transparent)', paddingTop: '10px' } },
          h('button', { 'data-dam-btn': '', onClick: function () { setDbgOpen(!dbgOpen) } }, (dbgOpen ? '▴ ' : '▾ ') + t('debugCenter')),
          dbgOpen ? h('div', { style: { marginTop: '8px' } }, h(DebugCenter)) : null),
        err ? h('div', { 'data-dam-error': '' }, err) : null))
    }

    // ───────────────────────── 插件挂载 ─────────────────────────
    function apply(ctx) {
      try { ensureStyle() } catch (e) { console.warn('[dsh-auto-memory] style inject failed', e) }
      ctx.effect(function () {
        return function () {
          var tag = document.getElementById(STYLE_ID)
          if (tag) tag.remove()
          if (closeTimer) { clearTimeout(closeTimer); closeTimer = null }
        }
      }, 'dsh-auto-memory: styles')

      var slots = ctx.slots
      if (!slots) { console.warn('[dsh-auto-memory] slots service unavailable'); return }
      sessions = ctx.sessions

      // 初始化界面字号(本地偏好,localStorage 持久化)
      try {
        var savedScale = localStorage.getItem('dsh-auto-memory.fontScale.v2')
        if (savedScale in FONT_SCALES) fontScale = savedScale
      } catch (e3) {}
      // 界面语言:默认跟随 DSH 系统语言(config.locale 可手动指定 zh / en / system)
      try {
        var sl0 = ctx.locale && ctx.locale.getLocale ? ctx.locale.getLocale() : null
        if (sl0 && sl0.active) sysLocale = sl0.active
      } catch (e) {}
      applyLocalePref('system')
      apiGet(API.config).then(function (d) {
        if (d && d.config && d.config.locale) applyLocalePref(d.config.locale)
      }).catch(function () {})
      // DSH 系统语言变化:跟随更新 + 重渲染 + 重注册入口 label
      ctx.on('locale/change', function (snap) {
        try {
          if (snap && snap.active && snap.active !== sysLocale) {
            sysLocale = snap.active
            if (localeMode !== 'zh' && localeMode !== 'en') { locale = sysLocale; emit() }
            refreshSurfaces()
          }
        } catch (e) {}
      })
      // 语言切换时通知所有订阅者重渲染
      onLocale(function () { emit() })
      // 暂离回来自动弹开记忆窗口:host 判定暂离(阈值可配 awayMinutes),页面加载/切回标签页/轮询发现回归时自动打开
      // 回归检测:host away 状态从 true → false(暂离结束)时打开并欢迎
      var prevAwayState = null
      function autoOpenOnReturn() {
        try {
          if (hostAwayReady && prevAwayState === true && hostAway === false) {
            // 暂离回归:打开窗口 + 欢迎弹窗(若有待展示总结一并显示)
            if (!controller.isOpen()) controller.open()
            var pend = lastPendingSummary
            if (pend) { openDialog({ kind: 'summary', summary: pend }); lastPendingSummary = null }
            else if (!document.hidden) openDialog({ kind: 'welcomeBack' })
            prevAwayState = hostAway
            return
          }
          prevAwayState = hostAwayReady ? hostAway : prevAwayState
          if (isAway() && !controller.isOpen()) controller.open()
        } catch (e) {}
      }
      autoOpenOnReturn()
      try {
        document.addEventListener('visibilitychange', function () {
          if (!document.hidden) autoOpenOnReturn()
        })
      } catch (e) {}
      // 更新弹窗 / 首次指导:对比本地记录的已见版本,有更新或首次安装时弹窗(host 12h 缓存,不重复查网)
      apiGet(API.updateCheck).then(function (d) {
        if (d && d.current) {
          try {
            var seen = localStorage.getItem('dsh-auto-memory.seenVersion')
            if (!seen && !localStorage.getItem('dsh-auto-memory.firstRunDone')) {
              openDialog({ kind: 'first', currentVersion: d.current })
            } else if (seen && seen !== d.current) {
              var versions = changelogBetween(seen, d.current)
              if (versions.length) openDialog({ kind: 'update', versions: versions, currentVersion: d.current })
              else try { localStorage.setItem('dsh-auto-memory.seenVersion', d.current) } catch (e3) {}
            } else if (!seen && localStorage.getItem('dsh-auto-memory.firstRunDone')) {
              try { localStorage.setItem('dsh-auto-memory.seenVersion', d.current) } catch (e3) {}
            }
          } catch (e) {}
        }
      }).catch(function () {})

      // 动态通知(发布者→用户:重大 bug 提醒,不依赖发版):启动检查 + 每小时刷新;按 id 去重,urgent 优先
      function checkNotices() {
        apiGet(API.notices).then(function (d) {
          try {
            if (!d || !Array.isArray(d.notices) || !d.notices.length) return
            var seen = []
            try { seen = JSON.parse(localStorage.getItem('dsh-auto-memory.seenNotices') || '[]') } catch (e2) {}
            var fresh = d.notices.filter(function (n) { return n && n.id && seen.indexOf(n.id) < 0 })
            if (!fresh.length) return
            var target = null
            for (var i = 0; i < fresh.length; i++) { if (fresh[i].level === 'urgent') { target = fresh[i]; break } }
            if (!target) target = fresh[0]
            openDialog({ kind: 'notice', notice: target })
          } catch (e) {}
        }).catch(function () {})
      }
      checkNotices()
      var noticesTimer = setInterval(checkNotices, 3600 * 1000)

      // 时间检测轮询(30s):拉 host 的暂离状态/待展示总结,检测暂离回归并自动弹窗
      var lastPendingSummary = null
      var awayPollTimer = null
      function pollTimeState() {
        apiGet(API.state).then(function (d) {
          try {
            if (d && typeof d.away === 'boolean') {
              hostAway = d.away
              hostAwayReady = true
            }
            if (d && d.pendingSummary && d.pendingSummary.summary) {
              var seenKey = 'dsh-auto-memory.seenSummary.' + (d.pendingSummary.date || '') + '.' + (d.pendingSummary.time || '')
              try {
                if (!localStorage.getItem(seenKey)) {
                  localStorage.setItem(seenKey, '1')
                  lastPendingSummary = d.pendingSummary
                }
              } catch (e2) {}
            }
            autoOpenOnReturn()
          } catch (e) {}
        }).catch(function () {})
      }
      pollTimeState()
      awayPollTimer = setInterval(pollTimeState, 30000)

      var surfaceDisposers = []
      function registerSurfaces() {
        try {
          surfaceDisposers.push(slots.inject('sidebar.footer.action', function () {
            return slots.register({ name: 'sidebar.footer.action', id: 'auto-memory', order: 5, label: t('memory') + '' }, function () { return h(SidebarButton) })
          }))
          surfaceDisposers.push(slots.inject('shell.overlay', function () {
            return slots.register({ name: 'shell.overlay', id: 'auto-memory', order: 5 }, function () { return h(MemoryPanel) })
          }))
          surfaceDisposers.push(slots.inject('shell.overlay', function () {
            return slots.register({ name: 'shell.overlay', id: 'auto-memory-dialogs', order: 6 }, function () { return h(DialogHost) })
          }))
          surfaceDisposers.push(slots.inject('settings.section', function () {
            return slots.register({ name: 'settings.section', id: 'auto-memory', order: 25, label: t('autoMemory') + '' }, function (props) { return h(SettingsPage, { close: props && props.close }) })
          }))
        } catch (e) {
          console.warn('[dsh-auto-memory] slot registration failed', e)
        }
      }
      function refreshSurfaces() {
        for (var i = 0; i < surfaceDisposers.length; i++) { try { surfaceDisposers[i]() } catch (e) {} }
        surfaceDisposers = []
        registerSurfaces()
      }
      registerSurfaces()
      console.log('[dsh-auto-memory] client ready: sidebar entry + panel + settings page')
    }

    exports.inject = ['slots', 'sessions']
    exports.apply = apply
    return module.exports
  },
})
