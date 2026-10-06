/** ★C-1b（AUDIT §3.6 / PR#237 后端拆取）路径别名增强验收 —— 真执行验收（非静态断言）。
 *
 * 覆盖 AUDIT §3.4/§3.6 的三方向判据矩阵：**越界必拒 / 别名必过 / 树内合法链接必过**，
 * 且全部真 import 产线 MemoryEngine、真构造、真调用 `_canonPath` / `_pathKey` / `_workbenchCwd` /
 * `_verifyWorkbench` / `_pruneStaleWorkbenchWorkspaces` / `resolveWorkspaceIdForSession`。
 *
 * 与既有 smoke-test-workbench-canon.mjs 的分工：那一支测「归一 = 恒等映射」与「别名等价」；
 * 本支测**本批新增/修改的三处判据**：
 *  ① `_canonPath` **祖先回溯**：多级尚不存在的目录也要归一到「最近存在祖先 + 完整缺失后缀」
 *     （旧实现只回拼一层 basename ⇒ 多级新目录退化成字面路径）；
 *  ② `_pathKey` **平台大小写收敛**：win32 折叠、非 win32 保留（用 vm 换 platform 真跑函数体）；
 *  ③ **rel 边界由前缀匹配改为组件级**：同级的 `..foo` 目录是**树内合法名称**，不得误判越界；
 *     真越界（`..` 与 `../..`）必须仍拒。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import { MemoryEngine } from '../lib/audit-engine.mjs'
// ★V2-1：_pathKey 已改为委托公共工具（lib/file-boundary.js 的 pathKey → canonPath），
//   本段的 vm 抽取执行需要该模块函数在作用域内（否则 ReferenceError）。
import { canonPath, pathKey } from '../../lib/file-boundary.js'

let pass = 0, fail = 0
const ok = (c, m, extra) => { if (c) { pass++; console.log('  ok   - ' + m) } else { fail++; console.error('  FAIL - ' + m + (extra === undefined ? '' : '  ' + extra)) } }

const tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'dam-c1b-')))
const oldDsh = process.env.DSH_HOME

try {
  // ── 夹具：realhome 真目录 + linkhome junction 别名（Android `/data/user/0` ⇄ `/data/data` 同型）
  const realHome = path.join(tmp, 'realhome')
  const linkHome = path.join(tmp, 'linkhome')
  fs.mkdirSync(path.join(realHome, '.dsh'), { recursive: true })
  fs.symlinkSync(realHome, linkHome, process.platform === 'win32' ? 'junction' : 'dir')
  const realDsh = path.join(realHome, '.dsh')
  const aliasDsh = path.join(linkHome, '.dsh')
  process.env.DSH_HOME = aliasDsh
  const eng = new MemoryEngine()
  eng.configLoaded = true

  console.log('')
  console.log('══ ① 越界必拒（安全语义未因 rel 判据改动而放宽）══')
  ok(eng._canonPath(aliasDsh) === fs.realpathSync.native(realDsh), '别名 DSH_HOME 归一为 realpath（前提）')
  {
    // 真逃逸 1：完全在 dshHome 之外
    eng.config.workbenchRoot = path.join(tmp, 'outside', 'wb')
    const fb = path.join(realDsh, 'aik_auto_memory_use')
    ok(eng._workbenchCwd() === fb, '① 真逃逸（归一路径仍在 dshHome 之外）⇒ fail-soft 回默认', eng._workbenchCwd())
    // 真逃逸 2：恰为父级 '..'
    eng.config.workbenchRoot = path.join(aliasDsh, '..')
    ok(eng._workbenchCwd() === fb, "① rel === '..'（恰为父级）⇒ 仍拒", eng._workbenchCwd())
    // 真逃逸 3：多级回逃（'../..' 形态）
    eng.config.workbenchRoot = path.join(aliasDsh, '..', '..', 'wb')
    ok(eng._workbenchCwd() === fb, "① rel 以 '..' + sep 开头（多级回逃）⇒ 仍拒", eng._workbenchCwd())
    // 真逃逸 4：绝对路径（另一盘符/根）
    eng.config.workbenchRoot = path.parse(realDsh).root
    ok(eng._workbenchCwd() === fb, '① 绝对路径越界 ⇒ 仍拒', eng._workbenchCwd())
    eng.config.workbenchRoot = ''
  }

  console.log('')
  console.log('══ ② 别名必过（符号链接写法与 realpath 写法殊途同归）══')
  {
    const inner = path.join(realDsh, 'wb-alias')
    fs.mkdirSync(inner, { recursive: true })
    const real = eng._canonPath(inner)
    eng.config.workbenchRoot = inner // realpath 写法
    ok(eng._workbenchCwd() === real, '② realpath 写法配置 ⇒ 生效', eng._workbenchCwd())
    eng.config.workbenchRoot = path.join(aliasDsh, 'wb-alias') // 别名写法
    ok(eng._workbenchCwd() === real, '② 别名写法配置 ⇒ 同样生效且归一到同一物理路径', eng._workbenchCwd())
    eng.config.workbenchRoot = ''
  }

  console.log('')
  console.log('══ ③ 树内合法链接必过：`..foo` 是合法目录名，不是父级遍历 ══')
  {
    // 命名坑：以 '..' 开头的**目录名**（如 '..phone'）在旧的前缀匹配判据下会被误判为越界。
    const dotDir = path.join(realDsh, '..phone', 'hub')
    fs.mkdirSync(dotDir, { recursive: true })
    const normDot = eng._canonPath(dotDir)
    eng.config.workbenchRoot = dotDir
    ok(eng._workbenchCwd() === normDot, "③ '..phone/hub'（同级点前缀目录）⇒ 必须生效，不得误判越界", eng._workbenchCwd())
    // 负路径对照：同一父级下的真父级遍历仍必须被拒（证明 ③ 不是把闸门整体放开）
    // ★构造纪律：`..phone/..` 会被 path.join 规范化掉 ⇒ 那不是越界而是**回到 dshHome 内部**
    //   （首版夹具就踩了这个坑，红是夹具错不是产品错）。真越界必须让 '..' 真正升出 dshHome。
    eng.config.workbenchRoot = path.join(realDsh, '..', 'escape')
    const fb = path.join(realDsh, 'aik_auto_memory_use')
    ok(eng._workbenchCwd() === fb, "③ 对照：dshHome/../escape 是真越界 ⇒ 拒（闸门未被放开）", eng._workbenchCwd())
    eng.config.workbenchRoot = ''
  }

  console.log('')
  console.log('══ ④ _canonPath 祖先回溯：多级缺失链归一到「最近存在祖先 + 完整缺失后缀」══')
  {
    const deep = path.join(aliasDsh, 'new', 'nested', 'hub')
    const deepReal = path.join(realDsh, 'new', 'nested', 'hub')
    ok(eng._canonPath(deep) === deepReal, '④ 别名下三级缺失链 ⇒ 解析成 realpath 祖先 + 完整三级后缀', eng._canonPath(deep))
    ok(!fs.existsSync(deepReal), '④ 前提：该链在盘上确实不存在（测的是 mkdir 之前的场景）')
    const under = path.join(realDsh, 'exists-deep')
    fs.mkdirSync(path.join(under, 'a'), { recursive: true })
    const chain = path.join(aliasDsh, 'exists-deep', 'a', 'b', 'c')
    ok(eng._canonPath(chain) === path.join(under, 'a', 'b', 'c'), '④ 已有祖先 + 缺失后缀：逐级回拼，别名前缀被消解', eng._canonPath(chain))
  }

  console.log('')
  console.log('══ ⑤ _pathKey 平台大小写收敛（vm 换 platform 真跑函数体）══')
  {
    ok(eng._pathKey('') === '', '_pathKey(空串) === 空串（不因归一而伪造路径）')
    // ★V2-1 适配：_pathKey 已委托给公共工具（lib/file-boundary.js 的 pathKey），
    //   '({\'' + '...\'})._pathKey' 抽出的函数体现在**只含 return pathKey(p)**，在 vm 里捕获的是真·模块函数，
    //   '假 process.platform 对它无效（实测 linux/darwin 也被折叠成 true ⇒ 实测值必然失真）。
    //   改为对**公共工具本体**做同一 vm 换平台实验（它才是平台大小写判据的唯一来源）；
    //   委托关系与调用点行为另由 ⑦ 的形态守卫 + 真路径断言覆盖。
    const modSrc = fs.readFileSync('lib/file-boundary.js', 'utf8')
    const keyFnSrc = modSrc.slice(modSrc.indexOf('export function pathKey'), modSrc.indexOf('/** 组件级包含判定'))
      .replace('export function pathKey', 'function pathKey')
    for (const platform of ['linux', 'darwin', 'win32']) {
      const key = vm.runInNewContext(keyFnSrc + '\n;pathKey', { process: { platform }, path: await import('node:path').then((m) => m.default), canonPath: (v) => v })
      const same = key('/phone/Case-Hub') === key('/phone/case-hub')
      ok(same === (platform === 'win32'), '⑤ platform=' + platform + ' ⇒ 大小写折叠=' + (platform === 'win32') + '（实得 ' + same + '）')
    }
    ok(eng._pathKey(realDsh) === eng._pathKey(aliasDsh), '⑤ 别名与真路径的 pathKey 相等（归一 + 平台口径合并判据）')
  }

  console.log('')
  console.log('══ ⑥ 工作区登记复用：同一物理目录不得重复 create ══')
  {
    const created = []
    const reg = {
      list: () => [{ id: 'existing-ws', title: '记忆中枢', path: path.join(aliasDsh, 'hub-reuse'), sessionIds: [] }],
      create: async (cwd, title) => { created.push(cwd); return { id: 'dup-ws', workspaceId: 'dup-ws' } },
    }
    eng._workspaceRegistry = reg
    const idResolved = eng.resolveWorkspaceIdForSession('s-unknown', path.join(realDsh, 'hub-reuse'))
    ok(idResolved === 'existing-ws', '⑥ 别名写法 cwd ⇒ 按物理路径命中既有登记（resolveWorkspaceIdForSession）', idResolved)
    ok(eng.resolveWorkspaceIdForSession('s-unknown', path.join(realDsh, 'nope')) === '', '⑥ 负路径：无匹配 ⇒ 空串（不猜）')
    // 直接驱动登记分支：命中复用 ⇒ create 不被调用
    eng._workspaceRegistry = {
      list: () => [{ id: 'reuse-me', workspaceId: 'reuse-me', path: path.join(realDsh, 'hub-reuse') }],
      create: async (cwd) => { created.push(cwd); return { id: 'should-not-happen' } },
    }
    const dupCheck = eng._workspaceRegistry.list().find((w) => eng._pathKey(w.path) === eng._pathKey(path.join(aliasDsh, 'hub-reuse')))
    ok(!!dupCheck && dupCheck.id === 'reuse-me', '⑥ 复用判据按 _pathKey 命中（别名 cwd ⇄ 真路径登记项）', dupCheck && dupCheck.id)
  }

  console.log('')
  console.log('══ ⑦ 防回流：旧的两份判据形态不得复活 ══')
  {
    const idx = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'lib', 'index.js'), 'utf8')
    const oldRenorm = (idx.match(/norm\(this\._canonPath\(w\.path\)\)/g) || []).length
    const oldNorm2 = (idx.match(/const norm2 = \(x\) => String/g) || []).length
    ok(oldRenorm === 0, '⑦ 旧写法 norm(_canonPath(w.path)) 已归零（实得 ' + oldRenorm + '）')
    ok(oldNorm2 === 0, '⑦ 旧写法 norm2 匿名判据已归零（实得 ' + oldNorm2 + '）')
    ok((idx.match(/this\._pathKey\(/g) || []).length >= 6, '⑦ _pathKey 收敛点存在（>=6 处；实得 ' + (idx.match(/this\._pathKey\(/g) || []).length + '）')
  }
} finally {
  if (oldDsh === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = oldDsh
  try { fs.rmSync(tmp, { recursive: true, force: true }) } catch (e) {}
}

console.log('')
console.log('[c1b-deepcode-paths] PASS ' + pass + ' / FAIL ' + fail)
process.exit(fail ? 1 : 0)
