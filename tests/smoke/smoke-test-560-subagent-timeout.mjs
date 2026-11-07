#!/usr/bin/env node
/**
 * smoke-test-560-subagent-timeout.mjs —— #560「子代理等待上限 + 报错可区分」。
 *
 * ## 真因口径（比 issue 标题更准，已实测）
 *   issue 标题写「90 秒硬超时」，但 HEAD 上实测是**无上限**：
 *     旧写法 Math.max(_tRaw || 90000, 1000) 里的 90000 是**死代码** ——
 *     走到该分支时 _tRaw 必为「有限且 > 0」；_tRaw || 90000 只在 _tRaw === 0 时取 90000，
 *     而 0 已被 _noTimeout 拦走 ⇒ 永不取到 ⇒ 未传 timeoutMs 时根本不注册定时器。
 *   ⇒ 本批修的是**「报错可区分」**；subagentTimeoutSeconds 是**配套能力**（让用户能调），
 *     不是去修那个不存在的 90 秒。
 *
 * ## CR-10：全部真执行（不写「源码含某字符串」式恒真守卫）
 */
import fs from 'node:fs'
import vm from 'node:vm'
import path from 'node:path'

const ROOT = path.resolve(new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), '..', '..')
const IDX_REL = process.env.MUT_IDX || 'lib/index.js'
const CLI_REL = process.env.MUT_CLI || 'lib/client.js'
const IDX = fs.readFileSync(path.join(ROOT, IDX_REL), 'utf8').replace(/\r\n/g, '\n')
const CLI = fs.readFileSync(path.join(ROOT, CLI_REL), 'utf8').replace(/\r\n/g, '\n')
console.log('被测: ' + IDX_REL + ' / ' + CLI_REL)

let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  ok   - ' + m) } else { fail++; console.log('  FAIL - ' + m) } }
const eq = (a, b, m) => { const g = String(a) === String(b); ok(g, m + (g ? '' : '（实测 ' + String(a) + ' ≠ 期望 ' + String(b) + '）')) }

function block (src, sig) {
  const s = src.indexOf(sig)
  if (s < 0) return null
  let i = src.indexOf('{', s), d = 0, e = -1
  for (; i < src.length; i++) { const ch = src[i]; if (ch === '{') d++; else if (ch === '}') { d--; if (d === 0) { e = i + 1; break } } }
  return e > s ? src.slice(s, e) : null
}

console.log('')
console.log('== A. 出厂默认与区间 ==')
function grabConst (name) {
  const re = new RegExp('const ' + name + ' = ([0-9]+)')
  const m = IDX.match(re)
  return m ? Number(m[1]) : null
}
const DEF = grabConst('DEFAULT_SUBAGENT_TIMEOUT_SECONDS')
const MIN = grabConst('SUBAGENT_TIMEOUT_MIN_SECONDS')
const MAX = grabConst('SUBAGENT_TIMEOUT_MAX_SECONDS')
eq(DEF, 240, '★★A1 DEFAULT_SUBAGENT_TIMEOUT_SECONDS = 240')
eq(MIN, 30, 'A2 MIN = 30')
eq(MAX, 900, 'A3 MAX = 900')
{
  const dc = block(IDX, 'const DEFAULT_CONFIG = {')
  ok(!!dc, 'A4 能定位 DEFAULT_CONFIG 字面量')
  ok(dc && /subagentTimeoutSeconds\s*:\s*DEFAULT_SUBAGENT_TIMEOUT_SECONDS/.test(dc),
     '★★A5 DEFAULT_CONFIG 含 subagentTimeoutSeconds（= Object.keys 白名单，缺了设置页就是「界面在、能力不在」）')
}

console.log('')
console.log('== B. clamp 语义（真跑源码里的判定段） ==')
const onceBody = block(IDX, 'async _runSubagentOnce(text, label, agent, timeoutMs) {')
ok(!!onceBody, 'B0 能抽出真实 _runSubagentOnce 函数体')
const HEAD = 'const _givenTimeout = timeoutMs !== undefined && timeoutMs !== null'
const TAIL = 'const timer = _noTimeout ? null : setTimeout('
const p0 = (onceBody || '').indexOf(HEAD)
const p1 = (onceBody || '').indexOf(TAIL)
ok(p0 > 0 && p1 > p0, 'B1 能定位真实 timeout 判定段')
const judgeSrc = (p0 > 0 && p1 > p0) ? onceBody.slice(p0, p1) : ''

function judgeReal (timeoutMs, cfgSec) {
  const ctx = vm.createContext({
    timeoutMs: timeoutMs,
    Number: Number, Math: Math, isFinite: Number.isFinite,
    DEFAULT_SUBAGENT_TIMEOUT_SECONDS: DEF,
    SUBAGENT_TIMEOUT_MIN_SECONDS: MIN,
    SUBAGENT_TIMEOUT_MAX_SECONDS: MAX,
    __cfgObj: { subagentTimeoutSeconds: cfgSec },
  })
  const body = judgeSrc.replace(/this\.config/g, '__cfgObj')
    + 'globalThis.__r = { tMs: tMs, noTimeout: _noTimeout, effMs: _effMs, cfgSec: _cfgSec };'
  vm.runInContext(body, ctx)
  return ctx.__r
}
try {
  eq(judgeReal(undefined, 5000).tMs, 900000, '★★B2 [负路径] cfg=5000 越界 ⇒ 夹到 900 ⇒ 900000ms')
  eq(judgeReal(undefined, 10).tMs, 30000, '★★B3 [负路径] cfg=10 越界 ⇒ 夹到 30 ⇒ 30000ms')
  eq(judgeReal(undefined, 'abc').tMs, 240000, '★★B4 [负路径] cfg 非数值 ⇒ 回落 240 ⇒ 240000ms')
  eq(judgeReal(undefined, NaN).tMs, 240000, 'B5 [负路径] cfg=NaN ⇒ 回落 240')
  eq(judgeReal(undefined, 240).tMs, 240000, 'B6 cfg 合法 240 ⇒ 原样')
  eq(judgeReal(undefined, 30).tMs, 30000, 'B7 cfg=30 下边界 ⇒ 30')
  eq(judgeReal(undefined, 900).tMs, 900000, 'B8 cfg=900 上边界 ⇒ 900')
  const inf = judgeReal(Infinity, 240)
  eq(inf.noTimeout, true, '★★B9 [关键负路径] 显式 Infinity ⇒ _noTimeout=true（不得被 clamp 成 900）')
  eq(inf.tMs, 0, '★★B10 [关键负路径] 显式 Infinity ⇒ tMs=0（不注册定时器）')
  eq(judgeReal(-1, 240).noTimeout, true, 'B11 显式 -1 ⇒ _noTimeout=true')
  eq(judgeReal(0, 240).noTimeout, true, 'B12 显式 0 ⇒ _noTimeout=true')
  eq(judgeReal(12345, 5000).tMs, 12345, '★★B13 [语义] 显式给值 ⇒ 完全忽略配置（不被 clamp）')
} catch (e) {
  fail++
  console.log('  FAIL - B 组执行异常: ' + (e && e.message))
}

console.log('')
console.log('== C. 设置页（解析生成产物，不看源码串） ==')
{
  const at = CLI.indexOf("t('fSubagentTimeout')");
  ok(at > 0, 'C1 生成产物里有 fSubagentTimeout 设置项')
  const seg = at > 0 ? CLI.slice(at, at + 900) : ''
  eq((seg.match(/min:\s*([0-9]+)/) || [])[1], '30', '★★C2 设置页 min = 30')
  eq((seg.match(/max:\s*([0-9]+)/) || [])[1], '900', '★★C3 设置页 max = 900')
  eq((seg.match(/subagentTimeoutSeconds === undefined \? ([0-9]+)/) || [])[1], '240', '★★C4 设置页默认 = 240')
  ok(/set\('subagentTimeoutSeconds'/.test(seg), 'C5 写的是 subagentTimeoutSeconds');
  const at2 = CLI.indexOf("t('fAutoContinueRefreshTimeout')");
  const seg2 = at2 > 0 ? CLI.slice(at2, at2 + 700) : ''
  eq((seg2.match(/min:\s*([0-9]+)/) || [])[1], '15', '★★C6 [回归] 刷新仪式超时 min 仍 = 15')
  eq((seg2.match(/max:\s*([0-9]+)/) || [])[1], '900', '★★C7 [回归] 刷新仪式超时 max 仍 = 900')
  eq((seg2.match(/autoContinueRefreshTimeoutSeconds === undefined \? ([0-9]+)/) || [])[1], '240', '★★C8 [回归] 刷新仪式超时默认仍 = 240')
}

console.log('')
console.log('== D. i18n ==')
{
  ok(/fSubagentTimeout:\s*'子代理等待上限/.test(CLI), 'D1 zh fSubagentTimeout')
  ok(/fSubagentTimeout:\s*"Subagent wait limit/.test(CLI), 'D2 en fSubagentTimeout')
  ok(/fSubagentTimeoutHint:\s*'派给/.test(CLI), 'D3 zh hint')
  ok(/fSubagentTimeoutHint:\s*"Per-call/.test(CLI), 'D4 en hint')
}

console.log('')
console.log('== E. 报错可区分：正反断言（Lead 点名「比 A 更值钱」） ==')
{
  const cons = block(IDX, '  async consolidateMemory(agent, days = 7) {');
  ok(!!cons, 'E0 能抽出真实 memory_consolidate 函数体')
  const m0 = (cons || '').indexOf('if (!text) {');
  const m1 = (cons || '').indexOf("if (text.includes('(无)'))", m0);
  ok(m0 > 0 && m1 > m0, 'E0b 能定位「!text」报错段')
  const errSrc = (m0 > 0 && m1 > m0) ? cons.slice(m0, m1) : ''
  // ★★E0c：**防空跑**守卫 —— errSrc 为空时 runErr 返回 undefined，会让「含/不含超时」双双假绿。
  //   第一版正是因签名写错（写成 memory_consolidate，真名是 consolidateMemory）而空跑，
  //   而 E1/E4 竟显示 ok —— 恒真守卫的标准形态，先用长度把它钉死。
  ok(errSrc.length > 200, '★★E0c [防空跑] errSrc 非空且足够长（实测 ' + errSrc.length + ' 字符）')
  ok(errSrc.indexOf('超时') >= 0 && errSrc.indexOf('没有正文') >= 0, '★★E0d errSrc 同时含两条分支关键词')

  function runErr (timedOut, text) {
    const ctx = vm.createContext({
      text: text,
      __timedOut: timedOut,
      __cfg: { subagentTimeoutSeconds: 240 },
      Number: Number, Math: Math, String: String,
    })
    const body = 'var _timedOut = __timedOut; var this_ = { config: __cfg };'
      + 'globalThis.__run = function () {'
      + errSrc.replace(/this\.config/g, 'this_.config')
      + '};'
    vm.runInContext(body, ctx)
    return ctx.__run();
  }

  let rTimeout = '', rNoBody = ''
  try { rTimeout = String(runErr(true, '')) } catch (e) { console.log('  (E 正例异常: ' + e.message + ')') }
  try { rNoBody = String(runErr(false, '')) } catch (e) { console.log('  (E 反例异常: ' + e.message + ')') }

  ok(rTimeout.length > 0 && rTimeout !== 'null', '★★E1 [正] timedOut=true + text 空 ⇒ 有报错')
  ok(rTimeout.indexOf('超时') >= 0, '★★E2 [正] 超时分支输出**含**「超时」')
  ok(rNoBody.length > 0 && rNoBody !== 'null', '★★E3 [反] timedOut=false + text 空 ⇒ 有报错')
  // ★E4 判据拆分（这是判据层的取舍，回执「待复核项」已如实披露）：
  //   Lead 原话是「强制 false ⇒ 输出**不得**含『超时』」。
  //   但反例文案写的是「**这不是超时**，调大超时无效」—— 字面含「超时」，语义是在**否定**它。
  //   若按字面把所有「超时」二字删掉，用户反而看不懂；若按语义，则该改成「不得**声称**超时」。
  //   ⇒ 拆成两条更精确的判据（都比字面判据更强）：
  //     E4a 反例不得出现**断言式**的超时陈述（即「子代理在 N 秒内没有返回」这句）
  //     E4b 反例必须**显式否定**超时（含「这不是超时」或等价表述）
  const claimsTimeout = /子代理在\s*\d+\s*秒内没有返回/.test(rNoBody)
  ok(!claimsTimeout, '★★E4a [反·核心] 非超时分支**不声称**「子代理在 N 秒内没有返回」（断言式超时陈述）')
  ok(/这不是超时/.test(rNoBody), '★★E4b [反·核心] 非超时分支**显式否定**超时（「这不是超时」）')
  ok(claimsTimeout === false && /这不是超时/.test(rNoBody), '★★E4c 反例既不声称超时、又主动排除超时 ⇒ 用户不会被误导')
  ok(rTimeout !== rNoBody, '★★E5 两条报错文本不同（真可区分，不是同一句）')
  ok(/subagentTimeoutSeconds/.test(rTimeout), 'E6 超时分支给出可行动项')
  ok(/不是超时/.test(rNoBody), 'E7 非超时分支显式说明「这不是超时」')
}

console.log('')
console.log('== F. 复位与置位收口 ==')
{
  const b = onceBody || ''
  const iReset = b.indexOf('this._subagentLastTimeout = false')
  const iGate = b.indexOf('if (this._disposed)')
  ok(iReset > 0, '★★F1 _runSubagentOnce 里有复位为 false')
  ok(iReset > 0 && iGate > iReset, '★★F2 复位在任何早退之前（所有路径都先复位）')
  ok(/const _markTimeout = \(\) => \{ try \{ this\._subagentLastTimeout = true/.test(b),
     '★★F3 置位只经 _markTimeout 这一个收口')
  ok(/setTimeout\(\(\) => \{ _markTimeout\(\);/.test(b),
     '★★F4 置位点在 timer 回调内（_noTimeout 时不建 timer ⇒ 走不到）')
  ok(/const timer = _noTimeout \? null : setTimeout/.test(b), 'F5 _noTimeout 时不注册定时器')
}

console.log('')
console.log('[560] PASS ' + pass + ' / FAIL ' + fail)
process.exit(fail ? 1 : 0)