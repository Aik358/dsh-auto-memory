import { memoryDir } from './datadir.js'
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
import { existsSync, mkdirSync, writeFileSync, readFileSync, statSync, createWriteStream, rmSync } from 'node:fs'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
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

/** worker 侧 load_embedder 的档位名(m7_embedding_v1.PROVIDER_REAL_INT8)。
 *  ★2026-09-28 去 pre 注记：该 id 内的 `-pre-v1` **刻意保留** —— 它是写入 embedding-config.json
 *  并与 worker 严格等值比较的档位标识（见 configReadyForModels），且存量用户配置里已是此值；
 *  改它会把老用户的「模型已就绪」判成 false。发布线自 2026-09-28 起不再折名（纯拷贝），保持原值。 */
const PROVIDER_ID_INT8 = 'bge-m3-onnx-int8-pre-v1'
/** dense 维度(BGE-M3 = 1024),写进 embedding-config.json 的 dimension。 */
const EMBED_DIMENSION = 1024

export function createPythonSetupPre(opts = {}) {
  const dshHomeOf = typeof opts.dshHome === 'function' ? opts.dshHome : () => opts.dshHome || path.join(homedir(), '.dsh')
  const diagOf = typeof opts.diag === 'function' ? opts.diag : () => {}
  // ★#264 OCR-02：**宿主生命周期准入**。卸载（`ctx.on('dispose')`）之后，已经进入路由
  //   handler、正卡在 `readJsonBody` 的迟到请求仍会继续往下走 —— 撤掉路由注册无法撤回已在途的
  //   请求。若此后仍开始一次 venv/pip 安装，会在插件已被释放的进程里**凭空长出子进程与磁盘写入**。
  //   故：本模块接受一个 `isLive` 回调（由 index.js 注入 `!engine._disposed`），在**每个操作受理时刻**
  //   复核一次；已受理且在途的安装不受影响（卸载不会把正在跑的 pip 腰斩），只拒绝**卸载之后新受理**的工作。
  const isLive = typeof opts.isLive === 'function' ? opts.isLive : () => true
  const assertAdmission = () => {
    if (!isLive()) throw Object.assign(new Error('plugin disposed'), { code: 'PLUGIN_DISPOSED' })
  }

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
  let activeOperation = ''
  const transfer = typeof opts.download === 'function' ? opts.download : downloadWithResume
  // ★issue #211：删除动作同样可注入（与 opts.download 同一形态）——测试能真造「删除失败」负路径，
  //   验证 uninstall 把错误**上抛**而不是静默吞掉。
  const removeDir = typeof opts.removeDir === 'function' ? opts.removeDir : (p) => rmSync(p, { recursive: true, force: true, maxRetries: 3, retryDelay: 120 })
  function exclusive(name, fn) {
    return async (...args) => {
      // ★#264：准入复核必须在**受理时刻**、且在互斥检查之前 —— 卸载后不得再启动任何安装工作。
      assertAdmission()
      if (activeOperation) return snapshot()
      activeOperation = name
      try { await fn(...args) } finally { activeOperation = '' }
      return snapshot()
    }
  }

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
  /** worker 读 <dsh-home>/memory/semantic/embedding-config.json(见 worker_semantic_v1.load_embedding_config_from_env)。
   *  ★2026-09-28 去 pre：发布线不再折名（纯拷贝），路径就是 `semantic`（无 -pre），与下方实现一致。
   *  历史缺陷（已修）：向导曾写缺 -pre 的路径而当时的 worker 只读带 -pre 的路径 → 装完即"找不到配置"。 */
  const embeddingConfigPath = () => path.join(memoryDir('semantic', dshHomeOf), 'embedding-config.json')

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
    // ★#235（C-1a）：detect 是**重启后发现残缺**的唯一入口，此前只看 existsSync ⇒ 截断体在重启后
    //   照样报「就绪」（与下载期同一根因，只修下载期属半修）。现复用同一组判据（模型精确 size +
    //   tokenizer 真 JSON）——任一件不合格即未就绪；异常一律吞成 false（detect 绝不抛）。
    st.modelReady = false
    try {
      if (existsSync(modelPath())) { await verifyArtifactsOnDisk(); st.modelReady = true }
    } catch (_) { st.modelReady = false }
    st.pythons = out
    st.phase = 'idle'
    return snapshot()
  }

  function snapshot() {
    return {
      phase: st.phase, error: st.error, activeOperation,
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
      st.phase = 'idle'
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
    st.phase = 'idle'
    diagOf('python-setup: deps installed into venv (gpu=' + wantGpu + ')')
    return snapshot()
  }

  /** ④模型:BGE-M3 int8 单文件下载(cn→intl 双通道),8MB 分片进度,断点续传(Range)。 */
  async function downloadModel() {
    if (st.phase === 'downloading' || st.phase === 'verifying') return snapshot()
    mkdirSync(modelsDir(), { recursive: true })
    st.cancelled = false; st.error = ''; st.dl.bytesDone = 0
    for (const mirror of MODEL_SPEC.mirrors) {
      if (st.cancelled) break
      const url = mirror.url(MODEL_SPEC.repo + '/resolve/main/' + MODEL_SPEC.file)
      st.phase = 'downloading'; st.dl.mirror = mirror.id; st.dl.startedAt = Date.now()
      try {
        await transfer(url, modelPath(), (done, total) => {
          st.dl.bytesDone = done; st.dl.bytesTotal = total || MODEL_SPEC.bytes
          const el = (Date.now() - st.dl.startedAt) / 1000
          st.dl.etaSec = done > 0 ? Math.max(0, Math.round(el / done * (st.dl.bytesTotal - done))) : 0
        }, () => st.cancelled)
        if (st.cancelled) { st.phase = 'idle'; return snapshot() }
        st.phase = 'verifying'
        const size = statSync(modelPath()).size
        // ★#235（C-1a）：下限只挡得住明显残缺，挡不住「200 正常结束 + 101MiB 的截断体」——
        //   下到不完整模型仍置 ready 正是该 issue 的根因。这里接上**已实现却零调用**的 verifyArtifact：
        //   模型按 MODEL_SPEC.bytes（568,456,694 B，声明值现成）精确比对；sha256 为空时它返回
        //   'size-only'，状态面据此如实标注「仅大小校验」，不谎称已做完整性校验。
        const modelVerify = await verifyArtifact(modelPath(), modelVerifySpec())
        // issue #28:补下 tokenizer 套件到同目录(缺任一文件即失败,走 catch → 下一镜像)
        for (const tf of TOKENIZER_FILES) {
          const tdest = path.join(modelsDir(), tf)
          const tu = mirror.url(MODEL_SPEC.repo + '/resolve/main/' + tf)
          await transfer(tu, tdest, () => {}, () => st.cancelled)
          // ★#235：not-json / 截断的 tokenizer 此前只查「文件在不在」⇒ 同样置 ready。
          //   文本件（config.json / tokenizer.json / *_map.json）必须真能 JSON.parse；
          //   sentencepiece.bpe.model 是二进制 SentencePiece 原型，不是 JSON ⇒ 只校验非空。
          await verifyArtifact(tdest, tokenizerVerifySpec(tf))
        }
        if (st.cancelled) { st.phase = 'idle'; return snapshot() }
        st.modelReady = true; st.phase = 'ready'; st.error = ''
        // ★#235：校验口径如实外露——sha256 未冻结时只能说 size-only，不写「已校验」。
        st.dl.verified = modelVerify
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
        diagOf('python-setup: model+tokens ready at ' + modelsDir() + ' (model=' + size + ' bytes, verify=' + modelVerify + ', mirror=' + mirror.id + ')')
        return snapshot()
      } catch (e) {
        if (st.cancelled) { st.phase = 'idle'; return snapshot() }
        st.error = '[' + mirror.id + '] ' + String((e && e.message) || e).slice(0, 160)
        diagOf('python-setup: download failed via ' + mirror.id + ': ' + st.error)
        // ★#235 负路径纪律：完整性校验失败必须**清除正式产物**（截断的 onnx / 半截的 tokenizer
        //   都不是可用件）；否则失败残留会在下一轮 detect() 里被 existsSync 当成已就绪。
        //   走注入的 removeDir（默认递归 + force）：对「落点被目录占位」这类异常也不抛，
        //   单个失败不影响其余清理与整体判定（fail-closed：清不掉也绝不置 ready）。
        for (const p of [modelPath()].concat(TOKENIZER_FILES.map((f) => path.join(modelsDir(), f)))) {
          try { removeDir(p) } catch (_) {}
        }
        st.modelReady = false
      }
    }
    st.phase = st.cancelled ? 'idle' : 'error'
    return snapshot()
  }

  /**
   * 断点续传下载（issue #105 重写）。旧实现有三处各自足以致命的点：
   *
   * 1. 对 `fetch` 返回的 **WHATWG** `ReadableStream` 调 `.on('data')` / `.destroy()`（那是 Node 流的
   *    API）⇒ 同步 TypeError 被外层 `.catch(reject)` 吞成一句「下载失败」。**自 v2.1.5 起本档下载从未成功。**
   * 2. 回调里只累加 `done`，**全程没有 `stream.write()`** ⇒ 即便修好 (1)，目标文件也必然 0 字节。
   * 3. 无条件 `flags:'a'` 往 `.part` 上追加：既不校验这块 `.part` 属于哪个 URL，也不看服务端是否
   *    真按 Range 响应 ⇒ 换镜像或服务端忽略 Range 回全量时，两次不同的响应体被拼成同一个文件。
   *
   * 现：`Readable.fromWeb` + `pipeline` 真写入；`.part.meta.json` 记归属（url + 已取字节）；未按 206
   * 续传就丢弃重来；取消走 AbortController（同时传给 `fetch`，断的是连接而不只是本地流）。
   */
  async function downloadWithResume(url, target, onProgress, isCancelled) {
    const part = target + '.part'
    const metaPath = part + '.meta.json'
    const bytesOnDisk = () => { try { return existsSync(part) ? statSync(part).size : 0 } catch (_) { return 0 } }
    const saveMeta = (bytes) => { try { writeFileSync(metaPath, JSON.stringify({ url, bytes, at: Date.now() }), 'utf8') } catch (_) {} }
    const dropPart = () => { try { rmSync(part, { force: true }) } catch (_) {} try { rmSync(metaPath, { force: true }) } catch (_) {} }

    let done = bytesOnDisk()
    if (done > 0) {
      let prevMeta = null
      try { prevMeta = JSON.parse(readFileSync(metaPath, 'utf8')) } catch (_) {}
      const mine = !!prevMeta && prevMeta.url === url && Number(prevMeta.bytes) === done
      if (!mine) {
        diagOf('[降级] python-setup: .part 不归属本 URL(或缺归属记录)，丢弃 ' + done + ' 字节重下 —— ' + path.basename(target))
        dropPart()
        done = 0
      }
    }
    const ac = new AbortController()
    let aborted = false
    dlAbort = () => { aborted = true; try { ac.abort() } catch (_) {} }
    try {
      let resp = await fetch(url, { headers: done > 0 ? { Range: 'bytes=' + done + '-' } : {}, signal: ac.signal })
      if (done > 0 && resp.status !== 206) {
        // 服务端没理 Range（多半回 200 全量）⇒ 追加必然拼出坏文件。丢弃重来，不赌它的内容。
        diagOf('[降级] python-setup: 服务端未按 Range 响应(status=' + resp.status + ')，丢弃 ' + done + ' 字节 .part 重下')
        dropPart()
        done = 0
        resp = await fetch(url, { headers: {}, signal: ac.signal })
      }
      if (!resp.ok && resp.status !== 206) throw new Error('HTTP ' + resp.status)
      const resumeFrom = done
      const total = Number(resp.headers.get('content-length') || 0) + resumeFrom
      let lastTick = 0
      const src = Readable.fromWeb(resp.body)
      src.on('data', (chunk) => {
        done += chunk.length
        const now = Date.now()
        if (now - lastTick > 500) { lastTick = now; onProgress(done, total) }
        if (!aborted && typeof isCancelled === 'function' && isCancelled()) { aborted = true; try { ac.abort() } catch (_) {} }
      })
      await pipeline(src, createWriteStream(part, { flags: resumeFrom > 0 ? 'a' : 'w' }))
      onProgress(done, total)
      try { rmSync(metaPath, { force: true }) } catch (_) {}
      await writeFileSyncSafe(part, target)
      return done
    } catch (e) {
      if (aborted || (e && e.name === 'AbortError')) {
        saveMeta(bytesOnDisk()) // 取消：保留 .part 与归属，下次可续传
        const err = new Error('已取消'); err.cancelled = true
        throw err
      }
      saveMeta(bytesOnDisk()) // 网络/写盘中断：同样记下归属，避免下次把半截体当可续传块盲拼
      const err = new Error('下载失败(' + ((e && (e.name || 'Error')) || 'Error') + '): ' + String((e && e.message) || e).slice(0, 160))
      err.cause = e
      throw err
    } finally {
      dlAbort = null
    }
  }

  /**
   * 完整性校验（issue #105）。声明了 sha256 才真验，且**回读落盘文件**而非累计网络流——
   * `lib/semantic-js.js:455-459` 记过同族事故：对网络流累积哈希 ⇒ 拼接出来的坏文件照样通过校验。
   * 未声明 sha256 时不谎称验过：返回 `'size-only'`，由调用方打 `[降级]` 并如实暴露到状态面。
   *
   * ★#235（C-1a）归因：本函数此前**只有定义、零调用点**（全仓仅此一处出现）——
   *   于是「模型 200 正常结束 + 101MiB」与「tokenizer 返回 not-json」都能一路走到 phase:'ready'。
   *   现由 downloadModel 两处接线：①模型按 MODEL_SPEC.bytes 精确比对；②tokenizer 文本件真 JSON.parse。
   *   负路径保持 fail-closed：抛出的错误带 integrityFailure 标记，由 downloadModel 的 catch 接住 ⇒
   *   该镜像整体判失败并切下一镜像；所有镜像都失败才落 phase:'error'（绝不置 ready）。
   *   sha256 为空（MODEL_SPEC.sha256 尚未冻结）⇒ 只做 size 校验并返回 'size-only'，
   *   状态面 dl.verified 如实显示口径；完整性口径升级只需填 MODEL_SPEC.sha256，无需改接线。
   */

  async function verifyArtifact(file, spec = {}) {
    // 校验失败单独打标：调用方据此**清除正式产物**（见 downloadModel 的 catch）。
    const bad = (msg) => { const err = new Error(msg); err.integrityFailure = true; return err }
    const size = statSync(file).size
    const expected = Number(spec.bytes)
    if (expected > 0) {
      if (size !== expected) throw bad('大小不符(' + size + ' ≠ ' + expected + ' bytes): ' + path.basename(file))
    } else if (spec.minBytes > 0 && size < spec.minBytes) {
      throw bad('下载不完整(' + size + ' < ' + spec.minBytes + ' bytes): ' + path.basename(file))
    }
    const want = typeof spec.sha256 === 'string' ? spec.sha256 : ''
    if (want.length > 0) {
      const h = createHash('sha256')
      await new Promise((res, rej) => {
        const s = createReadStream(file)
        s.on('data', (c) => h.update(c))
        s.on('error', rej)
        s.on('end', res)
      })
      const got = h.digest('hex')
      if (got !== want) throw bad('sha256 不符(期望 ' + want.slice(0, 12) + '…, 实得 ' + got.slice(0, 12) + '…): ' + path.basename(file))
      return 'sha256'
    }
    if (spec.kind === 'json') {
      try { JSON.parse(readFileSync(file, 'utf8')) } catch (_) { throw bad('JSON 解析失败: ' + path.basename(file)) }
      return 'size+json'
    }
    return 'size-only'
  }

  /** 完整性判据的**单一来源**：downloadModel（下载期逐件）与 detect（重启后发现残缺）共用同一组 spec，
   *  杜绝「同一语义两份判据」——那样改一处即半修（本仓已两次命中该失效型态）。
   *  ★#235（C-1a）：模型按 MODEL_SPEC.bytes 精确比对；tokenizer 文本件真 JSON.parse（not-json 必须被拒），
   *  sentencepiece.bpe.model 是二进制 SentencePiece 原型（非 JSON）⇒ 只校验非空。 */
  const modelVerifySpec = () => ({ bytes: MODEL_SPEC.bytes })
  const tokenizerVerifySpec = (f) => (f.endsWith('.json') ? { kind: 'json', minBytes: 2 } : { minBytes: 2 })

  /** 逐件校验**已在盘上**的模型与 tokenizer（detect 用）。任一件不合格即抛（调用方判为未就绪）。 */
  async function verifyArtifactsOnDisk() {
    await verifyArtifact(modelPath(), modelVerifySpec())
    for (const tf of TOKENIZER_FILES) await verifyArtifact(path.join(modelsDir(), tf), tokenizerVerifySpec(tf))
  }


  async function writeFileSyncSafe(from, to) {
    // .part → 正式名(同目录 rename,原子语义)
    await rm(to, { force: true })
    await import('node:fs').then((fs) => fs.renameSync(from, to))
  }

  function cancelDownload() { st.cancelled = true; if (dlAbort) try { dlAbort() } catch (_) {} return snapshot() }

  /**
   * ⑤uninstall —删除 `<userDir>/python-engine` 整目录（venv 与 models 一并回收）。
   *   ★issue #211：合计约 850MB 的自动 provision 必须有一条**用户可自己走**的回收路径。
   *   - 存在性检查：目录不在时幂等返回 `removed:false`，不报错；
   *   - 错误上抛：删除失败（Windows 文件占用等）由调用方收到 500 与真实原因，绝不静默吞；
   *   - 与开关解耦：路径显式传入，**禁用状态下也可用**（清理磁盘占用不该被档位开关拦住）；
   *   - 只删引擎根目录，不碰 `memory/semantic/embedding-config.json` 等用户数据。
   */
  function uninstall() {
    // ★#264：卸载动作同样过准入门 —— 插件已释放时不得再进文件系统。
    assertAdmission()
    // ★issue #211：**不走 exclusive 包装** —— 它按设计把返回值统一换成 snapshot()，
    //   会把 removed/root 吃掉（且改成 async 后路由侧会写空对象）。这里自己做互斥检查，
    //   返回「快照 + 本次结果」，路由与前端都能看到 removed / root。
    if (activeOperation) throw new Error('正有安装/下载操作进行中（' + activeOperation + '），请先取消后再卸载。')
    activeOperation = 'uninstall'
    try {
      return uninstallInner()
    } finally { activeOperation = '' }
  }

  function uninstallInner() {
    const root = engineRoot()
    const existed = existsSync(root)
    if (existed) {
      removeDir(root)
      if (existsSync(root)) throw new Error('卸载失败:目录仍然存在 ' + root)
    }
    // 内存态复位:删除后 detect()/status() 必须如实反映"未安装",不残留上一轮的 ready 读数
    st.venvOk = false; st.depsOk = false; st.configOk = false; st.modelReady = false
    st.phase = 'idle'; st.error = ''; st.dl.bytesDone = 0
    diagOf('python-setup: uninstall ' + (existed ? 'removed ' + root : 'no-op (absent) ' + root))
    return Object.assign(snapshot(), { removed: existed, root })
  }

  /** 汇总:semantic-status 的 pythonSetup 字段(供向导 UI 轮询)。 */
  function status() { return snapshot() }

  return { detect: exclusive('detect', detect), ensureVenv: exclusive('venv', ensureVenv), ensureDeps: exclusive('deps', ensureDeps), downloadModel: exclusive('model', downloadModel), uninstall, cancelDownload, status, engineRoot, venvPython, modelPath }
}
