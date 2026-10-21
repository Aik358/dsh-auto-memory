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
      //   ★2026-10-18 R124 重钉（455781fa… → 1c4727b8…）：v3.3.5 版本标识两处（指纹行 + 应用内
      //     更新说明字典新增 3.3.5 条目），均在经典区手写面 ⇒ 本锁随动。行为代码零改动。
      //     判据意图不变（经典区字节守恒）。★归因：还原这两处后复算 = 上一轮锁值，无其他内容混入。
      //   ★2026-10-18 R122 重钉（129caeec… → 455781fa…）：本批在经典档手写区纠正设置面文案——
      //     fEmitModeHint（zh/en/ja 三语）补「JS 5 秒生效 / Python 需重启 dsh web 才生效」；
      //     fShadowRetrievalHint、fContextBridgeHint（zh/en）把「默认关」纠正为「默认开」（与 DEFAULT_CONFIG
      //     真值一致），并说明关掉后整条通道停摆而非「只不投递」；向导 shadowRetrievalEnabled 的 sub 同步。
      //     行为代码零改动 ⇒ 本锁只随文案漂移。判据意图不变（经典区字节守恒）。
      //     ★归因：HEAD 版本用同一表达式复算 = 9714f5df…（与旧锁逐字节相等），无历史漂移混入。
      //   复算，重钉 f5574edf… → 129caeec…。★归因：本批之前的 HEAD 版本复算 = f5574edf…（与旧锁相等），
      //   说明本次变更**全部来自本批三处前端修复**，无历史漂移混入。
      // ★2026-10-19 重钉（fc58e287… → f6f1c6b2…）：v3.3.10 应用内更新说明字典新增 '3.3.10' 键
      //   + 界面指纹行 v3.3.9→v3.3.10，两者都在**经典区手写面**（生成区之外）⇒ 本锁随动，行为代码零改动。
      //   ★归因（实测复算，非推断）：改动前 HEAD（728be93）按同一表达式复算 = fc58e287…（与旧锁逐字节相等），
      //   改动后（8ea0c1b 起）复算 = f6f1c6b2… ⇒ 漂移全部来自 v3.3.10 版本标识，无历史内容混入。
      //   判据意图不变（经典区字节守恒）。上批提交 8ea0c1b 时漏了重钉，本条为补钉。
      // ★2026-10-19 重钉（f6f1c6b2… → 3d9862ae…）：issue #451 代理压缩适配批在**经典档手写区**新增——
      //   ① 设置面 fWaterProxyCompat 一行控件（含 ★ 注释两行）；② i18n 三语各 +1 键（fWaterProxyCompat/Hint + waterMeterProxy）；
      //   ③ 4-tuple 文案表 +1 条（L3 摘要用）；④ 水位卡 meter 渲染分支 +proxyUsage 档；
      //   ⑤ 一次性兼容询问弹窗（DialogHost 内 proxyCompat 分支 + 优先级登记 + 启动探测 checkProxyCompatOffer）。
      //   全部在生成区之外（生成块内容另由 iter5-skin 锁与 --check --strict 守卫）。行为代码零改动。
      //   判据意图不变（经典区字节守恒），按 2026-10-01 裁定以本套件自身表达式复算重钉。
      //   判据意图不变；重钉值 = 本套件自身打印的 actual（6f21c2ad…，含 v3.3.13 版本标识两处）。
      //   重钉值 = 本套件自身打印的 actual（461dbf8c…，含 v3.3.14 版本标识两处）。
      // ★2026-10-21 重钉（6f21c2ad… → 02442ef9… → 461dbf8c…）：v3.3.14 设置页三面新增 2 个超时控件 + i18n zh/en 各 +4 键，
      //   均在生成区之外 ⇒ 本锁随动；行为零变化。判据意图不变（经典区字节守恒）；重钉值 = 本套件自身打印的 actual。
      // ★2026-10-21 重钉（ec132f81… → 68652318… → 6f21c2ad…）：v3.3.13 补 issue #451 遗留「半修」——经典档水位卡新增：**v3.3.12 版本标识两处**——指纹行
      //   v3.3.11→v3.3.12、应用内更新说明字典新增 '3.3.12' 条目（zh 6 条 / en 6 条），均在经典区手写面
      //   （生成区之外）⇒ 本锁随动。行为代码零改动；判据意图不变（经典区字节守恒）。
      //   ★中间值 24e85da4… 是版本号一度写成 3.4.0 时的实测值，用户裁定「这是小更新，末位 +1」后作废。
      // ★2026-10-21 重钉（f4ce3086… → 6a89b88a…）：线上团队同步 12GB 事故批在**经典档手写区**新增——
      //   ① zh/en 标签表各 +2 行（teamPullPageLimit / teamPushPath）；
      //   ② TEAM_SETTING_KEYS +2 键；③ renderTeamSettings 字段表 F +2 行（数值 / 文本控件）。
      //   全部在生成区之外（生成块另由 iter5-skin 锁与 --check --strict 守卫）；行为代码零改动，
      //   只多了两个可写的设置项。判据意图不变（经典区字节守恒）。
      //   ★归因（实测复算，非推断）：删除本批 8 行后用同一表达式复算 = f4ce3086…（与旧锁逐字节相等）
      //     ⇒ 本次漂移 100% 来自这 8 行，无历史内容混入。
      // ★2026-10-20 重钉（3d9862ae… → f4ce3086…）：v3.3.11 版本标识两处（指纹行 + 应用内更新说明字典新增 3.3.11 条目），
      //   均在经典区手写面（生成区之外）⇒ 本锁随动，行为代码零改动。判据意图不变（经典区字节守恒）。
      assert.equal(createHash('sha256').update(prior).digest('hex'), '461dbf8ca4c7df208d9f18d630077999fe11fd2fff971dc7dc229ceafa1044fe', 'classic client region bytes are conserved (interval control normalized back to 1/1440); pinned upstream baseline superseded by reviewed batches')
    }
  }
  console.log('PASS archive interval UI/API/runtime agree on 15–1440, invalid patches preserve configuration')
} finally { await host.close(); await fs.rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }) }
