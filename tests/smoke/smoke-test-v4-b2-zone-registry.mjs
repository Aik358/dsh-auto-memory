#!/usr/bin/env node
/**
 * smoke-test-v4-b2-zone-registry.mjs —— 注入段 kind 与三区登记表的**结构一致性**守卫。
 *
 * ★为什么需要这个套件（v4-B2，Lead 2026-10-25 实测定位）：
 *   `lib/injection-zones.js` 的 `ZONE_BY_KIND_PRE_V1` 是「kind → 区」的登记表，
 *   而该文件自己的注释写着：
 *     「未登记 ⇒ zoneOfKindPre 会 fail-safe 落到 'memory'；漏登记会少一层保护」。
 *   实测：`user-portrait`（H5 用户画像段）**未登记**，靠默认值兜到 memory。
 *   当前行为没错，但那是「靠默认值」——一旦有人改 fail-safe 默认，它就会
 *   **静默变成不可裁剪**，而且没有任何断言会红。
 *
 * ★本套件的核心判据（结构性，不是逐个枚举）：
 *   「源码里所有注入段 kind」与「登记表键集合」的差集**必须为空**。
 *   ⇒ 以后任何人新增注入段忘了登记，**当场红**，而不是等某次裁剪把它悄悄丢掉。
 *
 * ★★关键实现细节：注入段有两套产生方式，必须**都**扫：
 *   ① `pushPart('bucket', 'kind', ...)` —— 主线渲染（renderMemoryDynamic）
 *   ② `part('bucket', 'kind', ...)`     —— 旧快照路径（L9231 定义的局部函数）
 *   只扫 pushPart 会把 project-notes / recent-logs / reflection / user-memory
 *   这 4 个**合法**段误判成「多登记」（实测踩过）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const IX = fs.readFileSync(path.join(ROOT, 'lib', 'index.js'), 'utf8')
const ZS = fs.readFileSync(path.join(ROOT, 'lib', 'injection-zones.js'), 'utf8')
const Z = await import(pathToFileURL(path.join(ROOT, 'lib', 'injection-zones.js')).href)

let pass = 0, fail = 0
const ok = (c, n, d) => { if (c) { pass++; console.log('  PASS ' + n + (d ? '  =>  ' + d : '')) } else { fail++; console.log('  FAIL ' + n + (d ? '  =>  ' + d : '')) } }

// ── 工具：从源码里抽 kind ──
function kindsOf(re) {
  const out = new Set()
  let m
  while ((m = re.exec(IX))) out.add(m[2])
  return out
}
// ★★2026-10-27 修（判据过期 · 抽取正则漏了双引号写法，**不是**僵尸键）：
//   实测：`pushPart("rules", "rules-section", _rulesOut)` 在 L10176 用的是**双引号**，
//   而原正则只匹配单引号 ⇒ rules-section 被误判为「登记表里没有对应注入段的僵尸键」。
//   ⇒ 正则改为同时接受单/双引号（`['"]`），这不是放宽判据 ——
//   判据本意是「登记表不得有僵尸键」，而 rules-section **确实是真实注入段**。
const pushKinds = kindsOf(/pushPart\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]/g)
const partKinds = kindsOf(/[^a-zA-Z]part\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]/g)
const allKinds = new Set([...pushKinds, ...partKinds])

// ── 工具：从登记表源码里抽键（用真 import 的值交叉校验，不用猜正则）──
const registered = new Set(Object.keys(Z.ZONE_BY_KIND_PRE_V1))

console.log('[B2-1] 抽取基数（三条路径都非空才可信）')
{
  ok(pushKinds.size >= 15, 'pushPart kinds 抽到 >=15 个', '实测 ' + pushKinds.size)
  ok(partKinds.size === 4, 'part kinds 抽到恰好 4 个（旧快照路径）', '实测 ' + partKinds.size + ': ' + [...partKinds].sort().join(','))
  ok(registered.size >= 20, '登记表抽到 >=20 键', '实测 ' + registered.size)
  ok(allKinds.size >= 20, '合并后唯一 kind >=20', '实测 ' + allKinds.size)
}

console.log('[B2-2] ★★核心：差集必须为空（新增段忘登记 ⇒ 当场红）')
{
  const missing = [...allKinds].filter((k) => !registered.has(k)).sort()
  const extra = [...registered].filter((k) => !allKinds.has(k)).sort()
  ok(missing.length === 0, '★★所有注入段 kind 都已登记进 ZONE_BY_KIND_PRE_V1', missing.length ? ('未登记: ' + missing.join(', ')) : ('共 ' + allKinds.size + ' 段全部登记'))
  ok(extra.length === 0, '负：登记表里没有「无对应注入段」的僵尸键（防登记表腐烂）', extra.length ? ('多登记: ' + extra.join(', ')) : '（空）')
}

console.log('[B2-3] ★B2 本体：user-portrait 必须显式登记为 memory')
{
  ok(Object.prototype.hasOwnProperty.call(Z.ZONE_BY_KIND_PRE_V1, 'user-portrait'), '★★user-portrait 在登记表里**显式存在**（不是靠 fail-safe 兜底）')
  ok(Z.ZONE_BY_KIND_PRE_V1['user-portrait'] === 'memory', '★user-portrait 登记为 memory（与 event-cards 同口径）', String(Z.ZONE_BY_KIND_PRE_V1['user-portrait']))
  // 对照：event-cards 一直是显式登记的（证明两者现在同源同口径）
  ok(Z.ZONE_BY_KIND_PRE_V1['event-cards'] === 'memory', '对照：event-cards 也是 memory（两条同源段口径一致）')
  // 真调 zoneOfKindPre，证明它真的返回 memory（不是只看表）
  ok(Z.zoneOfKindPre('user-portrait') === 'memory', '★★真调 zoneOfKindPre(user-portrait) === memory', Z.zoneOfKindPre('user-portrait'))
}

console.log('[B2-4] ★负路径：未登记 kind 确实靠 fail-safe 落到 memory（这正是不该依赖它的原因）')
{
  const UNREG = '__never_registered_kind_' + Date.now()
  ok(Z.zoneOfKindPre(UNREG) === 'memory', '★未登记 kind ⇒ fail-safe 返回 memory（证明「漏登记不会报错、只会静默降级」）', Z.zoneOfKindPre(UNREG))
  ok(!Object.prototype.hasOwnProperty.call(Z.ZONE_BY_KIND_PRE_V1, UNREG), '该 kind 确实不在登记表里（负路径成立）')
  // ★这条是 B2 的核心动机：如果 user-portrait 不显式登记，它的行为和这个随机 kind 完全一样 ——
  //   没有任何机制能区分「故意用 memory 默认值」与「忘了登记」。
}

console.log('[B2-5] 三区归属自洽（每个登记值都在 ZONES_PRE_V1 里）')
{
  const zones = new Set(Z.ZONES_PRE_V1)
  const bad = Object.entries(Z.ZONE_BY_KIND_PRE_V1).filter(([, v]) => !zones.has(v))
  ok(bad.length === 0, '★登记表所有值 ∈ ZONES_PRE_V1（无拼写错误导致 zoneOfKindPre 静默回落）', bad.length ? JSON.stringify(bad) : '（全部合法）')
  ok(Z.ZONES_PRE_V1.length === 3, '三区定义仍是 3 个', JSON.stringify(Z.ZONES_PRE_V1))
}

console.log('[B2-6] 区 III 独立配额仍在（B2 不动它，防止误伤）')
{
  ok(Z.CHANNEL_ZONE_MAX_CHARS === 300, '★区 III 硬上限仍 = 300', String(Z.CHANNEL_ZONE_MAX_CHARS))
}

console.log('')
console.log('[v4-b2-zone-registry] ' + pass + ' PASS / ' + fail + ' FAIL')
process.exit(fail ? 1 : 0)