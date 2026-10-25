# 记忆基座整理 · 标准流程（v4 升级迁移 · v3）

> **v3（2026-10-26）修订**：v2 有三处**幻影 API**（子代理照做必然失败）+ 一处过时口径，已全部改正：
>  ① `memory_status({op:'upgrade-done'})` **不存在**（该工具只有 `upgrade-plan`）⇒ 改为「返回总结由宿主自动记 done」；
>  ② `memory_event(scope:'person')` **不存在**（无 scope 参数）⇒ 改为「person 层直接写 event-store 文件」；
>  ③ `completedAt/completedVersion` 全仓 0 命中 ⇒ 删除该段落；
>  ④ 补齐 v4 四类感知（userPercept / agentTrace / sharedGround / commitments），并加入「四段每次变动必重写」。

## 阶段 0：**同意已取得，不要再问用户**

> 用户是在前端「检测到旧版记忆格式」弹窗上**亲手点了「立即派子代理整理」**之后，
> 这个任务才启动的 ⇒ **同意已经拿到**。
>
> ⚠ 你是后台子代理，**没有向用户提问的通道**。若在此要求「先问用户」⇒ 你会永久卡住，
>   整个任务永不结束（实测症状：phase="running"、finishedAt=null、无任何日志）。
> ⚠ 也**不要**试图调用 `memory_status({op:'upgrade-done'})` —— 该 op 不存在，会报错浪费轮次。
>
> ⇒ **直接从阶段 1 开始执行**。原文件会完整备份、永不删除。

---

## 阶段 1：备份（只读原样复制，不修改原件）

复制到 `<ws>/.dsh-memory/backup/<YYYY-MM-DD>-pre-v4/`：

- `~/.dsh/memory/MEMORY.md`（用户规约真源）
- `~/.dsh/memory/workspaces/<wsid>/MEMORY.md`（项目规约真源）
- `~/.dsh/memory/workspaces/<wsid>/handoff/*.md`（PLAN.md + 全部账本）
- `~/.dsh/memory/workspaces/<wsid>/*.md`（每日日志，若有）

记录每份 **sha256** 到 `MANIFEST.json`。**备份未成功 ⇒ 中止，不进入阶段 2。**

---

## 阶段 2：本任务就是你一个子代理，不要再去派子代理

你不是要「再派一个子代理」—— **你自己就是那个子代理**。直接做阶段 3-6。
（v2 这里写「派一个子代理」，会让子代理递归派活、上下文翻倍且难以收敛。）

---

## 阶段 3：五类分拣（每条旧条目归入且只归入一类）

| 类 | 判据（**由模型判断，不许正则**） | 去向（真实 API） |
|---|---|---|
| **人之上的层** | 「这个人是谁」「我们一起经历过什么」「他在意什么」—— 性格、偏好倾向、共同经历、情感记忆、自传 | **L0** 直接写 `~/.dsh/memory/person/event-store.json`（见阶段 4.1） |
| **用户规约** | 「跨项目通用、对我这个人的要求」—— 交付格式偏好、沟通方式约定、禁止行为 | **L1** `memory_user(action:'append')` 或 `memory_rules(op:'add')` |
| **项目规约** | 「这个项目必须怎么做」—— 硬约束、验收纪律、架构决策、路径约定 | **L2** `memory_note(kind:'note', action:'append')` |
| **项目事件** | 「这个项目在做什么、试过什么、失败过什么」 | **L3** `memory_event(action:'create'/'append')`（默认就是本工作区） |
| **纯流水** | 一次性进度记录、临时路径、已过时的计划 | `memory_log(note:...)` 保留可检索，或丢弃（原件已备份） |

### ★★L0 与 L2/L3 的边界

```
判断口诀：换个工作区打开，这条内容还应该在吗？
  应该在            ⇒ L0（人之上的层）或 L1（用户规约）
  只在这个项目有意义 ⇒ L2（项目规约）或 L3（项目事件）
```

**反例（必须避免）**：
- ❌ 把「用户偏好中文回答」写进某个工作区的 MEMORY.md ⇒ 换工作区就没了
- ❌ 把「我们上次一起调这个插件」写进工作区事件库 ⇒ 换工作区就没了
- ❌ 把「本项目端口 56877」写进 person store ⇒ 污染跨项目层

### ★★用户画像 vs 用户规约（用户明确强调，不许混）

- **用户画像 = emotional / 主观 / 生活化 / 情境化**（感觉、印象、相处方式、共同经历）
- **用户规约 = rational / 硬**（每次完整版注入的约定类内容）
- **两者不许混**。一条内容若两者都沾，**拆成两条**，分别落到 L0 与 L1。

---

## 阶段 4：写回（★全部使用真实存在的 API，不得臆造参数）

### 4.1 L0 人之上的层 —— 直接写文件

`memory_event` **没有 scope 参数**，不要把 person 层塞进工作区事件库（换工作区就丢）。
正确做法：读 `~/.dsh/memory/person/event-store.json`（不存在则建），按 event-store 的 16 字段结构追加事件；
每条带 `sections{goal,doing,deadend,next}` 与四类感知。写前先备份，写后 `sha256` 核对。

### 4.2 其余四类

```
L1 用户规约 → memory_user(action:'append', content)          或 memory_rules(op:'add', content)
L2 项目规约 → memory_note(kind:'note', action:'append', content)
L3 项目事件 → memory_event(action:'create', name, summary, sections{goal,doing,deadend,next})
             memory_event(action:'append', eventId, checkpoint{kind,text,panels}, userPercept{...}, agentTrace{...})
L4 纯流水   → memory_log(note, kind:'fact')
```

### 4.3 ★四类感知（v4 核心，缺了就只剩流水账）

`memory_event(action:'append')` 可带四类感知，**必须用**（不是可选装饰）：

- `userPercept` 人类侧观察 `{stage, kind, text}`
  · stage = `retrieved`(被检索到) / `delivered`(被投递) / `used`(真用上) / `mentioned`(被提到) / `accepted`(用户确认)
  · kind  = `preference`(偏好) / `state`(当前状态) / `unfinished-goal`(未完成目标) / `authorResponse`(作者回应：同意/否定/纠正/补充/质疑/拍板)
  · ★只有 `accepted` / `used` 会进「用户画像」段注入，其余是噪声
- `agentTrace` 你做了什么 `{action, result, wasRefuted}`
- `sharedGround` 已达成的共识 `{claim, confirmedBy, correction}`
- `commitment` 你对用户的承诺 `{promise, boundary, state:'open'/'kept'/'dropped'}`

**只在实质性进展时写感知**（新结论 / 验收结果 / 交付物落盘 / 用户新裁定）；纯读取、纯等待、重复确认**不算**。

### 4.4 ★四段每次变动必重写

`sections{goal,doing,deadend,next}` **反映当前状态，不是历史累积**。
每次 append 检查点后、或事件状态有任何变化时，用 `memory_event(action:'set', eventId, sections:{...})` 把四段整体重写一遍。
**只追加检查点而不更新四段 = 四段变成陈年快照。**

**每一类最多一个批次，写完立刻自检，不要边写边判。**

---

## 阶段 5：自检（缺一不可）

1. **条目数守恒**：旧文件总条目 N = 新五类条目之和（允许 ±0，不允许丢）
2. **抽查 10 条**：随机取旧条目，确认内容在新位置可检索到
3. **画像纯度**：`[用户画像]` 段里**不得出现技术规范**（用 3 条已知技术规范做反例）
4. **规约纯度**：`[项目规约]` 段里**不得出现性格/生活偏好**
5. **层归属**：person store 里**不得出现项目路径 / 项目名 / 端口号**
6. **L0 独立可用**：换一个工作区打开，`[用户画像]` 段**仍必须有内容**
7. **原文件 sha256 未变**（证明只备份没改）
8. **无幻影 API 调用**：全程不得出现 `memory_status({op:'upgrade-done'})` 或 `memory_event(scope:...)`

---

## 阶段 6：返回报告（完成状态由宿主自动记录，你不需要上报）

★**不要**调用任何「上报完成」的 API —— `completedAt/completedVersion` 在全仓不存在。
宿主侧 `startUpgradeJobPre` 会在**你返回非空总结**时自动写 `phase:'done'` 并弹窗展示。

所以你唯一要做的是：**在最终回复里给出一份人类可读的总结**，格式如下：

```
## 整理报告
| 旧位置 → 新位置 | 条数 | 示例 |
|---|---|---|
| 用户 MEMORY.md → L1 用户规约 | N1 | 「…」 |
| 用户 MEMORY.md → L0 人之上的层 | N2 | 「…」 |
| 项目 MEMORY.md → L2 项目规约 | N3 | 「…」 |
| 项目 MEMORY.md → L3 项目事件 | N4 | 「…」 |
| 旧日志 → memory_log | N5 | — |

自检结果：7 项全过（逐条列出实测值）
备份位置：<ws>/.dsh-memory/backup/<date>-pre-v4/（sha256 已记录）
```

---

## 禁止事项

- ❌ 不许一次删除原文件（只备份，永不删）
- ❌ 不许用正则猜「哪条是偏好」（实测准确率仅 20%，必须模型判断）
- ❌ 不许再问用户是否同意（已取得；且你没有提问通道）
- ❌ 不许再派子代理（你自己就是）
- ❌ 不许在备份失败时继续
- ❌ 不许把 L0 内容写进任何工作区（换工作区就丢）
- ❌ 不许把项目内容写进 L0（污染跨项目层）
- ❌ 不许调用不存在的 API（`upgrade-done` / `scope` 参数）—— 见阶段 0 与 6
- ❌ 不许因为「跑得久」就提前收尾：本任务**无超时**，宁可慢也要按流程走完
