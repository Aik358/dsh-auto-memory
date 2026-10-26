/**
 * smoke-test-v5-p6-r6-regroup-apply.mjs
 *
 * ★R6 验收（2026-10-27）：event-regroup-apply.js —— **唯一会写用户数据**的模块。
 *
 * 【本套件的核心价值】**
 *   前面 R1-R3 都是只读/纯函数，写错了顶多算错。本模块**写错就毁用户数据**。
 *   所以每条安全机制都必须是**真执行验证**，不能只查源码：
 *     · 默认 dry-run（不传 apply:true 绝不能写盘）
 *     · 令牌校验（防止「批准 A 落盘 B」）
 *     · 快照先行（写盘前必须有备份）
 *     · 不物理删除（旧事件标 archived，不是删掉）
 *     · 回滚可用（快照能还原）
 */
import fs from 'node:fs'
import path from 'node:path'
import {
  BACKUP_DIRNAME,
  MAX_BACKUPS,
  proposalTokenPre,
  snapshotStorePre,
  previewApplyPre,
  applyRegroupPre,
  rollbackFromSnapshotPre,
} from '../../lib/event-regroup-apply.js'
import { readStorePre } from '../../lib/event-store.js'

let pass = 0, fail = 0
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  ok   - ' + name + (extra ? ' :: ' + extra : '')) }
  else { fail++; console.log('  FAIL - ' + name + (extra ? ' :: ' + extra : '')) }
}

const TMP = 'D:/dsh-auto-memory/artifacts/_r6-tmp'
try { fs.rmSync(TMP, { recursive: true, force: true }) } catch (e) {}
fs.mkdirSync(TMP, { recursive: true })
const STORE = path.join(TMP, 'event-store.json')
const BK = path.join(TMP, BACKUP_DIRNAME)

function seedStore(events) {
  fs.writeFileSync(STORE, JSON.stringify({ schema: 'v4_event_store_v1', events, updatedAt: 1 }), 'utf8')
}
const EV = (id, name, status) => ({
  id, name, status, summary: '', sections: { goal: '', doing: '', deadend: '', next: '' },
  checkpoints: [], constraints: [], userPercept: [], agentTrace: [], sharedGround: [], commitment: [],
  createdAt: 1, updatedAt: 1,
})
const PROPOSAL = (names) => ({
  schema: 'v1_event_regroup_proposal',
  workspace: 'test-ws',
  generatedAt: 123,
  proposedGroups: names.map((n, i) => ({
    name: n, summary: '总览 ' + n, members: ['ws/a' + i + '.md'],
    sections: { goal: 'g', doing: 'd', deadend: '', next: 'n' },
  })),
  requiresHumanApproval: true,
})

try {
  console.log('== A. 令牌（防「批准 A 落盘 B」）==')
  {
    const p1 = PROPOSAL(['事件甲', '事件乙'])
    const p2 = PROPOSAL(['事件甲', '事件丙'])
    const t1 = proposalTokenPre(p1)
    const t2 = proposalTokenPre(p2)
    ok(typeof t1 === 'string' && t1.length === 16, 'A-1 令牌是 16 位', t1)
    ok(t1 === proposalTokenPre(PROPOSAL(['事件甲', '事件乙'])), 'A-2 ★相同提案 ⇒ 相同令牌（确定性）')
    ok(t1 !== t2, 'A-3 ★★不同提案 ⇒ 不同令牌（改了名字必须失效）', t1 + ' vs ' + t2)
    // members 顺序不影响令牌（排序后规范化）
    const pa = { schema: 's', workspace: 'w', proposedGroups: [{ name: '甲甲甲甲', members: ['a', 'b'] }] }
    const pb = { schema: 's', workspace: 'w', proposedGroups: [{ name: '甲甲甲甲', members: ['b', 'a'] }] }
    ok(proposalTokenPre(pa) === proposalTokenPre(pb), 'A-4 ★members 顺序不影响令牌（内部排序）')
    ok(proposalTokenPre({}) === proposalTokenPre(null), 'A-5 空/null 一致不炸')
  }

  console.log('')
  console.log('== B. dry-run 默认（不传 apply:true 绝不写盘）==')
  {
    seedStore([EV('evt_1', '旧事件一', 'active'), EV('evt_2', '旧事件二', 'closed')])
    const before = fs.readFileSync(STORE, 'utf8')
    const proposal = PROPOSAL(['新事件甲'])
    const r = await applyRegroupPre({ proposal, storePath: STORE, backupDir: BK, token: proposalTokenPre(proposal) })
    ok(r.ok === true && r.dryRun === true, 'B-1 ★未传 apply ⇒ dryRun=true', String(r.dryRun))
    const after = fs.readFileSync(STORE, 'utf8')
    ok(before === after, 'B-2 ★★dry-run **没有改动文件**（逐字节相同）')
    ok(r.preview.toCreate.length === 1, 'B-3 预览给出待建事件', r.preview.toCreate.length)
    ok(r.preview.toArchive.length === 1, 'B-4 ★预览只归档 active（closed 不动）', r.preview.toArchive.length)
    ok(fs.existsSync(BK) === false, 'B-5 ★dry-run 不建快照目录')
  }

  console.log('')
  console.log('== C. 令牌校验（缺/错都必须拒绝）==')
  {
    seedStore([EV('evt_1', '旧', 'active')])
    const proposal = PROPOSAL(['新事件甲乙'])
    const good = proposalTokenPre(proposal)

    const noTok = await applyRegroupPre({ proposal, storePath: STORE, backupDir: BK })
    ok(noTok.ok === false && noTok.code === 'no-token', 'C-1 ★缺令牌被拒', noTok.code)
    ok(noTok.expectedToken === good, 'C-2 拒绝时返回正确令牌（便于用户确认）')

    const badTok = await applyRegroupPre({ proposal, storePath: STORE, backupDir: BK, token: 'DEADBEEFDEADBEEF' })
    ok(badTok.ok === false && badTok.code === 'token-mismatch', 'C-3 ★错令牌被拒', badTok.code)

    // 篡改提案：令牌对不上
    const tampered = PROPOSAL(['被篡改的事件名'])
    const r2 = await applyRegroupPre({ proposal: tampered, storePath: STORE, backupDir: BK, token: good, apply: true })
    ok(r2.ok === false && r2.code === 'token-mismatch', 'C-4 ★★★「批准 A 却落盘 B」被拦住', r2.code)
    ok(fs.readFileSync(STORE, 'utf8').indexOf('被篡改') < 0, 'C-5 ★拒绝时文件未被改动')
  }

  console.log('')
  console.log('== D. 快照先行（写盘前必须有备份）==')
  {
    seedStore([EV('evt_1', '旧事件', 'active')])
    const proposal = PROPOSAL(['落盘事件甲'])
    const r = await applyRegroupPre({ proposal, storePath: STORE, backupDir: BK, token: proposalTokenPre(proposal), apply: true })
    ok(r.ok === true && r.dryRun === false, 'D-1 真落盘成功', r.ok ? 'created ' + r.created.length : r.error)
    ok(r.snapshot && r.snapshot.ok === true && !!r.snapshot.file, 'D-2 ★★写盘前已生成快照', r.snapshot && r.snapshot.file)
    ok(fs.existsSync(r.snapshot.file), 'D-3 快照文件真的在盘上')
    const snapContent = fs.readFileSync(r.snapshot.file, 'utf8')
    ok(snapContent.indexOf('旧事件') >= 0, 'D-4 ★快照是**写盘前**的内容（含旧事件）')
  }

  console.log('')
  console.log('== E. 不物理删除旧事件（用户裁定 Q4）==')
  {
    seedStore([EV('evt_1', '旧事件一', 'active'), EV('evt_2', '已归档的', 'archived')])
    const proposal = PROPOSAL(['新事件甲'])
    const r = await applyRegroupPre({ proposal, storePath: STORE, backupDir: BK, token: proposalTokenPre(proposal), apply: true })
    const store = await readStorePre(STORE)
    ok(r.ok === true, 'E-1 落盘成功')
    ok(store.events.length === 3, 'E-2 ★★旧事件**没有被删除**（2 旧 + 1 新 = 3）', store.events.length)
    const old1 = store.events.find((e) => e.id === 'evt_1')
    ok(!!old1 && old1.status === 'archived', 'E-3 ★旧 active 被标 archived（不是删）', old1 && old1.status)
    ok(!!old1 && !!old1.archivedAt && old1.archivedBy === 'regroup', 'E-4 归档带时间与来源标记')
    const already = store.events.find((e) => e.id === 'evt_2')
    ok(!!already && already.status === 'archived', 'E-5 已归档的不重复处理')
    const created = store.events.filter((e) => e.origin === 'regroup-ai')
    ok(created.length === 1 && created[0].name === '新事件甲', 'E-6 新事件已创建且带 origin', created.length)
    ok(Array.isArray(created[0].memberLedgers) && created[0].memberLedgers.length === 1, 'E-7 ★成员账本被记录（可回溯）', created[0].memberLedgers.join(','))
  }

  console.log('')
  console.log('== F. 回滚（快照能还原）==')
  {
    seedStore([EV('evt_1', '回滚前的事件', 'active')])
    const beforeText = fs.readFileSync(STORE, 'utf8')
    const proposal = PROPOSAL(['回滚测试事件'])
    const r = await applyRegroupPre({ proposal, storePath: STORE, backupDir: BK, token: proposalTokenPre(proposal), apply: true })
    ok(r.ok === true, 'F-1 落盘成功')
    ok(fs.readFileSync(STORE, 'utf8').indexOf('回滚测试事件') >= 0, 'F-2 新事件已在盘上')

    const rb = await rollbackFromSnapshotPre({ storePath: STORE, backupFile: r.snapshot.file })
    ok(rb.ok === true, 'F-3 ★回滚执行成功', rb.error || '')
    const afterText = fs.readFileSync(STORE, 'utf8')
    ok(afterText === beforeText, 'F-4 ★★★回滚后与落盘前**逐字节相同**')
    ok(afterText.indexOf('回滚测试事件') < 0, 'F-5 新事件已被撤销')
    ok(afterText.indexOf('回滚前的事件') >= 0, 'F-6 旧事件已恢复')
  }

  console.log('')
  console.log('== G. 快照裁剪（防无限增长）==')
  {
    const B2 = path.join(TMP, '_bk2')
    fs.rmSync(B2, { recursive: true, force: true })
    seedStore([EV('evt_1', 'x', 'active')])
    let n = 0
    for (let i = 0; i < 5; i++) {
      const s = await snapshotStorePre({ storePath: STORE, backupDir: B2, now: 1000 + i, maxBackups: 3 })
      if (s.ok && s.file) n++
    }
    ok(n === 5, 'G-1 5 次快照都成功', n)
    const files = fs.readdirSync(B2).filter((x) => x.endsWith('.json'))
    ok(files.length === 3, 'G-2 ★裁剪到 maxBackups=3（实际 ' + files.length + '）', files.length)
  }

  console.log('')
  console.log('== H. 负路径（缺参数 / store 损坏）==')
  {
    const r1 = await applyRegroupPre({})
    ok(r1.ok === false && r1.code === 'no-proposal', 'H-1 缺提案被拒', r1.code)
    const r2 = await applyRegroupPre({ proposal: PROPOSAL(['正常事件名']) })
    ok(r2.ok === false && r2.code === 'no-store-path', 'H-2 缺 storePath 被拒', r2.code)
    // store 损坏 ⇒ 不写盘
    fs.writeFileSync(STORE, 'this is not json', 'utf8')
    const p = PROPOSAL(['正常事件名'])
    const r3 = await applyRegroupPre({ proposal: p, storePath: STORE, backupDir: BK, token: proposalTokenPre(p), apply: true })
    ok(r3.ok === false && r3.code === 'store-read-failed', 'H-3 ★store 损坏 ⇒ 拒绝（不覆盖写）', r3.code)
    ok(fs.readFileSync(STORE, 'utf8') === 'this is not json', 'H-4 ★损坏文件未被覆盖')
  }

  console.log('')
  console.log('== I. 常量 ==')
  {
    ok(MAX_BACKUPS === 20, 'I-1 快照保留 20 份', MAX_BACKUPS)
    ok(BACKUP_DIRNAME.indexOf('.') === 0, 'I-2 快照目录是隐藏目录（不污染账本扫描）', BACKUP_DIRNAME)
  }
} finally {
  try { fs.rmSync(TMP, { recursive: true, force: true }) } catch (e) {}
}

console.log('')
console.log('SUMMARY  PASS ' + pass + ' / FAIL ' + fail)
process.exit(fail === 0 ? 0 : 1)