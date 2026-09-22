/**
 * #110 守卫 —— hub 三层记忆持久化 IO 失败必须**可见**（2026-09-22）。
 *
 * ── 被守卫的缺陷 ──
 * hub 的 io 适配器（旧实现在 index.js 内联）三个方法各自 `catch (_) {}` 吞掉异常：
 *   · save 失败 → 上层三店 A-8 写好的 `try { io.save() } catch` **永远走不到 catch**
 *     ⇒ store 返回 `{ok:true, persisted:true}`，persistFailures 恒 0；
 *   · 用户侧表现为「记忆看着存上了、重启清零」，日志/计数/面板三处都拿不到信号。
 *
 * ── 本套件怎么守 ──
 * ① 行为断言为主：真实临时目录跑 save/load/clear 往返；用 `fsApi` 注入故障
 *    （renameSync/writeFileSync/mkdirSync/readFileSync/rmSync 抛 errno）验证
 *    「失败必须抛出 + 必须记账 + 原因必须是中文人话」；
 * ② 接线断言为辅：index.js 必须 import 并委托 hub-io.js、debugInfo 必须暴露 hubIo 投影、
 *    release.mjs 必须登记该模块（否则发版时残留闸门会拒绝构建）。
 *
 * 纪律：任何一条修复被回退都必须立刻变红；不做无意义的存在性断言（每条都对应一个可复现后果）。
 */
import { readFileSync, mkdtempSync, rmSync, existsSync, readdirSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createHubIoPre,
  createHubIoHealthPre,
  explainHubIoErrorPre,
  hubIoHealthSnapshotPre,
  HUB_IO_ERRNO_MESSAGES_V1,
} from '../../lib/hub-io.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8')

const INDEX = read('lib/index.js')
const HUB_IO = read('lib/hub-io.js')
// ★`tools/release.mjs` 是发布线工具、**未入库**：旧写法在模块顶层直接 read 它 ⇒ 干净克隆里
//   整套 52 条断言一起 ENOENT 崩（连与它无关的 hub-io 行为检查也跟着失效）。
//   改为可空 + 只在该节检查时判定，缺文件就明确跳过那一节，其余照常跑。
const RELEASE = existsSync(path.join(ROOT, 'tools', 'release.mjs')) ? read('tools/release.mjs') : null

let pass = 0, fail = 0
const ok = (cond, msg) => { if (cond) { pass++; console.log('  ✓ ' + msg) } else { fail++; console.log('  ✗ FAIL: ' + msg) } }
const throws = (fn) => { try { fn(); return null } catch (e) { return e } }

const tmp = mkdtempSync(path.join(os.tmpdir(), 'hubio110-'))
const dir = path.join(tmp, 'hub')
/** 造一个 errno 异常（Node 的 fs 错误是带 code 的 Error）。 */
const errno = (code) => Object.assign(new Error('injected ' + code), { code })

try {
  // ─────────────────────────────────────────────────────────────
  console.log('== ① 正常路径：真实文件系统 存取/清空往返 ==')
  {
    const health = createHubIoHealthPre()
    const io = createHubIoPre({ dir, health })
    const facts = io('facts.json')

    ok(facts.load() === null, '无快照时 load() 返回 null（保持「空启动」语义）')
    ok(health.errors === 0, 'ENOENT（首次启动无快照）不计入失败')

    facts.save({ facts: [{ factId: 'f1' }], stats: { writes: 1 } })
    const back = facts.load()
    ok(back && back.facts && back.facts.length === 1 && back.facts[0].factId === 'f1', 'save → load 往返数据一致')
    ok(existsSync(path.join(dir, 'facts.json')), '快照文件确实落在磁盘上')
    ok(!readdirSync(dir).some((n) => n.endsWith('.tmp')), '原子写（tmp + rename）后不残留 .tmp')

    facts.clear()
    ok(facts.load() === null, 'clear() 后 load() 为 null')
    ok(health.errors === 0, '正常 save/load/clear 全程零失败计数')
    ok(health.saves === 1 && health.loads === 3 && health.clears === 1, '计数与调用次数一致（saves/loads/clears）')
  }

  // ─────────────────────────────────────────────────────────────
  console.log('== ② 故障注入：save 失败必须抛出 + 记账 + 人话原因 ==')
  {
    const health = createHubIoHealthPre()
    const seen = []
    const io = createHubIoPre({
      dir,
      health,
      onError: (key, msg) => seen.push({ key, msg }),
      fsApi: {
        mkdirSync: () => {},
        writeFileSync: (p, d, e) => writeFileSync(p, d, e),
        renameSync: () => { throw errno('EACCES') },
        readFileSync, rmSync,
      },
    })
    const facts = io('facts.json')
    const err = throws(() => facts.save({ a: 1 }))

    ok(err && err.code === 'EACCES', '★save 失败**照原样抛出**（不再静默吞掉 —— 这是 A-8 上层 try/catch 生效的前提）')
    ok(health.errors === 1, '失败计入 health.errors')
    ok(/权限被拒绝/.test(String(health.lastError)), 'lastError 是中文人话（含 EACCES 语义）')
    ok(/facts\.json save/.test(String(health.lastError)), 'lastError 指明是哪个文件 + 哪个操作')
    ok(health.byFile['facts.json:save'] && health.byFile['facts.json:save'].count === 1, 'byFile 按「文件名:操作」分类计数')
    ok(seen.length === 1 && /权限被拒绝/.test(seen[0].msg) && seen[0].key === 'facts.json:save', 'onError 回调收到 key + 人话消息（宿主据此写诊断日志）')
  }

  console.log('== ②b 其余 errno 分支：mkdir / write / load / parse / clear ==')
  {
    const mk = () => {
      const health = createHubIoHealthPre()
      const api = { mkdirSync: () => { throw errno('ENOSPC') }, writeFileSync, renameSync: () => {}, readFileSync, rmSync }
      return { health, io: createHubIoPre({ dir, health, fsApi: api }) }
    }
    const a = mk()
    const e1 = throws(() => a.io('episodes.json').save({}))
    ok(e1 && /磁盘空间不足/.test(String(a.health.lastError)), 'mkdir 失败（ENOSPC）→ 抛出 + 「磁盘空间不足」')

    const b = mk()
    b.io = createHubIoPre({ dir, health: b.health, fsApi: { mkdirSync: () => {}, writeFileSync: () => { throw errno('EROFS') }, renameSync: () => {}, readFileSync, rmSync } })
    const e2 = throws(() => b.io('x.json').save({}))
    ok(e2 && /只读位置/.test(String(b.health.lastError)), 'writeFileSync 失败（EROFS）→ 抛出 + 「只读位置」')

    // load：非 ENOENT 的读取失败必须可见，但仍返回 null（控制流不变）
    const h3 = createHubIoHealthPre()
    const io3 = createHubIoPre({ dir, health: h3, fsApi: { mkdirSync: () => {}, writeFileSync, renameSync: () => {}, readFileSync: () => { throw errno('EACCES') }, rmSync } })
    ok(io3('facts.json').load() === null, 'load 读取失败仍返回 null（不改变既有控制流）')
    ok(h3.errors === 1 && /权限被拒绝/.test(String(h3.lastError)), '但 load 失败同样记账可见')

    // parse：快照损坏不得无声
    const h4 = createHubIoHealthPre()
    const io4 = createHubIoPre({ dir, health: h4 })
    io4('broken.json').save(null)
    writeFileSync(path.join(dir, 'broken.json'), '{ this is not json', 'utf8')
    ok(io4('broken.json').load() === null, 'JSON 损坏时 load 返回 null（仍按空启动，幂等恢复）')
    ok(h4.byFile['broken.json:parse'] && h4.byFile['broken.json:parse'].count === 1, '★快照损坏被单独记账（parse 通道），不再无声')
    ok(/parse/.test(String(h4.lastError)), 'lastError 区分 parse 与 load 两种通道')

    // clear 失败：残留快照会在下次 load「复活」，必须抛出
    const h5 = createHubIoHealthPre()
    const io5 = createHubIoPre({ dir, health: h5, fsApi: { mkdirSync: () => {}, writeFileSync, renameSync: () => {}, readFileSync, rmSync: () => { throw errno('EBUSY') } } })
    const e5 = throws(() => io5('facts.json').clear())
    ok(e5 && /文件被其它进程占用/.test(String(h5.lastError)), 'clear 失败 → 抛出 + 「文件被其它进程占用」')
  }

  // ─────────────────────────────────────────────────────────────
  console.log('== ③ errno → 人话（用户口径：暴露给前端的原因必须人能看懂） ==')
  {
    ok(/权限被拒绝/.test(explainHubIoErrorPre(errno('EACCES'))), 'EACCES → 权限被拒绝')
    ok(/磁盘空间不足/.test(explainHubIoErrorPre(errno('ENOSPC'))), 'ENOSPC → 磁盘空间不足')
    ok(/只读位置/.test(explainHubIoErrorPre(errno('EROFS'))), 'EROFS → 只读位置')
    // 注：异常对象缺失时回落「未知错误」是**预期行为**（不理想但不许返回 undefined / 空串）
    ok(explainHubIoErrorPre(null) === '未知错误', '无异常对象时回落「未知错误」文案（非 undefined / 非空串）')
    ok(explainHubIoErrorPre(undefined).length > 0 && explainHubIoErrorPre('').length > 0, 'null/undefined/空串入参都给出非空文案')
    ok(explainHubIoErrorPre(new Error('boom')).includes('boom'), '无 code 时回落到原始 message')
    ok(explainHubIoErrorPre(errno('EZZZ')).includes('EZZZ'), '未登记的 errno 也带上机器码（便于排障）')
    ok(/EACCES/.test(explainHubIoErrorPre(errno('EACCES'))), '人话后面仍附机器码')
    ok(Object.isFrozen(HUB_IO_ERRNO_MESSAGES_V1), 'errno 词典是冻结常量（防运行时被改写）')
    ok(Object.keys(HUB_IO_ERRNO_MESSAGES_V1).length >= 8, 'errno 词典覆盖常见失败码')
  }

  // ─────────────────────────────────────────────────────────────
  console.log('== ④ 健康度投影：判读结论 + 隐私（无路径/无原文） ==')
  {
    const clean = hubIoHealthSnapshotPre(createHubIoHealthPre())
    ok(clean.verdict === 'ok' && clean.errors === 0, '无失败时 verdict=ok')
    ok(/正常落盘/.test(clean.summary), '无失败时给一句话结论')

    const h = createHubIoHealthPre()
    const io = createHubIoPre({ dir, health: h, fsApi: { mkdirSync: () => {}, writeFileSync: () => { throw errno('ENOSPC') }, renameSync: () => {}, readFileSync, rmSync } })
    throws(() => io('procedures.json').save({ secret: 'x' }))
    const snap = hubIoHealthSnapshotPre(h)
    ok(snap.verdict === 'io-error' && snap.errors === 1, '有失败时 verdict=io-error')
    ok(/重启会丢/.test(snap.summary), '结论明确点出后果（记忆只在内存里、重启会丢）')
    ok(/磁盘空间不足/.test(snap.summary), '结论里带人话原因')

    const blob = JSON.stringify(snap)
    ok(!blob.includes(tmp.replace(/\\/g, '\\\\')) && !blob.includes(tmp), '★投影不泄露任何本地路径（与既有「最小投影」纪律一致）')
    ok(!blob.includes('secret'), '投影不含任何写入原文')

    ok(hubIoHealthSnapshotPre(null).verdict === 'ok', '入参为 null 时不抛（诊断面 fail-soft）')
    ok(hubIoHealthSnapshotPre({ bogus: true }).errors === 0, '畸形 health 对象不抛且回落空计数')
  }

  // ─────────────────────────────────────────────────────────────
  console.log('== ⑤ 宿主接线：index.js 必须委托该模块，旧内联静默实现必须消失 ==')
  {
    ok(/import \{[^}]*createHubIoPre[^}]*\} from '\.\/hub-io\.js'/.test(INDEX), 'index.js 从 ./hub-io.js 导入适配器')
    ok(!INDEX.includes('const hubIo = (name) => {'), '★旧内联 hubIo 工厂已移除（回归即红）')
    ok(INDEX.includes('createHubIoPre({'), 'index.js 用 createHubIoPre 装配 io')
    ok(/engine\._hubIoHealth = hubIoHealth/.test(INDEX), 'health 台账挂在 engine 上（debugInfo 可读）')
    ok(/hubIo: this\._hubIoViewSnapshot\(\)/.test(INDEX), 'debugInfo().associativeMemory 暴露 hubIo 投影')
    ok(/_hubIoViewSnapshot\(\)\s*\{\s*return hubIoHealthSnapshotPre\(this\._hubIoHealth\)/.test(INDEX), '_hubIoViewSnapshot 委托给模块投影（单一出口）')
    ok(/diagThrottled\('hubIo:'/.test(INDEX), '失败同时写诊断日志并按 key 节流（不刷屏）')

    ok(/save\(data\)[\s\S]{0,700}throw e/.test(HUB_IO), '★模块内 save 失败路径确实重新抛出（防被改成静默）')
    ok(!/save\(data\)[\s\S]{0,300}catch \(_\) \{\}/.test(HUB_IO), '模块内 save 不存在 `catch (_) {}` 静默分支')
    ok(/clear\(\)[\s\S]{0,300}throw e/.test(HUB_IO), 'clear 失败同样抛出')

    if (RELEASE === null) console.log('  – SKIP: release.mjs 登记检查（tools/release.mjs 未入库；该节需发布线工具）')
    else ok(RELEASE.includes("'hub-io.js'"), '★release.mjs 已登记 hub-io.js（未登记会在发版残留闸门 fail closed）')
  }
} finally {
  try { rmSync(tmp, { recursive: true, force: true }) } catch (_) {}
}

console.log('\n== #110 结果 == PASS ' + pass + ' / FAIL ' + fail)
if (fail > 0) process.exitCode = 1
