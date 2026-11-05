/**
 * upgrade-estimate.js —— 整理体量/费用估算的**唯一实现**（★向导 P3；前端与后端共用）
 *
 * 【为什么独立成模块】费用公式一旦在路由、前端文案、文档三处各写一份，改一处必漏两处
 *  （项目规约：同一语义只允许一份判据）。前端直接 import 本模块算，不做二次实现。
 *
 * 【标定依据（可复算）】1.19 字符/token —— 锚点实测 58,360 字符 ≈ 49,000 token。
 *   输出占比按思考强度取档：low .15 / medium .25 / high .40（推理 token 按输出计费）。
 *   价格假设（元/百万 token，2026-11）：官方谷 1/4、官方峰 2/8、中转 0.09×全谷价 = 0.09/0.36。
 *   ★这些是**估算**，UI 必须写明"实际以账单为准"。
 */

/** 字符→token 的标定系数（越大越省，183 取 1.19 是实测锚点）。 */
export const CHARS_PER_TOKEN = 1.19;

/** 思考强度 → 输出/输入比。缺省 medium（用户裁定：low 在长提示词下可能不遵守格式）。 */
export const EFFORT_OUT_RATIO = Object.freeze({ low: 0.15, medium: 0.25, high: 0.4 });

/** 价格表（元/百万 token）。relay = 0.09 × 官方谷价。 */
export const UPGRADE_PRICES = Object.freeze({
  offPeak: Object.freeze({ in: 1, out: 4 }),
  peak: Object.freeze({ in: 2, out: 8 }),
  relay: Object.freeze({ in: 0.09, out: 0.36 }),
});

/** 免费渠道上下文上限（OpenCode 公开额度，256K）；扣 30% 提示/输出余量后才可用于正文。 */
export const OPENCODE_CONTEXT_TOKENS = 256000;
export const OPENCODE_USABLE_RATIO = 0.7;

/** 免费渠道单区可用字符数（约 21.3 万）。 */
export function opencodeUsableCharsPre() {
  return Math.floor((OPENCODE_CONTEXT_TOKENS * CHARS_PER_TOKEN) * OPENCODE_USABLE_RATIO);
}

/** 归一化强度：空值走默认 medium；未知值明确拒绝（不猜）。 */
export function normalizeEffortPre(effort) {
  const raw = effort == null ? '' : String(effort).trim().toLowerCase();
  if (!raw) return { ok: true, effort: 'medium' };
  if (Object.prototype.hasOwnProperty.call(EFFORT_OUT_RATIO, raw)) return { ok: true, effort: raw };
  return { ok: false, code: 'bad-effort', detail: { effort: String(effort), allowed: Object.keys(EFFORT_OUT_RATIO) } };
}

/** 字符数的合法性：NaN / 负数 / 非数字 ⇒ 拒绝（不静默当 0）。 */
export function normalizeCharsPre(chars) {
  if (typeof chars === 'number' && Number.isFinite(chars) && chars >= 0) return { ok: true, chars };
  if (typeof chars === 'string' && chars.trim() !== '' && Number.isFinite(Number(chars)) && Number(chars) >= 0) {
    return { ok: true, chars: Number(chars) };
  }
  return { ok: false, code: 'bad-chars', detail: { chars: String(chars) } };
}

/**
 * 单区/合计估算。
 * @param {{chars:number|string, effort?:string}} input
 * @returns {{ok:true,chars:number,effort:string,inTok:number,outTok:number,cost:{offPeak:number,peak:number,relay:number},fitsOpencode:boolean}|{ok:false,code:string,detail:object}}
 */
export function estimateUpgradeCostPre(input) {
  const o = input && typeof input === 'object' ? input : {}
  const c = normalizeCharsPre(o.chars)
  if (!c.ok) return c
  const e = normalizeEffortPre(o.effort)
  if (!e.ok) return e
  const inTok = c.chars / CHARS_PER_TOKEN
  const outTok = inTok * EFFORT_OUT_RATIO[e.effort]
  const costOf = (p) => (inTok / 1e6) * p.in + (outTok / 1e6) * p.out
  return {
    ok: true,
    chars: c.chars,
    effort: e.effort,
    inTok: Math.round(inTok),
    outTok: Math.round(outTok),
    cost: {
      offPeak: costOf(UPGRADE_PRICES.offPeak),
      peak: costOf(UPGRADE_PRICES.peak),
      relay: costOf(UPGRADE_PRICES.relay),
    },
    fitsOpencode: c.chars <= opencodeUsableCharsPre(),
  };
}

/**
 * 多区合计：逐区估算 + 汇总（前端第 3 页直接用它）。
 * @param {Array<{wsKey?:string, chars:number|string}>} rows
 * @param {string} [effort]
 */
export function estimateUpgradeTotalsPre(rows, effort) {
  const list = Array.isArray(rows) ? rows : []
  const perWorkspace = []
  let chars = 0, inTok = 0, outTok = 0
  const cost = { offPeak: 0, peak: 0, relay: 0 }
  for (const it of list) {
    const r = estimateUpgradeCostPre({ chars: it && it.chars, effort })
    if (!r.ok) return r
    perWorkspace.push({ wsKey: it && it.wsKey ? String(it.wsKey) : '', chars: r.chars, inTok: r.inTok, fitsOpencode: r.fitsOpencode })
    chars += r.chars; inTok += r.inTok; outTok += r.outTok
    cost.offPeak += r.cost.offPeak; cost.peak += r.cost.peak; cost.relay += r.cost.relay
  }
  return { ok: true, effort: normalizeEffortPre(effort).effort, count: perWorkspace.length, chars, inTok, outTok, cost, perWorkspace }
}

/** 估算耗时的低/高秒数（实测：每 10 万字符 40–70 秒）。 */
export function estimateUpgradeSecondsPre(chars) {
  const c = normalizeCharsPre(chars)
  if (!c.ok) return c
  const units = c.chars / 100000
  return { ok: true, low: Math.round(units * 40), high: Math.round(units * 70) }
}
