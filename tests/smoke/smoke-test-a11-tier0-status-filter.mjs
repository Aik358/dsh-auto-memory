/**
 * A11 / #431 · Tier-0 常驻目录的 I5 状态闸（2026-10-17）
 *
 * 缺陷：`lib/tier0-catalog.js` 的 `buildRecordPre` 曾把 `status` **硬编码为 'current'**，
 * 从不解析条目正文里的 `<!-- dsh-status: ... -->` 状态行。而写入侧（`memory_note` 的
 * supersedes/retract、`note-status-apply.js`）早已把状态落进正文 ⇒ 被 `superseded`/`retracted`
 * 的结论**换个位置**（Tier-0 目录）重新以 current 注入常驻预算。
 * 契约 §2.1「被 superseded/retracted 的**不出现在目录**」（`THREE-LAYER-CONTRACT.md:53`）
 * 与 I5 注入侧口径（`:183`，2026-09-19 R4-A 修正：检索侧「返回但标记」、**注入侧继续过滤**）。
 *
 * 本套件**不**断言源码里有没有某个字符串（CR-10）—— 全部走真 import + 真调用 + 断言返回值：
 *   [1] 正路径：retracted / superseded 单元不进 items，正文不进 catalog.text（修前必红）
 *   [2] 负路径①：无状态行 ⇒ 仍为 current（旧条目零影响，逐字段断言）
 *   [3] 负路径②：未知状态值 ⇒ fail closed 挡下（且状态写坏的行不被误当 current）
 *   [4] 负路径③：i5 / c5 的既有夹具形态（无状态行）必须仍全绿 —— 防过度收紧
 *   [5] 负路径④：statusDropped 计数 == 被挡单元数；与 droppedUnits 分开计
 *   [6] 负路径⑤：降级行文案含条数与状态枚举、**不含**被挡条目的正文/标题/id
 *   [7] 多点补充：最后一个状态行胜出（不因"历史上曾 superseded"就永久挡下）
 *   [8] 公共 API 向后兼容：extractTier0ItemsPre 的条目仍只有契约五字段、status 恒 current
 *   [9] 整源被挡 ⇒ skipped reason='status-filtered'（与 no-items 区分，可读文案存在）
 *  [10] IO 入口 buildTier0CatalogPre 透传同一份账（真文件）
 *
 * 变异验证（施工记录里报告两次数值）：
 *   把 `buildRecordPre` 里 `const st = unitStatusPre(lines)` 后直接 `if (false)`（等价于回到
 *   硬编码 current）⇒ [1][6] 必红；还原 ⇒ 全绿。
 *
 * 纯 Node、零依赖、不联网、不启宿主。
 */
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  buildTier0CatalogFromTextPre,
  buildTier0CatalogPre,
  extractTier0ItemsPre,
  renderCatalogLinePre,
} from '../../lib/tier0-catalog.js'
import {
  composeTieredInjectionPre,
  describeReasonPre,
} from '../../lib/tier-layer-inject.js'

let pass = 0, fail = 0
const ok = (cond, name) => { if (cond) { pass++; console.log('  ok   - ' + name) } else { fail++; console.error('  RED  - ' + name) } }
const eq = (got, want, name) => ok(JSON.stringify(got) === JSON.stringify(want),
  name + ' got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want))

const ID = (ch) => 'mem_' + ch.repeat(32)
const anchor = (ch) => '<!-- memory:' + ID(ch) + ' -->'
const statusLine = (body) => '<!-- dsh-status: ' + body + ' -->'

/** 三个哨兵：只出现在被挡/被放行条目的正文里，用来验"是否泄露"与"是否误挡"。 */
const CUR = '现行结论句_A11_CURRENT_SENTINEL'
const RET = '被撤回结论句_A11_RETRACTED_SENTINEL'
const SUP = '被取代结论句_A11_SUPERSEDED_SENTINEL'

const RET_TITLE = '被撤回条目'
const SUP_TITLE = '被取代条目'

/** 混状态来源：current / retracted / superseded 各一（状态行在单元**末尾**，与写入侧一致）。 */
const MIXED_TEXT = [
  anchor('a'), '## 2026-09-01 现行条目',
  '- ' + CUR + '：缓存改用 W-TinyLFU。补充句。',
  '',
  anchor('b'), '## 2026-09-02 ' + RET_TITLE,
  '- ' + RET + '：这条当时怎么想的。补充句。',
  statusLine('retracted reason="试过没用，别再来"'),
  '',
  anchor('c'), '## 2026-09-03 ' + SUP_TITLE,
  '- ' + SUP + '：旧结论。补充句。',
  statusLine('superseded by=' + ID('f')),
].join('\n')

const MIXED_SOURCES = [{ layer: 'project', text: MIXED_TEXT, path: 'D:\\ws\\.dsh-memory\\MEMORY.md' }]

// ─────────────────────────────────────────────────────────────
console.log('[A11-1] 正路径：非 current 单元不进目录，正文不进 catalog.text')
{
  const cat = buildTier0CatalogFromTextPre(MIXED_SOURCES, { maxTokens: 800 })
  const titles = cat.items.map((i) => i.title)
  const joined = JSON.stringify(cat.items)

  // 防空数组真空通过：现行那条必须真的在
  ok(cat.items.length >= 1, '现行单元确实进了目录（items=' + cat.items.length + '，防真空通过）')
  ok(joined.includes(CUR), '现行单元的正文进了目录（对照项）')
  ok(!joined.includes(RET), '★ retracted 单元不进 items（正文哨兵不在）')
  ok(!joined.includes(SUP), '★ superseded 单元不进 items（正文哨兵不在）')
  ok(!titles.includes(RET_TITLE), '★ retracted 单元标题不进 items')
  ok(!titles.includes(SUP_TITLE), '★ superseded 单元标题不进 items')

  ok(!cat.text.includes(RET), '★ retracted 正文不出现在 catalog.text')
  ok(!cat.text.includes(SUP), '★ superseded 正文不出现在 catalog.text')
  ok(!cat.text.includes(RET_TITLE), '★ retracted 标题不出现在 catalog.text')
  ok(cat.text.includes(CUR), '现行正文在 catalog.text（对照项，证明不是整段被吞）')
  ok(cat.text.split('\n').filter(Boolean).length === cat.items.length,
    '目录行数 == items 数（没有残留空行/半截行）')
  ok(cat.items.every((i) => i.status === 'current'), '目录条目 status 恒为 current（非 current 的根本不进）')
}

// ─────────────────────────────────────────────────────────────
console.log('[A11-2] 负路径①：无状态行 ⇒ 仍为 current（向后兼容，逐字段）')
{
  const plain = [
    anchor('d'), '## 2026-09-10 无状态条目',
    '- 无状态行的结论句_A11_PLAIN。补充句。',
  ].join('\n')
  const items = extractTier0ItemsPre(plain, 'project')
  eq(items.length, 1, '无状态行 ⇒ 1 条目录项')
  eq(items[0], {
    layer: 'project', status: 'current', date: '2026-09-10',
    title: '无状态条目', oneLine: '无状态行的结论句_A11_PLAIN',
  }, '★ 无状态行 ⇒ current（逐字段与修前相同）')

  const cat = buildTier0CatalogFromTextPre([{ layer: 'project', text: plain, path: 'MEMORY.md' }], {})
  eq(cat.statusDropped, 0, '无状态行 ⇒ statusDropped=0')
  eq(cat.statusDroppedItems, [], '无状态行 ⇒ statusDroppedItems 为空')
  eq(cat.skipped, [], '无状态行 ⇒ 无跳过')
  ok(!cat.text.includes('[降级]'), '无状态行 ⇒ 目录文本里不出现降级行（判据有鉴别力）')

  // 普通 HTML 注释 / 行内提到状态语法 ⇒ 都不是"主张了状态"
  const noisy = [
    anchor('e'), '## 2026-09-11 注释噪声条目',
    '- 普通注释 <!-- 这不是状态行 --> 之后的结论句_A11_NOISE。补充句。',
    '<!-- 另一个普通注释 -->',
  ].join('\n')
  const noisyItems = extractTier0ItemsPre(noisy, 'project')
  eq(noisyItems.length, 1, '普通 HTML 注释不被当成状态行')
  eq(noisyItems[0].status, 'current', '普通注释 ⇒ 仍 current（不误挡）')
}

// ─────────────────────────────────────────────────────────────
console.log('[A11-3] 负路径②：未知状态值 ⇒ fail closed（挡下，且不静默）')
{
  const bogus = [
    anchor('g'), '## 2026-09-12 状态写坏的条目',
    '- 状态写坏的结论句_A11_BOGUS。补充句。',
    statusLine('bogus'),
  ].join('\n')
  const cat = buildTier0CatalogFromTextPre([{ layer: 'user', text: bogus, path: 'USER.md' }], {})
  eq(cat.items, [], '未知状态值 ⇒ 单元被挡下（fail closed，不是放行来路不明的状态）')
  eq(cat.statusDropped, 1, '未知状态值 ⇒ 计入 statusDropped')
  eq(cat.statusDroppedItems, [{ layer: 'user', count: 1, statuses: ['unknown'] }],
    '账上登记为 unknown（不把未知值冒充 known）')
  ok(!cat.text.includes('状态写坏的结论句_A11_BOGUS'), '被挡正文不进 catalog.text')

  const res = composeTieredInjectionPre({ sources: [{ layer: 'user', text: bogus, path: 'USER.md' }], hits: [], question: '' })
  ok(res.text.includes('未知状态'), '降级行把未知状态写成人话（不静默）')
  ok(!res.text.includes('状态写坏的结论句_A11_BOGUS'), '降级行不泄露被挡正文')

  // 大小写变体同样 fail closed（`statusOfBodyPre` 不做宽容归一）
  const upper = [
    anchor('h'), '## 2026-09-13 大写状态条目',
    '- 大写状态的结论句_A11_UPPER。补充句。',
    statusLine('RETRACTED'),
  ].join('\n')
  const upCat = buildTier0CatalogFromTextPre([{ layer: 'user', text: upper, path: 'USER.md' }], {})
  eq(upCat.items, [], '★ 大写/变体状态值 ⇒ 同样挡下（未知值一律 fail closed）')
  ok(!upCat.text.includes('大写状态的结论句_A11_UPPER'), '大写变体的正文也不进 catalog.text')
}

// ─────────────────────────────────────────────────────────────
console.log('[A11-4] 负路径③：既有 i5 / c5 夹具形态（无状态行）必须仍全绿 —— 防过度收紧')
{
  // 逐字复刻 smoke-test-i5-status-filter.mjs:34 的夹具形态（它证的是 hits 侧，这里证目录侧不被牵连）：
  // i5 那边把 {user,project,log} 当**按 layer 的对象**传，这里按 sources 数组装（同语义）。
  const i5CatalogInput = [
    { layer: 'user', text: '- 用户偏好一\n- 用户偏好二', path: 'USER.md' },
    { layer: 'project', text: '- 项目结论一', path: 'MEMORY.md' },
    { layer: 'log', text: '- 今日做了一件事', path: '2026-09-14.md' },
  ]
  const cat = buildTier0CatalogFromTextPre(i5CatalogInput, { maxTokens: 800, quota: true })
  ok(cat.items.length >= 3, 'i5 夹具三源仍各出条目（items=' + cat.items.length + '）')
  ok(cat.items.every((i) => i.status === 'current'), 'i5 夹具条目全为 current')
  eq(cat.statusDropped, 0, '★ i5 夹具无状态行 ⇒ 一条都不挡（防过度收紧）')
  eq(cat.skipped, [], '★ i5 夹具无跳过')

  // c5 夹具形态：多行 project/whiteboard/user/log（无状态行）必须全部保留
  const c5 = [
    { layer: 'project', text: '## 2026-09-01\n- 项目条目编号0的结论句足够长用来占据预算。补充句。', path: 'MEMORY.md' },
    { layer: 'whiteboard', text: '# 白板全貌\n\n## 白板节0\n白板第0节的结论句足够长用来占住保底额度。', path: 'PLAN.md' },
    { layer: 'user', text: '## 2026-08-14\n【规则】用户级规则条目,结论句足够长用来占预算。', path: 'USER.md' },
    { layer: 'log', text: '- 08:00 日志条目0结论句足够长。', path: '2026-09-14.md' },
  ]
  const c5cat = buildTier0CatalogFromTextPre(c5, { maxTokens: 800, quota: true })
  eq(c5cat.statusDropped, 0, '★ c5 夹具（无状态行）一条都不挡')
  eq([...new Set(c5cat.items.map((i) => i.layer))].sort(), ['log', 'project', 'user', 'whiteboard'],
    '★ c5 夹具四层仍齐（未被状态闸误伤）')
}

// ─────────────────────────────────────────────────────────────
console.log('[A11-5] 负路径④：statusDropped 计数 == 被挡单元数；与 droppedUnits 分开计')
{
  const cat = buildTier0CatalogFromTextPre(MIXED_SOURCES, { maxTokens: 800 })
  eq(cat.statusDropped, 2, '混状态来源：被挡单元数 = 2（retracted + superseded）')
  eq(cat.units, 3, '单元总数 = 3')
  eq(cat.droppedUnits, 0, '★ 被状态挡下的单元**不计入** droppedUnits（两本账）')
  eq(cat.statusDroppedItems, [{ layer: 'project', count: 2, statuses: ['retracted', 'superseded'] }],
    '逐来源账：层名/条数/状态枚举（去重保序）')

  // 同层多单元：被挡 3 条时计数必须精确
  const many = []
  for (let i = 0; i < 3; i++) {
    many.push('## 2026-09-' + String(10 + i).padStart(2, '0') + ' 撤回段' + i,
      '- 撤回段' + i + '的正文句子足够长。补充句。', statusLine('retracted'))
  }
  const manyCat = buildTier0CatalogFromTextPre([{ layer: 'log', text: many.join('\n'), path: '2026-09-14.md' }], {})
  eq(manyCat.statusDropped, 3, '三条 retracted ⇒ statusDropped=3')
  eq((manyCat.statusDroppedItems.find((x) => x.layer === 'log') || { count: -1 }).count, 3,
    '逐来源计数同样为 3')

  // 与 really-empty 单元区分：空单元只算 droppedUnits
  // （用**纯日期标题 + 分隔线**造真空单元：标题被 isDateOnly 判掉、正文只剩分隔线 ⇒ 无标题无结论）
  const mixedEmpty = [
    '## 2026-09-20', '---', '',
    '## 2026-09-21 撤回段', '- 撤回段正文足够长。补充句。', statusLine('retracted'),
  ].join('\n')
  const meCat = buildTier0CatalogFromTextPre([{ layer: 'log', text: mixedEmpty, path: 'x.md' }], {})
  eq(meCat.statusDropped, 1, '混合：状态挡下 1 条')
  eq(meCat.droppedUnits, 1, '混合：无内容丢弃 1 条（两类分开计）')
}

// ─────────────────────────────────────────────────────────────
console.log('[A11-6] 负路径⑤：降级行含条数/状态/层名，不含被挡条目的正文/标题/id')
{
  const cat = buildTier0CatalogFromTextPre(MIXED_SOURCES, {})
  const res = composeTieredInjectionPre({ catalog: cat, hits: [], question: '' })
  const d = res.degradations.find((x) => x.code === 'tier0-status-filtered') || { text: '' }

  ok(res.degradations.some((x) => x.code === 'tier0-status-filtered'),
    '★ 降级项 code=tier0-status-filtered 存在（外部可观测，不静默）')
  ok(res.text.includes('[降级]'), '注入文本里有降级行')
  ok(res.text.includes('目录层已按 I5 挡下 2 条非 current 记忆'),
    '★ 降级行写明挡下条数（2）')
  ok(d.text.includes('retracted') && d.text.includes('superseded'),
    '★ 降级行写明状态枚举（retracted/superseded）')
  ok(d.text.includes('project 2 条'), '降级行写明涉及层与条数')
  ok(d.text.includes('审计视图仍可见'), '降级行说明"审计视图仍可见，不进常驻目录"（口径可读）')

  ok(!d.text.includes(RET) && !d.text.includes(SUP), '★ 降级行**不含**被挡条目正文')
  ok(!d.text.includes(RET_TITLE) && !d.text.includes(SUP_TITLE), '★ 降级行**不含**被挡条目标题')
  ok(!d.text.includes(ID('b')) && !d.text.includes(ID('c')), '★ 降级行**不含**被挡条目的锚点 id')
  ok(!res.text.includes(RET) && !res.text.includes(SUP), '整段注入文本都不含被挡正文')
  ok(res.degraded === true, 'degraded 标志为真（调用方可据此记账）')

  // 反面：没有非 current 条目时不得冒出该降级行（证明判据不是恒真噪声）
  const clean = buildTier0CatalogFromTextPre([{ layer: 'project', text: anchor('i') + '\n## 2026-09-22 现行\n- 现行结论句足够长。补充句。', path: 'MEMORY.md' }], {})
  const cleanRes = composeTieredInjectionPre({ catalog: clean, hits: [], question: '' })
  ok(!cleanRes.degradations.some((x) => x.code === 'tier0-status-filtered'), '反面：无非 current 时不出现该降级项')
  ok(!cleanRes.text.includes('目录层已按 I5 挡下'), '反面：注入文本也不出现该行')
}

// ─────────────────────────────────────────────────────────────
console.log('[A11-7] 最后一个状态行胜出（不因"历史上曾被 superseded"永久挡下）')
{
  const revive = [
    anchor('j'), '## 2026-09-23 复活条目',
    '- 复活条目_A11_REVIVE 的正文足够长。补充句。',
    statusLine('superseded by=' + ID('f')),
    '- 后来人工恢复了这个结论。补充句。',
    statusLine('current'),
  ].join('\n')
  const items = extractTier0ItemsPre(revive, 'project')
  eq(items.length, 1, '★ 末状态为 current ⇒ 单元重新进目录（口径同 note-status 的"最后一行胜出"）')
  eq(items[0].status, 'current', '条目的 status 为 current')

  const rev = buildTier0CatalogFromTextPre([{ layer: 'project', text: revive, path: 'MEMORY.md' }], {})
  eq(rev.statusDropped, 0, '末状态 current ⇒ 不计入 statusDropped')
  ok(rev.text.includes('复活条目_A11_REVIVE'), '正文进入目录（对照项）')
}

// ─────────────────────────────────────────────────────────────
console.log('[A11-8] 公共 API 向后兼容：条目仍只有契约五字段')
{
  const cat = buildTier0CatalogFromTextPre(MIXED_SOURCES, {})
  const keys = Object.keys(cat.items[0] || {}).sort()
  eq(keys, ['date', 'layer', 'oneLine', 'status', 'title'],
    '★ items[0] 的字段集 == 契约五字段（未新增泄漏字段）')
  ok(cat.items.every((i) => typeof i.title === 'string' && typeof i.oneLine === 'string'),
    '五字段类型不变')
  // renderCatalogLinePre 的输出仍逐字节同旧格式
  eq(renderCatalogLinePre({ layer: 'project', status: 'current', date: '2026-09-01', title: '甲', oneLine: '乙' }),
    '甲 · 乙 · project · current · 2026-09-01', '★ 渲染格式逐字节未变')
  ok(cat.text.split('\n').every((l) => !l.includes('dsh-status')), '目录文本里不残留状态行原文')
}

// ─────────────────────────────────────────────────────────────
console.log('[A11-9] 整源被挡 ⇒ skipped reason=status-filtered（与 no-items 区分）')
{
  const allStale = [
    anchor('k'), '## 2026-09-24 全撤回段',
    '- 全撤回段_A11_ALLSTALE 的正文足够长。补充句。',
    statusLine('retracted'),
  ].join('\n')
  const cat = buildTier0CatalogFromTextPre([{ layer: 'log', text: allStale, path: '2026-09-24.md' }], {})
  eq(cat.items, [], '整源被挡 ⇒ items 为空')
  eq(cat.skipped.map((s) => s.reason), ['status-filtered'], '★ skipped 原因是 status-filtered（不是 no-items）')
  eq(cat.statusDropped, 1, '同时保留 statusDropped=1')
  ok(/Tier-0 目录为空/.test(cat.text), '目录为空仍显式发声（I7）')

  const res = composeTieredInjectionPre({ catalog: cat, hits: [], question: '' })
  ok(res.text.includes('条目状态非 current'), '降级行把 status-filtered 渲染成人话：' + describeReasonPre('status-filtered'))
  ok(res.degradations.some((x) => x.code === 'tier0-status-filtered'), '整源被挡时同样有 tier0-status-filtered 账')

  // 对照：真的没有可渲染内容时仍是 no-items
  const emptyish = [{ layer: 'log', text: '---\n\n', path: 'x.md' }]
  const noItems = buildTier0CatalogFromTextPre(emptyish, {})
  eq(noItems.skipped.map((s) => s.reason), ['no-items'], '对照：无内容 ⇒ 仍是 no-items')
  eq(noItems.statusDropped, 0, '对照：无内容 ⇒ statusDropped=0')
}

// ─────────────────────────────────────────────────────────────
console.log('[A11-10] IO 入口：buildTier0CatalogPre 真读文件后同样挡下并透出账')
{
  const dir = mkdtempSync(path.join(tmpdir(), 'a11-tier0-status-'))
  try {
    const pNotes = path.join(dir, 'MEMORY.md')
    writeFileSync(pNotes, MIXED_TEXT, 'utf8')
    const out = buildTier0CatalogPre({ workspaceMemoryPath: pNotes }, { maxTokens: 800 })
    ok(out.items.length >= 1, 'IO：现行单元进目录')
    ok(!out.text.includes(RET) && !out.text.includes(SUP), '★ IO：被挡正文不进目录文本')
    eq(out.statusDropped, 2, '★ IO：statusDropped 透传到 IO 入口（2）')
    eq(out.statusDroppedItems, [{ layer: 'project', count: 2, statuses: ['retracted', 'superseded'] }],
      '★ IO：逐来源账同样透传')
    // 另三类路径未提供 ⇒ 按既有语义记 missing-path（这次修复不改变它）；关键是**没有** status-filtered 跳过
    ok(out.skipped.every((s) => s.reason === 'missing-path'), 'IO：未提供的三类来源仍是 missing-path（既有语义不变）')
    ok(!out.skipped.some((s) => s.reason === 'status-filtered'), 'IO：来源可读 ⇒ 不记 status-filtered 跳过')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

console.log('\n[a11-tier0-status-filter] pass=' + pass + ' fail=' + fail)
process.exit(fail ? 1 : 0)
