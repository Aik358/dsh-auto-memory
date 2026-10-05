// Separate OS process; imports the complete production engine without a host.
const { MemoryEngine } = await import('./audit-engine.mjs')
const engine = new MemoryEngine({})
engine._configPath = process.env.DAM_CONFIG_TEST_FILE
engine.refresh = async () => {}
process.on('message', async ({ id, patch }) => {
  try { await engine.saveConfig(patch); process.send({ id, ok: true }) }
  catch (e) { process.send({ id, ok: false, error: e.message }) }
})
process.send({ ready: true })
