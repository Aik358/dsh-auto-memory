// 文档↔代码一致性守卫（doc↔code default-value guard）
// 运行：node tests/smoke/smoke-test-doc-code-consistency-pre.mjs（退出码 0 = 通过）
//
// 目的：让「**代码改了、文档没跟**」这种漂移机械可检、直接报红。
// 教训（2026-09-14，本仓刚发生）：`lib/index.js` 的 `l0IndexEnabled` 由 false 改为 true（用户裁定），
//   但测试断言与文档仍写 false → 两套验收各红一条且无人发现；同批还有 `tier0MaxTokens`
//   的「默认 400 vs 上限 B0=800」被误当成矛盾（实为**默认值与上限之别**）。
//
// 断言方式：
//   ① 代码侧：从 `lib/index.js` 的 `DEFAULT_CONFIG` 字面量解析默认值（不 import，避免副作用），
//      并从 `lib/tier-layer-inject.js` 的 `TIER_BUDGET_V1` 解析 `B0` / `B2`。
//   ② 文档侧：从 `SEMANTIC-ARCHITECTURE-SPEC.md`（**默认值的权威声明方**，§0.2 数值口径表）
//      与 `THREE-LAYER-CONTRACT.md`（接口/预算契约）解析**明确标注**的数值声明。
//   ③ 对照：任一字段「代码默认值 ≠ 文档声明值」→ 报红；某字段在 SPEC 里**找不到明确默认值** → 也报红。
//
// 文档侧可解析格式（约定；SPEC §0.2 表即按此写）—— 同一行内、**字段名在前、值在后**，名字与值之间只能是分隔符：
//   (a) 默认标注：`默认 **400**` / `默认 **0.25**` / `默认 **true**` / `默认开` / `默认关`
//   (b) 显式赋值：`= 2000` / `：2000` / `: true` / `为 2000`
//   以下**不构成声明**：值在字段名之前（如「硬上限 `B0` = 800」对 `tier0MaxTokens` 不构成声明）；
//   名字与值之间夹了别的词（如「`B2` 曾 2000 与 2400 并存」属历史说明）。
//
// 已知待同步（PENDING_SYNC）：**另一个写者**拥有的文件里的旧值。**当前为空**——2026-09-14 契约/图已同步完毕
//   （`injectBudgetChars` 4800 → 2000、`B2` 2000 → 2400），契约侧声明现为「全量 live 且一致、隔离数 0」。
//   机制保留：将来若再出现此类旧值，把条目加回数组即可——那些**不计失败**，但会显著打印 [待同步] 并给出应改成的值。
//   **除这些之外的一切不一致都报红**（新增的漂移不会被静默放行）。
import { readFileSync } from 'node:fs'

const ROOT = new URL('../../', import.meta.url)
const read = (p) => readFileSync(new URL(p, ROOT), 'utf8')

let pass = 0
let fail = 0
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ok - ' + name) }
  else { fail++; console.log('  FAIL - ' + name + (detail ? ' :: ' + detail : '')) }
}

const P = {
  code: 'lib/index.js',
  budget: 'lib/tier-layer-inject.js',
  spec: 'docs/internal/SEMANTIC-ARCHITECTURE-SPEC.md',
  contract: 'docs/internal/THREE-LAYER-CONTRACT.md',
}

// ───────────────────────── ① 代码侧：解析真值（不 import，避免副作用） ─────────────────────────
const src = {}
for (const k of Object.keys(P)) src[k] = read(P[k])

const parseScalar = (s) => {
  const t = String(s).trim().replace(/\*\*/g, '')
  if (t === 'true') return true
  if (t === 'false') return false
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t)
  return t // 表达式 / 引用 → 由断言判为不合格
}

/** 从某个 `const NAME = { ... }` 顶层字面量里取 `key: value`（取第一个列首 2 空格缩进的条目）。 */
const pickFromObjectLiteral = (blockText, key) => {
  if (!blockText) return undefined
  const re = new RegExp('(?:^|\\n) {2}' + key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*:\\s*([^,\\n]+?)\\s*,')
  const m = blockText.match(re)
  return m ? parseScalar(m[1]) : undefined
}

const cfgBlockM = src.code.match(/const DEFAULT_CONFIG = \{([\s\S]*?)\n\}/)
ok('代码侧：定位 lib/index.js 的 DEFAULT_CONFIG 字面量', !!cfgBlockM)
const cfgBlock = cfgBlockM ? cfgBlockM[1] : null

const budgetBlockM = src.budget.match(/TIER_BUDGET_V1\s*=\s*Object\.freeze\(\{([\s\S]*?)\n\}/)
ok('代码侧：定位 lib/tier-layer-inject.js 的 TIER_BUDGET_V1 字面量', !!budgetBlockM)
const budgetBlock = budgetBlockM ? budgetBlockM[1] : null

const codeDefault = (key) => pickFromObjectLiteral(cfgBlock, key)
const codeBudget = (key) => pickFromObjectLiteral(budgetBlock, key)

// ───────────────────────── ② 文档侧：解析「明确标注」的数值声明 ─────────────────────────
const NUMBOOL = '(?<![A-Za-z0-9_])(?:-?\\d+(?:\\.\\d+)?|true|false|开|关)(?![A-Za-z0-9_])'
const SEP = '(?:=|：|:|为)'
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const toValue = (raw) => {
  if (raw === 'true' || raw === '开') return true
  if (raw === 'false' || raw === '关') return false
  return Number(raw)
}

/** 本套件跟踪的全部字段名（用于判断「默认」后面的值到底属于哪个字段）。 */
const TRACKED_NAMES = [
  'l0IndexEnabled', 'tier0CatalogEnabled', 'injectBudgetChars', 'tier0MaxTokens', 'tier0BudgetShare', 'B0', 'B2',
]

/**
 * 在一段文本里解析字段 name 的数值声明。
 * @returns {{file:string,line:number,field:string,value:any,kind:'default'|'assign',text:string}[]}
 */
const claimsFor = (key, name, text, fileLabel) => {
  const out = []
  const lines = String(text).split(/\r?\n/)
  const nameRe = new RegExp('(?<![A-Za-z0-9_-])' + escapeRe(name) + '(?![A-Za-z0-9_-])')
  const assignRe = new RegExp(
    '(?<![A-Za-z0-9_-])' + escapeRe(name) + '`?\\s{0,3}' + SEP + '\\s{0,3}\\*{0,2}\\s{0,2}' + '(' + NUMBOOL + ')',
    'g',
  )
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!nameRe.test(line)) continue
    // (a) 默认标注：字段名必须出现在「默认」之前（否则该数值属于别的字段）
    const dIdx = line.indexOf('默认')
    if (dIdx >= 0) {
      const before = line.slice(0, dIdx)
      if (nameRe.test(before)) {
        const window = line.slice(dIdx, dIdx + 40)
        const mv = window.match(new RegExp(NUMBOOL))
        // 「默认」与数值之间若夹着**别的**被跟踪字段名 → 该值属于那个字段，不算本字段的声明
        const gap = mv ? window.slice(0, mv.index) : ''
        const otherFieldInGap = TRACKED_NAMES.some(
          (n) => n !== name && new RegExp('(?<![A-Za-z0-9_-])' + escapeRe(n) + '(?![A-Za-z0-9_-])').test(gap),
        )
        if (mv && !otherFieldInGap) {
          out.push({ file: fileLabel, line: i + 1, field: key, value: toValue(mv[0]), kind: 'default', text: line.trim() })
        }
      }
    }
    // (b) 显式赋值 `字段 = 值`
    assignRe.lastIndex = 0
    let m2
    while ((m2 = assignRe.exec(line)) !== null) {
      out.push({ file: fileLabel, line: i + 1, field: key, value: toValue(m2[1]), kind: 'assign', text: line.trim() })
    }
  }
  return out
}

const SPEC_LABEL = 'SEMANTIC-ARCHITECTURE-SPEC.md'
const CONTRACT_LABEL = 'THREE-LAYER-CONTRACT.md'
const specClaims = (key, name) => claimsFor(key, name, src.spec, SPEC_LABEL)
const contractClaims = (key, name) => claimsFor(key, name, src.contract, CONTRACT_LABEL)

// ───────────────────────── ③ 已知待同步（隔离机制保留；当前为空，见文件头） ─────────────────────────
const PENDING_SYNC = [
  // 旧条目示例（已同步，2026-09-14 移除）：
  //   { file: CONTRACT_LABEL, field: 'injectBudgetChars', stale: 4800, expect: 2000, owner: '契约/图由另一写者同步' },
  //   { file: CONTRACT_LABEL, field: 'B2', stale: 2000, expect: 2400, owner: '契约/图由另一写者同步' },
]
const pendingNotes = []
const isQuarantined = (c) => PENDING_SYNC.some((q) => q.file === c.file && q.field === c.field && q.stale === c.value)

// ───────────────────────── ④ 断言表 ─────────────────────────
const FIELDS = [
  { key: 'l0IndexEnabled', name: 'l0IndexEnabled', kind: 'bool', where: 'code', requireDefault: true },
  { key: 'tier0CatalogEnabled', name: 'tier0CatalogEnabled', kind: 'bool', where: 'code', requireDefault: true },
  { key: 'injectBudgetChars', name: 'injectBudgetChars', kind: 'number', where: 'code', requireDefault: true },
  { key: 'tier0MaxTokens', name: 'tier0MaxTokens', kind: 'number', where: 'code', requireDefault: true },
  { key: 'tier0BudgetShare', name: 'tier0BudgetShare', kind: 'number', where: 'code', requireDefault: true },
  // B0 / B2 是**上限**（不是默认值），所以不要求「默认」措辞，只要求文档写明该值且与代码一致
  { key: 'B0', name: 'B0', kind: 'number', where: 'budget', requireDefault: false },
  { key: 'B2', name: 'B2', kind: 'number', where: 'budget', requireDefault: false },
]

for (const f of FIELDS) {
  const cv = f.where === 'budget' ? codeBudget(f.key) : codeDefault(f.key)
  const typeOk = f.kind === 'bool' ? typeof cv === 'boolean' : typeof cv === 'number'
  ok('代码可解析 ' + f.key + ' = ' + JSON.stringify(cv), typeOk, '源码里未取到合法的 ' + f.kind + ' 字面量')

  const sc = specClaims(f.key, f.name)
  const dc = sc.filter((c) => c.kind === 'default')

  // 文档必须写明默认值（缺了也报红）；B0/B2 属上限，改判「文档必须写明该值」
  if (f.requireDefault) {
    ok('文档写明默认值 ' + f.key + '（SPEC 至少一条「默认 **X**」声明）', dc.length >= 1,
      'SPEC 里找不到 ' + f.key + ' 的「默认」标注 —— 请补进 §0.2 数值口径表（格式：`' + f.key + '` 默认 **值**）')
    if (dc.length >= 1 && typeOk) {
      const bad = dc.filter((c) => c.value !== cv)
      ok('默认值一致 ' + f.key + '（代码 ' + JSON.stringify(cv) + ' / 文档 ' +
        dc.map((c) => c.file + ':' + c.line + '=' + JSON.stringify(c.value)).join(', ') + '）',
        bad.length === 0,
        bad.length ? '文档过时：' + bad.map((c) => c.file + ':' + c.line + ' 写 ' + JSON.stringify(c.value)).join('；') : '')
    }
  } else {
    ok('文档写明该值 ' + f.key + '（SPEC 至少一条明确声明）', sc.length >= 1,
      'SPEC 里找不到 ' + f.key + ' 的明确数值声明 —— 请补进 §0.2 数值口径表（格式：`' + f.key + '` = 值）')
  }

  // 全量声明（含 `= 值` 形式）：除已知待同步外，任何不一致都是漂移 → 报红
  const all = sc.concat(contractClaims(f.key, f.name))
  const stale = all.filter(isQuarantined)
  for (const s of stale) {
    const q = PENDING_SYNC.find((x) => x.file === s.file && x.field === s.field && x.stale === s.value)
    pendingNotes.push('[待同步] ' + s.file + ':' + s.line + ' `' + s.field + '` 写 ' + JSON.stringify(s.value) +
      '，应改成 ' + JSON.stringify(q.expect) + '（' + q.owner + '）')
  }
  const live = all.filter((c) => !isQuarantined(c))
  const conflict = typeOk ? live.filter((c) => c.value !== cv) : []
  ok('无漂移声明 ' + f.key + '（检查 ' + live.length + ' 处声明，隔离 ' + stale.length + ' 处）',
    conflict.length === 0,
    conflict.length ? conflict.map((c) => c.file + ':' + c.line + ' 写 ' + JSON.stringify(c.value) + '（代码为 ' + JSON.stringify(cv) + '）').join('；') : '')
}

// 已同步的隔离项：同步完成后提示清理
for (const q of PENDING_SYNC) {
  const hit = contractClaims(q.field, q.field).filter((c) => c.value === q.expect)
  if (hit.length >= 1 && !contractClaims(q.field, q.field).some((c) => c.value === q.stale)) {
    console.log('  [已同步] ' + q.file + ' 的 `' + q.field + '` 已是 ' + JSON.stringify(q.expect) + ' —— 可从本文件的 PENDING_SYNC 移除')
  }
}

// ───────────────────────── ⑤ 口径专项断言（400 = 默认 / 800 = 上限；版本与分档） ─────────────────────────
const specLines = src.spec.split(/\r?\n/)
ok('tier0MaxTokens 口径写清（同一行含 默认/400/B0/800/上限）',
  specLines.some((l) => /tier0MaxTokens/.test(l) && /400/.test(l) && /B0/.test(l) && /800/.test(l) && /上限/.test(l)),
  'SPEC 必须写清「400 是默认值，B0=800 是硬上限」，否则下一个人还会把它当矛盾')
ok('tier0BudgetShare 默认值与代码一致（0.25，已由上表覆盖）', codeDefault('tier0BudgetShare') === 0.25,
  '代码 tier0BudgetShare = ' + JSON.stringify(codeDefault('tier0BudgetShare')))
ok('B2 统一到代码真值 2400（SPEC 明确「已统一」）',
  specLines.some((l) => /B2/.test(l) && /2400/.test(l)) && codeBudget('B2') === 2400,
  '代码 B2 = ' + JSON.stringify(codeBudget('B2')))

ok('SPEC 版本已升 v2（标题 + 变更记录 + 用户裁定依据）',
  /^# 语义架构规范 v2/m.test(src.spec) && /### 0\.1 变更记录/.test(src.spec) && /用户 2026-09-14 裁定/.test(src.spec))
ok('SPEC 明文承认 §7/S9 的「定调错误」', /定调错误/.test(src.spec) && /§7/.test(src.spec) && /S9/.test(src.spec))
ok('S9 已是分档四条（S9.1 兼容档 / S9.2 最优档三件套 / S9.3 共用接口 / S9.4 禁当目标形态）',
  /S9\.1（兼容档/.test(src.spec) && /S9\.2（最优档/.test(src.spec) && /S9\.3（两档共用/.test(src.spec) && /S9\.4（禁止把兼容档/.test(src.spec))
ok('§7 已是分档成本模型（两档各自的「谁付费」）',
  /### 7\.1/.test(src.spec) && /两档的成本对照/.test(src.spec) && /对最优档/.test(src.spec) && /对兼容档/.test(src.spec))
ok('S9.2 三件套写全（成本 + 门控 + 无 LLM 时的降级路径）',
  /成本/.test(src.spec) && /门控条件/.test(src.spec) && /无 LLM 时的降级路径/.test(src.spec))

// 「轻度用户」只允许出现在兼容档语境或历史说明里
const badLight = specLines.filter((l) => /轻度用户/.test(l) && !/(兼容档|旧|此前|v1)/.test(l))
ok('「轻度用户」仅出现在兼容档语境/历史说明（本仓口径自查，机械版 grep）', badLight.length === 0,
  badLight.map((l) => l.trim().slice(0, 80)).join(' | '))

// ───────────────────────── ⑥ 反向对照：证明本守卫真的能红（拿合成文本打靶） ─────────────────────────
{
  const synth = '| `tier0MaxTokens` | 默认 **12345** | lib/index.js:224 | 故意写错 |'
  const sc = claimsFor('tier0MaxTokens', 'tier0MaxTokens', synth, '<synthetic>')
  const got = sc.filter((c) => c.kind === 'default')
  ok('反向对照：文档里故意写错的值必须被解析出来（= 守卫能红）',
    got.length === 1 && got[0].value === 12345 && got[0].value !== codeDefault('tier0MaxTokens'),
    '解析结果 ' + JSON.stringify(sc.map((c) => c.value)))
  const okDoc = '| `tier0MaxTokens` | 默认 **400** | lib/index.js:224 | 正确 |'
  const good = claimsFor('tier0MaxTokens', 'tier0MaxTokens', okDoc, '<synthetic>').filter((c) => c.kind === 'default')
  ok('反向对照：正确的值解析后与代码一致（不误报）',
    good.length === 1 && good[0].value === codeDefault('tier0MaxTokens'))
  // 值在名字之前 → 不构成声明（否则「上限 B0 = 800」会被误读成 tier0MaxTokens 的声明）
  const rev = '| 硬上限 `B0` = 800 | `tier0MaxTokens` 取小生效 |'
  ok('反向对照：值在字段名之前不构成该字段的声明',
    claimsFor('tier0MaxTokens', 'tier0MaxTokens', rev, '<synthetic>').length === 0)
}

// ───────────────────────── ⑦ 文件卫生：前 3 字节不得是 BOM ─────────────────────────
for (const p of Object.values(P)) {
  const raw = readFileSync(new URL(p, ROOT))
  const isBom = raw.length >= 3 && raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf
  ok('无 BOM：' + p, !isBom, '前 3 字节 = ' + raw.slice(0, 3).toString('hex'))
}

if (pendingNotes.length > 0) {
  console.log('\n[待同步] 以下位置由**另一写者**拥有，本套件不计失败，但请同步后清理本文件的 PENDING_SYNC：')
  for (const n of pendingNotes) console.log('  - ' + n)
}
console.log('\n[doc-code-consistency-pre] pass=' + pass + ' fail=' + fail)
process.exit(fail === 0 ? 0 : 1)
