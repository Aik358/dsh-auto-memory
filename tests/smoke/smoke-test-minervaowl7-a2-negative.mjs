/**
 * A-2 负路径：把本道两处修复**真变异回旧行为**（真删/真改写产线代码），断言专项套件必红。
 * 变异在 os.tmpdir() 的**整树副本**上做（本仓只读）—— 与仓内既有范式一致。
 */
import { spawnSync } from 'node:child_process'
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  ok   - ' + m) } else { fail++; console.log('  FAIL - ' + m) } }

const SUITE = 'tests/smoke/smoke-test-minervaowl7-a2-autocont-display.mjs'
const root = mkdtempSync(path.join(os.tmpdir(), 'a2-neg-'))
cpSync(path.join(ROOT, 'lib'), path.join(root, 'lib'), { recursive: true })
cpSync(path.join(ROOT, 'tests'), path.join(root, 'tests'), { recursive: true })

function runSuite (label) {
  const r = spawnSync(process.execPath, [path.join(root, SUITE)], { encoding: 'utf8', timeout: 240000 })
  const out = String(r.stdout || '') + String(r.stderr || '')
  const m = /结果: (\d+) PASS \/ (\d+) FAIL/.exec(out)
  if (!m) {
    console.log('  [' + label + '] 未能解析结果，原始尾部：\n' + out.slice(-600))
    return { code: r.status, p: 0, f: -1 }
  }
  console.log('  [' + label + '] ' + m[1] + ' PASS / ' + m[2] + ' FAIL (exit=' + r.status + ')')
  return { code: r.status, p: Number(m[1]), f: Number(m[2]) }
}

function mutate (rel, from, to, label) {
  const f = path.join(root, rel)
  let t = readFileSync(f, 'utf8')
  const hit = t.split(from).length - 1
  ok(hit === 1, label + '｜变异锚点恰命中 1 次（实=' + hit + '）')
  if (hit !== 1) return false
  writeFileSync(f, t.split(from).join(to), 'utf8')
  return true
}

console.log('')
console.log('[A2-负路径] ① 基线（未变异）必须全绿')
const base = runSuite('基线')
ok(base.f === 0 && base.p >= 18, '基线 0 FAIL 且 PASS ≥ 18（实 ' + base.p + '/' + base.f + '）')

console.log('[A2-负路径] ② #288 变异：恢复「lastOk 分支先 return、确认卡后置」的旧顺序')
{
  const clientPath = path.join(root, 'lib', 'client.js')
  const orig = readFileSync(clientPath, 'utf8')
  let t = orig
  // 变异 1：把 armed 分支的 applyArmCard + return 去掉（让 armed 不再早于 lastOk 生效）
  // ★2026-10-08 判据对齐：锚串曾写死旧形态，被两处有意演进撑破 ——
  //   ① 第一行：Lead 的 #285 补修把 `arm.ratio >= thr` 改为 `(arm.hard || arm.ratio >= thr)`；
  //   ② 第二锚串：lane-a 的 #290 在第三行**同一行内**追加了降级标注 ⇒ 原锚串不再字面匹配。
  //   变异语义不变（仍是「恢复旧顺序 / 旧语义」），仅把锚串对齐到现形。
  const armRe = '            if (arm && (arm.hard || arm.ratio >= thr)) {\r\n              applyArmCard(arm)\r\n              return\r\n            }\r\n'
  const armHit = t.split(armRe).length - 1
  ok(armHit === 1, '②-1 armed 早返回锚点恰命中 1 次（实=' + armHit + '）')
  t = t.split(armRe).join('')
  // 变异 2：lastOk 分支回到旧语义（无条件清卡 + 显示成功文本）
  const okRe = '              if (armActive) applyArmCard(armNow)\r\n              else { setAcConfirm(null); setAcCd(0) }\r\n'
  // ★2026-10-08 判据对齐：#290 在第三行之前插入了注释 ⇒ 原三行连续锚串被切断，
  //   现拆成两处独立变异（语义等价：仍是「恢复旧顺序 / 旧语义」）。
  const okRe2 = 'if (!acOkDismissed && !armActive) setAcSt('
  const okHit = (t.split(okRe).length - 1) * (t.split(okRe2).length - 1) === 1 ? 1 : 0
  ok(okHit === 1, '②-2 lastOk 分支卡优先锚点恰命中 1 次（实=' + okHit + '）')
  t = t.split(okRe).join('              setAcConfirm(null)\r\n              setAcCd(0)\r\n' + '              ')
  writeFileSync(clientPath, t, 'utf8')
  const r1 = runSuite('#288 变异')
  ok(r1.f > 0, '②-3 ★变异必红：#288 旧顺序下套件出现 FAIL（f=' + r1.f + '）')
  writeFileSync(clientPath, orig, 'utf8')
  const r1b = runSuite('#288 还原')
  ok(r1b.f === 0, '②-4 还原复绿（f=' + r1b.f + '）')
}

console.log('[A2-负路径] ③ #289 变异：抽掉请求代次 + 会话身份校验')
{
  const clientPath = path.join(root, 'lib', 'client.js')
  const orig = readFileSync(clientPath, 'utf8')
  // 变异：acFresh 的判据恒真（等价于旧实现「不做任何代次/身份校验」）
  const freshRe = '            if (!alive || mySeq !== pollSeq) return false\r\n            if (!sidQ) return true\r\n            try { return String(currentSessionIdClient() || \'\') === sidQ } catch (eSq) { return true }'
  const hit = orig.split(freshRe).length - 1
  ok(hit === 1, '③-1 代次/身份判据锚点恰命中 1 次（实=' + hit + '）')
  const t = orig.split(freshRe).join('            return !!alive')
  writeFileSync(clientPath, t, 'utf8')
  const r2 = runSuite('#289 代次/身份变异')
  ok(r2.f > 0, '③-2 ★变异必红：去掉代次/身份校验后出现 FAIL（f=' + r2.f + '）')
  writeFileSync(clientPath, orig, 'utf8')
  const r2b = runSuite('#289 还原')
  ok(r2b.f === 0, '③-3 还原复绿（f=' + r2b.f + '）')
}

console.log('[A2-负路径] ④ #289 局部变异：只抽掉「跳转前重读会话」')
{
  const clientPath = path.join(root, 'lib', 'client.js')
  const orig = readFileSync(clientPath, 'utf8')
  const jumpRe = ' && sidNowJump === sidQ && sidQ === fromSidAc && '
  const hit = orig.split(jumpRe).length - 1
  ok(hit === 1, '④-1 跳转身份复核锚点恰命中 1 次（实=' + hit + '）')
  writeFileSync(clientPath, orig.split(jumpRe).join(' && sidQ === fromSidAc && '), 'utf8')
  const r3 = runSuite('跳转复核变异')
  ok(r3.f > 0, '④-2 ★变异必红：跳转前不重读当前会话 ⇒ 套件 FAIL（f=' + r3.f + '）')
  writeFileSync(clientPath, orig, 'utf8')
  const r3b = runSuite('跳转复核还原')
  ok(r3b.f === 0, '④-3 还原复绿（f=' + r3b.f + '）')
}

console.log('')
console.log('[A2-负路径] 结果: ' + pass + ' PASS / ' + fail + ' FAIL')
try { rmSync(root, { recursive: true, force: true }) } catch (e) {}
process.exit(fail === 0 ? 0 : 1)
