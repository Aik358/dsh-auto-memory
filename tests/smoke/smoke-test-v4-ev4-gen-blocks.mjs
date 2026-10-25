/**
 * smoke-test-v4-ev4-gen-blocks.mjs —— EV4 生成器守卫套件
 *
 * 守 6 件事：
 * 1. 单一真源：生成块里的 patchShellStatsPre 必须与原型源码那份**逐字符相等**（Lead 裁决 A）
 * 2. adapter 里不得再有第二份实现
 * 3. 功能等价：6 组输入（含边界）两份输出逐字符相等
 * 4. 插入块形态：不得以 ( / [ / backtick 开头（ASI 陷阱，Lead 裁决 ②）
 * 5. 生成器 --check 幂等
 * 6. 内建 client-loadable 回归
 */
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const ROOT = 'D:/dsh-auto-memory'
const CLIENT = path.join(ROOT, 'lib/client.js')
const PROTO = path.join(ROOT, 'lib/ev4-prototype-blocks.js')
const ADAPTER = path.join(ROOT, 'lib/ev4-adapter.js')
const GEN = path.join(ROOT, 'tools/gen-ev4-blocks.mjs')
const BS = String.fromCharCode(92)
const BT = String.fromCharCode(96)

let pass = 0, fail = 0
const ok = (cond, msg, extra) => {
  if (cond) { pass += 1; console.log('  ok   - ' + msg + (extra ? ' :: ' + extra : '')) }
  else { fail += 1; console.log('  FAIL - ' + msg + (extra ? ' :: ' + extra : '')) }
}

const CL_RAW = fs.readFileSync(CLIENT, 'utf8')
const protoSrc = fs.readFileSync(PROTO, 'utf8')

function extractFn (src, name) {
  let idx = src.indexOf('function ' + name + '(')
  if (idx < 0) idx = src.indexOf('function ' + name + ' (')
  if (idx < 0) return null
  const openIdx = src.indexOf('{', idx)
  if (openIdx < 0) return null
  let depth = 1, i = openIdx + 1, inStr = null, esc = false
  for (; i < src.length; i += 1) {
    const c = src[i]
    if (esc) { esc = false; continue }
    if (c === BS) { esc = true; continue }
    if (inStr) { if (c === inStr) inStr = null; continue }
    if (c === '"' || c === "'" || c === BT) { inStr = c; continue }
    if (c === '{') depth += 1
    else if (c === '}') { depth -= 1; if (depth === 0) { i += 1; break } }
  }
  return src.slice(idx, i)
}

console.log('')
console.log('== 1. 单一真源：patchShellStatsPre 逐字符相等（A 方案）==')
const protoFn = extractFn(protoSrc, 'patchShellStatsPre')
ok(!!protoFn, '★[正] 能从原型源码抽出 patchShellStatsPre', '长度 ' + (protoFn ? protoFn.length : 0))
ok(protoSrc.split('function patchShellStatsPre').length - 1 === 1, '★★[正] 原型源码里该函数恰 1 处（防多处同名）')

const inlineM = CL_RAW.match(/\/\/ ═══ EV4-BLOCKS 内联区[^\n]*\n([\s\S]*?)\/\/ ═══ EV4-BLOCKS 内联区结束 ═══/)
ok(!!inlineM, '★[正] client.js 里有 EV4-BLOCKS 内联区')
const inlineText = inlineM ? inlineM[1] : ''
const genFn = extractFn(inlineText, 'patchShellStatsPre')
ok(!!genFn, '★[正] 能从生成块抽出 patchShellStatsPre')
// ★★必须按**行尾归一化**比较（实测踩到）：原型文件是 LF，client.js 是 CRLF，
//   直接比会差 12 字符（6 个换行 × 1 字节）—— 那是**预期的行尾差异**，不是漂移。
//   判据意图是「函数体文本一字不差」⇒ 归一化到 LF 后再比。
const normEol = (s) => String(s).split(String.fromCharCode(13) + String.fromCharCode(10)).join(String.fromCharCode(10))
const genNorm = normEol(genFn)
const protoNorm = normEol(protoFn)
ok(genNorm === protoNorm, '★★★[核心] 生成块与原型源码的 patchShellStatsPre 逐字符相等（行尾归一化后）',
  'gen=' + genNorm.length + ' proto=' + protoNorm.length + ' 原始长度差=' + (genFn.length - protoFn.length) + '（应为 CRLF/LF 差异）')
// ★负路径自证：真改一个字符必须不等（证明这条断言有鉴别力）
ok(normEol(genFn.replace('let out = shell', 'let out = shellX')) !== protoNorm,
  '★★[负] 改函数体一个字符 ⇒ 相等断言必红（判据非恒真）')

console.log('')
console.log('== 2. adapter 里不得再有第二份实现 ==')
const adapterSrc = fs.readFileSync(ADAPTER, 'utf8')
ok(adapterSrc.indexOf('function patchShellStatsPre') < 0, '★★★[负] adapter 里没有 patchShellStatsPre 定义（无两份实现）')
const adapterMod = await import(pathToFileURL(ADAPTER).href)
ok(adapterMod.patchShellStatsPre === undefined, '★★[负] adapter 也不再 export 它')
ok(typeof adapterMod.buildEv4IframeHtmlSafePre === 'function', '★[正] adapter 仍有 buildEv4IframeHtmlSafePre')

// ══════════════════════════════════════════════════════════════════════
// == 2b. ★新增（2026-10-26 审计 task-37 建议）：adaptEventPre 时间字段形状回归护栏
//   背景：白板看板时间显示 `08:0 年 0 月` 的 bug 经历过「修一次 → 被生成器回退一次」，
//        而 tests/smoke 里**零断言**覆盖 start 形状 ⇒ 没有回归护栏。
//   判据（来自审计报告 §1.2 + 原型双证）：
//     · 原型 EV4_PROTO_RUNTIME 把 ev.start 当**完整时间戳**消费（18 处：
//       monthLabel slice(0,7) / 日期分组 slice(0,10) / 时刻 slice(11,16) / relLabel）；
//     · 原型自己的 demo 生成器亦为 `start: cps[0].at`（at = 'YYYY-MM-DD HH:mm'）。
//   ⇒ start/end 必须是 'YYYY-MM-DD HH:mm'，**不是** 'HH:mm'。
//   ★这是**真执行** adapter（真 import + 真调用 + 断言返回值），不是源码字符串断言。
// ══════════════════════════════════════════════════════════════════════
console.log('')
console.log('== 2b. adaptEventPre 时间字段形状（回归护栏，防被生成器回退）==')
if (typeof adapterMod.adaptEventPre !== 'function') {
  ok(false, '★★★[时间] adapter 导出 adaptEventPre', '未导出 ⇒ 后续断言无法执行')
} else {
  const RE_FULL = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/
  // ★桩纪律（本仓「假状态桩」教训，2026-10-25 C2 案例）：
  //   `cp.at` 在**真实 event-store.json 里是毫秒数**（实测 1792851795071 / typeof number），
  //   不是 ISO 字符串。第一版护栏传了 '2026-10-25 14:30' ⇒ Number() = NaN ⇒ 1970 ⇒ 假红 3 条。
  //   ⇒ 桩必须复刻**产品真实产出的状态**，否则测的是幻觉。
  const CP_MS = new Date(2026, 9, 25, 14, 30).getTime()  // 与真实格式一致：毫秒
  const mkEv = (cpMs) => ({
    id: 'evt_test01', name: '时间形状测试', status: 'active', sections: {},
    createdAt: new Date(2026, 9, 25, 14, 30).getTime(),
    updatedAt: new Date(2026, 9, 26, 9, 5).getTime(),
    checkpoints: cpMs ? [{ at: cpMs, kind: 'progress', text: 'x' }] : [],
  })
  // ① 有检查点（走 cps 分支）—— at 传毫秒，与真实数据同形
  const rA = adapterMod.adaptEventPre(mkEv(CP_MS), 0)
  ok(RE_FULL.test(String(rA.start)), '★★★[时间] start 是完整 "YYYY-MM-DD HH:mm"（有检查点）', 'start=' + rA.start)
  ok(RE_FULL.test(String(rA.end)), '★★★[时间] end 是完整 "YYYY-MM-DD HH:mm"', 'end=' + rA.end)
  ok(String(rA.start).slice(0, 7) === '2026-10', '★★★[时间] 原型 monthLabel(slice(0,7)) 得到 "2026-10"', 'got=' + String(rA.start).slice(0, 7))
  ok(String(rA.start).slice(11, 16) === '14:30', '★★★[时间] 原型 slice(11,16) 得到 "14:30"', 'got=' + String(rA.start).slice(11, 16))
  ok(String(rA.date) === '2026-10-25', '★★[时间] date 字段仍是 "YYYY-MM-DD"（本来就对，别改坏）', 'date=' + rA.date)
  // ② 无检查点（走 createdAt/updatedAt 分支）
  const rB = adapterMod.adaptEventPre(mkEv(null), 1)
  ok(RE_FULL.test(String(rB.start)), '★★★[时间] start 是完整时间戳（无检查点分支）', 'start=' + rB.start)
  // ③ 负路径：绝不能是裸 'HH:mm'（那正是旧 bug）
  ok(!/^\d{2}:\d{2}$/.test(String(rA.start)), '★★★[负] start 不得是裸 "HH:mm"（旧 bug 形状）', 'start=' + rA.start)
}

console.log('')
console.log('== 3. 功能等价：6 组输入两份实现输出逐字符相等 ==')
const ctxProto = vm.createContext({})
vm.runInContext(protoFn + '; globalThis.__F = patchShellStatsPre;', ctxProto)
const Fproto = ctxProto.__F
const ctxGen = vm.createContext({})
vm.runInContext(genFn + '; globalThis.__F = patchShellStatsPre;', ctxGen)
const Fgen = ctxGen.__F

const SHELL = '<span>文档 <b>839</b></span>|<span>事件 <b>127</b></span>|<span>检查点 <b>99</b></span>|<span>最大事件 <b>9 点</b></span>|<span>单检查点 <b>12.3%</b></span>'
const CASES = [
  { name: '全空', stats: {} },
  { name: '正常', stats: { docs: 267, events: 2, checkpoints: 143, maxEvent: 113, singleCpPct: 0 } },
  { name: '含小数', stats: { docs: 1, events: 1, checkpoints: 1, maxEvent: 1, singleCpPct: 62.5 } },
  { name: '全 0', stats: { docs: 0, events: 0, checkpoints: 0, maxEvent: 0, singleCpPct: 0 } },
  { name: '负数', stats: { docs: -1, events: -2, checkpoints: -3, maxEvent: -4, singleCpPct: -5 } },
  { name: 'null stats', stats: null },
]
let allSame = true
for (const c of CASES) {
  const a = Fproto(SHELL, c.stats)
  const b = Fgen(SHELL, c.stats)
  const same = a === b
  if (!same) allSame = false
  ok(same, '★★[等价] ' + c.name + ' ⇒ 两份输出相等')
}
ok(allSame, '★★★[核心] 6 组输入（含边界）两份实现输出全部逐字符相等')

const filled = Fgen(SHELL, { docs: 267, events: 2, checkpoints: 143, maxEvent: 113, singleCpPct: 0 })
ok(filled.indexOf('839') < 0 && filled.indexOf('127') < 0, '★★★[功能] 原型假数字 839/127 被真替换掉')
ok(filled.indexOf('267') >= 0 && filled.indexOf('143') >= 0, '★★★[功能] 真数字 267/143 出现在输出里')

console.log('')
console.log('== 4. 插入块形态：不得触发 ASI 陷阱 ==')
const firstCodeLine = inlineText.split('\n').filter((l) => l.trim() && !/^\s*\/\//.test(l))[0] || ''
console.log('  首个非注释行:', JSON.stringify(String(firstCodeLine).slice(0, 60)))
ok(!/^\s*[\(\[\`]/.test(firstCodeLine), '★★★[ASI] 首个代码行不以 ( / [ / backtick 开头')
ok(/^\s*var\s/.test(firstCodeLine) || /^\s*function\s/.test(firstCodeLine), '★★★[ASI] 首个代码行是 var / function 声明')
const beforeInline = CL_RAW.slice(0, CL_RAW.indexOf('// ═══ EV4-BLOCKS 内联区'))
const lastLine = beforeInline.split('\n').filter((l) => l.trim()).pop() || ''
console.log('  内联区前一行:', JSON.stringify(lastLine.trim().slice(-50)))
ok(lastLine.indexOf('join(') >= 0 && lastLine.trim().slice(-1) !== ';', '★★★[ASI] 前一行是 ].join(...) 且无分号 ⇒ ASI 风险真实存在')

console.log('')
console.log('== 5. 生成器 --check（幂等/一致性）==')
const r1 = spawnSync(process.execPath, [GEN, '--check'], { cwd: ROOT, encoding: 'utf8', timeout: 180000 })
ok(r1.status === 0, '★★★[幂等] --check 返回 0', 'status=' + r1.status)

console.log('')
console.log('== 6. 内建 client-loadable 回归 ==')
const rcl = spawnSync(process.execPath, [path.join(ROOT, 'tests/smoke/smoke-test-client-loadable.mjs')], { cwd: ROOT, encoding: 'utf8', timeout: 180000 })
const okLine = String(rcl.stdout || '').match(/PASS (\d+) \/ FAIL (\d+)/)
ok(rcl.status === 0 && okLine && Number(okLine[2]) === 0, '★★★[回归] client-loadable 全绿', okLine ? okLine[0] : '(未匹配)')

console.log('')
console.log('SUMMARY  PASS ' + pass + ' / FAIL ' + fail)
if (fail > 0) process.exit(1)