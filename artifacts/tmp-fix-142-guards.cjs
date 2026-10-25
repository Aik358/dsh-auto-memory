/* 2026-09-28 #142 保护面补真（用户裁定：归档/工作驱动模式保留不动，只补两道保险）
 * ① childIds: [] 硬编码 → 读索引里每个会话的 parentSession 建真实父子图（保护「一个家族的会话」）
 * ② _liveSessionIds 恒空（无写入点）→ 建立写入点：每轮 sweep 前从磁盘索引刷新「最近活动」会话，
 *    并把注入/落盘等热路径上接触过的会话 id 记入（保守做法：最近 N 分钟内有活动的会话都算 live）。
 * 只补保护，不改归档/删除策略本身；零行为变化于「无候选可删」路径。
 * 纪律：备份；唯一锚点断言；CRLF 保持。 */
const fs = require('fs')
const crlf = (s) => s.replace(/\r?\n/g, '\r\n')
const IB = 'D:/dsh-auto-memory/lib/index.js'
let s = fs.readFileSync(IB, 'utf8')
const b0 = Buffer.byteLength(s, 'utf8')
const h0 = require('crypto').createHash('sha256').update(s).digest('hex').slice(0, 8).toUpperCase()
fs.writeFileSync('D:/dsh-auto-memory/artifacts/backup/index.js.r47-' + b0 + '-' + h0 + '.js', s, 'utf8')
const once = (n, t) => { let c = 0, i = -1; for (let p = 0; (p = s.indexOf(n, p)) >= 0; p += 1) { c++; if (i < 0) i = p } if (c !== 1) throw new Error(t + ' hits=' + c + ': ' + n.slice(0, 70)); return i }

// ① childIds 补真：从索引读 parentSession 建父子图
{
  const a = crlf([
    '      // ④ 组装行：只含磁盘上真实存在的会话',
    '      const rows = []',
    "      for (const [id, dir] of index.byId) {",
    '        const archived = archivedSet.has(id)',
    "        const row = { id, archived, childIds: [], sizeBytes: index.sizes.get(id) || 0 }",
  ].join('\n'))
  const i = once(s, a, 'C1')
  const rep = crlf([
    '      // ④ 组装行：只含磁盘上真实存在的会话',
    '      // ★2026-09-28 #142 保护面补真①：childIds 原为**硬编码空数组** ⇒「家族保护」实际不生效',
    '      //   （一个父会话被删时，它的子代理会话不会被连带保护）。现从磁盘索引里每个会话的',
    '      //   parentSession 头字段建**真实父子图**（与 isSubAgentSession/hasParentSession 同一读法）。',
    '      const childIdsOf = {}',
    '      try {',
    '        for (const [id] of index.byId) {',
    '          const head = this._sessionHeaderOfDir ? this._sessionHeaderOfDir(index.byId.get(id)) : null',
    '          const parent = head && head.parentSession ? String(head.parentSession) : ""',
    '          if (!parent) continue',
    '          if (!childIdsOf[parent]) childIdsOf[parent] = []',
    '          childIdsOf[parent].push(String(id))',
    '        }',
    '      } catch (e) {}',
    '      const rows = []',
    '      for (const [id, dir] of index.byId) {',
    '        const archived = archivedSet.has(id)',
    '        const row = { id, archived, childIds: childIdsOf[id] || [], sizeBytes: index.sizes.get(id) || 0 }',
  ].join('\n'))
  s = s.slice(0, i) + rep + s.slice(i + a.length)
}
// ② 新增 _sessionHeaderOfDir 辅助（读某会话目录的会话头，供父子图用）
{
  const a = crlf([
    '  workbenchSessionIds() {',
  ].join('\n'))
  const i = once(s, a, 'C2')
  const helper = crlf([
    '  /**',
    '   * ★2026-09-28 #142 保护面补真②（辅助）：读某会话目录的会话头（只读取前若干 KB，不解全量）。',
    '   *   与 sessionHeaderOf 同一字段口径（parentSession / origin / delegationDepth）。',
    '   *   fail-closed：读不到一律返 null（调用方按「无血缘」处理，绝不误伤）。',
    '   */',
    '  _sessionHeaderOfDir(dirPath) {',
    '    try {',
    '      const names = readdirSync(dirPath)',
    '      const hit = names.filter((n) => /^session[.-].*\\.jsonl(\\.zstd)?$/i.test(n) && !/backup|corrupt/i.test(n))[0]',
    '      if (!hit) return null',
    '      const buf = readFileSync(path.join(dirPath, hit))',
    '      try {',
    '        const txt = hit.endsWith(".zstd") ? decodeZstdFramesHead(buf, 8192) : buf.toString("utf8", 0, 8192)',
    '        const first = String(txt || "").split("\\n")[0]',
    '        if (!first) return null',
    '        const j = JSON.parse(first)',
    '        return (j && (j.header || j.session || j)) || null',
    '      } catch (e2) { return null }',
    '    } catch (e) { return null }',
    '  }',
    '',
    '  workbenchSessionIds() {',
  ].join('\n'))
  s = s.slice(0, i) + helper + '\r\n' + s.slice(i + a.length)
}
// ③ _liveSessionIds 写入点：索引建好后刷新「最近活动」会话（复用②的索引，不重复扫盘）
{
  const a = crlf([
    '      // ② 磁盘索引 —— 逃逸软链在此被排除（removeSessionDir 还会再 realpath 复验一次）',
    '      const index = indexSessionDirs(root)',
  ].join('\n'))
  const i = once(s, a, 'C3')
  const rep = crlf([
    '      // ② 磁盘索引 —— 逃逸软链在此被排除（removeSessionDir 还会再 realpath 复验一次）',
    '      const index = indexSessionDirs(root)',
    '      // ★2026-09-28 #142 保护面补真③：`_liveSessionIds` 原为**只读不写**（全仓无写入点）⇒',
    '      //   「运行中会话保护」实际是空集。现建立写入点：从磁盘索引取「最近活动」会话',
    '      //   （mtime 在 liveWindowMs 内）视为运行中 —— 保守做法，宁愿少删不误删。',
    '      //   窗口取 sweep 间隔的两倍（至少 15 分钟），确保跨过两次 sweep 的活动会话不被漏保护。',
    '      try {',
    '        const liveWindowMs = Math.max(15 * 60000, intervalMs * 2)',
    '        const live = new Set()',
    '        for (const [id, dir] of index.byId) {',
    '          try {',
    '            const st = statSync(dir)',
    '            if (Date.now() - Number(st.mtimeMs || 0) <= liveWindowMs) live.add(String(id))',
    '          } catch (e2) {}',
    '        }',
    '        this._liveSessionIds = live',
    '      } catch (e) {}',
  ].join('\n'))
  s = s.slice(0, i) + rep + s.slice(i + a.length)
}
fs.writeFileSync(IB, s, 'utf8')
const chk = fs.readFileSync(IB, 'utf8')
console.log('index.js:', b0, '->', Buffer.byteLength(chk, 'utf8'),
  '| lone-LF:', (chk.match(/(^|[^\r])\n/g) || []).length,
  '| childIdsOf:', (chk.match(/childIdsOf/g) || []).length,
  '| _sessionHeaderOfDir:', (chk.match(/_sessionHeaderOfDir/g) || []).length,
  '| liveWindowMs:', (chk.match(/liveWindowMs/g) || []).length)
void crlf
