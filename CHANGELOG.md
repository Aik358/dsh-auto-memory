# Changelog

All notable changes to dsh-auto-memory.

---

## [2.3.0] — 2026-09-10 · 分层语义唤回 · 时间臂 · C3 召回 · M8 默认启用

> 覆盖：分层语义检索、时间检索臂、C3 语义召回、主动联想截断修复、四层接续、M8 三层记忆默认启用、证据链修复、子代理生命周期与自动接续稳定性修复。

### 稳定性修复

- **子代理生命周期**：宿主 context 卸载（重启/禁用）后，残留定时器与面板请求不再尝试创建子代理 —— 消除 `cannot create effect on inactive context` 报错刷屏；同类竞态只记一条诊断日志。
- **自动接续提前布线**：水位在 pre-step 测量后即挂接续倒计时（此前只在轮末 arm，长回合中官方压缩先触发导致接续从不触发）；倒计时到期若回合仍活跃则自动推迟，不打断进行中的对话。
- **子代理回收抗占用**：Windows 下会话目录被占用导致 `rename` 失败时改为退避重试，仍失败则跳过留待下次，不再刷屏。
- **Python 引擎安装**：修正 BGE-M3 模型仓库名（原仓库不存在导致 HTTP 401），补齐 tokenizer 5 件，就绪判定改为模型与 tokenizer 全齐。

### 记忆检索 · 分层语义唤回（OpenViking 式）

- **L0 摘要与索引**：每条记忆生成约 93 字符摘要（压缩约 1:7），检索默认只返回 L0 列表（含 id/score/match_reason），按 `expand="mem_xxx"` 按需展开原文，不串条。
- **语义臂接入 recall**：C2 内置语义引擎（e5-small q8，约 130MB）对 L0 摘要编码——修复此前"全文进 embedding 超 512 token 被截断"的有损问题。
- **rank-space 融合（RRF，k=60）**：词法 + 语义 + 时间 三臂并行倒数排名融合，取代旧的 minmax 归一化（旧方案分数随候选集漂移、候选 ≤1 时退化为常数、矮子里拔将军）。
- **时间检索臂**：支持「上周 / 三天前 / 上个月 / 最近 N 天」等中文时间表达，软性提升命中时间范围的记忆；查询不含时间词时零行为变更。
- **C3/Python 档语义召回**：暴露 Python worker 已有的 `dense_search` 为召回入口，C3 档（BGE-M3）同样参与召回排序；`auto` 档择优（Python 可用则 C3，否则 C2）。

### 主动联想 · 决策层

- **修复 QueryPlan 词项截断**：从"按字典序截断"改为"按来源权重降序保留（trigger 1.0 ＞ user 0.8 ＞ tool-result 0.6 …）"，高权重词不再被低权重词挤掉，主动联想召回更准。

### 跨窗口接续

- **四层交接材料**：白板 / 账本 / 近期线程 / 完整转写（按需 read），改为「按需取用而非通读」，不再要求"接续前先 read 转写"。
- **账本权重化截断**：四段赋权（失败原因 .35 ＞ 下一步 .30 ＞ 目标 .20 ＞ 状态 .15），预算不足时从最低权重段起截，避免高价值段被整段截掉。
- **写入侧修复**：账本双标题重复、白板退化为日志（老化处理）。
- **接续阈值 0.75**：抢在官方压缩阈值 0.80 之前完成交接，水位测量在 pre-step。

### M8 三层记忆（默认启用）

- fact（事实）/ episodic（经历）/ procedure（技能）三层 store，配「记忆中枢」页签。
- **Fact 元数据**：时间三价（occurredAt / mentionedAt / ingestedAt）+ 认识论状态（fact / observation / directive）+ 趋势（new→stable→stale），向后兼容旧数据。
- **记忆重要性权重**：由证据聚合（跨会话重现度、成功/复用、纠正率）生成，作为加权因子接入检索排序。

### 证据链

- 六类 evidence（seen / read / cite / reuse / success / correction）落盘与聚合。
- **修复 correction 归因**：从"需用户消息含完整 32 位 memoryId"（几乎不可触发）改为"归因到最近被 cite/read 的记忆"，单条归因、保留 cite。
- **修复 success 时间戳缺陷**：事件时间戳在 `event.ts`（顶层无 `ts`/`createdAt`），旧写法恒为 0 → success 证据链结构性断裂（恒为 0）；改为与选择器同口径取值。

### 修复

- **P0 静默失效**：`readdirSync` 未导入 → importance 管道全程失效且被静默 catch 吞掉；补导入 + 降级加 diag。
- **设置页「自动记忆引擎」分区标题空白**：`sectionLabels.secSemantic` 键名错误 → 改为 `sectionLabels.semantic`。
- **bge-m3 仓库名**（issue #27，原 `-int8` 仓库不存在 → HF 401）；**tokenizer 五件套补齐**（issue #28）。
- **子代理兼容**（DSH 0.1.2 in-process 用 `localAgent` 而非 `agent`）+ `withTimeout` 兜底（防 result 卡死泄漏）。

### 已知限制（本版仍存在）

- 词法检索为全量扫描，无倒排索引（记忆上千条后才需优化）。
- C3/Python 召回需先在设置页安装 BGE-M3 模型（约 563MB）。
- `autoConsolidateCooldownMinutes = 0` 会回退为 30（`0 || 30`），与直觉不符，后续版本处理。
