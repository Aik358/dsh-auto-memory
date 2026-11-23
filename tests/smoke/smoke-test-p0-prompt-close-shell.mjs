#!/usr/bin/env node
/**
 * 批次 K 验收：#495（close 边界）· #496（空壳标注）· #497（第 0 步空串枚举）
 *
 * CR-10 纪律：**真执行**被测逻辑，不靠「源码含某字符串」。
 *   · #497 / #495 是提示词层，判据是「提示词文本里必须存在 / 必须不存在什么」——
 *     这类判据天然是静态的，所以这里**额外**做变异验证（把修复点改回去必红）。
 *   · #496 的枚举渲染是纯逻辑，这里把它**原样搬出来真跑**（vm 执行），断言输出行内容。
 */
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const SRC = readFileSync(new URL('../../lib/index.js', import.meta.url), 'utf8')
let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ ' + m) } }

console.log('\n══ #497 · 接续仪式第 0 步必须用空 query 枚举 ══')
const step0 = (SRC.match(/'0\. ★【先确认事件归属】[^']*'/) || [''])[0]
ok(step0.length > 100, '第 0 步提示词存在（长度 ' + step0.length + '）')
ok(step0.includes('query=""'), '#497 第 0 步使用空串枚举 query=""')
ok(!step0.includes('query="<本会话正在做'), '#497 第 0 步**不再**用关键词占位符')
ok(step0.includes('不要用关键词去猜'), '#497 明令禁止猜词换词')
ok(step0.includes('重发同一个调用'), '#497 补了「本次调用本身失败/超时，重发同一调用」')

console.log('\n══ #495 · close 必须有「何时才允许」的否定式边界 ══')
const closeSeg = (SRC.match(/· close：收口事件[^']*/) || [''])[0]
ok(closeSeg.length > 50, 'memory_event 的 close 说明存在')
ok(closeSeg.includes('这件事真的结束'), '#495 close 加了「只在真的结束」的正面边界')
ok(closeSeg.includes('不等于结束'), '#495 close 加了「写完本轮账本 ≠ 结束」的否定式边界')
ok(closeSeg.includes('不要 close'), '#495 明确给出「什么时候不要 close」')

console.log('\n══ #496 · 空壳事件必须在枚举里被标注（真跑渲染逻辑）══')
// 从 index.js 抽出枚举渲染块（判空壳 + 拼行），原样在 vm 里跑
const shellStart = SRC.indexOf('const _isShellE = (ev) =>')
const shellEnd = SRC.indexOf("_oE.push(_shellN > 0", shellStart)
ok(shellStart > 0 && shellEnd > shellStart, '已抽出空壳判定 + 标注渲染块（' + (shellEnd - shellStart) + ' 字符）')
const loopStart = SRC.indexOf('for (const ev of _sortedE.slice(0, _capE)) {', shellStart)
const loopEnd = SRC.indexOf('const _actN = evs.filter', loopStart)
const snippet = SRC.slice(shellStart, loopEnd)

const mkCtx = (sorted) => {
  const _oE = []
  const _stTxtE = (st) => st === 'active' ? '进行' : st === 'paused' ? '搁置' : st === 'closed' ? '完成' : String(st || '')
  const ctx = { _oE, _sortedE: sorted, _capE: 20, _stTxtE, Math, Number, String, Array, Date, JSON }
  vm.createContext(ctx)
  vm.runInContext(snippet + '\n_oE.push(String(_shellN))', ctx)
  return ctx
}

const shellEv = { id: 'evt_deadbeef', name: '随手建的操作记录', status: 'active', updatedAt: 1700000000000, checkpoints: [{}, {}, {}], sections: {}, summary: '' }
const realEv  = { id: 'evt_11112222', name: '真身', status: 'active', updatedAt: 1699999999000, checkpoints: [{}], sections: { goal: '做某事', doing: '做了一半', deadend: '', next: '继续' }, summary: '一段话总览' }

const c1 = mkCtx([shellEv, realEv])
ok(Number(c1._oE[c1._oE.length - 1]) === 1, '#496 空壳计数 = 1（三个检查点但四段与总览全空）')
const joined1 = c1._oE.join('\n')
ok(joined1.includes('⚠空壳'), '#496 空壳条目带 ⚠空壳 标记')
ok(joined1.includes('不要**当成'), '#496 空壳行给出「不要当成当前任务」的解释')
ok((joined1.match(/⚠空壳/g) || []).length >= 2, '#496 标记出现 ≥2 次（行内 + 说明行）')

const c2 = mkCtx([realEv])
const joined2 = c2._oE.join('\n')
ok(Number(c2._oE[c2._oE.length - 1]) === 0, '#496 无空壳时计数 = 0（负路径：不得把正常事件判成空壳）')
ok(!joined2.includes('⚠空壳'), '#496 无空壳时输出不含标记')

console.log('\n══ 变异验证（先删被检定义，再断言必红）══')
// 变异 1：把 query="" 改回关键词占位符 ⇒ #497 判据必须红
const mut497 = SRC.replace('query=""', 'query="<本会话正在做的事的关键词>"')
ok(!(/query=""[^']*枚举本工作区的全部事件/.test(mut497.match(/'0\. ★【先确认事件归属】[^']*'/) || [''])[0]), '#497 变异后第 0 步不再含空串枚举（判据会红）')
// 变异 2：去掉「不等于结束」⇒ #495 判据必须红
const mut495 = SRC.replace('不等于结束', '')
ok(!(mut495.match(/· close：收口事件[^']*/) || [''])[0].includes('不等于结束'), '#495 变异后 close 说明失去否定式边界（判据会红）')
// 变异 3：把空壳判定改成永假 ⇒ #496 判据必须红
const mut496 = snippet.replace('return !hasSec && !hasSum', 'return false')
const ctxMut = (() => {
  const _oE = []; const _stTxtE = (st) => st === 'active' ? '进行' : String(st || '')
  const ctx = { _oE, _sortedE: [shellEv], _capE: 20, _stTxtE, Math, Number, String, Array, Date, JSON }
  vm.createContext(ctx); vm.runInContext(mut496 + '\n_oE.push(String(_shellN))', ctx); return ctx
})()
ok(Number(ctxMut._oE[ctxMut._oE.length - 1]) === 0 && !ctxMut._oE.join('\n').includes('⚠空壳'), '#496 变异后空壳不再被标注（判据会红）')

console.log('\n[K-batch] pass=' + pass + ' fail=' + fail)
process.exit(fail === 0 ? 0 : 1)
