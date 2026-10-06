# AUDIT 2026-10-06 —— 上游 25 条报告核查结论与修复方案

> **面向施工 Agent**。自包含：含方法论与基线（§1）、25 项逐条裁决（§2）、可直接照单施工的批次划分（§3）、风险与依赖（§4）、验收与附录（§5）。
> 核查方：DeepSeek harness 核查会话（2026-10-06）｜ 前序：ZCode 会话完成线 V2/V4（见 \`docs/internal/HANDOFF-20261006-UPSTREAM-AUDIT-25.md\` 附录 A/B）
> **裁决基准 = 当前 wip 树 \`e3498c6\`（分支 wip/20260926-teamwork，lib/index.js 17372 行）**，非任何 PR 分支、非 npm 产物。
> **本核查全程只读**：未修改/新建任何被 git 跟踪的文件；所有探针与报告落在未跟踪的 \`.diag-issues20261006/\`。

---

## §0 总览表

### 0.1 裁决计数（25 项）

| 裁决 | 数量 | 编号 |
|---|---|---|
| **成立（缺陷确认）** | **15** | #216 #218 #222 #225 #226 #227 #228 #229 #231 #232 #233 #234 #235 #236 #238 |
| **诉求合理（FR，非 bug）** | 1（+1 半） | #223；#219 的「客户端字典由宿主真源生成」半 |
| **误报 / 对现位不成立** | 1（+1 半） | #220（缺陷只在 PR#215 分支）；#219 的「默认值漂移」半 |
| **组合特有（非现位缺陷）** | 1 半 | #219 的「九项 smoke 失配」半（组合基线在本机不存在） |
| **PR 采纳建议** | **7** | #239 采纳（拆取 4 行 + 1 行）｜ #217 #221 #230 #237 **拆取** ｜ #215 #224 **仅拆取已定位 hunk** |

> 去重合计 = 15 + 1 + 1 + 7 = **24**，加 #219（一条报告拆成三个半，分列上表三行）= **25 项**。

### 0.2 25 项总表

| # | 标题（简） | 裁决 | 定级（报告→建议） | 修复批次 | 依赖/冲突 |
|---|---|---|---|---|---|
| #216 | defineTool 丢 items + armAutoContinue 漏子代理判据 | **成立** 2/2 | P1→P1 | **A-1** | 无 |
| #217 | （上条修复 PR） | **拆取** | — | A-1 素材 | 基线回滚风险（\`_canonPath\` 14→0） |
| #218 | 多进程配置 RMW 丢更新 | **成立**（实测 17/20） | P2→**P1** | **B-1** | 与 #225 同批 |
| #219 | 提示默认值漂移 + 九项 smoke 失配 | **部分成立** | — | **D-1**（仅 FR） | 需批次 Y 转正 |
| #220 | headroom 空串误存 0 | **误报（现位）** | — | 并入 PR#215 处置 | PR#215 自身缺陷 |
| #221 | （配置串行化 PR） | **拆取** | — | B-1 素材 | 含 #217 整支 |
| #222 | 别名绑定被判迁移并拒绝 | **成立** | P2→P2 | V2-1（同根） | 与 #233 同族 |
| #223 | graph 下隐藏侧栏「记忆(pre)」按钮 | **诉求合理** | FR | 批次 Y 转正后 | 动 iter5 设置源 |
| #224 | （集成草稿 PR） | **仅拆取 hunk** | — | 各批素材 | 98 提交组合基线 |
| #225 | 笔记压缩覆盖等待期新记录 | **成立**（数据丢失） | P1→P1 | **B-1** | 与 #218 同批 |
| #226 | 全局异常监听卸载不注销、smoke 假绿 | **成立** | P1→P1 | **V4-1** | 行为契约变更 |
| #227 | 技能写盘失败仍返回 ok | **成立** | P1→P1 | **A-1** | 依赖 #227-b 前置 |
| #228 | /file 路由 junction 越界读 | **成立** | P2→P1 | **V2-1** | 同根公共工具 |
| #229 | 皮肤名 \`..\` 越界写 | **成立** | P2→**P1** | **V2-1** | 同根公共工具 |
| #230 | （并发写与宿主失败语义 PR） | **拆取** | — | B-1/V2-1/V4-1 素材 | 与 #221 互补 |
| #231 | 迁移回滚用空库覆盖坏库原件 | **成立** | P1→P1 | **A-1** | 同文件不同函数 |
| #232 | 团队作者索引解包错、首写覆盖历史 | **成立**（每次启动命中） | P2→**P1** | **A-1** | 无 |
| #233 | DSH_HOME 别名被 400 误拒 | **成立**（批次 Z 回归） | P2→P1 | **V2-1** | 与 #222 同根 |
| #234 | 自动导出技能用宿主 cwd 标项目 | **成立** | P2→P2 | **A-1** | 无 |
| #235 | Python 向导接受不完整模型报 ready | **成立**（verifyArtifact 零调用） | P2→**P1** | **C-1** | 无 |
| #236 | 语料守卫接受相邻同前缀越界链接 | **成立** | P2→P1 | **V2-1** | PR#224 hunk 可用 |
| #237 | （DeepCode 别名 + 移动端 UI PR） | **拆取** | — | C-1 + 前端另排 | 与批次 Y 正面重叠 |
| #238 | 梦幻皮肤下浮窗消失 | **成立** | P2→P1 | **V4-1** | 与批次 Y 同函数 |
| #239 | （浮窗修复 PR） | **采纳（拆取 4 行 + 1 行）** | — | V4-1 | ⚠️ 哈希锁撞车 |
| PR#215 | V3 设置 UI 重构 | **仅拆取后端** | — | C-1 素材 | 含 #220 缺陷；基线回滚 |

### 0.3 三项「立刻可做、独立于一切批次」的修复（最高优先）

1. **\`tools/release.mjs:132\` 拷贝清单缺 \`smoke-impact.mjs\`** —— 一行修。现位 wip 发布出去的包 \`node tools/run-smoke.mjs\` 一跑即 \`ERR_MODULE_NOT_FOUND\`。
2. **\`lib/hub-io.js\` 的 \`save()\` 失败被吞**（\`:348-365\`）—— 它使 \`procedure-store\` 的 A-8 失败侦测（\`persistFailures\`）**恒为 0**（探针实证）。**不修这一层，#227 的其余修复全是假修。**
3. **\`lib/python-setup.js\` 的 \`verifyArtifact\` 零调用点**（\`:370\` 定义）—— 接一行即修 #235；\`MODEL_SPEC.bytes\` 与 \`kind:'json'\` 判据都现成。

---

## §1 方法与基线

### 1.1 方法
- **只读**：不修改/新建被跟踪文件；禁 \`git checkout/restore/reset/stash/commit/push/pull/rebase\`。
- **探针纪律**：临时脚本只写 \`.diag-issues20261006/\`（\`.tmp-*-*.mjs\`），跑完不删；探针内 \`import\` 写 \`../lib/...\`。
- **禁止**：\`tools/build-iter5-skin.mjs\`（生成器）与全量 \`tools/run-smoke.mjs\`；需要证据时**单跑** \`node tests/smoke/<file>.mjs\`。
- **证据优先级**：①真执行被测函数的产物级探针 ②代码链 file:line ③报告自述（仅参考）。三方冲突以 ① 为准。
- **「定义存在 ≠ 机制在跑」**：对每个新机制同时统计**定义处**与**调用点**；调用点为 0 即为未接线（本轮两次命中：#235 的 \`verifyArtifact\`、#227 的失败侦测）。

### 1.2 基线
- 已发布 = v3.2.9（GitHub main/tag \`e260677\`，npm latest 3.2.9）。
- 当前树 = \`e3498c6\` = v3.2.9 + 批次 W（\`lib/shared-state-lock.js\`）+ 批次 X（删 CAS、note 路由绑定、归属 scope 化）+ 批次 Z（\`lib/settings-safety.js\`）+ 批次 Y 前端检查点（**未转正**）。
- **判定口径**：缺陷若已被 W/X/Z 修 ⇒ 标「已修待发布」并查彻底性；若只在某 PR 分支 ⇒ 标「PR 自身缺陷」。
- **Windows 事实**：\`realpathSync\`（JS）不展开 8.3 短名、\`native\` 版展开；本机 \`TEMP\` 本身就是 8.3 拼写；junction 创建无需特权。

### 1.3 ★通用采纳判据（本轮两度救命，写入施工前置）
**任何 PR 采纳前先做基线错位检查：**
\`\`\`sh
git merge-base e260677 pr-<N>                       # 基线提交
git show pr-<N>:lib/index.js | grep -c _canonPath   # 关键符号计数
git show e260677:lib/index.js  | grep -c _canonPath
\`\`\`
本轮实测分布：
| PR | merge-base | \`_canonPath\` 计数 | 结论 |
|---|---|---|---|
| #215 / #217 / #221 | \`f2f7cc1\` | **0 / 0 / 0** | ⚠️ 整盘合入会**回滚 Android 符号链接修复** |
| #224 / #230 | \`e260677\` | 14 / 14 | 基线正确 |
| #237 / #239 | \`e260677\` | 13 / 14 | 基线正确 |

⇒ **默认姿势 = 逐项拆取；整盘合入必须逐条论证。**

---

## §2 逐项裁决

> 完整的 claims 表、探针输出与 file:line 证据见四份线报告（均在 \`.diag-issues20261006/\`）：
> **线 A** \`line-A-report.md\`（#227 #231 #232 #234 #216 PR#217）｜ **线 B** \`line-B-report.md\`（#218 #220 #225 PR#221 PR#230）
> **线 C** \`line-C-report.md\`（#235 PR#237）｜ **线 D** \`line-D-report.md\`（PR#215 PR#224 #219）
> 线 V2/V4（#228 #229 #236 #233 #238 #226 #222 #223 PR#239）的逐字报告见 \`HANDOFF-20261006-UPSTREAM-AUDIT-25.md\` 附录 A/B。
> 本节给出**裁决 + 成因 + 修复要点**（施工可直接照做）；需要完整论证时回溯上述文件。

### 2.1 路径安全族（V2：5 项，同根）

> **同根**：一切「词法路径运算 vs 物理文件系统别名」之争。**统一修法 = 双侧 realpath 归一（最深存在祖先 + 缺失后缀回拼）+ \`path.relative\` 四联判定，弃 \`startsWith\`。**

| 项 | 裁决 | 成因（file:line） | 修复要点 |
|---|---|---|---|
| **#228** | 成立 | \`isUnderMemoryTree\`(\`lib/index.js:12105-12111\`) 纯 \`startsWith(root+sep)\`，零 IO；路由 \`:16583-16602\` 守卫通过后 \`readTextSafe\` 跟随 symlink ⇒ 树内 junction 越界读返回 200（探针实证 OUTSIDE-SECRET） | 守卫改双侧物理归一；覆盖 \`handoffPanelData.fileQ\`(\`:5885-5891\`) 与 \`skinAbsPathOfPre\`(\`:12063\`) 两个同族面 |
| **#229** | 成立 | 皮肤名正则 \`/^[\w.-]{1,64}$/\`(\`:15592\`) 接受 \`.\`/\`..\`，\`path.join(dshHome(), SKIN_DIRS.user, name)\`(\`:15593\`) 把 \`..\` 解析到 \`~/.dsh/memory\`；\`renameSync\`(\`:15606\`) **无条件覆盖** | ①首字符限 \`[A-Za-z0-9_]\` 且显式拒纯点；②落点 \`path.relative\` 四联（\`rel===''\` 也拒）；③写盘前对 destDir 再做一次 realpath |
| **#236** | 成立 | \`lib/m4-corpus.js:66\` \`real.startsWith(declaredRoot)\` 缺目录边界 ⇒ 相邻同前缀目录的 symlink 越界（端到端实证进入快照） | 移植 PR#224 的 \`canonicalScopeGuard\` hunk（diff-224.patch:24757，**已验证有效**）；消费方 shadow-host/activation-host/storage-manage |
| **#233** | 成立（**批次 Z 回归**） | \`lib/settings-safety.js:49\` 在 realpath 判断前用未归一 home/target 做词法 inside ⇒ DSH_HOME 别名（junction / 8.3 短名）下合法目标被 400 误拒（8 案矩阵） | 删 :49 词法闸（保留 isAbsolute）→ 最深存在祖先 realpath → 回拼 → \`inside(realHome, realTarget)\`；与 \`migrateSettingsTree\` 已用的 \`canonicalDirectory\`(\`:83\`) 统一 |
| **#222** | 成立（**批次 Z 回归**） | \`_saveConfigChecked\`(\`:2883/:2892-2894\`) 用展开后**字符串**比较判迁移 ⇒ 别名（物理同根）进迁移后撞 \`migrateSettingsTree\` 的 realpath 重叠拒绝(\`settings-safety.js:82-85\`) | 迁移前 from/to 用 \`canonicalDirectory\` 归一；物理同根 ⇒ **跳过迁移照常原子写**；不动原语（\`smoke-test-settings-safety.mjs:165-173\` 固化的是原语层） |

### 2.2 技能 / 工具 / 接续族（线 A：6 项）

| 项 | 裁决 | 成因（file:line） | 修复要点 |
|---|---|---|---|
| **#227** | 成立 | \`procedure-store.js\` 9 处 \`void persist()\`（\`:257/:299/:355/:364/:374/:397/:474/:643/:725\`）丢弃 \`{ok,persisted}\`；\`index.js:15394\` 文案据此恒说「已写入」 | ①**先修 \`hub-io.js save()\` 吞错**（\`:348-365\` 的 \`catch(_){...=false}\` 违反自身 :131「失败原样抛出」契约）⇒ A-8 侦测才活；②六处 \`void persist()\` 改 \`const r = persist()\` 并把 \`persisted/persistReason\` 并入返回值（照抄 \`approve()\` \`:702-713\` 范式）；③工具/HTTP 消费该字段 |
| **#231** | 成立（数据损毁） | \`hub-io.js rollbackBoth()\`(\`:423-432\`) 对 \`readOne\` 返回 null 的坏库 \`save(snapOf(x) \|\| {schemaVersion:1,procedures:[]})\` ⇒ **空库覆盖原件**且绕过 corrupt 拒写(\`:345/:359\` 是检查的) | ①只回滚**本次真改过**的库；②\`corrupt\` 中的库**拒绝回滚并保留原件字节**，如实返回 \`rollbackRefused\`；③rollback 走 \`createScopedHubIoPre.save\`（受 corrupt 约束 + health 记账）；④入口 \`corrupt\` 非空 ⇒ 整批拒；⑤回滚前留存原件 |
| **#232** | 成立（每次启动命中） | \`index.js:13499\` \`rawA.data ?? rawA\` 与 \`config-io.js:170-185\` 的 \`{ok,value}\` 契约错位 ⇒ 载入 0 条，首写覆盖历史（探针 4/4） | \`const stA = (rawA && rawA.ok === true) ? rawA.value : null\` + 失败留痕。**必须按 \`ok\` 门控**——给 \`?? rawA\` 兜底会让损坏分支的包装对象照样被载入 |
| **#234** | 成立 | 工具 \`index.js:15426-15430\` 与 GUI \`:16453-16457\` **两处** \`projectPath: process.cwd()\` | 用会话项目（\`resolvePathsForSession\`/\`header.cwd\`）；GUI 对 workspace 条目用 \`workspaceRef\` 反查；**来源未知不得拿 cwd 冒充**，且提交失败不导出 |
| **#216** | 成立 2/2 | ①\`defineTool\`(\`:11997-12005\`) 只透传 type/description/enum；产物级实测：spec 键全集 = 5 个，**只有 \`items\` 被丢**，且全仓仅 \`memory_note\` 声明过它（4 处）②\`armAutoContinue\`(\`:4876\`) 是接续链**唯一**缺 \`isSubAgentSession()\` 的门 | ①补 \`if (spec.items) prop.items = spec.items\`；②补 \`if (isSubAgentSession(agent)) return\` |
| **PR#217** | **拆取** | 修复本身正确（字段补丁 + 复用既有判据 + 产物级反证测试） | 移植 2 行 + \`tests/lib/collect-tool-schemas.mjs\` + 改写 g3 第 6 段；**不采纳** \`smoke-impact.mjs\` 与 r26 R76 重钉（现位另代） |

### 2.3 配置 / 并发 / 笔记族（线 B）

| 项 | 裁决 | 成因（file:line） | 修复要点 |
|---|---|---|---|
| **#218** | 成立（**实测 17/20 丢**） | 保存队列是**实例级**(\`index.js:2849\` \`_configSaveChain\`)；配置写入共 8 处，其中 \`:2650/:2677\`（legacy 合并 / worker 自愈，同步裸写）与 \`:2774/:2799\`（容量迁移）**绕过队列**；全仓无跨进程锁 | 采用 PR#221 的 \`lib/config-lock.js\`（**A/B 实证：raw 20/20 丢 → locked 0/20 丢**）；**覆盖范围必须一次改全**（8 处写点）；锁失败须可观察 |
| **#225** | 成立（数据丢失） | \`compactAnchoredLayer\` 读快照(\`:6731\`) → 等折叠 → \`:6808 store.replace(filePath, newText)\` **不传 expectedDigest**；而 \`memory-writer.js:400-407\` 已支持该参数 | 读快照后立刻算 \`buf\` 的 sha256（\`buf\` 已在 :6738）；写回传 \`{expectedDigest}\`；冲突时**重读重算重试一次**，仍冲突则明确失败**绝不覆盖**；归档写入同口径 |
| **#220** | **误报（现位）** | 缺陷只在 PR#215 的 \`skins/iter5/settings-source.js\`（\`Number(e.target.value)\` ⇒ \`''\`→0、\`abc\`→NaN、\`-100\`→-100）；该文件**现位不存在** | **不在现位动刀**。若采纳 #215，先换成现位 \`lib/client.js\` 的已验证表达式 |
| **PR#221** | **拆取** | 新增 \`lib/config-lock.js\`（104 行）设计扎实：\`wx\` 独占创建、\`removeDead\` 校验 host+pid+ino/dev、\`AsyncLocalStorage\` 可重入、\`withConfigLockSync\` 遇忙抛 \`CONFIG_LOCK_BUSY\` 并降级只读快照 | 取 ①\`config-lock.js\` 整文件 ②\`index.js\` 三入口锁接线 + \`_configReadOnly\` 抑制两处裸写 ③\`tests/lib/config-save-worker.mjs\` + \`tests/smoke/smoke-test-config-transactions.mjs\`；**不采纳**其 \`client.js\`（45/67，且把版本指纹改回 v3.2.8）与版本号/CHANGELOG |
| **PR#230** | **拆取** | 五项修复与已核查项一一对应；\`lib/file-boundary.js\` 的 \`fileWithinRoots\` 返回**物理路径**供调用方使用 | 按项拆入各批；**与 #221 互补**（#230 无配置锁 ⇒ 不含 #218 修复）；两 PR 的 \`lib/index.js\` 区域重叠 ⇒ 施工**必须串行** |

### 2.4 Python / 别名 / 前端（线 C）

| 项 | 裁决 | 成因（file:line） | 修复要点 |
|---|---|---|---|
| **#235** | 成立 | \`downloadModel\`(\`:243-290\`) 只做 \`size < 100 MiB\`(\`:260\`) + tokenizer **存在性**检查(\`:262-265\`/\`:180\`) 即置 \`ready\`(\`:267\`)；\`verifyArtifact\`(\`:370\`) 能力完整（精确 size / sha256 回读 / JSON 解析）但**全仓 0 调用点** | \`:260\` 后接 \`await verifyArtifact(modelPath(), { bytes: MODEL_SPEC.bytes })\`；tokenizer 按件传 \`{kind:'json'}\`（\`sentencepiece.bpe.model\` 除外）；失败清产物 + 切镜像；\`sha256\` 为空时状态面须标「size-only」 |
| **PR#237** | **拆取 + 前端错峰** | \`_canonPath\` 是**增强**（祖先回溯 + 完整缺失后缀）非回滚；新增 \`_pathKey\`（win32 小写化）统一 3 处零散判据；\`rel === '..' \|\| startsWith('..'+sep)\` 修正前缀误判 | 后端 3 项（\`_canonPath\` 增强 / \`_pathKey\` 收敛 / 登记复用）+ \`smoke-test-deepcode-paths.mjs\` 夹具入 C-1；**前端（client.js + skins 三面 + 新增 skins/compat/mobile.css）等批次 Y 转正**；\`.gitattributes\` 变更需用户裁定 |

### 2.5 巨型 PR（线 D）

| 项 | 裁决 | 关键事实 | 采纳建议 |
|---|---|---|---|
| **PR#215** | **仅拆取后端** | 157 文件 / +20638 −7057；\`lib/client.js\`(+7002/−5045)、\`skins/iter5/settings-schema.js\`(+3675)、\`settings-source.js\`(+950) 占 84%；\`merge-base=f2f7cc1\`、\`_canonPath\` 计数 **0**；**含 #220 缺陷**；删除两个 workbench 套件整文件 | 取 \`lib/settings-safety.js\` 不与批次 Z 重叠部分 + \`smoke-test-settings-safety.mjs\`；前端 V3 主体**等批次 Y 转正**后另排 |
| **PR#224** | **仅拆取已定位 hunk** | 98 提交集成草稿；diff 27555+/7242−；含 6 个开放 PR 完整前置；\`merge-base=e260677\`（基线正确）；\`0838487\` 含 #236/#233 有效修复 | 只取 6 项：\`config-lock.js\` / \`file-boundary.js\` / \`hub-io.js\` / \`procedure-store.js\` / \`m4-corpus.js\` 的 #236 hunk / \`python-setup.js\` 的 #235 修复；\`index.js\` 按项拆 |
| **#219** | **部分成立** | 「默认值漂移」在现位**不成立**——\`snapshotPlanTitle\` 宿主与客户端**逐字节相同**、双方都**不含**报告所述新文案、同键值差异 **0 处**；**单跑 \`smoke-test-g4-whiteboard.mjs\` = 11 passed / 0 failed**；「九项 smoke 失配」属 PR 组合特有（组合基线在本机不存在） | 「客户端字典由宿主真源生成」的**诉求成立**，但归入 **PR#221 的拆取项**（同源）；须等批次 Y 转正（改生成器触发 \`--check\` 与 R78 锁） |

### 2.6 前端 UI 族（V4：4 项 + PR#239）

| 项 | 裁决 | 成因（file:line） | 修复要点 |
|---|---|---|---|
| **#238** | 成立 | 梦幻皮肤把 \`[data-dam-panel]\` 误标 composer，后注入 \`[data-dsh-dream-skin-composer]{position:relative}\` 压过无 \`!important\` 的 \`fixed\`(\`client.js:3531\`)；浮窗 \`:16074-16081\` 无 inline position、面板 div \`:16082-16091\` 无 role | PR#239 四行：inline \`position:'fixed'\` + \`role:'dialog'\` + aria-label；**落手写区，无需重跑生成器** |
| **#226** | 成立 | apply 注册进程级 \`uncaughtException\`/\`unhandledRejection\`(\`:13361/:13376-13383\`)，卸载(\`:17351-17363\`)无 \`removeListener\` ⇒ 卸载后致命异常被吞、exit 0 ⇒ smoke 假绿（\`run-smoke.mjs:242/:285\` 按退出码判） | ①改 \`uncaughtExceptionMonitor\`（记录不抑制）+ dispose \`removeListener\`；②自有定时器/Promise 全带 catch。**属行为契约变更**，需发版说明 |
| **#222** | 成立 | 见 §2.1 | 见 §2.1 |
| **#223** | **诉求合理（FR）** | 侧栏按钮 \`:18448-18450\` 无条件注册；\`boardMode\` 自 3.0.0 起出厂默认即 \`graph\` ⇒ graph 用户≈全部用户 | 方案 A（localStorage 开关，5 行）或方案 B（正式配置键 + 三面同步）；**需用户裁定 graph 默认是否隐藏**；须等批次 Y 转正 |
| **PR#239** | **采纳（拆取）** | 四行核心修复正确充分（inline position 压过无 !important 的规则；role=dialog 命中 dream skin 的 composer 排除条件）；CI 附带发现现位仍存在的 \`release.mjs:132\` 缺 \`smoke-impact.mjs\` | 取 ①浮窗四行 ②\`release.mjs\` 一行 ③\`tests/smoke/smoke-test-run-smoke.mjs\`；⚠️ **iter5-skin 哈希锁撞车**：PR 的 R78=\`133aee25\` vs 现位批次 Y 的 R78=\`a0460128\` ⇒ 合并后重钉 R79 并续写归因链 |

---

## §3 修复批次方案（施工照单）

### 3.0 施工铁律
1. **后端先行**；**任何前端批必须在批次 Y 转正（F2 裁决 + 真重生成 + 全绿）之后错峰**——PR#215/#221/#237/#239 **四者全部触碰 \`lib/client.js\`**，与批次 Y 未转正状态叠加必然互相覆盖。
2. **同根统一修**：路径五项（#228/#229/#236/#233 + #222）**必须一个公共工具一次修完**（双侧 realpath 归一 + 平台大小写 + \`path.relative\` 四联），修时**保住安全语义**（越界/嵌套仍拒）。
3. **PR 拆取优先于全盘**（先例：#210/#212/#213）。
4. 每批：\`node tools/run-smoke.mjs\` 全量回归；改 \`lib/index.js\` 必重钉 **r26 E3 哈希锁**；改 \`client.js\` 手写区必重钉 **iter5-skin 哈希锁**（当前 R78=\`a0460128\` → R79 + 归因链续写）。
5. **采纳任何 PR 前先做 §1.3 的基线错位检查。**

### 3.1 批次 0 —— 立即（独立于一切批次，零依赖）
| 项 | 文件 | 改动 |
|---|---|---|
| 0-1 | \`tools/release.mjs:132\` | 拷贝清单补 \`smoke-impact.mjs\`（一行） |
| 0-2 | \`tests/smoke/smoke-test-run-smoke.mjs\` | 从 PR#239 摘取（发布包 run-smoke 的守卫） |

### 3.2 批次 A-1 —— 技能 / 工具 / 接续（纯后端，5 项）
文件：\`lib/hub-io.js\`、\`lib/procedure-store.js\`、\`lib/index.js\`、\`lib/config-io.js\`
**顺序敏感（必须按序）**：
1. **A-1a（前置）** \`hub-io.js save()\` 失败可见化 —— 否则后续全是假修。
2. **A-1b** \`procedure-store.js\` 六处 \`void persist()\` → 结果传播（#227）。
3. **A-1c** \`rollbackBoth\` 只回滚真改过的库 + corrupt 拒绝回滚 + 走 scoped save + 入口整批拒（#231）。
4. **A-1d** \`index.js:13499\` 解包按 \`rawA.ok === true\` 门控 + 失败留痕（#232）。
5. **A-1e** #234 两处 \`projectPath\` 改用会话项目。
6. **A-1f** #216 两行（\`items\` 透传 + 子代理守卫）+ 摘 PR#217 的产物采集 worker。
验收：见各线报告「验证方法」；**必须含负路径**（ENOSPC / 目录占位 / 损坏 JSON / 子代理 arm 探针）。

### 3.3 批次 B-1 —— 配置 / 并发 / 笔记（纯后端，3 项）
文件：\`lib/config-lock.js\`（新增）、\`lib/index.js\`、\`lib/memory-writer.js\`（只读参照）
1. **B-1a** 落 \`lib/config-lock.js\`（取自 PR#221，整文件）。
2. **B-1b** \`index.js\` 三入口接线（\`loadConfigSync/loadConfig/saveConfig\`）+ \`_configReadOnly\` 抑制 \`:2650/:2677\`；**并补 \`:2774/:2799\` 两处容量迁移写点**（PR 未覆盖）。
3. **B-1c** \`compactAnchoredLayer\` 加 \`expectedDigest\` + 冲突重试（#225）。
验收基线与**已实测现状对照**：\`#218\` 现状 \`raw 20/20 丢\`，修后须 \`0/20 丢\`；\`#225\` 现状 \`presentAfterCompaction=false\`，修后须 \`true\`。

### 3.4 批次 V2-1 —— 路径安全统一修（后端，5 项）
**先落公共工具**（三选一，推荐合并为一个模块）：
- PR#230 的 \`lib/file-boundary.js\`（返回物理路径）
- PR#221/#237 的 canonical 增强
- 本仓既有的 \`lib/settings-safety.js canonicalDirectory\`（:64-75）
再逐项接线：#228（守卫 + fileQ + skinAsset）→ #236（\`m4-corpus.js:66\`，可用 PR#224 hunk）→ #233（\`settings-safety.js:49\`）→ #222（\`_saveConfigChecked\`）→ #229（皮肤名 + 落点）。
验收：V2 的 8 案矩阵（\`.tmp-v2-233-settings.mjs\`）+ #229 的 3 案 + #236 的 4 案；**越界必拒、别名必过、树内合法链接必过**三方向都要有。

### 3.5 批次 V4-1 —— 前端与宿主语义（**须批次 Y 转正后**）
1. **V4-1a** #238 浮窗四行（手写区，无需生成器）。
2. **V4-1b** #226 \`uncaughtExceptionMonitor\` + dispose \`removeListener\`（行为契约变更，发版说明）。
3. **V4-1c** \`release.mjs\` 一行（若批次 0 未做）。
⚠️ 合并 PR#239 时重钉 iter5-skin 哈希锁 R79（PR 的 R78=\`133aee25\` ≠ 现位 \`a0460128\`）。

### 3.6 批次 C-1 —— Python 与别名（后端 2 项）
1. **C-1a** #235 \`verifyArtifact\` 接线（3 行）。
2. **C-1b** PR#237 后端 3 项（\`_canonPath\` 增强 / \`_pathKey\` / 登记复用）——**与 V2-1 的公共工具合并实现**，避免第三套判据。

### 3.7 批次 D-1 —— PR 组合与生成器（**须批次 Y 转正后**）
1. **D-1a** #219 的 FR：客户端提示字典由宿主真源生成（与 PR#221 该部分同源，**不重复实现**）。
2. **D-1b** 按 §2.5 逐项裁决结果处理 #215/#224 的剩余拆取项。
3. **D-1c** 裁定两个 workbench 套件的去留（PR#215 删、PR#237 改，方向相反）。

---

## §4 风险与依赖

| 风险 | 说明 | 缓解 |
|---|---|---|
| **PR 基线错位** | #215/#217/#221 的 \`merge-base=f2f7cc1\`，\`_canonPath\` 计数 0 ⇒ 整盘合入回滚 Android 修复 | §1.3 前置检查；默认逐项拆取 |
| **\`lib/index.js\` 单点拥塞** | A-1/B-1/V2-1/C-1/D-1 **六批全部改它**（17372 行） | **必须串行**；每批改完立即重钉 r26 E3 锁并跑回归 |
| **前端四 PR 撞车** | #215/#221/#237/#239 全改 \`lib/client.js\`；批次 Y 未转正 | 前端批一律等 Y 转正后**串行**排期 |
| **哈希锁连锁** | 改 \`lib/index.js\` → r26 E3；改 \`client.js\` 手写区 → iter5-skin R78→R79 | 锁红**先归因**（判据过期 vs 真缺陷），禁止当失败回滚（用户 2026-10-01 裁定） |
| **测试资产净减少** | PR#215 删两个 workbench 套件；PR#237 又改其一 | D-1c 单独裁定，合并顺序不得决定结果 |
| **\`artifacts/**\` 入库** | PR#215 含 500+ 行 CI 日志快照 | 核对 \`tools/release.mjs\` 的 \`files\` 过滤 |
| **行为契约变更** | #226 放宽退出抑制、#223 隐藏入口 | 需发版说明 + 用户裁定 |
| **发布线** | 用户硬性规则：发布类动作须明确指令；**v3.2.10 已叫停** | 施工完成后不得自行发版 |

---

## §5 验收与附录

### 5.1 全局验收清单
1. 每批：\`node tools/run-smoke.mjs\` 全量 **0 FAIL / 0 TIMEOUT**；\`node tools/build-iter5-skin.mjs --check\` 若涉及前端则须 \`SYNC-OK\`。
2. 每项修复**必须自带负路径断言**（越界必拒 / 失败必可见 / 冲突必不覆盖）。
3. **禁止**以「源码含某字符串」充当功能验收；须真执行被测函数并断言返回值或副作用。
4. **新机制须同时统计定义处与调用点**——调用点为 0 即未接线（本轮两次命中）。
5. 本机 \`tools/verify-docs.mjs\` **不在回归套件内**，须每批单独执行。

### 5.2 可复跑探针索引（全部在 \`.diag-issues20261006/\`）
| 探针 | 覆盖项 | 关键输出 |
|---|---|---|
| \`.tmp-a-217-items-product.mjs\` | #216 C1 | 产物级：差异工具数 = 1（仅 memory_note） |
| \`.tmp-a-216-arm.mjs\` | #216 C2 | 守卫真值表：子代理 armed→BLOCKED，主会话不变 |
| \`.tmp-a-216-coverage.mjs\` | #216 C2 | 判据覆盖：\`armAutoContinue\` 唯一缺失 |
| \`.tmp-a-227-persist.mjs\` | #227 | ENOSPC 下 ok:true、磁盘无文件、persistFailures=0 |
| \`.tmp-a-232-attribution.mjs\` | #232 | 现状落盘只剩 new-key；修复后两键共存 |
| \`.tmp-v3-218-main.cjs\` + worker | #218 | \`rounds=20 lostUpdates=17\` |
| \`.tmp-b-221-ab20.mjs\` | PR#221 | \`raw 20/20 丢 → locked 0/20 丢\` |
| \`.tmp-v3-225-compact.cjs\` | #225 | \`DATA-LOST (report confirmed)\` |
| \`.tmp-v3-220-headroom.cjs\` | #220 | 现位矩阵 vs PR#215 矩阵 |
| \`.tmp-v2-233-settings.mjs\` 等 V2 六支 | #228/#229/#233/#236 | 见 handoff 附录 A |
| \`.tmp-v4-226-probe.mjs\` / \`.tmp-v4-238-notes-test.mjs\` | #226/#238 | 见 handoff 附录 B |
| \`.tmp-d-219-defaults.mjs\` | #219 | 两处 \`snapshotPlanTitle\` 逐字节相同、差异 0 处 |

### 5.3 材料清单
- 上游 30 条 open 全文：\`.diag-issues20261006/item-<N>.md\`
- 7 条 PR diff：\`.diag-issues20261006/diff-{215,217,221,224,230,237,239}.patch\`
- **本轮四份线报告**：\`line-A-report.md\`（24,990 B）/ \`line-B-report.md\`（20,099 B）/ \`line-C-report.md\`（12,213 B）/ \`line-D-report.md\`（13,667 B）
- 前序逐字报告：\`docs/internal/HANDOFF-20261006-UPSTREAM-AUDIT-25.md\` 附录 A/B
- 同类文档先例：\`docs/internal/AUDIT-20261005-PR210-212-213-VERIFICATION-AND-FIX-PLAN.md\`

### 5.4 核查完整性声明
- 25 项**全部完成裁决**（16 成立 / 2 诉求合理 / 3 误报或对现位不成立 / 1 组合特有 / 7 份 PR 给出采纳建议，其中 3 项与前述计数重叠）。
- **未复跑**的全量套件：\`tools/run-smoke.mjs\`（核查线明令禁止）、\`tools/build-iter5-skin.mjs\`（同）。
- **未复跑**的组合基线：PR 各自 CI 自述数字（#215/#221/#224/#230/#237/#239 的 260–306 PASS）**仅作参考，未采信为证据**。
- 唯一**代跑**的套件：\`smoke-test-g4-whiteboard.mjs\`（单跑，11/11 全绿，用于 #219 裁决）。

*本 AUDIT 由 2026-10-06 核查会话组装；裁决基线 \`e3498c6\`；全程只读。*
