/**
 * smoke-test-a09-compaction-inherit.mjs —— issue #429 功能验收(零 IO 纯函数)。
 *
 * 缺陷(修复前,同一个用例同时暴露两处):
 *   两 preset 各带**相同**的 {thresholdRatio:0.7}、preset 全局 headroomTokens=32768 ⇒
 *   ① 命中 modelPolicy 后缺省字段**不继承所属 preset** ⇒ headroom 落到官方默认 65536(应 32768);
 *   ② 歧义判据把 ratio 与 headroom 两组值倒进**同一个 Set** 做并集 ⇒ {0.7,32768} 大小=2 ⇒
 *      ambiguous=true(同一份策略,应 false)。
 *
 * 本套件纪律(CR-10):
 *   - **真 import → 真构造 → 真调用 → 断言返回值**,不做任何「源码含某字符串」式断言;
 *   - 每条正路径都配负路径;
 *   - 变异验证由 artifacts 外的手工回退完成,两次数值写进施工回执(见 #429 回执)。
 */
import {
  pickOfficialParamsPre,
  inheritFieldPre,
  parseCompactionFromYamlPre,
  OFFICIAL_DEFAULT_RATIO,
  OFFICIAL_DEFAULT_HEADROOM,
} from '../../lib/official-compaction.js'

let pass = 0
let fail = 0
const ok = (cond, name, extra) => {
  if (cond) { pass++; console.log('  ok - ' + name + (extra === undefined ? '' : ' (' + extra + ')')) }
  else { fail++; console.error('  FAIL - ' + name + (extra === undefined ? '' : ' 实得 ' + extra)) }
}
const eq = (a, b, name) => ok(JSON.stringify(a) === JSON.stringify(b), name, 'got=' + JSON.stringify(a) + ' want=' + JSON.stringify(b))

/** 构造一条 scanPresetCompactionsPre 形状的 preset 记录(与真实扫描输出同形状)。 */
const preset = (name, ratio, headroom, policies) => ({
  preset: name, found: true, ratio, headroomTokens: headroom, maxTokens: null,
  modelPolicies: policies || [], pluginId: '@deepseek-ai/dsh-compaction-basic',
})

console.log('[A09-1] 正路径:#429 实测形态 —— 两 preset 相同策略')
{
  // 实测夹具:两 preset 各带相同的 {thresholdRatio:0.7},preset 全局 headroom=32768。
  // 注意 modelPolicy 里**故意不写 headroomTokens** —— 那正是「缺省字段须继承所属 preset」的判据。
  const scanned = [
    preset('code', null, 32768, [{ provider: 'dshapi', model: 'deepseek-v4.1-flash', thresholdRatio: 0.7 }]),
    preset('debug', null, 32768, [{ provider: 'dshapi', model: 'deepseek-v4.1-flash', thresholdRatio: 0.7 }]),
  ]
  const got = pickOfficialParamsPre(scanned, 'dshapi', 'deepseek-v4.1-flash')
  // ① headroom 必须继承 preset 全局值 32768(修复前是官方默认 65536)
  ok(got.headroomTokens === 32768, '★正路径①:缺省 headroomTokens 继承所属 preset 全局值', JSON.stringify(got))
  // ② 两字段都相同 ⇒ 不是歧义(修复前 concat 并集 ⇒ {0.7,32768} ⇒ true)
  ok(got.ambiguous === false, '★正路径②:完全相同策略不得判歧义(修复前两字段并集⇒true)', JSON.stringify(got))
  ok(got.ratio === 0.7, '正路径③:policy 显式 ratio 生效', String(got.ratio))
  ok(got.candidates === 2, '正路径④:candidates 仍如实报 2(两个 preset 都命中)', String(got.candidates))
  ok(got.source === 'modelPolicy:code', '正路径⑤:source 指向命中的 modelPolicy', String(got.source))
}

console.log('[A09-2] 负路径①:真歧义 ⇒ ambiguous=true 且各字段独立取最小')
{
  // 两 preset 的**生效元组**不同:0.7/32768 vs 0.6/65536
  const scanned = [
    preset('code', null, 32768, [{ provider: 'p', model: 'm', thresholdRatio: 0.7 }]),
    preset('debug', null, 65536, [{ provider: 'p', model: 'm', thresholdRatio: 0.6 }]),
  ]
  const got = pickOfficialParamsPre(scanned, 'p', 'm')
  ok(got.ambiguous === true, '★负路径①:生效元组不同 ⇒ 必须判歧义', JSON.stringify(got))
  // ★保留既有取值方向:各字段**独立**取最小(ratio 最小 0.6 / headroom 最小 32768)
  ok(got.ratio === 0.6, '负路径①:ratio 取最小(最早提示,保守方向)', String(got.ratio))
  ok(got.headroomTokens === 32768, '负路径①:headroom 独立取最小(不被 ratio 的选择牵连)', String(got.headroomTokens))
  ok(got.source === 'modelPolicy:code', '负路径①:source 按**生效元组**命中(0.6|32768 来自 code)', String(got.source))
  // 对照:把其中一个字段改到与最小者相同 ⇒ 元组仍不同 ⇒ 依旧歧义(防「只看单字段」回归)
  const half = [
    preset('code', null, 32768, [{ provider: 'p', model: 'm', thresholdRatio: 0.6 }]),
    preset('debug', null, 65536, [{ provider: 'p', model: 'm', thresholdRatio: 0.6 }]),
  ]
  const got2 = pickOfficialParamsPre(half, 'p', 'm')
  ok(got2.ambiguous === true, '负路径①:ratio 相同但 headroom 不同 ⇒ 仍必须判歧义(元组判据,不是单字段)', JSON.stringify(got2))
  const third = [
    preset('code', null, 32768, [{ provider: 'p', model: 'm', thresholdRatio: 0.7 }]),
    preset('debug', null, 32768, [{ provider: 'p', model: 'm', thresholdRatio: 0.7 }]),
    preset('third', null, 32768, [{ provider: 'p', model: 'm', thresholdRatio: 0.7 }]),
  ]
  ok(pickOfficialParamsPre(third, 'p', 'm').ambiguous === false, '负路径①:三份相同策略 ⇒ 仍不歧义(防并集回归的三元版本)')
}

console.log('[A09-3] 负路径②:空 list ⇒ 官方默认且不歧义')
{
  const got = pickOfficialParamsPre([], 'p', 'm')
  eq(got, { ratio: OFFICIAL_DEFAULT_RATIO, headroomTokens: OFFICIAL_DEFAULT_HEADROOM, source: 'official-default', ambiguous: false }, '★负路径②:空扫描 ⇒ 官方默认')
  const gotNull = pickOfficialParamsPre(null, 'p', 'm')
  ok(gotNull.ratio === OFFICIAL_DEFAULT_RATIO && gotNull.ambiguous === false, '负路径②:null 入参同样回落官方默认')
  ok(pickOfficialParamsPre(undefined, 'p', 'm').headroomTokens === OFFICIAL_DEFAULT_HEADROOM, '负路径②:undefined 入参同样回落')
}

console.log('[A09-4] 负路径③:无 config 段的 preset(liangshen 型)⇒ ratio=null 且扫描不抛')
{
  // 实测本机:liangshen preset **没有 config 段**(走官方默认)⇒ ratio/headroom 都是 null。
  const liangshen = preset('liangshen', null, null, [])
  const got = pickOfficialParamsPre([liangshen], 'p', 'm')
  ok(got.ratio === OFFICIAL_DEFAULT_RATIO && got.headroomTokens === OFFICIAL_DEFAULT_HEADROOM, '★负路径③:全缺省 ⇒ 官方默认(不抛)', JSON.stringify(got))
  ok(got.source === 'preset:liangshen', '负路径③:source 如实标出来源 preset', String(got.source))
  ok(got.ambiguous === false, '负路径③:单候选不歧义')
  // 解析层:无 config 段的 YAML 必须能解析出 found=true、ratio=null
  const yaml = ['- id: compaction-basic', "  name: '@deepseek-ai/dsh-compaction-basic'"].join(String.fromCharCode(10))
  const parsed = parseCompactionFromYamlPre(yaml)
  ok(parsed.found === true && parsed.ratio === null && parsed.headroomTokens === null, '负路径③:无 config 段 YAML 解析为 found=true / ratio=null', JSON.stringify({ found: parsed.found, ratio: parsed.ratio }))
  let threw = false
  try { pickOfficialParamsPre([preset('bad', null, null, [null, undefined, { provider: 'p' }])], 'p', 'm') } catch (e) { threw = true }
  ok(!threw, '负路径③:modelPolicies 含 null/undefined/半截项不抛')
}

console.log('[A09-5] 字段级继承链(inheritFieldPre):policy > preset > 官方默认')
{
  // ① policy 自带两字段 ⇒ 全用 policy(不看 preset)
  eq(inheritFieldPre({ thresholdRatio: 0.55, headroomTokens: 1234 }, { ratio: 0.9, headroomTokens: 9999 }),
    { ratio: 0.55, headroomTokens: 1234 }, '★继承链①:policy 显式字段优先')
  // ② policy 缺字段 ⇒ 继承 preset 全局
  eq(inheritFieldPre({ provider: 'p' }, { ratio: 0.65, headroomTokens: 4321 }),
    { ratio: 0.65, headroomTokens: 4321 }, '★继承链②:policy 缺字段继承 preset 全局')
  // ③ policy 与 preset 都缺 ⇒ 官方默认
  eq(inheritFieldPre(null, null),
    { ratio: OFFICIAL_DEFAULT_RATIO, headroomTokens: OFFICIAL_DEFAULT_HEADROOM }, '★继承链③:两侧都缺 ⇒ 官方默认')
  // ④ **逐字段**继承(不是整条策略二选一):policy 给 ratio、preset 给 headroom
  eq(inheritFieldPre({ thresholdRatio: 0.5 }, { headroomTokens: 7777 }),
    { ratio: 0.5, headroomTokens: 7777 }, '★继承链④:逐字段混合继承(ratio 取 policy / headroom 取 preset)')
  // ⑤ 非法值不采信(越界 ratio / 负数 headroom)
  eq(inheritFieldPre({ thresholdRatio: 1.5, headroomTokens: -1 }, { ratio: 0.7, headroomTokens: 8888 }),
    { ratio: 0.7, headroomTokens: 8888 }, '★继承链⑤:policy 非法值(ratio>1 / headroom<0)回落 preset')
  eq(inheritFieldPre({ thresholdRatio: 0 }, { ratio: 0, headroomTokens: -5 }),
    { ratio: OFFICIAL_DEFAULT_RATIO, headroomTokens: OFFICIAL_DEFAULT_HEADROOM }, '★继承链⑥:全非法 ⇒ 官方默认')
}

console.log('[A09-6] 与宿主接线的一致性(取值方向未被改动)')
{
  // 「未命中 modelPolicy」分支仍取所有 preset 的最紧值 —— #429 不动这条既有语义。
  const scanned = [
    preset('a', 0.7, 65536, []),
    preset('b', 0.75, 32768, []),
  ]
  const got = pickOfficialParamsPre(scanned, 'x', 'y')
  ok(got.ratio === 0.7 && got.headroomTokens === 32768, '未命中 policy ⇒ 各字段仍独立取最紧(min)', JSON.stringify(got))
  ok(got.ambiguous === true, '未命中 policy 且两 preset 生效元组不同 ⇒ 标歧义')
  // 单 preset 命中 ⇒ 不歧义
  ok(pickOfficialParamsPre([preset('a', 0.7, 65536, [])], 'x', 'y').ambiguous === false, '单候选不歧义')
}

console.log(String.fromCharCode(10) + '[a09] ' + pass + ' passed, ' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)