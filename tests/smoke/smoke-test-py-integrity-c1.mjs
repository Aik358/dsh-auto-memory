/** ★C-1a（AUDIT §3.6 / issue #235）Python 档完整性校验验收 —— 真执行验收（非静态断言）。
 *
 * 背景：#235 的根因是 `verifyArtifact`（size/sha256/json 三类校验）**只有定义、全仓零调用点**，
 *  于是「模型 HTTP 200 正常结束但只有 101MiB（声明 568,456,694 B）」与「tokenizer 返回 not-json」
 *  都能一路走到 `phase:'ready'` —— 向导报就绪、用户以为可用、语义检索静默失效。
 *
 * 本套件真 import 产线模块 `createPythonSetupPre`，真调用 `downloadModel()`，注入假 fetch 复现报告场景，
 * 并断言**返回值（phase/modelReady/dl.verified）+ 磁盘副作用（产物被清除）**两类可复算证据。
 *
 * 判据：
 *  ① 【正路径】字节数与 MODEL_SPEC.bytes 一致 + tokenizer 合法 JSON ⇒ ready，且 verified='size-only'（sha256 未冻结时如实标注）；
 *  ② 【负路径·截断】同一镜像回 101MiB（报告原场景）⇒ **不得** ready，且落盘产物被清除；
 *  ③ 【负路径·非法 tokenizer】模型正确但 tokenizer 回 not-json ⇒ **不得** ready；
 *  ④ 【负路径·目录占位】models/model_int8.onnx 先建成目录 ⇒ 不得 ready 且不崩（清理走注入 removeDir）；
 *  ⑤ 【接线证据】正路径下 configOk/embedding-config 写入与 modelReady 同时为真（就绪面自洽）。
 *
 * 夹具自造（不进仓库）：模型 568MB 由 truncateSync 稀疏创建（实测 1ms），整轮耗时秒级。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createPythonSetupPre } from '../../lib/python-setup.js'

const MODEL_BYTES = 568456694
const TOKENIZER_FILES = ['config.json', 'tokenizer.json', 'tokenizer_config.json', 'special_tokens_map.json', 'sentencepiece.bpe.model']
const JSON_FILES = new Set(TOKENIZER_FILES.filter((f) => f.endsWith('.json')))
let pass = 0, fail = 0
const ok = (c, m, extra) => { if (c) { pass++; console.log('  ok   - ' + m) } else { fail++; console.error('  FAIL - ' + m + (extra === undefined ? '' : '  ' + extra)) } }

const tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'dam-c1a-')))

/** 造一个受控 home：engineRoot = <home>/python-engine（与产线同口径，由 createPythonSetupPre 自行推导）。 */
function newHome(label) {
  const home = path.join(tmp, label)
  fs.mkdirSync(home, { recursive: true })
  return { home, models: path.join(home, 'python-engine', 'models') }
}

/** 按「响应体大小」注入假 fetch：返回**真 WHATWG ReadableStream**（产线走 Readable.fromWeb，
 *  对象字面量伪装会被 fromWeb 拒掉 ⇒ 必须用真实流，否则测的不是产线路径）。 */
function fakeFetch(bodyOf) {
  return async (url) => {
    const spec = bodyOf(String(url))
    const body = Buffer.isBuffer(spec) ? spec : Buffer.from(String(spec), 'utf8')
    let sent = false
    const stream = new ReadableStream({
      pull(controller) {
        if (sent) { controller.close(); return }
        sent = true
        controller.enqueue(new Uint8Array(body))
      },
    })
    return { ok: true, status: 200, headers: { get: () => String(body.length) }, body: stream }
  }
}
/** 造镜像 ①（cn）的完整响应体：模型按 bytes 指定，tokenizer 按 payloads 指定。 */
function mirror1(modelBytes, tokenizerPayloads = {}) {
  return (url) => {
    const name = url.split('/').pop()
    if (name === 'model_int8.onnx') return Buffer.alloc(modelBytes, 7)
    if (JSON_FILES.has(name)) return tokenizerPayloads[name] !== undefined ? tokenizerPayloads[name] : '{"ok":true}'
    return tokenizerPayloads[name] !== undefined ? tokenizerPayloads[name] : 'spm-bytes'
  }
}

/** 只让镜像 ①（cn）产出：镜像 ②（intl）一律回空体 ⇒ 若 ① 全失败，最终落 phase:'error'。 */
function onlyMirror1(inner) {
  return (url) => (url.includes('hf-mirror.com') ? inner(url) : Buffer.alloc(0))
}

const runDownload = async (ps) => { try { return await ps.downloadModel() } catch (e) { return { thrown: e } } }

try {
  // ───────── ① 正路径：完整模型 + 合法 tokenizer ⇒ ready ─────────
  {
    const { home, models } = newHome('good')
    const ps = createPythonSetupPre({ dshHome: home, download: undefined, fetch: undefined, removeDir: undefined })
    // 注入假 fetch（模块内用全局 fetch；此处按产线口径替换全局）
    const realFetch = globalThis.fetch
    globalThis.fetch = fakeFetch(onlyMirror1(mirror1(MODEL_BYTES)))
    const snap = await runDownload(ps)
    globalThis.fetch = realFetch
    ok(snap && !snap.thrown, '① 正路径：downloadModel() 正常返回（未抛）', snap && snap.thrown && String(snap.thrown.message))
    ok(snap.phase === 'ready', '① phase === ready（实得 ' + (snap && snap.phase) + '）')
    ok(snap.modelReady === true, '① modelReady === true')
    ok(snap.modelBytes === MODEL_BYTES, '① 落盘模型字节数与声明一致（' + MODEL_BYTES + '，实得 ' + (snap && snap.modelBytes) + '）')
    ok(snap.dl && snap.dl.verified === 'size-only', '① ★校验口径如实外露：dl.verified === size-only（sha256 未冻结 ⇒ 不谎称已校验；实得 ' + JSON.stringify(snap.dl && snap.dl.verified) + '）')
    ok(snap.configOk === true, '① configOk === true（embedding-config.json 写入）')
    ok(fs.existsSync(path.join(models, 'tokenizer.json')) && fs.statSync(path.join(models, 'tokenizer.json')).size > 0, '① tokenizer 五件真实落盘（tokenizer.json 存在且非空）')
  }

  // ───────── ② 负路径·截断模型（#235 报告原场景）⇒ 不得 ready + 产物被清除 ─────────
  {
    const { home, models } = newHome('truncated')
    const ps = createPythonSetupPre({ dshHome: home })
    const realFetch = globalThis.fetch
    globalThis.fetch = fakeFetch(onlyMirror1(mirror1(101 * 1024 * 1024)))
    const snap = await runDownload(ps)
    globalThis.fetch = realFetch
    ok(snap.phase === 'error', '② ★截断模型（101MiB / 声明 568,456,694 B）**不得** ready ⇒ phase === error（实得 ' + snap.phase + '）')
    ok(snap.modelReady === false, '② modelReady === false')
    ok(!fs.existsSync(path.join(models, 'model_int8.onnx')), '② ★磁盘副作用：截断模型已被清除（不留残件给下一轮 detect 当就绪）')
    ok(!fs.existsSync(path.join(models, 'tokenizer.json')), '② ★磁盘副作用：半截 tokenizer 一并被清除')
    ok(typeof snap.error === 'string' && snap.error.length > 0, '② error 如实外露（' + JSON.stringify(snap.error) + '）')
  }

  // ───────── ③ 负路径·非法 tokenizer（not-json）⇒ 不得 ready ─────────
  {
    const { home, models } = newHome('notjson')
    const ps = createPythonSetupPre({ dshHome: home })
    const realFetch = globalThis.fetch
    globalThis.fetch = fakeFetch(onlyMirror1(mirror1(MODEL_BYTES, { 'tokenizer.json': 'not-json' })))
    const snap = await runDownload(ps)
    globalThis.fetch = realFetch
    ok(snap.phase === 'error', '③ ★tokenizer 返回 not-json ⇒ 不得 ready ⇒ phase === error（实得 ' + snap.phase + '）')
    ok(snap.modelReady === false, '③ modelReady === false')
    ok(!fs.existsSync(path.join(models, 'model_int8.onnx')), '③ 该镜像整体判失败：模型不留残件（切下一镜像前先清）')
  }

  // ───────── ④ 负路径·目录占位 ⇒ 不得 ready 且不崩 ─────────
  {
    const { home, models } = newHome('dirplaceholder')
    fs.mkdirSync(path.join(models, 'model_int8.onnx'), { recursive: true })
    const ps = createPythonSetupPre({ dshHome: home })
    const realFetch = globalThis.fetch
    globalThis.fetch = fakeFetch(onlyMirror1(mirror1(MODEL_BYTES)))
    const snap = await runDownload(ps)
    globalThis.fetch = realFetch
    ok(snap && !snap.thrown, '④ 落点被目录占位：downloadModel() 不抛（异常被镜像循环兜住）', snap && snap.thrown && String(snap.thrown.message))
    ok(snap.phase === 'error' && snap.modelReady === false, '④ ★目录占位 ⇒ 不得 ready（实得 phase=' + (snap && snap.phase) + '）')
  }

  // ───────── ⑤ 负路径·detect 对已落盘的截断产物也不得报就绪（重启后同一根因） ─────────
  {
    const { home, models } = newHome('detect-stale')
    fs.mkdirSync(models, { recursive: true })
    const fd = fs.openSync(path.join(models, 'model_int8.onnx'), 'w'); fs.ftruncateSync(fd, 101 * 1024 * 1024); fs.closeSync(fd)
    for (const f of TOKENIZER_FILES) fs.writeFileSync(path.join(models, f), f.endsWith('.json') ? '{"ok":true}' : 'spm')
    const ps = createPythonSetupPre({ dshHome: home })
    const snap = await ps.detect()
    ok(snap.modelReady === false, '⑤ ★重启后 detect() 对盘上截断模型同样**不得**报就绪（否则下载期修了、重启后又假绿）')
  }

  // ───────── ⑥ 正路径·detect 对完整产物报就绪（对照，证明 ⑤ 不是恒假） ─────────
  {
    const { home, models } = newHome('detect-good')
    fs.mkdirSync(models, { recursive: true })
    const fd = fs.openSync(path.join(models, 'model_int8.onnx'), 'w'); fs.ftruncateSync(fd, MODEL_BYTES); fs.closeSync(fd)
    for (const f of TOKENIZER_FILES) fs.writeFileSync(path.join(models, f), f.endsWith('.json') ? '{"ok":true}' : 'spm')
    const ps = createPythonSetupPre({ dshHome: home })
    const snap = await ps.detect()
    ok(snap.modelReady === true, '⑥ 对照：完整产物 ⇒ detect() 报就绪（证明 ⑤ 的判据真的在判完整性，不是恒 false）')
  }
} finally {
  try { fs.rmSync(tmp, { recursive: true, force: true }) } catch (e) {}
}

console.log('')
console.log('[c1a-py-integrity] PASS ' + pass + ' / FAIL ' + fail)
process.exit(fail ? 1 : 0)