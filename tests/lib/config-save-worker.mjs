// Separate OS process; imports the complete production engine without a host.
// ★B-1b 扩展（相对 PR#221 原版）：新增 op='loadSync' / op='hold' 两个动作，用于
//   ①「容量迁移落盘与另一进程并发保存互不回退」的验收（PR#221 未覆盖的第三个洞）；
//   ②「锁被活进程持有 ⇒ 第二个持锁者超时拒绝」的负路径。
const { MemoryEngine } = await import('./audit-engine.mjs')
const { withConfigLock } = await import('../../lib/config-lock.js')
const engine = new MemoryEngine({})
engine._configPath = process.env.DAM_CONFIG_TEST_FILE
engine.refresh = async () => {}
process.on('message', async ({ id, op, patch }) => {
  try {
    if (op === 'loadSync') { engine.loadConfigSync(); process.send({ id, ok: true }); return }
    if (op === 'load') { await engine.loadConfig(); process.send({ id, ok: true }); return }
    if (op === 'hold') {
      let held
      await withConfigLock(engine._configPath, async () => { held = true; process.send({ id, ok: true }); await new Promise(() => {}) })
      return
    }
    await engine.saveConfig(patch)
    process.send({ id, ok: true })
  } catch (e) { process.send({ id, ok: false, error: e.message, code: e.code }) }
})
process.send({ ready: true })