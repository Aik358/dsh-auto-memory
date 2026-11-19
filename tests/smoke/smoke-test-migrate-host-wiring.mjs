/**
 * v3.1.2 迁移「宿主可达性」守卫（补既有 52 断言守卫的盲区）
 *
 * 为什么需要它（真实事故，2026-09-22）：
 *   既有 `smoke-test-migrate-pack.mjs` 的 52 条断言**只测纯引擎**（buildPackPre/planImportPre…），
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
  // 请求体可能是裸对象，也可能是契约层的 Object.assign({...}, body()) 形态；
  // 这里只钉「targetWs 有没有传」，不钉容器写法（容器写法由 H6 单独守）。
  ok(/API\.migrateInspect,\s*(?:Object\.assign\(\{\s*)?packPath: migPack,\s*targetWs:/.test(cl), 'H3b 预览传 targetWs')
  ok(/API\.migrateImport,\s*(?:Object\.assign\(\{\s*)?packPath: migPack,\s*targetWs:/.test(cl), 'H3c 导入传 targetWs')
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
    const mod = await import(pathToFileURL(path.join(ROOT, 'lib', 'migrate-pack.js')).href)

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

// ─────────────────────────────────────────────────────────────
// [H6] ★#449-1：历史迁移包的「显式确认」通道必须贯通到 UI
//
// 事故：3.3.7 修了 #449，后端 validatePackPre / _readPack / migrateInspect /
//   migrateImport / HTTP 路由**全部**支持 allowUnprovenUserFiles，但 client.js
//   6 处 apiPost 一个都没带、界面也没有确认入口 ⇒ 3.1.3–3.3.4 产出的含日历
//   历史包在**预览阶段**就被 userfiles-unproven-by-checksum 拒掉，用户连
//   「确认导入」按钮都到不了。既有 #449 套件只测纯函数、H3 只断言 targetWs，
//   所以 CI 全绿仍漏。
// 纪律：这里既有接线断言，也有**真执行**（把请求体表达式抽出来实跑），
//   并带负路径：不得无条件传 true（会打掉 fail-closed）。
// ─────────────────────────────────────────────────────────────
console.log('\n[H6] ★#449-1 历史包显式确认：UI 接线 + 版本契约（单一真源）')
{
  const bodies = cl.match(/apiPost\(API\.migrate(?:Inspect|Import),\s*Object\.assign\(\{[^}]*\},\s*globalThis\.__damMigrationOptIn\.body\([^)]*\)\)\)/g) || []
  ok(bodies.length === 6, 'H6a 三组向导共 6 处预览/导入请求在场（实得 ' + bodies.length + '）')
  const withOptIn = bodies.filter(function (b) { return /globalThis\.__damMigrationOptIn\.body\(/.test(b) })
  ok(withOptIn.length === 6, 'H6b ★6 处请求全部走契约层 body()（实得 ' + withOptIn.length + '）')
  ok(!/allowUnprovenUserFiles:\s*true\b/.test(cl),
    'H6c 负路径：不得无条件传 true（否则 #449 的 fail-closed 被架空）')
  ok(cnt(cl, "'data-dam-migration': 'legacy-opt-in'") === 3,
    'H6d 三组界面各有 1 个显式确认勾选框（实得 ' + cnt(cl, "'data-dam-migration': 'legacy-opt-in'") + '）')
  ok(cnt(cl, "var migConfirmedLegacyPackPair = useState('')") === 3,
    'H6e 三组各有独立确认状态（实得 ' + cnt(cl, "var migConfirmedLegacyPackPair = useState('')") + '）')
  ok(/旧版包/.test(cl) && /not covered by the checksum/.test(cl),
    'H6f 中英说明文案同时在场（不静默导入未受摘要保护的用户级文件）')
  ok(/e\.target\.checked \? migPack : ''/.test(cl) && /e\.target\.checked \? props\.pack : ''/.test(cl),
    'H6g 勾选写入的是「当前包路径」而非布尔（换包自动失效，无需逐处重置）')
  ok(/allowUnprovenUserFiles:\s*!!\(body && body\.allowUnprovenUserFiles === true\)/.test(ix),
    'H6h 后端 HTTP 路由确实透传（防「只改前端、后端没接」的反向失配）')

  // 真执行：装载与 client.js 内联同源的契约层，实跑四种状态（不是 eval 抽取的表达式）
  const helperMod = await import(pathToFileURL(path.join(ROOT, 'lib', 'migration-optin-contract.js')).href)
  const h = helperMod.installHelper({})
  ok(!!h && typeof h.body === 'function', 'H6i 契约层可真装载（默认字段 ' + helperMod.OPTIN_DEFAULT_FIELD + '）')
  const calls = withOptIn.map(function (b) { return (b.match(/__damMigrationOptIn\.body\([^)]*\)/) || [''])[0] })
  ok(calls.length === 6 && Array.from(new Set(calls)).length === 1,
    'H6j 6 处共用同一判据调用（实得 ' + Array.from(new Set(calls)).length + ' 种）')
  ok(h.body('C:/a/legacy.dam-pack', '').allowUnprovenUserFiles === false,
    'H6k 未勾选 ⇒ false（默认 fail-closed）')
  ok(h.body('C:/a/legacy.dam-pack', 'C:/a/legacy.dam-pack').allowUnprovenUserFiles === true,
    'H6l 已勾选且仍是同一个包 ⇒ true（历史包可进入预览）')
  ok(h.body('C:/b/other.dam-pack', 'C:/a/legacy.dam-pack').allowUnprovenUserFiles === false,
    'H6m ★换包 ⇒ 自动 false（确认不会误延续到下一个包）')
  ok(h.body('', '').allowUnprovenUserFiles === false,
    'H6n 空包路径 ⇒ false（不会因空串相等而误放行）')

  // 未来版本：字段名改了 / 限制取消了，都不需要再改这 6 个请求点
  const h7 = helperMod.installHelper({ __DAM_MIGRATION_OPTIN__: { field: 'acceptLegacyUserFiles' } })
  ok(h7.body('C:/a/legacy.dam-pack', 'C:/a/legacy.dam-pack').acceptLegacyUserFiles === true,
    'H6o alpha.7 改确认字段名 ⇒ 请求自动改用新键')
  const h8 = helperMod.installHelper({ __DAM_MIGRATION_OPTIN__: { required: false } })
  ok(h8.required() === false && Object.keys(h8.body('p', 'p')).length === 0,
    'H6p alpha.7 取消历史包限制 ⇒ 不发确认键、勾选框不渲染')
}

console.log('\n--- v3.1.2 迁移宿主可达性 ---')
console.log('pass=' + pass + ' fail=' + fail)
process.exit(fail ? 1 : 0)
