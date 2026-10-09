/** R26 · 跨层对账审计：includeArchive 缺口收官（真 import + 真调用 + 负路径）。 */
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
const { foldCardsPre, buildByTagPre } = await import(new URL('../../lib/wb-sidecar.js', import.meta.url).href)
import { fileURLToPath } from 'node:url'
import { stripGeneratedSkin } from '../lib/skin-bundle.mjs'

/** 平台无关行尾守恒：存在 CRLF 时不得有裸 LF；全 LF 合法（CI/Linux 检出态）。
 *  ★2026-09-28：原断言写作 cnt(NL)===cnt(CRNL)（即"必须全 CRLF"），在 Linux CI 上必红——
 *  索引里是 LF，本机 core.autocrlf=true 才检出 CRLF。守的语义不变：文件不得混合行尾。 */
const damNoMixedEol = (s) => {
  const crlf = (s.match(/\r\n/g) || []).length
  const lf = (s.match(/\n/g) || []).length
  if (crlf === 0) return true      // 全 LF：合法（CI 检出态）
  return crlf === lf               // 有 CRLF 则不得再有裸 LF
}
const damPath = (rel) => fileURLToPath(new URL('../../' + rel, import.meta.url))
// ★2026-09-28（集成 iter5 皮肤）：本套件断言的是**经典档契约**（全仓计数/唯一性），
//   而生成区把若干经典组件派生了一份新皮肤版本（SettingsPage→Iter5Settings 等）⇒ 计数翻倍假红。
//   故此处剥离生成区再断言 —— 不是放宽判据，而是把作用域限定到它真正该守的经典档。
//   皮肤自身由 smoke-test-iter5-skin.mjs 验收（含「剥离后与基线逐字节一致」的守恒断言）。
const SRC = stripGeneratedSkin(readFileSync(damPath('lib/client.js'), 'utf8'))
const IX = readFileSync(damPath('lib/index.js'), 'utf8').replace(/\r\n/g, '\n')
let p = 0, f = 0; const fails = []
const ok = (c, m) => { if (c) p++; else { f++; fails.push(m) } }
const eq = (a, b, m) => ok(Object.is(a, b), m + ' [got=' + JSON.stringify(a) + ' want=' + JSON.stringify(b) + ']')
const cnt = (s, x) => s.split(x).length - 1

/* ── A. ★★审计的方法本身：宿主每个 query 参数都要有前端消费者 ── */
const PARAMS = [...new Set([...IX.matchAll(/searchParams\.get\('([A-Za-z0-9_-]+)'\)/g)].map((m) => m[1]))]
ok(PARAMS.length >= 10, 'A1 宿主接参 ≥10 种（实测 ' + PARAMS.length + '）')
// ★★前端消费判定必须容忍**带后缀写法**（如 API.recallStats + '?reset=1'）—— 首轮审计用整串匹配漏检了 reset。
const consumed = (name) => SRC.indexOf("'" + name + "'") >= 0 || SRC.indexOf('"' + name + '"') >= 0 || SRC.indexOf(name + '=') >= 0 || new RegExp('\\b' + name + '\\s*[:\)]').test(SRC)
const missing = PARAMS.filter((x) => !consumed(x))
eq(missing.length, 0, 'A2 ★★零「宿主有参数、前端无消费者」（缺：' + (missing.join(',') || '无') + '）')
ok(PARAMS.includes('includeArchive'), 'A3 includeArchive 确在宿主参数表内')
ok(PARAMS.includes('foldDays'), 'A4 foldDays 确在宿主参数表内')

/* ── B. 宿主侧能力（★真 import 真调用，证明两参数语义正交） ── */
const D = 86400000, now = Date.now()
const cards = [0, 1, 2, 20, 30].map((d, i) => ({ id: 'c' + i, title: 't' + i, mtime: now - d * D, kind: i === 4 ? 'archive' : 'state' }))
const r7 = foldCardsPre(cards, { now, foldDays: 7 })
const r0 = foldCardsPre(cards, { now, foldDays: 0 })
eq(r7.visible.some((c) => c.kind === 'archive'), false, 'B1 ★★★负路径：7 天态归档卡**不可见**（46 卷 §四 B2 症状复现）')
eq(r0.visible.some((c) => c.kind === 'archive'), true, 'B2 ★★0 天态归档卡可见')
ok(r7.hasMore === true && r0.hasMore === false, 'B3 ★两参数语义正交：foldDays 管折叠、includeArchive 管读盘范围')
ok(cnt(IX, "searchParams.get('includeArchive')") === 1, 'B4 宿主路由接 includeArchive 恰 1 处')
ok(IX.includes("String((this.config || {}).boardArchive || '') === 'on'"), 'B5 宿主保留 boardArchive 配置回退（解耦，未被绕过）')
ok(IX.includes('includeArchive: true })') || IX.includes('{ includeArchive: true }'), 'B6 宿主内部展开全文路径仍恒传 true（不受本改动影响）')

/* ── C. 前端接线（R26 补的两参数同传） ── */
eq(cnt(SRC, 'foldDays: foldOpen.days'), 1, 'C1 ★foldDays 真传恰 1 处（R25 成果不降级）')
// ★R38：KanbanBoardRail 展开时**另发一次** foldDays:0 的取数（折叠态上提到本组件）——语义仍为「真带 foldDays」，故 C1 保持不变。
eq(cnt(SRC, 'foldDays: 0'), 1, 'C1b ★折叠条展开态真传 foldDays:0（days=0 ⇒ 不折叠）')
eq(cnt(SRC, 'includeArchive: foldOpen.days === 0 ?'), 1, 'C2 ★★includeArchive 真传恰 1 处（R26 新接线）')
eq(cnt(SRC, "includeArchive: '1'"), 1, 'C2b ★R38 展开态 includeArchive 真传（两条语义同时放开）')
ok(/includeArchive: foldOpen\.days === 0 \? '1' : '0'/.test(SRC), 'C3 ★条件正确：展开态传 1、折叠态传 0')
// ★修正（本轮自查）：原写死 `=== 2` 是「凭直觉写死期望值」第 7 次 —— 实测 3 处（rail / 画布 / L5613）。
//   改为**由源码派生**：断言「恰好 1 处带 foldDays」，其余不带（画布与另一处不受扩散）。
// ★R38 口径同步：3 → 4。新增的第 4 处是 KanbanBoardRail 展开时带 foldDays:0 + includeArchive:'1' 的取数
//   （R26 定的两条语义此前只在 KanbanView 里传过；rail 这条是 R25/R26 缺口在**面板承载面**上的补齐）。
//   计数锁是**守卫**不是功能证据；被守语义「取数点集合已知且不变为意外」未变，故同步新值。
eq(cnt(SRC, 'apiGet(API.kanbanBoard'), 4, 'C4a（守卫）kanbanBoard 取数点 4 处（R38 新增 rail 展开取数）')
eq(SRC.split('apiGet(API.kanbanBoard').length - 1, 4, 'C4b 同源复核')
ok(!/includeArchive/.test(SRC.slice(SRC.indexOf('function WhiteboardGraphView'), SRC.indexOf('function WhiteboardGraphView') + 3000)), 'C5 ★画布视图不传 includeArchive（口径不被扩散）')

/* ── D. 与 46 卷 §四 B2 的判据对拍 ── */
const V46 = readFileSync(damPath('docs/teamwork-impl/46-看板排布优化prompt.md'), 'utf8')
ok(/includeArchive/.test(V46) && /结构性死泳道|恒空/.test(V46), 'D1 ★权威卷 46 §四 B2 确以 includeArchive 定性该缺陷')

/* ── E. 守恒 ── */
eq((SRC.match(/(?<!function )MEMORY_TABS\(\)/g) || []).length, 2, 'E1 计数锁不变')
ok(damNoMixedEol(SRC), 'E2 纯 CRLF')
// ★修正（本轮自查）：原 E3 是 `eq(cnt(IX,X), cnt(IX,X))` —— **自比恒真哨兵**，等于没测。
//   改为真断言：宿主**本轮零改动**（sha16 与基线一致）+ 路由数守恒。
// ★基线演进（2026-09-28，用户点名「先加在旧版上」）：R25→R44 唯一有意变更 = index.js DEFAULT_CONFIG
//   补 `teamShowMemberBadges: true`（4 行）——该键此前只有设置控件、不在白名单，写了被 /config 丢弃
//   （死开关，P0-7 同类缺口）。守卫语义保留：除本条外 index.js 任何其他改动仍会被本锁抓住。
// ★2026-09-28 基线演进 R44→R46：新增 skin-library-fetch 路由（用户第 1 大点·皮肤库机制，见 HANDBOOK §5.1）。
//   语义保留：除本条与 E4 计数外，index.js 任何其他改动仍会被本锁抓住。
// ★2026-09-28 基线演进 R47→R48：修「一键接续漂到别的工作区」——handoffPanelData 的刷新目标不再跨工作区
//   磁盘回退（原 recentSessionIdFallback 会返回别的工作区的会话，致新会话落到错误 Workspace）。
//   语义保留：除本条与 E4 计数外，index.js 任何其他改动仍会被本锁抓住。
// ★2026-09-28 基线演进 R50→R51：修「工作目录不正确」（用户报障，2.2.1 起即错）——buildContinueCarry /
//   buildPrevSessionPack 的材料读取与转写包落盘从 resolvePaths(undefined)（插件当前工作区）改为
//   resolvePathsForSession（源会话工作区）。真机实证：aik 会话 f49ace38 的转写包落进
//   --D--dsh-auto-memory-- 桶（包内「工作区:」与落盘桶自相矛盾）；回归守卫 = continue-host H10。
//   语义保留：除本条与 E4 计数外，index.js 任何其他改动仍会被本锁抓住。
// ★2026-09-28 基线演进 R51→R52：宿主兜底接续补 create 三级回退（workspaceId 失效 → cwd → 裸
//   agentPreset），与浏览器 executeContinue 同款（旧实现 create 一抛整单失败，无人值守无人可救）；
//   lastOk 增 fromSid（被接续旧会话 id），前端把 sessions.open 收窄为只切「正看着旧会话」的窗口。
//   回归守卫 = autocont-host 101 断言 + continue-chain G15。语义保留：除本条与 E4 计数外，
//   index.js 任何其他改动仍会被本锁抓住。
// ★2026-09-28 基线演进 R52→R53（去 pre 收官）：源码树不再有 pre 文件，发布退化为纯拷贝。
//   本批 index.js 变更 = 策略工件路径改裸名（`*_pre_*.json` → `*_v*.json`）。旧代码两条候选路径
//   全落空（包内只有裸名）⇒ `loadAndVerifyPolicy` 抛错被 catch 吞掉 ⇒ JS 语义臂静默拿不到策略
//   （默认 auto 档也受影响）。语义保留：除本条与 E4 计数外，index.js 任何其他改动仍会被本锁抓住。
// ★2026-09-29 基线演进 R54→R55（3.2.3 发版批，增量归因）：① sessions 检索兜底
//   （searchSessionHistory 捕获宿主 SESSION_QUERY_PERSISTENCE_FAILED 后走词法兜底扫描
//   lexicalSessionScanFallback——宿主迁移器只认 subagent/descriptor v3，39 个 8 月旧会话毒死整通道）；
//   ② 写入门 P0：detectStutter 两层判据（CJK 语种盲区修复 + 周期性 verbatim 循环仍拦，
//   捕获集 ⊆ 旧判据）+ writeGateRefusalTextPre 六入口按原因分派带触发证据 + 两道闸门挂 detail；
//   ③ memory_rules 列表行字面 \n 修真换行。全量回归绿 + 全库 1342 文件实测零新增误报后放行。
// ★2026-09-29 基线演进 R55→R56（回收链路修复批，增量归因）：
//   ① 真根因修复：sessionArchiveSweep / locateSessionDir 原以 `this.ctx` 取宿主服务，
//      而本文件对「引擎点 ctx」**全仓零写入点**（引擎实际只写 `engine._ctxRef = ctx`）
//      ⇒ reg 恒 null ⇒ 归档分支整段跳过、删除分支无 archivedAt 可依 ⇒ 归档/删除自
//      2026-09-26 落地起**静默空转从未生效**（42 天诊断日志 0 条 session archive 为证）。
//      现新增 `_engineCtx()` 统一取上下文，取不到时 diagThrottled 留痕（根治零日志静默）。
//   ② 作用域收窄（用户硬约束「只回收记忆中枢工作区的这些内容，不要把用户其他子代理
//      有用的东西全部删掉」）：新增 `_hubProjectDirs(index)`，把 rows / childIds / 删除目标
//      三处全部限定为工作台会话所在的项目目录；解析不出即 fail-closed 整体跳过
//      （`reason: 'hub-unresolved'`），绝不退化成全盘扫描。
//   真机实测（只读预演）：中枢 = 248 会话/22.9MB；其他 11 个工作区 337 会话/911.7MB
//      **0 触碰**；删除目标 0（首轮无归档时间 ⇒ 只归档不删除）。
//   语义保留：除本条与 E4 计数外，index.js 任何其他改动仍会被本锁抓住。
// ★2026-09-29 基线演进 R57→R58（C2 增量嵌入批，增量归因；同批已**撤销** R57 引入的读盘捷径）：
//   ① 撤销：R57 的 `recallL0CachedRank` + `l0RecallFromIndex` 经真机判死——
//      recall 语料 1111 条 vs 落盘索引 630 条（覆盖率 56.7%，两侧来源集不同：recall 扫 40 日志
//      +30 反思+PLAN+账本，sync 只落 14+14），且 5 分钟节流窗与召回完整性结构性冲突
//      ⇒ 覆盖判定恒失败、捷径为死代码（撤销理由留在 _semanticRankBest 原处注释）。
//   ② 新增（正确修法）：`config.semanticEmbedIncremental`（默认 true）+ 引擎构造处
//      `get incremental()` 接线 + semantic-js `buildIndexIfStale` 改为按 **sha256(编码输入)**
//      复用向量池（与 l0-index.js 的 l0Hash 两级复用同源）。语义等价（真机 cosine 1.000000），
//      纯省 CPU：1111 条语料实测全量重嵌 ≈0.9s，追加一行日志 hash 复用率 100% ⇒ 增量 ≈0–16ms。
// ★2026-09-29 基线演进 R58→R59（「去 pre」死链自愈批，增量归因）：
//   真机事故：用户配置 pythonBackendWorkerPath 仍是去 pre 前的 `worker_semantic_pre_v1.py`
//   （磁盘只有裸名 worker_semantic_v1.py）⇒ spawn ENOENT ⇒ sidecar 恒 unavailable ⇒
//   C3 语义臂静默失效 8 天、engineSwitch.failed 累到 4112，用户表现为 recall 超时。
//   成因：配置名迁移器（2026-09-23）判据是**逐键补齐**，救不了"键在但值是死链"。
//   本批：① python-sidecar-client 新增 resolveWorkerScriptPathPre（严格形态判定，只在
//   「不存在 + 历史命名」时纠正，合法自定义路径与真缺失一律原样透传）；
//   ② spawn 路径改经该函数；③ loadConfig 汇聚点补**取值级自愈**（纠正后原子落盘）；
//   ④ 新增守卫 smoke-test-depre-residue（16 条，含反例）。
// ★2026-09-30 基线演进 R59→R60（Python 运行时"真跑通"判据批，增量归因）：
//   用户三条原则：①判据=真跑通（有反馈才算就绪）；②健壮降级（失败了也继续、把报错摆出来）；
//   ③开发值显式识别。本批：
//     ① 新模块 lib/python-runtime.js —— 解释器候选链（配置值→用户位 venv→开发树 venv→系统
//        PATH）+ deps 实测（import transformers/onnxruntime/numpy）+ isDev 标记；
//     ② index.js 新增 engine.probePythonRuntime（带缓存/单飞行）与 engine._probeWorkerHealthOnce
//        （短命 worker 发 health 帧读 embedding 视图 = 真跑通反馈）；resolvedPythonCommand 接入
//        sidecar 的 command；
//     ③ semanticDeepDetect 与 resolveSemanticTier 的 Python 判据由「模型文件存在」改为
//        「模型在 **且** 解释器 deps 通过」（真机事故：文件在但解释器缺依赖时面板显示就绪、
//        实际全程词法兜底）；新增 pythonRuntime 字段下发前端；
//     ④ worker health 判据修正：不把 `embedding.ready` 当跑通（它=非 stale 向量数>0，
//        stale 是常态）——改看 `enabled && !error`（embedder 真加载成功）。
// ★2026-09-30 基线演进 R60→R61（真跑通判据矛盾修复批，增量归因；用户截图三矛盾）：
//   ① Bug1 修复：_probeWorkerHealthOnce 用了 makeRequestFramePre 但漏导入 ⇒ ReferenceError
//      被 fail-soft 捕获，面板显示"makeRequestFramePre is not defined"（补 ./m7-wire.js 导入）；
//   ② probePythonRuntime 重构：state 五态（verified-ok/ready-unverified/start-failed/deps-failed/
//      no-files）+ usable 汇总 + worker 判定独立缓存（10min，withWorker 才重测）；
//      pythonRuntimeCached 只读访问器（recall 热路径零阻塞）；
//   ③ resolveSemanticTier 与面板**同源同判**：有 worker 反馈以反馈为准（修「面板 ⚠ 未能启动
//      vs 档位 C3」同屏矛盾）；无缓存文件乐观 + 后台补探测；
//   ④ semantic-status 的 pythonInt8Present 同步升级为 usable 语义 + 下发 pythonRuntime；
//   ⑤ deepDetect 走 withWorker:true（面板是显式动作，值得付 19s 拿真反馈）；
//   ⑥ 前端三态以后端 state 为准 + mode-aware 文案（修「未安装、当前模式不受影响」在
//      Python 档下的错误措辞）。
//   语义保留：除本条与 E4 计数外，index.js 任何其他改动仍会被本锁抓住。
// ★2026-09-30 基线演进 R61→R62（接续工作区漂移修复批，增量归因；用户报障「A区点击接续，新会话在B区」）：
//   三条漂移通道全修：
//   ① buildPrevSessionPack：want 显式给出但无持久化文件时，**不再静默改用 _lastAgent**（最近活跃
//      会话）的转写包顶替 —— 旧实现把 cwd/模型/转写整体换成别的会话，且 pack.cwd 存在 ⇒
//      wsFallback 警告都不触发（多窗口下=「A 区点接续，新会话在 B 区」的直接来源）；
//      现诚实降级 {sessionId: want}，工作区仍走 registry/持久化头反查（行为级守卫=continue-host H11）；
//   ② buildContinueCarry：pack=null 时 prevSid 沿用显式 preferSid（旧实现落全局 currentSessionId()）；
//      prevSessionId 回传同样补 preferSid 兜底（前端权限继承不因转写包缺失而断）；
//   ③ hostAutoContinue 接续标题加时间戳（contTitleStampPre，本地时区 MM-dd HH:mm，用户要求）；
//   语义保留：除本条与 E4 计数外，index.js 任何其他改动仍会被本锁抓住。
// ★2026-09-30 基线演进 R62→R63（GitHub 三 issue 修复批 #147/#148/#149，增量归因）：
//   ① #147 rules 条目删除：新增导出纯函数 stripOrphanAnchorsPre（按权威判据 parseAnchors 找
//      orphan-anchor 空卡、连锚点行一起剥）；applyRuleEditPre 删除分支接线 + removedAnchors 透出
//      （GUI 与 memory_rules(op=remove) 共用唯一写盘口，独占锚点卡条目不再「整篇拒写删不掉」）；
//      顺带 import MARKER_RE（双保险校验锚点行身份）；
//   ② #148 L0 标题：extractL0Pre ①heading ②firstSentence 两分支复用 rules-layer 的
//      LOG_KIND_TAG_RE_PRE_V1 剥行内 [kind:*] 元数据标记（l0-extract 新增一条对 rules-layer 的
//      单向 import，无环）——带 kind 的日志不再以 `kind:fact · …` 占 Tier-0 常驻目录；
//   ③ #149 面板统计：客户端 StatsTab 先解包 data.stats 再读 channels/channelIds/since（服务端
//      形状 {enabled, stats: snapshot()} 不动）——三通路恒 0 + 空态文案的口径错位修正；
//   守卫演进：recall-stats S4g2/S4g3 旧判据（「data.channels 恰好 1 次」「StatsTab 内 data.stats=0」）
//   焊死的是 bug 本身，已带归因改写；p9 注入表 +5 绑定、新增 #147 行为段；l0-extract +5 例。
// ★2026-09-30 基线演进 R63→R64（PR #150 三套皮肤移植批，增量归因）：
//   本批=Minervaowl7 的三套蓝白皮肤（仪器/编辑/活水）移植到 3.2.5/S64 之上；index.js 侧唯一改动=
//   skinAssetRelOfPre/skinAbsPathOfPre 增加 deep 参数（路由按 ?deep=1 选 fileDark 暗色素材）——与 3.2.5 的
//   #147（stripOrphanAnchorsPre + MARKER_RE import）及接续修复正交，两者共存。
//   语义保留：除本条与 E4 计数外，index.js 任何其他改动仍会被本锁抓住。
// ★2026-09-30 基线演进 R65→R66（D1 批：5 个团队键补入 DEFAULT_CONFIG，修「UI 渲染了但被写入门静默丢弃」）：
//   放行内容 = 新增 teamServerUrl / teamId / teamMemberName / teamConflictPolicy（默认 ask）/ teamAuditEnabled 五键。
//   为什么必须进白名单：POST /config 只接受 Object.keys(DEFAULT_CONFIG)，其余静默丢弃 ——
//   这 5 键此前已被 renderTeamSettings 渲染成控件，用户改了界面翻面、配置永远写不进去且无报错。
//   零行为变更之外的放行：不改任何既有默认值、不改读取语义，仅让既有控件真正可写。
//   三面同步守卫 smoke-test-settings-parity 已加「UI 团队键 ⊆ DEFAULT_CONFIG」判据（含负路径）。
// ★2026-09-30 基线演进 R64→R65（PR #155 运行时修复批，增量归因；与 PR #150 皮肤批合并后的基线）：
//   ① #152 增量开关：semantic-js 每次重建起始读取 getter（旧实现构造时常量化 ⇒ 
//      设置里关闭后不生效）；
//   ② #153 默认模型回退：共用新版列表项/旧版 block 解析器，回退保留原实现名、成对替换 provider/model；
//   ③ #154 接续创建：workspaceId → 源 cwd → 显式失败（不再无工作区创建并继续投料）。
//   语义保留：除本条与 E4 计数外，index.js 任何其他改动仍会被本锁抓住。
//   语义保留：除本条与 E4 计数外，index.js 任何其他改动仍会被本锁抓住。
// ★2026-09-30 基线演进 R66→R67（F 批：语义唤回三闸门默认改开 + 设置面/皮肤三修，增量归因）：
//   ① 用户裁定「L0 向量索引这些的语义唤回应当默认打开」⇒ DEFAULT_CONFIG 三键 false→true：
//      activationInboxEnabled（唤回总闸，关着时 activation-host 三处早退、结果永不投递）、
//      shadowRetrievalEnabled（影子检索）、contextBridgeEnabled（上下文桥）。
//      存量用户迁移另有一次性升级器（只升一次，显式设过 false 者不动）。
//   ② lib/semantic-js.js 与 lib/python-runtime.js 属 E 批（C2 的 devTreeRoot 多基探测 /
//      C3 的探测超时归因 + 一次重试），不属本文件，故本基线只反映 ①。
//      ★口径纠正：初版本条声称「存量用户迁移另有一次性升级器」——**该升级器并不存在**
//      （全仓无 upgradeActivationDefaults* ）。实况：从未动过该键的用户盘上**没有这个键**，
//      新默认直接生效；显式关过的用户盘上是 false，保持关。⇒ 本就无需迁移，属注释不实。
// ★2026-09-30 基线再演 R67→R68（G 批 · 发射闸单钥匙化，增量归因）：
//   用户裁定「另一把闸也要做好联动，用户确定要开自动唤回就一定能开，Python 和 js 都要」。
//   实测根因：发射闸共**三处**读数、却只有**两把钥匙**——activationEmitMode（JS 判定臂
//   context-host:495 + Python fv2 车道 worker:1261 都读它，有 UI 写入面）与
//   activationPolicy.mode（Python **v1 通道** worker:956 单独读它）。后者在用户面**零写入点**
//   （设置页/新手向导/semantic-emit 端点三处全只写前者）⇒ 用户把「记忆唤起」开成 active，
//   v1 通道恒 shadow：判定照跑、shadow 行照写，但 activation_request 帧永不发出。
//   ① index.js：semantic-emit 端点写入时把两键**对齐**（active⇒两把全开，其余档⇒两把全关），
//      磁盘状态自洽；诊断块新增 activationPolicyModeLive 回显第二把闸，便于核对两闸一致。
//   ② python/worker_semantic_v1.py（不属本文件，另由 G 批测试覆盖）：v1 通道判定改为
//      「activationEmitMode==active 放行，或 activationPolicy.mode==active 显式放行」；
//      并对同 observation 的双车道帧按 activationId **保序去重**（两车道 id 同源，会双帧）。
//   ⚠️ 非引擎联动：JS 与 Python 两套语义引擎的选择逻辑完全不动（语义引擎铁律不变）。
//   判据守恒：路由数 68 不变；配置键 143 不变（activationPolicy 属 embedding-config，不在 DEFAULT_CONFIG）；
//   依赖面 {} 不变。本基线只反映 index.js 的 ①。
//   判据守恒：路由数 68 不变、配置键 143 不变、依赖面 {} 不变；仅默认值与注释演进。
// 2026-10-02 #164 收口: 白板 CAS/修订版身份接线（plan-store CAS + withCalendarLock + 原子提交 + 归档命名 -<uuid>）——宿主 lib/index.js 有意演进，基线按新哈希重钉。
// ★2026-10-02 基线演 R72→R73（审计修复批 #182/#178/#205，增量归因）：
//   ① #182/F06+F31：共享日历三条写 API 改「锁内读盘最新原文 → 单条修改 → 原子写回」，
//      新增 _calendarTransactionPre，并给 writeFullRaw 的 CALENDAR.md 分支接 writeTextAtomicPre；
//      同时 parseCalendar 与 migrate-pack.calendarMergePre 的正则补 `--:--`（原会把合法无时限条目静默丢掉）。
//   ② #178/F01：compactLegacyLayer 的归档提到回写量护栏之前，且归档「全部」被移除段
//      （原实现只归档 while 循环移出的前缀段，单老段场景零归档后被护栏清空）。
//   ③ #205/F30：saveConfig 用户记忆目录迁移补 mkdir + 失败回滚 + 原子写（失败不再静默切真源）。
//   判据守恒：路由数 69 不变（#205 只改迁移语义，未新增路由；本批新增的 /team-control 在下一段落地后再计）、
//      依赖面 {} 不变。**守卫语义不变**：仍锁「index.js 一经改动即被本锁抓住」。
// 2026-10-03 批次 C（审计修复 #186..#204 + R01/R02）：宿主 lib/index.js 有意演进（E4 路由数仍为 69 不变）；E3 固化哈希按最终字节重钉。
// ★2026-10-03 基线演 R73→R74（审计 §G1/G2 批次 G，增量归因）：
//   ① #167/P0：自动沉淀 [USER] 一律不再直写全局用户级 MEMORY.md，改落待确认区
//      PENDING-USER-MEMORY.md；**同一语义的第二处直写点**（consolidateMemory 做梦式固化）
//      同轮改齐，否则只改一处＝半修。
//   ② #167/P1：解析层新增**确定性过滤**（filterPointsPre，纯函数零随机/时钟）——
//      拦空壳变体/过程叙述开头/过短/重复，三档 log/note/user 各过滤一次。
//   ③ #207：三处「读→改→裸 writeFileSync」改按路径串行 + tmp→rename 原子写
//      （cont-seq.json / continued-sessions.json / 归档账本），并删除自建的第二套按文件链
//      （统一复用 lib/path-write-queue.js，不另起第三套锁）；归档账本读取端改
//      readJsonQuarantinePreSync（损坏先隔离，不再静默丢史）。
//   ④ #207-4：新增 DEFAULT_CONFIG.localWasmPaths（auto 默认 / off）+ 以 getter 惰性读取，
//      供 semantic-js-worker 把 onnxruntime-web 的 wasm 路径本地化。
//   判据守恒：路由数 70 不变（本批零新增路由）；依赖面 {} 不变。
//   **守卫语义不变**：仍锁「index.js 一经改动即被本锁抓住」。
// ★2026-10-04 issue #211：宿主新增 py-setup-uninstall 路由（Python 引擎卸载）⇒ 基线按最终字节重钉，
//   路由数 70→71（同批 E4 判据同步）。守卫语义不变：仍锁「index.js 一经改动即被本锁抓住」。
// ★2026-10-05 工作台路径归一（社区报告 Android 符号链接）：基线按最终字节重钉。守卫语义不变。
//   R76 = R75 + 2026-10-05 社区报告（Android `/data/user/0` ↔ `/data/data` 符号链接别名恒 cwd-mismatch）：
//   ①新增 _canonPath（realpathSync.native → realpathSync → 父目录+basename 兜底 → resolve；win32 剥 \\?\ 扩展前缀）；
//   ②_workbenchCwd 返回值与包含判定、_verifyWorkbench 第①项 cwd 比较、工作区登记比较四处改走 realpath 归一；
//   ③新建熔断 _wbCreateFailStreak：同 (epoch, 失败原因) 连续 3 次 verify-after-create 失败即停新建只报 needPrompt（成功清零、换因重计）。
// ★2026-10-05 批次 W（PR#210 拆取）：基线按最终字节重钉。守卫语义不变：仍锁「index.js 一经改动即被本锁抓住」。
//   R77 = R76 + 2026-10-05 批次 W（PR#210 拆取）：cont-seq 锁内持久预留/失败不发号 + 冷扫放开 120（leaf 跳过/目录拒绝指路/SQLite seed 门槛）+
//   回滚变 no-op（允许空洞、永不回收，用户裁定）+ 锁与 calendar-lock 物理合一；接续闩分片 auto-continue-done.d + (mtime,size) 缓存；
//   pending 三段持久化 + 两入口拦截 + 恢复 CLI；归档账本锁内 delta 合并 + 提交失败外显并跳过删除；W5 创建门类型化回退放行单。
// ★2026-10-05 批次 X（PR#212 拆取）：基线按最终字节重钉。守卫语义不变：仍锁「index.js 一经改动即被本锁抓住」。
//   R78 = R77 + 2026-10-05 批次 X（PR#212「Fix seven residual data-safety and ownership issues」后端拆取，只取 #1/#2/#3/#4/#7 五项）：
//   ①X1 删除 CAS：storage-manage.deleteMemory 对实际读到的 buf 算 sha256 无条件传 expectedDigest（GUI 免 digest 请求也进 CAS），冲突 conflict-external-edit。
//   ②X2 note 绑定服务端：/note 路由 sessionId+expectedNotesPath 必填、resolvePathsForSession+wsBound 判定、目的地漂移 409、去重读目标盘而非全局 notesText 缓存、写成功仅当 state 指向同工作区同文件才更新缓存。
//   ③X3 JSON 路径重写：migrate-pack 新增 rewriteJsonPathsPre（.json/.jsonl 逐行 parse 验证 → 字符串 token 解码重写重编码，未触及 token 字面保留），rewritePackForTargetPre 按扩展名分派。
//   ④X4 procedure 证据五子项：①owner 限定（consolidate success 块 owner=sessionId+canonicalize(ws) 双归属，直接 addEvidence 改为先落盘后由 persistEvidence 按 appended 喂统计；context-host/activation-host 注入按捕获工作区 ref 检索 + activation-host 加 runtime 工作区绑定校验）；②recentEvidenceForSuccess 加 owner 过滤与 success-exclusion（5 分钟窗同源身份不重复计）；③procedureWorkspaceRef 用现行 canonicalize（m4-corpus canonicalWorkspaceKey），不引入 PR 的 workspace-key.js（#179 领地）；④procedure-store normalizeSessions 统一 sessionRefOf 同盐同长哈希身份（sessionIdentityVersion=2，≥24 字符遗留截断保留 _legacySessions 不计数）；⑤evidence-store loadEvents 加 strict（ledger-read-failed/ledger-corrupt fail closed，display 保持容忍），strict 读加 30s 指纹校验进程内缓存（读失败不缓存、append 失效）消 IO 放大。
//   ⑤X5 导入安全：_readExistingWorkspaceFiles 全量占用名清单（>8MB 带 {kind,bytes,digest}、目录/特殊文件占位、除根 ENOENT 外错误上抛）；inspect/import 两处 catch(_){} 改 fail closed（target-inspection-failed）；migrationPreviewToken 覆盖全部占用名；commit 前逐文件 lstat+digest 复核（PLAN too-large 用流式摘要作期望版本）；additions 弃用 PR 的 wx+link()（网络盘 EPERM 风险）改 lstat 确认空闲+原子写+成功才 recordCommit；逐文件套 withCalendarLock；backup 名加 randomUUID 防同秒撞名。
// ★2026-10-05 批次 Z（PR#213 拆取）：基线按最终字节重钉。守卫语义不变：仍锁「index.js 一经改动即被本锁抓住」。
//   R79 = R78 + 2026-10-05 批次 Z（PR#213「Fix settings persistence, scoped drafts and runtime control feedback」后端拆取）：
//   ①Z1 新 lib/settings-safety.js 全文（readSettingsForSave 保存期严格读——损坏配置拒绝保存，绝不把默认写回真源，与启动期 config-io quarantine 分工；validateSettingsPatch 字段级校验（HH:MM/数组/整数域/枚举）；validateSettingsPaths 祖先 realpath 防 symlink 逃逸；migrateSettingsTree 所有权日志迁移器——dev/ino+sha256 回执 ⇒ 回滚只删自己拷的、重试安全、首扫+复扫 TOCTOU 拦截）。
//   ②Z2 saveConfig 事务体重放 _saveConfigChecked：仍走 R01 的 _configSaveChain 单一串行队列（不另设 PR 的 _settingsSaveQueue 第二套）；迁移失败回滚并回滚已拷文件、原子写失败回滚迁移（pendingCommit 日志成功才清理）、refresh 失败转 warning（持久化已成功不谎报）；#205 用户记忆迁移 mkdir 语义保留。
//   ③Z3 /config 路由字段级 400 all-or-nothing（error+fields 带字段名；#117/S1 路径闸语义由 validateSettingsPaths 接管且更强；injectExcludeSources 校验通过后仍 trim+去空）。
//   ④Z4 迁移过滤精确化：copyDir 逐文件 COPYFILE_EXCL + retained 回执；只滤普通文件 .lock/.lock.acquire/.tmp[-.N] 数字链（.tmp. 持久名与 .lock 目录不误伤）；user 级 level-0 白名单 MEMORY/CALENDAR/PENDING-USER-MEMORY.md + summaries/greetings 子目录；migrateSettingsTree 首扫+复扫按 entry types。
//   ⑤Z5 /note 迁移协调（迁移中 409 settings-migration-active + _settingsNoteFlights drain + per-notesPath 串行队列 _noteRouteQueues）+ 白板迁移屏障（ensurePlanBoardPre/ensurePlanBoardForAgentPre/writePlanSnapshot 的 migration-active/root-changed 门 + _settingsPlanFlights drain + memory_note 工具 plan 分支 projectDir 复验）+ /semantic-emit 损坏配置原样保留 + 原子写失败显式 500。
//   ⑥Z6 writePlanSnapshot 挂 _settingsPlanFlights，#164 CAS（expectedRevision + latest!==existing 冲突判据）原样保留不回退。
// ★2026-10-05 上下文节省修复（调查 3 · 注入节奏未生效）：基线按最终字节重钉。守卫语义不变：仍锁「index.js 一经改动即被本锁抓住」。
//   R80 = R79 + 2026-10-05 分级注入收口（renderMemoryDynamic 的 4 个返回路径共用一份「本轮是否获授完整版」判据）：
//   ①旧实现的两个下游兜底返回点恒给 snap（完整版）：日志指纹未变时整段节流被跳过 ⇒ 直接落到函数末尾返回全文，
//     即「每轮都灌 4000+ 字完整版」。诊断日志里「精简版 3545 / 完整版 35」是假账——那条 diag 打在真实返回之前，
//     且 fullEverySlims 门槛命中 0 次（_slimCount 只在极少走的节流分支里自增）。
//   ②新增函数级 tieredFullGranted（获授标志）与 countTieredSlim()（精简计数助手，两个返回路径共用）。
//   ③降级条件（R80 当时）= gap>0 && snap && tieredNewTurn && !tieredFullGranted && slimText —— 只有「新 turn 且未获授」才给精简版；
//     同 turn 内的后续注入保持完整版（文本逐字节相同，宿主 project() 去重，不额外投递；降级会破坏 context-observer 的 prompt 不变契约）。
//   ④首次注入（st._snapFp===undefined）与 gap=0 / snapshotTieredInject=false 三条既有语义原样保留，均给完整版。
//   ⑤收口修正（同日复核）：降级条件曾收窄为「新 turn 且未获授」—— 该收窄已被 R81 推翻（见下），此处保留历史记录。
//     破坏 context-observer 的 prompt 逐字节不变契约；同时恢复两个下游分支的完整版语义：
//     首次注入、内容已变且间距已满足、暂缓放行三个分支均给完整版（它们的语义本就是「该给的时候给足」），
//     仅「新 turn 且未获授」时才降级为精简版。
//   ★R81 = R80 + 2026-10-05 二次修复（第一轮修复无效，真根因在指纹正则）：
//   ①真根因：日志段指纹前瞻 (?=\n\[|...) 里的「换行+左方括号」会命中日志**正文**中以 [YYYY-MM-DD] 开头的行
//     ⇒ 惰性 [\s\S]*? 立刻收尾。实测匹配结果就是 [最近 1 天工作日志(尾部)] 共 **16 字符**，
//     而该段真实长约 **769 字符**（覆盖仅 2%）⇒ 标题行是常量 ⇒ logFp 恒等 ⇒ 不等判据永假
//     ⇒ 节流整段被跳过 ⇒ 每轮都落到函数尾返回完整版。修法：前瞻加 (?!\d{4}-) 排除日期行，
//     并把该逻辑收敛为单一助手 snapshotLogFpPre（原两处各自内联，改了一处会留半修）。
//   ②第二层：尾部守卫原要求 tieredNewTurn（仅新 turn 首次降级），于是同 turn 内每个 step 都返回完整版。
//     实测基线（本会话真实投递 131 次）：完整版 118 / 精简版 13，累计投递 2,431,806 字节。
//     现改为「本轮未获授完整版即降级」；唯一例外是快照与上次注入逐字节相同（返回全文交宿主 project() 去重）。
//     修复后同一回放：完整版 18 / 精简版 114，累计 370,857 字节 ⇒ **降 85%**。
//   ③同一步内重复调用的**逐字节一致性**（context-observer / m53 契约）：尾部例外分支条件是"快照与此前已注入的那份相同"，
//     与是否新 turn 无关。写成「新 turn 且快照相同」会让同一步第二次调用返回精简版 ⇒ prompt 在同一步内变化 ⇒ 两套件红。
//   ⑤计量盲区一并修掉：原 diag 打在**所有 return 之前**，「日志显示精简版」≠ 真返回精简版。现改为在每个真实返回点就近打点（共 7 处）。
//   ④判据纪律：上一轮用**合成夹具**验证，日志正文是普通行 ⇒ 漏掉真根因（假绿）。
//     本轮改为「含日期行的真实结构夹具」，并对旧正则做**变异反向验证**（旧正则下 T1-d/T4/T4-b 三红，还原复绿）。
// ★2026-10-06 批次 V2-1 重钉（R82 → R83）：lib/index.js 有意演进 —— 路径安全统一修（AUDIT §3.0 铁律 2 / §3.4，五项同根）：
//   ①**落 lib/file-boundary.js 为路径边界判据的单一来源**（canonPath / pathKey / withinRoot / fileWithinRoots，
//     判据=物理归一 + path.relative 四联；后三者逐字承接 PR#230 的 fileWithinRoots 语义，含 allowMissing 与悬空链接拒）；
//   ②_canonPath / _pathKey 由「自带函数体」改为**委托**该模块（消除全仓最后一份重复 realpath 判据），调用点与行为逐字不变；
//   ③#228：isUnderMemoryTree 由纯词法 resolve+startsWith 改双侧物理归一，并新增 memoryTreePathOf 返回**被校验过的物理路径**——
//     /file 路由改为「判定与读取同一物理路径」（原先「校验词法路径、按原路径读盘」⇒ 树内 junction 越界读 200）；
//     handoffPanelData.fileQ 与 skinAbsPathOfPre 两个同族面一并接线；
//   ④#236：m4-corpus.canonicalScopeGuard 的 real.startsWith(declaredRoot) 改组件级 withinRoot（相邻同前缀目录不再漏检）；
//   ⑤#233：settings-safety.validateSettingsPaths 删去 realpath 之前的未归一词法 inside 闸，位置判定全部走 canonicalDirectory（与 migrateSettingsTree 同函数）；
//   ⑥#222：_saveConfigChecked 的迁移判据由展开后**字符串**比较改物理同根（rootChanged 单一判据，两处使用），物理同根跳过迁移照常原子写；
//   ⑦#229：皮肤名正则首字符限 [A-Za-z0-9_] 且显式拒纯点，另加**两处**落点物理归属校验（请求级 + 每文件写盘前）。
//   守卫语义不变：仍锁「宿主 lib/index.js 归一化 LF 后的 sha256 前 16 位大写」这一基线常量，只更新被锁的字节值。
// ★2026-10-06 批次 C-1 重钉（R81 → R82）：lib/index.js 有意演进 —— C-1b（PR#237 后端拆取，AUDIT §3.6）：
//   ①_canonPath 由「realpath(自身) → realpath(父目录)+basename → resolve」改为**循环向上找最近存在祖先 + 完整缺失后缀**
//     （DeepCode 自定义多层新目录在 mkdir 前也必须保持同一物理路径；旧实现只回拼一层 basename）；
//   ②新增 _pathKey（= _canonPath + win32 小写化），把原先 5 处各写一份的「去尾斜杠 + toLowerCase」判据收敛为单一 helper
//     （_verifyWorkbench 登记比较 / _pruneStaleWorkbenchWorkspaces / 第①项 cwd 比较 / resolveWorkspaceIdForSession / 补登记查重）；
//   ③_workbenchCwd 的 rel 越界判据由**前缀匹配**改为**组件级**（rel === '..' 或 '..' + path.sep 开头），
//     消除「同级的 `..foo` 目录被误判越界」；同批 C-1a 另接 python-setup verifyArtifact（不改本文件）。
//   守卫语义不变：仍锁「宿主 lib/index.js 归一化 LF 后的 sha256 前 16 位大写」这一基线常量，只更新被锁的字节值。
// ★2026-10-06 批次 B-1 重钉（R80 → R81）：lib/index.js 有意演进 —— 落地 #218 跨进程配置事务
// ★2026-10-06 批次 B-1 重钉（R80 → R81）：lib/index.js 有意演进 —— 落地 #218 跨进程配置事务
//   （新增 lib/config-lock.js；loadConfigSync/loadConfig/saveConfig 三入口进锁 + _configReadOnly 抑制
//   启动期两处裸写 + ★容量迁移两处写点纳入同一事务并锁内新鲜读合并 + loadConfigSync 拆为薄壳/_loadConfigSyncLocked）
//   与 #225（compactAnchoredLayer 快照 CAS + 冲突重读重算重试 + 归档改走 store 串行队列）。
//   守卫语义不变：仍锁「宿主 lib/index.js 归一化 LF 后的 sha256 前 16 位大写」这一基线常量，只更新被锁的字节值。
// ★2026-10-06 批次 A-1 重钉（R79 → R80）：lib/index.js 有意演进 —— A-1a/A-1b（hub-io save 失败可见化 + procedure-store 六处落盘结果传播）、A-1c（rollbackBoth 四修）、A-1d（team-attribution 解包按 ok 门控）、A-1e（#234 导出适用项目改用调用会话项目）、A-1f（defineTool items 透传 + armAutoContinue 子代理守卫）。
//   守卫语义不变：仍锁「宿主 lib/index.js 归一化 LF 后的 sha256 前 16 位大写」这一基线常量，只更新被锁的字节值。
// ★2026-10-06 批次 INJ-1 重钉（R83 → R84）：lib/index.js 有意演进 —— 注入分级三修（DESIGN-20261006-INJECTION-ASYMMETRY-FIX §B.4）：
//   ①S1：`renderMemoryDynamic` 的「本面与此前已注入的那份逐字节相同」分支**不再作为返回完整版的判据**（该判据假设
//     「本面不变 ⇒ 宿主 project() 会抑制本次投递」，而宿主去重粒度是**全部 context 面拼接后的整串**，唤回面一变即失效）；
//     该分支改为与其它未获授路径一致：先计一次精简投递再返回精简版，「本面未变」事实仅保留用于 diag 留痕。
//   ②S2：`DEFAULT_CONFIG.fullEverySlims` 3 → 10；计数口径由「`_slimStep` 每满 `slimEveryRounds` 步折算一次」改为
//     **每次实际返回精简版即 +1**（`_slimCount` = 精简版投递次数；`_slimStep` 降级为纯诊断计数，不参与门控）。
//   ③S3：该 `text()` 回调所有 return 路径收口 —— 返完整版的分支一律不计数，返精简版的分支一律计数；
//     末尾兜底新增「未获授且本可给精简版 ⇒ 给精简版」护栏，杜绝退回「每轮灌全文」。
//   判据守恒：路由数 71 不变、依赖面 {} 不变。
//   守卫语义不变：仍锁「宿主 lib/index.js 归一化 LF 后的 sha256 前 16 位大写」这一基线常量，只更新被锁的字节值。
// ★2026-10-06 批次 INJ-2 重钉（R84 → R85）：lib/index.js 有意演进 —— 完整版门槛出厂默认的**一次性迁移**
//   （本批新增，与 2026-09-18 的容量默认迁移同型同根因）：
//   ①常量区三联：`DEFAULT_FULL_EVERY_SLIMS = 10`（唯一真源）/ `DEFAULT_FULL_EVERY_SLIMS_PREV = 3`（迁移判据）
//     / `FULL_EVERY_SLIM_DEFAULTS_VERSION = 1`（只升一次的档位守门）；`DEFAULT_CONFIG.fullEverySlims`
//     改引常量，并新增同风格的版本号键 `fullEverySlimsDefaultsVersion`。
//   ②新增方法 `upgradeFullEverySlimsDefaultPre(rawCfg)`：仅在配置里**恰好**还是上一版默认(3)时才抬到 10
//     （用户自设值如 5/20 一律不动），异常一律吞掉（fail-soft）。
//   ③接线：`_loadConfigSyncLocked` 与 `_loadConfigLocked` **两条加载路径**都把该迁移并入既有 bumped 数组，
//     并**同样传磁盘原文 `parsed`** —— 合并结果里版本号恒等于当前值，拿它当守卫会结构性恒真。
//   回归守卫 = 新增套件 smoke-test-inj2-full-every-slims-migrate（13 条，含正/负/陷阱回归/幂等/fail-soft 与真磁盘副作用）。
//   判据守恒：路由数 71 不变、依赖面 {} 不变、既有 capacityDefaultsVersion 键与两条容量迁移调用点均未动。
//   守卫语义不变：仍锁「宿主 lib/index.js 归一化 LF 后的 sha256 前 16 位大写」这一基线常量，只更新被锁的字节值。
// ★2026-10-08 批次 A1 重钉（R85 → R86）：lib/index.js **有意演进** —— A1 三项修复：
//   ①#248 C01：applyNoteStatusPre 的快照 digest 入 CAS（writeFull 传 expectedDigest），
//     compactLegacyLayer 改读磁盘快照 + 回写带 CAS、冲突转结构化拒绝（conflict-retry-exhausted）；
//   ②#249 C02：新增 lib/memory-mutation-transaction.js，生产写通道统一 admission
//     （迁移窗口内新写 409 SETTINGS_MIGRATION_ACTIVE；已受理的写照常完成由既有 drain 拷入新根）；
//   ③#251 RL-01：apply 的资源所有权前移（disposeSurfaces 幂等 + sources effect 提前登记 + 异常回滚），
//     hub feed/boot 计时器改挂 surfaces disposer 栈，dispose 后不再有迟到心跳写盘。
//   守卫语义不变：仍锁「宿主 lib/index.js 归一化 LF 后的 sha256 前 16 位大写」这一基线常量，只更新被锁的字节值。
//   （重钉值 4C9E0A6B2C750A84 由**本套件自身的剥离表达式**复算得出。）
// ★2026-10-08 批次 L-A 重钉（R86 → R87）：lib/index.js **有意演进** —— L-A 车道六项 + 一处跨车道接线：
//   ①#253 RL-03：SessionRuntimeStore.dispose/disposeAll 收口 Context Host per-runtime 态
//     （`contextHost.disposeRuntime` 此前**全仓零调用方** ⇒ pathsByKey 陈旧快照 + sink 侧会话态不回收），
//     并在 apply 的 host 装配段把 `runtimes._contextHost` 与既有两处**成对回填**；
//   ②#257 SEC-01：敏感段策略收敛为 lib/injection-policy.js 单一来源（同文件内联版删除），
//     Tier-0 常驻目录的来源正文与命中投影**双双过过滤**（旧实现两处都绕开 ⇒ 密钥进 prompt）；
//   ③#258 SEC-02：新增 lib/team-policy.js 并接线（配置写门 / 白板 / 日历 / 四个写盘原语 / 发送出口），
//     `_assertTeamActionPre` 调用点 0 → 9；HTTP 侧补 statusCode 映射（403 而非 500）；
//   ④#260 OBS-01：轮转检查移入写队列、每次按「已落字节+本行」判定 + 单行 8192B 上限
//     （旧实现首次轮转成功即永久跳过）；
//   ⑤#264 OCR-02：python-setup 加 isLive 准入（exclusive 包装 + uninstall），index.js 注入 `!engine._disposed`；
//   ⑥#269：健康探测挂 child/stdin/stdout/stderr 四处 error 监听、轮询首查即结束并回填 error 码，
//     新增 `_healthProbeSpawn` 接缝（**默认实参即产线 cpSpawn**，无「测试模式」分支）；
//   ⑦跨车道接线（L-B #250）：`rehydrateProcedureScopes` 改调 `io.load({ pendingSnapshot, authoritativeIds })`，
//     删掉本文件内手写的「磁盘∪内存」并集（同一语义两份实现）。
//   判据守恒：路由数 71 不变、依赖面 {} 不变（均为**代数性**改动，未新增/删除路由）。
//   守卫语义不变：仍锁「宿主 lib/index.js 归一化 LF 后的 sha256 前 16 位大写」这一基线常量，只更新被锁的字节值。
//   （重钉值 694C206E798AAE14 由**本套件自身的剥离表达式**复算得出：本文件第 23 行 IX 的 sha256 前 16 位大写。）
// ★2026-10-08 R2 重钉（R88 → R89）：lib/index.js **有意演进** —— C 类 #254 MAINT-01（用户裁定方案 B'「缩进续行」）：
//   ①parseCalendar 增加**缩进续行**识别（多行备注不再在解析阶段丢行）；②renderCalendar 对含 \n 的 note 按缩进续行输出；
//   ③孪生路径 lib/migrate-pack.js 的 calendarMergePre 同步（同一条缺陷的第二个出口：旧实现把 note 拼回单行）。
//   判据守恒：路由数 71 不变、依赖面 {} 不变（未新增/删除路由，仅函数体语义修正）。
//   守卫语义不变：仍锁「宿主 lib/index.js 归一化 LF 后的 sha256 前 16 位大写」这一基线常量，只更新被锁的字节值。
//   （重钉值 1BBD701335E01BCA 由**本套件自身的剥离表达式**复算得出：本文件第 23 行 IX 的 sha256 前 16 位大写；
//     同口径复算 HEAD(5245e4a 侧) = 70C221D02149DF15 ⇒ 旧锁当时自洽，本次属有意演进。）
// ★2026-10-08 R3 重钉（R89 → R90）：lib/index.js **有意演进** —— P1 #281 孤立代理（会话级不可自救）：
//   truncateHead / truncateLinesBounded / truncateTail 此前按 **UTF-16 code unit** 切串，切点落在代理对
//   中间时产出**孤立代理**（实测 truncateHead('abc'+U+1F4D6+'def', 4) ⇒ 末位 code unit = U+D83D）⇒ 随注入
//   快照进 prompt ⇒ API 400 INVALID_REQUEST ⇒ 该会话每轮都失败且无法自救（注入每轮发生，新开会话复发）。
//   现三处切点仅在「恰落在对中间」时挪动 1 位（head 左移 / tail 右移），其余情形输出**逐字节不变**
//   （由专项套件 tests/smoke/smoke-test-issue281-surrogate-truncate.mjs 断言全等，含负路径变异必红）。
//   判据守恒：路由数 71 不变、依赖面 {} 不变（未新增/删除路由，仅函数体语义修正）。
//   守卫语义不变：仍锁「宿主 lib/index.js 归一化 LF 后的 sha256 前 16 位大写」这一基线常量，只更新被锁的字节值。
//   （重钉值 3EAC76EE1B072D25 由**本套件自身的剥离表达式**复算得出：本文件第 23 行 IX 的 sha256 前 16 位大写；
//     专项套件以自身表达式独立复算同值，两处口径一致。）
// ★2026-10-08 L-A2 重钉（R91 → R92）：lib/index.js **有意演进** —— #259 SEC-03 迁移导出的物理边界：
//   `migrateExport` 打包时**跟随 symlink**，把记忆根之外的文件内容打进导出包（实测复现：
//   根内 `outside.md` → 根外机密，旧实现下 `pack.files` 出现 `outside.md` 且带根外正文）。
//   修法：打包边界改用 lib/file-boundary.js 的 `fileWithinRoots`（组件级物理边界，**本仓判据单一来源**），
//   并**读被校验过的物理路径**；目录侧 `allowMissing:false`、文件侧 `strict:true`，越界条目拒绝并计入 `skipped`
//   （不静默丢）。用户级 `CALENDAR.md` 同样收在用户根的物理边界内。
//   判据守恒：路由数 71 不变、依赖面 {} 不变（未新增/删除路由，仅函数体语义修正）。
//   守卫语义不变：仍锁「宿主 lib/index.js 归一化 LF 后的 sha256 前 16 位大写」这一基线常量，只更新被锁的字节值。
//   （重钉值 2757E6FC00782277 由**本套件自身的剥离表达式**复算得出：本文件第 23 行 IX 的 sha256 前 16 位大写。）
// ★2026-10-08 L-E 重钉（R92 → R93）：lib/index.js **有意演进** —— #261（OBS-02）定时固化/维护的失败可观测性：
//   旧实现「**开始就写当日 Done 标记** + `catch(() => {})` 空吞」⇒ 一次失败即占住当日名额：
//   用户既看不到失败（无诊断回执），也没有任何补救机会（当日 tick 恒被 Done 挡住；tickTime 每 15s 一次）。
//   修法：改为「**成功才写 Done**」，新增模块级有界重试台账（上限 3 次、最小间隔 60s），
//   失败写类型化诊断回执（只留 `type=`/`code=`，不放 message/stack/路径），并新增只读投影
//   `debugInfo().associativeMemory.schedule`（计数/时间戳/安全错误码，最小投影纪律）。
//   ★间隔为何必需：触发窗口 `hhmm === 计划时刻` **只有 1 分钟宽**；若只限次数不限间隔，
//     3 次额度会在 ~45s 内烧光（tick 15s）⇒ 一次瞬时故障丢掉整天。故重试跨出该分钟继续，并强制 ≥60s。
//   判据守恒：路由数 71 不变、依赖面 {} 不变（未新增/删除路由，仅调度段与投影追加）。
//   守卫语义不变：仍锁「宿主 lib/index.js 归一化 LF 后的 sha256 前 16 位大写」这一基线常量，只更新被锁的字节值。
//   ★同日 L-E 追加（R93 内二次重钉，非新 R）：R93 首落后又并入 **autoSummary 第三实例**
//     （同型调度根因：标记先写 + 被调方空 `catch` ⇒ 失败无回执、当日不再跑；且相比固化/维护
//     **零人工工具入口**，故更彻底），投影相应扩出 `schedule.autoSummary` ⇒ 锁值按最终字节更新。
//   （重钉值 6BAF2F63C7517E17 由**本套件自身的剥离表达式**复算得出：本文件第 23 行 IX 的 sha256 前 16 位大写；
//     另以独立探针同表达式复算同值，两处口径一致。）
// ★2026-10-08 L-A3 重钉（R93 → R94）：lib/index.js **有意演进** —— 批 A-1 后端接续判据两条：
//   ①#285（前后端资格判据不同源）：硬信号可 arm，但前端确认卡按普通比例门过滤 ⇒ 已 armed 却无入口。
//     本道只做**后端协议透出**：`st.armed` 补 `hard` / `hardReason` / `hardAt`（原因取自既有信号
//     `state.waterLevelHardTrigger`，并**同时落到 runtime 快照** `rt.waterLevelHardTrigger` —— 因为 arm 的
//     两条调用路径都从 runtime 读整份快照，而 state 是全局单值、跨会话可能被覆盖），
//     `autoContinueState` 的 armed 投影一并带出。非硬信号路径 `hard=false` ⇒ 前端仍走原比例门（行为不变）。
//   ②#286（忙闲判据用跨会话 30s 全局活动窗）：`awaitIdle` 原读 `_globalLastActiveAt`（任意会话活动即刷新）
//     ⇒ 静默 35s 的长工具被误判空闲、源回合被 cancel；且**其它会话的活动反而挡住本会话**。
//     现改读宿主**按会话**权威状态 `ctx.agents.get(sid).status`（`AgentStatus = 'idle' | 'running'`，
//     见 @deepseek-ai/dsh-agent runtime-types.d.ts:90/147；与 restoreLastAgent 同一 `_agentSvc` 调用形态），
//     取不到/非已知值 ⇒ unknown ⇒ **继续等待**（保守侧），保留 5 次×20s 有界封顶。
//   判据守恒：路由数 71 不变、依赖面 {} 不变（未新增/删除路由，仅函数体语义修正）。
//   守卫语义不变：仍锁「宿主 lib/index.js 归一化 LF 后的 sha256 前 16 位大写」这一基线常量，只更新被锁的字节值。
//   （重钉值 2070A07D0424D4B4 由**本套件自身的剥离表达式**复算得出：本文件第 23 行 IX 的 sha256 前 16 位大写。）
// ★2026-10-08 L-A4 重钉（R94 → R95）：lib/index.js **有意演进** —— 批 B #291 转写包文件名冲突：
//   旧命名 `prev-session-` + `sid.slice(0,8)` + 秒级 HHMMSS + `.md` ⇒ 同工作区、同秒、前 8 字符相同的
//   两个来源落到**同一路径**，后写**静默覆盖**前一份；先返回的 transcriptPath 仍指向该路径 ⇒
//   新会话按第 3 层读到时读到的是**别的来源**的任务。
//   收口：① 身份改 `sha256(sid)` 前 16 位 hex（64 bit，生日界远超实机会话量级，且不暴露原始 id）；
//   ② 并入 `contSeq`（同源多次生成可区分 —— 为此把 `allocContSeq` 提前到 outPath 计算**之前**）；
//   ③ stamp 由秒级 HHMMSS 改为 `replace(/[-:.TZ]/g,'')`（含日期 + 毫秒）；
//   ④ 写入改 `{ encoding:'utf8', flag:'wx' }`（已存在即拒绝而非覆盖），EEXIST 明确 diag 不静默。
//   命名三段均为 [\w-] ⇒ 仍匹配既有 lister 正则 `/^prev-session-[\w-]+\.md$/`（:4266），无需改正则。
//   判据守恒：路由数 71 不变、依赖面 {} 不变（未新增/删除路由，仅函数体语义修正）。
//   守卫语义不变：仍锁「宿主 lib/index.js 归一化 LF 后的 sha256 前 16 位大写」这一基线常量，只更新被锁的字节值。
//   （重钉值 2B0EBDD4B0B79166 由**本套件自身的剥离表达式**复算得出：本文件第 23 行 IX 的 sha256 前 16 位大写。）
// ★2026-10-08 L-A5 重钉（R95 → R96）：lib/index.js **有意演进** —— #302 长用户请求跨接续保全：
//   缺陷：单条用户消息 > PER_MSG(2000) 被 slimTranscriptPre 截断，且第 2 层近期线程用的是**同一份已截断**的
//   msgs（`m.text.slice(0,700)`）⇒ 目标位于 2,000 之后的请求在**所有层**都拿不到，却报告接续成功。
//   收口（按已批准契约 docs/internal/DESIGN-20261008-CONTINUE-USER-REQUEST-PRESERVATION.md）：
//   ① 新增 handoffDir/prev-req-<sha256(sid)16hex>-<stamp17>-s<contSeq>.md（与 #291 转写**同族**：
//      复用同一次已预留 contSeq、同一份 stamp、同一 sha256 身份段）；**不用** prev-session- 前缀
//      ⇒ 不落进 /^prev-session-[\w-]+\.md$/，不挤占 8 篇转写配额、不污染账本/白板血缘；
//   ② **仅当**存在 role==='user' && text.length > PER_MSG 的消息才写（短请求零影响、carry 逐字节不变）；
//   ③ 写入 `{flag:'wx'}` 拒绝覆盖；上限 512 KB（保留最新、从旧到新省略并如实标注条数与字符数）；
//   ④ **写失败必须中止本次接续**：与转写写失败同一套 catch 语义（同一份 rollback + 高水位不回退），
//      并用既有 `stateError()` 工厂（lib/continuation-state.js:13）标记 statePersistence 以穿透两处 fail-soft catch。
//      顺序安全性：hostAutoContinue 先 `await buildContinueCarry`(:5396)、后才 `sc.cancel`(:5415)。
//   ⑤ 读取路径入**永不截断**的 navParts（assembleCarryPre 契约），紧跟转写路径一行。
//   判据守恒：路由数 71 不变、依赖面 {} 不变（未新增/删除路由，仅函数体语义修正）。
//   守卫语义不变：仍锁「宿主 lib/index.js 归一化 LF 后的 sha256 前 16 位大写」这一基线常量，只更新被锁的字节值。
//   （重钉值 DE327ACEBA2D8C58 由**本套件自身的剥离表达式**复算得出：本文件第 23 行 IX 的 sha256 前 16 位大写。）
// ★2026-10-08 L-A6 重钉（R96 → R97）：lib/index.js **有意演进** —— 批 D #290 模型继承失败静默降级：
//   旧实现 `try { await sc.selectModel(...) } catch (eM) { diag(...) }` 只 diag（异常被吞），
//   且 `st.lastOk.model` / 返回体**无条件复制请求值** d.model ⇒ 实测「delivered=宿主默认，reported=源模型」、
//   error 空、completed=true（用户以为模型沿用了，实际没有，且无任何可观测迹象）。
//   用户裁定（2026-10-08）：**允许降级，但必须如实标注**（依据：停旧回合 sc.cancel :5415 先于模型继承
//   :5492 ⇒「继承失败即拒绝投递」会把用户晾在「旧回合已停、新会话未投递」的半路状态）。
//   收口：① 失败留痕 modelDegraded/modelDegradeReason（取 code 优先）；② 回执改报**已确认的实际模型**
//      （复用既有范式 agentForSessionId → sessionEventsOf → findSessionModelPre 真读回会话日志），
//      读不回来 ⇒ model:'' + modelConfirmed:false（**不用请求值冒充**）；③ 保留 modelRequested 供前端说明原请求。
//   判据守恒：路由数 71 不变、依赖面 {} 不变（未新增/删除路由，仅函数体语义修正）。
//   守卫语义不变：仍锁「宿主 lib/index.js 归一化 LF 后的 sha256 前 16 位大写」这一基线常量，只更新被锁的字节值。
//   （重钉值 3129DD367094B658 由**本套件自身的剥离表达式**复算得出：本文件第 23 行 IX 的 sha256 前 16 位大写。）
// ★2026-10-08 L-A9 重钉（R98 → R99）：lib/index.js **有意演进** —— 「如实标注」全覆盖（补批 D 可见性缺口）：
//   缺口：批 D 只在 `selectModel` **抛错**时留痕；而条件是「三与」`d.provider && d.model && typeof sc.selectModel`，
//   不成立时整段被跳过 ⇒ `modelDegraded` 不设、`modelRequested` 空串 ⇒ 前端两条标注分支都不触发 ⇒
//   用户看到「✓ 已自动接续」却不知道模型没沿用（L-A8 负路径实测挖出）。
//   收口：把「继承**未能进行**」也按降级如实标注，原因码分开 —— `source-model-unknown`（源会话无模型信息，
//     属合法情形，只标注不拒绝）/ `selectModel-unavailable`（宿主老版本无 selectModel，论证：对用户的客观
//     结果同样是跑在宿主默认模型上，故**也算降级**）；返回体补 `modelRequested`（批 D 只放进了 lastOk）。
//   ★纯补可见性：不触碰任何判定/开关/流程（是否调用 selectModel、是否建会话、是否投递全部原样）。
//   判据守恒：路由数 71 不变、依赖面 {} 不变（未新增/删除路由，仅函数体语义修正）。
//   守卫语义不变：仍锁「宿主 lib/index.js 归一化 LF 后的 sha256 前 16 位大写」这一基线常量，只更新被锁的字节值。
//   （重钉值 3B746E839FC79413 由**本套件自身的剥离表达式**复算得出：本文件第 23 行 IX 的 sha256 前 16 位大写。）
// ★2026-10-08 #304/#305 重钉（R93 → R94）：lib/index.js **有意演进**（并发一致性家族修复）：
//   · #304：maintain 的「读源 → 双摘要校验 → 删除」整段进入**跨进程物理路径文档锁**
//     （新增 _withDocumentLockPre 助手；与 MemoryDocumentStore 的写事务锁同名同路径 `file + '.lock'` ⇒ 追加插不进该窗口）；
//   · #305：新增 mutation flight 的登记/有界 drain（迁移前等待**普通写通道**落盘），
//     并在提交边界复核持久配置根未变（变了 ⇒ 409 SETTINGS_ROOT_CHANGED，不再静默成功落旧根）。
//   判据守恒：路由数不变、依赖面不变（未新增/删除路由）；E3 仍锁「归一化 LF 后 sha256 前 16 位大写」这一基线常量，
//   仅按**本套件自身表达式**复算后的新字节值重钉（2026-10-01 裁定：判据随有意演进上移，不回滚成果）。
//   （重钉值 93178A3940DE9796 由本文件第 23 行 IX 的 sha256 前 16 位大写复算得出；IX 实测 966,870 字符。）
// ★2026-10-09 判据重钉（round-2，判据过期非缺陷）：本批有意改动 lib/index.js 两处 ——
//   · #319 归档发布段接入 `_withDocumentLockPre`（多一层缩进 + 注释）；
//   · #320 迁移 drain 未收敛改 fail-closed（抛 SETTINGS_MIGRATION_PENDING_WRITES，不再只记 diag）。
//   二者都是「宿主有意演进」，E3 的**判据意图不变**（宿主哈希不得无痕漂移），按本仓 2026-10-01 裁定
//   「判据过期改判据、不回滚成果」重钉常量。重钉值由**本套件自身的剥离表达式**（第 23 行 IX 的
//   `replace(/\\r\\n/g,'\\n')` 后 sha256 前 16 位大写）复算得出，未手工拼装。
eq(createHash('sha256').update(IX).digest('hex').slice(0, 16).toUpperCase(), '47701D38BD436B02', 'E3 ★宿主 lib/index.js 基线守恒（R95 = R94 + 2026-10-09 round-2 #319/#320 残留修复（归档发布进文档锁 + 迁移 drain fail-closed）← R94 = R93 + 2026-10-08 #304/#305 并发一致性（maintain 删除进跨进程文档锁 + mutation flight 登记/有界 drain + 提交边界复核持久根） 2026-10-08 L-E #261（OBS-02）定时固化/维护/时段总结失败可观测性（成功才写 Done + 有界重试 + 诊断回执 + schedule 只读投影；含 autoSummary 第三实例）；原 R92 = R91 + 2026-10-08 L-A2 #259 SEC-03 迁移导出物理边界；原 R91 = R90 + #280 A4/B 维护归档（源/归档双摘要 + 校验通过才删源 + 归档发布进 mutation 事务）） ；原 R90 = R89 + 2026-10-08 P1 #281 孤立代理修复（三个截断函数加代理对安全切点）；原 R89 = R88 + 2026-10-08 C 类 #254（方案 B\' 缩进续行：parseCalendar 续行识别 + renderCalendar 续行输出 + migrate-pack 孪生同口径））；原 R80 = R79 + 2026-10-06 #226 改法A（异常监听具名化 + 卸载 removeListener + 复位两个 guard 标志）＝ R79 = R78 + 2026-10-05 批次 Z（PR#213「Fix seven residual data-safety and ownership issues」后端拆取）：X1 删除 CAS（deleteMemory 对实际 buf 无条件 sha256 CAS，冲突 conflict-external-edit）；X2 note 绑定服务端（/note 路由 sessionId+expectedNotesPath 必填 + resolvePathsForSession + 409 漂移 + 读盘去重 + 缓存按归属更新）；X3 JSON 路径重写（rewriteJsonPathsPre token 级重写，.json/.jsonl 分派）；X4 procedure 证据五子项（owner 双归属限定 + 先持久化后统计 + success-exclusion + procedureWorkspaceRef=canonicalize 不引入 workspace-key.js（#179 领地）+ normalizeSessions 统一哈希身份 + loadEvents strict（30s 指纹缓存，读失败不缓存，display 保持容忍））；X5 导入安全（全量占用名清单 + target-inspection-failed fail closed + token 全覆盖 + commit 前 lstat/digest 复核 + additions 不用 link() 改 lstat 空闲确认+原子写 + 逐文件 withCalendarLock + backup randomUUID 防同秒撞名）。；原 R77 = R76 + 2026-10-05 批次 W（PR#210「Make continuation and archive state durable (#207)」拆取采纳）：①W1 cont-seq：allocContSeq 改跨进程共享锁内「重读→(仅 last≤0 时)冷扫→推进→原子提交→成功才发布」，写失败抛错不发号；冷扫放开 120 上限（leaf 读取失败跳过、目录级错误拒绝并指路、SQLite 维持拒绝+seed 指引）；rollbackContSeq 变 no-op（「不跳号」翻转为「允许空洞、永不回收」，2026-10-05 用户裁定）；锁模块与 calendar-lock 物理合一（calendar-lock.js 变薄壳 re-export）。②W2 接续闩分片：auto-continue-done.d/<SHA256>.json + token + 旧格式只读兼容 + (mtime,size) 读取缓存，删 200 条 slice 上限。③W3 pending/恢复：reserve→setTarget(rawId)→finish 三段持久化、autoContinueState 加 pending/completed、decideAutoContinue manual 与 hostAutoContinue(armed) 两入口 pending 拦截、恢复 CLI lib/continuation-maintenance.js（三重校验+.active 锁）。④W4 归档账本 delta：saveArchiveLedger(updates,removed) 锁内新鲜读→合并→原子写；sweep 删 _saLedger 缓存每轮新鲜读；归档分支账本提交失败 rep.ok=false+errors 外显+提前 return 跳过本轮删除。⑤W5 创建门：createSuccessor 包装 —— details.sessionId 存在即持久化原始 ID 不二建；仅类型化放行单（CONTINUE_CREATE_FALLBACK_ALLOWED_CODES）且 workspaceId 规范化精确匹配才放行源 cwd 回退，其余保留 pending。；原 R76 = R75 + 2026-10-05 工作台路径符号链接归一 + 新建熔断（见上方注释）；原 R75 = R74 + 2026-10-04 issue #211：新增 /python-setup/uninstall 路由 + python-setup 模块 uninstall()（删 <userDir>/python-engine 整目录）；原 R74 = R73 + 2026-10-03 批次 G：①#167/P0 [USER] 不直写全局（自动沉淀 + 做梦式固化两处同改，落 PENDING-USER-MEMORY.md）；②#167/P1 解析层确定性过滤（filterPointsPre，三档各一次）；③#207 三处裸写改按路径串行 + 原子写（cont-seq / 接续闩 / 归档账本），删自建第二套按文件链统一走 path-write-queue，归档账本读取改损坏隔离；④#207-4 新增 localWasmPaths 键 + worker wasm 路径本地化。前序 R73 = R72 + 2026-10-02 审计修复批 A+B 批：#182/#178/#205/#184 + #174/#185 团队接线（含 /team-control 路由、装配段 pull 定时器移位、_teamOutbox.load、真实卸载路径接团队 dispose）：①日历三写入口改锁内读盘+原子写，正则补 --:--；②compactLegacyLayer 归档提到护栏前且归档全部被移除段；③saveConfig 迁移补 mkdir+失败回滚+原子写。前序 R72 = R71 + 2026-10-01 接续开关默认开：DEFAULT_CONFIG.globalBriefEnabled false→true（用户裁定「把读取外部记忆的开关默认打开」）；前序 R71 = R70 + 2026-10-01 自写豁免接线 + 团队注入候选生产者：①_noteSelfWritePre 原为零调用点 ⇒ 挂到 4 个写盘原语（appendText/writeFullRaw/writeFullSingle/writeFull）⇒ 豁免真正生效；②_teamInjectCandidates 原只有 = [] 两次赋值、无生产者 ⇒ 把 pullOnce 的 appliedEntries 经 normalizeTeamSegmentsPre 喂入。前序 R70 = 记忆注入优化；原 R70 说明：（R70 + 2026-10-01 全局动态简报批：新增 lib/global-brief.js 纯模块 + 8 个 globalBrief* 配置键 + 精简版注入路径补 diag（用户要求可计量）+ 简报段并入注入主路径；前序 R70 = R69 + 记忆注入优化：精简版瘦身 + 完整版两档门槛 + 2 个配置键 + 2 层提示词；原 R69 说明：①规则编辑 GUI 路由按 expect 内容锚定防索引漂移 ②两处 _degradePre 死代码改接真实 _degradeSink ③sessions 兜底说明不再写死「39 个旧会话/descriptor v2」改为如实输出；归一化 LF 后计。前序 R68 = R67 + G 批发射闸单钥匙化；R63→R65 放行 = skinAssetRelOfPre/skinAbsPathOfPre 加 deep 参数（素材路由 ?deep=1 选暗色资源）+ #152 增量开关每轮取值 + #153 默认模型回退共用解析器（provider/实现名不再混用）+ #154 接续创建失败显式报错不丢源工作区 + 上述 3.2.5 全部修复保留，理由见上）')
// ★2026-10-08 R1 重钉（R87 → R88）：lib/index.js **有意演进** —— R1 收口修 issue #174：
//   #258 的发送出口包装（`engine._teamFetch = async (...) => ...`）是个**裸箭头函数**，
//   把原 teamFetch 的属性面 `dispose/describe/readToken` 全部丢掉 ⇒ 卸载路径的
//   `typeof engine._teamFetch.dispose === 'function'` 恒假、在途请求的 AbortController 永不
//   abort（issue174 的 dispose 断言实测抓到）。改为把这三个属性从 rawFetch 搬到包装体上。
//   判据守恒：路由数 71 不变、依赖面 {} 不变（未新增/删除路由）。
//   守卫语义不变：仍锁「宿主 lib/index.js 归一化 LF 后的 sha256 前 16 位大写」这一基线常量，只更新被锁的字节值。
//   （重钉值 70C221D02149DF15 由**本套件自身的剥离表达式**复算得出：本文件第 23 行 IX 的 sha256 前 16 位大写。）
// ★2026-09-28 计数演进：67→68（新增 skin-library-fetch，见 E3 同批）。语义保留：仍锁路由数不漂移。
eq(cnt(IX, "path: API[") + cnt(IX, 'path: API.'), 71, 'E4 ★路由数守恒 = 71（2026-10-04 issue #211 /python-setup/uninstall +1；2026-09-28 皮肤库 +1；2026-10-01 /global-brief +1；2026-10-02 审计修复批 #174 /team-control +1；其余零新增）')
console.log('lib/client.js ' + Buffer.byteLength(SRC, 'utf8') + 'B / CRLF ' + (SRC.match(/\r\n/g) || []).length + ' / sha16 ' + createHash('sha256').update(SRC).digest('hex').slice(0, 16).toUpperCase())
console.log('PASS ' + p + ' / FAIL ' + f)
fails.forEach((x) => console.log('  FAIL: ' + x))
process.exit(f === 0 ? 0 : 1)
