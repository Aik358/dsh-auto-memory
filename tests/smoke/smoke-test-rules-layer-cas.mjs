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
import crypto from 'node:crypto'

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
    // ★夹具自证（Lead 2026-11-07 要求）：『等内容』必须是**字节级完全相同**，
    //   否则差一个换行就退化成『测输入是否不同』—— 那正是这条判据最初的失效原因。
    //   用 sha256 断言，不靠肉眼；同时断言两者确实是**两个不同路径**。
    const shaOf = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')
    ok(shaOf(isoA) === shaOf(isoB), 'T0-e0 夹具自证：ISO-A 与 ISO-B **字节完全相同**（sha256 相等，非肉眼近似）')
    ok(isoA !== isoB && path.basename(isoA) !== path.basename(isoB), 'T0-e1 夹具自证：两者确实是两个**不同路径**的文件')
    ok(isoA !== userFile && isoA !== projFile, 'T0-e2 夹具自证：隔离夹具与 T1/T2 用的夹具是不同文件（互不污染）')
    const isoEngine = { resolvePaths: async () => ({ userFile: isoA, notesPath: isoB }), readTextSafe: fakeEngine.readTextSafe, writeFull: fakeEngine.writeFull, config: {} }
    const iu = await apply(isoEngine, 'list', { layer: 'user' })
    const ip = await apply(isoEngine, 'list', { layer: 'project' })
    ok(typeof iu.revision === 'string' && iu.revision.length > 0 && typeof ip.revision === 'string' && ip.revision.length > 0, 'T0-e3 两侧 revision 都是非空字符串（否则下面的比较无意义）')
    ok(iu.revision !== ip.revision, 'T0-e ★★【功能验收】两级 revision 必须不同（等内容双文件隔离锁键变量；相等 ⇒ 锁键没跟层走）')
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
  // ★修正（2026-11-07）：本行原先漏传 revision，而 requireRevision:true 要求
  //   `payload.revision !== 当前revision` ⇒ undefined !== "str" **恒真** ⇒ 必然被拒。
  //   这不是实现的问题，是**断言自身写漏了参数**（T1-b 红、T1-c0 红都是这个原因）。
  //   ⇒ 必须把 list 拿到的 revision 一起提交，才是「持正确票据写」的正常路径。
  const upd = await apply(fakeEngine, 'update',
    { layer: 'project', index: 0, expect: target, text: target + '（已改）', revision: before.revision },
    { requireExpect: true, requireRevision: true }
  )
  ok(upd && upd.ok === true, 'T1-b 项目层 update 成功')
  // ★反假绿（2026-11-07 实测踩中）：上一版直接比 `upd.revision !== before.revision`，
  //   而写失败时 upd.revision 是 undefined ⇒ `undefined !== "str"` 恒真 ⇒ **本行假绿**。
  //   判据必须先证明「写成功 + 两边都是非空字符串」，再比不等。
  ok(typeof upd.revision === 'string' && upd.revision.length > 0, 'T1-c0 upd.revision 是非空字符串（否则下面的比较无意义）')
  // ★★注意：T1-c 与 T1-c0 **必须合成一条复合判据**。拆成两条时，T1-c0 红、
  //   T1-c 单看 `undefined !== "str"` 仍是绿 ⇒ 同为假绿，只是挪了个位置。
  //   （这正是「守卫依赖链」的典型坑：前置守卫红了，后置断言必须一并失效，不能各自独立报绿。）
  ok(typeof upd.revision === 'string' && upd.revision.length > 0 && upd.revision !== before.revision,
    'T1-c ★★【功能验收】revision 在项目层写后必须变化（要求：非空字符串 且 不等于写前值；恒等 ⇒ revision 没绑定项目层文件）')
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

// ── T2B（Lead 2026-11-07 要求③）：**跨层 CAS 隔离** ────────────────────────
//    Lead 原话：「对用户层 update 一次 ⇒ 记 revision_A；对项目层 update 一次 ⇒ 记 revision_B；
//                用 revision_B 去改用户层 ⇒ 必须被拒（证明 CAS 真的按层隔离）。」
//    为什么这条比 T3-b/T3-c 好：它**不读源码**，直指用户可感的后果 ——
//    若两层的 revision 落在同一个命名空间，拿项目层票据去改用户层就会**改成功**，
//    那是静默数据损坏，不是「编辑被拒」。
//
//    ★★但这个夹具**必须用等内容双文件**，否则本判据和 T0-e 是同一个陷阱（2026-11-07 实测）：
//      · 夹具内容不同时，revA ≠ revB 天然成立；半修变异体（锁键恒用 userFile）上，
//        项目层票据算出来的是**用户层的摘要**，而用户层文件内容恰好也没变 ⇒ 票据**匹配** ⇒
//        跨层写入被**放行**。此时「必须被拒」这一断言在变异体上 **FAIL（抓到）**。
//      · 等等 —— 上面的推理要实测，不能推。实测结果（见本区块末尾注释）是：
//        内容不同夹具上跨层**被拒**（抓不到），内容相同夹具上跨层**被放行**（抓到）。
//      ⇒ 本条判据同样必须用**等内容双文件**，理由与 T0-e 完全一致。
console.log('')
console.log('== T2B 跨层 CAS 隔离：项目层的 revision 不得能改用户层 ==')
{
  // ★等内容双文件：把「两份文件内容是否相同」这个变量钉死，只留「锁键用哪个路径」
  const xUser = path.join(tmp, 'X-USER.md'), xProj = path.join(tmp, 'X-PROJ.md')
  const xBody = '## 2026-11-07\n- 同一条内容。\n'
  fs.writeFileSync(xUser, xBody, 'utf8')
  fs.writeFileSync(xProj, xBody, 'utf8')
  const shaX = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')
  ok(shaX(xUser) === shaX(xProj), 'T2B-0 夹具自证：X-USER 与 X-PROJ **字节完全相同**（sha256 相等，非肉眼近似）')
  ok(xUser !== xProj, 'T2B-0b 夹具自证：两者确实是两个**不同路径**的文件')
  const xEngine = { resolvePaths: async () => ({ userFile: xUser, notesPath: xProj }), readTextSafe: fakeEngine.readTextSafe, writeFull: fakeEngine.writeFull, config: {} }

  const listU = await apply(xEngine, 'list', { layer: 'user' })
  const revA = listU.revision
  ok(typeof revA === 'string' && revA.length > 0, 'T2B-a 拿到用户层 revision_A')

  const listP = await apply(xEngine, 'list', { layer: 'project' })
  const revB = listP.revision
  ok(typeof revB === 'string' && revB.length > 0, 'T2B-b 拿到项目层 revision_B')
  ok(revA !== revB, 'T2B-c revision_A ≠ revision_B（两层票据不同；等内容夹具下相等 ⇒ 锁键没跟层走）')

  // ★核心：拿项目层的票据去改用户层 ⇒ 必须被拒
  const xUserBefore = fs.readFileSync(xUser, 'utf8')
  const cross = await apply(xEngine, 'update',
    { layer: 'user', index: 0, expect: '同一条内容。', text: '被跨层票据改掉了。', revision: revB },
    { requireExpect: true, requireRevision: true }
  )
  ok(cross && cross.ok === false, 'T2B-d ★★【功能验收】用项目层 revision_B 改用户层 **必须被拒**（落到同一命名空间就会静默改成功）')
  ok(/版本已变化/.test(String(cross.error)), 'T2B-e 拒绝原因是版本已变化（不是别的偶然错误）')
  ok(fs.readFileSync(xUser, 'utf8') === xUserBefore, 'T2B-f 用户层文件**逐字节未被改动**（不是「报了错但写了半截」）')

  // 反向对照：用正确的 revision_A 必须能改成功 —— 否则「一律拒绝」也能让 T2B-d 通过
  const right = await apply(xEngine, 'update',
    { layer: 'user', index: 0, expect: '同一条内容。', text: '用正确票据改。', revision: revA },
    { requireExpect: true, requireRevision: true }
  )
  ok(right && right.ok === true, 'T2B-g ★对照：持正确 revision_A 改用户层**成功**（区分「按层隔离」与「一律拒绝」）')
  ok(fs.readFileSync(xUser, 'utf8').includes('用正确票据改'), 'T2B-h 对照路径确实写盘了')
  ok(!fs.readFileSync(xProj, 'utf8').includes('用正确票据改'), 'T2B-i ★对照未串味：项目层文件没被这次用户层写动到')
}
//   实测记录（2026-11-07，半修变异体 lib/.b1-halfmut.mjs 上）：
//     内容不同夹具 ⇒ 跨层被拒 ⇒ T2B-d PASS（**抓不到，判据失效**）
//     内容相同夹具 ⇒ 跨层被放行 ⇒ T2B-d FAIL（**抓到，判据有效**）
//   ⇒ 与 T0-e 同一根因：派生标识的相等性只有在「其它输入全等」时才有区分力。
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
    // ★★降级标注（Lead 2026-11-07 裁定）：下面两条是**纯源码字符串计数断言**，
    //   按本仓规约「凡断言对象是源码里是否存在某字符串/计数，即恒真守卫，**不构成功能验收**」。
    //   保留理由：它们守的是「换层没换锁键」这个**具体半修形态**，作为**辅助守卫**有价值
    //   （我正是靠它构造并验证了半修变异体）。
    //   ★**功能证据不在这里**，而在 T0-e（等内容双文件隔离锁键）与 T2B-d（跨层票据必须被拒）——
    //   这两条都不读源码。已实测：把 T3 整段删掉，T0-e 仍能在半修变异体上 FAIL（独立成立）。
    ok(hitA === 1, '[守卫·非功能验收] 实现里恰有 1 处 memoryWriteLockKey(targetFile)（防「换层没换锁键」半修形态；**功能证据见 T0-e / T2B-d**；实测 ' + hitA + '）')
    ok(hitB === 0, '[守卫·非功能验收] 实现里不再有 memoryWriteLockKey(p.userFile)（残留 ⇒ 换层没换锁键；**功能证据见 T0-e / T2B-d**；实测 ' + hitB + '）')
    if (hitA === 1) {
      // 真做变异：写到 lib/ 同目录副本，跑完删除
      const mutPath = path.join(path.dirname(srcPath), '.rules-cas-mut-' + process.pid + '.mjs')
      try {
        fs.writeFileSync(mutPath, SRC.split(MUT_A).join(MUT_B), 'utf8')
        const mut = await import('file:///' + mutPath.replace(/\\/g, '/'))
        // ★T3-d 必须用**自己的等内容夹具**（2026-11-07 实测踩中）：
        //   原先复用 fakeEngine，而它指向的 projFile 已被 T1/T2 写改过、userFile 没有 ⇒
        //   两边内容不同 ⇒ digest 不同 ⇒ 即使变异体把锁键恒取 userFile，两层 revision 仍不等 ⇒
        //   T3-d 必红而**与变异有效性无关**（这是「夹具没隔离变量」的第 4 次同型坑）。
        const mutA = path.join(tmp, 'MUT-A.md'), mutB = path.join(tmp, 'MUT-B.md')
        const mutBody = '## 2026-11-07\n- 同一条内容。\n'
        fs.writeFileSync(mutA, mutBody, 'utf8')
        fs.writeFileSync(mutB, mutBody, 'utf8')
        const mutEngine = { resolvePaths: async () => ({ userFile: mutA, notesPath: mutB }), readTextSafe: fakeEngine.readTextSafe, writeFull: fakeEngine.writeFull, config: {} }
        ok(crypto.createHash('sha256').update(fs.readFileSync(mutA)).digest('hex') === crypto.createHash('sha256').update(fs.readFileSync(mutB)).digest('hex'), 'T3-d0 变异夹具自证：两份内容字节完全相同')
        const mu = await mut.applyRuleEditPre(mutEngine, 'list', { layer: 'user' })
        const mp = await mut.applyRuleEditPre(mutEngine, 'list', { layer: 'project' })
        ok(mu.revision === mp.revision, 'T3-d ★变异体上（等内容夹具）两层 revision **真的变成相同**（证明变异有效、T0-e 有区分力）')
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
