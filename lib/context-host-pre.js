/**
 * M5-3 Context Bridge Host Wiring(docs/M5-CONTRACT.md §12 M5-3)。
 * 桥接 lib/index.js(M2 SessionRuntime/事件流)与 M5-1 纯核心+M5-2 Store:
 *   - per-runtime state(WeakMap,lazy;enableEpoch/lastPushedContextVersion/inflight)
 *   - accepted Segment → 组装 ContextPushEnvelopePre(trigger/window/memoryRefs/aggregates)
 *     → Null/Fake sink(按 config.contextSinkMode 切换)→ push bridge(幂等/latest-wins/abort)
 *   - read coverage/cite/correction → AccessEvidencePre → EvidenceEventStore(隐私投影落盘)
 *   - memoryRefs 选择复用 M4 lexical_pre_v2 可解释基线与 m4-corpus 授权校验链;
 *     M4 Shadow audit 候选绝不追认为 seen/read(本模块不读 shadow audit,结构隔离)。
 * 默认关闭(associativeMemoryEnabled && contextBridgeEnabled 双门):零构造、零 IO、零留存。
 * 本模块自身无 spawn/HTTP;contextSinkMode='python' 仅在 assoc∧bridge∧pythonBackend 三重门下
 * 经 lib/context-sink-python-pre.js 使用共享 SidecarClient(M7-1),否则回退 null sink。
 * UTF-8 无 BOM。
 */
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import {
  buildContextPushEnvelopePre, buildAuthorizedMemoryRefFromRecord, createAccessEvidencePre,
  createCiteEvidencesFromText, createCorrectionEvidencesFromText, computeReadCoverage,
  createContextPushBridge, createNullContextSinkPre, createFakeContextSinkPre,
  CONTEXT_BRIDGE_BUDGET_PRE_V1, CONTEXT_BRIDGE_POLICY_VERSION, EVIDENCE_POLICY_VERSION,
} from './context-bridge-pre.js'
import { EvidenceEventStore, rebuildAggregates, workspaceRefOf } from './evidence-store-pre.js'
import { createPythonContextSinkPre } from './context-sink-python-pre.js'
import { buildQueryPlan, lexicalSearch, GATE_POLICY_VERSION, LEXICAL_POLICY_VERSION } from './shadow-retrieval-pre.js'
import { fuseD6Pre } from './semantic-js-pre.js'
import { buildSourceCatalog, loadCorpusSnapshot, CorpusRegistry, canonicalize } from './m4-corpus-pre.js'

const MAX_DROPS_RING = 64

/** M7.5 诊断:ctx-host drop/skip 直写 harness diagnose 日志(此前 try{diag()} 静默吞 ReferenceError)。 */
function diagCtx(msg) {
  try {
    const env = process.env.DSH_HOME
    const base = env && env.trim() ? env.trim()
      : (process.env.USERPROFILE || process.env.HOME || '')
    if (!base) return
    appendFileSync(path.join(base, '.dsh', 'dsh-auto-memory-pre-diagnose.log'),
      new Date().toISOString() + ' [ctx-host] ' + String(msg).slice(0, 300) + '\n', 'utf8')
  } catch (e) {}
}

export function createContextHost(opts = {}) {
  const engine = opts.engine
  if (!engine) throw new Error('context-host: engine required')
  const states = new WeakMap() // runtime → state(lazy)
  const volatileDrops = [] // ≤16 条最小投影(无文本)
  const stats = { envelopesBuilt: 0, pushesAccepted: 0, pushesRejected: 0, superseded: 0,
    evidenceAppended: 0, evidenceDuplicates: 0, evidenceFailed: 0, readsCovered: 0, stalesSeen: 0, errors: 0,
    // 2026-08-27 JS 判定观测(真实数据验证):按段类型计数判定/emit/shadow 拦截,经 debugView 暴露
    jsDecideRuns: 0, jsDecideEmits: 0, jsDecideShadowed: 0,
    jsDecideByKind: {}, // {user: n, reasoning: n, assistant: n, tool: n}
  }
  const pathsByKey = new Map()
  let lastFrameIdentity = null // 最小投影:observationId 全值(本身是哈希)+计数,无任何文本
  let lastSegmentRuntimeKey = null
  let lastSegmentSessionRef = null
  let lastSinkMode = null
  let bridge = null
  let store = null
  let aggCache = null // {wsRef, miv, list}
  const registry = new CorpusRegistry({ sidecarDir: path.join(dshHome(), 'memory', 'index-pre', 'files') })

  function dshHome() {
    const env = process.env.DSH_HOME
    if (env && env.trim()) return env.trim()
    const base = engine.__homedirFn ? engine.__homedirFn() : (process.env.USERPROFILE || process.env.HOME || '')
    return base ? path.join(base, '.dsh') : '.'
  }
  function effectiveEnabled() {
    return engine.config.associativeMemoryEnabled === true && engine.config.contextBridgeEnabled === true
  }
  function pythonGate() {
    // M7-1 三重门(PYTHON-SIDECAR-CONTRACT §13.1):默认 false/null 时恒为假 → 永远走 null sink
    return engine.config.associativeMemoryEnabled === true &&
      engine.config.contextBridgeEnabled === true &&
      engine.config.pythonBackendEnabled === true
  }
  function sinkMode() {
    const m = String(engine.config.contextSinkMode || 'null')
    if (m === 'fake') return 'fake'
    if (m === 'python' && pythonGate()) return 'python'
    return 'null'
  }
  let pythonSink = null
  function getPythonSink() {
    if (!pythonSink) {
      // 共享 engine 级 SidecarClient(lazy start);worker 主动 activation_request 帧上抛给现有
      // M6 host(offerExternalActivation),本模块不构建 Packet、不改 M6 validator/delivery/seen。
      pythonSink = createPythonContextSinkPre({
        client: engine._pythonSidecar,
        onActivation: (evt) => { try { if (engine._activationHost) engine._activationHost.offerExternalActivation(evt && evt.activation) } catch (_) {} },
      })
    }
    return pythonSink
  }
  function bridgeFor() {
    const mode = sinkMode()
    if (!bridge || lastSinkMode !== mode) {
      const sink = mode === 'fake'
        ? createFakeContextSinkPre({ capacity: 64 })
        : (mode === 'python' ? getPythonSink() : createNullContextSinkPre())
      bridge = createContextPushBridge({ sink })
      lastSinkMode = mode
    }
    return bridge
  }
  function storeFor() {
    if (!store) store = new EvidenceEventStore({ root: path.join(dshHome(), 'memory', 'evidence-pre') })
    return store
  }
  function evidenceRootExists() {
    const p = path.join(dshHome(), 'memory', 'evidence-pre')
    try { return existsSync(p) } catch (_) { return false }
  }
  function stateFor(runtime) {
    let st = states.get(runtime)
    if (!st) { st = { lastPushedContextVersion: -1, disposed: false }; states.set(runtime, st) }
    return st
  }
  function pushDrop(reason, contextVersion) {
    volatileDrops.push({ at: Date.now(), reason, contextVersion })
    if (volatileDrops.length > MAX_DROPS_RING) volatileDrops.shift()
    diagCtx('ctx-host drop: ' + reason + ' cv=' + contextVersion)
  }
  function capturePaths(runtimeKey, p) {
    pathsByKey.set(String(runtimeKey || ''), {
      workspaceKey: canonicalize(p.ws),
      userMemoryPath: p.userDir ? path.join(p.userDir, 'MEMORY.md') : undefined,
      workspaceMemoryPath: p.notesPath,
      todayLogPath: p.logPath,
    })
  }

  /** 加载当前工作区语料(fingerprint 缓存);失败返回 null(不阻塞 envelope 构造)。 */
  function loadCorpus(paths) {
    try {
      const catalog = buildSourceCatalog({
        workspaceKey: paths.workspaceKey,
        userMemoryPath: paths.userMemoryPath,
        workspaceMemoryPath: paths.workspaceMemoryPath,
        todayLogPath: paths.todayLogPath,
      })
      const res = registry.get(catalog)
      return res && res.ok ? res.snapshot : null
    } catch (_) { return null }
  }

  /** 当前 workspace 的聚合列表(懒重建;corpus 变化或新证据后失效)。 */
  function aggregatesFor(wsRef, corpusSnap) {
    const miv = corpusSnap ? corpusSnap.memoryIndexVersion : null
    if (aggCache && aggCache.wsRef === wsRef && aggCache.miv === miv) return aggCache.list
    const st = storeFor()
    const loaded = st.loadEvents()
    const rebuilt = rebuildAggregates(loaded.events, corpusSnap ? corpusSnap.records : [])
    const list = (wsRef && rebuilt.byWorkspaceRef.get(wsRef)) || []
    aggCache = { wsRef, miv, list }
    return list
  }
  function invalidateAggregates() { aggCache = null }

  /**
   * 拉长观察窗口(2026-08-27,working memory 实时定位):取最近 24 段(含 CoT/reasoning),
   * 提取 CJK 关键词(2-4 gram 高频)+ 尾部原文,供 C2 检索/JS 判定。比旧版(8 段截尾)
   * 覆盖面更广,让 CoT 里的 recall 意图能浮现。预算 ≤2000 字符。
   */
  function buildObserveWindowText(runtime, seg) {
    try {
      const all = runtime.segments ? runtime.segments.snapshot() : []
      const recent = all.slice(-24)
      // 2026-08-27 query 分源(用户裁定):user 段用消息文本为主;reasoning/CoT 段用 CoT 文本为主。
      // 两类段都参与判定(拟合高就激发),query 反映"当前在想什么/要什么"。
      const userTexts = []
      const cotTexts = []
      for (const w of recent) {
        const k = w && w.kind
        const t = (w && w.text) || ''
        if (!t) continue
        if (k === 'user') userTexts.push(t)
        else if (k === 'reasoning' || k === 'assistant') cotTexts.push(t)
      }
      const curText = (seg && seg.text) || ''
      const segKind = seg && seg.kind
      // 主 query:当前段类型决定——user 段用消息文本,CoT 段用 CoT 文本。
      // 取拼接后尾部 1200(最近的思考/消息才代表"当下",旧版取头部偏早内容)。
      // 兜底:窗口无对应类型时用当前段文本。
      let main
      if (segKind === 'reasoning') {
        const tail = cotTexts.slice(-2).join(' ')
        main = tail.length > 1200 ? tail.slice(-1200) : (tail || curText)
      } else {
        if (!userTexts.length && curText) userTexts.push(curText)
        const tail = userTexts.slice(-2).join(' ')
        main = tail.length > 1200 ? tail.slice(-1200) : tail
      }
      // CoT 回忆关键词(辅助信号,有回忆意图才提取)
      const cotKws = extractRecallKeywords(cotTexts.join(' '))
      const kws = cotKws.slice(0, 12)
      return main + (kws.length ? ' 联想:' + kws.join(' ') : '')
    } catch (_) { return ((seg && seg.text) || '') }
  }
  /** 提取 CoT 中"回忆意图"关键词(CJK 2-3 gram 高频)。
   *  2026-08-27 Review 修正:回忆锚词用于判断"CoT 是否在回忆"(有锚词→提取全部高频词,
   *  联想广度;无锚词→返回空,不强加无关联想)。不用锚词过滤 gram(会滤掉 DSH推理档位 这类主题词)。 */
  function extractRecallKeywords(cotText) {
    const s = String(cotText || '').replace(/\s+/g, '')
    const sl = s.toLowerCase()
    const RECALL_ANCHORS = ['之前', '上次', '当时', '记得', '查阅', '检索', '决策', '方案', '记录', '历史', '选择', '采用', '协议', '配置', '实现', '修复', '测试', '回忆', 'review', 'recall']
    // 先判断是否在回忆:CoT 含任一锚词 → 是回忆场景(锚词小写化匹配,兼容 Review/Recall 写法)
    const inRecall = RECALL_ANCHORS.some((a) => sl.includes(a))
    if (!inRecall) return []
    const grams = new Map()
    for (let n = 2; n <= 3 && n <= s.length; n++) {
      for (let i = 0; i + n <= s.length; i++) {
        const g = s.slice(i, i + n)
        if (/[\u4e00-\u9fff]/.test(g)) grams.set(g, (grams.get(g) || 0) + 1)
      }
    }
    return [...grams.entries()].filter(([, c]) => c >= 2).sort((a, b) => b[1] - a[1]).slice(0, 16).map(([g]) => g)
  }

  /**
   * M2 Segment accept 后调用(index.js ingestEnvelope 内 fire-and-forget):
   * user/assistant 文本先跑 cite/correction 扫描;随后组装并推送 envelope。
   */
  function onSegmentAccepted(runtime, seg, envelope) {
    try {
      if (!effectiveEnabled()) { diagCtx('ctx-host skip: gates-off assoc=' + !!engine.config.associativeMemoryEnabled + ' bridge=' + !!engine.config.contextBridgeEnabled); return }
      if (runtime.disposed) { diagCtx('ctx-host skip: runtime-disposed'); return }
      const st = stateFor(runtime)
      if (st.disposed) { diagCtx('ctx-host skip: st-disposed'); return }
      const envPayload = (envelope && envelope.payload) || {}
      // child/plugin 触发抑制(与 M4 同序;volatile 计数)
      const isChild = !!(runtime.agent && runtime.agent.session && runtime.agent.session.header && runtime.agent.session.header.parentSession)
      if (isChild && engine.config.contextBridgeObserveChildSessions !== true) {
        pushDrop('child-session', seg.contextVersion); return
      }
      if (isChild) { diagCtx('ctx-host observe: child-session (observe-switch on) cv=' + seg.contextVersion) }
      // M7.5 精确化(2026-08-26):仅拦截本插件自己的注入(auto-summary/welcome-back 等),
      // 防止自动沉淀内容污染 trigger;harness 对续接会话打的来源标记不得误伤用户手动输入。
      if (seg.kind === 'user' && /auto-memory/i.test(String(envPayload.sourcePlugin || ''))) {
        pushDrop('plugin-generated-trigger', seg.contextVersion); return
      }
      const paths = pathsByKey.get(String(runtime.key || '')) || null
      // M7-8 live-parity 诊断:记录最近 Segment 的 runtime key/sessionRef(最小投影)
      lastSegmentRuntimeKey = String(runtime.key || '')
      lastSegmentSessionRef = String(runtime.sessionId || '').slice(0, 24)
      if (!paths) { pushDrop('no-paths-captured', seg.contextVersion); return }
      const corpusSnap = loadCorpus(paths)
      // ---- cite / correction(user+assistant 可见文本;precision-first,需完整 token+provenance)----
      if ((seg.kind === 'user' || seg.kind === 'assistant') && seg.text && corpusSnap && corpusSnap.records.length) {
        void emitTextEvidence({ seg, paths, corpusSnap })
      }
      // ---- M7-8 Host Index Sync Orchestration ----
      // 时序修正(§19.10):index 必须先于 context_push 就绪——Python 在未收到全库语料前
      // 无法做语义检索,若先 push context 会得到 index-not-ready 或空候选。
      // 流程:ensureIndexReady(幂等缓存)→ ready 后才推最新 frame;旧 frame 在新 contextVersion
      // 到达时被 cancelStale 作废。同步失败 → 结构化记录,不阻塞本 Segment 的 envelope 组装,
      // 但 context_push 仅在 ready 后发送(失败则不发送,待下一 Segment 重试)。
      // M7-8:python sink 才需 index-ready 门(fake/null sink 不依赖 python corpus)
      const needIndexReady = sinkMode() === 'python'
      const readyPromise = needIndexReady ? ensureIndexReadyFor(paths, corpusSnap) : Promise.resolve({ ready: true })
      // ---- envelope 组装与推送 ----
      const ringItems = runtime.segments ? runtime.segments.snapshot() : []
      const winRaw = ringItems.slice(-CONTEXT_BRIDGE_BUDGET_PRE_V1.maxSegments).map((w) => ({
        segmentId: w.id, digest: w.digest, kind: w.kind, eventSeq: w.eventSeq,
        contextVersion: w.contextVersion, ts: w.ts, text: w.text,
        toolName: w.toolName != null ? w.toolName : null,
        toolOk: w.toolOk != null ? w.toolOk : null,
      }))
      const wsRef = workspaceRefOf(paths.workspaceKey)
      const qpInput = {
        trigger: { segmentId: seg.id, segmentDigest: seg.digest, kind: seg.kind, eventType: seg.eventType || 'session/event', ts: seg.ts },
        window: winRaw,
      }
      const qp = buildQueryPlan(qpInput)
      const ls = corpusSnap
        ? lexicalSearch(corpusSnap, qp, { triggerTs: seg.ts, mode: 'prefetch', dayBoundaryMinutes: Number(engine.config.dayBoundaryMinutes) || 450 })
        : { kept: [] }
      // C2 内置语义臂(2026-08-26):排名需 embed,挂进与 push 同一条延迟链;
      // envelope 构建为确定性纯函数,后移到 ready/rank 就绪后执行是安全的。
      // 钩子由 index.js 注入(engine._jsSemanticRank);缺失/失败 → 词法序原样。
      const c2RankPromise = (typeof engine._jsSemanticRank === 'function' && seg.text && corpusSnap && Array.isArray(corpusSnap.records) && corpusSnap.records.length)
        ? Promise.resolve().then(() => engine._jsSemanticRank(corpusSnap, buildObserveWindowText(runtime, seg))).catch(() => null)
        : Promise.resolve(null)
      void Promise.all([readyPromise, c2RankPromise]).then(([readyRes, rank]) => {
        if (!(readyRes && readyRes.ready)) {
          stats.pushesRejected++
          pushDrop('index-not-ready:' + ((readyRes && readyRes.reason) || 'unknown'), runtime.contextVersion)
          return
        }
        if (st.disposed || runtime.disposed) return
        let keptList = ls.kept
        if (rank && rank.scores && rank.scores.size) {
          // D6 融合候选池=词法 kept ∪ 稠密 top-K(语料中找回记录对象;语义强命中但词法零分者由此入选)
          const poolMap = new Map()
          for (const k of ls.kept) if (k && k.memoryId) poolMap.set(k.memoryId, k)
          const denseTop = [...rank.scores.entries()].sort((a, b) => b[1] - a[1]).slice(0, CONTEXT_BRIDGE_BUDGET_PRE_V1.maxMemoryRefs)
          for (const [mid] of denseTop) {
            if (!poolMap.has(mid)) {
              const rec = (corpusSnap.records || []).find((r) => r && r.memoryId === mid)
              if (rec) poolMap.set(mid, rec)
            }
          }
          keptList = fuseD6Pre([...poolMap.values()].map((k) => ({
            memoryId: k.memoryId,
            lex: (k.scores && Number(k.scores.total)) || 0,
            dense: typeof rank.scores.get(k.memoryId) === 'number' ? rank.scores.get(k.memoryId) : null,
          }))).map((f) => poolMap.get(f.memoryId)).filter(Boolean)
        }
        const refs = []
        for (const k of keptList.slice(0, CONTEXT_BRIDGE_BUDGET_PRE_V1.maxMemoryRefs)) {
          const r = buildAuthorizedMemoryRefFromRecord(k, k.text)
          if (r.ok) refs.push(r.ref)
        }
        const aggs = aggregatesFor(wsRef, corpusSnap).slice(0, CONTEXT_BRIDGE_BUDGET_PRE_V1.maxEvidenceItems)
        const built = buildContextPushEnvelopePre({
          session: { sessionId: runtime.sessionId || '', agentId: runtime.agentId || '', workspaceKey: paths.workspaceKey, scope: 'Workspace' },
          cursor: { eventSeq: seg.eventSeq, nativeSeq: seg.nativeSeq, contextVersion: runtime.contextVersion },
          index: { memoryIndexVersion: corpusSnap ? corpusSnap.memoryIndexVersion : ('idx_pre_' + '0'.repeat(32)), sourceEpochs: corpusSnap ? corpusSnap.sources.map((s) => s.sourceEpoch) : [] },
          trigger: {
            segmentId: seg.id, digest: seg.digest, kind: seg.kind, eventSeq: seg.eventSeq,
            contextVersion: seg.contextVersion, ts: seg.ts, text: seg.text,
          },
          window: winRaw.slice(0, CONTEXT_BRIDGE_BUDGET_PRE_V1.maxSegments),
          memoryRefs: refs,
          evidence: aggs,
          now: Date.now(),
          policyVersionGate: GATE_POLICY_VERSION,
          policyVersionLexical: LEXICAL_POLICY_VERSION,
        })
        if (!built.ok) { pushDrop('envelope:' + built.reason, runtime.contextVersion); return }
        stats.envelopesBuilt++
        lastFrameIdentity = {
          observationId: built.frame.observationId,
          contextVersion: built.frame.cursor.contextVersion,
          windowCount: built.frame.window.length,
          memoryRefCount: built.frame.memoryRefs.length,
          evidenceCount: built.frame.evidence.length,
        }
        bridgeFor().cancelStale(built.frame.session.sessionId, built.frame.cursor.contextVersion)
        void bridgeFor().push(built.frame).then((ack) => {
          if (ack && ack.accepted) stats.pushesAccepted++
          else stats.pushesRejected++
        }).catch(() => { stats.errors++ })
        st.lastPushedContextVersion = built.frame.cursor.contextVersion
        // 2026-08-27 JS 判定闭环:C2 排名就绪时,用 JS 判定核(fv2 策略工件)做决策;
        // emit → 经 M6 activationHost 投递(Reference Tail)。完全独立于 Python。
        // 判定侧冷却(jsDecideCooldownRounds):emit 注入后 N 轮内不再判定,防连续唤起浪费 token。
        // 2026-08-27 修正(用户裁定):user + reasoning(CoT)段都触发判定——滑动监测的初衷是
        // 监听模型思维链,拟合度高就激发(不只用户消息,也不只困难场景)。query 分源:
        // user 段用消息文本,CoT 段用 CoT 文本。assistant(可见输出)同样触发——非推理模型
        // 无 reasoning 段时它是唯一"模型在说什么"的信号;复述风险由 echo veto+冷却+阈值三层兜底。
        if ((seg.kind === 'user' || seg.kind === 'tool' || seg.kind === 'reasoning' || seg.kind === 'assistant') && rank && rank.scores && rank.scores.size && typeof engine._jsDecide === 'function' && typeof engine._activationHost !== 'undefined' && engine._activationHost) {
          try {
            // 2026-08-27 判定观测:按段类型计数(真实数据验证 CoT 触发)
            stats.jsDecideRuns++
            stats.jsDecideByKind[seg.kind] = (stats.jsDecideByKind[seg.kind] || 0) + 1
            const cd = Math.max(0, Number(engine.config.jsDecideCooldownRounds) || 5)
            const stNow = stateFor(runtime)
            if (cd > 0 && stNow._jsDecideNextAt && Date.now() < stNow._jsDecideNextAt) return
            var jsDecideQueryText = buildObserveWindowText(runtime, seg)
            void Promise.resolve()
              .then(() => engine._jsDecide(jsDecideQueryText, {
                scores: rank.scores,
                _records: corpusSnap ? corpusSnap.records : [],
                // 2026-08-28 孪生对齐:词法分喂给 fv2 候选融合(Python 口径=稠密top8按D6融合序)
                _lex: (function () { const m = new Map(); for (const k of ls.kept) if (k && k.memoryId) m.set(k.memoryId, (k.scores && Number(k.scores.total)) || 0); return m })(),
              }, built.frame))
              .then(async (dec) => {
                // 2026-08-27 判定 shadow 日志:每条决策落盘(含 suppress/prefetch/emit),
                // 供真实数据验证 CoT 触发是否工作。fail closed:日志失败不影响判定链。
                try {
                  if (dec && dec.ok) {
                    jsDecideShadowLog({
                      t: Date.now(), kind: seg.kind,
                      decision: dec.decision, lane: dec.lane || '',
                      reasonCodes: (dec.reasonCodes || []).slice(0, 6),
                      intentProb: dec.features ? Math.round(dec.features.intentProb * 1e4) / 1e4 : null,
                      dialogAct: dec.features ? dec.features.dialogueAct : null,
                      // 2026-08-28 对齐后特征:fv2 候选=稠密top8融合序;margin=融合1/2名稠密分差
                      candN: dec._candN != null ? dec._candN : (rank.scores ? rank.scores.size : 0),
                      denseTop: dec._denseTop != null ? Math.round(dec._denseTop * 1e4) / 1e4 : null,
                      margin: dec._margin != null ? Math.round(dec._margin * 1e4) / 1e4 : null,
                      hit: !!dec._hit,
                      emitMode: (typeof engine.jsEmitMode === 'function') ? (() => { try { return engine.jsEmitMode() } catch (_) { return 'shadow' } })() : 'shadow',
                      sessionRef: String(runtime.sessionId || '').slice(0, 12),
                      wsRef: (function () { try { return workspaceRefOf((pathsByKey.get(String(runtime.key || '')) || {}).workspaceKey || '') } catch (_) { return '' } })(),
                    })
                  }
                } catch (_) {}
                if (!dec || !dec.ok || dec.decision !== 'emit') return
                stats.jsDecideEmits++
                // 2026-08-27 JS 发射门:读 activationEmitMode(与 Python 同源)。
                // shadow=只记录不注入(canary-explicit/active 才注入)。
                try { if (typeof engine.jsEmitMode === 'function' && engine.jsEmitMode() === 'shadow') { stats.jsDecideShadowed++; return } } catch (_) {}
                // emit → 冷却(时间窗,默认 60s 内不再判定,防止连续注入)
                if (cd > 0) stNow._jsDecideNextAt = Date.now() + cd * 60000
                // 构建 ActivationRequestPre 帧(与 Python _build_activation 同形状),走 M6 注入
                const session = built.frame.session || {}
                const cursor = built.frame.cursor || {}
                const obs = built.frame.observationId || ''
                const act = {
                  schemaVersion: 1, namespace: 'dsh-auto-memory-pre', kind: 'activation_request',
                  activationId: 'act_pre_' + (obs.startsWith('obs_pre_') ? obs.slice(8, 40) : 'jsdecide'),
                  observationId: obs, workerEpoch: 'js-decide-pre-v1',
                  sessionId: session.sessionId || '', agentId: session.agentId || '',
                  workspaceKey: session.workspaceKey || '', scope: session.scope || 'Workspace',
                  contextVersion: cursor.contextVersion || 0, memoryIndexVersion: built.frame.index ? built.frame.index.memoryIndexVersion : '',
                  threshold: { policyVersion: dec.features ? 'activation_policy_pre_v2' : 'activation_policy_pre_v2', score: (dec.features && dec.features.intentProb) || 0, threshold: 0.45, reason: ('js-decide lane=' + dec.lane + ' ' + (dec.reasonCodes || []).join(',')) },
                  level: 'excerpt',
                  candidates: (function () {
                    // 2026-08-27 优化③:候选方案档位(balanced=3×40 / dense=6×20 / custom=自定义)
                    var scheme = String(engine.config.jsDecideCandidateScheme || 'balanced')
                    var n, ex
                    if (scheme === 'dense') { n = 6; ex = 20 }
                    else if (scheme === 'custom') { n = Math.max(1, Math.min(8, Number(engine.config.jsDecideCandidatesN) || 4)); ex = Math.max(20, Math.min(480, Number(engine.config.jsDecideExcerptChars) || 40)) }
                    else { n = 3; ex = 40 } // balanced 默认
                    return refs.slice(0, n).map(function (r, i) {
                      return {
                        candidateId: 'cand_pre_' + String(obs || 'js').slice(-32) + i,
                        memoryId: r.memoryId, anchorId: r.anchorId || '', scope: r.scope || 'Workspace',
                        sourceRef: r.sourceRef || '', sourceEpoch: r.sourceEpoch || '', sourceVersion: r.sourceVersion || 1,
                        fileDigest: r.fileDigest || '', recordDigest: r.recordDigest || '',
                        score: rank.scores.get(r.memoryId) || 0, excerpt: (r.excerpt || '').slice(0, ex),
                      }
                    })
                  })(),
                  ttlSteps: 3, createdAt: Date.now(), expiresAt: Date.now() + 180000,
                }
                // M8 技能召回(Memory Hub):emit 命中时,若记忆中枢有与当前 query 相关的 active skill,
                // 把 checklist 附加到注入内容(推荐候选),让 AI 按固定流程执行。纯增强,失败静默。
                // 2026-08-28 P1⑥:优先 C2 稠密匹配(技能标题+步骤进嵌入索引,miv=技能集指纹,
                // 集合不变则缓存命中);不可用回退词法 2-gram。阈值 0.6(e5 相关内容带)。单 offer 出口。
                try {
                  const hub = engine._memoryHub
                  const skillEnabled = engine.config.memoryHubEnabled === true && engine.config.procedurePromotionEnabled !== false
                  if (hub && skillEnabled && hub.stores && hub.stores.procedures) {
                    const actives = hub.stores.procedures.activeProcedures()
                    let hit = null
                    if (actives.length && typeof engine._jsSemanticRank === 'function') {
                      try {
                        const recs = actives.map((p) => ({ memoryId: String(p.procedureId), text: String(p.title || '') + ' ' + (Array.isArray(p.steps) ? p.steps.join(' ') : String(p.steps || '')) }))
                        const miv = 'idx_pre_' + createHash('sha256').update(recs.map((r) => r.memoryId).join(',')).digest('hex').slice(0, 32)
                        const rank = await engine._jsSemanticRank({ memoryIndexVersion: miv, records: recs }, jsDecideQueryText)
                        if (rank && rank.scores && rank.scores.size) {
                          const [topId, topScore] = [...rank.scores.entries()].sort((a, b) => b[1] - a[1])[0]
                          if (topScore >= 0.6) hit = actives.find((p) => String(p.procedureId) === topId) || null
                        }
                      } catch (_) {}
                    }
                    if (!hit) {
                      const ql = String(jsDecideQueryText || '').toLowerCase()
                      hit = actives.find((p) => {
                        if (!p || !p.title) return false
                        const t = String(p.title).toLowerCase()
                        if (ql.length >= 2 && t && ql.includes(t.slice(0, 2))) return true
                        if (t && ql.includes(t)) return true
                        return false
                      }) || null
                    }
                    if (hit) {
                      const cl = hub.stores.procedures.renderChecklist(hit.procedureId)
                      if (cl && cl.text) {
                        // level 一并由 renderChecklist 给出(高风险自动降级 hint),供 M6 技能段渲染
                        act.skill = { procedureId: hit.procedureId, title: hit.title, level: cl.level || 'checklist', text: cl.text.slice(0, 1200) }
                        try { hub.stores.procedures.touch(hit.procedureId) } catch (_) {} // Hermes:last_used 时钟
                      }
                    }
                  }
                } catch (_) {}
                engine._activationHost.offerExternalActivation(act)
              }).catch(() => {})
          } catch (_) {}
        }
      }).catch(() => { stats.pushesRejected++ })
    } catch (e) { stats.errors++ }
  }

  /** M7-8:index ready 编排;corpus 缺失/miv 无效→{ok:false,ready:false}。 */
  async function ensureIndexReadyFor(paths, corpusSnap) {
    if (!engine._indexSyncHost || !corpusSnap) return { ok: false, ready: false, reason: 'no-corpus' }
    try {
      return await engine._indexSyncHost.ensureIndexReady(corpusSnap, paths, 'Workspace', { runtimeKey: '(ctx-host)' })
    } catch (e) { return { ok: false, ready: false, reason: 'orchestrator-error' } }
  }

  /** cite/correction 落盘(异步链;幂等由 evidenceId 保证)。 */
  async function emitTextEvidence(ctxT) {
    const { seg, paths, corpusSnap } = ctxT
    const coords = {
      sessionId: seg.sessionId || '', eventSeq: seg.eventSeq, nativeSeq: seg.nativeSeq,
      contextVersion: seg.contextVersion, workspaceKey: paths.workspaceKey, ts: seg.ts,
    }
    const cites = createCiteEvidencesFromText({ text: seg.text, knownRecords: corpusSnap.records, coords })
    const corrections = seg.kind === 'user'
      ? createCorrectionEvidencesFromText({ text: seg.text, knownRecords: corpusSnap.records, coords })
      : []
    await persistEvidence([...cites, ...corrections])
  }

  /**
   * frozen tools/result 观察(read coverage):
   * precision-first v1——仅当 ok=true 且 resultPreview 含完整 memoryId token 且该 token 在当前授权 corpus 中,
   * 且记录切片被 preview 归一化包含(coverage>0)时建 read evidence;fileDigest 以 corpus 快照为 observed 值做 stale 门。
   */
  function onToolResult(runtime, envelope) {
    try {
      if (!effectiveEnabled()) return
      if (!runtime || !envelope || runtime.disposed) return
      const payload = envelope.payload || {}
      if (process.env.DSH_CTX_DEBUG) console.error('[ctx-host-diag] toolResult ok=' + payload.ok + ' name=' + payload.name + ' previewLen=' + String(payload.resultPreview || '').length)
      if (payload.ok !== true) return
      const preview = typeof payload.resultPreview === 'string' ? payload.resultPreview : ''
      if (!preview || preview.indexOf('mem_') === -1) return
      const paths = pathsByKey.get(String(runtime.key || '')) || null
      if (!paths) return
      const corpusSnap = loadCorpus(paths)
      if (!corpusSnap || !corpusSnap.records.length) return
      const ids = [...new Set(preview.match(/mem_[0-9a-f]{32}/g) || [])]
      if (!ids.length) return
      const candidates = corpusSnap.records.filter((r) => ids.includes(r.memoryId))
      if (process.env.DSH_CTX_DEBUG) console.error('[ctx-host-diag] ids=' + ids.join(',') + ' corpusRecords=' + corpusSnap.records.length + ' candidates=' + candidates.length)
      if (!candidates.length) return
      const observedDigest = pickObservedFileDigest(corpusSnap, candidates[0].sourceRef)
      const cov = computeReadCoverage(candidates, { text: preview, observedFileDigest: observedDigest })
      if (process.env.DSH_CTX_DEBUG) console.error('[ctx-host-diag] covered=' + cov.covered.length + ' stale=' + cov.stale.length + ' covVals=' + JSON.stringify(cov.covered.map((c) => c.coverage)))
      stats.stalesSeen += cov.stale.length
      const coordsBase = {
        sessionId: envelope.sessionId || '', eventSeq: envelope.eventSeq, nativeSeq: envelope.nativeSeq,
        contextVersion: envelope.callId ? runtime.contextVersion : runtime.contextVersion,
        callId: envelope.callId || undefined, workspaceKey: paths.workspaceKey, ts: envelope.timestamp || Date.now(),
      }
      const evidences = []
      for (const c of cov.covered) {
        const r = c.record
        const ev = createAccessEvidencePre({
          ...coordsBase, kind: 'read', memoryId: r.memoryId, anchorId: r.anchorId, scope: r.scope,
          sourceRef: r.sourceRef, sourceEpoch: r.sourceEpoch, sourceVersion: r.sourceVersion,
          fileDigest: r.fileDigest, recordDigest: r.recordDigest, coverage: c.coverage,
        })
        if (ev.ok) evidences.push(ev.evidence)
      }
      stats.readsCovered += evidences.length
      if (evidences.length) void persistEvidence(evidences)
    } catch (e) { stats.errors++ }
  }

  /** 从 corpus sources 里取 sourceRef 对应文件的当前 fileDigest(stale 门观测值)。 */
  function pickObservedFileDigest(corpusSnap, sourceRef) {
    const src = (corpusSnap.sources || []).find((s) => s.sourceRef === sourceRef)
    return src ? src.fileDigest : undefined
  }

  async function persistEvidence(list) {
    if (!list.length) return
    const st = storeFor()
    for (const ev of list) {
      const r = await st.append(ev)
      if (r.ok) stats.evidenceAppended++
      else if (r.reason === 'duplicate-evidence') stats.evidenceDuplicates++
      else stats.evidenceFailed++
    }
    invalidateAggregates()
    // 2026-08-28 M9 evidence 直达分流(Hermes 借鉴):证据按 memoryId 关联到
    // sourceMemoryIds 包含它的技能→addEvidence(touch lastUsedAt,驱动老化时钟)。
    // memoryHubEnabled 门;逐条 fail closed;无映射则跳过。诊断经 diagCtx。
    try {
      const hub = engine._memoryHub
      if (engine.config.memoryHubEnabled !== true) diagCtx('hub evidence feed skip: hub-off')
      else if (!hub || !hub.stores || !hub.stores.procedures) diagCtx('hub evidence feed skip: no-hub')
      else {
        // sessionRef:证据事件自带 sessionId 优先;cite 路径的 seg 无 sessionId 时
        // 用 lastSegmentSessionRef(会话多样性计数依赖它,空会话 Ref 不计会话)
        const sessionRef = String((list[0] && list[0].sessionId) || lastSegmentSessionRef || '').slice(0, 48)
        const all = hub.stores.procedures.query()
        for (const ev of list) {
          if (!ev || !ev.memoryId) continue
          let matched = 0
          for (const p of all) {
            if (!Array.isArray(p.sourceMemoryIds) || !p.sourceMemoryIds.includes(ev.memoryId)) continue
            matched++
            if (['seen', 'read', 'cite', 'reuse', 'success', 'correction'].includes(ev.kind)) {
              const ar = hub.stores.procedures.addEvidence(p.procedureId, { kind: ev.kind, sessionRef })
              diagCtx('hub evidence feed: ' + ev.kind + ' → ' + String(p.procedureId).slice(0, 18) + ' ok=' + !!(ar && ar.ok) + ' counts=' + JSON.stringify(ar && ar.evidence))
            }
          }
          if (!matched) diagCtx('hub evidence feed: no-proc-match ' + ev.kind + ' ' + String(ev.memoryId).slice(0, 18) + ' (procs=' + all.length + ')')
        }
      }
    } catch (e) { diagCtx('hub evidence feed error: ' + String(e && e.message || e).slice(0, 100)) }
  }

  /** JS 判定 shadow 日志(2026-08-27,真实数据验证):append-only JSONL,与 Python
   *  activation-shadow-v2.jsonl 同目录对齐。无原文/无绝对路径,身份最小投影。
   *  fail closed:任何异常静默,不阻断判定链。 */
  const JSDECIDE_SHADOW_MAX_LINES = 256
  function jsDecideShadowLog(entry) {
    try {
      const dir = path.join(dshHome(), 'memory', 'semantic-pre')
      const f = path.join(dir, 'js-decide-shadow.jsonl')
      let line = JSON.stringify(entry)
      if (!line) return
      appendFileSync(f, line + '\n', 'utf8')
      // 有界:超过上限时保留最后 N 行(读整文件→截尾→重写)
      try {
        const raw = readFileSync(f, 'utf8')
        const lines = String(raw).split('\n').filter((l) => l.trim())
        if (lines.length > JSDECIDE_SHADOW_MAX_LINES) {
          writeFileSync(f, lines.slice(-JSDECIDE_SHADOW_MAX_LINES).join('\n') + '\n', 'utf8')
        }
      } catch (_) {}
    } catch (_) {}
  }

  /** §17 式最小 debug 投影;关闭时严格 {enabled:false}。 */
  function debugView() {
    if (!effectiveEnabled()) return { enabled: false }
    const b = bridgeFor()
    return {
      enabled: true,
      contextPolicyVersion: CONTEXT_BRIDGE_POLICY_VERSION,
      evidencePolicyVersion: EVIDENCE_POLICY_VERSION,
      sinkKind: b.sinkKind(),
      lastFrame: lastFrameIdentity,
      // M7-8 live-parity 诊断(最小投影,不泄路径/文本):capture 键、最近 Segment 身份、最近 drop
      capturedPathKeys: [...pathsByKey.keys()].slice(0, 8),
      lastSegmentRuntimeKey: lastSegmentRuntimeKey,
      lastSegmentSessionRef: lastSegmentSessionRef,
      evidenceDirPath: path.join(dshHome(), 'memory', 'evidence-pre'),
      durableEventsOnDisk: evidenceRootExists() ? storeFor().loadEvents().events.length : 0,
      stats: { ...stats, bridge: { ...b.stats } },
      storeStats: store ? { ...store.stats } : null,
      recentDrops: volatileDrops.slice(-4),
    }
  }

  function collectStates() {
    const out = []
    try {
      for (const rt of engine.runtimes.values()) {
        const st = states.get(rt)
        if (st) out.push({ runtime: rt, state: st })
      }
    } catch (_) {}
    return out
  }

  function disposeRuntime(runtime) {
    const st = states.get(runtime)
    if (st) st.disposed = true
    states.delete(runtime)
  }
  function disposeAll(reason) {
    for (const pair of collectStates()) disposeRuntime(pair.runtime)
    volatileDrops.length = 0
    if (bridge) void bridge.dispose(reason)
    if (store) store.dispose(reason)
  }

  return {
    init() {},
    capturePaths,
    effectiveEnabled,
    isLive: effectiveEnabled,
    onSegmentAccepted,
    onToolResult,
    debugView,
    getStats: () => ({ ...stats }),
    disposeRuntime,
    disposeAll,
    // M6-3 接线点:按 memoryId+recordDigest 查当前 corpus 完整 provenance(seen evidence 需要 sourceEpoch/fileDigest)
    findProvenance(workspaceKey, memoryId, recordDigest) {
      const wsRef = workspaceRefOf(workspaceKey)
      const paths = null
      void paths
      for (const [, p] of pathsByKey) {
        if (workspaceRefOf(p.workspaceKey) !== wsRef) continue
        const snap = loadCorpus(p)
        if (!snap) continue
        const rec = snap.records.find((r) => r.memoryId === memoryId && r.recordDigest === recordDigest)
        if (rec) return { memoryId: rec.memoryId, anchorId: rec.anchorId, scope: rec.scope, sourceRef: rec.sourceRef, sourceEpoch: rec.sourceEpoch, sourceVersion: rec.sourceVersion, fileDigest: rec.fileDigest, recordDigest: rec.recordDigest }
      }
      return null
    },
    // M6-3 接线点:seen evidence 经同一隐私投影 store 落盘
    appendEvidence(evList) { return persistEvidence(Array.isArray(evList) ? evList : [evList]) },
    _volatileDrops: volatileDrops,
    _statsForTest: stats,
    _invalidateAggregatesForTest: invalidateAggregates,
  }
}