/**
 * acceptance-pre —— P5 分档运行验收清单(2026-09-16, acceptance_v1)。
 *
 * 权威依据: MASTER-PLAN §Phase 5 + TODO-GRAPH V2-P5 卡。
 * 核心纪律(卡内原文): **发布材料逐项记录通过/失败/未执行 —— 不把「没测试环境」写成「已验收」**;
 *   U1(兼容档实测)未完成时不能填写「兼容已验收」; T6-3 资源界限必须事前登记。
 *
 * 设计: 纯数据结构 + 纯函数, 零 IO。验收项三类状态: 'pass' | 'fail' | 'not-run'。
 * 只有全部必需项为 pass 才允许 release-ready; 任何 fail/not-run ⇒ not-ready(如实)。
 * 兼容档(compat)实测门: 未登记设备/负载数据 ⇒ 兼容项强制 not-run, 不可手工标 pass。
 */

export const ACCEPTANCE_VERSION = 'acceptance_v1'

/** V2-P5 验收清单(必需项与依据)。 */
export const ACCEPTANCE_ITEMS_V1 = Object.freeze([
  { id: 'T6-1', required: true, desc: '兼容配置拦截所有生成式模型调用(调用数=0), 目录/词法/展开通过' },
  { id: 'T6-2', required: true, desc: '前台返回时间与后台完成时间分开测' },
  { id: 'T6-3', required: true, desc: '资源界限事前登记(CPU/GPU、前台/后台分别登记)' },
  { id: 'T6-5', required: true, desc: '最终动态文本全量计费、Tier-0 常驻、尾注不重复、交付幂等' },
  { id: 'T6-6', required: true, desc: '各阶段开关退回基础路径后撤回仍不出现、预算仍守住; 回滚使旧状态复活即失败' },
  { id: 'T6-7', required: true, desc: '隔离目录从发行产物运行入口测试(禁开发树相对导入)+ 工具能力矩阵' },
  { id: 'compat-U1', required: true, desc: '兼容档实测: 登记设备与负载, 测冷启动/P95/RSS/峰值/磁盘/索引积压年龄', compatGate: true },
])

/**
 * 创建验收登记器。
 */
export function createAcceptanceLedgerPre() {
  const entries = new Map() // id → {status, evidence, note, at}
  for (const item of ACCEPTANCE_ITEMS_V1) entries.set(item.id, { status: 'not-run', evidence: '', note: '', at: 0 })

  /**
   * 登记一项结果。fail-closed 规则:
   *  - 兼容项(compatGate)必须携带实测数据(evidence 含 device+load 字段)才允许 pass — 否则强制 not-run。
   *  - 非法状态名按 not-run 处理(不抛错, 但在 note 里如实标记 invalid)。
   */
  function recordAcceptancePre(id, status, { evidence = '', note = '' } = {}) {
    const item = ACCEPTANCE_ITEMS_V1.find((x) => x.id === id)
    if (!item) return { ok: false, reason: 'unknown-item' }
    let st = (status === 'pass' || status === 'fail') ? status : 'not-run'
    let n = note
    if (status !== 'pass' && status !== 'fail' && status !== 'not-run') n = (n ? n + '; ' : '') + 'invalid-status:' + String(status)
    if (item.compatGate && st === 'pass') {
      let measured = false
      try { const ev = JSON.parse(evidence || '{}'); measured = !!(ev.device && ev.load) } catch (_) {}
      if (!measured) { st = 'not-run'; n = (n ? n + '; ' : '') + 'compat-gate: 未登记实测数据(device/load), 不可标 pass' }
    }
    entries.set(id, { status: st, evidence: String(evidence || ''), note: n, at: Date.now() })
    return { ok: true, status: st }
  }

  /** 汇总: release-ready 仅当全部必需项 pass。 */
  function acceptanceSummaryPre() {
    const items = ACCEPTANCE_ITEMS_V1.map((item) => ({ ...item, ...entries.get(item.id) }))
    const passed = items.filter((x) => x.status === 'pass').length
    const failed = items.filter((x) => x.status === 'fail')
    const notRun = items.filter((x) => x.status === 'not-run')
    const allRequiredPass = items.every((x) => !x.required || x.status === 'pass')
    return {
      version: ACCEPTANCE_VERSION,
      total: items.length, passed, failed: failed.map((x) => x.id), notRun: notRun.map((x) => x.id),
      releaseReady: allRequiredPass,
      items,
      // T6-7 能力矩阵(如实记录, 未测的能力标 not-run — 不写「已验收」)
      capabilityMatrix: items.map((x) => x.id + '=' + x.status).join(' '),
    }
  }

  return { recordAcceptancePre, acceptanceSummaryPre }
}
