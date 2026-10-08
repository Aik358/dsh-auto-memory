#!/usr/bin/env node
/**
 * [guard-advisor] 守卫失败时的**归因提示器**（只读；不写任何文件、不跑测试）。
 *
 * ★背景（2026-10-01 用户裁定给出的事故教训）：
 *   「有些东西不能太严格了，一下子把做完的直接回滚了，就太恐怖了。
 *     如果是判断有问题，但是不直接生成回滚，提醒一下是否应该更新判断判据，
 *     还是真的有问题就好了。」
 *
 *   本仓库有 74 个带「哈希/计数基线锁」的用例。这类锁的正确行为是**报警**，
 *   而不是**判死**——因为锁红有两种截然不同的成因：
 *     (A) 真缺陷：被测代码坏了（该修代码）
 *     (B) 判据过期：代码是**有意**演进的，只是锁里写死的常量没跟着上移（该修判据）
 *   混为一谈的后果就是本次实测：8 处红全部是 (B)，却让整批成果看起来"坏了"。
 *
 * ★本工具的契约：
 *   ① **纯只读** —— 只读测试源码 + 只读上一次全量输出的日志；不写盘、不改判据、不跑用例。
 *   ② **只出建议，不执行** —— 建议值以「待人工确认」形式打印，绝不自动落盘。
 *   ③ 判定依据可复算 —— 每条结论都带「哪个文件哪一行 + 拿到的值 + 期望的值」。
 *
 * 用法：
 *   node tools/run-smoke.mjs > .diag/smoke-last.txt 2>&1 ; node tools/guard-advisor.mjs
 *   或：node tools/guard-advisor.mjs .diag/smoke-last.txt
 */
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const LOG = process.argv[2] || path.join('.diag', 'smoke-last.txt')

if (!existsSync(path.join(ROOT, LOG))) {
  console.log('[guard-advisor] 没找到全量输出：' + LOG)
  console.log('  先跑： node tools/run-smoke.mjs > "' + LOG + '" 2>&1')
  process.exit(0)
}
const raw = readFileSync(path.join(ROOT, LOG), 'utf8')

// ---------- 1) 抽出失败清单 ----------
const failFiles = [...raw.matchAll(/^--- FAIL: (\S+)/gm)].map((m) => m[1])
const summary = (raw.match(/PASS \d+ \/ FAIL \d+ \/ TIMEOUT \d+/) || ['(无汇总行)'])[0]

// ---------- 2) 把每个失败文件的断言行挖出来 ----------
/** 判定「这条断言锁的是常量基线」还是「锁的是关系式」——前者才可能"过期"。 */
const BASELINE_HINT = /sha16|sha256|baseline|基线|计数演进|'[0-9a-f]{32,}'|'[0-9A-F]{16}'|(?:eq|equal|ok)\([^)]*,\s*\d{1,5}\s*[,)]|长度|条数|count/i

const rows = []
for (const f of failFiles) {
  const p = path.join(ROOT, 'tests', 'smoke', f)
  if (!existsSync(p)) { rows.push({ f, kind: 'unknown', note: '测试文件不存在' }); continue }
  const src = readFileSync(p, 'utf8')
  const lines = src.split(/\r?\n/)
  const hits = []
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    if (!BASELINE_HINT.test(l)) continue
    if (!/(assert|eq\(|ok\(|!==|===)/.test(l)) continue
    hits.push({ line: i + 1, text: l.trim().slice(0, 160) })
  }
  rows.push({ f, kind: 'analyzed', hits: hits.slice(0, 6), nHits: hits.length })
}

// ---------- 3) 从日志里捞「实际值 vs 期望值」（守卫自己报的，最权威） ----------
const pairs = []
for (const m of raw.matchAll(/(?:actual|got)\s*[:=]\s*['"]?([0-9a-fA-F]{16,}|[0-9]{1,4})['"]?/g)) pairs.push(m[1])
for (const m of raw.matchAll(/(?:expected|want)\s*[:=]\s*['"]?([0-9a-fA-F]{16,}|[0-9]{1,4})['"]?/g)) pairs.push(m[1])
const gotWant = [...raw.matchAll(/\[got=([^\]]+?) want=([^\]]+?)\]/g)].map((m) => [m[1], m[2]])
const docMismatch = [...raw.matchAll(/文档 (\d+) vs 代码 (\d+)/g)].map((m) => [m[1], m[2]])

// ---------- 4) 输出 ----------
console.log('')
console.log('════ guard-advisor ════')
console.log('  全量汇总：' + summary)
console.log('  失败文件：' + (failFiles.length ? failFiles.join(', ') : '（无 —— 无需归因）'))
console.log('')

if (!failFiles.length) {
  console.log('  ✔ 全绿。基线锁与真值一致，不存在「判据过期」问题，也无需更新任何锁。')
  console.log('')
  process.exit(0)
}

console.log('── 逐条归因（本工具只提示，不动任何文件）──')
for (const r of rows) {
  console.log('')
  console.log('  ▸ ' + r.f)
  if (r.kind !== 'analyzed') { console.log('      ' + r.note); continue }
  console.log('      命中「基线型」断言 ' + r.nHits + ' 处：')
  for (const h of r.hits) console.log('        L' + h.line + '  ' + h.text)
}
console.log('')
console.log('── 该看哪边？判据（三步，别跳）──')
console.log('  ① 这条锁**锁的是常量**（sha/计数/字段数）还是**关系式**？')
console.log('       · 关系式（如「A 恒等于 B+1」）→ 红即真缺陷，修代码。')
console.log('       · 常量（基线 sha、路由条数、文档条数）→ 继续 ②。')
console.log('  ② 被测代码这轮**有没有被有意改动**？')
console.log('       · 有（如本批新增 1 条路由、改了默认值）⇒ 锁过期，**改判据**（把常量上移到新值）。')
console.log('       · 没有 ⇒ 真缺陷，修代码。')
console.log('  ③ 改判据时**必须用守卫自己报出的 actual**（下面这些），不要手算：')
if (gotWant.length) for (const [g, w] of gotWant) console.log('       got=' + g + '  want=' + w + '   ⇒ 建议把 want 上移为 ' + g)
if (docMismatch.length) for (const [d, c] of docMismatch) console.log('       文档 ' + d + ' vs 代码 ' + c + '   ⇒ 建议把文档改成 ' + c)
if (!gotWant.length && !docMismatch.length) console.log('       （日志里没有 got/want 对；重跑一次并保留完整输出）')
console.log('')
console.log('  ★本工具**不会**替你改判据，也**不会**回滚任何成果。')
console.log('   确认属于 ②「有意演进」后，再手工把上面建议值写进对应断言。')
console.log('')
