#!/usr/bin/env node
/** [peer-probe] semanticAssetProbe peer 探测布局矩阵(2026-09-02 issue 修正的回归守卫)。
 * 此前候选路径上溯层级错位(lib/ 被当包根算) → peerPresent 恒 false,发行布局下 C2 永远
 * 回退 c1。本套件在合成目录树里逐一复刻真实安装位并断言命中:
 *   A) pnpm hoisted:profile 根 node_modules(issue 主场景)
 *   B) 包内邻接:<pkg>/node_modules
 *   C) 完全缺失:fail closed 不误报
 *   D) lib/node_modules:issue 临时 junction 绕过位(向后兼容)
 * 命中判定走 realpathSync 归一(探测主路径 require.resolve 返回 realpath,静态兜底返回
 * 构造路径,两者在 8.3 短名/符号链接环境下字符串可能不同但语义相同)。
 * 全离线、零网络;stub 包只用于 existsSync/require.resolve 探测,不执行推理。 */
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const LIB_SRC = path.resolve(HERE, '..', '..', 'lib')
let pass = 0, fail = 0
const ok = (cond, name) => { if (cond) { pass++; console.log('  ok -', name) } else { fail++; console.log('  FAIL -', name) } }

// 共享实现直接从源码导入(与 index.js semanticAssetProbe 同一函数)
const semMod = await import(pathToFileURL(path.join(LIB_SRC, 'semantic-js.js')).href)
ok(typeof semMod.probeJsSemanticAssets === 'function' && typeof semMod.resolvePeerTransformersDir === 'function',
  'shared probe helpers exported')

const FAKE_ONNX = 'x'.repeat(1024)
const roots = []
const sameDir = (a, b) => { try { return realpathSync(a) === realpathSync(b) } catch (_) { return false } }
// 每组独立 mkdtemp(布局互不污染);realpathSync 归一根目录(本机 tmpdir() 返回 8.3 短名)
const freshRoot = () => { const r = realpathSync(mkdtempSync(path.join(tmpdir(), 'peer-probe-'))); roots.push(r); return r }
const stubTransformers = (dir) => {
  mkdirSync(path.join(dir, 'dist'), { recursive: true })
  writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: '@huggingface/transformers', version: '3.8.1', main: 'dist/transformers.js' }))
  writeFileSync(path.join(dir, 'dist', 'transformers.js'), 'export default {}\n')
}
const writeFile = (p, s) => { mkdirSync(path.dirname(p), { recursive: true }); writeFileSync(p, s) }

try {
  console.log('[peer-probe] G1 布局A:pnpm hoisted —— peer 在 profile 根 node_modules(issue 主场景)')
  {
    const root = freshRoot()
    const lib = path.join(root, 'profiles', 'web', 'node_modules', '@a9i5k4', 'dsh-auto-memory', 'lib')
    const realPeer = path.join(root, 'profiles', 'web', 'node_modules', '@huggingface', 'transformers')
    stubTransformers(realPeer)
    writeFile(path.join(lib, 'models', 'multilingual-e5-small', 'onnx', 'model_quantized.onnx'), FAKE_ONNX)
    const probe = semMod.probeJsSemanticAssets(lib)
    ok(probe.peerPresent === true, 'peerPresent=true(profile 根提升位命中)')
    ok(sameDir(semMod.resolvePeerTransformersDir(lib), realPeer), '命中目录=profile 根(不再是 node_modules/node_modules 错位)')
    ok(probe.assetPresent === true && probe.assetBytes === FAKE_ONNX.length, 'assetPresent + 字节数')
    ok(probe.ready === true, 'ready=true(资产+peer 齐备)')
    ok(JSON.stringify(Object.keys(probe).sort()) === JSON.stringify(['assetBytes', 'assetPath', 'assetPresent', 'peerPresent', 'ready']),
      '返回形状与 status API 契约一致')
  }

  console.log('[peer-probe] G2 布局B:包内邻接 —— peer 在 <pkg>/node_modules')
  {
    const root = freshRoot()
    const lib = path.join(root, 'profiles', 'web', 'node_modules', '@a9i5k4', 'dsh-auto-memory', 'lib')
    const realPeer = path.join(root, 'profiles', 'web', 'node_modules', '@a9i5k4', 'dsh-auto-memory', 'node_modules', '@huggingface', 'transformers')
    stubTransformers(realPeer)
    const probe = semMod.probeJsSemanticAssets(lib)
    ok(probe.peerPresent === true, 'peerPresent=true(包内邻接位命中)')
    ok(sameDir(semMod.resolvePeerTransformersDir(lib), realPeer), '命中目录=包内邻接位')
  }

  console.log('[peer-probe] G3 布局C:peer 完全缺失 —— fail closed')
  {
    // 注:合成树内无 peer 时要求 miss;若宿主机上层目录恰好有全局 transformers,标准解析
    // 命中属环境真实(引擎裸 import 同样会命中),此时本组会以 FAIL 提示环境噪音。
    const root = freshRoot()
    const lib = path.join(root, 'profiles', 'web', 'node_modules', '@a9i5k4', 'dsh-auto-memory', 'lib')
    mkdirSync(lib, { recursive: true })
    const probe = semMod.probeJsSemanticAssets(lib)
    ok(probe.peerPresent === false, 'peerPresent=false')
    ok(probe.ready === false, 'ready=false(不虚报就绪)')
    ok(semMod.resolvePeerTransformersDir(lib) === '', '解析返回空串')
  }

  console.log('[peer-probe] G4 布局D:lib/node_modules —— issue 临时 junction 绕过位向后兼容')
  {
    const root = freshRoot()
    const lib = path.join(root, 'profiles', 'web', 'node_modules', '@a9i5k4', 'dsh-auto-memory', 'lib')
    const realPeer = path.join(lib, 'node_modules', '@huggingface', 'transformers')
    stubTransformers(realPeer)
    const probe = semMod.probeJsSemanticAssets(lib)
    ok(probe.peerPresent === true, 'peerPresent=true(lib 邻接 junction 位仍命中)')
  }

  console.log('[peer-probe] G5 资产缺失但 peer 在场 —— ready=false 且不抛')
  {
    const root = freshRoot()
    const lib = path.join(root, 'nomodels', 'node_modules', '@a9i5k4', 'dsh-auto-memory', 'lib')
    stubTransformers(path.join(root, 'nomodels', 'node_modules', '@huggingface', 'transformers'))
    const probe = semMod.probeJsSemanticAssets(lib)
    ok(probe.assetPresent === false && probe.peerPresent === true && probe.ready === false, 'ready 只在双齐备时为 true')
  }

  console.log('[peer-probe] G6 旧错位路径负样本 —— 独立树里只有 node_modules/node_modules 时必须 miss')
  {
    const root = freshRoot()
    const bogus = path.join(root, 'profiles', 'web', 'node_modules', 'node_modules', '@huggingface', 'transformers')
    stubTransformers(bogus)
    const lib = path.join(root, 'profiles', 'web', 'node_modules', '@a9i5k4', 'dsh-auto-memory', 'lib')
    ok(semMod.resolvePeerTransformersDir(lib) === '', '错位双 node_modules 不参与命中(peerPresent 不再虚报)')
    ok(semMod.probeJsSemanticAssets(lib).peerPresent === false, 'probe fail closed')
  }

  console.log('[peer-probe] G7 深度扫描 —— 三落位命中 + profiles 枚举/直传两用 + 去重容错(0.1.37 semanticDeepDetect 底座)')
  {
    const root = freshRoot()
    const nm = path.join(root, 'profiles', 'web', 'node_modules')
    const plain = path.join(nm, '@huggingface', 'transformers')
    const vmHoist = path.join(nm, '.pnpm', 'node_modules', '@huggingface', 'transformers')
    const isoPkg = path.join(nm, '.pnpm', '@huggingface+transformers@3.8.1', 'node_modules', '@huggingface', 'transformers')
    stubTransformers(plain); stubTransformers(vmHoist); stubTransformers(isoPkg)
    // 直传 profiles 容器(真实用法:~/.dsh/profiles)→ 枚举一级子目录命中
    const viaContainer = semMod.deepScanPeerTransformers([path.join(root, 'profiles')])
    ok(viaContainer.length === 3, `profiles 容器枚举三落位全中(实际 ${viaContainer.length})`)
    // 直传 profile 根 → 自身 node_modules 命中
    const viaDirect = semMod.deepScanPeerTransformers([path.join(root, 'profiles', 'web')])
    ok(viaDirect.length === 3 && viaDirect.includes(plain) && viaDirect.includes(vmHoist) && viaDirect.includes(isoPkg), '直传 profile 根同样三落位全中')
    ok(semMod.deepScanPeerTransformers([]).length === 0 && semMod.deepScanPeerTransformers([path.join(root, 'nope')]).length === 0, '空根/不存在根安全返回空')
    ok(semMod.deepScanPeerTransformers('not-an-array').length === 0, '非法入参 fail closed')
  }

  console.log('[peer-probe] G8 extraDirs 热接入 —— 常规解析全 miss 时深扫位可兜底(命中即生效)')
  {
    const root = freshRoot()
    const lib = path.join(root, 'profiles', 'web', 'node_modules', '@a9i5k4', 'dsh-auto-memory', 'lib')
    const custom = path.join(root, 'somewhere-else', 'transformers')
    stubTransformers(custom)
    writeFile(path.join(lib, 'models', 'multilingual-e5-small', 'onnx', 'model_quantized.onnx'), FAKE_ONNX)
    ok(semMod.resolvePeerTransformersDir(lib) === '', '无 extraDirs 时 miss')
    const probe = semMod.probeJsSemanticAssets(lib, [custom])
    ok(probe.peerPresent === true && probe.ready === true, 'extraDirs 命中 → peerPresent/ready 即时翻真(热接入语义)')
    ok(sameDir(semMod.resolvePeerTransformersDir(lib, [custom]), custom), '命中目录=深扫位')
    ok(semMod.probeJsSemanticAssets(lib, ['', 123, null, custom]).ready === true, 'extraDirs 内非法项被跳过不误判')
  }
} finally {
  for (const r of roots) { try { rmSync(r, { recursive: true, force: true }) } catch (_) { /* tmp 清理尽力而为 */ } }
}

console.log(`[peer-probe] pass=${pass} fail=${fail}`)
process.exit(fail ? 1 : 0)
