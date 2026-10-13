# TRACE-PATROL-AGENT · 子代理痕迹巡检清单（已作废）

> **状态**：已作废 · 2026-09-25（原文记录的作废日）
> **性质**：执行清单（已作废 · 保留存档）—— 本文所述巡检项已不再执行，仅作为该项能力判废过程的留痕。
> **落点**：原巡检对象为 `~/.dsh/sessions` 下的子代理会话痕迹与本插件 GC 回收；回收能力已判废停用，相关实现见 `lib/subagent-gc.js`。
> **验收**：作废原因已核实：本机 `subagentGcEnabled=false`，`recycleSubagentSession`/`subagentGcSweep` 双早退，巡检前提不成立。

## 摘要

本文原用于定期盘点全机子代理会话痕迹与本插件 GC 回收状况——背景是实测全机 686 个子代理会话中 638 个来自本插件，数量上千后拖慢会话列表加载。该清单已作废：其前提「子代理痕迹回收在跑」不成立，回收能力已判废并停用。正文的巡检项与边界条文保留，仅作历史留痕。

> **存档声明**：本文为该轮派工任务书的原文存档，正文中的「你要做 / 必须 / 禁止」等祈使句**均为当时下达的要求**，不代表当前待办；实际结果以页首「落点 / 验收」为准。

---

# TRACE-PATROL-AGENT · 子代理痕迹巡检清单（★2026-09-28 起：**亲自执行，不派发**）

> **⚠️ 本提示词已作废（2026-09-25）**：其前提「子代理痕迹回收在跑」**不成立** —— 回收能力已判废并停用（本机 `subagentGcEnabled=false`，`recycleSubagentSession`/`subagentGcSweep` 双早退），因此 `stale_over_keepdays` 指标失去意义。下方正文保留仅为留档。
>
> **给执行者**：这份清单**由当前对话亲自逐步执行**（不再派发子代理）。用途：定期盘点 DSH 全机子代理会话痕迹与本插件 GC 回收状况（背景：实测全机 686 个子代理会话中 638 个来自本插件，数量上千后拖慢会话列表加载——见 `lib/subagent-gc.js` 头注）。**只读巡检**；回收动作由插件自身在运行时做，巡检时不得手动移动/删除任何会话目录。

---

你是 dsh-auto-memory 的痕迹巡检子代理。宿主数据根：`~/.dsh`（Windows = `C:\Users\<user>\.dsh`）。**禁止写/删/移动任何文件，禁止重启 dsh web。**

## 巡检项（逐项产出数字与证据）

1. **会话总量盘点**：`~/.dsh/sessions/<工作区>/<会话目录>/` 逐层统计：
   - 会话目录总数、`session-*` 前缀（普通会话）数、裸 uuid（子代理）数。
   - 子代理判别：读会话目录下 `session.jsonl[.zstd]` 首行 header，`origin==='subagent'`；`descriptor.label` 以 `auto-memory-` 开头（`PLUGIN_LABEL_PREFIX`）即本插件产物。zstd 文件可跳过首行解压、只统计目录名（裸 uuid + 无 `session-` 前缀），并在回报里注明"未解压判定"的比例。
2. **GC 备份区**：`~/.dsh/subagent-gc-backup/`（`recycleSessions` 的 backupRoot）统计已回收数与目录体积；`_projcache/` 子目录单独计数。
3. **残留风险**：`origin==='subagent'` 且 label 以 `auto-memory-` 开头、mtime 超过 `subagentGcKeepDays`（默认 3 天，`lib/index.js` 配置表）却仍在 sessions 目录的——列前 20 条（工作区/会话名/mtime）。这是"任务结束即回收"路径的漏网指标。**（回收已停用 ⇒ 本条不再适用。）**
4. **投影缓存**：`~/.dsh/` 下投影缓存目录（`*_projcache*` 类名样，实际以 `~/.dsh` 顶层目录列表为准）的文件数与体积；超过 2,000 文件标记 `warn`。
5. **配置核对**：读 `~/.dsh/dsh-auto-memory.json`（**无 `-pre` 后缀**；配置文件实名即此），摘 `subagentGcEnabled` / `subagentGcKeepDays` 实际值。

## 回报格式（原样 JSON）

```json
{ "ok": true, "sessions_total": 0, "sessions_normal": 0, "subagent_total": 0, "subagent_plugin": 0, "backup": { "count": 0, "projcache": 0 }, "stale_over_keepdays": 0, "stale_sample": [], "projcache_files": 0, "warn": [], "config": { "subagentGcEnabled": true, "subagentGcKeepDays": 3 }, "summary": "一句话总评" }
```

## 边界

- 大目录统计用流式计数，不要把会话文件内容整读进内存。
- 若 `~/.dsh/sessions` 结构与上述不符（宿主版本变更），停下回报实际结构，禁止猜。
- 发现宿主正在写某会话文件（mtime < 5 分钟）→ 跳过该条并在 `warn` 注明，避免与运行中会话竞争。
