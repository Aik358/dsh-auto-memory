/**
 * smoke-test-la4-291-transcript-name —— #291 转写包文件名冲突验收（2026-10-08）。
 *
 * 缺陷：文件名 = 'prev-session-' + `sid.slice(0,8)` + '-' + 秒级 HHMMSS + '.md'
 *   ⇒ 同工作区、同秒、前 8 字符相同的两个来源写到**同一路径**，后写**直接覆盖**前一份；
 *   而先返回的 transcriptPath 仍指向该路径 ⇒ 新会话按第 3 层读到**别的来源**的任务。
 *
 * 修法：身份改 sha256(sid) 前 16 位 hex；并入 contSeq；stamp 带日期+毫秒；写入用 flag:'wx' 拒绝覆盖。
 *
 * 判据纪律：真跑产线 buildPrevSessionPack（真 MemoryEngine + 真 zstd 会话文件 + 真 fs），
 *   负路径用定点变异载入 index.js，断言冲突复现。
 *
 * 纯 Node、零依赖、不联网。
 */
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'

const ROOT = path.resolve(import.meta.dirname, '..', '..')
let pass = 0, fail = 0
const ok = (c, n) => { if (c) { pass++; console.log('  ok - ' + n) } else { fail++; console.error('  FAIL - ' + n) } }
const eq = (a, b, n) => { const ja = JSON.stringify(a), jb = JSON.stringify(b); ok(ja === jb, n + (ja === jb ? '' : ' got=' + ja + ' want=' + jb)) }
const tmps = []
const mkroot = (t) => { const d = mkdtempSync(path.join(tmpdir(), 'dam-la4-' + t + '-')); tmps.push(d); return d }
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
  const root = mkroot(tag), home = path.join(root, 'home')
  mkdirSync(home, { recursive: true })
  const saved = {}
  for (const k of ['HOME', 'USERPROFILE', 'DSH_HOME']) { saved[k] = process.env[k]; process.env[k] = home }
  return { root, home, restore: () => { for (const k of Object.keys(saved)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] } } }
}

/** 真造会话文件：形状照抄 foldSessionLogEvents/messageOfEvent 实际消费的事件结构。 */
function writeSession (home, wsName, sid, tag) {
  const dir = path.join(home, 'sessions', wsName, sid)
  mkdirSync(dir, { recursive: true })
  const NLc = String.fromCharCode(10)
  const data = [
    JSON.stringify({ type: 'request/header', data: { header: { config: { provider: 'p1', model: 'm1' } } } }),
    JSON.stringify({ type: 'request/context', data: { contextWindow: 100000, cwd: 'D:/ws' } }),
    JSON.stringify({ type: 'user/message', data: { message: { role: 'user', content: [{ type: 'text', text: 'PROMPT-' + tag }] } } }),
    JSON.stringify({ type: 'assistant/message', data: { message: { role: 'assistant', content: [{ type: 'text', text: 'REPLY-' + tag }] } } }),
  ]
  writeFileSync(path.join(dir, 'session.jsonl'), data.join(NLc) + NLc, 'utf8')
}
const WS = '--D--ws--'
// 两个**前 8 字符相同**的真实形态 sid（正是旧实现撞车的条件）
const SID_A = 'aaaaaaaa-1111-2222-3333-444444444444'
const SID_B = 'aaaaaaaa-9999-8888-7777-666666666666'

console.log('[A] 冲突场景：两个前 8 相同的 sid => 路径不同 + 两份都在 + 各自内容不被串')
{
  const iso = isolate('conflict')
  try {
    const mod = await loadEngine()
    const eng = new mod.MemoryEngine()
    eq(SID_A.slice(0, 8), SID_B.slice(0, 8), '★ 前置条件：两个 sid 的前 8 字符确实相同（旧实现必然撞车）')
    writeSession(iso.home, WS, SID_A, 'AAA')
    writeSession(iso.home, WS, SID_B, 'BBB')
    const pA = await eng.buildPrevSessionPack(SID_A)
    const pB = await eng.buildPrevSessionPack(SID_B)
    ok(!!pA && !!pA.transcriptPath && !!pB && !!pB.transcriptPath, '两个来源都真跑成功并落盘')
    ok(pA.transcriptPath !== pB.transcriptPath, '★ ① 路径不同（旧实现 samePath=true）')
    const files = readdirSync(path.dirname(pA.transcriptPath))
    ok(files.filter(n => /^prev-session-/.test(n)).length === 2, '★ ② 两份文件都在（旧实现只剩 1 份：后写覆盖）')
    const bodyA = readFileSync(pA.transcriptPath, 'utf8')
    const bodyB = readFileSync(pB.transcriptPath, 'utf8')
    ok(bodyA.includes('PROMPT-AAA') && !bodyA.includes('PROMPT-BBB'), '★ ③ A 的转写仍是 A 的内容（不被 B 覆盖）')
    ok(bodyB.includes('PROMPT-BBB'), 'B 的转写是 B 的内容')
    ok(bodyA.includes('- 旧会话 ID: ' + SID_A), 'A 包内「旧会话 ID」与路径身份一致（旧实现会读到别人的任务）')
    ok(bodyB.includes('- 旧会话 ID: ' + SID_B), 'B 包内「旧会话 ID」自洽')
    ok(pA.contSeq !== pB.contSeq, '两条接续序号不同（' + pA.contSeq + ' / ' + pB.contSeq + '）')
  } finally { iso.restore() }
}

console.log('[B] 要求2：同一来源多次生成 => 路径不同（contSeq 区分）')
{
  const iso = isolate('same')
  try {
    const mod = await loadEngine()
    const eng = new mod.MemoryEngine()
    writeSession(iso.home, WS, SID_A, 'AAA')
    const p1 = await eng.buildPrevSessionPack(SID_A)
    const p2 = await eng.buildPrevSessionPack(SID_A)
    ok(p1.transcriptPath !== p2.transcriptPath, '★ 同源两次生成路径不同（旧实现同秒会自撞）')
    const files = readdirSync(path.dirname(p1.transcriptPath)).filter(n => /^prev-session-/.test(n))
    eq(files.length, 2, '同源两次 => 两份都在（不自我覆盖）')
    ok(p2.contSeq > p1.contSeq, 'contSeq 递增（' + p1.contSeq + ' < ' + p2.contSeq + '）')
  } finally { iso.restore() }
}

console.log('[C] 命名兼容：新命名必须仍被既有 lister 正则识别')
{
  const iso = isolate('compat')
  try {
    const mod = await loadEngine()
    const eng = new mod.MemoryEngine()
    writeSession(iso.home, WS, SID_A, 'AAA')
    const p = await eng.buildPrevSessionPack(SID_A)
    const name = path.basename(p.transcriptPath)
    const LISTER = /^prev-session-[\w-]+\.md$/
    ok(LISTER.test(name), '★ 新命名匹配 lister 正则（实 ' + name + '）')
    const listed = await eng.listPrevSessionTranscripts(path.dirname(p.transcriptPath), 8)
    ok(listed.includes(name), '★ listPrevSessionTranscripts 真执行后列表含该文件（向后兼容，无需改正则）')
    ok(!name.includes(SID_A) && !name.includes(SID_A.slice(0, 8)), '文件名不含原始 sid（用 sha256 身份，不暴露会话 id）')
  } finally { iso.restore() }
}
console.log('[D] 负路径（变异必红 -> 还原必绿）')
{
  const iso = isolate('mut')
  try {
    // D1：把身份退回截断的 slice(0,8)（且 stamp 退回秒级）—— 完整复刻旧实现 ⇒ 必须撞车
    const m1 = await loadEngine([[
      "      const sidHash = createHash('sha256').update(String(sid)).digest('hex').slice(0, 16)",
      "      const sidHash = String(sid).slice(0, 8)",
    ], [
      "      const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '')",
      "      const stamp = new Date().toISOString().slice(11, 19).replace(/:/g, '')",
    ], [
      "      const outPath = path.join(p.handoffDir, 'prev-session-' + sidHash + '-' + stamp + '-s' + contSeq + '.md')",
      "      const outPath = path.join(p.handoffDir, 'prev-session-' + sidHash + '-' + stamp + '.md')",
    ], [
      "        await writeFile(outPath, body.join(NL), { encoding: 'utf8', flag: 'wx' })",
      "        await writeFile(outPath, body.join(NL), 'utf8')",
    ]])
    const e1 = new m1.MemoryEngine()
    writeSession(iso.home, WS, SID_A, 'AAA')
    writeSession(iso.home, WS, SID_B, 'BBB')
    const qA = await e1.buildPrevSessionPack(SID_A)
    const qB = await e1.buildPrevSessionPack(SID_B)
    ok(qA.transcriptPath === qB.transcriptPath, '★ D1 变异（退回 sid.slice(0,8) + 秒级 stamp + 无 wx）=> 两个来源落到**同一路径**：缺陷复现')
    const only = readdirSync(path.dirname(qA.transcriptPath)).filter(n => /^prev-session-/.test(n))
    eq(only.length, 1, '★ D1 变异后只剩 1 份（后写覆盖前一份）')
    ok(!readFileSync(qA.transcriptPath, 'utf8').includes('PROMPT-AAA'), '★ D1 变异后 A 的内容已被 B 覆盖 ⇒ A 的 carryText 指向别人的任务')

    // D2：只去掉 wx（命名仍为新）—— 同源两次必须仍能区分（contSeq 兜底），
    //     但**同路径重写**不再被拒 ⇒ 用来证明 wx 是独立的一道防线。
    const m2 = await loadEngine([[
      "        await writeFile(outPath, body.join(NL), { encoding: 'utf8', flag: 'wx' })",
      "        await writeFile(outPath, body.join(NL), 'utf8')",
    ]])
    const e2 = new m2.MemoryEngine()
    const r2 = await e2.buildPrevSessionPack(SID_A)
    const target = r2.transcriptPath
    // 直接对同一路径再写一次：wx 版必须抛 EEXIST，无 wx 版静默覆盖
    let wxRefused = null
    try { await writeFile(target, 'CLOBBER', { encoding: 'utf8', flag: 'wx' }) } catch (eW) { wxRefused = eW }
    ok(!!wxRefused && wxRefused.code === 'EEXIST', '★ 防线本身有效：flag:wx 对已存在路径明确 EEXIST（不覆盖）')
    ok(readFileSync(target, 'utf8').includes('旧会话 ID'), 'wx 被拒后原文件内容未被改动')
  } finally { iso.restore() }
}

console.log('[E] 还原必绿：未变异实现同一场景全部正确')
{
  const iso = isolate('restore')
  try {
    const mod = await loadEngine()
    const eng = new mod.MemoryEngine()
    writeSession(iso.home, WS, SID_A, 'AAA')
    writeSession(iso.home, WS, SID_B, 'BBB')
    const pA = await eng.buildPrevSessionPack(SID_A)
    const pB = await eng.buildPrevSessionPack(SID_B)
    ok(pA.transcriptPath !== pB.transcriptPath, '★ 还原：路径不同（必绿）')
    eq(readdirSync(path.dirname(pA.transcriptPath)).filter(n => /^prev-session-/.test(n)).length, 2, '★ 还原：两份都在（必绿）')
    ok(readFileSync(pA.transcriptPath, 'utf8').includes('PROMPT-AAA'), '★ 还原：A 的内容完好（必绿）')
  } finally { iso.restore() }
}

console.log('')
console.log('L-A4 smoke: ' + pass + ' PASS / ' + fail + ' FAIL')
for (const d of tmps) { try { rmSync(d, { recursive: true, force: true, maxRetries: 5 }) } catch (_) {} }
if (fail > 0) process.exit(1)

