// L3.6 验收: 旧会话转写「可检索化」+ 瘦身
//   背景(用户报障"有些文件接不过去"的一条 + 实测): 旧会话转写落盘在 handoff/prev-session-*.md,
//   但 ① `listHandoffLedgers` 的正则不认这个前缀 ⇒ scope='handoff' 永远看不见它(检索孤岛);
//        ② 正文含 1854 条工具事件 vs 530 条 assistant 消息 ⇒ 工具噪声淹没正文。
//   本套件锁定三件事: 瘦身语义 / 稳定锚点 / 两个 lister 的**可见性边界**。
import { slimTranscriptPre, prevSessionSidAnchorPre, prevSessionL0Pre } from '../../lib/index.js'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
let pass = 0, fail = 0
const t = (name, fn) => { try { fn(); pass++; console.log('  ok - ' + name) } catch (e) { fail++; console.log('  FAIL - ' + name + ': ' + (e && e.message)) } }
const assert = (c, m) => { if (!c) throw new Error(m || 'assertion failed') }

console.log('=== L3.6 旧会话转写可检索化 ===')

// ─────────────────────────────────────────────────────────────
// L3.6-1..4 瘦身语义
// ─────────────────────────────────────────────────────────────
t('L3.6-1 ★ 工具事件被剔除并计数(旧实现: 全量转写, 噪声压过正文)', () => {
  const msgs = [
    { role: 'user', text: '帮我改一下' },
    { role: 'tool_call', text: 'read(a.js)' },
    { role: 'tool_result', text: '工具结果' },
    { role: 'assistant', text: '改好了' },
  ]
  const r = slimTranscriptPre(msgs)
  assert(r.toolCalls === 1 && r.toolResults === 1, '工具调用/结果应各计 1, 实为 ' + r.toolCalls + '/' + r.toolResults)
  assert(!r.body.includes('read(a.js)') && !r.body.includes('工具结果'), '★ 工具事件正文不得进转写')
  assert(r.body.includes('**user**: 帮我改一下') && r.body.includes('**assistant**: 改好了'), '用户输入与助手输出必须保留')
  assert(r.keptMsgs === 2, '本次保留 2 条正文消息, 实为 ' + r.keptMsgs)
})

t('L3.6-2 ★ droppedChars 如实统计(供转写体自述"省略了多少")', () => {
  const r = slimTranscriptPre([
    { role: 'tool_call', text: 'x'.repeat(100) },
    { role: 'tool_result', text: 'y'.repeat(50) },
    { role: 'user', text: 'z'.repeat(3000) }, // 超 2000 单条上限
  ])
  assert(r.droppedChars === 100 + 50 + 1000, '省下的字符应为 100+50+1000=1150, 实为 ' + r.droppedChars)
})

t('L3.6-3 ★ 单条与总长双上限(旧行为不得破坏)', () => {
  const one = slimTranscriptPre([{ role: 'assistant', text: 'x'.repeat(5000) }])
  assert(one.body === '**assistant**: ' + 'x'.repeat(2000), '单条默认截断到 2000')
  const many = Array.from({ length: 100 }, () => ({ role: 'user', text: 'y'.repeat(1900) }))
  const cap = slimTranscriptPre(many, { totalChars: 60000 })
  assert(cap.trimmed === true, '★ 超总长须置 trimmed')
  assert(cap.body.length <= 60000, '总长不得超 60000, 实为 ' + cap.body.length)
  assert(cap.keptMsgs < 100, '超限后停止收录, 实为 ' + cap.keptMsgs)
  const roomy = slimTranscriptPre([{ role: 'user', text: 'hi' }])
  assert(roomy.trimmed === false, '未超限不得误置 trimmed')
})

t('L3.6-4 decorate 回调把附件行内联到该条消息之后(与 L3.5 分层不冲突)', () => {
  const r = slimTranscriptPre(
    [{ role: 'user', text: '看这张图', attachments: [{ kind: 'image', id: 'a'.repeat(64), bytes: 1 }] }],
    { decorate: (m) => (m.attachments ? '\n  - [附件 图片] /x/y' : '') }
  )
  assert(r.body.includes('看这张图') && r.body.includes('  - [附件 图片] /x/y'), '附件行须内联')
  assert(r.body.indexOf('看这张图') < r.body.indexOf('  - [附件 图片]'), '内联行须在该条消息之后')
})

// ─────────────────────────────────────────────────────────────
// L3.6-5..6 稳定锚点 + L0 摘要
// ─────────────────────────────────────────────────────────────
t('L3.6-5 ★ sid 锚点由会话 id 决定——同一会话恒等, 不同会话不同(不随写入时刻漂移)', () => {
  const h = () => createHash('sha256')
  const a1 = prevSessionSidAnchorPre('sess-abc', h)
  const a2 = prevSessionSidAnchorPre('sess-abc', h)
  const b = prevSessionSidAnchorPre('sess-xyz', h)
  assert(a1 === a2, '★ 同 sid 必须同锚点(否则每次重建都变 id, 破坏"可重建")')
  assert(a1 !== b, '不同 sid 须不同锚点')
  assert(/^mem_[0-9a-f]{32}$/.test(a1), '格式应为 mem_+32hex(与既有记忆锚点同域), 实为 ' + a1)
  assert(prevSessionSidAnchorPre('', h) === '', '空 sid ⇒ 空串(fail-soft)')
})

t('L3.6-6 ★ L0 摘要行 = 首条用户输入 → 末条助手结论(单行可 grep)', () => {
  const l0 = prevSessionL0Pre([
    { role: 'user', text: '帮我看看看板为什么空白' },
    { role: 'assistant', text: '中间结论' },
    { role: 'assistant', text: '根因是 handoffEnabled 早退' },
  ], 'abcdef1234567890', { cap: 60 })
  assert(l0.indexOf('[abcdef12]') === 0, '应以 [sid前8位] 开头, 实为 ' + l0)
  assert(l0.includes('帮我看看看板为什么空白'), '须含首条用户输入')
  assert(l0.includes('根因是 handoffEnabled 早退'), '★ 须取**末条**助手结论(不是第一条)')
  assert(l0.indexOf('\n') < 0, 'L0 必须是单行')
  assert(prevSessionL0Pre([], 'x') === '', '无内容 ⇒ 空串')
})

// ─────────────────────────────────────────────────────────────
// L3.6-7..8 可见性边界 —— 本阶段的**根因**所在
// ─────────────────────────────────────────────────────────────
const SRC = readFileSync(path.resolve(HERE, '..', '..', 'lib', 'index.js'), 'utf8')

// 从源码里把 `/^....$/` 这个正则**字面量**整段抠出来(不能用 [^)] 截断——正则里含 `)` ),
// 再 new RegExp 驱动真实行为。抽不到就判失败(避免"抽不到=静默通过"的假绿)。
const grabRe = (anchor, marker) => {
  const i = SRC.indexOf(anchor)
  assert(i > 0, '未找到锚点: ' + anchor)
  const j = SRC.indexOf(marker, i)
  assert(j > i, '未找到正则起始: ' + marker)
  const k = SRC.indexOf('$/', j)
  assert(k > j, '未找到正则结束 $/')
  // marker 本身以 `/^` 结尾 ⇒ 正则开头那个 `/` 在 j + marker.length - 1(不是 j+1)
  return new RegExp(SRC.slice(j + marker.length - 1, k + 1))
}

t('L3.6-7 ★ 账本 lister 的正则**结构性排除** prev-session-(这就是检索孤岛的根因)', () => {
  const re = grabRe('listHandoffLedgers(dir', 'filter((n) => /^')
  assert(!re.test('prev-session-abcdef12-120000.md'), '★ 该正则不得匹配 prev-session-(一旦匹配会改变账本/归档的血缘语义)')
  assert(re.test('handoff-20260917-120000.md') && re.test('PLAN-20260917-120000.md'), '仍须匹配账本与 PLAN 归档')
  assert(re.test('handoff-20260917-120000-b.md'), '同秒防撞后缀 -b 仍须匹配(既有行为不得破坏)')
})

t('L3.6-8 ★ 新增独立 lister 让旧会话转写进入 scope=handoff 语料', () => {
  assert(/async listPrevSessionTranscripts\(dir, limit = 8\)/.test(SRC), '★ 必须有独立的 listPrevSessionTranscripts')
  const re = grabRe('listPrevSessionTranscripts(dir', 'filter((n) => /^')
  assert(re.test('prev-session-abcdef12-120000.md'), '★ 必须匹配 prev-session-<sid8>-<stamp>.md')
  assert(!re.test('handoff-20260917-120000.md'), '不该顺手把账本也吃进来(职责单一)')
  // 接线必须真的挂在 searchHandoffCorpus 里
  assert(/await scan\('旧会话转写\/' \+ n, path\.join\(p\.handoffDir, n\), 2\)/.test(SRC),
    '★ 旧会话转写必须被 searchHandoffCorpus 扫描(否则 lister 写了也没人用)')
})

// ─────────────────────────────────────────────────────────────
// L3.6-9 转写体头部的 L0 + 锚点必须在
// ─────────────────────────────────────────────────────────────
t('L3.6-9 ★ 转写体头部写入了 L0 摘要与稳定锚点(模型先看"在干什么")', () => {
  assert(/'<!-- ' \+ sidAnchor \+ ' -->'/.test(SRC), '★ 转写体须写入 <!-- mem_... --> 锚点')
  assert(/- \*\*L0\*\*: ' \+ l0Line/.test(SRC), '★ 转写体须写入 L0 摘要行')
  assert(/const sidAnchor = prevSessionSidAnchorPre\(sid, \(\) => createHash\('sha256'\)\)/.test(SRC), '锚点须由 sid 推导(非时间戳)')
  assert(/const l0Line = prevSessionL0Pre\(msgs, sid, \{ cap: 120 \}\)/.test(SRC), 'L0 须在转写前算好')
})

// ─────────────────────────────────────────────────────────────
// L3.6-10 纯函数零 IO / 零依赖(与 L3 的 assembleCarryPre 同纪律)
// ─────────────────────────────────────────────────────────────
t('L3.6-10 三个新增纯函数零 IO、零 LLM 轮次', () => {
  for (const fn of ['slimTranscriptPre', 'prevSessionSidAnchorPre', 'prevSessionL0Pre']) {
    const m = SRC.match(new RegExp('export function ' + fn + '\\([\\s\\S]*?\\n\\}'))
    assert(m, fn + ' 应能提取到函数体')
    assert(!/\b(readFile|writeFile|readdir|mkdir|existsSync|statSync)\b/.test(m[0]), fn + ' 不得做文件 IO')
    assert(!/llm|runSubagent|subagents\./i.test(m[0]), fn + ' 不得引入 LLM 轮次')
  }
})

const total = pass + fail
console.log('[l36-prev-session] ' + pass + ' passed, ' + fail + ' failed (共 ' + total + ')')
if (fail > 0) process.exit(1)
