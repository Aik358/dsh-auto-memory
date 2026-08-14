/**
 * dsh-auto-memory — host half.
 *
 * 自动记忆系统,零运行时依赖(仅 node 内置模块):
 *   - 三层记忆:用户级(~/.dsh/memory/MEMORY.md)、项目笔记({ws}/.dsh-memory/MEMORY.md)、
 *     每日日志({ws}/.dsh-memory/YYYY-MM-DD.md,append-only)
 *   - 每次组装系统提示词时自动注入 <memory_system> 块(用户规则 + 项目笔记 + 今日日志 +
 *     最近反思 + 会话开始回顾指引);缓存由 启动/session-start/turn-stopping/工具写入/TTL 刷新
 *   - 每日反思:检测到"昨天有日志但未生成反思"时,在会话首轮注入反思请求块(风格可配:
 *     生活化/专业性/由内容决定),agent 生成后调 memory_reflect 落盘
 *   - 配置:~/DSH_HOME/dsh-auto-memory.json(存储位置、注入预算、反思风格等),UI 经
 *     /api/dsh-auto-memory/config 读写
 *   - 工具:memory_log / memory_note / memory_user / memory_recall / memory_maintain /
 *     memory_status / memory_reflect
 *   - 路由:/api/dsh-auto-memory/{state,list,file,recall,config,reflect}(loopback-only)
 */

import { readFile, writeFile, mkdir, readdir, stat, rm } from 'node:fs/promises'
import { createReadStream, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

/** Stable cordis plugin name. */
export const name = 'auto-memory'

/** Services required before the memory surfaces can mount. */
export const inject = ['webServer', 'tools', 'systemPrompt']

/** Prompt order of the memory section (before the tool-guidance band 100+). */
const SECTION_ORDER = 90

/** Model-facing announcement (tools + engine). */
export const GUIDANCE = '本机已安装 dsh-auto-memory 插件（自动记忆 + 外部记忆继承）：三层本地记忆（用户级 ~/.dsh/memory/MEMORY.md、项目笔记与每日日志 .dsh-memory/）+ 会话自动注入 + 每日反思 + 其他 AI 工具记忆接入。能力：memory_log 追加今日日志（append-only，完成实质性工作后必须调用）；memory_note 更新项目笔记；memory_user 更新用户级规则；memory_recall 检索本地记忆 + 外部记忆（CodeBuddy/Claude Code/Codex 等 AI 工具历史会话与画像）+ 历史 DSH 会话；memory_external 查看/接入外部记忆源；memory_maintain 归档 30 天前日志；memory_reflect 保存每日反思；memory_status 查看状态。主动性纪律：任务开始遇到不熟悉的代码/领域/历史决策时，先 memory_recall 检索本机全部 AI 工具历史，不凭空猜测；新工作区主动探索历史。限制：记忆文件为明文 Markdown；不存密钥除非用户明确要求；外部会话检索为关键词级（非语义）；GUI 侧边栏「记忆」面板（含「接续」页签）与设置页可查看/配置/接入。用户提到「记忆 / 昨天做了什么 / 之前怎么做的 / 每日反思 / 接续 / 其他 AI 的记忆」时即指本插件，请据此协作。'

/** Route family. */
export const API = {
  state: '/api/dsh-auto-memory/state',
  list: '/api/dsh-auto-memory/list',
  file: '/api/dsh-auto-memory/file',
  recall: '/api/dsh-auto-memory/recall',
  config: '/api/dsh-auto-memory/config',
  reflect: '/api/dsh-auto-memory/reflect',
  'reflect-auto': '/api/dsh-auto-memory/reflect-auto',
  note: '/api/dsh-auto-memory/note',
  external: '/api/dsh-auto-memory/external',
  'external-import': '/api/dsh-auto-memory/external-import',
}

const DEFAULT_CONFIG = {
  /** 用户级记忆目录(绝对路径或 ~ 开头)。 */
  userMemoryDir: '~/.dsh/memory',
  /** 项目级记忆目录名(相对工作区)。 */
  projectMemoryDir: '.dsh-memory',
  /** 是否注入记忆上下文。 */
  injectEnabled: true,
  /** 注入总预算(字符)。 */
  injectBudgetChars: 2400,
  /** 注入的最近日志天数。 */
  recentDaysInjected: 3,
  /** 是否启用每日反思。 */
  reflectEnabled: true,
  /** 反思风格: auto=由内容决定 / life=生活化 / professional=专业性。 */
  reflectStyle: 'auto',
  /** 外部记忆注入预算(字符)。 */
  externalInjectionChars: 1400,
  /** 外部记忆源开关(CodeBuddy/Claude Code/Codex/项目约定等)。 */
  externalSources: {
    'workbuddy-user': true,
    'workbuddy-profile': true,
    'codebuddy-memory': true,
    'claude-global': true,
    'project-conventions': true,
    'workbuddy-sessions': true,
    'claude-sessions': true,
    'codex-sessions': true,
  },
}

// ---------- 小工具 ----------
const pad = (n) => String(n).padStart(2, '0')
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }
const nowHm = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}` }
const dateStrOf = (ts) => { const d = new Date(ts); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const truncateHead = (s, n) => (s && s.length > n) ? s.slice(0, n) + '\n…(截断,完整内容用 memory_recall 或 GUI 面板)' : (s || '')
const truncateTail = (s, n) => (s && s.length > n) ? '…(截断,完整内容用 memory_recall 或 GUI 面板)\n' + s.slice(-n) : (s || '')
const fmtBytes = (n) => (n >= 1024 * 1024 ? (n / 1024 / 1024).toFixed(1) + ' MB' : n >= 1024 ? (n / 1024).toFixed(1) + ' KB' : n + ' B')

function dshHome() {
  const env = process.env.DSH_HOME
  if (env && env.trim()) return env.trim()
  return path.join(homedir(), '.dsh')
}

/** 记忆引擎:路径解析、缓存、文件读写、检索、反思状态。 */
class MemoryEngine {
  constructor() {
    this.config = { ...DEFAULT_CONFIG }
    this.state = {
      home: undefined, ws: undefined,
      userDir: undefined, notesPath: undefined, logPath: undefined, reflectDir: undefined,
      userText: '', notesText: '', logText: '',
      recentLogs: [], // {date, text}
      latestReflection: '', latestReflectionDate: '',
      pendingReflection: undefined, // {date, text}
      reflectionShownSession: undefined,
      loadedAt: 0, loading: undefined, configLoaded: false,
    }
    this._configPath = path.join(dshHome(), 'dsh-auto-memory.json')
    this._readError = undefined
    this.external = new ExternalMemory(this)
  }

  // ---------- 配置 ----------
  async loadConfig() {
    try {
      const raw = await readFile(this._configPath, 'utf8')
      const parsed = JSON.parse(raw)
      this.config = { ...DEFAULT_CONFIG, ...(parsed && typeof parsed === 'object' ? parsed : {}) }
    } catch (e) {
      if (e && e.code !== 'ENOENT') this._readError = String(e && e.message ? e.message : e)
      this.config = { ...DEFAULT_CONFIG }
    }
    this.configLoaded = true
    return this.config
  }

  async saveConfig(patch) {
    await this.loadConfig()
    this.config = { ...this.config, ...patch }
    await mkdir(path.dirname(this._configPath), { recursive: true })
    await writeFile(this._configPath, JSON.stringify(this.config, null, 2), 'utf8')
    this.state.loadedAt = 0 // 强制重载(目录可能变化)
    await this.refresh(undefined)
    return this.config
  }

  // ---------- 路径 ----------
  expandUserPath(p) {
    if (typeof p !== 'string' || !p) return undefined
    if (p === '~') return homedir()
    if (p.startsWith('~/') || p.startsWith('~\\')) return path.join(homedir(), p.slice(2))
    return path.resolve(p)
  }

  projectDirOf(ws) {
    const name = this.config.projectMemoryDir || '.dsh-memory'
    return path.isAbsolute(name) ? name : path.join(ws || process.cwd(), name)
  }

  userDirOf() {
    return this.expandUserPath(this.config.userMemoryDir) || path.join(dshHome(), 'memory')
  }

  async resolvePaths(agent) {
    let ws
    try { ws = agent && agent.session && agent.session.header && agent.session.header.cwd } catch (e) {}
    if (!ws) ws = this.state.ws || process.cwd()
    const userDir = this.userDirOf()
    const projectDir = this.projectDirOf(ws)
    return {
      ws,
      userDir,
      userFile: path.join(userDir, 'MEMORY.md'),
      projectDir,
      notesPath: path.join(projectDir, 'MEMORY.md'),
      logPath: path.join(projectDir, `${todayStr()}.md`),
      reflectDir: path.join(projectDir, 'reflections'),
    }
  }

  // ---------- 读取 ----------
  async readTextSafe(p) {
    if (!p) return ''
    try {
      const info = await stat(p)
      if (!info.isFile()) return ''
      return (await readFile(p, 'utf8')) || ''
    } catch (e) { return '' }
  }

  async listDailyLogs(projectDir, limit = 40) {
    try {
      const entries = await readdir(projectDir, { withFileTypes: true })
      return entries
        .filter((e) => e.isFile() && DATE_RE.test(e.name.replace(/\.md$/, '')))
        .map((e) => ({ name: e.name, date: e.name.slice(0, 10) }))
        .sort((a, b) => (a.date < b.date ? 1 : -1))
        .slice(0, limit)
    } catch (e) { return [] }
  }

  async listReflections(reflectDir, limit = 30) {
    try {
      const entries = await readdir(reflectDir, { withFileTypes: true })
      return entries
        .filter((e) => e.isFile() && e.name.endsWith('.md'))
        .map((e) => ({ name: e.name, date: e.name.slice(0, 10) }))
        .sort((a, b) => (a.date < b.date ? 1 : -1))
        .slice(0, limit)
    } catch (e) { return [] }
  }

  /** 最近 N 天日志(含今天)的尾部摘要。 */
  async recentLogTails(projectDir, days) {
    const logs = await this.listDailyLogs(projectDir, 30)
    const out = []
    const seen = new Set()
    for (const log of logs) {
      if (out.length >= days) break
      if (seen.has(log.date)) continue
      seen.add(log.date)
      const text = await this.readTextSafe(path.join(projectDir, log.name))
      if (text && text.trim()) out.push({ date: log.date, text: truncateTail(text, 700) })
    }
    return out
  }

  /** 检测待生成反思:最近一个"有日志、无反思、早于今天"的日期。 */
  async detectPendingReflection(projectDir, reflectDir) {
    try {
      const logs = await this.listDailyLogs(projectDir, 30)
      const reflections = await this.listReflections(reflectDir, 30)
      const done = new Set(reflections.map((r) => r.date))
      const today = todayStr()
      for (const log of logs) {
        if (log.date >= today) continue
        if (done.has(log.date)) continue
        const text = await this.readTextSafe(path.join(projectDir, log.name))
        if (text && text.trim()) return { date: log.date, text: truncateTail(text, 1200) }
      }
    } catch (e) {}
    return undefined
  }

  // ---------- 缓存刷新(串行队列:每次按序执行,最后一次生效) ----------
  async refresh(agent) {
    const previous = this.state.loading || Promise.resolve()
    const next = previous.then(
      () => this._doRefresh(agent),
      () => this._doRefresh(agent),
    )
    this.state.loading = next
    return next
  }

  async _doRefresh(agent) {
    try {
      if (!this.configLoaded) await this.loadConfig()
        const p = await this.resolvePaths(agent)
        this.state.ws = p.ws
        this.state.userDir = p.userDir
        this.state.projectDir = p.projectDir
        this.state.notesPath = p.notesPath
        this.state.logPath = p.logPath
        this.state.reflectDir = p.reflectDir
        const [u, n, l] = await Promise.all([
          this.readTextSafe(p.userFile), this.readTextSafe(p.notesPath), this.readTextSafe(p.logPath),
        ])
        this.state.userText = u; this.state.notesText = n; this.state.logText = l
        this.state.recentLogs = await this.recentLogTails(p.projectDir, Math.max(Number(this.config.recentDaysInjected) || 3, 1))
        // 最近反思
        const reflections = await this.listReflections(p.reflectDir, 1)
        if (reflections.length) {
          this.state.latestReflection = await this.readTextSafe(path.join(p.reflectDir, reflections[0].name))
          this.state.latestReflectionDate = reflections[0].date
        } else {
          this.state.latestReflection = ''; this.state.latestReflectionDate = ''
        }
        // 待反思(仅当启用且非当天)
        this.state.pendingReflection = undefined
        if (this.config.reflectEnabled) {
          const pending = await this.detectPendingReflection(p.projectDir, p.reflectDir)
          if (pending) this.state.pendingReflection = pending
        }
        // 外部记忆探测(后台,结果进缓存)
        if (this.config.externalSources) void this.external.discover(true)
        this.state.loadedAt = Date.now()
      } catch (e) {
        console.error('[dsh-auto-memory] refresh failed', e)
      }
  }

  // ---------- 注入渲染(同步,基于缓存) ----------
  renderMemory(context) {
    const s = this.state
    const cfg = this.config
    const budget = Math.max(Number(cfg.injectBudgetChars) || 2400, 400)
    const lines = []
    lines.push('<memory_system>')
    lines.push('自动记忆已启用。工作区: ' + (s.ws || '(未知)') + ' | 日期: ' + todayStr())
    let used = 0
    const part = (title, text, max) => {
      if (!text) return
      const t = truncateHead(text, max)
      used += t.length
      lines.push('\n[' + title + ']\n' + t)
    }
    const sub = Math.floor((budget - 500) / 4)
    // 读取顺序:progress(工作日志/反思)先行,再读 memory(用户级/项目笔记)
    if (s.recentLogs.length) {
      const recent = s.recentLogs.map((r) => '[' + r.date + '] ' + r.text.replace(/\n+/g, ' | ')).join('\n')
      part('最近 ' + s.recentLogs.length + ' 天工作日志(尾部)', recent, sub)
    }
    if (s.latestReflection) {
      part('最近反思 ' + s.latestReflectionDate + '(前一天工作精华)', s.latestReflection, sub)
    }
    part('用户级记忆 ~/.dsh/memory/MEMORY.md — 跨项目,必须遵守', s.userText, sub)
    part('项目长期笔记 ' + cfg.projectMemoryDir + '/MEMORY.md', s.notesText, sub)
    // 外部记忆摘要(其他 AI 工具遗产)
    if (this.external.cache && this.external.cache.length) {
      const extBudget = Math.max(Number(cfg.externalInjectionChars) || 1400, 200)
      const ext = this.external.cache
        .filter((x) => x.kind !== 'sessions')
        .map((x) => '· ' + x.name + '(' + x.tool + '): ' + truncateHead(x.content, 500))
        .slice(0, 3)
      if (ext.length) lines.push('\n[外部记忆 — 其他 AI 工具遗产,可继承]\n' + ext.join('\n'))
      const sess = this.external.cache.filter((x) => x.kind === 'sessions')
      if (sess.length) {
        lines.push('· 历史会话索引: ' + sess.map((x) => x.name + ' ' + x.files.length + ' 个').join(', ') + ' —— 需要时用 memory_recall 检索。')
      }
    }
    lines.push('\n[记忆写入纪律 — 必须遵守]')
    lines.push('- 会话开始:若任务与历史工作/历史决策相关,先回顾以上记忆;**遇到不熟悉的代码、领域或项目时,主动调用 memory_recall 检索本机所有 AI 工具的历史记忆(CodeBuddy/Claude Code/Codex 等会话),不要凭空猜测**。')
    lines.push('- 新工作区(无历史日志/笔记):主动用 memory_recall 探索本机历史,判断该项目是否曾在其他 AI 工具中工作过;也可调用 memory_external 查看并接入外部记忆。')
    lines.push('- 完成实质性工作后立即调用 memory_log 追加今日日志(append-only,绝不覆盖):建/改应用、修 bug、写文档、重构、技术选型、用户约定或偏好。')
    lines.push('- progress 与 memory 一起写:写日志的同时,把有跨会话长期价值的内容一并写入记忆——跨项目规则 → memory_user,仅本项目 → memory_note;两者在同一轮完成,互不冲突、不遗漏。')
    lines.push('- 只记录有跨会话长期价值的;不记临时信息(搜索结果、临时路径、工具报错)。')
    lines.push('- 用户明确要求长期记住:跨项目规则 → memory_user;仅本项目 → memory_note。')
    lines.push('- 定期调用 memory_maintain 归档 30 天前日志;不存密钥,除非用户明确要求。')
    lines.push('- 记忆仅作补充,不替代正常回复与交付物。')
    lines.push('</memory_system>')
    return lines.join('\n')
  }

  /** 反思请求块:仅在会话首轮注入一次。 */
  renderReflectionRequest() {
    const pending = this.state.pendingReflection
    if (!pending) return ''
    if (this.state.reflectionShownSession === pending.date) return ''
    this.state.reflectionShownSession = pending.date
    const style = this.config.reflectStyle || 'auto'
    const styleText = {
      life: '生活化风格:轻松温暖的口吻,像朋友复盘一天,可以用少量 emoji,兼顾感受与生活平衡。',
      professional: '专业性风格:简洁专业的总结,分条列出 成果 / 问题与教训 / 下一步要点。',
      auto: '风格由内容决定:工作成果类用专业简洁分条;个人/生活类用轻松口吻;可适度结合。',
    }[style] || '风格由内容决定。'
    return [
      '\n\n[昨日反思 — 待生成]',
      '昨天(' + pending.date + ')你完成了以下工作:',
      pending.text,
      '请在本轮回复开头,以「昨日反思 · ' + pending.date + '」小节向用户呈现前一天的工作反思与要点:成果回顾、值得注意的教训或改进、今天可延续的要点。',
      '要求:' + styleText,
      '生成后调用 memory_reflect(date="' + pending.date + '", text=完整反思内容)保存,之后该提示不再出现。',
    ].join('\n')
  }

  // ---------- 写操作 ----------
  async appendText(p, text) {
    const existing = await this.readTextSafe(p)
    const body = existing ? existing.replace(/\s+$/, '') + '\n' + text : text
    await mkdir(path.dirname(p), { recursive: true })
    await writeFile(p, body, 'utf8')
    return body
  }

  async writeFull(p, text) {
    await mkdir(path.dirname(p), { recursive: true })
    await writeFile(p, text, 'utf8')
  }

  // ---------- 检索 ----------
  async recall(query, limit = 8, agent) {
    const q = String(query || '').toLowerCase().trim()
    if (!q) return 'memory_recall: query 为空。'
    const p = await this.resolvePaths(agent)
    const out = []
    const hits = []
    const scanFile = async (label, filePath, maxMatches = 3) => {
      const text = await this.readTextSafe(filePath)
      if (!text) return
      const matched = []
      for (const line of text.split('\n')) {
        if (line.toLowerCase().includes(q)) {
          matched.push(line.trim().slice(0, 200))
          if (matched.length >= maxMatches) break
        }
      }
      if (matched.length) hits.push({ where: label, matches: matched })
    }
    // 读取顺序:progress(日志/反思)先行,再读 memory(用户级/项目笔记)
    const logs = await this.listDailyLogs(p.projectDir, 40)
    for (const log of logs) {
      if (hits.length >= limit) break
      await scanFile(log.name, path.join(p.projectDir, log.name), 2)
    }
    const reflections = await this.listReflections(p.reflectDir, 30)
    for (const r of reflections) {
      if (hits.length >= limit) break
      await scanFile('reflections/' + r.name, path.join(p.reflectDir, r.name), 2)
    }
    await scanFile('~' + p.userFile.slice(homedir().length), p.userFile)
    await scanFile(p.projectDir + '/MEMORY.md', p.notesPath)
    if (hits.length) {
      out.push('== 本地记忆文件命中 ==')
      for (const h of hits) out.push('· ' + h.where + ':\n' + h.matches.map((m) => '  - ' + m).join('\n'))
    }
    // 外部记忆(其他 AI 工具遗产)检索
    try {
      const extHits = await this.external.search(query, Math.max(limit - hits.length, 2))
      if (extHits.length) {
        out.push('== 外部记忆命中(CodeBuddy/Claude/Codex/项目约定等) ==')
        for (const h of extHits) out.push('· ' + h.source + '(' + h.tool + '):\n' + h.lines.map((m) => '  - ' + m).join('\n'))
      }
    } catch (e) {}
    // 历史会话检索(若部署启用 session-query 索引)
    try {
      const sq = this._sessionQuery
      if (sq) {
        const page = await sq.searchSessions({ query: String(query || ''), limit: Math.min(limit, 10) })
        const items = (page && page.items) || []
        if (items.length) {
          out.push('== 历史 DSH 会话命中 ==')
          for (const it of items) {
            const hdr = it.header || {}
            const when = hdr.createdAt ? dateStrOf(hdr.createdAt) : '?'
            const snippet = it.bestMatch && it.bestMatch.snippet ? String(it.bestMatch.snippet).slice(0, 300) : ''
            out.push('· [' + when + '] ' + (hdr.cwd || hdr.id || '?') + '\n  ' + snippet)
          }
        }
      }
    } catch (e) {}
    if (!out.length) return '未找到与 "' + query + '" 相关的记忆。'
    return out.join('\n')
  }

  // ---------- 反思 ----------
  async saveReflection(date, text, agent) {
    if (!DATE_RE.test(date)) return 'memory_reflect: date 必须是 YYYY-MM-DD。'
    const content = String(text || '').trim()
    if (!content) return 'memory_reflect: text 为空,未保存。'
    const p = await this.resolvePaths(agent)
    const file = path.join(p.reflectDir, date + '.md')
    await this.writeFull(file, '# 反思 ' + date + '\n\n' + content)
    this.state.latestReflection = content
    this.state.latestReflectionDate = date
    if (this.state.pendingReflection && this.state.pendingReflection.date === date) {
      this.state.pendingReflection = undefined
    }
    this.state.loadedAt = Date.now()
    return '已保存反思 ' + file
  }

  /** 一键反思:自动取"有日志但无反思"的最早日期,按日志条目生成反思草稿并落盘。 */
  async reflectAuto(agent) {
    const p = await this.resolvePaths(agent)
    const pending = await this.detectPendingReflection(p.projectDir, p.reflectDir)
    const date = pending ? pending.date : (this.state.recentLogs[0] && this.state.recentLogs[0].date)
    if (!date) return '没有可反思的日志(今天之前无日志记录)。'
    const logFile = path.join(p.projectDir, date + '.md')
    const logText = await this.readTextSafe(logFile)
    const entries = logText.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('- '))
    const bullet = entries.length ? entries.map((l) => '- ' + l.slice(2)).join('\n') : '(无条目)'
    const text = [
      '## 成果回顾',
      bullet,
      '## 问题与教训',
      '- (待补充)',
      '## 下一步要点',
      '- (待补充)',
    ].join('\n\n')
    return this.saveReflection(date, text, agent)
  }

  // ---------- 维护 ----------
  async maintain(days = 30, agent) {
    const p = await this.resolvePaths(agent)
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - days)
    const logs = await this.listDailyLogs(p.projectDir, 365)
    const oldLogs = logs.filter((log) => {
      const m = DATE_RE.exec(log.date)
      if (!m) return false
      return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) < cutoff
    })
    if (!oldLogs.length) return '没有超过 ' + days + ' 天的日志,无需归档。'
    let archive = '\n## 归档日志(归档于 ' + todayStr() + ')'
    let archivedBytes = 0
    for (const log of oldLogs) {
      const text = await this.readTextSafe(path.join(p.projectDir, log.name))
      if (text) {
        archive += '\n\n### ' + log.name + '\n' + text
        archivedBytes += text.length
      }
    }
    const notesBody = await this.appendText(p.notesPath, archive)
    this.state.notesText = notesBody
    const deleted = []
    const kept = []
    for (const log of oldLogs) {
      try {
        await rm(path.join(p.projectDir, log.name), { force: true })
        deleted.push(log.name)
      } catch (e) { kept.push(log.name) }
    }
    this.state.loadedAt = Date.now()
    return '已归档 ' + oldLogs.length + ' 个日志文件(' + archivedBytes + ' 字符)到 ' + p.notesPath +
      (deleted.length ? '\n已删除: ' + deleted.join(', ') : '') +
      (kept.length ? '\n未删除(可手动清理): ' + kept.join(', ') : '')
  }

  // ---------- 状态快照(UI) ----------
  async snapshot(agent) {
    await this.refresh(agent)
    const p = await this.resolvePaths(agent)
    const todayEntries = this.state.logText.split('\n').filter((l) => l.trim().startsWith('- ')).length
    return {
      config: this.config,
      ws: this.state.ws,
      userDir: p.userDir,
      projectDir: p.projectDir,
      userFile: p.userFile,
      notesPath: p.notesPath,
      logPath: this.state.logPath,
      reflectDir: p.reflectDir,
      sizes: {
        user: this.state.userText.length,
        notes: this.state.notesText.length,
        log: this.state.logText.length,
      },
      todayEntries,
      latestReflectionDate: this.state.latestReflectionDate,
      pendingReflection: this.state.pendingReflection ? this.state.pendingReflection.date : undefined,
      refreshedAt: this.state.loadedAt,
      configReadError: this._readError,
    }
  }
}

// ---------- 工具定义(手构,无 dsh-tools 依赖) ----------
function defineTool(name, description, parameters, execute) {
  const properties = {}
  const required = []
  for (const [key, spec] of Object.entries(parameters || {})) {
    const prop = { type: spec.type || 'string', description: spec.description || '' }
    if (spec.enum) prop.enum = spec.enum
    properties[key] = prop
    if (spec.required) required.push(key)
  }
  return {
    name,
    description,
    parameters: { type: 'object', properties, required },
    output: {
      schema: { type: 'string' },
      render(_args, value) { return [{ type: 'text', text: String(value) }] },
    },
    async execute(args, exec) {
      try {
        return await execute(args, exec)
      } catch (e) {
        return name + ' 失败: ' + (e && e.message ? e.message : String(e))
      }
    },
  }
}

// ---------- HTTP 辅助 ----------
function isLoopbackRequest(req) {
  const address = req.socket && req.socket.remoteAddress
  if (address !== '127.0.0.1' && address !== '::1' && address !== '::ffff:127.0.0.1') return false
  const host = req.headers.host
  if (typeof host !== 'string') return false
  let hostUrl
  try { hostUrl = new URL('http://' + host) } catch { return false }
  if (hostUrl.hostname !== '127.0.0.1' && hostUrl.hostname !== 'localhost' && hostUrl.hostname !== '[::1]') return false
  if (req.headers['sec-fetch-site'] === 'cross-site') return false
  const origin = req.headers.origin
  if (origin === undefined) return true
  try { return new URL(origin).host === hostUrl.host } catch { return false }
}

function writeJson(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'referrer-policy': 'no-referrer' })
  res.end(payload)
}

async function readJsonBody(req, maxBytes = 256 * 1024) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > maxBytes) return undefined
    chunks.push(chunk)
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { return undefined }
}

/** 路径白名单:仅允许记忆目录内的文件。 */
function isUnderMemoryTree(engine, target) {
  const resolved = path.resolve(target)
  const roots = []
  try { roots.push(path.resolve(engine.userDirOf())) } catch (e) {}
  if (engine.state.projectDir) roots.push(path.resolve(engine.state.projectDir))
  return roots.some((root) => resolved === root || resolved.startsWith(root + path.sep))
}

// ═══════════════════════════════════════════════════════════════════════════
// 外部记忆接入(其他 AI 工具的记忆继承)
//
// 目标:让 DSH 继承用户在 CodeBuddy / Claude Code / Codex / Cursor 等
// 工具中积累的记忆,持续拟合用户画像。
//
// 源分三类:
//   - markdown 记忆(用户级/画像/项目约定):内容小,直接读入缓存,注入/检索/接入
//   - 会话日志(jsonl,各工具 projects / sessions):
//     只列索引,检索时按需扫描(行数/文件数上限),绝不整库注入
// ═══════════════════════════════════════════════════════════════════════════
class ExternalMemory {
  constructor(engine) {
    this.engine = engine
    this.cache = undefined // [{id,name,tool,kind,files,content,size,mtime}]
    this.cachedAt = 0
    this._scanning = undefined
  }

  enabled(id) {
    const map = this.engine.config.externalSources || {}
    return map[id] !== false
  }

  /** 递归收集某目录下的 jsonl 会话文件(按 mtime 取最新 N 个)。 */
  async listSessionFiles(rootDir, limit = 20) {
    const out = []
    const walk = async (dir, depth) => {
      if (depth > 5 || out.length >= limit * 3) return
      let entries
      try { entries = await readdir(dir, { withFileTypes: true }) } catch (e) { return }
      for (const e of entries) {
        if (out.length >= limit * 3) return
        const full = path.join(dir, e.name)
        if (e.isDirectory()) await walk(full, depth + 1)
        else if (e.isFile() && e.name.endsWith('.jsonl')) {
          try {
            const info = await stat(full)
            out.push({ path: full, size: info.size, mtime: info.mtimeMs })
          } catch (err) {}
        }
      }
    }
    await walk(rootDir, 0)
    out.sort((a, b) => b.mtime - a.mtime)
    return out.slice(0, limit)
  }

  /** 从单个 jsonl 会话文件提取可检索文本(行数/字节上限,防重)。 */
  async extractSessionText(file, maxLines = 400, maxChars = 60000) {
    let text = ''
    let lines = 0
    try {
      const stream = createReadStream(file, { encoding: 'utf8', highWaterMark: 64 * 1024 })
      for await (const chunk of stream) {
        const lineChunks = String(chunk).split('\n')
        for (const line of lineChunks) {
          if (lines >= maxLines || text.length >= maxChars) break
          lines++
          if (!line.trim()) continue
          const bits = extractJsonText(line)
          if (bits) {
            text += bits + '\n'
            if (text.length >= maxChars) break
          }
        }
      }
    } catch (e) {}
    return text.slice(0, maxChars)
  }

  /**
   * 探测全部启用的外部记忆源。结果缓存 3 分钟。
   * markdown 源携带 content;会话源只带文件索引。
   */
  async discover(force) {
    if (!force && this.cache && Date.now() - this.cachedAt < 180000) return this.cache
    if (this._scanning) return this._scanning
    this._scanning = (async () => {
      const home = homedir()
      const ws = this.engine.state.ws || process.cwd()
      const srcs = []
      const pushMd = async (id, name, tool, kind, paths) => {
        if (!this.enabled(id)) return
        const files = []
        let content = ''
        let size = 0
        let mtime = 0
        for (const p of paths) {
          try {
            const info = await stat(p)
            if (!info.isFile()) continue
            const c = await readFile(p, 'utf8')
            files.push({ path: p, size: info.size, mtime: info.mtimeMs })
            size += info.size
            mtime = Math.max(mtime, info.mtimeMs)
            content += (content ? '\n\n' : '') + c
          } catch (e) {}
        }
        if (!files.length) return
        srcs.push({ id, name, tool, kind, files, content: content.slice(0, 200000), size, mtime })
      }
      const pushSessions = async (id, name, tool, rootDir) => {
        if (!this.enabled(id)) return
        const files = await this.listSessionFiles(rootDir)
        if (!files.length) return
        srcs.push({
          id, name, tool, kind: 'sessions', files,
          content: '', size: files.reduce((a, f) => a + f.size, 0),
          mtime: files[0].mtime,
        })
      }

      // —— 用户级/画像类 markdown ——
      await pushMd('workbuddy-user', 'AI 助手用户记忆', 'AI 助手', 'user', [path.join(home, '.workbuddy', 'MEMORY.md')])
      const wbProfiles = await globOne(path.join(home, '.workbuddy', 'memory'), /_memory\.md$/, 3)
      await pushMd('workbuddy-profile', 'AI 助手云端画像', 'AI 助手', 'profile', wbProfiles)
      const cbMems = await globOne(path.join(home, '.codebuddy', 'memery'), /_memery\.md$/, 3)
      await pushMd('codebuddy-memory', 'CodeBuddy 记忆画像', 'CodeBuddy', 'profile', cbMems)
      await pushMd('claude-global', 'Claude Code 全局记忆', 'Claude Code', 'user', [path.join(home, '.claude', 'CLAUDE.md')])
      // —— 项目约定类 ——
      const conventions = [
        path.join(ws, 'CLAUDE.md'), path.join(ws, 'AGENTS.md'), path.join(ws, 'CODEBUDDY.md'),
        path.join(ws, 'Windsurf.md'), path.join(ws, '.github', 'copilot-instructions.md'),
      ]
      const cursorRules = await globOne(path.join(ws, '.cursor', 'rules'), /\.(mdc|md)$/, 10)
      await pushMd('project-conventions', '项目约定(CLAUDE.md 等)', '项目文件', 'project', [...conventions, ...cursorRules])
      // —— 会话类 ——
      await pushSessions('workbuddy-sessions', 'AI 助手历史会话', 'AI 助手', path.join(home, '.workbuddy', 'projects'))
      await pushSessions('claude-sessions', 'Claude Code 历史会话', 'Claude Code', path.join(home, '.claude', 'projects'))
      await pushSessions('codex-sessions', 'Codex 历史会话', 'Codex', path.join(home, '.codex', 'sessions'))

      this.cache = srcs
      this.cachedAt = Date.now()
      return srcs
    })().finally(() => { this._scanning = undefined })
    return this._scanning
  }

  /** 汇总注入用的外部记忆摘要(按预算截断,会话源只报数量)。 */
  async injectionText(budget = 1400) {
    try {
      const srcs = await this.discover(false)
      const parts = []
      const md = srcs.filter((s) => s.kind !== 'sessions')
      const sess = srcs.filter((s) => s.kind === 'sessions')
      let used = 0
      for (const s of md) {
        if (used >= budget) break
        const head = truncateHead(s.content, Math.min(700, budget - used))
        used += head.length
        parts.push('· ' + s.name + '(' + s.tool + '):\n' + head)
      }
      if (sess.length) {
        const total = sess.reduce((a, s) => a + s.files.length, 0)
        parts.push('· 历史会话可用: ' + sess.map((s) => s.name + ' ' + s.files.length + ' 个').join(', ') + '(需要时用 memory_recall 检索)')
      }
      if (!parts.length) return ''
      return '### 外部记忆(其他 AI 工具遗产)\n' + parts.join('\n\n')
    } catch (e) { return '' }
  }

  /** 检索外部记忆(全源)。返回 {source, lines[]} 列表。 */
  async search(query, limit = 6) {
    const q = String(query || '').toLowerCase().trim()
    if (!q) return []
    const srcs = await this.discover(false)
    const out = []
    for (const s of srcs) {
      if (out.length >= limit) break
      const hits = []
      if (s.kind === 'sessions') {
        let scanned = 0
        for (const f of s.files) {
          if (hits.length >= 3 || scanned >= 8 || out.length >= limit) break
          scanned++
          const text = await this.extractSessionText(f.path)
          for (const line of text.split('\n')) {
            if (line.toLowerCase().includes(q)) {
              hits.push('(' + path.basename(f.path).slice(0, 20) + ') ' + line.trim().slice(0, 200))
              if (hits.length >= 3) break
            }
          }
        }
      } else {
        const matched = []
        for (const line of s.content.split('\n')) {
          if (line.toLowerCase().includes(q)) {
            matched.push(line.trim().slice(0, 200))
            if (matched.length >= 3) break
          }
        }
        hits.push(...matched)
      }
      if (hits.length) out.push({ source: s.name, tool: s.tool, kind: s.kind, lines: hits })
    }
    return out
  }

  /** 把某个源的内容接入本地记忆(项目笔记或用户级记忆)。 */
  async importInto(sourceId, target, engine, agent) {
    const srcs = await this.discover(false)
    const src = srcs.find((s) => s.id === sourceId)
    if (!src) return '外部源不存在: ' + sourceId
    if (src.kind === 'sessions') return '会话类源不支持整体接入,请用 memory_recall 按需检索(' + src.files.length + ' 个会话文件)。'
    const stamp = '## 来自 ' + src.tool + '(' + src.name + ') — 接入于 ' + todayStr()
    if (target === 'user') {
      const p = await engine.resolvePaths(agent)
      const body = await engine.appendText(p.userFile, '\n' + stamp + '\n' + src.content.slice(0, 120000))
      engine.state.userText = body
      return '已接入用户级记忆(' + src.name + ', ' + src.content.length + ' 字符)'
    }
    const p = await engine.resolvePaths(agent)
    const body = await engine.appendText(p.notesPath, '\n' + stamp + '\n' + src.content.slice(0, 120000))
    engine.state.notesText = body
    engine.state.loadedAt = Date.now()
    return '已接入项目笔记(' + src.name + ', ' + src.content.length + ' 字符)'
  }

  /** 简化状态视图(UI 用)。 */
  async summarize() {
    const srcs = await this.discover(false)
    return srcs.map((s) => ({
      id: s.id, name: s.name, tool: s.tool, kind: s.kind,
      fileCount: s.files.length, size: s.size, mtime: s.mtime,
      preview: s.kind === 'sessions' ? '' : truncateHead(s.content, 240),
      enabled: this.enabled(s.id),
    }))
  }
}

/** 递归收集目录下匹配正则的文件(上限 n)。 */
async function globOne(dir, re, limit) {
  const out = []
  const walk = async (d, depth) => {
    if (depth > 4 || out.length >= limit) return
    let entries
    try { entries = await readdir(d, { withFileTypes: true }) } catch (e) { return }
    for (const e of entries) {
      if (out.length >= limit) return
      const full = path.join(d, e.name)
      if (e.isDirectory()) await walk(full, depth + 1)
      else if (e.isFile() && re.test(e.name)) out.push(full)
    }
  }
  await walk(dir, 0)
  return out
}

/** 从一条 jsonl 会话行提取文本片段(兼容 claude/codex 等格式)。 */
function extractJsonText(line) {
  try {
    const obj = JSON.parse(line)
    const parts = []
    const walk = (v, depth) => {
      if (depth > 8 || parts.length >= 6) return
      if (typeof v === 'string') return
      if (Array.isArray(v)) { for (const it of v) walk(it, depth + 1); return }
      if (v && typeof v === 'object') {
        for (const key of Object.keys(v)) {
          const val = v[key]
          if (key === 'text' && typeof val === 'string' && val.trim()) parts.push(val.trim())
          else if (key === 'input_text' && typeof val === 'string' && val.trim()) parts.push(val.trim())
          else if ((key === 'content' || key === 'message') && val) walk(val, depth + 1)
          else if (key === 'summary' && typeof val === 'string' && val.trim()) parts.push(val.trim())
        }
      }
    }
    walk(obj, 0)
    const joined = parts.join(' | ').slice(0, 600)
    return joined || undefined
  } catch (e) { return undefined }
}

/**
 * Mount the memory engine: routes, tools, prompt section, reflection hooks.
 */
export function apply(ctx, config) {
  const engine = new MemoryEngine()
  const sessionQuery = ctx.get('sessionQuery')
  engine._sessionQuery = sessionQuery

  // 生命周期刷新
  const refreshAll = (agent) => { void engine.refresh(agent) }
  refreshAll()
  ctx.on('agent/session-start', (payload) => refreshAll(payload && payload.agent))
  ctx.on('agent/turn-stopping', (payload) => refreshAll(payload && payload.agent))

  // ---------- 系统提示词注入 ----------
  const disposeSection = ctx.systemPrompt.section({
    name: 'dsh:auto-memory',
    order: SECTION_ORDER,
    text: (context) => {
      try {
        const agent = context && context.agent
        if (!agent) return ''
        if (!engine.state.loadedAt || Date.now() - engine.state.loadedAt > 60000) {
          void engine.refresh(agent)
        }
        return engine.renderMemory(context) + engine.renderReflectionRequest()
      } catch (e) { return '' }
    },
  })

  // ---------- 工具 ----------
  const tools = [
    defineTool('memory_log', '向当前工作区的 .dsh-memory/ 今日日志追加一条工作记录(append-only,自动建目录/文件)。完成实质性工作(改代码/修 bug/写文档/重构/技术选型/用户偏好约定)后必须调用;有跨会话长期价值的内容在同一轮内一并写入记忆(memory_note 项目/ memory_user 跨项目),progress 与 memory 一起写;不要记录临时信息。', {
      note: { type: 'string', required: true, description: '简短条目:一句话概括做了什么、结果如何。' },
      date: { type: 'string', description: '日志日期 YYYY-MM-DD,缺省今天。' },
    }, async (args, exec) => {
      const date = DATE_RE.test(args.date || '') ? args.date : todayStr()
      const p = await engine.resolvePaths(exec.agent)
      const logPath = path.join(p.projectDir, date + '.md')
      const entry = '- ' + nowHm() + ' ' + String(args.note).trim()
      const body = await engine.appendText(logPath, entry)
      if (date === todayStr()) { engine.state.logText = body; engine.state.logPath = logPath; engine.state.loadedAt = Date.now() }
      return '已追加到 ' + logPath + '\n' + entry
    }),

    defineTool('memory_note', '更新当前项目长期笔记 .dsh-memory/MEMORY.md(本项目专属的约定、决策、架构要点)。action=append 追加一段(自动带日期标题);action=replace 整体替换(需先基于注入内容或 memory_recall 结果给出完整新内容)。', {
      content: { type: 'string', required: true, description: '笔记内容。' },
      action: { type: 'string', enum: ['append', 'replace'], required: true, description: 'append=追加, replace=整体替换。' },
    }, async (args, exec) => {
      const p = await engine.resolvePaths(exec.agent)
      const content = String(args.content || '').trim()
      if (!content) return 'memory_note: content 为空,未写入。'
      let body
      if (args.action === 'replace') {
        body = content
        await engine.writeFull(p.notesPath, body)
      } else {
        body = await engine.appendText(p.notesPath, '\n## ' + todayStr() + '\n' + content)
      }
      engine.state.notesText = body; engine.state.loadedAt = Date.now()
      return '已更新 ' + p.notesPath
    }),

    defineTool('memory_user', '更新用户级记忆 ~/.dsh/memory/MEMORY.md(跨所有项目的长期规则/偏好,用户明确要求记住时用)。action=append 追加;action=replace 整体替换。', {
      content: { type: 'string', required: true, description: '要记住的规则或偏好内容。' },
      action: { type: 'string', enum: ['append', 'replace'], required: true, description: 'append=追加, replace=整体替换。' },
    }, async (args, exec) => {
      const p = await engine.resolvePaths(exec.agent)
      const content = String(args.content || '').trim()
      if (!content) return 'memory_user: content 为空,未写入。'
      let body
      if (args.action === 'replace') {
        body = content
        await engine.writeFull(p.userFile, body)
      } else {
        body = await engine.appendText(p.userFile, '\n## ' + todayStr() + '\n' + content)
      }
      engine.state.userText = body; engine.state.loadedAt = Date.now()
      return '已更新 ' + p.userFile
    }),

    defineTool('memory_recall', '检索记忆:本地记忆文件(每日日志、项目笔记、用户级记忆、反思)关键词匹配 + 历史 DSH 会话全文检索(如部署启用)。用户提到过去的做法/讨论/决定而当前上下文没有时调用,查询必须自包含。', {
      query: { type: 'string', required: true, description: '检索关键词或自包含描述。' },
      limit: { type: 'integer', description: '最多返回条数,缺省 8。' },
    }, async (args, exec) => engine.recall(args.query, args.limit, exec.agent)),

    defineTool('memory_maintain', '维护记忆:把 days(缺省30)天前的 .dsh-memory/ 每日日志原样归档进项目 MEMORY.md 的归档段,并删除旧日志文件。归档保底不丢信息,之后可按返回结果决定是否精简归档段。', {
      days: { type: 'integer', description: '归档阈值天数,缺省 30。' },
    }, async (args, exec) => engine.maintain(args.days, exec.agent)),

    defineTool('memory_status', '查看自动记忆的当前状态:存储位置、各记忆文件大小、今日日志条数、待反思、上次刷新时间。用于确认记忆系统工作正常。', {}, async (_args, exec) => {
      const snap = await engine.snapshot(exec.agent)
      const lines = []
      lines.push('工作区: ' + snap.ws)
      lines.push('用户级记忆: ' + snap.userFile + ' — ' + snap.sizes.user + ' 字符')
      lines.push('项目笔记: ' + snap.notesPath + ' — ' + snap.sizes.notes + ' 字符')
      lines.push('今日日志: ' + snap.logPath + ' — ' + snap.sizes.log + ' 字符, ' + snap.todayEntries + ' 条')
      lines.push('最近反思: ' + (snap.latestReflectionDate || '(无)') + ' | 待反思: ' + (snap.pendingReflection || '(无)'))
      lines.push('上次刷新: ' + (snap.refreshedAt ? new Date(snap.refreshedAt).toLocaleString() : '尚未'))
      return lines.join('\n')
    }),

    defineTool('memory_reflect', '保存每日反思(在收到「昨日反思待生成」提示、并已在回复中呈现反思后调用)。将反思全文落盘到 .dsh-memory/reflections/YYYY-MM-DD.md,并标记该日反思完成。', {
      date: { type: 'string', required: true, description: '反思对应的日期 YYYY-MM-DD(即被反思那天的日志日期)。' },
      text: { type: 'string', required: true, description: '完整反思内容:成果回顾 / 教训改进 / 今日可延续要点。' },
    }, async (args, exec) => engine.saveReflection(args.date, args.text, exec.agent)),

    defineTool('memory_external', '查看/接入其他 AI 工具(CodeBuddy/Claude Code/Codex/项目约定文件等)的记忆。action=list 列出全部检测到的外部记忆源(路径/大小/预览/会话数);action=import 把某源内容整体接入本地记忆(source 为源 id,target=project 接进项目笔记 / user 接进用户级记忆,自动标注来源)。首次在新工作区工作、或用户提到其他软件里做过的事时调用。', {
      action: { type: 'string', enum: ['list', 'import'], required: true, description: 'list=列出外部记忆源; import=接入指定源。' },
      source: { type: 'string', description: '要接入的源 id(action=import 时必填,来自 list 结果)。' },
      target: { type: 'string', enum: ['project', 'user'], description: '接入目标: project=项目笔记(默认), user=用户级记忆。' },
    }, async (args, exec) => {
      if (args.action === 'list') {
        const list = await engine.external.summarize()
        if (!list.length) return '未检测到其他 AI 工具的记忆文件(可检查 ~/.codebuddy、~/.claude、~/.codex 等目录是否存在)。'
        const lines = []
        lines.push('检测到 ' + list.length + ' 个外部记忆源:')
        for (const s of list) {
          lines.push('· [' + s.id + '] ' + s.name + '(' + s.tool + ',' + s.kind + ') — ' + s.fileCount + ' 个文件, ' + fmtBytes(s.size) + (s.enabled ? '' : ',已停用'))
          if (s.preview) lines.push('  ' + s.preview.replace(/\n/g, ' | '))
          else lines.push('  (会话源,可检索不可整源预览)')
        }
        lines.push('接入: memory_external(action="import", source="<id>", target="project"|"user")')
        return lines.join('\n')
      }
      return engine.external.importInto(String(args.source || ''), args.target === 'user' ? 'user' : 'project', engine, exec.agent)
    }),
  ]

  // ---------- 路由 ----------
  const routes = [
    {
      kind: 'exact',
      path: API.state,
      handler: async (req, res) => {
        if (!isLoopbackRequest(req)) return writeJson(res, 403, { error: 'forbidden: loopback-only' })
        if ((req.method || 'GET') !== 'GET') return writeJson(res, 405, { error: 'method not allowed' })
        try { writeJson(res, 200, await engine.snapshot()) } catch (e) { writeJson(res, 500, { error: String(e && e.message ? e.message : e) }) }
      },
    },
    {
      kind: 'exact',
      path: API.list,
      handler: async (req, res) => {
        if (!isLoopbackRequest(req)) return writeJson(res, 403, { error: 'forbidden: loopback-only' })
        if ((req.method || 'GET') !== 'GET') return writeJson(res, 405, { error: 'method not allowed' })
        try {
          const p = await engine.resolvePaths(undefined)
          const logs = await engine.listDailyLogs(p.projectDir, 60)
          const reflections = await engine.listReflections(p.reflectDir, 60)
          const sizeOf = async (f) => { try { return (await stat(f)).size } catch { return 0 } }
          writeJson(res, 200, {
            projectDir: p.projectDir,
            logs: await Promise.all(logs.map(async (l) => ({ ...l, size: await sizeOf(path.join(p.projectDir, l.name)) }))),
            reflections: await Promise.all(reflections.map(async (r) => ({ ...r, size: await sizeOf(path.join(p.reflectDir, r.name)) }))),
            notesSize: await sizeOf(p.notesPath),
            userSize: await sizeOf(p.userFile),
          })
        } catch (e) { writeJson(res, 500, { error: String(e && e.message ? e.message : e) }) }
      },
    },
    {
      kind: 'exact',
      path: API.file,
      handler: async (req, res) => {
        if (!isLoopbackRequest(req)) return writeJson(res, 403, { error: 'forbidden: loopback-only' })
        if ((req.method || 'GET') !== 'GET') return writeJson(res, 405, { error: 'method not allowed' })
        try {
          const url = new URL(req.url || '/', 'http://localhost')
          let target = url.searchParams.get('path')
          if (!target) return writeJson(res, 400, { error: 'missing path' })
          // 先刷新路径缓存,避免用陈旧的工作区校验导致误 403
          await engine.refresh(undefined)
          const p = await engine.resolvePaths(undefined)
          // 相对文件名(如 2026-08-14.md / reflections/xxx.md)解析到项目记忆目录下
          if (!path.isAbsolute(target)) target = path.join(p.projectDir, target)
          if (!isUnderMemoryTree(engine, target)) return writeJson(res, 403, { error: 'path outside memory tree' })
          writeJson(res, 200, { path: path.resolve(target), content: await engine.readTextSafe(target) })
        } catch (e) { writeJson(res, 500, { error: String(e && e.message ? e.message : e) }) }
      },
    },
    {
      kind: 'exact',
      path: API.recall,
      handler: async (req, res) => {
        if (!isLoopbackRequest(req)) return writeJson(res, 403, { error: 'forbidden: loopback-only' })
        if ((req.method || 'POST') !== 'POST') return writeJson(res, 405, { error: 'method not allowed' })
        const body = await readJsonBody(req)
        if (!body || typeof body.query !== 'string') return writeJson(res, 400, { error: 'invalid body' })
        try { writeJson(res, 200, { result: await engine.recall(body.query, body.limit) }) } catch (e) { writeJson(res, 500, { error: String(e && e.message ? e.message : e) }) }
      },
    },
    {
      kind: 'exact',
      path: API.config,
      handler: async (req, res) => {
        if (!isLoopbackRequest(req)) return writeJson(res, 403, { error: 'forbidden: loopback-only' })
        const method = req.method || 'GET'
        try {
          if (method === 'GET') {
            writeJson(res, 200, { config: await engine.loadConfig(), path: engine._configPath })
            return
          }
          if (method === 'POST' || method === 'PUT') {
            const body = await readJsonBody(req)
            if (!body || typeof body !== 'object') return writeJson(res, 400, { error: 'invalid body' })
            const allowed = Object.keys(DEFAULT_CONFIG)
            const patch = {}
            for (const key of allowed) if (body[key] !== undefined) patch[key] = body[key]
            writeJson(res, 200, { config: await engine.saveConfig(patch) })
            return
          }
          writeJson(res, 405, { error: 'method not allowed' })
        } catch (e) { writeJson(res, 500, { error: String(e && e.message ? e.message : e) }) }
      },
    },
    {
      kind: 'exact',
      path: API.note,
      handler: async (req, res) => {
        if (!isLoopbackRequest(req)) return writeJson(res, 403, { error: 'forbidden: loopback-only' })
        if ((req.method || 'POST') !== 'POST') return writeJson(res, 405, { error: 'method not allowed' })
        const body = await readJsonBody(req)
        if (!body || typeof body.content !== 'string' || !body.content.trim()) return writeJson(res, 400, { error: 'invalid body' })
        try {
          const p = await engine.resolvePaths(undefined)
          const text = '\n## ' + todayStr() + '\n' + body.content.trim()
          const updated = await engine.appendText(p.notesPath, text)
          engine.state.notesText = updated
          engine.state.loadedAt = Date.now()
          writeJson(res, 200, { result: '已追加到 ' + p.notesPath })
        } catch (e) { writeJson(res, 500, { error: String(e && e.message ? e.message : e) }) }
      },
    },
    {
      kind: 'exact',
      path: API.external,
      handler: async (req, res) => {
        if (!isLoopbackRequest(req)) return writeJson(res, 403, { error: 'forbidden: loopback-only' })
        if ((req.method || 'GET') !== 'GET') return writeJson(res, 405, { error: 'method not allowed' })
        try { writeJson(res, 200, { sources: await engine.external.summarize() }) } catch (e) { writeJson(res, 500, { error: String(e && e.message ? e.message : e) }) }
      },
    },
    {
      kind: 'exact',
      path: API['external-import'],
      handler: async (req, res) => {
        if (!isLoopbackRequest(req)) return writeJson(res, 403, { error: 'forbidden: loopback-only' })
        if ((req.method || 'POST') !== 'POST') return writeJson(res, 405, { error: 'method not allowed' })
        const body = await readJsonBody(req)
        if (!body || typeof body.source !== 'string') return writeJson(res, 400, { error: 'invalid body' })
        try {
          const result = await engine.external.importInto(body.source, body.target === 'user' ? 'user' : 'project', engine)
          writeJson(res, 200, { result })
        } catch (e) { writeJson(res, 500, { error: String(e && e.message ? e.message : e) }) }
      },
    },
    {
      kind: 'exact',
      path: API.reflect,
      handler: async (req, res) => {
        if (!isLoopbackRequest(req)) return writeJson(res, 403, { error: 'forbidden: loopback-only' })
        if ((req.method || 'POST') !== 'POST') return writeJson(res, 405, { error: 'method not allowed' })
        const body = await readJsonBody(req)
        if (!body || typeof body.date !== 'string' || typeof body.text !== 'string') return writeJson(res, 400, { error: 'invalid body' })
        try { writeJson(res, 200, { result: await engine.saveReflection(body.date, body.text) }) } catch (e) { writeJson(res, 500, { error: String(e && e.message ? e.message : e) }) }
      },
    },
    {
      kind: 'exact',
      path: API['reflect-auto'],
      handler: async (req, res) => {
        if (!isLoopbackRequest(req)) return writeJson(res, 403, { error: 'forbidden: loopback-only' })
        if ((req.method || 'POST') !== 'POST') return writeJson(res, 405, { error: 'method not allowed' })
        try { writeJson(res, 200, { result: await engine.reflectAuto() }) } catch (e) { writeJson(res, 500, { error: String(e && e.message ? e.message : e) }) }
      },
    },
  ]

  // ---------- 注册与清理 ----------
  const disposers = []
  disposers.push(disposeSection)
  for (const tool of tools) disposers.push(ctx.tools.register(tool))
  for (const route of routes) disposers.push(ctx.webServer.register(route))
  ctx.effect(() => () => {
    for (const dispose of disposers) { try { dispose() } catch (e) {} }
  }, 'dsh-auto-memory: surfaces')

  console.log('[dsh-auto-memory] ready: engine + ' + tools.length + ' tools + injection + ' + routes.length + ' routes (external memory: ' + Object.keys(DEFAULT_CONFIG.externalSources).length + ' sources)')
}
