/** 上下文窗口解析(2.2.4,2026-09-08)。
 *
 * 背景:水位 = 当前上下文占用 / 模型窗口。占用取官方 tokenMeter(与聊天框 context ring 同源),
 * 窗口此前有三条来源:手动覆盖 > 官方 request/context 的 contextWindow > settings.yaml 解析 > fallback。
 * 实测发现两条路同时失效,导致窗口恒为 fallback 131072(真实模型 1M),水位被算成 150%+:
 *   1) 官方 request/context 只在会话早期追加(本会话 2999 个事件里仅 2 条),而旧代码只扫最近 256 条 → 永远扫不到;
 *   2) settings.yaml 的 llm-deepseek 段是 flow 风格 YAML(`{ models: [ { id: x, contextWindow: 1000000, ... } ] }`),
 *      旧解析器只认 block 风格(`- id: x` + 行尾纯数字),整段解析不出来。
 *
 * 本模块把「settings.yaml → 模型窗口映射」与「按 provider/model 选窗口」抽成纯函数,便于 smoke 覆盖。
 */

/**
 * 从 settings.yaml 文本解析 `模型 id → contextWindow` 映射。
 * 同时支持 block 风格(llm-pi-ai 那种 `- id: x` / `contextWindow: N`)与 flow 风格(llm-deepseek 那种 `id: x,` / `contextWindow: N,`)。
 * @param {string} text - settings.yaml 原文。
 * @returns {{byRoute:Record<string,number>,byModel:Record<string,number>}} byRoute 键为 provider/id,byModel 键为 id。
 */
export function parseModelWindowsPre(text) {
  const byRoute = {}
  const byModel = {}
  if (!text || typeof text !== 'string') return { byRoute, byModel }
  const lines = String(text).split(/\r?\n/)
  let currentProvider = ''
  let currentId = null
  for (const line of lines) {
    // provider 段(block 风格,2 空格缩进的裸键,如 `opencode-go:`);flow 风格段名同样以冒号结尾但缩进更深
    const pm = line.match(/^ {2}([A-Za-z0-9_.-]+):\s*$/)
    if (pm) { currentProvider = pm[1]; currentId = null; continue }
    // 模型 id:兼容 block(`- id: x`)与 flow(`id: x,`)两种写法,允许行尾逗号
    const im = line.match(/^\s*(?:-\s*)?id:\s*([A-Za-z0-9._:-]+?)\s*,?\s*$/)
    if (im) { currentId = im[1]; if (byModel[currentId] === undefined) byModel[currentId] = 0; continue }
    // 窗口:允许行尾逗号(flow 风格)
    const cm = line.match(/^\s*contextWindow:\s*([0-9]+)\s*,?\s*$/)
    if (cm && currentId) {
      const value = Number(cm[1])
      const route = currentProvider + '/' + currentId
      if (byRoute[route] === undefined) byRoute[route] = value
      if (!byModel[currentId]) byModel[currentId] = value
    }
  }
  return { byRoute, byModel }
}

/**
 * 按 provider/model 选窗口:先精确匹配 provider/model,再按 model 名全局兜底。
 * @param {{byRoute:Record<string,number>,byModel:Record<string,number>}} windows - parseModelWindowsPre 结果。
 * @param {string} provider - 路由 provider(可空)。
 * @param {string} model - 模型 id。
 * @returns {number} 窗口 token 数;未命中返回 0。
 */
export function pickWindowPre(windows, provider, model) {
  if (!windows || !model) return 0
  const byRoute = windows.byRoute || {}
  const byModel = windows.byModel || {}
  const exact = byRoute[(provider || '') + '/' + model]
  if (Number.isFinite(exact) && exact > 0) return exact
  const direct = byModel[model]
  if (Number.isFinite(direct) && direct > 0) return direct
  // 后缀兜底:路由 id 可能带 provider 前缀或版本后缀差异
  for (const route of Object.keys(byRoute)) {
    if (route.endsWith('/' + model) && byRoute[route] > 0) return byRoute[route]
  }
  for (const id of Object.keys(byModel)) {
    if (id.endsWith('-' + model) && byModel[id] > 0) return byModel[id]
  }
  return 0
}

/**
 * 从会话事件里取最近一条 request/context 的 contextWindow(路由权威值)。
 * 不限制扫描窗口:该事件只在请求头部变化时追加,长会话里往往只存在于开头。
 * @param {object[]} events - 会话事件数组。
 * @param {number} maxScan - 最多向前扫多少条(默认全部;设小值可限制开销)。
 * @returns {number} contextWindow;未找到返回 0。
 */
export function findOfficialContextWindowPre(events, maxScan = 0) {
  if (!Array.isArray(events) || !events.length) return 0
  const floor = maxScan > 0 ? Math.max(0, events.length - maxScan) : 0
  for (let i = events.length - 1; i >= floor; i--) {
    const ev = events[i]
    if (ev && ev.type === 'request/context') {
      const cw = Number(ev && ev.data && ev.data.contextWindow)
      return Number.isFinite(cw) && cw > 0 ? cw : 0
    }
  }
  return 0
}
