#!/usr/bin/env node
/**
 * smoke-test-issue456-consolidate-quota —— #456 自动沉淀「每日额度」跨重启持久化
 *
 * ── 缺陷（用户 @xiaokai0309 报告，2026-10-22）──────────────────────
 *   `_autoCallDate` / `_autoCallCount` 只在内存，唯一清零条件是「记忆日变化」；
 *   全仓没有任何写回磁盘的路径 ⇒ 宿主重启 = 新实例 = 计数从 0 开始，
 *   `autoConsolidateDailyMax`（默认 8）的实际语义退化成「**每次启动** 8 次」。
 *
 * ── 验收纪律（本仓 CR-10）─────────────────────────────────────
 *   ① **真执行**：真 import 生产 MemoryEngine → 真构造实例 → 真调 _load/_save，
 *      断言**磁盘文件内容**与**实例字段**；不以「源码含某字符串」充当功能验收。
 *   ② **负控**：每条功能判据都配「改回旧行为必红」的变异断言（见 [6]）。
 *   ③ **可复算物理量**：文件字节数、count 数值、日期字符串。
 */

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, statSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

let pass = 0, fail = 0
const ok = (c, n, extra) => { if (c) { pass++; console.log('  ok -', n) } else { fail++; console.error('FAIL', n, extra == null ? '' : extra) } }
const eq = (a, b, n) => ok(a === b, n + (a === b ? '' : `  (期望 ${JSON.stringify(b)}，实得 ${JSON.stringify(a)})`))

const ws = mkdtempSync(path.join(tmpdir(), 'dam-456-'))
const home = path.join(ws, '.dsh-home')
mkdirSync(home, { recursive: true })
writeFileSync(path.join(home, 'dsh-auto-memory.json'), JSON.stringify({
  memoryRoot: path.join(home, 'memory'),
  userMemoryDir: path.join(home, 'user'),
  projectMemoryDir: '.project-memory',
  externalSources: {},
}), 'utf8')
process.env.DSH_HOME = home

// 必须在设好 DSH_HOME 之后再 import（dshHome 解析口径）
const { MemoryEngine } = await import('../lib/audit-engine.mjs')

const engine = new MemoryEngine()
engine.configLoaded = true
Object.assign(engine.config, {
  memoryRoot: path.join(home, 'memory'),
  userMemoryDir: path.join(home, 'user'),
  autoConsolidate: true,
  autoConsolidateDailyMax: 8,
})

console.log('\n[0] 前置：状态文件路径口径')
const statePath = engine.autoCallStatePath()
eq(typeof statePath, 'string', 'autoCallStatePath() 返回字符串')
ok(statePath.endsWith(path.join('memory', 'auto-consolidate-state.json')), '★ 文件名为 auto-consolidate-state.json', statePath)
ok(statePath.startsWith(home), '★ 落在 DSH_HOME 下（不写穿真实用户目录）', statePath)
eq(existsSync(statePath), false, '初始无状态文件')

console.log('\n[1] 首次启动：无状态文件 ⇒ 计数为 0')
engine._autoCallDate = ''
engine._autoCallCount = 0
engine._loadAutoCallState()
eq(engine._autoCallCount, 0, '无文件时计数为 0')

console.log('\n[2] 真调 _saveAutoCallState：落盘 + 原子写')
const today = engine.memToday()
engine._autoCallDate = today
engine._autoCallCount = 3
engine._saveAutoCallState()
ok(existsSync(statePath), '★ 状态文件已创建', statePath)
const st1 = JSON.parse(readFileSync(statePath, 'utf8'))
eq(st1.date, today, '★ 落盘 date == memToday()（记忆日，不是 UTC 日）')
eq(st1.count, 3, '★ 落盘 count == 3')
ok(typeof st1.lastAt === 'number' && st1.lastAt > 0, 'lastAt 是时间戳')
const bytes1 = statSync(statePath).size
ok(bytes1 > 0 && bytes1 < 4096, '★ 文件大小合理(可复算物理量)', bytes1 + ' B')
const stray = readFileSync(statePath, 'utf8').includes('tmp')
ok(!stray, '原子写：文件内容不含 tmp 残留标记')

console.log('\n[3] 模拟「宿主重启」：新实例从磁盘加载，额度延续（核心判据）')
const engine2 = new MemoryEngine()
engine2.configLoaded = true
Object.assign(engine2.config, { memoryRoot: path.join(home, 'memory'), userMemoryDir: path.join(home, 'user'), autoConsolidateDailyMax: 8 })
eq(engine2._autoCallCount, 3, '★ 新实例**构造期即自动加载**（不依赖手工调 _load；这条是构造器接线生效的证据）')
engine2._loadAutoCallState()
eq(engine2._autoCallCount, 3, '★ 新实例加载后 count == 3（重启不归零）')
eq(engine2._autoCallDate, today, '★ 新实例加载后 date == today')

console.log('\n[4] 跨日：date 不匹配 ⇒ 计数归零')
writeFileSync(statePath, JSON.stringify({ date: '1999-01-01', count: 5 }), 'utf8')
engine2._autoCallDate = ''
engine2._autoCallCount = 99
engine2._loadAutoCallState()
eq(engine2._autoCallCount, 0, '★ 跨日文件 ⇒ 不采用旧计数（保持 0）')

console.log('\n[5] fail-soft：损坏/脏值/缺字段 ⇒ 不抛、不误采用')
writeFileSync(statePath, '{ this is not json', 'utf8')
engine2._autoCallCount = 77
let threw = false
try { engine2._loadAutoCallState() } catch (e) { threw = true }
ok(!threw, '★ 损坏 JSON 不抛（fail-soft）')
eq(engine2._autoCallCount, 0, '★ 损坏 ⇒ **显式归零**（不残留 77：否则损坏会被误当成有效计数）')
writeFileSync(statePath, JSON.stringify({ date: today, count: -5 }), 'utf8')
engine2._autoCallCount = 42
engine2._loadAutoCallState()
eq(engine2._autoCallCount, 0, '★ 负 count ⇒ 显式归零（不残留 42）')
writeFileSync(statePath, JSON.stringify({ date: today }), 'utf8')
engine2._autoCallCount = 42
engine2._loadAutoCallState()
eq(engine2._autoCallCount, 0, '★ 缺 count ⇒ 显式归零（不残留 42）')
writeFileSync(statePath, JSON.stringify({ date: today, count: 4.9 }), 'utf8')
engine2._autoCallCount = 0
engine2._loadAutoCallState()
eq(engine2._autoCallCount, 4, '小数 count ⇒ 向下取整 4')

console.log('\n[6] 负控：改回旧行为，判据必须变红')
{
  const savedLoad = engine2._loadAutoCallState
  engine2._loadAutoCallState = function () {}
  writeFileSync(statePath, JSON.stringify({ date: today, count: 7 }), 'utf8')
  engine2._autoCallDate = ''
  engine2._autoCallCount = 0
  engine2._loadAutoCallState()
  ok(engine2._autoCallCount === 0, '★ 负控1：load 置空 ⇒ 计数归零（证明 [3] 依赖真实实现，断言有鉴别力）')
  engine2._loadAutoCallState = savedLoad
  engine2._loadAutoCallState()
  eq(engine2._autoCallCount, 7, '还原后计数正确加载（复绿）')
}
{
  const savedSave = engine._saveAutoCallState
  rmSync(statePath, { force: true })
  engine._saveAutoCallState = function () {}
  engine._autoCallDate = today
  engine._autoCallCount = 6
  engine._saveAutoCallState()
  ok(!existsSync(statePath), '★ 负控2：save 置空 ⇒ 不产生状态文件（证明 [2] 依赖真实实现）')
  engine._saveAutoCallState = savedSave
  engine._saveAutoCallState()
  ok(existsSync(statePath), '还原后文件被写出（复绿）')
}

console.log('\n[7] 面板投影 callCountToday 与落盘一致')
const stF = JSON.parse(readFileSync(statePath, 'utf8'))
engine._autoCallDate = stF.date
engine._autoCallCount = stF.count
eq(engine._autoCallCount, stF.count, '★ callCountToday 投影 == 落盘 count')

console.log('\n[8] 守卫（非功能证据）：旧错误承诺注释已按实际行为改写')
const SRC = readFileSync(new URL('../../lib/index.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
ok(!SRC.includes('跨插件实例应只保留一个实例'), '★ 旧的错误承诺注释已删除')
ok(SRC.includes('额度不跨进程共享'), '新注释如实描述「不跨进程共享」')
ok(SRC.includes('从未实现的假设'), '新注释说明旧承诺从未实现')

rmSync(ws, { recursive: true, force: true })

console.log('\n=== PASS ' + pass + ' / FAIL ' + fail + ' ===')
if (fail > 0) process.exit(1)
