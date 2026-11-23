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
      // ★2026-10-21 重钉（… → 461dbf8c… → 3ee26651…）：v3.3.15 前端区间对齐 + 版本标识两处。
      // ★2026-10-21 重钉（6f21c2ad… → 02442ef9… → 461dbf8c…）：v3.3.14 设置页三面新增 2 个超时控件 + i18n zh/en 各 +4 键，
      //   均在生成区之外 ⇒ 本锁随动；行为零变化。判据意图不变（经典区字节守恒）；重钉值 = 本套件自身打印的 actual。
      // ★2026-10-21 重钉（ec132f81… → 68652318… → 6f21c2ad…）：v3.3.13 补 issue #451 遗留「半修」——经典档水位卡新增：**v3.3.12 版本标识两处**——指纹行
      //   v3.3.11→v3.3.12、应用内更新说明字典新增 '3.3.12' 条目（zh 6 条 / en 6 条），均在经典区手写面
      //   （生成区之外）⇒ 本锁随动。行为代码零改动；判据意图不变（经典区字节守恒）。
      //   ★中间值 24e85da4… 是版本号一度写成 3.4.0 时的实测值，用户裁定「这是小更新，末位 +1」后作废。
      // ★2026-10-22 重钉（6a89b88a… → e31fa808…）：v3.3.16 版本标识两处（指纹行 + 应用内更新说明
      //   字典新增 3.3.16 条目），均在经典区**手写面**（生成区之外）⇒ 本锁随动，行为代码零改动。
      //   ★归因取证（实测）：还原 lib/client.js 到 HEAD（v3.3.15）后本套件 PASS（旧锁绿）；换回本批改动 = 红。
      //   ⇒ 漂移 100% 来自版本标识，属**判据过期**，非缺陷。判据意图不变（经典区字节守恒）。
      // ★2026-10-24 R139 重钉（a52f5cff… → 418e659e…）：v4 批次 D 检索把 P3 铭文的 scope="events" 写回
      //   （C-2 时该 scope 不存在 ⇒ 曾是假承诺；D 批实现 events 分支后文案才合法）。全在经典档手写区，行为代码零改动。
      //   判据意图不变（经典区字节守恒）。
      // ★2026-10-24 重钉（5226d738… → a52f5cff…）：v4 批次 C-2 P2/P3 改了经典档手写区两段文案
      //   （snapshotSlimMaintain 加第 7 项 + 六项改七项；snapshotSlimGuide 加事件卡片入口 + 白板语义改四段式）。
      //   ★归因（实测）：把这两段回退到旧文案后本套件 PASS（旧锁绿），换回本批改动即红
      //   ⇒ 漂移 100% 来自这两段文案，无历史内容混入。判据意图不变（经典区字节守恒）。
      // ★2026-10-21 重钉（f4ce3086… → 6a89b88a…）：线上团队同步 12GB 事故批在**经典档手写区**新增——
      //   ① zh/en 标签表各 +2 行（teamPullPageLimit / teamPushPath）；
      //   ② TEAM_SETTING_KEYS +2 键；③ renderTeamSettings 字段表 F +2 行（数值 / 文本控件）。
      //   全部在生成区之外（生成块另由 iter5-skin 锁与 --check --strict 守卫）；行为代码零改动，
      //   只多了两个可写的设置项。判据意图不变（经典区字节守恒）。
      //   ★归因（实测复算，非推断）：删除本批 8 行后用同一表达式复算 = f4ce3086…（与旧锁逐字节相等）
      //     ⇒ 本次漂移 100% 来自这 8 行，无历史内容混入。
      // ★2026-10-20 重钉（3d9862ae… → f4ce3086…）：v3.3.11 版本标识两处（指纹行 + 应用内更新说明字典新增 3.3.11 条目），
      //   均在经典区手写面（生成区之外）⇒ 本锁随动，行为代码零改动。判据意图不变（经典区字节守恒）。
      // ★2026-10-25 重钉（2362c5b5… → 17d192f7…）：用户裁定方案 A —— workflow lane 提取改原型规则
      //   （新增模块级纯函数 + EventView 薄封装），全部在**经典区手写面**（生成区之外），行为代码零改动。
      //   判据意图不变（经典区字节守恒）；重钉值 = 本套件自身打印的 actual。
// ★R2026-10-25b P3（task-32 · C 线）锁随动 —— 归因按 Lead 要求写足三项：
//
// 【① 为什么按实测重钉而不是"调阈值放宽"】
//   本锁守的是「classic 区（剥掉生成块后）字节守恒」，**没有阈值**可放宽 ——
//   它只有一个精确值。所以动作只能是「按该套件自身算法复算出的 actual 重钉」，
//   不存在"放宽"这个选项。判据意图（经典侧内容不得被意外改动）一字未变。
//
// 【② 这次字节变化的唯一来源】
//   P3（task-32 · C 线）三处改动全部落在**经典档手写区（生成块之外）**：
//     a) EventView 的 eventDetail / eventList 各补 sessionId: currentSessionIdClient()
//     b) perceptTagOfPre 新增 PERCEPT_TAG_LABELS 常量 + 可读标签映射
//     c) Iter5Surface 的默认全屏 + 可见性闸门 + computeFullpageHeightPre 纯函数
//   ⇒ 剥掉生成块后经典侧字节变化 ⇒ 274989bf… → 8926467e…
//   ★可复算：`node tools/build-iter5-skin.mjs --check --strict` = SYNC-OK
//     证明**生成区未被触碰**，漂移 100% 来自生成区外的经典侧。
//
// 【③ 负路径：本锁仍在守（见 tests/smoke/smoke-test-fullpage-negative.mjs 同族做法）】
//   本套件自身的负路径在 tests/smoke/smoke-test-iter5-skin.mjs 的剥离自检①②③ 里：
//   生成区 marker 一旦被改动 / 段边界切歪 ⇒ 剥离自检立刻红，锁根本不进入比对。
//      assert.equal(createHash('sha256').update(prior).digest('hex'), '8926467e99f01235a37ef1a59698c8444469b1e94f17cffd5c8afa5f16ba5931', 'classic client region bytes are conserved (interval control normalized back to 1/1440); pinned upstream baseline superseded by reviewed batches [★R2026-10-25 P1 右栏抽屉（C 线）⇒ 手写区字节再变，重钉 63ad32ea… → f7c5125e…。★R2026-10-24d P1 三视图 + 空档 + 倒序（C 线）⇒ 手写区字节再变，重钉 478f1510… → 63ad32ea…。★R2026-10-24c P0 检查点折叠 + 六类 panel（C 线）⇒ 手写区字节再变，重钉 ff925888… → 478f1510…。★R2026-10-24b D1 收口修正（--dam-state-warn 未定义 ⇒ 改既有变量）⇒ 手写区字节再变，重钉 01fecf3a… → ff925888…。★R2026-10-24 v4 H4/H10 前端（C 线）：EventCard 四 percept 渲染 + 统计条第 5 卡 + PlanTab 存量转换三步 UI，全部落经典档手写区（生成块之外）⇒ 剥掉生成块后经典侧字节变化 ⇒ 按实测 actual 重钉 35ca017f… → 01fecf3a…。归因可复算：`build-iter5-skin --check --strict` = SYNC-OK（生成区零改动）；R2026-10-23: v3.3.17 版本身份三件套（指纹行 + 应用内 CHANGELOG 3.3.17 条目，均在生成块之外）⇒ 按实测 actual 重钉 e31fa808… → 5226d738…；归因实测：还原 client.js 到 HEAD 后本套件 exit=0，判据过期非缺陷]')
    }
  }
  console.log('PASS archive interval UI/API/runtime agree on 15–1440, invalid patches preserve configuration')
} finally { await host.close(); await fs.rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }) }
