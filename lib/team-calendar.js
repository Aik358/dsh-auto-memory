/**
 * team-calendar.js —— 日历的**双轨标记**（本机轨 / 团队轨）。
 *
 * ## 背景
 * 日历 `CALENDAR.md` 是**用户级**文件（跨工作区共享，进同步包）。开启团队后，
 * 同一条日历里会同时存在两类条目：
 *   - **本机轨**：只属于这台机器的私人安排
 *   - **团队轨**：来自团队、需要与他人共享/对齐的安排
 * 两者混在一起时，界面无法区分「这条要不要发给团队」。本模块只解决这一件事：
 * **在条目的 note 末尾附一个零宽度的 HTML 注释标记**，用于区分轨道。
 *
 * ## 设计约束（用户裁定 + 冻结书）
 *  1. **teamEnabled=false ⇒ 逐字节不变**：本模块是**纯函数库**，不碰磁盘、不读配置；
 *     是否调用由 index.js 的 teamEnabled 门控决定 ⇒ 关闭时根本不会被调用，字节不变。
 *  2. **对用户与对模型都不可见**：标记是 HTML 注释 `<!-- dam-track:team -->`，
 *     Markdown 渲染时不可见；且 `stripTrackPre()` 可在注入快照前剥离。
 *  3. **幂等**：同一条重复打标不叠加（先剥后加）。
 *  4. **不改变既有行格式**：标记只进 `note` 字段，**不新增分隔符** ⇒ 既有正则
 *     `(.+?)(?: \| (.*))?$` 仍能完整捕获它。
 *  5. **绝不抛**：任何异常输入都降级为「无标记 / 原样返回」。
 */

export const TRACK_LOCAL = 'local'
export const TRACK_TEAM = 'team'

/** 标记的字面量。用注释形式，Markdown 渲染不可见。 */
const MARK_RE = /<!--\s*dam-track:(local|team)\s*-->/gi

/**
 * 从一段文本里读出轨道，并把标记**剥离**。
 * 返回 `{ track, text }`：`track` 缺省 `local`；`text` 是剥离标记后的文本。
 * 绝不抛。
 */
export function readTrackPre(raw) {
  const s = typeof raw === 'string' ? raw : ''
  let track = TRACK_LOCAL
  try {
    MARK_RE.lastIndex = 0
    let m
    while ((m = MARK_RE.exec(s)) !== null) {
      // 后写的为准（正常不会出现多个；防御性取最后一个）
      track = m[1].toLowerCase() === TRACK_TEAM ? TRACK_TEAM : TRACK_LOCAL
    }
  } catch (_) { /* 保守降级为 local */ }
  // ★只在**真的剥掉标记**时才 trim：无标记时必须逐字节原样返回（local 轨硬判据）。
  const had = track === TRACK_TEAM || MARK_RE.test(s)
  MARK_RE.lastIndex = 0
  return { track: track, text: had ? s.replace(MARK_RE, '').trim() : s }
}

/**
 * 把一段文本打上轨道标记（**先剥后加**，故幂等）。
 * `track===local` 时**不加标记**（保持与基线逐字节一致）。
 * 绝不抛。
 */
export function writeTrackPre(raw, track) {
  const s = typeof raw === 'string' ? raw : ''
  const want = track === TRACK_TEAM ? TRACK_TEAM : TRACK_LOCAL
  let base = s
  try {
    MARK_RE.lastIndex = 0
    // ★local 且**本来就没有标记** ⇒ 逐字节原样返回（不做任何 trim）
    if (want === TRACK_LOCAL && !MARK_RE.test(s)) return s
    base = s.replace(MARK_RE, '').trim()
  } catch (_) { base = s }
  if (want === TRACK_LOCAL) return base
  if (!base) return '<!-- dam-track:' + want + ' -->'
  return base + ' <!-- dam-track:' + want + ' -->'
}

export function createTeamCalendar() {
  /** 读条目轨道（传整个条目对象或裸 note 字符串都可）。 */
  function trackOf(entry) {
    try {
      if (entry && typeof entry === 'object') return readTrackPre(entry.note).track
      return readTrackPre(entry).track
    } catch (_) { return TRACK_LOCAL }
  }

  /**
   * 给条目打轨道。**返回新对象**（不改入参）。
   * `local` 轨 ⇒ note 与入参逐字节相同。
   */
  function withTrack(entry, track) {
    try {
      const src = entry && typeof entry === 'object' ? entry : {}
      const clean = readTrackPre(src.note)
      return Object.assign({}, src, { note: writeTrackPre(clean.text, track), track: track === TRACK_TEAM ? TRACK_TEAM : TRACK_LOCAL })
    } catch (_) { return entry }
  }

  /** 剥离条目的标记，并把轨道放到 `track` 字段（note 恢复干净）。 */
  function stripTrack(entry) {
    try {
      const src = entry && typeof entry === 'object' ? entry : {}
      const clean = readTrackPre(src.note)
      return Object.assign({}, src, { note: clean.text, track: clean.track })
    } catch (_) { return entry }
  }

  /** 只看团队轨的条目。 */
  function teamOnly(entries) {
    try { return (Array.isArray(entries) ? entries : []).filter(function (e) { return trackOf(e) === TRACK_TEAM }) }
    catch (_) { return [] }
  }

  /** 轨道统计（供状态面板）。 */
  function counts(entries) {
    const list = Array.isArray(entries) ? entries : []
    let team = 0
    for (const e of list) { if (trackOf(e) === TRACK_TEAM) team += 1 }
    return { total: list.length, team: team, local: list.length - team }
  }

  function describe() {
    return { trackLocal: TRACK_LOCAL, trackTeam: TRACK_TEAM, marker: '<!-- dam-track:team -->' }
  }

  return {
    trackOf: trackOf, withTrack: withTrack, stripTrack: stripTrack,
    teamOnly: teamOnly, counts: counts, describe: describe,
  }
}
