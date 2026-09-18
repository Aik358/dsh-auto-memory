// 回归:下载器同一次 run 内的镜像重试必须从零开始。
// 旧实现:源 A 断流前已经 chunkBytes 刷盘留下半截文件,重试源 B 时 appendChunk 的
// flag:'a' 把源 B 续在半截后面,而 sha256 只对网络流累积(hash.update)→
// "半截源A+完整源B"拼接体校验照样通过并 rename 进 models(嵌入加载期才失败)。
import { mkdtempSync, rmSync, existsSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'

let pass = 0, fail = 0
function ok(cond, name) { if (cond) { pass++; console.log('  ok - ' + name) } else { fail++; console.error('  FAIL - ' + name) } }

const { createSemanticDownloaderPre, E5_SMALL_Q8_MANIFEST_V1 } = await import('../../lib/semantic-js.js')

const root = mkdtempSync(path.join(tmpdir(), 'dam-dl-'))
const SOURCE_B = Buffer.from('BBBBBBBB') // 8B 完整源 B
const fileRec = { ...E5_SMALL_Q8_MANIFEST_V1.files[0], bytes: 8, sha256: createHash('sha256').update(SOURCE_B).digest('hex') }
const manifest = { ...E5_SMALL_Q8_MANIFEST_V1, files: [fileRec], totalBytes: 8 }

// 源 A:先吐 4B(触发一次 chunkBytes=4 的刷盘,半截落盘),再断流;源 B:完整正确流
const streams = {
  a: async function* () { yield Buffer.from('AAAA'); throw new Error('net-reset') },
  b: async function* () { yield SOURCE_B },
}
let calls = 0
const fetchImpl = async () => {
  calls++
  const it = streams[calls === 1 ? 'a' : 'b']()
  return { ok: true, headers: { get: () => '8' }, body: { getReader: () => ({
    read: async () => { const r = await it.next(); return r.done ? { done: true } : { done: false, value: r.value } },
  }) } }
}

const dl = createSemanticDownloaderPre({
  modelsRoot: path.join(root, 'models'),
  manifest,
  fetchImpl,
  chunkBytes: 4, // 4B 即刷盘,确保源 A 的半截真的落了盘
})

dl.start('auto') // ['cn','intl'] 两镜像:第一次源 A 断流 → 重试源 B
const deadline = Date.now() + 5000
while (dl.state().phase !== 'done' && dl.state().phase !== 'error' && Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 20))
}

const finalPath = path.join(root, 'models', fileRec.rel)
ok(existsSync(finalPath), '文件落位 models')
const finalText = readFileSync(finalPath, 'utf8')
ok(finalText === SOURCE_B.toString('utf8'), '回归点:落位文件 = 完整源B 本身(无源A残留) got ' + JSON.stringify(finalText))
ok(statSync(finalPath).size === 8, '落位字节数 = 8 got ' + statSync(finalPath).size)
const st = dl.state()
ok(st.phase === 'done', 'phase=done got ' + st.phase)
ok(calls === 2, '镜像重试确实发生了 calls=' + calls)
ok(st.mirrorUsed === 'intl', 'mirrorUsed=第二源 got ' + st.mirrorUsed)
rmSync(root, { recursive: true, force: true })

console.log(`\n[downloader-fresh-attempt] ${pass}/${pass + fail} assertions passed`)
if (fail) process.exit(1)
