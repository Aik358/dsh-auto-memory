/**
 * smoke-test-p2a-263-alias-escape —— #263（记忆准入后目录别名重定向，写盘越界）行为级验收。
 *
 * 判据纪律（CR-10）：真 import → 真构造 → 真调用 → 断言**磁盘副作用**；每条配负路径。
 *
 * 覆盖：
 *   ① **报告者的反例**：memoryRoot 是目录 junction，准入 + 锁通过后（首次 readFile 返回前）
 *     把 junction 改指根外 ⇒ 修复后必须「拒绝写」或「写到 admitted-root」，**绝不写 outside-root**。
 *   ② 边界给出的目标必须**真的流进写盘链**（boundary 改判目的地时，写落在边界选定的路径上）。
 *   ③ 正路径：普通目录（无别名）下 append/replace 的落盘结果与**未接线**时逐字节相同。
 *   ④ 向后兼容：不传 admission ⇒ 行为与改动前一致（不做根校验）。
 *   ⑤ 负路径（真变异）：去掉写盘前复核 ⇒ outside-root 又被写入 ⇒ 必红。
 *
 * 环境：Windows junction 本机可用（已实测 symlinkSync(..., 'junction') 创建 + 改指均成功）；
 * 若创建失败，本套件**如实报告 SKIP 并计入 FAIL**（绝不把「跑不了」写成「通过」）。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { pathToFileURL } from 'node:url'

const ROOT = path.resolve(import.meta.dirname, '..', '..')
const WRITER = path.join(ROOT, 'lib', 'memory-writer.js')
let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  ok - ' + m) } else { fail++; console.error('  FAIL - ' + m) } }
const tmps = []
const mkroot = (tag) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'dam-263-' + tag + '-')); tmps.push(d); return d }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let writerSeq = 0
let W = null   // 模块命名空间（供测试用**同一套**路径归一函数产出基准）
async function loadWriter(replacements = []) {
  let src = fs.readFileSync(WRITER, 'utf8')
  for (const [from, to] of replacements) {
    const hits = src.split(from).length - 1
    assert.equal(hits, 1, 'mutation anchor must hit exactly once: ' + JSON.stringify(from.slice(0, 60)) + ' hits=' + hits)
    const next = src.replace(from, to)
    assert.notEqual(next, src, 'mutation must change the source')
    src = next
  }
  const base = pathToFileURL(WRITER).href
  src = src.replace(/from '([^']+)'/g, (m, spec) => spec.startsWith('.') ? 'from ' + JSON.stringify(new URL(spec, base).href) : m)
  const mod = await import('data:text/javascript;base64,' + Buffer.from(src, 'utf8').toString('base64') + '#v' + (++writerSeq))
  W = mod
  return mod
}

/** junction 能力探测：创建 + 改指。返回 {ok, mode}。 */
function junctionCapable(dir) {
  const a = path.join(dir, 'cap-a'), b = path.join(dir, 'cap-b'), l = path.join(dir, 'cap-l')
  try {
    fs.mkdirSync(a, { recursive: true }); fs.mkdirSync(b, { recursive: true })
    fs.symlinkSync(a, l, 'junction')
    fs.writeFileSync(path.join(l, 'x.txt'), 'in-a')
    const landedA = fs.existsSync(path.join(a, 'x.txt'))
    fs.unlinkSync(l)
    fs.symlinkSync(b, l, 'junction')
    fs.writeFileSync(path.join(l, 'y.txt'), 'in-b')
    const landedB = fs.existsSync(path.join(b, 'y.txt'))
    return { ok: landedA && landedB, mode: 'junction' }
  } catch (e) { return { ok: false, mode: 'junction-unavailable:' + (e && e.code) } }
}

/** 造一个「记忆根 = junction，指向 admitted-root」的场景。 */
function fixture(tag) {
  const root = mkroot(tag)
  const admitted = path.join(root, 'admitted-root')
  const outside = path.join(root, 'outside-root')
  const link = path.join(root, 'memoryRoot')
  fs.mkdirSync(admitted, { recursive: true })
  fs.mkdirSync(outside, { recursive: true })
  fs.symlinkSync(admitted, link, 'junction')
  return { root, admitted, outside, link }
}
const readIf = (p) => { try { return fs.readFileSync(p, 'utf8') } catch (_) { return null } }
const listDir = (p) => { try { return fs.readdirSync(p).sort() } catch (_) { return null } }

/** 带 barrier 的 fs 适配器：首次 readFile 前暂停，等反例脚本改指 junction 后再放行。 */
function barrierFs(barrier) {
  let armed = true
  return {
    ...fs.promises,
    async readFile(p, enc) {
      if (armed) { armed = false; await barrier.reached(); await barrier.resume() }
      return await fs.promises.readFile(p, enc)
    },
  }
}
/**
 * barrier 三件套（★注意别把自己锁死）：
 *   · `arrived` —— **测试侧**等待「写盘链已走到 readFile」；
 *   · `reached()` —— **readFile 侧**调用：置位 arrived 并返回 gate（等 resume）；
 *   · `resume()` —— 放行。
 * 早期写法让测试侧也 await `reached()`（拿到的是 gate）⇒ 双方互等、TLA 永挂。
 */
function mkBarrier() {
  let reach, release, signalled = false
  const arrived = new Promise((r) => { reach = r })
  let releaseFn
  const gate = new Promise((r) => { releaseFn = r })
  return {
    arrived,
    reached: () => { if (!signalled) { signalled = true; reach() } return gate },
    resume: () => { releaseFn() },
  }
}

const ADMIT = (link) => ({ admitted: { memoryRoot: link, userMemoryDir: '', projectMemoryDir: '' }, migrationActive: false })

// ══════════════════════════════════════════════════════════════
console.log('[①] 报告者的反例：准入/锁之后改指 junction ⇒ 绝不写到 outside-root')
// ══════════════════════════════════════════════════════════════
{
  const cap = junctionCapable(mkroot('cap'))
  ok(cap.ok, '① junction 能力探测（创建 + 改指）：' + cap.mode)
  if (!cap.ok) {
    console.error('  !! junction 不可用 ⇒ 本组无法执行（如实计 FAIL，不冒充通过）')
    fail++
  } else {
    const { admitted, outside, link } = fixture('escape')
    fs.writeFileSync(path.join(admitted, 'MEMORY.md'), '原始内容\n', 'utf8')
    const { MemoryDocumentStore } = await loadWriter()
    const barrier = mkBarrier()
    const store = new MemoryDocumentStore({
      fs: barrierFs(barrier),
      mutationAdmission: (file) => ({ ...ADMIT(link), target: path.resolve(file) }),
    })
    const target = path.join(link, 'MEMORY.md')
    const flight = store.append(target, '- 越界写入尝试').then((r) => ({ result: r }), (e) => ({ error: e }))
    // 等写盘链进入「已过准入、已持锁、首次 readFile 前」
    await barrier.arrived
    // ★ 反例动作：把 junction 改指根外
    fs.unlinkSync(path.join(link, 'MEMORY.md'))   // 先移走 link 内的文件，避免删除真实文件
    fs.writeFileSync(path.join(admitted, 'MEMORY.md'), '原始内容\n', 'utf8')
    fs.unlinkSync(link)
    fs.symlinkSync(outside, link, 'junction')
    barrier.resume()
    const outcome = await flight
    const outsideAfter = readIf(path.join(outside, 'MEMORY.md'))
    const admittedAfter = readIf(path.join(admitted, 'MEMORY.md'))
    ok(outsideAfter === null, '★ ① outside-root 没有被写入（实 ' + JSON.stringify(outsideAfter) + '）')
    ok(admittedAfter === '原始内容\n', '★ ① admitted-root 原文件保持不变（实 ' + JSON.stringify(admittedAfter) + '）')
    ok(!!outcome.error || (outcome.result && outcome.result.ok === false),
      '★ ① 写入被明确拒绝（error=' + (outcome.error ? outcome.error.code : 'none') + ' result=' + JSON.stringify(outcome.result && outcome.result.reason) + '）')
    // 越界拒绝可能表现为两种形态：抛出（入队复核）或结构化失败（提交层复核被 _commit 收口）
    const escapeSeen = (outcome.error && (outcome.error.code === 'MEMORY_PATH_ESCAPED' || /memory-path-escaped/.test(String(outcome.error.message))))
      || (outcome.result && /memory-path-escaped/.test(String(outcome.result.reason)))
    ok(!!escapeSeen, '★ ① 拒绝原因可归属到越界守卫（memory-path-escaped；实 error=' + (outcome.error && outcome.error.code) + ' reason=' + JSON.stringify(outcome.result && outcome.result.reason) + '）')
    ok(fs.existsSync(outside) && listDir(outside).length === 0, '★ ① outside-root 无残留（连临时文件都不留，实 ' + JSON.stringify(listDir(outside)) + '）')
  }
}

// ══════════════════════════════════════════════════════════════
console.log('[②] 边界给出的目标必须流进写盘链（boundary 改判目的地 ⇒ 写落在它选定的路径）')
// ══════════════════════════════════════════════════════════════
{
  const cap = junctionCapable(mkroot('cap2'))
  if (!cap.ok) { console.error('  !! junction 不可用 ⇒ 本组跳过（如实计 FAIL）'); fail++ } else {
    const { admitted, outside, link } = fixture('boundary-target')
    fs.writeFileSync(path.join(admitted, 'MEMORY.md'), 'A\n', 'utf8')
    const { MemoryDocumentStore } = await loadWriter()
    // 模拟 P1 的「边界复核后返回新鲜/物理目的地」：把 junction 改指根外之后，边界仍返回 **admitted 的物理路径**。
    //   ★别名基准由测试显式钉在 admitted 物理目录（= 受理时刻的那个目录），
    //     这样本例检验的是「边界改判的路径真的被写盘链采用」，而不是别名检测本身。
    const physicalAdmitted = fs.realpathSync(admitted)
    fs.unlinkSync(link)
    fs.symlinkSync(outside, link, 'junction')
    const store = new MemoryDocumentStore({
      mutationAdmission: (file) => ({ ...ADMIT(physicalAdmitted), target: path.resolve(file) }),
      mutationBoundary: (_file, work) => work(path.join(physicalAdmitted, 'MEMORY.md')),
      // ★基准必须用**模块自己的归一函数**产出：canonPath 在 8.3 短名/长名之间有自己的口径，
      //   拿 fs.realpathSync 的另一种拼写当基准会得到「同一目录、两种字符串」⇒ 假拒绝（本组实测过）。
      aliasPinOf: () => W.pinTargetAliasPre(path.join(physicalAdmitted, 'MEMORY.md')),
    })
    const r = await store.append(path.join(link, 'MEMORY.md'), '由边界改判的目的地')
    ok(r && r.ok === true, '② 写成功（边界给的是真实物理路径）')
    const admittedAfter = readIf(path.join(admitted, 'MEMORY.md'))
    ok(!!admittedAfter && admittedAfter.includes('由边界改判的目的地'), '★ ② 内容落在**边界选定的** admitted-root（而不是 lexical 的 junction 目标）')
    ok(readIf(path.join(outside, 'MEMORY.md')) === null, '★ ② outside-root 仍未被动过')
  }
}

// ══════════════════════════════════════════════════════════════
console.log('[③] 正路径：普通目录下与「未接线」逐字节相同')
// ══════════════════════════════════════════════════════════════
{
  const { MemoryDocumentStore } = await loadWriter()
  const mk = (restore) => {
    const dir = mkroot('plain')
    const fsApi = {
      ...fs.promises,
      readFile: (...a) => fs.promises.readFile(...a),
    }
    return { dir, fsApi }
  }
  // 接线（带根）= 对照组 A；不接线 = 对照组 B
  const a = mk(), b = mk()
  const seedA = '# 笔记\n\n<!-- mem_0123456789abcdef0123456789abcdef -->\n旧内容\n<!-- /mem_0123456789abcdef0123456789abcdef -->\n'
  fs.writeFileSync(path.join(a.dir, 'MEMORY.md'), seedA, 'utf8')
  fs.writeFileSync(path.join(b.dir, 'MEMORY.md'), seedA, 'utf8')
  // idFactory 必须钉住：记忆 id 是随机生成的，不钉住则两侧字节天然不同（假红）
  let seqA = 0, seqB = 0
  const idA = () => 'mem_' + String(++seqA).padStart(32, '0')
  const idB = () => 'mem_' + String(++seqB).padStart(32, '0')
  const storeA = new MemoryDocumentStore({
    fs: a.fsApi,
    idFactory: idA,
    mutationAdmission: (file) => ({ ...ADMIT(a.dir), target: path.resolve(file) }),
  })
  const storeB = new MemoryDocumentStore({ fs: b.fsApi, idFactory: idB })
  const ra = await storeA.append(path.join(a.dir, 'MEMORY.md'), '- 追加一行')
  const rb = await storeB.append(path.join(b.dir, 'MEMORY.md'), '- 追加一行')
  const bytesA = fs.readFileSync(path.join(a.dir, 'MEMORY.md'))
  const bytesB = fs.readFileSync(path.join(b.dir, 'MEMORY.md'))
  ok(ra.ok === true && rb.ok === true, '③ 两侧 append 均成功')
  ok(bytesA.equals(bytesB), '★ ③ 落盘字节逐字节相同（接线不改变正常路径行为）')
  ok(ra.digest === rb.digest, '★ ③ 返回 digest 相同（实 ' + String(ra.digest).slice(0, 12) + ' / ' + String(rb.digest).slice(0, 12) + '）')
  // replace 同样对照
  const ra2 = await storeA.replace(path.join(a.dir, 'MEMORY.md'), ['新记录一', '新记录二'])
  const rb2 = await storeB.replace(path.join(b.dir, 'MEMORY.md'), ['新记录一', '新记录二'])
  ok(ra2.ok === true && rb2.ok === true, '③ 两侧 replace 均成功')
  ok(fs.readFileSync(path.join(a.dir, 'MEMORY.md')).equals(fs.readFileSync(path.join(b.dir, 'MEMORY.md'))), '★ ③ replace 落盘字节逐字节相同')
}

// ══════════════════════════════════════════════════════════════
console.log('[④] 向后兼容：不传 admission ⇒ 不做根校验（行为与改动前一致）')
// ══════════════════════════════════════════════════════════════
{
  const cap = junctionCapable(mkroot('cap4'))
  if (!cap.ok) { console.error('  !! junction 不可用 ⇒ 本组跳过（如实计 FAIL）'); fail++ } else {
    const { admitted, outside, link } = fixture('compat')
    fs.writeFileSync(path.join(admitted, 'MEMORY.md'), 'A\n', 'utf8')
    const { MemoryDocumentStore } = await loadWriter()
    const store = new MemoryDocumentStore({})
    // 直接写「junction 指向的当前目标」：不接线时按 lexical 行为解析（这里是 admitted）
    const r1 = await store.append(path.join(link, 'MEMORY.md'), '- 兼容写入')
    ok(r1 && r1.ok === true, '④ 无 admission 时写入成功（不因新增校验而改变既有行为）')
    ok(String(readIf(path.join(admitted, 'MEMORY.md'))).includes('兼容写入'), '④ 内容落在 junction 当前目标（admitted-root）')
    ok(readIf(path.join(outside, 'MEMORY.md')) === null, '④ outside-root 未受影响')
  }
}

// ══════════════════════════════════════════════════════════════
console.log('[⑤] 负路径（真变异）：去掉写盘前复核 ⇒ outside-root 又被写入')
// ══════════════════════════════════════════════════════════════
{
  const cap = junctionCapable(mkroot('cap5'))
  if (!cap.ok) { console.error('  !! junction 不可用 ⇒ 本组跳过（如实计 FAIL）'); fail++ } else {
    // 变异：把 rename 前的复核与入队时的复核都摘掉（等价于 #263 未修）
    const mut = await loadWriter([   /* anchors below */
      // ① 摘掉 rename 前的复核（源码该行缩进 8 空格）
      ['        if (this._rootGuard) {', '        if (false) {'],
      // ② 摘掉边界层的复核（源码该两行缩进 6 空格）
      ['      const guard = targetAliasStablePre(file, aliasPin)', '      const guard = { ok: true, guarded: false }'],
      ['      if (!guard.ok) throw memoryPathEscapedError(file, guard.physical)', '      if (false) throw memoryPathEscapedError(file, guard.physical)'],
    ])
    const { admitted, outside, link } = fixture('negative')
    fs.writeFileSync(path.join(admitted, 'MEMORY.md'), '原始内容\n', 'utf8')
    const barrier = mkBarrier()
    const store = new mut.MemoryDocumentStore({
      fs: barrierFs(barrier),
      mutationAdmission: (file) => ({ ...ADMIT(link), target: path.resolve(file) }),
    })
    fs.writeFileSync(path.join(outside, 'MEMORY.md'), '根外的旧内容\n', 'utf8')
    const flight = store.append(path.join(link, 'MEMORY.md'), '- 越界写入尝试').then((r) => ({ result: r }), (e) => ({ error: e }))
    await barrier.arrived
    fs.unlinkSync(link)
    fs.symlinkSync(outside, link, 'junction')
    barrier.resume()
    await flight
    const outsideAfter = readIf(path.join(outside, 'MEMORY.md'))
    ok(!!outsideAfter && outsideAfter.includes('越界写入尝试'),
      '★ ⑤ 变异后 outside-root **被写入**（缺陷复现）⇒ 判据有鉴别力（实 ' + JSON.stringify(String(outsideAfter).slice(0, 40)) + '）')
    ok(readIf(path.join(admitted, 'MEMORY.md')) === '原始内容\n',
      '★ ⑤ 变异后 admitted-root 原文件不变（正是报告者实测到的现象）')
  }
}

console.log('\n结果: ' + pass + ' PASS / ' + fail + ' FAIL')
for (const d of tmps) { try { fs.rmSync(d, { recursive: true, force: true }) } catch (_) {} }
process.exit(fail ? 1 : 0)
