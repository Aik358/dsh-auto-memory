# 新界面集成与验收记录

## 当前交付

基线：上游 `Aik358/dsh-auto-memory` 的 `e771386`（v3.2.1），分支 `codex/iter5-ui-integration`。

2026-09-28 后续用户指令将目标从忠实移植 Kimi demo 改为直接参考十张 GPT 图稿进行产品视觉重构，允许突破旧白皮书视觉约束，同时禁止引入项目不存在的功能。已落实到真实宿主客户端，并保留经典回退。

已完成：首页概览与山水横幅、记忆列表与原文详情、日志/反思/检索分区、交接材料阅读、外部来源卡片、月历与事项编辑、技能统计与既有审批、唤起列表与判定详情、工作区图谱、存储维护、四组设置、专注查看、深色跟随和窄屏导航。团队、统计、迁移、Python 安装助手、轻面板和全局向导等上游能力仍可达。

源码：`skins/iter5/`；生成器：`tools/build-iter5-skin.mjs`；发布运行入口：`lib/client.js`。未修改宿主 `lib/index.js`，未新增端点或第二份 React。

## 上游同步与旧工作保护

原 main 与上游历史分叉，不能 fast-forward；因此保留原 main，从已 fetch 的 upstream/main 建立集成分支，没有创建 merge commit。

原未提交 UI 已保留在 stash `preserve-local-ui-before-iter5-20260928`，并额外备份到 `C:/Users/李云龙/AppData/Local/Temp/dsh-ui-before-iter5-20260928-152946/`（含完整 client.js 和 local-ui.patch）。现有设计材料、旧交接目录和其他未跟踪工作均保留。

## 验证层次

### 自动化与源码

- `node --check lib/client.js`、`node --check lib/index.js`：通过。
- `node tools/build-iter5-skin.mjs --check`：生成区与源码一致。
- 新增 `smoke-test-iter5-skin.mjs`：经典源码保留检查、纯 token 色值、容量默认、即时模式切换、并发配置不覆盖、失败草稿保留、取消、引擎关闭确认、来源绝对路径、跨工作区结果拒绝和向导 Hook 数量稳定性均通过。源码检查单独列明三个皮肤接入点及下述向导修复，不能把有意修复伪称为零改动。
- 核心 smoke、API 路径一致性、water-window、团队与设置相关守卫已检查。当前真实 API 为宿主 68 条、客户端 55 条；原交接的 46/44 是旧版本清单。
- 全量沿用 CI 排除项：`-live`、`m79-feature-v2`、`m710-fv2-emit`、`c4-fresh-install`。最近完整结果为 **196 通过、26 失败、0 超时**；最终冻结运行日志见 `artifacts/iter5-integration/smoke-frozen.log`，如需精确状态以该日志为准。
- 26 项失败均在上游 client 源码下复现，涉及缺失 `tools/lib/appearance-scan.mjs`、写死 `D:/dsh-auto-memory` 的测试路径、缺少旧 Python 文件/依赖以及本地旧 V4 专用测试等。不能将其标为 PASS。比较方法与逐项结果在 `baseline-comparison.json`。
- 4 项全文件计数测试已限定到其原本负责的经典设置区；新皮肤有独立行为检查，未删除原断言。

### 真实 DSH web

独立 profile 注册本仓库为 bundle，在 `127.0.0.1:19388` 启动，独立 DSH_HOME 与工作区均位于临时 `dsh-iter5-qa-20260928` 目录。真正通过 `conversation.view` 挂载，使用真实宿主 API；故障注入仅在单项保存失败用例中临时拦截请求。

已验证：九个主页面、即时引擎配置、普通设置 patch 保存、500 失败保留草稿、取消恢复、页签键盘操作、笔记追加、限量记忆检索、日程新增/完成/删除及回读、A/P/S/H/E 反馈提交与队列回读、经典回退、专注查看、主题标记跟随、768/390 布局无横向溢出、抽屉焦点与 Escape。

另已验证真实欢迎向导前 3 步、手动重看入口、轻面板打开与拖动。实测发现上游 `DialogHost` 条件调用主题 Hook 导致 React #310；已修复为无条件调用，并把手动重看移动到新设置的外观组。其余向导状态机保留，没有触发模型下载步骤。证据：`surface-checks.json`、`live-tour-step-*.png`、`live-compact.png`。

`live-checks.json` 保存逐项结果；`visual-checks.json` 与 `focus-*.png` 保存有内容状态的视觉验收。截图内容明确为验收素材，不是用户真实业务记录。视觉脚本同时检查错误边界回退，不能只用「pageerror 为零」判断渲染成功。

当前证据计数：37 项真实 Web 交互检查、5 项向导/轻面板检查、9 个主页面的桌面与窄屏视觉检查。图库含 24 张精选截图。验收结束后已停止临时 DSH 和测试浏览器；启动日志中的临时登录 URL 不保留，复跑需重新启动该隔离 profile 并生成新的本地日志。

### 未验证与保留边界

- 独立 profile 没有模型凭据。真实模型总结/反思、完整自动/手动跨会话接续、模型资产安装与下载没有成功验收，不标为通过。
- 没有执行生产记忆删除、真实团队同步、实际包更新或个人数据迁移。对应入口和上游逻辑保留。
- Desktop/Mica 没有实机验证；深色截图验证的是宿主主题属性驱动的 Web 皮肤。
- 上游 `/list` 与 `/note` 等仍有依赖当前全局工作区状态的行为。新文件浏览增加来源一致性检查和绝对路径绑定，但未声称修复宿主所有多窗口并发写入问题。
- 上游素材路由未消费 deep 参数；当前深色下使用 token 与降低插画亮度适配，没有修改宿主路由。
- 原全局向导和轻面板保留控制器并增加配套样式，没有把整个首次配置流程重写成截图里的四步假向导。
- `npm pack --dry-run` 成功，但现有 `files: [docs, ...]` 会把本地设计历史与压缩包一起计入，检查时约 367MB 压缩／404MB 解包。新皮肤没有新增大型位图；本轮未发布，也未擅自删除或排除用户的历史材料。发布前仍需按原交接要求单独审查包清单。

## 看效果与继续开发

先看 `artifacts/iter5-integration/focus-home-1440.png`、`focus-library-1440.png`、`focus-calendar-1440.png`、`focus-recall-1440.png`、`focus-settings-1440.png`。完整可点击图库为 `artifacts/iter5-integration/gallery.html`。

重新生成后，使用加载本仓库的 DSH web → 会话「记忆」→「开发版」进入。当前日常 profile 中的已安装包没有被替换。集成验收后按用户要求提交并创建 PR；不发布安装包。
