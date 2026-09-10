> **投喂方式**：本段须与 `_COMMON.md` 一并投喂。
> ⚠️ **本段涉及改变运行时默认行为，投喂前必须先经用户书面确认**（见下方"前置确认"）。

## 【M8-3】M8 启用与 live 验证

**背景（有代码证据）**：
- `lib/index.js:365` `memoryHubEnabled: false` —— **M8 三层记忆系统默认关闭**。
- `docs/M8-MEMORY-HUB.md` §7 验收矩阵中，**唯一未完成项是 `[ ] live 验证（用户重启 3080 后）`**；其余（H1–H6、74 断言、35 套件全绿、持久化 restore）均已 `[x]`。
- 调研结论：M8 的问题是**"未启用、未实证"**，而非"设计残缺"。

**前置确认（未确认禁止执行）**：
1. 是否同意将 `memoryHubEnabled` 默认值改为 `true`？
2. 若同意，是否需要保留回滚开关（例如通过设置项或环境变量）？
3. live 验证由谁执行（Agent 只能产出验证清单与断言，无法代替用户重启宿主）？

**目标**：
- 若确认启用：改默认值 + 补回归断言 + 产出 live 验证清单
- 若未确认：**仅产出验证清单，不改任何代码**

**涉及功能模块**：`lib/index.js`（默认值）、`docs/M8-MEMORY-HUB.md`（验收矩阵勾选）。

**验收标准（启用情形）**：
1. `memoryHubEnabled` 默认值改变被明确记录在回报中（旧值 → 新值 + 行号）
2. 三层 store 在启用后能正常 restore（`episodes.json` / `facts.json` 可读）
3. `GET /api/dsh-auto-memory-pre/memory-hub` 返回 overview（`lib/index.js:171` / `:6785`）
4. 五套基线不降

**需先检索的仓库路径与符号关键词**：
- 路径：`lib/index.js`、`docs/M8-MEMORY-HUB.md`
- 关键词：`memoryHubEnabled`、`_memoryHub`、`memory-hub`、`hubIo`、`restore`
- **必须先确认**：① `memoryHubEnabled` 的所有读取点（哪些逻辑因它开关）② `hubIo()` 落盘目录 ③ 端点 `memory-hub` 的 GET/POST 实现行号

**改动边界**：
- ✅ 允许修改（**仅在用户确认后**）：`lib/index.js` 的默认值一行
- ❌ 禁止：未经确认擅自改默认值；同时改多个配置；改三层 store 逻辑
- ❌ 禁止修改：`lib/fact-store-pre.js` 等 M8-1 范围文件（避免与 M8-1 冲突）

**live 验证清单（无论是否启用都必须产出）**：
- [ ] 重启 dsh web
- [ ] 设置页「记忆中枢」分组可见，总开关状态符合预期
- [ ] 记忆面板「记忆中枢」页签：技能 / 事实 / 经历三栏有内容或正确空态
- [ ] `GET /memory-hub` 返回 overview 且无异常
- [ ] 对话若干轮后，`facts.json` / `episodes.json` 有新条目落盘
- [ ] 重启后数据能 restore（不丢）
- [ ] 观察是否有性能异常（内存/响应）

**回滚**：`git checkout lib/index.js`；若已落盘 `facts.json` / `episodes.json`，说明清理方式。

**自检清单**：按 `_COMMON.md` §5 执行。
