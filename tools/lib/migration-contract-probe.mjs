/**
 * 未来版本契约 / 结构探测（不绑 commit SHA、不绑 version 字符串）
 *
 * 设计原则：能从源码「看出」后端要什么字段、客户端长什么样，而不是
 * 假设「alpha.6 长这样」。看不懂就如实报漂移，绝不猜、绝不静默放行。
 * 供 apply-migration-optin.mjs 与 smoke-test-migration-optin-compat.mjs 共用。
 */
export function normalize(src) {
  return String(src || '').replace(/\r\n/g, '\n')
}

/** 后端契约：确认字段名 + 是否仍需要显式确认。 */
export function detectBackendContract({ indexSrc = '', packSrc = '' } = {}) {
  const ix = normalize(indexSrc)
  const pk = normalize(packSrc)
  const out = { field: null, required: true, sources: [], drift: [] }

  // ① 主形态（alpha.6 实测）：name: !!(body && body.name === true)
  const primary = /([A-Za-z_$][A-Za-z0-9_$]*)\s*:\s*!!\(\s*body\s*&&\s*body\.\1\s*===\s*true\s*\)/g
  const names = new Set()
  for (const m of ix.matchAll(primary)) { names.add(m[1]); out.sources.push('route-primary:' + m[1]) }

  // ② 回退形态：未来版本可能去掉 !!( ) 包装、或改成别的布尔写法
  if (names.size === 0) {
    const loose = /body\.([A-Za-z_$][A-Za-z0-9_$]*)\s*===\s*true/g
    for (const m of ix.matchAll(loose)) {
      if (/unproven|legacy|userfiles|optin|confirm|accept/i.test(m[1])) {
        names.add(m[1]); out.sources.push('route-loose:' + m[1])
      }
    }
  }

  // ③ validatePackPre 的 guard 是否还在（决定「是否还需要用户确认」）
  const guard = /userfiles-unproven-by-checksum/.test(pk)
  const strict = /!==\s*true/.test(pk)
  out.required = !!(guard && strict)
  if (!guard) out.sources.push('pack-guard-absent')
  if (!strict) out.sources.push('pack-strict-compare-absent')

  if (names.size === 1) out.field = Array.from(names)[0]
  else if (names.size === 0) {
    if (out.required) out.drift.push('后端仍要求显式确认，但探测不到确认字段名（路由写法已变）')
  } else {
    out.drift.push('探测到多个候选确认字段，无法判定唯一契约：' + Array.from(names).join(','))
  }
  return out
}

/** 客户端形态：6 个请求点 / 3 组状态 / 3 个勾选框插入位 / props 传递位。 */
export function detectClientShape(clientSrc) {
  const src = normalize(clientSrc)
  const out = { requests: [], states: 0, classicSlots: 0, iterSlots: 0, propsSlots: 0, hasUpstreamFix: false, drift: [] }

  const reReq = /apiPost\((API\.migrate(?:Inspect|Import)),\s*\{([^{}]*)\}\)/g
  for (const m of src.matchAll(reReq)) {
    const pm = m[2].match(/packPath:\s*([^,}]+)/)
    out.requests.push({ api: m[1], inner: m[2], packExpr: pm ? pm[1].trim() : null, index: m.index })
  }

  const stateRe = /^([ \t]*)var migConflictPair = useState\('keep'\)\n\1var migConflict = migConflictPair\[0\]\n\1var setMigConflict = migConflictPair\[1\]/gm
  out.states = Array.from(src.matchAll(stateRe)).length
  out.classicSlots = Array.from(src.matchAll(/(\n([ \t]*))migPlan \? h\('div', \{ style: \{ wordBreak/g)).length
  // 用「选包按钮」这一语义锚点，而不是 className='i5-toolbar'：
  // 后者在别的功能里也出现（实测 4 处），且未来版换皮肤类名就会假漂移。
  out.iterSlots = Array.from(src.matchAll(/(\n([ \t]*))(h\('div',[^\n]*props\.pickPack[^\n]*\n)/g)).length
  out.propsSlots = Array.from(src.matchAll(/(\n[ \t]*conflict: migConflict, setConflict: function \(value\) \{ setMigConflict\(value\); migPreview\(value\) \}, onApply: migApply,)/g)).length

  const optInRe = /\b(?:allowUnprovenUserFiles|acceptLegacyUserFiles|confirmLegacyUserFiles|legacyUserFilesOptIn)\s*:/
  const alreadyOptIn = out.requests.filter(r => optInRe.test(r.inner)).length
  const hasBox = /legacy-opt-in/.test(src)
  out.hasUpstreamFix = out.requests.length === 6 && alreadyOptIn === 6 && hasBox

  const expect = (v, want, label, hint) => {
    if (v !== want) out.drift.push(label + ' 实得 ' + v + ' 期望 ' + want + (hint ? ' ⇒ ' + hint : ''))
  }
  expect(out.requests.length, 6, 'migrateInspect/Import 请求点', '向导数量或请求体结构已变，需补一条锚点规则')
  if (out.requests.some(r => !r.packExpr)) out.drift.push('有请求点提取不到 packPath 表达式（变量名/结构漂移）')
  expect(out.states, 3, 'migConflict 状态定义组', '缩进或 useState 写法变化，需补锚点族')
  expect(out.classicSlots, 2, '经典面/全屏页勾选框插入位', '预览按钮后的 migPlan 片段已变')
  expect(out.iterSlots, 1, 'Iter5Migration 工具栏插入位', '共享组件结构已变')
  expect(out.propsSlots, 1, '大屏页 props 传递位', '共享组件入参已变')
  return out
}
