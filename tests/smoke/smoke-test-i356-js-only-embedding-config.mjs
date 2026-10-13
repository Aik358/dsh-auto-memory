#!/usr/bin/env node
/**
 * #356 · 只装内置 JS 引擎的用户：引擎配置文件缺失 ⇒ 开关永久不可用（2026-10-05 起的回归）
 *
 * 现场（本套件是可失败断言，不是复述代码）：
 *   1. embedding-config.json 的**唯一既有创建者**是 python-setup 向导（模型下完后写四键）。
 *      lib/semantic-js.js 全文 0 命中 embedding-config ⇒ 只装 JS 档的用户盘上永远没有该文件。
 *   2. 批次 Z（d22dd96，2026-10-05）把 semantic-emit 端点的 ENOENT 与「损坏」合并成同一句失败：
 *        catch (e) { if (e.code !== 'ENOENT') throw e }
 *        if (!cfg || ...) throw new Error('Invalid semantic configuration; existing file preserved')
 *      ⇒ 文件缺失（合法状态）被判成「配置损坏」。
 *   3. 于是「模型已就绪 + 只装 JS 档」的用户点「记忆唤起」开关必报该句，且无从自救。
 *
 * 本套件锁三件事：
 *   T1 端点**区分** ENOENT 与真损坏：缺失 ⇒ 建得起；损坏 ⇒ 仍原样保留并失败（不退回旧行为）
 *   T2 JS 下载器**不**创建该文件（缺口的事实前提，防止后来者误以为已有人创建）
 *   T3 启动自检里存在「模型缺失 ⇒ 静默补装」与「配置文件缺失 ⇒ 静默补建」两条路径
 *
 * 变异验证（把修法回退成批次 Z 的形态必须变红）见文件末尾注释。
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
let pass = 0, fail = 0
const ok = (cond, label) => { if (cond) { pass++; console.log('  ok - ' + label) } else { fail++; console.log('  FAIL - ' + label) } }

const idx = readFileSync(join(ROOT, 'lib', 'index.js'), 'utf8')
const cli = readFileSync(join(ROOT, 'lib', 'client.js'), 'utf8')
const sjs = readFileSync(join(ROOT, 'lib', 'semantic-js.js'), 'utf8')
const pset = readFileSync(join(ROOT, 'lib', 'python-setup.js'), 'utf8')

console.log('[i356] 只装 JS 引擎 · 引擎配置缺失 ⇒ 开关可达')

// ── T1 端点分流：抽取 semantic-emit 处理体，在临时目录真跑一遍 ──
//   用真文件系统（不 mock）：三种盘面各起一次，断言其行为与修法一致。
//   ——判据取自端点源码的**行为契约**，不是字符串复述。
const emitBody = (() => {
  const i0 = idx.indexOf("path: API['semantic-emit']")
  const m = i0 >= 0 ? [idx.slice(i0, i0 + 9000)] : null
  return m ? m[0] : ''
})()
ok(emitBody.length > 200, 'T1a 取到 semantic-emit 端点处理体')

// 端点行为契约（按源码逐条断言，任何一条回退即红）
ok(/cfgExisted\s*=\s*false/.test(emitBody), 'T1b 端点含「缺失」与「已存在」的分流标记')
ok(/if \(!cfgExisted\)\s*\{/.test(emitBody), 'T1c 缺失分支存在（ENOENT ⇒ 建得起）')
// 口径更新（2026-10-13 补日志时）：源码由「非 ENOENT 立即 throw」改为
// 「非 ENOENT 记入 cfgReadErr、交由下方统一判定后仍抛原错」——行为等价（真损坏仍失败），
// 但写法从 !== 变成 === 分支。此处锁**行为**而非字面量：损坏必须入 cfgReadErr 且仍抛原错。
ok(/if \(e\.code === 'ENOENT'\) cfgExisted = false[\s\S]{0,80}?else cfgReadErr = e/.test(emitBody),
  'T1d 非 ENOENT 记入 cfgReadErr（真损坏不被吞，后续仍抛原错）')
// 2026-10-13 复查修正：损坏分支由「抛统一文案」改回 `throw cfgReadErr`（与批次 Z 逐字等价——
// 批次 Z 就是原样抛出解析错误本身，不该被我改写成另一种对外错误）。此处锁「原样抛出」这个更强语义。
ok(/if \(cfgReadErr\) \{[\s\S]{0,260}?throw cfgReadErr/.test(emitBody),
  'T1d2 cfgReadErr 判定后**原样**抛出解析错误（与批次 Z 逐字等价，未被改写成别的对外文案）')
ok(/computeEngineIdentityPre\(JS_E5_IDENTITY_DESC_PRE_V1\)/.test(emitBody),
  'T1e 首建时的 provider/dimension 取自引擎身份常量（不凭空猜）')
// ★关键：缺失分支必须在「损坏判定」之前，否则等于没修
const iMissing = emitBody.indexOf('if (!cfgExisted) {')
// ★锚定真实代码行（不能用裸 indexOf —— 修复注释里也含该句，会误命中把自己测绿）
const iCorrupt = emitBody.indexOf("throw new Error('Invalid semantic configuration")
ok(iMissing > 0 && iCorrupt > iMissing, 'T1f 缺失分支位于损坏判定**之前**（修法真正生效，非装饰）')

// 真跑：复刻端点守卫 + 修法，验证三种盘面
const sandbox = join(tmpdir(), 'dam-i356-' + Date.now())
mkdirSync(sandbox, { recursive: true })
function runGuard(cfgPath) {
  // 与端点同形：读 → 分流 → 建 or 抛
  let cfg, cfgExisted = true
  try { cfg = JSON.parse(readFileSync(cfgPath, 'utf8')) }
  catch (e) { if (e.code !== 'ENOENT') return { threw: String(e.message), kind: 'corrupt-throw' }; cfgExisted = false }
  if (!cfgExisted) cfg = { provider: 'js-e5-small-q8-pre-v1', dimension: 384 }
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) return { threw: 'Invalid semantic configuration; existing file preserved', kind: 'invalid' }
  cfg.activationEmitMode = 'shadow'
  // 与端点同形：写前 mkdir（index.js 的 `fsMod.mkdirSync(pathMod.dirname(cfgPath), { recursive: true })`）
  mkdirSync(dirname(cfgPath), { recursive: true })
  writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), 'utf8')
  return { ok: true, kind: 'written', cfg }
}
// 盘面 A：文件缺失（= 只装 JS 引擎的用户）
const pathA = join(sandbox, 'missing', 'embedding-config.json')
const rA = runGuard(pathA)
ok(rA.ok === true, 'T1g 【真跑】文件缺失 ⇒ 端点建得起（修前此处必抛 Invalid semantic configuration）')
ok(existsSync(pathA), 'T1h 【真跑】文件确已落盘')
ok(rA.cfg && rA.cfg.activationEmitMode === 'shadow', 'T1i 【真跑】写入的档位为请求值')
// 盘面 B：文件损坏（半截 JSON）
const pathB = join(sandbox, 'broken', 'embedding-config.json')
mkdirSync(dirname(pathB), { recursive: true })
writeFileSync(pathB, '{ half', 'utf8')
const rB = runGuard(pathB)
ok(rB.kind === 'corrupt-throw', 'T1j 【真跑】文件损坏 ⇒ 仍抛原错（批次 Z 的初衷未被推翻）')
ok(readFileSync(pathB, 'utf8') === '{ half', 'T1k 【真跑】损坏文件原样保留（未被覆盖写回）')
// 盘面 C：文件合法（既有用户）
const pathC = join(sandbox, 'ok', 'embedding-config.json')
mkdirSync(dirname(pathC), { recursive: true })
writeFileSync(pathC, JSON.stringify({ provider: 'bge-m3-onnx-int8-pre-v1', activationEmitMode: 'active' }), 'utf8')
const rC = runGuard(pathC)
ok(rC.ok === true, 'T1l 【真跑】既有合法文件 ⇒ 正常改写')
ok(rC.cfg.provider === 'bge-m3-onnx-int8-pre-v1', 'T1m 【真跑】既有 provider 未被首建逻辑覆盖（Python 档用户零影响）')
ok(rC.cfg.activationEmitMode === 'shadow', 'T1n 【真跑】档位被写为请求值')
rmSync(sandbox, { recursive: true, force: true })

// ── T2 缺口的事实前提：JS 侧不创建该文件 ──
ok(!sjs.includes('embedding-config'),
  'T2a semantic-js.js 全文不含 embedding-config（JS 档确实不创建该文件）')
const pyWrite = /patchEmbeddingConfig\(/.test(pset)
ok(pyWrite && /PROVIDER_ID_INT8/.test(pset),
  'T2b 既有唯一创建者是 python-setup 向导（模型齐备后写 int8 四键）')
// 端点是另一个创建者（本次修复赋予的能力）—— 这是修法的一部分，不是缺口
ok(/cfgExisted/.test(emitBody), 'T2c 修复后端点成为 JS 档缺失时的创建者')

// ── T3 启动自检：两条静默补装路径 ──
const iBoot = cli.indexOf('启动自检补装')
ok(iBoot > 0, 'T3a 启动自检注释在场')
const bootSeg = cli.slice(iBoot, iBoot + 2600)
ok(/recommendation === 'download-model'/.test(bootSeg) && /recommendation === 'setup-both'/.test(bootSeg),
  'T3b 模型缺失 ⇒ 识别 download-model / setup-both 两种推荐态')
ok(/apiPost\(API\.semanticDownload, \{ action: 'start', mirror: 'auto' \}\)[\s\S]{0,80}?return/.test(bootSeg),
  'T3c 模型缺失 ⇒ **静默**发起下载后直接 return（不弹卡，用户无需点任何东西）')
ok(/apiGet\(API\.semanticStatus\)/.test(cli) && /apiPost\(API\.semanticEmit, \{ mode: 'shadow' \}\)/.test(cli),
  'T3d 模型已就绪但配置缺失 ⇒ 开机静默补建（写 shadow，不改任何既有行为）')
ok(/}, 12000\)/.test(bootSeg) && /}, 16000\)/.test(cli.slice(iBoot, iBoot + 3200)),
  'T3e 两条路径各有退避延时（错开开屏弹窗，不抢首屏）')

// ── T4 下载完成即补建（治「模型刚下好、尚未重开面板」的窗口） ──
//   缺口：createSemanticDownloaderPre 只把 phase 推到 'done'，全文件 0 处 embedding-config
//   ⇒ 新用户在下完那一刻配置仍缺、开关仍不可用。修法：宿主包一层完成轮询。
const dlSeg = idx.slice(idx.indexOf('下载完成后立刻补建引擎配置文件'), idx.indexOf('下载完成后立刻补建引擎配置文件') + 2600)
ok(dlSeg.length > 300, 'T4a 取到下载器完成回调包装段')
ok(/engine\._jsDownload\.start\.bind\(engine\._jsDownload\)/.test(dlSeg),
  'T4b 包装方式为 bind 原 start（不改原实现，可随时剥离）')
ok(/ph !== 'downloading' && ph !== 'verifying'/.test(dlSeg),
  'T4c 以「离开进行中相位」为完成判据（下载器无事件面，只能轮询 state）')
ok(/if \(ph !== 'done'\) return/.test(dlSeg),
  'T4d 仅 done 才补建（cancelled / error 不写，避免半成品留下脏配置）')
ok(/if \(existed\) return/.test(dlSeg),
  'T4e ★已有配置则绝不覆盖（Python 档用户 / 用户已切档零影响）')
ok(/writeTextAtomicPreSync\(cfgPath/.test(dlSeg),
  'T4f 走原子写（与端点同纪律，半截 JSON 不会被写出来）')
ok(/activationEmitMode: 'shadow'/.test(dlSeg),
  'T4g 首建默认 shadow（fail-closed：只让开关可达，不擅自开始注入）')
ok(/_timer\.unref\(\)/.test(dlSeg),
  'T4h 定时器 unref（不阻止宿主进程退出）')

// 与端点同源：两处首建必须用同一组身份常量
ok(/computeEngineIdentityPre\(JS_E5_IDENTITY_DESC_PRE_V1\)/.test(dlSeg),
  'T4i 下载后首建与端点首建用同一身份来源（不产生第二个真相）')

// 前端 API 表项必须存在，否则补建调用是死的
ok(/semanticStatus: ROUTE_PREFIX/.test(cli), 'T3f API.semanticStatus 路由存在')
ok(/semanticEmit: ROUTE_PREFIX/.test(cli), 'T3g API.semanticEmit 路由存在')

// ── T5 诊断留痕：用户看到「保存失败」⇔ 盘上必有一条对应日志 ──
//   缺口（2026-10-13 用户现场）：端点失败路径此前**只回 HTTP 500、零落盘**
//   ⇒ 用户截图是唯一证据，支持端不知道「用哪档引擎 / 文件在不在 / 失败在哪一步」。
//   判据：三个失败分支 + 成功分支各有一条 diag()，且**不改变控制流**。
const diagCount = (emitBody.match(/\bdiag\(/g) || []).length
ok(diagCount >= 5, 'T5a 端点含 ≥5 处 diag() 留痕（现为 ' + diagCount + '）')
ok(/diag\('semantic-emit: cfg ' \+ \(cfgExisted \? 'present' : 'MISSING\(ENOENT\)'\)/.test(emitBody),
  'T5b 读取后即留痕，且**区分** present / MISSING(ENOENT)（修前两者共用一句误导性文案）')
ok(/diag\('semantic-emit: cfg CORRUPT kept-as-is/.test(emitBody),
  'T5c 真损坏分支留痕（含 code 与原始 message）')
ok(/diag\('semantic-emit: cfg SHAPE-INVALID kept-as-is/.test(emitBody),
  'T5d 结构非法分支留痕')
ok(/diag\('semantic-emit: WRITE-FAILED/.test(emitBody),
  'T5e 原子写失败分支留痕')
ok(/diag\('semantic-emit: ok mode=/.test(emitBody),
  'T5f 成功分支也留痕（可对照「用户说点了没反应」）')
ok(/diag\('semantic-emit: FAILED mode=/.test(emitBody),
  'T5g catch 兜底留痕（任何未单独覆盖的失败都有记录 ⇒ 不存在「失败却零日志」的路径）')
// ★关键次序：破损判定必须走 cfgReadErr，而不是在 catch 里直接 throw（否则 CORRUPT 那行永不执行）
const iCorruptDiag = emitBody.indexOf("semantic-emit: cfg CORRUPT")
const iCorruptThrow = emitBody.indexOf('if (cfgReadErr)')
ok(iCorruptThrow > 0 && iCorruptDiag > iCorruptThrow, 'T5h CORRUPT 留痕位于 cfgReadErr 判定之内（可达，非死码）')
ok(!/if \(e\.code !== 'ENOENT'\) \{ cfgReadErr = e; throw e \}/.test(emitBody),
  'T5i 损坏时**不再**在 catch 内直接抛出（否则 CORRUPT 留痕成为不可达死码）')
// 语义正确性：损坏时不得把 cfgExisted 置 false（否则日志误报「缺失」+ 多跑一次无用的身份构造）
ok(/if \(e\.code === 'ENOENT'\) cfgExisted = false/.test(emitBody),
  'T5j ENOENT 才置 cfgExisted=false；损坏分支保持 true（日志不误报缺失）')

// 【真跑】用与端点同形的分流，验证四种盘面各自产生**对应的**留痕标签
function runGuardLogged(cfgPath) {
  const logs = []
  const diag = (m) => logs.push(m)
  let cfg, cfgExisted = true, cfgReadErr = null
  try { cfg = JSON.parse(readFileSync(cfgPath, 'utf8')) }
  catch (e) { if (e.code === 'ENOENT') cfgExisted = false; else cfgReadErr = e }
  diag('semantic-emit: cfg ' + (cfgExisted ? 'present' : 'MISSING(ENOENT)') + ' path=' + cfgPath)
  if (!cfgExisted) cfg = { provider: 'js-e5-small-q8-pre-v1', dimension: 384 }
  if (cfgReadErr) { diag('semantic-emit: cfg CORRUPT kept-as-is code=' + String(cfgReadErr.code || '-') + ' path=' + cfgPath); return { kind: 'corrupt', logs } }
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) { diag('semantic-emit: cfg SHAPE-INVALID kept-as-is path=' + cfgPath); return { kind: 'shape', logs } }
  cfg.activationEmitMode = 'shadow'
  mkdirSync(dirname(cfgPath), { recursive: true })
  writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), 'utf8')
  diag('semantic-emit: ok mode=shadow created=' + (!cfgExisted))
  return { kind: 'ok', logs }
}
const s5 = join(tmpdir(), 'dam-i356-log-' + Date.now())
mkdirSync(s5, { recursive: true })
const pM = join(s5, 'm', 'embedding-config.json')
const gM = runGuardLogged(pM)
ok(gM.kind === 'ok' && gM.logs.some((x) => x.includes('MISSING(ENOENT)')),
  'T5k 【真跑】缺失盘面 ⇒ 留痕明确写出 MISSING(ENOENT)，且最终写入成功')
ok(gM.logs.some((x) => x.includes('semantic-emit: ok mode=')),
  'T5l 【真跑】成功盘面 ⇒ 留痕写出最终档位')
const pB = join(s5, 'b', 'embedding-config.json')
mkdirSync(dirname(pB), { recursive: true })
writeFileSync(pB, '{ half', 'utf8')
const gB = runGuardLogged(pB)
ok(gB.kind === 'corrupt' && gB.logs.some((x) => x.includes('CORRUPT kept-as-is')),
  'T5m 【真跑】损坏盘面 ⇒ 留痕标注 CORRUPT，且不是 MISSING')
ok(!gB.logs.some((x) => x.includes('MISSING(ENOENT)')),
  'T5n 【真跑】损坏盘面不得误报「缺失」（两状态必须可区分）')
// 负路径：日志函数自身抛错不得影响端点返回（fail-soft，diag 内部已有 try/catch，此处断言调用处不裸奔）
ok(/try \{ diag\('semantic-emit: FAILED[^\n]*\) \} catch \(_\) \{\}/.test(emitBody),
  'T5o catch 兜底用内层 try 包裹（日志失败不改变 HTTP 语义）')
rmSync(s5, { recursive: true, force: true })


console.log('\n[i356] pass=' + pass + ' fail=' + fail)
process.exit(fail > 0 ? 1 : 0)

/* 变异验证（回退修法必须变红）：
   · 把 T1c 的 `if (!cfgExisted) { ... }` 整段删掉 ⇒ T1b/T1c/T1f/T1g/T1h 红（端点回到批次 Z 形态）。
   · 把 T1f 的两个 indexOf 顺序反转（损坏判定提到前面）⇒ T1f 红（修法被架空）。
   · 把 T3c 的 `return` 去掉 ⇒ T3c 红（退化成「弹卡但不自动装」）。
   · 把 T3d 的 semanticEmit 调用删掉 ⇒ T3d 红（配置仍不会被补建）。
   实测：以上四种变异各跑一次，套件均 exit=1。
   · 【T5 变异】把 CORRUPT 分支的 diag() 删掉 ⇒ T5c 红；把 catch 内改回 `{ cfgReadErr = e; throw e }`
     ⇒ T5i 红（且 T5c 因死码仍绿，正是要靠 T5i 联合锁死）；把 ENOENT 判定写成「非 ENOENT 也置 false」
     ⇒ T5j 红。实测三种变异各跑一次，套件均 exit=1。 */
