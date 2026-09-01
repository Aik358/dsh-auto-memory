// M6 act.skill 技能段测试(2026-08-30 P0,docs/HANDOFF-M8-M9-M10.md §2 P0 验收):
//   S1  无 skill 时渲染逐字节不变(回归锚:固定边界 + 提示行在 Verify 之前)
//   S2  合法 skill 进入 packet 且渲染出 checklist 段
//   S3  exactDigest 自洽 —— 投递面(renderTailFor 同款重渲染)能复现同一文本
//   S4  非法 skill 被 M6 validator 拒绝(fail-closed)
//   S5  预算不足时整段丢弃 skill,且 packet 不落 skill(保证 build 与重渲染一致)
//   S6  Python 档路径(无 query):候选 ∩ sourceMemoryIds 匹配 → delivered tail 含 checklist
//   S7/S8 不命中 / memoryHubEnabled=false → 无技能段
//   S9  请求已自带 skill(JS 档 query 匹配)时不被候选匹配覆盖
//   S10 CJK 超长 checklist 按 UTF-8 字节裁剪,不切坏字符
//   S11 源码卫生(无 BOM / 无 _dev / 零进程网络原语)
//   S12/S13 确定性与多技能择优
// 全部纯内存 + 临时 DSH_HOME 隔离,零真实记忆接触、零 IO 副作用、零网络。
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

process.on('uncaughtException', (e) => { console.error('[M83-TEST] FATAL:', (e && (e.stack || e.message)) || e); process.exit(1) })
process.on('unhandledRejection', (r) => { console.error('[M83-TEST] REJ:', r); process.exit(1) })
globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({}) })

const tmpHome = mkdtempSync(path.join(tmpdir(), 'dam-m83-'))
process.env.DSH_HOME = tmpHome

const A = await import('../../lib/activation-inbox.js')
const { createActivationHost } = await import('../../lib/activation-host.js')

let pass = 0; let fail = 0
function ok(cond, name) { if (cond) { pass++; console.log('  ok - ' + name) } else { fail++; console.error('  FAIL - ' + name) } }
function eq(a, b, name) { ok(JSON.stringify(a) === JSON.stringify(b), name + (JSON.stringify(a) === JSON.stringify(b) ? '' : ' got=' + JSON.stringify(a))) }

const sha256 = (s) => createHash('sha256').update(String(s), 'utf8').digest('hex')
const memId = (tag) => 'mem_' + sha256('mid:' + tag).slice(0, 32)
/** 构造一条通过 M6 候选校验的语料记录(形状校验,不落盘)。 */
function mkRec(tag, excerpt) {
  return {
    memoryId: memId(tag), anchorId: 'anc_' + sha256('anc:' + tag).slice(0, 16),
    scope: 'Workspace', sourceRef: 'workspace:MEMORY.md',
    sourceEpoch: '33333333-3333-4333-8333-333333333333', sourceVersion: 1,
    fileDigest: sha256('file:' + tag), recordDigest: sha256('rec:' + tag),
    excerpt: excerpt != null ? excerpt : ('参考内容 ' + tag),
  }
}
const MIV = 'idx_' + '7'.repeat(32)
function makeReq(o = {}) {
  const req = A.makeFakeActivationRequestPre({
    seed: o.seed || 'm83-seed', sessionId: 's1', agentId: 'a1', workspaceKey: 'c:/ws-a',
    contextVersion: 7, memoryIndexVersion: MIV, ttlSteps: 5, now: 1700000000000,
    records: o.records || [mkRec('r1'), mkRec('r2')], maxItems: o.maxItems || 2,
  })
  if (o.skill !== undefined) req.skill = o.skill
  return req
}
const DEPLOY_SKILL = {
  procedureId: 'proc_deploy', title: '服务器部署流程', level: 'checklist',
  text: '[技能] 服务器部署流程\n1. pnpm build\n2. rsync 到目标机\n完成标准: 健康检查返回 200',
}
/** 最小 memory-hub 替身:只实现 act.skill 附着用到的三个方法。 */
function makeFakeHub(procedures) {
  const touched = []
  const store = {
    activeProcedures() { return procedures.filter((p) => p.stage === 'active').map((p) => ({ ...p })) },
    renderChecklist(id) {
      const p = procedures.find((x) => x.procedureId === id)
      if (!p || p.stage !== 'active') return null
      const lines = ['[技能] ' + p.title]
      p.steps.forEach((s, i) => lines.push((i + 1) + '. ' + s))
      if (p.successCriteria && p.successCriteria.length) lines.push('完成标准: ' + p.successCriteria.join('; '))
      return {
        procedureId: p.procedureId, title: p.title,
        level: p.riskLevel === 'high' ? 'hint' : 'checklist',
        text: lines.join('\n'),
      }
    },
    touch(id) { touched.push(id); return { ok: true } },
  }
  return { hub: { stores: { procedures: store } }, touched }
}
function makeEngine(hub, cfgPatch = {}) {
  return {
    config: {
      associativeMemoryEnabled: true, activationInboxEnabled: true,
      pythonBackendEnabled: true, activationSource: 'python', // Python 档:无 query 的路径
      memoryHubEnabled: true, ...cfgPatch,
    },
    runtimes: new Map(),
    runtimeFor: () => null,
    state: { ws: 'c:/ws-a' },
    __homedirFn: () => tmpHome,
    _memoryHub: hub,
  }
}
/** 起一个 host 并让 pump 有 runtime 可挂,返回渲染出的真实投递文本(renderTailFor 路径)。 */
function runOffer(hub, req, cfgPatch = {}) {
  const engine = makeEngine(hub, cfgPatch)
  const rt = { key: 'k1', sessionId: 's1', agentId: 'a1', disposed: false, eventCursor: 1 }
  engine.runtimes.set('k1', rt)
  engine.runtimeFor = () => rt
  const host = createActivationHost({ engine })
  host.initCapability({ systemPrompt: { context: () => 'x' } })
  const offered = host.offerExternalActivation(req)
  const text = String(host.renderTailFor({ id: 'a1', session: { id: 's1' } }))
  return { offered, text, host, engine }
}
const PROC_A = {
  procedureId: 'proc_deploy', title: '服务器部署流程', stage: 'active', riskLevel: 'normal',
  sourceMemoryIds: [memId('r1')],
  steps: ['pnpm build', 'rsync 到目标机'], successCriteria: ['健康检查返回 200'],
}
const PROC_B = {
  procedureId: 'proc_other', title: '无关流程', stage: 'active', riskLevel: 'normal',
  sourceMemoryIds: ['mem_' + '0'.repeat(32)],
  steps: ['无关步骤'], successCriteria: [],
}

console.log('[S1] 无 skill 时渲染逐字节不变(回归锚)')
{
  const built = A.buildReferenceTailPacketPre({ request: makeReq(), nowStep: 3 })
  ok(built.ok, 'S1 基线 packet 构建成功')
  const base = built.rendered
  const items = built.packet.references
  const rUndef = A.renderReferenceTail(items, { reason: built.packet.triggerReason, skill: undefined }).text
  const rNull = A.renderReferenceTail(items, { reason: built.packet.triggerReason, skill: null }).text
  const rBad = A.renderReferenceTail(items, { reason: built.packet.triggerReason, skill: { nope: 1 } }).text
  eq(rUndef, base, 'S1 skill=undefined 与基线逐字节一致')
  eq(rNull, base, 'S1 skill=null 与基线逐字节一致')
  eq(rBad, base, 'S1 非法 skill 被忽略、不渲染(与基线一致)')
  ok(base.startsWith(A.TAIL_MARKER_LINE_V1), 'S1 首行固定边界标记行')
  ok(base.trim().endsWith(A.TAIL_VERIFY_LINE_V1), 'S1 末行固定 Verify 收尾行')
  ok(base.indexOf(A.TAIL_FETCH_HINT_LINE_V1) < base.lastIndexOf(A.TAIL_VERIFY_LINE_V1), 'S1 取全文提示行仍在 Verify 之前')
  ok(!base.includes('Checklist:'), 'S1 无 skill 时零 Checklist 行')
}

console.log('[S2] 合法 skill 进入 packet 并渲染 checklist 段')
let s2 = null
{
  const req = makeReq({ skill: DEPLOY_SKILL })
  const built = A.buildReferenceTailPacketPre({ request: req, nowStep: 3 })
  ok(built.ok, 'S2 带 skill 的 packet 构建成功')
  ok(!!(built.packet.skill && built.packet.skill.procedureId === 'proc_deploy'), 'S2 packet.skill 落库(procedureId 正确)')
  const t = built.rendered
  ok(t.includes('Skill: 服务器部署流程'), 'S2 渲染含 Skill 标题行')
  ok(t.includes('Checklist: [技能] 服务器部署流程; 1. pnpm build; 2. rsync 到目标机; 完成标准: 健康检查返回 200'), 'S2 渲染含完整 checklist 正文(换行按卫生规则折叠为 "; ")')
  ok(t.includes('Source: skill:proc_deploy / Procedure / checklist / '), 'S2 技能段带 Source 身份行')
  ok(t.trim().endsWith(A.TAIL_VERIFY_LINE_V1), 'S2 固定边界不变(Verify 仍收尾)')
  ok(A.validateReferenceTailPacketPre(built.packet).ok, 'S2 packet 通过 M6 validator')
  s2 = built
}

console.log('[S3] exactDigest 自洽(投递面重渲染复现同一文本)')
{
  const p = s2.packet
  const re = A.renderReferenceTail(p.references, {
    reason: p.triggerReason, budgetBytes: A.REFERENCE_TAIL_BUDGET_V1.maxPacketBytes, skill: p.skill,
  })
  eq(re.text, s2.rendered, 'S3 重渲染文本与构建时逐字节一致')
  eq(A.computeExactDigest(re.text), p.exactDigest, 'S3 exactDigest 校验通过(renderTailFor 会真实投递,不会降级为空)')
}

console.log('[S4] 非法 skill 被 validator 拒绝(fail-closed)')
{
  const cases = [
    ['空 procedureId', { procedureId: '', title: 't', text: 'x' }, 'skill.procedureId'],
    ['非对象', 'not-an-object', 'skill.not-object'],
    ['缺 text', { procedureId: 'p1', title: 't' }, 'skill.text'],
    ['text 全空白', { procedureId: 'p1', title: 't', text: '   ' }, 'skill.text'],
    ['title 非字符串', { procedureId: 'p1', title: 42, text: 'x' }, 'skill.title'],
  ]
  for (const [name, skill, want] of cases) {
    const v = A.validateActivationRequestPre(makeReq({ skill }))
    ok(v.ok === false && String(v.reason).includes(want), 'S4 ' + name + ' → 拒绝(' + want + ')')
  }
  const okNull = A.validateActivationRequestPre(makeReq({ skill: null }))
  ok(okNull.ok === true, 'S4 skill=null 视为无技能段(合法)')
}

console.log('[S5] 预算竞争:技能段预留制(2026-08-30 canary 修复)——满帧引用不再挤掉技能段')
{
  // 2026-08-30 P0 canary 修复回归:emit 满帧(8×长引用,build 侧 ~3.7KB)时,原「末位计价」
  // 实现必把技能段挤出 4096 预算(skillDropped),真实投递永不含 checklist。
  // 修复后:技能段先预留成本,引用按分数装填,装不下的低分引用走 dropped/truncated。
  const recs = []
  for (let i = 0; i < 8; i++) recs.push(mkRec('big' + i, 'x'.repeat(400)))
  const req = makeReq({ records: recs, maxItems: 8, skill: DEPLOY_SKILL, seed: 'm83-budget' })
  const built = A.buildReferenceTailPacketPre({ request: req, nowStep: 1 })
  ok(built.ok, 'S5 满预算下 packet 仍构建成功')
  ok(built.packet.skill !== undefined && built.packet.skill.procedureId === DEPLOY_SKILL.procedureId, 'S5 技能段预留生效 → packet 落 skill(满帧引用不再挤掉它)')
  ok(built.rendered.includes('Checklist:'), 'S5 渲染文本含 checklist(投递面真实可见)')
  ok(Array.isArray(built.droppedByBudget) && built.droppedByBudget.length > 0, 'S5 满帧+技能段下让位的是低分引用(部分 reference 被预算裁掉),而非技能段')
  const re = A.renderReferenceTail(built.packet.references, {
    reason: built.packet.triggerReason, budgetBytes: A.REFERENCE_TAIL_BUDGET_V1.maxPacketBytes, skill: built.packet.skill,
  })
  eq(A.computeExactDigest(re.text), built.packet.exactDigest, 'S5 预留制下 exactDigest 仍自洽(build/render 双侧同函数重算)')
  // 技能段自身超预算(而非被引用挤掉)→ 仍必须显式 skillDropped
  const smallItem = {
    memoryId: memId('x1'), scope: 'Workspace', sourceVersion: 1,
    recordDigest: sha256('digest:x1'), score: 0.9, reference: '短引用',
  }
  const flag = A.renderReferenceTail([smallItem], { reason: 'r', budgetBytes: 400, skill: DEPLOY_SKILL })
  ok(flag.ok === true && flag.skillDropped === true && flag.skillIncluded === false, 'S5 技能段自身放不下时仍显式上报 skillDropped')
  ok(!flag.text.includes('Checklist:') && flag.text.trim().endsWith(A.TAIL_VERIFY_LINE_V1), 'S5 丢弃技能段后仍保有引用块与固定收尾行')
}

console.log('[S6] Python 档路径:候选 ∩ sourceMemoryIds 匹配 → 投递文本含 checklist')
{
  const { hub, touched } = makeFakeHub([PROC_A, PROC_B])
  const { offered, text } = runOffer(hub, makeReq({ seed: 'm83-s6' }))
  ok(offered.ok === true, 'S6 python 来源 offer 被接受(outcome=' + (offered.outcome || offered.reason) + ')')
  ok(text.length > 0, 'S6 renderTailFor 返回非空尾注(digest 校验通过即真实投递)')
  ok(text.includes('Checklist: [技能] 服务器部署流程'), 'S6 delivered tail 含技能 checklist 段落')
  ok(text.includes('1. pnpm build'), 'S6 delivered tail 含技能步骤文本')
  eq(touched, ['proc_deploy'], 'S6 命中技能 touch(last_used 时钟)被调用一次')
}

console.log('[S7/S8] 不命中 / 中枢关闭 → 零技能段')
{
  const h1 = makeFakeHub([PROC_B])
  const r1 = runOffer(h1.hub, makeReq({ seed: 'm83-s7' }))
  ok(r1.offered.ok === true && r1.text.length > 0, 'S7 无交集时 offer 与投递正常(不因技能阻断主链路)')
  ok(!r1.text.includes('Checklist:'), 'S7 sourceMemoryIds 不交集 → 无技能段')
  eq(h1.touched, [], 'S7 未命中不 touch')

  const h2 = makeFakeHub([PROC_A])
  const r2 = runOffer(h2.hub, makeReq({ seed: 'm83-s8' }), { memoryHubEnabled: false })
  ok(r2.text.length > 0 && !r2.text.includes('Checklist:'), 'S8 memoryHubEnabled=false → 无技能段(门控生效)')

  const h3 = makeFakeHub([PROC_A])
  const r3 = runOffer(h3.hub, makeReq({ seed: 'm83-s8b' }), { procedurePromotionEnabled: false })
  ok(r3.text.length > 0 && !r3.text.includes('Checklist:'), 'S8 procedurePromotionEnabled=false → 无技能段')
}

console.log('[S9] 请求已自带 skill(JS 档 query 匹配)不被覆盖')
{
  const { hub, touched } = makeFakeHub([PROC_A])
  const jsSkill = { procedureId: 'proc_jsquery', title: '来自 JS 档 query 匹配', level: 'checklist', text: '[技能] 来自 JS 档 query 匹配\n1. query 命中的步骤' }
  const { text } = runOffer(hub, makeReq({ seed: 'm83-s9', skill: jsSkill }))
  ok(text.includes('Skill: 来自 JS 档 query 匹配'), 'S9 保留 JS 档 query 匹配结果')
  ok(text.includes('query 命中的步骤'), 'S9 delivered tail 用的是 JS 档 checklist')
  ok(!text.includes('proc_deploy'), 'S9 未被候选交集匹配覆盖(交集路径只在无 skill 时兜底)')
  eq(touched, [], 'S9 已有 skill 时不重复 touch 其他技能')
}

console.log('[S10] CJK 超长 checklist 按 UTF-8 字节裁剪')
{
  ok(Object.isFrozen(A.SKILL_TAIL_BUDGET_V1), 'S10 技能段预算常量冻结')
  const longSkill = { procedureId: 'proc_long', title: '长流程', level: 'checklist', text: '一'.repeat(2000) }
  const built = A.buildReferenceTailPacketPre({ request: makeReq({ skill: longSkill, seed: 'm83-s10' }), nowStep: 2 })
  ok(built.ok, 'S10 超长技能文本不炸包')
  ok(!built.rendered.includes('\uFFFD'), 'S10 裁剪未产生替换字符(未切坏多字节字符)')
  ok(Buffer.byteLength(built.rendered, 'utf8') <= A.REFERENCE_TAIL_BUDGET_V1.maxPacketBytes, 'S10 整包仍在 4096 字节预算内')
  const m = /Checklist: ([\s\S]*)$/.exec(built.rendered.split('\n').find((l) => l.startsWith('Checklist: ')) || '')
  ok(!!m && Buffer.byteLength(m[1], 'utf8') <= A.SKILL_TAIL_BUDGET_V1.maxTextBytes, 'S10 checklist 正文 ≤ 1200 字节')
  const re = A.renderReferenceTail(built.packet.references, { reason: built.packet.triggerReason, budgetBytes: A.REFERENCE_TAIL_BUDGET_V1.maxPacketBytes, skill: built.packet.skill })
  eq(A.computeExactDigest(re.text), built.packet.exactDigest, 'S10 裁剪后 digest 自洽')
  eq(A.clipBytes('一二三', 5), '一', 'S10 clipBytes 回退到字符边界(3 字节/字)')
}

console.log('[S11] 源码卫生')
{
  for (const f of ['lib/activation-inbox.js', 'lib/activation-host.js']) {
    const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', f))
    ok(src[0] !== 0xef && src[1] !== 0xbb && src[2] !== 0xbf, 'S11 ' + f + ' 无 BOM')
    ok(!src.includes('_dev'), 'S11 ' + f + ' 无 _dev 残留')
    const s = src.toString('utf8')
    ok(!/from\s+'(node:net|node:http|node:child_process|node:dgram)'/.test(s) && !/require\('(net|http|child_process)'\)/.test(s), 'S11 ' + f + ' 零进程/网络原语')
  }
}

console.log('[S12/S13] 确定性与多技能择优')
{
  const b1 = A.buildReferenceTailPacketPre({ request: makeReq({ skill: DEPLOY_SKILL }), nowStep: 4 })
  const b2 = A.buildReferenceTailPacketPre({ request: makeReq({ skill: DEPLOY_SKILL }), nowStep: 4 })
  eq(b1.packet.exactDigest, b2.packet.exactDigest, 'S12 同输入同 digest(确定性)')
  eq(b1.packet.packetId, b2.packet.packetId, 'S12 同输入同 packetId')

  // 两个技能都命中候选:proc_two 命中 2 条 > proc_one 命中 1 条 → 取交集数最多者
  const two = {
    procedureId: 'proc_two', title: '双命中流程', stage: 'active', riskLevel: 'normal',
    sourceMemoryIds: [memId('r1'), memId('r2')], steps: ['步骤二'], successCriteria: [],
  }
  const { hub, touched } = makeFakeHub([PROC_A, two])
  const { text } = runOffer(hub, makeReq({ seed: 'm83-s13' }))
  ok(text.includes('Skill: 双命中流程'), 'S13 多技能命中取交集数最多者(2 > 1)')
  eq(touched, ['proc_two'], 'S13 只 touch 胜出技能')
}

try { rmSync(tmpHome, { recursive: true, force: true }) } catch (_) {}
console.log('\n[M83] ' + pass + ' passed, ' + fail + ' failed')
if (fail > 0) process.exitCode = 1
