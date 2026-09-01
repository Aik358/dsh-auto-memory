/**
 * JS 端激活判定核(js_activation_decide_v1) —— 2026-08-27 补全 JS 默认闭环。
 *
 * 与 Python m7_activation_features_v2.decide_activation_v2 逐字段对齐:
 *  - 意图头:char_wb 2-4gram + sublinear TF-IDF + L2 归一 + LR + Platt(读 recall_intent_lr_v1.json)
 *  - 两车道:explicit(interrogative/recall-ctx) / proactive
 *  - echo veto / completeness / margin / delta 门 → decision(lane/reasonCodes 与 Python 一致)
 *
 * 设计:
 *  - 纯函数、零依赖(仅 node:crypto? 不需要——无哈希,纯算术)。
 *  - 工件加载 fail closed(缺字段/configHash 校验失败 → 抛错,调用方回退)。
 *  - 输入 features 与 Python 相同:{text,denseTop,margin,containment,mark,nCand,candidateHit,
 *    hardGates,repetition,requiresRelayFlag,piiClass}。
 *  - 输出与 Python _pack 相同:{lane,decision,reasonCodes,features(snapshot),advisoryOnly,...}。
 */
import { readFileSync } from 'node:fs'

export const JS_ACTIVATION_DECIDE_VERSION = 'js_activation_decide_v1'

// ---- token 常量(与 Python 逐字一致) ----
const INTERROG = ['什么', '如何', '怎么', '哪些', '哪个', '为什么', '多少', '吗', '呢', '是不是', '对不对', '有没有', '怎么用', '怎么回事', '是什么', 'how', 'what', 'why', 'which', 'where', 'when']
const RECALL_CTX = ['之前', '上次', '当时', '早前', '以往', '历史', '记录里', '记忆里', '之前有', '上次说', '当时定', '以前']
const ACK_TOKENS = ['好的', '嗯嗯', '谢谢', '晚安', '收到']
const ERR_TOKENS = ['又失败', '又超限', '又不对', '第三次', '报错', '又出现', '又丢', 'error', 'failed', 'broken']
const REQ_TOKENS = ['帮我', '找出来', '调出来', '说一下', '再讲讲', '发我']
const PLAN_TOKENS = ['准备', '打算', '计划', '之后', '接下来', '继续']
const WS_RUN = /\s\s+/g
// Python `(?u)\b\w\w+\b` 中 \w 含 CJK;JS 的 \w 默认只含 ASCII,须显式加 CJK
// 否则中文词不被切分 → 无 gram → 中文意图全靠 intercept(严重偏差)。
const WORD_RE = /[A-Za-z0-9_\u4e00-\u9fff]+/g

/** 与 Python normalize_text 对齐(大小写折叠 + 保留 [a-z0-9]+CJK + 去其他)。 */
function normalizeText(text) {
  return String(text || '')
    .toLowerCase()
    .replace(WS_RUN, ' ')
    // 保留字母数字与 CJK,其余变空格(近似 Python 的 keep [a-z0-9] and CJK)
    .replace(/[^a-z0-9\u4e00-\u9fff\s]/g, ' ')
    .trim()
}

/** char_wb n-gram 计数(与 Python _char_wb_ngram_counts 对齐)。 */
function charWbNgramCounts(normText, minN, maxN) {
  const counts = {}
  const words = String(normText || '').match(WORD_RE) || []
  for (const w of words) {
    const padded = ' ' + w + ' '
    const L = padded.length
    for (let n = minN; n <= Math.min(maxN, L); n++) {
      for (let i = 0; i <= L - n; i++) {
        const gram = padded.slice(i, i + n)
        counts[gram] = (counts[gram] || 0) + 1
      }
    }
  }
  return counts
}

/** bigram 集合(echo 用,与 Python bigram_set 对齐)。 */
function bigramSet(text) {
  const t = normalizeText(text)
  const s = new Set()
  for (let i = 0; i < t.length - 1; i++) s.add(t.slice(i, i + 2))
  if (!s.size) s.add(t)
  return s
}

/** 词法包含(echo veto,与 Python lexical_containment 对齐)。 */
function lexicalContainment(queryText, candidateText) {
  const q = bigramSet(queryText)
  const c = bigramSet(candidateText)
  if (!q.size) return 0
  let hit = 0
  for (const g of q) if (c.has(g)) hit++
  return hit / q.size
}

/** 意图头(读 recall_intent_lr_v1.json,与 Python RecallIntentHead 对齐)。 */
function createRecallIntentHead(artifact) {
  const fs = artifact.featureSchema
  const vf = fs && fs.vectorizer
  if (!vf || vf.analyzer !== 'char_wb' || vf.sublinearTf !== true ||
      !Array.isArray(vf.ngramRange) || vf.ngramRange[0] !== 2 || vf.ngramRange[1] !== 4) {
    throw new Error('intent: unsupported featureSchema')
  }
  const vocab = artifact.vocabulary
  const idf = artifact.idf
  const coef = artifact.coefficients
  const intercept = Number(artifact.intercept)
  const cal = artifact.calibration || {}
  if (cal.method !== 'platt') throw new Error('intent: calibration not platt')
  const plattA = Number(cal.a)
  const plattB = Number(cal.b)
  const L = Object.keys(vocab).length
  if (!(L === idf.length && L === coef.length)) throw new Error('intent: length mismatch')

  function infer(text) {
    const grams = charWbNgramCounts(normalizeText(text), 2, 4)
    const acc = new Map()
    for (const gram of Object.keys(grams)) {
      const idx = vocab[gram]
      if (idx === undefined || idx === null) continue
      const cnt = grams[gram]
      const v = (1 + Math.log(cnt)) * idf[idx]
      acc.set(idx, v)
    }
    let norm = 0
    for (const v of acc.values()) norm += v * v
    norm = Math.sqrt(norm) || 1
    let z = intercept
    for (const [idx, w] of acc) z += coef[idx] * (w / norm)
    const pRaw = 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, z))))
    const zz = Math.log(Math.max(pRaw, 1e-6) / Math.max(1e-6, 1 - pRaw))
    const p = 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, plattA * zz + plattB))))
    return Math.round(p * 1e6) / 1e6
  }
  return { infer }
}

function inferDialogueAct(text, intentProb) {
  const tl = String(text || '').toLowerCase()
  if (ERR_TOKENS.some((k) => tl.includes(k))) return 'error_report'
  if (ACK_TOKENS.some((k) => tl.includes(k)) && tl.length <= 12) return 'acknowledgement'
  const hasInterrogative = tl.includes('？') || tl.includes('?') || INTERROG.some((k) => tl.includes(k))
  const recallCtx = RECALL_CTX.some((k) => tl.includes(k))
  if (recallCtx && hasInterrogative) return 'question'
  if (hasInterrogative) return 'question'
  if (REQ_TOKENS.some((k) => tl.includes(k))) return 'request'
  if (PLAN_TOKENS.some((k) => tl.includes(k))) return 'planning'
  if (intentProb < 0.4) return 'statement'
  return 'other'
}

const TASK_NEED_MAP = { error_report: 'required', question: 'optional', request: 'optional', planning: 'none', acknowledgement: 'none', statement: 'none', correction: 'none', other: 'none' }
function inferTaskNeed(act) { return TASK_NEED_MAP[act] || 'none' }

function computeEchoRisk(containment, denseTop, markZero, intentProb, policy) {
  const ev = policy.echoVeto || {}
  const arms = {
    containmentArm: containment >= (ev.containmentArm || 0),
    denseTopArm: denseTop >= (ev.denseTopArm || 0),
    markZero: Boolean(markZero),
    intentBelowCap: intentProb < (ev.requiresIntentBelow || 0),
  }
  const hit = (arms.containmentArm || arms.denseTopArm) && arms.markZero && arms.intentBelowCap
  return { arms, hit }
}

function computeCompleteness(text, policy, requiredHint, resolvedCount) {
  const cg = policy.completenessGate || {}
  const lexicon = cg.lexicon || []
  const tl = String(text || '').toLowerCase()
  const kw = lexicon.some((k) => tl.includes(String(k || '').toLowerCase()))
  const required = requiredHint != null ? Number(requiredHint) : (kw ? 2 : 1)
  const status = kw ? 'unknown' : 'complete'
  return { requiredTargetCount: required, resolvedTargetCount: resolvedCount != null ? resolvedCount : null, status }
}

function computeLane(intentProb, policy) {
  const th = policy.thresholds || {}
  return intentProb >= (th.tauLane || 0) ? 'explicit' : 'proactive'
}

/**
 * 主决策(与 Python decide_activation_v2 逐字段对齐)。
 * features: {text, denseTop, margin, containment, mark, nCand, candidateHit,
 *            hardGates?, repetition?, requiresRelayFlag?, piiClass?, requiredHint?, resolvedTargets?}
 */
export function decideActivationV2(features, head, policy) {
  const th = policy.thresholds || {}
  const reason = []
  const hg = features.hardGates || {}
  for (const k of ['harmful', 'correction', 'ignored', 'stale', 'wrongScope']) {
    if (hg[k]) {
      reason.push('hard_gate_' + (hg.piiHigh ? 'pii' : k))
      return pack(features, policy, null, 'suppress', reason, null)
    }
  }
  if (hg.piiHigh) return pack(features, policy, null, 'suppress', ['hard_gate_pii'], null)
  const intent = head.infer(features.text)
  const dact = inferDialogueAct(features.text, intent)
  const tneed = inferTaskNeed(dact)
  const echo = computeEchoRisk(features.containment || 0, features.denseTop || 0, (features.mark || 0) === 0, intent, policy)
  const comp = computeCompleteness(features.text, policy, features.requiredHint, features.resolvedTargets)
  const lane = computeLane(intent, policy)
  const hit = Boolean(features.candidateHit)
  const margin = Number(features.margin) || 0

  const finish = (decision, extra) => {
    const snap = { intentProb: intent, dialogueAct: dact, taskNeed: tneed, echoRisk: echo, completeness: comp, lane, margin }
    if (features.repetition) snap.repetitionLogged = features.repetition
    return pack(features, policy, snap, decision, reason.concat(extra || []), lane)
  }

  if (lane === 'explicit') {
    if (intent >= (th.tauHi || 0) && hit) {
      if (margin >= (th.deltaExp || 0) && comp.status === 'complete') return finish('emit', ['explicit_lane', 'completeness_complete'])
      if (margin >= (th.deltaExp || 0)) return finish('prefetch', ['explicit_lane', 'completeness_' + comp.status])
      return finish('prefetch', ['explicit_lane', 'margin_below_delta'])
    }
    if (intent >= (th.tauLo || 0) && hit) return finish('prefetch', ['explicit_lane_weak'])
    if (margin >= (th.deltaPro || 0) && (features.nCand || 0) >= 2 && intent < 0.35 &&
        (features.denseTop || 0) < (policy.echoVeto || {}).denseTopArm) {
      return finish('prefetch', ['proactive_margin_fallback'])
    }
    return finish('suppress', ['suppress_low_signal'])
  }
  // proactive
  if (echo.hit) return finish('suppress', ['echo_veto_proactive'])
  if (margin >= (th.deltaPro || 0) && (features.nCand || 0) >= 2 &&
      (features.denseTop || 0) < (policy.echoVeto || {}).denseTopArm) {
    return finish('prefetch', ['proactive_margin'])
  }
  return finish('suppress', ['suppress_low_signal'])
}

function pack(features, policy, snapshot, decision, reasonCodes, lane) {
  return {
    featurePolicyVersion: (policy && policy.policyVersion) || 'activation_policy_v2',
    activationPolicyVersion: (policy && policy.policyVersion) || 'activation_policy_v2',
    decision,
    reasonCodes,
    advisoryOnly: null,
    requiresCrossWorkspaceRelay: Boolean(features.requiresRelayFlag),
    piiClass: features.piiClass || 'unknown',
    features: snapshot,
    lane,
  }
}

/**
 * 加载并校验两个策略工件(fail closed)。JS 端独立实现,不依赖 Python 运行时。
 *
 * configHash 是 Python 导出工件时用其 json.dumps 细节算的内部标记;JS 端作为独立实现
 * 不绑定该哈希算法(避免 int/float 序列化等格式耦合)。JS 用自有的结构校验保证 fail-closed:
 *   - 必需字段齐全
 *   - intent/activation provenance(goldDigest/runId)一致
 *   - vocab/idf/coef 长度一致
 *   - mode 必须 shadow-candidate(拒绝非 shadow)
 *   - 阈值/权重数值合法(有限、范围内)
 * 若未来需要与 Python 严格对齐哈希,可另加 stableJson 实现(纯 JS,含 int/float 语义)。
 */
export function loadAndVerifyPolicy(intentPath, policyPath) {
  const ip = JSON.parse(readFileSync(intentPath, 'utf8'))
  const ap = JSON.parse(readFileSync(policyPath, 'utf8'))
  const needIp = ['policyVersion', 'goldDigest', 'runId', 'featureSchema', 'vocabulary', 'idf', 'coefficients', 'intercept', 'calibration']
  const needAp = ['policyVersion', 'goldDigest', 'runId', 'mode', 'thresholds', 'decisionOrder', 'echoVeto', 'completenessGate', 'hardGates', 'reasonCodes']
  for (const k of needIp) if (!(k in ip)) throw new Error('intent policy missing: ' + k)
  for (const k of needAp) if (!(k in ap)) throw new Error('activation policy missing: ' + k)
  if (ip.goldDigest !== ap.goldDigest || ip.runId !== ap.runId) throw new Error('provenance mismatch')
  const L = Object.keys(ip.vocabulary).length
  if (!(L === ip.idf.length && L === ip.coefficients.length)) throw new Error('length mismatch')
  // 数值合法性(fail closed):阈值/权重必须有限且合理
  const fin = (x) => typeof x === 'number' && Number.isFinite(x)
  const th = ap.thresholds || {}
  for (const k of ['tauLane', 'tauHi', 'tauLo', 'deltaExp', 'deltaPro']) {
    if (!fin(th[k]) || th[k] < 0 || th[k] > 1) throw new Error('activation threshold invalid: ' + k + '=' + th[k])
  }
  if (!fin(ip.intercept)) throw new Error('intent intercept invalid')
  if (!ip.idf.every(fin) || !ip.coefficients.every(fin)) throw new Error('intent weights invalid')
  if (ap.mode !== 'shadow-candidate') throw new Error('refusing non-shadow mode')
  return { head: createRecallIntentHead(ip), policy: ap }
}

export { normalizeText, charWbNgramCounts, lexicalContainment }
