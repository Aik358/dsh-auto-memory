/* 2026-09-28 团队「谁改动/头像标记」正式接进经典档（用户点名「先加在旧版上」）
 * 修 4 件事:
 * ① TeamTab 归属行坏消费:路由回信封 {size,writes,items[]},旧代码 Object.keys(信封) ⇒ 渲染出
 *    "size/writes/items" 三行空徽章(用户看到「读得有问题」)。改为正确消费 items 数组,
 *    行内补 op 徽章 + fmtAgoShort(at) 时间。
 * ② TeamMembersScreen 成员行:补头像(团队 actorId 稳定哈希 fe02 §5.3 + 首字符,确定性生成不造假图)
 *    + 标记(mark/role 字段有才渲染)+「谁改动」摘要(attribution 按成员聚合:N 处+最近 op+条目+时间)。
 * ③ teamShowMemberBadges 死开关激活:键不在 DEFAULT_CONFIG 白名单 ⇒ 写了被丢弃(P0-7 同类缺口)。
 *    index.js 补默认 true;前端 TeamTab 取 config 消费(经 props.badges 下传)。
 * ④ CSS:头像/标记/摘要三条样式(--dam-team-* token + var() 兜底,无裸 hex)。
 * 纪律:改前备份;锚点唯一断言;CRLF 保持。 */
const fs = require('fs')
const crlf = (s) => s.replace(/\r?\n/g, '\r\n')
const once = (s, needle, tag) => {
  let c = 0, i = -1
  for (let p = 0; (p = s.indexOf(needle, p)) >= 0; p += 1) { c++; if (i < 0) i = p }
  if (c !== 1) throw new Error(tag + ' hits=' + c + ': ' + needle.slice(0, 70))
  return i
}

const CB = 'D:/dsh-auto-memory/lib/client.js'
let s = fs.readFileSync(CB, 'utf8')
const b0 = Buffer.byteLength(s, 'utf8')
const h0 = require('crypto').createHash('sha256').update(s).digest('hex').slice(0, 8).toUpperCase()
fs.writeFileSync('D:/dsh-auto-memory/artifacts/backup/client.js.r44-' + b0 + '-' + h0 + '.js', s, 'utf8')

// ①a TeamTab 头部:取 config 供 teamShowMemberBadges 消费
{
  const a = '      var tt = useTeamTick()\r\n      var team = tt.team'
  const i = once(s, a, 'T1')
  const ins = crlf([
    '      var team = tt.team',
    '      // ★2026-09-28:teamShowMemberBadges 此前是死开关(键不在服务端白名单,写了被丢)。',
    '      //   现正式消费:默认开(index.js DEFAULT_CONFIG 补 true),此处读回控制成员行徽标/摘要。',
    '      var cfgPair = useState(true)',
    '      useEffect(function () {',
    '        var alive = true',
    '        apiGet(API.config).then(function (d) { if (alive) cfgPair[1](configOf(d).teamShowMemberBadges !== false) }).catch(function () {})',
    '        return function () { alive = false }',
    '      }, [])',
    '      var badgesOn = cfgPair[0]',
  ].slice(1).join('\n'))
  s = s.slice(0, i) + crlf('      var tt = useTeamTick()') + '\r\n' + ins + s.slice(i + a.length)
}
// ①b 归属信封修复
{
  const a = crlf([
    '      var attr = team.attribution || {}',
    '      var keys = Object.keys(attr)',
    '      var rows = keys.slice(0, 200)',
  ].join('\n'))
  const i = once(s, a, 'T2')
  const rep = crlf([
    '      // ★2026-09-28 修坏消费:team.attribution 是信封 {size,writes,items[]}（index.js :13988）,',
    '      //   旧代码 Object.keys(信封) ⇒ 渲染 "size/writes/items" 三行空徽章。改按 items 数组消费。',
    '      var attrEnv = team.attribution || {}',
    '      var attrItems = Array.isArray(attrEnv.items) ? attrEnv.items : (Array.isArray(attrEnv) ? attrEnv : [])',
    '      var attrMap = {}',
    '      attrItems.forEach(function (it) { if (it && it.key) attrMap[it.key] = it })',
    '      var keys = attrItems.map(function (it) { return it.key }).filter(Boolean)',
    '      var rows = keys.slice(0, 200)',
  ].join('\n'))
  s = s.slice(0, i) + rep + s.slice(i + a.length)
}
// ①c 行取值改 attrMap
{
  const a = '                var v = attr[k] || {}'
  const i = once(s, a, 'T3')
  s = s.slice(0, i) + crlf('                var v = attrMap[k] || {}') + s.slice(i + a.length)
}
// ①d 行渲染补 op 徽章 + 时间
{
  const a = crlf([
    "                return h('div', { key: k, 'data-dam-row': '', 'data-dam-team': 'attr-row' },",
    "                  h('span', { style: { flex: 1 } }, k),",
    "                  h(TeamBadge, { name: v.memberName || v.memberId || '' }))",
  ].join('\n'))
  const i = once(s, a, 'T4')
  const rep = crlf([
    "                return h('div', { key: k, 'data-dam-row': '', 'data-dam-team': 'attr-row' },",
    "                  h('span', { style: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, k),",
    "                  v.op ? h('span', { 'data-dam-team-attr-op': String(v.op), style: { flexShrink: 0, fontSize: '10px', padding: '0 5px', borderRadius: '3px', border: '1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.28))', color: 'var(--dsw-alias-label-secondary)' } }, String(v.op)) : null,",
    "                  v.at ? h('span', { 'data-dam-team-attr-at': String(v.at), style: { flexShrink: 0, fontSize: '10px', color: 'var(--dsw-alias-label-tertiary)' } }, fmtAgoShort(v.at)) : null,",
    "                  h(TeamBadge, { name: v.memberName || v.memberId || '' }))",
  ].join('\n'))
  s = s.slice(0, i) + rep + s.slice(i + a.length)
}
// ①e TeamTab → R18 下传 badges
{
  const a = '        h(TeamScreensR18, { team: team }),'
  const i = once(s, a, 'T5')
  s = s.slice(0, i) + crlf('        h(TeamScreensR18, { team: team, badges: badgesOn }),') + s.slice(i + a.length)
}
// ②a R18 → 成员屏下传 badges
{
  const a = '        h(TeamMembersScreen, { team: team, filterActor: flt.actor, onFilter: props && props.onFilterActor }),'
  const i = once(s, a, 'T6')
  s = s.slice(0, i) + crlf('        h(TeamMembersScreen, { team: team, badges: props && props.badges, filterActor: flt.actor, onFilter: props && props.onFilterActor }),') + s.slice(i + a.length)
}
// ②b 成员行:头像 + 标记 + 谁改动摘要
{
  const a = crlf([
    '        list.map(function (m) {',
    "          var st = (pres[m.id] && pres[m.id].state) || 'offline'",
    '          var isSelf = !!(me && me.id === m.id) || m.isSelf === true',
    "          var attrs = { key: m.id, 'data-dam-team-member': String(m.id), 'data-dam-team-presence': st, className: 'dam-team-member' }",
    "          if (isSelf) attrs['data-dam-team-member-self'] = 'true'",
    '          return h(\'div\', attrs,',
    "            h('span', { 'data-dam-team-presence-dot': st, className: 'dam-team-presence-dot' }),",
    '            h(\'span\', null, m.name || m.id))',
    '        }),',
  ].join('\n'))
  const i = once(s, a, 'T7')
  const rep = crlf([
    '        list.map(function (m) {',
    "          var st = (pres[m.id] && pres[m.id].state) || 'offline'",
    '          var isSelf = !!(me && me.id === m.id) || m.isSelf === true',
    "          var attrs = { key: m.id, 'data-dam-team-member': String(m.id), 'data-dam-team-presence': st, className: 'dam-team-member' }",
    "          if (isSelf) attrs['data-dam-team-member-self'] = 'true'",
    '          // ★2026-09-28 成员头像+标记+「谁改动」摘要（fe02 §3 正式接线补完;用户点名先加旧版）:',
    '          //   头像 = actorId 稳定哈希色点 + 首字符（确定性生成,不造假图片,fe02 §5.3 同源）;',
    '          //   标记 = mark/role 字段(有才渲染,不编造);摘要 = team-attribution 旁挂索引按成员聚合。',
    '          var attrEnv = (team && team.attribution) || {}',
    '          var attrArr = Array.isArray(attrEnv.items) ? attrEnv.items : (Array.isArray(attrEnv) ? attrEnv : [])',
    '          var mine = attrArr.filter(function (it) { return it && (it.memberId === m.id || (m.name && it.memberName === m.name)) })',
    '          var last = mine.length ? mine[mine.length - 1] : null',
    "          var hue = teamActorHue(m.id || m.name || '?')",
    "          var ini = String(m.name || m.id || '?').trim().charAt(0).toUpperCase()",
    "          var mark = m.mark || m.role || ''",
    '          var showB = (props && props.badges) !== false',
    '          return h(\'div\', attrs,',
    "            h('span', { 'data-dam-team-presence-dot': st, className: 'dam-team-presence-dot' }),",
    "            h('span', { 'data-dam-team-avatar': String(hue), className: 'dam-team-avatar', style: { background: 'hsl(' + hue + ', 62%, 46%)' } }, ini),",
    '            h(\'span\', null, m.name || m.id),',
    "            showB && mark ? h('span', { 'data-dam-team-mark': String(mark), className: 'dam-team-mark' }, String(mark)) : null,",
    "            showB && mine.length ? h('span', { 'data-dam-team-attr-summary': String(mine.length), className: 'dam-team-attr-summary', title: last ? (last.key || '') + ' · ' + String(last.op || '') : '' },",
    "              (zh ? '改过 ' : '') + mine.length + (zh ? ' 处' : ' edits') + (last ? ' · ' + String(last.op || '') + ' ' + fmtAgoShort(last.at) : '')) : null)",
    '        }),',
  ].join('\n'))
  s = s.slice(0, i) + rep + s.slice(i + a.length)
}
// ④ CSS(无裸 hex;var() 兜底走既有掩码口径)
{
  const a = "      '.dam-team-presence-dot { width: 7px; height: 7px; border-radius: var(--dam-radius-circle, 50%); background: var(--dam-text); opacity: .55; }',"
  const i = once(s, a, 'T8')
  const css = crlf([
    "      '.dam-team-avatar { width: 18px; height: 18px; border-radius: var(--dam-radius-circle, 50%); display: inline-flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 700; color: var(--dam-team-avatar-fg, #fff); flex: 0 0 auto; }',",
    "      '.dam-team-mark { font-size: 10px; padding: 0 5px; border-radius: 3px; border: 1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.28)); color: var(--dsw-alias-label-secondary); flex: 0 0 auto; }',",
    "      '.dam-team-attr-summary { font-size: 10px; color: var(--dsw-alias-label-tertiary); flex: 0 0 auto; }',",
  ].join('\n'))
  s = s.slice(0, i + a.length) + '\r\n' + css + s.slice(i + a.length)
}
fs.writeFileSync(CB, s, 'utf8')

// ③ index.js:teamShowMemberBadges 进 DEFAULT_CONFIG 白名单(默认 true)
const IB = 'D:/dsh-auto-memory/lib/index.js'
let ix = fs.readFileSync(IB, 'utf8')
const bI0 = Buffer.byteLength(ix, 'utf8')
const hI0 = require('crypto').createHash('sha256').update(ix).digest('hex').slice(0, 8).toUpperCase()
fs.writeFileSync('D:/dsh-auto-memory/artifacts/backup/index.js.r44-' + bI0 + '-' + hI0 + '.js', ix, 'utf8')
{
  const a = "  teamConflictPolicy: 'keep-both',"
  const i = once(ix, a, 'I1')
  const ins = crlf([
    "  teamConflictPolicy: 'keep-both',",
    '  /** ★2026-09-28 正式接线（用户点名「先加在旧版上」）：成员头像/标记/「谁改动」摘要显示开关。',
    '   *  此前该键只有设置控件、不在本白名单 ⇒ 写了被 /config 丢弃（死开关，P0-7 同类缺口）。默认 true。 */',
    '  teamShowMemberBadges: true,',
  ].slice(1).join('\n'))
  ix = ix.slice(0, i) + ins + ix.slice(i + a.length)
}
fs.writeFileSync(IB, ix, 'utf8')

// 验证
for (const [p, name] of [[CB, 'client'], [IB, 'index']]) {
  const c = fs.readFileSync(p, 'utf8')
  console.log(name, ':', Buffer.byteLength(c, 'utf8'),
    '| lone-LF:', (c.match(/(^|[^\r])\n/g) || []).length,
    '| avatar:', c.split('dam-team-avatar').length - 1,
    '| attrMap:', c.split('attrMap').length - 1,
    '| badgesOn:', c.split('badgesOn').length - 1,
    '| attrEnv:', c.split('attrEnv').length - 1,
    '| memberBadges默认:', c.split('teamShowMemberBadges: true').length - 1)
}
