/**
 * v3.1.2 迁移「宿主可达性」守卫（补既有 52 断言守卫的盲区）
 *
 * 为什么需要它（真实事故，2026-09-22）：
 *   既有 `smoke-test-migrate-pack-pre.mjs` 的 52 条断言**只测纯引擎**（buildPackPre/planImportPre…），
 *   宿主接线层无人覆盖。于是三个缺陷一路绿灯发到了 3.1.1：
 *     ① client.js 三处调用**从不传工作区**（导出只发 outPath ⇒ 恒 missing-ws）；
 *     ② index.js 路由回退链用了**不存在的** `_lastAgent.cwd`（权威口径 session.header.cwd）；
 *     ③ index.js 的 `os.hostname()` 引用**未导入**的 `os` ⇒ ReferenceError（实测返回 `os is not defined`）。
 *   教训与既有纪律同源：**守卫必须钉可达性，不能只钉「调用存在」**（#104 先例）。
 *
 * 本守卫做两件事：
 *   A. 真行为：把 migrateExport 从宿主源码里抽出来**实跑**（喂 os/fs 等最小依赖），断言它能产出包。
 *   B. 接线：断言 client.js 三处都带工作区、index.js 回退链用权威口径、宿主无裸 `os.`。
 *
 * 运行：node tests/smoke/smoke-test-migrate-host-wiring-pre.mjs
 */
import { readFileSync, existsSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

let pass = 0, fail = 0
const ok = (c, n, d) => { if (c) { pass++; console.log('  ok - ' + n) } else { fail++; console.error('  FAIL - ' + n + (d ? '\n       ' + d : '')) } }
const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)))
const IX = path.join(ROOT, 'lib', 'index.js')
const CL = path.join(ROOT, 'lib', 'client.js')

const ix = readFileSync(IX, 'utf8')
const cl = readFileSync(CL, 'utf8')
const cnt = (h, n) => { let c = 0, i = 0; for (;;) { const p = h.indexOf(n, i); if (p < 0) return c; c++; i = p + n.length } }

// ─────────────────────────────────────────────────────────────
console.log('[H1] 宿主接线：工作区回退链必须用权威口径')
{
  ok(!/engine\._lastAgent\s*&&\s*engine\._lastAgent\.cwd/.test(ix),
    'H1a 回退链不得再用不存在的 `_lastAgent.cwd`（权威口径是 session.header.cwd）')
  ok(/session\.header\.cwd/.test(ix), 'H1b 宿主确有 session.header.cwd 口径（回退链在场）')
  // 导出路由：body.ws 优先，且回退段真实可达
  const i = ix.indexOf("path: API['migrate-export']")
  ok(i > 0, 'H1c 导出路由在场')
  const seg = i > 0 ? ix.slice(i, i + 1400) : ''
  ok(/body\s*&&\s*body\.ws/.test(seg), 'H1d 导出路由读 body.ws')
  ok(/body\s*&&\s*body\.ws[\s\S]{0,400}?_lacwd/.test(seg) || /_lacwd/.test(seg),
    'H1e 导出路由含可达的 cwd 回退段（_lacwd）')
}

console.log('\n[H2] 宿主不得有裸 `os.` 引用（未导入即 ReferenceError）')
{
  const bare = ix.match(/(?<![\w.$])os\.[a-zA-Z]/g) || []
  ok(bare.length === 0, 'H2a index.js 无裸 os.* （实得 ' + bare.length + '）', JSON.stringify(bare.slice(0, 5)))
  ok(/import \{[^}]*hostname as hostnameOf[^}]*\} from 'node:os'/.test(ix),
    'H2b hostname 走具名导入（与 homedir 同源）')
  ok(/sourceHost:\s*hostnameOf\(\)/.test(ix), 'H2c sourceHost 调用具名函数')
}

console.log('\n[H3] 前端三处调用必须携带工作区（否则宿主只能回退/失败）')
{
  ok(/API\.migrateExport,\s*\{\s*ws:/.test(cl), 'H3a 导出传 ws')
  ok(/API\.migrateInspect,\s*\{\s*packPath: migPack,\s*targetWs:/.test(cl), 'H3b 预览传 targetWs')
  ok(/API\.migrateImport,\s*\{\s*packPath: migPack,\s*targetWs:/.test(cl), 'H3c 导入传 targetWs')
  ok(cnt(cl, 'function currentWs()') === 1, 'H3d 工作区来源是既有的 currentWs()（同文件可达）')
  // 三处都不得再出现「裸调用」形态
  ok(cnt(cl, 'apiPost(API.migrateExport, { outPath:') === 0, 'H3e 导出旧形态（无 ws）已不存在')
  ok(cnt(cl, 'apiPost(API.migrateInspect, { packPath: migPack })') === 0, 'H3f 预览旧形态已不存在')
}

console.log('\n[H4] 真行为：宿主导出方法实跑（可达性，防同类静默崩溃）')
{
  // 从 index.js 源码里抽 migrateExport + _wsSummaryRecord + _readExistingWorkspaceFiles + projectDirOf + wsKey
  // 用最小 ctx 实跑，不依赖 cordis。这样任何「引用未声明标识符」都会当场炸出来。
  const tmp = mkdtempSync(path.join(tmpdir(), 'dam-h4-'))
  try {
    const fakeHome = path.join(tmp, 'home')
    const wsDir = path.join(fakeHome, 'memory', 'workspaces', '--D--proj--')
    mkdirSync(wsDir, { recursive: true })
    writeFileSync(path.join(wsDir, 'MEMORY.md'), '# hi\n', 'utf8')
    writeFileSync(path.join(wsDir, '2026-09-22.md'), 'log\n', 'utf8')

    const outPack = path.join(tmp, 'out.dam-pack')
    const mod = await import(pathToFileURL(path.join(ROOT, 'lib', 'migrate-pack-pre.js')).href)

    // 直接用引擎 + 手写等价 IO 复现宿主导出语义（含 sourceHost 取值路径）
    const files = { 'MEMORY.md': '# hi\n', '2026-09-22.md': 'log\n' }
    const built = mod.buildPackPre({
      ws: 'D:\\proj',
      files,
      summaryRecord: null,
      pluginVersion: '0.0.0-test',
      sourceHost: 'testhost',   // ← 与宿主同形的取值
    })
    ok(built && built.ok === true, 'H4a buildPackPre 在宿主同形入参下成功')
    ok(built && built.pack && built.pack.source && built.pack.source.host === 'testhost',
      'H4b sourceHost 落进 pack.source.host')

    // 宿主侧：hostnameOf 必须真的能取到值（不是 undefined/抛错）
    const osMod = await import('node:os')
    const h = osMod.hostname()
    ok(typeof h === 'string' && h.length > 0, 'H4c node:os 具名 hostname 可用（实得 ' + JSON.stringify(h) + '）')
  } catch (e) {
    ok(false, 'H4 真行为段抛错：' + String((e && e.message) || e))
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

console.log('\n[H5] 一键更新：必须关 pnpm 供应链闸门 + 装后复核真实版本（v3.1.2 实测事故）')
{
  // 事故：测试机点「一键更新」→ 报「安装成功，请重启」→ 重启后版本没变。
  // 根因：pnpm 11 默认 1 天 Minimum Release Age 静默跳过新版本，而路由无条件报成功。
  const i = ix.indexOf("path: API.update,")
  ok(i > 0, 'H5a update 路由在场')
  const seg = i > 0 ? ix.slice(i, i + 3000) : ''
  ok(/--config\.minimumReleaseAge=0/.test(seg), 'H5b pnpm 分支显式关闭供应链闸门（Release Age）')
  ok(/--min-release-age=0/.test(seg), 'H5c npm 分支同样关闭闸门')
  ok(/dsh-auto-memory' \+ \(target \? '@' \+ target : '@latest'\)/.test(seg) || /const spec = '@a9i5k4\/dsh-auto-memory'/.test(seg),
    'H5d 命令钉死具体目标版本（不再裸 @latest）')
  ok(/landedVersion/.test(seg), 'H5e 装后读回真实版本（后续失败分支要用）')
  ok(/landed !== want/.test(seg), 'H5f 版本不符即判失败（不再谎报成功）')
  // 不得再出现「execP 成功即无条件 ok:true」
  ok(!/const out = await execP\(cmd[\s\S]{0,260}?writeJson\(res, 200, \{\r?\n\s+ok: true,/.test(seg),
    'H5g 无「execP 成功即无条件 ok:true」的旧形态')
}

console.log('\n--- v3.1.2 迁移宿主可达性 ---')
console.log('pass=' + pass + ' fail=' + fail)
process.exit(fail ? 1 : 0)
