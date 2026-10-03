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

Two of the three cases followed an aborted turn; **the third had no abort** — so this is not abort-specific.

**New finding — two shapes, only one is acute**: scanning 164 local session files, 30 contain duplicated ids:

| shape | gap | sessions | effect |
|---|---|---|---|
| adjacent double-write (same step) | 2 events | 3 | session permanently unusable |
| cross-turn reuse (different turn) | tens of thousands of events | 27 | tolerated today, one strict-provider switch from the same fate |

**New finding — a diagnostic signature that identifies the culprit provider**: DSH stores each tool call id as `<recorded>|<provider-mapped>`. Across all local sessions the two halves are **identical** (self-reflection: the provider echoes DSH's id back instead of returning its own) for exactly one provider:

```
provider                self-reflected  normal-mapped  no-separator
dshapi                       11              0              0     <-- 100% self-reflected
sub-vankit                    0           1431             ...
vankit-glm                    0            821             ...
opencode-go2                  0           1783             ...
```

When the two halves are equal, concurrent tool calls in one step collide and produce the byte-identical `<id>|<id>` duplicates. So a fast triage question is: **"is your provider self-reflecting the ids?"** — check `data.callId` in any `tool/call` event; `X|X` = the provider is echoing ids instead of minting them.

**Repair (works, host restart required)**: drop the second `tool/call`+`tool/result` pair, keep all other events. Constraint: `session.v3.jsonl.zstd` is append-style multi-frame zstd with **one event per frame**, and the first frame must be *exactly* one header line — recompressing into a single frame bricks boot (`corrupt Zstandard session log: first frame is not exactly one header line`).

**Suggested fix**: enforce session-wide unique `toolCallId` at history append (rewrite the later occurrence + remap its `tool` message), and make the assembler isolate rather than fatal-throw on the duplicate `start Match` (same ask as the #5692 family).

---

## 中文

**环境**：Windows 11 / Node 24 / dsh `0.1.5-rc.1`，严格校验唯一 id 的 OpenAI 兼容中转（Console Go）。

**现象**：会话永久不可用——所有模型都报上面那两条 400；界面同时卡加载（`received more than one start Match`）。

**证据（一夜 3 个会话，磁盘日志）**：模型在**同一个 step 内**输出了两次相同的 `tool_call_id`，DSH 原样持久化两条（seq 981 → 983，相隔 2 条事件）。三次中两次在中断回合之后，**第三次没有任何中断**——并非中断专属。

**新发现一——两种形态，只有一种致命**：扫本地 164 个会话，30 个含重复 id——**相邻双写**（差 2 条，3 个会话，会话永久不可用）vs **跨 turn 复用**（相差数万条，27 个会话，当前被容忍但切换严格 provider 即同样失效）。

**新发现二——一个能直接指认元凶的鉴别特征**：DSH 把每次工具调用的 id 存成 `<记录的>|<provider 映射的>`。全部本地会话统计下来，只有一家 provider 的**两半完全相同**（自反映射：provider 不回吐自己的 id，而是把 DSH 给的 id 原样送回）：

```
provider                自反映射  正常映射  无分隔
dshapi                     11        0        0     ← 100% 自反映射
sub-vankit                  0     1431      ...
vankit-glm                  0      821      ...
opencode-go2                0     1783      ...
```

两半相同时，同一 step 内的并发工具调用就会撞在一起，产生字节相同的 `<id>|<id>`。所以快速判断法：**看你 provider 是不是在自反映射**——打开任意 `tool/call` 事件的 `data.callId`，若是 `X|X` 形态，即 provider 没有自己生成 id 而是回吐了请求里的 id。

**修复方式（有效，需重启宿主）**：删除第二次出现的 `tool/call`+`tool/result` 对，其余保留。约束：会话日志是追加式多帧 zstd、**一帧一事件**，首帧必须恰好是 session 头一行——压成单帧会导致启动失败。

**建议修复**：历史 append 处强制会话内 `toolCallId` 唯一（改写后出现的那次 + 重映射其 `tool` 消息）；assembler 在重复 `start Match` 时隔离该块而非致命抛出（与 #5692 家族一致）。
