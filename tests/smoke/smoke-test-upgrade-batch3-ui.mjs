#!/usr/bin/env node
/**
 * smoke-test-upgrade-batch3-ui.mjs —— 批3（2026-11-05）六项能力 UI 层验收。
 *
 * ## 本批三处文案（都是**产品语义**，放 client.js 手写区，不进 skins/）
 *   ① p2「上传后果预告」—— 选范围时就说清「上传恒单区」，避免到发布页才被拒；
 *   ② p3「成本口径」—— 区分「不消耗模型调用」与「免费额度」，不让用户以为有隐藏成本；
 *   ③ p3「范围与上传的关系」—— 同一屏讲清「整理可多区、上传恒单区」。
 *
 * ## 为什么必须**真渲染**（Lead 要求）
 * 批1 只验了 `upgradeTeamPublishGatePre` 的**返回值**带 message。
 * 但「返回值里有 message」≠「用户看得到」—— 中间还隔着：组件有没有接、有没有 setMsg、
 * 有没有被渲染成 DOM。本套件把 p2/p3 的 render 函数**真跑**，对渲染树取文本再断言。
 *
 * ## 三组
 *   N. 纯判据 upgradeUploadScopeNoticePre 真调用（判据层）
 *   D. **真渲染** p2/p3，断言文案出现在渲染树里（Lead 点名要求的那组）
 *   G. 发布门接进**真上传路径**（源码级接线守卫 + 拒绝时不发请求）
 */
import fs from 'node:fs'
import vm from 'node:vm'
import path from 'node:path'
import { createHash } from 'node:crypto'

const ROOT = path.resolve(new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), '..', '..')
const SRC = fs.readFileSync(path.join(ROOT, 'lib', 'client.js'), 'utf8')
let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  ok   - ' + m) } else { fail++; console.log('  FAIL - ' + m) } }
const eq = (a, b, m) => { const g = String(a) === String(b); ok(g, m + (g ? '' : '（实测 ' + String(a) + ' ≠ 期望 ' + String(b) + '）')) }

console.log('lib/client.js ' + Buffer.byteLength(SRC, 'utf8') + 'B / sha256[:16] ' + createHash('sha256').update(SRC).digest('hex').slice(0, 16))

function extractFn (sig) {
  const start = SRC.indexOf(sig)
  if (start < 0) return null
  let i = SRC.indexOf('{', start), d = 0, end = -1
  for (; i < SRC.length; i++) { const c = SRC[i]; if (c === '{') d++; else if (c === '}') { d--; if (d === 0) { end = i + 1; break } } }
  if (end <= start) return null
  return SRC.slice(start, end).replace(/\r\n/g, '\n')
}
const asMethod = (b) => b.replace(/^function\s+/, '')

// ═══ N. 纯判据：upgradeUploadScopeNoticePre 真调用 ══════════════════════════
console.log('')
console.log('== N. upgradeUploadScopeNoticePre 判据（真调用） ==')
const noticeBody = extractFn('function upgradeUploadScopeNoticePre(input) {')
ok(!!noticeBody, 'N-0 能抽出 upgradeUploadScopeNoticePre')
const nctx = vm.createContext({ console, isFinite })
vm.runInContext('var _n = {\n' + asMethod(noticeBody) + '\n};globalThis.__notice = _n.upgradeUploadScopeNoticePre;', nctx)
const notice = nctx.__notice
{
  eq(notice({ scope: 'current', currentWs: '--A--' }).willBlock, false, 'N-1 scope=current ⇒ 不拦（当前区必然在范围内）')
  eq(notice({ scope: 'all', currentWs: '--A--' }).willBlock, false, 'N-2 scope=all ⇒ 不拦（当前区必在全部里）')
  eq(notice({ scope: 'subset', currentWs: '--A--', selectedKeys: ['--A--', '--B--'], selectedCount: 2 }).willBlock, false,
     'N-3 subset 且勾了当前区 ⇒ 不拦')
  eq(notice({ scope: 'subset', currentWs: '--A--', selectedKeys: ['--B--', '--C--'], selectedCount: 2 }).willBlock, true,
     '★★N-4 [负路径] subset 未勾当前区 ⇒ **拦**（这正是 Lead 要提前讲的那条路）')
  ok(notice({ scope: 'subset', currentWs: '--A--', selectedKeys: ['--B--', '--C--'], selectedCount: 2 }).message.indexOf('当前工作区') >= 0,
     'N-5 拦截文案点明「只会上传当前工作区」')
  ok(/建议二选一/.test(notice({ scope: 'subset', currentWs: '--A--', selectedKeys: ['--B--'], selectedCount: 1 }).message),
     'N-6 拦截文案给出**两个出路**（勾上当前区 / 整理完切过去）')
  ok(notice({ scope: 'subset', currentWs: '--A--', selectedKeys: ['--B--'], selectedCount: 1 }).message.indexOf('拒绝') >= 0,
     'N-7 拦截文案明说「上传会被拒绝」（不是含糊提示）')
  eq(notice({ scope: '' }).willBlock, false, 'N-8 [负路径] 无 scope ⇒ 不提示（个人版没有发布这一步）')
  eq(notice(null).willBlock, false, 'N-9 [负路径] null ⇒ 不抛且不提示')
  // 交叉一致性：预告为「可发布」时，发布门必须也放行（同一语义，两处不得打架）
  const gateBody2 = extractFn('function upgradeTeamPublishGatePre(input) {')
  const gctx = vm.createContext({ console })
  vm.runInContext('var _g = {\n' + asMethod(gateBody2) + '\n};globalThis.__gate = _g.upgradeTeamPublishGatePre;', gctx)
  const pairs = [
    { scope: 'subset', currentWs: '--A--', selectedKeys: ['--A--'], selectedCount: 1 },
    { scope: 'subset', currentWs: '--A--', selectedKeys: ['--B--'], selectedCount: 1 },
    { scope: 'current', currentWs: '--A--' },
    { scope: 'all', currentWs: '--A--' },
  ]
  let mismatch = 0
  for (const p of pairs) {
    const n = notice(p)
    const g = gctx.__gate({ scope: p.scope, currentWs: p.currentWs, selectedKeys: p.selectedKeys, uploadTargetWs: p.currentWs })
    // 预告说「不拦」⇒ 门必须放行；预告说「会拦」⇒ 门必须拒绝
    if (n.willBlock === g.allowed) mismatch++
  }
  eq(mismatch, 0, '★★N-10 预告与发布门**逐组一致**（预告说不拦⇔门放行；说会拦⇔门拒绝）—— 同一语义不得两处打架')
}

// ═══ D. 真渲染：p2/p3 文案必须出现在渲染树里 ═══════════════════════════════
console.log('')
console.log('== D. 真渲染 p2/p3（Lead 点名：message 必须真进 DOM） ==')
/** 从渲染树里取全部文本（h() 在我们的桩里返回 {type, props, kids}） */
function textOf (node) {
  if (node == null) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join(' ')
  let out = ''
  if (node.kids) out += ' ' + node.kids.map(textOf).join(' ')
  return out
}
/** 在树里按 data-* 找节点 */
function findByAttr (node, attr) {
  if (!node || typeof node !== 'object') return null
  if (Array.isArray(node)) { for (const k of node) { const r = findByAttr(k, attr); if (r) return r } return null }
  if (node.props && node.props[attr] !== undefined) return node
  if (node.kids) { for (const k of node.kids) { const r = findByAttr(k, attr); if (r) return r } }
  return null
}

// 把 p2 / p3 的 render 函数抽出来真跑 —— 需要它们的自由变量，逐个注入。
function renderPage (pageName, fixtures) {
  const head = pageName === 'p2' ? 'var renderPage2 = function () {' : 'var renderPage3 = function () {'
  const start = SRC.indexOf(head)
  if (start < 0) return null
  let i = SRC.indexOf('{', start), d = 0, end = -1
  for (; i < SRC.length; i++) { const c = SRC[i]; if (c === '{') d++; else if (c === '}') { d--; if (d === 0) { end = i + 1; break } } }
  const body = SRC.slice(start, end + 1).replace(/\r\n/g, '\n')
  const ctx = vm.createContext(Object.assign({ console }, fixtures))
  vm.runInContext(body + '\nglobalThis.__page = renderPage' + (pageName === 'p2' ? '2' : '3') + ';', ctx)
  return ctx.__page
}

// h() 桩：把 props 与 children 收成一个可遍历的普通对象
const hStub = function (type, props) {
  const kids = Array.prototype.slice.call(arguments, 2)
  const flat = []
  const push = (x) => { if (x == null || x === false) return; if (Array.isArray(x)) { x.forEach(push) } else { flat.push(x) } }
  push(kids)
  return { type: type, props: props || {}, kids: flat }
}

{
  const baseFixtures = {
    h: hStub,
    T: (a, b) => a,
    zh: true,
    kvRow: () => null,
    btnRow: (k, kids) => ({ type: 'div', props: {}, kids: kids }),
    sectionTitle: () => null,
    header: () => null,
    err: '',
    notice: '',
    setNotice: () => {},
    setPage: () => {},
    onGoP3: () => {},
    onGoP2: () => {},
    upgradeWizardBtnStylePre: () => ({}),
    upgradeWizardLinkStylePre: () => ({}),
    upgradeWizardFmtCharsPre: (n) => String(Math.round(Number(n) || 0)),
    upgradeWizardFmtMoneyPre: (n) => '¥' + String(n),
    upgradeWizardCostSharePre: () => ({ ok: true, chars: 1000, inTok: 1000, cost: { offPeak: 1, peak: 2, relay: 0.5 } }),
    upgradeWizardSecondsPre: () => ({ ok: true, low: 1, high: 2 }),
    upgradeWizardFmtDurationPre: () => '0s',
    upgradeWizardProgressModelPre: () => ({ total: 0, settled: 0, percent: 0, counts: {}, rows: [], events: 0, checkpoints: 0, elapsedMs: 0, etaMs: 0 }),
    selOf: (scope, keys) => ({ ok: true, rows: keys && keys.length ? keys.map((k) => ({ wsKey: k, chars: 500 })) : [{ wsKey: '--A--', chars: 500 }], chars: 500 }),
    inv: { opencodeUsableChars: 213248, totals: {} },
    models: { providers: [] },
    modelSel: '', setModelSel: () => {},
    effort: 'medium', onEffortChange: () => {},
    onToggleSubset: () => {},
    scope: 'subset', setScope: () => {},
    subsetKeys: ['--B--', '--C--'],
    wsNow: '--A--',
    rowsAll: [{ wsKey: '--A--', chars: 500 }, { wsKey: '--B--', chars: 500 }, { wsKey: '--C--', chars: 500 }],
    invLoading: false,
    busy: false,
    st: { phase: 'idle' },
    UPGRADE_LINKS_PRE: { relay: 'https://x', group: 'https://y' },
    UPGRADE_LINK_LABELS_PRE: { relay: 'relay', group: 'group' },
    UPGRADE_LINK_DISCLAIMER_PRE: 'disclaimer',
    upgradeUploadScopeNoticePre: notice,
    setNotice2: () => {},
    onConfirmStart: () => {},
  }
  const fn2 = renderPage('p2', baseFixtures)
  ok(typeof fn2 === 'function', 'D-0a 能抽出并真跑 renderPage2')
  const tree2 = fn2()
  const txt2 = textOf(tree2)
  const node2 = findByAttr(tree2, 'data-dam-wizard-upload-notice')
  ok(!!node2, '★D-1 p2 渲染树里**存在** data-dam-wizard-upload-notice 节点（文案真的被渲染出来了）')
  eq(node2 && node2.props['data-dam-wizard-upload-notice'], 'block',
     '★★D-2 p2 该节点标记为 block（当前区不在所选范围 ⇒ 警示态）')
  ok(txt2.indexOf('上传团队基线时只会发送') >= 0, '★★D-3 [真渲染] p2 渲染文本里出现「上传团队基线时只会发送」')
  ok(txt2.indexOf('当前工作区') >= 0, '★★D-4 [真渲染] p2 渲染文本里出现「当前工作区」')
  ok(/拒绝|阻止/.test(txt2), '★★D-5 [真渲染] p2 渲染文本里出现「拒绝/阻止」（用户点「开始」前就知道后果）')
  ok(txt2.indexOf('建议二选一') >= 0, '★D-6 [真渲染] p2 渲染文本里给出两个出路')

  const fn3 = renderPage('p3', baseFixtures)
  ok(typeof fn3 === 'function', 'D-0b 能抽出并真跑 renderPage3')
  const tree3 = fn3()
  const txt3 = textOf(tree3)
  ok(txt3.indexOf('不消耗模型调用') >= 0, '★★D-7 [真渲染] p3 出现「不消耗模型调用」（成本口径，不是「免费」）')
  ok(txt3.indexOf('不是「免费额度」') >= 0 || txt3.indexOf('不是「免费') >= 0,
     '★★D-8 [真渲染] p3 明说**不是**免费额度（区分「真免费」与「不适用」）')
  ok(/打包基线、搜索、上传、应用/.test(txt3), '★D-9 [真渲染] p3 逐项列出恒 ¥0 的四步')
  const node3 = findByAttr(tree3, 'data-dam-wizard-upload-notice')
  ok(!!node3, '★D-10 [真渲染] p3 也存在 upload-notice 节点（范围与上传的关系在同一屏）')
  ok(txt3.indexOf('只会发送') >= 0, '★D-11 [真渲染] p3 渲染文本里同样说明「只会上传当前工作区」')

  // 负路径：把范围换成「含当前区」⇒ 同一渲染函数必须给出**不同的**文案（判据非恒真）
  const fixturesOk = Object.assign({}, baseFixtures, { subsetKeys: ['--A--', '--B--'] })
  const fn2b = renderPage('p2', fixturesOk)
  const txt2b = textOf(fn2b())
  ok(!/会被\*\*拒绝\*\*/.test(txt2b) && txt2b.indexOf('不在本次范围') < 0 && txt2b.indexOf('但它**不在**') < 0,
     '★★D-12 [负路径] 勾上当前区 ⇒ p2 不再出现「但它不在所选范围」的警示（证明 D-3~D-6 不是恒真）')
  ok(txt2b.indexOf('已勾选当前工作区') >= 0 || txt2b.indexOf('可直接上传') >= 0,
     '★D-13 [负路径] 勾上当前区 ⇒ 文案改为「可直接上传」')
}

// ═══ G. 发布门接进真上传路径（接线守卫 + 拒绝时不发请求） ═════════════════
console.log('')
console.log('== G. 发布门接进真上传路径（**真执行** runUploadAfterUpgrade） ==')
{
  // ★为什么不能只做源码字符串断言：批3 首版 G 组就是 grep 'if (publishGate.allowed...)'，
  //   变异（把条件改成 false &&）只让一条静态行变红、其余全绿 —— 那是恒真守卫。
  //   ⇒ 现在把 runUploadAfterUpgrade **整段抽出来真跑**，判据是「有没有调 apiPost」。
  const uploadBody = extractFn('function runUploadAfterUpgrade(wsFor, jobId) {')
  ok(!!uploadBody, 'G-0 能抽出 runUploadAfterUpgrade 函数体')
  const gateFnBody = extractFn('function upgradeTeamPublishGatePre(input) {')

  /** 造一个能真跑的 runUploadAfterUpgrade；返回它实际发出的 apiPost 次数与 msg */
  function runUpload (opts) {
    const o = opts || {}
    const calls = { apiPost: 0, msg: [], busy: [] }
    const gateCtx = vm.createContext({ console })
    vm.runInContext('var _g = {\n' + asMethod(gateFnBody) + '\n};globalThis.__gate = _g.upgradeTeamPublishGatePre;', gateCtx)
    const fixtures = {
      console: console,
      zh: true,
      wsNow: '--A--',
      uploadedJobsRef: o.uploadedJobsRef || { current: {} },
      apiPost: function () { calls.apiPost++; return Promise.resolve({ ok: true, packedBytes: 1024 }) },
      setMsg: function (m) { calls.msg.push(String(m)) },
      setBusy: function (b) { calls.busy.push(b) },
      clearUploadIntentPre: function () {},
      API: { teamBaseline: '/api/dsm/team-baseline' },
      upgradeTeamPublishGatePre: o.gateStub || gateCtx.__gate,
      st: o.st || {},
    }
    const ctx = vm.createContext(fixtures)
    vm.runInContext(uploadBody + '\nglobalThis.__runUpload = runUploadAfterUpgrade;', ctx)
    ctx.__runUpload('--A--', o.jobId || 'job-1')
    return calls
  }

  // ① 负路径：范围不含目标区 ⇒ 一次请求都不发
  const rejected = runUpload({ st: { scope: 'subset', workspaceKeys: ['--B--', '--C--'] } })
  eq(rejected.apiPost, 0, '★★G-1 [真执行·负路径] 范围不含目标区 ⇒ 一次 apiPost 都没发（不是发完再报错）')
  ok(rejected.msg.length >= 1, '★★G-2 [真执行] 拒绝时确实调了 setMsg（消息会显示给用户）')
  // ★断言要贴**产品真实用词**：target-not-selected 的文案是「已阻止」，不是「拒绝」。
  //   第一版写死「拒绝」⇒ 假红。这里断言「阻止 / 拒绝」任一，语义等价即可。
  ok(/阻止|拒绝/.test(rejected.msg.join(' ')), '★★G-3 [真执行] 拒绝消息明确说「已阻止/拒绝」——即「说清为什么」')
  ok(rejected.msg.join(' ').indexOf('旧内容') >= 0, '★G-4 [真执行] 拒绝消息点明「会是整理前的旧内容」')
  eq(rejected.busy[rejected.busy.length - 1], false, 'G-5 [真执行] 拒绝后 busy 复位（不留按钮卡死）')

  // ② 正路径：范围含目标区 ⇒ 恰好 1 次
  const allowed = runUpload({ st: { scope: 'subset', workspaceKeys: ['--A--', '--B--'] } })
  eq(allowed.apiPost, 1, '★★G-6 [真执行·正路径] 范围含目标区 ⇒ 恰好发 1 次 apiPost')
  ok(!/阻止|拒绝/.test(allowed.msg.join(' ')), '★G-7 [真执行·负路径] 放行时不出现「阻止/拒绝」字样')
  eq(runUpload({ st: { scope: 'all', workspaceKeys: [] } }).apiPost, 1, '★G-8 [真执行] scope=all ⇒ 放行')
  eq(runUpload({ st: { scope: 'current', workspaceKeys: [] } }).apiPost, 1, '★G-9 [真执行] scope=current 且目标=当前区 ⇒ 放行')

  // ③ 变异：把门换成「恒放行」⇒ G-1 的同类场景必须变成「发了请求」
  const mutated = runUpload({
    st: { scope: 'subset', workspaceKeys: ['--B--'] },
    gateStub: function () { return { allowed: true, reason: 'mutated', message: '' } },
  })
  eq(mutated.apiPost, 1, '★★G-10 [变异] 门被改成恒放行 ⇒ 请求发出（apiPost=1）⇒ 证明 G-1 不是恒真')
  eq(runUpload({ st: { scope: 'subset', workspaceKeys: ['--B--'] } }).apiPost, 0, '★★G-11 [对照] 真门 ⇒ 请求 0 次')

  // ④ 「恰好一次」标记：被拒绝时必须撤销，允许修好范围后重试
  const ref = { current: {} }
  runUpload({ st: { scope: 'subset', workspaceKeys: ['--B--'] }, uploadedJobsRef: ref, jobId: 'job-x' })
  eq(ref.current['job-x'], undefined, '★G-12 [真执行] 被拒绝后「恰好一次」标记被撤销（可重试）')
  const ref2 = { current: {} }
  runUpload({ st: { scope: 'all', workspaceKeys: [] }, uploadedJobsRef: ref2, jobId: 'job-y' })
  eq(ref2.current['job-y'], true, '★G-13 [对照] 放行时标记保留（防重复打包）')
}


console.log('[upgrade-batch3-ui] PASS ' + pass + ' / FAIL ' + fail)
process.exit(fail ? 1 : 0)
