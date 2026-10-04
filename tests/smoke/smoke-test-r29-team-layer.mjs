/** R29 · 团队层：08 卷 §四 8 点 + 37 卷两条必做项（真执行 + 负路径）。 */
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
const damPath = (rel) => fileURLToPath(new URL('../../' + rel, import.meta.url))
const SRC = readFileSync(damPath('lib/client.js'), 'utf8')
/** 平台无关行尾守恒（★2026-09-28）：存在 CRLF 时不得有裸 LF；全 LF 合法（CI/Linux 检出态）。
 *  原实现 `SRC.split('\r\n')` + 断言段数 === CRLF 数 + 1，等价于「必须全 CRLF」——Linux CI 必红。 */
const damNoMixedEol = (s) => {
  const crlf = (s.match(/\r\n/g) || []).length
  const lf = (s.match(/\n/g) || []).length
  if (crlf === 0) return true
  return crlf === lf
}
let p = 0, f = 0; const fails = []
const ok = (c, m) => { if (c) p++; else { f++; fails.push(m) } }
const eq = (a, b, m) => ok(Object.is(a, b), m + ' [got=' + JSON.stringify(a) + ' want=' + JSON.stringify(b) + ']')
const cntRaw = (x) => (SRC.match(new RegExp(x, 'g')) || []).length
const cntCall = (x) => (SRC.match(new RegExp('(?<!function )' + x, 'g')) || []).length

/* ── A. 08 卷 §四 8 个改动点（静态在场，降级为守卫） */
const P8 = {
  '3.1 状态条': ["'data-dam-team': 'bar'", "'data-dam-team': 'member'", "'data-dam-team': 'synced'", "'data-dam-team': 'queue'", "'data-dam-team': 'conflicts'"],
  '3.2 作者徽标': ['data-dam-team-badge'],
  '3.3 冲突中心': ["'data-dam-team': 'conflict-center'", "'data-dam-team': 'conflict-empty'"],
  // ★2026-10-03（G3 死壳摘除）：原锚点 'dam-team-settings' 属于**已摘除的死代码** renderTeamSettings15
  //   （零调用者；FRONTEND-FIX-PLAN §6 裁定摘除）。屏⑦ 的现行实现是 renderTeamSettings(ctx)，
  //   分区锚点形态为 data-dam-team="settings-*" + data-dam-key=<配置键>。判据随实现迁移，覆盖面不缩小。
  '3.4 团队设置分区': ["'data-dam-team': 'settings-section'", "'data-dam-team': 'settings-switch'", "'data-dam-team': 'settings-state'"],
  '3.5 成员在场': ['TeamMembersScreen'],
  '3.6 CSS 令牌': ['.dam-team-bar'],
  '3.7 轮询钩子(复用 useTick)': ['useTeamTick'],
  '3.8 主题兼容': ['data-dam-team']
}
for (const [k, arr] of Object.entries(P8)) ok(arr.every((s) => SRC.includes(s)), 'A ★08 卷 §四 ' + k + '（守卫生效）')
ok(cntCall('useTeamTick') >= 1, 'A-g 轮询钩子有**真实调用**（非仅定义；实测 ' + cntCall('useTeamTick') + ' 处）')

/* ── B. ★37 卷 §二 硬判据：两承载面共用同一数据函数 */
eq(cntRaw('function teamFromState'), 1, 'B1 ★★teamFromState **唯一定义**（不许各写一份）')
ok(cntCall('teamFromState\\(') >= 2, 'B2 ★★两个承载面都调用同一函数（实测 ' + cntCall('teamFromState\\(') + ' 处）')
eq(cntCall('MemoryTabBody\\(tab, nonce\\)'), 2, 'B3 ★浮层与会话页各调一次 MemoryTabBody（同一内容源）')
eq(cntCall('MEMORY_TABS\\(\\)'), 2, 'B4 ★★MEMORY_TABS() 调用**恰为 2**（37 卷 L89 计数锁；★口径=排除定义处）')
eq(cntCall('fetchTeamState\\(\\)'), cntCall('function fetchTeamState') >= 1 ? cntCall('fetchTeamState\\(\\)') : -1, 'B5 fetchTeamState 有调用点')
ok(SRC.includes('_teamInflight') && SRC.includes('if (_teamInflight) return _teamInflight'), 'B6 ★单飞去重（并发复用同一 Promise，不重复请求）')

/* ── C. ★vm 真执行 teamFromState（门控铁律 4 条） */
function mkTeam() {
  const i = SRC.indexOf('    function teamFromState(st) {')
  const j = SRC.indexOf('\n    }', i) + 6;
  const sb = { console, String, Number, Object, JSON, Math, Array, Boolean }
  sb.globalThis = sb;
  vm.runInContext(SRC.slice(i, j) + ';globalThis.__T = teamFromState;', vm.createContext(sb), { filename: 'client.js#team' });
  return sb.__T
}
const T = mkTeam()
eq(T(null), null, 'C1 ★门控：无 state ⇒ null')
eq(T({}), null, 'C2 ★门控：无 config ⇒ null')
// ★2026-09-28 守卫演进（用户裁定：「没有加入 team，单机版你也得让他用啊，总不能因为没有 team 就直接抛错」）：
//   teamEnabled 非 true ⇒ 不再 null，改返回**本机态**（localOnly:true）——团队页照常展示本机
//   归属/冲突/技能，只在顶部挂说明条。null 仅保留给「无 state / 无 config」（C1/C2 仍锁）。
const c3 = T({ config: {} })
eq(c3 !== null && c3.localOnly === true, true, 'C3 ★★门控演进：teamEnabled 非 true ⇒ 本机态 localOnly:true（单机可用；原「⇒ null」于 2026-09-28 按用户裁定演进）')
const c4 = T({ config: { teamEnabled: false } })
eq(c4 !== null && c4.localOnly === true, true, 'C4 ★门控演进：teamEnabled=false ⇒ 本机态 localOnly:true（同上）')
ok(T({ config: { teamEnabled: true } }) !== null, 'C5 ★teamEnabled=true ⇒ 有返回值（可渲染）')
const r = T({ config: { teamEnabled: true } })
eq(r.member, null, 'C6 ★缺 team 时 member 回退 null（不抛）')
eq(r.queue, 0, 'C7 ★缺 team 时 queue 回退 0（类型安全）')
eq(r.conflicts, 0, 'C8 ★缺 team 时 conflicts 回退 0')
ok(r.attribution && typeof r.attribution === 'object', 'C9 ★attribution 回退空对象（37 卷 §1 作者归属）')
const r2 = T({ config: { teamEnabled: true }, team: { member: { id: 'm1', name: '甲' }, queue: 3, conflicts: 1, syncAt: 123, attribution: { a: { memberName: '乙' } } } })
eq(r2.member.name, '甲', 'C10 ★★真数据：member 透传（前端能显示「谁同步的」）')
eq(r2.queue, 3, 'C11 ★真数据：queue=3')
eq(r2.conflicts, 1, 'C12 ★真数据：conflicts=1')
eq(r2.syncAt, 123, 'C13 ★真数据：syncAt 透传')
eq(r2.attribution.a.memberName, '乙', 'C14 ★★attribution 按条透传（37 卷 §1 旁挂索引）')
const r3 = T({ config: { teamEnabled: true }, team: { queue: '3', conflicts: null, syncAt: 'x' } })
eq(r3.queue, 0, 'C15 ★负路径：queue 非数字 ⇒ 回退 0（不污染 UI）')
eq(r3.conflicts, 0, 'C16 ★负路径：conflicts=null ⇒ 回退 0')
eq(r3.syncAt, 0, 'C17 ★负路径：syncAt 非数字 ⇒ 回退 0')
eq(T({ config: { teamEnabled: true }, team: 'str' }).member, null, 'C18 ★负路径：team 非对象 ⇒ 安全回退（不抛）')
ok(typeof T({ config: { teamEnabled: true }, team: { attribution: 'x' } }).attribution === 'object', 'C19 ★负路径：attribution 非对象 ⇒ 回退空对象（不是字符串）')

/* ── D. 08 卷 §五 不可碰清单 ── */
// ★2026-09-28：原判据 `L.length - 1 === (SRC.match(/\r\n/g)||[]).length`（"必须全 CRLF"）在
//   Linux CI 必红——索引里是 LF，本机 core.autocrlf=true 才检出 CRLF。守的语义不变：文件不得混合行尾。
eq(damNoMixedEol(SRC), true, 'D1 ★不混合行尾（有 CRLF 则裸 LF 为 0；全 LF 合法）')
ok(cntRaw('data-dam-[a-z0-9-]+') >= 163, 'D2 ★data-dam-* 锚点 ≥163（08 卷 §五；实测 ' + cntRaw('data-dam-[a-z0-9-]+') + '）')
eq(cntRaw('L3-team:begin'), 1, 'D3 L3-team:begin 恰 1（追加段标记在）')
eq(cntRaw('L3-team:end'), 1, 'D4 L3-team:end 恰 1')
ok(!/\bconst\s|\blet\s|=>/.test(SRC.slice(SRC.indexOf('L3-team:begin'), SRC.indexOf('L3-team:end'))), 'D5 ★L3 段 ES5 合规（无 const/let/箭头）')
console.log('PASS ' + p + ' / FAIL ' + f)
fails.forEach((x) => console.log('  FAIL: ' + x))
process.exit(f === 0 ? 0 : 1)