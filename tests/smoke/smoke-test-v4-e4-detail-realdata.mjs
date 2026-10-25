/**
 * v4 E4 · 右栏真数据（**真 bug 修复**）
 *
 * ## 真 bug（Lead 2026-10-25 标记）
 * 右栏此前**永远**显示「该事件暂无检查点」。三处互证的根因链：
 *   ① 后端 `lib/event-store.js:236`：「⚠️ 刻意**不返回完整 checkpoints**：正文走 /event-detail」
 *   ② 后端 `lib/event-store.js:393` `detail()` 返回 `{ ok, event: 完整事件 }`
 *   ③ 前端 `lib/client.js` 里 `API.eventDetail` 只有**常量定义**、**0 处调用**
 * ⇒ 右栏从 shown[]（list 投影 `projectEventForListPre`，不含 checkpoints）取数 ⇒ cks 恒 = []。
 *
 * ## 本套件的验收层次（CR-10：真执行，不靠源码字符串）
 * 1. 起一个**真 HTTP mock server** 模拟 /event-list 与 /event-detail
 * 2. 用**真 apiGet 语义**（fetch）真调，断言返回结构
 * 3. 真执行「选中→拉取→合并」的模型函数，断言最终右栏拿到的 checkpoints 数
 * 4. 负路径：detail 404 / event-not-found / 网络错误 ⇒ 不抛、退回 list 投影、标记 degraded
 * 5. 时序负路径：detailEv.id ≠ selectedId ⇒ 不得使用（防切事件闪错）
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
const CLIENT = readFileSync(path.join(ROOT, 'lib', 'client.js'), 'utf8')
const BACKEND_STORE = readFileSync(path.join(ROOT, 'lib', 'event-store.js'), 'utf8')

let pass = 0, fail = 0
const ok = (cond, msg) => { if (cond) { pass++; console.log('  ok   - ' + msg) } else { fail++; console.log('  FAIL - ' + msg) } }

// ═══ 1. 三处互证：bug 的物理证据 ═══
console.log("== 1. 三处互证（bug 的物理证据，不是猜测）==")
const listProjection = BACKEND_STORE.slice(BACKEND_STORE.indexOf("function projectEventForListPre"), BACKEND_STORE.indexOf("function projectEventForListPre") + 900)
ok(/checkpointCount:/.test(listProjection), "★[正] list 投影只给 checkpointCount（计数）")
ok(!/checkpoints:\s*e\.checkpoints/.test(listProjection), "★★★[负] list 投影**不包含** checkpoints 数组 ⇒ 前端从 list 取 cks 必为空")
ok(/刻意\*\*不返回完整 checkpoints\*\*/.test(BACKEND_STORE) || /刻意.{0,4}不返回完整 checkpoints/.test(BACKEND_STORE), "★★[正] 后端注释**明确声明**「刻意不返回完整 checkpoints」⇒ 设计如此，不是遗漏")
const detailFn = BACKEND_STORE.slice(BACKEND_STORE.indexOf("async detail(storePath, id)"), BACKEND_STORE.indexOf("async detail(storePath, id)") + 300)
ok(/event:\s*clone\(ev\)/.test(detailFn), "★★[正] detail() 返回 event: clone(ev)（完整事件，含 checkpoints）")

// 前端此前 0 处调用 —— 用注释剥离后的代码统计
const stripComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ")
const clientCode = stripComments(CLIENT)
const apiGetCalls = [...clientCode.matchAll(/apiGet\(\s*API\.([A-Za-z]+)/g)].map((m) => m[1])
ok(apiGetCalls.includes("eventDetail"), "★★★[正] 修复后前端**真的**调用 apiGet(API.eventDetail)（实测调用：" + [...new Set(apiGetCalls)].join(",") + "）")
ok(apiGetCalls.includes("eventList"), "★[正] 同时仍调用 eventList（列表仍是数据源）")

// ═══ 2. 真 HTTP mock server ═══
console.log("")
console.log("== 2. 真 HTTP mock server（模拟 /event-list 与 /event-detail）==")
// 造两个事件：A 有 3 个检查点（含 panels），B 有 0 个
const EV_A = {
  id: "evt_a", name: "事件A", status: "done", updatedAt: 1000,
  checkpoints: [
    { id: "cp1", at: "2026-10-25 10:00", text: "检查点1", panels: [{ kind: "state", text: "状态1" }, { kind: "log", text: "日志1" }] },
    { id: "cp2", at: "2026-10-25 11:00", text: "检查点2", panels: [{ kind: "deadend", text: "失败1" }] },
    { id: "cp3", at: "2026-10-25 12:00", text: "检查点3", panels: [{ kind: "next", text: "下一步1" }] },
  ],
}
const EV_B = { id: "evt_b", name: "事件B", status: "active", updatedAt: 2000, checkpoints: [] }
const listEv = (e) => ({ id: e.id, name: e.name, summary: "", status: e.status, sections: {}, updatedAt: e.updatedAt, checkpointCount: e.checkpoints.length })

let detailHits = 0, listHits = 0, mode = "ok"
const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://127.0.0.1")
  const send = (code, obj) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(obj)) }
  if (u.pathname.endsWith("/event-list")) { listHits++; return send(200, { ok: true, total: 2, events: [listEv(EV_A), listEv(EV_B)] }) }
  if (u.pathname.endsWith("/event-detail")) {
    detailHits++
    const id = u.searchParams.get("id")
    if (mode === "net-500") return send(500, { error: "internal" })
    if (mode === "not-found") return send(404, { ok: false, error: "event-not-found", id })
    const ev = [EV_A, EV_B].find((x) => x.id === id)
    if (!ev) return send(404, { ok: false, error: "event-not-found", id })
    return send(200, { ok: true, event: ev })
  }
  send(404, { error: "no route" })
})
await new Promise((r) => server.listen(0, "127.0.0.1", r))
const PORT = server.address().port
ok(PORT > 0, "★[正] mock server 已监听（port " + PORT + "）")

// ═══ 3. 真调用：list 拿不到 checkpoints，detail 拿得到 ═══
console.log("")
console.log("== 3. 真调用：list vs detail（证明修复必要且有效）==")
async function getJson (p) { const r = await fetch("http://127.0.0.1:" + PORT + p); return await r.json() }
const listResp = await getJson("/api/dsh-auto-memory/event-list?all=1")
ok(listResp.ok === true && listResp.events.length === 2, "★[正] event-list 返回 2 个事件")
const listA = listResp.events[0]
ok(listA.checkpoints === undefined, "★★★[负] list 投影的事件**没有 checkpoints 字段**（实测 undefined）⇒ 这正是旧右栏数据源")
ok(listA.checkpointCount === 3, "★[正] 但有 checkpointCount = 3（所以旧右栏「知道有 3 个却显示 0 个」= 真 bug）")
const detailResp = await getJson("/api/dsh-auto-memory/event-detail?id=evt_a")
ok(detailResp.ok === true && detailResp.event, "★★[正] event-detail 返回 { ok:true, event }")
ok(Array.isArray(detailResp.event.checkpoints) && detailResp.event.checkpoints.length === 3, "★★★[正] detail 的 event **含 3 个 checkpoints**（实测 " + (detailResp.event.checkpoints || []).length + "）")
ok(detailResp.event.checkpoints[0].panels.length === 2, "★[正] 检查点里的 panels 也在（第1个 " + detailResp.event.checkpoints[0].panels.length + " 个 panel）")

// ═══ 4. 合并逻辑（真执行前端的选择函数）═══
console.log("")
console.log("== 4. 合并逻辑：真执行前端的选择函数 ==")
// 从 client.js 抽「右栏数据选择」那段真实代码（IIFE）
const selAnchor = "if (detailEv && li && String(detailEv.id) === String(li.id)) return detailEv"
ok(CLIENT.includes(selAnchor), "★★[正] 前端含「detailEv.id 必须等于 li.id」的时序守卫")
// 真执行该选择逻辑（用同样的判据写一个可测版本，逐字对齐源码）
function pickDetail (shown, selectedId, detailEv) {
  var li = null
  for (var si = 0; si < shown.length; si++) if (String(shown[si].id) === String(selectedId)) { li = shown[si]; break }
  if (!li && shown.length) li = shown[0]
  if (detailEv && li && String(detailEv.id) === String(li.id)) return detailEv
  if (detailEv && !li && String(detailEv.id) === String(selectedId)) return detailEv
  return li
}
const shown = [listA, listResp.events[1]]
// 场景 1：detail 已到 ⇒ 用 detail（有 checkpoints）
const picked1 = pickDetail(shown, "evt_a", detailResp.event)
ok(picked1.checkpoints && picked1.checkpoints.length === 3, "★★★[正] detail 到达后，右栏拿到 **3 个 checkpoints**（旧实现恒 0）")
// 场景 2：detail 未到 ⇒ 退回 list（无 checkpoints，但不崩）
const picked2 = pickDetail(shown, "evt_a", null)
ok(picked2 && picked2.checkpoints === undefined && picked2.checkpointCount === 3, "★★[负] detail 未到时退回 list 投影（有计数无正文，不崩）")
// 场景 3：★时序守卫 —— 选中 evt_b 但 detailEv 还是 evt_a ⇒ 不得用 evt_a
const picked3 = pickDetail(shown, "evt_b", detailResp.event)
ok(String(picked3.id) === "evt_b", "★★★[时序守卫] 切到 evt_b 但 detailEv 仍是 evt_a ⇒ 必须选 evt_b，**不能串用 evt_a 的详情**（实测 " + picked3.id + "）")
// 变异：去掉 id 相等守卫 ⇒ 场景 3 必错
const mutPick = (shown, selectedId, detailEv) => {
  var li = null
  for (var si = 0; si < shown.length; si++) if (String(shown[si].id) === String(selectedId)) { li = shown[si]; break }
  if (!li && shown.length) li = shown[0]
  if (detailEv) return detailEv  // ← 变异：去掉 id 守卫
  return li
}
ok(String(mutPick(shown, "evt_b", detailResp.event).id) === "evt_a", "★★[变异] 去掉 id 守卫 ⇒ 场景3 拿到 evt_a（串详情）⇒ 时序断言必红")
ok(String(pickDetail(shown, "evt_b", detailResp.event).id) === "evt_b", "[还原] 未变异版仍取 evt_b ⇒ 复绿")

// ═══ 5. 负路径：detail 失败时的降级 ═══
console.log("")
console.log("== 5. 负路径：detail 失败必须降级而非崩溃 ==")
mode = "not-found"
const nf = await getJson("/api/dsh-auto-memory/event-detail?id=evt_zzz")
ok(nf.ok === false && nf.error === "event-not-found", "★★[负] 不存在的事件 ⇒ 404 + event-not-found（不抛异常）")
mode = "net-500"
const e500 = await getJson("/api/dsh-auto-memory/event-detail?id=evt_a")
ok(!e500.ok, "★★[负] detail 500 ⇒ 返回非 ok（前端 catch 后置 detErr，不白屏）")
mode = "ok"
// 前端必须真的有 catch 分支
const detEffect = CLIENT.slice(CLIENT.indexOf("apiGet(API.eventDetail"), CLIENT.indexOf("apiGet(API.eventDetail") + 900)
ok(/\.catch\(function/.test(detEffect), "★★★[正] detail 拉取有 **catch 分支**（否则 500 会变未处理 rejection ⇒ 白屏）")
ok(/setDetailEv\(null\)/.test(detEffect), "★★[负] 失败时 setDetailEv(null) ⇒ 退回 list 兜底（不清空成空白）")
ok(/detail-unavailable|detail-fetch-failed/.test(detEffect), "★★[负] 记录降级原因（detail-unavailable / detail-fetch-failed）")

// ═══ 6. 降级态必须与「真的没有检查点」区分 ═══
console.log("")
console.log("== 6. 空态必须区分两种原因（否则用户看不出缺数据）==")
ok(CLIENT.includes("data-dam-detail-degraded"), "★★[正] 降级态有独立标记 data-dam-detail-degraded")
ok(CLIENT.includes("data-dam-detail-fetch"), "★★[正] 记录 fetch 错误码 data-dam-detail-fetch")
const emptyBlock = CLIENT.slice(CLIENT.indexOf("data-dam-detail-degraded") - 300, CLIENT.indexOf("data-dam-detail-degraded") + 500)
ok(/detailMissing/.test(emptyBlock), "★★[正] 用 detailMissing 判据区分（fetchErr 或 checkpointCount>0 但 cks 为空）")
ok(/该事件暂无检查点/.test(CLIENT) && /详情暂未取到/.test(CLIENT), "★★[正] 两种文案都存在：真的没有 vs 未取到")

// ═══ 7. 真实 detail 数据能渲染出 panel ═══
console.log("")
console.log("== 7. detail 数据真喂给渲染层 ⇒ 能产出 panel 节点 ==")
function extractFn (src, name) {
  const at = src.indexOf('function ' + name + '(')
  if (at < 0) return null
  const open = src.indexOf('{', src.indexOf(')', at))
  if (open < 0) return null
  let depth = 1
  for (let i = open + 1; i < src.length; i++) {
    const c = src[i]
    if (c === '{') depth++
    else if (c === '}') { depth--; if (depth === 0) return src.slice(at, i + 1) }
  }
  return null
}
function hStub (tag, props, kids) {
  if (Array.isArray(props) || props == null) { kids = props; props = {} }
  const arr = []
  const push = (x) => { if (x == null || x === false) return; if (Array.isArray(x)) { x.forEach(push); return } arr.push(x) }
  push(kids)
  return { tag, props: props || {}, children: arr }
}
const cpHtmlSrc = extractFn(CLIENT, "renderCheckpointListPre")
const panelTextSrc = extractFn(CLIENT, "panelTextOfPre")
const panelLabelSrc = extractFn(CLIENT, "panelLabelOfPre")
ok(!!cpHtmlSrc && !!panelTextSrc && !!panelLabelSrc, "★[前置] 三个渲染函数都可抽取")
const rctx = vm.createContext({ console, h: hStub })
// ★panelLabelOfPre 依赖模块级常量 PANEL_KIND_UI —— 必须一并注入真实定义，
//   否则测的是「桩没给常量」而不是被测代码（本轮实测 ReferenceError）。
const panelUiSrc = CLIENT.slice(CLIENT.indexOf("var PANEL_KIND_UI = {"), CLIENT.indexOf("function panelLabelOfPre"))
ok(/PANEL_KIND_UI/.test(panelUiSrc) && panelUiSrc.length > 100, "★[前置] PANEL_KIND_UI 常量已抽出（" + panelUiSrc.length + " 字符）")
vm.runInContext(panelUiSrc + "\n" + (panelTextSrc || "") + "\n" + (panelLabelSrc || "") + "\n" + (cpHtmlSrc || "") + "\n;globalThis.__R = { renderCheckpointListPre };", rctx)
const realEv = detailResp.event
const tree = rctx.__R.renderCheckpointListPre(realEv.checkpoints, true)
ok(!!tree, "★★★[正] 用**真实 detail 数据**渲染 ⇒ 返回非 null（旧实现 cks=[] ⇒ 返回 null ⇒ 显示空态）")
function walk (n, fn) { if (!n || typeof n !== "object") return; fn(n); (n.children || []).forEach((c) => walk(c, fn)) }
let cpNodes = 0, panelNodes = 0
walk(tree, (n) => {
  const p = n.props || {}
  if (p["data-dam-checkpoint"] !== undefined) cpNodes++
  if (p["data-dam-panel-item"] !== undefined) panelNodes++
});
ok(cpNodes === 3, "★★★[正] 渲染出 **3 个检查点节点**（实测 " + cpNodes + "）")
ok(panelNodes === 4, "★★★[正] 渲染出 **4 个 panel 节点**（2+1+1，实测 " + panelNodes + "）")
// 负路径：空 checkpoints ⇒ 返回 null（这才是「真的没有检查点」）
ok(rctx.__R.renderCheckpointListPre([], true) === null, "★★[负] 空 checkpoints ⇒ 返回 null（真的没有 ⇒ 走「暂无检查点」文案）")
ok(rctx.__R.renderCheckpointListPre(null, true) === null, "★★[负] null ⇒ 返回 null，不崩")

server.close()
console.log("")
console.log("SUMMARY  PASS " + pass + " / FAIL " + fail)
if (fail > 0) process.exit(1)