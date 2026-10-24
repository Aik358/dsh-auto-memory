/**
 * board-mode-pre —— WB-GRAPH 白板线总开关(2026-09-16, board_mode_pre_v1)。
 *
 * 裁定来源: WB-GRAPH-DECISIONS-20260914.md §E + 用户 2026-09-16 凌晨原话:
 *   「一口气全做完，但是线先别着急接。可以先在设置里，或者在接续面板上设置一个按钮，一键切换旧版和新版。」
 *
 * 设计(硬纪律):
 *  - boardMode = 'legacy'(默认) | 'graph'(新版看板 dsh-graph + sidecar + 遍历工具)。
 *  - **开关解耦**(用户硬性规则): boardMode 只决定"白板线新能力是否激活",
 *    不顺带改变任何其他功能行为; legacy 模式下一切行为与 P5 收官时**字节级一致**。
 *  - graph_* 工具(dsh-graph vendor)与 memory_expand/memory_trace(P3)
 *    仅在 boardMode='graph' 时注册; P2 sidecar 仅在 'graph' 时写盘。
 *  - fail closed: 非法值一律按 legacy(旧行为), 绝不猜。
 */

export const BOARD_MODE_VERSION = 'board_mode_pre_v2'
// ★v4（2026-10-24）：新增第三档 `event`（事件记忆视图）。
//   为什么不该复用 graph：graph 档的语义是「新版看板（dsh-graph + sidecar + 遍历工具）」，
//   事件视图是**另一种组织方式**（按「一件事」聚合四段 + 检查点），不是看板换皮 ⇒ 必须独立档。
//   ★与 graph 的关系：`graphEnabled` 仍只在 `graph` 档为真（事件档不注册 memory_expand/memory_trace、
//   不写 sidecar）⇒ 事件档天然与看板线**解耦**，这是为 D13（删看板组件）预留的路径。
export const BOARD_MODES_PRE_V1 = Object.freeze(['legacy', 'graph', 'event'])

/**
 * 解析白板模式。非法/缺省 → legacy(旧行为, fail closed)。
 * @param {string|undefined} raw 配置里的 boardMode 原值
 * @returns {{mode:'legacy'|'graph', graphEnabled:boolean, source:'default'|'config'|'fallback'}}
 */
export function resolveBoardModePre(raw) {
  const s = String(raw == null ? '' : raw).trim().toLowerCase()
  if (s === 'graph') return { mode: 'graph', graphEnabled: true, eventEnabled: false, source: 'config' }
  // ★v4：事件档 —— graphEnabled 明确 false（不注册遍历工具、不写 sidecar，与看板线解耦）
  if (s === 'event') return { mode: 'event', graphEnabled: false, eventEnabled: true, source: 'config' }
  if (s === 'legacy' || s === '') return { mode: 'legacy', graphEnabled: false, eventEnabled: false, source: s === '' ? 'default' : 'config' }
  // 非法值: fallback 到 legacy 并留痕(调用方可把 source==='fallback' 记 diag)
  return { mode: 'legacy', graphEnabled: false, eventEnabled: false, source: 'fallback' }
}
