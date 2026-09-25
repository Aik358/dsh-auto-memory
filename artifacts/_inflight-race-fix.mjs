#!/usr/bin/env node
/**
 * _inflight-race-fix.mjs —— 修两个同源缺陷（2026-09-26 用户报障「一下子派出去三四十个子代理」）
 *
 * ## 缺陷 ①：并发闸门 TOCTOU 竞态（事故直接根因）
 *   旧序：`if (inflight >= 3) return` ——(E2 归属门，含 `await this._readWorkbench()`)——`inflight++`
 *   ⇒ 闸门检查与占位自增之间**存在 await**：同一 tick 内到达的多个调用方**全部**看到 inflight<3 而放行，
 *     随后集体在 await 处挂起、再集体自增。
 *   实测：`dsh-auto-memory-diagnose.log` 中 `inflight=3 → 7 → 40 → 41`（111 ms 内），值 41 出现 940 次。
 *   对照：E2 前备份 `lib/index.js.bak-20260925-215502-e2` 闸门与自增相隔 27 行、**区间内零 await** ⇒ 原子。
 *   处方：闸门通过后立即同步自增占位；所有提前返回路径与 finally 统一经 `_wbReleaseInflight()` 幂等释放。
 *
 * ## 缺陷 ②：原子写的 tmp 名固定（与 config-io 已修过的 #82 同型，第三次现身）
 *   三处手写 `f + '.dam-tmp'`：并发写同一目标时先完成者把 tmp rename 走，后到者 rename 抛 ENOENT。
 *   实测：`workbench state write failed: ENOENT … rename '…workbench.json.dam-tmp'`。
 *   处方：三处改用 `config-io.js` 的 `writeTextAtomicPre`（tmp 名带 pid+序号唯一段 + 瞬态 rename 退避重试）。
 *
 * ## 结构：严格两阶段（阶段一零变异；阶段一全绿才允许进入阶段二）
 *   阶段一对**全部**锚点与顺序做校验并落定最终索引，任一不过即 fail-closed 退出（不写盘）。
 *   阶段二按索引**降序**应用，避免插入导致索引漂移。
 *
 * 用法：node artifacts/_inflight-race-fix.mjs --dry   （预演，跑完阶段二断言与语法检查后退出）
 *       node artifacts/_inflight-race-fix.mjs         （正式写入）
 */
import fs from 'node:fs'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'

const FILE = 'lib/index.js'
const DRY = process.argv.includes('--dry')

const raw0 = fs.readFileSync(FILE, 'utf8')
const sha0 = crypto.createHash('sha256').update(raw0, 'utf8').digest('hex')
const eol = raw0.includes('\r\n') ? '\r\n' : '\n'
const crlf0 = (raw0.match(/\r\n/g) || []).length
const bareLF0 = (raw0.match(/(?<!\r)\n/g) || []).length
const orig = raw0.split(eol)

let P = 0, F = 0
const ck = (ok, msg) => { ok ? P++ : F++; console.log((ok ? '  PASS  ' : '  FAIL  ') + msg) }
const trimEq = (l, t) => l.trim() === t
const findBy = (arr, pred) => { const h = []; for (let i = 0; i < arr.length; i++) if (pred(arr[i], i)) h.push(i); return h }
const eq = (t) => (l) => trimEq(l, t)
const inc = (s) => (l) => l.trim().includes(s)

console.log('═══ _inflight-race-fix · ' + (DRY ? 'DRY RUN（不写盘）' : '正式写入') + ' ═══')
console.log('  EOL=' + (eol === '\r\n' ? 'CRLF' : 'LF') + '  CRLF=' + crlf0 + '  bareLF=' + bareLF0 + '  行数=' + orig.length)
console.log('  SHA256(前)=' + sha0)

/* ═══════════ 阶段一：全量校验（零变异） ═══════════ */
console.log('\n─── 阶段一：锚点校验与索引落定 ───')

console.log('\n[0] 新标识符唯一性（防撞名）')
ck(findBy(orig, inc('_wbReleaseInflight')).length === 0, '_wbReleaseInflight 原本不存在')
ck(findBy(orig, inc('_wbInflightHeld')).length === 0, '_wbInflightHeld 原本不存在')

console.log('\n[1] 缺陷① 闸门 TOCTOU 竞态')
const gate = findBy(orig, eq('if (this._subagentInflight >= 3) {'))
ck(gate.length === 1, '闸门行唯一命中（实际 ' + gate.length + '）')
const gi = gate[0]
let gEnd = -1
for (let i = gi + 1; i < orig.length; i++) if (orig[i].trim() === '}') { gEnd = i; break }
ck(gEnd > gi && gEnd - gi <= 4, '闸门块边界可定（行 ' + (gi + 1) + '..' + (gEnd + 1) + '，共 ' + (gEnd - gi + 1) + ' 行）')
ck(gEnd + 1 < orig.length && orig[gEnd + 1].trim() !== '}', '闸门块后不是另一块收尾（插入位置安全）')

const incr = findBy(orig, eq('this._subagentInflight = (this._subagentInflight || 0) + 1'))
ck(incr.length === 1, '原自增语句唯一命中（实际 ' + incr.length + '）')
const ii = incr[0]
const awaitBetween = []
for (let i = gi; i < ii; i++) if (/\bawait\b/.test(orig[i])) awaitBetween.push(i + 1)
ck(awaitBetween.length >= 1, '★闸门与自增之间存在 await（竞态实证，行 ' + awaitBetween.join(',') + '）')
const rw = findBy(orig, eq('const _wbGateSt = await this._readWorkbench()'))
ck(rw.length === 1, '_readWorkbench 调用唯一命中（实际 ' + rw.length + '）')
ck(rw[0] > gi && rw[0] < ii, '★_readWorkbench 落在闸门与自增之间（E2 引入的 await 确认）')

// ★关键事实（本轮取证纠正）：三条早退当前位于**自增之前**（闸门后 55 行区间内）。
//   故「把自增上移到闸门后」这一动作**恰好**使它们变成需要释放的路径 —— 释放点必须一次配齐。
const early = [
  { sub: "diag('subagent ' + label + ' skipped: incomplete parent context')", ind: '      ', name: 'parent 不完整早退' },
  { sub: "diag('subagent ' + label + ' rejected: owner='", ind: '          ', name: 'E2 owner 拒绝早退' },
  { sub: "diag('subagent ' + label + ' rejected: epoch-token mismatch", ind: '          ', name: 'E2 期牌错位早退' },
]
const earlyIdx = []
for (const e of early) {
  const h = findBy(orig, inc(e.sub))
  ck(h.length === 1, e.name + ' 唯一命中（实际 ' + h.length + '）')
  if (h.length === 1) {
    earlyIdx.push(h[0])
    ck(h[0] > gi && h[0] < ii, '  ' + e.name + ' 位于闸门与自增之间（行 ' + (h[0] + 1) + '，' + (gi + 1) + '<x<' + (ii + 1) + '）')
    ck(orig[h[0] + 1] !== undefined && orig[h[0] + 1].trim() === "return ''", '  其后紧跟 return \'\'（插入点正确）')
  }
}
ck(earlyIdx.length === 3, '三条早退全部定位成功（实际 ' + earlyIdx.length + '）')

// 闸门自身的 return ''（不需要释放，因为占位自增尚未执行）——用于反向断言
const gateOwnReturn = findBy(orig, (l, i) => i > gi && i < gi + 4 && l.trim() === "return ''")
ck(gateOwnReturn.length === 1, '闸门自身 return \'\' 唯一命中（实际 ' + gateOwnReturn.length + '，该路径无需释放）')

const startCall = findBy(orig, inc('run = await subagents.start(providerName'))
ck(startCall.length === 1, 'subagents.start 调用唯一命中（实际 ' + startCall.length + '）')
ck(startCall[0] > ii, 'subagents.start 位于自增之后（行 ' + (startCall[0] + 1) + ' > ' + (ii + 1) + '）')

// 计数守恒：函数起点 → start 之间，闸门后·自增前的 return '' 条数 = 早退数（+1 闸门自身）
const fnStart = findBy(orig, inc('async runSubagent('))
ck(fnStart.length === 1, 'runSubagent 函数起点唯一命中（实际 ' + fnStart.length + '）')
const returnsBetween = findBy(orig, (l, i) => i > gi && i < ii && l.trim() === "return ''")
ck(returnsBetween.length === early.length + 1,
  '★闸门→自增区间内 return \'\' 共 ' + (early.length + 1) + ' 条（闸门自身 1 + 早退 ' + early.length + '），实际 ' + returnsBetween.length)
const needRelease = returnsBetween.filter((r) => !gateOwnReturn.includes(r))
ck(needRelease.length === early.length, '★其中需释放 ' + early.length + ' 条（排除闸门自身），实际 ' + needRelease.length)
// earlyIdx 是 diag 行索引，return 在其下一行 ⇒ 集合比对须做偏移
ck(needRelease.every((r) => earlyIdx.map((x) => x + 1).includes(r)), '★每条需释放的早退都有对应释放点（无遗漏）')
ck(earlyIdx.every((x) => needRelease.includes(x + 1)), '★反向：每个释放点都对应一条真实早退（无多余）')

const fin = findBy(orig, eq('this._subagentInflight = Math.max(0, (this._subagentInflight || 1) - 1)'))
ck(fin.length === 1, 'finally 递减语句唯一命中（实际 ' + fin.length + '）')
const finIdx = fin[0]
ck(finIdx > ii, 'finally 递减位于自增之后（行 ' + (finIdx + 1) + '）')
// } finally { 全文件多处 ⇒ 只断言「递减语句的上一行是 } finally {」
ck(orig[finIdx - 1] !== undefined && orig[finIdx - 1].trim() === '} finally {',
  '递减语句紧跟在 } finally { 之后（定位正确）')
// 自增之后、finally 之前的 catch 内 return '' —— 由 finally 覆盖，无需另插释放
const catchReturns = findBy(orig, (l, i) => i > ii && i < finIdx && l.trim() === "return ''")
ck(catchReturns.length === 2, '自增→finally 区间内 catch 的 return \'\' 共 2 处（由 finally 覆盖），实际 ' + catchReturns.length)

console.log('\n[2] 缺陷② 固定名 .dam-tmp')
const a1 = findBy(orig, eq("const tmp = abs + '.dam-tmp'"))
ck(a1.length === 1, '导入循环 tmp 行唯一命中（实际 ' + a1.length + '）')
if (a1.length === 1) {
  const i = a1[0]
  ck(orig[i + 1] !== undefined && trimEq(orig[i + 1], "await writeFile(tmp, text, 'utf8')"), '  后一行是 writeFile(text)')
  ck(orig[i + 2] !== undefined && trimEq(orig[i + 2], 'await rename(tmp, abs)'), '  再后一行是 rename')
}
const b1 = findBy(orig, eq("const tmp = f + '.dam-tmp'"))
ck(b1.length === 2, '固定名 tmp（f 形）共 2 处（summary + workbench），实际 ' + b1.length)
let sumIdx = -1, wbIdx = -1
if (b1.length === 2) {
  for (const h of b1) {
    if (orig[h - 1] !== undefined && trimEq(orig[h - 1], 'const f = this._wsSummaryFile()')) sumIdx = h
    if (orig[h - 1] !== undefined && trimEq(orig[h - 1], 'await mkdir(path.dirname(f), { recursive: true })')) wbIdx = h
  }
  ck(sumIdx > 0, '  第 1 处上下文 = _wsSummaryFile（summary 写）')
  ck(wbIdx > 0, '  第 2 处上下文 = mkdir（workbench 写）')
  if (sumIdx > 0) {
    ck(trimEq(orig[sumIdx + 1], "await writeFile(tmp, JSON.stringify(merged.summary, null, 2), 'utf8')"), '  summary 写形态吻合')
    ck(trimEq(orig[sumIdx + 2], 'await rename(tmp, f)'), '  summary rename 吻合')
  }
  if (wbIdx > 0) {
    ck(trimEq(orig[wbIdx + 1], "await writeFile(tmp, JSON.stringify(st, null, 2), 'utf8')"), '  workbench 写形态吻合')
    ck(trimEq(orig[wbIdx + 2], 'await rename(tmp, f)'), '  workbench rename 吻合')
  }
}
const tmpLiteral0 = findBy(orig, inc('.dam-tmp'))
ck(tmpLiteral0.length === 4, '.dam-tmp 字面量共 4 处（1 过滤正则 + 3 写入点），实际 ' + tmpLiteral0.length)
const nonWrite = tmpLiteral0.filter((i) => ![a1[0], sumIdx, wbIdx].includes(i))
ck(nonWrite.length === 1, '  除 3 个写入点外仅剩 1 处（应为过滤正则），实际 ' + nonWrite.length)
if (nonWrite.length === 1) ck(orig[nonWrite[0]].includes('continue'), '  该残留是备份/临时文件过滤规则（无害）')
const atomic0 = findBy(orig, inc('await writeTextAtomicPre('))
ck(atomic0.length === 1, '现有 writeTextAtomicPre 调用 1 处（配置写），实际 ' + atomic0.length)

const phase1Fail = F
console.log('\n  阶段一：PASS=' + P + ' / FAIL=' + phase1Fail)
if (phase1Fail) {
  console.log('  ★阶段一未全过 ⇒ fail-closed，不进入阶段二、不写盘')
  process.exit(1)
}
console.log('  ★阶段一全绿 ⇒ 进入阶段二')

/* ═══════════ 阶段二：按索引降序应用 ═══════════ */
console.log('\n─── 阶段二：应用补丁 ───')
const lines = orig.slice()

// 按索引从大到小处理，任何插入都不影响尚未处理的小索引
const ops = []
// op1：finally 递减 → 幂等释放
ops.push({ at: finIdx, del: 1, ins: ['      _wbReleaseInflight()'], tag: 'finally 释放' })
// op2：三条早退各插一行
for (let k = 0; k < earlyIdx.length; k++) ops.push({ at: earlyIdx[k] + 1, del: 0, ins: [early[k].ind + '_wbReleaseInflight()'], tag: early[k].name + ' 释放' })
// op3：workbench 原子写（del 4：mkdir + tmp + write + rename）
ops.push({ at: wbIdx - 1, del: 4, ins: [
  '      const wr = await writeTextAtomicPre(f, JSON.stringify(st, null, 2))',
  "      if (!wr || wr.ok !== true) throw new Error((wr && wr.error) || 'atomic write failed')",
], tag: 'workbench 原子写' })
// op4：summary 原子写（del 3：tmp + write + rename）
ops.push({ at: sumIdx, del: 3, ins: [
  '        const wr = await writeTextAtomicPre(f, JSON.stringify(merged.summary, null, 2))',
  "        if (!wr || wr.ok !== true) throw new Error((wr && wr.error) || 'atomic write failed')",
], tag: 'summary 原子写' })
// op5：导入循环原子写（del 3）
ops.push({ at: a1[0], del: 3, ins: [
  '        const wr = await writeTextAtomicPre(abs, text)',
  "        if (!wr || wr.ok !== true) throw new Error((wr && wr.error) || 'atomic write failed')",
], tag: '导入循环原子写' })
// op6：自增语句 → 注释（del 1）
ops.push({ at: ii, del: 1, ins: ['      // ★2026-09-26：占位自增已上移到并发闸门处（保证闸门原子），此处不再自增。'], tag: '自增语句降级为注释' })
// op7：闸门块后插入占位自增 + 释放器（del 0）
const gateBlock = [
  '    // ★2026-09-26 回归修复（inflight 竞态）：**闸门检查与占位自增之间不得出现任何 await**。',
  '    //   旧序只检查、自增被推迟到下方 try 之前 ⇒ 同一 tick 内到达的多个调用方全部看到 inflight<3 而放行，',
  '    //   随后集体在 E2 归属门的 await 处挂起、再集体自增。实测一次爆发 40+（日志 inflight=3→7→40→41，111 ms）。',
  '    //   处方：闸门通过后**立即**同步自增占位；所有提前返回路径与 finally 都经 _wbReleaseInflight 幂等释放。',
  '    let _wbInflightHeld = true',
  '    this._subagentInflight = (this._subagentInflight || 0) + 1',
  '    const _wbReleaseInflight = () => {',
  '      if (!_wbInflightHeld) return',
  '      _wbInflightHeld = false',
  '      this._subagentInflight = Math.max(0, (this._subagentInflight || 1) - 1)',
  '    }',
]
ops.push({ at: gEnd + 1, del: 0, ins: gateBlock, tag: '闸门原子化（占位自增 + 释放器）' })

ops.sort((a, b) => b.at - a.at)
let applied = 0
for (const op of ops) {
  const before = lines[op.at] === undefined ? '(EOF)' : lines[op.at].trim().slice(0, 60)
  lines.splice(op.at, op.del, ...op.ins)
  applied++
  console.log('  · ' + op.tag + '  @行' + (op.at + 1) + '  del=' + op.del + ' ins=' + op.ins.length + '  原: ' + before)
}
ck(applied === ops.length, '全部 ' + ops.length + ' 个补丁已应用')

const out = lines.join(eol)

console.log('\n[3] 阶段二断言与守恒')
const crlf1 = (out.match(/\r\n/g) || []).length
const bareLF1 = (out.match(/(?<!\r)\n/g) || []).length
ck(bareLF1 === 0, 'bareLF 仍为 0（EOL 性质不变），实际 ' + bareLF1)
ck(crlf1 > 0, 'CRLF 计数 > 0，实际 ' + crlf1)
ck(out.includes('_wbReleaseInflight'), '新释放器已落盘')

const outL = out.split(eol)
const incAfter = findBy(outL, eq('this._subagentInflight = (this._subagentInflight || 0) + 1'))
ck(incAfter.length === 1, '★全文件仅剩 1 处自增（闸门处），实际 ' + incAfter.length)
const relAfter = findBy(outL, eq('_wbReleaseInflight()'))
ck(relAfter.length === 4, '★释放调用 4 处（3 早退 + 1 finally），实际 ' + relAfter.length)
const heldAfter = findBy(outL, eq('let _wbInflightHeld = true'))
ck(heldAfter.length === 1, '占位标记声明 1 处，实际 ' + heldAfter.length)
// 闸门原子性：闸门 → 自增 之间不得再有 await（★必须先剥注释——本轮补丁的注释里就写了「不得出现 await」字样）
const incAfterIdx = incAfter[0]
const gateAfter = findBy(outL, eq('if (this._subagentInflight >= 3) {'))[0]
const stripComment = (l) => {
  const t = l.trim()
  if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return ''
  return l.replace(/\/\/.*$/, '')   // 去行尾注释
}
const awaitInGate = []
for (let i = gateAfter; i < incAfterIdx; i++) if (/\bawait\b/.test(stripComment(outL[i]))) awaitInGate.push(i + 1)
ck(awaitInGate.length === 0, '★★闸门与自增之间零 await（剥离注释后；原子性恢复），越界行 ' + (awaitInGate.join(',') || '无'))
if (awaitInGate.length) for (const ln of awaitInGate) console.log('       L' + ln + ': ' + outL[ln - 1].trim().slice(0, 100))
// 自增必须早于 E2 的 await
const rwAfter = findBy(outL, eq('const _wbGateSt = await this._readWorkbench()'))[0]
ck(incAfterIdx < rwAfter, '★自增早于 E2 归属门 await（占位已生效）')

const tmpLeft = findBy(outL, inc('.dam-tmp'))
ck(tmpLeft.length === 1, '★全文件仅剩 1 处 .dam-tmp（过滤正则），实际 ' + tmpLeft.length)
if (tmpLeft.length === 1) ck(outL[tmpLeft[0]].includes('continue'), '  该残留是过滤规则（无害）')
const atomicAfter = findBy(outL, inc('await writeTextAtomicPre('))
ck(atomicAfter.length === 4, '★writeTextAtomicPre 调用 4 处（配置 + 3 新），实际 ' + atomicAfter.length)
const hardTmp = findBy(outL, (l) => /const tmp = .*\+ '\.dam-tmp'/.test(l))
ck(hardTmp.length === 0, '★手写固定名 tmp 已清零，实际 ' + hardTmp.length)
ck(out.length > raw0.length, '字符数净增 ' + (out.length - raw0.length))
ck(out !== raw0, '内容确实变化（非空补丁）')

// 语法检查
const tmpCheck = FILE + '.fixcheck.mjs'
fs.writeFileSync(tmpCheck, out, 'utf8')
let syntaxOk = false, synErr = ''
try { execFileSync(process.execPath, ['--check', tmpCheck], { stdio: 'pipe' }); syntaxOk = true } catch (e) { synErr = String(e.stderr || e.message).slice(0, 500) }
fs.rmSync(tmpCheck, { force: true })
ck(syntaxOk, 'node --check 通过（候选内容）')
if (!syntaxOk) console.log('    ' + synErr)

console.log('\n═══ 合计：PASS=' + P + ' / FAIL=' + F + ' ═══')
console.log('  SHA256(前)  =' + sha0)
console.log('  SHA256(候选)=' + crypto.createHash('sha256').update(out, 'utf8').digest('hex'))

if (F) {
  console.log('\n★仍有 FAIL ⇒ fail-closed，不写盘')
  process.exit(1)
}
if (DRY) {
  console.log('\n★DRY RUN：全部断言通过（含语法检查），未写盘')
  process.exit(0)
}
fs.writeFileSync(FILE, out, 'utf8')
const sha1 = crypto.createHash('sha256').update(fs.readFileSync(FILE, 'utf8'), 'utf8').digest('hex')
console.log('\n★已写盘   SHA256(后)=' + sha1)
console.log('  字节数 ' + Buffer.byteLength(raw0, 'utf8') + ' → ' + Buffer.byteLength(out, 'utf8'))
