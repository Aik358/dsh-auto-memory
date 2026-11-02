/**
 * 团队项目 ID —— 解决「wsKey 跨机不汇合」的身份级缺陷。
 *
 * 问题：本仓的 wsKey 由**本机绝对路径**派生（实测形如 --D--dsh-auto-memory--）。
 *   两个人在不同盘符/不同目录克隆同一个仓库 ⇒ 得到两个不同的 wsKey
 *   ⇒ 团队项目库**永远汇合不了**（各自写各自的分区）。
 *
 * 解法：引入与路径无关的 teamProjectId，优先级：
 *   ① 管理员显式登记（config.teamProjectId）
 *   ② git remote.origin.url 的**规范化**哈希（同一个仓库 ⇒ 同一个 id）
 *   ③ fallback：本机 wsKey（退化为「仅本机」语义，并**明确告知用户**）
 *
 * ★ 规范化必须把三种等价写法归一（这是 G-B1 的判据）：
 *   https://github.com/me/repo.git
 *   git@github.com:me/repo
 *   https://user:tok@github.com/me/repo/
 *   三者必须算出**同一个** id。
 *
 * 本文件为纯新增，不修改任何既有文件。
 */
import { createHash } from 'node:crypto'
import { isAbsolute } from 'node:path'

/**
 * 把 git remote URL 规范化为可比较的形式。
 * 归一化规则（顺序不可乱）：
 *   1. 去空白、转小写
 *   2. ssh scp 形式 git@host:path → https://host/path
 *   3. ssh:// 前缀 → https://
 *   4. 去 URL 里的凭据段 user:pass@
 *   5. 去末尾 .git
 *   6. 去末尾斜杠
 * @param {string} url
 * @returns {string} 规范化后的 URL（无法解析时返回原串的 trim 小写）
 */
export function normalizeRemoteUrl(url) {
  if (typeof url !== 'string') return ''
  let s = url.trim().toLowerCase()
  if (!s) return ''
  // ssh scp 形式：git@host:owner/repo
  s = s.replace(/^[a-z0-9._-]+@([^:/]+):/, 'https://$1/')
  // ssh://git@host/owner/repo
  s = s.replace(/^ssh:\/\//, 'https://')
  // 去凭据段 https://user:tok@host/...
  s = s.replace(/^(https?:\/\/)[^/@]*@/, '$1')
  // 去末尾 .git
  s = s.replace(/\.git$/, '')
  // 去末尾斜杠（可能有多个）
  s = s.replace(/\/+$/, '')
  return s
}

/**
 * 由规范化 URL 派生稳定项目 id。
 * 同 URL ⇒ 同 id；不同 URL ⇒ 不同 id（碰撞概率可忽略）。
 * @param {string} url
 * @returns {string} 'gp_' + 16 hex
 */
export function projectIdOf(url) {
  const norm = normalizeRemoteUrl(url)
  if (!norm) return ''
  return 'gp_' + createHash('sha1').update(norm, 'utf8').digest('hex').slice(0, 16)
}

/**
 * ★#514（2026-11-02）：**共享 projectId → 本机工作区**的**纯函数**反查。
 *
 * 为什么必须是纯函数而不是闭包方法：下行 applier 在 index.js 里、只拿得到 map 对象，
 *   而这条判据要能被单测直接真调（CR-10 纪律：真 import → 真构造 → 真调用 → 断言返回值）。
 *
 * 契约：
 *   输入 map  ⊆ { registry(): { <projectId>: string[] }, … }   —— 允许传 registry() 的返回值
 *   输入 projectId                                              —— 共享身份（gp_ 哈希 / 显式 ID）
 *   成功 ⇒ { ok: true,  ws, candidates:[ws] }
 *   无登记 ⇒ { ok: false, reason: 'no-mapping' }
 *   多命中 ⇒ { ok: false, reason: 'ambiguous-mapping', candidates:[…] }   —— **绝不随便挑一个**
 *   入参坏 ⇒ { ok: false, reason: 'bad-input' }
 *
 * ★三条判据（缺一即半修）：
 *   ① **精确匹配**：只用 `Object.prototype.hasOwnProperty` 命中的键，**禁止**前缀/子串/regex。
 *      反例：`gp_abc` 必须**不能**匹配到 `gp_abcd`（本仓 gp_ 是 sha1 前 16 hex，前缀碰撞是真实的）。
 *   ② **只收绝对路径**：候选里的相对路径 / 空串 / 非字符串一律丢弃（防止把身份当路径）。
 *   ③ **多命中即拒绝**：同一共享 ID 在本机可能对应多个工作区（多 worktree / 多克隆），
 *      此时返回 ambiguous 并带上全部 candidates，由调用方决定，不由本函数替它挑。
 *
 * @param {object|Object<string,string[]>} map   team project map 或 registry 表本身
 * @param {string} projectId                     共享项目 ID
 * @returns {{ok:true, ws:string, candidates:string[]} | {ok:false, reason:string, candidates?:string[]}}
 */
export function resolveLocalWorkspaceForProjectPre(map, projectId) {
  const pid = String(projectId == null ? '' : projectId).trim()
  if (!pid) return { ok: false, reason: 'bad-input' }

  // 允许两种入参：map 对象（带 registry()）或已展开的登记表
  let table = null
  try {
    if (map && typeof map.registry === 'function') table = map.registry()
    else if (map && typeof map === 'object') table = map
  } catch (_) { return { ok: false, reason: 'bad-input' } }
  if (!table || typeof table !== 'object') return { ok: false, reason: 'bad-input' }

  // ★判据①：精确匹配，绝不模糊
  if (!Object.prototype.hasOwnProperty.call(table, pid)) return { ok: false, reason: 'no-mapping' }

  const raw = table[pid]
  const list = Array.isArray(raw) ? raw : [raw]
  const candidates = []
  for (const item of list) {
    if (typeof item !== 'string') continue
    const s = item.trim()
    // ★判据②：只收绝对路径
    if (!s || !isAbsolute(s)) continue
    if (candidates.indexOf(s) < 0) candidates.push(s)
  }
  if (!candidates.length) return { ok: false, reason: 'no-mapping' }

  // ★判据③：多命中即拒绝，不替调用方挑
  if (candidates.length > 1) return { ok: false, reason: 'ambiguous-mapping', candidates }

  return { ok: true, ws: candidates[0], candidates }
}

/**
 * 创建团队项目映射。
 * @param {{ engine: object, execGitRemote?: () => string|null, diag?: Function }} deps
 */
export function createTeamProjectMap(deps = {}) {
  const { engine, execGitRemote, diag, registry } = deps
  let cached = null

  const log = (m) => { try { if (typeof diag === 'function') diag('team-project-map: ' + m) } catch (_) {} }

  /**
   * 本机当前工作区的**绝对路径**（可为空）。
   * ★只接受绝对路径 —— 共享 projectId（gp_ 哈希 / 显式 ID）不是路径，绝不能进这个字段。
   */
  function currentWsAbs() {
    let ws = ''
    // ① 显式注入口（测试桩 / 装配层已解析好的当前工作区）
    try { ws = String((deps && deps.ws) || '') } catch (_) {}
    // ② 引擎的已知工作区槽位（_doRefresh 里 `this.state.ws = p.ws` 是唯一权威写入点）
    if (!ws) { try { ws = String((engine && engine.state && engine.state.ws) || '') } catch (_) {} }
    // ③ 调用方可用函数形式再试一次
    if (!ws) { try { ws = typeof (deps && deps.wsOf) === 'function' ? String(deps.wsOf() || '') : '' } catch (_) {} }
    const s = ws.trim()
    // ★只收绝对路径：共享 projectId（gp_ 哈希 / 显式 ID）永不被当作工作区
    return (s && isAbsolute(s)) ? s : ''
  }

  function derive() {
    // ① 显式登记优先
    try {
      const explicit = String((engine && engine.config && engine.config.teamProjectId) || '').trim()
      if (explicit) return { id: explicit, src: 'explicit', stable: true, url: '', ws: currentWsAbs() }
    } catch (_) {}

    // ② git remote 派生（可选依赖：拿不到就跳，绝不抛）
    try {
      const url = typeof execGitRemote === 'function' ? execGitRemote() : null
      const id = projectIdOf(url)
      if (id) return { id, src: 'git-remote', stable: true, url: normalizeRemoteUrl(url), ws: currentWsAbs() }
    } catch (e) { log('git derive failed: ' + ((e && e.message) || e)) }

    // ③ fallback：本机 wsKey，**明确标为不稳定**
    let local = ''
    try { local = (engine && typeof engine.currentWsKeyPre === 'function') ? String(engine.currentWsKeyPre() || '') : '' } catch (_) {}
    return { id: 'local_' + (local || 'unknown'), src: 'local-fallback', stable: false, url: '', ws: currentWsAbs() }
  }

  return {
    current() { if (!cached) cached = derive(); return cached },
    invalidate() { cached = null },
    /**
     * ★#514（2026-11-02）：**本机登记表** —— 共享 projectId → 本地工作区绝对路径。
     *
     * 为什么必须有：共享 projectId 是**跨机身份**（可为 gp_ 哈希或显式 ID），
     *   它**不是**本地绝对路径。下行 applier 需要本地工作区才能定位 event-store.json，
     *   若把 projectId 直接当 cwd 塞进 resolvePaths，就会造出
     *   `…/workspaces/--gp_xxxxxxxxxxxxxxxx--` 这种**伪工作区**（实测）。
     *
     * 登记内容来自 deps.registry（由装配层注入一个 `{ "<projectId>": ["<abs ws>", …] }`
     *   的纯对象或返回它的函数）。**本模块不碰 fs**（与 createTeamProjectMap 既有纪律一致）。
     *
     * @returns {Object<string, string[]>} 规范化后的登记表（projectId → 绝对路径数组）
     */
    registry() {
      let raw = null
      try {
        const r = typeof deps.registry === 'function' ? deps.registry() : deps.registry
        if (r && typeof r === 'object') raw = r
      } catch (e) { log('registry read failed: ' + ((e && e.message) || e)) }
      const out = Object.create(null)
      if (!raw) return out
      for (const pid of Object.keys(raw)) {
        const v = raw[pid]
        const list = Array.isArray(v) ? v : [v]
        const keep = []
        for (const item of list) {
          const s = String(item == null ? '' : item).trim()
          // 只收**绝对路径**；共享 ID / 相对路径 / 空串一律丢弃（防止把身份当路径写进表里）
          if (s && isAbsolute(s) && keep.indexOf(s) < 0) keep.push(s)
        }
        if (keep.length) out[String(pid)] = keep
      }
      return out
    },
    /**
     * 前端要显示的东西：来源 + 是否稳定。
     * 不稳定时 hint 必须非空 —— 用户有权知道「团队共享仅限本机」。
     */
    describe() {
      const c = cached || derive()
      return {
        projectId: c.id,
        source: c.src,
        stable: c.stable,
        hint: c.stable ? '' : '未配置团队项目 ID 且无法从 git remote 派生：本项目的团队共享仅限本机。请在团队设置中登记项目 ID。',
      }
    },
  }
}
