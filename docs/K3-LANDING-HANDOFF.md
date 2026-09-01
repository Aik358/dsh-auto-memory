# K3 交接：宣传网页制作（v0.1.30 创新点+全部素材）

> 2026-09-01 · 交付方：K3（前端能力最强，用户亲自督导，质量要求最高）
> 产物：`docs/landing/index.html`（单文件、零依赖、响应式、中英双语切换）
> **本文件自包含**——读完这一份 + 两份引用文档即可开工，无需追问上下文。

## 0. 项目一句话与灵魂（写进 Hero，不可弱化）

dsh-auto-memory 是 DeepSeek Harness Web GUI 的**主动联想记忆插件**。

**人无我有的灵魂**（源自 docs/proactive-associative-memory-system-map.html 开篇）：
「让记忆在**模型没有主动调用**时，也能被当前情境唤回。」

市面所有记忆方案（MCP memory、MemGPT 类）都依赖模型"记得去查"——调工具、发请求，忘了调记忆就等于不存在。本插件是 **Host 侧主动联想中间件**：持续观察对话情境与运行事件，相关记忆在模型开口之前就被检索、决策、并经固定边界注入下一环节。

三个配套的独有工程点：
1. **固定边界注入**：已发出的请求不可原地改写，注入只影响下一 step/turn——DeepSeek 前缀缓存永不失效（字节级稳定提示词）
2. **证据闭环**：open/read≠citation；每次激活决策带完整证据链，「唤起回顾」页可复核打分（A/P/S/H/E）
3. **权限分立**：语义层（何时想起什么）与治理层（身份/授权/时序/投递）分立，记忆治理永远在 JS 权威层

**文案主基调**：不直白说"人无我有"，用"记忆不靠调用，自己被唤回""不用吩咐，她自己记得"这类表达体现。

## 1. 视觉方向

- **美术与创意完全由 K3 自由发挥**（角色/配色/版式/动效/叙事全不设限）——用户明确放权
- 需要参考的是架构图 `docs/proactive-associative-memory-system-map.html` 的**内容本身**：模块划分、数据流（观察→检索决策→固定边界投递→证据闭环）、三层记忆/技能渐进激活/治理如何协作——网页把同样的故事讲出来，视觉形式由 K3 定
- 产品既有观感（可感受，不必模仿）：深色液态玻璃质感、蓝紫主色 #4D6BFE→#9B7EFF
- 角色资产：`docs/banner.jpg` 有官方拟人形象（蓝发蓝眼动漫少女，水彩风）；banner 系列生图 prompt 在 `artifacts/logo/BANNER-SERIES-PROMPTS.md`（如需新图可参考）

## 2. 页面结构大纲（12 节功能全覆盖，禁止省略）

详细大纲在 `docs/LANDING-OUTLINE.md`。速记版：

1. **Hero**：主标题+灵魂句（"不用吩咐，她自己记得"）+安装 CTA（`pnpm add @a9i5k4/dsh-auto-memory`，点击复制）+GitHub 链接
2. **数据流一图流**：观察→检索决策→固定边界投递→证据闭环（源自架构图叙事）
3. **功能全景**（每节都要有，配截图）：
   - 主动联想（零指令，首节）
   - 自动沉淀（每轮子代理静默写日志，闲聊跳过，预算+自动压缩）
   - 欢迎向导 v0.1.30（分步介绍+每项当场开关+引擎检测/下载/自检内联+外部来源扫描；tour-*.png×4）
   - 唤起与技能固化（observed→candidate→validated→active 晋升，90 天归档+置顶；回顾打分）
   - 无人值守模式（手动+夜间自动托管 22:00-08:00；零寒暄零行为指令，源自 Issue#10）
   - AI 问候与每日反思（时段问候/暂离 >1h 欢迎回来/每日结构化反思）
   - 智能检索+工作区全景（跨层关键词检索标注来源；工作区关系图）
   - 日历（AI 从对话抓 deadline 自动入历，未完成注入后续会话提醒；四象限+日时间轴）
   - 外部记忆继承（WorkBuddy/CodeBuddy/Claude Code/Codex 扫描导入，纯路径指针不复制）
   - 记忆卫生（写入门禁：GBK 乱码 34 特征/复读/重复行/外部画像 JSON/base64 拦截；调试中心脏 token 扫描；凭证永不进提示词）
   - 记忆生命周期（30 天蒸馏：只提炼长期价值进笔记，原文归档 archive；**边界**：procedure skills 与两级笔记不在蒸馏范围，归档原文不在常规检索扫描内；memory_consolidate 发散固化）
   - 工程内核（零运行时依赖/前缀缓存友好/限额 AI ≤8 次/天/集中式存储/可选 Python sidecar 失败回退词法）
4. **界面速览**：7 张截图网格（docs/screenshots/panel-overview.png / panel-hub.png / panel-refine.png / tour-welcome.png / tour-toggles.png / tour-external.png / tour-core.png），相对路径引用
5. **快速开始**：三步安装+AI 时代安装法（可复制文本框）+更新方式
6. **配置示例**：`~/.dsh/dsh-auto-memory.json` 关键键（unattendedMode/unattendedAuto/unattendedAutoHours/memoryHubEnabled/externalSources 等）
7. **社区致谢**：@ProperSAMA（PR#12 面板可读性+防遮挡）、@nkh0472（Issue#10 无人值守反馈）
8. **页脚**：GitHub / npm `@a9i5k4/dsh-auto-memory` / BSD-3-Clause / 隐私句「记忆存在你自己的机器上」

## 3. v0.1.30 大更新（CHANGELOG 已定稿，可引用其表述）

- ★ 欢迎向导（功能开关+引擎内联）
- ★ Office/Fluent 式液态玻璃应用图标族（每步一彩一动效）
- ★ CHANGELOG 开场动画（Logo 组装→展开→消散→内容浮现）
- ★ 无人值守就绪
- PR#12 双修复（@ProperSAMA）、弹窗关闭修复、唤起回顾时间线

## 4. 交付要求

- 单 HTML 文件、零外部依赖（字体/库全内联或不用）、桌面+移动响应式
- 中英双语切换（右上角切换器，默认中文）
- 截图相对路径 `../screenshots/*.png`（产物在 docs/landing/ 下）
- 不改仓库其他文件；完成后用浏览器截图桌面+移动两种宽度自检
- 完成后汇报：改动文件、设计要点、自检截图

## 5. 用户偏好备忘

- 语言：中文交流
- 审美要求高（"价格不菲，给我做好了"）——值得花功夫打磨动效与排版细节
- 用户欣赏：架构图 HTML 的信息设计水准；向导的玻璃图标族已获认可（"改得还可以"）
- 避免：emoji 堆砌（README 已清零）；营销空话；省略功能
