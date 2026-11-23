/** smoke-test-hub-access.mjs —— ★#520 / 向导 P1：跨区写权限纯决策层的功能验收（CR-10） */
import { createHarness } from './_harness.mjs'
import { decideWriteTargetPre, isHubSessionPre, normalizeWsKeyPre, WRITE_DENY } from '../../lib/hub-access.js'
import { UPGRADE_LINKS, usableUpgradeLinksPre, UPGRADE_LINK_LABELS } from '../../lib/upgrade-links.js'

const T = createHarness('hub-access')

// ── 归一化：目录名与绝对路径都能比；★#552 大小写按平台/文件系统语义 ──
// 旧判据（无条件 toLowerCase）已过期：它把 Linux 上两个不同 inode 的目录归一成同一 key。
T.eq(normalizeWsKeyPre('C:\\Users\\X\\.dsh\\memory\\workspaces\\--D--proj--', { caseSensitive: true }), 'C:/Users/X/.dsh/memory/workspaces/--D--proj--', 'N1 大小写敏感语义：斜杠归一但保留原大小写（新判据；旧=恒小写）')
T.eq(normalizeWsKeyPre('C:\\Users\\X\\.dsh\\memory\\workspaces\\--D--proj--', { caseSensitive: false }), 'c:/users/x/.dsh/memory/workspaces/--d--proj--', 'N1b 大小写不敏感语义（Windows）：折叠小写')
T.eq(normalizeWsKeyPre('/srv/ws/ProjectA', { caseSensitive: true }) === normalizeWsKeyPre('/srv/ws/projecta', { caseSensitive: true }), false, 'N1c ★大小写敏感语义：ProjectA 与 projecta 不得归一为同一 key（负路径）')
T.eq(normalizeWsKeyPre('  "--D--proj--"  ', { caseSensitive: false }), '--d--proj--', 'N2 去引号/空白，保留目录名')
T.eq(normalizeWsKeyPre(''), '', 'N3 空值⇒空串（不猜）')

// ── 身份门 ──
T.eq(isHubSessionPre(['sid-a'], 'sid-a'), true, 'H1 中枢会话命中')
T.eq(isHubSessionPre(['sid-a'], 'sid-b'), false, 'H2 非中枢不命中')
T.eq(isHubSessionPre([], 'sid-a'), false, 'H3 空集合一律 false（fail closed）')
T.eq(isHubSessionPre(['sid-a'], ''), false, 'H4 空 sid 一律 false')

const HUB = ['session-hub-1']
const ALLOWED = ['C:/mem/workspaces/--D--proj-a--', '--D--proj-b--', 'C:/mem/workspaces/--C--Users-X-.dsh-hub--']

// ── 未传 requested：与既有行为一致 ──
const r1 = decideWriteTargetPre({ sessionId: 'session-x', hubSessionIds: HUB, boundWs: 'C:/mem/workspaces/--D--proj-a--', allowedWs: ALLOWED })
T.eq(r1.ok, true, 'D1 未传目标⇒放行'); T.eq(r1.target, 'C:/mem/workspaces/--D--proj-a--', 'D2 落点=会话绑定'); T.eq(r1.redirected, false, 'D3 未重定向')

// ── 负路径：无绑定且无目标 ──
const r2 = decideWriteTargetPre({ sessionId: 'session-x', hubSessionIds: HUB, boundWs: '', allowedWs: ALLOWED })
T.eq(r2.ok, false, 'D4 无绑定无目标⇒拒'); T.eq(r2.code, WRITE_DENY.NO_BOUND, 'D5 码=workspace-unbound')

// ── 负路径：非中枢传目标（#520 的核心反面）──
const r3 = decideWriteTargetPre({ sessionId: 'session-user', hubSessionIds: HUB, boundWs: 'C:/mem/workspaces/--D--proj-a--', requestedWs: '--D--proj-b--', allowedWs: ALLOWED })
T.eq(r3.ok, false, 'D6 非中枢跨区⇒拒'); T.eq(r3.code, WRITE_DENY.NOT_HUB, 'D7 码=requires-hub'); T.eq(typeof r3.detail.hint, 'string', 'D8 拒因带可执行提示')

// ── 正路径：中枢 + 白名单内（目录名形式）──
const r4 = decideWriteTargetPre({ sessionId: 'session-hub-1', hubSessionIds: HUB, boundWs: 'C:/mem/workspaces/--C--Users-X-.dsh-hub--', requestedWs: '--D--proj-b--', allowedWs: ALLOWED })
T.eq(r4.ok, true, 'D9 中枢+清单内⇒放行'); T.eq(r4.target, '--D--proj-b--', 'D10 落点=匹配到的授权项'); T.eq(r4.redirected, true, 'D11 确实重定向')

// ── 正路径：目录名经 resolveWs 解析成绝对路径 ──
const r5 = decideWriteTargetPre({ sessionId: 'session-hub-1', hubSessionIds: HUB, boundWs: 'C:/mem/workspaces/--C--Users-X-.dsh-hub--', requestedWs: '--D--proj-b--', allowedWs: ALLOWED, resolveWs: (w) => 'C:/mem/workspaces/' + w })
T.eq(r5.ok, true, 'D12 解析后仍在清单内⇒放行'); T.eq(r5.target, '--D--proj-b--', 'D13 ★落点=匹配到的授权项（目录名授权原值，不是解析后的请求值）')
const RESOLVED_ONLY = ['C:/mem/workspaces/--D--proj-c--']
const r5b = decideWriteTargetPre({ sessionId: 'session-hub-1', hubSessionIds: HUB, boundWs: 'C:/mem/workspaces/--C--Users-X-.dsh-hub--', requestedWs: '--D--proj-c--', allowedWs: RESOLVED_ONLY, resolveWs: (w) => 'C:/mem/workspaces/' + w })
T.eq(r5b.ok, true, 'D13a 仅解析值命中授权项⇒放行'); T.eq(r5b.target, 'C:/mem/workspaces/--D--proj-c--', 'D13b ★落点=匹配到的授权项（解析后的白名单原值）')

// ── 负路径：中枢但目标不在清单 ──
const r6 = decideWriteTargetPre({ sessionId: 'session-hub-1', hubSessionIds: HUB, boundWs: 'C:/mem/workspaces/--C--Users-X-.dsh-hub--', requestedWs: '--D--proj-zzz--', allowedWs: ALLOWED })
T.eq(r6.ok, false, 'D14 清单外⇒拒'); T.eq(r6.code, WRITE_DENY.NOT_IN_SCOPE, 'D15 码=not-in-manifest'); T.eq(Array.isArray(r6.detail.allowed), true, 'D16 拒因带可用清单')

// ── 负路径：清单为空 ⇒ fail closed（哪怕中枢）──
const r7 = decideWriteTargetPre({ sessionId: 'session-hub-1', hubSessionIds: HUB, boundWs: 'C:/mem/workspaces/--C--Users-X-.dsh-hub--', requestedWs: '--D--proj-b--', allowedWs: [] })
T.eq(r7.ok, false, 'D17 空清单⇒拒'); T.eq(r7.code, WRITE_DENY.NOT_IN_SCOPE, 'D18 码=not-in-manifest')

// ── 负路径：requested 是空白串 ⇒ 视作未传（不得当成授权）──
const r8 = decideWriteTargetPre({ sessionId: 'session-user', hubSessionIds: HUB, boundWs: 'C:/mem/workspaces/--D--proj-a--', requestedWs: '   ', allowedWs: ALLOWED })
T.eq(r8.ok, true, 'D19 空白目标视作未传⇒按绑定放行'); T.eq(r8.redirected, false, 'D20 且不算重定向')

// ── ★#552：大小写语义按平台/文件系统判定，落点取授权项 ──
// 旧 D21 无条件小写钉成绿；现在改成显式「Windows 大小写不敏感」语境（生产形状）= 仍放行。
const r9 = decideWriteTargetPre({ sessionId: 'session-hub-1', hubSessionIds: HUB, boundWs: 'C:/mem/workspaces/--C--Users-X-.dsh-hub--', requestedWs: 'c:\\MEM\\workspaces\\--d--proj-a--', allowedWs: ALLOWED, caseSensitive: false })
T.eq(r9.ok, true, 'D21 大小写不敏感语义（Windows）⇒大小写/斜杠差异仍命中白名单')
T.eq(r9.target, 'C:/mem/workspaces/--D--proj-a--', 'D22 ★落点=匹配到的授权项原值，不是小写请求值')
// 负路径：同一请求放到大小写敏感语义（Linux/macOS 大小写敏感卷）下必须拒。
const r10 = decideWriteTargetPre({ sessionId: 'session-hub-1', hubSessionIds: HUB, boundWs: 'C:/mem/workspaces/--C--Users-X-.dsh-hub--', requestedWs: 'c:\\MEM\\workspaces\\--d--proj-a--', allowedWs: ALLOWED, caseSensitive: true })
T.eq(r10.ok, false, 'D23 ★★大小写敏感语义⇒大小写不同的请求必须拒（#552 越权）')
T.eq(r10.code, WRITE_DENY.NOT_IN_SCOPE, 'D24 码=not-in-manifest')
const r11 = decideWriteTargetPre({ sessionId: 'session-hub-1', hubSessionIds: HUB, boundWs: '/srv/ws/hub', requestedWs: '/srv/ws/projecta', allowedWs: ['/srv/ws/ProjectA'], caseSensitive: true })
T.eq(r11.ok, false, 'D25 ★★/srv/ws/projecta 冒用 /srv/ws/ProjectA ⇒ 必须拒')
const r12 = decideWriteTargetPre({ sessionId: 'session-hub-1', hubSessionIds: HUB, boundWs: '/srv/ws/hub', requestedWs: '/srv/ws/ProjectA', allowedWs: ['/srv/ws/ProjectA'], caseSensitive: true })
T.eq(r12.ok, true, 'D26 大小写完全一致 ⇒ 放行（正对照）')
T.eq(r12.target, '/srv/ws/ProjectA', 'D27 ★落点=匹配到的授权项')

// ── 链接常量：只存 https，且文案与链接同源 ──
T.eq(/^https:\/\//.test(UPGRADE_LINKS.relay), true, 'L1 中转站为 https')
T.eq(/^https:\/\//.test(UPGRADE_LINKS.group), true, 'L2 交流群为 https')
T.eq(Object.keys(usableUpgradeLinksPre(UPGRADE_LINKS)).length, Object.keys(UPGRADE_LINKS).length, 'L3 全部链接可用')
T.eq(Object.keys(usableUpgradeLinksPre({ bad: 'javascript:alert(1)', ok: 'https://a.b/c' })).join(','), 'ok', 'L4 非 https 链接被过滤（负路径）')
T.eq(Object.keys(UPGRADE_LINKS).every((k) => typeof UPGRADE_LINK_LABELS[k] === 'string' && UPGRADE_LINK_LABELS[k].length > 0), true, 'L5 每个链接都有按钮文案')

T.done()
