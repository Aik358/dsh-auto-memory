# Handoff：M8/M9/M10 精修 + 发布前工作

> 移交时间：2026-08-30 傍晚 · 分支：preview · 最新提交：a651dc9 · 回归 **37/37** 全绿
> 接收方：下一会话编程模型
> **本文档是唯一交接入口**；读完本文 → PROJECT-FREEZE-AND-ROADMAP.md → m7-progress-checkpoint.md

---

## 0. 30 秒速览

M7 已标 live。M8 记忆中枢 + M9 技能固化的代码基座、接线、审批面全部完成，
回归 37/37（含混元 4 新增的 m83/m84/m85 三个套件共 129 断言）。
剩余 = **自然使用验证**（不写代码）+ **M6 packet skill 段 Python canary 实证**（唯一代码缺口）+ **M10 已组装** + **发布工程**。

---

## 1. 现在做到哪一步

### 全部已完成 ✅

| 里程碑 | 状态 | 说明 |
|---|---|---|
| M0-M6 JS 核心 | **live** | 37 套件全绿 |
| M7 JS 默认档 | **live** | C2+JS fv2+M6，canary delivered/seen 实证 |
| M7 Python 档 | **live** | int8 嵌入+变体 A+canary delivered=3/seen=24 |
| G-02 v1 | **tested** | RefineTab(A/P/S/H/E) + /shadow-recent + /review-feedback |
| M8 三店持久化 | **tested** | hub-pre/*.json + 重启 restore 实证 |
| M8 自动喂数 | **tested** | 文件队列 + consolidateTurn 钩子 + crossFeed |
| M8 fact 写回 | **tested** | fact→投影 MEMORY.md→sidecar 同步→进 M7 语料 |
| M8 evidence 分流 | **tested** | cite/seen→procedure.addEvidence 实证 |
| M8 Hermes 移植 | **tested** | touch/setPinned/自动归档/gates getter 活读 |
| M8 intent 清洗 | **tested** | 三层纯函数 lib/intent-clean-pre.js（m84 26 断言） |
| M9 生命周期 | **tested** | 状态机+晋升→激活全流程实机 |
| M9 审批面 | **tested** | 端点 promote/activate/deprecate/pin + hubTab 审批队列 UI |
| M9 act.skill | **tested** | JS 档 query 匹配 / Python 档 candidates∩sourceMemoryIds |
| M10 存储管理 | **tested** | 扫描/修复/删除三联动 + /storage-manage 端点 + 前端页签 |

### 混元 4 交付 ✅

| 项 | 说明 | 套件 |
|---|---|---|
| P0 act.skill 集成 | candidates∩sourceMemoryIds 匹配 + packet skill 块 + exactDigest 一致性锁死 | m83 (60 断言) |
| P1 intent 清洗 | 纯函数化 lib/intent-clean-pre.js + 修第 2 层抢跑第 3 层缺陷 | m84 (26 断言) |
| P3 M10 组装 | 扫描/修复/删除三联动 + /storage-manage 端点 + revokeBySource + purgeMemory | m85 (43 断言) |

### GLM 修复 ✅

| 项 | 说明 |
|---|---|
| P2① 成功证据零调用 | context-host 新增 recentEvidenceForSuccess + consolidateTurn 创建 success evidence → 驱动晋升 |
| P2② _sessions 断点 | cite 路径 seg 无 sessionId → lastSegmentSessionRef 回退 |
| M9 gates getter | 修 Object.assign 冻结快照 + \|\| 对 0 falsy 穿透 → 活读配置 |
| m53 挂死 | hub 定时器 unref（settle 不走 apply disposer 链） |
| 模型列表消失 | settings.yaml video 模态一票否决 → 移除 12 处 video |
| M6 packet skill | renderReferenceTail 支持可选 skill 块 + exactDigest 一致性 |

### Git 提交链

```
a651dc9  M9 修复:createSuccessEvidencePre 零调用方
c563d6e  混元 4 交付:P0 act.skill 集成 + P1 intent 清洗 + P3 M10 存储管理
1e65d20  docs: handoff 移交文档
00f79b0  修复:hub 定时器 unref + gates getter 活读 + 审批端点/hubTab
040bdbc  M0-M7 全量工作树备份
```

---

## 2. 接下来该做哪一步

### P0（唯一代码缺口）：M6 packet skill 段 Python canary 实证

混元 4 已实现 renderReferenceTail 的 skill 块 + exactDigest 一致性。
**需要做**：重启 3080 → 发一个匹配 active skill 的 query → 检查 delivered tail
文本含 checklist 内容。如果 exactDigest 校验失败 → skill 块在 build 和 render
之间不一致 → 需要调试 m83 的锁死测试覆盖的路径。

### P1（观察，不写代码）：自然使用验证

1. **episode intent 干净度**：自然对话 2 轮 → 查 `~/.dsh/memory/hub-pre/episodes.json`
   最新 intent 应为真实问题（非 "Current runtime context…"）
2. **技能自然晋升**：跨 3 个会话使用且记忆被 read/cite → procedures 自动晋升
   observed → candidate → validated（≥3 会话 + ≥2 成功 + successCriteria）
3. **fact 治理写回**：观察 2-3 天，fact ≥0.6 置信自动写入 MEMORY.md

### P2（发布工程，需要用户决策）

> **2026-08-30 用户裁定：npm 资产包发布=单向门（发布即触达应用商店用户更新），
> 全部就绪+全量跑通后才可 publish。** 执行路线已重排，权威见
> `docs/RELEASE-READINESS-PLAN.md`（阶段 A 收口→B 自然观察→C 本地化不发布→
> D 全量验收 go/no-go→最后才 publish）。原 P2 条目归入该文档阶段 C。

### P3（低优先）

1. G-02 v2：决策↔delivery 关联时间线 + A/P/S/H/E 反馈消费(policy diff/回放)
2. correction 硬门 live 语义对齐（live 需用户文本含完整 memoryId token+纠正词）
3. fv2 query 窗口污染（前轮回忆内容抬后续轮 intent）——滑动监测语义本身

---

## 3. 哪些文件比较有用

### 核心代码（按层）

| 层 | 文件 | 说明 |
|---|---|---|
| 引擎主体 | `lib/index.js` | 路由/config/工具/consolidateTurn/hub 创建/意图提纯/审批端点 |
| M5 证据桥 | `lib/context-host-pre.js` | 证据桥+判定链+evidence 分流+act.skill+recentEvidenceForSuccess |
| M6 投递 | `lib/activation-host-pre.js` | offer/pump/render/deliver/seen（泵共享 js+python） |
| M6 状态机 | `lib/activation-inbox-state-pre.js` | offer/claim/packet |
| M6 渲染 | `lib/activation-inbox-pre.js` | renderReferenceTail（skill 块渲染） |
| M8 编排器 | `lib/memory-hub-pre.js` | ingestJudgement/crossFeed/overview(+pipeline) |
| M8 三店 | `lib/fact-store-pre.js` / `episodic-store-pre.js` / `procedure-store-pre.js` | fact/episode/procedure |
| M9 审批 | `lib/procedure-store-pre.js` | promote/activate/deprecate/pin/touch/自动归档 |
| M10 管理 | `lib/index.js` /storage-manage 端点 + `lib/client.js` 存储管理页签 | 扫描/修复/删除 |
| fv2 决策核 | `lib/semantic-decide-pre.js` | **冻结勿改**（jsDecideDeltaExp 覆盖在 index.js 调用侧） |
| 前端 | `lib/client.js` | 设置页/hubTab 审批队列/RefineTab/存储管理页签 |
| intent 清洗 | `lib/intent-clean-pre.js` | 三层纯函数（混元 4 抽取） |

### 文档

| 文件 | 用途 |
|---|---|
| `docs/HANDOFF-M8-M9-M10.md` | **本文档** |
| `docs/PROJECT-FREEZE-AND-ROADMAP.md` | 全局蓝图 |
| `docs/proactive-associative-memory-system-map.html` | 架构权威图（进度台账） |
| `docs/M8-MEMORY-HUB.md` | M8 三层记忆功能图 |
| `docs/M6-CONTRACT.md` | M6 投递契约 |
| `docs/M7-LIVE-SHADOW-SCRIPT.md` | 受控 shadow 脚本+预期表 |
| `docs/RELEASE-SEMANTIC-OPTION.md` | 发布形态决策 |

### 测试（37 套件全绿）

关键套件：
- `smoke-test-m63-pre.mjs` — M6 投递（24 断言）
- `smoke-test-m79-feature-v2-pre.mjs` — fv2 worker（20 断言）
- `smoke-test-m81-hub-pre.mjs` — hub 编排+procedure（33 断言）
- `smoke-test-m82-js-decide-pre.mjs` — JS 判定核（9 断言）
- `smoke-test-m83-pre.mjs` — act.skill packet（60 断言，混元 4）
- `smoke-test-m84-pre.mjs` — intent 清洗（26 断言，混元 4）
- `smoke-test-m85-pre.mjs` — storage-manage（43 断言，混元 4）

### 数据/产物

| 路径 | 用途 |
|---|---|
| `~/.dsh/memory/hub-pre/` | M8 三店持久化 |
| `~/.dsh/memory/semantic-pre/` | 嵌入配置/向量/shadow+js-decide 日志 |
| `~/.dsh/memory/evidence-pre/events/` | M5 证据事件 |
| `~/.dsh/memory/semantic-pre/review-queue.jsonl` | G-02 用户反馈队列 |
| `artifacts/m7-shadow-reconcile-20260830/` | shadow 14 条对账 |
| `artifacts/e5-margin-calibration-20260828/` | e5 vs bge-m3 margin 实验 |
| `artifacts/m7-live-pre/feature-v2-heldout/candidatehit_variant_*.py` | candidateHit 研究 |

---

## 4. 注意事项（不要踩的坑）

1. **`dshHome()` 拼一层 `.dsh`** — 测试 fixture 必须放 `home/.dsh/...` 下
2. **episodic consolidate() 段数不足时丢弃缓冲** — 不能每次 append 都调 consolidate
3. **fv2 决策核冻结** — e5 阈值覆盖用 `jsDecideDeltaExp` 配置
4. **apply() 同步** — engine.config 可能未 loadConfig；gates 已改 getter 活读
5. **apply() 内 setInterval/setTimeout 必须 `.unref()`** — 否则测试进程挂死
6. **settings.yaml input 模态只允许 `text | image`** — `video` 一票否决全拒
7. **episodic consolidate() 段数不足丢弃缓冲** — context-host 用 `_hubEpBuffer` 计数
8. **M6 packet skill 字段** — 只有技能段确实渲染进去才落 skill，否则 exactDigest 校验失败→静默空注入
9. **每加一个路由** — 改三处计数断言（smoke-test.mjs:68 / m3b3:44 / context-observer:108）
10. **m53 全量串行偶发 built=0** — 顺序敏感抖动，单跑稳定，非代码 bug

### 操作红线

- **3080 重启**：精确匹配 `bin\.js.*web` 杀 → `dsh web` 启动；误杀 anchored-monitor 用原命令恢复
- **不 commit/push** 除非用户明确要求
- **不动 M5/M6 validator / Reference Tail 固定边界 / seen 语义**
- **fv2 决策核冻结**：`lib/semantic-decide-pre.js` + `python/m7_activation_features_pre_v2.py`
- **settings.yaml** `llm-pi-ai.providers` 一票否决
- **git**：用户已授权 commit（备份+修复），push 需另行确认

### 当前运行时配置

```
associativeMemoryEnabled=true, contextBridgeEnabled=true
contextSinkMode=python, pythonBackendEnabled=true, semanticEngineMode=python
activationEmitMode=canary-explicit, memoryHubEnabled=true
jsDecideDeltaExp=0.01, procedureMinSessions=3, procedureMinSuccess=2
autoConsolidateCooldownMinutes=30
会话模型=opencode-go DeepSeek V4 Flash（用户指定）
```

---

## 5. 建议执行顺序

```
1. 读本文 + FREEZE-AND-ROADMAP + m7-progress-checkpoint（恢复上下文）
2. 跑回归确认 37/37
3. P0: 重启 3080 → 发匹配 active skill 的 query → 验证 delivered tail 含 checklist
4. P1: 自然对话 2 轮 → 查 episodes.json intent 干净度
5. P2: 观察技能自然晋升（3 会话+2 成功）
6. 发布工程本地化（C2 资产包 pack+向导+三档状态机，**全程不 publish**）
7. 全量验收门槛（docs/RELEASE-READINESS-PLAN.md 阶段 D 清单）→ 用户确认 go
8. npm publish（单向门，最后一步）→ 发布后小版本（lexical_pre_v3 等）
```
