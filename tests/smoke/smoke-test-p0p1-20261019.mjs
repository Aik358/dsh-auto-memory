#!/usr/bin/env node
/**
 * smoke-test-p0p1-20261019.mjs -- 2026-10-19 P0/P1 修复的**零副作用**回归。
 *
 * 设计约束（本轮两次误写真实工作区后确立）：
 *   本文件**绝不**实例化 MemoryEngine、绝不调用任何会写盘的引擎方法，
 *   因为 audit-engine 的 resolvePaths 不受 DSH_HOME 隔离（实测会写穿到真实 ~/.dsh）。
 *   => 只做两件事：① 读源码做结构判据；② 纯函数断言。每条关键判据配变异反向验证。
 */
import { readFileSync } from 'node:fs'

let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  ok   - ' + m) } else { fail++; console.log('  FAIL - ' + m) } }
const SRC = readFileSync(new URL('../../lib/index.js', import.meta.url), 'utf8')

console.log('=== P0-1 compactLegacyLayer const -> let ===')
ok(/let cur = await readFile\(filePath, 'utf8'\)/.test(SRC), 'P0-1a cur 声明为 let')
ok(!/const cur = await readFile\(filePath, 'utf8'\)/.test(SRC), 'P0-1b 负路径：旧 const 声明已不存在')
ok(/if \(!cur\.trim\(\)\) cur = String\(/.test(SRC), 'P0-1c 兜底赋值逻辑仍在')
ok(!/let cur = await readFile\(filePath, 'utf8'\)/.test(SRC.replace("let cur = await readFile(filePath, 'utf8')", "const cur = await readFile(filePath, 'utf8')")), 'P0-1d 变异验证：改回 const 后判据必红')

console.log('=== P0-3 walk 防环（两处）===')
const walkDefs = [...SRC.matchAll(/const walk = async \(q, rel([^)]*)\) =>/g)].map(m => m[1])
ok(walkDefs.length === 2, 'P0-3a 共两处 walk 定义（实测 ' + walkDefs.length + '）')
ok(walkDefs.every(s => /depth/.test(s)), 'P0-3b 两处 walk 都接受 depth 形参（实测 ' + JSON.stringify(walkDefs) + '）')
ok(/const seenDirs = new Set\(\)/.test(SRC), 'P0-3c 读侧有 visited 集合')
ok(/const seenExportDirs = new Set\(\)/.test(SRC), 'P0-3d 导出侧有 visited 集合')
ok(/MAX_WALK_DEPTH/.test(SRC) && /MAX_EXPORT_DEPTH/.test(SRC), 'P0-3e 两处都有深度上限兜底')
const depths = (SRC.match(/d0 \+ 1/g) || []).length
ok(depths >= 2, 'P0-3f 递归调用均传 depth（实测 ' + depths + ' 处）')
ok(!/const seenExportDirs = new Set\(\)/.test(SRC.replace(/const seenExportDirs = new Set\(\)/, '')), 'P0-3g 变异验证：删掉集合后判据必红')

console.log('=== P1-1 迁移确认通道接线 ===')
const hits = (SRC.match(/allowUnprovenUserFiles: !!\(body && body\.allowUnprovenUserFiles === true\)/g) || []).length
ok(hits === 2, 'P1-1a inspect 与 import 两条路由都透传（实测 ' + hits + '，期望 2）')
ok(/o\.allowUnprovenUserFiles === true/.test(SRC), 'P1-1b 引擎层仍按 === true 严格判定')

console.log('=== P1-2 白板自愈提前 ===')
const iHeal = SRC.indexOf('healPlanDuplicateIdsPre(this.wbWsKeyPre(projectDir), existing)')
const iPrep = SRC.indexOf('await preparePlanPre(planPath, existing,')
ok(iHeal > 0, 'P1-2a 存在读盘后立即自愈调用')
ok(iPrep > 0 && iHeal < iPrep, 'P1-2b 自愈发生在 preparePlanPre 之前（顺序判据）')

console.log('=== P0-4 唤回面可观测性 ===')
ok(/recall tail: /.test(SRC), 'P0-4a 唤回面有专属 diag 前缀')
const reasons = ['skip: no agent', 'skip: no activationHost', 'empty: renderTailFor returned nothing', 'delivered']
const miss = reasons.filter(r => !SRC.includes(r))
ok(miss.length === 0, 'P0-4b 四个早退/成功点都有具体 reason（缺失 ' + JSON.stringify(miss) + '）')
ok(/_tailDiag/.test(SRC), 'P0-4c 有节流器避免每帧刷屏')

console.log('=== P1-3 就绪判据收敛 ===')
ok(/engine\.pythonReadinessPre = async \(\) => {/.test(SRC), 'P1-3a 存在统一判据 pythonReadinessPre')
const b0 = SRC.indexOf('engine.pythonReadinessPre = async () => {')
const b1 = SRC.indexOf('engine._pySemanticRank = async (', b0)
const body = SRC.slice(b0, b1 > b0 ? b1 : b0 + 2000)
ok(['modelPresent', 'interpreterOk', 'runtimeOk', 'ok', 'reason'].every(k => body.includes(k)), 'P1-3b 返回结构化三段 + reason')
ok(/out\.reason = /.test(body), 'P1-3c 未就绪必须写 reason')
ok(/await engine\.pythonReadinessPre\(\)/.test(body), 'P1-3d 旧别名复用统一判据')

console.log('=== v3.3.8 节奏降频 ===')
ok(/const DEFAULT_SNAPSHOT_MIN_GAP_ROUNDS = 20/.test(SRC), 'R-a 完整版默认 20')
ok(/const DEFAULT_SLIM_EVERY_ROUNDS = 8/.test(SRC), 'R-b 精简版默认 8')
ok(/const SLIM_EVERY_DEFAULTS_VERSION = 1/.test(SRC), 'R-c SLIM 有独立版本戳（不与 FULL 共用）')
const iFull = SRC.indexOf('const fullDone =')
const iSlimGuard = SRC.indexOf('const slimOnDiskVer =')
ok(iFull > 0 && iSlimGuard > iFull, 'R-d FULL 与 SLIM 各自守卫、互不阻塞')

console.log('')
console.log('[smoke-test-p0p1-20261019.mjs] PASS ' + pass + ' / FAIL ' + fail)
process.exit(fail === 0 ? 0 : 1)
