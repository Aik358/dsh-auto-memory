/**
 * M8-0 Fact Store 纯核心(docs/proactive-associative-memory-system-map.html M-03 Semantic/Profile)。
 * 纯内存状态机,零 IO、零依赖(node:crypto 仅作确定性身份);持久化通过可注入 IO 接口,
 * Host 接线时才接真实文件(本模块自身不读写磁盘,测试用内存 IO)。
 *
 * 设计目标(M-03 元代码逐行落地):
 *   - Fact 四元组: {scope, subject, predicate, object?} + provenance + confirmedAt + ttl? + revoked?
 *   - upsert(cand): 冲突→冲突集保留双方; 自动推断不覆盖已有规则; 否则合并写入。
 *   - 用户明确声明 > 模型推断; 项目事实/用户画像/术语分开; 冲突可见、可确认、可撤销。
 *   - supersede: 同一 subject+predicate 的新事实显式取代旧事实(旧 revoked=true,保留 provenance)。
 *
 * 与 M7 judgement-shadow 的衔接(输入侧):
 *   - ingestJudgementRow(row) 消费 worker 输出的 semantic_candidate / profile_candidate,
 *     转成 FactCandidate; suggestion=supersede_suggest → supersede 路径, merge_suggest → merge。
 *
 * 与 M5 AccessEvidence 的衔接(证据挂钩,供 M9 Procedure 复用):
 *   - evidenceFor(memoryId) 聚合 seen/read/cite/reuse/success/correction 六类计数与去重 session 数。
 *
 * 与 M-06 可读投影 / sidecar 索引的衔接(输出侧,预留):
 *   - snapshot() 导出全部 fact 供 M-06 投影; Host 接线点=fact-store-pre 的 store.put 回调。
 *
 * ★ B-3(2026-09-22) 事实性入口判据(保守版):
 *   - 入口只拒「明显不是事实陈述」的 5 种形态(纯空白/纯标点表情/整句疑问/整句指令/散文残片过短),
 *     判据函数 looksFactStatementPre(text) / looksFactCandidatePre(cand) 单独导出;
 *     命中返回 {ok:false, reason:'not-a-fact-statement', code:'factness-*', message:<中文人话>},
 *     并计入 stats.factnessRejected 与 getLastFactnessReject(),**不静默丢弃**。
 *   - 边界(用户方针:宁可放过不可误杀):**不看**置信度、不看有没有「可能/大概」这类推测词;
 *     凡是「看起来不确定」一律放行,只按上面 5 种形态判。
 *
 * ★ B-4(2026-09-22) epistemicStatus 默认值:
 *   - 写入时补默认(调用方显式给了合法值就尊重):来源=模型推断 → 'observation'(推断),
 *     来源=用户明确陈述(sourceKind=explicit / sourceClass=user-memory)→ 'fact'(明说);
 *     restore() 对旧快照按同一规则 backfill,还原后不留 undefined。
 *
 * 全部同输入确定; UTF-8 无 BOM。
 */
import { createHash } from 'node:crypto'

// ========== 冻结常量(变更必须升级 FACT_POLICY_VERSION) ==========

/** Fact 策略版本。 */
export const FACT_POLICY_VERSION = 'fact_store_pre_v1'

/** factId 前缀(确定性身份)。 */
export const FACT_ID_PREFIX = 'fact_pre_'

/** factId 长度前缀断言(与 memoryId/anchorId 同风格)。 */
export const FACT_ID_RE = /^fact_pre_[0-9a-f]{32}$/

/** scope 枚举: 与 M5/M6 的 scope 对齐(User=跨工作区, Workspace=当前工作区)。 */
export const FACT_SCOPES_PRE_V1 = Object.freeze(['User', 'Workspace'])

/** M8-1 认识论状态枚举: fact=证据/不可推导, observation=推断/可重算, directive=行为指令。 */
export const FACT_EPISTEMIC_STATUSES_PRE_V1 = Object.freeze(['fact', 'observation', 'directive'])

/** M8-1 趋势枚举: 相对上次确认的生命周期走向。 */
export const FACT_TRENDS_PRE_V1 = Object.freeze(['new', 'strengthening', 'stable', 'weakening', 'stale'])

/** sourceClass 枚举: 与 m4-corpus-pre 的 sourceClass 对齐。 */
export const FACT_SOURCE_CLASSES_PRE_V1 = Object.freeze([
  'user-memory', 'workspace-notes', 'workspace-log', 'semantic-candidate', 'profile-candidate',
])

/** 来源类型: 用户明确声明(硬规则) vs 模型推断(candidate)。 */
export const FACT_SOURCE_KINDS_PRE_V1 = Object.freeze(['explicit', 'inference'])

/** 冲突处理结果枚举。 */
export const UPSERT_OUTCOMES_PRE_V1 = Object.freeze([
  'created', 'merged', 'superseded', 'conflict-added', 'inference-blocked', 'expired-ignored',
])

/** TTL 语义: 过期事实视为不存在(读取时过滤),但保留记录供审计。 */
export const FACT_TTL_DEFAULT_PRE_V1 = 0 // 0 = 永不过期

/**
 * FactCandidate 校验(fail closed)。
 * 输入可以是 judgement-shadow 行或显式用户声明; sourceKind 决定 upsert 的覆盖权。
 */
export function validateFactCandidatePre(cand) {
  const p = []
  if (!cand || typeof cand !== 'object' || Array.isArray(cand)) return { ok: false, reason: 'not-object' }
  if (!FACT_SCOPES_PRE_V1.includes(cand.scope)) p.push('scope')
  if (typeof cand.subject !== 'string' || !cand.subject.trim()) p.push('subject')
  if (typeof cand.predicate !== 'string' || !cand.predicate.trim()) p.push('predicate')
  if (cand.object !== undefined && cand.object !== null && typeof cand.object !== 'string') p.push('object')
  if (!FACT_SOURCE_KINDS_PRE_V1.includes(cand.sourceKind)) p.push('sourceKind')
  if (cand.sourceClass !== undefined && !FACT_SOURCE_CLASSES_PRE_V1.includes(cand.sourceClass)) p.push('sourceClass')
  if (cand.provenance !== undefined && (!Array.isArray(cand.provenance) || cand.provenance.some((s) => typeof s !== 'string'))) p.push('provenance')
  if (cand.confidence !== undefined && (typeof cand.confidence !== 'number' || !Number.isFinite(cand.confidence) || cand.confidence < 0 || cand.confidence > 1)) p.push('confidence')
  if (cand.ttl !== undefined && (typeof cand.ttl !== 'number' || !Number.isFinite(cand.ttl) || cand.ttl < 0)) p.push('ttl')
  // M8-1 时间三价 + 认识论状态 + 趋势(全部可选;缺省放行 → 旧结构/旧调用方不受影响)
  for (const k of ['occurredAt', 'mentionedAt', 'ingestedAt']) {
    if (cand[k] !== undefined && (typeof cand[k] !== 'number' || !Number.isFinite(cand[k]) || cand[k] < 0)) p.push(k)
  }
  if (cand.epistemicStatus !== undefined && !FACT_EPISTEMIC_STATUSES_PRE_V1.includes(cand.epistemicStatus)) p.push('epistemicStatus')
  if (cand.trend !== undefined && !FACT_TRENDS_PRE_V1.includes(cand.trend)) p.push('trend')
  if (p.length) return { ok: false, reason: 'invalid:' + p.join(',') }
  return { ok: true, candidate: cand }
}

/**
 * 校验一个已固化的 Fact(读回/持久化时 fail closed)。
 * 与 FactCandidate 的区别: Fact 必须有 factId/confirmedAt, provenance 必填数组。
 */
export function validateFactPre(fact) {
  const p = []
  if (!fact || typeof fact !== 'object' || Array.isArray(fact)) return { ok: false, reason: 'not-object' }
  if (typeof fact.factId !== 'string' || !FACT_ID_RE.test(fact.factId)) p.push('factId')
  if (!FACT_SCOPES_PRE_V1.includes(fact.scope)) p.push('scope')
  if (typeof fact.subject !== 'string' || !fact.subject.trim()) p.push('subject')
  if (typeof fact.predicate !== 'string' || !fact.predicate.trim()) p.push('predicate')
  if (fact.object !== undefined && fact.object !== null && typeof fact.object !== 'string') p.push('object')
  if (!Array.isArray(fact.provenance) || fact.provenance.some((s) => typeof s !== 'string')) p.push('provenance')
  if (typeof fact.confirmedAt !== 'number' || !Number.isFinite(fact.confirmedAt)) p.push('confirmedAt')
  if (fact.ttl !== undefined && (typeof fact.ttl !== 'number' || !Number.isFinite(fact.ttl))) p.push('ttl')
  if (fact.revoked !== undefined && typeof fact.revoked !== 'boolean') p.push('revoked')
  // M8-1 新字段(全部可选;缺字段=旧数据,放行 → 既有 facts.json 可读,不报错不丢弃)
  for (const k of ['occurredAt', 'mentionedAt', 'ingestedAt']) {
    if (fact[k] !== undefined && (typeof fact[k] !== 'number' || !Number.isFinite(fact[k]))) p.push(k)
  }
  if (fact.epistemicStatus !== undefined && !FACT_EPISTEMIC_STATUSES_PRE_V1.includes(fact.epistemicStatus)) p.push('epistemicStatus')
  if (fact.trend !== undefined && !FACT_TRENDS_PRE_V1.includes(fact.trend)) p.push('trend')
  if (p.length) return { ok: false, reason: 'invalid:' + p.join(',') }
  return { ok: true, fact }
}

/**
 * 冲突定义: 同一 subject+predicate+scope 但 object 不同(或一方有 object 一方无)。
 * 注意: 完全相同的 (subject,predicate,object,scope) 不算冲突, 是重复(走 merge)。
 */
export function isFactConflict(a, b) {
  if (!a || !b) return false
  if (a.scope !== b.scope || a.subject !== b.subject || a.predicate !== b.predicate) return false
  const ao = a.object === undefined || a.object === null ? '' : a.object
  const bo = b.object === undefined || b.object === null ? '' : b.object
  return ao !== bo
}

// ========== B-3 事实性入口判据(保守版:只拒「明显不是事实陈述」的形态) ==========

/** 陈述文本最小长度(去空白后);低于此值且呈散文形态才判为碎片。 */
export const FACT_MIN_STATEMENT_CHARS_PRE_V1 = 6

/** 判据子类码(冻结;前端/工具按它给中文说明,不要按 code 反推语义)。 */
export const FACTNESS_CODES_PRE_V1 = Object.freeze([
  'factness-empty', 'factness-symbol-only', 'factness-question', 'factness-imperative', 'factness-too-short',
])

/** 子类码 → 中文人话说明:既让模型知道「怎么改写成合法陈述」,也让人不看代码就看得懂。 */
export const FACTNESS_MESSAGES_PRE_V1 = Object.freeze({
  'factness-empty': '内容为空白(没有任何字符),不是一条事实陈述。请写成「主体 + 谓词 (+ 宾语)」再入库,例如 主体=「项目」、谓词=「构建工具」、宾语=「esbuild」。',
  'factness-symbol-only': '内容只有标点、符号或表情,没有可读的文字或数字,不是一条事实陈述。请补上文字描述再入库,例如 主体=「项目」、谓词=「状态」、宾语=「进行中」。',
  'factness-question': '内容是一个疑问句(以「?」或「？」结尾,且整句没有陈述成分),不是一条事实陈述。请先把答案写成陈述句再入库,例如写「端口 默认值 3080」,而不是「端口是多少？」。',
  'factness-imperative': '内容是一条指令或请求(以「帮我」「请」「把…改成」这类祈使开头,且整句没有陈述成分),不是一条事实陈述。请改写成已发生或已成立的陈述再入库,例如「项目 构建工具 esbuild」。',
  'factness-too-short': '内容过短(去掉空白后不足 6 个字符),像对话残片而不是完整陈述。请补全成「主体 + 谓词 (+ 宾语)」的陈述再入库。',
})

/** 判据子类码 → stats 计数键(诊断面可分别读数)。 */
const FACTNESS_STAT_KEYS_PRE_V1 = Object.freeze({
  'factness-empty': 'factnessEmpty',
  'factness-symbol-only': 'factnessSymbolOnly',
  'factness-question': 'factnessQuestion',
  'factness-imperative': 'factnessImperative',
  'factness-too-short': 'factnessTooShort',
})

/** 认识论状态强弱序:推断(observation) < 明确陈述(fact/directive)。 */
const FACT_EPISTEMIC_RANK_PRE_V1 = Object.freeze({ observation: 1, fact: 2, directive: 2 })

/** 有词形字符(拉丁/数字/CJK/假名/谚文/西里尔/希腊/全角字母数字)才算「有内容」。 */
const FACT_WORD_CHAR_RE_PRE_V1 = /[0-9A-Za-z\u00C0-\u024F\u0370-\u03FF\u0400-\u04FF\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF\uFF10-\uFF19\uFF21-\uFF3A\uFF41-\uFF5A]/

/** 句读/符号:字段里出现即视为「散文残片」,而不是结构化词条(空白 + ASCII 标点 + 中西标点/表情区)。 */
const FACT_PROSE_PUNCT_RE_PRE_V1 = /[\s!"#$%&'()*+,\-.\/:;<=>?@\[\\\]^_`{|}~\u2000-\u206F\u2190-\u2BFF\u3000-\u303F\uD800-\uDFFF\uFE10-\uFE1F\uFE30-\uFE6F\uFF01-\uFF0F\uFF1A-\uFF20\uFF3B-\uFF40\uFF5B-\uFF65]/

/** 只含中日韩文字(用于「英文祈使开头只在纯英文文本上生效」这条护栏)。 */
const FACT_CJK_CHAR_RE_PRE_V1 = /[\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF\u3000-\u303F\uFF00-\uFFEF]/

/** 疑问尾:「?」或「？」结尾(且整句无陈述成分时判为疑问)。 */
const FACT_QUESTION_TAIL_RE_PRE_V1 = /[?？]\s*$/

/** 陈述成分标记:出现任一即认为「有主谓/已成立」⇒ 一律放行(宁可放过不可误杀)。 */
const FACT_CLAUSE_MARKER_RE_PRE_V1 = /(是|为|在|有|了|被|过|会|能|需|由|得|着|将|已|后|前|时|与|和|及|即|属|含|指|表示|代表|完成|支持|启用|关闭|默认|等于|位于|\b(is|are|was|were|be|been|has|have|had|will|would|can|could|must|should|equals?|means|contains|supports|defaults?|uses?)\b)/i

/** 疑问/系词复合:先摘掉,免得「为什么」里的「为」被误当成陈述标记。 */
const FACT_CLAUSE_STRIP_RE_PRE_V1 = /(为什么|为何|什么样|什么时候|因为|认为|以为|视为|作为|属于|分为)/g

/** 祈使开头:这些形态**且整句无陈述成分**时才判为指令(请求式英文词始终生效)。 */
const FACT_IMPERATIVE_OPENERS_PRE_V1 = Object.freeze([
  /^(帮我|帮忙|帮个忙|麻烦|拜托|烦请|给我|替我|请帮|请把|请将|请给|请写|请记|请查|请修|请改|请加|请添|请看|请做)/,
  /^把[^，,。.；;？?！!]{0,12}(改成|改为|换成|换为|调成|调为|设置为|设为|调整|删除|删掉|去掉|加上|添加|补上|写上|写成)/,
  /^(please|pls|plz|help me|can you|could you|would you|i need you to|i want you to|go ahead and|make sure|remember to|do not|don't)\b/i,
])

/** 裸动词祈使开头:**仅纯英文文本**才生效(中式事实句「Run 命令：…」不得被误杀)。 */
const FACT_IMP_VERB_OPENERS_EN_PRE_V1 = /^(add|change|update|fix|remove|delete|rename|move|run|write|create|implement|refactor|ensure|revert|bump|install)\b/i

/** 去掉全部空白(长度与词形判定用)。 */
function factFlatPre(text) {
  return String(text == null ? '' : text).replace(/\s+/g, '')
}

/** 整句是否带陈述成分(带 ⇒ 放行信号)。 */
function factHasClausePre(text) {
  const s = String(text == null ? '' : text).replace(FACT_CLAUSE_STRIP_RE_PRE_V1, ' ')
  return FACT_CLAUSE_MARKER_RE_PRE_V1.test(s)
}

/** 整句是否「只有疑问」:以 ?/？ 结尾且没有陈述成分。 */
function factQuestionOnlyPre(text) {
  const s = String(text == null ? '' : text).trim()
  if (!FACT_QUESTION_TAIL_RE_PRE_V1.test(s)) return false
  return !factHasClausePre(s)
}

/** 整句是否「只有指令」:祈使形态开头且没有陈述成分。 */
function factImperativeOnlyPre(text) {
  const s = String(text == null ? '' : text).trim()
  if (!s) return false
  if (FACT_IMPERATIVE_OPENERS_PRE_V1.some((re) => re.test(s))) return !factHasClausePre(s)
  if (!FACT_CJK_CHAR_RE_PRE_V1.test(s) && FACT_IMP_VERB_OPENERS_EN_PRE_V1.test(s)) return !factHasClausePre(s)
  return false
}

/** 单个字段是否「词条形态」(不含空白与标点)。 */
function factTermLikeFieldPre(v) {
  if (typeof v !== 'string') return true
  const s = v.trim()
  if (!s) return true
  return !FACT_PROSE_PUNCT_RE_PRE_V1.test(s)
}

/** 三元组是否「结构化短词条」(每个字段都是词条形态)。 */
function factStructuredTuplePre(cand) {
  if (!cand || typeof cand !== 'object') return false
  return ['subject', 'predicate', 'object'].every((k) => factTermLikeFieldPre(cand[k]))
}

/** 组装一个拒绝判定(code + 中文人话 message)。 */
function factnessVerdictPre(code) {
  return { ok: false, code, message: FACTNESS_MESSAGES_PRE_V1[code] || code }
}

/**
 * ★ B-3 判据(纯函数,导出供宿主与测试复用):判断**一段文本**是不是事实陈述形态。
 * 只拒任务枚举的 5 种形态;**不看**置信度、不看有没有「可能/大概」这类推测词 ——
 * 凡是「看起来不确定」的一律放行(用户方针:宁可放过不可误杀)。
 * @param {string} text
 * @returns {{ok:true}|{ok:false, code:string, message:string}}
 */
export function looksFactStatementPre(text) {
  const raw = String(text == null ? '' : text).trim()
  const flat = raw.replace(/\s+/g, '')
  if (!flat) return factnessVerdictPre('factness-empty')
  if (!FACT_WORD_CHAR_RE_PRE_V1.test(flat)) return factnessVerdictPre('factness-symbol-only')
  if (factQuestionOnlyPre(raw)) return factnessVerdictPre('factness-question')
  if (factImperativeOnlyPre(raw)) return factnessVerdictPre('factness-imperative')
  if (flat.length < FACT_MIN_STATEMENT_CHARS_PRE_V1) return factnessVerdictPre('factness-too-short')
  return { ok: true }
}

/** 候选三元组 → 陈述文本(subject + predicate + object,去空段,单空格相连)。 */
export function factStatementTextPre(cand) {
  if (!cand || typeof cand !== 'object') return ''
  return ['subject', 'predicate', 'object']
    .map((k) => (typeof cand[k] === 'string' ? cand[k].trim() : ''))
    .filter((s) => s !== '')
    .join(' ')
}

/**
 * ★ B-3 判据(候选级 = 入库闸门用):对 subject 与整条陈述文本各判一次。
 *
 * 两处「宁可放过」的收窄(实测换来的,别再放宽——放宽即误杀):
 *   ① 结构化短词条豁免:三个字段都是不含空白/标点的词条形态时(如 'A'/'B'/'c'、'临时'/'任务'/'x'),
 *      视为机器构造的结构化元组而非对话残片,**不套用长度下限**。宿主与既有套件大量使用这类短元组。
 *   ② 词条形态的**短主体**不按碎片判:subject 本身不含空白/标点时(如「部署流程」),它只是短词条,
 *      不是残片 —— 残片的判据是「有散文形态(含空格/标点)且长度不足」。实测反例:
 *      subject=「部署流程」/predicate=「走 pnpm」/object=「build 后 rsync」这类合法事实,
 *      若按「subject < 6 字符就拒」会被整条误杀(smoke-test-m85-storage-manage H3 实测变红)。
 * ⇒ 长度判据实际只对**有散文形态**的残片生效。
 * @returns {{ok:true}|{ok:false, code:string, message:string}}
 */
export function looksFactCandidatePre(cand) {
  if (!cand || typeof cand !== 'object') return factnessVerdictPre('factness-empty')
  const subject = typeof cand.subject === 'string' ? cand.subject.trim() : ''
  const structured = factStructuredTuplePre(cand)
  for (const text of [subject, factStatementTextPre(cand)]) {
    const verdict = looksFactStatementPre(text)
    if (verdict.ok) continue
    if (verdict.code === 'factness-too-short') {
      if (structured) continue
      if (text === subject && factTermLikeFieldPre(subject)) continue
    }
    return verdict
  }
  return { ok: true }
}

/**
 * ★ B-4 默认认识论状态(导出供宿主/测试复用):
 *   调用方显式给了合法值就尊重(本函数只在缺省时用);
 *   来源 = 用户明确陈述(sourceKind='explicit' / sourceClass='user-memory' / origin='user')→ 'fact'(明说);
 *   其余(模型推断、自动沉淀、judgement 候选)→ 'observation'(推断)。
 *   ⚠️ 取值必须落在冻结枚举 FACT_EPISTEMIC_STATUSES_PRE_V1 内 —— 写 'inference'/'explicit'
 *   这类枚举外的字面量会被 validateFactPre 判非法并**整条拒收**,不能用。
 */
export function defaultEpistemicStatusPre(cand) {
  if (!cand || typeof cand !== 'object') return 'observation'
  const explicit = cand.sourceKind === 'explicit' || cand.sourceClass === 'user-memory' || cand.origin === 'user'
  return explicit ? 'fact' : 'observation'
}

/**
 * 主状态机工厂。
 *
 * @param {object} opts
 * @param {object} opts.io          可选持久化接口 { save(facts), load() → facts[] , clear() }
 *                                   默认 = 内存版(不落盘,进程内有效)。Host 接线时注入真实文件 IO。
 * @param {function} opts.now       可选时钟(默认 Date.now), 测试注入确定性时间。
 * @param {function} opts.factId    可选 factId 工厂(默认确定性哈希), 测试注入。
 */
export function createFactStorePre(opts = {}) {
  // ---- 内部状态(全部在实例内, 无全局) ----
  let facts = []          // 已固化 Fact 数组(含 revoked/过期, 读取时过滤)
  let conflicts = []      // 冲突集(保留双方 provenance)
  let disposed = false
  const stats = {
    upserts: 0, created: 0, merged: 0, superseded: 0, conflictAdded: 0,
    inferenceBlocked: 0, expiredIgnored: 0, revoked: 0,
    // ★ B-3(2026-09-22) 事实性入口判据的诊断计数(全部数值:clear() 按现有键遍历归零,不走嵌套对象)
    factnessRejected: 0, factnessEmpty: 0, factnessSymbolOnly: 0,
    factnessQuestion: 0, factnessImperative: 0, factnessTooShort: 0,
  }
  // ★ B-3：最近一次被事实性判据拒绝的候选(code + 中文人话 + 被判文本 + 时间),供诊断面展示
  let lastFactnessReject = null
  const io = opts.io || { save() {}, load() { return [] }, clear() {} }
  const nowFn = typeof opts.now === 'function' ? opts.now : () => Date.now()
  const idFn = typeof opts.factId === 'function' ? opts.factId : defaultFactId

  // ---- 确定性 factId(与 memoryId/anchorId 同风格) ----
  function defaultFactId(subject, predicate, object, scope) {
    const h = createHash('sha256').update(
      ['fact-pre-v1', String(scope), String(subject), String(predicate), String(object == null ? '' : object)].join('\u0000')
    ).digest('hex')
    return FACT_ID_PREFIX + h.slice(0, 32)
  }

  // 冲突自增序号:同一 subject+predicate 在极短时间内反复冲突时,conflictId 仍唯一。
  let conflictSeq = 0

  function isExpired(fact, now) {
    if (!fact || !fact.ttl || fact.ttl <= 0) return false
    return now >= fact.confirmedAt + fact.ttl
  }

  function findSubjectPredicate(scope, subject, predicate) {
    return facts.find((f) => f.scope === scope && f.subject === subject && f.predicate === predicate && !f.revoked && !isExpired(f, nowFn()))
  }

  /** A-3 修复(2026-09-21):按 factId 查记录(含 revoked),不按 subject/predicate 过滤。
   *  用于「同一元组被撤销后重新 upsert」时识别**已存在的同 id 记录**:
   *  确定性 factId 只由 (scope,subject,predicate,object) 派生,不看 revoked 状态
   *  ⇒ 撤销后重新成立会算出**同一个 factId**,旧实现直接 push 出第二条主键重复记录。
   *  宿主 index.js:9299 用 factId 做写回去重键(`hubFlushState.flushed[fact.factId]`)
   *  ⇒ 重复记录里的新事实会被当成"已处理"永久跳过。 */
  function findById(factId) {
    return facts.find((f) => f.factId === factId)
  }

  /**
   * ★ P2-2 修复(2026-09-21)：查询返回**深一层副本**。
   * 旧实现 `{ ...f }` 是浅拷贝 ⇒ `provenance` 数组与库内对象**同引用**，
   * 调用方 `get(...).provenance.push(x)` 会**直接改脏已入账记录**(且绕过 persist/统计)。
   * 与 :234 冲突快照的既有做法(数组副本)保持一致。
   */
  function cloneFact(f) {
    if (!f) return f
    return { ...f, provenance: Array.isArray(f.provenance) ? [...f.provenance] : f.provenance }
  }

  /**
   * 把候选合并进一条**已存在**的记录(原 upsert 末尾的 merge 分支,提为共用函数)。
   * 语义与改动前逐字节一致:用户声明提升 sourceKind/confidence、追加 provenance、
   * 回填 ingestedAt、confirmedAt 更新为本次确认时间、M8-1 可选元数据加法性透传。
   * 复用于两处:① 已有且不冲突的常规合并;② A-3 同 factId 命中(撤销后重新成立)的复活合并。
   * @returns {{ok:boolean, outcome:string, fact:object}}
   */
  function mergeInto(prev, c, now) {
    if (c.sourceKind === 'explicit' || prev.sourceKind !== 'explicit') {
      prev.sourceKind = c.sourceKind === 'explicit' ? 'explicit' : prev.sourceKind
    }
    if (c.sourceClass) prev.sourceClass = c.sourceClass
    if (c.provenance && c.provenance.length) {
      const seen = new Set(prev.provenance)
      for (const s of c.provenance) if (!seen.has(s)) prev.provenance.push(s)
    }
    if (c.confidence !== undefined && c.confidence !== null) prev.confidence = c.confidence
    // M8-1 向后兼容回填(须在 confirmedAt 更新前执行):旧记录(无 ingestedAt)首次合并时补齐,
    // 取其原始确认时间(=首次入库);不改变其余合并语义
    if (prev.ingestedAt === undefined && Number.isFinite(prev.confirmedAt)) prev.ingestedAt = prev.confirmedAt
    prev.confirmedAt = now // 合并视为重新确认
    // M8-1 可选元数据透传:重新陈述时更新发生/陈述时间与认识论状态/趋势(候选提供才写,加法性)
    if (c.occurredAt !== undefined) prev.occurredAt = c.occurredAt
    if (c.mentionedAt !== undefined) prev.mentionedAt = c.mentionedAt
    if (c.epistemicStatus !== undefined) {
      // ★ B-4(2026-09-22)：认识论状态跟随候选(入口 :~250 已补默认值),但**降级**要挡住 ——
      //   用户明确陈述(fact/directive)不得被后续模型推断(observation)覆盖(与上面 sourceKind 的提升同向)。
      const prevRank = FACT_EPISTEMIC_RANK_PRE_V1[prev.epistemicStatus] || 0
      const candRank = FACT_EPISTEMIC_RANK_PRE_V1[c.epistemicStatus] || 0
      if (prev.epistemicStatus === undefined || c.sourceKind === 'explicit' || candRank > prevRank) {
        prev.epistemicStatus = c.epistemicStatus
      }
    }
    if (c.trend !== undefined) prev.trend = c.trend
    if (c.ttl !== undefined) prev.ttl = c.ttl
    stats.merged++
    // ★ A-8：落盘结果向上透传（persisted=false 时调用方不得把该条当"已处理"）
    const pr = persist()
    return pr.ok
      ? { ok: true, outcome: 'merged', fact: prev, persisted: true }
      : { ok: true, outcome: 'merged', fact: prev, persisted: false, persistError: pr.error }
  }

  // ---- 核心 upsert(M-03 元代码逐行) ----
  function upsert(cand) {
    if (disposed) return { ok: false, reason: 'disposed', outcome: 'disposed' }
    stats.upserts++
    const v = validateFactCandidatePre(cand)
    if (!v.ok) return { ok: false, reason: v.reason, outcome: 'invalid' }
    // ★ B-4(2026-09-22)：候选先做**浅拷贝**再补 epistemicStatus 默认值 ——
    //   不改调用方对象(validateFactCandidatePre 返回的 candidate 就是原引用);
    //   调用方显式给了合法值就尊重(上面 validate 已保证枚举合法),没给则按来源判。
    const c = { ...v.candidate }
    if (c.epistemicStatus === undefined) c.epistemicStatus = defaultEpistemicStatusPre(c)
    const now = nowFn()

    // ★ B-3(2026-09-22) 事实性入口判据(保守版)：只拒「明显不是事实陈述」的形态,
    //   命中即**拒绝入库**,并把结构化原因(code + 中文人话)返回给调用方、
    //   计入 stats.factnessRejected 与 lastFactnessReject(getLastFactnessReject 可读),**不静默丢弃**。
    //   顺序:结构化校验(validate)在前 —— 形状非法仍报 'invalid:*';本闸门只判形态。
    const factness = looksFactCandidatePre(c)
    if (!factness.ok) {
      stats.factnessRejected++
      const statKey = FACTNESS_STAT_KEYS_PRE_V1[factness.code]
      if (statKey) stats[statKey]++
      lastFactnessReject = { code: factness.code, message: factness.message, text: factStatementTextPre(c), at: now }
      return {
        ok: false, reason: 'not-a-fact-statement', outcome: 'not-a-fact-statement',
        code: factness.code, message: factness.message,
      }
    }

    // 1. 冲突检测: 同 subject+predicate+scope 但 object 不同
    const existing = findSubjectPredicate(c.scope, c.subject, c.predicate)
    if (existing && isFactConflict(existing, c)) {
      stats.conflictAdded++
      // conflictId 必须唯一:同一候选值反复出现时,每次冲突都是独立待决事件。
      // 用 subject+predicate+object+序号+detectedAt 派生,保证可被逐个 resolve。
      conflictSeq++
      // ★ 登记**检测时快照**而非活引用（2026-09-19 上游 PR #80 第 3 项 / issue #67 同步落地）：
      //   旧实现 `left: existing` 持 store 内活对象引用 ⇒ 后续 merge 会**原地改写** existing.confidence
      //   并对 existing.provenance **数组原地 push** ⇒ 已展示/已落盘（facts.json）的冲突左侧
      //   ≠ 检测时的值 ⇒ 审计面失真（"当时判定冲突的两个值"被事后改写）。
      //   故此处取快照，provenance 额外做数组副本。
      conflicts.push({
        conflictId: defaultFactId(c.scope, c.subject, c.predicate, c.object) + '_conflict_' + conflictSeq + '_' + String(now),
        scope: c.scope, subject: c.subject, predicate: c.predicate,
        left: { ...existing, provenance: Array.isArray(existing.provenance) ? [...existing.provenance] : existing.provenance },
        right: { ...c, provenance: Array.isArray(c.provenance) ? [...c.provenance] : c.provenance },
        detectedAt: now, resolved: false,
      })
      void persist() // 冲突集是重要状态,必须落盘(不持久化会丢失待决冲突)
      return { ok: true, outcome: 'conflict-added', conflict: conflicts[conflicts.length - 1], existing }
    }

    // 2. 自动推断不覆盖已有规则(M-03: if (existing && cand.source === 'inference') return)
    if (existing && c.sourceKind === 'inference') {
      stats.inferenceBlocked++
      return { ok: true, outcome: 'inference-blocked', existing }
    }

    // 3. 新建 / 合并 / 取代
    if (!existing) {
      // ★ A-3 修复(2026-09-21)：factId 是**主键**(确定性哈希只看 scope+subject+predicate+object,
      //   不看 revoked),创建前必须先查同 id 是否已存在(含已撤销/已过期记录)。
      //   命中 = 「同一元组曾被撤销后重新成立」⇒ 走**复活 + merge**:
      //   把旧记录的 revoked 置回 false、更新 confirmedAt、合并 provenance,**绝不 push 第二条**。
      //   为什么是硬 bug:宿主 index.js:9299 用 `hubFlushState.flushed[fact.factId]` 做写回去重键
      //   ⇒ 重复主键下,重新成立的新事实会被当成"已处理"永久跳过。
      const newFactId = idFn(c.scope, c.subject, c.predicate, c.object)
      const dup = findById(newFactId)
      if (dup) {
        const revived = dup.revoked === true || isExpired(dup, now)
        dup.revoked = false
        // 撤销痕迹(revokedAt/revokeReason)属于历史审计信息,复活后必须清掉——
        // 否则「已撤销时间」会残留在一条非撤销记录上,审计面自相矛盾。
        delete dup.revokedAt
        delete dup.revokeReason
        // 注意:stats.revoked 是**累计撤销事件数**(与 superseded/created 同为事件计数器),
        // 复活不清减它 —— 保持单调,不被误读成"当前撤销条数"。
        const rr = mergeInto(dup, c, now)
        return { ...rr, revived, outcome: 'merged', reason: revived ? 'revived-duplicate-id' : 'duplicate-id-merged' }
      }
      const fact = {
        factId: newFactId,
        scope: c.scope, subject: c.subject, predicate: c.predicate,
        object: c.object === undefined ? null : c.object,
        sourceKind: c.sourceKind,
        sourceClass: c.sourceClass || (c.sourceKind === 'explicit' ? 'user-memory' : 'semantic-candidate'),
        provenance: c.provenance || [],
        confidence: c.confidence !== undefined ? c.confidence : null,
        confirmedAt: now, ttl: c.ttl !== undefined ? c.ttl : FACT_TTL_DEFAULT_PRE_V1,
        revoked: false,
        // M8-1 时间三价:入库时间必填(=本次确认);发生/陈述时间候选提供则透传,缺省 undefined(落盘时省略)
        ingestedAt: now,
        occurredAt: c.occurredAt,
        mentionedAt: c.mentionedAt,
        // ★ B-4(2026-09-22)：epistemicStatus **必填**(c 已在入口补默认值,调用方显式值原样保留)——
        //   不留 undefined,前端/面板才能据此区分「模型推断」(observation) 与「用户明说」(fact)。
        epistemicStatus: c.epistemicStatus,
        ...(c.trend !== undefined ? { trend: c.trend } : {}),
      }
      const fv = validateFactPre(fact)
      if (!fv.ok) return { ok: false, reason: 'fact-invalid:' + fv.reason, outcome: 'invalid' }
      facts.push(fv.fact)
      stats.created++
      const pr = persist()
      return pr.ok
        ? { ok: true, outcome: 'created', fact: fv.fact, persisted: true }
        : { ok: true, outcome: 'created', fact: fv.fact, persisted: false, persistError: pr.error }
    }

    // 已有且不冲突: 合并(用户声明提升 sourceKind/confidence, 追加 provenance)
    return mergeInto(existing, c, now)
  }

  /**
   * 显式取代: 同一 subject+predicate 的新事实取代旧事实(旧 revoked=true, 保留 provenance)。
   * 语义 = judgement-shadow 的 supersede_suggest / 用户明确纠正。
   */
  function supersede(cand) {
    if (disposed) return { ok: false, reason: 'disposed', outcome: 'disposed' }
    const v = validateFactCandidatePre(cand)
    if (!v.ok) return { ok: false, reason: v.reason, outcome: 'invalid' }
    const c = v.candidate
    const existing = findSubjectPredicate(c.scope, c.subject, c.predicate)
    if (existing) {
      existing.revoked = true
      existing.revokedAt = nowFn()
      stats.revoked++
      // ★ P2-1 修复(2026-09-21)：`stats.superseded` 此前是**死计数器**——
      //   声明在 stats(:141) 且被诊断面读取,但全文件没有任何一处自增(只有 revoked++)。
      //   ⇒ supersede 次数恒为 0,「取代 vs 级联撤销」在读数上无法区分。
      //   revokeBySource 走的是另一种语义(源删除级联),不在此自增,两计数分工保持可辨。
      stats.superseded++
    }
    return upsert(c)
  }

  /**
   * M10 存储管理级联撤销(2026-08-30 P3):删除一条记忆后,由它派生出来的事实必须一起失效,
   * 否则「记忆已删、事实仍在被召回/写回」(HANDOFF §2 P3 缺口③)。
   * provenance 含该 sourceId 的未撤销事实一律 revoked=true —— 保留 provenance 与 revokedAt,
   * 只读不删(可审计、可追溯),与 supersede 的撤销语义完全一致。
   */
  function revokeBySource(sourceId) {
    if (disposed) return { ok: false, reason: 'disposed', revoked: 0, factIds: [] }
    const sid = String(sourceId || '')
    if (!sid) return { ok: false, reason: 'no-source-id', revoked: 0, factIds: [] }
    const now = nowFn()
    const factIds = []
    for (const f of facts) {
      if (f.revoked) continue
      if (!Array.isArray(f.provenance) || !f.provenance.includes(sid)) continue
      f.revoked = true
      f.revokedAt = now
      f.revokeReason = 'source-deleted'
      stats.revoked++
      factIds.push(f.factId)
    }
    if (factIds.length) void persist()
    return { ok: true, revoked: factIds.length, factIds }
  }

  // ---- 查询 ----
  function get(scope, subject, predicate) {
    if (disposed) return null
    const f = findSubjectPredicate(scope, subject, predicate)
    return f ? cloneFact(f) : null // 返回副本(含数组副本), 防外部改内部态
  }
  function query(q = {}) {
    if (disposed) return []
    const now = nowFn()
    return facts
      .filter((f) =>
        (!f.revoked) &&
        (!isExpired(f, now)) &&
        (q.scope === undefined || f.scope === q.scope) &&
        (q.subject === undefined || f.subject === q.subject) &&
        (q.predicate === undefined || f.predicate === q.predicate))
      .map(cloneFact)
  }
  function conflictsList() {
    return conflicts.map((c) => ({ ...c }))
  }
  function pendingConflicts() {
    return conflicts.filter((c) => !c.resolved).map((c) => ({ ...c }))
  }
  function resolveConflict(conflictId, choice) {
    // choice: 'left' 保留左(已有), 'right' 采用右(新候选)。解析后冲突标记 resolved。
    const c = conflicts.find((x) => x.conflictId === conflictId)
    if (!c) return { ok: false, reason: 'not-found' }
    if (c.resolved) return { ok: false, reason: 'already-resolved' }
    if (choice === 'left') {
      // 保留现有: 丢弃右候选(不落库)
      c.resolved = true; c.resolvedAt = nowFn(); c.choice = 'left'
    } else if (choice === 'right') {
      // 采用新候选: 旧 revoked, 新落库
      const old = findSubjectPredicate(c.scope, c.subject, c.predicate)
      if (old) { old.revoked = true; old.revokedAt = nowFn(); stats.revoked++ }
      upsert(c.right)
      c.resolved = true; c.resolvedAt = nowFn(); c.choice = 'right'
    } else {
      return { ok: false, reason: 'invalid-choice' }
    }
    void persist()
    return { ok: true, conflict: { ...c } }
  }

  // ---- M5 evidence 挂钩(供 M9 Procedure 复用) ----
  function evidenceFor(memoryId, evidenceList = []) {
    if (disposed) return null
    const evs = evidenceList.filter((e) => e && e.memoryId === memoryId)
    const byKind = {}
    for (const k of ['seen', 'read', 'cite', 'reuse', 'success', 'correction']) byKind[k] = 0
    const sessions = new Set()
    for (const e of evs) {
      if (byKind[e.kind] !== undefined) byKind[e.kind]++
      if (e.sessionRef) sessions.add(e.sessionRef)
    }
    return {
      memoryId, total: evs.length,
      distinctSessions: sessions.size,
      ...byKind,
    }
  }

  // ---- 持久化(可注入 IO) ----
  /**
   * ★ A-8 修复(2026-09-21)：旧实现 `try { io.save(snapshot()) } catch (_) {}` **吞掉落盘失败** ——
   * 调用方看到 ok:true、宿主把该条标进 `hubFlushState.flushed`，但实际上磁盘没写上，
   * 该条**永不重写**(静默数据丢失,且无任何可观察痕迹)。
   * 现改为:① 返回结构化结果 `{ok, error?}` 给调用方; ② 失败时记进模块内可读状态
   * `lastPersistError`(经 `getLastPersistError()` 暴露),至少留下可观察痕迹。
   * 不引入任何新 import —— 本模块保持纯核心零依赖。
   * @returns {{ok:boolean, error?:string}}
   */
  let lastPersistError = null

  /**
   * ★#110（2026-09-22，用户拍板口径）：**保留上限 + 有序淘汰**。
   *
   * 背景：`snapshot({includeRevoked:true})` 会把**已撤销**的记录一起留在快照里 ⇒ facts.json 只增不减。
   * 用户口径（2026-09-22 原话要点）：默认上限 1000；以**更新**的为主；**撤销的优先清掉**；
   * 「有些比较老但是比较重要的」要再考虑 ⇒ 重要项**最后**才淘汰。
   *
   * 淘汰顺序（只在**超出上限**时才动手，且只删到刚好回到上限）：
   *   ① 不重要 且 已撤销（revokedAt/confirmedAt 最旧优先）
   *   ② 不重要 且 未撤销（confirmedAt 最旧优先）
   *   ③ 重要 且 已撤销
   *   ④ 重要 且 未撤销（最后手段；说明上限设得过低，`stats.pruneProtected` 会记下来）
   * 「重要」判据（只用**既有字段**，不新造状态）：`pinned === true` ／ `sourceClass === 'user-memory'`
   *   ／ `sourceKind === 'explicit'` ／ `confidence >= 0.8`。
   *
   * 不静默：每次淘汰记 `stats.pruned` / `stats.pruneProtected` / `lastPrune`（含被删条数与最旧时间），
   * 经 `getLastPrune()` 暴露给诊断面。上限取 `opts.config.maxFacts`，非法值回落 1000；`<= 0` 视为不限。
   */
  const maxFactsRaw = Number(opts.config && opts.config.maxFacts)
  const maxFacts = (Number.isFinite(maxFactsRaw) && maxFactsRaw >= 1) ? Math.floor(maxFactsRaw) : 1000
  let lastPrune = null
  const isImportantFact = (f) => !!f && (
    f.pinned === true ||
    f.sourceClass === 'user-memory' ||
    f.sourceKind === 'explicit' ||
    (typeof f.confidence === 'number' && Number.isFinite(f.confidence) && f.confidence >= 0.8)
  )
  function pruneIfNeeded() {
    if (!(maxFacts > 0) || facts.length <= maxFacts) return { pruned: 0 }
    const over = facts.length - maxFacts
    const rank = (f) => (isImportantFact(f) ? 2 : 0) + (f.revoked === true ? 0 : 1) // 0 先删 → 3 最后删
    const at = (f, k) => Number(f && f[k]) || 0
    // ★关键：同一毫秒写入的多条事实 `confirmedAt` **会完全相等**（实测：一个 tick 内 upsert 的
    //   三条 confirmedAt 全是同一个值）⇒ 只靠时间戳无法区分新旧，必须再用**数组下标**兜底。
    //   `facts` 数组本身就是按写入顺序追加的（最旧在前），因此下标升序 = 由旧到新。
    //   这一条替代了原先的 `factId.localeCompare` —— 那等于按哈希排序，等于随机删，
    //   会违背用户「以更新的为主」的口径（首版守卫当场抓到删了新的、留下旧的）。
    const seq = new Map()
    for (let i = 0; i < facts.length; i++) seq.set(facts[i].factId, i)
    const ordered = facts.slice().sort((a, b) => {
      const dr = rank(a) - rank(b)
      if (dr !== 0) return dr
      // 同类内：更旧的先删（撤销项用 revokedAt，其余用 confirmedAt）
      const ta = at(a, a.revoked === true ? 'revokedAt' : 'confirmedAt') || at(a, 'confirmedAt')
      const tb = at(b, b.revoked === true ? 'revokedAt' : 'confirmedAt') || at(b, 'confirmedAt')
      if (ta !== tb) return ta - tb
      return (seq.get(a.factId) || 0) - (seq.get(b.factId) || 0) // 时间戳打平时按下标（写入顺序）
    })
    const doomed = new Set(ordered.slice(0, over).map((f) => f.factId))
    const protectedCount = ordered.slice(0, over).filter(isImportantFact).length
    const oldest = ordered.slice(0, over).reduce((m, f) => {
      const t = at(f, f.revoked === true ? 'revokedAt' : 'confirmedAt') || at(f, 'confirmedAt')
      return (m === 0 || (t > 0 && t < m)) ? t : m
    }, 0)
    facts = facts.filter((f) => !doomed.has(f.factId))
    stats.pruned = (stats.pruned || 0) + doomed.size
    if (protectedCount) stats.pruneProtected = (stats.pruneProtected || 0) + protectedCount
    lastPrune = {
      pruned: doomed.size, protected: protectedCount, limit: maxFacts, over,
      oldestAt: oldest || null, at: nowFn(),
    }
    return { pruned: doomed.size }
  }

  function persist() {
    try {
      pruneIfNeeded() // ★#110：落盘前先按上限有序淘汰（只在超限时动手）
      io.save(snapshot({ includeRevoked: true }))
      lastPersistError = null
      return { ok: true }
    } catch (e) {
      const msg = (e && e.message) ? String(e.message) : String(e)
      lastPersistError = msg
      return { ok: false, error: msg }
    }
  }
  function snapshot(opts = {}) {
    const now = nowFn()
    return {
      schemaVersion: 1, namespace: 'dsh-auto-memory-pre', policyVersion: FACT_POLICY_VERSION,
      savedAt: now,
      // ★ P2-2 修复：快照同样不得与库内对象共享 provenance 数组引用
      //   (宿主读快照后 push 会改脏已入账记录)。
      facts: (opts.includeRevoked ? facts : facts.filter((f) => !f.revoked))
        .map(cloneFact),
      conflicts: conflicts.map((c) => ({
        ...c,
        left: c.left ? cloneFact(c.left) : c.left,
        right: c.right ? cloneFact(c.right) : c.right,
      })),
    }
  }
  /**
   * ★ A-3 修复(2026-09-21)：restore 按 **factId 去重**。
   * 旧实现无条件 `facts.push(v.fact)` ⇒ 磁盘上任何重复主键(facts.json 被并发写过、
   * 或旧版本曾产出重复记录)都会被原样装回内存,把上游 bug 的产物一路带进新进程。
   * 去重策略:**后到者胜**(保留后出现的记录) —— 与「快照按写入顺序追加、后者为更新状态」一致;
   * 同时保证父记录在数组中的**位置不变**(原地替换,不打乱既有顺序)。
   * 重复的 revoked 记录同理被覆盖,不额外保留副本(审计信息以磁盘原文为准)。
   */
  function restore(data) {
    if (!data || data.schemaVersion !== 1) return { ok: false, reason: 'bad-schema' }
    if (!Array.isArray(data.facts)) return { ok: false, reason: 'bad-facts' }
    const next = []
    const indexById = new Map()
    let duplicates = 0
    for (const f of data.facts) {
      const v = validateFactPre(f)
      if (!v.ok) continue // 坏记录跳过, 不整体失败(幂等恢复)
      // ★ B-4(2026-09-22)：旧快照没有 epistemicStatus —— 用与写入侧同一套默认规则 backfill,
      //   还原后**不留 undefined**(否则前端仍分不清「模型推断」与「用户明说」)。
      //   显式给了且合法的记录保持原值;非法值仍按上面的 fail-closed 跳过。
      //   回填走**浅拷贝**,不原地改调用方传进来的快照对象(validateFactPre 返回的就是同一个引用)。
      const fact = v.fact.epistemicStatus === undefined
        ? { ...v.fact, epistemicStatus: defaultEpistemicStatusPre(v.fact) }
        : v.fact
      const seenAt = indexById.get(fact.factId)
      if (seenAt !== undefined) {
        next[seenAt] = fact // 后到者胜:原地替换,不动顺序
        duplicates++
        continue
      }
      indexById.set(fact.factId, next.length)
      next.push(fact)
    }
    facts = next
    conflicts = Array.isArray(data.conflicts) ? data.conflicts.map((c) => ({ ...c })) : []
    return { ok: true, restored: facts.length, duplicates }
  }
  function clear() {
    facts = []; conflicts = []
    // ★ A-8：io.clear() 的失败同样不得静默 —— 落盘残留会在下次 load 时"复活"已删数据。
    let cleared = true, clearError
    try { io.clear() } catch (e) {
      cleared = false
      clearError = (e && e.message) ? String(e.message) : String(e)
    }
    // ★ issue #76-6c 修复（2026-09-19）：统计字段**全量归零**。
    //   旧实现只写 `stats.created = 0; stats.merged = 0; stats.superseded = 0`，
    //   漏掉 `upserts / conflictAdded / inferenceBlocked / expiredIgnored / revoked`
    //   ⇒ clear() 后这些计数残留（实测），诊断读数与实际不符。
    //   改为**按现有键遍历归零**，将来新增 stats 字段也不会再漏。
    for (const k of Object.keys(stats)) stats[k] = 0
    return clearError !== undefined ? { ok: true, cleared, error: clearError } : { ok: true, cleared }
  }
  function dispose(reason) {
    if (disposed) return { ok: true, persisted: true, alreadyDisposed: true }
    disposed = true
    // ★ A-8：dispose 是最后一次落盘机会，失败必须外显（旧实现空 catch ⇒ 静默丢弃全部未落盘状态）
    const r = persist()
    return { ok: r.ok, persisted: r.ok, ...(r.error ? { error: r.error } : {}) }
  }

  return {
    upsert, supersede, get, query, conflictsList, pendingConflicts, resolveConflict,
    evidenceFor, revokeBySource, snapshot, restore, clear, dispose,
    // ★ issue #76-5 修复（2026-09-19）：把**模块级**的 judgement-row 消费器挂进实例。
    //   旧实现 `memory-hub.js:81-84` 检查 `typeof stores.facts.factCandidateFromJudgementRow === 'function'`
    //   以决定是否委托——但该函数此前**只是模块级导出**（见上方 `export function`），
    //   不在 `createFactStorePre()` 的返回对象上 ⇒ **该分支恒假** ⇒ hub 恒走自己的本地副本
    //   `factCandidateFromRow`（丢掉 `ttl` 字段，实测同输入下 store 版 ttl=60000、hub 版无 ttl）
    //   ⇒ 两适配器从此各自演化。挂进实例后委托分支变为恒真，语义统一到 store 实现。
    factCandidateFromJudgementRow,
    getStats: () => ({ ...stats }),
    /** ★ B-3(2026-09-22)：最近一次被事实性判据拒绝的详情(code + 中文人话 + 被判文本 + 时间)或 null。
     *  与 stats.factness* 计数配套 —— 拒绝**必须留下可观察痕迹**,不得静默丢弃。 */
    getLastFactnessReject: () => (lastFactnessReject ? { ...lastFactnessReject } : null),
    /** ★ A-8：最近一次落盘失败(字符串)或 null —— 供宿主诊断"写盘失败但流程继续"的静默缺口。 */
    getLastPersistError: () => lastPersistError,
    /** ★#110(2026-09-22)：最近一次保留上限淘汰详情，或 null。`{pruned,protected,limit,over,oldestAt,at}`。
     *  `protected>0` 表示已轮到删「重要项」——说明上限设得过低，需要人工确认。 */
    getLastPrune: () => (lastPrune ? { ...lastPrune } : null),
    /** 当前生效的保留上限（<=0 表示不限）。 */
    retentionLimit: () => maxFacts,
    get size() { return facts.length },
    get conflictCount() { return conflicts.length },
  }
}

// ========== judgement-shadow 消费(输入侧适配器) ==========

/**
 * 把 judgement-shadow 行转成 FactCandidate。
 * 只接受 semantic_candidate / profile_candidate; 其他 kind 返回 null(忽略)。
 * suggestion=supersede_suggest → 调用方走 supersede, 否则走 upsert。
 */
export function factCandidateFromJudgementRow(row) {
  if (!row || typeof row !== 'object') return null
  const kind = row.kindCandidate
  if (kind !== 'semantic_candidate' && kind !== 'profile_candidate') return null
  const sourceIds = Array.isArray(row.sourceIds) ? row.sourceIds : []
  if (!sourceIds.length) return null
  const subject = String(row.subject || sourceIds[0] || '') // 行内无 subject 时用 sourceId 占位
  const predicate = String(row.predicate || 'relation')
  const object = row.object === undefined || row.object === null ? null : String(row.object)
  return {
    scope: row.scope === 'User' ? 'User' : 'Workspace',
    subject, predicate, object,
    sourceKind: 'inference',
    sourceClass: kind === 'profile_candidate' ? 'profile-candidate' : 'semantic-candidate',
    provenance: [...sourceIds],
    confidence: typeof row.confidence === 'number' ? row.confidence : null,
    ttl: typeof row.ttl === 'number' ? row.ttl : undefined,
    _suggestion: row.suggestion || 'keep_suggest',
  }
}

/**
 * 批量消费 judgement-shadow 行(幂等: 同 observationId 同 sourceIds 只处理一次)。
 * 返回每行的处理结果数组。
 */
export function ingestJudgementRows(store, rows, opts = {}) {
  const seen = new Set(opts.seenObservationIds || [])
  const out = []
  for (const row of rows) {
    const cand = factCandidateFromJudgementRow(row)
    if (!cand) { out.push({ skipped: true, reason: 'not-fact-kind' }); continue }
    const key = String(row.observationId || '') + '|' + (row.sourceIds || []).join(',')
    if (seen.has(key)) { out.push({ skipped: true, reason: 'duplicate' }); continue }
    seen.add(key)
    const r = cand._suggestion === 'supersede_suggest' ? store.supersede(cand) : store.upsert(cand)
    out.push({
      row: key, outcome: r.outcome, ok: r.ok, reason: r.reason || null,
      // ★ B-3(2026-09-22)：事实性拒绝要**带结构化原因向上透传**(code + 中文人话),
      //   调用方(宿主/诊断面)才能说明「为什么没入库、怎么改写」,而不是只看到 ok:false。
      ...(r.code ? { code: r.code } : {}),
      ...(r.message ? { message: r.message } : {}),
    })
  }
  return { results: out, seenObservationIds: [...seen] }
}
