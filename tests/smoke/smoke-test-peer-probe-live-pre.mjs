#!/usr/bin/env node
/** [peer-probe-live] 端到端:合成「发行包布局」目录树,peer 只装在 profile 根 node_modules
 * (issue 主场景),真实加载 @huggingface/transformers + e5-small q8 全链 rank。
 * 与 [peer-probe](离线布局矩阵)互补:那个验证 existsSync/resolve 的静态判定,这个验证
 * 「probe 说 ready → 引擎真的能推理」——即 semantic-status 就绪读数与实际加载能力同源。
 * 环境:peer 走 junction(无管理员权限可建),模型走 junction 指向开发树已验证资产。
 * 若本机无 trial peer/模型则 SKIP(可选档位设计,与 M80 同规)。 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, statSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { randomBytes } from 'node:crypto'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const LIB_SRC = path.resolve(HERE, '..', '..', 'lib')
const TRIAL = path.resolve(HERE, '..', '..', 'artifacts', 'm7-live-pre', 'js-semantic-trial')
const TRIAL_PEER = path.join(TRIAL, 'node_modules', '@huggingface', 'transformers')
const TRIAL_MODEL = path.join(TRIAL, 'models', 'multilingual-e5-small')

let pass = 0, fail = 0
const ok = (cond, name) => { if (cond) { pass++; console.log('  ok -', name) } else { fail++; console.log('  FAIL -', name) } }

if (!existsSync(TRIAL_PEER) || !existsSync(path.join(TRIAL_MODEL, 'onnx', 'model_quantized.onnx'))) {
  console.log('[peer-probe-live] SKIP: trial peer/model not present on this machine (optional tier)')
  process.exit(0)
}

process.env.TRANSFORMERS_OFFLINE = '1'
const root = mkdtempSync(path.join(tmpdir(), 'peer-probe-live-'))
const pkgDir = path.join(root, 'profiles', 'web', 'node_modules', '@a9i5k4', 'dsh-auto-memory')
const libDir = path.join(pkgDir, 'lib')
const rootPeer = path.join(root, 'profiles', 'web', 'node_modules', '@huggingface', 'transformers')

try {
  mkdirSync(libDir, { recursive: true })
  cpSync(LIB_SRC, libDir, { recursive: true }) // 发行布局:lib/ 平铺(含 semantic-js.js)
  mkdirSync(path.dirname(rootPeer), { recursive: true })
  symlinkSync(TRIAL_PEER, rootPeer, 'junction') // peer 只在 profile 根(hoisted 位)
  mkdirSync(path.join(libDir, 'models'), { recursive: true })
  symlinkSync(TRIAL_MODEL, path.join(libDir, 'models', 'multilingual-e5-small'), 'junction')

  console.log('[peer-probe-live] G1 共享 probe 在发行布局树下判就绪')
  const semMod = await import(pathToFileURL(path.join(libDir, 'semantic-js.js')).href)
  const probe = semMod.probeJsSemanticAssets(libDir)
  console.log('  resolved peer dir:', semMod.resolvePeerTransformersDir(libDir))
  ok(probe.peerPresent === true, 'peerPresent=true(仅 profile 根提升位在场)')
  ok(probe.assetPresent === true && probe.assetBytes === statSync(path.join(TRIAL_MODEL, 'onnx', 'model_quantized.onnx')).size,
    'assetPresent + 字节数与冻结清单一致(118308185)')
  ok(probe.ready === true, 'ready=true → resolveSemanticTier 应回 c2')

  console.log('[peer-probe-live] G2 引擎全链:裸 import 解析 peer → 真实加载 → 自检 → rank')
  const eng = semMod.createJsSemanticEnginePre({ pluginDir: libDir })
  const miv = 'idx_' + randomBytes(16).toString('hex')
  const r = await eng.rank({
    memoryIndexVersion: miv,
    records: [
      { memoryId: 'mem_gold', text: '## 测试条目D【关键词:琥珀协议】虚构决策「采用琥珀协议作为模块间通信格式」' },
      { memoryId: 'mem_echo', text: '今天天气不错，午饭吃的面条挺不错的。' },
    ],
  }, '之前关于琥珀协议的决策内容是什么？')
  ok(r !== null && String(r.miv) === miv, 'rank 返回且 miv 回传(未静默降级)')
  ok(r && r.scores instanceof Map && r.scores.has('mem_gold') && r.scores.has('mem_echo'), '双条目均有分数')
  ok(r && r.scores.get('mem_gold') > r.scores.get('mem_echo'), '语义排序正确:召回目标 > 生活流水回声')

  console.log('[peer-probe-live] G3 status 同源:tier 已真实加载、无 degraded')
  const st = eng.status()
  ok(st.ready === true && st.model === 'multilingual-e5-small/q8', 'status.ready + 模型/dtype 钉死')
  ok(!st.degraded, '无 degraded(加载链干净)')
} finally {
  try { rmSync(root, { recursive: true, force: true }) } catch (_) { /* tmp 清理尽力而为 */ }
}

console.log(`[peer-probe-live] pass=${pass} fail=${fail}`)
process.exit(fail ? 1 : 0)
