/* 2026-09-28 修复轮（用户实测报障）：
 * A. ★团队页白屏铁因：上一轮拼接把 `var team = tt.team` 吞掉了（client.js 只剩 var tt）
 *    ⇒ 一切到团队页即 ReferenceError ⇒ 整页白屏。（B 部分落地时同时补回这一行）
 * B. ★单机也要能用（用户原话「没有加入 team，单机版你也得让他用啊，总不能因为没有 team 就直接抛错」）：
 *    teamFromState 原来 teamEnabled!==true 直接 return null ⇒ 团队页只剩一句死胡同。
 *    改为返回本机态对象（localOnly:true）；页面顶部挂说明条，内容照常展示。
 * C. ★泳道全空壳（真机 103 卡里 54 张「交接账本 · 时间戳」）：preamble 小节仅含文档级 `type:state`
 *    标记也产卡。修：剥离标记/注释/空白后无实质内容则**不产卡**。
 * 纪律：改前备份；全锚点唯一断言；行尾按文件原生归一。 */
const fs = require('fs')
const crlf = (s) => s.replace(/\r?\n/g, '\r\n')

const CB = 'D:/dsh-auto-memory/lib/client.js'
let s = fs.readFileSync(CB, 'utf8')
const b0 = Buffer.byteLength(s, 'utf8')
const h0 = require('crypto').createHash('sha256').update(s).digest('hex').slice(0, 8).toUpperCase()
fs.writeFileSync('D:/dsh-auto-memory/artifacts/backup/client.js.r45-' + b0 + '-' + h0 + '.js', s, 'utf8')
const once = (n, t) => { let c = 0, i = -1; for (let p = 0; (p = s.indexOf(n, p)) >= 0; p += 1) { c++; if (i < 0) i = p } if (c !== 1) throw new Error(t + ' hits=' + c); return i }

// A) 白屏铁因：补回被吞掉的 `var team = tt.team`
{
  const a = '      var tt = useTeamTick()\r\n      // ★2026-09-28:teamShowMemberBadges'
  const i = once(s, a, 'A1')
  s = s.slice(0, i) + crlf('      var tt = useTeamTick()\r\n      var team = tt.team\r\n      // ★2026-09-28:teamShowMemberBadges') + s.slice(i + a.length)
}
// B1) teamFromState：单机返回本机态（不再 null）
{
  const a = crlf([
    '    function teamFromState(st) {',
    "      if (!st || !st.config || st.config.teamEnabled !== true) return null",
    '      var t = st.team',
    "      if (!t || typeof t !== 'object') return { member: null, queue: 0, conflicts: 0, syncAt: 0, attribution: {} }",
  ].join('\n'))
  const i = once(s, a, 'B1')
  const rep = crlf([
    '    function teamFromState(st) {',
    '      // ★2026-09-28（用户原话「没有加入 team，单机版你也得让他用啊，总不能因为没有 team 就直接抛错」）：',
    '      //   单机不再返回 null——返回本机态（localOnly:true），页面照常展示本机可用内容 + 说明条。',
    '      //   null 仅保留给「state 根本没拿到」（加载失败/未就绪）。',
    '      if (!st || !st.config) return null',
    "      var localOnly = st.config.teamEnabled !== true",
    '      var t = st.team',
    "      if (!t || typeof t !== 'object') {",
    "        return { member: null, queue: 0, conflicts: 0, syncAt: 0, attribution: {}, localOnly: localOnly }",
    '      }',
  ].join('\n'))
  s = s.slice(0, i) + rep + s.slice(i + a.length)
}
// B2) 正常分支补 localOnly
{
  const a = crlf([
    "        attribution: t.attribution && typeof t.attribution === 'object' ? t.attribution : {},",
    '      }',
    '    }',
  ].join('\n'))
  const i = once(s, a, 'B2')
  const rep = crlf([
    "        attribution: t.attribution && typeof t.attribution === 'object' ? t.attribution : {},",
    '        localOnly: localOnly,',
    '      }',
    '    }',
  ].join('\n'))
  s = s.slice(0, i) + rep + s.slice(i + a.length)
}
// B3) TeamTab：单机说明条 + 非死胡同
{
  const a = crlf([
    "      if (!team) return h('div', { 'data-dam-team': 'off', 'data-dam-slot': 'empty', 'data-dam-kx-empty': '' },",
    "        locale === 'zh' ? '团队协作未启用（设置 → 团队协作）' : 'Teamwork is off (Settings → Teamwork)')",
  ].join('\n'))
  const i = once(s, a, 'B3')
  const rep = crlf([
    "      if (!team) return h('div', { 'data-dam-team': 'off', 'data-dam-slot': 'empty', 'data-dam-kx-empty': '' },",
    "        locale === 'zh' ? '团队协作未启用（设置 → 团队协作）' : 'Teamwork is off (Settings → Teamwork)')",
    '      // ★2026-09-28 单机可用：本机记录（归属轨迹/冲突/技能）照常展示，顶部只挂说明条。',
    '      var localOnly = team.localOnly === true',
    "      var localBanner = localOnly ? h('div', { 'data-dam-team': 'local-banner', 'data-dam-slot': 'hint', 'data-dam-hint': '' },",
    "        locale === 'zh'",
    "          ? '单机模式：以下为本机记录（归属轨迹、冲突中心、技能审批都可用）。多人同步与成员在场需在「设置 → 团队协作」填入团队端。'",
    "          : 'Standalone: everything below is local (attribution, conflicts, skill review work). Multi-user sync & presence need a team endpoint in Settings.') : null",
  ].join('\n'))
  s = s.slice(0, i) + rep + s.slice(i + a.length)
}
// B4) 渲染：横幅插最前
{
  const a = crlf([
    "      return h('div', { 'data-dam-team': 'tab' },",
    '        h(TeamStatusBar, { team: team }),',
  ].join('\n'))
  const i = once(s, a, 'B4')
  const rep = crlf([
    "      return h('div', { 'data-dam-team': 'tab' },",
    '        localBanner,',
    '        h(TeamStatusBar, { team: team }),',
  ].join('\n'))
  s = s.slice(0, i) + rep + s.slice(i + a.length)
}
// B5) 成员屏空态：单机文案
{
  const a = crlf([
    "        return h('div', { 'data-dam-team-members': 'empty', className: 'dam-team-members' },",
    "          h('span', { 'data-dam-slot': 'hint', 'data-dam-hint': '' }, zh ? '未加入团队' : 'Not joined yet'))",
  ].join('\n'))
  const i = once(s, a, 'B5')
  const rep = crlf([
    "        return h('div', { 'data-dam-team-members': 'empty', className: 'dam-team-members' },",
    "          h('span', { 'data-dam-slot': 'hint', 'data-dam-hint': '' }, (props && props.localOnly) ? (zh ? '单机：暂无其他成员（本机记录照常可用）' : 'Standalone: no other members (local data still works)') : (zh ? '未加入团队' : 'Not joined yet')))",
  ].join('\n'))
  s = s.slice(0, i) + rep + s.slice(i + a.length)
}
// B6) R18 透传 localOnly
{
  const a = '        h(TeamMembersScreen, { team: team, badges: props && props.badges, filterActor: flt.actor, onFilter: props && props.onFilterActor }),'
  const i = once(s, a, 'B6')
  s = s.slice(0, i) + '        h(TeamMembersScreen, { team: team, badges: props && props.badges, localOnly: team && team.localOnly, filterActor: flt.actor, onFilter: props && props.onFilterActor }),' + s.slice(i + a.length)
}
fs.writeFileSync(CB, s, 'utf8')
console.log('client.js:', b0, '->', Buffer.byteLength(s, 'utf8'),
  '| lone-LF:', (s.match(/(^|[^\r])\n/g) || []).length,
  '| var team=', (s.match(/var team = tt\.team/g) || []).length,
  '| localOnly:', (s.match(/localOnly/g) || []).length)

// C) wb-sidecar：preamble 空壳不产卡
const SB = 'D:/dsh-auto-memory/lib/wb-sidecar.js'
let w = fs.readFileSync(SB, 'utf8')
const w0 = Buffer.byteLength(w, 'utf8')
const onceW = (n, t) => { let c = 0, i = -1; for (let p = 0; (p = w.indexOf(n, p)) >= 0; p += 1) { c++; if (i < 0) i = p } if (c !== 1) throw new Error(t + ' hits=' + c); return i }
{
  const a = '  const real = sections.filter((s) => !s.preamble || s.body.length > 0)'
  const i = onceW(a, 'C1')
  const rep = [
    '  // ★2026-09-28（真机实测：103 卡里 54 张是「交接账本 · 时间戳」空壳卡）：',
    '  //   账本形态 = `# 交接账本 · <时间>`(H1) + `type:state`(文档级标记) + `## 任务状态` 真实小节。',
    '  //   旧口径 preamble 判 body.length>0 ⇒ 仅含 type:* 标记也产卡 ⇒ 54 张空壳卡，',
    '  //   且因正文含 type:* 全落进四泳道，把真实小节挤去杂项。',
    '  //   新口径：剥离标记行/注释行/空行后仍有实质内容才产卡。',
    '  const hasRealPre = (b) => String(b || "")',
    '    .split("\\n")',
    '    .map((l) => l.trim())',
    '    .filter((l) => l.length > 0)',
    '    .filter((l) => !/^<!--.*-->$/.test(l))',
    '    .filter((l) => !/^\\s*[-*]?\\s*type:\\s*(goal|state|dead-end|progress|archive)\\s*$/i.test(l))',
    '    .length > 0',
    '  const real = sections.filter((s) => !s.preamble || hasRealPre(s.body))',
  ].join('\n')
  w = w.slice(0, i) + rep + w.slice(i + a.length)
}
fs.writeFileSync(SB, w, 'utf8')
console.log('wb-sidecar.js:', w0, '->', Buffer.byteLength(w, 'utf8'),
  '| CRLF:', (w.match(/\r\n/g) || []).length,
  '| hasRealPre:', w.split('hasRealPre').length - 1)
