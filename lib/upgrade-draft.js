/**
 * 草案校验器（upgrade_draft_pre_v1）—— 迁移向导「JSON 草案信道」的闸 1–7。
 *
 * 权威依据：docs/internal/PLAN-UPGRADE-WIZARD-20261103.md §3.6（草案写文件信道）+ §3.7（十道闸）。
 * 本模块只做 **闸 1–7**（低成本兜底：全部纯函数、零 LLM、零 IO）；闸 8–10（渲染/写盘/双跑一致性）
 * 由 P2 的 applier 负责。
 *
 * ## 为什么必须存在
 * 子代理把草案 JSON 写进 `upgrade-runs/<runId>/draft/<wsKey>.json` 后，引擎**不能直接落盘**：
 * 烂模型会编造引用（幻觉 quoteRef）、瞎报数字（自检与真值不符）、把一件事拆成碎片、
 * 往记忆里灌乱码/HTML。闸 3（溯源真实性）+ 闸 4（自检重算）是本方案的核心防线，
 * 挡住「模型编造引用」与「模型瞎报数字」两类污染；其余五闸挡住结构性与卫生问题。
 * 任何一闸不过 ⇒ 调用方**整区回滚、不落盘**（fail closed），把 detail 回给子代理重试（上限 2 次）。
 *
 * ## 契约
 * `validateUpgradeDraftPre(draft, deps) → {ok:true} | {ok:false, code, detail:[{path,reason}]}`
 *   · **纯函数、零 IO**：不 import fs/path，不读盘、不写盘、不 await、无网络；
 *     一切文件读取由 `deps` 注入（便于单测 + 让引擎决定路径解析与白名单）。
 *   · **绝不 throw**：任何内部异常都折成 `{ok:false, code:'internal'}`（fail closed）。
 *   · `code` 取值 = 闸名：`schema` / `required` / `provenance` / `conservation` /
 *     `shape` / `dedupe` / `hygiene` / `internal`。
 *
 * ## deps（引擎注入；缺项按 fail closed 处理，不静默放行）
 * 两种等价形状都支持（P2 applier 的 ctx 形状 = 形状 B，避免消费端再写适配层）：
 *
 *   **形状 A（函数式，单测友好）**
 *   · `exists(rel) → boolean`           必需：rel 是否存在（相对该工作区记忆目录）
 *   · `readFile(rel) → string`          必需：读源文件全文（供 quoteRef 子串命中校验）
 *
 *   **形状 B（内容前载，applier 用）**
 *   · `files: { [rel]: string }`        必需：引擎已按 members[] / checkpoints[].rel 读好的
 *                                       **真实文件内容表**（读不到的 rel 不放进 key）。
 *                                       key 即白名单：不在表内 ⇒ rel 视为不存在。
 *
 *   两形状共有（可选）：
 *   · `wsKey?: string`                  引擎定位的当前工作区 key；与 draft.wsKey 冲突即拒
 *   · `manifestWsKeys?: string[]`       本次 manifest 的工作区白名单（draft.wsKey/ctx.wsKey 必须在内）
 *   · `manifest?: object|string[]`      可选：`{wsKeys?:string[], files?:string[]}` 或 wsKey 字符串数组；
 *                                       也接受 `{workspaces?:[{wsKey}]}`
 *   · `manifestFiles?: string[]`        该区允许引用的文件白名单（members/rel 必须在内；
 *                                       形状 B 下 key 集即事实白名单，本项可省）
 *   · `logCount?: number`               可选但强烈建议：该区**真实日志篇数**（引擎扫盘真值）。
 *                                       缺省时以「草案覆盖到的日志篇数」自比（比率检查失效，见闸 4 注释）。
 *   · `isLogRel?(rel) → boolean`        可选：判定 rel 是否日志文件（缺省：basename 为 YYYY-MM-DD.md）
 *   · `existingEventNames?: string[]`   可选：该区已有事件名（防与既有事件重名）
 *   · `existingIdemKeys?: string[]`     可选：该区已有检查点 idemKey
 *
 * ## 返回（与 P2 applier 的消费契约双向兼容）
 *   · 通过：`{ ok: true }`
 *   · 拒绝：`{ ok: false, code, detail: [{path, reason}], errors: [string] }`
 *     —— `detail` 是本校验器的原生形状（带字段路径，便于把错误回给子代理）；
 *        `errors` 是同一批错误的「`path: reason`」扁平串数组，供只认 errors[] 的消费端直接落回执。
 *        两者内容同源，不会出现两套判据。
 *
 * ## 草案 schema（严格白名单；未知字段一律拒）
 * ```text
 * {
 *   wsKey?: string,                       // deps.manifestWsKeys 给出时必填且必须在白名单内
 *   events: [{
 *     name: string(1..80), summary: string(1..400),
 *     sections: { goal, doing, deadend, next },   // 四段均非空（§3.7 闸 2）
 *     members: string[],                  // ≥1，每项必须是真实存在的文件
 *     rationale: string,                  // 非空：为什么这几篇是一件事
 *     kind?, confidence?, startMs?, endMs?, outcomes?, skills?,
 *     checkpoints: [{
 *       at?, kind?, text?, goal?, state?, dead?, next?,
 *       quoteRef: string,                 // 必须能在 rel 文件中子串命中（闸 3）
 *       quoteLine?, rel: string,          // rel 必须真实存在（闸 3）
 *       bytes?, sha256?, idemKey?
 *     }]
 *   }],
 *   selfCheck: { events, checkpoints, coveredLogs }   // 与引擎重算一致（闸 4）
 * }
 * ```
 * 说明：checkpoint 的 `goal` + `state` 必须非空（与 migration-prompt v7 §2c「四段覆盖率 100%」
 * 的判据一致）；`dead`/`next` 允许空串（卡点/下一步确实可能没有）。
 */

export const UPGRADE_DRAFT_VERSION = 'upgrade_draft_pre_v1'

/** 闸 2/5/7 的阈值集中在此，避免调用方与校验器各写一套魔法数（同一语义必须同源）。 */
export const UPGRADE_DRAFT_LIMITS = Object.freeze({
  nameMax: 80,
  summaryMax: 400,
  /** 单条正文上限（字）——§3.7 闸 7「单条 ≤ 2000 字」 */
  textMax: 2000,
  /** 单检查点事件占比上限 —— §3.7 闸 5「≤ 30%」 */
  singleCheckpointRatioMax: 0.3,
  /** 日志覆盖率下限 —— §3.7 闸 4「coveredLogs ≥ 日志数 × 80%」 */
  coveredLogsRatioMin: 0.8,
  /** 事件数上界 = 日志数 × 1.5 + 5 —— §3.7 闸 5 */
  eventsPerLogFactor: 1.5,
  eventsPerLogSlack: 5,
  /** base64 残骸行判定：行长 ≥ 该值且整行纯 base64 字母表 */
  base64MinLen: 200,
  /** detail 数组上限（防止一个烂草案回传上万条，把重试提示撑爆） */
  maxDetail: 50,
})

const V = UPGRADE_DRAFT_VERSION
const L = UPGRADE_DRAFT_LIMITS

/** 顶层字段白名单（严格：未知字段 ⇒ 闸 1 拒）。 */
//   ★wsPath 是引擎注入的定位字段（applier 封装草案时带上），不是模型可自由发挥的内容字段；
//     它进白名单是为了免掉消费端的剥离适配，仍按「已知字段」对待：类型错照样拒。
const TOP_KEYS = Object.freeze(['wsKey', 'wsPath', 'events', 'selfCheck'])
/** 事件字段白名单。 */
const EVENT_KEYS = Object.freeze([
  'name', 'summary', 'sections', 'members', 'rationale',
  'kind', 'confidence', 'startMs', 'endMs', 'outcomes', 'skills', 'checkpoints',
])
/** 事件四段字段白名单。 */
const SECTION_KEYS = Object.freeze(['goal', 'doing', 'deadend', 'next'])
/** 检查点字段白名单。 */
const CHECKPOINT_KEYS = Object.freeze([
  'at', 'kind', 'text', 'goal', 'state', 'dead', 'next',
  'quoteRef', 'quoteLine', 'rel', 'bytes', 'sha256', 'idemKey',
])
/** selfCheck 字段白名单。 */
const SELFCHECK_KEYS = Object.freeze(['events', 'checkpoints', 'coveredLogs'])

/**
 * 乱码判据（与 lib/index.js 的 MOJIBAKE_RE 同源）。
 * ★为什么**抄一份**而不是 import index.js：本模块必须零依赖纯函数——index.js 是插件入口
 *   （注册工具/起定时器/读配置），import 它会带来真实副作用，单测与引擎侧都会被它拖住。
 *   抄的是「字面量正则 + 同一阈值 0.001」，改判据时**两处必须同批改**（同一语义禁止各写一份）。
 */
const MOJIBAKE_RE = /涓婁紶|涓嬭浇|鏉ユ簮|鈥|鈶|鈮|鐨勪|鐨勫|瀹夎|鍙戦|鐢ㄦ埛|鎴戠殑|鏁版嵁|鎸佷箙|璁＄畻|婧愪簬|鏂囦欢|瀹樻柟|娴嬭瘯|鍥剧墖|杩涜涓|鎵撳涓|鎵撳紑|杈撳嚭|鏌ヨ|鑾峰彇|閰嶇疆|缂撳瓨|瀛樺偍|鍒濆|璇曟嵎|璋冭瘯|瀛︿範|鎬ц兘/

/** base64 残骸行（与 lib/index.js 的 BASE64_LINE 同源）。 */
const BASE64_LINE = /^[A-Za-z0-9+/]{200,}={0,2}$/

/** HTML 注入判据（闸 7 新增：草案会进白板/注入面，脚本与事件属性一律拒）。 */
const HTML_INJECT_RE = /<(?:script|iframe|object|embed|style)\b|(?:onerror|onload|onclick|onmouseover|onfocus)\s*=|javascript\s*:/i

/** 缺省日志文件判据：basename 为 `YYYY-MM-DD.md`（与日志文件名规范一致）。 */
const DEFAULT_LOG_RE = /^\d{4}-\d{2}-\d{2}\.md$/

/**
 * 从 deps 取 manifest 工作区白名单。兼容三种形状（引擎可任选，不必为此写适配层）：
 *   `manifestWsKeys: string[]` / `manifest: string[]` / `manifest: { wsKeys|workspaces|wsKey }`。
 */
function wsKeysFromDeps(d) {
  const out = []
  const add = (v) => { if (isStr(v) && trimAll(v) && out.indexOf(trimAll(v)) < 0) out.push(trimAll(v)) }
  const addEntry = (x) => { if (isStr(x)) add(x); else if (isObj(x)) { add(x.wsKey); add(x.key) } }
  if (Array.isArray(d.manifestWsKeys)) d.manifestWsKeys.forEach(addEntry)
  const mf = d.manifest
  if (Array.isArray(mf)) mf.forEach(addEntry)
  else if (isObj(mf)) {
    if (Array.isArray(mf.wsKeys)) mf.wsKeys.forEach(addEntry)
    if (Array.isArray(mf.workspaces)) mf.workspaces.forEach(addEntry)
    addEntry(mf.wsKey)
  }
  return out
}

/** 从 deps 取「允许引用的文件」白名单；未提供 ⇒ 返回 null（不做白名单限制，仍受 exists 约束）。 */
function filesWhitelistFromDeps(d) {
  const out = []
  const add = (v) => { if (isStr(v) && trimAll(v) && out.indexOf(trimAll(v)) < 0) out.push(trimAll(v)) }
  if (Array.isArray(d.manifestFiles)) d.manifestFiles.forEach(add)
  const mf = d.manifest
  if (isObj(mf) && Array.isArray(mf.files)) mf.files.forEach((x) => add(isStr(x) ? x : (isObj(x) ? (x.rel || x.path) : null)))
  return out.length ? out : null
}

/** rel 的等价键（原样 / 正斜杠 / 反斜杠）——Windows 路径与 JSON 里的写法可能不一致，不该因此误判「文件不存在」。 */
function relKeysOf(rel) {
  const r = trimAll(rel)
  const keys = [r]
  const fwd = r.replace(/\\/g, '/')
  if (keys.indexOf(fwd) < 0) keys.push(fwd)
  const back = r.replace(/\//g, '\\')
  if (keys.indexOf(back) < 0) keys.push(back)
  return keys
}

function isObj(x) {
  return x !== null && typeof x === 'object' && !Array.isArray(x)
}
function isStr(x) { return typeof x === 'string' }
function isNum(x) { return typeof x === 'number' && Number.isFinite(x) }
function trimAll(x) { return String(x == null ? '' : x).trim() }
function normName(x) { return trimAll(x).replace(/\s+/g, ' ').toLowerCase() }
function basenameOf(rel) { return trimAll(rel).replace(/\\/g, '/').split('/').pop() }

/** 乱码密度（阈值同 lib/index.js: 0.001）。 */
function mojibakeDensity(text) {
  const t = String(text || '')
  if (!t) return 0
  const hits = (t.match(new RegExp(MOJIBAKE_RE.source, 'g')) || []).length
  return (hits * 8) / Math.max(1, t.length)
}

/**
 * 复读退化检测（与 lib/index.js 的 detectStutter 同源，见其 2026-09-29 P0-2 语种盲区修复）：
 * ① ASCII 词连续复读 ≥4 次且间隔为纯空白/标点；② 周期性复读（间隔逐字相同）；
 * ③ CJK 单字连读 ≥5 次。中文行文里高频出现的英文缩写（AI/DOI）不会被误判。
 */
function detectStutter(text) {
  const t = String(text || '')
  if (!t) return null
  let m = t.match(/(?:^|[^\w])(\w{2,})(?:[^\w\u4e00-\u9fff\u3400-\u4dbf\u3040-\u30ff\uac00-\ud7af]+\1){3,}(?:[^\w]|$)/)
  if (m) return { kind: 'ascii', token: m[1], count: m[0].split(m[1]).length - 1 }
  const re = /(?:^|[^\w])(\w{2,})(?:[^\w]+\1){3,}(?:[^\w]|$)/g
  let mm
  while ((mm = re.exec(t)) !== null) {
    const tok = mm[1]
    const occ = []
    const tre = new RegExp(tok, 'g')
    let tm
    while ((tm = tre.exec(mm[0])) !== null) { occ.push(tm.index); tre.lastIndex = tm.index + tok.length }
    if (occ.length >= 4) {
      const gaps = []
      for (let gi = 1; gi < occ.length; gi++) gaps.push(mm[0].slice(occ[gi - 1] + tok.length, occ[gi]))
      let allSame = true
      for (let gj = 1; gj < gaps.length; gj++) { if (gaps[gj] !== gaps[0]) { allSame = false; break } }
      if (allSame) return { kind: 'ascii-periodic', token: tok, count: occ.length }
    }
  }
  const c = t.match(/([\u4e00-\u9fff\u3040-\u30ff])(?:[^\u4e00-\u9fff\u3040-\u30ff]{0,2}\1){4,}/)
  if (c) return { kind: 'cjk', token: c[1], count: c[0].split(c[1]).length - 1 }
  return null
}

/** 找出首个 base64 残骸行号（1 基）；无则 0。 */
function firstBase64Line(text) {
  const lines = String(text || '').split('\n')
  for (let i = 0; i < lines.length; i++) {
    const k = lines[i].trim()
    if (k.length >= L.base64MinLen && BASE64_LINE.test(k)) return i + 1
  }
  return 0
}

/** 连续相同非空行 ≥3 次（与 lib/index.js 的 duplicate-lines 判据同源，空行打断连续）。 */
function hasDuplicateLines(text) {
  let seq = 0
  let prev = ''
  for (const l of String(text || '').split('\n')) {
    const t = l.trim()
    if (!t) { seq = 0; prev = ''; continue }
    if (t === prev) { seq++; if (seq >= 3) return t.slice(0, 60) } else { prev = t; seq = 1 }
  }
  return ''
}

/**
 * 单条正文卫生判据（闸 7）。返回拒绝原因串；通过返回 ''。
 * ★与写入原语 sanitizeForWrite 的差别：这里**不做截断**（草案超限是模型没守约束，应拒并重试），
 *   只判「超长 / 乱码 / 复读 / base64 残骸 / 连续重复行 / HTML 注入」。
 */
function hygieneReason(str) {
  if (!isStr(str)) return ''
  if (str.length > L.textMax) return '单条 > ' + L.textMax + ' 字（实得 ' + str.length + '）'
  if (mojibakeDensity(str) > 0.001) return '疑似乱码/错误编码往返（mojibake）'
  if (detectStutter(str)) return '疑似复读退化（stutter）'
  const b64 = firstBase64Line(str)
  if (b64) return '疑似 base64 编码残骸行（第 ' + b64 + ' 行）'
  const dup = hasDuplicateLines(str)
  if (dup) return '疑似连续重复行（≥3 次：' + dup + '）'
  if (HTML_INJECT_RE.test(str)) return '疑似 HTML/脚本注入（<script|iframe|onerror=|javascript: 等）'
  return ''
}

/**
 * 拒绝结果构造：`detail`（原生，带字段路径）与 `errors`（扁平串）**同源**。
 * ★为什么也发 errors：P2 applier 的回执只消费 `errors: string[]`；两份内容由同一批 detail
 *   映射而来，不存在两套判据，也不会出现「detail 说拒、errors 说空」的自相矛盾。
 */
function fail(code, detail) {
  const list = (detail || []).slice(0, L.maxDetail)
  return {
    ok: false,
    code,
    detail: list,
    errors: list.map((x) => (x && x.path ? x.path + ': ' : '') + (x && x.reason ? x.reason : '')),
  }
}

function pushHygiene(detail, path, value) {
  const reason = hygieneReason(value)
  if (reason) detail.push({ path, reason })
}

/**
 * 校验一个迁移草案。**纯函数**：不读盘、不写盘、不抛异常。
 *
 * @param {*} draft 子代理产出的草案对象（JSON.parse 结果或同形对象）
 * @param {object} [deps] 见文件头「deps」；缺项按 fail closed 处理
 * @returns {{ok:true} | {ok:false, code:string, detail:Array<{path:string, reason:string}>}}
 */
export function validateUpgradeDraftPre(draft, deps) {
  try {
    const d = deps && typeof deps === 'object' ? deps : {}

    // ══════════════════ 闸 1 · Schema（严格字段白名单 + 类型） ══════════════════
    const s1 = []
    if (!isObj(draft)) {
      return fail('schema', [{ path: '$', reason: '草案必须是对象（实得 ' + (draft === null ? 'null' : Array.isArray(draft) ? 'array' : typeof draft) + '）' }])
    }
    for (const k of Object.keys(draft)) {
      if (TOP_KEYS.indexOf(k) < 0) s1.push({ path: k, reason: '未知字段（顶层白名单：' + TOP_KEYS.join('/') + '）' })
    }
    if (draft.wsKey !== undefined && !isStr(draft.wsKey)) s1.push({ path: 'wsKey', reason: '必须是字符串' })
    if (draft.wsPath !== undefined && !isStr(draft.wsPath)) s1.push({ path: 'wsPath', reason: '必须是字符串' })
    if (!Array.isArray(draft.events)) s1.push({ path: 'events', reason: '必须是数组' })
    if (!isObj(draft.selfCheck)) s1.push({ path: 'selfCheck', reason: '必须是对象' })
    if (Array.isArray(draft.events)) {
      draft.events.forEach((ev, i) => {
        const p = 'events[' + i + ']'
        if (!isObj(ev)) { s1.push({ path: p, reason: '必须是对象' }); return }
        for (const k of Object.keys(ev)) {
          if (EVENT_KEYS.indexOf(k) < 0) s1.push({ path: p + '.' + k, reason: '未知字段（事件白名单：' + EVENT_KEYS.join('/') + '）' })
        }
        if (ev.name !== undefined && !isStr(ev.name)) s1.push({ path: p + '.name', reason: '必须是字符串' })
        if (ev.summary !== undefined && !isStr(ev.summary)) s1.push({ path: p + '.summary', reason: '必须是字符串' })
        if (ev.rationale !== undefined && !isStr(ev.rationale)) s1.push({ path: p + '.rationale', reason: '必须是字符串' })
        if (ev.kind !== undefined && !isStr(ev.kind)) s1.push({ path: p + '.kind', reason: '必须是字符串' })
        if (ev.confidence !== undefined && !isStr(ev.confidence)) s1.push({ path: p + '.confidence', reason: '必须是字符串' })
        if (ev.startMs !== undefined && !isNum(ev.startMs)) s1.push({ path: p + '.startMs', reason: '必须是有限数字' })
        if (ev.endMs !== undefined && !isNum(ev.endMs)) s1.push({ path: p + '.endMs', reason: '必须是有限数字' })
        if (ev.members !== undefined) {
          if (!Array.isArray(ev.members)) s1.push({ path: p + '.members', reason: '必须是数组' })
          else ev.members.forEach((mv, mi) => { if (!isStr(mv)) s1.push({ path: p + '.members[' + mi + ']', reason: '必须是字符串（相对路径）' }) })
        }
        if (ev.outcomes !== undefined) {
          if (!Array.isArray(ev.outcomes)) s1.push({ path: p + '.outcomes', reason: '必须是数组' })
          else ev.outcomes.forEach((ov, oi) => { if (!isStr(ov)) s1.push({ path: p + '.outcomes[' + oi + ']', reason: '必须是字符串' }) })
        }
        if (ev.skills !== undefined) {
          if (!Array.isArray(ev.skills)) s1.push({ path: p + '.skills', reason: '必须是数组' })
          else ev.skills.forEach((sv, si) => { if (!isStr(sv)) s1.push({ path: p + '.skills[' + si + ']', reason: '必须是字符串' }) })
        }
        if (ev.sections !== undefined) {
          if (!isObj(ev.sections)) s1.push({ path: p + '.sections', reason: '必须是对象' })
          else {
            for (const k of Object.keys(ev.sections)) {
              if (SECTION_KEYS.indexOf(k) < 0) s1.push({ path: p + '.sections.' + k, reason: '未知字段（四段白名单：' + SECTION_KEYS.join('/') + '）' })
            }
            for (const k of SECTION_KEYS) {
              if (ev.sections[k] !== undefined && !isStr(ev.sections[k])) s1.push({ path: p + '.sections.' + k, reason: '必须是字符串' })
            }
          }
        }
        if (ev.checkpoints !== undefined) {
          if (!Array.isArray(ev.checkpoints)) s1.push({ path: p + '.checkpoints', reason: '必须是数组' })
          else {
            ev.checkpoints.forEach((cp, ci) => {
              const pp = p + '.checkpoints[' + ci + ']'
              if (!isObj(cp)) { s1.push({ path: pp, reason: '必须是对象' }); return }
              for (const k of Object.keys(cp)) {
                if (CHECKPOINT_KEYS.indexOf(k) < 0) s1.push({ path: pp + '.' + k, reason: '未知字段（检查点白名单：' + CHECKPOINT_KEYS.join('/') + '）' })
              }
              for (const k of ['kind', 'text', 'goal', 'state', 'dead', 'next', 'quoteRef', 'rel', 'sha256', 'idemKey']) {
                if (cp[k] !== undefined && !isStr(cp[k])) s1.push({ path: pp + '.' + k, reason: '必须是字符串' })
              }
              for (const k of ['at', 'quoteLine', 'bytes']) {
                if (cp[k] !== undefined && !isNum(cp[k])) s1.push({ path: pp + '.' + k, reason: '必须是有限数字' })
              }
            })
          }
        }
      })
    }
    if (isObj(draft.selfCheck)) {
      for (const k of Object.keys(draft.selfCheck)) {
        if (SELFCHECK_KEYS.indexOf(k) < 0) s1.push({ path: 'selfCheck.' + k, reason: '未知字段（selfCheck 白名单：' + SELFCHECK_KEYS.join('/') + '）' })
      }
      for (const k of SELFCHECK_KEYS) {
        const v = draft.selfCheck[k]
        if (v !== undefined && !(isNum(v) && v >= 0 && Math.floor(v) === v)) s1.push({ path: 'selfCheck.' + k, reason: '必须是非负整数' })
      }
    }
    if (s1.length) return fail('schema', s1)

    const events = draft.events
    const selfCheck = draft.selfCheck

    // ══════════════════ 闸 2 · 必填 ══════════════════
    const s2 = []
    // 工作区身份：草案自带 wsKey 优先，其次用引擎 ctx.wsKey；两者都有时必须一致（不许静默取一）。
    const manifestWsKeys = wsKeysFromDeps(d)
    const draftWsKey = draft.wsKey !== undefined ? trimAll(draft.wsKey) : ''
    const ctxWsKey = isStr(d.wsKey) ? trimAll(d.wsKey) : ''
    const effectiveWsKey = draftWsKey || ctxWsKey
    if (draft.wsKey !== undefined && !draftWsKey) s2.push({ path: 'wsKey', reason: '不得为空串' })
    if (draftWsKey && ctxWsKey && draftWsKey !== ctxWsKey) {
      s2.push({ path: 'wsKey', reason: '草案 wsKey 与引擎 ctx.wsKey 不一致：' + draftWsKey + ' ≠ ' + ctxWsKey })
    }
    if (manifestWsKeys.length > 0) {
      if (!effectiveWsKey) s2.push({ path: 'wsKey', reason: '缺省；manifest 已给出时必须能确定草案属于哪个工作区（draft.wsKey 或 ctx.wsKey）' })
      else if (manifestWsKeys.indexOf(effectiveWsKey) < 0) s2.push({ path: 'wsKey', reason: '不在 manifest 工作区白名单内（' + manifestWsKeys.join(',') + '）' })
    }
    if (events.length === 0) s2.push({ path: 'events', reason: '至少要有 1 个事件' })
    events.forEach((ev, i) => {
      const p = 'events[' + i + ']'
      const name = trimAll(ev.name)
      if (!name) s2.push({ path: p + '.name', reason: '必填且非空' })
      else if (name.length > L.nameMax) s2.push({ path: p + '.name', reason: '超长 > ' + L.nameMax + ' 字（实得 ' + name.length + '）' })
      const summary = trimAll(ev.summary)
      if (!summary) s2.push({ path: p + '.summary', reason: '必填且非空' })
      else if (summary.length > L.summaryMax) s2.push({ path: p + '.summary', reason: '超长 > ' + L.summaryMax + ' 字（实得 ' + summary.length + '）' })
      if (!isObj(ev.sections)) s2.push({ path: p + '.sections', reason: '必填对象' })
      else {
        for (const k of SECTION_KEYS) {
          if (!trimAll(ev.sections[k])) s2.push({ path: p + '.sections.' + k, reason: '四段均须非空（§3.7 闸 2）' })
        }
      }
      if (!Array.isArray(ev.members) || ev.members.length === 0) s2.push({ path: p + '.members', reason: '必填且 ≥1 篇来源' })
      else if (ev.members.some((mv) => !trimAll(mv))) s2.push({ path: p + '.members', reason: '每个来源路径都必须非空' })
      if (!trimAll(ev.rationale)) s2.push({ path: p + '.rationale', reason: '必填且非空（为什么这几篇是一件事）' })
      if (!Array.isArray(ev.checkpoints) || ev.checkpoints.length === 0) s2.push({ path: p + '.checkpoints', reason: '至少要有 1 个检查点' })
      else {
        ev.checkpoints.forEach((cp, ci) => {
          const pp = p + '.checkpoints[' + ci + ']'
          if (!trimAll(cp.goal)) s2.push({ path: pp + '.goal', reason: '必填且非空（四段覆盖率 100%）' })
          if (!trimAll(cp.state)) s2.push({ path: pp + '.state', reason: '必填且非空（四段覆盖率 100%）' })
        })
      }
    })
    if (!isNum(selfCheck.events)) s2.push({ path: 'selfCheck.events', reason: '必填（非负整数）' })
    if (!isNum(selfCheck.checkpoints)) s2.push({ path: 'selfCheck.checkpoints', reason: '必填（非负整数）' })
    if (!isNum(selfCheck.coveredLogs)) s2.push({ path: 'selfCheck.coveredLogs', reason: '必填（非负整数）' })
    if (s2.length) return fail('required', s2)

    // ══════════════════ 闸 3 · 溯源真实性（最狠的一道：专挡幻觉引用） ══════════════════
    const s3 = []
    // 两种 deps 形状归一：函数式（exists/readFile）优先；否则用 `files` 内容表（applier 形状）。
    const filesMap = isObj(d.files) ? d.files : null
    const hasMapKey = (rel) => { for (const k of relKeysOf(rel)) { if (Object.prototype.hasOwnProperty.call(filesMap, k)) return true } return false }
    const exists = typeof d.exists === 'function'
      ? d.exists
      : (filesMap ? hasMapKey : null)
    const readFile = typeof d.readFile === 'function'
      ? d.readFile
      : (filesMap
        ? (rel) => { for (const k of relKeysOf(rel)) { if (Object.prototype.hasOwnProperty.call(filesMap, k)) return filesMap[k] } return null }
        : null)
    if (!exists) s3.push({ path: 'deps.exists', reason: '未注入文件存在性检查（deps.exists 或 deps.files）⇒ fail closed，无法验证溯源' })
    if (!readFile) s3.push({ path: 'deps.readFile', reason: '未注入文件读取（deps.readFile 或 deps.files）⇒ fail closed，无法验证 quoteRef' })
    const manifestFiles = filesWhitelistFromDeps(d)
    const readCache = Object.create(null)
    const readRel = (rel) => {
      if (rel in readCache) return readCache[rel]
      let out = null
      try {
        const v = readFile(rel)
        out = typeof v === 'string' ? v : null
        if (out === null) throw new Error('readFile 未返回字符串')
      } catch (e) { out = null }
      readCache[rel] = out
      return out
    }
    const checkRel = (rel, path) => {
      const r = trimAll(rel)
      if (!r) { s3.push({ path: path + '.rel', reason: '必填且非空' }); return false }
      if (manifestFiles && manifestFiles.indexOf(r) < 0) { s3.push({ path, reason: '不在 manifest 文件白名单内' }); return false }
      if (exists) {
        let ok = false
        try { ok = !!exists(r) } catch (e) { ok = false }
        if (!ok) { s3.push({ path, reason: '文件不存在：' + r }); return false }
      }
      return true
    }
    events.forEach((ev, i) => {
      const p = 'events[' + i + ']'
      for (let mi = 0; mi < ev.members.length; mi++) {
        if (!checkRel(ev.members[mi], p + '.members[' + mi + ']')) continue
      }
      ev.checkpoints.forEach((cp, ci) => {
        const pp = p + '.checkpoints[' + ci + ']'
        const relOk = checkRel(cp.rel, pp + '.rel')
        const quote = trimAll(cp.quoteRef)
        if (!quote) { s3.push({ path: pp + '.quoteRef', reason: '必填且非空（无 quoteRef = 无法审计的传闻）' }); return }
        if (!relOk) return
        const content = readRel(trimAll(cp.rel))
        if (content === null) { s3.push({ path: pp + '.rel', reason: '读取失败，无法校验 quoteRef' }); return }
        if (content.indexOf(quote) < 0) {
          s3.push({ path: pp + '.quoteRef', reason: '在该文件中**子串未命中**（幻觉引用）：' + quote.slice(0, 60) })
        }
        if (cp.quoteLine !== undefined && (!(cp.quoteLine >= 1) || Math.floor(cp.quoteLine) !== cp.quoteLine)) {
          s3.push({ path: pp + '.quoteLine', reason: '若给出必须是 ≥1 的整数行号' })
        }
      })
    })
    if (s3.length) return fail('provenance', s3)

    // ══════════════════ 闸 4 · 守恒（草案自检 vs 引擎重算） ══════════════════
    const s4 = []
    const recEvents = events.length
    let recCheckpoints = 0
    const logRels = new Set()
    const isLogRel = typeof d.isLogRel === 'function'
      ? (rel) => { try { return !!d.isLogRel(rel) } catch (e) { return false } }
      : (rel) => DEFAULT_LOG_RE.test(basenameOf(rel))
    for (const ev of events) {
      recCheckpoints += ev.checkpoints.length
      for (const mv of ev.members) if (isLogRel(mv)) logRels.add(basenameOf(mv))
      for (const cp of ev.checkpoints) if (cp.rel && isLogRel(cp.rel)) logRels.add(basenameOf(cp.rel))
    }
    const recCovered = logRels.size
    if (selfCheck.events !== recEvents) s4.push({ path: 'selfCheck.events', reason: '与重算不一致：草案 ' + selfCheck.events + ' / 重算 ' + recEvents })
    if (selfCheck.checkpoints !== recCheckpoints) s4.push({ path: 'selfCheck.checkpoints', reason: '与重算不一致：草案 ' + selfCheck.checkpoints + ' / 重算 ' + recCheckpoints })
    if (selfCheck.coveredLogs !== recCovered) s4.push({ path: 'selfCheck.coveredLogs', reason: '与重算不一致：草案 ' + selfCheck.coveredLogs + ' / 重算 ' + recCovered })
    // 覆盖数口径：members ∪ checkpoints[].rel 里「日志文件」（缺省 basename=YYYY-MM-DD.md）的**去重篇数**。
    //   只算日志、不算 PLAN/账本——覆盖率的分母是日志篇数，混进白板会把 80% 判据稀释成永远达标。
    // 覆盖率：日志总数优先取 deps.logCount（引擎扫盘的真值）；缺省退化为「草案覆盖数」自比
    //   ⇒ 此时比率检查恒 100%、失去防护力，故文件头把 logCount 标为「强烈建议」。
    const totalLogs = isNum(d.logCount) && d.logCount >= 0 ? Math.floor(d.logCount) : recCovered
    if (totalLogs > 0 && (recCovered / totalLogs) < L.coveredLogsRatioMin) {
      s4.push({
        path: 'selfCheck.coveredLogs',
        reason: '覆盖率 ' + Math.round((recCovered / totalLogs) * 100) + '% < ' + Math.round(L.coveredLogsRatioMin * 100) + '%（覆盖 ' + recCovered + ' / 日志 ' + totalLogs + '）',
      })
    }
    if (s4.length) return fail('conservation', s4)

    // ══════════════════ 闸 5 · 形态（碎片率 / 平均来源 / 事件数上界） ══════════════════
    const s5 = []
    if (recEvents < 1) s5.push({ path: 'events', reason: '事件数必须 ≥1' })
    const single = events.filter((ev) => ev.checkpoints.length === 1).length
    const singleRatio = recEvents > 0 ? single / recEvents : 0
    if (singleRatio > L.singleCheckpointRatioMax + 1e-9) {
      s5.push({
        path: 'events',
        reason: '单检查点事件占比 ' + Math.round(singleRatio * 100) + '% > ' + Math.round(L.singleCheckpointRatioMax * 100) + '%（' + single + '/' + recEvents + '；碎片化：把一件事拆成一堆碎片）',
      })
    }
    const avgMembers = recEvents > 0 ? events.reduce((a, ev) => a + ev.members.length, 0) / recEvents : 0
    if (avgMembers < 1) s5.push({ path: 'events', reason: '平均 members ' + avgMembers.toFixed(2) + ' < 1（归组无来源）' })
    const maxEvents = totalLogs * L.eventsPerLogFactor + L.eventsPerLogSlack
    if (recEvents > maxEvents) {
      s5.push({ path: 'events', reason: '事件数 ' + recEvents + ' > 上界 ' + maxEvents + '（日志 ' + totalLogs + ' × 1.5 + 5）' })
    }
    if (s5.length) return fail('shape', s5)

    // ══════════════════ 闸 6 · 去重（草案内 + 与既有事件） ══════════════════
    const s6 = []
    const existingNames = new Set(
      (Array.isArray(d.existingEventNames) ? d.existingEventNames : Array.isArray(d.existingEvents) ? d.existingEvents.map((e) => e && e.name) : [])
        .filter((n) => isStr(n)).map((n) => normName(n)),
    )
    const existingKeys = new Set((Array.isArray(d.existingIdemKeys) ? d.existingIdemKeys : []).filter((k) => isStr(k)).map((k) => trimAll(k)))
    const seenNames = new Set()
    const seenKeys = new Set()
    events.forEach((ev, i) => {
      const p = 'events[' + i + ']'
      const n = normName(ev.name)
      if (seenNames.has(n)) s6.push({ path: p + '.name', reason: '草案内事件名重复：' + trimAll(ev.name) })
      seenNames.add(n)
      if (existingNames.has(n)) s6.push({ path: p + '.name', reason: '与既有事件重名：' + trimAll(ev.name) })
      ev.checkpoints.forEach((cp, ci) => {
        const pp = p + '.checkpoints[' + ci + ']'
        const key = trimAll(cp.idemKey)
        if (!key) return
        if (seenKeys.has(key)) s6.push({ path: pp + '.idemKey', reason: '草案内 idemKey 重复：' + key })
        seenKeys.add(key)
        if (existingKeys.has(key)) s6.push({ path: pp + '.idemKey', reason: '与既有检查点 idemKey 重复：' + key })
      })
    })
    if (s6.length) return fail('dedupe', s6)

    // ══════════════════ 闸 7 · 卫生（乱码/复读/base64/HTML 注入/单条 >2000 字） ══════════════════
    const s7 = []
    events.forEach((ev, i) => {
      const p = 'events[' + i + ']'
      pushHygiene(s7, p + '.name', ev.name)
      pushHygiene(s7, p + '.summary', ev.summary)
      pushHygiene(s7, p + '.rationale', ev.rationale)
      for (const k of SECTION_KEYS) pushHygiene(s7, p + '.sections.' + k, ev.sections[k])
      for (let mi = 0; mi < ev.members.length; mi++) pushHygiene(s7, p + '.members[' + mi + ']', ev.members[mi])
      for (let oi = 0; oi < (ev.outcomes || []).length; oi++) pushHygiene(s7, p + '.outcomes[' + oi + ']', ev.outcomes[oi])
      ev.checkpoints.forEach((cp, ci) => {
        const pp = p + '.checkpoints[' + ci + ']'
        for (const k of ['text', 'goal', 'state', 'dead', 'next', 'quoteRef']) pushHygiene(s7, pp + '.' + k, cp[k])
      })
    })
    if (s7.length) return fail('hygiene', s7)

    return { ok: true }
  } catch (e) {
    // ★绝不 throw（fail closed）：内部异常一律折成 internal，由调用方按「该区失败」处置。
    return fail('internal', [{ path: '$', reason: '校验器内部异常：' + (e && e.message ? String(e.message).slice(0, 200) : 'unknown') }])
  }
}

export default { validateUpgradeDraftPre, UPGRADE_DRAFT_VERSION, UPGRADE_DRAFT_LIMITS }
