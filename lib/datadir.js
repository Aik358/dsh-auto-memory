/**
 * 记忆数据目录的唯一收口（去 pre，2026-09-23）。
 *
 * 历史：目录名原为 `<name>-pre`。去 pre 后统一裸名。
 *
 * 迁移策略：**不 move，只增量补齐**。三条实测依据：
 *   ① 改名前活宿主仍在往旧目录写（hub-pre/facts.json 改名后仍有写入）⇒ move 会分脑丢数据；
 *   ② **裸名目录可能早已存在**（实测 `memory/hub/` 创建于 09-01、内含 3 个 0 条的 JSON 空壳），
 *      所以「新目录不存在才复制」这个判据会**整条跳过**，导致 56 条 procedures（108 KB）
 *      与 9.3 MB facts 在重启后全部不可见 —— 属数据丢失级缺陷；
 *   ③ 因而判据必须是**逐文件语义判据**，而不是「目录是否存在」。
 *
 * 逐文件规则（fail toward duplication, never toward loss）：
 *   · 目标缺失                → 复制
 *   · 目标在、源更「有内容」  → 复制（仅当目标被判定为**空壳**：能解析为 JSON 且集合为空）
 *   · 其余                    → 跳过（绝不覆盖已有真实数据）
 *
 * 三条纪律：
 *   ① 惰性：调用时机与原先的 path.join 完全一致（环境变量已就位，不会误写真实 home）
 *   ② 幂等：补齐过的文件不再复制；重复调用零副作用
 *   ③ fail-soft：任何异常都不抛，返回原定路径
 */
import fs from 'node:fs'
import path from 'node:path'
import { resolveDshHomePre } from './dsh-home.js'
import { homedir } from 'node:os'
// ★#467 深化（2026-11-02）：布局判据一律**委托**既有的唯一收口，不另起一套 ——
//   目录名沿用本文件的 memoryDir()，越界判定沿用 file-boundary 的 fileWithinRoots()。
import { fileWithinRoots, withinRoot } from './file-boundary.js'

/** 已处理过的 (base,name) —— 键必须含 home，否则引擎作用域（各自 dshHome）会互相串味。 */
const migrated = new Set()

/** 把 JSON 文件判成「空壳」：能解析，且其中的集合型字段全是空数组/空对象。 */
function isEmptyShell(file) {
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (!j || typeof j !== 'object') return false
    const colls = Object.values(j).filter((v) => Array.isArray(v) || (v && typeof v === 'object'))
    if (colls.length === 0) return false // 没有任何集合字段 ⇒ 不是可判定的 store，保守视为有内容
    return colls.every((v) => (Array.isArray(v) ? v.length === 0 : Object.keys(v).length === 0))
  } catch (_) {
    return false // 解析失败 ⇒ 保守视为有内容，不覆盖
  }
}

/** 逐文件增量补齐：只写「目标缺失」或「目标是空壳」的文件。 */
function mergeInto(srcDir, dstDir) {
  let copied = 0
  const walk = (rel) => {
    const sAbs = path.join(srcDir, rel)
    for (const e of fs.readdirSync(sAbs, { withFileTypes: true })) {
      const childRel = rel ? path.join(rel, e.name) : e.name
      if (e.isDirectory()) { walk(childRel); continue }
      const s = path.join(srcDir, childRel)
      const d = path.join(dstDir, childRel)
      const dExists = fs.existsSync(d)
      if (dExists && !(s.endsWith('.json') && isEmptyShell(d) && !isEmptyShell(s))) continue
      fs.mkdirSync(path.dirname(d), { recursive: true })
      fs.copyFileSync(s, d)
      copied++
    }
  }
  walk('')
  return copied
}

export function memoryDir(name, homeFn) {
  // homeFn 由调用方注入：引擎作用域模块必须传各自的 dshHome（口径与原代码逐字一致）。
  const home = typeof homeFn === 'function' ? homeFn() : resolveDshHomePre()
  const base = path.join(home, 'memory')
  const nw = path.join(base, name)
  const key = base + '\u0000' + name
  if (migrated.has(key)) return nw
  // ★#312（2026-10-08）：**登记必须发生在成功之后**。旧实现在 try 之前就 migrated.add，
  //   首次 copyFileSync 失败（EACCES 等）虽正确回退到 <name>-pre，但失败已被缓存 ⇒ **第二次调用
  //   命中缓存直接返回 nw（那个从未复制过任何文件的空新目录）** ⇒ 同一进程后续 store 读不到历史数据
  //   （历史文件仍在旧目录）。判据：失败路径一律**不登记**，允许下次重试；重试仍失败则继续回退旧目录。
  try {
    const od = path.join(base, name + '-pre')
    if (!fs.existsSync(od)) {
      // 无旧目录 ⇒ 无物可迁，本次即算处理完成（幂等纪律，与旧行为一致）
      migrated.add(key)
      return nw
    }
    fs.mkdirSync(nw, { recursive: true })
    const n = mergeInto(od, nw)
    if (n > 0) {
      fs.appendFileSync(
        path.join(base, 'datadir-migration.log'),
        new Date().toISOString() + ' merged ' + n + ' file(s) ' + name + '-pre -> ' + name + '\n'
      )
    }
    migrated.add(key)
    return nw
  } catch (e) {
    // fail-soft：补齐失败时**回退读旧目录**（读得到历史数据优先于名字干净）。
    // ★#312：此处**不得** migrated.add —— 失败不留缓存，下次调用可重试。
    try {
      const od = path.join(base, name + '-pre')
      if (fs.existsSync(od)) return od
    } catch (_) { /* ignore */ }
    return nw
  }
}


// ─────────────────────────────────────────────────────────────
// ★#467（2026-11-02）：记忆**物理布局**的收口（layout 深化）
//
// 【为什么要它】「某个工作区的记忆目录在哪」此前是**每个调用点自己拼一遍**：
//   实测 16 个模块命中（client.js 21 处 / index.js 87 处 / event-write.js / plan-store.js …）。
//   拼法一旦有分歧就会写出两份目录（#179 领地、#503 静默写穿），且**不报错** ——
//   数据只是落在谁也没读的地方。
//
// 【为什么做在 datadir.js 里，而不是新建 layout.js】
//   本文件本来就是「记忆数据目录的唯一收口」，布局天然属于它。另立一个文件会让
//   「目录在哪」重新变成两处口径（datadir + layout），与 #467「禁止第五套判据」的初衷相反。
//
// 【边界（务必先读）】
//   ① **只给新代码用**：存量 16 个模块**一处都不改**（用户 2026-11-02 拍板「#467 先做一半」）。
//      本文件既有的 `memoryDir` 导出**逐字未动**，3 个既有采用者零影响。
//   ② **纯计算**：memoryRoot / projectMemoryDir / userMemoryDir / home / dshHome 全部显式传入
//      （只有 home / dshHome 缺省时按引擎同款规则解析；见各函数注释）。
//   ③ **不新起判据**：目录名委托 memoryDir()，越界判定委托 file-boundary。
//
// 【与引擎口径的对齐（逐字，2026-11-02 对照 lib/index.js）】
//   · engine.wsKey(ws)        ← L4270      · engine.projectDirOf(ws) ← L4276
//   · engine.userDirOf()      ← L4374      · PLAN / event-store    ← L4424 / event-store.js
//   上述任一处改动都**必须同批改本收口** —— 单点真相才有意义。
// ─────────────────────────────────────────────────────────────

/** 布局常量：目录名与文件名。**改动前先确认没有第五处硬编码**（grep 全 lib）。 */
export const LAYOUT = {
  /** 项目记忆的默认子目录名（engine.projectMemoryDir 缺省值，见 index.js L4283）。 */
  projectDirName: '.dsh-memory',
  /** 集中式布局下每个工作区一个子目录，其父目录名（memoryDir('workspaces')）。 */
  workspacesName: 'workspaces',
  /** 项目记忆下的事件账本 / 白板 / 归档 / 用户级文件的子路径。 */
  handoff: 'handoff',
  archive: 'archive',
  planFile: 'PLAN.md',
  notesFile: 'MEMORY.md',
  calendarFile: 'CALENDAR.md',
  /** 与 lib/event-store.js 的 EVENT_STORE_FILENAME 同值（此处不 import 以避免循环依赖，
   *  但由 smoke-test-layout-467 断言两者**真的相等**；不等即红）。 */
  eventStoreFile: 'event-store.json',
}

/** '~' / '~/x' / '~\\x' 展开；其余走 path.resolve。与 engine.expandUserPath 逐字同口径。 */
export function expandHome(p, home) {
  if (typeof p !== 'string' || !p) return undefined
  const h = home || homedir()
  if (p === '~') return h
  if (p.startsWith('~/') || p.startsWith('~\\')) return path.join(h, p.slice(2))
  return path.resolve(p)
}

/** 工作区路径 → 记忆子目录名。与 engine.wsKey 逐字同口径（含非法字符替换表）。 */
export function workspaceKey(ws) {
  if (!ws) return 'default'
  return '--' + String(ws).replace(/[\\/:*?"<>|]/g, '-') + '--'
}

/**
 * 集中式记忆根：memoryRoot 优先，否则 <home>/memory/workspaces。
 *
 * ★这里**故意调用 datadir.memoryDir()** 而不是自己拼 join：datadir 是该项目录名的既有唯一收口，
 *   自己拼就会立刻产生第二套口径（正是 #467 要消灭的病）。memoryDir 自身幂等且 fail-soft。
 */
export function workspacesRoot({ home, memoryRoot, dshHome } = {}) {
  const expanded = expandHome(memoryRoot, home)
  if (expanded) return expanded
  // 缺省根 = memoryDir('workspaces') 的原生口径（内部调 resolveDshHomePre()）。
  // ★不裸用 homedir()：DSH_HOME 被设置时两者会分叉（dsh-home.js 的 7 处独立解析事故）。
  const h = home || resolveDshHomePre(dshHome)
  return memoryDir(LAYOUT.workspacesName, () => h)
}

/**
 * 工作区（项目）记忆目录。与 engine.projectDirOf 同口径。
 *
 * @param ws                工作区 cwd；空 ⇒ wsKey 走 'default'
 * @param projectMemoryDir  若为**绝对路径** ⇒ 直接用它（engine 的旧用法兼容分支）
 * @param memoryRoot        集中式根；空 ⇒ workspacesRoot()
 * @param home              仅用于 '~' 展开与默认根（不传则用真实 homedir）
 */
export function projectDir({ ws, projectMemoryDir, memoryRoot, home } = {}) {
  const name = projectMemoryDir || LAYOUT.projectDirName
  if (path.isAbsolute(name)) return { dir: name, kind: 'absolute' }
  return { dir: path.join(workspacesRoot({ home, memoryRoot }), workspaceKey(ws)), kind: 'centralized' }
}

/** 用户级记忆目录。与 engine.userDirOf 同口径（userMemoryDir 优先，否则 <dshHome>/memory）。 */
export function userDir({ userMemoryDir, home, dshHome } = {}) {
  const expanded = expandHome(userMemoryDir, home)
  if (expanded) return expanded
  // engine.userDirOf() = expandUserPath(config.userMemoryDir) || join(dshHome(), 'memory')
  // dshHome() 的底层就是 resolveDshHomePre —— 此处**逐字对齐**，不裸用 homedir()。
  return path.join(resolveDshHomePre(dshHome), 'memory')
}

/** 项目记忆下的 handoff 目录（账本 / 白板 / 归档 / 事件库都住这里）。 */
export function handoffDir(projectDirPath) { return path.join(projectDirPath, LAYOUT.handoff) }
export function planPath(projectDirPath) { return path.join(projectDirPath, LAYOUT.handoff, LAYOUT.planFile) }
export function archiveDir(projectDirPath) { return path.join(projectDirPath, LAYOUT.handoff, LAYOUT.archive) }
export function eventStorePath(projectDirPath) { return path.join(projectDirPath, LAYOUT.handoff, LAYOUT.eventStoreFile) }
export function notesPath(projectDirPath) { return path.join(projectDirPath, LAYOUT.notesFile) }
export function calendarPath(projectDirPath) { return path.join(projectDirPath, LAYOUT.calendarFile) }

/**
 * 统一入口：按 kind 解析布局路径。**新代码请一律走这里**，不要再自己 path.join。
 *
 * kind ∈ project | handoff | plan | archive | event-store | notes | calendar | user
 * 未知 kind 一律返回 ''（fail-soft：调用方拿到空串会立刻失败，不会静默写错地方）。
 */
export function resolveLayout(kind, opts = {}) {
  const pd = kind === 'user' ? '' : projectDir(opts).dir
  switch (kind) {
    case 'project': return pd
    case 'handoff': return handoffDir(pd)
    case 'plan': return planPath(pd)
    case 'archive': return archiveDir(pd)
    case 'event-store': return eventStorePath(pd)
    case 'notes': return notesPath(pd)
    case 'calendar': return calendarPath(pd)
    case 'user': return userDir(opts)
    default: return ''
  }
}

/** 某工作区记忆的全部合法根（写盘边界的判据输入）。子目录也算根 —— 判据见下方 isInsideLayout。 */
export function layoutRoots(opts = {}) {
  const pd = projectDir(opts).dir
  return { projectDir: pd, userDir: userDir(opts), handoffDir: handoffDir(pd) }
}

/**
 * 越界判定：target 是否落在本工作区记忆之内（**委托 file-boundary，不自写 startsWith**）。
 *
 * ★语义选择说明（与 #503 的裁定一致）：记忆的物理边界是**工作区** —— 越界即拒，
 *   绝不自动改写到"看起来更对"的目录（自动改写会让一次调用隐式创建任意工作区目录）。
 *   roots 同时接受 projectDir 与 userDir：两者都是本插件合法写入面。
 */
export function isInsideLayout(target, opts = {}) {
  const { projectDir: pd, userDir: ud } = layoutRoots(opts)
  const roots = [pd, ud].filter(Boolean)
  if (!roots.length) return null
  return fileWithinRoots(target, roots, { strict: false, allowMissing: true })
}

/** 纯词法版（零 IO）：target 是否在 projectDir 之下。与 fileWithinRoots 的组件级四联同判据。 */
export function isLexicallyInsideProject(target, opts = {}) {
  const pd = projectDir(opts).dir
  try { return withinRoot(path.resolve(pd), path.resolve(target), { allowSame: true }) } catch (_) { return false }
}

export default { memoryDir, LAYOUT, expandHome, workspaceKey, workspacesRoot, projectDir, userDir,
  handoffDir, planPath, archiveDir, eventStorePath, notesPath, calendarPath,
  resolveLayout, layoutRoots, isInsideLayout, isLexicallyInsideProject }
