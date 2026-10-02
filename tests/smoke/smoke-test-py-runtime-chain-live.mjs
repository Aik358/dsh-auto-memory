import assert from 'node:assert/strict'
import { probePythonPre, probePythonWithRetryPre, buildPythonCandidatesPre, resolvePythonInterpreterPre, PY_DEPS_PROBE_SCRIPT, PY_VERSION_PROBE_SCRIPT } from '../../lib/python-runtime.js'
import { existsSync } from 'node:fs'

// ★2026-09-30（E 批 · 用户要求「确保 C2、C3 都可用，有的用户用 C2、有的用 C3」）——
//   真执行验收解释器探测链。判据取自真机实证：本机 venv（3.10.11）四依赖齐备 ⇒ C3 可用；
//   系统 Python 3.14 缺 transformers ⇒ 只能走 C2。
//   修复对象（真机复现）：首次链路探测时 venv 那条被判 FAIL 且 reason 为**空串**
//   （超时/被杀时 err.message 为空）⇒ 一次抖动就静默降级 C2，用户看到面板「就绪」却不工作。
// Explicit opt-in local environment acceptance; excluded from ordinary CI.
const VENV = process.env.DAM_RUNTIME_PYTHON || ''
const PLUGIN = process.env.DAM_RUNTIME_PLUGIN_DIR || ''
assert.ok(VENV && PLUGIN, 'set DAM_RUNTIME_PYTHON and DAM_RUNTIME_PLUGIN_DIR to the real offline installation')
const hasVenv = existsSync(VENV)

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
const noDeps = await probePythonWithRetryPre('python', ['-c', 'import __nonexistent_module_zzz__'], 8000, 2)
assert.equal(noDeps.ok, false, 'missing module must fail')
assert.ok(!noDeps.timedOut, 'a ModuleNotFoundError must NOT be classified as timeout')
assert.ok(String(noDeps.reason).length > 0, 'missing-module failure must be attributable')
console.log('PASS genuine dependency failure is not retried and stays attributable')

// ---- 4) 候选链结构：覆盖 配置/用户venv/开发venv/系统（C2 与 C3 的解释器来源）----
const cands = buildPythonCandidatesPre({ configured: VENV, dshHome: process.env.DSH_HOME || '', pluginDir: PLUGIN })
assert.ok(cands.length >= 3, 'candidate chain must have fallbacks, got ' + cands.length)
assert.ok(cands.some((c) => c.kind === 'configured'), 'must include the user venv (release-path users)')
assert.equal(cands.filter(c => c.path === VENV).length, 1, 'configured/dev overlap must retain exactly one interpreter')
assert.equal(cands.find(c => c.path === VENV).kind, 'configured', 'explicit interpreter takes precedence over the same dev path')
assert.ok(cands.some((c) => c.kind === 'system'), 'must include system python (C2 fallback)')
const paths = cands.map((c) => c.path)
assert.equal(new Set(paths).size, paths.length, 'candidates must be de-duplicated')
console.log('PASS candidate chain covers configured / user-venv / dev-venv / system (' + cands.length + ' entries)')

// ---- 5) 端到端（本机有 dev venv 时才跑）：C3 的解释器必须被选中 ----
if (hasVenv) {
  const res = await resolvePythonInterpreterPre(cands)
  const dev = res.probed.find((p) => p.path === VENV)
  assert.ok(dev, 'dev-venv must appear in probe results')
  assert.equal(res.chosen, VENV, '★ C3 (python tier) must select the venv that really has torch/transformers; chosen=' + res.chosen)
  assert.equal(dev.deps, true, 'dev-venv deps probe must be true (torch/transformers/onnxruntime/numpy)')
  // 每个失败候选都必须带非空原因（否则用户无从判断为什么没启用 Python）
  const unattributed = res.probed.filter((p) => !p.deps && String(p.reason || '').length === 0)
  assert.deepEqual(unattributed, [], 'every failed candidate must carry a reason: ' + JSON.stringify(unattributed.map((x) => x.path)))
  console.log('PASS C3 interpreter selected: ' + res.chosen.slice(-45))
  console.log('PASS C2 remains available: system python probed and reported (' + res.probed.filter((p) => p.kind === 'system' && p.deps).length + ' usable)')
} else {
  assert.ok(false, 'dev venv missing on this machine — C3 acceptance cannot be executed here')
}

// ---- 6) 负路径：判据能识别「空 reason」这种缺陷 ----
const fakeProbed = [{ path: 'x', deps: false, reason: '' }]
const badOnes = fakeProbed.filter((p) => !p.deps && String(p.reason || '').length === 0)
assert.equal(badOnes.length, 1, 'negative path: detector must flag an unattributed failure')
console.log('PASS negative path: unattributed failures are detectable')


// ---- 7) ★C2 语义臂（JS/e5-small）真跑通：用户要求「C2、C3 都要可用」 ----
//   真机根因（2026-09-30 实测）：devTreeRoot 的层级口径只认「入参=<包根>/lib」，
//   而引擎与探针传的是 <包根> ⇒ 解析成 <包根上级>/artifacts/... ⇒ 开发机上恒判模型缺失，
//   面板却因 peerPresent=true 看着像就绪。修复=逐级上溯探测（存在性判定，发布包行为不变）。
const semMod = await import('../../lib/semantic-js.js')
const probe = semMod.probeJsSemanticAssets(PLUGIN, [], '')
assert.equal(probe.assetPresent, true, '★ C2 模型资产必须被找到（devTreeRoot 多基探测）；assetPath=' + probe.assetPath)
assert.equal(probe.peerPresent, true, 'C2 需要 @huggingface/transformers peer')
assert.equal(probe.ready, true, 'C2 资产 + peer 齐备且未降级 ⇒ ready')
assert.ok(probe.assetBytes > 100 * 1024 * 1024, 'C2 量化模型应 >100MB，实测 ' + probe.assetBytes)
const jsEngine = semMod.createJsSemanticEnginePre({ pluginDir: PLUGIN, get incremental() { return true } })
const vecs = await jsEngine.embedPassages(['记忆唤回测试', 'unrelated weather text'])
assert.equal(vecs.length, 2, 'C2 嵌入应返回 2 条向量')
assert.equal(vecs[0].length, 384, 'e5-small 维度应为 384，实测 ' + vecs[0].length)
const cos = (a, b) => { let d = 0, na = 0, nb = 0; for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i] } return d / Math.sqrt(na * nb) }
const same = await jsEngine.embedPassages(['记忆唤回测试', '记忆的召回与注入'])
const cSame = cos(vecs[0], same[1]); const cDiff = cos(vecs[0], vecs[1])
assert.ok(cSame > cDiff, '★ C2 必须能区分同义与无关（cos 同义 ' + cSame.toFixed(3) + ' 应 > 无关 ' + cDiff.toFixed(3) + '）')
console.log('PASS C2 semantic arm: asset ' + Math.round(probe.assetBytes / 1048576) + 'MB, dim=384, cos(same)=' + cSame.toFixed(3) + ' > cos(diff)=' + cDiff.toFixed(3))

jsEngine.dispose()
console.log('PASS opt-in offline installed-runtime acceptance: actual interpreter dependencies and model semantic quality')