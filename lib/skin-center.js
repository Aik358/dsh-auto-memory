/**
 * 皮肤中心（skin-center）—— R23 · 12 卷《前端皮肤接口契约》的**纯逻辑实现**。
 *
 * 设计口径（逐条对应 12 卷，不自创第三解）：
 *  §3.2 `tokens` 键必须来自 §四公开清单；**未知键 ⇒ 忽略并记一条警告（不 fail）**
 *  §3.2 `schemaVersion` 目前只有 1；**未知版本 ⇒ 拒绝加载并回落默认**
 *  §3.3-1 `theme.json` 解析失败 ⇒ **整包回落默认** + 一条可关闭提示（含错误摘要）
 *  §3.3-2 单个 token 值非法 ⇒ **只忽略该 token**，其余照常生效并记警告
 *  §3.3-3 `skin.css` 含 `@import` 或 `url(http...)` ⇒ **整段拒绝**
 *  §二 优先级：团队主题 > 用户主题 > 内置主题；同层内**后者胜**
 *
 * 纪律：零 IO（调用方传内容进来）、零依赖、永不抛（fail-closed 是**返回值**不是异常）。
 */

/** 公开 token 清单（12 卷 §四逐字，**只增不改**）—— 这是承诺面。 */
export const SKIN_TOKEN_KEYS = Object.freeze([
  // §4.1 颜色 13
  'color.brand', 'color.brandWeak', 'color.team', 'color.ok', 'color.warn', 'color.err', 'color.info',
  'color.bg', 'color.surface', 'color.border', 'color.text', 'color.textSecondary', 'color.textTertiary',
  // §4.2 形状/阴影 5
  'radius.card', 'radius.button', 'radius.pill', 'shadow.card', 'shadow.popover',
  // §4.3 排版/尺度 12
  'font.family', 'font.mono', 'font.sizeH1', 'font.sizeH2', 'font.sizeBody', 'font.sizeCaption',
  'space.1', 'space.2', 'space.3', 'space.4', 'space.5', 'space.6',
  'layout.sidebarWidth', 'layout.maxContentWidth',
  // §4.4 动效 5
  'motion.durQuick', 'motion.durFast', 'motion.durSlow', 'motion.easeOut', 'motion.easePop',
  // §4.5 品牌资产 5
  'brand.logo', 'brand.name', 'brand.tagline', 'brand.quote', 'brand.footerStatus',
])

/** 当前契约版本（12 卷 §3.2：目前只有 1）。 */
export const SKIN_SCHEMA_VERSION = 1

/** 三种来源层级（12 卷 §二），优先级从低到高；数值大者胜。 */
export const SKIN_SOURCE_LAYERS = Object.freeze(['builtin', 'user', 'team'])

/** 各层默认落盘位置（12 卷 §二「加载位置」逐字；team 的 id 由调用方拼）。 */
export const SKIN_DIRS = Object.freeze({
  user: 'memory/skins',
  teamPrefix: 'memory/skins/team-',
})

const TOKEN_SET = (() => { const s = new Set(); for (const k of SKIN_TOKEN_KEYS) s.add(k); return s })()

function text(v) {
  if (v === null || v === undefined) return ''
  try { return String(v).trim() } catch (_) { return '' }
}

/** token 名是否在公开清单内（12 卷 §四承诺面）。 */
export function isPublicToken(key) { return TOKEN_SET.has(text(key)) }

/**
 * 值合法性（12 卷 §3.3-2 的判据）：只对**可判定类别**做检查，判定不了的一律放行。
 *   · 颜色类（color.*）与含 #hex/rgb()/hsl() 的值 ⇒ 校验 CSS 颜色形态
 *   · 其余（尺寸/字体/阴影/动效）⇒ 非空字符串即可（不假装能判定任意 CSS）
 * ★放行优先：宁可让浏览器忽略一个怪值，也不因过严校验把客户皮肤整包拒掉（fail-open 于值、fail-closed 于结构）。
 */
export function isAcceptableTokenValue(key, value) {
  const v = text(value)
  if (!v) return false
  const k = text(key)
  const looksColor = k.indexOf('color.') === 0 || /^#|^rgba?\(|^hsla?\(/.test(v)
  if (!looksColor) return true
  if (/^#[0-9a-fA-F]{3,8}$/.test(v)) return true
  if (/^rgba?\([^)]*\)$/.test(v)) return true
  if (/^hsla?\([^)]*\)$/.test(v)) return true
  // color-mix()/var() 等现代颜色函数：交给浏览器，放行
  if (/^(color-mix|var|light-dark|oklch|lab|lch)\(/.test(v)) return true
  return false
}

/** skin.css 安全性（12 卷 §3.3-3）：含 @import 或外链 url(http...) ⇒ 整段拒绝。 */
export function isCssSafe(css) {
  const s = text(css)
  if (!s) return { ok: true, reason: '' }
  if (/@import/i.test(s)) return { ok: false, reason: 'skin.css 含 @import —— 12 卷 §3.3-3 整段拒绝（防白屏依赖）' }
  if (/url\(\s*['\"]?\s*(https?:)?\/\//i.test(s)) return { ok: false, reason: 'skin.css 含外链 url(...) —— 12 卷 §3.3-3 整段拒绝（防数据外泄）' }
  return { ok: true, reason: '' }
}

/**
 * 校验并归一化一个 theme 包（12 卷 §3.2/§3.3）。**永不抛**。
 * @param {string} rawText  theme.json 原文（可空）
 * @param {object} [opts]   { css?: string, layer?: 'builtin'|'user'|'team', name?: string }
 * @returns {{ ok:boolean, accepted:boolean, theme:object|null, tokens:object, warnings:string[], errors:string[] }}
 *   ★ accepted=false ⇒ 调用方**必须回落默认皮肤**（整包拒），errors 即「可关闭提示」的摘要来源。
 */
export function resolveSkinTheme(rawText, opts) {
  const o = opts || {}
  const warnings = [];
  const errors = [];
  const layer = SKIN_SOURCE_LAYERS.indexOf(text(o.layer)) >= 0 ? text(o.layer) : 'builtin'
  const empty = { ok: false, accepted: false, theme: null, tokens: {}, warnings, errors, layer }

  // §3.3-1：解析失败 ⇒ 整包回落
  const s = text(rawText)
  if (!s) {
    warnings.push('theme.json 缺失 —— 走内置默认（不是错误）')
    return { ok: true, accepted: false, theme: null, tokens: {}, warnings, errors, layer, missing: true }
  }
  let theme = null
  try { theme = JSON.parse(s) } catch (e) {
    errors.push('theme.json 解析失败 ⇒ 整包回落默认 —— ' + String((e && e.message) || e))
    return empty
  }
  if (!theme || typeof theme !== 'object' || Array.isArray(theme)) {
    errors.push('theme.json 顶层不是对象 ⇒ 整包回落默认')
    return empty
  }

  // §3.2：schemaVersion 必须是已知版本，否则整包拒
  const sv = theme.schemaVersion
  if (sv !== SKIN_SCHEMA_VERSION) {
    errors.push('schemaVersion=' + JSON.stringify(sv) + ' 不是受支持版本（只有 ' + SKIN_SCHEMA_VERSION + '）⇒ 整包回落默认');
    return empty
  }

  // §3.2：name 必需且须符合 ^[a-z0-9-]{2,64}$；displayName 必需
  const name = text(theme.name)
  if (!/^[a-z0-9-]{2,64}$/.test(name)) {
    errors.push('name 非法（须 ^[a-z0-9-]{2,64}$，实为 ' + JSON.stringify(theme.name) + '）⇒ 整包回落默认');
    return empty
  }
  const displayName = text(theme.displayName)
  if (!displayName) {
    errors.push('displayName 缺失（§3.2 必需）⇒ 整包回落默认');
    return empty
  }

  // §3.3-3：skin.css 安全性 ⇒ 整段拒（只拒 CSS，不牵连 theme.json）
  const cssCheck = isCssSafe(o.css)
  if (!cssCheck.ok) errors.push(cssCheck.reason);

  // §3.2 + §3.3-2：逐 token 校验 —— 未知键忽略+警告；非法值只忽略该项
  const raw = theme.tokens && typeof theme.tokens === 'object' && !Array.isArray(theme.tokens) ? theme.tokens : {}
  const tokens = {}
  let unknownCount = 0;
  let badValueCount = 0;
  for (const k of Object.keys(raw)) {
    if (!isPublicToken(k)) { unknownCount++; continue }
    if (!isAcceptableTokenValue(k, raw[k])) { badValueCount++; warnings.push('token ' + k + ' 值非法，只忽略该项：' + JSON.stringify(raw[k])); continue }
    tokens[k] = raw[k];
  }
  if (unknownCount) warnings.push('忽略 ' + unknownCount + ' 个未知 token 键（§3.2：不 fail，只警告）');

  const flags = theme.flags && typeof theme.flags === 'object' && !Array.isArray(theme.flags) ? theme.flags : {}
  return {
    ok: true,
    accepted: true,
    theme: {
      schemaVersion: SKIN_SCHEMA_VERSION,
      name, displayName,
      author: text(theme.author),
      compatiblePlugin: text(theme.compatiblePlugin),
      extends: text(theme.extends) || 'default',
      layer,
      tokens, flags,
    },
    tokens, warnings, errors, layer,
    cssAccepted: cssCheck.ok,
    unknownCount, badValueCount,
  }
}

/**
 * 三层合成（12 卷 §二：团队 > 用户 > 内置；同层内后者胜）。
 * @param {Array<{layer:string, name:string, tokens:object}>} layers 任意顺序
 * @returns {{ tokens:object, sources:object, warnings:string[], conflict:boolean, conflictKeys:string[] }}
 *   ★ conflict 逐键判定（★#553）：仅当 user 与 team **定义了同一个 token** 才为 true；
 *     conflictKeys 给出被团队覆盖的用户 token 列表，提示文案方向与它一致；
 *     无键重叠（哪怕两层都参与合成）⇒ false，不产生覆盖提示。
 */
export function composeSkinTheme(layers) {
  const list = Array.isArray(layers) ? layers : []
  const rank = (l) => { const i = SKIN_SOURCE_LAYERS.indexOf(text(l && l.layer)); return i < 0 ? 0 : i }
  const order = list.map((l, i) => ({ l, i, r: rank(l) })).sort((a, b) => (a.r - b.r) || (a.i - b.i));
  const tokens = {};
  const sources = {};
  const warnings = [];
  for (const it of order) {
    const l = it.l || {};
    const t = l.tokens && typeof l.tokens === 'object' ? l.tokens : {};
    for (const k of Object.keys(t)) {
      if (tokens[k] !== undefined && sources[k] && sources[k] !== l.layer) {
        warnings.push('token ' + k + ' 被 ' + l.layer + ' 层（' + text(l.name) + '）覆盖了 ' + sources[k] + ' 层');
      }
      tokens[k] = t[k];
      sources[k] = text(l.layer) || 'builtin';
    }
  }
  // ★#553：conflict 不是「user/team 两层都用过」，而是「逐键实际重叠」。
  //   §二 团队优先 ⇒ user 定义、team 也定义的 key 会被团队覆盖；无键重叠即无冲突。
  const userKeys = new Set();
  const teamKeys = new Set();
  for (const it of list) {
    const l = it || {};
    const layer = text(l.layer);
    if (layer !== 'user' && layer !== 'team') continue
    const t = l.tokens && typeof l.tokens === 'object' ? l.tokens : {};
    const bucket = layer === 'user' ? userKeys : teamKeys;
    for (const k of Object.keys(t)) bucket.add(k);
  }
  const conflictKeys = [];
  for (const k of userKeys) { if (teamKeys.has(k)) conflictKeys.push(k) }
  const conflict = conflictKeys.length > 0;
  if (conflict) warnings.push('检测到团队主题覆盖用户主题的 ' + conflictKeys.length + ' 个 token（§二：提示但不禁止）：' + conflictKeys.join(', '));
  return { tokens, sources, warnings, conflict, conflictKeys };
}

/**
 * 槽位回显（23a）—— 把宿主 SKIN_ASSETS 表转成**可渲染的行**（key/文件名/深色/尺寸/状态/来源）。
 * @param {object} assets SKIN_ASSETS（宿主唯一真源；本函数不重复声明任何路径或尺寸）
 * @param {string[]} keys SKIN_ASSET_KEYS（宿主稳定顺序）
 */
export function buildSkinSlots(assets, keys) {
  const list = Array.isArray(keys) ? keys : []
  const table = assets && typeof assets === 'object' ? assets : {};
  return list.map((k) => {
    const e = table[k] || {};
    const file = text(e.file);
    const fileDark = text(e.fileDark);
    const size = Array.isArray(e.size) && e.size.length === 2 ? e.size : [];
    return {
      key: text(k),
      file, fileDark,
      hasDark: !!fileDark,
      size,
      status: text(e.status) || (file ? 'ready' : 'pending'),
      alt: text(e.alt),
      layer: 'builtin',
    };
  });
}

/** 是否可用（供状态栏一句话）：6 槽位全就绪 ⇒ usable=true。 */
export function skinCenterStatus(slots, warnings, errors) {
  const rows = Array.isArray(slots) ? slots : [];
  const ready = rows.filter((r) => r && r.status === 'ready' && r.file).length;
  return {
    total: rows.length,
    ready,
    usable: rows.length > 0 && ready === rows.length,
    warningCount: (Array.isArray(warnings) ? warnings : []).length,
    errorCount: (Array.isArray(errors) ? errors : []).length,
  };
}
