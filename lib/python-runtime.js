/**
 * python-runtime.js —— Python 解释器/引擎**运行时探测链**（2026-09-30 新增）。
 *
 * 设计原则（用户 2026-09-30 拍板的三条）：
 *   ① **判据 = 真跑通**：不以"文件在不在"判定可用性，以"有没有真反馈"判定。
 *      本模块对解释器做 deps 探测（import transformers/onnxruntime/numpy），
 *      对 worker 做协议往返（health 帧 → embedding 视图）；
 *   ② **健壮降级**：逐个候选往下试，任何一个失败**不中止整链**，能凑合跑就让它跑，
 *      并把失败原因如实带出（错误摆在用户脸上，而不是静默回落）；
 *   ③ **开发值显式识别**：命中开发树路径时标记 `isDev: true`，供 UI 提示"检测到开发值"。
 *
 * 为什么单独成模块：`lib/index.js` 与 `lib/python-setup.js` 都要用这条链，
 * 而后者被设计为零依赖纯逻辑（不 import index），共享逻辑放这里最干净。
 *
 * 边界：零第三方依赖（仅 node 内建）；所有函数 fail-soft 返回结构化结果，**绝不抛**；
 *      探测结果由调用方缓存（本模块不做缓存，避免隐藏状态）。
 * UTF-8 无 BOM。
 */
import { execFile } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import path from 'node:path'

export const PY_RUNTIME_VERSION = 'py_runtime_probe_v1'

/** 依赖探测脚本：import 三条核心依赖（与 python-setup 的 DEPS_PROBE 同源口径）。 */
export const PY_DEPS_PROBE_SCRIPT = 'import transformers, onnxruntime, numpy; print("deps-ok")'
/** 版本探测脚本。 */
export const PY_VERSION_PROBE_SCRIPT = 'import sys; print("%d.%d" % sys.version_info[:2])'

/**
 * 执行一次探测（fail-soft：超时/不存在/非零退出都返回结构化成败，绝不抛）。
 * @param {string} py 解释器路径或 PATH 命令名
 * @param {string[]} args 参数
 * @param {number} [timeoutMs]
 * @returns {Promise<{ok:boolean, out:string, ms:number, reason:string}>}
 */
export function probePythonPre(py, args, timeoutMs = 12000) {
  return new Promise((resolve) => {
    const t0 = Date.now()
    try {
      execFile(String(py), args, { timeout: timeoutMs, windowsHide: true, maxBuffer: 1 << 20 }, (err, stdout, stderr) => {
        if (err) {
          // ★2026-09-30（E 批 · 真机实证）：超时/被杀时 err.message 可能为**空串**，
          //   失败原因因此不可归因（前端只能显示「失败」）—— 面板显示「就绪」但 C3 实际
          //   没起来的盲区由此而来。实机复现：首次链路探测（系统 python 的 torch 导入抢
          //   CPU）把 venv 那条判成 FAIL 且 reason 为空；随后独立重测 4/4 全 OK（~1.8s）
          //   ⇒ 属**可重试的瞬时**失败。处置：①超时显式命名归因；②带出 stderr 尾部（真因常在）。
          const ms = Date.now() - t0
          const timedOut = err.killed === true || err.signal === 'SIGTERM' || ms >= timeoutMs - 150
          const bits = []
          if (timedOut) bits.push('探测超时(' + ms + 'ms/' + timeoutMs + 'ms；torch 首次导入较慢，可重试)')
          else bits.push(String((err && err.message) || err || '执行失败').split('\n')[0].slice(0, 120))
          // ★批次 W（2026-10-05，PR#210 拆取配套）：errTail 改取**尾部** 160 字符 ——
          //   Python 3.13+ 对 -c 脚本会回显整行源码+^^^定位行（>160 字符），旧写法
          //   slice(0,160) 恰好把最后的 ModuleNotFoundError 行截掉，失败又变回「不可归因」。
          const errTail = String(stderr || '').trim().split(/\r?\n/).slice(-2).join(' | ').slice(-160)
          if (errTail) bits.push(errTail)
          resolve({ ok: false, out: '', ms, reason: bits.join(' :: ').slice(0, 300), timedOut })
        } else {
          resolve({ ok: true, out: String(stdout || '').trim(), ms: Date.now() - t0, reason: '' })
        }
      })
    } catch (e) {
      resolve({ ok: false, out: '', ms: Date.now() - t0, reason: String((e && e.message) || e).slice(0, 300) })
    }
  })
}

/**
 * 带**一次重试**的探测（E 批）：仅对「超时/被杀」这类瞬时失败重试。
 * 为什么需要：deps 探测要 import torch（首次可达数秒），机器繁忙时单次可能假失败；
 * 实机已复现「链路里 FAIL、独立重测 4/4 通过」。若不重试，一次抖动就静默降级到 C2，
 * 用户看到面板「就绪」但 C3 不工作 —— 正是本次要根治的盲区。
 * 语义边界：**只重试瞬时失败**（timedOut）；依赖真缺失（ModuleNotFoundError）不重试（如实、省时）。
 */
export async function probePythonWithRetryPre(py, args, timeoutMs = 12000, retries = 1) {
  let last = await probePythonPre(py, args, timeoutMs)
  for (let i = 0; i < retries && !last.ok && last.timedOut; i++) {
    const again = await probePythonPre(py, args, Math.round(timeoutMs * 1.5))
    if (again.ok) return again
    last = again
  }
  return last
}

/**
 * 构造解释器候选链（按优先级；**不判存在性**——由 probe 逐个实测，这正是"不以文件论"）。
 *
 * 顺序设计（为什么是这个序）：
 *   ① 配置显式值 —— 用户/向导明确指定，最高优先（即使它在别的盘）。
 *   ② 用户位 venv（`<dshHome>/python-engine/.venv`）—— `python-setup` 的正式产物位置，
 *      跨升级存活；**这是发布版用户的正常路径**。
 *   ③ 开发树 bench venv（`<plugin>/python/bench/.venv`）—— 维护者开发路径（发布包不含
 *      bench，用户机上结构性不存在）。命中它 ⇒ 标 isDev，UI 提示"检测到开发值"。
 *   ④ 系统 PATH 的 python / python3 / py —— 兜底（可能缺依赖，由 deps 探测如实报出）。
 *
 * @param {object} o
 * @param {string} [o.configured] 配置里的 pythonBackendExecutable
 * @param {string} [o.dshHome] DSH 主目录
 * @param {string} [o.pluginDir] 插件根目录（用于开发树候选）
 * @returns {Array<{path:string,label:string,isDev:boolean,kind:string}>}
 */
export function buildPythonCandidatesPre(o = {}) {
  const out = []
  const push = (p, label, kind, isDev) => {
    const s = String(p || '').trim()
    if (!s) return
    if (out.some((x) => x.path === s)) return
    out.push({ path: s, label, kind, isDev: !!isDev })
  }
  const cfg = String(o.configured || '').trim()
  if (cfg) push(cfg, '配置指定的解释器', 'configured', false)
  const home = String(o.dshHome || '').trim()
  if (home) {
    const uv = process.platform === 'win32'
      ? path.join(home, 'python-engine', '.venv', 'Scripts', 'python.exe')
      : path.join(home, 'python-engine', '.venv', 'bin', 'python')
    push(uv, 'DSH Python 引擎 venv（推荐）', 'user-venv', false)
  }
  const pd = String(o.pluginDir || '').trim()
  if (pd) {
    const dv = process.platform === 'win32'
      ? path.join(pd, 'python', 'bench', '.venv', 'Scripts', 'python.exe')
      : path.join(pd, 'python', 'bench', '.venv', 'bin', 'python')
    push(dv, '开发树 bench venv（开发值）', 'dev-venv', true)
  }
  push('python', '系统 PATH: python', 'system', false)
  push('python3', '系统 PATH: python3', 'system', false)
  push('py', 'Windows py launcher', 'system', false)
  return out
}

/**
 * 逐个探测候选解释器，返回**首个 deps 就绪者** + 全部候选的完整探测结果。
 *
 * 健壮性（原则②）：任何候选失败只记录、**继续往下试**；全失败也返回结构化结果
 * （`chosen=''` + 每个候选的失败原因），绝不抛、绝不中止。
 *
 * @param {Array} candidates buildPythonCandidatesPre 的产出
 * @param {object} [opts] { timeoutMs }
 * @returns {Promise<{chosen:string, chosenIsDev:boolean, chosenReason:string, probed:Array}>}
 */
export async function resolvePythonInterpreterPre(candidates, opts = {}) {
  const tmo = Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : 12000
  const probed = []
  let chosen = ''
  let chosenIsDev = false
  for (const c of Array.isArray(candidates) ? candidates : []) {
    const isPathLike = /[\\/]/.test(c.path)
    // 路径型候选先做存在性快检（省一次 spawn）；**但存在性只用于短路，不用于判"可用"**
    if (isPathLike && !existsSync(c.path)) {
      probed.push({ ...c, status: 'missing', version: '', deps: false, reason: '文件不存在', ms: 0 })
      continue
    }
    const v = await probePythonPre(c.path, ['-c', PY_VERSION_PROBE_SCRIPT], tmo)
    if (!v.ok) {
      probed.push({ ...c, status: 'unrunnable', version: '', deps: false, reason: v.reason || '无法执行', ms: v.ms })
      continue
    }
    const ver = String(v.out || '').trim()
    const d = await probePythonWithRetryPre(c.path, ['-c', PY_DEPS_PROBE_SCRIPT], tmo)
    const rec = {
      ...c, status: d.ok ? 'ready' : 'no-deps', version: ver, deps: !!d.ok,
      reason: d.ok ? '' : (d.reason || '缺少依赖（transformers/onnxruntime/numpy）'),
      ms: v.ms + d.ms,
    }
    probed.push(rec)
    if (d.ok && !chosen) { chosen = c.path; chosenIsDev = !!c.isDev }
  }
  return {
    chosen,
    chosenIsDev,
    chosenReason: chosen ? 'deps 探测通过（可真正加载模型）' : '无候选解释器通过 deps 探测',
    probed,
  }
}

/** 判断某路径是否落在开发树内（用于"检测到开发值"提示）。纯字符串判定，零 IO。 */
export function isDevTreePathPre(p, pluginDir) {
  try {
    const a = String(p || '').replace(/\\/g, '/').toLowerCase()
    const b = String(pluginDir || '').replace(/\\/g, '/').toLowerCase()
    if (!a || !b) return false
    return a.startsWith(b + '/')
  } catch (_) { return false }
}

/** 解释器文件是否存在且像可执行文件（仅用于 UI 快速显示，不用于就绪判定）。 */
export function interpreterFileInfoPre(p) {
  try {
    const s = String(p || '').trim()
    if (!s) return { exists: false, bytes: 0 }
    if (!/[\\/]/.test(s)) return { exists: true, bytes: 0 } // PATH 命令名：假定存在，由探测定夺
    if (!existsSync(s)) return { exists: false, bytes: 0 }
    return { exists: true, bytes: statSync(s).size }
  } catch (_) { return { exists: false, bytes: 0 } }
}
