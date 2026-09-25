/* ★E1-fix 行为探针（只读源码 + 临时目录，真实写盘）：证明「v2 收敛收口在唯一写入口」成立。
 *  抽取真源码的 _wbStateOf / _workbenchEpochToken / _writeWorkbench 三个函数体**真跑**，
 *  用临时目录当 DSH_HOME，模拟三条路径：
 *    ① 新建分支写入     ② bumpGenFor 式「读旧态→改键→回存」   ③ 二次回存（不得抹掉期牌）
 *  纪律：抽取终点用花括号配平扫描（非贪婪正则会提前截断）。
 *  用法：node artifacts/_e1fix-probe.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC = fs.readFileSync(path.join(ROOT, 'lib', 'index.js'), 'utf8')

let pass = 0, fail = 0
const ck = (name, ok, detail) => { ok ? pass++ : fail++; console.log(`${ok ? '  ✓' : '  ✗'} ${name}${detail ? '  — ' + detail : ''}`) }

function sliceFn(text, signature) {
  const start = text.indexOf(signature)
  if (start < 0) throw new Error('找不到 ' + signature)
  const open = text.indexOf('{', start)
  let d = 0
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') d++
    else if (text[i] === '}') { d--; if (d === 0) return text.slice(start, i + 1) }
  }
  throw new Error('花括号未配平 ' + signature)
}

const tokFn = sliceFn(SRC, '_workbenchEpochToken(epoch, sessionId) {')
const stFn = sliceFn(SRC, '_wbStateOf(st) {')
const wrFn = sliceFn(SRC, 'async _writeWorkbench(st) {')
console.log(`切片：epochToken ${tokFn.length} / wbStateOf ${stFn.length} / writeWorkbench ${wrFn.length} 字符\n`)

/* 造一个临时 DSH_HOME，隔离真实 ~/.dsh（零接触） */
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'dam-e1fix-'))
const MEM = path.join(TMP, 'memory')
fs.mkdirSync(MEM, { recursive: true })
const WB = path.join(MEM, 'workbench.json')

const diagLog = []
/* 注意：抽出的函数体里有 await ⇒ 必须用 AsyncFunction 构造器（new Function 会报
 * 「await is only valid in async functions」）。这是探针自身的坑，不是源码缺陷。
 * ★★切签名的教训（本探针连续踩了 3 次）：`fn.slice(fn.indexOf('('))` 会**把 `async` 关键字剥掉**，
 *   抽出的方法变成非 async ⇒ await 立即报错。正解：**直接用完整函数文本**当对象方法简写
 *   （`async _writeWorkbench(st) {…}` 本身就是合法的方法简写），一个字都不切。 */
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
const body = [
  'return {',
  '  ' + tokFn + ',',
  '  ' + stFn + ',',
  '  ' + wrFn + ',',
  "  _workbenchFile() { return path.join(dshHome(), 'memory', 'workbench.json') },",
  "  async readTextSafe(f) { try { return fs.readFileSync(f, 'utf8') } catch (e) { return '' } },",
  '  async _readWorkbench() { try { const raw = await this.readTextSafe(this._workbenchFile()); return raw ? JSON.parse(raw) : null } catch (e) { return null } }',
  '}',
].join('\n')
/* ★2026-09-26 关键修正（本轮实测踩过，值得记进纪律）：
 *   `_writeWorkbench` 改为调用 **裸标识符** `writeTextAtomicPre(...)`（源码里它是同模块的顶层 import）。
 *   抽出的函数体被塞进 `return { … }` 对象字面量后，**裸标识符不会去对象属性里找** ⇒
 *   `ReferenceError: writeTextAtomicPre is not defined` ⇒ 被 `_writeWorkbench` 自身 catch 吞掉
 *   ⇒ 写盘从未发生 ⇒ 13 条断言集体假红（现象酷似源码回归，实为 harness 缺依赖）。
 *   正解：把它作为 **AsyncFunction 的形参**注入（形参才是词法作用域里的真变量）。
 *   AsyncFunction 本身是 async ⇒ 调用后返回 Promise，**必须 await** 才拿到对象。 */
const host = await new AsyncFunction('createHash', 'fs', 'path', 'diag', 'dshHome', 'writeTextAtomicPre', body)(
  createHash, fs, path,
  (m) => diagLog.push(String(m)),
  () => TMP,
  // 与 config-io.js 同形的原子写：tmp 名带唯一段 + rename（此处简化，无退避重试，够用）
  async function writeTextAtomicPre(file, text) {
    const tmp = file + '.tmp-' + process.pid + '-' + (++writeTextAtomicPre._n || (writeTextAtomicPre._n = 1))
    try {
      await fs.promises.mkdir(path.dirname(file), { recursive: true })
      await fs.promises.writeFile(tmp, String(text), 'utf8')
      await fs.promises.rename(tmp, file)
      return { ok: true, path: file }
    } catch (e) {
      try { fs.rmSync(tmp, { force: true }) } catch (_) {}
      return { ok: false, error: String((e && e.message) || e) }
    }
  },
)

const SID = 'session-81fa8b3b-3839-46fa-a9a4-afb10c693d80'
const EPOCH = 'B10358'
const WANT = createHash('sha256').update(EPOCH + '|' + SID).digest('hex').slice(0, 16)

/* 造「重启前由 F 线写入的旧形状」：version:1、无 epochToken、只有顶层 sessionId */
const legacy = {
  version: 1, sessionId: SID, epoch: EPOCH,
  cwd: path.join(TMP, 'aik_auto_memory_use'), permission: 'danger-full-access',
  createdAt: '2026-09-25T13:03:55.553Z', periodDays: 2, greetCount: 2,
  visibleAt: '2026-09-25T13:03:55.609Z',
  gen: { greet: { n: 2, gen: 1 } }, lastGenAt: '2026-09-25T13:29:56.320Z',
}
fs.writeFileSync(WB, JSON.stringify(legacy, null, 2), 'utf8')

console.log('【① 旧形状（v1 / 无 epochToken）经唯一写入口回存 ⇒ 必须收敛到 v2】')
await host._writeWorkbench(JSON.parse(JSON.stringify(legacy)))
let j = JSON.parse(fs.readFileSync(WB, 'utf8'))
ck('① version 由 1 升为 2', j.version === 2, String(j.version))
ck('① epochToken 已补齐且算法一致', j.epochToken === WANT, `${j.epochToken} vs ${WANT}`)
ck('① phase=active', j.phase === 'active', String(j.phase))
ck('① current 由顶层 sessionId 归一', j.current && j.current.sessionId === SID, JSON.stringify(j.current))
ck('① previous 显式为 null（不残留 undefined）', j.previous === null)
ck('① drainStartedAt=0', j.drainStartedAt === 0)
console.log('  兼容面（删掉即多处半修）：')
for (const k of ['sessionId', 'cwd', 'permission', 'createdAt', 'periodDays', 'greetCount', 'visibleAt', 'gen', 'lastGenAt']) {
  ck(`     保留 ${k}`, JSON.stringify(j[k]) === JSON.stringify(legacy[k]))
}

console.log('\n【② bumpGenFor 式「读旧态→改键→回存」路径 ⇒ 同样收敛，且不得抹掉期牌】')
const st2 = await host._readWorkbench()          // 模拟 bumpGenFor 第一步
const s2 = host._wbStateOf(st2)
st2.epochToken = undefined                        // 极端情形：旧态本就没期牌
st2.gen = st2.gen || {}; st2.gen.fold = { n: 1, gen: 1 }
st2.greetCount = 3
await host._writeWorkbench(st2)
j = JSON.parse(fs.readFileSync(WB, 'utf8'))
ck('② 期牌被重新补齐（不是空串）', j.epochToken === WANT, String(j.epochToken))
ck('② 业务改动生效 gen.fold', j.gen && j.gen.fold && j.gen.fold.n === 1)
ck('② 业务改动生效 greetCount=3', j.greetCount === 3)
ck('② 归一后的 current 未被写成 undefined', j.current && j.current.sessionId === SID)
ck('② _wbStateOf 读回期牌（读入口认 v2）', host._wbStateOf(j).epochToken === WANT)

console.log('\n【③ 期牌已存在时再回存 ⇒ 必须原样保留（不得重算/清空）】')
const st3 = await host._readWorkbench()
await host._writeWorkbench(st3)
j = JSON.parse(fs.readFileSync(WB, 'utf8'))
ck('③ 期牌稳定不变', j.epochToken === WANT, String(j.epochToken))
ck('③ version 仍为 2', j.version === 2)

console.log('\n【④ 无 current 的退化状态 ⇒ 不得凭空造 v2 面（防空转门）】')
fs.writeFileSync(WB, JSON.stringify({ version: 1, epoch: EPOCH }, null, 2), 'utf8')
await host._writeWorkbench(await host._readWorkbench())
j = JSON.parse(fs.readFileSync(WB, 'utf8'))
ck('④ 无 sessionId ⇒ 不写 epochToken（不无中生有）', !j.epochToken, String(j.epochToken))
ck('④ 无 sessionId ⇒ 不提升 version', j.version === 1, String(j.version))

console.log('\n【⑤ 真源码静态判据：收敛点只在唯一写入口】')
const wrBody = wrFn
ck('⑤ _writeWorkbench 内确实做 v2 收敛', wrBody.includes('st.version = 2') && wrBody.includes('_workbenchEpochToken'))
ck('⑤ 收敛守「有 current 才做」', wrBody.includes('if (s.current && s.current.sessionId)'))
const bg = sliceFn(SRC, 'async bumpGenFor(label) {')
ck('⑤ bumpGenFor 未被逐点打补丁（收口策略）', !bg.includes('epochToken'))

try { fs.rmSync(TMP, { recursive: true, force: true }) } catch (e) {}
console.log(`\n═══ 结果：${pass} PASS / ${fail} FAIL ═══`)
console.log('（临时目录已清理，真实 ~/.dsh 零接触；diag 条数=' + diagLog.length + '）')
// ★2026-09-26：diag 必须可见 —— 写盘失败的**原因**就在这里面，不打印等于把线索丢掉
//   （本轮实测：加了这个打印才定位到「抽出的函数体调用了未注入的依赖」这一真因）。
if (fail && diagLog.length) console.log('diag 明细：\n  ' + diagLog.join('\n  '))
process.exit(fail ? 1 : 0)
