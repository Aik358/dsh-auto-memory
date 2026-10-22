import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { embeddingConfigFilePre, createDefaultEmbeddingConfigPre, updateEmbeddingConfigPre } from '../../lib/embedding-config.js'
delete process.env.DSH_M7_EMBEDDING_CONFIG // Keep this default-path fixture inside its temporary home.

const source = await fs.readFile(new URL('../../lib/index.js', import.meta.url), 'utf8')
const route = source.indexOf("      path: API['semantic-emit'],")
const start = source.indexOf('handler: ', route) + 9
const end = source.indexOf('\n      },', start)
const dir = await fs.mkdtemp(path.join(tmpdir(), 'dam-376-'))
const file = embeddingConfigFilePre(dir)
await fs.mkdir(path.dirname(file), { recursive: true })
const env = { engine: { config: {}, _jsConfigurationError: 'fixture earlier failure' }, path, memoryDir: () => dir, dshHome: () => dir, embeddingConfigFilePre, createDefaultEmbeddingConfigPre, updateEmbeddingConfigPre,
  isLoopbackRequest: () => true, panelAllowedHosts: [], forbiddenPanelPayloadPre: (req) => ({ error: 'forbidden: panel-access' }), readJsonBody: async (req) => req.body, diag() {}, writeJson: (res, status, body) => Object.assign(res, { status, body }) }
const handler = new Function(...Object.keys(env), 'return (' + source.slice(start, end) + '\n})')(...Object.values(env))
async function call(body) { const res = {}; await handler({ method: 'POST', body }, res); return res }
try {
  for (const mode of ['active', 'canary-explicit', 'shadow']) {
    const original = JSON.stringify({ activationEmitMode: mode, activationPolicy: { mode, extra: true }, unknown: 42 })
    await fs.writeFile(file, original)
    assert.equal((await call({ mode: 'shadow', createOnly: true })).status, 200)
    assert.equal(await fs.readFile(file, 'utf8'), original, 'startup must preserve existing config byte for byte')
  }
  await fs.rm(file)
  assert.equal((await call({ mode: 'shadow', createOnly: true })).status, 200)
  assert.equal(JSON.parse(await fs.readFile(file)).provider, 'js-e5-small-q8-pre-v1')
  await call({ mode: 'active' })
  await call({ mode: 'shadow', createOnly: true })
  assert.equal(JSON.parse(await fs.readFile(file)).activationEmitMode, 'active')
  assert.equal(env.engine._jsConfigurationError, '', 'a confirmed manual save clears the earlier completion error')
  console.log('PASS #376 actual startup route preserves existing modes and later manual saves')
} finally { await fs.rm(dir, { recursive: true, force: true }) }
