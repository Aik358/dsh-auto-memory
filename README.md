# dsh-auto-memory — Auto Memory & Proactive Companion for DeepSeek Harness

<p align="center">
  <img width="820" alt="dsh-auto-memory banner" src="docs/banner.jpg">
</p>

<p align="center">
  <b>中文</b> · <a href="README.zh-CN.md">English</a> · License BSD-3-Clause · <code>pnpm add @a9i5k4/dsh-auto-memory</code>
</p>

> **v0.1.30 大更新** — 全新「欢迎向导」：分步介绍所有功能、当场开关；Office/Fluent 式液态玻璃应用图标族；更新日志开场动画；无人值守模式面向长批处理任务。

一个为 DeepSeek Harness Web GUI 打造的**联想记忆与人性化交互插件**：三层记忆自动注入与按需检索、每轮自动沉淀、AI 问候与每日反思、日历提醒、外部 AI 记忆继承——以及面向生产环境的无人值守/批处理支持。

**它解决的问题是**：AI 助手每次会话都从零开始。装上它之后，你的 AI 记得住你的偏好、项目约定、昨天的进度、下周的截止日期——并且在你回来时说一声"欢迎回来"。

---

## ✨ 30 秒亮点

| | |
|---|---|
| 🧠 **三层记忆引擎** | 用户级规则 → 项目笔记 → 每日日志，自动注入+按需检索，前缀缓存友好 |
| ✍️ **记忆自动沉淀** | 每轮对话结束由子代理静默判断去留，主题分组写入日志——你永远不需要记得"记一下" |
| 🔔 **主动式提醒** | AI 从对话中识别截止日期/约定，自动入日历并在后续会话中提醒 |
| 🎛️ **一切皆开关** | 欢迎向导+设置页双重入口，每个功能独立开关（含无人值守模式） |
| 🌐 **外部记忆继承** | WorkBuddy / CodeBuddy / Claude Code / Codex 的历史记忆可扫描、导入、按源管理 |
| 🛡️ **生产级卫生** | 写入门禁（乱码/复读/JSON 注入拦截）+ 脏 token 扫描 + 凭证永不进提示词 |

---

## 🧭 欢迎向导（v0.1.30 新增）

升级或首次安装后，插件会自动播放一段**分步欢迎向导**——这不是弹窗广告，而是功能总开关的集合地：

<p align="center"><img width="720" alt="welcome tour" src="docs/screenshots/tour-welcome.png"></p>

- **每步一枚 Office/Fluent 式液态玻璃应用图标**：注入青蓝、问候暖金、日历青绿、引擎紫蓝、雷达天青、完成珊瑚金——各配专属循环动效（铃摆动、日历翻页、雷达扫描、火花上升…）
- **每项功能当场开关**：开关即写配置立即生效，不需要再进设置页确认
- **语义引擎检测/下载内联**：三级检索引擎（词法 0GB 保底 → 内置语义 ~130MB → Python BGE-M3 进阶）在向导内自动检测、一键安装（SHA256 校验+推理自检）
- **外部记忆实时扫描**：本机可读的 WorkBuddy / Claude Code / Codex 等来源直接列出，逐源勾选
- **关不掉的困惑不存在**：中途关闭会先落到"完成提醒"步，告诉你每个功能在设置的哪个分区重新打开

<p align="center"><img width="720" alt="tour core" src="docs/screenshots/tour-core.png"></p>

升级用户的一次性触达：v0.1.30 起所有用户升级后都会自动播放一次完整向导，结束后自动接更新日志（可点击跳过）。之后可随时在 **设置 → 外观 → 欢迎向导 → ▶ 重看引导** 重新打开。

---

## 🧠 三层记忆体系

| 层 | 位置 | 内容 |
|---|---|---|
| 用户级记忆 | `~/.dsh/memory/MEMORY.md` | 跨项目规则与偏好 |
| 项目笔记 | `~/.dsh/memory/workspaces/{workspace}/MEMORY.md` | 项目约定与决策 |
| 每日日志 | `~/.dsh/memory/workspaces/{workspace}/YYYY-MM-DD.md` | 追加式工作日志 |
| 每日反思 | `…/reflections/YYYY-MM-DD.md` | 结构化复盘（成果/教训/下一步） |

**注入策略**：静态纪律进 system prompt（字节级稳定，保前缀缓存命中）；动态记忆走运行时快照——只注入最近 1 天日志+反思摘要，其余全部按需经 `memory_read` / `memory_recall` 取回。凭证/密钥段**永远被过滤在提示词之外**。

---

## 🗂️ 功能全景

### 自动沉淀 — 记忆自己写自己

每轮对话结束后，一个小型子代理静默评估本轮内容：有长期价值的主题分组写入今日日志（`## 主题（HH:MM）`+要点），长期决策晋升项目笔记，跨项目规则晋升用户级记忆，闲聊跳过，失败进队列每 5 分钟重试（15 秒心跳文件证明循环存活）。每日写入有预算与自动压缩（超限不拒写，AI 合并去重后写入）。

### 唤起与固化 — 该出手时才出手

联想式记忆唤起在对话链中检测回忆需求，命中即注入下一环节（不破坏前缀缓存）；高频流程固化为技能 checklist，匹配对话自动附上，跨会话验证后晋升（记忆中枢页审批，90 天未用自动归档可置顶）。**每一次"要不要打断你"的决策都能在「唤起回顾」页复核打分**（A 该激活 / P 只预取 / S 应抑制 / H 有害 / E 改目标），判定队列会汇总成政策提示。

<p align="center"><img width="720" alt="refine" src="docs/screenshots/panel-refine.png"></p>

### 无人值守模式 — 面向批处理任务

长跑批处理/自动化流水线？设置 → 自动化提供**无人值守模式**与**夜间自动托管**（22:00-08:00 可调）。托管期间：不注入欢迎语/寒暄/行为指令、日历提醒静默、上下文保持稳定——模型专注干活，token 花在正事上。

### AI 问候与每日反思

按时段（晨/午/晚）生成提及你当日最重要工作的问候；暂离超过 1 小时回来，记忆面板自动打开并送上"欢迎回来"+近期工作摘要；每天第一次会话主动呈现前一日结构化反思。

### 智能检索

自然语言提问，AI 自动扩展关键词扫描全部记忆层，会话式回答并标注来源；支持跨工作区检索。

### 日历 — AI 替你维护

AI 从对话中识别截止日期/约定自动入日历（`calendar_add`），未完成事项注入后续会话直到完成；日视图 07:00-22:00 时间轴、地点/提醒字段、紧急度语义色。

### 外部记忆继承

WorkBuddy / CodeBuddy / Claude Code / Codex 的历史会话与记忆可扫描发现、按源导入（**只存路径指针，不复制内容**）、按源删除；导入侧+注入侧双重卫生闸门防外部脏数据混入。

### 记忆卫生（生产级写入门禁）

- 三个写入工具全部过 `sanitizeForWrite`：GBK 乱码（34 特征全表）、复读退化、连续重复行、外部 AI 画像 JSON 特征、base64 残留——全部拒写并给出中文回执
- 设置 → 调试中心「扫描脏 token」：一键扫描用户级/项目/日志/反思，按行区间报告问题（只报位置不含正文）
- 追加 8000 字/条、全量改写 20 万字上限；追加前与文件尾部近 60 行做去重

---

## ⚙️ 工程内核（保持克制的设计）

- **零运行时依赖**：Node 内建模块之外无任何依赖
- **前缀缓存友好**：提示词字节级稳定，DeepSeek 前缀缓存持续命中，不反复重编码历史
- **限额 AI**：自动沉淀每日 ≤8 次带冷却，记忆有用但不烧预算
- **集中式存储**：全部工作区记忆收在 `~/.dsh/memory/workspaces/` 一个根下，任意会话可读
- **30 天蒸馏**：旧日志由 AI 蒸馏进项目笔记，原文归档不丢失

---

## 📸 界面速览

### 记忆面板 · 概览（暂离问候 + AI 时段总结）

<img width="480" alt="overview" src="docs/screenshots/panel-overview.png">

### 记忆中枢 · 三层记忆店与技能晋升审批

<img width="480" alt="hub" src="docs/screenshots/panel-hub.png">

### 唤起回顾 · 每次激活决策可打分

<img width="720" alt="refine" src="docs/screenshots/panel-refine.png">

### 欢迎向导 · 功能开关与引擎检测

<img width="720" alt="tour" src="docs/screenshots/tour-toggles.png">

<details>
<summary><b>更多截图</b>（点击展开）</summary>

### 外部记忆扫描（欢迎向导内）

<img width="720" alt="external scan" src="docs/screenshots/tour-external.png">

### 连接其他 AI 工具

<img width="480" alt="connect" src="docs/screenshots/connect-zh.png">

### 日历视图

<img width="480" alt="calendar" src="docs/screenshots/calendar-zh.png">

### 工作区关系图

<img width="480" alt="workspace map" src="docs/screenshots/workspace-map-zh.png">

### 设置页

<img width="480" alt="settings" src="docs/screenshots/settings-zh.png">
<img width="480" alt="settings 2" src="docs/screenshots/settings-2-zh.png">

</details>

---

## 🚀 安装（一条命令）

> 前置：安装 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 并至少启动过一次 `dsh web`。

在 **profile 目录**（`~/.dsh/profiles/web`）执行：

```bash
cd ~/.dsh/profiles/web
pnpm add @a9i5k4/dsh-auto-memory
```

然后编辑同目录 `package.json`，在 `dsh.profile.bundles` 数组追加：

```json
"@a9i5k4/dsh-auto-memory"
```

重启 **dsh web** 生效（侧边栏出现「记忆」入口）。

> 没有 pnpm？`npm install @a9i5k4/dsh-auto-memory` 同样可用。
> pnpm v11 限制安装发布不足 1 天的版本：当天发布想立即更新，在 profile 目录 `pnpm-workspace.yaml` 加 `minimumReleaseAge: 0`，或装显式版本。

### AI 时代安装法

复制下面这段发给你正在用的 AI 助手即可：

```text
在 DeepSeek Harness web profile 目录 ~/.dsh/profiles/web 安装 npm 包
@a9i5k4/dsh-auto-memory（pnpm add 或 npm install），
把 "@a9i5k4/dsh-auto-memory" 追加到 package.json 的 dsh.profile.bundles 数组，
然后重启 dsh web 激活插件。
```

### 更新

```bash
cd ~/.dsh/profiles/web && pnpm up @a9i5k4/dsh-auto-memory
```

设置 → 自动记忆页的「检查更新」按钮可比对 npm registry 最新版；registry 安装支持一键更新。

---

## 🔧 配置

配置文件 `~/.dsh/dsh-auto-memory.json`（GUI 设置页可视化调整，含中英文界面与面板字号）：

```json
{
  "userMemoryDir": "~/.dsh/memory",
  "memoryRoot": "~/.dsh/memory/workspaces",
  "injectEnabled": true,
  "injectBudgetChars": 2400,
  "recentDaysInjected": 1,
  "reflectEnabled": true,
  "autoConsolidate": true,
  "autoConsolidateCooldownMinutes": 30,
  "autoConsolidateDailyMax": 8,
  "unattendedMode": false,
  "unattendedAuto": false,
  "unattendedAutoHours": ["22:00-08:00"],
  "memoryHubEnabled": true,
  "externalSources": { "workbuddy-user": true, "claude-global": true },
  "dayBoundaryMinutes": 450
}
```

> 完整键位见设置页——每个开关都有中文说明；欢迎向导里的每个开关与设置页一一对应。

---

## 🧱 结构

- `lib/index.js` — Host 半：引擎、注入、工具、路由（零运行时依赖）
- `lib/client.js` — Browser 半：记忆面板（含日历/关系图）+ 设置页 + 欢迎向导（内置中英 i18n）
- `python/` — 可选 Python 语义 sidecar（BGE-M3 int8，进阶档）
- `cordis.patch.yml` — 插件注册行

## ⚠️ 已知限制

- 记忆文件为纯文本 Markdown；除非明确要求，不存储密钥
- `memory_recall` 会话搜索依赖已部署的 session-query 索引，缺失时仅本地检索可用
- 插件增减需要重启 dsh 生效

---

## 🙌 社区致谢

- [@ProperSAMA](https://github.com/ProperSAMA) — DSH Desktop 增强模式（透明/Mica 材质）面板可读性修复 + 入口按钮防遮挡与外点/Esc 关闭（[PR #12](https://github.com/Aik358/dsh-auto-memory/pull/12)）
- [@nkh0472](https://github.com/nkh0472) — 无人值守/批处理场景加固反馈，推动了欢迎向导与功能开关化（[Issue #10](https://github.com/Aik358/dsh-auto-memory/issues/10)）

---

## 📦 发布信息

- GitHub: https://github.com/Aik358/dsh-auto-memory
- npm: `@a9i5k4/dsh-auto-memory`
- License: BSD-3-Clause
