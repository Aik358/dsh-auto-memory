# Minervaowl7 上游 issue 全量抢救台账

> **事件**：贡献者 `Minervaowl7` 账号被 GitHub 封控（API 返回 404），其 **193 issue / 104 PR** 对象在仓库中全部不可访问。
> **抢救**：从本机 **473 个会话转录（1.1 GB）** + **4 份仓库副本** + **git 全历史（516 提交）** 系统性提取。
> **时间**：2026-10-15

## 一、结论

- **代码未被回滚**：他是 `origin/main` 历史实质部分（**146/516** 提交），PR#394/#420 merge 仍是祖先，v3.3.4 内容实测在位。
- **GitHub 侧对象已被平台抹除**：按号访问一律 404，`open_issues_count` 由 27 → 1。
- **本机抢救出 315 条编号台账**，其中 **68 条含完整元数据**（作者/时间/优先级）。

## 二、完整元数据条（68 条 · 来自封控前 API 实时快照）

| # | 作者 | 创建时间 | 标题 |
|---|---|---|---|
| 179 | Minervaowl7 | 10/02/2026 05:34:24 | [Bug][P1][F03] [Hold] 工作区目录键将分隔符与连字符折叠为同一值 |
| 201 | Minervaowl7 | 10/02/2026 05:38:55 | [Bug][P2][F26] [Hold] Python 文档 token 双重特殊包装与满块截断导致正文丢 token |
| 356 | yanghanwenzuishuai-ctrl | 10/13/2026 12:47:05 | 【Bug】左下角浮层半透明，深色模式下身后文字透过来完全看不清 |
| 357 | Minervaowl7 | 10/13/2026 13:51:22 | 建议：让修复和发布更容易复核，减少反复补漏 |
| 358 | qiling670-svg | 10/14/2026 02:43:58 | [Bug][P2] 记忆中枢点开已回收的子代理条目必报「历史加载失败：subagent is unavailable（subagent/not-found）」 |
| 359 | Minervaowl7 | 10/14/2026 03:56:14 | [Bug][P1] 技能改名清理旧导出目录可能删除用户附加资源 |
| 360 | Minervaowl7 | 10/14/2026 03:56:22 | [Bug][P1] active 技能升级高风险后未重新批准仍刷新导出 |
| 361 | Minervaowl7 | 10/14/2026 03:56:26 | [Bug][P1] facts 批处理绕过跨进程锁可能覆盖其他写者 |
| 362 | Minervaowl7 | 10/14/2026 03:56:30 | [Bug][P1] HTTP feed 掩盖最终提交失败且直接批错误分支类型不匹配 |
| 363 | Minervaowl7 | 10/14/2026 03:56:34 | [Bug][P2] 迁移门禁保留 global-flight 回退可借无关请求放行 |
| 364 | Minervaowl7 | 10/14/2026 03:56:38 | [Bug][P2] 团队 pull 缺 procedure/handoff 处理器却推进游标 |
| 365 | Minervaowl7 | 10/14/2026 03:56:42 | [Bug][P2] 群摘要部分输入分支未检查实际投递便确认游标 |
| 366 | Minervaowl7 | 10/14/2026 03:56:46 | [Bug][P2] 模型下载取消不能中断挂起的 fetch/read |
| 367 | Minervaowl7 | 10/14/2026 03:56:50 | [Bug][P2] hubAct 忽略 HTTP/error 字段可能把失败显示为 ok |
| 368 | Minervaowl7 | 10/14/2026 03:56:54 | [Test][P2] v3.3.3 Release 与同提交公开 smoke CI 结果需对齐 |
| 369 | Minervaowl7 | 10/14/2026 04:23:57 | [Bug][P1] 安装向导和下载完成回调可能覆盖已有损坏配置 |
| 370 | Minervaowl7 | 10/14/2026 04:24:03 | [Bug][P1] 团队响应体读取失败可能被确认成发送成功并出队 |
| 371 | Minervaowl7 | 10/14/2026 04:24:07 | [Bug][P1] 大小写敏感文件系统中不同路径共用 sidecar 和工作区身份 |
| 372 | Minervaowl7 | 10/14/2026 04:24:11 | [Bug][P2] JS 配置首建误把身份字符串当对象，缺失 provider 和 dimension |
| 373 | Minervaowl7 | 10/14/2026 04:24:19 | [Bug][P2] Python 语义检索生产同步和查询仅覆盖 Workspace，遗漏 User |
| 374 | Minervaowl7 | 10/14/2026 04:24:24 | [Bug][P2] L0 来源读取失败被当空内容并覆盖既有派生索引 |
| 375 | Minervaowl7 | 10/14/2026 04:24:29 | [Bug][P2] L0 持久向量索引有写入接线，但召回未消费磁盘向量 |
| 376 | Minervaowl7 | 10/14/2026 04:39:22 | [P1][UX] 前端启动初始化会将已有 active/canary 配置覆盖为 shadow |
| 377 | Minervaowl7 | 10/14/2026 04:39:29 | [P2][UX] 模型自动下载未尊重 lexical 模式与稍后提醒选择 |
| 378 | Minervaowl7 | 10/14/2026 04:39:33 | [P1][UX] smartRecall 全局复用在途 Promise，不同问题可能收到同一答案 |
| 379 | Minervaowl7 | 10/14/2026 04:39:37 | [P2][UX] GUI 搜索未绑定当前工作区，依赖全局最近活动上下文 |
| 380 | Minervaowl7 | 10/14/2026 04:39:42 | [P2][UX] 带 UTF-8 BOM 的记忆文件展开时字节偏移不一致 |
| 381 | Minervaowl7 | 10/14/2026 04:39:46 | [P2][UX] Python 设置向导首次检测失败后持续显示检测中且无法重试 |
| 382 | Minervaowl7 | 10/14/2026 04:39:50 | [P2][UX] 智能回忆候选先截取日志，User/项目记忆可能长期无法入选 |
| 383 | Minervaowl7 | 10/14/2026 04:54:28 | [P1][UX] 新版日历优先级枚举与解析器不一致，保存成功的日程不可见并可能被后续写入丢弃 |
| 384 | Minervaowl7 | 10/14/2026 04:54:32 | [P1][UX] 外部来源项目接入与移除未绑定当前会话，可能操作错误工作区 |
| 385 | Minervaowl7 | 10/14/2026 04:54:36 | [P2][UX] 同日期时间标题的日程缺少唯一标识，完成操作命中首条，删除会移除全部同名项 |
| 386 | Minervaowl7 | 10/14/2026 04:54:40 | [P2][UX] apiPost 将成功状态码下的 JSON 读取失败降级为空对象，未确认保存成功却清空草稿 |
| 387 | Minervaowl7 | 10/14/2026 04:54:45 | [P2][UX] 接入全部可用来源未跳过已接入项，重复点击会反复追加同一来源链接 |
| 388 | Minervaowl7 | 10/14/2026 04:54:49 | [P2][UX] 日历标题中的分隔符未转义，正常输入会被解析成备注并改变日程标题 |
| 389 | Minervaowl7 | 10/14/2026 04:54:54 | [P1][UX] 自动接续拒绝请求失败仍显示已跳过，宿主倒计时可能继续执行 |
| 390 | Minervaowl7 | 10/14/2026 04:54:58 | [P2][UX] 技能纠正容忍度无法设为合法的 0，输入后被回填为 30% |
| 391 | Minervaowl7 | 10/14/2026 04:55:02 | [P2][UX] 模型选择器永久缓存首次目录，提供方恢复或新增模型后重开仍不刷新 |
| 392 | Minervaowl7 | 10/14/2026 04:55:08 | [P2][UX][#289 残留] 手动接续迟到结果仍会把用户从新选中的会话拉走 |
| 393 | Minervaowl7 | 10/14/2026 04:55:11 | [P2][UX][#290 残留] 接续降级标志存入 lastOk 却被状态接口丢弃，前端警告不可达 |
| 394 | Minervaowl7 | 10/14/2026 04:57:54 | branch=codex/all-open-issues-20261014 \| fix: 最小处理开放 issue，保全写入与审批边界 |
| 395 | Minervaowl7 | 10/14/2026 05:11:36 | [P2][UX] 迁移导出提示留空使用默认目录，但服务端直接拒绝空路径 |
| 396 | Minervaowl7 | 10/14/2026 05:11:40 | [P2][UX] 选择 .dam-pack 文件按钮调用目录选择器，选中目录后导入预览失败 |
| 397 | Minervaowl7 | 10/14/2026 05:11:43 | [P2][UX] 迁移导入回执未展示部分写入、备份及日历失败，用户无法判断实际完成范围 |
| 398 | Minervaowl7 | 10/14/2026 05:11:47 | [P2][UX] 迁移导出遇到目录读取失败会静默漏打包，成功回执无缺失警告 |
| 399 | Minervaowl7 | 10/14/2026 05:11:51 | [P2][UX][检索溯源] full 格式和智能检索静默截取行首，命中位置及关键限定条件可能不在返回片段中 |
| 400 | Minervaowl7 | 10/14/2026 05:11:55 | [P1][UX][结论追溯] 智能检索未携带 retracted/superseded 状态，撤回旧结论可能再次作为普通证据进入回答 |
| 401 | Minervaowl7 | 10/14/2026 05:11:59 | [P2][UX] 智能检索仅按同来源行首 80 字去重，可能漏掉不同记录 |
| 402 | Minervaowl7 | 10/14/2026 05:12:12 | [P2][UX] 默认 L0 检索只匹配摘要标题，正文中的唯一文档标识可能无法召回 |
| 403 | Minervaowl7 | 10/14/2026 05:12:23 | [P2][UX][历史项目检索] 归档检索仅工具可用，GUI 无 scope 入口导致旧项目原始记录不可检索 |
| 404 | Minervaowl7 | 10/14/2026 05:12:28 | [P2][UX] 普通全文检索在相关度排序前提前截断匹配，后部强证据可能永远进不了结果 |
| 405 | Minervaowl7 | 10/14/2026 05:12:33 | [P2][UX] 普通检索语义命中只输出8位短ID，无法直接调用expand核对原文 |
| 406 | Minervaowl7 | 10/14/2026 05:12:38 | [P2][UX] 检索来源无法唯一定位，复制单条片段又丢失来源标题，影响证据追溯 |
| 407 | Minervaowl7 | 10/14/2026 05:26:20 | [P1][UX] 宿主记忆设置展开后底板透明、宿主内容叠显，并侵入窗口顶部区域 |
| 408 | Minervaowl7 | 10/14/2026 05:26:27 | [P2][UX] Python 安装引导用固定文件大小比例显示 96%，与向导 100% 状态冲突且不解释运行时故障 |
| 409 | Minervaowl7 | 10/14/2026 05:26:31 | [P2][UX] 重新打开 Python 安装向导不恢复在途任务轮询，进度可能停留在单次快照 |
| 410 | Minervaowl7 | 10/14/2026 05:26:34 | [P2][UX] Python 模型下载完成但配置写入失败被静默吞掉，向导缺少配置修复入口 |
| 411 | Minervaowl7 | 10/14/2026 05:26:39 | [P2][UX] Python 依赖安装完成后 GPU 偏好控件消失，无法通过向导调整或修复加速配置 |
| 412 | Minervaowl7 | 10/14/2026 05:52:56 | [Bug][P2][Python] memory_recall 默认 L0 的 Python 检索未建立冷启动索引，关闭自动联想时无法获得 C3 候选 |
| 413 | Minervaowl7 | 10/14/2026 05:52:59 | [Bug][P2][Python] 显式 Python 模式查询失败后跳过已就绪的 C2，降级链退化为纯词法 |
| 414 | Minervaowl7 | 10/14/2026 05:53:02 | [Bug][P2][Python] Python 重新检测未强制刷新，缓存与单飞行跨检测强度和配置代次混用 |
| 415 | Minervaowl7 | 10/14/2026 05:53:05 | [Bug][P2][Python] 安装配置更新与引擎卸载未协调长驻 Python worker，检测成功不能证明检索实例已更新 |
| 416 | Minervaowl7 | 10/14/2026 05:53:08 | [Bug][P2][Python] Python 运行时模型探测只认固定安装路径，与 worker 的有效 modelDir/配置来源不一致 |
| 417 | Minervaowl7 | 10/14/2026 05:53:10 | [Bug][P2][Python] 模型到 tokenizer 的阶段边界取消存在空窗，取消后新下载仍可挂起 |
| 418 | Minervaowl7 | 10/14/2026 05:53:13 | [Bug][P2][Python] tokenizer 网络失败清除已校验 ONNX，镜像重试和失败恢复被迫重复大文件下载 |
| 419 | Minervaowl7 | 10/14/2026 05:53:17 | [Bug][P3][Python] venv/依赖重试成功不清除旧 error，成功状态仍显示上一轮安装失败 |
| 420 | Minervaowl7 | 10/14/2026 09:09:27 | branch=codex/claimed-60-20261014 \| fix: 修复认领的 60 项 issue 与插件详情页设置展开 |
| 421 | lujfsd | 10/14/2026 09:19:19 | [BUG][P1]唤起注入模式手动修改为“canary-explicit” 后，重启后又会被重写回shadow |

## 三、全量编号台账（315 条）

| # | 标题 | 来源 |
|---|---|---|
| 1 | [Bug] 「已解决，过两天标完成」 client.js 注册 id 笔误导致面板拒载 + 注入块秒级时间戳击穿前缀缓存 | 会话台账 |
| 2 | 加载后dsh页面报错/[Bug] @a9i5k4/dsh-auto-memory client module fails to register via __ModuleLoader__.load | 会话台账 |
| 3 | lib/client.js registers wrong id ("@deepseek-ai/dsh-auto-memory") — breaks DSH startup with "Failed to load plugins" | 会话台账 |
| 4 | re Create new sub-issue in Aik358/dsh-auto-memory | 会话台账 |
| 5 | 签名系统与上下文友好的记忆结构优化通知 Notification Regarding Memory Structure Optimization for the Signature System and Context | 会话台账 |
| 6 | List dsh-auto-memory on DSH Directory? | 会话台账 |
| 7 | 每次打开左下角记忆窗口都要总结一次是完全没有必要的 | 会话台账 |
| 8 | [Bug] 工作区总览一直显示「未发现带记忆的工作区」— discoverWorkspaces 不匹配 zstd 压缩会话 session.jsonl.zstd | 会话台账 |
| 9 | [Feature] 记忆面板经常自动弹出:建议增加「自动弹出」开关并去掉暂离期间自动打开 | 会话台账 |
| 10 | `[Bug / Feature Request] Unattended mode breaker: mandatory "welcome back" + context injection destabilises long batch tasks | 会话台账 |
| 12 | fix(client): DSH Desktop 增强模式下面板半透明难读 + 遮挡侧边栏入口按钮 | 会话台账 |
| 14 | [Bug] semanticAssetProbe peer 路径错位：transformers 已装且推理可用，仍恒报"推理库缺失"，语义档卡在 c1 | 会话台账 |
| 15 | [Minor] Memory panel header shows stale hardcoded version "v0.1.23-ui" in 2.1.2 | 会话台账 |
| 16 | [Bug/兼容] 自动沉淀 100% 失效：consolidateTurn 读取的 agent.session.events 在当前 DSH Session 类中已不存在（应迁移到 snapshotEvents()/session/event 流） | 会话台账 |
| 17 | fix: session 事件读取兼容新版 DSH Session API（snapshotEvents 兜底），修复自动沉淀 100% 失效 | 会话台账 |
| 18 | Bug: /api/dsh-auto-memory/greet 500 error — body is not defined | 会话台账 |
| 19 | [BUGFIX] jsDecideCooldownRounds: allow 0 (no cooldown) in settings UI | 会话台账 |
| 20 | [BUG] npm 发布包缺失 python/ 目录，Python 语义引擎（C3 进阶档）完全不可用 | 会话台账 |
| 21 | 在 dsh-desktop 的插件中心无法使用 | 会话台账 |
| 22 | [Bug] 重型回合下自动沉淀 100% 失效：extractSessionMessages 的 2000 条截尾窗口被流式 chunk 洪流冲穿（empty text user=0） | 会话台账 |
| 23 | fix: extractSessionMessages 先过滤消息类事件再做 2000 条截尾，修复重型回合自动沉淀失效（empty text user=0） | 会话台账 |
| 25 | fix: 跨工作区总结采样按记忆活跃度排序，替代字母序 slice(0,8)——修复活跃工作区被空工作区挤出概览（今日工作恒显示 0 条） | 会话台账 |
| 26 | [Bug] 2.2.6 residual: subagent inflight leak blocks summarize; new DSH injection formats pollute episodes | 会话台账 |
| 27 | fix(python-setup): correct BGE-M3 model repo — wizard step 4 always HTTP 401 | 会话台账 |
| 28 | [Bug] C3 Python tier never starts: tokenizer files not downloaded (sidecar fails after a "successful" install) | 会话台账 |
| 29 | fix: 子代理巡检改用头帧解码，修复 Node 22 下巨型会话文件令宿主进程崩溃 | 会话台账 |
| 30 | [Bug] Procedural skill crystallization can never promote: episode candidates ship with an empty sourceMemoryIds and no successCriteria | 会话台账 |
| 31 | fix: parseModelWindowsPre 模型 id 字符类补斜杠，修复 provider 前缀式 id 的窗口被丢弃导致水位虚高误弹接续卡 | 会话台账 |
| 32 | fix: 会话模型扫描缓存不再无条件锁死空结果，修复新会话开局窗口取不到路由权威值 | 会话台账 |
| 33 | fix: 会话真实模型未知时不再按水位比例触发自动接续，把首轮判定推迟到轮末 | 会话台账 |
| 34 | fix(test): water-hard-trigger 导入守卫写死旧模块名 water-window-pre.js,自 v2.4.0 写入起恒红 43/44 | 会话台账 |
| 35 | [Bug] 自动接续:agree 路径绕过回合活跃防护,且执行后旧回合不被停止,新旧会话并行运行 | 会话台账 |
| 36 | #35 自动接续绕过防护 | 会话台账 |
| 38 | [Bug] 记忆笔记容量整理净增长：每轮整理 +10 字符（空 (文件头) 段被回写），最终所有写入被永久拒绝；replace 亦按旧文件额度计费 | 会话台账 |
| 39 | 升级dsh,报错 | 会话台账 |
| 40 | [Bug] welcomeTourEnabled=false 无效：欢迎向导仍自动弹出，且全屏浮层在移动端吞掉所有点击与滚动 | 会话台账 |
| 41 | gh_api写入路径验收 | 会话台账 |
| 42 | gh_api多token合并验收 | 会话台账 |
| 43 | channel test - will be closed | 会话台账 |
| 44 | fix(capacity): 按最终序列化结果计费,整段归档 fsync+读回验证后才替换,replace 不再加旧文件额度 (issue #38) | 会话台账 |
| 45 | [Bug] memory_recall cannot reach records older than ~5 days: the 256-item L0 corpus cap silently drops older logs, all reflections and both MEMORY.md sources | 会话台账 |
| 46 | fix(tour): 欢迎向导自动弹出全链路等宿主配置,关闭真正结束,浮层移动端可退出 (issue #40) | 会话台账 |
| 48 | Line 96: ## 2. 未关闭 issue / PR 全景（15 条，2026-09-16 快照） | 会话台账 |
| 49 | fix(recall): 取消排名前的记录截断，旧日志/反思/项目笔记/用户记忆不再被 256 条预算挤出 (issue #45) | 会话台账 |
| 50 | fix(issue48): atomicReplace 补 Windows EPERM 退避重试 + 失败候选保全 + 写工具真实 isError | 会话台账 |
| 51 | [Bug] ws-overview-rank DATE_RE 未锚定，.dam-failed-* 恢复候选可能被误计入工作区活跃度 | 会话台账 |
| 52 | [Bug] 子代理模型选择被旧 cfg 覆盖:已删除模型无法切换/清空 | 会话台账 |
| 53 | fix(issue51): anchor workspace overview log-date matching | 会话台账 |
| 54 | [P0] 写入侧缺少保留语法过滤：单条含 MARKER_OPEN 的正文会使整个记忆文件永久拒写 | 会话台账 |
| 55 | `readSidecarPrev` 引用未定义的 `docStore`（只在 `:135`/`:169` 局部定义）⇒ 恒抛 ReferenceError 被 `:127` 吞 ⇒ 恒返 null ⇒ **「修复」按钮把 fresh 证据全翻 stale（功能反向）** | 会话台账 |
| 56 | `_appended.add(id)` 在写盘**之前**；写失败无 delete ⇒ 一次瞬时失败后同 id 重试恒被拒 = **证据静默丢失** | 会话台账 |
| 57 | fix(episodic-store): restore 不校验 data.current 形状，episodes.json 损坏后 consolidate 每次抛 TypeError、巩固链路停摆 | 会话台账 |
| 59 | fix(storage-manage): readSidecarPrev 活读 docStore，repair 不再 mint 新 epoch (issue #55) | 会话台账 |
| 60 | fix(evidence-store): 写失败回滚幂等登记，同 evidenceId 可重试 (issue #56) | 会话台账 |
| 61 | fix(episodic-store): restore 校验 current 形状，损坏时丢弃而非卡死巩固链路 (issue #57) | 会话台账 |
| 62 | fix(activation-host): 会话释放清理 per-runtime 激活态并按 sessionId 对齐删除键 (issue #58) | 会话台账 |
| 63 | [P0] memory-hub: episodic_candidate 逐行走 restore 整体覆写语义，一次 ingest 清空全部已巩固 episode 并落盘 | 会话台账 |
| 64 | [P0] index-sync: 页字节预算与帧行上限同为 256KiB 零余量 → 临界页必超 MAX_LINE_BYTES，Python worker fail-closed 退出、索引同步死循环 | 会话台账 |
| 65 | [P1] semantic-js: 下载镜像重试从半截残留续写、sha256 只对网络流累积 → 落位"半截源A+完整源B"拼接文件且校验通过 | 会话台账 |
| 66 | [P1] memory-writer/memory-anchor: BOM 文件偏移坐标系错位 3 字节 → 锚化写入损坏或恒 conflict，文件从语料/召回静默消失 | 会话台账 |
| 67 | [P1] fact-store: 冲突记录持 store 内活引用，merge 原地改写已展示/已落盘的冲突左侧（检测时值丢失） | 会话台账 |
| 68 | [P1] semantic-decide: normalizeText 分隔符"替换为空格" vs Python 参照"整删"，gram 集与训练词表分叉 → intent 判定车道翻转 | 会话台账 |
| 69 | [P2] m7-index-sync-host: currentEpoch 在 lazy spawn 之前采样 → 冷启动缓存 {epoch:null}：对空索引 worker 误判 ready、真 epoch 出现后白烧一次全量重同步 | 会话台账 |
| 70 | [P2] semantic-js: degraded 单向闩锁仅 _resetForTest 可清，且引导探针/档位解析不看 degraded → 引导报"✓就绪"而检索恒降级至重启 | 会话台账 |
| 71 | [P2] l0-extract: growToMin 先把空白压成空格、再按含换行的 SENTENCE_SPLIT_RE 切分 → 换行句界分支死代码，列表标记垃圾进入 L0/嵌入 | 会话台账 |
| 72 | [P2] python-sidecar-client: 入站 epoch 门 fail-open（epoch===null 放行一切）违背文件头契约；旧 .github.com/users/Aik358/orgs | 会话台账 |
| 73 | [P1] 测试套件腐坏：17 个 smoke 红 + python 测试 import 失效，且仓库无 test CI → 回归静默积累 | 会话台账 |
| 74 | [P3] 低危行为漂移打包：explicit 车道 fallback 恒假死分支（CB-5）、「最近N个月」月末缩窗（CB-6）、撤销后孪生 factId 被幂等标记吞掉（CB-7）、时间解析三连（CC-3） | 会话台账 |
| 75 | [P3] 低危时序打包：sidecar 延后写绑定"当时的 child"致旧 epoch 帧进新 worker（CC-9）、stepFor 自增器被 getter 式双调用压缩投递窗（CC-11） | 会话台账 |
| 77 | fix(episodic): episodic_candidate 改增量导入，一次 ingest 不再清空全部已巩固 episode（P0 数据丢失） | 会话台账 |
| 78 | fix(index-sync): 页字节预算为线帧信封留余量，消除临界页超限引发的同步死循环（P0） | 会话台账 |
| 79 | fix(semantic-js): 下载器每次镜像尝试前清空 tmp 残留，防拼接文件绕过校验落位（P1） | 会话台账 |
| 80 | fix(stores): repair 继承失效 / evidence 幂等缓存吞重试 / 冲突左侧活引用（三处数据完整性小修） | 会话台账 |
| 81 | chore: 移除误入版本库的 11 个 .bak 编辑备份 | 会话台账 |
| 82 | [P2] 配置读写链脱节：HTTP 处理器裸 readFileSync→writeFileSync 非原子无队列，loadConfig 损坏静默回落出厂默认 → 保存中途崩溃可无感重置全部记忆配置 | 会话台账 |
| 83 | [P2] 白板判据契约双实现：ledger-criteria.js 与 wb-contract.js 同名异体，smoke 锁只查 import 字符串 → 测试验证的是与生产不同的函数体 | 会话台账 |
| 84 | [P3] 诊断通道易失：事件环 ≤16 条 + opt-in stderr 行缺会话/观测 ID + unhandledRejection 全局吞噬无计数 → 崩溃即销毁现场 | 会话台账 |
| 85 | [P3] Python 侧车依赖供应链：pip 装 transformers/onnxruntime 零版本约束 + 镜像静默回退无留痕（附 transformers.js 3.x→4.3.0 评估） | 会话台账 |
| 86 | [P3] 卫生打包：rerank-host sha256Hex 实为 FNV-1a 同名异义、canonicalJson/dshHome/scanZstdFrames 多份实现、水位默认 0.75 五处内联 | 会话台账 |
| 87 | [Feature] Ship a reproducible recall-regression harness (python/bench is excluded from the npm package) | 会话台账 |
| 88 | [P1] 水位提示与「白板/账本待更新」催更注入块自上线从未触发：写入侧裸调落 default runtime、注入侧读 per-runtime state → 两类注入块双死；附带 pushPart 第5参 must 被静默丢弃 | 会话台账 |
| 89 | [P1] 设置页语义引擎安装向导：IIFE 内 var refreshSem 遮蔽模块级同名函数自递归爆栈被 .catch 吞 → 点「开始下载/取消」后进度状态永不刷新、轮询闸也永不启动 | 会话台账 |
| 90 | [P2] buildContinueCarry 白板/账本/转写按全局 default state.ws 解析 → 多工作区接续材料张冠李戴、转写包落错工作区（面板侧已修同类，此处漏修） | 会话台账 |
| 91 | [P2] client.js 面板交互三条：接续页外部来源陈旧闭包覆盖+loading 墓碑短路永久卡死、finishTour 硬编码 v2.1.0 且钉 seenVersion 致 3.0.0 说明永不送达、存储管理三联动删除无二次确认 | 会话台账 |
| 92 | [P2] 「同因修一半」残差两条：索引降级读取端 \|\| _lastIndexDegrade 全局兜底击穿跨会话隔离（写入端已分片）、memory-index 读 prev.version 而宿主缓存键为 sourceVersion（CB-2 残差） | 会话台账 |
| 93 | [P2] read 证据新鲜度只取 candidates[0] 的文件 digest → 多文件工具结果其余文件证据系统性漏记，stale 门只产假阳性不产真阳性 | 会话台账 |
| 94 | [P3] UX 低危打包：update-check 失败缓存 12h、PLAN 归档同秒覆盖无防撞、envelope 截断失实标注、jsDecide 冷却 \|\|5 吃 0+被拒烧窗、会话分片 Map 插入序淘汰最活跃会话、向导思维链「默认关」文案矛盾、接续倒计时小数秒 | 会话台账 |
| 95 | fix(index,client): 水位/催更注入块写入侧对齐 per-runtime 并修 pushPart must 丢失；安装向导 var 遮蔽自递归 (issues #88 #89) | 会话台账 |
| 96 | fix(index): 接续材料与转写包按被接续会话解析工作区，多窗口并行不再张冠李戴 (issue #90) | 会话台账 |
| 97 | fix(index,memory-index): 「同因修一半」残差两条——降级读取端全局兜底击穿跨会话隔离、buildIndex 版本键名与宿主缓存错位 (issue #92) | 会话台账 |
| 98 | fix(context-host): read 证据新鲜度按逐记录 sourceRef 解析 digest，多文件结果证据不再系统性漏记 (issue #93) | 会话台账 |
| 99 | fix(client): 面板交互三条——接续页外部来源永久卡死、更新说明卡钉死 v2.1.0、三联动删除无确认 (issue #91) | 会话台账 |
| 100 | fix(ux): 低危体验打包七条——update-check 失败缓存、PLAN 归档覆盖、envelope 失实标注、jsDecide 冷却、Map 淘汰序、向导文案、倒计时小数秒 (issue #94) | 会话台账 |
| 101 | Fix/restore smoke runner 20260921 | 会话台账 |
| 102 | [P2] 工作区发现硬编码上限 30：memory_recall 跨区检索/注入索引/工作区总览被静默截断；readFirstLine 整文件解压（附参数化 + 活跃度排序建议） | 会话台账 |
| 103 | [P1] 记忆中枢学习面停摆：judgement-shadow 是 256 行环形文件，宿主增量游标却用行数定位 ⇒ 写满后永久零新增且无降级留痕 | 会话台账 |
| 104 | [P1] 3.0.1 发布提交 53d20e7 把 issue #58 的会话释放清理回退成死码：_activationHost/_shadowHost 从未挂到 runtimes store（附一行修复 + 行为断言建议） | 会话台账 |
| 105 | [P1] Python 语义模型下载自 v2.1.5 起从未可用：对 WHATWG ReadableStream 调 .on() 且全程无 stream.write()，另缺 sha256（附 pipeline + 完整性校验建议） | 会话台账 |
| 106 | [P1] 发布产物 353 文件 / 23MB 中 88% 是非运行时内容，且含 6 个 .gitignore 自订规则禁止的 tracked .bak（附 files 负向排除建议） | 会话台账 |
| 107 | [P2] Python 侧车挂死无人收尸：health()/restart() 零调用方、熔断被每段成功帧清零、enabledKeys 退避是死码（附看门狗建议） | 会话台账 |
| 108 | [P2] 侧车 stderr 内容被结构性丢弃：只对外暴露 stderrTailBytes，Python traceback 永远看不到（附 fatal 时落 diag 建议） | 会话台账 |
| 109 | [P2] 冻结策略 JSON 双份入库（lib/policies ↔ python/policies）且零一致性锁：重标定只改一份即两侧激活决策分叉且无告警 | 会话台账 |
| 110 | [P2] 记忆中枢快照：默认路径逐行同步全量写盘 + 写失败 catch 静默 + facts 无 retention（附去抖/异步 + 降级留痕建议） | 会话台账 |
| 111 | [P2] 运维手册把使用者指向不存在的日志名与端点前缀：45 个已跟踪 docs 仍写 -pre，按手册取日志＝交出空文件 | 会话台账 |
| 112 | [P2] 冒烟套件非隔离：读真实 ~/.dsh 模型与 facts、顺序全量跑与单跑结论不同（m70/handoff 首跑红）⇒「回归全绿」不可判定 | 会话台账 |
| 113 | [P1][安全] webhook 验签默认关 + 事件名取自载荷：匿名伪造 @ 事件即用运维者 key 生成回复，且 AI_MAX_PER_HOUR 默认为「不限」 | 会话台账 |
| 114 | [P1][安全] webhook timer 入口两道鉴权均可被载荷短路：外部可唤起主分支带 secrets 的 workflow，且该作业每次运行清空反馈 gist | 会话台账 |
| 115 | [P2][安全] webhook ?report= / ?diag= 无需凭据即返回群聊原文 + 密钥形状（长度/头3/尾4）+ appId/ghToken 前缀，write=1 可匿名写 gist | 会话台账 |
| 116 | [P2][安全] RAW_DEBUG 默认开且采集早于验签：未验签流量即可把全量入站报文（含群成员聊天文本）灌进 gist | 会话台账 |
| 117 | [P3] v3.0.1 全仓只读审计遗留清单：生命周期/并发 5 项、可诊断性 6 项、结构与交付 11 项（逐条独立根因，请逐条取舍） | 会话台账 |
| 118 | fix(lifecycle): 恢复会话释放 host 回填 + 消费/生产双锁 (#104) | 会话台账 |
| 119 | base=main | 会话台账 |
| 120 | fix(python-setup): 重写模型下载链路 + 内容校验与坏产物清除 (#105) | 会话台账 |
| 121 | fix(packaging): 剔除非运行时负载与 .bak，加双向打包卫生锁 (#106) | 会话台账 |
| 122 | fix(sidecar): 超时看门狗 + 熔断闭合口径 + stderr 尾部可见 (#107 #108) | 会话台账 |
| 123 | feat(semantic-decide): 双份冻结策略的一致性对照与可见性 (#109) | 会话台账 |
| 124 | fix(memory-hub): 批内合并落盘收到批量入口层（HTTP action=feed 仍是 N 次全量写） (#110) | 会话台账 |
| 125 | docs(handbook,user-guide): 运维路径/前缀改为代码派生并加守卫 (#111) | 会话台账 |
| 126 | fix(webhook): 公网面四条默认值改 fail closed (#113 #114 #115 #116) | 会话台账 |
| 127 | 前半已修（`workspaceDiscoverMax` 默认 200，`index.js:585` 带 #102 注释）；**后半未动**：`readFirstLine` 仍在 `lib/index.js:6621` | 会话台账 |
| 129 | Fix/migrate pack safe import 20260922 | 会话台账 |
| 130 | fix(audit): runtime wiring, cleanup and download integrity | 会话台账 |
| 131 | ci(tests): fix four v3.1.4 smoke regressions | 会话台账 |
| 133 | fix(v3.1.4 审查): 契约口径矛盾、门禁留痕回退与三类守卫失效 | 会话台账 |
| 134 | [回归] #90 的接续工作区修复被 53d20e7 整块回退（含其回归守卫）⇒ v3.1.6 三条链环仍在，终端用户接续落错工作区 | 会话台账 |
| 135 | [Bug] 水位卡恒显示「0 / 1,000,000 token · 本会话尚未测量」：实测记录 10 分钟即当无数据 + 活会话不现场计量 + 未压缩日志分母静默降级（非 Windows 问题） | 会话台账 |
| 138 | fix(ci): 让 main 的 smoke 门禁转绿——补齐 v3.1.6 去 pre 改名的四类漏网 (issue #137) | 会话台账 |
| 139 | [P2] m70 G2「partial 行挂起等待补全」只在 CI 红、本地 6/6 绿 —— #138 修好 worker 路径后该断言才第一次被执行到（未复现，不下结论） | 会话台账 |
| 141 | test(m70): G2 framing 断言隔离真 worker 响应竞争并补熔断诊断 (issue #139) | 会话台账 |
| 142 | [Bug] 3.1.7 子代理日志回收导致 DSH 完整会话 ZIP 导出中断（Codex 排查与修复实测） | 会话台账 |
| 143 | feat(i18n): 记忆面板 UI 支持日语(ja)—— 新增 I18N.ja 与 L3() 第三分支 | 会话台账 |
| 144 | 子代理模型报 UNKNOWN_MODEL：agentOptions 未下发 provider；另有两处仍读已迁移的 settings.yaml | 会话台账 |
| 145 | [Bug] A slot entry on shell.overlay crashes on every startup (React error #300) | 会话台账 |
| 148 | [Bug] L0 标题未剥行内 [kind:*] 标记 ⇒ 每条带 kind 的日志都进 Tier-0 常驻目录（`kind:fact · …` 噪声，且目录不参与裁剪） | 会话台账 |
| 149 | [Bug] ???????? 0:???? data.channels,???????? data.stats ?(3.2.3/3.2.4 ???) | 会话台账 |
| 150 | feat(ui): 三套蓝白皮肤、独立明暗模式与全入口视觉统一 | 会话台账 |
| 151 | [Bug] #148 修复残留：短于 minChars(15) 的条目会走 growToMin 从原文重建，[kind:*] 标记重新漏进 L0 目录 | 会话台账 |
| 152 | [Bug] 增量嵌入开关保存后不生效：动态 getter 被构造时常量化 | 会话台账 |
| 153 | [Bug] #144 回退残留：新版 profile 解析失败，provider 与子代理实现名混用 | 会话台账 |
| 154 | [Bug] 自动接续双重创建失败后无工作区创建，将源材料投递到默认工作区 | 会话台账 |
| 155 | fix: 修复默认模型回退、接续工作区保护与增量开关 | 会话台账 |
| 156 | [Bug][Windows] 插件侧 sharp 与宿主 libvips-42.dll 同名冲突 → 发送图片 prompt 失败并被误报为 session/agent-busy | 会话台账 |
| 158 | fix: keep kind metadata out of short L0 summaries (#151) | 会话台账 |
| 159 | 缺 lib/semantic-js-process.js + semantic-js-worker.js；守卫 FAIL | 会话台账 |
| 160 | [Bug] UI data-loss and state-management defects | 会话台账 |
| 161 | fix(ui): resolve seven state-safety defects in #160 | 会话台账 |
| 162 | [Bug] sessions 兜底说明不可信：说明文字硬编码 + 降级记录是死代码（_degradePre 从未赋值） | 会话台账 |
| 164 | 共享白板的多会话局部更新与防覆盖机制 | 会话台账 |
| 165 | merge: 五批外部 PR 统一并入（#157 / #158 / #159 / #161 / #163） | 会话台账 |
| 166 | [发布卫生] npm 包内含 7 个 client.js 调试残留（约 14.97 MB），files 白名单未覆盖该命名 | 会话台账 |
| 168 | refactor: 清理未使用私有代码与重复测试 | 会话台账 |
| 169 | [Bug] normalizeGapRounds 作用域错误，快照与精简节奏设置修改时失败 | 会话台账 |
| 170 | [Bug] 发布过滤递归误删 lib/assets、lib/policies，造成3.2.7资源回归 | 会话台账 |
| 171 | [Bug] #66修复残留：BOM语料校验通过，正文仍从原buffer错位提取 | 会话台账 |
| 172 | [Bug] #110批路径残留：落盘失败漏记健康度，feed响应仍为deferred成功 | 会话台账 |
| 173 | [Bug] 子代理GC漏导入readdirSync，v4日志漏扫并可能误用旧mtime | 会话台账 |
| 174 | [Bug] 团队端到端接线缺失：配置注入、pull定时器及UI数据/动作未贯通 | 会话台账 |
| 175 | [Test] diagnostic-integrity 将时间戳中的39当成禁用文案，导致时钟相关假红 | 会话台账 |
| 176 | [Test] 两处边界/变异夹具未覆盖目标，异步用例提前计为通过 | 会话台账 |
| 177 | [Bug] Tier-0 常驻目录锚点切分错位一张：标题与结论错配（白板 / 笔记 / 账本同构受限） | 会话台账 |
| 178 | [Bug][P1][F01] 旧记忆折叠降级未完整归档即被容量护栏清空 | 会话台账 |
| 179 | [Bug][P1][F03] [Hold] 工作区目录键将分隔符与连字符折叠为同一值 | API快照 |
| 180 | [Bug][P1][F04] 工作区技能重载并集与消费端未过滤 scope | 会话台账 |
| 181 | [Bug][P1][F05] 纠正对象从全局最近 read/cite 推断且可额外惩罚另一记忆 | 会话台账 |
| 182 | [Bug][P1][F06/F31] 共享日历无时间条目不可解析，旧会话缓存读改写可覆盖他人记录 | 会话台账 |
| 183 | [Bug][P1][F07] 事实 supersede 在新候选事实性校验前撤销旧事实 | 会话台账 |
| 184 | [Bug][P1][F02] 调试中心挂载自动 POST 到可调用模型及写反思的真实业务端点 | 会话台账 |
| 185 | [Bug][P2][F08] TeamOutbox 首次 enqueue 前未加载磁盘旧队列 | 会话台账 |
| 186 | [Bug][P2][F09] 全局动态简报宿主装配、路径和会话分区接线不完整 | 会话台账 |
| 187 | [Bug][P2][F10] transfer-scope 路由在 const pid 初始化前读取 pid | 会话台账 |
| 188 | [Bug][P2][F11] 存储管理宿主路径字段与 manager 接口不一致 | 会话台账 |
| 189 | [Bug][P2][F12] 语义索引全局 rebuilding promise 合并不同 corpus 请求 | 会话台账 |
| 190 | [Bug][P2][F13] Tier 注入复用与投递索引使用不同 miv 算法域 | 会话台账 |
| 191 | [Bug][P2][F14] 召回提供 PLAN 与最新账本的 ID，但 expand 未扫描这些来源 | 会话台账 |
| 192 | [Bug][P2][F15] 激活包因 stale-index 丢弃后仍可能保留 claimed 并投递 | 会话台账 |
| 193 | [Bug][P1/P2][F16/F17] 硬溢出被普通接续阈值阻挡，preset 自适应又被预填默认值遮蔽 | 会话台账 |
| 194 | [Bug][P2][F18] 日文 hubScopeCounts 是序列化对象却被当函数调用 | 会话台账 |
| 195 | [Bug][P2][F19] 白板全文永久按卡片 ID 缓存，内容更新和失败均不失效 | 会话台账 |
| 196 | [Bug][P2][F20] 切换皮肤家族未通知挂载根，部分回调调用不存在的 setNonce | 会话台账 |
| 197 | [Bug][P2][F21] 设置页 Python 健康判定只认 ready 而后端产出 verified-ok | 会话台账 |
| 198 | [Bug][P2][F22] 更新安装结果读取版本调用了路由 this.readTextSafe | 会话台账 |
| 199 | [Bug][P2][F23] 新安装 workbenchStatus 对 null 状态直接读 greetCount | 会话台账 |
| 200 | [Bug][P2][F25] 外部 JSONL 按流块 split 丢跨块记录且限额不停止外层读取 | 会话台账 |
| 201 | [Bug][P2][F26] [Hold] Python 文档 token 双重特殊包装与满块截断导致正文丢 token | API快照 |
| 202 | [Bug][P2][F27] GPU 偏好写入配置但 ONNX provider 固定 CPU | 会话台账 |
| 203 | [Bug][P2][F28] 白板 sidecar 更新用空正文重建倒排但只恢复 entries | 会话台账 |
| 206 | Fix/audit data safety 20261002 | 会话台账 |
| 207 | 测试机审计待改进项#0 | 会话台账 |
| 208 | Restore runtime resources and fix Tier-0 boundaries #170 #177 | 会话台账 |
| 209 | Fix team integration and protect shared PLAN updates #174 #164 | 会话台账 |
| 210 | Make continuation and archive state durable (#207) | 会话台账 |
| 211 | Structural over-engineering: ~9k tokens/turn injection, 34.7k-line monoliths, 842 MB auto-provisioned runtime | 会话台账 |
| 212 | Fix seven residual data-safety and ownership issues | 会话台账 |
| 213 | Fix settings persistence, scoped drafts and runtime control feedback | 会话台账 |
| 215 | Refactor settings and navigation around approved V3 UI | 会话台账 |
| 216 | [Bug][P1] defineTool 不透传 items 致 Gemini/Vertex 会话每轮 HTTP 400；armAutoContinue 对子代理会话 arm 致接续卡反复报红 | 会话台账 |
| 217 | fix: defineTool 透传 spec.items（Gemini/Vertex 400）+ armAutoContinue 拒绝子代理会话 | 会话台账 |
| 218 | [Bug][P2] 多进程配置读改写丢更新，保存均返回成功 | 会话台账 |
| 221 | fix: serialize shared config transactions and generate prompt defaults | 会话台账 |
| 223 | 能否在「新版看板」(boardMode=graph) 下取消侧边栏的「记忆」按钮？ | 会话台账 |
| 224 | fix: integrate audited PRs and close twelve confirmed failures | 会话台账 |
| 225 | [Bug][P1] 笔记压缩用旧快照覆盖等待期间已成功追加的记录 | 会话台账 |
| 226 | [Bug][P1] 插件全局异常监听吞掉宿主致命异常，卸载后仍造成 smoke 假绿 | 会话台账 |
| 227 | [Bug][P1] 技能候选写盘失败仍返回 ok，memory_procedure 回复已写入 | 会话台账 |
| 228 | [Bug][P2] 本地文件接口仅检查字面路径，junction 可越过记忆目录边界 | 会话台账 |
| 229 | [Bug][P2] 皮肤安装名称允许点路径，可覆盖皮肤根目录外固定文件 | 会话台账 |
| 230 | fix: preserve concurrent memory writes and host failure semantics | 会话台账 |
| 231 | [Bug][P1] 技能归属迁移回滚将损坏 procedures.json 原件覆盖为空库 | 会话台账 |
| 233 | [Bug][P2] 设置路径校验拒绝 DSH_HOME 内有效的物理目录别名 | 会话台账 |
| 234 | [Bug][P2] 自动导出技能以宿主 cwd 标注适用项目，忽略调用会话项目 | 会话台账 |
| 235 | [Bug][P2] Python 下载向导接受不完整模型和非法 tokenizer 并报告 ready | 会话台账 |
| 237 | fix: 兼容 DeepCode 路径别名和移动端设置 UI | 会话台账 |
| 238 | [Bug][已复现] 点击「笔记」后记忆浮窗消失且无法重开：梦幻皮肤误标记并覆盖 fixed 定位 | 会话台账 |
| 240 | 25 文件 +619/−149 | 会话台账 |
| 243 | 37b31e11d8e5 | 会话台账 |
| 244 | 6a7f2d6159d5 | 会话台账 |
| 245 | fbab4b57ec03 | 会话台账 |
| 246 | 10 文件 +15076/−5 | 会话台账 |
| 247 | 7c0d61441ee4 | 会话台账 |
| 256 | 回复 issue + merge | 会话台账 |
| 262 | 355 文件 +22807 | 会话台账 |
| 269 | 观测+维护：OBS-01(#260) / OBS-02(#261) / MAINT-01(#254) / MAINT-02(#255) / #268 / #270 / #272\n | 会话台账 |
| 273 | 自研补充（PR 未覆盖） | 会话台账 |
| 279 | 观测+维护：OBS-01(#260) / OBS-02(#261) / MAINT-01(#254) / MAINT-02(#255) / #268 / #270 / #272 | 会话台账 |
| 282 | true/clean | 会话台账 |
| 284 | ## ★ 两个缺口（本道最有价值产出） | 会话台账 |
| 285 | true/clean | 会话台账 |
| 287 | true/clean | 会话台账 |
| 292 | 长用户请求跨接续保留（PR 标题，对应 #286 的延伸） | 会话台账 |
| 293 | 自动接续用 **30 秒活动时间窗**代替回合状态，长工具调用被误判空闲并取消 | 会话台账 |
| 296 | 接续**转写文件名截断来源 ID**，同秒生成材料会覆盖其他会话的第 3 层转写 | 会话台账 |
| 298 | 接续**模型继承失败后静默使用默认模型**，成功结果仍显示源模型 | 会话台账 |
| 299 | 接续状态**轮询的迟到/乱序响应**会拉走其他会话并恢复旧确认卡 | 会话台账 |
| 300 | （F03）工作区目录键将分隔符与连字符折叠为同一值 | 会话台账 |
| 301 | 自动记忆引擎检测弹窗使用 **content-box**，新版外观下横向越界 | 会话台账 |
| 309 | oldReflection | 会话台账 |
| 337 | [Bug][P1] 技能由 low 更新为 high 后保留 approved=true，可绕过人工批准直接激活 | 会话台账 |
| 338 | [Bug][P2] 技能 update 写盘失败后，同参数重试被 no-effective-change 提前截断 | 会话台账 |
| 339 | [Bug][P2] 修改 active 技能标题会新建导出目录，旧 SKILL.md 继续保留 | 会话台账 |
| 340 | [Bug][P2] memory_procedure 的 update 支持部分修改，但注册 schema 仍强制 title 和 steps | 会话台账 |
| 341 | [Bug][P2] 进程在创建 .lock.acquire 后退出，遗留门文件无法回收，后续写入持续超时 | 会话台账 |
| 344 | [Test][P2] 七个 smoke 用 URL.pathname 拼文件路径，中文目录下无法完成回归 | 会话台账 |
| 346 | [Test][P2] CRLF 正常检出仍触发五个 smoke 假失败，冻结源/ZIP 与变异锚串缺行尾约束 | 会话台账 |
| 347 | [Bug][P2] EvidenceEventStore 仅首次追加执行保留清理，连续写入突破 32MiB 上限 | 会话台账 |
| 348 | [Bug][P2] 群摘要原文回退只投递末8条，却确认整批反馈游标 | 会话台账 |
| 349 | [Bug][P1] 同会话切换模型后继续复用旧窗口缓存，水位与硬上限判定错误 | 会话台账 |
| 350 | [Test][P2] lb1-negative 有失败断言仍无条件 exit(0)，回归运行器误报通过 | 会话台账 |
| 356 | 【Bug】左下角浮层半透明，深色模式下身后文字透过来完全看不清 | API快照 |
| 357 | 建议：让修复和发布更容易复核，减少反复补漏 | API快照 |
| 358 | [Bug][P2] 记忆中枢点开已回收的子代理条目必报「历史加载失败：subagent is unavailable（subagent/not-found）」 | API快照 |
| 359 | [Bug][P1] 技能改名清理旧导出目录可能删除用户附加资源 | API快照 |
| 360 | [Bug][P1] active 技能升级高风险后未重新批准仍刷新导出 | API快照 |
| 361 | [Bug][P1] facts 批处理绕过跨进程锁可能覆盖其他写者 | API快照 |
| 362 | [Bug][P1] HTTP feed 掩盖最终提交失败且直接批错误分支类型不匹配 | API快照 |
| 363 | [Bug][P2] 迁移门禁保留 global-flight 回退可借无关请求放行 | API快照 |
| 364 | [Bug][P2] 团队 pull 缺 procedure/handoff 处理器却推进游标 | API快照 |
| 365 | [Bug][P2] 群摘要部分输入分支未检查实际投递便确认游标 | API快照 |
| 366 | [Bug][P2] 模型下载取消不能中断挂起的 fetch/read | API快照 |
| 367 | [Bug][P2] hubAct 忽略 HTTP/error 字段可能把失败显示为 ok | API快照 |
| 368 | [Test][P2] v3.3.3 Release 与同提交公开 smoke CI 结果需对齐 | API快照 |
| 369 | [Bug][P1] 安装向导和下载完成回调可能覆盖已有损坏配置 | API快照 |
| 370 | [Bug][P1] 团队响应体读取失败可能被确认成发送成功并出队 | API快照 |
| 371 | [Bug][P1] 大小写敏感文件系统中不同路径共用 sidecar 和工作区身份 | API快照 |
| 372 | [Bug][P2] JS 配置首建误把身份字符串当对象，缺失 provider 和 dimension | API快照 |
| 373 | [Bug][P2] Python 语义检索生产同步和查询仅覆盖 Workspace，遗漏 User | API快照 |
| 374 | [Bug][P2] L0 来源读取失败被当空内容并覆盖既有派生索引 | API快照 |
| 375 | [Bug][P2] L0 持久向量索引有写入接线，但召回未消费磁盘向量 | API快照 |
| 376 | [P1][UX] 前端启动初始化会将已有 active/canary 配置覆盖为 shadow | API快照 |
| 377 | [P2][UX] 模型自动下载未尊重 lexical 模式与稍后提醒选择 | API快照 |
| 378 | [P1][UX] smartRecall 全局复用在途 Promise，不同问题可能收到同一答案 | API快照 |
| 379 | [P2][UX] GUI 搜索未绑定当前工作区，依赖全局最近活动上下文 | API快照 |
| 380 | [P2][UX] 带 UTF-8 BOM 的记忆文件展开时字节偏移不一致 | API快照 |
| 381 | [P2][UX] Python 设置向导首次检测失败后持续显示检测中且无法重试 | API快照 |
| 382 | [P2][UX] 智能回忆候选先截取日志，User/项目记忆可能长期无法入选 | API快照 |
| 383 | [P1][UX] 新版日历优先级枚举与解析器不一致，保存成功的日程不可见并可能被后续写入丢弃 | API快照 |
| 384 | [P1][UX] 外部来源项目接入与移除未绑定当前会话，可能操作错误工作区 | API快照 |
| 385 | [P2][UX] 同日期时间标题的日程缺少唯一标识，完成操作命中首条，删除会移除全部同名项 | API快照 |
| 386 | [P2][UX] apiPost 将成功状态码下的 JSON 读取失败降级为空对象，未确认保存成功却清空草稿 | API快照 |
| 387 | [P2][UX] 接入全部可用来源未跳过已接入项，重复点击会反复追加同一来源链接 | API快照 |
| 388 | [P2][UX] 日历标题中的分隔符未转义，正常输入会被解析成备注并改变日程标题 | API快照 |
| 389 | [P1][UX] 自动接续拒绝请求失败仍显示已跳过，宿主倒计时可能继续执行 | API快照 |
| 390 | [P2][UX] 技能纠正容忍度无法设为合法的 0，输入后被回填为 30% | API快照 |
| 391 | [P2][UX] 模型选择器永久缓存首次目录，提供方恢复或新增模型后重开仍不刷新 | API快照 |
| 392 | [P2][UX][#289 残留] 手动接续迟到结果仍会把用户从新选中的会话拉走 | API快照 |
| 393 | [P2][UX][#290 残留] 接续降级标志存入 lastOk 却被状态接口丢弃，前端警告不可达 | API快照 |
| 394 | branch=codex/all-open-issues-20261014 \| fix: 最小处理开放 issue，保全写入与审批边界 | API快照 |
| 395 | [P2][UX] 迁移导出提示留空使用默认目录，但服务端直接拒绝空路径 | API快照 |
| 396 | [P2][UX] 选择 .dam-pack 文件按钮调用目录选择器，选中目录后导入预览失败 | API快照 |
| 397 | [P2][UX] 迁移导入回执未展示部分写入、备份及日历失败，用户无法判断实际完成范围 | API快照 |
| 398 | [P2][UX] 迁移导出遇到目录读取失败会静默漏打包，成功回执无缺失警告 | API快照 |
| 399 | [P2][UX][检索溯源] full 格式和智能检索静默截取行首，命中位置及关键限定条件可能不在返回片段中 | API快照 |
| 400 | [P1][UX][结论追溯] 智能检索未携带 retracted/superseded 状态，撤回旧结论可能再次作为普通证据进入回答 | API快照 |
| 401 | [P2][UX] 智能检索仅按同来源行首 80 字去重，可能漏掉不同记录 | API快照 |
| 402 | [P2][UX] 默认 L0 检索只匹配摘要标题，正文中的唯一文档标识可能无法召回 | API快照 |
| 403 | [P2][UX][历史项目检索] 归档检索仅工具可用，GUI 无 scope 入口导致旧项目原始记录不可检索 | API快照 |
| 404 | [P2][UX] 普通全文检索在相关度排序前提前截断匹配，后部强证据可能永远进不了结果 | API快照 |
| 405 | [P2][UX] 普通检索语义命中只输出8位短ID，无法直接调用expand核对原文 | API快照 |
| 406 | [P2][UX] 检索来源无法唯一定位，复制单条片段又丢失来源标题，影响证据追溯 | API快照 |
| 407 | [P1][UX] 宿主记忆设置展开后底板透明、宿主内容叠显，并侵入窗口顶部区域 | API快照 |
| 408 | [P2][UX] Python 安装引导用固定文件大小比例显示 96%，与向导 100% 状态冲突且不解释运行时故障 | API快照 |
| 409 | [P2][UX] 重新打开 Python 安装向导不恢复在途任务轮询，进度可能停留在单次快照 | API快照 |
| 410 | [P2][UX] Python 模型下载完成但配置写入失败被静默吞掉，向导缺少配置修复入口 | API快照 |
| 411 | [P2][UX] Python 依赖安装完成后 GPU 偏好控件消失，无法通过向导调整或修复加速配置 | API快照 |
| 412 | [Bug][P2][Python] memory_recall 默认 L0 的 Python 检索未建立冷启动索引，关闭自动联想时无法获得 C3 候选 | API快照 |
| 413 | [Bug][P2][Python] 显式 Python 模式查询失败后跳过已就绪的 C2，降级链退化为纯词法 | API快照 |
| 414 | [Bug][P2][Python] Python 重新检测未强制刷新，缓存与单飞行跨检测强度和配置代次混用 | API快照 |
| 415 | [Bug][P2][Python] 安装配置更新与引擎卸载未协调长驻 Python worker，检测成功不能证明检索实例已更新 | API快照 |
| 416 | [Bug][P2][Python] Python 运行时模型探测只认固定安装路径，与 worker 的有效 modelDir/配置来源不一致 | API快照 |
| 417 | [Bug][P2][Python] 模型到 tokenizer 的阶段边界取消存在空窗，取消后新下载仍可挂起 | API快照 |
| 418 | [Bug][P2][Python] tokenizer 网络失败清除已校验 ONNX，镜像重试和失败恢复被迫重复大文件下载 | API快照 |
| 419 | [Bug][P3][Python] venv/依赖重试成功不清除旧 error，成功状态仍显示上一轮安装失败 | API快照 |
| 420 | branch=codex/claimed-60-20261014 \| fix: 修复认领的 60 项 issue 与插件详情页设置展开 | API快照 |
| 421 | [BUG][P1]唤起注入模式手动修改为“canary-explicit” 后，重启后又会被重写回shadow | API快照 |
| 423 | `lib/index.js` | 会话台账 |
| 425 | `lib/index.js`, `lib/migrate-pack.js` | 会话台账 |