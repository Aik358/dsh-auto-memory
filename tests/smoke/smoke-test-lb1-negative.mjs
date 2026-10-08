/**
 * L-B1 负路径：临时副本上**真变异**，断言三条守卫必红、还原必绿。
 *   M-A：插入一条 --x: 定义 ⇒ A 必红
 *   M-B：把 --i5-blue 换成非白名单 --dsw-alias-brand-primary 放进兜底链 ⇒ B 必红
 *   M-C：primary 改成旧形态（非蓝底白字）⇒ C 必红
 */
import { spawnSync } from 'node:child_process'
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
const ROOT = process.argv[2] || 'D:/dsh-auto-memory'
const NL = String.fromCharCode(10)
let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  ok   - ' + m) } else { fail++; console.log('  FAIL - ' + m) } }
const root = mkdtempSync(path.join(os.tmpdir(), 'lb1-neg-'))
for (const d of ['skins', 'tests', 'tools', 'lib']) cpSync(path.join(ROOT, d), path.join(root, d), { recursive: true })
const REL = 'skins/iter5/legacy-native-overlays.css'
const SUITE = 'tests/smoke/smoke-test-lb1-classic-fallback.mjs'
function run () {
  const r = spawnSync(process.execPath, [path.join(root, SUITE)], { encoding: 'utf8', cwd: root, timeout: 120000, env: Object.assign({}, process.env, { LB1_ROOT: root }) })
  const out = String(r.stdout || '') + String(r.stderr || '')
  const m = /结果: (\d+) PASS \/ (\d+) FAIL/.exec(out)
  return { code: r.status, p: m ? +m[1] : -1, f: m ? +m[2] : -1, red: r.status !== 0, out }
}
const base = run()
console.log('[L-B1-neg] 基线（副本内）exit=' + base.code + ' ' + base.p + '/' + base.f)
ok(!base.red, '基线全绿')
function round (name, from, to) {
  const orig = readFileSync(path.join(root, REL), 'utf8')
  const hit = orig.split(from).length - 1
  ok(hit >= 1, name + '｜锚点命中 ' + hit)
  writeFileSync(path.join(root, REL), orig.split(from).join(to), 'utf8')
  const r = run()
  ok(r.red, name + ' ★必红（exit=' + r.code + ' ' + r.p + '/' + r.f + '）')
  writeFileSync(path.join(root, REL), orig, 'utf8')
  const r2 = run()
  ok(!r2.red, name + ' 还原复绿（' + r2.p + '/' + r2.f + '）')
}
console.log('[L-B1-neg] M-A 插入属性定义')
round('M-A', 'aside.i5-native-notice{box-sizing:border-box;', 'aside.i5-native-notice{--i5-evil:#123456;box-sizing:border-box;')
console.log('[L-B1-neg] M-B 兜底链改含非白名单令牌')
round('M-B', 'background:color-mix(in srgb,var(--i5-blue,#2563EB) 10%,transparent)', 'background:color-mix(in srgb,var(--i5-blue,var(--dsw-alias-brand-primary,#2563EB)) 10%,transparent)')
console.log('[L-B1-neg] M-C primary 改回旧形态')
// ★锚串必须跟随**当前**文件（曾因把 border 改成 border-color 而命中 0 ⇒ 变异空转、假绿）
round('M-C', 'background:var(--i5-blue,#2563EB);color:var(--i5-surface,#FFFFFF);border-color:transparent;', 'background:var(--dsw-alias-brand-primary,#4f7cff);color:var(--i5-on-accent,var(--dsw-alias-fg-on-accent,#fff));border-color:transparent;')
console.log('[L-B1-neg] M-D 删掉避让规则 ⇒ E 必红')
round('M-D', 'body:has([data-native-dialog-overlay=welcomeBack]) [data-native-continuation]{bottom:calc(28px + 224px * var(--dam-scale,1));}', '')
console.log('[L-B1-neg] M-E 把避让位改回基线 16px（等于没抬）⇒ E-4/E-5 必红')
round('M-E', 'body:has([data-native-dialog-overlay=welcomeBack]) [data-native-continuation]{bottom:calc(28px + 224px * var(--dam-scale,1));}', 'body:has([data-native-dialog-overlay=welcomeBack]) [data-native-continuation]{bottom:16px;}')
console.log('[L-B1-neg] M-F 把避让方向改成「欢迎卡在上」（倒挂：欢迎卡 bottom 抬高、接续卡不动）⇒ E 必红')
round('M-F', 'body:has([data-native-continuation]) aside.i5-native-notice[data-native-dialog=welcomeBack]{max-height:calc(224px * var(--dam-scale,1));overflow:auto;}', 'body:has([data-native-continuation]) aside.i5-native-notice[data-native-dialog=welcomeBack]{bottom:calc(28px + 224px * var(--dam-scale,1));overflow:auto;}')
console.log('')
console.log('[L-B1-neg] 结果: ' + pass + ' PASS / ' + fail + ' FAIL')
try { rmSync(root, { recursive: true, force: true }) } catch (e) {}
process.exit(0)
