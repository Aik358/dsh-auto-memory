/**
 * smoke-test-upgrade-apply.mjs —— P2 验收（2026-11-03）
 *
 * 依据：docs/internal/PLAN-UPGRADE-WIZARD-20261103.md §7 的 P2 验收行：
 *   「3 个临时区造数据 → 落盘 ⇒ 断言每区 event-store.json 的 sha256；
 *     篡改草案 ⇒ 该区不写且回滚到原 sha；重复 apply ⇒ 事件数不变」
 *
 * ★本套件全部是**真调用**（CR-10）：真 import → 真造工作区 → 真 apply → 读盘断言
 *   sha256 / 事件数 / 白板字节；没有一条「源码含某字符串」式恒真断言。
 * ★草案形状按 P1（lib/upgrade-draft.js）的严格 schema 构造（闸 1 白名单 + 闸 2 必填 +
 *   闸 3 真溯源 + 闸 4 自检重算），因此本套件同时是 **P1↔P2 的并联集成验收**。
 * ★负路径覆盖：篡改草案、幻觉引用、校验器抛错、未知校验器返回值、白板写失败、
 *   非法事件、缺 backupRoot、不存在的 wsPath、renderPlan=false、manifest 白名单。
 */
import fs from 'node:fs'
import path from 'node:path'
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { createHarness } from './_harness.mjs'
import {
  applyUpgradeDraftPre,
  buildCreatePlanPre,
  checkPlanRenderGatePre,
  draftIdemTagPre,
  draftEventToStoreEventPre,
  normalizeDraftPre,
  normalizeValidatorResultPre,
  fallbackValidateDraftPre,
  planAnchorsPre,
} from '../../lib/upgrade-apply.js'
import { emptyEventPre, readStorePre, writeStorePre, validateEventPre } from '../../lib/event-store.js'

const T = createHarness('upgrade-apply')
const ROOT = fileURLToPath(new URL('../..', import.meta.url))

const NOW = new Date(2026, 10, 3, 12, 0, 0, 0).getTime()
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')
const readSha = async (f) => sha256(await readFile(f))
const readText = async (f) => readFile(f, 'utf8')

/** 造一个工作区：骨架 PLAN.md（含 1 个 M1 锚点）+ 2 篇日志 + 1 条存量事件 */
async function makeWorkspace(root, tag) {
  const wsPath = path.join(root, tag)
  const handoff = path.join(wsPath, 'handoff')
  await mkdir(handoff, { recursive: true })
  await mkdir(path.join(wsPath, '.dsh-memory'), { recursive: true })
  const log1 = '2026-11-01.md'
  const log2 = '2026-11-02.md'
  await writeFile(path.join(wsPath, '.dsh-memory', log1), '# 2026-11-01\n\n原始记录：' + tag + ' 事件甲的起点。\n', 'utf8')
  await writeFile(path.join(wsPath, '.dsh-memory', log2), '# 2026-11-02\n\n推进：' + tag + ' 已到第二步。\n', 'utf8')
  const anchor = 'mem_' + 'a'.repeat(32)
  const planBefore = '# 项目白板 · ' + tag + '\n\n## 目标\n\n骨架占位\n\n## 关键约束\n\n<!--memory:' + anchor + '-->\n占位卡\n'
  const planPath = path.join(handoff, 'PLAN.md')
  await writeFile(planPath, planBefore, 'utf8')
  const storePath = path.join(handoff, 'event-store.json')
  const oldEv = emptyEventPre('旧事件-' + tag, {
    id: 'evt_' + sha256(Buffer.from('id-' + tag, 'utf8')).slice(0, 8),
    summary: '迁移前存量事件',
    now: 1,
  })
  await writeStorePre(storePath, { events: [oldEv] })
  return {
    tag,
    wsKey: '--' + tag + '--',
    wsPath,
    handoff,
    storePath,
    planPath,
    log1,
    log2,
    anchor,
    planBefore,
    storeBeforeSha: await readSha(storePath),
    planBeforeSha: await readSha(planPath),
  }
}

/** 造 N 个工作区（标签 <tag>-a / -b / -c） */
async function makeZones(tag, n = 3) {
  const root = T.tmpdir('upgrade-apply-' + tag + '-')
  const zones = []
  for (let i = 0; i < n; i++) zones.push(await makeWorkspace(root, tag + '-' + String.fromCharCode(97 + i)))
  return { root, zones }
}

/**
 * 单条草案事件 —— **严格按 P1 的 draft schema**（闸 1 白名单）构造：
 * 只含 name/summary/sections/members/rationale/kind/confidence/startMs/endMs/outcomes/checkpoints。
 * 检查点带 goal+state（闸 2 要求四段覆盖率 100%）与 rel+quoteRef（闸 3 真子串命中）。
 */
function draftEventFor(ws, overrides = {}) {
  const base = {
    name: '事件-' + ws.tag,
    summary: '把 ' + ws.tag + ' 的历史整理成一条事件',
    sections: { goal: '整理 ' + ws.tag, doing: '已归并两篇日志', deadend: '暂无卡点', next: '继续补检查点' },
    members: [ws.log1, ws.log2],
    rationale: '两篇日志与检查点指向同一件事',
    kind: 'ledger',
    confidence: 'high',
    startMs: new Date(2026, 10, 1, 9, 0, 0, 0).getTime(),
    endMs: new Date(2026, 10, 2, 9, 0, 0, 0).getTime(),
    outcomes: ['P2 交付'],
    checkpoints: [
      {
        at: new Date(2026, 10, 1, 10, 0, 0, 0).getTime(), kind: 'log', text: '起点',
        goal: 'g1', state: 's1', dead: '', next: 'n1',
        rel: ws.log1, quoteRef: '原始记录：' + ws.tag + ' 事件甲的起点', quoteLine: 3,
      },
      {
        at: new Date(2026, 10, 2, 10, 0, 0, 0).getTime(), kind: 'progress', text: '推进',
        goal: 'g2', state: 's2', dead: '', next: 'n2',
        rel: ws.log2, quoteRef: '推进：' + ws.tag + ' 已到第二步', quoteLine: 3,
      },
    ],
  }
  return Object.assign(base, overrides)
}

/** 单区草案（selfCheck 必须与引擎重算一致：1 事件 / 2 检查点 / 2 篇日志被覆盖） */
function zoneDraft(ws, overrides = {}) {
  return {
    wsKey: ws.wsKey,
    wsPath: ws.wsPath,
    selfCheck: { events: 1, checkpoints: 2, coveredLogs: 2 },
    events: [draftEventFor(ws, overrides)],
  }
}

/** 批草案 */
function batchDraft(tag, zones) {
  return { runId: 'run-' + tag, workspaces: zones.map((z) => zoneDraft(z)) }
}

/** 递归找残留 tmp（写盘必须 tmp→rename，成功后不得留 .tmp） */
async function findTmpFiles(dir) {
  const out = []
  let ents = []
  try { ents = await readdir(dir, { withFileTypes: true }) } catch (_) { return out }
  for (const e of ents) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...(await findTmpFiles(p)))
    else if (/\.tmp$/i.test(e.name)) out.push(p)
  }
  return out
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('== A. 纯函数层（归一/幂等标签/草案→事件/校验器契约）==')
{
  const one = normalizeDraftPre({ wsKey: 'k', wsPath: 'p', events: [] })
  T.eq(one.zones.length, 1, 'A-1 单区直给 ⇒ 归一成 1 个区')
  const batch = normalizeDraftPre({ runId: 'r1', workspaces: [{ wsKey: 'a' }, { wsKey: 'b' }, { wsKey: 'c' }] })
  T.eq([batch.zones.length, batch.runId], [3, 'r1'], 'A-2 批形态 ⇒ 3 区 + runId 透传')
  T.eq(normalizeDraftPre(null).code, 'draft-not-object', 'A-3 null 草案 ⇒ draft-not-object（不炸）')

  const explicit = draftIdemTagPre({ de: { idemTag: 'given-tag' }, runId: 'r', wsKey: 'w', name: 'n' })
  const derived1 = draftIdemTagPre({ de: {}, runId: 'r', wsKey: 'w', name: 'n' })
  const derived2 = draftIdemTagPre({ de: {}, runId: 'r', wsKey: 'w', name: 'n2' })
  T.eq(explicit, 'given-tag', 'A-4 显式 idemTag 原样保留')
  T.ok(derived1.startsWith('upgrade:') && derived1.length === 'upgrade:'.length + 16, 'A-5 派生 idemTag 形状 upgrade:<16hex>', derived1)
  T.ok(derived1 === draftIdemTagPre({ de: {}, runId: 'r', wsKey: 'w', name: 'n' }), 'A-6 派生 idemTag 确定性（同输入同值）')
  T.ok(derived1 !== derived2, 'A-7 不同事件名 ⇒ 不同 idemTag')

  const richDe = draftEventFor({ tag: 'x', log1: '2026-11-01.md', log2: '2026-11-02.md' }, {
    userPercept: [{ stage: 'accepted', kind: 'preference', text: '偏好X' }],
    agentTrace: [{ action: '构造套件', result: '已落盘' }],
    constraints: ['不得静默丢写'],
    skills: ['skill-a'],
  })
  const ev = draftEventToStoreEventPre(richDe, { id: 'evt_0123abcd', idemTag: 't', now: NOW })
  T.eq(validateEventPre(ev), [], 'A-8 草案事件落盘后过 validateEventPre（空错误数组）')
  T.eq(ev.checkpoints.length, 2, 'A-9 检查点数量透传')
  T.ok(/^evt_[0-9a-f]{8}$/.test(ev.id), 'A-10 事件 id 形如 evt_8hex', ev.id)
  T.eq(ev.checkpoints[0].quoteRef, '原始记录：x 事件甲的起点', 'A-11 检查点 quoteRef 溯源字段保留')
  T.ok(ev.userPercept.length === 1 && ev.userPercept[0].stage === 'accepted', 'A-12 情境化记忆（userPercept）映射保留')
  T.ok(ev.skills.names.length === 1 && ev.skills.names[0] === 'skill-a', 'A-13 skills 数组 → 内部契约对象（#494 同口径）')

  let e1 = null
  try { draftEventToStoreEventPre(draftEventFor({ tag: 'x', log1: 'l1.md', log2: 'l2.md' }, { status: 'weird' }), { id: 'evt_0123abcd' }) } catch (e) { e1 = e }
  T.eq(e1 && e1.code, 'bad-status', 'A-14 非法 status ⇒ 抛 bad-status（不静默回落）')
  let e2 = null
  try { draftEventToStoreEventPre(draftEventFor({ tag: 'x', log1: 'l1.md', log2: 'l2.md' }, { status: 'closed' }), { id: 'evt_0123abcd' }) } catch (e) { e2 = e }
  T.eq(e2 && e2.code, 'closed-needs-outcome', 'A-15 closed 缺 outcome ⇒ 抛 closed-needs-outcome')

  const files = {
    '2026-11-01.md': '原始记录：x 事件甲的起点',
    '2026-11-02.md': '推进：x 已到第二步',
  }
  // 兜底校验器的固定夹具：必须有真实 tag/log1/log2，否则 zoneDraft 造出的 members 是 undefined
  const fbWs = { wsKey: 'k', wsPath: T.tmpdir('upgrade-apply-files-'), tag: 'x', log1: '2026-11-01.md', log2: '2026-11-02.md' }
  const vOk = fallbackValidateDraftPre(zoneDraft(fbWs), { files, logCount: 2 })
  T.ok(vOk.ok === true && vOk.stats.checkpoints === 2, 'A-16 兜底校验器：合法草案 PASS 且重算检查点数', JSON.stringify(vOk.stats))
  const vBad = fallbackValidateDraftPre(zoneDraft(fbWs, { sections: { goal: '', doing: 'd', deadend: '', next: 'n' } }), { files })
  T.ok(vBad.ok === false && vBad.code === 'required', 'A-17 兜底校验器：四段为空 ⇒ 拒（闸 2）', vBad.code)
  const halluc = draftEventFor({ tag: 'x', log1: '2026-11-01.md', log2: '2026-11-02.md' })
  halluc.checkpoints[0].quoteRef = '这句话根本不在日志里 XYZ'
  const vHalluc = fallbackValidateDraftPre({ wsKey: 'k', events: [halluc] }, { files })
  T.ok(vHalluc.ok === false && vHalluc.errors.some((x) => x.indexOf('quoteRef') >= 0), 'A-18 ★兜底校验器：幻觉 quoteRef ⇒ 拒（闸 3 真子串命中）', JSON.stringify(vHalluc.errors).slice(0, 120))

  T.ok(normalizeValidatorResultPre(true).ok && normalizeValidatorResultPre([]).ok && normalizeValidatorResultPre({ ok: true }).ok, 'A-19 校验器返回值：true/[]/ {ok:true} 都算过')
  T.ok(!normalizeValidatorResultPre({}).ok && !normalizeValidatorResultPre(null).ok && !normalizeValidatorResultPre('ok').ok, 'A-20 ★未知校验器返回值 ⇒ fail-closed')

  // 幂等预判（纯函数，直接用既有 store 断言）
  const wsB = await makeWorkspace(T.tmpdir('upgrade-apply-idem-'), 'idem-x')
  const store0 = await readStorePre(wsB.storePath)
  const draftZ = zoneDraft(wsB)
  const p1 = buildCreatePlanPre({ zone: draftZ, store: store0, runId: 'r', wsKey: wsB.wsKey, now: NOW })
  T.eq([p1.toCreate.length, p1.skipped.length], [1, 0], 'A-21 空库 ⇒ 计划新建 1 条事件')
  const store1 = { events: store0.events.concat(p1.toCreate) }
  const p2 = buildCreatePlanPre({ zone: draftZ, store: store1, runId: 'r', wsKey: wsB.wsKey, now: NOW })
  T.ok(p2.toCreate.length === 0 && p2.skipped.some((s) => s.reason === 'idemTag-exists'), 'A-22 ★同一 idemTag 重算 ⇒ 跳过（幂等判据 ②）', JSON.stringify(p2.skipped))
  const p3 = buildCreatePlanPre({ zone: draftZ, store: { events: [emptyEventPre('事件-' + wsB.tag, { id: 'evt_11112222' })] }, runId: 'r', wsKey: wsB.wsKey, now: NOW })
  T.ok(p3.toCreate.length === 0 && p3.skipped.some((s) => s.reason === 'name-exists'), 'A-23 ★既有事件名相同 ⇒ 跳过（幂等判据 ③）')

  const planOk = '# 项目白板 · w\n\n## 当前状态\n\n| a | b |\n\n## 近期进展（按时间倒序）\n\n- x\n\n## 关键约束\n\n- c\n\n## 待办\n\n- t\n'
  T.ok(checkPlanRenderGatePre(planOk).ok, 'A-24 闸 8：合法白板 PASS')
  T.eq(checkPlanRenderGatePre('').code, 'plan-empty', 'A-25 闸 8：空白板 ⇒ plan-empty')
  T.eq(checkPlanRenderGatePre('# 标题\n\n没有节').code, 'plan-section-missing', 'A-26 闸 8：缺预期节 ⇒ plan-section-missing')
  T.eq(planAnchorsPre('x <!--memory:' + wsB.anchor + '--> y').length, 1, 'A-27 锚点抽取（M1 口径）')
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('')
console.log('== B. 三区真落盘（断言每区 event-store.json sha256）==')
const B = await makeZones('e2e')
const Bb = path.join(T.tmpdir('upgrade-apply-bk-'), 'backups')
const Bbefore = { store: B.zones.map((z) => z.storeBeforeSha), plan: B.zones.map((z) => z.planBeforeSha) }
let B1 = null
{
  B1 = await applyUpgradeDraftPre(batchDraft('e2e', B.zones), { backupRoot: Bb, now: NOW })
  T.ok(B1.ok === true && B1.summary.total === 3 && B1.summary.ok === 3 && B1.summary.failed === 0, 'B-1 三区全部落盘成功', JSON.stringify(B1.summary) + ' ' + JSON.stringify((B1.workspaces || []).map((x) => x.error || '')))
  const hard = B1.workspaces.every((r) => typeof r.wsKey === 'string' && r.events === 1 && r.ckpts === 2 && typeof r.planBytes === 'number' && /^[0-9a-f]{64}$/.test(String(r.sha256)))
  T.ok(hard, 'B-2 ★每区回执五硬字段齐（wsKey/events/ckpts/planBytes/sha256）')

  const shaMatch = []
  const shaChanged = []
  const planOkFlags = []
  const planBytesMatch = []
  const archiveOk = []
  const backupOk = []
  const countAfter = []
  for (let i = 0; i < B.zones.length; i++) {
    const ws = B.zones[i]
    const r = B1.workspaces[i]
    shaMatch.push((await readSha(ws.storePath)) === r.sha256)
    shaChanged.push(r.sha256 !== r.sha256Before && r.sha256Before === Bbefore.store[i])
    const planText = await readText(ws.planPath)
    planOkFlags.push(planText.indexOf('## 当前状态') >= 0 && planText.indexOf('事件-' + ws.tag) >= 0)
    planBytesMatch.push(Buffer.byteLength(planText, 'utf8') === r.planBytes)
    let archName = null
    try { archName = (await readdir(path.join(ws.handoff, 'archive'))).find((n) => /^PLAN-.+\.md$/.test(n)) } catch (_) {}
    if (archName) {
      const archText = await readText(path.join(ws.handoff, 'archive', archName))
      archiveOk.push(archText === ws.planBefore && planAnchorsPre(archText).length === 1)
    } else archiveOk.push(false)
    const bdir = path.join(Bb, ws.wsKey, String(NOW))
    let snapName = null
    try { snapName = (await readdir(bdir)).find((n) => /^event-store\./.test(n)) } catch (_) {}
    backupOk.push(!!snapName && (await readSha(path.join(bdir, snapName))) === r.sha256Before)
    const st = await readStorePre(ws.storePath)
    countAfter.push(st.events.length)
  }
  T.ok(shaMatch.every(Boolean), 'B-3 ★每区磁盘 sha256 === 回执 sha256（重算一致）')
  T.ok(shaChanged.every(Boolean), 'B-4 ★每区 sha 相对 apply 前改变，且 sha256Before 等于造数据时的原 sha')
  T.ok(planOkFlags.every(Boolean), 'B-5 每区白板已重渲染（含「## 当前状态」与新事件名）')
  T.ok(planBytesMatch.every(Boolean), 'B-6 每区 planBytes === 磁盘白板 utf8 字节数')
  T.ok(archiveOk.every(Boolean), 'B-7 ★旧白板逐字节归档且 M1 锚点仍在（闸 8 锚点不丢）')
  T.ok(backupOk.every(Boolean), 'B-8 ★快照先行：<backupRoot>/<wsKey>/<ts>/ 快照 sha === 原库 sha')
  T.ok(countAfter.every((n) => n === 2), 'B-9 每区事件数 2（存量 1 + 新建 1）')
  T.ok((await findTmpFiles(B.root)).length === 0, 'B-10 ★无 .tmp 残留（原子写收尾干净）')

  const st0 = await readStorePre(B.zones[0].storePath)
  const created = st0.events.find((e) => e.name === '事件-' + B.zones[0].tag)
  T.ok(!!created && /^upgrade:[0-9a-f]{16}$/.test(String(created.idemTag)), 'B-11 新事件 idemTag 落盘正确（派生幂等标签）', created && created.idemTag)
  T.ok(!!created && created.sections.goal === '整理 ' + B.zones[0].tag, 'B-12 四段正文落盘正确')
  T.ok(!!created && created.checkpoints[0].quoteRef === '原始记录：' + B.zones[0].tag + ' 事件甲的起点', 'B-13 检查点溯源字段落盘正确')
  T.ok(!!created && created.checkpoints[1].quoteRef === '推进：' + B.zones[0].tag + ' 已到第二步', 'B-14 第二个检查点溯源落盘正确')
  T.eq(B1.validatorSource, 'upgrade-draft', 'B-15 ★并联：E2E 真跑的是 P1 校验器（无注入覆盖）')

  // ★接线层不留假缺陷：zone 自带 storePath/planPath 覆盖时，不得被 P1 闸 1 判成未知字段
  const Bw = await makeZones('wired-path', 1)
  const wZone = Object.assign(zoneDraft(Bw.zones[0]), { storePath: Bw.zones[0].storePath, planPath: Bw.zones[0].planPath })
  const rW = await applyUpgradeDraftPre({ runId: 'run-wired-path', workspaces: [wZone] }, { backupRoot: path.join(T.tmpdir('upgrade-apply-wiredpathbk-'), 'b'), now: NOW })
  T.ok(rW.workspaces[0].ok === true, 'B-16 ★zone 带 storePath/planPath 覆盖时仍过 P1 闸 1（applier 剥离引擎字段）', rW.workspaces[0].error || '')
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('')
console.log('== C. 幂等：同一草案重复 apply ==')
{
  const C1 = await applyUpgradeDraftPre(batchDraft('e2e', B.zones), { backupRoot: Bb, now: NOW })
  T.ok(C1.ok === true && C1.summary.failed === 0, 'C-1 重复 apply 不报失败')
  T.ok(C1.workspaces.every((r) => r.applied === false && r.code === 'already-applied'), 'C-2 ★重复 apply ⇒ 每区 applied=false / already-applied')
  T.ok(C1.workspaces.every((r) => r.events === 0), 'C-3 重复 apply ⇒ 新建事件数 0')
  const shaSame = []
  const countsSame = []
  const uniqueNames = []
  for (let i = 0; i < B.zones.length; i++) {
    shaSame.push((await readSha(B.zones[i].storePath)) === B1.workspaces[i].sha256)
    const st = await readStorePre(B.zones[i].storePath)
    countsSame.push(st.events.length === 2)
    uniqueNames.push(st.events.filter((e) => e.name === '事件-' + B.zones[i].tag).length === 1)
  }
  T.ok(shaSame.every(Boolean), 'C-4 ★重复 apply ⇒ event-store.json sha 逐区不变（零字节变化）')
  T.ok(countsSame.every(Boolean), 'C-5 ★重复 apply ⇒ 事件数不变')
  T.ok(uniqueNames.every(Boolean), 'C-6 ★重复 apply ⇒ 同名事件只有 1 条（无重复副本）')
  const planSame = []
  for (const ws of B.zones) planSame.push((await readSha(ws.planPath)) === B1.workspaces[B.zones.indexOf(ws)].planSha256)
  T.ok(planSame.every(Boolean), 'C-7 重复 apply ⇒ 白板 sha 不变（不重写白板）')
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('')
console.log('== D. dry-run（只检测不整理：零写盘）==')
{
  const D = await makeZones('dry')
  const Dbk = path.join(T.tmpdir('upgrade-apply-drybk-'), 'backups')
  const before = {
    store: await Promise.all(D.zones.map((z) => readFile(z.storePath))),
    plan: await Promise.all(D.zones.map((z) => readFile(z.planPath))),
  }
  const r = await applyUpgradeDraftPre(batchDraft('dry', D.zones), { backupRoot: Dbk, dryRun: true, now: NOW })
  T.ok(r.ok === true && r.dryRun === true, 'D-1 dryRun 整体成功且回执标 dryRun:true')
  T.ok(r.workspaces.every((x) => x.dryRun === true), 'D-2 每区回执 dryRun=true')
  T.ok(r.workspaces.every((x) => typeof x.planBytes === 'number' && x.planBytes > 0), 'D-3 dryRun 仍给出渲染后 planBytes（不写盘）')
  const sameStore = []
  const samePlan = []
  for (let i = 0; i < D.zones.length; i++) {
    sameStore.push(Buffer.compare(await readFile(D.zones[i].storePath), before.store[i]) === 0)
    samePlan.push(Buffer.compare(await readFile(D.zones[i].planPath), before.plan[i]) === 0)
  }
  T.ok(sameStore.every(Boolean), 'D-4 ★dryRun ⇒ event-store.json 逐字节不变')
  T.ok(samePlan.every(Boolean), 'D-5 ★dryRun ⇒ PLAN.md 逐字节不变')
  T.ok(D.zones.every((z) => !fs.existsSync(path.join(Dbk, z.wsKey))), 'D-6 ★dryRun 不建任何快照目录')
  const counts = []
  for (const z of D.zones) counts.push((await readStorePre(z.storePath)).events.length)
  T.ok(counts.every((n) => n === 1), 'D-7 dryRun 未写入任何事件')
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('')
console.log('== E. 篡改草案（fail-closed + 整批不中断）==')
{
  const E = await makeZones('tamper')
  const Ebk = path.join(T.tmpdir('upgrade-apply-tamperbk-'), 'backups')
  const draft = batchDraft('tamper', E.zones)
  draft.workspaces[1].events[0].sections.goal = ''
  const r = await applyUpgradeDraftPre(draft, { backupRoot: Ebk, now: NOW })
  T.ok(r.ok === false && r.summary.failed === 1 && r.summary.ok === 2, 'E-1 ★篡改区失败但整批不中断（2 成功 1 失败）', JSON.stringify(r.summary))
  T.eq(r.workspaces[1].code, 'validate-failed', 'E-2 篡改区 code=validate-failed')
  T.ok(r.workspaces[1].rolledBack === true, 'E-3 篡改区标 rolledBack=true')
  T.eq(await readSha(E.zones[1].storePath), E.zones[1].storeBeforeSha, 'E-4 ★篡改区不写：store sha 回到原值（逐字节等于造数据时的 sha）')
  T.ok(r.workspaces[0].ok === true && r.workspaces[2].ok === true, 'E-5 其它两区照常落盘')

  const E2 = await makeZones('tamper2')
  const Ebk2 = path.join(T.tmpdir('upgrade-apply-tamperbk2-'), 'backups')
  const d2 = batchDraft('tamper2', E2.zones)
  d2.workspaces[1].events[0].checkpoints[0].quoteRef = '这句话根本不在任何日志里 XYZ'
  const r2 = await applyUpgradeDraftPre(d2, { backupRoot: Ebk2, now: NOW })
  T.ok(r2.workspaces[1].ok === false && r2.workspaces[1].validation.errors.some((e) => e.indexOf('quoteRef') >= 0), 'E-6 ★幻觉引用 ⇒ 该区被拒（溯源真实性）', JSON.stringify(r2.workspaces[1].validation && r2.workspaces[1].validation.errors).slice(0, 160))
  T.eq(await readSha(E2.zones[1].storePath), E2.zones[1].storeBeforeSha, 'E-7 幻觉引用区 store sha 未变')

  const E3 = await makeZones('tamper3')
  const Ebk3 = path.join(T.tmpdir('upgrade-apply-tamperbk3-'), 'backups')
  const r3 = await applyUpgradeDraftPre(batchDraft('tamper3', E3.zones), {
    backupRoot: Ebk3, now: NOW,
    validate: (draftZ, ctx) => { if (String(ctx.wsKey).indexOf('-b--') >= 0) throw new Error('校验器内部爆了'); return { ok: true } },
  })
  T.eq(r3.workspaces[1].code, 'validator-threw', 'E-8 ★校验器抛错 ⇒ 该区 failed（fail-closed，不当通过）')
  T.ok(r3.workspaces[0].ok === true && r3.workspaces[2].ok === true, 'E-9 校验器抛错不中断整批')
  T.eq(await readSha(E3.zones[1].storePath), E3.zones[1].storeBeforeSha, 'E-10 校验器抛错区 store sha 未变')

  const E4 = await makeZones('tamper4')
  const Ebk4 = path.join(T.tmpdir('upgrade-apply-tamperbk4-'), 'backups')
  const r4 = await applyUpgradeDraftPre(batchDraft('tamper4', E4.zones), { backupRoot: Ebk4, now: NOW, validate: () => ({}) })
  T.ok(r4.ok === false && r4.workspaces.every((x) => x.code === 'validate-failed'), 'E-11 ★校验器返回未知形状 ⇒ 全部 fail-closed')

  // manifest 工作区白名单（P1 闸 2 的一部分，经 applier 透传）
  const E5 = await makeZones('mani')
  const Ebk5 = path.join(T.tmpdir('upgrade-apply-manibk-'), 'backups')
  const r5 = await applyUpgradeDraftPre(batchDraft('mani', E5.zones), { backupRoot: Ebk5, now: NOW, manifest: { wsKeys: [E5.zones[0].wsKey] } })
  T.ok(r5.summary.ok === 1 && r5.summary.failed === 2, 'E-12 ★manifest 工作区白名单透传：白名单外的区被拒', JSON.stringify(r5.summary))
  T.eq(await readSha(E5.zones[1].storePath), E5.zones[1].storeBeforeSha, 'E-13 白名单外的区未写盘')
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('')
console.log('== F. 写后失败 ⇒ 整区回滚到原 sha ==')
{
  const F = await makeZones('roll')
  const Fbk = path.join(T.tmpdir('upgrade-apply-rollbk-'), 'backups')
  const boomWrite = async ({ planPath, text }) => {
    if (planPath.indexOf('roll-a') >= 0) throw new Error('白板写入爆炸（故障注入）')
    await writeFile(planPath, text, 'utf8')
    return { ok: true }
  }
  const r = await applyUpgradeDraftPre(batchDraft('roll', F.zones), { backupRoot: Fbk, now: NOW, writePlanFn: boomWrite })
  T.ok(r.workspaces[0].ok === false && r.workspaces[0].code === 'plan-write-failed', 'F-1 ★白板写失败 ⇒ 该区 failed code=plan-write-failed', r.workspaces[0].code)
  T.ok(r.workspaces[0].rolledBack === true, 'F-2 回执标 rolledBack=true')
  T.eq(await readSha(F.zones[0].storePath), F.zones[0].storeBeforeSha, 'F-3 ★★事件库已写但白板失败 ⇒ **整区回滚**，store sha 逐字节等于原 sha')
  T.eq(await readSha(F.zones[0].planPath), F.zones[0].planBeforeSha, 'F-4 白板 sha 也回到原值')
  T.eq((await readStorePre(F.zones[0].storePath)).events.length, 1, 'F-5 回滚区事件数回到 1（没有半成品）')
  T.ok(r.workspaces[1].ok === true && r.workspaces[2].ok === true, 'F-6 其它区照常落盘（回滚不扩散）')

  const rejectWrite = async ({ planPath, text }) => {
    if (planPath.indexOf('roll-a') >= 0) return { ok: false, error: '被闸拒绝' }
    await writeFile(planPath, text, 'utf8')
    return { ok: true }
  }
  const r2 = await applyUpgradeDraftPre(batchDraft('roll', F.zones), { backupRoot: Fbk, now: NOW, writePlanFn: rejectWrite })
  T.ok(r2.workspaces[0].ok === false && r2.workspaces[0].rolledBack === true, 'F-7 ★白板写盘返回 {ok:false} 同样判失败并回滚')
  T.eq(await readSha(F.zones[0].storePath), F.zones[0].storeBeforeSha, 'F-8 {ok:false} 路径 store sha 仍等于原 sha')

  // 非法事件：startMs > endMs 能过 P1（它不管时间序），但过不了 write 前的 validateEventPre
  const F2 = await makeZones('roll2')
  const Fbk2 = path.join(T.tmpdir('upgrade-apply-rollbk2-'), 'backups')
  const d = batchDraft('roll2', F2.zones)
  d.workspaces[0].events[0].startMs = d.workspaces[0].events[0].endMs + 1000
  const r3 = await applyUpgradeDraftPre(d, { backupRoot: Fbk2, now: NOW })
  T.ok(r3.workspaces[0].ok === false && r3.workspaces[0].code === 'event-invalid', 'F-9 ★非法事件（startMs>endMs）⇒ 该区 failed code=event-invalid', r3.workspaces[0].code)
  T.eq(await readSha(F2.zones[0].storePath), F2.zones[0].storeBeforeSha, 'F-10 非法事件区 store sha 未变')
  T.ok(r3.workspaces[1].ok === true && r3.workspaces[2].ok === true, 'F-11 非法事件不中断整批')
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('')
console.log('== G. 参数/路径 fail-closed ==')
{
  const G = await makeZones('args', 1)
  const bytes = await readFile(G.zones[0].storePath)
  const r = await applyUpgradeDraftPre(batchDraft('args', G.zones), { now: NOW })
  T.eq(r.code, 'no-backup-root', 'G-1 ★缺 backupRoot ⇒ 拒绝写盘（no-backup-root）')
  T.ok(Buffer.compare(await readFile(G.zones[0].storePath), bytes) === 0, 'G-2 拒绝时 store 未改动')

  const r2 = await applyUpgradeDraftPre({ runId: 'x' }, { backupRoot: T.tmpdir('upgrade-apply-g2-'), now: NOW })
  T.eq(r2.code, 'no-workspaces', 'G-3 空 workspaces ⇒ no-workspaces（不静默成功）')

  const G2 = await makeZones('noplan', 1)
  const Gbk = path.join(T.tmpdir('upgrade-apply-noplanbk-'), 'backups')
  const r3 = await applyUpgradeDraftPre(batchDraft('noplan', G2.zones), { backupRoot: Gbk, now: NOW, renderPlan: false })
  T.ok(r3.workspaces[0].ok === true && r3.workspaces[0].events === 1, 'G-4 renderPlan=false ⇒ 只写事件库（「找不到 plan-render」的降级路径）')
  T.eq(await readSha(G2.zones[0].planPath), G2.zones[0].planBeforeSha, 'G-5 renderPlan=false ⇒ 白板字节不变')
  T.eq(r3.workspaces[0].planBytes, 0, 'G-6 renderPlan=false ⇒ planBytes=0')

  const ghost = path.join(T.tmpdir('upgrade-apply-ghost-'), '不存在的工作区')
  const ghostDraft = { runId: 'ghost', workspaces: [{ wsKey: '--ghost--', wsPath: ghost, selfCheck: { events: 1, checkpoints: 2, coveredLogs: 2 }, events: [draftEventFor({ tag: 'ghost', log1: '2026-11-01.md', log2: '2026-11-02.md' })] }] }
  const r4 = await applyUpgradeDraftPre(ghostDraft, { backupRoot: path.join(T.tmpdir('upgrade-apply-ghostbk-'), 'b'), now: NOW })
  T.ok(r4.ok === false && r4.workspaces[0].code === 'validate-failed', 'G-7 ★不存在的 wsPath ⇒ 溯源文件缺失被拒（fail-closed）', r4.workspaces[0].code)
  T.ok(fs.existsSync(ghost) === false, 'G-8 被拒的区没有被凭空创建目录')
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('')
console.log('== I. 注入校验器时的扩展字段落盘（idemTag/status/userPercept/constraints）==')
{
  const I = await makeZones('rich', 1)
  const Ibk = path.join(T.tmpdir('upgrade-apply-richbk-'), 'backups')
  const ws = I.zones[0]
  const rich = {
    runId: 'run-rich',
    workspaces: [{
      wsKey: ws.wsKey,
      wsPath: ws.wsPath,
      selfCheck: { events: 1, checkpoints: 2, coveredLogs: 2 },
      events: [draftEventFor(ws, {
        idemTag: 'explicit-idem-tag',
        userPercept: [{ stage: 'accepted', kind: 'preference', text: '用户确认了本次方案' }],
        agentTrace: [{ action: 'rich-apply', result: 'ok' }],
        constraints: ['不得静默丢写'],
        outcomes: ['扩展字段落盘'],
      })],
    }],
  }
  const r = await applyUpgradeDraftPre(rich, { backupRoot: Ibk, now: NOW, validate: () => ({ ok: true }) })
  T.ok(r.workspaces[0].ok === true, 'I-1 注入校验器（允许扩展字段）⇒ 落盘成功', r.workspaces[0].code)
  const st = await readStorePre(ws.storePath)
  const created = st.events.find((e) => e.name === '事件-' + ws.tag)
  T.ok(!!created && created.idemTag === 'explicit-idem-tag', 'I-2 草案显式 idemTag 落盘（幂等键 ①）')
  T.ok(!!created && created.userPercept.length === 1 && created.userPercept[0].stage === 'accepted', 'I-3 userPercept 落盘（情境化记忆）')
  T.ok(!!created && created.agentTrace.length === 1 && created.constraints.length === 1, 'I-4 agentTrace/constraints 落盘')
  T.ok(!!created && created.outcomes.length === 1, 'I-5 outcomes 落盘')
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('')
console.log('== H. 与 P1 校验器的并联状态 ==')
{
  const draftFile = path.join(ROOT, 'lib', 'upgrade-draft.js')
  if (fs.existsSync(draftFile)) {
    let fnType = 'missing'
    try { const m = await import('../../lib/upgrade-draft.js'); fnType = typeof m.validateUpgradeDraftPre } catch (_) {}
    T.eq(fnType, 'function', 'H-1 lib/upgrade-draft.js 已落盘且导出 validateUpgradeDraftPre')
    const H = await makeZones('wired', 1)
    const r = await applyUpgradeDraftPre(batchDraft('wired', H.zones), { backupRoot: path.join(T.tmpdir('upgrade-apply-wiredbk-'), 'b'), now: NOW })
    T.eq(r.validatorSource, 'upgrade-draft', 'H-2 ★并联已联通：apply 自动切到真校验器（validatorSource=upgrade-draft）')
    T.ok(r.workspaces[0].ok === true && r.workspaces[0].events === 1, 'H-3 ★P1 schema 草案真过 P1 校验器并落盘（P1↔P2 集成）', r.workspaces[0].error || '')
  } else {
    T.skip('H-1/H-2/H-3 与 upgrade-draft.js 并联', 'lib/upgrade-draft.js 尚未落盘（P1 待并联）；本模块已按文档签名留动态 import + 注入覆盖')
  }
}

T.done()
