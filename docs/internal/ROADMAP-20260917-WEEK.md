# 明日 → 周末作战图（2026-09-17 ~ 09-20）

> **来源**：用户 2026-09-17 00:5x 口述的本周计划；01:3x 用户裁定「先把 PR 全 merge、issue 读完做好回应就关掉」。
> **纪律**：本文件是这批工作的**唯一排期依据**；与旧规划冲突时以本文件为准。
> **前置**：送审批已完工（回归 PASS 105/0/0）；**远端 7 个 PR 已全部 merge、9 个 issue 已全部回应并关闭**（见 §6）。
> **注意**：远端 merge 属**礼节性**——本机 pre 线不受其影响；上传时以本机版本强制覆盖。pre 线纪律（§4.4）不变。

---

## 0. 用户已定夺的事项（不再讨论）

| # | 事项 | 裁定 |
|---|---|---|
| 1 | **PR #37**（自动接续 idle 门） | ❌ **不做**。用户原话：「就先不做了，反正冲突了，就按我自己做的新的做，没问题就行」⇒ 保留 pre 线现有 `sessionController.cancel()` 方案（2026-09-14 裁定），**冻结**，不再评估 PR 方案 |
| 2 | 记忆窗格位置 | 挪到看板上集成，**旧位置（左下角）与新看板可共存**，设置里可调位置（**类比 literature 插件的理念**） |
| 3 | 看板定位 | 看板**只是其中一项功能**，不是全部（当前看板=白板，需升级为"集成容器"） |

---

## 1. UI 重构 + 看板重构（主任务）

### 1.1 背景与痛点
- **左下角位置太紧张**：记忆按钮 + 浮层 + 欢迎卡 + 更新卡都在争左下角（`client.js` 里
  `overlay = { position:'fixed', left:'10px', bottom:'64px' }` 一类的堆叠）。
- 用户思路：**把记忆窗格挪到看板上集成**，看板升级为"承载面"，只把看板当其中一个功能。

### 1.2 可复用资产（已建成的）
| 资产 | 位置 | 用途 |
|---|---|---|
| 整页看板 + 矩阵视图（双承载面） | `lib/client.js`（`KanbanView`/`KanbanBoard`）+ `lib/wb-sidecar-pre.js`（`buildKanbanMatrixPre`） | 新承载面的**现成宿主** |
| `conversation.view` 槽位注册 | `client.js`：`slots.register({ name:'conversation.view', id:'auto-memory-pre-kanban', order:80 })` | 上栏承载面已通 |
| `sidebar.right.pane.tab` | 侧边面板承载面 | 另一承载面 |
| portal 浮层配方 | `kxPortal()` + `createPortal(node, document.body)` | 浮层定位正解（见记忆：三阶段教训） |
| CSS 令牌权威清单 | 见项目笔记（label-*/bg-layer-*/border-l*/state-*） | **禁止凭印象拼令牌** |

### 1.3 literature 插件的"理念"具体指什么（**待用户确认细节**）
用户说"这类似于 Literature 插件的理念"。**已查：`~/.dsh/profiles/web/node_modules` 下
未找到 `dsh-literature`**（可能装在别处或未装本机）。
⇒ **需用户澄清**：是指 (a) **同一功能多处可挂载**（用户自选承载面），还是
(b) **设置内切换"功能归属面板"**，还是 (c) 别的？
> 若指 (a)：实现=每个功能注册成一个"可挂载组件"，设置里选挂载点（左下浮层/侧边栏/看板 Tab），
> 默认值保持现状（向后兼容），改动即时回显。

### 1.4 建议的实施顺序（待用户拍板）
1. **先定架构**：功能清单 → 每个功能的"可挂载"改造点 → 位置配置键设计
2. 看板升级为容器（Tab / 分区），把记忆窗格作为其中一个功能页
3. 位置设置项 + 即时回显（用户硬规则：开关类改动必须即时回显）
4. 旧位置保留为可选项（共存，非替换）
5. 回归 + 变异演示 + 看板回写

---

## 2. 项目主页 HTML 重做（次任务）

| 项 | 状态 |
|---|---|
| 风格/设计 | ✅ **已写好**（用户原话：「那个已经把风格等都写好了」） |
| **README / 手册文案** | ✅ **本轮完工**（见 §2.2） |
| 排版（主页 HTML） | ⬜ **待开工**（用户原话：「就差开始做排版」） |
| 图片 / 截图 | ⏸ **用户指示等前端重构完成后再改** |
| 细节定夺 | ⬜ **待用户逐项定夺** |

### 2.1 「一两周前写的主页风格 Markdown 文档」已定位 ✅

用户 01:2x 补充的指令已执行，文件系统里找到**三份**同族文档（`docs/` 根，时间戳 2026-09-06 02:1x–02:3x，即**11 天前**）：

| 文档 | 大小 | 作用（据其自述） |
|---|---|---|
| **`docs/NEXT-MAJOR-README-DRAFT.zh.md`** | 12.9 KB | ⭐ **主页骨架**——「下一大版本 README 替换草稿（中文版）」，hero copy + 段落结构；标注【保留区】（从现 README 原样迁移）与【占位】（随大版本落地替换） |
| `docs/NEXT-MAJOR-PROMO.md` | 24.9 KB | **全量文案库**——品牌句/开场/每个功能的成稿/工程说明/场景物料/发布公告；「组装 README / landing / npm 简介 / QQ 公告时从这里取材」 |
| `docs/PROMO-STYLE-GUIDE.md` | 5.4 KB | **文风守则**（「热叙述体」，产品拟人作「她」=可靠/克制）；自称**可整套复用到其他项目主页** |

> **判定**：用户说的应是 **`NEXT-MAJOR-README-DRAFT.zh.md`**（唯一同时具备「主页风格」与「Markdown」两个属性的骨架稿）；
> `NEXT-MAJOR-PROMO.md` 是它的**素材库**，`PROMO-STYLE-GUIDE.md` 是**文风依据**。三份互有交叉引用，排版时应**成套使用**。

⚠️ **两份文档都带硬约束**（原文）：`NEXT-MAJOR-VISION.md` 声明「**本文档是愿景与 README 宣传方案的唯一权威来源。大版本完成前禁止改 README**」；
`NEXT-MAJOR-PROMO.md` 亦写「**大版本完成前禁改 README**」。

✅ **2026-09-17 02:1x 该禁令已被用户解除**：用户裁定「**你觉得现在不是大版本吗？先按照大版本的标准把这个 README 修改一下**」
⇒ 承认当前即大版本，README 按大版本标准改写（**文案层**先行，图片待前端重构后另行处理）。

### 2.2 本次 README / 手册改动（2026-09-17 02:1x–02:3x 完工）

**用户原话拆解**（三轮澄清后的准确理解）：
1. 「按大版本标准改 README」= 正文已是大版本骨架（`【占位】/【保留区】` 标记已全部清空），**真实缺口是 3.0 后端成果零覆盖**；
2. 「README 里的那些按钮，比如说切中英文那样的」= **顶部按钮行**，不是插件 UI；
3. 「用户手册也记着用最新的办法来改」= 手册同样补 3.0 内容 + 换按钮样式；
4. 「图片什么的等前端重构后再改」= **本轮不动图片**。

| 改动 | 文件 |
|---|---|
| **按钮行换成 for-the-badge 徽章**（语言切换 2 枚 + npm/许可证/零依赖/平台 4 枚 + 导航行） | `README.md` · `README.zh-CN.md` |
| 新增「**3.0 底层重建**」段（8 项机制对照表，中英各一份） | 两个 README |
| 30 秒亮点表补「**多工作区不串线**」一行 | 两个 README |
| 手册顶部加同款徽章 + 返回 README 链接；版本号 `2.2.7+` → `3.0+` | `docs/USER-GUIDE.zh-CN.md` · `docs/USER-GUIDE.en.md` |
| 手册新增 **§13「3.0 底层重建：对你意味着什么」**（5 小节，面向用户解释边界）+ 目录项 | 同上 |

**参照物**：`D:\dsh-memory-fitting\README.md`（用户 2026-09-16 23:40 上传的「思维拟合插件」）。
徽章写法照抄其 `for-the-badge` 语言切换块 + 独立徽章行；手册顶部也照抄其「语言切换 + 返回 README」结构。

**自检（已过）**：6 个徽章 URL 全部 HTTP 200；4 个文件均无 BOM；4 个文件站内锚点 0 处断裂（用 github-slugger 算法逐条核验）；
链接目标（LICENSE / CHANGELOG.md / CONTRIBUTORS.html / docs/internal）全部存在；两 README 标题数对称（各 50）、两手册对称（各 36）。

**未做**：图片与截图（等前端重构）；`docs/promo/homepage.html` 排版（另案）。

> 纪律**仍然有效**的部分：`NEXT-MAJOR-VISION.md` 作为**愿景与宣传文案的权威来源**这一条不变；
> 本轮只改文案层，未动 README 里的任何图片引用（`promo-*.png` 原样保留）。

**其它参考**：`docs/promo/homepage.html`（既有主页）、`docs/CONTRIBUTORS.html`（本轮新建，
liquid-glass 深色主题、zh/en 切换、单文件零依赖）。
**纪律**：单文件零依赖、无 BOM、GitHub 上须用 `htmlpreview.github.io` 包裹链接（`.md` 不包裹）。

---

## 3. 之前提到但未做的（结转项）可以重新排期，看是先做主页，还是先做这一方面的内容。

### 3.1 本批明确排除的（用户此前同意）
| 项 | 内容 | 备注 |
|---|---|---|
| 群反馈 #7 | 日历太粗糙 → 换开源方案（`fullcalendar`/`tui-calendar`） | 新功能，需排期 |
| 群反馈 #9 | webhook CI 安全收口（签名/限流/密钥）；`.github/cloud/qq-webhook/index.zip` 仍入库 | 运维项 |
| subagent 智能调度 | `shouldSpawn`/`judgeSubagent` **零命中** ⇒ 未实现 | **是功能缺失，不是验证缺口** |

### 3.2 P0-4e（已实测复现，未修）★ 与并发问题强相关
索引同步防抖：持续写入 ⇒ 索引永远不就绪（实测卡死 20 分钟）。
**本次并发调查补充**：`mivCache` 单槽会放大该效应（见 `CONCURRENCY-INVESTIGATION-20260917.md` §5）。

### 3.3 并发缺陷（本次调查新发现）✅ **已修完并验证**
4 个单槽共享点：`_tierGateHits` / `mivCache` / `lastIndexDegrade` / `_lastTierQuery`。
采用**方案 A（分片化）**，2026-09-17 01:1x 完工：

| 单槽 | 改为 | 主因 |
|---|---|---|
| `engine._tierGateHits` | `_tierGateHitsBySession.set(sessionId, …)` | A 投递后被 B 覆盖 ⇒ A 取到 B 的投影 ⇒ 身份门 session-mismatch ⇒ **A 永远不下探 Tier-1** |
| `mivCache` | `mivCacheByWs`（按工作区） | 两工作区互相踢缓存 ⇒ 每次必然重算，放大 P0-4e |
| `lastIndexDegrade` | `indexDegradeBySession` | 读方原只判 10 分钟窗、不判会话 ⇒ **跨会话假降级** |
| `_lastTierQuery` | `_lastTierQueryBySession` | 无条件覆盖，读取侧退回 `triggerText` |

- 判定口径（T0-2 五道门）**一字未改**；三处分片容器加 `size>32` 有界淘汰。
- 兼容投影保留（`engine._tierGateHits` / `engine._lastIndexDegrade` / `debugView.memoryIndexVersion`），只增字段。
- 新增套件 `tests/smoke/smoke-test-multiworkspace-pre.mjs` **22 断言**（S 源码守卫 7 + B 分片语义 6 + R 真实现抽取执行 6 + C 兼容 3）；
  变异演示**真失败 5 条**（含行为测试 R1/R2 抓住）。
- 全量回归 **PASS 105 / FAIL 0 / TIMEOUT 0（160.5s）**。

> ⚠️ 验收要点：R 组是**从源码抽取真实 `recordTierGateHits` 执行**的；B 组测的是套件内本地辅助函数，**属"假绿风险"**，不能单独作为守卫。

### 3.4 其他结转
- **合并远程 60 提交** → 已由本轮 PR 全部 merge 覆盖（远端 `main` = `43c5492`）；本机 pre 线**不受影响**，上传时强制覆盖
- **送审**：任务书 `docs/internal/GPT-ACCEPTANCE-PROMPT-20260916.md` 已就绪，待用户投喂 GPT
- **看板卡片**：三张已回写（P0-A 已解耦 / P0-B 已修 / P0-4d 已完工）
- `docs/internal/TODO-GRAPH.html` 里可能还有其它"待开工/待调研"卡片未清点
- **PR/issue 批**：已完成（见 §6）

---

## 3.5 S10「Karpathy 模块」实现缺口审计（2026-09-17 02:1x，用户点名的送审重点）

**触发**：用户指出「这正好就是我准备让 GPT 审的部分，说明有些东西还是漏做了，**尤其是接续这部分**」。
**方法**：以「契约声称 vs 代码真实调用链」为准逐条 grep，**有调用点才算已实现**。全部结论附行号。

### ✅ 结论先行：接续主链是通的，工程质量高于契约文档给人的印象

| 环节 | 状态 | 证据 |
|---|---|---|
| 水位触发 → 写交接账本 | ✅ 已实现 | `index.js:2789` `writeHandoffLedger` |
| 判据门（四段式硬门） | ✅ **真接线** | `index.js:2302` `checkHandoffCriteriaPre`；两咽喉 `:1939` / `:2020` 都过同一入口 |
| 骨架降级只跳判据门 | ✅ 正确 | `index.js:2804` 的 `skipCriteria:true` 注释与实现一致（丢卡门绕不过） |
| 保护门（丢卡/用户区/重复 id） | ✅ 已实现 | `index.js:2325` `validateMutationBoundaryPre` |
| 新会话收交接材料 | ✅ 已实现 | `index.js:3118` `buildContinueCarry` → `:3144` `sc.prompt` 投递 `carryText` |
| 先停旧回合（PR#37 争议点） | ✅ 已实现 | `index.js:3099` `sc.cancel({sessionId: oldSid})`，降级路径也留痕 `:3105` |
| 接续序号标题 | ✅ 已实现 | `index.js:3129-3131` rename 为「接续 #N · 工作区」 |
| requestId 必填坑 | ✅ 已修 | `index.js:3141-3143` 铸造 `randomUUID`（缺失会导致材料从未送达） |

### ❌ 真缺口（用户说「漏做了」，这是实证）

**缺口 1（P0）· 白板**注入**通路依赖 `boardMode='graph'`，而默认是 `legacy`**
- 默认值：`index.js:219` `boardMode: 'legacy'`；客户端初值 `client.js:2869` 同为 `'legacy'`。
- 锚点写入被 graph 档门控：`index.js:1988`（PLAN）与 `:2032`（账本）——**非 graph 档完全不写锚点**；
  sidecar 同样在 `:2076` 直接 `return`。
- ⇒ **默认配置下 S10.1 的「页面即语料」整条链不生效**。契约文档 `WB-FORMAT-CONVENTION.md` §2 把它写成无条件收益，与实现不符。
- **严重度**：P0（送审友好度）——这是"契约声称 vs 默认行为"的直接冲突，GPT 一定会问。

**缺口 2（P0）· 白板**检索**通路从未接入（与缺口 1 独立）**
- 注入路径 ✅：`index.js:4701` `add('whiteboard', s.planText, s.planPath)` → Tier-0 目录（五来源之一，且有保底配额）。
- 检索路径 ❌：`pushL0` 仅四个来源（`:5505` 日志 / `:5506` 反思 / `:5507` 项目笔记 / `:5508` 用户级）；
  `semSources` 同样四个（`:5704-5707`）。**白板一处都没有**。
- ⇒ **白板每轮被注入，但 `memory_recall` 搜不到它**。契约 §2 承诺的"自动进入检索语料"目前只兑现了注入那一半。
- **严重度**：P0。

**缺口 3（P1）· S10.2「索引自动生成」零实现**
- `indexMd` / `renderIndex` / `buildIndexMd` / `index.md` **全 0 命中**；`derive` 的 13 处命中全是别的语义
  （`_waterDeriveCache`、`derived-fact`、`.md` 去后缀）。
- ⇒ 契约 §3「index 由页面派生、与白板不得各写一份」**只有契约，无实现**。

**缺口 4（P1）· S10.3「lint 四类 + 矛盾检测」零实现**
- `lint` 全仓仅 11 处，且无任何 `function/export` 定义 —— 非 semantic 的 4 处是**注释里的提及**
  （`wb-contract-pre.js:261`、`wb-sidecar-pre.js:517` 都写着"供 lint 用"，但**没有 lint 本体**）。
- ⇒ 四类零 token 检查与矛盾检测（手动触发）均未实现。

**缺口 5（P2）· 账本跳过用户区保护**
- `index.js:2313` `if (target === 'handoff') return { ok: true }` —— **账本的共同保护门被无条件放行**。
- 与同一函数 docblock 的声明直接矛盾：`:2062` 写着「共同保护门（`validateMutationBoundaryPre`）= 丢卡 / 用户区 / 重复 id，
  **无条件生效**，`criteriaGate=false` 与"骨架 fail-soft"都绕不过」；`:2308` 行内注释亦写「（无条件；只在"重写既有目标"时有意义）」。
- 另 `:332` 的模块级注释同样声称「`validateMutationBoundaryPre` 里无条件生效」。
- **判定**：三处注释声称"无条件"，实现却在 `:2313` 对 `handoff` 提前放行。
  影响面有限（账本走 `:2022` 的 `beforeText: ''`，本就不涉及"重写既有目标"的丢卡语义），
  但**注释与实现不一致本身即缺陷**，且若将来账本改为可覆盖写，这里会成为静默漏洞。

**缺口 6（P2）· 死导出**
- `wb-contract-pre.js` 12 个导出、`wb-sidecar-pre.js` 16 个导出、`ledger-criteria-pre.js` 7 个、`memory-mutation-pre.js` 5 个
  **在 `index.js` 里零引用**（如 `computeWhiteboardCardIdPre`、`buildByCuePre`、`collectAnchorIdsPre`、`checkWriteCriteriaPre`）。
- 部分可能被 client.js 或测试消费，属"疑似死代码"而非确证死代码 —— **建议 GPT 复核**。

### 修复建议（按优先级）

1. **P0**：让白板进 `memory_recall` 语料 —— 在 `pushL0` 与 `semSources` 各补一条白板来源（路径 `p.planPath` 已存在），
   并给 `whiteboard` 层同样的配额保护。**这是最小、最高性价比的一改。**
2. **P0**：`boardMode` 默认值决策 —— 二选一：① 改默认 `graph`（需评估既有用户兼容）；② 让锚点写入**不依赖** boardMode
   （锚点是格式契约，与看板渲染形态无关）。**倾向 ②**，因为锚点属写入契约、看板属渲染形态，本不该耦合。
3. **P1**：S10.2 / S10.3 二选一：补实现，或在契约文档标注「**未实现**」并降级为规划项。
   **送审前必须至少做到标注**，否则就是又一次"契约已定说成已实现"。
4. **P2**：修正 `:2313` 注释与实现的不一致（或补上账本保护门）。

---

## 4. 硬约束（贯穿全程）

1. **禁止无差别杀 node 进程**（DSH harness 与插件宿主都在 node 上，2026-09-14 出过事故）
2. **`dsh web` 宿主由用户自行重启**；agent 只改文件 + 说明需重启，严禁 Stop/Start-Process
3. **无 BOM**；大文件分块写；改前备份 `*.bak-YYYYMMDD-<tag>`
4. **代码留在 pre 线**，未经明确同意不 commit/push/publish
5. **单一开关不得顺带改变其他功能的行为**（解耦）
6. **开关类改动必须即时回显**（写盘成功但界面无变化 = "功能坏了"）
7. **CSS 令牌必须查权威清单**，不得凭记忆拼写
8. 结论附代码/日志证据；推断显式标注

---

## 5. PR #37 说明（留痕，避免下个窗口重开）

- **原裁定**：用户 2026-09-17 明确「就先不做了，反正冲突了，就按我自己做的新的做，没问题就行」。
- **理由**：PR #37 的 `continuation-safety.js` 文件头明写 `no cancel of source work`，
  走 idle 门；而 pre 线按用户 2026-09-14 裁定走 `sessionController.cancel()` **先停旧回合**
  （`lib/index.js` 注释记录用户反对 idle 门方向）。
  两者方向**直接相反** ⇒ 不移植到 pre 线。
- **pre 线方案状态**：**完好**。`smoke-test-autocont-host-pre.mjs` 钉死调用顺序
  `cancel → prompt → create`，并覆盖降级路径（无 cancel / cancel 抛错）。

### 5.1 但**远端**已礼节性 merge（2026-09-17 01:5x）⚠️
用户 01:3x 补充裁定：**「远端 merge 也无所谓，最后推 NPM 和 GitHub 时我会把统一的最新版本强制拉上去」**。
⇒ 本轮把 #37 与其余 6 个 PR 一并 merge 到远端 `main`（冲突在 worktree 内解决：`lib/index.js` 两处 import 行取并集）。

**关键结论（避免下个窗口误判）**：
**远端 merge 不改变 pre 线任何一行代码。** pre 线 `D:\dsh-auto-memory` 仍是 §5 原裁定方向
（`cancel()` 先停旧回合），**不得**因为「#37 已经 merge 了」就把 idle 门方案搬进来。
上传时以**本机版本强制覆盖**远端，被顶掉是预期行为。
> 遗留观察（非阻塞）：远端 `main` 现在同时含 idle 门方案与本机将来要推的 `cancel()` 方案，
> 两者在远端**并存**——但这只是中间态，最终由强制推送收敛。

---

## 6. PR / Issue 批（✅ 2026-09-17 01:3x–02:0x 完工）

用户 01:3x 裁定：「**把这些 pull request 和 issue 都回复了，然后 merge 了**……**这个 issue 读完了，做好回应。关掉就可以。**」
质量要求明确被豁免（「反正 main 里面 merge 管不到我本机的系统……所以不用管质量」）——**本轮以礼节性处理为准**。

### 6.1 7 个 PR 全部 merge 到远端 `main`

| PR | 标题 | 处理 |
|---|---|---|
| #36 | fix(procedure): episode 候选如实标记 observation-only | ✅ 直接 merge `dc76373` |
| #44 | fix(capacity): 按最终序列化结果计费，整段归档 fsync+读回验证 | ✅ 直接 merge `c12d023` |
| #46 | fix(tour): 欢迎向导自动弹出全链路等宿主配置 | ✅ 直接 merge `8d63bc8` |
| #49 | fix(recall): 取消排名前的记录截断（issue #45） | ✅ 直接 merge `b1f4abe` |
| #53 | fix(issue51): anchor workspace overview log-date matching | ✅ 直接 merge `3d92a67` |
| #50 | fix(issue48): atomicReplace EPERM 退避重试 | ⚠️ **有冲突** → worktree 内解决 `25a7c7b` |
| #37 | fix(issue35): 自动接续重做为真实空闲闸 + 可证仪式 | ⚠️ **有冲突** → worktree 内解决 `43c5492` |

**冲突处理方式**（两个 PR 的冲突**都只在 `lib/index.js` 的 import 行**，取并集即可）：
- `#50`：3 处 —— import 行补入 `memoryWriteError` + `fs-retry.js`；两处 `throw` 改用 `memoryWriteError('append'/'replace', r)`。
- `#37`：2 处 —— import 行同时保留 `memory-capacity-safe.js` 与 `continuation-host.js`；`memory-writer.js` 那行保留 HEAD 具名导入并**追加** `atomicReplace`。
- 解法统一用「取并集 + 保留 HEAD 已有符号」，`node --check` 通过后才 commit/push。

### 6.2 工作流（可复用）

**`gh` CLI 未安装** ⇒ 全程走 GitHub REST API + `git credential fill` 取 token（`credential.helper=manager`）。
**冲突不得在主仓库解**：先在 `D:\_merge-wt` 建 `git worktree --detach origin/main`，全部解决 + 语法检查 + commit 后 `git push origin HEAD:main`。
（踩坑提醒：`lib/index.js` 是 **CRLF** 文件，写解析脚本必须按 `\r\n` 拼串，否则替换「3 处命中 0 处」。）

### 6.3 9 个 issue 全部「回应 + 关闭（completed）」

| Issue | 标题要点 | 回应要点 |
|---|---|---|
| #54 | 写入侧缺保留语法过滤（自提 P0） | 采纳方案 a；补 `conflict:<type>@<line>` 行号；顺带修 `stripAnchorLines()` 收口的既有静默损坏 |
| #52 | 子代理模型被旧 cfg 覆盖 | `set()` 改函数式 + 新增 `setMany()`；5 条回归用例落地 |
| #51 | `DATE_RE` 未锚定 | 取最小修复（完整锚定）+ 修正误导性注释；含「与 index.js 行为一致」护栏断言 |
| #48 | `atomicReplace` 缺 EPERM 退避 | 建议 4 条全落地；**并确认了报告者「自查」的 `_queue()` 大小写 key 问题** |
| #45 | recall 256 截断（英文报告） | 取消查询前截断 + 保留排名后 limit；加 `[本地检索范围受限]` 提示；性能优化明确不在本 PR |
| #40 | `welcomeTourEnabled=false` 无效 | 4 条建议全落地；向导真源定为宿主配置 |
| #38 | 容量整理净增长 +10/轮 | 建议 1+3；`replace` 改按最终序列化结果计费 |
| #35 | 自动接续绕过活跃防护 | Defect A/B/C 全修；heartbeat 路径同覆盖 |
| #30 | Procedural skill 永不晋升 | 标记 observation-only + 原因码全链透出；去重改指纹；手动激活与可配阈值**明确未纳入** |

**回应纪律**：每个 issue 都写明「根因是否确认 / 采纳了哪几条建议 / **哪些没采纳及原因** / 回归套件与断言数」——
对报告者的准确之处**明确致谢**（如 #45「索引存在 ≠ 可检索」、#51「注释说是同源、实际不同源」），不揽功也不含糊。
