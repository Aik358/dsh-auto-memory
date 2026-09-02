#!/usr/bin/env node
/** [fresh-download-verify] 新用户真实下载链路验证(0.1.37 发布前一次性实弹):
 * createSemanticDownloaderPre + 真实 fetch + cn 镜像(hf-mirror) → 五文件全量下载
 * (model_quantized.onnx 118MB + tokenizer.json 17MB + 3 小文件) → 逐文件 SHA256 对齐冻结清单。
 * 通过 = 新用户「首次打开→引擎下载→哈希校验→落位」整条链在当前网络环境下可用。 */
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const LIB = path.resolve(HERE, '..', '..', 'lib')
const semMod = await import(pathToFileURL(path.join(LIB, 'semantic-js.js')).href)
const manifest = semMod.E5_SMALL_Q8_MANIFEST_V1

if (process.env.RUN_LIVE_DOWNLOAD !== '1') {
  console.log('[fresh-download] SKIP: networked 135MB live download — set RUN_LIVE_DOWNLOAD=1 to run (kept out of routine regression loops)')
  process.exit(0)
}

let pass = 0, fail = 0
const ok = (cond, name) => { if (cond) { pass++; console.log('  ok -', name) } else { fail++; console.log('  FAIL -', name) } }

const modelsRoot = mkdtempSync(path.join(tmpdir(), 'fresh-dl-'))
const dl = semMod.createSemanticDownloaderPre({ modelsRoot })
const t0 = Date.now()
console.log(`[fresh-download] start: ${manifest.files.length} files, ${(manifest.totalBytes / 1048576).toFixed(1)} MB, mirror=cn(hf-mirror)`)

const startR = dl.start('cn')
ok(startR && startR.ok !== false, 'start() 接受 cn 镜像')

let lastPhase = ''
while (true) {
  const st = dl.state()
  if (st.phase !== lastPhase) { lastPhase = st.phase; console.log(`  phase → ${st.phase}${st.file ? ' [' + st.file + ']' : ''} ${st.bytesTotal ? Math.round(100 * st.bytesDone / st.bytesTotal) + '%' : ''}`) }
  if (st.phase === 'done' || st.phase === 'error' || st.phase === 'cancelled') break
  await new Promise((r) => setTimeout(r, 1000))
  if (Date.now() - t0 > 10 * 60 * 1000) { dl.cancel(); console.log('  TIMEOUT 10min → cancel'); break }
}

const final = dl.state()
console.log(`[fresh-download] final phase=${final.phase} mirror=${final.mirrorUsed || 'cn'} elapsed=${Math.round((Date.now() - t0) / 1000)}s error=${final.error || '-'}`)
ok(final.phase === 'done', '下载器终态=done')

for (const f of manifest.files) {
  const p = path.join(modelsRoot, f.rel)
  const present = existsSync(p)
  const bytes = present ? statSync(p).size : 0
  let sha = ''
  if (present) sha = createHash('sha256').update(await import('node:fs').then((m) => m.readFileSync(p))).digest('hex')
  ok(present && bytes === f.bytes, `${f.rel} 字节一致(${bytes}/${f.bytes})`)
  ok(sha === f.sha256, `${f.rel} SHA256 与冻结清单一致`)
}

try { rmSync(modelsRoot, { recursive: true, force: true }) } catch (_) {}
console.log(`[fresh-download] pass=${pass} fail=${fail}`)
process.exit(fail ? 1 : 0)
