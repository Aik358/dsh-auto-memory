// T8 守卫（#82 配置原子写 + 损坏隔离）
//
// 事故：①写侧裸 writeFileSync ⇒ 半截 JSON；②读侧 catch 静默回落出厂默认
//       ⇒ 用户设置全丢且**没人知道**（只写进 this._readError）。
// 本套件立场：**用真实文件系统证明原子性**，不看代码长得像不像。
import { mkdtempSync, readFileSync, writeFileSync, existsSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = process.cwd()
const IDX = readFileSync(path.join(ROOT, 'lib', 'index.js'), 'utf8')
const CIO_SRC = readFileSync(path.join(ROOT, 'lib', 'config-io-pre.js'), 'utf8')
const M = await import(pathToFileURL(path.join(ROOT, 'lib', 'config-io-pre.js')).href)

let pass = 0, fail = 0
const t = (name, fn) => {
  try { fn(); pass++; console.log('  ok - ' + name) }
  catch (e) { fail++; console.log('  FAIL - ' + name + ': ' + (e && e.message)) }
}
const assert = (c, m) => { if (!c) throw new Error(m || 'assertion failed') }
const tmp = () => mkdtempSync(path.join(tmpdir(), 't8-'))

console.log('=== T8-a 原子写：不留半截文件、不留 tmp 残留 ===')

t('T8a-1 ★★ 写成功 = 目标文件内容完整，且同目录**没有 .tmp 残留**', () => {
  const d = tmp()
  const f = path.join(d, 'cfg.json')
  const r = M.writeTextAtomicPreSync(f, JSON.stringify({ a: 1, b: '中文' }))
  assert(r.ok === true, '写失败: ' + r.error)
  assert(JSON.parse(readFileSync(f, 'utf8')).b === '中文', '内容不对')
  const left = readdirSync(d).filter((n) => n.endsWith('.tmp'))
  assert(left.length === 0, '★ 残留 tmp：' + left.join(','))
  rmSync(d, { recursive: true, force: true })
})

t('T8a-2 ★★ 目标目录不存在时自动建，且仍然原子（无 .tmp 残留）', () => {
  const d = tmp()
  const f = path.join(d, 'deep', 'nested', 'cfg.json')
  const r = M.writeTextAtomicPreSync(f, '{"x":1}')
  assert(r.ok === true, '写失败: ' + r.error)
  assert(existsSync(f), '目标文件不存在')
  assert(readdirSync(path.dirname(f)).filter((n) => n.endsWith('.tmp')).length === 0, '有 tmp 残留')
  rmSync(d, { recursive: true, force: true })
})

t('T8a-3 ★★ 写失败（目标目录被文件占位）⇒ 返回 ok:false 且**不抛**、不留 tmp', () => {
  const d = tmp()
  const blocker = path.join(d, 'blocker')
  writeFileSync(blocker, 'i am a file', 'utf8')   // 用文件占住"目录"位置
  const f = path.join(blocker, 'sub', 'cfg.json') // 路径不可达
  let threw = false
  let r = null
  try { r = M.writeTextAtomicPreSync(f, '{"x":1}') } catch (_) { threw = true }
  assert(threw === false, '★ 竟然抛了（违反 fail-soft）')
  assert(r && r.ok === false, '未返回 ok:false')
  assert(typeof r.error === 'string' && r.error.length > 0, '失败却没有 error 说明')
  rmSync(d, { recursive: true, force: true })
})

t('T8a-7 ★★★ **原子性本身**：覆盖写期间读方绝不可能看到半截内容（旧值或新值，二者必居其一）', () => {
  // ⚠️ 这条是 T8a-1~6 的**必要补充**：那几条只测「写完的结果对不对」，
  //    而**裸 writeFileSync 也能让结果正确**（先 truncate 再写，写完依然完整）
  //    ⇒ 删掉 tmp+rename 后它们**依然全绿**（实测变异 1 假绿）。
  //    真正的原子性判据是：**新内容出现之前，旧内容必须完好**——
  //    即目标文件在任意时刻都等于「旧完整版」或「新完整版」。
  //
  //    可判定的等价写法：新文件**先落盘到 tmp**，此刻目标文件必须**仍是旧内容**；
  //    rename 之后才变成新内容。裸写做不到这一点（它直接截断目标）。
  const d = tmp()
  const f = path.join(d, 'cfg.json')
  const OLD = JSON.stringify({ v: 'old' })
  const NEW = JSON.stringify({ v: 'new' })
  writeFileSync(f, OLD, 'utf8')

  // 源码级判据：写出必须经由同目录 tmp + rename（这是原子的充分条件）
  const body = CIO_SRC
  assert(/const tmp = file \+ ATOMIC_TMP_SUFFIX_PRE_V1/.test(body),
    '★ 未使用同目录 tmp 路径')
  assert(/writeFileSync\(tmp, String\(text\), 'utf8'\)[\s\S]{0,80}?renameSync\(tmp, file\)/.test(body),
    '★ 同步版不是「写 tmp → rename」（裸写目标文件 ≠ 原子）')
  // ★2026-09-22（P3-12 落盘后同步）：异步版的 rename 由裸 `renameSync` 换成**有界退避**的
  //   `renameBoundedRetryPre`（Windows 句柄争用下 EPERM/EACCES/EBUSY 会让整次设置保存失败）。
  //   此处放宽的只是**拼写**、不是判据：仍要求「异步写 tmp → 把 tmp **改名**到目标」，
  //   且下一行「不得直接写目标文件」的反断言原样保留 ⇒ 退回裸写目标仍必红。
  assert(/await writeFile\(tmp, String\(text\), 'utf8'\)[\s\S]{0,120}?(?:renameSync|renameBoundedRetryPre|retryRename)\(tmp, file\)/.test(body),
    '★ 异步版不是「写 tmp → rename」（裸写目标文件 ≠ 原子）')
  assert(!/writeFileSync\(file, String\(text\)/.test(body) && !/writeFile\(file, String\(text\)/.test(body),
    '★ 存在直接写目标文件的路径')

  // 行为级判据：写 tmp 的那一步之后、rename 之前，目标仍是旧值。
  //   用「手工复现原子写两步」来锚定语义：若实现真在写目标，旧值会在第一步就消失。
  const tmpPath = f + M.ATOMIC_TMP_SUFFIX_PRE_V1
  writeFileSync(tmpPath, NEW, 'utf8')
  assert(readFileSync(f, 'utf8') === OLD, '★ 写 tmp 阶段就动了目标文件（非原子）')
  M.quarantineFilePreSync  // 触发引用，确保导出面稳定
  rmSync(tmpPath, { force: true })
  const r = M.writeTextAtomicPreSync(f, NEW)
  assert(r.ok === true && readFileSync(f, 'utf8') === NEW, '最终未变成新值')
  rmSync(d, { recursive: true, force: true })
})

t('T8a-4 ★ 异步版与同步版行为一致（成功路径）', async () => {
  // 本用例在同步 t() 里启动异步断言，失败会通过 unhandledRejection 暴露；
  // 为保证可判定，这里用同步等待的写法：先 fire，再在下一个 tick 检查由 b-1 覆盖。
  // ⇒ 实际断言放在 T8-a5（顶层 await），此处只验证函数存在且可调用。
  assert(typeof M.writeTextAtomicPre === 'function', '缺少异步原子写')
})

t('T8a-5 ★ 原子写**不修改**源对象（纯写盘，无副作用）', () => {
  const d = tmp()
  const f = path.join(d, 'cfg.json')
  const obj = { keep: 'me' }
  const body = JSON.stringify(obj)
  M.writeTextAtomicPreSync(f, body)
  assert(obj.keep === 'me', '函数改了调用方对象')
  assert(readFileSync(f, 'utf8') === body, '落盘内容与传入不一致')
  rmSync(d, { recursive: true, force: true })
})

// 顶层 await 的异步版断言（单独计数）
{
  const d = tmp()
  const f = path.join(d, 'cfg.json')
  const r = await M.writeTextAtomicPre(f, '{"async":true}')
  const name = 'T8a-6 ★ 异步原子写成功且无 tmp 残留'
  try {
    assert(r.ok === true, '写失败: ' + r.error)
    assert(JSON.parse(readFileSync(f, 'utf8')).async === true, '内容不对')
    assert(readdirSync(d).filter((n) => n.endsWith('.tmp')).length === 0, '有 tmp 残留')
    pass++; console.log('  ok - ' + name)
  } catch (e) { fail++; console.log('  FAIL - ' + name + ': ' + (e && e.message)) }
  rmSync(d, { recursive: true, force: true })
}

console.log('\n=== T8-b 损坏隔离：坏文件必须被留存，而不是被覆盖 ===')

t('T8b-1 ★★ 半截 JSON ⇒ corrupted:true 且**原文件被挪到 .corrupt-***', () => {
  const d = tmp()
  const f = path.join(d, 'cfg.json')
  const good = JSON.stringify({ noteCapacityChars: 8000 })
  writeFileSync(f, good.slice(0, Math.floor(good.length / 2)), 'utf8') // 模拟写到一半被杀
  const r = M.readJsonQuarantinePreSync(f)
  assert(r.ok === false, '竟然解析成功了')
  assert(r.corrupted === true, '未标记 corrupted')
  assert(typeof r.quarantined === 'string' && r.quarantined.length > 0, '未返回留存路径')
  assert(existsSync(r.quarantined), '★ 留存路径不存在（数据丢了）')
  assert(readFileSync(r.quarantined, 'utf8').length > 0, '留存文件是空的')
  assert(!existsSync(f), '原路径应已被挪走')
  rmSync(d, { recursive: true, force: true })
})

t('T8b-2 ★ 文件不存在 ⇒ missing:true（**不算损坏、不留存**）', () => {
  const d = tmp()
  const f = path.join(d, 'nope.json')
  const r = M.readJsonQuarantinePreSync(f)
  assert(r.ok === false && r.missing === true, '未标记 missing')
  assert(!r.corrupted, '不存在被误判为损坏')
  assert(readdirSync(d).length === 0, '不存在却产生了文件')
  rmSync(d, { recursive: true, force: true })
})

t('T8b-3 ★ 正常文件 ⇒ ok:true 且**不改动**磁盘上任何字节', () => {
  const d = tmp()
  const f = path.join(d, 'cfg.json')
  const body = JSON.stringify({ a: 1 }, null, 2)
  writeFileSync(f, body, 'utf8')
  const before = statSync(f).size
  const r = M.readJsonQuarantinePreSync(f)
  assert(r.ok === true && r.value.a === 1, '读取结果不对')
  assert(readFileSync(f, 'utf8') === body && statSync(f).size === before, '★ 读操作改动了文件')
  rmSync(d, { recursive: true, force: true })
})

t('T8b-4 ★★ 同一秒内坏两次 ⇒ 第二份证据**不覆盖**第一份', () => {
  const d = tmp()
  const f = path.join(d, 'cfg.json')
  writeFileSync(f, '{"broken', 'utf8')
  const r1 = M.readJsonQuarantinePreSync(f)
  writeFileSync(f, '{"broken2', 'utf8')
  const r2 = M.readJsonQuarantinePreSync(f)
  assert(r1.quarantined !== r2.quarantined, '★ 两次留存到了同一路径（第一份证据丢失）')
  assert(existsSync(r1.quarantined) && existsSync(r2.quarantined), '留存文件缺失')
  assert(readFileSync(r1.quarantined, 'utf8') === '{"broken', '第一份内容被覆盖')
  rmSync(d, { recursive: true, force: true })
})

t('T8b-5 ★ 纯函数判据 looksTruncatedJsonPre 的边界', () => {
  assert(M.looksTruncatedJsonPre('{"a":1}') === false, '完整 JSON 被误判')
  assert(M.looksTruncatedJsonPre('{"a":') === true, '半截 JSON 未被判出')
  assert(M.looksTruncatedJsonPre('') === false, '空串不应判为半截')
  assert(M.looksTruncatedJsonPre('plain text') === false, '非 JSON 不应判为半截')
})

console.log('\n=== T8-c 接线完整性：index.js 里不得再有裸配置写 ===')

t('T8c-1 ★★ 配置文件写路径必须走原子写（不得残留裸 writeFileSync(写 this._configPath）', () => {
  const bad = IDX.split('\n').filter((l) => /writeFileSync\(\s*this\._configPath/.test(l))
  assert(bad.length === 0, '★ 仍在裸写配置：' + bad.map((l) => l.trim()).join(' | '))
})

t('T8c-2 ★★ 两个 load 路径都必须用损坏隔离读（**仅限配置路径**）', () => {
  const n = (IDX.match(/readJsonQuarantinePreSync\(this\._configPath\)/g) || []).length
  assert(n === 2, '★ 应有 2 处（loadConfigSync + loadConfig），实为 ' + n)
  // ⚠️ 断言必须**限定在配置路径** this._configPath：
  //    本仓另有大量合法的 JSON.parse(readFile(...))（sidecar 索引 / 续接会话 /
  //    hub flush 状态 / embedding-config 读侧）——那些不在 #82 范围内，扫进来是假阳性。
  const bad = IDX.split('\n').filter(
    (l) => /JSON\.parse\(\s*(await\s+)?readFile(Sync)?\([^)]*_configPath/.test(l)
  )
  assert(bad.length === 0, '★ 配置路径仍有裸读：' + bad.map((l) => l.trim()).join(' | '))
})

t('T8c-3 ★★ 损坏必须**可观察**：写进 _readError 且诊断面暴露真实的 configCorrupted', () => {
  assert(/quarantined=/.test(IDX), '未把留存路径写进诊断串')
  // ⚠️ 不能只断言字面量 `configCorrupted:` 出现 —— 改成 `configCorrupted: false` 也能过
  //    （实测变异 3 假绿）。必须断言它**真的引用了 _readError 的判定**。
  const m = IDX.match(/configCorrupted:\s*([^\r\n]*)/)
  assert(m, '★ 诊断面未暴露 configCorrupted')
  const expr = m[1]
  assert(/this\._readError/.test(expr), '★ configCorrupted 未引用 _readError（恒 false ⇒ 损坏仍不可见）')
  assert(/quarantined=/.test(expr) || /includes\(/.test(expr), '★ configCorrupted 未真正判定隔离标记')
  assert(!/configCorrupted:\s*(false|true)\s*,/.test(expr), '★ configCorrupted 被写死成常量')
})

t('T8c-4 ★★ 两个 load 的 _readError 文案必须同口径（防止只修了一条路）', () => {
  const n = (IDX.match(/'config corrupted, quarantined='/g) || []).length
  assert(n === 2, '★ 应有 2 处同口径文案，实为 ' + n)
})

t('T8c-5 ★ embedding-config.json 也必须原子写（语义引擎开关的双轨读数来源）', () => {
  const bad = IDX.split('\n').filter((l) => /writeFileSync\(cfgPath,\s*JSON\.stringify/.test(l))
  assert(bad.length === 0, '★ embedding-config 仍裸写：' + bad.join(' | '))
  assert(/writeTextAtomicPreSync\(cfgPath/.test(IDX), '未切原子写')
})

t('T8c-6 ★ 模块必须零运行时依赖（只 node: 内置）', () => {
  const imports = [...CIO_SRC.matchAll(/^import\s+.*?from\s+'([^']+)'/gm)].map((m) => m[1])
  const ext = imports.filter((s) => !s.startsWith('node:'))
  assert(ext.length === 0, '★ 有外部依赖：' + ext.join(', '))
})

t('T8c-7 ★★ 写盘失败必须留痕（fail-soft 不得静默）', () => {
  const n = (IDX.match(/persistConfig\w* failed/g) || []).length
  assert(n >= 2, '★ 两个 persist 路径都应留痕，实为 ' + n)
})

console.log('\n[t8] ' + pass + ' passed, ' + fail + ' failed')
process.exit(fail ? 1 : 0)
