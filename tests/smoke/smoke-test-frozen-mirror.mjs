#!/usr/bin/env node
/**
 * [frozen-mirror] 冻结镜像守卫（G0-5，2026-10-02 新增）。
 *
 * ★为什么需要它：设置页有**三面**，跨**两个文件**——
 *     ① classic 面 = lib/client.js 手写区（生成块之外）
 *     ② frozen 面 = skins/legacy/iter5-325.js.frozen（旧款皮肤的唯一真源，无「改源重建」路径）
 *     ③ v4 面     = lib/client.js 的 ITER5-GENERATED 生成块
 *   frozen 是第三副本且**没有任何重建通道**：改了忘了镜像，不会有任何机制报错
 *   （settings-parity 只查键集，不查行为表达式）。v3.2.6 已有实锤漏镜像（见下豁免表）。
 *
 * ★两级比对（全部为**实测抽取**，不是读注释）：
 *   ① 签名级：四个自宿主组件的定义签名在各自面上存在 + 生成器切片锚在生成器里存在；
 *   ② 表达式级：
 *      · pyOk 真值表达式三面逐字一致；
 *      · Settings 面 set('<KEY>', <表达式>) 的**键集**：frozen ⊇ classic（防"调用点镜像了、配套没镜像"）；
 *      · 三面共有键的**表达式**逐字一致 —— 差异必须逐条登记在 KNOWN_DRIFT 里，否则红。
 *   豁免自我清算：KNOWN_DRIFT 里的条目若已三面一致 ⇒ 红并提示删除豁免（防止豁免腐烂）。
 *
 * ★任一漂移即红，错误信息指向「frozen 需手工镜像，参考 skins/iter5/README.md 同步节」。
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
const CLIENT = path.join(ROOT, 'lib', 'client.js')
const FROZEN = path.join(ROOT, 'skins', 'legacy', 'iter5-325.js.frozen')
const GEN = path.join(ROOT, 'tools', 'build-iter5-skin.mjs')
const MIRROR_HINT = '（frozen 需手工镜像，参考 skins/iter5/README.md 同步节）'

let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  ok -', m) } else { fail++; console.error('  FAIL -', m) } }
const norm = (s) => String(s).replace(/\r\n/g, '\n')
const cnt = (t, s) => String(t).split(s).length - 1

const client = norm(readFileSync(CLIENT, 'utf8'))
const frozen = norm(readFileSync(FROZEN, 'utf8'))
const genSrc = norm(readFileSync(GEN, 'utf8'))
const L = client.split('\n')

// ---- 面切分：按标记行定位（不写死行号；标记缺失即红） ----
const legacyBegin = L.findIndex((l) => l === '    // ===== ITER5-LEGACY-GENERATED:BEGIN =====')
const legacyEnd = L.findIndex((l) => l === '    // ===== ITER5-LEGACY-GENERATED:END =====')
const genBegins = L.map((l, i) => (l === '    // ITER5-GENERATED:BEGIN' ? i : -1)).filter((i) => i >= 0)
const genEnds = L.map((l, i) => (l === '    // ITER5-GENERATED:END' ? i : -1)).filter((i) => i >= 0)
const genB = genBegins.find((i) => i > legacyEnd)
const genE = genEnds.find((i) => i > genB)
ok(legacyBegin > 0 && legacyEnd > legacyBegin, '产物标记：legacy 块边界可定位')
ok(genB > 0 && genE > genB, '产物标记：v4 生成块边界可定位')

const classicFace = L.slice(0, legacyBegin).join('\n') + '\n' + L.slice(genE + 1).join('\n')
const v4Face = L.slice(genB, genE + 1).join('\n')

// 大括号配平取函数体（不用正则猜嵌套）
function bodyOf(text, sig) {
  const i = text.indexOf(sig)
  if (i < 0) return null
  const b = text.indexOf('{', i)
  if (b < 0) return null
  let d = 0
  for (let k = b; k < text.length; k++) {
    const c = text[k]
    if (c === '{') d += 1
    else if (c === '}') { d -= 1; if (!d) return text.slice(i, k + 1) }
  }
  return null
}
// 抽 set('<KEY>', <表达式>)：配平到该实参结束，空白归一
function setExprs(text) {
  const out = new Map()
  const re = /set\('([A-Za-z0-9_]+)',\s*/g
  let m
  while ((m = re.exec(text))) {
    const key = m[1]
    let i = m.index + m[0].length
    let d = 0, q = null, j = i
    for (; j < text.length; j += 1) {
      const c = text[j]
      if (q) { if (c === '\\') { j += 1; continue } if (c === q) q = null; continue }
      if (c === "'" || c === '"' || c === '`') { q = c; continue }
      if (c === '(' || c === '[' || c === '{') d += 1
      else if (c === ')' || c === ']' || c === '}') { if (!d) break; d -= 1 }
      else if (c === ',' && !d) break
    }
    const expr = text.slice(i, j).replace(/\s+/g, ' ').trim()
    if (!out.has(key)) out.set(key, [])
    out.get(key).push(expr)
  }
  return out
}

// ============================ ① 签名级 ============================
const COMPONENTS = [
  { name: 'Settings', classicSig: '    function SettingsPage() {', iter5Sig: 'function Iter5Settings(props) {', genAnchor: "readFileSync(path.join(root, 'skins/iter5/settings-source.js')", frozen: true },
  { name: 'Storage', classicSig: '    function StorageTab(props) {', iter5Sig: 'function Iter5Storage(props) {', genAnchor: '    function StorageTab(props) {', frozen: true },
  { name: 'Skills', classicSig: '    function MemoryHubTab(props) {', iter5Sig: 'function Iter5Skills(props) {', genAnchor: '    function MemoryHubTab(props) {', frozen: true },
  // Stats：frozen 侧无 Iter5Stats —— 旧款皮肤的统计页由宿主托管（frozen 内 'stats' 走 i5-hosted 卡），
  //   故此处只要求 classic/v4 两面 + 生成器切片锚在。这是**已核实的事实**，不是放宽。
  { name: 'Stats', classicSig: 'function StatsTab() {', iter5Sig: 'function Iter5Stats() {', genAnchor: 'function StatsTab() {', frozen: false },
]
for (const c of COMPONENTS) {
  ok(cnt(classicFace, c.classicSig) === 1, '签名级：classic 面有 ' + c.name + ' 定义（' + c.classicSig.trim() + '）')
  // Storage 的切片锚合法出现 2 次：storage 切片起锚 + skills 切片终锚（同一目标串被复用）。
  const wantAnchors = c.name === 'Storage' ? 2 : 1
  ok(cnt(genSrc, c.genAnchor) === wantAnchors, '签名级：生成器有 ' + c.name + ' 的切片锚（' + wantAnchors + ' 处）')
  if (c.frozen) ok(cnt(frozen, c.iter5Sig) === 1, '签名级：frozen 面有 ' + c.name + ' 对应定义（' + c.iter5Sig.trim() + '）')
  else ok(cnt(frozen, c.iter5Sig) === 0, '签名级：frozen 面按事实无 ' + c.name + ' 对应定义（宿主托管统计页）')
}
ok(cnt(v4Face, 'function Iter5Settings(props) {') === 1, '签名级：v4 面有 Iter5Settings 定义')
ok(cnt(v4Face, 'function Iter5Storage(props) {') === 1, '签名级：v4 面有 Iter5Storage 定义')
ok(cnt(v4Face, 'function Iter5Skills(props) {') === 1, '签名级：v4 面有 Iter5Skills 定义')
ok(cnt(v4Face, 'function Iter5Stats() {') === 1, '签名级：v4 面有 Iter5Stats 定义')

// ============================ ② 表达式级 ============================
const canonical = norm(readFileSync(path.join(ROOT,'skins/iter5/settings-source.js'),'utf8'))
ok(bodyOf(classicFace,'    function SettingsPage() {').includes("h(DamSharedSettings, { draftScope: 'workbench' })"),'classic workbench delegates to the shared implementation')
ok(bodyOf(frozen,'function Iter5Settings(props) {').includes('return h(DamSharedSettings, props)'), 'frozen delegates to the shared implementation')
const classicSettings = bodyOf(canonical, '    function SettingsPage() {')
const v4Settings = bodyOf(v4Face, 'function Iter5Settings(props) {')
const frozenSettings = v4Settings // The verified frozen delegate reaches this exact shared root.
ok(!!classicSettings && !!frozenSettings && !!v4Settings, '表达式级：三面 Settings 函数体均可配平抽取')

// (a) pyOk 真值表达式三面逐字一致
//   ★2026-10-03（G1-5/#197）：后端状态枚举已换血为 verified-ok/ready-unverified/…，前端旧白名单仍是
//   rt.state === 'ready' ⇒ 真机 verified-ok 时读数行恒显「不可用」。三面同改并保留 'ready' 兼容旧缓存。
const PYOK = "(rt.state === 'verified-ok' || rt.state === 'ready') && rt.depsOk !== false"
ok(cnt(classicSettings, PYOK) === 1 && cnt(frozenSettings, PYOK) === 1 && cnt(v4Settings, PYOK) === 1,
  'pyOk 判定三面逐字一致：' + PYOK + (cnt(frozenSettings, PYOK) !== 1 ? ' ' + MIRROR_HINT : ''))

// (b) set 键集：frozen ⊇ classic
const kClassic = setExprs(classicSettings), kFrozen = setExprs(frozenSettings), kV4 = setExprs(v4Settings)
ok(kClassic.size > 0 && kFrozen.size > 0 && kV4.size > 0, 'set 键集可抽取（classic ' + kClassic.size + ' / frozen ' + kFrozen.size + ' / v4 ' + kV4.size + '）')
const missing = [...kClassic.keys()].filter((k) => !kFrozen.has(k))
ok(missing.length === 0, '键集 frozen ⊇ classic（缺：' + JSON.stringify(missing) + '）' + (missing.length ? MIRROR_HINT : ''))
const missingV4 = [...kV4.keys()].filter((k) => !kFrozen.has(k))
ok(missingV4.length === 0, '键集 frozen ⊇ v4（缺：' + JSON.stringify(missingV4) + '）')

// (c) 三面共有键的表达式比对 + 豁免
// ★豁免表（自清算）：登记「已核实的既存漂移」并指向修复批次；三面一旦一致，本守卫会红并要求删除该条。
// ★2026-10-03（G1-1 收口）：原唯一豁免条目 snapshotMinGapRounds 已按 §G1-1 修复
//   （frozen:1470 改 normalizeGapRounds(e.target.value, 5)），三面一致 ⇒ 按本套件自清算纪律删除豁免。
//   保留空数组（而不是删掉常量）：下一处既存漂移仍走「登记 → 描述修复批次 → 修好后删条」的同一通道。
const KNOWN_DRIFT = []
const driftByKey = new Map(KNOWN_DRIFT.map((d) => [d.key, d]))
const shared = [...kClassic.keys()].filter((k) => kFrozen.has(k) && kV4.has(k))
let unknownDrift = 0
for (const key of shared) {
  const a = kClassic.get(key).join(' | '), b = kFrozen.get(key).join(' | '), c = kV4.get(key).join(' | ')
  const equal = a === b && b === c
  const ex = driftByKey.get(key)
  if (equal) {
    if (ex) { fail++; console.error('  FAIL - 豁免已过期：[' + key + '] 三面已一致，请从 frozen-mirror 的 KNOWN_DRIFT 删除该条') }
    continue
  }
  if (!ex) {
    unknownDrift += 1
    console.error('  FAIL - 三面表达式漂移 [' + key + ']：classic=' + a.slice(0, 90) + ' | frozen=' + b.slice(0, 90) + ' | v4=' + c.slice(0, 90) + ' ' + MIRROR_HINT)
  } else {
    const stillExpected = ex.expect.classic === a && ex.expect.frozen === b && ex.expect.v4 === c
    if (!stillExpected) {
      unknownDrift += 1
      console.error('  FAIL - 已登记漂移 [' + key + '] 的形态变了（豁免描述过期）：classic=' + a.slice(0, 70) + ' | frozen=' + b.slice(0, 70) + ' | v4=' + c.slice(0, 70) + ' ' + MIRROR_HINT)
    }
  }
}
ok(unknownDrift === 0, '三面共有的 ' + shared.length + ' 个 set 键中，未登记漂移 = 0')
const usedExempt = KNOWN_DRIFT.filter((d) => shared.includes(d.key) && !(kClassic.get(d.key).join(' | ') === kFrozen.get(d.key).join(' | ') && kFrozen.get(d.key).join(' | ') === kV4.get(d.key).join(' | ')))
ok(usedExempt.length === KNOWN_DRIFT.length, '全部豁免条目都仍在使用（现 ' + usedExempt.length + '/' + KNOWN_DRIFT.length + '）')

// (c2) ★2026-10-03（G1-1 反复发守卫）：damSkinCssText 函数体内**不得有 function 定义**。
//   v3.2.6 的 #160-7 修复把 normalizeGapRounds 插进了 damSkinCssText() 函数体内，而全部调用点
//   （legacy 块 / v4 块 / 手写 SettingsPage / frozen）都在别的作用域 ⇒ 词法不可达，任一数字输入
//   onChange 即 ReferenceError，值根本存不进去。判据：该函数体一旦再出现内嵌 function 声明即红。
{
  const body = bodyOf(classicFace, '    function damSkinCssText() {')
  ok(!!body, 'G1-1：classic 面可配平抽取 damSkinCssText 函数体')
  if (body) {
    const inner = body.slice(body.indexOf('{') + 1, body.lastIndexOf('}'))
    const defs = (inner.match(/(^|\n)\s*function\s+[A-Za-z_$][\w$]*\s*\(/g) || []).map((d) => d.trim())
    // damLegacyOverlayGlass 是该函数体内的**既存**嵌套定义（H35 经典档浮层玻璃，先于本缺陷存在，
    // 且在 classic 分支内被自身调用 ⇒ 词法可达）；判据只禁止**新增**嵌套定义，正是 G1-1 的致害形态。
    const allowed = ['function damLegacyOverlayGlass(']
    const bad = defs.filter((d) => allowed.indexOf(d) < 0)
    ok(bad.length === 0, 'G1-1：damSkinCssText 函数体内无**新增** function 定义（既存允许 ' + allowed.length + ' 项；越界 ' + bad.length + ' 处：' + JSON.stringify(bad.slice(0, 4)) + '）')
    ok(defs.indexOf('function normalizeGapRounds(') < 0, 'G1-1：normalizeGapRounds 未被挪回 damSkinCssText 函数体内（正是 v3.2.6 的致害位置）')
  }
  // 定义/调用点计数守恒（实测口径，与方案 §G1-1 的预估数不同，见下）：
  //   · 定义恰 1 处，且必须在工厂层（damSkinCssText 之前），否则三处调用点词法不可达；
  //   · client 内三面带共 9 个调用点 = classic 手写 3 + legacy 生成块 3 + v4 生成块 3；
  //   · frozen 源 3 个调用点（fSnapGap/slimEvery/fullEverySlims），镜像进 legacy 生成块。
  //   ★与方案 §G1-1 的「1 定义 + 10 调用（8 client + 2 frozen）」差异：方案写定时 frozen 侧 fSnapGap
  //     还是旧口径（2 个调用）、client 侧 fSnapGap 也还是 Number(v)||5；本批修好 fSnapGap 后三面各 +1，
  //     故选「定义 1 + 调用 12（client 9 + frozen 3）」这一实测数并写进入口，避免锁成过期常量。
  const defN = cnt(norm(readFileSync(CLIENT, 'utf8')), 'function normalizeGapRounds(value, fallback) {')
  ok(defN === 1, 'G1-1：normalizeGapRounds 定义恰 1 处（实际 ' + defN + '）')
  const defAt = norm(readFileSync(CLIENT, 'utf8')).indexOf('function normalizeGapRounds(value, fallback) {')
  const cssTextAt = norm(readFileSync(CLIENT, 'utf8')).indexOf('function damSkinCssText() {')
  ok(defAt > 0 && defAt < cssTextAt, 'G1-1：定义在 damSkinCssText 之前的工厂层（def@' + defAt + ' < cssText@' + cssTextAt + '）')
  const clientAll = norm(readFileSync(CLIENT, 'utf8'))
  const callN = cnt(clientAll, 'normalizeGapRounds(') - defN
  ok(callN === 3, 'G1-1：shared client keeps three normalization calls（actual ' + callN + '）')
  const legacyCallN = cnt(L.slice(legacyBegin, legacyEnd + 1).join('\n'), 'normalizeGapRounds(')
  ok(legacyCallN === 0, 'G1-1：legacy delegate has no copied settings normalization')
  const fCallN = cnt(frozen, 'normalizeGapRounds(')
  ok(fCallN === 0 && cnt(canonical,'normalizeGapRounds(') === 3, 'G1-1：frozen delegates; canonical source owns all three normalization calls')
}

// (d) 组件切片锚：三处关键锚串在生成器与经典面同源
// 每条的期望命中数按实际切片语句数给出（Storage 同时是 skills 的终锚 ⇒ 2）。
for (const [anchor, want] of [
  ["readFileSync(path.join(root, 'skins/iter5/settings-source.js')", 1],
  ["client.slice(client.indexOf('    function StorageTab(props) {'), client.indexOf('    function NotesTab() {'))", 1],
  ["client.slice(client.indexOf('    function MemoryHubTab(props) {'), client.indexOf('    function StorageTab(props) {'))", 1],
  ["client.slice(client.indexOf('function StatsTab() {'), client.indexOf('function WorkspaceTab() {'))", 1],
]) {
  ok(cnt(genSrc, anchor) === want, '生成器切片语句在位：' + anchor.slice(0, 72) + '…')
}

console.log('')
console.log('== frozen-mirror: PASS ' + pass + ' / FAIL ' + fail + ' ==')
if (fail) process.exit(1)
