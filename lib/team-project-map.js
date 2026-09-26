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
 * 创建团队项目映射。
 * @param {{ engine: object, execGitRemote?: () => string|null, diag?: Function }} deps
 */
export function createTeamProjectMap({ engine, execGitRemote, diag } = {}) {
  let cached = null

  const log = (m) => { try { if (typeof diag === 'function') diag('team-project-map: ' + m) } catch (_) {} }

  function derive() {
    // ① 显式登记优先
    try {
      const explicit = String((engine && engine.config && engine.config.teamProjectId) || '').trim()
      if (explicit) return { id: explicit, src: 'explicit', stable: true, url: '' }
    } catch (_) {}

    // ② git remote 派生（可选依赖：拿不到就跳，绝不抛）
    try {
      const url = typeof execGitRemote === 'function' ? execGitRemote() : null
      const id = projectIdOf(url)
      if (id) return { id, src: 'git-remote', stable: true, url: normalizeRemoteUrl(url) }
    } catch (e) { log('git derive failed: ' + ((e && e.message) || e)) }

    // ③ fallback：本机 wsKey，**明确标为不稳定**
    let local = ''
    try { local = (engine && typeof engine.currentWsKeyPre === 'function') ? String(engine.currentWsKeyPre() || '') : '' } catch (_) {}
    return { id: 'local_' + (local || 'unknown'), src: 'local-fallback', stable: false, url: '' }
  }

  return {
    current() { if (!cached) cached = derive(); return cached },
    invalidate() { cached = null },
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
