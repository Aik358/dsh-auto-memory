/**
 * event-store.js —— v4 事件存储（批次 A 数据层）
 *
 * 设计依据：artifacts/V4-MASTER-PLAN-2026-10-24.md §3.1/§3.4（冻结契约）+ §5.3（批次 A）
 * 契约真源：artifacts/v4-contract/event-schema.json（严格 16 顶层字段）
 * 参照实现：lib/fact-store.js（1,039 行，同族五动作 + 原子写）
 *
 * 五动作：create / set / append / close / rename
 * 硬约束：
 *   ① **append-only 不可撤销** —— checkpoints/constraints 只能加不能改不能删；
 *   ② **原子写** —— tmp → rename（与 facts.json 同范式，断电不留半个文件）；
 *   ③ **idemKey 去重** —— 模型重试同一检查点不得重复追加（append-only 下这是唯一的纠错机会）；
 *   ④ **纯本地 fs**（不 import index.js，避免环形依赖；也不 import DSH 宿主 API）。
 */

import { readFile, writeFile, rename, mkdir, unlink } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { randomBytes } from 'node:crypto'

/** ★2026-10-27 升 v2：新增 10 个事件字段（对齐 prototype wb-event-preview）。读兼容 v1。 */
export const EVENT_STORE_SCHEMA = 'v4_event_store_v2'
/** 可读的旧 schema（读路径需 normalize） */
export const EVENT_STORE_SCHEMA_V1 = 'v4_event_store_v1'
/** 事件 kind 枚举（徽章用） */
export const EVENT_KINDS = Object.freeze(['ledger', 'planSnapshot', 'sessionTranscript', 'project', 'mechanical', 'unknown'])
/** 置信度枚举（徽章用） */
export const EVENT_CONFIDENCES = Object.freeze(['high', 'medium', 'low', 'unknown'])
/** 检查点四段字段名（对齐 prototype：goal/state/dead/next） */
export const CHECKPOINT_QUAD_FIELDS = Object.freeze(['goal', 'state', 'dead', 'next'])
export const EVENT_STORE_FILENAME = 'event-store.json'
/** 六类面板注册表（契约常量；新增类型只需在此注册，不改 event 结构） */
export const PANEL_KINDS = Object.freeze(['state', 'log', 'deadend', 'next', 'userPercept', 'commitment'])
/** stage 五值（2026-10-15 情境化记忆综述 §2.3） */
export const PERCEPT_STAGES = Object.freeze(['retrieved', 'delivered', 'used', 'mentioned', 'accepted'])
export const EVENT_STATUSES = Object.freeze(['active', 'paused', 'closed'])
/** 严格 16 个顶层字段（旧文档称 21，见 MASTER-PLAN §3.1 归因） */
export const EVENT_TOP_FIELDS = Object.freeze([
  'id', 'name', 'summary', 'outcome', 'skillRef', 'status', 'pausedReason',
  'sections', 'checkpoints', 'userPercept', 'agentTrace', 'sharedGround', 'commitments',
  'constraints', 'createdAt', 'updatedAt',
  // ★v2 新增 10 个（对齐 prototype；派生字段 date/start/end/sourceCount 不落盘）
  'startMs', 'endMs', 'members', 'rationale', 'kind', 'confidence', 'outcomes', 'ordinal', 'skills',
  'idemTag',
])

// ============ H4（2026-10-24）：list() 的 percept 投影契约 ============
//
// 背景：list() 原先把事件裁剪成 7 个基础字段（id/name/summary/status/sections/
// updatedAt/checkpointCount），四个 percept 与 checkpoints 正文全丢 ⇒ 前端
// EventView（client.js）拿不到用户记忆，EventCard 永远渲不出来。
//
// 约束：list() 有 6 处调用点（index.js L5606/6545/6869/6923/7089/21547），
//   无条件加字段会改变全部 6 处返回形状 ⇒ **必须可选开关，默认关闭**。
//   默认 false 时输出与改造前**逐字节等价**（key 顺序都不变，见 projectEventForListPre）。

/** 四个 percept 数组各自最多回传最近 N 条（与 renderT2Pre 的 slice(-3) 同族口径，放宽到 5）。 */
export const PERCEPT_LIST_TAIL = 5
/** panelDigest 只从最近 N 个检查点扁平汇总（与 renderT2Pre 的 maxCheckpoints: 3 对齐）。 */
export const PANEL_DIGEST_CHECKPOINT_TAIL = 3

/**
 * 四个 percept 的**契约字段白名单**（逐字对应 MASTER-PLAN §3.1）。
 * 用途：list() 回传时只投影这些字段，未知字段一律丢弃
 * —— 防将来有人往事件条目里塞大对象把 HTTP 响应撑爆（列表是 50 条/页）。
 */
export const PERCEPT_ITEM_FIELDS = Object.freeze({
  userPercept: Object.freeze(['at', 'kind', 'stage', 'text', 'sourceRef']),
  agentTrace: Object.freeze(['at', 'action', 'result', 'wasRefuted', 'sourceRef']),
  sharedGround: Object.freeze(['at', 'claim', 'confirmedBy', 'correction', 'sourceRef']),
  commitments: Object.freeze(['at', 'promise', 'boundary', 'state', 'sourceRef']),
})

const PERCEPT_KEYS_PRE_V1 = Object.freeze(['userPercept', 'agentTrace', 'sharedGround', 'commitments'])

const now0 = () => Date.now()

/** 生成本地 id：evt_ + 8 hex（D2 裁定：不带 pre）。碰撞概率 ~1/4.3e9/次，且落盘前会查重。 */
function newEventIdPre(used) {
  for (let i = 0; i < 32; i++) {
    const id = 'evt_' + randomBytes(4).toString('hex')
    if (!used || !used.has(id)) return id
  }
  throw new Error('event id 生成失败（32 次全部碰撞）')
}

/** 深拷贝（结构化数据，无函数/循环引用；比 JSON 往返更能保留 undefined 语义——这里统一转 null） */
function clone(v) { return v === undefined ? null : JSON.parse(JSON.stringify(v)) }

/** 空事件骨架（严格 16 字段，一个不多一个不少） */
export function emptyEventPre(name, opts = {}) {
  const t = Number(opts.now) || now0()
  return {
    id: opts.id || '',
    name: String(name == null ? '' : name),
    summary: String(opts.summary == null ? '' : opts.summary),
    outcome: null,
    skillRef: null,
    status: 'active',
    pausedReason: null,
    sections: { goal: '', doing: '', deadend: '', next: '' },
    checkpoints: [],
    userPercept: [],
    agentTrace: [],
    sharedGround: [],
    commitments: [],
    constraints: [],
    createdAt: t,
    updatedAt: t,
    // ★v2 新增（默认值与 prototype 语义对齐）
    startMs: 0,
    endMs: 0,
    members: [],          // 归组来源：文件路径数组（prototype 的 right-pane「本事件来源」）
    rationale: '',        // 归组理由：为什么这几篇是一件事（prototype 底部「理由」）
    kind: 'unknown',      // 徽章：ledger / planSnapshot / sessionTranscript / ...
    confidence: 'unknown',// 徽章：high / medium / low / unknown
    outcomes: [],         // 卡片「成果」列表
    ordinal: 0,           // 稳定排序序号（同 startMs 时用它）
    skills: { hitCount: 0, names: [], touched: false },
    idemTag: null,        // 迁移幂等标签（同一批迁移重跑不重复建事件）
  }
}

/** ★v2：把 create/set 的入参里合法的 v2 字段写到事件上（逐字段白名单，不整体浅拷贝） */
function applyV2FieldsPre(ev, src) {
  if (!src || typeof src !== 'object') return
  if (typeof src.startMs === 'number' && Number.isFinite(src.startMs)) ev.startMs = Math.max(0, Math.floor(src.startMs))
  if (typeof src.endMs === 'number' && Number.isFinite(src.endMs)) ev.endMs = Math.max(0, Math.floor(src.endMs))
  if (Array.isArray(src.members)) ev.members = src.members.filter((m) => typeof m === 'string').slice(0, 500)
  if (typeof src.rationale === 'string') ev.rationale = src.rationale.slice(0, 600)
  if (EVENT_KINDS.includes(src.kind)) ev.kind = src.kind
  if (EVENT_CONFIDENCES.includes(src.confidence)) ev.confidence = src.confidence
  if (Array.isArray(src.outcomes)) ev.outcomes = src.outcomes.filter((o) => typeof o === 'string').slice(0, 50)
  if (typeof src.ordinal === 'number' && Number.isFinite(src.ordinal)) ev.ordinal = Math.floor(src.ordinal)
  if (src.skills && typeof src.skills === 'object') ev.skills = Object.assign({ hitCount: 0, names: [], touched: false }, src.skills)
  if (typeof src.idemTag === 'string' || src.idemTag === null) ev.idemTag = src.idemTag
}

/** 校验（fail-closed，供每次写盘前调用）。返回错误码数组，空数组=通过。 */
export function validateEventPre(ev) {
  const bad = []
  if (!ev || typeof ev !== 'object' || Array.isArray(ev)) return ['not-an-object']
  for (const f of EVENT_TOP_FIELDS) if (!Object.prototype.hasOwnProperty.call(ev, f)) bad.push('missing:' + f)
  for (const f of Object.keys(ev)) if (!EVENT_TOP_FIELDS.includes(f)) bad.push('unknown:' + f)
  if (!/^evt_[0-9a-f]{8}$/.test(String(ev.id || ''))) bad.push('bad-id')
  if (!String(ev.name || '').trim()) bad.push('empty-name')
  if (String(ev.name || '').length > 80) bad.push('name-too-long')
  if (String(ev.summary || '').length > 400) bad.push('summary-too-long')
  if (!EVENT_STATUSES.includes(ev.status)) bad.push('bad-status')
  if (ev.status === 'closed' && !(typeof ev.outcome === 'string' && ev.outcome.trim())) bad.push('closed-needs-outcome')
  if (ev.status === 'paused' && !(typeof ev.pausedReason === 'string' && ev.pausedReason.trim())) bad.push('paused-needs-reason')
  if (ev.status === 'active' && ev.pausedReason !== null) bad.push('active-pausedReason-must-be-null')
  const sec = ev.sections
  if (!sec || typeof sec !== 'object') bad.push('bad-sections')
  else for (const k of ['goal', 'doing', 'deadend', 'next']) if (typeof sec[k] !== 'string') bad.push('sections.' + k)
  const arrays = ['checkpoints', 'userPercept', 'agentTrace', 'sharedGround', 'commitments', 'constraints']
  for (const a of arrays) if (!Array.isArray(ev[a])) bad.push('not-array:' + a)
  if (Array.isArray(ev.checkpoints)) {
    const keys = []
    for (const c of ev.checkpoints) {
      if (!c || typeof c !== 'object') { bad.push('bad-checkpoint'); continue }
      for (const k of ['at', 'kind', 'text']) if (!(k in c)) bad.push('checkpoint-missing:' + k)
      if (typeof c.at !== 'number') bad.push('checkpoint.at-not-number')
      if (Array.isArray(c.panels)) for (const pn of c.panels) if (!pn || !PANEL_KINDS.includes(pn.kind)) bad.push('bad-panel-kind:' + (pn && pn.kind))
      if (c.idemKey) keys.push(c.idemKey)
    }
    if (new Set(keys).size !== keys.length) bad.push('duplicate-idemKey')
  }
  if (Array.isArray(ev.userPercept)) for (const u of ev.userPercept) if (!u || !PERCEPT_STAGES.includes(u.stage)) bad.push('bad-stage:' + (u && u.stage))
  // ★v2 新字段校验（fail-closed）
  if (typeof ev.startMs !== 'number' || !Number.isFinite(ev.startMs) || ev.startMs < 0) bad.push('bad-startMs')
  if (typeof ev.endMs !== 'number' || !Number.isFinite(ev.endMs) || ev.endMs < 0) bad.push('bad-endMs')
  if (ev.startMs > 0 && ev.endMs > 0 && ev.startMs > ev.endMs) bad.push('startMs-gt-endMs')
  if (!Array.isArray(ev.members)) bad.push('members-not-array')
  else { if (ev.members.length > 500) bad.push('members-too-many'); for (const m of ev.members) if (typeof m !== 'string') bad.push('members-not-string'); }
  if (typeof ev.rationale !== 'string') bad.push('bad-rationale')
  else if (ev.rationale.length > 600) bad.push('rationale-too-long')
  if (!EVENT_KINDS.includes(ev.kind)) bad.push('bad-kind:' + ev.kind)
  if (!EVENT_CONFIDENCES.includes(ev.confidence)) bad.push('bad-confidence:' + ev.confidence)
  if (!Array.isArray(ev.outcomes)) bad.push('outcomes-not-array')
  else { if (ev.outcomes.length > 50) bad.push('outcomes-too-many'); for (const o of ev.outcomes) if (typeof o !== 'string') bad.push('outcomes-not-string'); }
  if (typeof ev.ordinal !== 'number' || !Number.isFinite(ev.ordinal)) bad.push('bad-ordinal')
  if (!ev.skills || typeof ev.skills !== 'object' || Array.isArray(ev.skills)) bad.push('bad-skills')
  if (ev.idemTag !== null && typeof ev.idemTag !== 'string') bad.push('bad-idemTag')
  return bad
}

/**
 * ★v2（2026-10-27）：把任意版本的事件补成 26 字段（v1 → v2）。
 * 读路径唯一入口 —— 旧事件不强制迁移，读时补默认值即可。
 * 不修改入参（返回新对象）。
 */
export function normalizeEventPre(ev) {
  if (!ev || typeof ev !== 'object') return ev
  const out = Object.assign({}, ev)
  if (typeof out.startMs !== 'number') out.startMs = 0
  if (typeof out.endMs !== 'number') out.endMs = 0
  if (!Array.isArray(out.members)) out.members = []
  if (typeof out.rationale !== 'string') out.rationale = ''
  if (!EVENT_KINDS.includes(out.kind)) out.kind = 'unknown'
  if (!EVENT_CONFIDENCES.includes(out.confidence)) out.confidence = 'unknown'
  if (!Array.isArray(out.outcomes)) out.outcomes = []
  if (typeof out.ordinal !== 'number') out.ordinal = 0
  if (!out.skills || typeof out.skills !== 'object') out.skills = { hitCount: 0, names: [], touched: false }
  if (out.idemTag === undefined) out.idemTag = null
  return out
}

/** 读 store（不存在 ⇒ 空骨架；损坏 ⇒ 抛错，由调用方决定是否自愈——不静默吞） */
export async function readStorePre(storePath) {
  if (!existsSync(storePath)) return { schema: EVENT_STORE_SCHEMA, events: [], updatedAt: 0 }
  const raw = await readFile(storePath, 'utf8')
  const parsed = JSON.parse(raw)
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.events)) throw new Error('event-store 结构非法: ' + storePath)
  return parsed
}

/** 原子写：tmp → rename。rename 同分区原子；tmp 名带 pid+随机，防并发互踩。 */
export async function writeStorePre(storePath, store) {
  const dir = path.dirname(storePath)
  await mkdir(dir, { recursive: true })
  const tmp = path.join(dir, '.event-store.' + process.pid + '.' + randomBytes(4).toString('hex') + '.tmp')
  const body = JSON.stringify(Object.assign({}, store, { schema: EVENT_STORE_SCHEMA, updatedAt: (store && store.updatedAt) || now0() }), null, 2)
  try {
    await writeFile(tmp, body, 'utf8')
    await rename(tmp, storePath)
  } catch (e) {
    try { await unlink(tmp) } catch (_) {}
    throw e
  }
}

// ══════════════════════════════════════════════════════════════════════════════════
// ★★v5-P5（2026-10-26 §2.5）：**事件写路径串行化**
//
//   缺陷（本仓 §2.5 记录）：`mutatePre` 是**裸 read-modify-write** ——
//     readStorePre（await）→ mutator → writeStorePre（await），中间没有任何互斥。
//   两个并发 append 会这样交错：
//     A: read(5 个检查点) ──────────────> A: write(6 个)   ← 用 5 做基线
//     B:    read(5 个) → B: write(6 个)                    ← 也用 5 做基线
//   结果：两次 append 只留下 1 个检查点（丢写）。
//
//   ★为什么是**按 storePath 分键**而不是全局单链：
//     全局链会让「A 工作区的写」阻塞「B 工作区的写」——两个文件毫无关系。
//     按路径分键后，只有同一文件的并发才排队（那正是需要互斥的范围）。
//
//   ★为什么在模块级而不是实例级：
//     `mutatePre` 是模块私有函数，被 `eventStorePre.append/update/create/...` 调用；
//     模块级 Map 能覆盖**所有**入口，且不依赖调用方持有 engine 实例。
//     （对比 `_configSaveChain` 是引擎实例级 —— 因为 saveConfig 是类方法。）
//
//   ★失败语义：链上某个事务抛错**不能**污染后续事务。
//     做法：`pending.then(run, run)`（成功/失败都继续跑）+ 存一个**吞掉错误**的尾链。
//     这与 `_configSaveChain` 的三行模式逐字同构。
//
//   ★跨进程：本链只保证**单进程内**串行。多进程共享同一 DSH_HOME 时仍需文件锁 ——
//     那是 D 批范围（见文件头既有注释），本次不做，但**不假装做到了**。
// ══════════════════════════════════════════════════════════════════════════════════
/** storePath → 该文件的串行链尾（Promise）。只在模块级存在，随进程生命周期。 */
const _storeWriteChains = new Map()

/**
 * 把一次事务排到该 storePath 的串行链尾。
 * @param {string} storePath 事件库文件路径（串行键）
 * @param {() => Promise<any>} run 事务体
 * @returns {Promise<any>} 该事务自身的完成/失败（调用方照常 try/catch）
 */
function withStoreChainPre(storePath, run) {
  const key = String(storePath || "")
  const prev = _storeWriteChains.get(key) || Promise.resolve()
  // ★整段包在 try 里：run 若同步抛错，也必须返回 rejected Promise（不能同步炸出链外）
  const pending = prev.then(
    () => { try { return Promise.resolve(run()) } catch (e) { return Promise.reject(e) } },
    () => { try { return Promise.resolve(run()) } catch (e) { return Promise.reject(e) } },
  )
  // 尾链**吞掉错误**：只用于「下一个事务等它结束」，不用于传播结果
  const tail = pending.then(() => undefined, () => undefined)
  _storeWriteChains.set(key, tail)
  // ★★清理（v5-P5 修 · 这是本套件 F-1 抓出的**真 bug**）：
  //   必须拿**自己的 tail 引用**去比对，落定后若 Map 里还是它（没有后来者排上来）才删。
  //   ⚠️ 旧写法判的是 `get(key) === undefined` —— 那**永远不成立**（刚 set 进去的值不可能
  //     同时是 undefined）⇒ 链永不清理 ⇒ Map 随活跃 storePath 数量无限增长（内存泄漏）。
  //     这不是「为了过测试」，是真缺陷：长期运行 + 多工作区会让 Map 只增不减。
  const dropIfSelf = () => { if (_storeWriteChains.get(key) === tail) _storeWriteChains.delete(key) }
  tail.then(dropIfSelf, dropIfSelf)
  return pending
}

/**
 * ★v5-P5：**给同族模块（event-write.js）复用的持链入口**。
 *
 * 为什么必须复用同一条链（不能各建一条）：
 *   `createEventForWorkPre`（event-write）与 `eventStorePre.append`（event-store）
 *   写的是**同一个文件**。若各自维护串行链 ⇒ 两条链互不等待 ⇒ 仍然交错丢写。
 *   ⇒ 串行键必须**按 storePath 全局唯一**，所以只在本模块维护一份 Map，对外导出入口。
 *
 * @param {string} storePath 串行键
 * @param {() => Promise<any>} run 事务体（内部自己 read → 改 → write）
 */
export function withEventStoreLockPre(storePath, run) { return withStoreChainPre(storePath, run) }

/**
 * ★测试/诊断用：当前有多少条活跃串行链（导入而非读取私有 Map）。
 * 仅用于套件断言「链被清理，无泄漏」。
 */
export function activeStoreChainCountPre() { return _storeWriteChains.size }

/**
 * 载入 → 交给 mutator 改 → 校验 → 原子写。返回 mutator 的返回值。
 *
 * ★v5-P5：**按 storePath 串行**（同一文件的并发写排队，不同文件互不阻塞）。
 *   跨进程锁仍属 D 批。
 */
async function mutatePre(storePath, mutator) {
  return withStoreChainPre(storePath, () => mutateUnlockedPre(storePath, mutator))
}

/**
 * 真正的读改写事务体（**调用方必须已持链**）。
 * 拆出来是为了让「串行」与「事务」两件事各自可读、可单独审计。
 */
async function mutateUnlockedPre(storePath, mutator) {
  const store = await readStorePre(storePath)
  const ret = await mutator(store)
  const evs = store.events || []
  const ids = new Set()
  for (const ev of evs) {
    const bad = validateEventPre(ev)
    if (bad.length) throw new Error('事件写入前校验失败(' + ev.id + '): ' + bad.join(','))
    if (ids.has(ev.id)) throw new Error('事件 id 重复: ' + ev.id)
    ids.add(ev.id)
  }
  store.updatedAt = now0()
  await writeStorePre(storePath, store)
  return ret
}

// ============ H4：list() 的三段投影（纯函数，零 IO） ============

/**
 * 四个 percept 数组的安全裁剪：取最近 max 条 + 只投影白名单字段。
 *
 * 两条纪律：
 *   ① **按契约字段白名单投影**，未知字段丢弃 —— 防将来往条目里塞大对象撑爆 HTTP 响应；
 *   ② 非对象/空条目**跳过**而非抛错 —— list 是读路径，脏数据不该让整个列表 500。
 *
 * @param {unknown} arr 事件上的原数组
 * @param {readonly string[]} fields 契约字段
 * @param {number} max 最多回传条数
 * @returns {Array<object>}
 */
function tailItemsPre(arr, fields, max) {
  if (!Array.isArray(arr) || !arr.length) return []
  const n = Math.max(1, Math.floor(Number(max) || PERCEPT_LIST_TAIL))
  const out = []
  for (const item of arr.slice(-n)) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const one = {}
    for (const f of fields) one[f] = item[f] === undefined ? null : item[f]
    out.push(one)
  }
  return out
}

/**
 * 从**最近 N 个检查点**的 panels 扁平汇总成 [{kind, text}]。
 *
 * 为什么只取最近 N 个而不是全部：与注入侧 renderT2Pre 的 maxCheckpoints: 3 同口径
 * （列表是 50 条/页，全量扁平会让响应体积随检查点数线性膨胀）。
 * 只保留 kind+text：at / sourceRef / idemKey 在这里没有消费方。
 */
function panelDigestPre(checkpoints, max) {
  if (!Array.isArray(checkpoints) || !checkpoints.length) return []
  const n = Math.max(1, Math.floor(Number(max) || PANEL_DIGEST_CHECKPOINT_TAIL))
  const out = []
  for (const c of checkpoints.slice(-n)) {
    if (!c || typeof c !== 'object') continue
    const panels = Array.isArray(c.panels) ? c.panels : []
    for (const pn of panels) {
      if (!pn || typeof pn !== 'object') continue
      out.push({ kind: String(pn.kind == null ? 'log' : pn.kind), text: String(pn.text == null ? '' : pn.text) })
    }
  }
  return out
}

/**
 * list() 的单条事件投影 —— **两个分支（all / 分页）共用同一实现**。
 *
 * 向后兼容契约（最硬的一条）：withPercept !== true 时返回的对象
 * **key 顺序与改造前逐字一致**（id,name,summary,status,sections,updatedAt,checkpointCount），
 * 套件用 deepEqual + Object.keys 顺序双断言。
 *
 * withPercept === true 时**在末尾追加**（不改动已有 key 的位置，前端按 key 取值不受影响）：
 *   userPercept / agentTrace / sharedGround / commitments（各最近 5 条，白名单字段）
 *   panelDigest（最近 3 个检查点的 panels 扁平成 [{kind,text}]）
 *
 * ⚠️ 刻意**不返回完整 checkpoints**：正文走 /event-detail（点开单个事件时才拉）。
 */
function projectEventForListPre(e, withPercept, withTime, withKind, withMembers, withMeta, withCheckpointQuad) {
  const base = {
    id: e.id,
    name: e.name,
    summary: e.summary,
    status: e.status,
    sections: e.sections,
    updatedAt: e.updatedAt,
    checkpointCount: Array.isArray(e.checkpoints) ? e.checkpoints.length : 0,
  }
  // ★★2026-10-26（用户实报「白板时间显示 1970 年」· 真机+真数据双证）：
  //   白板前端算事件起止时间用 cps.length ? cps[0].ms : Number(ev.createdAt)，
  //   而本投影既不给 checkpoints 也不给 createdAt ⇒ NaN ⇒ 回落 0 ⇒ 1970-01-01 08:00。
  //
  //   ⚠️ 第一版修法（已回退）：在本投影末尾追加 createdAt —— 错的。
  //     本函数有「key 顺序逐字一致 + deepEqual + 恰好 7 key」硬契约（见上方向后兼容声明），
  //     追加第 8 个 key 直接打红 v4-h4-eventstore-percept 的 3 条断言。既有套件判得对，是修法错。
  //   ⇒ 最终修法：不动本投影，改在消费侧（ev4-adapter.adaptEventPre）用 list() 已返回的
  //     updatedAt 做多级兜底。updatedAt >= createdAt，但作为「事件大致时间」远优于伪造 1970，
  //     且零契约破坏、零额外 IO。判据由 smoke-test-wb-time-and-drawer A-3/A-5 守（真调 list() → 端到端）。
  // ★★2026-10-27 修（真缺陷 · 泳道甘特从 1970 起 / 时间线全挤迁移日）：
  //   根因：本投影不发时间字段（只有 updatedAt），而前端算时间轴有两条路：
  //     ① EV4 运行时 timeScale() 只读 items[i].checkpoints[j].ms ⇒ 列表态无 checkpoints
  //        ⇒ min=Infinity ⇒ 回落 min=0,max=1 ⇒ 1970-01-01（用户实报「从 1 月 1 号开始」）。
  //     ② eventSpanOfPre 旧实现只读 createdAt/updatedAt；迁移后 createdAt 全是迁移时刻
  //        ⇒ 所有事件挤同一天（用户实报「从 10 月 27 号开始」）。
  //   为什么不在 base 里直接加 key：本函数有「key 顺序逐字一致 + 恰好 7 key」硬契约
  //   （v4-h4-eventstore-percept N-3 三条断言钉死），加第 8 个 key 会打红。
  //   修法：**与 withPercept 同款的独立可选开关 withTime**（默认 false ⇒ 输出逐字节等价），
  //   只在前端 event-list 这条路开启。时间取 startMs/endMs（业务时间），缺失回落
  //   createdAt/updatedAt（记录时间），**绝不伪造 0**。
  if (withTime === true) {
    const _s = Number(e.startMs) || 0
    const _e = Number(e.endMs) || 0
    base.startMs = _s > 0 ? _s : (Number(e.createdAt) || Number(e.updatedAt) || 0)
    base.endMs = _e > 0 ? _e : (Number(e.updatedAt) || _s || 0)
  }
  // ★★2026-10-27 修（真缺陷 · 泳道/甘特 & 工作流线索两个视图恒显示「0 个事件」）：
  //   根因（本家族第 3 次）：EV4 运行时 `renderLanes` / `renderWorkflow` 都用
  //     `EV.filter(function (e) { return e.kind === "ledger"; })` 取数据，
  //   而本投影的 7 键**不含 kind** ⇒ 前端每个事件 kind 都是 undefined ⇒ 过滤后恒空。
  //   实测：磁盘 10 事件 kind 全为 `ledger`、时间流视图正常显示 10 个，唯独两个视图 0 个。
  //   修法：与 withTime 同款**独立可选开关 withKind**（默认 false ⇒ 输出逐字节等价，
  //   不破坏「恰好 7 key」硬契约），只在前端 event-list 这条路上开启。
  if (withKind === true) base.kind = String(e.kind || 'ledger')
  // ★★2026-10-27 修（本家族第 4 处 · 用户实测「本事件来源 · 0 篇原始账本」）：
  //   EV4 运行时 `renderDetail` 用 `ev.members.length` 渲染「本事件来源 · N 篇原始账本」，
  //   而本投影 7 键不含 `members` ⇒ 前端 `arrPre(undefined)` = [] ⇒ 恒显示 0 篇。
  //   与 withKind 同款独立开关，默认 false ⇒ 输出逐字节等价（7 键契约不破）。
  if (withMembers === true) base.members = Array.isArray(e.members) ? e.members.slice(0, 50) : []
  // ★★2026-10-27 修（本家族第 5 处 · 用户实报「全部显示中置信 / 理由段串味」）：
  //   EV4 运行时 renderDetail 读 ev.confidence（badge）与 ev.rationale（理由段），
  //   而本投影 7 键**既不 contains confidence 也不含 rationale / outcomes** ⇒
  //     · confidence 缺失 ⇒ normConfPre 回落 ⇒ 全部事件显示「中置信」（磁盘实际全 high）
  //     · rationale 缺失 ⇒ 适配层回落 sections.deadend ⇒ 理由段显示成「失败与弯路」正文
  //   与 withTime / withKind / withMembers **同款独立开关**（默认 false ⇒ 输出逐字节等价，
  //   「恰好 7 key + key 顺序逐字一致」硬契约不破，5 处既有调用点行为零变化）。
  //   ★体积代价实测：单事件 +106 B（confidence+rationale+outcomes 全带），10 事件 +1 KB ⇒ 可忽略。
  //   ★为什么合并成一个 withMeta 而不是再拆三个开关：三者是同一个「详情面包」语义，
  //     再拆会让 7 个开关的组合空间失控；且没有任何调用点只要其中之一。
  if (withMeta === true) {
    base.confidence = String(e.confidence || 'unknown')
    base.rationale = String(e.rationale || '')
    base.outcomes = Array.isArray(e.outcomes) ? e.outcomes.slice(0, 50) : []
  }
  // ★★2026-10-27 修（真缺陷 · 本家族第 6 处 · 用户实报「检查点展开全是空壳」）：
  //   D7/D8/I8/I9/D5/D6 六个症状的**唯一根因**：列表态只有 checkpointCount、没有正文，
  //   适配层据此造等长空对象占位 ⇒ 时间空、来源空、panels=[] ⇒ 箭头能翻但内容空白。
  //   ★三条方案实测对比（真实 311 检查点数据）：
  //     · 方案A 全量真检查点      payload 105→1363 KB (+1199%)，srcDoc 196→933 KB  ✗ 太重
  //     · 方案B 选中事件合并 detail  payload 105→960 KB (+805%)，且需 iframe↔React 通信 ✗
  //     · 方案C 四段精简（本条）    payload 105→311 KB (+196%)，srcDoc 196→~510 KB  ✓
  //   ⇒ 选 C。**依据**：原型自身的 payload 就带完整检查点（185 事件/839 点/1.8 MB 单文件），
  //     「列表只给计数、正文另拉」是本产品引入的架构，不是原型契约；白板要 1:1 照搬原型就得给正文。
  //   ★只带渲染真正消费的 6 个字段（at=毫秒 + sourceRef + 四段），**不带 text**（974 KB，占大头）
  //     也不带 panels（163 KB）—— 四段由 adaptCheckpointPre 合成 panels，与原型同款。
  //   ★键名用 checkpointQuad 而非 checkpoints：后者是 /event-detail 的独占字段，
  //     复用会破坏「列表态无正文」的既有契约与 8 处调用点的前置假设。
  if (withCheckpointQuad === true) {
    const _cps = Array.isArray(e.checkpoints) ? e.checkpoints : []
    base.checkpointQuad = _cps.map((c) => {
      const q = c || {}
      const at = Number(q.at)
      return {
        at: isFinite(at) && at > 0 ? at : 0,
        sourceRef: String(q.sourceRef || ''),
        goal: String(q.goal || ''),
        state: String(q.state || ''),
        dead: String(q.dead || ''),
        next: String(q.next || ''),
      }
    })
  }
  if (withPercept !== true) return base
  for (const key of PERCEPT_KEYS_PRE_V1) base[key] = tailItemsPre(e[key], PERCEPT_ITEM_FIELDS[key], PERCEPT_LIST_TAIL)
  base.panelDigest = panelDigestPre(e.checkpoints, PANEL_DIGEST_CHECKPOINT_TAIL)
  return base
}

export const eventStorePre = Object.freeze({
  /** ① create：name 空 ⇒ 报错；同 id 已存在 ⇒ 报错 */
  async create(storePath, opts = {}) {
    const { name, summary, sections, constraints, skillRef } = opts || {}
    if (!String(name == null ? '' : name).trim()) throw new Error('createEvent: name 不能为空')
    return mutatePre(storePath, (store) => {
      const used = new Set(store.events.map((e) => e.id))
      const ev = emptyEventPre(name, { id: newEventIdPre(used), summary })
      if (sections && typeof sections === 'object') for (const k of ['goal', 'doing', 'deadend', 'next']) if (typeof sections[k] === 'string') ev.sections[k] = sections[k]
      if (Array.isArray(constraints)) ev.constraints = constraints.slice()
      if (skillRef != null) ev.skillRef = String(skillRef)
      // ★v2：透传 10 个新字段（非法值留给 validate 抛错，不在这里静默吞）
      applyV2FieldsPre(ev, opts)
      store.events.push(ev)
      return clone(ev)
    })
  },

  /** ② set：改可变字段（name/summary/outcome/skillRef/status/pausedReason/sections），updatedAt 必变；非法字段 ⇒ 报错 */
  async set(storePath, id, patch = {}) {
    const ALLOWED = ['name', 'summary', 'outcome', 'skillRef', 'status', 'pausedReason', 'sections',
      // ★v2 新增可改字段（ordinal/idemTag 属内部，不允许外部改）
      'startMs', 'endMs', 'members', 'rationale', 'kind', 'confidence', 'outcomes', 'skills']
    const keys = Object.keys(patch || {})
    if (!keys.length) throw new Error('setEvent: patch 不能为空')
    for (const k of keys) if (!ALLOWED.includes(k)) throw new Error('setEvent: 非法字段 ' + k + '（允许：' + ALLOWED.join(',') + '）')
    return mutatePre(storePath, (store) => {
      const ev = store.events.find((e) => e.id === id)
      if (!ev) throw new Error('setEvent: 事件不存在 ' + id)
      for (const k of keys) {
        if (k === 'sections') {
          const s = patch.sections || {}
          for (const sk of Object.keys(s)) {
            if (!['goal', 'doing', 'deadend', 'next'].includes(sk)) throw new Error('setEvent: 非法 section ' + sk)
            ev.sections[sk] = String(s[sk] == null ? '' : s[sk])
          }
        } else if (k === 'name') {
          if (!String(patch.name == null ? '' : patch.name).trim()) throw new Error('setEvent: name 不能为空')
          ev.name = String(patch.name)
        } else if (['startMs','endMs','members','rationale','kind','confidence','outcomes','skills'].includes(k)) {
          applyV2FieldsPre(ev, { [k]: patch[k] })
        } else {
          ev[k] = patch[k] === undefined ? null : patch[k]
        }
      }
      ev.updatedAt = now0()
      return clone(ev)
    })
  },

  /** ③ append：仅允许追加 checkpoints / constraints / 四个只增数组；closed 事件禁止追加；idemKey 命中 ⇒ 不重复加（返回 {deduped:true}） */
  async append(storePath, id, { checkpoint, constraint, userPercept, agentTrace, sharedGround, commitment } = {}) {
    return mutatePre(storePath, (store) => {
      const ev = store.events.find((e) => e.id === id)
      if (!ev) throw new Error('appendEvent: 事件不存在 ' + id)
      if (ev.status === 'closed') throw new Error('appendEvent: 事件已 closed，append-only 不可撤销但也不可再生')
      let appended = 0, deduped = false
      if (checkpoint) {
        const c = checkpoint
        const key = c.idemKey == null ? null : String(c.idemKey)
        if (key && ev.checkpoints.some((x) => x.idemKey === key)) deduped = true
        else {
          const cp = {
            at: Number(c.at) || now0(),
            kind: String(c.kind == null ? 'log' : c.kind),
            text: String(c.text == null ? '' : c.text),
            sourceRef: c.sourceRef == null ? null : String(c.sourceRef),
            panels: Array.isArray(c.panels) ? c.panels.map((p) => ({ kind: String(p.kind), text: String(p.text == null ? '' : p.text) })) : [],
            idemKey: key,
          }
          // ★v2：检查点四段（对齐 prototype 详情页「现状 / LOG / 下一步 / 失败」五栏）
          for (const qk of CHECKPOINT_QUAD_FIELDS) cp[qk] = String(c[qk] == null ? '' : c[qk]).slice(0, 4000)
          // ★v2：溯源字段（指回源文件具体行 + 文件指纹，证明没丢）
          if (c.quoteRef != null) cp.quoteRef = String(c.quoteRef).slice(0, 4000)
          if (Number.isFinite(Number(c.quoteLine)) && Number(c.quoteLine) > 0) cp.quoteLine = Math.floor(Number(c.quoteLine))
          if (c.rel != null) cp.rel = String(c.rel)
          if (Number.isFinite(Number(c.bytes)) && Number(c.bytes) >= 0) cp.bytes = Math.floor(Number(c.bytes))
          if (c.sha256 != null) cp.sha256 = String(c.sha256)
          if (c.date != null) cp.date = String(c.date)
          if (c.time != null) cp.time = String(c.time)
          if (c.userPercept != null) cp.userPercept = clone(c.userPercept)
          if (c.commitments != null) cp.commitments = clone(c.commitments)
          for (const pn of cp.panels) if (!PANEL_KINDS.includes(pn.kind)) throw new Error('appendEvent: 未注册的 panel kind ' + pn.kind)
          ev.checkpoints.push(cp); appended++
        }
      }
      // ★v2：检查点落盘后自动扩展事件时间跨度（免调用方手工维护 startMs/endMs）
      if (appended > 0 && Array.isArray(ev.checkpoints) && ev.checkpoints.length) {
        const ats = ev.checkpoints.map((x) => Number(x.at) || 0).filter((x) => x > 0)
        if (ats.length) {
          const lo = Math.min.apply(null, ats), hi = Math.max.apply(null, ats)
          if (!(ev.startMs > 0) || lo < ev.startMs) ev.startMs = lo
          if (!(ev.endMs > 0) || hi > ev.endMs) ev.endMs = hi
        }
      }
      if (constraint != null) { const s = String(constraint); if (!ev.constraints.includes(s)) { ev.constraints.push(s); appended++ } }
      const pushOne = (field, item, mapper) => {
        if (!item) return
        ev[field].push(mapper(item)); appended++
      }
      pushOne('userPercept', userPercept, (u) => { const st = String(u.stage == null ? 'mentioned' : u.stage); if (!PERCEPT_STAGES.includes(st)) throw new Error('appendEvent: 非法 stage ' + st); return { at: Number(u.at) || now0(), kind: String(u.kind == null ? '' : u.kind), stage: st, text: String(u.text == null ? '' : u.text), sourceRef: u.sourceRef == null ? null : String(u.sourceRef) } })
      pushOne('agentTrace', agentTrace, (a) => ({ at: Number(a.at) || now0(), action: String(a.action == null ? '' : a.action), result: a.result == null ? null : String(a.result), wasRefuted: a.wasRefuted === true, sourceRef: a.sourceRef == null ? null : String(a.sourceRef) }))
      pushOne('sharedGround', sharedGround, (g) => ({ at: Number(g.at) || now0(), claim: String(g.claim == null ? '' : g.claim), confirmedBy: g.confirmedBy == null ? null : String(g.confirmedBy), correction: g.correction == null ? null : String(g.correction), sourceRef: g.sourceRef == null ? null : String(g.sourceRef) }))
      pushOne('commitments', commitment, (c) => ({ at: Number(c.at) || now0(), promise: String(c.promise == null ? '' : c.promise), boundary: c.boundary == null ? null : String(c.boundary), state: String(c.state == null ? 'open' : c.state), sourceRef: c.sourceRef == null ? null : String(c.sourceRef) }))
      if (!appended && !deduped) throw new Error('appendEvent: 没有任何可追加的内容')
      if (appended) ev.updatedAt = now0()
      return { ok: true, appended, deduped, checkpointCount: ev.checkpoints.length, updatedAt: ev.updatedAt }
    })
  },

  /** ④ close：缺 outcome ⇒ 报错；幂等（已 closed ⇒ 返回原样，不报错） */
  async close(storePath, id, outcome) {
    if (!String(outcome == null ? '' : outcome).trim()) throw new Error('closeEvent: 缺 outcome')
    return mutatePre(storePath, (store) => {
      const ev = store.events.find((e) => e.id === id)
      if (!ev) throw new Error('closeEvent: 事件不存在 ' + id)
      if (ev.status === 'closed') return { ok: true, alreadyClosed: true, event: clone(ev) }
      ev.status = 'closed'
      ev.outcome = String(outcome)
      ev.pausedReason = null
      ev.updatedAt = now0()
      return { ok: true, alreadyClosed: false, event: clone(ev) }
    })
  },

  /** ⑤ rename：空名 ⇒ 报错；id 不变（用户要的是「改标题」而不是「换容器」） */
  async rename(storePath, id, newName) {
    if (!String(newName == null ? '' : newName).trim()) throw new Error('renameEvent: 新名称不能为空')
    if (String(newName).length > 80) throw new Error('renameEvent: 新名称超过 80 字')
    return mutatePre(storePath, (store) => {
      const ev = store.events.find((e) => e.id === id)
      if (!ev) throw new Error('renameEvent: 事件不存在 ' + id)
      const beforeId = ev.id
      ev.name = String(newName)
      ev.updatedAt = now0()
      if (ev.id !== beforeId) throw new Error('renameEvent: id 不得变化')
      return { ok: true, id: ev.id, name: ev.name }
    })
  },

  /**
   * 列表（F 线三视图用）：默认 50/页；all=true 返回精简字段（不含 checkpoints 正文）。
   *
   * ★H4（2026-10-24）：新增 `withPercept` 开关，**默认 false**。
   *   - false（默认）：输出与改造前**逐字等价** ⇒ 5 处既有调用点（含接续/指纹/未归档扫描）行为零变化；
   *   - true：额外回传四个 percept（各最近 5 条）+ panelDigest（最近 3 检查点的 panels）。
   *   两个分支（all / 分页）**共用 projectEventForListPre** ⇒ 结构上不可能只改一半。
   *
   * 为什么需要这个开关：list() 有 6 处调用点，其中 5 处只消费 checkpointCount/updatedAt，
   *   无条件加字段会改变它们全部返回形状（且白传体积）。
   */
  async list(storePath, { cursor = 0, limit = 50, all = false, status = null, withPercept = false, withTime = false, withKind = false, withMembers = false, withMeta = false, withCheckpointQuad = false } = {}) {
    const store = await readStorePathSafe(storePath)
    let evs = store.events.slice()
    if (status) evs = evs.filter((e) => e.status === status)
    evs.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    const total = evs.length
    if (all) {
      return { ok: true, total, events: evs.map((e) => projectEventForListPre(e, withPercept, withTime, withKind, withMembers, withMeta, withCheckpointQuad)), nextCursor: null }
    }
    const cap = Math.max(1, Math.min(200, Number(limit) || 50))
    const from = Math.max(0, Number(cursor) || 0)
    const page = evs.slice(from, from + cap)
    return { ok: true, total, events: page.map((e) => projectEventForListPre(e, withPercept, withTime, withKind, withMembers, withMeta, withCheckpointQuad)), nextCursor: from + page.length < total ? from + page.length : null }
  },

  /** 详情：单事件全文（点开时才拉 checkpoints 正文） */
  async detail(storePath, id) {
    const store = await readStorePathSafe(storePath)
    const ev = store.events.find((e) => e.id === id)
    if (!ev) return { ok: false, error: 'event-not-found', id }
    return { ok: true, event: clone(ev) }
  },
})

/** list/detail 用：store 不存在 ⇒ 空；损坏 ⇒ 抛出（与 readStorePre 同口径，不在这里静默吞） */
async function readStorePathSafe(storePath) { return readStorePre(storePath) }

export default eventStorePre