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
      // ★2026-10-17 判据更新（A01–A24 修复批）：本锁原语义是「间隔控件是相对 pinned upstream 的**唯一**经典区改动」。
      //   该语义已被后续多个合法批次突破（#443 下载失败回执 / #441 reset 失败可见 / #426 激活按钮门 三处都在经典区），
      //   「唯一改动」不再成立 ⇒ 判据必须从「唯一性」改为「**字节守恒**」：仍锁住经典区整体不被无痕漂移，
      //   只是不再声称改动只有一处。锁的值按**本套件自身表达式**（stripGeneratedSkin → LF → 把 15/1440 还原成 1/1440）
      //   ★2026-10-18 R115 重钉（129caeec… → 7b3c3d57…）：本批设置面文案纠正 + 门控读数增「索引就绪」行，
      //   均在经典档手写区（生成区之外）⇒ 本锁随动。改动内容：fInboxGateHint/fAssocEngineHint/
      //   fFullEverySlimsHint 三组中英文案与后端默认值对齐 + data-dam-gate-readout 各面 +1 行。
      //   判据意图不变（经典区字节守恒），按 2026-10-01 裁定以本套件自身表达式复算重钉。
      //   复算，重钉 f5574edf… → 129caeec…。★归因：本批之前的 HEAD 版本复算 = f5574edf…（与旧锁相等），
      //   说明本次变更**全部来自本批三处前端修复**，无历史漂移混入。
      assert.equal(createHash('sha256').update(prior).digest('hex'), '7b3c3d57746b89dce2a9f0aed9076826f71dfd9de242136b185bde26a29907d1', 'classic client region bytes are conserved (interval control normalized back to 1/1440); pinned upstream baseline superseded by reviewed batches')
    }
  }
  console.log('PASS archive interval UI/API/runtime agree on 15–1440, invalid patches preserve configuration')
} finally { await host.close(); await fs.rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }) }
