# 升级引导弹窗 · 方案 v2（2026-10-25 18:00，用户第四轮裁定后重写）

> v1 的 Q1–Q4 四项建议**全部被用户裁定修正**。本文是 v2，**v1 作废**。

## §0 · 用户第四轮裁定（逐字）

### 裁定 1：版本标记复用现有载体，阈值 < 3.3.18
> 「这版本标记，因为要考虑旧版本和新版本，所以**尽量还是复用现有的标记就行**比如说**更新记录**一类的，**检测低于 3.3.18 的都需要提醒**」

**实测**：`package.json` 当前版本 = **3.3.17** ⇒ 本批改造后即 **3.3.18**，与用户给的阈值精确吻合。
**复用**：`CHANGELOG.md`（247,796 B，已有完整版本历史）+ `API.updateCheck`（已存在，读包 version）⇒ **不新建 `.memory-schema.json`**。

### 裁定 2：「稍后」= 3 天
> 「要点稍后，以后可以 **3 天**吧」
⇒ v1 建议 7 天，**改为 3 天**。

### 裁定 3：子代理进 workbench 会话，但★工作区与「事之上的人」必须分层
> 「子代理可以扔到记忆中枢 workbench 会话，但是注意，**各个工作区的内容要分清，不能混为一谈**。**工作区之上是"事儿之上的人"的部分**，也就是**总体的用户画像、共同记忆这一类**，也要分清，**不能扔到工作区里面去**。这样的话，**切换工作区会丢失用户的记忆**」

**这是本轮最重要的一条** —— 它指出的正是当前实现的**真缺陷**：
```
现状实测（Lead 亲查）：
  refreshEventStatePre(L8597) 读的是  path.join(p.handoffDir, event-store.json)
  ⇒ 事件库是【每工作区一份】
  真盘实测：workspaces/--D--dsh-auto-memory--/handoff/event-store.json  406,320 B
            workspaces/--C--Users-JH Z-.dsh-aik_auto_memory_use--/...     57,789 B

  而用户画像 buildUserPortraitPre(L8670) 的输入 = 该工作区的 events.map(e => e.userPercept)
  ⇒ 画像也是【每工作区一份】

  ⇒ 用户换个工作区，画像/共同记忆就没了 —— 正是用户说的「切换工作区会丢失用户的记忆」
```

### 裁定 4：完成信号由 AI 报告后检测
> 「完成信号，这个能不能让 **AI 完成之后报告一下**，然后检测」
⇒ v1 建议「轮询 schemaVersion」，**改为「AI 回报 + 检测」双保险**。

### 裁定 5：Teamwork 版本不一致 ⇒ 暂停同步，直到双端都更新并同步完成
> 「一定要注意，**如果有一个旧版本的记忆，这个同步功能应该暂停并且向用户汇报**。**直到用户更新到新版本并完成同步，双端才可再次同步**」
> 「（看一下这个 teamwork 同步些是否也应该按需修改出个修改方案去进行做）」

### 裁定 6：四项收尾工作（全部在施工完成后做，施工中不做）
> 「同时，**完成所有修复之后**，还需要进行以下改动：
> 1. **白皮书**：需要进行修改。
> 2. **README**：应该有相应的改动。**但是，改动之前让我多批准一下，这个 README 是向外的，需要谨慎一点**
> 3. **欢迎界面（新用户引导界面）**：应该有相应的改动，比如那些**开关和说明**。
> 4. **设置界面**：应该有相应的改动，**把那些失效的按钮关掉，替换成新的设置按钮与相应的解释**。
> 以上四件事情是**做完所有事情之后再做的**。在施工当中呢，可以不做」

---

## §1 · 分层模型（裁定 3 的落地）★核心设计

### 1.1 现状：只有「工作区层」，没有「人之上的层」

```
~/.dsh/memory/
├── MEMORY.md                     ← 用户级记忆（跨工作区）✅ 已有
├── CALENDAR.md                   ← 日历 ✅ 已有（跨工作区）
├── global-brief.json             ← 全局简报 ✅ 已有
├── hub/                          ← 记忆中枢数据 ✅ 已有
├── workspaces/
│   ├── --D--dsh-auto-memory--/
│   │   ├── MEMORY.md             ← 项目规约（本工作区）
│   │   ├── handoff/event-store.json  ← 事件库（本工作区）❌ 画像从这里算
│   │   └── 2026-10-25.md         ← 日志（本工作区）
│   └── --C--...-aik_auto_memory_use--/ ...
```

**⇒ 缺的正是「事之上的人」的事件层**：用户画像 / 共同经历 / 情感记忆目前**寄生在工作区事件库里**，换工作区就丢。

### 1.2 目标分层

| 层 | 位置 | 内容 | 跨工作区？ |
|---|---|---|---|
| **L0 人之上的层（person）** | `~/.dsh/memory/person/event-store.json`（新增） | **用户画像 / 共同经历 / 情感记忆 / 自传** | ✅ **是**（换工作区不丢）|
| L1 用户规约 | `~/.dsh/memory/MEMORY.md` | rational 硬约定（跨项目通用）| ✅ 是 |
| L2 项目规约 | `workspaces/<wsid>/MEMORY.md` | rational 硬约定（本项目必守）| ❌ 否 |
| L3 工作区事件 | `workspaces/<wsid>/handoff/event-store.json` | 项目在做什么、试过什么、失败过什么 | ❌ 否 |

**关键判据**：
- 用户画像段 = **L0 的 userPercept ∪ L3 的 userPercept**（L0 优先，L3 补充本项目观察到的人格特征）
- **但 L0 必须能独立工作** —— 新工作区（L3 空）时画像仍要出（现在出不来）

### 1.3 迁移时五类分拣的目标位置（修正 v1 的提示词）

| 类 | 去向（v2 修正）|
|---|---|
| 用户画像 / 共同经历 / 情感 | **L0 person store**（`memory_event` 加 `scope:"person"`）|
| 用户规约 | **L1** `~/.dsh/memory/MEMORY.md` |
| 项目规约 | **L2** `workspaces/<wsid>/MEMORY.md` |
| 事件（本项目的）| **L3** `workspaces/<wsid>/handoff/event-store.json` |
| 纯流水 | memory_log / 或丢弃（原件已备份）|

---

## §2 · 版本检测（裁定 1）

### 2.1 复用现有载体，不新增文件

| 需求 | 复用 |
|---|---|
| 当前版本号 | `engine.checkUpdate()` 已返回 `current`（读包 version）|
| 版本历史 | `CHANGELOG.md`（已有 247,796 B / 完整版本段）|
| 阈值 | **`MEMORY_V4_MIN_VERSION = "3.3.18"`**（模块级常量）|

### 2.2 判据

```
compareVersion(current, "3.3.18") < 0  ⇒ legacy=true，弹窗
current >= "3.3.18"                    ⇒ legacy=false，不弹
current 无法解析                        ⇒ 视为旧版（保守，但要 diag 记录）
```

**⚠ 实测发现**：`package.json` 当前是 **3.3.17** ⇒ **本批改造必须把版本号推到 3.3.18**，否则判据恒真（自己也弹窗）。

**⚠ 版本比较函数全仓 0 处** ⇒ 需新建 `compareSemverPre(a,b)`（约 20 行，处理 `3.3.17` / `3.3.18` / `3.3.18-beta.1`）。

---

## §3 · 弹窗（裁定 2）

五相位同 v1，**只改两处**：

| 项 | v1 | v2 |
|---|---|---|
| 「稍后」冷却 | 7 天 | **3 天** |
| 完成信号 | 轮询 schemaVersion | **AI 回报 + 检测双保险** |

### 3.1 「稍后」3 天的存法

```
localStorage["damMemoryUpgrade.declinedAt"] = Date.now()   ← 前端（用户点「稍后」时写）
注入侧还要知道（否则注入里每轮仍提醒）⇒ 存后端
⇒ 存 ~/.dsh/memory/upgrade-consent.json = { declinedAt, declinedVersion, remindAfterMs: 259200000 }
```

**判据**：
- `now - declinedAt < 3 天` ⇒ 弹窗不弹；**注入提醒降级为一行 ≤40 字**（不是全消失，否则用户永远想不起来）
- `>= 3 天` ⇒ 恢复完整提醒 + 再弹一次

---

## §4 · 完成信号（裁定 4）

```
① 子代理整理完毕 ⇒ 调 memory_status({op:"upgrade-done"}) 上报（这是「AI 完成之后报告一下」）
② 该调用写 ~/.dsh/memory/upgrade-consent.json = { completedAt, completedVersion, itemCounts }
③ 弹窗每 2s 轮询 GET /config 或 /memory-status 读该文件 ⇒ 看到 completedAt 即转 done 相位
④ 兜底：即使 AI 忘了上报，弹窗也能通过「版本 >= 3.3.18 且 legacy=false」判完成
```

**为什么双保险**：AI 可能忘记调工具（模型行为不可靠）；但只靠检测又会出现「AI 还在跑、检测说完了」。**AI 主动上报 = 主信号，检测 = 兜底。**

---

## §5 · Teamwork 版本闸门（裁定 5）★需要修改 team-sync

### 5.1 现状实测

| 项 | 实测 |
|---|---|
| `lib/team-sync.js` | 10,486 B / 285 行，**纯心跳传输层** |
| 同步内容 | 只发 `outbox` 队列（`{kind,key,idemKey,at,payload,member}`）|
| **版本字段** | **payload 里没有版本** ❌ |
| **版本闸门** | **不存在** ❌ |
| 传输 | 客户端推送（`api/team/sync/push`），服务端不主动推 |

### 5.2 修改方案（三处）

**M1 · 上行 payload 带版本**
```js
// team-sync.js makeSenderPre 的 payload 增加：
dataVersion: { pluginVersion: "<3.3.18>", memoryFormat: "v4" }
```

**M2 · 下行/握手拿到对端版本**
```
新增只读检测：engine._teamPeerVersion（从服务端 teamState 或心跳响应里读）
⚠ 不改路由数：塞进现有 teamState 响应，不新增端点
```

**M3 · 闸门（核心）**
```js
function teamSyncGatePre(localVer, peerVer) {
  if (!peerVer) return { ok: true, reason: "peer-unknown" }        // 未知不阻
  const c = compareSemverPre(localVer, peerVer);
  if (c === 0) return { ok: true, reason: "same" };
  const older = c < 0 ? "local" : "peer";
  return {
    ok: false,
    reason: "version-mismatch",
    older,                       // 谁是旧版
    action: older === "local" ? "update-this-machine" : "update-other-machine",
  };
}
```

**闸门位置（三处，缺一即半修）**：
1. `tick()` 入口 —— 不一致 ⇒ 直接 `{skipped:true, reason:"version-mismatch"}`，**不发任何请求**
2. `start()` —— 不一致 ⇒ 不建定时器（零行为，对齐「teamEnabled=false ⇒ 零行为」纪律）
3. `status()` —— 返回 `gate` 字段供前端渲染

### 5.3 「直到双端都更新并同步完成才恢复」怎么判定

```
暂停条件：localVersion !== peerVersion
恢复条件（三条同时满足）：
  ① localVersion >= MIN_VERSION
  ② peerVersion    >= MIN_VERSION
  ③ 双方都上报过「已完成整理」⇒ upgrade-consent.json 有 completedAt
⇒ 任一不满足 ⇒ 继续暂停 + 明确通知用户
```

### 5.4 用户侧通知（复用弹窗 conflict 相位）

```
标题：检测到两台机器的记忆版本不一致

  本机：v3.3.17（旧版，未整理）
  对端：v3.3.18（新版，已整理）
  同步已暂停 —— 避免把新旧格式混在一起。

建议操作（按顺序）：
  1. 先在两台机器上都更新到 v3.3.18
  2. 不要在这台机器上点「一键调用子代理」去整理
  3. 如果另一台机器已经整理完毕，点下面按钮从远端同步：

按钮：[我有另一台机器已整理完毕，从远端同步]
      [打开「记忆中枢」查看详情]
      [稍后处理]
```

**⚠ 关键**：同步暂停时，**弹窗必须比升级弹窗优先级高**（否则用户先点整理，产生两份不一致数据）。

---

## §6 · 施工顺序（v2 修正）

```
H3 主线（C3 → B → D → E → 迁移演练）        ← 当前，不动
  ↓
U1 分层：person store（L0）+ 画像数据源切换     ← 裁量 3 的地基，必须先做
  ↓
U2 版本比较 + 版本闸门（服务端）
  ↓
U3 弹窗（offer/building/done/declined）+ 3 天冷却
  ↓
U4 Teamwork 闸门（M1/M2/M3 + conflict 相位）
  ↓
U5 完成信号上报（memory_status op:upgrade-done）
  ↓
【收尾四件 · 用户明令「做完所有事情之后再做的」】
D1 白皮书 docs/WHITEPAPER.md（24,362 B）
D2 README —— ⚠ 改写前必须先给用户批准（用户原话「这个 README 是向外的，需要谨慎一点」）
D3 欢迎界面（新手引导 tour：开关与说明）
D4 设置界面（关掉失效按钮，替换新设置 + 解释）
```

**U1 必须先于 U3/U4**：弹窗和 Teamwork 闸门都依赖「版本标记存哪」，而版本标记依赖分层决策。

---

## §7 · 收尾四件（裁定 6）—— 只登记，施工中不做

| # | 对象 | 实测大小 | 待改内容 | 前置批准 |
|---|---|---|---|---|
| D1 | `docs/WHITEPAPER.md` | 24,362 B | v4 三动作（事件第一等单元 / 情境化主动记忆 / 规约分层）+ 分层模型 | 无需 |
| D2 | `README.md` / `README.zh-CN.md` | 64,347 / 57,799 B | v4 说明、版本要求 3.3.18、升级流程 | **⚠ 需用户逐段批准** |
| D3 | 欢迎界面（`welcome tour` / `fWelcomeTour`）| — | 新增 v4 说明步骤；关掉已失效的开关说明 | 无需 |
| D4 | 设置界面 | — | **关掉失效按钮**（如 `memoryHub` 旧开关）、替换为新设置项 + 解释文案 | 无需 |

**D4 需要先做一次「失效按钮普查」**：列出设置页所有开关 → 逐个验证它是否还有真实效果 → 出清单 → 用户确认后改。
**不能凭感觉判定「这个按钮失效了」** —— 那是自创。

---

## §8 · 待用户确认（v2 只剩 2 项）

| # | 事项 | 我的建议 |
|---|---|---|
| **Q1** | 版本号推到 **3.3.18**（当前 3.3.17）| 必须做，否则「检测 < 3.3.18」判据恒真、自己弹自己 |
| **Q2** | person store 路径 `~/.dsh/memory/person/event-store.json` | 与 `hub/` 平级；不动现有 16 字段契约（是**新文件**不是加字段）|

**其余全部按用户裁定执行，不再问。**
