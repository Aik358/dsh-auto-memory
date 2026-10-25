#!/usr/bin/env node
// v4-H2-H0 接线套件：memory_note 事件侧双写（H2）+ boardMode 解耦（H0）的逐条判据。
// ★为什么需要它（2026-10-25 事故教训）：这两处接线此前**没有任何逐条守卫**，
//   只有 h2-note-event / graph-mode 的「端到端绿」作为间接证据 ⇒ 事故重建时无法证明形状正确。
//   本套件把「接线形状」变成机械可检的 15 条断言。
// 用法：node tests/smoke/smoke-test-v4-h2-h0-wiring.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const IX = fs.readFileSync(path.join(ROOT, 'lib', 'index.js'), 'utf8')
let pass = 0, fail = 0
const ok = (c, n, d) => { if (c) { pass++; console.log('  PASS ' + n + (d ? ' => ' + d : '')) } else { fail++; console.log('  FAIL ' + n + (d ? ' => ' + d : '')) } }

// ── H2：memory_note 事件侧双写（6 条）──────────────────────────────
console.log('[H2] memory_note 事件侧双写')
{
  const a = IX.indexOf("defineTool('memory_note'")
  const z = IX.indexOf("defineTool('memory_user'")
  const B = IX.slice(a, z)
  ok(a > 0 && z > a, 'H2-0 能切出 memory_note 分支', 'len=' + B.length)
  ok(/import \{[^}]*appendHandoffCheckpointPre[^}]*\} from '\.\/event-write\.js'/.test(IX), 'H2-1 import 了 appendHandoffCheckpointPre')
  ok(/import \{[^}]*mirrorPlanSectionsPre[^}]*\}/.test(IX) && /import \{[^}]*parseLedgerSectionsPre[^}]*\}/.test(IX), 'H2-2 import 了 mirrorPlanSectionsPre 与 parseLedgerSectionsPre')
  // ★2026-10-25 C1 判据更新（用户裁定「memory note 要追加在事件下，以事件为中心」）：
  //   旧判据钉的是「handoff 分支调 appendHandoffCheckpointPre(storePathEv, {ledgerText})」——
  //   那是 **.md 写成功之后** 的镜像路径。C1 改为 **WAL：Phase1 先 append 事件**（kind 可区分
  //   plan/handoff），handoff 与 plan 走同一条 append 通道 ⇒ 旧字面量不再存在。
  //   判据改为：存在 Phase1 的 append 调用，且 kind 参数能区分两种语义。**不是放宽** ——
  //   下面 H2-7 改为在 Phase1 上验「先于 .md 写入」，比旧判据更强（旧版只验「在 r.ok 之后」）。
  ok(/appendHandoffCheckpointPre\(storePathEv1, \{/.test(B) && /kind:\s*args\.kind === 'plan' \? 'plan' : 'handoff'/.test(B), 'H2-3 ★C1：Phase1 调 appendHandoffCheckpointPre 且 kind 区分 plan/handoff')
  ok(/mirrorPlanSectionsPre\(storePathEv, \{ sections: secP \}\)/.test(B), 'H2-4 plan 分支调 mirrorPlanSectionsPre')
  // ★2026-10-25 C1 判据更新：WAL 后「半完成」有**两个方向** ——
  //   Phase1 失败 ⇒ 中止（事件优先，连 .md 都不写）；Phase2 失败 ⇒ 补偿 checkpoint + 如实报错。
  //   旧判据只认「已写成功，但事件侧记录失败」这一句（那是旧的 .md 优先语义）。
  ok(/let eventWarn = ''/.test(B) && (/已写成功，但事件侧刷新失败/.test(B) || /已写成功，但事件侧记录失败/.test(B)), 'H2-5 ★C1：eventWarn 变量 + 半完成文案（新语义：事件侧刷新失败）')
  ok(/\+ eventWarn\b/.test(B), 'H2-6 eventWarn 真的拼进回执')
  // ★★关键：事件侧必须受 r.ok 守卫（否则主写失败时仍会碰事件库 ⇒ i332 变异③失效）
  const g = B.indexOf('if (r && r.ok) {')
  const ew = B.indexOf("let eventWarn")
  const ap = B.indexOf('appendHandoffCheckpointPre(storePathEv')
  // ★2026-10-25 C1 判据更新：守卫语义从「在 r.ok 之后才碰事件」变成
  //   「Phase1 append 在 writePlanSnapshot **之前**」（WAL 方向反转）。这是**更强**的断言：
  //   旧版只保证「不成功不写事件」，新版保证「事件一定先落」。
  const ph1 = B.indexOf('appendHandoffCheckpointPre(storePathEv1')
  const ph2 = B.indexOf('await engine.writePlanSnapshot(')
  ok(ph1 > 0 && ph2 > 0 && ph1 < ph2, 'H2-7 ★★C1 WAL：Phase1 事件 append 早于 writePlanSnapshot（方向反转）', 'phase1@' + ph1 + ' phase2@' + ph2)
  ok(ew > 0 && ew < g, 'H2-8 eventWarn 声明在守卫**外面**（回执要读它）', 'decl@' + ew + ' guard@' + g)
}

// ── H0：boardMode 解耦（5 条）──────────────────────────────────────
console.log('[H0] boardMode 解耦')
{
  // H0-1/2：两处 sidecar 写盘不再被 boardMode 闸门包住
  // ★判据修正（2026-10-25 Lead）：**不能一刀切「所有 boardMode===graph 闸门都必须没」** ——
  //   本仓有 4 处**合法**的渲染/注入门（graph 档才注入白板 tag 地图、才返回 structured 字段等），
  //   它们的意图是「legacy 档必须与旧行为逐字节相同」，删掉会造成注入面/返回结构变化。
  //   H0 解耦只针对**写盘侧**（sidecar 事件）与**工具注册侧**，故判据必须**按闸门体内是什么**来判。
  const gateBodies = []
  {
    const gateRe = /if \(\(String\(\(this\.config \|\| \{\}\)\.boardMode \|\| ''\)\.trim\(\)\.toLowerCase\(\) === 'graph'\)\) \{/g
    let m
    while ((m = gateRe.exec(IX))) {
      // 取闸门体（到下一个 6 空格缩进的 '}' 或 2000 字符内）
      const st = m.index + m[0].length
      const en = IX.indexOf('\n      }', st)
      gateBodies.push(IX.slice(st, en > 0 ? en : st + 2000))
    }
  }
  ok(!gateBodies.some((b) => /appendSidecarEventPre/.test(b)), 'H0-1 无「boardMode===graph」闸门包 appendSidecarEventPre（共 ' + gateBodies.length + ' 个 boardMode 闸门，逐个体检）')
  ok(gateBodies.length === 4, 'H0-1b 剩余 4 处 boardMode 闸门**都是渲染/注入门**（合法保留），数量未漂移', 'count=' + gateBodies.length)
  ok(/await this\.appendSidecarEventPre\(projectDir, \{ actor: 'engine', event: 'written', target: 'PLAN\.md'/.test(IX), 'H0-2 PLAN 的 appendSidecarEventPre 无条件执行')
  ok(/await this\.appendSidecarEventPre\(projectDir, \{ actor: 'engine', event: 'written', target: path\.basename\(p\)/.test(IX), 'H0-3 账本的 appendSidecarEventPre 无条件执行')
  // H0-4：工具注册不再被 graphEnabled 闸门包住
  ok(!/if \(resolveBoardModePre\(engine\.config\.boardMode\)\.graphEnabled\) \{/.test(IX), 'H0-4 工具注册无 graphEnabled 闸门')
  const pi = IX.indexOf("defineTool('memory_expand'")
  const ti = IX.indexOf("defineTool('memory_trace'")
  const arrEnd = IX.lastIndexOf('  ]\n', pi)
  ok(pi > 0 && ti > pi, 'H0-5 memory_expand / memory_trace 都在场且顺序正确', 'expand@' + pi + ' trace@' + ti)
}

console.log('')
console.log('[H2+H0] ' + pass + ' PASS / ' + fail + ' FAIL')
process.exit(fail ? 1 : 0)
