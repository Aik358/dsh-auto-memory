# 反馈：`tool_calls[].id` 未生成唯一 id，导致 DSH 会话永久损坏

> 面向：dshapi.icu 中转站管理员
> 环境：dsh `0.1.5-rc.1` / Windows，`deepseek-v4.1-flash`，OpenAI 兼容端点

## 问题一句话

你们的响应把**请求里带过去的 `tool_call.id` 原样回吐**，而不是像 OpenAI/Anthropic 官方那样由服务端生成新的唯一 id。这会让下游客户端把它记成 `X|X`（自己等于自己）形态，**同一轮内并发多个工具调用时 id 就会相撞**，客户端历史被写坏后，该会话之后每一次请求都被上游以 400 拒绝，永久不可用。

## 证据（客户端侧磁盘日志，可复现）

**1. id 形态对比**——同一份 DSH 配置下，切换不同 provider 后 `data.callId` 的形态：

```
你们：dshapi            call_00_b3mU30w0FfSuOfQqd4zk8608|call_00_b3mU30w0FfSuOfQqd4zk8608   ← 两半完全相同
其他：opencode-go2      call_00_ikPujFCkNiWYWPHuQghf6897|92de6cdc-45f2-458d-9cf1-ae7028b991b4  ← 两半不同（正常）
```

全量统计（本地 164 个会话，按 provider 归类）：

```
provider        自反映射(两半相同)   正常映射   无分隔
dshapi                   11            0         0      ← 100%
sub-vankit                0         1431         -
vankit-glm                0          821         -
opencode-go2              0         1783         -
```

**只有你们这一家是 100% 自反映射。**

**2. 后果**——DSH 会话日志里出现的坏数据（同一 step 内两条同 id）：

```
981  tool/call    call_01_UKmzZe2AlTekpCR0whQV6449|call_01...
983  tool/call    call_01_UKmzZe2AlTekpCR0whQV6449|call_01...   ← 同一 id 又写一次
```

之后该会话所有模型都报：

```
400 invalid_request_error: Duplicate 'call_id': call_01_..._call_01_...
400 Duplicate value for 'tool_call_id' of call_01_...|call_01_... in message[3]
```

客户端界面同时卡死无法渲染（`received more than one start Match`）。我们一夜之间坏了 3 个会话。

## 请你们修的点

1. **`tool_calls[].id` 必须由你们生成唯一值**（例如 `call_` + 随机串，或用上游返回的真实 id），不要回吐客户端请求里的 id；
2. 同一响应内多个 `tool_calls` 的 id **绝不能相同**；
3. 如果上游返回的 id 为空，也要**补一个唯一值**，不要留空让客户端兜底（空 id 同样会退化成自反映射）；
4. 建议顺手检查：`tool` 角色消息里的 `tool_call_id` 必须与对应 `tool_calls[].id` **严格一一对应**。

## 影响面

这不是客户端兼容性问题：OpenAI 的 `tool_calls[].id` 语义就是「服务端为本次调用生成的唯一标识」，客户端据此做匹配与去重。id 非唯一会破坏所有依赖严格校验的客户端（DSH、部分开源 agent 框架），且**损坏是持久的**（历史每轮重发都撞同一堵墙）。修复后我们的会话可正常续用，无需用户手工清理历史。

---

（如果你们需要更完整的技术细节：这是 DSH 官方 discussion #5732 的同类问题，客户端侧应于历史 append 时做唯一性兜底；但**触发源在响应侧**，你们修掉回吐行为即可消除绝大多数触发。）
