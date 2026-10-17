/**
 * smoke-test-a08-model-window-affinity.mjs —— issue #428 功能验收(零 IO 纯函数)。
 *
 * 缺陷(修复前):findSessionModelPre 三个字段**各自**倒序取首个非空 ⇒ 跨事件拼装。
 * 实测:旧 request/context(contextWindow=1000000) + 后接新 request/header(small/maxTokens=8192,
 * 不带 contextWindow)⇒ 返回 {model:'small', contextWindow:1000000, maxTokens:8192} ——
 * 新身份 + **旧模型窗口**被焊在一起。后果:窗口被高估 ⇒ 水位系统性低估 ⇒ 该接续时不接续。
 *
 * 本套件纪律(CR-10):真 import → 真调用 → 断言返回值;每条正路径配负路径;
 * 既保留「同模型跨事件补窗口」的既有语义(防过度收紧),又锁死「跨模型绝不借」。
 */
import { findSessionModelPre } from '../../lib/water-window.js'

let pass = 0
let fail = 0
const ok = (cond, name, extra) => {
  if (cond) { pass++; console.log('  ok - ' + name + (extra === undefined ? '' : ' (' + extra + ')')) }
  else { fail++; console.error('  FAIL - ' + name + (extra === undefined ? '' : ' 实得 ' + JSON.stringify(extra))) }
}
const eq = (a, b, name) => ok(JSON.stringify(a) === JSON.stringify(b), name, JSON.stringify(a))

const ctx = (provider, model, cw, seq) => ({ seq, type: 'request/context', data: { provider, model, contextWindow: cw } })
const hdr = (provider, model, maxTokens, seq) => ({ seq, type: 'request/header', data: { header: { config: { provider, model, maxTokens } } } })

console.log('[A08-1] 正路径:#428 实测形态 —— 旧大窗口 + 后接新小模型头')
{
  const events = [
    ctx('big-router', 'large-model', 1000000, 13),
    hdr('small-router', 'small', 8192, 1260),
  ]
  const got = findSessionModelPre(events)
  // ① 身份必须是最新模型的
  ok(got.model === 'small', '★正路径①:身份取最新模型的 model', got.model)
  ok(got.provider === 'small-router', '★正路径①:provider 同源', got.provider)
  // ② ★核心:窗口**不得**沿用旧模型的 1000000
  ok(got.contextWindow === 0, '★正路径②:新模型没声明窗口 ⇒ contextWindow=0(绝不借旧模型值)', got.contextWindow)
  // ③ 新模型自己声明的预留额度照常带出
  ok(got.maxTokens === 8192, '★正路径③:新模型自己的 maxTokens 照常带出', got.maxTokens)
  // ④ 旧模型的预留额度也不得被借(旧事件只有窗口、没有 maxTokens ⇒ 恒 0;此处再补一条带 maxTokens 的旧事件)
  const withOldReserve = [
    hdr('big-router', 'large-model', 384000, 11),
    ctx('big-router', 'large-model', 1000000, 12),
    hdr('small-router', 'small', 8192, 1260),
  ]
  const got2 = findSessionModelPre(withOldReserve)
  ok(got2.maxTokens === 8192, '★正路径④:预留额度也不跨模型借(旧 384000 不生效)', got2.maxTokens)
  ok(got2.contextWindow === 0, '★正路径④:窗口恒 0(旧 1000000 不生效)', got2.contextWindow)
}

console.log('[A08-2] 负路径①:request/context 自带 provider/model 与后续 header 不同')
{
  // request/context **自带** provider/model(本机实测形态之一),与后续 header 不同模型 ⇒ 仍不得保留旧窗口。
  const events = [
    ctx('old-p', 'old-m', 1000000, 13),
    hdr('new-p', 'new-m', 4096, 20),
  ]
  const got = findSessionModelPre(events)
  ok(got.model === 'new-m' && got.provider === 'new-p', '★负路径①:身份归属最新模型的 context 自带身份', JSON.stringify(got))
  ok(got.contextWindow === 0, '★负路径①:不同模型的窗口一律不继承', got.contextWindow)
  // 反向:新模型是**大**窗口、旧模型是小窗口 —— 错误嫁接会让水位虚高(误弹接续),同样必须防
  const reverse = [
    ctx('p', 'small-model', 131072, 13),
    hdr('p', 'big-model', 8192, 20),
  ]
  ok(findSessionModelPre(reverse).contextWindow === 0, '★负路径①:反向嫁接(小窗口→大模型)同样必须阻断', findSessionModelPre(reverse).contextWindow)
}

console.log('[A08-3] 负路径②:同一事件内 config 与 contextWindow 同源 ⇒ 仍正常(防过度收紧)')
{
  // 这是 smoke-test-issue349 / W11 的夹具形状:窗口与身份在**同一条**事件里。
  const sameEvent = [{ type: 'request/context', seq: 1, data: { contextWindow: 1000000, header: { config: { provider: 'p1', model: 'm1', maxTokens: 1000 } } } }]
  const got = findSessionModelPre(sameEvent)
  ok(got.contextWindow === 1000000, '★负路径②:同事件内窗口正常取到(防过度收紧)', got.contextWindow)
  ok(got.model === 'm1' && got.maxTokens === 1000, '★负路径②:同事件内身份与预留同样正常', JSON.stringify(got))
  // ★同模型跨事件补窗口必须**保留**:实测真实会话里 request/header 逐轮追加,
  // 窗口只出现在其中一轮的 request/context 里 —— 若一并收紧掉,长会话窗口会永久为 0。
  const twoRounds = [
    hdr('w', 'flash', null, 14),
    ctx('w', 'flash', 1000000, 15),
    hdr('w', 'flash', null, 25),
  ]
  const got2 = findSessionModelPre(twoRounds)
  ok(got2.contextWindow === 1000000, '★负路径②:同模型后续轮次仍能补到窗口(防过度收紧的核心判据)', got2.contextWindow)
  ok(got2.model === 'flash', '负路径②:身份不变', got2.model)
  // 真实会话形态(W11):header 在前、context 在后
  const w11 = [
    hdr('deepseek-official', 'deepseek-v4.1-flash', null, 13),
    ctx('deepseek-official', 'deepseek-v4.1-flash', 1000000, 14),
  ]
  const got3 = findSessionModelPre(w11)
  ok(got3.contextWindow === 1000000 && got3.model === 'deepseek-v4.1-flash', '负路径②:真实会话顺序(header→context)窗口照常取到', JSON.stringify(got3))
}

console.log('[A08-4] 负路径③:只有 header 无 window ⇒ 全 0 且不抛')
{
  const got = findSessionModelPre([hdr('p', 'm', 256000, 13)])
  eq(got, { provider: 'p', model: 'm', contextWindow: 0, maxTokens: 256000 }, '★负路径③:只有 header ⇒ contextWindow=0')
  ok(findSessionModelPre([]).contextWindow === 0, '负路径③:空数组不抛且窗口 0')
  ok(findSessionModelPre(null).model === '', '负路径③:null 入参不抛')
  ok(findSessionModelPre(undefined).model === '', '负路径③:undefined 入参不抛')
  ok(findSessionModelPre([{ type: 'request/header' }]).contextWindow === 0, '负路径③:事件无 data 不抛')
}

console.log('[A08-5] 负路径④:乱序 / 缺字段不抛')
{
  const junk = [
    null,
    undefined,
    { type: 'request/context', data: { contextWindow: 500 } },
    { type: 'user/message', data: {} },
    { type: 'request/header', data: {} },
    { type: 'request/header', data: { header: {} } },
    { type: 'request/header', data: { header: { config: null } } },
    { type: 'request/context', data: { contextWindow: 'not-a-number' } },
  ]
  let threw = false
  let got = null
  try { got = findSessionModelPre(junk) } catch (e) { threw = true }
  ok(!threw, '★负路径④:畸形事件数组不抛错(水位检查每次工具调用都跑)')
  ok(got && got.model === '' && got.provider === '', '负路径④:畸形事件不产出身份', JSON.stringify(got))
  // 语义说明:**完全没有 model 信息时无法建立模型边界**,此时退化为修复前的旧语义 ——
  //   窗口照常采(与旧实现逐字相同)、身份为空。这是有意的向后兼容降级:没有身份就没有
  //   「可被嫁接的模型」,不存在跨模型借值风险;而若此处一并归零,会让「只有 request/context、
  //   没有 request/header」的历史会话窗口永久为 0(旧实现能取到,属功能倒退)。
  ok(got && got.contextWindow === 500, '负路径④:无任何 model 信息 ⇒ 退化为旧语义(窗口照常采,身份为空)', JSON.stringify(got))
  // 形状守卫:返回字段集合与修复前**完全一致**(既有夹具 W13 逐字断言过,加分字段会打红它)
  const keys = Object.keys(findSessionModelPre([])).sort().join(',')
  ok(keys === 'contextWindow,maxTokens,model,provider', '★负路径④:返回字段集合未扩(不破坏既有 W13 全等断言)', keys)
}

console.log('[A08-6] maxScan 边界:只扫窗口内事件，模型切换在窗口外时保守退化')
{
  // 只扫最近 2 条:窗口外看不到模型切换 ⇒ 退化后仍以窗口内最早那条为边界，绝不去借窗口外(更早)的窗口
  const events = [
    ctx('old', 'old-m', 1000000, 1),
    hdr('new', 'new-m', 4096, 2),
    { seq: 3, type: 'user/message', data: {} },
  ]
  const got = findSessionModelPre(events, 2)
  ok(got.model === 'new-m' && got.contextWindow === 0, '★maxScan=2:窗口内已是新模型 ⇒ 窗口 0(不越界借)', JSON.stringify(got))
  const gotFull = findSessionModelPre(events)
  ok(gotFull.contextWindow === 0, 'maxScan=0 全扫:结论一致(不越界借)')
}

console.log(String.fromCharCode(10) + '[a08] ' + pass + ' passed, ' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)