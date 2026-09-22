/**
 * 环形 JSONL 的增量游标（issue #103）。
 *
 * **为什么存在**：`judgement-shadow.jsonl` 这类文件由 Python 侧按**保尾丢弃**维护
 * （`python/worker_semantic_v1.py` SHADOW_LOG_MAX=256，每次重写为 `lines[-256:]`）。
 * 用「行数」当游标在文件写满后必然失效：`lines.length` 恒等于上次的 `count` ⇒ 增量区间
 * 恒为空 ⇒ 消费端永久停摆，且因为"没有新行"是合法状态而不会留下任何痕迹。
 *
 * 本模块把游标改成**行内容指纹**：环内每一行只被交付一次，与文件是否被截断无关。
 * 纯函数、零依赖、不碰文件系统 —— 便于用假环直接单测。
 *
 * 语义约定（与调用点 `hubFeedTick` 一致）：
 * - 首次 `take()` 只登记现状、不交付任何行（`seeded: false`）。追喂历史行会让重启后
 *   把环里旧判据再吃一遍（`procedures.observe` 会重复计数），故刻意不喂。
 * - 之后每次 `take()` 只交付指纹未出现过的行，并按插入序把登记表封顶在 `maxSeen`。
 * - 逐字节相同的重复行视为同一事实（`fresh` 里不出现第二次）。
 *
 * ★归属说明（2026-09-22）：本模块内容取自被 3.1.0 强推冲掉的孤儿快照
 *   `475abfe:lib/jsonl-tail-cursor.js`（原为 PR #119 的产物）；因 pre 线只认 `-pre` 命名，
 *   此处改名为 `jsonl-tail-cursor-pre.js` **并已登记进 `tools/release.mjs` 的 libModuleRenames**。
 */
import { createHash } from 'node:crypto'

const defaultFp = (line) => createHash('sha256').update(String(line)).digest('hex').slice(0, 16)

/**
 * @param {{maxSeen?: number, fp?: (line: string) => string}} [opts]
 *   maxSeen 应 ≥ 目标环形文件的上限（默认 1024 = 256 的 4 倍），否则会出现
 *   「指纹被淘汰 ⇒ 环内旧行被重复交付」。
 */
export function createJsonlTailCursorPre(opts = {}) {
  const maxSeen = Number(opts.maxSeen) > 0 ? Number(opts.maxSeen) : 1024
  const fpOf = typeof opts.fp === 'function' ? opts.fp : defaultFp
  const seen = new Set()
  const order = [] // 插入序旧→新；Set 本身不保证可淘汰顺序，故另记
  let seeded = false

  const remember = (fp) => {
    if (seen.has(fp)) return
    seen.add(fp)
    order.push(fp)
    while (order.length > maxSeen) seen.delete(order.shift())
  }

  /**
   * @param {string[]} lines 当前文件内容（调用方负责切行与去空行）
   * @returns {{seeded: boolean, fresh: string[], seenSize: number}}
   *   `seeded: false` 表示本次为冷启动登记，`fresh` 必为空。
   */
  function take(lines) {
    const arr = Array.isArray(lines) ? lines : []
    if (!seeded) {
      seeded = true
      for (const l of arr) remember(fpOf(l))
      return { seeded: false, fresh: [], seenSize: seen.size }
    }
    const fresh = []
    for (const l of arr) {
      const fp = fpOf(l)
      if (seen.has(fp)) continue
      remember(fp)
      fresh.push(l)
    }
    return { seeded: true, fresh, seenSize: seen.size }
  }

  /** 复位（测试与「换文件」场景用）：下次 take() 重新按冷启动登记。 */
  function reset() {
    seeded = false
    seen.clear()
    order.length = 0
  }

  return { take, reset, stats: () => ({ seeded, seenSize: seen.size, maxSeen }) }
}
