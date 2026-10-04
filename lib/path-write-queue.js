/**
 * 按路径串行的原子写队列（#207 / 审计 §G2 第 1-3 项的公共处方）。
 *
 * 背景（审计实测）：cont-seq.json / auto-continue-done.json / auto-memory-archive-ledger.json
 * 三处旧实现是「readFileSync → 改 → writeFileSync 整写」：
 *   ① **丢更新**：并发调用交错读改写，后写覆盖先写；
 *   ② **撕裂**：裸 writeFileSync 被中断时留下半截 JSON，读取端 catch 后静默回落（计数器归零/闩锁丢失）。
 *
 * 处方（遵守复用纪律：**不另起第三套语义重叠的锁**）：
 *   ① 落盘统一走 config-io 的 `writeTextAtomicPreSync`（tmp → rename，本仓既有，零新依赖）；
 *   ② 同一路径的写入串成 promise 链（**按路径**串行、路径之间互不阻塞）——
 *      与批次 C 落地的 `_configSaveChain` 同构，只是把「全局单链」细化为「每路径一条链」。
 *
 * 本模块零第三方依赖、无随机、无时钟：仅做「入队 + 串行 + 原子落盘」三件事。
 */
import { writeTextAtomicPreSync } from './config-io.js'

/** 创建一张按路径串行的原子写队列表。 */
export function createPathWriteQueuePre() {
  const chains = new Map()
  /** 按路径串行：同一路径的后续任务挂在前一条链尾，异常不污染后续入队（与 _configSaveChain 同一写法）。 */
  function enqueue(file, fn) {
    const key = String(file)
    const previous = chains.get(key) || Promise.resolve()
    const next = previous.then(fn, fn)
    chains.set(key, next.then(() => undefined, () => undefined))
    return next
  }
  return {
    /**
     * 入队一次原子写。返回该次写入的 promise（resolve 为 writeTextAtomicPreSync 的结果，
     * 即 `{ok, path?, error?}`）。同一路径按入队顺序落盘；不同路径并行。
     */
    write(file, text) {
      return enqueue(file, () => writeTextAtomicPreSync(String(file), text))
    },
    /**
     * 入队一次**读改写事务**：fn 在「该路径前一次入队已完成」之后才执行，
     * 因此 fn 内部的「读 → 改 → 落盘」不会与同路径的其它事务交错。
     * 返回 fn 的返回值（本例中 saveContSeqState 是同步原子写）。
     */
    run(file, fn) {
      return enqueue(file, fn)
    },
    /** 等待全部在途写入落盘（测试与收尾用）。 */
    drain() {
      return Promise.all(Array.from(chains.values())).then(() => undefined)
    },
    /** 诊断：当前登记的路径数。 */
    size() { return chains.size },
  }
}
