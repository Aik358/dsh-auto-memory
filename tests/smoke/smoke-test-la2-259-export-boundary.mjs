/**
 * smoke-test-la2-259-export-boundary —— #259 SEC-03 行为级验收（2026-10-08）。
 *
 * 缺陷：`migrateExport` 打包时**跟随 symlink**，把记忆根之外的文件内容打进导出包
 *   （报告者在 Ubuntu/ext4 上对旧基线 7c0d614 复现：`pack.files` 出现 `outside.md`）。
 * 修法：打包边界改用 `lib/file-boundary.js` 的 `fileWithinRoots`（组件级物理边界），
 *   并**读被校验过的物理路径**；越界条目拒绝并计入 `skipped`（不静默丢）。
 *
 * 判据纪律：全部走 **真 fixture → 真构造引擎 → 真调 `migrateExport` → 断言产物**；
 *   负路径用 `DAM_AUDIT_ENGINE_SOURCE` 接缝载入**定点变异**的 index.js（去边界校验），
 *   断言根外内容**又进包**（变异必红），还原后必绿。
 *
 * 纯 Node、零依赖、不联网。
 */
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, readFileSync, existsSync, rmSync, readdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { gunzipSync } from 'node:zlib'
import { pathToFileURL } from 'node:url'

const ROOT = path.resolve(import.meta.dirname, '..', '..')
let pass = 0
let fail = 0
let skippedEnv = 0
const ok = (cond, name) => { if (cond) { pass++; console.log('  ok - ' + name) } else { fail++; console.error('  FAIL - ' + name) } }
const skip = (name) => { skippedEnv++; console.log('  SKIP(环境) - ' + name) }
const eq = (a, b, name) => { const ja = JSON.stringify(a); const jb = JSON.stringify(b); ok(ja === jb, name + (ja === jb ? '' : ' got=' + ja + ' want=' + jb)) }

const tmps = []
const mkroot = (tag) => { const d = mkdtempSync(path.join(tmpdir(), 'dam-la2-' + tag + '-')); tmps.push(d); return d }

let shimSeq = 0
/** 载入产线引擎；mutations 非空时按定点变异走 DAM_AUDIT_ENGINE_SOURCE 接缝。 */
async function loadEngine(mutations = []) {
  const shim = path.join(ROOT, 'tests', 'lib', 'audit-engine.mjs')
  if (!mutations.length) { delete process.env.DAM_AUDIT_ENGINE_SOURCE; return await import(pathToFileURL(shim).href + '?v=' + (++shimSeq)) }
  let src = readFileSync(path.join(ROOT, 'lib', 'index.js'), 'utf8')
  for (const [from, to] of mutations) {
    const hits = src.split(from).length - 1
    assert.equal(hits, 1, 'mutation anchor must hit exactly once: ' + JSON.stringify(from.slice(0, 70)) + ' hits=' + hits)
    src = src.replace(from, to)
  }
  const dir = mkroot('mut')
  const f = path.join(dir, 'index-mutant-' + (++shimSeq) + '.mjs')
  writeFileSync(f, src, 'utf8')
  process.env.DAM_AUDIT_ENGINE_SOURCE = f
  const m = await import(pathToFileURL(shim).href + '?v=' + (++shimSeq))
  delete process.env.DAM_AUDIT_ENGINE_SOURCE
  return m
}

/** 隔离 DSH_HOME，返回 { home, restore }。 */
function isolate(tag) {
  const root = mkroot(tag)
  const home = path.join(root, 'home')
  mkdirSync(home, { recursive: true })
  const saved = {}
  for (const k of ['HOME', 'USERPROFILE', 'DSH_HOME']) { saved[k] = process.env[k]; process.env[k] = home }
  return { root, home, restore: () => { for (const k of Object.keys(saved)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] } } }
}

function makeEngine(mod, home) {
  const eng = new mod.MemoryEngine()
  eng.config = Object.assign({}, eng.config, {
    memoryRoot: path.join(home, 'memory', 'workspaces'),
    projectMemoryDir: '.dsh-memory',
  })
  return eng
}

/** 读回导出包（自动解 gz）。 */
function readPack(p) {
  const buf = readFileSync(p)
  const json = /.gz$/i.test(p) ? gunzipSync(buf).toString('utf8') : buf.toString('utf8')
  return JSON.parse(json)
}

/** `migrateExport` 打包前的**旧实现复刻**（词法路径 + stat 跟随链接）——正路径守恒用的对照实现。 */
async function legacyEnumerate(dir) {
  const { readdir, stat, readFile } = await import('node:fs/promises')
  const TEXT_RE = /\.(md|json|jsonl|txt|markdown)$/i
  const files = {}, skipped = []
  const walk = async (q, rel) => {
    let ents = []
    try { ents = await readdir(q, { withFileTypes: true }) } catch (_) { return }
    for (const en of ents) {
      const abs = path.join(q, en.name)
      const r = rel ? rel + '/' + en.name : en.name
      if (en.isDirectory()) { await walk(abs, r); continue }
      if (!TEXT_RE.test(en.name)) { skipped.push(r); continue }
      try {
        const s = await stat(abs)
        if (!s.isFile()) continue
        if (s.size > 32 * 1024 * 1024) { skipped.push(r + '(too-large)'); continue }
        const txt = await readFile(abs, 'utf8')
        files[r] = txt
      } catch (_) { skipped.push(r + '(unreadable)') }
    }
  }
  await walk(dir, '')
  return { files, skipped }
}

const canSymlink = (() => {
  try {
    const t = mkroot('symtest')
    writeFileSync(path.join(t, 'a.md'), 'x')
    symlinkSync(path.join(t, 'a.md'), path.join(t, 'b.md'), 'file')
    return true
  } catch (_) { return false }
})()

console.log('[0] 平台能力：可创建文件 symlink = ' + canSymlink + '（不可用则相关组降级为 SKIP，绝不当通过）')
console.log('[A] 真 fixture：记忆根内正常文件 + 指向根外文件的 symlink ⇒ 根外内容不得进包')
{
  const iso = isolate('leak')
  const effects = []
  try {
    const mod = await loadEngine()
    const eng = makeEngine(mod, iso.home)
    const ws = 'D:/some/ws'
    const projectDir = eng.projectDirOf(ws)
    mkdirSync(projectDir, { recursive: true })
    writeFileSync(path.join(projectDir, 'MEMORY.md'), '# 正常笔记\n- 内部内容\n', 'utf8')
    writeFileSync(path.join(projectDir, 'notes.json'), '{"k":1}\n', 'utf8')
    const outside = path.join(iso.home, 'OUTSIDE-SECRET.md')
    writeFileSync(outside, '# 根外机密\n- SECRET-OUTSIDE-CONTENT-9137\n', 'utf8')

    if (!canSymlink) { skip('根外文件 symlink 场景（本机不可创建 symlink）'); }
    else {
      symlinkSync(outside, path.join(projectDir, 'outside.md'), 'file')
      const out = path.join(iso.root, 'pack1.dam-pack.gz')
      const res = await eng.migrateExport({ ws, outPath: out, compress: true })
      ok(res.ok === true, '★ 真跑 migrateExport 成功（fileCount=' + (res.stats && res.stats.fileCount) + '）')
      const pack = readPack(res.path)
      const keys = Object.keys(pack.files || {})
      ok(!Object.hasOwn(pack.files, 'outside.md'), '★ pack.files 不含根外链接条目（实 keys=' + JSON.stringify(keys) + '）')
      const allText = JSON.stringify(pack)
      ok(!allText.includes('SECRET-OUTSIDE-CONTENT-9137'), '★ 整包序列化后**不含**根外机密正文（负路径的最强判据）')
      ok(keys.includes('MEMORY.md') && keys.includes('notes.json'), '同目录的正常文件照常入包（不是一刀切空包）')
      eq(pack.files['MEMORY.md'], '# 正常笔记\n- 内部内容\n', '正常文件内容逐字节一致')
      ok(res.skipped.includes('outside.md(outside-memory-root)'), '越界条目**不静默丢**：计入 skipped（实 ' + JSON.stringify(res.skipped) + '）')
    }

    // 根内 → 根内的 symlink：属正常内容，必须仍在包里（不得过度收紧）
    if (canSymlink) {
      const inside = path.join(projectDir, 'REAL-INSIDE.md')
      writeFileSync(inside, '# 根内真身\n', 'utf8')
      symlinkSync(inside, path.join(projectDir, 'inside-link.md'), 'file')
      const out2 = path.join(iso.root, 'pack2.dam-pack.gz')
      const res2 = await eng.migrateExport({ ws, outPath: out2, compress: true })
      const pack2 = readPack(res2.path)
      ok(Object.hasOwn(pack2.files, 'inside-link.md'), '★ 根内→根内的链接仍入包（过度收紧会让正常用户丢内容）')
      eq(pack2.files['inside-link.md'], '# 根内真身\n', '根内链接读到的是**被校验过的物理路径**内容')
    }
  } finally { iso.restore() }
}
console.log('[B] 正路径守恒：纯普通文件场景，导出包与**旧实现复刻**逐字节一致')
{
  const iso = isolate('parity')
  try {
    const mod = await loadEngine()
    const eng = makeEngine(mod, iso.home)
    const ws = 'D:/some/ws2'
    const projectDir = eng.projectDirOf(ws)
    mkdirSync(path.join(projectDir, 'log'), { recursive: true })
    mkdirSync(path.join(projectDir, 'handoff'), { recursive: true })
    writeFileSync(path.join(projectDir, 'MEMORY.md'), '# 笔记\n- a\n- b\n', 'utf8')
    writeFileSync(path.join(projectDir, 'PLAN.md'), '# 白板\n## 目标\ntype:goal\n', 'utf8')
    writeFileSync(path.join(projectDir, 'log', '2026-10-08.md'), '- 今日日志\n', 'utf8')
    writeFileSync(path.join(projectDir, 'handoff', 'handoff-1.md'), '# 账本\n', 'utf8')
    writeFileSync(path.join(projectDir, 'binary.bin'), 'not-text', 'utf8')
    writeFileSync(path.join(projectDir, 'big.md'), 'x'.repeat(10), 'utf8')

    const out = path.join(iso.root, 'parity.dam-pack')
    const res = await eng.migrateExport({ ws, outPath: out, compress: false })
    ok(res.ok === true, '真跑 migrateExport（未压缩）成功')
    const pack = readPack(res.path)
    const legacy = await legacyEnumerate(projectDir)
    eq(Object.keys(pack.files).sort(), Object.keys(legacy.files).sort(), '★ 文件清单与旧实现逐条一致（无 symlink 时边界校验是零行为）')
    let same = true
    for (const k of Object.keys(legacy.files)) if (pack.files[k] !== legacy.files[k]) same = false
    ok(same, '★ 每个文件的**内容逐字节相同**（'+ Object.keys(legacy.files).length + ' 个文件）')
    eq((res.skipped || []).slice().sort(), legacy.skipped.slice().sort(), '★ skipped 集合与旧实现一致（binary.bin 仍按非文本跳过）')
    const total = Object.values(pack.files).reduce((n, t) => n + Buffer.byteLength(t, 'utf8'), 0)
    eq(res.stats.bytes, total, 'stats.bytes 与逐文件 UTF-8 字节合计一致（实 ' + res.stats.bytes + '）')
    ok(res.stats.fileCount === Object.keys(pack.files).length, 'stats.fileCount 与 files 条目数一致（实 ' + res.stats.fileCount + '）')
  } finally { iso.restore() }
}

console.log('[C] 用户级 CALENDAR.md 同样收在用户根边界内')
{
  const iso = isolate('cal')
  try {
    const mod = await loadEngine()
    const eng = makeEngine(mod, iso.home)
    const ws = 'D:/some/ws3'
    const projectDir = eng.projectDirOf(ws)
    mkdirSync(projectDir, { recursive: true })
    writeFileSync(path.join(projectDir, 'MEMORY.md'), '# 笔记\n', 'utf8')
    const userDir = eng.userDirOf()
    mkdirSync(userDir, { recursive: true })
    writeFileSync(path.join(userDir, 'CALENDAR.md'), '# 日历\n- 正常条目\n', 'utf8')
    const out = path.join(iso.root, 'cal.dam-pack')
    const res = await eng.migrateExport({ ws, outPath: out, compress: false })
    const pack = readPack(res.path)
    eq(pack.userFiles && pack.userFiles['CALENDAR.md'], '# 日历\n- 正常条目\n', '★ 根内正常日历照常入包（行为不变）')

    if (canSymlink) {
      rmSync(path.join(userDir, 'CALENDAR.md'), { force: true })
      const outsideCal = path.join(iso.home, 'OUTSIDE-CALENDAR.md')
      writeFileSync(outsideCal, '# 根外日历\n- SECRET-CAL-7788\n', 'utf8')
      symlinkSync(outsideCal, path.join(userDir, 'CALENDAR.md'), 'file')
      const out2 = path.join(iso.root, 'cal2.dam-pack')
      const res2 = await eng.migrateExport({ ws, outPath: out2, compress: false })
      const pack2 = readPack(res2.path)
      ok(!pack2.userFiles || !pack2.userFiles['CALENDAR.md'], '★ 根外日历链接不入包（userFiles 无该键）')
      ok(!JSON.stringify(pack2).includes('SECRET-CAL-7788'), '★ 整包不含根外日历机密正文')
      ok((res2.skipped || []).includes('user:CALENDAR.md(outside-memory-root)'), '根外日历计入 skipped（不静默丢，实 ' + JSON.stringify(res2.skipped) + '）')
    } else skip('日历 symlink 场景（本机不可创建 symlink）')
  } finally { iso.restore() }
}
console.log('[D] 负路径（变异必红）：去掉边界校验 ⇒ 根外内容**又进包**')
{
  if (!canSymlink) { skip('变异负路径（本机不可创建 symlink）') }
  else {
    const iso = isolate('mut')
    try {
      const mod = await loadEngine([[
        'const physical = fileWithinRoots(abs, [dir], { strict: true, allowMissing: false })',
        'const physical = abs',
      ]])
      const eng = makeEngine(mod, iso.home)
      const ws = 'D:/some/ws4'
      const projectDir = eng.projectDirOf(ws)
      mkdirSync(projectDir, { recursive: true })
      writeFileSync(path.join(projectDir, 'MEMORY.md'), '# 正常笔记\n', 'utf8')
      const outside = path.join(iso.home, 'OUTSIDE-SECRET.md')
      writeFileSync(outside, '# 根外机密\n- MUTANT-SECRET-4242\n', 'utf8')
      symlinkSync(outside, path.join(projectDir, 'outside.md'), 'file')
      const out = path.join(iso.root, 'mutant.dam-pack')
      const res = await eng.migrateExport({ ws, outPath: out, compress: false })
      const pack = readPack(res.path)
      ok(Object.hasOwn(pack.files, 'outside.md'), '★ 变异（文件侧去边界校验）⇒ 根外条目**又进包**：缺陷复现，证明判据有鉴别力')
      ok(JSON.stringify(pack).includes('MUTANT-SECRET-4242'), '★ 变异后根外机密正文真的进包（判别力证据）')
    } finally { iso.restore() }
  }
}

console.log('[E] 目录链接的真实行为（已实测，非推断）+ 旧实现复刻下的越界进包')
{
  if (!canSymlink) { skip('目录链接组（本机不可创建 symlink）') }
  else {
    const iso = isolate('dirent')
    try {
      // E1：`readdir(withFileTypes)` 对链接目录报 isDirectory()===false、isSymbolicLink()===true
      //   ⇒ 新版 walk 的 `en.isDirectory()` 分支**天然不跟随**目录链接（与 fileWithinRoots 双重收口）。
      //   这一步是本组的**事实前提**：不先钉死它，就无法解释 E2 的对照。
      const dir = path.join(iso.root, 'probe')
      mkdirSync(path.join(dir, 'realdir'), { recursive: true })
      let linked = true
      try { symlinkSync(path.join(dir, 'realdir'), path.join(dir, 'linkdir'), 'junction') } catch (_) { linked = false }
      const { readdirSync } = await import('node:fs')
      const ents = readdirSync(dir, { withFileTypes: true })
      const link = ents.find(e => e.name === 'linkdir')
      if (!linked || !link) skip('目录链接（本机不支持 junction）')
      else {
        ok(link.isDirectory() === false && link.isSymbolicLink() === true,
          'E1 目录链接的 Dirent：isDirectory=false / isSymbolicLink=true ⇒ 新版 walk 不跟随目录链接')

        // E2：用**旧实现复刻**（词法 path.join + stat 跟随链接）在**同一 fixture** 上真跑 ——
        //    这是本条的原始越界形态：旧判别只看 `stat(abs).isFile()`。
        const ws = 'D:/some/ws5'
        const mod = await loadEngine()
        const eng = makeEngine(mod, iso.home)
        const projectDir = eng.projectDirOf(ws)
        mkdirSync(projectDir, { recursive: true })
        writeFileSync(path.join(projectDir, 'MEMORY.md'), '# 正常笔记\n', 'utf8')
        const outsideTarget = path.join(iso.home, 'OUTSIDE-FILE.md')
        writeFileSync(outsideTarget, '# 根外\n- TREE-SECRET-5150\n', 'utf8')
        symlinkSync(outsideTarget, path.join(projectDir, 'tree-link.md'), 'file')
        const legacy = await legacyEnumerate(projectDir)
        ok(Object.hasOwn(legacy.files, 'tree-link.md') && String(legacy.files['tree-link.md']).includes('TREE-SECRET-5150'),
          'E2 ★ 旧实现复刻在同一 fixture 上**确实**把根外内容打进包（TREE-SECRET-5150）—— 缺陷形态当场复现')
        const out = path.join(iso.root, 'boundary.dam-pack')
        const res = await eng.migrateExport({ ws, outPath: out, compress: false })
        const pack = readPack(res.path)
        ok(!JSON.stringify(pack).includes('TREE-SECRET-5150'),
          'E3 ★ 同一 fixture 走**产线实现** ⇒ 根外内容不在包内（旧/新对照成立，且不是靠环境差异）')
      }
    } finally { iso.restore() }
  }
}

console.log('[F] 还原必绿：未变异实现（同一次运行内）对同一 fixture 不含根外内容')
{
  if (!canSymlink) { skip('还原复绿（本机不可创建 symlink）') }
  else {
    const iso = isolate('restore')
    try {
      const mod = await loadEngine()
      const eng = makeEngine(mod, iso.home)
      const ws = 'D:/some/ws6'
      const projectDir = eng.projectDirOf(ws)
      mkdirSync(projectDir, { recursive: true })
      writeFileSync(path.join(projectDir, 'MEMORY.md'), '# 正常笔记\n', 'utf8')
      const outside = path.join(iso.home, 'OUTSIDE-SECRET.md')
      writeFileSync(outside, '# 根外机密\n- RESTORED-SECRET-3131\n', 'utf8')
      symlinkSync(outside, path.join(projectDir, 'outside.md'), 'file')
      const out = path.join(iso.root, 'restored.dam-pack')
      const res = await eng.migrateExport({ ws, outPath: out, compress: false })
      const pack = readPack(res.path)
      ok(!Object.hasOwn(pack.files, 'outside.md'), '★ 还原（未变异）⇒ 根外条目不在包内 ⇒ 变异-还原对照成立（必红 / 必绿）')
      ok(Object.hasOwn(pack.files, 'MEMORY.md'), '正常文件仍在包内（修复不是一刀切拒收）')
    } finally { iso.restore() }
  }
}

console.log('')
console.log('L-A2 smoke: ' + pass + ' PASS / ' + fail + ' FAIL / ' + skippedEnv + ' SKIP(环境)')
for (const d of tmps) { try { rmSync(d, { recursive: true, force: true, maxRetries: 5 }) } catch (_) {} }
if (fail > 0) process.exit(1)

