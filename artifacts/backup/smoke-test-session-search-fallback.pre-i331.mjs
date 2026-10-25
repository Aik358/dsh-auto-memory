#!/usr/bin/env node
/**
 * smoke-test-session-search-fallback.mjs —— sessions 检索兜底（2026-09-29）★真抽取产线方法真执行。
 *
 * 背景（用户报障实录）：宿主 `@deepseek-ai/dsh-session-format-v0-to-v1` 的 v0→v1 迁移器只认
 * `subagent/descriptor` data.version===3；本机 2026-08-19~23 的 39 个旧会话写的是 v2 ⇒ 任一
 * 冷会话重索引失败 ⇒ 整轮 persistence observation 抛 SESSION_QUERY_PERSISTENCE_FAILED ⇒
 * `sq.searchSessions` 整体不可用 ⇒ 「记忆检索|sessions」通道全死。
 *
 * 修法：`searchSessionHistory` 捕获宿主索引抛错后，走插件内**词法兜底扫描**
 * （多帧 zstd 解码 + 预算内逐文件扫描 + 跳过解不开的文件），通道从「全死」变「绕过毒会话继续搜」。
 *
 * 判据（断言对象 = 产线代码的执行结果，不是副本）：
 *  - 宿主抛错 ⇒ 兜底真被触发，返回非空结果，尾部带兜底口径说明行
 *  - 结果条目形状与宿主索引同构（`· [日期] cwd` + snippet 行）
 *  - 预算纪律：超巨型文件被跳过（负路径：全坏文件 ⇒ 空数组，绝不抛）
 *  - `sessionQuery` 缺失 ⇒ 恒 []（既有契约不回归：recall 侧打印「索引未部署」）
 *  - 宿主正常路径 ⇒ 兜底**不触发**（走原渲染，保持既有输出形状）
 *  - 变异检查：兜底说明行字面量被改 ⇒ 红（证明断言非恒真）
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import pathModule from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { zstdDecompressSync } from 'node:zlib'
import { decodeZstdFramesHead } from '../../lib/subagent-gc.js'

let pass = 0, fail = 0
const failures = []
function ok(cond, name, got) {
  if (cond) { pass++ } else { fail++; failures.push(name + (got === undefined ? '' : ' | got=' + JSON.stringify(got))) }
}

const require = createRequire(import.meta.url)
const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..')
const src = readFileSync(join(root, 'lib', 'index.js'), 'utf8')

// ── 真抽取：searchSessionHistory + lexicalSessionScanFallback 两个产线方法 ──
const start = src.indexOf('  async searchSessionHistory(')
const end = src.indexOf('  /** M-CM4·自动窗口')
ok(start > 0, '抽取窗口起点命中')
ok(end > start, '抽取窗口终点命中')
const body = src.slice(start, end)

// 沙箱依赖：与产线模块同名的注入参数（真 fs / 真 zstd / 真 subagent-gc 解码器）
const fsSync = {
  readdirSync: (await import('node:fs')).readdirSync,
  readFileSync: (await import('node:fs')).readFileSync,
  statSync: (await import('node:fs')).statSync,
  existsSync: (await import('node:fs')).existsSync,
}
const dateStrOf = (ts) => { const d = new Date(ts); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` }
// 抽取窗口只含两个方法体；产线模块顶层的 fs 具名导入（readdirSync 等）在窗口之外 ⇒ 壳单独绑定
const makeHost = (over = {}) => {
  const factory = new Function('path', 'readdirSync', 'readFileSync', 'statSync', 'existsSync',
    'zstdDec', 'decodeZstdFramesHead', 'dateStrOf', 'dshHome',
    `return class SessHost {\n${'  ' + body}\n}`)
  const Cls = factory(pathModule, fsSync.readdirSync, fsSync.readFileSync, fsSync.statSync, fsSync.existsSync,
    zstdDecompressSync, decodeZstdFramesHead, dateStrOf, over.dshHome || (() => join(process.env.USERPROFILE || '', '.dsh')))
  return new Cls()
}

// ── 夹具：临时会话目录（DSH_HOME 隔离，不碰真机 ~/.dsh）──
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { zstdCompressSync } from 'node:zlib'
const tmpHome = mkdtempSync(join(tmpdir(), 'dam-sessfb-'))
function zstdFramesJsonl(lines) {
  // 每行一帧，且帧内容含行尾换行（与会话日志同构：逐事件独立 zstd 帧，解压拼接后是合法 JSONL）
  return Buffer.concat(lines.map((l) => zstdCompressSync(Buffer.from(l + '\n', 'utf8'))))
}
const wsName = '--D-dsh-auto-memory--'
function mkSession(sid, events) {
  const dir = join(tmpHome, 'sessions', wsName, sid)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'session.jsonl.zstd'), zstdFramesJsonl(events))
  return dir
}
const hdrOf = (id, cwd) => JSON.stringify({ type: 'session', version: 0, id, createdAt: 1787125212713, cwd })
const POISON_DESC = JSON.stringify({ type: 'subagent/descriptor', seq: 5, data: { version: 2, mode: 'one-shot', provider: 'spawn', label: 'Find closest prior art' } })

mkSession('aaaa-1111', [hdrOf('aaaa-1111', 'D:\\proj-a'), POISON_DESC,
  JSON.stringify({ type: 'user/message', seq: 6, data: { content: '讨论水位感知阈值的校准问题' } })])
mkSession('bbbb-2222', [hdrOf('bbbb-2222', 'D:\\proj-b'),
  JSON.stringify({ type: 'assistant/message', seq: 1, data: { content: '交接白板提到发布前必跑回归' } })])
// 超巨型文件（>16MB 原始）⇒ 必须被预算纪律跳过
{
  const dir = mkSession('cccc-3333', [hdrOf('cccc-3333', 'D:\\proj-c'),
    JSON.stringify({ type: 'user/message', seq: 1, data: { content: '水位 巨型会话也应可被跳过' } })])
  const f = join(dir, 'session.jsonl.zstd')
  const big = Buffer.concat([readFileSync(f), Buffer.alloc(17 * 1024 * 1024, 0)])
  writeFileSync(f, big)
}
// 全坏文件（非 zstd 魔数）⇒ 负路径
{
  const dir = join(tmpHome, 'sessions', wsName, 'dddd-4444')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'session.jsonl.zstd'), Buffer.from('not zstd at all'))
}

const host = makeHost({ dshHome: () => tmpHome })

// ── ① 宿主索引抛错 ⇒ 兜底触发 ──
host._sessionQuery = { searchSessions: async () => { throw new Error('session-search persistence observation failed: subagent/descriptor 5 uses unsupported descriptor version 2; source v0 artifact remains unchanged') } }
const r1 = await host.searchSessionHistory('水位 感知', 8)
ok(Array.isArray(r1) && r1.length >= 2, '①兜底非空(命中+说明行)', r1.length)
ok(r1.some((l) => l.includes('水位感知阈值') || l.includes('水位')), '①命中词出现在 snippet')
// ★2026-10-01 判据更新（移植上游 #162）：说明行文案由「按修改时间覆盖最近 N 个会话」
//   改为「按修改时间从新到旧…头部受预算限制…非全量」——措辞变了，语义未变。
//   判据改为「尾部有兜底口径说明行 + 声明了分页/预算边界（非全量）」，不再绑定旧措辞。
ok(r1[r1.length - 1].includes('兜底口径') && r1[r1.length - 1].includes('非全量'), '①尾部兜底说明行(含非全量声明)')
ok(r1[0].startsWith('· [2026-'), '①条目形状与宿主索引同构(日期头)', r1[0].slice(0, 20))
// 巨型文件（cccc-3333，17MB）必须被 16MB 预算纪律跳过 ⇒ 其专属命中词不成为条目
const r1b = await host.lexicalSessionScanFallback('巨型会话', 8)
ok(!r1b.some((l) => l.includes('cccc-3333') || l.includes('proj-c')), '①b超巨型文件被预算纪律跳过')

// ── ② 宿主正常 ⇒ 兜底不触发，走原渲染 ──
host._sessionQuery = { searchSessions: async ({ query, limit }) => ({ items: [{ header: { createdAt: 1787125212713, cwd: 'D:\\x', id: 'zz' }, bestMatch: { snippet: 'host-index-hit' } }] }) }
const r2 = await host.searchSessionHistory('任意', 8)
ok(r2.length === 1 && r2[0].includes('host-index-hit') && !r2.join('').includes('兜底口径'), '②宿主正常路径不走兜底')

// ── ③ sessionQuery 缺失 ⇒ 恒 [] ──
host._sessionQuery = undefined
const r3 = await host.searchSessionHistory('水位', 8)
ok(Array.isArray(r3) && r3.length === 0, '③无索引恒空数组')

// ── ④ 全坏文件 + 未命中词 ⇒ 空数组，绝不抛 ──
host._sessionQuery = { searchSessions: async () => { throw new Error('boom') } }
const r4 = await host.searchSessionHistory('完全不相干的查询词组', 8)
ok(Array.isArray(r4) && r4.length === 0, '④未命中返回空(不抛)', r4.length)

// ── ⑤ 预算纪律：scan 帧预算上限生效（160 帧 / 4MB 头预算内正常返回）──
const r5 = await host.lexicalSessionScanFallback('发布前必跑回归', 8)
ok(r5.length >= 2 && r5.some((l) => l.includes('proj-b')), '⑤第二会话可命中', r5.length)

// ── ⑥ 变异检查：兜底说明行字面量被改 ⇒ 红 ──
{
  // ★2026-10-01 判据更新（移植上游 #162）：产线现含**两处**「兜底口径」字面量（searchSessionHistory
  //   的 catch 与 lexicalSessionScanFallback 的 finish）——String.replace 只换第一处，真正走到的那处
  //   没被变异 ⇒ 断言恒红（假绿失效）。改用带 g 的正则，保证全量变异。
  const mutated = body.replace(/兜底口径/g, "兜底口径X")
  const factory = new Function('path', 'readdirSync', 'readFileSync', 'statSync', 'existsSync',
    'zstdDec', 'decodeZstdFramesHead', 'dateStrOf', 'dshHome', `return class SessHostM {\n  ${mutated}\n}`)
  const M = factory(pathModule, fsSync.readdirSync, fsSync.readFileSync, fsSync.statSync, fsSync.existsSync,
    zstdDecompressSync, decodeZstdFramesHead, dateStrOf, () => tmpHome)
  const m = new M()
  m._sessionQuery = { searchSessions: async () => { throw new Error('x') } }
  const rm = await m.searchSessionHistory('水位 感知', 8)
  // 变异把说明行前缀 [兜底口径] 改成 [兜底口径X] ⇒ 原字面量「兜底口径]」应消失
  ok(!rm.join('').includes('兜底口径]'), '⑥变异后说明行字面量改变(断言非恒真)')
}

// ── 清理 ──
try { rmSync(tmpHome, { recursive: true, force: true }) } catch (e) { /* 临时目录清理失败不碍事 */ }

console.log(`PASS ${pass} / FAIL ${fail}`)
if (fail) { console.log('FAILURES:\n' + failures.map((f) => ' - ' + f).join('\n')); process.exit(1) }
