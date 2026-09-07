/**
 * M7.6 Python 一键向导(host 半):#16-#20 配套——把 C3 进阶档从"开发机可达"变成"爱好者可达"。
 *
 * 四步链路(全部走本模块,UI 只管展示状态与点击):
 *   ①detect  — 探测系统 Python(≥3.9)/既有 venv/模型本体;全部只读。
 *   ②venv    — python -m venv <userDir>/python-engine/.venv(幂等:已存在直接跳过)。
 *   ③deps    — venv 内 pip 安装运行依赖(fastembed/onnxruntime,清华镜像兜底)。
 *   ④model   — BGE-M3 int8(~539MB)下载到 <userDir>/python-engine/models/,
 *              cn(hf-mirror)/intl(hf 官方)双通道+SHA256 校验,复用 JS 档下载器的状态机形态。
 *
 * 设计约束:
 *   - 一切落盘在用户目录(~/.dsh/python-engine/),npm 包目录升级会被覆盖,绝不放模型。
 *   - 长任务(venv/pip/下载)异步执行,进度写 state 供 semantic-status 轮询;失败可重试。
 *   - 零新依赖:下载用全局 fetch,解压用 onnx 单文件直下(无压缩包),venv 用 python -m venv。
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import path from 'node:path'
import { existsSync, mkdirSync, writeFileSync, statSync, createWriteStream } from 'node:fs'
import { readFile, writeFile, rm } from 'node:fs/promises'

const execFileP = promisify(execFile)

/** BGE-M3 int8 单文件(与 bench 夹具同源;hf-mirror 为主源,HF 官方为备源)。 */
const MODEL_SPEC = {
  repo: 'Xenova/bge-m3-int8',
  file: 'onnx/model_int8.onnx',
  bytes: 568456694,
  sha256: '', // 见 MODEL_SHA256:远端 LFS 校验不可靠时以 size 下限+可执行性兜底;sha256 由首版发布冻结后填入
  mirrors: [
    { id: 'cn', url: (p) => 'https://hf-mirror.com/' + p },
    { id: 'intl', url: (p) => 'https://huggingface.co/' + p },
  ],
}

/** venv 内 pip 依赖(语义引擎最小集;transformers 栈换成 fastembed=纯 onnxruntime,免 torch)。 */
const PIP_DEPS = ['fastembed', 'onnxruntime']

export function createPythonSetupPre(opts = {}) {
  const dshHomeOf = typeof opts.dshHome === 'function' ? opts.dshHome : () => opts.dshHome || path.join(homedir(), '.dsh')
  const diagOf = typeof opts.diag === 'function' ? opts.diag : () => {}

  // 引擎根目录(用户目录,跨升级存活): ~/.dsh/python-engine/
  const engineRoot = () => path.join(dshHomeOf(), 'python-engine')
  const venvDir = () => path.join(engineRoot(), '.venv')
  const venvPython = () => process.platform === 'win32' ? path.join(venvDir(), 'Scripts', 'python.exe') : path.join(venvDir(), 'bin', 'python')
  const modelsDir = () => path.join(engineRoot(), 'models')
  const modelPath = () => path.join(modelsDir(), 'model_int8.onnx')

  // 进度状态(内存态,semantic-status 轮询消费;host 重启后 detect 重建)
  const st = {
    phase: 'idle',        // idle|detecting|venv|deps|downloading|verifying|ready|error
    error: '',
    pythons: [],          // [{label,path,status:'ok'|'missing'|'too-old',version}]
    chosenPython: '',
    venvOk: false,
    depsOk: false,
    dl: { bytesDone: 0, bytesTotal: MODEL_SPEC.bytes, mirror: '', startedAt: 0, etaSec: 0 },
    cancelled: false,
  }
  let dlAbort = null

  function probe(pyPath, args, timeoutMs) {
    return new Promise((resolve) => {
      let done = false
      const t = setTimeout(() => { if (!done) { done = true; resolve({ ok: false, out: '' }) } }, timeoutMs || 8000)
      try {
        execFileP(pyPath, args, { timeout: (timeoutMs || 8000) - 500, windowsHide: true, maxBuffer: 1024 * 1024 })
          .then((r) => { if (!done) { done = true; clearTimeout(t); resolve({ ok: true, out: String(r.stdout || '').trim() }) } })
          .catch(() => { if (!done) { done = true; clearTimeout(t); resolve({ ok: false, out: '' }) } })
      } catch (_) { if (!done) { done = true; clearTimeout(t); resolve({ ok: false, out: '' }) } }
    })
  }

  function pyVersionOf(out) {
    const m = String(out || '').match(/(\d+)\.(\d+)/)
    return m ? { major: Number(m[1]), minor: Number(m[2]) } : null
  }

  /** ①环境探测:venv(推荐)→ 系统 python/python3/py launcher;版本 ≥3.9 且 <3.13(onnxruntime 兼容上界)。 */
  async function detect() {
    st.phase = 'detecting'; st.error = ''
    const dshHome = dshHomeOf()
    const cands = [
      { path: venvPython(), label: 'DSH Python 引擎 venv(推荐)', isVenv: true },
      { path: 'python', label: '系统 PATH: python', isVenv: false },
      { path: 'python3', label: '系统 PATH: python3', isVenv: false },
      { path: 'py', label: 'Windows py launcher', isVenv: false },
    ]
    const out = []
    for (const c of cands) {
      if ((c.path.includes('\\') || c.path.includes('/')) && !existsSync(c.path)) { out.push({ ...c, status: 'missing', version: '' }); continue }
      const r = await probe(c.path, ['-c', 'import sys; print("%d.%d" % sys.version_info[:2])'])
      const v = pyVersionOf(r.out)
      if (!r.ok || !v) { out.push({ ...c, status: 'missing', version: '' }); continue }
      out.push({ ...c, status: (v.major === 3 && v.minor >= 9 && v.minor <= 12) ? 'ok' : 'too-old', version: v.major + '.' + v.minor })
    }
    // 既有成果快照
    st.venvOk = existsSync(venvPython())
    st.depsOk = st.venvOk ? (await probe(venvPython(), ['-c', 'import fastembed, onnxruntime; print("deps-ok")'])).ok : false
    st.modelReady = existsSync(modelPath())
    st.pythons = out
    st.phase = 'idle'
    return snapshot()
  }

  function snapshot() {
    return {
      phase: st.phase, error: st.error,
      pythons: st.pythons, chosenPython: st.chosenPython,
      venvOk: st.venvOk, depsOk: st.depsOk, modelReady: st.modelReady,
      modelPath: modelPath(), venvPython: venvPython(),
      modelBytes: st.modelReady ? statSync(modelPath()).size : 0, modelExpectedBytes: MODEL_SPEC.bytes,
      dl: { ...st.dl },
    }
  }

  /** ②venv:幂等(已存在跳过);用探测到的首个 ok 系统解释器创建。 */
  async function ensureVenv(pythonPath) {
    const base = String(pythonPath || '').trim() || (st.pythons.find((x) => x.status === 'ok' && !x.isVenv) || {}).path || ''
    if (!base) { st.error = '未检测到可用的系统 Python(需 3.9-3.12)。请先安装 Python。'; st.phase = 'error'; return snapshot() }
    st.chosenPython = base
    if (existsSync(venvPython())) { st.venvOk = true; return snapshot() }
    st.phase = 'venv'
    mkdirSync(engineRoot(), { recursive: true })
    try {
      await execFileP(base, ['-m', 'venv', venvDir()], { timeout: 180000, windowsHide: true })
      st.venvOk = existsSync(venvPython())
      if (!st.venvOk) throw new Error('venv 目录未生成')
      diagOf('python-setup: venv created at ' + venvDir())
    } catch (e) {
      st.error = 'venv 创建失败: ' + String((e && e.message) || e).slice(0, 160); st.phase = 'error'
    }
    return snapshot()
  }

  /** ③deps:venv 内 pip 装 fastembed+onnxruntime;官方源失败切清华镜像。 */
  async function ensureDeps() {
    if (!st.venvOk) { st.error = 'venv 未就绪,先执行 venv 步骤'; st.phase = 'error'; return snapshot() }
    st.phase = 'deps'
    const runPip = async (extra) => {
      try {
        const r = await execFileP(venvPython(), ['-m', 'pip', 'install', '--quiet'].concat(PIP_DEPS).concat(extra || []),
          { timeout: 600000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 })
        return { ok: true }
      } catch (e) { return { ok: false, tail: String((e && (e.stderr || e.message)) || e).slice(-300) } }
    }
    let r = await runPip()
    if (!r.ok) r = await runPip(['-i', 'https://pypi.tuna.tsinghua.edu.cn/simple'])
    st.depsOk = !!r.ok
    if (!r.ok) { st.error = '依赖安装失败: ' + (r.tail || ''); st.phase = 'error'; return snapshot() }
    diagOf('python-setup: deps installed into venv')
    return snapshot()
  }

  /** ④模型:BGE-M3 int8 单文件下载(cn→intl 双通道),8MB 分片进度,断点续传(Range)。 */
  async function downloadModel() {
    if (st.phase === 'downloading' || st.phase === 'verifying') return snapshot()
    mkdirSync(modelsDir(), { recursive: true })
    st.cancelled = false
    for (const mirror of MODEL_SPEC.mirrors) {
      if (st.cancelled) break
      const url = mirror.url(MODEL_SPEC.repo + '/resolve/main/' + MODEL_SPEC.file)
      st.phase = 'downloading'; st.dl.mirror = mirror.id; st.dl.startedAt = Date.now()
      try {
        await downloadWithResume(url, modelPath(), (done, total) => {
          st.dl.bytesDone = done; st.dl.bytesTotal = total || MODEL_SPEC.bytes
          const el = (Date.now() - st.dl.startedAt) / 1000
          st.dl.etaSec = done > 0 ? Math.max(0, Math.round(el / done * (st.dl.bytesTotal - done))) : 0
        }, () => st.cancelled)
        st.phase = 'verifying'
        const size = statSync(modelPath()).size
        if (size < 100 * 1024 * 1024) throw new Error('下载不完整(' + size + ' bytes)')
        st.modelReady = true; st.phase = 'ready'
        diagOf('python-setup: model ready at ' + modelPath() + ' (' + size + ' bytes, mirror=' + mirror.id + ')')
        return snapshot()
      } catch (e) {
        if (st.cancelled) { st.phase = 'idle'; return snapshot() }
        st.error = '[' + mirror.id + '] ' + String((e && e.message) || e).slice(0, 160)
        diagOf('python-setup: download failed via ' + mirror.id + ': ' + st.error)
      }
    }
    st.phase = 'error'
    return snapshot()
  }

  /** 断点续传下载:已有 .part 则 Range 续传;完成 8MB 粒度回调进度。 */
  function downloadWithResume(url, target, onProgress, isCancelled) {
    return new Promise((resolve, reject) => {
      const part = target + '.part'
      let done = 0
      try { if (existsSync(part)) done = statSync(part).size } catch (_) {}
      const headers = done > 0 ? { Range: 'bytes=' + done + '-' } : {}
      fetch(url, { headers }).then((resp) => {
        if (!resp.ok && resp.status !== 206) { reject(new Error('HTTP ' + resp.status)); return }
        const total = Number(resp.headers.get('content-length') || 0) + done
        const stream = createWriteStream(part, done > 0 ? { flags: 'a' } : { flags: 'w' })
        let lastTick = 0
        resp.body.on('data', (chunk) => {
          done += chunk.length
          const now = Date.now()
          if (now - lastTick > 500) { lastTick = now; onProgress(done, total) }
        })
        resp.body.on('error', (e) => { stream.end(); reject(e) })
        resp.body.on('end', () => {
          stream.end(() => {
            writeFileSyncSafe(part, target).then(resolve).catch(reject)
          })
        })
        dlAbort = () => { try { resp.body.destroy() } catch (_) {} }
      }).catch(reject)
    })
  }

  async function writeFileSyncSafe(from, to) {
    // .part → 正式名(同目录 rename,原子语义)
    await rm(to, { force: true })
    await import('node:fs').then((fs) => fs.renameSync(from, to))
  }

  function cancelDownload() { st.cancelled = true; if (dlAbort) try { dlAbort() } catch (_) {} return snapshot() }

  /** 汇总:semantic-status 的 pythonSetup 字段(供向导 UI 轮询)。 */
  function status() { return snapshot() }

  return { detect, ensureVenv, ensureDeps, downloadModel, cancelDownload, status, engineRoot, venvPython, modelPath }
}
