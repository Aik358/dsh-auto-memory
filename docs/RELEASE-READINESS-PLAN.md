# 发布就绪规划（npm 发布 = 最后的单向门）

> 裁定时间：2026-08-30 · 依据：用户明确「资产包对接应用商店，一发布用户即可更新；
> 一切就绪且功能实验正常，全量跑通之后才能上 NPM」。
> 本文取代 HANDOFF-M8-M9-M10.md §2 的 P2 发布工程排序，作为发布前的执行路线权威。
> 关系：HANDOFF §2 的 P0/P1/P3 条目仍然有效，本文只重排**顺序与门槛**。

## 0. 核心原则

1. **npm publish 是单向门**：发布即触达用户更新，不可撤回 → 永远放最后一步，
   且必须用户亲自确认 go 才执行。
2. **发布前一切工作都在本地**：构建、打包、模拟首启、E2E 全部不碰 npm registry
   （`npm pack` 可以，`npm publish` 不行）。
3. **算法变更不赶首发**：lexical_pre_v3（b0.45）是算法+byte-twin 双侧变更，
   独立窗口原则 → 首发带 lexical_pre_v2，v3 留作发布后小版本。

## 1. 阶段路线

### 阶段 A — 功能收口（代码窗口）

| # | 任务 | 依据 |
|---|---|---|
| A1 | **P0 act.skill Python canary 实证**：重启 3080 → 匹配 active skill 的 query → delivered tail 含 checklist（exactDigest 不一致则修 m83 覆盖路径） | handoff §2 P0，唯一代码缺口 |
| A2 | **G-02 v2**：决策↔delivery 关联时间线 + A/P/S/H/E 反馈消费（policy diff/回放） | 提前做——它是阶段 D 验收的观测工具 |
| A3 | **fv2 query 窗口污染**：先评估是否首发阻塞项（默认裁定：不阻塞，记为已知限制；若验收发现实际误召回则升级） | handoff §2 P3.3 |

### 阶段 B — 自然使用观察（不改代码，2–3 天窗口）

| # | 任务 | 通过标准 |
|---|---|---|
| B1 | episode intent 干净度 | 最新 episodes intent = 真实问题，非 "Current runtime context…" |
| B2 | 技能自然晋升 | 跨 3 会话 + ≥2 成功 → observed→candidate→validated 自动走通 |
| B3 | fact 治理写回 | fact ≥0.6 置信自动写入 MEMORY.md，无误写噪音 |
| B4 | margin 校准观察 | canary 两档共有 margin 偏小议题：记录误触发/漏触发实例 |

观察窗期间允许的唯一改动 = A2 的 G-02 v2 可观测性（不改决策行为）。

### 阶段 C — 发布工程本地化（全程不发布）

| # | 任务 | 要点 |
|---|---|---|
| C1 | C2 资产包构建 | `@deepseek-ai/dsh-auto-memory-model-e5small-q8`：`npm pack` 产 tgz + SHA256 manifest + 双镜像地址配置（npmmirror+官方），**不 publish** |
| C2 | 首启下载向导 | 弹窗确认→下载（进度/取消）→SHA256 校验→推理自检→后台建索引→原子切换；**无断点续传**（双镜像+校验兜底），UI 如实标注体积 ~130MB |
| C3 | 设置页三档状态机 | 实际 c1/c2/c3（非"七态"）：词法 0GB / JS 语义 130MB / Python 563MB；切换即判 stale 重建 |
| C4 | fresh-install 本地 E2E | 干净 home 模拟首启：装插件→向导下载→三档切换→全链 canary；**JS-only（无 Python）独立可跑** + Python 档独立可跑 |
| C5 | 版本冻结准备 | policy 注册表/文档/架构图 progressLedger 同步；资产包版本号与主包兼容矩阵 |

### 阶段 D — 全量验收（发布门槛，go/no-go）

**验收清单（全部勾完才进 D6）**：

- [ ] D1 回归全绿：全部 smoke 套件（37+，含后续新增）串行通过
- [ ] D2 E2E：C4 的 fresh-install 三档切换 + 双轨独立性实证
- [ ] D3 观察窗回看：B1–B4 全部通过标准达成，有据可查（artifacts/ 留档）
- [ ] D4 **发布默认值裁定**（需用户逐项确认，当前是实验值不能原样出厂）：
  - 激活发射档默认（现 canary-explicit 是实验档；用户包默认建议 explicit-only）
  - memoryHubEnabled 首装默认值
  - procedureMinSessions/MinSuccess、jsDecideDeltaExp 出厂值
  - 隐私面：PII 投影/scope 默认策略复核（JS 权威层不变量）
- [ ] D5 发布物冻结：git tag 候选提交、CHANGELOG、资产包 SHA256 复核、
      架构图 progressLedger 标 R-RELEASE
- [ ] **D6 用户最终确认 go → npm publish（单向门）**

### 发布后（小版本迭代，不再走 D 全流程）

lexical_pre_v3（b0.45+否定词豁免+Python byte-twin 同步+重校准）→ int8 档资产包 →
G-02 后续/correction 硬门对齐 → 各自独立窗口走小版本。

## 2. 风险与红线（不变）

- 3080 重启 = 杀 `bin\.js.*web` → `dsh web`（用户已授权自动重启测试）
- 不 push；不动 M5/M6 validator / Reference Tail / seen / fv2 冻结核
- settings.yaml `llm-pi-ai.providers` 一票否决；input 模态只允许 text|image
- 每加路由改三处计数断言（smoke-test.mjs:68 / m3b3:44 / context-observer:108）
- 资产包首发后**不可 yank**：C1 的 SHA256 manifest 与实际 tgz 必须在 D5 复核一致
