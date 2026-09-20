/**
 * 三层检索契约 C6 验收套件 —— `docs/internal/THREE-LAYER-CONTRACT.md` §7「验收判据」。
 *
 * 纪律（契约 §7.6 / S7.3）：**每条断言都必须能失败**——故意改坏实现就要报红。
 * 因此本套件：①先断言长度 ≥1 兜住「空数组上的真空通过」；②反向对照（改坏的那一份必须被挡下）；
 * ③覆盖接线可达性（源码级断言：删掉接线就红）。
 *
 * 覆盖 7 组：
 *   [G1] Tier-0 常驻且 ≤ B0=800 token，内容为「当前认知」而非原文转储（判据 1）
 *   [G2] L0 列表每条带 layer（五值）+ status（三值）（判据 2）
 *   [G3] 被 supersede 的记忆在**检索结果与注入两处**都不出现（判据 3；I5）
 *   [G4] 造一条命中 → expand 取回原文（判据 4，回归钉子）
 *   [G5] 故意破坏源文件 → 仍返回可用命中 + 明确降级标注（判据 5；I7 精神）
 *   [G6] C3 接线：开关 false 不写索引；true + 假 embedder 写出带 layer/status 的索引（判据 6）
 *   [G7] C7 回归：注入文本含 `Score: 0.xx (rank n/m)` 且块序降序（判据 7）
 *
 * 零 IO 优先：G1/G2/G3/G7 纯内存；G4/G5/G6 用 tmp 目录（跑完删除）。
 * 运行：node tests/smoke/smoke-test-three-layer-pre.mjs（退出码 0 = 通过）
 */
process.on('uncaughtException', (e) => { console.error('[THREE-LAYER] FATAL:', (e && (e.stack || e.message)) || e); process.exit(1) })
process.on('unhandledRejection', (r) => { console.error('[THREE-LAYER] REJ:', r); process.exit(1) })

import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, readdirSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir, homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseAnchors } from '../../lib/memory-anchor-pre.js'
import { INDEX_MAX_FILE_BYTES } from '../../lib/memory-index-pre.js'

const T0 = await import('../../lib/tier0-catalog-pre.js')
const L0 = await import('../../lib/l0-extract-pre.js')
const IDX = await import('../../lib/l0-index-pre.js')
const SYNC = await import('../../lib/l0-index-sync-pre.js')
const A = await import('../../lib/activation-inbox-pre.js')

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
const SRC_INDEX = readFileSync(path.join(ROOT, 'lib', 'index.js'), 'utf8')
const SRC_SYNC = readFileSync(path.join(ROOT, 'lib', 'l0-index-sync-pre.js'), 'utf8')
const SRC_SEMJS = readFileSync(path.join(ROOT, 'lib', 'semantic-js-pre.js'), 'utf8')

let pass = 0
let fail = 0
const ok = (name, cond) => { if (cond) { pass++; console.log('  ok - ' + name) } else { fail++; console.error('  FAIL - ' + name) } }
const eq = (name, a, b) => ok(name + (JSON.stringify(a) === JSON.stringify(b) ? '' : ' (got=' + JSON.stringify(a) + ' want=' + JSON.stringify(b) + ')'), JSON.stringify(a) === JSON.stringify(b))

/** 合法锚点 id：mem_ + 32 hex（sha256 截断，确定性）。 */
const memIdOf = (seed) => 'mem_' + createHash('sha256').update(String(seed)).digest('hex').slice(0, 32)
const anchorOf = (seed) => '<!-- memory:' + memIdOf(seed) + ' -->'

// ───────────────────────── 夹具 ─────────────────────────
/** 原文转储哨兵：只出现在「后续段落」，目录只该取首条结论行 → 泄露即红。 */
const RAW_MARK = '原始转储哨兵ZZZ'
const RAW_PARA = RAW_MARK + '。' + '这是原文正文细节,用于验证目录取结论行而不是原文转储。'.repeat(6)

const SRC_PROJECT = {
  layer: 'project', path: '~/.dsh/memory/workspaces/--D--ws--/MEMORY.md',
  text: [
    anchorOf('p1'), '## 检索口径已定拍板',
    '- 结论:会话检索采用「先就地修复,再给索引器加护栏」的两步口径,已拍板。',
    '- 原文:' + RAW_PARA, '',
    anchorOf('p2'), '## 三层契约施工',
    '- 结论:C1/C2/C4/C7 已完成,C3/C5/C6 待做。', '',
  ].join('\n'),
}
const SRC_USER = {
  layer: 'user', path: '~/.dsh/memory/MEMORY.md',
  text: [
    anchorOf('u1'), '## 用户硬性规则',
    '- 结论:写任何文件严禁引入 UTF-8 BOM,写完要校验前三字节。', '',
  ].join('\n'),
}
const SRC_LOG = {
  layer: 'log', path: '~/.dsh/memory/workspaces/--D--ws--/2026-09-14.md',
  text: [
    anchorOf('l1'), '## 2026-09-14（09:07）',
    '- 09:07 C3 模块层完成:索引条目显式落 layer/status 两列。',
    '- 原文:' + RAW_PARA, '',
    anchorOf('l2'), '## 2026-09-14（08:35）',
    '- 08:35 注入块 Score 行严格降序,C7 钉子通过。', '',
  ].join('\n'),
}
const SRC_REFLECT = {
  layer: 'reflection', path: '~/.dsh/memory/workspaces/--D--ws--/reflections/2026-09-13.md',
  text: [anchorOf('r1'), '## 成果回顾', '- 结论:待办总表已交付,含状态约定与一分钟看板。', ''].join('\n'),
}
const SRC_PLAN = {
  layer: 'whiteboard', path: '~/.dsh/memory/workspaces/--D--ws--/handoff/PLAN.md',
  text: [anchorOf('w1'), '## 当前阶段', '- 结论:A 线接口冻结(C3→C5→C6)在先,C 线算法改造在后。', ''].join('\n'),
}
const ALL_SOURCES = [SRC_PROJECT, SRC_USER, SRC_LOG, SRC_REFLECT, SRC_PLAN]

// ═════════════════ G1 Tier-0 常驻且 ≤ B0，且是「当前认知」 ═════════════════
console.log('\n[G1] Tier-0：常驻目录 ≤ B0=800 token，内容是结论行而非原文转储')
{
  ok('G1-B0 常量 = 800（契约 §4.3：B0=800 token）', T0.TIER0_DEFAULTS.maxTokens === 800)
  // token 口径 = max(ceil(chars/2), repo 口径 ceil(chars/4)+4)（契约 §4.6）
  const probe = '三层检索目录预算口径探针字符串'
  eq('G1-口径 conservative = max(ceil(n/2), ceil(n/4)+4)',
    T0.estimateTokensPre(probe), Math.max(Math.ceil(probe.length / 2), Math.ceil(probe.length / 4) + 4))
  eq('G1-口径 repo = ceil(n/4)+4（复算对照）',
    T0.estimateTokensPre(probe, { mode: 'repo' }), Math.ceil(probe.length / 4) + 4)
  ok('G1-保守口径恒 ≥ repo 口径（短文本的 +4 开销也盖住）',
    T0.estimateTokensPre('短') >= T0.estimateTokensPre('短', { mode: 'repo' }))

  const cat = T0.buildTier0CatalogFromTextPre(ALL_SOURCES, {})
  ok('G1-非空前置断言：五类来源产出 ≥5 条（防空数组真空通过）', Array.isArray(cat.items) && cat.items.length >= 5)
  ok('G1-I1：目录 token ≤ B0（conservative 口径 ' + cat.tokens + ' ≤ 800）', cat.tokens <= 800)
  ok('G1-I1：repo 口径也 ≤ B0（口径互查）', cat.tokenRepo <= 800)
  eq('G1-tokens 字段与实际文本口径一致', cat.tokens, T0.estimateTokensPre(cat.text, { mode: 'conservative' }))

  // 每行 = 标题 · 结论 · layer · status · 日期（契约 §2.1）
  const lines = cat.text.split('\n').filter(Boolean)
  eq('G1-每条目录项一行（无裁剪时行数=条数）', lines.length, cat.items.length)
  ok('G1-每行都带 layer+status（五值/三值内）',
    lines.every((l) => /·\s*(user|project|log|reflection|whiteboard)\s*·\s*(current|superseded|retracted)(\s*·|$)/.test(l)))
  ok('G1-每条 item 的 layer 合法', cat.items.every((it) => L0.L0_LAYERS.includes(it.layer)))
  ok('G1-每条 item 的 status 合法', cat.items.every((it) => L0.L0_STATUSES.includes(it.status)))

  // 内容为「当前认知」：结论行在、原文段落不在、且整体确实压缩了
  ok('G1-结论行确实进了目录（含拍板结论句）', cat.text.includes('两步口径'))
  ok('G1-原文转储不进目录（哨兵不在文本里）', !cat.text.includes(RAW_MARK))
  ok('G1-每条例句 ≤ oneLineChars=80', cat.items.every((it) => it.oneLine.length > 0 && it.oneLine.length <= 80))
  const rawTotal = ALL_SOURCES.reduce((s, x) => s + x.text.length, 0)
  ok('G1-压缩比：目录 < 原文 50%（实测 ' + cat.text.length + '/' + rawTotal + '）', cat.text.length < rawTotal * 0.5)

  // 超预算：仍然 ≤ B0，且**真的裁了**（证明断言不是真空通过）
  const bigUnits = []
  for (let i = 0; i < 160; i++) {
    bigUnits.push(anchorOf('big' + i) + '\n## 大目录单元' + i + '\n- 结论:' + '内容填充'.repeat(20))
  }
  const big = T0.buildTier0CatalogFromTextPre([{ layer: 'log', path: 'big.md', text: bigUnits.join('\n') }], {})
  ok('G1-超预算仍 ≤ B0（' + big.tokens + ' ≤ 800）', big.tokens <= 800)
  ok('G1-超预算确实发生裁剪 dropped ≥ 1（否则这条是真空通过）', big.dropped >= 1 && big.truncated === true)
  ok('G1-裁剪后条数 < 候选条数', big.items.length < big.candidates)
}

// ═════════════════ G2 L0 每条带 layer/status ═════════════════
console.log('\n[G2] L0 列表每条带 layer（五值）+ status（三值）')
{
  const cases = [
    ['~/.dsh/memory/MEMORY.md', 'user'],
    ['~/.dsh/memory/workspaces/--D--x--/MEMORY.md', 'project'],
    ['~/.dsh/memory/workspaces/--D--x--/2026-09-14.md', 'log'],
    ['~/.dsh/memory/workspaces/--D--x--/reflections/2026-09-13.md', 'reflection'],
    ['~/.dsh/memory/workspaces/--D--x--/handoff/PLAN.md', 'whiteboard'],
  ]
  const seen = new Set()
  const body = SRC_PROJECT.text
  for (const [p, want] of cases) {
    const items = L0.buildL0IndexPre(body, { layer: p })
    ok('G2-' + want + '：产出 ≥1 条（防空数组真空通过）', Array.isArray(items) && items.length >= 1)
    ok('G2-' + want + '：每条 layer 都等于路径判定层', items.every((it) => it.layer === want))
    ok('G2-' + want + '：每条 status 落在三值内', items.every((it) => L0.L0_STATUSES.includes(it.status)))
    ok('G2-' + want + '：每条 id 形如 mem_<32hex>', items.every((it) => /^mem_[0-9a-f]{32}$/.test(it.id)))
    ok('G2-' + want + '：每条通过 current 谓词', items.every((it) => L0.isCurrentPre(it) === true))
    for (const it of items) seen.add(it.layer)
  }
  eq('G2-五种层都被路径判定覆盖到', [...seen].sort(), ['log', 'project', 'reflection', 'user', 'whiteboard'])
  // 反向对照：判不出的层名不得被当成脏值放行，必须回退默认层
  const bogus = L0.buildL0IndexPre(body, { layer: 'not-a-layer' })
  ok('G2-非法 layer → 回退 L0_DEFAULT_LAYER=log（不放行脏层名）',
    bogus.length >= 1 && bogus.every((it) => it.layer === L0.L0_DEFAULT_LAYER))
}

// ═════════════════ G3 被 supersede 的记忆：检索侧「返回但标记」/注入侧继续过滤 ═════════════════
// ★R4-A 落地（2026-09-19）：本组按**用户最终裁定**重写。
//   原 I5（契约 :183）「两处都过滤」；用户两次修正后定稿：
//     ① 检索侧「**返回但标记**」（作废条目对 AI 是有用信息）
//     ② 「**retracted 也不过滤**……**并不是挡，我感觉是备注**」（做错的事最该被记住）
//   ⇒ 检索侧改为三态一律返回 + 标记；**注入侧维持过滤**（常驻 800 token 不装过时条目）。
console.log('\n[G3] superseded/retracted 检索侧返回但标记；注入侧继续过滤（I5 修正版）')
{
  // ① 谓词语义（含反向对照）
  ok('G3-isCurrentPre: status=current → 放行', L0.isCurrentPre({ status: 'current' }) === true)
  ok('G3-isCurrentPre: status 缺失 → 放行（旧记录向后兼容）', L0.isCurrentPre({}) === true && L0.isCurrentPre(undefined) === true)
  ok('G3-isCurrentPre: status=superseded → 挡下（注入侧继续过滤）', L0.isCurrentPre({ status: 'superseded' }) === false)
  ok('G3-isCurrentPre: status=retracted → 挡下（注入侧继续过滤）', L0.isCurrentPre({ status: 'retracted' }) === false)
  ok('G3-isCurrentPre: 未知 status → 不放行（fail closed）', L0.isCurrentPre({ status: 'bogus' }) === false)

  // ★R4-A：检索侧准入谓词 —— 已知三态**一律放行**，只对未知值 fail-closed
  ok('G3-isRetrievablePre: current → 放行', L0.isRetrievablePre({ status: 'current' }) === true)
  ok('G3-isRetrievablePre: superseded → 放行（返回但标记）', L0.isRetrievablePre({ status: 'superseded' }) === true)
  ok('G3-isRetrievablePre: retracted → 放行（★它是教训，不是垃圾）', L0.isRetrievablePre({ status: 'retracted' }) === true)
  ok('G3-isRetrievablePre: 未知 status → 挡下（fail closed，防新增枚举静默放行）', L0.isRetrievablePre({ status: 'bogus' }) === false)

  // ② 检索侧：真实语料 → 标一条 superseded → 它必须**仍在结果里**，且带标记
  const raw = L0.buildL0IndexPre(SRC_LOG.text, { layer: SRC_LOG.path })
  ok('G3-检索侧前置：抽取到 ≥2 条', raw.length >= 2)
  const corpus = raw.map((it, i) => ({ id: it.id, l0: it.l0, layer: it.layer, status: i === 0 ? 'superseded' : 'current' }))
  const marked = corpus[0].id
  const kept = corpus.filter((c) => L0.isRetrievablePre(c))
  eq('G3-检索结果：被 supersede 的那条**仍在结果里**（返回但标记）', kept.some((c) => c.id === marked), true)
  eq('G3-检索结果：全部条目都返回（三态不剔除）', kept.length, corpus.length)
  ok('G3-标记：superseded 条目带 ⚠已作废', L0.supersededMarkPre({ status: 'superseded' }).includes(L0.L0_SUPERSEDED_MARK_PRE_V1))
  ok('G3-标记：retracted 条目带 ⚠已撤回', L0.supersededMarkPre({ status: 'retracted' }).includes(L0.L0_RETRACTED_MARK_PRE_V1))
  ok('G3-标记：current 条目无标记（逐字节向后兼容）', L0.supersededMarkPre({ status: 'current' }) === '' && L0.supersededMarkPre({}) === '')
  // 接线可达性：检索路径确实用这个谓词（删掉即红）
  ok('G3-接线：检索路径用 isRetrievablePre 准入（index.js l0 语料构建）',
    /if \(!retrievableL0\(it\)\) continue/.test(SRC_INDEX))
  ok('G3-接线：检索路径从 l0-extract-pre 取入 isRetrievablePre',
    /isRetrievablePre: retrievableL0/.test(SRC_INDEX))
  // 反向锁：旧谓词**不得**再出现在检索侧准入位置
  ok('G3-反向锁：检索侧不再用 isCurrentPre 作准入（注入侧才有）',
    !/if \(!isCurrentPre\(it\)\) continue/.test(SRC_INDEX))

  // ③ 注入侧：注入块由**过滤后**的集合构建 → 被 supersede 的那条不得出现在注入文本里
  const mkCand = (c, tag) => ({
    candidateId: 'cand_' + c.id.slice(4, 10), memoryId: c.id, anchorId: 'memory:' + c.id,
    scope: 'Workspace', sourceRef: 'workspace:2026-09-14.md', sourceEpoch: 'ep-1', sourceVersion: 2,
    fileDigest: 'e'.repeat(64), recordDigest: 'd'.repeat(63) + tag, score: tag === 'a' ? 0.91 : 0.62,
    excerpt: '参考正文 ' + tag,
  })
  // ③ 注入侧：★R4-A 之后**两处判据不同** —— 检索侧放行、注入侧继续过滤。
  //    故这里显式用注入侧谓词 isCurrentPre 过滤后再喂注入包（模拟注入侧真实行为）。
  const forInject = corpus.filter((c) => L0.isCurrentPre(c))
  eq('G3-注入侧前置：过滤后只剩 current 条（superseded 已剔除）', forInject.length, corpus.length - 1)
  const injected = A.buildReferenceTailPacketPre({
    request: {
      schemaVersion: 1, namespace: A.NAMESPACE, kind: 'activation_request',
      activationId: A.ACTIVATION_ID_PREFIX + 'ab'.repeat(16),
      observationId: 'obs_pre_' + 'cd'.repeat(16),
      workerEpoch: 'worker-e1', sessionId: 'sess-9', agentId: 'agent-9', workspaceKey: 'd:/ws',
      scope: 'Workspace', contextVersion: 7, memoryIndexVersion: 'idx_pre_' + 'ab'.repeat(16),
      threshold: { policyVersion: 'thr_v1', score: 0.91, threshold: 0.8, reason: 'fv2 lane=explicit emit intent=0.91 dense=0.88 margin=0.21 explicit_lane' },
      level: 'excerpt', ttlSteps: 2, createdAt: 1700000000000, expiresAt: 1700000000120000,
      candidates: forInject.map((c, i) => mkCand(c, i === 0 ? 'a' : 'b')),
    },
    triggerReason: 'explicit recall', nowStep: 100,
  })
  ok('G3-注入侧前置：注入包构建成功且含 ≥1 条', injected.ok === true && /Reference:/.test(injected.rendered))
  ok('G3-注入内容：被 supersede 的 id 不出现（注入侧仍过滤）', !injected.rendered.includes(marked))
  ok('G3-注入内容：current 兄弟条的 id 出现（证明注入通道本身可用）',
    forInject.some((c) => injected.rendered.includes(c.id)))
  ok('G3-两处判据分工明确：检索侧放行 superseded、注入侧挡下它',
    L0.isRetrievablePre({ status: 'superseded' }) === true && L0.isCurrentPre({ status: 'superseded' }) === false)
}

// ═════════════════ G4 expand 取回原文（回归钉子） ═════════════════
console.log('\n[G4] 命中后按 id 下探：expand 取回原文（契约 §7.4 回归钉子）')
{
  const PAD = '关于发布流程与令牌选择的详细踩坑记录,包含上下文与结论,填充到约三百字符的正文内容。'
  const mkBody = (tag) => Array.from({ length: 8 }, (_, k) => '- 行' + k + ':' + PAD + tag + '#' + k).join('\n')
  const records = [
    { id: memIdOf('x1'), body: '## 检索口径已定拍板\n' + mkBody('r1') },
    { id: memIdOf('x2'), body: '## 水位测量边界对齐\n' + mkBody('r2') },
    { id: memIdOf('x3'), body: '## 融合层排序权重\n' + mkBody('r3') },
  ]
  const tmp = mkdtempSync(path.join(tmpdir(), 'three-layer-g4-'))
  const projDir = path.join(tmp, 'logs')
  mkdirSync(projDir)
  const logFile = path.join(projDir, '2026-09-14.md')
  writeFileSync(logFile, records.map((r) => '<!-- memory:' + r.id + ' -->\n' + r.body).join('\n'), 'utf8')

  const src = extractFn(SRC_INDEX, 'async expandMemoryRecordPre(id, agent) {')
  const arrow = 'async ' + src.slice(src.indexOf('('), src.indexOf(') {') + 1) + ' => ' + src.slice(src.indexOf(') {') + 2)
  const factory = new Function('readFile', 'parseAnchors', 'INDEX_MAX_FILE_BYTES', 'path', 'homedir', 'return { expandMemoryRecordPre: ' + arrow + ' };')
  const fake = {
    resolvePaths: async () => ({ projectDir: projDir, reflectDir: path.join(tmp, 'reflections'), userFile: path.join(tmp, 'user.md'), notesPath: path.join(tmp, 'notes.md'), ws: tmp }),
    listDailyLogs: async () => [{ name: '2026-09-14.md' }],
    listReflections: async () => [],
    state: { logPath: logFile, notesPath: path.join(tmp, 'notes.md'), userText: '', notesText: '', logText: '', paths: {} },
  }
  const obj = factory.call(fake, readFile, parseAnchors, INDEX_MAX_FILE_BYTES, path, homedir)
  const expand = (id) => obj.expandMemoryRecordPre.call(fake, id, undefined)

  const target = records[1]
  const out = await expand(target.id)
  ok('G4-展开头带 id', out.startsWith('[记忆展开] ' + target.id))
  ok('G4-展开头带来源文件（可溯源）', out.includes('2026-09-14.md'))
  ok('G4-展开头带 digest 凭据', out.includes('digest '))
  ok('G4-正文含目标记录首行', out.includes(target.body.split('\n')[0]))
  ok('G4-正文含目标记录末行（字节区间完整，未截断）', out.includes(target.body.split('\n').pop()))
  ok('G4-不串条：相邻记录内容不出现',
    !out.includes(records[0].body.split('\n')[0]) && !out.includes(records[2].body.split('\n')[0]))
  ok('G4-展开体不含锚点标记本身', !out.includes('<!-- memory:'))
  const bad = await expand('not-an-id')
  ok('G4-非法 id → 结构化提示（不抛异常）', bad.startsWith('memory_recall_pre: expand 需要合法记忆 id'))
  const miss = await expand(memIdOf('nope'))
  ok('G4-未找到 id → 结构化回报并列出搜索范围', miss.startsWith('[记忆展开] 未找到') && miss.includes('已搜索'))
  rmSync(tmp, { recursive: true, force: true })
}

// ═════════════════ G5 破坏源文件 → 仍可用 + 显式降级 ═════════════════
console.log('\n[G5] 故意破坏源文件：检索仍返回可用命中 + 明确降级标注（不静默）')
{
  const tmp = mkdtempSync(path.join(tmpdir(), 'three-layer-g5-'))
  const goodPath = path.join(tmp, 'MEMORY.md')
  writeFileSync(goodPath, SRC_PROJECT.text, 'utf8')
  const dirAsFile = path.join(tmp, 'a-directory.md')
  mkdirSync(dirAsFile)

  eq('G5-缺失文件 → reason=not-found', T0.readTextSafePre(path.join(tmp, 'missing.md')).reason, 'not-found')
  eq('G5-路径是目录 → reason=not-a-file', T0.readTextSafePre(dirAsFile).reason, 'not-a-file')
  eq('G5-空路径 → reason=missing-path', T0.readTextSafePre('').reason, 'missing-path')
  const emptyFile = path.join(tmp, 'empty.md')
  writeFileSync(emptyFile, '   \n', 'utf8')
  eq('G5-空文件 → reason=empty', T0.readTextSafePre(emptyFile).reason, 'empty')

  // 部分破坏：好来源照常出目录项（= 检索仍返回命中），坏来源被跳过并计数
  const cat = T0.buildTier0CatalogPre({ workspaceMemoryPath: goodPath, userMemoryPath: path.join(tmp, 'missing.md'), todayLogPath: dirAsFile })
  ok('G5-部分破坏：仍然产出 ≥1 条目录项（不是整条失败）', cat.items.length >= 1)
  ok('G5-部分破坏：好来源的结论行确实在文本里', cat.text.includes('两步口径'))
  ok('G5-部分破坏：坏来源逐条登记在 skipped（reason 明确）', cat.skipped.length >= 2 && cat.skipped.every((s) => !!s.reason))

  // 全部破坏：必须**显式发声**，不许静默给空串（I7 精神）
  const dead = T0.buildTier0CatalogPre({ workspaceMemoryPath: dirAsFile, userMemoryPath: path.join(tmp, 'missing.md') })
  eq('G5-全部破坏：无目录项', dead.items.length, 0)
  ok('G5-全部破坏：text 非空且含明确降级标注（不是静默空串）', dead.text.length > 0 && dead.text.includes('跳过来源'))
  ok('G5-全部破坏：标注里的来源计数 = 实际跳过数', dead.text.includes(String(dead.skipped.length)))
  ok('G5-全部破坏：不抛异常（走到这里即证明）', true)
  rmSync(tmp, { recursive: true, force: true })
}

// ═════════════════ G6 C3 接线：开关 + 假 embedder → 写出带 layer/status 的索引 ═════════════════
console.log('\n[G6] C3 接线：开关默认开（设 false 才不写索引、零 IO）；开启 + 假 embedder → 写出索引且条目带 layer/status')
{
  // —— 源码级接线守卫（删掉接线即红）——
  ok('G6-配置项存在且默认 true（默认开，用户 2026-09-14 裁定）', /l0IndexEnabled: true/.test(SRC_INDEX))
  ok('G6-宿主 import 了新接线模块', /import \{ createL0IndexSyncPre \} from '\.\/l0-index-sync-pre\.js'/.test(SRC_INDEX))
  ok('G6-宿主开关门：config.l0IndexEnabled !== true 即短路', /engine\.config\.l0IndexEnabled !== true/.test(SRC_INDEX))
  ok('G6-触发点是「工作区语料刷新完成」（refreshAll 内调用 tick）', /engine\.l0IndexSyncTick\(agent\)/.test(SRC_INDEX))
  ok('G6-异步不阻塞：sync 结果不 await 在刷新链上', /void engine\.syncL0IndexPre\(\{ agent \}\)\.catch\(\(\) => \{\}\)/.test(SRC_INDEX))
  ok('G6-嵌入通道 = 端侧 JS 引擎（不是 LLM/网络）', /embedPassages: \(texts\) => engine\._jsSemantic\.embedPassages\(texts\)/.test(SRC_INDEX))
  ok('G6-引擎确实暴露 embedPassages（C3 前置能力）', /async embedPassages\(texts\) \{[\s\S]{0,200}ensureTier\(\)/.test(SRC_SEMJS))
  ok('G6-零引用的 l0-index-pre 现在被接线模块引用', /from '\.\/l0-index-pre\.js'/.test(SRC_SYNC) && /idx\.update\(/.test(SRC_SYNC))
  ok('G6-层必须显式传入（不传 → 全落默认 log 的老坑已在注释与调用两侧写死）',
    /r = await idx\.update\(\{ path: filePath, text, layer,/.test(SRC_SYNC))
  ok('G6-S9：接线模块自身零网络零模型（无 fetch/无 subagent/无 llm）', !/\bfetch\(|subagent|llm\.|runSubagent/i.test(SRC_SYNC))

  // —— 行为级：假 embedder + 真 IO（tmp 目录）——
  const embedLog = []
  const fakeEmbed = (t) => {
    const s = String(t || '')
    const v = new Float32Array(4)
    for (let i = 0; i < s.length; i++) v[i % 4] += (s.charCodeAt(i) % 97) / 97
    const n = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2] + v[3] * v[3]) || 1
    for (let i = 0; i < 4; i++) v[i] = v[i] / n
    return v
  }
  const io = {
    readJson(p) {
      let raw
      try { raw = readFileSync(p, 'utf8') } catch (_) { return null }
      return JSON.parse(raw)
    },
    writeJson(p, obj) { mkdirSync(path.dirname(p), { recursive: true }); writeFileSync(p, JSON.stringify(obj), 'utf8') },
  }
  const embedder = { embedPassages: async (texts) => { embedLog.push(texts.length); return texts.map(fakeEmbed) } }
  const readText = async (f) => { try { return readFileSync(f, 'utf8') } catch (_) { return '' } }

  ok('G6-文件名形如 l0-index-<短哈希>-<layer>.json',
    /^l0-index-[0-9a-f]{12}-project\.json$/.test(SYNC.l0IndexFileNamePre('d:/ws', 'project')))
  ok('G6-同 key 同名（确定性）',
    SYNC.l0IndexFileNamePre('d:/ws', 'log') === SYNC.l0IndexFileNamePre('d:/ws', 'log'))
  ok('G6-不同 key 不同名', SYNC.l0IndexFileNamePre('d:/ws', 'log') !== SYNC.l0IndexFileNamePre('e:/other', 'log'))

  const tmp = mkdtempSync(path.join(tmpdir(), 'three-layer-g6-'))
  const offDir = path.join(tmp, 'off')
  const sync = SYNC.createL0IndexSyncPre({ io, embedder, readText })
  const off = await sync.sync({ enabled: false, workspaceKey: 'd:/ws', dir: offDir, sources: ALL_SOURCES })
  ok('G6-开关 false → ok:false reason=disabled', off.ok === false && off.reason === 'disabled')
  ok('G6-开关 false → 不写索引文件（目录都没建）', off.written === 0 && !existsSync(offDir))
  ok('G6-开关 false → 零嵌入（embedder 一次都没调）', embedLog.length === 0)

  const onDir = path.join(tmp, 'l0')
  const on = await sync.sync({ enabled: true, workspaceKey: 'd:/ws', dir: onDir, sources: ALL_SOURCES })
  ok('G6-开关 true → ok:true 且逐层写盘（files=' + (on.files || []).length + '）', on.ok === true && on.files.length === 5 && on.written === 5)
  ok('G6-写出后文件真实存在', on.files.every((f) => existsSync(f.path)))
  ok('G6-条数 > 0（每条来源都落了条目）', on.files.every((f) => f.count >= 1) && on.count >= 5)
  ok('G6-嵌入被真正调用过（不是空跑）', embedLog.length >= 1 && embedLog.every((n) => n >= 1))

  // 索引条目必须带 layer + status，且**层归属与该文件对应的层一致**（C3 的核心）
  let layerOk = true
  let statusOk = true
  let verOk = true
  let noRawOk = true
  let loadedCount = 0
  for (const f of on.files) {
    const loaded = IDX.createL0IndexPre({ io, embedder }).load({ path: f.path })
    if (!loaded.ok || loaded.entries.length < 1) { layerOk = false; continue }
    loadedCount += loaded.entries.length
    for (const e of loaded.entries) {
      if (e.layer !== f.layer) layerOk = false
      if (!L0.L0_STATUSES.includes(e.status)) statusOk = false
    }
    if (loaded.l0IndexVersion !== IDX.computeL0IndexVersionPre(loaded.entries)) verOk = false
    if (readFileSync(f.path, 'utf8').includes(RAW_MARK)) noRawOk = false
  }
  ok('G6-索引可被 l0-index-pre 读回（load.ok 且条目 ≥1）', layerOk && loadedCount >= 5)
  ok('G6-条目的 layer == 该文件所属层（五层归属正确，不落默认 log）', layerOk)
  ok('G6-条目的 status 落在三值内', statusOk)
  ok('G6-索引身份 = computeL0IndexVersionPre(entries)', verOk)
  ok('G6-索引不含记忆原文（只存 L0 摘要）', noRawOk)

  // 增量：同输入再跑 → 全 skipped、版本不变（S1.3 精神）
  const on2 = await sync.sync({ enabled: true, workspaceKey: 'd:/ws', dir: onDir, sources: ALL_SOURCES })
  ok('G6-幂等：第二次全部 skipped', on2.ok === true && on2.files.every((f) => f.skipped === f.count && f.recomputed === 0))
  ok('G6-幂等：版本不变（同内容同身份）',
    on2.files.every((f) => on.files.find((g) => g.layer === f.layer).l0IndexVersion === f.l0IndexVersion))

  // fail-soft：嵌入通道坏掉 → 不抛、不写盘、只回报错误
  const badDir = path.join(tmp, 'bad')
  const badSync = SYNC.createL0IndexSyncPre({ io, embedder: { embedPassages: async () => { throw new Error('model gone') } }, readText })
  let threw = false
  let bad
  try { bad = await badSync.sync({ enabled: true, workspaceKey: 'd:/ws', dir: badDir, sources: ALL_SOURCES }) } catch (e) { threw = true }
  ok('G6-fail-soft：嵌入抛错不向上抛', threw === false)
  ok('G6-fail-soft：回报 ok:false 且逐层记 error', bad && bad.ok === false && bad.files.length >= 1 && bad.files.every((f) => f.ok === false && !!f.error))
  ok('G6-fail-soft：失败不写盘（无残留索引文件）', !existsSync(badDir) || readdirByPrefix(badDir, 'l0-index-').length === 0)

  // 空来源 / 非法来源
  const noSrc = await sync.sync({ enabled: true, workspaceKey: 'd:/ws', dir: path.join(tmp, 'none'), sources: [] })
  ok('G6-无来源 → reason=no-sources（不建目录）', noSrc.ok === false && noSrc.reason === 'no-sources')
  const badSrc = await sync.sync({ enabled: true, workspaceKey: 'd:/ws', dir: path.join(tmp, 'none2'), sources: [{ layer: 'bogus', path: 'x.md' }, { layer: 'log', path: '' }] })
  ok('G6-非法来源被丢弃并计数', badSrc.ok === false && badSrc.droppedSources >= 2)
  rmSync(tmp, { recursive: true, force: true })
}

// ═════════════════ G7 C7 回归：注入可见 0-1 分值与降序 ═════════════════
console.log('\n[G7] C7 回归：注入块含 `Score: 0.xx (rank n/m)` 且块序严格降序')
{
  const memA = memIdOf('c7a'); const memB = memIdOf('c7b'); const memC = memIdOf('c7c')
  const mkCand = (mid, score, tag) => ({
    candidateId: 'cand_' + mid.slice(4, 10), memoryId: mid, anchorId: 'memory:' + mid,
    scope: 'Workspace', sourceRef: 'workspace:MEMORY.md', sourceEpoch: 'ep-1', sourceVersion: 2,
    fileDigest: 'e'.repeat(64), recordDigest: 'd'.repeat(63) + tag, score, excerpt: '参考正文 ' + tag,
  })
  const mkReq = (cands) => ({
    schemaVersion: 1, namespace: A.NAMESPACE, kind: 'activation_request',
    activationId: A.ACTIVATION_ID_PREFIX + 'ab'.repeat(16), observationId: 'obs_pre_' + 'cd'.repeat(16),
    workerEpoch: 'worker-e1', sessionId: 'sess-9', agentId: 'agent-9', workspaceKey: 'd:/ws',
    scope: 'Workspace', contextVersion: 7, memoryIndexVersion: 'idx_pre_' + 'ab'.repeat(16),
    threshold: { policyVersion: 'thr_v1', score: 0.91, threshold: 0.8, reason: 'fv2 lane=explicit emit intent=0.91 dense=0.88 margin=0.21 explicit_lane' },
    level: 'excerpt', candidates: cands, ttlSteps: 2, createdAt: 1700000000000, expiresAt: 1700000000120000,
  })
  // 乱序输入：必须被重排为降序（入参恰好有序的测试是真空通过）
  const shuffled = A.buildReferenceTailPacketPre({
    request: mkReq([mkCand(memC, 0.54, 'c'), mkCand(memA, 0.91, 'a'), mkCand(memB, 0.72, 'b')]),
    triggerReason: 'explicit recall', nowStep: 100,
  })
  ok('G7-注入包构建成功', shuffled.ok === true)
  const text = shuffled.rendered
  ok('G7-含 `Score: 0.91 (rank 1/3)`（注入里看得见 0-1 分值）', /(^|\n)Score: 0\.91 \(rank 1\/3\)\n/.test(text))
  ok('G7-含 `Score: 0.72 (rank 2/3)`', /(^|\n)Score: 0\.72 \(rank 2\/3\)\n/.test(text))
  ok('G7-含 `Score: 0.54 (rank 3/3)`', /(^|\n)Score: 0\.54 \(rank 3\/3\)\n/.test(text))
  const parsed = [...text.matchAll(/\nScore: ([0-9.]+) \(rank (\d+)\/(\d+)\)/g)].map((m) => ({ s: Number(m[1]), r: Number(m[2]), t: Number(m[3]) }))
  eq('G7-每条引用恰好一个 Score 行', parsed.length, 3)
  eq('G7-分值按文档顺序严格降序', parsed.map((x) => x.s), [0.91, 0.72, 0.54])
  eq('G7-rank 从 1 递增、分母=批内条数', [parsed.map((x) => x.r), parsed.map((x) => x.t)], [[1, 2, 3], [3, 3, 3]])
  const block = text.split(A.TAIL_MARKER_LINE_PRE_V1)[1].split('\n').filter(Boolean)
  eq('G7-块内四行顺序 = Source/Reason/Score/Reference', block.map((l) => l.split(':')[0]), ['Source', 'Reason', 'Score', 'Reference'])
  const spent = Buffer.byteLength(text, 'utf8')
  eq('G7-Score 行字节计入预算（budgetBytes=实际渲染字节）', shuffled.packet.budgetBytes, spent)
  const tight = A.buildReferenceTailPacketPre({ request: mkReq([mkCand(memA, 0.91, 'a'), mkCand(memB, 0.72, 'b'), mkCand(memC, 0.54, 'c')]), triggerReason: 'x', nowStep: 100, budgetBytes: spent - 1 })
  ok('G7-预算少 1 字节 → 至少丢一条（证明分值行真花了预算）', tight.droppedByBudget && tight.droppedByBudget.length >= 1)
}

// ───────────────────────── 收尾 ─────────────────────────
console.log('\n[three-layer-pre] pass=' + pass + ' fail=' + fail)
process.exit(fail ? 1 : 0)

// ───────────────────────── 工具 ─────────────────────────
/** 从源文件里按签名抽取一个方法体（含大括号配对）——与 smoke-test-p4 同款。 */
function extractFn(src, header) {
  const start = src.indexOf(header)
  if (start < 0) throw new Error('not found: ' + header)
  let depth = 0
  let end = -1
  for (let i = start + header.length - 1; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') { depth--; if (depth === 0) { end = i; break } }
  }
  if (end < 0) throw new Error('unbalanced: ' + header)
  return src.slice(start, end + 1)
}

function readdirByPrefix(dir, prefix) {
  try { return readdirSync(dir).filter((f) => f.startsWith(prefix)) } catch (_) { return [] }
}
