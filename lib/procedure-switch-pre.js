/**
 * ★ B-2 修复(2026-09-22)：**procedure 技能生效总闸的语义纠正与兼容层**。
 *
 * 背景（代码取证）：
 * - 旧键 `procedurePromotionEnabled` 的名字/文案是「技能固化与晋升」（client.js:5023），
 *   但它的**唯一两个消费者**都与"晋升"无关：
 *     · context-host-pre.js:537   → `skillEnabled = memoryHubEnabled && procedurePromotionEnabled !== false`（决定技能是否**注入上下文**）
 *     · activation-host-pre.js:330 → `if (procedurePromotionEnabled === false) return null`（决定**主动唤起**这条臂开不开）
 *   真正的"晋升"由 store 的门限（procedure-store-pre.js）与路由动作决定，与该键无关。
 * - 它默认 `false`（index.js:546）⇒ **新用户装完即"技能永不生效"，且没有任何提示**。
 * - 用户硬规则：「单一开关不得顺带改变其他功能的行为」——本键正是反例。
 *
 * 纠正方案（**不新增死开关**）：
 * - 新增 `procedureInjectEnabled`（默认 **true**）作为语义正确的总闸，供上面两个消费者读取。
 * - 旧键保留为**兼容别名**：新键缺省时按旧键取值，两键都缺省时取 `true`。
 *   ⇒ 老用户显式关掉过总闸的，行为不翻面（尊重既有选择）；从未设置过的，技能开始正常生效。
 * - **不建 `procedureAutoPromoteEnabled`**：全仓无任何自动晋升代码路径
 *   （`applyAutomaticTransitions` 只导出、零调用 —— 见 BUGLIST P2-4），建了它就是死配置。
 *   "固化"由既有 `hubMechanicalProcedureFeedEnabled`（T10）管，"晋升"由门限 + 路由动作管。
 *
 * ⚠️ 本文件是并行开发的**接口契约**：其他文件只允许通过本模块解析该开关，
 *    不得各自 inline 一份判断（否则又会出现口径漂移）。
 */

/** 解析「技能注入/唤起总闸」。@param {object} cfg 插件 config（engine.config） @returns {boolean} */
export function resolveProcedureInjectEnabledPre(cfg) {
  const c = cfg || {}
  if (typeof c.procedureInjectEnabled === 'boolean') return c.procedureInjectEnabled
  // 兼容别名：旧键语义 = 总闸（见文件头取证），保留其显式选择
  if (typeof c.procedurePromotionEnabled === 'boolean') return c.procedurePromotionEnabled
  return true
}

/** 是否仍在使用已弃用的旧键（供设置页/诊断提示"建议迁移"）。 */
export function usesLegacyProcedureSwitchPre(cfg) {
  const c = cfg || {}
  return typeof c.procedureInjectEnabled !== 'boolean' && typeof c.procedurePromotionEnabled === 'boolean'
}
