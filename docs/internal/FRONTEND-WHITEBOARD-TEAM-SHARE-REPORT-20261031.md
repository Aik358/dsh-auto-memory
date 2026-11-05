# 前端线报告 · 记忆窗格「白板」去留 + 团队共享线施工纲要

> 生成 2026-10-31 · 依据：实测代码 + 实测数据（非推断）

## 一、先纠正一个前提（重要）

你说的「白板账」和「白板看板」，在记忆窗格里其实是**同一个页签**，不是两个：

```
MEMORY_TABS() 实测 14 个页签（lib/client.js:13780-13781）:
  overview / logs / refine / hub / storage / notes / **plan** / reflections / team / connect / calendar / search / workspaces / stats
planTab 的显示名 = 「白板」（中）/ 「Whiteboard」（英），L289 / L637
```

「白板看板」不是记忆窗格里的第二个页签——它是 **plan 页签内部**的一块渲染（L11694 `data-dam-event-surface` 挂 EventView）。
所以「把白板看板这一列从记忆窗格剔除、只保留一个入口」——**现在就已经是单入口了**，没有第二列可删。

## 二、你看到「还显示流水账」的真正原因

不是旧检测逻辑没改，而是**它统计的东西和你想的不是一回事**：

| 事实 | 实测值 |
|---|---|
| `/event-unarchived` 返回 | `total 615 / archived 23 / **unarchived 592**` |
| 它的口径 | `scan.ledgers`（handoff 目录下的**四段账本 .md 文件**）减去「被某事件检查点 sourceRef 引用过的」 |
| 判定为「已归档」的条件 | 某个 checkpoint 的 `sourceRef` 恰好等于该 .md 的 basename |

关键点：**它数的是 .md 文件，不是白板、不是看板、不是事件**。
所以你说的「我这都已经修好了」——如果指的是「白板/事件视图已经能正常显示」，那**不影响这个计数**；
只要 handoff 目录里还有 592 个历史账本 .md 没被任何事件「认领」，提示条就会一直显示。

⇒ 真正要做的不是「隐藏一个页签」，而是**把这条提示条的判据和数据源改对**（或按你的意思直接停用）。

## 三、三种处理方案（按你的风险评估排序）

### 方案 A（推荐 · 风险最低 · 不删任何东西）

把提示条的**显示条件从「unarchived > 0」改成「unarchived > 0 且 当前是 legacy 口径」**，
并给一个配置开关 `showLegacyConvertBanner`（默认 false）。

- 改动量：`lib/client.js` 1 处条件 + `DEFAULT_CONFIG` 1 键 + 设置页 1 项
- 撞锁评估：B-1 键数锁会 +1（要同步 verify-docs 5 处 + r26 哈希）；`unarchived` 47 处断言**不碰**
- 风险：低。组件代码全保留，随时可开关回来

### 方案 B（你要的「删掉」· 中风险）

删 `EventConvertPanel` 组件 + 它的挂载点 + 后端 `/event-unarchived` 路由。

- 会红：`smoke-test-v4-h10-convert-wiring.mjs`（B 段真 vm 求值 EventConvertPanel，L181 定位）、
  `smoke-test-issue392-393-continuation-ui.mjs`（L12 明说本段含 EventConvertPanel）、
  `smoke-test-v4-d2-unarchived.mjs`（35 PASS，专门守这个路由）、r26 路由数守恒锁 80→79
- 风险：中高。四套守卫要同批改写，且 `/event-unarchived` 被事件视图统计卡复用（L6571「未归档账本」卡片）

### 方案 C（折中 · 我建议先做这个，再决定要不要 B）

**只隐藏 UI，不动后端**：把 `convUnarchived` 传 0（或加开关短路），组件与路由原样保留。

- 改动量：`lib/client.js` 1 行
- 撞锁：**零**（组件定义、路由、stat 卡全部不动）
- 效果：提示条立刻消失；数据仍可取回（只是不显示）
- 代价：`/event-unarchived` 变成「有路由无 UI」——但这本来就是它现在的状态（你说「反正现在本来也看不到了」）

## 四、守卫锁测绘（改前必读，实测）

```
tests/smoke 套件总数           533
其中读 lib/client.js 的         164
MEMORY_TABS 相关断言           33 处
unarchived 相关断言            47 处
EventConvertPanel 相关          7 处
```

| 锁 | 文件:行 | 本批是否撞 | 对策 |
|---|---|---|---|
| 经典档 sha256 锁 | smoke-test-iter5-skin.mjs:423 | 改 client.js **必红** | 按实测重钉 + 写归因 |
| 设置键计数锁 | smoke-test-v5-p1-inject-throttle.mjs C-2 | 加配置键才撞 | 同步白皮书 + 5 处文档 |
| 路由数守恒 = 80 | smoke-test-r26-cross-layer.mjs:832 | 删路由才撞 | 方案 C 不撞 |
| PlanTab 内看板取数 = 0 | smoke-test-r26-cross-layer.mjs:83 | 不撞（负向锁） | 无需动 |

## 五、施工纲要（前端线）

**F-1（先做 · 方案 C）**：`lib/client.js` 让 `convUnarchived` 恒 0 或加 `showLegacyConvertBanner` 开关短路。
验收：`node --check lib/client.js` → `build-iter5-skin --check` SYNC-OK → `smoke-test-iter5-skin` 重钉 → 全量回归。

**F-2（可选 · 方案 A）**：把开关做成设置项，让用户能自己决定显示与否。

**F-3（清账 · 与共享线耦合）**：592 篇未归档账本的真正处理——
这件事**必须走你定的顺序**：先暂停同步 → 迁移完 → 再开同步。见下一节。

## 六、团队共享线：现状 vs 你要的三段状态机

你的三条要求与实测实现的对照：

| 你的要求 | 现状 | 差距 |
|---|---|---|
| ① 情况不对立刻暂停同步 | **部分有**：版本不一致时三道闸门（skipped / 不建定时器 / 前端可渲染原因）| 缺「用户手动暂停」「数据不一致时暂停」两种触发 |
| ② 先更新好一个、迁移好所有数据 | **无** | team-sync.js 424 行里 `migrate` / `ledger` / `plan` 命中 **0**；没有迁移态 |
| ③ 然后再打开同步 | **无** | `pause` / `resume` 命中 **0**；没有状态机 |

实测：`team-sync.js` 有 `TEAM_SYNC_MEMORY_FORMAT_PRE = v4` 与 `teamSyncGatePre`（版本闸门），
但**没有任何「暂停 → 迁移 → 恢复」的状态与迁移通路**。

### 共享线施工纲要（S-1 ~ S-4）

**S-1 状态机**：给 sync 加三态 `running / paused / migrating`，并存盘（重启不丢）。
  · 暂停入口：①手动 ②版本闸门命中 ③数据不一致 ④迁移进行中
  · 判据：paused 时 `push` 与 `pull` **都并发 0 请求**（要能测出来，不是看标志位）

**S-2 迁移**：把 592 篇未归档 .md 按事件归属回填（`sourceRef` 指向 basename），
  使 `unarchived` 从 592 → 0。这是**②的实体内容**，也是前端线 F-3 的同一件事。
  · 必须幂等、可中断续跑、带前后备份（本仓既有「非幂等破坏性脚本」纪律）

**S-3 恢复闸门**：只有 `unarchived === 0` 且 迁移校验通过 ⇒ 才允许 resume；否则拒绝并说明原因。

**S-4 可观测**：`team-sync-debug` 路由暴露 `{state, pausedReason, migratedCount, remainingCount}`，前端能显示「为什么停」。

## 七、我建议的推进顺序

1. **F-1**（1 行，零撞锁）—— 立刻让提示条消失，你今天就能看到效果
2. **S-1 + S-4**（状态机 + 可观测）—— 没有它，后面的迁移不敢开场
3. **S-2**（592 篇迁移）—— 真正的账要清，且这是共享线「②」的实体
4. **S-3**（恢复闸门）—— 收口
5. 回头看要不要做方案 B（真删）—— 到那时提示条早已不显示，删不删都不急了

## 八、边界与未验证

- 592 这个数是**当前工作区**（D:\dsh-auto-memory）的实数；其他工作区未测。
- 「迁移后 unarchived=0」是设计目标，**未实测**——需要先抽 10 篇验证 sourceRef 回填能被 `archived.has()` 认到。
- 我**没有改任何前端代码**：按你的要求，先出报告。F-1 等你点头再动。