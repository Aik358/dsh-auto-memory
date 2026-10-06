/**
 * 看板索引原子写守卫 —— 「白板不见了，过了一会儿又出现」的回归防线（2026-09-22）。
 *
 * ── 被守卫的现象 ──
 * 用户实测：记忆面板的白板/看板会**整块空白**，几秒后自行恢复。
 * 根因（代码取证）：`handoff/index.json` 是 235 KB 的**整份**索引，旧实现是裸
 * `await writeFile(idxPath, JSON.stringify(fresh, null, 2))` —— 写入过程不原子，
 * 恰好在此刻读取的读者会拿到**零字节 / 半截 JSON** ⇒ `JSON.parse` 抛错 ⇒ 看板渲染成空。
 * 时间戳可对上：索引在 09-22 00:52:10 被整份重写，同一秒宿主诊断连出 6 条
 * `ctx-host degrade: index-not-ready(commit)`。
 * 现在改为 **tmp + 有界重试 rename**（原子替换；Windows 读侧句柄争用由 `retryRename` 退避）。
 *
 * 纪律：本套件同时做**行为断言**（调用完整生产引擎，验证「替换后目标文件完整、临时文件不残留」）
 * 与**接线断言**（源码里必须走 tmp+rename，且不得再出现裸写 index.json）。
 */
import { readFileSync, mkdtempSync, writeFileSync, existsSync, rmSync, readdirSync, mkdirSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadMemoryFixtureFactory } from '../lib/memory-engine-fixture.mjs'
import assert from 'node:assert/strict'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
const INDEX = readFileSync(path.join(ROOT, 'lib', 'index.js'), 'utf8')

let pass = 0, fail = 0
const ok = (cond, msg) => { if (cond) { pass++; console.log('  ✓ ' + msg) } else { fail++; console.log('  ✗ FAIL: ' + msg) } }

console.log('== ① 源码接线：sidecar 索引必须原子替换，不得裸写 ==')
{
  const m = INDEX.match(/async _writeSidecarIndexPre\(projectDir, index\) \{[\s\S]*?\n  \}/)
  ok(!!m, '_writeSidecarIndexPre 存在（锚点命中，否则本套件空转）')
  const wrapper = m ? m[0] : ''
  ok(/this\._withMemoryMutationPre\(projectDir,/.test(wrapper) && /this\._writeSidecarIndexBoundPre\(projectDir, index\)/.test(wrapper), '公开入口在真实事务门内委托原子写者')
  const bound = INDEX.match(/async _writeSidecarIndexBoundPre\(projectDir, index\) \{[\s\S]*?\n  \}/)
  ok(!!bound, '被委托原子写者存在')
  const body = bound ? bound[0] : ''
  ok(/await writeTextAtomicPre\(idxPath,/.test(body), '★写临时文件（index.json.tmp）而不是直接写目标')
  ok(/if \(!saved.ok\) throw new Error/.test(body), '★用 retryRename 原子替换（Windows 句柄争用有界退避）')
  ok(!/await writeFile\(path\.join\(sideDir, 'index\.json'\)/.test(INDEX), '★旧的裸写 index.json 已消失（回归即红）')
  ok(/import \{ retryRename \} from '\.\/fs-retry\.js'/.test(INDEX), 'retryRename 已导入')
  ok(/await mkdir\(sideDir, \{ recursive: true \}\)/.test(body), '写入前仍确保目录存在（未顺手删掉既有前置）')
}

console.log('== ② 行为断言：生产事务入口替换后，目标完整、临时文件不残留 ==')
{
  const dir = mkdtempSync(path.join(os.tmpdir(), 'wbidx-'))
  try {
    const makeFixture = await loadMemoryFixtureFactory(dir)
    const engine = makeFixture()
    const projectDir = engine.projectDirOf('fixture-workspace')
    const sideDir = path.join(projectDir, 'handoff')
    mkdirSync(sideDir, { recursive: true })
    const f = path.join(sideDir, 'index.json')
    writeFileSync(f, JSON.stringify({ entries: [{ id: 'old' }] }), 'utf8')
    const fresh = { schemaVersion: 'wb_sidecar_pre_v1', entries: Array.from({ length: 500 }, (_, i) => ({ id: 'e' + i, source: 'MEMORY.md', title: 'Entry ' + i, tags: [], cues: [] })) }
    await engine._writeSidecarIndexPre(projectDir, fresh)
    ok(!readdirSync(sideDir).some(name => /\.tmp/.test(name)), '生产原子替换后临时文件不残留')
    ok(!existsSync(engine._configPath + '.lock'), '生产事务门释放，无锁残留')
    const back = JSON.parse(readFileSync(f, 'utf8'))
    ok(back.entries.length === 500 && back.entries[499].id === 'e499', '替换后目标文件是**完整的**新内容（不是半截）')
    // Prove the fixture retained the real durable policy and binding gate:
    // changing only disk policy/root cannot be bypassed by its cached config.
    writeFileSync(engine._configPath, JSON.stringify({ ...engine.config, teamEnabled: true, teamMemberId: 'synthetic-member', teamMemberRole: 'viewer' }))
    await assert.rejects(engine._writeSidecarIndexPre(projectDir, { entries: [] }), error => error.code === 'team-forbidden')
    ok(JSON.parse(readFileSync(f, 'utf8')).entries.length === 500, '真实持久权限拒绝保留原索引，fixture 无授权旁路')
    writeFileSync(engine._configPath, JSON.stringify({ ...engine.config, memoryRoot: path.join(dir, 'moved'), projectMemoryDir: path.join(dir, 'moved') }))
    await assert.rejects(engine._writeSidecarIndexPre(projectDir, { entries: [] }), error => error.code === 'SETTINGS_ROOT_CHANGED')
    ok(JSON.parse(readFileSync(f, 'utf8')).entries.length === 500, '真实绑定变更拒绝旧路径，fixture 无事务旁路')

  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

console.log('== ③ 读侧容错仍在（缺文件/坏 JSON → 重建，不抛给调用方） ==')
{
  const m = INDEX.match(/async _loadSidecarIndexPre\(projectDir\) \{[\s\S]*?\n  \}/)
  ok(!!m && /catch \(_\) \{ return await this\.rebuildSidecarIndexPre\(projectDir\) \}/.test(m[0]), '读侧仍是「失败即重建」（原子写是为了不再触发它，而不是改它的语义）')
}

console.log('\n== board-index-atomic 结果 == PASS ' + pass + ' / FAIL ' + fail)
if (fail > 0) process.exitCode = 1
