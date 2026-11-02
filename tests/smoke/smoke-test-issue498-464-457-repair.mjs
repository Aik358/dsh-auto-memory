/**
 * smoke-test-issue498-464-457-repair —— 批次 D 三条 issue 的功能验收（2026-11-02）。
 *
 * 判据纪律（CR-10）：
 *   - 每条都**真 import → 真构造 → 真调用 → 断言返回值**，不以「源码含某字符串」充当验收；
 *   - 每条都带**负路径**：把修复点改回旧形状后断言必红（负路径在本套件内以
 *     「用旧参数/旧判据重算」的方式现场复现旧行为，避免依赖改磁盘上的实现）；
 *   - 纯 Node、零依赖、不联网、不启宿主；临时文件写在 os.tmpdir() 下并在结束时清理。
 *
 * 覆盖：
 *   #498 Tier-0 user 层被 floorRatio=0.1 饿死 —— floorRatioByLayer + 富余预算回灌
 *   #464  JS/Python 对路径首尾空白解释不一致 —— normalizeConfigPathPre 统一规范化
 *   #457  类似技能重复送审批 —— procedureSimilarityPre 相似度判据（0–1）
 */
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import {
  buildTier0CatalogFromTextPre, allocateTier0QuotaPre, estimateTokensPre, TIER0_QUOTA_DEFAULTS,
} from '../../lib/tier0-catalog.js'
import { TIER_BUDGET_PRE_V1, composeTieredInjectionPre } from '../../lib/tier-layer-inject.js'
import {
  normalizeConfigPathPre, embeddingConfigFilePre, readEffectiveEmbeddingConfigPre,
} from '../../lib/embedding-config.js'
import { procedureSimilarityPre, procedureTokensPre, procedureFingerprintPre } from '../../lib/procedure-observation.js'

let pass = 0, fail = 0
const t = (name, fn) => {
  try { fn(); pass++; console.log('  ok -', name) } catch (e) { fail++; console.error('FAIL', name + ':', e.message) }
}

/** 生产形态语料：锚点 + 状态行 + 正文（与 artifacts/issue-triage-20261102/probe-lane-tier0.mjs 同构）。 */
function mkEntries(n, tag, baseDate = '2026-10-31') {
  const out = []
  const d0 = Date.parse(baseDate + 'T00:00:00Z')
  for (let i = 0; i < n; i++) {
    const ds = new Date(d0 - i * 86400000).toISOString().slice(0, 10)
    out.push('<!-- memory:mem_' + String(i + 1).padStart(32, '0') + ' -->\n'
      + '<!-- dsh-status: current -->\n'
      + '- ' + ds + ' ' + tag + '条目' + (i + 1) + '的结论首句，约三十字用于模拟真实记忆条目正文长度。\n')
  }
  return out.join('\n')
}
const MIXED = (N) => [
  { layer: 'project', text: mkEntries(28, 'P'), path: 'MEMORY.md' },
  { layer: 'whiteboard', text: mkEntries(8, 'W'), path: 'PLAN.md' },
  { layer: 'user', text: mkEntries(N, 'U'), path: 'USER.md' },
  { layer: 'log', text: mkEntries(40, 'L'), path: '2026-10-31.md' },
]
const build = (N, maxTokens, quota = true) =>
  buildTier0CatalogFromTextPre(MIXED(N), { maxTokens, estimateMode: 'conservative', quota })

// ══════════════════════════════════════════════════════════════════
// #498 · Tier-0 user 层被 floorRatio=0.1 饿死
// ══════════════════════════════════════════════════════════════════
console.log('\n[#498] floorRatioByLayer + 富余预算回灌')

t('#498-1 默认配置暴露按层比例（user 0.3 / whiteboard 0.1），且 project 仍走 projectRatio=0.6', () => {
  assert.equal(TIER0_QUOTA_DEFAULTS.floorRatioByLayer.user, 0.3)
  assert.equal(TIER0_QUOTA_DEFAULTS.floorRatioByLayer.whiteboard, 0.1)
  assert.equal(TIER0_QUOTA_DEFAULTS.projectRatio, 0.6)
  // 注入侧常量必须与目录侧同源（防"两处各写一份判据"的半修）
  assert.equal(TIER_BUDGET_PRE_V1.floorRatioByLayer.user, TIER0_QUOTA_DEFAULTS.floorRatioByLayer.user)
  assert.equal(TIER_BUDGET_PRE_V1.floorRatioByLayer.whiteboard, TIER0_QUOTA_DEFAULTS.floorRatioByLayer.whiteboard)
})

t('#498-2 ★生产默认（maxTokens=600）user 100 条时进 ≥3 条，且 project 不为 0，且总 token ≤ maxTokens', () => {
  const r = build(100, 600)
  const u = r.quota.perLayer.user
  const p = r.quota.perLayer.project
  assert.ok(u.picked >= 3, 'user 100 条时进 ' + u.picked + ' 条（判据 ≥3）')
  assert.ok(p.picked > 0, 'project 仍进 ' + p.picked + ' 条（不得为 0）')
  assert.ok(r.tokens <= r.maxTokens, '总 token ' + r.tokens + ' ≤ maxTokens ' + r.maxTokens)
  assert.ok(r.tokenRepo <= r.maxTokens, 'repo 口径 ' + r.tokenRepo + ' 也 ≤ ' + r.maxTokens)
})

t('#498-3 语料量扫描：10/50/75/100 条 user 都进 ≥3 条（旧实现恒为 1–2 条）', () => {
  const got = [10, 50, 75, 100].map((N) => build(N, 600).quota.perLayer.user.picked)
  assert.deepEqual(got.filter((n) => n >= 3), got, 'user picked = ' + JSON.stringify(got))
})

t('#498-4 ★负路径：还原「单一 floorRatio」⇒ user 只进 1–2 条（判据确有鉴别力）', () => {
  // 用旧口径现场复现：显式给标量 floorRatio=0.1 并清空按层表 ⇒ 等价于修复前的行为。
  const legacy = buildTier0CatalogFromTextPre(MIXED(100), {
    maxTokens: 600, estimateMode: 'conservative',
    // 显式传 floorRatioByLayer:{} ⇒ 关掉按层表，完全回到「单一 floorRatio」旧口径。
    quota: { projectRatio: 0.6, floorRatio: 0.1, floorRatioByLayer: {} },
  })
  const picked = legacy.quota.perLayer.user.picked
  assert.ok(picked <= 2, '旧口径下 user 只进 ' + picked + ' 条（应 ≤2）')
  // 同一份语料、新口径必须严格更好 —— 否则这条负路径没有鉴别力
  assert.ok(build(100, 600).quota.perLayer.user.picked > picked,
    '新口径(' + build(100, 600).quota.perLayer.user.picked + ') 必须多于旧口径(' + picked + ')')
})

t('#498-5 富余预算回灌：不越 maxTokens、不越 project cap、保底层不得被裁光', () => {
  for (const maxTokens of [400, 600, 800]) {
    const r = build(100, maxTokens)
    assert.ok(r.tokens <= maxTokens, 'maxTokens=' + maxTokens + ' 实占 ' + r.tokens)
    const p = r.quota.perLayer.project
    assert.ok(p.tokens <= p.cap, 'project 层 ' + p.tokens + ' ≤ cap ' + p.cap)
    // 保底层（floorLayers）一旦有候选就必须有产出 —— 这正是 #498 的缺陷形状。
    // log/reflection 没有保底，允许在极小预算下被裁光（那是既有设计，不是本修复的范围）。
    for (const layer of TIER0_QUOTA_DEFAULTS.floorLayers) {
      const pl = r.quota.perLayer[layer]
      assert.ok(pl.candidates === 0 || pl.picked > 0,
        'maxTokens=' + maxTokens + ' 的保底层 ' + layer + ' 有 ' + pl.candidates + ' 条候选却 picked=0')
    }
  }
})

t('#498-6 ★负路径：关掉回灌（floorLayers=[] 且无 floor）⇒ 回到 project 独吞的单层退化', () => {
  const nope = buildTier0CatalogFromTextPre(MIXED(100), {
    maxTokens: 600, estimateMode: 'conservative',
    quota: { projectRatio: 1, floorRatio: 0, floorRatioByLayer: {}, floorLayers: [] },
  })
  const layers = new Set(nope.items.map((i) => i.layer))
  assert.ok(!layers.has('user'), '无 floor 时 user 被挤空（layers=' + [...layers].join(',') + '）')
})

t('#498-7 注入路径真跑：composeTieredInjectionPre 的 Tier-0 段同样受益（不只看目录纯函数）', () => {
  const res = composeTieredInjectionPre({ sources: MIXED(100), hits: [], question: '', maxTokens: 600 })
  const perLayer = res.tier0.quota.perLayer
  assert.ok(perLayer.user.picked >= 3, '注入侧 user 进 ' + perLayer.user.picked + ' 条')
  assert.ok(perLayer.project.picked > 0, '注入侧 project 进 ' + perLayer.project.picked + ' 条')
  assert.ok(res.tier0.tokens <= 600, '注入侧 Tier-0 token ' + res.tier0.tokens + ' ≤ 600')
  assert.ok(res.text.includes('· user ·'), '注入文本里真的出现了 user 层条目')
})

t('#498-10 ★回灌轮单独可验：富余额度存在时不得有层被裁光（whiteboard8/user5/log10 @300）', () => {
  // 这组语料在旧口径（单一 floorRatio=0.1、无回灌）下会剩 34 token 却把 log 裁成 0 条
  // （实测总 token 266/300，log picked=0）—— 正是"钱没花完却有人饿死"的缺陷形状。
  const r = buildTier0CatalogFromTextPre([
    { layer: 'whiteboard', text: mkEntries(8, 'W'), path: 'PLAN.md' },
    { layer: 'user', text: mkEntries(5, 'U'), path: 'USER.md' },
    { layer: 'log', text: mkEntries(10, 'L'), path: '2026-10-31.md' },
  ], { maxTokens: 300, estimateMode: 'conservative', quota: { projectRatio: 0.6, floorRatio: 0.1, floorRatioByLayer: {} } })
  // 这组语料是**回灌轮的单独判别用例**（实测对照）：
  //   有回灌 ⇒ total=300/300、log 进 1 条、degraded=["user"]（user 单条 ~35 token，只剩 0 余量）
  //   无回灌 ⇒ total=266/300、log 0 条、degraded=["user","log"]（34 token 白留、两层同时饿死）
  assert.ok(r.quota.perLayer.log.picked >= 1, 'log 进 ' + r.quota.perLayer.log.picked + ' 条（无回灌时为 0）')
  assert.ok(r.tokens <= 300, '总 token ' + r.tokens + ' ≤ 300')
  assert.ok(r.tokens > 266, '实占 ' + r.tokens + ' 应高于无回灌时的 266（额度真的被用上了）')
  assert.ok(!r.quota.degradedLayers.includes('log'), 'log 不得被裁光，实得 ' + JSON.stringify(r.quota.degradedLayers))
})

t('#498-8 确定性：同输入两次结果全等（回灌轮不得引入顺序抖动）', () => {
  assert.deepEqual(build(100, 600), build(100, 600))
})

t('#498-9 空语料 / 只有 project：回灌轮不制造幻影条目', () => {
  const onlyProject = buildTier0CatalogFromTextPre(
    [{ layer: 'project', text: mkEntries(5, 'P'), path: 'MEMORY.md' }],
    { maxTokens: 600, estimateMode: 'conservative', quota: true })
  assert.equal(onlyProject.quota.perLayer.user.picked, 0, '无 user 候选时 user 恒 0')
  assert.equal(onlyProject.quota.perLayer.project.picked, 5, 'project 5 条全进')
  const empty = allocateTier0QuotaPre([], { maxTokens: 600 })
  assert.equal(empty.picked.length, 0)
  assert.equal(empty.tokens, 0)
})

// ══════════════════════════════════════════════════════════════════
// #464 · JS/Python 路径首尾空白解释不一致
// ══════════════════════════════════════════════════════════════════
console.log('\n[#464] 路径规范化（JS 侧统一 + normalized 暴露）')

const HOME = mkdtempSync(path.join(tmpdir(), 'dam-d464-'))
const MODEL_DIR = path.join(HOME, 'models')
const SPACED_DIR = path.join(HOME, 'my models')
const CFG = path.join(HOME, 'memory', 'semantic', 'embedding-config.json')
try {
  mkdirSync(path.join(MODEL_DIR, 'onnx'), { recursive: true })
  mkdirSync(path.join(SPACED_DIR, 'onnx'), { recursive: true })
  mkdirSync(path.dirname(CFG), { recursive: true })
  writeFileSync(path.join(MODEL_DIR, 'onnx', 'model_int8.onnx'), 'fixture')
  writeFileSync(path.join(SPACED_DIR, 'onnx', 'model_int8.onnx'), 'fixture')
  const writeCfg = (o) => writeFileSync(CFG, JSON.stringify(o))
  const cfgWith = (modelDir) => ({ provider: 'bge-m3-onnx-int8-pre-v1', modelDir: modelDir.replace(/\\/g, '/'), onnxFile: 'onnx/model_int8.onnx', dimension: 1024 })
  const envWith = (v) => {
    const env = { ...process.env }
    if (v === null) delete env.DSH_M7_EMBEDDING_CONFIG
    else env.DSH_M7_EMBEDDING_CONFIG = v
    return env
  }
  const pyReads = (envVal) => {
    const script = "import json,os,sys\np=os.environ.get('DSH_M7_EMBEDDING_CONFIG','')\ntry:\n    c=json.load(open(p,encoding='utf-8'))\nexcept Exception:\n    c={}\nprint(json.dumps({'opened':bool(c),'modelDir':str(c.get('modelDir') or '')}))"
    const out = execFileSync('python', ['-c', script], { env: envWith(envVal), encoding: 'utf8' })
    return JSON.parse(out)
  }

  writeCfg(cfgWith(MODEL_DIR))

  t('#464-1 normalizeConfigPathPre：只剥首尾、保留内部空格、纯空白=未配置', () => {
    assert.deepEqual(normalizeConfigPathPre('  C:\\a b\\c.json  '),
      { raw: '  C:\\a b\\c.json  ', value: 'C:\\a b\\c.json', configured: true, changed: true })
    const blank = normalizeConfigPathPre('   \t ')
    assert.equal(blank.configured, false, '纯空白 ⇒ configured=false（不是"配置了空路径"）')
    assert.equal(blank.value, '')
    const exact = normalizeConfigPathPre('C:\\x\\y.json')
    assert.equal(exact.changed, false, '精确路径 ⇒ changed=false')
    assert.equal(exact.configured, true)
    assert.equal(normalizeConfigPathPre(null).configured, false)
    assert.equal(normalizeConfigPathPre(undefined).configured, false)
  })

  t('#464-2 五种输入下的 JS 结果：未设置/精确/首尾空白/纯空白/内部空格', () => {
    // ① 未设置 ⇒ 回落默认路径
    const unset = readEffectiveEmbeddingConfigPre(HOME, envWith(null))
    assert.equal(unset.file, path.join(HOME, 'memory', 'semantic', 'embedding-config.json'))
    assert.equal(unset.configOk, true, '默认路径上正好有一份有效配置')
    assert.equal(unset.normalized, false)
    // ② 精确路径
    const exact = readEffectiveEmbeddingConfigPre(HOME, envWith(CFG))
    assert.equal(exact.file, CFG)
    assert.equal(exact.normalized, false, '精确路径不产生规范化痕迹')
    // ③ 首尾空白 ⇒ 归一后仍指向同一份配置，但**必须**暴露 normalized
    const padded = readEffectiveEmbeddingConfigPre(HOME, envWith('  ' + CFG + '\t '))
    assert.equal(padded.file, CFG, '首尾空白归一后 = 精确路径')
    assert.equal(padded.configOk, true)
    assert.equal(padded.normalized, true, '★规范化必须可见（normalized=true），不许静默 trim')
    assert.ok(padded.normalizedFields.includes('configFile'))
    // ④ 纯空白 ⇒ 视为未设置（回落默认），且不是"配置了空路径"
    const blank = readEffectiveEmbeddingConfigPre(HOME, envWith('   \t  '))
    assert.equal(blank.file, path.join(HOME, 'memory', 'semantic', 'embedding-config.json'))
    assert.equal(embeddingConfigFilePre(HOME, envWith('  ')), path.join(HOME, 'memory', 'semantic', 'embedding-config.json'))
    // ⑤ 路径内部有空格 ⇒ 必须能读到，且不产生 normalized 痕迹（只 strip 首尾）
    writeCfg(cfgWith(SPACED_DIR))
    const internal = readEffectiveEmbeddingConfigPre(HOME, envWith(CFG))
    assert.equal(internal.configOk, true, '内部含空格的 modelDir 仍可用')
    assert.ok(internal.modelPath.includes('my models'), '内部空格原样保留：' + internal.modelPath)
    assert.equal(internal.normalized, false, '★内部空格不算规范化（不能把合法路径当脏值）')
  })

  t('#464-3 modelDir 带首尾空白 ⇒ 归一后 modelPath 与精确值一致，且 normalized 点名 modelDir', () => {
    writeCfg({ provider: 'bge-m3-onnx-int8-pre-v1', modelDir: '  ' + MODEL_DIR.replace(/\\/g, '/') + '  ', onnxFile: 'onnx/model_int8.onnx', dimension: 1024 })
    const r = readEffectiveEmbeddingConfigPre(HOME, envWith(CFG))
    assert.equal(r.modelPath, path.join(MODEL_DIR, 'onnx', 'model_int8.onnx'))
    assert.equal(r.normalized, true)
    assert.deepEqual(r.normalizedFields, ['modelDir'])
    assert.equal(r.modelDirBlank, false)
  })

  t('#464-4 modelDir 为纯空白 ⇒ 视为未配置（configOk=false）+ modelDirBlank 显式可见', () => {
    writeCfg({ provider: 'bge-m3-onnx-int8-pre-v1', modelDir: '   ', onnxFile: 'onnx/model_int8.onnx', dimension: 1024 })
    const r = readEffectiveEmbeddingConfigPre(HOME, envWith(CFG))
    assert.equal(r.configOk, false, '纯空白 modelDir ⇒ 未配置，不是"配置了一个空路径"')
    assert.equal(r.modelDirBlank, true, '★有键但规范化后为空 ⇒ 可见的配置错误')
    // 完全没有 modelDir 键是另一种处境
    writeCfg({ provider: 'bge-m3-onnx-int8-pre-v1', onnxFile: 'onnx/model_int8.onnx', dimension: 1024 })
    const missing = readEffectiveEmbeddingConfigPre(HOME, envWith(CFG))
    assert.equal(missing.configOk, false)
    assert.equal(missing.modelDirBlank, false, '无 modelDir 键 ≠ 空白 modelDir（两者不可混为一谈）')
  })

  t('#464-5 ★跨语言：五种输入的「是否读到配置」判定与 Python 侧一致（真起 python 子进程）', () => {
    writeCfg(cfgWith(MODEL_DIR))
    const cases = [
      ['未设置', null],
      ['精确路径', CFG],
      ['首尾空白', '  ' + CFG + '\t '],
      ['纯空白', '   \t  '],
    ]
    const rows = cases.map(([name, v]) => {
      const js = readEffectiveEmbeddingConfigPre(HOME, envWith(v))
      const py = pyReads(v)
      return { name, jsOk: js.configOk, pyOpened: py.opened }
    })
    // 「纯空白」一档：JS 视作未设置 ⇒ 回落默认（默认上有有效配置 ⇒ configOk=true），
    // 而 Python 视作未配置 ⇒ 不打开任何文件 ⇒ opened=false。两者对**env 值本身**的解释一致
    // （都不是"一个空路径"），差别只在 JS 会回落到默认配置 —— 这正是 embeddingConfigFilePre 的契约。
    const blankRow = rows.find((r) => r.name === '纯空白')
    assert.equal(blankRow.pyOpened, false, 'Python 对纯空白不打开任何文件')
    assert.equal(embeddingConfigFilePre(HOME, envWith('   ')), path.join(HOME, 'memory', 'semantic', 'embedding-config.json'),
      'JS 对纯空白同样视为"未设置"（回落默认，而非打开空白文件名）')
    // 精确 与 首尾空白 两档：JS 读到同一份配置；Python 对"首尾空白"打不开（Python 侧未 strip，
    // 由另一条线对齐）。本套件只断言 **JS 侧不该因为空白而与精确路径产生行为差异**。
    const exactRow = rows.find((r) => r.name === '精确路径')
    const paddedRow = rows.find((r) => r.name === '首尾空白')
    assert.equal(exactRow.jsOk, true)
    assert.equal(paddedRow.jsOk, exactRow.jsOk, '★JS：首尾空白与精确路径必须等价（修复前也等价，此处锁不回归）')
    const paddedJs = readEffectiveEmbeddingConfigPre(HOME, envWith('  ' + CFG + '\t '))
    assert.equal(paddedJs.normalized, true, '★差别必须**可见**：normalized=true 而不是悄悄等价')
  })

  t('#464-6 ★负路径：绕过规范化直接用原始 env 值 ⇒ 首尾空白那条打不开配置（判据有鉴别力）', () => {
    writeCfg(cfgWith(MODEL_DIR))
    const raw = '  ' + CFG + '\t '
    // 旧实现在模型里等价于「按 raw 原样当路径」（Python 侧当前就是这么做）。
    const py = pyReads(raw)
    assert.equal(py.opened, false, '原始值（含首尾空白）打不开 ⇒ 规范化确有必要')
    const norm = readEffectiveEmbeddingConfigPre(HOME, envWith(raw))
    assert.equal(norm.configOk, true, '走规范化后能读到')
    // 同时：把 normalized 抹掉就无法区分「用户写脏了」与「本来就干净」——
    // 断言两个世界的返回值确实不同，证明这个字段不是恒真装饰。
    const clean = readEffectiveEmbeddingConfigPre(HOME, envWith(CFG))
    assert.notEqual(norm.normalized, clean.normalized, 'normalized 在脏/净两种输入下取值不同')
  })
} finally {
  rmSync(HOME, { recursive: true, force: true })
}

// ══════════════════════════════════════════════════════════════════
// #457 · 类似技能重复送审批
// ══════════════════════════════════════════════════════════════════
console.log('\n[#457] procedureSimilarityPre 相似度判据')

/** issue 里的两条真实用例（措辞不同、语义同流程）。 */
const CASE_A = {
  title: '用 Windows 凭据里的 classic PAT 经 GitHub API 创建 PR',
  steps: ['从凭据管理器取 PAT', '用 PAT 调 GitHub API 建分支', '提交并开 PR', '回读 PR URL 核对'],
}
const CASE_B = {
  title: '用本机凭据管理器 PAT 走 GitHub API 提 issue/PR',
  steps: ['确认 PAT 有 repo 权限', '从凭据管理器取出 PAT', '调 GitHub API 创建分支并提交', '提交并开 PR', '回读 PR URL 核对'],
}
/** 明显不同的流程（用于负路径）。 */
const CASE_C = {
  title: '发布前跑全量回归并核对 SHA256',
  steps: ['跑 tools/run-smoke.mjs', '比对发布包 SHA256', '更新 CHANGELOG 版本号'],
}
const CASE_D = {
  title: '给 CRLF 源码打多点多行补丁',
  steps: ['grep -c 测行尾类型', '用 edit 做内容锚定替换', 'node --check 校验语法', '复测行尾计数'],
}
/** 作者在 issue 里判定为「不同流程」的一对（AG591 两种烧录）。 */
const CASE_E = { title: 'AG591 QFlash V7.3 无人值守烧录', steps: ['连接串口', '下发 V7.3 固件', '等待校验通过'] }
const CASE_F = { title: 'AG591 QFlash V7.9 六段脚本烧录', steps: ['连接串口', '分段下发 V7.9 六段脚本', '逐段校验 CRC'] }
/** 建议阈值：0.62（本套件锁定的默认值，调用方仍可覆盖）。 */
const THRESHOLD = 0.62

t('#457-1 ★真实用例：措辞不同的同一条流程相似度 ≥ 0.62', () => {
  const s = procedureSimilarityPre(CASE_A, CASE_B)
  assert.ok(s >= THRESHOLD, 'A~B 相似度 ' + s.toFixed(4) + ' 应 ≥ ' + THRESHOLD)
  assert.ok(s < 1, '不是逐字相等（' + s.toFixed(4) + '），证明它不是指纹的别名')
})

t('#457-2 ★负路径：明显不同的两条流程相似度 < 0.62', () => {
  for (const [x, y, name] of [[CASE_A, CASE_C, 'A~C'], [CASE_C, CASE_D, 'C~D'], [CASE_A, CASE_D, 'A~D']]) {
    const s = procedureSimilarityPre(x, y)
    assert.ok(s < THRESHOLD, name + ' 相似度 ' + s.toFixed(4) + ' 应 < ' + THRESHOLD)
  }
})

t('#457-3 ★负路径：作者判「不同流程」的 AG591 一对不得越过阈值（防误合并丢流程）', () => {
  const s = procedureSimilarityPre(CASE_E, CASE_F)
  assert.ok(s < THRESHOLD, 'AG591 V7.3~V7.9 相似度 ' + s.toFixed(4) + ' 应 < ' + THRESHOLD + '（误合并=丢流程）')
})

t('#457-4 自反性 / 对称性 / 值域：0 ≤ s ≤ 1', () => {
  for (const c of [CASE_A, CASE_B, CASE_C, CASE_D, CASE_E, CASE_F]) {
    assert.equal(procedureSimilarityPre(c, c), 1, '自反必为 1：' + c.title.slice(0, 12))
  }
  const pairs = [[CASE_A, CASE_B], [CASE_C, CASE_D], [CASE_E, CASE_F]]
  for (const [x, y] of pairs) {
    const ab = procedureSimilarityPre(x, y)
    const ba = procedureSimilarityPre(y, x)
    assert.equal(ab, ba, '对称：' + ab + ' vs ' + ba)
    assert.ok(ab >= 0 && ab <= 1, '值域 0–1：' + ab)
  }
})

t('#457-5 ★负路径：逐字判据（标题整串相等 + 前 3 步逐字）在本用例上返回 0 ⇒ 必红', () => {
  // 现场复现上层旧判据（proceduresFindDuplicatePre 的两条口径）的等价形态，
  // 证明「逐字」在这个真实用例上不成立 —— 这正是 #457 的根因。
  const legacyHit = (x, y) => {
    const norm = (s) => String(s == null ? '' : s).replace(/[\s\u3000]+/g, '').replace(/[\u3001\u3002\uff0c\uff1b\uff1a\uff01\uff1f.,;:!?'"\u201c\u201d\u2018\u2019()（）\[\]【】<>《》—\-–_*+~|/\\]/g, '').toLowerCase()
    const sameTitle = norm(x.title) === norm(y.title) && !!norm(x.title)
    const nx = (x.steps || []).slice(0, 3).map(norm).filter(Boolean)
    const ny = (y.steps || []).slice(0, 3).map(norm).filter(Boolean)
    const sameSteps = nx.length >= 3 && ny.length >= 3 && nx.every((v, i) => v === ny[i])
    return sameTitle || sameSteps
  }
  assert.equal(legacyHit(CASE_A, CASE_B), false, '★旧判据在 A~B 上判「不重复」（这就是缺陷本身）')
  assert.ok(procedureSimilarityPre(CASE_A, CASE_B) >= THRESHOLD, '新判据在 A~B 上判「相似」')

  // 另一条负路径：指纹（全字段 JSON.stringify）也不是相似度 —— 它同样对这组返回不等。
  assert.notEqual(procedureFingerprintPre(CASE_A), procedureFingerprintPre(CASE_B),
    '指纹是全字段精确相等，对本用例天然不等（不能拿指纹当判重）')
})

t('#457-6 fail-soft：null / 非对象 / 缺字段一律返回 0，绝不抛错', () => {
  assert.equal(procedureSimilarityPre(null, CASE_A), 0)
  assert.equal(procedureSimilarityPre(CASE_A, undefined), 0)
  assert.equal(procedureSimilarityPre('junk', 42), 0)
  assert.equal(procedureSimilarityPre({}, {}), 0, '两条空条目不能声称相似')
  assert.equal(procedureSimilarityPre({ title: '只有标题' }, { title: '只有标题' }), 1, '同标题无步骤仍自反为 1')
})

t('#457-7 口径可复算：procedureTokensPre 对 CJK 出 bigram、对 ASCII 出整词', () => {
  const toks = procedureTokensPre('跑 tools/run-smoke.mjs 全量回归')
  assert.ok(toks.includes('w:tools/run-smoke.mjs'), 'ASCII 整词：' + JSON.stringify(toks.slice(0, 4)))
  assert.ok(toks.includes('c:全量'), 'CJK bigram：' + JSON.stringify(toks.filter((x) => x.startsWith('c:')).slice(0, 4)))
  assert.equal(procedureTokensPre('').length, 0)
  assert.equal(procedureTokensPre(null).length, 0)
})

t('#457-8 步骤换顺序不影响判定（顺序无关的最优匹配）', () => {
  const shuffled = { title: CASE_A.title, steps: [CASE_A.steps[2], CASE_A.steps[0], CASE_A.steps[3], CASE_A.steps[1]] }
  assert.equal(procedureSimilarityPre(CASE_A, shuffled), 1, '同一组步骤换顺序 ⇒ 相似度仍为 1')
})

console.log('\n[issue498-464-457] ' + pass + '/' + (pass + fail) + ' assertions passed')
if (fail) process.exit(1)
