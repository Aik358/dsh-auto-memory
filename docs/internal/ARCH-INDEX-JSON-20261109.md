# index.json 写放大治理：架构调查与落地方案

调查日期：2026-11-09（Asia/Hong_Kong）。代码基线：`eeef52b20533ad9710104859170af7b18d8b736b`。任务源：[调查提示词](PROMPT-INDEX-JSON-GOVERNANCE-20261109.md)。只读生产代码；实验、脚本、输入和原始输出均在 `artifacts/_index-gov-20261109/`。

路径口径：`lib/`、`tests/`、`docs/` 从仓库根解析；正文中的 `out/`、`work/`、`scripts/`、`consumer/`、`history/` 及实验脚本短名均相对 `artifacts/_index-gov-20261109/`。

标记口径：**[实测]** 包含当前源码/本机 git 取证和实际运行；**[推理]** 是设计建议、公式外推或工作量估算；**[未测]** 不作性能与可靠性承诺。文中的 ms 均为本次环境的墙钟时间，字节均为 UTF-8 逻辑数据量；不等于 SSD/NAND 实际写入量。

## TL;DR

1. [实测] 能把一次 source 更新从约 **7.38 MB** 全量写，降为 **33,248 B** 的 JSONL 事务；本次索引逻辑写量降低 **99.55%（约 222 倍）**。
2. [推理] 推荐 **统一 SidecarStore 接口 + source 级差量事务 + JSONL/checkpoint + 内存倒排**；先收口与补锁，再切格式。SQLite 保留为宿主核验后的替代后端。
3. [实测] 基线 sidecar 路径复刻中位 **129.07 ms**；JSONL 原型 **1.38 ms**，带文件 `sync()` **2.20 ms**；均不是完整白板工具时延。
4. [实测] 当前原子 rename 防半截 JSON，却挡不住丢更新：强制双写者同读基线，**20/20** 轮丢更新；整段共享锁后 **0/20**。
5. [实测] 两份倒排和 versions 都有消费者；可以取消其常态落盘，必须保留查询能力和兼容视图。
6. [实测] 提示把 UTF-16 长度当字节；真实 entries 占原文件 **84.74%**。仅去缩进只能降 **12.23%**。
7. [实测] 当前 2,848 条来自 PLAN 与 **687 份账本**，没有 archive 条目；329 份归档不是这次索引膨胀的直接来源。
8. [推理] 存储治理是 2.5 的前置之一；CAS、锚点规范化后的无变化判断、事件触发覆盖和 M1 仍须分别验收。

## 1. 基线复核：哪些数字成立，哪些必须纠正

### 1.1 文件与条目

[实测] 只读真实路径 `C:/Users/JH Z/.dsh/memory/workspaces/--D--dsh-auto-memory--/handoff/index.json`，SHA-256：`76ac012a1ba5af429d5699109043de33ca3bb6bbb0757b0a2968ccfbdd06e719`。记录见 `out/real-audit.json`、`out/markdown-recovery.json`。

| 项目 | 本次结果 | 对提示词的裁定 |
|---|---:|---|
| 文件 | 7,382,763 B；2,848 entries；7,336 cue；79 tag | 一致 |
| entries 的紧凑 UTF-8 值 | 5,559,319 B | 提示的 3,853,434 恰为 `JSON.stringify(entries).length`，是 UTF-16 码元数 |
| by_cue 的紧凑 UTF-8 值 | 679,619 B | 提示的 674,561 同为字符串长度 |
| by_tag 的紧凑 UTF-8 值 | 178,623 B | 提示的 177,489 同为字符串长度 |
| sourceRevisions | 596 键；紧凑值 61,968 B | 键数与此值成立，但不能与 pretty 文件占比直接混算 |
| 整文件取消缩进 | 6,479,694 B | 省 903,069 B，12.23%，仍是 MB 级全量写 |
| 当前索引来源 | 688 个 source：PLAN 1 + ledger 687 | 596 个 revision 键不等于 source 总数；92 个 source 缺 revision |
| kind 分布 | plan 5 条 + ledger 2,843 条；archive 0 | 否定“329 个归档造成当前 2,848 条”的直接因果 |
| 磁盘 PLAN 归档 | 329 份 / 4,097,500 B | 数字成立；当前默认索引未纳入它们 |
| PLAN 的索引条目 | 5 条，紧凑数组 33,020 B | 一次文档替换不是“只更新一张卡” |

[实测] 为使占比可相加，对每个字段按 `Buffer.byteLength(JSON.stringify({[k]:v}, null, 2).slice(2,-2))` 计实际 pretty 属性贡献；再计根括号和分隔符。以下恰好合计原文件字节，避免“紧凑子树/缩进全文件”混算：

| 部分 | UTF-8 字节 | 占原文件 |
|---|---:|---:|
| entries | 6,256,244 | 84.74% |
| by_tag | 211,007 | 2.86% |
| by_cue | 849,804 | 11.51% |
| sourceRevisions | 65,568 | 0.89% |
| version / ws / rebuilt_at / versions | 122 | <0.01% |
| 根括号、逗号和换行 | 18 | <0.01% |
| 合计 | 7,382,763 | 100% |

[推理] 取消倒排落盘有收益，但主成本是整份 entries 的重复发布；只删倒排仍解决不了写放大。entries 在索引内部是基础记录，在整个系统中仍是 Markdown 的派生物，不能误称最终真源。

### 1.2 一次白板写入与 2.5 的边界

[实测·既有采样复核] 提示引用的 `27,397 + 19,716 + 7,382,763 + 120 = 7,429,996 B` 算术成立，index 占 99.36%。代码确有归档、正文 atomic write、sidecar atomic write、审计追加四路：`lib/index.js:5290`、`:5352`、`:5357`、`:5362`。本调查没有调用真实 `writePlanSnapshot`，不将上述历史采样包装为本轮完整生产写入实测。

[实测] 本次固定日期渲染 53 条 list 投影事件，得到未锚定正文 **26,747 B**、锚定后 **28,549 B**，与提示里的 19,716 B 不同。旧 PLAN 仍为 27,397 B。原始锚点 34 个，`parseWhiteboardPre` 按 `###` 卡片口径识别 **30 张卡**；不能混称“34 张受 M1 检查的卡”。见 `plan-blockers.mjs` 和 `out/plan-blockers.json`。输入 hash 已记录。

[实测] 隔离调用真实 `preparePlanPre`：第三参 options 为 `{}` 时返回 `plan-version-conflict`；携带正确 `expectedRevision` 时通过（`lib/plan-store.js:247`）。冲突副本只写实验沙盒。`rendered !== anchoredPlanPre(rendered)`，而相同输入重复渲染相等；所以应在最终规范化正文上比较，不能把原始渲染与已加锚点磁盘正文直接比较。当前 `planRevisionPre` 已统一 canonical 文本口径（`lib/plan-store.js:45`、`:57`、`:59`），不应照抄旧评估中“raw 与 healed 摘要必不相同”的泛化。

[实测] 手动 fromEvents 已从旧 PLAN 原文解析 archivedIds（`lib/index.js:25080` 起），M1 不是“索引格式一改就自动修好”。`planAutoRedraw` / `redrawPlanFromEventsPre` 尚未接线；`memory_event` 分支和 `memory_log` 写事件的挂点不同。详见既有 [2.5 第二步评估](EVAL-25-STEP2-20261109.md) §2，以及当前 `lib/index.js:24848`、`:24878`、`:25677` 起。

[推理] `20 次/日` 与 `148.6 MB/日` 是既有采样下的情景估算，不是开启 2.5 后的生产计数。仅四个 memory_event 分支不能覆盖 memory_log，不能把该频次当实证。若确为 20 次同规模索引变更，索引侧从 **147.66 MB/日 → 0.665 MB/日**（不含压实、PLAN 正文、归档与审计）；这是公式外推。

## 2. 因果链：全量重建是怎么留下来的

[实测] 历史命令、完整输出、退出码见 `history/collect-evidence.mjs`、`history/evidence-manifest.json` 与相应 `.txt`；行号指当前基线。

| 时间 | 证据 | 对架构的影响 |
|---|---|---|
| 初始设计 | `docs/internal/WB-GRAPH-INTEGRATION-PLAN.md:162`、`:173`、`:174`、`:283` | 选择 Markdown 真源、单 JSON 派生缓存，写后钩子约 80 行预算；明确称 sidecar 丢失只损失“增量性能” |
| 初始规模假设 | 同文档 `:329` | 预计可见账本 ≤60 +20 归档窗口、条目数十级；没有把数千条作为常态 |
| 2026-09-17 | commit `ea4fa0b617f235988563fcc5a2457fabc44713ce`，03:58:37 +0800 | 已存在读整份、upsert、把 entries 映成空正文 docs 调 rebuild、覆盖 entries、pretty JSON 裸写 |
| 2026-09-22 | commit `8200f24a4c7d573620f231fc2805a21141521f9c`，02:41:23 +0800 | 235 KB 索引裸写曾导致白板闪空，才补 tmp+rename；**全量写早于原子发布** |
| 2026-09-22 的归档优化 | `history/history-archives.txt`；当前 `lib/index.js:5775`、`:5796` | collector 的 archive 改 opt-in，默认看板和复用该 collector 的重建都不读归档 |
| 注释 2026-09-24；收录提交 2026-09-26 | commit `d55dc899f75da52b4a9485cbd004417616b8a2c1`；`lib/wb-sidecar.js:407`、`:545` | 为修“白板只剩一行”改成分节多条目；保留原全量存储结构 |
| 2026-10-03 | commit `8d67626f2353ccf058e9eddd4ce381952904c2b1`，04:11:00 +0800 | PLAN 加锁/CAS/sourceRevision；真实 entries 又重算 tag/cue，旧空正文 rebuild 没移除，重复计算被保留 |
| 2026-10-25 | commit `49d99735885a26bf6b759117b09ab9239ab7d736`，23:45:22 +0800 | 移除 sidecar 写侧 graph 门，旧/事件档同样付出写成本；部分附近注释已过时 |
| 2026-11-09 | 当前 2,848 条 / 7.38 MB | 自动重绘放大既有成本，暴露瓶颈；手动 PLAN 写早已付出同样量级的成本 |

[推理] 有证据的解释是：**小规模假设 → 单文件派生缓存 → 写钩子复用全量构造器 → 事后补原子发布 → 分节与账本累积 → 高频触发暴露线性成本**。“为了简单”是由小规模假设、构造器复用和行数预算推得，未找到作者明确如此表态的 commit，不能作为原话引用。

[实测] 当前每次写调用的是 `lib/index.js:5476` 的**空正文伪文档纯函数 rebuild**，不是每次扫描全部 Markdown；缺失/过期自愈才走 `:5517` 的磁盘收集。两者不能把耗时与职责混成一个“重建”。

| 项目 | 必须，还是当前选择 | 证据/替代 |
|---|---|---|
| 改一份 PLAN 后序列化全 entries | [推理] 当前“单个 JSON 对象 + 整份读取契约”下的成本；系统语义不要求 | 换事务日志、分片或数据库后只发布受影响 source；不做原 JSON 就地字节补丁 |
| by_tag/by_cue 每次落盘 | [实测] 有消费者；[推理] 落盘不是必要条件 | `buildByTagPre`/`buildByCuePre` 从 entries 纯派生，内存提供相同接口 |
| 每次执行空正文 rebuild | [实测] 结果的 entries 和两倒排随后被覆盖；[推理] 重复工作可移除 | `lib/index.js:5476` 至 `:5483`；versions 应从真实 entries 构建 |
| sourceRevisions 596 键 | [实测] 仅 PLAN 键有当前语义读者 | 保留 PLAN 新鲜度守卫；其余键是否继续持久化应由新的 source 新鲜度策略决定，收益不足以单独立项 |
| 完整快照可见性 | [实测] 历史事故要求；[推理] 必须保留 | 保留旧快照直到新事务完整、校验通过，再发布内存视图；分片仍用 atomic rename |
| 多写者更新不丢 | [实测] 当前未达成；[推理] 应补 | 从读取基线前锁住整段事务，仅锁最终写入不足 |

## 3. 消费者普查与八字段活跃度

### 3.1 范围与可复算证据

[实测] `consumer/audit-consumers.mjs` 运行了全仓 tracked 文本查询和当前代码 `rg` 查询，分别 **4,021 / 853** 命中行；lib 范围 **112** 行。完整命中逐行保留于 `consumer/all-repository.txt`、`all-code.txt`、`runtime-fields.txt`。通用 `versions` 中包含发布版本等同名噪声，不能算成白板消费者。原始查询参数、退出码、stderr 见 `consumer/manifest.json`。

```powershell
node artifacts/_index-gov-20261109/consumer/audit-consumers.mjs
rg -n 'index\.json|readSidecarIndexPre|_loadSidecarIndexPre|by_cue|by_tag|sourceRevisions|\bversions\b' lib tests tools -g '*.js' -g '*.mjs'
rg -n 'sourceRevisions' lib tests -g '*.js' -g '*.mjs'
```

[实测] 四项定点空结果均 **exit=1、stdout=0、stderr=0**，不是命令失败：`ws-no-semantic-read.txt`、`named-read-function-absent.txt`、`other-index-families-no-read.txt`、`vendor-no-read.txt`。提示中的 `readSidecarIndexPre` 不存在，实际加载器为 `_loadSidecarIndexPre`。无消费者结论限于所列仓内源码；原文导出与外部用户脚本不在“无语义读者”的推断范围内。

### 3.2 全部活跃语义消费路径

| 消费者 | 文件:行号（读字段） | 用途/条件 |
|---|---|---|
| memory_expand | `lib/index.js:5574` → `lib/wb-sidecar.js:588` entries、`:591` by_tag、`:592` | 按 tag 找条目，缺倒排时扫描 entries；工具三种模式均注册（index:26220 起） |
| memory_trace | `lib/index.js:5600` → `lib/wb-sidecar.js:626` entries、`:630` versions | 找自身、邻居与归档列表；不只 graph 档注册 |
| 接续标签导航 | `lib/index.js:5611`、`:5612`、`:5613`、`:5615`；调用 `:8514` | by_tag 前 8 项及计数，仅 graph |
| graph 看板 | `lib/index.js:5723` → `lib/wb-sidecar.js:1162` entries、`:1163` by_tag、`:1164` versions、`:1202`、`:1234`、`:1271`、`:1273`、`:1277` | 后备条目、tag 统计、versionCount；默认卡正文另从 Markdown 切分（index:5717），不是全由 index entries 生成 |
| 结构化检索臂 | `lib/index.js:5995`、`:5996` entries、`:5997` by_tag、`:5998` by_cue、`:6002`、`:6003`、`:6005` | cue/tag 命中 id 后映射正文预览；仅 graph，失败回落词法 |
| 面板 structured 输出 | `lib/index.js:8936`、`:8937` by_tag、`:8938` entries、`:8939`、`:8941`、`:8945` version、`:8946`、`:8950`、`:8951`、`:8956` rebuilt_at | 返回标签、按 kind 统计、摘要与元数据；不能据此宣称当前前端展示所有字段 |
| 加载器自身 | `lib/index.js:5561`、`:5562` sourceRevisions/entries | 仅检查 PLAN revision；失配触发全重建 |
| 原始 JSON 文件查看 | `lib/index.js:8892` 白名单、`:8910` 原文读取；路由 `:26643` | `?file=index.json` 不经过加载器，是整份内容的不透明导出，迁移时必须接住 |

[实测] 表中是加载器的 **6 个业务调用入口 +1 个原文导出路径**；不是七个代码文件。存储实现门为 **5 个方法 /6 处直接 IO**：`writeSidecarEntryPre`（`:5451`、`:5452`）、`_writeSidecarIndexPre`（`:5494`）、`rebuildSidecarIndexPre`（`:5527`）、`_loadSidecarIndexPre`（`:5561`）、原文查看（`:8910`）。核心语义集中于 `lib/index.js` 与 `lib/wb-sidecar.js` 两个模块。

### 3.3 八字段矩阵

| 字段 | 有无消费者 | 证据 | 治理结论 |
|---|---|---|---|
| entries | 有 | wb-sidecar:588/626/1162；index:5562/5996/8938 | Markdown 派生的基础记录；需保留，可变更持久化布局 |
| by_tag | 有 | wb-sidecar:591/1163/1271；index:5612/5997/8937 | 内存派生，取消常态落盘，不删能力 |
| by_cue | 有 | index:5998/6003 | 同上 |
| versions | 有 | wb-sidecar:630/1164/1202/1234 | 当前为空仍有读者；保留兼容行为，版本链语义另验收 |
| sourceRevisions | PLAN 有；非 PLAN 键仅生成/复制 | index:5465 写 PLAN，5481 搬运，5519 生成全部；5562 唯一语义读者固定 PLAN 键 | 不可整体砍掉；非 PLAN 595 个现存键无语义消费证据，不等于不需要未来新鲜度元数据 |
| version | 有，元数据透传 | index:8945；graph-mode 测试:119/120 | 旧加载器尚无 schema 校验，新存储应校验；保留返回字段 |
| ws | 无仓内语义读取；生成+原文导出 | wb-sidecar:564；空查询 ws-no-semantic-read | 可从路径重建，兼容视图保留；无需为省 32 B 专门破坏契约 |
| rebuilt_at | 有，元数据透传 | index:8956；`lib/state-commit.js:14` | 时间戳不可作提交版本；新格式另用 generation/seq |

[实测] 普查同时排除了几个同名系统：Tier-0 从缓存语料生成（`lib/index.js:10053` 起、`lib/tier0-catalog.js`），L0 索引为 `<semantic-pre>/l0/l0-index-<wsHash>-<layer>.json`（`lib/l0-index-sync.js:10`），`lib/m4-corpus.js:81`/`:88`/`:97` 是另一类 per-file sidecar。所列模块和 vendor/dsh-graph 的定点查询为空，不能把此次白板存储治理扩成语义索引迁移。

[实测] **M1/archivedIds 不读本索引**。`lib/index.js:5881`/`:5882` 由 Markdown 得 before/after，`:5897` 传 archivedIds；`lib/memory-mutation.js:95`、`:99` 至 `:106` 比集合。改 sidecar 格式不用改保护门，也不能借机删锚点、改 ID 算法。

## 4. 实验方法与规模曲线

### 4.1 环境、输入与计时边界

[实测] 原生 Node **v24.18.0**，可执行文件 `D:/nodejs/node.exe`；Windows `10.0.26300`，Ryzen 7 9700X，Node 所带 SQLite `3.53.1`。完整版本在 `out/results.json.environment`。本次没有在生产 Electron 进程中运行基准，不能把 Node 可用的 `node:sqlite` 推断为 Electron 必然可用。

[实测] 固定 xorshift 种子 **20261109**；规模曲线由常量中文词表生成，不依赖用户语料。每项 3 次热身、15 次采样取中位；启动重建 1 次热身、7 次采样。无清 OS 缓存，无设备写计数器；`read` 是 `readFile(...,'utf8')`，不含 JSON.parse；`atomicWrite` 是预生成文本写 tmp + rename，不含 stringify；`+sync` 另对文件 `sync()`，未做 Windows 父目录 fsync。

[实测] 合成 2,848 条为 8,020,803 B，与真实 7,382,763 B 不同，合成语料含归档类 source、不同 cue/tag 基数。它用于同分布规模趋势，不冒充真实工作区的精确预测。

### 4.2 可复算曲线

| entries | pretty 字节 | stringify ms | parse ms | atomicWrite ms | +sync ms | read ms | 内存建倒排 ms |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 100 | 282,044 | 1.017 | 0.313 | 8.920 | 10.528 | 1.215 | 0.152 |
| 500 | 1,406,922 | 4.259 | 2.111 | 8.033 | 12.383 | 4.114 | 0.351 |
| 1,000 | 2,807,317 | 7.083 | 2.692 | 10.074 | 17.364 | 7.236 | 0.477 |
| 2,000 | 5,626,823 | 13.597 | 7.318 | 14.756 | 27.144 | 13.651 | 1.265 |
| 2,848 | 8,020,803 | 19.954 | 7.401 | 16.763 | 39.202 | 21.564 | 3.055 |
| 5,000 | 14,106,197 | 44.294 | 15.896 | 31.381 | 61.876 | 36.305 | 5.969 |

[实测] 对六个中位点做普通最小二乘，n=entries；完整原始 15 点采样、拟合参数在 `out/scale-raw.json`：

| 指标 | 拟合 y=a+b·n | R² |
|---|---|---:|
| pretty 字节 | -8,289.27 + 2,821.440n | 0.999998 |
| stringify ms | -1.439 + 0.008633n | 0.9792 |
| parse ms | 0.091 + 0.003073n | 0.9756 |
| atomicWrite ms | 6.034 + 0.004693n | 0.9546 |
| atomicWrite+sync ms | 7.485 + 0.010795n | 0.9949 |
| read ms | 0.251 + 0.007213n | 0.9979 |
| 内存建倒排 ms | -0.459 + 0.001225n | 0.9620 |

[推理] 本分布呈近线性成本；小样本固定开销、GC、缓存使时延不严格单调，负截距不具 n→0 意义，不能外推成普适硬件曲线。source 事务成本取决于受影响文档大小和 cues/tags 数，理论上与工作区总条目解耦；本次未跑各规模的增量事务曲线，不声称已验证任意规模恒定时延。

### 4.3 “启动重建”必须分三种

| 重建类型 | 本次实测 | 不能混称的内容 |
|---|---|---|
| entries → 内存 Map/倒排 | 合成 2,848 条 3.055 ms | 已有解析后的基础 entries，无文件读取/Markdown 解析 |
| checkpoint+短 JSONL → 内存 | PoC-A 40.211 ms；日志 36 行 /1,196,919 B | 含 checkpoint 与 log 读取/parse/replay；不是从 Markdown 恢复 |
| 真源默认全恢复 | 688 文档 /2,123,008 B；收集+纯 rebuild 中位 **493.149 ms**；其中收集中位 418.074 ms、纯 rebuild 76.873 ms | collector 为当前代码复刻，rebuild 为真实纯函数；不含 sourceRevision 摘要、序列化与落盘 |
| 显式纳入归档的全恢复 | 1,017 文档 /6,220,508 B；5,246 条，新增 2,398 个 archive 条目；总中位 **793.739 ms** | 收集和纯构造各自中位为582.624/203.718 ms；各分项中位相加不必等于合计中位 |

[实测] 此表采用独立运行的第二轮原始采样，首轮与主实验争用IO，收集+构造中位1,324.863 ms，未用作此处基准；两轮差异显示缓存/调度影响不可忽略。默认恢复的 2,848 个 id 与现有索引 **全部匹配**。这证明当前样本 id 能恢复；未证明所有富字段、顺序和业务输出逐字节等价，也不证明恢复时源文件不会被另一进程修改。此前 100 ms 级“rebuild”不能代表整个磁盘恢复成本。

## 5. 可运行 PoC 与方案对比

### 5.1 相同变更与正确性检查

[实测] 使用真实索引内 PLAN 的 5 条基础记录：改一条正文/cue/tag，删一条旧 section，添一条新 section，最终仍为 5 条。替换事务携带该 source 的全体新 entries，隐含删除旧集合；不拿“单条 upsert”偷换整文档更新。

[实测] A/B 的验证将全 entries 按 id 排序、posting 按 id 排序后，与预期 entries 和生产 `buildByTagPre`/`buildByCuePre` 对照，得到 2,848 条 /7,338 cue /80 tag。**证明的是集合等价**。删后再插入会改变迭代顺序；`expand('*')`、限量检索等的截断顺序、versions、sourceRevisions 和完整八字段业务契约尚未验证。

### 5.2 原型数字

| 指标 | 当前 sidecar 路径复刻 | A：JSONL + checkpoint | B：每 source 原子 JSON | C：SQLite WAL |
|---|---:|---:|---:|---:|
| 单次写逻辑字节 | 7,383,007 | **33,248** | **33,163** | payload 33,021；观察到主库+WAL长度增长 74,160 |
| 单次写中位 ms | 129.070（未 sync） | 1.377；sync **2.198** | 4.810；sync **5.788** | FULL **4.297**；NORMAL 2.790 |
| 写时延 p95 ms | 142.264 | 1.737；sync 3.592 | 10.813；sync 18.049 | FULL 8.711；NORMAL 5.972 |
| 读取 ms | 整份 read+parse **34.841** | 单 id Map.get 0.0002 | 单 source read+parse **4.970**；Map.get 0.0003 | 单 id SELECT+parse **0.0093** |
| 重建内存中位 ms | 单独启动未测 | **40.211**，含 base/log read+replay | **251.583**，读 688 分片，并发上限16 | **67.167**，已打开连接上的全量 SELECT+parse+倒排 |
| 迁移核心 ms | 不适用 | **47.670**，生成+sync 写 checkpoint | **4,907.314**，生成并逐个 sync 写688分片 | **281.686**，已打开建表后批量插入、commit、checkpoint |
| 新存储初始体积 B | 7,382,763 | checkpoint 5,621,397 | 5,664,869 /688文件 | 主库/WAL/SHM合计 8,306,688 |

[实测] 基线复刻包含读整索引、source 替换、空正文 rebuild、真实两倒排 rebuild、pretty stringify、tmp+rename；排除生成 newEntries、源正文写入、归档、门禁和修订摘要。A/B 的写时延包含更新内存倒排，但没有生产跨进程锁、追尾和发布协议。C 是同步 SQLite 调用，不能由低单次时延推出不会阻塞宿主事件循环。

[实测] 表里的 Map.get 与整份读取、SQL SELECT **不是同一个读接口负载**，不能据此宣称对用户“读快十万倍”。SQLite 启动未计 open/schema/WAL 恢复；三个迁移核心计时都未计原索引 read/parse、验证、manifest 发布与并发收敛。SQLite 文件增长代理值不包括覆盖、空间复用和后续 checkpoint，不等于实写字节。

### 5.3 故障覆盖

| 原型 | 本次跑了什么 | 结果与边界 |
|---|---|---|
| A | 在完整行后手工追加 1,017 B 不完整尾部，重放完整前缀、截到最后提交换行，再追加完整事务；另造中间坏行 | 完整前缀保留、恢复后可继续写、中间坏行拒绝；修尾 7.032 ms。未真实 kill 写进程/断电；不允许泛化为“任何坏行都跳过” |
| B | 写913字符（实际1,040 B）残tmp，再读已发布shard，并再次原子替换 | 原bench只比较条数。补强实验另造不同的新候选，写913字节残tmp后逐字节验证旧目标不变，再发布并逐字节匹配新目标；没有跨source原子提交 |
| C | 子进程 BEGIN 后 DELETE PLAN，未 COMMIT 即 `process.exit(77)` | 父进程仍见5条 PLAN；证明这次未提交删除未生效，未模拟断电、COMMIT中途或持久介质损坏 |

[实测] 补强脚本 `history/crash-strong.mjs`、日志 `out/crash-strong.json`：A的37行/1,230,167 B日志副本加913 B残尾，恢复后与原日志字节完全相同；追加新事务后38行、零残尾，完整entries/倒排/source集合与预期一致，另外2,843条记录逐字段不变。B旧33,163 B、新33,250 B候选hash不同；残tmp不改旧目标，发布后完整匹配新候选。原bench存储hash保持不变，测时没有重跑。

[未测] 新协议的真实多进程并发、seq 单调/幂等的写协议、跨进程缓存失效、压实崩溃恢复、格式发布与回滚、外部编辑后的完整一致性，不能由部分文件故障注入推定已经通过。补强脚本校验样本seq/checksum，不等于已实现完整生产协议。它们是落地阶段的阻断验收项。

### 5.4 至少三层的决策矩阵

下表性能数字沿用上表口径；“改动面/成本”均 [推理]，不是已实现统计。

| 方案 | 单次写量 | 写耗时 | 读耗时 | 启动成本 | 迁移 | 原子可见性 | 并发安全 | 改动面 |
|---|---|---|---|---|---|---|---|---|
| L0 现状 | 7.38 MB | 129.07 ms复刻 | 34.84 ms全读 | 默认真源恢复0.493 s，不含写 | 无 | 整份JSON原子替换 | **RMW仍可丢更新** | 现有2核心模块；6业务入口+1原文导出 |
| L1 短路/去重复/紧凑JSON | 无变更0；有变更约6.48 MB | 完整改法未测；64.80 ms当前CPU复刻，22.28 ms仅现有对象stringify下界 | 新读路径未测，仍全读parse | 同格式；真源恢复保留 | 无格式迁移 | 保留atomic helper | 必须另补全段index锁 | 必改index.js，若加共享帮助模块则再1文件；7消费路径回归 |
| **L2-A 推荐** | 当前fixture33.25 KB；压实另计 | 1.38 /sync2.20 ms原型 | Map.get仅下界；完整loadView未测 | 40.21 ms base+短log | 核心47.67 ms，完整未测 | 一行完整事务+内存快照发布；旧JSON出口由adapter提供 | 同workspace独占事务锁+seq/generation；原型未实现 | 新增store+改index.js/wb-sidecar.js，约3生产文件；适配7路径 |
| L2-B source分片 | 33.16 KB | 4.81 /sync5.79 ms原型 | 单source4.97 ms | 688文件251.58 ms | 核心4.907 s | 单source atomic | 同source需锁/CAS；跨source需额外代际协议 | 同样约3生产文件；还需分片删源/目录发布 |
| L3-C SQLite | payload33.02 KB；增长代理74.16 KB | FULL4.30 ms原型 | SELECT .0093 ms | 67.17 ms内存装载，开库恢复未测 | 核心281.69 ms，完整未测 | 数据库事务；旧JSON导出走adapter | 数据库写事务+busy/retry策略；跨源更完整 | 约3生产文件+宿主能力/打包验证；7路径适配 |

[推理] 选择 A 的原因是本仓零必需运行时依赖、宿主 SQLite 可用性尚未核实，并且基准证实当前一份 source 事务足够小。B 的688小文件使迁移和启动成本上升；本次不优先。C 在事务/并发协议上更成熟，若实际 Electron 探针通过且团队愿意接受该运行时约束，值得替换 A；本次 Node24 测通不足以宣布可以默认部署 C。**不会因为 PoC append 很短，就把恢复、压实与多进程协议的工程量算成几行。**

## 6. 推荐方案：以 API 隔离格式，以事务维护差量

### 6.1 接口与数据边界

[推理] 以下是**拟新增内部接口**，不是现有 API：

```text
SidecarStore.open(canonicalProjectDir, configEpoch)
  loadView() -> 完整八字段只读兼容视图
  replaceSources([{source, expectedRevision, sourceRevision, entries}], {operationId, parserVersion})
  removeSources([...], {operationId})
  rebuild(sourceProvider, options)
  compact()
  exportLegacySnapshot() -> 完整 v1 JSON 文本
  close() / invalidate()
```

[推理] 业务继续从 `_loadSidecarIndexPre` facade 拿视图；storage API 在每个物理 workspace 有独立实例/锁，根目录迁移后失效。不能用一个全局 Map 混不同 workspace。`?file=index.json` 改为 API 生成最新完整兼容文本；不能每次变更再落旧 JSON，否则写放大原样回来。外部程序直接读磁盘旧文件不自动获兼容，须明确支持边界与一次性导出工具。

[推理] 常态更新按 source 比较 `sourceRevision + parserVersion`；相同则 **零写入**，不能先生成新的 ts/mtime 再把它当内容变化。PLAN revision 沿用 `planRevisionPre` 的 canonical 语义；其它 source 要定义原文摘要，不能拿 PoC 的 entries JSON hash 冒充真源 revision。

[推理] 内存维护 `entriesById`、`idsBySource`、`byTag: Map<string, Set<id>>`、`byCue`，为旧条目摘 posting、为新条目加 posting；清空 source 删除该 source 的全部旧条目。使用 source 桶避免为删5条遍历2,848条，Set 避免 posting 数组 `.includes` 的线性去重；维护代际快照，事务全部应用后一次发布。必要时进一步按 entry diff，只写真实变化条目；本次 source 全量33 KB已达到目标，无须先引入更细协议。

[推理] 显式保留排序契约：相同 id 替换保留旧槽位，新 id 在确定位置插入；或者定义稳定排序并回归所有限量输出。PoC 的“集合一致”不是足够验收。`versions` 应从真实 archive entries 构建，不能继续拿 text:'' 伪doc 算；是否把 archive 纳入索引及真正现行卡→历史链的 join，须单独定规格，不在性能补丁里无声改变查询范围。

### 6.2 磁盘提交和恢复协议

[推理] 磁盘为不可变 checkpoint + JSONL 事务日志 + 小型 generation manifest。每行带 schema、generation、seq、operationId、sourceRevision、完整 changes、checksum；一行可以包括 PLAN 与本次归档 source 的多项更新。seq 是一致性序号，`rebuilt_at` 仍只是时间。manifest只在换代时更新，不为每条append再发布一次元数据快照。

1. [推理] 复用 `shared-state-lock.js`，对 canonical index 事务键取锁；**读取基线/追尾 → 校验source当前真源revision与本次sourceRevision一致、索引基线符合expectedRevision → append → 文件sync（选定承诺）→ 发布内存视图** 整段在锁内。不同workspace不同锁；相同workspace的PLAN、账本、维护、自愈重建都用同一锁。不能只锁最终write，也不能让较旧的源快照晚到后覆盖新索引。
2. [推理] `loadView`在短时同一事务锁内核对generation并追尾；offset是该读者在当前generation内已完整校验的行末边界，不是未经校验的文件长度。完整checksum行界定可见事务；sync后才作durable成功确认，两者不混称。写者释锁后读者才观察该次已完成提交；进程崩溃留下的完整但未确认行按operationId/sourceRevision恢复判定。校验后在临时视图应用再整体发布，API永远返回完整对象。当前JSON直读消费者都改走facade，“完整JSON”不变量在读API与兼容出口保持；生产读锁/追尾时延尚未测。
3. [推理] 末行缺换行/不完整：视为未提交，不先跳过再直接append；独占锁下确认没有活写者，截到最后确认边界，再继续。换行完整但checksum/JSON坏，或中段坏行：隔离该generation、保留证据、拒绝悄悄继续；从Markdown重建可用视图，明确stale状态。reader不得擅自truncate另一个writer正在写的尾部。
4. [推理] `sync()`影响掉电后已确认提交的存活承诺，不取代锁、checksum或整事务可见性。派生索引可选择崩溃后从Markdown恢复，但必须保留未索引/脏源检测；不能“磁盘append失败、内存发布成功、仍返回新鲜”。PLAN既有写成功回执与sidecar stale状态分别处理。
5. [推理] 压实记录checkpoint截止seq=N；锁外生成checkpoint时旧日志可继续增长。发布前在同锁下捕获N之后完整尾部，把它重编码为新generation日志（首条N+1，保留seq/operationId并重算checksum），验证至当前提交seq后才atomic换manifest；没有尾部时新log首条由下次事务取N+1。读者拒绝缺号、重号与混代，失败保留旧generation。读者一次固定generation，旧文件延迟回收；禁止truncate仍被读者当作旧generation读取的日志。重试operationId在日志/检查点保留的去重窗口内，同ID同内容返回既有结果、同ID异内容拒绝；超出保留窗口须靠expectedRevision重新裁决，不承诺无限期exactly-once。
6. [推理] Markdown先提交、sidecar后失败的窗口仍存在。至少保留当前PLAN revision检查；为ledger删改加入显式失效登记、按需校验/重扫策略。重建采集跨文件不天然一致，发布时需sourceRevision复验；锁顺序固定为受理/源文件锁→sidecar锁，禁止读侧持sidecar锁再取PLAN锁导致反序死锁。重建可锁外采集、锁内校验并有限重试。

[推理] 设当前5.62 MB checkpoint、8 MiB日志阈值且事务大小稳定33,248 B，压实均摊额外约22.3 KB/事务，总约55.5 KB/事务；这只是字节模型，**压实未实测**。阈值应随checkpoint大小调整以限制均摊放大，并在后台执行；不能只报append33 KB而隐藏周期性全量写。

### 6.3 文件与工程量

本表为 [推理] 的实现估算，均未改动。

| 文件 | 拟改内容 | 估算量级 |
|---|---|---:|
| `lib/sidecar-store.js`（新增） | workspace实例、共享锁、兼容视图、source差量、checkpoint/log恢复、压实、导出 | 约400–700行 |
| `lib/index.js` | 五个存储门统一委托；两写口、读修复、原文导出、迁移生命周期收口 | 约80–160行触达 |
| `lib/wb-sidecar.js` | 去伪doc构造依赖；复用/补充真实entries派生帮助函数与排序、versions规则 | 约40–100行 |
| `tests/smoke/`（实施阶段） | 存储协议行为、多进程、崩溃/压实、兼容导出与7条消费路径 | 约250–450行，按实际风险确定 |

[推理] 生产约3文件、约520–960行量级；不是承诺精确diff行数。L1可先只改index.js约20–40行去重复构造，另补全段锁及错误传播约80–150行，完整实施前再细化。本次未修改上述生产/测试文件。

[实测] 现有测试有源码字符串守卫和直接磁盘JSON断言，例如 `tests/smoke/smoke-test-board-index-atomic.mjs:34`/`:36`、`smoke-test-graph-mode.mjs:119`/`:120`、`smoke-test-issue164-plan-cas.mjs:40`/`:44`。应把“源码必须包含某行/磁盘必须某格式”转为对应行为验收，同时保留完整JSON与CAS语义，不能把测试变绿等同于旧格式已兼容。

## 7. 迁移与回滚

### 7.1 存量迁移

1. [推理] 新代码先只接统一接口、保持v1读写，完成锁/错误路径验收。格式切换前停掉所有旧写进程；旧版本不会遵守新manifest，单纯增一把新锁无法阻止旧进程继续写旧JSON。
2. [推理] 同workspace受理屏障内读一次旧index；校验schema/ws/id唯一性/source合法性，保留未知entry字段，不重新生成ID。解析失败则从Markdown重建；默认是否含archive遵守既定范围，不能迁移时擅自扩大到5,246条。
3. [推理] 在新generation路径写checkpoint和空log，记录sourceRevision/parserVersion/seq。旧index保留一份，不反复备份7 MB文件；验证entries、tag/cue、versions、排序、7条业务输出，并复验PLAN与源文件摘要。
4. [推理] 验证通过才atomic发布小manifest。失败则不发布，新版仍读旧格式/真源恢复；不覆盖源Markdown、不删除旧index。schema未知时明确报错/降级，不盲目把任意JSON当新格式。
5. [推理] 正式切换后旧JSON仅作迁移备份，原文查看走最新兼容导出；停止每写双写旧JSON。运行期只保留新格式为索引权威，Markdown继续是内容真源。

[实测] A核心写checkpoint47.67 ms；B4.907 s；C核心插入281.69 ms。当前真实文件read+parse基线34.84 ms。**完整迁移wall time未测**；源验证、共享锁等待、发布和宿主缓存失效尚未计入。[推理] A复用旧索引的核心串行工作量可按34.84+47.67≈82.51 ms粗估，另加上述协议成本；不是端到端中位数或SLA，亦非统计下界。若走真源恢复，当前样本独立采样仅收集+构造约0.493 s，应另计生成和发布。

### 7.2 回滚不能只翻开关读旧文件

[推理] 新版运行后会产生旧index没有的新内容。回滚须暂停新写、同锁追完日志、从**最新store视图**导出完整v1，复核最新Markdown/sourceRevision，再atomic写回旧index，校验后停新版并启动旧版。只恢复迁移时备份会丢“索引新鲜度”，即使Markdown还在也可能使旧工具读旧结果。

[推理] 新store不可读时保留证据并从Markdown重建v1。当前真源恢复注释/实现、versions范围有缺口，应先明确范围并通过故障验收，不能宣称“任意错误恢复100 ms”。旧版本恢复后不再与新版并行写；新格式文件待验收后另行回收，不把清理作为恢复成功的前提。

## 8. 风险清单（按严重度）

| 级别 | 风险/证据 | 缓解与验收 |
|---|---|---|
| P0 | [实测] 同workspace多个RMW更新丢失。强制同读20轮，40个writer全ok、20份完整JSON、20次丢更新；整段共享锁后0/20 | [推理] 所有writer/读修复共用canonical index事务锁；锁从基线读取前开始，多进程与不同workspace隔离分别验收 |
| P0 | [推理] 新旧格式混写、迁移时旧进程继续写、回滚恢复旧缓存 | 切换排除旧写者；新代际校验；回滚从最新视图导出并对真源复核，不常态双写 |
| P1 | [推理] JSONL多调用append可能交错；残尾后再append污染整行；读者truncate活writer | 单writer事务锁、整行checksum/seq、锁内尾修复；完整坏行隔离重建，不静默跳过 |
| P1 | [实测] 当前tmp+rename无fsync；[未测] 新协议断电持久性 | 明确“源文件已提交、索引可丢弃”契约；若承诺durable才逐事务sync；实测sync成本，不把rename称为断电保证 |
| P1 | [实测] 当前默认重建不含archive；空正文伪doc版本键反例失真 | 固定收集范围；versions从真实entries构建；版本链扩展另做规格；重建/增量交叉对照 |
| P1 | [实测] 两同名archive节反例，原2个id的versions被伪doc路径折成1个且路径重复 | 删除冗余构造前补行为基准，明确现行卡→历史链是否实现；不可用“当前为空”删能力 |
| P1 | [实测] PoC集合等价忽略顺序、versions、sourceRevision；[推理] 限量结果可能改变 | 八字段和7类业务输出交叉验收，保序或明确定序；外部编辑后验证新鲜度 |
| P1 | [推理] Markdown已写而sidecar失败，内存误报新鲜；只PLAN现有守卫不覆盖ledger外改 | 不发布未提交内存状态；stale显式可观测，修复基于源摘要；重建发布复验 |
| P1 | [推理] 跨进程缓存未追尾或压实读到混代 | generation/seq/offset、读取同代、校验后整体发布；老代延迟回收，故障注入覆盖各切换点 |
| P1 | [实测] sidecar读修复未走完整migration admission；[推理] 切根写旧根/锁反序 | store纳入现有受理、drain与invalidate；固定锁序；读修复不得拿sidecar锁反向取源锁 |
| P2 | [推理] 日志增长使启动与压实尾延迟上升 | 记录append和compaction均摊字节、p95；阈值按工作区大小调整，后台压实，超预算停止扩大自动触发 |
| P2 | [未测] Electron对node:sqlite/文件锁/句柄争用的真实行为 | 宿主内探针与实际装包回归；Windows有界重试，绝不unlink/copy回退破坏atomic |

[实测] 并发脚本 `history/concurrency.mjs` 原样抽取当前生产两个方法，只在沙盒注入read barrier；锁对照使用现有 `withSharedStateLock`。这是**确定性交错证明，不是生产概率与多进程吞吐基准**。versions反例见 `history/semantics.mjs`、`semantics.json`。

## 9. 分阶段落地与止损

本表均为 [推理] 的实施步骤与验收目标。

| 阶段 | 独立交付 | 验收判据 | 做不下去就停 |
|---|---|---|---|
| S0：固定契约与边界 | source范围、排序、8字段视图、旧原文出口、锁序、stale语义；宿主SQLite能力探针 | 全部消费者有归属；PLAN/ledger/归档策略明确；真源与id无变化 | versions/归档语义或外部旧JSON支持范围不明确，不切格式 |
| S1：旧格式收口+正确性+L1 | 统一存储门；所有RMW/修复共用锁；去空doc重复构造；规范化无变更短路；保留atomic | 强制交错和真实多进程均不丢更新；零变化零写；原7路径输出等价；stale能观测 | 任何id/保序/M1/CAS差异无法解释即停；L1不宣布增量治理完成 |
| S2：完整增量适配器沙盒验收 | A的seq/checksum、source删除/多source事务、缓存追尾、压实、故障恢复、迁移/回滚 | 固定样本单变更索引逻辑写≤64 KiB（计划预算，非任意长文档限制）；正常写不落整库；真实kill、残尾、坏中段、混代等均返回完整视图；8字段+7业务路径等价 | 多进程更新丢失、坏行静默吞、恢复后不能继续写、压实回放不等价，任一即停，旧v1继续可用 |
| S3：单workspace格式迁移 | 迁移后读新格式；停止常态旧快照双写；验证回滚导出 | 存量2,848条id和字段/排序守恒；新写、重启、外部编辑、配置切根、回滚后7路径通过；记录完整迁移成本 | 若需每写整份v1才能兼容，则撤销切换，重新定出口契约 |
| S4：重评2.5自动重绘 | 独立补CAS、最终锚定正文no-change、M1归档语义、所有事件writer覆盖 | 事件不变时PLAN/索引/归档均零新增；有变更走唯一正文写口；stale/失败不误报事件失败；计实际总字节/尾延迟 | CAS永久冲突、重复重绘、M1刷屏或丢用户区即关闭自动触发，保留手动通路 |

[推理] S1可以独立收益并降低竞态，不必等格式迁移；S2/S3完成后仍不直接打开2.5。不存在以“定时少写”代替存储治理的验收，因为手动保存同样有既有全量成本。

## 10. 复跑命令、原始产物与诚实边界

```powershell
# 在仓库根运行；所有写入只发生于专用实验目录。
node artifacts/_index-gov-20261109/consumer/audit-consumers.mjs
node artifacts/_index-gov-20261109/history/collect-evidence.mjs
node artifacts/_index-gov-20261109/history/concurrency.mjs
node artifacts/_index-gov-20261109/history/semantics.mjs
node artifacts/_index-gov-20261109/scripts/bench.mjs --fixture --verify-fixture-only
node artifacts/_index-gov-20261109/scripts/bench.mjs --fixture
node artifacts/_index-gov-20261109/scripts/markdown-recovery.mjs
node artifacts/_index-gov-20261109/history/crash-strong.mjs
node artifacts/_index-gov-20261109/plan-blockers.mjs
node artifacts/_index-gov-20261109/verify-sources.mjs
```

[实测] 已封存固定输入：复用 `work/poc-a/base.json` 的原始基础记录与 `out/fixture-meta.json` 的小元数据，`--fixture` 在内存恢复原八字段。已真实执行预检，重建pretty JSON的SHA-256与原文件完全一致，不再复制一份7 MB原文件。基准复跑会覆盖专用实验存储与测时日志，应先保留要比较的日志；跨机器时延受硬件/负载影响，不承诺相同。

[实测] `bench.mjs` 不带 `--fixture` 时，`INDEX_GOV_SOURCE` 可指定只读旧索引，文件不存在则使用固定seed合成输入，曲线始终独立生成。Markdown全恢复与plan-blockers仍需要真实Markdown/事件目录，不能从index fixture还原原文。命令与输入说明见实验目录 `README.md`、`benchmark-summary.md`。

| 原始产物 | 内容 |
|---|---|
| `out/results.json`、`out/run.jsonl` | 环境、所有基准中位/p95/原始采样、PoC数据与限制 |
| `out/scale-raw.json` | 六个规模的原始采样、seed、线性拟合 |
| `out/real-audit.json`、`out/markdown-recovery.json` | 字节/字符纠错、source/kind、真源恢复范围与耗时 |
| `out/plan-blockers.json` | 当前2.5 CAS/no-change/卡片计数复核，真源未改变检查 |
| `out/fixture-meta.json`、`out/fixture-seal.log`、`out/fixture-verify.log` | 不重复复制大文件的固定输入封存、逐字节SHA预检 |
| `out/crash-strong.json` | 残尾恢复与不同候选分片发布的强字节/逻辑断言 |
| `out/official-sources.json` | 官方文档抓取地址、hash与相关行；不依赖二手性能说法 |
| `out/evidence-manifest.json` | 消费者/历史取证与并发、语义反例原始日志的索引及副本 |
| `out/verification.json` | 报告表格与原始数字核对、12个脚本语法检查、固定fixture预检、生产目录差异检查 |
| `consumer/consumer-audit.md`、`history/summary.md` | 可追溯调查底稿；最终裁定以本报告为准 |

[实测] 文件刷盘和SQLite方案曾通过 `find-docs` / Context7核查，并直接读取固定版本Node官方源文档：来源：[Node v24.18.0 fs](https://github.com/nodejs/node/blob/v24.18.0/doc/api/fs.md)、[Node v24.18.0 SQLite](https://github.com/nodejs/node/blob/v24.18.0/doc/api/sqlite.md)、[SQLite WAL](https://sqlite.org/wal.html)。文件flush默认并非开启，append不能代替多写者同步；WAL的FULL/NORMAL持久性承诺有区别。文档保证不替代本机故障实验。

[未测] Electron宿主实际时延/SQLite可用性；真实掉电；完整新协议与多进程追尾/压实；完整迁移/回滚；所有消费者端到端业务等价；新格式SSD物理写入；2.5上线后的频次。相关项目已列为分阶段验收，不用原型数字替代。

[实测] 交付校验命令：`node artifacts/_index-gov-20261109/scripts/verify-delivery.mjs`。报告规模表/恢复耗时与原始JSON一致，固定fixture重建SHA一致，12个实验脚本语法检查通过；`git diff --exit-code -- lib tests tools` 为零。新增内容仅本报告及专用实验目录，用户原有未跟踪文件保留。本次未运行全量生产回归，也未实施推荐方案。

[推理] 最终建议是立项治理**存储边界和事务协议**，把“全量重建”降为缺失/损坏/显式修复的恢复路径，把正常写变成受影响source的事务。此次已证实几十KB增量的可行性；可靠发布所需的锁、新鲜度、恢复与兼容成本必须一起实现。

## 后续补充：模块化 API 原型（2026-11-09）

[实测] 用户进一步要求模块化原型后，已新增 `prototypes/sidecar-store/`。公共入口 `index.js` 导出 `SidecarStore`、`MarkdownSidecarAdapter`、统一错误类型，并提供 `index.d.ts`。[接口、分层和运行方式](../../prototypes/sidecar-store/README.md) 包含可直接运行的示例；本节更新的是后续原型状态，前述首轮实验原始数字保持原口径。

[实测] 已实现统一读写API、source/多source事务、保序内存倒排、source CAS、幂等窗口、跨进程锁与追尾、残尾恢复、严格seq/checksum、精简checkpoint、原子换代压实、旧格式导入导出和参数快照。checkpoint不落两份倒排，正常写只追加一条事务日志。

[实测] 固定2,848条样本通过真实模块API更新PLAN五条记录，追加 **33,568 B/事务**；含共享锁、参数校验、文件sync与内存发布的中位 **13.265 ms**（2次热身、7次采样）。这比§5简易append原型做的工作更多，两者时延不可混用。manifest/checkpoint在正常写期间不变。记录见 `out/prototype-fixture.json`。

[实测] 完整测试 **27/27通过**：包含24次双进程更新、同版本竞争、三处指定边界真实SIGKILL、恢复后继续写、调用后修改入参的隔离、坏记录拒绝、重启/压实幂等和原八字段/expand/trace兼容。原始日志 `out/prototype-tests.tap`、`out/prototype-tests.json`；可复跑 `node prototypes/sidecar-store/tests/run-contracts.mjs`。

[未测] 此原型尚未接生产Markdown写锁、迁移admission/drain和stale诊断；未验证Electron/断电场景。压实采用全程持锁的简化协议，旧代保留、无自动GC；不以此宣称2.5已可开启或完整生产迁移已完成。
