import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import vm from 'node:vm'
import { updateEmbeddingConfigPre, createJsEmbeddingConfigPre } from '../../lib/embedding-config.js'

const dir = fs.mkdtempSync(path.join(tmpdir(), 'dam-js-config-feedback-'))
try {
  const source = fs.readFileSync(new URL('../../lib/index.js', import.meta.url), 'utf8')
  const start = source.indexOf('    try {\n      const _dlStart = engine._jsDownload.start.bind')
  const end = source.indexOf('    // ─────────── 三层检索契约', start)
  assert.ok(start > 0 && end > start)
  let tick, phase = 'downloading'
  const engine = { _jsDownload: { start: () => ({ ok: true }), state: () => ({ phase }) } }
  vm.runInNewContext(source.slice(start, end), { engine, path, updateEmbeddingConfigPre, createJsEmbeddingConfigPre,
    userModelsRoot: path.join(dir, 'models'), memoryDir: () => dir, diag() {},
    setInterval: fn => { tick = fn; return { unref() {} } }, clearInterval() {} })
  const cfg = path.join(dir, 'embedding-config.json')
  fs.writeFileSync(cfg, '{corrupt')
  engine._jsDownload.start('auto'); assert.equal(engine._jsConfigurationPending, true)
  phase = 'done'; tick()
  assert.equal(engine._jsConfigurationPending, false); assert.ok(engine._jsConfigurationError)
  assert.equal(fs.readFileSync(cfg, 'utf8'), '{corrupt', 'failed configuration creation preserves the original file')
  const existing = '{"activationEmitMode":"active","unknown":{"keep":1}}'
  fs.writeFileSync(cfg, existing); engine._jsDownload.start('auto'); tick()
  assert.equal(engine._jsConfigurationError, ''); assert.equal(fs.readFileSync(cfg, 'utf8'), existing)
  fs.rmSync(cfg); engine._jsDownload.start('auto'); engine._disposed = true; tick()
  assert.ok(!fs.existsSync(cfg), 'late completion after disposal cannot create configuration')
  const client = fs.readFileSync(new URL('../../lib/client.js', import.meta.url), 'utf8')
  let pos = 0, count = 0
  while ((pos = client.indexOf("var isJs = guide === 'js'", pos)) >= 0) {
    const end = client.indexOf('var fmtMB', pos), compute = client.slice(pos, end)
    for (const pending of [true, false]) {
      const sem = { loaded: true, ready: true, download: { phase: 'done', configurationPending: pending, configurationError: 'fixture save failure' } }
      const value = vm.runInNewContext('(function(){' + compute + ';return stateTxt})()', { guide: 'js', sem, L: s => s, t: s => s, Object, Math })
      assert.ok(!value.includes('已就绪 ✓'))
      assert.match(value, pending ? /保存配置/ : /fixture save failure/)
    }
    count++; pos = end
  }
  assert.equal(count, 3)
  console.log('PASS #369 JS assets and configuration are reported separately, with preserved files and visible retry state')
} finally { fs.rmSync(dir, { recursive: true, force: true }) }
