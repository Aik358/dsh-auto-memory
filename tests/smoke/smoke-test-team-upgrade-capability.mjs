#!/usr/bin/env node
/**
 * smoke-test-team-upgrade-capability.mjs —— 批1（2026-11-05）纯函数层验收。
 *
 * ## 本批内容（零渲染改动，尚无调用点）
 *   · upgradeSurfaceOwnerPre      —— 团队卡片 vs 三页向导的**前台权**唯一裁决
 *   · upgradeTeamPublishGatePre   —— 团队发布基线前置门（范围不含当前区 ⇒ 拒绝）
 *   · upgradeSurfaceRequestOwnerPre / SubscribeOwnerPre / OwnerNowPre —— 互达总线
 *
 * ## 为什么单独一批验
 * 批2 接线时只需验「接线是否把正确判据接上」；判据本身的正确性在这里用 **vm 真执行**验透
 * （CR-10：源码含某字符串不算证据）。
 *
 * ## 跨 realm 纪律（批0 实测踩过）
 * 抽进 node:vm 真调用 ⇒ 函数体内**不得**用 `instanceof Array`（跨 realm 恒 false）。X-4 专守此点。
 *
 * ## 关键约束（Lead 明令）
 * teamSticky 必须**最高优先级**：#524 终态不得当场卸载，不能被 owner 判定推翻 ⇒ S2-4 + 变异 V1/V2。
 */
import fs from 'node:fs'
import vm from 'node:vm'
import path from 'node:path'
import { createHash } from 'node:crypto'

const ROOT = path.resolve(new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), '..', '..')
const SRC = fs.readFileSync(path.join(ROOT, 'lib', 'client.js'), 'utf8')
let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  ok   - ' + m) } else { fail++; console.log('  FAIL - ' + m) } }
const eq = (a, b, m) => { const g = String(a) === String(b); ok(g, m + (g ? '' : '（实测 ' + String(a) + ' ≠ 期望 ' + String(b) + '）')) }

console.log('lib/client.js ' + Buffer.byteLength(SRC, 'utf8') + 'B / sha256[:16] ' + createHash('sha256').update(SRC).digest('hex').slice(0, 16))

/** 抽函数体。★CRLF 源码切片必须先归一，否则拼进 vm 会形成裸 \r ⇒ SyntaxError（批0 实测）。 */
function extractFn (signature) {
  const start = SRC.indexOf(signature)
  if (start < 0) return null
  let i = SRC.indexOf('{', start), d = 0, end = -1
  for (; i < SRC.length; i++) { const c = SRC[i]; if (c === '{') d++; else if (c === '}') { d--; if (d === 0) { end = i + 1; break } } }
  if (end <= start) return null
  return SRC.slice(start, end).replace(/\r\n/g, '\n')
}

/** ★把 `function name(...)` 声明转成对象字面量的**方法简写**（去掉 function 前缀 + 逗号分隔）。
 *  直接塞 `function xxx(){}` 进对象字面量 / class 体都是语法错误（批1 实测两次）。 */
function asMethod (body) { return body.replace(/^function\s+/, '') }

const ownerBody = extractFn('function upgradeSurfaceOwnerPre(input) {')
const gateBody = extractFn('function upgradeTeamPublishGatePre(input) {')
ok(!!ownerBody, 'F-0a 能抽出 upgradeSurfaceOwnerPre')
ok(!!gateBody, 'F-0b 能抽出 upgradeTeamPublishGatePre')

// ★注意：这两个是 `function xxx() {}` **声明**，塞进 class 体会报
//   "Unexpected identifier"（class 只接受方法简写）。批0 的 index.js 方法本来就是方法简写，
//   所以用 class 是对的；这里的函数是声明 ⇒ 必须用对象字面量 + 逗号连接。
const ctx = vm.createContext({ console })
vm.runInContext('var _p = {\n' + asMethod(ownerBody) + ',\n' + asMethod(gateBody) + '\n};' +
  'globalThis.__owner = _p.upgradeSurfaceOwnerPre;' +
  'globalThis.__gate = _p.upgradeTeamPublishGatePre;', ctx)
const owner = ctx.__owner
const gate = ctx.__gate
ok(typeof owner === 'function' && typeof gate === 'function', 'F-0c 两个纯函数在 vm 里真加载成功（缺任一 ⇒ 后续断言无意义）')

console.log('')
console.log('== 1. 跨 realm 安全（批0 踩过的坑，提前守） ==')
{
  const outsideKeys = ['--A--', '--B--']
  eq(gate({ scope: 'subset', uploadTargetWs: '--A--', selectedKeys: outsideKeys }).allowed, true,
     'X-1 [跨 realm] 宿主侧数组作为 selectedKeys ⇒ subset 命中（若用 instanceof Array 会恒 false）')
  const r2 = gate({ scope: 'subset', uploadTargetWs: '--C--', selectedKeys: outsideKeys })
  eq(r2.allowed, false, 'X-2 [跨 realm] 宿主侧数组 + 不在其中 ⇒ 正确拒绝')
  eq(r2.reason, 'target-not-selected', 'X-3 [跨 realm] 拒因正确')
  ok(!/instanceof\s+Array/.test(ownerBody + gateBody), 'X-4 [守卫] 两个函数体内**不得**出现 instanceof Array（跨 realm 恒 false）')
}

console.log('')
console.log('== 2. upgradeSurfaceOwnerPre 判据表（真调用） ==')
{
  const T = (input) => owner(input)
  eq(T({ teamMode: 'team', legacy: true, request: 'team-card' }).owner, 'team-card', 'S1-1 显式请求 team-card ∈ 团队 ⇒ 卡片')
  eq(T({ teamMode: 'team', legacy: true, request: 'team-card' }).reason, 'explicit-team', 'S1-2 理由 explicit-team')
  eq(T({ teamMode: 'personal', legacy: true, request: 'team-card' }).owner, 'wizard', 'S1-3 [负路径] 显式请求卡片但非团队 ⇒ 落回向导')
  eq(T({ teamMode: 'team', legacy: true, request: 'wizard' }).owner, 'wizard', 'S1-4 显式请求 wizard ⇒ 向导')

  eq(T({ teamMode: 'team', legacy: true, phase: 'done', teamSticky: true }).owner, 'team-card',
     '★★S2-4 [硬约束] sticky + legacy + done ⇒ 团队卡片（#524 终态不得当场卸载）')
  eq(T({ teamMode: 'team', legacy: true, phase: 'done', teamSticky: true }).reason, 'team-sticky', 'S2-5 理由 team-sticky（可审计）')
  // ★批2 修订（2026-11-05）：优先级改为 running **先于** sticky。
  //   理由：running + sticky 同时为真时两组会双双可见（互斥套件穷举抓到 2 组重合）；
  //   running 期间用户要的是进度，卡片让位；#524 的 sticky 是终态之后才置位，与 running 天然互斥。
  eq(T({ teamMode: 'team', legacy: true, phase: 'running', teamSticky: true }).owner, 'wizard',
     'S2-6 [批2 修订] running 时 sticky 让位 ⇒ 进度统一在向导（避免两组同时可见）')
  eq(T({ teamMode: 'team', legacy: false, phase: 'running', teamSticky: true }).owner, 'wizard',
     'S2-6b [批2 修订] 同上，与 legacy 无关')
  // ★P6 修改：团队默认就是卡片 ⇒ 非 sticky 时也判卡片。S2-4 的「非恒真」改由
  //   **个人线**与**running** 两条来证明（见 S3-1 / S4-1），不再靠 legacy。
  eq(T({ teamMode: 'team', legacy: true, phase: 'done', teamSticky: false }).owner, 'team-card',
     'S2-7 [P6 修改] 非 sticky + legacy ⇒ 仍是**团队卡片**（团队优先；#524 的「非恒真」由 S3-1/S4-1 证明）')

  eq(T({ teamMode: 'personal', legacy: true }).owner, 'wizard', 'S3-1 个人 + legacy ⇒ 向导（现状不变）')
  eq(T({ teamMode: 'personal', legacy: true }).reason, 'personal', 'S3-2 理由 personal')
  eq(T({}).owner, 'wizard', 'S3-3 [负路径] 空对象 ⇒ 向导（fail-open，绝不锁死界面）')
  eq(T(null).owner, 'wizard', 'S3-4 [负路径] null ⇒ 不抛且向导')

  eq(T({ teamMode: 'team', legacy: true, phase: 'running' }).owner, 'wizard', 'S4-1 团队 + running ⇒ 向导（进度在 progress 页）')
  eq(T({ teamMode: 'team', legacy: true, phase: 'running' }).reason, 'team-running', 'S4-2 理由 team-running')
  // ★★P6（2026-11-05 用户裁定）**有意修改**：团队用户默认展示**团队版**，不再是向导。
  //   依据：「打开团队 Teamwork 功能的用户，应当优先展示团队版，两版之间可以相互切换」。
  //   向导改为「卡片上点 E1 才进」。
  eq(T({ teamMode: 'team', legacy: true, phase: 'idle' }).owner, 'team-card', 'S4-3 [P6 修改] 团队 + legacy ⇒ **团队卡片**（团队优先，用户裁定）')
  eq(T({ teamMode: 'team', legacy: true, phase: 'idle' }).reason, 'team-home-legacy', 'S4-4 理由 team-home-legacy（仍区分有旧格式，供文案用）')
  eq(T({ teamMode: 'team', legacy: false }).owner, 'team-card', 'S4-5 团队 + 无 legacy ⇒ 卡片（只剩发布/订阅）')
  eq(T({ teamMode: 'team', legacy: false }).reason, 'team-no-legacy', 'S4-6 理由 team-no-legacy')

  const combos = []
  for (const teamMode of ['team', 'personal']) {
    for (const legacy of [true, false]) {
      for (const phase of ['idle', 'running', 'done', 'failed']) {
        for (const teamSticky of [true, false]) { combos.push({ teamMode, legacy, phase, teamSticky }) }
      }
    }
  }
  const bad = combos.filter((c) => { const o = owner(c).owner; return o !== 'wizard' && o !== 'team-card' })
  eq(bad.length, 0, 'S5-1 穷举 ' + combos.length + ' 种组合 ⇒ owner 恒为 wizard|team-card 之一（永不空）')
  // ★P6 修改：团队默认 = 卡片。叠加缺陷的消除点改为「**任何**组合下两组不会同时渲染」，
  //   由 upgrade-surface-arbitration 的 X-1 穷举（32 组零重合）与 intent 套件 X-2（96 组零重合）双证。
  const overlap = combos.filter((c) => c.teamMode === 'team' && c.legacy === true && c.teamSticky !== true && owner(c).owner === 'undefined')
  eq(overlap.length, 0, '★★S5-2 [P6 修改] 团队 + legacy + 非 sticky ⇒ 判据**永不返回 undefined**（叠加缺陷消除点改由两个穷举套件证明）')
}

console.log('')
console.log('== 3. 变异：sticky 降级后 #524 必被推翻 ==')
{
  const stickyLine = "    if (o.teamSticky === true) return { owner: 'team-card', reason: 'team-sticky' }"
  const mut = ownerBody.replace(stickyLine, '')
  ok(mut !== ownerBody, 'V0 [变异] 能定位到 sticky 分支（否则变异本身无效）')
  if (mut !== ownerBody) {
    const mctx = vm.createContext({ console })
    vm.runInContext('var _m = {\n' + asMethod(mut) + '\n};globalThis.__o = _m.upgradeSurfaceOwnerPre;', mctx)
    // ★P6 修改：团队默认即卡片 ⇒ 去掉 sticky 时结果仍是 team-card，这条变异失去区分力。
    //   改为在**个人线**上做变异（个人线必须永远是 wizard，去掉 isTeam 判断会翻成卡片）。
    // ★实测：去掉 sticky 分支后，个人线**仍判 wizard** —— 这才是正确预期
    //   （变异只影响团队线；个人线由 ② 短路，不受 sticky 影响）。
    eq(mctx.__o({ teamMode: 'personal', legacy: true, phase: 'idle', teamSticky: false }).owner, 'wizard',
       'V1 [变异·P6] 去掉 sticky 分支后，个人线**仍判 wizard**（isTeam 短路未被变异波及 ⇒ 变异范围可控）')
    // 真正的「sticky 有区分力」证在团队线上：sticky=true 时卡片，且 reason 不同
    eq(mctx.__o({ teamMode: 'team', legacy: true, phase: 'done', teamSticky: true }).reason, 'team-home-legacy',
       'V2 [变异·P6] 团队线去掉 sticky 后，sticky=true 的 reason 不再是 team-sticky（sticky 分支确实被删）')
    eq(owner({ teamMode: 'team', legacy: true, phase: 'done', teamSticky: true }).owner, 'team-card', 'V2 [还原] 原实现仍判卡片 ⇒ 复绿')
  }
}

console.log('')
console.log('== 4. upgradeTeamPublishGatePre 判据表（真调用） ==')
{
  const G = (i) => gate(i)
  eq(G({ uploadTargetWs: '--A--' }).allowed, true, 'G1-1 未给 scope ⇒ 按 all 放行')
  eq(G({ uploadTargetWs: '--A--', scope: 'all' }).allowed, true, 'G1-2 scope=all ⇒ 放行')
  eq(G({ uploadTargetWs: '--A--', scope: 'current', currentWs: '--A--' }).allowed, true, 'G2-1 scope=current 且目标=当前 ⇒ 放行')
  eq(G({ uploadTargetWs: '--A--', scope: 'set', currentWs: '--A--' }).allowed, false, 'G4-1 [负路径] 未知 scope=set ⇒ 不猜、拒绝')
  eq(G({ uploadTargetWs: '--A--', scope: 'set', currentWs: '--A--' }).reason, 'bad-scope', 'G4-2 未知 scope 拒因 bad-scope')
  eq(G({ uploadTargetWs: '--B--', scope: 'current', currentWs: '--A--' }).allowed, false, 'G2-2 [负路径] current 但目标≠当前 ⇒ 拒绝')
  eq(G({ uploadTargetWs: '--B--', scope: 'current', currentWs: '--A--' }).reason, 'target-not-current', 'G2-3 拒因 target-not-current')
  eq(G({ uploadTargetWs: '--B--', scope: 'subset', selectedKeys: ['--A--', '--C--'] }).allowed, false, 'G3-1 [负路径] subset 不含目标 ⇒ 拒绝')
  eq(G({ uploadTargetWs: '--B--', scope: 'subset', selectedKeys: ['--A--', '--C--'] }).reason, 'target-not-selected', 'G3-2 拒因 target-not-selected')
  eq(G({ uploadTargetWs: '--B--', scope: 'subset', selectedKeys: ['--A--', '--B--'] }).allowed, true, 'G3-3 subset 含目标 ⇒ 放行')
  eq(G({ scope: 'all' }).allowed, false, 'G5-1 [负路径] 无上传目标 ⇒ 拒绝')
  eq(G({ scope: 'all' }).reason, 'no-target', 'G5-2 拒因 no-target')
  eq(G(null).allowed, false, 'G5-3 [负路径] null ⇒ 不抛且拒绝')

  const msgs = [
    G({ uploadTargetWs: '--B--', scope: 'current', currentWs: '--A--' }),
    G({ uploadTargetWs: '--B--', scope: 'subset', selectedKeys: ['--A--'] }),
    G({ scope: 'all' }),
    G({ uploadTargetWs: '--A--', scope: 'set' }),
  ]
  ok(msgs.every((m) => typeof m.message === 'string' && m.message.length >= 10),
     'G6-1 全部拒绝分支都带**非空且可读**的 message（不只给 reason 码）')
  ok(msgs.every((m) => !/undefined|\[object Object\]/.test(m.message)), 'G6-2 回执里不出现 undefined / [object Object]')
  ok(msgs[1].message.indexOf('旧内容') >= 0, 'G6-3 subset 拒因点明「会是整理前的旧内容」（让用户明白为什么，不是按钮坏了）')
  ok(msgs.every((m) => m.allowed === false && m.reason && m.reason.length > 0), 'G6-4 拒绝时 reason 恒非空（可审计）')
}

console.log('')
console.log('== 5. 前台权总线（P6 已整体删除，改为意图槽） ==')
{
  // ★★P6（2026-11-05）· Lead 裁定①：旧的「前台权总线」三个函数 + Listeners **整体删除**。
  //   理由：`__upgradeSurfaceOwner` 是模块级**只写不清**的持久变量，语义本就错 ——
  //   接进判据会让用户点一次「切到团队卡片」后**向导永远不再弹**。
  //   保留并标 deprecated 会诱导后人再去接它 ⇒ 直接删干净。
  //   ⇒ 原 B-1~B-7（总线 7 条）随之作废，改为以下「必须不存在 / 必须存在」的双向守卫。
  //
  //   ★注意：`__upgradeSurfaceTeamSticky`（事实镜像）**不能删** —— 与总线是两回事。
  ok(SRC.indexOf('function upgradeSurfaceRequestOwnerPre(') < 0, 'B-1 [删除守卫] 总线 RequestOwnerPre 已不存在')
  ok(SRC.indexOf('function upgradeSurfaceSubscribeOwnerPre(') < 0, 'B-2 [删除守卫] 总线 SubscribeOwnerPre 已不存在')
  ok(SRC.indexOf('function upgradeSurfaceOwnerNowPre(') < 0, 'B-3 [删除守卫] 总线 OwnerNowPre 已不存在')
  ok(SRC.indexOf('__upgradeSurfaceOwnerListeners') < 0, 'B-4 [删除守卫] Listeners 集合已不存在')
  // ★★P6-b（2026-11-05 · Lead 复核要求）：**单独一条**守 __upgradeSurfaceOwner。
  //   理由（Lead 原话）：它比三个函数更隐蔽，是最容易被人「顺手加回来」的 ——
  //   函数删了没人会加回来，但这个变量读起来像「就是个状态位」，很容易被重新声明。
  //   ★这条必须独立存在，不能和 Listeners 那条合并（合并后一处失效就没提示）。
  ok(!/var\s+__upgradeSurfaceOwner\s*=/.test(SRC),
     'B-5a [删除守卫·独立] ★只写不清的 __upgradeSurfaceOwner **变量声明**必须不存在（最易被顺手加回）')
  ok(!/__upgradeSurfaceOwner\b(?!Listeners)/.test(SRC.replace(/\/\/.*$/gm, '')),
     'B-5b [删除守卫·独立] __upgradeSurfaceOwner 在任何**非注释**位置零出现（注释里说明历史不算）')
  ok(!/__upgradeSurfaceOwnerListeners/.test(SRC), 'B-5c [删除守卫] Listeners 集合不存在（与 B-5a/b 分开守）')
  ok(SRC.indexOf('__upgradeSurfaceTeamSticky') >= 0 && SRC.indexOf('function upgradeSurfaceSetTeamStickyPre(') >= 0,
     'B-6 [保留守卫] ★__upgradeSurfaceTeamSticky（事实镜像）**必须仍在** —— 与总线无关，不可误删')
  // 意图槽三件套必须在场（这是替代方案）
  ok(SRC.indexOf('function upgradeSurfaceSetIntentPre(') >= 0, 'B-7 意图槽 SetIntent 在场')
  ok(SRC.indexOf('function upgradeSurfaceTakeIntentPre(') >= 0, 'B-8 意图槽 TakeIntent 在场（take 语义）')
}

console.log('== 6. 接线守卫（批1 是「零调用点」，批2 起改为「恰好两个、且同源」） ==')
{
  // ★批2（2026-11-05）改判据：批1 守「零调用点」，接线后必须反过来守
  //   「**恰好两处**调用，且都走同一判据」——否则「同一语义两处判据必漂移」。
  const callSites = (SRC.match(/upgradeSurfaceOwnerPre\(\{/g) || []).length
  eq(callSites, 2, 'R-1 [接线] upgradeSurfaceOwnerPre 恰好 2 处调用点（团队卡片 + 向导自动触发）')
  ok(SRC.indexOf('var surfaceVerdict = upgradeSurfaceOwnerPre({') >= 0, 'R-2a 团队卡片那处存在')
  ok(SRC.indexOf('var ownerV = upgradeSurfaceOwnerPre({') >= 0, 'R-2b 向导自动触发那处存在')
  ok(/teamSticky: sticky === true/.test(SRC), 'R-2c ★团队卡片把**真 sticky** 传进判据（漏传 ⇒ #524 被推翻）')
  ok(/var show = wantShow && surfaceVerdict\.owner === 'team-card'/.test(SRC),
     'R-2d 团队卡片可见性 = 旧判据 AND owner 判给卡片（旧判据未丢，只是被收窄）')
  ok(/if \(ownerV\.owner !== 'wizard'\) return/.test(SRC), 'R-2e 向导只在 owner 判给 wizard 时才继续')
  // ★批3（2026-11-05）改判据：批1/批2 守「零调用点」，接线后必须反过来守「恰好一处、且在真上传路径里」。
  const gateCalls = (SRC.match(/upgradeTeamPublishGatePre\(\{/g) || []).length
  eq(gateCalls, 1, 'R-3 [接线] 发布门**恰好 1 处**调用点（不是 0，也不重复）')
  ok(/var publishGate = upgradeTeamPublishGatePre\(\{/.test(SRC), 'R-3b 调用点在 runUploadAfterUpgrade 的上传路径里')
}

console.log('')
console.log('[team-upgrade-capability] PASS ' + pass + ' / FAIL ' + fail)
process.exit(fail ? 1 : 0)
