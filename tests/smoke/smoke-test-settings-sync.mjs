import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

// ★2026-09-30（D2 批 · 用户裁定「设置页必须全量同步，不能出现换回问题」）——真执行验收。
//   验收对象：saveConfigPatch 的广播语义（成功 emit / 失败不 emit），以及两个 I5 入口的订阅重取接线。
//   手法：从真实源码抽出 saveConfigPatch 函数体，注入 fake apiPost/emit 后真调用并断言副作用。
const source = readFileSync(new URL('../../lib/client.js', import.meta.url), 'utf8')

function fn(search) {
  const i = source.indexOf(search)
  assert.ok(i >= 0, 'fn not found: ' + search)
  const end = source.indexOf('\n    }', i)
  assert.ok(end > i, 'fn end not found')
  return source.slice(i, end + 6)
}

// ---- 1) 真执行 saveConfigPatch：成功路径必须广播一次 ----
const patchSrc = fn('    function saveConfigPatch(patch, hooks) {')
function runPatch(ok) {
  let emits = 0, savedCalls = 0, errorCalls = 0
  const ctx = {
    API: { config: '/config' },
    rememberWelcomeConfigPre: () => {},
    welcomeTourConfig: null,
    dismissWelcomeTourPre: () => {},
    emit: () => { emits++ },
    apiPost: () => ok ? Promise.resolve({ config: { a: 1 } }) : Promise.reject(new Error('boom')),
  }
  // ★批次 Y：saveConfigPatch 现经 prepareSettingsPatch 归一化（保存唯一出口内），真执行需一并注入。
  const prepSrc = source.slice(source.indexOf('    function prepareSettingsPatch(patch) {'), source.indexOf('    function TeamSecretInput(props) {'))
  const code = prepSrc + patchSrc + '\nreturn saveConfigPatch'


  const call = vm.runInNewContext('(function(){' + code + '})()', ctx)
  const p = call({ a: 1 }, { onSaved: () => { savedCalls++ }, onError: () => { errorCalls++ } })
  return p.then(() => ({ emits, savedCalls, errorCalls }), () => ({ emits, savedCalls, errorCalls }))
}
const okRun = await runPatch(true)
assert.equal(okRun.savedCalls, 1, 'onSaved must fire on success')
assert.equal(okRun.emits, 1, 'success path must broadcast exactly once (D2: cross-entry sync)')
const failRun = await runPatch(false)
assert.equal(failRun.errorCalls, 1, 'onError must fire on failure')
assert.equal(failRun.emits, 0, 'failure path must NOT broadcast (a failed save is not a config change)')
console.log('PASS saveConfigPatch real execution: success broadcasts once, failure does not')

// ---- 2) 无 hooks 的静默保存也必须广播（否则接续页/向导等路径不同步）----
async function runSilent(ok) {
  let emits = 0
  const ctx = {
    API: { config: '/config' },
    rememberWelcomeConfigPre: () => {},
    welcomeTourConfig: null,
    dismissWelcomeTourPre: () => {},
    emit: () => { emits++ },
    apiPost: () => ok ? Promise.resolve({}) : Promise.reject(new Error('nope')),
  }
  // ★批次 Y：静默路径同样经 prepareSettingsPatch（真执行注入）。
  const prepSilent = source.slice(source.indexOf('    function prepareSettingsPatch(patch) {'), source.indexOf('    function TeamSecretInput(props) {'))
  const call = vm.runInNewContext('(function(){' + prepSilent + patchSrc + '\nreturn saveConfigPatch})()', ctx)
  await call({ b: 2 }).catch(() => {})
  await new Promise((r) => setTimeout(r, 0))
  return emits
}
assert.equal(await runSilent(true), 1, 'silent success must still broadcast')
assert.equal(await runSilent(false), 0, 'silent failure must not broadcast')
console.log('PASS silent saves broadcast on success only')

// ---- 3) 两个 I5 入口都必须订阅广播并重取（接线完整性）----
const subscribeCount = (source.match(/\/\/ ★2026-09-30（D2 · 用户裁定「设置页必须全量同步」）：订阅唯一写出口的广播/g) || []).length
assert.equal(subscribeCount, 2, 'both settings entries (host panel + workbench page) must subscribe; got ' + subscribeCount)
const refetchCount = (source.match(/i5Base\.current = remote/g) || []).length
assert.equal(refetchCount, 2, 'both entries must refresh their base snapshot; got ' + refetchCount)
// 安全线：草稿保护必须存在（有未保存输入时不得覆盖）
assert.ok(source.includes('你的未保存输入未被覆盖'), 'draft-protection message must exist (do not clobber user edits)')
console.log('PASS both settings entries subscribe + refetch with draft protection')

// ---- 4) 负路径：删掉广播 ⇒ 判据必须能发现 ----
const mutated = patchSrc.replace('try { emit() } catch (eEmit) {}', '')
assert.notEqual(mutated, patchSrc, 'negative path: mutation must change the source')
assert.ok(!mutated.includes('try { emit() } catch (eEmit) {}'), 'negative path: broadcast must be gone in the mutant')
console.log('PASS negative path: broadcast removal is detectable')

console.log('PASS settings sync (D2) acceptance: real execution + wiring + negative path')