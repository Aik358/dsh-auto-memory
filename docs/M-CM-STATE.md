# M-CM 实施状态（免压缩过程档案）

> 用途：M-CM 长任务的实施过程档案。压缩后恢复工作**先读本文件 + [M-CM-PLAN.md](M-CM-PLAN.md) §7 排期**，再看 git log 最近提交。
> 规则：每完成一个可提交单元就更新本文件"进度账"并 commit（commits 已授权；push 待用户确认）。

## 当前阶段

**M-CM1 实施中**（2026-09-06 开工）。范围：四段式 ledger + PLAN.md 白板层 + 写入者①②（固化 prompt 层扩展 + memory_note kind 扩展）+ 注入片段 + 白板面板视图 + smoke 测试。

## 进度账

- [x] 规划与审计（M-CM-PLAN.md §0-§10，含回归审计对账表）
- [x] 实施步骤 1：读代码锚点（memory_note handler、GUIDANCE/静态纪律层、renderMemoryDynamic、resolvePaths、_doRefresh 装载器、DEFAULT_PROMPT_LAYERS）
- [x] 实施步骤 2：handoff 存储函数（writePlanSnapshot 归档/writeHandoffLedger 同秒 -b 后缀/readLatestHandoff 按 mtime）
- [x] 实施步骤 3：memory_note_pre 增 kind: handoff|plan（同 sanitizeForWrite 门禁;plan 走 replace 归档;不走项目笔记预算）
- [x] 实施步骤 4：renderMemoryStatic 增"交接与白板"纪律行（GUIDANCE 层不用动,静态层即固化纪律载体）
- [x] 实施步骤 5：注入片段（动态快照首位:snapshotPlanTitle→snapshotHandoffTitle→日志段;stripSensitiveSections+truncateHead 硬预算;handoffEnabled=false 隐藏）
- [x] 实施步骤 5.5：smoke-test-handoff-pre.mjs 22/22（G0 源码守卫/G1 时间戳/G2 白板归档/G3 账本最新篇/G4 注入行为);主套件+4 套 UI 回归全绿
- [x] 实施步骤 6：配置键已加(handoffEnabled/handoffPlanChars/handoffLedgerChars);设置页行随白板视图一起做
- [x] 实施步骤 7：面板「白板」视图（client.js PlanTab:当前全貌/版本切换/账本时间线,中英 i18n）+ handoff-state API（?file= 白名单限 handoff 目录）+ 路由守卫 34→35 ×3 文件
- [x] 实施步骤 8：live 验证（2026-09-06 浏览器实测:记忆入口恢复/白板页签渲染种入的 PLAN 全貌+账本时间线/handoff-state API enabled:true;0.1.2-rc.1 兼容事故修复后全链路通）
- [x] 实施步骤 8.5：M-CM2 已交付（memory_recall scope=all|handoff|sessions 三档路由+白板语料并入全量检索+设置页开关+smoke 30/30+live E2E）
- [ ] 实施步骤 9：push（待用户确认）
- [ ] M-CM3（降级为后续增强）：会话检索语义通道（sessionQuery 词法已够用,语义升档视成本）;M-CM4（水位感知）:需 host token 数据/压缩预告事件,开放问题待验证

**M-CM2 已交付（1 commit）**：recall scope 三档路由（handoff/sessions 早返轻量直返）+ searchHandoffCorpus（PLAN+最新账本+归档三语料,limit 预算）+ searchSessionHistory（sessionQuery 抽取复用）+ listHandoffLedgers + 设置页 handoffEnabled 开关（自动化分组,中英）+ smoke G5 断言（30/30 总）+ live E2E（种数据→白板渲染→API 返回）。

**⚡ 2026-09-06 harness 0.1.2-rc.1 兼容事故（已修复，身份迁移 commit）**：
- 症状：harness 更新重启后记忆插件入口/设置全消失（其他 @a9i5k4/@linxin666 插件正常）。
- 根因：**0.1.2-rc.1 把 `@deepseek-ai` 作用域保留给官方包——profile 解析的该作用域第三方 bundle（dsh-auto-memory、dsh-draw-gacha）被从浏览器组合加载（combo）剔除**；主机半边（webServer 注入路由）不受影响照常跑。诊断链：认证 token 每次重启更换（401 闸门）→ 大组合 URL 缺席 auto-memory → 直接路径 404（对所有人正常,新版只走 combo）→ 与 ark9canvas 逐字段对比清单无差异 → 按 package.json name 作用域排除。
- 修复：插件身份统一迁到发布身份 **@a9i5k4/dsh-auto-memory**（package.json name / cordis.patch.yml name / client loader id ×2+tag.dataset）;release.mjs 的 @deepseek-ai→@a9i5k4 转换变恒等但校验（§377 要求含 @a9i5k4）仍过。profile 挂载改 `@a9i5k4/dsh-auto-memory: link:D:/dsh-auto-memory` + bundles 同步。
- live 验证全过：记忆入口恢复/白板页签渲染（空态）/handoff-state API enabled:true。
- **待办**：①dsh-draw-gacha（用户另一插件,@deepseek-ai 作用域）同样中招,需同样改名;②token 每次重启更换（0.1.2-rc.1 认证闸门）,URL 以 dsh web 终端打印为准;③旧 @deepseek-ai junction 在 profile node_modules 残留（inert,可忽略）。

**测试调试备忘**：抽取函数时方法体引用的模块级符号（path/mkdir/writeFile/readdir/stat/existsSync/handoffStamp/nowHm）必须逐个注入 new Function 作用域;grab 用逐行扫描+(){} 混合配平（正则方案在 Bash 工具下反斜杠被吞）;CRLF 行尾注意。

## 关键代码锚点（已审计确认）

| 用途 | 锚点 |
|---|---|
| GUIDANCE 尾注层（order 10000） | lib/index.js:59-66；层文案 builder ≈:2026；promptLayerOverrides :161-163,1945 |
| memory_note handler（append/replace 双模, 8000/20 万） | lib/index.js:4774 |
| memory_log handler（2000/条） | lib/index.js:4755 |
| sanitizeForWrite | lib/index.js:3970 |
| renderMemoryDynamic 动态快照 | lib/index.js:1936（分层 :276/:289） |
| sessionQuery（host 会话检索, 关键词级） | lib/index.js:4531, :2226 |
| runSubagent/_ownSubagents | lib/index.js:2922 / :673 |
| M2 ContextObserver | lib/index.js:338, :725 |
| zstd 帧解压 | lib/index.js:50-51, :2328 |
| autoConsolidate 子代理（turn-stopping） | lib/index.js:128-134, :4596, :1824 |
| API 路由注册（handoff-state 要新增于此） | API map ≈:4531 区域（实施时定位） |

## 设计速记（实现时遵守）

- PLAN.md=replace 快照（旧版进 `handoff/archive/PLAN-<ts>.md`）；ledger=append-only 按时间戳文件
- 注入预算：PLAN 头部 ≤1200 字符 + 最新 ledger ≤800 字符，硬截断+evidence 指引（"全文见 handoff/，可 memory_recall 深查"）
- 前缀缓存纪律：只动动态快照层，静态纪律层字节不碰
- 工具名写 _pre（发布转换转裸名）；GUIDANCE 文案追加控制在 ~3 句内
- 门禁：所有写入过 sanitizeForWrite；密钥段规则不变
- 术语：白板=PLAN.md；ledger=交接账本；两层论（固化 prompt 层 vs 子代理晋升层）
