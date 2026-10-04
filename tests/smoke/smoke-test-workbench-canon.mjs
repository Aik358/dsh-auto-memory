/** ★2026-10-05 工作台路径归一（符号链接等价）行为级守卫。
 *  来源：社区报告（Android 真机，v3.2.8）——`/data/user/0` → `/data/data` 是符号链接，宿主把
 *  `header.cwd`/工作区登记归一成 realpath 写法，而 `DSH_HOME` 环境变量给的是别名写法；
 *  旧代码 `path.resolve` 字面比较不解析符号链接 ⇒ 三重校验第①项恒判 `cwd-mismatch`
 *  ⇒ 工作台永不就绪、9 类后台记忆子代理全部静默停摆、且每次重试都新建一个「记忆中枢」会话（真机 16 个）。
 *
 *  本套件两类断言：
 *  ①【主流平台 parity】无符号链接时 `_canonPath` 必须是恒等映射（逐字节相等），
 *    `_workbenchCwd` 新旧产出逐字节一致 —— 保证 Windows/macOS/Linux 行为不变（用户硬性要求）。
 *  ②【符号链接等价】用真实 junction/symlink 复现 Android 场景：旧判据必错（红），新判据必对（绿）；
 *    并覆盖「显式 workbenchRoot 写成另一种别名 ⇒ 旧代码静默丢弃配置」的同族缺陷（原 9422 行）。
 *
 *  全程使用真实 `MemoryEngine` 方法（非复刻逻辑），临时目录结束清理。 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { MemoryEngine } from '../lib/audit-engine.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
let P = 0, F = 0
const ck = (name, ok, detail) => {
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (ok ? '' : '  ' + String(detail || '')))
  ok ? P++ : F++
}

const canon = (eng, p) => eng._canonPath(p)
// 旧判据（v3.2.8 及之前）与旧产出，仅用于对照证明： mainstream 恒等 / 别名场景必错。
const oldCmp = (a, b) => path.resolve(a) !== path.resolve(b)
const oldWorkbenchCwd = (eng) => {
  const raw = String(eng.config.workbenchRoot || '').trim()
  const fallback = path.join(dshHomeLive(), 'aik_auto_memory_use')
  if (!raw) return fallback
  let p = ''
  try { p = String(eng.expandUserPath(raw) || '') } catch (e) { return fallback }
  if (!p || !path.isAbsolute(p)) return fallback
  try {
    const rel = path.relative(dshHomeLive(), p)
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return fallback
  } catch (e) { return fallback }
  return p
}
// dshHome() 读进程环境变量（每次调用现取），测试内以 env 控制两侧写法。
const dshHomeLive = () => {
  const env = process.env.DSH_HOME
  if (env && String(env).trim()) return String(env).trim()
  return path.join(os.homedir(), '.dsh')
}

// ★本机坑（实测）：`os.tmpdir()` 走 TEMP 环境变量，可能给 **8.3 短名**（JHZ~1）；
//   `realpathSync`（JS 版）不展开短名，`realpathSync.native`（libuv）**会**展开成长名。
//   parity 断言的输入必须先用 native 归一成干净形态，否则测的是「短名→长名」而非「符号链接等价」。
//   （这同时实证：宿主写长名、env 给短名的 Windows 机器上旧代码同样恒 mismatch ——
//    与 Android 是同一类缺陷的本机变体，归一修复顺带治好，详见下方 ②③。）
const tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'wb-canon-')))
try {
  const eng = new MemoryEngine()
  eng.configLoaded = true

  console.log('\n══ ① 主流平台 parity：无符号链接 ⇒ 归一 = 恒等映射 ══')
  const plain = path.join(tmp, 'plain')
  fs.mkdirSync(plain, { recursive: true })
  const deepMissing = path.join(tmp, 'no-such', 'deeper', 'leaf')
  const underMissing = path.join(tmp, 'no-such2')
  fs.mkdirSync(path.dirname(underMissing), { recursive: true })
  ck('既有目录：canon(x) === x（逐字节）', canon(eng, plain) === plain, canon(eng, plain))
  ck('父存在的缺失目录：canon(x) === x（逐字节，mkdir 前场景）', canon(eng, underMissing) === underMissing, canon(eng, underMissing))
  ck('深层缺失链：canon(x) === path.resolve(x)', canon(eng, deepMissing) === path.resolve(deepMissing), canon(eng, deepMissing))
  ck('空串 → 空串', canon(eng, '') === '')
  ck('相对路径 → resolve 形态', canon(eng, 'rel/x') === path.resolve('rel/x'))
  ck('尾随分隔符被归一（与旧 resolve 口径一致）', canon(eng, plain + path.sep) === plain, canon(eng, plain + path.sep))
  if (process.platform === 'win32') {
    ck('win32 大小写不同写法归一后相等（realpath 真值大小写）',
      canon(eng, plain.toLowerCase()) === canon(eng, plain.toUpperCase()), canon(eng, plain.toLowerCase()) + ' vs ' + canon(eng, plain.toUpperCase()))
    // 扩展前缀保险：旧版 libuv 的 realpathSync.native 会返回 `\\?\C:\...` 形态（新 Node 已不带），
    // _canonPath 必须剥回普通盘符路径 —— 否则与既有字面口径分叉（主流平台回归）。
    ck('win32 `\\?\\` 扩展前缀输入归一为普通盘符路径', canon(eng, '\\\\?\\' + plain) === plain, canon(eng, '\\\\?\\' + plain))
  }
  ck('新旧判据在普通路径上结论一致（mismatch 场景）',
    oldCmp(plain, underMissing) === (canon(eng, plain) !== canon(eng, underMissing)))
  ck('新旧判据在普通路径上结论一致（match 场景）',
    oldCmp(plain, plain) === (canon(eng, plain) !== canon(eng, plain)))

  console.log('\n══ ② 符号链接复现 Android：junction/symlink 别名 ⇄ realpath ══')
  const realHome = path.join(tmp, 'realhome')
  const linkHome = path.join(tmp, 'linkhome')
  fs.mkdirSync(path.join(realHome, '.dsh'), { recursive: true })
  fs.symlinkSync(realHome, linkHome, process.platform === 'win32' ? 'junction' : 'dir')
  const realDsh = path.join(realHome, '.dsh')
  const aliasDsh = path.join(linkHome, '.dsh')
  // Android 场景三要素：env 给别名、宿主写 realpath、目录本身尚不存在（首次建立）。
  process.env.DSH_HOME = aliasDsh
  const wantAlias = path.join(aliasDsh, 'aik_auto_memory_use')
  const wantReal = path.join(realDsh, 'aik_auto_memory_use')
  const hostCwd = wantReal // 宿主 header.cwd = realpath 写法
  ck('前提：junction 生效（realpath(alias) === real）',
    fs.realpathSync(aliasDsh) === fs.realpathSync(realDsh))
  ck('【旧判据必错】path.resolve 字面比较 ⇒ 恒 cwd-mismatch（bug 复现）',
    oldCmp(hostCwd, wantAlias) === true)
  ck('【新判据必对】canon 两侧归一后相等', canon(eng, hostCwd) === canon(eng, wantAlias))
  ck('_workbenchCwd()（自动档）返回 realpath 写法 = 宿主口径（治本：下游 mkdir/登记/落盘全对齐）',
    eng._workbenchCwd() === wantReal, eng._workbenchCwd())
  ck('_workbenchCwd() 新旧产出在别名场景本就不同（证明修的是真缺陷）',
    oldWorkbenchCwd(eng) === wantAlias && eng._workbenchCwd() === wantReal)
  ck('目录已存在时同样归一（mkdir 之后再次校验的场景）', (() => {
    fs.mkdirSync(wantReal, { recursive: true })
    return canon(eng, hostCwd) === canon(eng, eng._workbenchCwd())
  })())

  console.log('\n══ ③ 同族缺陷：显式 workbenchRoot 写成另一种别名（原 9422 行静默丢配置）══')
  const customReal = path.join(realDsh, 'wb-custom')
  fs.mkdirSync(customReal, { recursive: true })
  eng.config.workbenchRoot = customReal // 用户按 realpath 写法配置
  ck('【旧产出】别名 DSH_HOME 下合法配置被判逃出 dshHome ⇒ 静默回默认',
    oldWorkbenchCwd(eng) === wantAlias)
  ck('【新产出】归一后包含判定通过 ⇒ 配置生效（且返回 realpath 形态）',
    eng._workbenchCwd() === canon(eng, customReal), eng._workbenchCwd())
  eng.config.workbenchRoot = aliasDsh + path.sep + 'wb-custom' // 用户按别名写法配置
  ck('别名写法配置同样生效（两种写法殊途同归）',
    eng._workbenchCwd() === canon(eng, customReal), eng._workbenchCwd())
  eng.config.workbenchRoot = path.join(tmp, 'outside', 'wb') // 真逃逸：必须仍被拒
  ck('真逃逸（归一后仍在 dshHome 之外）⇒ fail-soft 回默认（安全语义未变）',
    eng._workbenchCwd() === path.join(realDsh, 'aik_auto_memory_use'), eng._workbenchCwd())
  eng.config.workbenchRoot = ''

  console.log('\n══ ④ 主流 parity（无别名）：_workbenchCwd 新旧产出逐字节一致 ══')
  process.env.DSH_HOME = realDsh // 不经过任何符号链接
  ck('自动档：新旧产出逐字节相等', eng._workbenchCwd() === oldWorkbenchCwd(eng), eng._workbenchCwd())
  eng.config.workbenchRoot = path.join(realDsh, 'wb-custom')
  ck('显式配置档：新旧产出逐字节相等', eng._workbenchCwd() === oldWorkbenchCwd(eng), eng._workbenchCwd())
  ck('登记比较归一在无符号链接时结论与旧判据一致',
    (() => {
      const norm = (v) => String(v || '').replace(/[\\/]+$/, '').toLowerCase()
      const list = [{ path: customReal }]
      const cwd = customReal
      const oldOk = list.some((w) => norm(w.path) === norm(cwd))
      const newOk = list.some((w) => norm(eng._canonPath(w.path)) === norm(eng._canonPath(cwd)))
      return oldOk === newOk
    })())

  console.log('\n══ ⑤ 源码形态守卫：四处比较点 + 熔断（防回流）══')
  const idx = fs.readFileSync(path.join(ROOT, 'lib/index.js'), 'utf8')
  ck('import 引入 realpathSync', /import \{[^}]*\brealpathSync\b[^}]*\} from 'node:fs'/.test(idx))
  ck('_canonPath 存在', /_canonPath\(p\) \{/.test(idx))
  ck('verify 第①项走归一（不再 path.resolve 字面比较）',
    /this\._canonPath\(cwd\) !== this\._canonPath\(this\._workbenchCwd\(\)\)/.test(idx)
    && !/path\.resolve\(cwd\) !== path\.resolve\(this\._workbenchCwd\(\)\)/.test(idx))
  ck('登记比较走归一', /norm\(this\._canonPath\(w\.path\)\) === wsPath/.test(idx))
  ck('包含判定走归一', /path\.relative\(this\._canonPath\(dshHome\(\)\), this\._canonPath\(p\)\)/.test(idx))
  ck('新建熔断存在（同 (epoch, 原因) 连 3 败停新建）',
    /create-breaker:/.test(idx) && /_wbCreateFailStreak/.test(idx) && /count >= 3/.test(idx))
  ck('熔断成功即清零', /this\._wbCreateFailStreak = null/.test(idx))
  ck('熔断不得拦复用分支（检查点在新建路径上）',
    idx.indexOf('create breaker tripped') > idx.indexOf("reason: 'session-not-loaded', epoch, sessionId: v.sessionId, transient: true, retry: true"))

  console.log('\nPASS ' + P + ' / FAIL ' + F)
  process.exit(F ? 1 : 0)
} finally {
  delete process.env.DSH_HOME
  try { fs.rmSync(tmp, { recursive: true, force: true }) } catch (e) {}
}
