#!/usr/bin/env node
/** [water-hard] 水位「硬信号」回归(2026-09-10,实机取证后新增)。
 *
 * 背景(用户实测:官方压缩又抢在 75% 接续之前,接续从未发生):
 *   本机 provider 硬上限 1,048,576 token,而**预留输出预算 384,000 也算进请求**,
 *   于是消息实际只能用到约 664,576;插件此前把 `contextWindow`(1,000,000)当分母、
 *   把本地 meter 读数(~330k,对中文+代码+大工具输出明显偏乐观)当分子 —— 75% 永远到不了,
 *   直到上游直接 400: "...maximum context length is 1048576 tokens. However, you requested
 *   1050044 tokens (666044 in the messages, 384000 in the completion)."
 *
 * 本测试锁四件事:
 *   H1 纯函数:能从该 400 文本里解析出真实窗口/请求量/消息实占/预留额度,能扫到 compaction 事件;
 *   H2 源码守卫:checkWaterLevel 的分母是**官方声明窗口**(provider 自报过硬限时取 min,2026-09-13 口径修正,
 *      reserve 不得再计入分母)、用溢出事实做校准,并让 overflow/compaction/预测性硬墙成为「硬触发」;
 *   H3 边界:空事件/垃圾事件不得抛错(水位检查在 pre-step 每次工具调用都跑)。
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { scanPressureSignalsPre, findSessionModelPre } from '../../lib/water-window.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SRC = readFileSync(path.resolve(HERE, '..', '..', 'lib', 'index.js'), 'utf8')
let pass = 0, fail = 0
const ok = (c, n) => { if (c) { pass++; console.log('  ok -', n) } else { fail++; console.log('  FAIL -', n) } }

const REAL_400 = 'OpenAI API error (400): {"param":null,"code":"invalid_request_error","type":"invalid_request_error",' +
  '"message":"Error from provider (Console Go): Upstream request failed: [invalid_request_error] ' +
  "This model's maximum context length is 1048576 tokens. However, you requested 1050044 tokens " +
  '(666044 in the messages, 384000 in the completion). Please reduce the length of the messages or completion."}'

const events = [
  { seq: 11, type: 'request/header', data: { header: { config: { provider: 'opencode-go2', model: 'deepseek-flash', maxTokens: 384000 } } } },
  { seq: 12, type: 'request/context', data: { provider: 'opencode-go2', model: 'deepseek-flash', contextWindow: 1000000 } },
  { seq: 800, type: 'assistant/message', data: { message: { usage: { inputTokens: 222, outputTokens: 40, totalTokens: 341709 } } } },
  { seq: 808, type: 'assistant/attempt', data: { stream: [
    { chunk: { type: 'usage', usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } } },
    { chunk: { type: 'finish', reason: { kind: 'error', failure: { message: REAL_400, code: 'CONTEXT_WINDOW_EXCEEDED' } } } },
  ] } },
  { seq: 813, type: 'compaction/start', data: { compactionId: 'c1', turn: 4 } },
  { seq: 814, type: 'compaction/summary', data: { compactionId: 'c1', summary: [{ type: 'text', text: 'x' }] } },
]

console.log('[water-hard] H1 纯函数')
const sig = scanPressureSignalsPre(events)
ok(sig.overflow && sig.overflow.windowTokens === 1048576, '解析出真实窗口 1,048,576')
ok(sig.overflow && sig.overflow.requestedTokens === 1050044, '解析出请求总量 1,050,044')
ok(sig.overflow && sig.overflow.messageTokens === 666044, '解析出消息实占 666,044(校准分子用)')
ok(sig.overflow && sig.overflow.completionTokens === 384000, '解析出预留输出 384,000')
ok(sig.overflow && sig.overflow.seq === 808, '带出溢出事件 seq(供去重,避免重复触发)')
ok(sig.overflow && sig.overflow.code === 'CONTEXT_WINDOW_EXCEEDED', '保留 provider 错误码')
ok(sig.compactionSeq === 814, '扫到最近一次 compaction 事件的 seq(不被「只看最近 64 条」挡住)')
ok(sig.reservedTokens === 384000, '从 request/header 取到预留输出预算 maxTokens')

const model = findSessionModelPre(events)
ok(model.provider === 'opencode-go2' && model.model === 'deepseek-flash', '会话真实模型仍能取出')
ok(model.contextWindow === 1000000, '官方 contextWindow 仍能取出')
ok(model.maxTokens === 384000, 'findSessionModelPre 同时带出 maxTokens')

const later = events.concat([{ seq: 900, type: 'step/end', data: {} }])
ok(scanPressureSignalsPre(later).compactionSeq === 814, 'compaction 被更晚事件淹没后仍能扫到')
ok(scanPressureSignalsPre(events.slice(0, 3)).overflow === null && scanPressureSignalsPre(events.slice(0, 3)).compactionSeq === 0,
  '没有溢出/压缩时不误报')

console.log('[water-hard] H2 源码守卫')
// 2026-09-14 修正(对齐上游 PR #34):原断言 `/from '\.\/water-window\.js'/` 有两处问题 ——
// ①两段松散 && 各自可被无关文本满足(任意位置出现函数名 + 任意 import 命中),不构成「这条 import 存在」;
// ②写死了单一轨的文件名。本仓两轨模块名不同(开发轨 lib/water-window.js / 发行轨 lib/water-window.js),
// 故守卫改用单条 import 语句、文件名接受两轨写法 —— 上游发行轨与本地开发轨都必须是绿的。
ok(/import \{[^}]*\bscanPressureSignalsPre\b[^}]*\} from '\.\/water-window(-pre)?\.js'/.test(SRC),
  'index.js 已引入 scanPressureSignalsPre')
ok(/const reserve = Number\(sessModel\.maxTokens\) \|\| Number\(sig\.reservedTokens\) \|\| 0/.test(SRC),
  '预留额度取自会话请求头 maxTokens(而非硬编码)')
// 2026-09-13 口径修正(NEXT-VERSION-TODO 改点1):分母 = 官方声明窗口,provider 自报过硬限时取 min。
ok(/const triggerWin = hardWin > 0 \? Math\.min\(win, hardWin\) : win/.test(SRC),
  '判定窗 = 官方声明窗口(provider 自报硬限时取较小值)')
// 反向锁:旧口径(分母 = win − reserve)必须绝迹 —— reserve 只许出现在展示与硬判据里,不得进分母。
ok(!/reserve < win \* 0\.9/.test(SRC) && !/win\s*-\s*reserve\)\s*:\s*win/.test(SRC) && !/effectiveWin/.test(SRC),
  '反向锁:不得把 reserve 计入分母(旧 win−reserve 口径已废,effectiveWin 标识符一并清除)')
ok(!/estTokens \/ \(win - reserve\)/.test(SRC) && !/\/ \(win - reserve\)/.test(SRC),
  '反向锁:比例算式里不得出现 win − reserve 形式的分母')
ok(!/calibration|pressured/.test(SRC),
  '**不引入任何本地计量校准系数**(实测本地读数与 provider 的 "in the messages" 只差 0.8%,乘系数只会导致过早接续)')
ok(/const ratio = triggerWin > 0 && Number\.isFinite\(estTokens\) \? Math\.min\(estTokens \/ triggerWin, 99\)/.test(SRC),
  '分子直接用本地读数(不乘任何系数),分母是判定窗(官方窗口口径)')
ok(/const hardWall = estTokens > 0 && \(estTokens \+ reserve > triggerWin\)/.test(SRC),
  '预测性硬墙:estTokens + reserve > 判定窗(下一次请求就会被拒)才硬触发')
ok(/const hard = compacted \|\| overflowed \|\| hardWall/.test(SRC), 'overflow/compaction/硬墙同属硬触发')
ok(/const armRatio = hard \? Math\.max\(ratio, threshold\) : ratio/.test(SRC),
  '硬触发时直接按阈值触发接续(不再依赖比例算得准)')
ok(/compacted \? 'compaction' : overflowed \? 'overflow' : 'wall'/.test(SRC),
  '硬触发原因三分类:compaction / overflow / wall(水位记录供面板与排障)')
ok(/const over = armRatio >= threshold/.test(SRC) && !/const over = ratio >= threshold \|\| \(ratio >= 0\.5 && compacted\)/.test(SRC),
  '触发判定改用 armRatio(旧的「ratio≥0.5 才认 compaction」已废)')
ok(/rt\.waterLevel = armRatio/.test(SRC), 'arm 用的水位即 armRatio(armAutoContinue 直接吃 rt.waterLevel)')
ok(/lastOverflowSeen/.test(SRC), '溢出按 seq 去重,不重复触发')
// PR #29(2026-09-13):Node 22 下全量解压巨型会话文件会崩宿主 —— 切会话推导路径必须保持头帧解码。
ok(/decodeZstdFramesHead\(raw, 32, 8 \* 1024 \* 1024\)/.test(SRC) && !/decodeZstdFrames\(raw\)/.test(SRC),
  'waterWindowForSession 用头帧解码(前 32 帧/8MB),不得回退全量解压(Node 22 崩溃类)')
ok(/hardTrigger: this\.state\.waterLevelHardTrigger/.test(SRC) && /measuredRatio: ratio/.test(SRC),
  '水位记录同时留「实测比例 / 硬触发原因」供面板与排障')
ok(/this\.state\.waterLevelWall = hardWin > 0 \? Math\.max\(0, hardWin - reserve\) : 0/.test(SRC),
  'reserve 保留「距硬墙余量」展示职责(硬限 − 预留),不进触发分母')
ok(/ring: Number\(this\.state && this\.state\.waterLevelRing\) \|\| 0/.test(SRC) && /wall: Number\(this\.state && this\.state\.waterLevelWall\) \|\| 0/.test(SRC),
  'arm 时把双口径带进 armed 对象(state 缺失也不得让 arm 失败)')
ok(!/Math\.max\(0, events\.length - 64\)[\s\S]{0,200}compaction/.test(SRC) || /sig\.compactionSeq/.test(SRC),
  'compaction 检测不再局限于最近 64 条事件')

console.log('[water-hard] H3 边界')
let threw = false
try {
  scanPressureSignalsPre([])
  scanPressureSignalsPre(null)
  scanPressureSignalsPre([{}, { type: 'assistant/attempt' }, { type: 'assistant/attempt', data: { stream: null } }])
  findSessionModelPre(undefined)
} catch (e) { threw = true }
ok(!threw, '空/畸形事件不抛错(水位检查每次工具调用都跑)')
const junk = scanPressureSignalsPre([{ seq: 1, type: 'assistant/attempt', data: { stream: [{ chunk: { type: 'finish', reason: { kind: 'error', failure: { message: 'connection reset', code: 'ECONNRESET' } } } }] } }])
ok(junk.overflow === null, '非上下文溢出类错误不误判为硬触发')

console.log('[water-hard] H4 预留额度必须跟随「当前模型」(实测 de10b34f 中途 128k→256k→384k)')
{
  // 同一会话里用户中途换模型:路由各自的 maxTokens 不同(glm 128,000 / V4.1 256,000 / deepseek-flash 384,000)。
  // 预留额度必须取**最近一次请求**的值(倒序扫描、首个命中即用),否则换模型后会继续拿旧预留算分母。
  const switched = [
    { seq: 13, type: 'request/header', data: { header: { config: { provider: 'worldcodes', model: 'glm-5.3-flash', maxTokens: 128000 } } } },
    { seq: 14, type: 'request/context', data: { contextWindow: 1000000 } },
    { seq: 1260, type: 'request/header', data: { header: { config: { provider: 'deepseek-official', model: 'deepseek-v4.1-flash-expires-on-0910', maxTokens: 256000 } } } },
    { seq: 1973, type: 'request/header', data: { header: { config: { provider: 'opencode-go2', model: 'deepseek-flash', maxTokens: 384000 } } } },
  ]
  const m4 = findSessionModelPre(switched)
  ok(m4.maxTokens === 384000 && m4.model === 'deepseek-flash', 'findSessionModelPre 取最近一次请求的 maxTokens(不是最先那次)')
  ok(scanPressureSignalsPre(switched).reservedTokens === 384000, 'scanPressureSignalsPre 同为「取最新」语义')
  const mid = findSessionModelPre(switched.slice(0, 3))
  ok(mid.maxTokens === 256000 && mid.model === 'deepseek-v4.1-flash-expires-on-0910',
    '停在那个**已过期**的旧测试 id 上时取 256,000(历史值,仅作「换模型即换分母」的证据)')
  // 2026-09-13 口径修正后:「比例阈值点」与预留无关(分母=官方窗口,0.75×win 恒为 750,000);
  // 随模型变的是「预测性硬墙点」(win − reserve,下一次请求必被拒的边界)—— 这正是 reserve 仅存的两处职责之一。
  const win = 1000000
  const ratioPt = 0.75 * win
  const wall128 = win - 128000
  const wall384 = win - 384000
  ok(Math.round(ratioPt) === 750000, '比例阈值点与预留无关:0.75 × 1,000,000 = 750,000(glm / deepseek-flash 同点)')
  ok(wall128 === 872000 && wall384 === 616000,
    '硬墙点随预留自适应:glm 872,000 / deepseek-flash 616,000(estTokens + reserve > win 即下一次请求必被拒)')
  ok(wall384 < ratioPt && ratioPt < wall128,
    '本机这种大预留路由(384k=36.6% win)硬墙先于比例线;预留 <25% win 的常规路由比例线先生效(墙只作兜底)')
  ok(!/maxTokens:\s*\d{4,}/.test(SRC.slice(SRC.indexOf('const reserve ='), SRC.indexOf('const reserve =') + 200)),
    '分母处的预留额度不是硬编码常数')
}

console.log('[water-hard] H5 重启后不得把历史 compaction/溢出当成「刚刚发生」')
{
  // 2026-09-10 实机事故:17:50 重启加载新代码,0.7 分钟后 diag 就打出
  //   `water level advisory: ratio=0.48→0.75(hard:compaction) tokens=294681/616000`
  //   `auto-continue armed: sid=session-40727a84…`
  // 原因是运行时状态随重启清零,lastCompactionSeen=0 ⇒ 16:54 的历史压缩被当成新事件。
  // 修正:每个会话在**本进程内首次观测**时只建立基线,其后才按 seq 前进判定。
  ok(/rt\.waterCompactBaselineSid !== sid0/.test(SRC) && /rt\.waterCompactBaselineSid = sid0/.test(SRC),
    '首次观测某会话只建立基线(把已存在的 compaction/溢出记为「已见」)')
  ok(/rt\.lastCompactionSeen = cseq[\s\S]{0,160}?rt\.lastOverflowSeen = oseq/.test(SRC),
    '基线同时覆盖溢出(历史 400 同样不得重放)')
  ok(/if \(cseq > \(Number\(rt\.lastCompactionSeen\) \|\| 0\)\) \{ compacted = true/.test(SRC),
    '基线之后才按「seq 前进」判定新压缩')
}

console.log('\n[water-hard] ' + pass + '/' + (pass + fail) + ' assertions passed')
if (fail) process.exit(1)
