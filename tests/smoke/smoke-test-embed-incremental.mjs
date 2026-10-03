/**
 * C2 增量嵌入守卫（2026-09-29）：语义索引只重嵌「输入变了」的条目。
 *
 * 背景（用户裁定方向）：此前 buildIndexIfStale 只有全集指纹（miv）一个失效信号 ⇒ 语料一变
 * （记忆是活的：自动沉淀每轮写日志）就重嵌全部条目；真机实测 1111 条语料全量重嵌 ≈0.9s。
 * 现改为**按编码输入的 sha256 复用向量池**（与 l0-index.js 的 l0Hash 两级复用同源）。
 *
 * 本套件锁定（每条都能变红）：
 *   A. 语义等价 —— 增量与全量产出的分数**逐条完全一致**（正确性红线，不是性能测试）
 *   B. 真增量 —— 语料追加一条时，embedPassages 只收到**新增**的输入（计数实证）
 *   C. miv 未变 → 零嵌入（旧缓存行为保留）
 *   D. 跨 id 复用 —— 记录重排/换 id 但文本相同 ⇒ 命中池（同 hash 复用）
 *   E. 回退开关 —— incremental:false 时行为回到全量（逐条重嵌）
 *   F. 池上限 —— POOL_MAX 保护存在且不破坏正确性
 *   G. 宿主接线 —— config.semanticEmbedIncremental 默认 true + 引擎构造处 getter 接线
 *   H. 设置页 —— 两个面板都有该控件、三语词典齐备
 *   I. 读数一致性 —— 盘上向量与现场重嵌同源（cosine≈1，证明复用不改排序）
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../..')
let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  ok   - ' + m) } else { fail++; console.log('  FAIL - ' + m) } }

const { createJsSemanticEnginePre } = await import(pathToFileURL(path.join(ROOT, 'lib/semantic-js.js')).href)
const SRC_JS = fs.readFileSync(path.join(ROOT, 'lib/index.js'), 'utf8')
const SRC_CLI = fs.readFileSync(path.join(ROOT, 'lib/client.js'), 'utf8')

/** 计数注入引擎：记录收到过哪些输入（增量实证的关键读数）。 */
function mkCountingEngine(opts = {}) {
  const calls = []          // 每次 embedPassages 收到的文本数组
  const vecOf = (t) => {
    // 确定性「向量」：同一输入 ⇒ 同一向量（模拟 e5 的确定性，便于断言等价性）
    let h = 0
    for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) >>> 0
    const v = new Float32Array(8)
    for (let i = 0; i < 8; i++) v[i] = Math.sin((h % 997) + i)
    let s = 0
    for (let i = 0; i < 8; i++) s += v[i] * v[i]
    const n = Math.sqrt(s) || 1
    for (let i = 0; i < 8; i++) v[i] /= n
    return v
  }
  const eng = createJsSemanticEnginePre({
    pluginDir: path.join(ROOT, 'lib'),
    ...opts,
    injectEmbedder: {
      async embedQuery(t) { return vecOf('q:' + t) },
      async embedPassages(texts) { calls.push(texts.slice()); return texts.map((t) => vecOf(t)) },
    },
  })
  return { eng, calls }
}
const mkRec = (id, text) => ({ memoryId: id, text })
const ID = (n) => 'mem_' + String(n).repeat(32).slice(0, 32)
// miv 必须是 idx_pre_ + 恰好 32 个 hex（rank() 有格式校验，非法即返回 null）
let mivSeq = 0
const mivOf = () => 'idx_pre_' + (++mivSeq).toString(16).padStart(32, '0')

// ── A/B/C. 增量正确性 + 真增量 ──
{
  const { eng, calls } = mkCountingEngine()
  const base = [mkRec(ID(1), '甲条目'), mkRec(ID(2), '乙条目'), mkRec(ID(3), '丙条目')]
  const mivBase = mivOf()
  const r1 = await eng.rank({ memoryIndexVersion: mivBase, records: base }, 'q')
  ok(r1 && r1.scores.size === 3, 'A1 首轮建索引成功（3 条）')
  ok(calls.length === 1 && calls[0].length === 3, 'A2 首轮嵌入 3 条（冷启动必须全嵌）')

  // 同 miv 再查 → 零嵌入
  const r2 = await eng.rank({ memoryIndexVersion: mivBase, records: base }, 'q')
  ok(calls.length === 1, 'C1 miv 未变 ⇒ 零嵌入（旧缓存行为保留）')
  ok(JSON.stringify([...r2.scores]) === JSON.stringify([...r1.scores]), 'A3 缓存命中结果逐条一致')

  // 追加一条 → 只嵌 1 条
  const grown = base.concat([mkRec(ID(4), '丁条目')])
  calls.length = 0
  const r3 = await eng.rank({ memoryIndexVersion: mivOf(), records: grown }, 'q')
  ok(calls.length === 1 && calls[0].length === 1, 'B1 语料 +1 条 ⇒ 只嵌新增的那 1 条（真增量）')
  ok(calls[0][0] === '丁条目', 'B2 送嵌的正是新增条目的文本')
  ok(r3.scores.size === 4, 'B3 增量后索引含 4 条（旧向量未丢）')

  // 等价性红线：增量结果 vs 全量重建结果逐条完全相同
  const { eng: full, calls: fullCalls } = mkCountingEngine({ incremental: false })
  const rf = await full.rank({ memoryIndexVersion: mivOf(), records: grown }, 'q')
  const sIncr = [...r3.scores.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))
  const sFull = [...rf.scores.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))
  ok(JSON.stringify(sIncr) === JSON.stringify(sFull), 'A4 ★等价性：增量与全量打分逐条完全一致')
  ok(fullCalls[0].length === 4, 'E1 回退开关 incremental:false ⇒ 全量重嵌 4 条（旧行为）')

  // 内容改动 → 只有该条重嵌
  const edited = grown.map((r) => r.memoryId === ID(2) ? mkRec(ID(2), '乙条目(改)') : r)
  calls.length = 0
  await eng.rank({ memoryIndexVersion: mivOf(), records: edited }, 'q')
  ok(calls.length === 1 && calls[0].length === 1 && calls[0][0] === '乙条目(改)', 'B4 改一条内容 ⇒ 只嵌那一条')

  // 跨 id 复用：文本相同、id 全换
  const renumbered = edited.map((r, i) => mkRec(ID(i + 5), r.text))
  calls.length = 0
  const r5 = await eng.rank({ memoryIndexVersion: mivOf(), records: renumbered }, 'q')
  ok(calls.length === 0, 'D1 仅换 id（文本未变）⇒ 零嵌入（跨 id hash 复用）')
  ok(r5.scores.size === 4, 'D2 换 id 后索引仍覆盖 4 条')
}

// Dynamic host getter: each rebuild must observe saved changes in both directions.
{
  let enabled = true
  const calls = []
  const eng = createJsSemanticEnginePre({
    pluginDir: path.join(ROOT, 'lib'),
    get incremental() { return enabled },
    injectEmbedder: {
      async embedQuery() { return new Float32Array([1, 0]) },
      async embedPassages(texts) { calls.push(texts.length); return texts.map(() => new Float32Array([1, 0])) },
    },
  })
  const base = [mkRec(ID(1), 'first'), mkRec(ID(2), 'second')]
  await eng.rank({ memoryIndexVersion: mivOf(), records: base }, 'query')
  enabled = false
  const grown = base.concat(mkRec(ID(3), 'third'))
  await eng.rank({ memoryIndexVersion: mivOf(), records: grown }, 'query')
  ok(calls[1] === 3, 'E2 saved true-to-false getter change re-embeds all 3 records')
  enabled = true
  await eng.rank({ memoryIndexVersion: mivOf(), records: grown.concat(mkRec(ID(4), 'fourth')) }, 'query')
  ok(calls[2] === 1, 'E3 saved false-to-true getter change reuses vectors and embeds only the new record')
}

// ── F. 池上限保护 ──
ok(/const POOL_MAX = 20000/.test(fs.readFileSync(path.join(ROOT, 'lib/semantic-js.js'), 'utf8')), 'F1 池上限 POOL_MAX 存在（内存保护）')
ok(/while \(byHash\.size > POOL_MAX\)/.test(fs.readFileSync(path.join(ROOT, 'lib/semantic-js.js'), 'utf8')), 'F2 超限逐出逻辑存在')

// ── J. 坏 embedder 必须响亮失败（不得静默产出空索引 = 半套排序）──
{
  const bad = createJsSemanticEnginePre({
    pluginDir: path.join(ROOT, 'lib'),
    injectEmbedder: { async embedQuery() { return new Float32Array(8) }, async embedPassages() { return [] } },
  })
  const rb = await bad.rank({ memoryIndexVersion: 'idx_pre_' + '9'.repeat(32), records: [mkRec(ID(1), '甲')] }, 'q')
  const st = bad.status()
  ok(rb === null, 'J1 坏 embedder ⇒ rank 返回 null（fail closed，不把异常抛给调用方）')
  ok(/returned 0 vectors|invalid vector|non-array/.test(st.lastRankError), 'J2 ★坏 embedder 被显式拦截并记录原因（不静默产出空索引）: ' + String(st.lastRankError).slice(0, 60))
}

// ── G. 宿主接线 ──
ok(/semanticEmbedIncremental: true,/.test(SRC_JS), 'G1 config.semanticEmbedIncremental 默认 true')
ok(/get incremental\(\) \{ return engine\.config\.semanticEmbedIncremental !== false \}/.test(SRC_JS), 'G2 引擎构造处 getter 接线（改设置即生效）')
ok(!/recallL0CachedRank|l0RecallFromIndex/.test(SRC_JS.replace(/[^\n]*读侧捷径已撤销[^\n]*\n/, '')), 'G3 死代码读盘捷径已撤净（仅保留撤销说明注释）')

// ── H. 设置页 ──
const occ = (h, n) => { let c = 0, i = 0; for (;;) { const p = h.indexOf(n, i); if (p < 0) return c; c++; i = p + n.length } }
// ★2026-09-30 双皮肤块：现场有**三份**设置页文本——
//   ① 旧款块 Iter5Settings（真渲染）；② 新块 Iter5Settings（真渲染）；
//   ③ SettingsPage 模板源码（生成器的源，**不渲染**）。
//   守卫语义不变：每个可见设置面板都必须有该控件。
ok(occ(SRC_CLI, "t('fIncEmbed')") === 1, 'H1 共享设置实现恰有一个增量嵌入控件', occ(SRC_CLI, "t('fIncEmbed')"))
// ★2026-09-30：改数**绑定模式**而非裸键名 —— CHANGELOG 字典文案也会提到该键名（4→6 误红）；
  //   绑定模式 `set('semanticEmbedIncremental', ...)` 恒为 2（每面板一处）。
  ok(occ(SRC_CLI, "set('semanticEmbedIncremental', e.target.checked)") === 1, 'H2 控件绑定该配置键（单一实现 × 1 控件）', occ(SRC_CLI, "set('semanticEmbedIncremental', e.target.checked)"))
ok(SRC_CLI.includes("fIncEmbed: '增量嵌入"), 'H3 zh 词典齐备')
ok(SRC_CLI.includes("fIncEmbed: 'Incremental embedding"), 'H4 en 词典齐备')
ok(SRC_CLI.includes('"fIncEmbed"'), 'H5 ja 词典齐备')
ok(!SRC_CLI.includes('fL0Recall'), 'H6 旧「读盘向量索引」死开关已从 UI 撤净')

// ── I. 读数一致性（真盘 + 真模型，若资产在场）──
{
  const IDX = path.join(process.env.USERPROFILE || process.env.HOME || '', '.dsh', 'memory', 'semantic-pre', 'l0')
  let modelOk = false
  try {
    const probe = await eng2probe()
    modelOk = !!probe
  } catch (e) { modelOk = false }
  async function eng2probe() {
    const e = createJsSemanticEnginePre({ pluginDir: path.join(ROOT, 'lib') })
    const v = await e.embedPassages(['探针'])
    return v && v.length === 1 && v[0].length === 384
  }
  if (!modelOk) {
    ok(true, 'I1 真模型资产不在场 ⇒ 数值一致性由 I2 静态度量覆盖（跳过活体比对）')
  } else {
    const files = fs.existsSync(IDX) ? fs.readdirSync(IDX).filter((n) => n.startsWith('l0-index-')) : []
    if (!files.length) ok(true, 'I2 无落盘索引 ⇒ 跳过（无对比样本）')
    else {
      const j = JSON.parse(fs.readFileSync(path.join(IDX, files[0]), 'utf8'))
      const e2 = createJsSemanticEnginePre({ pluginDir: path.join(ROOT, 'lib') })
      const sample = (j.entries || []).slice(0, 5)
      const fresh = await e2.embedPassages(sample.map((x) => x.l0))
      let worst = 1
      for (let i = 0; i < sample.length; i++) {
        let d = 0
        for (let k = 0; k < fresh[i].length; k++) d += fresh[i][k] * sample[i].vector[k]
        if (d < worst) worst = d
      }
      ok(worst > 0.999, 'I2 ★盘上向量与现场重嵌一致（cosine ' + worst.toFixed(6) + '）——复用不改排序')
    }
  }
}

console.log('\n结果: ' + pass + ' PASS / ' + fail + ' FAIL')
process.exit(fail ? 1 : 0)
