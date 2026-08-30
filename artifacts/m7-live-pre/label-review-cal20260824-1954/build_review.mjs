// Merge review overlay onto scored labels, validate everything, and emit
// existing-labels-reviewed.jsonl / validation-report.json /
// label-distribution.json / boundary-review.md / gold-import-template.jsonl /
// provenance-manifest.json for label-review-cal20260824-1954.
import { readFileSync, writeFileSync } from 'node:fs'

const DIR = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]):/, '$1:')
const CAL = 'D:/dsh-auto-memory/artifacts/m7-live-pre/calibration-cal20260824-1855/'
const load = (p) => readFileSync(p, 'utf8').trim().split('\n').map((l) => JSON.parse(l))

const scored = load(CAL + 'labels.scored.jsonl')
const original = Object.fromEntries(load(CAL + 'labels.jsonl').map((r) => [r.sampleId, r]))
const overlay = Object.fromEntries(load(DIR + 'review-overlay.jsonl').map((r) => [r.sampleId, r]))
const episodes = load('D:/dsh-auto-memory/artifacts/m7-corpus-pre/episodes.jsonl')
const epSet = new Set(episodes.map((e) => e.episodeId))
const derived = JSON.parse(readFileSync('C:/Users/JH Z/.dsh/memory/semantic-pre/derived-corpus.json', 'utf8'))
const liveRecs = []
for (const entry of Array.isArray(derived.entries) ? derived.entries : Object.values(derived.entries))
  for (const r of entry.records) liveRecs.push(r)
const liveSet = new Set(liveRecs.map((r) => r.memoryId))
const liveGist = Object.fromEntries(liveRecs.map((r) => [r.memoryId,
  String(r.text || '').replace(/\s+/g, ' ').slice(0, 48)]))
const epGist = Object.fromEntries(episodes.map((e) => [e.episodeId,
  String(e.text || '').replace(/\s+/g, ' ').slice(0, 48)]))

// ---- merge ----
const reviewed = scored.map((s) => {
  const o = overlay[s.sampleId]
  if (!o) throw new Error('missing overlay for ' + s.sampleId)
  const exp = o.proposedExpectedMemoryIds ?? [...original[s.sampleId].expectedEpisodeIds
    .map((x) => x.startsWith('live:') ? null : x).filter(Boolean),
    ...resolvedLive(original[s.sampleId])]
  const forb = o.proposedForbiddenMemoryIds ?? [
    ...original[s.sampleId].forbiddenEpisodeIds.filter((x) => !x.startsWith('live:')),
    ...original[s.sampleId].forbiddenMemoryIds.filter((x) => !x.startsWith('live:')),
    ...resolvedLiveForbidden(original[s.sampleId]),
  ]
  const { harmfulNote, ambiguityFlag, scopeCaveat, agreement, rationale,
          proposedAction: _pa, proposedExpectedMemoryIds: _pe,
          proposedForbiddenMemoryIds: _pf, ...rest } = o
  return {
    sampleId: s.sampleId,
    surface: s.surface,
    queryText: original[s.sampleId].queryText,
    language: original[s.sampleId].language,
    previousAction: s.expectedAction,
    proposedAction: o.proposedAction,
    proposedExpectedMemoryIds: exp,
    proposedForbiddenMemoryIds: forb,
    harmful: o.harmful,
    recallIntent: o.recallIntent,
    dialogueAct: o.dialogueAct,
    echoRisk: o.echoRisk,
    taskNeed: o.taskNeed,
    scopeStatus: o.scopeStatus,
    freshnessStatus: o.freshnessStatus,
    observed: { score: s._score, denseTop: s._denseTop, hitAt: s._hitAt,
                decisionAtCurrentThresholds: s._decisionCurrent,
                scopeOnlyCheck: s._scopeOnly },
    confidence: o.confidence,
    rationale: o.rationale,
    harmfulNote: harmfulNote || null,
    disagreementWithPreviousLabel: o.agreement === 'revised',
    ambiguityFlag: ambiguityFlag || false,
    scopeCaveat: scopeCaveat || null,
    labelSource: 'strong-agent',
    isGold: false,
    ...rest,
  }
})
function resolvedLive(orig) {
  const map = { 'live:amber': 'mem_27a7b9a977e04d2498ed94f0282e5844', 'live:whale': 'mem_b914e1b055d4437eaed77cace8546b91', 'live:m78fix-md': 'mem_5f6a877ffed24248af16abd8567745f2', 'live:push-investigation': 'mem_044dd2f5581549bfbae880d7a643a862', 'live:tokenize-correction': 'mem_31919729c447464585ee14ab25d2f033' }
  return orig.expectedEpisodeIds.filter((x) => x.startsWith('live:')).flatMap((x) => {
    if (x === 'live:lunch') return ['mem_4257151bfacc49ecbd54f4f9f60c092d']
    if (x === 'live:log-overview') return []   // virtual multi-target stays unresolved
    if (x === 'live:shadow-next') return ['mem_44d318bbc806481e9ea672cd13fb2ae7']
    return map[x] ? [map[x]] : []
  })
}
function resolvedLiveForbidden(orig) {
  return [...orig.forbiddenMemoryIds, ...orig.forbiddenEpisodeIds]
    .filter((x) => x.startsWith('live:')).flatMap((x) =>
      x === 'live:lunch' ? ['mem_4257151bfacc49ecbd54f4f9f60c092d']
        : x === 'live:tokenize-correction' ? ['mem_31919729c447464585ee14ab25d2f033'] : [])
}
writeFileSync(DIR + 'existing-labels-reviewed.jsonl',
  reviewed.map((r) => JSON.stringify(r)).join('\n') + '\n')

// ---- counterfactual pairs ----
const cf = load(DIR + 'counterfactual-pairs.jsonl')

// ---- validation ----
const IDRE = /^(mem_[0-9a-f]{32}|ep_[0-9a-f]{16})$/
const problems = []
function checkIds(prefix, arr, field) {
  for (const s of arr) {
    for (const id of s[field] || []) {
      if (!IDRE.test(id)) problems.push(`${prefix}:${s.sampleId} bad-id-format ${field}:${id}`)
      else if (!liveSet.has(id) && !epSet.has(id)) problems.push(`${prefix}:${s.sampleId} unknown-id ${field}:${id}`)
    }
    const inter = (s.expectedMemoryIds || []).filter((x) => (s.forbiddenMemoryIds || []).includes(x))
    if (inter.length) problems.push(`${prefix}:${s.sampleId} expected/forbidden overlap: ${inter.join(',')}`)
  }
}
checkIds('reviewed', reviewed, 'proposedExpectedMemoryIds')
checkIds('reviewed', reviewed, 'proposedForbiddenMemoryIds')
checkIds('cf', cf, 'expectedMemoryIds')
checkIds('cf', cf, 'forbiddenMemoryIds')
const uniq = (arr, key) => { const m = new Map(); for (const s of arr) m.set(s[key], (m.get(s[key]) || 0) + 1); return [...m.entries()].filter(([, v]) => v > 1) }
for (const [k, v] of uniq(reviewed, 'sampleId')) problems.push(`duplicate reviewed sampleId ${k} x${v}`)
for (const [k, v] of uniq(cf, 'sampleId')) problems.push(`duplicate cf sampleId ${k} x${v}`)
const pairSplits = new Map()
for (const s of cf) {
  if (!pairSplits.has(s.pairId)) pairSplits.set(s.pairId, s.split)
  else if (pairSplits.get(s.pairId) !== s.split) problems.push(`${s.sampleId} pair ${s.pairId} crosses splits`)
}
const SENS = [/sk-[A-Za-z0-9]{8,}/, /ghp_[A-Za-z0-9]{8,}/, /gho_[A-Za-z0-9]{8,}/,
  /1[3-9]\d{9}/, /[A-Za-z]:[\\/][^\s]{4,}/, /\/Users\//, /\/home\//,
  /app_secret|api[_-]?key\s*[:=]/i]
for (const s of [...reviewed, ...cf]) {
  for (const re of SENS) if (re.test(s.queryText)) problems.push(`${s.sampleId} sensitive-pattern in query: ${re}`)
}
const SYSMARK = /system\s*prompt|developer\s*指令|<\||You are an? (AI|agent)|assistant>/i
for (const s of [...reviewed.map((r) => ({ sampleId: r.sampleId, queryText: r.queryText })), ...cf])
  if (SYSMARK.test(s.queryText)) problems.push(`${s.sampleId} system/runtime marker in query`)
const qseen = new Map()
for (const s of [...reviewed.map((r) => ({ ...r, kind: 'reviewed' })), ...cf.map((x) => ({ ...x, kind: 'cf' }))]) {
  const k = s.kind + '|' + (s.workspaceScope || '*') + '|' + s.queryText
  qseen.set(k, (qseen.get(k) || 0) + 1)
}
for (const [k, v] of qseen) if (v > 1) problems.push(`near-duplicate queryText x${v}: ${k}`)

const dist = (arr, f) => { const m = {}; for (const s of arr) { const k = f(s); m[k] = (m[k] || 0) + 1 } return m }

// ---- boundary queue ----
const QUEUE = ['cal-0009', 'cal-0010', 'cal-0003', 'cal-0001', 'cal-0024', 'cal-0005',
  'cal-0016', 'cal-0068', 'cal-0007', 'cal-0008', 'cal-0039', 'cal-0044', 'cal-0015',
  'cal-0014', 'cal-0036', 'cal-0037', 'cal-0055', 'cal-0058', 'cal-0002', 'cal-0031',
  'cal-0035', 'cal-0066', 'cal-0045', 'cal-0020', 'cal-0062', 'cal-0060', 'cal-0059', 'cal-0073']
const byId = Object.fromEntries(reviewed.map((r) => [r.sampleId, r]))
const gistOf = (r) => {
  const ids = r.proposedExpectedMemoryIds.length ? r.proposedExpectedMemoryIds
    : r.proposedForbiddenMemoryIds
  const g = (ids[0] && (liveGist[ids[0]] || epGist[ids[0]])) || ''
  if (g) return g
  const s = scored.find((x) => x.sampleId === r.sampleId)
  const topKey = s && s._ranked && s._ranked[0] && s._ranked[0].key
  return (topKey && (liveGist[topKey] || epGist[topKey])) || ''
}
const queueRows = QUEUE.map((id) => byId[id])
// ---- CJK-aware fixed-width rendering (等宽对齐，中文按 2 列宽) ----
const dispW = (s) => [...String(s)].reduce((a, c) => a
  + (/[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFFEF\u3000-\u303F\u4E00-\u9FFF]/.test(c) ? 2 : 1), 0)
const trunc = (s, w) => { s = String(s); if (dispW(s) <= w) return s
  let out = '', wid = 0
  for (const ch of s) { const cw = dispW(ch); if (wid + cw > w - 1) break; out += ch; wid += cw }
  return out + '…' }
const pad = (s, w) => { s = trunc(String(s), w); return s + ' '.repeat(Math.max(0, w - dispW(s))) }
// preserve choices the user already filled in an older version of the file
const prevChoices = new Map()
try {
  for (const line of readFileSync(DIR + 'boundary-review.md', 'utf8').split('\n')) {
    const cells = line.split('|')
    if (cells.length > 6 && /^cal-\d{4}$/.test((cells[2] || '').trim())) {
      const choice = cells[cells.length - 1].trim()
      if (choice && choice !== '____') prevChoices.set(cells[2].trim(), choice)
    }
  }
} catch {}
const COLS = [['#', 3], ['样本', 9], ['查询', 30], ['候选/gold摘要', 24], ['观测分', 6], ['建议', 15], ['H', 1], ['理由', 26], ['选择', 6]]
const sep = '+' + COLS.map(([, w]) => '-'.repeat(w + 2)).join('+') + '+'
const fmtRow = (cells) => '|' + cells.map((c, i) => ' ' + pad(c, COLS[i][1]) + ' ').join('|') + '|'
const md = [
  '# M7 Activation 标签人工复核队列(boundary-review)',
  '',
  '> runId=label-review-cal20260824-1954 · 从 73 条 silver 标签中选出 ' + queueRows.length + ' 条边界样本。',
  '> 选择栏只允许：**A**=activate、**P**=prefetch、**S**=suppress、**H**=harmful(附加旗标)、**E**=编辑目标 memoryIds。',
  '> 你确认后，这些条目将被置为 `labelSource=human`、`isGold=true` 并交回校准流程重算阈值；未确认的条目保持 silver。',
  '> 完整 memoryId/episodeId 见文末附录与 gold-import-template.jsonl；本表已按等宽对齐，直接在「选择」列填写字母即可。',
  '',
  '```text',
  sep,
  fmtRow(['序', '样本', '查询', '候选/gold摘要', '分', '建议(A/P/S/H/E)', 'H', '理由(短)', '选择']),
  sep,
]
queueRows.forEach((r, i) => {
  const cells = [String(i + 1), r.sampleId, r.queryText,
    gistOf(r).replace(/^[-#\s]+/, ''), r.observed.score.toFixed(3),
    r.proposedAction + (r.disagreementWithPreviousLabel ? '(改)' : ''),
    r.harmful ? 'Y' : 'N',
    r.rationale.split('；')[0].replace(/^典型回声：/, '回声：'), '']
  const saved = prevChoices.get(r.sampleId)
  cells[cells.length - 1] = saved || '____'
  md.push(fmtRow(cells))
})
md.push(sep)
md.push('```')
md.push('')
md.push('## 目标 ID 附录(E 编辑时用)')
queueRows.forEach((r, i) => {
  md.push('- ' + String(i + 1).padStart(2, '0') + ' ' + r.sampleId
    + '  exp=' + (r.proposedExpectedMemoryIds.join(',') || '—')
    + '  forb=' + (r.proposedForbiddenMemoryIds.join(',') || '—'))
})
md.push('')
md.push('## 复核重点提示')
md.push('- 第 1、2 行是"回声陷阱"本体：语义最高分的两条其实是 suppress——请优先裁决。')
md.push('- 带"(改)"的行是本次复核与上一轮标签不一致处（最终以你的选择栏为准；cal-0036/0037 已有初步口径=改回 prefetch，见 user-rulings-pending.json）。')
md.push('- cal-0020 存在并列正确答案争议（ep_9695c… vs 实际检索第一的 ep_11f4f…），暂维持单一 gold，可用 E 改写。')
writeFileSync(DIR + 'boundary-review.md', md.join('\n') + '\n')

// ---- gold import template ----
const template = queueRows.map((r) => ({
  sampleId: r.sampleId,
  sourceArtifact: 'artifacts/m7-live-pre/calibration-cal20260824-1855/labels.jsonl',
  queryText: r.queryText,
  surface: r.surface,
  currentLabel: { action: r.previousAction, isGold: false, labelSource: 'strong-agent' },
  proposal: { action: r.proposedAction,
              expectedMemoryIds: r.proposedExpectedMemoryIds,
              forbiddenMemoryIds: r.proposedForbiddenMemoryIds,
              harmful: r.harmful },
  userDecision: '',            // A|P|S|H|E
  userEditedExpectedMemoryIds: null, // fill when decision=E
  reviewerNote: '',
  onConfirm: 'set labelSource=human, isGold=true, apply userDecision/proposed fields',
}))
writeFileSync(DIR + 'gold-import-template.jsonl',
  template.map((t) => JSON.stringify(t)).join('\n') + '\n')

// ---- distributions + report ----
const report = {
  runId: 'label-review-cal20260824-1954',
  generatedAt: new Date().toISOString(),
  validations: {
    checked: ['id-uniqueness', 'id-format-and-existence', 'expected-forbidden-disjoint',
      'pair-split-integrity', 'sensitive-patterns', 'system-marker-leakage',
      'near-duplicate-queries'],
    problemCount: problems.length,
    problems,
  },
  counts: {
    reviewedExisting: reviewed.length,
    disagreements: reviewed.filter((r) => r.disagreementWithPreviousLabel).length,
    ambiguityFlags: reviewed.filter((r) => r.ambiguityFlag).length,
    counterfactualSamples: cf.length,
    counterfactualPairs: new Set(cf.map((s) => s.pairId)).size,
    boundaryQueue: queueRows.length,
    goldConfirmed: 0,
  },
}
writeFileSync(DIR + 'validation-report.json', JSON.stringify(report, null, 1))

const labelDist = {
  existingReviewed: {
    previousAction: dist(reviewed, (r) => r.previousAction),
    proposedAction: dist(reviewed, (r) => r.proposedAction),
    harmfulTrue: reviewed.filter((r) => r.harmful).length,
    echoRisk: dist(reviewed, (r) => r.echoRisk),
    dialogueAct: dist(reviewed, (r) => r.dialogueAct),
    taskNeed: dist(reviewed, (r) => r.taskNeed),
    scopeInvalid: reviewed.filter((r) => r.scopeStatus === 'invalid').length,
    highScoreSuppress: reviewed.filter((r) => r.previousAction === 'suppress'
      && r.observed.score >= 0.5).map((r) => r.sampleId),
  },
  counterfactual: {
    action: dist(cf, (s) => s.proposedAction),
    language: dist(cf, (s) => s.language),
    category: dist(cf, (s) => s.category),
    split: dist(cf, (s) => s.split),
    harmfulTrue: cf.filter((s) => s.harmful).length,
    crossWorkspacePairs: cf.filter((s) => s.category === 'cross-workspace'
      && s.workspaceScope === 'ws/dsh-core').length,
  },
}
writeFileSync(DIR + 'label-distribution.json', JSON.stringify(labelDist, null, 1))

const prov = {
  runId: 'label-review-cal20260824-1954',
  parentCalibrationRun: 'calibration-cal20260824-1855',
  inputs: [
    'docs/M7-ACTIVATION-CALIBRATION.md', 'docs/M7-ALGORITHM-DECISION.md',
    'docs/PYTHON-SIDECAR-CONTRACT.md §19.8/19.9', 'docs/M7-RESEARCH-PAPER.md',
    'artifacts/m7-live-pre/calibration-cal20260824-1855/*',
    'artifacts/m7-corpus-pre/{episodes,activation-scenarios,multilingual-queries,hard-negatives,review-queue}.jsonl',
  ],
  readOnlySources: ['C:/Users/JH Z/.dsh/memory/semantic-pre/derived-corpus.json (read-only)'],
  labelPolicy: {
    allLabelsStrongAgentSilver: true,
    isGoldTrueCount: 0,
    rule: 'gold 只能由用户确认产生：填写 gold-import-template.jsonl 的 userDecision 后翻转',
    generator: { provider: 'zcode-agent', model: 'ox-alpha',
                 version: 'label-review-cal20260824-1954' },
  },
  parentAnchors: { liveMemories: liveRecs.length, episodes: episodes.length,
                   note: '所有 counterfactual 样本的 expected/forbidden 均指向真实存在的记录 id，未发明新事实' },
}
writeFileSync(DIR + 'provenance-manifest.json', JSON.stringify(prov, null, 1))

console.log('reviewed:', reviewed.length,
  '| disagreements:', reviewed.filter((r) => r.disagreementWithPreviousLabel)
    .map((r) => r.sampleId).join(','),
  '| queue:', queueRows.length)
console.log('validation problems:', problems.length)
problems.slice(0, 20).forEach((p) => console.log(' -', p))
