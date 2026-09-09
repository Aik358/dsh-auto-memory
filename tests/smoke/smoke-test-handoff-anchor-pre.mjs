#!/usr/bin/env node
/** smoke-test-handoff-anchor-pre —— P5 接续锚点表回归锁定(2026-09-09)。
 * 纯 Node、零依赖、不联网。锚点表逻辑以「内联闭包」形式存在于 buildContinueCarry() 内部
 * (改动边界所限);本测试:①源码守卫(接线/动态 import/fail-soft/置于 parts 末尾)
 * ②用 extractFn 抽取 anchorSectionFor 闭包,绑定假 readTextSafe 做行为验证(字节稳定/上限/空源)。
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

console.log(`\n[handoff-anchor] ${pass}/${pass + fail} assertions passed`)
if (fail) process.exit(1)
