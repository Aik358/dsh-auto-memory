#!/usr/bin/env node
/**
 * [carry-source] 接续源不得是子代理（2026-09-23 用户报告缺陷的回归锁）。
 *
 * 背景（用户实测，非推测）：插件每轮自动沉淀会 spawn 子代理；该子代理一启动就会触发
 * `agent/session-start`。若该路径不排除子代理，`_lastAgent` 被顶成子代理 ⇒
 *   · `currentSessionId()` 返回子代理 id ⇒「一键接续」把它当源；
 *   · 而子代理会话目录随即被 `subagentGcSweep` 搬进 `subagent-gc-backup` ⇒
 *     转写包构造失败 ⇒ 工作区回退到「插件当前工作区」⇒ **新会话被建到错误工作区**。
 *
 * 本用例守两件**结构不变量**（不依赖运行时夹具，纯静态判据，抗环境漂移）：
 *   ① `_lastAgent` 的**每一处写入**都必须有子代理判据（两处写入者守卫必须对称）；
 *   ② `currentSessionId()` 必须显式排除子代理。
 * 另守一条**可见性不变量**：
 *   ③ `buildContinueCarry` 的工作区兜底必须留痕（不得再出现「静默 `|| p.ws`」）。
 *
 * 只读、零网络、零副作用。
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
const SRC = readFileSync(path.join(ROOT, 'lib', 'index.js'), 'utf8')

let pass = 0, fail = 0
const ok = (cond, name, detail) => {
  if (cond) { pass++; console.log('  ok -', name) }
  else { fail++; console.error('  FAIL -', name); if (detail) console.error('         ' + detail) }
}
/** 去注释（CRLF 安全），供负向断言使用。 */
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').split(/\r?\n/).map((l) => l.replace(/\/\/.*$/, '')).join('\n')

// ---------- ① 每一处 _lastAgent 写入都必须带子代理判据 ----------
// 收集行号：形如 `xxx._lastAgent = yyy` 的赋值（排除初始化 `= undefined` 与读取）
const lines = SRC.split(/\r?\n/)
const writes = []
for (let i = 0; i < lines.length; i++) {
  const t = lines[i]
  if (!/_lastAgent\s*=\s*[^=]/.test(t)) continue
  if (/_lastAgent\s*=\s*undefined/.test(t)) continue            // 构造函数初始化
  writes.push({ ln: i + 1, text: t.trim() })
}
ok(writes.length >= 2, `找到 _lastAgent 的写入点（${writes.length} 处，期望 ≥2）`, writes.map((w) => w.ln).join(', '))

for (const w of writes) {
  // 该写入点在**同一行**或**前 6 行**内出现子代理判据即视为受守卫
  const lo = Math.max(0, w.ln - 7), hi = w.ln
  const ctx = lines.slice(lo, hi).join('\n')
  const guarded = /isSubAgentSession\s*\(/.test(ctx) || /_ownSubagents\.has\s*\(/.test(ctx)
  ok(guarded, `_lastAgent 写入点 L${w.ln} 有子代理判据（与 restoreLastAgent 对称）`, w.text.slice(0, 100))
}

// ---------- ② currentSessionId 必须排除子代理 ----------
const cs = SRC.slice(SRC.indexOf('  currentSessionId() {'), SRC.indexOf('  currentSessionId() {') + 600)
ok(/isSubAgentSession\(\s*agent\s*\)/.test(cs), 'currentSessionId() 显式排除子代理（返回 \'\' 而非子代理 id）')
ok(!/return agent && agent\.session && agent\.session\.id \? String\(agent\.session\.id\) : ''/.test(cs),
  'currentSessionId() 已无「无判据直接返回 agent.session.id」的旧写法')

// ---------- ③ 工作区兜底必须留痕，不得静默 ----------
const stripped = strip(SRC)
ok(!/const wsForSession = \(pack && pack\.cwd\) \|\| p\.ws/.test(stripped),
  'buildContinueCarry 已无「pack 缺 cwd 时静默回退 p.ws」的旧写法')
ok(/sessionWorkspaceFallback\(prevSid\)/.test(stripped),
  'buildContinueCarry 会按源会话 id 反查真实工作区')
ok(/wsFallback: wsFallback/.test(stripped),
  'buildContinueCarry 把 wsFallback 透出给前端（供用户可见提示）')

// ---------- ④ 前端必须把回退告知用户 ----------
const CLIENT = readFileSync(path.join(ROOT, 'lib', 'client.js'), 'utf8')
ok(/d\.wsFallback/.test(CLIENT), 'client.js 消费 wsFallback 并提示用户（不再静默落到错误工作区）')

console.log(`\n[carry-source] pass=${pass} fail=${fail}`)
process.exit(fail ? 1 : 0)
