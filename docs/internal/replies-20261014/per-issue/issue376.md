已在**开发树**中逐块移植（下一版 3.3.4 包含本项）。

**你的实现**：`3684606`（启动初始化不再覆盖已有 active/canary 配置）—— 已保留，含 `createOnly` 服务端语义与 `smoke-test-issue376-startup-config.mjs`。

**⚠️ 我在这条路径上补了一个与你同族的缺陷（请复核）**：

你的 `updateEmbeddingConfigPre` 在 `createOnly` 命中**已存在**文件时正确地**不写盘**，但返回值与「真写过」同形 ⇒ 调用点 `engine._jsConfigurationError = ''` 会**凭空清掉一条真实配置错误**。客户端启动自检约 16s 后跑一次（`createOnly: true`）⇒ 用户重启后面板显示「正常」，而配置其实仍是坏的。

这正是你 #376 想解决的同一族症状（「设置看起来没生效」），所以移植时补上：
- 未写时返回 `{ ...previous, __unchangedByCreateOnly: true }`
- 调用点：`const wroteNow = !(saved && saved.__unchangedByCreateOnly === true); if (wroteNow) engine._jsConfigurationError = ''`

**行为验证 9 PASS / 0 FAIL**，含三条负路径：命中已存在 ⇒ 磁盘逐字节不变；缺失 ⇒ 真创建；损坏 ⇒ 仍抛 `read/CORRUPT` 且**原样保留**（你的损坏保护未回归）。

**另外**：你的 ok 诊断行是 `semantic-emit: ok mode=shadow`，我恢复为 `semantic-emit: ok mode=shadow created=false emit=shadow policy=shadow` —— 因为 **#421 的报障者引用的正是完整那一行**来证明「文件本来就在、值仍被改写」；少了这三个字段，下一位用户看不出文件是被改写的还是本来就那样。你的失败路径留痕全部保留。

**全量回归基线**：399 PASS / 1 FAIL / 0 TIMEOUT / 208.6s。