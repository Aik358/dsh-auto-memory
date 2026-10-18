// A05 / #425 —— 迁移导入可穿过目录链接写到记忆根外（2026-10-17）
//
// 缺陷（零写盘探针已证）：目标工作区里预先存在一个指向**记忆根外**的目录链接时，
//   `_readExistingWorkspaceFiles` 把它记成 `{kind:'unsupported'}` 且**不递归** ⇒ 清单里没有
//   该链接的**子路径键** ⇒ `planImportPre` 把 `linkdir/PLAN.md` 判成 additions ⇒
//   写入链 `mkdir(dirname)` + 原子写**穿过链接**落到根外（而 keep 语义本该保留本机文件）。
//   第二个出口（issue 未提）：导出侧用 fileWithinRoots 拒收根外 CALENDAR.md 链接，
//   写入侧 `_applyUserFilesPre` 却用裸 `path.join` —— 「拒读不拒写」悖论。
//
// 修复面（全部复用 lib/file-boundary.js 的唯一判据，禁止第五套）：
//   A. `_readExistingWorkspaceFiles`：目录链接按物理归属分 `directory-link`（根内，递归）/ `link-outside`（越界，不递归）
//   B. `planImportPre`：新增 `blockedByAncestor`（**纯函数、零 IO** —— 不破 S10）
//   C. `migrateImport`：计划被祖先阻塞 ⇒ 导入前拒绝；写入前 + mkdir 后各验一次物理归属，用物理路径写
//   D. `copyDir`：链接先判归属，越界计入 retained（否则"备份"这一步自己就写穿）
//   E. `_applyUserFilesPre`：用户级目标先过 fileWithinRoots（与导出侧同款）
//
// 判据纪律：真 import → 真构造 → 真调用 → 断言返回值 + **断言根外文件确实不存在**（最强判据）。
// 纯函数段（[P*]）不需要宿主；端到端段（[E*]）用真 MemoryEngine + 隔离 DSH_HOME。
//
// 变异验证（施工回执报两次数值）：把 C 的 `assertPhysicalTarget` 去掉（退回裸 path.join）
//   ⇒ [E1] 必红；把 B 的 blockedByAncestor 判据跳过 ⇒ [E1] 从另一侧红。
import assert from 'node:assert/strict'
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, symlinkSync,
  rmSync, realpathSync, lstatSync, readdirSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { buildPackPre, planImportPre } from '../../lib/migrate-pack.js'

let pass = 0, fail = 0
const ok = (cond, name) => { if (cond) { pass++; console.log('  ok   - ' + name) } else { fail++; console.error('  RED  - ' + name) } }
const eq = (got, want, name) => ok(JSON.stringify(got) === JSON.stringify(want),
  name + ' got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want))

/** 平台能力探测：不可创建 junction/symlink 时相关段降级为 SKIP（绝不当通过）。 */
const canLink = (() => {
  try {
    const t = mkdtempSync(path.join(tmpdir(), 'a05-probe-'))
    mkdirSync(path.join(t, 'd'))
    try { symlinkSync(path.join(t, 'd'), path.join(t, 'j'), 'junction') }
    catch (_) { symlinkSync(path.join(t, 'd'), path.join(t, 'j'), 'dir') }
    const okNow = lstatSync(path.join(t, 'j')).isSymbolicLink()
    rmSync(t, { recursive: true, force: true })
    return okNow
  } catch (_) { return false }
})()
console.log('[0] 平台能力：可创建目录链接 = ' + canLink + (canLink ? '' : '（相关段降级为 SKIP，绝不当通过）'))

// ─────────────────────────────────────────────────────────────
// 纯函数段：planImportPre 的祖先判据（零 IO，不需要宿主）
// ─────────────────────────────────────────────────────────────
console.log('\n[P1] 祖先判据（纯函数）：越界/不可用祖先 ⇒ 阻塞；根内目录链接 ⇒ 放行')
{
  const pack = buildPackPre({ ws: 'D:\\p', files: { 'linkdir/PLAN.md': 'x', 'MEMORY.md': 'y' }, now: 1 }).pack

  // 越界目录链接（宿主清单把它记成 link-outside）
  const blocked = planImportPre(pack, {
    targetWs: 'D:\\p',
    existingFiles: { linkdir: { kind: 'link-outside' } },
  })
  ok(blocked.ok === false, '★ link-outside 祖先 ⇒ ok:false（整体拒绝，不是"少写几个文件"）')
  eq(blocked.blockedByAncestor.map((b) => b.path), ['linkdir/PLAN.md'], '★ 被阻塞的具体路径可枚举')
  // ★取值用 `(...|| {})` 兜底：变异回退时这里必须报 **RED**，不能抛 TypeError
  //   ——抛错会让后续断言全部跳过，变异验证就变成"部分红"而不是"该红的地方都红"。
  const b0 = blocked.blockedByAncestor[0] || {}
  eq(b0.ancestor, 'linkdir', '记录阻塞的祖先路径')
  eq(b0.kind, 'link-outside', '记录阻塞原因类别')
  ok(blocked.writeFiles['linkdir/PLAN.md'] === undefined, '★ 被阻塞路径**不进** writeFiles（绝不写）')
  ok(blocked.writeFiles['MEMORY.md'] === 'y', '同一包里不受影响的文件仍在计划中（不是一刀切清空）')
  ok(blocked.errors.some((e) => e.startsWith('ancestor-not-writable:')), 'errors 里给出可读原因（前端 migFail 原样展示）')
  ok(blocked.warnings.includes('ancestor-blocked'), 'warnings 标记 ancestor-blocked')

  // 旧形态 unsupported（历史包/未知类型）
  const unsup = planImportPre(pack, { targetWs: 'D:\\p', existingFiles: { linkdir: { kind: 'unsupported' } } })
  ok(unsup.ok === false, '★ unsupported 祖先同样阻塞（旧清单形态也拦得住）')

  // 根内目录链接 ⇒ 必须放行（防过度收紧）
  const insideLink = planImportPre(pack, { targetWs: 'D:\\p', existingFiles: { linkdir: { kind: 'directory-link' } } })
  ok(insideLink.ok === true, '★ 根内目录链接（directory-link）**不阻塞**（合法内容不得误挡）')
  eq(insideLink.blockedByAncestor, [], '根内链接 ⇒ blockedByAncestor 为空')
  ok(insideLink.writeFiles['linkdir/PLAN.md'] === 'x', '根内链接下仍照常写')

  // 普通目录 / 普通文本 ⇒ 不阻塞
  const plainDir = planImportPre(pack, { targetWs: 'D:\\p', existingFiles: { linkdir: { kind: 'directory' } } })
  ok(plainDir.ok === true, '普通目录祖先 ⇒ 不阻塞')
  const plainText = planImportPre(pack, { targetWs: 'D:\\p', existingFiles: { 'MEMORY.md': 'same' } })
  ok(plainText.ok === true, '普通文本条目 ⇒ 不阻塞')

  // 未知 kind（未来新增）⇒ fail closed
  const unknown = planImportPre(pack, { targetWs: 'D:\\p', existingFiles: { linkdir: { kind: 'brand-new-kind' } } })
  ok(unknown.ok === false, '★ 未知 kind 祖先 ⇒ fail closed（不能证明是目录就不许在下层新建）')

  // 顶层文件不受祖先判据影响（无祖先）
  const top = planImportPre(buildPackPre({ ws: 'D:\\p', files: { 'top.md': 't' }, now: 1 }).pack,
    { targetWs: 'D:\\p', existingFiles: { 'top.md': { kind: 'unsupported' } } })
  ok(top.blockedByAncestor.length === 0, '顶层文件没有祖先 ⇒ 不受祖先判据影响（走既有冲突策略）')

  // 三种冲突策略下都必须拦（因为都会 mkdir 父目录）
  for (const onConflict of ['keep', 'overwrite', 'rename']) {
    const p = planImportPre(pack, { targetWs: 'D:\\p', existingFiles: { linkdir: { kind: 'link-outside' } }, onConflict })
    ok(p.ok === false && p.blockedByAncestor.length === 1, '★ onConflict=' + onConflict + ' 下同样阻塞')
  }
}

console.log('\n[P2] 祖先判据的确定性：结果与文件顺序无关，且重复条目只记一次')
{
  const pack = buildPackPre({ ws: 'D:\\p', files: { 'a/b/c.md': '1', 'a/b/d.md': '2' }, now: 1 }).pack
  const r1 = planImportPre(pack, { targetWs: 'D:\\p', existingFiles: { 'a/b': { kind: 'link-outside' } } })
  eq(r1.blockedByAncestor.map((b) => b.path), ['a/b/c.md', 'a/b/d.md'], '★ 同一越界祖先下的多条路径全部列出')
  eq(r1.blockedByAncestor.map((b) => b.ancestor), ['a/b', 'a/b'], '每条都指向同一祖先')
  ok(r1.blockedByAncestor.length === new Set(r1.blockedByAncestor.map((b) => b.path)).size, '无重复条目')
  const r2 = planImportPre(pack, { targetWs: 'D:\\p', existingFiles: { a: { kind: 'link-outside' } } })
  eq(r2.blockedByAncestor.map((b) => b.ancestor), ['a', 'a'], '★ 更上层祖先同样被识别（逐级查，不只查直接父目录）')
}

// ─────────────────────────────────────────────────────────────
// 端到端段：真 MemoryEngine + 隔离 DSH_HOME
// ─────────────────────────────────────────────────────────────
console.log('\n[E0] 装载真引擎（隔离 DSH_HOME；失败则整段 SKIP 并**明确报红**，绝不假绿）')
let engine = null
let root = null
let loadError = null
try {
  root = mkdtempSync(path.join(tmpdir(), 'a05-engine-'))
  const prevHome = process.env.DSH_HOME
  process.env.DSH_HOME = root
  // ★用 audit-engine 而非 loadPrivateEngine：它支持 `DAM_AUDIT_ENGINE_SOURCE` 指定替身源文件，
  //   于是**变异验证不必改动共享的 lib/index.js**（该文件常被其它批次并发写，
  //   改它做变异既危险又容易被"文件已变更"打断），只需指一个变异副本。
  const { MemoryEngine } = await import('../lib/audit-engine.mjs')
  engine = new MemoryEngine()
  engine.config = Object.assign({}, engine.config, {
    memoryRoot: path.join(root, 'memory', 'workspaces'),
    userMemoryDir: path.join(root, 'memory'),
    pythonBackendEnabled: false,
    l0IndexEnabled: false,
    globalBriefEnabled: false,
    externalSources: {},
    autoConsolidate: false,
    greetingEnabled: false,
  })
  engine.configLoaded = true
  if (prevHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = prevHome
} catch (e) { loadError = e }

if (!engine) {
  fail++
  console.error('  RED  - 引擎装载失败（端到端段无法执行；这不是 SKIP，必须修好再跑）：' + (loadError && loadError.message))
} else {
  console.log('  ok   - 引擎装载成功（真 MemoryEngine）')

  const mkWs = (label) => {
    const ws = path.join(root, 'ws-' + label + '-' + Math.random().toString(36).slice(2, 8))
    const dir = engine.projectDirOf(ws)
    mkdirSync(dir, { recursive: true })
    return { ws, dir }
  }
  const writePack = (files, name) => {
    const p = path.join(root, name + '.dam-pack')
    const built = buildPackPre({ ws: 'D:\\src', files, now: 1 })
    assert.equal(built.ok, true)
    writeFileSync(p, JSON.stringify(built.pack), 'utf8')
    return p
  }

  // ── E1：越界目录链接 ⇒ inspect 报 blocked、import 拒、根外文件不存在（正路径，修前必红）
  console.log('\n[E1] 正路径：越界目录链接下的子路径 ⇒ 预览阻塞 + 导入拒绝 + 根外文件**不存在**')
  if (!canLink) { console.log('  skip - 本机不可创建目录链接'); }
  else {
    const { ws, dir } = mkWs('escape')
    const outside = path.join(root, 'OUTSIDE-' + Math.random().toString(36).slice(2, 8))
    mkdirSync(outside, { recursive: true })
    const outsideTarget = path.join(outside, 'PLAN.md')
    try { symlinkSync(outside, path.join(dir, 'linkdir'), 'junction') }
    catch (_) { symlinkSync(outside, path.join(dir, 'linkdir'), 'dir') }
    const packPath = writePack({ 'linkdir/PLAN.md': '# 恶意写入\n- ESCAPED-BY-LINK\n' }, 'escape')

    const view = await engine.migrateInspect({ packPath, targetWs: ws })
    ok(view.ok === true, 'inspect 本身返回 ok（预览是只读的，不该整体失败）')
    ok(!!view.plan, 'inspect 带回 plan')
    ok(view.plan.blockedByAncestor && view.plan.blockedByAncestor.length === 1,
      '★ 预览报出 blockedByAncestor（修前这里是空 = 被判成 additions）')
    const eb0 = (view.plan.blockedByAncestor || [])[0] || {}
    eq(eb0.path, 'linkdir/PLAN.md', '被阻塞路径 = linkdir/PLAN.md')
    eq(eb0.kind, 'link-outside', '★ 归类为 link-outside（不是 unsupported）')
    ok(view.plan.additions.every((a) => a.path !== 'linkdir/PLAN.md'), '被阻塞路径不出现在 additions 里')
    ok(!view.plan.writeFiles || view.plan.writeFiles['linkdir/PLAN.md'] === undefined, '被阻塞路径不进 writeFiles')
    ok(view.plan.errors.some((e) => e.startsWith('ancestor-not-writable:')), 'errors 里给出可读原因')

    const imported = await engine.migrateImport({ packPath, targetWs: ws, previewToken: view.previewToken })
    ok(imported.ok === false, '★ 导入被拒（ok:false）')
    eq(imported.error, 'ancestor-not-writable', '★ 错误码 ancestor-not-writable')
    ok(Array.isArray(imported.blockedByAncestor) && imported.blockedByAncestor.length === 1, '回执带 blockedByAncestor')
    // 注意：失败分支回执里的 `written` 是**数组**（成功分支才是条数）——
    // 这是既有的返回体形状（失败要能逐条列出已写文件供回滚），不改。
    ok(Array.isArray(imported.written) ? imported.written.length === 0 : imported.written === 0,
      '★ 一个文件都没写（written 为空：' + JSON.stringify(imported.written) + '）')
    ok(!existsSync(outsideTarget), '★★ 根外目标文件**不存在**（最强判据：链接没被写穿）')
    const outsideFiles = readdirSync(outside)
    eq(outsideFiles, [], '★★ 根外目录仍然为空（没有任何东西被写出去）')
    ok(existsSync(path.join(dir, 'linkdir')), '链接本身仍在（未被删除/破坏）')
  }

  // ── E2：悬空链接 ⇒ 同样阻塞
  console.log('\n[E2] 负路径①：悬空目录链接 ⇒ 同样阻塞、不抛')
  if (!canLink) { console.log('  skip - 本机不可创建目录链接'); }
  else {
    const { ws, dir } = mkWs('dangling')
    const missing = path.join(root, 'NOT-EXIST-' + Math.random().toString(36).slice(2, 8))
    try { symlinkSync(missing, path.join(dir, 'danglingdir'), 'junction') }
    catch (_) { symlinkSync(missing, path.join(dir, 'danglingdir'), 'dir') }
    const packPath = writePack({ 'danglingdir/x.md': 'dangling write\n' }, 'dangling')
    let view = null
    let threw = null
    try { view = await engine.migrateInspect({ packPath, targetWs: ws }) } catch (e) { threw = e }
    ok(threw === null, '悬空链接下 inspect 不抛（fail closed 而非崩溃）')
    ok(view && view.plan && view.plan.blockedByAncestor.length === 1, '★ 悬空链接 ⇒ 同样 blockedByAncestor 非空')
    const imported = await engine.migrateImport({ packPath, targetWs: ws, previewToken: view.previewToken })
    ok(imported.ok === false, '悬空链接 ⇒ 导入被拒')
    ok(!existsSync(missing), '悬空链接的目标仍不存在（没被"写成"目录）')
  }

  // ── E3：根内目录链接 ⇒ 必须仍能写（防过度收紧）
  console.log('\n[E3] 负路径②：根内目录链接必须仍能写（防过度收紧）')
  if (!canLink) { console.log('  skip - 本机不可创建目录链接'); }
  else {
    const { ws, dir } = mkWs('inside')
    const realSub = path.join(dir, 'realsub')
    mkdirSync(realSub, { recursive: true })
    try { symlinkSync(realSub, path.join(dir, 'linkdir'), 'junction') }
    catch (_) { symlinkSync(realSub, path.join(dir, 'linkdir'), 'dir') }
    const packPath = writePack({ 'linkdir/inside.md': '# 根内写入\n- 合法内容\n' }, 'inside')
    const view = await engine.migrateInspect({ packPath, targetWs: ws })
    eq(view.plan.blockedByAncestor, [], '★ 根内目录链接 ⇒ 不阻塞（directory-link 视为可写）')
    const imported = await engine.migrateImport({ packPath, targetWs: ws, previewToken: view.previewToken })
    ok(imported.ok === true, '★ 根内链接下的导入成功（防过度收紧）')
    eq(imported.written, 1, '写了 1 个文件')
    ok(existsSync(path.join(realSub, 'inside.md')), '★ 文件落在**真实的根内目录**里（物理路径写盘）')
    eq(readFileSync(path.join(realSub, 'inside.md'), 'utf8'), '# 根内写入\n- 合法内容\n', '内容逐字节正确')
  }

  // ── E4：copyDir 备份不写穿
  console.log('\n[E4] 负路径③：copyDir（导入前备份）不得跟随链接写穿')
  if (!canLink) { console.log('  skip - 本机不可创建目录链接'); }
  else {
    const { dir } = mkWs('backup')
    writeFileSync(path.join(dir, 'MEMORY.md'), '# 本机\n', 'utf8')
    const outside = path.join(root, 'BAK-OUTSIDE-' + Math.random().toString(36).slice(2, 8))
    mkdirSync(outside, { recursive: true })
    writeFileSync(path.join(outside, 'secret.md'), 'SECRET-IN-OUTSIDE\n', 'utf8')
    try { symlinkSync(outside, path.join(dir, 'linkdir'), 'junction') }
    catch (_) { symlinkSync(outside, path.join(dir, 'linkdir'), 'dir') }
    const dst = path.join(root, 'backup-dst-' + Math.random().toString(36).slice(2, 8))
    const r = await engine.copyDir(dir, dst)
    ok(typeof r === 'object' && Number.isFinite(r.copied), 'copyDir 返回 {copied,retained} 回执')
    ok(r.copied >= 1, '普通文件照常备份（copied=' + r.copied + '）')
    ok(r.retained >= 1, '★ 越界链接计入 retained（不静默丢，retained=' + r.retained + '）')
    ok(existsSync(path.join(dst, 'MEMORY.md')), '★ 普通文件确实备份到位')
    eq(readFileSync(path.join(dst, 'MEMORY.md'), 'utf8'), '# 本机\n', '备份内容逐字节一致')
    ok(!existsSync(path.join(dst, 'linkdir')), '★ 备份里没有那条越界链接（不被复制）')
    ok(!existsSync(path.join(dst, 'secret.md')), '★★ 根外内容没有出现在备份目录里（备份本身没写穿）')
  }

  // ── E5：用户级 CALENDAR.md 链接 ⇒ 拒写（拒读不拒写悖论已修）
  console.log('\n[E5] 负路径④：用户级 CALENDAR.md 指向根外 ⇒ 拒写且回执可见')
  if (!canLink) { console.log('  skip - 本机不可创建目录链接'); }
  else {
    const userDir = engine.userDirOf()
    mkdirSync(userDir, { recursive: true })
    const calPath = path.join(userDir, 'CALENDAR.md')
    rmSync(calPath, { force: true })
    const outsideCal = path.join(root, 'OUTSIDE-CAL-' + Math.random().toString(36).slice(2, 8) + '.md')
    writeFileSync(outsideCal, '# 根外日历\n- [ ] 09:00 | 未分类 | ORIGINAL\n', 'utf8')
    try { symlinkSync(outsideCal, calPath, 'file') }
    catch (_) { symlinkSync(outsideCal, calPath, 'file') }
    const before = readFileSync(outsideCal, 'utf8')
    // ★独立判据：把 writeFullRaw 换成"直接写盘"的裸实现 —— 否则本方法自己的边界校验
    //   会与 writeFullRaw 的边界保护**互相掩盖**（变异任一处，另一处仍然兜住 ⇒ 假绿）。
    //   换掉之后，本方法若不做归属校验，内容就会真的落到根外文件里。
    const originalWriteFullRaw = engine.writeFullRaw
    engine.writeFullRaw = async (target, text) => { writeFileSync(target, text, 'utf8') }
    let res = null
    try {
      res = await engine._applyUserFilesPre({ userFiles: { 'CALENDAR.md': '## 2026-10-01\n- [ ] 10:00 | 未分类 | INJECTED\n' } })
    } finally { engine.writeFullRaw = originalWriteFullRaw }
    eq(res.applied, [], '★ 根外日历链接 ⇒ 一个都没应用（writeFullRaw 已换成裸写，判据不再被掩盖）')
    // ★独立判据（E 处代码自己的守卫）：上面那条只证明"没写"，写不进去也可能是因为
    //   writeFullRaw 里还有一道边界保护。这里断言**分类原因**必须由本方法给出 ——
    //   若本方法不做归属校验（变异回退），根外链接会被当成普通目标，skipped 里就没有这个原因。
    ok(res.skipped.length === 1 && res.skipped[0].includes('outside-memory-root'),
      '★★ 本方法**自己**判定越界并归类（不是靠 writeFullRaw 兜底）：' + JSON.stringify(res.skipped))
    ok(res.skipped.some((s) => s.includes('outside-memory-root')), '★ skipped 里明确写 outside-memory-root（不静默）')
    eq(readFileSync(outsideCal, 'utf8'), before, '★★ 根外日历**逐字节未变**（没被写入）')
    ok(!before.includes('INJECTED'), '根外文件里没有注入内容')
    rmSync(calPath, { force: true })
  }

  // ── E6：普通无链接导入必须逐字节等价（兼容红线）
  console.log('\n[E6] 负路径⑤：普通无链接导入逐字节不变（兼容红线）')
  {
    const { ws, dir } = mkWs('plain')
    writeFileSync(path.join(dir, 'MEMORY.md'), '# 本机原版\n', 'utf8')
    const packPath = writePack({ 'MEMORY.md': '# 包内版\n', 'newfile.md': '# 新增\n' }, 'plain')
    const view = await engine.migrateInspect({ packPath, targetWs: ws })
    eq(view.plan.blockedByAncestor, [], '无链接 ⇒ 不阻塞')
    eq(view.plan.ok, true, '无链接 ⇒ plan.ok:true')
    const imported = await engine.migrateImport({ packPath, targetWs: ws, previewToken: view.previewToken })
    ok(imported.ok === true, '无链接 ⇒ 导入成功')
    eq(imported.written, 1, 'keep 语义下只写新增（MEMORY.md 保留本机）')
    eq(readFileSync(path.join(dir, 'MEMORY.md'), 'utf8'), '# 本机原版\n', '★ 既有文件逐字节未变（keep 生效）')
    eq(readFileSync(path.join(dir, 'newfile.md'), 'utf8'), '# 新增\n', '★ 新增文件内容逐字节正确')
    ok(imported.backup && existsSync(imported.backup), '备份目录已创建')
  }
  // ── E7：TOCTOU —— 预览后把父目录抢换成越界链接 ⇒ 写入链必须拦下（这是 C 的唯一鉴别器）
  console.log('\n[E7] ★ TOCTOU：预览之后把目标父目录换成越界链接 ⇒ 写入链拒绝、根外仍为空')
  if (!canLink) { console.log('  skip - 本机不可创建目录链接'); }
  else {
    const { ws, dir } = mkWs('toctou')
    writeFileSync(path.join(dir, 'MEMORY.md'), '# 本机\n', 'utf8')
    const outside = path.join(root, 'TOCTOU-OUTSIDE-' + Math.random().toString(36).slice(2, 8))
    mkdirSync(outside, { recursive: true })
    // 预览时 hub/ 尚不存在 ⇒ plan 判成 additions、无祖先阻塞（合法的多级新建）
    const packPath = writePack({ 'hub/procedures.json': '{"evil":true}\n' }, 'toctou')
    const view = await engine.migrateInspect({ packPath, targetWs: ws })
    eq(view.plan.blockedByAncestor, [], '（前置）预览时无祖先阻塞')
    ok(view.plan.additions.some((a) => a.path === 'hub/procedures.json'), '（前置）预览判为新增')
    // 预览之后、导入之前：把 hub 抢换成指向根外的目录链接
    try { symlinkSync(outside, path.join(dir, 'hub'), 'junction') }
    catch (_) { symlinkSync(outside, path.join(dir, 'hub'), 'dir') }
    const imported = await engine.migrateImport({ packPath, targetWs: ws, previewToken: view.previewToken })
    ok(imported.ok === false, '★ 写入链拦下（ok:false，不是"写成功了")')
    eq(readdirSync(outside), [], '★★ 根外目录仍然为空（没写穿）')
    ok(imported.error === 'preview-stale' || imported.error === 'write-failed' || imported.error === 'ancestor-not-writable',
      '错误归类落在预期集合内（实=' + imported.error + '）')
  }

  // ── E8：★ 写入链的**唯一鉴别器** —— 链接出现在「计划重算之后、写入之前」(备份窗口内)
  //   时序：inspect → import 重算计划（此时 hub 不存在）→ copyDir 备份 → 写入。
  //   在 copyDir 里把 hub 换成越界链接 ⇒ 计划层看不到（不阻塞）、token 也没过期，
  //   只有写入链的物理校验能拦。**这是 C 处修复真正不可替代的证据。**
  console.log('\n[E8] ★★ 链接出现在备份窗口（计划重算之后）⇒ 只有写入链能拦')
  if (!canLink) { console.log('  skip - 本机不可创建目录链接'); }
  else {
    const { ws, dir } = mkWs('race')
    writeFileSync(path.join(dir, 'MEMORY.md'), '# 本机\n', 'utf8')
    const outside = path.join(root, 'RACE-OUTSIDE-' + Math.random().toString(36).slice(2, 8))
    mkdirSync(outside, { recursive: true })
    const packPath = writePack({ 'hub/procedures.json': '{"evil":true}\n' }, 'race')
    const view = await engine.migrateInspect({ packPath, targetWs: ws })
    eq(view.plan.blockedByAncestor, [], '（前置）预览时无祖先阻塞')

    const originalCopyDir = engine.copyDir
    let injected = false
    engine.copyDir = async function (...args) {
      const out = await originalCopyDir.apply(this, args)
      if (!injected) {
        injected = true
        try { symlinkSync(outside, path.join(dir, 'hub'), 'junction') }
        catch (_) { symlinkSync(outside, path.join(dir, 'hub'), 'dir') }
      }
      return out
    }
    let imported = null
    try {
      imported = await engine.migrateImport({ packPath, targetWs: ws, previewToken: view.previewToken })
    } finally { engine.copyDir = originalCopyDir }
    ok(injected, '（前置）链接确实在备份窗口内注入')
    ok(imported.ok === false, '★ 导入被拒（计划层看不见，靠写入链拦下）')
    eq(imported.error, 'write-failed', '★ 走 write-failed 分支（= 写入链抛错，不是计划阻塞）')
    ok(/ancestor-not-writable/.test(String(imported.detail || '')), '★ detail 指明 ancestor-not-writable（实=' + imported.detail + '）')
    eq(readdirSync(outside), [], '★★ 根外目录仍然为空（写入链没被绕过）')
    ok(!existsSync(path.join(outside, 'procedures.json')), '★★ 根外没有 procedures.json')
  }
}

// ─────────────────────────────────────────────────────────────
console.log('\n[a05-import-ancestor-boundary] pass=' + pass + ' fail=' + fail)
if (root) { try { rmSync(root, { recursive: true, force: true }) } catch (_) {} }
process.exit(fail ? 1 : 0)
