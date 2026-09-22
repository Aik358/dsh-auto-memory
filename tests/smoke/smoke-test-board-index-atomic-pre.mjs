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
 * 纪律：本套件同时做**行为断言**（按同一配方写一遍，验证「替换后目标文件完整、临时文件不残留」）
 * 与**接线断言**（源码里必须走 tmp+rename，且不得再出现裸写 index.json）。
 */
import { readFileSync, mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { rename } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
const INDEX = readFileSync(path.join(ROOT, 'lib', 'index.js'), 'utf8')

let pass = 0, fail = 0
const ok = (cond, msg) => { if (cond) { pass++; console.log('  ✓ ' + msg) } else { fail++; console.log('  ✗ FAIL: ' + msg) } }

console.log('== ① 源码接线：sidecar 索引必须原子替换，不得裸写 ==')
{
  const m = INDEX.match(/async _writeSidecarIndexPre\(projectDir, index\) \{[\s\S]*?\n  \}/)
  ok(!!m, '_writeSidecarIndexPre 存在（锚点命中，否则本套件空转）')
  const body = m ? m[0] : ''
  ok(/idxPath \+ '\.tmp'|idxPath \+ "\.tmp"/.test(body), '★写临时文件（index.json.tmp）而不是直接写目标')
  ok(/await retryRename\(tmpPath, idxPath\)/.test(body), '★用 retryRename 原子替换（Windows 句柄争用有界退避）')
  ok(!/await writeFile\(path\.join\(sideDir, 'index\.json'\)/.test(INDEX), '★旧的裸写 index.json 已消失（回归即红）')
  ok(/import \{ retryRename \} from '\.\/fs-retry.js'/.test(INDEX), 'retryRename 已导入')
  ok(/await mkdir\(sideDir, \{ recursive: true \}\)/.test(body), '写入前仍确保目录存在（未顺手删掉既有前置）')
}

console.log('== ② 行为断言：同一配方替换后，目标完整、临时文件不残留 ==')
{
  const dir = mkdtempSync(path.join(os.tmpdir(), 'wbidx-'))
  try {
    const f = path.join(dir, 'index.json')
    const tmp = f + '.tmp'
    writeFileSync(f, JSON.stringify({ entries: [{ id: 'old' }] }), 'utf8')
    const fresh = { schemaVersion: 'wb_sidecar_v1', entries: Array.from({ length: 500 }, (_, i) => ({ id: 'e' + i })) }
    writeFileSync(tmp, JSON.stringify(fresh, null, 2), 'utf8')
    await rename(tmp, f) // Node 在 Windows 走 MOVEFILE_REPLACE_EXISTING，语义等同替换
    ok(!existsSync(tmp), '替换后临时文件不残留')
    const back = JSON.parse(readFileSync(f, 'utf8'))
    ok(back.entries.length === 500 && back.entries[499].id === 'e499', '替换后目标文件是**完整的**新内容（不是半截）')
  } finally {
    try { rmSync(dir, { recursive: true, force: true }) } catch (_) {}
  }
}

console.log('== ③ 读侧容错仍在（缺文件/坏 JSON → 重建，不抛给调用方） ==')
{
  const m = INDEX.match(/async _loadSidecarIndexPre\(projectDir\) \{[\s\S]*?\n  \}/)
  ok(!!m && /catch \(_\) \{ return await this\.rebuildSidecarIndexPre\(projectDir\) \}/.test(m[0]), '读侧仍是「失败即重建」（原子写是为了不再触发它，而不是改它的语义）')
}

console.log('\n== board-index-atomic 结果 == PASS ' + pass + ' / FAIL ' + fail)
if (fail > 0) process.exitCode = 1
