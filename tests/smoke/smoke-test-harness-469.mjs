// #469 步骤 1 验收：tests/smoke/_harness.mjs 本身必须真 import → 真构造 → 真调用 → 断言返回值。
//
// 判据纪律（CR-10）：
//   ① 每条断言都真调用 harness 的公开接口并断言其返回值/副作用，不以「源码含某字符串」充当验收；
//   ② 带负路径：故意制造一条失败断言，断言 fail 计数真的 +1（若计数器是摆设，这里必红）；
//   ③ 带副作用断言：tmpdir 真建了目录、done() 真删了它、真执行了 onCleanup —— 不是只看返回值。
//
// 本文件的难点：被测对象**就是**测试脚手架本身，所以「断言」与「被断言」必须分清 ——
//   子 harness（S1..S4）承担被测职责，主 harness（T = createHarness('_harness-469')）承担断言职责。
//   子 harness 调 done() 会写 process.exitCode，验证完必须还原，否则本套件自己变红。
import { existsSync, statSync } from 'node:fs'
import path from 'node:path'
import { createHarness, canCreateDirLink } from './_harness.mjs'

const T = createHarness('_harness-469')

console.log('\n[1] 计数语义：pass / fail / skip 三通道互不串味（含负路径）')
{
  const S = createHarness('self-sub')
  S.ok(true, 'positive')          // 应 +pass
  S.ok(false, 'negative')         // 应 +fail  ← 负路径本体
  S.skip('skipped', 'demo')       // 应 +skip
  T.eq(S.pass, 1, 'ok(true) 使 pass +1')
  T.eq(S.fail, 1, 'ok(false) 使 fail +1（负路径：计数器不是摆设）')
  T.eq(S.skipped, 1, 'skip() 使 skipped +1 且**不计入 pass**（SKIP 绝不当通过）')
  T.eq(S.pass + S.fail + S.skipped, 3, '三通道之和等于断言总数（无丢失）')
}

console.log('\n[2] eq 是深比较：形状不同必须判红（负路径）')
{
  const S = createHarness('eq-sub')
  S.eq({ a: [1, 2] }, { a: [1, 2] }, 'deep-equal')
  S.eq({ a: 1 }, { a: 2 }, 'deep-differs')      // 负路径
  S.eq(1, '1', 'number-vs-string')              // 负路径
  T.eq(S.pass, 1, '深相等判绿')
  T.eq(S.fail, 2, '值不等 / 类型不等各判红一次')
}

console.log('\n[3] tmpdir 真建目录，done() 真删（副作用断言，非返回值断言）')
{
  const S = createHarness('tmp-sub')
  let cleaned = false
  S.onCleanup(() => { cleaned = true })
  const d = S.tmpdir('dam-469-')
  T.ok(existsSync(d) && statSync(d).isDirectory(), 'tmpdir 返回的是**真实存在的目录**')
  T.ok(path.isAbsolute(d), 'tmpdir 返回绝对路径')
  T.ok(!cleaned, 'done() 之前不清理（否则临时目录用不了）')
  S.ok(true, 'keep-harness-green')
  S.done()
  T.ok(cleaned, 'done() 执行了 onCleanup 登记的回调')
  T.ok(!existsSync(d), 'done() 真的把临时目录删掉了')
}

console.log('\n[4] isolatedHome 真改环境变量并能还原（含「原本不存在」的负路径）')
{
  const S = createHarness('home-sub')
  const hadDshHome = Object.prototype.hasOwnProperty.call(process.env, 'DSH_HOME')
  const before = process.env.DSH_HOME
  const { home, applyEnv, restoreEnv } = S.isolatedHome()
  T.ok(path.isAbsolute(home) && existsSync(home), 'isolatedHome 返回真实目录')
  T.ok(existsSync(path.join(home, 'memory')), 'isolatedHome 预建了 memory/ 子目录')
  applyEnv()
  T.eq(process.env.DSH_HOME, home, 'applyEnv 真改了 DSH_HOME')
  T.eq(process.env.HOME, home, 'applyEnv 真改了 HOME')
  T.eq(process.env.USERPROFILE, home, 'applyEnv 真改了 USERPROFILE')
  restoreEnv()
  if (hadDshHome) T.eq(process.env.DSH_HOME, before, 'restoreEnv 还原为**原值**')
  else T.ok(!Object.prototype.hasOwnProperty.call(process.env, 'DSH_HOME'), '原本不存在 ⇒ restoreEnv 删除而非留空串')
  S.ok(true, 'keep-harness-green')
  S.done()
}

console.log('\n[5] done() 的退出码语义与存量 550 个套件逐字同款')
{
  const green = createHarness('done-green')
  green.ok(true, 'x')
  green.done()
  T.eq(process.exitCode, 0, '全绿 ⇒ exitCode=0')
  const red = createHarness('done-red')
  red.ok(false, 'x')
  red.done()
  T.eq(process.exitCode, 1, '有红 ⇒ exitCode=1')
  process.exitCode = 0 // 还原，否则本套件自己被判失败
}

console.log('\n[7] 多实例只挂一个 exit 监听器（旧写法每实例各挂一个 ⇒ 累积）')
{
  const before = process.listenerCount('exit')
  for (let i = 0; i < 12; i++) createHarness('multi-' + i) // 旧写法此处会 +12，触发 maxListeners 告警
  T.eq(process.listenerCount('exit'), before, '建 12 个 harness 后 exit 监听器数不变（模块级单次注册）')
}

console.log('\n[6] 平台能力探测：返回布尔且二次调用命中缓存')
{
  const a = canCreateDirLink()
  const b = canCreateDirLink()
  T.eq(typeof a, 'boolean', 'canLink 返回布尔（false 时调用方必须走 skip）')
  T.eq(a, b, '二次调用同值（缓存生效，避免 550 个套件各建一次探测目录）')
}

T.done()
