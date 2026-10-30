# v3.4.0-alpha.1 预览版 · 开发者排查指南

> **这是抢先预览版（Preview / Research Build），不是正式版。**
> 只发 GitHub、不上 npm。目的不是让普通用户升级，而是**请社区帮忙核验**。

---

## 0. 一句话

v3.3.x 的记忆是**流水账**；v3.4 把它换成了**事件**。这不是加功能，是换地基 —— 所以必然有漏。

排查分两条线，对应两个 GitHub Label：

| Label | 管什么 | 典型问题 |
|---|---|---|
| `preview function` | **功能正确性** | 这个按钮点了该生效却没生效；白板该更新却没更新 |
| `preview bug report` | **代码运行正确性** | 异常没被捕获、竞态、断言写错、边界条件漏判 |

---

## 1. 改动规模（相对 v3.3.17 分叉点 `e951d9eb`）

| 项 | 数量 |
|---|---|
| 只在本支线的提交 | **403** |
| 新增文件 | **917** |
| 修改文件 | **474** |
| 删除文件 | **17** |
| 新增 `lib/` 模块 | **45** |
| 新增测试套件 | **309** |
| 新增文档 | **317** |

### 新增的核心模块（按重要性）

| 模块 | 行数 | 作用 |
|---|---|---|
| `lib/event-store.js` | 677 | 事件本体存储（schema v2），唯一真源 |
| `lib/event-write.js` | 537 | 事件写入 + 四段规范化 |
| `lib/ev4-adapter.js` | 521 | 前端事件视图适配 |
| `lib/event-render.js` | 503 | 事件渲染 |
| `lib/memory-mutation-transaction.js` | 336 | 记忆变更事务 |
| `lib/event-regroup.js` | 291 | 事件归组 |
| `lib/plan-render.js` | 282 | 白板渲染（事件投影） |
| `lib/event-regroup-apply.js` | 261 | 归组应用 |
| `lib/shared-state-lock.js` | 247 | 共享状态锁 |
| `lib/user-portrait.js` | 244 | 用户画像（四类感知） |

---

## 2. 设计意图（先读懂这个，再判断对错）

### 2.1 三层结构，各管一件事

| 层 | 单位 | 是否事件化 | 职责 |
|---|---|---|---|
| **长期记忆** | 事件（`evt_xxxxxxxx`） | ✅ **是** | 一件事一个容器，跨天可中断再捡起 |
| 每日日志 | 日期 | ❌ 否 | 日记类，按天追加 |
| 每日反思 | 日期 | ❌ 否 | 日志的**蒸馏产物**，独立于事件 |

**这是刻意的，不是遗漏。** 日志与反思的语义单位是「一天」，硬塞进事件会逼模型在写日记时反推「这属于哪件事」——纯噪声。

### 2.2 事件里装什么

```
事件 evt_a1b2c3d4
├── name / summary        ← L0 总览，可随时重写
├── sections{goal, doing, dead, next}   ← 反映【当前】状态，非历史累积
├── checkpoints[]         ← append-only，只增不改
├── userPercept[]         ← 人类侧观察
├── agentTrace[]          ← Agent 动作
├── sharedGround[]        ← 已达成的共识
└── commitment[]          ← 对用户的承诺
```

### 2.3 两条硬约束

1. **检查点 append-only** —— 历史不重写。要更正就追加新检查点 + `supersedes`/`retract` 标记。
2. **每次 append 后必须重写 `sections`** —— 只追加不刷四段，四段会静默变成陈旧快照，注入的 `next` 开始指向早就做完的事。

### 2.4 白板是投影

`handoff/PLAN.md` **由事件渲染**，不是手写文档。手写会丢 `<!-- memory:mem_* -->` 锚点，卡片体系断裂。

---

## 3. 已知问题（**请优先验这些**）

### 3.1 团队同步的服务端完全未验证 ⚠️

- 本机 `teamEnabled=false`、`teamServerUrl` 为空
- **未证伪**：服务端是否接受未知 `kind`、能否承载 322 KB 请求体

**怎么验**：

```bash
node tools/probe-team-baseline.mjs --url <你的服务端> --token <token>
```

零副作用（用 `__probe__` 前缀的包，不碰真实记忆）。三种结果：

| 结果 | 含义 |
|---|---|
| `A_OK` | 现实现直接可用 |
| `A_NEEDS_SPLIT` | 基线需分片（约 220 行工作量） |
| `A_BLOCKED_BY_SERVER` | 需服务端放行，或改走对象存储 |

### 3.2 B3 升级驱动器故意未实现

`lib/team-upgrade-driver.js` 的 `upgradeLocal` / `verify` 是 **fail-closed** 的：
会明确失败，而不是假装成功。这不是 bug，是设计 —— 但**需要有人把它实现完**。

### 3.3 目录体积

`artifacts/` 被 git 追踪约 **1.16 GB**（工作区实体 6.7 GB）。建议：

```bash
git clone --depth=1 https://github.com/Aik358/dsh-auto-memory.git
```

---

## 4. 排查清单（请按这个顺序）

### A. 环境准备

```bash
git clone --depth=1 https://github.com/Aik358/dsh-auto-memory.git
cd dsh-auto-memory
node --version        # 需要 Node 20+
node tools/run-smoke.mjs --jobs=8 --timeout=180000
```

**预期**：535 套件全绿。若有一条红，请先单独复跑：

```bash
node tests/smoke/smoke-test-<name>.mjs
```

> 已知：`issue207-processes`、`sidecar-watchdog`、`issue384-387-external-import`、
> `fullpage-negative`、`v4-h3-d-memory-usage` 在高并发下有**资源竞争型假红**，单跑会绿。

### B. 功能正确性（label: `preview function`）

| # | 验什么 | 怎么看对不对 |
|---|---|---|
| F1 | 事件是否真的被创建 | 调 `memory_event(action=create)`，看 `handoff/event-store.json` 里有没有 `evt_` |
| F2 | 检查点是否 append-only | 连 append 两次，第二次不应覆盖第一次 |
| F3 | 四段是否跟随更新 | append 后看事件头 `sections` 有没有变 |
| F4 | 白板是否由事件渲染 | 改事件后 `PLAN.md` 应自己变（而不是你手写） |
| F5 | 日志/反思是否**不**进事件 | 写 `memory_log` 后事件库里**不该**多出对应事件 |
| F6 | 欢迎向导 10 步是否都可达 | 设置里重开向导，逐步点 |
| F7 | 设置页 v4 分区 | 应有「白板形态（事件投影）」条目 |

### C. 代码运行正确性（label: `preview bug report`）

| # | 查什么 | 怎么查 |
|---|---|---|
| C1 | 未捕获异常 | 开 DevTools，看 Console 有无 `ReferenceError` / `TypeError` |
| C2 | 前端能否加载 | `node tests/smoke/smoke-test-client-loadable.mjs`（真执行 factory） |
| C3 | 竞态 | 两个会话同时写同一事件，看有没有丢更新 |
| C4 | 事务回滚 | 记忆变更中途失败，旧数据是否完整 |
| C5 | 断言质量 | 抽查 `tests/smoke/`，找「只断言源码含某字符串」的假测试 |

---

## 5. 这份代码最可能出问题的地方（作者自评）

按风险排序，**不是**按代码量：

1. **`lib/index.js`（+25,336 / −21,232）** —— 单文件 1.37 MB，改动最大。任何跨模块口径不一致都藏在这里。
2. **事件与日志的边界** —— 「什么该进事件、什么不该」全靠模型判断，模型判错就会污染事件库。
3. **白板渲染回写环** —— 曾出现过「白板全文被写成检查点 → 渲染器又读回 → 闭环膨胀」。
4. **同步的 kind 白名单** —— 曾出现「applier 已注册但被 `requestKinds` 过滤掉」的半修。
5. **前端样式变量** —— 曾出现「编造了不存在的 `upBtnStyle` → ReferenceError → React 整棵树崩 → 插件闪退」。

---

## 6. 怎么反馈

- **功能问题** → issue 打 `preview function`
- **代码问题** → issue 打 `preview bug report`
- 附上：版本 `3.4.0-alpha.1`、复现步骤、`.dsh-memory/` 相关片段、Console 报错原文
- 也可以 QQ 群直接 @ 作者

---

*本报告对应提交：见 tag `v3.4.0-alpha.1`*
