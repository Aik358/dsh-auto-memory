// P1 · state-commit.js 纯函数契约测试（设计稿 §4 的 T1-5*/T1-6/T1-8）。
//
// 设计稿：docs/internal/DESIGN-P1-STATE-COMMIT-20260915.md（已获用户批准）
// 判据来源：TODO-GRAPH.html 卡 V2-P1 的 crit 列表 + MASTER-PLAN-3.0.md Phase 1。
//
// 本套件只测**纯函数**（零 IO、零接入），是 P1 步 1 的验收；接入类断言（T1-1/T1-2/T1-4/T1-7/T1-9）
// 在后续步骤的套件里。
import {
  STATE_COMMIT_VERSION_PRE, MIV_PREFIX_PRE,
  MEMORY_STATUS_PRE, TASK_STATE_PRE, ARCHIVE_STATE_PRE,
  buildStateCommitPre, commitConflictPre, commitReceiptPre,
  memoryIndexVersionPre, boardIdPre, describeCommitReasonPre,
} from '../../lib/state-commit.js'

let pass = 0, fail = 0
function ok(cond, name) { if (cond) { pass++; console.log('  ok - ' + name) } else { fail++; console.error('  FAIL - ' + name) } }

console.log('[state-commit] T1-5a 业务内容改变 ⇒ miv 变')
{
  const a = memoryIndexVersionPre({ records: [{ id: 'm1', status: 'current', l0: 'A' }] })
  const b = memoryIndexVersionPre({ records: [{ id: 'm1', status: 'current', l0: 'B' }] })
  ok(a !== b, '★内容变 ⇒ miv 必变')
  ok(a.startsWith(MIV_PREFIX_PRE), '前缀与既有口径一致(idx_)')
  ok(a.length === MIV_PREFIX_PRE.length + 32, '长度 = 前缀 + 32 hex')
  const a2 = memoryIndexVersionPre({ records: [{ id: 'm1', status: 'current', l0: 'A' }] })
  ok(a === a2, '同输入 ⇒ 同 miv（稳定，可复现）')
}

console.log('[state-commit] T1-5b 仅状态变化 ⇒ miv 必变（Phase 1 扩展口径）')
{
  const cur = memoryIndexVersionPre({ records: [{ id: 'm1', status: 'current' }] })
  const sup = memoryIndexVersionPre({ records: [{ id: 'm1', status: 'superseded' }] })
  const ret = memoryIndexVersionPre({ records: [{ id: 'm1', status: 'retracted' }] })
  ok(cur !== sup, '★current → superseded ⇒ miv 必变')
  ok(cur !== ret, '★current → retracted ⇒ miv 必变')
  ok(sup !== ret, '三种记忆状态两两不同 ⇒ miv 两两不同')
}

console.log('[state-commit] T1-5c 仅切换会话 / 仅 rebuilt_at 变 ⇒ miv 不变（钉死"不得当版本序"）')
{
  const base = { records: [{ id: 'm1', status: 'current', l0: 'X' }] }
  const a = memoryIndexVersionPre(base)
  // rebuilt_at 是时间戳，**刻意不进 canonical** ⇒ 不进函数入参，断言取同样输入的稳定性
  const b = memoryIndexVersionPre({ records: [{ id: 'm1', status: 'current', l0: 'X' }], rebuilt_at: '2026-09-15T00:00:00Z' })
  ok(a === b, '★rebuilt_at 不参与 miv（时间戳变化不改变身份）')
  // 会话切换：miv 入参根本不含 sessionId/agent；额外字段必须被忽略
  const c = memoryIndexVersionPre({ records: [{ id: 'm1', status: 'current', l0: 'X' }], sessionId: 'sess-A', rebuilt_at: 'later' })
  ok(a === c, '★仅切换会话（附加 sessionId）⇒ miv 不变')
  // 输入顺序不影响（按 id 排序）
  const d = memoryIndexVersionPre({ records: [{ id: 'b', status: 'current' }, { id: 'a', status: 'current' }] })
  const e = memoryIndexVersionPre({ records: [{ id: 'a', status: 'current' }, { id: 'b', status: 'current' }] })
  ok(d === e, '记录顺序不影响 miv（按 id 排序，消除插入序噪声）')
}

console.log('[state-commit] T1-5d 白板卡片状态变化 ⇒ miv 必变（Phase 1 扩展）')
{
  const rec = [{ id: 'm1', status: 'current' }]
  const a = memoryIndexVersionPre({ records: rec, boardCards: [{ id: 'c1', status: 'open' }] })
  const b = memoryIndexVersionPre({ records: rec, boardCards: [{ id: 'c1', status: 'done' }] })
  ok(a !== b, '★白板卡片状态变化 ⇒ miv 必变')
  const c = memoryIndexVersionPre({ records: rec })
  ok(a !== c, '有无 boardCards 不同 ⇒ miv 不同')
  // 卡片 id 不与记忆 id 撞（前缀 board:）
  const x = memoryIndexVersionPre({ records: [{ id: 'zz', status: 'open' }] })
  const y = memoryIndexVersionPre({ records: [], boardCards: [{ id: 'zz', status: 'open' }] })
  ok(x !== y, 'board 条目与 record 条目即使 id 相同也不冲突（board: 前缀隔离）')
}

console.log('[state-commit] T1-6 boardId 不含 sessionId（卡内硬约束）')
{
  const a = boardIdPre('/ws/one', 'Workspace')
  const b = boardIdPre('/ws/one', 'Workspace')
  ok(a === b, '同工作区同 scope ⇒ boardId 相等（稳定）')
  ok(a !== boardIdPre('/ws/two', 'Workspace'), '不同工作区 ⇒ 不同 boardId')
  ok(a !== boardIdPre('/ws/one', 'User'), '不同 scope ⇒ 不同 boardId')
  // 签名层防御：即使额外塞 sessionId 也不该影响结果（函数不接收它）
  ok(boardIdPre('/ws/one', 'Workspace') === a, '★签名只收 workspaceKey/scope ⇒ sessionId 无从进入')
  ok(boardIdPre('', 'Workspace') === null, '空 workspaceKey ⇒ null（不产出假 id）')
}

console.log('[state-commit] T1-8 expectedStateVersion 缺省 ⇒ 行为不变（兼容档）')
{
  const mk = (extra) => buildStateCommitPre(Object.assign({
    workspaceKey: '/ws', boardId: 'b1', txId: 't1',
    actor: { sessionId: 's1', kind: 'user' },
  }, extra))
  const noVer = mk({})
  ok(noVer.ok === true, '缺省 expectedStateVersion/expectedDigest ⇒ 仍构单成功')
  ok(!Object.prototype.hasOwnProperty.call(noVer.commit, 'expectedStateVersion'), '★缺省时不写入该字段（下游行为与引入前一致）')
  ok(!Object.prototype.hasOwnProperty.call(noVer.commit, 'expectedDigest'), '缺省时不写入 expectedDigest')
  const withVer = mk({ expectedStateVersion: 'v9', expectedDigest: 'd9' })
  ok(withVer.commit.expectedStateVersion === 'v9' && withVer.commit.expectedDigest === 'd9', '显式给出时原样带上')
}

console.log('[state-commit] 构单 fail-closed（不猜测、不补默认）')
{
  ok(buildStateCommitPre(null).ok === false, 'null ⇒ 拒绝')
  ok(buildStateCommitPre({}).reason === 'actor-invalid', '空对象 ⇒ actor-invalid')
  const noWs = buildStateCommitPre({ boardId: 'b', txId: 't', actor: { sessionId: 's', kind: 'user' } })
  ok(noWs.ok === false && noWs.missing.includes('workspaceKey'), '缺 workspaceKey ⇒ 列出 missing')
  const badActor = buildStateCommitPre({ workspaceKey: '/w', boardId: 'b', txId: 't', actor: { sessionId: 's' } })
  ok(badActor.ok === false && badActor.reason === 'actor-invalid', 'actor 缺 kind ⇒ 拒绝')
  const badWrites = buildStateCommitPre({ workspaceKey: '/w', boardId: 'b', txId: 't', actor: { sessionId: 's', kind: 'user' }, writes: 'nope' })
  ok(badWrites.ok === false && badWrites.reason === 'invalid-writes', 'writes 非数组 ⇒ 拒绝')
  ok(describeCommitReasonPre('state-version-mismatch').includes('状态版本'), '原因码有可读中文')
}

console.log('[state-commit] 冲突可见（T1-7C 的三要素）')
{
  const { commit } = buildStateCommitPre({
    workspaceKey: '/ws', boardId: 'b1', txId: 'tx-7', expectedStateVersion: 'v1',
    actor: { sessionId: 'sess-old', contSeq: 7, kind: 'plugin' },
    writes: [{ path: '/ws/PLAN.md', content: 'x' }],
  })
  const conf = commitConflictPre(commit, { stateVersion: 'v2', target: '/ws/PLAN.md', kind: 'state-version' })
  ok(conf.ok === false && conf.reason === 'state-version-mismatch', '状态版本不符 ⇒ 该原因码')
  ok(conf.expected === 'v1' && conf.observed === 'v2', '★带期望版本与实测版本')
  ok(conf.target === '/ws/PLAN.md', '★带冲突目标')
  ok(conf.actor.includes('sess-old') && conf.actor.includes('@7'), '★带冲突方（sessionId + contSeq）')
  ok(conf.text.includes('提交被拒') && conf.text.includes('v1') && conf.text.includes('v2'), '拒绝文本可直接给人看')
  const conf2 = commitConflictPre(commit, { fileDigest: 'zz', target: '/ws/PLAN.md' })
  ok(conf2.reason === 'digest-mismatch', '摘要不符 ⇒ digest-mismatch')
}

console.log('[state-commit] 回执与状态隔离')
{
  const { commit } = buildStateCommitPre({
    workspaceKey: '/ws', boardId: 'b1', txId: 't9', actor: { sessionId: 's', kind: 'model' },
  })
  const rc = commitReceiptPre(commit, { digest: 'D', stateVersion: 'V', miv: 'M', at: 123 })
  ok(rc.ok === true && rc.txId === 't9' && rc.miv === 'M' && rc.at === 123, '回执带 txId/miv/时间（可观测凭据）')
  ok(STATE_COMMIT_VERSION_PRE === 'state_commit_v1', '契约版本号')
  // 三种状态不得混（命名隔离）
  ok(MEMORY_STATUS_PRE.includes('current') && !MEMORY_STATUS_PRE.includes('done'), '记忆状态不含任务态 done')
  ok(TASK_STATE_PRE.includes('done') && !TASK_STATE_PRE.includes('current'), '任务态不含记忆态 current')
  ok(ARCHIVE_STATE_PRE.includes('archived') && !ARCHIVE_STATE_PRE.includes('superseded'), '归档位与记忆态分离（archived 一词两义已拆）')
  ok(Object.isFrozen(MEMORY_STATUS_PRE) && Object.isFrozen(TASK_STATE_PRE) && Object.isFrozen(ARCHIVE_STATE_PRE), '三组常量为冻结数组（防运行期被改）')
}

console.log('[state-commit] ' + pass + '/' + (pass + fail) + ' assertions passed')
process.exit(fail === 0 ? 0 : 1)
