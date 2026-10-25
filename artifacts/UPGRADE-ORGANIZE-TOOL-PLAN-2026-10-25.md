# upgrade 整理工具 + 庆祝绘画 · 方案 v2（2026-10-25 18:50，用户批准后）

> **v1 的两个待裁决点已全部拍板**：①工具数 20 → 21（用户同意）②烟花改为**代码块绘画**（立体、中英文）。

## §0 · 用户裁定（逐字）

### 裁定 1：工具数 20 → 21 同意
> 「工具数 20 → 21我同意把它改了」

⇒ `memory_upgrade` 独立工具成立。需同步改 11 处文档的「模型工具 = 20」判据。

### 裁定 2：烟花 = 代码块绘画，立体，中英文都要有
> 「『欢迎来到面向持续人机交互的情景化主动记忆时代』这个做成**代码块绘画的形式，立体的，中英文都要有**（如果检测到这个用户的记忆是别的奇怪文字，比如说俄文或者日文，那**再让 AI 按照他们的文字来画**就行）」

**四个要求**：
1. **代码块绘画**（不是 CSS 动画、不是图片）—— 用块字符拼，任何纯文本面都能贴
2. **立体** —— 要有挤出阴影层
3. **中英文都要** —— 两套字形都要
4. **其他语言（俄文/日文等）由 AI 现画** —— 不硬编码字形表

---

## §1 · 已落盘：`lib/celebration-art.js`（纯常量 + 纯函数，零依赖零 IO，真 import 实测通过）

| 导出 | 作用 |
|---|---|
| `latin3dPre(text)` | 拉丁字母 5×7 点阵 → 块字符 → 右下 2 层（近▓ / 远░）阴影 |
| `cjk3dPre(lines)` | 中日韩：**保留字形** + 下方三层递进错位阴影（▓/▒/░）|
| `displayWidthPre(s)` | 显示列数（CJK 占 2 列，不是 `.length`）|
| `renderCelebrationArtPre()` | 完整绘画（中 + 英，70 显示列 / 56 行）|
| `CELEBRATION_OTHER_LANG_GUIDE` | 其他语言的**现画约定**（给模型看的 4 条规则）|

### 中英文为什么是两套算法（不是同一套参数）

| | 拉丁字母 | 中日韩 |
|---|---|---|
| 做法 | 5×7 点阵 → 块字符 | 保留字形，不做点阵 |
| 原因 | 笔画简单，点阵后仍可读 | 笔画密度高，点阵化会糊成不可读的方块 |
| 立体 | 右下 2 层逐层偏移（▓→░）| 下方 3 行逐行偏移（▓→▒→░）|

### 关键实现坑（踩了两个）

```
坑 1：拉丁字母 pitch 必须 = 5 + depth
      首版 pitch=6、depth=2 ⇒ 阴影窜进下一字母格子，字糊成一团
      ⇒ pitch 必须给 depth 让位

坑 2：中文不能靠「每格 2 像素」硬压成块字符
      试过 PIL 渲染 26px 字体 + 下采样 ⇒ 汉字糊成不可读的噪点
      ⇒ 中文直接保留原文，只加投影层（唯一能保住可读性的做法）
```

---

## §2 · 成品（实际输出摘要，完整 56 行见模块）

```text
── 欢迎来到 ──
欢迎来到
 ▓▓▓▓▓▓▓
  ▒▒▒▒▒▒
   ░░░░░
面向持续人机交互的
 ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓
  ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒
   ░░░░░░░░░░░░░░░
情景化主动记忆时代
 ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓
  ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒
   ░░░░░░░░░░░░░░░

█   █  █████  █       ████   ███   █   █  █████
█▓  █▓ █▓▓▓▓▓ █▓     █ ▓▓▓▓ █ ▓▓█  ██ ██▓ █▓▓▓▓▓
█▓░ █▓░█▓░░░░░█▓░    █▓ ░░░░█▓ ░█░ █▓█ █▓░█▓░░░░░
（下略，另有 TO THE / CONTEXTUAL / MEMORY 三行大字）
```

---

## §3 · `memory_upgrade` 工具设计（已批准）

### 3.1 签名

| action | 行为 |
|---|---|
| `start` | 立即返回 `{ok:true, jobId, message}`，内部 fork 后台跑子代理；若已有在跑的 ⇒ 返回现有 jobId（防重复）|
| `status` | 返回当前 `upgrade-state.json` 内容 + 已用时 |
| `ack` | 把 `notified` 置 true（消费完成/失败提醒，停止每轮重复）|

### 3.2 后台化（关键：不阻塞模型）

**实测约束**：`runSubagent(text,label,agent,timeoutMs)` 是 await 的（L13946，90s 超时）。

```
错误做法：await runSubagent(...)   ← 阻塞模型 90s

正确做法：fork 出去，立即返回
  var jobId = "upg_" + Date.now().toString(36)
  writeUpgradeState({ phase:"running", jobId, startedAt, notified:false })
  Promise.resolve().then(() => self.runSubagent(PROMPT, "auto-memory-upgrade", null, 600000))
    .then(summary => writeUpgradeState({ phase:"done", summary, notified:false, ... }))
    .catch(e    => writeUpgradeState({ phase:"failed", error, notified:false, ... }))
  return { ok:true, jobId, message:"已在记忆中枢启动子代理；完成后会通知你（不阻塞当前对话）" }
```

**三条硬判据**：
1. `start` 返回耗时 **< 50ms**（证明没 await 子代理）
2. 子代理 label 必须含 `auto-memory-` 前缀（GC 依赖）
3. parent 用 `this._workbenchParent`（L13892 已实现）⇒ **天然「在记忆中枢里」**

### 3.3 完成/失败提醒（新机制，全仓原本 0 处）

**实测**：`pendingReminder` / `injectOnNextTurn` 等「后台任务完成后注入提醒」的机制**不存在**，需新建。

```
~/.dsh/memory/upgrade-state.json = {
  phase: "running" | "done" | "failed",
  jobId, startedAt, finishedAt?, summary?, error?, notified: false
}

注入侧每轮检查：
  phase==="done"   && !notified ⇒ 注入 [★记忆整理完成] + summary（≤400 字）+「请向用户汇报成果」
  phase==="failed" && !notified ⇒ 注入 [★记忆整理失败] + error +「请告知用户并给出下一步建议」
```

**判据**：完成 ⇒ **下一轮**注入出现（不是当轮）；失败 ⇒ 下一轮出现 + 原因；ack 后消失；**不 ack 就一直提醒**。

### 3.4 弹窗 done 相位显示绘画

```
done 相位 = renderCelebrationArtPre() 结果放进 <pre>
           + 按钮 [查看记忆中枢] [关闭]
           + prefers-reduced-motion 不影响（纯文本，无动画）
```

**这是「代码块绘画」相对 CSS 动画的最大优势**：不需要动画、不需要无障碍降级、不依赖浏览器渲染，纯文本即可。

---

## §4 · 工具数 20 → 21：需要同步的文档（实测）

| 文件 | 现文 |
|---|---|
| `docs/WHITEPAPER.md` L97 | `| 模型工具 | **20** | 17 个基础 + 2 个条件注册…` |
| `docs/GM53-HOMEPAGE-PROMPT.md` | `(\d+) 个模型工具` |
| `docs/FRONTEND-CO-CREATION.md` L15 | `源码声明 20 个模型工具、77 个普通唯一路由和 163 个默认配置键` |
| `README.zh-CN.md` L659 | `39 条用户能力 / 20 工具 / 77 路由 / 163 配置键` |
| `README.md` | 同结构（英文）|
| 其余 | verify-docs 会全列出 |

**核实方式**：跑 `node tools/verify-docs.mjs`，它会把所有不一致点列出来（交叉校验器，不是单点断言）。

---

## §5 · 施工顺序（插到 U 系列）

```
U3.5  降级提醒四要素                       已完成（163 字）
U5    upgrade-state.json 状态文件 + 注入提醒     与 U5 完成信号合并
U6    memory_upgrade 工具（后台 fork）            已批准，可施工
U7    ack 消费提醒
U8    弹窗 done 相位显示 celebration-art          lib/celebration-art.js 已就绪
U9    工具数 20→21：改文档 + verify-docs 归零
```

**U9 必须最后做**：先让代码里真出现第 21 个工具，再改文档，否则 verify-docs 会先红后绿（假绿风险）。
