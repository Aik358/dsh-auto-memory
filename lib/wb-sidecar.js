/**
 * wb-sidecar-pre —— WB-GRAPH P2 结构化 sidecar(2026-09-16, wb_sidecar_v1)。
 *
 * 权威依据: WB-GRAPH-INTEGRATION-PLAN.md §5 P2-1/P2-2 + WB-FORMAT-CONVENTION §3(索引派生)/§4(写入门)
 *   + 拍板 A2: sidecar 放 memoryRoot/<ws>/handoff/ 旁挂。
 *   + §3.3 index.json 结构契约(本次修复补齐 by_tag/by_cue/versions/ws 与条目级字段)。
 *
 * 设计:
 *  - index.json **完全可重建**: 从 PLAN.md + 账本白名单文件确定性派生(dsh-graph「events 是真源、
 *    文件是投影」的反向取舍——我们的 Markdown 文件是真源, sidecar 只是派生索引, 丢了自愈重建)。
 *  - 条目 id = WB-FORMAT-CONVENTION §2 锚点契约: mem_ + sha256(workspaceKey+'\0'+relPath+'\0'+title) 前 32 hex。
 *    **relPath 一律正斜杠、title 一律经 normalizeTitlePre** —— write 与 rebuild 两条路径必须算出同一 id
 *    (2026-09-16 修复 BUG-10: 此前 write 传 path.relative(反斜杠) + title 含 handoff- 前缀,
 *     rebuild 传正斜杠 + 去前缀, 同一条目两个 id, 破坏「完全可重建」)。
 *  - tag 提取 = 确定性词法: 行内 `tag:xxx` / `type:xxx` / `topic:xxx` 模式, 零 LLM。
 *  - 仅 boardMode='graph' 时被调用; legacy 模式下零文件写入。
 */

import { createHash } from 'node:crypto'

export const WB_SIDECAR_VERSION = 'wb_sidecar_v1'

/** 章节标题 → tag(截断 24 字, 去掉 markdown 井号前缀)。 */
function sectionTagPre(sectionTitle) {
  const t = String(sectionTitle || '').replace(/^#+\s*/, '').trim()
  return t ? 'sec:' + t.slice(0, 24) : ''
}

/**
 * 从一段文本提取确定性 tag(零 LLM)。约定: 行内 `tag:` `type:` `topic:` 前缀 + 章节标题降 tag。
 * 前置边界放宽为「行首 / 空白 / 常见中英标点」——2026-09-16 修复 BUG-13:
 *   旧边界 `(^|\s)` 会漏掉「（topic:登录流程）」「格式：type:dead-end」等中文标点紧邻写法。
 *   仍刻意不匹配 `a:type:xxx`(要求 tag 前是边界而非任意字符), 避免误吞 `xxxtype:` 类假阳性。
 */
export function extractTagsPre(text, sectionTitle) {
  const tags = new Set()
  const src = String(text || '')
  // 边界规则(2026-09-16 两轮修正): tag 前缀**左边紧邻**的字符若仍是字母/数字/下划线/汉字,
  // 说明它是某个更长单词的一部分(如 `xxxtype:foo` / `中文type:foo`)⇒ 拒绝;
  // 行首、空白、中英标点(含中文括号/顿号/冒号)一律接受 —— 这样才能采到
  // 「（topic:登录流程）」「格式：type:dead-end」这类中文写作里的常见写法(修 BUG-13)。
  for (const m of src.matchAll(/(?:tag|type|topic):[\w\u4e00-\u9fff-]{2,24}/g)) {
    const at = m.index
    const prev = at > 0 ? src[at - 1] : ''
    if (prev && /[\w\u4e00-\u9fff]/.test(prev)) continue
    tags.add(m[0])
  }
  const sec = sectionTagPre(sectionTitle)
  if (sec) tags.add(sec)
  return [...tags]
}

/**
 * relPath 规范化: 一律正斜杠。write 侧传 path.relative(...) 在 Windows 得反斜杠,
 * rebuild 侧拼 'handoff/'+f 得正斜杠 ⇒ 不统一就会同一条目两个 id。
 */
export function normalizeRelPathPre(relPath) {
  return String(relPath || '').replace(/\\/g, '/')
}

/**
 * title 规范化(与 write 侧同一个口径):
 *   - 白板: '白板 PLAN'
 *   - 账本: '交接账本 handoff-20260916-020000'(**保留 handoff- 前缀**——write 侧用 basename 就带前缀)
 * 传入可以是文件名(含 .md)或裸标题, 统一收敛。
 */
export function normalizeTitlePre(nameOrTitle) {
  const raw = String(nameOrTitle || '').trim()
  if (!raw) return ''
  const base = raw.replace(/\.md$/i, '')
  if (base === 'PLAN' || base === '白板 PLAN') return '白板 PLAN'
  if (base.startsWith('交接账本 ')) return base
  if (base.startsWith('handoff-')) return '交接账本 ' + base
  return base
}

/** WB-FORMAT-CONVENTION §2 锚点 id(与写入门同源契约)。relPath 强制正斜杠, title 强制规范化。 */
export function wbEntryIdPre(workspaceKey, relPath, title) {
  const h = createHash('sha256')
    .update(String(workspaceKey || '') + '\0' + normalizeRelPathPre(relPath) + '\0' + normalizeTitlePre(title))
    .digest('hex')
  return 'mem_' + h.slice(0, 32)
}

/**
 * 条目引用规范化(**write 与 rebuild 的唯一构造口径**, 修 BUG-10)。
 *
 * 传参宽容——写侧可能给绝对/相对路径 + 带 `handoff-` 的文件名, 读侧给 `handoff/xxx.md`:
 *   - relPath 一律转正斜杠;
 *   - 若给的是绝对路径, 取 `handoff/` 之后的部分(保持与 projectDir 无关的稳定口径);
 *   - title 走 normalizeTitlePre(账本**保留** `handoff-` 前缀, 与写侧 basename 同形)。
 *
 * @param {string} relPathOrName 形如 'handoff/PLAN.md' / 'handoff/handoff-2026...md' / 'handoff-2026...md'
 * @param {string} [titleHint] 期望标题(可省; 省时由 relPathOrName 推导)
 * @returns {{relPath:string, title:string}}
 */
export function wbRefPre(relPathOrName, titleHint) {
  let rel = normalizeRelPathPre(relPathOrName)
  const m = rel.match(/(?:^|\/)handoff\/(.+)$/)
  if (m) rel = 'handoff/' + m[1]
  else if (!rel.includes('/') && rel) rel = 'handoff/' + rel
  const base = rel.split('/').pop() || ''
  const derived = base.replace(/\.md$/i, '')
  // titleHint 优先(写侧可能显式给 '白板 PLAN'); 否则由文件名推导
  const title = titleHint ? normalizeTitlePre(titleHint) : normalizeTitlePre(derived)
  return { relPath: rel, title }
}

/** 从文本抽取 cue(入口线索: 路径 / 反引号代码 / 长的数字串)。供 §4.1 的 cues 字段与 tag 展开的入口匹配。 */
export function extractCuesPre(text) {
  const out = new Set()
  const src = String(text || '')
  for (const m of src.matchAll(/[A-Za-z]:\\[^\s"'`)]+|(?:[\w.@-]+\/)+[\w.@-]+\.\w+|`[^`\n]{2,60}`/g)) {
    let s = m[0].trim()
    if (s.startsWith('`') && s.endsWith('`')) s = s.slice(1, -1).trim()
    if (s.length >= 3) out.add(s.slice(0, 120))
    if (out.size >= 24) break
  }
  return [...out]
}

/** 从文本切出所在小节标题(最近的 `## ` / `### ` 行)。 */
function sectionOfPre(text, fallback) {
  const lines = String(text || '').split('\n')
  let cur = String(fallback || '')
  for (const l of lines) {
    const m = l.match(/^(#{2,4})\s+(.+)$/)
    if (m) cur = m[2].trim().slice(0, 60)
  }
  return cur
}

// ─────────────────────────────────────────────────────────────────────────────
// 小节切分(2026-09-16 看板 v2「大刀阔斧」批) —— 看板卡片粒度的**唯一权威口径**。
//
// 为什么必须按小节切: 白板格式约定 (§2 锚点契约) 本来就规定「每个卡片/小节一张卡、
//   标题行下方紧跟锚点」。而 v1 的 sidecar 是**文件级**条目 ⇒ 一篇账本压成一根卡片,
//   真实数据实测 92 文件 → 92 条, 而按小节切是 415 条(×4.5), 按条目行切 797 条(×8.7)。
//   ⇒ 看板"看起来没内容"的根因不是 cap 太小, 是**切分粒度错了一个层级**。
//
// 与 v1 的关系: **新增, 不改旧语义**。文件级条目(entries)与 by_tag/by_cue/versions 一律不动
//   (既有套件断言 rebuildSidecarIndexPre('ws', 2 docs).entries.length === 2, 改动即回归),
//   本函数只在其上**派生**第二层投影, 供看板与检索使用。
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 把一篇白板/账本正文切成小节(纯函数, 零 IO)。
 *
 * 切分规则:
 *   - 以 `## ` 二级标题为主切点(白板/账本正文结构与 §2 契约一致);
 *   - `# ` 一级标题作为**文档标题**(不单独成节, 记入 docTitle);
 *   - `### ` 及更深**不切**(归入最近的 `## ` 节), 避免卡片过碎;
 *   - 正文里**没有 `## ` 时**落一个 `__preamble__` 节(整篇一节, 不丢内容);
 *   - 紧随标题行的锚点行 `<!-- memory:mem_xxx -->` 被识别为该节的 **anchorId**。
 *
 * @returns {{docTitle:string, sections:Array<{title:string, body:string, anchorId:string, lineStart:number, bullets:number, chars:number}>}}
 */
export function splitSectionsPre(text) {
  const src = String(text || '')
  const lines = src.split('\n')
  let docTitle = ''
  const sections = []
  let cur = null

  const push = () => {
    if (!cur) return
    const body = cur.bodyLines.join('\n').trim()
    cur.bullets = (body.match(/^\s*[-*]\s+\S/gm) || []).length
    cur.chars = body.length
    cur.body = body
    delete cur.bodyLines
    sections.push(cur)
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const h1 = line.match(/^#\s+(.+)$/)
    if (h1 && !docTitle) { docTitle = h1[1].trim().slice(0, 120) }
    const h2 = line.match(/^##\s+(.+)$/)
    if (h2) {
      push()
      cur = {
        title: h2[1].trim().slice(0, 120),
        bodyLines: [],
        anchorId: '',
        lineStart: i + 1,
        bullets: 0,
        chars: 0,
      }
      continue
    }
    if (!cur) {
      // 首个 ## 之前的引言部分: 只在有实质内容时保留
      cur = { title: '', bodyLines: [], anchorId: '', lineStart: 1, bullets: 0, chars: 0, preamble: true }
    }
    // 引言区里的 `# 文档标题` 行不是内容 —— 若不剔除, 它会变成一张只有标题的垃圾卡
    if (cur.preamble && /^#\s+/.test(line)) continue
    // 标题行紧随的锚点行进 anchorId(§2 契约形态)
    const am = line.trim().match(WB_ANCHOR_LINE_RE_V1)
    if (am && !cur.bodyLines.some((x) => x.trim())) { cur.anchorId = am[1]; continue }
    cur.bodyLines.push(line)
  }
  push()

  const real = sections.filter((s) => !s.preamble || s.body.length > 0)
  if (!real.length) {
    // 完全没有 ## 的文档: 整体一节, 标题回落文档标题
    const body = src.trim()
    return {
      docTitle,
      sections: body ? [{
        title: docTitle || '(全文)', body, anchorId: '', lineStart: 1,
        bullets: (body.match(/^\s*[-*]\s+\S/gm) || []).length, chars: body.length,
      }] : [],
    }
  }
  return { docTitle, sections: real }
}

/**
 * 把一批文档投影成**小节级卡片**(看板数据源, 纯函数零 IO, 确定性)。
 *
 * id 口径(**P3 修复, 2026-09-16 实测修正**):
 *   卡片主键**一律用可复算规范式** `wbEntryIdPre(ws, relPath, 小节标题)` —— 只由
 *   (工作区, 文件, 标题) 决定 ⇒ **唯一、与输入顺序无关**, 与 §2 锚点契约算法同式。
 *
 *   ⚠ 为什么不直接用正文锚点 id 当主键: 实测真实数据(92 文件/417 卡)发现 **7 组不同文件
 *   共用同一锚点 id**(如 handoff-20260908-183928.md 与 -184901.md 的「## 目标」同为
 *   mem_af41b679…) —— 历史锚点由早期写入/整篇复制遗留, **野外不保证唯一**。拿它当主键会导致
 *   多卡同 id ⇒ 排序破平失效(**实测同集合乱序投影结果不一致**)、前端 key 冲突。
 *   ⇒ 锚点降级为 `anchorId` 参照字段(展示/回溯用), 不作主键。
 *   同文件内同名小节(极少)按出现序号加后缀, 保证主键唯一。
 *
 * @param {string} workspaceKey
 * @param {Array<{relPath:string, text:string, kind?:string, mtime?:number, criteria?:string, ts?:string, title?:string}>} docs
 * @param {object} [opts] { maxSectionsPerDoc }
 */
export function buildSectionCardsPre(workspaceKey, docs, opts = {}) {
  const perDocCap = Number(opts.maxSectionsPerDoc) > 0 ? Number(opts.maxSectionsPerDoc) : 0
  const cards = []
  for (const d of Array.isArray(docs) ? docs : []) {
    try {
      const rel = normalizeRelPathPre(d.relPath)
      const kind = String(d.kind || (rel.includes('PLAN') ? 'plan' : rel.includes('archive/') ? 'archive' : 'ledger'))
      const mtime = Number(d.mtime) || 0
      const criteria = String(d.criteria || 'unknown')
      const { docTitle, sections } = splitSectionsPre(d.text)
      const use = perDocCap > 0 ? sections.slice(0, perDocCap) : sections
      const seen = {}
      for (const s of use) {
        if (!s.body && !s.title) continue
        const secTitle = s.title || docTitle || rel
        // 主键 = 可复算规范式(唯一 + 输入顺序无关); 同文件同名小节加序号后缀
        let id = wbEntryIdPre(workspaceKey, rel, secTitle)
        if (seen[id]) { seen[id] += 1; id = id + '#' + seen[id] } else { seen[id] = 1 }
        const secText = s.body || ''
        cards.push({
          id,
          anchorId: s.anchorId || '',   // 正文锚点(参照; 野外可能不唯一, 不作主键)
          // 小节标题即卡片标题; 文档标题作为来源上下文
          title: secTitle.slice(0, 120),
          docTitle: String(docTitle || '').slice(0, 120),
          source: rel,
          kind,
          section: secTitle.slice(0, 60),
          mtime,
          criteria,
          ts: String(d.ts || ''),
          bullets: Number(s.bullets) || 0,
          chars: Number(s.chars) || 0,
          lineStart: Number(s.lineStart) || 0,
          anchored: !!s.anchorId,
          // tags/cues/preview 一律从**本节正文**抽取(不是整篇) —— 这是小节级切分的意义所在
          tags: extractTagsPre(secText, secTitle),
          cues: extractCuesPre(secText),
          preview: secText.replace(/\s+/g, ' ').trim().slice(0, 400),
          body: secText,
        })
      }
    } catch (_) { /* 单文件损坏不拖垮整体 */ }
  }
  return cards
}

/**
 * 从账本/白板全文构建条目(纯函数, 零 IO)。
 * 契约对齐 WB-GRAPH-INTEGRATION-PLAN §4.1(条目级): id/kind/source/section/tags/cues/preview/mtime/criteria。
 * 兼容旧字段: title/cue/chars/ts 保留(既有套件与工具描述在用)。
 *
 * ★M1（2026-09-18）新增 `layer`/`status`：契约 §3 的索引派生行要求两者
 *   （`… · layer=whiteboard · status=current · 日期`）。此前 entry 只有 `id`（已是
 *   `mem_<32hex>` 形态），缺这两个字段 ⇒ 渲染侧拿不到值，一直退化成纯文本行。
 *   - `layer` 恒为 `'whiteboard'`：本模块**只服务于白板/账本**这一层，
 *     不是从调用方传入的自由值（避免调用方各传各的、导致层级语义漂移）。
 *   - `status` 取 `o.status`，缺省 `'current'`（与契约 §3 尾注
 *     「缺 status 视为 current」、与 `isCurrentPre` 口径一致）。
 *   两个字段**只增不改**：既有字段顺序与语义逐字节不变。
 *
 * @param {{workspaceKey:string, relPath:string, text:string, title:string, ts?:string,
 *          kind?:string, mtime?:number, criteria?:string, status?:string}} o
 */
export function buildSidecarEntryPre(o = {}) {
  const src = String(o.text || '')
  const lines = src.split('\n')
  const cueLine = lines.find((l) => /[\\/][\w.-]+|`[^`]+`|\d{2,}/.test(l)) || lines.find((l) => l.trim()) || ''
  const relPath = normalizeRelPathPre(o.relPath)
  const title = normalizeTitlePre(o.title)
  const tags = extractTagsPre(src, title)
  return {
    // ── §4.1 契约字段 ──
    id: wbEntryIdPre(o.workspaceKey, relPath, title),
    kind: String(o.kind || (relPath.includes('PLAN') ? 'plan' : relPath.includes('archive/') ? 'archive' : 'ledger')),
    source: relPath,
    section: sectionOfPre(src, title),
    tags,
    cues: extractCuesPre(src),
    preview: src.replace(/\s+/g, ' ').trim().slice(0, 120),
    mtime: Number(o.mtime) || 0,
    criteria: String(o.criteria || 'unknown'),
    // ── ★M1：契约 §3 索引派生行所需（只增不改）──
    layer: 'whiteboard',
    status: String(o.status || 'current'),
    // ── 兼容旧套件/工具描述的字段 ──
    title,
    cue: cueLine.trim().slice(0, 120),
    chars: src.length,
    ts: String(o.ts || ''),
  }
}

/**
 * ★M1（2026-09-18）：sidecar 条目 → Tier-0 目录项（**契约 §8 的桥**）。
 *
 * 契约 §8 要求：「由页面派生出的 index 与 Tier-0 目录条目**一致**」。
 * 实现方式 = **同一次派生、两种渲染** —— 本函数**只做字段映射，不复制任何逻辑**：
 *   entries 与 Tier-0 条目本就是同一份数据，映射后交给
 *   `renderCatalogLinePre` 渲染，一致性天然成立（无需额外同步机制）。
 *
 * 为什么不在此处直接渲染成字符串：渲染口径必须**只有一处实现**
 *   （`renderCatalogLinePre`），否则「两种渲染」会退化成「两个渲染器」，
 *   长期必然漂移 —— 这正是 §8 想防的。
 *
 * 字段映射（只映射，不发明）：
 *   - title   ← entry.title
 *   - oneLine ← entry.preview（已是单行化 + 120 字截断，即「一句话摘要」）
 *   - layer   ← entry.layer（本模块恒为 'whiteboard'）
 *   - status  ← entry.status（缺省 'current'）
 *   - date    ← entry.ts 的日期部分（无则空；不编造）
 *   - path    ← entry.source（相对路径，渲染时拼锚点）
 *   - id      ← entry.id（已是 mem_<32hex>）
 *
 * @param {object} entry buildSidecarEntryPre 的产物
 * @returns {{title:string,oneLine:string,layer:string,status:string,date:string,path:string,id:string}}
 */
export function sidecarEntryToCatalogItemPre(entry) {
  const e = entry && typeof entry === 'object' ? entry : {}
  const ts = String(e.ts || '')
  const dateOnly = (ts.match(/^\d{4}-\d{2}-\d{2}/) || [''])[0]
  return {
    title: String(e.title || ''),
    oneLine: String(e.preview || ''),
    layer: String(e.layer || 'whiteboard'),
    status: String(e.status || 'current'),
    date: dateOnly,
    path: String(e.source || ''),
    id: String(e.id || ''),
  }
}

/** tag → 条目 id 倒排(§3.3 by_tag)。 */
export function buildByTagPre(entries) {
  const byTag = {}
  for (const e of Array.isArray(entries) ? entries : []) {
    for (const t of Array.isArray(e.tags) ? e.tags : []) {
      if (!byTag[t]) byTag[t] = []
      if (!byTag[t].includes(e.id)) byTag[t].push(e.id)
    }
  }
  return byTag
}

/** cue → 条目 id 倒排(§3.3 by_cue)。 */
export function buildByCuePre(entries) {
  const byCue = {}
  for (const e of Array.isArray(entries) ? entries : []) {
    for (const c of Array.isArray(e.cues) ? e.cues : []) {
      if (!byCue[c]) byCue[c] = []
      if (!byCue[c].includes(e.id)) byCue[c].push(e.id)
    }
  }
  return byCue
}

/**
 * 版本链(§3.3 versions): entry_id → 归档文件相对路径数组。
 * 归档文件(archive/PLAN-*.md)没有自己的条目 id(它不参与 by_tag), 故按 kind='archive' 的条目
 * 与同标题前缀的现行条目关联。调用方负责把归档文件也传进 docs。
 */
export function buildVersionsPre(entries) {
  const versions = {}
  for (const e of Array.isArray(entries) ? entries : []) {
    if (e.kind !== 'archive') continue
    if (!versions[e.id]) versions[e.id] = []
    versions[e.id].push(e.source)
  }
  return versions
}

/**
 * 从 PLAN.md + 账本文件清单重建 index.json 内容(纯函数: 调用方负责读文件)。
 * @param {string} workspaceKey
 * @param {Array<{relPath:string, text:string, title:string, ts?:string, kind?:string, mtime?:number, criteria?:string}>} docs
 */
export function rebuildSidecarIndexPre(workspaceKey, docs) {
  const entries = []
  for (const d of Array.isArray(docs) ? docs : []) {
    try {
      entries.push(buildSidecarEntryPre({
        workspaceKey,
        relPath: d.relPath,
        text: d.text,
        title: d.title,
        ts: d.ts,
        kind: d.kind,
        mtime: d.mtime,
        criteria: d.criteria,
      }))
    } catch (_) { /* 单文件损坏不拖垮重建 */ }
  }
  return {
    version: WB_SIDECAR_VERSION,
    ws: String(workspaceKey || ''),
    rebuilt_at: new Date().toISOString(),
    entries,
    by_tag: buildByTagPre(entries),
    by_cue: buildByCuePre(entries),
    versions: buildVersionsPre(entries),
  }
}

/** 生成 §4.1 的 hint 文案(工具返回值里引导模型向下走)。 */
function hintForExpand() {
  return '可用 memory_trace(id) 回溯该条目的 cue/tag/邻居与归档版本'
}
function hintForTrace() {
  return '可用 memory_expand(tag) 按 tag 展开同主题条目; neighbors 为同 tag/同 cue 的相邻条目'
}

/**
 * 正向遍历: 按 tag 过滤条目(展开)。tag 精确匹配; '*' 返回全部。
 * 返回契约对齐 §4.1: {total, entries[], truncated, remaining, hint}。
 */
export function expandByTagPre(index, tag, limit = 10) {
  const t = String(tag || '').trim()
  const cap = Math.min(Math.max(Number(limit) || 10, 1), 20)
  const all = index && Array.isArray(index.entries) ? index.entries : []
  // 优先走 by_tag 倒排(§3.3); 索引缺倒排时回落全表扫描(向后兼容旧 index.json)
  let hits
  if (t !== '*' && index && index.by_tag && Array.isArray(index.by_tag[t])) {
    const ids = index.by_tag[t]
    const map = new Map(all.map((e) => [e.id, e]))
    hits = ids.map((id) => map.get(id)).filter(Boolean)
  } else {
    hits = all.filter((e) => t === '*' || (Array.isArray(e.tags) && e.tags.includes(t)))
  }
  const shown = hits.slice(0, cap)
  return {
    total: hits.length,
    entries: shown.map((e) => ({
      id: e.id,
      kind: e.kind,
      section: e.section,
      preview: e.preview,
      source: e.source,
      title: e.title,
      tags: e.tags,
      cues: e.cues,
      mtime: e.mtime,
      criteria: e.criteria,
    })),
    truncated: hits.length > cap,
    remaining: Math.max(0, hits.length - cap),
    hint: hintForExpand(),
  }
}

/**
 * 反向回溯: 按 id 找条目并给出相邻线索(同 tag 条目 + 同 cue)。
 * 返回契约对齐 §4.1: {found, entry, cues, tags, neighbors, versions, hint}。
 * 兼容旧字段 related(既有套件断言在用)。
 */
export function traceByIdPre(index, id) {
  const wanted = String(id || '').trim()
  const entries = index && Array.isArray(index.entries) ? index.entries : []
  const self = entries.find((e) => e.id === wanted)
  if (!self) return { found: false, reason: 'no-entry' }
  const sameTags = entries.filter((e) => e.id !== wanted && Array.isArray(e.tags) && Array.isArray(self.tags) && e.tags.some((t) => self.tags.includes(t))).slice(0, 5)
  const versions = (index && index.versions && Array.isArray(index.versions[wanted])) ? index.versions[wanted] : []
  return {
    found: true,
    entry: self,
    cues: Array.isArray(self.cues) ? self.cues : [],
    tags: Array.isArray(self.tags) ? self.tags : [],
    neighbors: sameTags.map((e) => ({ id: e.id, title: e.title, tags: e.tags, section: e.section })),
    versions,
    hint: hintForTrace(),
    related: sameTags.map((e) => ({ id: e.id, title: e.title, tags: e.tags })),
  }
}

/** 判据确认状态排序权重(§4.2 剪枝信号 1: passed > warned > unknown); 供调用方排序用。 */
export function criteriaWeightPre(criteria) {
  return criteria === 'passed' ? 3 : criteria === 'warned' ? 2 : criteria === 'unknown' ? 1 : 0
}

/** 锚点行正则(与 L0 抽取的 MEM_ANCHOR_RE 同形)。 */
export const WB_ANCHOR_LINE_RE_V1 = /^<!--\s*memory:(mem_[0-9a-f]{32})\s*-->$/

/**
 * WB-FORMAT-CONVENTION §2 锚点写入(纯函数, 零 IO)。
 *
 * 契约: 每个卡片/小节标题行下方紧跟一行 `<!-- memory:mem_<32hex> -->`;
 *   id = mem_ + sha256(workspaceKey + '\0' + relPath + '\0' + 卡片标题) 前 32 hex。
 *   ⇒ **重排/移动不改 id; 改标题 = 新 id**(旧 id 走 supersede 留痕)。
 *
 * 纪律:
 *  - **幂等**: 标题下方若已有锚点行, 按当前标题重算并就地更新(不叠加第二行)。
 *  - **只认 `## `–`#### ` 级标题**: `# ` 一级标题(文档标题)不加锚点 —— 它是文件身份, 不是卡片。
 *  - 锚点写在标题行**正下方**; 若标题下已有正文, 锚点插在标题与正文之间(不写在正文中间)。
 *  - 已有锚点但标题没变 ⇒ 逐字节不动(保证"同输入同字节", 不制造无谓 diff)。
 *  - 跳过 fenced code block 内的 `##` 行(避免把代码注释当标题)。
 *
 * @returns {{text:string, added:number, updated:number, unchanged:number}}
 */
export function applyAnchorsPre(workspaceKey, relPath, text) {
  const src = String(text == null ? '' : String(text))
  if (!src) return { text: src, added: 0, updated: 0, unchanged: 0 }
  const rel = normalizeRelPathPre(relPath)
  const lines = src.split('\n')
  const out = []
  let inFence = false
  let added = 0, updated = 0, unchanged = 0
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (/^\s*```/.test(line)) inFence = !inFence
    out.push(line)
    if (inFence) continue
    const m = line.match(/^(#{2,4})\s+(.+?)\s*$/)
    if (!m) continue
    const cardTitle = m[2].trim()
    if (!cardTitle) continue
    const want = wbEntryIdPre(workspaceKey, rel, cardTitle)
    const anchor = '<!-- memory:' + want + ' -->'
    const next = lines[i + 1] == null ? '' : lines[i + 1]
    const have = next.trim().match(WB_ANCHOR_LINE_RE_V1)
    if (have) {
      // 标题未变 ⇒ **原样保留既有锚点行**(不重发、不删除; 否则二次应用会丢失锚点, 破坏幂等)
      if (have[1] === want) { unchanged++; out.push(next) } else { updated++; out.push(anchor) }
      i++ // 吞掉旧锚点行(更新场景下已改为重发新锚点)
      continue
    }
    added++
    out.push(anchor)
  }
  return { text: out.join('\n'), added, updated, unchanged }
}

/** 从文本抽出所有锚点 id(供 lint / 一致性检查)。 */
export function collectAnchorIdsPre(text) {
  const ids = []
  for (const line of String(text || '').split('\n')) {
    const m = line.trim().match(WB_ANCHOR_LINE_RE_V1)
    if (m) ids.push(m[1])
  }
  return ids
}

// ─────────────────────────────────────────────────────────────────────────────
// 看板投影(2026-09-16「兼并 dsh-graph」)—— 把 sidecar 条目确定性投影成泳道卡片。
//
// 立场: 不搬 dsh-graph 的代码(它的领域模型是「目标/Attempt/Supervisor」, 与白板语料不同),
//   只吸收其**可视化形态**(列式泳道 + 状态徽章 + 卡片), 数据源仍是自己的 handoff/index.json
//   ⇒ 零新插件、零新存储、零 profile 改动, 白板与看板同源同生。
//
// 列的划分直接用本项目自己的语义(比 dsh-graph 的通用五列更贴材料):
//   目标 / 进行中 / 失败与弯路 / 进度与下一步 / 版本归档 —— 「失败与弯路」是本项目最贵的信息。
// 确定性: 同输入 → 同分列 + 同排序(id 破平), 便于测试与「同输入同字节」比对。
// ─────────────────────────────────────────────────────────────────────────────

/** 泳道定义(顺序即渲染顺序)。match 按 kind → tag → 小节名 → 小节标题正则, 先命中先归。
 *  v2(2026-09-16): 新增 matchTitle 正则 —— 小节级卡片没有 tag(白板正文里几乎没有语义 tag),
 *  只能靠**小节标题**分列; 实测真实数据的标题形如「任务状态」「已试方案与失败原因」「关键坑(血泪)」。 */
export const WB_KANBAN_LANES_V1 = [
  { key: 'goal', label: '目标', matchTags: ['type:goal'], matchSections: ['目标'], matchTitle: /^(?:总体)?目标|这是什么|定位|背景/ },
  { key: 'state', label: '进行中', matchTags: ['type:state'], matchSections: ['任务状态'], matchTitle: /任务状态|现状|进行中|在做/ },
  { key: 'deadend', label: '失败与弯路', matchTags: ['type:dead-end'], matchSections: ['已试方案与失败原因', '失败'], matchTitle: /失败|弯路|坑|教训|血泪|报错|阻塞/ },
  { key: 'progress', label: '进度与下一步', matchTags: ['type:progress'], matchSections: ['进度与下一步', '下一步', '进度'], matchTitle: /进度|下一步|待办|todo|后续/i },
  { key: 'archive', label: '版本归档', matchKinds: ['archive'] },
]

/** 判据 → 徽章:{ text, tone }(tone 供前端上色: ok / warn / unknown)。 */
function criteriaBadgePre(criteria) {
  const c = String(criteria || 'unknown')
  if (c === 'passed') return { text: '判据通过', tone: 'ok' }
  if (c === 'warned') return { text: '判据告警', tone: 'warn' }
  return { text: '判据未校验', tone: 'unknown' }
}

/** 条目/小节卡 → 泳道 key(确定性; 命中第一个匹配的泳道, 都不中则归 'misc')。 */
export function laneOfEntryPre(entry) {
  const e = entry || {}
  const tags = Array.isArray(e.tags) ? e.tags : []
  const sec = String(e.section || e.title || '')
  const kind = String(e.kind || '')
  for (const lane of WB_KANBAN_LANES_V1) {
    if (Array.isArray(lane.matchKinds) && lane.matchKinds.includes(kind)) return lane.key
    if (Array.isArray(lane.matchTags) && lane.matchTags.some((t) => tags.includes(t))) return lane.key
    if (Array.isArray(lane.matchSections) && sec) {
      for (const s of lane.matchSections) if (sec === s || sec.includes(s) || s.includes(sec)) return lane.key
    }
    // 小节标题正则(小节级卡片的主判据)
    if (lane.matchTitle && sec && lane.matchTitle.test(sec)) return lane.key
  }
  return 'misc'
}

/** `sec:xxx` 这类自动降 tag 不是语义 tag, 单独归到 sectionTags(不丢弃 —— 它是小节来源标记)。 */
function splitTagsPre(tags, cap = 6) {
  const real = [], sec = []
  for (const t of Array.isArray(tags) ? tags : []) {
    const s = String(t)
    if (s.startsWith('sec:')) { if (sec.length < 2) sec.push(s.slice(4)) }
    else if (real.length < cap) real.push(s)
  }
  return { tags: real, sectionTags: sec }
}

/**
 * 把 index.json(+可选小节卡) 投影成看板载荷(纯函数, 零 IO, 确定性)。
 *
 * v2(2026-09-16): `opts.cards` 给定时**以小节卡为数据源**(推荐); 未给定时回落文件级 entries
 *   (向后兼容既有调用与套件)。perLaneCap=0(缺省) 表示**不截断** —— v1 默认 60 会静默丢卡
 *   (实测丢 19 条), 改为「默认全给 + 前端分页/折叠」, 只有显式传 cap 才截断且回收进 omitted。
 *
 * @returns {{lanes:Array, stats:Object, recent:Array, generatedAt:string}}
 */
export function buildKanbanPre(index, opts = {}) {
  const entries = (index && Array.isArray(index.entries)) ? index.entries : []
  const byTag = (index && index.by_tag) || {}
  const versions = (index && index.versions) || {}
  const sectionCards = Array.isArray(opts.cards) && opts.cards.length ? opts.cards : null
  const perLaneCap = Number(opts.perLaneCap) > 0 ? Number(opts.perLaneCap) : 0

  const lanes = WB_KANBAN_LANES_V1.map((l) => ({ key: l.key, label: l.label, cards: [] }))
  const misc = { key: 'misc', label: '其它', cards: [] }

  if (sectionCards) {
    // ── 小节级数据源(推荐) ──
    for (const c of sectionCards) {
      const laneKey = laneOfEntryPre(c)
      const t = splitTagsPre(c.tags)
      const body = String(c.body || c.preview || '')
      const card = {
        id: c.id,
        short: String(c.id || '').slice(4, 12),
        title: String(c.title || c.source || ''),
        docTitle: String(c.docTitle || ''),
        source: String(c.source || ''),
        section: String(c.section || ''),
        preview: body.replace(/\s+/g, ' ').trim().slice(0, 400),
        // ★v3.1.2 性能：full 不再内联进看板载荷（实测每卡≤6000 字符、1178 卡合计 0.85 MB，
        //   且 lanes+matrix 双份 ⇒ 1.7 MB 纯冗余；前端默认只渲染 preview，full 仅「展开全文」需要）。
        //   改为只带长度标示，正文由 kanban-card 路由按 id 单取。
        fullLen: body.length,
        tags: t.tags,
        sectionTags: t.sectionTags,
        cues: (Array.isArray(c.cues) ? c.cues : []).slice(0, 3),
        criteria: String(c.criteria || 'unknown'),
        badge: criteriaBadgePre(c.criteria),
        mtime: Number(c.mtime) || 0,
        ts: String(c.ts || ''),
        chars: Number(c.chars) || 0,
        bullets: Number(c.bullets) || 0,
        lineStart: Number(c.lineStart) || 0,
        anchored: !!c.anchored,
        kind: String(c.kind || ''),
        versionCount: Array.isArray(versions[c.id]) ? versions[c.id].length : 0,
      }
      const target = laneKey === 'misc' ? misc : lanes.find((l) => l.key === laneKey)
      if (target) target.cards.push(card)
    }
  } else {
    for (const e of entries) {
      const laneKey = laneOfEntryPre(e)
      const t = splitTagsPre(e.tags)
      const card = {
        id: e.id,
        short: String(e.id || '').slice(4, 12),
        title: String(e.title || e.source || ''),
        docTitle: '',
        source: String(e.source || ''),
        section: String(e.section || ''),
        preview: String(e.preview || '').slice(0, 400),
        // ★v3.1.2 性能：同 sectionCards 分支 —— 不内联 full，仅带长度（见上）。
        fullLen: String(e.preview || '').length,
        tags: t.tags,
        sectionTags: t.sectionTags,
        cues: (Array.isArray(e.cues) ? e.cues : []).slice(0, 3),
        criteria: String(e.criteria || 'unknown'),
        badge: criteriaBadgePre(e.criteria),
        mtime: Number(e.mtime) || 0,
        ts: String(e.ts || ''),
        chars: Number(e.chars) || 0,
        bullets: 0,
        lineStart: 0,
        anchored: false,
        kind: String(e.kind || ''),
        versionCount: Array.isArray(versions[e.id]) ? versions[e.id].length : 0,
      }
      const target = laneKey === 'misc' ? misc : lanes.find((l) => l.key === laneKey)
      if (target) target.cards.push(card)
    }
  }

  // 确定性排序: 判据权重降序 → mtime 降序 → id 升序(破平)
  const sortCards = (arr) => arr.sort((a, b) => {
    const wa = criteriaWeightPre(a.criteria), wb = criteriaWeightPre(b.criteria)
    if (wa !== wb) return wb - wa
    if (a.mtime !== b.mtime) return b.mtime - a.mtime
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
  for (const l of lanes) sortCards(l.cards)
  sortCards(misc.cards)

  const all = lanes.concat(misc.cards.length ? [misc] : [])
  let omitted = 0
  const out = all.map((l) => {
    const cards = perLaneCap > 0 ? l.cards.slice(0, perLaneCap) : l.cards
    const om = l.cards.length - cards.length
    omitted += om
    return {
      key: l.key, label: l.label,
      count: l.cards.length,        // 真实总数(不是显示数 —— 前端据此显示「还有 N 条」)
      shown: cards.length,
      omitted: om,                  // P8: 显式回收, 不再静默丢失
      truncated: om > 0,
      cards,
    }
  })

  // P9: 跨泳道「最近更新」聚合视图(取全部卡按 mtime 倒序前 40)
  const flat = all.reduce((a, l) => a.concat(l.cards.map((c) => Object.assign({ laneKey: l.key, laneLabel: l.label }, c))), [])
  const recent = flat.slice().sort((a, b) => (b.mtime - a.mtime) || (a.id < b.id ? -1 : 1)).slice(0, 40)

  const tagRows = Object.keys(byTag)
    .filter((t) => !t.startsWith('sec:'))
    .map((t) => ({ tag: t, count: (byTag[t] || []).length }))
    .sort((a, b) => b.count - a.count || (a.tag < b.tag ? -1 : 1))
    .slice(0, 24)

  const total = sectionCards ? sectionCards.length : entries.length
  return {
    lanes: out,
    recent,
    stats: {
      total,
      cardSource: sectionCards ? 'section' : 'file',
      omitted,
      tags: tagRows,
      byKind: ['plan', 'ledger', 'archive'].map((k) => ({ kind: k, count: flat.filter((c) => c.kind === k).length })),
      passed: flat.filter((c) => c.criteria === 'passed').length,
      warned: flat.filter((c) => c.criteria === 'warned').length,
      anchored: flat.filter((c) => c.anchored).length,
    },
    generatedAt: String(opts.now || ''),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 矩阵投影(2026-09-16「整页看板」批) —— 为 conversation.view 宽屏承载面准备的**矩阵视图**。
//
// 为什么需要第二套投影: 侧边面板 440px 装不下矩阵(5 列 × 210px), 而整页 ~1600px 可以。
//   ⇒ 同一份小节卡, 按容器宽度选形态: 窄屏用 buildKanbanPre 的列表视图,
//     宽屏用本函数的矩阵视图(行 = 日期分组, 列 = 小节类型)。
//
// 行为什么按日期而不是按文件: 本项目材料是**时间序列**(每天多篇账本),
//   按日期分组能一眼看出「哪几天没写失败原因」——这是记忆系统的健康度指标,
//   而按文件平铺 92 行只是流水账。组内仍保留每篇账本的逐条卡片。
//
// 与 buildKanbanPre 的关系: 二者**同源**(都吃 buildSectionCardsPre 的卡), 不重复抽取逻辑。
// ─────────────────────────────────────────────────────────────────────────────

/** 从 source 路径推导账本日期 `YYYY-MM-DD`(handoff-YYYYMMDD-HHMMSS.md); 推不出返回 ''。 */
export function ledgerDateOfPre(source) {
  const m = String(source || '').match(/handoff-(\d{4})(\d{2})(\d{2})-/)
  if (m) return m[1] + '-' + m[2] + '-' + m[3]
  if (/PLAN\.md$/i.test(String(source || ''))) return ''   // 白板是「现在时」, 无日期
  return ''
}

/**
 * 卡片集合 → 矩阵载荷(纯函数, 零 IO, 确定性)。
 *
 * @param {Array} cards buildSectionCardsPre 的输出
 * @param {object} [opts] { now, maxRows, colKeys }
 * @returns {{columns:Array<{key,label,count}>, rows:Array<{key,label,cells:Object,count}>, stats:Object, others:Object}}
 */
export function buildKanbanMatrixPre(cards, opts = {}) {
  const list = Array.isArray(cards) ? cards : []
  const colKeys = Array.isArray(opts.colKeys) && opts.colKeys.length
    ? opts.colKeys
    : WB_KANBAN_LANES_V1.map((l) => l.key).concat(['misc'])
  const columns = colKeys.map((k) => {
    const lane = WB_KANBAN_LANES_V1.find((l) => l.key === k)
    return { key: k, label: lane ? lane.label : (k === 'misc' ? '其它' : k), count: 0 }
  })
  const colOf = {}
  for (const c of columns) colOf[c.key] = c

  // 行分组: 有日期的按日期倒序; 无日期(PLAN/归档)归入单独一行
  const groups = new Map()
  for (const card of list) {
    const d = ledgerDateOfPre(card.source)
    const rowKey = d || '__undated__'
    if (!groups.has(rowKey)) groups.set(rowKey, [])
    groups.get(rowKey).push(card)
  }

  const mkRow = (key) => ({ key, label: key === '__undated__' ? '白板 / 归档' : key, cells: {}, count: 0, docs: 0 })
  const rows = []
  const dated = [...groups.keys()].filter((k) => k !== '__undated__').sort().reverse()
  const order = dated.concat(groups.has('__undated__') ? ['__undated__'] : [])
  for (const rk of order) {
    const row = mkRow(rk)
    const srcSet = new Set()
    for (const c of groups.get(rk) || []) {
      const laneKey = laneOfEntryPre(c)
      const key = colOf[laneKey] ? laneKey : 'misc'
      if (!row.cells[key]) row.cells[key] = []
      const t = splitTagsPre(c.tags)
      const body = String(c.body || c.preview || '')
      row.cells[key].push({
        id: c.id,
        short: String(c.id || '').slice(4, 12),
        title: String(c.title || ''),
        docTitle: String(c.docTitle || ''),
        source: String(c.source || ''),
        preview: body.replace(/\s+/g, ' ').trim().slice(0, 220),
        // ★v3.1.2 性能：矩阵卡同样不内联 full（同 lanes 口径）——带长度标示，点开时按 id 单取。
        fullLen: body.length,
        bullets: Number(c.bullets) || 0,
        criteria: String(c.criteria || 'unknown'),
        badge: criteriaBadgePre(c.criteria),
        anchored: !!c.anchored,
        anchorId: String(c.anchorId || ''),
        tags: t.tags,
        sectionTags: t.sectionTags,
        mtime: Number(c.mtime) || 0,
      })
      row.count++
      if (colOf[key]) colOf[key].count++
      srcSet.add(String(c.source || ''))
    }
    row.docs = srcSet.size
    // 组内确定性排序(判据权重 → mtime → id 破平, 与列表视图同口径)
    const sortIn = (arr) => arr.sort((a, b) => {
      const wa = criteriaWeightPre(a.criteria), wb = criteriaWeightPre(b.criteria)
      if (wa !== wb) return wb - wa
      if (a.mtime !== b.mtime) return b.mtime - a.mtime
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
    })
    for (const k of Object.keys(row.cells)) sortIn(row.cells[k])
    if (row.count) rows.push(row)
  }

  const maxRows = Number(opts.maxRows) > 0 ? Number(opts.maxRows) : 0
  const shown = maxRows > 0 ? rows.slice(0, maxRows) : rows

  // 健康度: 有内容但缺「失败与弯路」列的日期(记忆系统最容易退化的位置)
  const missingDeadend = shown.filter((r) => r.count > 0 && !(r.cells.deadend && r.cells.deadend.length)).map((r) => r.label)

  return {
    columns,
    rows: shown,
    stats: {
      totalCards: list.length,
      totalRows: rows.length,
      shownRows: shown.length,
      dateFrom: dated.length ? dated[dated.length - 1] : '',
      dateTo: dated.length ? dated[0] : '',
      missingDeadend,
    },
    generatedAt: String(opts.now || ''),
  }
}
