/**
 * dsh-home.js —— **DSH_HOME 的唯一解析口径**（上游 issue #86-3 修复）。
 *
 * ## 背景（#86-3；已在 pre 线实跑核验）
 *
 * 修复前，全仓有 **7 处独立解析** `process.env.DSH_HOME`，口径互不相同：
 *
 *   | 位置 | 环境变量缺失时的回落 |
 *   |---|---|
 *   | index.js:808（`dshHome()`） | `path.join(homedir(), '.dsh')` |
 *   | index.js:9256（模型根） | `path.join(homedir(), '.dsh')` |
 *   | index.js:9613（python-setup） | `path.join(homedir(), '.dsh')`，失败退 `homedir()` |
 *   | index.js:9623（python-sidecar） | `path.join(homedir(), '.dsh')`，失败退 **空串** |
 *   | semantic-js.js:73/176 | `path.join(homedir(), '.dsh')` |
 *   | activation-host.js:72 | 退 `homedir()` 再拼 `.dsh`，全失败退 **'.'** |
 *   | context-host.js:40 | 退 **`USERPROFILE || HOME`** 再拼（**前缀不同**） |
 *   | shadow-host.js:129 | 同 activation（但注释说漏拼过 `.dsh`） |
 *
 * ⇒ 后果：**同一台机器上，不同子系统可能把数据写到不同根目录**。
 *   最典型的是 `context-host` 用 `USERPROFILE` 作基准，而其余用 `os.homedir()`——
 *   两者在 Windows 上通常一致，但在容器/CI/被改过环境变量的进程里会分叉。
 *
 * ## 本模块的职责
 *
 * 提供**一个**函数 `resolveDshHomePre(override)`，所有站点都调它。
 * 解析顺序（逐级回落，**绝不抛**）：
 *
 *   1. `override`（显式传入，最高优先 —— 给测试注入与 engine 级配置留口）
 *   2. `process.env.DSH_HOME`（trim 后非空）
 *   3. `os.homedir()` + `/.dsh`
 *   4. 环境变量 `USERPROFILE || HOME` + `/.dsh`（**保留 context-host 原有的兜底能力**，
 *      只是把它从「基准」降级为「最后兜底」，从而与其余站点统一）
 *   5. 全失败 ⇒ `'.dsh'`（相对路径，保证**永不返回空串**）
 *
 * ## 为什么把 `homedir()` 放在 `USERPROFILE` 之前
 *
 * `os.homedir()` 在 Windows 上**本身就是** `USERPROFILE`（Node 内部优先读它，
 * 读不到才退 `HOMEDRIVE+HOMEPATH`）⇒ 两者绝大多数情况等价，
 * 但 `homedir()` 还会正确处理 `HOME` 覆盖与权限异常 ⇒ **以它为准更稳**。
 * 保留 `USERPROFILE||HOME` 仅作 `homedir()` 抛异常时的兜底。
 *
 * ## 纪律
 *   - 零运行时依赖（只 `node:os` / `node:path`）。
 *   - **永不抛、永不返回空串**（调用方大量直接 `path.join(dshHome(), ...)`）。
 *   - 只读环境变量，**不缓存**（测试会中途改 `process.env.DSH_HOME`）。
 *   - CRLF、无 BOM。
 */
import os from 'node:os'
import path from 'node:path'

/** 环境变量名（集中一处，便于将来改名）。 */
export const DSH_HOME_ENV_PRE_V1 = 'DSH_HOME'

/** 默认子目录名。 */
export const DSH_HOME_DIRNAME_PRE_V1 = '.dsh'

/** 全失败时的最后兜底（相对路径，保证返回非空）。 */
export const DSH_HOME_FALLBACK_PRE_V1 = '.dsh'

/**
 * 取 home 基准目录（用于拼 `.dsh`）。**永不抛**。
 * @returns {string} 非空字符串，或空串（表示取不到基准）
 */
function homeBasePre() {
  // ① os.homedir() —— 首选：Windows 上等价于 USERPROFILE，且能处理 HOME 覆盖
  try {
    const h = os.homedir()
    if (h && String(h).trim()) return String(h).trim()
  } catch (_) {
    // 落到 ②
  }
  // ② USERPROFILE / HOME —— 兼容 homedir() 抛异常的极端环境
  try {
    const e = process.env.USERPROFILE || process.env.HOME || ''
    if (e && String(e).trim()) return String(e).trim()
  } catch (_) {}
  return ''
}

/**
 * **唯一入口**：解析 DSH_HOME。
 *
 * @param {string} [override] 显式覆盖（测试注入 / engine 级配置）；空串视为未提供。
 * @returns {string} 非空路径字符串（**永不抛、永不返回空串**）
 */
export function resolveDshHomePre(override) {
  // ① 显式覆盖优先
  try {
    if (override != null && String(override).trim()) return String(override).trim()
  } catch (_) {}
  // ② 环境变量
  try {
    const env = process.env[DSH_HOME_ENV_PRE_V1]
    if (env && String(env).trim()) return String(env).trim()
  } catch (_) {}
  // ③ / ④ 基准目录 + .dsh
  const base = homeBasePre()
  if (base) {
    try {
      return path.join(base, DSH_HOME_DIRNAME_PRE_V1)
    } catch (_) {}
  }
  // ⑤ 最后兜底
  return DSH_HOME_FALLBACK_PRE_V1
}

/**
 * engine 级便捷包装：优先用 `engine.__dshHomeOverride`，其次环境变量，最后默认。
 *
 * 之所以要这一层：`activation-host` / `context-host` / `shadow-host` 都是
 * 「engine + 可选 __homedirFn」的形态，统一改调本函数可让三者的口径完全一致，
 * 同时**保留** `__homedirFn` 这个既有测试注入点（不再各自手写回落链）。
 */
export function resolveDshHomeForEnginePre(engine) {
  const e = engine || {}
  // ★★ 优先级必须与**原实现**一致：`env` 优先于 `__homedirFn`。
  //    原写法是 `const env = process.env.DSH_HOME; if (env.trim()) return env.trim();
  //    const base = engine.__homedirFn ? ... : ...` ⇒ env 先判。
  //    ⚠️ 2026-09-20 首次实现把 __homedirFn 提到 env 之前，导致用 `process.env.DSH_HOME`
  //       注入的测试（如 smoke-test-m53）被真实 homedir 覆盖，证据写到了**真实用户目录**
  //       （症状：C4/C5/C6 evidence 落盘数为 0，离真因很远）。
  // ① 显式 engine 级覆盖（新增能力，原实现没有，放最前不影响兼容）
  try {
    if (e.__dshHomeOverride != null && String(e.__dshHomeOverride).trim()) {
      return String(e.__dshHomeOverride).trim()
    }
  } catch (_) {}
  // ② 环境变量（与原实现同优先级）
  try {
    const env = process.env[DSH_HOME_ENV_PRE_V1]
    if (env && String(env).trim()) return String(env).trim()
  } catch (_) {}
  // ③ 既有注入点 __homedirFn：返回的是「home 基准目录」，仍需拼 .dsh
  try {
    if (typeof e.__homedirFn === 'function') {
      const base = e.__homedirFn()
      if (base && String(base).trim()) return path.join(String(base).trim(), DSH_HOME_DIRNAME_PRE_V1)
    }
  } catch (_) {}
  // ④ 默认链（homedir → USERPROFILE/HOME → '.dsh'）
  return resolveDshHomePre()
}

