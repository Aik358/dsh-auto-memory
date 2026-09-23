/**
 * 用户拍板三项的守卫（2026-09-22）—— #110 feed 批量化 / #110 facts 保留上限 / #102 工作区上限。
 *
 * 用户口径（原话要点）：
 *   · 「这个 1 可以直接修」                        → feed 由「一行一次整份写盘」改为**批内合并落盘**
 *   · 「默认 1000…撤销的优先清掉，老的但重要的要再考虑」 → facts **有序淘汰**
 *   · 「30 的上限提高」                            → discoverWorkspaces 上限走配置（默认 200）且按活跃度排序
 *
 * 纪律：行为断言为主（真跑 io 适配器 / 真跑 fact store），源码接线断言为辅。
 */
import { readFileSync, readdirSync, mkdtempSync, rmSync, existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHubIoPre, createHubIoHealthPre } from '../../lib/hub-io.js'
import { createFactStorePre } from '../../lib/fact-store.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
const INDEX = readFileSync(path.join(ROOT, 'lib', 'index.js'), 'utf8')
const FACT = readFileSync(path.join(ROOT, 'lib', 'fact-store.js'), 'utf8')

let pass = 0, fail = 0
const ok = (cond, msg) => { if (cond) { pass++; console.log('  ✓ ' + msg) } else { fail++; console.log('  ✗ FAIL: ' + msg) } }

const tmp = mkdtempSync(path.join(os.tmpdir(), 'followup110-'))
const dir = path.join(tmp, 'hub')

try {
  // ─────────────────────────────────────────────────────────────
  console.log('== ① #110 feed 批量化：批内只登记，批末一次原子落盘 ==')
  {
    const health = createHubIoHealthPre()
    const io = createHubIoPre({ dir, health })
    const facts = io('facts.json')

    ok(typeof io.beginBatch === 'function' && typeof io.endBatch === 'function' && typeof io.batchPending === 'function',
      'io 适配器暴露批控制（beginBatch/endBatch/batchPending）')

    io.beginBatch()
    facts.save({ facts: [{ n: 1 }] })
    facts.save({ facts: [{ n: 1 }, { n: 2 }] })
    facts.save({ facts: [{ n: 1 }, { n: 2 }, { n: 3 }] })
    ok(io.batchPending() === 1, '同文件 3 次 save 在批内合并成 **1** 个待写（这就是消除写放大）')
    ok(!existsSync(path.join(dir, 'facts.json')), '批内**尚未落盘**（写盘被推迟到批末）')
    const r = io.endBatch()
    ok(r.written === 1 && r.ok === true, '批末一次写出 1 份快照')
    const back = facts.load()
    ok(back && back.facts.length === 3 && back.facts[2].n === 3, '落盘内容是**最后一份**（全量快照 ⇒ 合并语义无损）')
    ok(!readdirSync(dir).some((n) => n.endsWith('.tmp')), '批末落盘后不残留 .tmp')
    ok(health.saves === 3, 'health.saves 仍如实记 3 次 save 调用（诊断面不被合并掩盖）')
  }

  console.log('== ①b 批内 clear 必须取消该文件的待写（否则删掉的快照会被写回来） ==')
  {
    const io = createHubIoPre({ dir, health: createHubIoHealthPre() })
    const f = io('episodes.json')
    f.save({ episodes: [{ a: 1 }] })
    io.beginBatch()
    f.save({ episodes: [{ a: 1 }, { a: 2 }] })
    f.clear()
    const r = io.endBatch()
    ok(r.written === 0, 'clear 之后该文件不再有待写（written=0）')
    ok(f.load() === null, '文件确实处于「已删除」状态，没有被批末写回')
    ok(io.endBatch().ok === true, '多余的 endBatch 是安全空操作（不抛）')
  }

  console.log('== ② #110 facts 保留上限：超限才动手，撤销优先，重要项最后 ==')
  const mk = (maxFacts) => createFactStorePre({ config: { maxFacts }, io: { save() {}, load() { return [] }, clear() {} } })
  const cand = (i, extra = {}) => ({
    scope: 'User', subject: '主体编号' + i, predicate: '取值为', object: '值' + i,
    sourceKind: 'inference', sourceClass: 'semantic-candidate', confidence: 0.5,
    provenance: [], confirmedAt: 1000 + i, ttl: 0, ...extra,
  })
  {
    const s = mk(3)
    ok(s.retentionLimit() === 3, 'retentionLimit() 反映配置上限')
    for (let i = 1; i <= 5; i++) s.upsert(cand(i))
    ok(s.size === 3, '★超出上限后自动淘汰到刚好 3 条（此前只增不减）')
    const remain = s.query().map((f) => f.object).sort()
    ok(remain.join(',') === '值3,值4,值5', '★保留的是**更新的**（值3/4/5），删掉最旧的（值1/值2）')
    const lp = s.getLastPrune()
    ok(lp && lp.limit === 3 && lp.pruned >= 1, '淘汰**不静默**：getLastPrune() 记下条数与上限')
    ok(s.getStats().pruned === 2, '累计淘汰 2 条（每次落盘只删到刚好回到上限，不一次清空）')
  }
  {
    const s = mk(2)
    s.upsert(cand(1, { provenance: ['src-old'] }))
    s.upsert(cand(2))
    s.upsert(cand(3))
    s.revokeBySource('src-old')
    s.upsert(cand(4)) // 再挤一次，触发淘汰
    const objs = s.query().map((f) => f.object)
    ok(!objs.includes('值1'), '★已撤销的（值1）优先被清掉')
    ok(s.size === 2, '仍收敛到上限 2')
  }
  {
    const s = mk(2)
    s.upsert(cand(1, { sourceKind: 'explicit', sourceClass: 'user-memory', confidence: 0.95 })) // 重要
    s.upsert(cand(2))
    s.upsert(cand(3))
    s.upsert(cand(4))
    const objs = s.query().map((f) => f.object)
    ok(objs.includes('值1'), '★「比较老但比较重要」的（用户明说 + 高置信）**没有被先删**')
    ok(!objs.includes('值2') && !objs.includes('值3'), '先删的是不重要的旧推断项')
    const lp = s.getLastPrune()
    ok(lp && lp.protected === 0, 'protected=0：尚未轮到删重要项（上限够用）')
  }
  {
    const s = createFactStorePre({ io: { save() {}, load() { return [] }, clear() {} } })
    ok(s.retentionLimit() === 1000, '★未配置时默认上限 = 1000（用户拍板值）')
    const bad = createFactStorePre({ config: { maxFacts: 'oops' }, io: { save() {}, load() { return [] }, clear() {} } })
    ok(bad.retentionLimit() === 1000, '非法配置值回落默认 1000（不出现 NaN 上限 ⇒ 不误删）')
  }

  console.log('== ③ #102 工作区上限：不再硬编码 30，改配置 + 活跃度排序 ==')
  {
    // 去注释后再断言 —— 否则会命中**我自己写的**「旧实现：`if (out.size >= 30) return`」注释
    // （本仓踩过多次的「子串假通过/假失败」坑）。
    const INDEX_CODE = INDEX.split(/\r?\n/).map((l) => l.replace(/\/\/.*$/, '')).join('\n')
    ok(!/out\.size >= 30/.test(INDEX_CODE), '★硬编码 `out.size >= 30` 已从**可执行代码**中消失（回归即红）')
    ok(/workspaceDiscoverMax: 200/.test(INDEX), 'DEFAULT_CONFIG 有 workspaceDiscoverMax（默认 200）')
    const m = INDEX.match(/async discoverWorkspaces\(\) \{[\s\S]*?\n  \}/)
    ok(!!m, 'discoverWorkspaces 存在（锚点命中）')
    const body = m ? m[0] : ''
    ok(/Number\(this\.config && this\.config\.workspaceDiscoverMax\)/.test(body), '上限读配置（活读 this.config）')
    ok(/Number\.isFinite\(capRaw\) && capRaw >= 1/.test(body), '非法上限回落默认（不出现 NaN 截断 ⇒ 不误丢工作区）')
    ok(/\.sort\(\(a, b\) => b\[1\] - a\[1\]\)/.test(body) && /\.slice\(0, cap\)/.test(body),
      '★按最近会话 mtime 降序后排前 cap 个（真到上限时丢的是最久没用的，而不是碰巧排后面的）')
    ok(/const walkLimit = cap \* 5/.test(body), '仅保留 5×上限的遍历安全阀（防 sessions 目录异常膨胀）')
  }

  console.log('== ④ 接线：index.js 确实用了批控制 + 把上限传给了 store ==')
  {
    ok(/engine\._hubIoFactory = hubIo/.test(INDEX), 'io 工厂挂到 engine（跨块可取到批控制）')
    ok(/ioFactory\.beginBatch\(\)/.test(INDEX) && /ioFactory\.endBatch\(\)/.test(INDEX), 'feed 循环确实开关了批')
    ok(/\} finally \{[\s\S]{0,400}endBatch\(\)/.test(INDEX), '★endBatch 放在 finally（任何一行抛错都不把改动留在内存不落盘）')
    ok(/createFactStorePre\(\{ config: \{ maxFacts: Number\(engine\.config\.factRetentionMax\) \|\| 1000 \}/.test(INDEX),
      'index.js 把 factRetentionMax 传给 fact store')
    ok(/factRetentionMax: 1000/.test(INDEX), 'DEFAULT_CONFIG 有 factRetentionMax（默认 1000）')
    ok(/getLastPrune: \(\) =>/.test(FACT) && /retentionLimit: \(\) => maxFacts/.test(FACT), 'fact store 暴露淘汰痕迹与上限（可诊断）')
  }
} finally {
  try { rmSync(tmp, { recursive: true, force: true }) } catch (_) {}
}

console.log('\n== followup-110-102 结果 == PASS ' + pass + ' / FAIL ' + fail)
if (fail > 0) process.exitCode = 1
