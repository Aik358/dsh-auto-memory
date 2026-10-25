## 摘要（Summary）

更新 dsh-auto-memory 社区插件索引条目：插件 v0.1.30 大更新，核心定位从"三层自动记忆"升级为"主动联想记忆"（记忆不靠模型调用、被情境自动唤回），并明确语义后端可自选（内置 JS 档 / 可选 Python 档）。

## 涉及包（Affected Packages）

- [x] 其他（请说明）：`packages/dsh-community-plugins/community.json` 单条目描述更新（社区插件索引登记，非包内代码改动）

## PR 类别（PR Category）

- [x] 社区插件索引

## PR 类型（PR Type）

- [x] 维护 / 重构（社区插件索引条目信息更新）

## 最新代码确认（Latest Codebase Confirmation）

- [x] 我已基于最新 `dev` 分支开发，或在提交前已 rebase / 合并最新 `dev`。

同步命令：`git fetch origin && git rebase origin/dev`（已确认基于最新 dev，dev 无新提交）

## 测试证据与上游同步（Test Evidence & Upstream Sync）

- [x] 我提供了自己本地测试的证据（执行的命令 / 测试结果 / 运行截图）。
- [x] 我已同步上游最新 `dev` 分支（`git fetch origin && git rebase origin/dev`），并附上同步后重新测试通过的证据（视觉 / 用户可见变更附截图）。

证据：`node scripts/community-index --check` → `community-index: OK (52 entries)`，exit 0。条目字段校验通过（repo URL / npm 名 / category / subcategory 均合法，无 emoji）。

## 视觉修复要求（Visual Fix Requirements）

不适用（纯文本类条目更新，跳过）。

## AI 编码披露（AI Coding Disclosure）

- [x] 部分 AI 辅助：AI 帮助编写或修改了部分编程改动。

使用的 AI 模型：DeepSeek V4 Flash（deepseek-v4-flash）

使用的编码 Agent 工具：DeepSeek Harness（dsh-auto-memory）

## 仓库规范检查（Repo Rules）

- [x] 未修改 DSH 官方源码，仅基于官方 NPM SDK（`@deepseek-ai/*`）开发。
- [x] 未新增指向 DSH 源码 checkout 的 tsconfig `extends` / `paths` / `references`。
- [x] 新增包目录以 `dsh-` 前缀命名（如 `packages/dsh-xxx`）。（本次无新增目录）
- [x] 所有新增 / 修改文件不含任何 emoji 字符。
- [x] 改动包 README 时同步维护中英双语三件套（`README.md` / `README.zh.md` / `README.i18n.yaml`）并运行 `pnpm docs:check`。（本次未改 README，不适用）

## 贡献者版权声明（Contributor Copyright）

不声明（条目仅更新描述，维持现有版权归属）。

## 新皮肤收录（New Skin）/ 新宠物收录（New Pet）

不适用（非皮肤 / 宠物 PR）。

## 社区插件索引登记（Community Plugin Index）

插件 GitHub 仓库链接：https://github.com/Aik358/dsh-auto-memory

插件详细说明：
dsh-auto-memory 是 DeepSeek Harness Web GUI 的**主动联想记忆插件**：Host 侧中间件持续观察对话情境，NLP 关键词 + 向量化双轨检索，相关记忆在模型开口之前经固定边界注入下一环节（前缀缓存友好，零运行时依赖）。功能含三层记忆自动沉淀、欢迎向导（每项功能当场开关）、唤起回顾（每次激活决策带证据可打分）、无人值守模式（面向长批处理）、AI 问候与每日反思、日历提醒、跨工具记忆继承（WorkBuddy / CodeBuddy / Claude Code / Codex）。**语义后端可自选**：内置 JS 档（e5-small q8 ~130MB，默认，npm 资产包分发）+ 可选 Python BGE-M3 int8 进阶档（563MB，R@5 0.925，失败自动回退词法），词法 BM25 0GB 永远兜底。npm：`@a9i5k4/dsh-auto-memory`，BSD-3-Clause。已知限制：记忆文件为明文 Markdown 不存密钥；插件增减需重启 dsh 生效。

- [x] 已按 [docs/plugins.md](../docs/plugins.md) 的登记说明在 `packages/dsh-community-plugins/community.json` 追加条目，并运行 `node scripts/community-index` 重新生成注册表（提交生成的 `packages/dsh-community-plugins/src/client/generated/community.ts`）。
- [x] 已确认插件与 dsh-web 插件体系兼容：遵循官方 cordis bundle 独立标准（package.json 声明 `dsh.bundle.patch` 指向 `cordis.patch.yml`、`dsh.client` 浏览器半区），类型仅基于官方 `@deepseek-ai/*` NPM SDK，未修改 DSH 源码；已在本仓库最新代码上验证插件可被 `dsh web` 挂载并正常运行。
- [x] 承诺负责后续更新跟进：插件与 DSH / dsh-web 生态保持同步，生态升级导致不兼容时主动跟进修复；条目信息（description / npm 等）变动或插件停更时，及时更新索引登记或提交移除。

## 本地验证（Local Validation）

执行的命令：

```bash
node scripts/community-index --check
```

结果摘要：`community-index: OK (52 entries)`，exit 0。JSON 语法合法、条目字段（repo / npm / category / subcategory）全部通过校验，修改仅 4 行描述文本，无 emoji。

## 用户可见变更证据（Local Feature Evidence）

证据：N/A（纯索引条目描述更新，无运行时行为变更；市场卡片文案将由 market-build 从 community.json 重新生成）。
