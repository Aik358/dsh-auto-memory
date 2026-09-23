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
  migrated.add(key)
  try {
    const od = path.join(base, name + '-pre')
    if (fs.existsSync(od)) {
      fs.mkdirSync(nw, { recursive: true })
      const n = mergeInto(od, nw)
      if (n > 0) {
        fs.appendFileSync(
          path.join(base, 'datadir-migration.log'),
          new Date().toISOString() + ' merged ' + n + ' file(s) ' + name + '-pre -> ' + name + '\n'
        )
      }
    }
    return nw
  } catch (e) {
    // fail-soft：补齐失败时**回退读旧目录**（读得到历史数据优先于名字干净）。
    try {
      const od = path.join(base, name + '-pre')
      if (fs.existsSync(od)) return od
    } catch (_) { /* ignore */ }
    return nw
  }
}

export default { memoryDir }
