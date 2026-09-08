#!/usr/bin/env node
/** [water-step] M-CM6-A 水位 v3 回归:pre-step 边界补测(2026-09-08)。
 * 背景(实锤):官方自动压缩 dsh-compaction-basic 挂在 `agent/pre-step`,thresholdRatio=0.8;
 * 插件此前只在 `agent/turn-stopping` 测量,某一轮把水位从 <阈值 推到 ≥0.8 时,官方在该轮 pre-step
 * 就压缩完,交接白板/账本来不及写(实测 20:11 轮末 768158/1000000=0.77 时,会话日志已有 2 次 compaction)。
 *   W1 源码守卫:checkWaterLevelAtStep 存在;pre-step 处理器调用它;turn-stopping 仍保留轮末测量
 *   W2 行为:节流窗口内重复调用只测一次;超窗口后再次测量
 *   W3 行为:handoffEnabled=false 完全不测;无可靠 session 身份的匿名 agent 不测
 *   W4 行为:checkWaterLevel 抛错不影响调用方(内部 void + try)
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SRC = readFileSync(path.resolve(HERE, '..', '..', 'lib', 'index.js'), 'utf8')
let pass = 0, fail = 0
const ok = (c, n) => { if (c) { pass++; console.log('  ok -', n) } else { fail++; console.log('  FAIL -', n) } }

function extractFn(header) {
  const start = SRC.indexOf(header)
  if (start < 0) throw new Error('not found: ' + header)
  let depth = 0, end = -1
  for (let i = start + header.length - 1; i < SRC.length; i++) {
    if (SRC[i] === '{') depth++
    else if (SRC[i] === '}') { depth--; if (depth === 0) { end = i; break } }
  }
  if (end < 0) throw new Error('unbalanced: ' + header)
  return SRC.slice(start, end + 1)
}

console.log('[water-step] W1 源码守卫:pre-step 补测已接线')
ok(SRC.includes('checkWaterLevelAtStep(agent, minGapMs = 5000) {'), 'checkWaterLevelAtStep 定义存在')
ok(/try \{ engine\.checkWaterLevelAtStep\(agent\) \} catch \(eWL\) \{\}/.test(SRC), 'pre-step 处理器调用 checkWaterLevelAtStep(带 try 保护)')
ok(SRC.includes('void engine.checkWaterLevel(agent)'), 'turn-stopping 仍保留轮末测量')
ok(/waterStepAt/.test(SRC) && /now - rt\.waterStepAt < minGapMs/.test(SRC), '节流状态 waterStepAt + 窗口判断存在')
ok(SRC.includes('thresholdRatio=0.8') && /compaction\/start\+summary/.test(SRC), '注释记录官方压缩阈值与实锤证据')

console.log('[water-step] W2/W3/W4 行为:节流 / 开关 / 身份守卫 / 异常隔离')
const body = extractFn('checkWaterLevelAtStep(agent, minGapMs = 5000) {')
function makeEngine(cfg, opts) {
  const calls = []
  const store = new Map()
  const eng = {
    config: cfg || {},
    runtimeFor(agent) {
      const k = agent && agent.session && agent.session.id
      if (!store.has(k)) store.set(k, {})
      return store.get(k)
    },
    hasReliableSessionIdentity(agent) {
      return !!(agent && agent.session && agent.session.id && (!opts || opts.reliable !== false))
    },
    checkWaterLevel(agent) {
      calls.push(agent)
      // 真实 checkWaterLevel 自身有 try/catch 全包,不会 reject;这里模拟「即便 reject」,
      // 由调用点 try 保护 + void 语义保证不冒泡到 pre-step(测试自行挂 catch 防 Node 未处理拒绝)。
      if (opts && opts.throwInCheck) {
        const p = Promise.reject(new Error('boom'))
        p.catch(() => {})
        return p
      }
      return Promise.resolve()
    },
  }
  const fn = new Function('diag', 'return {' + body + '};')(() => {}).checkWaterLevelAtStep.bind(eng)
  return { fn, calls }
}

const agentA = { session: { id: 'session-a' } }
const agentB = { session: { id: 'session-b' } }

// 节流:同一 agent 5s 内只测一次
const e1 = makeEngine({}, {})
e1.fn(agentA)
e1.fn(agentA)
e1.fn(agentA)
ok(e1.calls.length === 1, '节流窗口内重复调用只测一次(实际 ' + e1.calls.length + ')')
e1.fn(agentB)
ok(e1.calls.length === 2, '不同会话各自计时,不受彼此节流影响')
e1.fn(agentA, 0)
ok(e1.calls.length === 3, 'minGapMs=0 时立即再次测量(可配置)')

// 超过窗口后可再测
const e2 = makeEngine({}, {})
e2.fn(agentA, 0)
e2.fn(agentA, 0)
ok(e2.calls.length === 2, '窗口归零后可连续测量')

// handoffEnabled=false 完全不测
const e3 = makeEngine({ handoffEnabled: false }, {})
e3.fn(agentA, 0)
e3.fn(agentA, 0)
ok(e3.calls.length === 0, 'handoffEnabled=false 时不测量')

// 身份守卫:匿名对象不测
const e4 = makeEngine({}, {})
e4.fn(null, 0)
e4.fn({}, 0)
e4.fn({ session: {} }, 0)
ok(e4.calls.length === 0, '无可靠 session 身份的 agent 不测量')

// 异常隔离:checkWaterLevel reject 不得抛出到调用方
const e5 = makeEngine({}, { throwInCheck: true })
let threw = false
try { e5.fn(agentA, 0) } catch (e) { threw = true }
ok(!threw, 'checkWaterLevel 抛错不冒泡到 pre-step 调用方(void + try)')
await new Promise((r) => setTimeout(r, 10))

console.log('\n[water-step] ' + pass + '/' + (pass + fail) + ' assertions passed')
if (fail) process.exit(1)
