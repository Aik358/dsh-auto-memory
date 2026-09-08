# 2.2.4 重启后实测清单(2026-09-08,pre 线 b99576b)

前置:**重启 dsh web**(host 半边代码改动需重启加载)+ 浏览器**硬刷新**(Ctrl+Shift+R,客户端半边)。

> host 半边已用真引擎跑通(见 `tests/smoke/smoke-test-continue-host-pre.mjs`,19 断言:真 apply(ctx) + 真 session.jsonl
> 驱动 workspaceId 解析与 request/header 模型提取);下面是 GUI 端到端核对,需要人眼/点击。

## 一键接续(手动)①-⑤

1. 打开记忆面板 → **白板**页签 → 点「**一键接续到新会话**」。
2. 观察右下角/面板提示顺序(应为):
   `刷新仪式:请旧 Agent 更新白板 PLAN 与交接账本…` → `正在构造交接材料(含旧会话转写)…`
   → `正在创建新会话(沿用旧工作区与模型)…` → `正在沿用旧模型 …` → `✓ 已创建新会话…`
3. 核对 6 项:
   - [ ] ① 新会话出现在**旧会话所属工作区**下(不再落「未分组工作区」)
   - [ ] ② 新会话模型 + **思考档位**与旧会话一致(输入框模型选择器可见)
   - [ ] ③ 新会话标题为 **`接续 #N · <工作区名>`**
   - [ ] ④ 新会话首条消息是**分层交接材料**:`【第0层 · 白板 PLAN.md(节选)】` / `【第1层 · 交接账本 …】` / `【第2层 · 近期线程(最近 20 条 …)】` / `【第3层 · 完整转写与检索(按需)】`
   - [ ] ⑤ 旧会话里能看到刷新仪式的往返(旧 Agent 重新写了 PLAN.md 与一篇新账本,账本时间戳晚于点击时间)
   - [ ] 旧会话转写文件已更新:`~/.dsh/memory/workspaces/--D--dsh-auto-memory--/handoff/prev-session-*.md`

## 自动接续 v3 ⑥-⑧

6. 设置/白板页签确认「自动接续:开」;为便于验证可把**阈值临时调到 0.5**(验证完改回 0.8)。
7. 让旧会话跑完一轮(agent 空闲,状态点变灰)。
8. 核对:
   - [ ] ⑥ 水位 ≥ 阈值且**轮次结束**后右下角弹出**确认卡**(含水位百分比 + 「同意接续 / 拒绝」+ 倒计时秒数)
   - [ ] ⑦ **拒绝**:卡片消失,同一边界不再弹(要等下一个轮次边界)
   - [ ] ⑧ **不理会 35 秒** → 自动接续开始(挂机兜底);或点「同意」→ 立即开始
   - [ ] ⑨ 挂机连续跑(无人值守)时,每个轮次边界都会按 ⑥→⑧ 自动接续一次,30 分钟冷却内不重复

## 出问题时

- 看诊断日志:`~/.dsh/dsh-auto-memory-pre-diagnose.log`(含 `prev-session pack built: … model=… effort=…`,可确认模型提取是否拿到值)
- host 路由自查(loopback):
  `curl http://127.0.0.1:3080/api/dsh-auto-memory-pre/handoff-state` → 应含 `planMtime` 与 `refresh.sessionId`
  `curl -X POST http://127.0.0.1:3080/api/dsh-auto-memory-pre/handoff-continue` → 应含 `workspaceId` / `provider` / `model` / `reasoningEffort`
- 回归:`node tests/smoke/smoke-test-continue-chain-pre.mjs`(56 断言)、`node tests/smoke/smoke-test-continue-host-pre.mjs`(19 断言)

## 子代理痕迹回收(2.2.4 新增,2026-09-08)⑩-⑬

9. 重启 dsh web 后打开 设置 → 上下文,确认出现「子代理痕迹回收」开关(默认开)与「兜底回收保留天数」(默认 3)。
10. 触发一次自动沉淀 / 时段总结(或任意 subagent 调用),核对:
    - [ ] ⑩ 该子代理结束后,`~/.dsh/sessions/<工作区>/` 下**不再新增**裸 UUID 会话目录(痕迹已移入 `~/.dsh/subagent-gc-backup/`)
    - [ ] ⑪ 子代理结果本身不受影响(自动沉淀照常写日志、总结照常返回)
11. 自查路由:`curl http://127.0.0.1:3080/api/dsh-auto-memory-pre/subagent-gc` → 应返回 `{ok:true, mode:"preview", candidates:…}`(GET 只预览,不移动任何文件)
    - [ ] ⑫ 存量清理:CLI 预览 `node tools/subagent-gc.mjs` 的候选数与实际相符;`--apply` 后会话目录数下降、备份目录出现条目
    - [ ] ⑬ 回滚可用:把 `~/.dsh/subagent-gc-backup/<工作区>/<id>/` 移回 `~/.dsh/sessions/<工作区>/` 即恢复

全绿 → 说「发 2.2.4」走发布(`node tools/release.mjs 2.2.4`)。
