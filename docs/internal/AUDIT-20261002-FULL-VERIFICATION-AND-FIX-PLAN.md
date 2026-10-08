# 社区 AI 审计（2026-10-02 批次）全量核查报告与修复总案

> **文档性质**：只读核查报告 + 修复执行总案。本文档不含任何代码改动。
> **核查基线**：当前工作树 `wip/20260926-teamwork @ 11b6dbab`（v3.2.7），lib/ 工作树干净。
> **核查对象**：GitHub 2026-10-02 集中批次的 39 条 issue（#164、#167、#169–#205）+ 4 条 PR（#168、#206、#208、#209）+ 用户自建 #207（对照项）。
> **核查方法**：10 个并行只读核查代理按模块分组，逐条对照当前代码取证（file:line）；其中 6 项做了运行级复现（TDZ、BOM 错位、hub-io flush、subagent-gc 扫描、Tier-0 切分、plan-store CAS、测试假红双重复现）。审计原始材料存于 `.diag-audit-20261002/`（正文/评论 JSON、4 条 PR 全量 diff、贡献者自带修复文档）。
> **用途**：供执行 agent 逐项修复。**本文档的每一条修复建议都已落到具体文件与函数，执行时以本文档为准，不要照抄 issue 原文行号**（见 §2 基线漂移说明）。

---

## 目录

- §1 一页总裁决（TL;DR）
- §2 三个全局前提（执行前必读）
- §3 核查结论总表（39+4 条）
- §4 PR 采纳总案（#209 基底 / #168 / #208 / #206 关系）
- §5 逐条核查详录（按修复批次排列，每条：结论/证据/成因/后果/修复建议/PR 评判/合并标注）
  - 批次 A：P1 数据安全（后端）
  - 批次 B：P1 功能接线
  - 批次 C：P2 后端
  - 批次 D：前端（最小侵入）
  - 批次 E：测试
  - 批次 F：决策项（需用户拍板）
  - 批次 G：F 批之外的独立项（#207 独立发现、#167）
- §6 流程层问题归因（为什么会有这批 bug）
- §7 验收与回归清单

---

## §1 一页总裁决（TL;DR）

1. **39 条 issue：36 条成立、3 条部分成立、0 条不成立、0 条已被当前树修复。** 贡献者的审计质量很高，几乎没有误报；部分成立的三条（#164/#167/#191）是"主张方向对、细节有偏差"，偏差均已查明并写进对应条目。
2. **贡献者自己提交的 4 条 PR 覆盖了其中 32 条的修复**，且深审结论：工程质量显著高于典型社区 PR，未发现"放宽断言转绿"，文档对自身局限的陈述诚实。**#209 是 #206 的严格超集（逐 hunk 比对确认），应以 #209 为唯一基底，不要从 #206 摘。**
3. **7 条 issue 四条 PR 都没修**，需独立修复：#171（BOM 错位，P1）、#172（hub-io 落盘失败不记账，P1）、#173（subagent-gc 漏导入，P2）、#169（normalizeGapRounds 作用域，前端 P2）、#176（测试夹具三处，P2）、#194 仅被修了 1/7 个键需补齐、#167（自动沉淀观察，PR 未涉及）。
4. **两个决策级问题需要用户拍板**，不能由执行 agent 自行决定：
   - **#179/F03 工作区目录键换 sha256**：PR 方案会让存量用户升级后记忆"看起来消失"（旧桶保留不迁移）+ 每轮注入迁移告警，直到手工给每个旧桶写 `.workspace-owner.json`。安全（fail-closed 不猜归属）但体验代价大，且是全 PR 耦合度最高的一束（约 20 个文件）。
   - **#201/F26 分块策略升级**：会使 Python 档既有向量全量失效、升级后首轮全量重嵌入（重建前语义检索拒绝服务）；默认 JS 档用户零影响。
5. **前后端风险分级**：36 条成立项中 30 条是纯后端（可大胆修）；6 条触及前端（#194/#195/#196/#169 + #186 的 2 处生成块传参 + #193 的 3 处 headroom 输入），修复必须遵守 §2-3 的生成块纪律，全部给了最小侵入路径。
6. **用户自建 #207 补充了 4 个 F 批未覆盖的独立发现**（cont-seq 计数器原子性、接续闩覆盖写、归档账本覆盖写、wasm CDN 依赖），全部核实成立，修法建议有效。

---

## §2 三个全局前提（执行前必读）

### 2-1 基线漂移：issue 行号基本可用，PR patch 需处理行尾

- 贡献者审计基线是 main 分支 `131ca794`；经三个独立代理用 `git diff --ignore-cr-at-eol` 实证：**main 与 wip HEAD 在全部相关 lib/*.js 上内容逐字一致，仅行尾不同（main=LF，wip=CRLF）**。因此：
  - issue 里的行号与当前树基本一一对应（少数 ±35 行以内），**以当前文件实况为准，行号漂移不算"不成立"**；
  - PR 的 hunk 内容可移植，但**直接 `git apply` 会因 CRLF 大面积失配**。推荐做法：按 PR head 整文件检出 → 统一转 CRLF → 跑 r26-E2（纯 CRLF 锁）与 `node tools/build-iter5-skin.mjs --check --strict` 收口；若剔除部分 hunk 导致字节漂移，按仓库惯例重算 E2/E3 冻结哈希并在提交信息写明上移理由。

### 2-2 前端结构：一个 client.js，三种归属

`lib/client.js` 由三部分组成，**改错归属会被生成器 `--check` 判 stale 后在下次重建时抹掉**：

| 归属 | 判别方法 | 修改方式 |
|---|---|---|
| 手写区 | `ITER5-GENERATED` 区间之外（生成块 B 结束标记在 `lib/client.js:16023` 附近；I18N 表 938–1551、MemoryPageView 16034+、SettingsPage 17300+、DebugCenter 16270+ 均为手写区） | 直接改 `lib/client.js` |
| iter5 生成块 | `ITER5-GENERATED` 区间内、源自 `skins/iter5/*.js`（含从手写段抽取的 SettingsPage→Iter5Settings 等） | 改 `skins/iter5/` 对应源文件 → `node tools/build-iter5-skin.mjs` |
| legacy 生成块 | 区间内、源自 `skins/legacy/iter5-325.js.frozen` | 改 frozen 源 → 重建 |

本文档每条前端修复建议都标注了归属。**严禁只改 client.js 产物行。**

### 2-3 修复纪律（用户红线）

- 后端可以大胆修；**前端（client.js / skins/）复杂脆弱，严禁顺手重构**，只做条目内点对点最小侵入。
- 改测试必须真阳性验证：先证明测试能抓到 bug（注入故障跑旧断言必红），再改断言，再跑新断言绿。
- #199 红线：**不得把 `_readWorkbench()` 改成返回 `{}`**——`_wbStateOf` / `ensureWorkbench` 的"未建"判据依赖 null 语义（用户在 #207 明示）。
- 涉及既有用户数据的改动（#179 迁移、#201 向量重建、F17 存量配置键）必须给迁移/回退说明，不能一改了之。

---

## §3 核查结论总表

图例：结论 ✅成立 / ⚠️部分成立；"PR"列 = 哪条 PR 含该修复（✅=修法经核正确）；批次见 §5。

| # | 标题（缩略） | P | 模块 | 前/后端 | 结论 | PR | 批次 |
|---|---|---|---|---|---|---|---|
| 178 | F01 折叠降级未归档即被护栏清空 | P1 | index.js compactLegacyLayer | 后端 | ✅ | #206 | A |
| 171 | BOM 语料校验过、正文错位提取 | P1 | m4-corpus.js | 后端 | ✅ | 无 | A |
| 172 | 落盘失败漏记健康度、feed 假成功 | P1 | hub-io.js + index.js | 后端 | ✅ | 无 | A |
| 183 | F07 supersede 先撤销后校验 | P1 | fact-store.js | 后端 | ✅ | #206 | A |
| 181 | F05 纠正归因全局最近+误伤他记忆 | P1 | context-host.js | 后端 | ✅ | #206 | A |
| 182 | F06/F31 日历 --:-- 不可解析+缓存覆盖 | P1 | index.js + migrate-pack.js | 后端 | ✅ | #206 | A |
| 184 | F02 调试中心挂载自动 POST 真端点 | P1 | client.js DebugCenter | 前端(手写区) | ✅ | #206 | A/D |
| 173 | 子代理 GC 漏导入 readdirSync | P2 | subagent-gc.js | 后端 | ✅ | 无 | A |
| 205 | F30 记忆迁移未 mkdir、失败仍切路径 | P2 | index.js saveConfig | 后端 | ✅ | #206* | A |
| 174 | 团队端到端接线缺失（4 分项+双编码） | P1 | team-* + client.js | 后端+前端 | ✅ | #209 | B |
| 185 | F08 TeamOutbox 未加载磁盘旧队列 | P2 | team-outbox.js | 后端 | ✅ | #209 | B |
| 170 | 发布过滤误删 lib/assets、lib/policies | P1 | tools/release.mjs | 后端 | ✅ | #208 | B |
| 177 | Tier-0 锚点切分错位（已机械复现） | P1 | tier0-catalog.js | 后端 | ✅ | #208 | B |
| 187 | F10 transfer-scope TDZ 读 pid | P2 | index.js 路由 | 后端 | ✅ | #206 | C |
| 188 | F11 存储管理路径字段不一致 | P2 | storage-manage.js | 后端 | ✅ | #206 | C |
| 198 | F22 更新路由 this.readTextSafe | P2 | index.js 路由 | 后端 | ✅ | #206 | C |
| 189 | F12 语义 rebuilding promise 串 corpus | P2 | semantic-js.js | 后端 | ✅ | #206 | C |
| 190 | F13 Tier 复用与投递 miv 域不同 | P2 | index.js tierCurrentMivPre | 后端 | ✅ | #206 | C |
| 191 | F14 expand 不扫 PLAN/账本（发现新 bug） | P2 | index.js expand | 后端 | ⚠️ | #206 | C |
| 192 | F15 stale-index 丢包仍投递 | P2 | activation-*.js | 后端 | ✅ | #206 | C |
| 193 | F16 硬溢出被阈值挡 / F17 preset 被预填遮蔽 | P1/P2 | index.js + client.js | 后端为主 | ✅ | #206 | C |
| 199 | F23 新安装 workbenchStatus 读 null.greetCount | P2 | index.js:10348 | 后端 | ✅ | #206 | C |
| 200 | F25 JSONL 跨块丢失+限额不停读 | P2 | index.js ExternalMemory | 后端 | ✅ | #206 | C |
| 202 | F27 GPU 偏好写配置但固定 CPU | P2 | m7_embedding_v1.py | 后端 | ✅ | #206 | C |
| 201 | F26 token 双重包装+满块截断丢 token | P2 | m7_embedding_v1.py | 后端 | ✅ | #206 | F |
| 203 | F28 sidecar 空正文重建倒排 | P2 | index.js + wb-sidecar.js | 后端 | ✅ | #206 | C |
| 186 | F09 全局简报装配/路径/分区接线不完整 | P2 | global-brief + index.js | 后端+前端2处 | ✅ | #206 | C/D |
| 204 | F29 反馈同步读错事件名字段 | P2 | .github report-sync.mjs | CI 脚本 | ✅ | #206 | C |
| 194 | F18 日文 7 个 __fn 键当函数调用 | P2 | client.js I18N | 前端(手写区) | ✅ | #206 修 1/7 | D |
| 196 | F20 皮肤切换不通知挂载根+setNonce 失联 | P2 | skins/iter5 + client.js | 前端 | ✅ | #206 | D |
| 197 | F21 Python 健康判定只认 ready | P2 | client.js 设置页 | 前端 | ✅ | #206 | D |
| 169 | normalizeGapRounds 作用域错误 | P2 | client.js + frozen | 前端 | ✅ | 无 | D |
| 195 | F19 白板全文永久缓存不失效 | P2 | client.js + wb-sidecar.js | 前+后端 | ✅ | #206 | D |
| 175 | 测试 \b39\b 命中时间戳假红 | P1 | smoke-test-issue162 | 测试 | ✅ | #208 | E |
| 176 | 测试夹具两处空转+异步提前计数 | P2 | 3 个 smoke 测试 | 测试 | ✅ | 无 | E |
| 179 | F03 工作区目录键折叠冲突 | P1 | wsKey/迁移 | 后端 | ✅ | #206 | F |
| 180 | F04 技能重载并集+消费不过滤 scope | P1 | procedure-store 等 | 后端 | ✅ | #206 | F |
| 164 | 共享白板多会话防覆盖（设计+实现） | P2 | wb/PLAN 写语义 | 后端 | ⚠️ | #209 机制 | F |
| 167 | 自动沉淀跨工作区写入与校验观察 | P2 | index.js consolidateTurn | 后端 | ⚠️ | 无 | G |
| 207 | 用户自建：测试机审计待改进项#0 | — | 多点 | 后端 | 对照项 | — | G |

\* #205 的 PR hunk 依赖 PR 新增基础设施（calendar-lock/workspace-key），不可单独移植，见条目。
另：#166（npm 包残留，2026-10-01）已由 11b6dba 修复关闭，不在本批范围。

---

## §4 PR 采纳总案

### 4-1 四条 PR 的关系

- **#209 ⊇ #206（严格超集，逐 hunk 机器比对确认）**：除 4 个文件（team-outbox.js 为 #209 更新版、两个冻结哈希测试各按自己最终文件计算、audit-data-safety 扩充）外，#206 的每个 hunk 都逐字出现在 #209 中。**只采纳 #206 没有任何独立价值。执行 agent 以 #209 为唯一基底。**
- **#208 是独立分支**（#170 资源恢复 + #177 Tier-0 切分 + 测试修复），#209 不包含它。其 84 个资源文件块对 wip **全部可丢弃**（经 git blob SHA 逐一比对，与 wip 现有 82+2 个资源完全同 blob——资源只在 main 线被误删过，wip 从未丢失）。对 wip 只移植：`tools/release.mjs` +3 行、`lib/tier0-catalog.js` hunk、3 个新 smoke 测试、2 个既有测试修复。
- **#168 是独立清理 PR**：24/26 文件经全仓 grep 验证为零引用或行为等价，可采纳，但**必须剔除 3 处**（见 4-4）。

### 4-2 #209 的 A/B/C 分级（横切面）

**A 级（建议按 hunk 采纳，低风险高价值，彼此独立可单独摘取）**：
F02 诊断只读化、F09 `engine.`→`this.` + ExternalMemory/global-brief 按工作区分桶、F10 authoritativeIds、F11 pathsOf、F12 并发重建 await 后重查、F14 expand 纳入 PLAN/账本、F15 claimedPacketId、F19 wbFullCache、F21 verified-ok、F22 engine.readTextSafe、F23 greetCount、F25 readline 抽取、F28 by_tag/by_cue + `Object.create(null)`、F29 report-sync、R03/R04/R05、R01/F30 saveConfig 加固、F31 日历事务 + `lib/calendar-lock.js` 本体。测试 harness 侧：`tests/lib/audit-engine.mjs`（16 行真夹具动态加载器，非假引擎）+ 10 个 audit-* 套件可整体随行。

**B 级（采纳但需改法/需拍板/需补配套）**：
- **F03 workspace-key v2 迁移**：设计 fail-closed 正确，但存量用户升级后旧桶不迁移（owner 文件升级前不可能存在）→ 记忆"看起来消失" + 每轮 must 优先级注入迁移告警。需用户拍板（见 §5 批次 F）。
- **F26/F27**：分块升级触发 Python 档全量重嵌入；发布说明必须量化代价。
- **F17**：实现正确，但已持久化 0.8/65536 的老配置保持旧值，要吃 preset 须删键——需发布说明。
- **#164 PLAN CAS**：模块质量高，但改了 memory_note 工具契约（expectedRevision 等新参数、PLAN 超 200KB 拒绝）并改写注入文案，建议整体采纳不摘半。
- **#174 团队接线**：修法正确；前端新增 5 秒共享轮询（破"零新增定时器"旧纪律，有卸载清理，可接受）；建议团队模式真机 QA。

**C 级（采纳时剔除）**：
- `docs/audit-20261002/*`、`docs/phase2-20261002/*`（33 个工作过程材料文件）——剔除或移入 internal，不进产品库根目录。
- `tests/lib/audit-engine.mjs` 的 `DAM_AUDIT_ENGINE_SOURCE` 环境变量后门——删除（全 PR 无使用）。
- F18 只修了 `hubScopeCounts` 1 个键——采纳时必须补齐其余 6 个 `__fn` 键（见 #194 条目），否则 issue 不可关闭。

**硬配对清单（摘 hunk 时前后端必须成组）**：
- 迁移 `previewToken` 改 fail-closed（index.js @@8432）⇒ client.js 三份拷贝（@@7106/12481/15561）必须同批；
- `/global-brief` 强制 sessionId ⇒ 前端 3 处取数（1 手写区 + 2 生成块内）必须同批，生成块部分须落 skins 源重建；
- 团队 `/team-state` 形状变更（member 从 describe() 换 currentMember()）⇒ 前后端 hunk 同批；
- `tierCurrentMivPre` 换域 ⇒ 必带 `smoke-test-t0-2-version-gate.mjs` 两行断言更新；
- 冻结哈希测试（iter5-skin、r26-E2/E3）⇒ 按最终文件重算。

### 4-3 #206/#209 测试改动的性质判定（深审结论）

- 约 85% 是模式化适配：workspaceKey 换键期望值改由同源函数计算（行为断言全保留）、抽取式沙箱补桩（新模块符号进入 bindMethod 名单）、源码守卫字符串跟进签名、路由计数 69→70、m73 chunk policy v1→v2。
- 实质放宽仅两处软点且均非"转绿"：migrate-pack S1b/S1c 字面量钉死改同源函数对比（同义反复风险，但 S1a 仍从宿主源码刮取保证两处同源）；issue162 `persisted` 断言翻转是配合"诊断 GET 只读化"的有意语义变更，且同 hunk 新增了 recall 路径仍落盘的断言（净效果断言变多）。
- 新增 16 个测试套件是真行为测试，质量高：真实多进程锁竞争、SIGKILL 死锁恢复、30 路并发归档唯一性、出站 JSON 只编码一次断言（直接抓到双编码 bug）。
- **结论：测试改动可信，随 hunk 一并采纳，但冻结哈希按最终字节重算。**

### 4-4 #168 剔除清单（其余可采纳）

| 剔除项 | 位置 | 理由 |
|---|---|---|
| `verifyArtifact` + createHash 导入删除 | lib/python-setup.js（-36） | 零调用属实，但它是 #105 设计的完整性门禁（编码"哈希必须回读落盘文件"教训），MODEL_SHA256 冻结那天要用；且其内部 createReadStream 未导入的 bug 恰证明"从未接线"而非"永不需要"。**更好的做法是接进 downloadModel 而不是删除。** |
| graph-mode F1 泳道投影测试删除 | smoke-test-graph-mode.mjs（-16） | 全仓唯一 deadend 行为门禁，实测**不重复**；删除后 F1 看板分类失去专门守卫（正是历史"22 断言全绿却丢 19 条"教训区域）。 |
| p9d 负向守卫删除 | smoke-test-p9d-recent-evidence-ts.mjs（-1） | 防错误口径在文件内复活的弱守卫，成本为零不值得删（软建议）。 |

### 4-5 CI/验证可信度

results.md/final-validation.md 的验证链算术自洽（244+3=247 精确吻合）、主动保留不利证据（间歇失败 250/4/0 未定性）、3 个基线 FAIL 逐项定位（其中 policy-parity/s2-skin 两个是 main 线缺资源所致，**wip 线预计消失**）。所有 run 基于 fork + main(LF) + Node 22.23.3，**对 wip 只能作参考基线：采纳后必须在 wip 全量重跑 smoke**。

---

## §5 逐条核查详录

> 每条格式：**结论 / 证据（当前树 file:line）/ 成因 / 后果 / 修复建议 / PR 评判 / 合并标注**。证据摘录从简，执行时按行号读原文件。

### 批次 A：P1 数据安全（后端为主，可大胆修）

---

#### A1. #178 [F01] 旧记忆折叠降级未完整归档即被容量护栏清空 — P1

- **结论**：✅成立。issue 内"归档失败仍清空"子句不成立（归档 throw 会中止整函数、主文件不覆盖）；真实丢档路径是"归档被跳过 + 护栏清空"。
- **证据**：`lib/index.js:6494-6501`（降级分支 while 循环只归档"被移出的前缀段"，余量直接切片不入归档）；`lib/index.js:6522-6526`（护栏清空 folded 后立即覆盖主文件）；`lib/index.js:7503-7505` rawDocStore 未传 backupDir ⇒ `lib/memory-writer.js:459` 恒不备份。触发面是出厂默认：`memoryAnchorEnabled: false`（:589）+ 折叠节流 10 分钟（:418/:6415）或子代理失败（:6539）。**单老段场景必然丢**（`rest.length > 1` 为假 → 零归档 → folded=整段原文 → 护栏清空）。
- **成因**：归档与切片耦合在 while 循环里，护栏清空 folded 时不知道它有无归档副本。
- **后果**：默认配置路径下用户级 MEMORY.md 与项目 notes 的旧段**永久丢失**（主文件/归档/备份三处皆无）。
- **修复**：`compactLegacyLayer` 把归档提到护栏**之前**且归档**全部** oldSegs（`oldText` 整体一次 `appendText`）；`folded` 降级值改 `oldText.slice(0, keepBudget)`；归档失败直接向上传播不走到 writeFull。可选加固：rawDocStore 传 backupDir。
- **PR**：#206 已修（@@ -6483,31 hunk），正确且最小，附 EEXIST 注入回归。**副作用**：user 层归档路径从 `dshHome()/memory/archived-user.md` 改为 `dirname(p.userFile)/archived-user.md`——自定义 userMemoryDir 的老用户旧归档成孤儿（不丢数据），发布说明提一句。
- **合并**：可整体采纳该 hunk。

---

#### A2. #171 #66 修复残留：BOM 语料校验通过，正文仍从原 buffer 错位提取 — P1（PR 未修）

- **结论**：✅成立（核查代理用真实模块运行复现：BOM+marker+`abcdef` → 提取出 `"->\nabc"`，中文尾部多字节被截成 U+FFFD；校验全绿零告警）。
- **证据**：`lib/m4-corpus.js:102`（#66 修复：校验坐标系剥 BOM 得 `body`）vs `lib/m4-corpus.js:118`（正文提取仍用含 BOM 的 `buf`）：`text: buf.toString('utf8', r.byteStart, …)`。偏移来源 `lib/memory-anchor.js:126,152-168`：byteStart/byteEnd 相对剥 BOM 的 `b`。
- **成因**：#66 只把校验面对齐剥 BOM 坐标系，漏了同一记录对象的 text 提取面。
- **后果**：带 UTF-8 BOM 的语料源（Windows 记事本编辑，`parseAnchors` 显式支持）→ `rec.text` 整体前错 3 字节，注入给模型的记忆正文损坏、词法命中失真；fail-open 无告警。不回写文件。
- **修复**：`lib/m4-corpus.js:118` `buf` 改 `body`（一行）。补端到端断言：BOM/无 BOM × ASCII/中文/emoji，`rec.text === body.slice(byteStart,byteEnd)`。
- **PR**：#206/#208/#209 均未触及。
- **合并**：一行修 + 测试，独立。

---

#### A3. #172 #110 批路径残留：落盘失败漏记健康度，feed 响应仍为 deferred 成功 — P1（PR 未修）

- **结论**：✅成立（注入 EACCES 运行复现：批 flush 后 `health.errors=0`、verdict=ok、HTTP 200，而本模块契约注释 :104 明言"失败不静默"）。
- **证据**：`lib/hub-io.js:114-122` `flushPendingPre` 的 catch 空（不 `notePre` 不 `onError`），且失败后 `pendingWrites.clear()` 丢弃本批待写；对照非批路径 :134-139（记 health + throw）。HTTP 面 `lib/index.js:15761-15777`：响应返回的是内存 ingest 结果，真实提交在外层 finally 的 endBatch；:15774 diag 指向的健康度台账恰是本路径不记的。另一调用点 `lib/index.js:13421-13439` 同病。
- **后果**：批末任一 atomicWrite 失败 ⇒ 本批落盘全丢（内存仍在，重启回退旧快照）+ 面板/健康度全盲 + HTTP 假成功。
- **修复**：`lib/hub-io.js:118` catch 改 `catch (e) { ok = false; notePre(health, rec.name, 'save', e, onError) }`（notePre 是模块内既有私有函数，零新依赖）；可选把本批失败计数并进 endBatch 返回值。勿波及非批 save/clear 的既有语义。
- **PR**：三条 PR 均未触及。
- **合并**：一行修 + 测试。

---

#### A4. #183 [F07] 事实 supersede 在新候选事实性校验前撤销旧事实 — P1

- **结论**：✅成立。
- **证据**：`lib/fact-store.js:542-559`：`supersede` 只做结构校验（:544 `validateFactCandidatePre` 纯结构），随后**先撤销（existing.revoked=true）再 upsert**；upsert 内 `looksFactCandidatePre(c)`（:442-451）拒问句形态返回 not-a-fact-statement，**无回滚路径**。`findSubjectPredicate` 过滤 `!f.revoked` ⇒ 旧事实立刻从查询消失；`persist()` 存 `includeRevoked:true` ⇒ 任意后续成功写入或 dispose 固化到 facts.json。
- **后果**：对已有 subject/predicate 提交"结构合法但事实性不通过"的 supersede（如问句 object）→ 旧有效事实静默消失并可固化。P1。
- **修复**：`supersede()` 在触碰 existing 之前先跑 `looksFactCandidatePre(c)`，不过则返回与 upsert 同形拒绝；防御性补充 upsert 失败回滚 revoked/revokedAt/统计。
- **PR**：#206 已修（:544 后插 `if (!looksFactCandidatePre(c).ok) return upsert(c)`，委托同一拒绝路径，诊断计数一致）。正确。残余窗口（factness 通过后 validateFactPre 失败）理论几乎不可能，可忽略。
- **合并**：采纳 hunk + 补一条回归（拒绝后内存/磁盘/统计均不变）。

---

#### A5. #181 [F05] 纠正对象从全局最近 read/cite 推断且可额外惩罚另一记忆 — P1

- **结论**：✅成立（两个子主张均实锤）。
- **证据**：`lib/context-host.js:66-96` `selectCorrectionAttributionPre` 按 kind+memoryId+5 分钟窗选"最近一条"，**无 sessionRef/workspaceRef 过滤**；事件存储是引擎级单例按日分片全量返回（evidence-store.js:157-216）⇒ 跨会话跨工作区。显式+隐式并存：:639-641 算显式 corrections 后 ：646-667 无条件再算隐式 attributed，:671 一并 persist；选择器执行时同批显式纠正尚未落盘，连 correctedRecently 去重都看不见。下游惩罚：`lib/memory-importance.js:63-68` correctionRate 拉低 importance，:7811-7816 进召回排序；:748-757 还喂 procedure addEvidence 阻断晋升。
- **后果**：会话 A 读 mem_A、5 分钟内 B（任意工作区）读 mem_B 后 A 发纠正语 → B 被记一条 correction，错误降低 mem_B 重要性并牵连相关技能晋升。显式+隐式可同时入账。
- **修复**：`emitTextEvidence()`（:646-670）①选择器前按 `sessionRef + workspaceRef` 过滤（投影字段已备齐）；②有显式 corrections 或文本含完整 mem_ token 时跳过隐式；③身份不可得 fail-closed 不归因。
- **PR**：#206 已修，三动作齐全（过滤 + 双保险 + 调用点注入 runtime.sessionId），字段与投影形状逐一核对无误。正确。
- **合并**：采纳 hunk。

---

#### A6. #182 [F06/F31] 共享日历无时间条目不可解析；旧会话缓存读改写可覆盖他人记录 — P1

- **结论**：✅成立（两个子项独立成立）。
- **证据**：F06a 写读不对称——`lib/index.js:14694` 工具 schema 明写 `time 可缺省`，写侧 `calendarAdd` :9010 输出 `--:--`，但解析 :8977 正则只认 `\d{1,2}:\d{2}` ⇒ `--:--` 行静默跳过，下一次任何日历写整篇覆写即物理删除该条目；**同款正则在 `lib/migrate-pack.js:392`（迁移导入也丢）**。F31b 三个写 API 都是缓存优先（`this.state.calendarText || readTextSafe(...)`，:9008/:9022/:9035），缓存只在 pre-step 超 15s 才刷新（:14224-14235），`writeFullRaw` :7509 是裸 writeFile——无锁无 CAS 非原子，CALENDAR.md 是用户级共享文件（migrate-pack.js:365 注释自证）。
- **后果**：合法调用即"写后即失"；多会话/多窗口常规交错即丢他人条目。均为静默数据丢失。P1。
- **修复**：①两处正则统一加 `|--:--`；②calendarAdd/Done/Remove 改"文件锁内读盘最新原文（不读 state 缓存）→ 单条修改 → 原子写回"，锁按日历物理路径规范化取；③`_applyUserFilesPre` 导入合并（:8349-8369）必须同锁；④tmp+rename 原子化。
- **PR**：#206 已修且对症：两处正则 + 新增 `lib/calendar-lock.js`（68 行跨进程锁）覆盖全部 4 个写入口 + `writeTextAtomicPre` 原子写。锁实现重点核过：单文件锁无死锁；canonical realpath 归一 symlink/大小写别名；死主恢复要求同机+PID 探活+inode 复核；`_calendarTransactionPre` 锁内路径变化先放锁再重试防自等死锁。**已文档化残留**：进程死在获取闸门窗口（亚毫秒）会留孤儿 `.lock.acquire`，实现故意不自动清 → 全部日历写超时直到人工删除（保守策略，将来可加 mtime 年龄兜底）；同机 PID 复用会把死主误判为活（标准限制）。附 8 进程并发零丢失 + SIGKILL 恢复测试。
- **合并**：照 PR 方案落地（calendar-lock.js 是 #164/#205 迁移的基础设施，多处长依赖它）。仅前向生效，历史被删条目不可恢复——发布说明提一句。

---

#### A7. #184 [F02] 调试中心挂载自动 POST 到可调用模型及写反思的真实业务端点 — P1

- **结论**：✅成立（前端挂载自动 POST、后端真实副作用、反思覆盖链全部复现）。
- **证据**：`lib/client.js:16299-16319`（**手写区**）：挂载即对 5 个端点发 POST，其中 **greet** → refresh + greetToday（缺缓存时真实模型调用 + 写 workbench.json 计数）；**workspaces** → 总览缓存过期时真实模型调用；**reflect-auto** → 无待反思日时回退最近日志日（:11390）生成"（待补充）"草稿并 `saveReflection` **无条件整篇覆盖** `reflections/<date>.md`（:8918）——已核触发条件：该日已有反思时**已完成的反思被草稿毁掉（数据损毁）**。recall/summarize 缺参 400 无副作用。补充发现：挂载那次 GET /debug 也非纯读（`_persistObservabilityPre` 每看一次落一次台账）。
- **成因**：把"端点探活"做成对业务端点发真实请求 + 挂载 effect 无条件执行；reflectAuto 兜底日期与 saveReflection 无守卫覆盖叠加。
- **修复**：前端（手写区直改，无需重建）：`refresh()` 收敛为单次 `fetch(API.debug)` 只读 GET。后端加固（可大胆）：`reflectAuto`（:11387）"无 pending、回退日期"分支加守卫——该日反思文件已存在则返回提示**不得自动覆盖**（不要在 saveReflection 上加全局禁止，memory_reflect 显式重写是合法用例）。
- **PR**：#206 已修：前端收敛为 1 个只读 GET + 后端 debugInfo 只读化（不 resolvePaths/不写台账，`memoryIndexSnapshot({readOnly:true})`），附真实挂载测试（文件系统前后快照断言零变化）。代价：API 探测表从 11 端点缩到 1（诊断覆盖变窄，可接受）。
- **合并**：client.js hunk 在手写区可直接移植；reflectAuto 覆盖守卫 PR 未做，**执行 agent 应补上**。

---

#### A8. #173 子代理 GC 漏导入 readdirSync，v4 日志漏扫并可能误用旧 mtime — P2（PR 未修）

- **结论**：✅成立（真实模块运行复现：仅含 `session.v4.jsonl.zstd` 的合法目录 → `no-file` 漏扫；v3+v4 并存 → mtime 取旧 v3；`node --check` 通过——纯运行时 ReferenceError）。
- **证据**：`lib/subagent-gc.js:22-23` 只 import `node:fs/promises`；:218-221 调同步 `readdirSync(dir)`，ReferenceError 被 `catch (_) { names = [] }` 吞成"目录读不到"，行为退回旧双名兜底。现有测试只构造 `session.jsonl.zstd`，恰好落在兜底名清单里把 bug 遮住。
- **后果**：每日巡检（index.js:11009）与 HTTP 预览（:15511）每次触发；**v4 命名会话 GC 整体失效**；v3/v4 并存时保留期按旧 v3 mtime 计算，**存在误回收近期活跃会话的风险**。
- **修复**：`lib/subagent-gc.js:22` 附近加 `import { readdirSync } from 'node:fs'`（一行全链修复）。补三例断言：仅 v4、旧 v3+新 v4、新文件在保留期。
- **PR**：未触及。
- **合并**：一行修 + 测试。

---

#### A9. #205 [F30] 用户记忆迁移到新目录未 mkdir，复制失败仍保存新路径 — P2

- **结论**：✅成立（两半均实锤：目标目录不建、逐文件 catch 吞错、n=0 也照样切真源并 refresh）。
- **证据**：`lib/index.js:2848-2858`（无 mkdir，对照 memoryRoot 分支 :2900 有 mkdir recursive；逐文件 `catch (e) {}`）；:2863-2866 迁移后无条件写配置；入口校验 :16290-16301 不要求目录存在。
- **后果**：用户记忆"突然清空"（旧文件仍在原处，切回即恢复，但无提示）；半迁移 + 假计数提示。
- **修复**：`saveConfig` userMemoryDir 分支：①复制前 `mkdir(newUser, {recursive:true})`；②逐文件失败上抛并把 config 回滚为迁移前快照（HTTP 已会把异常转 500）；③配置落盘走 `writeTextAtomicPre`（:97 已导入）成功才发布；④排除 lock/tmp 文件。
- **PR**：#206 已修且超出最低要求（mkdir+回滚+原子写+`_configSaveChain` 串行化+COPYFILE_EXCL+日历双端锁）。**但该 hunk 依赖 PR 新增的 calendar-lock/workspace-key/canonicalCalendarPath，不可独立移植**——若不整包采纳 #209，执行 agent 按上述最小子集独立实现，串行化/日历锁部分留给 R01/F31 一并处理。
- **合并**：与 R01（#82 配置原子写）、F31 同束。

---

### 批次 B：P1 功能接线

---

#### B1. #174 团队端到端接线缺失 — P1

- **结论**：✅成立（4 个分项 + 附加双编码全部逐点证实；另发现一处补充缺口）。
- **证据**（当前树）：
  1. `lib/index.js:12949` createTeamFetch **不传 engine/config** ⇒ `lib/team-auth.js:103-104` cfg 冻结 `{}` ⇒ :172-174 恒 `not-configured`，上行下行全阻。且 `saveConfig` 整体替换 config 对象（:2809），构造时捕获也会陈旧——**必须按请求读取**。
  2. `lib/index.js:12994` pull 定时器块检查 `engine._teamPull`，而 `createTeamPuller` 赋值在同 try 块约 100 行之后（:13096）⇒ 检查恒 undefined ⇒ **setInterval 永不注册**；全仓 `pullOnce` 有效调用点为 0。
  3. 前端 `lib/client.js:9188` 读 `st.team`，但 `/state` 响应（index.js:15934-15941）无 team 键；client.js 对 4 条专用团队路由（API.teamState 等）引用为 0 ⇒ 队列/冲突/归属恒空 + `teamPhaseOf`（:9424-9431）缺字段兜底返回 `'synced'` ⇒ **假"已同步"**。补充缺口：即便改读 `/team-state`，其 outbox 字段走 `st(engine._teamOutbox)`（index.js:15244）调 `status()` 方法——team-outbox.js 导出对象**没有 status() 方法**，恒 null。
  4. `lib/client.js:9320-9322` 正式 TeamTab 挂载硬编码 `items: []`、无任何回调；暂停/接手/复制诊断/重置游标四处 `if (props && props.onX)` 守卫全 undefined ⇒ **按钮可点但静默无操作**。
  5. 双编码：`lib/team-sync.js:142` `JSON.stringify(payload)` + `lib/team-auth.js:216` 再 `JSON.stringify(options.body)`。
- **成因**：团队线"模块逐批交付、装配层分批接线"的开发方式，四批交付后装配/前端接线欠账。
- **后果**：`teamEnabled: true` 用户：上行恒失败队列积压、下行定时器不存在、面板假数据假状态、四按钮空转。团队功能整体不可用（P1；默认关 + 无数据破坏故不到 P0）。
- **修复**：①:12949 补传 engine + team-auth 改按请求 `configOf()`；②定时器块整体移到 puller 构造之后，回调补 enabled/paused/disposed 防卫；③team-sync:142 改 `body: payload`，编码点唯一保留在 team-auth；④/team-state outbox 字段改 `{ size, lastError }`（或补 status()）；⑤前端最小侵入：团队层全部在 `lib/client.js:9177-9758` **手写区**（生成接缝之前）——`fetchTeamState`(:9203) 改读 4 条专用路由并映射回现有 teamFromState 形状；`teamPhaseOf` 兜底 `'synced'`→`'offline'`；TeamTab 接回调需后端新增 POST `/team-control`（pause / reset-cursor，loopback-only，两步确认），回调未就绪的按钮 disabled 而非静默 no-op。第二承载面 Iter5Team 消费同一组共享函数，修共享函数两处同修，**无需改 skins/**。
- **PR**：#209 已修，方向与实现基本正确（engine+configOf、定时器移位+epoch/pause 防卫、四路由真数据+完整性校验 fail-closed、/team-control、双编码修复）。副作用：useTeamTick 模块级 5s 定时器（破旧纪律，有清理）；完整性校验与路由形状强耦合（有意从严）。**可移植性**：4 个 team 模块 hunk 与 wip 逐字一致可干净 apply；index.js 团队段与 wip 吻合（偏移≤35 行）可定向移植。**但 PR 的 index.js/client.js 捆绑大量非团队 hunks——不可整 PR 合入，只摘团队 hunks**（若整包采纳 #209 则无此问题）。
- **合并**：与 #185 同束（同批装配段）；前端与 #196/#186 的前端传参同属 client.js 手写区/生成块改动，注意重建纪律。

---

#### B2. #185 [F08] TeamOutbox 首次 enqueue 前未加载磁盘旧队列 — P2

- **结论**：✅成立（源码链路与推导完全一致；createTeamOutbox 文件头明示"零 IO"，装配链无任何 load() 调用——全仓 grep 为 0）。
- **证据**：`lib/team-outbox.js:153-162` 队列从空开始；`lib/index.js:12972-12987` 装配链无 load；enqueue :252-273 与 flush :347-387 均无 load 前置，enqueue 的 `writeNowPre()` 把整份内存队列原子写盘。
- **后果**：重启后首次 enqueue 把 outbox.json 整份覆盖为空后新队列 ⇒ 旧队列**静默永久丢失**（当前因 #174 上行恒失败队列常态非空，触发概率高）。
- **修复**：①outbox 加 `loaded` 门，enqueue/flush 入口惰性 load（load 失败 ⇒ enqueue 拒绝、flush 返回结构化失败，**绝不以空队列覆盖旧文件**）；②装配处显式 `engine._teamOutbox.load()`。
- **PR**：#209 已修且更完整（loaded 门 + 显式 load + **write-ahead 出队**：先写候选队列再改内存，rename 失败双方队列保全 + persistError 上抛到 UI）。副作用：HTTP 成功但本地落盘失败会重发（at-least-once，PR 已如实声明）。team-outbox.js hunk 与 wip 逐字一致可干净移植。
- **合并**：与 #174 同束；回归用其 smoke-test（离线入队→重启→再入队断言 A/B 均保留）。

---

#### B3. #170 发布过滤递归误删 lib/assets、lib/policies — P1

- **结论**：✅成立（过滤器缺陷在 wip 现役代码原样存在；"文件被删"仅发生于 main 线——**wip 树 82+2 个资源完好**，git tree 哈希与 main 删除前父提交逐 blob 一致）。
- **证据**：`tools/release.mjs:77-87`：`readdirSync(REL/lib)` 一级条目**文件与目录混排**，`assets`/`policies` 无扩展名过不了 `DAM_LIB_KEEP_RE` ⇒ 与调试副本同走 `rmSync(recursive)`（核查代理逐行模拟输出 `DROPPED: ["assets","policies","client.js.GOOD-…"]`）。运行时真需要：`lib/index.js:13792-13799`（jsDecide 探 lib/policies 两个策略 JSON）、`:11617-11623`+`:14969-14992`（皮肤资源路由）、smoke-test-issue109-policy-parity:37 断言。无告警：release.mjs 对这两处全是 existsSync→continue 容忍式。
- **后果**：下次从 wip 发版必复发（HEAD 11b6dba 恰是引入此过滤器的提交）：npm 包内 84 个资源消失 → jsDecide 策略缺失静默 null、6 皮肤槽位 404、policy-parity 红。main 线 13f980 已实际发生（删 91 = 7 应删 + 84 误删）。
- **修复**：`tools/release.mjs:81-87` 循环体开头加 `if (statSync(path.join(REL,'lib',f)).isDirectory()) continue`（statSync 已导入）。wip **无需恢复任何文件**。可选加固：目录改显式白名单 `{assets,policies}`；发布门加"staging 必含 lib/policies/*.json 与 lib/assets 清单数一致"硬校验。
- **PR**：#208 已修（+3 行即上述），附真门禁测试（`DSH_AUTO_MEMORY_DEV` 夹具驱动真实 release.mjs --dry-run，断言 7 个调试副本仍删、资源存活）。**其 84 个资源文件块对 wip 全部可丢弃（与 wip blob 全同）**；只取 release.mjs hunk + 2 个 issue170 测试。#206/#209 未修此项。
- **合并**：后端 3 行 + 测试；与 #177（#208 的另一半）同批移植。

---

#### B4. #177 Tier-0 常驻目录锚点切分错位：标题与结论错配 — P1

- **结论**：✅成立（核查代理在当前树机械复现：3 锚点白板产出"每条 = (下一张卡的标题, 本卡正文)、末端无标题"，与 issue 的 0/13 配平完全吻合）。
- **证据**：`lib/tier0-catalog.js:180-189` 组区间取 `[锚点i后, 锚点i+1前)`，与书写惯例"标题在上、锚点紧随"（`lib/wb-contract.js:191-195` 契约强制）错半拍——本卡标题落在上一组尾部，`pickHeadingTitle`（:223-234）取组内最深标题必取到下一张卡的标题。
- **后果**：任何锚点制文档（白板/笔记/账本/外移档案同构受限）→ Tier-0 常驻目录**每条标题与结论错配**，接续会话按错误结论理解上下文，比没有目录更有害。
- **修复**：两端同时对齐（起点含本卡标题行、终点排除下一张卡标题行；issue 实测只改一端会被证伪）。仅改 `splitTier0UnitsPre` 一个函数内一块。
- **PR**：#208 已修，核查代理实跑验证 13 卡 LF/CRLF 全部 13/13 配平，裸锚点与无锚点文档不变量保持，附配套测试。tier0-catalog.js 与 wip 逐字节相同，hunk 直接套用；**移植时只取 tier0 hunk + issue177 测试，勿带 84 资源块**。小注意：空正文卡（仅标题+锚点）现在会产出仅标题的目录项（条数变化，属更正确）。
- **合并**：与 #170 同批（同一 PR）。

---

### 批次 C：P2 后端

---

#### C1. #187 [F10] transfer-scope 路由在 const pid 初始化前读取 pid（TDZ）— P2

- **结论**：✅成立（TDZ 用等价代码实测复现：`500 Cannot access 'pid' before initialization`）；次要主张"迁移成功后旧内存复活"亦成立，当前被 TDZ 掩盖，修好 TDZ 后才暴露。
- **证据**：`lib/index.js:15792/15794/15797` 三处读 `pid`，声明在同块 :15804 ⇒ 每次点击"提升为全局/收纳到工作区"（classic 与 iter5 UI 共 3 处调用点）必 500，**迁移从未开始**。次要：`io.migrate` 成功改盘后 `rehydrateProcedureScopes` 的并集是"内存赢"（:6110-6119）⇒ 重载时磁盘新 scope 被内存旧副本覆盖，下次 persist 写回旧库。
- **修复**：const pid 声明移到分支前；**务必连同 `rehydrateProcedureScopes(opts)` 加 `authoritativeIds` 参数一起上**（迁移成功时该 pid 磁盘优先）——只修 TDZ 会把第二个 bug 放大成"显示成功但悄悄回退"。
- **PR**：#206 已修且两件事都做了，附 route 200 断言。小瑕疵：migrate 部分失败时 authoritativeIds 为空（边缘残留）；顺带删了一个 no-data 早退（无害）。
- **合并**：两处 index.js hunk 一起采纳。

---

#### C2. #188 [F11] 存储管理宿主路径字段与 manager 接口不一致 — P2

- **结论**：✅成立。
- **证据**：宿主 `pathsOf`（index.js:13332-13337）只给契约名 `workspaceMemoryPath/todayLogPath`，而 `lib/storage-manage.js:51-52` 读 state 风格 `p.notesPath/p.logPath` ⇒ 恒 undefined；`buildSourceCatalog` 对 falsy 路径静默跳过（m4-corpus.js:42-44）⇒ catalog 只剩 user 源。删除白名单基于 sources（:15891-15894）⇒ 删项目笔记/今日日志条目被 403。m85 测试夹具同时喂两套名字掩盖了断裂。
- **后果**：健康扫描/修复只覆盖用户级 MEMORY.md；删除工作区条目被拒。面板不报错只空缺。
- **修复**：**二选一，勿两边都改**。推荐：改 `lib/storage-manage.js` catalogFor 读契约名（与全仓其余 buildSourceCatalog 调用点一致），并把 m85 夹具收敛为一套；最小侵入替代：改宿主 pathsOf 键名（PR 方案，功能正确但与契约反向偏离，未来复发风险）。
- **PR**：#206 采了后者（改宿主），功能正确有测试。执行 agent 若选推荐方案则丢弃该 hunk。
- **合并**：独立。

---

#### C3. #198 [F22] 更新安装结果读取版本调用了路由 this.readTextSafe — P2

- **结论**：✅成立（handler 是箭头函数，词法 this 不是引擎；TypeError 被内层 catch 吞 ⇒ `landed` 恒空）。
- **证据**：`lib/index.js:16219-16221`（handler 定义于 :16196 箭头函数）。`readTextSafe` 是引擎原型方法（:5974）。
- **后果**：一键更新安装成功却报"未检测到已安装的包版本"（want 已知时）；want 解析失败时核验整段被静默绕过。低频、无数据风险。
- **修复**：改 `await engine.readTextSafe(...)`（engine 同 handler :16201 已在用）。可选：核验失败与安装失败分开显示。
- **PR**：#206 已修，单行正确，附源码级断言。
- **合并**：直接采纳。

---

#### C4. #189 [F12] 语义索引全局 rebuilding promise 合并不同 corpus 请求 — P2

- **结论**：✅成立。
- **证据**：`lib/semantic-js.js:373-375` `if (rebuilding) return rebuilding`——并发第二请求无条件 join 别人的构建且 join 后**不重查自身 miv**；rank()（:498-510）末尾 `return { miv, scores }` 用调用方 miv ⇒ B 拿 A 语料 entries 却标 B 的 miv。多语料并发入口真实存在（recall 侧 :7774 现场造 miv、context-host :361/:556、:7994——同工作区内 miv 也不一致，碰撞窗口不小）。
- **后果**：B 的语义臂整轮拿 A 语料分：查不到分（漏召回）或按 A 快照文本错配评分。自愈、无崩溃、无跨工作区正文泄漏。P2。
- **修复**：`buildIndexIfStale` 改 `if (rebuilding) { await rebuilding; return buildIndexIfStale(miv, records) }`；建议 rank() 加防御 `if (!built || built.miv !== miv) return { miv, scores: new Map() }`。与 C2 增量池无冲突（byHash 池按内容 hash 复用，代价极小）。
- **PR**：#206 已修（await+递归重查），正确。未做结果身份校验（安全性等价，建议按修复建议补纵深）。hunk 与 wip 逐字一致，干净移植。
- **合并**：独立；建议补 rank 侧 miv 校验。

---

#### C5. #190 [F13] Tier 注入复用与投递索引使用不同 miv 算法域 — P2

- **结论**：✅成立。
- **证据**：消费侧自造第二种 miv：`lib/index.js:6695,6702` `'idx_pre_' + sha256('tier-miv\0' + 路径=stat指纹)`；投递侧用 CorpusRegistry 同域 miv（activation-host.js:112-121）。严格相等门 `lib/tier-layer-inject.js:271` `if (curMiv !== projMiv) return no('miv-changed')`——两个哈希域**永不相等**。
- **后果**：Tier1/2 下探复用在生产上**从未生效**（fail closed 安全侧，但"省 token 的关键机制"整体死掉，每轮记一条降级）。
- **修复**：`tierCurrentMivPre()`（:6685-6706）改 CorpusRegistry 同域 miv（registry 自带 stat 缓存，"零重读"保留），失败返回 null；同时 :6771 `workspaceKey: s.ws` 改 `canonicalize(s.ws)`（投影侧存 canonical，否则 Windows 路径假 mismatch）。同步更新 `smoke-test-t0-2-version-gate.mjs:158-159`。
- **PR**：#206 已修，与上述建议逐字相同，带测试更新。副作用仅诊断值换域。所需符号 wip 均已导入；**index.js 整体漂移大，须逐 hunk 手工移植**（或整包检出）。
- **合并**：hunk + 必带测试更新。

---

#### C6. #191 [F14] 召回提供 PLAN 与最新账本的 ID，但 expand 未扫描这些来源 — P2（⚠️部分成立 + 新发现 bug）

- **结论**：⚠️部分成立——expand 遗漏两来源、PLAN 命中无法展开**成立**；偏差：账本一半在当前树**连召回都进不去**，因为存在一个 issue 没点名的新 bug。
- **证据**：`lib/index.js:8049-8052` expand 只扫四类来源（无 planPath、无 handoffDir 账本）；召回侧 :7881 教模型用 expand。**新发现**：`latestLedgerNamePre` 是模块级函数（:12638），但 :7755 与 :8016 写成 `await this.latestLedgerNamePre(p.handoffDir)` ⇒ TypeError 被 catch {} 吞掉 ⇒ **最新账本静默缺席召回**（L0 与语义臂同病）。PLAN.md 由 applyAnchorsPre 写锚点（:3231），mem_ id 确实进召回。
- **后果**：召回契约断裂（PLAN 腿 expand 不到"未找到"；账本腿整个静默缺席）。诊断不可见。P2。
- **修复**：①:7755/:8016 去掉 `this.`；②expand 在 reflections 后追加 planPath 与最新账本两来源（handoffEnabled 闸门与召回侧同源）。parseAnchors 对任意 buffer 生效，路径全部来自 resolvePaths，边界不变。
- **PR**：#206 已修，两件事都做了 + 回归守卫（断言源码无 `await this.latestLedgerNamePre(`）。方向与最小性都对；账本从此进召回属覆盖扩大（正向）。两个 hunk 老侧与 wip 逐字一致。
- **合并**：逐 hunk 移植；修后跑 three-layer / retrieval-isolation smoke。

---

#### C7. #192 [F15] 激活包因 stale-index 丢弃后仍可能保留 claimed 并投递 — P2

- **结论**：✅成立。
- **证据**：`lib/activation-inbox-state.js:48-52` dropPending 只清 pending 不动 claimedPacketId；:142-146 stale-index 拒绝时只 dropPending；`lib/activation-host.js:434-440` claim 失败**无条件**保留 st.claimed（注释明言保 eager pump）；:455-464 渲染即投递，markDelivered 只比 ID 不复查索引 ⇒ 已判死的包照常进 messages 并建 seen。对照 purgeMemory（:536-557）只覆盖"记忆被删除"级联，不覆盖索引版本变更——证明是遗漏非设计。
- **后果**：claim/pump 后渲染前索引或 context 版本变化 ⇒ 旧正文进提示词并生成 seen 证据（污染召回语义、违反 precision-first）。
- **修复**：①inbox dropPending 内补 `claimedPacketId = null`；②host claim 失败分支：reason 为 stale-index/stale-context/expired 或 st.claimed.packet.deliveryState 已是 dropped/expired 时置 st.claimed=null，其余维持现状保 eager pump。
- **PR**：#206 已修且与上述建议逐字对应。正确、最小，latest-wins 场景语义正确。两文件与当前树逐字节相同，patch 零漂移。
- **合并**：两个 hunk 直接采纳，无前端牵连。

---

#### C8. #193 [F16/F17] 硬溢出被普通接续阈值阻挡；preset 自适应被预填默认值遮蔽 — P1/P2

- **结论**：✅成立（F16 P1；F17 P2，根因在**宿主侧 DEFAULT_CONFIG 预填**，前端预填只是次要同病）。
- **证据**：F16——`lib/index.js:4458-4461` 硬信号只把 ratio 抬到动态阈值（armRatio=max(ratio,threshold)≈0.4954），但 arm 门 :4783 只认固定 `autoContinueThreshold`（0.75）且 **hard 不豁免** ⇒ 硬溢出 ratio≈0.666 < 0.75 → 不 arm；且硬事件一次性消费（:4424-4431 lastOverflowSeen 与 arm 成败无关）⇒ 被冷却挡掉一次就不再重放。F17——`DEFAULT_CONFIG`（:654-656）预填 `officialCompactionRatio: 0.8`、`officialHeadroomTokens: 65536` ⇒ 合法性门恒真 ⇒ preset 自适应扫描（:4292-4316，全仓唯一调用点 :4269）**永不执行**。前端同病：`lib/client.js:12092-12094`（另有 :15179、:17952 两份同构拷贝）headroom 输入 `Math.max(0, Number(v) || 65536)` ⇒ 显式 0 无法保存；显示层恒显示 0.8。
- **后果**：F16——reservedTokens 大的路由下溢出/硬墙时自动接续永不触发，恰是要防的 400 事故场景（P1）；F17——动态阈值系统性偏高，提示/账本/接续全部偏晚（P2）。
- **修复**：F16——:4783 改 `if (!wl.hard && !(wl.ratio >= …)) return`（一行；开关/冷却/闩锁各门保持）；F17——DEFAULT_CONFIG 两键改 `undefined`（缺失=跟随 preset，:4274-4275 回落链已能兜底）；前端三份拷贝的 onChange 改为"空串/非法值才回退 65536"（最小侵入，不动布局）。
- **PR**：#206 已修（F16 一行 + F17 两键 undefined + client 三处 onChange）。**两个残留**（results.md 自己承认）：①存量配置已持久化的 0.8/65536 无法与显式设置区分，preset 仍被遮蔽，需手动删键或写迁移提示；②硬事件被安全门挡下时仍一次性消费不重放——建议追加小单跟踪。
- **合并**：采纳；前端三处改动是同构表达式替换，最低风险。

---

#### C9. #199 [F23] 新安装 workbenchStatus 对 null 状态直接读 greetCount — P2

- **结论**：✅成立（当前树未修；用户 #207 本地修未入库，git log -S 全史无该串）。
- **证据**：`lib/index.js:9622-9624` `_readWorkbench` 无状态文件时返回 null；:10348 `greetCount: Number(st.greetCount) || 0` 裸读——**紧邻 :10349 却有 `st && st.gen` 守卫**，:10371 `state: st || null`，唯独这行漏。路由 :16548 在 try 内 ⇒ 500 ⇒ 客户端启动/聚焦路径静默跳过"建议建立工作台"。
- **后果**：全新安装启动期状态接口 500，提示静默缺席（欢迎向导仍可补救）。
- **修复**：`greetCount: Number(st && st.greetCount) || 0`（单行）。**红线：不得改 `_readWorkbench` 返回 `{}`**（未建判据依赖 null 语义）。
- **PR**：#206 已修，与用户本地修法逐字一致，未触碰读取端。正确。
- **合并**：后端单行，零风险。

---

#### C10. #200 [F25] 外部 JSONL 按流块 split 丢跨块记录且限额不停止外层读取 — P2

- **结论**：✅成立（两个子断言均实锤）。
- **证据**：`lib/index.js:11744-11757` `extractSessionText`：64KiB chunk `split('\n')` 无 carry 残片拼接 ⇒ 跨块记录两半 JSON.parse 都失败同丢（:12819）；预算 break 只退内层 for，外层 for await 继续读到 EOF。唯一调用方 :12027（memory_recall 检索）。
- **后果**：长会话 JSONL 检索静默漏检 + 达限后白读数百 MB。
- **修复**：重写为 `createInterface({ input: stream, crlfDelay: Infinity })` 逐行流解析；达限 break 后 finally 里 `reader.close(); stream.destroy()`；防御 maxLines/maxChars<=0 短路。
- **PR**：#206 已修（readline 重写 + import），与建议一致，自包含可移植。残余限制：单条超巨行仍整行缓冲（行式解析固有代价）。
- **合并**：hunk + readline import 一起取。

---

#### C11. #202 [F27] GPU 偏好写入配置但 ONNX provider 固定 CPU — P2

- **结论**：✅成立。
- **证据**：`python/m7_embedding_v1.py:260-262` `providers=['CPUExecutionProvider']` 硬编码；写偏好侧 `lib/python-setup.js:216-233` 装 onnxruntime-gpu 并 `patchEmbeddingConfig({gpu: wantGpu})`，注释（:232）声称 worker 会读——**Python 侧从未实现**。配置确实到达 embedder（worker_semantic_v1.py:1317-1334 → :205 → m7:345-346），`config.get('gpu')` 被无视。
- **后果**：CUDA 机器选 GPU 安装却永远 CPU 推理（白承担安装体积/驱动要求）；纯性能，无正确性损害。
- **修复**：`BgeM3OnnxInt8Embedder.__init__` 读 `config.get('gpu')`；建议再稳一步——`ort.get_available_providers()` 预检 + 回退时记录实际 provider（满足 issue 验收后半句）。
- **PR**：#206 已修（CUDA→CPU provider 链两行），方向正确；未做可用性预检/实际 provider 日志（建议补）。**注意：同一文件 PR 还捎带 F26（#201）的 CHUNK_POLICY_VERSION v1→v2，移植本项必须只取 provider 两行，勿整块搬（会连带变更向量身份触发全量重建）**。另知会：CUDA↔CPU 切换数值有 ~1e-3 差异，增量池会混用两种设备的向量（可接受，严格起见可把设备折进 configHash）。
- **合并**：2 行 provider 改动 + 预检日志；勿带同文件 F26 hunks。

---

#### C12. #201 [F26] Python 文档 token 双重特殊包装与满块截断丢 token — P2 → **批次 F 决策项**

- **结论**：✅成立（三项主张全实核：语料双重包装 `[s][s] body [/s][/s]`、语料/查询模板不一致、满块尾 token 永久不进向量；无崩溃风险）。
- **证据**：`python/worker_semantic_v1.py:336/:359`（build_doc_ids → encode_ids 串联，两层都各自包装）；`python/m7_embedding_v1.py:164-170`（预算裁剪）+ :179-180（encode_ids 再包一层）；:90,99-100 分块 512 边界与 specials 预算不共享。fp32/int8 孪生同病。
- **后果**：仅真实 Python 提供器用户（`pythonBackendEnabled` 默认 false，JS 档零影响）：检索排序质量受损（量级小）。
- **修复**：①`encode_ids` 独占包装，`build_doc_ids` 返回裸 body（fp32/int8 两处同改）；②`CHUNK_MAX_TOKENS` 512→510（与 specials 预算共用常量）；③**必须**升 `CHUNK_POLICY_VERSION` v1→v2（不升会新旧向量混池，违反模块 fail-closed 契约）。
- **PR**：#206 已修且方案一致，附完整 smoke（chunker≤510、零丢失、包装正确、版本 v2）。**代价披露核查：PR 未向用户量化——升级后 Python 档既有向量全量判 stale，下次 commit 全量重嵌（BGE-M3 CPU 可达分钟级），重建前语义检索拒绝服务；JS 默认档零影响（C2 增量池是 JS 私有，与 Python 分块无共享）。`python/bench/` 5 处调用基线数字会漂移。** 需用户拍板（批次 F）+ 发布说明量化。
- **合并**：与 #202 同文件但 hunk 必须分开取舍。

---

#### C13. #203 [F28] 白板 sidecar 更新用空正文重建倒排但只恢复 entries — P2

- **结论**：✅成立。
- **证据**：`lib/index.js:3346-3350`：`rebuildSidecarIndexPre(..., text: '', ...)` 后仅 `fresh.entries = entries`——但倒排恰由 text 派生（wb-sidecar.js:346,354），`src=''` 时 cues=[]、行内 tag 全丢；:532-533 by_tag/by_cue 由空壳条目算出。消费面：tag 地图注入（:3474）、searchHandoffCorpus 结构化臂（:3835-3841）、memory_trace。
- **后果**：每次增量写（每次 memory_note kind=plan/handoff 后）by_cue 清空、by_tag 只剩标题 tag，直到下一次全量重建才自愈。有词法兜底非全废。P2。
- **修复**：`fresh.entries = entries` 后补 `fresh.by_tag = buildByTagPre(entries); fresh.by_cue = buildByCuePre(entries)`（两函数已导出）；顺手两处倒排字典改 `Object.create(null)`（tag 键 constructor/__proto__ 是合法输入，防原型链污染）。
- **PR**：#206 已修，正是上述两行 + Object.create(null) + 断言。#209 额外加 sourceRevisions 与失败显式返回。可移植。
- **合并**：与 #195 同批（同域不同层）。

---

#### C14. #186 [F09] 全局动态简报宿主装配、路径和会话分区接线不完整 — P2

- **结论**：✅成立（五个子项全部逐字复现）。
- **证据**：
  1. `lib/index.js:7215-7235` renderMemoryDynamic 团队注入段引用未绑定的 `engine` ⇒ 运行时 ReferenceError 被 :7235 吞 ⇒ **团队注入段与全局简报段双双死代码**（简报 try 还嵌在团队 try 内）。
  2. 自写豁免（`_selfWrites/_noteSelfWritePre/_isSelfWritePre`，:13150-13186）只安装在团队初始化的 **catch** 内 ⇒ 团队关闭（默认）或初始化成功时永不安装，只有失败才装——**逻辑完全倒置**，自写必被误报为"其他 Agent 改动"。
  3. 检测目录硬编码 `homeDir/.dsh/memory` + 第三种桶名算法（:11785-11887 `replace(/[:\\\/]+/g,'-')`）⇒ 与权威 `wsKey` 对 `D:\…` 100% 失配 ⇒ **Windows 下工作区记忆文件全漏扫**；自定义 memoryRoot/DSH_HOME 全被忽略。:16453 路由同病。
  4. 面板路由（:16439-16471）不带会话身份 ⇒ 恒 default runtime，面板与实际注入内容不一致。
  5. 水位单文件 global-brief.json + 单槽 `_briefWatermark/_briefSnapshot` + ExternalMemory 单槽 cache/_scanning（TTL 180s）⇒ A/B 工作区切换或并行时指纹串桶（成批假"新增/删除"）。
- **后果**：`globalBriefEnabled` 默认 true ⇒ 默认开启的新功能结构上不可用且产出错误信息（误报自写、漏扫、串数据）。P2。
- **修复**：①`engine.` 全改 `this.` 并把简报 try 拆平级（顺带救活 B7 团队注入段）；②豁免块移出 catch 到 apply 顶层；③检测器改 `engine.projectDirOf(ws)` / `engine.userDirOf()`；④路由强制 `?sessionId=` + `withAgent`（前端 3 处传参：client.js:8453 手写区直改；:11155 生成块 A 源=**skins/legacy/iter5-325.js.frozen**；:13541 生成块 B 源=**skins/iter5/views.js:187**——后两处必须落 skins 源重建）；⑤水位/快照/缓存改按 wsKey 分桶 Map。
- **PR**：#206 已修，五子项全覆盖修法正确，附 host-wiring/global-brief/review-regressions 测试。风险：路由缺 sessionId 恒 400（旧脚本/旧前端会破，同仓同发无碍）；旧全局 global-brief.json 成孤儿（首轮重建基线，无数据丢失）。**client 的 2 处生成块改动移植时须落 skins 源重建，不能只打 client.js。**
- **合并**：与 #174 前端传参同属生成块改动，同一次重建覆盖。

---

#### C15. #204 [F29] 反馈状态同步从事件 JSON 读 event_name 而 Actions 通过环境变量提供 — P2

- **结论**：✅成立。
- **证据**：`.github/scripts/report-sync.mjs:40/:51/:62` 读 `ev.event_name`——GitHub 事件载荷不含该字段，事件名只在 `GITHUB_EVENT_NAME` 环境变量；同目录 group-digest.mjs:92 有正确先例。workflow 也未注入该名 env。
- **后果**：所有事件恒落 else 分支 ⇒ "收到/处理中/完毕"反馈闭环**从未工作过**且 Actions 显绿，完全静默。
- **修复**：三处改 `process.env.GITHUB_EVENT_NAME`（无需改 yml）；`ev.action` 保留从载荷读。
- **PR**：#206 已修，附 mock 测试。
- **合并**：直接采纳（3 行）。

---

### 批次 D：前端（最小侵入；每条标注归属）

---

#### D1. #194 [F18] 日文 hubScopeCounts 是序列化对象却被当函数调用 — P2（PR 只修 1/7）

- **结论**：✅成立，且**问题面比 issue 主张更大——ja 共 7 个函数键全部如此**。
- **证据**：`lib/client.js:1201-1204`（I18N.ja，手写区）：`"hubScopeCounts": { "__fn": true, "src": "function (g, w) {…}" }`——PR #143 带入的 JSON 字面量，函数键被序列化成占位对象，全文件无还原逻辑。`t()`（:2464）无类型甄别直接返回真值对象，不回落 zh。三处调用点当函数调：:6868（手写区）、:12704（legacy 生成块，源 frozen:2102）、:15748（iter5 生成块，源自手写 MemoryHubTab 抽取）。**其余 6 键**：hubEvLine(:1184)、hubScopeReasons(:1210)、hubWhyCorrectionRate(:1229)、hubWhyDiversity(:1233)、hubWhyHasCorrection(:1237)、hubWhySuccess(:1246)。
- **后果**：locale=ja + 打开记忆中枢/技能页 ⇒ `t('hubScopeCounts')(...)` 抛 TypeError；**真 React 无外层错误边界 ⇒ classic 档整根白屏**；v4 档 DamSkinV4Boundary 的 fallback 内同数据二次抛错仍卸载整根。hubScopeReasons 在 Promise then/catch 里调用 ⇒ 丢转移反馈 + unhandled rejection。仅 ja 触发。
- **修复**（全部**手写区**，直接改 client.js，无需重建——字典只定义一次，生成块只复制调用点）：①把 :938-1551 内 7 个 `__fn` 条目还原为真实函数字面量（`src` 字符串里就是现成代码，去包装即可；**严禁 new Function 动态 eval**）；②可选加固 1 行：`t()` 跳过 `__fn` 对象让其回落 zh。
- **PR**：#206（及 #209）**只修了 hubScopeCounts 1 个键**（client.js @@1198 hunk），其余 6 键依旧会崩——**采纳时必须补齐，否则 issue 不可关闭**。
- **合并**：独立；修后 ja 语言过一遍记忆中枢/技能页。

---

#### D2. #196 [F20] 切换皮肤家族未通知挂载根，部分回调调用不存在的 setNonce — P2

- **结论**：✅成立（两个子主张双实锤）。
- **证据**：`skins/iter5/style-choice.js:14-24`（生成块源）：`iter5SetStyle` 只广播样式监听器，**家族分派点** `lib/client.js:16097-16104`（手写区 MemoryPageView，全仓唯一）读 localStorage 但**没人通知它重渲染**（:16038 只订阅 controller）。setNonce 失联：三处 `onSwitch: function(){ try { setNonce(...) } catch(ePick){} }`——:12319（legacy 生成块，源 frozen:1717）、:15406（iter5 生成块，源=手写 SettingsPage:18179）、:18179（手写区）——两个生成块内**均无 setNonce 定义**（它只存在于 MemoryPageView/MemoryPanelFloat 组件局部）⇒ ReferenceError 被吞。
- **后果**：切换皮肤家族时存储与 CSS 偏好已落盘，但挂载的组件树不切换，要等下一次无关 tick 或重载；SkinPicker 高亮停留旧值。可恢复，不丢数据。P2。
- **修复**（**源+产物成对，严禁统一状态源式重构**）：①`skins/iter5/style-choice.js` 的 iter5SetStyle 末尾加 `try { window.dispatchEvent(new Event('dam-skin-changed')) } catch(eSkin){}` → **改源后跑生成器**；②手写区 MemoryPageView（:16034 后）加 useEffect 订阅 dam-skin-changed → setNonce bump（MemoryPanelFloat :16133 可选）；③三处无效 onSwitch：手写 :18179 直改；frozen:1717 改源；改完重建一次覆盖两个生成块。勿动三键互斥双写语义。
- **PR**：#206 已修且修法正确（dispatchEvent + 两挂载根订阅 + 三处 onSwitch 无害化 + frozen 源同步 + 共享 CSS 重同步），源与产物一致。副作用小：变体→变体切换也整页重挂载（略重但语义一致）。
- **合并**：移植必须源+产物成对；与 #186 生成块改动同一次重建。

---

#### D3. #197 [F21] 设置页 Python 健康判定只认 ready 而后端产出 verified-ok — P2

- **结论**：✅成立（后端枚举 `verified-ok / ready-unverified / start-failed / deps-failed / no-files`（index.js:13926-13932 注释即权威），全后端**无任何路径产出裸 'ready'**；前端白名单三份逐字副本 `rt.state === 'ready'`）。
- **证据**：`lib/client.js:11842`（legacy 生成块，源 frozen:1240）、:14929（iter5 生成块，源=手写 SettingsPage）、:17699（手写区）——差集 = {verified-ok, ready-unverified, no-files} 全部误判。同页环境检测面板（:11883-11935）已按三态正确映射——即 2026-09-30 三态改造只漏了 gate-readout 这一行。
- **后果**：Python 引擎真实可用时诊断读数行自相矛盾（读数行"不可用"、检测面板"✓ 已实测启动"），误导重复安装/排障。纯显示。
- **修复**：改 `(rt.state === 'verified-ok' || rt.state === 'ready') && rt.depsOk !== false`（保留 'ready' 兼容旧缓存 payload）。四处成组：:17699 手写区直改；frozen:1240 改源；重建一次覆盖 :11842/:14929。**严禁只改 client.js 产物行。**
- **PR**：#206 已修，四处全部命中（client 三个 hunk + frozen），公式同上向后兼容。ready-unverified 计为不可用符合 issue 自己的验收。
- **合并**：四处必须成组落地；漏 frozen 必被下次重建回退。

---

#### D4. #169 normalizeGapRounds 作用域错误，快照与精简节奏设置修改时失败 — P2（PR 未修）

- **结论**：✅成立（括号深度扫描实核：唯一定义嵌在 `damSkinCssText`（client.js:9948，闭合于 :10072）内 :9957-9963；调用点在 :12074-12075、:15159-15162、:17932-17935——全部位于定义闭合**之后的其他作用域**，词法不可达 ⇒ onChange 触发即 ReferenceError，`set` 因实参求值在前而永不执行。属"不同函数作用域未定义"，非 TDZ。）
- **同源扩散**：`skins/legacy/iter5-325.js.frozen:1472-1473` 同调用且该文件无定义；生成器从 `function SettingsPage() {` 起整块切片改名 Iter5Settings，不会把外部 helper 带进作用域。
- **成因**：v3.2.6（6b9b22a）做 #160-7 修复时把 helper 放进了当时正在编辑的 CSS 文本函数局部作用域。
- **后果**：DSH 设置→记忆设置→进阶选项，修改快照节奏/精简节奏 3 个字段 × 3 处实现 + legacy 冻结皮肤 2 处 ⇒ **改不动**（值不保存、脏标记不动），用户以为改成功。打开设置页不白屏（仅 onChange 路径）。
- **修复**（前端最小侵入）：把 :9957-9963 的 7 行 helper **上移到与 damSkinCssText/Iter5Settings/SettingsPage 同层的共享位置**（如 :9948 之前），原嵌套定义删除——一处移动三种实现同修，逻辑零改动。frozen 皮肤同理在其 Iter5Settings 作用域内注入同一 helper。修后跑生成器 --check + 皮肤 smoke（s2/iter5/r21-23 系），并按 #160-7 语义验证 0 是合法值。
- **PR**：#206/#208/#209 均未触及。
- **合并**：独立；**严禁顺手重构三处设置实现**。

---

#### D5. #195 [F19] 白板全文永久按卡片 ID 缓存，内容更新和失败均不失效 — P2

- **结论**：✅成立。
- **证据**：`lib/client.js:4651`（**手写区**）`var wbFullCache = {}`；:4658 命中即不重取；:4664-4667 **失败也当成功缓存**（后端失败返回 HTTP 200 + ok:false）+ .catch 也缓存空串 ⇒ 此后永不重试；刷新按钮（:5475）与看板 effect（:5415-5419）均不清缓存；ID 不含正文版本（wb-sidecar.js:291/:78-82 id=sha256(ws+rel+标题)）。
- **后果**：改同标题小节正文 → 刷新 → 再展开显示旧全文；首次读取失败该卡此后只能显示 preview 直到整页刷新。两个消费点（看板展开卡 :4701、详情抽屉 :4689）。无数据丢失。legacy 档无此问题（frozen 无 wbFullCache）。
- **修复**：只改 `useCardFull`（:4651-4671，手写区直改，无需跑生成器）：①缓存键加版本维度——最优是后端 wb-sidecar.js 卡片加 `revision=sha256(body)`，前端键改 `[sessionId, id, revision, …]`；②ok:false/异常不写缓存；③缓存加上限。
- **PR**：#206（及 #209）已修，修法正确（后端三处卡片加 revision + 前端键含 revision/mtime/ts/fullLen/preview/body、仅非空才缓存、上限 256 满则清空、catch 不缓存）。client.js hunk 需按 wip 现场重生成（CRLF）。
- **合并**：与 #203 同批；前端部分手写区直改。

---

### 批次 E：测试

---

#### E1. #175 diagnostic-integrity 将时间戳中的 39 当成禁用文案，导致时钟相关假红 — P1

- **结论**：✅成立（双重复现：自然时钟当场抓到一次真实假红（秒=39）；固定时钟 09:51:39 机械复现 21 pass/4 fail，失败行与 PR 文档宣称逐位吻合。单次运行约 13% 概率假红）。
- **证据**：`tests/smoke/smoke-test-issue162-diagnostic-integrity.mjs:105` 禁用文案正则含 `\b39\b`——对 ISO 时间串 `:39`（两侧非单词字符）必然命中；`absentSecrets` 四个检查点 :147/:300/:349/:474。本意是代理 #162 修复前旧兜底文案"39 个旧会话"。
- **后果**：**假红**（非假绿）：发布门禁高频偶发红，损害门禁可信度；远端 CI 已被实际打红过。不涉及脱敏泄露。
- **修复**：采 #208 修法：`\b39\b` → `\b39\s*(?:个?旧会话|old sessions\b)`。可选加固：harness 注入固定时钟（lib/degrade.js:63-67 支持）。
- **PR**：#208 已修，核查代理做新旧正则对照矩阵验证：8 个原敏感标记逐字保留全拒、"39个旧会话"各形态仍拒、239/139 不误伤、新增正例+负例自检锁死——**不是为转绿放宽断言**。#209 同款。#206 未修。
- **合并**：采纳该 hunk；按守卫纪律做红→绿验证（固定时钟旧断言必红、新断言全绿——核查代理已代跑红侧）。

---

#### E2. #176 两处边界/变异夹具未覆盖目标，异步用例提前计为通过 — P2（PR 未修）

- **结论**：✅成立（三个子项逐一实核）。
- **证据与修复**：
  1. **h43 变异负路径 A 空转**（smoke-test-h43-theme-sync.mjs:113-116）：创建 harness 后**未调用 setter** ⇒ 两断言恒真（连未变异代码也过）；:115 的 `|| undefined` 逃逸还与其断言消息自相矛盾。修复：:113 后先 `h.o.set('light')`，删掉 `|| undefined` 逃逸。变异负路径 B（:119-127）有效。
  2. **r34 边界卡被 `h||12` 移离边界**（smoke-test-r34-stat-cards.mjs:17）：`h || 12` 把 0 当缺省 ⇒ 边界卡落在 12:00 而非 00:00 ⇒ 生产判据 `>=`（wb-sidecar.js:1078）变异为 `>` 时夹具测不出（隐性**假绿**）。修复：改 `h ?? 12` + 新增夹具自证断言。
  3. **p3 异步用例提前计数**（smoke-test-p3-recall-decision.mjs:18-21）：helper 同步设计却接收 async fn ⇒ `fn()` 返回 Promise 不同步抛错立即 `pass++`，失败转为 unhandled rejection 发生在 :142 汇总之后（当前 7/0 全绿属潜伏态；Node 22 退出码兜底为红，一旦任何代码装吞拒绝监听器即退化真假绿）。修复：helper 改 async/await，汇总在全部完成后执行。
- **PR**：三个 PR 均未触碰这三个文件。
- **合并**：按 1→2→3 出独立小补丁（纯测试侧低风险）；修后各做一次注入验证（h43 删广播段必红；r34 临时把 `>=` 改 `>` 必红；p3 插必败断言验证 6 passed/1 failed + 退出码 1）。

---

### 批次 F：决策项（需用户拍板后执行）

---

#### F1. #179 [F03] 工作区目录键将分隔符与连字符折叠为同一值 — P1 ⚡决策级

- **结论**：✅成立（碰撞用仓库同款正则实测复现：`foo-bar` 与 `foo/bar` 同得 `---u-foo-bar--`）。
- **证据**：`lib/index.js:2879-2882` wsKey 把 `/ \` 与字面 `-` 全映射 `-`；消费端直落物理目录（projectDirOf :2895、白板键 :3402、**技能库目录同键** :13274）；同算法逐字复制到 `lib/migrate-pack.js:37-40`。真实用户数据（`~/.dsh/memory/workspaces/`）证实目录名**不可逆**。
- **后果**：两个键折叠相同的工作区**完整共享同一物理桶**（MEMORY.md/日志/PLAN/白板/技能库双向读写互串），不只是命名难看。P1（需特定路径对，英文项目名带连字符时完全可能）。
- **修复**（PR #206 方案已核，质量好）：新增 `lib/workspace-key.js`：`workspaceIdentity`（resolve+斜杠归一+Windows 小写折叠）+ `workspaceKey = 'ws-v2-' + sha256(identity)` + `legacyWorkspaceKey`（旧算法保留供迁移匹配）；wsKey 委托。**旧数据迁移必须**：migrateLegacy 里对两个根找旧桶，仅有 `.workspace-owner.json`（内容 `{"workspace":"<绝对路径>"}` 且 identity 匹配）才 stage 复制→重绑 procedures.json→原子 rename；**归属不明一律保留原目录 + 面板警示，绝不静默分配，绝不删原目录**。migrate-pack 兼容新旧 slug。
- **⚡ 用户拍板点（PR 深审确认）**：owner 文件升级前**不可能存在** ⇒ 每个存量集中式用户升级后记忆"看起来消失"（旧桶保留、新桶为空）+ 每轮 must 优先级注入迁移告警，直到手工给每个旧桶写 owner JSON。数据安全是对的（不猜归属），但体验代价大且是全 PR 耦合度最高的一束（~20 文件）。两个选项：**(a) 采纳**——建议给"当前工作区旧桶"加一个显式一次性确认入口（面板按钮）而非要求手写 JSON；**(b) 不采纳**——必须整束砍（牵动全部 workspaceKey 测试适配 + procedure workspaceRef + migrate-pack slug），执行成本高。残余风险如实告知：resolve 不解析 8.3 短名/symlink/subst 别名（真实数据 `JH Z` 与 `JHZ~1` 就是两个桶），可在 stat 成功时叠 realpathSync 缓解；新键不可读（sha256），迁移包命名损失人可读性。
- **PR**：#206 已修且迁移设计 fail-closed 正确；混合桶整桶复制给认领方无拆分工具（需用户文档）；被动迁移（打开该工作区才触发）⇒ 永不打开的旧桶滞留，跨工作区扫描会同时看到新旧目录。依赖 calendar-lock（F31）。
- **合并**：若采纳，workspace-key.js → wsKey 委托 → 迁移 → migrate-pack → 警示 UI 成组落，并补混合桶用户文档。

---

#### F2. #180 [F04] 工作区技能重载并集与消费端未过滤 scope — P1

- **结论**：✅成立。
- **证据**：重载并集 `lib/index.js:6110-6119`：内存 snapshot 是**全部** procedures（含上一工作区）且内存优先；消费端零过滤：`lib/procedure-store.js:711-713` `activeProcedures()` 无 scope 过滤（query 同）；两个注入消费者 JS 档 `lib/context-host.js:550` 与 Python 档 `lib/activation-host.js:337-354` 都不过滤；证据回填臂 :748 也不过滤（B 工作区事件给 A 技能加 evidence）。写侧 hub-io.js:332-337 有 foreign 过滤但救不了读。
- **后果**：A 的流程清单被注入 B 的模型上下文（跨项目指令串扰）+ B 的证据污染 A 技能晋升统计。P1。
- **修复**：procedure-store 加 `inScope(p,q)`（workspace 条目要求 workspaceRef 匹配）+ 构造支持 workspaceRef getter；index.js:13292 传 getter（空 ws 时保守过滤全部）；context-host/activation-host capturePaths 增加 workspaceKey 并在消费时校验。**保留 rehydrate 并集本身**（保护未落盘状态的正解），只做消费视图过滤。
- **PR**：#206 已修且与建议一致（四 hunk 小而准，双消费者都补请求身份校验，fail-safe）。副效应（正面）：query() 过滤顺带修了证据回填串工作区。风险：不带 req.workspaceKey 的旧调用方技能匹配静默失效（PR 已同步改 m83 测试）。
- **合并**：与 #179 同束（workspaceKey 基础设施）；建议补"B 工作区注入审计"断言。

---

#### F3. #164 共享白板的多会话局部更新与防覆盖机制 — P2（⚠️部分成立：实现缺口属实，"职责误认"未在仓内复现）

- **结论**：⚠️部分成立。当前树确认无版本/冲突防护：`lib/index.js:3156-3160` writePlanSnapshot 全文覆盖、无 CAS/锁；缓解现状：重写前旧文归档（:3175-3184）——后写覆盖先写但有留痕，非静默丢失。
- **修复方向**：采纳 PR #209 的最小机制（已核）：
  - 新增 `lib/plan-store.js`（100 行，质量高）：整篇 CAS=sha256 原始字节；卡片级 CAS（cardId/expectedCardRevision）按标题切卡+锚点定位、只拼接该卡字节区间、强制保留锚点与 user 区；冲突双方落 `handoff/conflicts/PLAN-<uuid>.json`（wx 独占），**明确拒绝 LWW/自动语义合并**。核查代理临时副本实跑：过期整篇/正确 revision/不带 revision 覆盖/单卡局部替换/过期单卡五场景全部通过。
  - 工具面：`memory_read(kind=plan)` 返回 revision+逐卡 revision；`memory_note(kind=plan)` 增 expectedRevision/cardId/expectedCardRevision；两个内部调用方已适配。
  - writePlanSnapshot 全程进 withCalendarLock；派生索引带 sourceRevisions 失配即重建。
  - **诚实边界（PR 文档自述，核过一致）**：文件系统无跨进程原子 CAS，外部编辑器不守锁时"最后检查→rename"仍有竞态窗口；不宣称磁盘防篡改。
- **职责身份系统（ROLES/会话绑定/授权）**：开放设计问题，维护者此前已裁定暂不修，本 PR 也不 Closes #164——保留给产品决策。
- **行为变化警示**：已有白板的"盲重写"从成功变为 conflict（仓内两调用方已适配；外部直调 writePlanSnapshot 的脚本会受影响）。
- **合并**：随 #209 整包（含其 6 个 issue164/174 测试）；建议真机多窗口 QA 一轮。

---

### 批次 G：F 批之外的独立项

---

#### G1. #167 自动沉淀功能在跨工作区记忆写入与内容校验方面的观察 — P2（⚠️部分成立，PR 未涉及）

- **结论**：⚠️部分成立——观察点②③④⑤⑥全部属实；①有偏差（纯 `(无)` 已被拦截，但"无"型变体空壳可穿透）。
- **证据**（`lib/index.js` consolidateTurn）：⑥prompt 无任何工作区信息（:11182-11212）；③`[USER]` 分类仅靠 prompt 软约束，`ensureBudget`（:6326）纯字符额度无内容门，:11273-11276 直接写**跨工作区全局**用户级 MEMORY.md 无确认环节；④去重参照只有今日日志尾部 900 字符（:11182），已有 [USER]/[NOTE] 不参与；②解析器（:11237-11253）对任意 `- ` 要点照单全收无动作描述过滤；①`:11231` 只拦 `(无)` 字面；⑤全仓无删除反馈回路（note-status.js:4-6 明言"未接线"）。
- **后果**：[USER] 误写跨工作区注入（单项接近 P1）；空壳/重复条目污染日志与笔记推高 token。
- **修复**（均 consolidateTurn 内，可独立小步）：P0——:11273 写 userPts 前加门槛（待确认区或 prompt 明示"仅第一人称跨项目规则偏好才输出 [USER]"）；P1——解析阶段确定性过滤（`/^(无|没有|暂无)/i`、动作描述开头、低于 N 字；整段空则不写）；P2——prompt 注入 p.ws 与项目名 + "本工作区事实默认 [NOTE]"；P3——state.userText 标题列表与 notesText 摘要入 prompt 作去重参照。全部不碰前端。
- **PR**：#206 未涉及（不在 F 批清单内）。
- **合并**：独立 PR，按 P0→P1→P2→P3 顺序，每步附 smoke（假模型验证空壳过滤与 [USER] 门槛）。

---

#### G2. #207（用户自建"测试机审计待改进项#0"）↔ F 批对照与独立项

- **P1 项**（index.js:10348 greetCount）：**与 #199/F23 重复**——采纳 #206 的 hunk 即同时关闭。其附带的关键约束（勿改 `_readWorkbench` null 语义）已并入 C9 条目。
- **独立项 4 个（F 批与 R01-R05 均未覆盖，全部核实成立）**：
  1. **cont-seq.json 计数器原子性**（index.js:4696 裸 writeFileSync + :4736 读-改-写无串行 ⇒ 并发接续重号/撕裂回退；scanMaxContSeq 只扫 120 会话补偿不完整）。修法：复用 `writeTextAtomicPreSync`（:97 已导入，零新依赖）+ 按路径串行队列。
  2. **continued-sessions.json 已接续闩**（:4660-4667 read→push→整写 ⇒ 并发丢闩 ⇒ 同会话二次自动接续）。同上修法。
  3. **auto-memory-archive-ledger.json 归档账本**（:10815 整对象覆盖写 ⇒ 丢更新/撕裂归零；读取端 catch 返回 {} 静默丢史）。同上修法。
  4. **semantic-js-worker wasm 路径未本地化**（semantic-js-worker.js:64-68 未固定 wasm 路径 ⇒ transformers.js 默认指向 jsDelivr CDN，Node ESM 不接受 https: 导入 ⇒ 离线/内网语义档退化词法，有 norm 自检兜底不炸）。修法：内建 wasm 路径补丁 + `localWasmPaths: auto|off` 开关（约 8 行）。
  - 三项 P2 与 R01（#82 配置原子写）同主题不同文件，可直接套用 writeTextAtomic 模式；建议与 R01 同批做"原子写扫荡"。
- **已排除清单**（用户自查的负结果）与 F 批无矛盾。

---

#### G3. #166（上下文项，已关闭）

npm 3.2.7 包含 7 份 client.js 残留（~15MB）——已由 11b6dba 修复关闭（过滤口径升级为结构性白名单）；**该修复正是 #170 误删资源的直接诱因**，两 issue 是同一次"修 A 引入 B"的连锁。#170 修复（B3）后建议把"发布 staging 资源清单硬校验"补上门禁，防止第三次连锁。

---

## §6 流程层问题归因（为什么会有这批 bug）

这批 39 条 issue 不是孤立失误，可归纳为 7 个系统性模式（修复时留意同类残留；未来评审时按此清单自查）：

1. **装配层欠账**：模块逐批交付、接线分批补——#174（engine 未传、定时器插错位）、#186（豁免装进 catch、简报嵌进团队 try）、#190（两套 miv 域并存）都是"模块对了、装配没跟上"。**对策**：接线类改动必须带"装配断言"测试（PR 的 audit-host-wiring 套件是好的样板）。
2. **两套口径并存**：#188（pathsOf 契约名 vs state 名）、#190（tier-miv vs corpus miv）、#186（第三种桶名算法）、#197（ready vs verified-ok 枚举换血漏一处）——同一概念多处实现。**对策**：换口径时全仓 grep 旧口径字符串收口（PR 为 #191 加的 `assert.ok(!src.includes('await this.latestLedgerNamePre('))` 守卫是好的样板）。
3. **前端三副本漂移**：#197（三份白名单副本漏一份）、#193F17（三份 onChange）、#194（字典+三处调用点）——生成器从两个源+手写段抽取，改一处漏两处。**对策**：涉及三副本的改动把"重建后 grep 三处一致"列为验收步骤。
4. **修复只修半个坐标系**：#171（校验面剥 BOM、提取面没剥）、#183（撤销先于校验）、#187（TDZ 修了还有重载回退）——同一数据对象有两个消费面时只改了一个。**对策**：修复 review 时问"这个值还有谁在读"。
5. **测试夹具掩盖接线断裂**：#188（m85 夹具同时喂两套字段名）、#173（GC 测试只造兜底名）、#176（夹具恒真/异步提前计数）——夹具喂实现想要的形状，断言失去甄别力。**对策**：夹具只喂真实生产形状；变异验证要真执行行为（不只验证源码被改）。
6. **假红与假绿并存**：#175（`\b39\b` 命中时间戳，13% 假红）损害门禁可信度；#176（边界变异测不出）制造假绿。**对策**：守卫正则避免孤立数字；时间相关断言注入固定时钟。
7. **修 A 引入 B 的连锁**：#166（删残留）→ #170（误删资源）；#66（修 BOM 校验）→ #171（提取错位）。**对策**：发布管线类改动加 staging 产物硬校验（资源清单数、包体积基线）。

---

## §7 验收与回归清单（执行 agent 完成修复后逐项打勾）

1. **全量 smoke**：`node tools/run-smoke.mjs` 全绿（当前基线 237/237；采纳 PR 测试后套件数增加）。重点盯：r26-E2（纯 CRLF 锁）、iter5-skin 与 r26 冻结哈希（按最终字节重算）、p7/handoff/plan-seed（若采纳 #164 CAS）、l3-team/r17/api-paths（若采纳团队接线）、t0-2-version-gate（若采纳 F13）、m83（若采纳 F04）。
2. **生成器**：`node tools/build-iter5-skin.mjs --check --strict` 通过（源与产物一致）。
3. **真机抽验**（宿主重启后）：设置页 Python 三态读数、皮肤家族双向切换、白板展开卡新内容、团队面板四按钮与真数据、调试中心打开零 POST、记忆设置三个节奏输入可保存、新装 workbench 接口 200。
4. **数据安全抽验**：BOM 语料 rec.text 正确；日历 `--:--` 条目写后可读、双进程并发不丢；supersede 拒绝后旧事实仍在；折叠护栏清空前归档在位；批 flush 失败健康度非零。
5. **发布抽验**：`node tools/release.mjs <ver> --dry-run` 后 staging 含 lib/assets（82 文件）与 lib/policies（2 JSON）。
6. **发布说明必须写明**：①#201 Python 档升级后首轮全量重嵌入（量化耗时，JS 档不受影响）；②#178 user 层归档路径变化（自定义 userMemoryDir 者旧 archived-user.md 不迁移）；③F17 存量 0.8/65536 键需删除才能吃 preset；④若采纳 F03：旧桶迁移确认流程（或面板确认入口）与混合桶人工核对指引；⑤日历锁孤儿 `.lock.acquire` 的人工清理说明。
7. **对贡献者的回复口径**：39 条 issue 逐条回执（结论+修复落点）；4 条 PR 按本文档 §4 的采纳/剔除清单处置并说明理由（尤其 #168 的 3 处剔除、#209 的 docs 工作材料与 DAM_AUDIT_ENGINE_SOURCE 剔除、F03/F26 两个拍板项、#194 需补 6 键）。

---

## 附：核查材料索引

- `.diag-audit-20261002/bodies.json` / `comments-<N>.json`：39 条 issue 正文与评论
- `.diag-audit-20261002/pr-{168,206,208,209}.diff` + `pr-209-files.json` 等：四条 PR 全量 diff 与文件清单
- `.diag-audit-20261002/pr209-docs/`：贡献者自带修复方案（results.md、F01-F30 逐项文档、phase2 团队/资源方案、final-validation.md）
- 本文档各条目引用的 file:line 均为当前树（wip @ 11b6dba）实况；与 issue 原文行号的偏差已在条目内说明。
