# 91 · R16 下行接住 member（旁挂索引）端到端补测

> 依据：70 卷 R16 行「★第 1 条必做项补强：下行接住 member —— 16a 四判据补测；16b 隔离路径补测」；
> 权威卷 **37 卷 §1 全文**（用户逐字裁定：**旁挂索引方案**，不许把作者写进 Markdown）；61 卷 §四（四条验收判据）。

## 一、开工勘察（决定本轮做什么，实测）

| 项 | 实测 |
|---|---|
| `lib/team-pull.js` | **9,643 B** / sha16 `374908B284315D00` / 252 行（**已存在**）|
| `lib/team-attribution.js` | **8,147 B** / sha16 `694E1D6644E63E77` / 213 行（**已存在**）|
| `team-merge.js` 补 `recordRejected` | ✅ 已补 |
| index.js 接线 | 5 处：import ×2 / `createTeamAttribution` ×1 / `createTeamPuller` ×1 / `onApplied → _teamAttributionRecord` ×1 |
| 既有验收器 | `verify-team-pull.mjs` **PASS 58/0**；`verify-team-attribution.mjs` **PASS 47/0** |

⇒ **B6 与 3.1 均已交付**。但发现一个**真实缺口**（见 §二）。

## 二、★本轮发现并补上的缺口：**跨模块契约从未被端到端验过**

| 验收器 | 它对 onApplied 的处理 | 后果 |
|---|---|---|
| `verify-team-pull.mjs` | 用**桩**接 `onApplied`（只断言被调用）| 不知道真 attribution 收不收得下 |
| `verify-team-attribution.mjs` | **直接**调 `record()` / `recordMany()` | 不经过 puller |

⇒ 两处**各测各的** ⇒ 「puller 喂给 attribution 的形状是否对得上」**从未被真跑验过**。
这正是本仓纪律「同一语义不得写两份判据、跨模块接缝必须真跑」所指的盲区。

### 契约核对（读源码派生，非猜测）

```
team-pull.js:142   onApplied({ key: ch.key, member: ch.member || res.member || null, op: ch.op || kind })
team-attribution.js:79   function record(key, member, op)      // { id,name } 或 { memberId,memberName } 双命名兼容
                     :89   if (!memberId && !memberName) return { ok:false, reason:'no-member' }
```

**触发时机**（`team-pull.js:137→141`）：`onApplied` **只在 applied 计数之后**触发；被拒路径（L116/L121/L105/L97）**提前 return** ⇒ **被拒条目不会写归属**（设计正确）。

## 三、新建验收器 `tools/verify-r16-e2e.mjs`（**真串两个真模块**）

| 路径 | 断言 |
|---|---|
| **正路径** | 下行含 `member:{id,name}` ⇒ `attribution.get(key).memberId === 'u-alice'`（37 卷正路径逐字）· op 透传 · size=1 · 写次数=1 · schema=1 |
| **正路径 2** | `member` 只在 `res.member` 上 ⇒ 兜底同样落盘 |
| **负路径 A** | 条目**缺 member** ⇒ 主流程仍 applied=1，但归属 **size=0**、`get` 返回 **null（无空占位）** |
| **负路径 B** | 条目被 **Gate 拒** ⇒ applied=0 / rejected=1 / **归属 size=0**（onApplied 未触发）|
| **负路径 C** | **非法 op** ⇒ 归一为 `edit`（不是原样透传），且落在源码 `OPS_PRE` 合法集合内 |
| **隔离路径** | `teamEnabled=false` ⇒ puller 返回 `team-disabled`、**写次数=0**、`toJSON` 无条目（**老用户零新增文件**）|
| **幂等** | 同 key 再来一条（不同作者）⇒ size 仍为 1、取**最新作者** |

**结果：PASS 31 / FAIL 0 — ALL GREEN**

## 四、★守卫反向验证（证明断言不是恒真）

变异 `team-pull.js` 的 `onApplied` 把 `member` 恒置 `null`：

```
变异前 sha16 = 374908B284315D00
变异后跑 e2e ⇒ ★11 条断言 FAIL（P6/P9/P10/D1/D2/N7/N8/N9 …——报可读 FAIL，非崩溃）
还原后 sha16 = 374908B284315D00（字节级复原）⇒ 复跑 PASS 31 / FAIL 0
```

★过程中修正一处**自己的缺陷**：首次变异时 e2e 以 `TypeError: Cannot read properties of null` **崩溃退出**而非报 FAIL ⇒ 在 CI 里不可读。已改为防御式断言（`const dup = att.get(k); eq(dup && dup.memberId, …)`）。

## 五、★本轮修正的期望值错误（第 3 条纪律重犯）

P5 初次期望 `op === 'add'` —— **实测得 `'edit'`**。核源码：`OPS_PRE = ['create','edit','merge','delete','resolve']`，**`'add'` 不在合法集合**，被 `normOpPre` 归一。
⇒ 改为**从源码现读派生**（`OPS_PRE` 用正则从 `team-attribution.js` 提取），不再手写。

## 六、交付物理量（可复算）

| 项 | 值 |
|---|---|
| `lib/*` | ★**零改动**（本轮只新增工具文件）|
| `lib/client.js` | **839,766 B** / CRLF 9,284 / sha16 `9DD1BC492CD6E5A1`（不变）|
| 新建 | `tools/verify-r16-e2e.mjs`（**31 条断言**）|
| 临时脚本 | **残留 0** |

## 七、八项复核（全绿）

| 项 | 实测 |
|---|---|
| `node --check` ×6 | **0 / 0 / 0 / 0 / 0 / 0**（含 team-pull / team-attribution）|
| 加载守卫（真执行 factory）| **PASS 17 / FAIL 0** |
| graph-mode | **35 passed / 0 failed** |
| 面板守卫 | **PASS 38 / FAIL 0** |
| 全量回归 | **PASS 204 / FAIL 0 / TIMEOUT 0**（62.9s）|
| `tools/verify-docs.mjs`（单跑）| **全部一致** |
| R16 e2e | **PASS 31 / FAIL 0** |
| team-pull / attribution | **58/0** / **47/0** |
| 扫描器复跑 | **hex 0 / rgba 0** |
| 守卫反向验证 | **变异⇒11 FAIL；还原⇒sha16 复原⇒复绿** |

## 八、R16 结论

**37 卷 §1 四条判据已全量闭合，并补齐了「跨模块端到端」这条此前缺失的验证维度**：
1. 正路径 ✅（作者 = 上传者 id，端到端）
2. 负路径 ✅（缺 member / 被 Gate 拒 / 非法 op 三条）
3. 隔离路径 ✅（`teamEnabled=false` ⇒ 零写入、零新文件）
4. 可复算物理量 ✅（字节数 + sha16 + 条目数 + 写次数）

⇒ **团队层 R16 完成**。下一步 **R17**（记忆页签 ↔ 左下角浮窗读同一套数据，守 `MEMORY_TABS()` 计数锁 = 2）。

