# 投喂顺序（3 段喂 AI + 1 步你做）

> 每段**新开一个会话**，复制该段整段文字喂给 AI。AI 完成后停下回报，你验收后再喂下一段。
> 第 4 段不是喂 AI 的，是你自己执行。

---

## 第 1 段 · 修 P12（主动联想词项截断）

请先阅读以下两个文件，然后严格按里面的 prompt 完成工作：

1. `D:\dsh-auto-memory\docs\prompts\_COMMON.md`
2. `D:\dsh-auto-memory\docs\prompts\FIX-AGENT-P12-FULL-REGRESSION.md`

本段目标：修复主动联想路径上「按字典序截断、丢高权重词」的缺陷，跑完九套静态回归，产出「重启后 live 验证清单」。完成后停下回报静态结论，等下一段。

---

## 第 2 段 · 加时间检索臂

请先阅读以下两个文件，然后严格按里面的 prompt 完成工作：

1. `D:\dsh-auto-memory\docs\prompts\_COMMON.md`
2. `D:\dsh-auto-memory\docs\prompts\FIX-AGENT-TEMPORAL-ARM.md`

本段目标：新增中文时间表达解析（纯函数），作为软性第三臂接入记忆检索，查询无时间表达时零行为变更。跑完静态回归后停下回报，等下一段。

---

## 第 3 段 · 收尾（提交 + 全量回归 + 发版准备）

请先阅读以下三个文件，然后严格按里面的清单完成工作：

1. `D:\dsh-auto-memory\docs\prompts\_COMMON.md`
2. `D:\dsh-auto-memory\docs\RELEASE-GO-NOGO.md`
3. `D:\dsh-auto-memory\docs\STATUS-BOARD.md`

本段目标：

1. 报告当前工作区状态（含两个未提交文件 `lib/index.js`、`lib/python-setup-pre.js` 的 diff 摘要）
2. 跑一遍**全量静态回归**（P12 + 时间臂 落地后应新增两套，加上既有九套，共十一套）
3. 确认所有静态基线全绿后，**停下等你确认**是否把那两个未提交文件一起提交
4. 你确认后：提交本版本全部改动，并产出最终的「重启后 live 验证清单」

---

## 第 4 步 · 交给 Zcode 独立验收（推荐，非投喂给开发的 Agent）

> **为什么交给 Zcode**：它能**重启 dsh web**（DSH 自己的 Agent 做不到，重启会截断对话）、能**操作 UI**、能**读后台日志**，而且是**独立第三方**——不受"自己写的自己测"的盲区影响。

把 `D:\dsh-auto-memory\docs\prompts\LIVE-VERIFY-ZCODE.md` 整段喂给 Zcode（从"你是独立第三方验收 Agent"开始复制到末尾）。

它会：重启 → 逐项实测九项（L1 主动联想 / L2 语义检索 / L3 L0 返回 / **T1 时间臂** / L4 M8 / L5 证据落盘 / L6 接续 / L7 写入 restore / P 性能）→ 每项贴证据 → 给 Go/No-Go 结论。

**若你更想自己验**（Zcode 不可用时），按下面清单手测：

1. 重启 dsh web
2. 逐项验证（重点 L1 主动联想、L2 语义检索；另补时间臂：用一条含"上周"的查询实测召回按时间提升）
3. 全部通过后：`node tools/release.mjs <版本号>` 发版

> 判据：L2 语义检索失败且 `legacy` 下正常 = P8 回归；T1 中"无时间词查询排序也变了" = 违反零行为变更；任一成立即暂缓发版。
