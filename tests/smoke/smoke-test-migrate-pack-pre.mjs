// 迁移搬包守卫（2026-09-22）—— 把「搬包不出错」钉成可回归的断言。
//
// 依据：docs/internal/MIGRATION-ARCH-20260922.md（三轮只读取证 + 用户四项拍板）。
//
// 形态：**真行为为主**（引擎是纯逻辑模块，可不启宿主直接跑）+ 宿主接线静态哨兵。
//   真行为断言覆盖：路径重写 4 种形态、同路径零改写、校验和跨机一致、坏包拒绝、
//   冲突三策略、内容相同不算覆盖、summary 合并**不覆盖其它工作区**。
//   静态哨兵覆盖：三处埋点接线、安全六条（备份/keep/checksum/merge/不带索引/不碰 sessions）。
//
// 零依赖（只用 node 内置 + 本仓 lib 模块）。
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
const rd = (p) => readFileSync(path.join(ROOT, p), 'utf8')

let pass = 0, fail = 0
const ok = (c, name, detail) => {
  if (c) { pass++; console.log('  ok -', name) }
  else { fail++; console.error('  FAIL -', name); if (detail) console.error('         ' + detail) }
}
const cnt = (h, n) => { let c = 0, i = 0; for (;;) { const p = h.indexOf(n, i); if (p < 0) return c; c++; i = p + n.length } }

// 引擎是 ESM，用动态 import（★Windows 上绝对路径必须包成 file:// URL，
// 否则 ERR_UNSUPPORTED_ESM_URL_SCHEME: Received protocol 'd:'）
const ENG = await import(pathToFileURL(path.join(ROOT, 'lib', 'migrate-pack-pre.js')).href)
const {
  workspaceSlugPre, pathVariantsPre, rewritePathsInTextPre, packChecksumPre,
  buildPackPre, validatePackPre, rewritePackForTargetPre, planImportPre,
  mergeSummaryRecordPre, renameForConflictPre,
  MIGRATE_PACK_FORMAT_PRE,
} = ENG

console.log('\n[S1] slug 与宿主实现一致（两处不一致 ⇒ 数据写进错误目录）')
{
  const IX = rd('lib/index.js')
  // 从宿主源码里取它的 slug 表达式（不硬编码）
  const m = /'--'\s*\+\s*String\(ws\)\.replace\(\/\[([^\]]+)\]\//.exec(IX)
  ok(Boolean(m), 'S1a 从宿主源码取到 slug 替换字符集（' + (m ? m[1] : '未取到') + '）')
  ok(workspaceSlugPre('D:\\dsh-auto-memory') === '--D--dsh-auto-memory--', 'S1b slug 与宿主逐字一致')
  ok(workspaceSlugPre('C:\\a b\\c') === '--C--a b-c--', 'S1c 空格与反斜杠')
  ok(workspaceSlugPre('') === '' && workspaceSlugPre(null) === '', 'S1d 空/非字符串不抛')
}

console.log('\n[S2] 路径 4 种形态（少一种就会漏改，到 B 机变死链）')
{
  const vs = pathVariantsPre('D:\\proj\\a')
  ok(vs.includes('D:\\proj\\a'), 'S2a 原形')
  ok(vs.includes('D:/proj/a'), 'S2b posix 形')
  ok(vs.includes('file:///D:/proj/a'), 'S2c file URL 形')
  ok(vs.includes('D:\\\\proj\\\\a'), 'S2d JSON 转义形')
  ok(vs[0].length >= vs[vs.length - 1].length, 'S2e 长形态优先（防短形抢先命中留残渣）')
}

console.log('\n[S3] 文本重写（真场景）')
{
  const body = '见 D:\\proj\\lib\\index.js 与 D:/proj/a，以及 --D--proj-- 的索引'
  const r = rewritePathsInTextPre(body, {
    fromPath: 'D:\\proj', toPath: 'C:\\work\\proj',
    fromSlug: '--D--proj--', toSlug: '--C--work-proj--',
  })
  ok(!r.text.includes('D:\\proj'), 'S3a 旧 Windows 路径消失')
  ok(!r.text.includes('D:/proj'), 'S3b 旧 posix 路径消失')
  ok(r.text.includes('C:\\work\\proj\\lib\\index.js'), 'S3c 新路径写入（含子路径）')
  ok(r.text.includes('--C--work-proj--'), 'S3d slug 重写')
  ok(r.hits >= 3, 'S3e 命中计数可回报（供预览展示）=' + r.hits)
}

console.log('\n[S4] ★路径相同 ⇒ 一个字都不改（保护用户正文，架构「情形 A」）')
{
  const body = '原文含 D:\\proj 字样'
  const same = rewritePackForTargetPre({ source: { ws: 'D:\\proj' }, files: { 'MEMORY.md': body } }, { targetWs: 'D:\\proj' })
  ok(same.plan.pathChanged === false, 'S4a 判定为同路径')
  ok(same.files['MEMORY.md'] === body, 'S4b 内容逐字节未变')
}

console.log('\n[S5] 打包 + 校验和（跨机必须一致，否则永远校验失败）')
{
  const files = { 'MEMORY.md': '# 笔记', 'handoff/PLAN.md': '白板 D:\\proj' }
  const b = buildPackPre({ ws: 'D:\\proj', files, pluginVersion: '3.1.0', now: 1 })
  ok(b.ok === true, 'S5a buildPack 成功')
  ok(b.pack.format === MIGRATE_PACK_FORMAT_PRE, 'S5b 格式标记 ' + MIGRATE_PACK_FORMAT_PRE)
  ok(b.pack.checksum.value.length === 64, 'S5c sha256 64 位')
  ok(validatePackPre(b.pack).ok === true, 'S5d 自校验通过')
  ok(packChecksumPre({ a: '1', b: '2' }) === packChecksumPre({ b: '2', a: '1' }), 'S5e ★校验和对键序不敏感')
}

console.log('\n[S6] 坏包必须被拒（S3：半损坏包会污染现场且难排查）')
{
  const b = buildPackPre({ ws: 'D:\\p', files: { 'MEMORY.md': 'x' } })
  const bad = JSON.parse(JSON.stringify(b.pack)); bad.files['MEMORY.md'] = '被篡改'
  ok(validatePackPre(bad).errors.includes('checksum-mismatch'), 'S6a 篡改 ⇒ checksum-mismatch')
  ok(validatePackPre({ format: 'dam-pack-v9' }).errors.some((e) => e.startsWith('unknown-format')), 'S6b 未知格式被拒')
  ok(validatePackPre({ format: MIGRATE_PACK_FORMAT_PRE, source: { ws: 'D:\\p' }, files: { '../evil.txt': 'x' } })
    .errors.some((e) => e.startsWith('unsafe-relative-path')), 'S6c ★路径穿越被拒')
  ok(validatePackPre({ format: MIGRATE_PACK_FORMAT_PRE, source: { ws: 'D:\\p' }, files: {} }).errors.includes('empty-files'), 'S6d 空包被拒')
  ok(validatePackPre(null).ok === false, 'S6e null 不抛')
}

console.log('\n[S7] 导入计划：冲突默认保留 B 机（S2）')
{
  const pk = buildPackPre({ ws: 'D:\\proj', files: { 'MEMORY.md': 'A机版本', '2026-09-22.md': 'A日志' } }).pack
  const keep = planImportPre(pk, { targetWs: 'C:\\work\\proj', existingFiles: { 'MEMORY.md': 'B机版本' } })
  ok(keep.onConflict === 'keep', 'S7a 默认策略=keep')
  ok(keep.writeFiles['MEMORY.md'] === undefined, 'S7b ★keep 下不写 B 机既有文件')
  ok(keep.additions.some((a) => a.path === '2026-09-22.md'), 'S7c 新增文件被列出')
  ok(keep.overwrites.length === 0, 'S7d keep 下无覆盖项')
  const ov = planImportPre(pk, { targetWs: 'C:\\work\\proj', existingFiles: { 'MEMORY.md': 'B机版本' }, onConflict: 'overwrite' })
  ok(ov.overwrites.length === 1 && ov.overwrites[0].oldBytes > 0, 'S7e overwrite 列出覆盖项含旧字节数（用户看得见代价）')
  const rn = planImportPre(pk, { targetWs: 'C:\\work\\proj', existingFiles: { 'MEMORY.md': 'B机版本' }, onConflict: 'rename' })
  ok(rn.writeFiles['MEMORY.from-pack.md'] !== undefined && rn.writeFiles['MEMORY.md'] === undefined, 'S7f rename 改名且不动原文件')
  ok(planImportPre(pk, { targetWs: 'D:\\proj', existingFiles: { 'MEMORY.md': 'A机版本' } }).overwrites.length === 0, 'S7g 内容相同 ⇒ 不列覆盖')
  ok(renameForConflictPre('handoff/PLAN.md') === 'handoff/PLAN.from-pack.md', 'S7h 改名保留扩展名')
}

console.log('\n[S8] ★summary 必须 merge 不能 replace（目标机有其它工作区的记录，实测 7 条）')
{
  const cur = { workspaces: [{ path: 'D:\\other', name: 'other', items: ['x'] }], graph: { topics: [], links: [] } }
  const rec = { path: 'D:\\proj', name: 'proj', items: ['a', 'b'], logCount: 3 }
  const m1 = mergeSummaryRecordPre(cur, rec, 'C:\\work\\proj')
  ok(m1.action === 'appended' && m1.summary.workspaces.length === 2, 'S8a 新路径 ⇒ append')
  ok(m1.summary.workspaces.some((w) => w.path === 'D:\\other'), 'S8b ★其它工作区记录未被覆盖')
  ok(m1.summary.workspaces[1].path === 'C:\\work\\proj', 'S8c 记录指向目标真实路径')
  ok(mergeSummaryRecordPre(m1.summary, rec, 'C:\\work\\proj').action === 'updated', 'S8d 同路径 ⇒ update 不重复追加')
  ok(mergeSummaryRecordPre(cur, null, 'D:\\y').action === 'noop', 'S8e 无记录 ⇒ noop 不崩')
}

console.log('\n[S9] 宿主接线哨兵（声明先于使用 + 安全六条）')
{
  const IX = rd('lib/index.js')
  ok(cnt(IX, "from './migrate-pack-pre.js'") === 1, 'S9a 引擎已 import（命中 1）')
  for (const k of ['migrate-export', 'migrate-inspect', 'migrate-import']) {
    ok(cnt(IX, "path: API['" + k + "'],") === 1, 'S9b 路由 ' + k + ' 已注册（命中 1）')
  }
  const iDef = IX.indexOf('async migrateImport(opts) {')
  const iUse = IX.indexOf('await engine.migrateImport(')
  ok(iDef > 0 && iUse > iDef, 'S9c ★哨兵：migrateImport 定义先于路由调用（否则运行期 TypeError）')
  const iDef2 = IX.indexOf('async migrateExport(opts) {')
  ok(iDef2 > 0 && IX.indexOf('await engine.migrateExport(') > iDef2, 'S9d ★哨兵：migrateExport 定义先于调用')
  const seg = IX.slice(iDef, iDef + 3800)
  ok(/copyDir\(targetDir, backup\)/.test(seg), 'S9e ★S1 导入前 copyDir 整体备份')
  ok(/backup-failed/.test(seg), 'S9f ★S1b 备份失败即中止')
  ok(/planImportPre\(r\.pack/.test(seg), 'S9g ★执行前重算计划（防 TOCTOU，不信任前端 plan）')
  ok(/mergeSummaryRecordPre/.test(seg), 'S9h ★S4 summary 走 merge')
  ok(!/\.dsh['"\/\\]+sessions/.test(IX.slice(IX.indexOf('async migrateExport'), IX.indexOf('async migrateExport') + 14000)), 'S9i ★S6 不触碰 ~/.dsh/sessions')
}

console.log('\n[S10] 引擎红线：零依赖、零写盘（IO 全在宿主 ⇒ 可单测）')
{
  const raw = rd('lib/migrate-pack-pre.js')
  const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').split(/\r?\n/).filter((l) => !l.trim().startsWith('//')).join('\n')
  const CALLS = /\b(?:writeFileSync|writeFile|appendFileSync|appendFile|mkdirSync|mkdir|rmSync|unlinkSync|unlink|rm)\s*\(/
  ok(!CALLS.test(code), 'S10a 无文件写/删调用')
  const imports = (code.match(/^import .*$/gm) || []).join(' ')
  ok(imports === "import { createHash } from 'node:crypto'", 'S10b import 白名单仅 node:crypto（实得：' + imports + '）')
}

console.log('\n[migrate-pack] ' + pass + ' passed, ' + fail + ' failed')
if (fail) process.exit(1)
