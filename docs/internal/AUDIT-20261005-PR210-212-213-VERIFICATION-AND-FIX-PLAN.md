# 社区 PR #210 / #212 / #213 全量核查与修复方案（2026-10-05）

> 核查基线：`wip/20260926-teamwork @ a97d2b5`（v3.2.9）。三条 PR 均基于 main 3.2.8（f2f7cc1），与 3.2.9 线平行演化。
> 方法：3 个并行核查员各负责一条 PR（逐 claim 现行源码取证），lead 抽验两项关键判定（均实证）；#213 核查员在临时 clone 实际应用 PR 验证生成器铁律与守卫套件。
> 结论先行：**三条 PR 无虚报**（18 项 claim：15 成立、3 部分成立、0 误报），质量显著高于社区平均，但都**不整盘合并**——拆取采纳 + 剔除夹带 + 两处裁定变更走用户确认。#179/#201 两个观察项保持不动；**#212 的 workspace-key 重键落在 #179 决策领地，本轮不采纳**。

---

## 0. 总表

| PR | claim | 判定 | 采纳建议 | 备注 |
|---|---|---|---|---|
| #210 | 1 cont-seq 写失败仍发号/无跨进程锁/冷扫猜0 | 成立 | B 改造 | 锁原语与 calendar-lock 归一；fail-closed 软化；「不跳号→允许空洞」需裁定确认 |
| #210 | 2 接续闩 200 条上限挤丢 | 成立 | **A 采纳** | 五条里最干净；附 mtime 缓存小改造 |
| #210 | 3 pending 状态/重启安全/恢复 CLI 缺失 | 成立 | **A 采纳** | 最重的一条：模糊错误后盲目二次创建 |
| #210 | 4 归档账本整快照覆盖/写失败静默 | 部分成立 | **A 采纳** | 未知年龄保护现行已有，PR 是保持 |
| #210 | 5 rc.2 绑定失败丢原始 ID/二次 create | 成立 | B 改造 | 「泛化回退→类型化回退门」修订 2026-09-28 裁定，需确认 |
| #212 | 1 keep/rename 导入 clobber 大文件/inventory 吞错 | 成立 | B 改造 | 不引入 `link()`，用 lstat 复核+原子写达成同等互斥 |
| #212 | 2 note append 可串写到别的项目 | 成立 | **A 采纳** | 服务端设施现树已齐（resolvePathsForSession） |
| #212 | 3 面板删除无 CAS、并发追加丢失 | **成立（高危）** | **A 采纳** | lead 抽验实证；全 PR 性价比最高，约 +8 行 |
| #212 | 4 POSIX→Windows 搬包 JSON 非法转义 | **成立（已复现）** | **A 采纳** | 核查员用现行纯函数复现出损坏 JSON |
| #212 | 5 设置页陈旧响应覆盖 | 成立 | A 采纳（生成器线） | 前端，走三份同步 |
| #212 | 6 异步排序混代帧注入 | 成立 | **A 采纳** | context-host 约 +20 行 |
| #212 | 7 procedure 证据五子项 | 成立 | B 改造 | owner ref 用现行 canonicalize，**不用 ws-v2 哈希** |
| #213 | 1 设置分组/生效态反馈 | 成立 | B 改造 | 分组重排与修复目标无关可拆 |
| #213 | 2 草稿跨皮肤切换丢失 | 成立 | **A 采纳** | 需真实浏览器矩阵验收 |
| #213 | 3 陈旧响应（初始 vs 广播水合） | 成立 | **A 采纳** | 与 #212 claim5 同源，合并实施 |
| #213 | 4 设置校验/迁移重试安全（settings-safety.js） | 成立 | **A 采纳** | 核心件；损坏配置+一次保存=全回默认 实锤 |
| #213 | 5 既有文件保护+笔记写入与迁移协调 | 部分成立 | **A 采纳** | 一半已被 #205 修掉，PR 补强 |
| #213 | 6 迁移后缀过滤器误伤 | 成立 | **A 采纳** | |
| #213 | 7 生成器铁律合规 | 成立（合规） | — | 核查员实证 SYNC-OK，但 frozen 内容自带真缺陷（见 §3） |

**PR 自带缺陷/卫生问题（合并前必须处置）**：
- #213 frozen 份 `migPickInto` 新增守卫引用未声明的 `request`/越组件的 `settingsAlive` ⇒ 点「选择目录」必抛 ReferenceError、按钮永久卡死（lead 抽验实证）；三份实现不一致（另两份没加该守卫）。
- #213 提交了 36 个 `artifacts/ui-settings-20261003/**` + 9 个 docs 验收材料 ⇒ 全部剔除；其 browser 测试工件目录要改 `os.tmpdir()`。
- #210/#213 的 `.gitattributes` 按"上游无此文件"写的 new file ⇒ 直接套会顶掉现树 m3b1 夹具 CRLF 契约，必须两规则并存。
- #212 夹带 #179 决策领地（workspace-key 重键 + 所有权标记）——**缓办**；python m7 CHUNK_POLICY v2 会触发语义索引整库重建，需公告后单独采纳。

---

## 1. PR#210「Make continuation and archive state durable (#207)」（32 文件，+1664/-283）

### Claim 1：cont-seq 接续计数器——成立（B 改造采纳）
- **成因**：`allocContSeq`（index.js:4792-4808）不检查 `saveContSeqState` 返回值，写失败照常 `return next` ⇒ 发出未落盘的号，重启后重号；`_pathWriteQueuePre` 是纯内存链无跨进程能力（path-write-queue.js）；冷扫 `slice(0,120)` 按 mtime 漏旧文件最大号（:4775）、`catch(()=>0)` 猜 0（:4799）；`rollbackContSeq` 回收号（:4812-4824）。
- **后果**：写盘拒绝/多进程/损坏历史三种路径下「接续 #N」重复——低频但不可逆。
- **PR 修法评估**：骨架正确（锁内重读→推进→原子提交→成功才发布）；风险：`shared-state-lock.js` 是 calendar-lock 逐行拷贝（违反「不另起第三套锁」纪律）；锁内全量冷扫 10s 限时使并发分配硬抛；SQLite/不可读历史一票否决偏重；「不跳号→允许空洞」翻转既有用户契约。
- **改造要点**：锁物理合一（calendar-lock 变薄壳 re-export 或新模块改名 fs-lock）；冷扫 leaf 跳过/目录拒绝并指路，SQLite 维持 seed 门槛；裁定变更写 CHANGELOG。

### Claim 2：接续闩 200 条上限——成立（A 采纳）
- 现行 `markContinuedSession`（:4696-4719）`slice(-200)` 挤丢最旧闩 ⇒ 大量来源后可被重复接续；内存即真值+跨进程盲区。
- PR 修法：`auto-continue-done.d/<SHA256>.json` 分片 + token + 旧格式只读兼容 + 锁内查写。唯一小病：`isContinuedSession` 每回合重读盘 ⇒ 加 (mtime,size) 缓存。

### Claim 3：pending 状态/重启安全/恢复 CLI——成立（A 采纳）
- 现行投递失败只写内存 `st.error`（:5048-5060），重启消失 ⇒ 盲目二次创建；成功落闩吞错（:5017）；无任何恢复入口。
- PR 修法：reserve→setTarget(rawId)→finish 三段持久化 + CLI（token/expected-successor/显式确认三重校验）+ `.active` 锁防 in-flight 恢复。过度点：`creationUncertain` 前置过宽（同步校验型错误也挂 pending）——可后续加类型化放行单，不阻塞。

### Claim 4：归档账本——部分成立（A 采纳）
- 整快照覆盖丢他实例条目（:11017/:11071/:11099）、`void write` 吞错（:10964-10970）成立；「未知归档年龄保护」现行已有（session-archive.js:129），PR 为保持。
- PR 修法：锁内新鲜读→合并 delta→原子写；提交失败 `rep.ok=false`+跳过本轮删除（保守正确）。注意：损坏账本会停摆删除直至人工修复（fail-closed 需登记）。

### Claim 5：部分创建安全缺口——成立（B 改造采纳，**需用户裁定**）
- 现行 `sc.create` 失败无条件回退二次 create（:4968-4982）⇒ rc.2「先建会话后绑工作区」失败时首个会话成孤儿且 ID 丢失；client.js:7350 注释佐证时序。
- PR 修法：create 前置 creationUncertain；`details.sessionId` 存在即持久化原始 ID，不二次 create；仅 `workspace/not-found`+workspaceId 精确匹配才放行回退。**实质修订 2026-09-28「失效即回退源 cwd」裁定**：旧宿主普通 Error 不再自动回退而是挂 pending——需确认。改造：workspaceId 规范化比较 + 校验型错误放行单。

### 附：CI 修复与守卫
- 「恢复 84 文件」对现树 N/A（现树齐全，是 PR 分支自己的事）；`.gitattributes` 必须手工并集；py-runtime-chain 去硬编码依赖+搬真机验收到 `-live` 套件合理；audit-g-207 D 段顺手修了 Windows 路径真 bug；守卫重钉全部为行为增强型，无放水。

---

## 2. PR#212「Fix seven residual data-safety and ownership issues」（118 文件，+4729/-445）

> 构成：52 tests + 48 docs（#209/#206 审计文档）+ 9 lib + 4 skins + 2 tools + python + CI。无 84 资源块内容，无恶意改动；iter5 四份同步（源/生成器/frozen/产物）铁律合规。

### Claim 1：keep/rename 导入 clobber——成立（B 改造采纳）
- `_readExistingWorkspaceFiles`（index.js:8309-8328）三重吞错+8MB 隐形；`planImportPre` keep 模式照写（migrate-pack.js:280）；预览 token 不覆盖 rename 候选名；宿主再包 `catch(_){}`。跨机导入 keep 语义失效。
- 改造：全量清单+fail closed+token 全覆盖+digest 复核采纳；**不引入 `link()`**（网络盘 EPERM 风险），additions 用 lstat 复核+原子写。

### Claim 2：note append 串写——成立（A 采纳）
- 客户端三处表单只发 `{content}`（client.js:10780/13188/概览）；服务端 `resolvePaths(undefined)` 用全局当前值+跨工作区缓存去重+污染（index.js:16596-16604）⇒ 切换工作区后提交写进**别的项目**。
- PR 修法与现树设施完全同构（resolvePathsForSession v2.5.2 已有 + wsBound + 409 + 读盘去重）。服务端照搬；前端三份按生成器线重做。

### Claim 3：面板删除无 CAS——成立（**高危**，A 采纳，lead 抽验实证）
- `deleteMemory`（storage-manage.js:178-204）队列外读 buf 算 newText，`expectedDigest: input && input.expectedDigest` 而 **GUI 从不发**（client.js 全文 0 处）；memory-writer.js:554 `expectedDigest !== undefined` 才装 CAS ⇒ 读-写间隙内并发 `memory_note` 追加被物理丢弃。
- PR 修法：对实际读到的 buf 算 sha256 无条件 CAS，冲突返回 `conflict-external-edit`。约 +8 行。

### Claim 4：JSON 非法转义——成立（已复现，A 采纳）
- `rewritePathsInTextPre` 配对表去重跳过 POSIX 键（migrate-pack.js:79-80）⇒ 替换值为裸反斜杠 Windows 路径 ⇒ JSON 字符串里 `\t`/`\n` 非法转义。核查员实测产出 `Bad control character` 损坏文件。POSIX 机→Windows 机搬包必坏语义索引/技能库。
- PR 修法：`rewriteJsonPathsPre` 逐行 parse 验证→token 级重写→重编码，保留未触及字面。约 +22 行。

### Claim 5：设置陈旧响应——成立（A 采纳，生成器线）
- 订阅 effect `busy` 闭包旧值（client.js:10967）、无请求序号、慢 GET 保存后回跳。PR 修法 i5Busy ref + generation + 单调序 + 统一 i5ApplyConfig（保留草稿恢复与 psec 水合，核查未发现回归路径）。

### Claim 6：异步排序混代帧——成立（A 采纳）
- context-host.js:363 `Promise.all` 边界仅 disposed 守卫，:415 await 后重读 contextVersion ⇒ 混代帧照常注入；jsDecide 全链零守卫；冷却在 offer 前消费。PR 修法 observationGeneration 三重比对+originQueryText 前置+冷却后置，克制正确。

### Claim 7：procedure 证据五子项——成立（B 改造采纳）
- ①owner 不限定（index.js:11302 全库 addEvidence）；②先统计后持久化+success 无排除 ⇒ 晋升门槛被虚增推动；③POSIX 大小写全平台 toLowerCase（m4-corpus.js:26）；④会话身份两种截断并存（.slice(0,24) vs (0,48)）双计；⑤去重账本静默吞错（evidence-store.js:199-217）。
- 改造：五子项全收；owner ref **用现行 canonicalize，不引入 workspace-key 哈希**（#179 领地）；strict 账本读加 30s 失败不缓存。

### 超范围/夹带（单独裁决）
- **workspace-key 重键 + `.workspace-owner.json` 所有权标记 = #179/F03 决策领地**；且现网集中式老目录无标记 ⇒ 升级不自动迁移、面板呈"空"——采用级阻断，**缓办**。
- python m7 CHUNK_POLICY v1→v2 ⇒ 语义索引整库重建（policyVersion 参与索引身份），单独采纳+公告。
- degrade 台账文案先行（与实际行为不符）不收；prompt 措辞三处拆出单独评审；`_lastIndexDegrade` 移除合理但属独立行为变更。

---

## 3. PR#213「Fix settings persistence, scoped drafts and runtime control feedback」（75 文件，+7518/-662）

> 铁律核查（核查员在临时 clone 实测）：应用 PR 后 `build-iter5-skin.mjs --check` → **SYNC-OK**，四份（skins 源/生成器/frozen LF/产物 client）逐字节一致；PR 树守卫套件全绿（仅 workbench-gaps 2 项因 PR 缺 3.2.9 内容而红）。**合规 ≠ 无错**，见下。

### Claim 1：设置分组/生效态反馈——成立（B 改造采纳）
- 现行实锤：`sectionLabels.about` 缺失+`team` 重复声明 ⇒「关于与维护」标题 undefined（client.js:11323 等）；语义总闸读**草稿态** cfg 当"已生效"（:11399）；文案与运行时钳制相反（fAutoMarginHint 写 0.1-1 实际 [0.3,1]、fWaterWindowHint 写 0=关闭 实际 0=自动、fJsCooldown 单位错）；workbenchLoop `min:1` 与引擎 ≥2 矛盾静默回落；autoSummaryTimes/排除来源 onChange 即时 split 打不了中间态；团队传输 http/folder UI 可选但宿主必炸（team-transport.js:527-530）+密钥明文。
- PR 修法 saveConfigPatch 唯一出口内归一化（纪律不破）+读生效基线+disabled+三语文案。分组重排可拆。

### Claim 2：草稿跨皮肤丢失——成立（A 采纳）
- 草稿全在组件本地 state，皮肤切换=重挂=丢（NotesTab :7301、CalendarTab :8275、Iter5Note 仅 persistDraft:'panel'、Iter5Calendar 零恢复、面板 close() 无脏确认）。高频用户可见。
- PR 修法：模块级按 `sessionId|ws` 作用域草稿 + useMemoryOperation 订阅补偿 + 防重发 + 脏确认。**要求合并前跑真实浏览器矩阵**（CI 无浏览器）。

### Claim 3：陈旧响应——成立（A 采纳）
- 与 #212 claim5 同源另加：refreshSem/ConnectTab/NotesTab 无身份守卫；PR 修法 i5Read/i5AppliedRead 代次+失败的新 GET 不压制初始水合。与 #212 合并实施。

### Claim 4：设置校验/迁移重试安全——成立（A 采纳，核心件）
- 现行 `_saveConfigPre` 开头 `await loadConfig()` ⇒ **配置损坏时 quarantine 兜底为默认，本次保存把默认写回真源**（设置静默重置）；迁移逐目录吞错部分迁移静默"成功"；user 级只拷 top-level ⇒ **summaries/、greetings/ 子目录内容根本不迁移**；无字段级校验。
- PR 修法 `lib/settings-safety.js`（177 行）：保存严格读（与启动期 quarantine 分工清晰，非两套真源）+字段级校验+祖先 realpath 防 symlink 逃逸+所有权日志迁移器（dev/ino+sha256 ⇒ 回滚只删自己拷的、重试安全、复扫 TOCTOU）。

### Claim 5：既有文件保护+笔记写入与迁移协调——部分成立（A 采纳）
- 一半已被 #205 修掉；剩余：copyDir 无 EXCL（:2946-2953）/note 与迁移零协调（迁移窗口写旧根丢失）/notesText 跨工作区污染。PR 修法 per-file EXCL+sessionId CAS+per-path 串行队列+`_settingsNoteFlights` drain。

### Claim 6：迁移后缀过滤器——成立（A 采纳）
- 现行过滤器误伤 `.tmp.` 持久名、`.lock` 目录一律跳过（⇒ user 级子目录不迁移的根因之一）、memoryRoot 侧不过滤 writer 锁临时文件。PR 修法 entry-type 精确过滤+复扫。

### Claim 7：铁律合规——成立；但 **PR 自带真缺陷**
1. **frozen migPickInto ReferenceError（lead 抽验实证）**：frozen 份 `migPickInto` 回调新增 `if(!settingsAlive.current || request!==pickerRequest.current)return`，但 `request` 在该函数作用域未声明、`settingsAlive` 属 sibling 组件 ⇒ 点「选择目录」必抛 ReferenceError → `setPicking(false)` 不执行 → 按钮永久卡"选取中"。三份不一致（主生成区与手写 StorageTab 没加）。修法：三份统一删守卫或补 `var request=++pickerRequest.current` 并提升作用域。
2. ConnectTab findImported 复制粘贴重复两行（无害，清理）。
3. `.gitattributes` 覆盖事故（见总表）。
4. index.js 基于 3.2.7 ⇒ 缺 b69995d 归一+熔断，必须以现树为基重放。

---

## 4. 综合结论与采纳顺序

**质量排序**：三条都高于社区平均；#210 证据链最扎实（可复跑 baseline+真子进程/真故障注入），#212 覆盖面最实用（#3/#4 两刀性价比极高），#213 前端工程量最大且铁律合规但自带 1 个真缺陷。

**采纳顺序（冲突面决定）**：
1. **先 #210**：不碰 client.js，hunk 区与 3.2.9 不相交，可近乎干净 apply；且其测试基建（state-engine.mjs、py-runtime 可移植化、.gitattributes、CI python 钉）是三者公共底座。落地后重钉 E3 一次。
2. **再 #212**：基于 #210 后的树重放 lib hunks；E3+iter5 各重钉一次。
3. **最后 #213**：改动面最大且与两者都叠（client.js 三份设置页/Note/Calendar、index.js saveConfig/路由段）；每并一个前置 PR 都要重放本 PR 前端段并重跑生成器。
   （替代路径：一次三方集成重钉一次——单次评审量大，二选一由执行时决定。）

**需用户拍板的裁定变更（2 项，随 #210）**：
- 「接续回滚不跳号」→「允许空洞、永不回收」（claim 1）。
- 「workspaceId 失效 ⇒ 自动回退源 cwd」（2026-09-28 裁定）→「类型化错误才回退，否则挂 pending 待人工」（claim 5）。

**本轮不采纳/缓办清单**：
- #212 workspace-key 重键+所有权标记 ⇒ **#179 决策领地**（观察项不动）。
- python m7 CHUNK_POLICY v2（语义索引整库重建成本，需单独公告）。
- #212 degrade 台账文案、prompt 措辞三处。
- #213 全部 artifacts/**（36 文件）+ 9 个 docs 验收材料；browser 测试工件目录改 tmpdir。

---

## 5. 修复方案（分批执行草案）

### 批次 W = #210 后端（先行，纯后端无前端面）
| 项 | 修法 | 文件/规模 |
|---|---|---|
| W1 cont-seq | 锁内「重读→冷扫→推进→原子提交→成功才 return」；rollback 变 no-op；锁模块与 calendar-lock 物理合一（约 -60 行净删）；冷扫 leaf 跳过/目录拒绝 | index.js:4749-4830（约+25/-35）+ 新 lib/fs-lock（≈75 行） |
| W2 闩分片 | `auto-continue-done.d/` 分片+token+legacy 只读兼容；(mtime,size) 缓存 | 新 lib/continuation-state.js（≈150）+ index.js:4664-4719（+10/-45） |
| W3 pending/CLI | reserve→setTarget(raw)→finish 三段；autoContinueState 加 pending/completed；两入口拦截；恢复 CLI 三重校验+.active 锁 | index.js:4905-5135（+60）+ 新 lib/continuation-maintenance.js（38） |
| W4 归档 delta | saveArchiveLedger(updates,removed) 锁内合并；删 _saLedger 缓存；失败 rep.ok=false+跳过删除 | index.js:10952-11100（+12/-10） |
| W5 创建门 | createSuccessor 包装；details.sessionId 即存原始 ID 不二建；类型化回退门（workspaceId 规范化比较+放行单常量） | index.js:4965-4984（+22） |
| 守卫重钉 | E3(R77')、contseq S0/S3、audit-g-207 B/C、continue-host H12、continuation-transaction C05、autocont-host、switch-decouple、workbench-migration ⑰c4、p3-batchb、.gitattributes 并集、tests.yml python 3.12 | 新 suite×4（issue207-state/routes/create-boundaries + processes 助手） |
| 验收门 | 全量回归 0 红；CHANGELOG 登记两项裁定变更 | |

### 批次 X = #212 后端（无 UI 面，性价比最高）
| 项 | 修法 | 文件/规模 |
|---|---|---|
| X1 删除 CAS（#3） | 对实际 buf 算 sha256 无条件 CAS；conflict-external-edit | storage-manage.js:178-204（+8） |
| X2 note 绑定服务端（#2） | sessionId+expectedNotesPath 必填+resolvePathsForSession+409 漂移+读盘去重+withAgent 内更新缓存 | index.js:16596-16606（+15） |
| X3 JSON 重写（#4） | rewriteJsonPathsPre 逐行 parse→token 重写→重编码 | migrate-pack.js:234-254（+22） |
| X4 证据五子项（#7） | persistEvidence strict+仅 appended 喂计数+procedureWorkspaceRef(=canonicalize)+success-exclusion+激活绑定校验+normalizeSessions+loadEvents strict(30s 缓存) | context-host ≈+60、index ≈+15、procedure-store ≈+35、evidence-store ≈+15、activation-host ≈+6 |
| X5 导入安全（#1） | 全量清单+token 全覆盖+digest/lstat 复核+fail closed；**不用 link()** | index.js:8309-8560（+35）、migrate-pack.js:267-297（+14） |
| 验收 | 移植新 suite：note-delete-isolation、migrate-json-paths、success-evidence-ownership、procedure-session-upgrade、evidence-ledger-read-failure、migrate-existing-safety | |

### 批次 Y = 前端生成器线（#212 #5/#6 + #213 前端，**一次过生成器**）
1. 先改共享语义源（client.js 手写区）：memoryNoteDrafts/memoryCalendarDrafts/useMemoryOperation/prepareSettingsPatch/TeamSecretInput/close() 脏确认/refreshSem 代次/字典文案。
2. 改 skins 源四份（views/ui/native-panel/settings-copy）+ 生成器 replaceT/切片补丁 + frozen 同款。
3. **修 PR 自带缺陷**：migPickInto 三份统一（删守卫或补 var request）；清理 ConnectTab 重复行。
4. `--check` SYNC-OK → 实跑（orphan 拦截绝不 --force）→ node --check。
5. 守卫：iter5 R 钉按最终字节重钉（R78 注释链）、r26 E3、settings-sync、workbench-gaps、r19-fe02-screens2 全绿；.gitattributes 两规则并存。
6. 合并前本地跑真实浏览器矩阵（草稿/响应顺序 × current/frozen）。

### 批次 Z = #213 后端
- 采纳 lib/settings-safety.js 全文；index.js **以现树为基**重放 saveConfig（串行队列+严格读+迁移回滚+原子写发布）/config 字段级 400/note 迁移屏障/_settingsPlanFlights（保留现树 #164 CAS 语义）；跑 settings-safety/migration-names/routes-safety/plan-migration 全绿；E3 重钉。
- 卫生：剔除 artifacts/** 与 docs 验收材料（git rm --cached），browser 工件目录改 tmpdir。

### 明确不做（本轮）
- workspace-key 重键/所有权标记/`wsKey()` 变更（#179 领地）；
- python m7 CHUNK_POLICY v2；
- #212 degrade 文案、prompt 措辞、`_lastIndexDegrade` 移除（独立行为变更，单独立项评审）。

---

## 6. PR 回复草案要点（三条通用）
- 逐 claim 感谢+确认成立（18/18 无虚报，社区罕见）；
- 说明采纳方式：拆取分批随版本发布（v3.2.10+），lock 归一/不加 link()/owner ref 用 canonicalize 等改造理由；
- 说明 #179 决策项挂起中，workspace-key 部分待拍板后另立 PR；
- 请其下一步以 main 最新（e260677+）为基重出（或按本报告批次参与后续验证）。
