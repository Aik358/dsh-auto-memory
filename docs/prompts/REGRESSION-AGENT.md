# REGRESSION-AGENT · 全量回归执行清单（已生效 · 亲自执行）

> **状态**：已生效 · 2026-09-28（原文记录的改派日）
> **性质**：执行清单（存档 · 仍在沿用）—— 本文为生效后的作业口径记录；自 2026-09-28 起由当前对话亲自执行，不再派发子代理。
> **落点**：执行对象为 `D:\dsh-auto-memory` 全量冒烟套件 `tests/smoke/`；清单本身只读，不改任何文件。
> **验收**：按原文回报格式给结构化 JSON；基线数字以当期实测为准（全量回归最近一次为 346 PASS / 0 FAIL / 0 TIMEOUT）。

## 摘要

本文是发版前置门与大体检用的全量回归执行清单：跑完全量冒烟回归并回报结构化结果。生效口径于 2026-09-28 变更为「亲自执行、不派发」，理由是子代理会带来读不到上下文、误判现状等额外风险。清单为只读任务：禁止改任何文件、禁止 `git add/commit`、禁止重启 dsh web。

> **存档声明**：本文为该轮派工任务书的原文存档，正文中的「你要做 / 必须 / 禁止」等祈使句**均为当时下达的要求**，不代表当前待办；实际结果以页首「落点 / 验收」为准。

---

> **给执行者**：这份清单**由当前对话亲自逐步执行**（不再派发子代理——子代理会引入读不到上下文、误判现状等额外风险）。用途：发版前置门、大改后的体检、接手陌生工作区时的基线盘点。**只读任务：不得改任何文件。**

你是 dsh-auto-memory 的回归执行子代理。工作目录：`D:\dsh-auto-memory`（Node.js 项目，零运行时依赖）。任务：**跑完全量冒烟回归并回报结构化结果**。禁止改任何文件、禁止 `git add/commit`、禁止重启 dsh web。

## 步骤

1. 记录基线：`git log --oneline -3` 与 `git status --short`（只记录，不处理）。
2. 逐个运行全部套件（PowerShell）：

```powershell
cd D:\dsh-auto-memory
$results = @()
Get-ChildItem tests\smoke -File -Filter *.mjs | ForEach-Object {
  $out = node $_.FullName 2>&1
  $code = $LASTEXITCODE
  $results += [pscustomobject]@{ name = $_.Name; code = $code; tail = ($out | Select-Object -Last 3) -join ' | ' }
}
$results | Where-Object code -ne 0
$results | Measure-Object | Select-Object -ExpandProperty Count
```

3. **失败套件单跑复验一次**：批量连跑受机器负载影响（历史案例：`smoke-test-m53-*` 连跑误报、单跑全绿）。复验仍失败才算真失败，回报里注明"连跑 FAIL / 单跑 FAIL"两行。
4. 附带静态检查：`node --check lib\index.js; node --check lib\client.js`；对改动过的文件抽查前三字节非 `EF BB BF`（BOM 会让 dsh web 起不来）。

## 回报格式（原样 JSON）

```json
{ "ok": true, "total": 70, "failed": [], "flaky": [], "node_check": "ok", "bom": "ok", "head": "<git log -3 首行>", "dirty": ["<git status --short 逐条>"], "durationMs": 0, "error_tail": "" }
```

- `failed`：`["<套件名>: <失败断言行摘要≤120字符>"]`；`flaky`：连跑挂但单跑绿的套件名。
- `dirty` 原样列出——**脏树范围核实是主对话的决策项**，子代理只如实上报。
- 有任何套件既非 0 也非 1 的退出码、或套件文件无法运行 → `ok:false` + `error_tail`（≤20 行）。

## 边界

- 不诊断根因、不修东西——那是主对话/修复子代理的事。
- 测试会创建临时目录（`os.tmpdir()` 下的 `dam-*`），跑完不清理不算失败；但**不得**去清理 `D:\dsh-auto-memory` 仓库内任何文件。
