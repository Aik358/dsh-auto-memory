# 反馈稿 · 中转站 `openai-responses` 协议的 call_id 撞车问题

> **状态**：已完工 · 2026-09-14
> **性质**：研究结论 —— 本文为**完成后的技术记录**，不再作为待执行计划。
> **落点**：接收方为 `api.dshapi.icu` 中转站运营方（GitHub/站内渠道提交，需用户操作）；本仓未改动任何文件
> **验收**：本阶段结束时未单独留档套件名与 PASS 数；证据为同配置下其他中转（sub-vankit、vankit-glm）无此问题、`chat/completions` 端点实测正常返回

## 摘要

本文是给中转站运营方的反馈稿全文。现象为：用 `api: openai-responses` 走 `https://api.dshapi.icu/v1` + `deepseek-v4.1-flash` 时，客户端会话会永久损坏，模型开始报 `400 Duplicate 'call_id'`，之后该会话只能手工清历史。原因判定为 responses 协议里工具调用的 id 字段与返回的 `tool_calls[].id` 使用同一套 `call_xx_xxxx` 命名规则，两边算出的 id 撞车。文末提出两项请求：确认是否支持标准 `chat/completions` 协议（实测该端点正常返回，改用即可绕过），以及若必须用 responses 能否让返回里的工具调用 id 与请求中的 id 明确区分。

---


**现象**：用 `api: openai-responses` 走 `https://api.dshapi.icu/v1` + `deepseek-v4.1-flash`，客户端（DSH）的会话会永久损坏——所有模型开始报 `400 Duplicate 'call_id'`，之后该会话再也不能用，只能手工清历史。

**原因**：responses 协议里工具调用的 id 字段和你返回的 `tool_calls[].id` 用的是一样的 `call_xx_xxxx` 命名规则，两边算出来的 id 会撞车。DSH 在 responses 这条路径上拿不到独立的 id，只能用自己生成的值兜底，同一轮里并发多个工具调用时就重复了，写进历史后每次请求都被上游拒绝。

**对比证据**：同一份客户端配置下，其他中转（sub-vankit、vankit-glm 等）都没有这个问题，只有走你们 responses 端点时会撞。

**想请你确认/解决**：
1. 你们是否支持标准的 `chat/completions` 协议？我们这边实测 `https://api.dshapi.icu/v1/chat/completions` 是正常返回的，如果可以，我们改用标准协议就能绕过。
2. 如果必须用 responses，能否让返回里的工具调用 id 与客户端请求中的 id 明确区分开（比如加独立前缀），避免撞车？

麻烦看一下，谢谢！
