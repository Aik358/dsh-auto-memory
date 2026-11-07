#!/usr/bin/env node
/**
 * smoke-test-rules-layer-cas —— **规约编辑按层（user/project）的 CAS 契约验收**（task-37 B-1）
 *
 * ## 为什么有这个套件
 *
 * B-1 要给 `applyRuleEditPre` 加 `layer: 'user'|'project'`。风险不在「能不能多读一个文件」，
 * 而在 **revision 是否真的绑定到被写的那一层** —— 如果换层后 revision 仍由用户层文件派生，
 * 两个层的 CAS 就是同一把锁 ⇒ 项目层的并发编辑**静默失效**（比不做更糟）。
 *
 * 这类失效**静态断言看不出来**（源码里 `memoryWriteLockKey(targetFile)` 写得再对，实参传错一样挂）：
 * 本仓已吃过「#510 注释写全了分析、签名与 handler 未同步改，grep 与 node --check 全绿、运行时 100% ReferenceError」的亏。
 * ⇒ 本套件**真 import 生产代码 + 真构造假 engine + 真调用**，断言返回值与磁盘副作用（CR-10）。
 *
 * ## 红 → 绿 纪律
 *
 * 本套件与 B-1 **同批立项**，写它的时候 B-1 还没实现。
 * ⇒ 在实现落地前它**必须是红的**（T1/T2/T3 失败）。实现落地后转绿才算证毕。
 * 「先绿后补断言」不是验收，只是把实现抄一遍。
 *
 * ## 三条判据（Lead 2026-11-07 裁定，逐字）
 *
 *   ① 对项目层 update 一次 ⇒ 读回 revision 必须变化（证明 revision 真的绑定到项目层文件）
 *   ② 用旧 revision 再 update ⇒ 必须被拒（证明 CAS 在项目层生效）
 *   ③ 变异：让 revision 恒等于用户层的值 ⇒ ①必红
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  ok   - ' + m) } else { fail++; console.log('  FAIL - ' + m) } }
const eq = (a, b, m) => ok(a === b, m + '（实测 ' + JSON.stringify(a) + ' vs 期望 ' + JSON.stringify(b) + '）')

const { applyRuleEditPre: apply } = await import('../../lib/index.js')
ok(typeof apply === 'function', 'A0 applyRuleEditPre 可被真 import 取出运行')

// ── 夹具：两层各一个文件（真磁盘、真读写）──────────────────────────────────
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rules-cas-'))
const userFile = path.join(tmp, 'USER-MEMORY.md')
const projFile = path.join(tmp, 'PROJECT-MEMORY.md')
const USER_BODY = '## 2026-11-07\n- 用户层规则甲：必须 A。\n- 用户层规则乙：不得 B。\n'
const PROJ_BODY = '## 2026-11-07\n- 项目层规则丙：一律 C。\n- 项目层规则丁：禁止 D。\n'
fs.writeFileSync(userFile, USER_BODY, 'utf8')
fs.writeFileSync(projFile, PROJ_BODY, 'utf8')

const fakeEngine = {
  // ★注意：夹具必须同时给 userFile 与 notesPath —— 缺 notesPath 时 B-1 的
  //   `layer==='project'` 分支会走 invalid-layer，于是 T1/T2 因「参数没接进去」而红，
  //   那会掩盖「CAS 没绑定」这个真问题。两者都给了，红就只可能是 CAS 的问题。
  resolvePaths: async () => ({ userFile, notesPath: projFile }),
  readTextSafe: async (p) => { try { return fs.readFileSync(p, 'utf8') } catch (_) { return '' } },
  writeFull: async (p, text) => { fs.writeFileSync(p, text, 'utf8'); return text },
  config: { rulesLayeringMode: 'self' },
}

// ── T0 前置：两层都能 list，且 revision **互不相同** ─────────────────────
//    这一条是 T1/T2 的底座：如果 revision 从一开始就相同，说明锁键没跟层走。
console.log('')
console.log('== T0 前置：layer 参数被真正接受，两层 revision 必须不同 ==')
{
  const u = await apply(fakeEngine, 'list', { layer: 'user' })
  const pj = await apply(fakeEngine, 'list', { layer: 'project' })
  ok(u && u.ok === true, 'T0-a layer=user 的 list 成功')
  ok(pj && pj.ok === true, 'T0-b layer=project 的 list 成功（实现未落地时这里会红）')
  if (pj && pj.ok) {
    eq(pj.items.length, 2, 'T0-c 项目层读到 2 条')
    ok(pj.path === projFile, 'T0-d path 按 layer 返回项目层路径（不是用户层）')
    // ★★这一条最初写错了（2026-11-07 实测）：两个文件**内容不同**时 digest 本就不同，
    //   revision 天然不等 ⇒ 即使锁键全用 userFile 也照样通过 ⇒ **判据没有区分力**。
    //   证据：我构造了「path 跟层、revision 锁键仍用 userFile」的半修变异体（lib/.b1-halfmut.mjs），
    //   在内容不同的夹具上 T0-e 通过（判据失效）；把两文件改成**逐字节相同**后，变异体上两层
    //   revision 完全相同（6f489fa1…），才暴露出来。
    //   ⇒ 本判据必须用**等内容双文件**，把变量隔离到「锁键路径」这一个上。
    const isoA = path.join(tmp, 'ISO-A.md'), isoB = path.join(tmp, 'ISO-B.md')
    const isoBody = '## 2026-11-07\n- 同一条内容。\n'
    fs.writeFileSync(isoA, isoBody, 'utf8')
    fs.writeFileSync(isoB, isoBody, 'utf8')
    const isoEngine = { resolvePaths: async () => ({ userFile: isoA, notesPath: isoB }), readTextSafe: fakeEngine.readTextSafe, writeFull: fakeEngine.writeFull, config: {} }
    const iu = await apply(isoEngine, 'list', { layer: 'user' })
    const ip = await apply(isoEngine, 'list', { layer: 'project' })
    ok(iu.revision !== ip.revision, 'T0-e ★两级 revision 必须不同（用**等内容双文件**隔离锁键变量；相等 ⇒ 锁键没跟层走）')
  }
  const bogus = await apply(fakeEngine, 'list', { layer: 'bogus' })
  ok(bogus && bogus.ok === false && /layer/.test(String(bogus.error)), 'T0-f layer 非法值被明确拒绝')
  const dflt = await apply(fakeEngine, 'list', {})
  const explicitUser = await apply(fakeEngine, 'list', { layer: 'user' })
  ok(dflt.revision === explicitUser.revision, 'T0-g ★缺省 layer 与显式 user 的 revision 逐字相同（旧行为不变）')
}

// ── T1（Lead 判据①）：项目层 update 后 revision 必须变化 ────────────────
console.log('')
console.log('== T1 项目层 update 一次 ⇒ 读回 revision 必须变化 ==')
{
  const before = await apply(fakeEngine, 'list', { layer: 'project' })
  const target = before.items?.[0]?.text
  ok(!!target, 'T1-a 取到项目层第 0 条原文')
  const upd = await apply(fakeEngine, 'update',
    { layer: 'project', index: 0, expect: target, text: target + '（已改）' },
    { requireExpect: true, requireRevision: true }
  )
  ok(upd && upd.ok === true, 'T1-b 项目层 update 成功')
  // ★反假绿（2026-11-07 实测踩中）：上一版直接比 `upd.revision !== before.revision`，
  //   而写失败时 upd.revision 是 undefined ⇒ `undefined !== "str"` 恒真 ⇒ **本行假绿**。
  //   判据必须先证明「写成功 + 两边都是非空字符串」，再比不等。
  ok(typeof upd.revision === 'string' && upd.revision.length > 0, 'T1-c0 upd.revision 是非空字符串（否则下面的比较无意义）')
  ok(upd.revision !== before.revision, 'T1-c ★★revision 在项目层写后必须变化（恒等 ⇒ revision 没绑定项目层文件）')
  ok(fs.readFileSync(projFile, 'utf8').includes('（已改）'), 'T1-d 磁盘上项目层文件真的被改了')
  ok(!fs.readFileSync(userFile, 'utf8').includes('（已改）'), 'T1-e ★用户层文件**未被误写**（换层没串味）')
}

// ── T2（Lead 判据②）：旧 revision 必须被拒 ──────────────────────────────
console.log('')
console.log('== T2 用旧 revision 再 update ⇒ 必须被拒 ==')
{
  const stale = await apply(fakeEngine, 'list', { layer: 'project' })
  const staleRev = stale.revision
  const txt = stale.items[0].text
  // 先正常改一次，使 staleRev 作废
  const first = await apply(fakeEngine, 'update',
    { layer: 'project', index: 0, expect: txt, text: txt + '（第二次）', revision: staleRev },
    { requireExpect: true, requireRevision: true }
  )
  ok(first && first.ok === true, 'T2-a 持当前 revision 的第一次写成功')
  ok(typeof first.revision === 'string' && first.revision.length > 0, 'T2-a2 第一次写成功返回了非空 revision')
  // 再用**已作废的** staleRev 写 ⇒ 必须拒
  const afterTextBeforeReject = fs.readFileSync(projFile, 'utf8')
  const after = await apply(fakeEngine, 'list', { layer: 'project' })
  const rejected = await apply(fakeEngine, 'update',
    { layer: 'project', index: 0, expect: after.items[0].text, text: after.items[0].text + '（应被拒）', revision: staleRev },
    { requireExpect: true, requireRevision: true }
  )
  ok(rejected && rejected.ok === false, 'T2-b ★★旧 revision 被拒（CAS 在项目层生效）')
  ok(fs.readFileSync(projFile, 'utf8') === afterTextBeforeReject, 'T2-b2 被拒时项目层文件逐字节未变（未被半写）')
  ok(/版本已变化/.test(String(rejected.error)), 'T2-c 拒绝原因是版本已变化（不是别的偶然错误）')
  ok(!fs.readFileSync(projFile, 'utf8').includes('（应被拒）'), 'T2-d 被拒时磁盘未被写入')
}

// ── T3（Lead 判据③）：变异 —— revision 恒用用户层 ⇒ T1 必红 ───────────────
//    做法：真改 lib/index.js？不行（共享工作区，且 >500 行禁整文件写）。
//    改为**在同一份源码上构造等价变异体**：把 view() 里的锁键实参换回 p.userFile，
//    落进 lib/ 同目录的临时副本（本仓既有纪律：变异副本必须落在被检模块所在目录内，
//    否则相对 import 会 ERR_MODULE_NOT_FOUND），跑完即删。
console.log('')
console.log('== T3 变异：revision 恒用用户层 ⇒ 两层 revision 相同 ⇒ T0-e/T1-c 必红 ==')
{
  const srcPath = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..', 'lib', 'index.js')
  let SRC = ''
  try { SRC = fs.readFileSync(srcPath, 'utf8') } catch (_) { SRC = '' }
  ok(SRC.length > 0, 'T3-a 能读到 lib/index.js 原文（变异装置前置）')
  if (SRC.length > 0) {
    // 变异点：把 view() 里的 memoryWriteLockKey(targetFile) 换回 memoryWriteLockKey(p.userFile)
    const MUT_A = "memoryWriteLockKey(targetFile)"
    const MUT_B = "memoryWriteLockKey(p.userFile)"
    const hitA = SRC.split(MUT_A).length - 1
    const hitB = SRC.split(MUT_B).length - 1
    // 实现落地前 MUT_A 必然是 0 命中 —— 这正是「红着」的一部分，如实报出而不是 skip
    ok(hitA === 1, 'T3-b ★实现里恰有 1 处 memoryWriteLockKey(targetFile)（未落地时为 0 ⇒ 本行红，符合红→绿纪律；实测 ' + hitA + '）')
    ok(hitB === 0, 'T3-c ★实现里不再有 memoryWriteLockKey(p.userFile)（残留 ⇒ 换层没换锁键；实测 ' + hitB + '）')
    if (hitA === 1) {
      // 真做变异：写到 lib/ 同目录副本，跑完删除
      const mutPath = path.join(path.dirname(srcPath), '.rules-cas-mut-' + process.pid + '.mjs')
      try {
        fs.writeFileSync(mutPath, SRC.split(MUT_A).join(MUT_B), 'utf8')
        const mut = await import('file:///' + mutPath.replace(/\\/g, '/'))
        const mu = await mut.applyRuleEditPre(fakeEngine, 'list', { layer: 'user' })
        const mp = await mut.applyRuleEditPre(fakeEngine, 'list', { layer: 'project' })
        ok(mu.revision === mp.revision, 'T3-d ★变异体上两层 revision **真的变成相同**（证明变异有效、T0-e 有区分力）')
      } finally {
        try { fs.unlinkSync(mutPath) } catch (_) {}
        try { fs.unlinkSync(mutPath + '.bak') } catch (_) {}
      }
    }
  }
}

// ── 收尾 ────────────────────────────────────────────────────────────────
try { fs.rmSync(tmp, { recursive: true, force: true }) } catch (_) {}
console.log('')
console.log('[rules-layer-cas] PASS ' + pass + ' / FAIL ' + fail)
process.exit(fail === 0 ? 0 : 1)
