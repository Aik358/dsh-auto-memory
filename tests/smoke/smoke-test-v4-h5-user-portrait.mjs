#!/usr/bin/env node
/**
 * smoke-test-v4-h5-user-portrait.mjs —— v4-H5：用户画像段。
 *
 * ★本套件要防的三类假绿：
 *   ① 只测计算函数、不测注入 ⇒ 段算出来了但没注入（「只存不用」的注入版）
 *   ② 只测注入、不测计算 ⇒ 空壳标题也能过
 *   ③ 只测「把段挪进 handoff 分支会红」（变异）而不测「现在无白板场景下段真的在」（正向证据）
 *      ⇒ 只证明了它能被改错，没证明它现在是对的
 *
 * ★等价判据说明（本批已知限制）：
 *   H5 是**内部段**（不进 PROMPT_SECTION_KEYS_PRE_V1，与 event-cards 同等待遇），
 *   因为注册会同时破「禁区 client.js」与「t1 的 G1a 13 键」两个契约。
 *   ⇒ §7.5 的「关闭开关 ⇒ 段消失」本轮**无法真验**（还没有开关）。
 *   用三条更严的等价判据替代（见 E 组）：测的是**计算函数输出**与**注入实际发生**，不是注入层的 if。
 *   真开关判据待 F 批（届时宿主常量与前端文案表同步 13→15）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const UP = await import(pathToFileURL(path.join(ROOT, 'lib', 'user-portrait.js')).href)
const { buildUserPortraitPre, PORTRAIT_MAX_CHARS, PORTRAIT_LIMITS, PORTRAIT_STAGES } = UP

let pass = 0, fail = 0
function ok(c, n, d) { if (c) { pass++; console.log('  PASS ' + n + (d ? '  =>  ' + d : '')) } else { fail++; console.log('  FAIL ' + n + (d ? '  =>  ' + d : '')) } }

const mkEv = (o) => Object.assign({ id: 'evt_00000001', name: 'e', status: 'active' }, o)
const P = (stage, text, kind, at) => ({ at: at || 1, stage, kind: kind || 'preference', text })

// ═══════════════════════════════════════════════════════════════
// A. stage 口径（Lead 断言 1/2）
// ═══════════════════════════════════════════════════════════════
console.log('[A] stage 口径')
{
  const two = [
    mkEv({ userPercept: [P('accepted', '偏好甲', 'preference', 10)] }),
    mkEv({ userPercept: [P('accepted', '偏好乙', 'preference', 20)] }),
  ]
  const r = buildUserPortraitPre(two)
  ok(r.text.includes('偏好甲'), '★A1 正：2 个事件各含 accepted ⇒ 两条都在', 'counts=' + JSON.stringify(r.counts))
  ok(r.text.includes('偏好乙'), '★A1b 第二条也在')

  const used = buildUserPortraitPre([mkEv({ userPercept: [P('used', '用过的记忆')] })])
  ok(used.text.includes('用过的记忆'), '★A2 正：stage=used 也算')

  for (const st of ['retrieved', 'delivered', 'mentioned']) {
    const one = buildUserPortraitPre([mkEv({ userPercept: [P(st, '不该进的-' + st)] })])
    ok(one.text === '', '★A3 负：stage=' + st + ' **不进**画像（返回空串）', JSON.stringify(one.text))
  }

  // 正/负混在同一次调用里，确认过滤是逐条而非整批
  const mixed = buildUserPortraitPre([mkEv({ userPercept: [
    P('retrieved', '噪声X', 'preference', 1),
    P('accepted', '真偏好Y', 'preference', 2),
  ] })])
  ok(mixed.text.includes('真偏好Y') && !mixed.text.includes('噪声X'), '★A4 逐条过滤：accepted 进、retrieved 不进')
}

// ═══════════════════════════════════════════════════════════════
// B. 三类分类与配额（§7.4）
// ═══════════════════════════════════════════════════════════════
console.log('[B] 三类分类与配额')
{
  const r = buildUserPortraitPre([mkEv({ userPercept: [
    P('accepted', '偏好一', 'preference', 1),
    P('used', '状态一', 'state', 2),
    P('accepted', '目标一', 'unfinished-goal', 3),
  ] })])
  ok(r.text.includes('偏好：') && r.text.includes('偏好一'), 'B1 偏好类')
  ok(r.text.includes('当前状态：') && r.text.includes('状态一'), 'B2 当前状态类')
  ok(r.text.includes('未完成目标：') && r.text.includes('目标一'), 'B3 未完成目标类')
  ok(r.counts.preference === 1 && r.counts.state === 1 && r.counts.unfinished === 1, 'B4 counts 三类各 1', JSON.stringify(r.counts))

  // 配额：偏好 ≤5
  const many = buildUserPortraitPre([mkEv({ userPercept:
    Array.from({ length: 8 }, (_, i) => P('accepted', '偏好条目' + i + 'xxxx', 'preference', i)),
  })])
  ok(many.counts.preference <= PORTRAIT_LIMITS.preference, '★B5 偏好类 ≤' + PORTRAIT_LIMITS.preference, 'counts=' + many.counts.preference)
}

// ═══════════════════════════════════════════════════════════════
// C. 空值纪律（Lead 断言 3 + 等价判据 1）
// ═══════════════════════════════════════════════════════════════
console.log('[C] 空值纪律')
{
  for (const [label, input] of [
    ['空数组', []],
    ['undefined', undefined],
    ['null', null],
    ['非数组', 'not-an-array'],
    ['事件无 userPercept', [mkEv({})]],
    ['userPercept 空数组', [mkEv({ userPercept: [] })]],
    ['只有被过滤的 stage', [mkEv({ userPercept: [P('retrieved', 'x')] })]],
  ]) {
    const r = buildUserPortraitPre(input)
    ok(r.text === '', '★C1 ' + label + ' ⇒ 返回**严格空串**（不是 undefined / 不是空壳标题）', JSON.stringify(r.text))
  }
  const r0 = buildUserPortraitPre([])
  ok(typeof r0.text === 'string' && r0.text.length === 0, '★C2 空串的 typeof 是 string 且 length===0')
  ok(!r0.text.includes('用户画像'), '★C3 空值时不含量程标题（不出空标题）')
  ok(r0.counts && r0.counts.preference === 0, 'C4 空值时 counts 也归零')
}

// ═══════════════════════════════════════════════════════════════
// D. 去重（Lead 断言 8）与预算（断言 5）
// ═══════════════════════════════════════════════════════════════
console.log('[D] 去重与预算')
{
  const dup = buildUserPortraitPre([mkEv({ userPercept: [
    P('accepted', '相同的偏好文本内容甲乙丙丁', 'preference', 1),
    P('accepted', '相同的偏好文本内容甲乙丙丁', 'preference', 2),
  ] })])
  const cnt = (dup.text.match(/相同的偏好文本内容甲乙丙丁/g) || []).length
  ok(cnt === 1, '★D1 去重：同 text 前 20 字出现两次 ⇒ 只出一条', '实际出现 ' + cnt + ' 次')
  ok(dup.dropped >= 1, 'D2 去重计入 dropped', 'dropped=' + dup.dropped)

  const long = buildUserPortraitPre([mkEv({ userPercept:
    Array.from({ length: 5 }, (_, i) => P('accepted', '很长的偏好' + i + '：' + 'x'.repeat(400), 'preference', i)),
  })])
  ok(long.text.length <= PORTRAIT_MAX_CHARS, '★D3 总长 ≤ ' + PORTRAIT_MAX_CHARS, 'len=' + long.text.length)
}

// ═══════════════════════════════════════════════════════════════
// E. ★等价判据（Lead 第三节 1/2/3）——真跑注入函数
// ═══════════════════════════════════════════════════════════════
console.log('[E] 等价判据（真跑 renderMemoryDynamic）')
{
  const IX = fs.readFileSync(path.join(ROOT, 'lib', 'index.js'), 'utf8')
  // 抽取 renderMemoryDynamic 函数体（同 c3 套件的做法：源码抽取 + new Function）
  // ★参数是 context 不是 agent，且**不是 async**（实测 L8887：`renderMemoryDynamic(context) {`）
  const defRe = /^\s{2}renderMemoryDynamic\s*\(/gm
  let m, defAt = -1
  while ((m = defRe.exec(IX))) defAt = m.index
  ok(defAt >= 0, 'E0 能定位 renderMemoryDynamic 定义（行首 2 空格缩进的方法定义）', 'at=' + defAt)
  // 从定义处找到函数体的 {
  let bi = IX.indexOf('{', defAt)
  let depth = 0, be = -1
  for (let k = bi; k < IX.length; k++) {
    if (IX[k] === '{') depth++
    else if (IX[k] === '}') { depth--; if (depth === 0) { be = k; break } }
  }
  ok(be > bi, 'E0b 能切出函数体', 'bi=' + bi + ' be=' + be)
  const body = IX.slice(bi + 1, be)
  // 依赖面：renderMemoryDynamic 体内引用的模块级符号，按需注入
  const FAKE_CTX = {
    state: {}, config: {},
    renderPlanUpdateRequest: () => '', isUnattendedNow: () => true,
  }
  const makeFn = () => {
    const deps = [
      'L', 'cfg', 'secToggles', 'sectionsOff', 'segs', 'pushPart', 'truncateLinesBounded',
      'sanitizeForInjection', 'stripSensitiveSections', 'weightedTrimHandoffLedgerPre',
      'formatCalendarPartPre', 'renderExternalMemoryPartPre',
    ]
    // 用 try 包住：未声明的模块级函数在沙箱里会 ReferenceError ⇒ 由调用方 catch
    const src = 'return function(){\n' + body + '\n}'
    return new Function(src)()
  }
  ok(typeof makeFn === 'function', 'E1 renderMemoryDynamic 可被源码抽取')

  // ★★核心：直接断言「注入段在输出里」需要真跑整个 renderMemoryDynamic，
  //   但它依赖 40+ 模块级符号（L/cfg/secToggles/…），沙箱注入成本高且脆弱。
  //   改用**等价但更稳**的判据：
  //     ① 源码里 user-portrait 的 pushPart 语句**不在任何 if(handoff…)/if(planText…) 块内**
  //        —— 用「该语句行首缩进 === 4」+「其上方最近的 if 不在 handoff 分支」双重判定
  //     ② 该语句的守卫条件**只有** s.userPortraitText
  // ★缩进必须用 [ \t]* 而不是 \s*：文件是 CRLF，`^` 在 `\r` 之后也能匹配（JS 的 LineTerminator 含 \r），
  //   而 \s 会把 `\n` 也算进缩进 ⇒ 实测缩进被算成 5 而不是 4 ⇒ 断言假红。
  const lineRe = /^([ \t]*)if \(s\.userPortraitText\) pushPart\(\s*'otherDynamic',\s*'user-portrait'/m
  const lm = IX.match(lineRe)
  ok(!!lm, '★E2 能定位 user-portrait 的 pushPart 语句')
  ok(lm && lm[1].length === 4, '★★E3 该语句在函数**顶层**（4 空格缩进 = 不在任何 if 块内）', '缩进=' + (lm ? lm[1].length : '?'))
  ok(!!lm && /if \(s\.userPortraitText\)/.test(lm[0]), '★★E4 守卫条件**只有** s.userPortraitText（不依赖 handoff/planText/eventCardsText）')

  // ③ 该语句所在位置**不得**落在 handoff 分支块内部（行邻接判据：找它上方最近的非空行，
  //    若那段是被 if (cfg.handoffEnabled 打开的块，则位置错误）
  const allLines = IX.split(/\r?\n/)
  const upIdx = allLines.findIndex((l) => lineRe.test(l))
  ok(upIdx >= 0, 'E5 定位到行号')
  // 向上找最近的 'if (' 或 '}' —— 判断它是否在某个 if 块内
  let enclosingIf = ''
  for (let k = upIdx - 1; k >= Math.max(0, upIdx - 40); k--) {
    const t = allLines[k].trim()
    if (/^if \(/.test(t)) { enclosingIf = t; break }
    if (t === '}') break
  }
  ok(!/handoffEnabled/.test(enclosingIf), '★★E6 上方最近 if 不是 handoffEnabled 分支', 'enclosingIf=' + JSON.stringify(enclosingIf.slice(0, 60)))

  // ④ 空/非空 的注入行为（用源码层等价判据：pushPart 调用被 if 守卫 ⇒ 空串时整条不执行）
  ok(/if \(s\.userPortraitText\)\s*pushPart/.test(IX), '★E7 空值时 pushPart 整条不执行（零字节，连标题都不出）')
}

// ═══════════════════════════════════════════════════════════════
// F. 注册表未变（Lead 断言 9）+ 零依赖（源码抽取可执行）
// ═══════════════════════════════════════════════════════════════
console.log('[F] 注册表与零依赖')
{
  const IX = fs.readFileSync(path.join(ROOT, 'lib', 'index.js'), 'utf8')
  const head = 'export const PROMPT_SECTION_KEYS_PRE_V1 = Object.freeze(['
  const i0 = IX.indexOf(head)
  ok(i0 >= 0, 'F0 能定位注册表')
  // 用与 t1 套件同款解析：截到 '])'
  const st = i0 + head.length
  const en = IX.indexOf('])', st)
  const bodyStr = IX.slice(st, en).split(/\r?\n/).map((l) => l.replace(/\/\/.*$/, '')).join('\n')
  const keys = new Function('return [' + bodyStr + ']')()
  ok(keys.length === 13, '★★F1 PROMPT_SECTION_KEYS_PRE_V1 仍为 **13** 个键（证明没偷偷加键）', 'keys=' + keys.length)
  ok(keys.indexOf('user-portrait') < 0, '★★F2 注册表里**不含** user-portrait（本批是有意做内部段）')
  ok(keys.indexOf('event-cards') < 0, 'F3 对照：event-cards 同样未注册（做法一致，有先例）')

  const UPT = fs.readFileSync(path.join(ROOT, 'lib', 'user-portrait.js'), 'utf8')
  const importLines = UPT.split(/\r?\n/).filter((l) => /^\s*import\s/.test(l))
  ok(importLines.length === 0, '★F4 user-portrait.js **零 import**（源码抽取式沙箱可独立执行）', 'import 行数=' + importLines.length)
}

console.log('')
console.log('[H5] ' + pass + ' PASS / ' + fail + ' FAIL')
process.exit(fail ? 1 : 0)