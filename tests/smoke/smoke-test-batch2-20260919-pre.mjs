#!/usr/bin/env node
/**
 * smoke-test-batch2-20260919-pre.mjs —— 第二批上游 issue 修复套件（#69 / #70 / #71）
 *
 * 三条都在 pre 线**实测仍存在**（子代理只读核验 + 实跑复现），故本套件锁定修复后的行为。
 *   ① #71  l0-extract growToMin：压空白导致 `\n` 分支死代码 ⇒ 内部列表标记进 L0
 *   ② #69  m7-index-sync-host：currentEpoch 采样早于 lazy spawn + `epoch &&` 前置致 null 缓存永不失效
 *   ③ #70  semantic-js：degraded 单向闩锁 + 探针/档位不看 degraded ⇒ UI 报"就绪"实际降级
 */
import { readFileSync } from 'node:fs'
import { extractL0Pre } from '../../lib/l0-extract-pre.js'
import { probeJsSemanticAssets, createJsSemanticEnginePre } from '../../lib/semantic-js-pre.js'

let pass = 0, fail = 0
const ok = (c, n, x) => {
  if (c) { pass++; console.log('  ok -', n) }
  else { fail++; console.error('  FAIL -', n, x == null ? '' : x) }
}
const src = (p) => readFileSync(new URL('../../lib/' + p, import.meta.url), 'utf8')
/**
 * ★ 只取**代码行**、剥掉注释行 —— 本仓已知陷阱：修复处的中文注释会引用旧代码文本，
 * 直接对整份源码做 `!includes('旧写法')` 会**被自己的注释误伤**（假红）。
 */
const codeOnly = (text) => String(text).split(/\r?\n/)
  .filter((l) => {
    const t = l.trim()
    return !(t.startsWith('//') || t.startsWith('*') || t.startsWith('/*'))
  }).join('\n')

console.log('\n[① #71] growToMin 必须保留换行结构（\n 分支不得是死代码）')
{
  const s = src('l0-extract-pre.js')
  // 反向锁：不得再用「把全部空白压成空格」的写法
  ok(!/const flat = clean\(full\.replace\(\/\\s\+\/g, ' '\)\)/.test(s),
    '★ 不再把 \\s+（含换行）全压成空格', '仍是旧写法')
  ok(/\[\^\\S\\r\\n\]\+/.test(s), '★ 改用「行内连续空白」压平（保留 \\n）')
  ok(/replace\(\/\\r\\n\?\/g, '\\n'\)|replace\(\/\\r\\n\?\/g, '\\\\n'\)/.test(s) || /\\r\\n\?/.test(s),
    '★ 折叠 CRLF → LF（避免 \\r 残留）')

  // 行为：原 issue 复现用例
  const r1 = extractL0Pre('- 12:02 修复了 A 模块\n- 12:03 修复了 B 模块', { minChars: 4, maxChars: 160 })
  const l0a = r1 && r1.l0 ? r1.l0 : String(r1)
  console.log('    · L0 =', JSON.stringify(l0a))
  ok(!/\S\s+-\s+\d{1,2}:\d{2}/.test(l0a), '★★ 第 2 行的 `- HH:MM` 标记不再进入 L0', l0a)

  const r2 = extractL0Pre('- 12:02 修复了写入丢失\n- 12:03 修复了解析崩溃\n- 12:04 修复了队列死锁', { minChars: 4, maxChars: 160 })
  const l0b = r2 && r2.l0 ? r2.l0 : String(r2)
  console.log('    · L0 =', JSON.stringify(l0b))
  ok(!/-\s+\d{1,2}:\d{2}/.test(l0b), '★★ 三行日志同样干净（issue 正文用例）', l0b)
}

console.log('\n[② #69] epoch 失效判据必须把 null/缺失缓存视为无效')
{
  const s = codeOnly(src('m7-index-sync-host-pre.js'))
  // 反向锁：不得再有「裸 epoch &&」前置（null 缓存永不失效的根因）
  ok(!/if \(cached && epoch && cached\.epoch !== epoch\)/.test(s),
    '★★ 不再使用裸 `epoch &&` 前置（null 缓存永不失效的根因）')
  // 正面锁：判据里必须有「cached.epoch 为空 ⇒ 无效」
  ok(/if \(cached && \(!cached\.epoch \|\|/.test(s),
    '★★ 判据补上「cached.epoch 为空 ⇒ 一律无效」')
  // 旧语义的另一半必须保留：epoch 非空时仍要求严格相等（worker 重启换 epoch 仍要失效重同步）
  ok(/epoch && cached\.epoch !== epoch/.test(s),
    '★ 保留「epoch 非空时严格相等」——否则 worker 重启不再触发重同步')
  // 采样点**不动**（最小修复）：epoch 声明仍在函数头，M78 的 P3 契约依赖它
  ok(/const epoch = currentEpoch\(\)/.test(s),
    '★ epoch 采样点未改动（最小修复，守住 M78 P3 契约）')
  // 标识符作用域自查：删掉声明却仍引用 = 本仓经典缺陷类别①（本轮实际踩过一次）
  const uses = (s.match(/\bepoch\b/g) || []).length
  ok(uses >= 2, '★ epoch 既有声明也有使用（防「删声明留引用」类缺陷）', `uses=${uses}`)
}

console.log('\n[③ #70] degraded 不得是单向闩锁；探针/档位必须看 degraded')
{
  const s = src('semantic-js-pre.js')
  // 有界自动重试
  ok(/degradedAt/.test(s), '★ 新增 degradedAt（置位时刻）')
  ok(/degradedRetryMs/.test(s), '★★ 有界自动重试（冷却期可配）')
  ok(/if \(since < retryMs\) throw new Error\(degraded\)/.test(s),
    '★★ 冷却期内仍抛（不每轮狂加载），过期后允许重试')
  ok(/statsRetries\+\+/.test(s), '★ 重试计数可观测')
  // 探针纳入 degraded
  ok(/degradedReason/.test(s), '★ probeJsSemanticAssets 接收 degraded 参数')
  ok(/ready: filesReady && !degraded/.test(s), '★★ ready 必须同时满足「文件齐备 + 未降级」')
  ok(/filesReady,/.test(s), '★ 保留 filesReady 供 UI 区分「文件缺」与「引擎降级」')

  // index.js 接点
  const ix = src('index.js')
  ok(/engine\._jsSemantic\.status\(\)/.test(ix) && /\.degraded/.test(ix),
    '★★ index.js 的 semanticAssetProbe 已注入引擎 degraded（唯一接点，三条路径共享）')

  // client.js 引导卡
  const cj = src('client.js')
  ok(/sem\.degraded/.test(cj), '★★ 引导卡新增 degraded 分支（不再误报"已就绪"）')

  // 行为：探针三态
  const p1 = probeJsSemanticAssets('C:/nonexistent-plugin-dir', [], '')
  ok(p1.ready === false && p1.degraded === '', '无资产 + 未降级 ⇒ ready=false 且 degraded 空')
  ok('filesReady' in p1, '返回体含 filesReady')
  const p2 = probeJsSemanticAssets('C:/nonexistent-plugin-dir', [], 'onnx corrupt')
  ok(p2.ready === false && p2.degraded === 'onnx corrupt', '降级时 degraded 透出', JSON.stringify(p2))

  // 行为：引擎在 degraded 且冷却未过时必须抛（不静默成功）
  const eng = createJsSemanticEnginePre({
    pluginDir: 'C:/nonexistent-plugin-dir',
    modelDirCands: ['C:/nonexistent-plugin-dir/models'],
    degradedRetryMs: 3600000,
  })
  ok(typeof eng.status === 'function', '引擎 status 可用')
  ok(eng.status().degradedRetries === 0, '初始 retries=0')
  ok(eng.status().degradedRetryMs === 3600000, '冷却期可配并回显', String(eng.status().degradedRetryMs))
}

console.log('\n[④] 汇总：三条均不得回退（源码级反向锁）')
{
  const l0 = codeOnly(src('l0-extract-pre.js')), sync = codeOnly(src('m7-index-sync-host-pre.js')), sem = codeOnly(src('semantic-js-pre.js'))
  ok(!/full\.replace\(\/\\s\+\/g/.test(l0), 'l0 未退回全空白压平')
  ok(!/cached && epoch &&/.test(sync), 'index-sync 未退回 `epoch &&`')
  ok(/!cached\.epoch/.test(sync), 'index-sync 仍把 null 视为无效')
  ok(!/if \(degraded\) throw new Error\(degraded\)\n/.test(sem) || /degradedRetryMs/.test(sem),
    'semantic-js 的 degraded 不是单向闩锁')
}

console.log(`\n[batch2-20260919] ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
