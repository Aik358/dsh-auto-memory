// Source-backed field index; UI ownership never changes storage scope or defaults.
    var ITER5_SETTINGS_SCHEMA = [
  {
    "key": "boardMode",
    "kind": "host-config",
    "group": "continuity",
    "advanced": true,
    "default": "graph",
    "condition": "graph结构化白板/工具，legacy兼容文字白板；非法按legacy；只改变白板线，工具注册需重启。",
    "status": "源码定向核对",
    "aliases": [
      "白板模式（立即保存，需重启）",
      "Board mode (immediate save; restart required)",
      "ボードモード（即時保存・再起動が必要）"
    ]
  },
  {
    "key": "userMemoryDir",
    "kind": "host-config",
    "group": "maintenance",
    "advanced": true,
    "default": "~/.dsh/memory",
    "condition": "展开用户级记忆目录；空回落dshHome/memory；变更触发迁移，数据面跨项目；路径闸须在DSH_HOME内。",
    "status": "源码定向核对",
    "aliases": [
      "fUserDir"
    ]
  },
  {
    "key": "projectMemoryDir",
    "kind": "host-config",
    "group": "maintenance",
    "advanced": true,
    "default": ".dsh-memory",
    "condition": "相对项目的兼容目录名；集中根存在时按工作区映射落点，不能把本键猜成当前根路径。",
    "status": "源码定向核对",
    "aliases": [
      "fProjectDir"
    ]
  },
  {
    "key": "memoryRoot",
    "kind": "host-config",
    "group": "maintenance",
    "advanced": false,
    "default": "~/.dsh/memory/workspaces",
    "condition": "集中式每工作区子目录；路径闸须DSH_HOME内，保存迁移后refresh跟随新根；源保留。",
    "status": "源码定向核对",
    "aliases": [
      "fMemoryRoot"
    ]
  },
  {
    "key": "workbenchEnabled",
    "kind": "host-config",
    "group": "maintenance",
    "advanced": true,
    "default": "True",
    "condition": "false时工作台创建/派发走禁用分支；其它记忆门独立；主设置缺直接控件。",
    "status": "源码定向核对"
  },
  {
    "key": "workbenchRoot",
    "kind": "host-config",
    "group": "maintenance",
    "advanced": true,
    "default": "",
    "condition": "空串自动推导dshHome/aik_auto_memory_use；显式路径须落DSH_HOME内；旧工作台会话保留。",
    "status": "源码定向核对",
    "aliases": [
      "工作台工作区",
      "Workbench workspace"
    ]
  },
  {
    "key": "workbenchPeriodDays",
    "kind": "host-config",
    "group": "maintenance",
    "advanced": true,
    "default": "2",
    "condition": "派生镜像autoArchiveDays；运行时_workbenchPeriodDays直接读autoArchiveDays；现仍有只读提示。",
    "status": "源码定向核对",
    "aliases": [
      "工作台轮换周期（天）",
      "Workbench rotation period (days)"
    ]
  },
  {
    "key": "workbenchLoopShort",
    "kind": "host-config",
    "group": "maintenance",
    "advanced": true,
    "default": "10",
    "condition": "短期任务轴换代次数；运行时有限数>=2，否则回落兼容workbenchGreetLoop或10。",
    "status": "源码定向核对",
    "aliases": [
      "fWorkbenchLoopShort"
    ]
  },
  {
    "key": "workbenchLoopLong",
    "kind": "host-config",
    "group": "maintenance",
    "advanced": true,
    "default": "24",
    "condition": "长期任务轴换代次数；运行时有限数>=2，否则回落兼容workbenchGreetLoop或10；不要新增任意上限。",
    "status": "源码定向核对",
    "aliases": [
      "fWorkbenchLoopLong"
    ]
  },
  {
    "key": "subagentReasoningEffortShort",
    "kind": "host-config",
    "group": "advanced",
    "advanced": true,
    "default": "",
    "condition": "短期axis优先，空回落subagentReasoningEffort；仅off/low/high/max有效；不是模型选择。",
    "status": "源码定向核对",
    "aliases": [
      "子代理模型 / 思考强度",
      "Subagent model & reasoning effort"
    ]
  },
  {
    "key": "subagentReasoningEffortLong",
    "kind": "host-config",
    "group": "advanced",
    "advanced": true,
    "default": "",
    "condition": "长期axis优先，空回落subagentReasoningEffort；仅off/low/high/max有效；不是模型选择。",
    "status": "源码定向核对",
    "aliases": [
      "子代理模型 / 思考强度",
      "Subagent model & reasoning effort"
    ]
  },
  {
    "key": "workbenchRetryMs",
    "kind": "host-config",
    "group": "maintenance",
    "advanced": true,
    "default": "30000",
    "condition": "工作台失败退避；Math.max(Number(v)||30000,1000)，单位毫秒。",
    "status": "源码定向核对",
    "aliases": [
      "fWorkbenchRetryMs"
    ]
  },
  {
    "key": "injectEnabled",
    "kind": "host-config",
    "group": "find",
    "advanced": false,
    "default": "True",
    "condition": "只控制动态快照通路；静态纪律、M6 tail、工具读写/检索独立，关掉不代表完全不给AI任何记忆。",
    "status": "源码定向核对",
    "aliases": [
      "fInject"
    ]
  },
  {
    "key": "injectBudgetChars",
    "kind": "host-config",
    "group": "find",
    "advanced": false,
    "default": "8000",
    "condition": "动态摘要快照以max(Number(v)||1600,400)取预算；默认8000；静态纪律/M6/变更简报/工具全文另计，不是全部上下文硬上限。",
    "status": "源码定向核对",
    "aliases": [
      "fBudget"
    ]
  },
  {
    "key": "tier0CatalogEnabled",
    "kind": "host-config",
    "group": "find",
    "advanced": true,
    "default": "True",
    "condition": "false即清空目录文本/元数据；动态注入另受injectEnabled门；来源已缓存，不额外LLM。",
    "status": "源码定向核对",
    "aliases": [
      "fTier0Catalog"
    ]
  },
  {
    "key": "tier0MaxTokens",
    "kind": "host-config",
    "group": "find",
    "advanced": true,
    "default": "400",
    "condition": "tier0CatalogEnabled且动态注入开；与预算比例取小，运行时另有800 token硬上限。",
    "status": "源码定向核对",
    "aliases": [
      "fTier0Max"
    ]
  },
  {
    "key": "tier0BudgetShare",
    "kind": "host-config",
    "group": "find",
    "advanced": true,
    "default": "0.25",
    "condition": "目录最多占注入预算比例；与tier0MaxTokens取小；不是额外独立总预算。",
    "status": "源码定向核对",
    "aliases": [
      "fTier0Share"
    ]
  },
  {
    "key": "promptSectionToggles",
    "kind": "host-config",
    "group": "find",
    "advanced": true,
    "default": "{}",
    "condition": "动态分区对象；只有显式false关闭，缺省全开；13个可关段以宿主清单为准，must段有关闭后果。",
    "status": "源码定向核对",
    "aliases": [
      "fPromptSections"
    ]
  },
  {
    "key": "injectExcludeSources",
    "kind": "host-config",
    "group": "find",
    "advanced": true,
    "default": "[]",
    "condition": "字符串数组；ID/整层/目录前缀/精确路径匹配；非法类型拒绝/旧main静默忽略风险；不删除正文。",
    "status": "源码定向核对",
    "aliases": [
      "fExclude"
    ]
  },
  {
    "key": "recentDaysInjected",
    "kind": "host-config",
    "group": "find",
    "advanced": true,
    "default": "1",
    "condition": "refresh读取最近日志尾部；运行时max(Number(v)||3,1)，出厂显式1；不能把兜底3当默认1。",
    "status": "源码定向核对",
    "aliases": [
      "fDays"
    ]
  },
  {
    "key": "subagentModel",
    "kind": "host-config",
    "group": "advanced",
    "advanced": true,
    "default": "",
    "condition": "subAgentOptions只在非空时传模型；空跟随路由；与provider成对编辑保存。",
    "status": "源码定向核对",
    "aliases": [
      "子代理模型 / 思考强度",
      "Subagent model & reasoning effort"
    ]
  },
  {
    "key": "subagentProvider",
    "kind": "host-config",
    "group": "advanced",
    "advanced": true,
    "default": "",
    "condition": "subAgentOptions与工作台路由消费；非空才传provider；与model成对，不同provider同名模型不能混认。",
    "status": "源码定向核对",
    "aliases": [
      "子代理模型 / 思考强度",
      "Subagent model & reasoning effort"
    ]
  },
  {
    "key": "subagentReasoningEffort",
    "kind": "host-config",
    "group": "advanced",
    "advanced": true,
    "default": "",
    "condition": "axis覆盖为空时回落本键；仅off/low/high/max进入agentOptions；空跟随模型默认。",
    "status": "源码定向核对",
    "aliases": [
      "子代理模型 / 思考强度",
      "Subagent model & reasoning effort"
    ]
  },
  {
    "key": "noteCapacityChars",
    "kind": "host-config",
    "group": "maintenance",
    "advanced": true,
    "default": "24000",
    "condition": "项目笔记容量门，超出先AI折叠、失败归档，仍超拒写；与动态注入预算独立；有一次性容量默认迁移。",
    "status": "源码定向核对",
    "aliases": [
      "fNoteCap"
    ]
  },
  {
    "key": "userCapacityChars",
    "kind": "host-config",
    "group": "maintenance",
    "advanced": true,
    "default": "24000",
    "condition": "用户级正文容量门；超出整理后仍超拒写；与注入预算独立；一次性容量默认迁移尊重自设值。",
    "status": "源码定向核对",
    "aliases": [
      "fUserCap"
    ]
  },
  {
    "key": "capacityDefaultsVersion",
    "kind": "host-config",
    "group": "maintenance",
    "advanced": true,
    "default": "24",
    "condition": "内部一次性容量迁移标记，不能用户调参；不改默认、不覆盖自设容量。",
    "status": "源码定向核对"
  },
  {
    "key": "memoryFileIndexEnabled",
    "kind": "host-config",
    "group": "maintenance",
    "advanced": true,
    "default": "False",
    "condition": "===true才只读文件索引/诊断；不修改Markdown；无UI假自动联动。",
    "status": "源码定向核对",
    "aliases": [
      "fMemFileIndex"
    ]
  },
  {
    "key": "memoryAnchorEnabled",
    "kind": "host-config",
    "group": "maintenance",
    "advanced": true,
    "default": "False",
    "condition": "===true才锚点写事务；是shadow候选门之一；CALENDAR.md排除；关闭保留旧Markdown行为。",
    "status": "源码定向核对",
    "aliases": [
      "fAnchorIndex"
    ]
  },
  {
    "key": "autoConsolidate",
    "kind": "host-config",
    "group": "record",
    "advanced": false,
    "default": "True",
    "condition": "autoConsolidate!==false；本轮文本满足门槛、冷却及日限额后评估；夜间冷却翻倍；不是所有工具写入/日志的总闸。",
    "status": "源码定向核对",
    "aliases": [
      "fAutoConsolidate"
    ]
  },
  {
    "key": "autoConsolidateMinChars",
    "kind": "host-config",
    "group": "record",
    "advanced": true,
    "default": "240",
    "condition": "autoConsolidate开启后由对应任务消费；具体钳制与触发边界见逐字段runtime_evidence。",
    "status": "源码定向核对",
    "aliases": [
      "fConsolidateMin"
    ]
  },
  {
    "key": "autoConsolidateCooldownMinutes",
    "kind": "host-config",
    "group": "record",
    "advanced": false,
    "default": "30",
    "condition": "autoConsolidate开启后由对应任务消费；具体钳制与触发边界见逐字段runtime_evidence。",
    "status": "源码定向核对",
    "aliases": [
      "fConsolidate"
    ]
  },
  {
    "key": "autoConsolidateDailyMax",
    "kind": "host-config",
    "group": "record",
    "advanced": false,
    "default": "8",
    "condition": "autoConsolidate开启后由对应任务消费；具体钳制与触发边界见逐字段runtime_evidence。",
    "status": "源码定向核对",
    "aliases": [
      "fConsolidateMax"
    ]
  },
  {
    "key": "consolidateScheduleEnabled",
    "kind": "host-config",
    "group": "record",
    "advanced": false,
    "default": "True",
    "condition": "!==false且到达每天设定时刻，宿主在线时运行一次日志固化；独立于对话后日限额。",
    "status": "源码定向核对",
    "aliases": [
      "fConsSchedule"
    ]
  },
  {
    "key": "consolidateScheduleTime",
    "kind": "host-config",
    "group": "record",
    "advanced": false,
    "default": "09:30",
    "condition": "consolidateScheduleEnabled开启后由对应任务消费；具体钳制与触发边界见逐字段runtime_evidence。",
    "status": "源码定向核对",
    "aliases": [
      "fConsScheduleTime"
    ]
  },
  {
    "key": "consolidateScheduleDays",
    "kind": "host-config",
    "group": "record",
    "advanced": true,
    "default": "7",
    "condition": "consolidateScheduleEnabled开启后由对应任务消费；具体钳制与触发边界见逐字段runtime_evidence。",
    "status": "源码定向核对",
    "aliases": [
      "fConsScheduleDays"
    ]
  },
  {
    "key": "maintainScheduleEnabled",
    "kind": "host-config",
    "group": "maintenance",
    "advanced": true,
    "default": "True",
    "condition": "!==false且到时执行旧日志蒸馏；无超30天日志零LLM跳过；独立于对话后日限额。",
    "status": "源码定向核对",
    "aliases": [
      "fMaintSchedule"
    ]
  },
  {
    "key": "maintainScheduleTime",
    "kind": "host-config",
    "group": "maintenance",
    "advanced": true,
    "default": "10:00",
    "condition": "maintainScheduleEnabled开启后由对应任务消费；具体钳制与触发边界见逐字段runtime_evidence。",
    "status": "源码定向核对",
    "aliases": [
      "fMaintScheduleTime"
    ]
  },
  {
    "key": "handoffEnabled",
    "kind": "host-config",
    "group": "continuity",
    "advanced": false,
    "default": "True",
    "condition": "false阻止交接链读写/命中；白板与账本能力门，与自动接续及快照投递参数分开。",
    "status": "源码定向核对",
    "aliases": [
      "fHandoff"
    ]
  },
  {
    "key": "handoffPlanChars",
    "kind": "host-config",
    "group": "find",
    "advanced": true,
    "default": "1200",
    "condition": "handoff链/动态快照有效时截白板全文，max(Number(v)||1200,200)；全文可工具读取。",
    "status": "源码定向核对",
    "aliases": [
      "fHandoffPlan"
    ]
  },
  {
    "key": "handoffLedgerChars",
    "kind": "host-config",
    "group": "find",
    "advanced": true,
    "default": "800",
    "condition": "handoff链/动态快照有效时截最近账本，max(Number(v)||800,200)；不是账本文件容量。",
    "status": "源码定向核对",
    "aliases": [
      "fHandoffLedger"
    ]
  },
  {
    "key": "slimPlanChars",
    "kind": "host-config",
    "group": "find",
    "advanced": true,
    "default": "400",
    "condition": "main仍有历史控件；安全修复已撤控件，当前精简快照不消费；保留兼容数据，不复活注入。",
    "status": "源码定向核对"
  },
  {
    "key": "slimLedgerChars",
    "kind": "host-config",
    "group": "find",
    "advanced": true,
    "default": "300",
    "condition": "main仍有历史控件；安全修复已撤控件，当前精简快照不消费；保留兼容数据，不复活注入。",
    "status": "源码定向核对"
  },
  {
    "key": "rulesLayeringMode",
    "kind": "host-config",
    "group": "find",
    "advanced": true,
    "default": "self",
    "condition": "off回落旧行为；self用户级+工作区级，none工作区级；规则段不参与一般裁剪，不能伪称所有注入受同一硬上限。",
    "status": "源码定向核对",
    "aliases": [
      "fRulesLayering"
    ]
  },
  {
    "key": "criteriaGate",
    "kind": "host-config",
    "group": "continuity",
    "advanced": true,
    "default": "True",
    "condition": "交接/白板可选判据门；false仍保留丢卡/用户区/重复ID共同保护；不作为安全保护总开关。",
    "status": "源码定向核对",
    "aliases": [
      "fCriteriaGate"
    ]
  },
  {
    "key": "waterLevelWindowTokens",
    "kind": "host-config",
    "group": "continuity",
    "advanced": true,
    "default": "0",
    "condition": "0=自动检测；不可显示为0容量。检测失败按源码回落131072。",
    "status": "源码定向核对",
    "aliases": [
      "fWaterWindow"
    ]
  },
  {
    "key": "waterLevelThreshold",
    "kind": "host-config",
    "group": "continuity",
    "advanced": true,
    "default": "0.75",
    "condition": "fixed模式才作为手动建议阈值；auto取官方公式×安全余量。与autoContinueThreshold独立。",
    "status": "源码定向核对",
    "aliases": [
      "fWaterThreshold"
    ]
  },
  {
    "key": "waterLevelThresholdMode",
    "kind": "host-config",
    "group": "continuity",
    "advanced": true,
    "default": "auto",
    "condition": "auto按官方压缩公式推算；fixed读waterLevelThreshold。",
    "status": "源码定向核对",
    "aliases": [
      "fWaterMode"
    ]
  },
  {
    "key": "officialCompactionRatio",
    "kind": "host-config",
    "group": "continuity",
    "advanced": true,
    "default": "0.8",
    "condition": "waterLevelThresholdMode=auto；与官方有效来源/最终水位并排，固定模式保留值但不参与自动计算。",
    "status": "源码定向核对",
    "aliases": [
      "fCompactionRatio"
    ]
  },
  {
    "key": "officialHeadroomTokens",
    "kind": "host-config",
    "group": "continuity",
    "advanced": true,
    "default": "65536",
    "condition": "waterLevelThresholdMode=auto；与官方有效来源/最终水位并排，固定模式保留值但不参与自动计算。",
    "status": "源码定向核对",
    "aliases": [
      "fOfficialHeadroom"
    ]
  },
  {
    "key": "waterLevelAutoMargin",
    "kind": "host-config",
    "group": "continuity",
    "advanced": true,
    "default": "0.9",
    "condition": "waterLevelThresholdMode=auto；与官方有效来源/最终水位并排，固定模式保留值但不参与自动计算。",
    "status": "源码定向核对",
    "aliases": [
      "fAutoMargin"
    ]
  },
  {
    "key": "waterLevelAdvisory",
    "kind": "host-config",
    "group": "continuity",
    "advanced": true,
    "default": "True",
    "condition": "!==false、非无人值守及水位越建议阈值后提供建议；自动公式与历史渲染边界见各消费者，实机待核。",
    "status": "源码定向核对",
    "aliases": [
      "fWaterAdvisory"
    ]
  },
  {
    "key": "waterLevelAutoHandoff",
    "kind": "host-config",
    "group": "continuity",
    "advanced": true,
    "default": "True",
    "condition": "handoff链有效且!==false时水位/压缩/溢出条件可写系统骨架账本；与正式模型交接不同。",
    "status": "源码定向核对",
    "aliases": [
      "fWaterAuto"
    ]
  },
  {
    "key": "autoContinueEnabled",
    "kind": "host-config",
    "group": "continuity",
    "advanced": false,
    "default": "False",
    "condition": "开启、越独立接续阈值、权威running===false并满足冷却等，才出现确认卡。",
    "status": "源码定向核对",
    "aliases": [
      "fAutoContinue"
    ]
  },
  {
    "key": "autoContinueThreshold",
    "kind": "host-config",
    "group": "continuity",
    "advanced": true,
    "default": "0.75",
    "condition": "独立接续阈值，不应因合并水位展示被删除或与建议阈值联写。",
    "status": "源码定向核对"
  },
  {
    "key": "autoContinueConfirmSeconds",
    "kind": "host-config",
    "group": "continuity",
    "advanced": true,
    "default": "35",
    "condition": "autoContinueEnabled开启后由对应任务消费；具体钳制与触发边界见逐字段runtime_evidence。",
    "status": "源码定向核对",
    "aliases": [
      "fAutoContinueConfirm"
    ]
  },
  {
    "key": "autoContinueRefreshRitual",
    "kind": "host-config",
    "group": "continuity",
    "advanced": true,
    "default": "True",
    "condition": "autoContinueEnabled开启后由对应任务消费；具体钳制与触发边界见逐字段runtime_evidence。",
    "status": "源码定向核对"
  },
  {
    "key": "autoContinueRefreshTimeoutSeconds",
    "kind": "host-config",
    "group": "continuity",
    "advanced": true,
    "default": "90",
    "condition": "autoContinueEnabled开启后由对应任务消费；具体钳制与触发边界见逐字段runtime_evidence。",
    "status": "源码定向核对"
  },
  {
    "key": "autoContinueCooldownMinutes",
    "kind": "host-config",
    "group": "continuity",
    "advanced": true,
    "default": "30",
    "condition": "autoContinueEnabled开启后由对应任务消费；具体钳制与触发边界见逐字段runtime_evidence。",
    "status": "源码定向核对",
    "aliases": [
      "fAutoContinueCooldown"
    ]
  },
  {
    "key": "subagentGcEnabled",
    "kind": "host-config",
    "group": "maintenance",
    "advanced": true,
    "default": "True",
    "condition": "false停止插件痕迹回收；只识别auto-memory前缀；会话归档/删除另有门。",
    "status": "源码定向核对",
    "aliases": [
      "子代理痕迹回收",
      "Subagent trace recycle"
    ]
  },
  {
    "key": "subagentGcKeepDays",
    "kind": "host-config",
    "group": "maintenance",
    "advanced": true,
    "default": "3",
    "condition": "兜底巡检max(0,Number(v)||0)，0不按时间；完成即回收策略独立。",
    "status": "源码定向核对",
    "aliases": [
      "兜底回收保留天数",
      "Fallback recycle keep days"
    ]
  },
  {
    "key": "sessionArchiveEnabled",
    "kind": "host-config",
    "group": "maintenance",
    "advanced": false,
    "default": "True",
    "condition": "归档/删除自持总门；其下归档和删除各自开关及阈值独立。",
    "status": "源码定向核对",
    "aliases": [
      "会话归档与删除（自持）",
      "Session archive & delete (self-held)"
    ]
  },
  {
    "key": "autoArchiveEnabled",
    "kind": "host-config",
    "group": "maintenance",
    "advanced": false,
    "default": "True",
    "condition": "自持总门开启且此键!==false后归档；按时间阈值，force立即执行可忽略总门/节流。",
    "status": "源码定向核对",
    "aliases": [
      "自动归档",
      "Auto-archive"
    ]
  },
  {
    "key": "autoArchiveDays",
    "kind": "host-config",
    "group": "maintenance",
    "advanced": false,
    "default": "2",
    "condition": "工作台轮换共同生命周期真源；修改需说明派生镜像及旧会话保留。",
    "status": "源码定向核对",
    "aliases": [
      "归档阈值（天）",
      "Archive after (days)"
    ]
  },
  {
    "key": "autoDeleteEnabled",
    "kind": "host-config",
    "group": "maintenance",
    "advanced": false,
    "default": "True",
    "condition": "自持总门开启且此键!==false后检查已归档会话；未知归档时间不删；强制操作另有确认流程。",
    "status": "源码定向核对",
    "aliases": [
      "自动删除",
      "Auto-delete"
    ]
  },
  {
    "key": "autoDeleteDays",
    "kind": "host-config",
    "group": "maintenance",
    "advanced": false,
    "default": "7",
    "condition": "归档时间已知才自动删除；历史归档时间未知不删除；本原型不执行。",
    "status": "源码定向核对",
    "aliases": [
      "归档后保留（天）",
      "Delete after archiving (days)"
    ]
  },
  {
    "key": "autoArchiveCheckMin",
    "kind": "host-config",
    "group": "maintenance",
    "advanced": true,
    "default": "60",
    "condition": "resolveAutoConfig下限15上限1440；心跳节流而非心跳频率；force可忽略间隔。",
    "status": "源码定向核对",
    "aliases": [
      "fArchiveCheckMin"
    ]
  },
  {
    "key": "awayMinutes",
    "kind": "host-config",
    "group": "continuity",
    "advanced": true,
    "default": "60",
    "condition": "离开判定；使用有效有限正值，否则60；只是回归/暂离逻辑，不控制全部记录。",
    "status": "源码定向核对",
    "aliases": [
      "fAway"
    ]
  },
  {
    "key": "unattendedMode",
    "kind": "host-config",
    "group": "continuity",
    "advanced": false,
    "default": "False",
    "condition": "===true优先判无人值守；剥离会话/行为提示，保留事实记忆；不等于关闭全部自动任务。",
    "status": "源码定向核对",
    "aliases": [
      "fUnattended"
    ]
  },
  {
    "key": "unattendedAuto",
    "kind": "host-config",
    "group": "continuity",
    "advanced": true,
    "default": "False",
    "condition": "仅手动模式未开且===true时检查时间窗/托管任务；不改变手动模式持久化值。",
    "status": "源码定向核对",
    "aliases": [
      "fUnattendedAuto"
    ]
  },
  {
    "key": "unattendedAutoHours",
    "kind": "host-config",
    "group": "continuity",
    "advanced": true,
    "default": "[\"22:00-08:00\"]",
    "condition": "仅unattendedAuto且非手动托管时按窗口检测；空数组不按时间自动。",
    "status": "源码定向核对"
  },
  {
    "key": "snapshotTieredInject",
    "kind": "host-config",
    "group": "find",
    "advanced": true,
    "default": "True",
    "condition": "inject动态通路开且本键!==false才在完整快照节流期使用精简；false回落旧节流行为。",
    "status": "源码定向核对",
    "aliases": [
      "fTieredInject"
    ]
  },
  {
    "key": "snapshotMinGapRounds",
    "kind": "host-config",
    "group": "find",
    "advanced": true,
    "default": "5",
    "condition": "完整快照最小间隔，0合法；结构变化/真人发送另有豁免，不能许诺绝对每N轮。",
    "status": "源码定向核对",
    "aliases": [
      "fSnapGap"
    ]
  },
  {
    "key": "slimEveryRounds",
    "kind": "host-config",
    "group": "find",
    "advanced": true,
    "default": "3",
    "condition": "精简版间隔，<=0/非法回落3；用户在场和无人值守节奏应区别说明。",
    "status": "源码定向核对",
    "aliases": [
      "fSlimEvery"
    ]
  },
  {
    "key": "fullEverySlims",
    "kind": "host-config",
    "group": "find",
    "advanced": true,
    "default": "3",
    "condition": "无人值守完整快照需累计精简次数；真人发送豁免；<=0/非法回落3。",
    "status": "源码定向核对",
    "aliases": [
      "fFullEverySlims"
    ]
  },
  {
    "key": "snapshotReinjectOnCompact",
    "kind": "host-config",
    "group": "find",
    "advanced": true,
    "default": "True",
    "condition": "上下文版本回退且!==false触发一次重注入；按agent状态，不修改持久化节奏键。",
    "status": "源码定向核对",
    "aliases": [
      "fReinjectOnCompact"
    ]
  },
  {
    "key": "promptLayerOverrides",
    "kind": "host-config",
    "group": "find",
    "advanced": true,
    "default": "{}",
    "condition": "按key覆盖宿主默认文案；空串回默认；占位符date/ws/budget；非法文本不应清洗用户草稿。",
    "status": "源码定向核对",
    "aliases": [
      "fPromptCustom"
    ]
  },
  {
    "key": "autoPopupEnabled",
    "kind": "host-config",
    "group": "continuity",
    "advanced": false,
    "default": "True",
    "condition": "客户端回归时决定是否自动弹面板；手动打开独立；与awayMinutes联用。",
    "status": "源码定向核对",
    "aliases": [
      "fAutoPopup"
    ]
  },
  {
    "key": "welcomeTourEnabled",
    "kind": "host-config",
    "group": "appearance",
    "advanced": false,
    "default": "True",
    "condition": "首启自动播放门；localStorage只记用户动作/已读，不得反当总门；关闭仍可手动重看。",
    "status": "源码定向核对",
    "aliases": [
      "fWelcomeTour"
    ]
  },
  {
    "key": "autoSummaryTimes",
    "kind": "host-config",
    "group": "continuity",
    "advanced": true,
    "default": "[]",
    "condition": "HH:MM数组；空数组关闭该定时总结，不关闭其他定时任务。",
    "status": "源码定向核对",
    "aliases": [
      "fAutoSum"
    ]
  },
  {
    "key": "dayBoundaryMinutes",
    "kind": "host-config",
    "group": "record",
    "advanced": true,
    "default": "450",
    "condition": "日志/沉淀/反思/预算按该分钟切日；0..1439，0合法；相关显示旧fallback与安全分支整合后统一。",
    "status": "源码定向核对",
    "aliases": [
      "fDayBoundary"
    ]
  },
  {
    "key": "reflectEnabled",
    "kind": "host-config",
    "group": "record",
    "advanced": true,
    "default": "True",
    "condition": "refresh每日反思路径开启条件；独立于自动提炼与做梦固化；具体日调度先后实机待核。",
    "status": "源码定向核对",
    "aliases": [
      "fReflect"
    ]
  },
  {
    "key": "reflectStyle",
    "kind": "host-config",
    "group": "record",
    "advanced": true,
    "default": "auto",
    "condition": "反思调用取本键或auto；auto/life/professional；不改变记录/检索门。",
    "status": "源码定向核对",
    "aliases": [
      "fStyle"
    ]
  },
  {
    "key": "locale",
    "kind": "host-config",
    "group": "appearance",
    "advanced": false,
    "default": "system",
    "condition": "客户端applyLocalePref消费；system跟随DSH，zh/en等有效列表按当前语言表；宿主保存成功后应用。",
    "status": "源码定向核对",
    "aliases": [
      "fLocale"
    ]
  },
  {
    "key": "externalInjectionChars",
    "kind": "host-config",
    "group": "find",
    "advanced": true,
    "default": "1400",
    "condition": "动态外部段max(Number(v)||1400,200)预算；会话索引与正文按来源实际流程，非全文自动导入。",
    "status": "源码定向核对",
    "aliases": [
      "fExtBudget"
    ]
  },
  {
    "key": "externalSources",
    "kind": "host-config",
    "group": "find",
    "advanced": true,
    "default": "{\"workbuddy-user\": true, \"workbuddy-profile\": true, \"codebuddy-memory\": true, \"claude-global\": true, \"project-conventions\": true, \"workbuddy-sessions\": true, \"claude-sessions\": true, \"codex-sessions\": true, \"zcode-memory\": true, \"zcode-sessions\": true, \"kimi-global\": true, \"kimi-sessions\": true, \"trae-rules\": true}",
    "condition": "发现/链接/导入流程中的来源级开关；会话来源与文件正文区分。查看、链接、导入、移除是不同操作。",
    "status": "源码定向核对"
  },
  {
    "key": "associativeMemoryEnabled",
    "kind": "host-config",
    "group": "find",
    "advanced": false,
    "default": "False",
    "condition": "观察账本与主动检索门控；关闭并保存会清零观察数据，记忆正文保留。不能用作仅关闭投递的快捷方式。",
    "status": "源码定向核对",
    "aliases": [
      "fAssocEngine"
    ]
  },
  {
    "key": "shadowRetrievalEnabled",
    "kind": "host-config",
    "group": "find",
    "advanced": true,
    "default": "True",
    "condition": "assoc ∧ shadowRetrievalEnabled ∧ memoryAnchorEnabled；仅记录候选，不投递。",
    "status": "源码定向核对",
    "aliases": [
      "fShadowRetrieval"
    ]
  },
  {
    "key": "contextBridgeEnabled",
    "kind": "host-config",
    "group": "find",
    "advanced": true,
    "default": "True",
    "condition": "assoc ∧ contextBridgeEnabled；Python深度检索另需后端门与就绪；JS档不应笼统描述为依赖该开关。",
    "status": "源码定向核对",
    "aliases": [
      "fContextBridge"
    ]
  },
  {
    "key": "contextSinkMode",
    "kind": "host-config",
    "group": "find",
    "advanced": true,
    "default": "null",
    "condition": "检索模式保存会联动此键；底层门与实际就绪另核；不新增独立常用开关。",
    "status": "源码定向核对"
  },
  {
    "key": "activationInboxEnabled",
    "kind": "host-config",
    "group": "find",
    "advanced": false,
    "default": "True",
    "condition": "associativeMemoryEnabled===true ∧ activationInboxEnabled===true；控制主动唤回投递，不等于快照注入。",
    "status": "源码定向核对",
    "aliases": [
      "fInboxGate"
    ]
  },
  {
    "key": "activationSource",
    "kind": "host-config",
    "group": "find",
    "advanced": true,
    "default": "js",
    "condition": "检索模式保存会联动此键；底层门与实际就绪另核；不新增独立常用开关。",
    "status": "源码定向核对"
  },
  {
    "key": "jsDecideCooldownRounds",
    "kind": "host-config",
    "group": "find",
    "advanced": true,
    "default": "1",
    "condition": "实际消费者按分钟计算，键名Rounds与单位冲突；UI应显示分钟并保留key。",
    "status": "源码定向核对",
    "aliases": [
      "fJsCooldown"
    ]
  },
  {
    "key": "jsDecideDeltaExp",
    "kind": "host-config",
    "group": "find",
    "advanced": true,
    "default": "0.01",
    "condition": "JS端克隆校准policy覆盖deltaExp，有限值生效/null意图与Number(null)边界需后续核对；Python冻结策略不受它修改。",
    "status": "源码定向核对",
    "aliases": [
      "fJsDelta"
    ]
  },
  {
    "key": "jsDecideExcerptChars",
    "kind": "host-config",
    "group": "find",
    "advanced": true,
    "default": "40",
    "condition": "custom档使用；预设有效值覆盖该存储值。",
    "status": "源码定向核对",
    "aliases": [
      "fJsExcerpt"
    ]
  },
  {
    "key": "jsDecideCandidateScheme",
    "kind": "host-config",
    "group": "find",
    "advanced": false,
    "default": "balanced",
    "condition": "balanced=3条×40字符；dense=6条×20字符；custom才使用自定义条数/摘录。",
    "status": "源码定向核对",
    "aliases": [
      "fCandScheme"
    ]
  },
  {
    "key": "jsDecideCandidatesN",
    "kind": "host-config",
    "group": "find",
    "advanced": true,
    "default": "4",
    "condition": "仅custom档；当前值保留，balanced/dense不伪称它在生效。",
    "status": "源码定向核对",
    "aliases": [
      "fCandN"
    ]
  },
  {
    "key": "pythonBackendWorkerPath",
    "kind": "host-config",
    "group": "advanced",
    "advanced": true,
    "default": "",
    "condition": "sidecar脚本；空用捆绑路径；启动合并有死链自愈；安全保存禁止先load导致自愈落盘副作用。",
    "status": "源码定向核对"
  },
  {
    "key": "pythonBackendExecutable",
    "kind": "host-config",
    "group": "advanced",
    "advanced": true,
    "default": "",
    "condition": "Python可执行配置，经resolver选择/no-shell启动；空回落PATH/既有venv路径，真实机器环境待核。",
    "status": "源码定向核对"
  },
  {
    "key": "semanticEngineMode",
    "kind": "host-config",
    "group": "find",
    "advanced": false,
    "default": "auto",
    "condition": "auto/lexical/js/python；配置模式与实际ready/降级分开显示；保存时联动 activationSource/contextSinkMode/pythonBackendEnabled。",
    "status": "源码定向核对",
    "aliases": [
      "semMode"
    ]
  },
  {
    "key": "l0IndexEnabled",
    "kind": "host-config",
    "group": "find",
    "advanced": true,
    "default": "True",
    "condition": "===true且有可靠agent身份后增量同步；工作区语料刷新触发、五分钟节流、失败降级；零LLM。",
    "status": "源码定向核对",
    "aliases": [
      "fL0Index"
    ]
  },
  {
    "key": "semanticEmbedIncremental",
    "kind": "host-config",
    "group": "find",
    "advanced": true,
    "default": "True",
    "condition": "!==false启用C2 hash复用向量；false全量重嵌；不改变检索语义/投递门。",
    "status": "源码定向核对",
    "aliases": [
      "fIncEmbed"
    ]
  },
  {
    "key": "softInjectionEnabled",
    "kind": "host-config",
    "group": "advanced",
    "advanced": true,
    "default": "False",
    "condition": "本次lib源码没有确认当前运行读取点（DEFAULT之外）；保留历史字段，列废弃展示候选，不能伪造可生效调参控件。",
    "status": "源码定向核对"
  },
  {
    "key": "contextBridgeObserveChildSessions",
    "kind": "host-config",
    "group": "record",
    "advanced": true,
    "default": "True",
    "condition": "context桥有效且isChild时，只有===true纳入；与reasoningObserverEnabled作用面不同。",
    "status": "源码定向核对",
    "aliases": [
      "fChildObs"
    ]
  },
  {
    "key": "pythonBackendEnabled",
    "kind": "host-config",
    "group": "advanced",
    "advanced": true,
    "default": "False",
    "condition": "检索模式保存会联动此键；底层门与实际就绪另核；不新增独立常用开关。",
    "status": "源码定向核对"
  },
  {
    "key": "reasoningObserverEnabled",
    "kind": "host-config",
    "group": "record",
    "advanced": true,
    "default": "True",
    "condition": "reasoning-delta观察门；完整观察留存仍需associativeMemoryEnabled，关它不代表关闭所有上下文观察。",
    "status": "源码定向核对",
    "aliases": [
      "fReasoning"
    ]
  },
  {
    "key": "procedureInjectEnabled",
    "kind": "host-config",
    "group": "find",
    "advanced": false,
    "default": "True",
    "condition": "使用procedure-switch唯一解析口径；active技能注入/唤起门，不改变晋升与高风险审批状态。",
    "status": "源码定向核对",
    "aliases": [
      "fProcInject"
    ]
  },
  {
    "key": "procedurePromotionEnabled",
    "kind": "host-config",
    "group": "find",
    "advanced": true,
    "default": "False",
    "condition": "兼容别名；新键缺省时回退旧键；不是自动晋升开关。",
    "status": "源码定向核对"
  },
  {
    "key": "memoryHubEnabled",
    "kind": "host-config",
    "group": "record",
    "advanced": true,
    "default": "True",
    "condition": "===true才驱动三层store编排/对应技能注入臂；非单纯技能晋升总门，不虚构自动晋升策略。",
    "status": "源码定向核对",
    "aliases": [
      "fMemoryHub"
    ]
  },
  {
    "key": "episodicMinSegments",
    "kind": "host-config",
    "group": "record",
    "advanced": true,
    "default": "2",
    "condition": "episodic编排/store门槛；max(1,Number(v)||2)对应巩固最少段数。",
    "status": "源码定向核对",
    "aliases": [
      "fEpisodicMin"
    ]
  },
  {
    "key": "episodicRetention",
    "kind": "host-config",
    "group": "maintenance",
    "advanced": true,
    "default": "256",
    "condition": "episodic store构建时传Number(v)||256；淘汰边界由episodic-store消费，正式设置需明确构建缓存重载。",
    "status": "源码定向核对",
    "aliases": [
      "fEpisodicRet"
    ]
  },
  {
    "key": "factRetentionMax",
    "kind": "host-config",
    "group": "maintenance",
    "advanced": true,
    "default": "1000",
    "condition": "factStore构建时传Number(v)||1000；注释称<=0不限但0经||回落1000，界面必须报告该冲突，不能许诺0不限。",
    "status": "源码定向核对",
    "aliases": [
      "fFactRetention"
    ]
  },
  {
    "key": "workspaceDiscoverMax",
    "kind": "host-config",
    "group": "find",
    "advanced": true,
    "default": "200",
    "condition": "按最新会话mtime排序截断；有效有限数取发现上限，否则200；覆盖跨区检索/索引/总览。",
    "status": "源码定向核对",
    "aliases": [
      "fWsDiscover"
    ]
  },
  {
    "key": "procedureMinSessions",
    "kind": "host-config",
    "group": "advanced",
    "advanced": true,
    "default": "3",
    "condition": "procedure store getter有限数>=0，否则3；跨会话多样性门，不是自动晋升开关。",
    "status": "源码定向核对",
    "aliases": [
      "fProcSessions"
    ]
  },
  {
    "key": "procedureMinSuccess",
    "kind": "host-config",
    "group": "advanced",
    "advanced": true,
    "default": "2",
    "condition": "procedure store getter有限数>=0，否则2；证据成功门，状态通过真实动作/门限处理。",
    "status": "源码定向核对",
    "aliases": [
      "fProcSuccess"
    ]
  },
  {
    "key": "procedureCorrectionCap",
    "kind": "host-config",
    "group": "advanced",
    "advanced": true,
    "default": "0.3",
    "condition": "procedure store getter有限数>=0，否则0.3；correction比例上限；晋升具体状态路径见store。",
    "status": "源码定向核对",
    "aliases": [
      "fProcCorr"
    ]
  },
  {
    "key": "procedureHighRiskApproval",
    "kind": "host-config",
    "group": "advanced",
    "advanced": true,
    "default": "True",
    "condition": "高风险晋升审批规则；没有本轮引入的自动晋升开关，技能状态仍按真实动作及证据。",
    "status": "源码定向核对",
    "aliases": [
      "fProcRisk"
    ]
  },
  {
    "key": "procedureActiveLevel",
    "kind": "host-config",
    "group": "find",
    "advanced": true,
    "default": "checklist",
    "condition": "store构建读本键或checklist；active技能注入级别，高风险自动降hint；设置变更缓存重载待核。",
    "status": "源码定向核对",
    "aliases": [
      "fProcLevel"
    ]
  },
  {
    "key": "streamingInterruptionEnabled",
    "kind": "host-config",
    "group": "advanced",
    "advanced": true,
    "default": "False",
    "condition": "本次lib源码没有确认当前运行读取点（DEFAULT之外）；保留历史字段，列废弃展示候选，不能伪造可生效调参控件。",
    "status": "源码定向核对"
  },
  {
    "key": "maxPacketItems",
    "kind": "host-config",
    "group": "advanced",
    "advanced": true,
    "default": "2",
    "condition": "本次lib源码没有确认当前运行读取点（DEFAULT之外）；保留历史字段，列废弃展示候选，不能伪造可生效调参控件。",
    "status": "源码定向核对"
  },
  {
    "key": "maxPacketChars",
    "kind": "host-config",
    "group": "advanced",
    "advanced": true,
    "default": "800",
    "condition": "本次lib源码没有确认当前运行读取点（DEFAULT之外）；保留历史字段，列废弃展示候选，不能伪造可生效调参控件。",
    "status": "源码定向核对"
  },
  {
    "key": "packetTtlSteps",
    "kind": "host-config",
    "group": "advanced",
    "advanced": true,
    "default": "2",
    "condition": "本次lib源码没有确认当前运行读取点（DEFAULT之外）；保留历史字段，列废弃展示候选，不能伪造可生效调参控件。",
    "status": "源码定向核对"
  },
  {
    "key": "injectionCooldownSteps",
    "kind": "host-config",
    "group": "advanced",
    "advanced": true,
    "default": "3",
    "condition": "本次lib源码没有确认当前运行读取点（DEFAULT之外）；保留历史字段，列废弃展示候选，不能伪造可生效调参控件。",
    "status": "源码定向核对"
  },
  {
    "key": "globalBriefEnabled",
    "kind": "host-config",
    "group": "find",
    "advanced": true,
    "default": "True",
    "condition": "只检查当前工作区变更；DSH自身写入豁免；仅变化时给简报；独立于快照/主动唤回。",
    "status": "源码定向核对",
    "aliases": [
      "fGlobalBrief"
    ]
  },
  {
    "key": "globalBriefWatchMemory",
    "kind": "host-config",
    "group": "find",
    "advanced": true,
    "default": "True",
    "condition": "globalBriefEnabled；具体来源存在且发生非自身写入变化后消费；团队来源另需团队可用。",
    "status": "源码定向核对",
    "aliases": [
      "fGlobalBriefWatchMemory"
    ]
  },
  {
    "key": "globalBriefWatchDocs",
    "kind": "host-config",
    "group": "find",
    "advanced": true,
    "default": "True",
    "condition": "globalBriefEnabled；具体来源存在且发生非自身写入变化后消费；团队来源另需团队可用。",
    "status": "源码定向核对",
    "aliases": [
      "fGlobalBriefWatchDocs"
    ]
  },
  {
    "key": "globalBriefWatchExternal",
    "kind": "host-config",
    "group": "find",
    "advanced": true,
    "default": "True",
    "condition": "globalBriefEnabled；具体来源存在且发生非自身写入变化后消费；团队来源另需团队可用。",
    "status": "源码定向核对",
    "aliases": [
      "fGlobalBriefWatchExternal"
    ]
  },
  {
    "key": "globalBriefWatchTeam",
    "kind": "host-config",
    "group": "find",
    "advanced": true,
    "default": "True",
    "condition": "globalBriefEnabled；具体来源存在且发生非自身写入变化后消费；团队来源另需团队可用。",
    "status": "源码定向核对",
    "aliases": [
      "fGlobalBriefWatchTeam"
    ]
  },
  {
    "key": "globalBriefChars",
    "kind": "host-config",
    "group": "find",
    "advanced": true,
    "default": "1200",
    "condition": "globalBriefEnabled；具体来源存在且发生非自身写入变化后消费；团队来源另需团队可用。",
    "status": "源码定向核对",
    "aliases": [
      "fGlobalBriefChars"
    ]
  },
  {
    "key": "globalBriefInstruction",
    "kind": "host-config",
    "group": "find",
    "advanced": true,
    "default": "soft",
    "condition": "globalBriefEnabled；具体来源存在且发生非自身写入变化后消费；团队来源另需团队可用。",
    "status": "源码定向核对",
    "aliases": [
      "fGlobalBriefInstruction"
    ]
  },
  {
    "key": "globalBriefUnattended",
    "kind": "host-config",
    "group": "find",
    "advanced": true,
    "default": "True",
    "condition": "globalBriefEnabled；具体来源存在且发生非自身写入变化后消费；团队来源另需团队可用。",
    "status": "源码定向核对",
    "aliases": [
      "fGlobalBriefUnattended"
    ]
  },
  {
    "key": "teamEnabled",
    "kind": "host-config",
    "group": "advanced",
    "advanced": false,
    "default": "False",
    "condition": "显式开且连接可用才联网；其他正交项按实际消费者；不可把所有team键一概描述为此门下。",
    "status": "源码定向核对",
    "aliases": [
      "teamEnabled"
    ]
  },
  {
    "key": "teamProjectId",
    "kind": "host-config",
    "group": "advanced",
    "advanced": true,
    "default": "",
    "condition": "显式非空优先，否则team-project-map从git remote派生项目身份；持久化配置仍是宿主共享。",
    "status": "源码定向核对",
    "aliases": [
      "teamProjectId"
    ]
  },
  {
    "key": "teamEndpoint",
    "kind": "host-config",
    "group": "advanced",
    "advanced": true,
    "default": "",
    "condition": "teamEnabled构建S3 transport时传端点；空不出站；修改需重启重建传输。",
    "status": "源码定向核对",
    "aliases": [
      "teamEndpoint"
    ]
  },
  {
    "key": "teamBucket",
    "kind": "host-config",
    "group": "advanced",
    "advanced": true,
    "default": "",
    "condition": "teamEnabled构建S3 transport时传bucket；不猜HTTP/folder也消费；修改需重启。",
    "status": "源码定向核对",
    "aliases": [
      "teamBucket"
    ]
  },
  {
    "key": "teamRegion",
    "kind": "host-config",
    "group": "advanced",
    "advanced": true,
    "default": "",
    "condition": "teamEnabled构建S3 transport时传region；修改需重启。",
    "status": "源码定向核对",
    "aliases": [
      "teamRegion"
    ]
  },
  {
    "key": "teamPathStyle",
    "kind": "host-config",
    "group": "advanced",
    "advanced": true,
    "default": "True",
    "condition": "构建S3 transport使用pathStyle；OSS/MinIO需要此档，AWS依实际连接；修改需重启。",
    "status": "源码定向核对",
    "aliases": [
      "teamPathStyle"
    ]
  },
  {
    "key": "teamSyncTransport",
    "kind": "host-config",
    "group": "advanced",
    "advanced": true,
    "default": "s3",
    "condition": "main UI有s3/http/folder；安全复审核实HTTP装配未接线/folder未实现，正式整合需禁用并保留旧值。",
    "status": "源码定向核对",
    "aliases": [
      "teamSyncTransport"
    ]
  },
  {
    "key": "teamAccessKeyId",
    "kind": "host-config",
    "group": "advanced",
    "advanced": true,
    "default": "",
    "condition": "S3 transport构建凭据ID，不能输出日志/浏览器localStorage；修改需重启。",
    "status": "源码定向核对",
    "aliases": [
      "teamAccessKeyId"
    ]
  },
  {
    "key": "teamSecretAccessKey",
    "kind": "host-config",
    "group": "advanced",
    "advanced": true,
    "default": "",
    "condition": "S3 transport构建秘密；专用密码框/显隐/失败草稿；不得泄露或在原型接真密钥。",
    "status": "源码定向核对",
    "aliases": [
      "teamSecretAccessKey"
    ]
  },
  {
    "key": "teamSyncIntervalMs",
    "kind": "host-config",
    "group": "advanced",
    "advanced": true,
    "default": "5000",
    "condition": "team-sync正整数间隔与宿主构建值；防抖下限，非定时轮询承诺；非法回落既有默认。",
    "status": "源码定向核对",
    "aliases": [
      "teamSyncIntervalMs"
    ]
  },
  {
    "key": "teamOutboxMaxItems",
    "kind": "host-config",
    "group": "advanced",
    "advanced": true,
    "default": "500",
    "condition": "outbox构建正数向下取整，否则500；溢出丢最旧并降级；不是远端存储容量。",
    "status": "源码定向核对",
    "aliases": [
      "teamOutboxMaxItems"
    ]
  },
  {
    "key": "teamMaxConflicts",
    "kind": "host-config",
    "group": "advanced",
    "advanced": true,
    "default": "200",
    "condition": "team-merge构建正数向下取整，否则200；冲突中心容量上限。",
    "status": "源码定向核对",
    "aliases": [
      "teamMaxConflicts"
    ]
  },
  {
    "key": "teamShowMemberBadges",
    "kind": "host-config",
    "group": "advanced",
    "advanced": true,
    "default": "True",
    "condition": "TeamTab客户端挂载时读取config.teamShowMemberBadges!==false控制成员徽章/摘要（client.js:9287）；属于客户端显示，不是网络门。保存后已挂载组件是否重取待核。",
    "status": "源码定向核对",
    "aliases": [
      "teamShowMemberBadges"
    ]
  },
  {
    "key": "teamE2E",
    "kind": "host-config",
    "group": "advanced",
    "advanced": true,
    "default": "off",
    "condition": "off明文；unsupported是声明不可用，严禁显示为已加密或静默退回明文。",
    "status": "源码定向核对",
    "aliases": [
      "teamE2E"
    ]
  },
  {
    "key": "teamUsageReport",
    "kind": "host-config",
    "group": "advanced",
    "advanced": true,
    "default": "False",
    "condition": "仅本机日志留痕开关，无网络遥测；与teamEnabled正交。",
    "status": "源码定向核对",
    "aliases": [
      "teamUsageReport"
    ]
  },
  {
    "key": "teamUsageLog",
    "kind": "host-config",
    "group": "advanced",
    "advanced": true,
    "default": "",
    "condition": "teamUsageReport=true时本地留痕路径，无网络。",
    "status": "源码定向核对",
    "aliases": [
      "teamUsageLog"
    ]
  },
  {
    "key": "teamInjectEnabled",
    "kind": "host-config",
    "group": "advanced",
    "advanced": true,
    "default": "False",
    "condition": "teamEnabled∧teamInjectEnabled后团队快照注入；不改同步/连接总门。",
    "status": "源码定向核对",
    "aliases": [
      "teamInjectEnabled"
    ]
  },
  {
    "key": "teamDerivedDebounceMs",
    "kind": "host-config",
    "group": "advanced",
    "advanced": true,
    "default": "2000",
    "condition": "derived构建正数向下取整，否则2000；重算防抖，毫秒。",
    "status": "源码定向核对",
    "aliases": [
      "teamDerivedDebounceMs"
    ]
  },
  {
    "key": "teamServerUrl",
    "kind": "host-config",
    "group": "advanced",
    "advanced": true,
    "default": "",
    "condition": "team-auth有效服务地址(serverUrl或teamServerUrl)；和S3端点不同通路，不能把两者合成单一地址。",
    "status": "源码定向核对",
    "aliases": [
      "teamServerUrl"
    ]
  },
  {
    "key": "teamId",
    "kind": "host-config",
    "group": "advanced",
    "advanced": true,
    "default": "",
    "condition": "team-auth非空服务地址+团队ID后才认证；空未加入团队。",
    "status": "源码定向核对",
    "aliases": [
      "teamId"
    ]
  },
  {
    "key": "teamMemberName",
    "kind": "host-config",
    "group": "advanced",
    "advanced": true,
    "default": "",
    "condition": "未逐一验证精确门控/钳制；待核。以下消费者与源码注释供评审，不按名称推断。",
    "status": "字段已收录/生效细节待核",
    "aliases": [
      "teamMemberName"
    ]
  },
  {
    "key": "teamConflictPolicy",
    "kind": "host-config",
    "group": "advanced",
    "advanced": true,
    "default": "ask",
    "condition": "ask/mine/theirs/both由冲突处理消费；未设置读取点历史回落keep-both与DEFAULT ask不同，保留当前显式值。",
    "status": "源码定向核对",
    "aliases": [
      "teamConflictPolicy"
    ]
  },
  {
    "key": "teamAuditEnabled",
    "kind": "host-config",
    "group": "advanced",
    "advanced": true,
    "default": "False",
    "condition": "未逐一验证精确门控/钳制；待核。以下消费者与源码注释供评审，不按名称推断。",
    "status": "字段已收录/生效细节待核",
    "aliases": [
      "teamAuditEnabled"
    ]
  },
  {
    "key": "externalSources.workbuddy-user",
    "kind": "nested-config",
    "group": "find",
    "advanced": true,
    "default": "True",
    "condition": "来源存在且允许接入；会话来源只给索引/路径，导入另需显式动作；具体13源差异见ExternalMemory读取路径，未实机验证。",
    "status": "源码字段枚举"
  },
  {
    "key": "externalSources.workbuddy-profile",
    "kind": "nested-config",
    "group": "find",
    "advanced": true,
    "default": "True",
    "condition": "来源存在且允许接入；会话来源只给索引/路径，导入另需显式动作；具体13源差异见ExternalMemory读取路径，未实机验证。",
    "status": "源码字段枚举"
  },
  {
    "key": "externalSources.codebuddy-memory",
    "kind": "nested-config",
    "group": "find",
    "advanced": true,
    "default": "True",
    "condition": "来源存在且允许接入；会话来源只给索引/路径，导入另需显式动作；具体13源差异见ExternalMemory读取路径，未实机验证。",
    "status": "源码字段枚举"
  },
  {
    "key": "externalSources.claude-global",
    "kind": "nested-config",
    "group": "find",
    "advanced": true,
    "default": "True",
    "condition": "来源存在且允许接入；会话来源只给索引/路径，导入另需显式动作；具体13源差异见ExternalMemory读取路径，未实机验证。",
    "status": "源码字段枚举"
  },
  {
    "key": "externalSources.project-conventions",
    "kind": "nested-config",
    "group": "find",
    "advanced": true,
    "default": "True",
    "condition": "来源存在且允许接入；会话来源只给索引/路径，导入另需显式动作；具体13源差异见ExternalMemory读取路径，未实机验证。",
    "status": "源码字段枚举"
  },
  {
    "key": "externalSources.workbuddy-sessions",
    "kind": "nested-config",
    "group": "find",
    "advanced": true,
    "default": "True",
    "condition": "来源存在且允许接入；会话来源只给索引/路径，导入另需显式动作；具体13源差异见ExternalMemory读取路径，未实机验证。",
    "status": "源码字段枚举"
  },
  {
    "key": "externalSources.claude-sessions",
    "kind": "nested-config",
    "group": "find",
    "advanced": true,
    "default": "True",
    "condition": "来源存在且允许接入；会话来源只给索引/路径，导入另需显式动作；具体13源差异见ExternalMemory读取路径，未实机验证。",
    "status": "源码字段枚举"
  },
  {
    "key": "externalSources.codex-sessions",
    "kind": "nested-config",
    "group": "find",
    "advanced": true,
    "default": "True",
    "condition": "来源存在且允许接入；会话来源只给索引/路径，导入另需显式动作；具体13源差异见ExternalMemory读取路径，未实机验证。",
    "status": "源码字段枚举"
  },
  {
    "key": "externalSources.zcode-memory",
    "kind": "nested-config",
    "group": "find",
    "advanced": true,
    "default": "True",
    "condition": "来源存在且允许接入；会话来源只给索引/路径，导入另需显式动作；具体13源差异见ExternalMemory读取路径，未实机验证。",
    "status": "源码字段枚举"
  },
  {
    "key": "externalSources.zcode-sessions",
    "kind": "nested-config",
    "group": "find",
    "advanced": true,
    "default": "True",
    "condition": "来源存在且允许接入；会话来源只给索引/路径，导入另需显式动作；具体13源差异见ExternalMemory读取路径，未实机验证。",
    "status": "源码字段枚举"
  },
  {
    "key": "externalSources.kimi-global",
    "kind": "nested-config",
    "group": "find",
    "advanced": true,
    "default": "True",
    "condition": "来源存在且允许接入；会话来源只给索引/路径，导入另需显式动作；具体13源差异见ExternalMemory读取路径，未实机验证。",
    "status": "源码字段枚举"
  },
  {
    "key": "externalSources.kimi-sessions",
    "kind": "nested-config",
    "group": "find",
    "advanced": true,
    "default": "True",
    "condition": "来源存在且允许接入；会话来源只给索引/路径，导入另需显式动作；具体13源差异见ExternalMemory读取路径，未实机验证。",
    "status": "源码字段枚举"
  },
  {
    "key": "externalSources.trae-rules",
    "kind": "nested-config",
    "group": "find",
    "advanced": true,
    "default": "True",
    "condition": "来源存在且允许接入；会话来源只给索引/路径，导入另需显式动作；具体13源差异见ExternalMemory读取路径，未实机验证。",
    "status": "源码字段枚举"
  },
  {
    "key": "promptSectionToggles.rules-section",
    "kind": "nested-config",
    "group": "find",
    "advanced": true,
    "default": "True",
    "condition": "缺省全开；显式false不注入对应动态分区；关闭must段应说明行为请求减少，静态/M6通路独立。",
    "status": "源码字段枚举"
  },
  {
    "key": "promptSectionToggles.tier0-catalog",
    "kind": "nested-config",
    "group": "find",
    "advanced": true,
    "default": "True",
    "condition": "缺省全开；显式false不注入对应动态分区；关闭must段应说明行为请求减少，静态/M6通路独立。",
    "status": "源码字段枚举"
  },
  {
    "key": "promptSectionToggles.whiteboard-plan",
    "kind": "nested-config",
    "group": "find",
    "advanced": true,
    "default": "True",
    "condition": "缺省全开；显式false不注入对应动态分区；关闭must段应说明行为请求减少，静态/M6通路独立。",
    "status": "源码字段枚举"
  },
  {
    "key": "promptSectionToggles.handoff-ledger",
    "kind": "nested-config",
    "group": "find",
    "advanced": true,
    "default": "True",
    "condition": "缺省全开；显式false不注入对应动态分区；关闭must段应说明行为请求减少，静态/M6通路独立。",
    "status": "源码字段枚举"
  },
  {
    "key": "promptSectionToggles.calendar",
    "kind": "nested-config",
    "group": "find",
    "advanced": true,
    "default": "True",
    "condition": "缺省全开；显式false不注入对应动态分区；关闭must段应说明行为请求减少，静态/M6通路独立。",
    "status": "源码字段枚举"
  },
  {
    "key": "promptSectionToggles.external-memory",
    "kind": "nested-config",
    "group": "find",
    "advanced": true,
    "default": "True",
    "condition": "缺省全开；显式false不注入对应动态分区；关闭must段应说明行为请求减少，静态/M6通路独立。",
    "status": "源码字段枚举"
  },
  {
    "key": "promptSectionToggles.external-sessions",
    "kind": "nested-config",
    "group": "find",
    "advanced": true,
    "default": "True",
    "condition": "缺省全开；显式false不注入对应动态分区；关闭must段应说明行为请求减少，静态/M6通路独立。",
    "status": "源码字段枚举"
  },
  {
    "key": "promptSectionToggles.workspace-map",
    "kind": "nested-config",
    "group": "find",
    "advanced": true,
    "default": "True",
    "condition": "缺省全开；显式false不注入对应动态分区；关闭must段应说明行为请求减少，静态/M6通路独立。",
    "status": "源码字段枚举"
  },
  {
    "key": "promptSectionToggles.welcome-title",
    "kind": "nested-config",
    "group": "find",
    "advanced": true,
    "default": "True",
    "condition": "缺省全开；显式false不注入对应动态分区；关闭must段应说明行为请求减少，静态/M6通路独立。",
    "status": "源码字段枚举"
  },
  {
    "key": "promptSectionToggles.welcome-body",
    "kind": "nested-config",
    "group": "find",
    "advanced": true,
    "default": "True",
    "condition": "缺省全开；显式false不注入对应动态分区；关闭must段应说明行为请求减少，静态/M6通路独立。",
    "status": "源码字段枚举"
  },
  {
    "key": "promptSectionToggles.plan-update-request",
    "kind": "nested-config",
    "group": "find",
    "advanced": true,
    "default": "True",
    "condition": "缺省全开；显式false不注入对应动态分区；关闭must段应说明行为请求减少，静态/M6通路独立。",
    "status": "源码字段枚举"
  },
  {
    "key": "promptSectionToggles.water-advisory",
    "kind": "nested-config",
    "group": "find",
    "advanced": true,
    "default": "True",
    "condition": "缺省全开；显式false不注入对应动态分区；关闭must段应说明行为请求减少，静态/M6通路独立。",
    "status": "源码字段枚举"
  },
  {
    "key": "promptSectionToggles.handoff-pointer",
    "kind": "nested-config",
    "group": "find",
    "advanced": true,
    "default": "True",
    "condition": "缺省全开；显式false不注入对应动态分区；关闭must段应说明行为请求减少，静态/M6通路独立。",
    "status": "源码字段枚举"
  },
  {
    "key": "promptLayerOverrides.snapshotHead",
    "kind": "nested-config",
    "group": "find",
    "advanced": true,
    "default": "缺省/空串使用宿主默认文本",
    "condition": "自定义覆盖层；{date}/{ws}/{budget}占位符；当前动态/静态消费者支持范围待核；文本长度/注入通路不由本键自动扩大。",
    "status": "源码字段枚举"
  },
  {
    "key": "promptLayerOverrides.snapshotMeta",
    "kind": "nested-config",
    "group": "find",
    "advanced": true,
    "default": "缺省/空串使用宿主默认文本",
    "condition": "自定义覆盖层；{date}/{ws}/{budget}占位符；当前动态/静态消费者支持范围待核；文本长度/注入通路不由本键自动扩大。",
    "status": "源码字段枚举"
  },
  {
    "key": "promptLayerOverrides.snapshotRulesTitle",
    "kind": "nested-config",
    "group": "find",
    "advanced": true,
    "default": "缺省/空串使用宿主默认文本",
    "condition": "自定义覆盖层；{date}/{ws}/{budget}占位符；当前动态/静态消费者支持范围待核；文本长度/注入通路不由本键自动扩大。",
    "status": "源码字段枚举"
  },
  {
    "key": "promptLayerOverrides.snapshotRulesGuide",
    "kind": "nested-config",
    "group": "find",
    "advanced": true,
    "default": "缺省/空串使用宿主默认文本",
    "condition": "自定义覆盖层；{date}/{ws}/{budget}占位符；当前动态/静态消费者支持范围待核；文本长度/注入通路不由本键自动扩大。",
    "status": "源码字段枚举"
  },
  {
    "key": "promptLayerOverrides.snapshotTier0Title",
    "kind": "nested-config",
    "group": "find",
    "advanced": true,
    "default": "缺省/空串使用宿主默认文本",
    "condition": "自定义覆盖层；{date}/{ws}/{budget}占位符；当前动态/静态消费者支持范围待核；文本长度/注入通路不由本键自动扩大。",
    "status": "源码字段枚举"
  },
  {
    "key": "promptLayerOverrides.snapshotLogsTitle",
    "kind": "nested-config",
    "group": "find",
    "advanced": true,
    "default": "缺省/空串使用宿主默认文本",
    "condition": "自定义覆盖层；{date}/{ws}/{budget}占位符；当前动态/静态消费者支持范围待核；文本长度/注入通路不由本键自动扩大。",
    "status": "源码字段枚举"
  },
  {
    "key": "promptLayerOverrides.snapshotReflectionTitle",
    "kind": "nested-config",
    "group": "find",
    "advanced": true,
    "default": "缺省/空串使用宿主默认文本",
    "condition": "自定义覆盖层；{date}/{ws}/{budget}占位符；当前动态/静态消费者支持范围待核；文本长度/注入通路不由本键自动扩大。",
    "status": "源码字段枚举"
  },
  {
    "key": "promptLayerOverrides.snapshotUserTitle",
    "kind": "nested-config",
    "group": "find",
    "advanced": true,
    "default": "缺省/空串使用宿主默认文本",
    "condition": "自定义覆盖层；{date}/{ws}/{budget}占位符；当前动态/静态消费者支持范围待核；文本长度/注入通路不由本键自动扩大。",
    "status": "源码字段枚举"
  },
  {
    "key": "promptLayerOverrides.snapshotNotesTitle",
    "kind": "nested-config",
    "group": "find",
    "advanced": true,
    "default": "缺省/空串使用宿主默认文本",
    "condition": "自定义覆盖层；{date}/{ws}/{budget}占位符；当前动态/静态消费者支持范围待核；文本长度/注入通路不由本键自动扩大。",
    "status": "源码字段枚举"
  },
  {
    "key": "promptLayerOverrides.snapshotPlanTitle",
    "kind": "nested-config",
    "group": "find",
    "advanced": true,
    "default": "缺省/空串使用宿主默认文本",
    "condition": "自定义覆盖层；{date}/{ws}/{budget}占位符；当前动态/静态消费者支持范围待核；文本长度/注入通路不由本键自动扩大。",
    "status": "源码字段枚举"
  },
  {
    "key": "promptLayerOverrides.snapshotHandoffTitle",
    "kind": "nested-config",
    "group": "find",
    "advanced": true,
    "default": "缺省/空串使用宿主默认文本",
    "condition": "自定义覆盖层；{date}/{ws}/{budget}占位符；当前动态/静态消费者支持范围待核；文本长度/注入通路不由本键自动扩大。",
    "status": "源码字段枚举"
  },
  {
    "key": "promptLayerOverrides.snapshotWaterTitle",
    "kind": "nested-config",
    "group": "find",
    "advanced": true,
    "default": "缺省/空串使用宿主默认文本",
    "condition": "自定义覆盖层；{date}/{ws}/{budget}占位符；当前动态/静态消费者支持范围待核；文本长度/注入通路不由本键自动扩大。",
    "status": "源码字段枚举"
  },
  {
    "key": "promptLayerOverrides.snapshotWaterBody",
    "kind": "nested-config",
    "group": "find",
    "advanced": true,
    "default": "缺省/空串使用宿主默认文本",
    "condition": "自定义覆盖层；{date}/{ws}/{budget}占位符；当前动态/静态消费者支持范围待核；文本长度/注入通路不由本键自动扩大。",
    "status": "源码字段枚举"
  },
  {
    "key": "promptLayerOverrides.snapshotExternalTitle",
    "kind": "nested-config",
    "group": "find",
    "advanced": true,
    "default": "缺省/空串使用宿主默认文本",
    "condition": "自定义覆盖层；{date}/{ws}/{budget}占位符；当前动态/静态消费者支持范围待核；文本长度/注入通路不由本键自动扩大。",
    "status": "源码字段枚举"
  },
  {
    "key": "promptLayerOverrides.snapshotCalendarTitle",
    "kind": "nested-config",
    "group": "find",
    "advanced": true,
    "default": "缺省/空串使用宿主默认文本",
    "condition": "自定义覆盖层；{date}/{ws}/{budget}占位符；当前动态/静态消费者支持范围待核；文本长度/注入通路不由本键自动扩大。",
    "status": "源码字段枚举"
  },
  {
    "key": "promptLayerOverrides.snapshotWelcomeTitle",
    "kind": "nested-config",
    "group": "find",
    "advanced": true,
    "default": "缺省/空串使用宿主默认文本",
    "condition": "自定义覆盖层；{date}/{ws}/{budget}占位符；当前动态/静态消费者支持范围待核；文本长度/注入通路不由本键自动扩大。",
    "status": "源码字段枚举"
  },
  {
    "key": "promptLayerOverrides.snapshotWelcomeBody",
    "kind": "nested-config",
    "group": "find",
    "advanced": true,
    "default": "缺省/空串使用宿主默认文本",
    "condition": "自定义覆盖层；{date}/{ws}/{budget}占位符；当前动态/静态消费者支持范围待核；文本长度/注入通路不由本键自动扩大。",
    "status": "源码字段枚举"
  },
  {
    "key": "promptLayerOverrides.snapshotInscription",
    "kind": "nested-config",
    "group": "find",
    "advanced": true,
    "default": "缺省/空串使用宿主默认文本",
    "condition": "自定义覆盖层；{date}/{ws}/{budget}占位符；当前动态/静态消费者支持范围待核；文本长度/注入通路不由本键自动扩大。",
    "status": "源码字段枚举"
  },
  {
    "key": "promptLayerOverrides.snapshotSlimNote",
    "kind": "nested-config",
    "group": "find",
    "advanced": true,
    "default": "缺省/空串使用宿主默认文本",
    "condition": "自定义覆盖层；{date}/{ws}/{budget}占位符；当前动态/静态消费者支持范围待核；文本长度/注入通路不由本键自动扩大。",
    "status": "源码字段枚举"
  },
  {
    "key": "promptLayerOverrides.snapshotSlimGuide",
    "kind": "nested-config",
    "group": "find",
    "advanced": true,
    "default": "缺省/空串使用宿主默认文本",
    "condition": "自定义覆盖层；{date}/{ws}/{budget}占位符；当前动态/静态消费者支持范围待核；文本长度/注入通路不由本键自动扩大。",
    "status": "源码字段枚举"
  },
  {
    "key": "promptLayerOverrides.snapshotSlimRecallHit",
    "kind": "nested-config",
    "group": "find",
    "advanced": true,
    "default": "缺省/空串使用宿主默认文本",
    "condition": "自定义覆盖层；{date}/{ws}/{budget}占位符；当前动态/静态消费者支持范围待核；文本长度/注入通路不由本键自动扩大。",
    "status": "源码字段枚举"
  },
  {
    "key": "promptLayerOverrides.snapshotSlimRecallNote",
    "kind": "nested-config",
    "group": "find",
    "advanced": true,
    "default": "缺省/空串使用宿主默认文本",
    "condition": "自定义覆盖层；{date}/{ws}/{budget}占位符；当前动态/静态消费者支持范围待核；文本长度/注入通路不由本键自动扩大。",
    "status": "源码字段枚举"
  },
  {
    "key": "promptLayerOverrides.snapshotTail",
    "kind": "nested-config",
    "group": "find",
    "advanced": true,
    "default": "缺省/空串使用宿主默认文本",
    "condition": "自定义覆盖层；{date}/{ws}/{budget}占位符；当前动态/静态消费者支持范围待核；文本长度/注入通路不由本键自动扩大。",
    "status": "源码字段枚举"
  },
  {
    "key": "promptLayerOverrides.staticHead",
    "kind": "nested-config",
    "group": "find",
    "advanced": true,
    "default": "缺省/空串使用宿主默认文本",
    "condition": "自定义覆盖层；{date}/{ws}/{budget}占位符；当前动态/静态消费者支持范围待核；文本长度/注入通路不由本键自动扩大。",
    "status": "源码字段枚举"
  },
  {
    "key": "promptLayerOverrides.staticWriteDiscipline",
    "kind": "nested-config",
    "group": "find",
    "advanced": true,
    "default": "缺省/空串使用宿主默认文本",
    "condition": "自定义覆盖层；{date}/{ws}/{budget}占位符；当前动态/静态消费者支持范围待核；文本长度/注入通路不由本键自动扩大。",
    "status": "源码字段枚举"
  },
  {
    "key": "dam-kanban-cols",
    "kind": "browser-preference",
    "group": "advanced",
    "advanced": true,
    "default": "280",
    "condition": "由浏览器消费者读取；保留旧键读取/迁移。与宿主配置独立，不作为记忆能力开关。",
    "status": "静态键全量枚举；动态键模板另列"
  },
  {
    "key": "dam-kanban-layout",
    "kind": "browser-preference",
    "group": "advanced",
    "advanced": true,
    "default": "stack",
    "condition": "由浏览器消费者读取；保留旧键读取/迁移。与宿主配置独立，不作为记忆能力开关。",
    "status": "静态键全量枚举；动态键模板另列"
  },
  {
    "key": "dam-kanban-zoom",
    "kind": "browser-preference",
    "group": "advanced",
    "advanced": true,
    "default": "1",
    "condition": "由浏览器消费者读取；保留旧键读取/迁移。与宿主配置独立，不作为记忆能力开关。",
    "status": "静态键全量枚举；动态键模板另列"
  },
  {
    "key": "dam-skin",
    "kind": "browser-preference",
    "group": "appearance",
    "advanced": false,
    "default": "classic",
    "condition": "由浏览器消费者读取；保留旧键读取/迁移。与宿主配置独立，不作为记忆能力开关。",
    "status": "静态键全量枚举；动态键模板另列"
  },
  {
    "key": "dam-skin-style",
    "kind": "browser-preference",
    "group": "appearance",
    "advanced": true,
    "default": "legacy",
    "condition": "由浏览器消费者读取；保留旧键读取/迁移。与宿主配置独立，不作为记忆能力开关。",
    "status": "静态键全量枚举；动态键模板另列"
  },
  {
    "key": "dam-skin-theme",
    "kind": "browser-preference",
    "group": "appearance",
    "advanced": true,
    "default": "auto",
    "condition": "由浏览器消费者读取；保留旧键读取/迁移。与宿主配置独立，不作为记忆能力开关。",
    "status": "静态键全量枚举；动态键模板另列"
  },
  {
    "key": "dam-skin-variant",
    "kind": "browser-preference",
    "group": "appearance",
    "advanced": true,
    "default": "空",
    "condition": "由浏览器消费者读取；保留旧键读取/迁移。与宿主配置独立，不作为记忆能力开关。",
    "status": "静态键全量枚举；动态键模板另列"
  },
  {
    "key": "dam-wbg-enabled",
    "kind": "browser-preference",
    "group": "advanced",
    "advanced": true,
    "default": "False",
    "condition": "由浏览器消费者读取；保留旧键读取/迁移。与宿主配置独立，不作为记忆能力开关。",
    "status": "静态键全量枚举；动态键模板另列"
  },
  {
    "key": "dam-wbg-pan",
    "kind": "browser-preference",
    "group": "advanced",
    "advanced": true,
    "default": "{\"x\": 0, \"y\": 0}",
    "condition": "由浏览器消费者读取；保留旧键读取/迁移。与宿主配置独立，不作为记忆能力开关。",
    "status": "静态键全量枚举；动态键模板另列"
  },
  {
    "key": "dam-wbg-zoom",
    "kind": "browser-preference",
    "group": "advanced",
    "advanced": true,
    "default": "1",
    "condition": "由浏览器消费者读取；保留旧键读取/迁移。与宿主配置独立，不作为记忆能力开关。",
    "status": "静态键全量枚举；动态键模板另列"
  },
  {
    "key": "dsh-auto-memory.accentTheme.v1",
    "kind": "browser-preference",
    "group": "appearance",
    "advanced": true,
    "default": "deepseek",
    "condition": "由浏览器消费者读取；保留旧键读取/迁移。与宿主配置独立，不作为记忆能力开关。",
    "status": "静态键全量枚举；动态键模板另列",
    "aliases": [
      "强调色（立即生效）",
      "Accent color (immediate)",
      "アクセント色（即時適用）"
    ]
  },
  {
    "key": "dsh-auto-memory.appearance.v1",
    "kind": "browser-preference",
    "group": "appearance",
    "advanced": false,
    "default": "system",
    "condition": "由浏览器消费者读取；保留旧键读取/迁移。与宿主配置独立，不作为记忆能力开关。",
    "status": "静态键全量枚举；动态键模板另列"
  },
  {
    "key": "dsh-auto-memory.firstRunDone",
    "kind": "browser-state",
    "group": "advanced",
    "advanced": true,
    "default": "待核；状态标记不作用户设置",
    "condition": "由浏览器消费者读取；保留旧键读取/迁移。不是用户设置；只保留状态，不引入设置控件。",
    "status": "静态键全量枚举；动态键模板另列"
  },
  {
    "key": "dsh-auto-memory.fontScale.v2",
    "kind": "browser-preference",
    "group": "appearance",
    "advanced": false,
    "default": "md",
    "condition": "由浏览器消费者读取；保留旧键读取/迁移。与宿主配置独立，不作为记忆能力开关。",
    "status": "静态键全量枚举；动态键模板另列",
    "aliases": [
      "fFontSize"
    ]
  },
  {
    "key": "dsh-auto-memory.graphDensity.v1",
    "kind": "browser-preference",
    "group": "appearance",
    "advanced": true,
    "default": "relaxed",
    "condition": "由浏览器消费者读取；保留旧键读取/迁移。与宿主配置独立，不作为记忆能力开关。",
    "status": "静态键全量枚举；动态键模板另列",
    "aliases": [
      "关系图密度（立即生效）",
      "Graph density (immediate)",
      "グラフ密度（即時適用）"
    ]
  },
  {
    "key": "dsh-auto-memory.lastActive",
    "kind": "browser-state",
    "group": "advanced",
    "advanced": true,
    "default": "待核；状态标记不作用户设置",
    "condition": "由浏览器消费者读取；保留旧键读取/迁移。不是用户设置；只保留状态，不引入设置控件。",
    "status": "静态键全量枚举；动态键模板另列"
  },
  {
    "key": "dsh-auto-memory.majorTourV130",
    "kind": "browser-state",
    "group": "advanced",
    "advanced": true,
    "default": "待核；状态标记不作用户设置",
    "condition": "由浏览器消费者读取；保留旧键读取/迁移。不是用户设置；只保留状态，不引入设置控件。",
    "status": "静态键全量枚举；动态键模板另列"
  },
  {
    "key": "dsh-auto-memory.panel.geom",
    "kind": "browser-preference",
    "group": "appearance",
    "advanced": true,
    "default": "440×560；按视口/按钮锚定",
    "condition": "由浏览器消费者读取；保留旧键读取/迁移。与宿主配置独立，不作为记忆能力开关。",
    "status": "静态键全量枚举；动态键模板另列"
  },
  {
    "key": "dsh-auto-memory.panel.geom.compact",
    "kind": "browser-preference",
    "group": "appearance",
    "advanced": true,
    "default": "无",
    "condition": "由浏览器消费者读取；保留旧键读取/迁移。与宿主配置独立，不作为记忆能力开关。",
    "status": "静态键全量枚举；动态键模板另列"
  },
  {
    "key": "dsh-auto-memory.panel.pinned",
    "kind": "browser-preference",
    "group": "appearance",
    "advanced": true,
    "default": "False",
    "condition": "由浏览器消费者读取；保留旧键读取/迁移。与宿主配置独立，不作为记忆能力开关。",
    "status": "静态键全量枚举；动态键模板另列"
  },
  {
    "key": "dsh-auto-memory.panel.pos",
    "kind": "browser-preference",
    "group": "appearance",
    "advanced": true,
    "default": "both",
    "condition": "由浏览器消费者读取；保留旧键读取/迁移。与宿主配置独立，不作为记忆能力开关。",
    "status": "静态键全量枚举；动态键模板另列"
  },
  {
    "key": "dsh-auto-memory.presentation.v1",
    "kind": "browser-preference",
    "group": "appearance",
    "advanced": true,
    "default": "legacy",
    "condition": "由浏览器消费者读取；保留旧键读取/迁移。与宿主配置独立，不作为记忆能力开关。",
    "status": "静态键全量枚举；动态键模板另列"
  },
  {
    "key": "dsh-auto-memory.pyGpu",
    "kind": "browser-preference",
    "group": "advanced",
    "advanced": true,
    "default": "False",
    "condition": "由浏览器消费者读取；保留旧键读取/迁移。与宿主配置独立，不作为记忆能力开关。",
    "status": "静态键全量枚举；动态键模板另列"
  },
  {
    "key": "dsh-auto-memory.seenNotices",
    "kind": "browser-state",
    "group": "advanced",
    "advanced": true,
    "default": "待核；状态标记不作用户设置",
    "condition": "由浏览器消费者读取；保留旧键读取/迁移。不是用户设置；只保留状态，不引入设置控件。",
    "status": "静态键全量枚举；动态键模板另列"
  },
  {
    "key": "dsh-auto-memory.seenVersion",
    "kind": "browser-state",
    "group": "advanced",
    "advanced": true,
    "default": "待核；状态标记不作用户设置",
    "condition": "由浏览器消费者读取；保留旧键读取/迁移。不是用户设置；只保留状态，不引入设置控件。",
    "status": "静态键全量枚举；动态键模板另列"
  },
  {
    "key": "dsh-auto-memory.semDetectSnoozeUntil",
    "kind": "browser-state",
    "group": "advanced",
    "advanced": true,
    "default": "待核；状态标记不作用户设置",
    "condition": "由浏览器消费者读取；保留旧键读取/迁移。不是用户设置；只保留状态，不引入设置控件。",
    "status": "静态键全量枚举；动态键模板另列"
  },
  {
    "key": "dsh-auto-memory.semWizardDone",
    "kind": "browser-state",
    "group": "advanced",
    "advanced": true,
    "default": "待核；状态标记不作用户设置",
    "condition": "由浏览器消费者读取；保留旧键读取/迁移。不是用户设置；只保留状态，不引入设置控件。",
    "status": "静态键全量枚举；动态键模板另列"
  },
  {
    "key": "dsh-auto-memory.tourDismissed",
    "kind": "browser-state",
    "group": "advanced",
    "advanced": true,
    "default": "待核；状态标记不作用户设置",
    "condition": "由浏览器消费者读取；保留旧键读取/迁移。不是用户设置；只保留状态，不引入设置控件。",
    "status": "静态键全量枚举；动态键模板另列"
  },
  {
    "key": "dsh-auto-memory.seenSummary.<date>.<time>",
    "kind": "browser-state-pattern",
    "group": "advanced",
    "advanced": true,
    "default": "未见过",
    "condition": "动态日期/时间；seenKey组装后记录总结展示。",
    "status": "动态模式"
  },
  {
    "key": "layout-config.version",
    "kind": "layout-file",
    "group": "appearance",
    "advanced": true,
    "default": "1",
    "condition": "normalizeLayoutConfig白名单与告警；区域/槽位/块覆盖，未知项不渲染。消费者应用时机见client applyLayout*，热刷新边界待核。",
    "status": "契约全量字段展开；运行刷新待核"
  },
  {
    "key": "layout-config.tokens.<--dam-*|--skin-*>",
    "kind": "layout-file",
    "group": "appearance",
    "advanced": true,
    "default": "无覆盖",
    "condition": "normalizeLayoutConfig白名单与告警；区域/槽位/块覆盖，未知项不渲染。消费者应用时机见client applyLayout*，热刷新边界待核。",
    "status": "契约全量字段展开；运行刷新待核"
  },
  {
    "key": "layout-config.hidden[]",
    "kind": "layout-file",
    "group": "appearance",
    "advanced": true,
    "default": "[]",
    "condition": "normalizeLayoutConfig白名单与告警；区域/槽位/块覆盖，未知项不渲染。消费者应用时机见client applyLayout*，热刷新边界待核。",
    "status": "契约全量字段展开；运行刷新待核"
  },
  {
    "key": "layout-config.regions.page.order",
    "kind": "layout-file",
    "group": "appearance",
    "advanced": true,
    "default": "无覆盖/源布局",
    "condition": "normalizeLayoutConfig白名单与告警；区域/槽位/块覆盖，未知项不渲染。消费者应用时机见client applyLayout*，热刷新边界待核。",
    "status": "契约全量字段展开；运行刷新待核"
  },
  {
    "key": "layout-config.regions.page.w",
    "kind": "layout-file",
    "group": "appearance",
    "advanced": true,
    "default": "无覆盖/源布局",
    "condition": "normalizeLayoutConfig白名单与告警；区域/槽位/块覆盖，未知项不渲染。消费者应用时机见client applyLayout*，热刷新边界待核。",
    "status": "契约全量字段展开；运行刷新待核"
  },
  {
    "key": "layout-config.regions.page.h",
    "kind": "layout-file",
    "group": "appearance",
    "advanced": true,
    "default": "无覆盖/源布局",
    "condition": "normalizeLayoutConfig白名单与告警；区域/槽位/块覆盖，未知项不渲染。消费者应用时机见client applyLayout*，热刷新边界待核。",
    "status": "契约全量字段展开；运行刷新待核"
  },
  {
    "key": "layout-config.regions.page.min",
    "kind": "layout-file",
    "group": "appearance",
    "advanced": true,
    "default": "无覆盖/源布局",
    "condition": "normalizeLayoutConfig白名单与告警；区域/槽位/块覆盖，未知项不渲染。消费者应用时机见client applyLayout*，热刷新边界待核。",
    "status": "契约全量字段展开；运行刷新待核"
  },
  {
    "key": "layout-config.regions.page.hidden",
    "kind": "layout-file",
    "group": "appearance",
    "advanced": true,
    "default": "无覆盖/源布局",
    "condition": "normalizeLayoutConfig白名单与告警；区域/槽位/块覆盖，未知项不渲染。消费者应用时机见client applyLayout*，热刷新边界待核。",
    "status": "契约全量字段展开；运行刷新待核"
  },
  {
    "key": "layout-config.regions.float.order",
    "kind": "layout-file",
    "group": "appearance",
    "advanced": true,
    "default": "无覆盖/源布局",
    "condition": "normalizeLayoutConfig白名单与告警；区域/槽位/块覆盖，未知项不渲染。消费者应用时机见client applyLayout*，热刷新边界待核。",
    "status": "契约全量字段展开；运行刷新待核"
  },
  {
    "key": "layout-config.regions.float.w",
    "kind": "layout-file",
    "group": "appearance",
    "advanced": true,
    "default": "无覆盖/源布局",
    "condition": "normalizeLayoutConfig白名单与告警；区域/槽位/块覆盖，未知项不渲染。消费者应用时机见client applyLayout*，热刷新边界待核。",
    "status": "契约全量字段展开；运行刷新待核"
  },
  {
    "key": "layout-config.regions.float.h",
    "kind": "layout-file",
    "group": "appearance",
    "advanced": true,
    "default": "无覆盖/源布局",
    "condition": "normalizeLayoutConfig白名单与告警；区域/槽位/块覆盖，未知项不渲染。消费者应用时机见client applyLayout*，热刷新边界待核。",
    "status": "契约全量字段展开；运行刷新待核"
  },
  {
    "key": "layout-config.regions.float.min",
    "kind": "layout-file",
    "group": "appearance",
    "advanced": true,
    "default": "无覆盖/源布局",
    "condition": "normalizeLayoutConfig白名单与告警；区域/槽位/块覆盖，未知项不渲染。消费者应用时机见client applyLayout*，热刷新边界待核。",
    "status": "契约全量字段展开；运行刷新待核"
  },
  {
    "key": "layout-config.regions.float.hidden",
    "kind": "layout-file",
    "group": "appearance",
    "advanced": true,
    "default": "无覆盖/源布局",
    "condition": "normalizeLayoutConfig白名单与告警；区域/槽位/块覆盖，未知项不渲染。消费者应用时机见client applyLayout*，热刷新边界待核。",
    "status": "契约全量字段展开；运行刷新待核"
  },
  {
    "key": "layout-config.regions.page-nav.order",
    "kind": "layout-file",
    "group": "appearance",
    "advanced": true,
    "default": "无覆盖/源布局",
    "condition": "normalizeLayoutConfig白名单与告警；区域/槽位/块覆盖，未知项不渲染。消费者应用时机见client applyLayout*，热刷新边界待核。",
    "status": "契约全量字段展开；运行刷新待核"
  },
  {
    "key": "layout-config.regions.page-nav.w",
    "kind": "layout-file",
    "group": "appearance",
    "advanced": true,
    "default": "无覆盖/源布局",
    "condition": "normalizeLayoutConfig白名单与告警；区域/槽位/块覆盖，未知项不渲染。消费者应用时机见client applyLayout*，热刷新边界待核。",
    "status": "契约全量字段展开；运行刷新待核"
  },
  {
    "key": "layout-config.regions.page-nav.h",
    "kind": "layout-file",
    "group": "appearance",
    "advanced": true,
    "default": "无覆盖/源布局",
    "condition": "normalizeLayoutConfig白名单与告警；区域/槽位/块覆盖，未知项不渲染。消费者应用时机见client applyLayout*，热刷新边界待核。",
    "status": "契约全量字段展开；运行刷新待核"
  },
  {
    "key": "layout-config.regions.page-nav.min",
    "kind": "layout-file",
    "group": "appearance",
    "advanced": true,
    "default": "无覆盖/源布局",
    "condition": "normalizeLayoutConfig白名单与告警；区域/槽位/块覆盖，未知项不渲染。消费者应用时机见client applyLayout*，热刷新边界待核。",
    "status": "契约全量字段展开；运行刷新待核"
  },
  {
    "key": "layout-config.regions.page-nav.hidden",
    "kind": "layout-file",
    "group": "appearance",
    "advanced": true,
    "default": "无覆盖/源布局",
    "condition": "normalizeLayoutConfig白名单与告警；区域/槽位/块覆盖，未知项不渲染。消费者应用时机见client applyLayout*，热刷新边界待核。",
    "status": "契约全量字段展开；运行刷新待核"
  },
  {
    "key": "layout-config.regions.settings.order",
    "kind": "layout-file",
    "group": "appearance",
    "advanced": true,
    "default": "无覆盖/源布局",
    "condition": "normalizeLayoutConfig白名单与告警；区域/槽位/块覆盖，未知项不渲染。消费者应用时机见client applyLayout*，热刷新边界待核。",
    "status": "契约全量字段展开；运行刷新待核"
  },
  {
    "key": "layout-config.regions.settings.w",
    "kind": "layout-file",
    "group": "appearance",
    "advanced": true,
    "default": "无覆盖/源布局",
    "condition": "normalizeLayoutConfig白名单与告警；区域/槽位/块覆盖，未知项不渲染。消费者应用时机见client applyLayout*，热刷新边界待核。",
    "status": "契约全量字段展开；运行刷新待核"
  },
  {
    "key": "layout-config.regions.settings.h",
    "kind": "layout-file",
    "group": "appearance",
    "advanced": true,
    "default": "无覆盖/源布局",
    "condition": "normalizeLayoutConfig白名单与告警；区域/槽位/块覆盖，未知项不渲染。消费者应用时机见client applyLayout*，热刷新边界待核。",
    "status": "契约全量字段展开；运行刷新待核"
  },
  {
    "key": "layout-config.regions.settings.min",
    "kind": "layout-file",
    "group": "appearance",
    "advanced": true,
    "default": "无覆盖/源布局",
    "condition": "normalizeLayoutConfig白名单与告警；区域/槽位/块覆盖，未知项不渲染。消费者应用时机见client applyLayout*，热刷新边界待核。",
    "status": "契约全量字段展开；运行刷新待核"
  },
  {
    "key": "layout-config.regions.settings.hidden",
    "kind": "layout-file",
    "group": "appearance",
    "advanced": true,
    "default": "无覆盖/源布局",
    "condition": "normalizeLayoutConfig白名单与告警；区域/槽位/块覆盖，未知项不渲染。消费者应用时机见client applyLayout*，热刷新边界待核。",
    "status": "契约全量字段展开；运行刷新待核"
  },
  {
    "key": "layout-config.regions.dialog.order",
    "kind": "layout-file",
    "group": "appearance",
    "advanced": true,
    "default": "无覆盖/源布局",
    "condition": "normalizeLayoutConfig白名单与告警；区域/槽位/块覆盖，未知项不渲染。消费者应用时机见client applyLayout*，热刷新边界待核。",
    "status": "契约全量字段展开；运行刷新待核"
  },
  {
    "key": "layout-config.regions.dialog.w",
    "kind": "layout-file",
    "group": "appearance",
    "advanced": true,
    "default": "无覆盖/源布局",
    "condition": "normalizeLayoutConfig白名单与告警；区域/槽位/块覆盖，未知项不渲染。消费者应用时机见client applyLayout*，热刷新边界待核。",
    "status": "契约全量字段展开；运行刷新待核"
  },
  {
    "key": "layout-config.regions.dialog.h",
    "kind": "layout-file",
    "group": "appearance",
    "advanced": true,
    "default": "无覆盖/源布局",
    "condition": "normalizeLayoutConfig白名单与告警；区域/槽位/块覆盖，未知项不渲染。消费者应用时机见client applyLayout*，热刷新边界待核。",
    "status": "契约全量字段展开；运行刷新待核"
  },
  {
    "key": "layout-config.regions.dialog.min",
    "kind": "layout-file",
    "group": "appearance",
    "advanced": true,
    "default": "无覆盖/源布局",
    "condition": "normalizeLayoutConfig白名单与告警；区域/槽位/块覆盖，未知项不渲染。消费者应用时机见client applyLayout*，热刷新边界待核。",
    "status": "契约全量字段展开；运行刷新待核"
  },
  {
    "key": "layout-config.regions.dialog.hidden",
    "kind": "layout-file",
    "group": "appearance",
    "advanced": true,
    "default": "无覆盖/源布局",
    "condition": "normalizeLayoutConfig白名单与告警；区域/槽位/块覆盖，未知项不渲染。消费者应用时机见client applyLayout*，热刷新边界待核。",
    "status": "契约全量字段展开；运行刷新待核"
  },
  {
    "key": "layout-config.regions.sidebar-entry.order",
    "kind": "layout-file",
    "group": "appearance",
    "advanced": true,
    "default": "无覆盖/源布局",
    "condition": "normalizeLayoutConfig白名单与告警；区域/槽位/块覆盖，未知项不渲染。消费者应用时机见client applyLayout*，热刷新边界待核。",
    "status": "契约全量字段展开；运行刷新待核"
  },
  {
    "key": "layout-config.regions.sidebar-entry.w",
    "kind": "layout-file",
    "group": "appearance",
    "advanced": true,
    "default": "无覆盖/源布局",
    "condition": "normalizeLayoutConfig白名单与告警；区域/槽位/块覆盖，未知项不渲染。消费者应用时机见client applyLayout*，热刷新边界待核。",
    "status": "契约全量字段展开；运行刷新待核"
  },
  {
    "key": "layout-config.regions.sidebar-entry.h",
    "kind": "layout-file",
    "group": "appearance",
    "advanced": true,
    "default": "无覆盖/源布局",
    "condition": "normalizeLayoutConfig白名单与告警；区域/槽位/块覆盖，未知项不渲染。消费者应用时机见client applyLayout*，热刷新边界待核。",
    "status": "契约全量字段展开；运行刷新待核"
  },
  {
    "key": "layout-config.regions.sidebar-entry.min",
    "kind": "layout-file",
    "group": "appearance",
    "advanced": true,
    "default": "无覆盖/源布局",
    "condition": "normalizeLayoutConfig白名单与告警；区域/槽位/块覆盖，未知项不渲染。消费者应用时机见client applyLayout*，热刷新边界待核。",
    "status": "契约全量字段展开；运行刷新待核"
  },
  {
    "key": "layout-config.regions.sidebar-entry.hidden",
    "kind": "layout-file",
    "group": "appearance",
    "advanced": true,
    "default": "无覆盖/源布局",
    "condition": "normalizeLayoutConfig白名单与告警；区域/槽位/块覆盖，未知项不渲染。消费者应用时机见client applyLayout*，热刷新边界待核。",
    "status": "契约全量字段展开；运行刷新待核"
  },
  {
    "key": "layout-config.regions.overlay.order",
    "kind": "layout-file",
    "group": "appearance",
    "advanced": true,
    "default": "无覆盖/源布局",
    "condition": "normalizeLayoutConfig白名单与告警；区域/槽位/块覆盖，未知项不渲染。消费者应用时机见client applyLayout*，热刷新边界待核。",
    "status": "契约全量字段展开；运行刷新待核"
  },
  {
    "key": "layout-config.regions.overlay.w",
    "kind": "layout-file",
    "group": "appearance",
    "advanced": true,
    "default": "无覆盖/源布局",
    "condition": "normalizeLayoutConfig白名单与告警；区域/槽位/块覆盖，未知项不渲染。消费者应用时机见client applyLayout*，热刷新边界待核。",
    "status": "契约全量字段展开；运行刷新待核"
  },
  {
    "key": "layout-config.regions.overlay.h",
    "kind": "layout-file",
    "group": "appearance",
    "advanced": true,
    "default": "无覆盖/源布局",
    "condition": "normalizeLayoutConfig白名单与告警；区域/槽位/块覆盖，未知项不渲染。消费者应用时机见client applyLayout*，热刷新边界待核。",
    "status": "契约全量字段展开；运行刷新待核"
  },
  {
    "key": "layout-config.regions.overlay.min",
    "kind": "layout-file",
    "group": "appearance",
    "advanced": true,
    "default": "无覆盖/源布局",
    "condition": "normalizeLayoutConfig白名单与告警；区域/槽位/块覆盖，未知项不渲染。消费者应用时机见client applyLayout*，热刷新边界待核。",
    "status": "契约全量字段展开；运行刷新待核"
  },
  {
    "key": "layout-config.regions.overlay.hidden",
    "kind": "layout-file",
    "group": "appearance",
    "advanced": true,
    "default": "无覆盖/源布局",
    "condition": "normalizeLayoutConfig白名单与告警；区域/槽位/块覆盖，未知项不渲染。消费者应用时机见client applyLayout*，热刷新边界待核。",
    "status": "契约全量字段展开；运行刷新待核"
  },
  {
    "key": "layout-config.slots.head.order",
    "kind": "layout-file",
    "group": "appearance",
    "advanced": true,
    "default": "无覆盖/源布局",
    "condition": "normalizeLayoutConfig白名单与告警；区域/槽位/块覆盖，未知项不渲染。消费者应用时机见client applyLayout*，热刷新边界待核。",
    "status": "契约全量字段展开；运行刷新待核"
  },
  {
    "key": "layout-config.slots.head.hidden",
    "kind": "layout-file",
    "group": "appearance",
    "advanced": true,
    "default": "无覆盖/源布局",
    "condition": "normalizeLayoutConfig白名单与告警；区域/槽位/块覆盖，未知项不渲染。消费者应用时机见client applyLayout*，热刷新边界待核。",
    "status": "契约全量字段展开；运行刷新待核"
  },
  {
    "key": "layout-config.slots.actions.order",
    "kind": "layout-file",
    "group": "appearance",
    "advanced": true,
    "default": "无覆盖/源布局",
    "condition": "normalizeLayoutConfig白名单与告警；区域/槽位/块覆盖，未知项不渲染。消费者应用时机见client applyLayout*，热刷新边界待核。",
    "status": "契约全量字段展开；运行刷新待核"
  },
  {
    "key": "layout-config.slots.actions.hidden",
    "kind": "layout-file",
    "group": "appearance",
    "advanced": true,
    "default": "无覆盖/源布局",
    "condition": "normalizeLayoutConfig白名单与告警；区域/槽位/块覆盖，未知项不渲染。消费者应用时机见client applyLayout*，热刷新边界待核。",
    "status": "契约全量字段展开；运行刷新待核"
  },
  {
    "key": "layout-config.slots.nav.order",
    "kind": "layout-file",
    "group": "appearance",
    "advanced": true,
    "default": "无覆盖/源布局",
    "condition": "normalizeLayoutConfig白名单与告警；区域/槽位/块覆盖，未知项不渲染。消费者应用时机见client applyLayout*，热刷新边界待核。",
    "status": "契约全量字段展开；运行刷新待核"
  },
  {
    "key": "layout-config.slots.nav.hidden",
    "kind": "layout-file",
    "group": "appearance",
    "advanced": true,
    "default": "无覆盖/源布局",
    "condition": "normalizeLayoutConfig白名单与告警；区域/槽位/块覆盖，未知项不渲染。消费者应用时机见client applyLayout*，热刷新边界待核。",
    "status": "契约全量字段展开；运行刷新待核"
  },
  {
    "key": "layout-config.slots.summary.order",
    "kind": "layout-file",
    "group": "appearance",
    "advanced": true,
    "default": "无覆盖/源布局",
    "condition": "normalizeLayoutConfig白名单与告警；区域/槽位/块覆盖，未知项不渲染。消费者应用时机见client applyLayout*，热刷新边界待核。",
    "status": "契约全量字段展开；运行刷新待核"
  },
  {
    "key": "layout-config.slots.summary.hidden",
    "kind": "layout-file",
    "group": "appearance",
    "advanced": true,
    "default": "无覆盖/源布局",
    "condition": "normalizeLayoutConfig白名单与告警；区域/槽位/块覆盖，未知项不渲染。消费者应用时机见client applyLayout*，热刷新边界待核。",
    "status": "契约全量字段展开；运行刷新待核"
  },
  {
    "key": "layout-config.slots.list.order",
    "kind": "layout-file",
    "group": "appearance",
    "advanced": true,
    "default": "无覆盖/源布局",
    "condition": "normalizeLayoutConfig白名单与告警；区域/槽位/块覆盖，未知项不渲染。消费者应用时机见client applyLayout*，热刷新边界待核。",
    "status": "契约全量字段展开；运行刷新待核"
  },
  {
    "key": "layout-config.slots.list.hidden",
    "kind": "layout-file",
    "group": "appearance",
    "advanced": true,
    "default": "无覆盖/源布局",
    "condition": "normalizeLayoutConfig白名单与告警；区域/槽位/块覆盖，未知项不渲染。消费者应用时机见client applyLayout*，热刷新边界待核。",
    "status": "契约全量字段展开；运行刷新待核"
  },
  {
    "key": "layout-config.slots.timeline.order",
    "kind": "layout-file",
    "group": "appearance",
    "advanced": true,
    "default": "无覆盖/源布局",
    "condition": "normalizeLayoutConfig白名单与告警；区域/槽位/块覆盖，未知项不渲染。消费者应用时机见client applyLayout*，热刷新边界待核。",
    "status": "契约全量字段展开；运行刷新待核"
  },
  {
    "key": "layout-config.slots.timeline.hidden",
    "kind": "layout-file",
    "group": "appearance",
    "advanced": true,
    "default": "无覆盖/源布局",
    "condition": "normalizeLayoutConfig白名单与告警；区域/槽位/块覆盖，未知项不渲染。消费者应用时机见client applyLayout*，热刷新边界待核。",
    "status": "契约全量字段展开；运行刷新待核"
  },
  {
    "key": "layout-config.slots.board.order",
    "kind": "layout-file",
    "group": "appearance",
    "advanced": true,
    "default": "无覆盖/源布局",
    "condition": "normalizeLayoutConfig白名单与告警；区域/槽位/块覆盖，未知项不渲染。消费者应用时机见client applyLayout*，热刷新边界待核。",
    "status": "契约全量字段展开；运行刷新待核"
  },
  {
    "key": "layout-config.slots.board.hidden",
    "kind": "layout-file",
    "group": "appearance",
    "advanced": true,
    "default": "无覆盖/源布局",
    "condition": "normalizeLayoutConfig白名单与告警；区域/槽位/块覆盖，未知项不渲染。消费者应用时机见client applyLayout*，热刷新边界待核。",
    "status": "契约全量字段展开；运行刷新待核"
  },
  {
    "key": "layout-config.slots.graph.order",
    "kind": "layout-file",
    "group": "appearance",
    "advanced": true,
    "default": "无覆盖/源布局",
    "condition": "normalizeLayoutConfig白名单与告警；区域/槽位/块覆盖，未知项不渲染。消费者应用时机见client applyLayout*，热刷新边界待核。",
    "status": "契约全量字段展开；运行刷新待核"
  },
  {
    "key": "layout-config.slots.graph.hidden",
    "kind": "layout-file",
    "group": "appearance",
    "advanced": true,
    "default": "无覆盖/源布局",
    "condition": "normalizeLayoutConfig白名单与告警；区域/槽位/块覆盖，未知项不渲染。消费者应用时机见client applyLayout*，热刷新边界待核。",
    "status": "契约全量字段展开；运行刷新待核"
  },
  {
    "key": "layout-config.slots.calendar.order",
    "kind": "layout-file",
    "group": "appearance",
    "advanced": true,
    "default": "无覆盖/源布局",
    "condition": "normalizeLayoutConfig白名单与告警；区域/槽位/块覆盖，未知项不渲染。消费者应用时机见client applyLayout*，热刷新边界待核。",
    "status": "契约全量字段展开；运行刷新待核"
  },
  {
    "key": "layout-config.slots.calendar.hidden",
    "kind": "layout-file",
    "group": "appearance",
    "advanced": true,
    "default": "无覆盖/源布局",
    "condition": "normalizeLayoutConfig白名单与告警；区域/槽位/块覆盖，未知项不渲染。消费者应用时机见client applyLayout*，热刷新边界待核。",
    "status": "契约全量字段展开；运行刷新待核"
  },
  {
    "key": "layout-config.slots.detail.order",
    "kind": "layout-file",
    "group": "appearance",
    "advanced": true,
    "default": "无覆盖/源布局",
    "condition": "normalizeLayoutConfig白名单与告警；区域/槽位/块覆盖，未知项不渲染。消费者应用时机见client applyLayout*，热刷新边界待核。",
    "status": "契约全量字段展开；运行刷新待核"
  },
  {
    "key": "layout-config.slots.detail.hidden",
    "kind": "layout-file",
    "group": "appearance",
    "advanced": true,
    "default": "无覆盖/源布局",
    "condition": "normalizeLayoutConfig白名单与告警；区域/槽位/块覆盖，未知项不渲染。消费者应用时机见client applyLayout*，热刷新边界待核。",
    "status": "契约全量字段展开；运行刷新待核"
  },
  {
    "key": "layout-config.slots.chart.order",
    "kind": "layout-file",
    "group": "appearance",
    "advanced": true,
    "default": "无覆盖/源布局",
    "condition": "normalizeLayoutConfig白名单与告警；区域/槽位/块覆盖，未知项不渲染。消费者应用时机见client applyLayout*，热刷新边界待核。",
    "status": "契约全量字段展开；运行刷新待核"
  },
  {
    "key": "layout-config.slots.chart.hidden",
    "kind": "layout-file",
    "group": "appearance",
    "advanced": true,
    "default": "无覆盖/源布局",
    "condition": "normalizeLayoutConfig白名单与告警；区域/槽位/块覆盖，未知项不渲染。消费者应用时机见client applyLayout*，热刷新边界待核。",
    "status": "契约全量字段展开；运行刷新待核"
  },
  {
    "key": "layout-config.slots.stats-row.order",
    "kind": "layout-file",
    "group": "appearance",
    "advanced": true,
    "default": "无覆盖/源布局",
    "condition": "normalizeLayoutConfig白名单与告警；区域/槽位/块覆盖，未知项不渲染。消费者应用时机见client applyLayout*，热刷新边界待核。",
    "status": "契约全量字段展开；运行刷新待核"
  },
  {
    "key": "layout-config.slots.stats-row.hidden",
    "kind": "layout-file",
    "group": "appearance",
    "advanced": true,
    "default": "无覆盖/源布局",
    "condition": "normalizeLayoutConfig白名单与告警；区域/槽位/块覆盖，未知项不渲染。消费者应用时机见client applyLayout*，热刷新边界待核。",
    "status": "契约全量字段展开；运行刷新待核"
  },
  {
    "key": "layout-config.slots.badge.order",
    "kind": "layout-file",
    "group": "appearance",
    "advanced": true,
    "default": "无覆盖/源布局",
    "condition": "normalizeLayoutConfig白名单与告警；区域/槽位/块覆盖，未知项不渲染。消费者应用时机见client applyLayout*，热刷新边界待核。",
    "status": "契约全量字段展开；运行刷新待核"
  },
  {
    "key": "layout-config.slots.badge.hidden",
    "kind": "layout-file",
    "group": "appearance",
    "advanced": true,
    "default": "无覆盖/源布局",
    "condition": "normalizeLayoutConfig白名单与告警；区域/槽位/块覆盖，未知项不渲染。消费者应用时机见client applyLayout*，热刷新边界待核。",
    "status": "契约全量字段展开；运行刷新待核"
  },
  {
    "key": "layout-config.slots.hint.order",
    "kind": "layout-file",
    "group": "appearance",
    "advanced": true,
    "default": "无覆盖/源布局",
    "condition": "normalizeLayoutConfig白名单与告警；区域/槽位/块覆盖，未知项不渲染。消费者应用时机见client applyLayout*，热刷新边界待核。",
    "status": "契约全量字段展开；运行刷新待核"
  },
  {
    "key": "layout-config.slots.hint.hidden",
    "kind": "layout-file",
    "group": "appearance",
    "advanced": true,
    "default": "无覆盖/源布局",
    "condition": "normalizeLayoutConfig白名单与告警；区域/槽位/块覆盖，未知项不渲染。消费者应用时机见client applyLayout*，热刷新边界待核。",
    "status": "契约全量字段展开；运行刷新待核"
  },
  {
    "key": "layout-config.slots.form.order",
    "kind": "layout-file",
    "group": "appearance",
    "advanced": true,
    "default": "无覆盖/源布局",
    "condition": "normalizeLayoutConfig白名单与告警；区域/槽位/块覆盖，未知项不渲染。消费者应用时机见client applyLayout*，热刷新边界待核。",
    "status": "契约全量字段展开；运行刷新待核"
  },
  {
    "key": "layout-config.slots.form.hidden",
    "kind": "layout-file",
    "group": "appearance",
    "advanced": true,
    "default": "无覆盖/源布局",
    "condition": "normalizeLayoutConfig白名单与告警；区域/槽位/块覆盖，未知项不渲染。消费者应用时机见client applyLayout*，热刷新边界待核。",
    "status": "契约全量字段展开；运行刷新待核"
  },
  {
    "key": "layout-config.slots.footer.order",
    "kind": "layout-file",
    "group": "appearance",
    "advanced": true,
    "default": "无覆盖/源布局",
    "condition": "normalizeLayoutConfig白名单与告警；区域/槽位/块覆盖，未知项不渲染。消费者应用时机见client applyLayout*，热刷新边界待核。",
    "status": "契约全量字段展开；运行刷新待核"
  },
  {
    "key": "layout-config.slots.footer.hidden",
    "kind": "layout-file",
    "group": "appearance",
    "advanced": true,
    "default": "无覆盖/源布局",
    "condition": "normalizeLayoutConfig白名单与告警；区域/槽位/块覆盖，未知项不渲染。消费者应用时机见client applyLayout*，热刷新边界待核。",
    "status": "契约全量字段展开；运行刷新待核"
  },
  {
    "key": "layout-config.slots.empty.order",
    "kind": "layout-file",
    "group": "appearance",
    "advanced": true,
    "default": "无覆盖/源布局",
    "condition": "normalizeLayoutConfig白名单与告警；区域/槽位/块覆盖，未知项不渲染。消费者应用时机见client applyLayout*，热刷新边界待核。",
    "status": "契约全量字段展开；运行刷新待核"
  },
  {
    "key": "layout-config.slots.empty.hidden",
    "kind": "layout-file",
    "group": "appearance",
    "advanced": true,
    "default": "无覆盖/源布局",
    "condition": "normalizeLayoutConfig白名单与告警；区域/槽位/块覆盖，未知项不渲染。消费者应用时机见client applyLayout*，热刷新边界待核。",
    "status": "契约全量字段展开；运行刷新待核"
  },
  {
    "key": "layout-config.slots.chart-legend.order",
    "kind": "layout-file",
    "group": "appearance",
    "advanced": true,
    "default": "无覆盖/源布局",
    "condition": "normalizeLayoutConfig白名单与告警；区域/槽位/块覆盖，未知项不渲染。消费者应用时机见client applyLayout*，热刷新边界待核。",
    "status": "契约全量字段展开；运行刷新待核"
  },
  {
    "key": "layout-config.slots.chart-legend.hidden",
    "kind": "layout-file",
    "group": "appearance",
    "advanced": true,
    "default": "无覆盖/源布局",
    "condition": "normalizeLayoutConfig白名单与告警；区域/槽位/块覆盖，未知项不渲染。消费者应用时机见client applyLayout*，热刷新边界待核。",
    "status": "契约全量字段展开；运行刷新待核"
  },
  {
    "key": "layout-config.blocks.badge.style",
    "kind": "layout-file",
    "group": "appearance",
    "advanced": true,
    "default": "无覆盖/源皮肤",
    "condition": "normalizeLayoutConfig白名单与告警；区域/槽位/块覆盖，未知项不渲染。消费者应用时机见client applyLayout*，热刷新边界待核。",
    "status": "契约全量字段展开；运行刷新待核"
  },
  {
    "key": "layout-config.blocks.badge.bg",
    "kind": "layout-file",
    "group": "appearance",
    "advanced": true,
    "default": "无覆盖/源皮肤",
    "condition": "normalizeLayoutConfig白名单与告警；区域/槽位/块覆盖，未知项不渲染。消费者应用时机见client applyLayout*，热刷新边界待核。",
    "status": "契约全量字段展开；运行刷新待核"
  },
  {
    "key": "layout-config.blocks.list.style",
    "kind": "layout-file",
    "group": "appearance",
    "advanced": true,
    "default": "无覆盖/源皮肤",
    "condition": "normalizeLayoutConfig白名单与告警；区域/槽位/块覆盖，未知项不渲染。消费者应用时机见client applyLayout*，热刷新边界待核。",
    "status": "契约全量字段展开；运行刷新待核"
  },
  {
    "key": "layout-config.blocks.list.bg",
    "kind": "layout-file",
    "group": "appearance",
    "advanced": true,
    "default": "无覆盖/源皮肤",
    "condition": "normalizeLayoutConfig白名单与告警；区域/槽位/块覆盖，未知项不渲染。消费者应用时机见client applyLayout*，热刷新边界待核。",
    "status": "契约全量字段展开；运行刷新待核"
  },
  {
    "key": "layout-config.blocks.timeline.style",
    "kind": "layout-file",
    "group": "appearance",
    "advanced": true,
    "default": "无覆盖/源皮肤",
    "condition": "normalizeLayoutConfig白名单与告警；区域/槽位/块覆盖，未知项不渲染。消费者应用时机见client applyLayout*，热刷新边界待核。",
    "status": "契约全量字段展开；运行刷新待核"
  },
  {
    "key": "layout-config.blocks.timeline.bg",
    "kind": "layout-file",
    "group": "appearance",
    "advanced": true,
    "default": "无覆盖/源皮肤",
    "condition": "normalizeLayoutConfig白名单与告警；区域/槽位/块覆盖，未知项不渲染。消费者应用时机见client applyLayout*，热刷新边界待核。",
    "status": "契约全量字段展开；运行刷新待核"
  },
  {
    "key": "layout-config.blocks.chart.style",
    "kind": "layout-file",
    "group": "appearance",
    "advanced": true,
    "default": "无覆盖/源皮肤",
    "condition": "normalizeLayoutConfig白名单与告警；区域/槽位/块覆盖，未知项不渲染。消费者应用时机见client applyLayout*，热刷新边界待核。",
    "status": "契约全量字段展开；运行刷新待核"
  },
  {
    "key": "layout-config.blocks.chart.bg",
    "kind": "layout-file",
    "group": "appearance",
    "advanced": true,
    "default": "无覆盖/源皮肤",
    "condition": "normalizeLayoutConfig白名单与告警；区域/槽位/块覆盖，未知项不渲染。消费者应用时机见client applyLayout*，热刷新边界待核。",
    "status": "契约全量字段展开；运行刷新待核"
  },
  {
    "key": "layout-config.blocks.stat.style",
    "kind": "layout-file",
    "group": "appearance",
    "advanced": true,
    "default": "无覆盖/源皮肤",
    "condition": "normalizeLayoutConfig白名单与告警；区域/槽位/块覆盖，未知项不渲染。消费者应用时机见client applyLayout*，热刷新边界待核。",
    "status": "契约全量字段展开；运行刷新待核"
  },
  {
    "key": "layout-config.blocks.stat.bg",
    "kind": "layout-file",
    "group": "appearance",
    "advanced": true,
    "default": "无覆盖/源皮肤",
    "condition": "normalizeLayoutConfig白名单与告警；区域/槽位/块覆盖，未知项不渲染。消费者应用时机见client applyLayout*，热刷新边界待核。",
    "status": "契约全量字段展开；运行刷新待核"
  },
  {
    "key": "layout-config.blocks.actions.style",
    "kind": "layout-file",
    "group": "appearance",
    "advanced": true,
    "default": "无覆盖/源皮肤",
    "condition": "normalizeLayoutConfig白名单与告警；区域/槽位/块覆盖，未知项不渲染。消费者应用时机见client applyLayout*，热刷新边界待核。",
    "status": "契约全量字段展开；运行刷新待核"
  },
  {
    "key": "layout-config.blocks.actions.bg",
    "kind": "layout-file",
    "group": "appearance",
    "advanced": true,
    "default": "无覆盖/源皮肤",
    "condition": "normalizeLayoutConfig白名单与告警；区域/槽位/块覆盖，未知项不渲染。消费者应用时机见client applyLayout*，热刷新边界待核。",
    "status": "契约全量字段展开；运行刷新待核"
  },
  {
    "key": "layout-config.blocks.form.style",
    "kind": "layout-file",
    "group": "appearance",
    "advanced": true,
    "default": "无覆盖/源皮肤",
    "condition": "normalizeLayoutConfig白名单与告警；区域/槽位/块覆盖，未知项不渲染。消费者应用时机见client applyLayout*，热刷新边界待核。",
    "status": "契约全量字段展开；运行刷新待核"
  },
  {
    "key": "layout-config.blocks.form.bg",
    "kind": "layout-file",
    "group": "appearance",
    "advanced": true,
    "default": "无覆盖/源皮肤",
    "condition": "normalizeLayoutConfig白名单与告警；区域/槽位/块覆盖，未知项不渲染。消费者应用时机见client applyLayout*，热刷新边界待核。",
    "status": "契约全量字段展开；运行刷新待核"
  },
  {
    "key": "layout-config.blocks.prose.style",
    "kind": "layout-file",
    "group": "appearance",
    "advanced": true,
    "default": "无覆盖/源皮肤",
    "condition": "normalizeLayoutConfig白名单与告警；区域/槽位/块覆盖，未知项不渲染。消费者应用时机见client applyLayout*，热刷新边界待核。",
    "status": "契约全量字段展开；运行刷新待核"
  },
  {
    "key": "layout-config.blocks.prose.bg",
    "kind": "layout-file",
    "group": "appearance",
    "advanced": true,
    "default": "无覆盖/源皮肤",
    "condition": "normalizeLayoutConfig白名单与告警；区域/槽位/块覆盖，未知项不渲染。消费者应用时机见client applyLayout*，热刷新边界待核。",
    "status": "契约全量字段展开；运行刷新待核"
  },
  {
    "key": "layout-config.blocks.media.style",
    "kind": "layout-file",
    "group": "appearance",
    "advanced": true,
    "default": "无覆盖/源皮肤",
    "condition": "normalizeLayoutConfig白名单与告警；区域/槽位/块覆盖，未知项不渲染。消费者应用时机见client applyLayout*，热刷新边界待核。",
    "status": "契约全量字段展开；运行刷新待核"
  },
  {
    "key": "layout-config.blocks.media.bg",
    "kind": "layout-file",
    "group": "appearance",
    "advanced": true,
    "default": "无覆盖/源皮肤",
    "condition": "normalizeLayoutConfig白名单与告警；区域/槽位/块覆盖，未知项不渲染。消费者应用时机见client applyLayout*，热刷新边界待核。",
    "status": "契约全量字段展开；运行刷新待核"
  },
  {
    "key": "layout-config.blocks.empty.style",
    "kind": "layout-file",
    "group": "appearance",
    "advanced": true,
    "default": "无覆盖/源皮肤",
    "condition": "normalizeLayoutConfig白名单与告警；区域/槽位/块覆盖，未知项不渲染。消费者应用时机见client applyLayout*，热刷新边界待核。",
    "status": "契约全量字段展开；运行刷新待核"
  },
  {
    "key": "layout-config.blocks.empty.bg",
    "kind": "layout-file",
    "group": "appearance",
    "advanced": true,
    "default": "无覆盖/源皮肤",
    "condition": "normalizeLayoutConfig白名单与告警；区域/槽位/块覆盖，未知项不渲染。消费者应用时机见client applyLayout*，热刷新边界待核。",
    "status": "契约全量字段展开；运行刷新待核"
  },
  {
    "key": "hubMechanicalProcedureFeedEnabled",
    "kind": "historical-config",
    "group": "advanced",
    "advanced": true,
    "default": "当前无默认",
    "condition": "已移除/无当前宿主读取；pythonGpu区别于浏览器pyGpu安装偏好。",
    "status": "基线历史"
  },
  {
    "key": "pythonGpu",
    "kind": "historical-config",
    "group": "advanced",
    "advanced": true,
    "default": "当前无默认",
    "condition": "已移除/无当前宿主读取；pythonGpu区别于浏览器pyGpu安装偏好。",
    "status": "基线历史"
  },
  {
    "key": "syncDir",
    "kind": "runtime-compat-config",
    "group": "advanced",
    "advanced": true,
    "default": "空",
    "condition": "syncTo参数优先，否则兼容读取this.config.syncDir；/config白名单不含，不新增假设置控件。",
    "status": "源码读取/白名单核对"
  },
  {
    "key": "workbenchGreetLoop",
    "kind": "runtime-compat-config",
    "group": "advanced",
    "advanced": true,
    "default": "10",
    "condition": "旧任务换代兼容回落，>=2；短/长期轴已有新键；/config不接受新写入。",
    "status": "源码读取/白名单核对"
  },
  {
    "key": "embeddingCacheV2Enabled",
    "kind": "runtime-compat-config",
    "group": "advanced",
    "advanced": true,
    "default": "True",
    "condition": "C2 engineIdentityGate读取!==false；不是当前默认/保存白名单键，需评审接线后才能提供编辑。",
    "status": "源码读取/白名单核对"
  },
  {
    "key": "indexDeltaSyncEnabled",
    "kind": "runtime-compat-config",
    "group": "advanced",
    "advanced": true,
    "default": "True",
    "condition": "C2 crossIdReuse读取!==false；不是当前默认/保存白名单键，需评审接线后才能提供编辑。",
    "status": "源码读取/白名单核对"
  },
  {
    "key": "embedding-config.activationEmitMode",
    "kind": "semantic-file",
    "group": "find",
    "advanced": false,
    "default": "shadow",
    "condition": "assoc/inbox及当前引擎链路就绪；shadow仅观察，canary-explicit仅显式回忆车道，active放行相关emit；快照/工具读取独立。",
    "status": "独立接口源码核对"
  },
  {
    "key": "embedding-config.activationPolicy",
    "kind": "semantic-file",
    "group": "advanced",
    "advanced": true,
    "default": "{\"mode\": \"shadow\", \"tOn\": 0.62, \"tOff\": 0.52, \"cooldownObs\": 3, \"maxCandidates\": 8, \"ttlSteps\": 3, \"w\": {\"top\": 0.6, \"margin\": 0.15, \"evidence\": 0.1, \"recency\": 0.15, \"toolFail\": 0.05}, \"levelBands\": [[0.75, \"excerpt\"], [0.0, \"hint\"]]}",
    "condition": "见实际worker/安装消费者；activationPolicy是退休v1校准通道参数，不是正式用户投递控制。精确重载/默认钳制待核。",
    "status": "文件键已枚举/精确生效待核"
  },
  {
    "key": "embedding-config.activationPolicy.cooldownObs",
    "kind": "semantic-file",
    "group": "advanced",
    "advanced": true,
    "default": "3",
    "condition": "见实际worker/安装消费者；activationPolicy是退休v1校准通道参数，不是正式用户投递控制。精确重载/默认钳制待核。",
    "status": "文件键已枚举/精确生效待核"
  },
  {
    "key": "embedding-config.activationPolicy.levelBands",
    "kind": "semantic-file",
    "group": "advanced",
    "advanced": true,
    "default": "[[0.75, \"excerpt\"], [0.0, \"hint\"]]",
    "condition": "见实际worker/安装消费者；activationPolicy是退休v1校准通道参数，不是正式用户投递控制。精确重载/默认钳制待核。",
    "status": "文件键已枚举/精确生效待核"
  },
  {
    "key": "embedding-config.activationPolicy.maxCandidates",
    "kind": "semantic-file",
    "group": "advanced",
    "advanced": true,
    "default": "8",
    "condition": "见实际worker/安装消费者；activationPolicy是退休v1校准通道参数，不是正式用户投递控制。精确重载/默认钳制待核。",
    "status": "文件键已枚举/精确生效待核"
  },
  {
    "key": "embedding-config.activationPolicy.mode",
    "kind": "semantic-file",
    "group": "advanced",
    "advanced": true,
    "default": "shadow",
    "condition": "见实际worker/安装消费者；activationPolicy是退休v1校准通道参数，不是正式用户投递控制。精确重载/默认钳制待核。",
    "status": "文件键已枚举/精确生效待核"
  },
  {
    "key": "embedding-config.activationPolicy.tOff",
    "kind": "semantic-file",
    "group": "advanced",
    "advanced": true,
    "default": "0.52",
    "condition": "见实际worker/安装消费者；activationPolicy是退休v1校准通道参数，不是正式用户投递控制。精确重载/默认钳制待核。",
    "status": "文件键已枚举/精确生效待核"
  },
  {
    "key": "embedding-config.activationPolicy.tOn",
    "kind": "semantic-file",
    "group": "advanced",
    "advanced": true,
    "default": "0.62",
    "condition": "见实际worker/安装消费者；activationPolicy是退休v1校准通道参数，不是正式用户投递控制。精确重载/默认钳制待核。",
    "status": "文件键已枚举/精确生效待核"
  },
  {
    "key": "embedding-config.activationPolicy.ttlSteps",
    "kind": "semantic-file",
    "group": "advanced",
    "advanced": true,
    "default": "3",
    "condition": "见实际worker/安装消费者；activationPolicy是退休v1校准通道参数，不是正式用户投递控制。精确重载/默认钳制待核。",
    "status": "文件键已枚举/精确生效待核"
  },
  {
    "key": "embedding-config.activationPolicy.w",
    "kind": "semantic-file",
    "group": "advanced",
    "advanced": true,
    "default": "{\"top\": 0.6, \"margin\": 0.15, \"evidence\": 0.1, \"recency\": 0.15, \"toolFail\": 0.05}",
    "condition": "见实际worker/安装消费者；activationPolicy是退休v1校准通道参数，不是正式用户投递控制。精确重载/默认钳制待核。",
    "status": "文件键已枚举/精确生效待核"
  },
  {
    "key": "embedding-config.activationPolicy.w.evidence",
    "kind": "semantic-file",
    "group": "advanced",
    "advanced": true,
    "default": "0.1",
    "condition": "见实际worker/安装消费者；activationPolicy是退休v1校准通道参数，不是正式用户投递控制。精确重载/默认钳制待核。",
    "status": "文件键已枚举/精确生效待核"
  },
  {
    "key": "embedding-config.activationPolicy.w.margin",
    "kind": "semantic-file",
    "group": "advanced",
    "advanced": true,
    "default": "0.15",
    "condition": "见实际worker/安装消费者；activationPolicy是退休v1校准通道参数，不是正式用户投递控制。精确重载/默认钳制待核。",
    "status": "文件键已枚举/精确生效待核"
  },
  {
    "key": "embedding-config.activationPolicy.w.recency",
    "kind": "semantic-file",
    "group": "advanced",
    "advanced": true,
    "default": "0.15",
    "condition": "见实际worker/安装消费者；activationPolicy是退休v1校准通道参数，不是正式用户投递控制。精确重载/默认钳制待核。",
    "status": "文件键已枚举/精确生效待核"
  },
  {
    "key": "embedding-config.activationPolicy.w.toolFail",
    "kind": "semantic-file",
    "group": "advanced",
    "advanced": true,
    "default": "0.05",
    "condition": "见实际worker/安装消费者；activationPolicy是退休v1校准通道参数，不是正式用户投递控制。精确重载/默认钳制待核。",
    "status": "文件键已枚举/精确生效待核"
  },
  {
    "key": "embedding-config.activationPolicy.w.top",
    "kind": "semantic-file",
    "group": "advanced",
    "advanced": true,
    "default": "0.6",
    "condition": "见实际worker/安装消费者；activationPolicy是退休v1校准通道参数，不是正式用户投递控制。精确重载/默认钳制待核。",
    "status": "文件键已枚举/精确生效待核"
  },
  {
    "key": "embedding-config.dimension",
    "kind": "semantic-file",
    "group": "advanced",
    "advanced": true,
    "default": "1024",
    "condition": "见实际worker/安装消费者；activationPolicy是退休v1校准通道参数，不是正式用户投递控制。精确重载/默认钳制待核。",
    "status": "文件键已枚举/精确生效待核"
  },
  {
    "key": "embedding-config.gpu",
    "kind": "semantic-file",
    "group": "advanced",
    "advanced": true,
    "default": "安装请求默认false；worker消费待核",
    "condition": "见实际worker/安装消费者；activationPolicy是退休v1校准通道参数，不是正式用户投递控制。精确重载/默认钳制待核。",
    "status": "文件键已枚举/精确生效待核"
  },
  {
    "key": "embedding-config.lexicalStopwords",
    "kind": "semantic-file",
    "group": "advanced",
    "advanced": true,
    "default": "[]",
    "condition": "见实际worker/安装消费者；activationPolicy是退休v1校准通道参数，不是正式用户投递控制。精确重载/默认钳制待核。",
    "status": "文件键已枚举/精确生效待核"
  },
  {
    "key": "embedding-config.modelDir",
    "kind": "semantic-file",
    "group": "advanced",
    "advanced": true,
    "default": "必填/未配置",
    "condition": "见实际worker/安装消费者；activationPolicy是退休v1校准通道参数，不是正式用户投递控制。精确重载/默认钳制待核。",
    "status": "文件键已枚举/精确生效待核"
  },
  {
    "key": "embedding-config.modelRevision",
    "kind": "semantic-file",
    "group": "advanced",
    "advanced": true,
    "default": "空/identity回落hash",
    "condition": "见实际worker/安装消费者；activationPolicy是退休v1校准通道参数，不是正式用户投递控制。精确重载/默认钳制待核。",
    "status": "文件键已枚举/精确生效待核"
  },
  {
    "key": "embedding-config.onnxFile",
    "kind": "semantic-file",
    "group": "advanced",
    "advanced": true,
    "default": "onnx/model_int8.onnx",
    "condition": "见实际worker/安装消费者；activationPolicy是退休v1校准通道参数，不是正式用户投递控制。精确重载/默认钳制待核。",
    "status": "文件键已枚举/精确生效待核"
  },
  {
    "key": "embedding-config.provider",
    "kind": "semantic-file",
    "group": "advanced",
    "advanced": true,
    "default": "空/未配置",
    "condition": "见实际worker/安装消费者；activationPolicy是退休v1校准通道参数，不是正式用户投递控制。精确重载/默认钳制待核。",
    "status": "文件键已枚举/精确生效待核"
  },
  {
    "key": "embedding-config.search",
    "kind": "semantic-file",
    "group": "advanced",
    "advanced": true,
    "default": "{\"mode\": \"hybrid\", \"wDense\": 0.7}",
    "condition": "见实际worker/安装消费者；activationPolicy是退休v1校准通道参数，不是正式用户投递控制。精确重载/默认钳制待核。",
    "status": "文件键已枚举/精确生效待核"
  },
  {
    "key": "embedding-config.search.mode",
    "kind": "semantic-file",
    "group": "advanced",
    "advanced": true,
    "default": "hybrid",
    "condition": "见实际worker/安装消费者；activationPolicy是退休v1校准通道参数，不是正式用户投递控制。精确重载/默认钳制待核。",
    "status": "文件键已枚举/精确生效待核"
  },
  {
    "key": "embedding-config.search.wDense",
    "kind": "semantic-file",
    "group": "advanced",
    "advanced": true,
    "default": "0.7",
    "condition": "见实际worker/安装消费者；activationPolicy是退休v1校准通道参数，不是正式用户投递控制。精确重载/默认钳制待核。",
    "status": "文件键已枚举/精确生效待核"
  },
  {
    "key": "embedding-config.torchThreads",
    "kind": "semantic-file",
    "group": "advanced",
    "advanced": true,
    "default": "16",
    "condition": "见实际worker/安装消费者；activationPolicy是退休v1校准通道参数，不是正式用户投递控制。精确重载/默认钳制待核。",
    "status": "文件键已枚举/精确生效待核"
  }
]
