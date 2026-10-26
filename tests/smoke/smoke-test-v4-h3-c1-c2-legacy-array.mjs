/**
 * smoke-test-v4-h3-c1-c2-legacy-array.mjs
 *
 * ★v5-P5（2026-10-26 修复）：detectLegacyFormatPre 的 eventStore **入参形态**缺陷。
 *
 * 缺陷（用户实报）：upgrade-status 对「有 2 个事件」的工作区报 no-events，
 *   且 counts.events=0 与真实 events=2 自相矛盾。
 *
 * 根因：旧实现只判 `typeof o.eventStore === "object"` 然后读 `o.eventStore.events`。
 *   数组也是 object ⇒ 走进去读 `arr.events` ⇒ undefined ⇒ 恒判 0。
 *   而实际调用点（index.js L9162 / L23830）传的就是**裸数组**。
 *
 * 验收要求（CR-10）：真 import → 真构造 → 真调用 → 断言返回值；每条带负路径。
 */
import fs from 'node:fs'
import path from 'node:path'
import { detectLegacyFormatPre } from '../../lib/rules-layer.js'

const ROOT = 'D:/dsh-auto-memory'
let pass = 0, fail = 0
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  ok   - ' + name + (extra ? ' :: ' + extra : '')) }
  else { fail++; console.log('  FAIL - ' + name + (extra ? ' :: ' + extra : '')) }
}

const NEW_TXT = '## 2026-10-26\n- 某条规则\n<!-- memory:mem_00000000000000000000000000000001 -->\n<!-- dsh-status: current -->'
const OLD_TXT = '## 2026-10-26\n- 某条规则（无锚点无 status）'

console.log("== A. eventStore 三种入参形态必须等价 ==")
const evs = [{ id: "evt_a", status: "active", checkpoints: [] }, { id: "evt_b", status: "closed", checkpoints: [] }]

const asNum = detectLegacyFormatPre({ userText: NEW_TXT, notesText: "", eventStore: 2, logCount: 5 })
const asArr = detectLegacyFormatPre({ userText: NEW_TXT, notesText: "", eventStore: evs, logCount: 5 })
const asObj = detectLegacyFormatPre({ userText: NEW_TXT, notesText: "", eventStore: { events: evs }, logCount: 5 })

ok(asNum.counts.events === 2, "A-1 纯数字形态", "实测 " + asNum.counts.events)
ok(asArr.counts.events === 2, "A-2 ★裸数组形态（本次修复的重点）", "实测 " + asArr.counts.events)
ok(asObj.counts.events === 2, "A-3 包装对象形态", "实测 " + asObj.counts.events)
ok(asNum.counts.events === asArr.counts.events && asArr.counts.events === asObj.counts.events,
  "A-4 三种形态结果一致（等价性）")

console.log("")
console.log('== B. 负路径：不能靠「恰好都为 0」蒙混 ==')
// B-1 裸数组有 2 个事件 ⇒ 绝不能报 no-events
ok(asArr.reasons.filter((r) => r.indexOf("no-events") === 0).length === 0,
  "B-1 裸数组有事件 ⇒ 不报 no-events（负路径）")
// B-2 空裸数组 + 有日志 ⇒ 必须报 no-events
const emptyArr = detectLegacyFormatPre({ userText: NEW_TXT, notesText: "", eventStore: [], logCount: 5 })
ok(emptyArr.counts.events === 0, "B-2 空裸数组 ⇒ events=0", "实测 " + emptyArr.counts.events)
ok(emptyArr.reasons.filter((r) => r.indexOf("no-events") === 0).length === 1,
  "B-3 空裸数组 + 有日志 ⇒ 报 no-events")
// B-4 空裸数组 + 无日志 ⇒ 不报 no-events（原有语义：logs>0 才报）
const emptyArrNoLog = detectLegacyFormatPre({ userText: NEW_TXT, notesText: "", eventStore: [], logCount: 0 })
ok(emptyArrNoLog.reasons.filter((r) => r.indexOf("no-events") === 0).length === 0,
  "B-4 空裸数组 + 无日志 ⇒ 不报 no-events（负路径，原语义不变）")
// B-5 数组长度必须真读，不是恒 0
const five = detectLegacyFormatPre({ userText: NEW_TXT, notesText: "", eventStore: [1, 2, 3, 4, 5], logCount: 1 })
ok(five.counts.events === 5, "B-5 5 元素裸数组 ⇒ events=5（证明真读长度）", "实测 " + five.counts.events)
// B-6 包装对象形状错误（events 不是数组）⇒ 0，不崩
const badObj = detectLegacyFormatPre({ userText: NEW_TXT, notesText: "", eventStore: { events: "oops" }, logCount: 1 })
ok(badObj.counts.events === 0, "B-6 包装对象 events 非数组 ⇒ 0（不崩）")
// B-7 undefined / null 不崩
const undef = detectLegacyFormatPre({ userText: NEW_TXT, notesText: "", eventStore: undefined, logCount: 1 })
const nul = detectLegacyFormatPre({ userText: NEW_TXT, notesText: "", eventStore: null, logCount: 1 })
ok(undef.counts.events === 0 && nul.counts.events === 0, "B-7 undefined/null ⇒ 0（不崩）")

console.log("")
console.log("== C. 真实工作区复现（原缺陷场景）==")
const WS = 'C:/Users/JH Z/.dsh/memory/workspaces/--D--dsh-auto-memory--'
const storePath = path.join(WS, "handoff", "event-store.json")
let real = null
try { real = JSON.parse(fs.readFileSync(storePath, "utf8")) } catch (e) { real = null }
ok(!!real && Array.isArray(real.events), "C-1 真实事件库可读")
if (real && Array.isArray(real.events)) {
  const n = real.events.length
  const userFile = "C:/Users/JH Z/.dsh/memory/MEMORY.md"
  const notesFile = path.join(WS, "MEMORY.md")
  let ut = "", nt = ""
  try { ut = fs.readFileSync(userFile, "utf8") } catch (e) {}
  try { nt = fs.readFileSync(notesFile, "utf8") } catch (e) {}
  ok(ut.length > 0, "C-2 真实用户级记忆可读", ut.length + " 字符")
  const r = detectLegacyFormatPre({ userText: ut, notesText: nt, eventStore: real.events, logCount: 29 })
  ok(r.counts.events === n, "C-3 ★真实裸数组 ⇒ counts.events === 真实事件数", "实测 " + r.counts.events + " / 期望 " + n)
  ok(r.reasons.filter((x) => x.indexOf("no-events") === 0).length === 0,
    "C-4 ★真实工作区不再误报 no-events（原缺陷已修）")
}

console.log("")
console.log("== D. 回归：原有 H3-C1/C2 语义不变 ==")
const legacyOld = detectLegacyFormatPre({ userText: OLD_TXT, notesText: "", eventStore: [], logCount: 3 })
ok(legacyOld.legacy === true, "D-1 旧格式仍判 legacy=true（无锚点/无 status）")
const legacyNew = detectLegacyFormatPre({ userText: NEW_TXT, notesText: "", eventStore: [], logCount: 3 })
ok(legacyNew.legacy === false, "D-2 新格式仍判 legacy=false")
const empty = detectLegacyFormatPre({ userText: "", notesText: "", eventStore: [], logCount: 0 })
ok(empty.legacy === false && empty.reasons.length === 0, "D-3 空文件 ⇒ legacy=false 且无 reasons")

console.log("")
console.log("SUMMARY  PASS " + pass + " / FAIL " + fail)
process.exit(fail === 0 ? 0 : 1)
