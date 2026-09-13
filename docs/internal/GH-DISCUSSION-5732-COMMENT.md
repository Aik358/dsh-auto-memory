# 补充确认：同轮内重复 tool_call_id（相邻双写形态）

## EN

**Environment**: Windows 11 / Node 24 / dsh `0.1.5-rc.1`, strict OpenAI-compatible relay (Console Go, unique-id check).

**Symptom**: the session becomes permanently unusable — every model fails with:

```
400 invalid_request_error: Duplicate 'call_id': call_01_IBQv9P78wRhPI72L2XVh2573_call_01_IBQv9P78wRhPI72L2XVh257.
400 Duplicate value for 'tool_call_id' of call_01_IBQv9P78wRhPI72L2XVh2573|call_01_IBQv9P78wRhPI72L2XVh2573 in message[3]
```

The UI also fails to render: `[session-controller] event feed subscriber failed: conversation Context 20:trajectory-tool-call <id>|<id> received more than one start Match`.

**Evidence (3 sessions on disk, one night)**: the model emitted the same `tool_call_id` twice **within one step**; DSH persisted both verbatim:

```
981  tool/call    call_01_UKmzZe2AlTekpCR0whQV6449|call_01...
983  tool/call    call_01_UKmzZe2AlTekpCR0whQV6449|call_01...   <-- same id, 2 events apart
```

The duplicated id is stored as the byte string `<id>|<id>` in `data.callId` (tool/call) and `data.message.source.callId` (tool/result). Two of the three cases followed an aborted turn; **the third had no abort** (`turn/end reason` absent) — so this is not abort-specific.

**New finding — two shapes, only one is acute**: scanning 164 local session files, 30 contain duplicated ids:

| shape | gap | sessions | effect |
|---|---|---|---|
| adjacent double-write (same step) | 2 events | 3 | session permanently unusable |
| cross-turn reuse (different turn) | tens of thousands of events | 27 | tolerated today, one strict-provider switch from the same fate |

**Repair (works, host restart required)**: drop the second `tool/call`+`tool/result` pair, keep all other events. Constraint: the `session.v3.jsonl.zstd` log is append-style multi-frame zstd with **one event per frame**, and the first frame must be *exactly* one header line — recompressing into a single frame bricks boot (`corrupt Zstandard session log: first frame is not exactly one header line`).

**Suggested fix**: enforce session-wide unique `toolCallId` at history append (rewrite the later occurrence + remap its `tool` message), and make the assembler isolate rather than fatal-throw on the duplicate `start Match` (same ask as the #5692 family).

---

## 中文

**环境**：Windows 11 / Node 24 / dsh `0.1.5-rc.1`，严格校验唯一 id 的 OpenAI 兼容中转（Console Go）。

**现象**：会话永久不可用——所有模型都报：

```
400 invalid_request_error: Duplicate 'call_id': call_01_IBQv9P78wRhPI72L2XVh2573_call_01_IBQv9P78wRhPI72L2XVh257.
400 Duplicate value for 'tool_call_id' of call_01_IBQv9P78wRhPI72L2XVh2573|call_01_IBQv9P78wRhPI72L2XVh2573 in message[3]
```

界面同时卡加载：`[session-controller] event feed subscriber failed: conversation Context 20:trajectory-tool-call <id>|<id> received more than one start Match`。

**证据（一夜之间 3 个会话，磁盘日志）**：模型在**同一个 step 内**输出了两次相同的 `tool_call_id`，DSH 原样持久化两条：

```
981  tool/call    call_01_UKmzZe2AlTekpCR0whQV6449|call_01...
983  tool/call    call_01_UKmzZe2AlTekpCR0whQV6449|call_01...   ← 同一 id，相隔 2 条事件
```

重复 id 以字节串 `<id>|<id>` 形式存于 `data.callId`（tool/call）与 `data.message.source.callId`（tool/result）。三次中两次发生在中断回合之后，**第三次没有任何中断**（日志里没有 `turn/end reason`）——所以并非中断专属。

**新发现——两种形态，只有一种致命**：扫描本地 164 个会话文件，30 个含重复 id：

| 形态 | 间隔 | 会话数 | 影响 |
|---|---|---|---|
| 相邻双写（同一 step） | 2 条事件 | 3 | 会话永久不可用 |
| 跨 turn 复用（不同轮次） | 相差数万条事件 | 27 | 当前被容忍，一旦切换严格 provider 即同样失效 |

**修复方式（有效，需重启宿主）**：删除第二次出现的 `tool/call` + `tool/result` 对，其余事件全部保留。约束：`session.v3.jsonl.zstd` 是追加式多帧 zstd、**一帧一事件**，且首帧必须恰好是 session 头一行——压成单帧会导致启动直接失败（`corrupt Zstandard session log: first frame is not exactly one header line`）。

**建议修复**：在历史 append 处强制会话内 `toolCallId` 唯一（改写后出现的那次并同步重映射其 `tool` 消息）；同时让 assembler 在 `start Match` 重复时隔离该块而非致命抛出（与 #5692 家族的诉求一致）。
