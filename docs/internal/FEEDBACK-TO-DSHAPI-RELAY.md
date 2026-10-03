站长你好，反馈一个 `openai-responses` 协议下的冲突问题。

**现象**：用 `api: openai-responses` 走 `https://api.dshapi.icu/v1` + `deepseek-v4.1-flash`，客户端（DSH）的会话会永久损坏——所有模型开始报 `400 Duplicate 'call_id'`，之后该会话再也不能用，只能手工清历史。

**原因**：responses 协议里工具调用的 id 字段和你返回的 `tool_calls[].id` 用的是一样的 `call_xx_xxxx` 命名规则，两边算出来的 id 会撞车。DSH 在 responses 这条路径上拿不到独立的 id，只能用自己生成的值兜底，同一轮里并发多个工具调用时就重复了，写进历史后每次请求都被上游拒绝。

**对比证据**：同一份客户端配置下，其他中转（sub-vankit、vankit-glm 等）都没有这个问题，只有走你们 responses 端点时会撞。

**想请你确认/解决**：
1. 你们是否支持标准的 `chat/completions` 协议？我们这边实测 `https://api.dshapi.icu/v1/chat/completions` 是正常返回的，如果可以，我们改用标准协议就能绕过。
2. 如果必须用 responses，能否让返回里的工具调用 id 与客户端请求中的 id 明确区分开（比如加独立前缀），避免撞车？

麻烦看一下，谢谢！
