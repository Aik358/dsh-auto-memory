#!/usr/bin/env node
/**
 * tools/run-smoke.mjs — 冒烟回归串行运行器(零第三方依赖,仅 node 内置)。
 *
 * 用法:
 *   node tools/run-smoke.mjs                      # 逐个跑 tests/smoke/*.mjs,每套件超时 60s
 *   node tools/run-smoke.mjs --timeout=30000      # 自定义每套件超时(毫秒)
 *   node tools/run-smoke.mjs --timeout=0          # 关闭超时(不建议:见下)
 *   node tools/run-smoke.mjs --filter=handoff     # 只跑文件名含该子串的套件
 *
 * 设计原因
 * --------
 * 全量回归曾因**单个套件忙等**而永不返回,使"全量零失败"这一发版前置门不可靠:
 * 2026-09-14 实测 tests/smoke/smoke-test-consolidate-isolation.mjs 空转约 29 分钟
 * (累计 CPU 约 18 分钟),宿主侧只能整批中断,无法区分"哪个套件坏了"。
 *
 * 两条实测到的失效路径,决定了本运行器的形态:
 *   1) **进程不退出**:该套件在断言失败后不再执行收尾(清定时器),而被测插件注册的
 *      5 分钟/15 秒/1 小时 setInterval 仍在,加上被测插件自己装了
 *      process.on('uncaughtException') 监听器(会抑制 Node 的默认致命退出),
 *      于是 node 进程**既不退出也不报错**,挂钟可以无限长。
 *   2) **忙等烧 CPU**:当读到本进程 stdout 的那一端消失(父工具调用被 abort / 运行器被
 *      强杀)后,向已断的管道写日志会抛 EPIPE;被测插件的 uncaughtException 处理器
 *      本身又用 console.error 写日志 → 再次抛 EPIPE → 再次进入同一处理器 → 自激循环,
 *      100% CPU 永不收敛。
 *
 * 因此本运行器:**先杀子进程、再收管道**(顺序反了会人为制造上面第 2 条),并且
 * 每个套件独立计时、超时只影响一个套件,**绝不整体挂住**。这是引擎侧根因修好之前的护栏。
 *
 * 退出码:有任何 FAIL 或 TIMEOUT → 非 0;全绿 → 0。
 */

import { readdirSync, statSync, mkdirSync, rmSync, existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { analyzeImpact } from './smoke-impact.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const SMOKE_DIR = path.join(ROOT, 'tests', 'smoke')

const DEFAULT_TIMEOUT_MS = 60000
/** ★T7-f（2026-09-20 用户裁定「默认并行」）：默认并发度。`--jobs=1` 可回退串行。 */
const DEFAULT_JOBS = 4
/**
 * ★2026-10-08（用户实报 C 盘被临时副本吃满 51GB，根因见下）：
 *   112 个套件用 os.tmpdir() + mkdtempSync 做**整树副本**，且 89 个套件只排除 .git/node_modules
 *   —— python/(10.3GB) 与 artifacts/(2.2GB) 也会被复制；断言失败或被强杀时 rmSync 不执行，
 *   于是副本永久残留在系统盘（实测 TEMP 下 dam-* 累积 24,238 个）。
 *
 *   修法（本运行器一处收口，不动 112 个套件）：
 *   ① 给**每个子进程**把 TEMP/TMP 指向本仓同盘的专属运行目录 ⇒ 副本不再写系统盘；
 *   ② 启动时先清扫**上次运行**遗留（同名前缀），退出时（含异常/信号）整目录删除；
 *   ③ 每次运行只用一个根 ⇒ 残留上界 = 1 个运行目录，不再无界增长。
 *   为兼容不读 TEMP 的写法，同时在子进程 env 里给出 DSH_SMOKE_TMP（套件可选用）。
 */
// ★必须放在**仓库树之外**：放在仓库内会让 Node 的模块解析向上走到仓库 node_modules，
//   从而破坏「隔离树里解析不到 peer」这类套件的前提（实测 peer-probe 因此假红）。
//   放在同盘（D:）的仓库同级目录：既同盘提速，又与仓库模块解析链无关。
const RUN_TMP_ROOT = path.join(path.dirname(ROOT), '.dsh-smoke-tmp')
const RUN_TMP = path.join(RUN_TMP_ROOT, 'run-' + process.pid + '-' + Date.now().toString(36))


/**
 * ★2026-10-13（用户实报「全量并行会有 2~3 项 timeout，怀疑是并行策略有问题」）：
 *   实测根因——**并非套件真的挂住，而是「单套件墙钟超时」与「并行抢占」叠加**：
 *     · 98.3s  smoke-test-external.mjs —— 真扫本机外部记忆（13 源 / 数百文件），
 *       单跑就已 67.8s，而默认阈值只有 60s ⇒ **它单跑也必然 TIMEOUT**，与并行无关；
 *     · 其余重负载套件（整树复制 / 真跑 python / 真跑生成器）在 4 路并发下墙钟被
 *       拉长 1.2~2.6 倍（jobs=8 实测最坏 4.18 倍）⇒ 逼近阈值即偶发翻红。
 *   修法：**按实测耗时把套件分成两条车道**——重车道**串行**（互相不抢，墙钟回到单跑量级），
 *   轻车道照旧并行。两条车道同时开跑，总墙钟取「重车道之和」与「轻车道之和 / jobs」的较大者，
 *   不再受「重负载被并发拉长」影响。
 *
 * 表内数值 = 本机实测（--jobs=4 一次全量，2026-10-08 树）里 **>5s** 的 49 个套件。
 * 不在此表的套件（305 个，合计仅 277s、单个 <=5s）走轻车道并行。
 *
 * ★为什么重车道是**保守串行**而不是「给重负载也开小池子」：实测重负载之间的争抢是
 *   非线性的（smoke-test-migrate-existing-safety 在 jobs=8 下 3.9s->16.3s，x4.18），
 *   而重车道本来就占全部工作量的 76%——开池子省下的墙钟会被重新拉长吃掉。
 *
 * 开关：--lanes=off 关闭分道（回到「全部走并行池」的旧行为，便于对照与回退）；
 *       --heavy-jobs=N 重车道并发（默认 1 = 串行，实测最稳）。
 */
/**
 * ★重车道并发（2026-10-13 实测标定，非拍脑袋）：
 *   重负载套件**不是 CPU 密集**——12 个最重套件串行跑 389s 只用掉 16.5 CPU 秒（≈4% CPU），
 *   它们是等 IO / 等子进程 / 等轮询。故并发近线性收益（同 12 套件实测）：
 *     x1 = 389.1s   x2 = 216.7s   x4 = 151.9s   x8 = 108.6s
 *   全量对照（重 x8 + 轻 x4，16 核机）：179.9s / 353 PASS / 0 FAIL / 0 TIMEOUT，
 *   而同机旧默认（jobs=4 + 60s）为 276.4s 且 1 TIMEOUT + 1 并发假红 ⇒ 1.54x 加速。
 *   ★为什么重车道取 8 而轻车道保持 4：重车道是**关键路径**（896s 工作量），
 *   轻车道只有 277s、且 305 个套件个个 <=5s ⇒ 放宽重车道、收窄轻车道，
 *   两者合计 12 路并发，留在 16 核之内（实测 h8+l8 = 16 路时会把
 *   smoke-test-py-runtime-live / smoke-test-m73 挤成假红，故不取满）。
 */
const HEAVY_JOBS = 8

/**
 * ★重车道专用阈值（轻车道仍用 --timeout，默认 60s）：
 *   实测最长套件 smoke-test-external.mjs 单跑 67.8s（本机外部记忆真扫描），
 *   已超默认 60s ⇒ 它**单跑也必红**，与并行无关。给重车道 240s 是"真长"而非"被拖长"的余量：
 *   4 路并发下实测最坏 123s（smoke-test-la-audit-fixes.mjs），仍有 2× headroom。
 *   而轻车道保留 60s；轻套件实测最慢 5s，60s 够用 ⇒ 真挂住仍能 1 分钟内被发现。
 */
const HEAVY_TIMEOUT_MS = 240000
const HEAVY_MS = {
  // ★v3.3.14 登记值（**本批保留未改**）：本套件原先靠**真实等待**证明超时行为
  //   （B/C/D 组各 10–20 秒）+ 两轮变异子进程，实测单跑 161.1 秒 ⇒ 归入重车道（timeout=240000）。
  // ★2026-11-07（alpha.7 P4 · task-21）：改用可控时钟 + 修 M2 的模式参数后**实测 3.8–4.4 秒**
  //   （161,333ms → 4,394 / 3,844 / 4,265ms）。登记值 161100 暂**不动** —— 它只决定排序权重与
  //   车道归属，改成多少要等 Lead 实测一次全量后统一决定。
  //   ★口径订正：轻车道默认阈值是 **60000ms**（DEFAULT_TIMEOUT_MS），不是旧注释里的「180 秒」；
  //     180 秒是 2026-09 的过期读数（当时 DEFAULT_TIMEOUT_MS=180000，后调到 60000）。
  'smoke-test-v3314-continuation-timeout.mjs': 161100,
  'smoke-test-external.mjs': 98300,
  'smoke-test-py-runtime-live.mjs': 57300,
  'smoke-test-la-audit-fixes.mjs': 56100,
  // ★2026-11-09（1B 收口轮实测）：本套件**自耗 242s**（单跑 50 PASS / 0 FAIL、exit=0），
  //   远超轻车道默认 60s ⇒ 在回归里恒判 TIMEOUT（不是挂死，是被阈值判死）。
  //   处置：按本表既有口径「实测 >5s 的套件进重车道」入表（重车道阈值 240s，余量已足；
  //   实测 242s 仍逼近上限 ⇒ 若后续再涨，应改为拆分套件而不是继续抬阈值）。
  //   为什么不改全局 --timeout：那会把所有轻套件的挂死发现时间从 1 分钟拖到 4 分钟（本表 105 行已立此判据）。
  //   ★阈值口径：实测单跑 242.4s（并发下更慢）⇒ 登记 420000（约 1.7× 余量），由 pickTimeout 取
  //     max(240000, 420000) = 420000。若后续再涨，应**拆分套件**而不是继续抬（本表 105 行已立此判据）。
  'smoke-test-la5-302-request-preservation.mjs': 420000,
  'smoke-test-issue45-recall-corpus.mjs': 40200,
  'smoke-test-c4-fresh-install.mjs': 38900,
  'smoke-test-a6-ci-group-queue.mjs': 38200,
  'smoke-test-autocont-host.mjs': 37400,
  'smoke-test-issue341-lockgate.mjs': 36000,
  'smoke-test-fullpage-negative.mjs': 35100,
  'smoke-test-a2-hub-transactions.mjs': 33600,
  'smoke-test-a1-mutation-admission.mjs': 28100,
  'smoke-test-issue347-evidence-retention.mjs': 24400,
  'smoke-test-issue342-outbox-lock.mjs': 23100,
  'smoke-test-issue348-group-digest-cursor.mjs': 17600,
  'smoke-test-g1-gate-unify.mjs': 16900,
  'smoke-test-issue207-state.mjs': 15100,
  'smoke-test-issue207-routes.mjs': 14600,
  'smoke-test-lb1-negative.mjs': 13700,
  'smoke-test-py-integrity-c1.mjs': 13100,
  'smoke-test-h1-v1-lane-retired.mjs': 12900,
  'smoke-test-m78-host.mjs': 12800,
  'smoke-test-run-smoke.mjs': 12700,
  'smoke-test-generator-idempotent.mjs': 12100,
  'smoke-test-generator-guard.mjs': 11300,
  'smoke-test-m70.mjs': 10000,
  'smoke-test-minervaowl7-c-negative.mjs': 9500,
  'smoke-test-m73.mjs': 9300,
  'smoke-test-m76.mjs': 9300,
  'smoke-test-m79-feature-v2.mjs': 9200,
  'smoke-test-issue323-release-preflight.mjs': 9000,
  'smoke-test-minervaowl7-a2-negative.mjs': 9000,
  'smoke-test-consolidate-isolation.mjs': 8800,
  'smoke-test-m710-fv2-emit.mjs': 8800,
  'smoke-test-py-runtime-chain.mjs': 8800,
  'smoke-test-issue174-team-wiring.mjs': 8700,
  'smoke-test-m53.mjs': 8400,
  'smoke-test-js-semantic-host-recovery.mjs': 7900,
  'smoke-test-v21-path-boundary.mjs': 7800,
  'smoke-test-embed-incremental.mjs': 7600,
  'smoke-test-issue345-mutation-root.mjs': 7600,
  'smoke-test-issue162-diagnostic-integrity.mjs': 7400,
  'smoke-test-issue207-processes.mjs': 7300,
  'smoke-test-config-transactions.mjs': 6400,
  'smoke-test-issue48.mjs': 6400,
  'smoke-test-issue164-plan-processes.mjs': 6100,
  // ★2026-10-26 归因（实测，非猜测）：本套件 spawn **4 个变异子进程**（每个跑完整套件做「变异必红」验证）,
  //   单跑实测 3.0s；**单独开 8 个并发**实测总 5.5s、全部 exit=0 ⇒ **不是自身并发缺陷**。
  //   但在全量重车道（50 套件 x8，含 v3314-continuation-timeout 单跑 161s）里被拖到 **33.9s** 并失败。
  //   ⇒ 分类：**资源竞争型**（既有判据：单跑 PASS + 并发模拟 PASS + 失败可定位到调度饥饿 ⇒ 接受）。
  //   为什么不提高它的登记值：登记值只决定排序权重，不改变 x8 并发；抬它反而会挤掉别的重套件。
  'smoke-test-c307-308-team-outbox.mjs': 6000,
  'smoke-test-issue322-team-outbox-flush.mjs': 5800,
  'smoke-test-context-observer.mjs': 5600,
  'smoke-test-settings-safety.mjs': 5500,
  // ★★2026-10-26：**非耗时型**但**高扰动型**入重车道。
  //   实测：v4-c4 单跑 3 次全 exit=0（~3.9s，远低于 5s 阈值），但并行全量里出现
  //   `exit=3221226505 = 0xC0000409 STATUS_STACK_BUFFER_OVERRUN`（Windows 进程崩溃，非断言失败）。
  //   原因：该套件**改写全局 process.env.HOME / DSH_HOME** 并真造 MemoryEngine，
  //   与同池套件共享进程级 env 语义 ⇒ 轻车道 x4 高并发下被挤崩。
  //   ⇒ 判据修正：**「改全局 env + 起真引擎」类套件即使不慢，也必须进重车道**（重车道 x8 但彼此隔离度更高）。
  //   命名口径沿表内既有习惯（毫秒值仅作排序参考，此处取实测 3900）。
  'smoke-test-v4-c4-tool-description.mjs': 3900,
}

/**
 * 车道划分：重车道 = 实测 >5s 的套件（表内），其余走轻车道。
 */
function splitLanes(suites) {
  const heavy = [], light = []
  for (const n of suites) (HEAVY_MS[n] !== undefined ? heavy : light).push(n)
  // 重车道按实测耗时**从长到短**排：长尾先开跑，避免最后一个 98s 套件最后才开始。
  heavy.sort((a, b) => (HEAVY_MS[b] || 0) - (HEAVY_MS[a] || 0))
  return { heavy, light }
}

/** 清扫本运行器自己产生的历史运行目录（只认自己的前缀，绝不碰别的进程的临时文件）。 */
function sweepStaleRuns() {
  try {
    if (!existsSync(RUN_TMP_ROOT)) return 0
    const now = Date.now()
    let n = 0
    for (const e of readdirSync(RUN_TMP_ROOT, { withFileTypes: true })) {
      if (!e.isDirectory() || !e.name.startsWith('run-')) continue
      const p = path.join(RUN_TMP_ROOT, e.name)
      // 保留 10 分钟内的（可能是并发/其它会话仍在跑），其余清掉
      try {
        if (now - statSync(p).mtimeMs < 600000) continue
        rmSync(p, { recursive: true, force: true })
        n += 1
      } catch (e2) {}
    }
    return n
  } catch (e) { return 0 }
}

function cleanupRunTmp() {
  try { rmSync(RUN_TMP, { recursive: true, force: true }) } catch (e) {}
}

/** 每个套件保留的**展示**尾部字符数(用于定位卡点;判据扫描已改为全量,不再用它)。 */
const TAIL_CHARS = 2000
/**
 * ★#536（2026-11-07 alpha.7 P4）：**判据扫描**的 stderr 缓冲上界。
 *
 * 【旧缺陷】子进程 stderr 先截到**末 2000 字符**再扫描 ⇒ 前段出现的未捕获异常标记扫不到。
 *   只要套件在异常之后还输出 >2000 字符，假绿防线就瞎了（尾截断盲区）。
 * 【现判据】扫描用**全量 stderr**；只有**展示/落盘**才用 TAIL_CHARS 截断。
 *   上界存在的唯一目的是防止失控输出（GB 级 stderr）撑爆运行器内存：8MB 是旧窗口的 4,194 倍，
 *   本仓最吵套件的 stderr 实测 <100KB。超界时**打印告警**并记丢弃字节数，不静默。
 */
const SCAN_CAP_CHARS = 8 * 1024 * 1024
/** 收到退出信号后,最多再等多久收尸(毫秒),防止运行器自己挂住。 */
const REAP_GRACE_MS = 5000

function parseArgs(argv) {
  // ★T7-f（2026-09-20 用户裁定「默认并行，提高效率」）：`jobs` 默认 4。
  //   ★ 危害评估（用户问「危害会很大吗」——**实测后**回答，非推断）：
  //   ① 4 并发全量 136 套件**实测全绿**（42.3s vs 串行 143.6s，3.4×），无共享状态冲突；
  //   ② 本运行器原本串行的理由是**管道 EPIPE 自激循环**（见文件头第 2 条）——那是
  //      「父端消失后子进程往断管道写日志」的场景，与「同时开几个子进程」无关；
  //      并发只是把独立管道从 1 条提到 4 条，风险量级不变（仍每子进程独立 pipe+destroy）。
  //   ③ ★ **真正的残余风险**：`--timeout` 是**墙钟**计时，4 路并发下重负载套件的墙钟会
  //      被 CPU 抢占拉长 ⇒ 可能触发**偶发 TIMEOUT（而非 FAIL）**。本仓全量用 90s 阈值，
  //      实测无超时；若日后见到「单套件 TIMEOUT 但单独跑就过」，优先怀疑这一条，
  //      用 `--jobs=2` 或 `--jobs=1` 复验即可确认。
  //   ④ 可回退：`--jobs=1` 恢复逐字节等价的串行路径（原代码路径保留，未删改）。
  // ★2026-10-02（用户裁定「跑之前先看一下哪儿会有变化」）：`--impact` 只做只读影响面预检，
  //   不跑任何套件（秒级返回）。`--impact-run` 先打印预检、再只跑命中集（省掉盲跑全量的 75s）。
  // ★task-20（alpha.7 P4）：retry = **疑似并发抢占假红**的一次性串行重试次数（只允许 0/1）。
  //   默认 1；`--retry=0` 整批关闭（用于「要一次干净读数」或验证重试是否在洗绿）。
  const opts = { timeoutMs: DEFAULT_TIMEOUT_MS, filter: '', exclude: [], jobs: DEFAULT_JOBS, impact: false, impactRun: false, quiet: false, lanes: true, heavyJobs: HEAVY_JOBS, heavyTimeoutMs: HEAVY_TIMEOUT_MS, retry: 1 }
  for (const a of argv) {
    if (a === '--impact') { opts.impact = true; continue }
    if (a === '--impact-run') { opts.impactRun = true; continue }
    if (a === '--quiet') { opts.quiet = true; continue }
    if (a === '--impact-all') { opts.impactAll = true; continue }
    // ★2026-10-13：--lanes=off 关闭重/轻分道（旧行为）；--heavy-jobs=N 重车道并发（默认 1=串行）。
    if (a === '--lanes=off') { opts.lanes = false; continue }
    // ★重车道可选独立阈值：--heavy-timeout=<ms>（默认 HEAVY_TIMEOUT_MS）。
    const ht = /^--heavy-timeout=(\d+)$/.exec(a)
    if (ht) { opts.heavyTimeoutMs = Number(ht[1]); continue }
    const hj = /^--heavy-jobs=(\d+)$/.exec(a)
    if (hj) { opts.heavyJobs = Math.max(1, Math.min(16, Number(hj[1]))); continue }
    const m = /^--timeout=(\d+)$/.exec(a)
    if (m) { opts.timeoutMs = Number(m[1]); continue }
    const f = /^--filter=(.+)$/.exec(a)
    if (f) { opts.filter = f[1]; continue }
    // `--jobs=N` 显式覆盖；`--jobs=1` 回到串行。
    const j = /^--jobs=(\d+)$/.exec(a)
    if (j) { opts.jobs = Math.max(1, Math.min(16, Number(j[1]))); continue }
    // ★task-20：`--retry=N`（钳到 0..1 —— 设计上只允许「重试一次」，N>1 会被钳成 1）。
    const rt = /^--retry=(\d+)$/.exec(a)
    if (rt) { opts.retry = Math.max(0, Math.min(1, Number(rt[1]))); continue }
    // ★ test CI 支持（issue #73）：`--exclude=<子串>` 可多次传入，排除依赖**本地产物**
    //   （如 python/bench/.venv、artifacts/release-c2-asset-pack/*.tgz 均在 .gitignore 里，
    //   CI 全新克隆必然缺失）或需要**真实网络**的套件。本地全量回归不受影响（不传即不排除）。
    const x = /^--exclude=(.+)$/.exec(a)
    if (x) { opts.exclude.push(x[1]); continue }
    if (a === '--help' || a === '-h') { opts.help = true; continue }
    console.error('[run-smoke] unknown argument: ' + a)
    process.exit(2)
  }
  return opts
}

function listSuites(filter, exclude) {
  let names = []
  try { names = readdirSync(SMOKE_DIR) } catch (e) {
    console.error('[run-smoke] cannot read ' + SMOKE_DIR + ': ' + (e && e.message || e))
    process.exit(2)
  }
  return names
    .filter((n) => n.endsWith('.mjs'))
    // ★下划线前缀 = 辅助模块，不是套件入口（2026-11-03）：
    //   tests/smoke/_harness.mjs 是共享脚手架，顶层只有定义与 exit 钩子注册。
    //   被当套件跑会得到一个**恒绿假套件** —— 永远 PASS、永远不产出断言，
    //   既虚增套件计数，又会在有人给脚手架顶层加副作用时静默变成"真执行"。
    //   约定：`_` 开头的文件是库（可被 import），`smoke-test-*` 才是套件。
    .filter((n) => !n.startsWith('_'))
    .filter((n) => !filter || n.includes(filter))
    .filter((n) => !(exclude || []).some((x) => n.includes(x)))
    .filter((n) => { try { return statSync(path.join(SMOKE_DIR, n)).isFile() } catch (e) { return false } })
    .sort()
}

/**
 * Windows 下 SIGKILL 对 node 是"尽力而为":子进程可能还有自己 spawn 的后代。
 * 先 taskkill /T /F 拆整棵树,再补一发 child.kill 兜底。
 */
function hardKill(child) {
  const pid = child.pid
  if (!pid) return
  if (process.platform === 'win32') {
    try { spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }) } catch (e) {}
  } else {
    try { process.kill(-pid, 'SIGKILL') } catch (e) {}
  }
  try { child.kill('SIGKILL') } catch (e) {}
}

/**
 * ★#536：**运行器边界的假绿防线**。
 *
 * 【缺陷】lib/index.js 的 apply() 会挂 process.on('uncaughtException')（生产容错，不该动）。
 *   结果：**任何** smoke 套件在收尾阶段抛的异常都被它吞掉 ⇒ 子进程仍 exit 0
 *   ⇒ 本运行器把「炸过的套件」判成 PASS。实证：v4-h10-curate-apply 每跑都在 :231 抛
 *   ReferenceError，而回归一直绿着 —— 只修那三个变量名治不了根，因为**任何一个**套件
 *   下次再犯同类错误，仍然会被判绿。
 *
 * 【判据】不看套件自报，看**进程实际发生了什么**：
 *   子进程 exit code === 0，但它的输出里出现「未捕获异常」的痕迹 ⇒ 判 FAIL。
 *   痕迹有两个来源，任一命中即算：
 *     ① 插件生产处理器打的 '[dsh-auto-memory] uncaughtException:'（全仓所有套件都有，无需改造）
 *     ② 测试侧护栏 _exit-guard.mjs 打的 '[smoke-fatal]'（opt-in 的新套件，带更细的信息）
 *
 * 【为什么不是「有 stderr 就红」】stderr 里合法噪音很多（诊断行、已预期的降级日志），
 *   只有这两种**明确的致命标记**才算。
 *
 * 【为什么 exit 非零时不覆盖】exit 已经是非零 ⇒ 本来就是 FAIL，保留原始 code 作为证据。
 */
// 插件生产处理器打的（全仓所有套件都有，无需改造）
const PLUGIN_FATAL = '[dsh-auto-memory] uncaughtException:'
// 测试侧护栏 _exit-guard.mjs 打的（opt-in 的新套件，带更细的信息）
const GUARD_FATAL = '[smoke-fatal]'
const FATAL_MARKERS = [PLUGIN_FATAL, GUARD_FATAL]

/**
 * ★★2026-11-05（用户裁定）· **显式标记前缀豁免**，取代原「按套件名白名单」。
 *
 * 【用户否决白名单的理由（原话摘要）】按套件名豁免 = 让该套件**永久脱离防线保护**，是后门。
 *   白名单一旦写进运行器，那个套件此后**任何**未捕获异常都被放过，防线对它形同不存在。
 *
 * 【新机制】套件在**自己知道要制造异常**的那一刻，往 stderr 主动打一行
 *   `[smoke-expected-fatal] <理由>` —— 这是**一次性的信用额度**，不是永久身份。
 *   判据改为：逐行扫 stderr，遇到致命标记行时消费一个信用；**信用不足即 FAIL**。
 *   ⇒ ① 没打标记的套件零豁免（行为与 #536 原版完全一致）；
 *     ② 打了标记的套件也只能豁免**它声明过的那几条**，多抛一条照旧 FAIL；
 *     ③ 豁免粒度从「套件」降到「具体那一次异常」，没有任何套件被整体放行。
 *
 * 【为什么按行配对而不是「有标记就整段放过」】后者同样是后门：套件只要在任何地方打一次标记，
 *   整份 stderr 都被洗净 ⇒ 之后所有真异常一并漏网。按行消费信用可证伪（见测试里的两条变异）。
 *
 * 【约定】标记行必须出现在对应致命行**之前**（同一行序扫描，信用先行）。
 */
const EXPECTED_FATAL_MARK = '[smoke-expected-fatal]'

/**
 * 扫 stderr，返回 {violations, exempted}：
 *   violations = 未被信用覆盖的致命行（每条一句，供 FAIL 理由）
 *   exempted   = 被信用覆盖的致命行数
 * 规则：按行序，`[smoke-expected-fatal]` 行 +1 信用；致命标记行若信用>0 则消费一个、否则计违规。
 */
function scanFatalLines(text) {
  const lines = String(text || '').split(/\r?\n/)
  let credit = 0
  const violations = []
  let exempted = 0
  for (const line of lines) {
    if (line.indexOf(EXPECTED_FATAL_MARK) >= 0) { credit += 1; continue }
    let hit = ''
    for (const m of FATAL_MARKERS) if (line.indexOf(m) >= 0) { hit = m; break }
    if (!hit) continue
    if (credit > 0) { credit -= 1; exempted += 1; continue }
    violations.push(hit + ' :: ' + line.trim().slice(0, 160))
  }
  return { violations, exempted }
}

/**
 * ★只在 **stderr** 上找插件标记 —— 这一条是首版踩坑后的修正：
 *   - 插件处理器写的是 **stderr**（lib/index.js: damSafeDiag(process.stderr, …)）；
 *   - 而「套件把捕获到的子进程输出 echo 出来」走的是 **console.log ⇒ stdout**。
 *   首版两者都扫 ⇒ 本套件自己（把运行器输出当证据打印）被判成假绿 = 误报。
 *   [smoke-fatal] 由护栏直写 stderr，同样只在 stderr 找。
 */
function fatalMarkerIn(text) {
  const s = String(text || '')
  for (const m of FATAL_MARKERS) if (s.indexOf(m) >= 0) return m
  return ''
}

function runSuite(file, timeoutMs) {
  return new Promise((resolve) => {
    const started = Date.now()
    const child = spawn(process.execPath, [file], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      // ★副本一律落到本仓同盘专属目录（见 RUN_TMP 注释）：不写系统盘、跑完即删。
      env: Object.assign({}, process.env, { TEMP: RUN_TMP, TMP: RUN_TMP, DSH_SMOKE_TMP: RUN_TMP }),
    })
    let out = ''
    /**
     * ★#536：**全量** stderr 的分片缓冲（判据扫描用）。展示仍只取末 TAIL_CHARS（见 finish）。
     *   用分片数组而不是 `err += s`：8MB 上界下的连续字符串追加是 O(n²)，分片 join 只拷一遍。
     */
    const errChunks = []
    let errLen = 0
    let errDropped = 0
    const capture = (chunk, sink) => {
      const s = String(chunk)
      // stdout 只用于展示尾部，不需要全量
      if (sink === 'out') { out = (out + s).slice(-TAIL_CHARS); return }
      if (errLen >= SCAN_CAP_CHARS) { errDropped += s.length; return }
      errChunks.push(s); errLen += s.length
    }
    const errAll = () => errChunks.join('')
    child.stdout.on('data', (c) => capture(c, 'out'))
    child.stderr.on('data', (c) => capture(c, 'err'))

    let settled = false
    let timedOut = false
    let timer = null
    let reapTimer = null

    const finish = (status, code, signal, why) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      if (reapTimer) clearTimeout(reapTimer)
      // 先杀、后收管道:反过来会让子进程向已断管道写日志(见文件头第 2 条)。
      if (status === 'TIMEOUT') hardKill(child)
      try { child.stdout.destroy() } catch (e) {}
      try { child.stderr.destroy() } catch (e) {}
      const errText = errAll()
      if (errDropped > 0) {
        console.error('[run-smoke] ⚠ ' + path.basename(file) + ' 的 stderr 超过扫描上界 '
          + SCAN_CAP_CHARS + ' 字符，已丢弃 ' + errDropped + ' 字符（判据只看前 8MB，不是只看尾部）')
      }
      resolve({
        name: path.basename(file),
        timeoutMs,
        status,
        code,
        signal,
        why: why || '',
        seconds: (Date.now() - started) / 1000,
        // ★展示/落盘仍截断（末 TAIL_CHARS）；判据用的是上面的全量 errText（见 close 分支）
        tail: (out + (errText ? '\n--- stderr ---\n' + errText.slice(-TAIL_CHARS) : '')).trimEnd(),
      })
    }

    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true
        hardKill(child)
        // 杀完仍可能因为握有子进程/句柄而迟迟不触发 exit:给一段收尸窗口,到点直接判定。
        reapTimer = setTimeout(() => finish('TIMEOUT', null, 'SIGKILL'), REAP_GRACE_MS)
      }, timeoutMs)
    }

    child.on('error', () => finish('FAIL', null, null))
    child.on('close', (code, signal) => {
      if (timedOut) return finish('TIMEOUT', code, signal)
      if (code !== 0) return finish('FAIL', code, signal)
      // ★#536：exit 0 但输出里有致命标记 ⇒ 假绿，判 FAIL（保留 code=0 作为证据 + 写明命中哪个标记）
      // ★只查 stderr：stdout 里的同名文本是套件在 echo 证据，不是真的未捕获异常
      // ★★2026-11-07（alpha.7 P4）：判据扫**全量** stderr（旧实现只扫末 2000 字符 ⇒ 前段抛的
      //   未捕获异常漏报）。展示仍截末 TAIL_CHARS —— 扫描窗口与展示窗口从此是两个独立概念。
      const err = errAll()
      // ★★2026-11-05（用户裁定）：按**行**扫，用 `[smoke-expected-fatal]` 信用抵扣。
      //   没有任何套件被整体放行；只有「主动声明过的那几次异常」被抵扣。
      const { violations, exempted } = scanFatalLines(err)
      if (violations.length) {
        return finish('FAIL', code, signal, violations[0] + (violations.length > 1 ? ' (+' + (violations.length - 1) + ' more)' : ''))
      }
      finish('PASS', code, signal, exempted ? 'exempted-expected-fatal:' + exempted : undefined)
    })
  })
}

/**
 * ★task-20（alpha.7 P4）· **并发抢占假红的一次性重试**。
 *
 * 【机制（实测，不是推断）】双车道：重车道 51 套件 x8（HEAVY_JOBS）、轻车道 517 套件 x4
 *   （DEFAULT_JOBS）；`--jobs` **只改轻车道** ⇒ `--jobs=8` 实际 16 路并发（本机 8C/16T 占满）。
 *   这就是「降 jobs 就稳」的全部机制 —— 不是产品缺陷，是调度饥饿。
 *   实证：8 个重套件 + 8 个 CPU 燃烧进程下 v4-u6-memory-upgrade 单次 exit=1 / 14,781ms
 *   （基线 2,284ms），33 PASS / 4 FAIL，失败的是纯时序断言（U6-3b「start<50ms」实测 312.16ms）。
 *
 * 【修法】**只对「疑似并发抢占」重试一次**：串行 width=1，沿用首次 timeoutMs（**不放宽阈值** ——
 *   放大阈值就是洗绿）。判定条件（缺一不可）：
 *     ① status === 'FAIL' —— TIMEOUT 不重试（那是阈值问题，重试等于换判据）
 *     ② why === ''        —— #536 假绿命中永不重试（那是真异常被吞，重试只会把它洗成 PASS）
 *     ③ code !== null     —— 必须有真实退出码（被信号杀掉/启动失败没有可复现的判据）
 *
 * 【四条防洗绿】
 *   ① why 非空永不重试；
 *   ② 台账 key = `name@HEAD`：同一提交下**二次** flake 直接判红（不重复记 FLAKY）；
 *   ③ 汇总新增 FLAKY **单列**，不计入 PASS；
 *   ④ `--retry=0` 可整批关闭。
 */
const FLAKE_LEDGER_PATH = path.join(RUN_TMP_ROOT, 'flake-ledger.json')

/** 取当前提交短哈希；拿不到（发布包无 .git / CI 浅克隆失败）时回落 `no-git`。 */
function resolveHead() {
  try {
    const r = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8', timeout: 10000, windowsHide: true })
    const s = String(r.stdout || '').trim()
    if (r.status === 0 && /^[0-9a-f]{7,40}$/.test(s)) return s.slice(0, 12)
  } catch (e) {}
  return 'no-git'
}

/** 读 flake 台账（{ <head>: [name, ...] }）。坏文件一律当空表 —— 台账绝不能让回归跑挂。 */
function readFlakeLedger() {
  try {
    const o = JSON.parse(readFileSync(FLAKE_LEDGER_PATH, 'utf8'))
    return o && typeof o === 'object' && !Array.isArray(o) ? o : {}
  } catch (e) { return {} }
}

/** 原子写台账（同目录 tmp + rename），只保留最近 5 个提交，防无界增长。 */
function writeFlakeLedger(o) {
  try {
    const keys = Object.keys(o).sort()
    const trimmed = {}
    for (const k of keys.slice(-5)) trimmed[k] = o[k]
    const tmp = FLAKE_LEDGER_PATH + '.tmp-' + process.pid
    writeFileSync(tmp, JSON.stringify(trimmed) + '\n', 'utf8')
    renameSync(tmp, FLAKE_LEDGER_PATH)
  } catch (e) { /* fail-soft：台账不可写不影响回归结果 */ }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  // ★本运行的临时根（见 RUN_TMP 注释）：建好并把子进程 TEMP 指过来，跑完由 cleanupRunTmp 删除。
  try {
    mkdirSync(RUN_TMP, { recursive: true })
    const swept = sweepStaleRuns()
    if (swept > 0 && !opts.quiet) console.log('[run-smoke] 已清扫上次遗留的临时运行目录 ' + swept + ' 个')
  } catch (eTmp) {
    // fail-soft：建不出来就退回系统 TEMP（老行为），绝不因为优化把回归跑挂
    console.error('[run-smoke] 临时目录不可用，回退系统 TEMP：' + (eTmp && eTmp.message))
  }
  if (opts.help) {
    console.log('usage: node tools/run-smoke.mjs [--timeout=<ms>] [--filter=<substr>] [--exclude=<substr>]... [--jobs=N] [--lanes=off] [--heavy-jobs=N] [--retry=0|1]')
    return 0
  }
  // ★影响面预检（只读）：列出改动文件、正文引用它们的套件、以及基线锁套件。
  let impact = null
  if (opts.impact || opts.impactRun) {
    impact = analyzeImpact({ root: ROOT, smokeDir: SMOKE_DIR })
    console.log('[impact] ===== 需要动手改的（基线锁）=====')
    if (impact.coreTouched) {
      console.log('[impact] ⚠ lib/index.js 或 lib/client.js 在改动集内 ⇒ 以下 ' + impact.lock.length + ' 个套件锁着「文件一改就得跟着上移的常量」，跑之前先预期它们会红：')
      for (const name of impact.lock) console.log('  * ' + name)
    } else {
      console.log('[impact] lib/index.js 与 lib/client.js 均未改 ⇒ 基线锁套件预期不受影响（无需重钉常量）。')
    }
    console.log('[impact] ===== 会被波及的（依赖边）=====')
    console.log('[impact] 本次改动 ' + impact.changed.length + ' 个受管源码文件:')
    for (const c of impact.changed) console.log('  - ' + c)
    const hitNames = [...impact.hit.keys()]
    const CAP = 25
    console.log('[impact] 依赖这些文件的套件共 ' + hitNames.length + ' 个' + (hitNames.length > CAP ? '（只列前 ' + CAP + '，完整清单加 --impact-all）' : '') + ':')
    for (const name of hitNames.slice(0, opts.impactAll ? hitNames.length : CAP)) {
      console.log('  - ' + name + '   <- ' + impact.hit.get(name).join(', '))
    }
  }
  if (opts.impact) {
    console.log('[impact] 只读预检结束（未运行任何套件）。加 --impact-run 可只跑命中集。')
    return 0
  }

  let suites = listSuites(opts.filter, opts.exclude)
  if (impact && opts.impactRun) {
    const focus = new Set([...impact.hit.keys(), ...(impact.coreTouched ? impact.lock : [])])
    suites = suites.filter((n) => focus.has(n))
    console.log('[impact-run] 收窄到 ' + suites.length + ' 个命中/锁套件（全量仍由不带该开关的运行负责）。')
  }
  if (!suites.length) {
    console.error('[run-smoke] no suites matched in ' + SMOKE_DIR + (opts.filter ? ' (filter=' + opts.filter + ')' : ''))
    return 2
  }

  const jobs = Math.max(1, Math.min(16, opts.jobs || 1))
  const lanePlan = opts.lanes ? splitLanes(suites) : { heavy: [], light: suites }
  console.log('[run-smoke] ' + suites.length + ' suite(s) in tests/smoke, per-suite timeout='
    + (opts.timeoutMs > 0 ? opts.timeoutMs + 'ms' : 'disabled')
    + ', ' + (jobs === 1 ? 'sequential (never parallel)' : 'parallel x' + jobs))
  // ★2026-10-25 修「日志说谎」：本行原为 if (opts.lanes)，但执行分支 L440 是
  //   `if (!opts.lanes || jobs === 1)` ⇒ jobs===1 时双车道根本不会走，日志却照样打印
  //   「重车道 50 套件 x8」，让人误以为重车道在并行（本轮实测已误导过一次归因）。
  //   判据：日志只能描述**实际会走的路径**，不能描述「若走另一分支会怎样」。
  if (opts.lanes && jobs !== 1) {
    const heavySum = lanePlan.heavy.reduce((a, n) => a + (HEAVY_MS[n] || 0), 0) / 1000
    console.log('[run-smoke] 双车道: 重车道 ' + lanePlan.heavy.length + ' 套件 x' + opts.heavyJobs + ' (timeout=' + opts.heavyTimeoutMs + 'ms)'
      + '（实测合计 ' + heavySum.toFixed(0) + 's）; 轻车道 ' + lanePlan.light.length + ' 套件/并行 x' + jobs)
  }
  console.log('')

  const results = []
  const runStart = Date.now()
  let done = 0
  // ★T7-c：进度行。写成 `[12/135] (1m02s) 最近: xxx.mjs`，让"还要等多久"一眼可见。
  //   串行时每套件跑完刷新一次；并行时也在每个完成点刷新（谁先完成谁先报）。
  const fmtDur = (ms) => {
    const s = Math.round(ms / 1000)
    return s < 60 ? s + 's' : Math.floor(s / 60) + 'm' + String(s % 60).padStart(2, '0') + 's'
  }
  const report = (r) => {
    results.push(r)
    done++
    const mark = r.status === 'PASS' ? 'PASS   ' : (r.status === 'TIMEOUT' ? 'TIMEOUT' : 'FAIL   ')
    console.log('[' + mark + '] ' + r.name + '  (' + r.seconds.toFixed(1) + 's)'
      + (r.status === 'PASS' ? '' : '  exit=' + r.code + ' sig=' + r.signal
        + (r.why ? '  ★假绿防线命中: ' + r.why + '（进程 exit 0 但有未捕获异常）' : '')))
    // 进度行:已跑完 X/N,已耗时,最近完成者。末行会被汇总覆盖,不留垃圾。
    const pct = String(Math.round((done / suites.length) * 100)).padStart(3)
    console.log('   └─ ' + pct + '% [' + done + '/' + suites.length + ']  已耗时 ' + fmtDur(Date.now() - runStart)
      + '  最近: ' + r.name)
  }

  /** 有界工作池：固定 jobs 个 worker 从同一下标游标取任务，天然限流、无第三方依赖。 */
  // ★2026-11-09：timeoutMs 允许**传函数**（按套件名取阈值）或数字（车道统一阈值）。
  //   为什么必须支持函数：重车道 51 个套件里只有 la5 需要 420s，其余都该守 240s ——
  //   车道级单值做不到「只给一个套件放宽」，而那正是本次问题的形态。
  const resolveTimeout = (n, t) => (typeof t === 'function' ? t(n) : t)
  const runPool = async (list, width, timeoutSpec) => {
    let cursor = 0
    const worker = async () => {
      for (;;) {
        const i = cursor++
        if (i >= list.length) return
        const r = await runSuite(path.join(SMOKE_DIR, list[i]), resolveTimeout(list[i], timeoutSpec))
        report(r)
      }
    }
    await Promise.all(Array.from({ length: Math.min(width, list.length) }, () => worker()))
  }

  if (!opts.lanes || jobs === 1) {
    // 分道关闭（或单并发）：原行为——整个集合走一个池子（jobs=1 时即逐字节等价串行）。
    // ★2026-10-25 修「--jobs=1 时重套件被判 TIMEOUT」的真缺陷：
    //   原实现整个集合统一用 opts.timeoutMs（默认 60s），而 HEAVY_MS 里登记的套件
    //   单跑就要 161s（smoke-test-v3314-continuation-timeout 实测 161.1s）⇒ 串行模式下
    //   必然 TIMEOUT。这条只在「走双车道」时被规避（重车道 240s），一旦 --jobs=1 就暴露。
    //   判据：**超时阈值是「套件属性」，不是「车道属性」** —— 换执行路径不得改变判定标准。
    //   修法：单池分支按套件名查 HEAVY_MS，命中就给 heavyTimeoutMs。
    // ★2026-11-09（1B 收口轮）：**per-suite 阈值**（向后兼容的最小扩展）。
  //   背景：la5 单跑 242.4s、并发下更慢 ⇒ 若只用全局重车道 240s，它在回归里恒 TIMEOUT。
  //   口径：重车道套件取 max(全局 heavyTimeout, 登记值) —— 登记值本就只在该套件"真的更慢"时才高于全局，
  //   因此对表内其余 50 个套件行为**逐字不变**（它们的登记值都 < 240000）。
  //   ⚠ 这不是"放宽阈值洗绿"：登记值必须是**实测耗时**，且套件本身必须 exit=0（la5 实测 50 PASS / 0 FAIL）。
  const pickTimeout = (n) => {
    if (HEAVY_MS[n] === undefined) return opts.timeoutMs
    return Math.max(opts.heavyTimeoutMs, Number(HEAVY_MS[n]) || 0)
  }
    const runPoolPerSuite = async (list) => {
      let cursor = 0
      const worker = async () => {
        for (;;) {
          const i = cursor++
          if (i >= list.length) return
          // 与双车道重车道**同一口径**：只有登记值 > 全局阈值时才生效（其余套件行为不变）
          const r = await runSuite(path.join(SMOKE_DIR, list[i]), pickTimeout(list[i]))
          report(r)
        }
      }
      await Promise.all(Array.from({ length: Math.min(jobs, list.length) }, () => worker()))
    }
    await runPoolPerSuite(suites)
  } else {
    // ★双车道：重车道与轻车道**同时**开跑，各自独立限流。
    //   重车道默认串行（heavyJobs=1）⇒ 互不抢占，墙钟回到单跑量级；
    //   轻车道并行 ⇒ 305 个快套件（合计仅 277s）迅速收尾。
    //   总墙钟 ≈ max(重车道合计, 轻车道合计 / jobs)，两边都不再有并发假红。
    await Promise.all([
      runPool(lanePlan.heavy, opts.heavyJobs, (n) => Math.max(opts.heavyTimeoutMs, Number(HEAVY_MS[n]) || 0)),
      runPool(lanePlan.light, jobs, opts.timeoutMs),
    ])
  }

  // ★task-20（alpha.7 P4）：疑似并发抢占的**一次性**串行重试（完整判据见 FLAKE_LEDGER_PATH 上方注释）。
  //   位置：两车道 Promise.all 之后、汇总之前 —— 只重跑确实红掉的，不重跑整批。
  //   四条防洗绿在这里逐条落地：①why 非空不在 suspects 里；②台账 name@HEAD 二次即判红；
  //   ③FLAKY 单列；④--retry=0 关闭。
  if (opts.retry > 0) {
    const suspects = results.filter((r) => r.status === 'FAIL' && !r.why && r.code !== null)
    if (suspects.length) {
      const head = resolveHead()
      const ledger = readFlakeLedger()
      const seen = new Set(Array.isArray(ledger[head]) ? ledger[head] : [])
      console.log('')
      console.log('[run-smoke] 疑似并发抢占 ' + suspects.length + ' 个套件（FAIL + 非假绿命中 + 有真实退出码）'
        + ' ⇒ 串行 width=1 重跑一次（沿用首次 timeoutMs，**不放宽阈值**；--retry=0 可关闭）')
      for (const r of suspects) {
        const rr = await runSuite(path.join(SMOKE_DIR, r.name), r.timeoutMs)
        r.retried = true
        r.retryStatus = rr.status
        r.retrySeconds = rr.seconds
        const key = r.name + '@' + head
        if (rr.status === 'PASS') {
          if (seen.has(key)) {
            r.repeatFlake = key
            console.log('[RETRY  ] ' + r.name + ' 重跑通过，但台账已有 ' + key
              + ' ⇒ 同一提交二次 flake，**维持 FAIL**（不再记 FLAKY）  (' + rr.seconds.toFixed(1) + 's)')
          } else {
            seen.add(key)
            ledger[head] = [...seen]
            writeFlakeLedger(ledger)
            r.status = 'FLAKY'
            console.log('[FLAKY  ] ' + r.name + ' 首次 ' + r.seconds.toFixed(1) + 's exit=' + r.code
              + ' ⇒ 串行重跑 ' + rr.seconds.toFixed(1) + 's PASS（记 FLAKY，**不计入 PASS**）')
          }
        } else {
          console.log('[RETRY  ] ' + r.name + ' 重跑仍 ' + rr.status + ' exit=' + rr.code
            + ' ⇒ 判为真缺陷，**不重试第二次**，维持 FAIL')
        }
      }
    }
  }

  const pass = results.filter((r) => r.status === 'PASS')
  const fail = results.filter((r) => r.status === 'FAIL')
  const timeout = results.filter((r) => r.status === 'TIMEOUT')
  // ★task-20：FLAKY **单列**，绝不并入 PASS —— 否则重试就成了洗绿通道。
  const flaky = results.filter((r) => r.status === 'FLAKY')
  const totalSeconds = (Date.now() - runStart) / 1000

  console.log('')
  console.log('================ SUMMARY ================')
  console.log('PASS ' + pass.length + ' / FAIL ' + fail.length + ' / TIMEOUT ' + timeout.length
    + ' / FLAKY ' + flaky.length + '   (total ' + totalSeconds.toFixed(1) + 's)')
  // ★task-20：FLAKY 紧贴计数行输出（与 FAILED 同一约定：1 行内可见），并显式标注「未计入 PASS」。
  if (flaky.length) {
    console.log('FLAKY (串行重试后通过，未计入 PASS): ' + flaky.map((r) => r.name).join(', '))
  }
  // ★2026-10-02（用户反馈「跑完没有打印出 fail 的地方，还得重跑一遍」）：
  //   把失败套件名**紧贴计数行**输出。此前明细在文件末尾，任何 `| Select-Object -Last N`
  //   或只看尾部的取用方式都会把明细截掉，只剩计数 ⇒ 被迫重跑一次 80s 的回归才能定位。
  //   现约定：**计数行之后 1 行内必给出全部失败套件名**（可复算，与下方明细同源）。
  if (timeout.length || fail.length) {
    console.log('FAILED: ' + [...timeout, ...fail].map((r) => r.name).join(', '))
  }
  for (const r of [...timeout, ...fail]) {
    console.log('')
    console.log('--- ' + r.status + ': ' + r.name + (r.status === 'TIMEOUT' ? '  (exceeded ' + (r.timeoutMs || opts.timeoutMs) + 'ms)' : '  (exit=' + r.code + ')') + ' ---')
    // ★task-20：同一提交的二次 flake 在这里点名（它保持 FAIL，必须让人看得出「不是首次红」）
    if (r.repeatFlake) console.log('★同一提交二次 flake（台账 ' + r.repeatFlake + '）：首次 ' + r.seconds.toFixed(1) + 's exit=' + r.code + '，串行重跑 ' + (r.retryStatus || '?') + ' ⇒ 直接判红')
    console.log('last output tail:')
    console.log(r.tail ? r.tail.split('\n').slice(-25).join('\n') : '(no output captured)')
  }
  console.log('=========================================')

  return (fail.length || timeout.length) ? 1 : 0
}

// ★无论正常/异常/被中断，都要把本运行的临时目录删掉（避免 2026-10-08 那次系统盘被副本吃满）。
process.on('exit', cleanupRunTmp)
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  try { process.on(sig, () => { cleanupRunTmp(); process.exit(130) }) } catch (e) {}
}
process.on('uncaughtException', (e) => {
  console.error('[run-smoke] uncaught: ' + (e && (e.stack || e.message) || e))
  cleanupRunTmp()
  process.exit(2)
})

main().then((code) => { cleanupRunTmp(); process.exit(code) }).catch((e) => {
  console.error('[run-smoke] runner crashed: ' + (e && (e.stack || e.message) || e))
  cleanupRunTmp()
  process.exit(2)
})
