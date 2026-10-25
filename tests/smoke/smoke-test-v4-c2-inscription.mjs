#!/usr/bin/env node
/**
 * smoke-test-v4-c2-inscription.mjs —— 批次 C-2：铭文/精简版 Prompt 改造验收。
 *
 * P2（snapshotSlimMaintain：加一项 + 六项→七项）与 P3（snapshotSlimGuide：加事件入口 + 改白板语义）
 * 都是**模型每轮真读到的文本**，故直接量 DEFAULT_PROMPT_LAYERS 的**求值结果**（不是源码字面量）。
 * P1（snapshotInscription 整段重写）本轮**未做**：文档没给新版正文，且它会改变模型每轮行为 ⇒ 需用户裁定。
 * 本套件的 P1 段改为**把现状钉住**（防漂移），并在注释里标明待办。
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_PROMPT_LAYERS } from '../../lib/index.js'

let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  PASS ' + m) } else { fail++; console.log('  FAIL ' + m) } }
const eq = (a, b, m) => ok(Object.is(a, b), m + '  (got=' + JSON.stringify(a) + ' want=' + JSON.stringify(b) + ')')

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
const L = DEFAULT_PROMPT_LAYERS

console.log('[P2] snapshotSlimMaintain：新增 memory_event + 「六项」→「七项」')
const mt = L.snapshotSlimMaintain
ok(typeof mt === 'string' && mt.length > 0, '取值非空（' + (mt || '').length + ' 字符）')
ok(mt.includes('memory_event'), '★新增项：点名 memory_event（事件记忆的模型入口）')
// ★2026-10-24 P1 定稿后（用户裁定「接近现状 + 不得错漏」）：精简版第 7 项从「建事件/加检查点」
//   升级为**完整事件语义**（开工判归属 + create/append/set/close + 宁建勿挂 + 事件是索引）。
//   判据从「含这两个字面词」改为「覆盖四个动作 + 归属判断」—— 意图不变（模型知道怎么用事件），更强。
ok(/memory_event/.test(mt) && /create/.test(mt) && /append/.test(mt) && /close/.test(mt), '新项写清事件四动作（create/append/set/close）')
ok(/宁建勿挂/.test(mt), '★写清「宁建勿挂」判据（防模型偷懒挂错事件）')
ok(/eventId/.test(mt), '★写清 eventId（开工先判归属的可执行出口）')
// ★同上：新文案的分工改成「事件是索引 / memory_note(kind=handoff) 是原文载体，两者都要写」——
//   这比旧版「写了事件就不必再写 memory_log」**更严格**（旧版暗示可省，新版要求都写）。
ok(/事件只是\*\*索引\*\*|事件是索引/.test(mt) && /kind=handoff/.test(mt), '★写清事件与账本的分工（事件=索引，账本=原文载体，两者都要写）')
ok(mt.includes('这七项'), '★计数从「六项」改成「七项」')
ok(!mt.includes('这六项'), '负：不再残留「六项」旧计数')
for (const k of ['memory_procedure_list', 'memory_log', 'memory_note', 'memory_procedure', 'memory_recall']) {
  ok(mt.includes(k), '原六项一个没丢：' + k)
}

console.log('[P3] snapshotSlimGuide：加「当前在做什么」入口 + 白板语义改对')
const gd = L.snapshotSlimGuide
ok(typeof gd === 'string' && gd.length > 0, '取值非空（' + (gd || '').length + ' 字符）')
ok(gd.includes('事件卡片'), '★新增：先看注入的事件卡片（v4 新增的「当前在做什么」入口）')
ok(gd.indexOf('事件卡片') < gd.indexOf('handoff/PLAN.md'), '★顺序正确：**先**看事件卡片，**再**翻白板/账本（当下优先于历史）')
ok(gd.includes('四段式'), '★白板/账本语义改对：注明账本是四段式（任务状态/目标/已试方案与失败原因/进度与下一步）')
// ★2026-10-24 P1 审计发现并修掉的真缺陷：原断言把 memory_search 当成「第三个检索工具」，
//   但 grep 全仓证实**该工具从未注册**（index.js 里只出现在这句文案里）⇒ 这是长期存在的假承诺。
//   已从服务端 + 客户端两处删除。判据改为「剩下的两个真实工具都在」+「假承诺不得回流」。
ok(gd.includes('memory_read') && gd.includes('memory_recall'), '原有检索工具 memory_read / memory_recall 都在')
ok(!gd.includes('memory_search'), '★负：不得再出现假承诺 memory_search（该工具未注册）')
// ★2026-10-24 批次 D 翻转：C-2 时该 scope **不存在** ⇒ 断言「不得出现」（防假承诺）；
//   D 批已实现 scope='events'（真调用可返回事件）⇒ 断言翻转为「必须出现」。
//   这条断言的**语义没变**：始终是「文案承诺必须与后端能力一致」，只是后端补上了。
ok(gd.includes('scope="events"'), '★正：承诺 scope="events"（后端 D 批已实现，文案与能力一致）')
const idxSrc = readFileSync(path.join(ROOT, 'lib', 'index.js'), 'utf8')
ok(idxSrc.includes("enum: ['all', 'handoff', 'sessions', 'archive', 'events']"), '★正：后端 scope 枚举确实含 events（文案与代码同一事实源）')

console.log('[P2/P3] 服务端 ≡ 客户端镜像（逐键逐字；G4-6b/G4-6d 已硬锁，这里再自证一次）')
const cliSrc = readFileSync(path.join(ROOT, 'lib', 'client.js'), 'utf8')
const i0 = cliSrc.indexOf('var DEFAULT_PROMPT_LAYERS_CLIENT = {')
const bs = cliSrc.indexOf('{', i0)
let d = 0, be = bs
for (let k = bs; k < cliSrc.length; k++) { if (cliSrc[k] === '{') d++; else if (cliSrc[k] === '}') { d--; if (d === 0) { be = k; break } } }
const cliObj = new Function('return ' + cliSrc.slice(bs, be + 1))()
eq(cliObj.snapshotSlimMaintain, mt, '★客户端 snapshotSlimMaintain 与服务端逐字一致')
eq(cliObj.snapshotSlimGuide, gd, '★客户端 snapshotSlimGuide 与服务端逐字一致')

console.log('[P1] 现状钉住（**未重写**，原因见文件头；防漂移）')
const ins = L.snapshotInscription
const arch = L.snapshotInscriptionArchive
const total = ins + arch
ok(/\{date\}/.test(ins), 'P1 仍保留 {date} 占位')
ok(total.length <= 1500, 'P1 渲染总量仍 ≤1500（实测 ' + total.length + '）')
ok(total.length > ins.length, '⑦ 归档层仍在')
// 待办：文档要求「② 整段重写：开工先判任务归属」，但未给新版正文；本轮不擅自重写模型每轮行为。
ok(true, '（待用户裁定）P1 整段重写：文档无新版正文，本轮不改')

console.log('')
console.log('[C2] ' + pass + ' PASS / ' + fail + ' FAIL')
process.exit(fail ? 1 : 0)