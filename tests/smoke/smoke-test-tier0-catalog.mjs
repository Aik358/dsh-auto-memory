/**
 * smoke-test-tier0-catalog-pre —— Tier-0 目录生成器（tier0_catalog_pre_v1，契约 C4）回归锁定。
 * 纯 Node、零依赖、不联网；临时文件写在 os.tmpdir() 下并在结束时清理。
 * 覆盖：四类 layer 归属 / 一行渲染格式 / 首句剥离（列表标记·时间·序号·强调）/ 标题取最深标题行 /
 *       预算不超（保守与 repo 两种 token 口径同时验）/ 超预算按优先级裁剪 / 同层日期倒序 /
 *       缺文件·空文件·目录·乱格式不抛错 / BOM 容错 / 空目录显式发声 / 确定性。
 */
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  TIER0_CATALOG_VERSION, TIER0_DEFAULTS,
  estimateTokensPre, findDatePre, splitTier0UnitsPre, extractTier0ItemsPre,
  renderCatalogLinePre, buildTier0CatalogFromTextPre, buildTier0CatalogPre, readTextSafePre,
} from '../../lib/tier0-catalog.js'

let pass = 0, fail = 0
const t = (name, fn) => { try { fn(); pass++; console.log('  ok -', name) } catch (e) { fail++; console.error('FAIL', name + ':', e.message) } }
const anchor = (c) => `<!-- memory:mem_${c.repeat(32)} -->`

// ---------- 固定夹具 ----------
const NOTES_TEXT = [
  anchor('c'), '', '## 2026-09-13', '### 交付甲（07:41）', '- **甲结论句一**。甲结论句二。',
].join('\n')
const USER_TEXT = [anchor('a'), '## 2026-08-14', '【规则标签】乙结论句一。乙结论句二。'].join('\n')
const PLAN_TEXT = [
  '# 白板标题（2026-09-14 重写）', '', '## 丙节', '丙结论句一。丙结论句二。', '',
  '## 丁节', '丁结论句一很长足够十五个字以上。丁结论句二。',
].join('\n')
const LOG_TEXT = [
  '- 07:41 戊结论句一。戊结论句二。', '- 07:42 己结论句一很长的句子用于超过十五个字。己结论句二。',
].join('\n')
const LOG_PATH = '2026-09-15.md'

const P_SMALL = [anchor('d'), '## 2026-09-13', '### 甲项目', '- 甲句一。'].join('\n')
const W_SMALL = ['# 白板', '', '## 乙白板', '乙句一。'].join('\n')
const U_SMALL = [anchor('e'), '## 2026-08-14', '【丙标签】丙句一。'].join('\n')
const L_SMALL = '- 07:41 丁句一。'

const TEXT_SOURCES = [
  { layer: 'project', text: NOTES_TEXT, path: 'MEMORY.md' },
  { layer: 'user', text: USER_TEXT, path: 'MEMORY.md' },
  { layer: 'log', text: LOG_TEXT, path: LOG_PATH },
  { layer: 'whiteboard', text: PLAN_TEXT, path: 'PLAN.md' },
]
const SMALL_SOURCES = [
  { layer: 'project', text: P_SMALL, path: 'MEMORY.md' },
  { layer: 'whiteboard', text: W_SMALL, path: 'PLAN.md' },
  { layer: 'user', text: U_SMALL, path: 'MEMORY.md' },
  { layer: 'log', text: L_SMALL, path: LOG_PATH },
]

/** 40 段 dated 事件段：用于撑爆预算（日期升序，最新在末尾）。 */
function hugeLogText(n = 40) {
  const out = []
  for (let i = 0; i < n; i++) {
    const date = i < 28
      ? `2026-08-${String(i + 1).padStart(2, '0')}`
      : `2026-09-${String(i - 27).padStart(2, '0')}`
    out.push(`## ${date} 事件段`, `- 08:${String(i % 60).padStart(2, '0')} 事件编号${i}的正文句子较长用于占据预算。补充句。`, '')
  }
  return out.join('\n')
}

// ---------- 1 版本与估算 ----------
t('version', () => assert.equal(TIER0_CATALOG_VERSION, 'tier0_catalog_pre_v1'))
t('defaults: maxTokens=800', () => assert.equal(TIER0_DEFAULTS.maxTokens, 800))
t('estimateTokensPre: 保守口径优先＝max(ceil(chars/2), repo 口径)', () => {
  assert.equal(estimateTokensPre(''), 0)
  assert.equal(estimateTokensPre('abcdefgh'), 6) // max(4, ceil(8/4)+4=6)，短文本由框定开销主导
  assert.equal(estimateTokensPre('中'.repeat(40)), 20) // 长文本由 chars/2 主导
})
t('estimateTokensPre: repo 口径＝仓库既有公式 ceil(chars/4)+4', () => {
  assert.equal(estimateTokensPre('abcdefgh', { mode: 'repo' }), 6)
  assert.equal(estimateTokensPre('中文字符甲', { mode: 'repo' }), 6)
})
t('estimateTokensPre: 保守口径恒 ≥ repo 口径（预算门不会更松）', () => {
  for (const s of ['', 'a', '中文一行', NOTES_TEXT, PLAN_TEXT, hugeLogText(3)]) {
    assert.ok(estimateTokensPre(s) >= estimateTokensPre(s, { mode: 'repo' }), 'sample=' + JSON.stringify(s.slice(0, 12)))
  }
})
t('findDatePre: 合法日期归一化 / 非法跳过 / 无则空串', () => {
  assert.equal(findDatePre('见（2026-9-4）与 2026-10-04'), '2026-09-04')
  assert.equal(findDatePre('2026-13-40 非法'), '')
  assert.equal(findDatePre('没有日期'), '')
})

// ---------- 2 切分与抽取 ----------
t('split: 锚点 → 一块一条；标题 → 浅标题切；条目 → 顶层 - 切', () => {
  assert.equal(splitTier0UnitsPre(NOTES_TEXT).groups.length, 1)
  assert.equal(splitTier0UnitsPre(PLAN_TEXT).groups.length, 3)
  assert.equal(splitTier0UnitsPre(LOG_TEXT).groups.length, 2)
})
t('project：最深标题作 title，剥（HH:MM）尾巴；首句并接；日期取标题行', () => {
  const items = extractTier0ItemsPre(NOTES_TEXT, 'project')
  assert.equal(items.length, 1)
  assert.deepEqual(items[0], {
    layer: 'project', status: 'current', date: '2026-09-13', title: '交付甲', oneLine: '甲结论句一。甲结论句二',
  })
})
t('user：无有效标题时取首行【标签】作 title', () => {
  const items = extractTier0ItemsPre(USER_TEXT, 'user')
  assert.deepEqual(items[0], {
    layer: 'user', status: 'current', date: '2026-08-14', title: '规则标签', oneLine: '乙结论句一。乙结论句二',
  })
})
t('log：无标题 title 为空；日期回退到文件名日期', () => {
  const items = extractTier0ItemsPre(LOG_TEXT, 'log', { path: LOG_PATH })
  assert.equal(items.length, 2)
  assert.deepEqual(items[0], { layer: 'log', status: 'current', date: '2026-09-15', title: '', oneLine: '戊结论句一。戊结论句二' })
  assert.equal(items[1].oneLine, '己结论句一很长的句子用于超过十五个字')
})
t('whiteboard：文档标题独立成条，节标题成条，日期回退文件头', () => {
  const items = extractTier0ItemsPre(PLAN_TEXT, 'whiteboard', { path: 'PLAN.md' })
  assert.deepEqual(items.map((i) => i.title), ['白板标题（2026-09-14 重写）', '丙节', '丁节'])
  assert.ok(items.every((i) => i.layer === 'whiteboard' && i.status === 'current' && i.date === '2026-09-14'))
  assert.equal(items[1].oneLine, '丙结论句一。丙结论句二')
})
t('title 剥纯日期标题（## 2026-08-14 不作标题）', () => {
  const items = extractTier0ItemsPre('## 2026-08-14\n- 只有正文的条目，没有别的标题行。', 'user')
  assert.equal(items[0].title, '')
  assert.match(items[0].oneLine, /只有正文的条目/)
})
t('oneLine：剥序号 / 时间 / 强调标记，且 ≤80 字（截断带省略号）', () => {
  const long = '长'.repeat(120)
  const items = extractTier0ItemsPre(`## 标题\n- ① 08:23 **${long}**`, 'user')
  assert.equal(items[0].oneLine.length, 80)
  assert.ok(items[0].oneLine.endsWith('…'))
  assert.ok(!items[0].oneLine.includes('①') && !items[0].oneLine.includes('08:23') && !items[0].oneLine.includes('**'))
})
t('extract: 非法 layer 返回空数组不抛错；空/乱格式文本不抛错', () => {
  assert.deepEqual(extractTier0ItemsPre(NOTES_TEXT, 'nope'), [])
  assert.deepEqual(extractTier0ItemsPre('', 'log'), [])
  assert.deepEqual(extractTier0ItemsPre(null, 'log'), [])
  assert.deepEqual(extractTier0ItemsPre('---\n\n###\n\u0000\u0000', 'log'), [])
})

// ---------- 3 渲染 ----------
t('render：标题 · 一句结论 · layer · status · 日期', () => {
  assert.equal(
    renderCatalogLinePre({ layer: 'project', status: 'current', date: '2026-09-13', title: '甲', oneLine: '乙' }),
    '甲 · 乙 · project · current · 2026-09-13',
  )
})
t('render：title 与 oneLine 相同不重复；缺日期不留尾分隔符', () => {
  assert.equal(renderCatalogLinePre({ layer: 'log', status: 'current', date: '', title: '甲', oneLine: '甲' }), '甲 · log · current')
  assert.equal(renderCatalogLinePre({ layer: 'user', status: 'current', date: '2026-08-14', title: '', oneLine: '丙' }), '丙 · user · current · 2026-08-14')
})

// ---------- 4 四类来源 + 预算 + 裁剪 ----------
t('四类来源：layer 正确、优先级顺序 project>whiteboard>user>log', () => {
  const res = buildTier0CatalogFromTextPre(TEXT_SOURCES, { maxTokens: 4000 })
  assert.deepEqual([...new Set(res.items.map((i) => i.layer))], ['project', 'whiteboard', 'user', 'log'])
  assert.deepEqual(res.items[0], {
    layer: 'project', status: 'current', date: '2026-09-13', title: '交付甲', oneLine: '甲结论句一。甲结论句二',
  })
  assert.equal(res.items.length, res.text.split('\n').length)
  assert.equal(res.dropped, 0)
  assert.equal(res.truncated, false)
})
t('预算：text 同时 ≤ maxTokens（保守口径与 repo 口径）', () => {
  const res = buildTier0CatalogFromTextPre(TEXT_SOURCES, { maxTokens: 200 })
  assert.ok(res.tokens <= res.maxTokens, `tokens=${res.tokens} max=${res.maxTokens}`)
  assert.ok(res.tokenRepo <= res.maxTokens, `tokenRepo=${res.tokenRepo} max=${res.maxTokens}`)
  assert.equal(res.estimateMode, 'conservative')
  assert.equal(estimateTokensPre(res.text, { mode: 'repo' }), res.tokenRepo)
})
t('裁剪优先级：预算只够 project 时，user/log/whiteboard 被裁掉并计数', () => {
  const res = buildTier0CatalogFromTextPre(SMALL_SOURCES, { maxTokens: 25 })
  assert.ok(res.items.length > 0, '至少保留 1 条')
  assert.ok(res.items.every((i) => i.layer === 'project'), 'items=' + JSON.stringify(res.items))
  assert.ok(res.dropped >= 3, 'dropped=' + res.dropped)
  assert.equal(res.truncated, true)
  assert.ok(res.tokens <= res.maxTokens && res.tokenRepo <= res.maxTokens)
})
t('裁剪优先级：预算放宽后先补 whiteboard，仍不带 user/log', () => {
  const res = buildTier0CatalogFromTextPre(SMALL_SOURCES, { maxTokens: 60 })
  const layers = new Set(res.items.map((i) => i.layer))
  assert.ok(layers.has('project') && layers.has('whiteboard'), 'layers=' + [...layers])
  assert.ok(!layers.has('user') && !layers.has('log'), 'layers=' + [...layers])
  assert.ok(res.tokenRepo <= res.maxTokens)
})
t('同层按日期倒序：最新日志条目优先保留', () => {
  const res = buildTier0CatalogFromTextPre([{ layer: 'log', text: hugeLogText(40), path: '2026-09-12.md' }], { maxTokens: 200 })
  const dates = res.items.map((i) => i.date)
  assert.ok(res.dropped > 0, 'dropped=' + res.dropped)
  assert.ok(dates.includes('2026-09-12'), '最新日期应保留：' + dates.join(','))
  assert.ok(!dates.includes('2026-08-01'), '最旧日期应被裁：' + dates.join(','))
  for (let i = 1; i < dates.length; i++) assert.ok(dates[i - 1] >= dates[i], '日期应递减：' + dates.join(','))
  assert.ok(res.tokens <= res.maxTokens && res.tokenRepo <= res.maxTokens)
})
t('超大来源：默认 800 预算下裁剪但不丢高优先级来源', () => {
  const res = buildTier0CatalogFromTextPre(
    TEXT_SOURCES.concat([{ layer: 'log', text: hugeLogText(40), path: '2026-09-12.md' }]),
    {},
  )
  assert.equal(res.truncated, true)
  assert.ok(res.dropped > 0, 'dropped=' + res.dropped)
  assert.ok(res.tokens <= 800, 'tokens=' + res.tokens)
  assert.ok(res.tokenRepo <= 800, 'tokenRepo=' + res.tokenRepo)
  assert.deepEqual([...new Set(res.items.map((i) => i.layer))], ['project', 'whiteboard', 'user', 'log'])
  assert.equal(res.items.length, res.text.split('\n').length)
})
t('markTruncation 默认关（text 不含裁剪标记）；开启也不破预算', () => {
  const off = buildTier0CatalogFromTextPre(SMALL_SOURCES, { maxTokens: 25 })
  assert.ok(!off.text.includes('已裁剪'))
  const on = buildTier0CatalogFromTextPre(SMALL_SOURCES, { maxTokens: 25, markTruncation: true })
  assert.ok(on.tokens <= on.maxTokens && on.tokenRepo <= on.maxTokens)
})
t('空来源：不抛错、items 空、text 显式发声（I7 精神）；无实质内容记 no-items', () => {
  const res = buildTier0CatalogFromTextPre([], {})
  assert.deepEqual(res.items, [])
  assert.match(res.text, /Tier-0 目录为空/)
  const blank = buildTier0CatalogFromTextPre([{ layer: 'log', text: '   \n\n', path: 'x.md' }], {})
  assert.deepEqual(blank.skipped.map((s) => s.reason), ['empty'])
  const noise = buildTier0CatalogFromTextPre([{ layer: 'log', text: '---\n\n', path: 'x.md' }], {})
  assert.deepEqual(noise.skipped.map((s) => s.reason), ['no-items'])
  assert.equal(noise.units, 1)
  assert.equal(noise.droppedUnits, 1)
  assert.match(noise.text, /Tier-0 目录为空/)
})
t('确定性：同输入两次全等', () => {
  assert.deepEqual(buildTier0CatalogFromTextPre(TEXT_SOURCES, {}), buildTier0CatalogFromTextPre(TEXT_SOURCES, {}))
})

// ---------- 5 IO 路径（临时文件；缺失/空/目录/乱格式/BOM 全容错） ----------
const dir = mkdtempSync(path.join(tmpdir(), 'tier0-catalog-'))
try {
  const pNotes = path.join(dir, 'MEMORY.md')
  const pUser = path.join(dir, 'USER.md')
  const pLog = path.join(dir, '2026-09-15.md')
  const pPlan = path.join(dir, 'PLAN.md')
  const pHuge = path.join(dir, '2026-09-12.md')
  const pEmpty = path.join(dir, 'empty.md')
  const pMessy = path.join(dir, 'messy.md')
  const pBom = path.join(dir, 'bom.md')
  const pDir = path.join(dir, 'adir')
  writeFileSync(pNotes, NOTES_TEXT, 'utf8')
  writeFileSync(pUser, USER_TEXT, 'utf8')
  writeFileSync(pLog, LOG_TEXT, 'utf8')
  writeFileSync(pPlan, PLAN_TEXT, 'utf8')
  writeFileSync(pHuge, hugeLogText(40), 'utf8')
  writeFileSync(pEmpty, '   \n\n', 'utf8')
  writeFileSync(pMessy, '\u0000\u0000{["json": 不是 JSON###\n---\n', 'utf8')
  writeFileSync(pBom, '\uFEFF' + USER_TEXT, 'utf8')
  mkdirSync(pDir)

  const input = {
    userMemoryPath: pUser, workspaceMemoryPath: pNotes, todayLogPath: pLog, handoffPlanPath: pPlan,
  }

  t('IO：四类来源文件 → layer 正确、无跳过、预算内', () => {
    const res = buildTier0CatalogPre(input)
    assert.deepEqual([...new Set(res.items.map((i) => i.layer))], ['project', 'whiteboard', 'user', 'log'])
    assert.deepEqual(res.items[0], {
      layer: 'project', status: 'current', date: '2026-09-13', title: '交付甲', oneLine: '甲结论句一。甲结论句二',
    })
    assert.deepEqual(res.skipped, [])
    assert.ok(res.tokens <= res.maxTokens && res.tokenRepo <= res.maxTokens)
    assert.match(res.text, / · project · current · 2026-09-13/)
    assert.equal(res.items.length, res.text.split('\n').length)
  })
  t('IO：全部路径缺失 → 不抛错、计数 4 条、显式空标记', () => {
    const res = buildTier0CatalogPre({})
    assert.deepEqual(res.items, [])
    assert.deepEqual(res.skipped.map((s) => s.reason), ['missing-path', 'missing-path', 'missing-path', 'missing-path'])
    assert.match(res.text, /Tier-0 目录为空 · 跳过来源 4/)
  })
  t('IO：路径不存在 → not-found 计数，不抛错', () => {
    const res = buildTier0CatalogPre({
      userMemoryPath: path.join(dir, 'nope-user.md'), workspaceMemoryPath: path.join(dir, 'nope-notes.md'),
      todayLogPath: path.join(dir, 'nope-log.md'), handoffPlanPath: path.join(dir, 'nope-plan.md'),
    })
    assert.equal(res.skipped.length, 4)
    assert.ok(res.skipped.every((s) => s.reason === 'not-found'), JSON.stringify(res.skipped))
    assert.deepEqual(res.items, [])
  })
  t('IO：空文件 / 目录 / 乱格式 → 各自 reason，不抛错', () => {
    assert.equal(readTextSafePre('').reason, 'missing-path')
    assert.equal(readTextSafePre(pEmpty).reason, 'empty')
    assert.equal(readTextSafePre(pDir).reason, 'not-a-file')
    assert.equal(readTextSafePre(pNotes, { maxFileBytes: 8 }).reason, 'too-large')
    const messy = buildTier0CatalogPre({ todayLogPath: pMessy })
    assert.equal(typeof messy.text, 'string')
    assert.ok(Array.isArray(messy.items))
    const res = buildTier0CatalogPre({
      userMemoryPath: pEmpty, workspaceMemoryPath: pDir, todayLogPath: pMessy, handoffPlanPath: path.join(dir, 'nope.md'),
    })
    assert.deepEqual(res.skipped.map((s) => s.reason), ['not-a-file', 'empty', 'not-found'])
  })
  t('IO：BOM 文件被剥离，输出无 U+FEFF', () => {
    const res = buildTier0CatalogPre({ userMemoryPath: pBom })
    assert.ok(!res.text.includes('\uFEFF'))
    assert.equal(res.items.length, 1)
    assert.equal(res.items[0].layer, 'user')
    assert.equal(res.items[0].title, '规则标签')
  })
  t('IO：超大来源 + 默认预算 → 超预算裁剪、优先级保留、双口径达标', () => {
    const res = buildTier0CatalogPre(Object.assign({}, input, { todayLogPath: pHuge }))
    assert.equal(res.truncated, true)
    assert.ok(res.dropped > 0, 'dropped=' + res.dropped)
    assert.ok(res.tokens <= 800 && res.tokenRepo <= 800, `tokens=${res.tokens} repo=${res.tokenRepo}`)
    assert.deepEqual([...new Set(res.items.map((i) => i.layer))], ['project', 'whiteboard', 'user', 'log'])
    assert.equal(res.items.filter((i) => i.layer === 'project').length, 1)
  })
  t('IO：extraPaths 显式 layer 生效；非法 layer 记 unknown-layer', () => {
    const res = buildTier0CatalogPre({ extraPaths: [{ path: pNotes, layer: 'reflection' }, { path: pLog, layer: 'nope' }] })
    assert.deepEqual([...new Set(res.items.map((i) => i.layer))], ['reflection'])
    assert.ok(res.skipped.some((s) => s.reason === 'unknown-layer'), JSON.stringify(res.skipped))
  })
  t('IO：确定性（同输入两次全等）', () => {
    assert.deepEqual(buildTier0CatalogPre(input), buildTier0CatalogPre(input))
  })
} finally {
  rmSync(dir, { recursive: true, force: true })
}

// ---------- 汇总 ----------
console.log(`[tier0-catalog-pre] pass=${pass} fail=${fail}`)
if (fail) process.exit(1)
