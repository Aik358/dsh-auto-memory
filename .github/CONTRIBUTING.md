# 参与贡献 / 反馈与提 issue 的填写规范

> 本文件是**规范**，不是**表单**：本仓库的 issue 模板没有任何必填项、没有校验、没有强制段落。
> 留空、删掉整节、只写一句话，都是合法提交。这里只说明「怎么写别人更容易接住」。

---

## 0. 人和 Agent 都适用

GitHub 的 **issue 模板只在网页端生效**（打开 `/issues/new` 时的模板选择器）。
通过 **REST API / `gh issue create`** 提交 issue **完全绕过模板**，因此：

- 自动建单脚本（如本仓 `.github/scripts/group-listener.mjs`）**不受模板影响**，行为与之前完全一致；
- 用 API 提交的 Agent **不会自动读到模板**，需要读的正是**本文件**。

⇒ 本文件是**机器可读的规范入口**：Agent 在 API 建单前请读这里，自行按下面的分类选 label、组织正文。

---

## 1. 先选 label（决定谁来接）

| label | 什么时候用 |
|---|---|
| `preview bug report` | 预览版（3.4.x-alpha）**运行期缺陷**：异常、竞态、断言写错、边界漏判 |
| `preview function report` | 预览版**功能不符预期**：该生效却没生效、白板该更新却没更新 |
| `bug` | 正式版 / 已发布功能的问题 |
| `enhancement` | 新能力、想改掉的旧体验 |
| `question` | 用法疑问、行为看不懂、想确认是不是设计如此 |
| `documentation` | 文档缺失、过时、链接失效 |
| `accessibility` | 无障碍障碍 |

> ⚠️ 常见坑：预览版功能问题的 label 是 **`preview function report`**（带 `report`）。
> 写成 `preview function` 时 GitHub **静默不指派**，issue 会以「无 label」状态落库。

---

## 2. 建议写什么（都不是必填）

一个**能被直接动手**的 issue 通常包含三件事：

1. **版本 / 基线** —— 插件版本 + commit（如 `3.4.0-alpha.1`，`7f453eb`）
2. **现象与期望** —— 做了什么 → 期望什么 → 实际什么
3. **证据** —— 报错原文、截图、复现脚本、相关源码 permalink

可选但很有用的：

- **复现频率**：偶发也请写「偶发」并给个大致比例（10 次里 3 次）
- **已排除的可能**：省掉维护者重复排查
- **影响面**：会不会破坏既有约定（例：日志/反思不事件化、白板必须由事件渲染）

### 功能问题 vs 代码问题怎么分

- **功能问题**（`preview function report`）：跑得通，但**结论不对**
- **代码问题**（`preview bug report`）：**跑不对**——抛异常、竞态、断言写错、边界漏判

拿不准就随便选一个，维护者会改 label。**不要因为拿不准而放弃提交。**

---

## 3. Agent 建单时请遵守

如果你是自动建单的 Agent：

1. **读本文件**再组织正文，不要凭空猜 label 名
2. **label 用上表里的原样字符串**（含空格、区分大小写）；不存在的 label 会被 GitHub 静默丢弃
3. **正文里保留可复算的坐标**：文件路径 + 行号、commit sha、命令与输出原文
4. **不要把整段会话转写倒进来**——提炼成「现象 / 证据 / 期望」三段
5. **不要编造版本号或 commit**；拿不准就不写这一节

---

## 4. 不做什么

- 不要求复现步骤完整才能提交
- 不要求先搜历史 issue（搜了更好，没搜也不拦）
- 不设模板必填项、不加 `validations`

---

## 5. 相关入口

- 新建 issue：<https://github.com/Aik358/dsh-auto-memory/issues/new/choose>
- 讨论区（还在讨论阶段的想法）：<https://github.com/Aik358/dsh-auto-memory/discussions>
- 3.4 预览版排查指南：`docs/PREVIEW-3.4.md`（在 `preview` 分支）
