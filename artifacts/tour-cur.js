var TOUR_STEPS = [
          { art: 'bubble', core: '', kicker: 'WELCOME',
            title: L('欢迎使用 dsh-auto-memory', 'Welcome to dsh-auto-memory'),
            text: L('记录工作中的重要信息，在需要时继续。接下来逐项了解并选择适合你的记忆功能。', 'Keep important details from your work, ready when you need them. Explore and choose the memory features that suit you.') },
          { art: 'store', core: '', kicker: L('核心能力', 'CORE'),
            title: L('记忆是怎么被想起的', 'How memories are recalled'),
            text: L('先说清楚两条互不依赖的路：①自动联想（下面的开关）——插件持续观察对话与工具事件，锚定记忆；需要回忆时经固定边界注入下一轮，不破坏前缀缓存。②就算关掉它，AI 仍会在每轮结尾默认写项目 memory（memory_log），也能用 memory_recall 主动读取；日历、问候等面板功能也独立运行。', 'Two independent paths: (1) automatic association (switch below) — the plugin anchors memories from conversations and injects relevant ones into the next turn via a fixed boundary. (2) Even with it off, the AI still writes project memory each turn (memory_log) and can read via memory_recall; calendar, greeting and other panel features run independently.') },
          { art: 'inject', core: '', kicker: L('记忆快照', 'SNAPSHOT'),
            title: L('周期性记忆注入', 'Periodic memory snapshot'),
            text: L('另一个独立机制：首次启用时会向上下文注入一段记忆提示（项目长期笔记的摘要），之后每隔一定轮次、或上下文被压缩后自动重新注入，保证模型始终带着记忆背景工作。', 'A separate mechanism: on first enable a memory prompt (long-term notes digest) is injected into context; afterwards it re-injects every N rounds or whenever the context is compacted, so the model always works with memory background.'),
            toggles: [
              { key: 'associativeMemoryEnabled', name: L('自动联想注入', 'Automatic association'), sub: L('上面①的开关——按相关性自动注入记忆（推荐开）', 'Path (1) — inject memories by relevance (recommended)'), rec: true, where: L('语义记忆总开关', 'Memory engine') },
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
              { key: 'reasoningObserverEnabled', name: L('思维链监听', 'Reasoning observer'), sub: L('监听模型思维链分段作为检索信号（默认开；内容比可见输出更敏感，不需要可在此关掉）', 'Watch model CoT segments as a retrieval signal (default ON; more sensitive than visible output — turn off here if unwanted)'), def: false, where: L('语义记忆总开关', 'Memory engine') },
            ] },
          { art: 'radar', core: '', kicker: L('唤起与固化', 'ACTIVATION'),
            title: L('该出手时才出手', 'Interrupt only when it matters'),
            text: L('记忆唤起=在对话链（CoT/上下文）中直接检测回忆需求，命中即插入下一个环节；记忆固化=每轮结束把结论沉淀进记忆店，供下次唤起。每次决策都能在「唤起回顾」页复核打分。', 'Recall = detect memory needs directly in the conversation chain (CoT/context) and insert at the next boundary. Consolidation = settle conclusions into the stores each turn for later recall. Grade every decision in the Recall review tab.'),
            toggles: [
              { key: 'activationEmitMode', name: L('记忆唤起（链中检测→插入）', 'Memory recall (detect → inject)'), sub: L('开=canary 档（显式回忆注入，推荐）/ 关=shadow 档（只记录不注入）', 'On = canary (inject on explicit recall, recommended) / Off = shadow (record only)'), mode: true, rec: true, where: L('语义记忆总开关', 'Memory engine') },
              { key: 'autoConsolidate', name: L('记忆固化（自动沉淀）', 'Memory consolidation'), sub: L('每轮对话结束自动把结论沉淀进每日日志与记忆店（推荐开）', 'Consolidate conclusions into the log & stores each turn (recommended)'), rec: true, where: L('自动化', 'Automation') },
              // ★2026-09-22 改键(设置页缺口审计 P0-2):旧键 procedurePromotionEnabled 因 DEFAULT_CONFIG
              //   恒供给布尔 procedureInjectEnabled 而**结构性不可达** ⇒ 该开关此前是摆设(会翻面、写盘成功、宿主读不到)。
              { key: 'procedureInjectEnabled', name: L('技能固化与注入', 'Skill crystallization'), sub: L('重复流程固化为 checklist 自动附上（本开关只管「附不附」；晋升审批在「唤起回顾」页，与本开关无关）', 'Turn repeated flows into auto-attached checklists (this switch only controls attaching; promotion review lives in the Recall review tab and is unrelated)'), where: L('记忆中枢', 'Memory Hub') },
              // ★2026-09-30（F 批 · 用户问「新手引导的开关是否能够正常打开相关功能？」）——**此前不能**。
              //   根因：向导「记忆唤起」只写 activationEmitMode（档位），而**唤回总闸** activationInboxEnabled
              //   等三键在 DEFAULT_CONFIG 里恒为 false 且**向导零引用** ⇒ 用户在向导里勾了「记忆唤起」，
              //   判定照跑、记录照写，但结果永不投递（activation-host 三处早退）。
              //   修：把三键从「配置里的隐形预置」变成**向导可勾选项**，与设置页同键同源（saveConfigPatch 落盘）。
              { key: 'activationInboxEnabled', name: L('唤回总闸（收件箱）', 'Recall master gate (inbox)'), sub: L('关掉后：唤回判定照常运行、记录照常写入，但结果永不投递给对话。排查「看不到唤回」先看这里。默认开。', 'Off: recall still evaluates and records, but results are never delivered to the conversation. Check here first if you see no recall. Default ON.'), rec: true, where: L('语义记忆总开关', 'Memory engine') },
              { key: 'shadowRetrievalEnabled', name: L('影子检索（主动唤起）', 'Shadow retrieval'), sub: L('只记录候选、不投递的影子检索通道，用于校准「该不该唤起」；默认开。', 'Records candidates without delivering them — calibrates when recall should fire. Default ON.'), where: L('语义记忆总开关', 'Memory engine') },
              { key: 'contextBridgeEnabled', name: L('上下文桥', 'Context bridge'), sub: L('把会话上下文桥接给语义侧车（Python 档深度检索用）；默认开，JS 档不受影响。', 'Bridges conversation context to the semantic sidecar (used by the Python tier). Default ON; the JS tier is unaffected.'), where: L('语义记忆总开关', 'Memory engine') },
              { key: 'l0IndexEnabled', name: L('L0 向量索引', 'L0 vector index'), sub: L('给 L0 摘要层建自己的增量向量索引（默认开）；关掉即回零 IO、零嵌入、零目录。', 'Builds the L0 summary layer its own incremental vector index (default ON). Off = zero IO, zero embedding, no directory.'), where: L('语义记忆总开关', 'Memory engine') },
              // ★T10（2026-09-20）：机械 procedure 切片开关。
              //   ★A-1（2026-09-23）：机械切片已整条删除（用户裁定弃用）⇒ 向导清单同步去掉该项，
              //   避免向导承诺一个已不存在的功能（点开找不到控件）。
            ] },
          { art: 'rocket', core: '', kicker: L('完成', 'READY'), final: true,
            title: L('一切就绪', 'All set'),
            text: L('你刚才的选择都已即时保存。改主意了？随时在这几个地方重新打开：', 'Every choice above was saved instantly. Changed your mind? Revisit them here anytime:') },
        ]