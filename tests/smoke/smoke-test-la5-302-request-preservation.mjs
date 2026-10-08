/**
 * smoke-test-la5-302-request-preservation —— #302 长用户请求跨接续保全验收（2026-10-08）。
 *
 * 缺陷：单条用户消息 > PER_MSG(2000) 时被 slimTranscriptPre 截断，且第 2 层近期线程用的是
 *   同一份**已截断**的 msgs（m.text.slice(0,700)）⇒ 目标位于 2000 之后的请求在**所有层**都拿不到。
 * 修法（按已批准契约）：新增 handoffDir/prev-req-<sha256(sid)16hex>-<stamp>-s<contSeq>.md
 *   （wx 拒绝覆盖；仅当存在超长用户消息时写；写失败必须中止本次接续），路径并入永不截断的导航区。
 *
 * 判据纪律：真 MemoryEngine + 真隔离 DSH_HOME + 真会话文件；断言返回值与真实落盘。
 * 负路径用定点变异载入 index.js，断言必红。纯 Node、零依赖、不联网。
 */
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'

const ROOT = path.resolve(import.meta.dirname, '..', '..')
let pass = 0, fail = 0
const ok = (c, n) => { if (c) { pass++; console.log('  ok - ' + n) } else { fail++; console.error('  FAIL - ' + n) } }
const eq = (a, b, n) => { const ja = JSON.stringify(a), jb = JSON.stringify(b); ok(ja === jb, n + (ja === jb ? '' : ' got=' + ja + ' want=' + jb)) }
const tmps = []
const mkroot = (t) => { const d = mkdtempSync(path.join(tmpdir(), 'dam-la5-' + t + '-')); tmps.push(d); return d }
let seq = 0
async function loadEngine(mutations = []) {
  const shim = path.join(ROOT, 'tests', 'lib', 'state-engine.mjs')
  if (!mutations.length) { delete process.env.DAM_STATE_ENGINE_SOURCE; return await import(pathToFileURL(shim).href + '?v=' + (++seq)) }
  let src = readFileSync(path.join(ROOT, 'lib', 'index.js'), 'utf8')
  for (const [from, to] of mutations) {
    const hits = src.split(from).length - 1
    assert.equal(hits, 1, 'mutation anchor must hit exactly once: ' + JSON.stringify(from.slice(0, 60)) + ' hits=' + hits)
    src = src.replace(from, to)
  }
  const f = path.join(mkroot('mut'), 'idx-' + (++seq) + '.mjs')
  writeFileSync(f, src, 'utf8')
  process.env.DAM_STATE_ENGINE_SOURCE = f
  const m = await import(pathToFileURL(shim).href + '?v=' + (++seq))
  delete process.env.DAM_STATE_ENGINE_SOURCE
  return m
}
function isolate(tag) {
  const root = mkroot(tag), home = path.join(root, 'home'), wsReal = path.join(root, 'realws')
  mkdirSync(home, { recursive: true })
  mkdirSync(wsReal, { recursive: true })
  const saved = {}
  for (const k of ['HOME', 'USERPROFILE', 'DSH_HOME']) { saved[k] = process.env[k]; process.env[k] = home }
  return { root, home, wsReal, restore: () => { for (const k of Object.keys(saved)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] } } }
}
const WS = '--D--ws--'
const SID = 'aaaaaaaa-1111-2222-3333-444444444444'
const NLc = String.fromCharCode(10)
/** 真造会话文件：事件形状照抄 messageOfEvent 消费的 `data.message`。 */
function writeSession (home, sid, texts, wsReal) {
  const dir = path.join(home, 'sessions', WS, sid)
  mkdirSync(dir, { recursive: true })
  const cwd = wsReal || 'D:/ws'
  const evs = [
    JSON.stringify({ type: 'request/header', data: { header: { config: { provider: 'p1', model: 'm1' } } }, cwd }),
    JSON.stringify({ type: 'request/context', data: { contextWindow: 100000, cwd } }),
  ]
  for (const t of texts) {
    const role = t.role || 'user'
    evs.push(JSON.stringify({ type: role + '/message', data: { message: { role, content: [{ type: 'text', text: t.text }] } } }))
  }
  writeFileSync(path.join(dir, 'session.jsonl'), evs.join(NLc) + NLc, 'utf8')
}
/** 超长请求：目标文本置于**索引 >2000 处**（与契约 P1 同形）。 */
function longRequest (goal) {
  return 'FILLER'.repeat(360) + ' GOAL:' + goal + ' END'
}
const GOAL = '把 X 模块的 Y 约束保留到新会话'
console.log('[P1] 正路径：超长请求 => 产物存在 + 含尾部目标 + 导航区含路径')
{
  const iso = isolate('p1')
  try {
    const mod = await loadEngine()
    const eng = new mod.MemoryEngine()
    const req = longRequest(GOAL)
    ok(req.length > 2000, '★ 前置：请求长度 ' + req.length + ' > 2000（正是会被截断的区间）')
    ok(req.indexOf('GOAL:') > 2000, '★ 前置：目标位于索引 ' + req.indexOf('GOAL:') + ' > 2000（截断点之后）')
    writeSession(iso.home, SID, [{ text: 'first' }, { text: req }, { role: 'assistant', text: 'done' }], iso.wsReal)
    const pack = await eng.buildPrevSessionPack(SID)
    ok(!!pack && !!pack.userRequestPath, '★ pack.userRequestPath 非空')
    ok(existsSync(pack.userRequestPath), '★ ①产物文件真实存在')
    const body = readFileSync(pack.userRequestPath, 'utf8')
    ok(body.includes(GOAL), '★ ②文件内容含**尾部**目标文本（旧实现所有层都拿不到）')
    ok(body.includes('- 来源会话: ' + SID), '文件头含来源会话身份')
    ok(/^prev-req-[0-9a-f]{16}-\d{17}-s\d+\.md$/.test(path.basename(pack.userRequestPath)), '★ 命名形态 prev-req-<16hex>-<stamp17>-s<seq>.md（实 ' + path.basename(pack.userRequestPath) + '）')
    // 与转写同族：同一 contSeq
    const t = path.basename(pack.transcriptPath), q = path.basename(pack.userRequestPath)
    eq(q.split('-').pop(), t.split('-').pop(), '★ 与转写**复用同一次已预留的 contSeq**（后缀一致）')
    eq(q.split('-').slice(2, 3), t.split('-').slice(2, 3), '★ 与转写**同一 sha256 身份段**')
    // carry 导航区
    const carry = await eng.buildContinueCarry(SID)
    ok(carry && carry.ok, 'buildContinueCarry 成功' + (carry && carry.ok ? '' : ' error=' + (carry && carry.error)))
    if (!(carry && carry.ok)) throw new Error('carry failed: ' + (carry && carry.error))
    ok(carry.carryText.includes(carry.userRequestPath), '★ ③carryText 的导航区含该绝对路径（可 read）')
    ok(carry.carryText.includes('用户请求原文'), '导航区含「用户请求原文」指引文案')
    ok(carry.carryText.includes(GOAL) === false, '★ ④carry 正文仍**不含**目标原文（产物是补充而非替代；nan 2,000 上限未动）')
    ok(!!carry.userRequestPath && /^prev-req-/.test(path.basename(carry.userRequestPath)), 'buildContinueCarry 回传自身的 prev-req 产物路径（内部会再跑一次 pack ⇒ contSeq 自增，属既有行为）')
    // 目标确实不在转写里（证明缺陷真实存在、产物是唯一出路）
    const tr = readFileSync(pack.transcriptPath, 'utf8')
    ok(tr.includes(GOAL) === false, '★ 目标**不在**转写里（证明旧路径确实丢失；产物是唯一落点）')
  } finally { iso.restore() }
}

console.log('[P2] 守恒：短请求 => 不新增文件 + carry 逐字节不变')
{
  const iso = isolate('p2')
  try {
    const mod = await loadEngine()
    const eng = new mod.MemoryEngine()
    writeSession(iso.home, SID, [{ text: 'SHORT-REQUEST-OK' }, { role: 'assistant', text: 'ack' }], iso.wsReal)
    const pack = await eng.buildPrevSessionPack(SID)
    eq(pack.userRequestPath, '', '★ 短请求 => userRequestPath 为空（不写文件）')
    const hp = path.dirname(pack.transcriptPath)
    const reqs = readdirSync(hp).filter(n => /^prev-req-/.test(n))
    eq(reqs.length, 0, '★ 不新增任何 prev-req-* 文件（目录计数量化）')
    const carry = await eng.buildContinueCarry(SID)
    ok(carry.carryText.includes('用户请求原文') === false, '★ 导航区**不含**该行（短请求零影响）')
    eq(carry.userRequestPath, '', 'carry.userRequestPath 为空')
    // ★守恒判据：carryText 内每轮都会变的只有**本轮转写文件名**（stamp+contSeq，属既有行为，
    //   与本产物无关）。归一化掉该易变片段后，与「**摘除本产物 nav 行**的基线实现」逐字节比对：
    //   短请求下两棵树必须产出完全相同的 carryText。
    const norm = (s) => s.replace(/prev-session-[0-9a-f]{16}-\d{17}-s\d+/g, 'prev-session-HASH-STAMP-SEQ')
    const h1 = createHash('sha256').update(norm(carry.carryText)).digest('hex')
    const MUT = 'if (pack.userRequestPath) {'
    const mBase = await loadEngine([[MUT, 'if (false) {']])
    const eng2 = new mBase.MemoryEngine()
    const carry2 = await eng2.buildContinueCarry(SID)
    const h2 = createHash('sha256').update(norm(carry2.carryText)).digest('hex')
    eq(h1, h2, '★ 短请求 carry 与「摘除本产物 nav 行」的基线**逐字节相同**（sha256 ' + h1.slice(0,16) + '）')
  } finally { iso.restore() }
}console.log('[P3] 失败语义：写失败 => 中止接续（带 statePersistence）+ 未取消源回合 + contSeq 不回退')
{
  const iso = isolate('p3')
  const RealDate = Date
  try {
    const mod = await loadEngine()
    const eng = new mod.MemoryEngine()
    const req = longRequest(GOAL)
    writeSession(iso.home, SID, [{ text: req }], iso.wsReal)
    // ★冻结时钟 ⇒ stamp 可预测；contSeq 从 1 起 ⇒ 目标路径**完全可预先算出**。
    //   这样就能在命名位置上放一个**同名目录**，让 wx 打开必然失败（EISDIR/EEXIST），
    //   从而真触发「写失败」分支 —— 而不是靠不可预知的路径碰运气。
    const FIXED = 1759900000123
    class FakeDate extends RealDate {
      constructor (...a) { if (a.length === 0) super(FIXED); else super(...a) }
      static now () { return RealDate.now() }
    }
    globalThis.Date = FakeDate
    const sidHash = createHash('sha256').update(SID).digest('hex').slice(0, 16)
    const stamp = new Date(FIXED).toISOString().replace(/[-:.TZ]/g, '')
    const p = await eng.resolvePathsForSession(SID)
    ok(p.wsBound !== false && !!p.ws, '前置：源工作区成功绑定（wsBound=true）')
    mkdirSync(p.handoffDir, { recursive: true })
    // ★必须占住**整个序号区间**：contSeq 每次调用都自增（s1→s2→…），只占 s1 的话
    //   第二次调用就会落到 s2 而「意外成功」——那会测出一个假绿。故把 s1..s40 全部占死。
    let blockedCount = 0
    for (let i = 1; i <= 40; i++) {
      const bp = path.join(p.handoffDir, 'prev-req-' + sidHash + '-' + stamp + '-s' + i + '.md')
      mkdirSync(bp, { recursive: true })
      blockedCount++
    }
    ok(blockedCount === 40, '前置：已在命名位置预置 40 个同名**目录**（占死 s1..s40 ⇒ 任一轮必然 EEXIST）')
    // ① buildPrevSessionPack 必须**抛出**带 statePersistence 标记的错误（不 fail-soft 返回 null）
    let threw = null
    try { await eng.buildPrevSessionPack(SID) } catch (e) { threw = e }
    ok(!!threw, '★ ①产物写失败 => buildPrevSessionPack **上抛**（不是 fail-soft 返回 null）')
    eq(!!(threw && threw.statePersistence), true, '★ 错误带 statePersistence 标记（穿透两处 fail-soft catch 的唯一凭据）')
    ok(String(threw.message).includes('user request dump failed'), '错误信息指明是产物写失败（实 ' + String(threw.message).slice(0, 60) + '...）')
    // ② buildContinueCarry 必须 ok:false（材料不完整即拒绝，不静默给部分材料）
    const carry = await eng.buildContinueCarry(SID)
    eq(carry.ok, false, '★ ②buildContinueCarry 返回 ok:false（不静默返回部分材料）')
    ok(!carry.carryText, '★ 失败时**不返回** carryText（杜绝半份材料被投递）')
    // ③ 源回合未被取消：hostAutoContinue 的顺序是「先 carry 后 cancel」，carry 抛错即在 cancel 之前终止
    let cancelCalls = 0
    eng._sessionController = { create: async () => ({ ok: true }), prompt: async () => ({ ok: true }), cancel: async () => { cancelCalls++ } }
    eng._autoContState = { armed: { sessionId: SID, manual: true }, executing: false }
    const res = await eng.hostAutoContinue()
    eq(res.ok, false, '★ ③hostAutoContinue 失败（接续被中止）')
    eq(cancelCalls, 0, '★ 源回合**未被取消**（cancel 调用计数 = 0 —— 顺序天然满足「中止在取消之前」）')
    // ④ contSeq 高水位不回退（允许空洞、永不回收）
    const after = await eng.peekContSeq ? await eng.peekContSeq(p.ws) : null
    // 无 peek API ⇒ 用「下次分配值」间接验证：下一次 allocContSeq 必须 > 本轮已预留值
    const nextSeq = await eng.allocContSeq(p.ws)
    ok(nextSeq > 1, '★ ④contSeq 高水位**不回退**（失败后下次分配 ' + nextSeq + ' > 1，即空洞保留、不复用）')
  } finally { globalThis.Date = RealDate; iso.restore() }
}

console.log('[P4] 命名唯一性：同源多次 => 文件名唯一 + 旧文件不被覆盖')
{
  const iso = isolate('p4')
  try {
    const mod = await loadEngine()
    const eng = new mod.MemoryEngine()
    const req = longRequest(GOAL)
    writeSession(iso.home, SID, [{ text: req }], iso.wsReal)
    const a = await eng.buildPrevSessionPack(SID)
    const bodyA = readFileSync(a.userRequestPath, 'utf8')
    const b = await eng.buildPrevSessionPack(SID)
    ok(a.userRequestPath !== b.userRequestPath, '★ 同源两次 => 产物路径不同（contSeq 区分）')
    eq(readFileSync(a.userRequestPath, 'utf8'), bodyA, '★ 旧产物**内容未被覆盖**（逐字节相同）')
    ok(existsSync(b.userRequestPath), '新产物存在')
    const n = readdirSync(path.dirname(a.userRequestPath)).filter(x => /^prev-req-/.test(x))
    eq(n.length, 2, '两份 prev-req 产物并存（不互相覆盖）')
  } finally { iso.restore() }
}

console.log('[P5] 正则边界：三处既有判据均**不**识别新文件名（防误识别）')
{
  const iso = isolate('p5')
  try {
    const mod = await loadEngine()
    const eng = new mod.MemoryEngine()
    const req = longRequest(GOAL)
    writeSession(iso.home, SID, [{ text: req }], iso.wsReal)
    const pack = await eng.buildPrevSessionPack(SID)
    const base = path.basename(pack.userRequestPath)
    const dir = path.dirname(pack.userRequestPath)
    // ① listPrevSessionTranscripts（真执行）
    const listed = await eng.listPrevSessionTranscripts(dir, 20)
    ok(!listed.includes(base), '★ ①listPrevSessionTranscripts 不含新产物（否则会被当成转写、挤占 8 篇配额）')
    ok(listed.some(x => /^prev-session-/.test(x)), '对照：转写仍被它识别（证明该函数真的在列举）')
    // ② listHandoffLedgers（真执行）
    const ledgers = await eng.listHandoffLedgers(dir, 20)
    ok(!ledgers.includes(base), '★ ②listHandoffLedgers 不含新产物（账本/白板血缘不受污染）')
    // ③ fileQ 白名单（真执行面板入口）
    const fd = await eng.handoffPanelData(base, SID).catch((e) => ({ error: String(e && e.message) }))
    eq(fd && fd.error, 'bad file name', '★ ③fileQ 白名单拒绝新产物（面板不给任意文件开口子）')
    // 对照：PLAN.md 是合法白名单项
    const fdOk = await eng.handoffPanelData('PLAN.md', SID).catch(() => null)
    ok(!fdOk || fdOk.error !== 'bad file name', '对照：PLAN.md 通过白名单（证明该守卫真的在判）')
  } finally { iso.restore() }
}
console.log('[D] 负路径（变异必红 -> 还原必绿）')
{
  const iso = isolate('mut')
  try {
    // M1：去掉「仅当存在超长消息」条件 ⇒ 短请求也建文件（P2 必红）
    const m1 = await loadEngine([
      ["      if (longUserMsgs.length) {", "      if (true) {"],
    ])
    const e1 = new m1.MemoryEngine()
    writeSession(iso.home, SID, [{ text: 'SHORT-REQUEST-OK' }, { role: 'assistant', text: 'ack' }], iso.wsReal)
    const q1 = await e1.buildPrevSessionPack(SID)
    ok(!!q1 && q1.userRequestPath !== '', 'M1 变异（去掉超长条件）⇒ 短请求也建产物：P2「不新增文件」必红')
    ok(existsSync(q1.userRequestPath), 'M1 变异产物真实落盘')

    // M2：把产物写失败改成 fail-soft（吞掉、不上抛）⇒ P3 必红
    const m2 = await loadEngine([
      ["          throw stateError('user request dump failed: ' + userReqPath + ': ' + ((eQ && eQ.message) || eQ), eQ)", "          userReqPath = ''"],
    ])
    const realDate = Date
    const FIXED = 1759900000123
    class FD extends realDate { constructor (...a) { if (a.length === 0) super(FIXED); else super(...a) } static now () { return realDate.now() } }
    globalThis.Date = FD
    try {
      const e2 = new m2.MemoryEngine()
      writeSession(iso.home, SID, [{ text: longRequest(GOAL) }], iso.wsReal)
      const sidHash = createHash('sha256').update(SID).digest('hex').slice(0, 16)
      const stamp = new Date(FIXED).toISOString().replace(/[-:.TZ]/g, '')
      const p = await e2.resolvePathsForSession(SID)
      mkdirSync(p.handoffDir, { recursive: true })
      for (let i = 1; i <= 40; i++) mkdirSync(path.join(p.handoffDir, 'prev-req-' + sidHash + '-' + stamp + '-s' + i + '.md'), { recursive: true })
      let threw2 = null
      try { await e2.buildPrevSessionPack(SID) } catch (e) { threw2 = e }
      ok(!threw2, 'M2 变异（写失败改 fail-soft）⇒ 不再上抛：P3「中止接续」必红（实未抛）')
      const c2 = await e2.buildContinueCarry(SID)
      ok(!!c2 && c2.ok !== false, 'M2 变异 ⇒ buildContinueCarry 仍 ok:true（材料不完整却继续）')
      // 源回合会被照常取消（缺陷语义复现）
      let cancel2 = 0
      e2._sessionController = { create: async () => ({ ok: true }), prompt: async () => ({ ok: true }), cancel: async () => { cancel2++ } }
      e2._autoContState = { armed: { sessionId: SID, manual: true }, executing: false }
      await e2.hostAutoContinue()
      ok(cancel2 === 1, 'M2 变异 ⇒ 源回合**被取消**（cancel=' + cancel2 + '）：正是契约要防的「先破坏用户现场再发现丢料」')
    } finally { globalThis.Date = realDate }

    // M3：把 wx 改回普通覆盖写 ⇒ 已存在产物会被静默覆盖（P4/P1 必红）
    const m3 = await loadEngine([
      ["          await writeFile(userReqPath, reqBody.join(NL), { encoding: 'utf8', flag: 'wx' })", "          await writeFile(userReqPath, reqBody.join(NL), 'utf8')"],
    ])
    // 用真实探针证明：wx 版拒绝、无 wx 版覆盖（直接对同一路径二次写）
    const gf = path.join(mkroot('wx'), 'x.md')
    writeFileSync(gf, 'ORIGINAL', 'utf8')
    let ex = null
    try { await (await import('node:fs/promises')).writeFile(gf, 'CLOBBER', { encoding: 'utf8', flag: 'wx' }) } catch (e) { ex = e }
    ok(!!ex && ex.code === 'EEXIST', 'M3 对照：flag:wx 对已存在路径明确 EEXIST（产线防线有效）')
    eq(readFileSync(gf, 'utf8'), 'ORIGINAL', 'M3 对照：wx 被拒后原内容不变')
    await (await import('node:fs/promises')).writeFile(gf, 'CLOBBER', 'utf8')
    eq(readFileSync(gf, 'utf8'), 'CLOBBER', 'M3 对照：去掉 wx ⇒ 静默覆盖（这正是被变异掉的防线）')
  } finally { iso.restore() }
}

console.log('[E] 还原必绿：未变异实现在同一批场景下全部正确')
{
  const iso = isolate('restore')
  try {
    const mod = await loadEngine()
    const eng = new mod.MemoryEngine()
    const req = longRequest(GOAL)
    writeSession(iso.home, SID, [{ text: req }], iso.wsReal)
    const pack = await eng.buildPrevSessionPack(SID)
    ok(!!pack.userRequestPath && existsSync(pack.userRequestPath), '★ 还原：产物已生成（必绿）')
    ok(readFileSync(pack.userRequestPath, 'utf8').includes(GOAL), '★ 还原：含尾部目标（必绿）')
    writeSession(iso.home, SID + '-short', [{ text: 'SHORT-OK' }], iso.wsReal)
    const sp = await eng.buildPrevSessionPack(SID + '-short')
    eq(sp.userRequestPath, '', '★ 还原：短请求不建产物（必绿）')
  } finally { iso.restore() }
}

console.log('')
console.log('L-A5 smoke: ' + pass + ' PASS / ' + fail + ' FAIL')
for (const d of tmps) { try { rmSync(d, { recursive: true, force: true, maxRetries: 5 }) } catch (_) {} }
if (fail > 0) process.exit(1)

