// Actual semantic-emit route and actual download completion callback; no copied guard.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import vm from 'node:vm'
import { embeddingConfigFilePre, createDefaultEmbeddingConfigPre, updateEmbeddingConfigPre } from '../../lib/embedding-config.js'
delete process.env.DSH_M7_EMBEDDING_CONFIG // Keep this default-path fixture inside its temporary home.

const idx = fs.readFileSync(new URL('../../lib/index.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const cli = fs.readFileSync(new URL('../../lib/client.js', import.meta.url), 'utf8')
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dam-i356-'))
const cfgPath = embeddingConfigFilePre(root)
fs.mkdirSync(path.dirname(cfgPath), { recursive: true })
const logs = []
let pass = 0
const ok = (condition, label) => { assert.ok(condition, label); pass++ }
const deps = { engine: { config: {} }, path, memoryDir: () => root, dshHome: () => root, resolveDshHomePre: () => root,
  embeddingConfigFilePre, createDefaultEmbeddingConfigPre, updateEmbeddingConfigPre,
  isLoopbackRequest: () => true, panelAllowedHosts: [], forbiddenPanelPayloadPre: (req) => ({ error: 'forbidden: panel-access' }), readJsonBody: async (r) => r.body,
  writeJson: (_, status, body) => ({ status, body }), diag: (s) => logs.push(s) }
const routeAt = idx.indexOf("path: API['semantic-emit']")
const h = idx.indexOf('handler: ', routeAt) + 'handler: '.length
const end = idx.indexOf('\n    },', h)
const callback = idx.slice(h, end).replace(/,\s*$/, '')
const handler = vm.runInNewContext('(' + callback + ')', deps)
try {
  let r = await handler({ method: 'POST', body: { mode: 'shadow' } }, {})
  assert.equal(r.status, 200)
  let cfg = JSON.parse(fs.readFileSync(cfgPath))
  assert.equal(cfg.provider, 'js-e5-small-q8-pre-v1')
  assert.equal(cfg.dimension, 384)
  fs.writeFileSync(cfgPath, JSON.stringify({ ...cfg, provider: 'python-existing', unrelated: 42 }))
  r = await handler({ method: 'POST', body: { mode: 'canary-explicit' } }, {})
  assert.equal(r.status, 200)
  cfg = JSON.parse(fs.readFileSync(cfgPath))
  assert.equal(cfg.provider, 'python-existing')
  assert.equal(cfg.unrelated, 42)
  assert.equal(cfg.activationPolicy.mode, 'shadow')
  for (const corrupt of ['{ half', '[]']) {
    fs.writeFileSync(cfgPath, corrupt)
    r = await handler({ method: 'POST', body: { mode: 'active' } }, {})
    assert.equal(r.status, 500)
    assert.equal(fs.readFileSync(cfgPath, 'utf8'), corrupt)
    assert.ok(logs.some((s) => s.includes('semantic-emit: FAILED')))
  }
  const dlAt = idx.indexOf('    try {\n      const _dlStart =')
  const dlEnd = idx.indexOf('    // ─────────── 三层检索契约 C3', dlAt)
  assert.ok(dlAt > 0 && dlEnd > dlAt)
  let tick
  const engine = { config: {}, _jsDownload: { start: () => ({ ok: true }), state: () => ({ phase: 'done' }) } }
  vm.runInNewContext(idx.slice(dlAt, dlEnd), { ...deps, engine, userModelsRoot: root,
    setInterval: (fn) => { tick = fn; return { unref() {} } }, clearInterval() {} })
  engine._jsDownload.start('cn'); tick()
  assert.equal(fs.readFileSync(cfgPath, 'utf8'), '[]')
  assert.ok(logs.some((s) => s.includes('首建失败')))
  fs.rmSync(cfgPath)
  engine._jsDownload.start('cn'); tick()
  cfg = JSON.parse(fs.readFileSync(cfgPath))
  assert.equal(cfg.provider, 'js-e5-small-q8-pre-v1')
  assert.equal(cfg.dimension, 384)
  console.log('PASS #369/#372 actual semantic route and actual download callback preserve corrupt files and initialize identity')
// #377 supersedes automatic startup downloading; #376 requires atomic create-only config.
const iBoot = cli.indexOf('Startup only offers setup; downloading requires an explicit user action.')
ok(iBoot > 0, 'T3a 启动检查仅提供安装入口')
const bootSeg = cli.slice(iBoot, cli.indexOf('}, 12000)', iBoot) + 11)
ok(/Date\.now\(\) < sdUntil/.test(bootSeg) && /semanticEngineMode === 'lexical'/.test(bootSeg),
  'T3b 免打扰和词法模式抑制启动推荐')
ok(!/API\.semanticDownload/.test(bootSeg) && /openDialog\(\{ kind: 'semSetup'/.test(bootSeg),
  'T3c 模型缺失只弹安装入口，不自动下载')
ok(/apiGet\(API\.semanticStatus\)/.test(cli) && /apiPost\(API\.semanticEmit, \{ mode: 'shadow', createOnly: true \}\)/.test(cli),
  'T3d 配置首建不覆盖既有用户选择')
ok(/}, 12000\)/.test(bootSeg) && /}, 16000\)/.test(cli.slice(iBoot, iBoot + 3200)),
  'T3e 两条路径各有退避延时（错开开屏弹窗，不抢首屏）')


} finally { fs.rmSync(root, { recursive: true, force: true }) }
console.log('PASS startup configuration guards retained: ' + pass)
