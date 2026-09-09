#!/usr/bin/env node
/** smoke-test-handoff-anchor-pre —— P5 接续锚点表 + P6 账本权重化截断 回归锁定(2026-09-09)。
 * 纯 Node、零依赖、不联网。P5:锚点表逻辑以「内联闭包」形式存在于 buildContinueCarry() 内部
 * (改动边界所限);本测试:①源码守卫(接线/动态 import/fail-soft/置于 parts 末尾)
 * ②用 extractFn 抽取 anchorSectionFor 闭包,绑定假 readTextSafe 做行为验证(字节稳定/上限/空源)。
 * P6:lib/handoff-anchor-pre.js 纯函数(parse/weightedTrim)fixture 锁定 + buildContinueCarry 接线守卫。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildL0IndexPre } from '../../lib/l0-extract-pre.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SRC = readFileSync(path.resolve(HERE, '..', '..', 'lib', 'index.js'), 'utf8')
let pass = 0, fail = 0
const ok = (c, n) => { if (c) { pass++; console.log('  ok -', n) } else { fail++; console.error('FAIL', name2(n), ':', c) } }
const name2 = (n) => n

function extractFn(header) {
  const start = SRC.indexOf(header)
  if (start < 0) throw new Error('not found: ' + header)
  let depth = 0, end = -1
  for (let i = start + header.length - 1; i < SRC.length; i++) {
    if (SRC[i] === '{') depth++
    else if (SRC[i] === '}') { depth--; if (depth === 0) { end = i; break } }
  }
  if (end < 0) throw new Error('unbalanced: ' + header)
  return SRC.slice(start, end + 1)
}

const anchor = (c) => `<!-- memory:mem_${c.repeat(32)} -->`
const NL = String.fromCharCode(10)

// ---------- 源码守卫:接线完整且在边界内 ----------
console.log('[handoff-anchor] G0 源码守卫')
{
  const posFn = SRC.indexOf('async buildContinueCarry() {')
  const posAnchor = SRC.indexOf('const anchorSectionFor = async (label, file, cap) => {')
  const posContSeq = SRC.indexOf('// 接续序号:统计 handoff 目录里已有的 prev-session 包数量 +1')
  ok(posFn > 0 && posAnchor > posFn && posAnchor < posContSeq,
    'anchorSectionFor 定义在 buildContinueCarry() 内部、contSeq 之前(改动边界)')
  const posImport = SRC.indexOf("const { buildL0IndexPre } = await import('./l0-extract-pre.js')")
  ok(posImport > posFn && posImport < posContSeq, 'T1 模块经函数内动态 import 引入(不加静态 import)')
  const block = SRC.slice(posImport, posContSeq)
  ok(block.includes('catch (eAnchor) {}'), '整块 fail-soft try/catch(任何失败跳过表,不阻塞接续)')
  ok(block.includes("parts.push('【锚点表"), '锚点表 push 进 parts(末尾,预算截断时最先牺牲=自动回退平铺)')
  ok(block.includes("maxChars: 48"), '每条 L0 ≤48 字符(≈20-30 token)')
  ok(block.includes('.slice(0, cap)') && block.includes(", 10)"), '每源条数上限 10')
  ok(block.includes("p.notesPath") && block.includes("p.logPath"), '数据源=notesPath+logPath(锚点载体文件)')
  ok(!/llm|runSubagent|subagents\./i.test(block), '零 LLM 轮次(纯解析)')
  ok(!block.includes('new Date') && !block.includes('Date.now') && !block.includes('Math.random'), '无时间戳/随机 → 字节稳定前提')
}

// ---------- 行为:抽取闭包绑定假 readTextSafe ----------
const closureSrc = extractFn('const anchorSectionFor = async (label, file, cap) => {')
function makeAnchorSectionFor(readTextSafe) {
  const fake = { readTextSafe }
  // 抽取源以「const anchorSectionFor = 」开头 → 取「= 」之后的箭头函数体;
  // 闭包捕获定义处的 this → 用 factory.call(fake) 使 this=fake(不得用 .bind,箭头 this 不可重绑)
  const arrowSrc = closureSrc.slice(closureSrc.indexOf('= ') + 2)
  const factory = new Function('NL', 'buildL0IndexPre', 'return { anchorSectionFor: ' + arrowSrc + '};')
  return factory.call(fake, NL, buildL0IndexPre).anchorSectionFor
}

const NOTES = [
  anchor('b') + '## 主题乙（10:00）\n- 10:00 工作区笔记第二条的内容描述足够长',
  anchor('a') + '## 主题甲（09:00）\n- 09:00 工作区笔记第一条的内容描述足够长',
].join('\n')
const LOG = anchor('c') + '- 14:00 今日日志条目:修复了某个问题并验证通过,内容描述足够长以支撑 L0。'

await (async () => {
  const calls = []
  const sectionFor = makeAnchorSectionFor(async (f) => {
    calls.push(f)
    if (f === '/notes') return NOTES
    if (f === '/log') return LOG
    return ''
  })
  const s1 = await sectionFor('工作区笔记', '/notes', 10)
  ok(s1.startsWith('- 工作区笔记:'), '输出以「- 源标签:」开头')
  ok(s1.includes('  - ' + 'a'.repeat(8) + ' 主题甲'), '行格式=两空格缩进+id前8位+L0(按 id 升序,甲在前)')
  ok(!s1.includes('mem_'), '行内只含 id 前 8 位 hex,不含完整 mem_ 前缀(紧凑)')
  const s1b = await sectionFor('工作区笔记', '/notes', 10)
  assert.equal(s1, s1b)
  ok(true, '字节稳定:同输入两次输出完全一致')
  const sLog = await sectionFor('今日日志', '/log', 10)
  ok(sLog.startsWith('- 今日日志:') && sLog.includes('c'.repeat(8)), '今日日志源独立成节')
  ok(calls.every((f) => f === '/notes' || f === '/log'), '只读取声明的两个源文件')
})()

await (async () => {
  // 上限:12 条只取前 10(确定性:按 id 升序);锚点 id 只认十六进制字符,夹具须用 hex 字符集
  const HEX = '0123456789abcdef'
  const many = Array.from({ length: 12 }, (_, i) => anchor(HEX[i]) + `## 条目${i}（0${i}:00）`).join('\n')
  const sectionFor = makeAnchorSectionFor(async () => many)
  const s = await sectionFor('工作区笔记', '/notes', 10)
  const rows = s.split(NL).filter((l) => l.startsWith('  - '))
  assert.equal(rows.length, 10)
  ok(true, '条数上限生效:12 条源 → 恰好 10 行')
})()

await (async () => {
  // 空源/缺失源 → 空串(调用方 filter(Boolean) 后整节消失)
  const sectionFor = makeAnchorSectionFor(async () => '')
  assert.equal(await sectionFor('工作区笔记', '/notes', 10), '')
  ok(true, '空文件 → 空串(整节跳过)')
  // L0 长度受 maxChars=48 约束
  const long = anchor('a') + '## ' + '很长的主题'.repeat(20)
  const sectionFor2 = makeAnchorSectionFor(async () => long)
  const s2 = await sectionFor2('工作区笔记', '/notes', 10)
  const row = s2.split(NL).find((l) => l.startsWith('  - '))
  assert.ok(row.length - '  - xxxxxxxx '.length <= 48 + 1, 'L0 截断到 ≤48 字符')
  ok(true, 'L0 长度受 maxChars=48 约束')
})()

// ================= P6(2026-09-09) 账本权重化截断 =================
console.log('\n[P6] 账本权重化截断(纯函数 + fixture 锁定)')
const W = await import('../../lib/handoff-anchor-pre.js')
const WSRC = readFileSync(path.resolve(HERE, '..', '..', 'lib', 'handoff-anchor-pre.js'), 'utf8')
{
  const mkSec = (title, n, tag) => ['## ' + title].concat(Array.from({ length: n }, (_, k) => '- ' + tag + ' 条目' + k + ':' + '内容'.repeat(20))).join('\n')
  const LEDGER = [
    '# 交接账本 · 2026-09-09 17:05',
    '',
    mkSec('任务状态', 4, '状态'),
    '',
    mkSec('目标', 4, '目标'),
    '',
    mkSec('已试方案与失败原因', 4, '失败'),
    '',
    mkSec('进度与下一步', 4, '下一步'),
    '',
  ].join('\n')
  const secBody = (t, s) => { const m = s.match(new RegExp('## ' + t + '\\r?\\n([\\s\\S]*?)(?=\\r?\\n## |$)')); return m ? m[1] : '' }

  // G1 解析:四段标题逐字锁定 + preamble 捕获 + fail closed
  const p = W.parseHandoffLedgerPre(LEDGER)
  ok(p && p.sections.length === 4, '解析出恰 4 段')
  ok(p.preamble[0] === '# 交接账本 · 2026-09-09 17:05', 'preamble 捕获 H1 大标题')
  const titles = p.sections.map((s) => s.title.replace(/\r$/, ''))
  assert.deepEqual(titles, ['## 任务状态', '## 目标', '## 已试方案与失败原因', '## 进度与下一步'])
  ok(true, '四段标题字符串逐字一致(含空格/半角)')
  const wmap = Object.fromEntries(p.sections.map((s) => [s.title, s.weight]))
  assert.equal(wmap['## 已试方案与失败原因'], 0.35)
  assert.equal(wmap['## 进度与下一步'], 0.30)
  assert.equal(wmap['## 目标'], 0.20)
  assert.equal(wmap['## 任务状态'], 0.15)
  ok(true, '权重 失败原因.35 > 下一步.30 > 目标.20 > 任务状态.15')
  assert.equal(W.parseHandoffLedgerPre(''), null)
  assert.equal(W.parseHandoffLedgerPre('没有任何标题的文本'), null)
  assert.equal(W.parseHandoffLedgerPre(null), null)
  ok(true, '非法输入 fail closed → null')

  // G2 预算充足 → 逐字节原样返回
  const total = LEDGER.length
  ok(W.weightedTrimHandoffLedgerPre(LEDGER, total + 100) === LEDGER, '预算充足 → 原文逐字节返回(不截不改)')
  ok(W.weightedTrimHandoffLedgerPre(LEDGER, total) === LEDGER, '预算恰等于原文长度 → 原样返回')

  // G3 预算不足 → 从最低权重段开始截(阶梯:任务状态 → 目标 → 下一步 → 失败原因)
  const step1 = W.weightedTrimHandoffLedgerPre(LEDGER, 730)
  ok(step1 != null && step1.length <= 730, '截断后进入预算(' + (step1 ? step1.length : 'null') + ' ≤ 730)')
  ok(!secBody('任务状态', step1).includes('状态 条目0'), '任务状态(0.15)最先被截')
  ok(secBody('目标', step1).includes('目标 条目3'), '目标(0.20)此档未动(权重次低)')
  ok(secBody('已试方案与失败原因', step1).includes('失败 条目3'), '失败原因(0.35)完整保留')
  const step2 = W.weightedTrimHandoffLedgerPre(LEDGER, 350)
  ok(step2 != null && step2.length <= 350, '更紧预算仍进入预算(' + (step2 ? step2.length : 'null') + ' ≤ 350)')
  ok(!secBody('目标', step2).includes('目标 条目3'), '预算更紧时目标(0.20)也开始被截')
  ok(secBody('已试方案与失败原因', step2).includes('失败 条目0'), '失败原因(0.35)最后被截且保头部')
  ok(['## 任务状态', '## 目标', '## 已试方案与失败原因', '## 进度与下一步'].every((t) => step2.includes(t)), '四个段标题行全部保留')
  ok(step2.includes('…(已按预算截断'), '截点带预算标记')

  // G4 确定性 + CRLF 容忍
  ok(W.weightedTrimHandoffLedgerPre(LEDGER, 600) === W.weightedTrimHandoffLedgerPre(LEDGER, 600), '同输入两次调用逐字节一致')
  const crlf = LEDGER.replace(/\n/g, '\r\n')
  ok(W.weightedTrimHandoffLedgerPre(crlf, crlf.length + 10) === crlf, 'CRLF 输入预算充足 → 逐字节还原(\\r 保留)')

  // G5 未知段权重最低(0.05,先于四段被截)
  const withUnknown = LEDGER + '## 附加材料\n- 附加1\n- 附加2\n'
  const unk = W.weightedTrimHandoffLedgerPre(withUnknown, 800)
  ok(unk != null && !unk.includes('附加2'), '未知段(0.05)先于四段被截')

  // G6 纯函数纪律 + 接线源码守卫
  ok(!/import\s|require\(|readFile|writeFile/.test(WSRC), '纯函数零 IO(新模块无 fs/无依赖)')
  ok(SRC.includes("await import('./handoff-anchor-pre.js')"), 'buildContinueCarry 动态 import 权重截断模块')
  ok(SRC.includes('weightedTrimHandoffLedgerPre(ledger, 8000)'), '接线使用预算 8000(参数化)')
  ok(SRC.includes('let ledgerBody = ledger.slice(0, 8000)'), 'fail-soft 回落 = 原位置截断(保底,绝不阻塞接续)')
  ok(/catch \(eLedW\) \{\}/.test(SRC), '整块 try/catch fail-soft')
}

console.log(`\n[handoff-anchor] ${pass}/${pass + fail} assertions passed`)
if (fail) process.exit(1)
