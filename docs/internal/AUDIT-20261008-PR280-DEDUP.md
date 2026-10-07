# #280 去重判定（本机现状 vs PR 修复点）

> 生成于 2026-10-08 · 只读取证，未改动任何文件。
> 用途：P1/P2a 车道收口后，据此**只拆取真缺口**，避免重复移植。

---

## 结论速览

| # | #280 修复点 | 本地现状 | 判定 |
|---|---|---|---|
| **A1** | `brief-sync.js` 加 `eventId`（防重复投递） | **文件我们树没有**（#279 才引入）；但我们有 `lib/team-outbox.js` 且**无 eventId** | ⚠️ **真缺口**（同族，需按我们架构补） |
| **A2** | `config-lock.js` 加 `onContention` + `cause` | 我们用 `tryAcquire`（非 `tryAcquireFileLock`）；**无** `onContention`/`cause`；但 `CONFIG_LOCK_BUSY` fail-closed **有** | ✅ **功能等价**，仅缺诊断信息（低价值） |
| **A3** | `hub-io.js` 改逐条快照（`rollbackGlobal`/`rollbackWorkspace`） | 我们用 **dirty 集合**机制（`dirty.add`/`dirty.delete`），"只回滚真改过的库" | ✅ **等价（不同解法）**，不需移植 |
| **A4** | `index.js` 维护归档：**摘要校验通过后才删源** | 有 `_withMemoryMutationPre`、有 T3-1 数据丢失修复；**无** `archivedDigests` / `LOG_CHANGED_SINCE_ARCHIVE` / 归档回读校验 | 🔴 **真缺口** |
| **B** | `a97d287` 归档包进 mutation 事务（防重叠维护者） | **无** | 🔴 **真缺口**（与 A4 同族） |
| **C** | `c79bc04` 保持文档队列顺序 | `memory-writer.js` 的 `_queue` **有**；`index.js` 无 docQueue | ⚠️ **需在拆取时逐 hunk 确认** |

---

## 二、证据（可复算）

### A1 · eventId

```
本地 lib/brief-sync.js        : ★不存在（#279 才有）
本地 lib/team-outbox.js       : 存在，eventId ✘ 无
本地 lib/index.js  eventId    : ✘ 无
```
⇒ #280 的 A1 **改的是 #279 新引入的文件**，无法直接整块套用；但「同步事件带 `eventId` 防重复投递」这个**语义**在我们树上是缺的（`team-outbox.js` 无 eventId）。

### A2 · config-lock 诊断

```
本地 lib/config-lock.js:
  L47: function tryAcquire(file)          ← 我们叫 tryAcquire，非 tryAcquireFileLock
  L91: Object.assign(new Error('config-lock-busy: ...'), { code: 'CONFIG_LOCK_BUSY' })
  L102: throw new Error('config-lock-timeout')   ← 无 cause
  onContention : ✘ 无
```
⇒ **fail-closed 行为正确**（该拒绝时拒绝）；#280 加的是「把底层争用原因带进错误」= **纯诊断增强**。

### A3 · hub-io 回滚

```
本地 lib/hub-io.js（dirty 集合方案）:
  L667: dirty.add(globalDir)
  L668: if (w.dir) dirty.add(w.dir)
  L683: function rollbackBoth()
  L688: if (!dirty.has(dir)) { skipped.push(label + ':not-written'); return }
  L470: dirty.delete(dir)   // 写失败 ⇒ 回滚不得碰它（#231 损毁路径）
```
⇒ 我们的 dirty 集合**已实现同一语义**（只回滚真写过的库；未改动的库一字节不动）。**#280 是另一种实现，属重复建设。**

### A4 / B · 维护归档（**真缺口**）

```
本地 lib/index.js:
  L12314: const archiveDir = path.join(p.projectDir, 'archive')
  L12320: if (text) { await this.writeFull(path.join(archiveDir, log.name), text); archived.push(log.name) }
  L12348: for (const log of oldLogs) {   ← 删除循环
  L12342: // ★ T3-1（2026-09-19）**数据丢失修复**：原实现遍历 `oldLogs` ⇒

  archivedDigests             : ✘ 无
  LOG_CHANGED_SINCE_ARCHIVE   : ✘ 无
  归档写后回读校验            : ✘ 无
```
⇒ **我们的实现是「写归档 → 删源」，删除前不校验归档内容**。若归档写入期间源日志被并发改动，会删掉新内容。#280 补的正是这道校验（source + archive 双摘要）。

⇒ 且 #280 的 `a97d287` 进一步把「读源 + 发布归档」放进**同一个 `_withMemoryMutationPre` 事务**，防重叠维护者发布过期副本 —— 我们也没有。

---

## 三、拆取计划（待 P1/P2a 收口后执行）

**文件冲突现状（这是现在不能动手的原因）**：

| 文件 | #280 要改 | 谁在占 | 何时可动 |
|---|---|---|---|
| `lib/index.js` | +30/−6 | 🔴 **P1**（孤立代理 #281） | P1 落地后 |
| `lib/memory-writer.js` | +6/−4 | 🔴 **P2a**（#263 junction） | P2a 落地后 |
| `lib/hub-io.js` | +19/−10 | ⚪ 空闲 | 可先做（但**等价，不建议**） |
| `lib/config-lock.js` | +6/−5 | ⚪ 空闲 | 可先做（**仅诊断，低价值**） |
| `lib/team-outbox.js` | +15/−4 | ⚪ 空闲 | 可先做（A1 同族） |

**建议拆取顺序（按价值/风险比）**：

1. **A4 + B**（维护归档摘要校验 + 事务化）—— **真数据安全缺口**，价值最高；等 P1 收口后动 `lib/index.js`。
2. **A1**（同步事件 eventId）—— 真缺口；动 `lib/team-outbox.js`（无冲突），可按我们架构补。
3. **C**（文档队列顺序）—— 需先逐 hunk 确认我们 `_queue` 是否已覆盖；若已覆盖则**不移植**。
4. **A2 / A3** —— **建议不移植**（已有等价实现；A2 仅缺诊断信息，A3 是重复建设）。

**移植时的硬纪律**：
- 逐 hunk 拆取，**禁止整块替换**（本仓红线）；
- 每条拆取都要**对照我们已有的等价实现**，避免「两套判据并存」的半修状态；
- 改 `lib/index.js` ⇒ `r26 E3` 锁必须用套件自身表达式真跑复算并重钉；
- 每条修复要有**真执行回归 + 负路径**（变异必红、还原复绿）。

---

<!-- 生成于 2026-10-08 · 只读取证 -->