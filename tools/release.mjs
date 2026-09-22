#!/usr/bin/env node
/**
 * release.mjs — 预览版(auto-memory-pre / *_pre) → 正式版(auto-memory / 裸名) 自动发布构建
 * 用法: node tools/release.mjs <版本号> [--dry-run]
 *   例: node tools/release.mjs 0.1.30 --dry-run
 * 流程: 复制预览版 → 反转全部 _pre/-pre 标识(发布转换输入禁止出现 _dev/auto-memory-dev) →
 *       生成正式 package.json → 语法/BOM/残留验证。
 * 源目录: 默认 D:\dsh-auto-memory(preview 分支),可用环境变量 DSH_AUTO_MEMORY_DEV 覆盖。
 * 目标目录: 默认 D:\dsh_debug\_publish_dsh-auto-memory,可用环境变量 DSH_AUTO_MEMORY_REL 覆盖;
 *           --dry-run 时强制改用临时 staging 目录,不触碰真实发布基座,不做任何发布动作。
 */
import { cpSync, readFileSync, writeFileSync, rmSync, existsSync, readdirSync, statSync, mkdirSync } from 'node:fs'
import { execSync } from 'node:child_process'
import path from 'node:path'
import { tmpdir } from 'node:os'

// ---------- 1. 参数 ----------
const argv = process.argv.slice(2)
const dryRun = argv.includes('--dry-run')
const version = argv.find((a) => !a.startsWith('--'))
if (!/^\d+\.\d+\.\d+$/.test(version || '')) {
  console.error('用法: node tools/release.mjs <版本号> [--dry-run]  例: node tools/release.mjs 0.1.30 --dry-run')
  process.exit(1)
}

const DEV = process.env.DSH_AUTO_MEMORY_DEV || 'D:\\dsh-auto-memory'          // 预览版源(preview 工作区)
let REL = process.env.DSH_AUTO_MEMORY_REL || 'D:\\dsh_debug\\_publish_dsh-auto-memory' // 发布基座(保留 .git)

// ---------- 2. 复制预览版文件(--dry-run 使用临时 staging) ----------
console.log('[release] 版本:', version, dryRun ? '(dry-run staging)' : '')
if (dryRun) {
  REL = path.join(tmpdir(), 'dam-release-staging-' + Date.now())
  console.log('[release] staging 目录:', REL)
}
if (!existsSync(DEV)) { console.error('[release] ❌ 源目录不存在:', DEV); process.exit(1) }
mkdirSync(REL, { recursive: true })
for (const entry of readdirSync(REL)) {
  if (entry === '.git' || entry === '.gitignore') continue
  rmSync(path.join(REL, entry), { recursive: true, force: true })
}
const copyDirExcluding = (src, dst, excludeRe) => {
  mkdirSync(dst, { recursive: true })
  for (const entry of readdirSync(src)) {
    if (excludeRe.test(entry)) continue
    const s = path.join(src, entry), d = path.join(dst, entry)
    if (statSync(s).isDirectory()) copyDirExcluding(s, d, excludeRe)
    else cpSync(s, d)
  }
}
copyDirExcluding(path.join(DEV, 'lib'), path.join(REL, 'lib'), /\.bak/)
copyDirExcluding(path.join(DEV, 'tests'), path.join(REL, 'tests'), /node_modules/)
copyDirExcluding(path.join(DEV, 'python'), path.join(REL, 'python'), /(__pycache__|\.pyc|bench)/)
for (const entry of ['cordis.patch.yml', 'README.md', 'README.zh-CN.md', 'LICENSE', 'notices.json', 'docs', 'social-preview.html', '.github',
  // ★2026-09-21 补 CHANGELOG.md：两份 README **各有 3 处**链接到 `CHANGELOG.md`（导航条 / 文末链接区，
  //   共 6 处），但此文件此前**从不在复制清单里**，REL 仓也从未有过它 ⇒ GitHub 上点「Changelog」
  //   一直是 **404**（`git log --all -- CHANGELOG.md` 为空可证）。发版脚本漏拷，属真断链。
  'CHANGELOG.md']) {
  const s = path.join(DEV, entry), d = path.join(REL, entry)
  if (existsSync(s)) cpSync(s, d, { recursive: true })
}
// ★2026-09-22：把发版线**必需的两个工具**带进发布包 —— CI 运行器 + 转换表真源。
//   背景：此前 tools/ 整个不在复制清单，REL 仓因此**从未有过 tools/**，main 上既没有
//   `tools/run-smoke.mjs`（CI 无从运行）也没有 `tools/release.mjs`（t7e / issue110 /
//   issue111 / p9-rules-lifecycle 四支守卫顶层 read 它 → ENOENT 崩，连与它无关的断言一并失效）。
//   为什么是**过滤拷贝**而不是把 'tools' 加进上面的白名单：tools/ 共 38 个文件，含
//   `*.bak-*` 备份与一批探针/截图临时脚本，整目录拷会把它们一并推上 main。
//   闸门安全性（已核对）：残留闸门 scanTargets（L565-580）与凭据闸门 walk 面（L669
//   `['lib','python','docs','.github']`）**都不含 tools/**；且 tools/ 不在 transformFiles 里
//   ⇒ 这两份文件以**原样**入包，其中的 `xxx-pre` 名保持不动，正是四支守卫要读的「转换表真源」。
// ★清单刻意**不写成「方括号 + 两个单引号字符串」的成对形态**：issue111 会用正则扫 release.mjs
//   里的这种成对字面量来重建转换表，任何形状相同的短对都会被当成一条「转换对」。
//   ⚠️ 本注释的早先版本就踩了这个坑 —— 那个示例短对被收进表内、且位置在真表之前（**先于真表生效**），
//   使 relName() 把 /api/dsh-auto-memory/ 推成 /bpi/dsh-buto-memory-pre/，issue111 八条断言集体假红。
//   改用字符串 split 形态，对扫描正则不可见。
for (const toolFile of 'run-smoke.mjs,release.mjs'.split(',')) {
  const src = path.join(DEV, 'tools', toolFile)
  if (!existsSync(src)) continue
  mkdirSync(path.join(REL, 'tools'), { recursive: true })
  cpSync(src, path.join(REL, 'tools', toolFile))
}

// ---------- 3. pre → 正式 反转(精确替换;转换输入一律 _pre,禁止 _dev) ----------
const transforms = [
  // client 注册 id(本地身份 → npm 身份)
  ['@deepseek-ai/dsh-auto-memory', '@a9i5k4/dsh-auto-memory'],
  // 14 个工具名 + 客户端文案
  ['memory_consolidate_pre', 'memory_consolidate'],
  ['memory_maintain_pre', 'memory_maintain'],
  ['memory_external_pre', 'memory_external'],
  ['memory_read_pre', 'memory_read'],
  ['memory_recall_pre', 'memory_recall'],
  ['memory_reflect_pre', 'memory_reflect'],
  ['memory_status_pre', 'memory_status'],
  ['memory_note_pre', 'memory_note'],
  ['memory_user_pre', 'memory_user'],
  ['memory_log_pre', 'memory_log'],
  // ★P9(2026-09-22)：条目级增删改工具。**两张表都要登记**（漏一处的真实事故见上方 T7-e 注）。
  ['memory_rules_pre', 'memory_rules'],
  // ★T7-e(2026-09-20 用户报「发布后这些工具后面的 -pre 是要去掉的」)：以下 3 个工具
  //   **此前不在表里** ⇒ 发布物残留 `_pre`（memory_expand_pre / memory_trace_pre 实测证实，
  //   见 REL 线 D:\dsh_debug\_publish_dsh-auto-memory\lib\index.js），而 memory_procedure_pre
  //   是 T4 新增工具、3.0.0 之后才有的 ⇒ 下次发布也会带 `_pre` 出去。
  //   ⚠️ 顺序无关（各名字互不为前缀），但放在同类工具名之后便于人工核对。
  ['memory_expand_pre', 'memory_expand'],
  ['memory_trace_pre', 'memory_trace'],
  ['memory_procedure_pre', 'memory_procedure'],
  ['calendar_remove_pre', 'calendar_remove'],
  ['calendar_done_pre', 'calendar_done'],
  ['calendar_list_pre', 'calendar_list'],
  ['calendar_add_pre', 'calendar_add'],
  // 缓存文件名(必须先于 auto-memory-pre 通用规则,避免被吞)
  ['update-check-pre', 'update-check'],
  ['notices-cache-pre', 'notices-cache'],
  // 存储目录身份(v0.1.30 新引入,首发布改名零迁移成本)——引号段/斜杠注释/裸路径三种形态
  ['memory/hub-pre', 'memory/hub'],
  ["'hub-pre'", "'hub'"],
  ['hub-pre/', 'hub/'],
  ['memory/index-pre', 'memory/index'],
  ["'index-pre'", "'index'"],
  ['index-pre/', 'index/'],
  ['memory/semantic-pre', 'memory/semantic'],
  ["'semantic-pre'", "'semantic'"],
  ['semantic-pre/', 'semantic/'],
  ['semantic-pre ', 'semantic '],
  // 反引号形态(注释里写 `semantic-pre` 时上面四个模式都覆盖不到 → 残留校验会挡发布,2026-09-10 实机踩到)
  ['`semantic-pre`', '`semantic`'],
  ['memory/evidence-pre', 'memory/evidence'],
  ["'evidence-pre'", "'evidence'"],
  ['evidence-pre/', 'evidence/'],
  // 证据 id 连字符形式(access-evidence-pre-v1 → access-evidence-v1;必须先于 evidence_pre_v1)
  ['access-evidence-pre-v1', 'access-evidence-v1'],
  // 持久化 namespace / 诊断日志前缀(必须先于 auto-memory-pre 通用规则)
  ['dsh-auto-memory-pre', 'dsh-auto-memory'],
  // 全局 auto-memory-pre 标识(name/slots/API/context/localStorage/配置文件/日志前缀)
  ['auto-memory-pre', 'auto-memory'],
  // M7.6 模块文件名(python-setup-pre.js → python-setup.js;含 import 引用与文件自身)
  ['python-setup-pre.js', 'python-setup.js'],
  // systemPrompt context/section 注册名前缀
  ['dsh:auto-memory-pre', 'dsh:auto-memory'],
  ['dsh:m6-reference-tail-pre', 'dsh:m6-reference-tail'],
  // API 路由 map 键与路径(路由段 -pre 后缀一并去)
  ['activation-inbox-pre', 'activation-inbox'],
  // 版本策略/常量身份(_pre_vN → 裸名;这些值写入持久化 policyVersion/engineTier 与
  // 策略工件文件名——v0.1.30 首次对外发布,统一裸名,无历史包袱)
  ['activation_policy_pre_v2', 'activation_policy_v2'],
  ['m7_activation_features_pre_v2', 'm7_activation_features_v2'],
  ['activation_features_pre_v2', 'activation_features_v2'],
  ['activation_policy_v2', 'activation_policy_v2'],
  ['activation_pre_v1', 'activation_v1'],
  ['capability_pre_v1', 'capability_v1'],
  ['context_bridge_pre_v1', 'context_bridge_v1'],
  ['episodic_store_pre_v1', 'episodic_store_v1'],
  ['evidence_store_pre_v1', 'evidence_store_v1'],
  ['evidence_pre_v1', 'evidence_v1'],
  ['fact_store_pre_v1', 'fact_store_v1'],
  ['fake_threshold_pre_v1', 'fake_threshold_v1'],
  ['gate_pre_v1', 'gate_v1'],
  ['index_sync_final_pre_v1', 'index_sync_final_v1'],
  ['index_sync_pre_v1', 'index_sync_v1'],
  ['js_activation_decide_pre_v1', 'js_activation_decide_v1'],
  ['js_semantic_dl_pre_v1', 'js_semantic_dl_v1'],
  ['js_semantic_engine_pre_v1', 'js_semantic_engine_v1'],
  ['lexical_pre_v1', 'lexical_v1'],
  ['lexical_pre_v2', 'lexical_v2'],
  ['m7_chunk_pre_v1', 'm7_chunk_v1'],
  ['m7_embedding_pre_v1', 'm7_embedding_v1'],
  ['m7_fake_threshold_pre_v1', 'm7_fake_threshold_v1'],
  ['m7_index_sync_host_pre_v1', 'm7_index_sync_host_v1'],
  ['m7_semantic_threshold_pre_v1', 'm7_semantic_threshold_v1'],
  ['m7_wire_pre_v1', 'm7_wire_v1'],
  ['memory_hub_pre_v1', 'memory_hub_v1'],
  ['handoff_ledger_weight_pre_v1', 'handoff_ledger_weight_v1'],
  ['l0_index_pre_v1', 'l0_index_v1'],
  ['memory_importance_pre_v1', 'memory_importance_v1'],
  ['evidence_agg_pre_v1', 'evidence_agg_v1'],
  // L0 索引目录名(index-pre → index,与 host 转换后一致;l0-index-pre 自指串同被覆盖)
  ['index-pre', 'index'],
  ['fusion_pre_v1', 'fusion_v1'],
  ['evidence_policy_pre_v1', 'evidence_policy_v1'],
  ['procedure_store_pre_v1', 'procedure_store_v1'],
  ['recall_intent_lr_pre_v1', 'recall_intent_lr_v1'],
  ['semantic_derived_pre_v1', 'semantic_derived_v1'],
  ['semantic_shadow_pre_v1', 'semantic_shadow_v1'],
  ['semantic_vectors_pre_v1', 'semantic_vectors_v1'],
  ['skill_tail_pre_v1', 'skill_tail_v1'],
  ['storage_manage_pre_v1', 'storage_manage_v1'],
  ['judgement_shadow_pre_v1', 'judgement_shadow_v1'],
  ['worker_semantic_pre_v1', 'worker_semantic_v1'],
  ['worker_pre_v1', 'worker_v1'],
  // P13 后新增符号/目录名(recall-fusion 版本串、importance fixture、测试 fixture 与 host 目录名同步)
  ['fusion_pre_v1', 'fusion_v1'],
  ['evidence_policy_pre_v1', 'evidence_policy_v1'],
  ['evidence-pre', 'evidence'],
  ['hub-pre', 'hub'],
  ['bge-m3-onnx-int8-pre-v1', 'bge-m3-onnx-int8-v1'],
  ['js_semantic_tier_pre_v1', 'js_semantic_tier_v1'],
  ['anc_pre_', 'anc_'],
  // staging smoke 引用的 artifacts 相对路径上跳一级(moved into tests/smoke)
  // 事件/候选 id 前缀(obs_pre_/cand_pre_/... → 裸名)
  ['act_pre_', 'act_'],
  // lib 模块文件名的文档性引用(python 注释/决策记录里 lib/xxx-pre.js → lib/xxx.js)
  // 必须在 libRenameMap 之前以字符串替换形态覆盖全部文件内容
  ['evidence-store-pre.js', 'evidence-store.js'],
  ['m7-wire-pre.js', 'm7-wire.js'],
  ['context-bridge-pre.js', 'context-bridge.js'],
  ['shadow-retrieval-pre.js', 'shadow-retrieval.js'],
  // ★正则转义形(2026-09-22, PR#128 根因)：测试断言普遍写成 `\.\/xxx-pre\.js`
  //   —— 反斜杠隔开了 `.`，而上面的模块改名用的是纯串 `split('xxx-pre.js')`，
  //   匹配不到 ⇒ 切换成裸名后这些断言在发布线找不到模块，实测 **8 个套件 15 条断言**变红
  //   （board-index-atomic / graph-mode / i5-status-filter / p4-l0-response / t0-3 /
  //    t0-8 / three-layer / water-window）。
  //   同时让 2 条**反向**断言（note-status 不得依赖 memory-anchor、t0-8 保护门不得反向
  //   依赖 wb-contract）从「改写后永真的假绿」恢复成真守卫。
  //   一条通用规则覆盖全部转义形；开发树源码无此形态，故对 pre 线零影响。
  ['-pre\\.js', '.js'],
  ['cand_pre_', 'cand_'],
  ['chk_pre_', 'chk_'],
  ['epi_pre_', 'epi_'],
  ['ev_pre_', 'ev_'],
  ['fact_pre_', 'fact_'],
  ['frm_pre_', 'frm_'],
  ['idx_pre_', 'idx_'],
  ['ntf_pre_', 'ntf_'],
  ['obs_pre_', 'obs_'],
  ['pkt_pre_', 'pkt_'],
  ['proc_pre_', 'proc_'],
  ['req_pre_', 'req_'],
  ['ret_pre_', 'ret_'],
  ['syn_pre_', 'syn_'],
  ['wk_pre_', 'wk_'],
  // JS 侧 SCREAMING 常量名(_PRE_V1 → _V1)
  ['_PRE_V2', '_V2'],
  ['_PRE_V1', '_V1'],
  // ★2026-09-17（3.0.0）按「形态」补齐通用规则 —— 此前只有零星十来个短前缀被逐个登记，
  // 3.0 重建期新增的 ~180 个身份常量（board_mode_pre_v1 / tier_layer_inject_pre_v1 /
  // TIER_BUDGET_PRE_V1 …）无人登记 ⇒ 残留闸门必然拒绝构建，这就是 npm 长期停在 2.5.3 的第二层原因。
  // 逐个登记是错的做法（漏登记不会立刻报错，只在发版时炸）；这里改成按形态一次性覆盖。
  // 安全性：本表是把**整棵发布子树**做同一次文本替换（lib/ tests/ python/ policies 全覆盖），
  // 写方与读方一起改，键名仍然自洽；旧版 pre 身份写下的持久化键会自然失效（与既有改名同一纪律）。
  // 顺序：必须排在 SCREAMING 规则之后、且比下面更具体的条目更靠后无妨（两者结果一致）。
  ['-pre-v1', '-v1'],        // 连字符形式：bge-m3-onnx-int8-pre-v1 → bge-m3-onnx-int8-v1
  ['-pre-v2', '-v2'],
  ['_pre_v2', '_v2'],        // 小写版本后缀：lexical_pre_v2 → lexical_v2
  ['_pre_v1', '_v1'],        // 小写版本后缀：board_mode_pre_v1 → board_mode_v1
  ['_PRE_', '_'],            // SCREAMING 短前缀：AFT_PRE_ / _DISPATCH_PRE_ / DEFAULT_PRE_
  ['_pre_', '_'],            // 小写短前缀：act_pre_x / idx_pre_x / skill:proc_pre_x
  // UI label 与 GUIDANCE 的预览标记
  [' (dev)', ''],
  ['(开发版)', ''],
  ['开发版,', ''],
  ['（预览版,', '('],
  ['(预览版)', ''],
  ['预览版,', ''],
]
// lib 内部模块文件名重命名(xxx-pre.js → xxx.js;先文件后导入,m4-/m7- 前缀模块同步去前缀段内 -pre)
const libModuleRenames = [
  'activation-host-pre.js', 'activation-inbox-pre.js', 'activation-inbox-state-pre.js',
  'context-bridge-pre.js', 'context-host-pre.js', 'context-sink-python-pre.js',
  'evidence-agg-pre.js', 'episodic-store-pre.js', 'evidence-store-pre.js', 'fact-store-pre.js',
  'handoff-anchor-pre.js', 'index-sync-pre.js', 'intent-clean-pre.js', 'l0-extract-pre.js',
  'l0-index-pre.js', 'm4-corpus-pre.js', 'memory-importance-pre.js',
  'm7-index-sync-host-pre.js', 'm7-wire-pre.js', 'memory-anchor-pre.js',
  'memory-hub-pre.js', 'memory-index-pre.js', 'memory-writer-pre.js',
  'procedure-store-pre.js', 'python-sidecar-client-pre.js', 'python-transport-pre.js',
  'recall-fusion-pre.js', 'semantic-decide-pre.js', 'semantic-js-pre.js',
  'shadow-host-pre.js', 'shadow-retrieval-pre.js', 'storage-manage-pre.js',
  'temporal-parse-pre.js', 'python-setup-pre.js',
  // 2.2.4 新增模块(子代理痕迹回收 / 上下文窗口解析)
  'subagent-gc-pre.js', 'water-window-pre.js',
  // ★2026-09-22 新增模块：记忆迁移搬包引擎（零依赖纯逻辑，IO 全在宿主）。
  // 漏登记后果：残留闸门会在产物里扫到 `migrate-pack-pre.js` / `_pre_v1` 而拒绝构建
  // （见下方 3.0.0 那段同源注释 —— 3.0 的 pre 线曾因此从未成功打出发布包）。
  'migrate-pack-pre.js',
  // issue #48 新增模块(有界 rename 重试,Windows 瞬时句柄争用)
  'fs-retry-pre.js',
  // issue #30 新增模块(procedure 观察态标记 / 运行时信封清洗)
  'procedure-observation-pre.js', 'intent-clean-safe-pre.js',
  // ★2026-09-17（3.0.0）补齐：3.0 底层重建期新增的 15 个模块此前**从未登记**，
  // 导致残留闸门每次都在 tests/smoke 里扫到 `-pre.js` / `_pre_v1` / `_pre_` 而拒绝构建
  // —— 即 3.0 的 pre 线从来没成功打出过发布包（npm 因此长期停在 2.5.3）。
  // 这 15 个文件各自被对应套件 import，登记后引用与文件名会被一并改写为裸名。
  // 覆盖面由文件末尾的「模块重命名完整性自检」强制保证，新增模块忘登记会直接 fail closed。
  'acceptance-pre.js',            // P5 验收清单
  'board-mode-pre.js',            // 白板线总开关解析
  'engine-identity-pre.js',       // P2 引擎身份
  'engine-switch-pre.js',         // P2 切换状态机
  'l0-index-sync-pre.js',         // L0 索引同步
  'ledger-criteria-pre.js',       // 判据账本(账本/白板判据)
  'memory-envelope-pre.js',       // 记忆信封
  'memory-mutation-pre.js',       // 变更边界共同保护(丢卡/用户区/重复 id)
  'rerank-host-pre.js',           // P4 精排有界窗口
  'rules-layer-pre.js',           // P6A 规则分层
  'state-commit-pre.js',          // P1 状态提交
  'tier-layer-inject-pre.js',     // C5 三层注入
  'tier0-catalog-pre.js',         // Tier-0 常驻目录
  'wb-contract-pre.js',           // S10 白板契约(判据/保护段/marker)
  'wb-sidecar-pre.js',            // S10 白板结构化 sidecar + 看板派生
  // ★2026-09-21（3.0.1）补齐第二批：3.0.0 发布后又新增/遗留的 8 个模块同样**从未登记**。
  //   干跑 `node tools/release.mjs 3.0.1 --dry-run` 时被「模块重命名完整性自检」拦下 ——
  //   若不登记，它们会以 `*-pre.js` 原名进入发布包，残留闸门必然拒绝构建。
  //   这 8 个都是**已上线功能的源文件**，不是临时文件：
  //     · rules-edit-pre.js      → R7 用户级硬性约束可视编辑（宿主 + 面板）
  //     · skill-export-*.js      → T4 技能导出（三档深度，宿主侧 + 共享逻辑）
  //     · note-status-*.js       → P6B 结论生命周期（supersedes / retract）
  //     · config-io-pre.js       → 配置原子写
  //     · dsh-home-pre.js        → dshHome() 路径解析（被多数模块 import）
  //     · degrade-pre.js         → 降级留痕
  'config-io-pre.js',             // 配置原子写
  'degrade-pre.js',               // 降级留痕
  'dsh-home-pre.js',              // dshHome() 路径解析
  'note-status-apply-pre.js',     // P6B 结论生命周期(状态落盘)
  'note-status-pre.js',           // P6B 结论生命周期(状态解析)
  'rules-edit-pre.js',            // R7 规则可视编辑
  'skill-export-host-pre.js',     // T4 技能导出(宿主侧)
  'skill-export-pre.js',          // T4 技能导出(共享逻辑)
  // ★2026-09-22（#110）：hub 持久化 IO 适配器（带健康度记账）从 index.js 抽出为独立模块。
  //   不登记的话它会以 `hub-io-pre.js` 原名进入发布包，残留闸门必然拒绝构建。
  'hub-io-pre.js',                // #110 hub 落盘 IO 失败可见化
  // ★2026-09-22（3.1.0）：procedure 开关契约模块（B-2 从 context-host / activation-host 抽出，
  //   作为「哪些开关真生效」的唯一权威判据）。同样**从未登记** —— 干跑
  //   `node tools/release.mjs 3.1.0 --dry-run` 时被「模块重命名完整性自检」拦下（fail closed 生效）。
  //   不登记它就会以 `procedure-switch-pre.js` 原名进包，残留闸门必然拒绝构建。
  'procedure-switch-pre.js',      // B-2 procedure 开关契约(注入/晋升门控的唯一权威判据)
  'jsonl-tail-cursor-pre.js',     // issue#103 环形 JSONL 增量游标(内容指纹;取自被强推冲掉的 475abfe 同名模块)
  'recall-stats-pre.js',          // 召回统计(只记录不改排序;面板统计页签的数据源)
]
const libRenameMap = libModuleRenames.map((f) => [f, f.replace(/-pre\.js$/, '.js')])
for (const [from, to] of libRenameMap) {
  const fp = path.join(REL, 'lib', from)
  if (existsSync(fp)) {
    // 先改写全部引用(lib 相对导入 + tests/smoke 导入/文档引用),再重命名文件
    for (const f of readdirSync(path.join(REL, 'lib'))) {
      if (!f.endsWith('.js')) continue
      const p2 = path.join(REL, 'lib', f)
      const t = readFileSync(p2, 'utf8')
      const nt = t.split(from).join(to)
      if (nt !== t) writeFileSync(p2, nt)
    }
    const smDir = path.join(REL, 'tests', 'smoke')
    if (existsSync(smDir)) {
      for (const f of readdirSync(smDir)) {
        if (!f.endsWith('.mjs')) continue
        const p2 = path.join(smDir, f)
        const t = readFileSync(p2, 'utf8')
        const nt = t.split(from).join(to)
        if (nt !== t) writeFileSync(p2, nt)
      }
    }
    cpSync(fp, path.join(REL, 'lib', to))
    rmSync(fp)
  }
}
// ---------- 3.6 模块重命名完整性自检(2026-09-17, fail closed) ----------
// 症状(实测):新增 `*-pre.js` 模块若忘记登记进 libModuleRenames,它不会被重命名为裸名,
// lib/ 与 tests/smoke 里便仍留着 `-pre.js` 字样 → 5.5 残留闸门拒绝构建(报错点离真因很远)。
// 本自检把这个失败**前移成点名报错**:直接列出缺哪些模块,而不是让人去翻残留清单。
// 判据:DEV 树里每个 lib/*-pre.js 都必须已登记(反向不强制——白名单允许保留历史条目)。
{
  const devLib = path.join(DEV, 'lib')
  if (existsSync(devLib)) {
    const onDisk = readdirSync(devLib).filter((f) => f.endsWith('-pre.js'))
    const unregistered = onDisk.filter((f) => !libModuleRenames.includes(f))
    if (unregistered.length) {
      console.error('\n❌ lib/ 存在未登记的 -pre.js 模块(不会被重命名为裸名,残留闸门必然拒绝构建):')
      for (const f of unregistered) console.error('   · ' + f)
      console.error('   修法:把上述文件名加进 tools/release.mjs 的 libModuleRenames 数组后重跑。')
      process.exit(1)
    }
    console.log('[release] 模块重命名完整性: OK(' + onDisk.length + ' 个 -pre.js 全部已登记)')
  }
}
// ---------- 3.7 上游回流自检(2026-09-22, fail closed) ----------
// 事故(2026-09-22 实证):pre 线与 GitHub `main` 自 2026-09-07 起分叉,而**发布包从 pre 构建**。
//   于是「在 main 上修」= 白修;且 main 会被下次发布强推覆盖(PR #118/#119/#120 的合并提交
//   在本机已 `missing`)。代价:#103/#104/#105 三条 P1 修了两轮、用户侧从未拿到。
//   详见 docs/internal/WHY-FIXES-MISSING-20260922.md。
// 本自检把「上游修复必须先回流 pre 线」变成**发版前的硬闸门**:缺任一产物即拒绝构建,
//   并点名缺什么、该怎么补。清单维护在 tools/reconcile-upstream.mjs(MUST_BE_IN_PRE / MUST_MARKERS)。
{
  try {
    const { execFileSync } = await import('node:child_process')
    const out = execFileSync(process.execPath, [path.join(DEV, 'tools', 'reconcile-upstream.mjs'), '--json'], {
      cwd: DEV, encoding: 'utf8',
    })
    const r = JSON.parse(out)
    const missing = (r.artifacts || []).filter((a) => !a.present)
    const unreg = r.unregistered || []
    const orphans = (r.orphans || []).filter((o) => o.state === 'missing')
    if (missing.length || unreg.length) {
      console.error('\n❌ 上游回流自检未过(这些上游产物没有落在 pre 线,发出去就是「修了但用户拿不到」):')
      for (const m of missing) console.error('   · ' + m.p + (m.needle ? '  ⟨' + m.needle + '⟩' : '') + '  — ' + m.why)
      for (const u of unreg) console.error('   · 未登记 -pre 模块: ' + u)
      console.error('   修法:把 main 上的该修复移植进 pre 线(命名带 -pre),或把产物清单同步进')
      console.error('         tools/reconcile-upstream.mjs 的 MUST_BE_IN_PRE / MUST_MARKERS 后重跑。')
      process.exit(1)
    }
    const fork = r.fork || {}
    console.log('[release] 上游回流: OK(产物清单 ' + (r.artifacts || []).length + ' 项齐全'
      + (orphans.length ? ';注意 main 侧已有 ' + orphans.length + ' 个孤儿提交' : '') + ')')
    if (fork.preOnly !== undefined) {
      console.log('[release] 分叉度: pre 独有 ' + fork.preOnly + ' / main 独有 ' + fork.mainOnly
        + '(merge-base ' + fork.mergeBase + ' @ ' + String(fork.mergeBaseDate).slice(0, 10) + ')')
    }
  } catch (e) {
    // fail closed:拿不到对账结果本身就是异常(缺文件/脚本报错),不允许带疑发布。
    console.error('\n❌ 上游回流自检无法执行:' + String((e && e.message) || e).slice(0, 200))
    console.error('   期望 tools/reconcile-upstream.mjs 存在且可运行;若确要临时跳过,请先说明理由。')
    process.exit(1)
  }
}
// python 文件名重命名(worker_pre_v1.py → worker_v1.py 等) + 相互 import 改写
const pyRenameMap = [
  ['worker_semantic_pre_v1.py', 'worker_semantic_v1.py'],
  ['worker_pre_v1.py', 'worker_v1.py'],
  ['m7_embedding_pre_v1.py', 'm7_embedding_v1.py'],
  ['m7_activation_features_pre_v2.py', 'm7_activation_features_v2.py'],
]
if (existsSync(path.join(REL, 'python'))) {
  for (const f of readdirSync(path.join(REL, 'python'))) {
    if (!f.endsWith('.py')) continue
    const p2 = path.join(REL, 'python', f)
    let t = readFileSync(p2, 'utf8')
    let changed = false
    for (const [from, to] of pyRenameMap) {
      const stemFrom = from.replace(/\.py$/, '')
      const stemTo = to.replace(/\.py$/, '')
      if (t.includes(stemFrom)) { t = t.split(stemFrom).join(stemTo); changed = true }
    }
    if (changed) writeFileSync(p2, t)
  }
  for (const [from, to] of pyRenameMap) {
    const fp = path.join(REL, 'python', from)
    if (existsSync(fp)) { cpSync(fp, path.join(REL, 'python', to)); rmSync(fp) }
  }
  // 策略工件文件名(recall_intent_lr_pre_v1.json / activation_policy_pre_v2.json)
  // 同时覆盖 lib/policies/ 与 python/policies/ 两处副本
  for (const polDir of [path.join(REL, 'lib', 'policies'), path.join(REL, 'python', 'policies')]) {
    if (!existsSync(polDir)) continue
    for (const f of readdirSync(polDir)) {
      if (f.includes('_pre_')) {
        cpSync(path.join(polDir, f), path.join(polDir, f.replace(/_pre_v(\d)/g, '_v$1')))
        rmSync(path.join(polDir, f))
      }
    }
  }
}
let totalReplaced = 0
// 转换面 = 两个主文件 + 4 个根 smoke + 全部 lib 模块 + 策略工件 + 全部 python 文件
const transformFiles = ['lib/index.js', 'lib/client.js']
for (const f of readdirSync(path.join(REL, 'lib'))) {
  if (f.endsWith('.js')) transformFiles.push('lib/' + f)
}
if (existsSync(path.join(REL, 'tests', 'smoke'))) {
  for (const f of readdirSync(path.join(REL, 'tests', 'smoke'))) {
    if (f.endsWith('.mjs')) transformFiles.push('tests/smoke/' + f)
  }
}
const relPolDir = path.join(REL, 'lib', 'policies')
if (existsSync(relPolDir)) {
  for (const f of readdirSync(relPolDir)) {
    if (f.endsWith('.json')) transformFiles.push('lib/policies/' + f)
  }
}
if (existsSync(path.join(REL, 'python'))) {
  for (const f of readdirSync(path.join(REL, 'python'))) {
    if (f.endsWith('.py')) transformFiles.push('python/' + f)
  }
  const polDir = path.join(REL, 'python', 'policies')
  if (existsSync(polDir)) {
    for (const f of readdirSync(polDir)) {
      if (f.endsWith('.json')) transformFiles.push('python/policies/' + f)
    }
  }
}
for (const file of transformFiles) {
  const p = path.join(REL, file)
  let text = readFileSync(p, 'utf8')
  for (const [from, to] of transforms) {
    const count = text.split(from).length - 1
    if (count > 0) { text = text.split(from).join(to); totalReplaced += count }
  }
  writeFileSync(p, text)
}
console.log('[release] pre→正式 替换:', totalReplaced, '处 /', transformFiles.length, '文件')

// ---------- 3.5 cordis.patch.yml 转换(loader entry id + 包名,防止与预览版撞车) ----------
{
  const patchPath = path.join(REL, 'cordis.patch.yml')
  let pt = readFileSync(patchPath, 'utf8')
  pt = pt.split('- id: auto-memory-pre').join('- id: auto-memory')
  pt = pt.split('dsh:auto-memory-pre').join('dsh:auto-memory')
  pt = pt.split('@deepseek-ai/dsh-auto-memory').join('@a9i5k4/dsh-auto-memory')
  writeFileSync(patchPath, pt)
}

// ---------- 4. 生成正式 package.json ----------
const relPkg = {
  name: '@a9i5k4/dsh-auto-memory',
  description: 'Proactive associative memory for DSH: zero-prompt recall injected before the model speaks, three-layer auto-consolidation, skill crystallization, and Astra-style context management - handoff ledgers, PLAN whiteboard, water-level sensing. Local-first, model-agnostic, zero deps. 主动联想记忆+Astra 式上下文管理:自动唤回/自动沉淀/技能固化/交接账本与白板跨窗口续命/水位感知。',
  version,
  type: 'module',
  main: 'lib/index.js',
  exports: { '.': './lib/index.js', './client': './lib/client.js', './package.json': './package.json' },
  // #20:python/ 运行时(worker+语义引擎+策略)必须随包;bench(539MB 模型夹具)与 __pycache__ 永久排除
  // #106:发布物剔除非运行时负载 —— docs/internal(内部审计/规划/分诊)与 .bak/.bak-* 一律不进包
  files: ['lib', 'python', 'docs', 'cordis.patch.yml', '!python/bench', '!python/__pycache__', '!docs/internal', '!docs/**/*.bak', '!docs/**/*.bak-*', '!**/*.mjs.bak-*'],
  dsh: {
    bundle: { patch: './cordis.patch.yml' },
    client: {
      inject: ['@deepseek-ai/dsh-api-remotes', '@deepseek-ai/dsh-client-runtime', '@deepseek-ai/dsh-client-connection', '@deepseek-ai/dsh-client-ui-slots', '@deepseek-ai/dsh-client-ui-settings', '@deepseek-ai/dsh-client-ui-sidebar'],
      platform: 'web',
    },
  },
  keywords: ['dsh', 'deepseek-harness', 'memory', 'plugin', 'auto-memory'],
  repository: { type: 'git', url: 'git+https://github.com/Aik358/dsh-auto-memory.git' },
  peerDependencies: { '@deepseek-ai/cordis': '^4.0.1' },
  optionalDependencies: { '@huggingface/transformers': '^3.7.6' },
  license: 'BSD-3-Clause',
}
writeFileSync(path.join(REL, 'package.json'), JSON.stringify(relPkg, null, 2) + '\n')

// ---------- 4.5 版本回写开发树(2026-09-08) ----------
// 开发树经 symlink 就是本机实际加载的副本,面板徽标与「检测更新」都读它的 package.json.version。
// 此前开发树版本长期停在 0.1.30(只有 REL 树被写版本),导致界面显示 1.30、更新检查永远"有新版本"。
// 发布即把版本回写开发树,两条线的版本号永远一致。
if (!dryRun) {
  try {
    const devPkgPath = path.join(DEV, 'package.json')
    const devPkg = JSON.parse(readFileSync(devPkgPath, 'utf8'))
    if (devPkg.version !== version) {
      const prev = devPkg.version
      devPkg.version = version
      writeFileSync(devPkgPath, JSON.stringify(devPkg, null, 2) + '\n')
      console.log('[release] 开发树版本回写:', prev, '→', version)
    } else {
      console.log('[release] 开发树版本已一致:', version)
    }
  } catch (e) {
    console.warn('[release] ⚠ 开发树版本回写失败(不影响发布):', e && e.message)
  }
}

// ---------- 5. 验证 ----------
console.log('[release] 验证 ...')
// 审查修复轮2:语法检查失败必须硬退出(旧实现把执行异常当 'ERR' 可接受,存在假绿)
const check = (cmd) => {
  try { return { out: execSync(cmd, { cwd: REL, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim(), ok: true } }
  catch (e) { return { out: ((e && e.stdout) || '') + String((e && e.message) || e), ok: false } }
}
for (const f of ['lib/index.js', 'lib/client.js']) {
  const r = check('node --check ' + f)
  if (!r.ok || r.out !== '') { console.error('[release] ❌ 语法失败:', f, r.out); process.exit(1) }
}

// ---------- 5.05 版本标识一致性闸门(2026-09-10 固化,用户要求) ----------
// 症状:发版只改 package.json/RELEASE 树,而 CHANGELOG 与应用内版本标识没跟着走 →
// 「检测更新」一直拿旧版本号去比对(npm 页面/更新说明也停在上一版)。
// 本闸门把两笔固化成硬校验:任一不一致即拒绝构建。
{
  const problems = []
  const cl = path.join(DEV, 'CHANGELOG.md')
  if (!existsSync(cl)) problems.push('DEV 树缺少 CHANGELOG.md')
  else if (!readFileSync(cl, 'utf8').includes('## [' + version + ']')) problems.push('CHANGELOG.md 缺少 `## [' + version + ']` 小节')
  const devClient = path.join(DEV, 'lib', 'client.js')
  if (!readFileSync(devClient, 'utf8').includes("'" + version + "': { zh: [")) problems.push("应用内更新说明(CHANGELOG 字典)缺少 '" + version + "' 条目")
  const relClient = path.join(REL, 'lib', 'client.js')
  if (!new RegExp('client v' + version.replace(/\./g, '\\.') + ' fingerprint').test(readFileSync(relClient, 'utf8'))) problems.push('界面指纹行未同步(应为 `client v' + version + ' fingerprint`)')
  if (problems.length) {
    console.error('\n❌ 版本标识未同步,拒绝构建:')
    for (const p of problems) console.error('   · ' + p)
    console.error('   固定流程(GitHub/npm 双向提醒):改 CHANGELOG.md → 改应用内更新说明字典 → 改界面指纹行 → 重跑本脚本。')
    process.exit(1)
  }
  console.log('[release] 版本标识一致性: OK(CHANGELOG / 应用内更新说明 / 界面指纹行)')
}
// 扫描面扩大到整个 staging 树的文本文件(lib 递归 + 根部清单/文档/测试),不再只查两个 lib 文件
const walkFiles = (dir, acc) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name)
    if (entry.isDirectory()) walkFiles(p, acc)
    else if (/\.(js|mjs|cjs|json|yml|yaml|md)$/.test(entry.name)) acc.push(p)
  }
  return acc
}
const scanTargets = [path.join(REL, 'package.json'), path.join(REL, 'cordis.patch.yml')]
scanTargets.push(...walkFiles(path.join(REL, 'lib'), []))
if (existsSync(path.join(REL, 'python'))) {
  for (const entry of readdirSync(path.join(REL, 'python'), { withFileTypes: true })) {
    if (entry.isFile() && /\.py$/.test(entry.name)) scanTargets.push(path.join(REL, 'python', entry.name))
    if (entry.isDirectory() && entry.name === 'policies') {
      for (const f of readdirSync(path.join(REL, 'python', 'policies'))) {
        if (/\.json$/.test(f)) scanTargets.push(path.join(REL, 'python', 'policies', f))
      }
    }
  }
}
// staging 内的 smoke 副本也参与转换,必须一并扫描(不能扫 DEV 源文件——源码本就含 _pre)
if (existsSync(path.join(REL, 'tests', 'smoke'))) {
  for (const f of readdirSync(path.join(REL, 'tests', 'smoke'))) {
    const s = 'tests/smoke/' + f
    if (s.endsWith('.mjs')) scanTargets.push(path.join(REL, s))
  }
}
const seen = new Set()
for (const f of scanTargets) {
  if (seen.has(f)) continue
  seen.add(f)
  const b = readFileSync(f)
  if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) { console.error('[release] ❌ BOM:', f); process.exit(1) }
}
{
  const pt = readFileSync(path.join(REL, 'cordis.patch.yml'), 'utf8')
  if (!/- id: auto-memory\r?\n/.test(pt) || pt.includes('auto-memory-pre') || pt.includes('auto-memory-dev') || pt.includes('dsh:auto-memory-pre') || !pt.includes('@a9i5k4/dsh-auto-memory')) {
    console.error('[release] ❌ cordis.patch.yml 未正确转换(id/包名)'); process.exit(1)
  }
}
const residual = [
  // 预览标识(_pre/-pre)—— 发布物中必须为裸稳定名
  'memory_log_pre', 'memory_note_pre', 'memory_user_pre', 'memory_recall_pre', 'memory_maintain_pre',
  'memory_status_pre', 'memory_reflect_pre', 'memory_consolidate_pre', 'memory_external_pre', 'memory_read_pre',
  // ★T7-e(2026-09-20)：下面 3 个此前**转换表与残留表双双漏登记** ⇒ 两次发布静默带 `_pre` 出去。
  //   教训：新增工具必须**同时**登记到 transforms 与 residual 两处，否则漏了不会报警。
  //   本项已由 smoke-test-t7e-toolname-pre.mjs 做「两侧清单一致性」自动守卫。
  'memory_expand_pre', 'memory_trace_pre', 'memory_procedure_pre',
  'memory_rules_pre',
  'calendar_add_pre', 'calendar_done_pre', 'calendar_list_pre', 'calendar_remove_pre',
  'auto-memory-pre', 'update-check-pre', 'notices-cache-pre', 'dsh:auto-memory-pre',
  // 模块/存储/版本身份(发布转换后必须为裸名)
  '-pre.js', '-pre.py', 'hub-pre', 'index-pre', 'semantic-pre', 'evidence-pre',
  '_pre_v1', '_pre_v2', '_PRE_V1', '_PRE_V2', '_pre_', 'activation-inbox-pre',
  'worker_pre_v1', 'worker_semantic_pre_v1', 'm7_embedding_pre_v1', 'm7_activation_features_pre_v2',
  'activation_policy_pre_v2', 'recall_intent_lr_pre_v1', 'lexical_pre_v2', 'bge-m3-onnx-int8-pre-v1',
  // 历史开发标识(_dev/-dev)同样禁止残留
  'memory_log_dev', 'memory_note_dev', 'memory_user_dev', 'memory_recall_dev', 'memory_maintain_dev',
  'memory_status_dev', 'memory_reflect_dev', 'memory_consolidate_dev', 'memory_external_dev', 'memory_read_dev',
  'calendar_add_dev', 'calendar_done_dev', 'calendar_list_dev', 'calendar_remove_dev',
  'auto-memory-dev', 'update-check-dev', 'notices-cache-dev',
  '@deepseek-ai/dsh-auto-memory', '开发版,', '(开发版)', ' (dev)', '（预览版,', '(预览版)',
]
const bad = []
for (const f of scanTargets) {
  const relName = path.relative(REL, f)
  let text = ''
  try { text = readFileSync(f, 'utf8') } catch (e) { continue }
  for (const r of residual) if (text.includes(r)) bad.push(relName + ' 含残留: ' + r)
}
if (bad.length) { console.error('[release] ❌ 残留:\n' + bad.join('\n')); process.exit(1) }
console.log('[release] 语法 ✓ BOM ✓ 无 pre/dev 残留 ✓')

// ---------- 5.4 凭据泄露闸门(2026-09-17, fail closed) ----------
// 背景(实测):docs/ 会随 npm 包发布,而 docs/internal 里曾直接写入真实的
// fine-grained PAT 目标 gist id;用户硬性规则是「凭据只存本地记忆文件,严禁写入任何
// 将上传 GitHub/npm 的文件」。这里在打包前扫描发布树,命中即拒绝发布并点名文件。
// 判据取「形如凭据的串」而非仅具体值——避免下次换 token 时闸门失效。
{
  // 判据分两档：
  //  ① 带前缀的凭据串(github_pat_/ghp_/npm_)——形状自证，任何上下文都算泄露；
  //  ② 裸 32 位 hex——必须**同行出现凭据语境词**才算，否则会误伤一大片合法内容
  //    （实测误伤样本：ZCode 图片缓存文件名里的哈希、arXiv/DOI 编号片段、
  //     PKCS#8 DER 前缀常量 302e020100300506032b657004220420）。
  const strongPatterns = [
    /github_pat_[A-Za-z0-9_]{20,}/,          // 细粒度 PAT
    /ghp_[A-Za-z0-9]{30,}/,                   // 经典 PAT
    /npm_[A-Za-z0-9]{30,}/,                   // npm token
  ]
  const hexRe = /\b[a-f0-9]{32}\b/
  const credContext = /(gist|token|secret|passwd|password|credential|\bpat\b|authToken|GIST_ID|webhook)/i
  const credHits = []
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) { walk(p); continue }
      if (!/\.(md|js|mjs|json|yml|yaml|txt|html|py)$/.test(e.name)) continue
      let t = ''
      try { t = readFileSync(p, 'utf8') } catch (err) { continue }
      // 占位符写法(<token> / <PAT> / <gist-id>)一律放行——这正是期望的写法
      const cleaned = t.replace(/<[^>\n]{1,40}>/g, '')
      for (const re of strongPatterns) {
        const m = cleaned.match(re)
        if (m) credHits.push(path.relative(REL, p) + ' → ' + m[0].slice(0, 12) + '… (带前缀凭据)')
      }
      for (const line of cleaned.split(/\r?\n/)) {
        if (hexRe.test(line) && credContext.test(line)) {
          credHits.push(path.relative(REL, p) + ' → ' + line.trim().slice(0, 70) + ' (凭据语境中的 32 位 hex)')
        }
      }
    }
  }
  for (const d of ['lib', 'python', 'docs', '.github']) {
    const p = path.join(REL, d)
    if (existsSync(p)) walk(p)
  }
  if (credHits.length) {
    console.error('\n❌ 发布树内检出疑似凭据(凭据只允许存本地记忆文件，严禁随包发布):')
    for (const h of credHits) console.error('   · ' + h)
    console.error('   修法：把真实值改成占位符，真实值从 ~/.dsh/memory/workspaces/--D--dsh_debug--/MEMORY.md 读取。')
    process.exit(1)
  }
  console.log('[release] 凭据泄露闸门 ✓')
}

// ---------- 5.5 发布物完整性(#20):python/ 运行时必须在、bench 夹具必须排除 ----------
const pyDir = path.join(REL, 'python')
const pyMust = ['worker_v1.py', 'worker_semantic_v1.py', 'm7_activation_features_v2.py', 'm7_embedding_v1.py']
const pyMissing = pyMust.filter((f) => !existsSync(path.join(pyDir, f)))
if (pyMissing.length) { console.error('[release] ❌ python/ 运行时缺失: ' + pyMissing.join(', ')); process.exit(1) }
if (existsSync(path.join(pyDir, 'bench'))) { console.error('[release] ❌ python/bench(含 539MB 模型夹具)不得进入发布包 — 检查 package.json files 排除规则'); process.exit(1) }
if (!existsSync(path.join(REL, 'lib', 'client.js'))) { console.error('[release] ❌ lib/client.js 缺失'); process.exit(1) }
console.log('[release] python/ 运行时完整 ✓ bench 已排除 ✓')

// ---------- 6. 完成 ----------
console.log('\n✅ 构建输出目录:', REL, '(version ' + version + ')' + (dryRun ? ' [dry-run staging,未触碰真实发布基座]' : ''))
if (!dryRun) {
  console.log('下一步(需用户明确要求才会执行):')
  console.log('  cd ' + REL)
  console.log('  git add -A && git commit && git push && git tag && npm publish')
} else {
  console.log('dry-run 完成:仅生成 staging 并验证转换,未修改真实发布基座,未发布。')
}
