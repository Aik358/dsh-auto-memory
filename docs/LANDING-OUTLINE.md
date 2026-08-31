# dsh-auto-memory 宣传网页大纲（LANDING-OUTLINE）

> 交付方：混元 4 · 产物：`docs/landing/index.html`（单文件、零依赖、响应式、中英双语切换）
> 视觉方向（仅此一条硬约束）：**深色液态玻璃质感**——与向导/CHANGELOG 的观感一致即可。
> **其余美术决策（配色微调、字体、布局结构、动效风格、插画元素）全部由你自由发挥**——
> 你的前端审美是这次交付的核心价值，大胆做，不要保守。可参考 `docs/proactive-associative-memory-system-map.html`
> （项目架构图，感受一下气质）与 `docs/screenshots/`（真实产品截图），但**不必模仿**。
> 内容素材：README.md / README.zh-CN.md（双语全文）、docs/screenshots/（7 张实机图）。
> 铁律：覆盖本大纲全部功能点；不省略、不虚增；截图相对路径引用；不改仓库其他文件。

## 0. 全局设计语言

- 深色底 #0B0F1A；主渐变 #4D6BFE→#9B7EFF；磨砂玻璃卡片（backdrop-filter blur + 白边光 + 内辉光）
- 字体：system-ui 栈；标题字重 700-750；正文 1.6-1.7 行高
- 动效：进入视口渐显上浮（IntersectionObserver）；卡片 hover 抬升；克制不闪烁
- 语言切换：右上角 中/EN 切换，`<html lang>` 与全部文案随之切换（默认中文）

## 1. Hero（首屏）

- 主标题：dsh-auto-memory —— 让 AI 真正记得你 / An AI that actually remembers
- 副标：DeepSeek Harness 的联想记忆与人性化交互插件：三层记忆、每轮自动沉淀、主动提醒、欢迎向导、无人值守
- CTA 双按钮：安装命令（点击复制 `pnpm add @a9i5k4/dsh-auto-memory`）/ GitHub
- 背景：三层玻璃板 Logo 放大虚化悬浮（呼应品牌）；可放 docs/screenshots/tour-welcome.png 作侧图

## 2. 数据流（核心原理一图流，源自架构图）

按架构图 A/B/C 三段做成三张横向卡片+箭头连接：
1. 观察：监听对话/工具事件 → 记忆锚定（M3）
2. 检索决策：三层检索（词法保底/内置语义/Python BGE-M3）→ 两车道决策（该不该打断、注入什么）
3. 投递闭环：固定边界注入（前缀缓存友好）→ delivered/seen 证据 → 唤起回顾可打分
每张卡一句人话解释；底部注明"决策全程可复核，记忆治理永远在 JS 权威层"

## 3. 功能全景（逐节，禁止省略）

### 3.1 三层记忆体系
表格：用户级 MEMORY.md / 项目笔记 / 每日日志 / 每日反思——位置+内容；注入策略（静态纪律进 system prompt 保缓存；动态记忆只注入最近 1 天，其余按需 recall；凭证永不进提示词）

### 3.2 自动沉淀（记忆自己写自己）
每轮结束子代理静默评估；主题分组写日志；长期决策升格项目笔记；跨项目规则升格用户级；闲聊跳过；失败重试+心跳；每日预算+AI 自动压缩（超限不拒写）

### 3.3 欢迎向导（v0.1.30 大更新，配 tour-*.png 截图×4）
分步介绍全部功能；每项当场开关立即生效；Office/Fluent 式彩色玻璃图标族+专属动效；语义引擎检测/下载/自检内联；外部记忆实时扫描逐源勾选；一次性触达（老用户升级自动播放）；设置页可重看

### 3.4 唤起与技能固化（配 panel-refine.png）
联想检测→下一环节注入；技能 checklist 自动附上；跨会话验证晋升（observed→candidate→validated→active）；90 天归档+置顶；唤起回顾页 A/P/S/H/E 打分+队列汇总+政策提示

### 3.5 无人值守模式
手动开关+夜间自动托管（22:00-08:00 可调）；托管期间零寒暄/零行为指令/日历静默/上下文稳定；面向长批处理（源自 Issue #10 社区反馈）

### 3.6 AI 问候与每日反思
时段问候（晨/午/晚提及当日要点）；暂离 >1h 回归自动开面板+欢迎回来；每日第一次会话呈现昨日结构化反思

### 3.7 智能检索与工作区全景
自然语言跨层检索（关键词级，标注来源）；跨工作区检索天然支持；工作区关系图（AI 归纳主题与关联，拖拽/缩放/点卡详情）

### 3.8 日历 — AI 替你维护
对话中识别 deadline/约定自动入日历；未完成注入后续会话提醒；四象限+日时间轴 07:00-22:00+地点/提醒字段

### 3.9 外部记忆继承
WorkBuddy/CodeBuddy/Claude Code/Codex 扫描发现；按源导入（纯路径指针不复制）；按源删除；导入侧+注入侧双重卫生闸门

### 3.10 记忆卫生（生产级）
写入门禁 sanitizeForWrite（GBK 乱码 34 特征/复读/重复行/外部画像 JSON/base64）；调试中心脏 token 扫描（按行区间只报位置）；写入上限与 60 行去重

### 3.11 记忆生命周期
30 天蒸馏（AI 提炼长期价值进笔记，原文归档 archive 不丢）；明确边界：procedure skills 与两级笔记不在蒸馏范围；归档原文不在常规检索扫描内（蒸馏要点随笔记常驻注入）；memory_consolidate 发散固化；预算自动压缩

### 3.12 工程内核（信任背书）
零运行时依赖；前缀缓存友好（字节级稳定提示词）；限额 AI（≤8 次/天）；集中式存储；可选 Python sidecar（BGE-M3 int8，失败自动回退词法）

## 4. 界面速览

网格卡片放 7 张截图（docs/screenshots/）：panel-overview / panel-hub / panel-refine / tour-welcome / tour-toggles / tour-external / tour-core；每张一句说明

## 5. 快速开始

三步安装（pnpm → bundles 数组 → 重启）；AI 时代安装法（可复制文本框，带复制按钮）；更新方式；系统要求（dsh web、Node 内建依赖即可跑、Python 档可选）

## 6. 社区与链接

Contributors：@ProperSAMA（PR#12）、@nkh0472（Issue#10）带链接；GitHub / npm / License BSD-3-Clause；欢迎 issue/PR 一句话

## 7. 页脚

极简：项目名 + GitHub + npm + 「记忆存在你自己的机器上」隐私一句
