# 待办总表 · dsh-auto-memory（2026-09-13 汇总）

> 用途：**唯一待办入口**。跨会话/跨工具（DSH、ZCode）通用 —— 不依赖任何一方的工作记忆，全部写路径与判据。
> 状态约定：🔴 阻塞或高优先 / 🟡 应做但可排期 / ⚪ 可选或长期 / ✅ 已关闭（留在 §J 备查，别重复劳动）
> 事实基线（2026-09-13 二次发版后实测）：npm latest = **2.5.1**；pre 线 `D:\dsh-auto-memory` HEAD = `7fdb960`；REL = tag `v2.5.1` = GitHub main = `c9ecc9f`（v2.5.0 → 7234627 → v2.5.1 → c9ecc9f 同日两连发，均子代理执行、主对话独立复核）。

---

## 0. 一分钟看板

| 优先级 | 事项 | 归属 | 参考 |
| --- | --- | --- | --- |
| 🔴 | 大排期三件套（界面 / 文档 / 首页）**等用户拍板 6 点 + 给 3 样输入** | 用户 → 执行方 | `DESIGN-OVERHAUL-PRE-RESEARCH.md` §8 |
| ⚪ | **SCF 云函数重部署**（新 `index.zip` 已重打：含 `?report=N` 路由 + 标记 `20260913d`；等用户控制台上传后 `?diag=1` 核对） | 用户 | 本表 §G |
| 🟡 | **procedure 记忆机制整体重构**（沿用 Hermes、社区褒贬不一；issue #30 实证同根因；等用户统一拍板整体逻辑，期间不动引擎） | 用户 → 执行方 | 本表 §A 末条 |
| 🟡 | 群反馈·日报 CI 的**安全与运维**收口（密钥/签名/成本/告警） | ZCode | `.github/`、`docs/internal/GROUP-*.md` |
| 🟡 | 冷启动闭环（公开用户"装上没反应"） | 执行方 | 本表 §C |
| 🟡 | 分发瘦身 + 对外元数据（npm 包 11 MB 里 86% 是 docs） | 执行方 | 本表 §D |
| ⚪ | 界面技术债（令牌层/组件层/i18n）——属大排期主体 | 执行方 | `DESIGN-OVERHAUL-PRE-RESEARCH.md` §2.6 |

---

## A. 阻塞在用户决策上（不点头无法开工）

- [ ] 🔴 **大排期的 6 个拍板点**（`docs/internal/DESIGN-OVERHAUL-PRE-RESEARCH.md` §8）：①首页托管（htmlpreview vs GitHub Pages）②设计主张（面板靠 DSH 原生 / 首页留品牌色，接受"两种语境"？）③浮层面板是否降级为"状态+快捷入口"④`associativeMemoryEnabled` 是否改出厂默认（**建议保持 false + 向导明说并一键开启**）⑤docs 是否分层出包 ⑥排期节奏（P0-P6 顺序 vs 先集中做界面）。
- [ ] 🔴 **大排期开工需要的 3 样输入**（`docs/internal/ART-DIRECTION-WIREFRAME.md` §8）：①官方 DSH 网页的 URL/截图（全网只搜到第三方介绍文）②角色基准（默认用 `docs/banner.jpg` 的水彩版做线稿化，或用户另给设定图）③风格探针许可（需用户在 Ark9 生图面板点批准）。
- [ ] 🟡 **是否解除 `docs/PROJECT-FREEZE-AND-ROADMAP.md:8`「大版本完成前禁止改 README」**的冻结（本次排期就是那个大版本）。
- [ ] 🟡 **procedure 记忆机制整体逻辑重构（等用户统一拍板，期间不动引擎）**：现状 = 插件的 procedure store（`lib/procedure-store-pre.js`：observed→candidate→validated→active 晋升状态机、M6 六级渐进激活、`renderChecklist` 渲染进动态快照）整体沿用 **Hermes 的记忆方式**；而 Hermes 的记忆工具在社区里**褒贬不一**，用户对这套机制整体不满，届时**统一重构整体逻辑**，不做零敲碎打。审计补充（2026-09-13）：①数据层从未产出过任何 active procedure（全机 7 个工作区均无 `procedures.json`）②`renderChecklist` 语义是"主对话自己照步骤执行"，无"执行类流程派子代理"出口 ③`memory_recall` 无 procedures scope（只能被动注入）。此前提议的两个小改点（delegate 出口 + procedures scope）**并入**这次统一重构，不单独做。过渡期执行类流程的固化走**仓库任务书通道**（`docs/prompts/*-AGENT.md` + 角色分工，主对话派子代理）。用户更详细的不满与改进建议见 **QQ 群反馈与 GitHub issues**（发版后的反馈核查任务要专门检索 procedure/技能/记忆/skill 相关条目）。

---

## B. 下一版代码改动（3 项，均已定位到行，详见 `docs/internal/NEXT-VERSION-TODO.md`）

> **✅ 2026-09-13 状态：三项已全部落地并随 v2.5.0 发布**（pre `18807ee` / REL+tag+main `7234627` / npm latest 2.5.0，子代理执行、三处复核一致）。全量回归 70/70 绿；细节与验收见 `NEXT-VERSION-TODO.md` 顶部状态行与 §J 存档。以下原文保留备查（文中行号为落地前观测值）。

- [ ] 🔴 **水位判据口径**：现触发用 `effectiveWin = win − reserve` 当分母（`lib/index.js:1900`，本机 1,048,576 − 384,000 = 664,576）→ 上下文**刚过半就触发接续**，比官方压缩点（≈80% ≈ 83.9 万）早约 45%。
  **改法**：正常触发线改用官方声明窗口（或 `min(win, hardWin)`）为分母，阈值 0.75–0.78；`reserve` 只留"距硬墙余量"展示 + 硬判据（`estTokens + reserve > win` 才硬触发）。**加反向锁**：断言"不得把 reserve 计入分母"。
  验收：阈值 0.75 时触发点 ≈ 78.6 万（而非 ≈46 万）；`water-window` / `water-hard-trigger` / `autocont-host` / `water-step` 全绿。
- [ ] 🔴 **接续序号**：`contSeq = handoff 目录里 prev-session-*.md 文件数 + 1`（`lib/index.js:2646-2648`）→ 落盘失败 / 跨工作区 / carry 复用缓存时会**不递增、重复或为空**（为空即不 rename，标题退回自动生成）。
  **改法**：持久计数器 `handoff/cont-seq.json`（键 = workspaceId），缺失时从现有 `接续 #N` 标题/包名解析最大值 +1 兼容老数据；序号分配与包落盘同序事务；三条入口（面板一键 / 宿主兜底 / 重启后）全覆盖。
  验收：连做 3 次接续得到 `#N → #N+1 → #N+2`，跨工作区不重复；新增 smoke 覆盖计数器持久化与"落盘失败不跳号"。
- [ ] 🟡 **固定流程外包给子代理**：主对话只做三件事（开闸前确认前置门 / 放行或中止 / 失败时处置），子代理按检查表全跑、出错即停、回报 `{ ok, version, pre_sha, rel_sha, tag, npm_latest, failed_step, error_tail }`。
  落地物：①`docs/prompts/RELEASE-AGENT.md`（自包含任务书，**尚未创建**）②`docs/internal/RELEASE-PROCESS.md` 顶部加「角色分工」段 ③同类流程（全量回归 / 双语对账 / 痕迹巡检）各配任务书。
  已知约束：当前工具面**不能给 subagent 指定思考强度**（`subagent` 只收 description/prompt/run_in_background；`workflow.agent()` 显式拒绝 effort）→ 要压到 low/off 得靠 DSH 侧配路由默认强度，或由插件自身 spawn（插件已有 `subagentReasoningEffort: off|low|high|max`）。

---

## C. 冷启动与上手（公开用户"装上没反应"的根治）

来自冷启动审计（`docs/internal/DESIGN-OVERHAUL-PRE-RESEARCH.md` §2.5）。**除最后一条外均未修**：

- [ ] 🔴 **首启向导无兜底触发**：只有 `update-check` 成功返回 `current` 才分发首启弹窗（`lib/client.js:4439`）→ **断网/代理环境下零引导零提示**。改法：请求失败/超时也用本地条件（版本号或 localStorage）照常 dispatch；清掉死键 `firstRunDone`（只读无写）。
- [ ] 🔴 **卖点功能与向导显示不一致**：`associativeMemoryEnabled` 出厂 `false`（`lib/index.js:349`），而向导把它渲染成「推荐 + 默认开」（`lib/client.js:3229/3303` 用 `tg.def !== false` 显示 ON）→ 用户不点 = 看到 ON 实际 OFF（幻觉 ON）。
  改法（不动后端默认值）：向导如实显示"出厂关，这里帮你打开"，点击即写入；同时修 `client.js:163` 与代码矛盾的"默认关"提示。
- [ ] 🟡 **引擎步自动下 129MB 且失败无重试**：进入引擎步即 `semanticDownload start`（`client.js:3168-3175`），失败态（`:3287`）只有报错没有重试按钮（`:3425-3439` 无重试分支）。改法：改为"点『安装』才下载"+ 加重试按钮（复用设置页 `semActionRetry` 同源逻辑）。
- [ ] 🟡 **`welcomeTourEnabled` 是死键**：host 从不读（`lib/index.js:317` 仅定义），所以设置里关掉也拦不住首启自动播放。改法：host 读该键并下发，client 在 `dispatchStartupDialog` 的 freshInstall 分支加门闸。
- [ ] 🟡 **术语改写 Top5**（走客户端 i18n，中英同步）：水位 → 上下文余量；接续 → 换窗口续做；锚定 → 记忆索引；白板 PLAN/账本 → 项目看板/交接记录；唤起·固化·晋升 → 想起来/记下来/变成技能。
- [ ] ⚪ **装完给一句"她在工作"的反馈**：现在唯一信号是侧栏多了个「记忆」按钮；自动沉淀有 240 字符门槛，头几句闲聊会被跳过且无任何提示。

---

## D. 分发与门面（npm / GitHub 对外）

- [ ] 🟡 **npm 包瘦身**：`files` 含整个 `docs`（同日实测 **11.0 MB / 167 文件**，其中 `docs/screenshots` 约占 7.9 MB、内部工程文档 101/106 个 md）。改法：`docs/internal/**` 与 `docs/prompts/**` 移出包；**必须保留** `docs/screenshots/**` + 3 篇论文 + `system-map.html`（README/USER-GUIDE 的图片走相对路径，整目录删会让 npm 页图全断）。
- [ ] 🟡 **`package.json` 对外字段**：缺 `homepage`（README 现在挂的是 htmlpreview 伪首页）、缺 `scripts`（无 `test` 入口，陌生人无法一条命令验证）、缺 `engines`（Node 版本无约束）；`description` 331 字符被 npm 截到 255（中文段全丢）。
- [ ] 🟡 **首页托管**：`docs/landing/index.html`（1,745 行自包含单文件）目前只在 `preview` 分支，靠第三方 `htmlpreview.github.io` 代理渲染（README.md:9）→ 单点依赖。建议改 GitHub Pages（`.github/workflows/` 现在已存在，可加 `pages.yml`）或至少加 `gh-pages` 分支。
- [ ] ⚪ **.github 门面件**：`issue 模板 / CONTRIBUTING / SECURITY / CODE_OF_CONDUCT` 仍缺（`.github/` 目前只有 CI 与云函数）。已有真实外部贡献（PR #12、Issue #10），却无模板与指南。
- [ ] ⚪ **`CHANGELOG.md` 不在 tarball 里**，而 README 末尾链接指向它 → npm 视图是死链。二选一：把 CHANGELOG 加进 `files`，或改链接。

---

## E. 文档体系

- [ ] 🟡 **README 大改**（490 行 / 说明书式内容占 30%）：落地 `docs/NEXT-MAJOR-README-DRAFT.zh.md` 前必须先修 —— 它沿用「十个页签」旧错（实为 12）、含违反 `PROMO-STYLE-GUIDE.md:70` 的句式、`memory_search` 工具名不存在（实为 `memory_recall`）、安装位置反而更靠后。目标 ≤120 行五段式。
- [ ] 🟡 **USER-GUIDE 改任务导向**（现各 382 行、页面导向、61 个配置键）：目标 ≤260 行；删 `-pre` 期命名泄漏与不可用命令（`node tools/subagent-gc.mjs` —— `tools/` 根本没打包）。
- [ ] 🟡 **6 处事实性错误**：①handoff「默认开启」写 4 处（实为 false）②「Ten tabs」实为 12 ③`memory_search` 实为 `memory_recall` ④`README.md:294` 的 `/n/n` ⑤英文 README 的 H1 是中文 ⑥配置路径写成非 `-pre` 名（`dsh-auto-memory.json` vs 实际 `dsh-auto-memory-pre.json`）。
- [ ] 🟡 **双语对账脚本**（`tools/check-readme-parity.mjs`）：锁标题序列 + 命令块 + 关键数字（0GB/130MB/563MB、0.75/0.80、8000/200000）逐字符一致 —— 现在只靠人工纪律，已漏过。
- [ ] ⚪ **27 张配图重拍**（22 张界面图 + 7 张六幕宣传图，旧 29 张中部分已不再被引用）：必须在 UI 定稿后做，顺序为"UI 冻结 → 重拍 → 改文"。

---

## F. 界面技术债（= 大排期主体，量化见预研 §2.6）

- [ ] 🔴 **令牌层**：硬编码颜色 **320 处 / 132 种**；圆角 **25 种**、padding **47 种**、gap 14 种、字号 19 种、阴影 20 种、毛玻璃 **8 套配方**；同一个 `--dam-accent` 有 **5 个不同 fallback**；**3 个幽灵令牌**（`--dsw-alias-text-primary` / `-warn` / `-danger` 上游根本不存在，9 处永久走 fallback）。
  目标：颜色/边框 **100% 走 `--dsw-*`**；自建 `--dam-*` 度量令牌（间距 4/8/12/16/24、圆角 4/8/12、字号 11/12/13/15/18）；向导美术隔离到 `--dam-tour-*`。
- [ ] 🔴 **组件层**：内联 style **228 个** vs `className` **4 处**；**6 套卡片**、4 种"表格"宽度、4 种标题写法、4 套浮层、2 套页签并存。目标：抽 `Card / Row / Field / Badge / Tabs / Modal / Toolbar` 七个原语。
- [ ] 🟡 **巨型函数**：`SettingsPage` **582 行**（8 分组+目录浏览器+模型抽屉+环境检测+向导挂载+更新检查+调试中心）、`DialogHost` **478 行**（7 种弹窗+首启向导状态机）。
- [ ] 🟡 **状态与可访问性**：`:focus` / `:focus-visible` **各 0 条**；`aria-*` 仅 9 个、`tabIndex` 0；危险操作 `window.confirm` **0 次**（`StorageTab` 删除是**单击即删**）。
- [ ] 🟡 **i18n 双机制**：`I18N` 字典 + **约 354 处内联 `locale === 'zh' ? … : …`**；`t()` 的兜底是中文 → 英文 UI 必然中英混杂。
- [ ] ⚪ **幽灵配置键 `pythonGpu`**：`lib/client.js` 会写、`lib/index.js` **零引用**（宿主从不读）→ 删客户端那一处即可。
- [ ] 🟡 **IA 重排**：12 个页签塞进 **440×560 浮层**（拖到 300px 时表单控件只剩 ~48px）。DSH 有约 58 个原生插槽可用（`sidebar.panellist` / `sidebar.right.tab.document` / `conversation.session.header.utilities` …），`slots.inject/register` 是通用 API —— **挂原生位不需要改后端**。开工第一步：向 `sidebar.panellist` 注册一个空面板做 spike，失败则回退为"保留浮层但按三组重排"。

---

## G. 群反馈 / 日报 CI（2026-09-12~13 新建，ZCode 线）

**已有资产**：`.github/cloud/qq-webhook/`（腾讯 SCF 云函数：`index.js` / `index.zip` / `scf_bootstrap`）、`.github/scripts/{group-digest,group-listener,qq-capture-openid,qq-send,report-sync}.mjs`、`.github/workflows/{group-digest,group-report-status}.yml`、`.github/digest/{NOTES,PREVIEW}.md`、说明文档 `docs/internal/GROUP-{LISTENER,DIGEST,WEBHOOK}-SETUP.md`；插件侧新增按需报告端点 `?report=N`（`9461cea`）。

- [ ] 🟡 **安全面收口（待确认）**：webhook 公网入口是否校验签名/时间戳与来源白名单？是否限流防重放？密钥是否只存 GitHub Secrets / SCF 环境变量（**绝不入库**）？
- [ ] 🟡 **运维面（待确认）**：定时班时区与失败告警（现在 11:40/20:40 + 55 分兜底重试）；SCF 免费额度/成本；`index.zip` 这类二进制是否应入库（建议改为构建产物，不入 git）。
- [ ] ⚪ **文档化**：把三份 `GROUP-*-SETUP.md` 合并成一份"从零部署"清单（含所需 secrets 名、验证命令、回滚方式）。
- [ ] ⚪ **与插件的关系**：`.github/**` 不在 npm `files` 里（不会随包发布）—— 保持这样；若日报内容要面向用户，走 `docs/` 或 landing，不要塞进包。
- [ ] 🟡 **SCF 云函数部署滞后（2026-09-13 实测）**：仓库源码 `9461cea` 已有 `?report=N` 按需报告路由，线上 zip（版本标记 `20260913c`）没有——`?report=12` 只回 `{"v":...}`。需重新打包部署（`index.zip` 重构建 + SCF 控制台上传）。部署前 gist 直读可用替代：用 `--D--dsh_debug--` 记忆里的 fine-grained PAT（只走 shell 变量，不落盘不回显）GET `api.github.com/gists/fb17c49dab6c295346c96ac971727095` 取 `group-raw-debug.txt` 原文。

---

## H. 插件功能侧遗留

- [ ] 🟡 **issue #30（open）= procedure 管线断裂社区实证**：与 §A 末条（procedure 统一重构）同根因，挂在重构下处置；Aik358 已回复「将在发布新版本时通知」——重构发版后需回来通知该用户。
- [ ] 🟡 **工作区切换问题（叉叉基，群反馈）——已修复待发版（2.5.2）**：诊断报告 2026-09-13 回传判 C 类；根因=①`handoffPanelData` 面板路径全局单值（sessionId 只喂水位）②`resolvePaths` 无人值守锁**全局**钉死 state.ws（`unattendedMode=true` 用户切工作区整个冻结）③workspaceId 创建的会话 header.cwd 缺失误回退 process.cwd()。修复：无人值守锁改按会话（rt.wsLocked）+ 面板按 sessionId 解析（新增 `resolvePathsForSession`+`sessionWorkspaceFallback`，registry→持久化头两级回退）+ 未绑定诚实返回 wsBound:false + 面板配置加载守卫。验证=`smoke-test-wsfix-pre.mjs` 16 断言双实例对照，全量 71 套件 0 失败。

- [ ] ⚪ **子代理通知无法跨会话继承**：durable 侧 `SessionHeader.parentSession` 是 readonly，`coldResume → authorizeLineage` 抛 UNAUTHORIZED，服务契约无 re-parent/transfer/attach → 新会话**收不到旧会话的子代理完成通知**。可选路线见 `docs/internal/SUBAGENT-REPORT-ROUTING-PRE-RESEARCH.md`。
- [ ] ⚪ **上下文桥不推子代理会话的 context**：被观测的子代理会话 runtime 从未 `capturePaths`（整段 drop）；本机已做 30s 窗口限流 + 首条附 runtime key，**工作区归属改造未做**。
- [ ] ⚪ **两个"界面零引用"端点不可删**：`/activation-inbox-pre`（契约测试 + 注入入口）、`/subagent-gc`（CLI `tools/subagent-gc.mjs`）—— 已有白名单锁守着，新增宿主独有端点必须更新白名单并注明消费者。

---

## I. 长期纪律（违反会直接出事故）

- **发布必须获用户明确授权**；未经要求不 `npm publish` / push / 打 tag。
- **不重启 dsh web 宿主**（会截断用户会话）；host 改完只改文件 + 提示用户重启。
- **写任何文件禁 BOM**（BOM 会让 dsh web 起不来，历史事故）。
- **`release.mjs` 的源就是工作区**：脏树整体进包且不可回溯 → 发版前核实 `git status` 范围 + 全量回归（`tests/smoke` 69 套件）。
- **凭据只走行内 URL / 环境变量**，绝不写进任何会上传 GitHub 或 npm 的文件（凭据位置见 `RELEASE-PROCESS.md`）。
- **发版 10 步唯一检查表**：`docs/internal/RELEASE-PROCESS.md`；其中「改 CHANGELOG + 同步软件内版本标识」由 `tools/release.mjs` §5.05 闸门强制。
- **npm 相关两个坑**：本机 `.npmrc` 是 npmmirror（查询/发布必须显式 `--registry=https://registry.npmjs.org`）；`npm view` 命中本地缓存（判定用 registry `/latest` 或 `--prefer-update`/`--prefer-online`）。

---

## J. ✅ 已关闭（存档，别重复劳动）

- ✅ **55 份未入 git 的 docs 已收编**（`f83e144`）—— 此前"npm tarball 是唯一副本"的数据丢失风险解除。
- ✅ **`.github/` 从不存在到就位**（2026-09-12~13 建起 CI + 云函数）。
- ✅ **v2.4.1 / v2.4.2 已发布**，三处一致（npm latest = 2.4.2 / main = tag = `243dee1`）。
- ✅ **`autoContinueEnabled` 出厂默认改 `false` + 反向锁**（v2.4.2；用户本机也已关）。
- ✅ **界面路径表一致性锁**（`tests/smoke/smoke-test-api-paths-pre.mjs`：客户端 ⊆ 宿主、表外零裸字面量）。
- ✅ **发版版本标识闸门**（`release.mjs` §5.05：缺 CHANGELOG 小节 / 应用内更新说明条目 / 界面指纹行即拒绝构建）。
- ✅ **第 0 步止血**：写配置 4 条路径 → `saveConfigPatch()`；10 处重复的语义刷新 → `refreshSem()`。
- ✅ **`smoke-test-m53-pre.mjs` 顺序敏感 flake**（固定 `sleep(900)` → 有界轮询）。
- ✅ **真实自动接续实机验证通过**（修复后首次 `auto-continue host-executed`）。
- ✅ **B 区三项深改落地 v2.5.0**（2026-09-13，未发版）：①水位口径——分母改官方声明窗口（`min(win, hardWin)`），reserve 退出分母只留"距硬墙余量"展示与预测性硬墙判据（`estTokens + reserve > 判定窗`），反向锁断言"不得把 reserve 计入分母"；②接续序号——`~/.dsh/memory/cont-seq.json` 持久计数器（全局单调、跨工作区不重号、写包失败回滚不跳号、历史标题扫描兜底），新增 `smoke-test-contseq-pre.mjs`（20 断言）；③流程外包——四份自包含任务书（`docs/prompts/{RELEASE,REGRESSION,DOCS-AUDIT,TRACE-PATROL}-AGENT.md`）+ `RELEASE-PROCESS.md` 角色分工（主对话派活后只读等待）。全量回归 70 套件 0 失败。
- ✅ **v2.5.0 / v2.5.1 同日两连发**（2026-09-13）：均按 RELEASE-AGENT 任务书派阻塞式子代理执行、主对话独立复核三处一致；2.5.0 = 三改点上线；2.5.1 = **PR #29 已合并（squash `f2efefa`，社区贡献者 fei009009）+ pre 线移植**（`decodeZstdFramesHead` + 巡检调用点 + `waterWindowForSession` 同防，G13 套件 + water-hard 反向锁），PR 已回复。任务书新增教训两条：构建后 `package.json` 补提交步骤（阶段 4）；REL 提交排除 `index.zip`。
