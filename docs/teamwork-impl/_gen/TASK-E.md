# TASK-E · B4 同步心跳（纯新增文件，不改任何既有文件）

> **只创建一个文件**：`D:\dsh-auto-memory\lib\team-sync.js`
> **绝不修改** lib/index.js、lib/client.js、lib/team-*.js、package.json、tests/。
> index.js 的装配由 Lead 串行完成（单写者）。

## 背景

团队版同步 = **客户端推送 + 客户端拉取**，服务端不主动推。心跳 tick 负责：
1. 把 B3 出站队列里排队的变更**批量发出**（`outbox.flush(sender)`）
2. （B4 只做传输层；下行合并/冲突裁决是 B6，**本批不实现**）

## 必须先读的既有契约（**不要猜 API，去读文件**）

| 文件 | 你要看的 |
|---|---|
| `lib/team-outbox.js` | `createTeamOutbox` 返回的 `flush(sender)` / `size()` / `load()` 精确签名与返回形状 |
| `lib/team-auth.js` | `createTeamFetch` 返回对象的**精确方法名与返回形状**（四状态） |
| `lib/team-identity.js` | `currentMember()` / `describe()` 形状 |

⚠️ **`sender` 契约（B3 明确补充，务必遵守）**：`outbox.flush(sender)` 中，**sender「正常返回」即视为已发出，该条会被出队；若你选择不发，必须 `throw`**，否则消息丢失。
投递语义 = **at-least-once**。

## 硬性 API 契约

```js
export function createTeamSync({ engine, identity, outbox, teamFetch, diag, now })
```

返回对象必须含：
| 方法 | 语义 |
|---|---|
| `start()` | 启动心跳定时器。**幂等**（重复调用不产生第二个定时器） |
| `stop()` | 停表并清理。幂等；停后再 start 可恢复 |
| `tick()` | 单次同步（async）。**单飞**：已在途直接返回 `{ skipped: true }` |
| `status()` | 只读快照 `{ running, lastAt, lastOk, lastError, consecutiveFailures, nextDelayMs }` |

## 必须遵守的硬纪律（违反即失败）

1. **`teamEnabled=false` 零行为**：`start()` 直接返回、**不建定时器、不联网、不读盘**。
2. **定时器必须 `unref()`**（存在时）——心跳绝不能让进程无法退出。
   判据：`typeof t.unref === 'function'` 时调用。
3. **单飞闸门：「检查→置位」之间不得插入 await**（TOCTOU，本仓已踩过）。
   置位必须**紧贴**检查之后；所有早退路径必须经**幂等释放函数**统一释放。
4. **退避**：连续失败按 `base * 2^n` 退避，**设上限**（如 30s），成功后**重置**。
   退避值必须能从 `status().nextDelayMs` 观测到（测试要断言）。
5. **所有异常降级、绝不抛**：`tick()` 内任何 throw ⇒ 记 diag + 计入 consecutiveFailures，不向外抛。
6. **`stop()` 后不得再有任何网络/落盘**（防「停表后仍在途」的幽灵写入）。
7. 行尾 **CRLF**；ESM；**不新增任何 npm 依赖**。

## 边界要求

- `outbox` / `teamFetch` / `identity` 缺省或形状不对 ⇒ **降级不抛**（记 diag，tick 返回失败态）。
- 未配置（如 `identity.currentMember()` 返回 `ok:false`）⇒ tick 应**跳过发送**并记原因，
  **不要把消息当成功出队**（否则丢数据）——即 sender 此时必须 `throw`。
- `now` 可注入（测试用假时钟）；缺省 `Date.now`。

## 交付

1. 写好 `lib/team-sync.js`
2. `node --check lib/team-sync.js` 必须 **exit 0**
3. **自己写临时验证脚本**（放 `%TEMP%`，仓内零残留），真跑并断言：
   - **team-off 零行为**：`teamEnabled=false` 时 start() 后**没有**定时器、零 IO
   - **幂等**：start() 两次 ⇒ 只有一个定时器
   - **单飞**：并发两次 tick ⇒ 第二次 `skipped:true`
   - **退避**：连续 3 次失败 ⇒ `nextDelayMs` 递增且**有上限**；成功后**重置**
   - **不抛**：sender 抛错 ⇒ tick 不抛、失败计数 +1
   - **unref**：定时器确实调用了 unref（可用探针替身）
   - **stop 后静止**：stop() 后再等，不再有 tick
4. **必须用真实 `lib/team-outbox.js` 做一次集成联调**（真 outbox + 假的 fetch），
   断言「sender 抛错时该条**留在队列**」这条 B3 契约在你的心跳里成立。

## 回报（简短）

字节数 + 行数 + EOL + sha256-16 + `node --check` 结果 + 自测 PASS/FAIL 数 +
**自己抓到的问题**（若有）+ 未决风险（标注「未触达」而非宣称通过）。

## 完成后留痕
在 `_gen/TASK-E.md` 末尾追加 `## TASK-E 完成回报`。**不要**写 memory_log/note（由 Lead 统一写）。