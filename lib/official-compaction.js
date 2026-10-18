/**
 * official-compaction.js —— 镜像官方压缩参数（唯一真源 · 零依赖）
 *
 * ## 为什么是「镜像」而不是「读取」（硬证据，2026-09-26 侦察）
 * 官方 `@deepseek-ai/dsh-compaction-basic@0.1.7-rc.2` 只导出 `BasicCompactionEngine`：
 *   · `resolveCompactSpec` 是**模块私有函数**，不在 exports 里；
 *   · 引擎 `static inject = ["llm","tokenMeter","sessions"]` —— **不暴露 compaction 服务名**；
 *   · 引擎实例上的 `this.config` 是解析后的策略，但插件拿不到实例句柄。
 * ⇒ 任何插件都**读不到**当前生效的 ratio/headroom，只能镜像。
 * 姊妹插件 `dsh-context@0.56.2` 的注释自证同一结论：
 *   "DSH does not publish the configured ratio to plugins/clients, so the reserve band mirrors the default"
 *
 * ## 官方公式（rc.2 `lib/index.js:128-132` 逐字）
 *   messageBudget  = W − O
 *   pressureBudget = (W − O) − B
 *   thresholdTokens = floor(min(W × ratio, pressureBudget))
 * 其中 W=contextWindow、O=该路由 maxTokens（预留输出）、B=headroomTokens。
 *
 * ## 本模块的职责
 * 从**客户机自己的 preset 文件**里把 ratio / headroomTokens 读出来（自适应：
 * 每个客户的模型、上下文窗口、max output 都不同），交给 index.js 按官方公式换算阈值。
 * 读不到就回落到官方默认值（0.8 / 65536）——**绝不抛错、绝不阻塞**。
 */
import fs from 'node:fs'
import path from 'node:path'

/** 官方默认值（rc.2 源码常量，`lib/index.js:15,63`）。 */
export const OFFICIAL_DEFAULT_RATIO = 0.8
export const OFFICIAL_DEFAULT_HEADROOM = 65536

/** 剥掉行内注释与首尾空白；整行注释返回 ''。 */
export function stripYamlCommentPre(line) {
  const s = String(line == null ? '' : line)
  const t = s.trim()
  if (t.startsWith('#')) return ''
  const i = s.indexOf(' #')
  const cut = i >= 0 ? s.slice(0, i) : s
  return cut.replace(/\s+$/, '')
}

/** 该行若形如 `key: value`，返回 {key, value}；否则 null。不做类型转换。 */
export function parseScalarLinePre(line) {
  const s = stripYamlCommentPre(line)
  if (!s) return null
  const m = s.match(/^\s*([A-Za-z_][\w-]*)\s*:\s*(.*)$/)
  if (!m) return null
  return { key: m[1], raw: m[2].trim(), indent: s.length - s.trimStart().length }
}

/** 按 YAML 语义把标量文本转成 JS 值（仅需 number/bool/string）。 */
export function coerceScalarPre(raw) {
  const v = String(raw == null ? '' : raw).trim().replace(/^['"]|['"]$/g, '')
  if (v === '') return ''
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v)
  if (v === 'true') return true
  if (v === 'false') return false
  return v
}

/**
 * 从一个 preset 的 `agent.cordis.yml` **文本**里提取 compaction-basic 的配置。
 * 纯函数（无 IO）⇒ 可单测。返回 `{ found, ratio, headroomTokens, maxTokens, modelPolicies, pluginId }`。
 *
 * 结构（本机实测，code preset L151-155）：
 *     - id: compaction-basic
 *       name: '@deepseek-ai/dsh-compaction-basic'
 *       config:
 *         thresholdRatio: 0.7
 * 注意 liangshen preset **没有 config 段**（走官方默认）——必须容忍。
 */
export function parseCompactionFromYamlPre(text) {
  const out = { found: false, ratio: null, headroomTokens: null, maxTokens: null, modelPolicies: [], pluginId: '' }
  const lines = String(text == null ? '' : text).split(/\r?\n/)

  let start = -1
  let idIndent = 0
  for (let i = 0; i < lines.length; i++) {
    const s = stripYamlCommentPre(lines[i])
    if (!s) continue
    const m = s.match(/^\s*-\s*id\s*:\s*(.+)$/)
    if (!m) continue
    const name = String(coerceScalarPre(m[1]))
    if (name === 'compaction-basic') {
      start = i
      idIndent = s.length - s.trimStart().length
      out.found = true
      break
    }
  }
  if (start < 0) return out

  // 向后扫到「下一个同级或更浅的 - 开头条目」为止，收集标量与 modelPolicies。
  let inPolicies = false
  let cur = null
  for (let i = start + 1; i < lines.length; i++) {
    const s = stripYamlCommentPre(lines[i])
    if (!s || !s.trim()) continue
    const indent = s.length - s.trimStart().length
    const isNewItem = /^\s*-\s+/.test(s)
    if (isNewItem && indent <= idIndent) break            // 下一个兄弟节点 ⇒ 本条目结束

    // name: '@deepseek-ai/dsh-compaction-basic' ⇒ 记录实际插件名
    if (/^\s*name\s*:/.test(s) && !out.pluginId) {
      const p = parseScalarLinePre(s)
      if (p) out.pluginId = String(coerceScalarPre(p.raw))
    }
    // modelPolicies 数组元素开始
    if (/^\s*modelPolicies\s*:/.test(s)) { inPolicies = true; continue }
    if (inPolicies && isNewItem) {
      cur = {}
      const inner = s.replace(/^\s*-\s+/, '')
      const p = parseScalarLinePre(inner)
      if (p) cur[p.key] = coerceScalarPre(p.raw)
      out.modelPolicies.push(cur)
      continue
    }
    if (inPolicies && cur) {
      const p = parseScalarLinePre(s)
      if (!p) continue
      if (indent <= idIndent) inPolicies = false        // 回到更浅层 ⇒ 数组结束
      else { cur[p.key] = coerceScalarPre(p.raw); continue }
    }
    const sc = parseScalarLinePre(s)
    if (!sc) continue
    if (sc.key === 'thresholdRatio' && out.ratio === null && typeof coerceScalarPre(sc.raw) === 'number') out.ratio = coerceScalarPre(sc.raw)
    else if (sc.key === 'headroomTokens' && out.headroomTokens === null && typeof coerceScalarPre(sc.raw) === 'number') out.headroomTokens = coerceScalarPre(sc.raw)
    else if (sc.key === 'maxTokens' && out.maxTokens === null && typeof coerceScalarPre(sc.raw) === 'number') out.maxTokens = coerceScalarPre(sc.raw)
  }
  // 丢弃解析不完整的策略项
  out.modelPolicies = out.modelPolicies.filter((p) => p && (p.provider || p.model))
  return out
}

/** 扫 `~/.dsh/.agent-presets/<preset>/agent.cordis.yml`，返回每个 preset 的提取结果。失败一律静默跳过。 */
export function scanPresetCompactionsPre(dshHome) {
  const out = []
  try {
    const base = path.join(String(dshHome || ''), '.agent-presets')
    if (!fs.existsSync(base)) return out
    for (const e of fs.readdirSync(base, { withFileTypes: true })) {
      if (!e.isDirectory()) continue
      const p = path.join(base, e.name, 'agent.cordis.yml')
      try {
        if (!fs.existsSync(p)) continue
        const parsed = parseCompactionFromYamlPre(fs.readFileSync(p, 'utf8'))
        if (parsed.found) out.push(Object.assign({ preset: e.name, file: p }, parsed))
      } catch (_) { /* 单个 preset 坏掉不影响其它 */ }
    }
  } catch (_) { /* 目录不可读 ⇒ 返回空，上层回落官方默认 */ }
  return out
}

/* ── #429（A09）：官方缺省字段的**字段级继承链** ────────────────────────────────
 *
 * 官方语义是「policy 字段 > 该 preset 的全局值 > 官方默认」，但旧实现只在
 * 「无精确 modelPolicy」分支才读 preset 全局值；一旦命中 modelPolicy，缺省字段直接
 * 变 null ⇒ 最终被压成官方默认 ⇒ **preset 显式声明的全局值被静默丢弃**。
 * 实测：两 preset 都写 thresholdRatio:0.7、preset 全局 headroomTokens:32768（ratio 走官方
 * 默认 0.8）⇒ 旧实现给 headroom=65536（应为 32768）。
 *
 * 缺陷 #2（同函数）：歧义判据把 ratio 与 headroom 两组值倒进**同一个集合**做并集，
 * 于是「两字段各自都相同」的配置也被判歧义：{ratio:[0.7,0.7], heads:[32768,32768]} 的并集
 * 是 {0.7,32768} ⇒ size=2 ⇒ ambiguous=true（实为同一份策略）。判据必须是**元组等值**。
 */
const isRatioPre = (v) => typeof v === 'number' && v > 0 && v <= 1
const isHeadroomPre = (v) => typeof v === 'number' && v >= 0

/** 归一化 ratio：非法/缺省 ⇒ 官方默认。 */
function normRatioPre(v) {
  return isRatioPre(v) ? v : OFFICIAL_DEFAULT_RATIO
}

/** 归一化 headroomTokens：非法/缺省 ⇒ 官方默认。 */
function normHeadroomPre(v) {
  return isHeadroomPre(v) ? v : OFFICIAL_DEFAULT_HEADROOM
}

/**
 * 字段级继承：policy 自己的字段 > 所属 preset 的全局值 > 官方默认。
 * **每个字段独立取值**（官方是按字段合并，不是整条策略二选一）。
 * @param {object} pol - modelPolicies 里命中的那条策略。
 * @param {object} preset - 该策略所属的 preset 扫描结果（可为空 ⇒ 只有官方默认）。
 * @returns {{ratio:number, headroomTokens:number}} 已归一化的生效值。
 */
export function inheritFieldPre(pol, preset) {
  const p = (pol && typeof pol === 'object') ? pol : {}
  const s = (preset && typeof preset === 'object') ? preset : {}
  return {
    ratio: normRatioPre(isRatioPre(p.thresholdRatio) ? p.thresholdRatio : s.ratio),
    headroomTokens: normHeadroomPre(isHeadroomPre(p.headroomTokens) ? p.headroomTokens : s.headroomTokens),
  }
}

/**
 * 按当前会话的 provider/model 选定生效参数。
 * 优先级（照抄官方语义）：**精确 modelPolicies 覆盖 > 该 preset 的全局值 > 官方默认**（逐字段继承）。
 * 多个 preset 都命中且**生效元组**不一致时取**最紧的**（最小 ratio / 最小 headroom ⇒ 最早提示，
 * 保守方向），并在 `ambiguous:true` 里如实标注——因为「当前激活哪个 preset」在客户机上没有
 * 全局登记处，无法唯一判定。
 *
 * ★#429：`ambiguous` 与 `source` 都按 **(ratio, headroomTokens) 元组**判定，不再按单字段。
 *   旧实现两处都是「拼接后的集合大小 > 1」/「只看 ratio 命中」，前者把两字段的**交叉积**当歧义
 *   （相同配置也报 ambiguous），后者可能把 headroom 不同的那个 candidate 的 source 报出来。
 * ★保留「各字段独立取最小」的取值方向不变（既有语义，本次不动）。
 */
export function pickOfficialParamsPre(scanned, provider, model) {
  const list = Array.isArray(scanned) ? scanned : []
  const P = String(provider || '')
  const M = String(model || '')
  const exact = []
  for (const s of list) {
    for (const pol of (s.modelPolicies || [])) {
      if (!pol) continue
      if (String(pol.provider || '') === P && String(pol.model || '') === M) exact.push({ src: s.preset, pol, preset: s })
    }
  }
  const cand = []
  const push = (o) => { if (o) cand.push(o) }
  if (exact.length) {
    // 官方对同一 target 拒绝重复策略 ⇒ 正常情况下 exact 至多 1 条。
    // ★#429：命中 policy 时仍要带出**所属 preset 的全局值**，供缺省字段继承（改点 1）。
    for (const e of exact) {
      const inh = inheritFieldPre(e.pol, e.preset)
      push({ ratio: inh.ratio, headroomTokens: inh.headroomTokens, source: 'modelPolicy:' + e.src })
    }
  } else {
    for (const s of list) {
      const inh = inheritFieldPre(null, s)
      push({ ratio: inh.ratio, headroomTokens: inh.headroomTokens, source: 'preset:' + s.preset })
    }
  }
  if (!cand.length) {
    return { ratio: OFFICIAL_DEFAULT_RATIO, headroomTokens: OFFICIAL_DEFAULT_HEADROOM, source: 'official-default', ambiguous: false }
  }
  // ★#429：cand 里的 ratio/headroomTokens 已由 inheritFieldPre 归一化（恒为合法数），
  // 故这里的 min 与元组判据共用同一份值，不会再出现「判据用归一化值、source 用原值」的漂移。
  const ratio = Math.min(...cand.map((c) => c.ratio))
  const headroomTokens = Math.min(...cand.map((c) => c.headroomTokens))
  const tupleOf = (c) => String(c.ratio) + '|' + String(c.headroomTokens)
  const distinct = new Set(cand.map(tupleOf))            // ← 元组等值，不是两字段并集
  const multi = cand.length > 1
  // source 同样按元组命中（不是只看 ratio）：取「与最终生效元组完全一致」的第一个候选。
  const targetTuple = String(ratio) + '|' + String(headroomTokens)
  const srcHit = cand.find((c) => tupleOf(c) === targetTuple)
  const src = srcHit ? srcHit.source : cand[0].source
  return { ratio, headroomTokens, source: src, ambiguous: multi && distinct.size > 1, candidates: cand.length }
}