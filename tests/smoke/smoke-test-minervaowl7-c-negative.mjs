/**
 * 批 C 负路径：三处修复**真变异**（在 os.tmpdir() 整树副本上做；本仓只读），断言专项套件必红。
 */
import { spawnSync } from 'node:child_process'
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  ok   - ' + m) } else { fail++; console.log('  FAIL - ' + m) } }
const NL = String.fromCharCode(10)
const SUITE = 'tests/smoke/smoke-test-minervaowl7-c-appearance.mjs'

const root = mkdtempSync(path.join(os.tmpdir(), 'c-neg-'))
cpSync(path.join(ROOT, 'lib'), path.join(root, 'lib'), { recursive: true })
cpSync(path.join(ROOT, 'tests'), path.join(root, 'tests'), { recursive: true })

function run (label) {
  const r = spawnSync(process.execPath, [path.join(root, SUITE)], { encoding: 'utf8', timeout: 240000 })
  const out = String(r.stdout || '') + String(r.stderr || '')
  const m = /结果: (\d+) PASS \/ (\d+) FAIL/.exec(out)
  if (!m) { console.log('  [' + label + '] 无法解析，尾部:\n' + out.slice(-400)); return { p: 0, f: -1 } }
  console.log('  [' + label + '] ' + m[1] + ' PASS / ' + m[2] + ' FAIL')
  return { p: Number(m[1]), f: Number(m[2]) }
}
function mutate (rel, pairs, label) {
  const f = path.join(root, rel)
  let t = readFileSync(f, 'utf8')
  for (const [from, to] of pairs) {
    const hit = t.split(from).length - 1
    ok(hit === 1, label + ' 锚点恰命中 1 次（实=' + hit + '）')
    if (hit !== 1) return false
    t = t.split(from).join(to)
  }
  writeFileSync(f, t, 'utf8')
  return true
}

console.log('')
console.log('[C-负路径] ① 基线（未变异）必须全绿')
const base = run('基线')
ok(base.f === 0 && base.p >= 17, '基线 0 FAIL 且 PASS ≥ 17（实 ' + base.p + '/' + base.f + '）')

console.log('[C-负路径] ② #282：摘掉旧档附加表（还原「旧档浮层无 CSS」）')
{
  const rel = 'lib/client.js'
  const orig = readFileSync(path.join(root, rel), 'utf8')
  const from = "var LEGACY_OVERLAY_EXTRA = " + JSON.stringify('') + ';'
  // 直接把附加表置空等价于「旧档拿不到这些规则」
  const marker = 'var LEGACY_OVERLAY_EXTRA = '
  const i = orig.indexOf(marker)
  ok(i > 0, '②-0 找到附加表定义（offset=' + i + '）')
  const j = orig.indexOf(NL, i)
  writeFileSync(path.join(root, rel), orig.slice(0, i) + marker + JSON.stringify('') + orig.slice(j), 'utf8')
  const r = run('#282 变异')
  ok(r.f > 0, '②-1 ★变异必红：旧档规则清零后出现 FAIL（f=' + r.f + '）')
  writeFileSync(path.join(root, rel), orig, 'utf8')
  const r2 = run('#282 还原')
  ok(r2.f === 0, '②-2 还原复绿（f=' + r2.f + '）')
}

console.log('[C-负路径] ③ #283：摘掉弹窗族 box-sizing 规则')
{
  const rel = 'lib/client.js'
  const orig = readFileSync(path.join(root, rel), 'utf8')
  const from = '[data-dam-theme] [data-native-dialog] *,[data-dam-theme] [data-dam-status-dialog] *,[data-dam-theme] [data-native-dialog-overlay] *{box-sizing:border-box;}'
  ok(orig.split(from).length - 1 === 1, '③-0 附加表内含该规则')
  // 变异：把**附加表内**的两条弹窗 box-sizing 规则去掉（模拟修复前）。
  //   ★必须精确落在附加表字符串里：冻结表(off[0])本就零命中，改它不会变红（首版即因此假绿）。
  const esc = (s) => s.split(String.fromCharCode(92)).join(String.fromCharCode(92) + String.fromCharCode(92))
  const r1 = "[data-dam-theme] [data-native-dialog],[data-dam-theme] [data-dam-status-dialog],[data-dam-theme] [data-native-dialog-overlay]{box-sizing:border-box;}"
  const r2 = "[data-dam-theme] [data-native-dialog] *,[data-dam-theme] [data-dam-status-dialog] *,[data-dam-theme] [data-native-dialog-overlay] *{box-sizing:border-box;}"
  const enc = (s) => esc(JSON.stringify(s).slice(1, -1))
  const before = orig.split(enc(r1)).length - 1 + orig.split(enc(r2)).length - 1
  ok(before === 2, '③-1a 两条规则在附加表字面量内各命中 1 次（实=' + before + '）')
  const mutated = orig.split(enc(r1)).join('').split(enc(r2)).join('')
  ok(mutated !== orig, '③-1 变异确实改动了内容')
  writeFileSync(path.join(root, rel), mutated, 'utf8')
  const rm = run('#283 变异')
  ok(rm.f > 0, '③-2 ★变异必红：弹窗 box-sizing 清除后出现 FAIL（f=' + rm.f + '）')
  writeFileSync(path.join(root, rel), orig, 'utf8')
  const rb = run('#283 还原')
  ok(rb.f === 0, '③-3 还原复绿（f=' + rb.f + '）')
}

console.log('[C-负路径] ④ #284：摘掉换肤监听')
{
  const rel = 'lib/client.js'
  const orig = readFileSync(path.join(root, rel), 'utf8')
  const n = orig.split("window.addEventListener('dam-skin-changed', damSyncShared)").length - 1
  ok(n >= 1, '④-0 找到换肤监听（命中 ' + n + '）')
  writeFileSync(path.join(root, rel), orig.split("window.addEventListener('dam-skin-changed', damSyncShared)").join('void 0'), 'utf8')
  const r = run('#284 变异')
  ok(r.f > 0, '④-1 ★变异必红：去掉监听后出现 FAIL（f=' + r.f + '）')
  writeFileSync(path.join(root, rel), orig, 'utf8')
  const r2 = run('#284 还原')
  ok(r2.f === 0, '④-2 还原复绿（f=' + r2.f + '）')
}

console.log('')
console.log('[C-负路径] 结果: ' + pass + ' PASS / ' + fail + ' FAIL')
try { rmSync(root, { recursive: true, force: true }) } catch (e) {}
process.exit(fail === 0 ? 0 : 1)
