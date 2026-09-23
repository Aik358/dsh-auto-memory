/**
 * rerank-host-pre —— P4 精排多级档位 + 有界异步窗口(2026-09-16, rerank_host_pre_v1)。
 *
 * 权威依据: MASTER-PLAN-3.0.md §Phase 4 (H2 按实测重写) + TODO-GRAPH V2-P4 卡。
 * 实测推翻方案假设(留痕): bge-reranker-v2-m3 P95 37.4 秒(50 对/题, RSS 3.84GB);
 *   qwen3-reranker-0.6b P95 8.8 秒(小样本探针 10 对/题, RSS 4.95GB, 不可与 bge 直接比);
 *   收益真实: recall@1 0.739 → 0.898(bge); cross-encoder 模型已下载; 真实缺口 = GPU 版 torch
 *   (torch 2.13.0+cpu)与快档量化产物。⇒ 精排不得同步等待, 只能走**有界异步窗口**。
 *
 * 设计(卡内 v2 修正, 逐条对应):
 *  - 多级档位(用户裁定): 'off' | 'fast'(int8+CPU, 未就绪=不可用) | 'enthusiast'(完整模型+GPU)。
 *    档位只决定"是否允许排精排任务", 一期本地无 GPU torch / 无量化产物 ⇒ fast/enthusiast 均
 *    fail closed 降级为粗排(绝不阻塞前台、绝不发出模型请求)。
 *  - 一分钟 = 有界后台窗口: 从**入队时**起算含排队与计算, **到期不续命**; 本轮立即用现有排序;
 *    后台完成只进有界结果缓存, 不改本轮 envelope、不再次 emit; 下一请求重新生成 requestKey,
 *    仅 inputKey 完全匹配才复用, 且重跑当轮检查; 没有下一轮就过期, 不主动制造模型请求。
 *  - 运行隔离: 精排必须走独立懒加载 worker 角色(注入 opts.rerankFn), 不得占用稠密/索引 worker;
 *    全机最多一个精排任务在跑(busy 门), 忙时继续粗排。
 *  - 资源门 T5-5R: 任务超清理宽限未被取消/完成 ⇒ 调 opts.killFn 终止并释放; 期间稠密查询照常。
 *  - T5-6R: 本模块不产出任何"异步注入收益"口径 — 结果只进缓存; 零复用就是零复用。
 *
 * 纯主机侧状态机, 模型调用经 opts.rerankFn 注入(测试可控), 零 fs/零网络。
 */

export const RERANK_HOST_VERSION = 'rerank_host_pre_v1'

/** 有界异步窗口: 从入队起算(毫秒), 含排队与计算; 到期不续命。 */
export const RERANK_WINDOW_MS_PRE_V1 = 60000
/** 登记的清理宽限: 超窗后仍允许 killFn 在此宽限内终止进程。 */
export const RERANK_KILL_GRACE_MS_PRE_V1 = 5000
/** 缓存上限(条): 有界结果缓存, LRU 逐出。 */
export const RERANK_CACHE_MAX_PRE_V1 = 16

/** 档位解析: 'off'/'fast'/'enthusiast' 之外一律按 off(fail closed)。 */
export function resolveRerankTierPre(raw) {
  const s = String(raw || '').toLowerCase()
  if (s === 'fast' || s === 'enthusiast') return { tier: s, active: false, reason: 'tier-not-provisioned' }
  if (s === 'off') return { tier: 'off', active: false, reason: 'tier-off' }
  return { tier: 'off', active: false, reason: 'invalid-tier' }
}

/**
 * inputKey: 精排复用的完全匹配键 — 查询 + 排序输入 + miv 的规范化哈希。
 * 任一身份字段变化 ⇒ 键不同 ⇒ 不复用(T5-3R)。
 */
export function computeRerankInputKeyPre({ query, orderedIds, memoryIndexVersion }) {
  return sha256Hex(JSON.stringify([String(query || ''), JSON.stringify(Array.isArray(orderedIds) ? orderedIds.map(String) : []), String(memoryIndexVersion || '')]))
}

function sha256Hex(s) {
  // 纯 JS sha256 避免引入 node:crypto 依赖面 — 复用 djb2 式双哈希足够做键(非安全用途),
  // 但为确定性可审计, 用 FNV-1a 64 位两次盐化。
  let h1 = 0x811c9dc5, h2 = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    h1 = ((h1 ^ c) * 0x01000193) >>> 0
    h2 = ((h2 ^ (c + i)) * 0x01000193) >>> 0
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0')
}

/**
 * 创建精排主机(每引擎一份)。
 * opts: {
 *   tier: 'off'|'fast'|'enthusiast',
 *   now?: () => ms(测试可注入),
 *   rerankFn?: async ({query, ordered}) => number[]  // 独立 worker 角色; 懒加载由调用方注入
 *   killFn?: () => void                               // T5-5R: 终止精排进程并释放
 * }
 */
export function createRerankHostPre(opts = {}) {
  const now = typeof opts.now === 'function' ? opts.now : () => Date.now()
  const resolved = resolveRerankTierPre(opts.tier)
  const stats = { enqueued: 0, reused: 0, expiredDrops: 0, killed: 0, completed: 0, busyRejects: 0, tierRejects: 0 }
  /** Map<inputKey, {at, scores}> — 有界结果缓存(只缓存, 不推送)。 */
  const cache = new Map()
  let running = null // {inputKey, startedAt, done}

  function pruneExpired() {
    const t = now()
    for (const [k, v] of cache) {
      if (t - v.at > RERANK_WINDOW_MS_PRE_V1) { cache.delete(k); stats.expiredDrops++ }
    }
  }

  /**
   * 请求一次精排机会(每轮 recall 调用一次)。
   * 返回 {mode, scores?, reason?}:
   *   mode='reuse'  — 缓存命中(窗口内 + inputKey 完全匹配); 调用方把 scores 并进本轮展示。
   *   mode='skip'   — 档位关/未就绪/无 worker/忙/无下一轮价值 ⇒ 本轮粗排, 不发模型请求。
   *   mode='accepted' — 已入队(有界异步窗口起算); 本轮立即返回(粗排序不变)。
   * **本轮同步路径绝不等待精排**(T5-3R: 前台先返回, 后台完成只进缓存)。
   */
  function offerRerankPre({ query, orderedIds, memoryIndexVersion, requestKey }) {
    pruneExpired()
    const tier = resolveRerankTierPre(opts.tier)
    if (tier.tier === 'off') { stats.tierRejects++; return { mode: 'skip', reason: 'tier-off' } }
    // fast/enthusiast 的可用性由"是否注入了独立 worker"决定(运行隔离: rerankFn 即懒加载 worker 角色)。
    // 环境未供给(GPU torch 缺/量化产物缺) ⇒ 调用方不注入 rerankFn ⇒ 这里 fail closed 走粗排。
    if (typeof opts.rerankFn !== 'function') { stats.tierRejects++; return { mode: 'skip', reason: 'no-worker' } }
    const inputKey = computeRerankInputKeyPre({ query, orderedIds, memoryIndexVersion })
    const hit = cache.get(inputKey)
    if (hit && now() - hit.at <= RERANK_WINDOW_MS_PRE_V1) {
      // T5-4R: 复用前调用方必须重跑当轮状态/fv2/冷却/预算检查 — 本模块只担保 inputKey 完全匹配。
      stats.reused++
      return { mode: 'reuse', scores: hit.scores, inputKey }
    }
    if (running) { stats.busyRejects++; return { mode: 'skip', reason: 'busy', inputKey } }
    // 入队: 一期全机最多一个精排任务; 有界窗口从入队起算, 到期不续命。
    stats.enqueued++
    const startedAt = now()
    const job = { inputKey, startedAt, requestKey: String(requestKey || '') }
    running = job
    Promise.resolve()
      .then(() => opts.rerankFn({ query, ordered: Array.isArray(orderedIds) ? orderedIds.map(String) : [] }))
      .then((scores) => {
        // 到期不续命: 完成时已超窗 ⇒ 丢弃(没有下一轮就过期, 不制造请求)。
        if (now() - startedAt > RERANK_WINDOW_MS_PRE_V1) { stats.expiredDrops++; return }
        // 缓存条目记入队时刻(卡内口径: 窗口从入队起算, 不是完成时刻 — 否则慢计算等于续命)。
        cache.set(inputKey, { at: startedAt, scores: Array.isArray(scores) ? scores : [] })
        if (cache.size > RERANK_CACHE_MAX_PRE_V1) {
          const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)[0]
          if (oldest) cache.delete(oldest[0])
        }
        stats.completed++
      })
      .catch(() => { /* fail soft: 精排失败不影响粗排 */ })
      .finally(() => { if (running === job) running = null })
    return { mode: 'accepted', inputKey }
  }

  /**
   * T5-5R: 精排忽略取消/卡死 ⇒ 调用方在登记的清理宽限内调用; 终止进程并释放占用。
   * 返回 {killed:boolean}。稠密查询与本主机其余路径不受影响。
   */
  function killRunningRerankPre() {
    if (!running) return { killed: false }
    running = null
    stats.killed++
    try { if (typeof opts.killFn === 'function') opts.killFn() } catch (_) {}
    return { killed: true }
  }

  /** 是否存在超窗未完成的运行任务(调用方据此在宽限内 kill)。 */
  function isRunningBeyondWindowPre() {
    return !!(running && now() - running.startedAt > RERANK_WINDOW_MS_PRE_V1 + RERANK_KILL_GRACE_MS_PRE_V1)
  }

  function debugView() {
    pruneExpired()
    return {
      version: RERANK_HOST_VERSION, tier: resolved.tier, active: resolved.active,
      running: running ? { inputKey: running.inputKey, elapsedMs: now() - running.startedAt, beyondWindow: isRunningBeyondWindowPre() } : null,
      cacheSize: cache.size, stats,
      windowMs: RERANK_WINDOW_MS_PRE_V1, killGraceMs: RERANK_KILL_GRACE_MS_PRE_V1,
    }
  }

  return { offerRerankPre, killRunningRerankPre, isRunningBeyondWindowPre, debugView }
}
