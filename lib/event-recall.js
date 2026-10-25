/**
 * lib/event-recall.js —— v4-H9：事件入检索（把事件当一种记忆条目）。
 *
 * ★为什么需要这个模块：
 *   `scope='events'` 早已存在（批次 D，独立通道），但它**永不并入 all** ⇒
 *   实测对比（同一查询）：
 *     · `all`    → 10,592 字，事件命中 **0 条**
 *     · `events` →    729 字，事件命中 **1 条**
 *   ⇒ 事件库现在「完全无法通过 all 检索到」。H9 补这一路。
 *
 * ★核心设计（Lead 2026-10-25 批准）——**把事件当 l0Corpus 条目注入**，而不是在 all 末尾 append 独立段：
 *   ① **共享 limit** ⇒ 输出不无界膨胀（结构上成立，不靠纪律）
 *   ② **格式归一零成本** ⇒ 复用现成的 L0 渲染行，不引入第二套格式
 *   ③ **排序统一** ⇒ 事件与散条目同池竞争，finalRank 口径一致
 *   ④ **聚合天然成立** ⇒ 一个事件只 push 一条（id=eventId），同一 id 不可能重复
 *   ⑤ `_recallStats.observe(l0Top)` 自动把事件计入召回统计，不用另做埋点
 *
 * ★★layer 必须用 'log' 而不是 'event'（Lead 实测定，我复核同意）：
 *   `lib/l0-extract.js:101` `L0_LAYERS` 是**闭合词表** ['user','project','log','reflection','whiteboard']，
 *   而 `classifyLayerPre` 对不在词表的值**返回 null**（不是原样返回）⇒
 *   写 `layer:'event'` 会被 groupL0 归到「未分层」组，且 `L0_LAYER_LABELS_PRE_V1['event']` 不存在
 *   ⇒ 组标题显示裸 `event` 而非中文。
 *   ⇒ **用已有层 'log' + `label: '事件 · <name>'`**：零契约改动，且模型能从 label 与 evt_ id 区分。
 *   判据：`L0_LAYERS` / `KNOWN_LAYERS` 这类闭合词表是契约，扩容要单独批次；
 *         能用「已有层 + 明确 label」表达的，不要扩容词表。
 *
 * ★零依赖设计：本模块**不 import 任何东西**（recallPassagesPre 由调用方注入），
 *   以便纯函数可测、且不在 index.js 的源码抽取沙箱里引入新依赖。
 */

/** 事件可检索文本的构造（逐字搬自 index.js 原 events 分支的 textOfEventPre）。 */
export function textOfEventPre(ev) {
  const L = []
  const nm = String((ev && ev.name) || '(未命名)')
  // 标题重复一次 = 天然加权（recallPassagesPre 按行打分，重复即加权，不需要改打分器）
  L.push('# ' + nm)
  if (ev && ev.summary) L.push(String(ev.summary))
  const sec = (ev && ev.sections) || {}
  for (const [k, label] of [['goal', '目标'], ['doing', '进行中'], ['deadend', '失败与弯路'], ['next', '下一步']]) {
    const body = String(sec[k] == null ? '' : sec[k]).trim()
    if (body) L.push('## ' + label + '\n' + body)
  }
  if (ev && Array.isArray(ev.checkpoints)) {
    for (const c of ev.checkpoints) {
      const t = String((c && c.text) || '').trim()
      if (t) L.push('- [' + String((c && c.kind) || 'log') + '] ' + t)
    }
  }
  if (ev && ev.outcome) L.push('## 成果\n' + String(ev.outcome))
  // ══════════════════════════════════════════════════════════════════════════════════
  // ★★task-34（2026-10-25）：**补 C3 漏掉的 percept 四类块**。
  //
  //   缺陷：textOfEventPre 有两份实现，C3 只改了 lib/index.js 内联版（scope='events'），
  //   漏了本文件（scope='all' 经 collectEventHitsPre 用）⇒ 同一个词两条检索路径结果不一致。
  //
  //   ★纪律：本段必须与 lib/index.js 内联版 **逐字相同**（除缩进与 L2→L 变量名适配）。
  //   守卫：smoke-test-task34-textofevent-parity 的 T34-c（逐字比对）+ T34-g（防半修抽取比对）。
  //
  //   下面三条实现纪律**原样保留**（逐字搬，不许改写）：
  //     ① 零字节纪律：某类为空 ⇒ 连标题都不出（不产生空段噪声）。
  //     ② 条数上限：单事件语料不能爆炸（每类最多 20 条，超出显式标「…共 N 条」）。
  //     ③ 带语义标注：percept 的 stage / commitment 的 state 是判据（只有 accepted/used 进画像），
  //        不带标注的原文在召回里无法区分「用户确认过的偏好」与「只是被提到」。
  // ══════════════════════════════════════════════════════════════════════════════════
  const PERCEPT_LIMIT = 20
  const pushPerceptBlock = (arr, title, fmt) => {
    if (!Array.isArray(arr) || !arr.length) return
    const items = []
    for (const it of arr) {
      if (items.length >= PERCEPT_LIMIT) break
      const line = fmt(it)
      const t = String(line == null ? '' : line).trim()
      if (t) items.push('- ' + t)
    }
    if (!items.length) return
    const extra = arr.length > items.length ? '\n（…共 ' + arr.length + ' 条，此处列前 ' + items.length + ' 条）' : ''
    L.push('## ' + title + '\n' + items.join('\n') + extra)
  }
  // ① 人类侧观察（userPercept）：stage 是**判据**（只有 accepted/used 进画像段）
  pushPerceptBlock(ev.userPercept, '人类侧观察', (p) => {
    if (!p || typeof p !== 'object') return ''
    const stage = String(p.stage || '').trim()
    const kind = String(p.kind || '').trim()
    const text = String(p.text || '').trim()
    if (!text) return ''
    const meta = [stage ? 'stage=' + stage : '', kind ? 'kind=' + kind : ''].filter(Boolean).join(' ')
    return (meta ? '[' + meta + '] ' : '') + text
  })
  // ② Agent 轨迹（agentTrace）：我做了什么、结果如何、是否被推翻
  pushPerceptBlock(ev.agentTrace, 'Agent 轨迹', (a) => {
    if (!a || typeof a !== 'object') return ''
    const action = String(a.action || '').trim()
    const result = String(a.result || '').trim()
    if (!action && !result) return ''
    const refuted = a.wasRefuted === true ? ' [已被推翻]' : ''
    return (action || '(未记动作)') + (result ? ' → ' + result : '') + refuted
  })
  // ③ 共识（sharedGround）：已达成的共识、谁确认的、有无纠正
  pushPerceptBlock(ev.sharedGround, '共识', (g) => {
    if (!g || typeof g !== 'object') return ''
    const claim = String(g.claim || '').trim()
    if (!claim) return ''
    const by = String(g.confirmedBy || '').trim()
    const corr = String(g.correction || '').trim()
    return claim + (by ? '（' + by + ' 确认）' : '') + (corr ? '｜纠正: ' + corr : '')
  })
  // ④ 约定（commitments）：承诺、边界、状态
  pushPerceptBlock(ev.commitments, '约定', (c) => {
    if (!c || typeof c !== 'object') return ''
    const promise = String(c.promise || '').trim()
    if (!promise) return ''
    const boundary = String(c.boundary || '').trim()
    const state = String(c.state || '').trim()
    return promise + (boundary ? '（边界: ' + boundary + '）' : '') + (state ? ' [' + state + ']' : '')
  })
  return L.join('\n')
}

/**
 * 收集事件命中。
 *
 * @param {Array<object>} events 事件数组
 * @param {string[]} terms 词项
 * @param {Function} recallPassagesPre 注入的打分器（签名照抄 lib/recall-passages.js:15）
 * @param {object} [opts] { full?: boolean }
 * @returns {{ hits: Array, readFailures: string[] }}
 *   hits = [{ ev, passages, score }]，按 score 降序（同分按 updatedAt 降序）
 */
export function collectEventHitsPre(events, terms, recallPassagesPre, opts = {}) {
  const evs = Array.isArray(events) ? events : []
  const hits = []
  const readFailures = []
  if (!evs.length || typeof recallPassagesPre !== 'function') return { hits, readFailures }
  const full = !!(opts && opts.full)
  for (const ev of evs) {
    const body = textOfEventPre(ev)
    let matched = []
    try {
      matched = recallPassagesPre(body, terms, 'event://' + String((ev && ev.id) || ''), full)
    } catch (e) {
      readFailures.push(String((ev && ev.id) || '') + ': ' + String((e && e.message) || e))
      continue
    }
    if (!matched.length) continue
    matched.sort((a, c2) => c2.score - a.score)
    hits.push({ ev, passages: matched, score: matched.reduce((acc, m) => acc + (Number(m.score) || 0), 0) })
  }
  hits.sort((a, b) => (b.score - a.score) || ((Number(b.ev && b.ev.updatedAt) || 0) - (Number(a.ev && a.ev.updatedAt) || 0)))
  return { hits, readFailures }
}

/**
 * 把一个事件命中转成 l0Corpus 条目（供 all 分支注入）。
 *
 * ★聚合保证：**一个事件只产出一条**，`id = 事件 id` ⇒ 同一 eventId 在同一份 l0Corpus 里不可能重复。
 *   （若实现写错成「每条检查点 push 一条」，就会出多条 ⇒ 由套件断言「该 eventId 只出现 1 次」守住。）
 *
 * @param {object} hit collectEventHitsPre 的 hits 元素
 * @returns {object} l0Corpus 条目形状
 */
export function eventToL0CorpusPre(hit) {
  const ev = (hit && hit.ev) || {}
  const evId = String(ev.id || '')
  const name = String(ev.name || '(未命名)')
  // searchText = 完整可检索文本（用于再次判定命中词）；l0 = 事件名（用于显示摘要）
  const searchText = textOfEventPre(ev)
  const firstPassage = (hit && Array.isArray(hit.passages) && hit.passages[0]) || null
  return {
    id: evId,
    l0: name.length > 60 ? name.slice(0, 59) + '\u2026' : name,
    searchText,
    // ★layer 用 'log'（已有层，不扩契约词表）；靠 label 区分
    label: '事件 · ' + name,
    layer: 'log',
    status: 'current',
    mark: '',
    matchedExcerpt: firstPassage ? String(firstPassage.line || '') : '',
    // 词法命中数交给调用方统一计算（与散条目同口径）
  }
}

export default { textOfEventPre, collectEventHitsPre, eventToL0CorpusPre }
