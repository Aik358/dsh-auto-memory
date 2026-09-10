/**
 * M7.6 Python 一键向导(host 半):#16-#20 配套——把 C3 进阶档从"开发机可达"变成"爱好者可达"。
 *
 * 四步链路(全部走本模块,UI 只管展示状态与点击):
 *   ①detect  — 探测系统 Python(≥3.9)/既有 venv/模型本体;全部只读。
 *   ②venv    — python -m venv <userDir>/python-engine/.venv(幂等:已存在直接跳过)。
 *   ③deps    — venv 内 pip 安装运行依赖(transformers/onnxruntime,清华镜像兜底;int8 档不需要 torch)。
 *   ④model   — BGE-M3 int8(~539MB)下载到 <userDir>/python-engine/models/,
 *              cn(hf-mirror)/intl(hf 官方)双通道+SHA256 校验,复用 JS 档下载器的状态机形态。
 *   ④'       — 模型齐备后**必须回写 embedding-config.json**(provider/modelDir/onnxFile/dimension),
 *              否则 worker load_embedder 抛 unknown embedding provider —— 这是"装了用不了"的头号断点。
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
import { existsSync, mkdirSync, writeFileSync, readFileSync, statSync, createWriteStream } from 'node:fs'
import { readFile, writeFile, rm } from 'node:fs/promises'

const execFileP = promisify(execFile)

/** BGE-M3 int8 单文件(与 bench 夹具同源;hf-mirror 为主源,HF 官方为备源)。
 * 2026-09-09 修复(issue #27):repo 原为 'Xenova/bge-m3-int8'(仓库不存在→HF 恒 401),正确仓库名是 'Xenova/bge-m3';
 * INT8 量化文件 = onnx/model_int8.onnx(568,456,694 字节,仓库清单已确认存在;fp16/q4/uint8 等非本档目标)。 */
const MODEL_SPEC = {
  repo: 'Xenova/bge-m3',
  file: 'onnx/model_int8.onnx',
  bytes: 568456694,
  sha256: '', // 见 MODEL_SHA256:远端 LFS 校验不可靠时以 size 下限+可执行性兜底;sha256 由首版发布冻结后填入
  mirrors: [
    { id: 'cn', url: (p) => 'https://hf-mirror.com/' + p },
    { id: 'intl', url: (p) => 'https://huggingface.co/' + p },
  ],
}

/** issue #28:AutoTokenizer.from_pretrained(modelDir) 需要完整 tokenizer 套件,HF_HUB_OFFLINE=1 时 transformers
 * 无法运行时补拉。5 文件均已确认存在于 Xenova/bge-m3 仓库根,与 model_int8.onnx 同目录下载。 */
const TOKENIZER_FILES = ['config.json', 'tokenizer.json', 'tokenizer_config.json', 'special_tokens_map.json', 'sentencepiece.bpe.model']

/** venv 内 pip 依赖:#19 实测(int8 档 encode_ids 全程 numpy+onnxruntime,tokenizer 走 Rust 快速路径)——基础集无 torch,venv 体积 ~400MB。GPU 推理开关追加 onnxruntime-gpu(CUDAExecutionProvider)。池化/精度契约冻结自 R@5 0.925 基线,fastembed 注册表无 BGE-M3 且池化契约不同,不可用。 */
const PIP_DEPS_CPU = ['transformers', 'onnxruntime']
const PIP_DEPS_GPU_EXTRA = ['onnxruntime-gpu']

/** 探针要与安装清单**同口径**:int8 档 load_embedder 只 import numpy+onnxruntime+transformers;
 *  历史上探针多要一个 torch,而 PIP_DEPS_CPU 从不装 torch → depsOk 恒 false,"全部就绪"永不出现。 */
const DEPS_PROBE = 'import transformers, onnxruntime, numpy; print("deps-ok")'

/** worker 侧 load_embedder 的档位名(m7_embedding_v1.PROVIDER_REAL_INT8);发布构建会把 -pre-v1 折成 -v1。 */
const PROVIDER_ID_INT8 = 'bge-m3-onnx-int8-v1'
/** dense 维度(BGE-M3 = 1024),写进 embedding-config.json 的 dimension。 */
const EMBED_DIMENSION = 1024

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
    configOk: false,
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

  // ---------- 引擎侧 embedding-config.json(D1/D2:向导产物必须落在 worker 真正读取的位置与键上) ----------
  /** worker 读 <dsh-home>/memory/semantic/embedding-config.json(见 worker_semantic_v1.load_embedding_config_from_env);
   *  发布构建会把 `semantic` 折成 `semantic`,故这里写带 -pre 的规范名。
   *  历史缺陷:向导曾写 <dsh-home>/memory/semantic/(缺 -pre),pre 线 worker 从不读该路径 → 装完即"找不到配置"。 */
  const embeddingConfigPath = () => path.join(dshHomeOf(), 'memory', 'semantic', 'embedding-config.json')

  /** read-modify-write:只覆盖本次传入的键,保留引擎运行期自管的 search/activationPolicy/activationEmitMode 等。 */
  async function patchEmbeddingConfig(patch) {
    const cfgPath = embeddingConfigPath()
    mkdirSync(path.dirname(cfgPath), { recursive: true })
    let cfg = {}
    try { cfg = JSON.parse(await readFile(cfgPath, 'utf8')) } catch (_) {}
    if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) cfg = {}
    Object.assign(cfg, patch)
    await writeFile(cfgPath, JSON.stringify(cfg, null, 2), 'utf8')
    return cfgPath
  }

/** 就绪口径(D4):配置声明的 provider/modelDir 必须指向磁盘上真实存在的 onnx + tokenizer;
 *  只看"onnx 已下载"会给出假绿 —— worker 起来照样抛 unknown embedding provider / KeyError modelDir。
 *  注意与下载清单 TOKENIZER_FILES 的区别:那是"下全"的清单(slow/fast 两条路径都覆盖),
 *  这里判的是**能否加载** —— AutoTokenizer 默认 fast 路径有 tokenizer.json 即可,缺 sentencepiece.bpe.model 不算坏。 */
function configReadyForModels() {
  try {
    const cfg = JSON.parse(readFileSync(embeddingConfigPath(), 'utf8'))
    if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) return false
    if (String(cfg.provider || '') !== PROVIDER_ID_INT8) return false
    const base = String(cfg.modelDir || '').trim()
    if (!base) return false
    const rel = String(cfg.onnxFile || 'onnx/model_int8.onnx')
    if (!existsSync(path.join(base, ...rel.split('/')))) return false
    const hasTokenizer = ['tokenizer.json', 'sentencepiece.bpe.model'].some((f) => existsSync(path.join(base, f)))
    if (!hasTokenizer) return false
    return ['config.json', 'tokenizer_config.json'].every((f) => existsSync(path.join(base, f)))
  } catch (_) { return false }
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
    st.depsOk = st.venvOk ? (await probe(venvPython(), ['-c', DEPS_PROBE])).ok : false
    st.configOk = configReadyForModels()
    // modelReady 判定(2026-09-09):onnx + tokenizer 5 件全齐才算就绪,避免 UI 显示 ✓ 但 sidecar 起不来
    st.modelReady = existsSync(modelPath()) && TOKENIZER_FILES.every((f) => existsSync(path.join(modelsDir(), f)))
    st.pythons = out
    st.phase = 'idle'
    return snapshot()
  }

  function snapshot() {
    return {
      phase: st.phase, error: st.error,
      pythons: st.pythons, chosenPython: st.chosenPython,
      venvOk: st.venvOk, depsOk: st.depsOk, configOk: st.configOk, modelReady: st.modelReady, wantGpu: !!st.wantGpu,
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

  /** ③deps:venv 内 pip 装 transformers+onnxruntime(CPU 基础集);opts.gpu=true 追加 onnxruntime-gpu(用户选 GPU 推理时)。官方源失败切清华镜像。 */
  async function ensureDeps(opts2) {
    const wantGpu = !!(opts2 && opts2.gpu)
    if (!st.venvOk) { st.error = 'venv 未就绪,先执行 venv 步骤'; st.phase = 'error'; return snapshot() }
    st.phase = 'deps'
    st.wantGpu = wantGpu
    const deps = PIP_DEPS_CPU.concat(wantGpu ? PIP_DEPS_GPU_EXTRA : [])
    const runPip = async (extra) => {
      try {
        const r = await execFileP(venvPython(), ['-m', 'pip', 'install', '--quiet'].concat(deps).concat(extra || []),
          { timeout: 900000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 })
        return { ok: true }
      } catch (e) { return { ok: false, tail: String((e && (e.stderr || e.message)) || e).slice(-300) } }
    }
    let r = await runPip()
    if (!r.ok) r = await runPip(['-i', 'https://pypi.tuna.tsinghua.edu.cn/simple'])
    st.depsOk = !!r.ok
    if (!r.ok) { st.error = '依赖安装失败: ' + (r.tail || ''); st.phase = 'error'; return snapshot() }
    // GPU 偏好写入 embedding-config.json(worker 读 config['gpu'] 选 CUDA/CPU provider;read-modify-write 不覆盖既有键)
    try { await patchEmbeddingConfig({ gpu: wantGpu }) } catch (eCfg) { diagOf('python-setup: gpu pref write failed: ' + String(eCfg && eCfg.message || eCfg)) }
    diagOf('python-setup: deps installed into venv (gpu=' + wantGpu + ')')
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
        // issue #28:补下 tokenizer 套件到同目录(缺任一文件即失败,走 catch → 下一镜像)
        for (const tf of TOKENIZER_FILES) {
          const tu = mirror.url(MODEL_SPEC.repo + '/resolve/main/' + tf)
          await downloadWithResume(tu, path.join(modelsDir(), tf), () => {}, () => st.cancelled)
        }
        st.modelReady = true; st.phase = 'ready'
        // D1/D2:模型齐备后把**引擎消费所需的键**写全 —— provider(否则 load_embedder 抛 unknown embedding provider)、
        // modelDir(否则 KeyError)、onnxFile(落位是平铺 models/model_int8.onnx,而 worker 默认找 modelDir/onnx/model_int8.onnx)、
        // dimension(向量 identity 块)。tokenizer 五件与 onnx 同在 modelDir 根,AutoTokenizer.from_pretrained(modelDir) 因此可用。
        try {
          await patchEmbeddingConfig({
            provider: PROVIDER_ID_INT8,
            modelDir: modelsDir().replace(/\\/g, '/'),
            onnxFile: path.basename(MODEL_SPEC.file),
            dimension: EMBED_DIMENSION,
          })
          st.configOk = true
        } catch (eCfg) { diagOf('python-setup: embedding-config write failed: ' + String(eCfg && eCfg.message || eCfg)) }
        diagOf('python-setup: model+tokens ready at ' + modelsDir() + ' (model=' + size + ' bytes, mirror=' + mirror.id + ')')
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
