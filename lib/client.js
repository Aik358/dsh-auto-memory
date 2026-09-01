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
    // 侧边栏「记忆」入口按钮位置(DSH Desktop 增强模式下面板贴左下角会盖住它)——@ProperSAMA PR#12
    function entryButtonRect() {
      try {
        var btn = document.querySelector('[data-dam-sidebar-btn]')
        if (btn) { var r = btn.getBoundingClientRect(); if (r && r.width > 0) return r }
      } catch (e) {}
      return null
    }
    function defaultGeom() {
      var vh = window.innerHeight || 800
      var top = Math.max(DEFAULT_GAP, vh - DEFAULT_H - DEFAULT_GAP)
      // 默认锚定在「记忆」按钮正上方,保证开关入口始终可见可点
      var r = entryButtonRect()
      if (r) {
        var anchored = r.top - DEFAULT_H - 12
        if (anchored >= DEFAULT_GAP) top = Math.min(top, anchored)
      }
      return {
        left: DEFAULT_GAP,
        top: top,
        width: DEFAULT_W,
        height: DEFAULT_H,
      }
    }
    // 面板与「记忆」入口按钮重叠时自动上移让出入口(含旧版本持久化的贴底几何)
    function avoidCoveringEntry() {
      var r = entryButtonRect()
      if (!r) return
      var g = controller.geom()
      var overlapX = g.left < r.right + 4 && g.left + g.width > r.left - 4
      var overlapY = g.top < r.bottom + 4 && g.top + g.height > r.top - 4
      if (!overlapX || !overlapY) return
      var top = r.top - g.height - 12
      if (top < DEFAULT_GAP) top = DEFAULT_GAP
      geom = clampGeom({ left: g.left, top: top, width: g.width, height: g.height })
      persistGeom()
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
    // 解析 computed color(rgba() / color(srgb) / #RRGGBBAA)的通道与 alpha,用于可读性兜底——@ProperSAMA PR#12(适配:补 hex8)
    function parseCssColor(str) {
      if (!str) return null
      function alphaOf(v) { return v === undefined ? 1 : (v.charAt(v.length - 1) === '%' ? parseFloat(v) / 100 : parseFloat(v)) }
      var m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?\s*\)$/i.exec(str)
      if (m) return { r: Math.round(+m[1]), g: Math.round(+m[2]), b: Math.round(+m[3]), a: alphaOf(m[4]) }
      var c = /^color\(\s*srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+%?))?\s*\)$/i.exec(str)
      if (c) return { r: Math.round(+c[1] * 255), g: Math.round(+c[2] * 255), b: Math.round(+c[3] * 255), a: alphaOf(c[4]) }
      var h8 = /^#([0-9a-f]{8})$/i.exec(str)
      if (h8) return { r: parseInt(h8[1].slice(0, 2), 16), g: parseInt(h8[1].slice(2, 4), 16), b: parseInt(h8[1].slice(4, 6), 16), a: parseInt(h8[1].slice(6, 8), 16) / 255 }
      return null
    }
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
        avoidCoveringEntry()
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
        overview: '概览', logs: '日志', refineTab: '唤起回顾', notes: '笔记', reflections: '反思', connect: '接续', calendar: '日历', search: '检索', workspaces: '工作区', hubTab: '记忆中枢', storageTab: '存储管理',
        hubSkills: '技能 (Procedural)', hubSkillsEmpty: '暂无已固化的技能。反复成功的流程会自动固化为技能并在相似场景召回。', hubFacts: '事实 (Semantic)', hubFactsEmpty: '暂无固化的事实。', hubConflicts: '待决冲突', hubEpisodic: '经历 (Episodic)', hubEpisodicEmpty: '暂无已巩固的经历。',
        storageScanHint: '语料健康 = 逐源比对索引(sidecar)与正文的 digest。手动改动记忆文件后索引会失配,该记忆会退出检索直到重建索引。',
        storageDeleteHint: '删除记忆 = 正文原子删除 + 在途唤起包清理 + 派生事实撤销(三联动)。已产生的 seen 证据不改写。',
        secSemantic: '自动记忆引擎', semMode: '检索模式', semAuto: '自动（推荐）', semLexOnly: '仅词法', semJs: '内置语义', semPy: '高级 Python',
        semModeHint: '自动=内置语义就绪即用，否则词法保底；高级 Python 需另行安装。',
        fAssocEngine: '启用自动记忆引擎', fAssocEngineHint: '总开关。开启后自动观测上下文、语义检索并适时唤起记忆注入(消费少量 token)。关闭则整个引擎不运行——不检索、不判定、不注入、不生成唤起记录。介意 token 消耗或担心动作跑偏的用户可关闭。默认关。',
        secMemoryHubHint: '记忆中枢 = 三层记忆(经历/事实/技能)的编排器。开启后自动从对话沉淀经历、固化事实、把反复成功的流程固化为技能(skill),并在相似场景自动召回注入。',
        fMemoryHub: '启用记忆中枢', fMemoryHubHint: '总开关。开启后三层记忆(episodic 经历 / semantic 事实 / procedural 技能)开始运行;关闭则只保留已有记忆,不再沉淀新内容。默认关。',
        fEpisodicMin: '经历最少对话段数', fEpisodicMinHint: '一次经历(episode)至少积累多少段对话才巩固为记忆。太少=噪声多,太多=小对话被丢弃。默认 2。',
        fEpisodicRet: '经历保留上限(条)', fEpisodicRetHint: '保留的最近经历条数,超出按时间淘汰最旧的。默认 256。',
        fProcSessions: '技能晋升跨会话数', fProcSessionsHint: '一个流程至少出现在 N 个独立会话中才考虑晋升为技能。默认 3(M-04 元代码)。',
        fProcSuccess: '技能晋升成功次数', fProcSuccessHint: '流程至少成功 N 次才可晋升。一次成功不足以证明可靠。默认 2。',
        fProcCorr: '技能纠正容忍度', fProcCorrHint: '纠正/错误占该流程总证据的比例上限。超过则保持候选,不晋升。默认 0.3(30%)。',
        fProcRisk: '高风险流程需批准', fProcRiskHint: '高风险流程(SSH/部署/删除等)晋升需用户明确批准,且永不因相似度自动执行。默认开。',
        fProcLevel: '技能注入形式', fProcLevelHint: 'active 技能注入时给模型的提示形态:checklist=完整步骤+完成标准;excerpt=摘要;hint=仅提示可参考。高风险自动降级为 hint。',
        memoryHubViewHint: '查看记忆中枢内容请打开「记忆」面板的「记忆中枢」页签。',
        fJsCooldown: '唤起冷却(分钟)', fJsCooldownHint: '自动唤起注入后,N 分钟内不再判定,防止连续唤起浪费 token。默认 1;0=不冷却。',
        fJsDelta: '唤起margin阈值(e5档)', fJsDeltaHint: '候选第1/2名分差须超过此值才注入(e5 余弦分布紧,默认 0.01;bge-m3 校准值为 0.03)。调小=更容易唤起,调大=更保守。0=不过滤。',
        fEmitMode: '唤起注入模式', fEmitModeHint: 'shadow=只记录决策不注入(校准用);canary-explicit=仅明确回忆时注入(推荐);active=所有判定注入。JS/Python 双轨同源。',
        fCandScheme: '唤起候选方案', fCandSchemeHint: 'balanced=3条×40字符(默认,信息量/token 平衡);dense=6条×20字符(更多候选更广联想);custom=自定义条数与长度。',
        fCandN: '自定义候选条数', fCandNHint: 'custom 档的候选条数(1-8)。',
        fJsExcerpt: '唤起注入内容长度(字符)', fJsExcerptHint: 'Reference Tail 的 Reference 行内容上限。默认 40=几个字/关键词级(省 token,需要细节时模型用 memory_read 取全文);调大可注入更多记忆正文。范围 20-480。',
        fReasoning: '思维链监听', fReasoningHint: '把模型思维链纳入实时观测（重启后生效）。默认开——闭源模型的概括式思维链同样纳入。',
        fChildObs: '分支会话观测', fChildObsHint: '跨天续接的会话会被标记为分支;开启后同样纳入记忆观测。默认开。',
        fTauHi: '唤起门槛 tauHi', fDeltaExp: '明确召回余量 deltaExp', fDeltaPro: '主动预取余量 deltaPro',
        fTuningHint: '阈值由校准策略 JSON 权威控制;此处为高级调参入口,修改保存后随下轮生效。',
        refineTitle: '唤起记录与语料精修', refineSub: '对每次唤起判断给出你的裁定(A 该激活/P 只预取/S 应抑制/H 有害/E 改目标),审批队列将用于离线重放与策略演进。',
        refineEmpty: '(暂无唤起记录——需要 shadow 观测产生数据)', refineLoadErr: '加载失败: ',
        sent1: '已入审批队列', semReady: '内置语义已就绪', semMissing: '语义包未下载(约130MB)', semStatusErr: '状态未知',
        semResolved: '当前生效检索', tierC1: 'C1 词法保底(BM25)', tierC2: 'C2 内置语义 e5-small q8', tierC3: 'C3 高级 Python bge-m3',
        semDlStart: '开始下载', semDlRetry: '重试', semDlCancel: '取消',
        mAuto: '自动（国内优先）', mCn: '国内源 · hf-mirror', mIntl: '国际源 · huggingface',
        dlDownloading: '下载中', dlVerifying: '校验中(SHA256)', dlDone: '下载完成', dlCancelled: '已取消', dlError: '下载失败',
        fWelcomeTour: '欢迎向导', fWelcomeTourHint: '首次启动后自动播放分步功能引导（含语义引擎检测/下载）；关闭后仅可从此处手动打开。', tourReplay: '▶ 重看引导',
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
        fBudget: '注入预算(字符)', fBudgetHint: '记忆块总预算,超出部分截断。默认 1600(≈400-600 token/轮);活跃会话每轮都注入这段背景,调低更省 token,调高保留更多记忆。',
        fSnapGap: '快照最小间隔(轮)', fSnapGapHint: '动态记忆快照内容变化后,至少隔 N 轮才重新注入,避免每轮日志微变都追加快照导致历史膨胀。默认 5;0=每轮都尝试(仍受内容变化约束)。',
        fReinjectOnCompact: '压缩后立即重注入快照', fReinjectOnCompactHint: '上下文被压缩/截断(通常伴随 contextVersion 重置)后,快照会被清掉;开启后强制立即重注入一次,确保记忆背景重建。默认开。',
        fPromptCustom: '自定义记忆注入 prompt', fPromptCustomHint: '可覆盖各层提示文案(小众功能)。支持占位符 {date} {ws} {budget} {n}。改坏了可一键恢复默认。',
        fDays: '注入最近日志天数', fDaysHint: '会话开始时注入最近 N 天的工作日志尾部。默认 1。',
        fExtBudget: '外部记忆注入预算(字符)', fExtBudgetHint: '外部记忆来源在上下文中的注入预算。默认 1400(路径模式下影响有限)。',
        fConsolidateMin: '自动沉淀内容门槛(字符)', fConsolidateMinHint: '本轮 user+assistant 总字符低于此值视为寒暄跳过。默认 240。',
        fAway: '暂离阈值(分钟)', fAwayHint: '距上次活动超过该值视为暂离,回归时自动弹出记忆窗口。默认 60。',
        fAutoPopup: '自动弹出记忆窗口', fAutoPopupHint: '暂离/回归时自动弹出记忆窗口(corner)并欢迎;关闭后只能手动打开。默认开。',
        fUnattended: '无人值守模式', fUnattendedHint: '面向无人值守批量任务(托管/夜间)。开启后不注入欢迎回来指令、行为指令、暂离/回归提示、日历提醒——只注入纯事实记忆,避免无人值守时模型在寒暄上浪费 token。与模型侧的"托管模式"判断联动。默认关。',
        fUnattendedAuto: '夜间/非工作时间自动托管', fUnattendedAutoHint: '开启后,本地时间处于非工作时间窗(默认 22:00-08:00,可在配置中调 unattendedAutoHours)或检测到自动托管任务时,自动进入无人值守模式,不弹欢迎窗、不注入寒暄。手动开关优先;默认关。',
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
        overview: 'Overview', logs: 'Logs', refineTab: 'Recall review', notes: 'Notes', reflections: 'Reflections', connect: 'Connect', calendar: 'Calendar', search: 'Search', workspaces: 'Workspaces', hubTab: 'Memory Hub', storageTab: 'Storage',
        hubSkills: 'Skills (Procedural)', hubSkillsEmpty: 'No solidified skills yet. Repeatedly-successful workflows become skills and are recalled in similar contexts.', hubFacts: 'Facts (Semantic)', hubFactsEmpty: 'No solidified facts yet.', hubConflicts: 'Pending conflicts', hubEpisodic: 'Episodes (Episodic)', hubEpisodicEmpty: 'No consolidated episodes yet.',
        storageScanHint: 'Corpus health = compare each source\'s index (sidecar) against its body digest. After you hand-edit a memory file the index no longer matches, and that memory drops out of retrieval until the index is rebuilt.',
        storageDeleteHint: 'Delete = atomic body removal + in-flight activation purge + derived-fact revocation (cascading). Evidence already recorded (seen) is never rewritten.',
        secSemantic: 'Semantic engine', semMode: 'Retrieval mode', semAuto: 'Auto (recommended)', semLexOnly: 'Lexical only', semJs: 'Built-in semantic', semPy: 'Advanced Python',
        fAssocEngine: 'Enable automatic memory engine', fAssocEngineHint: 'Master switch. On = auto-observe context, semantic retrieval, and timely memory-activation injection (costs a little token). Off = the whole engine stops — no retrieval, no decide, no injection, no activation records. For users concerned about token cost or off-course actions. Default off.',
        secMemoryHubHint: 'Memory Hub = the orchestrator for three memory layers (episodic / semantic / procedural). When on, it distills episodes from dialogue, solidifies facts, and turns repeatedly-successful workflows into skills that are auto-recalled in similar contexts.',
        fMemoryHub: 'Enable Memory Hub', fMemoryHubHint: 'Master switch. On = the three memory layers (episodic / semantic / procedural) start running; Off = keep existing memories but stop distilling new ones. Default off.',
        fEpisodicMin: 'Min segments per episode', fEpisodicMinHint: 'How many dialogue segments an episode needs before it is consolidated. Too low = noise; too high = small talks discarded. Default 2.',
        fEpisodicRet: 'Episode retention (count)', fEpisodicRetHint: 'Max recent episodes kept; oldest are evicted beyond this. Default 256.',
        fProcSessions: 'Skill promotion sessions', fProcSessionsHint: 'A workflow must appear in N distinct sessions before it can be promoted to a skill. Default 3 (M-04 meta-code).',
        fProcSuccess: 'Skill promotion successes', fProcSuccessHint: 'A workflow must succeed N times before promotion. One success is not enough proof. Default 2.',
        fProcCorr: 'Skill correction tolerance', fProcCorrHint: 'Max ratio of corrections/errors to total evidence for a workflow. Above this it stays a candidate. Default 0.3 (30%).',
        fProcRisk: 'High-risk needs approval', fProcRiskHint: 'High-risk workflows (SSH/deploy/delete) require explicit user approval to promote, and are never auto-executed on similarity alone. Default on.',
        fProcLevel: 'Skill injection form', fProcLevelHint: 'What form an active skill takes when injected: checklist = full steps + success criteria; excerpt = summary; hint = just "refer to this skill". High-risk auto-downgrades to hint.',
        memoryHubViewHint: 'View Memory Hub content in the "Memory Hub" tab of the Memory panel.',
        fJsCooldown: 'Activation cooldown (min)', fJsCooldownHint: 'After an auto-activation injection, do not decide again for N minutes, preventing consecutive activations from wasting tokens. Default 1; 0 = no cooldown.',
        fJsDelta: 'Activation margin threshold (e5)', fJsDeltaHint: 'Inject only when the gap between top-1/top-2 candidates exceeds this (e5 cosine is tight, default 0.01; the bge-m3 calibrated value is 0.03). Lower = easier recall, higher = conservative. 0 = no filter.',
        fEmitMode: 'Activation emit mode', fEmitModeHint: 'shadow = record decisions only, no injection (calibration); canary-explicit = inject only on explicit recall (recommended); active = inject on every decide. Shared by JS/Python tracks.',
        fCandScheme: 'Activation candidate scheme', fCandSchemeHint: 'balanced = 3×40 chars (default, info/token balance); dense = 6×20 chars (more candidates, wider recall); custom = your own count & length.',
        fCandN: 'Custom candidate count', fCandNHint: 'Candidate count for custom scheme (1-8).',
        fJsExcerpt: 'Activation excerpt length (chars)', fJsExcerptHint: 'Max length of the Reference line in the Reference Tail. Default 40 = a few words/keyword level (saves tokens; model uses memory_read for details). Raise to inject more memory body. Range 20-480.',
        semModeHint: 'Auto = built-in semantics when ready, lexical fallback otherwise; Advanced Python requires separate installation.',
        fReasoning: 'Chain-of-thought listening', fReasoningHint: 'Include model reasoning in live observation (applies after restart). On by default — summary-style CoT from closed models is captured too.',
        fChildObs: 'Branched-session observation', fChildObsHint: 'Sessions resumed across days are flagged as branched; enable to include them too. On by default.',
        fTauHi: 'Activation thresholds (calibrated)', fTuningHint: 'Thresholds are owned by the calibrated policy JSON; these inputs are a preview tuning entry and apply on next round.',
        refineTitle: 'Recall review & corpus refinement', refineSub: 'Give your ruling on each activation decision (A activate / P prefetch / S suppress / H harmful / E edit target). Rulings feed an append-only review queue for offline replay and policy evolution.',
        refineEmpty: '(no activation records yet — they appear as shadow observation produces data)', refineLoadErr: 'Failed to load: ',
        sent1: 'queued', semReady: 'Built-in semantic engine ready', semMissing: 'Semantic pack not downloaded (~130MB)', semStatusErr: 'status unknown', semGuide: 'Setup guide', semGuideJs: 'The built-in semantic engine downloads a ~130MB local model (multilingual-e5-small, quantized). It runs entirely on your machine — memories never leave it. After download it verifies checksums, builds the index, then switches on automatically. You can keep using lexical search meanwhile.', semGuidePy: 'The advanced Python engine runs BGE-M3 int8 (~563MB) via a local sidecar for the highest recall. It requires a guided install (Python runtime + model). Not required for normal use.', semLater: 'Later', semInstall: 'Install', semPending: 'will be available in an upcoming release; this guide will walk through it once shipped.',
        semResolved: 'Active retrieval', tierC1: 'C1 lexical floor (BM25)', tierC2: 'C2 built-in semantic e5-small q8', tierC3: 'C3 advanced Python bge-m3',
        semDlStart: 'Download', semDlRetry: 'Retry', semDlCancel: 'Cancel',
        mAuto: 'Auto (CN mirror first)', mCn: 'CN · hf-mirror', mIntl: 'Intl · huggingface',
        dlDownloading: 'Downloading', dlVerifying: 'Verifying (SHA256)', dlDone: 'Download complete', dlCancelled: 'Cancelled', dlError: 'Download failed',
        fWelcomeTour: 'Welcome tour', fWelcomeTourHint: 'Auto-plays the step-by-step feature tour (with engine detection/download) on first launch; turn off to keep it manual. Replay anytime.', tourReplay: '▶ Replay tour',
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
      guideTitle: 'Welcome to dsh-auto-memory (pre)', guideSub: 'What this plugin does:',
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
        fBudget: 'Injection budget (chars)', fBudgetHint: 'Total budget for the memory block; excess is truncated. Default 1600 (~400-600 tokens/turn); this background is injected every turn, so lower = fewer tokens, higher = more memory retained.',
        fSnapGap: 'Snapshot min gap (turns)', fSnapGapHint: 'After the dynamic memory snapshot changes, re-inject at least N turns later, so small per-turn log changes do not append a new snapshot every turn (history bloat). Default 5; 0 = try every turn (still change-gated).',
        fReinjectOnCompact: 'Re-inject snapshot immediately after compaction', fReinjectOnCompactHint: 'When the context is compacted/truncated (usually a contextVersion reset), the snapshot is cleared; on = force re-inject once so the memory background rebuilds. Default on.',
        fPromptCustom: 'Customize memory-injection prompt', fPromptCustomHint: 'Override any prompt layer (power feature). Placeholders: {date} {ws} {budget} {n}. One-click reset restores defaults.',
        fDays: 'Recent days injected', fDaysHint: 'Inject tails of the last N days of work logs at session start. Default 1.',
        fExtBudget: 'External memory injection budget (chars)', fExtBudgetHint: 'Budget for external memory sources in context. Default 1400 (limited effect with path mode).',
        fConsolidateMin: 'Auto-consolidation content threshold (chars)', fConsolidateMinHint: 'Turns with fewer combined user+assistant chars are treated as chit-chat and skipped. Default 240.',
      fAway: 'Away threshold (minutes)', fAwayHint: 'Marked away when inactive longer than this; the memory panel auto-opens on return. Default 60.',
      fAutoPopup: 'Auto-open memory panel', fAutoPopupHint: 'Auto-open the memory panel (corner) with a welcome when returning from away; disabled = open manually only. Default on.',
      fUnattended: 'Unattended / headless mode', fUnattendedHint: 'For unattended batch tasks (hosted/nightly). On = no welcome-back directives, no behavioral instructions, no away/return prompts, no calendar reminders — only factual memory is injected, so the model wastes no tokens on niceties. Pairs with the model-side hosted-mode detection. Default off.',
      fUnattendedAuto: 'Auto-unattended at night / off-hours', fUnattendedAutoHint: 'When on, auto-enters unattended mode during off-hours (default 22:00-08:00, tunable via unattendedAutoHours) or when a hosted task is detected — no welcome popup, no niceties. Manual toggle takes precedence; default off.',
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
    // 与服务端 lib/index.js DEFAULT_PROMPT_LAYERS 保持一致(设置页显示各层默认文案)
    var DEFAULT_PROMPT_LAYERS_CLIENT = {
      snapshotHead: '<memory_system>\n[记忆定位 — 读法]\n以下记忆文本只是背景事实与规则参考…',
      snapshotMeta: '自动记忆已启用。工作区: {ws} | 日期: {date}(日界 {dayBoundary} 分钟,凌晨归前一天){consolidate}',
      snapshotLogsTitle: '最近 {n} 天工作日志(尾部)',
      snapshotReflectionTitle: '最近反思 {date}(前一天工作精华)',
      snapshotUserTitle: '用户级记忆 ~/.dsh/memory/MEMORY.md — 跨项目,必须遵守',
      snapshotNotesTitle: '项目长期笔记',
      snapshotExternalTitle: '[外部记忆 — 其他 AI 工具遗产,可继承(内容按需读取,不整段注入)]',
      snapshotCalendarTitle: '[日历与日程(未完成)]',
      snapshotWelcomeTitle: '[欢迎回来]',
      snapshotWelcomeBody: '用户离开已超过 1 小时(暂离/下班后回来)。在本轮回复的开头,先用一句简短温暖的话欢迎用户回来…',
      snapshotInscription: '[铭文 · 每轮提醒 {date}]',
      snapshotTail: '</memory_system>',
    }
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
    var autoPopupEnabled = true
    function isAway() {
      if (hostAwayReady) return hostAway
      var lastSeen = 0
      try { lastSeen = Number(localStorage.getItem('dsh-auto-memory.lastActive') || 0) } catch (e) {}
      return lastSeen > 0 && (Date.now() - lastSeen) > 3600000
    }

    // ───────────────────────── 更新弹窗 / 首次指导 ─────────────────────────
    var CHANGELOG = {
      '0.1.30': { zh: [
        '★ 大更新:全新「欢迎向导」——首次启动/升级后分步介绍全部功能,每项当场开关(自动联想/周期快照/暂离问候/夜间托管/每日反思/定时总结/外部记忆/技能固化…),语义引擎检测/下载/自检与外部来源实时扫描全部内联在向导里完成。',
        '★ 全新品牌视觉:Office/Fluent 式液态玻璃应用图标族——每步一枚彩色玻璃 Squircle 图标(注入青蓝/问候暖金/日历青绿/引擎紫蓝/雷达天青/完成珊瑚金),配专属循环动效(铃摆/翻页/双环/棱镜旋转/雷达扫描/火花上升);「核心能力」步保留标志性三层磨砂玻璃板 Logo。',
        '★ 更新日志开场动画:打开更新说明时先播放三层玻璃 Logo 组装→展开→消散,再浮现更新内容;点击任意处可跳过;内容过长自动滚动。',
        '★ 无人值守就绪:设置→自动化提供「无人值守模式」与「夜间/批量自动托管」(22:00-08:00);托管期间不注入欢迎语/寒暄/行为指令,日历静默,上下文稳定,面向长批处理任务。',
        '修复:DSH Desktop 增强模式(透明/Mica 窗口材质)下记忆面板半透明、文字几乎不可读——打开时实测主题令牌 alpha,过低时自动提升到 0.96(保留色相),普通模式玻璃观感零变化。感谢 @ProperSAMA(PR #12)。',
        '修复:记忆面板默认位置不再遮挡侧边栏「记忆」入口按钮——改为锚定按钮正上方,重叠时自动让出;支持点击面板外部或按 Esc 关闭。感谢 @ProperSAMA(PR #12)。',
        '修复:更新弹窗在小卡形态下内容被裁剪、底部按钮不可达导致无法关闭——新增右上 ✕ 关闭(同步已读版本),内容区自动滚动。',
        '改进:「唤起回顾」决策↔投递时间线——每条决策标注真实投递结果(✓投递×N/未投递/技能✓),判定队列汇总与政策提示;记忆固化(stale 门降版本容忍,语料升版不再整单压制召回)。',
        '补丁 0.1.31:发布物运行时 section 名 dsh:m6-reference-tail → 裸名(发布身份统一,不再带预览标识)。',
        '补丁 0.1.32:「记忆唤起」开关与设置页双向联动(导览与设置走同一 semantic-emit 接口);语义引擎分级引导(无引擎自动装 JS 档,发烧友可选 Python)。',
        '补丁 0.1.33:修复语义引擎下载 404(镜像 URL 重复前缀);transformers 推理库声明为可选依赖并随包分发。',
        '补丁 0.1.34:修复推理库检测——pnpm 把 transformers 提升到 profile 根 node_modules,检测补该路径,新用户装完即用,无需手动操作。',
      ], en: [
        '★ MAJOR: Brand-new Welcome Tour — after first launch or upgrade, every feature is introduced step by step with per-feature switches right in the tour (association / snapshot / greeting / night unattended / reflection / summaries / external memory / skill promotion…); engine detection, download, self-test and live external-source scanning are all inline.',
        '★ New brand visuals: an Office/Fluent-style liquid-glass app icon family — each step gets its own colored glass squircle icon (cyan inject / amber greeting / green calendar / violet engine / sky radar / coral finish) with dedicated looping motion (bell sway, page flip, linked rings, prism spin, radar sweep, rising spark); the signature three-slab frosted-glass logo stays on the Core step.',
        '★ Changelog intro animation: opening the update notes now plays the glass logo assembling → expanding → dissolving before the content fades in; click anywhere to skip; long content scrolls automatically.',
        '★ Unattended-ready: Settings → Automation offers "Unattended mode" and "Auto-unattended at night" (22:00-08:00); while engaged, greetings/niceties/behavioural directives are stripped and the calendar stays silent — built for long batch jobs.',
        'Fix: In DSH Desktop enhanced mode (transparent/Mica materials) the memory panel was semi-transparent and barely readable — token alpha is measured on open and raised to 0.96 when too low (hue preserved); normal modes keep their glass look. Thanks @ProperSAMA (PR #12).',
        'Fix: The panel no longer covers the sidebar "Memory" entry button — default position anchors above it, overlapping geometry auto-yields, and outside-click/Esc close is supported. Thanks @ProperSAMA (PR #12).',
        'Fix: The update dialog could become impossible to close when its content overflowed the compact card — added an ✕ in the top-right (marks version seen) and made the content area scrollable.',
        'Improved: Recall-review decision↔delivery timeline (delivered×N / not delivered / skill badges per decision), review-queue digest with policy hints, and consolidation stale-gate version tolerance so corpus version bumps no longer suppress recall.',
        'Patch 0.1.31: release runtime section name dsh:m6-reference-tail → bare name (unified release identity, no preview marker).',
        'Patch 0.1.32: the "Memory recall" switch now syncs bidirectionally with Settings (tour and settings share the semantic-emit endpoint); tiered engine onboarding (auto-install JS tier, Python optional for enthusiasts).',
        'Patch 0.1.33: fixed semantic-engine download 404 (duplicate prefix in mirror URL); transformers inference lib declared as an optional dependency and shipped with the package.',
        'Patch 0.1.34: fixed inference-lib detection — pnpm hoists transformers to the profile-root node_modules; detection now covers that path, so fresh installs work out of the box.',
      ] },
      '0.1.29': { zh: [
        '修复:工作区总览一直显示「未发现带记忆的工作区」——DSH 新版会话持久化改为 session.jsonl.zstd 压缩帧,旧逻辑只认 .jsonl 扫描不到任何会话;现已用 zstd 解压读取首行提取 cwd,并让空的 summary 缓存短时失效,避免空结果被永久固化。',
        '新增:设置页「自动化」新增「自动弹出记忆窗口」开关——关闭后暂离/回归不再自动弹出 corner 问候栏,只能手动打开。',
        '提示:这是近期稳定版(0.1.x 维护线)的发布。实验版(下一大版本)预计未来几周内发布,在此之前稳定版仅做维护性更新。',
      ], en: [
        'Fix: Workspace overview kept showing "No memory workspaces found" — DSH now stores sessions as session.jsonl.zstd compressed frames that were not recognized; the overview now decompresses them to read the first line and extract each workspace, and empty summary caches expire instead of being fixed forever.',
        'New: "Auto-open memory panel" toggle in Settings → Automation - turn it off to stop auto-opening the corner greeting on away/return; the panel stays manual-only.',
        'Note: this is a recent stable-line (0.1.x maintenance) release. The experimental next major version is expected within a few weeks; until then the stable line only receives maintenance updates.',
      ] },
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
        '修复:正式发布流程 cordis.patch.yml(loader 入口 id + 包名)转换事故——发布包与预览版 identity 完全隔离,不再互相撞车。',
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
        '修复:正式发布包首次欢迎文案仍显示“预览版”；发布转换与残留校验已加强，确保预览版和正式版身份完全隔离。',
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
      if (d.kind === 'welcomeTour') return 85
      if (d.kind === 'modelDownload') return 85
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
    // 调试/重看入口:控制台 window['dsh-auto-memory.openWelcomeTour']() 随时重开首启向导
    try {
      window['dsh-auto-memory.openWelcomeTour'] = function () { openDialog({ kind: 'welcomeTour' }) }
    } catch (eOpenTour) {}
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
      models: '/api/dsh-auto-memory/models',
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
      '[data-dam-panel][data-solid="true"]::before { background: linear-gradient(180deg, rgba(255,255,255,.05), rgba(255,255,255,0) 70%); }',
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
      '@media (prefers-reduced-motion: reduce) { [data-dam-tab-strip], [data-dam-tab], [data-dam-disclosure], [data-dam-card], [data-dam-banner], [data-dam-tour-orb-wrap] *, [data-dam-update-box] * { transition: none !important; animation: none !important; }',
      '  [data-dam-tour-bokeh], [data-dam-tour-slab], [data-dam-tour-orb-core] { opacity: 1 !important; transform: none !important; filter: none !important; }',
      '  [data-dam-update-stage] { display: none !important; }',
      '  [data-dam-update-content] { opacity: 1 !important; transform: none !important; animation: none !important; } }',
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
      // ── 首启引导向导(Win11 OOBE × macOS 欢迎 × Liquid Glass) ──
      '[data-dam-tour-backdrop] { position: fixed; inset: 0; z-index: 2147482900; display: flex; align-items: center; justify-content: center;',
      '  background: radial-gradient(ellipse at 50% 42%, rgba(20,30,60,.30), rgba(6,10,22,.44)); backdrop-filter: blur(5px); -webkit-backdrop-filter: blur(5px); animation: dam-tour-fade .28s ease both; }',
      '@keyframes dam-tour-fade { from { opacity: 0 } to { opacity: 1 } }',
      '[data-dam-tour] { position: relative; width: min(620px, calc(100vw - 48px)); border-radius: 22px; overflow: hidden; padding-bottom: 4px;',
      '  background: color-mix(in srgb, var(--dsw-alias-bg-overlay, rgba(30,34,46,.9)) 60%, transparent);',
      '  backdrop-filter: blur(30px) saturate(1.6); -webkit-backdrop-filter: blur(30px) saturate(1.6);',
      '  border: 1px solid rgba(255,255,255,.5);',
      '  box-shadow: 0 32px 90px rgba(8,14,38,.5), 0 6px 24px rgba(8,14,38,.28), inset 0 1px 0 rgba(255,255,255,.5), inset 0 -1px 0 rgba(255,255,255,.14);',
      '  color: var(--dsw-alias-label-primary, #1f2328); font: 13.5px/1.6 system-ui, "Segoe UI", sans-serif; --dam-mx: 50%; --dam-my: 18%;',
      '  animation: dam-tour-pop .38s cubic-bezier(.2,.9,.3,1.16) both; }',
      '@keyframes dam-tour-pop { from { opacity: 0; transform: scale(.9) translateY(22px); } to { opacity: 1; transform: none; } }',
      '[data-dam-tour]::before { content: ""; position: absolute; inset: 0 0 auto 0; height: 55%; pointer-events: none;',
      '  background: linear-gradient(168deg, rgba(255,255,255,.20), rgba(255,255,255,0) 58%); }',
      '[data-dam-tour-glare] { position: absolute; inset: 0; pointer-events: none; z-index: 1;',
      '  background: radial-gradient(300px circle at var(--dam-mx) var(--dam-my), rgba(255,255,255,.16), transparent 62%); mix-blend-mode: screen; }',
      '[data-dam-tour-close] { position: absolute; top: 12px; right: 12px; z-index: 3; width: 30px; height: 30px; border-radius: 50%;',
      '  border: 1px solid rgba(255,255,255,.35); background: rgba(255,255,255,.10); cursor: pointer; opacity: .7; font-size: 13px; color: inherit; line-height: 1; }',
      '[data-dam-tour-close]:hover { opacity: 1; background: rgba(255,255,255,.22); }',
      // ── 首启向导 Logo:三层磨砂玻璃板堆叠 ──
      '[data-dam-tour-orb-wrap] { position: relative; width: 150px; height: 150px; margin: 34px auto 4px; perspective: 680px; z-index: 2;',
      '  transform-style: preserve-3d; --dam-slab-z: 22px; }',
      '[data-dam-tour-orb-wrap]::before { content: ""; position: absolute; inset: 0; border-radius: 50%;',
      '  background: radial-gradient(ellipse at 50% 45%, rgba(36,86,196,.14), transparent 62%); pointer-events: none; }',
      '[data-dam-tour-bokeh] { position: absolute; border-radius: 50%; filter: blur(16px); opacity: 0; pointer-events: none;',
      '  animation: dam-bokeh-in .55s ease both, dam-bokeh-drift 9s ease-in-out infinite; }',
      '[data-dam-tour-bokeh="a"] { width: 72px; height: 72px; left: 10px; top: 18px;',
      '  background: radial-gradient(circle at 35% 35%, rgba(77,107,254,.80), rgba(77,107,254,.18) 55%, transparent 72%); animation-delay: .38s, 0s; }',
      '[data-dam-tour-bokeh="b"] { width: 86px; height: 86px; right: 4px; top: 26px;',
      '  background: radial-gradient(circle at 40% 40%, rgba(155,126,255,.72), rgba(155,126,255,.16) 58%, transparent 76%); animation-delay: .50s, -2.4s; }',
      '[data-dam-tour-bokeh="c"] { width: 64px; height: 64px; left: 32px; bottom: 8px;',
      '  background: radial-gradient(circle at 45% 45%, rgba(77,107,254,.68), rgba(100,80,230,.14) 56%, transparent 74%); animation-delay: .62s, -5.1s; }',
      '@keyframes dam-bokeh-in { from { opacity: 0; transform: scale(.7); } to { opacity: .92; transform: scale(1); } }',
      '@keyframes dam-bokeh-drift { 0%, 100% { transform: translate(0, 0) scale(1); } 33% { transform: translate(6px, -5px) scale(1.04); } 66% { transform: translate(-4px, 5px) scale(.97); } }',
      '[data-dam-tour-stage] { position: absolute; left: 50%; top: 54%; width: 88px; height: 88px; transform-style: preserve-3d;',
      '  transform: translate(-50%, -50%) rotateX(55deg) rotateZ(45deg);',
      '  filter: drop-shadow(0 22px 34px rgba(4,8,20,.42)); animation: dam-stage-float 4.6s ease-in-out infinite; }',
      '@keyframes dam-stage-float { 0%, 100% { transform: translate(-50%, -50%) rotateX(55deg) rotateZ(45deg) translateZ(0); } 50% { transform: translate(-50%, calc(-50% - 5px)) rotateX(55deg) rotateZ(45deg) translateZ(4px); } }',
      '[data-dam-tour-slab] { position: absolute; left: 0; top: 0; width: 88px; height: 88px; border-radius: 23px; transform-style: preserve-3d;',
      '  background: linear-gradient(135deg, rgba(255,255,255,.17), rgba(255,255,255,.06));',
      '  border: 1.5px solid rgba(255,255,255,.52);',
      '  box-shadow: inset 0 1px 0 rgba(255,255,255,.62), inset 0 0 26px rgba(255,255,255,.13);',
      '  backdrop-filter: blur(6px) saturate(1.35); -webkit-backdrop-filter: blur(6px) saturate(1.35);',
      '  animation: dam-slab-drop .62s cubic-bezier(.2,.9,.3,1.15) both; }',
      '[data-dam-tour-slab]::before { content: ""; position: absolute; inset: -1px; border-radius: 23px; transform: translateZ(-7px); transform-style: preserve-3d;',
      '  background: linear-gradient(135deg, rgba(255,255,255,.09), rgba(255,255,255,.03));',
      '  border: 1px solid rgba(255,255,255,.18); box-shadow: 0 0 0 1px rgba(255,255,255,.04); }',
      '[data-dam-tour-slab]::after { content: ""; position: absolute; inset: 6px; border-radius: 18px; opacity: 0;',
      '  background: conic-gradient(from var(--dam-orb-a, 0deg), transparent 0deg, rgba(255,255,255,.42) 24deg, transparent 72deg, transparent 252deg, rgba(255,255,255,.22) 288deg, transparent 336deg);',
      '  filter: blur(2px); mix-blend-mode: screen; animation: dam-orb-shine 6.5s linear infinite; }',
      '[data-dam-tour-slab="top"] { transform: translateZ(calc(var(--dam-slab-z) * 1)); animation-delay: 0s; z-index: 3; }',
      '[data-dam-tour-slab="top"]::after { opacity: 1; }',
      '[data-dam-tour-slab="mid"] { transform: translateZ(0); animation-delay: .16s; z-index: 2; }',
      '[data-dam-tour-slab="bot"] { transform: translateZ(calc(var(--dam-slab-z) * -1)); animation-delay: .32s; z-index: 1; }',
      '@keyframes dam-slab-drop { from { opacity: 0; transform: translateY(-28px) scale(.85) translateZ(var(--dam-slab-from-z, 0)); } to { opacity: 1; transform: translateY(0) scale(1) translateZ(var(--dam-slab-to-z, 0)); } }',
      '[data-dam-tour-slab="top"] { --dam-slab-from-z: calc(var(--dam-slab-z) * 1.5); --dam-slab-to-z: calc(var(--dam-slab-z) * 1); }',
      '[data-dam-tour-slab="mid"] { --dam-slab-from-z: 0; --dam-slab-to-z: 0; }',
      '[data-dam-tour-slab="bot"] { --dam-slab-from-z: calc(var(--dam-slab-z) * -1.5); --dam-slab-to-z: calc(var(--dam-slab-z) * -1); }',
      '@property --dam-orb-a { syntax: "<angle>"; initial-value: 0deg; inherits: false; }',
      '@keyframes dam-orb-shine { to { --dam-orb-a: 360deg; } }',
      '[data-dam-tour-orb-core] { position: absolute; right: -10px; top: -6px; width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; font-size: 20px;',
      '  border-radius: 12px; transform: translateZ(48px) rotateX(-55deg) rotateZ(-45deg); transform-style: preserve-3d;',
      '  background: linear-gradient(135deg, rgba(255,255,255,.22), rgba(255,255,255,.08));',
      '  border: 1px solid rgba(255,255,255,.50); box-shadow: inset 0 1px 0 rgba(255,255,255,.55), 0 8px 18px rgba(18,34,90,.28);',
      '  backdrop-filter: blur(5px); -webkit-backdrop-filter: blur(5px);',
      '  filter: drop-shadow(0 4px 8px rgba(18,38,120,.28)); animation: dam-core-pop .40s cubic-bezier(.2,.9,.3,1.25) both; }',
      '@keyframes dam-core-pop { from { opacity: 0; transform: translateZ(62px) rotateX(-55deg) rotateZ(-45deg) scale(.6); } to { opacity: 1; transform: translateZ(48px) rotateX(-55deg) rotateZ(-45deg) scale(1); } }',
      // ── 每步 Office/Fluent 式彩色玻璃图形：每步只渲染自身 DOM，并拥有专属循环动画 ──
      // 非 store 步采用 Microsoft Office/Fluent 式彩色玻璃 Squircle 底牌；物件作为正面主符号，不再叠在菱形托盘上。
      '[data-dam-tour-app-tile] { --tile-rgb: 83,122,255; --tile-rgb-2: 151,111,255; position:absolute; left:50%; top:50%; width:92px; height:92px; margin:-46px 0 0 -46px; z-index:3; border-radius:27px;',
      '  background:linear-gradient(145deg,rgba(255,255,255,.35) 0%,rgba(var(--tile-rgb),.52) 42%,rgba(var(--tile-rgb-2),.34) 100%); border:1.5px solid rgba(255,255,255,.65); box-shadow:inset 0 2px 0 rgba(255,255,255,.68),inset 0 -14px 26px rgba(17,32,88,.18),0 20px 38px rgba(var(--tile-rgb),.25); backdrop-filter:blur(12px) saturate(1.5); -webkit-backdrop-filter:blur(12px) saturate(1.5); animation:dam-tile-enter .55s cubic-bezier(.2,.9,.3,1.18) both,dam-tile-breathe 5s .6s ease-in-out infinite; overflow:hidden; }',
      '[data-dam-tour-app-tile]::before { content:""; position:absolute; left:9%; top:6%; width:68%; height:34%; border-radius:50%; background:linear-gradient(105deg,rgba(255,255,255,.48),rgba(255,255,255,0)); filter:blur(4px); }',
      '[data-dam-tour-orb-wrap][data-art="inject"] [data-dam-tour-app-tile] { --tile-rgb:76,201,240; --tile-rgb-2:85,120,255; }',
      '[data-dam-tour-orb-wrap][data-art="bell"] [data-dam-tour-app-tile] { --tile-rgb:255,177,69; --tile-rgb-2:255,103,111; }',
      '[data-dam-tour-orb-wrap][data-art="calendar"] [data-dam-tour-app-tile] { --tile-rgb:80,201,143; --tile-rgb-2:50,148,255; }',
      '[data-dam-tour-orb-wrap][data-art="link"] [data-dam-tour-app-tile] { --tile-rgb:74,208,203; --tile-rgb-2:118,107,255; }',
      '[data-dam-tour-orb-wrap][data-art="engine"] [data-dam-tour-app-tile] { --tile-rgb:142,104,255; --tile-rgb-2:48,154,255; }',
      '[data-dam-tour-orb-wrap][data-art="radar"] [data-dam-tour-app-tile] { --tile-rgb:52,202,231; --tile-rgb-2:88,117,255; }',
      '[data-dam-tour-orb-wrap][data-art="rocket"] [data-dam-tour-app-tile] { --tile-rgb:255,115,105; --tile-rgb-2:255,192,71; }',
      '@keyframes dam-tile-enter { from{opacity:0;transform:scale(.72) rotate(-6deg) translateY(12px)} to{opacity:1;transform:scale(1) rotate(0) translateY(0)} }',
      '@keyframes dam-tile-breathe { 0%,100%{transform:translateY(0) rotate(0)} 50%{transform:translateY(-5px) rotate(.8deg)} }',
      '[data-dam-tour-art] { --art-rgb: 83,122,255; --art-rgb-2: 151,111,255; position: absolute; left: 50%; top: 50%; width: 64px; height: 64px; margin: -32px 0 0 -32px; z-index: 5; transform: translateZ(0); transform-style: preserve-3d; animation: dam-art-enter .46s cubic-bezier(.2,.9,.3,1.22) both, dam-art-float 4.2s .5s ease-in-out infinite; filter: drop-shadow(0 8px 16px rgba(15,28,75,.34)); }',
      '[data-dam-tour-art="inject"] { --art-rgb: 76,201,240; --art-rgb-2: 85,120,255; }',
      '[data-dam-tour-art="bell"] { --art-rgb: 255,177,69; --art-rgb-2: 255,103,111; }',
      '[data-dam-tour-art="calendar"] { --art-rgb: 80,201,143; --art-rgb-2: 50,148,255; }',
      '[data-dam-tour-art="link"] { --art-rgb: 74,208,203; --art-rgb-2: 118,107,255; }',
      '[data-dam-tour-art="engine"] { --art-rgb: 142,104,255; --art-rgb-2: 48,154,255; }',
      '[data-dam-tour-art="radar"] { --art-rgb: 52,202,231; --art-rgb-2: 88,117,255; }',
      '[data-dam-tour-art="rocket"] { --art-rgb: 255,115,105; --art-rgb-2: 255,192,71; }',
      '[data-dam-tour-art] .ap { position: absolute; box-sizing: border-box; background: linear-gradient(145deg, rgba(255,255,255,.56) 0%, rgba(var(--art-rgb),.38) 38%, rgba(var(--art-rgb-2),.22) 100%); border: 1.4px solid rgba(255,255,255,.72); box-shadow: inset 0 2px 0 rgba(255,255,255,.72), inset 0 -7px 13px rgba(var(--art-rgb-2),.18), 0 7px 17px rgba(var(--art-rgb),.24); backdrop-filter: blur(5px) saturate(1.4); -webkit-backdrop-filter: blur(5px) saturate(1.4); }',
      '[data-dam-tour-art] .ap::after { content:""; position:absolute; left:18%; top:12%; width:48%; height:24%; border-radius:50%; background:linear-gradient(100deg,rgba(255,255,255,.65),rgba(255,255,255,0)); filter:blur(1.5px); pointer-events:none; }',
      '@keyframes dam-art-enter { from { opacity:0; transform:translateY(-12px) scale(.72) rotate(-8deg); } to { opacity:1; transform:translateY(0) scale(1) rotate(0); } }',
      '@keyframes dam-art-float { 0%,100% { transform:translateY(0) rotate(0); } 50% { transform:translateY(-5px) rotate(2deg); } }',
      // welcome:主泡+两颗品牌色种子，持续呼吸
      '[data-dam-tour-art="bubble"] .bubble-orb { left:10px; top:9px; width:44px; height:44px; border-radius:46% 54% 52% 48% / 50% 44% 56% 50%; animation:dam-bubble-breathe 3.4s ease-in-out infinite; }',
      '[data-dam-tour-art="bubble"] .bubble-seed { border-radius:50%; background:radial-gradient(circle at 35% 30%,#fff 0%,rgba(var(--art-rgb),.9) 34%,rgba(var(--art-rgb-2),.42) 100%); border-color:rgba(255,255,255,.8); }',
      '[data-dam-tour-art="bubble"] .s1 { left:19px; top:24px; width:12px; height:12px; } [data-dam-tour-art="bubble"] .s2 { left:34px; top:18px; width:9px; height:9px; animation:dam-seed-orbit 3s ease-in-out infinite; }',
      '@keyframes dam-bubble-breathe { 0%,100%{border-radius:46% 54% 52% 48% / 50% 44% 56% 50%;transform:scale(1)} 50%{border-radius:54% 46% 47% 53% / 44% 56% 45% 55%;transform:scale(1.05)} }',
      '@keyframes dam-seed-orbit { 0%,100%{transform:translate(0,0)} 50%{transform:translate(4px,-5px)} }',
      // store:同视角彩色微缩板，各自错相浮动
      '[data-dam-tour-art="store"] .plate { left:12px; width:40px; height:14px; border-radius:6px; transform:skewX(-18deg); }',
      '[data-dam-tour-art="store"] .p1 { top:7px; animation:dam-plate-hover 3.2s 0s ease-in-out infinite; } [data-dam-tour-art="store"] .p2 { top:25px; animation:dam-plate-hover 3.2s .38s ease-in-out infinite; } [data-dam-tour-art="store"] .p3 { top:43px; animation:dam-plate-hover 3.2s .76s ease-in-out infinite; }',
      '@keyframes dam-plate-hover { 0%,100%{transform:skewX(-18deg) translateY(0)} 50%{transform:skewX(-18deg) translateY(-4px)} }',
      // inject:青蓝光滴沿胶囊下落并触发脉冲
      '[data-dam-tour-art="inject"] .inject-capsule { left:27px; top:5px; width:11px; height:38px; border-radius:8px 8px 12px 12px; }',
      '[data-dam-tour-art="inject"] .inject-drop { left:25px; top:42px; width:15px; height:15px; border-radius:70% 30% 58% 42% / 66% 40% 60% 34%; transform:rotate(45deg); animation:dam-drop 1.7s ease-in-out infinite; }',
      '[data-dam-tour-art="inject"] .inject-pulse { left:14px; top:52px; width:36px; height:8px; border-radius:50%; border:1.5px solid rgba(var(--art-rgb),.65); background:transparent; animation:dam-pulse 1.7s ease-out infinite; }',
      '@keyframes dam-drop { 0%{transform:translateY(-9px) rotate(45deg);opacity:.35} 55%{transform:translateY(1px) rotate(45deg);opacity:1} 100%{transform:translateY(1px) rotate(45deg);opacity:.5} } @keyframes dam-pulse { 0%,45%{transform:scale(.35);opacity:0} 65%{opacity:.8} 100%{transform:scale(1.2);opacity:0} }',
      // bell:暖金玻璃罩+摆动球舌
      '[data-dam-tour-art="bell"] .bell-shell { left:14px; top:8px; width:36px; height:34px; border-radius:20px 20px 9px 9px; transform-origin:50% 8%; animation:dam-bell-sway 2.8s ease-in-out infinite; }',
      '[data-dam-tour-art="bell"] .bell-base { left:9px; top:42px; width:46px; height:9px; border-radius:8px; } [data-dam-tour-art="bell"] .bell-clapper { left:28px; top:48px; width:9px; height:9px; border-radius:50%; animation:dam-clapper 2.8s ease-in-out infinite; }',
      '@keyframes dam-bell-sway { 0%,100%{transform:rotate(-4deg)} 50%{transform:rotate(4deg)} } @keyframes dam-clapper { 0%,100%{transform:translateX(-3px)} 50%{transform:translateX(3px)} }',
      // calendar:青绿玻璃页+周期翻页
      '[data-dam-tour-art="calendar"] .calendar-card { left:9px; top:13px; width:46px; height:40px; border-radius:11px; } [data-dam-tour-art="calendar"] .calendar-bind { top:5px; width:7px; height:17px; border-radius:5px; } [data-dam-tour-art="calendar"] .b1 { left:20px; } [data-dam-tour-art="calendar"] .b2 { left:38px; }',
      '[data-dam-tour-art="calendar"] .calendar-page { left:13px; top:26px; width:38px; height:21px; border-radius:6px; transform-origin:50% 0; animation:dam-page-flip 4s ease-in-out infinite; } @keyframes dam-page-flip { 0%,68%,100%{transform:rotateX(0)} 78%{transform:rotateX(72deg)} 88%{transform:rotateX(0)} }',
      // link:青紫双环反向摆动
      '[data-dam-tour-art="link"] .link-ring { top:20px; width:31px; height:25px; border-radius:50%; background:rgba(var(--art-rgb),.16); border-width:6px; } [data-dam-tour-art="link"] .l1 { left:2px; transform:rotate(-28deg); animation:dam-link-a 3.2s ease-in-out infinite; } [data-dam-tour-art="link"] .l2 { left:30px; transform:rotate(28deg); animation:dam-link-b 3.2s ease-in-out infinite; }',
      '[data-dam-tour-art="link"] .link-glint { left:29px; top:27px; width:7px; height:7px; border-radius:50%; background:rgba(255,255,255,.9); animation:dam-glint 1.6s ease-in-out infinite; } @keyframes dam-link-a{50%{transform:rotate(-18deg) translateX(2px)}} @keyframes dam-link-b{50%{transform:rotate(18deg) translateX(-2px)}} @keyframes dam-glint{50%{transform:scale(1.5);opacity:.55}}',
      // engine:紫蓝棱镜+呼吸核心+旋转轨道
      '[data-dam-tour-art="engine"] .engine-prism { left:13px; top:13px; width:38px; height:38px; border-radius:12px; transform:rotate(45deg); animation:dam-prism 6s linear infinite; } [data-dam-tour-art="engine"] .engine-core { left:25px; top:25px; width:14px; height:14px; border-radius:50%; background:radial-gradient(circle at 35% 28%,#fff,rgba(var(--art-rgb),.78)); animation:dam-core-breathe 1.8s ease-in-out infinite; }',
      '[data-dam-tour-art="engine"] .engine-orbit { left:6px; top:27px; width:52px; height:14px; border-radius:50%; background:transparent;border:1.5px solid rgba(var(--art-rgb),.62);animation:dam-orbit 4s linear infinite}@keyframes dam-prism{to{transform:rotate(405deg)}}@keyframes dam-core-breathe{50%{transform:scale(1.3);box-shadow:0 0 18px rgba(var(--art-rgb),.7)}}@keyframes dam-orbit{to{transform:rotate(360deg)}}',
      // radar:同心环+真正旋转扫描扇面
      '[data-dam-tour-art="radar"] .radar-outer { left:7px; top:7px; width:50px; height:50px; border-radius:50%; background:rgba(var(--art-rgb),.10); } [data-dam-tour-art="radar"] .radar-inner { left:19px; top:19px; width:26px; height:26px; border-radius:50%; background:rgba(var(--art-rgb-2),.14); }',
      '[data-dam-tour-art="radar"] .radar-sweep { left:8px; top:8px; width:48px; height:48px; border-radius:50%; border:0;background:conic-gradient(from 0deg,rgba(var(--art-rgb),.75),transparent 72deg,transparent);animation:dam-radar-spin 2.2s linear infinite; } [data-dam-tour-art="radar"] .radar-ping { left:27px; top:27px; width:10px; height:10px; border-radius:50%; background:#fff; box-shadow:0 0 15px rgba(var(--art-rgb),.8); animation:dam-core-breathe 1.4s ease-in-out infinite;}@keyframes dam-radar-spin{to{transform:rotate(360deg)}}',
      // rocket:珊瑚金阶梯+循环上升火花
      '[data-dam-tour-art="rocket"] .rocket-tier { height:11px; border-radius:7px; } [data-dam-tour-art="rocket"] .t1 { left:20px; top:42px; width:24px; } [data-dam-tour-art="rocket"] .t2 { left:14px; top:27px; width:36px; } [data-dam-tour-art="rocket"] .t3 { left:8px; top:12px; width:48px; }',
      '[data-dam-tour-art="rocket"] .rocket-spark { left:28px; top:47px; width:9px; height:9px; border-radius:50%; background:radial-gradient(circle,#fff,rgba(var(--art-rgb-2),.85));box-shadow:0 0 14px rgba(var(--art-rgb-2),.7);animation:dam-spark-rise 1.8s ease-in infinite;}@keyframes dam-spark-rise{0%{transform:translateY(8px) scale(.6);opacity:0}25%{opacity:1}100%{transform:translateY(-50px) scale(1.15);opacity:0}}',
      '[data-dam-tour-body] { position: relative; padding: 0 52px; text-align: center; z-index: 2; }',
      '[data-dam-tour-kicker] { font-size: 10px; letter-spacing: .22em; text-transform: uppercase; opacity: .48; font-weight: 700; }',
      '[data-dam-tour-title] { font-size: 23px; font-weight: 750; margin: 6px 0 10px; letter-spacing: -.015em; line-height: 1.22; }',
      '[data-dam-tour-text] { font-size: 13.5px; opacity: .82; line-height: 1.72; min-height: 64px; }',
      '[data-dam-tour-swap] { animation: dam-tour-swap .34s cubic-bezier(.2,.8,.3,1) both; }',
      '@keyframes dam-tour-swap { from { opacity: 0; transform: translateX(22px); } to { opacity: 1; transform: none; } }',
      '[data-dam-tour-dl] { margin: 8px auto 0; max-width: 420px; text-align: left; font-size: 12px; }',
      '[data-dam-tour-dl-row] { display: flex; justify-content: space-between; gap: 10px; opacity: .75; font-size: 10.5px; margin-bottom: 3px; }',
      '[data-dam-tour-dl-tier] { margin-top: 8px; border: 1px solid rgba(128,128,128,.22); border-radius: 9px; overflow: hidden; }',
      '[data-dam-tour-dl-tier-row] { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; padding: 7px 10px; font-size: 11px; }',
      '[data-dam-tour-dl-tier-row:first-child] { border-bottom: 1px solid rgba(128,128,128,.14); background: rgba(47,164,106,.08); }',
      '[data-dam-tour-dl-tier-row] b { font-weight: 700; white-space: nowrap; }',
      '[data-dam-tour-dl-tier-row] span { opacity: .7; font-size: 10.5px; text-align: right; }',
      '[data-dam-tour-bar] { height: 7px; border-radius: 99px; background: rgba(128,128,128,.18); overflow: hidden; }',
      '[data-dam-tour-bar-i] { height: 100%; border-radius: 99px; background: linear-gradient(90deg, var(--dam-accent, #2456c4), #7ea4ff); transition: width .4s ease; }',
      '[data-dam-tour-dots] { display: flex; gap: 7px; justify-content: center; margin: 18px 0 4px; z-index: 2; position: relative; }',
      '[data-dam-tour-dot] { width: 7px; height: 7px; border-radius: 99px; background: currentColor; opacity: .22; transition: all .35s cubic-bezier(.4,0,.2,1); border: none; cursor: pointer; padding: 0; }',
      '[data-dam-tour-dot]:hover { opacity: .5; }',
      '[data-dam-tour-dot][data-on="true"] { width: 22px; opacity: .85; }',
      '[data-dam-tour-foot] { display: flex; align-items: center; gap: 11px; padding: 10px 28px 22px; z-index: 2; position: relative; }',
      '[data-dam-tour-skip] { border: none; background: transparent; color: inherit; opacity: .45; cursor: pointer; font-size: 12px; margin-right: auto; padding: 7px 11px; border-radius: 8px; transition: opacity .2s ease, background .2s ease; }',
      '[data-dam-tour-skip]:hover { opacity: .85; background: rgba(128,128,128,.12); }',
      '[data-dam-tour-btn] { min-width: 100px; padding: 10px 24px; border-radius: 99px; font-size: 13px; font-weight: 650; cursor: pointer; transition: all .22s ease; border: 1px solid rgba(255,255,255,.4); color: inherit; }',
      '[data-dam-tour-btn][data-primary="true"] { background: linear-gradient(180deg, var(--dam-accent, #3a6df0), color-mix(in srgb, var(--dam-accent, #3a6df0) 82%, #000)); color: #fff; border-color: transparent; box-shadow: 0 6px 18px color-mix(in srgb, var(--dam-accent, #3a6df0) 45%, transparent), inset 0 1px 0 rgba(255,255,255,.35); }',
      '[data-dam-tour-btn][data-primary="true"]:hover { transform: translateY(-1px); box-shadow: 0 10px 24px color-mix(in srgb, var(--dam-accent, #3a6df0) 55%, transparent), inset 0 1px 0 rgba(255,255,255,.35); }',
      '[data-dam-tour-btn][data-primary="false"] { background: rgba(255,255,255,.10); }',
      '[data-dam-tour-btn][data-primary="false"]:hover { background: rgba(255,255,255,.22); }',
      '[data-dam-tour-btn]:disabled { opacity: .35; cursor: default; transform: none; }',
      '[data-dam-tour-badge] { display: inline-block; font-size: 11px; font-weight: 700; padding: 3px 12px; border-radius: 99px; margin-top: 2px; }',
      '[data-dam-tour-rec] { display: inline-block; font-size: 9.5px; font-weight: 700; padding: 1px 7px; border-radius: 99px; margin-left: 7px; vertical-align: 1px; letter-spacing: .04em; background: color-mix(in srgb, var(--dam-accent, #3a6df0) 20%, transparent); color: var(--dam-accent, #3a6df0); }',
      // 向导内功能开关(即时写配置)
      '[data-dam-tour-toggles] { display: flex; flex-direction: column; gap: 9px; margin: 14px auto 0; max-width: 448px; text-align: left; }',
      '[data-dam-tour-toggles][data-scroll="true"] { max-height: min(240px, 42vh); overflow-y: auto; padding-right: 4px; }',
      '[data-dam-tour-toggles][data-scroll="true"]::-webkit-scrollbar { width: 5px; }',
      '[data-dam-tour-toggles][data-scroll="true"]::-webkit-scrollbar-thumb { background: rgba(255,255,255,.18); border-radius: 99px; }',
      '[data-dam-tour-tg] { display: flex; align-items: center; gap: 13px; padding: 11px 16px; border-radius: 14px; background: rgba(255,255,255,.07); border: 1px solid rgba(255,255,255,.14); cursor: pointer; transition: background .2s ease, border-color .2s ease, transform .16s ease; text-align: left; color: inherit; font: inherit; }',
      '[data-dam-tour-tg]:hover { background: rgba(255,255,255,.13); }',
      '[data-dam-tour-tg]:active { transform: scale(.992); }',
      '[data-dam-tour-tg][data-on="true"] { border-color: color-mix(in srgb, var(--dam-accent, #3a6df0) 55%, transparent); background: color-mix(in srgb, var(--dam-accent, #3a6df0) 11%, rgba(255,255,255,.06)); }',
      '[data-dam-tour-tg-txt] { flex: 1; min-width: 0; }',
      '[data-dam-tour-tg-name] { font-size: 13px; font-weight: 700; line-height: 1.35; }',
      '[data-dam-tour-tg-sub] { font-size: 11px; opacity: .60; margin-top: 2px; line-height: 1.45; }',
      '[data-dam-tour-sw] { flex: none; width: 40px; height: 23px; border-radius: 99px; position: relative; background: rgba(128,128,128,.35); transition: background .25s ease; }',
      '[data-dam-tour-sw]::after { content: ""; position: absolute; top: 2.5px; left: 2.5px; width: 18px; height: 18px; border-radius: 50%; background: #fff; transition: left .25s cubic-bezier(.4,0,.2,1); box-shadow: 0 1px 4px rgba(0,0,0,.3); }',
      '[data-dam-tour-sw][data-on="true"] { background: var(--dam-accent, #3a6df0); }',
      '[data-dam-tour-sw][data-on="true"]::after { left: 19.5px; }',
      '[data-dam-tour-chips] { display: flex; flex-wrap: wrap; gap: 7px; justify-content: center; margin-top: 12px; }',
      '[data-dam-tour-where] { font-size: 11.5px; opacity: .72; line-height: 1.75; margin-top: 12px; text-align: left; max-width: 460px; margin-left: auto; margin-right: auto; }',
      '[data-dam-tour-where] b { opacity: .96; font-weight: 650; }',
      // ── CHANGELOG 开场序列:Logo 组装→展开→消散→内容浮现 ──
      '[data-dam-update-box] { position: relative; overflow: hidden; min-height: 150px; }',
      '[data-dam-update-stage] { position: absolute; inset: 0; z-index: 2; display: flex; align-items: center; justify-content: center; background: inherit;',
      '  animation: dam-update-intro 1.7s cubic-bezier(.2,.8,.2,1) both; will-change: opacity, filter, transform; }',
      '[data-dam-update-click] { position: absolute; inset: 0; z-index: 3; cursor: pointer; }',
      '[data-dam-update-box][data-skip="true"] [data-dam-update-stage], [data-dam-update-box][data-skip="true"] [data-dam-update-click] { display: none; }',
      '[data-dam-update-content] { animation: dam-update-content-in 1.7s ease both; }',
      // 内容可滚动:update-content 自管滚动(update-box 是 overflow:hidden 的舞台层,内容长会被裁)
      '[data-dam-update-content] { max-height: min(46vh, 430px); overflow-y: auto; overscroll-behavior: contain; padding-right: 4px; scrollbar-width: thin; scrollbar-color: rgba(255,255,255,.25) transparent; }',
      '[data-dam-update-content]::-webkit-scrollbar { width: 6px; }',
      '[data-dam-update-content]::-webkit-scrollbar-thumb { background: rgba(255,255,255,.22); border-radius: 99px; }',
      '[data-dam-update-content]::-webkit-scrollbar-track { background: transparent; }',
      '[data-dam-update-box][data-skip="true"] [data-dam-update-content] { animation: none; opacity: 1; transform: none; }',
      '@keyframes dam-update-intro { 0%, 41% { opacity: 1; filter: blur(0); transform: scale(1); } 59% { opacity: 1; filter: blur(0); transform: scale(1); } 88% { opacity: 0; filter: blur(6px); transform: scale(1.06); height: 100%; } 100% { opacity: 0; height: 0; } }',
      '@keyframes dam-update-content-in { 0%, 82% { opacity: 0; transform: translateY(12px); } 100% { opacity: 1; transform: none; } }',
      '[data-dam-update-logo] { position: relative; width: 120px; height: 120px; perspective: 680px; transform: scale(.78); --dam-slab-z: 22px; }',
      '[data-dam-update-logo] [data-dam-tour-stage] { animation: dam-stage-float 4.6s ease-in-out infinite, dam-update-logo-expand 1.7s cubic-bezier(.2,.8,.2,1) both; }',
      '@keyframes dam-update-logo-expand { 0%, 41% { transform: translate(-50%, -50%) rotateX(55deg) rotateZ(45deg) translateZ(0) scale(1); } 59% { transform: translate(-50%, -50%) rotateX(48deg) rotateZ(38deg) translateZ(16px) scale(1.16); } 100% { transform: translate(-50%, -50%) rotateX(55deg) rotateZ(45deg) translateZ(0) scale(1); } }',
      '[data-dam-update-logo] [data-dam-tour-bokeh] { animation-delay: 0s; opacity: .92; }',
      '[data-dam-update-logo] [data-dam-tour-slab="top"] { animation-delay: 0s; }',
      '[data-dam-update-logo] [data-dam-tour-slab="mid"] { animation-delay: .13s; }',
      '[data-dam-update-logo] [data-dam-tour-slab="bot"] { animation-delay: .26s; }',
      '[data-dam-update-logo] [data-dam-tour-orb-core] { animation-delay: .42s; }',
      '[data-dam-update-hint] { position: absolute; bottom: 14px; font-size: 11px; opacity: .42; letter-spacing: .04em; pointer-events: none; }',
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

    // M7.5/G-02 前置:唤起记录与语料精修(A/P/S/H/E)——数据源=shadow-recent 只读投影,
    // 用户判定写入 append-only review-queue.jsonl(不直接改任何策略/参数)。
    function RefineTab() {
      var dataPair = useState(null)
      var data = dataPair[0]
      var setData = dataPair[1]
      var errPair = useState('')
      var err = errPair[0]
      var setErr = errPair[1]
      var sentPair = useState({})
      var sent = sentPair[0]
      var setSent = sentPair[1]
      var fbPair = useState(null)
      var fb = fbPair[0]
      var setFb = fbPair[1]
      useEffect(function () {
        var alive = true
        fetch('/api/dsh-auto-memory/shadow-recent').then(function (r) { return r.json() }).then(function (j) {
          if (alive) setData((j && j.rows) || [])
        }).catch(function (e) { if (alive) setErr(String(e && e.message)) })
        fetch('/api/dsh-auto-memory/review-feedback').then(function (r) { return r.json() }).then(function (j) {
          if (alive) setFb(j || {})
        }).catch(function () {})
        return function () { alive = false }
      }, [])
      function send(obsId, choice) {
        fetch('/api/dsh-auto-memory/review-feedback', { method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ observationId: obsId, choice: choice }) })
          .then(function (r) { return r.json() })
          .then(function (j) { if (j && j.ok) { var n = Object.assign({}, sent); n[obsId] = choice; setSent(n) } })
          .catch(function () {})
      }
      // 美术规格对齐 artifacts/m7-live-pre/ui-assets/semantic-tier-ui.html 组件③
      var card = { border: '1px solid color-mix(in srgb, var(--dsw-alias-border-l1, rgba(255,255,255,.16)) 55%, transparent)', borderRadius: '12px', padding: '10px 12px', marginBottom: '9px', background: 'color-mix(in srgb, var(--dsw-alias-bg-layer-1, rgba(128,128,128,.08)) 45%, transparent)', boxShadow: '0 4px 14px rgba(0,0,0,.12), inset 0 1px 0 rgba(255,255,255,.14)' }
      var badge = function (txt, bg, fg) { return h('span', { style: { fontSize: 'calc(10.5px * var(--dam-scale))', fontWeight: 700, padding: '2px 8px', borderRadius: '6px', background: bg, color: fg || 'var(--dsw-alias-text-primary, inherit)', letterSpacing: '.02em' } }, txt) }
      var decBg = { emit: ['rgba(47,164,106,.24)', '#7fdcb0'], prefetch: ['rgba(196,138,42,.2)', '#e8c584'], suppress: ['rgba(128,128,128,.16)', 'rgba(255,255,255,.65)'] }
      var laneBg = { explicit: ['rgba(111,155,255,.24)', '#b9ceff'], proactive: ['rgba(160,120,255,.22)', '#d4c2ff'] }
      var reasonChip = function (txt) { return h('span', { style: { fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 'calc(10px * var(--dam-scale))', padding: '2px 7px', borderRadius: '5px', background: 'rgba(255,214,150,.1)', color: '#ffd9a1' } }, txt) }
      var apeRow = function (obsId) {
        var choices = [['A', locale === 'zh' ? '该激活' : 'activate'], ['P', locale === 'zh' ? '只预取' : 'prefetch'], ['S', locale === 'zh' ? '应抑制' : 'suppress'], ['H', locale === 'zh' ? '有害' : 'harmful'], ['E', locale === 'zh' ? '改目标' : 'edit']]
        return h('div', { style: { display: 'flex', gap: '6px', marginTop: '8px' } }, choices.map(function (c) {
          var picked = sent[obsId] === c[0]
          return h('button', { key: c[0], 'data-dam-btn': '', onClick: function () { send(obsId, c[0]) },
            style: Object.assign({ flex: '1', fontSize: 'calc(11px * var(--dam-scale))', padding: '6px 2px', borderRadius: '9px', cursor: 'pointer', border: '1px solid rgba(255,255,255,.12)', transition: 'all .2s' },
              picked ? { borderColor: 'var(--dam-accent, #2456c4)', background: 'color-mix(in srgb, var(--dam-accent, #2456c4) 26%, transparent)', boxShadow: '0 2px 10px rgba(36,86,196,.35)' } : {}),
            onmouseover: function (e) { e.currentTarget.style.background = picked ? e.currentTarget.style.background : 'rgba(255,255,255,.1)' },
            onmouseout: function (e) { if (!picked) e.currentTarget.style.background = '' } },
            c[0], h('small', { style: { display: 'block', opacity: .6 } }, c[1]))
        }))
      }
      if (err) return h('div', null, t('refineLoadErr'), err)
      if (!data) return h('div', null, t('loading'))
      if (!data.length) return h('div', { style: { opacity: .65 } }, t('refineEmpty'))
      // 按天分组(行带 ts;无 ts 的旧行归入「更早」),组内倒序
      var sorted = data.slice().sort(function (a, b) { return (b.ts || 0) - (a.ts || 0) })
      var dayKey = function (ts) {
        if (!ts) return locale === 'zh' ? '更早' : 'Earlier'
        var d = new Date(ts * 1000)
        var today = new Date(); var yest = new Date(today.getTime() - 86400000)
        var same = function (a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate() }
        if (same(d, today)) return locale === 'zh' ? '今天' : 'Today'
        if (same(d, yest)) return locale === 'zh' ? '昨天' : 'Yesterday'
        return (d.getMonth() + 1) + '-' + d.getDate()
      }
      var groups = []
      var index = {}
      sorted.forEach(function (row) {
        var k = dayKey(row.ts)
        if (!index[k]) { index[k] = []; groups.push({ day: k, rows: index[k] }) }
        index[k].push(row)
      })
      var card = { border: '1px solid color-mix(in srgb, var(--dsw-alias-border-l1, rgba(255,255,255,.16)) 55%, transparent)', borderRadius: '12px', padding: '10px 12px', marginBottom: '9px', background: 'color-mix(in srgb, var(--dsw-alias-bg-layer-1, rgba(128,128,128,.08)) 45%, transparent)', boxShadow: '0 4px 14px rgba(0,0,0,.12), inset 0 1px 0 rgba(255,255,255,.14)' }
      var badge = function (txt, bg, fg) { return h('span', { style: { fontSize: 'calc(10.5px * var(--dam-scale))', fontWeight: 700, padding: '2px 8px', borderRadius: '6px', background: bg, color: fg || 'var(--dsw-alias-text-primary, inherit)', letterSpacing: '.02em' } }, txt) }
      var decBg = { emit: ['rgba(47,164,106,.24)', '#7fdcb0'], prefetch: ['rgba(196,138,42,.2)', '#e8c584'], suppress: ['rgba(128,128,128,.16)', 'rgba(255,255,255,.65)'] }
      var laneBg = { explicit: ['rgba(111,155,255,.24)', '#b9ceff'], proactive: ['rgba(160,120,255,.22)', '#d4c2ff'] }
      var reasonChip = function (txt) { return h('span', { style: { fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 'calc(10px * var(--dam-scale))', padding: '2px 7px', borderRadius: '5px', background: 'rgba(255,214,150,.1)', color: '#ffd9a1' } }, txt) }
      var apeRow = function (obsId) {
        var choices = [['A', locale === 'zh' ? '该激活' : 'activate'], ['P', locale === 'zh' ? '只预取' : 'prefetch'], ['S', locale === 'zh' ? '应抑制' : 'suppress'], ['H', locale === 'zh' ? '有害' : 'harmful'], ['E', locale === 'zh' ? '改目标' : 'edit']]
        return h('div', { style: { display: 'flex', gap: '6px', marginTop: '8px' } }, choices.map(function (c) {
          var picked = sent[obsId] === c[0]
          return h('button', { key: c[0], 'data-dam-btn': '', onClick: function () { send(obsId, c[0]) },
            style: Object.assign({ flex: '1', fontSize: 'calc(11px * var(--dam-scale))', padding: '6px 2px', borderRadius: '9px', cursor: 'pointer', border: '1px solid rgba(255,255,255,.12)', transition: 'all .2s' },
              picked ? { borderColor: 'var(--dam-accent, #2456c4)', background: 'color-mix(in srgb, var(--dam-accent, #2456c4) 26%, transparent)', boxShadow: '0 2px 10px rgba(36,86,196,.35)' } : {}),
            onmouseover: function (e) { e.currentTarget.style.background = picked ? e.currentTarget.style.background : 'rgba(255,255,255,.1)' },
            onmouseout: function (e) { if (!picked) e.currentTarget.style.background = '' } },
            c[0], h('small', { style: { display: 'block', opacity: .6 } }, c[1]))
        }))
      }
      return h('div', null,
        h('div', { style: { fontSize: 'calc(11.5px * var(--dam-scale))', opacity: .75, marginBottom: '10px', lineHeight: 1.55 } }, t('refineSub')),
        // G-02 v2:判定队列汇总 + 政策提示(纯描述,不改参数)
        fb && (fb.queue && fb.queue.length || (fb.hints && fb.hints.length)) ? h('div', { style: Object.assign({}, card, { borderLeft: '3px solid var(--dam-accent, #2456c4)' }) },
          h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: (fb.hints && fb.hints.length) ? '7px' : '0' } },
            ['A', 'P', 'S', 'H', 'E'].map(function (ch) {
              var n = (fb.byChoice || {})[ch] || 0
              if (!n) return null
              return badge(ch + '×' + n, ch === 'H' ? 'rgba(220,80,80,.2)' : 'rgba(90,140,255,.16)', ch === 'H' ? '#ff9c9c' : null)
            }),
            h('span', { style: { marginLeft: 'auto', opacity: .55, fontSize: 'calc(10px * var(--dam-scale))' } }, locale === 'zh' ? '判定队列(近 100 条)' : 'review queue (last 100)')),
          (fb.hints || []).map(function (hint, hi) {
            return h('div', { key: hi, style: { fontSize: 'calc(10.5px * var(--dam-scale))', opacity: .8, lineHeight: 1.5, margin: '3px 0' } }, '· ' + hint)
          })
        ) : null,
        groups.map(function (grp) {
          return h('div', { key: grp.day, style: { marginBottom: '16px' } },
            h('div', { style: { fontSize: 'calc(11.5px * var(--dam-scale))', fontWeight: 700, opacity: .7, margin: '2px 2px 8px' } }, grp.day),
            grp.rows.map(function (row, i) {
              var rc = row.reasonCodes || []
              var del = row.delivery
              return h('div', { key: row.observationId || i, style: card },
                h('div', { style: { display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '5px' } },
                  (function () { var lk = row.lane === 'explicit' ? 'explicit' : 'proactive'; var c = laneBg[lk] || ['rgba(128,128,128,.16)', null]; return badge(locale === 'zh' ? (lk === 'explicit' ? '明确召回' : '主动观测') : lk, c[0], c[1]) })(),
                  (function () { var dk = String(row.decision); var c = decBg[dk] || ['rgba(128,128,128,.14)', null]; return badge(dk.toUpperCase(), c[0], c[1]) })(),
                  // G-02 v2:投递结果徽标(emit/prefetch 行显示;关联是时间窗+记忆交集的启发式)
                  del ? badge(locale === 'zh' ? '✓投递×' + del.count : '✓delivered×' + del.count, 'rgba(47,164,106,.2)', '#7fdcb0') : null,
                  del && del.skill ? badge(locale === 'zh' ? '技能✓' : 'skill✓', 'rgba(160,120,255,.24)', '#d4c2ff') : null,
                  !del && String(row.decision) === 'emit' ? badge(locale === 'zh' ? '未投递' : 'not delivered', 'rgba(196,80,80,.14)', '#e8a1a1') : null,
                  row.ts ? h('span', { style: { marginLeft: 'auto', opacity: .5, fontSize: 'calc(10.5px * var(--dam-scale))' } }, new Date(row.ts * 1000).toTimeString().slice(0, 5)) : null),
                h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '5px', margin: '7px 0' } },
                  rc.length ? rc.map(function (code, ci) { return reasonChip(code) }) : [h('span', { key: 'none', style: { opacity: .4, fontSize: 'calc(10px * var(--dam-scale))' } }, '-')]),
                apeRow(row.observationId))
            }))
        }))
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

    // M8 记忆中枢页签:展示三层记忆(经历/事实/技能)概览。数据源=/memory-hub 只读投影。
    function MemoryHubTab(props) {
      var nonce = props && props.nonce ? props.nonce : 0
      var dataPair = useState(null)
      var data = dataPair[0]
      var setData = dataPair[1]
      var errPair = useState('')
      var err = errPair[0]
      var setErr = errPair[1]
      var refreshPair = useState(0)
      var refreshTick = refreshPair[0]
      var setRefresh = refreshPair[1]
      var actMsgPair = useState('')
      var actMsg = actMsgPair[0]
      var setActMsg = actMsgPair[1]
      useEffect(function () {
        var alive = true
        fetch('/api/dsh-auto-memory/memory-hub').then(function (r) { return r.json() }).then(function (j) {
          if (alive) setData(j || null)
        }).catch(function (e) { if (alive) setErr(String(e && e.message)) })
        return function () { alive = false }
      }, [nonce, refreshTick])
      // M9 审批动作(G-02 同款 append-only 精神):晋升/激活/弃用走 /memory-hub POST,
      // 后端走 store 门槛判定,不绕过任何 gate;动作后刷新 overview。
      function hubAct(action, procedureId, v) {
        fetch('/api/dsh-auto-memory/memory-hub', { method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: action, procedureId: procedureId, v: v }) })
          .then(function (r) { return r.json() })
          .then(function (j) {
            setActMsg(action + ': ' + (j && (j.decision || j.reason || (j.ok === false ? (j.reason || 'rejected') : 'ok')) || 'done'))
            setRefresh(function (x) { return x + 1 })
          })
          .catch(function (e) { setActMsg(action + ' failed: ' + String(e && e.message)) })
      }
      if (err) return h('div', { 'data-dam-hint': '' }, t('searchFailed') + err)
      if (!data) return h(Loading, { label: t('loading') })
      var rows = []
      var procs = data.procedures
      var facts = data.facts
      var epis = data.episodic
      // 技能层(最精彩: 反复成功的流程固化为 skill)
      rows.push(h('div', { 'data-dam-hint': '', style: { marginTop: '8px' } }, t('hubSkills')))
      var activeList = (procs && procs.active) || []
      if (!activeList.length) {
        rows.push(h(Card, { title: t('hubSkills') + ' (' + (locale === 'zh' ? '暂无' : 'none') + ')' }, h('div', { 'data-dam-content': '' }, t('hubSkillsEmpty'))))
      } else {
        rows.push(h(Card, { title: t('hubSkills') + ' (' + activeList.length + ')' },
          activeList.map(function (p) {
            var risk = p.riskLevel === 'high' ? (locale === 'zh' ? '· 高风险需确认' : '· high-risk') : ''
            return h('div', { 'data-dam-content': '', key: p.procedureId, style: { padding: '4px 0', borderBottom: '1px solid color-mix(in srgb, var(--dsw-alias-border-l1, rgba(255,255,255,.16)) 40%, transparent)' } },
              h('div', null, h('b', null, p.title), h('span', { 'data-dam-hint': '', style: { marginLeft: '6px' } }, (locale === 'zh' ? '成功 ' : 'success ') + (p.evidence ? p.evidence.success : 0) + ' · ' + (locale === 'zh' ? '会话 ' : 'sessions ') + (p.evidence ? p.evidence.sessions : 0) + ' ' + risk),
              h('button', { 'data-dam-btn': '', style: { marginLeft: '8px', fontSize: 'calc(10px * var(--dam-scale))', padding: '2px 8px' }, onClick: function () { hubAct('deprecate', p.procedureId) } }, locale === 'zh' ? '弃用' : 'deprecate'),
              h('button', { 'data-dam-btn': '', style: { marginLeft: '4px', fontSize: 'calc(10px * var(--dam-scale))', padding: '2px 8px' }, onClick: function () { hubAct('pin', p.procedureId, !(procs && procs.pipeline && procs.pipeline.concat(activeList).find(function (x) { return x.procedureId === p.procedureId && x.pinned }))) } }, locale === 'zh' ? '置顶' : 'pin')))
          })))
      }
      // M9 审批队列(observed/candidate/validated):用户确认晋升/激活/弃用
      var pipeline = (procs && procs.pipeline) || []
      if (pipeline.length) {
        rows.push(h(Card, { title: (locale === 'zh' ? '技能审批队列' : 'Skill approval queue') + ' (' + pipeline.length + ')' },
          pipeline.map(function (p) {
            var ev = p.evidence || {}
            return h('div', { 'data-dam-content': '', key: p.procedureId, style: { padding: '5px 0', borderBottom: '1px solid color-mix(in srgb, var(--dsw-alias-border-l1, rgba(255,255,255,.16)) 40%, transparent)' } },
              h('div', null, h('b', null, p.title), h('span', { 'data-dam-hint': '', style: { marginLeft: '6px' } }, '[' + p.stage + ']' + (p.pinned ? ' 📌' : '') + (p.riskLevel === 'high' ? ' ⚠' : '')),
                h('span', { 'data-dam-hint': '', style: { marginLeft: '6px' } }, (locale === 'zh' ? '成功 ' : 'succ ') + (ev.success || 0) + ' · ' + (locale === 'zh' ? '会话 ' : 'sess ') + (ev.sessions || 0))),
              h('div', { style: { display: 'flex', gap: '6px', marginTop: '5px' } },
                h('button', { 'data-dam-btn': '', style: { fontSize: 'calc(10.5px * var(--dam-scale))', padding: '3px 10px' }, onClick: function () { hubAct('promote', p.procedureId) } }, locale === 'zh' ? '晋升' : 'promote'),
                h('button', { 'data-dam-btn': '', style: { fontSize: 'calc(10.5px * var(--dam-scale))', padding: '3px 10px' }, onClick: function () { hubAct('activate', p.procedureId) } }, locale === 'zh' ? '直接激活' : 'activate'),
                h('button', { 'data-dam-btn': '', style: { fontSize: 'calc(10.5px * var(--dam-scale))', padding: '3px 10px', opacity: .75 }, onClick: function () { hubAct('deprecate', p.procedureId) } }, locale === 'zh' ? '弃用' : 'deprecate'),
                h('button', { 'data-dam-btn': '', style: { fontSize: 'calc(10.5px * var(--dam-scale))', padding: '3px 10px', opacity: .75 }, onClick: function () { hubAct('pin', p.procedureId, !p.pinned) } }, p.pinned ? (locale === 'zh' ? '取消置顶' : 'unpin') : (locale === 'zh' ? '置顶' : 'pin'))))
          })))
      }
      if (actMsg) rows.push(h('div', { 'data-dam-hint': '', style: { marginTop: '6px', color: 'var(--dsw-alias-warn, #e8c584)' } }, actMsg))
      // 事实层
      rows.push(h('div', { 'data-dam-hint': '', style: { marginTop: '12px' } }, t('hubFacts')))
      var factList = (facts && facts.recent) || []
      rows.push(h(Card, { title: t('hubFacts') + ' (' + (facts ? facts.size : 0) + ')' },
        factList.length ? factList.slice(0, 6).map(function (f) {
          return h('div', { 'data-dam-content': '', key: f.factId, style: { padding: '3px 0' } }, f.subject + ' · ' + f.predicate + (f.object ? ' · ' + f.object : ''))
        }) : h('div', { 'data-dam-content': '' }, t('hubFactsEmpty'))))
      if (facts && facts.pendingConflicts && facts.pendingConflicts.length) {
        rows.push(h('div', { 'data-dam-hint': '', style: { color: 'var(--dsw-alias-warn, #e8c584)' } }, t('hubConflicts') + ': ' + facts.pendingConflicts.length))
      }
      // 经历层
      rows.push(h('div', { 'data-dam-hint': '', style: { marginTop: '12px' } }, t('hubEpisodic')))
      var epiList = (epis && epis.recent) || []
      rows.push(h(Card, { title: t('hubEpisodic') + ' (' + (epis ? epis.size : 0) + ')' },
        epiList.length ? epiList.slice(0, 6).map(function (e) {
          return h('div', { 'data-dam-content': '', key: e.episodeId, style: { padding: '3px 0' } },
            (e.intent || '').slice(0, 40) + ' · ' + (e.outcome || 'unknown') + (e.success ? ' ✓' : ''))
        }) : h('div', { 'data-dam-content': '' }, t('hubEpisodicEmpty'))))
      // 统计
      rows.push(h('div', { 'data-dam-hint': '', style: { marginTop: '12px', opacity: .7 } },
        (locale === 'zh' ? '中枢统计: ' : 'Hub stats: ') + (data.stats ? JSON.stringify(data.stats) : '')))
      return h('div', null, rows)
    }

    // M10 存储管理页签(2026-08-30 P3):数据源=/storage-manage(loopback 只读投影 + 三类动作)。
    // ①健康扫描:逐源 sidecar↔正文 digest 比对;②stale 一键自愈(只重建 sidecar,正文不动);
    // ③按 memoryId 删除(正文原子删 + 在途激活包清理 + 派生事实撤销三联动,后端做路径白名单)。
    function StorageTab(props) {
      var nonce = props && props.nonce ? props.nonce : 0
      var dataPair = useState(null)
      var data = dataPair[0]
      var setData = dataPair[1]
      var errPair = useState('')
      var err = errPair[0]
      var setErr = errPair[1]
      var msgPair = useState('')
      var msg = msgPair[0]
      var setMsg = msgPair[1]
      var delPair = useState('')
      var delId = delPair[0]
      var setDelId = delPair[1]
      var filePair = useState('')
      var delFile = filePair[0]
      var setDelFile = filePair[1]
      useEffect(function () {
        var alive = true
        fetch('/api/dsh-auto-memory/storage-manage').then(function (r) { return r.json() }).then(function (j) {
          if (alive) setData(j || null)
        }).catch(function (e) { if (alive) setErr(String(e && e.message)) })
        return function () { alive = false }
      }, [nonce])
      function act(action, payload, onDone) {
        setMsg('')
        var body = Object.assign({ action: action }, payload || {})
        fetch('/api/dsh-auto-memory/storage-manage', { method: 'POST',
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
          .then(function (r) { return r.json() })
          .then(function (j) {
            setMsg(action + ': ' + (j && (j.reason || (j.ok === false ? 'rejected' : 'ok')) || 'done'))
            if (onDone) onDone(j)
            var again = fetch('/api/dsh-auto-memory/storage-manage').then(function (r2) { return r2.json() })
            again.then(function (j2) { setData(j2 || null) })
          })
          .catch(function (e) { setMsg(action + ' failed: ' + String(e && e.message)) })
      }
      if (err) return h('div', { 'data-dam-hint': '' }, t('searchFailed') + err)
      if (!data) return h(Loading, { label: t('loading') })
      if (data.error) return h('div', { 'data-dam-hint': '' }, String(data.error))
      var counts = data.counts || { total: 0, ok: 0, stale: 0, unrepairable: 0 }
      var rows = []
      rows.push(h('div', { 'data-dam-hint': '', style: { marginTop: '8px' } }, t('storageScanHint')))
      rows.push(h(Card, { title: (locale === 'zh' ? '语料健康' : 'Corpus health') + ' (' + counts.ok + '/' + counts.total + ' ok)' },
        h('div', null,
          (data.sources || []).map(function (s) {
            var mark = s.status === 'ok' ? '✓' : (s.status === 'stale' ? '⚠' : '✕')
            return h('div', { 'data-dam-content': '', key: s.sourceRef, style: { padding: '3px 0' } },
              mark + ' ' + s.sourceRef + ' [' + s.status + ']' + (s.reasons && s.reasons.length ? ' · ' + s.reasons.join(', ') : ''))
          }),
          h('div', { style: { display: 'flex', gap: '6px', marginTop: '8px' } },
            h('button', { 'data-dam-btn': '', style: { fontSize: 'calc(10.5px * var(--dam-scale))', padding: '3px 10px' }, onClick: function () { act('scan') } }, locale === 'zh' ? '重新扫描' : 'rescan'),
            h('button', { 'data-dam-btn': '', style: { fontSize: 'calc(10.5px * var(--dam-scale))', padding: '3px 10px', opacity: counts.stale ? 1 : .5 }, onClick: function () { if (counts.stale) act('repair', { items: (data.stale || []).map(function (s) { return { file: s.file, sourceRef: s.sourceRef } }) }) } },
              (locale === 'zh' ? '修复 stale' : 'repair stale') + (counts.stale ? ' (' + counts.stale + ')' : ''))))))
      // 删除(三联动):文件路径 + memoryId。后端校验路径必须属于当前语料三源之一。
      rows.push(h('div', { 'data-dam-hint': '', style: { marginTop: '12px' } }, t('storageDeleteHint')))
      rows.push(h(Card, { title: locale === 'zh' ? '删除记忆(三联动)' : 'Delete memory (cascading)' },
        h('div', null,
          h('select', { 'data-dam-select': '', value: delFile, onChange: function (e) { setDelFile(e.target.value) }, style: { width: '100%' } },
            h('option', { value: '' }, locale === 'zh' ? '选择语料文件…' : 'select corpus file…'),
            (data.sources || []).map(function (s) { return h('option', { key: s.sourceRef, value: s.file }, s.sourceRef + ' — ' + s.file) })),
          h('input', { 'data-dam-input': '', placeholder: 'mem_…', value: delId, onChange: function (e) { setDelId(e.target.value) }, style: { width: '100%', marginTop: '6px' } }),
          h('div', { style: { display: 'flex', gap: '6px', marginTop: '6px' } },
            h('button', { 'data-dam-btn': '', style: { fontSize: 'calc(10.5px * var(--dam-scale))', padding: '3px 10px', opacity: (delFile && delId) ? 1 : .5 },
              onClick: function () {
                if (!(delFile && delId)) return
                act('delete', { filePath: delFile, memoryId: delId }, function () { setDelId('') })
              } }, locale === 'zh' ? '删除' : 'delete')))))
      if (msg) rows.push(h('div', { 'data-dam-hint': '', style: { marginTop: '6px', color: 'var(--dsw-alias-warn, #e8c584)' } }, msg))
      var audit = (data.audit || []).slice(-4)
      if (audit.length) {
        rows.push(h('div', { 'data-dam-hint': '', style: { marginTop: '12px', opacity: .7 } },
          (locale === 'zh' ? '最近动作: ' : 'recent: ') + audit.map(function (a) { return a.action }).join(', ')))
      }
      return h('div', null, rows)
    }

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
      var panelRef = useRef(null)
      var tabPair = useState('overview')
      var tab = tabPair[0]
      var setTab = tabPair[1]
      // 刷新 nonce:每次打开面板 / 点 ⟳ 时递增,驱动各页签重拉数据
      var noncePair = useState(0)
      var nonce = noncePair[0]
      var setNonce = noncePair[1]
      var g = controller.geom()
      useEffect(function () { return controller.subscribe(tick[1]) }, [])
      // 可读性兜底(@ProperSAMA PR#12,适配版):DSH Desktop 增强模式 + 透明/Mica 窗口材质下,
      // 主题令牌 --dsw-alias-bg-overlay 本身就是半透明的,面板文字几乎不可读。判别信号用
      // 「令牌自身的 alpha」(增强模式显著低于普通模式的 0.86-0.9):< 0.65 时把面板背景提升到
      // 0.96(保留色相)并弱化顶部高光。普通模式令牌不透明 → 不触发,液态玻璃观感零变化。
      useEffect(function () {
        if (!panelOpen) return
        var el = panelRef.current
        if (!el) return
        try {
          var cs = getComputedStyle(el)
          var token = cs.getPropertyValue('--dsw-alias-bg-overlay')
          var col = parseCssColor((token || '').trim() || cs.backgroundColor)
          if (col && col.a < 0.65) {
            el.style.background = 'rgba(' + col.r + ', ' + col.g + ', ' + col.b + ', 0.96)'
            el.setAttribute('data-solid', 'true')
          } else {
            el.style.background = ''
            el.removeAttribute('data-solid')
          }
        } catch (e) {}
      }, [panelOpen])
      if (!panelOpen && !panelClosing) return null
      var body
      if (tab === 'overview') body = h(OverviewTab, { nonce: nonce })
      else if (tab === 'logs') body = h(LogsTab)
      else if (tab === 'refine') body = h(RefineTab)
      else if (tab === 'hub') body = h(MemoryHubTab, { nonce: nonce })
      else if (tab === 'storage') body = h(StorageTab, { nonce: nonce })
      else if (tab === 'notes') body = h(NotesTab)
      else if (tab === 'reflections') body = h(ReflectionsTab)
      else if (tab === 'connect') body = h(ConnectTab)
      else if (tab === 'calendar') body = h(CalendarTab)
      else if (tab === 'workspaces') body = h(WorkspaceTab)
      else body = h(SearchTab)
      var tabs = [['overview', t('overview')], ['logs', t('logs')], ['refine', t('refineTab')], ['hub', t('hubTab')], ['storage', t('storageTab')], ['notes', t('notes')], ['reflections', t('reflections')], ['connect', t('connect')], ['calendar', t('calendar')], ['search', t('search')], ['workspaces', t('workspaces')]]
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
        ref: panelRef,
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
      var dlgTick = tickPair[1] // DialogHost 自身的重渲染通道(emit 只刷主面板,刷不到弹窗——开关点击即时反映全靠它)
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
        fetch('/api/dsh-auto-memory/semantic-status').then(function (r) { return r.json() }).then(function (j) {
          Object.assign(wizSt, j, { loaded: true })
          try { dlgTick() } catch (e9) {}
        }).catch(function () { Object.assign(wizSt, { loaded: true, ready: false }) })
      }
      var tourDlPhase = wizSt && wizSt.download && wizSt.download.phase
      var tourShowing = !!dialogState && (dialogState.kind === 'welcomeTour' || dialogState.kind === 'modelDownload')
      useEffect(function () {
        // 每次向导变为可见时回到第一步,并拉一份当前配置快照(开关步读写用)
        if (tourShowing) {
          setTourStep(0)
          wizSt.tourCfg = null
          wizSt.cfgLoaded = false
          fetch('/api/dsh-auto-memory/config').then(function (r) { return r.json() }).then(function (j) {
            wizSt.tourCfg = (j && (j.config || j)) || {}
            // mode 型开关(唤起注入模式)实际存储在 embedding-config.json(semantic-emit 接口维护),
            // 需从 semantic-status 合并进来,导览开关才能显示真实当前值并与设置页联动。
            try {
              fetch('/api/dsh-auto-memory/semantic-status').then(function (r2) { return r2.json() }).then(function (j2) {
                if (j2 && j2.activationEmitMode !== undefined) { wizSt.tourCfg.activationEmitMode = j2.activationEmitMode; try { dlgTick() } catch (e13) {} }
              }).catch(function () {})
            } catch (_) {}
            wizSt.cfgLoaded = true
            try { dlgTick() } catch (e11) {}
          }).catch(function () { wizSt.tourCfg = wizSt.tourCfg || {}; wizSt.cfgLoaded = true })
          fetch('/api/dsh-auto-memory/external').then(function (r) { return r.json() }).then(function (j) {
            wizSt.extScan = j
            try { dlgTick() } catch (e12) {}
          }).catch(function () {})
        }
      }, [tourShowing])
      useEffect(function () {
        if (!tourShowing) return undefined
        if (wizSt.ready) return undefined // 已就绪无需轮询
        var iv = setInterval(function () {
          fetch('/api/dsh-auto-memory/semantic-status').then(function (r) { return r.json() }).then(function (j) {
            Object.assign(wizSt, j); try { dlgTick() } catch (e10) {}
          }).catch(function () {})
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
        apiPost('/api/dsh-auto-memory/semantic-download', { action: 'start', mirror: 'auto' }).catch(function () {})
      }, [tourShowing, tourStep, wizSt.ready])
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
      // 通用开场舞台必须在 first/notice/update 三个分支之前完成赋值；var 只提升声明、不提升赋值。
      var skipUpdateIntro = function () { setUpdateSkip(true) }
      var introEligible = dialogState.kind === 'update' ||
        dialogState.kind === 'first' ||
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
            h('div', { 'data-dam-update-hint': '' }, locale === 'zh' ? '点击任意处跳过' : 'Click anywhere to skip')),
          !updateSkip ? h('div', { 'data-dam-update-click': '', onClick: skipUpdateIntro }) : null,
          h('div', { 'data-dam-update-content': '' }, children))
      }
      if (dialogState.kind === 'first') {
        var feats = [t('gFeat1'), t('gFeat2'), t('gFeat3'), t('gFeat4'), t('gFeat5'), t('gFeat6')]
        // M7.5:语义引擎资产检测(模块级缓存,避免重复请求;SLIDES 扩展点见下方渲染块)
        var semStatus = window['dsh-auto-memory.semStatus']
        if (!semStatus) {
          semStatus = { status: 'checking' }
          window['dsh-auto-memory.semStatus'] = semStatus
          fetch('/api/dsh-auto-memory/semantic-status').then(function (r) { return r.json() }).then(function (j) {
            semStatus.status = j.ready ? 'ready' : 'missing'
            try { dlgTick() } catch (e9) {}
          }).catch(function () { semStatus.status = 'unknown' })
        }
        var firstButton = h('button', { 'data-dam-btn': '', style: close, onClick: function () {
          try {
            localStorage.setItem('dsh-auto-memory.firstRunDone', '1')
            if (dialogState && dialogState.currentVersion) localStorage.setItem('dsh-auto-memory.seenVersion', dialogState.currentVersion)
            // 规范 F2(RELEASE-SEMANTIC-OPTION.md):首启关闭后进入「欢迎向导」
            // (分步介绍+内联检测/下载;受设置 welcomeTourEnabled 门控,默认开)。
            fetch('/api/dsh-auto-memory/config').then(function (r) { return r.json() }).then(function (cj) {
              var cc = (cj && cj.config) || cj || {}
              if (cc.welcomeTourEnabled !== false && !localStorage.getItem('dsh-auto-memory.semWizardDone')) {
                openDialog({ kind: 'welcomeTour' })
              } else {
                try { localStorage.setItem('dsh-auto-memory.semWizardDone', '1') } catch (e5) {}
              }
            }).catch(function () {
              if (!localStorage.getItem('dsh-auto-memory.semWizardDone')) openDialog({ kind: 'welcomeTour' })
            })
          } catch (e3) {}
          closeDialog()
        } }, t('gotIt'))
        var firstChildren = [
          h('div', { style: head }, t('guideTitle')),
          h('div', { style: sub }, t('guideSub')),
          feats.map(function (f) { return h('div', { style: item }, h('span', { style: dot }), f) }),
          // M7.5 首启扩展点(SLIDES):新功能引导在此按序追加;当前块=内置语义引擎自动检测。
          (function () {
            var boxS = { margin: '8px 0 4px', padding: '8px 10px', borderRadius: '10px', border: '1px solid color-mix(in srgb, var(--dsw-alias-border-l1, rgba(128,128,128,.35)) 50%, transparent)', fontSize: 'calc(11px * var(--dam-scale))', lineHeight: 1.55 }
            var st = semStatus
            if (!st || st.status === 'checking') return h('div', { style: boxS }, locale === 'zh' ? '正在检测内置语义引擎…' : 'Detecting built-in semantic engine…')
            if (st.status === 'ready') return h('div', { style: boxS }, '✓ ' + (locale === 'zh' ? '内置语义引擎已就绪(本地运行,记忆不出电脑)。可在「记忆」面板设置中切换检索模式。' : 'Built-in semantic engine ready (local-only). Switchable in Memory panel settings.'))
            return h('div', { style: boxS }, locale === 'zh' ? '可选：内置语义引擎未下载(约130MB)。在「记忆」面板设置中可随时启用;未启用时词法检索照常可用。' : 'Optional: built-in semantic engine not downloaded (~130MB). Enable anytime in Memory panel settings; lexical search keeps working.')
          })(),
          h('div', { style: { fontSize: 'calc(12px * var(--dam-scale))', opacity: .8, marginTop: '4px' } }, t('guideTip')),
          firstButton,
        ]
        return h('div', { style: overlay },
          h('div', { style: box },
            DamIntroBox(firstChildren)))
      }
      if (dialogState.kind === 'welcomeTour' || dialogState.kind === 'modelDownload') {
        // 首启引导向导 v2(2026-08-31):分步功能全覆盖 + 步内功能开关(点击即时写配置)
        // + 完成步提醒「随时可在设置的哪个分区重新打开」。跳过/✕ 也先落到完成步(提醒)。
        var TOUR_STEPS = [
          { art: 'bubble', core: '', kicker: 'WELCOME',
            title: locale === 'zh' ? '欢迎使用 dsh-auto-memory' : 'Welcome to dsh-auto-memory',
            text: locale === 'zh' ? '这是 DeepSeek Harness 的个人联想记忆插件。接下来把所有功能向你解释清楚——每个功能都有开关，当场决定开不开；最后会告诉你在哪里随时改。'
              : 'A personal associative-memory plugin for DeepSeek Harness. This tour explains every feature — each has a switch you flip right here; the last page tells you where to change them later.' },
          { art: 'store', core: '', kicker: locale === 'zh' ? '核心能力' : 'CORE',
            title: locale === 'zh' ? '记忆是怎么被想起的' : 'How memories are recalled',
            text: locale === 'zh' ? '先说清楚两条互不依赖的路：①自动联想（下面的开关）——插件持续观察对话与工具事件，锚定记忆；需要回忆时经固定边界注入下一轮，不破坏前缀缓存。②就算关掉它，AI 仍会在每轮结尾默认写项目 memory（memory_log），也能用 memory_recall 主动读取；日历、问候等面板功能也独立运行。'
              : 'Two independent paths: (1) automatic association (switch below) — the plugin anchors memories from conversations and injects relevant ones into the next turn via a fixed boundary. (2) Even with it off, the AI still writes project memory each turn (memory_log) and can read via memory_recall; calendar, greeting and other panel features run independently.' },
          { art: 'inject', core: '', kicker: locale === 'zh' ? '记忆快照' : 'SNAPSHOT',
            title: locale === 'zh' ? '周期性记忆注入' : 'Periodic memory snapshot',
            text: locale === 'zh' ? '另一个独立机制：首次启用时会向上下文注入一段记忆提示（项目长期笔记的摘要），之后每隔一定轮次、或上下文被压缩后自动重新注入，保证模型始终带着记忆背景工作。'
              : 'A separate mechanism: on first enable a memory prompt (long-term notes digest) is injected into context; afterwards it re-injects every N rounds or whenever the context is compacted, so the model always works with memory background.',
            toggles: [
              { key: 'associativeMemoryEnabled', name: locale === 'zh' ? '自动联想注入' : 'Automatic association', sub: locale === 'zh' ? '上面①的开关——按相关性自动注入记忆（推荐开）' : 'Path (1) — inject memories by relevance (recommended)', rec: true, where: locale === 'zh' ? '自动记忆引擎' : 'Semantic engine' },
              { key: 'injectEnabled', name: locale === 'zh' ? '周期记忆快照' : 'Periodic snapshot', sub: locale === 'zh' ? '上面②的开关——定期/压缩后重注入记忆提示（推荐开）' : 'Path (2) — re-inject memory digest periodically / on compaction (recommended)', rec: true, where: locale === 'zh' ? '记忆窗口' : 'Memory window' },
            ] },
          { art: 'bell', core: '', kicker: locale === 'zh' ? '日常体验' : 'EXPERIENCE',
            title: locale === 'zh' ? '暂离问候与无人值守' : 'Greeting & unattended',
            text: locale === 'zh' ? '离开超过一小时回来，自动打开记忆面板并送上问候。跑批处理/无人值守任务？开启托管后：不弹问候、不注入寒暄与行为指令、日历提醒静默——模型专注干活，上下文稳定。夜间（22:00-08:00）可自动进入托管。'
              : 'After >1h away the memory panel auto-opens with a greeting. Running batch/unattended jobs? Turn on unattended mode: no greetings, no niceties or behavioural directives, calendar silent — the model stays focused and context stays stable. Auto-engage overnight (22:00-08:00) if you like.',
            toggles: [
              { key: 'autoPopupEnabled', name: locale === 'zh' ? '暂离问候' : 'Welcome-back greeting', sub: locale === 'zh' ? '暂离超 1 小时回归时自动弹出面板并问候（推荐开）' : 'Auto-open the panel with a greeting after >1h away (recommended)', rec: true, where: locale === 'zh' ? '自动化' : 'Automation' },
              { key: 'unattendedAuto', name: locale === 'zh' ? '夜间/批量自动托管' : 'Auto-unattended', sub: locale === 'zh' ? '22:00-08:00 或检测到托管任务时自动进入：零寒暄、上下文冻结、仅保留记忆存取' : 'Auto-engage 22:00-08:00 or when a hosted task is detected: zero niceties, frozen context, memory only', def: false, where: locale === 'zh' ? '自动化' : 'Automation' },
            ] },
          { art: 'calendar', core: '', kicker: locale === 'zh' ? '每日助理' : 'DAILY ASSISTANT',
            title: locale === 'zh' ? '反思与总结' : 'Reflections & summaries',
            text: locale === 'zh' ? '让记忆按天组织、按时汇报：'
              : 'Keep memories organized by day:',
            toggles: [
              { key: 'reflectEnabled', name: locale === 'zh' ? '每日反思' : 'Daily reflection', sub: locale === 'zh' ? '每天第一次会话时，主动呈现前一天的工作反思' : 'Present the reflection of the previous day at the first session of each day', where: locale === 'zh' ? '自动化' : 'Automation' },
              { key: 'autoSummaryTimes', name: locale === 'zh' ? '定时总结' : 'Scheduled summaries', sub: locale === 'zh' ? '到点（12:00 / 18:00 / 22:00）自动总结本时段工作并弹窗' : 'Summarize the current period at 12:00 / 18:00 / 22:00', boolOn: ['12:00', '18:00', '22:00'], boolOff: [], where: locale === 'zh' ? '自动化' : 'Automation' },
            ] },
          { art: 'link', core: '', kicker: locale === 'zh' ? '外部记忆' : 'EXTERNAL',
            title: locale === 'zh' ? '接入别的 AI（扫描结果）' : 'Other AIs (scanned)',
            text: locale === 'zh' ? '已扫描本机可读的外部来源——勾选你想让插件读取的（只存路径指针，不复制内容）：'
              : 'Scanned sources found on this machine — tick the ones the plugin may read (path pointers only, no copying):',
            externalScan: true },
          { art: 'engine', core: '', kicker: locale === 'zh' ? '检索引擎' : 'RETRIEVAL', dl: true,
            title: locale === 'zh' ? '三级语义引擎' : 'Three-tier semantic engine',
            text: locale === 'zh' ? '词法检索（0GB）永远可用作保底；内置语义引擎（约 130MB 量化模型）显著提升召回；进阶 Python 引擎（BGE-M3，约 563MB）面向深度用户。以下为自动检测结果，可在此直接安装。另有一个与隐私相关的检索信号开关：'
              : 'Lexical search (0GB) is the always-on floor; the built-in engine (~130MB quantized model) boosts recall; the advanced Python engine (BGE-M3, ~563MB) is optional. Live detection below — install right here. One privacy-related retrieval switch:',
            toggles: [
              { key: 'reasoningObserverEnabled', name: locale === 'zh' ? '思维链监听' : 'Reasoning observer', sub: locale === 'zh' ? '监听模型思维链分段作为检索信号（默认关；内容比可见输出更敏感，按需开）' : 'Watch model CoT segments as a retrieval signal (default off; more sensitive than visible output)', def: false, where: locale === 'zh' ? '自动记忆引擎' : 'Semantic engine' },
            ] },
          { art: 'radar', core: '', kicker: locale === 'zh' ? '唤起与固化' : 'ACTIVATION',
            title: locale === 'zh' ? '该出手时才出手' : 'Interrupt only when it matters',
            text: locale === 'zh' ? '记忆唤起=在对话链（CoT/上下文）中直接检测回忆需求，命中即插入下一个环节；记忆固化=每轮结束把结论沉淀进记忆店，供下次唤起。每次决策都能在「唤起回顾」页复核打分。'
              : 'Recall = detect memory needs directly in the conversation chain (CoT/context) and insert at the next boundary. Consolidation = settle conclusions into the stores each turn for later recall. Grade every decision in the Recall review tab.',
            toggles: [
              { key: 'activationEmitMode', name: locale === 'zh' ? '记忆唤起（链中检测→插入）' : 'Memory recall (detect → inject)', sub: locale === 'zh' ? '开=canary 档（显式回忆注入，推荐）/ 关=shadow 档（只记录不注入）' : 'On = canary (inject on explicit recall, recommended) / Off = shadow (record only)', mode: true, rec: true, where: locale === 'zh' ? '自动记忆引擎' : 'Semantic engine' },
              { key: 'autoConsolidate', name: locale === 'zh' ? '记忆固化（自动沉淀）' : 'Memory consolidation', sub: locale === 'zh' ? '每轮对话结束自动把结论沉淀进每日日志与记忆店（推荐开）' : 'Consolidate conclusions into the log & stores each turn (recommended)', rec: true, where: locale === 'zh' ? '自动化' : 'Automation' },
              { key: 'procedurePromotionEnabled', name: locale === 'zh' ? '技能固化与晋升' : 'Skill crystallization', sub: locale === 'zh' ? '重复流程固化为 checklist 自动附上；跨会话验证后晋升（「记忆中枢」页审批）' : 'Turn repeated flows into auto-attached checklists; promote after validation (Memory Hub tab)', where: locale === 'zh' ? '记忆中枢' : 'Memory Hub' },
            ] },
          { art: 'rocket', core: '', kicker: locale === 'zh' ? '完成' : 'READY', final: true,
            title: locale === 'zh' ? '一切就绪' : 'All set',
            text: locale === 'zh' ? '你刚才的选择都已即时保存。改主意了？随时在这几个地方重新打开：'
              : 'Every choice above was saved instantly. Changed your mind? Revisit them here anytime:' },
        ]
        // 语义引擎状态(wizSt 已在 DialogHost 顶部初始化;下载轮询 useEffect 同样在顶部)
        var dl = wizSt.download || { phase: 'idle' }
        var dlActive = dl.phase === 'downloading' || dl.phase === 'verifying'
        var wizReady = wizSt.ready
        var totalBytes = wizSt.manifestBytes || Math.round(130 * 1024 * 1024)
        var prog = dlActive || dl.phase === 'done'
          ? Math.min(100, Math.round(((dl.bytesDone || 0) / Math.max(1, dl.bytesTotal || totalBytes)) * 100))
          : (wizReady ? 100 : 0)
        var fmtMB = function (b) { return b ? (b / (1024 * 1024)).toFixed(1) + ' MB' : '—' }
        var dlPhaseTxt = !wizSt.loaded ? (locale === 'zh' ? '检测中…' : 'Detecting…')
          : wizReady ? (locale === 'zh' ? '✓ 就绪（SHA256 校验 + 推理自检已通过）' : '✓ Ready (SHA256 verify + inference self-test passed)')
          : dl.phase === 'verifying' ? t('dlVerifying')
          : dl.phase === 'downloading' ? (t('dlDownloading') + ' · ' + fmtMB(dl.bytesDone || 0) + ' / ' + fmtMB(dl.bytesTotal || totalBytes))
          : dl.phase === 'error' ? (t('dlError') + ': ' + String(dl.error || '').slice(0, 90))
          : dl.phase === 'done' ? (wizSt.assetPresent && !wizSt.peerPresent
              ? (locale === 'zh' ? '模型已下载,推理库缺失——先 pnpm approve-builds(批准原生脚本),再 pnpm add @huggingface/transformers,重启生效' : 'Model downloaded, inference lib missing — run pnpm approve-builds, then pnpm add @huggingface/transformers, restart')
              : t('dlDone'))
          : (locale === 'zh' ? '未下载 · 词法检索照常可用' : 'Not downloaded · lexical search keeps working')
        var startDl = function () {
          apiPost('/api/dsh-auto-memory/semantic-download', { action: 'start', mirror: 'auto' }).catch(function () {})
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
          var c = wizSt.tourCfg = wizSt.tourCfg || {}
          var on = tourToggleOn(tg)
          var patch = {}
          if (tg.key === 'autoSummaryTimes') patch[tg.key] = on ? (tg.boolOff || []) : (tg.boolOn || [])
          else if (tg.groupAll) { var o = {}; for (var i = 0; i < EXT_SOURCE_KEYS.length; i++) o[EXT_SOURCE_KEYS[i]] = !on; patch[tg.key] = o }
          else if (tg.mode) patch[tg.key] = on ? 'shadow' : 'canary-explicit'
          else patch[tg.key] = !on
          Object.assign(c, patch)
          dlgTick()
          // mode 型开关(唤起注入模式)走 semantic-emit 接口——与设置页同源(embedding-config.json),
          // 保证导览切换与设置页双向联动;其余开关写常规 config。
          if (tg.mode) {
            apiPost('/api/dsh-auto-memory/semantic-emit', { mode: patch[tg.key] }).catch(function () {})
          } else {
            apiPost('/api/dsh-auto-memory/config', patch).catch(function () {})
          }
        }
        // 外部来源单源勾选(扫描行;勾选即写 externalSources 对象)
        var tourExtToggle = function (id) {
          if (!wizSt.cfgLoaded) return // 配置未加载完,禁止写入
          var c = wizSt.tourCfg = wizSt.tourCfg || {}
          var cur = Object.assign({}, c.externalSources || {})
          cur[id] = (cur[id] !== false) ? false : true
          c.externalSources = cur
          dlgTick()
          apiPost('/api/dsh-auto-memory/config', { externalSources: cur }).catch(function () {})
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
          // v0.1.30 大更新链:向导结束 → 直接接 0.1.30 大更新卡(老用户历史版本不逐个弹,
          // 大更新内容才是要传达的)。apiGet 异步拉当前版本,失败静默(向导本身已完成使命)。
          try {
            apiGet(API.updateCheck).then(function (d) {
              var cur = (d && d.current) || '0.1.30'
              // 只弹大更新(0.1.30);若当前版本更新(补丁)也并入 0.1.30 卡(补丁内容已在 0.1.30 items 尾部)
              var latestKey = '0.1.30'
              openDialog({ kind: 'update', versions: [{ version: latestKey, items: CHANGELOG[latestKey] || CHANGELOG['0.1.30'] }], currentVersion: cur })
              try { localStorage.setItem('dsh-auto-memory.seenVersion', cur) } catch (e5) {}
            }).catch(function () {
              openDialog({ kind: 'update', versions: [{ version: '0.1.30', items: CHANGELOG['0.1.30'] }], currentVersion: '0.1.30' })
            })
          } catch (eChain) {}
        }
        var closeOrRemind = function () {
          // 关闭时机提醒:未到完成步就关 → 先落到完成步(重开位置指引),再点才开始使用
          if (tourStep < TOUR_STEPS.length - 1) setTourStep(TOUR_STEPS.length - 1)
          else finishTour()
        }
        var step = TOUR_STEPS[Math.min(tourStep, TOUR_STEPS.length - 1)]
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
          h('div', { 'data-dam-tour': '' },
            h('div', { 'data-dam-tour-glare': '' }),
            h('button', { 'data-dam-tour-close': '', title: t('close'), onClick: closeOrRemind }, '✕'),
            h('div', { 'data-dam-tour-orb-wrap': '', key: 'orb' + tourStep, 'data-step': String(tourStep), 'data-art': step.art || 'bubble' },
              h('div', { 'data-dam-tour-bokeh': 'a' }),
              h('div', { 'data-dam-tour-bokeh': 'b' }),
              h('div', { 'data-dam-tour-bokeh': 'c' }),
              step.art === 'store' ? h('div', { 'data-dam-tour-stage': '', key: 'stage' + tourStep },
                h('div', { 'data-dam-tour-slab': 'bot' }),
                h('div', { 'data-dam-tour-slab': 'mid' }),
                h('div', { 'data-dam-tour-slab': 'top' })) : h('div', { 'data-dam-tour-app-tile': '', key: 'tile' + tourStep }),
              step.art === 'store' ? null : renderTourArt(step.art || 'bubble')),
            h('div', { 'data-dam-tour-body': '', key: 'body' + tourStep, 'data-dam-tour-swap': '' },
              h('div', { 'data-dam-tour-kicker': '' }, step.kicker),
              h('div', { 'data-dam-tour-title': '' }, step.title),
              h('div', { 'data-dam-tour-text': '' }, step.text),
              step.toggles ? h('div', { 'data-dam-tour-toggles': '' },
                step.toggles.map(function (tg, ti) {
                  var on = tourToggleOn(tg)
                  return h('button', { key: ti, 'data-dam-tour-tg': '', 'data-on': String(on), onClick: function () { tourToggleClick(tg) } },
                    h('div', { 'data-dam-tour-tg-txt': '' },
                      h('div', { 'data-dam-tour-tg-name': '' }, tg.name, tg.rec ? h('span', { 'data-dam-tour-rec': '' }, locale === 'zh' ? '推荐' : 'REC') : null),
                      h('div', { 'data-dam-tour-tg-sub': '' }, tg.sub)),
                    h('div', { 'data-dam-tour-sw': '', 'data-on': String(on) }))
                })) : null,
              step.externalScan ? h('div', { 'data-dam-tour-toggles': '', 'data-scroll': 'true' },
                !(wizSt.extScan && wizSt.extScan.sources) ? h('div', { style: { opacity: .55, fontSize: '12px', padding: '8px 4px' } }, locale === 'zh' ? '正在扫描本机来源…' : 'Scanning local sources…')
                  : (wizSt.extScan.sources || []).map(function (src) {
                    var on = tourExtOn(src.id)
                    return h('button', { key: src.id, 'data-dam-tour-tg': '', 'data-on': String(on), onClick: function () { tourExtToggle(src.id) } },
                      h('div', { 'data-dam-tour-tg-txt': '' },
                        h('div', { 'data-dam-tour-tg-name': '' }, src.name, h('span', { style: { opacity: .5, fontWeight: 400, fontSize: '10.5px', marginLeft: '6px' } }, src.tool + ' · ' + src.kind)),
                        h('div', { 'data-dam-tour-tg-sub': '' }, (locale === 'zh' ? '已检测到 · ' : 'found · ') + (src.size > 1048576 ? (src.size / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(src.size / 1024)) + ' KB'))),
                      h('div', { 'data-dam-tour-sw': '', 'data-on': String(on) }))
                  })) : null,
              step.dl ? h('div', { 'data-dam-tour-dl': '' },
                h('div', { 'data-dam-tour-dl-row': '' },
                  h('span', null, dlPhaseTxt),
                  h('span', null, wizReady ? 'C2 · 129MB' : (prog + '%'))),
                wizReady ? null : h('div', { 'data-dam-tour-bar': '' },
                  h('div', { 'data-dam-tour-bar-i': '', style: { width: prog + '%', background: dl.phase === 'error' ? 'linear-gradient(90deg,#c44a4a,#e08a8a)' : undefined } })),
                !wizReady && wizSt.loaded && !dlActive ? h('div', { 'data-dam-tour-dl-row': '', style: { marginTop: '4px' } },
                  h('span', null, (locale === 'zh' ? '下载源: ' : 'Source: ') + (dl.mirrorUsed === 'cn' ? t('mCn') : dl.mirrorUsed === 'intl' ? t('mIntl') : t('mAuto')) + (locale === 'zh' ? ' · 失败自动切备用源' : ' · auto-failover'))) : null,
                h('div', { 'data-dam-tour-dl-tier': '' },
                  h('div', { 'data-dam-tour-dl-tier-row': '' },
                    h('b', null, locale === 'zh' ? '内置 JS 档（自动）' : 'Built-in JS tier (auto)'),
                    h('span', null, locale === 'zh' ? 'e5-small · ~129MB · 默认,正在为你安装' : 'e5-small · ~129MB · default, installing for you')),
                  h('div', { 'data-dam-tour-dl-tier-row': '' },
                    h('b', null, locale === 'zh' ? 'Python 进阶档（可选）' : 'Python tier (optional)'),
                    h('span', null, locale === 'zh' ? 'BGE-M3 int8 · 563MB · 追求更高精度的发烧友可在设置页安装' : 'BGE-M3 int8 · 563MB · for enthusiasts chasing higher precision — installable in Settings')))) : null,
              step.final ? h('div', null,
                h('div', { 'data-dam-tour-chips': '' },
                  allToggles.filter(function (tg) { return tourToggleOn(tg) }).map(function (tg) {
                    return h('span', { key: tg.key, 'data-dam-tour-badge': '', style: { background: 'rgba(47,164,106,.20)', color: '#7fdcb0' } }, '✓ ' + tg.name)
                  }),
                  allToggles.filter(function (tg) { return !tourToggleOn(tg) }).map(function (tg) {
                    return h('span', { key: 'off' + tg.key, 'data-dam-tour-badge': '', style: { background: 'rgba(128,128,128,.16)', opacity: .7 } }, tg.name + (locale === 'zh' ? ' 关' : ' off'))
                  })),
                h('div', { 'data-dam-tour-where': '' },
                  Object.keys(whereGroups).map(function (k) {
                    return h('div', { key: k }, '· ', h('b', null, k), ' —— ' + whereGroups[k].join(locale === 'zh' ? ' / ' : ' / '))
                  }),
                  h('div', null, '· ', h('b', null, locale === 'zh' ? '面板页签' : 'Panel tabs'), locale === 'zh' ? ' —— 唤起回顾（决策打分）/ 存储管理（扫描修复）' : ' — Recall review / Storage tools'))) : null),
            h('div', { 'data-dam-tour-dots': '' },
              TOUR_STEPS.map(function (s, si) {
                return h('button', { key: si, 'data-dam-tour-dot': '', 'data-on': String(si === tourStep),
                  onClick: function () { setTourStep(si) }, title: s.kicker })
              })),
            h('div', { 'data-dam-tour-foot': '' },
              h('button', { 'data-dam-tour-skip': '', onClick: closeOrRemind }, locale === 'zh' ? '跳过向导' : 'Skip tour'),
              h('button', { 'data-dam-tour-btn': '', 'data-primary': 'false', disabled: tourStep === 0,
                onClick: function () { setTourStep(Math.max(0, tourStep - 1)) } },
                locale === 'zh' ? '‹ 上一步' : '‹ Back'),
              h('button', { 'data-dam-tour-btn': '', 'data-primary': 'true',
                onClick: function () { isLast ? finishTour() : setTourStep(tourStep + 1) } },
                isLast ? (locale === 'zh' ? '开始使用' : 'Get started')
                  : (locale === 'zh' ? '下一步 ›' : 'Next ›')))))
      }
      if (dialogState.kind === 'notice') {
        var n = dialogState.notice || {}
        var zh = locale === 'zh' || !n.titleEn
        var nTitle = zh ? (n.title || '') : (n.titleEn || n.title || '')
        var nMsg = zh ? (n.message || '') : (n.messageEn || n.message || '')
        var isUrgent = n.level === 'urgent'
        var accent = isUrgent ? 'var(--dsw-alias-danger, #e5534b)' : 'var(--dsw-alias-brand-primary, #4f7cff)'
        var noticeButton = h('button', { 'data-dam-btn': '', style: close, onClick: function () {
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
          // 右上 ✕ 关闭(与小卡 46vh 裁剪下的底部按钮互为兜底——否则内容溢出时按钮不可达,弹窗关不掉)
          h('button', { 'data-dam-btn': '', title: t('close'), onClick: function () {
            try { if (lastV) localStorage.setItem('dsh-auto-memory.seenVersion', lastV) } catch (eX) {}
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
            h('button', { 'data-dam-btn': '', style: close, onClick: function () {
              try { if (lastV) localStorage.setItem('dsh-auto-memory.seenVersion', lastV) } catch (e3) {}
              closeDialog()
            } }, t('gotIt'))])))
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
      // 「总结/问候默认模型」抽屉(复审轮2新增功能的选型 UI):自动检测 llm 目录,分组展示,点选即设
      function buildModelDrawer() {
        var panelStyle = { border: '1px solid color-mix(in srgb, var(--dsw-alias-border-l1, rgba(128,128,128,.25)) 60%, transparent)', borderRadius: '8px', padding: '8px', marginBottom: '8px', maxHeight: '260px', overflow: 'auto', background: 'color-mix(in srgb, var(--dsw-alias-bg-layer-1, rgba(128,128,128,.06)) 40%, transparent)' }
        var kids = []
        kids.push(h('div', { 'data-dam-row': '', style: { marginBottom: '4px' } },
          h('b', { style: { flex: 1, fontSize: 'calc(12px * var(--dam-scale))' } }, locale === 'zh' ? '选择模型（自动检测）' : 'Pick a model (auto-detected)'),
          h('button', { 'data-dam-btn': '', onClick: function () { setMdlOpen(false) } }, t('close'))))
        if (mdlLoading) kids.push(h('div', { 'data-dam-hint': '' }, locale === 'zh' ? '正在检测可用模型…' : 'Detecting models…'))
        if (mdlErr) kids.push(h('div', { 'data-dam-error': '' }, mdlErr))
        if (!mdlLoading && !mdlErr && mdlData) {
          kids.push(h('button', { key: '__default__', 'data-dam-btn': '', style: { display: 'block', width: '100%', textAlign: 'left', padding: '4px 6px', opacity: cfg.subagentModel ? 1 : 0.75 }, onClick: function () { set('subagentModel', ''); setMdlOpen(false) } },
            locale === 'zh' ? '跟随路由默认（留空）' : 'Follow routing default (empty)'))
          ;(mdlData.providers || []).forEach(function (p) {
            var modelBtns = (p.models || []).length
              ? p.models.map(function (m) {
                  return h('button', { key: p.id + '/' + m.id, 'data-dam-btn': '', style: { display: 'block', width: '100%', textAlign: 'left', padding: '3px 6px', fontWeight: cfg.subagentModel === m.id ? 700 : 400 }, onClick: function () { set('subagentModel', m.id); setMdlOpen(false) } },
                    m.id + (m.name && m.name !== m.id ? ' · ' + m.name : '') + (cfg.subagentModel === m.id ? ' ✓' : ''))
                })
              : [h('div', { key: 'none', 'data-dam-hint': '' }, locale === 'zh' ? '（该 provider 未列出模型）' : '(no models advertised)')]
            kids.push(h('div', { key: 'g-' + p.id, style: { marginTop: '6px' } },
              h('div', { style: { fontSize: 'calc(11px * var(--dam-scale))', fontWeight: 700, opacity: 0.75, margin: '2px 0' } }, p.name || p.id),
              modelBtns))
          })
          ;(mdlData.failures || []).forEach(function (f) {
            kids.push(h('div', { key: 'f-' + f.id, 'data-dam-hint': '', style: { opacity: 0.65 } }, '⚠ ' + (f.name || f.id) + ': ' + f.message))
          })
          if (!(mdlData.providers || []).length && !(mdlData.failures || []).length) {
            kids.push(h('div', { 'data-dam-hint': '' }, locale === 'zh' ? '未检测到 provider;可直接在下方手动输入。' : 'No providers detected; use manual input below.'))
          }
          kids.push(h('input', { key: '__manual__', 'data-dam-input': '', style: { marginTop: '6px', width: '100%' }, value: cfg.subagentModel || '', placeholder: locale === 'zh' ? '手动输入(可选)' : 'manual entry (optional)', onChange: function (e) { set('subagentModel', String(e.target.value || '').trim()) } }))
        }
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
        apiGet(API.config).then(function (d) { if (alive) setCfg(d.config) }).catch(function (e) { setErr(e.message) })
        // 打开设置页自动检查更新(host 有 12h 缓存,不重复查网)
        apiGet(API.updateCheck).then(function (d) { if (alive) setVerInfo(d) }).catch(function () {})
        return function () { alive = false }
      }, [])
      // M7.5 语义引擎资产状态与安装引导(Hooks 必须位于任何条件 return 之前——React 规则,
      // 否则 cfg 未加载时提前 return 会跳过这些 useState,二次渲染 hooks 数量不一致 → error #310)
      var semPair = useState({ loaded: false, ready: false, assetPresent: false, peerPresent: false, pythonInt8Present: false })
      var sem = semPair[0]
      var setSem = semPair[1]
      var guidePair = useState('')
      var promptEditPair = useState(false)
      var promptEditOpen = promptEditPair[0]
      var setPromptEditOpen = promptEditPair[1]
      var guide = guidePair[0]
      var setGuide = guidePair[1]
      var mirrorPair = useState('auto')
      var mirror = mirrorPair[0]
      var setMirror = mirrorPair[1]
      useEffect(function () {
        fetch('/api/dsh-auto-memory/semantic-status').then(function (r) { return r.json() }).then(function (j) {
          setSem(Object.assign({ loaded: true }, j))
        }).catch(function () { setSem({ loaded: true, ready: false }) })
        return function () {}
      }, [])
      // 下载进行中每 1.5s 轮询真实进度(服务端流式记账 bytesDone/bytesTotal/mirrorUsed)
      useEffect(function () {
        var ph = sem && sem.download && sem.download.phase
        if (ph !== 'downloading' && ph !== 'verifying') return function () {}
        var iv = setInterval(function () {
          fetch('/api/dsh-auto-memory/semantic-status').then(function (r) { return r.json() }).then(function (j) {
            setSem(Object.assign({ loaded: true }, j))
          }).catch(function () {})
        }, 1500)
        return function () { clearInterval(iv) }
      }, [sem && sem.download && sem.download.phase])
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
        apiPost(API.config, cfg).then(function (d) { setCfg(d.config); setDirty(false); setMsg(t('saved') + (d.migrated ? ' ' + d.migrated : '')); setBusy(false); if (d && d.config && d.config.locale) applyLocalePref(d.config.locale); try { fetch('/api/dsh-auto-memory/semantic-status').then(function (r2) { return r2.json() }).then(function (j2) { setSem(Object.assign({ loaded: true }, j2)) }).catch(function () {}) } catch (_) {} })
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
      function onEngineModeChange(e) {
        var v = e.target.value
        // 2026-08-27 修复:切换永远执行,资产检测不 gate/不弹卡(资产缺失自动降级词法)。
        // 之前 sem 异步未加载时拦截导致「怎么切都没变化」。引导卡仅由用户主动点出。
        setGuide('')
        // 2026-08-27 模式联动(修基础 bug):一次 set 提交全部改动——连续多次 set 基于同一闭包
        // 会互相覆盖(React 异步,后者 Object.assign 旧 cfg 丢前者),导致 semanticEngineMode 不保存。
        // js=JS 判定闭环;python=Python sidecar;auto/lexical=默认(JS 判定+词法保底)。
        var next = Object.assign({}, cfg)
        next.semanticEngineMode = v
        if (v === 'js') { next.activationSource = 'js'; next.contextSinkMode = 'null' }
        else if (v === 'python') { next.activationSource = 'python'; next.contextSinkMode = 'python' }
        else { next.activationSource = 'js'; next.contextSinkMode = 'null' }
        try { console.log('[dam] engine mode change →', v, JSON.stringify({ semanticEngineMode: next.semanticEngineMode, activationSource: next.activationSource, contextSinkMode: next.contextSinkMode })) } catch (_) {}
        setCfg(next); setDirty(true)
        // 2026-08-27 修复显示不跟随:切换后重新 fetch semantic-status,刷新「当前生效检索」
        // (sem.resolvedTier 原只在挂载/下载时更新,切换后不刷新导致一直显示旧档位)。
        try {
          fetch('/api/dsh-auto-memory/semantic-status').then(function (r2) { return r2.json() }).then(function (j2) { setSem(Object.assign({ loaded: true }, j2)) }).catch(function () {})
        } catch (_) {}
      }
      var sectionLabels = {
        semantic: locale === 'zh' ? '自动记忆引擎' : 'Semantic engine',
        memoryHub: locale === 'zh' ? '记忆中枢' : 'Memory Hub',
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
        section('semantic', sectionLabels.secSemantic, [
          field(t('fAssocEngine'), h('input', { type: 'checkbox', checked: !!cfg.associativeMemoryEnabled, onChange: function (e) { set('associativeMemoryEnabled', e.target.checked) } }), t('fAssocEngineHint')),
          field(t('fJsCooldown'), h('input', { 'data-dam-input': '', type: 'number', min: 0, max: 60, value: cfg.jsDecideCooldownRounds === undefined ? 1 : cfg.jsDecideCooldownRounds, onChange: function (e) { set('jsDecideCooldownRounds', Number(e.target.value) || 1) } }), t('fJsCooldownHint')),
          field(t('fJsDelta'), h('input', { 'data-dam-input': '', type: 'number', min: 0, max: 1, step: 0.005, value: cfg.jsDecideDeltaExp === undefined ? 0.01 : cfg.jsDecideDeltaExp, onChange: function (e) { var v = Number(e.target.value); set('jsDecideDeltaExp', Number.isFinite(v) && v >= 0 ? v : 0.01) } }), t('fJsDeltaHint')),
          field(t('fJsExcerpt'), h('input', { 'data-dam-input': '', type: 'number', min: 20, max: 480, value: cfg.jsDecideExcerptChars === undefined ? 40 : cfg.jsDecideExcerptChars, onChange: function (e) { set('jsDecideExcerptChars', Math.max(20, Math.min(480, Number(e.target.value) || 40))) } }), t('fJsExcerptHint')),
          field(t('fEmitMode'), h('select', { 'data-dam-select': '', value: (sem && sem.activationEmitMode) || 'shadow', onChange: function (e) { var m = e.target.value; apiPost('/api/dsh-auto-memory/semantic-emit', { mode: m }).then(function () { try { fetch('/api/dsh-auto-memory/semantic-status').then(function (r2) { return r2.json() }).then(function (j2) { setSem(Object.assign({ loaded: true }, j2)) }).catch(function () {}) } catch (_) {} }).catch(function () {}) } },
            h('option', { value: 'shadow' }, locale === 'zh' ? 'shadow 只记录' : 'shadow (record only)'),
            h('option', { value: 'canary-explicit' }, locale === 'zh' ? 'canary 显式回忆注入' : 'canary (explicit recall)'),
            h('option', { value: 'active' }, locale === 'zh' ? 'active 全部注入' : 'active (all)')), t('fEmitModeHint')),
          field(t('fCandScheme'), h('select', { 'data-dam-select': '', value: cfg.jsDecideCandidateScheme || 'balanced', onChange: function (e) { set('jsDecideCandidateScheme', e.target.value) } },
            h('option', { value: 'balanced' }, locale === 'zh' ? 'balanced 3×40' : 'balanced 3×40'),
            h('option', { value: 'dense' }, locale === 'zh' ? 'dense 6×20' : 'dense 6×20'),
            h('option', { value: 'custom' }, locale === 'zh' ? 'custom 自定义' : 'custom')), t('fCandSchemeHint')),
          (cfg.jsDecideCandidateScheme === 'custom') ? field(t('fCandN'), h('input', { 'data-dam-input': '', type: 'number', min: 1, max: 8, value: cfg.jsDecideCandidatesN === undefined ? 4 : cfg.jsDecideCandidatesN, onChange: function (e) { set('jsDecideCandidatesN', Math.max(1, Math.min(8, Number(e.target.value) || 4))) } }), t('fCandNHint')) : null,
          field(t('semMode'), h('select', { 'data-dam-select': '', value: cfg.semanticEngineMode || 'auto', onChange: onEngineModeChange },
            h('option', { value: 'auto' }, t('semAuto')),
            h('option', { value: 'lexical' }, t('semLexOnly')),
            h('option', { value: 'js' }, t('semJs')),
            h('option', { value: 'python' }, t('semPy'))), t('semModeHint')),
          sem.loaded ? h('div', { 'data-dam-hint': '', style: { marginTop: '-4px', marginBottom: '8px' } },
            t('semResolved') + ': ' + (sem.resolvedTier === 'c2' ? t('tierC2') + ' ✓' : sem.resolvedTier === 'c3' ? t('tierC3') + ' ✓' : t('tierC1')))
            : null,
          guide === 'js' || guide === 'python' ? (function () {
            // 安装引导卡(对齐 ui-assets 原型:进度条/下载源/体积/状态)——资产检测由 sem 状态机驱动
            var isJs = guide === 'js'
            var title = isJs ? (locale === 'zh' ? '内置语义引擎 · 安装引导' : 'Built-in semantic engine · setup') : (locale === 'zh' ? '高级 Python 引擎 · 安装引导' : 'Advanced Python engine · setup')
            var desc = isJs
              ? (locale === 'zh' ? '下载约130MB本地量化模型（multilingual-e5-small），校验后离线运行——记忆不出电脑。下载期间词法检索照常可用，完成后自动启用。' : 'Downloads a ~130MB local quantized model (multilingual-e5-small), verifies and runs fully offline — memories never leave this machine. Lexical search keeps working during setup; the engine switches on automatically when ready.')
              : (locale === 'zh' ? '高级引擎通过本地 Python sidecar 运行 BGE-M3 int8（约563MB），召回质量最高。需要引导式安装（Python 环境 + 模型），适合深度用户；不安装不影响内置引擎。' : 'The advanced engine runs BGE-M3 int8 (~563MB) via a local Python sidecar for maximum recall. Guided install required (Python runtime + model); optional for power users.')
            var ready = isJs ? sem.ready : sem.pythonInt8Present
            var bytes = isJs ? (sem.assetBytes || 0) : (sem.pythonInt8Bytes || 0)
            var dl = (isJs && sem.download) ? sem.download : { phase: 'idle' }
            var dlActive = dl.phase === 'downloading' || dl.phase === 'verifying'
            // 规范 G 七态之「建库中」:SHA256 过了但引擎还在后台编码全量语料(jsSemantic.embedding)
            var building = isJs && sem.jsSemantic && sem.jsSemantic.embedding === true
            var totalJs = sem.manifestBytes || Math.round(130 * 1024 * 1024)
            var stateTxt, stateBg
            if (!sem.loaded) { stateTxt = locale === 'zh' ? '检测中…' : 'Detecting…'; stateBg = 'rgba(128,128,128,.16)' }
            else if (ready && building) { stateTxt = locale === 'zh' ? '已就绪 · 建库中…' : 'Ready · building index…'; stateBg = 'rgba(36,86,196,.2)' }
            else if (ready) { stateTxt = locale === 'zh' ? '已就绪 ✓' : 'Ready ✓'; stateBg = 'rgba(47,164,106,.24)' }
            else if (dl.phase === 'error') { stateTxt = t('dlError'); stateBg = 'rgba(196,74,74,.22)' }
            else if (dl.phase === 'cancelled') { stateTxt = t('dlCancelled'); stateBg = 'rgba(196,138,42,.2)' }
            else if (isJs && dlActive) { stateTxt = dl.phase === 'verifying' ? t('dlVerifying') : t('dlDownloading'); stateBg = 'rgba(36,86,196,.2)' }
            else if (isJs && sem.assetPresent && !sem.peerPresent) { stateTxt = locale === 'zh' ? '模型已存在,缺推理库——pnpm approve-builds 后 pnpm add @huggingface/transformers' : 'Model present, runtime missing — pnpm approve-builds && pnpm add @huggingface/transformers'; stateBg = 'rgba(196,138,42,.2)' }
            else { stateTxt = locale === 'zh' ? '未下载' : 'Not downloaded'; stateBg = 'rgba(196,138,42,.2)' }
            var progress = dlActive || (isJs && dl.phase === 'done')
              ? Math.min(100, Math.round(((dl.bytesDone || 0) / Math.max(1, dl.bytesTotal || totalJs)) * 100))
              : (bytes && !ready ? Math.min(100, Math.round(bytes / ((isJs ? 130 : 563) * 1024 * 1024) * 100)) : (ready ? 100 : 0))
            var fmtMB = function (b) { return b ? (b / (1024 * 1024)).toFixed(1) + ' MB' : '—' }
            var mirrorName = function (m) { return m === 'cn' ? t('mCn') : m === 'intl' ? t('mIntl') : t('mAuto') }
            var phaseLine = dlActive
              ? ((dl.phase === 'verifying' ? t('dlVerifying') : t('dlDownloading')) + ' · ' + fmtMB(dl.bytesDone || 0) + ' / ' + fmtMB(dl.bytesTotal || totalJs) + ' · ' + mirrorName(dl.mirrorUsed))
              : (dl.phase === 'error' ? (t('dlError') + ': ' + String(dl.error || '').slice(0, 120))
                : (dl.phase === 'cancelled' ? t('dlCancelled')
                  : (isJs && dl.phase === 'done' && !ready ? t('dlDone') + (locale === 'zh' ? '（缺运行库时需安装 @huggingface/transformers）' : ' (install @huggingface/transformers if runtime missing)')
                    : (locale === 'zh' ? '下载进度' : 'Download progress'))))
            var refreshSem = function () {
              fetch('/api/dsh-auto-memory/semantic-status').then(function (r2) { return r2.json() }).then(function (j2) { setSem(Object.assign({ loaded: true }, j2)) }).catch(function () {})
            }
            var startDl = function () {
              apiPost('/api/dsh-auto-memory/semantic-download', { action: 'start', mirror: mirror }).then(refreshSem).catch(function () {})
            }
            var cancelDl = function () {
              apiPost('/api/dsh-auto-memory/semantic-download', { action: 'cancel', mirror: mirror }).then(refreshSem).catch(function () {})
            }
            return h('div', { style: { border: '1px solid color-mix(in srgb, var(--dam-accent, #2456c4) 40%, transparent)', borderRadius: '10px', padding: '10px 12px', marginBottom: '8px', fontSize: 'calc(11.5px * var(--dam-scale))', lineHeight: 1.6 } },
              h('div', { 'data-dam-row': '', style: { alignItems: 'center' } },
                h('b', null, title),
                h('span', { style: { marginLeft: 'auto', fontSize: 'calc(10.5px * var(--dam-scale))', padding: '2px 8px', borderRadius: '6px', background: stateBg, fontWeight: 700 } }, stateTxt)),
              h('div', { style: { opacity: .85, marginTop: '4px' } }, desc),
              ready ? null : h('div', { style: { marginTop: '8px' } },
                h('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: 'calc(10px * var(--dam-scale))', opacity: .7, marginBottom: '3px', gap: '8px' } },
                  h('span', null, phaseLine),
                  h('span', null, progress + '%')),
                h('div', { style: { height: '7px', borderRadius: '99px', background: 'rgba(128,128,128,.14)', overflow: 'hidden' } },
                  h('div', { style: { height: '100%', width: progress + '%', borderRadius: '99px', background: dl.phase === 'error' ? 'linear-gradient(90deg,#c44a4a,#e08a8a)' : 'linear-gradient(90deg, var(--dam-accent, #2456c4), #6f9bff)', transition: 'width .4s ease' } })),
                h('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: 'calc(10px * var(--dam-scale))', opacity: .6, marginTop: '3px' } },
                  h('span', null, locale === 'zh' ? '体积' : 'Size', ': ', isJs ? fmtMB(totalJs) + '（5 个文件，SHA256 校验后离线运行）' : '~563MB'),
                  h('span', null, locale === 'zh' ? '下载源' : 'Source', ': ', isJs ? mirrorName(mirror) + (locale === 'zh' ? ' · 失败自动切备用源' : ' · auto-failover') : (locale === 'zh' ? 'GitHub Releases 多通道' : 'GitHub Releases multi-mirror')))),
              h('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: '6px', alignItems: 'center', marginTop: '8px' } },
                !ready && isJs && !dlActive ? h('select', { 'data-dam-select': '', value: mirror, onChange: function (e) { setMirror(e.target.value) }, style: { marginRight: 'auto' } },
                  h('option', { value: 'auto' }, t('mAuto')),
                  h('option', { value: 'cn' }, t('mCn')),
                  h('option', { value: 'intl' }, t('mIntl'))) : null,
                ready ? h('button', { 'data-dam-btn': '', onClick: function () { setGuide(''); var n2 = Object.assign({}, cfg); n2.semanticEngineMode = guide; if (guide === 'js') { n2.activationSource = 'js'; n2.contextSinkMode = 'null' } else if (guide === 'python') { n2.activationSource = 'python'; n2.contextSinkMode = 'python' } setCfg(n2); setDirty(true) } }, locale === 'zh' ? '启用并继续' : 'Enable & continue') : null,
                !ready && isJs && !dlActive ? h('button', { 'data-dam-btn': '', onClick: startDl }, (dl.phase === 'error' || dl.phase === 'cancelled') ? t('semDlRetry') : t('semDlStart')) : null,
                !ready && isJs && dlActive ? h('button', { 'data-dam-btn': '', onClick: cancelDl }, t('semDlCancel')) : null,
                h('button', { 'data-dam-btn': '', onClick: function () { setGuide('') } }, t('gotIt'))))
          })()
            : null,
          field(t('fReasoning'), h('input', { type: 'checkbox', checked: !!cfg.reasoningObserverEnabled, onChange: function (e) { set('reasoningObserverEnabled', e.target.checked) } }), t('fReasoningHint')),
          field(t('fChildObs'), h('input', { type: 'checkbox', checked: !!cfg.contextBridgeObserveChildSessions, onChange: function (e) { set('contextBridgeObserveChildSessions', e.target.checked) } }), t('fChildObsHint')),
          field(locale === 'zh' ? '唤起阈值（校准策略）' : 'Activation thresholds (calibrated)', h('div', null,
            h('span', null, 'tauHi 0.45 · tauLo 0.35 · deltaExp 0.03 · deltaPro 0.05' + (sem.loaded ? ((locale === 'zh' ? ' · 发射模式:' : ' · emit: ') + (sem.activationEmitMode || 'shadow')) : ''))),
            t('fTuningHint')),
        ]),
        section('memoryHub', sectionLabels.memoryHub, [
          h('div', { 'data-dam-hint': '' }, t('secMemoryHubHint')),
          field(t('fMemoryHub'), h('input', { type: 'checkbox', checked: !!cfg.memoryHubEnabled, onChange: function (e) { set('memoryHubEnabled', e.target.checked) } }), t('fMemoryHubHint')),
          field(t('fEpisodicMin'), h('input', { 'data-dam-input': '', type: 'number', min: 1, max: 16, value: cfg.episodicMinSegments === undefined ? 2 : cfg.episodicMinSegments, onChange: function (e) { set('episodicMinSegments', Math.max(1, Math.min(16, Number(e.target.value) || 2))) } }), t('fEpisodicMinHint')),
          field(t('fEpisodicRet'), h('input', { 'data-dam-input': '', type: 'number', min: 16, max: 4096, value: cfg.episodicRetention === undefined ? 256 : cfg.episodicRetention, onChange: function (e) { set('episodicRetention', Math.max(16, Math.min(4096, Number(e.target.value) || 256))) } }), t('fEpisodicRetHint')),
          field(t('fProcSessions'), h('input', { 'data-dam-input': '', type: 'number', min: 1, max: 20, value: cfg.procedureMinSessions === undefined ? 3 : cfg.procedureMinSessions, onChange: function (e) { set('procedureMinSessions', Math.max(1, Math.min(20, Number(e.target.value) || 3))) } }), t('fProcSessionsHint')),
          field(t('fProcSuccess'), h('input', { 'data-dam-input': '', type: 'number', min: 1, max: 20, value: cfg.procedureMinSuccess === undefined ? 2 : cfg.procedureMinSuccess, onChange: function (e) { set('procedureMinSuccess', Math.max(1, Math.min(20, Number(e.target.value) || 2))) } }), t('fProcSuccessHint')),
          field(t('fProcCorr'), h('input', { 'data-dam-input': '', type: 'number', min: 0, max: 1, step: 0.05, value: cfg.procedureCorrectionCap === undefined ? 0.3 : cfg.procedureCorrectionCap, onChange: function (e) { set('procedureCorrectionCap', Math.max(0, Math.min(1, Number(e.target.value) || 0.3))) } }), t('fProcCorrHint')),
          field(t('fProcRisk'), h('input', { type: 'checkbox', checked: cfg.procedureHighRiskApproval !== false, onChange: function (e) { set('procedureHighRiskApproval', e.target.checked) } }), t('fProcRiskHint')),
          field(t('fProcLevel'), h('select', { 'data-dam-select': '', value: cfg.procedureActiveLevel || 'checklist', onChange: function (e) { set('procedureActiveLevel', e.target.value) } },
            h('option', { value: 'checklist' }, locale === 'zh' ? 'checklist 完整步骤' : 'checklist (full steps)'),
            h('option', { value: 'excerpt' }, locale === 'zh' ? 'excerpt 摘要' : 'excerpt (summary)'),
            h('option', { value: 'hint' }, locale === 'zh' ? 'hint 仅提示' : 'hint (hint only)')), t('fProcLevelHint')),
          h('div', { 'data-dam-hint': '', style: { marginTop: '4px' } }, t('memoryHubViewHint')),
        ]),
        section('appearance', sectionLabels.appearance, [
          h('div', { 'data-dam-hint': '' }, t('settingsHeader')),
          // 欢迎向导:开关(首启自动播放)+ 立即重看按钮(闭包内直调 openDialog——同一作用域,点击立即弹;
          // 不走 window 全局入口,避免多实例时序导致"点了没反应要刷新")+ 查看更新日志(走 update 弹窗,
          // 带 Logo 开场动画;versions 取 CHANGELOG 最新一条)
          field(t('fWelcomeTour'), h('div', { 'data-dam-row': '' },
            h('input', { type: 'checkbox', checked: cfg.welcomeTourEnabled !== false, onChange: function (e) { set('welcomeTourEnabled', e.target.checked) } }),
            h('button', { 'data-dam-btn': '', onClick: function () { try { openDialog({ kind: 'welcomeTour' }) } catch (eTour) {} } }, t('tourReplay')),
            h('button', { 'data-dam-btn': '', onClick: function () {
              try {
                var keys = Object.keys(CHANGELOG)
                if (!keys.length) return
                var latest = keys.sort(cmpVersion)[keys.length - 1]
                openDialog({ kind: 'update', versions: [{ version: latest, items: CHANGELOG[latest] }], currentVersion: latest })
              } catch (eLog) {}
            } }, locale === 'zh' ? '查看更新日志' : 'View changelog')), t('fWelcomeTourHint')),
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
        field(t('fExtBudget'), h('input', { 'data-dam-input': '', type: 'number', min: 200, value: cfg.externalInjectionChars === undefined ? 1400 : cfg.externalInjectionChars, onChange: function (e) { set('externalInjectionChars', Number(e.target.value) || 1400) } }), t('fExtBudgetHint')),
        field(t('fSnapGap'), h('input', { 'data-dam-input': '', type: 'number', min: 0, max: 50, value: cfg.snapshotMinGapRounds === undefined ? 5 : cfg.snapshotMinGapRounds, onChange: function (e) { set('snapshotMinGapRounds', Number(e.target.value) || 5) } }), t('fSnapGapHint')),
        field(t('fReinjectOnCompact'), h('input', { type: 'checkbox', checked: cfg.snapshotReinjectOnCompact !== false, onChange: function (e) { set('snapshotReinjectOnCompact', e.target.checked) } }), t('fReinjectOnCompactHint')),
        field(t('fPromptCustom'), h('button', { 'data-dam-btn': '', onClick: function () { setPromptEditOpen(!promptEditOpen) } }, (promptEditOpen ? (locale === 'zh' ? '收起' : 'Collapse') : (locale === 'zh' ? '编辑 prompt 层' : 'Edit prompt layers'))), t('fPromptCustomHint')),
        promptEditOpen ? [
          h('div', { key: '__layers', style: { padding: '6px 0 2px', width: '100%' } },
          (Object.keys(DEFAULT_PROMPT_LAYERS_CLIENT)).map(function (k) {
            return h('div', { key: k, style: { marginBottom: '6px' } },
              h('div', { 'data-dam-hint': '', style: { fontWeight: 700, marginBottom: '2px' } }, k),
              h('textarea', { 'data-dam-input': '', rows: 2, style: { width: '100%', fontFamily: 'monospace', fontSize: 'calc(11px * var(--dam-scale))' }, value: (cfg.promptLayerOverrides || {})[k] || '', placeholder: DEFAULT_PROMPT_LAYERS_CLIENT[k] || '(默认文案)', onChange: function (e) { var ov = Object.assign({}, cfg.promptLayerOverrides || {}); if (e.target.value.trim() === '') delete ov[k]; else ov[k] = e.target.value; set('promptLayerOverrides', ov) } }))
          })),
          h('div', { key: '__reset', 'data-dam-row': '', style: { marginTop: '6px' } },
            h('button', { 'data-dam-btn': '', onClick: function () { set('promptLayerOverrides', {}) } }, locale === 'zh' ? '一键恢复默认' : 'Reset to defaults'))
        ] : null]),
        section('automation', sectionLabels.automation, [field(t('fConsolidateMin'), h('input', { 'data-dam-input': '', type: 'number', min: 80, value: cfg.autoConsolidateMinChars === undefined ? 240 : cfg.autoConsolidateMinChars, onChange: function (e) { set('autoConsolidateMinChars', Number(e.target.value) || 240) } }), t('fConsolidateMinHint')),
        field(t('fAutoConsolidate'), h('input', { type: 'checkbox', checked: cfg.autoConsolidate !== false, onChange: function (e) { set('autoConsolidate', e.target.checked) } }), t('fAutoConsolidateHint')),
        field(t('fConsolidate'), h('input', { 'data-dam-input': '', type: 'number', min: 5, value: cfg.autoConsolidateCooldownMinutes === undefined ? 30 : cfg.autoConsolidateCooldownMinutes, onChange: function (e) { set('autoConsolidateCooldownMinutes', Number(e.target.value) || 30) } }), t('fConsolidateHint')),
        field(t('fConsolidateMax'), h('input', { 'data-dam-input': '', type: 'number', min: 1, max: 50, value: cfg.autoConsolidateDailyMax === undefined ? 8 : cfg.autoConsolidateDailyMax, onChange: function (e) { set('autoConsolidateDailyMax', Number(e.target.value) || 8) } }), t('fConsolidateMaxHint')),
        field(t('fAutoPopup'), h('input', { type: 'checkbox', checked: cfg.autoPopupEnabled !== false, onChange: function (e) { set('autoPopupEnabled', e.target.checked) } }), t('fAutoPopupHint')),
        field(t('fUnattended'), h('input', { type: 'checkbox', checked: !!cfg.unattendedMode, onChange: function (e) { set('unattendedMode', e.target.checked) } }), t('fUnattendedHint')),
        field(t('fUnattendedAuto'), h('input', { type: 'checkbox', checked: !!cfg.unattendedAuto, onChange: function (e) { set('unattendedAuto', e.target.checked) } }), t('fUnattendedAutoHint')),
        field(t('fAway'), h('input', { 'data-dam-input': '', type: 'number', min: 1, value: cfg.awayMinutes || 60, onChange: function (e) { set('awayMinutes', Number(e.target.value) || 60) } }), t('fAwayHint')),
        field(t('fAutoSum'), h('input', { 'data-dam-input': '', value: (cfg.autoSummaryTimes || []).join(','), onChange: function (e) { set('autoSummaryTimes', String(e.target.value || '').split(',').map(function (s) { return s.trim() }).filter(Boolean)) } }), t('fAutoSumHint')),
        field(t('fDayBoundary'), h('input', { 'data-dam-input': '', type: 'number', min: 0, max: 1439, value: (cfg.dayBoundaryMinutes === undefined ? 450 : cfg.dayBoundaryMinutes), onChange: function (e) { set('dayBoundaryMinutes', parseInt(e.target.value || '0', 10)) } }), t('fDayBoundaryHint')),
        field(t('fReflect'), h('input', { type: 'checkbox', checked: !!cfg.reflectEnabled, onChange: function (e) { set('reflectEnabled', e.target.checked) } }), t('fReflectHint')),
        field(t('fStyle'), h('select', { 'data-dam-select': '', value: cfg.reflectStyle, onChange: function (e) { set('reflectStyle', e.target.value) } },
          STYLE_IDS.map(function (id) { return h('option', { key: id, value: id }, t('style' + id.charAt(0).toUpperCase() + id.slice(1))) })), t('fStyleHint')),
        field(locale === 'zh' ? '总结/问候默认模型' : 'Summary & greeting model', h('div', { 'data-dam-row': '', style: { flex: 1 } },
          h('span', { style: { flex: 1, fontSize: 'calc(12px * var(--dam-scale))', wordBreak: 'break-all', opacity: cfg.subagentModel ? 1 : 0.6 } }, cfg.subagentModel || (locale === 'zh' ? '跟随路由默认' : 'routing default')),
          h('button', { 'data-dam-btn': '', onClick: openModels }, locale === 'zh' ? '选择模型' : 'Pick model')),
          locale === 'zh' ? '用于时段总结、问候语、自动沉淀等 subagent 功能;从检测到的模型中选择,或留空跟随路由默认。保存后生效。' : 'For scheduled summaries, greetings and auto-consolidation subagents; pick a detected model or leave empty for the routing default. Applies after saving.'),
        mdlOpen ? buildModelDrawer() : null,
        ]),
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

      // 面板外交互关闭(@ProperSAMA PR#12):点击面板外任意处 / 按 Esc 关闭。
      // 增强模式下面板可能盖住侧边栏入口按钮,这里提供不依赖按钮的兜底关闭手段;
      // 点击入口按钮本身排除在外(保留按钮 toggle 语义)。
      try {
        var onDocPointerDown = function (e) {
          if (!panelOpen || panelClosing) return
          var el = e.target
          if (el && el.closest && (el.closest('[data-dam-panel]') || el.closest('[data-dam-sidebar-btn]'))) return
          controller.close()
        }
        var onDocKeyDown = function (e) {
          if (e.key === 'Escape' && panelOpen && !panelClosing) controller.close()
        }
        document.addEventListener('pointerdown', onDocPointerDown, true)
        document.addEventListener('keydown', onDocKeyDown, true)
        ctx.effect(function () {
          return function () {
            document.removeEventListener('pointerdown', onDocPointerDown, true)
            document.removeEventListener('keydown', onDocKeyDown, true)
          }
        }, 'dsh-auto-memory: panel-outside-close')
      } catch (e) {}

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
        if (d && d.config && typeof d.config.autoPopupEnabled === 'boolean') autoPopupEnabled = d.config.autoPopupEnabled
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
          if (autoPopupEnabled === false) { prevAwayState = hostAwayReady ? hostAway : prevAwayState; return }
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
      // v0.1.30 大更新触达:一次性标记 majorTour——所有用户(新老)升级后首次打开都先播放完整欢迎向导,
      // 向导结束后接 CHANGELOG(含大更新内容+社区致谢);此后永不再弹(标记落 localStorage)。
      var MAJOR_TOUR_KEY = 'dsh-auto-memory.majorTourV130'
      apiGet(API.updateCheck).then(function (d) {
        if (d && d.current) {
          try {
            var seen = localStorage.getItem('dsh-auto-memory.seenVersion')
            var majorPending = !localStorage.getItem(MAJOR_TOUR_KEY)
            // 老用户(有使用痕迹)seen < 0.1.30(大更新前版本)升级上来 → 强制触发一次欢迎向导(含引擎下载引导)。
            // 不依赖一次性标记:0.1.29→0.1.34 升级即使曾看过旧版向导也要重放,确保模型下载引导不漏。
            var isExisting = !!seen || !!localStorage.getItem('dsh-auto-memory.firstRunDone') || !!localStorage.getItem('dsh-auto-memory.semWizardDone')
            var seenBeforeMajor = isExisting && (!seen || cmpVersion(seen, '0.1.30') < 0)
            if (seenBeforeMajor && !localStorage.getItem('dsh-auto-memory.semWizardDone')) {
              openDialog({ kind: 'welcomeTour' })
              try { localStorage.setItem(MAJOR_TOUR_KEY, '1') } catch (eM) {}
              return
            }
            if (majorPending && (d.current === '0.1.30' || seen)) {
              // 大更新触达(老用户:seen<current 或已有使用痕迹;新装用户走 first 流程不重复打扰)
              openDialog({ kind: 'welcomeTour' })
              try { localStorage.setItem(MAJOR_TOUR_KEY, '1') } catch (eM) {}
              return
            }
            if (!seen && !localStorage.getItem('dsh-auto-memory.firstRunDone')) {
              openDialog({ kind: 'first', currentVersion: d.current })
            } else if (seen && seen !== d.current) {
              // 只弹 0.1.30 大更新卡(补丁并入其尾部),不逐个弹历史版本——大更新内容才是要传达的
              var bigKey = '0.1.30'
              if (CHANGELOG[bigKey]) {
                openDialog({ kind: 'update', versions: [{ version: bigKey, items: CHANGELOG[bigKey] }], currentVersion: d.current })
                try { localStorage.setItem('dsh-auto-memory.seenVersion', d.current) } catch (e3b) {}
              } else {
                var versions = changelogBetween(seen, d.current)
                if (versions.length) openDialog({ kind: 'update', versions: versions, currentVersion: d.current })
                else try { localStorage.setItem('dsh-auto-memory.seenVersion', d.current) } catch (e3) {}
              }
            } else if (!seen && localStorage.getItem('dsh-auto-memory.firstRunDone')) {
              // 老用户但 seen 缺失(旧版升级/缓存清理):只看当前版本一条,不补历史链,避免把旧 log 塞给用户
              try { localStorage.setItem('dsh-auto-memory.seenVersion', d.current) } catch (e3) {}
              if (CHANGELOG[d.current]) openDialog({ kind: 'update', versions: [{ version: d.current, items: CHANGELOG[d.current] }], currentVersion: d.current })
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
            if (d && typeof d.autoPopupEnabled === 'boolean') autoPopupEnabled = d.autoPopupEnabled
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
            return slots.register({ name: 'sidebar.footer.action', id: 'auto-memory', order: 5, label: t('memory') + ' (pre)' }, function () { return h(SidebarButton) })
          }))
          surfaceDisposers.push(slots.inject('shell.overlay', function () {
            return slots.register({ name: 'shell.overlay', id: 'auto-memory', order: 5 }, function () { return h(MemoryPanel) })
          }))
          surfaceDisposers.push(slots.inject('shell.overlay', function () {
            return slots.register({ name: 'shell.overlay', id: 'auto-memory-dialogs', order: 6 }, function () { return h(DialogHost) })
          }))
          surfaceDisposers.push(slots.inject('settings.section', function () {
            return slots.register({ name: 'settings.section', id: 'auto-memory', order: 25, label: t('autoMemory') + ' (pre)' }, function (props) { return h(SettingsPage, { close: props && props.close }) })
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
