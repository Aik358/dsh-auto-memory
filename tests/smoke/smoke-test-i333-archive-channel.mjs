#!/usr/bin/env node
/**
 * smoke-test-i333-archive-channel.mjs —— #333② 归档取回通道（2026-10-13）
 *
 * 背景（用户拍板）：
 *   30 天前的旧日志被 maintain 移入 archive/ 后，**archive/ 不在 memory_recall 的常规扫描清单里**
 *   —— 这是有意的「冷存储」分层（纳入会让检索面随文件数无界增长，并让已蒸馏的陈旧细节污染语义唤回）。
 *   但退出自动面 ≠ 不可取回：此前 AI 侧**没有任何入口**能读回归档原文（单向门）。
 *   本批补两个通道，并把入口写进指针与铭文。
 *
 * 判据（CR-10）：**真执行产线代码**（真 import 引擎 → 真 new → 真调方法），断言返回值与磁盘副作用；
 *   每条带负路径；并做变异反向验证（改坏产物 ⇒ 必红）。
 *
 * 通道：
 *   A. listArchivePre(agent)             —— 列归档目录（文件名/字节/日期）
 *   B. readArchivePre(agent, name)       —— 取单文件全文；**必须防目录穿越**
 *   C. recall(q, limit, agent, 'archive') —— 按关键词搜归档；命中给「文件名 + 命中行」
 */
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdtempSync, rmSync, mkdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import pathModule from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// ★2026-10-13 #344：URL.pathname 百分号编码（中文/空格）⇒ 路径不存在。改用 fileURLToPath。
const ROOT = pathModule.join(pathModule.dirname(fileURLToPath(import.meta.url)), '..', '..')
let pass = 0, fail = 0
const ok = (c, n, d) => { if (c) { pass++; console.log('  ok - ' + n) } else { fail++; console.log('  FAIL - ' + n + (d ? ' :: ' + d : '')) } }

const tmp = mkdtempSync(pathModule.join(tmpdir(), 'i333arch-'))
const cleanup = () => { try { rmSync(tmp, { recursive: true, force: true }) } catch (_) {} }
process.on('exit', cleanup); process.on('uncaughtException', (e) => { cleanup(); console.error(e); process.exit(1) })
process.on('SIGINT', () => { cleanup(); process.exit(130) }); process.on('SIGTERM', () => { cleanup(); process.exit(143) })

// ── 真执行产线代码：类定义未导出 ⇒ 用 vm 执行**真实源码中的 class 声明**（不是桩、不是静态断言）──
import vm from 'node:vm'
const SRC = readFileSync(pathModule.join(ROOT, 'lib', 'index.js'), 'utf8')
const clsStart = SRC.indexOf('class MemoryEngine {')
assert.ok(clsStart > 0, '抽取：class MemoryEngine 定义命中（行尾无关）')
// 抽取**两个归档方法所在的类体片段**并 vm 执行。
// ★三个坑（逐个踩过）：① 类未导出 ⇒ 只能抽源码真跑；② 花括号计数会被类内模板串里的 { } 干扰；
//   ③ 行级「顶格行」判定也不可靠 —— 该文件里**存在比类更顶格的既有残行**（如某处 `this._readError =` 顶格），
//   会把边界切在十几行处。故改为**按方法自身的正面锚点取区间**：从 `async listArchivePre(` 到
//   下一个类内成员的起始（行首 2 空格 + 关键字），保证切出的片段是完整可执行的方法。
const mStart = SRC.indexOf('  async listArchivePre(agent) {')
assert.ok(mStart > 0, '抽取：listArchivePre 定义命中')
// 终点锚：readArchivePre 的方法体结束（行首 2 空格 + `}` 后紧跟空行）——用「下一个 2 空格缩进的成员起始」更稳
const afterStart = SRC.slice(mStart)
const stopRe = /\n  (?:async\s+)?[a-zA-Z_$][\w$]*\s*\(/g
const all = []
let mm
while ((mm = stopRe.exec(afterStart)) !== null) all.push(mm)
// all[0] = listArchivePre 自身签名；all[1] = readArchivePre 自身签名；all[2] = 其后的下一个成员。
assert.ok(all.length >= 3, '抽取：找到足够多的类成员起点（含终点锚）', 'found=' + all.length)
const clsSrc = afterStart.slice(0, all[2].index)
assert.ok(clsSrc.includes('listArchivePre') && clsSrc.includes('readArchivePre'),
  '抽取：片段同时覆盖 listArchivePre 与 readArchivePre（区间边界正确）',
  'len=' + clsSrc.length)
// 包成类再 vm 执行（片段是「类内成员」，需要有宿主对象才合法）
const wrapSrc = 'class T {\n' + clsSrc.replace(/^  /gm, '  ') + '\n}' + '\nT'
ok(/listArchivePre\s*\(/.test(clsSrc) && /readArchivePre\s*\(/.test(clsSrc), '真执行：类体内确实含两个归档方法（此前是单向门）')
const Engine = vm.runInNewContext(wrapSrc, { console, setTimeout, clearTimeout, process, path: pathModule, readdir: (await import('node:fs/promises')).readdir, stat: (await import('node:fs/promises')).stat })
ok(typeof Engine === 'function', '真执行：vm 跑出可 new 的 MemoryEngine（不是静态断言）', typeof Engine)

/** 造一个把 projectDir 指向隔离树的最小引擎（只覆盖被测方法用到的解析面）。 */
function makeEngine(projDir) {
  const eng = new Engine()
  eng.configLoaded = true
  eng.resolvePaths = async () => ({ projectDir: projDir, notesPath: pathModule.join(projDir, 'MEMORY.md'), userFile: pathModule.join(projDir, 'USER.md'), reflectDir: pathModule.join(projDir, 'reflections') })
  eng.readTextSafe = async (f) => { try { return readFileSync(f, 'utf8') } catch (_) { return '' } }
  return eng
}

// ═══ A. listArchivePre ═══
{
  const proj = pathModule.join(tmp, 'a'); const arch = pathModule.join(proj, 'archive')
  mkdirSync(arch, { recursive: true })
  writeFileSync(pathModule.join(arch, '2026-01-01.md'), '# 一月\n- 记录甲\n', 'utf8')
  writeFileSync(pathModule.join(arch, '2026-02-02.md'), '# 二月\n- 记录乙\n', 'utf8')
  writeFileSync(pathModule.join(arch, 'notes.txt'), '非 md 不应出现', 'utf8')
  mkdirSync(pathModule.join(arch, 'sub.md'), { recursive: true })   // 目录名带 .md ⇒ 不得当成文件
  const eng = makeEngine(proj)
  const r = await eng.listArchivePre(null)
  ok(Array.isArray(r.files) && r.files.length === 2, 'A1 只列 .md **文件**（排除 .txt 与同名目录）', JSON.stringify(r.files.map((f) => f.name)))
  ok(r.files[0].name === '2026-01-01.md' && r.files[1].name === '2026-02-02.md', 'A2 按文件名升序', JSON.stringify(r.files.map((f) => f.name)))
  ok(r.files.every((f) => f.bytes > 0 && /^\d{4}-\d{2}-\d{2}$/.test(f.mtime)), 'A3 每项含 bytes 与 mtime（可复算）', JSON.stringify(r.files[0]))
  ok(r.dir === arch, 'A4 返回归档目录绝对路径', r.dir)

  // 负路径：目录不存在 ⇒ 返回空表而不是抛/编造
  const eng2 = makeEngine(pathModule.join(tmp, 'a-none'))
  const r2 = await eng2.listArchivePre(null)
  ok(Array.isArray(r2.files) && r2.files.length === 0, 'A5 负路径：归档目录不存在 ⇒ 空表（不抛、不编造）', JSON.stringify(r2))
}

// ═══ B. readArchivePre ═══
{
  const proj = pathModule.join(tmp, 'b'); const arch = pathModule.join(proj, 'archive')
  mkdirSync(arch, { recursive: true })
  const SECRET = '*** 穿越标记 SECRET-OUTSIDE ***'
  writeFileSync(pathModule.join(proj, 'OUTSIDE.md'), SECRET, 'utf8')
  writeFileSync(pathModule.join(arch, '2026-01-01.md'), '# 一月\n- 唯一标记 ALPHA-TOKEN\n', 'utf8')
  const eng = makeEngine(proj)

  const r = await eng.readArchivePre(null, '2026-01-01.md')
  ok(r.ok === true && r.text.includes('ALPHA-TOKEN'), 'B1 正常取回：读到归档全文', r.ok + ' len=' + (r.text || '').length)
  ok(String(r.file).startsWith(arch), 'B2 返回的物理路径确在 archive/ 内', r.file)

  // ★负路径：目录穿越必须被拒（且**不得**读到外部文件）
  for (const bad of ['../OUTSIDE.md', '..\\OUTSIDE.md', '/etc/passwd.md', 'sub/2026-01-01.md', '..', '.', '']) {
    const rb = await eng.readArchivePre(null, bad)
    ok(rb.ok === false, 'B3 负路径：拒绝非法 name ' + JSON.stringify(bad), JSON.stringify(rb).slice(0, 90))
    ok(!String(rb.text || '').includes('SECRET-OUTSIDE'), 'B3b 负路径：确未泄露 archive 外内容 ' + JSON.stringify(bad))
  }
  // 负路径：合法形态但不存在
  const rn = await eng.readArchivePre(null, '2020-09-09.md')
  ok(rn.ok === false, 'B4 负路径：文件不存在 ⇒ ok:false（不静默给空串当成功）', JSON.stringify(rn).slice(0, 90))
}

// ═══ C. recall 的 archive 分支（真执行抽出的源码段）═══
// 该类未导出，故抽出**分支自身**再真跑：该分支自包含 —— 只用到 q / terms / limit / this.resolvePaths / this.readTextSafe，
// 不触碰 recall 的其余 400 行（别名归一、语义臂、L0 投影等），是可信的最小可执行单元。
// 边界锚：起 = `    if (scope === 'archive') {`（4 空格缩进），终 = 其后第一个 `    }`（4 空格）——
//   分支内所有花括号均为 6 空格以上缩进，故该终点锚唯一且不受模板串里的 { } 干扰。
const ARCHIVE_BRANCH = (() => {
  const start = SRC.indexOf("    if (scope === 'archive') {")
  assert.ok(start > 0, '抽取：recall 的 archive 分支起点命中')
  const end = SRC.indexOf('\n    }', start)
  assert.ok(end > start, '抽取：archive 分支终点命中（4 空格缩进的闭合括号）')
  const seg = SRC.slice(start, end + '\n    }'.length)   // ★补回闭合括号（end 指向 \n，不含 }）
  assert.ok(seg.includes("[记忆检索|archive]"), '抽取：片段确为 archive 分支（含其专属标签）')
  return seg.replaceAll("'./recall-passages.js'", JSON.stringify(new URL('../../lib/recall-passages.js', import.meta.url).href))
})()
/** 真执行该分支：把分支体包成函数，传入分支所需的最小上下文。 */
const callArchiveBranch = async (self, query, limit) => {
  // 条件里的 `scope` 是外层变量 ⇒ 执行前把 `if (scope === 'archive') {` 换成 `if (true) {`。
  // ★但先断言该条件**恰命中 1 次** —— 否则就变成「测了个别的分支」。
  assert.equal(ARCHIVE_BRANCH.split("if (scope === 'archive') {").length - 1, 1, '执行前：分支条件恰命中 1 次')
  const body = ARCHIVE_BRANCH.replace("if (scope === 'archive') {", 'if (true) {').replace(/^    /gm, '')
  // 分支用到的自由变量（逐个列出并在调用处传入，缺一个就是 ReferenceError —— 逐个补齐）
  const fn = new Function('self', 'path', 'readdir', 'q', 'terms', 'limit', 'agent', 'readFile', 'readFailures', 'opts',
    'return (async () => {\n' + body + '\n})()')
  const q = String(query || '').toLowerCase().trim()
  const terms = q.split(/[\s,，、;；。:：]+/).filter((x) => x.length > 0)
  return fn.call(self, self, pathModule, (await import('node:fs/promises')).readdir, q, terms, limit, null, (await import('node:fs/promises')).readFile, [], null)
}

{
  const proj = pathModule.join(tmp, 'c'); const arch = pathModule.join(proj, 'archive')
  mkdirSync(arch, { recursive: true })
  writeFileSync(pathModule.join(arch, '2026-01-01.md'), '# 一月\n- 命中了 GAMMA-TOKEN 这一行\n- 无关行\n', 'utf8')
  writeFileSync(pathModule.join(arch, '2026-02-02.md'), '# 二月\n- 完全没有关键词\n', 'utf8')
  const eng = makeEngine(proj)
  const ra = await callArchiveBranch(eng, 'GAMMA-TOKEN', 8)
  ok(/\[记忆检索\|archive\]/.test(ra), 'C1 scope=archive 走归档通道（带标签）', ra.slice(0, 60))
  ok(ra.includes('2026-01-01.md'), 'C2 命中的是含 token 的那个归档文件', ra.slice(0, 200))
  ok(!ra.includes('2026-02-02.md'), 'C2b 不含 token 的归档文件不出现（命中确实按内容）')
  ok(/memory_read\(kind="archive"/.test(ra), 'C3 ★命中里给出**取全文**的下一步命令（两段式）', ra.slice(0, 260))
  const rn = await callArchiveBranch(eng, 'ZZZ-NOT-PRESENT-TOKEN', 8)
  ok(/未命中/.test(rn), 'C5 负路径：无命中 ⇒ 如实说明', rn.slice(0, 120))
  const eng2 = makeEngine(pathModule.join(tmp, 'c-none'))
  const rn2 = await callArchiveBranch(eng2, 'anything', 8)
  ok(/暂无归档文件|未命中/.test(rn2), 'C6 负路径：无 archive 目录 ⇒ 如实说明', rn2.slice(0, 140))
}

console.log('\n结果: ' + pass + ' PASS / ' + fail + ' FAIL')
cleanup()
process.exit(fail ? 1 : 0)
