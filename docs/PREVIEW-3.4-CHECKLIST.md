# v3.4.0-alpha.1 核对文档

> **通知（一句话）**
> v3.4.0-alpha.1 预览版已上线，改动很大，请开发者核对功能逻辑与代码实现。

---

## 1. 下载与测试

```bash
git clone --depth=1 --branch preview https://github.com/Aik358/dsh-auto-memory.git
cd dsh-auto-memory
node --version    # 需要 Node 20+
node tools/run-smoke.mjs --jobs=8 --timeout=180000
```

**预期**：535 套件全绿，约 160 秒。

- 必须加 `--depth=1`：`artifacts/` 被追踪约 1.16 GB
- 单条失败先单独复跑：`node tests/smoke/smoke-test-<名字>.mjs`
- 高并发下有资源竞争型假红（单跑会绿）：`issue207-processes`、`sidecar-watchdog`、`issue384-387-external-import`、`fullpage-negative`、`v4-h3-d-memory-usage`

---

## 2. 修改说明与注意事项

### 2.1 核心改动：记忆单位从「流水账」换成「事件」

**这不是加功能，是换地基。**

| 层 | 单位 | 是否事件化 | 说明 |
|---|---|---|---|
| 长期记忆 | 事件 `evt_xxxxxxxx` | ✅ **是** | 一件事一个容器，跨天可中断再捡起 |
| 每日日志 | 日期 | ❌ 否 | 日记类，按天追加 |
| 每日反思 | 日期 | ❌ 否 | 日志的**蒸馏产物**，独立于事件 |

> 日志与反思**刻意不事件化**——语义单位是「一天」，不是「一件事」。这是设计，不是遗漏。

**事件结构**

```
事件 evt_a1b2c3d4
├── name / summary        ← L0 总览，可重写
├── sections{goal, doing, dead, next}   ← 反映【当前】状态，非历史累积
├── checkpoints[]         ← append-only，只增不改
├── userPercept[]         ← 人类侧观察（偏好/状态/未完成目标）
├── agentTrace[]          ← Agent 动作
├── sharedGround[]        ← 已达成的共识
└── commitment[]          ← 对用户的承诺
```

### 2.2 改动规模（相对 v3.3.17 分叉点 `e951d9eb`）

| 项 | 数量 |
|---|---|
| 本支线提交 | 403 |
| 新增文件 | 917 |
| 修改文件 | 474 |
| 新增 `lib/` 模块 | 45 |
| 新增测试套件 | 309 |

**核心新模块**：`event-store.js`(677) · `event-write.js`(537) · `ev4-adapter.js`(521) · `event-render.js`(503) · `memory-mutation-transaction.js`(336) · `plan-render.js`(282) · `user-portrait.js`(244)

### 2.3 另外三块新东西

1. **白板改为事件投影** —— `handoff/PLAN.md` 由事件渲染，不手写（手写会丢 `<!-- memory:mem_* -->` 锚点）
2. **团队基线同步** —— 一台机器整理上传，其他机器下载；brotli+base64 约 322 KB；下载侧七步安全闸门，**绝不静默替换记忆库**
3. **注入档位收口** —— 8 档枚举真正可达（含 post_compact）

### 2.4 ⚠️ 必须注意

| # | 事项 | 说明 |
|---|---|---|
| 1 | **团队同步服务端未验证** | 本机 `teamEnabled=false`。「是否接受未知 kind」「能否承载 322 KB」均未证伪。跑 `node tools/probe-team-baseline.mjs --url <url> --token <tok>`（零副作用），结果分 `A_OK` / `A_NEEDS_SPLIT` / `A_BLOCKED_BY_SERVER` |
| 2 | **B3 升级驱动器故意 fail-closed** | `lib/team-upgrade-driver.js` 的 `upgradeLocal` / `verify` 会明确失败而非假装成功。是设计，但**需要有人实现完** |
| 3 | **`artifacts/` 约 1.16 GB** | 必须 `--depth=1` |
| 4 | **v4 会迁移记忆结构** | 装之前备份 `~/.dsh/memory/` |

---

## 3. 核对与优化清单

### 3.1 功能正确性（Label: `preview function`）

| # | 验什么 | 判据 |
|---|---|---|
| F1 | 事件是否真被创建 | 调 `memory_event(action=create)`，`handoff/event-store.json` 里应有 `evt_` |
| F2 | 检查点 append-only | 连 append 两次，第二次**不应**覆盖第一次 |
| F3 | 四段是否跟随更新 | append 后事件头 `sections` 应变化 |
| F4 | 白板是否由事件渲染 | 改事件后 `PLAN.md` 应**自己变** |
| F5 | 日志/反思**不**进事件 | 写 `memory_log` 后事件库**不该**多出对应事件 |
| F6 | 欢迎向导 10 步可达 | 设置里重开向导，逐步点 |
| F7 | 设置页 v4 分区 | 应有「白板形态（事件投影）」条目 |

### 3.2 代码运行正确性（Label: `preview bug report`）

| # | 查什么 | 怎么查 |
|---|---|---|
| C1 | 未捕获异常 | DevTools Console 看 `ReferenceError` / `TypeError` |
| C2 | 前端能否加载 | `node tests/smoke/smoke-test-client-loadable.mjs`（真执行 factory） |
| C3 | 竞态 | 两会话同时写同一事件，看有无丢更新 |
| C4 | 事务回滚 | 记忆变更中途失败，旧数据是否完整 |
| C5 | **断言质量** | 抽查 `tests/smoke/`，找「只断言源码含某字符串」的**假测试** |

> **C5 最重要**。本仓硬纪律：「源码含某字符串」不构成功能验收，只是守卫。若某条测试这么写又没做变异反向验证（改坏代码看它是否变红），就是假绿，请直接报。

### 3.3 作者自评的高风险区（按风险，不按代码量）

1. **`lib/index.js`** —— 单文件 1.37 MB，+25,336 / −21,232。跨模块口径不一致都藏这里
2. **事件与日志的边界** —— 「什么该进事件」全靠模型判断，判错就污染事件库
3. **白板渲染回写环** —— 曾出现「白板全文写成检查点 → 渲染器又读回 → 闭环膨胀」
4. **同步 kind 白名单** —— 曾出现「applier 已注册但被 `requestKinds` 过滤掉」的半修
5. **前端样式变量** —— 曾出现「编造不存在的 `upBtnStyle` → ReferenceError → React 整棵树崩 → 插件闪退」

---

## 4. 提示词修改

v4 对注入提示词做了较大调整（事件四段渲染、档位分层、技能库优先等）。相关调查已成 HTML 报告并上线：

- **线上（GitHub Pages）**：https://aik358.github.io/dsh-auto-memory/landing/news/2026-10-29-memory-compliance.html
- **仓库内**：`docs/landing/news/2026-10-29-memory-compliance.html`
- **索引页**：https://aik358.github.io/dsh-auto-memory/landing/news/

提示词源文件（供直接核对）：

| 文件 | 作用 |
|---|---|
| `lib/migration-prompt.js` | 记忆基准迁移提示词 |
| `lib/tier-layer-inject.js` | 分层注入（档位体系） |
| `lib/injection-zones.js` | 注入分区 |
| `lib/injection-policy.js` | 注入策略 |
| `docs/architecture/overview-prompts.json` | 概览提示词配置 |

---

## 5. 反馈方式

- 功能问题 → issue 打 `preview function`
- 代码问题 → issue 打 `preview bug report`
- 附：版本 `3.4.0-alpha.1`、复现步骤、`.dsh-memory/` 片段、Console 报错原文
- 或 QQ 群直接 @ 作者

---

*对应 tag：`v3.4.0-alpha.1` · 分支：`preview`*
