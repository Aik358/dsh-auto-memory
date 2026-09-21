/**
 * issue #105 回归锁：Python 档模型下载链路（lib/python-setup.js）。
 *
 * 缺陷形状（自 v2.1.5 起本档下载从未成功，且全仓零测试引用）：
 *   1. 对 `fetch` 返回的 WHATWG ReadableStream 调 `.on('data')` / `.destroy()`（Node 流才有的 API）
 *      ⇒ 同步 TypeError 被外层 `.catch(reject)` 吞成一句「下载失败」；
 *   2. 回调只累加字节数，全程没有 `stream.write()` ⇒ 即便修好 (1)，目标文件也必然 0 字节；
 *   3. 无条件 `flags:'a'` 往 `.part` 上追加 ⇒ 半截体/换源/服务端忽略 Range 都能拼出坏文件；
 *   4. 清单 sha256 留空、只比 size 下限，而模块头与 UI 按「SHA256 校验」叙述 ⇒ 从未真验过内容。
 *
 * 全程走本地 HTTP fixture（127.0.0.1 临时端口），不碰公网、不建 venv。
 * 运行：node tests/smoke/smoke-test-issue105-python-setup-download-pre.mjs
 */
import { createPythonSetupPre } from '../../lib/python-setup.js'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import http from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'

let pass = 0
let fail = 0
function ok(cond, name) {
  if (cond) { pass++; console.log('  ok - ' + name) } else { fail++; console.error('  FAIL - ' + name) }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---------- 夹具源 ----------
const LEN = 8192
const BODY = Buffer.from(Array.from({ length: LEN }, (_, i) => (i * 31 + 7) & 0xff))
const SHA = createHash('sha256').update(BODY).digest('hex')
const FILES = {
  'model.bin': BODY,
  'config.json': Buffer.from(JSON.stringify({ model_type: 'fixture' }), 'utf8'),
  'tokenizer.json': Buffer.from(JSON.stringify({ added_tokens: [] }), 'utf8'),
}
const REL = 'local/test-model/resolve/main/'

/** 本地源：默认按 Range 回 206；可切「忽略 Range 回 200 全量」「慢速分块」「篡改正文」。 */
function startOrigin() {
  const mode = { ignoreRange: false, slow: false, corrupt: false }
  const srv = http.createServer((req, res) => {
    const name = String(req.url).split('/resolve/main/')[1]
    let buf = FILES[name]
    if (!buf) { res.writeHead(404); res.end('no such file'); return }
    if (mode.corrupt && name === 'model.bin') {
      const t = Buffer.from('TAMPERED')
      buf = Buffer.concat([t, buf.slice(t.length)]) // **同长度**篡改 ⇒ 只有摘要能发现
    }
    const range = /^bytes=(\d+)-(\d*)$/.exec(String(req.headers.range || ''))
    if (range && !mode.ignoreRange) {
      const start = Math.min(Number(range[1]), buf.length)
      const end = range[2] ? Math.min(Number(range[2]), buf.length - 1) : buf.length - 1
      res.writeHead(206, { 'content-length': String(end - start + 1), 'content-range': 'bytes ' + start + '-' + end + '/' + buf.length })
      res.end(buf.slice(start, end + 1))
      return
    }
    res.writeHead(200, { 'content-length': String(buf.length) })
    if (!mode.slow) { res.end(buf); return }
    const step = Math.ceil(buf.length / 8)
    const tick = (i) => {
      if (res.destroyed || req.destroyed) return
      if (i >= buf.length) { res.end(); return }
      res.write(buf.slice(i, i + step))
      setTimeout(() => tick(i + step), 25)
    }
    tick(0)
  })
  return new Promise((resolve) => {
    srv.listen(0, '127.0.0.1', () => {
      resolve({
        mode,
        url: (p) => 'http://127.0.0.1:' + srv.address().port + '/' + p,
        modelUrl: REL + 'model.bin',
        close: () => new Promise((r) => srv.close(r)),
      })
    })
  })
}

function specOf(extra = {}) {
  return {
    repo: 'local/test-model', file: 'model.bin', bytes: LEN, sha256: SHA,
    mirrors: [{ id: 'local', url: (p) => origin.url(p) }],
    ...extra,
  }
}
const modelsOf = (s) => path.join(s.engineRoot(), 'models')
/** 造一个「上次中断留下的 .part」及其归属元数据（路径必须跟着清单落位名走）。 */
function plantPart(s, bytes, metaUrl) {
  mkdirSync(modelsOf(s), { recursive: true })
  const part = s.modelPath() + '.part'
  const url = String(metaUrl || '').startsWith('http') ? String(metaUrl) : origin.url(REL + 'model.bin')
  writeFileSync(part, bytes)
  writeFileSync(part + '.meta.json', JSON.stringify({ url, bytes: bytes.length, at: Date.now() }), 'utf8')
  return part
}

let origin
/** 造一个 setup：临时 dshHome + 注入本地源，diag 全部收进 diags 供断言。 */
const mkSetup = (home, diags = [], specExtra = {}) => createPythonSetupPre({
  dshHome: home, diag: (m) => diags.push(String(m)),
  modelSpec: specOf(specExtra), tokenizerFiles: ['config.json', 'tokenizer.json'],
})

async function main() {
  origin = await startOrigin()
  const home = mkdtempSync(path.join(tmpdir(), 'dam-pysetup-'))
  const fresh = () => { rmSync(home, { recursive: true, force: true }); mkdirSync(home, { recursive: true }) }

  console.log('[T1] 主路径：下载 + 逐项校验 + 就绪（旧实现在这里必然失败）')
  {
    fresh()
    const diags = []
    const s = mkSetup(home, diags)
    await s.downloadModel()
    const st = s.status()
    ok(st.phase === 'ready', 'phase=ready（旧实现：对 WHATWG 流调 .on() ⇒ TypeError ⇒ 逐镜像失败后 phase=error）')
    ok(st.modelReady === true, 'modelReady=true')
    ok(st.dl.bytesDone === LEN, `进度回调报告的是真实落盘字节数(${st.dl.bytesDone}/${LEN})`)
    ok(st.integrity === 'sha256', 'integrity=sha256（确实做了内容校验）')
    ok(st.integrityDetail['model.bin'] === 'sha256', '逐项明细：model.bin=sha256')
    ok(st.integrityDetail['config.json'] === 'size+json', 'tokenizer JSON 走「大小 + 可解析」校验')
    ok(st.error === '', '成功后清空历史 error（旧实现换镜像成功仍留着上一次失败文案）')
    ok(st.configOk === true, '模型齐备后回写 embedding-config（provider/modelDir/onnxFile/dimension）')
    ok(existsSync(path.join(home, 'memory', 'semantic', 'embedding-config.json')), 'embedding-config.json 落在 worker 真读的位置')
    ok(diags.every((d) => !/\[降级\]/.test(d)), '清单声明了 sha256 ⇒ 不打 [降级]')
  }

  console.log('[T2] 同长度篡改正文 ⇒ 只有摘要能发现，必须失败')
  {
    fresh()
    origin.mode.corrupt = true
    const s = mkSetup(home, [])
    await s.downloadModel()
    origin.mode.corrupt = false
    const st = s.status()
    ok(st.phase === 'error', 'phase=error（旧实现连大小都查不出：篡改是同长度的）')
    ok(/sha256 不符/.test(st.error), `错误含「sha256 不符」并带两侧前缀：${String(st.error).slice(0, 70)}`)
    ok(!st.modelReady, '坏文件不冒充就绪')
    ok(!existsSync(s.modelPath()), '★ 校验失败的产物被清除 —— detect() 只看存在性，留下坏正本会让下次启动误报「已就绪」')
    ok(!existsSync(path.join(modelsOf(s), 'config.json')), '配套的 tokenizer 一并清除，不留下「模型缺、tokenizer 在」的半套状态')
    const s2 = mkSetup(home, [])
    const d2 = await s2.detect()
    ok(!d2.modelReady, '★ 重新 detect 仍判未就绪（坏文件不会被当作已装好的资产喂给 worker）')
  }

  console.log('[T3] 清单未声明 sha256 ⇒ 如实标注 size-only 并打 [降级]')
  {
    fresh()
    const diags = []
    const s = mkSetup(home, diags, { sha256: '' })
    await s.downloadModel()
    const st = s.status()
    ok(st.phase === 'ready', 'size 精确匹配仍可就绪（不把「未声明摘要」当失败）')
    ok(st.integrity === 'size-only', 'integrity=size-only（不谎称验过内容）')
    ok(diags.some((d) => /\[降级\]/.test(d) && /未声明 sha256/.test(d)), 'diag 有「仅校验大小」的降级行')
  }

  console.log('[T4] 归属不明的 .part ⇒ 丢弃重下（旧实现 flags:a 直接拼接）')
  {
    fresh()
    const diags = []
    const s = mkSetup(home, diags)
    const part = plantPart(s, BODY.slice(0, 2048), 'http://elsewhere/model.bin')
    await s.downloadModel()
    const st = s.status()
    ok(st.phase === 'ready' && st.integrity === 'sha256', '外来 .part 被丢弃 ⇒ 正本字节数与摘要同时正确')
    ok(!existsSync(part), '外来 .part 不残留')
    ok(diags.some((d) => /\[降级\]/.test(d) && /不归属本 URL/.test(d)), '丢弃外来 .part 有 [降级] 留痕')
  }

  console.log('[T5] 服务端忽略 Range 回 200 全量 ⇒ 丢弃前缀重下，绝不拼坏')
  {
    fresh()
    const diags = []
    origin.mode.ignoreRange = true
    const s = mkSetup(home, diags)
    plantPart(s, BODY.slice(0, 2048)) // 归属**正确**，但服务端不肯按 Range 响应
    await s.downloadModel()
    origin.mode.ignoreRange = false
    const st = s.status()
    ok(st.phase === 'ready' && st.integrity === 'sha256', '正本 = 全长且过摘要校验（拼接体必然不过）')
    ok(diags.some((d) => /未按 Range 响应/.test(d)), '丢弃已取前缀有留痕')
  }

  console.log('[T6] 服务端按 206 续传 ⇒ 前缀复用，拼出正确内容并清掉归属元数据')
  {
    fresh()
    const s = mkSetup(home, [])
    const part = plantPart(s, BODY.slice(0, 3000))
    await s.downloadModel()
    const st = s.status()
    ok(st.phase === 'ready' && st.integrity === 'sha256', '真续传后 sha256 仍通过（前缀被正确复用而非重下）')
    ok(!existsSync(part) && !existsSync(part + '.meta.json'), '完成后 .part 与归属元数据都被清理')
  }

  console.log('[T7] 取消下载 ⇒ 不产出正本，保留 .part 与归属以便续传')
  {
    fresh()
    origin.mode.slow = true
    const s = mkSetup(home, [])
    const p = s.downloadModel()
    for (let i = 0; i < 200 && s.status().dl.bytesDone === 0; i++) await sleep(10)
    s.cancelDownload()
    await p
    const st = s.status()
    origin.mode.slow = false
    ok(st.phase === 'idle', '取消后 phase 回 idle（不是 error）')
    ok(!existsSync(s.modelPath()), '不产出正本 model.bin')
    ok(existsSync(s.modelPath() + '.part') && existsSync(s.modelPath() + '.part.meta.json'),
      '保留 .part 与归属元数据 ⇒ 下次可安全续传')
  }

  console.log('[T8] 结构守卫：不再把 WHATWG 流当 Node 流用')
  {
    const src = readFileSync(new URL('../../lib/python-setup.js', import.meta.url), 'utf8')
    ok(!/resp\.body\.on\(/.test(src), '★ 不再对 resp.body 调 .on(...)')
    ok(!/resp\.body\.destroy\(/.test(src), '★ 不再对 resp.body 调 .destroy()')
    ok(/Readable\.fromWeb\(resp\.body\)/.test(src) && /await pipeline\(src,/.test(src), 'WHATWG → Node 流走 fromWeb + pipeline（真写入）')
    ok(/new AbortController\(\)/.test(src) && /signal: ac\.signal/.test(src), '取消走 AbortController 且把 signal 透传给 fetch')
    ok(!/if \(size < 100 \* 1024 \* 1024\)/.test(src), '★ 旧的「100MB size 下限」不再是主校验')
    ok(/sha256/.test(src) && /createHash\('sha256'\)/.test(src), '摘要校验走**落盘文件回读**')
  }

  rmSync(home, { recursive: true, force: true })
  await origin.close()
  console.log('\n--- issue #105 回归锁 ---')
  console.log('pass=' + pass + ' fail=' + fail)
  process.exit(fail ? 1 : 0)
}

main().catch((e) => { console.error('[FATAL]', (e && (e.stack || e.message)) || e); process.exit(1) })
