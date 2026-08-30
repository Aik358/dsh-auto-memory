/**
 * M3b-4 真实记忆迁移工具(docs/M3B-CONTRACT.md §7/§12.4)。
 * 分阶段执行,绝不静默改动真实 Markdown:
 *   --plan    生成 dry-run 计划 + 备份(不改任何 Markdown;ID 已分配并持久化,重跑复用)
 *   --apply   应用计划(逐文件 digest precondition;变化即 stale 跳过)并重建 sidecar
 *   --status  查看计划/备份/应用状态
 *
 * 迁移分类(契约 §3 粒度):
 *   standard  按旧 heading 块切块,每块一个 memoryId(用户级/项目 MEMORY.md、每日日志)
 *   single    整文件单记录(reflections/*.md,契约 §3"一份 reflection 文件:一个记录")
 *
 * 排除:CALENDAR.md(§2.11)、cache/greet/notices、外部源原文件。
 * sidecar 落盘:<DSH_HOME>/memory/index-pre/files/<sha256(canonical)>.json
 * 备份落盘:  <DSH_HOME>/memory/index-pre/backups/<migrationId>/<安全名>
 * 计划落盘:  <DSH_HOME>/memory/index-pre/plans/<planId>.json
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, copyFileSync, statSync, renameSync, unlinkSync } from 'node:fs'
import path from 'node:path'
import { homedir } from 'node:os'
import { createHash, randomUUID } from 'node:crypto'
import { parseAnchors, planMigration, buildSidecar } from '../lib/memory-anchor-pre.js'
import { applyMigrationPlan } from '../lib/memory-writer-pre.js'

function dshHome() {
  const env = process.env.DSH_HOME
  if (env && env.trim()) return env.trim()
  return path.join(homedir(), '.dsh')
}
const sha256Hex = (buf) => createHash('sha256').update(buf).digest('hex')
const canonical = (p) => path.resolve(p).replace(/\\/g, '/').toLowerCase()
const safeName = (p) => canonical(p).replace(/[^a-z0-9./-]/g, '_').replace(/\//g, '__')

// 第一批范围(分批策略:静态历史文件优先;活跃文件在写入窗口外处理)
function collectTargets() {
  const home = dshHome()
  const realRoot = path.join(home, 'memory')
  const targets = []
  const userMem = path.join(realRoot, 'MEMORY.md')
  if (existsSync(userMem)) targets.push({ file: userMem, kind: 'standard', label: '用户级 MEMORY.md' })
  // 全部工作区(第一批含全部工作区的静态 .md;活跃今日日志同样纳入,digest precondition 保护竞态)
  const wsRoot = path.join(realRoot, 'workspaces')
  if (existsSync(wsRoot)) {
    for (const ws of readdirSync(wsRoot)) {
      const wsDir = path.join(wsRoot, ws)
      try { if (!statSync(wsDir).isDirectory()) continue } catch (_) { continue }
      for (const f of readdirSync(wsDir)) {
        if (!f.endsWith('.md')) continue
        targets.push({ file: path.join(wsDir, f), kind: 'standard', label: ws + '/' + f })
      }
      const refl = path.join(wsDir, 'reflections')
      if (existsSync(refl)) {
        for (const f of readdirSync(refl)) {
          if (!f.endsWith('.md')) continue
          targets.push({ file: path.join(refl, f), kind: 'single', label: ws + '/reflections/' + f })
        }
      }
      // archive 内已有归档不重复迁移(M3b-4 范围外;后续批次再议)
    }
  }
  return targets.filter((t) => !canonical(t.file).endsWith('calendar.md'))
}

function indexPre() {
  const dir = path.join(dshHome(), 'memory', 'index-pre')
  return {
    root: dir,
    plans: path.join(dir, 'plans'),
    backups: path.join(dir, 'backups'),
    files: path.join(dir, 'files'),
  }
}

function newMemoryId() {
  return 'mem_' + randomUUID().replace(/-/g, '')
}

async function cmdPlan() {
  const ip = indexPre()
  const migrationId = 'mig_' + new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14) + '_' + randomUUID().slice(0, 6)
  const bakDir = path.join(ip.backups, migrationId)
  mkdirSync(bakDir, { recursive: true })
  mkdirSync(ip.plans, { recursive: true })
  const summary = []
  let plannedFiles = 0
  let skippedClean = 0
  for (const t of collectTargets()) {
    const buf = readFileSync(t.file)
    if (buf.length > 5 * 1024 * 1024) { summary.push({ file: t.label, status: 'skipped-oversized' }); continue }
    const planPath = path.join(ip.plans, safeName(t.file) + '.json')
    if (existsSync(planPath)) { summary.push({ file: t.label, status: 'already-planned' }); continue }
    const fileDigest = sha256Hex(buf)
    // 备份(原样字节)
    copyFileSync(t.file, path.join(bakDir, safeName(t.file)))
    let plan
    if (t.kind === 'single') {
      const memoryId = newMemoryId()
      plan = {
        schemaVersion: 1, namespace: 'dsh-auto-memory-pre', migrationId,
        planKind: 'single-record', planId: 'plan_' + sha256Hex(Buffer.from(t.file + '\u0000' + fileDigest)).slice(0, 32),
        createdAt: Date.now(), sourceFile: t.file, expectedFileDigest: fileDigest,
        memoryId, anchorId: 'memory:' + memoryId,
        operations: [{ kind: 'insert-anchor-single', atByte: 0, memoryId }],
        conflicts: [], aborted: false,
      }
    } else {
      const parsed = parseAnchors(buf)
      if (parsed.status !== 'clean') { summary.push({ file: t.label, status: 'conflict:' + parsed.conflicts.map((c) => c.type).join(',') }); continue }
      plan = planMigration(t.file, buf, {})
      plan.migrationId = migrationId
      plan.namespace = 'dsh-auto-memory-pre'
      plan.planKind = 'standard'
    }
    writeFileSync(planPath, JSON.stringify(plan, null, 2) + '\n', 'utf8')
    plannedFiles++
    summary.push({ file: t.label, status: 'planned', ops: plan.operations.length, ids: plan.operations.length, planId: plan.planId.slice(0, 16) + '…' })
  }
  console.log('=== M3b-4 --plan 完成 ===')
  console.log('migrationId:', migrationId)
  console.log('备份目录:', bakDir)
  console.log('计划目录:', ip.plans)
  for (const s of summary) console.log(' ', JSON.stringify(s))
  console.log('planned=' + plannedFiles + ' skippedClean=' + skippedClean)
  console.log('未写任何 Markdown。下一步:审阅后运行 --apply。')
}

async function cmdApply() {
  const ip = indexPre()
  if (!existsSync(ip.plans)) { console.log('无计划目录,先 --plan'); return }
  const results = []
  for (const pf of readdirSync(ip.plans)) {
    if (!pf.endsWith('.json')) continue
    const plan = JSON.parse(readFileSync(path.join(ip.plans, pf), 'utf8'))
    if (plan.appliedAt) { results.push({ file: path.basename(plan.sourceFile), status: 'already-applied' }); continue }
    if (!existsSync(plan.sourceFile)) { results.push({ file: pf, status: 'source-missing' }); continue }
    const before = readFileSync(plan.sourceFile)
    // 幂等跳过:已 anchored 且 digest 与 plan 一致?仍按 digest 校验走正常应用(已应用文件会因 no-op 或 not-legacy-start 拒绝)
    let out
    if (plan.planKind === 'single-record') {
      const text = before.toString('utf8')
      // 单记录:marker + 原文全文
      const candidate = Buffer.concat([Buffer.from('<!-- ' + plan.anchorId + ' -->\n', 'utf8'), Buffer.from(text, 'utf8')])
      const check = parseAnchors(candidate)
      if (check.status !== 'clean' || check.records.filter((r) => r.kind === 'anchored').length !== 1) {
        results.push({ file: path.basename(plan.sourceFile), status: 'single-invalid' }); continue
      }
      out = candidate
    } else {
      const ap = applyMigrationPlan(before, plan)
      if (!ap.ok) { results.push({ file: path.basename(plan.sourceFile), status: 'rejected:' + ap.reason }); continue }
      out = ap.text
    }
    // digest precondition 在 applyMigrationPlan 内已做;single 路径手工校验:
    if (plan.planKind === 'single-record' && plan.expectedFileDigest !== sha256Hex(before)) {
      results.push({ file: path.basename(plan.sourceFile), status: 'stale-plan' }); continue
    }
    // 原子替换
    const tmp = plan.sourceFile + '.migtmp-' + randomUUID().slice(0, 8)
    writeFileSync(tmp, out)
    try { renameSync(tmp, plan.sourceFile) } catch (e) { try { unlinkSync(tmp) } catch (_) {} ; results.push({ file: path.basename(plan.sourceFile), status: 'rename-failed:' + e.message }); continue }
    // 重读校验
    const reread = readFileSync(plan.sourceFile)
    if (sha256Hex(reread) !== sha256Hex(out)) { results.push({ file: path.basename(plan.sourceFile), status: 'verify-mismatch' }); continue }
    // sidecar 重建
    const sb = buildSidecar({ sourceFile: plan.sourceFile, content: reread })
    if (sb.ok) {
      const sideDir = path.join(ip.files)
      mkdirSync(sideDir, { recursive: true })
      const canonHash = sha256Hex(Buffer.from(canonical(plan.sourceFile), 'utf8'))
      writeFileSync(path.join(sideDir, canonHash + '.json'), JSON.stringify(sb.sidecar, null, 2) + '\n', 'utf8')
    }
    plan.appliedAt = Date.now()
    writeFileSync(path.join(ip.plans, pf), JSON.stringify(plan, null, 2) + '\n', 'utf8')
    results.push({ file: path.basename(plan.sourceFile), status: 'applied', records: (parseAnchors(reread).records.filter((r) => r.kind === 'anchored')).length, sidecar: sb.ok })
  }
  console.log('=== M3b-4 --apply 完成 ===')
  for (const r of results) console.log(' ', JSON.stringify(r))
}

function cmdStatus() {
  const ip = indexPre()
  console.log('index-pre:', ip.root, existsSync(ip.root) ? '(存在)' : '(不存在)')
  if (!existsSync(ip.plans)) { console.log('无计划'); return }
  for (const pf of readdirSync(ip.plans)) {
    if (!pf.endsWith('.json')) continue
    const p = JSON.parse(readFileSync(path.join(ip.plans, pf), 'utf8'))
    console.log(path.basename(pf), '|', p.planKind || 'standard', '|', p.appliedAt ? 'APPLIED@' + new Date(p.appliedAt).toISOString() : 'pending', '|', p.sourceFile)
  }
  const bakRoot = ip.backups
  if (existsSync(bakRoot)) for (const m of readdirSync(bakRoot)) console.log('backup:', m, '(' + readdirSync(path.join(bakRoot, m)).length + ' files)')
}

const mode = process.argv[2]
if (mode === '--plan') await cmdPlan()
else if (mode === '--apply') await cmdApply()
else if (mode === '--status') cmdStatus()
else { console.log('用法: node tools/migrate-m3b4.mjs --plan | --apply | --status'); process.exit(1) }
