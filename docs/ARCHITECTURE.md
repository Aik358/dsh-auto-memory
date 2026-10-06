# 项目架构 / Project architecture

这份图记录已实现的项目结构，依据上游 **v3.2.10**、提交 [`8280500`](https://github.com/Aik358/dsh-auto-memory/tree/828050056cf053c53fb2c237706f6e89c7baef09)，核对日期为 2026-10-06。它不包含本地评测、个人 fork 独有改动或未合并 PR；[#241](https://github.com/Aik358/dsh-auto-memory/issues/241) 中的重构建议也没有画成已实现功能。

## 从哪里看

| 文件 | 用途 |
| --- | --- |
| [中文总览](architecture/overview-zh-CN.png) / [English overview](architecture/overview-en.png) | README 使用的简化图：界面、入口、会话、写入、检索、接续与 Prompt 装配 |
| [完整交互图](architecture/system-map.html) | 展开观察与激活、记忆中枢、技能导出、团队协作、配置与迁移；节点附固定提交的源码链接 |
| [完整图源文件](architecture/system-map.json) | 可编辑的组件、连线、布局、说明和源码行号 |
| [总览图生成提示词](architecture/overview-prompts.json) | 中英文生图提示词，包含准确的节点和箭头要求 |

GitHub 文件页会显示 HTML 源码。下载 `system-map.html`，用浏览器打开，即可缩放、切换主题、查看源码出处和导出图片；文件本身包含查看器，无需安装插件。

## 如何理解总览图

- **多数方框是 Node 宿主内部的模块**，不是分别部署的服务。记忆文件是本地持久存储；JS 语义推理 Worker 和可选 Python 是独立进程。
- **从入口向下看，再看分支**：界面通过插件接口调用会话记忆引擎；引擎协调接续、Prompt 装配、写入和检索。检索读取记忆材料，并按配置使用语义排序。
- **总览省略了内部步骤和可选分支**。开关、降级、USER 候选确认、团队配置和配置迁移的约束写在完整图中。图上存在某项能力，不表示你的安装环境已经启用它。

完整图保留现有源码关系。调用方、实际读写方、跨进程推理和本地存储分别标示；维护区展开的是同一套配置与记忆文件，不是额外复制一份存储。

## 更新图时

1. 在干净的上游检出中核对版本、提交和受影响代码。先检查 `system-map.json` 中的源码出处，再修改对应组件、连线和说明；不能只换提交号而沿用旧行号。
2. 使用 [archify](https://github.com/tt-a1i/archify) 重新生成完整图。替换下面的工具路径和源码目录；源码目录的 `origin` 应指向官方上游。

   ```sh
   node /path/to/archify/bin/archify.mjs finalize architecture \
     docs/architecture/system-map.json docs/architecture/system-map.html \
     --repo-root /path/to/clean-upstream-checkout --quality showcase \
     --out-dir /path/to/local-architecture-evidence --json
   ```

3. 若总览涉及的功能关系改变，使用保存的提示词重新生成两种语言的图片。生图结果需要人工核对文字、节点数量和箭头方向，不能把模型补画的关系当成源码事实。
4. 检查中英文 README 的图片、链接和版本说明；复核完整图的源码链接、文字及连线。架构产物检查与插件功能测试分别记录。

本次完整图通过 archify 的规范、产物及浏览器检查；两张 README 图使用内置生图工具生成，并人工核对了九个组件、九条有向关系和说明文字。本次没有修改运行时代码，没有重新运行插件功能测试或进行真实 DSH 宿主验收。

## English reading notes

The diagrams describe the implemented plugin at **v3.2.10 / `8280500`**, checked on 2026-10-06. Most boxes represent modules inside the Node host. Semantic inference uses a separate JS worker or an optional Python process. Optional features, safety conditions and pinned source links are expanded in the full map. The diagrams do not include local evaluations, unmerged changes or the proposed refactoring in #241.

Download [system-map.html](architecture/system-map.html) and open it in a browser for the interactive viewer. To update it, inspect the clean upstream source, edit [system-map.json](architecture/system-map.json), and run the archify command above. Update the image-generation prompts when overview relationships change, then check both generated images against the source. Diagram checks do not establish runtime or deployment acceptance.
