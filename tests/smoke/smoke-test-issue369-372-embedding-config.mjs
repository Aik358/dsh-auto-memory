import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { createJsEmbeddingConfigPre, updateEmbeddingConfigPre } from '../../lib/embedding-config.js'

const dir = fs.mkdtempSync(path.join(tmpdir(), 'dam-369-'))
const file = path.join(dir, 'embedding-config.json')
try {
  const defaults = () => createJsEmbeddingConfigPre(dir)
  updateEmbeddingConfigPre(file, (c) => c, { defaults, createOnly: true })
  assert.equal(JSON.parse(fs.readFileSync(file)).provider, 'js-e5-small-q8-pre-v1')
  assert.equal(JSON.parse(fs.readFileSync(file)).dimension, 384)
  updateEmbeddingConfigPre(file, (c) => ({ ...c, unrelated: 'preserve' }))
  updateEmbeddingConfigPre(file, (c) => ({ ...c, gpu: true }))
  assert.equal(JSON.parse(fs.readFileSync(file)).unrelated, 'preserve')
  for (const corrupt of ['{"half":', '[]', 'null']) {
    fs.writeFileSync(file, corrupt)
    for (const createOnly of [false, true]) {
      assert.throws(() => updateEmbeddingConfigPre(file, (c) => ({ ...c, gpu: true }), { defaults, createOnly }))
      assert.equal(fs.readFileSync(file, 'utf8'), corrupt)
    }
  }
  console.log('PASS #369/#372 config writers preserve invalid files and initialize real JS identity fields')
} finally { fs.rmSync(dir, { recursive: true, force: true }) }
