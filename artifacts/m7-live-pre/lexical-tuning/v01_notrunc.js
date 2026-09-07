/**
 * Shadow Retrieval — M4-1 纯核心(docs/M4-CONTRACT.md §6-§16)。
 * 只读、纯函数、零 IO、零依赖(除 node:crypto);不接入 lib/index.js、不读真实文件、
 * 不写 audit、不产生任何模型可见副作用(M4 唯一模型行为=不影响模型行为)。
 *
 * 组成:
 *   1) 策略常量(SHADOW_GATE_POLICY_PRE_V1 / SHADOW_LEXICAL_BUDGET_PRE_V1 / 版本化词典)
 *   2) RetrievalContextSnapshot validator + 快照纯校验
 *   3) memoryIndexVersion(canonical corpus tuples → idx_pre_ + sha256)
 *   4) GateSignals/GateDecision + gate_pre_v1(硬抑制顺序 + 权重滞回 + cooldown)
 *   5) 确定性 tokenizer(NFKC/lowercase/词形保留/CJK 2-gram/stop words) + QueryPlan + queryDigest
 *   6) lexical_pre_v1(term/heading coverage、phrase、recency、total、排序/去重/预算/drop)
 *   7) Candidate 身份(retrievalId/candidateId 确定性) + ShadowCandidate 构造
 *   8) replay pure core(canonical 结果排除 recordedAt/latency/runtimeTag)
 * 全部函数对同输入逐字段确定;所有新增文本 UTF-8 无 BOM。
 */
import { createHash } from 'node:crypto'

const sha256Hex = (buf) => createHash('sha256').update(buf).digest('hex')
const sha256Str = (s) => sha256Hex(Buffer.from(String(s), 'utf8'))
const first32 = (h) => h.slice(0, 32)
const clamp01 = (x) => Math.max(0, Math.min(1, Number(x) || 0))

export const STOPWORDS_HIT_PRE_V2 = Object.freeze(['一一', 'sub', 'exp', 'sup', 'Lex', '第二', '一番', '一直', '一个', '一些', '许多', '种', '有的是', '也就是说', '啊', '阿', '哎', '哎呀', '哎哟', '唉', '俺', '俺们', '按', '按照', '吧', '吧哒', '把', '罢了', '被', '本', '本着', '比', '比方', '比如', '鄙人', '彼', '彼此', '边', '别', '别的', '别说', '并', '并且', '不比', '不成', '不单', '不但', '不独', '不管', '不光', '不过', '不仅', '不拘', '不论', '不怕', '不然', '不如', '不特', '不惟', '不问', '不只', '朝', '朝着', '趁', '趁着', '乘', '冲', '除', '除此之外', '除非', '除了', '此', '此间', '此外', '从', '从而', '打', '待', '但', '但是', '当', '当着', '到', '得', '的', '的话', '等', '等等', '地', '第', '叮咚', '对', '对于', '多', '多少', '而', '而况', '而且', '而是', '而外', '而言', '而已', '尔后', '反过来', '反过来说', '反之', '非但', '非徒', '否则', '嘎', '嘎登', '该', '赶', '个', '各', '各个', '各位', '各种', '各自', '给', '根据', '跟', '故', '故此', '固然', '关于', '管', '归', '果然', '果真', '过', '哈', '哈哈', '呵', '和', '何', '何处', '何况', '何时', '嘿', '哼', '哼唷', '呼哧', '乎', '哗', '还是', '还有', '换句话说', '换言之', '或', '或是', '或者', '极了', '及', '及其', '及至', '即', '即便', '即或', '即令', '即若', '即使', '几', '几时', '己', '既', '既然', '既是', '继而', '加之', '假如', '假若', '假使', '鉴于', '将', '较', '较之', '叫', '接着', '结果', '借', '紧接着', '进而', '尽', '尽管', '经', '经过', '就', '就是', '就是说', '据', '具体地说', '具体说来', '开始', '开外', '靠', '咳', '可', '可见', '可是', '可以', '况且', '啦', '来', '来着', '离', '例如', '哩', '连', '连同', '两者', '了', '临', '另', '另外', '另一方面', '论', '嘛', '吗', '慢说', '漫说', '冒', '么', '每', '每当', '们', '莫若', '某', '某个', '某些', '拿', '哪', '哪边', '哪儿', '哪个', '哪里', '哪年', '哪怕', '哪天', '哪些', '哪样', '那', '那边', '那儿', '那个', '那会儿', '那里', '那么', '那么些', '那么样', '那时', '那些', '那样', '乃', '乃至', '呢', '能', '你', '你们', '您', '宁', '宁可', '宁肯', '宁愿', '哦', '呕', '啪达', '旁人', '呸', '凭', '凭借', '其', '其次', '其二', '其他', '其它', '其一', '其余', '其中', '起', '起见', '岂但', '恰恰相反', '前后', '前者', '且', '然而', '然后', '然则', '让', '人家', '任', '任何', '任凭', '如', '如此', '如果', '如何', '如其', '如若', '如上所述', '若', '若非', '若是', '啥', '上下', '尚且', '设若', '设使', '甚而', '甚么', '甚至', '省得', '时候', '什么', '什么样', '使得', '是', '是的', '首先', '谁', '谁知', '顺', '顺着', '似的', '虽', '虽然', '虽说', '虽则', '随', '随着', '所', '所以', '他', '他们', '他人', '它', '它们', '她', '她们', '倘', '倘或', '倘然', '倘若', '倘使', '腾', '替', '通过', '同', '同时', '哇', '万一', '往', '望', '为', '为何', '为了', '为什么', '为着', '喂', '嗡嗡', '我', '我们', '呜', '呜呼', '乌乎', '无论', '无宁', '毋宁', '嘻', '吓', '相对而言', '像', '向', '向着', '嘘', '呀', '焉', '沿', '沿着', '要', '要不', '要不然', '要不是', '要么', '要是', '也', '也罢', '也好', '一', '一般', '一旦', '一方面', '一来', '一切', '一样', '一则', '依', '依照', '矣', '以', '以便', '以及', '以免', '以至', '以至于', '以致', '抑或', '因', '因此', '因而', '因为', '哟', '用', '由', '由此可见', '由于', '有', '有的', '有关', '有些', '又', '于', '于是', '于是乎', '与', '与此同时', '与否', '与其', '越是', '云云', '哉', '再说', '再者', '在', '在下', '咱', '咱们', '则', '怎', '怎么', '怎么办', '怎么样', '怎样', '咋', '照', '照着', '者', '这', '这边', '这儿', '这个', '这会儿', '这就是说', '这里', '这么', '这么点儿', '这么些', '这么样', '这时', '这些', '这样', '正如', '吱', '之', '之类', '之所以', '之一', '只是', '只限', '只要', '只有', '至', '至于', '诸位', '着', '着呢', '自', '自从', '自个儿', '自各儿', '自己', '自家', '自身', '综上所述', '总的来看', '总的来说', '总的说来', '总而言之', '总之', '纵', '纵令', '纵然', '纵使', '遵照', '作为', '兮', '呃', '呗', '咚', '咦', '喏', '啐', '喔唷', '嗬', '嗯', '嗳']);
export const GATE_POLICY_VERSION = 'gate_pre_v1'
export const LEXICAL_POLICY_VERSION = 'lexical_pre_v2'
export const INDEX_PREFIX = 'idx_pre_'
export const RETRIEVAL_PREFIX = 'ret_pre_'
export const CANDIDATE_PREFIX = 'cand_pre_'
export const NAMESPACE = 'dsh-auto-memory-pre'

/** §9.4 冻结权重(变更必须升级 policyVersion)。 */
export const SHADOW_GATE_POLICY_PRE_V1 = Object.freeze({
  schemaVersion: 1,
  policyVersion: GATE_POLICY_VERSION,
  weights: Object.freeze({
    explicitRecall: 0.30, toolFailure: 0.16, unresolved: 0.16, repeated: 0.12,
    novelty: 0.08, phaseShift: 0.08, historical: 0.05, conflict: 0.03, unresolvedAge: 0.02,
    goalDrift: 0, monitor: 0, reasoning: 0,
  }),
  hysteresisOn: 0.65,
  hysteresisOff: 0.42,
  retrieveThreshold: 0.80,
  prefetchThreshold: 0.55,
  cooldownSegments: 2,
  explicitRecallFloor: 0.82,
  // §9.3 词典版本(由 fixture 锁定)
  dictionaries: Object.freeze({
    version: 1,
    explicitRecall: Object.freeze(['回忆', '查找', '之前', '上次', 'remember', 'recall', 'previous', 'decided', 'what we decided', 'how did we']),
    phaseShift: Object.freeze(['接下来', '下一步', '现在开始', '换个', '开始', 'now', 'next', 'let us start', 'meanwhile']),
    unresolved: Object.freeze(['未解决', '待办', '没找到', '失败', '还没', '仍缺', 'pending', 'unresolved', 'not found', 'failed', 'todo']),
    conflict: Object.freeze(['不对', '错了', '不是', '反了', '纠正', 'wrong', 'incorrect', 'no that', 'actually']),
    stopWords: Object.freeze(['的', '了', '是', '和', '与', '及', '在', '我', '你', '它', '这', '那', '就', '都', '也', 'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with', 'is', 'are', 'was', 'were', 'be', 'it', 'this', 'that']),
    // §6:inputSource plugin allowlist(v1 为空=不按 inputSource 归类 plugin-generated;仅 sourcePlugin 非空才判定)
    pluginInputAllowlist: Object.freeze([]),
    // lexical_pre_v2:BM25 参数(Lucene 经典默认)+停用词来源
    bm25: Object.freeze({ k1: 1.2, b: 0.75 }),
    stopwordsSource: 'hit_stopwords.txt (github leiyusi123/stopwords), filtered',
  }),
})

/** §12.5 硬预算。 */
export const SHADOW_LEXICAL_BUDGET_PRE_V1 = Object.freeze({
  windowSegments: 8,
  windowChars: 4096,
  queryTerms: 32,
  queryBytes: 2048,
  termBytes: 96,
  corpusRecords: 512,
  corpusBytes: 64 * 1024 * 1024,
  sourceFiles: 3,
  recordScanKiB: 16,
  rawHits: 64,
  rankedKept: 8,
  excerptBytes: 480,
  deadlineCoreMs: 50,
  deadlineIoMs: 500,
  recentHits: 64,
  completedKeys: 256,
  ignoredDigests: 64,
})

/** §13 drop reason 枚举(版本化;禁止自由文本驱动逻辑)。 */
export const DROP_REASONS = Object.freeze([
  // Gate
  'config-disabled', 'anchors-disabled', 'no-owner', 'disposed', 'child-session', 'no-segment',
  'unsupported-trigger', 'plugin-generated-trigger', 'empty-query-signal', 'duplicate-context',
  'user-ignored', 'cooldown', 'below-threshold',
  // Corpus/scope
  'no-corpus', 'source-budget', 'record-budget', 'corpus-byte-budget', 'record-scan-budget',
  'source-fingerprint-changed', 'source-out-of-scope', 'cross-workspace', 'external-disabled',
  'calendar-excluded', 'sidecar-missing', 'sidecar-invalid', 'source-mismatch', 'stale-source',
  'record-stale', 'index-conflict', 'oversized', 'future-dated',
  // Query/rank
  'empty-query', 'query-term-oversize', 'no-lexical-match', 'below-score', 'duplicate-memory',
  'duplicate-content', 'candidate-budget', 'excerpt-budget', 'date-unknown',
  // Async/audit
  'cancelled', 'disposed-before-complete', 'stale-context', 'stale-index', 'deadline',
  'audit-write-failed', 'internal-error',
])
export const DROP_REASON_SET = new Set(DROP_REASONS)

/** §6 RetrievalContextSnapshot 校验(深拷贝最小字段;非法字段返回具体原因)。 */
export function validateSnapshot(snap) {
  const problems = []
  if (!snap || typeof snap !== 'object') return { ok: false, reason: 'not-object' }
  if (snap.schemaVersion !== 1) problems.push('schemaVersion')
  if (typeof snap.sessionId !== 'string' || !snap.sessionId) problems.push('sessionId')
  if (typeof snap.agentId !== 'string') problems.push('agentId')
  if (typeof snap.workspaceKey !== 'string' || !snap.workspaceKey) problems.push('workspaceKey')
  if (snap.sessionClass !== 'top-level' && snap.sessionClass !== 'child') problems.push('sessionClass')
  if (!Number.isInteger(snap.contextVersion) || snap.contextVersion < 0) problems.push('contextVersion')
  if (!Number.isInteger(snap.eventSeq) || snap.eventSeq < 0) problems.push('eventSeq')
  const t = snap.trigger
  if (!t || typeof t !== 'object') problems.push('trigger')
  else {
    if (typeof t.segmentId !== 'string' || !t.segmentId) problems.push('trigger.segmentId')
    if (typeof t.segmentDigest !== 'string' || t.segmentDigest.length < 16) problems.push('trigger.segmentDigest')
    if (!['user', 'tool_call', 'tool_result', 'assistant'].includes(t.kind)) problems.push('trigger.kind')
    if (typeof t.eventType !== 'string' || !t.eventType) problems.push('trigger.eventType')
    if (typeof t.ts !== 'number' || !Number.isFinite(t.ts)) problems.push('trigger.ts')
    if (t.nativeSeq !== undefined && !Number.isInteger(t.nativeSeq)) problems.push('trigger.nativeSeq')
  }
  if (!Array.isArray(snap.window)) problems.push('window')
  else {
    if (snap.window.length > SHADOW_LEXICAL_BUDGET_PRE_V1.windowSegments) problems.push('window-exceeds-8')
    let chars = 0
    for (const w of snap.window) {
      if (!w || typeof w !== 'object') { problems.push('window-entry'); continue }
      if (typeof w.text !== 'string') problems.push('window.text')
      else chars += w.text.length
      if (typeof w.digest !== 'string' || !w.digest) problems.push('window.digest')
      if (!Number.isInteger(w.eventSeq)) problems.push('window.eventSeq')
      if (!Number.isInteger(w.contextVersion)) problems.push('window.contextVersion')
      if (typeof w.ts !== 'number') problems.push('window.ts')
    }
    if (chars > SHADOW_LEXICAL_BUDGET_PRE_V1.windowChars) problems.push('window-exceeds-4096-chars')
  }
  if (problems.length) return { ok: false, reason: 'invalid:' + problems.join(',') }
  return { ok: true, snapshot: snap }
}

/** §8 memoryIndexVersion:canonical corpus tuples → idx_pre_ + first32hex(sha256)。 */
export function memoryIndexVersion(sources) {
  // source tuple = [scope, sourceRef, sourceEpoch, sourceVersion, fileDigest]
  const tuples = (Array.isArray(sources) ? sources : []).map((s) => [
    String(s.scope || ''), String(s.sourceRef || ''), String(s.sourceEpoch || ''),
    Number(s.sourceVersion || 1), String(s.fileDigest || ''),
  ])
  // 排序只按 scope、sourceRef;完全相同时再按 epoch/version/digest(§8)
  tuples.sort((a, b) => {
    for (let i = 0; i < 5; i++) {
      const x = String(a[i]); const y = String(b[i])
      if (x < y) return -1
      if (x > y) return 1
    }
    return 0
  })
  const canonical = tuples.map((t) => JSON.stringify(t)).join('\n')
  return INDEX_PREFIX + first32(sha256Str(canonical))
}

// ========== §10 确定性 tokenizer + QueryPlan ==========

const CJK_RE = /[\u3400-\u9FFF\uF900-\uFAFF]/
/** 标识符形态:路径段/包名/版本号/错误码/snake/kebab/camel/数字。 */
const TOKEN_RE = /[A-Za-z0-9._\-/+]+/g

/** NFKC normalize + locale-independent lowercase(Latin)。 */
export function normalizeText(text) {
  return String(text == null ? '' : text)
    .normalize('NFKC')
    .replace(/[A-Z]/g, (c) => c.toLowerCase()) // 不依赖系统 locale
}

/** 单个连续 CJK run 生成 2-gram;每 Segment 最多 64 个。 */
function cjkGrams(run, out, limit) {
  const chars = [...run]
  for (let i = 0; i + 1 < chars.length && out.length < limit; i++) {
    out.push(chars[i] + chars[i + 1])
  }
}

/** 确定性子词 tokenizer(§10.2)。 */
export function tokenize(text, opts = {}) {
  const maxCjk = opts.maxCjkGrams || 4096
  const norm = normalizeText(text)
  const out = []
  const seen = new Set()
  const cjkRuns = norm.split(/[^\u3400-\u9FFF\uF900-\uFAFF]+/)
  let cjkCount = 0
  for (const run of cjkRuns) {
    if (!run) continue
    cjkGrams(run, out, maxCjk - cjkCount)
    cjkCount = out.length
    // 保留长度合适的完整词串
    if (run.length >= 2 && run.length <= 16) {
      if (!seen.has(run)) { seen.add(run); out.push(run) }
    }
  }
  // Latin/数字/标识符
  for (const m of norm.matchAll(TOKEN_RE)) {
    const t = m[0]
    if (t.length > 1 || /^[0-9]$/.test(t)) {
      if (!seen.has(t)) { seen.add(t); out.push(t) }
    }
  }
  return out
}

/** 版本化 stop words 过滤(§10.2#5):lexical_pre_v2 起用哈工大停用词表(STOPWORDS_HIT_PRE_V2,507 词)+原版本化小表兜底;错误码/文件名/长度>1 的标识符不可移除。 */
const STOPWORDS_HIT_SET = new Set(STOPWORDS_HIT_PRE_V2)
export function isStopWord(term) {
  if (STOPWORDS_HIT_SET.has(term)) return true
  const d = SHADOW_GATE_POLICY_PRE_V1.dictionaries
  return d.stopWords.includes(term)
}

/** §10.1 QueryPlan:确定性 terms/phrases + queryDigest。 */
export function buildQueryPlan(snapshot, opts = {}) {
  const policyVersion = opts.lexicalPolicyVersion || LEXICAL_POLICY_VERSION
  const weights = { trigger: 1.0, 'recent-user': 0.8, 'tool-result': 0.6, 'tool-call': 0.4, assistant: 0.2 }
  const seenTerms = new Map()
  const phrases = []
  const oversize = []
  let termBytes = 0

  // trigger 文本
  const trigText = (snapshot.trigger && snapshot.trigger.segmentDigest ? '' : '') // digest 不是文本,trigger 不含 text——快照 trigger 无 text 字段
  // window 提供文本来源
  for (const w of snapshot.window || []) {
    const origin = w.kind === 'user' ? 'recent-user' : w.kind === 'tool_result' ? 'tool-result' : w.kind === 'tool_call' ? 'tool-call' : 'assistant'
    for (const t of tokenize(w.text, opts)) {
      if (isStopWord(t)) continue
      const cur = seenTerms.get(t)
      const wgt = Math.max(cur ? cur.weight : 0, weights[origin] || 0)
      if (Buffer.byteLength(t, 'utf8') > SHADOW_LEXICAL_BUDGET_PRE_V1.termBytes) {
        oversize.push(t)
        continue
      }
      seenTerms.set(t, { term: t, weight: wgt, origin })
    }
  }
  // 排序稳定:按 term 字典序
  const terms = [...seenTerms.values()].sort((a, b) => (a.term < b.term ? -1 : a.term > b.term ? 1 : 0))
  let truncated = false
  if (terms.length > SHADOW_LEXICAL_BUDGET_PRE_V1.queryTerms) {
    terms.length = SHADOW_LEXICAL_BUDGET_PRE_V1.queryTerms
    truncated = true
  }
  for (const t of terms) termBytes += Buffer.byteLength(t.term, 'utf8')
  if (termBytes > SHADOW_LEXICAL_BUDGET_PRE_V1.queryBytes) {
    // 从尾部丢弃直到 ≤2048
    while (termBytes > SHADOW_LEXICAL_BUDGET_PRE_V1.queryBytes && terms.length) {
      termBytes -= Buffer.byteLength(terms.pop().term, 'utf8')
      truncated = true
    }
  }
  // phrases:触发词 + 显式回忆短语完整词
  const triggerPhrase = (snapshot.trigger && snapshot.trigger.segmentDigest) ? '' : ''
  // 简单 phrase 提取:window 最近 user 文本的 2-4 词短语(规范化)
  const recentUser = [...(snapshot.window || [])].reverse().find((w) => w.kind === 'user')
  if (recentUser) {
    const words = tokenize(recentUser.text, opts).filter((t) => !isStopWord(t)).slice(0, 4)
    if (words.length >= 2) phrases.push(words.join(' '))
  }
  // phrase 预算 8
  while (phrases.length > 8) phrases.pop()

  const canonical = JSON.stringify({ policyVersion, terms, phrases })
  const queryDigest = first32(sha256Str(canonical))
  return {
    schemaVersion: 1, policyVersion, contextVersion: snapshot.contextVersion,
    queryDigest, terms, phrases, truncated, oversizeCount: oversize.length,
  }
}

// ========== §9 Gate ==========

const D = () => SHADOW_GATE_POLICY_PRE_V1.dictionaries

function hasAny(text, list) {
  const norm = normalizeText(text)
  return list.some((p) => norm.includes(normalizeText(p)))
}

/** §9.3 信号计算(纯函数;输入仅 snapshot.window/trigger/QueryPlan/recentHits)。 */
export function computeSignals(snapshot, queryPlan, recentHits = []) {
  const trig = snapshot.trigger || {}
  const win = snapshot.window || []
  const signals = {
    explicitRecall: 0, novelty: 0, unresolved: 0, phaseShift: 0, toolFailure: 0,
    conflict: 0, historical: 0, repeated: 0, unresolvedAge: 0, goalDrift: 0, monitor: 0,
  }
  // novelty:trigger digest 是否在前序 window
  signals.novelty = win.some((w) => w.digest === trig.segmentDigest) ? 0 : 1
  // explicitRecall:user trigger 命中明确回忆短语
  if (trig.kind === 'user') {
    // 需要 trigger 文本——快照 trigger 无 text;用最近 user window 文本近似?契約 9.3 说 trigger.kind='user' 且命中短语
    // snapshot.trigger 没有 text 字段,这里由调用方在 snapshot.trigger.text 传入(扩展字段,非契约禁止)
    const trigText = trig.text || ''
    signals.explicitRecall = hasAny(trigText, D().explicitRecall) ? 1 : 0
  }
  // repeated:window 内同 toolName 的 tool_call 计数
  const toolCounts = new Map()
  for (const w of win) {
    if (w.kind === 'tool_call' && w.toolName) {
      toolCounts.set(w.toolName, (toolCounts.get(w.toolName) || 0) + 1)
    }
  }
  const maxSame = Math.max(0, ...toolCounts.values())
  signals.repeated = Math.min(1, Math.max(0, maxSame - 1) / 2)
  // phaseShift:user + 转折词典 + 之前窗口有 tool_call/tool_result
  if (trig.kind === 'user' && hasAny(trig.text || '', D().phaseShift)) {
    const hasTool = win.some((w) => w.kind === 'tool_call' || w.kind === 'tool_result')
    signals.phaseShift = hasTool ? 1 : 0
  }
  // unresolved:最近 user 命中未决词典且其后无针对性 tool_result
  const users = win.filter((w) => w.kind === 'user')
  const lastUser = users[users.length - 1]
  if (lastUser && hasAny(lastUser.text, D().unresolved)) {
    const after = win.indexOf(lastUser)
    const hasResult = win.slice(after + 1).some((w) => w.kind === 'tool_result')
    signals.unresolved = hasResult ? 0 : 1
  }
  // unresolvedAge:trigger.ts - oldestUnresolvedUserTs
  const firstUnresolved = users.find((w) => hasAny(w.text, D().unresolved))
  if (firstUnresolved && trig.ts) {
    signals.unresolvedAge = Math.min(1, Math.max(0, (trig.ts - firstUnresolved.ts) / 300000))
  }
  // toolFailure:trigger.toolOk=false 或最近 tool_result error 标量
  if (trig.toolOk === false || trig.errorName || trig.errorCode) signals.toolFailure = 1
  else {
    const lastResult = [...win].reverse().find((w) => w.kind === 'tool_result')
    if (lastResult && (lastResult.errorName || lastResult.errorCode)) signals.toolFailure = 1
  }
  // historical:recentHits 中同 queryDigest 且 fresh
  if (queryPlan && queryPlan.queryDigest) {
    signals.historical = (recentHits || []).some((h) => h.queryDigest === queryPlan.queryDigest && h.fresh !== false) ? 1 : 0
  }
  // conflict M4 v1 固定 0(§9.3)
  signals.conflict = 0
  return signals
}

/** §9.4 gate_pre_v1:硬抑制 → 权重滞回 → 决策。同步纯函数,零 IO。 */
export function gatePreV1(snapshot, opts = {}) {
  const policy = SHADOW_GATE_POLICY_PRE_V1
  const latchedPrev = opts.previousLatch === true
  const cooldownRemaining = Math.max(0, Number(opts.cooldownRemaining) || 0)
  const hard = opts.hardSuppress || {}
  const signals = opts.signals || computeSignals(snapshot, opts.queryPlan, opts.recentHits)

  const base = {
    schemaVersion: 1, policyVersion: GATE_POLICY_VERSION, signals,
    contextVersion: snapshot.contextVersion,
  }
  // 硬抑制顺序(§9.2)
  const HARD_ORDER = ['no-owner', 'disposed', 'child-session', 'no-segment', 'unsupported-trigger',
    'plugin-generated-trigger', 'empty-query-signal', 'duplicate-context', 'user-ignored']
  for (const r of HARD_ORDER) {
    if (hard[r]) return { ...base, action: 'suppress', state: 'normal', reason: r, rawScore: 0, hesitation: 0, latched: false, cooldownRemaining, explicitRecallBypass: false }
  }
  // cooldown
  if (cooldownRemaining > 0 && signals.explicitRecall !== 1) {
    return { ...base, action: 'suppress', state: 'cooldown', reason: 'cooldown', rawScore: 0, hesitation: 0, latched: latchedPrev, cooldownRemaining, explicitRecallBypass: false }
  }
  const w = policy.weights
  const weightedRaw = clamp01(
    w.explicitRecall * clamp01(signals.explicitRecall) +
    w.toolFailure * clamp01(signals.toolFailure) +
    w.unresolved * clamp01(signals.unresolved) +
    w.repeated * clamp01(signals.repeated) +
    w.novelty * clamp01(signals.novelty) +
    w.phaseShift * clamp01(signals.phaseShift) +
    w.historical * clamp01(signals.historical) +
    w.conflict * clamp01(signals.conflict) +
    w.unresolvedAge * clamp01(signals.unresolvedAge),
  )
  const rawScore = signals.explicitRecall === 1 ? Math.max(weightedRaw, policy.explicitRecallFloor) : weightedRaw
  const latchedNext = latchedPrev ? rawScore >= policy.hysteresisOff : rawScore >= policy.hysteresisOn
  const hesitation = clamp01(latchedNext ? Math.max(rawScore, policy.prefetchThreshold) : rawScore)
  let action = 'suppress'
  let state = 'normal'
  let reason = 'below-threshold'
  if (hesitation >= policy.retrieveThreshold) { action = 'retrieve'; state = 'armed'; reason = 'armed' }
  else if (hesitation >= policy.prefetchThreshold) { action = 'prefetch'; state = 'prefetch'; reason = 'warm' }
  else { action = 'suppress'; state = 'normal'; reason = 'below-threshold' }
  const nextCooldown = action === 'retrieve' ? policy.cooldownSegments : 0
  return {
    ...base, action, state, reason, rawScore, hesitation, latched: latchedNext,
    cooldownRemaining: nextCooldown, explicitRecallBypass: signals.explicitRecall === 1,
  }
}



// ========== §11 Candidate 身份 + §12 lexical_pre_v1 ==========

const MEMORY_ID_STRICT = /^mem_[0-9a-f]{32}$/

/** §11 retrievalId(确定性,可重放;非长期内容身份)。 */
export function buildRetrievalId(sessionId, contextVersion, triggerSegmentId, memoryIndexVersion) {
  const sessionIdHash = first32(sha256Str('retrieval-pre-v1\u0000' + sessionId))
  const parts = ['retrieval-pre-v1', sessionIdHash, contextVersion, triggerSegmentId, memoryIndexVersion, GATE_POLICY_VERSION, LEXICAL_POLICY_VERSION]
  return RETRIEVAL_PREFIX + first32(sha256Str(JSON.stringify(parts)))
}

/** §11 candidateId:同 memoryId 内容变化后 candidateId 因版本/digest 改变。 */
export function buildCandidateId(retrievalId, memoryId, sourceEpoch, sourceVersion, recordDigest) {
  const parts = ['candidate-pre-v1', retrievalId, memoryId, sourceEpoch, sourceVersion, recordDigest]
  return CANDIDATE_PREFIX + first32(sha256Str(JSON.stringify(parts)))
}

/** §12.2 插件日界换算(dayBoundaryMinutes=450 → 00:00-07:30 归插件前一日)。 */
export function canonicalPlugDate(ts, dayBoundaryMinutes) {
  const dbm = Number.isInteger(dayBoundaryMinutes) && dayBoundaryMinutes > 0 ? dayBoundaryMinutes : 450
  const shifted = new Date(Number(ts) - dbm * 60000)
  return shifted.getFullYear() + '-' + String(shifted.getMonth() + 1).padStart(2, '0') + '-' + String(shifted.getDate()).padStart(2, '0')
}

/** workspace-log 文件名日期(sourceRef 形如 workspace-log:2026-08-22.md);解析失败 null。 */
export function logDateFromSourceRef(sourceRef) {
  const m = /(\d{4})-(\d{2})-(\d{2})\.md$/.exec(String(sourceRef || ''))
  if (!m) return null
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) }
}

/** §10.2 phrase 边界匹配(NFKC 后子串;Latin 两端非字母数字,CJK 不被同 run 扩展)。 */
function phraseHit(normText, normPhrase) {
  if (!normPhrase) return false
  let idx = normText.indexOf(normPhrase)
  while (idx !== -1) {
    const before = idx > 0 ? normText[idx - 1] : ''
    const after = idx + normPhrase.length < normText.length ? normText[idx + normPhrase.length] : ''
    const isAlnum = (c) => /[A-Za-z0-9]/.test(c)
    const isCjk = (c) => /[\u3400-\u9FFF\uF900-\uFAFF]/.test(c)
    const firstCjk = isCjk(normPhrase[0])
    const lastCjk = isCjk(normPhrase[normPhrase.length - 1])
    const okBefore = !before || !(firstCjk ? (isCjk(before) || isAlnum(before)) : isAlnum(before))
    const okAfter = !after || !(lastCjk ? (isCjk(after) || isAlnum(after)) : isAlnum(after))
    if (okBefore && okAfter) return true
    idx = normText.indexOf(normPhrase, idx + 1)
  }
  return false
}

/** excerpt 清洗+UTF-8 截断 480 bytes(retrieve volatile 专用)。 */
export function sanitizeExcerpt(text) {
  const cleaned = String(text == null ? '' : text).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
  const buf = Buffer.from(cleaned, 'utf8')
  if (buf.length <= SHADOW_LEXICAL_BUDGET_PRE_V1.excerptBytes) return cleaned
  return buf.subarray(0, SHADOW_LEXICAL_BUDGET_PRE_V1.excerptBytes).toString('utf8').replace(/[\uFFFD]+$/, '')
}

/**
 * lexical_pre_v1 检索核心(§10-§13):纯函数,零 IO。
 * @param {{memoryIndexVersion?:string,sources:Array,records:Array}} corpus 纯内存 fixture
 * @param {object} queryPlan buildQueryPlan 输出
 * @param {{triggerTs?:number,mode?:'retrieve'|'prefetch',dayBoundaryMinutes?:number}} opts
 */
export function lexicalSearch(corpus, queryPlan, opts = {}) {
  const B = SHADOW_LEXICAL_BUDGET_PRE_V1
  const dropped = []
  const drop = (stage, reason, extra) => dropped.push(Object.assign({ stage, reason }, extra || {}))
  const records = Array.isArray(corpus && corpus.records) ? corpus.records : []
  const sources = Array.isArray(corpus && corpus.sources) ? corpus.sources : []
  if (records.length > B.corpusRecords) return { rawHits: [], kept: [], dropped: [{ stage: 'corpus', reason: 'record-budget' }], counts: { sources: sources.length, records: records.length, legacyConflicts: 0, rawHits: 0, kept: 0, dropped: 1 } }
  let corpusBytes = 0
  for (const r of records) corpusBytes += Number(r.bytes || 0)
  if (corpusBytes > B.corpusBytes) return { rawHits: [], kept: [], dropped: [{ stage: 'corpus', reason: 'corpus-byte-budget' }], counts: { sources: sources.length, records: records.length, legacyConflicts: 0, rawHits: 0, kept: 0, dropped: 1 } }
  if (sources.length > B.sourceFiles) drop('corpus', 'source-budget', { detail: sources.length })

  const trigTs = Number(opts.triggerTs) || Date.now()
  const dbm = opts.dayBoundaryMinutes
  const mode = opts.mode === 'prefetch' ? 'prefetch' : 'retrieve'
  const termTotalWeight = queryPlan.terms.reduce((a, t) => a + t.weight, 0) || 1
  const normPhrases = (queryPlan.phrases || []).map((p) => normalizeText(p))

  // lexical_pre_v2:BM25 语料统计(df/avgdl;Okapi 经典参数 k1=1.2 b=0.75)
  const bm25 = SHADOW_GATE_POLICY_PRE_V1.dictionaries.bm25 || { k1: 1.2, b: 0.75 }
  let totalTokens = 0
  const docTokensList = []
  const DF = new Map() // term → 出现该词的记录数(document frequency)
  for (const rec of records) {
    if (!rec.memoryId || !MEMORY_ID_STRICT.test(rec.memoryId)) continue
    const toks = tokenize((rec.heading ? rec.heading + ' ' : '') + String(rec.text || ''))
    totalTokens += toks.length
    docTokensList.push(toks)
    for (const tk of new Set(toks)) DF.set(tk, (DF.get(tk) || 0) + 1)
  }
  const N = Math.max(1, docTokensList.length)
  const avgdl = totalTokens / N || 1

  const rawHits = []
  let legacyConflicts = 0
  for (const rec of records) {
    if (!rec.memoryId || !MEMORY_ID_STRICT.test(rec.memoryId)) { legacyConflicts++; continue }
    let text = String(rec.text || '')
    if (Buffer.byteLength(text, 'utf8') > B.recordScanKiB * 1024) {
      text = Buffer.from(text, 'utf8').subarray(0, B.recordScanKiB * 1024).toString('utf8')
      drop('rank', 'record-scan-budget', { memoryId: rec.memoryId })
    }
    const normHeading = normalizeText(rec.heading || '')
    const normBody = normalizeText(text)
    // lexical_pre_v2:BM25 覆盖率——idf 加权(稀有词贡献大)+ tf 饱和(k1)+ 文档长度归一(b)
    const docTokens = tokenize(normHeading + ' ' + normBody)
    const tfMap = new Map()
    for (const tk of docTokens) tfMap.set(tk, (tfMap.get(tk) || 0) + 1)
    const dl = Math.max(1, docTokens.length)
    let hitBm25 = 0
    let headingBm25 = 0
    let totalIdf = 0
    const matchedDigests = []
    for (const t of queryPlan.terms) {
      const df = DF.get(t.term) || 0
      if (!df && !normBody.includes(t.term) && !normHeading.includes(t.term)) continue
      const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5))
      const inHeading = normHeading.includes(t.term)
      const inBody = tfMap.has(t.term) || normBody.includes(t.term)
      if (!inHeading && !inBody) continue
      const tfv = Math.max(tfMap.get(t.term) || 0, normHeading.includes(t.term) ? 1 : 0, normBody.includes(t.term) ? 1 : 0)
      const sat = (tfv * (bm25.k1 + 1)) / (tfv + bm25.k1 * (1 - bm25.b + bm25.b * dl / avgdl)) / (bm25.k1 + 1)
      hitBm25 += idf * sat * t.weight
      if (inHeading) headingBm25 += idf * sat
      totalIdf += idf * t.weight
      matchedDigests.push(first32(sha256Str(t.term)))
    }
    let phraseMatch = 0
    for (const np of normPhrases) { if (phraseHit(normBody, np) || phraseHit(normHeading, np)) { phraseMatch = 1; break } }
    // BM25 覆盖率归一:idf 加权命中 / idf 加权查询总量 → [0,1]
    const termCoverage = totalIdf > 0 ? clamp01(hitBm25 / totalIdf) : 0
    const headingCoverage = totalIdf > 0 ? clamp01(headingBm25 / totalIdf) : 0
    if (!matchedDigests.length && !phraseMatch) { drop('rank', 'no-lexical-match', { memoryId: rec.memoryId, sourceRef: rec.sourceRef }); continue }
    const srcRef = String(rec.sourceRef || '')
    let recency = 0.5
    if (/workspace-log/.test(srcRef)) {
      const ld = logDateFromSourceRef(srcRef)
      if (!ld) { drop('rank', 'date-unknown', { memoryId: rec.memoryId }); continue }
      const plugDate = canonicalPlugDate(trigTs, dbm)
      const fileNum = new Date(ld.y, ld.m - 1, ld.d).getTime()
      const plugNum = new Date(plugDate.replace(/-/g, '/')).getTime()
      if (fileNum - plugNum > 24 * 3600000) { drop('rank', 'future-dated', { memoryId: rec.memoryId, sourceRef: srcRef }); continue }
      const ageDays = Math.max(0, (trigTs - fileNum) / 86400000)
      recency = Math.pow(2, -ageDays / 30)
    }
    if (termCoverage <= 0 && phraseMatch !== 1) continue
    const total = clamp01(0.72 * termCoverage + 0.15 * headingCoverage + 0.08 * phraseMatch + 0.05 * recency)
    if (total < 0.10) { drop('rank', 'below-score', { memoryId: rec.memoryId, detail: total }); continue }
    rawHits.push({
      memoryId: rec.memoryId, anchorId: rec.anchorId || ('memory:' + rec.memoryId),
      scope: rec.scope, sourceClass: rec.sourceClass, sourceRef: srcRef,
      sourceEpoch: rec.sourceEpoch, sourceVersion: rec.sourceVersion,
      fileDigest: rec.fileDigest, recordDigest: rec.recordDigest,
      lineStart: rec.lineStart, lineEnd: rec.lineEnd, byteStart: rec.byteStart, byteEnd: rec.byteEnd,
      heading: rec.heading != null ? rec.heading : null,
      scores: { termCoverage, headingCoverage, phraseMatch, recency, total },
      matchedTermDigests: matchedDigests, estimatedBytes: Number(rec.bytes || 0),
      text,
    })
  }
  const hits = rawHits.slice(0, B.rawHits)
  for (let i = B.rawHits; i < rawHits.length; i++) drop('rank', 'candidate-budget', { memoryId: rawHits[i].memoryId })

  const byMemory = new Map()
  for (const h of hits) {
    if (!byMemory.has(h.memoryId)) byMemory.set(h.memoryId, [])
    byMemory.get(h.memoryId).push(h)
  }
  const deduped = []
  for (const [mid, group] of byMemory) {
    const digests = new Set(group.map((h) => h.recordDigest))
    if (digests.size > 1) {
      drop('dedupe', 'index-conflict', { memoryId: mid, detail: digests.size })
      continue
    }
    deduped.push(group[0])
    for (const dup of group.slice(1)) drop('dedupe', 'duplicate-content', { memoryId: mid, sourceRef: dup.sourceRef })
  }
  deduped.sort((x, y) => {
    if (y.scores.total !== x.scores.total) return y.scores.total - x.scores.total
    if (y.scores.termCoverage !== x.scores.termCoverage) return y.scores.termCoverage - x.scores.termCoverage
    if (y.scores.headingCoverage !== x.scores.headingCoverage) return y.scores.headingCoverage - x.scores.headingCoverage
    const xs = x.scope === 'Workspace' ? 0 : 1
    const ys = y.scope === 'Workspace' ? 0 : 1
    if (xs !== ys) return xs - ys
    return x.memoryId < y.memoryId ? -1 : x.memoryId > y.memoryId ? 1 : 0
  })
  // §12.4 跨 memoryId 同 recordDigest 去重:排序后保留更高者,其余 duplicate-content(保留 provenance)
  const finalList = []
  const seenRecordDigest = new Set()
  for (const h of deduped) {
    if (seenRecordDigest.has(h.recordDigest)) {
      drop('dedupe', 'duplicate-content', { memoryId: h.memoryId, sourceRef: h.sourceRef })
      continue
    }
    seenRecordDigest.add(h.recordDigest)
    finalList.push(h)
  }
  const keptHits = finalList.slice(0, B.rankedKept)
  for (const d of finalList.slice(B.rankedKept)) drop('rank', 'candidate-budget', { memoryId: d.memoryId })
  return {
    rawHits: hits, kept: keptHits, dropped,
    counts: { sources: sources.length, records: records.length, legacyConflicts, rawHits: hits.length, kept: keptHits.length, dropped: dropped.length },
  }
}

/** ShadowCandidate 构造(§11 schema+确定性 candidateId;excerpt 仅 retrieve 且 sanitize)。 */
export function buildCandidates(retrievalId, kept, mode) {
  const out = []
  for (const k of kept) {
    const c = {
      schemaVersion: 1,
      candidateId: buildCandidateId(retrievalId, k.memoryId, k.sourceEpoch, k.sourceVersion, k.recordDigest),
      retrievalId,
      memoryId: k.memoryId, anchorId: k.anchorId,
      scope: k.scope, sourceClass: k.sourceClass, sourceRef: k.sourceRef,
      sourceEpoch: k.sourceEpoch, sourceVersion: k.sourceVersion,
      fileDigest: k.fileDigest, recordDigest: k.recordDigest,
      lineStart: k.lineStart, lineEnd: k.lineEnd, byteStart: k.byteStart, byteEnd: k.byteEnd,
      heading: k.heading != null ? k.heading : null,
      scores: k.scores, matchedTermDigests: k.matchedTermDigests,
      reasonCodes: ['shadow-only'], estimatedBytes: k.estimatedBytes,
    }
    if (mode === 'retrieve') c.excerpt = sanitizeExcerpt(k.text || '')
    out.push(c)
  }
  return out
}

// ========== §16 replay pure core ==========

export function replay({ contextSnapshots, corpusSnapshot, gatePolicy, lexicalPolicy, labels }) {
  const results = []
  let latch = false
  let cooldown = 0
  for (let i = 0; i < contextSnapshots.length; i++) {
    const snap = contextSnapshots[i]
    const v = validateSnapshot(snap)
    if (!v.ok) { results.push({ canonical: { gate: { action: 'suppress', state: 'normal', reason: v.reason } }, error: true }); continue }
    const qp = buildQueryPlan(snap, { lexicalPolicyVersion: lexicalPolicy || LEXICAL_POLICY_VERSION })
    const signals = computeSignals(snap, qp)
    const dec = gatePreV1(snap, {
      previousLatch: latch, cooldownRemaining: cooldown, signals, queryPlan: qp,
      hardSuppress: snap.sessionClass === 'child' ? { 'child-session': true } : {},
    })
    const miv = (corpusSnapshot && corpusSnapshot.memoryIndexVersion) || INDEX_PREFIX + 'unknown'
    const retrievalId = buildRetrievalId(snap.sessionId, snap.contextVersion, snap.trigger.segmentId, miv)
    let candidates = []
    let dropped = []
    let counts = { sources: 0, records: 0, legacyConflicts: 0, rawHits: 0, kept: 0, dropped: 0 }
    if (dec.action === 'retrieve' || dec.action === 'prefetch') {
      const ls = lexicalSearch(corpusSnapshot, qp, { triggerTs: snap.trigger.ts, mode: dec.action === 'retrieve' ? 'retrieve' : 'prefetch' })
      candidates = buildCandidates(retrievalId, ls.kept, dec.action)
      dropped = ls.dropped
      counts = ls.counts
    }
    results.push({
      canonical: {
        gate: { action: dec.action, state: dec.state, reason: dec.reason, signals: dec.signals, rawScore: dec.rawScore, hesitation: dec.hesitation, latched: dec.latched },
        queryDigest: qp.queryDigest,
        retrievalId,
        candidates: candidates.map((c) => ({ memoryId: c.memoryId, sourceVersion: c.sourceVersion, fileDigest: c.fileDigest, recordDigest: c.recordDigest, score: c.scores.total, candidateId: c.candidateId })),
        dropped, counts,
        label: labels && labels[i] != null ? labels[i] : undefined,
      },
    })
    latch = dec.latched
    cooldown = dec.action === 'retrieve' ? SHADOW_GATE_POLICY_PRE_V1.cooldownSegments : Math.max(0, cooldown - 1)
  }
  return results
}
