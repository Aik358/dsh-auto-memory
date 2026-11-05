/**
 * upgrade-links.js —— 向导第 3 页的外部渠道链接**唯一来源**（★用户裁定：做成按钮，不露裸链接）
 *
 * 【纪律】
 *  · URL 只出现在本文件；前端文案**不得**内联 URL（防止改一处漏一处、也避免链接被裸展示）
 *  · 新增渠道 = 在这里加键 + 在 FRONTEND 常量表加按钮文案；不得在 client.js 里另写一份
 *  · 所有链接一律 target=_blank + rel=noopener noreferrer（前端负责）
 *
 * 【为什么单列一个模块】同一语义只允许一份判据/一份事实源（项目规约）；链接散落在
 *   文案里会在改文案时漏改，且无法被测试断言。
 */
export const UPGRADE_LINKS = Object.freeze({
  /** dshapi 中转站（官方赞助，约官方谷时价 1/11）。 */
  relay: 'https://api.dshapi.icu/register?aff=HJU27P7JL39N',
  /** dsh-auto-memory 交流群（申请迁移专项额度）。 */
  group: 'https://qm.qq.com/q/EZbLCv7tEA',
});

/** 按钮文案（与链接同源，前端直接用；不得在 client.js 里另写字面量）。 */
export const UPGRADE_LINK_LABELS = Object.freeze({
  relay: '用 dshapi 中转站（约官方谷时 1/11）',
  group: '加群私信我，申请迁移专项额度',
});

/** 免责文案（免费/第三方渠道额度会变，不得承诺"够用"）。 */
export const UPGRADE_LINK_DISCLAIMER = '截至 2026-11，额度与价格以官网为准。';

/** 只返回合法 https 链接的键白名单（供前端渲染前过滤，避免空/非法链接渲染成死按钮）。 */
export function usableUpgradeLinksPre(links) {
  const src = links && typeof links === 'object' ? links : UPGRADE_LINKS
  const out = {}
  for (const [k, v] of Object.entries(src)) {
    const s = String(v == null ? '' : v).trim()
    if (/^https:\/\/[^\s]+$/i.test(s)) out[k] = s
  }
  return out
}
