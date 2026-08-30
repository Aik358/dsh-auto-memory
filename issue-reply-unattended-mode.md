# Issue 回复：Unattended mode 下「Welcome back」问候与上下文漂移

> 建议直接粘贴到 issue 评论区的双语版本。

---

## 中文版

您好！

非常感谢这份高质量的反馈——症状描述细致、附了脱敏日志，还给出了明确的功能诉求，这对我们把插件打磨得更适合生产环境帮助很大。

**关于问题原因**

您遇到的是插件的「暂离/回归」问候机制：当距上次活动超过阈值（默认 60 分钟）后再次收到消息时，系统会一次性注入一条 `[欢迎回来]` 指令，要求模型在回复开头致以问候并提示打开记忆窗口。它只在"回归"那一刻注入一次，但这条指令会留在会话历史中——模型在后续每一轮都能看到它和自己早先的回复，于是出现反复输出 "Welcome back!" 的现象。您观察到的路径漂移和 re-read/edit 死循环，也是这条指令在长会话中持续挤占注意力引发的连锁反应。对无人值守场景来说这确实不可接受，我们完全认同您的判断。

**当前版本的缓解方案（设置 → 自动化）**

1. **自动弹出记忆窗口**：暂离/回归时自动弹出记忆窗口(corner)并欢迎；关闭后只能手动打开。托管/批处理任务建议**关闭**。
2. **暂离阈值（分钟，默认 60）**：距上次活动超过该值才视为暂离。若不想整体关闭弹窗，可把阈值拉大到远超任务单步间隔（如 1440），基本等效于禁用回归问候。
3. **自动总结时间点(HH:MM,逗号分隔)**：到点自动生成本时段总结并弹窗展示。**留空即为关闭**，长任务期间建议清空。

补充说明：`<memory_system>` 注入只发生在会话开始与暂离回归时刻，并不会每轮改写您的工作目录；路径漂移来自注意力被挤占后的连锁效应。按上面配置关闭回归问候后，系统提示将保持稳定。

**后续计划**

- 下一个版本将把「暂离/回归」功能整体做成可开关的独立选项（而不只是调阈值/关弹窗）。
- 后续版本会在设置中新增**「无人值守模式」及它的开关**，并添加**自动检测入口**：当检测到当地时间为凌晨或下班时间、或有自动托管任务正在运行时，将自动切换到托管（无人值守）模式，不再弹出自动欢迎窗口——批处理场景无需手动配置即可免打扰运行。
- 我们正在开发新的记忆插入机制：记忆不再整块注入，而是让模型没有主动调用时也能被当前情境唤回（情境触发式检索）。考虑到它同样可能影响托管模型的注意力，新功能上线时会同步提供开/关选项。
- 您提出的 Headless / Unattended Mode 方向与我们一致，我们会沿上述两步逐步落地，并在设置面板中为非核心功能提供独立开关。

再次感谢您花时间写出这么完整的报告。如果调整配置后仍出现回归问候或路径漂移，欢迎在 issue 下追加日志，我们会跟进排查。

---

## English Version

Hi!

Thank you so much for this excellent report — detailed symptoms, sanitized logs, and a clear feature request. Feedback like this is exactly what helps us harden the plugin for production use.

**Root cause**

What you hit is the plugin's away/return greeting mechanism: once the time since last activity exceeds the threshold (default: 60 minutes), the next incoming turn injects a one-time `[Welcome back]` directive asking the model to open its reply with a greeting. It fires only once per return event, but the directive stays in the conversation history — the model keeps seeing it plus its own earlier replies on every subsequent turn, hence the repeated "Welcome back!" lines. The workspace-path flip and the read/edit retry loop you observed are knock-on effects of that directive competing for attention over a long session. We fully agree this is unacceptable for unattended runs.

**Mitigations available today (Settings → Automation)**

1. **Auto-popup memory window**: pops up the memory window (corner) and greets on away/return; when disabled it can only be opened manually. Recommended **OFF** for hosted/batch tasks.
2. **Away threshold (minutes, default 60)**: only counts as "away" when idle longer than this. If you prefer not to disable popups entirely, raise it well above your longest inter-step gap (e.g. 1440), which effectively neutralizes the return greeting.
3. **Auto summary times (HH:MM, comma-separated)**: scheduled period summaries with a popup. **Leave empty to disable**; recommended while a long task is running.

One clarification: the `<memory_system>` injection happens only at session start and on away/return events — it never rewrites your working directory per turn; the path drift was a knock-on effect of crowded attention. With the return greeting disabled, your system prompt stays stable.

**Roadmap**

- The next release adds a standalone switch that turns the away/return feature off entirely (not just threshold tuning / popup suppression).
- A following release will add an **Unattended Mode with its own toggle** in settings, plus an **auto-detection entry**: when the local time is late night / early morning or outside working hours — or while an automatic hosted task is running — the plugin switches to unattended (hosted) mode on its own and stops popping up the welcome window, so batch scenarios run distraction-free with zero manual configuration.
- We are building a new memory-insertion mechanism: instead of injecting blocks wholesale, memories become recallable from context even when the model does not actively call them. Since this can equally affect attention in hosted runs, the new mechanism will ship with an on/off switch.
- Your Headless / Unattended Mode proposal matches our direction; we will get there through the two steps above and keep adding independent toggles for non-core features in the settings panel.

Thanks again for taking the time to file such a complete report. If the greeting or path drift still occurs after these changes, please append logs to this issue and we will investigate.
