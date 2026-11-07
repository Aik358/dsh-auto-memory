/**
 * #449-1 版本契约守护（面向 alpha.7 及以后）
 *
 * 这一套不是「验证 alpha.6 修好了」，而是验证「以后版本改了，会不会静默坏掉」。
 * 第一版修复把字段名和判据硬编码在 6 个请求点：alpha.7 只要改参数名、
 * 把确认通道挪进 diag()、或取消历史包限制，请求照发、后端不认，UI 还挂着
 * 一个没用的勾选框，而 CI 全绿。本套件钉住三件事：
 *   C1–C3 契约层：默认 fail-closed；能力覆盖能换字段名；不需要确认时彻底不发字段。
 *   C4–C5 探测器：从源码认出后端契约/客户端形态，容忍改名与新增字段，看不懂就报漂移。
 *   C6 单一真源：client.js 内联的 HELPER 与契约模块逐字一致，6 处共用同一判据。
 *
 * 完全自包含（只依赖仓库内文件），可随 PR 一起提交到上游 CI。
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  installHelper, extractHelperSource, selfSource, OPTIN_DEFAULT_FIELD,
} from '../../lib/migration-optin-contract.js'
import { detectBackendContract, detectClientShape, normalize } from '../../tools/lib/migration-contract-probe.mjs'

let pass = 0, fail = 0
const ok = (c, n, d) => { if (c) { pass++; console.log('  ok - ' + n) } else { fail++; console.error('  FAIL - ' + n + (d ? '\n       ' + d : '')) } }
const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)))
const CL = readFileSync(path.join(ROOT, 'lib', 'client.js'), 'utf8')
const P = 'C:/packs/legacy.dam-pack'
const Q = 'C:/packs/another.dam-pack'

// ─────────────────────────────────────────────────────────────
console.log('[C1] 默认契约：严格回退 alpha.6，且 fail-closed')
{
  const h = installHelper({})
  ok(h.contract().field === OPTIN_DEFAULT_FIELD && h.contract().source === 'default',
    'C1a 未注入能力 ⇒ 默认字段 ' + OPTIN_DEFAULT_FIELD, JSON.stringify(h.contract()))
  ok(h.body(P, '')[OPTIN_DEFAULT_FIELD] === false, 'C1b 未勾选 ⇒ false')
  ok(h.body(P, P)[OPTIN_DEFAULT_FIELD] === true, 'C1c 勾选且同一个包 ⇒ true')
  ok(h.body(Q, P)[OPTIN_DEFAULT_FIELD] === false, 'C1d 换包 ⇒ 自动 false（确认不延续）')
  ok(h.body('', '')[OPTIN_DEFAULT_FIELD] === false, 'C1e 空路径 ⇒ false（不因空串相等误放行）')
  ok(Object.keys(h.body(P, P)).length === 1, 'C1f 请求体只多一个字段，不夹带别的开关')
  ok(h.required() === true, 'C1g 默认仍需 UI 显式确认')
}

console.log('\n[C2] 未来版改字段名：注入能力即可，不改 6 个请求点')
{
  const h = installHelper({ __DAM_MIGRATION_OPTIN__: { field: 'acceptLegacyUserFiles', required: true } })
  ok(h.contract().source === 'override' && h.contract().field === 'acceptLegacyUserFiles',
    'C2a 能力覆盖被采纳', JSON.stringify(h.contract()))
  const b = h.body(P, P)
  ok(b.acceptLegacyUserFiles === true, 'C2b 按新字段名发出 true')
  ok(!(OPTIN_DEFAULT_FIELD in b), 'C2c 不再发旧字段名（未来后端不认旧键时不会静默失效）')
  ok(h.body(P, '').acceptLegacyUserFiles === false, 'C2d 新字段名下仍然 fail-closed')
  const alias = installHelper({ __DAM_MIGRATION_CAPABILITIES__: { migrationOptIn: { field: 'confirmLegacyPack' } } })
  ok(alias.body(P, P).confirmLegacyPack === true, 'C2e 后端 capabilities 形态也能协商')
  const bad = installHelper({ __DAM_MIGRATION_OPTIN__: { field: 'x;evil()' } })
  ok(bad.contract().field === OPTIN_DEFAULT_FIELD, 'C2f 非法字段名被忽略，回退默认契约（防注入）')
}

console.log('\n[C3] 未来版取消历史包限制：彻底不发字段、不显示勾选框')
{
  const h = installHelper({ __DAM_MIGRATION_OPTIN__: { required: false } })
  ok(h.required() === false, 'C3a UI 侧 required() 为假（勾选框不渲染）')
  ok(Object.keys(h.body(P, P)).length === 0, 'C3b 请求体为空对象（不再发确认键）')
  ok(h.value(P, P) === undefined, 'C3c 判据也不再产出值')
  const h2 = installHelper({ __DAM_MIGRATION_OPTIN__: { notRequired: true } })
  ok(h2.required() === false, 'C3d notRequired 别名同样生效')
}

console.log('\n[C4] 后端契约探测：不绑 SHA / version，认字段与 guard')
{
  const ix6 = `writeJson(res, 200, await engine.migrateInspect({ packPath: body && body.packPath, allowUnprovenUserFiles: !!(body && body.allowUnprovenUserFiles === true) }))`
  const pk6 = `else if (algoV1 && hasUserFiles && o.allowUnprovenUserFiles !== true) { errors.push('userfiles-unproven-by-checksum') }`
  const a = detectBackendContract({ indexSrc: ix6, packSrc: pk6 })
  ok(a.field === 'allowUnprovenUserFiles' && a.required === true && a.drift.length === 0,
    'C4a alpha.6 形态探测正确', JSON.stringify(a))
  const b = detectBackendContract({ indexSrc: ix6.replace(/allowUnprovenUserFiles/g, 'acceptLegacyUserFiles'), packSrc: pk6 })
  ok(b.field === 'acceptLegacyUserFiles' && b.drift.length === 0,
    'C4b alpha.7 改参数名 ⇒ 探测到新字段名', JSON.stringify(b))
  const c = detectBackendContract({ indexSrc: `const flag = body.confirmLegacyUserFiles === true`, packSrc: pk6 })
  ok(c.field === 'confirmLegacyUserFiles', 'C4c 路由写法放宽（去掉 !!( )）仍能认出字段', JSON.stringify(c))
  const d = detectBackendContract({ indexSrc: ix6, packSrc: '// guard removed in alpha.7' })
  ok(d.required === false, 'C4d guard 消失 ⇒ 判定不再需要显式确认')
  const e = detectBackendContract({ indexSrc: 'no migrate route here', packSrc: pk6 })
  ok(e.drift.length > 0, 'C4e 后端仍要确认却认不出字段 ⇒ 报漂移，不猜')
}

console.log('\n[C5] 客户端形态探测：容忍改名 / 新增字段 / 缩进变化')
{
  function fakeClient({ packExpr = 'migPack', extra = '', indent = '    ', nReq = 6, iterAnchor = 'props.pickPack' } = {}) {
    let s = ''
    for (let i = 0; i < nReq; i++) {
      s += `apiPost(API.migrate${i % 2 ? 'Import' : 'Inspect'}, { packPath: ${packExpr}, targetWs: currentWs() || undefined, onConflict: migConflict${extra} })\n`
    }
    for (let i = 0; i < 3; i++) {
      s += `${indent}var migConflictPair = useState('keep')\n${indent}var migConflict = migConflictPair[0]\n${indent}var setMigConflict = migConflictPair[1]\n`
    }
    s += `\n  migPlan ? h('div', { style: { wordBreak: 'break-all' } }, null)\n`
    s += `\n    migPlan ? h('div', { style: { wordBreak: 'break-all' } }, null)\n`
    s += `\n  h('div', { className: 'i5-toolbar' }, h('button', { onClick: ${iterAnchor} }))\n`
    s += `\n  conflict: migConflict, setConflict: function (value) { setMigConflict(value); migPreview(value) }, onApply: migApply,\n`
    return s
  }
  const a = detectClientShape(fakeClient())
  ok(a.requests.length === 6 && a.drift.length === 0, 'C5a 基线形态 6 请求点 / 3 状态 / 3 插入位全命中', JSON.stringify(a.drift))
  const b = detectClientShape(fakeClient({ packExpr: 'state.packPath' }))
  ok(b.requests.length === 6 && b.requests.every(r => r.packExpr === 'state.packPath') && b.drift.length === 0,
    'C5b 包路径变量改名 ⇒ 逐处提取新表达式（不写死 migPack）')
  const c = detectClientShape(fakeClient({ extra: ', scope: "all", dryRun: false' }))
  ok(c.requests.every(r => r.packExpr === 'migPack') && c.drift.length === 0,
    'C5c 请求体新增字段 ⇒ 仍认得请求点')
  const d = detectClientShape(fakeClient({ indent: '        ' }))
  ok(d.states === 3 && d.drift.length === 0, 'C5d 缩进变化 ⇒ 状态锚点仍命中')
  const e = detectClientShape(fakeClient({ nReq: 5 }))
  ok(e.drift.some(x => x.includes('请求点')), 'C5e 向导减到 5 个 ⇒ 报漂移而非静默少改一处')
  const f = detectClientShape(fakeClient({ iterAnchor: 'props.otherHandler' }))
  ok(f.drift.some(x => x.includes('工具栏')), 'C5f 共享组件按钮改名 ⇒ 报漂移并提示补锚点')
  const g = detectClientShape(fakeClient({ nReq: 6 }).replace(/apiPost\(API\.migrateInspect/g, 'apiPost(API.migrateInspect'))
  ok(g.drift.length === 0, 'C5g 重复运行探测不改变源码（纯只读）')
}

console.log('\n[C6] 单一真源：client.js 内联 HELPER 与契约模块逐字一致')
{
  const inline = extractHelperSource(normalize(CL))
  const origin = extractHelperSource(selfSource())
  ok(!!inline && !!origin, 'C6a 两处都能取出 HELPER 区间')
  ok(inline === origin, 'C6b 逐字一致（改了契约模块却没重新生成 bundle 会立刻变红）',
    'inline=' + (inline && inline.length) + ' origin=' + (origin && origin.length))
  const cnt = (s, n) => { let c = 0, i = 0; for (;;) { const p = s.indexOf(n, i); if (p < 0) return c; c++; i = p + n.length } }
  ok(cnt(CL, '/* === HELPER-BEGIN === */') === 1, 'C6c HELPER 只内联一次（不会双份定义）')
  ok(cnt(CL, 'globalThis.__damMigrationOptIn.body(') === 6, 'C6d 6 个请求点全部走同一判据')
  const callExprs = Array.from(normalize(CL).matchAll(/globalThis\.__damMigrationOptIn\.body\([^)]*\)/g)).map(m => m[0])
  ok(callExprs.length === 6 && new Set(callExprs).size === 1,
    'C6d2 ★6 处共用同一实参（防某一处被偷偷放宽成恒 true）', JSON.stringify(Array.from(new Set(callExprs))))
  ok(cnt(CL, 'globalThis.__damMigrationOptIn.required()') === 3, 'C6e 3 个勾选框都受能力开关控制')
  ok(!/allowUnprovenUserFiles:\s*true\b/.test(CL), 'C6f 负路径：不得出现无条件 true')
  ok(/e\.target\.checked \? migPack : ''/.test(CL) && /e\.target\.checked \? props\.pack : ''/.test(CL),
    'C6g 勾选写的是「当前包路径」而非布尔（换包自动失效）')
}

console.log('\n--- #449-1 版本契约守护 ---')
console.log('pass=' + pass + ' fail=' + fail)
process.exit(fail ? 1 : 0)
