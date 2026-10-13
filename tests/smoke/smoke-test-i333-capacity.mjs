#!/usr/bin/env node
/**
 * smoke-test-i333-capacity.mjs —— #333 容量上限漏检（2026-10-12）
 *
 * 缺陷（报告人）：两条写主记忆的路径**不查容量**，而 memory_note 明确走 ensureBudget。
 *   ① maintain 的「AI 蒸馏不可用 ⇒ 原文回灌」分支：无条件把已归档日志全文追加进项目笔记；
 *   ② 面板手动追加（路由 /note）：只查单条与末尾重复，不查「已有 + 新增」总量。
 *   ⇒ 「整理旧日志」反而可能越整理越大 / 手动追加可越过上限。
 *
 * 判据（CR-10）：**真执行产线代码**（从 lib/index.js 抽取真实源码段后运行），断言返回值与磁盘副作用；
 *   每条带负路径；并做变异反向验证（去掉容量门 ⇒ 必红）。
 *
 * ★硬约束：不得为控容量删除唯一副本 —— 用例断言归档文件在降级路径下**仍然存在**。
 */
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync, mkdirSync } from 'node:fs'
import { readFile as readFileAsync } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import pathModule from 'node:path'

const ROOT = pathModule.join(pathModule.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..')
const SRC = readFileSync(pathModule.join(ROOT, 'lib', 'index.js'), 'utf8')

let pass = 0, fail = 0
const ok = (c, n, d) => { if (c) { pass++; console.log('  ok - ' + n) } else { fail++; console.log('  FAIL - ' + n + (d ? ' :: ' + d : '')) } }

// ── 变体源码：可注入「去掉容量门」的变异体 ──
function extractNoteRoute(src) {
  const a = src.indexOf('      path: API.note,')
  // 路由对象以 4 空格缩进的 '{' 起头；不能用 6 空格缩进（会命中不相邻的别的对象）。
  // ★#333-CI：不得硬编码 \r\n —— 仓库 blob 存 LF、开发机检出可能是 CRLF，
  //   写死行尾会让 Linux CI 上 lastIndexOf 返回 -1，+2 后变成 1 ⇒ 抽出
  //   「mport { memoryDir } from ...」这种残片，new Function 直接 SyntaxError。
  const lfStart = src.lastIndexOf('\n    {', a)
  assert.ok(lfStart > 0, '抽取 /note 路由段：4 空格缩进的对象起括号命中（行尾无关）')
  const braceStart = lfStart + 1
  const end = src.indexOf('    // ── ★R7', a)
  assert.ok(a > 0 && braceStart > 0 && end > braceStart, '抽取 /note 路由段命中')
  return src.slice(braceStart, end).trim().replace(/,\s*$/, '')
}
function extractMaintFallback(src) {
  const a = src.indexOf('    } else if (archived.length) {')
  const end = src.indexOf('    // 4) 活跃目录移除旧日志', a)
  assert.ok(a > 0 && end > a, '抽取 maintain 归档回灌段命中')
  // 抽取段以 `} else if (...) {` 起头 ⇒ 单独放进函数体是**悬挂 else**；转成 `if`。
  return src.slice(a, end).replace(/^\s*\} else if \(archived\.length\) \{/, 'if (archived.length) {')
}

const noteRoute = extractNoteRoute(SRC)
const maintBlock = extractMaintFallback(SRC)
ok(/ensureBudget\(owner, 'note'/.test(noteRoute), '① /note 路由内含容量门（ensureBudget）')
ok(/ensureBudget\(agent, 'note', archive\)/.test(maintBlock), '① maintain 回灌段内含容量门（ensureBudget）')

// ── 造 /note handler 的可执行实例（真源码段 + 真 fs）──
function makeNoteHandler(src, engine) {
  const objSrc = extractNoteRoute(src)
  const factory = new Function('API', 'isLoopbackRequest', 'writeJson', 'readJsonBody', 'engine',
    'sanitizeForWrite', 'tailHas', 'memoryWriteLockKey', 'readFile', 'readdirSync',
    'return (' + objSrc + ')')
  return factory(
    { note: '/note' },
    () => true,
    (res, code, obj) => { res.code = code; res.body = obj },
    async () => engine._reqBody,
    engine,
    (t) => ({ ok: true, clean: t }),
    (hay, needle) => hay.includes(needle),
    (p) => 'lock:' + p,
    (p) => engine._fs.readFile(p, 'utf8'),
    () => [],
  )
}

function makeEngine(dir, limit, extra = {}) {
  const notesPath = pathModule.join(dir, 'MEMORY.md')
  const engine = {
    _reqBody: null,
    _settingsNoteFlights: new Set(),
    _settingsMigrationActive: false,
    state: { ws: 'D:\\ws', notesPath, notesText: '' },
    _fs: { readFile: readFileAsync },
    async resolvePathsForSession() { return { wsBound: true, ws: 'D:\\ws', notesPath } },
    memToday: () => '2026-10-12',
    agentForSessionId: () => null,
    withAgent: (ag, fn) => fn(),
    capacityLimit: () => limit,
    appendOverheadChars: () => 0,
    capacityCheck(layer, cur, text) { const need = cur + String(text).length; return { ok: need <= limit, limit, used: cur, need, add: String(text).length } },
    async layerCharCount() { return readFileSync(notesPath, 'utf8').length },
    async ensureBudget(agent, layer, text) {
      const cur = await this.layerCharCount()
      const acct = this.capacityCheck(layer, cur, text)
      return acct.ok ? { ok: true, acct } : { ok: false, acct, reason: 'still-over-capacity' }
    },
    budgetRefusalTextPre: (res, layer) => '项目笔记已达容量上限(' + res.acct.used + '/' + res.acct.limit + ' 字符)',
    async appendText(p, text) { const cur = readFileSync(p, 'utf8'); const next = cur + text; writeFileSync(p, next, 'utf8'); return next },
    ...extra,
  }
  return { engine, notesPath }
}

const tmp = mkdtempSync(pathModule.join(tmpdir(), 'dam-i333-'))

// ═══ ① /note：超容量 ⇒ 必须拒绝，且**磁盘不变**（负路径：修前会直接写上去）═══
{
  const dir = pathModule.join(tmp, 'a'); mkdirSync(dir, { recursive: true })
  const { engine, notesPath } = makeEngine(dir, 100)
  const base = 'x'.repeat(90)
  writeFileSync(notesPath, base, 'utf8')
  engine._reqBody = { content: 'y'.repeat(50), sessionId: 's1', expectedNotesPath: notesPath }
  const res = {}
  const h = makeNoteHandler(SRC, engine)
  await h.handler({ method: 'POST', headers: {}, socket: { remoteAddress: '127.0.0.1' } }, res)
  const after = readFileSync(notesPath, 'utf8')
  ok(res.code === 400, '① /note 超容量被拒（400）', 'code=' + res.code)
  ok(/容量上限/.test(String(res.body && res.body.error)), '① 拒绝理由为容量上限（可复算）', JSON.stringify(res.body))
  ok(after === base, '① 负路径：磁盘内容**一字未改**（未越上限写入）', 'len=' + after.length + ' 原=' + base.length)
}

// ═══ ② /note：容量内 ⇒ 正常追加（既有语义不回归）═══
{
  const dir = pathModule.join(tmp, 'b'); mkdirSync(dir, { recursive: true })
  const { engine, notesPath } = makeEngine(dir, 100000)
  writeFileSync(notesPath, '# 笔记\n', 'utf8')
  engine._reqBody = { content: '新条目甲', sessionId: 's1', expectedNotesPath: notesPath }
  const res = {}
  await makeNoteHandler(SRC, engine).handler({ method: 'POST', headers: {}, socket: { remoteAddress: '127.0.0.1' } }, res)
  const after = readFileSync(notesPath, 'utf8')
  ok(res.code === 200, '② /note 容量内正常写入（200）', 'code=' + res.code)
  ok(after.includes('新条目甲') && after.includes('## 2026-10-12'), '② 正文与日期标题真的落盘')
}

// ═══ ③ /note：尾部重复 ⇒ 仍拒绝（复读防护不回归）═══
{
  const dir = pathModule.join(tmp, 'c'); mkdirSync(dir, { recursive: true })
  const { engine, notesPath } = makeEngine(dir, 100000)
  writeFileSync(notesPath, '# 笔记\n旧条目乙', 'utf8')
  engine._reqBody = { content: '旧条目乙', sessionId: 's1', expectedNotesPath: notesPath }
  const res = {}
  await makeNoteHandler(SRC, engine).handler({ method: 'POST', headers: {}, socket: { remoteAddress: '127.0.0.1' } }, res)
  ok(res.code === 400 && /重复/.test(String(res.body && res.body.error)), '③ 尾部重复仍被拒（复读防护未回归）', JSON.stringify(res.body))
}

// ── maintain 归档回灌段的可执行实例 ──
function makeMaint(src, opts) {
  const block = extractMaintFallback(src)
  const factory = new Function('path', 'p', 'archiveDir', 'archived', 'agent', 'noteMsg',
    'return async function () {' + block + '\nreturn { noteMsg } }')
  const calls = []
  const self = {
    memToday: () => '2026-10-12',
    readTextSafe: async (f) => readFileSync(f, 'utf8'),
    async appendText(p2, text) { calls.push(text); const cur = readFileSync(opts.notesPath, 'utf8'); const next = cur + text; writeFileSync(opts.notesPath, next, 'utf8'); return next },
    async ensureBudget(agent2, layer, text) {
      const cur = readFileSync(opts.notesPath, 'utf8').length
      const need = cur + String(text).length
      return need <= opts.limit ? { ok: true, acct: { ok: true, limit: opts.limit, used: cur, need } }
        : { ok: false, acct: { ok: false, limit: opts.limit, used: cur, need }, reason: 'still-over-capacity' }
    },
    budgetRefusalTextPre: (r) => '项目笔记已达容量上限(' + r.acct.used + '/' + r.acct.limit + ' 字符)',
    state: {},
  }
  const fn = factory(pathModule, { notesPath: opts.notesPath }, opts.archiveDir, opts.archived, null, '')
  return { run: () => fn.call(self), calls }
}

// ═══ ④ maintain：放不下 ⇒ 只写指针、**归档副本仍在**（硬约束：不删唯一副本）═══
{
  const dir = pathModule.join(tmp, 'd'); mkdirSync(dir, { recursive: true })
  const archiveDir = pathModule.join(dir, 'archive'); mkdirSync(archiveDir, { recursive: true })
  const archived = ['2026-01-01.md']
  const fullText = 'z'.repeat(500)
  writeFileSync(pathModule.join(archiveDir, '2026-01-01.md'), fullText, 'utf8')
  const notesPath = pathModule.join(dir, 'MEMORY.md')
  // 夹具：原文（~550 字符）放不下；**指针**（~180 字符）放得下 ⇒ 走降级分支。
  writeFileSync(notesPath, 'x'.repeat(80), 'utf8')
  const { run, calls } = makeMaint(SRC, { notesPath, archiveDir, archived, limit: 300 })
  const r = await run()
  const after = readFileSync(notesPath, 'utf8')
  ok(calls.length === 1 && !calls[0].includes(fullText), '④ 超容量时**未回灌全文**', 'calls=' + calls.length)
  ok(/未回灌全文/.test(calls[0] || '') && calls[0].includes(archiveDir), '④ 降级为**指针**（含归档路径，不静默）')
  ok(!after.includes(fullText), '④ 负路径：笔记里确无归档全文')
  ok(existsSync(pathModule.join(archiveDir, '2026-01-01.md')), '④ ★硬约束：归档副本未被删除')
  ok(/未回灌全文/.test(String(r.noteMsg)), '④ 回执如实说明未回灌', String(r.noteMsg).slice(0, 60))
}

// ═══ ⑤ maintain：放得下 ⇒ 维持原行为（全文回灌）═══
{
  const dir = pathModule.join(tmp, 'e'); mkdirSync(dir, { recursive: true })
  const archiveDir = pathModule.join(dir, 'archive'); mkdirSync(archiveDir, { recursive: true })
  const archived = ['2026-01-01.md']
  const fullText = 'z'.repeat(50)
  writeFileSync(pathModule.join(archiveDir, '2026-01-01.md'), fullText, 'utf8')
  const notesPath = pathModule.join(dir, 'MEMORY.md')
  writeFileSync(notesPath, 'x'.repeat(10), 'utf8')
  const { run, calls } = makeMaint(SRC, { notesPath, archiveDir, archived, limit: 100000 })
  await run()
  ok(calls.length === 1 && calls[0].includes(fullText), '⑤ 容量足够时保持原行为（全文回灌）')
  ok(readFileSync(notesPath, 'utf8').includes(fullText), '⑤ 磁盘确有归档全文')
}

// ═══ ⑥ 变异反向验证：去掉两处容量门 ⇒ 超容量必越界（证明断言非恒真）═══
{
  const mutNote = SRC.replace("              const acct = await engine.ensureBudget(owner, 'note', gate.clean)", "              const acct = { ok: true }")
  const mutMaint = SRC.replace('      const acctA = await this.ensureBudget(agent, \'note\', archive)', '      const acctA = { ok: true }')
  ok(mutNote !== SRC && mutMaint !== SRC, '⑥ 两处变异锚均命中')
  // ① 变体：/note 越界写入
  const dir1 = pathModule.join(tmp, 'f'); mkdirSync(dir1, { recursive: true })
  const m1 = makeEngine(dir1, 100)
  writeFileSync(m1.notesPath, 'x'.repeat(90), 'utf8')
  m1.engine._reqBody = { content: 'y'.repeat(50), sessionId: 's1', expectedNotesPath: m1.notesPath }
  const res1 = {}
  await makeNoteHandler(mutNote, m1.engine).handler({ method: 'POST', headers: {}, socket: { remoteAddress: '127.0.0.1' } }, res1)
  ok(readFileSync(m1.notesPath, 'utf8').length > 100, '⑥ 变异①：/note 越界写入成功（修前症状复现）', 'len=' + readFileSync(m1.notesPath, 'utf8').length)
  // ② 变体：maintain 回灌越界
  const dir2 = pathModule.join(tmp, 'g'); mkdirSync(dir2, { recursive: true })
  const archiveDir2 = pathModule.join(dir2, 'archive'); mkdirSync(archiveDir2, { recursive: true })
  writeFileSync(pathModule.join(archiveDir2, '2026-01-01.md'), 'z'.repeat(500), 'utf8')
  const notesPath2 = pathModule.join(dir2, 'MEMORY.md')
  writeFileSync(notesPath2, 'x'.repeat(200), 'utf8')
  const mm = makeMaint(mutMaint, { notesPath: notesPath2, archiveDir: archiveDir2, archived: ['2026-01-01.md'], limit: 300 })
  await mm.run()
  ok(readFileSync(notesPath2, 'utf8').length > 300, '⑥ 变异②：maintain 回灌越界（修前症状复现）', 'len=' + readFileSync(notesPath2, 'utf8').length)
}

try { rmSync(tmp, { recursive: true, force: true }) } catch (e) {}

console.log('\n结果: ' + pass + ' PASS / ' + fail + ' FAIL')
process.exit(fail ? 1 : 0)
