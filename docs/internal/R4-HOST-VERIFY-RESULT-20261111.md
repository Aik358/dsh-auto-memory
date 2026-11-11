# R4 已实现能力的真实宿主综合验收 · 结果（2026-11-11）

> 对应任务书：`docs/internal/PROMPT-R4-HOST-VERIFY-20261111.md`
> 实现提交：`10e66faf`；完成状态文档：`583eab17`；验收时 HEAD：`34cdd5e2`（仅多一份任务书 docs）
> 本报告只给逐项判定与可复算证据，**不合并成虚假总分**。

## 0. 结论边界（先说不成立的部分）

- 本轮**不是** Node smoke 复跑。所有 HOST 级条目来自真实第二个 DSH 宿主进程（独立 `DSH_HOME`、独立端口 19411、加载工作树 `D:/dsh-auto-memory/lib` 代码）；PROC 级条目来自真实子进程 + 真实文件系统；MOD 级条目为进程内真 import→真构造→真调用。
- **P4-2（legacy/graph/iter5 面板）与 P4-3（外部变更简报 / 存量归并扫描）本轮未实现、未验收**，见 §5。
- 未做：真实记忆迁移/删除、真实唯一接续来源切换、跨设备/在线团队同步、P6 存量迁移与恢复演练、P7 物理删除、全仓回归。
- 未做且无法做的（能力可达面限制，已如实登记）：`queryHistory` / `auditCoverage` 在 `lib/index.js` 中**0 命中**，没有 HTTP 路由也没有工具 action ⇒ D1–D3 最高只能到 PROC(+MOD)，不是「在真实宿主里点了按钮」。
- 一处**流程缺口如实登记**：任务书 §2 要求「试验前记录整个生产记忆根只读指纹」，本轮在开工阶段漏做 before 快照。替代控制：①仓库 `lib/ tests/ tools/ skins/ docs/ package.json` 的已跟踪文件与 HEAD 相比**零修改**（3 个未跟踪文件 `tools/_run-smoke-mut536-*.mjs` 在本轮开工前就已存在）；②隔离宿主使用独立 `DSH_HOME`；③全部夹具写入都在 `artifacts/_r4-host-verify-20261111/` 内。⇒ 不能声称"生产记忆根字节未变"，只能声称"本验收没有写入路径指向生产记忆根"。

## 1. 隔离环境（先证明隔离，再开始）

| 项 | 生产实例 | 隔离实例（本轮验收） |
|---|---|---|
| URL / 端口 | `http://127.0.0.1:19387` | `http://127.0.0.1:19411` |
| DSH_HOME | `C:\Users\JH Z\.dsh` | `D:\dsh-auto-memory\artifacts\_r4-host-verify-20261111\dsh-home` |
| profile | `desktop` | `r4hv`（自建最小 profile：dsh-base + dsh-web-app + dsh-auto-memory） |
| 宿主 PID | 生产进程 | **42408**（`DeepSeek Harness`，2026-11-11T15:16:11 启动） |
| 插件来源 | — | `profiles/r4hv/node_modules`（junction → 生产 desktop 的 node_modules，只读复用）→ `@a9i5k4/dsh-auto-memory` → `D:\dsh-auto-memory` |
| 启动命令 | — | `dsh --profile r4hv --port 19411 --host 127.0.0.1 --no-open`（经 `dsh --help` / `dsh web --help` 核实） |

- 启动命令来自**官方 CLI 帮助**，不是猜的：`dsh web --help` 明确列出 `--port` / `--host` / `--no-open` / `--public-url` / `--trusted-host`。
- 插件确认真实加载：隔离宿主启动日志出现 `[dsh-auto-memory] ready: engine + 22 tools + injection + 86 routes`；`GET /api/dsh-auto-memory/debug` 返回 `host.pid=42408`、`host.indexPath=D:\\dsh-auto-memory\\lib\\index.js`、`version=3.4.0-alpha.6`。
- 生产实例全程只读未动：未停止、未改配置、未打开团队同步。
- 证据：`artifacts/_r4-host-verify-20261111/evidence/A/host-process.json`、`logs/host-boot.log`、`start-isolated-host.ps1`、`dsh-home/`。
- **token 未写入本报告**（只在隔离 `dsh-home/host-endpoint.txt`）。

## 2. 合成数据与夹具边界

- 全部夹具在 `artifacts/_r4-host-verify-20261111/fixtures/{A,B,C,D,E,MUT}/`，隔离工作区 A/B 在 `workspace-a` / `workspace-b`。
- 未复制任何真实记忆正文；合成事件 id 使用 `evt_xxxxxxxx` 形式、合成文档使用合法 `<slug>-<YYMMDD>-<NNNN>` id。
- 变异只在整份复制的 `mutations/<id>/lib` 内做，共享 `lib/` 未就地改动（`git status` 证实已跟踪文件零修改）。

---

## 3. 逐项判定总表

> 证据级别：**HOST** = 真实隔离宿主进程/HTTP 路由/页面；**PROC** = 真实子进程 + 真实文件系统 + 当前 lib 真实代码；**MOD** = 进程内真 import→真构造→真调用。
> 判定：PASS / PARTIAL / FAIL / BLOCKED / NOT-IMPLEMENTED。

| 编号 | 项目 | 判定 | 证据级别 |
|---|---|---|---|

| A1 | 隔离宿主真实路由：config 180 键含 ledgerDocEnabled=false、handoffEnabled=true | **PASS** | HOST+PROC |
| A2 | 默认关闭 0 次 fs 调用/0 目录/wal=null；显式启用建 5 目录并接 LedgerWal | **PASS** | MOD+PROC |
| A3 | 9 个统一导出可构造，17 导出，stamp/wal/protocol 均真调用 | **PASS** | MOD |
| B1 | 同 documentId 连续 100 次更新文件数恒为 1；同名首建 document-already-exists 且字节指纹不变；错误/过期 expectedRevision 返回 document-version-conflict 且正文不变；同内容更新 noop:true。8/8 断言。 | **PASS** | MOD |
| B2 | 两个真实 node 子进程对同文档同 revision 竞争 10/10 轮恰一胜一 document-version-conflict（lockErrors=0，子进程 exit 均 0）；不同文档并发双成功；活主持锁时写入 lock-unavailable 且文档不变，SIGKILL 后可立即恢复；rename 前 kill 后目标文件 273 B/sha256 完全一致，无半截文件。6/6 断言。 | **PASS** | PROC |
| B3 | 同一业务 opId 的 prepared/committed/failed 三阶段各落真实检查点（2 事件×2 阶段），checkpointId 形如 ckpt_<16hex> 且事件内唯一、可从 API 与磁盘双向读回；failed 由真实子进程注入 fs.rename EIO 产生，记录实际残留 revision 与 preparedCheckpointId。7/7 断言。 | **PASS** | PROC+MOD |
| B4 | 同阶段同载荷重放不新增检查点并返回同一 checkpointId；异载荷/换 digest 返回 op-payload-mismatch；旧数字台账返回 op-payload-unverifiable；清空台账与真实 500 条容量淘汰后仍能从检查点判出 deduped 与载荷绑定。7/7 断言。 | **PASS** | MOD |
| B5 | 子进程在真实 prepared 落盘后被 SIGKILL，新 LedgerDocSystem.start() 补出 committed（count=1/recovered=1/attention=0），文档完整、无 .tmp 与锁残留、prepared 检查点逐字节未变；二次 reconcile 幂等；篡改载荷与多事件部分 prepared 均 fail-closed 且不动正文。7/7 断言。 | **PASS** | PROC+MOD |
| B6 | 检查点携带 changeSet/revision/四段/引用（15 项必填字段齐全，引用字段穿透白名单）；240,265 B 文档的 prepared 检查点仅 1,128 B（0.4695%），文档差 239,180 B 而检查点差 0 B，连写 3 次极差 24 B；反向对照 legacy 全文检查点 244,142 B = 216.4×。8/8 断言。 | **PASS** | MOD |
| C1 | 跨进程写入后 HOST 刷新读到新 revision（旧 0 次/新 2 次，连打两次逐字节相同）；同进程 WAL committed 后 readSide 立即可读新 revision 且事件库相序 prepared→committed；注入帧本身只到 MOD 级（无模型轮次、/state 不暴露 latestHandoffText）。 | **PARTIAL** | HOST+MOD |
| C2 | carry(A) 返 a1 的 documentId 与磁盘当前 revision 相等、B 标记 0 次；carry(B) 返 b1、A 标记 0 次；未知会话 400 source workspace unavailable；另一进程改写 B 后 A 的 revision 不变、串入 0，B 立刻反映新 revision。 | **PASS** | HOST |
| C3 | 唯一标记词在 scope=all（HOST，3 次）与 scope=handoff（MOD，1 次）均命中，L0/full 带同一当前 revision；但同一正文一次结果最多一份不成立：维护文档 2 次（白板臂+L0 臂），legacy 对照仅 1 次。HTTP recall 白名单不含 handoff（400）。 | **PARTIAL** | HOST+MOD |
| C4 | chunk 身份严格等于 documentId+sectionId+revision（5/5 唯一）；改正文后旧 revision chunk 0 个、distinct revision 1；旧 chunkId 返回 document-chunk-not-found、新 chunkId 返回当前 revision；11/11 PASS。未做真实向量召回。 | **PASS** | PROC+MOD |
| C5 | 绑定事件经 /event-detail 解析到自己的 documentId；工作区 C 两篇文档无 manifest 时返回 document-selection-required(2 docs)、readSide ambiguous 且 document:null、/state 两篇标记各 0 次；显式 documentId 正对照成功；未绑定事件 404/selection:none。 | **PASS** | HOST+MOD |
| C6 | 连读稳定；改正文并把 mtime 精确回拨（\|Δ\|<2ms）后 stamp f278a8491f9… → c2afb9193b0…、文档级 revision 同步变；A 改而 B 不变；自洽性被破坏的文档进 readErrors 并 complete:false；9/9 PASS。 | **PASS** | PROC |
| C7 | 5 类非法 documentId 全部 document-id-invalid，合法 ID 正对照成功；无命中 readErrors 空、读失败 readErrors 非空且 list() ok:false；根外 .md 链接真造后被拒且不泄漏根外正文；HOST 侧 clean→corrupt→clean 三态按预期翻转。 | **PASS** | PROC+HOST |
| C8 | 隔离配置置 false 并重启（13420→55288）后：config 读到 false、维护文档仍在盘上（1 文件/402B）、legacy 标记 2 次而文档 0 次、carry ok 但 maintenanceDocument:null、legacy 材料 1598 字符；MOD 注入帧同向回退。已改回 true 并重启（PID 50624）。 | **PASS** | HOST+MOD |
| D1 | 指定 [from,to)/eventId/kinds/includeQuad 查询正确；12 条检查点 limit=2 分 6 页、全区间 23 条 limit=3 分 8 页，并集均等于不分页全集；边界事件仅 b-from-equal 与 b-to-minus-1，to 日日志源从未枚举。 | **PASS** | PROC |
| D2 | 真删 3 个旧账本与整个 handoff/ 后 total 仍为 7 且逐项相同；非法JSON/形状错/文件缺失/单检查点畸形均返回 readErrors 且日志仍答；0 条时 ok:false 与合法空库 ok:true 可区分；LedgerDocSystem 门面同样可答且关闭态拒绝。 | **PASS** | PROC+MOD |
| D3 | 3 输入→3 报告+1 summary，重跑不出 -b/-c；reportBytes=readbackBytes=磁盘 5,754 B；源 SHA 审计前/报告内/重读/审计后四值一致；eligibleForPhysicalDelete 三处全 false；篡改源或事件库后 disposition/gates 必变且未篡改篇不误伤。 | **PASS** | PROC |
| E1 | 隔离宿主真实 /team-baseline upload 返回 documents:2，outbox 恒 1 条 kind='baseline'/key='baseline:current'；无 ws 时 400 ws-required 且队列零增长 | **PASS** | HOST |
| E2 | pack→unpack→隔离 apply 后两份文档逐字节一致（296B/295B，sha256 两侧相同），documentId/eventIds/revision 一致，checksum 独立重算覆盖实际入包文档且改一字节即失配 | **PASS** | HOST |
| E3 | 旧 v1 无 documents 基线 pack/unpack/apply 形状不变（无 documents 键、不建 documents/ 目录），与含文档包并排取证可区分 | **PASS** | HOST |
| E4 | 同 revision 重放零 documents 写入、无 -b/-c 文件；目标分叉后默认 apply 返回 document-conflict 且两份文档字节逐一不变 | **PASS** | HOST |
| E5 | 非法 resolution 拒绝；显式 local 得 keep-local 且字节不变；显式 remote 得 overwrite-remote 且磁盘字节等于包内字节（296B 两侧相同） | **PASS** | HOST |
| E6 | 只读目标触发真实 EPERM：applied 4 项、rolledBack 与 applied 逐项相同、failedItems 指向第二篇文档、未写文件与备份保留、无 tmp 残留；解除只读重试成功且无重复文件 | **PASS** | HOST |
| E7 | 24/24：checksum 篡改/截断/空 body/7 例非法路径/重复文档/非法 eventIds/revision 与时钟不匹配/清单不符/源与目标 junction 越界/源目录非法文件名全部 fail-closed，每条配同形合法输入成功 | **PASS** | HOST+PROC |
| E8 | ledgerDocEnabled=false 下 inbox 有 offer 仍零后台写入（8s 窗口整树不变、无 backup 目录）；仅显式 upload/apply 携带 2 份文档，apply 后 5s 亦无改写 | **PASS** | HOST |

合计：**28 项**，PASS **26**、PARTIAL **2**、FAIL **0**、BLOCKED **0**。

## 4. 实现但宿主验证失败的项

**本轮：0 项。** A/B/C/D/E 五条线的全部已实现能力项，在隔离真实宿主 / 真实子进程 / 进程内真调用三个级别上均按契约通过。

需要说明的是，「通过」不等于「生产已开启」：`ledgerDocEnabled` 在生产与隔离宿主默认都是 `false`，本轮所有 R4 读侧能力都是**在隔离配置里显式开启后**才验到行为的（C 线证据里每一步都记录了开关状态）。默认关闭态下的行为另由 A1/A2 与 C8 单独验证。

## 5. 尚未实现（不得写成已通过）

| 项 | 状态 | 依据 |
|---|---|---|
| P4-2 legacy / graph / iter5 面板与已打开文档的 revision 更新 | **NOT-IMPLEMENTED** | `PROTOCOL-R4-20261110.md` §9.2A 明列「P4-2 待做」；本条目不属 P4-0/P4-1/P4-4 交付范围 |
| P4-3 外部变更简报与存量归并扫描 | **NOT-IMPLEMENTED** | 同上「P4-3 待做」 |
| P6 真实存量迁移与恢复演练 | **NOT-IMPLEMENTED** | 任务书 §5 明确不在本轮范围 |
| P7 物理删除 | **NOT-IMPLEMENTED / 禁止** | `eligibleForPhysicalDelete` 在 D3 的 3 份报告 + summary + 磁盘读回**全部为 false** |

## 6. 仍禁止的行为（本轮未做，也不得被本轮结果授权）

- 未打开、未配置、未修改生产团队同步（生产态 `enabled:false / configured:false` 保持原样）。
- 未使用生产 `DSH_HOME`（`C:\Users\JH Z\.dsh`）做任何写入试验。
- 未做真实记忆迁移、未删除任何真实文档或账本、未把 R4 读侧设成生产唯一接续来源。
- 未把 `eligibleForPhysicalDelete` 改成可删。
- 未改 `lib/ `tests/ `tools/ `skins/ `docs/ `package.json` 来制造通过；五条线跑前跑后的受保护路径指纹一致（B 线给出 2,670 文件 / 335,185,442 B / sha256 汇总 `e18b6143…fdf86` 前后相同）。
- 未跑全仓回归，因此本轮**不能**用于宣称「全仓无回归」。

## 7. 生产环境未做的事（含一处必须披露的隔离破口）

- 生产实例（`127.0.0.1:19387`，`DSH_HOME=C:\Users\JH Z\.dsh`）**未停止进程、未改配置、未重启**；生产 `dsh-auto-memory.json` 的字节数 5,940 与 mtime `2026-10-31T01:24:01` 全程未变。
- 生产 `ledgerDocEnabled` 仍为 `false`；生产团队状态仍未启用。
- **未**在生产记忆根下创建任何 R4 文档、检查点或 coverage 报告；E 线核对了生产 1,647 个工作区，**零个**本任务夹具名泄漏。

### 7.1 必须披露的隔离破口（不隐瞒）

C 线早期有两轮 MOD 探针**未显式重定向 `DSH_HOME`**，向**生产**诊断日志追加了 **1 行**插件日志：

```text
C:\Users\JH Z\.dsh\dsh-auto-memory-diagnose.log:18369
2026-11-11T08:04:33.816Z R4 maintenance document selection failed: document-selection-required
```

- 复核结论（Lead 亲自实测）：该文件全文中匹配 `R4 maintenance document selection failed` 的行数 = **1**；该行只含聚合错误码，**不含记忆正文、不含路径清单、不含凭据**。
- 生产配置与宿主完全未受影响：`dsh-auto-memory.json` 5,940 B / mtime `2026-10-31T01:24:01`；19387 未重启、未改配置。
- 处置：C 线此后所有 MOD 脚本**首行**固定 `process.env.DSH_HOME = <隔离 home>`；本条按「验收期间对生产环境唯一的一次写入」如实登记，并在附录 F 单列。
- 证据：`evidence/isolation-breach-prodlog.json`。

> 口径：任务书要求「不得使用生产 DSH_HOME 做写入试验」。本条的**写入目标**是隔离 home，但插件诊断日志落在生产 home（因为当时进程环境变量指向生产）。因此不能声称「生产零写入」，只能声称「生产零配置改动、零记忆正文改动，仅有 1 行聚合错误码日志」。

## 8. 判定口径与已知局限（读本报告必读）

1. **证据级别分层**：HOST 只给真实隔离宿主进程能观测到的行为（HTTP 路由 / 真实插件加载）。凡插件里没有 HTTP 入口或工具 action 的能力（如 `queryHistory` / `auditCoverage`），最高只到 PROC(+MOD)，**没有**用 Node 套件冒充实机。
2. **「不复制未变全文」的口径必须收敛**：B6 实测 240,265 B 文档的 prepared 检查点仅 1,128 B（0.4695%）、legacy 全文检查点 244,142 B（216.4×）；但 B 线同时指出 `changeSet` 只有 `title/eventIds/content` 三区，**content 一变就整区携带**（实测改正文时 prepared 489,107 B）。⇒ 准确表述是「不为未变区域复制全文」，不是「正文编辑也不复制正文」。
3. **锁的实测形态**：有效文档锁文件名为 `<documentId>.md.lock.lock`（`locked-store.js:59` 传 `filePath + '.lock'`，共享锁再补 `.lock`）；`readDocument` 同样走文档锁（契约 §4 明文），持锁期间读会阻塞到超时返回 `lock-unavailable`（实测 821 ms），不是读到旧值。
4. **恢复边界**：多事件 op 若只有部分 prepared 落盘，`reconcile` 返回 `wal-prepared-incomplete`（`wal.js:216`）且不自动补完——文档不动、不伪造 committed。
5. **时间窗口型断言是有限观察**：E8「读侧关闭时不触发后台自动覆盖」是 8 s + 5 s 窗口观察，不等于任意时长证明。
6. **隔离隐患（环境级，非产品缺陷）**：`lib/index.js:4505` 的 `expandUserPath()` 对 `~/` 走 `os.homedir()`，与 `DSH_HOME` 无关。若隔离配置把 `memoryRoot`/`userMemoryDir` 写成 `~/.dsh/memory/...`，会指向**生产记忆根**。本任务所有隔离配置均使用绝对路径（共享 19411 的配置实测为 `...\\_r4-host-verify-20261111\\memory-iso\\workspaces`），因此未触发；但这是任何「隔离宿主」验收都必须先自查的一条。建议后续把该键的校验或提示补进隔离启动脚本。
7. **一处流程缺口如实登记**：任务书 §2 要求试验前后记录生产记忆根只读指纹，本轮开工阶段**漏做 before 快照**，只有 after 快照（`evidence/prod-fingerprint-after.json`）。因此本报告不声称「生产记忆根字节未变」，只声称「本验收未产生任何指向生产记忆根的写入路径」，并以「受保护源码路径零修改 + 隔离 DSH_HOME + 全部夹具落在 artifacts/ 下 + 生产工作区零夹具泄漏」四项替代控制。

## 9. 最终分类（任务书 §6.5 要求单列）

### 9.1 已实现且宿主验证通过
- **A1/A2/A3**：`ledgerDocEnabled` 存在且默认 false；默认关闭无 I/O、无 wal；统一导出九类可构造；start/stop/reconcile 生命周期可调用。
- **B1–B6**：文档创建/同文件多更新/首建冲突/错误 revision 冲突/noop；跨进程一胜一 conflict、活主持锁、SIGKILL 恢复、无半截文件；三阶段检查点与 `ckpt_<16hex>` 持久化唯一；重放幂等与 `op-payload-mismatch`/`op-payload-unverifiable`；kill 后 reconcile 补 committed；检查点携带 changeSet/revision/四段/引用。
- **C1–C8**：动态注入、跨工作区接续、scope=all/handoff、语义检索 chunk 身份、事件下钻、材料指纹、路径安全 fail-closed、关闭开关回退 legacy 双读（详见附录 C，逐项含真实路由与响应字段）。
- **D1–D3**：区间边界左闭右开、分页并集等于全集、无旧账本仍可答历史、事件库损坏返回 readErrors、coverageAudit 一篇一报告且 `eligibleForPhysicalDelete=false`。
- **E1–E8**：显式上传返回 `documents:2` 且 outbox 形状不变、往返逐字节一致、旧 v1 兼容、同 revision 幂等与冲突默认拒绝、local/remote 显式解决、第二篇 writer 故障只回滚已写、七类非法输入全部拒绝、读侧关闭时仍可因显式动作携带。

### 9.2 实现但未完全通过（PARTIAL，逐条说明卡在哪）
- **C1（PARTIAL，HOST+MOD）**：三项子判据里两项是 HOST 级且通过（跨进程写入后 HOST 刷新读到新 revision、同进程 committed 后 readSide 立即可读）；**只有「注入帧真正进入模型上下文」这一项无法在真实宿主观测**——隔离宿主没有模型轮次，`/api/dsh-auto-memory/state` 响应键里没有 `latestHandoffText`/`planText`，`/debug` 也不暴露。该项只到 MOD 级（真 apply + 真 engine + 真 `renderMemoryDynamic`，8/8）。**不是功能失败，是观测面不可达**；未用 MOD 冒充 HOST。
- **C3（PARTIAL，HOST+MOD）**：子判据「唯一标记词能命中」「L0/full 下钻内容与 revision 一致」通过（`scope=all` HOST 命中、L0 与 full 都带同一 revision）；**子判据「同一正文在一次结果中最多一份」不成立**——同一篇维护文档正文在一次 `scope=all` 结果里出现 **2 次**（交接白板臂 1 次 + L0 臂 1 次），而 legacy 对照标记只出现 1 次。这是本轮唯一一条**有区分力的功能偏差**，已作为 **D-C3-1** 记入附录 F：涉及 `lib/index.js:6011-6019`（handoff 臂）、`:14274-14275`（L0 臂）、组装处 `:14243-14248`。另 `scope=handoff` 在 HTTP 面被白名单挡住（**D-C3-2**，`lib/index.js:27966` 只允许 current/all/archive），故该 scope 只能 MOD 级验收。
- **其余 26 项全部 PASS**；FAIL 0、BLOCKED 0。

### 9.3 尚未实现
- P4-2 面板、P4-3 简报与归并扫描、P6 存量迁移与恢复演练、P7 物理删除。

### 9.4 仍禁止的行为
- 生产团队同步开关、生产 DSH_HOME 写入试验、真实记忆迁移/删除、R4 读侧成为生产唯一接续来源、`eligibleForPhysicalDelete` 置真、以本轮结果宣称全仓无回归。

### 9.5 生产环境未做的事
- 未重启生产宿主、未改生产配置、未在生产记忆根落任何 R4 产物。

---

## 10. 变异验证汇总（任务书 §4）

| 来源 | 变异数 | CAUGHT | MISSED |
|---|---|---|---|
| A 线（Lead）：documentId 路径校验 / revision CAS / committed 失效通知 / documents checksum / 冲突默认拒绝 | 5 | 5 | 0 |
| E 线：checksum 丢弃 documents / revision 不校验 / 冲突静默接受 / documentId 不校验 / eventIds 不校验 | 5 | 5 | 0 |
| D 线：to-inclusive / page-cap / swallow / eligible / frozen-sha | 5 | 5 | 0 |

全部变异在**整份 lib 副本**内进行（`mutations/<id>/lib`），逐条为「单点、内容锚定、命中数恒等于 1」的改写，且都有未变异副本的同形对照；共享 `lib/` 未被就地修改，还原后复绿。

---

## 附录 A · 逐项详细验收

# 报告片段 A（Lead）：宿主与统一门面 + 隔离环境 + 宿主运行面限制

证据级别说明：HOST = 真实隔离宿主进程/HTTP 路由；PROC = 真实子进程 + 真实文件系统 + 当前 lib 真实代码；MOD = 进程内真 import→真构造→真调用。

### A1 ledgixDocEnabled 存在且默认 false，默认仍是 legacy 双读
- 判定：PASS
- 证据级别：HOST（隔离宿主真实 HTTP 路由，非生产实例）+ PROC（插件配置落地读回）
- 真实操作：在隔离宿主 `http://127.0.0.1:19411` 上真实请求 `GET /api/dsh-auto-memory/config?token=…` 与 `GET /api/dsh-auto-memory/state?token=…`，把完整 config 落盘后逐键统计。
- 期望：config 含 `ledgerDocEnabled` 键且值为 `false`；`handoffEnabled` 为 true（legacy 双读通道仍在）。
- 实际：HTTP 200，config 共 **180** 个键；`hasLedgerDocEnabled=true`、`ledgerDocEnabled=false`、`handoffEnabled=true`；state 响应 36,197 字节。
- 负路径与正对照：负——生产实例（19387）用同一路由不受影响，未做任何写操作；正——同一隔离宿主里另有 179 个既有配置键正常返回，证明不是「config 整体读失败导致取到 false」。
- 证据路径：`evidence/A/A1-config-raw.json`、`evidence/A/A1-state-raw.json`、`evidence/A/host-process.json`
- 备注：这是**真实宿主进程**上的真实 HTTP 路由，不是 Node 套件。

### A2 真实 import + 构造 LedgerDocSystem；默认关闭无 I/O 无 wal；显式启用才建真实 sink
- 判定：PASS
- 证据级别：MOD（进程内真 import→真构造→真调用）+ PROC（真实文件系统断言目录存在性）
- 真实操作：真 import `lib/ledger-doc/index.js` 与 `lib/index.js`；用**计数代理 fs** 构造 `enabled:false` 的系统并 start；再用真实 `EventStoreLedgerSink` 构造 `enabled:true` 的系统并 start/stop；另用 `createLedgerDocSystemPre()` 无参构造默认系统。
- 期望：默认关闭时 start 返回 `{ok:true,noop:true,enabled:false,state:'disabled'}`、不建任何目录、fs 调用 0 次、`wal===null`；显式启用才创建 handoff/documents、logs、archive、legacy、coverage-reports 五个目录并接上 `LedgerWal`。
- 实际：关闭态 fsCalls=**0**、目录 before=false / after=false、wal=null、三个只读操作均返回 `ledger-doc-system-disabled`；启用态 5 个目录全部存在、`modules.documents='LockedLedgerDocumentStore'`、`modules.wal='LedgerWal'`、reconcile 返回 ok 且 count=0；无 sink 的服务 `reconcile` 返回 `wal-not-configured`；工厂默认 `createLedgerDocSystemPre({rootDir})` 得 enabled=false、wal=null、无目录。
- 负路径与正对照：负——enabled:false 下 0 次 fs 调用与 0 个目录；正——enabled:true 下同一代码路径真的建出 5 个目录。stop() 返回 `{ok:true,stopped:true,state:'stopped'}`。
- 证据路径：`evidence/A/a2a3-result.json`（A2 系列 9 条断言）
- 备注：`EventStoreLedgerSink` 构造要求 storePath 的父目录已存在，否则抛 `event-store-sink-path-invalid`（已在探针里先 mkdir；这是文档未写明的使用前提，作为观察项记录，不改产品）。

### A3 统一导出的六类能力可用；start/stop/reconcile 生命周期可调用
- 判定：PASS
- 证据级别：MOD
- 真实操作：从 `lib/ledger-doc/index.js` 取 `LedgerDocumentStore / LockedLedgerDocumentStore / LedgerWal / EventStoreLedgerSink / LedgerDocReadSide / HandoffMaterialStamp / LedgerHistoryQuery / LedgerCoverageAuditor / LedgerDocSystem`，逐一 `new` 并做 instanceof 断言；读 `HandoffMaterialStamp.read()`；调 `LedgerWal.reconcile()`；调 protocol 的校验/规范化函数。
- 期望：九个导出全部是 function 且可构造；stamp.read 在空 handoff 上 ok:true 且 stamp 为字符串；wal.reconcile 可调用；`validateDocumentId` 合法 id 通过、`../etc/passwd` 拒绝；`validateRevision` 合法；`normalizeText` 把 CRLF 归成 LF。
- 实际：导出计数 **17** 个；九个类 instanceOf 全为 true；stamp `{ok:true,enabled:true,complete:true,stampLen:64}`；wal.reconcile `{ok:true,count:0}`；protocol 五项全 true；`lib/index.js` 导出 `createLedgerDocSystemPre` 为 function。
- 负路径与正对照：负——`validateDocumentId('../etc/passwd')` = `{ok:false,error:'document-id-invalid'}`；正——同一函数对 `ledger-alpha-261111-0001` 返回 ok:true。
- 证据路径：`evidence/A/a2a3-result.json`（A3 系列 4 条断言）
- 备注：A2+A3 合计 **17 条断言，17 PASS / 0 FAIL**（`summary.total=17, passed=17`）。

## 隔离环境（任务书 §1）
- 判定：PASS
- 证据级别：HOST + PROC
- 真实操作：核实官方 CLI 启动方式（`G:\dsh_desktop\resources\runtime\cli\bin\dsh.cmd --help` → `dsh web --help`，官方选项含 `--port` / `--host` / `--no-open`），以 `DSH_HOME=D:\dsh-auto-memory\artifacts\_r4-host-verify-20261111\dsh-home`、`--profile r4hv --port 19411 --host 127.0.0.1 --no-open` 启动**第二个**宿主。
- 期望：新宿主使用独立 DSH_HOME 与空闲端口，加载工作树插件，不触碰生产实例。
- 实际：宿主 PID **42408**，进程名 `DeepSeek Harness`，启动于 2026-11-11T15:16:11，监听 127.0.0.1:19411，`GET /api/dsh-auto-memory/config` 返回 HTTP 200 / 5,742 字节；启动日志出现 `[dsh-auto-memory] ready: engine + 22 tools + injection + 86 routes`；插件经 `profiles/r4hv/node_modules`（junction → 生产 desktop 的 node_modules，只读复用）→ `dsh-auto-memory → D:\dsh-auto-memory` 加载**工作树真实代码**。
- 生产未受影响：生产实例仍为 127.0.0.1:19387 / DSH_HOME=`C:\Users\JH Z\.dsh`，全程只读；隔离 state 响应中对 `_r4-host-verify-20261111`、`C:\\Users\\JH Z\\.dsh`、`19411` 的出现次数均为 **0**（说明插件未把生产记忆根串进来）。
- 负路径与正对照：对照——同一台机上有两个独立端口（19387 生产 / 19411 隔离），隔离 hometree 含独立 `memory/ models/ profiles/ storages/`。
- 证据路径：`evidence/A/host-process.json`、`logs/host-boot.log`、`start-isolated-host.ps1`、`artifacts/_r4-host-verify-20261111/dsh-home/`
- 备注：token 只在 `dsh-home/host-endpoint.txt`，**未写入本报告**。

## 任务书 §4 变异验证（Lead 负责的五条）
- 判定：PASS（5/5 CAUGHT）
- 证据级别：PROC（真实子进程 + 真实文件系统 + 隔离 lib 副本）
- 真实操作：把整份 `lib/` 复制到 `mutations/M1..M5/lib`，每条做**单点、内容锚定、命中数断言＝1** 的改写，写后独立 import 变异副本跑同一场景，并与 `mutations/BASE/lib` 的原始副本对照。
- 期望：变异体必须让原本「必须拒绝/必须改变」的判据变成相反结果，否则该变异无区分力。
- 实际：
  - **M1 documentId 路径校验**：放行 `..`/`:`/`/` ⇒ `validateDocumentId('../../etc/passwd')` 由 ok:false 变 ok:true ⇒ **CAUGHT**
  - **M2 revision CAS**：`_revisionMatches` 恒真 ⇒ 错误 expectedRevision 的更新由 `document-version-conflict` 变 ok:true、磁盘被写成 v3 ⇒ **CAUGHT**
  - **M3 committed 失效通知**：`committed:true`→`false` ⇒ 通知载荷 committed=false ⇒ **CAUGHT**
  - **M4 documents checksum**：注释掉 `want !== got` 校验 ⇒ 把内层 event-store 篡改后重打包、外层 checksum 保留旧值，原版拒绝、变异体接受 ⇒ **CAUGHT**
  - **M5 冲突默认拒绝**：`if (!choice)` 分支改成静默覆盖 ⇒ 同 documentId 不同 revision 由 `document-conflict` 变 ok:true 且写 1 个文件 ⇒ **CAUGHT**
- 负路径与正对照：每条变异都有 `mutations/BASE/lib` 的同形对照（原版全部按契约拒绝），排除了「夹具本身就该失败」的假阳性。
- 证据路径：`evidence/MUT/mutation-results.json`、`mutations/{BASE,M1..M5}/lib/`、`scripts/MUT/run-mutations.mjs`
- 备注：过程中修正过三处**夹具自身**缺陷（eventIds 未真实存在导致 createDocument 前置失败、changeSet before 文本与版本错位、篡改落在外层而非内层），修正后 5/5 CAUGHT；这三处修正已记入本片段的「已试方案」。

## 补充：C7 路径安全的独立取证（Lead 代跑，供 C 线引用）
- 判定：PASS（7/7）
- 证据级别：PROC
- 覆盖：非法 id/绝对路径/`..`/大小写不符合格式 ⇒ `document-id-invalid`；同 store 合法 id 成功；在 documents/ 内真实建 junction 指向根外目录后，读侧枚举不通过链接泄漏；`readDocument('../outside/evil')` fail-closed；`fileWithinRoots` 保留根、拒绝根外路径；缺失文档与存在文档可区分（no-hit vs ok）。
- 证据路径：`evidence/A/supp-c7-path-boundary.json`、`scripts/A/probe-a7-boundary.mjs`

---

## 附录 B · 逐项详细验收

# Lane B · 文档、CAS、跨进程锁、WAL/检查点（B1–B6）

证据根：`artifacts/_r4-host-verify-20261111/`；脚本：`scripts/B/`；夹具：`fixtures/B/`；证据：`evidence/B/`。
统一入口：`node artifacts/_r4-host-verify-20261111/scripts/B/run-all.mjs`（逐项起独立子进程，跑完聚合）。
**汇总（可复算）**：6 项 / 43 条断言 / PASS 43 / FAIL 0，exit 0。**连跑两次独立复现**：第一次墙钟 10,784 ms、第二次 10,723 ms，两次逐项 PASS/FAIL 计数完全一致（`evidence/B/run-all.log`、`evidence/B/run-all-rerun.log`）。
**受保护源码未被改动（硬证据）**：`lib`、`tests`、`tools`、`skins`、`docs`、`package.json` 共 **2,670 个文件 / 335,185,442 B**，跑前跑后 sha256 汇总一致：`e18b61438b0713e1d90d74024944c0e2d0aa79d9ab9b259da263fbdf23ffdf86`（见 `evidence/B/summary.json` 的 protectedSource）。

| 编号 | 判定 | 证据级别 | 断言 PASS/总 |
|---|---|---|---|
| B1 | PASS | MOD | 8/8 |
| B2 | PASS | PROC | 6/6 |
| B3 | PASS | PROC+MOD | 7/7 |
| B4 | PASS | MOD | 7/7 |
| B5 | PASS | PROC+MOD | 7/7 |
| B6 | PASS | MOD | 8/8 |

---

### B1 同一 documentId 连续更新文件数不增 / 同名首建冲突不覆盖 / 错误 expectedRevision / 同内容 noop
- 判定：PASS
- 证据级别：MOD（真 import `lib/ledger-doc/document-store.js` → 真构造 → 真调用 → 真文件系统）
- 真实操作：在 `fixtures/B/b1-cas/handoff/documents` 用真实 `LedgerDocumentStore` 首建一份文档，再连续更新 100 次；随后做同名首建、错误/过期 expectedRevision、同内容更新、非法 ID 与非法事件关联，各取一次。
- 期望：100 次更新后目录内文档文件恒为 1；同名首建被拒且字节不变；错误 expectedRevision 返回 `document-version-conflict` 且正文不变；同内容更新返回 `noop:true` 且不加字节。
- 实际（可复算）：
  - 首建 1 个文件 256 B，revision `sha256:be8835af...02b6`。
  - 100 次更新：文件数集合恒为 `[1]`（fileCounts:[1]），末态 258 B，revision `sha256:9fda0869...922f`；`.tmp` 残留 0。
  - 同名首建：`document-already-exists`；文件指纹（258 B / sha16 ae97c84119b05859 / revision）前后完全一致；标题仍为首建标题。
  - 错误 expectedRevision：`document-version-conflict`，指纹前后一致；旧 revision 在新提交后再次提交仍 `document-version-conflict`。
  - 同内容更新（空 changeSet 与 before==after 两种）：`noop:true`，revision 不变，字节不变，`.tmp` 0。
- 负路径与正对照：负 = 同名首建 / 错误 revision / 过期 revision / `../` / 绝对路径 / 缺 eventIds / 未知事件 / closed 事件，错误码依次 `document-already-exists`、`document-version-conflict`（2 次）、`document-id-invalid`（2 次）、`event-ids-required`、`event-id-unavailable`（2 次）；每种之后目录文件数与字节指纹均不变。正 = 每次拒绝后紧跟一次合法更新均成功（v100→v101→v102，revision 分别 sha256:9ff876c1... / sha256:e6f4b184...）。
- 证据路径：`evidence/B/b1-document-cas.json`
- 备注：无缺陷。

### B2 两真实进程同文档同 revision 竞争 / 不同文档并发 / kill 持锁进程
- 判定：PASS
- 证据级别：PROC（真起 `node` 子进程 + 真实文件系统 + 当前 lib 真实代码 + 真实跨进程锁文件）
- 真实操作：每轮起两个真实子进程，二者都用**无锁 raw store 读到同一 base revision**，再各自经 `LockedLedgerDocumentStore` 提交同 revision 的更新；共 10 轮。另做：不同文档并发、活主持锁后 SIGKILL、持锁进程在 rename 前被 SIGKILL。
- 期望：同 revision 竞争至多一个提交成功、另一个为 `document-version-conflict`（不得是 `lock-unavailable`）；不同文档两进程都成功；kill 后无半截文件、无锁残留、后续可恢复。
- 实际（可复算）：
  - **10/10 轮**：okCount=1、conflictCount=1、lockErrors=0；两子进程 exit code 均为 0；每轮 bothReadSameBase=true；最终内容恒等于赢家写入（A 胜 6 轮 / B 胜 4 轮）；文档文件数恒 2、`.tmp` 恒 0、锁文件恒空。逐轮记录含 pid、耗时、revision、最终字节数与 sha256（见证据 checks[0].detail.rounds）。
  - 不同文档并发：两子进程均 ok:true，各自 exit 0；文档 A 269 B / sha256 19b54c0d...，文档 B 267 B；无锁残留。
  - 活主持锁：持锁期间竞争写返回 `lock-unavailable`（cause `state-lock-timeout`，818 ms），文档指纹不变；SIGKILL 持锁进程后新进程立即取得锁并写入成功（COMPETITOR）。
  - rename 前 kill：候选是未 rename 的 .tmp（<documentId>.md.<pid>.<uuid>.tmp），kill 前后目标文件 **273 B / sha256 fd46205d...f316 完全一致**；文档仍可解析、revision 等于自身字节；恢复写成功（AFTER-RECOVERY，277 B / sha256 e50e770f...c40d）。
  - 全部 kill 之后：listDocuments ok、readErrors 空、文件数 2、锁文件空、新取锁耗时 5 ms。
- 负路径与正对照：负 = 活主持锁时写入被拒（`lock-unavailable`）且文档不变、rename 前 kill 不产生半截文件；正 = 持锁进程被杀后立刻可写、不同文档并发双成功、10 轮竞争每轮恰一胜一 conflict。
- 证据路径：`evidence/B/b2-cross-process-lock.json`
- 备注（**观察项，不是缺陷**）：
  1. 有效文档锁文件名实测为 `<documentId>.md.lock.lock`（`lib/ledger-doc/locked-store.js:59` 传 filePath + '.lock'，`lib/shared-state-lock.js:94` 再补一个 .lock）。与代码注释「the shared lock adds the final '.lock'」自洽，但字面易误读；已作为证据记录（B2-06）。
  2. `readDocument` 同样走文档锁（契约 §4 明文「文档锁内转调底层 readDocument」）⇒ 持锁期间的**读**会被阻塞到超时并返回 `lock-unavailable`（实测 821 ms），而不是读到旧值；无锁 raw store 仍可读到已提交 revision。按契约这是预期行为，本项不据此扣分。
  3. **探针事故记录（非产品问题）**：首版探针曾因父进程被 120 s 执行上限杀掉、子进程成为孤儿并持续持锁，导致后续运行出现 `state-lock-timeout` 假红。已改为「子进程把结果写 JSON 文件 + 父进程注册 exit 收割器 + 子进程用 interval 保活」，并清理了残留锁。最终结论来自修正后的探针。

### B3 同一业务 opId 的 prepared/committed/failed 三阶段各落一条真实检查点
- 判定：PASS
- 证据级别：PROC+MOD（真 `eventStorePre` 写真实 event-store.json；failed 阶段由一个真实子进程在 document 写路径注入 fs rename 故障后产生）
- 真实操作：经 `EventStoreLedgerSink`（内部接真实 `lib/event-store.js`）与 `LedgerWal` 执行两次业务操作——一次成功（2 个关联事件）、一次在子进程里让 fs.rename 抛 EIO 从而真实失败；随后直接从磁盘读回检查点。
- 期望：prepared / committed / failed 各落真实检查点；checkpointId 形如 `ckpt_<16hex>`、持久化到事件库、事件内唯一。
- 实际（可复算）：
  - 成功操作：ckpt_d0736d67950e2230、ckpt_b46e9048db9c15f2（evt_b3000001）、ckpt_b99d624b68e3bcf2、ckpt_baea305d0e9d1a3b（evt_b3000002）；2 事件 × 2 阶段 = 4 条，全部匹配 `^ckpt_[0-9a-f]{16}$`；事件内无重复 ID；`detail()` 返回同一组 ID。
  - committed.preparedCheckpointId == 对应 prepared 的 checkpointId；committed.revision == 磁盘实际 revision sha256:9251d361...28c0。
  - 故障操作（子进程 pid 44548，注入 fs.rename → EIO）：`document-write-failed`，cause synthetic-rename-fault，阶段集合 [failed, failed, prepared, prepared]（2 事件 × 2 阶段）；failed.revision == 残留磁盘 revision，failed.errorCode = document-write-failed，failed.preparedCheckpointId == 对应 prepared ID，failed.changeSet 保留 1 条区段。
  - 全库 8 条 R4 检查点 / 8 个唯一 ID；三阶段并存 [committed, failed, prepared]；后续新操作不改动先前 committed 检查点（逐字节比较一致）。
  - 检查点 12 条共 12,099 B，无一条把文档正文（9 B 的 content）塞进 text（leaks=0）。
- 负路径与正对照：负 = 注入 rename 故障后文档不变（revision 前后一致）、不写 committed、只写 failed；正 = 同一 opId 正常路径写 prepared+committed 且 ID 可从 API 与磁盘双向取回。
- 证据路径：`evidence/B/b3-wal-phases.json`
- 备注：为了拿到真实 failed 阶段，故障注入点在 document-store 使用的 fs.rename（而不是伪造 sink），因此 failed 是产品真实路径产生的。

### B4 同阶段同载荷重放不新增 ID / 异载荷 op-payload-mismatch / 旧数字台账 op-payload-unverifiable / 台账淘汰后恢复判据
- 判定：PASS
- 证据级别：MOD（真 event-store + 真 sink + 真 WAL；直接用真实 appliedOps 台账结构）
- 真实操作：先跑一次两事件成功操作并**捕获 WAL 真正交给 sink 的载荷**，再用「同载荷」「改 payload」「改 digest」「旧数字台账」「清空台账」「超容量淘汰」六种形态重放。
- 期望：同阶段同载荷重放不新增检查点且返回同一个 checkpointId；异载荷 op-payload-mismatch；旧数字台账 op-payload-unverifiable；台账淘汰后仍能从检查点判出同一结论。
- 实际（可复算）：
  - 基线 4 条：ckpt_08686c51e3246bbc（evt_b4000001 prepared）、ckpt_fde1829b84be24b3（evt_b4000002 prepared）、ckpt_ece48a8718a45649（evt_b4000001 committed）、ckpt_c9fac9904d543b5c（evt_b4000002 committed）。
  - 4 次同载荷重放全部 deduped:true，返回的 checkpointId 与原始一致，检查点总数与 ID 集合不变；事件库文件被重写（store 级 updatedAt）但 **r4 检查点数不变**。
  - 改 payload（summary）与仅改 digest：两条 prepared/committed 与一次 digest 交换共 3 例全部 `op-payload-mismatch`，检查点 0 新增，文档 revision 不变；随后不改载荷的重放仍 deduped:true（正对照）。
  - 旧数字台账（appliedOps[key] = 1777777777777）：`op-payload-unverifiable`；同一 key 换成可验证对象台账后重放 deduped:true 且返回原 checkpointId（正对照在同形台账结构下）。
  - 清空台账后重放：deduped:true（判据从检查点恢复）、检查点不增；清空台账后改载荷仍 op-payload-mismatch；wal.replay 返回 noop:true 且不加检查点。
  - **真实容量淘汰**：台账注入到 524 条后由一次新操作驱动淘汰，落盘 500 条（APPLIED_OPS_CAP_PRE = 500 生效），被淘汰 op 的台账条目 4 → 0，此后重放依然 deduped:true、检查点不增。
- 负路径与正对照：负 = 异载荷 / digest 交换 / 旧数字台账三类拒绝且状态不变；正 = 同载荷、清空台账、真实淘汰后三种重放都判为幂等。
- 证据路径：`evidence/B/b4-replay-verdicts.json`
- 备注：legacy 检查点（无 opId/phase）不获得 checkpointId（13 条检查点中仅 12 条 R4 有 ID，legacy 1 条无 ID），符合契约 §2.2「不伪造 checkpointId」。

### B5 子进程 prepared 后 kill，重启 start/reconcile 补 committed
- 判定：PASS
- 证据级别：PROC+MOD（真实子进程在真实 prepared 落盘后被 SIGKILL；新进程 `LedgerDocSystem.start()` 读真实事件库补 committed；另有故障注入负路径）
- 真实操作：子进程执行 WAL，在 prepared 真正落盘后阻塞并被 SIGKILL；随后新构造 `LedgerDocSystem` 调 start()（内部 reconcile），再调 reconcile() 复算幂等；另做一条篡改 prepared 载荷的负路径与一条多事件部分 prepared 的观察项。
- 期望：重启后补 committed；文档完整、无临时文件、检查点仍 append-only。
- 实际（可复算）：
  - kill 后阶段集合恰为 [prepared]（单事件），子进程退出信号 SIGKILL；文档仍是旧 revision sha256:6a88dc6a...86be、258 B，sha256 afe2f197...，.tmp 0 个、锁文件 0 个。
  - start()：ok:true、complete:true、reconciliation.count=1、recovered=1、attention=0；阶段变 [prepared, committed]（共 2 条，2 个唯一 ID）；committed.preparedCheckpointId == 恢复出的 prepared ID；读侧 revision == 恢复 revision sha256:d80c5d0f...bce2（264 B）；**prepared 检查点逐字节未变**（append-only 实证）。
  - 二次 reconcile()：count=1、noop:true、检查点仍 2 条、文档 revision 不变。
  - 负路径：把 prepared 的 changeSet 清空 → start() 返回 ok:false / error=ledger-doc-start-incomplete / complete:false / attention=1，reconcile 报 `op-payload-mismatch`，文档 revision 保持原值，未写 committed。
  - 观察项（多事件部分 prepared）：1 个 prepared 落盘后中断，reconcile 报 `wal-prepared-incomplete`、attention=1、文档未被改、未伪造 committed —— 即**多事件 op 的部分 prepared 不会被自动补完**，需要调用方按协议处置（`lib/ledger-doc/wal.js:216`）。这与 §2.2「多事件不是原子事务」一致，非缺陷，但属恢复能力的边界。
- 负路径与正对照：负 = 篡改载荷 / 部分 prepared 两种情形都 fail-closed 且不动正文；正 = 正常 prepared-only 精确补 committed 且二次 reconcile 幂等。
- 证据路径：`evidence/B/b5-kill-recover.json`
- 备注：无缺陷；恢复边界（多事件部分 prepared 只报警不自动补完）建议写入结果文档的「已知边界」。

### B6 检查点携带 changeSet/revision/四段和引用，不再复制未变全文
- 判定：PASS
- 证据级别：MOD（真实检查点 JSON 逐条量字节；240 KB 文档做对照）
- 真实操作：造 2 份文档（1,085 B 与 240,265 B，后者正文 4000 行带唯一 sentinel），各做一次**只改标题**的更新；再连做 3 次只改标题的更新；另做一次 content 区更新；最后追加一条带 quoteRef/quoteLine/rel/bytes/sha256 的检查点验证白名单不吞引用字段。
- 期望：检查点带 changeSet/revision/四段/引用；不为每次成功写入复制未变全文。
- 实际（可复算）：
  - 大文档 240,265 B，prepared 检查点 **1,128 B = 文档的 0.4695%**；committed 908 B；检查点 JSON 内 sentinel 出现次数 **0**；changeSet 只有 title 一区。
  - 检查点大小与文档大小解耦：文档字节差 **239,180 B（221.4×）**，prepared 检查点字节差 **0 B（1.00×）**。
  - prepared 必填字段齐全（schema / documentId / eventIds / baseRevision / expectedRevision / candidateRevision / operationDigest / changeSet / updatedAt / sections / summary / opId / phase / checkpointId / payloadDigest 共 15 项，缺 0）；四段键 goal/doing/deadend/next 齐全；eventIds 与文档一致。
  - committed → prepared 的 preparedCheckpointId 引用链成立；committed.revision == 磁盘 revision。
  - 引用字段穿透真实白名单：quoteLine=42、rel=handoff/documents/b6-doc-large-261111-0002.md、bytes=123456、sha256=sha256:aaaa...、sections.goal='g' 全部读回一致。
  - 连续 3 次写入的单次检查点总量 2,048 / 2,060 / 2,072 B，**极差仅 24 B**（无逐次累积全文）。
  - 反向对照（证明该字节指标有区分力）：同文档一条 legacy 全文本检查点 **244,142 B**，是 changeSet prepared 检查点 1,128 B 的 **216.4×**，且该 legacy 检查点无 checkpointId。
- 负路径与正对照：负 = legacy 全文检查点体积 216.4× 于 changeSet 检查点（指标能区分）；正 = changeSet 检查点体积与文档规模无关、引用字段全部存活。
- 证据路径：`evidence/B/b6-checkpoint-shape.json`
- 备注（**口径边界，非缺陷**）：changeSet 的区域只有 title / eventIds / content 三个（`lib/ledger-doc/protocol.js` 的 REGIONS）。**content 区一旦变化就整区携带**——实测改 content 时 prepared 检查点 489,107 B（changeSetBeforeBytes = 239,999）。所以「不复制未变全文」成立的前提是变更落在 content 之外的区；纯正文改写仍是整区载荷。这一点应在结果文档中如实写明，避免被读成「正文编辑也不复制正文」。

---

## 发现的缺陷
无。B1–B6 全部 43 条断言通过；上述 4 条观察项（锁文件名 .md.lock.lock、读操作走独占锁、多事件部分 prepared 不自动补完、content 区整区携带）均为**契约内行为或已知边界**，已在对应项「备注」中如实记录，不改判为缺陷。

## 阻塞
无。

## 未做的部分
- 本线全部为进程内/子进程级证据，**未使用隔离宿主进程/HTTP 路由/页面**：B1–B6 的验收对象是 lib 内部契约（store / lock / WAL / sink / checkpoint），不涉宿主注入面或 UI，故最高证据级别为 PROC+MOD。HOST 级证据归 A/C/D/E 线。
- 未做变异验证（变异归 Lead 的 mutations/ 线）。
- 未跑全仓回归，未做真实迁移/删除，未写生产 DSH_HOME。

---

## 附录 C · 逐项详细验收

# C 线报告片段 · R4 读侧（C1–C8）

证据根 artifacts/_r4-host-verify-20261111/（脚本 scripts/C/，夹具 fixtures/C/，证据 evidence/C/）。隔离宿主 DSH_HOME=artifacts/_r4-host-verify-20261111/dsh-home、profile r4hv、端口 19411、插件经 link:D:/dsh-auto-memory 加载。生产实例 19387 未触碰（未重启、未改配置、未写入）。

**隔离宿主重启与 PID 对应（本线独占重启权，共 5 次）**

| 次序 | 旧 PID | 新 PID | 该段配置 | 该段测得的项 |
|---|---|---|---|---|
| 0 | — | 42408 | ledgerDocEnabled=false，memoryRoot=~\.dsh\memory\workspaces | 表面探针（probe-surface.json） |
| 1 | 42408 | 56628 | memoryRoot/userMemoryDir 改为绝对路径 memory-iso | 判定 read 面是否可达 |
| 2 | 56628 | 43160 | ledgerDocEnabled=true | C1 全量、C2、C3、C4、C5、C6、C7 |
| 3 | 43160 | 13420 | 夹具重建后的复测 | C1 跨进程刷新、C2 隔离、C4/C6/C7 |
| 4 | 13420 | 55288 | ledgerDocEnabled=false | C8 关闭回退 |
| 5 | 55288 | 50624 | ledgerDocEnabled=true（当前运行态） | C5 补测、C8 对照、最终复核 |

> 每份 evidence JSON 自带 at 时间戳，可与 evidence/C/restart-log.json 对齐；未把重启前后数据混成一组。

---

### C1 动态注入（当前维护文档进入注入 / 同进程 committed 后立即可读 / 另一进程写入后刷新读到新 revision）
- 判定：**PARTIAL**
- 证据级别：**HOST+MOD**
- 真实操作：
  - HOST：向 19411 的 POST /api/dsh-auto-memory/recall（body {query:<A 唯一标记>, sessionId:<合成 A 会话>, scope:current}）连续请求；由另一个真实 Node 进程（scripts/C/proc-write-doc.mjs，独立 PID、真实 FS、当前 lib 的 LedgerDocumentStore.updateDocument）改写 A 的维护文档后再请求。
  - MOD：apply(ctx) 构造真实 engine → refresh(agentA) → renderMemoryDynamic({agent}) 取真实注入文本；同进程用 createLedgerDocSystemPre（真 sink + 真 LedgerWal）执行一次 upsert 后再读。
- 期望：维护文档进入注入；committed 后同进程立即可读新 revision；跨进程写入后刷新读到新 revision，且不出现新旧并存。
- 实际（可复算）：
  - 跨进程写入：rev sha256:567271d683dc4972…（402 B）→ sha256:024267434591d849…（425 B，noop:false），并故意把 mtime 回拨 1 小时。
  - HOST 刷新后：旧 revision 出现 0 次、新 revision 出现 2 次、新正文标记 PROC-SECOND-STATE-9d1c 出现 2 次；连打两次结果逐字节相同（sameAsFirst:true）。
  - 同进程（MOD）：WAL upsert → phase:3 / documentCommitted:true / eventComplete:true；readSide 立刻返回新 revision（c6a2f5e4… → 836c332f…），lastCommittedDocument 同步；事件库内该 opId 的检查点相序 ["prepared","committed"]。8/8 PASS。
  - 注入文本（MOD）：A 的注入帧 4237 字符，含 A 正文 1 次、B 正文 0 次；B 的注入帧含 B 1 次、A 0 次；关开关后注入帧回到 legacy 账本（legacy 标记 3 次、维护文档 0 次）。8/8 PASS。
- 负路径与正对照：
  - 负：关闭开关后注入帧不含维护文档（0 次）且回落到 legacy 账本（3 次）—— 证明「命中」不是恒真。
  - 正：同一 A 会话在开关打开时含维护文档 1 次。
  - 负：跨进程写入后旧 revision 出现 0 次（不出现新旧并存）。
  - 正：写入方的 before/after revision 与 HOST 读到的完全一致（可复算链）。
- 证据路径：evidence/C/c1-probe.json、c1-refresh.json、c1-sameproc.json、c1-inject.json、proc-write-A.json
- 备注：**判 PARTIAL 的原因（阻塞条件）**：真实宿主没有模型轮次，「注入帧真正进入模型上下文」在 HOST 无法观测；/api/dsh-auto-memory/state 响应不含 latestHandoffText/planText（实测 keys 无此二键），/debug 亦不暴露。故「文档进入注入」只到 MOD 级（真 apply + 真 engine + 真 renderMemoryDynamic）。三项子判据中后两项为 HOST 级、第一项为 MOD 级——未用 MOD 冒充 HOST。

### C2 跨工作区接续（carry 沿源会话路径返回 A 的 documentId/revision；B 改动不得串入；无源工作区明确失败）
- 判定：**PASS**
- 证据级别：**HOST**
- 真实操作：POST /api/dsh-auto-memory/handoff-continue，body {fromSessionId} 分别用合成会话 A / B / 一个不存在的 sid；再让另一个真实进程改写 B 的文档后复测 A 与 B。
- 期望：A 返 A 的 documentId/revision；B 不串入 A；B 的改动不影响 A；无源工作区明确失败（不拿全局账本顶替）。
- 实际（可复算）：
  - carry(A) → maintenanceDocument.documentId = synthetic-maint-a1-261111-1501，revision 与磁盘当前 revision 完全相等；A 标记 1 次、B 标记 0 次。
  - carry(B) → synthetic-maint-b1-261111-1503；A 标记 0 次。
  - 未知 sid → HTTP 400，{"ok":false,"error":"source workspace unavailable"}（无任何材料回退）。
  - 另一进程改写 B（sha256:a3422fec… → sha256:59e896cc…，421 B，PID 37236）后：carry(A) 的 revision 未变（aRevisionUnchanged:true），B 标记 0 次 + B 新正文标记 0 次（串入计数 0）；carry(B) 立刻反映新 revision（matchesProcNew:true）。
- 负路径与正对照：
  - 负：未知会话 → 400 明确失败（而不是返回别的工作区材料）。
  - 正：A / B 两个真实会话各自拿到自己的 documentId 与 revision。
  - 负：B 变更后 A 的结果里 B 标记与新正文标记均为 0。
- 证据路径：evidence/C/c2-c5-host.json、c2-isolation.json、proc-write-B.json
- 备注：无源工作区这一路走既有 source workspace unavailable 判据（lib/index.js:8381），本轮实测确认在隔离宿主真触发。

### C3 scope=all / scope=handoff（唯一标记词命中 / 同一正文一次结果最多一份 / L0 与 full 的 revision 一致）
- 判定：**PARTIAL**（子判据 1、3 通过；子判据 2 不成立，见缺陷 D-C3-1）
- 证据级别：**HOST+MOD**
- 真实操作：HOST POST /recall scope=all（面板同一路由）；MOD 直接调真实 engine.recall(…, handoff/all, {format:l0/full})；并做一条 legacy 对照（把一个只存在于 legacy 账本、不存在于任何维护文档的标记写进账本，再看它在两个 scope 各出现几次）。
- 期望：唯一标记词在 scope=all 与 scope=handoff 都能命中；同一正文在一次结果中最多一份；L0/full 下钻内容与 revision 一致。
- 实际（可复算）：
  - scope=all（HOST）：标记出现 3 次、documentId 4 次、ledger-doc: chunkId 1 次 → 命中成立。
  - scope=handoff：HTTP 路由白名单不含 handoff，返回 400 {"error":"invalid search scope"}；MOD 直调得标记 1 次且命中源为 维护文档/<documentId>。
  - L0 与 full 都含同一 revision sha256:bf9efb01a51a1645…（l0HasRevision:true / fullHasRevision:true）。
  - 重复计数实测：文档状态行「<A标记> A」在一次 scope=all 结果中出现 2 次（== 交接白板命中 == 臂 1 次 + == L0 命中(摘要…) == 臂 1 次）；legacy 对照标记（只存在于 legacy 账本）出现 1 次。
- 负路径与正对照：
  - 正：同一标记在 scope=handoff 命中 1 次、在 scope=all 命中（3 次文本出现）。
  - 负：真正不存在的标记（ZQC-DEFINITELY-ABSENT-MARKER-000）不出现 [检索不完整]，即「无命中」与「读失败」可分（C7 另证）。
  - 对照：legacy 源 1 次 vs 维护文档 2 次 —— 判据 2 不成立的直接依据（不是两臂都会重复，而是只有维护文档被两臂同时写入）。
- 证据路径：evidence/C/c3-scope-matrix.json、c3-dedup.json、c3-legacy-control.json、c3-dup-attribution.json
- 备注（缺陷最小复现 · D-C3-1）：工作区 A 只有 1 篇维护文档、正文含唯一标记；engine.recall(标记, 8, agentA, all, {format:l0}) → 该正文出现 2 次。分臂定位：searchHandoffCorpus 返回 1 条（where=维护文档/<id> revision=…），L0 臂的 r4DocumentChunks 也返回 1 条（chunkId=ledger-doc:<id>:<sectionId>:<revision>）⇒ 同一正文被两条臂各写一次。源码：lib/index.js:6011-6019（handoff 臂）+ lib/index.js:14274-14275（L0 臂），组装 lib/index.js:14243-14248。反向对照：legacy 账本无 memory 锚点，buildL0IndexPre 对它产 0 条 ⇒ 只出现 1 次，故重复是维护文档特有。不改代码，仅记录。
### C4 语义检索（chunk 身份 = documentId+sectionId+revision；正文变化后旧 chunk 失效；不同时返回新旧 chunk）
- 判定：**PASS**
- 证据级别：**PROC+MOD**
- 真实操作：真实 LedgerDocReadSide 对同一文档先后 chunks()/readChunk()；中间用真实 LedgerDocumentStore.updateDocument 改正文；另在 MOD 侧用真实 LedgerWal 提交后再取 chunk。
- 期望：chunk 身份含 documentId+sectionId+revision；改后旧 chunk 不再出现、新旧不同时返回、旧 chunkId 不被解析成旧正文。
- 实际（可复算）：
  - 身份：5 个 chunk 全部满足 chunkId === ledger-doc:documentId:sectionId:revision，且同一读内 5/5 唯一。
  - 改正文：sha256:bf9efb01a51a1645… → sha256:d1f94ce0327b2cd4…；旧 revision 的 chunk 计数 0；结果集内 distinct revision 1（新旧不同时返回）。
  - 旧 chunkId 读回 → {ok:false, error:document-chunk-not-found}；新 chunkId → 返回当前 revision 的文档；被改的那一节在恰好 1 个当前 chunk 中（revisedChunks=1）。
  - 单元判定（无 IO）：同正文 + 不同 revision ⇒ chunkId 不同；非法 documentId ⇒ 产出 0 个 chunk。
  - 合计 11/11 PASS。
- 负路径与正对照：
  - 负：旧 chunkId 必须失败（实测 document-chunk-not-found），不是读到旧缓存。
  - 正：新 chunkId 必须成功且带当前 revision。
  - 负：documentId=../evil ⇒ 0 chunk。
- 证据路径：evidence/C/c4-chunks.json、c1-sameproc.json
- 备注：**未做真实向量语义检索**（隔离宿主未启用语义档、无 bge-m3 索引），本轮验的是读侧 chunk 身份与失效语义（lib/ledger-doc/read-side.js:27-50），不是 embedding 召回质量；语义 A/B 仍属未做项。

### C5 事件下钻（只通过 members/检查点的显式绑定读当前文档；无绑定多文档返回 document-selection-required，不猜最近文档）
- 判定：**PASS**
- 证据级别：**HOST+MOD**
- 真实操作：HOST GET /api/dsh-auto-memory/event-detail?id=<evt>&sessionId=<sid>（A 与 C 两个工作区、含一个不存在的 event id）；MOD engine.expandEventRecordPre(evt, agent) 与 LedgerDocReadSide.forEvent/current。
- 期望：绑定事件能定位到文档并读到当前 revision；无绑定多文档必须要求选择、不猜最近文档。
- 实际（可复算）：
  - event-detail(A 事件) → 200，members = ["handoff/documents/synthetic-maint-a1-261111-1501.md"]。
  - 工作区 C（2 篇文档、无 manifest）：每个事件各自解析到自己的文档（c1→…c1…、c2→…c2…，无交叉）。
  - /state?ws=C 的注入文本中两篇文档标记各 0 次（不静默挑一篇）。
  - MOD：readLedgerDocForPre(C) → {ok:false, error:document-selection-required, documents:2}；readSide.current({}) → {ok:false, selection:ambiguous, document:null}；显式 documentId 正对照 → 成功。
  - 下钻正文带当前 revision（sha256:bf9efb01a51a1645…）。
  - 无绑定事件（evt_deadbeef）：HOST 404 event-not-found；MOD forEvent → {documents:[], selection:none}。
- 负路径与正对照：
  - 负：2 篇文档无 manifest ⇒ document-selection-required（不是取最近）。
  - 正：显式 documentId ⇒ 命中；绑定事件 ⇒ 命中。
  - 负：不存在的 event ⇒ 404 / selection:none，不猜附近文档。
- 证据路径：evidence/C/c5-drill.json、c2-c5-host.json、mod-engine.json
- 备注：/event-detail 只返回 members 路径，不返回文档正文；正文下钻在 MOD 侧（expandEventRecordPre）实测，HOST 侧以 members 绑定 + 读侧选择判据佐证。

### C6 材料指纹（同名同 mtime 正文改变必须改变 stamp；不改内容稳定；A 改 B 不变；读取失败进 readErrors）
- 判定：**PASS**
- 证据级别：**PROC**
- 真实操作：真实 HandoffMaterialStamp({handoffDir, enabled:true}).read()；用真实 LedgerDocumentStore.updateDocument 改正文后把 mtime 精确回拨到改前值；再放一篇自洽性被破坏的文档。
- 期望：同名同 mtime 改正文 ⇒ stamp 变；内容不变 ⇒ stamp 稳定；A 改 B 不变；读失败进 readErrors 且 complete:false。
- 实际（可复算）：
  - 稳定：连读两次 stamp 相同（sha256:f278a8491f94409a…）。
  - 同名同 mtime 改正文：mtime 实测 1794384431118.4539 → 回拨后 1794384431118（|Δ|<2ms），stamp sha256:f278a8491f9… → sha256:c2afb9193b0…；文档级 revision 同步变（sha256:567271d683dc… → sha256:3a38647675a3…）。
  - A 改 B 不变：B 的 stamp 与改前完全相同。改后再读稳定（同一新值）。
  - 读失败：植入一篇 revision 与正文不符的文档 ⇒ readErrors=[{source:document, code:MATERIAL_DOCUMENT_REVISION_MISMATCH, documentId:…}]，complete:false（ok:true）。
  - 合计 9/9 PASS。
- 负路径与正对照：
  - 负：读失败必须进 readErrors 并把 complete 打 false（不是静默当作未变化）。
  - 正：不改内容时 stamp 恒等；改内容后 stamp 必变。
  - 对照：A 变而 B 不变，证明 stamp 按工作区隔离。
- 证据路径：evidence/C/c6-c7.json
- 备注：mtime 回拨是这条判据的关键（否则「改了内容所以 stamp 变」无法与「mtime 变所以 stamp 变」区分）。

### C7 非法 ID / 绝对路径 / .. / 越界 symlink 全部 fail-closed；读失败与无命中分开返回
- 判定：**PASS**
- 证据级别：**PROC+HOST**
- 真实操作：PROC 直接打真实 LedgerDocReadSide.current/readChunk/list；HOST 在隔离工作区 A 内植入一篇损坏文档，前后各用真实 POST /recall 与 GET /state 观测，随后删除复测。
- 期望：非法标识/路径/越界链接一律拒绝且不泄漏根外内容；无命中与读失败在返回上可分。
- 实际（可复算）：
  - documentId 五类非法输入（C:/Windows/win.ini、../../../../etc/passwd、UNC、大写形态、空串）全部 {ok:false, error:document-id-invalid, document:null}。正对照：合法 ID 正常解析。
  - 无命中：{ok:false, error:document-not-found, readErrors:0}；读失败：目录里有一篇无法解析的文档时 list() → {ok:false, documents:1, readErrors:1(code=document-format-invalid)}；current({}) 的 readErrors 非空 ⇒ 与无命中可分。
  - 越界链接：在 handoff/documents/ 下建一条指向根外的同名 .md 链接（symlink 真造成功，linkMade:true）⇒ 读入被拒（document-not-found），返回体不含根外正文（leaked:false），list() 也不把它列为可读文档。
  - HOST 侧：干净时 incomplete:false；植入损坏文档后 incomplete:true 且同时出现 document-format-invalid 错误码；删除后恢复 incomplete:false 且标记命中回 3 次。
  - 合计 PROC 11/11 + HOST 4 项全过。
- 负路径与正对照：
  - 负：5 类非法 ID 全拒（其中「大写形态」证明不是只挡 ..）。
  - 正：合法 ID 可读。
  - 负：越界链接不泄漏根外内容。
  - 对照：无命中 vs 读失败在返回 shape 上可分（readErrors 空/非空、ok 真/假）。
- 证据路径：evidence/C/c6-c7.json、c7-readerror-host.json
- 备注：越界链接被拦的机制是「目录项类型 + 物理路径校验」双重判据（先 lstat/Dirent 判 isSymbolicLink，再 realpath 判根内），实测返回 document-not-found 而非把根外内容读进来 —— 语义上 fail-closed，但错误码不是专门的 document-id-invalid，属可改进点（仅记录，未改码）。

### C8 关闭开关后恢复 legacy 双读；不删除文档、不成为唯一接续来源
- 判定：**PASS**
- 证据级别：**HOST+MOD**
- 真实操作：只改隔离 DSH_HOME 的 dsh-auto-memory.json（ledgerDocEnabled:false）→ 重启隔离宿主（PID 13420→55288）→ 复测全部读面与 carry；随后改回 true 并重启（55288→50624）。
- 期望：关开关后行为回到 legacy 双读、维护文档不再被读侧服务、文件不被删、接续不以文档为唯一来源。
- 实际（可复算）：
  - GET /config → ledgerDocEnabled:false（确认真的落到运行态）。
  - 维护文档仍在盘上：documents/ 有 1 个文件、402 B、文件名同前。
  - legacy 内容照常命中：legacy 标记 2 次（白板 PLAN.md + 交接账本），维护文档标记 0 次、documentId 0 次。
  - carry(A)：ok:true、maintenanceDocument:null、legacy 标记 2 次、维护文档标记 0 次、carry 长度 1598 字符 ⇒ 回退到 legacy 材料而非空交接。
  - handoff-state 面板：ledgers:0 / planLen:0（该工作区无 PLAN，符合预期；说明面板不再从文档侧补料）。
  - MOD 侧同步：注入帧回到 legacy（legacy 标记 3 次）、维护文档 0 次；documents/ 文件数 1→1；LedgerDocReadSide 仍能读到该文档（ok:true）。
  - 复核后已把 ledgerDocEnabled 改回 true 并重启（当前 PID 50624、端口 19411 健康 200）。
- 负路径与正对照：
  - 负：关开关后维护文档标记 0 次（证明不是开关无效仍注入）。
  - 正：legacy 标记 2~3 次（证明 legacy 双读真的在工作）。
  - 正：文档字节/文件数不变（证明关闭不删除、不迁移）。
- 证据路径：evidence/C/c8-off.json、mod-engine.json、restart-log.json
- 备注：关闭态的「注入帧不含维护文档」是 MOD 级；HOST 级以 read 面 + carry 两条独立通道各证一次。
---

## 本线发现的缺陷 / 限制（只记录，未改任何代码）

1. **D-C3-1（产品行为，C3 判 PARTIAL 的依据）**：scope=all 的返回里，维护文档正文出现 2 次（交接白板命中臂 + L0 命中臂各 1 次），而 legacy 账本只出现 1 次。
   - 位置：lib/index.js:6011-6019（handoff 臂）+ lib/index.js:14274-14275（L0 臂）；组装 lib/index.js:14243-14248。
   - 复算：evidence/C/c3-dedup.json（documentBodyInAllResult:2）、c3-legacy-control.json（legacyOnlyMarker.inAllResult:1）。
2. **D-C3-2（观测面限制）**：HTTP /api/dsh-auto-memory/recall 的 scope 白名单只有 current/all/archive，memory_recall 工具支持的 handoff（以及 events/sessions）在面板/HTTP 面不可达。
   - 位置：lib/index.js:27966；实测 400 {"error":"invalid search scope"}（c3-scope-matrix.json）。
3. **E-C1-1（本线环境约束，非用户可见缺陷）**：createLedgerDocSystemPre({enabled:true, readOnly:true}) 仍会构造 EventStoreLedgerSink（lib/index.js:29361-29365），而该 sink 要求 storePath 位于 <cwd>/artifacts 之下（lib/ledger-doc/event-store-sink.js:16-26）。因此在进程 cwd 之外的隔离 memoryRoot 上构造会抛 event-store-sink-path-invalid。
   - 复算：evidence/C/sink-path.json；影响 MOD 夹具根位选择，不改码。

## 阻塞 / 未做
- **真实模型轮次**：宿主无模型轮次，C1 的「注入帧进入模型上下文」只能 MOD 级 → C1 判 PARTIAL。
- **真实向量语义检索**：隔离宿主未启用语义档（无 bge-m3 索引），C4 只验 chunk 身份与失效语义，未验 embedding 召回。
- **浏览器 UI**：本线未开浏览器（P4-2 面板属未实现范围），不在 C1–C8 范围。
- **面板/HTTP 观测注入正文**：/state 不返回 latestHandoffText/planText，无法在 HOST 直接读注入正文。

## 环境备注（按 Lead 要求写入）
- **重启与 PID 对应**：见首表（0→42408、1→56628、2→43160、3→13420、4→55288、5→50624）；每份 evidence JSON 带 at，可与 evidence/C/restart-log.json 对齐，未把重启前后数据混成一组。
- **memoryRoot / userMemoryDir 已改绝对路径**：隔离配置里设为 D:\dsh-auto-memory\artifacts\_r4-host-verify-20261111\memory-iso\workspaces 与 …\memory-iso\user（原为 ~/.dsh/...）。原因：lib/index.js:4505 expandUserPath() 对 ~/ 走 os.homedir()，与 DSH_HOME 无关，一旦回退成 ~/ 就会指向生产记忆根 C:\Users\JH Z\.dsh\memory\workspaces。改前已备份 dsh-home/dsh-auto-memory.json.bak-c0。
- **生产隔离复核**：C:\Users\JH Z\.dsh 下 ZQC-/synthetic-maint 标记命中 0；生产 dsh-auto-memory.json mtime 仍为 2026-10-31T01:24:01（未被写）；生产 19387 未重启。
- **一处需 Lead 知晓的自伤**：早期两轮 MOD 探针在未显式重定向 DSH_HOME 时运行，向生产 dsh-auto-memory-diagnose.log 追加了 1 行插件 R4 日志（L18369 2026-11-11T08:04:33.816Z R4 maintenance document selection failed: document-selection-required）。之后所有 MOD 脚本首行已固定 process.env.DSH_HOME=<隔离 home>；复测窗口内生产日志仅此 1 行 R4 相关记录，无强制件标记、无记忆正文、无生产配置写入。
- **隔离宿主当前状态**：PID 50624、端口 19411、ledgerDocEnabled=true，保持运行可用。

---

## 附录 D · 逐项详细验收

# Lane D · 历史查询与只读审计（D1–D3）

> 执行者：r4v-d。基线 HEAD `34cdd5e2`（实现 `10e66faf`）。全部夹具为合成数据，落在
> `artifacts/_r4-host-verify-20261111/fixtures/D/`。未修改 `lib/`、`tests/`、`tools/`、
> `skins/`、`docs/`、`package.json`（实测 `git status --porcelain --untracked-files=no -- lib tests tools skins docs package.json` = 空）。

> 三项的可达面说明（诚实边界）：`queryHistory` / `auditCoverage` 在 `lib/index.js` 中 **0 命中**，
> 只在 `lib/ledger-doc/system.js` 门面上作为方法存在，**没有 HTTP 路由或工具 action**；
> 因此 D1–D3 的**最高可达证据级别是 PROC+MOD，不是 HOST**，本报告不把它们写成宿主级已验证。
> 复算入口：`pwsh -NoProfile -File artifacts/_r4-host-verify-20261111/scripts/D/run-all.ps1`（实测 4 个探针 exit=0）。

### D1 历史查询：`[from,to)` + eventId/kinds/includeQuad + 分页全集 + 边界日不多不少
- 判定：PASS
- 证据级别：PROC（真实子进程 + 真实文件系统 + 真实 import `lib/ledger-doc/index.js`，真构造 `LedgerHistoryQuery`、真调 `query()`）
- 真实操作：在 `fixtures/D/d1/` 造合成事件库（4 事件 / 22 检查点）+ 5 个日日志 + 1 个 archive 冷日志；时区固定 `Asia/Hong_Kong`，区间 `from='2026-11-02'`／`to='2026-11-09'`（实测 `fromMs=1793548800000`、`toMs=1794153600000`）。真跑 15 条断言：区间解析、全集总数、集合等价、逐条 `at` 边界、边界事件、边界日日志源枚举、两组分页、`includeQuad`、`kinds`、`eventId`、负路径、便利入口、零写入。
- 期望：左闭右开 `from <= at < to`；`limit<total` 时 `truncated=true` 且 `nextCursor` 可续；分页并集 == 不分页全集（无缺、无重）；边界日记录不多不少；`includeQuad:true` 回持久化四段、`false` 回 null。
- 实际（可复算量）：
  - 全集 `total=23`，与按规格独立枚举的 inside 集 **23** 相等；独立枚举的 outside 集 6 条，**leak=0**。
  - 边界事件 `evt_d1b20002` 返回 id 列表 **`['b-from-equal','b-to-minus-1']`**，`at` 实测 **`[1793548800000, 1794153599999]`**（= `fromMs` 与 `toMs-1`）；`b-from-minus-1`/`b-to-equal`/`b-to-plus-1`/`b-far-before` 4 条全部排除。
  - 边界日日志：枚举到的 daily-log 源恰为 `logs/2026-11-02.md` … `logs/2026-11-08.md` **7 个**（连续 7 天），逐日 status 实测 `read, missing, empty, read, missing, missing, read`；**`logs/2026-11-09.md` 从未被枚举**（`to` 日不读）。`kinds:['fact']` 命中的 5 条为 `['log-from-equal','log-from-day-last','log-mid-0505','archive-mid-0606','log-to-day-last']`——`from` 当日 00:00:00 记录被包含、`to` 当日 00:00:00 记录被排除。
  - 分页 A（12 条检查点，`limit=2`）：**页数 6、cursor 5 个、收集 12 条、唯一 12 条、不分页 total 12**，并集与不分页列表逐项相同。
  - 分页 B（全区间 23 条，`limit=3`）：**页数 8、收集 23 条、唯一 23 条、不分页 total 23**；末页 `truncated=false`。
  - `includeQuad:true` 得 `goal='cg' state='cs' dead='cd' next='cn'`、`checkpointId='ckpt_0123456789abcdef'`、`identityMode='persisted'`；`includeQuad:false` 四段全为 `null`。
  - `kinds` 精确计数：`progress=15`、`handoff=1`、`fact=5`、`['handoff','progress']=16`；`eventId='evt_d1c30003'` 命中 3 条、未知 `evt_00000000` 命中 0 条且 `ok:true`。
  - 零写入：查询前后夹具 sha256 映射逐文件相同，`events.json` sha256=`6e655a51ca2c7da3bb44e1630a5fee997727fdb2dd71dc983196537b823805f8`。
- 负路径与正对照：10 条非法输入被 `HistoryQueryError` 拒绝并逐一核对错误码——`history-timezone-required`（无时区 datetime）、`history-time-invalid`（`2026-02-30`）、`history-range-invalid`（`from>=to`）、`history-kinds-invalid`（空数组、大写 kind）、`history-limit-invalid`（0 / 501）、`history-include-quad-invalid`（字符串 `'true'`）、`history-event-id-invalid`（尾随空格、`evt_zzzzzzzz`）；正对照：同一组参数合法化后 `ok:true`、`total=16`，且 `parseHistoryTime('2026-11-02T00:00:00+08:00')===parseHistoryTime('2026-11-02', ZONE)===1793548800000`。cursor 越界复用 3 条均被 `history-cursor-invalid` 拒绝，同 filter 续页正对照首条为 `page-02`。
- 证据路径：`evidence/D/d1-history-query.json`（15 checks，pass=15/fail=0）；夹具 `fixtures/D/d1/`（8 文件）。
- 备注：任务书 D1 未单列「分页后 items 总数 == 不分页总数」以外的缺陷点，实测未发现缺陷。

### D2 移除全部旧账本后仍能回答历史；事件库损坏返回 readErrors 而非「无记录」
- 判定：PASS
- 证据级别：PROC+MOD（PROC = 真实子进程对真实 FS 跑 `LedgerHistoryQuery`；MOD = 进程内真构造 `LedgerDocSystem` 并真调 `start()/queryHistory()/stop()`）
- 真实操作：`fixtures/D/d2/case/` 初始含 **3 个旧账本文件**（`handoff/handoff-20261102-090000.md` 56 B、`-20261104-120000.md` 57 B、`-20261106-180000.md` 62 B）+ `PLAN.md` + `documents/` 维护文档。先基线查询，再**真删除这 3 个账本文件**并复查，再**真删除整个 `handoff/` 目录**并复查；另造 5 个损坏变体（非法 JSON / 无日志 / 形状错 / 文件缺失 / 单检查点畸形）。门面路径用 `fixtures/D/d2/system/` 独立复制同一事件库与日志。
- 期望：删除旧账本不改变查询结果；损坏事件库必返回 `readErrors` 且 `ok:false`，并能与「真无记录」区分；日志证据仍在时不得被损坏事件库吞掉。
- 实际（可复算量）：
  - 基线 `total=7`、`ok:true`、`readErrors=0`；来源分布 event-checkpoint 4 / daily-log 2 / archive-log 1。
  - 删除 3 个账本后 `total=7`，`source.type|text` 序列与基线**逐项相同**（`deepEqual` 通过）；**删除整个 `handoff/` 后 `total=7` 仍逐项相同**。
  - 非法 JSON：`ok=false`，`readErrors=['event-store-invalid-json']`，`coveredSources` 中 event-store `status='error'`，日志记录仍返回 **3 条**（未被吞）。
  - 损坏+无日志 vs 合法空库（区分力关键）：损坏 `items=0, ok=false, readErrors=1`；合法空库 `items=0, ok=true, readErrors=0`——**同样 0 条，`ok`/`readErrors` 可区分**。
  - 形状错 → `event-store-invalid-shape`；文件缺失 → `event-store-read-failed` 且日志仍返回 3 条；单检查点 `at` 非数字 → `checkpoint-invalid`（带 `eventId='evt_d2b20002'`），同库另一事件的 1 条有效记录仍返回。
  - 门面：`enabled:false` 时 `queryHistory` 返回 `{ok:false,error:'ledger-doc-system-disabled'}`；`enabled:true`+`start()` 后 `total=7`，且门面根下 **0 个 `handoff-*` 账本文件**。
  - 查询零写入：`events.json` sha256 前后同为 `a5e4e94960c51ac270d06b4e21f3c8959a8c2b76e70f8c82badc10a2382d8835`。
- 负路径与正对照：上列 5 个损坏变体是负路径（必须返回 readErrors、不得静默），正对照是同一夹具在同一区间上的基线查询与「合法空库 `ok:true`」；另 `ok:true` 的未知 eventId 查询（D1 的 `evt_00000000 → total 0`）证明「真无记录」形态与「读取失败」形态可分辨。
- 证据路径：`evidence/D/d2-history-resilience.json`（11 checks，pass=11/fail=0）；夹具 `fixtures/D/d2/`。
- 备注：未发现缺陷。需说明 D2 的「移除旧账本」是**夹具内真实 unlink**，不是移动或改名；删除后复查的是同一 `LedgerHistoryQuery` 实例与新实例两种调用（两者结果一致）。

### D3 只读 coverageAudit：每输入恰一份报告 / 源 SHA 前后一致 / 报告可读回 / `eligibleForPhysicalDelete=false` + 篡改反向
- 判定：PASS
- 证据级别：PROC（真实子进程 + 真实 FS + 真实 import，真构造 `LedgerCoverageAuditor`、真调 `auditAll()` 与逐篇 `auditFile()`）
- 真实操作：`fixtures/D/d3/legacy/` 造 **3 篇**严格命名合成账本（`handoff-20261111-120000/130000/140000.md`，各 189 B）+ `event-store.json`（1,891 B，3 事件各 1 条 `kind:'handoff'` 检查点，正文与四段一致）+ `coverage-reports/` 报告目录。跑 `auditAll()` 全批、逐篇 `auditFile()`、重跑 `auditAll()`；随后做两路篡改：**改源文件一个词**（130000 篇 state 行）与**改事件库一条检查点 goal**，各自重跑。
- 期望：输入 3 → 恰 3 份报告 + 1 份 summary；报告 `reportBytes == readbackBytes == 磁盘字节`；源 SHA 审计前/报告内/重读/审计后四值一致；全部报告 `eligibleForPhysicalDelete=false`；篡改后结果必须变化或标红。
- 实际（可复算量）：
  - `auditAll()`：`ok=true`、`inputFileCount=3`、`total=3`、`reportCount=3`、`reports.length=3`、`persistencePass=true`；事件库快照与重读同 SHA `b319595346224e86e39ba69c8a83571b05a7b3f77b135f7e3fd354f2bb2b262c`（1,891 B）。
  - 报告目录实测只有 4 个文件：`coverage-summary.json` + 3 个 `<relPath>.json`；`summary.reports[].relPath` 恰为 3 篇输入；`status` 全 `written`；重跑两次文件名集合不变（**不会出 `-b/-c` 副本**）。
  - 逐篇 `auditFile()`：三篇 `reportBytes=5754`、`readbackBytes=5754`、磁盘 `diskBytes=5754`；三份 `reportSha256` 分别为 `5a6bdf3f3fecbbefd700eb3a15e1796905133a0079b35572326abb44b1746c2d`、`be32389c384adb535f5b6388780c2810d4356f1d5b872734cae4055135c3596b`、`4f5d70b3f18c92ec40cfa335e7728a0f0f832550a69b185876e9ee48b22fdd2f`，且每个都能用 `canonicalize(report−{reportSha256})` 重算出同值。
  - 源 SHA 四值一致（每篇各 189 B）：`f07c4dc4eff7be445da1aafb462cf395d3aba834bbcf825b7e214a46c5aa64c2` / `956ed26c6a994963b9751b8c2d12808a8e9410c7dd040b87b916a2f860be5289` / `f5ddd78af0252b4e32d7a451e01bab578c849c942310f349dc10bfdfc5f13dd2`，审计前=报告内=重读=审计后，且无 `source-changed-during-audit`。
  - `eligibleForPhysicalDelete`：3 份报告全 `false`、3 条 summary 索引全 `false`、`summary.eligibleForPhysicalDeleteCount=0`、从磁盘读回的 3 份 JSON 也全 `false`。
  - 五门全绿：`identityMapping/normalizedEquivalence/quadSemantics/bindingTimeline/reportPersistence` 各 `3 pass / 0 fail`，三篇 `disposition='covered'`、`review.required=false`。报告内不含整篇旧正文（`goal for SYNTH-`/`state for SYNTH-` 0 命中，只留 `regionDigests`）。
  - **篡改源文件反向**：130000 篇 SHA `956ed26c…` → `8508bbeeaf385dbdcc4fa124391ee8522b1ad0f7fb5404169b2a5461e5ac0a23`；`disposition` 由 `covered` 变 `pointer-only-content-diff`，`gates` 变为 `{identityMapping:true, normalizedEquivalence:false, quadSemantics:false, bindingTimeline:true, reportPersistence:true}`，`review.required=true`，未篡改的两篇仍 `covered`（不误伤）。
  - **篡改事件库反向**：只改 `evt_d3a10001` 检查点 goal 后，120000 篇 `content.pass=false`、`quad.pass=false`、`disposition='pointer-only-content-diff'`、`regionDiffs=1`——证明报告结论真的由「源正文 + 事件侧证据」共同决定，不是单侧自证。
- 负路径与正对照：负路径实测错误码——重复输入列表 → `audit-input-list-invalid`；`../escape.md`／绝对路径／非严格命名 `irregular-ledger.md` → `audit-source-name-invalid`；`sourceDir=lib` → `audit-root-invalid`；`reportDir===sourceDir` → `audit-report-root-invalid`；相对 `sourceDir` → `audit-path-invalid`。正对照：同一 auditor 用 2 个合法 `relPaths` 显式传入得 `ok=true`、`inputFileCount=2`；全量枚举时 `irregular-ledger.md` 被跳过（枚举数仍 3）。两路篡改是「结果必须变」的反向对照，且每次都有未篡改篇保持 `covered` 作正对照。
- 证据路径：`evidence/D/d3-coverage-audit.json`（14 checks，pass=14/fail=0）；夹具 `fixtures/D/d3/`（含 3 份 5,754 B 报告 + summary）。
- 备注：未发现缺陷。注意 `eligibleForPhysicalDelete` 在**报告体**与**summary 索引**两处独立钉 false（变异实测：只翻报告体时索引仍 false → 双向可比对）。

### D-MUT 隔离变异集（证明 D1–D3 断言有区分力）
- 判定：PASS（5/5 CAUGHT，还原复绿）
- 证据级别：PROC（每个变异体是 `mutations/D/<id>/lib/` 下的**整份 lib 复制**，相对 import 保持有效；共享 `lib/` 未被就地改动）
- 真实操作：复制 5 次整份 `lib/`，每次只做 1 处文本锚定替换（锚串命中数断言恰为 1），再用变异体跑同一夹具；另有 `RESTORED/` 为同一源码的干净副本复绿。
- 实际（可复算量）：`MUT-to-inclusive`（`<` → `<=`）→ 变异体返回 `['b-from-equal','b-to-equal']`，末边界泄漏被捕获；`MUT-page-cap`（`page.slice(0,limit)` → `page.slice(-5)`）→ `limit=2` 实返 5 条、分页并集 5≠12，被捕获；`MUT-swallow`（吞掉 `event-store-invalid-json`）→ 损坏库得 `ok:true / readErrors=0`，被捕获；`MUT-eligible`（报告体 false→true）→ 报告 `true` 而 summary 索引仍 `false`，被捕获；`MUT-frozen-sha`（源 SHA 冻结为全 0）→ 报告 `source.sha256` 与真实 SHA 不符，触发 `source-metadata-mismatch` + `source-changed-during-audit`，`disposition` 降为 `illegible-or-ambiguous`，被捕获。`MUT-restored`：`total=13`、边界 1 条、`eligible=false`、`disposition='covered'`，复绿。**CAUGHT 5 / MISSED 0**。
- 负路径与正对照：每个变异体自带一条「未变异基线绿」正对照（`total=13`、边界 1 条、`eligible=false`）与变异后必红判据；`RESTORED` 为还原复绿证据。
- 证据路径：`evidence/D/d4-mutations.json`；变异体目录 `mutations/D/{MUT-to-inclusive,MUT-page-cap,MUT-swallow,MUT-eligible,MUT-frozen-sha,RESTORED}/lib/`。
- 备注：`MUT-frozen-sha` 的捕获依赖**两路独立信号**（源元数据快照比对 + 审计期间重读比对），只去其中一路时另一路仍能报——未单独做「只留一路」的二次变异，属本轮未覆盖细化项（不影响 D3 判定）。

## Lane D 汇总

| 编号 | 判定 | 证据级别 | 断言 | 可复算量 |
|---|---|---|---|---|
| D1 | PASS | PROC | 15 | 全集 23；边界 id 2 条；分页 12→6 页/23→8 页；kinds 15/1/5/16；负路径 10 |
| D2 | PASS | PROC+MOD | 11 | 删 3 账本/删 handoff 后 total 均 7；损坏码 4 种；日志保留 3 条 |
| D3 | PASS | PROC | 14 | 3 报告/5,754 B/报告 SHA 3 个；源 SHA 四值一致；eligible 全 false |
| D-MUT | PASS | PROC | 7 | CAUGHT 5 / MISSED 0；还原复绿 |

**未做 / 边界**

- 未做 HOST 级：`queryHistory`/`auditCoverage` 无 HTTP 路由与工具 action（`lib/index.js` grep 0 命中），D 线无法升到 HOST。这是**能力可达面**结论，不是缺陷；若要 HOST 验收，需先有宿主侧入口（属 P4 接线范围）。
- 未做真实数据：全部合成；未触碰生产 `DSH_HOME`、真实记忆根与 `127.0.0.1:19387`。
- 未做跨设备/在线同步、未做真实迁移或物理删除。
- 观察（非本线引入）：`git status` 显示 `tools/_run-smoke-mut536-{101132,88376,99516}.mjs` 3 个**未跟踪**文件，来自其他线的 smoke 变异运行器；本线只写 `artifacts/_r4-host-verify-20261111/{fixtures,scripts,evidence,report-parts}/D*`，未写入 `tools/`。
## 交付物指纹（sha256 / bytes，可复算）

| 文件 | bytes | sha256 |
|---|---:|---|
| `report-parts/D.json` | 2605 | `1029dffe97ca79eb75726e460142567618ddd7520b8ea80f286f7061228487da` |
| `evidence/D/d1-history-query.json` | 6672 | `fb8155a85b679f08ab5563863fc59755c39a4f4850dc9b112c11bb70d88a7b7a` |
| `evidence/D/d2-history-resilience.json` | 5397 | `185701478c217909b9af802fa45ba3938a57fbd4a5325059aff9d6dde2ef45a4` |
| `evidence/D/d3-coverage-audit.json` | 15791 | `efdc8c8995551b77aa66cca259beac7976c7b3c85cfce05040d2d59ff0be3ba9` |
| `evidence/D/d4-mutations.json` | 2552 | `9f0a3e6b3c7b4e0fd4476ad697a672b10edf2b806f6807529a862c9d15b77360` |
| `scripts/D/d1-history-query.mjs` | 19865 | `cc062f971c07cf037d1a0cc6951104af5e510825573700170af3e42f0bcf0f7a` |
| `scripts/D/d2-history-resilience.mjs` | 16713 | `b922ddd58969e73cf7a140609fbc07e3b744883d90f231f8aa55c6c52607b4e2` |
| `scripts/D/d3-coverage-audit.mjs` | 19541 | `786faaa67b20ee18b7024024d95ceec25bd3c2b3936205afdb095ba1dac30e9b` |
| `scripts/D/d4-mutations.mjs` | 13522 | `1206be768136daeb51bc2741a440dcafb148a7d49f0fa20159efc2e795592e4d` |
| `scripts/D/run-all.ps1` | 1930 | `1d3dba71c1b5271fabc85b9c4ecd697eb55cea2e494896408212dc12955683b3` |

`report-parts/D.md` 自身不列入（自指指纹不可复算）；本表所列其余文件指纹在写表后未再变动。数值取自 `Get-FileHash -Algorithm SHA256` 与 `Get-Item.Length`。

---

## 附录 E · 逐项详细验收

# E 线 · 团队基线携带维护文档（E1–E8）

> 证据级别：**HOST** = 真实隔离 DSH 宿主进程 + 真实 HTTP 路由；**PROC** = 真实子进程 + 真实 FS + 当前 lib 真实代码；**MOD** = 进程内真 import→真构造→真调用。
> 本线 HOST 证据全部来自 **lane E 自建隔离宿主**：DSH_HOME=`artifacts/_r4-host-verify-20261111/fixtures/E/host-home`，端口 **19413**，插件来源 `link:D:/dsh-auto-memory`（不是生产的 19387，也不是团队共享的 19411）。
> 生产记忆根 `C:\Users\JH Z\.dsh\memory\workspaces` 实测 1647 个工作区，**零个**本线夹具工作区名泄漏（`evidence/E/safety-and-identity.json`）。

---

### E1 用户显式上传返回 documents:2，outbox 仍为 kind:'baseline' / key:'baseline:current'
- 判定：PASS
- 证据级别：HOST
- 真实操作：向隔离宿主 `POST /api/dsh-auto-memory/team-baseline` 依次发送 `{action:'upload'}`（无 ws）、`{action:'upload', ws:<src>}` 两次；随后直接读宿主进程 DSH_HOME 下的 `memory/team/team-outbox.json`。
- 期望：显式上传返回 ok:true 且 documents:2；队列项仍是 kind='baseline'、key='baseline:current'；重复上传原位替换不新增条目；未绑定工作区时拒绝且不入队。
- 实际（可复算）：
  - 无 ws：HTTP **400**，`{ok:false, error:'ws-required'}`；上传前后 outbox sha256 **不变**（`98fd4eeb…` → `98fd4eeb…`，count 1）。
  - 有 ws：HTTP **200**，`ok:true, documents:2, checksum:2c987d70ea8c1f35df2a919ead12c1c410a9a34b6f0d445255ef98405905f493, packedBytes:916`。
  - outbox 条目数恒为 **1**，kind=['baseline']、key=['baseline:current']；连续两次上传后 content checksum 仍为 `2c987d70…`，仅 `payload.at` 刷新（1794384180992 → 1794384202641 → 1794384202694），故文件 sha256 变化但内容身份不变（`evidence/E/e1-outbox-invariants.json` 的 5 条不变量全 true）。
  - 入包文件清单实测 6 项：`MEMORY.project.md, MEMORY.user.md, PLAN.md, documents/synthetic-doc-alpha-261111-0001.md, documents/synthetic-doc-beta-261111-0002.md, event-store.json`。
- 负路径与正对照：负 = 未绑定 ws 立即 400 且队列零增长；正 = 绑定 ws 成功返回 documents:2。两者同一进程同一路由。
- 证据路径：`evidence/E/e1-host-upload.json`、`evidence/E/e1-outbox-invariants.json`、`scripts/E/e1-host-upload.mjs`、`scripts/E/e1-outbox-invariants.mjs`
- 备注：HOST 级 first-run 曾因夹具键名（`man.SRC` vs `man.src`）拿到 400，属我方探针缺陷，已修正后重跑；产品行为两次一致。

---

### E2 pack→unpack→隔离 apply 后逐字节一致，documentId/eventIds/revision 一致，checksum 覆盖实际入包文档
- 判定：PASS
- 证据级别：HOST
- 真实操作：取 E1 由真实宿主产生的 payload 落成隔离 `baseline-offer.json`，对 `POST {action:'apply'}` 打到**另一个**空白隔离工作区；再逐字节比对源/目标两份 `documents/<id>.md`，并用 `LedgerDocReadSide._read()` 读回身份。
- 期望：10 项全绿——解包成功、checksum 覆盖两份文档、改动一个字节即失配、篡改被拒、清单与实包一致、apply 要求 expectedChecksum、错 checksum 被拒、apply 成功、逐字节一致、身份一致。
- 实际（可复算）：
  - alpha-261111-0001：**296 B**，sha256 `7d7c89070ca46183bdfc84e57d765dcc91c89e62dfbef1339466058bc10ebcb0`，源=目标；revision `sha256:0776d3e7…` 两侧一致。
  - beta-261111-0002：**295 B**，sha256 `46be6a6af35bdededbebf5dac46581c1595221add9d697f967a177759bb6cefa`，源=目标；revision `sha256:dc099fc0…` 两侧一致。
  - 两侧 eventIds 均为 `['evt_e1a2b3c4']`；两份 revision 与 payload 清单逐项相等。
  - checksum 独立重算 = `2c987d70ea8c1f35df2a919ead12c1c410a9a34b6f0d445255ef98405905f493`，与包内声明相等；把 alpha 正文一个标记词改掉后重算 = 变值，且该伪造包 unpack 返回 ok:false。
  - 无 expectedChecksum ⇒ HTTP 400 `expected-checksum-required`；错 checksum ⇒ `checksum-changed`。
  - apply 实际写入 6 项，含 `documents/` 两项，documentsAudit 两条 action 均为 `write-new`。
  - 汇总 **10/10**。
- 负路径与正对照：负 = 篡改 checksum / 改一个文档字节 / 缺 expectedChecksum / 错 expectedChecksum 全部拒绝；正 = 同一 payload 正常 apply 成功且字节一致。
- 证据路径：`evidence/E/e2-roundtrip.json`、`scripts/E/e2-roundtrip.mjs`
- 备注：无。

---

### E3 旧 v1 无 documents 的基线照常解包/应用；默认形状不因新功能改变
- 判定：PASS
- 证据级别：HOST
- 真实操作：用 `packBaselinePre` 打一份**不含 documents** 的 v1 基线（只有 event-store.json + PLAN.md），经真实宿主 apply 到隔离的第三工作区；再对照 E1 的含文档包。
- 期望：无 documents 的包 `payload` 与 `meta` 都不出现 documents 键；apply 结果同样不出现 documents 字段；目标工作区 documents/ 目录不被创建。
- 实际（可复算）：
  - pack：`{ok:true, v:1, files:['event-store.json','PLAN.md'], hasDocumentsKey:false}`。
  - unpack：`ok:true`，meta 键集不含 documents，names 长度 2。
  - apply：`ok:true`，返回对象**不含** `documents` 键；目标 PLAN.md 内容逐字为 `# legacy plan E3`；目标 `documents/` 目录 **不存在**（readdir 0 项）。
  - 正对照：含文档包 `payload.documents.length === 2` 且 `hasDocumentsKey === true`，说明两条形状确实可区分（不是两边都空）。
- 负路径与正对照：负 = 旧形状不得凭空长出 documents；正 = 新形状确实携带 2 条清单。二者在同一个 `packBaselinePre` 上并排取证。
- 证据路径：`evidence/E/e3-e5.json`（checks 前缀 E3-*）、`scripts/E/e3-e5-baseline-semantics.mjs`
- 备注：无。

---

### E4 同 revision 重放幂等不产生 -b/-c；目标不同 revision 默认 document-conflict 且字节不变
- 判定：PASS
- 证据级别：HOST
- 真实操作：对已应用的同一目标再 apply 一次；然后用真实 `LedgerDocumentStore.updateDocument` 在目标上制造本地分叉（alpha 正文改为 `LOCAL DIVERGED BODY E4`），再 apply。
- 期望：重放不写任何 documents 项、目录中不出现 -b/-c 文件；分叉后默认 apply 拒绝并返回 `document-conflict`，且两份文档字节逐一不变。
- 实际（可复算）：
  - 重放：`ok:true`，其中 `applied` 里 documents 项 **0** 条，目标 documents 目录恰为 `[alpha.md, beta.md]`（无 `-b`/`-c`）。
  - 分叉后：apply 返回 `ok:false, reason:'document-conflict'`；alpha 冲突前后 sha256 完全相同（`LOCAL DIVERGED` 版本保持不变），beta 字节也不变（`46be6a6a…` 前后一致）。
  - **有区分力对照**：同一判断在 E5 里对同一输入显式给 `local`，audit 立刻变成 `keep-local` 且 apply 成功——说明上面的「重放幂等」不是永远返回空写入的假绿。
- 负路径与正对照：负 = 分叉无显式选择必拒且字节不变；正 = 同 revision 重放成功且零文档写入。
- 证据路径：`evidence/E/e3-e5.json`（checks 前缀 E4-*）
- 备注：无。

---

### E5 分别显式选择 local/remote，核对实际写入与 documentsAudit，不得静默覆盖
- 判定：PASS
- 证据级别：HOST
- 真实操作：在 E4 的分叉目标上，依次提交 `documentResolutions:{alpha:'both'}`（非法）、`{alpha:'local'}`、`{alpha:'remote'}`，每次都核对磁盘字节与 documentsAudit。
- 期望：非法选择被拒；local 只保留本地且审计 keep-local；remote 才覆盖且审计 overwrite-remote，覆盖后字节等于包内字节。
- 实际（可复算）：
  - 非法值：`ok:false, reason:'document-resolution-invalid'`，一字节未写。
  - local：`ok:true`，audit `{documentId:alpha, action:'keep-local', localRevision:sha256:34a2c7ad…, remoteRevision:sha256:0776d3e7…}`；磁盘 alpha sha256 与选择前完全相同。
  - remote：`ok:true`，audit `{action:'overwrite-remote', choice:'remote'}`；磁盘 alpha sha256 变为 `7d7c8907…`，与源工作区逐字节相等（296 B 两侧相同）。
  - 未参与冲突的 beta 同一次 apply 里 audit 为 `noop`（不重复写）。
- 负路径与正对照：负 = 非法 resolution + 无 resolution 的默认路径都拒（见 E4）；正 = local/remote 各自成功且审计可区分。
- 证据路径：`evidence/E/e3-e5.json`（checks 前缀 E5-*）
- 备注：无。

---

### E6 第二篇 writer 故障时只回滚已写文件、未写文件与备份保留；重试不生成重复文件
- 判定：PASS
- 证据级别：HOST
- 真实操作：在隔离目标工作区里先造一个**本地分叉且被 `chmod 444` 只读**的 beta 文档，然后显式 `{beta:'remote'}` apply。第二篇写入走 `writeTextAtomicPreSync` 的 tmp→rename，Windows 上对只读目标 rename 抛 **真实 EPERM**（已单独用 `lib/config-io.js` 的真实实现验证：只读 ⇒ `{ok:false,error:'EPERM...'}`，改回可写 ⇒ `{ok:true}`）。故障排除后再重试。
- 期望：失败回执精确列出已写集合与失败项；回滚只作用于已写集合；未写文件（event-store/PLAN）与备份保持原样；重试成功且不产生重复文件。
- 实际（可复算）：
  - 默认（不给 resolution）先被 `document-conflict` 拒绝——证明故障注入前目标确实是冲突态。
  - 注入后：`ok:false`，reason 以 `write-failed: failed | rolled-back |` 开头并含 **EPERM**；`failedItems[0].name = 'documents/synthetic-doc-beta-261111-0002.md'`，错误串含 `lib/index.js:11652` 与 `lib/event-store.js:533`（真实栈帧）。
  - `applied` = `['MEMORY.project.md','MEMORY.user.md','PLAN.md','documents/synthetic-doc-alpha-261111-0001.md']`（4 项，beta **不在**其中）。
  - `rolledBack` 与 applied **逐项相同**（4 项），`rollbackFailed` 为空。
  - 未写文件保留：失败前后 event-store.json sha256 相同；第一份 alpha 已被回滚删除（原本不存在 ⇒ 删除，readdir 证实不存在）；beta 目标字节与 sha256 **完全未变**（只读挡住）。
  - 备份保留：`backup-baseline-2026-11-11T07-…` 目录存在，根下含 `event-store.json`/`PLAN.md`，`documents/` 子目录内含 beta 的旧副本。
  - 无 `.tmp`/`.dam-tmp` 残留。
  - 解除只读后重试：`ok:true`，写入两份文档；目录恰为 `[alpha.md, beta.md]`——**无重复文件**。
- 负路径与正对照：负 = 真实 EPERM 触发整批回滚；正 = 同夹具解除只读后同一条 apply 成功。故障不是 mock 假报错，是真实 FS 语义。
- 证据路径：`evidence/E/e6-writer-failure.json`、`scripts/E/e6-writer-failure.mjs`、`scripts/E/_probe-readonly-rename.mjs`
- 备注：失败分支如实返回 `teamPaused:true`（#547 语义），本线随后用真实 `/team-control` 恢复，未绕过闸门。

---

### E7 checksum 篡改 / 截断 / 非法 ID 与路径 / 重复文档 / 非法 eventIds / revision 不匹配 / 源或目标 symlink 越界 均拒绝
- 判定：PASS
- 证据级别：HOST + PROC
- 真实操作：24 条断言逐条真执行——12 条纯载荷负路径（PROC），12 条打真实宿主路由（HOST）。每条负路径都配同形合法输入成功。
- 期望：全部拒绝且错误码可辨；每条正对照必须成功，避免把夹具问题误报成产品正确。
- 实际（可复算，抽关键行）：
  - checksum 篡改 ⇒ `checksum-mismatch`；把 body 内一份文档改字节后重打包 ⇒ 仍 `checksum-mismatch`。
  - 截断到一半 / 砍掉尾部 8 字节 ⇒ 拒绝；空 body ⇒ `body-missing`。
  - 非法路径 7 例（`UPPER.md` / `../escape.md` / `a/b.md` / `//double.md` / 反斜杠 / 无扩展名 / `.MD`）全部拒绝；同形合法名成功打包。
  - 重复文档：数组内重复、数组与 files 冲突两条均 `duplicate-document`。
  - 非法 eventIds ⇒ `event-ids-invalid`；空 eventIds 行 ⇒ `document-format-invalid`（空格被 normalizeText 剥掉，fail-closed）；尾部多余逗号 ⇒ `event-ids-invalid`。
  - revision 不匹配 ⇒ `document-revision-mismatch`；时钟非法（先重算 revision 以隔离判据）⇒ `document-clock-invalid`。
  - 清单与实包不符 ⇒ `document-manifest-mismatch`。
  - **源目录 junction 越界**（HOST）：`upload` 返回 `document-upload-failed: document-path-invalid`，且 outbox 条目数不变；同一工作区换成真实目录后上传成功 documents:1。
  - **目标目录 junction 越界**（HOST）：`apply` 返回 `document-path-invalid`，越界目录内文件数 **0**；换成真实目录后 apply 成功写入 2 份。
  - **源目录内非法文件名**（HOST）：`UPPER.md` 存在时 upload 失败且队列零增长；同工作区合法名上传成功。
  - 汇总 **24/24**。
- 负路径与正对照：12 条负路径 ⇄ 12 条同形正对照，逐对配对（见 evidence checks 的 `E7-reject-*` 与 `E7-positive-*`）。
- 证据路径：`evidence/E/e7-negatives.json`、`scripts/E/e7-negatives.mjs`
- 备注：HOST 侧 junction 用 `fs.symlink(...,'junction')` 真实创建（Windows 上等价目录联接），非词法伪造。

---

### E8 R4 读侧关闭时文档仍可因用户显式基线动作被携带；不触发后台自动覆盖
- 判定：PASS
- 证据级别：HOST
- 真实操作：在隔离宿主上确认真实配置 `ledgerDocEnabled=false`；把一个**已下载的 offer 直接摆进 inbox**（模拟后台已拉到远端基线），观察 8 秒空闲窗口内目标工作区是否有任何后台写入；随后只发起用户显式 upload/apply，再观察 5 秒。
- 期望：读侧关闭状态下不会自动应用；文档只能随用户显式动作被携带；成功 apply 之后也不再被后台改写。
- 实际（可复算）：
  - `GET /api/dsh-auto-memory/config` ⇒ `ledgerDocEnabled:false`（前后三次读取均为 false）。
  - 空闲 8 s：目标工作区整棵树（相对路径+字节数+sha256 列表）**逐项相同**；`documents/` 目录始终不存在；inbox offer 的 sha256 未变；handoff 下**零** `backup-baseline-*` 目录。
  - 显式 upload（读侧仍为 false）⇒ `ok:true, documents:2`，队列仍只有 1 条 `baseline:current`。
  - 显式 apply ⇒ `ok:true, documents:2`，目标 `documents/` 出现 2 份。
  - apply 后空闲 5 s：整棵树逐项不变，backup 目录集合不变，offer sha256 不变。
  - 汇总 **9/9**。
- 负路径与正对照：负 = 有 offer 但无显式动作时零后台写入（含 8 s 与 5 s 两个窗口）；正 = 显式动作确实携带并落盘 2 份文档。二者同一进程同一读侧配置，唯一变量是「有没有用户显式动作」。
- 证据路径：`evidence/E/e8-read-side-off.json`、`scripts/E/e8-read-side-off.mjs`
- 备注：「不触发后台自动覆盖」是**在 8 s/5 s 窗口内未观察到的行为**，不等于证明了任意时长都不存在定时器；本项的判据边界如任务书 §5 所述属于本轮范围。

---

## 隔离变异（任务书 §4）

统一落在 `artifacts/_r4-host-verify-20261111/mutations/E1/`（整份 lib 复制，546 文件 / 195,736,460 B），工作树 `lib/` 全程未改（`git status --porcelain -- lib` 为空）。

| 变异 | 锚点命中 | 变异体 | 干净实现 | 判定 |
|---|---:|---|---|---|
| checksum-drops-documents | 1 | unpack `ok:true`（接受被改字节的文档） | `checksum-mismatch` | CAUGHT |
| revision-not-checked | 1 | pack `ok:true` | `document-revision-mismatch` | CAUGHT |
| conflict-silently-accepted | 1 | plan `ok:true`（静默接受冲突） | `document-conflict` | CAUGHT |
| document-id-not-validated | 1 | decode `ok:true` | `document-id-invalid` | CAUGHT |
| event-ids-not-validated | 1 | decode `ok:true` | `event-ids-invalid` | CAUGHT |

5/5 CAUGHT / 0 MISSED，干净实现 2 份文件 sha256 还原后复绿（`MUT-restored-green-*` 两条通过）。证据：`evidence/E/mutations.json`、`scripts/E/mutations.mjs`、`fixtures/E/mutation-variants.json`。

---

## 发现的环境级隐患（非 P4-4 产品缺陷）

隔离 DSH_HOME 里若把 `memoryRoot`/`userMemoryDir` 存成 `~/...`，`expandUserPath()` 会按 **os.homedir()** 展开到**生产记忆根**，与 DSH_HOME 无关。实测：`~/.dsh/memory/workspaces` → `C:\Users\JH Z\.dsh\memory\workspaces`。当前共享隔离配置已是绝对路径（另一条线改过），故该隐患**处于潜伏态、未被触发**；本线自建宿主时直接写入绝对 `memoryRoot`/`userMemoryDir` 规避。证据：`evidence/E/isolation-hazard.json`、`scripts/E/isolation-hazard.mjs`。

## 未做 / 边界

- 未做跨设备真实传输、真实团队服务端在线冲突，未打开生产团队同步。
- 未做 P4-2 面板 / P4-3 简报与归并扫描（任务书 §5 明确未实现，不计入本线）。
- E8 的「无后台覆盖」是有限窗口观察（8 s + 5 s），非无限期证明。
- 未跑全仓回归；本线只做指定真实宿主验收。

---

## 附录 F · 缺陷与环境隐患汇总

### 产品缺陷
- [A] OBS-1：EventStoreLedgerSink 构造要求 storePath 父目录已存在，否则抛 event-store-sink-path-invalid；契约文档未写明该使用前提
- [C] D-C3-1：scope=all 中维护文档正文重复出现两次（legacy 源只一次）
- [C] D-C3-2：HTTP /recall 的 scope 白名单不含 handoff/events/sessions
- [C] E-C1-1：readOnly 的 LedgerDocSystem 仍构造 EventStoreLedgerSink，要求 storePath 在 <cwd>/artifacts 下

### 环境/流程隐患（非产品缺陷，但影响验收可信度）
- [E] ENV-1：隔离 DSH_HOME 下 memoryRoot/userMemoryDir 若为 ~/... 会经 os.homedir() 指向生产记忆根
  - lib/index.js:4505 expandUserPath() 对 '~' 用 homedir()；实测 '~/.dsh/memory/workspaces' → 'C:\Users\JH Z\.dsh\memory\workspaces'，与 DSH_HOME 无关。当前共享隔离配置已是绝对路径故未触发；本线自建宿主使用绝对 memoryRoot/userMemoryDir 规避。
- [C] ISO-1：隔离破口：C 线早期两轮 MOD 探针未重定向 DSH_HOME，向生产诊断日志追加 1 行
  - C:\Users\JH Z\.dsh\dsh-auto-memory-diagnose.log:18369 —— "2026-11-11T08:04:33.816Z R4 maintenance document selection failed: document-selection-required"。Lead 亲自复核：全文件匹配行数 = 1，仅含聚合错误码，无记忆正文/路径清单/凭据；生产 dsh-auto-memory.json 5,940 B、mtime 2026-10-31T01:24:01 未变；19387 未重启未改配置。此后该线所有 MOD 脚本首行固定 process.env.DSH_HOME=<隔离 home>。证据 evidence/isolation-breach-prodlog.json。

---

## 附录 G · 复算入口

- A 线：`node artifacts/_r4-host-verify-20261111/scripts/A/probe-a2a3.mjs` / `node artifacts/_r4-host-verify-20261111/scripts/MUT/run-mutations.mjs`
- B 线：`node artifacts/_r4-host-verify-20261111/scripts/B/run-all.mjs`
- C 线：见附录 C 各段「证据路径」，脚本在 `scripts/C/`
- D 线：`pwsh -NoProfile -File artifacts/_r4-host-verify-20261111/scripts/D/run-all.ps1`
- E 线：脚本在 `scripts/E/`，证据在 `evidence/E/`
