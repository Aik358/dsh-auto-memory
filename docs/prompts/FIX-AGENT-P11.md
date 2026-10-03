> **给使用者的说明**：**可与 P9 并行**投喂给另一个 Agent（无依赖、风险低、建议尽早做）。复制时从 `你是一名严谨的修复 Agent` 开始到文件末尾（自包含，无需 `_COMMON.md`）。
> ⚠️ 本段会改 `lib\index.js` —— **与 P9 排查段不冲突**（P9 不改码），但**不要和其他改 index.js 的任务同时进行**。

---

你是一名严谨的修复 Agent。工作目录：`D:\dsh-auto-memory`（Node.js 项目，BSD-3-Clause，v2.2.6，零运行时依赖）。

# 任务：fail-soft 空 catch 统一可观测（只加日志，绝不改行为）

## 0. 背景（实读代码，2026-09-09 核实）

- M8-2b 曾出现 P0 缺陷：新增代码裸用未导入的 `readdirSync`，抛错后被 `catch (eImp) {}` **静默吞掉**，导致整条 importance 管道在生产中全程失效，而**四套冒烟全绿**——因为冒烟测的是纯函数，从不执行接线代码。
- 该缺陷已修（提交 `4d54664`），同提交给该 catch 补了 diag，写法如下（**沿用这个写法**）：

```js
} catch (eImp) { try { diag('evidence-agg 降级为中性(impMap 空): ' + String((eImp && eImp.message) || eImp).slice(0, 140)) } catch (_) {} }
```

- 同一条 recall 融合链上**仍有同款静默空 catch**：`eRrf`、`eL0Sem`、`eAnchor`（名称以实际 grep 为准）。

**目标**：把**记忆 / 检索 / 接续链路**上的 fail-soft 空 catch 统一加上可辨识的 diag 日志。**只加日志，控制流一律不变。**

## 1. 必读文件（绝对路径）

- `D:\dsh-auto-memory\lib\index.js` —— 主要改动面（recall 融合、L0 语义、接续锚点链路）
- `D:\dsh-auto-memory\lib\client.js` —— 查是否有同款空 catch
- `diag()` 的定义处（在 `lib\index.js` 内，请自行 grep 定位，确认其输出目标文件）
- 参考写法：`git show 4d54664 -- lib/index.js`

## 2. 硬约束（违反即打回）

1. **搜索优先**：先 grep 定位 `diag()` 定义、空 catch 全清单，记下真实行号（prompt 中的行号可能漂移）。
2. **行为零变更**：异常仍被吞掉（保持 fail-soft，不向上抛），不得改控制流，不得加重试，不得改 `try` 内任何业务逻辑。
3. **最小 diff**：`git diff` 只能出现 catch 行。
4. **零新依赖**；不得引入日志库。
5. **日志不得进入提示词 / 注入内容 / 对外响应**——diag 只写日志文件。
6. 不得删除既有断言。

## 3. 改动边界

- ✅ 允许修改：`D:\dsh-auto-memory\lib\index.js` 中**记忆/检索/接续链路**的 catch 行
- ❌ **禁止修改**：任何 `try` 块内的业务逻辑；任何控制流
- ❌ 禁止：全仓无差别改造（只改记忆/检索/接续链路）；给无关 catch 加日志
- ❌ 禁止修改：`lib\recall-fusion-pre.js`、`lib\evidence-agg-pre.js`、`lib\memory-importance-pre.js`、`lib\l0-extract-pre.js`

## 4. 验收标准

1. **先出清单**：grep 全仓 `catch` 后直接 `{}` 或仅注释的空捕获，按模块分组列 `文件:行号`；**明确标注本次改哪些、不改哪些及理由**
2. 每处补日志的 catch：
   - 可辨识前缀（如 `recall-fusion 降级:` / `l0-sem 降级:` / `handoff-anchor 降级:`）
   - 含异常摘要（`String((e && e.message) || e).slice(0, 140)`）
   - **外层再包一层 try/catch**，确保 diag 自身抛错也不影响主流程
3. **行为不变**：可通过 `git diff` 证明只有 catch 行被改
4. 确认 `diag()` 输出目标**在 `~/.dsh/memory` 之外或不污染用户记忆文件**（隐私口径）
5. 基线不降：p8 14 / p4 34 / evidence-agg 14 / memory-importance 18 / handoff 51 / continue-chain 58

## 5. 停止条件

若 `diag()` 不存在，或其输出目标落在用户记忆目录内（可能污染记忆或外泄），**立即停止回报**，不得自行新建日志通道。

```
停止原因：未能定位 <符号> / 输出目标不合规
已尝试：<搜索词 1>、<搜索词 2>、<路径>
需要：<澄清问题>
```

## 6. 完成后自检（逐项执行并贴原始输出）

```bash
cd /d/D/dsh-auto-memory || cd D:/dsh-auto-memory

node --check lib/index.js

node tests/smoke/smoke-test-p8-rrf-wiring-pre.mjs       # 14
node tests/smoke/smoke-test-p4-l0-response-pre.mjs      # 34
node tests/smoke/smoke-test-evidence-agg-pre.mjs        # 14
node tests/smoke/smoke-test-memory-importance-pre.mjs   # 18
node tests/smoke/smoke-test-handoff-pre.mjs             # 51
node tests/smoke/smoke-test-continue-chain-pre.mjs      # 58

# 证明只有 catch 行被改
git diff --stat
git diff lib/index.js | grep -E "^[+-]" | grep -vE "^[+-]{3}"
```

## 7. 回报必须包含

1. 全仓空 catch 清单（按模块分组）+ 本次取舍理由
2. 每处改动：`文件:行号 — 原内容 → 新内容`
3. `diag()` 定义位置与输出目标文件
4. 控制流未变的证明（diff 仅含 catch 行）
5. 自检原始输出
6. 回滚方式：`git checkout lib/index.js`

---

> 背景依据：`D:\dsh-auto-memory\docs\prompts\M8-2-ADJUDICATION.md` §6.2、§6.4。
