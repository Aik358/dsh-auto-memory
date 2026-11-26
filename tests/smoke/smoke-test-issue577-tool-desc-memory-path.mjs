#!/usr/bin/env node
/**
 * smoke-test-issue577-tool-desc-memory-path.mjs —— #577 回归守卫（2026-11-24）
 *
 * ## 缺陷原文（issue #577）
 * 集中式存储改造后，项目级记忆实际落在 `~/.dsh/memory/workspaces/<key>/`（projectDirOf），
 * 但 4 个工具描述仍写 `.dsh-memory/`（旧版分散布局）⇒ 模型按描述去工作区找文件会落空，
 * 误判「记忆没写进去」或重复建目录。
 * 同族：GUIDANCE 常量同样是旧口径；memory_reflect 描述的「漏落盘后果」与实现不符。
 *
 * ## 本套件守什么（issue 明言「现有门禁不会拦住这类过期文案」）
 * A. 4 个工具描述 + GUIDANCE 必须写**本项目记忆目录**（集中式），不得把 `.dsh-memory/` 当当前落点
 * B. 功能锚：projectDirOf 必须走 workspaceStorageDirPre（集中式根 + wsKey），不是字面量 .dsh-memory
 * C. memory_reflect 的漏落盘后果必须与 reflectionShownSession 实现一致（本会话不再提醒 / 下个会话再提醒）
 * D. 变异反向验证：把旧文案灌回 ⇒ A 必红（证明判据非恒真）
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
const IX = fs.readFileSync(path.join(ROOT, "lib", "index.js"), "utf8")
let pass = 0, fail = 0
const ok = (c, n, d) => {
  if (c) { pass++; console.log("  ok   - " + n + (d ? " :: " + d : "")) }
  else { fail++; console.log("  FAIL - " + n + (d ? " :: " + d : "")) }
}

// ── 抽取某个 defineTool 的描述字面量（到首个 "', {" 或 "', {" 边界）──
function extractDesc(src, toolName) {
  const mark = "defineTool('" + toolName + "', '"
  const i0 = src.indexOf(mark)
  if (i0 < 0) return null
  const from = i0 + mark.length
  // 描述用单引号包裹；内部不含未转义单引号（本仓约定" + '"' + "用" + '"' + "双引号避免）
  const i1 = src.indexOf("', {", from)
  if (i1 < 0) return null
  return src.slice(from, i1)
}

const CANON = "本项目记忆目录"
const LEGACY_WARN_MARK = "旧版分散布局"

// ═══ A. 四个工具描述 + GUIDANCE ═══
console.log("== A. 工具描述口径 ==")
{
  const tools = ["memory_log", "memory_note", "memory_maintain", "memory_reflect"]
  for (const t of tools) {
    const d = extractDesc(IX, t)
    ok(!!d, "A-" + t + "0 描述可抽取")
    if (!d) continue
    ok(d.indexOf(CANON) >= 0, "A-" + t + "1 描述声明「本项目记忆目录」（集中式口径）")
    ok(d.indexOf("~/.dsh/memory/workspaces") >= 0 || d.indexOf("archive/") >= 0 || d.indexOf("reflections/") >= 0,
       "A-" + t + "2 给出具体落点（集中式根或相对子目录）")
  }
}
{
  // 负路径：不得把 .dsh-memory/ 当**当前**落点；唯一允许的是 memory_log 里那条显式「旧版」警示
  const logD = extractDesc(IX, "memory_log") || ""
  const legacyAsTarget = /\.dsh-memory\/(?! )/.test(logD.replace(LEGACY_WARN_MARK, "").replace(/`.dsh-memory\/`/g, "`MARK_LEGACY`"))
  ok(logD.indexOf(LEGACY_WARN_MARK) >= 0, "A-log3 memory_log 保留显式「旧版分散布局」警示（防模型去旧位置找）")
  ok(!legacyAsTarget, "A-log4 除该警示外不再把 .dsh-memory/ 当作落点", String(legacyAsTarget))
}
{
  // GUIDANCE
  const i0 = IX.indexOf("export const GUIDANCE = '")
  ok(i0 >= 0, "A-g0 GUIDANCE 可定位")
  const g = i0 >= 0 ? IX.slice(i0, IX.indexOf("'", IX.indexOf("'", i0) + 1)) : ""
  const gEnd = IX.indexOf("\n", i0)
  const gLine = IX.slice(i0, gEnd > i0 ? gEnd : i0 + 1200)
  ok(gLine.indexOf(CANON) >= 0, "A-g1 GUIDANCE 声明集中式口径（本项目记忆目录）", gLine.slice(0, 80))
  ok(!/\.dsh-memory/.test(gLine), "A-g2 GUIDANCE 不再出现旧路径 .dsh-memory")
}

// ═══ B. 功能锚：projectDirOf 真走集中式 ═══
console.log("== B. 功能锚 projectDirOf ==")
{
  const i = IX.indexOf("  projectDirOf(ws) {")
  ok(i > 0, "B0 projectDirOf 可定位")
  const body = IX.slice(i, IX.indexOf("\n  }", i))
  ok(body.indexOf("workspaceStorageDirPre") >= 0, "B1 projectDirOf 走 workspaceStorageDirPre（集中式）")
  ok(body.indexOf("this.wsKey(ws)") >= 0, "B2 传入 wsKey（每工作区一个子目录）")
  // workspaceStorageDirPre 的真落点 = memoryRoot + wsKey
  const j = IX.indexOf("  workspaceStorageDirPre(wsKey) {")
  ok(j > 0, "B3 workspaceStorageDirPre 可定位")
  const wbody = IX.slice(j, j + 800)
  ok(wbody.indexOf("this.config.memoryRoot") >= 0, "B4 落点根 = config.memoryRoot")
  ok(wbody.indexOf("path.join(root, wsKey)") >= 0, "B5 实际路径 = memoryRoot/wsKey")
}

// ═══ C. memory_reflect 后果描述与实现一致 ═══
console.log("== C. 反思提示后果 ==")
{
  // 实现：reflectionShownSession 记已提示日期 ⇒ 同一 runtime 内不再提示
  const i = IX.indexOf("if (this.state.reflectionShownSession === pending.date) return ''")
  ok(i > 0, "C1 实现确实以 reflectionShownSession 记录已提示日期")
  ok(IX.indexOf("this.state.reflectionShownSession = pending.date") > 0, "C2 实现确实写入该字段")
  // 文案：不得再宣称「后续轮次重复出现」
  const bad = IX.indexOf("只呈现不落盘会导致该提示在后续轮次重复出现")
  ok(bad < 0, "C3 不再宣称「后续轮次重复出现」（与实现不符）")
  const good = IX.indexOf("本会话（当前 runtime）内不会再次提醒") >= 0
  ok(good, "C4 改为准确表述「本会话内不再提醒」")
  ok(IX.indexOf("下一个新会话仍会再次提示") >= 0, "C5 写明真正的代价「下个新会话会再提醒 + 内容丢失」")
}

// ═══ D. 变异反向验证 ═══
console.log("== D. 变异反向验证 ==")
{
  const logD = extractDesc(IX, "memory_log")
  // 变异锚点只用核心短语（描述里带 markdown 加粗 **，不要拼整段）
  const mutated = logD.split(CANON).join(".dsh-memory/")
  ok(mutated !== logD, "D1 [变异] 把新口径换回旧路径的动作生效")
  ok(mutated.indexOf(CANON) < 0, "D2 [变异] 换回后不再含「本项目记忆目录」⇒ A-memory_log1 会红")
  ok(logD.indexOf(CANON) >= 0, "D3 [还原] 原描述含新口径（A 有区分力）")
}
{
  const gI = IX.indexOf("export const GUIDANCE = '")
  const gLineEnd = IX.indexOf("\n", gI)
  const gLine = IX.slice(gI, gLineEnd > gI ? gLineEnd : gI + 1200)
  const mutG = gLine.replace(CANON + "内的项目笔记与每日日志 —— **集中式**，默认 `~/.dsh/memory/workspaces/<工作区>/`", ".dsh-memory/")
  const applied = mutG !== gLine
  ok(applied, "D4 [变异] GUIDANCE 换回旧路径的动作生效")
  ok(applied && /\.dsh-memory/.test(mutG), "D5 [变异] 换回后出现旧路径 ⇒ A-g2 会红")
}

console.log("")
console.log("[issue577] " + pass + " PASS / " + fail + " FAIL")
process.exit(fail === 0 ? 0 : 1)
