## fs-retry

- **规模**：2,234 B / 47 行 / 2 个导出符号
- **交付形态**：**简版**（基础设施组；职责 + 同步判定 + 改造要点）

### 职责

**有界 rename 重试**，应对 Windows 下短暂的文件句柄争用（issue #48）。DSH 常持有会话/记忆文件句柄，`fs.rename` 抛 `EPERM/EACCES/EBUSY`；旧实现"一次失败即硬失败"，在并发子代理场景把本可成功的写入判死。

### 对外接口

| 行号 | 符号 | 说明 |
|---|---|---|
| L18 | `RENAME_RETRY_DELAYS` | `[0,50,150,400,1000]` 冻结退避表 |
| L28 | `retryRename(from,to,opts)` | 带退避的重命名 |

### 数据流

```
调用方（原子写、落盘）
   └─ retryRename(from, to, opts)   L28
        for attempt in RENAME_RETRY_DELAYS:   [0, 50, 150, 400, 1000]
          ├─ delays[attempt] 非 0 → await sleep(该值)   ← 是"每次尝试前"的等待，非绝对时刻
          ├─ await fsApi.rename(from, to)
          └─ catch error
               ├─ code ∈ {EPERM, EACCES, EBUSY} 且不是最后一次 → 继续重试
               └─ 否则 → **抛出原始 error**（保留 code/path）
```

### 内部关键实现

**1. 参数校验（首项必须为 0）**

若传入的 delays 不是数组、为空、首项不为 0、或含非有限/负数 ⇒ 抛 `TypeError`。首项 0 保证"立即试一次"，否则第一次写入被无谓延迟。

**2. 不做 unlink/copy 回退 —— 显式设计决策**

文件头 L15-16：*"不做 unlink/copy 回退：调用方各自保留自己的原子性与失败策略（删源再拷会破坏原子性，一旦中途失败会同时丢源与目标）"*。即本模块**只解决瞬时争用**，不承担"换个方式达成目标"的职责。

**3. 只重试瞬时错误码**

`TRANSIENT_RENAME_CODES` 是模块私有常量（未导出），含三个码。`ENOENT` 等真实故障立即抛出，不掩盖。

### 可直接落地的代码片段

**插入位置**：fs-retry.js:28 附近的 `retryRename`。

```js
/**
 * 团队增量落盘 —— 必须走 retryRename，不得裸 fs.rename。
 *
 * 场景：同步拉取下来的补丁要先写 tmp 再原子改名。Windows 下 DSH 常持有文件句柄，
 * 裸 rename 会抛 EPERM/EBUSY ⇒ 同步"偶发失败"，而失败的补丁若不重试会在下一轮
 * 被当成"已应用"跳过（因为游标已推进）⇒ **静默丢数据**。
 *
 * @param {object} io { writeFile, rename, unlink } 注入的 fs 适配器
 * @param {string} target 目标文件
 * @param {string|Buffer} data
 * @returns {Promise<{ok:boolean, error?:string}>}
 */
export async function commitTeamPatchPre(io, target, data) {
  // 与 config-io.js:50 同款：tmp 名必须带 pid + 序号，防同进程并发撞名
  const seq = (commitTeamPatchPre._n = (commitTeamPatchPre._n || 0) + 1)
  const tmp = target + '.damsync-' + process.pid + '-' + seq
  try {
    await io.writeFile(tmp, data)
    await retryRename(tmp, target, { fsApi: io })
    return { ok: true }
  } catch (e) {
    try { await io.unlink(tmp) } catch (_) {}
    return { ok: false, error: (e && e.message) ? String(e.message) : String(e) }
  }
}
```

### 与团队化的关系

**判定：派生重算（Derived）· 纯工具。**

纯重试策略，无状态、无数据。团队化后同步写入也会撞同样的 Windows 句柄争用，**应当复用**，但不需要同步它本身。

### Teamwork 改造要点

1. **团队同步的落盘也必须走它**：任何新增的同步落盘点（下载增量、应用补丁、写同步游标）都要用 `retryRename`，不得裸 `fs.rename`。
2. **退避表可能需要加长**：团队化后同一台机器上并发写更多，1 秒的最长等待可能不够。**建议保持常量冻结、由调用方传 `opts.delays` 覆盖**，而不是改默认值。
3. **不要引入 unlink/copy 回退**：文件头 L15-16 明确"删源再拷会破坏原子性，一旦中途失败会同时丢源与目标"。团队数据更不可丢。

### 风险与回归

- 回归：`RENAME_RETRY_DELAYS` 首项必须为 `0`（立即试一次），构造函数会校验，违反即抛 `TypeError`。
- 只对瞬时错误码重试——`ENOENT` 必须立即抛出，不得被重试掩盖。
