#!/usr/bin/env node
/** [switch-decouple] 白板开关 / 自动接续开关解耦回归(2026-09-14)。
 *
 * 缺陷(主车道取证):
 *   ①checkWaterLevel / checkWaterLevelAtStep 开头 `if (this.config.handoffEnabled === false) return`
 *     ⇒ 白板关时水位永不测量 ⇒ rt.waterLevelModelKnown 永不写入 ⇒ shouldArmAutoContinuePre 的
 *       fail-closed 闸(`modelKnown !== true && !hard → false`)永远拒绝 arm(关白板 = 静默关接续);
 *   ②autoContinueState.enabled = autoContinueEnabled !== false && handoffEnabled !== false(第二处耦合);
 *   ③buildContinueCarry 开头直接返回 { ok:false, error:'handoff disabled' }(载体层面也把两个开关绑死)。
 *
 * 本次契约(解耦):水位**测量**与接续**资格**只看 autoContinueEnabled;PLAN/账本**产物**仍只看 handoffEnabled。
 * 本套件优先行为断言(抽取真实函数体 + 受控 this 执行),源码正则仅用于接线与"两页共用同一对键"。
 *
 *   D1 行为:白板关 + 接续开 → pre-step 仍测量,且把真实 modelKnown 交给 armAutoContinue,闸放行
 *   D2 行为:真实 checkWaterLevel 在白板关时**写** rt.waterLevelModelKnown,但**不写**PLAN/账本产物(镜像保护)
 *   D3 行为:buildContinueCarry 白板关不再 'handoff disabled',载体=转写包(且不含 PLAN/账本正文)
 *   D4 接线:白板页与设置页读写同一对配置键;两键出厂默认均 false(测试期)
 */
import { readFileSync, mkdirSync, writeFileSync, mkdtempSync, existsSync } from 'node:fs'
import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import {
  parseModelWindowsPre, pickWindowPre, findOfficialContextWindowPre, findSessionModelPre,
  scanPressureSignalsPre, shouldArmAutoContinuePre, reusableWindowCachePre, sessionModelSigPre,
  // ★issue #451：checkWaterLevel 新增两个引用符号（代理压缩兜底）。本套件 strictInjection 会拦漏注入。
  detectProxyCompactionPre, resolveProxyUsagePre,
} from '../../lib/water-window.js'
// ★v4 批次 E-4（2026-10-24）：checkWaterLevel 新增引用事件模块的两个符号（水位检查点写事件）。
//   本套件用「源码抽取 + new Function」执行生产方法体 ⇒ 自由变量必须显式注入；
//   这里注入**真实实现**（不是桩）：事件库缺失时 pickCarryEventPre 返回 null ⇒ fail-soft，
//   与本批修复前的「白板关仍测量」语义逐字节一致。
import { EVENT_STORE_FILENAME as V4_EVENT_STORE_FILENAME } from '../../lib/event-store.js'
import { pickCarryEventPre } from '../../lib/event-carry.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SRC = readFileSync(path.resolve(HERE, '..', '..', 'lib', 'index.js'), 'utf8')
const CSRC = readFileSync(path.resolve(HERE, '..', '..', 'lib', 'client.js'), 'utf8')
let pass = 0, fail = 0
const ok = (c, n) => { if (c) { pass++; console.log('  ok -', n) } else { fail++; console.log('  FAIL -', n) } }
const tmpRoot = (() => { const d = path.join(os.tmpdir(), 'dam-switch-decouple-' + Date.now()); mkdirSync(d, { recursive: true }); return d })()

// —— 源码抽取器(花括号配平) ——
function extractFn(header) { return extractFnIn(SRC, header) }
function extractFnIn(src, header) {
  const start = src.indexOf(header)
  if (start < 0) throw new Error('not found: ' + header)
  let depth = 0, end = -1
  for (let i = start + header.length - 1; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') { depth--; if (depth === 0) { end = i; break } }
  }
  if (end < 0) throw new Error('unbalanced: ' + header)
  return src.slice(start, end + 1)
}
/** 抽取模块级 const/function 声明文本(逐行扫描 + (){}[] 混合配平)。 */
function grab(name) {
  const lines = SRC.split('\n')
  let li = lines.findIndex((l) => {
    const t = l.trim()
    return t.startsWith('const ' + name + ' ') || t.startsWith('const ' + name + '=') ||
      t.startsWith('function ' + name + '(') || t.startsWith('var ' + name + ' ')
  })
  if (li < 0) throw new Error('helper not found: ' + name)
  let buf = '', depth = 0, started = false
  for (let n = 0; li < lines.length && n < 400; li++, n++) {
    buf += lines[li] + '\n'
    for (const ch of lines[li]) {
      if (ch === '{' || ch === '(' || ch === '[') { depth++; started = true }
      else if (ch === '}' || ch === ')' || ch === ']') depth--
    }
    if (depth <= 0 && (started || /;[ \t]*$/.test(lines[li]))) break
  }
  return buf
}
function makeFakeEngine() {
  return {
    memToday: () => '2026-09-14',
    async readTextSafe(p) { try { return (await readFile(p, 'utf8')) || '' } catch (e) { return '' } },
    async writeFullRaw(p, text) { await mkdir(path.dirname(p), { recursive: true }); await writeFile(p, text, 'utf8') },
  }
}
const handoffStampFn = new Function(grab('handoffStamp') + '\nreturn handoffStamp;')()
const nowHmFn = new Function(grab('nowHm') + '\nreturn nowHm;')()
// ★L3(2026-09-17) 修复:L3 把 buildContinueCarry 的组装逻辑抽成了**模块级**函数
//   `assembleCarryPre`。本测试用 `new Function` 从源码重建方法体,自由变量必须**显式注入** ——
//   漏注入会让方法体内 `assembleCarryPre(...)` 抛 ReferenceError, 被 try/catch 吞成
//   `{ok:false, error:'assembleCarryPre is not defined'}` ⇒ D3 六条断言假红。
//   这正是"重构改了自由变量可见性、源码抽取式测试没跟上"的典型, 记为教训。
//   ⚠️ 坑:extractFn 假定 header 以函数体的 `{` 结尾、从这里开始配平;
//   而本函数的**参数用了对象解构**(`{ head = [] , ... } = {}`), 若 header 只写到 `(`,
//   配平会在**解构默认值的 `}`** 处提前闭合 ⇒ 截出半截源码 ⇒ `new Function` 报
//   "Unexpected token 'return'"。故 header 必须一路写到**函数体的 `{`**。
const assembleCarryPreFn = new Function(
  extractFn('export function assembleCarryPre({ head = [], nav = [], bulk = [], budget = 18000 } = {}) {')
    .replace(/^export\s+/, '') + '\nreturn assembleCarryPre;'
)()
// ★2026-10-06 批次 A-1f② 配套：armAutoContinue 现在带 `isSubAgentSession(agent)` 守卫（子代理不得 arm）。
//   本套件用「源码抽取 + new Function」执行方法体 ⇒ 该自由变量必须**显式注入**，否则方法体抛
//   `isSubAgentSession is not defined` 被自身 catch 吞掉、armed 永不落位 ⇒ D1b 假红（实测已发生）。
//   注入的是**从生产源码同源抽出的真函数**（不是放宽判据的桩）：判据本身就该是真件。
const SESSION_SUBAGENT_ORIGIN = new Function(grab('SESSION_SUBAGENT_ORIGIN') + '\nreturn SESSION_SUBAGENT_ORIGIN;')()
const sessionHeaderOfFn = new Function(grab('sessionHeaderOf') + '\nreturn sessionHeaderOf;')()
const isSubAgentSessionFn = new Function('sessionHeaderOf', 'SESSION_SUBAGENT_ORIGIN',
  grab('isSubAgentSession') + '\nreturn isSubAgentSession;')(sessionHeaderOfFn, SESSION_SUBAGENT_ORIGIN)
/**
 * ★issue#349(2026-10-13):「注入表必须覆盖方法体引用的全部宿主符号」的**结构性守卫**。
 *
 * 为什么需要它:本套件用「源码抽取 + new Function」执行生产方法体,被抽出的代码里的自由变量
 * 必须在注入表里显式给出,否则抛 ReferenceError —— 而 checkWaterLevel 的外层是
 * `catch (eWin) {}`,异常被**静默吞掉** ⇒ 断言只是变成「modelKnown 不为 true」,看不出真因。
 * 2026-09 已发生过一次同型事故(DEFAULT_AUTO_CONTINUE_THRESHOLD is not defined,见下方注入注释),
 * 2026-10-13 #349 是第二次(sessionModelSigPre 未注入)。本守卫让第三次直接响亮地失败。
 *
 * 判定(保守,只报高置信度类别,避免假阳性):
 *   ① **被调用**的自由标识符(`id(` 形式的调用目标)—— #349 正是这一类;
 *   ② **全大写**的自由标识符(模块级常量,如 DEFAULT_AUTO_CONTINUE_THRESHOLD)—— 2026-09 那一类。
 * 排除:注入表已给出的、方法体内部声明的(const/let/var/function/参数/捕获变量)、JS 全局、语言关键字、
 * 以及紧跟 `.` 的属性访问与 `{ key: ... }` 属性名。
 *
 * @param {string} body - 抽取出的方法体源码。
 * @param {string[]} injectedNames - 本次注入表里的名字。
 * @returns {string[]} 疑似未注入的名字(空数组 = 覆盖完整)。
 */
const JS_GLOBALS_PRE = new Set(['Math', 'JSON', 'String', 'Number', 'Boolean', 'Array', 'Object', 'Date', 'Buffer', 'Promise',
  'Set', 'Map', 'WeakMap', 'WeakSet', 'RegExp', 'Error', 'TypeError', 'RangeError', 'Symbol', 'BigInt', 'Intl',
  'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'encodeURIComponent', 'decodeURIComponent', 'structuredClone',
  'console', 'process', 'globalThis', 'require', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
  'Function', 'Proxy', 'Reflect', 'ArrayBuffer', 'Uint8Array', 'TextEncoder', 'TextDecoder', 'URL', 'URLSearchParams'])
const KEYWORDS_PRE = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'typeof', 'instanceof', 'new', 'delete',
  'void', 'in', 'of', 'do', 'else', 'try', 'finally', 'throw', 'function', 'const', 'let', 'var', 'await', 'async',
  'yield', 'class', 'extends', 'super', 'this', 'null', 'true', 'false', 'undefined', 'NaN', 'Infinity'])
function missingInjectedSymbolsPre(body, injectedNames) {
  const inj = new Set(injectedNames.map(String))
  let src = String(body)
  src = src.replace(/\/\*[\s\S]*?\*\//g, ' ')          // 块注释
  src = src.replace(/\/\/[^\n]*/g, ' ')                    // 行注释
  src = src.replace(/'(?:[^'\\]|\\.)*'/g, ' __STR__ ')     // 单引号串(含转义)
  src = src.replace(/"(?:[^"\\]|\\.)*"/g, ' __STR__ ')     // 双引号串
  src = src.replace(/\/(?:[^\/\\\n]|\\.)+\/[gimsuy]*/g, ' __RE__ ') // 正则字面量
  const headerText = src.slice(0, Math.max(0, src.indexOf('{')))
  const locals = new Set()
  for (const m of headerText.matchAll(/[A-Za-z_$][\w$]*/g)) locals.add(m[0])
  for (const m of src.matchAll(/\b(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g)) locals.add(m[1])
  for (const m of src.matchAll(/\bcatch\s*\(\s*([A-Za-z_$][\w$]*)/g)) locals.add(m[1])
  const missing = new Set()
  const consider = (id) => {
    if (!id || locals.has(id) || inj.has(id) || JS_GLOBALS_PRE.has(id) || KEYWORDS_PRE.has(id)) return
    missing.add(id)
  }
  // ① 调用目标
  for (const m of src.matchAll(/(?:^|[^.\w$])([A-Za-z_$][\w$]*)\s*\(/g)) consider(m[1])
  // ② 全大写常量(未在注入表/本地声明)
  for (const m of src.matchAll(/(?:^|[^.\w$])([A-Z][A-Z0-9_]{3,})(?![\w$])/g)) consider(m[1])
  return Array.from(missing).sort()
}
/** ★issue#349:strict 模式开关 —— 见上方 missingInjectedSymbolsPre 的说明。
 *  仅对「本套件主测方法」开启:其余抽取(如 resolveWaterWindow)另有与本次缺陷无关的既有注入缺口,
 *  开启会让整套件因**别的**原因变红(已单独报告 Lead)。 */
const bindMethod = (header, fake, extra, opts) => {
  const names = ['path', 'existsSync', 'mkdir', 'writeFile', 'readdir', 'stat', 'handoffStamp', 'nowHm', 'assembleCarryPre', 'isSubAgentSession',
    // ★T7-a（2026-09-20 · 上游 #86-4）：水位/接续默认值已抽为**模块级常量**。
    //   本套件用"源码抽取 + new Function"执行方法体 ⇒ 被抽出的代码里的自由变量必须在这里显式注入，
    //   否则会抛 `DEFAULT_AUTO_CONTINUE_THRESHOLD is not defined`（实测已发生）。
    //   ⚠️ 注入的是**与生产同值**的常量（0.75），不是放宽断言。
    'DEFAULT_AUTO_CONTINUE_THRESHOLD', 'DEFAULT_WATER_LEVEL_THRESHOLD',
    // #207: this unit checks switch eligibility only; real disk views/recovery
    // are exercised by smoke-test-issue207-routes with complete production apply.
    'continuedSourceState', 'continuedSourceView']
  const vals = [path, SRC && null, mkdir, writeFile, readdir, stat, handoffStampFn, nowHmFn, assembleCarryPreFn, isSubAgentSessionFn, 0.75, 0.75, () => null, () => null]
  vals[1] = (p) => { try { return readFileSync(p) != null } catch (e) { return false } }
  for (const k of Object.keys(extra || {})) { names.push(k); vals.push(extra[k]) }
  // ★issue#349 结构性守卫:注入表没覆盖到被调用/被引用的宿主符号 ⇒ 这里立刻响亮失败
  const missingSyms = opts && opts.strictInjection ? missingInjectedSymbolsPre(extractFn(header), names) : []
  if (missingSyms.length) {
    throw new Error('[switch-decouple] ' + header + ' 注入表缺少方法体引用的宿主符号: ' + missingSyms.join(', ') +
      ' —— 会导致 ReferenceError 被 checkWaterLevel 的 catch (eWin) 静默吞掉(见 #349 / 2026-09 同型事故)')
  }
  const obj = new Function(...names, 'return {' + extractFn(header) + '};')(...vals)
  return obj[Object.keys(obj)[0]].bind(fake)
}

console.log('[switch-decouple] D1 行为:白板关 + 接续开 → pre-step 仍测量并把真实 modelKnown 交给 arm')
{
  const body = extractFn('checkWaterLevelAtStep(agent, minGapMs = 0) {')
  function makeStep(cfg) {
    const rt = {}
    const armed = []
    const eng = {
      config: cfg || {},
      runtimeFor: () => rt,
      hasReliableSessionIdentity: () => true,
      // 真实 checkWaterLevel 在测量完成后会写这五个字段(见 lib/index.js waterLevel* 段)
      checkWaterLevel() {
        rt.waterLevel = 0.9; rt.waterLevelTokens = 900; rt.waterLevelWindow = 1000
        rt.waterLevelSource = 'manual'; rt.waterLevelModelKnown = true; rt.waterLevelHard = false
        return Promise.resolve()
      },
      armAutoContinue(agent, wl) { armed.push(wl) },
    }
    const fn = new Function('diag', 'return {' + body + '};')(() => {}).checkWaterLevelAtStep.bind(eng)
    return { fn, armed }
  }
  const off = makeStep({ handoffEnabled: false, autoContinueEnabled: true })
  off.fn({ session: { id: 'session-d1' } })
  await new Promise((r) => setTimeout(r, 20))
  ok(off.armed.length === 1, '白板关(handoffEnabled=false)+接续开:pre-step 仍然测量并 arm(实际 ' + off.armed.length + ' 次)')
  const wl = off.armed[0] || {}
  ok(wl.modelKnown === true, 'arm 收到的是真实 modelKnown(不是 undefined)')
  ok(shouldArmAutoContinuePre(wl) === true, 'fail-closed 闸放行:白板关不再把接续永久挡死')
  const both = makeStep({ handoffEnabled: false, autoContinueEnabled: false })
  both.fn({ session: { id: 'session-d1b' } })
  await new Promise((r) => setTimeout(r, 20))
  ok(both.armed.length === 1, '测量侧不因 autoContinueEnabled=false 而停(资格判定在 armAutoContinue 内,由 D1b 单独验)')
}

console.log('[switch-decouple] D1b 行为:接续资格只看 autoContinueEnabled(不看白板开关)')
{
  const fake = {
    config: { autoContinueEnabled: true, handoffEnabled: false },
    _autoContState: {},
    continuedSessionsFile: () => 'unused-unit-state.json',
    waterKey: (s) => String(s || ''),
  }
  const st = bindMethod('autoContinueState(selfSid) {', fake)
  ok(st('session-x').enabled === true, 'autoContinueState.enabled=true(接续开,白板关)')
  const fake2 = { config: { autoContinueEnabled: false, handoffEnabled: true }, _autoContState: {}, continuedSessionsFile: () => 'unused-unit-state.json', waterKey: (s) => String(s || '') }
  const st2 = bindMethod('autoContinueState(selfSid) {', fake2)
  ok(st2('session-x').enabled === false, 'autoContinueState.enabled=false(接续关)')
  const armed = []
  const eng = {
    config: { autoContinueEnabled: true, handoffEnabled: false, autoContinueThreshold: 0.75, autoContinueCooldownMinutes: 30 },
    hasReliableSessionIdentity: () => true,
    isContinuedSession: () => false,
    waterKey: (s) => String(s || ''),
    _autoContState: {},
    runtimeFor: () => ({ disposed: false, state: {} }),
  }
  const arm = bindMethod('armAutoContinue(agent, wl, opts = null) {', eng, {
    diag: () => {}, shouldArmAutoContinuePre,
  })
  arm({ session: { id: 'session-arm' } }, { ratio: 0.95, tokens: 950, window: 1000, source: 'manual', modelKnown: true, hard: false })
  ok(!!(eng._autoContState && eng._autoContState.armed), 'armAutoContinue 在白板关时代照常落 armed(闸不再被白板开关挡住)')
  // ★A-1f② 负路径：子代理会话**不得** arm（否则接续走通用 session 路由必被宿主拒，且失败不落闩 ⇒ 反复报错）。
  const engSub = Object.assign({}, eng, { _autoContState: {} })
  const armSub = bindMethod('armAutoContinue(agent, wl, opts = null) {', engSub, { diag: () => {}, shouldArmAutoContinuePre })
  armSub({ session: { id: 'session-sub', header: { origin: 'subagent' } } }, { ratio: 0.95, tokens: 950, window: 1000, source: 'manual', modelKnown: true, hard: false })
  ok(!(engSub._autoContState && engSub._autoContState.armed), '★ 子代理会话不得 arm（A-1f② 守卫）')
}

console.log('[switch-decouple] D2 行为:真实 checkWaterLevel —— 白板关仍测量,但不写 PLAN/账本产物(镜像保护)')
function makeWaterFake(opts, ledgerCalls) {
  // ★2026-10-26：runtime 必须带 state —— 生产侧 createSessionRuntime() 恒写 `state: createRuntimeState()`
  //   （lib/index.js:2323）。空对象桩是「假状态桩」的**镜像形态**（该给的字段没给），
  //   导致 checkWaterLevel 的 22 个 agent-runtime 字段无处可写 ⇒ 断言全读 undefined。
  const rt = { disposed: false, state: {} }
  const fake = Object.assign(makeFakeEngine(), {
    config: Object.assign({ handoffEnabled: true, waterLevelWindowTokens: 1000, waterLevelThreshold: 0.8, waterLevelAutoHandoff: true }, opts),
    runtimeFor: () => rt,
    resolvePaths: async () => ({ handoffDir: path.join(tmpRoot, 'handoff'), projectDir: path.join(tmpRoot, 'ws'), planPath: path.join(tmpRoot, 'handoff', 'PLAN.md'), notesPath: path.join(tmpRoot, 'ws', 'notes.md'), logPath: path.join(tmpRoot, 'ws', 'log.md'), ws: path.join(tmpRoot, 'ws') }),
    writeHandoffLedger: async (dir, content) => { ledgerCalls.push(content); return { ok: true, path: path.join(tmpRoot, 'handoff', 'auto-' + ledgerCalls.length + '.md') } },
    rememberWaterRecord: function (sid, rec) { if (!this._waterRecords) this._waterRecords = {}; if (sid) this._waterRecords[sid] = rec },
    // ⚠️ 2026-09-15（方案 1）：`checkWaterLevel` 现在调用 `this.handoffChainEnabledPre()`。
    //   抽取式沙箱里 fake 必须提供它，否则 TypeError 被外层 catch 吞掉 ⇒ 表现为"静默不写账本"，
    //   即本项目的经典坑：被提取方法引用的**所有**符号都得显式提供。
    handoffChainEnabledPre: function () { return this.config.autoContinueEnabled !== false && this.config.handoffEnabled !== false },
    // ⚠️ 2026-09-26（水位 v4）：`checkWaterLevel` 又新增两个 self 方法依赖 ——
    //   `_resolveWaterLevelPre`（镜像官方公式算阈值）与 `_officialParamsPre`（读 preset 参数）。
    //   同型坑：不注入 ⇒ TypeError 被同一个 catch 吞掉 ⇒ 6 条断言假红（归属实验已证：HEAD 基线 53/53，
    //   含本次改动 47/53）。此处**按真实语义注入**（而非放宽断言）：
    //   `_resolveWaterLevelPre` 用与生产同构的纯公式（floor(min(W×r,(W−O)−B))×margin），
    //   ratio/headroom 取官方默认，保证被测的是「水位测量链路」而不是阈值来源。
    _officialParamsPre: function () { return { ratio: 0.8, headroomTokens: 65536, source: 'test-injected' } },
    _resolveWaterLevelPre: function (triggerWin, reserve) {
      const W = Number(triggerWin) || 0
      const O = Math.max(0, Number(reserve) || 0)
      const fixed = Math.max(Number(this.config.waterLevelThreshold) || 0.75, 0.1)
      if (!(W > 0)) return { mode: 'fixed', threshold: fixed, officialRatio: 0, officialTokens: 0, margin: 0, source: 'test-window-unknown' }
      const officialRatio = Math.min(0.8, ((W - O) - 65536) / W)
      if (!(officialRatio > 0)) return { mode: 'fixed', threshold: fixed, officialRatio: 0, officialTokens: 0, margin: 0, source: 'test-fallback' }
      return {
        mode: 'auto', threshold: Math.min(Math.max(officialRatio * 0.9, 0.1), 0.95),
        officialRatio, officialTokens: Math.floor(officialRatio * W), margin: 0.9, source: 'test-injected',
      }
    },
    state: {},
  })
  fake._rt = rt
  return fake
}
const waterDeps = { parseModelWindowsPre, pickWindowPre }
const fakeHome = path.join(tmpRoot, 'home')
mkdirSync(fakeHome, { recursive: true })
const wlBind = (fake) => {
  fake.estimateSessionTokens = bindMethod('estimateSessionTokens(messages) {', fake, {})
  const truncateHeadFn = new Function(grab('truncateHead') + '\nreturn truncateHead;')()
  const reflectionDigestFn = new Function('truncateHead', grab('reflectionDigest') + '\nreturn reflectionDigest;')(truncateHeadFn)
  fake.resolveWaterWindow = bindMethod("async resolveWaterWindow(providerOverride = '', modelOverride = '') {", fake, Object.assign({ dshHome: () => fakeHome }, waterDeps))
  const sessionEventsOfFn = new Function('return ' + grab('sessionEventsOf'))()
  return bindMethod('async checkWaterLevel(agent) {', fake, {
    extractSessionMessages: (a) => a.messages, diag: () => {}, reflectionDigest: reflectionDigestFn,
    truncateHead: truncateHeadFn, sessionEventsOf: sessionEventsOfFn,
    findOfficialContextWindowPre, findSessionModelPre, scanPressureSignalsPre, reusableWindowCachePre, sessionModelSigPre,
    // ★issue #451：checkWaterLevel 新增两个引用符号（代理压缩兜底）。本套件 strictInjection=true，
    //   漏注入会 throw（而非静默 ReferenceError）。这里注入真实实现：本机没有该插件 ⇒ 探测恒"absent"、
    //   兜底恒不生效 ⇒ 本套件所验证的「白板关仍测量」语义与修复前逐字节一致。
    detectProxyCompactionPre, resolveProxyUsagePre,
    // ★v4 批次 E-4（2026-10-24）：水位检查点改写入事件（event-first）后新增两个引用符号。
    //   strictInjection 守卫立刻抓到了漏注入 —— 这正是它存在的意义（漏了会被 catch 静默吞掉，
    //   表现为「白板关不测量」这种看不出真因的假红）。注入真实实现而非桩：事件库缺失时 fail-soft，
    //   与修复前语义逐字节一致。
    V4_EVENT_STORE_FILENAME, pickCarryEventPre,
  }, { strictInjection: true })
}
// 会话事件里带真实模型(request/header)→ 白板关时这个「模型已知」也必须有地方落下去
const agentModelKnown = {
  session: {
    id: 'session-d2', events: [{ type: 'request/header', seq: 1, data: { header: { config: { provider: 'deepseek-official', model: 'deepseek-v4.1-flash' } } } }],
  },
  messages: [{ text: 'x'.repeat(3200) }],
}
{
  const ledgerOff = []
  const fOff = makeWaterFake({ handoffEnabled: false }, ledgerOff)
  const wlOff = wlBind(fOff)
  await wlOff(agentModelKnown)
  ok((fOff._rt.state.waterLevelRatio || 0) >= 0.8, '白板关:水位照测(ratio=' + Number(fOff._rt.state.waterLevelRatio || 0).toFixed(3) + ')')
  ok(fOff._rt.waterLevelModelKnown === true, '白板关:rt.waterLevelModelKnown 被写入且为真实值 true(旧实现该字段永不写入)')
  ok(fOff._rt.waterLevelHard === false, '白板关:rt.waterLevelHard 同样落盘(arm 快照完整)')
  ok(shouldArmAutoContinuePre({ ratio: fOff._rt.waterLevel, modelKnown: fOff._rt.waterLevelModelKnown, hard: fOff._rt.waterLevelHard }) === true,
    '白板关:模型已知 + 越阈 → 闸放行(接续不再被静默关闭)')
  ok(ledgerOff.length === 0, '镜像保护:白板关时不写骨架账本产物(越阈也不写,实际 ' + ledgerOff.length + ' 篇)')

  // ⚠️ 2026-09-15 方案 1 后语义变更：这条"对照"测的是 **白板开关** 的镜像保护，
  //    与接续开关无关 ⇒ 必须显式把 autoContinueEnabled 打开，否则链判定为假、不写账本，
  //    这条对照就测不到它想测的东西（本条报红即"新语义生效"而非回归）。
  const ledgerOn = []
  const fOn = makeWaterFake({ handoffEnabled: true, autoContinueEnabled: true }, ledgerOn)
  const wlOn = wlBind(fOn)
  await wlOn(agentModelKnown)
  ok(ledgerOn.length === 1 && String(ledgerOn[0]).includes('系统自动快照'), '对照:白板开时同一 fixture 照写骨架账本(证明上面那条不是空断言)')
  ok(fOn._rt.waterLevelModelKnown === true, '对照:白板开时 modelKnown 同样为 true')
}

console.log('[switch-decouple] D3 行为:buildContinueCarry 白板关 → 载体退化到转写包(不再 handoff disabled)')
{
  const proj = path.join(tmpRoot, 'carry')
  const handoffDir = path.join(proj, 'handoff')
  mkdirSync(handoffDir, { recursive: true })
  // 白板/账本产物**真实存在于磁盘** —— 白板关时必须一个字都不进材料(比"读不到"更强的判据)
  writeFileSync(path.join(handoffDir, 'PLAN.md'), '# PLAN\nPLAN_BODY_MARKER', 'utf8')
  writeFileSync(path.join(handoffDir, 'handoff-20260914-120000.md'), '## 任务状态\nLEDGER_BODY_MARKER', 'utf8')
  const mkCarry = (handoffEnabled) => {
    const fake = Object.assign(makeFakeEngine(), {
      config: { handoffEnabled },
      resolvePaths: async () => ({
        handoffDir, planPath: path.join(handoffDir, 'PLAN.md'), notesPath: path.join(proj, 'notes.md'),
        logPath: path.join(proj, 'log.md'), ws: proj, projectDir: proj,
      }),
      findLatestGlobalHandoff: async () => null,
      buildPrevSessionPack: async () => ({
        sessionId: 'session-old', transcriptPath: path.join(handoffDir, 'prev-session-old.md'), contSeq: 7,
        provider: 'deepseek-official', model: 'deepseek-v4.1-flash', reasoningEffort: 'high', agentPreset: '',
        cwd: proj, tailText: 'TAIL_MARKER', msgCount: 3,
      }),
      resolveWorkspaceIdForSession: () => 'ws-1',
      currentSessionId: () => 'session-old',
      allocContSeq: async () => 99,
      state: {},
    })
    fake.readLatestHandoff = bindMethod('async readLatestHandoff(handoffDir) {', fake)
    // ★2026-09-28（R51）：buildContinueCarry 的材料解析改为 `this.resolvePathsForSession(preferSid…)`
    //   （修「工作目录不正确」，见 continue-host H10）。抽取式沙箱纪律：被提取方法新增的 self 依赖
    //   必须注入 —— 与上方 resolvePaths 同形（本夹具单工作区，两者等价）。
    fake.resolvePathsForSession = fake.resolvePaths
    return bindMethod('async buildContinueCarry(preferSid) {', fake)
  }
  const rOff = await mkCarry(false)('session-old')
  ok(rOff && rOff.ok === true, "白板关:仍能组装载体(不再 { ok:false, error:'handoff disabled' })" + (rOff && rOff.error ? ' [error=' + rOff.error + ']' : ''))
  const textOff = String((rOff && rOff.carryText) || '')
  ok(textOff.includes('TAIL_MARKER'), '白板关:第2层近期线程(转写包)在位')
  ok(!textOff.includes('PLAN_BODY_MARKER') && !textOff.includes('LEDGER_BODY_MARKER'),
    '镜像保护:白板关时磁盘上的 PLAN/账本正文一个字都不进材料')
  ok(textOff.includes('未启用白板/账本'), '白板关:材料如实自述缺第0/1层(新会话不会去找不存在的白板)')
  ok(!!(rOff && rOff.planPath && rOff.planMtime), '白板关:不声明白板材料时间戳')
  const rOn = await mkCarry(true)('session-old')
  const textOn = String((rOn && rOn.carryText) || '')
  ok(rOn && rOn.ok === true && textOn.includes('PLAN_BODY_MARKER') && textOn.includes('LEDGER_BODY_MARKER'),
    '对照:白板开时同一 fixture 两层材料都在(证明上面两条不是空断言)')
}

console.log('[switch-decouple] D4 接线:两页共用同一对配置键 + 默认关闭')
{
  // ★2026-09-17（3.0.0）：handoffEnabled 默认翻为 true（白板默认开）；autoContinueEnabled 仍是 false ——
  // 用户明确裁定「自动接续还没改好，先默认关（以后也可以默认关）」，这条保持不变。
  ok(/handoffEnabled: true/.test(SRC) && /autoContinueEnabled: false/.test(SRC),
    '配置默认:handoffEnabled=true(3.0.0 白板默认开) 且 autoContinueEnabled=false(用户裁定维持关)')
  const keyH = (CSRC.match(/'data-dam-key': 'handoffEnabled'/g) || []).length
  const keyA = (CSRC.match(/'data-dam-key': 'autoContinueEnabled'/g) || []).length
  ok(keyH >= 2 && keyA >= 2, '白板页与设置页两处都挂了同一对键的开关(实际 ' + keyH + '/' + keyA + ' 处)')
  ok(CSRC.includes("set('handoffEnabled', e.target.checked)") && CSRC.includes("set('autoContinueEnabled', e.target.checked)"),
    '设置页两开关走既有 set()+dirty 机制写同一对键')
  ok(CSRC.includes('saveConfigPatch({ handoffEnabled: v }') && CSRC.includes('autoSave({ autoContinueEnabled: !autoCfg.enabled })'),
    '白板页两开关走既有 saveConfigPatch/autoSave 写同一对键')
  ok(!/autoSave\(\{ autoContinueEnabled: !\(c && c\.autoContinueEnabled/.test(CSRC), '白板页不另起一套配置读取口径')
  const zhF = (CSRC.match(/fAutoContinue: '/g) || []).length
  const zhS = (CSRC.match(/handoffSwitchTitle: '/g) || []).length
  ok(zhF === 2 && zhS === 2, 'zh+en 两套文案表都补齐了新开关文案(实际 ' + zhF + '/' + zhS + ')')
  // 白板关闭时开关卡必须仍可渲染(旧实现在 !data.enabled 处直接 return → 默认关 = 无处可开)
  // ★L2(2026-09-17) 更新锚点:该早退分支的返回体已被 L2 改写(空态改为按 reason 分支的 disMsg 卡片),
  //   旧锚点字面量 `[switchCard` 不再逐字存在 ⇒ indexOf = -1 ⇒ 断言假红。
  //   判据本身不变: switchCard 必须**先于**早退分支出现(即定义在早退之前, 默认关也能渲染它)。
  const planTab = extractFnIn(CSRC, 'function PlanTab() {')
  const earlyReturnIdx = planTab.indexOf('return h(\'div\', null, [switchCard, h(Card, { title: t(\'planTitle\') }')
  ok(planTab.indexOf('switchCard') >= 0 && earlyReturnIdx >= 0 && planTab.indexOf('switchCard') < earlyReturnIdx,
    '白板页:开关卡先于「未启用」分支渲染(默认关闭状态下仍可打开)')
  // 2026-09-14 补:上面那条只证明「开关卡定义在早退分支之前」,对**已启用**分支不构成约束 ——
  // 实测正是它漏掉的路径:白板一开就走末尾 return(rows),而 rows 里没有 switchCard ⇒ 开得了、关不掉。
  // 故必须直接断言「已启用分支的返回里也带上开关卡」。
  // ★2026-09-22 更新锚点:该末尾返回的 div 多了一个属性(`data-dam-flow`,大屏卡片流分列标记),
  //   旧锚点字面量 `return h('div', null, [switchCard]` 不再逐字存在 ⇒ 断言假红。
  //   判据本身不变: 末尾返回必须**无条件**把 switchCard 并进 rows 之前(白板开着也能从本页关掉)。
  ok(/return h\('div', \{[^}]*\}, \[switchCard\]\.concat\(rows\)\)/.test(planTab),
    '白板页:开关卡在「已启用」分支同样渲染(白板开着也能从本页关掉)')
  // 设置页保存不得再 POST 整份快照(宿主端是合并语义,整份快照会把别的入口期间的改动回滚)
  ok(!/saveConfigPatch\(cfg,/.test(CSRC), '设置页保存不再整份快照 POST(旧写法会把其它入口的改动回滚)')
  // ★批次 Y（#212 claim5 前端）：比对基线由「远端快照」升级为「本页加载基线 settingsBase」——
  //   远端快照包含加载后其他入口的改动，比它会把那些改动一并回滚成加载时值；基线才是「本页改了什么」的真源。
  ok(/JSON\.stringify\(cfg\[k\]\) !== JSON\.stringify\(\(settingsBase\.current \|\| \{\}\)\[k\]\)/.test(CSRC),
    '设置页保存改为只提交「与加载基线不同」的键(跨入口改动不再被覆盖；批次 Y 基线=settingsBase)')
  ok(CSRC.includes('apiGet(API.config).then(function (d0)'), '设置页保存前先取回宿主当前配置再比对')
  // 2026-09-14 补:白板页 autoSave 必须把**配置键**映射回**本地状态字段**。
  // 旧实现 `Object.assign({}, p, patch)` 写的是 autoCfg.autoContinueEnabled,而按钮读 autoCfg.enabled
  // ⇒ 配置其实写成功了,但按钮不回弹 ⇒ 用户观感「自动接续无法开关」(阈值输入同病)。这条是承重断言。
  ok(CSRC.includes('next.enabled = patch.autoContinueEnabled') && CSRC.includes('next.threshold = patch.autoContinueThreshold'),
    '白板页 autoSave 把配置键映射回本地字段(否则按钮/阈值不回弹 = 看着关不掉)')
  ok(!/setAutoCfg\(function \(p\) \{ return Object\.assign\(\{\}, p, patch\) \}\)/.test(CSRC),
    '白板页 autoSave 不再直接把配置键并进本地状态(旧写法的根因)')
}

console.log('[switch-decouple] D5 配置响应的外壳:{config,path} 必须解包')
{
  // 2026-09-14 实测(lib/index.js:8461 GET /config 恒返回 { config, path }):
  // 直读**外壳**上的配置键恒得 undefined ⇒ `x === false` 恒假 ⇒ `!(…)` 恒真
  // ⇒ 白板开关显示**恒为「开」**,与真实配置无关;而点击算的是 `!autoCfg.enabled` = `!true` = **false**
  // ⇒ 这个按钮**只能关、永远开不起来**(用户报障原话「我点开关,它并没有真正开关」)。
  // D4 那一批断言只证明「接线存在」,对**响应形状**不构成约束 —— 源码接线守卫 ≠ 行为断言(本项目已两次咬人)。
  const decide = (d) => { const c = (d && d.config) || {}; return { enabled: !(c.autoContinueEnabled === false), handoff: !(c.handoffEnabled === false) } }
  ok(decide({ config: { autoContinueEnabled: false, handoffEnabled: true } }).enabled === false,
    '行为:外壳 {config} 下 autoContinueEnabled=false 必须判为「关」(直读外壳的旧写法恒判为「开」)')
  ok(decide({ config: { autoContinueEnabled: true, handoffEnabled: false } }).enabled === true,
    '对照:同一解包在 true 时判为「开」(证明上一条不是恒真断言)')
  ok(decide({ config: { handoffEnabled: false } }).handoff === false,
    '行为:白板开关同病同修 —— handoffEnabled=false 必须判为「关」')
  ok(CSRC.includes('function configOf(d)'), '接线:存在唯一的配置解包出口 configOf')
  ok(CSRC.includes('var cfg = configOf(await apiGet(API.config))'), '接线:waitForRefresh 读解包后的配置(旧写法恒取默认 90s 超时)')
  ok(CSRC.includes('cfg = configOf(await apiGet(API.config))'), '接线:接续流程读解包后的配置(旧写法使「刷新仪式」开关恒判为开)')
  ok(CSRC.includes('setAcCfg(configOf(d))'), '接线:接续页读解包后的配置')
  ok(!/setAutoCfg\(\{ enabled: !\(c && c\.autoContinueEnabled === false\)/.test(CSRC),
    '白板页不再直读外壳(旧写法:显示恒为「开」且点击只能写 false)')
  ok(!/apiGet\(API\.config\)\.then\(function \(c\) \{ if \(alive\) setAcCfg\(c \|\| \{\}\) \}\)/.test(CSRC),
    '接续页不再直读外壳')
}

console.log('[switch-decouple] D6 ★接续开关 × 水位账本：产物从属于它服务的流程')
{
  // ★2026-09-15 用户实测暴露：关掉 autoContinueEnabled 后**不跳窗口、却照样写水位账本**
  // （证据：~/.dsh/.../handoff-20260915-181530-b.md、handoff-20260915-181614.md 在接续关闭时落盘，
  //  且覆盖动态快照的 latestHandoffText）。
  // 根因：`autoContinueEnabled` 只管接续资格与 GUI 卡片；写入分支只判 handoffEnabled / waterLevelAutoHandoff。
  // 语义：waterLevelAutoHandoff 的唯一目的是**给自动接续准备材料** ⇒ 接续关了，没人来接，账本纯垃圾。
  // 修法（方案 1，用户裁定）：三处（置位 / 写入 / 注入索取）统一走 `handoffChainEnabledPre()`。
  const idx = readFileSync(new URL('../../lib/index.js', import.meta.url), 'utf8')
  ok(/handoffChainEnabledPre\(\) \{/.test(idx), '引擎侧提供统一判定 handoffChainEnabledPre()')
  ok(/return this\.config\.autoContinueEnabled !== false && this\.config\.handoffEnabled !== false/.test(idx),
    '★判定 = autoContinueEnabled 且 handoffEnabled（两者都必须开）')

  // 行为断言：四种组合下"要不要写账本"
  const chain = (cfg) => cfg.autoContinueEnabled !== false && cfg.handoffEnabled !== false
  ok(chain({ autoContinueEnabled: false, handoffEnabled: true }) === false,
    '★行为:接续关 + 白板开 ⇒ 不写水位账本（用户报告的场景，旧实现恒真）')
  ok(chain({ autoContinueEnabled: true, handoffEnabled: true }) === true,
    '对照:两者都开 ⇒ 写（证明上一条不是恒假断言）')
  ok(chain({ autoContinueEnabled: true, handoffEnabled: false }) === false,
    '行为:白板关 ⇒ 不写（09-14 镜像保护的既有语义不许回归）')
  ok(chain({ autoContinueEnabled: false, handoffEnabled: false }) === false,
    '边界:两者都关 ⇒ 不写')

  // 四个调用点必须同源（漏一处就会出现"不接续却每轮催写白板"或"照样落盘"）
  // 计数用宽松匹配：`handoffChainEnabledPre()` 后面可能是 `)` `&&` 或 ` {`，
  // 首版正则写死 `if (this.handoffChainEnabledPre()` 漏掉取反形态，误报"实得 2"。
  const sites = idx.match(/handoffChainEnabledPre\(\)/g) || []
  ok(sites.length >= 5, '★调用点同源（定义 1 + 水位置位 + 接续置位 + 写水位账本 + 注入索取 = 5），实得 ' + sites.length)
  ok(/if \(this\.handoffChainEnabledPre\(\) && this\.config\.waterLevelAutoHandoff !== false/.test(idx),
    '接线:水位账本写入点已改用统一判定')
  ok(/if \(!this\.handoffChainEnabledPre\(\)\) return ''/.test(idx),
    '接线:renderPlanUpdateRequest 已改用统一判定（否则"不接续却每轮催模型重写白板"）')
  // ★v4 批次 E-5（2026-10-24）：置位目标从裸 `this.state` 改为「该 agent 的 runtime」
  //   （实跑确认的既有 bug：无 ALS 上下文下 this.state 是 default runtime，读取方在 withAgent 内 ⇒
  //   写入的待办永远读不到）。本条的**原意是「统一走 handoffChainEnabledPre 判定」**，
  //   不随赋值形态变化 ⇒ 判据改为：该判定条件仍在 markContinuedSession 里守着置位点，
  //   且置位确实写进了 `planUpdatePending`（不再要求字面量是 `this.state`）。
  // ★v4 批次 E-5（2026-10-24）：置位目标改为「该 agent 的 runtime」（实跑确认的既有 bug：
  //   无 ALS 上下文下 this.state 是 default runtime，读取方在 withAgent 内 ⇒ 待办永远读不到）。
  //   本条**原意是「统一走 handoffChainEnabledPre 判定」**，不随赋值形态变化 ⇒ 改为结构性判据：
  //   ① markContinuedSession 里存在 `if (this.handoffChainEnabledPre()) {` 开块；
  //   ② 该块**内部**（花括号配平范围内）确实出现 `planUpdatePending = { reason: 'continue'`。
  //   ⚠️ 不用「两词相距 N 字符」——E-5 加注释后距离 955 字符，首版 600 上限直接假红。
  const mcsStart = idx.indexOf('async markContinuedSession')
  const mcsBody = mcsStart < 0 ? '' : idx.slice(mcsStart, mcsStart + 6000)
  const guardAt = mcsBody.indexOf('if (this.handoffChainEnabledPre()) {')
  let insideBlock = false
  if (guardAt >= 0) {
    let depth = 0
    for (let i = mcsBody.indexOf('{', guardAt); i < mcsBody.length; i++) {
      if (mcsBody[i] === '{') depth++
      else if (mcsBody[i] === '}') { depth--; if (depth === 0) break }
      if (depth > 0 && mcsBody.slice(i, i + 40).includes("planUpdatePending = { reason: 'continue'")) { insideBlock = true; break }
    }
  }
  ok(guardAt >= 0 && insideBlock, '★接线:接续置位点（markContinuedSession）仍由统一判定把关，且确实在该块内置位')
  ok(!/if \(this\.config\.handoffEnabled !== false\) \{\s*\n\s*this\.state\.planUpdatePending/.test(idx),
    '两个置位点都不再只看 handoffEnabled（旧写法在接续关闭时照样置位）')
}

console.log('[switch-decouple] ' + pass + '/' + (pass + fail) + ' assertions passed')
if (fail) process.exit(1)
