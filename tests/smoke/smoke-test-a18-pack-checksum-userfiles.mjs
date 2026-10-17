// A18 / #438 —— 迁移包 checksum 覆盖 userFiles（2026-10-17）
//
// 缺陷（探针已证）：篡改 `userFiles['CALENDAR.md']` ⇒ `validatePackPre = {ok:true,errors:[]}`
//   且 checksum 与原件**完全相等**；而那一行会被 `calendarMergePre` **真的并入**本机日历。
//   附带同源缺陷：`checksum.algo` 只写不读，`packChecksumPre` 硬用 sha256 ⇒ 改 algo 即可冒充旧包。
//
// 修法：
//   ① `packChecksumPre(files, userFiles)` 真参与摘要，两本清单各带 `F`/`U` 命名空间前缀；
//   ② **无 userFiles ⇒ 走旧喂法，摘要与 v1 逐字节相同**（否则在野旧包全部 checksum-mismatch）；
//   ③ 兼容判据写在 `checksum.algo` 上：缺省/'sha256'=v1、'sha256+userFiles-v2'=v2、
//      其它=未知拒收；v1 包若带 userFiles ⇒ `userfiles-unproven-by-checksum`（D2：fail closed）；
//   ④ **不改 pack.format**（新增格式名会让新包与旧版本互斥）。
//
// 判据纪律：真 import → 真构造 → 真调用 → 断言返回值（不用源码字符串当功能验收）。
// 变异验证（施工回执里报两次数值）：
//   · 把 `packChecksumPre(pack.files, userFiles)` 退回单参 ⇒ 正路径①红；
//   · 把 buildPack 恒写 v1 algo ⇒ 正路径①从另一侧红。
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  packChecksumPre,
  buildPackPre,
  validatePackPre,
  calendarMergePre,
  MIGRATE_PACK_FORMAT_PRE,
  MIGRATE_PACK_CHECKSUM_ALGO_PRE,
  MIGRATE_PACK_CHECKSUM_ALGO_V2_PRE,
} from '../../lib/migrate-pack.js'

let pass = 0, fail = 0
const ok = (cond, name) => { if (cond) { pass++; console.log('  ok   - ' + name) } else { fail++; console.error('  RED  - ' + name) } }
const eq = (got, want, name) => ok(JSON.stringify(got) === JSON.stringify(want),
  name + ' got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want))

/** v1 算法的**独立复刻**（只喂 files，无命名空间）—— 用于钉住「无 userFiles 时逐字节不变」。 */
function legacyChecksum(files) {
  const names = Object.keys(files || {}).sort()
  const h = createHash('sha256')
  for (const n of names) {
    h.update(n); h.update('\u0000'); h.update(String(files[n])); h.update('\u0000')
  }
  return h.digest('hex')
}

const FILES = { 'MEMORY.md': '# 笔记\n- 内部结论\n', 'handoff/PLAN.md': '白板 D:\\proj\n' }
const USER_FILES = { 'CALENDAR.md': '## 2026-10-01\n- [ ] 09:00 | 未分类 | 提交报告\n' }

// ─────────────────────────────────────────────────────────────
console.log('[A18-1] 正路径①：篡改 userFiles ⇒ 必红（修前这里是绿的 = 缺陷复现）')
{
  const built = buildPackPre({ ws: 'D:\\proj', files: FILES, userFiles: USER_FILES, now: 1 })
  ok(built.ok === true, '构造带 userFiles 的包成功')
  const pack = built.pack
  eq(pack.checksum.algo, MIGRATE_PACK_CHECKSUM_ALGO_V2_PRE, '★ 有 userFiles ⇒ 写 v2 algo')
  eq(pack.format, MIGRATE_PACK_FORMAT_PRE, '★ format 仍是 dam-pack-v1（不改格式名）')
  ok(validatePackPre(pack).ok === true, '原包自校验通过')
  eq(validatePackPre(pack).errors, [], '原包无错误')

  // ★核心复现：只改 userFiles 正文，checksum 字段原样保留
  const tampered = JSON.parse(JSON.stringify(pack))
  tampered.userFiles['CALENDAR.md'] = '## 2026-10-01\n- [x] 09:00 | 未分类 | EVIL_TAMPERED_ROW\n'
  eq(tampered.checksum, pack.checksum, '（前置）checksum 字段本身未被改动')
  const v = validatePackPre(tampered)
  ok(v.ok === false, '★ 篡改 userFiles ⇒ 校验失败（修前为 ok:true）')
  ok(v.errors.includes('checksum-mismatch'), '★ 错误码 checksum-mismatch')
  ok(tampered.files['MEMORY.md'] === pack.files['MEMORY.md'], '（前置）files 未改动')

  // 该篡改行会被 calendarMergePre 真的并入本机日历 ⇒ 佐证危害不是纸面问题
  ok(typeof calendarMergePre === 'function', '（取证）calendarMergePre 可用（下面 A18-8 用真调用佐证危害）')
}

// ─────────────────────────────────────────────────────────────
console.log('[A18-2] 负路径①：篡改 files 仍必红（防「只修 userFiles 忘了 files」半修）')
{
  const pack = buildPackPre({ ws: 'D:\\proj', files: FILES, userFiles: USER_FILES, now: 1 }).pack
  const t = JSON.parse(JSON.stringify(pack))
  t.files['MEMORY.md'] = '被篡改'
  const v = validatePackPre(t)
  ok(v.ok === false && v.errors.includes('checksum-mismatch'), '★ 篡改 files ⇒ 仍 checksum-mismatch')

  // 两本清单同时篡改也必须红
  const t2 = JSON.parse(JSON.stringify(pack))
  t2.files['handoff/PLAN.md'] = 'x'
  t2.userFiles['CALENDAR.md'] = 'y'
  ok(validatePackPre(t2).errors.includes('checksum-mismatch'), '两本清单同时篡改 ⇒ 仍红')
}

// ─────────────────────────────────────────────────────────────
console.log('[A18-3] 负路径②：旧包（无 userFiles）必须通过，且摘要与 v1 算法逐字节相同')
{
  const built = buildPackPre({ ws: 'D:\\proj', files: FILES, now: 1 })
  const pack = built.pack
  ok(!pack.userFiles || Object.keys(pack.userFiles).length === 0, '无 userFiles ⇒ 包里无该键或为空')
  eq(pack.checksum.algo, MIGRATE_PACK_CHECKSUM_ALGO_PRE, '★ 无 userFiles ⇒ 仍写 v1 algo（旧值）')
  eq(pack.checksum.value, legacyChecksum(FILES), '★ 无 userFiles ⇒ 摘要与 v1 算法**逐字节相同**')
  ok(validatePackPre(pack).ok === true, '无 userFiles ⇒ 自校验通过')

  // 单参调用（旧调用方签名）必须与旧算法完全相同
  eq(packChecksumPre(FILES), legacyChecksum(FILES), '★ packChecksumPre(files) 与 v1 算法逐字节相同')
  eq(packChecksumPre(FILES, {}), legacyChecksum(FILES), 'packChecksumPre(files, {}) 同上')
  eq(packChecksumPre(FILES, null), legacyChecksum(FILES), 'packChecksumPre(files, null) 同上')

  // 冻结基线 hex：这批夹具的 v1 摘要必须一直是这个值（防有人"顺手"改了喂法）
  eq(legacyChecksum(FILES), '4fb01781575151d906c398653a6451559d12fe4b026642a0f7cb5011ba8e48e4',
    '★ 冻结基线 hex（v1 喂法不变）')

  // 手工构造的 v1 旧包（algo 显式 'sha256'、无 userFiles）必须仍被接受
  const hand = JSON.parse(JSON.stringify(pack))
  hand.checksum = { algo: 'sha256', value: legacyChecksum(FILES) }
  eq(validatePackPre(hand).errors, [], '★ 手工 v1 旧包（显式 algo）仍通过')
}

// ─────────────────────────────────────────────────────────────
console.log('[A18-4] 负路径③：旧包带 userFiles ⇒ 必拒（D2 fail closed），错误码正确')
{
  const pack = buildPackPre({ ws: 'D:\\proj', files: FILES, userFiles: USER_FILES, now: 1 }).pack

  // 把 algo 降级成 v1（模拟"旧版本打包器"）
  const legacyAlgo = JSON.parse(JSON.stringify(pack))
  legacyAlgo.checksum = { algo: 'sha256', value: legacyChecksum(FILES) }
  const v1 = validatePackPre(legacyAlgo)
  ok(v1.ok === false, '★ v1 algo + userFiles ⇒ 拒收')
  ok(v1.errors.includes('userfiles-unproven-by-checksum'), '★ 错误码 userfiles-unproven-by-checksum')
  ok(!v1.errors.includes('checksum-mismatch'), '错误码是"未被完整性覆盖"，不是"内容不符"（语义可区分）')

  // 完全缺省 algo（最老形态）同样拒
  const noAlgo = JSON.parse(JSON.stringify(pack))
  noAlgo.checksum = { value: legacyChecksum(FILES) }
  ok(validatePackPre(noAlgo).errors.includes('userfiles-unproven-by-checksum'), '★ 缺省 algo + userFiles ⇒ 同样拒')

  // 空 userFiles 对象不算"带 userFiles" ⇒ 旧包兼容路径不误伤
  const emptyU = JSON.parse(JSON.stringify(pack))
  emptyU.userFiles = {}
  emptyU.checksum = { algo: 'sha256', value: legacyChecksum(FILES) }
  eq(validatePackPre(emptyU).errors, [], '空 userFiles ⇒ 不算"带 userFiles"，旧包兼容不误伤')
}

// ─────────────────────────────────────────────────────────────
console.log('[A18-5] 负路径④：缺省 algo 视作 v1（只比 files）；未知 algo ⇒ 拒')
{
  const pack = buildPackPre({ ws: 'D:\\proj', files: FILES, now: 1 }).pack
  const noAlgo = JSON.parse(JSON.stringify(pack))
  noAlgo.checksum = { value: legacyChecksum(FILES) }
  eq(validatePackPre(noAlgo).errors, [], '★ 缺省 algo 视作 v1 ⇒ 通过（历史包兼容）')

  // v2 包但 algo 缺省 ⇒ 按 v1 只比 files ⇒ 与 v2 摘要不等 ⇒ checksum-mismatch（不放行）
  const v2NoAlgo = JSON.parse(JSON.stringify(buildPackPre({ ws: 'D:\\proj', files: FILES, userFiles: USER_FILES, now: 1 }).pack))
  v2NoAlgo.checksum = { value: v2NoAlgo.checksum.value }
  ok(validatePackPre(v2NoAlgo).errors.length > 0, 'v2 摘要 + 缺省 algo ⇒ 被拒（不会被误当 v1 放行）')

  // ★精确判据（变异 B 的鉴别器）：v2 algo + value 却是**只覆盖 files 的 v1 摘要**
  //   ⇒ 必须拒。若校验只算 files（不读 userFiles），这里会被误判通过 —— 那正是"半修"形态。
  const v2AlgoV1Value = JSON.parse(JSON.stringify(
    buildPackPre({ ws: 'D:\\p', files: FILES, userFiles: USER_FILES, now: 1 }).pack))
  v2AlgoV1Value.checksum = { algo: MIGRATE_PACK_CHECKSUM_ALGO_V2_PRE, value: legacyChecksum(FILES) }
  const vv = validatePackPre(v2AlgoV1Value)
  ok(vv.ok === false && vv.errors.includes('checksum-mismatch'),
    '★ v2 algo + v1 摘要 ⇒ 拒（证明校验真的把 userFiles 算进去了）')

  for (const algo of ['md5', 'sha1', 'sha512', 'sha256 ', 'SHA256+userFiles-v2', 'junk']) {
    const bad = JSON.parse(JSON.stringify(pack))
    bad.checksum = { algo, value: pack.checksum.value }
    const v = validatePackPre(bad)
    ok(v.ok === false && v.errors[0].startsWith('unknown-checksum-algo:'),
      '★ 未知 algo 拒收且码可读: ' + JSON.stringify(algo) + ' ⇒ ' + JSON.stringify(v.errors))
  }
}

// ─────────────────────────────────────────────────────────────
console.log('[A18-6] 负路径⑤：无 userFiles 时 checksum 往返一致（冻结基线 hex，两本书各一）')
{
  // 空 files 的单文件包
  const one = { 'MEMORY.md': 'x' }
  eq(buildPackPre({ ws: 'D:\\p', files: one, now: 1 }).pack.checksum.value, legacyChecksum(one),
    '★ 单文件包摘要 == v1 复算')
  // 多文件 + 顺序无关
  const a = { b: '2', a: '1', c: '3' }
  eq(packChecksumPre(a), packChecksumPre({ c: '3', a: '1', b: '2' }), '★ 键序无关（确定性）')
  eq(packChecksumPre(a), legacyChecksum(a), '★ 键序无关且 == v1 复算')
  // v2 也必须键序无关
  eq(packChecksumPre(a, USER_FILES), packChecksumPre({ c: '3', a: '1', b: '2' }, USER_FILES), '★ v2 键序无关')
  // 往返：build → validate 的 value 与手工 packChecksumPre 一致
  const p2 = buildPackPre({ ws: 'D:\\p', files: a, userFiles: USER_FILES, now: 1 }).pack
  eq(p2.checksum.value, packChecksumPre(a, USER_FILES), '★ v2 包内 value == 手工 packChecksumPre(files,userFiles)')
  ok(validatePackPre(p2).ok, 'v2 往返自校验通过')
}

// ─────────────────────────────────────────────────────────────
console.log('[A18-7] 命名空间隔离：同一路径在 files 与 userFiles 之间搬家必须改变摘要')
{
  const m1 = buildPackPre({ ws: 'D:\\p', files: { a: 'X' }, userFiles: { a: 'Y' }, now: 1 }).pack
  const m2 = buildPackPre({ ws: 'D:\\p', files: { a: 'Y' }, userFiles: { a: 'X' }, now: 1 }).pack
  ok(m1.checksum.value !== m2.checksum.value,
    '★ files[a]=X,user[a]=Y 与 files[a]=Y,user[a]=X 摘要不同（跨清单搬家可检测）')
  // 反向：同内容不同清单也必须不同（否则命名空间根本没生效）
  const s1 = buildPackPre({ ws: 'D:\\p', files: { a: 'SAME' }, userFiles: { b: 'SAME2' }, now: 1 }).pack
  const s2 = buildPackPre({ ws: 'D:\\p', files: { b: 'SAME2' }, userFiles: { a: 'SAME' }, now: 1 }).pack
  ok(s1.checksum.value !== s2.checksum.value, '★ 键名搬家（files{a} ↔ user{b}）同样改变摘要')
}

// ─────────────────────────────────────────────────────────────
console.log('[A18-8] 真实危害面：篡改后的日历行确实会被 calendarMergePre 并入（危害佐证）')
{
  const local = '## 2026-09-30\n- [ ] 08:00 | 未分类 | 本机条目\n'
  const evil = '## 2026-10-01\n- [ ] 09:00 | 未分类 | EVIL_TAMPERED_ROW\n'
  const merged = calendarMergePre(local, evil)
  ok(merged.ok === true && merged.added === 1, '篡改行确实会被并入（added=1）')
  ok(merged.text.includes('EVIL_TAMPERED_ROW'), '★ 佐证危害：被篡改的日历正文真的进了合并结果')
  ok(merged.text.includes('本机条目'), '本机条目同时保留（merge 不覆盖）')
  // 而 #438 修复后，这种包在校验阶段就被拒了（不会走到 merge）：
  // 包内 CALENDAR.md 是**正常内容**，攻击者把它换成篡改行后 checksum 对不上。
  const pack = buildPackPre({ ws: 'D:\\p', files: FILES, userFiles: USER_FILES, now: 1 }).pack
  const t = JSON.parse(JSON.stringify(pack))
  t.userFiles['CALENDAR.md'] = evil
  ok(t.userFiles['CALENDAR.md'] !== pack.userFiles['CALENDAR.md'], '（前置）篡改确实改变了 userFiles 内容')
  ok(validatePackPre(t).errors.includes('checksum-mismatch'), '★ 修复后同一篡改在校验阶段即被拒')
}

// ─────────────────────────────────────────────────────────────
console.log('[A18-9] 常量与契约面：v2 常量存在且与写入值一致；format 未变')
{
  eq(MIGRATE_PACK_CHECKSUM_ALGO_V2_PRE, 'sha256+userFiles-v2', '★ v2 algo 常量取值')
  eq(MIGRATE_PACK_CHECKSUM_ALGO_PRE, 'sha256', 'v1 algo 常量未被改动（旧包互认）')
  eq(MIGRATE_PACK_FORMAT_PRE, 'dam-pack-v1', '★ format 未改（不与旧版本互斥）')
  const withU = buildPackPre({ ws: 'D:\\p', files: FILES, userFiles: USER_FILES, now: 1 }).pack
  eq(withU.checksum.algo, MIGRATE_PACK_CHECKSUM_ALGO_V2_PRE, '写入值 == 常量')
  ok(withU.checksum.value.length === 64 && /^[0-9a-f]{64}$/.test(withU.checksum.value), 'sha256 64 位小写 hex')
  ok(withU.stats.userFileCount === 1 && withU.stats.userBytes > 0, 'stats 仍记 userFileCount/userBytes（未受影响）')
}

console.log('\n[a18-pack-checksum-userfiles] pass=' + pass + ' fail=' + fail)
process.exit(fail ? 1 : 0)
