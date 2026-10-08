/**
 * smoke-test-fullpage-negative.mjs — 负路径：真变异必红、还原复绿
 *
 * ★关键：被检套件读的是**产物** lib/client.js（Iter5Surface 组件体已内联其中）⇒
 *   变异必须打在 lib/client.js 上；打源文件 skins/iter5/surfaces.js 不影响产物 ⇒ 假绿。
 *   （这正是「源 → 生成器 → 产物」纪律的反面教材。）
 * ★EOL：client.js 为 CRLF ⇒ 变异前先归一化为 LF 锚定，写回时还原原行尾。
 *
 *  N1 删掉 CSS composer 隐藏规则           ⇒ G1 必红
 *  N2 标记改为无条件置位（去掉可见性判断） ⇒ F1 必红
 *  N3 删掉 cleanup 的 mark(false)          ⇒ F4 必红
 *  N4 删掉无 IntersectionObserver 降级分支 ⇒ F6 必红
 * 四组还原后必须全绿。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const SUITE = 'tests/smoke/smoke-test-fullpage-composer.mjs'
const ARTIFACT = 'lib/client.js'

const SKIP_DIRS = new Set(['.git', 'node_modules', 'python', 'artifacts', '.vision-tmp', 'canvas-local', '_probe'])
function copyTree(from, to) {
  fs.mkdirSync(to, { recursive: true })
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    // ★2026-10-08：排除重型目录（python/ 10GB、artifacts/ 2GB 等），否则整树复制会让本套件超时。
    if (SKIP_DIRS.has(e.name) || e.name.startsWith('.diag') || e.name.startsWith('.smoke-tmp')) continue
    const a = path.join(from, e.name), b = path.join(to, e.name)
    if (e.isDirectory()) copyTree(a, b)
    else if (e.isFile()) fs.copyFileSync(a, b)
  }
}

function runSuite(dir) {
  const r = spawnSync(process.execPath, [SUITE], { cwd: dir, encoding: 'utf8' })
  const out = (r.stdout || '') + (r.stderr || '')
  const m = /PASS (\d+) \/ FAIL (\d+)/.exec(out)
  return { code: r.status, pass: m ? Number(m[1]) : -1, fail: m ? Number(m[2]) : -1, out: out }
}

let pass = 0, fail = 0
function ok(name, fn) {
  try { fn(); pass += 1; console.log('  PASS ' + name) }
  catch (e) { fail += 1; console.log('  FAIL ' + name + ' :: ' + (e && e.message)) }
}

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'dam-fp-neg-'))
copyTree(ROOT, base)

const baseRun = runSuite(base)
ok('N0 副本基线全绿（PASS ' + baseRun.pass + ' / FAIL ' + baseRun.fail + '）', function () {
  assert.equal(baseRun.fail, 0, '副本基线不为绿，负路径无意义：' + baseRun.out.slice(-300))
  assert.ok(baseRun.pass >= 9, '基线 PASS 数异常：' + baseRun.pass)
})

const CR = String.fromCharCode(13)
const LF = String.fromCharCode(10)

function mutate(tag, from, to, expectMarker) {
  const f = path.join(base, ARTIFACT)
  const raw = fs.readFileSync(f, 'utf8')
  const hasCRLF = raw.indexOf(CR + LF) >= 0
  const lf = raw.split(CR + LF).join(LF)
  const n = lf.split(from).length - 1
  assert.equal(n, 1, tag + ' 变异锚命中 ' + n + ' 次（需 1）')
  fs.writeFileSync(f, lf.split(from).join(to).split(LF).join(hasCRLF ? CR + LF : LF), 'utf8')
  const r = runSuite(base)
  try {
    assert.ok(r.fail > 0, tag + ' 变异后仍全绿（假绿）：' + r.pass + '/' + r.fail)
    assert.ok(r.out.indexOf(expectMarker) >= 0, tag + ' 期望 ' + expectMarker + ' 变红；实际红项不符')
  } finally {
    fs.writeFileSync(f, raw, 'utf8')
  }
  const back = runSuite(base)
  assert.equal(back.fail, 0, tag + ' 还原后未复绿：' + back.pass + '/' + back.fail)
}

const Q = String.fromCharCode(39)
const CSS_RULE = Q + 'body[data-dam-fullpage] [data-composer-seat],body[data-dam-fullpage] [data-composer-card]{display:none!important;}' + Q + ','
const IO_GUARD = 'if (typeof IntersectionObserver !== ' + Q + 'function' + Q + ') {'
const CLEANUP = 'return function () { try { io.disconnect() } catch (e) {} mark(false) }'
const DEGRADE = IO_GUARD + LF + '          mark(true)' + LF + '          return function () { mark(false) }' + LF + '        }' + LF

ok('N1 删掉 CSS composer 隐藏规则 ⇒ G1 必红', function () {
  mutate('N1', CSS_RULE + LF, '', 'G1')
})

ok('N2 标记改为无条件置位 ⇒ F1 必红', function () {
  mutate('N2', IO_GUARD, 'if (true) {', 'F1')
})

ok('N3 删掉 cleanup 的 mark(false) ⇒ F4 必红', function () {
  mutate('N3', CLEANUP, 'return function () { try { io.disconnect() } catch (e) {} }', 'F4')
})

ok('N4 删掉无 IntersectionObserver 降级分支 ⇒ F6 必红', function () {
  mutate('N4', DEGRADE, '', 'F6')
})

console.log('')
console.log('  fullpage-negative: PASS ' + pass + ' / FAIL ' + fail)
try { fs.rmSync(base, { recursive: true, force: true }) } catch (e) {}
process.exit(fail ? 1 : 0)