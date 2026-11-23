# 任务书：投递策略大模块（设置页 + 后端最小支撑 + 诊断开关）

日期：2026-11-17。执行者：GPT。验收者：Lead（DSH 侧）。仓库：`D:\dsh-auto-memory`（本地 preview 线）。**不发布、不 push。**

## 0. 你的目标

把当前零散的投递设置整合成**一个「投递策略」大模块**（入口卡片 → 二级页面 → 细节编辑），并交付它所需的后端最小支撑：

1. Policy v2 契约（模块/配额/表示/传输/触发/预设）与校验；
2. 只读预览 API（纯函数、确定性）；
3. 诊断摘要 provider（**默认关闭**，设置里可开）；
4. 双节奏默认翻倍并迁移（slim 8→15、full 20→40）；
5. 账本 run_full 降为 slim 三段视图；
6. 前端大模块（替换旧散设置，二级菜单 + 细节编辑 + 预览 UI）。

## 1. 权威顺序（冲突时以此为准）

1. 用户裁定：`docs/internal/DECISIONS-BATCH3-POLICY-RULINGS-20261117.md`
2. 本任务的设计与迁移方案：`docs/internal/PLAN-DELIVERY-SETTINGS-MODULE-20261117.md`
3. 前端任务包：`docs/internal/TASKPACK-FRONTEND-SETTINGS-20261117/`（README + 3 个 skills + 03 契约 + 04 验收）
4. L1 架构契约 > L2 施工细则 > L3 测绘（`docs/internal/DETAIL-BATCH3-*`）
5. 现有源码事实（以代码为准，不以旧报告为准）

若 1-3 与源码事实冲突，**停下报告**，不要自行选择。

### 2.1 追加裁定（水位默认，2026-11-17；取代 PLAN 旧样例）

- 默认 `fullInjectWaterPct = '25'`（50 档默认关闭）——这是当前源码事实，也是本批裁定；PLAN 旧样例 `'25,50'` 是文档错误，已修正。
- 显式配置保留：`'25,50'` 双档、`'off'/'0'` 禁用、`'25'` 单档、自定义列表原样。
- 旧默认残留迁移：新增独立版本戳 `waterPctDefaultsVersion`；未打戳且磁盘值恰为 `'25,50'` → 迁为 `'25'` 并记录 `waterPct-old-default-migrated`；其他值不动。
- 前端同步（CA-AD1 遗留）：`lib/client.js` 18399/22072/25298、`skins/legacy/iter5-325.js.frozen:1684` 的 fallback/placeholder，以及 `skins/iter5/settings-copy.js:71` 文案，全部改为 `'25'`（可填 `'25,50'` 开启 50 档）。

## 2. 当前事实（已核，可直接引用）

- 设置入口：同一组件注册到 `settings.section`、`settings.plugins.tab`、`plugins.detail.section`（`lib/client.js:25983-26010`、`:26065`）。
- 13 个用户可关注入分区：`lib/index.js:1645 PROMPT_SECTION_KEYS_PRE_V1`；must 段 2 个（`:1666`）；前端文案镜像 `lib/client.js:24584 PROMPT_SECTION_TEXT`。
- 节奏：`DEFAULT_SNAPSHOT_MIN_GAP_ROUNDS=20`（`:628`）、`slimEveryRounds: 8`（`:1177`）；迁移 `:4147-4185`，两条独立版本戳。
- 账本：`_LEDGER_FULL_TIERS`（`:13130`）当前含 `run_full`。
- 日志：唯一生产者 `recentLogTails`（`:9464`，每天 700 字符尾部）；`projection.js:40,44` 两段都映射 `recent-logs`。
- 诊断：`diagLogFile()`（`:2622`，`dsh-auto-memory-diagnose.log`，2MB 轮转保留 1 份）、`diag()`（`:2649`）；`projection.js:47 diagnostic: null`，注入面零生产者。
- 已废弃键：`slimPlanChars`/`slimLedgerChars`（`:1024` 注释），从 UI 移除、键值保留。

## 3. 交付阶段（可分批交付，每批独立可验收）

### P1 后端（先做，接口冻结后再动前端）

新增文件：
- `lib/injection/policy-v2.js`：PRESETS（4 内容档）/ MODULE_REGISTRY（11 生产者 + 2 锁定段）/ DEFAULT_POLICY / `validatePolicy` / `resolvePolicy({tier,isHuman,isFull,overrides})` / `legacyToPolicy(config)`（纯函数、幂等）。
- `lib/injection/preview.js`：`previewDelivery({policy,sources,tier,isHuman,isFull})` → `{text,chars,receipt,partial}`。只读、不消费状态；unit 引擎未接前可组合现有 PJ+FM，必须标 `partial:true` 并在 UI 显示「部分结果」。
- `lib/injection/diagnostics.js`：`readDiagnosticDigest({enabled,file,now,windowHours,maxLines,readFile})`。**enabled=false 时不读文件、返回零**；enabled=true 只输出 `{code,count}`，code 必须匹配 `^[a-z0-9:_-]{1,40}$`；禁止路径/正文/会话 ID/查询词。

修改（薄接线，全部走定点 edit，不整文件重写）：
- `lib/index.js`：DEFAULT_CONFIG 增 `deliveryPolicy:null`；保存时调 `validatePolicy`（非法即拒绝且不落盘）；新增 `POST /api/dsh-auto-memory/delivery-preview`（沿用现有鉴权/错误协议）；诊断注入（`normal` 优先级、≤5 行/300 字符、无错误零字节）；`_LEDGER_FULL_TIERS` 移除 `'run_full'`；`DEFAULT_SLIM_EVERY_ROUNDS 8→15`、`DEFAULT_SNAPSHOT_MIN_GAP_ROUNDS 20→40`，两条迁移版本戳各 +1，保留显式意图（slim=1、full=0）；水位默认改 `'25'` + `waterPctDefaultsVersion` 迁移。
- 计数锁与文档：配置键 +1、路由 +1；同步 `docs/internal/FEATURE-INVENTORY.md` 与校验器；以校验器 actual 为准。
- **有限写域（已批准）**：`lib/injection/cadence.js`（仅：返回体加 `isHuman`；内部 fallback `fullGap 20→40` / `slimEvery 8→15`；修正 41-43 行过期注释）与 `lib/injection/dto.js`（仅：`makeCadenceDecision` 增 `isHuman` 布尔，缺省 false 保持旧调用兼容）。不得改 tier 判定逻辑、不得回退 r3 真人旁路、不得增删导出。

P1 验收：真 import→真构造→真调用；预览对同一输入 byte-equal；非法 policy 拒绝且零副作用；诊断默认关零 IO（用 spy readFile 断言未调用）；节奏模拟 100 步（slim ≤7、full ≤3）；账本 run_full 三段；日志只产 1 个候选；水位缺省 `[25]`、显式 `'25,50'`→`[25,50]`、旧默认迁移仅命中一次。

### P2 前端（P1 接口冻结后）

按 `TASKPACK/03-SETTINGS-CONTRACT.md` 实现：
- 入口卡片 + 7 个子页：预设与节奏 / 模块 / 预算与超额 / 触发 / 诊断 / 预览与回执 / 兼容。
- 模块表按 **11 生产者 + 2 锁定段**；`logs` 不单独出现（alias）；`diagnostic` 单独开关（默认关）。
- 旧控件处理：节奏/内容/预算三类迁入新模块；`slimPlanChars`/`slimLedgerChars` 从 UI 移除；其他子系统键保留原处。**同一语义不得出现两个可编辑控件**。
- 水位默认同步：`client.js` 18399/22072/25298 与 `skins/legacy/iter5-325.js.frozen:1684` 的 fallback/placeholder、`skins/iter5/settings-copy.js:71` 文案改为 `'25'`（可填 `'25,50'`）。
- 保存只写 `deliveryPolicy`；旧键只读影子，不双写；兼容页展示来源与迁移按钮（幂等）。
- 预览按钮调用 P1 路由；无路由时用 mock 并显式标注，不得静默假成功。

P2 验收：`node tools/build-iter5-skin.mjs --check --strict` → SYNC-OK；真执行 factory 并断言分区注册；设置往返；非法值拒绝；a11y。

### P3 端到端

真实宿主打开设置页三入口：a11y 树 + 截图；旧控件确实消失/折叠；新模块完整读写；预览与后端 byte-equal；诊断默认关；水位默认/迁移/前端文案一致；无网络请求（除本地预览）。

## 4. 文件边界

**可改**：`lib/injection/policy-v2.js|preview.js|diagnostics.js`（新建）；`lib/injection/cadence.js` 与 `lib/injection/dto.js` 仅限 P1 已批准的有限定点；`skins/iter5/*` 生成源及其生成产物（只通过生成器）；`lib/client.js` 手写区（仅按 skills/01 的测绘结论，定点 edit）；`lib/index.js` 仅上述薄接线的定点 edit 与新段；测试文件；相关文档。
**不可改**：发布脚本与版本号；`docs/teamwork-impl/` 历史文档；2.3/2.4 模块；`lib/event-store.js` 存储格式；皮肤结构重构；`package.json` 依赖。

## 5. 硬约束（违反即退回）

1. **锚点必须标 eol**（`lib/index.js` 全 CRLF、`lib/injection/*.js` 与 `skins/` 多数 LF）。纯 LF 锚点会被 Lead 归一化后断言唯一命中；锚点必须命中恰好 1 次。
2. 大文件禁止整文件 write；只做内容锚定定点 edit，改完 `node --check` + 真 import 一次；改前后记（行数/字节/导出数）三元组，导出数不变。
3. 前端禁止三方合并/社区 merge 式重构；禁止绕生成器改 GENERATED 区；`client.js` 手写区改动必须先在 guard map 里说明为什么不在生成源。
4. 禁止削弱既有测试；新断言必须真执行被测函数并带负路径；变异验证至少一条（变异必红、还原复绿）。
5. 计数锁（配置键/路由/导出/工具/13 键清单）必须全仓检索后同步，不得只改一处；以校验器 actual 为准。
6. 不允许「全绿」代替证据；未真机验证的项单列「未验证」。
7. 默认值改动必须有迁移与幂等断言；不得让存量用户停在旧值（历史事故：共用版本戳导致永久停旧值）。
8. 诊断默认关闭时**零读取**；开启时不得泄露路径/正文/会话 ID/查询词。
9. 预览必须是纯函数：不消费水位/通知/压缩状态；重复调用相同结果。
10. 不 push、不发布、不改版本号；交付以 patch/新文件 + 测试 + 报告为准。
11. 不得回退或重写 r3 已落盘的真人旁路与信号并集（`cadence.js:171-172`）；`isHuman` 只能增量叠加；JSDoc/注释与 R8 一致性属于允许的文档同步。

## 6. 回执格式（必须逐项）

1. 阶段与范围（P1/P2/P3 哪些完成、哪些未做）。
2. 改动清单：文件 + 锚点/行号 + 增删行 + eol；新文件全量路径。
3. 物理量：`lib/index.js` 与 `lib/client.js` 三元组（行/字节/导出）、配置键数、路由数、13 键清单命中数。
4. 测试输出：套件名 + PASS/FAIL 数 + 命令；不得汇总成「全部通过」。
5. 负路径与变异：每条修复对应哪条负路径/变异，实际输出。
6. 未验证项与已知缺陷（单列，不得混写）。
7. 首次失败与修复过程（如适用）：报错原文关键行 + 根因 + 修法。
8. 需要 Lead 决策的冲突（如有）：两条互斥事实 + 证据，不得静默选择。

## 7. 停止条件

遇到以下情况**停下报告**，不要绕：
- 现有测试因你的改动变红且无法在不动测试语义的前提下修复；
- 锚点不唯一或文件行尾与声明不符；
- 需要改不可改文件；
- 发现设计文档与源码事实矛盾；
- 真实宿主验证需要的重启/权限不在你手上。

## 8. 附件（随包交付给 GPT）

- `docs/internal/DECISIONS-BATCH3-POLICY-RULINGS-20261117.md`（sha256 见文件）
- `docs/internal/PLAN-DELIVERY-SETTINGS-MODULE-20261117.md`
- `docs/internal/TASKPACK-FRONTEND-SETTINGS-20261117/`（README + skills/01-03 + 03 契约 + 04 验收 + MANIFEST）
- 本任务书

先输出「测绘回执」：三处设置入口的实际组件/文件落点、13 键清单、旧散键读写点普查（含 dead 标记）、guard map。测绘回执通过后再进入 P1 编码。
