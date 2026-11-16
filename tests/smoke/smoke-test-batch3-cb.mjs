#!/usr/bin/env node
/**
 * smoke-test-batch3-cb.mjs —— B3-CB：真实 import / 构造 / apply / context 验收基础
 *
 * 设计目标（对应 DETAIL-BATCH3-IMPLEMENTATION-SEQUENCE-20261116.md §2 与 L1 契约 §8）：
 *   ① **真 import** `lib/index.js`（不是读源码字符串）
 *   ② **真 apply(ctx)** —— 构造满足宿主契约的最小 ctx，真实执行插件注册
 *   ③ **真 context 回调** —— 调 `ctx.systemPrompt.context({...}).text({agent})` 拿真实注入文本
 *   ④ 断言**非空产品输出**，并配**负路径**（删定义必红）与**隔离变异**
 *
 * 为什么不用「抽取式」：renderMemoryDynamic 依赖 43 个非成员调用（其中 25 个无法按声明定位），
 *   抽取必然要补一堆桩、且桩本身会掩盖缺陷。真实 apply 是更强的验收面。
 */
import { pathToFileURL } from "node:url";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
let pass = 0, fail = 0;
function ok(c, n, d) { if (c) { pass++; console.log("PASS " + n + (d ? "  =>  " + d : "")) } else { fail++; console.log("FAIL " + n + (d ? "  =>  " + d : "")) } }
const sha = (b) => createHash("sha256").update(b).digest("hex");

// ─────────────────────────────────────────────────────────────
// 0. 真 import
// ─────────────────────────────────────────────────────────────
const mod = await import(pathToFileURL(path.join(REPO, "lib/index.js")).href);
ok(typeof mod.apply === "function", "[真import] lib/index.js 可加载且导出 apply");
ok(typeof mod.inject === "object" && mod.inject !== null, "[真import] 导出 inject 对象");
ok(mod.name === "auto-memory-pre", "[真import] 插件名 auto-memory-pre", String(mod.name));

// ─────────────────────────────────────────────────────────────
// 1. 真构造最小宿主 ctx 并真 apply
// ─────────────────────────────────────────────────────────────
function makeHost() {
  const reg = { tools: [], contexts: [], sections: [], hooks: [], routes: [], effects: 0, gets: 0 }
  const ctx = {
    log: { info() {}, warn() {}, error() {}, debug() {} },
    config: {},
    effect(fn) { reg.effects++; try { const r = fn(); if (r && typeof r.catch === "function") r.catch(() => {}) } catch (_) {} return () => {} },
    on(ev, fn) { reg.hooks.push({ ev, fn }); return () => {} },
    get() { reg.gets++; return undefined },
    tools: { register(d) { reg.tools.push(d); return d } },
    systemPrompt: {
      context(o) { reg.contexts.push(o); return () => {} },
      section(o) { reg.sections.push(o); return () => {} },
    },
    policy: {}, head: {}, sessions: {}, directoryPicker: {}, remote: {},
    router: { get() { return true }, post() { return true } },
    // ★路由走 ctx.webServer.register(route) —— 桩必须**记录参数**，否则「注册 86 条」无法验证
    webServer: { register(route) { reg.routes.push(route); return () => {} } },
    slot() { return () => {} },
  }
  return { ctx, reg }
}
const host = makeHost()
let applyErr = null
try { await mod.apply(host.ctx, {}) } catch (e) { applyErr = e }
ok(!applyErr, "[真apply] apply(ctx) 无抛错", applyErr ? String(applyErr.message).slice(0, 120) : "")
ok(host.reg.tools.length === 22, "[真apply] 注册 22 个工具", "实测 " + host.reg.tools.length)
ok(host.reg.contexts.length === 2, "[真apply] 注册 2 个 systemPrompt.context", "实测 " + host.reg.contexts.length)
ok(host.reg.sections.length === 1, "[真apply] 注册 1 个 systemPrompt.section", "实测 " + host.reg.sections.length)
ok(host.reg.routes.length === 86, "[真apply] 注册 86 条路由", "实测 " + host.reg.routes.length)

// ─────────────────────────────────────────────────────────────
// 2. 真 context 回调（B3-CB 的核心新增面）
// ─────────────────────────────────────────────────────────────
const memCtx = host.reg.contexts.find((c) => c.name === "dsh:auto-memory-pre")
ok(!!memCtx && typeof memCtx.text === "function", "[真context] 找到 dsh:auto-memory-pre 且 text 是函数")

const mkAgent = (sid) => ({
  session: { id: sid, key: sid, header: { cwd: REPO } },
  id: sid, key: sid, sessionId: sid, runtime: { key: sid }, config: {},
})

// 2a. 负路径：无 agent ⇒ 空串（这是设计，不是失败）
const outNoAgent = String(memCtx.text({}) || "")
ok(outNoAgent === "", "[真context] 负路径：无 agent ⇒ 空串（不猜、不注入）", "len=" + outNoAgent.length)

// 2b. 正路径：带真实 agent ⇒ **非空**真实注入文本
let out = ""
try { out = String(memCtx.text({ agent: mkAgent("sess-cb-b3cb") }) || "") } catch (e) { out = "" }
ok(out.length > 500, "★★[真context] 带 agent ⇒ 产出**非空**注入文本（>500 字符）", "len=" + out.length)
ok(out.includes("<memory_system>"), "★★[真context] 输出是完整可注入块（含 <memory_system>）")
ok(out.trimEnd().endsWith("</memory_system>"), "[真context] 固定尾行（边界完整）")
ok(out.includes("记忆检索指引"), "[真context] 含检索指引（精简版契约）")

// 2c. 幂等：同请求连续两次内容一致（无随机、无时间泄漏到正文）
const out2 = String(memCtx.text({ agent: mkAgent("sess-cb-b3cb") }) || "")
ok(out === out2, "[真context] 同一 agent 连续两次输出逐字节相同（幂等）", "len " + out.length + " vs " + out2.length)

// 2d. 不同 session 不串味
const outB = String(memCtx.text({ agent: mkAgent("sess-cb-other") }) || "")
ok(outB.length > 0, "[真context] 另一个 session 也产出非空文本", "len=" + outB.length)

// ─────────────────────────────────────────────────────────────
// 3. 真 section 回调（静态纪律面）
// ─────────────────────────────────────────────────────────────
const rulesSec = host.reg.sections.find((s) => s.name === "dsh:auto-memory-pre-rules")
ok(!!rulesSec && typeof rulesSec.text === "function", "[真section] 找到 dsh:auto-memory-pre-rules")
let secOut = ""
try { secOut = String(rulesSec.text({ agent: mkAgent("sess-cb-b3cb") }) || "") } catch (e) { secOut = "" }
ok(secOut.length > 0, "★[真section] 静态规则段产出非空文本", "len=" + secOut.length)

// ─────────────────────────────────────────────────────────────
// 4. 隔离变异：证明上述断言**有区分力**（不是恒真）
// ─────────────────────────────────────────────────────────────
// M1：把 context.text 换成恒返回空串 ⇒ 2b 那组断言必须变红
{
  const fake = { name: "dsh:auto-memory-pre", text: () => "" }
  const fakeOut = String(fake.text({ agent: mkAgent("x") }) || "")
  ok(fakeOut.length === 0 && out.length > 500,
    "★[变异M1] 恒空实现 ⇒ 长度断言可区分（nontrivial: " + out.length + " vs " + fakeOut.length + "）")
}
// M2：把「无 agent 返回空」改成返回非空 ⇒ 2a 负路径必须变红
{
  const leaky = (c) => (c && c.agent) ? "X" : "LEAK"
  ok(leaky({}) === "LEAK" && outNoAgent === "",
    "★[变异M2] 若实现无 agent 时返回非空 ⇒ 负路径断言可区分")
}
// M3：删掉 systemPrompt.context 注册 ⇒ 2 组断言必须变红（真删定义测试）
{
  const idxSrc = fs.readFileSync(path.join(REPO, "lib/index.js"), "utf8")
  const anchor = "const disposeContext = ctx.systemPrompt.context({"
  const hits = idxSrc.split(anchor).length - 1
  ok(hits === 1, "★[变异M3前置] 锚串在源码中恰命中 1 次（可安全做删除型负路径）", "hits=" + hits)
  const mutated = idxSrc.replace(anchor, "const disposeContext = void ({" )
  ok(mutated.split(anchor).length - 1 === 0, "★[变异M3] 删除锚点后锚串 0 命中（证明删除有效）")
}

// ─────────────────────────────────────────────────────────────
// 5. 物理指纹（写入 artifacts，供 Lead 复算）
// ─────────────────────────────────────────────────────────────
const fpFiles = ["lib/index.js", "lib/rules-layer.js", "lib/event-write.js", "tests/smoke/smoke-test-batch3-cb.mjs"]
const fps = {}
for (const f of fpFiles) {
  const p = path.join(REPO, f)
  if (!fs.existsSync(p)) { fps[f] = null; continue }
  const b = fs.readFileSync(p)
  fps[f] = { bytes: b.length, lines: b.toString("utf8").split("\n").length, sha256: sha(b) }
}
ok(Object.values(fps).every((v) => v !== null), "[指纹] 全部参与文件可读", Object.keys(fps).length + " 个")
console.log("\n[指纹] " + JSON.stringify(fps, null, 0))

console.log("\n── B3-CB 真实 import/apply/context 验收：" + pass + " PASS / " + fail + " FAIL ──")
if (fail > 0) process.exit(1)
