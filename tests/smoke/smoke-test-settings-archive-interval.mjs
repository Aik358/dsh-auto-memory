import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { stripGeneratedSkin } from '../lib/skin-bundle.mjs'
import { startRecallHost } from '../lib/pr420-host.mjs'
import { resolveAutoConfig, CHECK_INTERVAL_MIN_MIN, CHECK_INTERVAL_MIN_MAX } from '../../lib/session-archive.js'

const home = await fs.mkdtemp(path.join(os.tmpdir(), 'dam-archive-interval-'))
const host = await startRecallHost(home)
try {
  for (const value of [1, 14, 1441, 15.5]) {
    const before = await fs.readFile(path.join(home, 'dsh-auto-memory.json'), 'utf8')
    const response = await host.request('config', { autoArchiveCheckMin: value, welcomeTourEnabled: false })
    assert.equal(response.status, 400, 'invalid interval must reject the entire patch: ' + value)
    assert.ok(response.data.fields.autoArchiveCheckMin)
    assert.equal(await fs.readFile(path.join(home, 'dsh-auto-memory.json'), 'utf8'), before)
  }
  for (const value of [CHECK_INTERVAL_MIN_MIN, CHECK_INTERVAL_MIN_MAX]) {
    const response = await host.request('config', { autoArchiveCheckMin: value })
    assert.equal(response.status, 200)
    assert.equal(response.data.config.autoArchiveCheckMin, value)
    assert.equal(resolveAutoConfig({ checkIntervalMin: value }).checkIntervalMin, value)
  }
  for (const file of ['lib/client.js', 'skins/legacy/iter5-325.js.frozen']) {
    const text = await fs.readFile(new URL('../../' + file, import.meta.url), 'utf8')
    const rows = text.split('\n').filter(line => line.includes("field(t('fArchiveCheckMin')"))
    assert.equal(rows.length, file === 'lib/client.js' ? 3 : 1)
    for (const row of rows) {
      assert.ok(row.includes('min: 15, max: 1440'))
      assert.ok(row.includes('Math.max(15,'))
    }
    if (file === 'lib/client.js') {
      const prior = stripGeneratedSkin(text).replace(/\r\n/g, '\n').split('\n').map(line => line.includes("field(t('fArchiveCheckMin')")
        ? line.replace('min: 15, max: 1440', 'min: 1, max: 1440').replace('Math.max(15,', 'Math.max(1,') : line).join('\n')
      assert.equal(createHash('sha256').update(prior).digest('hex'), 'f5574edf4b8312fe1553429edb4419a3091b9a0db1fcb8f379447790ab2db9fb', 'the interval control is the only classic client change from pinned upstream')
    }
  }
  console.log('PASS archive interval UI/API/runtime agree on 15–1440, invalid patches preserve configuration')
} finally { await host.close(); await fs.rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }) }
