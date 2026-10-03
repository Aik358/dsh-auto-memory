# 交接说明 · 给 ZCode（dsh-auto-memory）

> 写于 2026-09-11 21:4x（UTC+8）· 交接方：DSH 主对话（DeepSeek Harness）
> **本文件自包含**：ZCode 看不到写这份文档的那个会话的上下文与记忆，读完这一份 + 文末「关键路径表」里的文件即可开工。
> 一句话项目：**DeepSeek Harness Web GUI 的「主动联想记忆 + 上下文管理」插件**（npm 公开包，1 万+ 下载），当前 **v2.4.2 已发布**。

---

## 0. 现在的状态（先对账，别信旧文档）

| 事项 | 值 |
| --- | --- |
| npm 包 | `@a9i5k4/dsh-auto-memory` · latest = **2.4.2**（发布包 218 files / 10.9 MB） |
| pre 线（开发） | `D:\dsh-auto-memory`，HEAD = `f83e144`（docs 收编）· 已跟踪文件**无未提交改动** |
| REL 线（发布基座） | `D:\dsh_debug\_publish_dsh-auto-memory`，HEAD = `243dee1`（= tag `v2.4.2` = GitHub main） |
| GitHub | https://github.com/Aik358/dsh-auto-memory（main = 243dee1） |
| 本机运行形态 | 插件以**符号链接**挂载：`~/.dsh/profiles/web/node_modules/@a9i5k4/dsh-auto-memory` → `D:\dsh-auto-memory` |
| 宿主 | 官方 `dsh` **0.1.5-rc.1**，Web GUI 在 `http://127.0.0.1:3080` |

**两条线是平行历史**：pre 线有 `-pre` 后缀（`lib/*-pre.js`、配置 `dsh-auto-memory-pre.json`、路由前缀 `/api/dsh-auto-memory-pre/`），`tools/release.mjs` 会在发布时把它们**裸名化**并重建 REL 树。
👉 **严禁把 pre 直接 push 到远端 main**；发布只能走下面的固定流程。

---

## 1. 代码结构（没有构建步骤）

| 文件 | 作用 | 规模 |
| --- | --- | --- |
| `lib/index.js` | **宿主半边**：记忆引擎 + 配置表 + 全部 HTTP 路由 + 工具注册 | ~8,200 行 |
| `lib/client.js` | **界面半边**：浏览器 bundle（手写 `__ModuleLoader__`，React + 原生 DOM，零依赖） | ~4,600 行 |
| `lib/*-pre.js` | 其余宿主模块（检索/水位/接续/语义/Python 侧车…），多数有对应的裸名孪生文件 | — |
| `python/` | 可选 Python 语义引擎（BGE-M3 int8）+ worker，随包发布 | — |
| `tests/smoke/*.mjs` | **69 个**冒烟套件（全量回归就是逐个 `node` 跑） | — |
| `tools/release.mjs` | 发布构建器（pre→正式转换 + 校验闸门） | — |
| `docs/` | 会被打进 npm 包（**注意**：内部文档目前也在里面） | — |

**关键结构约束**：两个半边是**独立 bundle**，`client.js` 不能 `import` 宿主模块 → 「同一份事实」只能靠**测试锁**保证（已有 `tests/smoke/smoke-test-api-paths-pre.mjs`）。

---

## 2. 怎么验证改动（发版前置门）

```powershell
cd D:\dsh-auto-memory
# 全量回归（约 2-3 分钟，必须 0 失败）
Get-ChildItem tests\smoke -File -Filter *.mjs | ForEach-Object { node $_.FullName > $null 2>&1; if ($LASTEXITCODE -ne 0) { "FAIL: " + $_.Name } }
# 语法 + 编码
node --check lib\index.js; node --check lib\client.js
# 写文件必须 UTF-8 无 BOM（用户硬性规则，BOM 会让 dsh web 起不来）
```

- **路由数（46）与工具数（14）被多个用例硬锁**；加减路由/工具必须同步改测试。
- `smoke-test-autocont-host-pre.mjs` 用「方法白名单」式夹具：给被抽方法新增 `this.xxx()` 调用要同步加进白名单，否则 TypeError 被外层 `try/catch` 吞成"没反应"。
- 单跑原则：个别套件（如 `m53`）在批量连跑时会受机器负载影响，历史上是**单跑**确认。

---

## 3. 发版固定流程（10 步，唯一检查表 `docs/internal/RELEASE-PROCESS.md`）

1. **前置门**：全量回归 0 失败 + **脏树范围核实**（`release.mjs` 的源就是工作区，**脏树会整体进包且不可回溯**）。
2. 定版本号（纯修复 patch / 有新行为 minor）。
3. **必改 `CHANGELOG.md`**：新增 `## [<ver>] — <日期> · <主题>` 小节。
4. **必同步软件内版本标识**：①应用内更新说明字典 `lib/client.js` 的 `var CHANGELOG = { '<ver>': { zh: [...], en: [...] } }` ②界面指纹行 `console.log('[dsh-auto-memory] client v<ver> fingerprint: ...')` ③`package.json.version`（由 release.mjs 自动回写开发树）。
5. pre 线提交：`git add lib tests CHANGELOG.md tools/release.mjs`（+ 视情况 docs）→ commit（身份 `Aik358 <aik358@users.noreply.github.com>`）。
6. `node tools\release.mjs <ver> --dry-run` —— 验闸门（应输出 `版本标识一致性: OK(CHANGELOG / 应用内更新说明 / 界面指纹行)`）。
7. `node tools\release.mjs <ver>` —— 真构建（写 REL 树 + 回写开发树版本）。
8. REL：`git add -A` → commit → `git tag -f v<ver>`。
9. push（**必须带 PAT 行内 URL**，见 §5）→ `npm publish`。
10. **三处复核**：registry `/latest`、`git ls-remote ... refs/heads/main`、`refs/tags/v<ver>` 三者一致。

**第 3、4 步已做成机制**：`tools/release.mjs` §5.05「版本标识一致性闸门」——三项任一不符即 `process.exit(1)` **拒绝构建**（防止"检测更新"一直拿旧版本号比对）。

---

## 4. 环境、凭据与两个坑

- **本机 `~/.npmrc` 指向 npmmirror** → 查询与发布都必须显式 `--registry=https://registry.npmjs.org`，否则会查到旧版本、误判发布失败。
- **`npm view` 会命中本地缓存**：发布成功后可能仍回读上一版（v2.4.2 发布后回读 2.4.1）。判定用权威接口：
  `Invoke-RestMethod 'https://registry.npmjs.org/@a9i5k4%2Fdsh-auto-memory/latest' | Select-Object -ExpandProperty version`
- **凭据不在本仓库**：GitHub PAT 与 npm token 存在另一个工作区的记忆文件里 ——
  `~/.dsh/memory/workspaces/--D--dsh_debug--/MEMORY.md`（该文件明确标注"只存本地，**严禁写入任何会上传 GitHub/npm 的文件**"）。
  npm 发布需带 bypass-2FA 的那个 token；推送用 `git -c credential.helper= push https://x-access-token:<PAT>@github.com/Aik358/dsh-auto-memory.git main --tags --force`。
- **发布后生效**：宿主半边（`lib/index.js`）改动需**用户自己重启 dsh web**；界面半边刷新页面即可。

---

## 5. 不可碰的契约 & 用户硬性规则

- **后端冻结（用户明确要求，大排期期间生效）**：记忆引擎逻辑、**46 条路由**契约、**85 个配置键**语义与默认值、prompt 层、Python worker、14 个工具名 —— 改外观/文档时**一律不动**。
- **未经明确同意，严禁停止/重启 dsh web 宿主进程**（会截断工具调用）；host 改完只改文件并提示用户重启。
- **未经明确要求，不要 `npm publish` / push GitHub / 打 tag**。
- **写任何文件严禁 BOM**（保持 UTF-8 无 BOM；写完可用前三字节校验）。
- 界面文案与文档的**文风**遵循 `docs/PROMO-STYLE-GUIDE.md`（产品拟人称"她"、厂商腔黑名单、母比喻=一本书）。

---

## 6. 下一版要做的三件事（已记录，未开工）

完整清单（含行号、改法、验收）在 **`docs/internal/NEXT-VERSION-TODO.md`**。摘要：

1. **水位判据口径**：现在触发用的是「可用额度」分母 `effectiveWin = win − reserve`（`lib/index.js:1900`，本机 1,048,576 − 384,000 = 664,576），导致**上下文刚过半就触发接续**，比官方压缩点（≈80% ≈ 83.9 万）**早约 45%**，用户判定太浪费。
   **改法**：正常触发线改用官方声明窗口为分母（或 `min(win, hardWin)`），阈值 0.75–0.78；`reserve` **不再参与分母**，只保留"距硬墙余量"展示 + 硬判据（`estTokens + reserve > win` 才硬触发）。补反向锁：断言"不得把 reserve 计入分母"。
2. **接续序号**：`contSeq = handoff 目录里 prev-session-*.md 文件数 + 1`（`lib/index.js:2646-2648`），在落盘失败 / 跨工作区（handoffDir 按工作区解析）/ carry 复用缓存时会**不递增、重复或为空**（为空即不 rename → 标题退回自动生成，用户已两次观察到"新窗口序号不对"）。
   **改法**：改**持久计数器** `handoff/cont-seq.json`（键 = workspaceId），缺失时从现有 `接续 #N` 标题/包名解析最大值 +1 兼容老数据；序号分配与包落盘做成同序事务；三条入口（面板一键 / 宿主兜底 / 重启后）全覆盖。
3. **固定流程外包给子代理**（用户提出的想法）：发版这类已固化的流程**不由主对话逐步执行**（主对话上下文最贵）→ 交给子代理（思考强度不必高），它做完/出错后只回结构化结论，主对话只做三件事：开闸前确认前置门 / 放行或中止 / 失败时处置。
   落地物：`docs/prompts/RELEASE-AGENT.md`（自包含任务书）+ `RELEASE-PROCESS.md` 顶部「角色分工」段 + 同类流程（全量回归 / 双语对账 / 痕迹巡检）各配任务书。回报格式 `{ ok, version, pre_sha, rel_sha, tag, npm_latest, failed_step, error_tail }`。

> 现状补充：**v2.4.2 已把 `autoContinueEnabled` 出厂默认改为 `false`**（并加反向锁 `smoke-test-autocont-host-pre.mjs` 断言默认必须为 false）。用户本机也已关闭。所以上述 ① 是"改好再考虑翻回默认开"的前置。

---

## 7. 待开工的大排期（界面 × 文档 × 首页）

用户已拍板方向，**设计优先、功能说明最后核对**，**后端冻结**：

- 排期与现状硬数据：`docs/internal/DESIGN-OVERHAUL-PRE-RESEARCH.md`（含诊断、P0-P6 排期、5 条验收判据、6 个待用户拍板点）
- 美术方向与动效规格：`docs/internal/ART-DIRECTION-WIREFRAME.md`（线框稿 + EVA 式克制线描色板 + 线宽四档 + 工程图元素 + **24fps 动效时序表** + 性能预算 + **可直接转发给 Astra 的交付契约**）
- 三条线：①界面与设置页大改（12 页签塞进 440×560 浮层 = 容器错配；DSH 有 ~58 个原生插槽可用，`slots.inject/register` 是通用 API，挂原生位**不需要改后端**）②README/用户说明书/项目文档大改 ③`docs/landing/index.html` 首页大改（现为 1,745 行自包含单文件，靠 `preview` 分支 + `htmlpreview` 第三方代理发布；无 `.github/`、无 Pages）
- 设计主张：面板向 **DSH 原生 `--dsw-*` 令牌**靠（DSH 自己的 UI 包是打包后 CSS Modules，类名私有**不可复用**，只有公开 CSS 变量 + 插槽位可用）；首页保留现代主义品牌色（暖纸 `#F4F1EB` / 墨 `#17171A` / 信号橙 `#E9470C`）。
- 角色动画（24 帧逐帧）**交给 Astra**：`ART-DIRECTION-WIREFRAME.md` §5 是完整交付契约（画布 1200×1200@1x、锚点 `(600,1080)`、PNG-24 + alpha、命名 `hero_0000.png`、分层导出、7 条验收）。

---

## 8. 血泪坑清单（照着躲）

1. **脏树进包**：`release.mjs` 的 DEV 源就是 `D:\dsh-auto-memory` 工作区 —— 发版前必须核实 `git status` 范围（本机曾两次发现工作区混有其他会话的未发布改动）。
2. **两半边独立 bundle**：`client.js` 是手写 `__ModuleLoader__`，不能用相对 `import`；跨半边一致性只能靠测试锁。
3. **同一文件一次消息发两个 edit 会丢前者**（实测过）→ 同文件改动串行，或写「替换清单 JSON + 计数断言脚本」一次做（不符即整体不写盘）。
4. **`edit` 工具会被全角引号/缩进差异绊住** → 大文件批量改推荐脚本 + 动态识别缩进（别写死空格数）。
5. **JS 正则不支持 `(?m)` 内联标志**（要用 `/.../m`；写进测试会直接 SyntaxError）。
6. **水位/接续相关**：判据优先级 = provider 错误文本 > 官方 `request/context.contextWindow` > 本地 tokenMeter > 启发式估算；本地估算在"中文+代码+大工具输出"会话里**偏乐观约 2×**。撞墙报错原文含 `CONTEXT_WINDOW_EXCEEDED`，是本机校准的唯一权威来源。
7. **接续有两条路径且行为不同**：宿主 `hostAutoContinue()`（无刷新仪式）与面板 `runContinueFlow()`（注入刷新仪式）。改任一侧要同步评估另一侧。排查"接续没反应"先看 `~/.dsh/dsh-auto-memory-pre-diagnose.log`。
8. **`docs/` 会被打进 npm 包**，而 README/USER-GUIDE 的图片走相对路径 `docs/screenshots/…` → 想收窄 `files` 必须**分层**（保留 screenshots + 论文 + 架构图），不能整目录删。
9. **`npm view` 命中本地缓存** + **本机 .npmrc 是 npmmirror**（见 §4）。
10. **凭据只走行内 URL / 环境变量**，绝不写进任何会上传 GitHub 或 npm 的文件。

---

## 9. 建议 ZCode 的第一件事

```powershell
cd D:\dsh-auto-memory
git log --oneline -5                 # 确认在 pre 线
git status --short                   # 确认没有别人的未提交改动
Get-ChildItem tests\smoke -File -Filter *.mjs | ForEach-Object { node $_.FullName > $null 2>&1; if ($LASTEXITCODE -ne 0) { "FAIL: " + $_.Name } }   # 回归基线
```
然后二选一：**A. 深改**（照 `docs/internal/NEXT-VERSION-TODO.md` 从改点 ① 开始）或 **B. 大排期**（照 `docs/internal/DESIGN-OVERHAUL-PRE-RESEARCH.md`，但需先向用户取三样：官方 DSH 网页 URL/截图、角色基准图、风格探针许可）。

**别做**：不要 `npm publish`/push/tag（除非用户明确要求）；不要重启 dsh web；不要改 §5 冻结清单里的任何契约。

---

## 10. 关键路径表

| 路径 | 用途 |
| --- | --- |
| `docs/internal/RELEASE-PROCESS.md` | 发版 10 步唯一检查表（含凭据纪律、npm 缓存坑） |
| `docs/internal/NEXT-VERSION-TODO.md` | 下一版三点待改（水位口径 / 接续序号 / 流程外包）+ 验收 |
| `docs/internal/DESIGN-OVERHAUL-PRE-RESEARCH.md` | 界面×文档×首页大排期预研（诊断 + P0-P6 + 判据） |
| `docs/internal/ART-DIRECTION-WIREFRAME.md` | 美术方向 + 24fps 规格 + Astra 交付契约 |
| `docs/PROMO-STYLE-GUIDE.md` | 文风守则（README/landing/公告必须遵循） |
| `docs/UI-INVENTORY-RAW.md` | 界面逐条盘点（12 页签 / 85 键 / 46 端点，带行号） |
| `docs/USER-GUIDE.{en,zh-CN}.md` · `README{,.zh-CN}.md` | 面向用户的四份文档（待大改） |
| `docs/landing/index.html` | 首页（单文件、双语） |
| `tools/release.mjs` | 发布构建器 + 版本标识闸门（§5.05） |
| `tests/smoke/smoke-test-api-paths-pre.mjs` | 路径表一致性锁（客户端 ⊆ 宿主） |
| `~/.dsh/dsh-auto-memory-pre-diagnose.log` | 插件诊断日志（接续/水位/降级线索都在这） |
| `~/.dsh/dsh-auto-memory-pre.json` | **pre 线**实际配置文件（别读成非 `-pre` 的那个） |
