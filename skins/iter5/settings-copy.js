    // Plain-language presentation only. Configuration keys and handlers stay upstream-owned.
    function iter5SettingCopy(label) {
      var rows = {
        fEpisodicMin: ['至少几段对话才形成经历记录', 'Minimum conversation segments per episode', '太少容易留下琐碎内容，太多可能跳过短对话。通常无需调整。', 'Too few can retain trivial content; too many can skip short conversations. Usually unchanged.'],
        fEpisodicRet: ['最多保留多少条经历', 'Maximum stored episodes', '超过上限时淘汰最旧的经历记录。', 'The oldest episodes are removed when the limit is exceeded.'],
        fFactRetention: ['最多保留多少条事实', 'Maximum stored facts', '超过后优先淘汰已撤销、较旧的事实，重要内容最后淘汰。', 'Revoked and older facts are removed first when the limit is exceeded; important facts are removed last.'],
        fChildObs: ['也观察续接产生的分支会话', 'Observe continuation branches too', '让跨天续接等分支会话也参与记忆观察。', 'Includes branch sessions, such as continuations across days, in memory observation.'],
        fHandoffPlan: ['交给 AI 的白板长度（字符）', 'Whiteboard text supplied to AI (characters)', '限制每次提供的计划快照长度，超出截短；完整白板仍可单独查看。', 'Truncates the supplied plan snapshot at this length. The full whiteboard remains readable separately.'],
        fHandoffLedger: ['交给 AI 的交接记录长度（字符）', 'Handoff text supplied to AI (characters)', '限制最新一篇交接记录放进对话背景的长度。', 'Limits how much of the latest handoff note is supplied as conversation background.'],
        fPromptSections: ['选择交给 AI 的记忆内容类型', 'Choose which memory sections AI receives', '通常保持全部开启；关闭某一段，会让 AI 缺少对应背景或规则。', 'Usually keep all sections on. Disabling one removes its background or rules from the AI prompt.'],
        fPromptCustom: ['自定义给 AI 的记忆说明', 'Customize memory instructions for AI', '进阶用途：改写各层记忆的提示词。不确定时保留原文，可在编辑器恢复默认。', 'Advanced: edit the instructions for each memory layer. Keep the original when unsure; the editor can restore defaults.'],
        fWsDiscover: ['最多扫描多少个工作区', 'Maximum workspaces to scan', '按最近会话优先扫描；历史工作区很多、扫描较慢时可调小。', 'Scans recent workspaces first. Lower this when scanning many historical workspaces is slow.'],
        fMemFileIndex: ['生成供外部工具读取的文件目录', 'Generate a file index for external tools', '额外保存一份只读索引，会有少量磁盘读写；没有外部工具需要时可保持关闭。', 'Maintains an extra read-only index with a small disk I/O cost. Leave off if no external tool needs it.'],
        fAssocEngine: ['主动查找相关记忆', 'Find relevant memories automatically', '对话中寻找可能有用的旧记忆，可能消耗额外 token。是否交给 AI，还取决于下面的「找到后如何使用」。关闭并保存会清空观察数据，已保存的记忆正文保留。', 'Looks for useful past memories during a conversation and may use extra tokens. The next setting controls whether AI receives them. Saving this switch off clears observation data but preserves memory files.'],
        fEmitMode: ['找到后如何使用（立即生效）', 'How to use matches (saved immediately)', '「只观察」不会把找到的记忆交给 AI；「明确要求时」用于你主动要求回忆；「主动提供」用于所有通过判定的结果。需要先开启主动查找。', 'Observe only sends no matches to AI. On request supplies matches for explicit recall; proactive supplies all approved matches. Requires automatic memory lookup.'],
        semMode: ['用什么方式查找', 'How to search', '不确定时选「自动」。可用时按意思查找，否则按关键词查找；切换后立即保存，不用再点保存设置。', 'Choose Auto when unsure: search by meaning when available, otherwise by keywords. Changes save immediately.'],
        fAnchorIndex: ['启用记忆检查与修复', 'Enable memory checks and repair', '需要在「存储管理」检查、修复索引或联动删除记忆时开启；普通记忆读写与检索不依赖它。', 'Enable for index checks, repair and linked deletion in Storage. Ordinary reading, writing and search do not require it.'],
        fIncEmbed: ['只更新有变化的搜索索引', 'Update only changed search entries', '通常保持开启，减少重复计算；仅在排查索引问题时考虑关闭。', 'Usually keep this on to avoid repeated computation. Turn off only when investigating index problems.'],
        fJsCooldown: ['两次主动回忆的间隔（轮）', 'Minimum recall interval (turns)', '刚提供过记忆后，等待多久再尝试。调大可减少重复回忆；0 表示不等待。', 'Wait this long after supplying a memory before trying again. Increase to reduce repeated recall; 0 means no wait.'],
        fJsDelta: ['区分相似结果的严格程度', 'How clearly the best match must stand out', '最相关的两条记忆得分太接近时不提供。调大更谨慎，调小更容易触发；0 关闭这项过滤。', 'Skip matches when the top two scores are too close. Higher is more cautious; lower recalls more easily. 0 disables this filter.'],
        fJsExcerpt: ['每条回忆提供多少文字（字符）', 'Text supplied per recalled memory (characters)', '较短更省 token；较长能直接提供更多内容。AI 仍可按需读取全文。', 'Shorter excerpts use fewer tokens; longer ones provide more content directly. AI can still read the full memory when needed.'],
        fCandScheme: ['一次参考多少条候选记忆', 'Candidate memory preset', '平衡：3 条，每条 40 字符；广泛：6 条，每条 20 字符。只在需要微调回忆效果时更改。', 'Balanced: 3 × 40 characters. Broad: 6 × 20 characters. Change only to tune recall.'],
        fCandN: ['自定义候选数量（条）', 'Custom candidate count', '仅「自定义」方案使用，范围 1–8 条。', 'Used only by the Custom preset; accepts 1–8 entries.'],
        fReasoning: ['将模型的思考内容用于记忆观察', 'Observe model reasoning for memory', '开启后也观察模型提供的思考内容；保存后需要重启才生效。', 'Also observes reasoning content supplied by the model. Requires a restart after saving.'],
        fInject: ['让 AI 使用已有记忆', 'Give AI existing memories', '组装对话提示词时，把记忆内容作为背景交给 AI。开启会占用部分上下文和 token；这项本身不负责记录新内容。', 'Adds stored memory as background when building conversation prompts. Uses context space and tokens; this does not itself record new content.'],
        fBudget: ['每轮提供多少记忆（字符）', 'Memory supplied per turn (characters)', '限制交给 AI 的记忆文字量，不是硬盘容量。调小更省 token，调大能带入更多背景；超出的内容会截短。', 'Limits text supplied to AI, not disk storage. Lower uses fewer tokens; higher includes more background. Excess text is truncated.'],
        fDays: ['带入最近几天的日志', 'Recent log days to include', '会话开始时读取最近这些天的日志末尾。需要更多近期背景时增加。', 'Includes the ends of recent daily logs at session start. Increase for more recent background.'],
        fTier0Catalog: ['先给 AI 一份记忆目录', 'Give AI a memory overview', '每轮提供条目名称和一句话摘要，方便 AI 再按需读取详情。关闭可减少这部分 token。', 'Supplies titles and short summaries each turn so AI can read details as needed. Turning off saves these tokens.'],
        fTier0Max: ['记忆目录长度上限（token）', 'Memory overview limit (tokens)', '只限制目录摘要的长度，实际还受总记忆预算限制。token 是模型计算文本用量的单位。', 'Limits the overview only; the total memory budget also applies. Tokens measure model text usage.'],
        fRulesLayering: ['单独保留规则类记忆', 'Keep rules in a separate section', '把规则独立放入每轮背景，避免和普通记忆一起被裁剪。通常保持开启。', 'Keeps rules in a separate section each turn so they are not trimmed with ordinary memories. Usually leave on.'],
        fExtBudget: ['外部记忆文字上限（字符）', 'External memory limit (characters)', '限制外部来源交给 AI 的文字量。主要使用本插件记忆时通常无需调整。', 'Limits text supplied from external sources. Usually unchanged when using only this plugin.'],
        fSnapGap: ['更新对话记忆的最小间隔（轮）', 'Minimum memory refresh interval (turns)', '记忆内容发生变化后，至少隔这些轮数再追加一次；减少反复追加造成的上下文膨胀。', 'After memory changes, wait this many turns before adding a new snapshot to avoid repeated context growth.'],
        fReinjectOnCompact: ['对话被压缩后补回记忆', 'Restore memory after context compression', '对话太长而被压缩后，立即重新提供一次记忆背景。通常保持开启。', 'Supplies memory background again after a long conversation is compressed. Usually leave on.'],
        fAutoConsolidate: ['自动记录对话要点', 'Automatically record conversation highlights', '对话结束后按间隔与每日额度调用 AI 评估，把值得保留的内容写入今日日志；会产生模型调用。', 'Uses AI after turns, subject to the interval and daily limit, to assess useful content and write daily logs. Uses model calls.'],
        fConsolidate: ['自动记录的最小间隔（分钟）', 'Minimum recording interval (minutes)', '两次自动记录之间至少等待多久。间隔越长，调用越少；非工作时间还会自动延长。', 'Minimum wait between automatic recordings. Longer intervals mean fewer calls; off-hours extend the interval further.'],
        fConsolidateMax: ['每天最多自动记录几次', 'Maximum automatic recordings per day', '达到额度后，当天停止自动记录。适合控制这项功能的模型调用次数。', 'Stops automatic recording for the day once reached. Controls model calls from this feature.'],
        fConsolidateMin: ['跳过过短的对话（字符）', 'Skip short turns (characters)', '本轮用户与 AI 的文字总量低于此值时不做自动记录，避免保存寒暄。', 'Skips automatic recording when user and AI text together is below this length.'],
        fNoteCap: ['项目笔记容量（字符）', 'Project note capacity (characters)', '控制保存的笔记大小，和每轮交给 AI 的文字量不同。超出后压缩为要点，必要时将原文归档。', 'Controls stored note size, separate from text supplied per turn. Excess content is condensed or archived.'],
        fUserCap: ['跨项目记忆容量（字符）', 'Cross-project memory capacity (characters)', '控制跨项目规则和偏好的文件大小；超出后整理或归档。', 'Controls the file size of cross-project rules and preferences; excess content is consolidated or archived.'],
        fMemoryHub: ['从经历中积累事实和流程', 'Build facts and workflows from experience', '启用记忆中枢，整理经历、事实和可复用流程。关闭后保留已有内容，停止这部分新记忆积累。', 'Enables Memory Hub processing for episodes, facts and reusable workflows. Turning off keeps existing content and stops new accumulation through the hub.'],
        fProcInject: ['记录并使用可复用流程', 'Record and use reusable workflows', '关闭后既不写入流程记忆，也不把流程交给 AI 参考。', 'Turning off stops both writing workflow memories and supplying them to AI.'],
        fProcSessions: ['至少在几个会话中验证过', 'Minimum separate sessions', '同一流程在多个独立会话中出现后，才考虑收为可复用技能。', 'A workflow must appear in this many separate sessions before skill promotion is considered.'],
        fProcSuccess: ['至少成功几次', 'Minimum successful uses', '流程达到这个成功次数，才满足收为技能的条件之一。', 'The workflow must succeed this many times as one of the conditions for promotion.'],
        fProcCorr: ['允许的错误或纠正比例', 'Maximum error or correction ratio', '例如 0.3 表示 30%；超过后继续观察，暂不收为技能。', 'For example, 0.3 means 30%. Above this, the workflow remains under observation.'],
        fProcRisk: ['高风险流程需你批准', 'Require approval for high-risk workflows', '涉及部署、删除等高风险流程，收为技能前需你批准；不会仅凭相似度自动执行。', 'High-risk workflows such as deployment or deletion need approval before promotion and never execute on similarity alone.'],
        fProcLevel: ['给 AI 的流程说明有多详细', 'Workflow detail supplied to AI', '可提供完整步骤、摘要或仅提示参考；高风险流程只给参考提示。', 'Choose full steps, a summary or a reference hint. High-risk workflows use hints only.'],
        fHandoff: ['保存任务交接材料', 'Keep task handoff notes', '用白板和交接记录保存计划、进展与下一步，方便长对话换窗口后继续。可在「白板」查看。', 'Keeps plans, progress and next steps in the whiteboard and handoff notes for continuing long tasks. View them in Whiteboard.'],
        fAutoContinue: ['对话快满时询问是否换新会话', 'Offer a new session when context is nearly full', '达到阈值后显示确认卡；同意或无人值守倒计时结束后接续到新会话；沿用工作区、模型和思考档位。此功能仍在测试。', 'Shows a confirmation card at the threshold. Continues after approval or the unattended countdown, keeping workspace, model and reasoning effort. Still experimental.'],
        fWaterThreshold: ['何时准备交接（占比）', 'When to prepare a handoff (ratio)', '例如 0.75 表示上下文使用达到 75% 时准备交接材料与建议。', 'For example, 0.75 prepares handoff notes and advice at 75% context usage.'],
        fWaterWindow: ['上下文估算窗口（token）', 'Estimated context window (tokens)', '用于估算对话空间；按所用模型调整，0 自动检测模型窗口。通常不必手动修改。', 'Used to estimate conversation space. Match it to your model; 0 auto-detects the model window. Usually no manual change is needed.'],
        fWaterAdvisory: ['提醒 AI 准备交接', 'Ask AI to prepare a handoff', '对话空间超过阈值时，提醒 AI 更新白板和交接记录。', 'Asks AI to update the whiteboard and handoff notes when context passes the threshold.'],
        fWaterAuto: ['自动补一份基础交接记录', 'Create fallback handoff notes', '超过阈值时每个会话自动写一次基础记录，避免遗漏交接材料。', 'Writes one fallback record per session at the threshold so basic handoff material is available.'],
        fCriteriaGate: ['检查交接内容是否达到要求', 'Check handoff note quality', '白板和交接记录满足质量规则后才采纳，减少把未确认的推测保存为结论。', 'Accepts whiteboard and handoff sections only after quality checks, reducing unconfirmed conclusions.'],
        fAutoPopup: ['回来时自动打开记忆面板', 'Open memory panel when you return', '离开一段时间再回来时自动显示记忆面板；关闭后仍可手动打开。', 'Opens the memory panel when you return after being away. You can still open it manually when off.'],
        fAway: ['多久没操作算离开（分钟）', 'Inactivity before you are considered away (minutes)', '配合回归提示和自动弹窗使用。0 关闭离开检测与欢迎问候。', 'Used for return prompts and automatic popups. 0 disables away detection and greetings.'],
        fUnattended: ['批量任务免打扰', 'Quiet mode for unattended tasks', '适合夜间或批量运行：不提供欢迎语、行为提示和日历提醒，仍提供事实记忆。', 'For overnight or batch tasks: omits greetings, behavioral prompts and calendar reminders while keeping factual memory.'],
        fUnattendedAuto: ['非工作时间自动免打扰', 'Use quiet mode outside working hours', '在设定的非工作时间或检测到托管任务时自动进入免打扰；手动设置优先。', 'Automatically enters quiet mode outside working hours or for detected unattended tasks. Manual settings take priority.'],
        fConsSchedule: ['每天提炼长期记忆', 'Distill long-term memories daily', '到点读取近期日志，将长期有用的内容整理到项目笔记或跨项目记忆；需宿主在线，会调用模型。', 'Reads recent logs at the scheduled time and distills useful content into project or cross-project memory. Requires the host online and uses model calls.'],
        fConsScheduleTime: ['每天几点提炼（HH:MM）', 'Daily distillation time (HH:MM)', '例如 09:30；到点时 DSH 需要保持运行。', 'For example, 09:30. DSH must be running at that time.'],
        fConsScheduleDays: ['提炼最近几天的日志', 'Log days to distill', '只回看这些天的日志；天数越多，待处理内容通常越多。', 'Reads logs from these recent days. More days usually means more content to process.'],
        fMaintSchedule: ['每天整理超过 30 天的旧日志', 'Archive logs older than 30 days daily', '到点提炼并归档旧日志；没有符合条件的旧日志就跳过。', 'Distills and archives older logs at the scheduled time; skips when no eligible logs exist.'],
        fMaintScheduleTime: ['每天几点整理旧日志（HH:MM）', 'Daily archive time (HH:MM)', '例如 10:00；建议与长期记忆提炼时间错开，并保持 DSH 运行。', 'For example, 10:00. Keep DSH running and use a different time from long-term distillation.'],
        fMemoryRoot: ['全部工作区记忆保存在哪里', 'Where workspace memories are stored', '集中保存各工作区记忆，每个工作区一个子目录。更改前请确认目标位置可写，并了解原有记忆的迁移方式。', 'Stores each workspace in its own subdirectory. Before changing, check write access and the existing-memory migration behavior.'],
        fUserDir: ['跨项目规则与偏好的目录', 'Cross-project rules and preferences folder', '这里的记忆可跨项目使用；路径支持 ~，目录需要写入权限。', 'Memories here apply across projects. Paths support ~ and require write access.'],
        fProjectDir: ['工作区内的记忆目录名', 'Memory folder name inside a workspace', '相对于工作区的目录名，例如 .dsh-memory；通常无需修改。', 'A workspace-relative directory name such as .dsh-memory. Usually unchanged.'],
        fDayBoundary: ['每天从几点开始计日志（分钟）', 'Start of the log day (minutes after midnight)', '450 表示 07:30，480 表示 08:00，0 表示午夜。此前的凌晨记录归到前一天。', '450 means 07:30, 480 means 08:00, and 0 means midnight. Earlier records belong to the previous day.'],
        fFontSize: ['记忆面板字号（立即生效）', 'Memory panel text size (immediate)', '只调整记忆面板的本机字号；当前 DSH 设置页的字体和字号跟随 DSH 全局设置。', 'Changes memory panel text on this device. This DSH settings page follows the global DSH font and text size.'],
        fPanelPos: ['在哪里打开记忆', 'Where to show memory', '选择浮动窗口、会话页或两者；内容相同。立即生效，仅影响本机。', 'Choose the floating panel, session page or both. They share content. Applies immediately on this device.'],
        fExclude: ['不让 AI 使用的记忆来源', 'Memory sources AI should not use', '每行填写一个来源，可用记忆 ID、分类或文件路径；适合屏蔽错误或不适用的内容，不会因此删除原文件。', 'One source per line: a memory ID, category or path. Excludes unsuitable content without deleting its files.']
      }
      var key = Object.keys(rows).find(function (key) { return t(key) === label })
      if (!key) return null
      var r = rows[key]
      var summary=L(r[2], r[3])
      if(key==='fJsExcerpt')summary += L3(' 仅自定义方案生效；平衡为 3×40，广泛为 6×20。',' Custom only; Balanced uses 3×40 and Broad 6×20.',' カスタムのみ。標準は3×40、広範囲は6×20。')
      if(key==='fWaterThreshold')summary += L3(' 仅固定模式生效；自动模式按压缩参数计算。',' Fixed mode only; Auto derives this from compaction parameters.',' 固定モードのみ。自動では圧縮設定から計算します。')
      return { key: key, label: L(r[0], r[1]), summary: summary }
    }

    function iter5SettingsIntro(group) {
      var copy = {
        engine: L('这里决定如何找到旧记忆，以及找到后是否交给 AI。记录新内容请到「记录与使用」。', 'Choose how to find existing memories and whether AI receives them. Recording new content is under Record & use.'),
        memory: L('「使用已有记忆」负责读取，「自动记录对话要点」负责写入。两者独立，可按需要分别开启。', 'Using existing memory reads it; automatic recording writes new highlights. These are separate controls.'),
        appearance: L('调整显示方式与文件位置。当前设置页的字体和字号由 DSH 全局设置控制。', 'Adjust display preferences and file locations. This settings page uses the global DSH font and text size.'),
        behavior: L('长对话接续、免打扰和定时整理都在这里。接续会先询问你；定时任务需要 DSH 运行。', 'Configure long-session continuation, quiet mode and scheduled maintenance. Continuation asks first; scheduled work requires DSH running.')
      }
      return h('p', { className: 'i5-settings-intro' }, copy[group], ' ', L('除标有「立即生效」的选项外，修改后请点击底部保存。立即生效项不会被取消修改撤销；标有重启的设置保存后需重启。', 'Save at the bottom unless marked immediate. Discard does not undo immediate changes. Options marked restart require a restart after saving.'))
    }
