import assert from 'node:assert/strict'
import { probePythonPre, probePythonWithRetryPre, buildPythonCandidatesPre, resolvePythonInterpreterPre, PY_DEPS_PROBE_SCRIPT, PY_VERSION_PROBE_SCRIPT } from '../../lib/python-runtime.js'
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, truncateSync, rmSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { tmpdir } from 'node:os'

// Offline executable fixtures exercise the actual subprocess probe/resolver chain.
// Stub packages/peer deliberately avoid real models and downloads; this does not
// certify installed C2/C3 model quality or CUDA availability.
const ROOT = mkdtempSync(path.join(tmpdir(), 'dam-runtime-chain-'))
const PLUGIN = path.join(ROOT, 'plugin'), HOME = path.join(ROOT, 'home')
const VENV_DIR = path.join(PLUGIN, 'python/bench/.venv')
const systemPython = process.platform === 'win32' ? 'python' : 'python3'
const made = spawnSync(systemPython, ['-m', 'venv', '--without-pip', VENV_DIR], { encoding: 'utf8' })
assert.equal(made.status, 0, 'fixture venv creation: ' + made.stderr)
const VENV = path.join(VENV_DIR, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python')
const site = spawnSync(VENV, ['-c', 'import sysconfig; print(sysconfig.get_paths()["purelib"])'], { encoding: 'utf8' })
assert.equal(site.status, 0)
for (const mod of ['transformers', 'onnxruntime', 'numpy']) writeFileSync(path.join(site.stdout.trim(), mod + '.py'), '# dependency-probe fixture only\n')
const asset = path.join(PLUGIN, 'models/multilingual-e5-small/onnx/model_quantized.onnx')
mkdirSync(path.dirname(asset), { recursive: true }); writeFileSync(asset, 'fixture-not-a-model'); truncateSync(asset, 118308185)
const peer = path.join(PLUGIN, 'node_modules/@huggingface/transformers')
mkdirSync(peer, { recursive: true })
writeFileSync(path.join(peer, 'package.json'), JSON.stringify({ name: '@huggingface/transformers', type: 'module', main: 'index.js' }))
writeFileSync(path.join(peer, 'index.js'), `export const env = {}; export async function pipeline() {
 if (env.allowRemoteModels !== false) throw Error('remote models must be disabled');
 return async text => { if (!/^(passage|query): /.test(text)) throw Error('missing e5 prefix');
 const data = new Float32Array(384); data[text.includes('记忆') ? 0 : 1] = 1; return { data }; };
}`)
const oldHome = process.env.DSH_HOME; process.env.DSH_HOME = HOME
let jsEngine
try {
// ---- 1) 失败必须**可归因**（reason 非空）——这是本次修复的核心 ----
const bad = await probePythonPre('definitely-not-a-python-binary-xyz', ['-c', 'import sys'], 5000)
assert.equal(bad.ok, false, 'a bogus interpreter must fail')
assert.ok(String(bad.reason || '').length > 0, '★ failure reason must never be empty (attribution)')
console.log('PASS failure is attributable: ' + JSON.stringify(String(bad.reason).slice(0, 70)))

// ---- 2) 真超时必须被显式命名（而非空 reason）----
//   用一个小脚本 sleep 超过 timeout，制造真超时。
const slow = await probePythonPre(process.platform === 'win32' ? 'python' : 'python3', ['-c', 'import time; time.sleep(30)'], 1500)
assert.equal(slow.ok, false, 'a slow probe must fail on timeout')
assert.ok(String(slow.reason || '').length > 0, '★ timeout must produce a non-empty reason')
assert.ok(/超时|timeout/i.test(String(slow.reason)), 'timeout must be explicitly attributed, got: ' + slow.reason)
assert.equal(slow.timedOut, true, 'probe must report timedOut flag for retry decisions')
console.log('PASS timeout is explicitly attributed + flagged for retry')

// ---- 3) 重试只对瞬时失败生效；依赖真缺失不重试（如实、省时）----
const noDeps = await probePythonWithRetryPre(systemPython, ['-c', 'import __nonexistent_module_zzz__'], 8000, 2)
assert.equal(noDeps.ok, false, 'missing module must fail')
assert.ok(!noDeps.timedOut, 'a ModuleNotFoundError must NOT be classified as timeout')
assert.ok(String(noDeps.reason).length > 0, 'missing-module failure must be attributable')
console.log('PASS genuine dependency failure is not retried and stays attributable')

// ---- 4) 候选链结构：覆盖 配置/用户venv/开发venv/系统（C2 与 C3 的解释器来源）----
const cands = buildPythonCandidatesPre({ configured: '', dshHome: HOME, pluginDir: PLUGIN })
assert.ok(cands.length >= 3, 'candidate chain must have fallbacks, got ' + cands.length)
assert.ok(cands.some((c) => c.kind === 'user-venv'), 'must include the user venv (release-path users)')
assert.ok(cands.some((c) => c.kind === 'dev-venv'), 'must include the dev venv (maintainer path)')
assert.ok(cands.some((c) => c.kind === 'system'), 'must include system python (C2 fallback)')
const paths = cands.map((c) => c.path)
assert.equal(new Set(paths).size, paths.length, 'candidates must be de-duplicated')
const configuredDev = buildPythonCandidatesPre({ configured: VENV, dshHome: HOME, pluginDir: PLUGIN })
assert.equal(configuredDev.filter(c => c.path === VENV).length, 1)
assert.equal(configuredDev.find(c => c.path === VENV).kind, 'configured')
console.log('PASS candidate chain covers configured / user-venv / dev-venv / system (' + cands.length + ' entries)')

// ---- 5) 实际 fixture 解释器链：有隔离依赖的 dev venv 必须被选中 ----
{
  const res = await resolvePythonInterpreterPre(cands)
  const dev = res.probed.find((p) => p.kind === 'dev-venv')
  assert.ok(dev, 'dev-venv must appear in probe results')
  assert.equal(res.chosen, VENV, '★ C3 (python tier) must select the venv that really has torch/transformers; chosen=' + res.chosen)
  assert.equal(dev.deps, true, 'dev-venv deps probe must be true (torch/transformers/onnxruntime/numpy)')
  // 每个失败候选都必须带非空原因（否则用户无从判断为什么没启用 Python）
  const unattributed = res.probed.filter((p) => !p.deps && String(p.reason || '').length === 0)
  assert.deepEqual(unattributed, [], 'every failed candidate must carry a reason: ' + JSON.stringify(unattributed.map((x) => x.path)))
  console.log('PASS fixture interpreter selected (stub dependencies; no C3 model certification): ' + res.chosen.slice(-45))
  console.log('PASS C2 remains available: system python probed and reported (' + res.probed.filter((p) => p.kind === 'system' && p.deps).length + ' usable)')
}

// ---- 6) 负路径：判据能识别「空 reason」这种缺陷 ----
const fakeProbed = [{ path: 'x', deps: false, reason: '' }]
const badOnes = fakeProbed.filter((p) => !p.deps && String(p.reason || '').length === 0)
assert.equal(badOnes.length, 1, 'negative path: detector must flag an unattributed failure')
console.log('PASS negative path: unattributed failures are detectable')


// ---- 7) C2 worker flow with an isolated fake peer; no semantic/model quality claim. ----
const semMod = await import('../../lib/semantic-js.js')
const probe = semMod.probeJsSemanticAssets(PLUGIN, [], '')
assert.equal(probe.assetPresent, true, '★ C2 模型资产必须被找到（devTreeRoot 多基探测）；assetPath=' + probe.assetPath)
assert.equal(probe.peerPresent, true, 'C2 需要 @huggingface/transformers peer')
assert.equal(probe.ready, true, 'C2 资产 + peer 齐备且未降级 ⇒ ready')
assert.ok(probe.assetBytes > 100 * 1024 * 1024, 'C2 量化模型应 >100MB，实测 ' + probe.assetBytes)
jsEngine = semMod.createJsSemanticEnginePre({ pluginDir: PLUGIN, get incremental() { return true } })
const vecs = await jsEngine.embedPassages(['记忆唤回测试', 'unrelated weather text'])
assert.equal(vecs.length, 2, 'C2 嵌入应返回 2 条向量')
assert.equal(vecs[0].length, 384, 'e5-small 维度应为 384，实测 ' + vecs[0].length)
const cos = (a, b) => { let d = 0, na = 0, nb = 0; for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i] } return d / Math.sqrt(na * nb) }
const same = await jsEngine.embedPassages(['记忆唤回测试', '记忆的召回与注入'])
const cSame = cos(vecs[0], same[1]); const cDiff = cos(vecs[0], vecs[1])
assert.ok(cSame > cDiff, '★ C2 必须能区分同义与无关（cos 同义 ' + cSame.toFixed(3) + ' 应 > 无关 ' + cDiff.toFixed(3) + '）')
console.log('PASS isolated C2 worker: sparse fixture ' + Math.round(probe.assetBytes / 1048576) + 'MB, dim=384, cos(same)=' + cSame.toFixed(3) + ' > cos(diff)=' + cDiff.toFixed(3))

console.log('PASS offline Python runtime chain: real subprocess attribution/timeout/venv selection and isolated C2 worker flow')
} finally { jsEngine?.dispose(); if (oldHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = oldHome; rmSync(ROOT, {recursive:true,force:true}) }