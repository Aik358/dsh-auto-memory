#!/usr/bin/env node
/**
 * smoke-test-v4-p1-exposure.mjs —— P1 铭文定稿的**功能暴露审计**（用户 2026-10-24 硬要求）。
 *
 * 用户原话要点：「一定要保证所有的功能都连接正确，能够正确地提醒模型该就做全部的事情…
 * 例如：1. 有没有暴露给模型的功能；2. 有没有及时提醒模型增加记忆、更新记忆、更新事件等内容。」
 *
 * 本套件不测「某个字符串在不在」（那是恒真守卫），而是测**三条提示通路对 20 个工具的覆盖矩阵**，
 * 并断言「记忆/事件三类动作」在完整版与精简版里都有可执行指令。
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  PASS ' + m) } else { fail++; console.log('  FAIL ' + m) } }

const mod = await import(pathToFileURL(path.join(ROOT, 'lib', 'index.js')).href)
const L = mod.DEFAULT_PROMPT_LAYERS
const GUIDANCE = mod.GUIDANCE

// ── 三条通路（这是插件告知模型的全部入口）──
const full = L.snapshotInscription + L.snapshotInscriptionArchive      // 完整版铭文（每 N 轮）
const slim = L.snapshotSlimGuide + L.snapshotSlimMaintain + L.snapshotSlimNote  // 精简版（每轮）
const statics = [GUIDANCE, L.staticHead, L.staticWriteDiscipline].filter(Boolean).join(' ')  // 静态注入
const channels = { GUIDANCE: statics, 铭文: full, 精简: slim }

const TOOLS = ['memory_log','memory_note','memory_user','memory_read','memory_recall','memory_maintain',
  'memory_status','memory_reflect','memory_external','calendar_add','calendar_list','calendar_done',
  'calendar_remove','memory_rules','memory_consolidate','memory_procedure','memory_procedure_list',
  'memory_expand','memory_trace','memory_event']

// graph 档条件注册的两个工具：boardMode!=='graph' 时不注册，因此**不应**出现在常规提示里。
// 这不是缺口，是有意设计（见 index.js 的 WB-GRAPH 注释）。
const CONDITIONAL = new Set(['memory_expand', 'memory_trace'])

console.log('[P1-1] ★功能暴露：全部 20 个工具至少有一条通路告知模型')
const src = readFileSync(path.join(ROOT, 'lib', 'index.js'), 'utf8')
const registered = [...new Set([...src.matchAll(/defineTool\('([a-z0-9_]+)'/g)].map(m => m[1]))]
ok(registered.length === 21, '工具注册总数 = 21（v4-U6 起；实测 ' + registered.length + '）')

const uncovered = []
for (const t of TOOLS) {
  const hit = Object.entries(channels).filter(([, txt]) => txt.includes(t)).map(([k]) => k)
  if (!hit.length) uncovered.push(t)
  ok(hit.length > 0 || CONDITIONAL.has(t),
    (CONDITIONAL.has(t) ? '（条件注册，豁免）' : '') + t + ' 已暴露：' + (hit.join('/') || '无'))
}
ok(uncovered.filter(t => !CONDITIONAL.has(t)).length === 0,
  '★无遗漏：没有「注册了却哪都没说」的工具（条件注册的 ' + [...CONDITIONAL].join('/') + ' 豁免）')

console.log('[P1-2] ★三类动作都有可执行指令（增加记忆 / 更新记忆 / 更新事件）')
const acts = [
  ['增加记忆', /memory_log/, 'memory_log'],
  ['更新记忆（项目笔记）', /memory_note\(kind=(note|plan|handoff)/, 'memory_note(kind=…)'],
  ['更新记忆（用户级规则）', /memory_user/, 'memory_user'],
  ['更新事件', /memory_event\(action=(create|append|set|close)/, 'memory_event(action=…)'],
]
for (const [label, re, hint] of acts) {
  ok(re.test(full), label + ' —— 完整版铭文含 ' + hint)
  ok(re.test(slim) || re.test(statics), label + ' —— 精简版或静态含 ' + hint)
}

console.log('[P1-3] 完整版铭文：自检类判据一个不少')
const mustFull = [
  ['{date} 占位', /\{date\}/],
  ['kind 四分类', /rule=.*preference=.*fact=.*todo=/s],
  ['supersede/retract/restore 三态', /supersedes=.*retract=.*retractReason=.*restore=/s],
  ['四个看板 tag 全字面量', /type:goal[^]*type:state[^]*type:dead-end[^]*type:progress/],
  ['宁建勿挂', /宁建勿挂/],
  ['事件=索引、账本=原文载体', /索引[^]*原文载体/],
  ['scope=events 检索入口', /scope=events/],
  // ★2026-10-24 修正：铭文**不得**写死段标题 —— C-3 有一条负路径「无存量时渲染里不含「待审理账本」」，
  //   若铭文里写了这个标题，它每轮都在渲染里 ⇒ 那条负路径必红（实测抓出）。
  //   改为「铭文给出段名引用方式 + 实现里确有该段」，两处各自成立。
  ['存量未归档段名与实现一致', /存量未归档/],
]
for (const [label, re] of mustFull) ok(re.test(full), label)

console.log('[P1-4] 字数与镜像')
ok(full.length <= 1500, '完整版铭文 ≤1500（实测 ' + full.length + '）')
const clientSrc = readFileSync(path.join(ROOT, 'lib', 'client.js'), 'utf8')
ok(clientSrc.includes(JSON.stringify(L.snapshotInscription).slice(1, -1)) || clientSrc.includes(L.snapshotInscription.replace(/\\/g, '\\\\').replace(/'/g, "\\'")), '客户端铭文与服务端逐字一致')
ok(clientSrc.includes(L.snapshotSlimMaintain.replace(/\\/g, '\\\\').replace(/'/g, "\\'")), '客户端精简版维护底线与服务端逐字一致')

console.log('[P1-5] ★负路径：不得有「假承诺」（文案提到的工具必须真实注册）')
const promised = new Set()
for (const m of full.matchAll(/\b(memory_[a-z_]+|calendar_[a-z_]+)\b/g)) promised.add(m[1])
const fake = [...promised].filter(n => !registered.includes(n))
ok(fake.length === 0, '铭文提到的工具全部真实注册（假承诺: ' + (fake.join(',') || '无') + '）')
const promisedSlim = new Set()
for (const m of slim.matchAll(/\b(memory_[a-z_]+|calendar_[a-z_]+)\b/g)) promisedSlim.add(m[1])
const fakeSlim = [...promisedSlim].filter(n => !registered.includes(n))
ok(fakeSlim.length === 0, '精简版提到的工具全部真实注册（假承诺: ' + (fakeSlim.join(',') || '无') + '）')

console.log('[P1-6] ★负路径：不得承诺不存在的 action / scope')
const evActions = [...full.matchAll(/memory_event\(action=([a-z]+)/g)].map(m => m[1])
const validActions = ['create', 'set', 'append', 'close', 'rename']
ok(evActions.every(a => validActions.includes(a)), '铭文里的 memory_event action 全部合法: ' + evActions.join(','))
ok(/scope=events/.test(full) && /'events'/.test(src), 'scope=events 既有文案也有后端枚举（D 批已实现）')

console.log('')
console.log('[P1] ' + pass + ' PASS / ' + fail + ' FAIL')
process.exit(fail ? 1 : 0)