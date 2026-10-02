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
// 2026-10-02 audit plus PR206 owner regression: diagnostic selects one ALS/last-agent owner; real route barriers validate paths and readonly IO.
eq(createHash('sha256').update(IX).digest('hex').slice(0, 16).toUpperCase(), '09727A6927804559', 'E3 ★宿主 lib/index.js 基线守恒（R72 = R71 + 2026-10-01 接续开关默认开：DEFAULT_CONFIG.globalBriefEnabled false→true（用户裁定「把读取外部记忆的开关默认打开」）；前序 R71 = R70 + 2026-10-01 自写豁免接线 + 团队注入候选生产者：①_noteSelfWritePre 原为零调用点 ⇒ 挂到 4 个写盘原语（appendText/writeFullRaw/writeFullSingle/writeFull）⇒ 豁免真正生效；②_teamInjectCandidates 原只有 = [] 两次赋值、无生产者 ⇒ 把 pullOnce 的 appliedEntries 经 normalizeTeamSegmentsPre 喂入。前序 R70 = 记忆注入优化；原 R70 说明：（R70 + 2026-10-01 全局动态简报批：新增 lib/global-brief.js 纯模块 + 8 个 globalBrief* 配置键 + 精简版注入路径补 diag（用户要求可计量）+ 简报段并入注入主路径；前序 R70 = R69 + 记忆注入优化：精简版瘦身 + 完整版两档门槛 + 2 个配置键 + 2 层提示词；原 R69 说明：①规则编辑 GUI 路由按 expect 内容锚定防索引漂移 ②两处 _degradePre 死代码改接真实 _degradeSink ③sessions 兜底说明不再写死「39 个旧会话/descriptor v2」改为如实输出；归一化 LF 后计。前序 R68 = R67 + G 批发射闸单钥匙化；R63→R65 放行 = skinAssetRelOfPre/skinAbsPathOfPre 加 deep 参数（素材路由 ?deep=1 选暗色资源）+ #152 增量开关每轮取值 + #153 默认模型回退共用解析器（provider/实现名不再混用）+ #154 接续创建失败显式报错不丢源工作区 + 上述 3.2.5 全部修复保留，理由见上）')
// ★2026-09-28 计数演进：67→68（新增 skin-library-fetch，见 E3 同批）。语义保留：仍锁路由数不漂移。
eq(cnt(IX, "path: API[") + cnt(IX, 'path: API.'), 69, 'E4 ★路由数守恒 = 69（2026-09-28 皮肤库 +1；2026-10-01 /global-brief +1；其余零新增）')
console.log('lib/client.js ' + Buffer.byteLength(SRC, 'utf8') + 'B / CRLF ' + (SRC.match(/\r\n/g) || []).length + ' / sha16 ' + createHash('sha256').update(SRC).digest('hex').slice(0, 16).toUpperCase())
console.log('PASS ' + p + ' / FAIL ' + f)
fails.forEach((x) => console.log('  FAIL: ' + x))
process.exit(f === 0 ? 0 : 1)
