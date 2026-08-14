/**
 * dsh-auto-memory — host half.
 *
 * 集中式自动记忆系统,零运行时依赖(仅 node 内置模块):
 *   - 三层记忆:用户级(~/.dsh/memory/MEMORY.md)、项目笔记({ws}/.dsh-memory/MEMORY.md)、
 *     每日日志({ws}/.dsh-memory/YYYY-MM-DD.md,append-only)
 *   - 每次组装系统提示词时自动注入 <memory_system> 块(用户规则 + 项目笔记 + 今日日志 +
 *     最近反思 + 会话开始回顾指引);缓存由 启动/session-start/turn-stopping/工具写入/TTL 刷新
 *   - 每日反思:检测到"昨天有日志但未生成反思"时,在会话首轮注入反思请求块(风格可配:
 *     生活化/专业性/由内容决定),agent 生成后调 memory_reflect 落盘
 *   - 配置:~/DSH_HOME/dsh-auto-memory.json(存储位置、注入预算、反思风格等),UI 经
 *     /api/dsh-auto-memory/config 读写
 *   - 工具:memory_log / memory_note / memory_user / memory_recall / memory_maintain /
 *     memory_status / memory_reflect / memory_consolidate
 *   - 自动沉淀:每轮对话结束(turn-stopping)自动评估本轮内容,有记录价值的写今日日志
 *     ([自动沉淀] 标记),长期价值升格项目笔记/用户级记忆;寒暄轮跳过,按 turn 去重
 *   - 路由:/api/dsh-auto-memory/{state,list,file,recall,config,reflect}(loopback-only)
 */

import { readFile, writeFile, mkdir, readdir, stat, rm, copyFile } from 'node:fs/promises'
import { createReadStream, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** Stable cordis plugin name. */
export const name = 'auto-memory'

/** Services required before the memory surfaces can mount. */
export const inject = ['webServer', 'tools', 'systemPrompt', 'subagents']

/** Prompt order of the memory section. 10000 = 末尾注入(紧跟用户消息,recency 最高,保证记忆纪律/自动沉淀说明被模型最后读到,遵循度更高)。 */
const SECTION_ORDER = 10000

/** Model-facing announcement (tools + engine). */
export const GUIDANCE = '本机已安装 dsh-auto-memory 插件（集中式自动记忆 + 外部记忆继承）：三层本地记忆（用户级 ~/.dsh/memory/MEMORY.md、项目笔记与每日日志 .dsh-memory/）+ 会话自动注入 + 每日反思 + 其他 AI 工具记忆接入。能力：memory_log 追加今日日志（append-only，完成实质性工作后必须调用）；memory_note 更新项目笔记；memory_user 更新用户级规则；memory_recall 检索本地记忆 + 外部记忆（AI 助手/CodeBuddy/Claude Code/Codex 历史会话与画像）+ 历史 DSH 会话；memory_external 查看/接入外部记忆源；memory_maintain 归档 30 天前日志；memory_reflect 保存每日反思；memory_status 查看状态；memory_consolidate 让 AI 读日志发散提炼长期要点固化进笔记。自动沉淀：每轮对话结束插件自动评估本轮内容并写今日日志/升格长期记忆（寒暄轮跳过，可在设置关闭），无需你手动调 memory_log。主动性纪律：任务开始遇到不熟悉的代码/领域/历史决策时，先 memory_recall 检索本机全部 AI 工具历史，不凭空猜测；新工作区主动探索历史。限制：记忆文件为明文 Markdown；不存密钥除非用户明确要求；外部会话检索为关键词级（非语义）；GUI 侧边栏「记忆」面板（含「接续」页签）与设置页可查看/配置/接入。用户提到「记忆 / 昨天做了什么 / 之前怎么做的 / 每日反思 / 接续 / 其他 AI 的记忆」时即指本插件，请据此协作。'

/** Route family. */
export const API = {
  state: '/api/dsh-auto-memory/state',
  list: '/api/dsh-auto-memory/list',
  file: '/api/dsh-auto-memory/file',
  recall: '/api/dsh-auto-memory/recall',
  smartRecall: '/api/dsh-auto-memory/smart-recall',
  workspaces: '/api/dsh-auto-memory/workspaces',
  debug: '/api/dsh-auto-memory/debug',
  browseDir: '/api/dsh-auto-memory/browse-dir',
  pickDir: '/api/dsh-auto-memory/pick-dir',
  config: '/api/dsh-auto-memory/config',
  reflect: '/api/dsh-auto-memory/reflect',
  'reflect-auto': '/api/dsh-auto-memory/reflect-auto',
  note: '/api/dsh-auto-memory/note',
  external: '/api/dsh-auto-memory/external',
  'external-import': '/api/dsh-auto-memory/external-import',
  calendar: '/api/dsh-auto-memory/calendar',
  summarize: '/api/dsh-auto-memory/summarize',
  greet: '/api/dsh-auto-memory/greet',
}

const DEFAULT_CONFIG = {
  /** 用户级记忆目录(绝对路径或 ~ 开头)。 */
  userMemoryDir: '~/.dsh/memory',
  /** 项目级记忆目录名(相对工作区)。 */
  projectMemoryDir: '.dsh-memory',
  /** 集中式记忆根目录(集中式):所有工作区的记忆统一存放,每工作区一个子目录(旧版分散在各工作区 .dsh-memory/ 会自动迁移)。 */
  memoryRoot: '~/.dsh/memory/workspaces',
  /** 是否注入记忆上下文。 */
  injectEnabled: true,
  /** 注入总预算(字符)。 */
  injectBudgetChars: 2400,
  /** 注入的最近日志天数。 */
  recentDaysInjected: 3,
  /** 每轮对话结束自动沉淀记忆(subagent 判断+提炼,有 API 成本;默认开)。 */
  autoConsolidate: true,
  /** 自动沉淀内容门槛:本轮 user+assistant 文本总字符数低于此值视为寒暄,跳过。 */
  autoConsolidateMinChars: 60,
  /** 日界(分钟,从 0 点起算):凌晨在此之前的活儿归前一天日志;默认 450=早上 7:30 后才进入新一天。 */
  dayBoundaryMinutes: 450,
  /** 是否启用每日反思。 */
  reflectEnabled: true,
  /** 反思风格: auto=由内容决定 / life=生活化 / professional=专业性。 */
  reflectStyle: 'auto',
  /** UI 语言: zh=中文 / en=English。 */
  locale: 'zh',
  /** 外部记忆注入预算(字符)。 */
  externalInjectionChars: 1400,
  /** 外部记忆源开关(AI 助手/CodeBuddy/Claude Code/Codex/项目约定)。 */
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
const nowHms = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` }
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
      todayGreeting: '', greetingShownSession: undefined,
      calendarText: '', calendarPath: undefined,
      loadedAt: 0, loading: undefined, configLoaded: false,
    }
    this._configPath = path.join(dshHome(), 'dsh-auto-memory.json')
    this._readError = undefined
    this._lastAgent = undefined // 最近一次 agent 引用(subagent parent 需要完整 agent 对象)
    this._lastTurnByAgent = undefined // Map<agentId, turn>:自动沉淀去重(每轮只写一次)
    this._consolidating = undefined // 自动沉淀进行中标记(防重入)
    this._budgets = undefined // 每日写入预算:用户级4000/项目级3000字/天(所有会话共享,跨天重置)
    this.autoStats = { count: 0, lastAt: 0, lastText: '', lastDate: '' } // 自动沉淀统计(GUI 即时反馈)
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
    const oldRoot = this.expandUserPath(this.config.memoryRoot)
    const oldUser = this.expandUserPath(this.config.userMemoryDir)
    this.config = { ...this.config, ...patch }
    const newRoot = this.expandUserPath(this.config.memoryRoot)
    const newUser = this.expandUserPath(this.config.userMemoryDir)
    // 换存放位置时自动迁移旧文件(旧文件保留不删,新位置缺啥补啥),所有路径变量在下方 refresh 后全部跟随新配置
    let migrated = ''
    try {
      if (oldRoot && newRoot && oldRoot !== newRoot) {
        const olds = await readdir(oldRoot, { withFileTypes: true }).catch(() => [])
        let n = 0
        for (const en of olds) {
          if (!en.isDirectory()) continue
          const src = path.join(oldRoot, en.name)
          const dst = path.join(newRoot, en.name)
          try {
            const exists = await stat(dst).catch(() => null)
            if (!exists) { await this.copyDir(src, dst); n++ }
          } catch (e) {}
        }
        if (n) migrated = '已把旧位置 ' + n + ' 个工作区记忆迁移到新根(旧文件保留未删)。'
      }
      if (oldUser && newUser && oldUser !== newUser) {
        const olds = await readdir(oldUser, { withFileTypes: true }).catch(() => [])
        let n = 0
        for (const en of olds) {
          if (!en.isFile()) continue
          const src = path.join(oldUser, en.name)
          const dst = path.join(newUser, en.name)
          try {
            const exists = await stat(dst).catch(() => null)
            if (!exists) { await copyFile(src, dst); n++ }
          } catch (e) {}
        }
        if (n) migrated += (migrated ? ' ' : '') + '已把用户级记忆 ' + n + ' 个文件迁移到新目录(旧文件保留未删)。'
      }
    } catch (e) { console.error('[dsh-auto-memory] config migrate failed', e) }
    await mkdir(path.dirname(this._configPath), { recursive: true })
    await writeFile(this._configPath, JSON.stringify(this.config, null, 2), 'utf8')
    this.state.loadedAt = 0 // 强制重载(目录可能变化)
    await this.refresh(undefined)
    return { config: this.config, migrated }
  }

  // ---------- 路径 ----------
  expandUserPath(p) {
    if (typeof p !== 'string' || !p) return undefined
    if (p === '~') return homedir()
    if (p.startsWith('~/') || p.startsWith('~\\')) return path.join(homedir(), p.slice(2))
    return path.resolve(p)
  }

  /** 工作区路径 → 记忆子目录名(与 ~/.dsh/sessions 目录风格一致,可读且唯一)。 */
  wsKey(ws) {
    if (!ws) return 'default'
    return '--' + String(ws).replace(/[\\/:*?"<>|]/g, '-') + '--'
  }

  /** 集中式记忆根目录(集中式):所有工作区记忆统一存放,每工作区一个子目录。 */
  projectDirOf(ws) {
    const name = this.config.projectMemoryDir || '.dsh-memory'
    if (path.isAbsolute(name)) return name // 旧用法:绝对路径兼容
    const root = this.expandUserPath(this.config.memoryRoot) || path.join(dshHome(), 'memory', 'workspaces')
    return path.join(root, this.wsKey(ws))
  }

  /** 递归复制目录(迁移用)。 */
  async copyDir(src, dst) {
    await mkdir(dst, { recursive: true })
    const entries = await readdir(src, { withFileTypes: true })
    for (const en of entries) {
      const s = path.join(src, en.name)
      const d = path.join(dst, en.name)
      if (en.isDirectory()) await this.copyDir(s, d)
      else if (en.isFile()) await copyFile(s, d)
    }
  }

  /** 旧版分散结构({ws}/.dsh-memory) → 集中式根目录 自动迁移(复制,不删旧,安全)。 */
  async migrateLegacy(ws, projectDir) {
    try {
      if (!ws) return
      const legacy = path.join(ws, '.dsh-memory')
      let legacyOk = false
      try { legacyOk = (await stat(legacy)).isDirectory() } catch (e) {}
      if (!legacyOk) return
      let targetOk = false
      try { targetOk = (await stat(projectDir)).isDirectory() } catch (e) {}
      if (targetOk) return
      await this.copyDir(legacy, projectDir)
      console.log('[dsh-auto-memory] migrated memory: ' + legacy + ' -> ' + projectDir)
    } catch (e) { console.error('[dsh-auto-memory] migrate failed', e) }
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
      calendarPath: path.join(userDir, 'CALENDAR.md'),
      projectDir,
      notesPath: path.join(projectDir, 'MEMORY.md'),
      logPath: path.join(projectDir, `${this.memToday()}.md`),
      reflectDir: path.join(projectDir, 'reflections'),
      greetDir: path.join(projectDir, 'greetings'),
      greetPath: path.join(projectDir, 'greetings', `${this.memToday()}.json`),
      greetPathLegacy: path.join(projectDir, 'greetings', `${this.memToday()}.md`),
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
      const today = this.memToday()
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
        // 旧版分散记忆({ws}/.dsh-memory) → 集中式根目录 自动迁移
        await this.migrateLegacy(p.ws, p.projectDir)
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
        // 今日拟人化问候(每天首会话展示一次;新 .json 优先,旧 .md 兼容)
        this.state.todayGreeting = (await this.readTextSafe(p.greetPath)) || (await this.readTextSafe(p.greetPathLegacy))
        // 日历/日程(用户级,跨工作区与重装保留)
        this.state.calendarPath = p.calendarPath
        this.state.calendarText = await this.readTextSafe(p.calendarPath)
        // 外部记忆探测(后台,结果进缓存)
        if (this.config.externalSources) void this.external.discover(true)
        // 记忆地图:其他工作区(名称+最近日志日期),供注入引导跨区检索
        try {
          const map = []
          // 工作区发现 5 分钟缓存(周期刷新每 15s 触发一次,全量扫描 sessions 太贵)
          let cwds
          if (this._wsCache && Date.now() - this._wsCache.at < 5 * 60 * 1000) {
            cwds = this._wsCache.list
          } else {
            cwds = await this.discoverWorkspaces()
            this._wsCache = { at: Date.now(), list: cwds }
          }
          for (const cwd of cwds) {
            if (cwd === p.ws) continue
            const p2 = this.projectDirOf(cwd)
            if (p2 === p.projectDir) continue
            const logs2 = await this.listDailyLogs(p2, 1)
            if (!logs2.length) continue
            const name = String(cwd).split(/[\\/]/).filter(Boolean).pop() || cwd
            map.push(name + '(最近日志 ' + logs2[0].date + ')')
          }
          this.state.workspaceMap = map
        } catch (e) { this.state.workspaceMap = [] }
        this.state.loadedAt = Date.now()
      } catch (e) {
        console.error('[dsh-auto-memory] refresh failed', e)
      }
  }

  /** 记忆日:日界(默认 7:30)前把凌晨归到前一天;日界后进入新一天。日志/沉淀/反思/问候/预算都按它切日。 */
  memToday() {
    const b = Number(this.config.dayBoundaryMinutes)
    const boundary = Number.isFinite(b) && b >= 0 ? b : 450
    const d = new Date()
    if (d.getHours() * 60 + d.getMinutes() < boundary) d.setDate(d.getDate() - 1)
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  }

  // ---------- 每日写入预算 + 超限自动压缩(硬约束,但不拒绝新内容) ----------
  /**
   * 用户级 ≤4000 字/天、项目级 ≤3000 字/天(所有会话共享一天预算,跨天重置)。
   * 超限时不直接拒绝:先自动压缩"今天之前"的旧内容腾出空间(ensureBudget),压缩不可用时才拒绝。
   */
  accountWrite(agent, layer, text) {
    if (!this._budgets) this._budgets = new Map()
    const today = this.memToday()
    let b = this._budgets.get('today')
    if (!b || b.date !== today) { b = { date: today, user: 0, note: 0 }; this._budgets.set('today', b) }
    const limit = layer === 'user' ? 4000 : 3000
    const next = b[layer] + String(text || '').length
    if (next > limit) return { ok: false, used: b[layer], limit, remaining: Math.max(0, limit - b[layer]) }
    b[layer] = next
    return { ok: true, used: next, limit, remaining: limit - next }
  }

  /** 预算保障:超限时自动压缩旧内容腾位;压缩成功返回 compacted:true,否则 ok:false。 */
  async ensureBudget(agent, layer, text) {
    const acct = this.accountWrite(agent, layer, text)
    if (acct.ok) return { ok: true, acct }
    const compacted = await this.compactLayer(agent, layer)
    if (compacted) {
      const acct2 = this.accountWrite(agent, layer, text)
      if (acct2.ok) return { ok: true, acct: acct2, compacted: true }
    }
    return { ok: false, acct }
  }

  /** 压缩层内"今天之前"的旧段落:AI 提炼要点替换,不可用时归档最早段落;10 分钟节流。 */
  async compactLayer(agent, layer) {
    const now = Date.now()
    if (this._lastCompactAt && now - this._lastCompactAt < 10 * 60 * 1000) return false
    const p = await this.resolvePaths(agent)
    const cur = (layer === 'user' ? this.state.userText : this.state.notesText) || ''
    if (!cur.trim()) return true
    const limit = layer === 'user' ? 4000 : 3000
    const today = this.memToday()
    // 按 "## 标题" 切段,今天段落保留,之前段落为压缩对象;文件头非 ## 内容归入头部段,不丢失
    const segs = []
    let curSeg = { title: '(文件头)', body: [], isToday: false }
    for (const ln of cur.split('\n')) {
      const m = ln.match(/^##\s+(.+)$/)
      if (m) {
        if (curSeg) segs.push(curSeg)
        const title = m[1].trim()
        curSeg = { title, body: [], isToday: /^\d{4}-\d{2}-\d{2}/.test(title) && title.slice(0, 10) === today }
      } else if (curSeg) {
        curSeg.body.push(ln)
      }
    }
    if (curSeg) segs.push(curSeg)
    const oldSegs = segs.filter((s) => !s.isToday)
    const todaySegs = segs.filter((s) => s.isToday)
    const oldText = oldSegs.map((s) => '## ' + s.title + '\n' + s.body.join('\n')).join('\n').trim()
    const todayText = todaySegs.map((s) => '## ' + s.title + '\n' + s.body.join('\n')).join('\n').trim()
    const target = Math.max(limit, 200) // 压缩后旧部分目标:不超过层上限
    if (oldText.length <= target) return true // 旧内容本来就不大,无需压缩
    let newOld = ''
    if (this._subagents && agent) {
      try {
        const layerName = layer === 'user' ? '用户级记忆' : '项目笔记'
        const prompt = [
          '你是记忆整理员。下面的' + layerName + '文件里"今天之前"的旧内容需要压缩,因为今天要写入的新内容已超当日预算。',
          '规则:',
          '- 保留所有仍有长期价值的硬信息:强制规则、偏好、关键决策、约定、账号/路径等',
          '- 合并重复、删除已失效/过期条目、把长句压到 20 字内',
          '- 输出 markdown,可用"## 主题"分组,输出将直接替换旧内容',
          '- 只输出压缩结果正文,不要任何解释',
          '',
          '待压缩旧内容:',
          truncateTail(oldText, 6000),
        ].join('\n')
        const out = await this.runSubagent(prompt, 'auto-memory-compact', agent)
        if (out && !out.includes('(无)')) newOld = out.trim()
      } catch (e) {
        console.error('[dsh-auto-memory] compactLayer AI failed', e && e.message ? e.message : e)
      }
    }
    if (!newOld) {
      // AI 不可用降级:把最早段落移入归档文件,直到旧部分 ≤ target(保底不丢)
      const archiveFile = layer === 'user'
        ? path.join(dshHome(), 'memory', 'archived-user.md')
        : path.join(p.projectDir, 'archive', 'notes-archived.md')
      await mkdir(path.dirname(archiveFile), { recursive: true })
      let segs2 = oldSegs.slice()
      let remain = oldText
      while (remain.length > target && segs2.length) {
        const seg = segs2.shift()
        await this.appendText(archiveFile, '\n## ' + seg.title + '\n' + seg.body.join('\n'))
        remain = segs2.map((s) => '## ' + s.title + '\n' + s.body.join('\n')).join('\n').trim()
      }
      newOld = remain.slice(0, target)
    }
    newOld = newOld.slice(0, target)
    const body = [newOld, todayText].filter(Boolean).join('\n\n')
    await this.writeFull(layer === 'user' ? p.userFile : p.notesPath, body)
    if (layer === 'user') this.state.userText = body
    else this.state.notesText = body
    // 压缩腾出的空间让当日额度重新计(今天段落仍在文件里,不丢)
    if (this._budgets) {
      const b = this._budgets.get('today')
      if (b && b.date === this.memToday()) b[layer] = 0
    }
    this._lastCompactAt = now
    this.state.loadedAt = Date.now()
    console.log('[dsh-auto-memory] compacted ' + layer + ' memory: ' + cur.length + ' -> ' + body.length + ' chars')
    return true
  }

  // ---------- 注入渲染(同步,基于缓存) ----------
  renderMemory(context) {
    const s = this.state
    const cfg = this.config
    const budget = Math.max(Number(cfg.injectBudgetChars) || 2400, 400)
    const lines = []
    lines.push('<memory_system>')
    lines.push('自动记忆已启用。工作区: ' + (s.ws || '(未知)') + ' | 日期: ' + this.memToday() + '(日界 ' + (Number(cfg.dayBoundaryMinutes) || 450) + ' 分钟,凌晨归前一天)' + (cfg.autoConsolidate === false ? ' | 自动沉淀: 已关闭' : ' | 自动沉淀: 每轮对话结束自动评估'))
    // 记忆地图:告诉模型其他工作区记忆存在,需要时用 memory_recall 跨区检索
    if (s.workspaceMap && s.workspaceMap.length) {
      lines.push('其他工作区记忆(开发/排查时可调用 memory_recall 检索其日志/笔记): ' + s.workspaceMap.join('、'))
    }
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
    // 日历/日程注入(让 AI 主动感知 deadline/约定)
    if (this.state.calendarText && this.state.calendarText.trim()) {
      const calEntries = this.parseCalendar(this.state.calendarText).filter((en) => !en.done && en.date >= todayStr()).slice(0, 10)
      if (calEntries.length) {
        const calLines = calEntries.map((en) => '· ' + en.date + ' ' + en.time + ' | ' + en.quadrant + ' | ' + en.title).join('\n')
        lines.push('\n[日历与日程(未完成)]\n' + calLines + '\n主动关注这些安排:对话中若提及相关时间点,主动用 calendar_add 补充新事项、calendar_done 标记完成;回复正文中向用户转述日历变更。')
      }
    }
    // 暂离回来提示:距上次活动>1小时,要求 agent 在回复开头写欢迎语并提示打开记忆窗口
    if (this._lastActiveAt && Date.now() - this._lastActiveAt > 3600000) {
      lines.push('\n[欢迎回来]')
      lines.push('用户离开已超过 1 小时(暂离/下班后回来)。在本轮回复的开头,先用一句简短温暖的话欢迎用户回来(如"欢迎回来!你离开的这段时间,我已经帮你把日志整理好了。"),然后提示"自动记忆窗口将打开,方便你了解这段时间的状况"(如已由 GUI 弹出概览则不必重复提示)。语气自然,一两句即可,不要长篇大论。')
    }
    lines.push('\n[铭文 · 每轮提醒 ' + nowHms() + ']')
    lines.push('思维链=本轮推理(用完即焚);铭文=落盘的记忆文件(跨会话永久)。你的记忆更新必须落在铭文层——显式调用工具写盘,不能只"想过"。')
    lines.push('本提醒由框架在每一轮对话开始时重新注入(时间戳即刷新证明,衰减期只有一轮):读写只走工具、路径写死、每轮结束框架自动评估沉淀兜底——记忆无法被绕过,也不依赖自觉。')
    lines.push('\n[记忆写入纪律 — 必须遵守]')
    lines.push('- 会话开始:若任务与历史工作/历史决策相关,先回顾以上记忆;**遇到不熟悉的代码、领域或项目时,主动调用 memory_recall 检索本机所有 AI 工具的历史记忆(AI 助手/CodeBuddy/Claude Code/Codex 会话),不要凭空猜测**。')
    lines.push('- 新工作区(无历史日志/笔记):主动用 memory_recall 探索本机历史,判断该项目是否曾在其他 AI 工具中工作过;也可调用 memory_external 查看并接入外部记忆;检索时在正文中说明"我先查一下之前的记录"。')
    lines.push('- 完成实质性工作后立即调用 memory_log 追加今日日志(append-only,绝不覆盖):建/改应用、修 bug、写文档、重构、技术选型、用户约定或偏好。')
    lines.push('- progress 与 memory 一起写:写日志的同时,把有跨会话长期价值的内容一并写入记忆——跨项目规则 → memory_user,仅本项目 → memory_note;两者在同一轮完成,互不冲突、不遗漏。')
    lines.push('- 只记录有跨会话长期价值的;不记临时信息(搜索结果、临时路径、工具报错)。')
    lines.push('- 每日写入预算(所有会话共享一天额度,跨天自动重置):用户级 ≤4000 字/天、项目笔记 ≤3000 字/天;超限不拒绝——框架自动把"今天之前"的旧内容交给 AI 浓缩成要点腾出空间(10 分钟内只压缩一次),AI 不可用时归档最早段落,信息不丢;每日日志无预算。')
    lines.push('- **记忆操作必须在正文可见(摘要链)**:调用 memory_log/note/user/reflect 更新记忆后,必须把结果写进本轮回复的正文文本(用户直接看到的那段文字,不是工具调用区),并在**回复末尾**用加粗或换行使其醒目(如"**已更新今日日志**\n新增:修复了XXX");调用 memory_recall/memory_external 检索时,在正文开头写明"我查了记忆,发现..."。工具返回值只是辅助,正文转述是强制要求。')
    lines.push('- 用户明确要求长期记住:跨项目规则 → memory_user;仅本项目 → memory_note。')
    lines.push('- 定期调用 memory_maintain 做 30 天蒸馏:AI 提炼旧日志要点进项目笔记,原文保底归档;不存密钥,除非用户明确要求。')
    lines.push('- 自动沉淀:每轮对话结束,插件会自动评估本轮内容,把有记录价值的写进今日日志([自动沉淀] 标记),有长期价值的升格到项目笔记/用户级记忆,寒暄轮自动跳过。你仍须按上方纪律转述自己的显式记忆操作;也可调用 memory_consolidate 让 AI 读日志发散提炼长期要点。')
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

  /** 今日问候数据(纯数据,供 GUI 概览页渲染,不注入对话流)。 */
  greetingData() {
    const hour = new Date().getHours()
    const period = hour < 6 ? '凌晨' : hour < 9 ? '早上好' : hour < 12 ? '上午好' : hour < 14 ? '中午好' : hour < 18 ? '下午好' : hour < 22 ? '晚上好' : '夜深了'
    // 时段 key(与 client 一致):凌晨/夜深 归入 morning/evening
    const seg = hour < 6 ? 'morning' : hour < 9 ? 'morning' : hour < 12 ? 'forenoon' : hour < 14 ? 'noon' : hour < 18 ? 'afternoon' : 'evening'
    // 问候:greetings/{date}.json 按时段存;旧 .md 纯文本兼容
    let greetText = ''
    const raw = this.state.todayGreeting || ''
    if (raw) {
      try { const j = JSON.parse(raw); greetText = (j && (j[seg] || '')) || '' } catch (e) { greetText = raw }
    }
    // 昨天 = 最近一条日志(今天之前的);今天有条目也算最近
    const recent = this.state.recentLogs[0] || null
    const entries = recent ? recent.text.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('- ')).map((l) => {
      const m = l.match(/^- (\d{2}:\d{2}) (.*)$/)
      return m ? { time: m[1], text: m[2] } : { time: '', text: l.replace(/^- /, '') }
    }) : []
    return {
      period,
      date: this.memToday(),
      hasGreeting: !!greetText,
      greeting: greetText,
      yesterdayDate: recent ? recent.date : '',
      entries,
      hasPendingReflection: !!this.state.pendingReflection,
      pendingReflectionDate: this.state.pendingReflection ? this.state.pendingReflection.date : '',
    }
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
    const scanFile = async (label, filePath, maxMatches = 3, target = hits) => {
      const text = await this.readTextSafe(filePath)
      if (!text) return
      const matched = []
      for (const line of text.split('\n')) {
        if (line.toLowerCase().includes(q)) {
          matched.push(line.trim().slice(0, 200))
          if (matched.length >= maxMatches) break
        }
      }
      if (matched.length) target.push({ where: label, matches: matched })
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
    // 其他 DSH 工作区记忆(跨工作区检索:从 sessions 发现的所有工作区,任何模型/新会话都能查到)
    const otherHits = []
    try {
      const cwds = await this.discoverWorkspaces()
      for (const cwd of cwds) {
        if (hits.length + otherHits.length >= limit) break
        if (cwd === p.ws) continue
        const p2 = this.projectDirOf(cwd)
        if (p2 === p.projectDir) continue
        const wsName = String(cwd).split(/[\\/]/).filter(Boolean).pop() || cwd
        const logs2 = await this.listDailyLogs(p2, 15)
        for (const log of logs2) {
          if (hits.length + otherHits.length >= limit) break
          await scanFile('其他工作区[' + wsName + '] ' + log.name, path.join(p2, log.name), 2, otherHits)
        }
        await scanFile('其他工作区[' + wsName + '] 项目笔记', path.join(p2, 'MEMORY.md'), 2, otherHits)
      }
    } catch (e) {}
    if (otherHits.length) {
      out.push('== 其他工作区记忆命中(跨工作区) ==')
      for (const h of otherHits) out.push('· ' + h.where + ':\n' + h.matches.map((m) => '  - ' + m).join('\n'))
    }
    // 外部记忆(其他 AI 工具遗产)检索
    try {
      const extHits = await this.external.search(query, Math.max(limit - hits.length, 2))
      if (extHits.length) {
        out.push('== 外部记忆命中(AI 助手/CodeBuddy/Claude/Codex/项目约定) ==')
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
    if (!out.length) return '[记忆检索] 查询 "' + q + '" —— 未找到相关记忆。'
    return '[记忆检索] "' + q + '":\n' + out.join('\n')
  }

  /** 多关键词扫描三层记忆(供智能检索用),返回 {where, line} 列表。 */
  async collectHits(keywords, limit) {
    const p = await this.resolvePaths(undefined)
    const hits = []
    const seen = new Set()
    const scanFile = async (label, filePath) => {
      const text = await this.readTextSafe(filePath)
      if (!text) return
      let matched = 0
      for (const line of text.split('\n')) {
        const lt = line.toLowerCase()
        if (keywords.some((k) => k && lt.includes(k))) {
          const key = label + '|' + line.trim().slice(0, 80)
          if (seen.has(key)) continue
          seen.add(key)
          hits.push({ where: label, line: line.trim().slice(0, 220) })
          matched++
          if (matched >= 2) break
        }
      }
    }
    const logs = await this.listDailyLogs(p.projectDir, 30)
    for (const log of logs) { if (hits.length >= limit) break; await scanFile(log.name, path.join(p.projectDir, log.name)) }
    const reflections = await this.listReflections(p.reflectDir, 20)
    for (const rf of reflections) { if (hits.length >= limit) break; await scanFile('reflections/' + rf.name, path.join(p.reflectDir, rf.name)) }
    await scanFile('~' + p.userFile.slice(homedir().length), p.userFile)
    await scanFile(p.projectDir + '/MEMORY.md', p.notesPath)
    return hits.slice(0, limit)
  }

  /** 智能检索:AI 发散关键词 → 扫描三层记忆 → AI 综合答案。 */
  async smartRecall(query, agent) {
    const q = String(query || '').trim()
    if (!q) return { answer: '检索内容为空。', keywords: [], hits: [] }
    // 第一轮:AI 把自然语言转成关键词
    const kwPrompt = [
      '你是记忆检索助手。用户想从记忆里查找信息,请把用户的自然语言描述转换成 3-6 个检索关键词(短词/短语,每行一个):',
      '- 覆盖核心词、同义词、相关词(如"上次发布踩的坑" → 发布 / 踩坑 / 发布失败 / npm)',
      '- 只输出关键词,每行一个,不要序号、不要解释、不要多余文字',
      '',
      '用户查询: ' + q,
    ].join('\n')
    const kwText = await this.withTimeout(this.runSubagent(kwPrompt, 'auto-memory-smart-kw', agent), 8000, '')
    const keywords = (kwText || '').split('\n').map((l) => l.trim().replace(/^[-•\d.\s]+/, '')).filter((l) => l && l.length <= 24).slice(0, 6)
    if (!keywords.length) keywords.push(q.slice(0, 20))
    // 扫描三层记忆
    const hits = await this.collectHits(keywords.map((k) => k.toLowerCase()), 14)
    let answer = ''
    if (!hits.length) {
      answer = '没找到与"' + q + '"直接相关的记忆记录。可以换个说法,或试试普通关键词检索。'
    } else {
      const hitText = hits.map((h, i) => (i + 1) + '. [' + h.where + '] ' + h.line).join('\n')
      const ansPrompt = [
        '你是用户的记忆管家。根据下面检索命中的记忆片段,回答用户的查询。要求:',
        '- 用自然语言回答(60-200字),像朋友交谈,不要罗列堆砌',
        '- 引用命中里的关键信息(时间/项目/结论),并注明来自哪份记忆(日志日期/项目笔记/用户级记忆)',
        '- 命中内容不足以回答时,如实说明,并概括命中了什么相关片段',
        '- 不要编造记忆里没有的信息',
        '',
        '用户查询: ' + q,
        '',
        '检索关键词: ' + keywords.join(' / '),
        '',
        '命中片段:',
        hitText,
      ].join('\n')
      answer = await this.withTimeout(this.runSubagent(ansPrompt, 'auto-memory-smart-ans', agent), 15000, '')
      if (!answer) answer = '已检索到 ' + hits.length + ' 条相关记录,但 AI 综合失败(可能对话繁忙),请看下方命中明细。'
    }
    return { answer, keywords, hits: hits.map((h) => ({ where: h.where, line: h.line })) }
  }

  // ---------- 工作区总览(跨工作区全局总结) ----------
  /** 读 jsonl 首行(session header)。 */
  readFirstLine(p) {
    return new Promise((resolve) => {
      const rs = createReadStream(p, { encoding: 'utf8' })
      let buf = ''
      rs.on('data', (chunk) => {
        buf += chunk
        const i = buf.indexOf('\n')
        if (i >= 0) { rs.destroy(); resolve(buf.slice(0, i)) }
      })
      rs.on('end', () => resolve(buf))
      rs.on('error', () => resolve(''))
    })
  }

  /** 扫描 ~/.dsh/sessions 下所有会话,提取去重后的工作区路径。 */
  async discoverWorkspaces() {
    const out = new Map()
    const sessionsDir = path.join(dshHome(), 'sessions')
    const walk = async (dir, depth) => {
      if (depth > 4) return
      let entries
      try { entries = await readdir(dir, { withFileTypes: true }) } catch (e) { return }
      for (const en of entries) {
        if (out.size >= 30) return
        if (en.isDirectory()) await walk(path.join(dir, en.name), depth + 1)
        else if (en.isFile() && en.name.endsWith('.jsonl')) {
          try {
            const first = await this.readFirstLine(path.join(dir, en.name))
            if (first) {
              const h = JSON.parse(first)
              if (h && typeof h.cwd === 'string' && h.cwd) out.set(h.cwd, true)
            }
          } catch (e) {}
        }
      }
    }
    await walk(sessionsDir, 0)
    return Array.from(out.keys())
  }

  /** 读取某工作区的近期记忆(最近5天日志 + 项目笔记头部),无 .dsh-memory 返回 null。 */
  async readWorkspaceMemory(cwd) {
    const dir = this.projectDirOf(cwd)
    try { const st = await stat(dir); if (!st.isDirectory()) return null } catch (e) { return null }
    const logs = []
    try {
      const entries = await readdir(dir, { withFileTypes: true })
      const dates = entries.filter((en) => en.isFile() && DATE_RE.test(en.name.replace(/\.md$/, ''))).map((en) => en.name.slice(0, 10)).sort().reverse().slice(0, 5)
      for (const d of dates) {
        const t = await this.readTextSafe(path.join(dir, d + '.md'))
        if (t) logs.push({ date: d, text: truncateTail(t, 1200) })
      }
    } catch (e) {}
    const notes = await this.readTextSafe(path.join(dir, 'MEMORY.md'))
    return { logs, notes: truncateHead(notes || '', 800) }
  }

  /** 工作区总览:每个工作区一个小总结 + 区内细分总结;结果缓存到用户级 ~/.dsh/memory/workspaces-summary.json(跨工作区全局)。 */
  async workspaceOverview(agent, force) {
    const cacheFile = path.join(dshHome(), 'memory', 'workspaces-summary.json')
    if (!force) {
      try {
        const raw = await this.readTextSafe(cacheFile)
        if (raw) {
          const j = JSON.parse(raw)
          if (j && Array.isArray(j.workspaces)) return { workspaces: j.workspaces, cached: true, generatedAt: j.generatedAt }
        }
      } catch (e) {}
    }
    const cwds = await this.discoverWorkspaces()
    const workspaces = []
    for (const cwd of cwds.slice(0, 8)) {
      const mem = await this.readWorkspaceMemory(cwd)
      if (!mem || (!mem.logs.length && !mem.notes)) continue
      const name = String(cwd).split(/[\\/]/).filter(Boolean).pop() || cwd
      let summary = ''
      let items = []
      if (mem.logs.length || mem.notes) {
        const logText = mem.logs.map((l) => '[' + l.date + '] ' + l.text).join('\n')
        const prompt = [
          '你是用户的记忆管家。下面是某个工作区的近期记忆(最近5天日志+项目笔记),请:',
          '1. 写一段 40-100 字的小总结:这个工作区在做什么、最近进展与主要成果,口语化一点。',
          '2. 列出 2-5 条细分总结(每条 15-40 字),按日期或主题归纳(如"8-14: 发布 v0.1.9"、"进行中: 扩展框架")。',
          '输出格式(严格遵守,不要多余文字):',
          '[SUMMARY]',
          '<小总结>',
          '[ITEM]',
          '<细分1>',
          '[ITEM]',
          '<细分2>',
          '',
          '工作区: ' + name,
          '',
          '近期日志:',
          logText.slice(0, 6000) || '(无)',
          '',
          '项目笔记:',
          mem.notes || '(无)',
        ].join('\n')
        const text = await this.withTimeout(this.runSubagent(prompt, 'auto-memory-ws-summary', agent), 30000, '')
        let cur = null
        for (const raw of String(text || '').split('\n')) {
          const l = raw.trim()
          if (!l) continue
          if (l.startsWith('[SUMMARY]')) { cur = 'summary'; continue }
          if (l.startsWith('[ITEM]')) { cur = 'item'; continue }
          if (cur === 'summary' && l) summary += (summary ? '\n' : '') + l
          else if (cur === 'item' && l && items.length < 6) items.push(l.slice(0, 120))
        }
      }
      workspaces.push({
        path: cwd,
        name,
        summary,
        items,
        logCount: mem.logs.reduce((a, l) => a + (l.text.split('\n').filter((x) => x.trim().startsWith('- ')).length), 0),
        dateRange: mem.logs.length ? (mem.logs[mem.logs.length - 1].date + ' ~ ' + mem.logs[0].date) : '',
      })
    }
    const result = { workspaces, generatedAt: Date.now() }
    try {
      await mkdir(path.dirname(cacheFile), { recursive: true })
      await writeFile(cacheFile, JSON.stringify(result, null, 2), 'utf8')
    } catch (e) {}
    return { workspaces, cached: false, generatedAt: result.generatedAt }
  }

  // ---------- 调试中心(为提 issue 提供诊断信息) ----------
  async debugInfo() {
    const p = await this.resolvePaths(undefined)
    const startTime = Date.now() - process.uptime() * 1000
    // host 版本与文件时间(判断"代码改了但没重启")
    let version = ''
    let indexPath = ''
    let indexMtime = 0
    try {
      indexPath = fileURLToPath(import.meta.url)
      const pkgPath = path.join(path.dirname(indexPath), '..', 'package.json')
      const raw = await this.readTextSafe(pkgPath)
      if (raw) { try { version = JSON.parse(raw).version || '' } catch (e) {} }
      try { indexMtime = (await stat(indexPath)).mtimeMs } catch (e) {}
    } catch (e) {}
    // 轮询心跳
    const hbFile = path.join(dshHome(), 'memory', 'polling-heartbeat.json')
    let heartbeat = { exists: false }
    try {
      const raw = await this.readTextSafe(hbFile)
      if (raw) { heartbeat = Object.assign({ exists: true }, JSON.parse(raw)) }
    } catch (e) {}
    // subagents
    let providers = []
    try { providers = this._subagents && this._subagents.list ? this._subagents.list() : [] } catch (e) {}
    // 记忆文件状态
    const sizeMtime = async (f) => {
      try { const s = await stat(f); return { exists: true, size: s.size, mtime: s.mtimeMs } } catch (e) { return { exists: false } }
    }
    // 项目笔记重复日期标题检测
    let duplicateHeadings = 0
    try {
      const notes = await this.readTextSafe(p.notesPath)
      const seen = {}
      for (const line of String(notes || '').split('\n')) {
        const m = line.match(/^##\s+(\d{4}-\d{2}-\d{2})\s*$/)
        if (m) { seen[m[1]] = (seen[m[1]] || 0) + 1 }
      }
      duplicateHeadings = Object.values(seen).filter((n) => n > 1).length
    } catch (e) {}
    return {
      host: {
        pid: process.pid,
        startTime,
        uptimeSec: Math.round(process.uptime()),
        version,
        indexPath,
        indexMtime,
        needsRestart: !!(indexMtime && indexMtime > startTime + 5000),
      },
      config: this.config,
      heartbeat,
      autoConsolidate: {
        enabled: this.config.autoConsolidate !== false,
        minChars: Math.max(Number(this.config.autoConsolidateMinChars) || 60, 20),
        consolidating: !!this._consolidating,
        pendingQueue: (this._pendingConsolidations || []).length,
        stats: this.autoStats,
      },
      subagents: { available: !!this._subagents, providers },
      memoryFiles: {
        user: await sizeMtime(p.userFile),
        notes: await sizeMtime(p.notesPath),
        log: await sizeMtime(p.logPath),
        reflectionsDir: await sizeMtime(p.reflectDir),
        calendar: await sizeMtime(p.calendarPath),
        workspacesCache: await sizeMtime(path.join(dshHome(), 'memory', 'workspaces-summary.json')),
        summariesDir: await sizeMtime(path.join(p.projectDir, 'summaries')),
      },
      duplicateHeadings,
      budgets: (() => {
        const out = []
        if (this._budgets) {
          for (const [, b] of this._budgets.entries()) {
            out.push({
              scope: 'daily', date: b.date,
              userUsed: b.user, userLimit: 4000,
              noteUsed: b.note, noteLimit: 3000,
              userFileSize: (this.state.userText || '').length,
              noteFileSize: (this.state.notesText || '').length,
              lastCompactAt: this._lastCompactAt || 0,
            })
          }
        }
        return out
      })(),
      today: todayStr(),
      memoryDate: this.memToday(),
      now: Date.now(),
    }
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

  // ---------- 日历/日程(用户级 CALENDAR.md) ----------
  /** 解析 CALENDAR.md 为条目数组。 */
  parseCalendar(text) {
    const out = []
    let curDate = ''
    for (const raw of String(text || '').split('\n')) {
      const line = raw.trim()
      if (!line) continue
      const dm = line.match(/^## (\d{4}-\d{2}-\d{2})/)
      if (dm) { curDate = dm[1]; continue }
      // - [x] HH:MM | 象限 | 标题 | (备注)
      const m = line.match(/^- \[([ xX])\] (\d{1,2}:\d{2}) \| (重要紧急|重要不紧急|紧急不重要|不重要不紧急|未分类) \| (.+?)(?: \| (.*))?$/)
      if (m) {
        out.push({
          date: curDate, done: m[1] !== ' ', time: m[2], quadrant: m[3], title: m[4].trim(), note: (m[5] || '').trim(),
        })
      }
    }
    return out
  }

  /** 序列化条目为 CALENDAR.md 文本。 */
  renderCalendar(entries) {
    const byDate = {}
    for (const en of entries) { (byDate[en.date] ||= []).push(en) }
    const dates = Object.keys(byDate).sort()
    const lines = ['# 日历与日程 (CALENDAR)', '', '> 由 dsh-auto-memory 维护;AI 可从对话中提取 deadline/约定写入,用户也可在 GUI 操作。', '']
    for (const date of dates) {
      lines.push('## ' + date)
      for (const en of byDate[date].sort((a, b) => (a.time || '').localeCompare(b.time || ''))) {
        const mark = en.done ? 'x' : ' '
        const note = en.note ? ' | ' + en.note : ''
        lines.push('- [' + mark + '] ' + (en.time || '--:--') + ' | ' + (en.quadrant || '未分类') + ' | ' + en.title + note)
      }
      lines.push('')
    }
    return lines.join('\n')
  }

  /** 添加/更新日历条目并落盘(用户级)。 */
  async calendarAdd(item, agent) {
    const p = await this.resolvePaths(agent)
    const entries = this.parseCalendar(this.state.calendarText || await this.readTextSafe(p.calendarPath))
    entries.push({
      date: item.date || todayStr(), done: !!item.done, time: item.time || '--:--',
      quadrant: item.quadrant || '未分类', title: String(item.title || '').trim(), note: String(item.note || '').trim(),
    })
    const body = this.renderCalendar(entries)
    await this.writeFull(p.calendarPath, body)
    this.state.calendarText = body; this.state.loadedAt = Date.now()
    return '已加入日历: ' + item.date + ' ' + (item.time || '') + ' ' + item.title + ' (' + (item.quadrant || '未分类') + ')'
  }

  /** 标记条目完成。 */
  async calendarDone(date, time, title, agent) {
    const p = await this.resolvePaths(agent)
    const entries = this.parseCalendar(this.state.calendarText || await this.readTextSafe(p.calendarPath))
    const hit = entries.find((en) => en.date === date && en.time === time && en.title === title)
    if (!hit) return '未找到该日历条目: ' + date + ' ' + time + ' ' + title
    hit.done = true
    const body = this.renderCalendar(entries)
    await this.writeFull(p.calendarPath, body)
    this.state.calendarText = body; this.state.loadedAt = Date.now()
    return '已标记完成: ' + date + ' ' + title
  }

  /** 删除条目。 */
  async calendarRemove(date, time, title, agent) {
    const p = await this.resolvePaths(agent)
    const entries = this.parseCalendar(this.state.calendarText || await this.readTextSafe(p.calendarPath))
    const before = entries.length
    const kept = entries.filter((en) => !(en.date === date && en.time === time && en.title === title))
    if (kept.length === before) return '未找到该日历条目: ' + date + ' ' + time + ' ' + title
    const body = this.renderCalendar(kept)
    await this.writeFull(p.calendarPath, body)
    this.state.calendarText = body; this.state.loadedAt = Date.now()
    return '已删除日历条目: ' + date + ' ' + title
  }

  /** 时段摘要:把今日日志按 时段(早晨/上午/下午/晚上)切分。 */
  periodSummary() {
    const today = this.state.logText || ''
    const entries = today.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('- ')).map((l) => {
      const m = l.match(/^- (\d{2}):(\d{2}) (.*)$/)
      return m ? { h: Number(m[1]), text: m[3] } : null
    }).filter(Boolean)
    const bucket = (h) => h < 5 ? '凌晨' : h < 9 ? '早晨' : h < 12 ? '上午' : h < 14 ? '中午' : h < 18 ? '下午' : '晚上'
    const groups = { '凌晨': [], '早晨': [], '上午': [], '中午': [], '下午': [], '晚上': [] }
    for (const en of entries) { (groups[bucket(en.h)] ||= []).push(en.text) }
    return { entries, groups, todayDate: todayStr() }
  }

  /** 生活化总结:调用 DSH 的 AI(subagent)发散地总结某时段的工作(完成/收尾/烦恼/暂停的事)。 */
  async summarizePeriod(period, agent, force) {
    const ps = this.periodSummary()
    const groups = ps.groups || {}
    const items = (period === '昨天') ? (this.state.recentLogs[0] ? this.state.recentLogs[0].text.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('- ')).map((l) => l.replace(/^- /, '')) : []) : (groups[period] || [])
    if (!items.length) return { summary: '', works: [], cached: true, generatedAt: Date.now() }
    // 缓存文件(.dsh-memory/summaries/),force=false 且缓存存在时直接返回,不重复生成
    let cacheFile = ''
    try {
      const p = await this.resolvePaths(agent)
      cacheFile = path.join(p.projectDir, 'summaries', this.memToday() + '-' + period + '.json')
    } catch (e) {}
    if (!force && cacheFile) {
      try {
        const raw = await this.readTextSafe(cacheFile)
        if (raw) {
          const j = JSON.parse(raw)
          if (j && j.summary && Array.isArray(j.works)) return { summary: j.summary, works: j.works, generatedAt: j.generatedAt || Date.now(), cached: true }
        }
      } catch (e) {}
    }
    const prompt = [
      '你是一个温暖、细腻的生活助理。请阅读用户某时段的原始工作记录,做两件事:',
      '1. 写一段生活化总结(80-160字),像朋友聊天:概括完成的事、是否收尾、可能的烦恼(温和带过,看不出就跳过);不要列表、不要小标题、不要"总结:"前缀。',
      '2. 把原始记录归纳成若干项"工作"(3-6项),每项给简短标题(8-16字),并列出该工作的细点(每项2-4条,每条20-40字,从原始记录提炼精简,不要逐字复制长句)。',
      '输出格式(严格遵守,不要多余文字):',
      '[SUMMARY]',
      '<生活化总结>',
      '[WORK] <工作标题1>',
      '- <细点1>',
      '- <细点2>',
      '[WORK] <工作标题2>',
      '- <细点1>',
      '',
      '用户时段工作记录(' + period + '):',
      items.map((x) => '- ' + x).join('\n'),
    ].join('\n')
    const text = await this.runSubagent(prompt, 'auto-memory-summarize', agent)
    if (!text) return { summary: '', works: [], cached: false, generatedAt: Date.now() }
    // 解析 [SUMMARY]/[WORK]/- 结构
    let summary = ''
    const works = []
    let cur = null
    for (const raw of text.split('\n')) {
      const l = raw.trim()
      if (!l) continue
      if (l.startsWith('[SUMMARY]')) continue
      if (l.startsWith('[WORK]')) { cur = { title: l.slice(6).trim(), points: [] }; works.push(cur); continue }
      if (l.startsWith('- ') || l.startsWith('• ')) {
        const pt = l.replace(/^[-•]\s*/, '').trim()
        if (cur && pt) cur.points.push(pt)
        else if (pt) summary += (summary ? '\n' : '') + pt
        continue
      }
      if (!cur && l) summary += (summary ? '\n' : '') + l
    }
    const result = { summary, works, generatedAt: Date.now(), cached: false }
    if (cacheFile) {
      try { await mkdir(path.dirname(cacheFile), { recursive: true }); await writeFile(cacheFile, JSON.stringify(result, null, 2), 'utf8') } catch (e) {}
    }
    return result
  }

  /** 今日 AI 问候(按时段,每天每时段生成一次并缓存到 greetings/{date}.json)。 */
  async greetToday(agent) {
    const hour = new Date().getHours()
    const seg = hour < 6 ? 'morning' : hour < 9 ? 'morning' : hour < 12 ? 'forenoon' : hour < 14 ? 'noon' : hour < 18 ? 'afternoon' : 'evening'
    const segLabel = { morning: '早上', forenoon: '上午', noon: '中午', afternoon: '下午', evening: '晚上' }[seg]
    const p = await this.resolvePaths(agent)
    const greetFile = path.join(p.greetDir, this.memToday() + '.json')
    // 已有该时段缓存 → 直接返回
    try {
      const raw = await this.readTextSafe(greetFile)
      if (raw) {
        const j = JSON.parse(raw)
        if (j && j[seg]) return { greeting: j[seg], cached: true }
      }
    } catch (e) {}
    // 今日记录(供问候引用最近几条)
    const items = (this.state.logText || '').split('\n').map((l) => l.trim()).filter((l) => l.startsWith('- ')).map((l) => l.replace(/^- \d{2}:\d{2} /, '').replace(/^- /, '')).slice(-6)
    const prompt = [
      '你是一个温暖的生活助理。现在是' + segLabel + ',请给用户写一句简短的拟人化问候(30-60字),像朋友一样:',
      '- 按时间段自然问候(' + segLabel + '好/辛苦了之类),自然提起今天完成的主要工作(挑1-2件最重要的),可以带一句贴心提醒(如早点休息)',
      '- 语气轻松温暖,不要列表、不要"总结:"、不要感叹号堆砌、不要 emoji',
      '- 只输出问候语本身,不要任何前后缀',
      '',
      '今天已记录的工作(选重要的提):',
      (items.length ? items.map((x) => '- ' + x).join('\n') : '(今天还没有记录)'),
    ].join('\n')
    const text = await this.runSubagent(prompt, 'auto-memory-greet', agent)
    if (!text) return { greeting: '', cached: false }
    // 合并写缓存(同一天多时段共存)
    let all = {}
    try { const raw = await this.readTextSafe(greetFile); if (raw) { const j = JSON.parse(raw); if (j) all = j } } catch (e) {}
    all[seg] = text
    try { await mkdir(p.greetDir, { recursive: true }); await writeFile(greetFile, JSON.stringify(all, null, 2), 'utf8') } catch (e) {}
    return { greeting: text, cached: false }
  }

  /** 调用 DSH subagent 发散/提炼一段文本(90s 超时,结果取 text 块;parent 用最近 agent)。 */
  async runSubagent(text, label, agent) {
    const subagents = this._subagents
    if (!subagents) return ''
    // parent 必须是完整 agent 对象(captureDelegatedPolicyOverrides 读 parent.ctx/parent.session);路由调用用缓存的最近 agent
    const parent = agent || this._lastAgent
    // 动态选择可用的 subagent provider(优先 spawn,否则取已注册的第一个)
    let providerName = 'spawn'
    let registered = []
    try {
      registered = subagents.list ? subagents.list() : []
      if (Array.isArray(registered) && registered.length && !registered.includes('spawn')) providerName = registered[0]
    } catch (e2) {}
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(label + ' timeout'), 90000)
    try {
      // prompt 必须是 block 数组(createUserMessage 校验 content.some)
      const run = await subagents.start(providerName, {
        label,
        prompt: [{ type: 'text', text }],
        signal: controller.signal,
        ...(parent ? { parent } : {}),
      })
      const result = await run.result
      const blocks = result && result.output ? result.output : []
      return blocks.filter((b) => b && b.type === 'text').map((b) => b.text).join('').trim()
    } catch (e) {
      console.error('[dsh-auto-memory] ' + label + ' failed', e && e.message ? e.message : e)
      return ''
    } finally {
      clearTimeout(timer)
    }
  }

  /** 带超时的 promise(超时返回 fallback,不无限等待)。 */
  async withTimeout(promise, ms, fallback) {
    let timer
    try {
      return await Promise.race([
        promise,
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout after ' + ms + 'ms')), ms) }),
      ])
    } catch (e) { return fallback }
    finally { clearTimeout(timer) }
  }

  /** 每轮对话结束自动沉淀:取本轮 user+assistant 消息 → subagent 判断/提炼 → 写今日日志+升格。 */
  async consolidateTurn(turn, agent) {
    if (this._consolidating) return
    if (!this.configLoaded) { try { await this.loadConfig() } catch (e) {} }
    if (this.config.autoConsolidate === false) return
    if (!agent || !agent.session) return
    // 只处理顶层会话(子代理/接续会话的 header.parentSession 非空,避免子代理轮次误沉淀)
    try { if (agent.session.header && agent.session.header.parentSession) return } catch (e) {}
    const minChars = Math.max(Number(this.config.autoConsolidateMinChars) || 60, 20)
    // 按 turn 去重:同一 agent 的同一轮只处理一次
    const agentId = agent.id || (agent.session && agent.session.id) || '?'
    if (!this._lastTurnByAgent) this._lastTurnByAgent = new Map()
    const lastTurn = this._lastTurnByAgent.get(agentId)
    if (lastTurn === turn) return
    this._lastTurnByAgent.set(agentId, turn)
    // 取本轮最后一条 user + 最后一条 assistant(模型可见消息序列)
    const messages = extractSessionMessages(agent)
    if (messages.length < 2) return
    let userText = ''
    let assistantText = ''
    for (const m of messages) {
      if (m.role === 'user') userText = m.text
      else if (m.role === 'assistant' && m.text) assistantText = m.text
    }
    if (!userText.trim() || !assistantText.trim()) return
    const combined = userText + '\n' + assistantText
    if (combined.length < minChars) return
    this._consolidating = (async () => {
      try {
        await this.refresh(agent)
        const p = await this.resolvePaths(agent)
        // 今日日志尾部(去重参考)
        const logTail = truncateTail(this.state.logText || '', 900)
        const prompt = [
          '你是用户的记忆管家。刚结束一轮对话,请判断其中是否有值得写入记忆的内容,并提炼要点。',
          '规则:',
          '- 寒暄、闲聊、单纯问候、纯测试、无实质内容 → 只输出 (无)',
          '- 有实质内容(完成工作、修复问题、做出决策、约定规则、用户偏好、讨论结论)时,提炼 1-3 条要点',
          '- 每条一句话,具体明确,不要泛泛而谈,不要复述对话过程',
          '- 项目专属的进度 → [LOG];有跨会话长期价值的项目决策/架构/约定 → [NOTE];跨项目通用的用户硬性规则/偏好 → [USER]',
          '- [NOTE]/[USER] 只在真正长期有价值时用,宁缺毋滥',
          '输出格式(严格遵守):',
          '[TOPIC]',
          '<本轮工作主题标题,8-20字,如"修复抽屉bug与字号功能">',
          '[LOG]',
          '- 要点1',
          '[NOTE]',
          '- 要点2',
          '[USER]',
          '- 规则',
          '没有值得记录的内容时只输出一行:(无)',
          '',
          '本轮用户消息:',
          userText.slice(0, 3000),
          '',
          '本轮助手回复:',
          assistantText.slice(0, 3000),
          '',
          '今日日志已有内容(避免重复记录):',
          logTail || '(空)',
        ].join('\n')
        const text = await this.runSubagent(prompt, 'auto-memory-consolidate', agent)
        if (!text) {
          // subagent 失败(返回空):入重试队列,由后台轮询兜底重试
          if (!this._pendingConsolidations) this._pendingConsolidations = []
          if (this._pendingConsolidations.length < 5) this._pendingConsolidations.push({ turn, agent })
          return
        }
        if (text.includes('(无)')) return
        const logPts = []
        const notePts = []
        const userPts = []
        let topicTitle = ''
        let section = ''
        for (const raw of text.split('\n')) {
          const l = raw.trim()
          if (!l) continue
          if (l === '[LOG]') { section = 'log'; continue }
          if (l === '[NOTE]') { section = 'note'; continue }
          if (l === '[USER]') { section = 'user'; continue }
          if (l === '[TOPIC]') { section = 'topic'; continue }
          if (section === 'topic') { if (!topicTitle) topicTitle = l.slice(0, 30); continue }
          if (l.startsWith('- ') && (section === 'log' || section === 'note' || section === 'user')) {
            const pt = l.slice(2).trim()
            if (pt) {
              if (section === 'log') logPts.push(pt)
              else if (section === 'note') notePts.push(pt)
              else userPts.push(pt)
            }
          }
        }
        const today = this.memToday()
        let written = 0
        if (logPts.length) {
          // 集中式主题分组: ## 主题(HH:MM) + 要点列表(自动沉淀不再混入时间戳流水)
          const topic = (topicTitle || '自动沉淀') + '（' + nowHm() + '）'
          const body = await this.appendText(p.logPath, '\n## ' + topic + '\n' + logPts.map((x) => '- ' + x).join('\n'))
          this.state.logText = body; this.state.logPath = p.logPath
          written += logPts.length
        }
        if (notePts.length) {
          const r = await this.ensureBudget(agent, 'note', notePts.map((x) => '- ' + x).join('\n'))
          if (r.ok) {
            const body = await this.appendText(p.notesPath, '\n## ' + today + '\n' + notePts.map((x) => '- ' + x).join('\n'))
            this.state.notesText = body
            written += notePts.length
          } else {
            console.log('[dsh-auto-memory] auto-consolidate: NOTE 超预算且压缩不可用,已跳过')
          }
        }
        if (userPts.length) {
          const r = await this.ensureBudget(agent, 'user', userPts.map((x) => '- ' + x).join('\n'))
          if (r.ok) {
            const body = await this.appendText(p.userFile, '\n## ' + today + '\n' + userPts.map((x) => '- ' + x).join('\n'))
            this.state.userText = body
            written += userPts.length
          } else {
            console.log('[dsh-auto-memory] auto-consolidate: USER 超预算且压缩不可用,已跳过')
          }
        }
        if (written) {
          // 自动沉淀统计(跨天重置)
          if (this.autoStats.lastDate !== today) { this.autoStats.count = 0; this.autoStats.lastDate = today }
          this.autoStats.count += written
          this.autoStats.lastAt = Date.now()
          this.autoStats.lastText = (logPts[0] || notePts[0] || userPts[0] || '').slice(0, 80)
          this.state.loadedAt = Date.now()
          console.log('[dsh-auto-memory] auto-consolidated turn ' + turn + ': +' + written + ' points (log ' + logPts.length + ', note ' + notePts.length + ', user ' + userPts.length + ')')
        }
      } catch (e) {
        console.error('[dsh-auto-memory] consolidateTurn failed', e && e.message ? e.message : e)
      } finally {
        this._consolidating = undefined
      }
    })()
    await this._consolidating
  }

  /** AI 主动固化(做梦式):读最近日志 → 发散提炼 → 项目笔记/用户级 MEMORY.md 带日期标题。 */
  async consolidateMemory(agent, days = 7) {
    const subagents = this._subagents
    if (!subagents) return 'memory_consolidate: subagents 服务不可用,无法调用 AI 提炼。'
    const p = await this.resolvePaths(agent)
    const logs = await this.listDailyLogs(p.projectDir, 60)
    const recent = []
    for (const log of logs) {
      if (recent.length >= days) break
      const text = await this.readTextSafe(path.join(p.projectDir, log.name))
      if (text && text.trim()) recent.push({ date: log.date, text: truncateTail(text, 2500) })
    }
    if (!recent.length) return 'memory_consolidate: 最近 ' + days + ' 天没有日志,没有可提炼的内容。'
    const prompt = [
      '你是用户的长期记忆管家。请阅读下面的工作日志,发散提炼出值得长期记住的内容,把记忆固化成条目。',
      '规则:',
      '- 只提炼有跨会话长期价值的:技术决策、架构约定、关键路径、用户偏好/习惯、踩过的坑及其规则',
      '- 不记临时信息(某次具体修 bug 的过程省略,但其背后的规则/约定值得记)',
      '- 项目专属 → [PROJECT];跨项目通用的用户硬性规则/偏好 → [USER]',
      '- 每条一句话,简短明确;已经在下方"已有记忆"里出现的不要重复',
      '输出格式(严格遵守):',
      '[PROJECT]',
      '- 要点1',
      '- 要点2',
      '[USER]',
      '- 规则1',
      '若没有任何值得长期记录的内容,只输出一行:(无)',
      '',
      '最近 ' + days + ' 天日志:',
      recent.map((r) => '### ' + r.date + '\n' + r.text).join('\n\n'),
      '',
      '已有项目笔记(尾部):',
      truncateTail(this.state.notesText || '', 1200) || '(空)',
      '',
      '已有用户级记忆(尾部):',
      truncateTail(this.state.userText || '', 1200) || '(空)',
    ].join('\n')
    const text = await this.runSubagent(prompt, 'auto-memory-consolidate-logs', agent)
    if (!text) return 'memory_consolidate: AI 提炼失败(超时或 subagent 不可用),未写入任何内容。'
    if (text.includes('(无)')) return 'memory_consolidate: AI 判断最近日志没有值得长期记录的新内容。'
    const projectPts = []
    const userPts = []
    let section = ''
    for (const raw of text.split('\n')) {
      const l = raw.trim()
      if (!l) continue
      if (l === '[PROJECT]') { section = 'project'; continue }
      if (l === '[USER]') { section = 'user'; continue }
      if (l.startsWith('- ') && section) {
        const pt = l.slice(2).trim()
        if (pt) { if (section === 'project') projectPts.push(pt); else userPts.push(pt) }
      }
    }
    const today = this.memToday()
    const written = []
    const skipped = []
    if (projectPts.length) {
      const r = await this.ensureBudget(agent, 'note', projectPts.map((x) => '- ' + x).join('\n'))
      if (r.ok) {
        const body = await this.appendText(p.notesPath, '\n## ' + today + '\n' + projectPts.map((x) => '- ' + x).join('\n'))
        this.state.notesText = body
        written.push('项目笔记 ' + projectPts.length + ' 条')
      } else skipped.push('项目笔记(预算超限且压缩不可用)')
    }
    if (userPts.length) {
      const r = await this.ensureBudget(agent, 'user', userPts.map((x) => '- ' + x).join('\n'))
      if (r.ok) {
        const body = await this.appendText(p.userFile, '\n## ' + today + '\n' + userPts.map((x) => '- ' + x).join('\n'))
        this.state.userText = body
        written.push('用户级记忆 ' + userPts.length + ' 条')
      } else skipped.push('用户级记忆(预算超限且压缩不可用)')
    }
    this.state.loadedAt = Date.now()
    if (!written.length) {
      if (skipped.length) return 'memory_consolidate: AI 已提炼,但今日写入预算已用尽,以下层被跳过(明天再固化): ' + skipped.join('、') + '。'
      return 'memory_consolidate: AI 未提炼出值得长期记录的内容。'
    }
    const detail = []
    if (projectPts.length) detail.push('项目笔记新增:\n' + projectPts.map((x) => '- ' + x).join('\n'))
    if (userPts.length) detail.push('用户级记忆新增:\n' + userPts.map((x) => '- ' + x).join('\n'))
    if (skipped.length) detail.push('被今日预算跳过: ' + skipped.join('、'))
    return 'memory_consolidate 完成,已固化 ' + written.join('、') + '(带日期标题)。\n' + detail.join('\n\n')
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
  /** 30 天蒸馏:AI 提炼旧日志要点进项目笔记,原文保底归档到 archive/,活跃日志移除。 */
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
    if (!oldLogs.length) return '没有超过 ' + days + ' 天的日志,无需蒸馏。'
    // 1) AI 蒸馏:提炼有长期价值的要点(不可用则降级为原样归档)
    let distillText = ''
    if (this._subagents && agent) {
      try {
        const digest = []
        for (const log of oldLogs) {
          const text = await this.readTextSafe(path.join(p.projectDir, log.name))
          if (text && text.trim()) digest.push('### ' + log.name + '\n' + truncateTail(text, 2000))
        }
        if (digest.length) {
          const prompt = [
            '你是用户的记忆管家。以下日志已超过 ' + days + ' 天,请把它们蒸馏成值得长期记住的要点。',
            '规则:',
            '- 只提炼有跨会话长期价值的:技术决策、架构约定、关键路径、用户偏好/习惯、踩过的坑及其规则',
            '- 丢弃过程流水(某次具体修 bug 的过程、临时路径、搜索结果、报错细节)',
            '- 按主题组织,可用"### 主题"小标题,每条一句话,简短明确',
            '- 不要复述日志原文,只要蒸馏后的要点',
            '输出格式:markdown(### 主题 + - 要点)。若没有任何值得保留的内容,只输出一行:(无)',
            '',
            '待蒸馏日志:',
            digest.join('\n\n'),
          ].join('\n')
          const out = await this.runSubagent(prompt, 'auto-memory-distill', agent)
          if (out && !out.includes('(无)')) distillText = out.trim().slice(0, 3000)
        }
      } catch (e) {
        console.error('[dsh-auto-memory] maintain distill failed', e && e.message ? e.message : e)
      }
    }
    // 2) 原文保底归档到 archive/(不占注入窗口,绝不丢信息)
    const archiveDir = path.join(p.projectDir, 'archive')
    await mkdir(archiveDir, { recursive: true })
    const archived = []
    for (const log of oldLogs) {
      try {
        const text = await this.readTextSafe(path.join(p.projectDir, log.name))
        if (text) { await this.writeFull(path.join(archiveDir, log.name), text); archived.push(log.name) }
      } catch (e) {}
    }
    // 3) 蒸馏结果写项目笔记;无 AI 时原样归档段保底
    let noteMsg = ''
    if (distillText) {
      const body = await this.appendText(p.notesPath, '\n## 30 天蒸馏(蒸馏于 ' + this.memToday() + ')\n' + distillText)
      this.state.notesText = body
      noteMsg = '\n蒸馏提炼已写入 ' + p.notesPath + ':\n' + truncateTail(distillText, 600)
    } else if (archived.length) {
      let archive = '\n## 归档日志(归档于 ' + this.memToday() + ')'
      for (const name of archived) {
        const t = await this.readTextSafe(path.join(archiveDir, name))
        if (t) archive += '\n\n### ' + name + '\n' + t
      }
      const body = await this.appendText(p.notesPath, archive)
      this.state.notesText = body
      noteMsg = '\nAI 蒸馏不可用,原文已按老方式归档到 ' + p.notesPath
    }
    // 4) 活跃目录移除旧日志(原文已在 archive/ 保底)
    const deleted = []
    const kept = []
    for (const log of oldLogs) {
      try {
        await rm(path.join(p.projectDir, log.name), { force: true })
        deleted.push(log.name)
      } catch (e) { kept.push(log.name) }
    }
    this.state.loadedAt = Date.now()
    return '30 天蒸馏完成:' + (distillText ? ' AI 提炼 + 原文归档' : ' 原文归档') + ' ' + oldLogs.length + ' 个旧日志(' + deleted.join(', ') + ')' +
      '\n原文保底: ' + archiveDir + ' (' + archived.length + ' 个文件)' +
      noteMsg +
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
      autoStats: this.autoStats,
      greeting: this.greetingData(),
      calendar: this.parseCalendar(this.state.calendarText),
      calendarPath: this.state.calendarPath,
      periodSummary: this.periodSummary(),
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
// 目标:让 DSH 继承用户在 AI 助手 / CodeBuddy / Claude Code / Codex /
// Cursor 等工具中积累的记忆,持续拟合用户画像。
//
// 源分三类:
//   - markdown 记忆(用户级/画像/项目约定):内容小,直接读入缓存,注入/检索/接入
//   - 会话日志(jsonl,AI 助手 projects / Claude projects / Codex sessions):
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
    const stamp = '## 来自 ' + src.tool + '(' + src.name + ') — 接入于 ' + this.memToday()
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

/** 从 agent.session 提取模型可见消息序列 [{role,text,sourceKind}]。 */
function extractSessionMessages(agent) {
  try {
    const session = agent && agent.session
    if (!session) return []
    const nodes = session.surface && session.surface.nodes
    if (!nodes) return []
    const seqs = Array.isArray(nodes) ? nodes : (nodes instanceof Set ? Array.from(nodes) : [])
    if (!seqs.length) return []
    const events = session.events || []
    const out = []
    for (const seq of seqs) {
      const ev = events[seq]
      if (!ev) continue
      let msg = null
      if (ev.type === 'user/message') msg = ev.data
      else if (ev.type === 'assistant/message' || ev.type === 'tool/result') msg = ev.data && ev.data.message
      if (!msg || !msg.role || !Array.isArray(msg.content)) continue
      const text = msg.content
        .filter((b) => b && typeof b === 'object' && typeof b.text === 'string')
        .map((b) => b.text).join('')
      out.push({ role: msg.role, text, sourceKind: msg.source && msg.source.kind })
    }
    return out
  } catch (e) { return [] }
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

/** 从一条 jsonl 会话行提取文本片段(兼容 claude/codex/workbuddy 格式)。 */
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
  engine._subagents = ctx.get('subagents') || undefined

  // 生命周期刷新
  const refreshAll = (agent) => { void engine.refresh(agent) }
  refreshAll()
  ctx.on('agent/session-start', (payload) => {
    refreshAll(payload && payload.agent)
    // 缓存最近 agent 引用(subagent parent 需要完整 agent 对象)
    try { if (payload && payload.agent) engine._lastAgent = payload.agent } catch (e) {}
  })
  ctx.on('agent/turn-stopping', (payload) => {
    refreshAll(payload && payload.agent)
    // 记录最后活动时间(判断暂离回来用)
    try { engine._lastActiveAt = Date.now() } catch (e) {}
    // 每轮自动沉淀:取本轮消息 → subagent 判断/提炼 → 写今日日志([自动沉淀])+升格长期记忆
    // 注意:turn-stopping payload 只有 {turn, signal},没有 agent 字段,必须用 _lastAgent 兜底
    try {
      const agent = (payload && payload.agent) || engine._lastAgent
      if (agent && agent.session) void engine.consolidateTurn(payload.turn, agent)
    } catch (e) {}
  })
  // 注入层保障:systemPrompt section.text 是同步函数不能 await,state 异步加载会导致首轮注入为空。
  // pre-step 是 waterfall(可 await),在放行每个 step 前条件性刷新:
  // 首轮(loadedAt=0)必定 await 完 → 模型从第一个 token 起就看到记忆;之后每 15s 跟进轮间新写入。
  ctx.on('agent/pre-step', async (payload, next) => {
    try {
      const agent = (payload && payload.agent) || engine._lastAgent
      // 只刷新顶层会话:子代理(自动沉淀/固化的 subagent)session 无 cwd,刷新会把 state 切到错误工作区
      let skip = false
      try { if (agent && agent.session && agent.session.header && agent.session.header.parentSession) skip = true } catch (e) {}
      if (!skip && agent && (!engine.state.loadedAt || Date.now() - engine.state.loadedAt > 15000)) {
        await engine.refresh(agent)
      }
    } catch (e) {}
    return next()
  })

  // ---------- 系统提示词注入 ----------
  const disposeSection = ctx.systemPrompt.section({
    name: 'dsh:auto-memory',
    order: SECTION_ORDER,
    text: (context) => {
      try {
        const agent = context && context.agent
        if (!agent) return ''
        if (!engine.state.loadedAt || Date.now() - engine.state.loadedAt > 15000) {
          void engine.refresh(agent)
        }
        return engine.renderMemory(context) + engine.renderReflectionRequest()
      } catch (e) { return '' }
    },
  })

  // ---------- 工具 ----------
  const tools = [
    defineTool('memory_log', '向当前工作区的 .dsh-memory/ 今日日志追加一条工作记录(append-only,自动建目录/文件)。完成实质性工作(改代码/修 bug/写文档/重构/技术选型/用户偏好约定)后必须调用;有跨会话长期价值的内容在同一轮内一并写入记忆(memory_note 项目/ memory_user 跨项目),progress 与 memory 一起写;不要记录临时信息。**调用后必须在本轮回复正文(摘要可见的正文,不是工具调用区)中向用户转述一句:如"已把 X 记入今日日志"**。', {
      note: { type: 'string', required: true, description: '简短条目:一句话概括做了什么、结果如何。' },
      date: { type: 'string', description: '日志日期 YYYY-MM-DD,缺省今天。' },
    }, async (args, exec) => {
      const date = DATE_RE.test(args.date || '') ? args.date : engine.memToday()
      const p = await engine.resolvePaths(exec.agent)
      const logPath = path.join(p.projectDir, date + '.md')
      const entry = '- ' + nowHm() + ' ' + String(args.note).trim()
      const body = await engine.appendText(logPath, entry)
      if (date === engine.memToday()) { engine.state.logText = body; engine.state.logPath = logPath; engine.state.loadedAt = Date.now() }
      return '已更新记忆文档: ' + logPath + '\n' + entry
    }),

    defineTool('memory_note', '更新当前项目长期笔记 .dsh-memory/MEMORY.md(本项目专属的约定、决策、架构要点)。action=append 追加一段(自动带日期标题);action=replace 整体替换(需先基于注入内容或 memory_recall 结果给出完整新内容)。每日预算 3000 字/天,超限自动压缩旧内容腾空间(不拒绝写入)。**调用后必须在本轮回复正文中向用户转述:更新了项目笔记、加入什么要点**。', {
      content: { type: 'string', required: true, description: '笔记内容。' },
      action: { type: 'string', enum: ['append', 'replace'], required: true, description: 'append=追加, replace=整体替换。' },
    }, async (args, exec) => {
      const p = await engine.resolvePaths(exec.agent)
      const content = String(args.content || '').trim()
      if (!content) return 'memory_note: content 为空,未写入。'
      const acct = await engine.ensureBudget(exec.agent, 'note', content)
      if (!acct.ok) return 'memory_note: 项目笔记今日预算已用尽(上限 ' + acct.acct.limit + ' 字/天)且自动压缩不可用(刚压缩过或 AI 不可用),本次未写入。可稍后再试或调用 memory_maintain 整理。'
      let body
      if (args.action === 'replace') {
        body = content
        await engine.writeFull(p.notesPath, body)
      } else {
        body = await engine.appendText(p.notesPath, '\n## ' + engine.memToday() + '\n' + content)
      }
      engine.state.notesText = body; engine.state.loadedAt = Date.now()
      return '已更新项目笔记: ' + p.notesPath + '\n追加内容:\n' + content + (acct.compacted ? '\n(已自动压缩旧内容腾出空间)' : '')
    }),

    defineTool('memory_user', '更新用户级记忆 ~/.dsh/memory/MEMORY.md(跨所有项目的长期规则/偏好,用户明确要求记住时用)。action=append 追加;action=replace 整体替换。每日预算 4000 字/天,超限自动压缩旧内容腾空间(不拒绝写入)。**调用后必须在本轮回复正文中向用户转述:已记住该规则/偏好**。', {
      content: { type: 'string', required: true, description: '要记住的规则或偏好内容。' },
      action: { type: 'string', enum: ['append', 'replace'], required: true, description: 'append=追加, replace=整体替换。' },
    }, async (args, exec) => {
      const p = await engine.resolvePaths(exec.agent)
      const content = String(args.content || '').trim()
      if (!content) return 'memory_user: content 为空,未写入。'
      const acct = await engine.ensureBudget(exec.agent, 'user', content)
      if (!acct.ok) return 'memory_user: 用户级记忆今日预算已用尽(上限 ' + acct.acct.limit + ' 字/天)且自动压缩不可用(刚压缩过或 AI 不可用),本次未写入。可稍后再试或调用 memory_maintain 整理。'
      let body
      if (args.action === 'replace') {
        body = content
        await engine.writeFull(p.userFile, body)
      } else {
        body = await engine.appendText(p.userFile, '\n## ' + engine.memToday() + '\n' + content)
      }
      engine.state.userText = body; engine.state.loadedAt = Date.now()
      return '已更新用户级记忆: ' + p.userFile + '\n追加内容:\n' + content + (acct.compacted ? '\n(已自动压缩旧内容腾出空间)' : '')
    }),

    defineTool('memory_recall', '检索记忆:本地记忆文件(当前工作区 + 其他所有工作区的每日日志、项目笔记、用户级记忆、反思)关键词匹配 + 历史 DSH 会话全文检索(如部署启用)。开发/排查中不懂的、用户提到过去的做法/讨论/决定而当前上下文没有时调用——跨工作区的记忆也能检索到(结果标注来源工作区)。查询必须自包含。**检索后必须在本轮回复正文中向用户转述:检索了什么、找到什么(或没找到)**。', {
      query: { type: 'string', required: true, description: '检索关键词或自包含描述。' },
      limit: { type: 'integer', description: '最多返回条数,缺省 8。' },
    }, async (args, exec) => engine.recall(args.query, args.limit, exec.agent)),

    defineTool('memory_maintain', '维护记忆(30 天蒸馏):把 days(缺省30)天前的 .dsh-memory/ 每日日志交给 AI 蒸馏提炼出有长期价值的要点写入项目 MEMORY.md,原文保底归档到 .dsh-memory/archive/ 后从活跃日志移除。AI 不可用时降级为原样归档,不丢信息。', {
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

    defineTool('memory_external', '查看/接入其他 AI 工具(AI 助手/CodeBuddy/Claude Code/Codex/项目约定文件)的记忆。action=list 列出全部检测到的外部记忆源(路径/大小/预览/会话数);action=import 把某源内容整体接入本地记忆(source 为源 id,target=project 接进项目笔记 / user 接进用户级记忆,自动标注来源)。首次在新工作区工作、或用户提到其他软件里做过的事时调用。', {
      action: { type: 'string', enum: ['list', 'import'], required: true, description: 'list=列出外部记忆源; import=接入指定源。' },
      source: { type: 'string', description: '要接入的源 id(action=import 时必填,来自 list 结果)。' },
      target: { type: 'string', enum: ['project', 'user'], description: '接入目标: project=项目笔记(默认), user=用户级记忆。' },
    }, async (args, exec) => {
      if (args.action === 'list') {
        const list = await engine.external.summarize()
        if (!list.length) return '未检测到其他 AI 工具的记忆文件(可检查 ~/.workbuddy、~/.codebuddy、~/.claude、~/.codex 是否存在)。'
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

    defineTool('calendar_add', '向用户级日历(~/.dsh/memory/CALENDAR.md)添加日程/事项。主动从对话中提取 deadline、约定时间、任务节点等信息写入日历(跨对话有效、重装不丢)。调用后必须在本轮回复正文中向用户转述:已把 X 记入日历。', {
      date: { type: 'string', description: '日期 YYYY-MM-DD,缺省今天。' },
      time: { type: 'string', description: '时间 HH:MM,无则 --:--。' },
      quadrant: { type: 'string', enum: ['重要紧急', '重要不紧急', '紧急不重要', '不重要不紧急'], description: '四象限分类,缺省重要不紧急。' },
      title: { type: 'string', required: true, description: '事项标题。' },
      note: { type: 'string', description: '备注/来源,如"来自对话:用户说周五交报告"。' },
    }, async (args, exec) => engine.calendarAdd({ date: args.date, time: args.time, quadrant: args.quadrant, title: args.title, note: args.note }, exec.agent)),

    defineTool('calendar_list', '列出日历条目(可按日期过滤、含完成状态)。用于查看已有安排、回答"我最近有什么安排"等问题。', {
      date: { type: 'string', description: '过滤日期 YYYY-MM-DD,缺省全部(近 60 天)。' },
    }, async (args, exec) => {
      const entries = engine.parseCalendar(engine.state.calendarText)
      const target = args.date
      const list = entries.filter((en) => !target || en.date === target)
      if (!list.length) return '日历为空' + (target ? ' (' + target + ')' : '') + '。'
      const lines = ['日历条目(' + list.length + ' 个):']
      for (const en of list.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)).slice(0, 40)) {
        lines.push('· ' + (en.done ? '[完成] ' : '[待办] ') + en.date + ' ' + en.time + ' | ' + en.quadrant + ' | ' + en.title + (en.note ? ' (' + en.note + ')' : ''))
      }
      return lines.join('\n')
    }),

    defineTool('calendar_done', '标记日历条目完成。参数需与 calendar_list 结果一致(date/time/title)。', {
      date: { type: 'string', required: true, description: '日期 YYYY-MM-DD。' },
      time: { type: 'string', required: true, description: '时间 HH:MM 或 --:--。' },
      title: { type: 'string', required: true, description: '事项标题。' },
    }, async (args, exec) => engine.calendarDone(args.date, args.time, args.title, exec.agent)),

    defineTool('calendar_remove', '删除日历条目。', {
      date: { type: 'string', required: true, description: '日期 YYYY-MM-DD。' },
      time: { type: 'string', required: true, description: '时间 HH:MM 或 --:--。' },
      title: { type: 'string', required: true, description: '事项标题。' },
    }, async (args, exec) => engine.calendarRemove(args.date, args.time, args.title, exec.agent)),

    defineTool('memory_consolidate', 'AI 主动维护长期记忆(做梦式固化):读最近 days 天的工作日志,由 AI 发散提炼出有跨会话长期价值的决策/架构/用户偏好,自动写入项目笔记 MEMORY.md(带日期标题)与用户级 MEMORY.md(跨项目规则),并在正文向用户转述固化结果。适合隔一段时间主动调用一次;每轮对话结束的自动沉淀也基于同一套提炼逻辑。', {
      days: { type: 'integer', description: '读取最近 N 天日志,缺省 7,上限 30。' },
    }, async (args, exec) => engine.consolidateMemory(exec.agent, Math.min(Math.max(Number(args.days) || 7, 1), 30))),
  ]

  // ---------- 路由 ----------
  const routes = [
    {
      kind: 'exact',
      path: API.state,
      handler: async (req, res) => {
        if (!isLoopbackRequest(req)) return writeJson(res, 403, { error: 'forbidden: loopback-only' })
        if ((req.method || 'GET') !== 'GET') return writeJson(res, 405, { error: 'method not allowed' })
        try {
          // 优先用前端传来的当前工作区(客户端从 ctx.sessions.list 拿),回退最近活跃 agent
          const url = new URL(req.url || '/', 'http://localhost')
          const ws = url.searchParams.get('ws') || ''
          await engine.refresh(ws ? { session: { header: { cwd: ws } } } : engine._lastAgent)
          writeJson(res, 200, await engine.snapshot())
        } catch (e) { writeJson(res, 500, { error: String(e && e.message ? e.message : e) }) }
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
      path: API.smartRecall,
      handler: async (req, res) => {
        if (!isLoopbackRequest(req)) return writeJson(res, 403, { error: 'forbidden: loopback-only' })
        if ((req.method || 'POST') !== 'POST') return writeJson(res, 405, { error: 'method not allowed' })
        const body = await readJsonBody(req)
        if (!body || typeof body.query !== 'string') return writeJson(res, 400, { error: 'invalid body' })
        try {
          await engine.refresh(undefined)
          writeJson(res, 200, await engine.smartRecall(body.query))
        } catch (e) { writeJson(res, 500, { error: String(e && e.message ? e.message : e) }) }
      },
    },
    {
      kind: 'exact',
      path: API.workspaces,
      handler: async (req, res) => {
        if (!isLoopbackRequest(req)) return writeJson(res, 403, { error: 'forbidden: loopback-only' })
        if ((req.method || 'POST') !== 'POST') return writeJson(res, 405, { error: 'method not allowed' })
        const body = await readJsonBody(req).catch(() => ({}))
        try {
          writeJson(res, 200, await engine.workspaceOverview(undefined, !!(body && body.force)))
        } catch (e) { writeJson(res, 500, { error: String(e && e.message ? e.message : e) }) }
      },
    },
    {
      kind: 'exact',
      path: API.debug,
      handler: async (req, res) => {
        if (!isLoopbackRequest(req)) return writeJson(res, 403, { error: 'forbidden: loopback-only' })
        if ((req.method || 'GET') !== 'GET') return writeJson(res, 405, { error: 'method not allowed' })
        try { writeJson(res, 200, await engine.debugInfo()) } catch (e) { writeJson(res, 500, { error: String(e && e.message ? e.message : e) }) }
      },
    },
    {
      kind: 'exact',
      path: API.browseDir,
      handler: async (req, res) => {
        if (!isLoopbackRequest(req)) return writeJson(res, 403, { error: 'forbidden: loopback-only' })
        if ((req.method || 'POST') !== 'POST') return writeJson(res, 405, { error: 'method not allowed' })
        const body = await readJsonBody(req).catch(() => ({}))
        try {
          let p = String((body && body.path) || homedir() || process.cwd())
          if (p === '~') p = homedir()
          if (p.startsWith('~/') || p.startsWith('~\\')) p = path.join(homedir(), p.slice(2))
          const st = await stat(p)
          if (!st.isDirectory()) p = path.dirname(p)
          const entries = await readdir(p, { withFileTypes: true })
          const dirs = entries
            .filter((en) => en.isDirectory() && !en.name.startsWith('.'))
            .map((en) => ({ name: en.name, path: path.join(p, en.name) }))
            .sort((a, b) => (a.name < b.name ? -1 : 1))
            .slice(0, 300)
          writeJson(res, 200, { path: p, parent: path.dirname(p), dirs })
        } catch (e) { writeJson(res, 500, { error: String(e && e.message ? e.message : e) }) }
      },
    },
    {
      kind: 'exact',
      path: API.pickDir,
      handler: async (req, res) => {
        if (!isLoopbackRequest(req)) return writeJson(res, 403, { error: 'forbidden: loopback-only' })
        if ((req.method || 'POST') !== 'POST') return writeJson(res, 405, { error: 'method not allowed' })
        // 调用系统的文件夹选择器(native 后端,由 dsh 的 directory-picker-auto 按主机情况挂载);不可用则返回 native:false,前端回退内嵌浏览
        try {
          let picker = undefined
          try { picker = ctx.directoryPicker } catch (e) {}
          if (!picker || typeof picker.capability !== 'function') return writeJson(res, 200, { native: false })
          const cap = picker.capability()
          if (!cap || cap.kind !== 'native' || typeof cap.pick !== 'function') return writeJson(res, 200, { native: false })
          const ac = new AbortController()
          const timer = setTimeout(() => { try { ac.abort() } catch (e) {} }, 5 * 60 * 1000)
          try {
            const dir = await cap.pick(ac.signal)
            writeJson(res, 200, { native: true, dir: dir || null })
          } finally { clearTimeout(timer) }
        } catch (e) { writeJson(res, 200, { native: true, dir: null, error: String(e && e.message ? e.message : e) }) }
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
            const saved = await engine.saveConfig(patch)
            writeJson(res, 200, { config: saved.config, migrated: saved.migrated || '' })
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
          const text = '\n## ' + engine.memToday() + '\n' + body.content.trim()
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
    {
      kind: 'exact',
      path: API.calendar,
      handler: async (req, res) => {
        if (!isLoopbackRequest(req)) return writeJson(res, 403, { error: 'forbidden: loopback-only' })
        const method = req.method || 'GET'
        if (method === 'GET') {
          const entries = engine.parseCalendar(engine.state.calendarText)
          writeJson(res, 200, { entries, path: engine.state.calendarPath || '' })
          return
        }
        if (method === 'POST') {
          const body = await readJsonBody(req)
          if (!body) return writeJson(res, 400, { error: 'invalid body' })
          try {
            if (body.action === 'done') writeJson(res, 200, { result: await engine.calendarDone(body.date, body.time, body.title) })
            else if (body.action === 'remove') writeJson(res, 200, { result: await engine.calendarRemove(body.date, body.time, body.title) })
            else writeJson(res, 200, { result: await engine.calendarAdd(body) })
          } catch (e) { writeJson(res, 500, { error: String(e && e.message ? e.message : e) }) }
          return
        }
        writeJson(res, 405, { error: 'method not allowed' })
      },
    },
    {
      kind: 'exact',
      path: API.summarize,
      handler: async (req, res) => {
        if (!isLoopbackRequest(req)) return writeJson(res, 403, { error: 'forbidden: loopback-only' })
        if ((req.method || 'POST') !== 'POST') return writeJson(res, 405, { error: 'method not allowed' })
        const body = await readJsonBody(req)
        if (!body || typeof body.period !== 'string') return writeJson(res, 400, { error: 'invalid body' })
        try {
          const ws = body.ws || ''
          await engine.refresh(ws ? { session: { header: { cwd: ws } } } : undefined)
          const out = await engine.summarizePeriod(body.period, undefined, !!body.force)
          writeJson(res, 200, { ...out, result: out.summary })
        } catch (e) { writeJson(res, 500, { error: String(e && e.message ? e.message : e) }) }
      },
    },
    {
      kind: 'exact',
      path: API.greet,
      handler: async (req, res) => {
        if (!isLoopbackRequest(req)) return writeJson(res, 403, { error: 'forbidden: loopback-only' })
        if ((req.method || 'POST') !== 'POST') return writeJson(res, 405, { error: 'method not allowed' })
        try {
          const ws = body && body.ws ? body.ws : ''
          await engine.refresh(ws ? { session: { header: { cwd: ws } } } : undefined)
          writeJson(res, 200, await engine.greetToday())
        } catch (e) { writeJson(res, 500, { error: String(e && e.message ? e.message : e) }) }
      },
    },
  ]

  // ---------- 后台轮询兜底(对标外部助手的心跳轮询):每 5 分钟重试失败的自动沉淀 + 心跳文件 ----------
  // 心跳:每次轮询把存活状态写入 ~/.dsh/memory/polling-heartbeat.json(可随时查看 LastWriteTime 确认轮询活着)
  const writeHeartbeat = async () => {
    try {
      const q = engine._pendingConsolidations || []
      const hb = path.join(dshHome(), 'memory', 'polling-heartbeat.json')
      await mkdir(path.dirname(hb), { recursive: true })
      await writeFile(hb, JSON.stringify({
        pid: process.pid,
        heartbeatAt: Date.now(),
        uptimeMs: Math.round(process.uptime() * 1000),
        queueLength: q.length,
        lastConsolidatedAt: (engine.autoStats && engine.autoStats.lastAt) || 0,
        todayCount: (engine.autoStats && engine.autoStats.count) || 0,
      }, null, 2), 'utf8')
    } catch (e) {}
  }
  const retryTimer = setInterval(() => {
    void (async () => {
      try {
        const q = engine._pendingConsolidations
        if (q && q.length && !engine._consolidating) {
          const item = q.shift()
          if (item && item.agent) void engine.consolidateTurn(item.turn, item.agent)
        }
      } catch (e) {}
    })()
  }, 5 * 60 * 1000)
  // 心跳独立 15 秒一次(对齐 polling-lease 心跳节奏),证明轮询机制活着
  const heartbeatTimer = setInterval(() => { void writeHeartbeat() }, 15000)
  void writeHeartbeat() // 立即心跳一次:重启后马上可见轮询存活

  // ---------- 注册与清理 ----------
  const disposers = []
  disposers.push(disposeSection)
  for (const tool of tools) disposers.push(ctx.tools.register(tool))
  for (const route of routes) disposers.push(ctx.webServer.register(route))
  ctx.effect(() => () => {
    clearInterval(retryTimer)
    clearInterval(heartbeatTimer)
    for (const dispose of disposers) { try { dispose() } catch (e) {} }
  }, 'dsh-auto-memory: surfaces')

  console.log('[dsh-auto-memory] ready: engine + ' + tools.length + ' tools + injection + ' + routes.length + ' routes (external memory: ' + Object.keys(DEFAULT_CONFIG.externalSources).length + ' sources)')
}
