#!/usr/bin/env node
/**
 * The host proposes sections before pre-step and admits them after step/start. Only the
 * admitted snapshot is projected. A proposal retains the preceding section; repeated
 * admission of the same request must reproduce the bytes, not spend another grant.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { markers, message, startDeliveryHost } from '../lib/delivery-step-fixture.mjs'

const SRC_PATH = path.resolve(process.env.DAM_AUDIT_ENGINE_SOURCE || process.env.DAM_INDEX_JS || path.join(import.meta.dirname, '../../lib/index.js'))
if (process.env.DAM_INDEX_JS) process.env.DAM_AUDIT_ENGINE_SOURCE = SRC_PATH
const SRC = readFileSync(SRC_PATH, 'utf8')
let pass = 0, fail = 0
function ok(cond, msg) { if (cond) { pass++; console.log('  ok - ' + msg) } else { fail++; console.log('  FAIL - ' + msg) } }

// Used only by the structural guard below. Behavioral cases exercise apply()'s registered hook and surface.
const start = SRC.indexOf('let tieredFullGranted = false')
const end = 'return finalizePre(snap + engine.renderReflectionRequest())'
const stop = SRC.lastIndexOf(end)
if (start < 0 || stop <= start) throw Error('Decision section not found for structural guard T7')
const SEG = SRC.slice(start, stop + end.length)
const host = await startDeliveryHost()
try {
  const session = (gap = 10) => host.session({ runTierInjectEnabled: true, snapshotMinGapRounds: gap, slimEveryRounds: 3 })
  const run = (s, msgs = []) => s.request(msgs, { repeat: true, toolStep: true })
  const isFull = r => r.kind === 'full' && r.text.includes(markers.card)

  const auto = session()
  const a = await run(auto), b = await run(auto)
  ok(a.draftText === '', 'T1-a 首请求无历史主面，预备帧为空')
  ok(isFull(a) && a.firstPostText === a.text, 'T1-b 首次准入交付完整卡，重复读取字节不变')
  ok(b.draftText === a.text, 'T3e-a 下一工具步的预备帧只读上次已投主面')
  ok(b.kind === 'run-slim' && !b.text.includes(markers.event), 'T3e-b 同 turn 内的非真人下一步不重复投完整版、无真人事件卡')

  const people = session()
  const h1 = await run(people, [message('user')]), h2 = await run(people, [message('user')])
  ok(h1.draftText === '', 'T2-a 未准入的首次真人请求不提前消耗完整版')
  ok(isFull(h1) && h1.text.includes(markers.full), 'T2-b 首次真人投影含完整正文')
  ok(h1.firstPostText === h1.text, 'T3-a 第一条真人请求的准入输出与投影逐字节一致')
  ok(h2.draftText === h1.text, 'T3-b 第二条真人请求的预备帧仍是上次完整正文')
  ok(h2.firstPostText === h2.text && h2.text !== h2.draftText, 'T3-c 新请求准入不误用上一份完整定稿')
  ok(h2.kind === 'human-slim' && h2.text.includes(markers.event), 'T3-d 同 turn 相邻第二条真人精简正文含事件 marker')

  const periodic = session(), fullAt = [], unexpected = []
  for (let step = 1; step <= 31; step++) {
    const r = await run(periodic)
    if (isFull(r)) fullAt.push(step)
    else if (r.kind !== 'run-slim') unexpected.push(step + ':' + r.kind)
  }
  ok(unexpected.length === 0, 'T4 其余请求均投运行精简正文；异常步 ' + JSON.stringify(unexpected))
  ok(fullAt.join(',') === '1,11,21,31', 'T4 完整版精确落在第 1/11/21/31 个模型请求（实测 ' + fullAt + '）')

  const sparse = session(999)
  const first = await run(sparse), slim = await run(sparse)
  ok(slim.draftText === first.text && slim.firstPostText === slim.text, 'T5-a 精简请求预备帧保留旧正文，准入定稿可复读')
  ok(slim.kind === 'run-slim' && slim.text.includes(markers.slim), 'T5-b 实际准入为精简正文')
  const guideTools = ['memory_log', 'memory_note', 'memory_procedure', 'memory_recall']
  ok(guideTools.every(n => slim.text.includes(n)), 'T6 精简版实际交付四项维护与检索指引')
} finally { await host.close() }

// ── T6 精简版必须含「记忆维护底线」（用户硬性底线）──
{
  // 直接读生产实现的 slim 层文案键（该键由 renderSlimSnapshotPre 使用）
  ok(/snapshotSlimMaintain/.test(SRC), "T6-a 精简版层文案键 snapshotSlimMaintain 存在")
  const keyM = SRC.match(/snapshotSlimMaintain:\s*'([^']*)'/)
  ok(!!keyM, "T6-b 该键有真实文案")
  if (keyM) {
    const txt = keyM[1]
    const need = ["memory_log", "memory_note", "memory_procedure", "memory_recall"]
    const miss = need.filter((n) => !txt.includes(n))
    ok(miss.length === 0, "T6-c ★精简版文案含全部四项维护指引" + (miss.length ? "（缺 " + miss.join(",") + "）" : ""))
  }
  // 生产实现是 L(snapshotSlimMaintain)（裸标识符，不是字符串字面量）
  const pushed = /out\.push\('\\n' \+ L\(snapshotSlimMaintain\)\)/.test(SRC)
    || /out\.push\('\\n' \+ L\('snapshotSlimMaintain'\)\)/.test(SRC)
  ok(pushed, "T6-d 该文案已真正 push 进精简版输出链")
}

// ── T7 定稿缓存必须覆盖所有**决策出口**（负路径）──
// ⚠️ 必须先剥注释再匹配：决策段里有 4 处注释**引用**了旧实现
//    `return engine.renderReflectionRequest()`，不剥注释会把说明文字当成真实代码
//    （本仓 CRLF 教训：负向断言对未剥注释文本匹配 ⇒ 假红或假绿）。
{
  const stripped = SEG
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(/\r?\n/).map((l) => l.replace(/\/\/[^\r\n]*/, "")).join("\n")
  const wrapped = (stripped.match(/return finalize(?:Slim)?Pre\(/g) || []).length
  const rawExits = (stripped.match(/return (?!finalize(?:Slim)?Pre\b)[^\n;]*renderReflectionRequest\(\)/g) || []).length
  const delegates = /const finalizeSlimPre\s*=[^}]+return finalizePre\(text\)/.test(stripped)
  ok(wrapped >= 8 && delegates, 'T7-a 完整与精简出口均走同一个请求定稿函数（实测 ' + wrapped + ' 处）')
  ok(rawExits === 0, 'T7-b 决策出口没有漏过定稿（剥注释后实测 ' + rawExits + ' 个）')
}

console.log("PASS " + pass + " / FAIL " + fail)
process.exit(fail ? 1 : 0)
