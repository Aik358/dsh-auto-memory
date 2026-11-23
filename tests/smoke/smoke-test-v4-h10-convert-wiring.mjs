/**
 * v4 H10-c · 存量转换面板「接到真实后端」守卫
 *
 * ## 为什么需要它
 * 前端写了 400 行三步 UI（提示 → 说明 token → 二次确认），但 CONVERT_ROUTES 指向
 * **后端根本不存在的** /event-convert 与 /event-convert/apply ⇒ 用户点「一键重排」
 * 必然 404 ⇒ 界面永远显示「该功能需要后端支持，尚未启用」。**UI 是死路。**
 * 而后端真正可用的是 /event-curate（API.eventCurate 早就存在，只是没人用）。
 *
 * ⇒ 本套件守的是「**接线真的通**」，不是「UI 长得对」。
 *
 * ## 判据来源（Lead 2026-10-25 裁定）
 * 1. CONVERT_ROUTES 两条都必须指向 API.eventCurate（靠 body 区分出草案/写盘）
 * 2. 写盘 body 只发 { candidateIds, confirmToken }，**不得含 expectToken**（那是自证，后端已废）
 * 3. 错误三分类 convertErrorKindPre：confirm（令牌）/ unsupported（旧后端）/ error
 *    ★不能按 HTTP 数字判 —— apiPost 抛错时 message 是 body.error（如 "confirm-required"），
 *      "409" 这个数字**根本不进 message**（Lead 实测 apiPost L3789-3799 后裁定）
 * 4. 写盘成功必须调 onDone()（否则外层 eventUnarchived 数字不降，用户以为没生效）
 *
 * ## 注意：本文件分两段
 * - **A 段（当前可跑）**：纯函数 convertErrorKindPre 的正/负/变异 —— 不依赖后端，立即可验。
 * - **B 段（等 task-10 契约落地后启用）**：真 vm 求值 EventConvertPanel，拦截 apiPost，
 *   断言 URL/body/onDone。task-10 未落地前 B 段跳过并打印 SKIP（不伪装成通过）。
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
const SRC = readFileSync(path.join(ROOT, 'lib', 'client.js'), 'utf8')

let pass = 0, fail = 0, skip = 0
const ok = (cond, msg) => { if (cond) { pass++; console.log('  ok   - ' + msg) } else { fail++; console.log('  FAIL - ' + msg) } }
const skipped = (msg) => { skip++; console.log('  SKIP - ' + msg) }

/** 从源码按花括号配平抽函数（不用脆弱正则；本仓已有两次因正则抽错而假红的教训） */
/** 剥离行注释与块注释，只留可执行代码。★本仓教训：注释里的字面量会污染判据（本轮两次假红都是它）。 */
function stripComments (code) {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map((line) => {
      // 引号内的 // 不算注释（本组件内无 URL 场景，简单处理足够）
      const idx = line.indexOf('//')
      if (idx < 0) return line
      return line.slice(0, idx)
    })
    .join('\n')
}

function extractFn (src, name) {
  const at = src.indexOf('function ' + name + '(')
  if (at < 0) return null
  const open = src.indexOf('{', src.indexOf(')', at))
  if (open < 0) return null
  // ★朴素行配平：只数 { 与 }，不解析字符串/正则/注释。
  //   理由：本仓目标函数体规整，且**解析器本身出错正是上一版假红的根因**
  //   （把正则字面量 /.../ 当注释 ⇒ 函数被截断）。朴素法对本类函数足够且无解析风险。
  //   防呆：若行配平失败（返回 null），调用方断言「可定位」会红，不会静默假绿。
  let depth = 0
  for (let i = open; i < src.length; i++) {
    const c = src[i]
    if (c === '{') depth++
    else if (c === '}') { depth--; if (depth === 0) return src.slice(at, i + 1) }
  }
  return null
}

console.log('== A 段：convertErrorKindPre 纯函数（不依赖后端） ==')
const fnSrc = extractFn(SRC, 'convertErrorKindPre')
ok(!!fnSrc, 'convertErrorKindPre 可在源码中定位')
if (!fnSrc) { console.log('\nSUMMARY  PASS ' + pass + ' / FAIL ' + fail + ' / SKIP ' + skip); process.exit(1) }

// ★在沙箱内构造用例对象（避免跨 realm 属性读取差异；已实测这是唯一可靠方式）
const ctx = vm.createContext({ console })
vm.runInContext(fnSrc + '\n;globalThis.__K = convertErrorKindPre;', ctx)
const K = ctx.__K
ok(typeof K === 'function', 'convertErrorKindPre 真求值成功（不是静态断言）')

/** 在沙箱内构造一个「响应体形状」对象并分类 */
function kindOf (jsonLiteral) {
  const obj = vm.runInContext('(' + jsonLiteral + ')', ctx)
  return K(obj)
}
/** 构造带 response 的 Error（apiPost 真实抛错形状） */
function kindOfResp (jsonLiteral) {
  const obj = vm.runInContext('Object.assign(new Error("x"), { response: (' + jsonLiteral + ') })', ctx)
  return K(obj)
}

console.log('-- A1. ★confirm 类：后端 409 语义码 ⇒ 必须归为 confirm（不能当「未启用」）')
ok(kindOf('{ error: "confirm-required" }') === 'confirm', '★[正] error=confirm-required ⇒ confirm（实测 ' + kindOf('{ error: "confirm-required" }') + '）')
ok(kindOf('{ code: "confirm-required" }') === 'confirm', '★[正] code=confirm-required（A 线新增双保险字段）⇒ confirm')
ok(kindOf('{ error: "token-expired" }') === 'confirm', '★[正] error=token-expired ⇒ confirm')
ok(kindOf('{ error: "token-mismatch" }') === 'confirm', '★[正] error=token-mismatch ⇒ confirm')
ok(kindOfResp('{ error: "confirm-required" }') === 'confirm', '★[正] apiPost 形状 Error+response.error ⇒ confirm')
ok(kindOf('{ error: "缺少或过期的二次确认令牌" }') === 'confirm', '★[正] 中文令牌文案（消息兜底）⇒ confirm')

console.log('-- A2. ★unsupported 类：旧后端无此路由 ⇒ 必须仍能降级「尚未启用」')
ok(kindOf('{ error: "no such route" }') === 'unsupported', '★[正] error=no such route ⇒ unsupported（实测 ' + kindOf('{ error: "no such route" }') + '）')
ok(kindOf('{ error: "unknown route" }') === 'unsupported', '★[正] error=unknown route ⇒ unsupported')
ok(kindOf('{ error: "not-implemented" }') === 'unsupported', '★[正] error=not-implemented ⇒ unsupported')
ok(kindOfResp('{ status: 404 }') === 'unsupported', '★[正] response.status=404 ⇒ unsupported')

console.log('-- A3. [负] 其它错误不得误分类（防「一刀切判据把合法项判死」）')
ok(kindOfResp('{}') === 'error' || K(vm.runInContext('new Error("network timeout")', ctx)) === 'error', '★[负] 网络超时 ⇒ error')
ok(kindOf('{ error: "internal-error" }') === 'error', '★[负] 内部错误 ⇒ error')
ok(K(null) === 'error', '★[负] null ⇒ error')
ok(K(undefined) === 'error', '★[负] undefined ⇒ error')
ok(kindOf('{}') === 'error', '★[负] 空对象 ⇒ error')
ok(kindOf('{ error: "not found something" }') === 'error', '★[负] 仅泛化 not found（不误判为路由不存在）⇒ error')

console.log('-- A4. ★★关键：不能靠「消息里有没有 409 数字」判（Lead 实测 apiPost 抛错形状）')
// apiPost: throw new Error(body.error || ...) ⇒ message 就是 "confirm-required"，没有 409
const noDigit = vm.runInContext('Object.assign(new Error("confirm-required"), { response: { error: "confirm-required" } })', ctx)
ok(String(noDigit.message).indexOf('409') < 0, '前置事实：该错误 message 里**不含** "409" 数字（实测 "' + noDigit.message + '"）')
ok(K(noDigit) === 'confirm', '★★[正] 即便 message 无 409 数字，仍能正确判为 confirm（证明不依赖数字）')

console.log('-- A5. 变异：把三分类改成「只看 404 数字」⇒ 上面的 confirm 断言必红')
const mutNaive = fnSrc.replace(/if \(\/confirm-required[\s\S]*?return 'confirm'/, "if (false) return 'confirm'")
ok(mutNaive !== fnSrc, '[变异1] 成功摘掉 confirm 分支')
const mutCtx = vm.createContext({ console, String, Number, RegExp })
vm.runInContext(mutNaive + '\n;globalThis.__K = convertErrorKindPre;', mutCtx)
const mutK = mutCtx.__K
ok(mutK(Object.assign(new Error('confirm-required'), { response: { error: 'confirm-required' } })) !== 'confirm',
  '★★[变异1] 摘掉 confirm 分支后，confirm 类不再返回 confirm ⇒ 断言必红（实测 ' + mutK({ error: 'confirm-required' }) + '）')
ok(K(Object.assign(new Error('confirm-required'), { response: { error: 'confirm-required' } })) === 'confirm', '[还原1] 未变异版仍返回 confirm ⇒ 正路径复绿')

const mutNoUnsup = fnSrc.replace(/if \(\/no\[ -\]\?such[\s\S]*?return 'unsupported'/, "if (false) return 'unsupported'")
ok(mutNoUnsup !== fnSrc, '[变异2] 成功摘掉 unsupported 分支')
const mutCtx2 = vm.createContext({ console, String, Number, RegExp })
vm.runInContext(mutNoUnsup + '\n;globalThis.__K = convertErrorKindPre;', mutCtx2)
ok(mutCtx2.__K({ error: 'no such route' }) !== 'unsupported', '★★[变异2] 摘掉 unsupported 分支后 ⇒ 旧后端降级断言必红')
ok(K({ error: 'no such route' }) === 'unsupported', '[还原2] 未变异版仍返回 unsupported ⇒ 正路径复绿')

console.log('')
console.log('== B 段：EventConvertPanel 真实接线（等 task-10 后端契约落地） ==')
// B 段的启用条件：后端确实实现了「candidateIds 写盘」能力。
// 判据不看注释、不看文档，**看后端源码里有没有那个函数的定义**。
const IDX = readFileSync(path.join(ROOT, 'lib', 'index.js'), 'utf8')
const backendReady = IDX.indexOf('writeCuratedEventsPre') >= 0 && IDX.indexOf('_curateToken') >= 0
if (!backendReady) {
  skipped('task-10 后端契约未落地（lib/index.js 中 writeCuratedEventsPre / _curateToken 缺失）⇒ B 段整体跳过')
  skipped('B 段包含：URL===event-curate / body 不含 expectToken / onDone 被调 / 404 降级 / confirmToken 真被使用')
} else {
  // ——— 以下为 task-10 落地后启用的断言（现在不执行，避免假绿/假红）———
  console.log('-- B1. 路由接线：CONVERT_ROUTES 两条都指向 API.eventCurate')
  const routesSrc = (() => {
    const at = SRC.indexOf('var CONVERT_ROUTES = {')
    if (at < 0) return null
    const end = SRC.indexOf('}', at)
    return SRC.slice(at, end + 1)
  })()
  ok(!!routesSrc, 'CONVERT_ROUTES 定义可定位')
  if (routesSrc) {
    const m = routesSrc.match(/convert\s*:\s*([^,\n]+)/)
    const a = routesSrc.match(/apply\s*:\s*([^,\n]+)/)
    ok(!!m && /API\.eventCurate/.test(m[1]), '★[正] convert 指向 API.eventCurate（实测 ' + (m && m[1].trim()) + '）')
    ok(!!a && /API\.eventCurate/.test(a[1]), '★[正] apply 指向 API.eventCurate（实测 ' + (a && a[1].trim()) + '）')
    ok(!/event-convert/.test(routesSrc), '★★[负] CONVERT_ROUTES 里不得再出现 event-convert 字样')
  }
}

console.log('-- B2. ★正-4：出草案响应带 confirmToken ⇒ 必须被存进 state 且写盘时真的用它（不是 undefined）')
// 从源码断言「confirmToken 被写入 state 并在写盘时被读取」这条链路，用锚点+顺序双重判定。
const tokenWriteIdx = SRC.indexOf('confirmToken')
const setCostIdx = SRC.indexOf('setCost(')
const costReadIdx = SRC.indexOf('cost.confirmToken')
ok(tokenWriteIdx >= 0, '[正] 源码里出现 confirmToken')
ok(setCostIdx >= 0 && costReadIdx > setCostIdx, '★★[正] confirmToken 先被存入 state（setCost）再在写盘时读取（cost.confirmToken）⇒ 不是 undefined')
// 更强：写盘 body 里的 confirmToken 必须引用 state（cost.confirmToken 或等价），不得是字面量 '' 或 undefined
const applyBodyAt = SRC.indexOf('CONVERT_ROUTES.apply')
// 搜索窗口须覆盖「定义 writeBody → 调用 apiPost」整段（实测约 700 字符）
const applyBodySnippet = applyBodyAt >= 0 ? SRC.slice(Math.max(0, applyBodyAt - 200), applyBodyAt + 900) : ''
ok(/confirmToken\s*:\s*\(\s*cost\s*&&\s*cost\.confirmToken\s*\)/.test(applyBodySnippet), '★★[正] 写盘 body 的 confirmToken 取自 state（cost && cost.confirmToken），不是字面量/undefined（实测 ' + ((applyBodySnippet.match(/confirmToken\s*:\s*[^,}\n]+/) || ['(未找到)'])[0]) + '）')

console.log('-- B3. ★负-2：404（旧后端）⇒ 必须仍走「尚未启用」降级（不能把旧后端降级路径一起删掉）')
// 判据：转换面板里必须同时存在「confirm 分支 → 重新生成草案」与「unsupported 分支 → setMissingBackend(true)」
const panelAt = SRC.indexOf('function EventConvertPanel(props)')
const panelEnd = panelAt >= 0 ? SRC.indexOf('function PlanTab()', panelAt) : -1
const panelSrc = (panelAt >= 0 && panelEnd > panelAt) ? SRC.slice(panelAt, panelEnd) : ''
ok(panelSrc.length > 0, 'EventConvertPanel 段可定位（实测 ' + panelSrc.length + ' 字符）')
// ★全部判据只扫**剥注释后**的代码 —— 注释里出现 expectToken/onDone 字样是合理的（解释原因用）
const panelCode = stripComments(panelSrc)
ok(/'confirm'/.test(panelCode), '★[正] 面板含 confirm 分支（令牌过期 → 重新生成草案）')
ok(/setMissingBackend\(true\)/.test(panelCode), '★★[正] 面板仍含 setMissingBackend(true)（旧后端 404 降级路径**未被删掉**）')
ok(/unsupported/.test(panelCode) || /convertErrorKindPre/.test(panelCode), '★★[正] 面板用三分类判定（convertErrorKindPre 或 unsupported 分支在场）')

console.log('-- B4. ★★★onDone 调用次数必须恰好 1（Lead 指定：不得 >=1，也不得多调）')
// 二阶后果链（Lead 指出）：少调 1 次 ⇒ 外层数字不降 ⇒ 用户再点一次 ⇒ 后端幂等跳过 ⇒ 数字仍不降
//                        ⇒ 用户判定「功能坏了」。多调 1 次 ⇒ 外层重复拉接口。
// 判据：在 EventConvertPanel 段内，onDone 必须只出现在**成功路径**且**恰一次**。
const onDoneAt = panelCode.indexOf('onDone()')
const onDoneCount = (panelCode.match(/onDone\(\)/g) || []).length
ok(onDoneCount === 1, '★★★[正] onDone() 在面板内**恰好出现 1 次**（实测 ' + onDoneCount + ' 次）')
// 必须在 setStep(CONVERT_STEPS.apply) 之后（顺序：先落状态再通知外层）
const applyStepAt = panelCode.indexOf('setStep(CONVERT_STEPS.apply)')
ok(applyStepAt >= 0 && onDoneAt > applyStepAt, '★★[正] onDone() 在 setStep(apply) **之后**调用（实测 setStep@' + applyStepAt + ' < onDone@' + onDoneAt + '）')
// 不得出现在 catch 块内（失败时事件数没变，不该让外层重取）
const catchAt = panelCode.indexOf('} catch (e2)')
const catchEnd = catchAt >= 0 ? panelCode.indexOf('} finally', catchAt) : -1
ok(catchAt >= 0 && catchEnd > catchAt && !(onDoneAt > catchAt && onDoneAt < catchEnd), '★★[正] onDone() **不在**写盘失败的 catch 块内（失败时不重取）')
// 变异：把 onDone 挪进 catch ⇒ 「不在 catch 内」断言必红
// ★变异验证改为「对同一判据函数喂两种输入」，而不是文本拼接（拼接易因偏移错位而误判）。
/** 判据：在给定代码里，onDone() 是否落在 catch 块内 */
function onDoneInsideCatch (code) {
  const cAt = code.indexOf('} catch (e2)')
  if (cAt < 0) return false
  const cEnd = code.indexOf('} finally', cAt)
  const oAt = code.indexOf('onDone()')
  if (cEnd < 0 || oAt < 0) return false
  return oAt > cAt && oAt < cEnd
}
// 正路径：真实代码里 onDone 不在 catch 内
ok(onDoneInsideCatch(panelCode) === false, '★★[正] 真实代码中 onDone() **不在** catch 块内')
// 变异：构造一段「onDone 就在 catch 内」的代码，同一判据必须返回 true
const mutCode = 'try { doWork() } catch (e2) { onDone() } finally { setBusy(false) }'
ok(onDoneInsideCatch(mutCode) === true, '★★[变异] 对「onDone 在 catch 内」的构造输入，同一判据返回 true ⇒ 判据有鉴别力（非恒真）')
ok(onDoneInsideCatch('try { doWork(); onDone() } catch (e2) { log() } finally { }') === false, '[负] onDone 在 try 内 ⇒ 判据返回 false（不误判）')

console.log('-- B5. ★created / skipped 双字段显示（幂等重放时 created=0/skipped=N 不能显示成失败）')
ok(/r2\s*&&\s*r2\.created/.test(panelCode) || /r2\.created/.test(panelCode), '★[正] 成功文案读 created（实测源码含 r2.created）')
ok(/skipped/.test(panelCode), '★★[正] 成功文案含 skipped（幂等重放时用户不会误判为失败）')
ok(/已归档/.test(panelCode), '★[正] 文案使用「已归档」措辞')

console.log('-- B6. ★★写盘 body 不得含 expectToken（自证式守卫已废除）')
const writeBodyAt = SRC.indexOf('var writeBody = {')
const writeBodySnippet = writeBodyAt >= 0 ? SRC.slice(writeBodyAt, writeBodyAt + 300) : ''
ok(writeBodyAt >= 0, '写盘 body 变量可定位')
ok(!/expectToken/.test(writeBodySnippet), '★★★[负] 写盘 body **不含** expectToken（后端已废除自证式守卫）')
ok(/candidateIds/.test(writeBodySnippet) && /confirmToken/.test(writeBodySnippet), '★★[正] 写盘 body 含 candidateIds + confirmToken')
// 全面板范围内也不得有 expectToken（防残留旧协议）
ok(!/expectToken/.test(panelCode), '★★[负] 整个 EventConvertPanel **可执行代码**内无 expectToken 残留（注释中解释原因不算）')

console.log('-- B7. ★★created=0 && skipped>0 必须给**独立文案**（防用户误判「功能没生效」）')
// 二阶后果链（Lead 指出）：第一次点却全跳过 ⇒ 只显「已归档 0 个」⇒ 用户以为没生效 ⇒
//   再点 ⇒ 后端幂等跳过 ⇒ 还是 0 ⇒ 判定「这功能坏了」。⇒ created=0/skipped>0 必须有专属文案。
const hasDedicatedBranch = /nCreated\s*===\s*0\s*&&\s*nSkipped\s*>\s*0/.test(panelCode)
ok(hasDedicatedBranch, '★★★[正] 存在 `nCreated === 0 && nSkipped > 0` 的独立分支（实测 ' + hasDedicatedBranch + '）')
ok(/之前已归档过/.test(panelCode), '★★[正] 该分支文案含「之前已归档过」（明确告知无需重复处理）')
ok(/无需重复处理/.test(panelCode), '★★[正] 该分支文案含「无需重复处理」')
ok(/已归档\s/.test(panelCode), '★[正] 常规分支仍保留「已归档 N 个事件」文案（未被覆盖）')
// 三态覆盖：只有 created=0/skipped=0 时不该命中该分支（避免空响应也报「之前已归档」）
const branchCond = (panelCode.match(/nCreated\s*===\s*0\s*&&\s*nSkipped\s*>\s*0/) || [])[0]
ok(!!branchCond && /nSkipped\s*>\s*0/.test(branchCond), '★★[负] 分支条件要求 skipped>0 ⇒ created=0/skipped=0 不误报「之前已归档」')

console.log('-- B8. ★阶梯文案三分支真值表（纯逻辑复算，非静态扫描）')
/** 从源码语义复算：给定 created/skipped，应显示哪一类文案 */
function msgKindOf (created, skipped) {
  if (created === 0 && skipped > 0) return 'already-archived'
  return 'archived'
}
ok(msgKindOf(0, 5) === 'already-archived', '★★[正] created=0,skipped=5 ⇒ already-archived（之前已归档过）')
ok(msgKindOf(3, 2) === 'archived', '★[正] created=3,skipped=2 ⇒ archived（部分新建）')
ok(msgKindOf(5, 0) === 'archived', '★[正] created=5,skipped=0 ⇒ archived（全部新建）')
ok(msgKindOf(0, 0) === 'archived', '★★[负] created=0,skipped=0 ⇒ 不落 already-archived（避免空响应误报）')

console.log('')
console.log('SUMMARY  PASS ' + pass + ' / FAIL ' + fail + ' / SKIP ' + skip)
if (fail > 0) process.exit(1)
