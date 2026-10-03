/**
 * Python 运行时「真跑通」判据守卫（2026-09-30）—— 用户三条原则的落点。
 *
 * 事故（真机取证 2026-09-29/30）：面板显示「Python 模型 ✓ 就绪 + 当前生效档位 C3 · Python +
 * ✓ 一切就绪」，而实际 worker 从未跑起来（解释器缺失/缺依赖）⇒ 每次检索都在词法兜底、
 * engineSwitch.failed 累到 4126。根因：判据是**模型文件存在性**（pythonInt8Present 只查
 * model_int8.onnx），而非「有没有真反馈」。
 *
 * 用户三条原则：
 *   ① 判据 = 真跑通（有反馈才算就绪，不是文件在就算）
 *   ② 健壮降级（能凑合跑就让它跑 + 把报错摆出来，不因一两个路径问题就崩）
 *   ③ 开发值显式识别（"检测到开发值，欢迎开发者"）
 *
 * 本套件锁定（每条都能变红）：
 *   A. python-runtime 模块：候选链顺序/去重/isDev 标记/反例
 *   B. 解释器解析：deps 实测选首个通过者；全失败返回结构化结果（不抛、不中止）
 *   C. 宿主接线：probePythonRuntime + _probeWorkerHealthOnce + resolvedPythonCommand
 *   D. 判据升级：deepDetect 与 resolveSemanticTier 的 Python 判据含 depsOk（非仅文件存在）
 *   E. health 判据修正：不把 embedding.ready 当跑通（stale 是常态），看 enabled && !error
 *   F. 前端三态：两个面板都有"有文件但未能启动" + 报错外显 + 开发值提示
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../..')
let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  ok   - ' + m) } else { fail++; console.log('  FAIL - ' + m) } }

const PR = await import(pathToFileURL(path.join(ROOT, 'lib/python-runtime.js')).href)
const SRC_IDX = fs.readFileSync(path.join(ROOT, 'lib/index.js'), 'utf8')
const SRC_CLI = fs.readFileSync(path.join(ROOT, 'lib/client.js'), 'utf8')

// ── A. 候选链 ──
{
  const c = PR.buildPythonCandidatesPre({ configured: '/custom/py', dshHome: '/home/.dsh', pluginDir: '/plug' })
  const kinds = c.map((x) => x.kind)
  ok(kinds[0] === 'configured', 'A1 配置值排第一（最高优先）')
  ok(kinds.includes('user-venv'), 'A2 含用户位 venv（发布版的正常路径）')
  ok(kinds.includes('dev-venv'), 'A3 含开发树 venv')
  const dev = c.find((x) => x.kind === 'dev-venv')
  ok(dev && dev.isDev === true, 'A4 ★开发树候选带 isDev 标记（原则③）')
  ok(c.filter((x) => x.kind === 'system').length >= 1, 'A5 含系统 PATH 兜底')
  // 去重
  const dup = PR.buildPythonCandidatesPre({ configured: 'python', dshHome: '', pluginDir: '' })
  ok(dup.filter((x) => x.path === 'python').length === 1, 'A6 候选去重（同路径只留一次）')
  // 空输入不抛
  ok(Array.isArray(PR.buildPythonCandidatesPre({})), 'A7 空输入返回数组（不抛）')
}

// ── A2. isDevTreePath ──
{
  ok(PR.isDevTreePathPre('/plug/python/x', '/plug') === true, 'A8 isDevTreePath 命中开发树')
  ok(PR.isDevTreePathPre('/other/x', '/plug') === false, 'A9 反例：外部路径不算开发值')
  ok(PR.isDevTreePathPre('', '/plug') === false, 'A10 反例：空路径不算')
}

// ── B. 解释器解析（真机不 spawn：用假候选验证结构与 fail-soft）──
{
  const res = await PR.resolvePythonInterpreterPre([
    { path: '/definitely/not/exist/py', label: 'missing', kind: 'configured', isDev: false },
    { path: 'definitely-not-a-real-cmd-xyz', label: 'pathname', kind: 'system', isDev: false },
  ], { timeoutMs: 4000 })
  ok(res.chosen === '', 'B1 全失败 ⇒ chosen 为空（不抛、不中止）')
  ok(Array.isArray(res.probed) && res.probed.length === 2, 'B2 全候选都有探测记录（原则②：失败也如实记录）')
  ok(res.probed[0].status === 'missing', 'B3 缺文件候选标记 missing')
  ok(typeof res.probed[1].reason === 'string' && res.probed[1].reason.length > 0, 'B4 不可执行候选带原因（报错摆在脸上）')
}

// ── C. 宿主接线 ──
{
  ok(/engine\.probePythonRuntime = async/.test(SRC_IDX), 'C1 probePythonRuntime 存在')
  ok(/engine\._probeWorkerHealthOnce = async/.test(SRC_IDX), 'C2 _probeWorkerHealthOnce 存在')
  ok(/engine\.resolvedPythonCommand = \(\)/.test(SRC_IDX), 'C3 resolvedPythonCommand 存在')
  ok(/command: \(\) => engine\.resolvedPythonCommand\(\) \|\| 'python'/.test(SRC_IDX), 'C4 ★sidecar 的 command 已接入探测链（不再裸回落 python）')
  ok(/buildPythonCandidatesPre\(\{/.test(SRC_IDX), 'C5 候选链构造已接线')
  ok(/resolvePythonInterpreterPre\(cands\)/.test(SRC_IDX), 'C6 解释器解析已接线')
  ok(/makeRequestFramePre\(\{ type: 'health'/.test(SRC_IDX), 'C7 health 帧经官方构帧器（协议合规）')
}

// ── D. 判据升级（核心：不再只查文件）──
{
  const deepSeg = SRC_IDX.slice(SRC_IDX.indexOf('pythonRuntime = await engine.probePythonRuntime({ withWorker: true })'), SRC_IDX.indexOf('pythonRuntime = await engine.probePythonRuntime({ withWorker: true })') + 400)
  ok(/pythonInt8Present = pythonRuntime\.usable === true/.test(deepSeg), 'D1 ★deepDetect: pythonInt8Present = usable（真跑通判据）')
  ok(/withWorker: true/.test(deepSeg), 'D1b 检测面板走 full 探测（含 worker health）')
  // D2：pythonRuntime 必须在 return 块里下发
  const rtIdx = SRC_IDX.indexOf('pythonRuntime = await engine.probePythonRuntime({ withWorker: true })')
  const retSeg = SRC_IDX.slice(rtIdx, SRC_IDX.indexOf('recommendation,', rtIdx) + 40)
  ok(/pythonRuntime,/.test(retSeg), 'D2 deepDetect 下发 pythonRuntime 字段给前端')
  const tierSeg = SRC_IDX.slice(SRC_IDX.indexOf("if (mode === 'python') {", SRC_IDX.indexOf('engine.resolveSemanticTier')), SRC_IDX.indexOf("if (mode === 'python') {", SRC_IDX.indexOf('engine.resolveSemanticTier')) + 1200)
  ok(/engine\.pythonRuntimeCached\(\)/.test(tierSeg), 'D3a 档位解析只读缓存（热路径零阻塞）')
  ok(/rt\.worker\.healthSeen && rt\.worker\.ready\) \? 'c3' : 'c1'/.test(tierSeg), 'D3b ★档位尊重 worker 真反馈（修「面板⚠ vs 档位C3」矛盾）')
  ok(/void engine\.probePythonRuntime\(\)\.catch/.test(tierSeg), 'D3c 无缓存时后台补探测（下次有真值）')
}

// ── E. health 判据修正 ──
{
  ok(/const embedderOk = emb\.enabled === true && !emb\.error/.test(SRC_IDX), 'E1 ★跑通判据 = embedder 加载成功（enabled && !error）')
  ok(/res\.vectorReady = emb\.ready === true/.test(SRC_IDX), 'E2 向量新鲜度**另存**为 vectorReady（不混入跑通判据）')
  ok(/stale 是\*\*常态\*\*|staleEntries/.test(SRC_IDX), 'E3 注释/字段记录"stale 是常态"这一取证（防后人改回）')
  ok(!/res\.ready = emb\.ready === true/.test(SRC_IDX), 'E4 反例：不得再用 emb.ready 直接当 res.ready')
}

// ── F. 前端三态 ──
{
  const occ = (h, n) => { let c = 0, i = 0; for (;;) { const p = h.indexOf(n, i); if (p < 0) return c; c++; i = p + n.length } }
  // ★2026-09-30 更新（三态以后端 state 为准 + mode-aware 文案）：
  // ★2026-09-30 改**下限断言**：CHANGELOG 字典文案也会提到这些词（计数会随文案增长），
  //   精确计数必然假红；下限只锁「三态文案确实存在于两个面板」这一事实。
  ok(occ(SRC_CLI, '有文件但未能启动') >= 2, 'F1 失败态文案存在（共享设置 × 状态行）', occ(SRC_CLI, '有文件但未能启动'))
  ok(occ(SRC_CLI, '已实测启动') >= 2, 'F2 就绪态明确标注"已实测启动"（区分于旧的文件在就绪）')
  ok(occ(SRC_CLI, '尚未实测启动') >= 1, 'F2b ready-unverified 态如实标注"尚未实测"')
  ok(occ(SRC_CLI, '检测到开发值') >= 4, 'F3 ★开发值提示（原则③）', occ(SRC_CLI, '检测到开发值'))
  // ★2026-09-30 双皮肤块：设置面板现有**三份**文本——旧款块 + 新块 + SettingsPage 模板源码，
  //   故计数由 "2 面板 × N" 变为 "共享实现 × N"。守卫语义不变：三欄代码均须存在。
  ok(occ(SRC_CLI, "pr.state === '") === 4, 'F4 前端三态以后端权威 state 为准（共享实现 × 4 态）', occ(SRC_CLI, "pr.state === '"))
  ok(occ(SRC_CLI, 'pr.worker.reason') >= 2, 'F5 ★worker 失败原因外显（原则②：报错摆在脸上）')
  ok(occ(SRC_CLI, "state === 'start-failed' || det.pythonRuntime.state === 'deps-failed'") === 2, 'F6 "一切就绪"绿灯尊重运行时真值（共享实现 × gate+pyBad）')
  ok(occ(SRC_CLI, 'pyModeNow') === 2, 'F7 ★矛盾文案修复：失败态下按当前模式区分措辞（共享实现）')
}

console.log('\n结果: ' + pass + ' PASS / ' + fail + ' FAIL')
process.exit(fail ? 1 : 0)
