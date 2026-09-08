#!/usr/bin/env node
/** [ws-rank] 工作区总览采样排序回归(2026-09-08,issue #24)。
 * 直接导入随包发布的 lib/ws-overview-rank.js 纯函数:
 *   G1 活跃工作区排前:最新日志 mtime 降序
 *   G2 无记忆工作区(latest=0)沉底
 *   G3 恒返回全部 cwd(截尾是调用方职责,函数自身不丢工作区)
 *   G4 同分稳定:两次运行同结果
 *   G5 目录缺失/IO 失败不抛错(按无记忆处理)
 */
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync, readdirSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { rankWorkspacesByMemoryRecencyPre } from '../../lib/ws-overview-rank.js'

let pass = 0, fail = 0
const ok = (c, n) => { if (c) { pass++; console.log('  ok -', n) } else { fail++; console.log('  FAIL -', n) } }
const tmp = mkdtempSync(path.join(os.tmpdir(), 'dam-ws-rank-'))

const active = path.join(tmp, 'ws-active')
const old = path.join(tmp, 'ws-old')
mkdirSync(active, { recursive: true })
mkdirSync(old, { recursive: true })
writeFileSync(path.join(active, '2026-09-08.md'), '今日记录')
writeFileSync(path.join(active, 'MEMORY.md'), '笔记')
const NEW_T = new Date('2026-09-08T12:00:00')
const OLD_T = new Date('2026-09-04T12:00:00')
utimesSync(path.join(active, '2026-09-08.md'), NEW_T, NEW_T)
writeFileSync(path.join(old, '2026-09-04.md'), '旧记录')
utimesSync(path.join(old, '2026-09-04.md'), OLD_T, OLD_T)

const projectDirOf = (cwd) => path.join(tmp, cwd)
const readdir = async (dir) => { try { return readdirSync(dir) } catch (e) { return [] } }
const stat = async (p) => statSync(p)

console.log('[ws-rank] G1/G2 活跃优先,无记忆沉底')
const cwds = ['ws-no-mem', 'ws-old', 'ws-active', 'ws-also-no-mem']
const ranked1 = await rankWorkspacesByMemoryRecencyPre(cwds, projectDirOf, readdir, stat)
ok(ranked1[0] === 'ws-active', '活跃工作区排第 1(实际 ' + ranked1[0] + ')')
ok(ranked1[1] === 'ws-old', '旧工作区排第 2')
ok(ranked1.indexOf('ws-no-mem') > 1 && ranked1.indexOf('ws-also-no-mem') > 1, '无记忆工作区沉底')

console.log('[ws-rank] G3 恒返回全部 cwd')
ok(ranked1.length === cwds.length, '长度不变(' + ranked1.length + ')')

console.log('[ws-rank] G4 同分稳定')
const ranked2 = await rankWorkspacesByMemoryRecencyPre(cwds, projectDirOf, readdir, stat)
ok(JSON.stringify(ranked1) === JSON.stringify(ranked2), '两次运行同结果')

console.log('[ws-rank] G5 目录缺失不抛错')
const r5 = await rankWorkspacesByMemoryRecencyPre(['ws-missing'], projectDirOf, readdir, stat)
ok(Array.isArray(r5) && r5.length === 1 && r5[0] === 'ws-missing', '缺失目录按无记忆处理')

console.log('[ws-rank] 结果: pass=' + pass + ' fail=' + fail)
process.exit(fail ? 1 : 0)
