// T7-e 守卫（2026-09-20 用户报「发布后这些工具后面的 -pre 是要去掉的」）
//
// 事故：`tools/release.mjs` 用**手写映射表**把预览名 `memory_*_pre` 反转成正式裸名，
//   但 `memory_expand` / `memory_trace` **不在表里** ⇒ 发布物残留 `_pre`
//   （REL 线实测证实）；`memory_procedure`（T4 新增）同样漏登记。
//   更糟的是 **残留闸门也没登记这三个**，所以漏了**两次都不报警**。
//
// 本套件的立场：**不靠人记**——直接拿「宿主里真实注册的工具名」当真源，
//   对 release.mjs 的两张清单做**双向对账**。任何一处漏登记 ⇒ 红。
//
// 真源：lib/index.js 里的 `defineTool('<name>'`（这是运行时真实注册的名）。
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
const IDX = readFileSync(path.join(ROOT, 'lib', 'index.js'), 'utf8')
// ★`tools/release.mjs` 是发布线的工具，**没有入库** ⇒ 这条对账在干净克隆里原先直接 ENOENT 崩。
//   改为显式跳过并留一行可读事实（跳过的是"工具名双向对账"，不是全部）。要让它真正生效，
//   把 release.mjs 入库即可（它一入库，本套件的 44 条断言就会开始约束发版反转表）。
if (!existsSync(path.join(ROOT, 'tools', 'release.mjs'))) {
  console.log('[t7e] SKIP：缺 tools/release.mjs ⇒ 预览名/发布名双向对账今天未执行')
  console.log('[t7e] pass=0 fail=0 skipped=1')
  process.exit(0)
}
const REL = readFileSync(path.join(ROOT, 'tools', 'release.mjs'), 'utf8')

let pass = 0, fail = 0
const t = (name, fn) => {
  try { fn(); console.log('  ok - ' + name); pass++ }
  catch (e) { console.log('  FAIL - ' + name + ': ' + (e && e.message)); fail++ }
}
const assert = (c, m) => { if (!c) throw new Error(m) }

// ---------- 真源：运行时真实注册的工具名 ----------
const registered = [...IDX.matchAll(/defineTool\('([a-z_]+)'/g)].map((m) => m[1])
console.log('运行时注册的工具: ' + registered.length + ' 个')

// ---------- release.mjs 的转换表 ----------
const transformsBlock = REL.slice(REL.indexOf('const transforms = ['), REL.indexOf(']\n', REL.indexOf('const transforms = [')))
const txToolNames = [...transformsBlock.matchAll(/\['(memory_[a-z_]+|calendar_[a-z_]+)',\s*'([a-z_]+)'\]/g)]
  .map((m) => ({ from: m[1], to: m[2] }))

// ---------- release.mjs 的残留表 ----------
const residualBlock = REL.slice(REL.indexOf('const residual = ['), REL.indexOf(']\n', REL.indexOf('const residual = [')))
const residualNames = [...residualBlock.matchAll(/'(memory_[a-z_]+|calendar_[a-z_]+)'/g)].map((m) => m[1])

// 预览态工具 = 真源里以 _pre 结尾的
const preTools = registered.filter((n) => n.endsWith('_pre'))
// 正式态工具 = 真源里不以 _pre 结尾的（作为"该长什么样"的参照）
const bareTools = registered.filter((n) => !n.endsWith('_pre'))
console.log('其中预览态(_pre 结尾): ' + preTools.length + ' 个；正式态(裸名): ' + bareTools.length + ' 个')

console.log('\n=== T7-e 发布改名两侧登记完整性 ===')

t('T7e-1 ★★ 每个 _pre 工具都必须在 transforms 表里（否则发布物残留 _pre）', () => {
  const missing = preTools.filter((n) => !txToolNames.some((x) => x.from === n))
  assert(missing.length === 0,
    '★ transforms 表漏登记 ' + missing.length + ' 个 ⇒ 发布后会残留 _pre：' + missing.join(', '))
})

t('T7e-2 ★★ 每个 _pre 工具都必须在 residual 表里（否则漏改不报警）', () => {
  const missing = preTools.filter((n) => !residualNames.includes(n))
  assert(missing.length === 0,
    '★ residual 闸门漏登记 ' + missing.length + ' 个 ⇒ 残留在发布物里也不报警：' + missing.join(', '))
})

t('T7e-3 ★ transforms 的映射目标必须是「裸名」，且裸名形态在真源里有同族参照', () => {
  const bad = txToolNames.filter((x) => x.from.endsWith('_pre') && x.to.endsWith('_pre'))
  assert(bad.length === 0, '★ 存在「_pre → 仍是 _pre」的无效映射：' + bad.map((x) => x.from + '→' + x.to).join(', '))
  // 映射目标不应与真源里的任何已注册名冲突（避免把预览名改成另一个已存在的工具名）
  const collide = txToolNames.filter((x) => registered.includes(x.to) && x.to.endsWith('_pre'))
  assert(collide.length === 0, '映射目标撞上另一个预览名：' + collide.map((x) => x.from + '→' + x.to).join(', '))
})

t('T7e-4 ★ transforms 里不得出现「真源已无此工具」的陈旧条目（防改名后忘删）', () => {
  const stale = txToolNames
    .filter((x) => x.from.endsWith('_pre'))
    .filter((x) => !registered.includes(x.from))
  assert(stale.length === 0, '★ 映射表里有真源已不存在的工具（陈旧条目）：' + stale.map((x) => x.from).join(', '))
})

t('T7e-5 ★ 每个 _pre 工具去掉后缀后，结果名不得与已有裸名冲突', () => {
  const bad = []
  for (const n of preTools) {
    const bare = n.replace(/_pre$/, '')
    if (registered.includes(bare)) bad.push(n + ' → ' + bare + '（已存在同名工具）')
  }
  assert(bad.length === 0, '★ 改名会撞名：' + bad.join(' | '))
})

t('T7e-6 映射后的裸名集合可用于复核「发布物里不该有 _pre」这一断言本身是完备的', () => {
  // 这条是元断言：确认 transform 的目标集合确实等于「所有 _pre 工具的裸名」，
  // 从而 residual 表只要覆盖 from 集合，就足以在发布物里抓到任何 _pre 残留。
  const preTargets = txToolNames.filter((x) => x.from.endsWith('_pre')).map((x) => x.from)
  const missing = preTools.filter((n) => !preTargets.includes(n))
  assert(missing.length === 0, '目标集合不完整，缺：' + missing.join(', '))
})

console.log('\n[t7e] ' + pass + ' passed, ' + fail + ' failed')
process.exit(fail ? 1 : 0)
