# -*- coding: utf-8 -*-
"""M7-2 standalone benchmark corpus.

Synthetic developer-memory records in the style of dsh-auto-memory notes.
No production memory file is read. Every record is benchmark-local.

Coverage required by the M7-2 brief:
  zh2en      Chinese query -> English gold record
  en2zh      English query -> Chinese gold record
  mixed      mixed zh/en records, mixed queries
  code       code / paths / error codes / stack traces
  hardneg    same-topic confusable pairs; query must not surface the twin
  supersede  old claim vs later correction; correction must outrank old
  xws        mirrored records in a foreign workspace; scope gate must hold
  longdoc    multi-paragraph runbooks that exercise chunk-size policies
  distractor topical filler to grow the corpus to realistic scale
"""

WS_CORE = "ws/dsh-core"
WS_OTHER = "ws/other-project"

RECORDS = [
    # ---------------- zh2en: English docs, Chinese queries ----------------
    dict(id="r001", ws=WS_CORE, scope="Workspace", cat="zh2en", text=(
        "workerEpoch semantics: the JS host mints a fresh opaque workerEpoch "
        "every time the Python sidecar process starts. Every frame the worker "
        "emits must echo that epoch back. If the host receives a frame whose "
        "epoch does not match the current one, the frame is dropped silently. "
        "This guarantees that responses from a restarted process can never be "
        "attributed to requests issued to its predecessor.")),
    dict(id="r002", ws=WS_CORE, scope="Workspace", cat="zh2en", text=(
        "JSONL transport framing rule: one UTF-8 JSON object per line on "
        "stdout. The worker must never emit multi-line JSON, comments, or "
        "binary payloads to stdout. Diagnostics go to stderr and are bounded "
        "to 64 entries. A single line larger than 256 KiB is rejected before "
        "any semantic computation happens.")),
    dict(id="r003", ws=WS_CORE, scope="Workspace", cat="zh2en", text=(
        "index_sync commit digest: the client hashes the canonical JSON of "
        "every page plus a final digest over the whole transaction. If any "
        "page digest or the final digest mismatches, the entire sync is "
        "rejected and the derived corpus on the Python side is left "
        "byte-identical to what it was before the sync began. There is no "
        "partial-apply path.")),
    dict(id="r004", ws=WS_CORE, scope="Workspace", cat="zh2en", text=(
        "Circuit breaker policy for the Python sidecar: after three "
        "consecutive failed requests the client opens the breaker for thirty "
        "seconds. While open, all calls fail fast with a structured error "
        "instead of spawning or writing to the worker. After the cooldown a "
        "half-open probe runs; a single success resets the failure counter "
        "to zero.")),
    dict(id="r005", ws=WS_CORE, scope="Workspace", cat="zh2en", text=(
        "Lexical fallback invariant: whenever the semantic backend is "
        "unavailable, times out, or returns a malformed frame, the host "
        "falls back to the local lexical_pre_v2 ranking and the user-visible "
        "memory references are exactly the same items the lexical path would "
        "have produced with the semantic engine disabled from the start. "
        "Degradation never changes result identity, only richness.")),
    dict(id="r006", ws=WS_CORE, scope="Workspace", cat="zh2en", text=(
        "Activation TTL budget: every activation request carries ttlSteps "
        "between 1 and 10. The inbox computes expiresAt from createdAt plus "
        "ttlSteps request boundaries. Expired suggestions are dropped by the "
        "validator before they can reach the model-visible surface; TTL is "
        "never refreshed in place, a fresh activation must be issued.")),
    dict(id="r007", ws=WS_CORE, scope="Workspace", cat="zh2en", text=(
        "Excerpt budget detail: each activation candidate may carry at most "
        "480 UTF-8 bytes of excerpt text. The validator counts bytes, not "
        "code points, so a Chinese-heavy excerpt fits far fewer characters "
        "than an English one. Excess is hard-rejected, not truncated.")),
    dict(id="r008", ws=WS_CORE, scope="Workspace", cat="zh2en", text=(
        "Evidence privacy projection: persisted evidence rows store only the "
        "sesr_/wsr_ hashed projections of session and workspace identities. "
        "The Python side receives read-only aggregates and can never join "
        "them back to raw session identifiers because the salt stays in the "
        "JS host process memory.")),
    dict(id="r009", ws=WS_CORE, scope="Workspace", cat="zh2en", text=(
        "Reference tail delivery ack loop: after a reference tail packet is "
        "rendered into model-visible messages and the model acknowledges "
        "delivery, the host records a seen evidence row for every memory "
        "that was surfaced. Until that ack lands, the same memory keeps its "
        "old seen state and may be re-suggested; after the ack, repetition "
        "cooldown applies.")),
    dict(id="r010", ws=WS_CORE, scope="Workspace", cat="zh2en", text=(
        "Memory identity rule: chunkId is a derived locator computed as a "
        "hash of memoryId plus recordDigest. It positions a span inside a "
        "record but never replaces memoryId as the stable identity. Two "
        "different chunkings of the same record produce different chunkIds "
        "but the memoryId stays constant across them.")),

    # ---------------- en2zh: Chinese docs, English queries ----------------
    dict(id="r011", ws=WS_CORE, scope="Workspace", cat="en2zh", text=(
        "归档窗口修复:maintain() 的归档 cutoff 原来取的是完整时间戳,包含时分秒。"
        "这样在凌晨 00:00 到日界之间的窗口里,当天刚写入的日志会被误判为旧日志并"
        "归档掉。修复方式是把 cutoff 归一化到当天零点 setHours(0,0,0,0),修复后"
        "凌晨窗口内当天 anchored 日志不再被移动到 archive 目录。")),
    dict(id="r012", ws=WS_CORE, scope="Workspace", cat="en2zh", text=(
        "450 分钟日界:引擎的“今天”不是自然日,而是以最近 450 分钟为滚动窗口。"
        "smoke-test.mjs 里的 smkToday 原来直接用本地日期判断,在凌晨跑测试必然和"
        "引擎的 memToday 语义冲突。改成与引擎相同的 450 分钟日界后,凌晨窗口测试"
        "稳定通过。")),
    dict(id="r013", ws=WS_CORE, scope="Workspace", cat="en2zh", text=(
        "自动弹窗开关:autoPopup 默认值是 true,装了插件之后第一次对话结束会自动"
        "弹出记忆面板。有用户反馈这不礼貌,所以加了配置项,设为 false 后只有手动"
        "点状态栏图标才会打开面板。这个开关只影响 UI 行为,不影响后台记忆写入。")),
    dict(id="r014", ws=WS_CORE, scope="Workspace", cat="en2zh", text=(
        "脏 token 检查器:客户端会把本地存的 token 和服务端比对,发现不一致就标记"
        "为 dirty,下次请求前强制刷新。之前的 bug 是比对时用了宽松相等,空字符串和 "
        "undefined 被当成相等,导致脏 token 永远检测不到。改成严格相等并显式判空"
        "后解决。")),
    dict(id="r015", ws=WS_CORE, scope="Workspace", cat="en2zh", text=(
        "zstd websocket 修复:长连接的心跳帧之前没有压缩,代理服务器遇到大帧会掐"
        "断连接。修复是心跳和小帧走明文,负载帧用 zstd 压缩并带序列号,断线重连后"
        "按序列号补发。上线后连接存活时间从平均几分钟提升到小时级。")),
    dict(id="r016", ws=WS_CORE, scope="Workspace", cat="en2zh", text=(
        "npm 包名修复:发到 npm 的包 bundle id 原来是旧的 @a9i5k4 前缀,用户 npm "
        "install 装到的是空壳。根因是打包脚本里硬编码了旧 scope。改成从 "
        "package.json 读 name 字段后,新装的包能正常注册命令。")),
    dict(id="r017", ws=WS_CORE, scope="Workspace", cat="en2zh", text=(
        "日期级提醒:之前提醒 key 是精确到时间戳的,prefix cache 每次都要重建。"
        "改成日期级 key 之后,同一天的对话能命中前缀缓存,token 成本明显下降。"
        "副作用是同一天同一提醒只会发一次,这是可接受的行为。")),
    dict(id="r018", ws=WS_CORE, scope="Workspace", cat="en2zh", text=(
        "离开一小时后自动展开面板:lastActive 现在在面板关闭时落盘。下次会话启动"
        "时如果距离 lastActive 超过一小时,自动展开记忆面板,让用户先看到上次留"
        "下的待办。一小时内重复打开则保持折叠,避免打扰。")),
    dict(id="r019", ws=WS_CORE, scope="Workspace", cat="en2zh", text=(
        "液态玻璃 UI:设置弹窗和首次引导卡片改成毛玻璃材质,底部左侧浮层布局。"
        "重点是 backdrop-filter 加多层半透明叠色,文字区保持高对比度。低性能设备"
        "上检测到帧率低会自动降级成纯色背景。")),
    dict(id="r020", ws=WS_CORE, scope="Workspace", cat="en2zh", text=(
        "importInto 入口:ExternalMemory 暴露 importInto(engine.memToday),外部"
        "系统可以把已有记忆批量灌进来。入口会做去重和 provenance 标注,来源标记"
        "为外部导入,不会混进自然对话产生的记忆流。")),

    # ---------------- mixed zh/en records ----------------
    dict(id="r021", ws=WS_CORE, scope="Workspace", cat="mixed", text=(
        "ContextPushEnvelopePre 的冻结预算:8 个 segments、4096 input bytes、"
        "8 条 memoryRefs、16 条 evidence items、单个 excerpt 480 bytes、frame "
        "64 KiB、deadline 5 秒。这些数字是 wire-level contract,改任何一项都要"
        "升 protocol version。")),
    dict(id="r022", ws=WS_CORE, scope="Workspace", cat="mixed", text=(
        "M6 validator 硬校验清单:workerEpoch、session identity、scope、"
        "contextVersion、idx_pre_ 前缀的 memoryIndexVersion、candidate "
        "provenance 五元组、level 枚举、TTL 步数和预算。任何一项不合法直接拒"
        "绝,没有宽容模式。Python 侧生成的 activation 必须逐字段过这些检查。")),
    dict(id="r023", ws=WS_CORE, scope="Workspace", cat="mixed", text=(
        "三重门 unlock 规则:contextSinkMode=python 需要 associativeMemoryEnabled "
        "&& pythonBackendEnabled && contextBridgeEnabled 同时为真;activationSource"
        "=python 需要 activationInboxEnabled && pythonBackendEnabled。默认全部 "
        "false,所以默认安装是零 Python 进程、零协议 IO、零 semantic-pre 目录。")),
    dict(id="r024", ws=WS_CORE, scope="Workspace", cat="mixed", text=(
        "derived index 的可重建原则:Python 只能写 <DSH_HOME>/memory/semantic-pre/ "
        "下面的派生状态,这个目录随时可以整个删掉重建。重建输入只有 index_sync "
        "发来的 records,所以 embedding 模型、tokenizer、chunking policy 任何一"
        "个变了,整个目录都要作废重来,不存在增量迁移。")),
    dict(id="r025", ws=WS_CORE, scope="Workspace", cat="mixed", text=(
        "canonical JSON 约定:JS 侧 canonicalJson 是键排序、无空白、UTF-8;Python "
        "worker 用相同规则,两边对同一 payload 的 sha256 逐字节一致。digest 是 "
        "index_sync 拒绝语义的基础,任何一边的实现漂移都会导致 digest mismatch。")),
    dict(id="r026", ws=WS_CORE, scope="Workspace", cat="mixed", text=(
        "evidence 类型枚举:seen/read/cite/reuse/success/correction 七种。JS 创建"
        "和持久化,Python 只读 aggregate。missing evidence 不是负证据,只是没有"
        "信息,评分时按中性处理。")),
    dict(id="r027", ws=WS_CORE, scope="Workspace", cat="mixed", text=(
        "activation level 枚举:index/hint/excerpt/checklist/resource/full 六级。"
        "level 越高占的 model-visible surface 越大,Python 建议级别,JS 的 M6 "
        "validator 和 budget gate 有最终否决权。")),
    dict(id="r028", ws=WS_CORE, scope="Workspace", cat="mixed", text=(
        "A/B 会话隔离测试要点:两个并发会话各自走完整的 context_push 到 "
        "reference tail 链路,断言互相的 observationId、sessionId、activationId "
        "零串线。历史 bug 是 request map 按 frameId 关联,重连后 frameId 撞了旧"
        "entry,现在按 requestId 且带 epoch 门。")),

    # ---------------- code / paths / error codes ----------------
    dict(id="r031", ws=WS_CORE, scope="Workspace", cat="code", text=(
        "Recurring crash in the sidecar spawn path:\n"
        "Traceback (most recent call last):\n"
        '  File "lib/python-sidecar-client-pre.js", line 214, in ensureStarted\n'
        "    throw new Error('spawn ENOENT python')\n"
        "Error: spawn ENOENT. Cause: pythonBackendExecutable pointed at "
        "C:\\\\Python314\\\\python.exe on a machine that only has the WindowsApps "
        "stub. Fix: probe candidates with python -c 'import sys' before spawn "
        "and surface structured unavailable instead of ENOENT.")),
    dict(id="r032", ws=WS_CORE, scope="Workspace", cat="code", text=(
        "Digest mismatch failure signature from the worker log:\n"
        '{"type":"error","code":"digest-mismatch","syncId":"syn_pre_0a41..."} '
        "Happens when a page frame is mutated in flight (proxy rewriting UTF-8 "
        "BOM). Canonical JSON must be byte-stable; adding a BOM anywhere breaks "
        "sha256 equality between JS and Python.")),
    dict(id="r033", ws=WS_CORE, scope="Workspace", cat="code", text=(
        "Memory store path layout on this machine:\n"
        "C:\\Users\\JH Z\\.dsh\\memory\\daily\\2026-08-23.md\n"
        "C:\\Users\\JH Z\\.dsh\\memory\\archive\\2026-08\\*.md\n"
        "C:\\Users\\JH Z\\.dsh\\memory\\semantic-pre\\derived-corpus.json\n"
        "Never write next to the markdown; derived state stays under "
        "semantic-pre and is rebuildable at any time.")),
    dict(id="r034", ws=WS_CORE, scope="Workspace", cat="code", text=(
        "npm publish dry-run error:\n"
        "npm ERR! code E403\n"
        "npm ERR! 403 Forbidden - PUT https://registry.npmjs.org/@scope/pkg "
        "- You cannot publish over previously published versions: 0.1.29.\n"
        "Resolution: bump version in package.json before release; the release "
        "script tools/release.mjs now refuses to run without a version bump.")),
    dict(id="r035", ws=WS_CORE, scope="Workspace", cat="code", text=(
        "EPIPE crash during corpus embedding batch write:\n"
        "TypeError [ERR_STREAM_WRITE_AFTER_END]: write after end\n"
        "at writeOrBuffer (node:internal/streams/writable:931:5)\n"
        "Root cause: dispose() killed the worker while a page flush was still "
        "queued. Fix: flush queue drains before kill, and pending requests "
        "resolve with structured aborted instead of crashing the host.")),
    dict(id="r036", ws=WS_CORE, scope="Workspace", cat="code", text=(
        "Worker exit code semantics: exit code 0 on clean close_session, "
        "code 1 on unhandled stdin EOF, code 2 on --expect-epoch argument "
        "mismatch. The client treats any nonzero exit as crashed and starts "
        "a fresh epoch on the next request; derived corpus survives because "
        "it lives on disk, not in process memory.")),
    dict(id="r037", ws=WS_CORE, scope="Workspace", cat="code", text=(
        "Git guard: refusing preview-to-formal conversion when working tree "
        "is dirty.\n"
        "git status --short -> 41 untracked entries\n"
        "The release checklist requires a clean tree plus green 22-suite "
        "regression before tagging; PREVIEW-NEXT-STEPS.md tracks the gate.")),
    dict(id="r038", ws=WS_CORE, scope="Workspace", cat="code", text=(
        "Zip bomb guard in importInto: an external dump containing a 4 GiB "
        "decompressed JSON was rejected by the size gate. importInto now "
        "streams records and enforces a 256 KiB per-record cap, error code "
        "record-oversize, same rule as index_sync pages.")),
    dict(id="r039", ws=WS_CORE, scope="Workspace", cat="code", text=(
        "Windows path pitfall: DSH_HOME containing spaces must be passed to "
        "the worker as a single argv element. Python receives\n"
        '--dsh-home "D:\\dsh auto memory"\n'
        "and must not re-split on whitespace; tempfile+os.replace atomic "
        "rename also needs the directory to exist first.")),
    dict(id="r040", ws=WS_CORE, scope="Workspace", cat="code", text=(
        "torch CPU wheel thread explosion: on the Ryzen 9700X the default "
        "interop threads caused 4x slowdown from oversubscription. Fix in "
        "the bench harness: torch.set_num_threads(16) and "
        "set_num_interop_threads(1); tokenizers parallelism disabled via "
        "TOKENIZERS_PARALLELISM=false env before import.")),

    # ---------------- hard negatives: confusable twins ----------------
    # pair A: two different latency budgets
    dict(id="r051", ws=WS_CORE, scope="Workspace", cat="hardneg", text=(
        "Context push deadline budget: the whole context_push pipeline has a "
        "5 second deadline. The Python sink must return its ack before "
        "deadlineAt or the frame is marked stale and dropped. Semantic work "
        "continues asynchronously after the ack; only the ack is on the "
        "critical path.")),
    dict(id="r052", ws=WS_CORE, scope="Workspace", cat="hardneg", text=(
        "Reference tail latency budget: the reference tail packet render path "
        "has a 300 ms p95 budget inside the model-visible message assembly. "
        "This is a UI-side budget, unrelated to the 5 second context_push "
        "deadline; exceeding it drops the tail for the current turn only.")),
    # pair B: two different digest rules
    dict(id="r053", ws=WS_CORE, scope="Workspace", cat="hardneg", text=(
        "fileDigest scope: fileDigest covers one whole markdown source file. "
        "It is computed by the JS host over the file bytes and never changes "
        "while the file is untouched; the Python side receives it as opaque "
        "provenance and must echo it verbatim in candidates.")),
    dict(id="r054", ws=WS_CORE, scope="Workspace", cat="hardneg", text=(
        "recordDigest scope: recordDigest covers a single memory record "
        "inside a file, i.e. one anchored section. Editing a sibling record "
        "in the same file leaves this record's digest unchanged while "
        "fileDigest changes; both digests are required on every candidate.")),
    # pair C: two similar config gates
    dict(id="r055", ws=WS_CORE, scope="Workspace", cat="hardneg", text=(
        "activationInboxEnabled gates the Activation Inbox on the JS side: "
        "suggestion storage, claim, cooldown and delivery bookkeeping. It "
        "can be on while pythonBackendEnabled is off; in that state only "
        "fake-source activations reach the inbox.")),
    dict(id="r056", ws=WS_CORE, scope="Workspace", cat="hardneg", text=(
        "pythonBackendEnabled gates the entire Python sidecar: process "
        "spawn, wire IO and derived index writes. Turning it off while the "
        "inbox stays enabled yields zero Python processes but the inbox "
        "keeps serving its JS-side bookkeeping for other sources.")),
    # pair D: two different cooldowns
    dict(id="r057", ws=WS_CORE, scope="Workspace", cat="hardneg", text=(
        "Delivery repetition cooldown: after a memory is delivered in a "
        "reference tail and the ack lands, the same memory is suppressed "
        "from suggestions for the next 3 conversation turns. The counter "
        "lives in the inbox, keyed by memoryId plus session.")),
    dict(id="r058", ws=WS_CORE, scope="Workspace", cat="hardneg", text=(
        "Circuit breaker cooldown: the sidecar client suppresses all Python "
        "traffic for 30 wall-clock seconds after 3 consecutive failures. "
        "This is transport-level, keyed by process, and completely "
        "independent of the per-memory delivery cooldown in the inbox.")),
    # pair E: two different version keys
    dict(id="r059", ws=WS_CORE, scope="Workspace", cat="hardneg", text=(
        "contextVersion identifies the state of one request boundary: it "
        "increments as the conversation context evolves within a session. "
        "An activation quoting an old contextVersion is dropped as stale; "
        "latest-wins is enforced per session.")),
    dict(id="r060", ws=WS_CORE, scope="Workspace", cat="hardneg", text=(
        "memoryIndexVersion (idx_pre_ + 32 hex chars) identifies the whole "
        "authorized memory corpus snapshot. It changes when any indexed "
        "record changes, across sessions. Candidates quoting a version the "
        "host no longer serves are rejected before scoring is even read.")),
    # pair F: two tokenizer topics
    dict(id="r061", ws=WS_CORE, scope="Workspace", cat="hardneg", text=(
        "Query-side tokenizer cap for embedding: queries are truncated at "
        "256 tokens before encoding in the benchmark harness. Long user "
        "questions are cut from the tail; the cap exists to keep the p95 "
        "query latency inside the activation deadline.")),
    dict(id="r062", ws=WS_CORE, scope="Workspace", cat="hardneg", text=(
        "Document-side tokenizer chunking: corpus records are split into "
        "chunks of up to 256/512/1024 tokens by the model's own tokenizer. "
        "The query cap and the document chunk cap are separate policies; "
        "the 256 in each refers to different sides of the pipeline.")),
    # pair G: two scopes
    dict(id="r063", ws=WS_CORE, scope="Workspace", cat="hardneg", text=(
        "Workspace-scope memories are visible only inside the workspace "
        "they were recorded in: workspaceRef is part of every scope check "
        "from index_sync to activation validation.")),
    dict(id="r064", ws=WS_CORE, scope="User", cat="hardneg", text=(
        "User-scope memories follow the user across workspaces, but only "
        "after explicit promotion; raw conversation notes always start as "
        "Workspace scope and promotion is a separate, audited decision.")),
    # pair H: two rerankers
    dict(id="r065", ws=WS_CORE, scope="Workspace", cat="hardneg", text=(
        "bge-reranker-v2-m3 is the candidate reranker for M7-4: cross-"
        "encoder, top-50 to top-10, MIT license, ~2.2 GB. On timeout the "
        "pre-rerank order survives unchanged.")),
    dict(id="r066", ws=WS_CORE, scope="Workspace", cat="hardneg", text=(
        "Qwen3-Reranker-0.6B is the alternative reranker candidate: Apache-"
        "2.0, causal LM head, supports instruction-aware relevance. Same "
        "top-50 to top-10 contract; the M7-4 benchmark decides between "
        "them, not this M7-2 embedding benchmark.")),
    # pair I: two FAISS-adjacent notes
    dict(id="r067", ws=WS_CORE, scope="Workspace", cat="hardneg", text=(
        "M7-3 exact dense baseline: NumPy float32 matrix, L2-normalized "
        "rows, cosine by dot product, tie-break score then memoryId "
        "lexicographic. No ANN at the current corpus size.")),
    dict(id="r068", ws=WS_CORE, scope="Workspace", cat="hardneg", text=(
        "Stage-2 ANN upgrade path: FAISS IndexFlatIP is the allowed exact "
        "equivalent when the matrix outgrows RAM-friendly NumPy; HNSW only "
        "after a latency benchmark proves NumPy is insufficient above ten "
        "thousand chunks.")),
    # pair J: two zstd topics
    dict(id="r069", ws=WS_CORE, scope="Workspace", cat="hardneg", text=(
        "zstd on the websocket heartbeat channel: small heartbeat frames "
        "stay plaintext, payload frames compressed with sequence numbers "
        "for resume-after-reconnect.")),
    dict(id="r070", ws=WS_CORE, scope="Workspace", cat="hardneg", text=(
        "zstd in the importInto bulk path: external memory dumps are "
        "compressed archives; the importer streams them with a 256 KiB "
        "per-record cap after decompression.")),

    # ---------------- supersede: old claim vs correction ----------------
    dict(id="r081", ws=WS_CORE, scope="Workspace", cat="supersede-old", text=(
        "Early note on preprocessing for Chinese embeddings: run jieba word "
        "segmentation over Chinese text before feeding it to the embedding "
        "model, since the model was thought to expect pre-segmented input.")),
    dict(id="r082", ws=WS_CORE, scope="Workspace", cat="supersede-new", text=(
        "CORRECTION: do not jieba-preprocess text before embedding. Modern "
        "multilingual encoders (BGE-M3, E5, Qwen3-Embedding) ship their own "
        "subword tokenizers that handle Chinese directly; pre-segmenting "
        "destroys the model's learned token statistics and hurts recall. "
        "Chunking must operate on tokenizer ids, never on external word "
        "boundaries. This supersedes the earlier jieba note.")),
    dict(id="r083", ws=WS_CORE, scope="Workspace", cat="supersede-old", text=(
        "Old pagination rule: index_sync pages can carry up to 128 records "
        "each with no per-page byte budget.")),
    dict(id="r084", ws=WS_CORE, scope="Workspace", cat="supersede-new", text=(
        "UPDATED pagination rule: index_sync pages are capped at 64 records "
        "AND 256 KiB of JSON per page, whichever binds first; a single "
        "record whose JSON exceeds 256 KiB is rejected record-oversize "
        "rather than split. This replaces the earlier 128-record rule.")),
    dict(id="r085", ws=WS_CORE, scope="Workspace", cat="supersede-old", text=(
        "Initial worker restart policy: reuse the same workerEpoch across "
        "process restarts so in-flight requests can complete after respawn.")),
    dict(id="r086", ws=WS_CORE, scope="Workspace", cat="supersede-new", text=(
        "REVISED worker restart policy: every process start mints a fresh "
        "workerEpoch. Reusing an epoch across restarts is forbidden because "
        "a stale response could then be mistaken for a live one; pending "
        "requests fail structured instead of completing after respawn. "
        "Supersedes the reuse-epoch note.")),
    dict(id="r087", ws=WS_CORE, scope="Workspace", cat="supersede-old", text=(
        "First take on chunk identity: use chunkId as the retrieval unit "
        "and return it directly to the host as the candidate identity.")),
    dict(id="r088", ws=WS_CORE, scope="Workspace", cat="supersede-new", text=(
        "CORRECTION on candidate identity: chunkId is a derived locator "
        "only. Candidates must always carry memoryId as identity plus the "
        "full provenance tuple; the chunk that matched is diagnostics. "
        "Returning chunkId as identity breaks provenance validation. "
        "Supersedes the first-take note.")),
    dict(id="r095", ws=WS_CORE, scope="Workspace", cat="supersede-old", text=(
        "Trial approach for activation ordering: rank candidates by raw "
        "cosine score and let equal scores keep insertion order.")),
    dict(id="r096", ws=WS_CORE, scope="Workspace", cat="supersede-new", text=(
        "FREEZE on ordering: tie-break is score descending, then memoryId "
        "lexicographic ascending, deterministic everywhere. Insertion-order "
        "tie-break is non-reproducible across processes and is now "
        "forbidden. Supersedes the trial approach.")),
    dict(id="r097", ws=WS_CORE, scope="Workspace", cat="supersede-old", text=(
        "Prototype behavior: persist Python semantic state under "
        "<DSH_HOME>/memory/semantic-state/ so it survives restarts.")),
    dict(id="r098", ws=WS_CORE, scope="Workspace", cat="supersede-new", text=(
        "DECISION reversing the prototype: Python must NOT persist semantic "
        "state anywhere outside the rebuildable semantic-pre directory. "
        "Per-session state resets on worker restart by design; anything "
        "durable belongs to the JS host. Supersedes the prototype note.")),
    dict(id="r099", ws=WS_CORE, scope="Workspace", cat="supersede-old", text=(
        "Assumption from the first benchmark: embedding dimension can be "
        "mixed across models in one index as long as scores are normalized.")),
    dict(id="r100", ws=WS_CORE, scope="Workspace", cat="supersede-new", text=(
        "HARD RULE correcting the assumption: vectors of different models, "
        "revisions, dimensions or normalization configs must never share an "
        "index. Every vector binds provider/model/revision/dimension/"
        "normalization/configHash; any mismatch marks the whole derived "
        "index stale and forces a rebuild. Supersedes the mixing assumption.")),

    # ---------------- cross-workspace mirrors ----------------
    dict(id="r111", ws=WS_CORE, scope="Workspace", cat="xws-core", text=(
        "Deployment note for the dsh-core workspace: release checklist "
        "requires 22 green regression suites, clean git tree, and explicit "
        "user approval before any preview-to-formal conversion.")),
    dict(id="r112", ws=WS_OTHER, scope="Workspace", cat="xws-mirror", text=(
        "Deployment note for the internal tools workspace: release "
        "checklist requires 22 green regression suites, clean git tree, and "
        "explicit user approval before any preview-to-formal conversion.")),
    dict(id="r113", ws=WS_CORE, scope="Workspace", cat="xws-core", text=(
        "dsh-core workspace convention: daily memory files live under "
        "memory/daily/YYYY-MM-DD.md and archived monthly under "
        "memory/archive/YYYY-MM/. Anchor headings define record "
        "boundaries.")),
    dict(id="r114", ws=WS_OTHER, scope="Workspace", cat="xws-mirror", text=(
        "internal tools workspace convention: daily memory files live under "
        "memory/daily/YYYY-MM-DD.md and archived monthly under "
        "memory/archive/YYYY-MM/. Anchor headings define record "
        "boundaries.")),
    dict(id="r115", ws=WS_CORE, scope="Workspace", cat="xws-core", text=(
        "Team API key rotation schedule for dsh-core: every 90 days, "
        "staged in the secret manager first, then flipped in CI variables, "
        "never committed to the repo.")),
    dict(id="r116", ws=WS_OTHER, scope="Workspace", cat="xws-mirror", text=(
        "Team API key rotation schedule for internal tools: every 90 days, "
        "staged in the secret manager first, then flipped in CI variables, "
        "never committed to the repo.")),
    dict(id="r117", ws=WS_CORE, scope="Workspace", cat="xws-core", text=(
        "dsh-core incident contact: on-call rotation page is pinned in the "
        "workspace README; escalate to the memory-platform channel after "
        "15 minutes of sidecar unavailability.")),
    dict(id="r118", ws=WS_OTHER, scope="Workspace", cat="xws-mirror", text=(
        "internal tools incident contact: on-call rotation page is pinned "
        "in the workspace README; escalate to the platform channel after "
        "15 minutes of tooling unavailability.")),
    dict(id="r119", ws=WS_CORE, scope="Workspace", cat="xws-core", text=(
        "dsh-core benchmark hardware note: Ryzen 9700X, 32 GB RAM, RTX "
        "4070 Ti SUPER present but the sidecar benchmark runs CPU-only "
        "torch as the production-realistic configuration.")),
    dict(id="r120", ws=WS_OTHER, scope="Workspace", cat="xws-mirror", text=(
        "internal tools benchmark hardware note: Ryzen 9700X, 32 GB RAM, "
        "RTX 4070 Ti SUPER present but the tooling benchmark runs CPU-only "
        "torch as the shared-machine-friendly configuration.")),
    dict(id="r121", ws=WS_CORE, scope="Workspace", cat="xws-core", text=(
        "dsh-core scope rule for this workspace only: pythonBackendEnabled "
        "may be switched on in local preview builds but must stay false in "
        "any artifact shipped to other team members.")),
    dict(id="r122", ws=WS_OTHER, scope="Workspace", cat="xws-mirror", text=(
        "internal tools scope rule for this workspace only: "
        "pythonBackendEnabled may be switched on in local preview builds "
        "but must stay false in any artifact shipped to other team "
        "members.")),

    # ---------------- long runbooks (multi-chunk) ----------------
    dict(id="r131", ws=WS_CORE, scope="Workspace", cat="longdoc-en", text=(
        "Sidecar incident runbook, part 1 - triage. When the memory panel "
        "reports that semantic suggestions stopped, first check the breaker "
        "state in the debug projection: engine.debug.pythonBackend.stats. "
        "If breaker is open, the last three requests failed; read the "
        "structured codes before assuming a model problem. The three common "
        "codes are timeout, crashed and protocol. Timeout means the 5 "
        "second deadline expired; check machine load first, because CPU "
        "starvation on an 8-core box during a parallel build is the most "
        "frequent cause. Crashed means the worker process died; exit code "
        "1 is unexpected stdin EOF, code 2 is epoch argument mismatch, "
        "anything else is a Python exception and the stderr tail is copied "
        "into the structured failure. Protocol means the worker emitted a "
        "line that failed envelope validation: check for stdout pollution "
        "from libraries printing progress bars.\n"
        "Part 2 - recovery. Never kill the worker manually; call dispose "
        "on the client, which drains the write queue, fails pending "
        "requests with aborted, then kills the process tree. After "
        "recovery the next request spawns a fresh process with a new "
        "workerEpoch. The derived corpus on disk is still valid: model "
        "identity, revision and configHash are checked against the "
        "manifest before reuse, and a mismatch forces a full rebuild from "
        "the next index_sync.\n"
        "Part 3 - escalation. If the breaker opens three times within ten "
        "minutes with code crashed, capture the stderr file and the worker "
        "command line. Do not rerun with debug logging enabled globally; "
        "attach the bounded stderr ring buffer instead. Escalate to the "
        "memory-platform channel after fifteen minutes. While the sidecar "
        "is down, lexical_pre_v2 serves all memory reference traffic; "
        "users see the same results as a default installation with the "
        "backend disabled, which is the designed degradation path.\n"
        "Part 4 - breaker forensics detail. The breaker timeline lives in "
        "the stats projection: consecutiveFailures, openedAt, "
        "halfOpenProbes. A classic false positive looks like three "
        "timeouts in a row during a backup job; the fix is not a breaker "
        "tune but moving the backup window, because the 5 second deadline "
        "assumes an idle CPU. A true positive usually pairs one crashed "
        "with two protocol failures: a library upgrade printed a banner "
        "to stdout and every subsequent frame failed validation. Check "
        "the worker stderr for the banner before rolling anything back.\n"
        "Part 5 - derived corpus integrity. On every process start the "
        "worker re-reads derived-corpus.json and verifies the embedded "
        "identity block: provider, model name, revision, dimension, "
        "normalization and configHash. If the on-disk block disagrees "
        "with the running configuration the worker reports stale-index "
        "on the next health call and refuses to serve queries from it. "
        "The host then runs a full index_sync which rebuilds the corpus "
        "from scratch. There is no incremental patch path and no silent "
        "mixed-version serving; a mismatch is always a rebuild.\n"
        "Part 6 - postmortem checklist. Record the breaker timeline, the "
        "structured failure codes, the machine load at the time, and "
        "whether the derived corpus was rebuilt. File the worker stderr "
        "excerpt under 480 bytes per line into the incident memory record "
        "so the next triage starts from evidence.")),
    dict(id="r132", ws=WS_CORE, scope="Workspace", cat="longdoc-zh", text=(
        "记忆质量巡检手册,第一部分——日常检查。每天早上看三个指标:reference "
        "tail 命中率(目标 60% 以上)、激活建议的采纳率(用户保留或引用的比例)、"
        "以及 lexical fallback 触发次数。fallback 次数突然升高通常意味着 sidecar "
        "不稳定,先查 breaker 记录;命中率下降但 fallback 平稳,多半是记忆写入"
        "质量出了问题,抽查当天的 daily 文件,看有没有把闲聊整段存进去。\n"
        "第二部分——周度清理。每周跑一次重复检测:相似度超过阈值且同 scope 的"
        "记忆对提交 merge 建议,人工确认后合并,provenance 保留双份来源。过期"
        "判定的默认规则是 90 天未被 cite/reuse 且无 supersede 链接,删除前先归"
        "档。supersede 链接必须保持单向无环,发现环路立即断开新边。\n"
        "第三部分——月度审计。核对 evidence 投影:sesr_/wsr_ 哈希不能被反推,"
        "抽查十行确认没有原始 sessionId 泄漏。核对 semantic-pre 目录体积,如果"
        "超过 500MB 说明 embedding 维度或 chunk 策略变了没清旧目录,直接删除"
        "重建。核对 activation TTL:expiresAt 过期的建议必须已经从 inbox 清除,"
        "残留即 bug。\n"
        "第四部分——季度校准。每季度从历史会话里抽 50 条真实查询做人工标注,"
        "重跑离线评测,对比当前线上策略的 Recall@5 和 MRR。回退超过 5 个点就"
        "必须停下来查:先查是不是 corpus 漂移(记忆总量增长带来的 hard negative "
        "变多),再查是不是模型或 chunk 策略被静默更换——configHash 对不上就"
        "是后者。校准结果连同标注数据一起归档,标注数据只存脱敏后的查询文本,\n"
        "不带任何 session 身份字段。\n"
        "第五部分——升级流程。巡检发现问题先写 incident 记录,15 分钟内无法"
        "自愈的转 memory-platform 频道。所有巡检结论都以记忆形式落盘,格式是"
        "日期加结论加证据链接,方便下次检索时能看到上次的决定。")),
    dict(id="r133", ws=WS_CORE, scope="Workspace", cat="longdoc-mixed", text=(
        "M7 rollout plan (draft). Phase M7-2 ships the embedding benchmark "
        "only: three candidate models, five chunk policies, exact cosine "
        "on CPU. 本阶段不接生产 activation,不标 live。The deliverables "
        "are the benchmark report, machine-readable JSON/CSV results, the "
        "algorithm decision doc, and a CI fixture that runs without "
        "network or model downloads.\n"
        "M7-3 scope: wire the winning model behind the existing derived "
        "index rebuild path. Tokenizer replaces the placeholder single-"
        "chunk rule, chunking policy version is frozen from the benchmark, "
        "and the lexical baseline stays mandatory. Exact NumPy cosine is "
        "the only retrieval method; ANN is explicitly out.\n"
        "M7-4 到 M7-7 的顺序不能换:rerank、graph、per-session state、"
        "judgement shadow,每一步都要 benchmark 证据才能进下一步。任何一步"
        "发现回退到 M7-0/M7-1 协议语义的需求,直接停下来重新评审,不允许就地"
        "改协议。\n"
        "Rollback plan: 每个阶段的开关都默认关。pythonBackendEnabled=false "
        "时零进程零 IO,删除 semantic-pre 目录即完全回退。生产 activation 永远"
        "走 M6 validator,Python 不直接投递任何 model-visible 内容。\n"
        "Release notes draft for M7-2: no production behavior change, no "
        "new runtime dependency, benchmark artifacts under python/bench "
        "and docs. The default embedding policy stays unfrozen until the "
        "decision doc is reviewed; M7-3 must not ship without the frozen "
        "policyVersion recorded in the decision doc.\n"
        "风险登记:model license 变更( quarterly recheck of pinned "
        "revisions)、HF 不可达(offline snapshot cache is the mitigation, "
        "documented in the manifest)、CPU 主机延迟超标(latency budget "
        "p95 must stay under the 5s deadline with 10x headroom, else the "
        "smaller model wins on speed).")),

    # ---- additional mid/long docs (make chunk-size comparison meaningful) ----
    dict(id="r134", ws=WS_CORE, scope="Workspace", cat="longdoc-en", text=(
        "Evaluation contract for the semantic engine, full text. Arm set: "
        "lexical_pre_v2 as the mandatory baseline, dense-only, sparse-only, "
        "weighted fusion, RRF fusion, optional rerank, optional graph "
        "expansion, and the active-threshold arm. Every arm runs against "
        "the same query suite and the same frozen corpus snapshot; arms "
        "that need a model bind the same configHash as production.\n"
        "Metric definitions. Recall@K: fraction of queries whose gold "
        "record appears in the top K retrieved chunks, chunk mapped back "
        "to its parent record. MRR: mean of 1/rank of the first gold "
        "chunk. nDCG@10 with graded relevance where superseding records "
        "outrank superseded ones. Activation precision: accepted "
        "suggestions over delivered suggestions. False activation: "
        "suggestions the user dismissed within two turns. Leakage: any "
        "cross-session or cross-workspace item in a delivered tail; the "
        "contract target is zero and a single violation fails the suite.\n"
        "Latency budget. Query-side: encode plus search must fit p95 "
        "under 500 milliseconds on the reference CPU with the full "
        "corpus resident; the 5 second context_push deadline assumes "
        "this budget plus tenfold headroom. Corpus-side: a full rebuild "
        "of one thousand records must finish inside ten minutes, "
        "streamed in batches so the process stays responsive to health "
        "checks.\n"
        "Corpus hygiene rules. Golden queries are hand-written, never "
        "mined from logs without review. Distractor records must come "
        "from the same author and era as the gold records so style does "
        "not leak the answer. Hard negatives are reviewed by a second "
        "person. Any metric regression above two points between runs on "
        "the same snapshot is investigated as nondeterminism before it "
        "is accepted as signal.\n"
        "Reporting. Each run emits machine-readable JSON with per-query "
        "ranks, plus a CSV summary table. The decision doc cites run "
        "identifiers, never ad hoc numbers. CI replays only the fixture "
        "vectors and asserts ordering, never the live metrics.")),
    dict(id="r135", ws=WS_CORE, scope="Workspace", cat="longdoc-zh", text=(
        "部署手册(semantic sidecar 预览版)。前置检查:确认 DSH_HOME 目录可写,"
        "确认 Python 3.10 或 3.11 在 PATH 上(3.14 目前不支持 torch,别用),"
        "确认磁盘剩余空间至少 8GB(模型缓存加派生索引),确认杀毒软件没有锁定 "
        "semantic-pre 目录。预检脚本会逐项打印检查结果,任何一项失败直接退出,"
        "不会半装。\n"
        "安装步骤:第一步建独立 venv,不要复用系统 Python;第二步装 CPU 版 "
        "torch,显存机器也不建议先上 CUDA,预览阶段以 CPU 延迟为准;第三步按 "
        "manifest 里的 pinned revision 下载模型快照,下载完立刻核对 sha256,"
        "核对不过就删掉重下,禁止跳过;第四步跑一次离线自检脚本,验证 tokenizer "
        "能加载、能对样例文本出向量、维度和 manifest 一致。\n"
        "配置说明:pythonBackendEnabled 默认 false,预览版只在本地打开;"
        "contextSinkMode 在三重门全开时才会变成 python;模型路径从 manifest "
        "读,不手填。所有开关改动都要记录在变更日志里,方便回滚。\n"
        "回滚步骤:先关 pythonBackendEnabled,确认零进程;再删 semantic-pre "
        "目录;必要时连 venv 一起删。回滚后 lexical_pre_v2 顶上,用户侧无感,"
        "这是设计行为不是降级 bug。\n"
        "验证清单:装完跑 health 检查回显 corpus 视图;发一条测试 context_push "
        "看 ack;看一次 index_sync 完整走完 begin/page/commit;重启进程确认 "
        "workerEpoch 换新、旧 epoch 帧被丢弃。四项全过才算部署成功。")),
    dict(id="r136", ws=WS_CORE, scope="Workspace", cat="longdoc-mixed", text=(
        "Config reference (preview defaults). associativeMemoryEnabled: "
        "false. 开关总闸,关闭时记忆系统整体静默。contextBridgeEnabled: "
        "false. M5 桥接层,context_push 的前提。pythonBackendEnabled: "
        "false. Python sidecar 总开关,关闭时零进程零 IO 零目录。"
        "activationInboxEnabled: false. M6 inbox 开关,fake source 也"
        "依赖它。contextSinkMode: null -> fake -> python 三态,只有三重"
        "门全开才允许 python。activationSource: fake -> python,同受三重"
        "门约束。\n"
        "pythonBackendWorkerPath: 默认指向仓库内 worker_pre_v1.py;"
        "pythonBackendExecutable: 默认空,空时用 PATH 上的 python,找不到"
        "结构化报 unavailable 而不是 ENOENT 崩溃。\n"
        "requestTimeoutMs: 5000,和 context_push deadline 对齐;超时计 "
        "breaker 一次。maxLineBytes: 256KiB,单行超限 fatal 并清残留缓冲。"
        "breakerThreshold: 3 次;breakerCooldownMs: 30000。\n"
        "index_sync 预算:每页 <=64 records 且 <=256KiB,单条超限 "
        "record-oversize fail closed。chunk 策略:M7-1 占位规则是整记录"
        "单 chunk,M7-2 benchmark 后按 decision doc 冻结,冻结前任何代码"
        "不得写死某个 tokenizer。\n"
        "所有值改动都要同步更新 debug projection 里的快照,快照和实际值"
        "不一致视为配置漂移事故。")),
    dict(id="r137", ws=WS_CORE, scope="Workspace", cat="longdoc-en", text=(
        "Postmortem: the vanishing excerpt budget. Timeline. Day one, "
        "release 0.1.28 shipped the activation inbox with a 480 byte "
        "excerpt budget. Day two, Chinese-language users reported that "
        "excerpts arrived truncated mid-sentence far below the visual "
        "length limit. Day three, we reproduced it: the validator counts "
        "UTF-8 bytes, and a Chinese character costs three bytes, so a "
        "Chinese excerpt holds roughly one third the characters of an "
        "English one.\n"
        "Root cause. The original budget was calibrated against English "
        "samples only. The validator was correct per spec; the spec was "
        "calibrated wrong. The bug was in the decision, not the code.\n"
        "Fix. Two-part: first, the Python side now trims candidate "
        "excerpts at sentence boundaries before submission so the cut "
        "lands between sentences in any language; second, the budget "
        "check moved to the boundary-aware length, keeping the wire "
        "budget at 480 bytes.\n"
        "Lessons. Calibrate budgets on the multilingual corpus from day "
        "one. Add a fixture with Chinese, Japanese and mixed excerpts to "
        "the validator tests. When a budget is byte-based, document the "
        "bytes-per-character assumption next to the constant, not in a "
        "separate doc nobody rereads.\n"
        "Action items. Boundary-aware trim shipped in 0.1.29. Fixture "
        "added to the M6 suite. The budget constant now carries a "
        "comment with the calibration table for en/zh/ja.")),
    dict(id="r138", ws=WS_CORE, scope="Workspace", cat="longdoc-zh", text=(
        "设计讨论记录:activation level 的粒度。背景:level 从 index 到 full "
        "六级,最初只有 excerpt 和 full 两级,中间级别是后来加的。讨论焦点是"
        "hint 和 checklist 到底算不算独立级别。\n"
        "正方观点:hint 只给一行提示,checklist 给可勾选清单,占用的 "
        "model-visible surface 完全不同,合并会导致要么提示过多要么清单过少,"
        "粒度必须保留。反方观点:六级枚举让 Python 的建议逻辑复杂化,每次都要"
        "在六个级别里选,实测大部分场景只用 excerpt 和 checklist 两级。\n"
        "结论:保留六级,但给 Python 的建议策略加默认映射——语义分数中等给 "
        "hint,高给 excerpt,涉及步骤序列给 checklist,resource 只在检索到"
        "资源型记忆时给。full 永远需要用户显式触发,Python 不得主动建议。\n"
        "遗留问题:index 级别实际语义是什么还没有共识,下次评审再定。讨论"
        "参与者四人,结论一致通过,记录于 2026-08-21。")),

    # ---------------- distractors ----------------
    dict(id="d001", ws=WS_CORE, scope="Workspace", cat="distractor", text=(
        "Keyboard shortcut of the week: Ctrl+Shift+M toggles the memory "
        "panel; Ctrl+Shift+D opens the debug projection overlay.")),
    dict(id="d002", ws=WS_CORE, scope="Workspace", cat="distractor", text=(
        "Lunch note: the ramen place near the office closes at 14:30 now, "
        "not 15:00; team lunch moved to 11:45 on Wednesdays.")),
    dict(id="d003", ws=WS_CORE, scope="Workspace", cat="distractor", text=(
        "Reading list: RAG survey papers queued for the weekend; priority "
        "on the dense-sparse fusion ablation tables.")),
    dict(id="d004", ws=WS_CORE, scope="Workspace", cat="distractor", text=(
        "Vim plugin update: telescope fuzzy finder config moved to a new "
        "module path; remap leader-f still works.")),
    dict(id="d005", ws=WS_CORE, scope="Workspace", cat="distractor", text=(
        "Coffee machine maintenance: descale every 4 weeks; the filter "
        "change indicator lies, track it manually in the ops checklist.")),
    dict(id="d006", ws=WS_CORE, scope="Workspace", cat="distractor", text=(
        "Standup rotation: memory-platform team alternates facilitator "
        "weekly; notes go into the shared doc, not chat.")),
    dict(id="d007", ws=WS_CORE, scope="Workspace", cat="distractor", text=(
        "Windows terminal profile: use the Git Bash profile for smoke "
        "tests; PowerShell mangles UTF-8 piping in older builds.")),
    dict(id="d008", ws=WS_CORE, scope="Workspace", cat="distractor", text=(
        "Backup schedule: full disk image monthly, memory directory "
        "incremental nightly to the NAS.")),
    dict(id="d009", ws=WS_CORE, scope="Workspace", cat="distractor", text=(
        "Font preference for the panel: 13px monospace, ligatures off, "
        "line-height 1.5; larger sizes break the excerpt alignment.")),
    dict(id="d010", ws=WS_CORE, scope="Workspace", cat="distractor", text=(
        "Podcast backlog note: episode on vector DB internals queued; "
        "skip the marketing segment at the start.")),
    dict(id="d011", ws=WS_CORE, scope="Workspace", cat="distractor", text=(
        "Weekly review template: three wins, three risks, one decision "
        "revisited; keep it under one screen.")),
    dict(id="d012", ws=WS_CORE, scope="Workspace", cat="distractor", text=(
        "Train schedule: the 8:12 is more reliable than the 8:04 despite "
        "the app's on-time ranking.")),
    dict(id="d013", ws=WS_CORE, scope="Workspace", cat="distractor", text=(
        "Bookkeeping: conference travel receipts go to the finance drop "
        "box within 30 days, no exceptions since the audit.")),
    dict(id="d014", ws=WS_CORE, scope="Workspace", cat="distractor", text=(
        "Workout log: bench 5x5 stalled; deload week scheduled before "
        "attempting a new max.")),
    dict(id="d015", ws=WS_CORE, scope="Workspace", cat="distractor", text=(
        "Language study: Anki deck for reading Japanese error messages; "
        "20 new cards a day is the sustainable cap.")),
    dict(id="d016", ws=WS_CORE, scope="Workspace", cat="distractor", text=(
        "Desk setup: monitor arm arrived; recalibrate color profile after "
        "repositioning, the default drifts blue.")),
    dict(id="d017", ws=WS_CORE, scope="Workspace", cat="distractor", text=(
        "Grocery note: switch the protein powder brand back to the old "
        "one; the new one does not mix cold.")),
    dict(id="d018", ws=WS_CORE, scope="Workspace", cat="distractor", text=(
        "Game night: the group voted for the co-op farming sim over the "
        "tactical shooter; Fridays 21:00.")),
    dict(id="d019", ws=WS_CORE, scope="Workspace", cat="distractor", text=(
        "Car maintenance: tire rotation every 10000 km; the dealer "
        "schedule says 8000 but the manual disagrees.")),
    dict(id="d020", ws=WS_CORE, scope="Workspace", cat="distractor", text=(
        "Photo backup: raw files to the archive drive, edits to the "
        "cloud; never the reverse after the duplication incident.")),
    dict(id="d021", ws=WS_CORE, scope="Workspace", cat="distractor", text=(
        "Interview loop notes: candidates for the platform role get the "
        "debugging exercise first; it filters better than the theory "
        "round.")),
    dict(id="d022", ws=WS_CORE, scope="Workspace", cat="distractor", text=(
        "Onboarding doc: new joiners need repo access, the memory plugin "
        "preview build, and the runbook link on day one.")),
    dict(id="d023", ws=WS_CORE, scope="Workspace", cat="distractor", text=(
        "Budget note: conference ticket cap per person per year raised to "
        "two events; workshops count as events.")),
    dict(id="d024", ws=WS_CORE, scope="Workspace", cat="distractor", text=(
        "Whiteboard photo policy: transcribe decisions into the memory "
        "record the same day; photos rot in the shared drive.")),
    dict(id="d025", ws=WS_CORE, scope="Workspace", cat="distractor", text=(
        "Printer quirk: the office printer rejects double-sided jobs "
        "above 40 pages; split the job or print single-sided.")),
    dict(id="d026", ws=WS_CORE, scope="Workspace", cat="distractor", text=(
        "Password manager: rotate the shared vault entry after anyone "
        "leaves the team; the audit log export goes to compliance.")),
    dict(id="d027", ws=WS_CORE, scope="Workspace", cat="distractor", text=(
        "Monitoring wishlist: p95 activation latency graph next to the "
        "lexical fallback counter on the same dashboard.")),
    dict(id="d028", ws=WS_CORE, scope="Workspace", cat="distractor", text=(
        "Library due dates: two textbooks renewable once each; the "
        "interlibrary loan has no renewal.")),
    dict(id="d029", ws=WS_CORE, scope="Workspace", cat="distractor", text=(
        "Team calendar: no-meeting Wednesdays pilot extended by a month; "
        "feedback skews positive but support work shifts to Thursday.")),
    dict(id="d030", ws=WS_CORE, scope="Workspace", cat="distractor", text=(
        "Home lab: the mini PC fan curves need custom settings after the "
        "BIOS update; defaults are audible at idle.")),
    dict(id="d031", ws=WS_CORE, scope="Workspace", cat="distractor", text=(
        "Merch order: team hoodie sizes collected; reorder threshold is "
        "ten pieces to keep the print price.")),
    dict(id="d032", ws=WS_CORE, scope="Workspace", cat="distractor", text=(
        "Cooking note: the congee recipe needs the ginger in late; early "
        "ginger makes it bitter for some reason.")),
    dict(id="d033", ws=WS_CORE, scope="Workspace", cat="distractor", text=(
        "Charity run: registration closes end of month; pickup bib on "
        "race-day morning is possible but slow.")),
    dict(id="d034", ws=WS_CORE, scope="Workspace", cat="distractor", text=(
        "Dentist reminder: appointments every six months; the reminder "
        "postcard arrives after booking opens, ignore it and book early.")),
    dict(id="d035", ws=WS_CORE, scope="Workspace", cat="distractor", text=(
        "VPN profile: the new endpoint profile fixes the split-tunnel "
        "DNS leak on the travel laptop.")),
    dict(id="d036", ws=WS_CORE, scope="Workspace", cat="distractor", text=(
        "Music practice: scale routine 15 minutes daily beats a two-hour "
        "weekend session; the tutor was right.")),
    dict(id="d037", ws=WS_CORE, scope="Workspace", cat="distractor", text=(
        "Plant care: the office monstera needs watering only when the "
        "moisture meter reads 3 or below; weekly watering rots the roots.")),
    dict(id="d038", ws=WS_CORE, scope="Workspace", cat="distractor", text=(
        "Flight check-in: seat 11A on the 767 has the window misaligned; "
        "prefer 12A on that tail number.")),
    dict(id="d039", ws=WS_CORE, scope="Workspace", cat="distractor", text=(
        "Newsletter cull: unsubscribe round done; kept only two dev "
        "weeklies, one research digest.")),
    dict(id="d040", ws=WS_CORE, scope="Workspace", cat="distractor", text=(
        "Warranty registrations: log serial numbers the day hardware "
        "arrives; the portal rejects receipts older than 30 days.")),
    dict(id="d041", ws=WS_CORE, scope="Workspace", cat="distractor", text=(
        "Retry recipe for flaky home internet: router reboot then modem "
        "reboot, five minutes apart; calling support is step four, not "
        "step one.")),
    dict(id="d042", ws=WS_CORE, scope="Workspace", cat="distractor", text=(
        "Study group: the Thursday NLP paper session moved to 19:00; "
        "presentations rotate alphabetically.")),
    dict(id="d043", ws=WS_CORE, scope="Workspace", cat="distractor", text=(
        "Sourdough log: the starter peaked in 4h at 26C; adjust feeding "
        "ratio in summer.")),
    dict(id="d044", ws=WS_CORE, scope="Workspace", cat="distractor", text=(
        "Bike maintenance: chain lube every 200 km in dry weather, half "
        "that in rain; check brake pads monthly.")),
    dict(id="d045", ws=WS_CORE, scope="Workspace", cat="distractor", text=(
        "Course audit: the online compilers course has the better "
        "exercise grader; the university one has better lectures.")),
    dict(id="d046", ws=WS_CORE, scope="Workspace", cat="distractor", text=(
        "Gift note: team lead prefers books over gadgets; keep the "
        "receipt anyway.")),
    dict(id="d047", ws=WS_CORE, scope="Workspace", cat="distractor", text=(
        "Volunteer shift: food bank first Saturday monthly; swap via the "
        "shared sheet, not the group chat.")),
    dict(id="d048", ws=WS_CORE, scope="Workspace", cat="distractor", text=(
        "Recorder practice: breath marks in the second movement are "
        "editorial; the urtext omits them.")),
    dict(id="d049", ws=WS_CORE, scope="Workspace", cat="distractor", text=(
        "Tax documents: the portal upload rejects PDFs above 10 MB; "
        "split the brokerage statement by quarter.")),
    dict(id="d050", ws=WS_CORE, scope="Workspace", cat="distractor", text=(
        "Neighbors: the package room holds parcels for seven days now; "
        "the old five-day rule expired.")),
    dict(id="d051", ws=WS_CORE, scope="Workspace", cat="distractor", text=(
        "Keyboard group buy: switches ship next quarter; stabilizers "
        "come from a different vendor, do not wait for combined shipping.")),
    dict(id="d052", ws=WS_CORE, scope="Workspace", cat="distractor", text=(
        "Eye test: the optometrist books out six weeks; schedule the "
        "next one before leaving the clinic.")),
    dict(id="d053", ws=WS_CORE, scope="Workspace", cat="distractor", text=(
        "Swimming: the early lane is calmer; goggles fog less with the "
        "baby shampoo trick.")),
    dict(id="d054", ws=WS_CORE, scope="Workspace", cat="distractor", text=(
        "Package versions: node 22 LTS pinned in the toolchain; the "
        "memory plugin requires it, do not jump to the odd-numbered line.")),
    dict(id="d055", ws=WS_CORE, scope="Workspace", cat="distractor", text=(
        "Ski trip: wax for the forecast snow temp, not the air temp at "
        "breakfast; the shop chart is on the bench.")),
    dict(id="d056", ws=WS_CORE, scope="Workspace", cat="distractor", text=(
        "Board game rule dispute resolved: the expansion mission deck "
        "shuffles the traitor card back; the base game does not.")),
    dict(id="d057", ws=WS_CORE, scope="Workspace", cat="distractor", text=(
        "Piano tuning: every six months with regular playing; the last "
        "technician prefers morning slots.")),
    dict(id="d058", ws=WS_CORE, scope="Workspace", cat="distractor", text=(
        "Vaccine records: the travel clinic needs the yellow book in "
        "person; scans are not accepted for the certificate.")),
    dict(id="d059", ws=WS_CORE, scope="Workspace", cat="distractor", text=(
        "Espresso dial-in: 18g in, 36g out, 27 seconds is the current "
        "baseline; humidity shifts it by a second.")),
    dict(id="d060", ws=WS_CORE, scope="Workspace", cat="distractor", text=(
        "Code review norm: review your own PR once before requesting "
        "reviewers; the self-pass catches half the typos.")),
]

QUERIES = [
    # zh -> en
    dict(id="q001", text="Python 进程重启之后,旧 epoch 的响应怎么处理?", lang="zh", cat="zh2en", gold=["r001"], neg=[]),
    dict(id="q002", text="stdout 一行多个 JSON 或者超长的行会被怎么处理?", lang="zh", cat="zh2en", gold=["r002"], neg=[]),
    dict(id="q003", text="分页同步的 digest 对不上会发生什么?", lang="zh", cat="zh2en", gold=["r003"], neg=["r032"]),
    dict(id="q004", text="连续失败几次之后会熔断?熔断多久恢复?", lang="zh", cat="zh2en", gold=["r004"], neg=["r058"]),
    dict(id="q005", text="语义后端挂了用户会看到什么?", lang="zh", cat="zh2en", gold=["r005"], neg=[]),
    dict(id="q006", text="激活建议的过期步数范围是多少?", lang="zh", cat="zh2en", gold=["r006"], neg=[]),
    dict(id="q007", text="excerpt 长度限制按什么统计?超了是截断还是拒绝?", lang="zh", cat="zh2en", gold=["r007"], neg=[]),
    dict(id="q008", text="Python 能不能把 evidence 反查回 session?", lang="zh", cat="zh2en", gold=["r008"], neg=[]),
    dict(id="q009", text="reference tail 送达之后 seen 什么时候落?", lang="zh", cat="zh2en", gold=["r009"], neg=[]),
    dict(id="q010", text="chunkId 能不能当记忆的唯一标识用?", lang="zh", cat="zh2en", gold=["r010"], neg=["r088"]),

    # en -> zh
    dict(id="q011", text="Why were same-day logs being archived in the early-morning window?", lang="en", cat="en2zh", gold=["r011"], neg=[]),
    dict(id="q012", text="What is the rolling day boundary the engine uses for 'today'?", lang="en", cat="en2zh", gold=["r012"], neg=[]),
    dict(id="q013", text="How to stop the memory panel from popping up automatically?", lang="en", cat="en2zh", gold=["r013"], neg=[]),
    dict(id="q014", text="Why did the stale token detector never fire?", lang="en", cat="en2zh", gold=["r014"], neg=[]),
    dict(id="q015", text="What was the websocket fix that improved connection lifetime?", lang="en", cat="en2zh", gold=["r015"], neg=[]),
    dict(id="q016", text="Why did npm installs get an empty shell package?", lang="en", cat="en2zh", gold=["r016"], neg=[]),
    dict(id="q017", text="How did the reminder key change to help prefix caching?", lang="en", cat="en2zh", gold=["r017"], neg=[]),
    dict(id="q018", text="When does the panel auto-expand on returning after a break?", lang="en", cat="en2zh", gold=["r018"], neg=[]),
    dict(id="q019", text="What visual style did the settings dialog adopt?", lang="en", cat="en2zh", gold=["r019"], neg=[]),
    dict(id="q020", text="How can an external system bulk import existing memories?", lang="en", cat="en2zh", gold=["r020"], neg=["r038"]),

    # mixed
    dict(id="q021", text="context_push 的 frame 大小 deadline 是多少?", lang="mixed", cat="mixed", gold=["r021"], neg=[]),
    dict(id="q022", text="which fields does the M6 validator hard-check on activations?", lang="mixed", cat="mixed", gold=["r022"], neg=[]),
    dict(id="q023", text="开 python sink 需要哪几个 switch 同时打开?", lang="mixed", cat="mixed", gold=["r023"], neg=[]),
    dict(id="q024", text="semantic-pre 目录删掉会怎样?为什么可以随时删?", lang="mixed", cat="mixed", gold=["r024"], neg=[]),
    dict(id="q025", text="canonical JSON 的规则是什么,为什么 digest 会 mismatch?", lang="mixed", cat="mixed", gold=["r025"], neg=["r032"]),
    dict(id="q026", text="evidence 有哪几种?missing 算负面信号吗?", lang="mixed", cat="mixed", gold=["r026"], neg=[]),
    dict(id="q027", text="activation level 有几级,谁有最终否决权?", lang="mixed", cat="mixed", gold=["r027"], neg=[]),
    dict(id="q028", text="并发会话串线的老 bug 是怎么修的?", lang="mixed", cat="mixed", gold=["r028"], neg=[]),

    # code
    dict(id="q031", text="spawn ENOENT python 报错怎么处理", lang="code", cat="code", gold=["r031"], neg=[]),
    dict(id="q032", text="digest-mismatch error code 出现的原因 BOM", lang="code", cat="code", gold=["r032"], neg=[]),
    dict(id="q033", text="semantic-pre derived-corpus.json 路径在哪", lang="code", cat="code", gold=["r033"], neg=[]),
    dict(id="q034", text="npm ERR 403 previously published versions 0.1.29", lang="code", cat="code", gold=["r034"], neg=[]),
    dict(id="q035", text="ERR_STREAM_WRITE_AFTER_END dispose kill worker", lang="code", cat="code", gold=["r035"], neg=[]),
    dict(id="q036", text="worker exit code 1 stdin EOF epoch mismatch 是什么", lang="code", cat="code", gold=["r036"], neg=[]),
    dict(id="q037", text="release 被 dirty working tree 挡住了 git status untracked", lang="code", cat="code", gold=["r037"], neg=[]),
    dict(id="q038", text="importInto 4GB decompressed zip record-oversize", lang="code", cat="code", gold=["r038"], neg=[]),
    dict(id="q039", text="dsh-home 带空格 参数传递 python argv", lang="code", cat="code", gold=["r039"], neg=[]),
    dict(id="q040", text="Ryzen CPU torch threads oversubscription 慢", lang="code", cat="code", gold=["r040"], neg=[]),

    # hard negatives (query targets one twin; twin must NOT outrank gold)
    dict(id="q051", text="sidecar 请求的整体 deadline 是几秒,ack 超时会怎样", lang="zh", cat="hardneg", gold=["r051"], neg=["r052"]),
    dict(id="q052", text="reference tail 渲染的 p95 延迟预算是多少", lang="zh", cat="hardneg", gold=["r052"], neg=["r051"]),
    dict(id="q053", text="fileDigest 覆盖的范围是什么", lang="mixed", cat="hardneg", gold=["r053"], neg=["r054"]),
    dict(id="q054", text="改了同文件里的另一条记录,recordDigest 会变吗", lang="zh", cat="hardneg", gold=["r054"], neg=["r053"]),
    dict(id="q055", text="activationInboxEnabled 控制什么,不开 python 时还能用吗", lang="mixed", cat="hardneg", gold=["r055"], neg=["r056"]),
    dict(id="q056", text="pythonBackendEnabled 关掉之后还有 Python 进程吗", lang="zh", cat="hardneg", gold=["r056"], neg=["r055"]),
    dict(id="q057", text="同一条记忆投递之后多少轮内不会再推荐", lang="zh", cat="hardneg", gold=["r057"], neg=["r058"]),
    dict(id="q058", text="熔断器打开的 30 秒和投递冷却是一个东西吗", lang="zh", cat="hardneg", gold=["r058"], neg=["r057"]),
    dict(id="q059", text="contextVersion 过期的 activation 会被怎样", lang="mixed", cat="hardneg", gold=["r059"], neg=["r060"]),
    dict(id="q060", text="memoryIndexVersion 的格式是什么,什么时候变", lang="mixed", cat="hardneg", gold=["r060"], neg=["r059"]),
    dict(id="q061", text="query 编码前的 token 截断上限是多少", lang="mixed", cat="hardneg", gold=["r061"], neg=["r062"]),
    dict(id="q062", text="文档侧 chunk 的大小上限是 tokenizer 的什么单位", lang="mixed", cat="hardneg", gold=["r062"], neg=["r061"]),
    dict(id="q063", text="Workspace scope 的记忆什么时候可见", lang="mixed", cat="hardneg", gold=["r063"], neg=["r064"]),
    dict(id="q064", text="User scope 记忆怎么跨 workspace,需要什么动作", lang="mixed", cat="hardneg", gold=["r064"], neg=["r063"]),
    dict(id="q065", text="bge-reranker-v2-m3 的许可证和 rerank 范围", lang="mixed", cat="hardneg", gold=["r065"], neg=["r066"]),
    dict(id="q066", text="Qwen3-Reranker-0.6B 的许可证和用途", lang="mixed", cat="hardneg", gold=["r066"], neg=["r065"]),
    dict(id="q067", text="现在 dense 检索的 tie-break 规则", lang="mixed", cat="hardneg", gold=["r067"], neg=["r068"]),
    dict(id="q068", text="什么时候才允许引入 HNSW", lang="zh", cat="hardneg", gold=["r068"], neg=["r067"]),

    # supersede (gold = correction; old claim must rank below)
    dict(id="q081", text="中文文本送 embedding 之前要做 jieba 分词吗", lang="zh", cat="supersede", gold=["r082"], neg=[], old=["r081"]),
    dict(id="q082", text="should Chinese text be word-segmented before embedding", lang="en", cat="supersede", gold=["r082"], neg=[], old=["r081"]),
    dict(id="q083", text="index_sync 一页最多多少条记录,字节上限多少", lang="zh", cat="supersede", gold=["r084"], neg=[], old=["r083"]),
    dict(id="q084", text="worker 重启后 workerEpoch 沿用旧的吗", lang="zh", cat="supersede", gold=["r086"], neg=[], old=["r085"]),
    dict(id="q085", text="candidate 的身份字段是 memoryId 还是 chunkId", lang="mixed", cat="supersede", gold=["r088"], neg=[], old=["r087"]),
    dict(id="q086", text="排序平分的时候按什么打破 tie", lang="zh", cat="supersede", gold=["r096"], neg=[], old=["r095"]),
    dict(id="q087", text="Python 的会话语义状态可以持久化到 semantic-pre 之外吗", lang="zh", cat="supersede", gold=["r098"], neg=[], old=["r097"]),
    dict(id="q088", text="不同模型的向量能混在同一个索引里吗", lang="zh", cat="supersede", gold=["r100"], neg=[], old=["r099"]),

    # cross-workspace (scoped to WS_CORE; mirror in WS_OTHER must never surface)
    dict(id="q111", text="dsh-core 发正式版之前要满足哪些检查", lang="zh", cat="xws", gold=["r111"], neg=[], mirror="r112"),
    dict(id="q113", text="dsh-core daily memory files 存放位置和归档结构", lang="mixed", cat="xws", gold=["r113"], neg=[], mirror="r114"),
    dict(id="q115", text="dsh-core team API key rotation policy", lang="en", cat="xws", gold=["r115"], neg=[], mirror="r116"),
    dict(id="q117", text="dsh-core sidecar 挂了 15 分钟之后升级给谁", lang="zh", cat="xws", gold=["r117"], neg=[], mirror="r118"),
    dict(id="q119", text="benchmark 用的 CPU 型号和 torch 配置 dsh-core", lang="mixed", cat="xws", gold=["r119"], neg=[], mirror="r120"),
    dict(id="q121", text="本地 preview 可以开 pythonBackendEnabled 吗,给别人的构建呢", lang="mixed", cat="xws", gold=["r121"], neg=[], mirror="r122"),

    # long docs (gold answer sits deep inside multi-chunk runbooks)
    dict(id="q131", text="sidecar stderr 里 exit code 2 是什么意思,怎么恢复", lang="zh", cat="longdoc", gold=["r131"], neg=[]),
    dict(id="q132", text="sidecar 挂掉期间用户看到的记忆引用是谁提供的", lang="zh", cat="longdoc", gold=["r131"], neg=[]),
    dict(id="q133", text="巡检发现 semantic-pre 超过 500MB 怎么处理", lang="zh", cat="longdoc", gold=["r132"], neg=[]),
    dict(id="q134", text="supersede 链接出现环路怎么办", lang="zh", cat="longdoc", gold=["r132"], neg=[]),
    dict(id="q135", text="M7-2 benchmark 的交付物有哪些,CI fixture 会不会联网", lang="zh", cat="longdoc", gold=["r133"], neg=[]),
    dict(id="q136", text="M7 阶段顺序能换吗,发现需要改协议怎么办", lang="zh", cat="longdoc", gold=["r133"], neg=[]),
    # deep-section queries for the extended/mid-long docs
    dict(id="q137", text="评测契约里查询侧 encode 加检索的 p95 预算是多少毫秒", lang="zh", cat="longdoc", gold=["r134"], neg=["r052"]),
    dict(id="q138", text="leakage 指标的目标值是多少,违反几次测试算失败", lang="mixed", cat="longdoc", gold=["r134"], neg=[]),
    dict(id="q139", text="semantic sidecar 回滚的完整步骤有哪些", lang="zh", cat="longdoc", gold=["r135"], neg=[]),
    dict(id="q140", text="sidecar 部署前的前置检查都有什么", lang="zh", cat="longdoc", gold=["r135"], neg=[]),
    dict(id="q141", text="breakerThreshold 默认几次,cooldown 多少毫秒", lang="mixed", cat="longdoc", gold=["r136"], neg=["r058"]),
    dict(id="q142", text="单条 record JSON 超过页预算会怎么处理", lang="zh", cat="longdoc", gold=["r136"], neg=["r084"]),
    dict(id="q143", text="中文 excerpt 被提前截断的根因是什么", lang="zh", cat="longdoc", gold=["r137"], neg=["r007"]),
    dict(id="q144", text="480 字节预算事故的教训有哪些", lang="zh", cat="longdoc", gold=["r137"], neg=[]),
    dict(id="q145", text="activation level 最终保留几级,full 由谁触发", lang="zh", cat="longdoc", gold=["r138"], neg=[]),
    dict(id="q146", text="hint 和 checklist 两个级别要不要合并,结论是什么", lang="zh", cat="longdoc", gold=["r138"], neg=[]),
    dict(id="q147", text="worker 启动时怎么校验 derived corpus 的 identity,对不上怎么办", lang="zh", cat="longdoc", gold=["r131"], neg=[]),
    dict(id="q148", text="季度校准发现指标回退超过 5 个点先查什么", lang="zh", cat="longdoc", gold=["r132"], neg=[]),
]


def corpus_stats():
    by_cat = {}
    for r in RECORDS:
        by_cat[r["cat"]] = by_cat.get(r["cat"], 0) + 1
    return {
        "records": len(RECORDS),
        "queries": len(QUERIES),
        "workspaces": sorted({r["ws"] for r in RECORDS}),
        "by_category": by_cat,
        "query_langs": {l: sum(1 for q in QUERIES if q["lang"] == l)
                        for l in ("zh", "en", "mixed", "code")},
    }
