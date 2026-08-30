# Handoff：M8/M9/M10 精修 + 发布前工作

> 移交时间：2026-08-30 下午 · 移交方：ZCode (GLM) · 接收方：下一编程模型（混元 4）
> 分支：preview · 最新提交：00f79b0 · 回归 34/34 全绿
> 本文档是唯一交接入口；读完本文 → 再读 PROJECT-FREEZE-AND-ROADMAP.md → 再读 m7-progress-checkpoint.md

---

## 0. 30 秒速览

M7 已标 live（JS+Python 双轨各自验证通过）。M8 记忆中枢和 M9 技能固化的代码基座
已全部实现并接线完毕（含 Hermes 借鉴大改），当前状态 = tested + 实机验证通过。
剩余工作是**精修**（不是从零写）：修几个已知集成缺口、验证自然使用下的行为、
补审批消费端。M10 存储管理的原语已就绪但未组装。G-02 v1 已跑通。

---

## 1. 现在做到哪一步

### 已完成 ✅（不要重做）

| 里程碑 | 状态 | 关键证据 |
|---|---|---|
| M0-M6 JS 记忆核心 | **live** | 34 套件回归全绿；delivered/seen 闭环实证 |
| M7 JS 默认档 | **live** | C2 检索+JS fv2 判定+M6 投递，canary delivered/seen |
| M7 Python 档 | **live** | int8 嵌入 53/53 零超时；受控 shadow 14 条对账；canary delivered=3/seen=24 |
| 变体 A 修复 | **live** | candidateHit 词法臂信任 theta=12.0，emit 恢复 |
| G-02 v1 | **tested** | RefineTab(A/P/S/H/E) + /shadow-recent + /review-feedback |
| M8 三店持久化 | **tested** | hub-pre/*.json 落盘+重启 restore 实证 |
| M8 自动喂数 | **tested** | 文件队列+consolidateTurn 钩子+crossFeed |
| M8 fact 写回 | **tested** | fact→投影 MEMORY.md→sidecar 同步→进 M7 语料 |
| M8 evidence 分流 | **tested** | cite/seen→procedure.addEvidence 实证 cite=1 |
| M8 Hermes 移植 | **tested** | touch/setPinned/自动归档/晋升门槛 getter 活读 |
| M9 生命周期 | **tested** | observed→…→deprecated 状态机+晋升→激活全流程实机 |
| M9 审批端点 | **tested** | /memory-hub POST promote/activate/deprecate/pin |
| M9 hubTab UI | **tested** | 审批队列卡片（晋升/激活/弃用/置顶按钮） |

### 六连修复 ✅（已提交，不要回退）

1. `readFileSync` 未导入 → jsEmitMode() 恒 shadow
2. 注入即泵（pumpClaimed）扩展到 js+python 来源
3. fv2 特征孪生对齐（稠密 top-8 → D6 融合序 → 融合序稠密分差）
4. pre-step claim 失败不清除已泵入 claimed
5. sink onActivation 自动注册（activation 帧静默蒸发修复）
6. hub 定时器 unref（m53 等测试进程挂死修复）

---

## 2. 接下来该做哪一步（按优先级）

### P0：act.skill Python 档集成（M9 最后一块）

**问题**：act.skill 附着逻辑在 JS 判定链（context-host emit 路径），依赖 query 文本
做稠密/词法匹配。Python emit 来自 worker 异步帧，JS 侧拿不到 query 文本 →
Python 档的 emit 不会附带 skill checklist。

**修复方向**（用户已批准方案 A 精神）：
- 在 `offerExternalActivation`（activation-host-pre.js）里，用 activation 的
  `candidates[].memoryId` 与 hub 技能的 `sourceMemoryIds` 求交集 → 匹配则附加 skill
- **但有一个前置缺口**：M6 packet 构建器（activation-inbox-state-pre.js
  offerActivation→ReferenceTailPacket）只从 candidates 构建 references，
  **skill 字段没有进入 packet** → 即使附加了 act.skill，delivered tail 不含
  checklist 文本
- 需要扩展 M6 packet/render：在 renderReferenceTail 的输出中附加 skill 段
  （不改 M6 validator/Reference Tail 固定边界，只加一段可选后缀）

**涉及文件**：
- `lib/activation-host-pre.js` — offerExternalActivation 加 skill 匹配
- `lib/activation-inbox-state-pre.js` — packet 构建器带 skill 字段
- `lib/activation-inbox-pre.js` — renderReferenceTail 或其调用方渲染 skill 段
- 参考：`lib/context-host-pre.js` 行 431-455（JS 档的 act.skill 附加逻辑）

**验证**：激活一个技能 → 发匹配 query → 检查 delivered tail 文本含 checklist。

### P1：M8 采集侧 intent 清洗验证

**问题**：episode intent 从 userTexts 提取，但 consolidateTurn 拿到的 userText
本身被注入快照污染且截断 200 字符。三层修复已落地（eventType 过滤+合成消息
跳过+</memory_system> 剥离），但完整 episode 验证需自然对话两轮。

**验证方法**：用户自然对话两轮 → 查 `~/.dsh/memory/hub-pre/episodes.json`
最新 episode 的 intent 应为真实问题文本（非 "Current runtime context…"）。

**如果仍污染**：consolidateTurn 的 userText 剥离点在 lib/index.js
`for (const m of messages)` 循环之后——检查 `</memory_system>` 剥离是否命中。
真实注入格式是 M5 context 快照（"Current runtime context."），非
`<memory_system>` 标签（那只在 section 里）。可能需要改剥离条件。

### P2：M9 技能晋升自然验证

晋升门槛 ≥3 会话 + ≥2 成功。已验证 0/0 门槛下 promote→activate 全流程。
自然验证 = 等用户跨 3 个会话使用后检查 procedures 自动晋升。
**不需要写代码**，只需观察。如果 3 天后仍无晋升，检查 evidence feed 的
success kind 是否在自然使用中产生。

### P3：M10 存储管理（原语齐备，组装即可）

已就绪的原语：
- `docStore.replace(expectedDigest)` — 原子删除（renderReplace 省略→removed）
- `rebuildSidecar(filePath, prev)` — 只重建 sidecar 不改正文（零风险）
- evidence retention 30 天/32MiB — 自动清理
- memory_maintain_pre — 30 天蒸馏+archive

需要组装的三个接线点：
1. 删除操作 = docStore.replace + activationHost.purgeMemory + factStore.revokeBySource
2. 语料健康扫描（4 源文件 sidecar fileDigest 比对）→ stale 自动 rebuildSidecar
3. 管理 UI（设置页或记忆面板）

### P4：发布工程

1. C2 资产包 npm 发布（@deepseek-ai/dsh-auto-memory-model-e5small-q8）
2. 首启下载向导（SHA256+自检+断点续传）——UI 原型在 artifacts/m7-live-pre/ui-assets/
3. 设置页七态状态机按钮组
4. lexical_pre_v3 采纳（b0.45，MRR+37%，须同步 Python byte-twin）

---

## 3. 哪些文件比较有用

### 核心代码（改动最频繁）

| 文件 | 职责 | 最近改动 |
|---|---|---|
| `lib/index.js` | 引擎主体：路由/config/工具/consolidateTurn/意图提纯/hub 创建 | 意图三层清洗/hub io+getter/审批端点 |
| `lib/context-host-pre.js` | M5 证据桥+M7 判定链+M8 evidence 分流+act.skill | 变体 A 观测/sessionRef/act.skill |
| `lib/activation-host-pre.js` | M6 投递宿主：offer/pump/render/deliver/seen | 泵共享+python 扩展 |
| `lib/activation-inbox-state-pre.js` | M6 收件箱状态机：offer/claim/render | **未改——skill 字段需扩展** |
| `lib/procedure-store-pre.js` | M9 技能状态机+晋升门槛+自动归档 | touch/pinned/gates getter |
| `lib/memory-hub-pre.js` | M8 编排器：ingestJudgement/crossFeed/overview | pipeline 字段 |
| `lib/memory-writer-pre.js` | M3b 写入事务：append/replace/sidecar | 未改（rebuildSidecar 待接线） |
| `lib/semantic-decide-pre.js` | fv2 决策核（冻结，勿改） | 未改 |
| `lib/client.js` | 前端：设置页/记忆面板/hubTab/RefineTab | hubTab 审批队列 UI |

### 文档

| 文件 | 用途 |
|---|---|
| `docs/PROJECT-FREEZE-AND-ROADMAP.md` | 全局冻结蓝图（架构分层/版本注册表/路线图） |
| `docs/proactive-associative-memory-system-map.html` | 唯一架构权威图（进度台账+模块卡+路线） |
| `docs/M8-MEMORY-HUB.md` | M8 三层记忆路径/功能图 |
| `docs/M6-CONTRACT.md` | M6 投递契约（§16-§19 各阶段实施状态） |
| `docs/PYTHON-SIDECAR-CONTRACT.md` | Python sidecar 完整契约 |
| `docs/M7-LIVE-SHADOW-SCRIPT.md` | 受控 shadow 18-24 条脚本+预期表 |
| `docs/RELEASE-SEMANTIC-OPTION.md` | 发布形态决策 |

### 测试

| 文件 | 覆盖 |
|---|---|
| `smoke-test-m53-pre.mjs` | M5-3 证据桥+envelope（**已知对 run 顺序敏感，单跑稳定**） |
| `smoke-test-m63-pre.mjs` | M6-3 投递宿主（24 断言） |
| `smoke-test-m79-feature-v2-pre.mjs` | fv2 worker 接线（20 断言） |
| `smoke-test-m710-fv2-emit-pre.mjs` | fv2 emit 桥（13 断言） |
| `smoke-test-m80-fact-pre.mjs` | fact store（41 断言） |
| `smoke-test-m81-hub-pre.mjs` | hub 编排+procedure（33 断言） |
| `smoke-test-m82-js-decide-pre.mjs` | JS 判定核（9 断言） |

### 数据/产物

| 路径 | 用途 |
|---|---|
| `~/.dsh/memory/hub-pre/` | M8 三店持久化（episodes/facts/procedures.json + flush-state.json） |
| `~/.dsh/memory/semantic-pre/` | 嵌入配置/向量/shadow 日志/js-decide 日志 |
| `~/.dsh/memory/evidence-pre/events/` | M5 证据事件（按日 JSONL） |
| `artifacts/m7-shadow-reconcile-20260830/` | 受控 shadow 14 条对账产物 |
| `artifacts/e5-margin-calibration-20260828/` | e5 vs bge-m3 margin 校准实验 |
| `artifacts/m7-live-pre/feature-v2-heldout/candidatehit_variant_*.py` | candidateHit 变体研究+复放 |

---

## 4. 已知问题与注意事项

### 不要踩的坑

1. **`dshHome()` 拼一层 `.dsh`** — context-host 的 dshHome() 返回 `path.join(base, '.dsh')`，
   临时测试的 corpus/sidecar/日志必须放 `home/.dsh/...` 下，否则 0 records。
2. **episodic consolidate() 段数不足时丢弃缓冲** — 不能每次 append 都调 consolidate；
   context-host 用 `this._hubEpBuffer` 计数攒够 minSegments 才调。
3. **fv2 决策核（semantic-decide-pre.js）冻结勿改** — e5 档阈值覆盖用
   `jsDecideDeltaExp` 配置在调用侧克隆 policy，核心一字不动。
4. **apply() 是同步函数** — hub 创建时 engine.config 可能未 loadConfig；
   gates 已改 getter 活读，新增类似参数也应 getter。
5. **apply() 内 setInterval/setTimeout 必须 `.unref()`** — 否则测试进程挂死
   （m53 教训：settle() 不经过 apply 的 disposer 链）。
6. **settings.yaml 的 input 模态只允许 `text | image`** — `video` 会导致
   llm-pi-ai 段整体被拒→所有自定义 provider 消失（已修，备份 settings.yaml.bak-20260830）。
7. **episodic consolidate() 段数不足时丢弃缓冲（current=null）** —
   context-host 用 `this._hubEpBuffer` 计数攒够才调。

### 操作红线

- **3080 重启**：杀 dsh web 进程（精确匹配 `bin\.js.*web`）→ `dsh web` 启动；
  误杀 anchored-monitor 用 `node E:\dsh_dynamic_adjust\anchored-monitor\dist\monitor\index.js --profile demo --overrides "C:\Users\JH Z\.dsh\anchored-monitor.overrides.json"` 恢复
- **不 commit/push/tag/publish** 除非用户明确要求（git 备份 040bdbc+00f79b0 已获授权）
- **不动 M5/M6 validator/Reference Tail 固定边界/seen 语义**
- **`_pre` 命名空间隔离**（M8/M9/M10 新增代码全在 `*-pre.js` / `worker_*_pre_v1.py`）
- **fv2 决策核冻结**：`lib/semantic-decide-pre.js` + `python/m7_activation_features_pre_v2.py`
  一字不动；阈值调整用 `jsDecideDeltaExp` 配置覆盖（调用侧克隆 policy）
- **settings.yaml** 的 `llm-pi-ai.providers` 段一票否决：一个 profile 校验失败 →
  全部自定义 provider 消失

### 当前运行时配置（用户实例）

```
associativeMemoryEnabled=true, contextBridgeEnabled=true
contextSinkMode=python, pythonBackendEnabled=true, semanticEngineMode=python
activationEmitMode=canary-explicit, memoryHubEnabled=true
jsDecideDeltaExp=0.01, procedureMinSessions=3, procedureMinSuccess=2
autoConsolidateCooldownMinutes=30
```

---

## 4.5 接手方交付记录(2026-08-30 晚,混元 4;分支 preview,起点 1e65d20)

回归: baseline 34/34 → 收尾 **37/37 全绿**(新增 3 套件 / 129 条断言)。以下全部在 `_pre`
命名空间内,未触碰 fv2 决策核、M5/M6 validator、Reference Tail 固定边界与 seen 语义。

| 项 | 状态 | 落点 |
|---|---|---|
| P0 act.skill Python 档集成 | **done** | activation-host-pre.js `matchSkillByCandidates` + `offerExternalActivation` 附着;activation-inbox-pre.js 新增 `SKILL_TAIL_BUDGET_PRE_V1`/`clipBytes`/`validateActivationSkillPre`/`renderSkillBlock`,packet 带可选 `skill`;`renderTailFor` 同源传入 |
| P1 episode intent 清洗 | **done**(含缺陷修复) | 新增 lib/intent-clean-pre.js(纯函数,index.js consolidateTurn 等价调用);修掉「含 `<memory_system>` 整条跳过」抢跑导致真问题被丢的缺陷 |
| P2 技能晋升观察 | **已诊断,未改代码** | 两个硬阻塞(见 §4.6) |
| P3 M10 存储管理 | **done** | 新增 lib/storage-manage-pre.js + `factStore.revokeBySource` + `activationHost.purgeMemory`(+ `inbox.purgeMemoryId`/`registry.boxes()`)+ `/storage-manage` 端点 + client.js「存储管理」页签 |
| P4 发布工程 | **核实,未执行** | 见 §4.7——含外部不可逆动作,须用户决策 |

新增测试:`smoke-test-m83-skill-packet-pre.mjs`(60)、`smoke-test-m84-intent-clean-pre.mjs`(26)、
`smoke-test-m85-storage-manage-pre.mjs`(43)。
路由数 32→33,三处计数断言已同步(smoke-test.mjs:68 / smoke-test-m3b3-pre.mjs:44 /
smoke-test-context-observer.mjs:108)——**以后每新增一个路由都要同步这三处**。

**P0 关键不变量**(改动 skill 渲染时必须守住):packet 只有在渲染确实把技能段放进去时才落
`skill`(见 `buildReferenceTailPacketPre` 的 `rendered.skillIncluded`);否则 build 与
`renderTailFor` 的重渲染文本不一致 → exactDigest 校验失败 → 整单静默降级为空注入。

### 4.6 P2 诊断:技能为什么永远晋升不了(未改代码,留给下一轮决策)

实测 `~/.dsh/memory/hub-pre/procedures.json`:3 个技能,2 observed + 1 deprecated;
最活跃的 `proc_pre_45e4426a…` 已有 cite=8 / seen=14 / read=2,但 **sessions=0、success=0**。

1. **`success` 证据全仓零产出方**:`createSuccessEvidencePre` 在 lib/context-bridge-pre.js:352
   已导出,但 grep 全仓**没有任何调用点**。而门槛 `procedureMinSuccess=2` 要求
   `evidence.success ≥ 2` → 自然使用中技能**永远无法自动晋升**。
2. **会话多样性计数疑似从未喂入**:`addEvidence` 只在 `ev.sessionRef` 非空时才计数
   (procedure-store-pre.js:195-201),落盘 JSON 里 `_sessions` 字段缺失。调用方
   (context-host-pre.js:576)取 `list[0].sessionId || lastSegmentSessionRef`,需实机确认二者是否为空。

### 4.7 P4 发布工程:核实到的真实就绪度(与 §2 的描述有出入,以代码为准)

- **C2 资产包 npm 发布**:外部不可逆动作,未做(铁律:不 publish)。需 npm 凭据 + 118MB 资产包。
- **首启下载向导**:`createSemanticDownloaderPre` 具备双镜像(auto=cn→intl)、SHA256 校验、
  进度、按块取消;但**没有断点续传**(代码中无 Range/resume 实现)。首启弹窗
  (`kind=modelDownload`)**未接线**——client.js 无该分支,原型仅存在于 artifacts/m7-live-pre/ui-assets/。
- **设置页七态状态机**:`resolveSemanticTier` 只产出 c1/c2/c3 三档,UI 徽章四态,离「七态」尚远。
- **lexical_pre_v3(b0.45)**:属算法窗口(须同步 Python byte-twin + 重校准),建议不要混在发布工程做。

## 5. 建议的下一步执行顺序

```
1. 读本文 + FREEZE-AND-ROADMAP + m7-progress-checkpoint（恢复上下文）
2. 跑回归确认 37/37（baseline sanity；注意 m53 的顺序敏感抖动见 §4）
3. P0: act.skill Python 档集成（M6 packet skill 字段扩展）        ← 2026-08-30 已完成
   → 验证: 激活技能 → 匹配 query → delivered tail 含 checklist
4. P1: 自然对话 2 轮 → 查 episodes.json intent 干净度              ← 代码层已锁死，实机待用户
5. P2: 观察技能晋升（3 会话+2 成功，不写代码）                     ← 已诊断出 2 个硬阻塞（§4.6）
6. P3: M10 组装（删除三联动+健康扫描）                             ← 2026-08-30 已完成
7. P4: 发布工程（C2 资产包+向导+lexical_v3）                       ← 需用户决策（§4.7，含 npm 发布）
8. 全量测试 → 标 M8/M9 live → G-02 v2 → 最终发布
```

**下一轮的入口优先级**（基于 §4.6/§4.7 的实测）：
①先解 P2 的 `success` 零产出（否则 M9 晋升链路形同虚设）→ ②P4 的发布决策需用户拍板
（npm 发布不可逆）→ ③lexical_pre_v3 单独开算法窗口，勿与发布混做。
