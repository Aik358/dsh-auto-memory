/**
 * 有界 rename 重试 —— 应对 Windows 下短暂的文件句柄争用(issue #48)。
 *
 * 背景:Windows 上 DSH 常持有会话/记忆文件句柄(子代理刚结束时仍在写),
 * 此时 `fs.rename` 抛 EPERM/EACCES/EBUSY。旧实现是"一次失败即硬失败",
 * 在并发子代理场景下会把本可成功的写入判死。
 *
 * 语义边界:
 * - delays 是**每次尝试之前的等待时长**,不是绝对时间戳;首项必须为 0(立即试一次)。
 * - **不做** unlink/copy 回退:调用方各自保留自己的原子性与失败策略
 *   (删源再拷会破坏原子性,一旦中途失败会同时丢源与目标)。
 * - 仅对**瞬时**错误码重试;其它错误(如 ENOENT)立即抛出,不掩盖真实故障。
 * - 用尽重试仍失败 → 抛出最后一次的原始错误(保留 code/path 等信息)。
 */
import { promises as fsDefault } from 'node:fs'
import { setTimeout as sleepDefault } from 'node:timers/promises'

export const RENAME_RETRY_DELAYS = Object.freeze([0, 50, 150, 400, 1000])
const TRANSIENT_RENAME_CODES = new Set(['EPERM', 'EACCES', 'EBUSY'])

/**
 * 带退避的 rename。
 * @param {string} from 源路径
 * @param {string} to 目标路径
 * @param {{fs?:object, delays?:number[], sleep?:Function}} [opts] 注入点(fs/sleep 供故障注入测试)
 * @returns {Promise<void>} 成功即 resolve;失败抛原始错误
 */
export async function retryRename(from, to, opts = {}) {
  const fsApi = opts.fs || fsDefault
  const configuredDelays = opts.delays || RENAME_RETRY_DELAYS
  const delays = Array.isArray(configuredDelays) ? configuredDelays.slice() : configuredDelays
  const sleep = opts.sleep || sleepDefault
  if (!Array.isArray(delays) || !delays.length || delays[0] !== 0 ||
      delays.some((ms) => !Number.isFinite(ms) || ms < 0)) {
    throw new TypeError('retryRename: delays must start with 0 and contain finite nonnegative waits')
  }
  for (let attempt = 0; attempt < delays.length; attempt++) {
    if (delays[attempt]) await sleep(delays[attempt])
    try {
      await fsApi.rename(from, to)
      return
    } catch (error) {
      if (!TRANSIENT_RENAME_CODES.has(error && error.code) || attempt === delays.length - 1) throw error
    }
  }
}
