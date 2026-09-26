/**
 * 记忆工作台迁移 · 结构不变量守卫（2026-09-24）
 *
 * 守的是子代理迁移方案的**结构性前提**，不是行为细节 —— 行为要真机（重启宿主）才验得到。
 * 每一条都对应一处「改坏了会静默失效」的地方（静默 = 没有断言就会以为没问题）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// 仓库根：由本文件位置推导（tests/smoke/*.mjs → 上两级）。
// 2026-09-26 修：原先硬编码 'D:/dsh-auto-memory'，CI 在 /home/runner/... 下必 ENOENT。
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const idx = fs.readFileSync(path.join(ROOT, 'lib/index.js'), 'utf8')
const cli = fs.readFileSync(path.join(ROOT, 'lib/client.js'), 'utf8')
const idxL = idx.split(/\r?\n/)
const ok = []
const bad = []
const check = (name, cond, detail) => { (cond ? ok : bad).push(name + (detail ? '  ' + detail : '')) }
const count = (s, sub) => s.split(sub).length - 1

// ── ① 门控必须先于 spawn：runSubagent 里 _workbenchReady 判定要在 subagents.start 之前
{
  const fn = idx.indexOf('async runSubagent(text, label, agent, timeoutMs) {')
  const gateAt = idx.indexOf('if (!this._workbenchReady) {', fn)
  const startAt = idx.indexOf('subagents.start(', fn)
  check('① 门控在 spawn 之前', fn > 0 && gateAt > fn && startAt > gateAt,
    'gate@' + (gateAt - fn) + ' spawn@' + (startAt - fn))
}

// ── ② 失败必须可重试：清 memo + 记失败时刻（否则永久门控到重启）
{
  const seg = idx.slice(idx.indexOf('async runSubagent('), idx.indexOf('async runSubagent(') + 2200)
  check('② 失败清 _workbenchInit', /this\._workbenchInit = null/.test(seg))
  check('② 失败记 _workbenchFailedAt', /this\._workbenchFailedAt = Date\.now\(\)/.test(seg))
  check('② 有退避窗口', /workbenchRetryMs/.test(seg) && /_wbBackoff/.test(seg))
}

// ── ③ 并发闸必须用 finally 释放（任何返回路径都不能漏）
{
  const fn = idx.indexOf('async ensureWorkbench(')
  // ★用真实函数边界切片，不用魔法长度——加代码会把 } finally { 挤出窗口导致假红（第 16 次判据错）
  const end = idx.indexOf('async workbenchStatus()', fn)
  const seg = end > fn ? idx.slice(fn, end) : idx.slice(fn, fn + 9000)
  check('③ ensureWorkbench 有 _workbenchBusy 闸', /this\._workbenchBusy = true/.test(seg), 'len=' + seg.length)
  check('③ finally 释放 busy', /\} finally \{[\s\S]{0,300}_workbenchBusy = false/.test(seg))
}

// ── ④ 三重校验三条都在，且权限比对是硬串 'danger-full-access'
{
  const fn = idx.indexOf('async _verifyWorkbench(nowMs)')
  // ★2026-09-24（阶段 D）：改用**真实函数边界**，不再用魔法长度 2600 ——
  //   新增「先 resolveAgent 再判缺失」后，permission-mismatch / 'danger-full-access'
  //   被推出旧窗口 ⇒ 假红。窗口是实现细节，语义（三重校验三条都在）不变。
  //   同类已修先例：③ 与 ⑤ 在本文件 L39 / L58 已改成真实边界。
  const end = idx.indexOf('async _pruneStaleWorkbenchWorkspaces(', fn)
  const seg = end > fn ? idx.slice(fn, end) : idx.slice(fn, fn + 6000)
  check('④ 位置校验 cwd', /cwd-mismatch/.test(seg))
  check('④ 权限校验 preset', /permission-mismatch/.test(seg) && /'danger-full-access'/.test(seg))
  check('④ 编号校验 epoch', /epoch-mismatch/.test(seg))
}

// ── ⑤ 建立时显式设权限（不依赖 settings 默认；否则子代理「每一步都要批准」）
{
  const fn = idx.indexOf('async ensureWorkbench(')
  // ★真实函数边界切片（第 17 次同类假红：魔法长度 4200 被新增代码撑爆）
  const end = idx.indexOf('async workbenchStatus()', fn)
  const seg = end > fn ? idx.slice(fn, end) : idx.slice(fn, fn + 12000)
  check('⑤ 建立后显式 pp.set danger-full-access', /pp\.set\(ag\.session, 'danger-full-access'\)/.test(seg), 'len=' + seg.length)
  check('⑤ 建立后复检', /_verifyWorkbench\(now\)/.test(seg) && /verify-after-create/.test(seg), 'len=' + seg.length)
}

// ── ⑥ 期号用系统墙钟，不得出现自建计时器
{
  const fn = idx.indexOf('_workbenchEpoch(nowMs)')
  const seg = idx.slice(fn, fn + 700)
  check('⑥ epoch 读 Date', /new Date\(/.test(seg))
  check('⑥ epoch 无 setInterval', !/setInterval|setTimeout/.test(seg))
  check('⑥ 期长可配（workbenchPeriodDays，非写死）+ 同一基准', /_workbenchPeriodDays\(\)/.test(seg) && /Math\.floor\(days \/ per\)/.test(seg) && /Date\.UTC\(1970, 0, 5\)/.test(seg))
  // ★E5-FIX：日桶必须走 Date.UTC（本地日历日 → 整数天）。用本地 `new Date(y,m,d)` 会带时区偏移，
  //   非 UTC 时区下 floor 结果整体少一天（实测基准日算成 B-1）。静态正则看不出，故单独钉一条。
  check('⑥ 日桶用 Date.UTC（本地日历日 → 整数天，避免时区 −1）', /new Date\(Date\.UTC\(d\.getFullYear\(\)/.test(seg))
}

// ── ⑦ 宿主路由存在 + 前端消费（api-paths 守卫要求「接上界面」）
check('⑦ 宿主 workbench 路由', /path: API\.workbench/.test(idx) && /workbench: '\/api\/dsh-auto-memory\/workbench'/.test(idx))
check('⑦ 前端 API 表有条目', /workbench: ROUTE_PREFIX \+ '\/workbench'/.test(cli))
check('⑦ 前端实际调用', /apiPost\(API\.workbench/.test(cli))

// ── ⑧ 居中弹窗：必须用 tour 外壳（居中），不得用左下角 overlay 那套
{
  // ★2026-09-24：窗口由 4200 放大到 6000 —— 弹窗新增「记忆目录」一行后，
  //   风险块被推到 4264 处、落在旧窗口之外。窗口是守卫的实现细节，语义（必须含风险说明）不变。
  const i = cli.indexOf("dialogState.kind === 'workbenchSetup'")
  // ★2026-09-24（阶段 D）：由魔法长度改为**真实分支边界**（下一个 dialog 分支的开头）。
  //   阶段 D 在弹窗内新增了行状态定级与两条原因码文案，把风险块 / 记忆目录行推出 6000 窗口 ⇒ 假红。
  //   窗口是守卫的实现细节，语义（弹窗必须含风险说明与目录落点）不变。
  const dEnd = cli.indexOf("if (dialogState.kind === 'welcomeTour'", i)
  const seg = dEnd > i ? cli.slice(i, dEnd) : cli.slice(i, i + 9000)
  check('⑧ 用 data-dam-tour-backdrop（居中）', /'data-dam-tour-backdrop': ''/.test(seg))
  check('⑧ 有 role=dialog/aria-modal', /role: 'dialog'/.test(seg) && /'aria-modal': true/.test(seg))
  check('⑧ 含三重校验三行', /①/.test(seg) && /②/.test(seg) && /③/.test(seg))
  check('⑧ 含风险说明', /data-dam-wb-risk/.test(seg) && /必须「完全访问」|Full access required/.test(seg) && /读不到记忆|cannot read memory/.test(seg))
  // ★2026-09-24（用户原话「一定要保证是 full access，这个也要在这个引导界面和用户说清楚，不然他读不到」）：
  //   弹窗还须**回显记忆目录的真实落点**（DSH 本体目录下的 aik_auto_memory_use）。
  check('⑧ 弹窗回显记忆目录落点', /data-dam-wb-dir/.test(seg) && /rootDefault/.test(seg))
  check('⑧ 一键添加按钮调 setup', /action: 'setup'/.test(seg))
}

// ── ⑨ 不重叠：走 openDialog 单例 + 独立优先级
check('⑨ 经 openDialog 打开', /openDialog\(\{ kind: 'workbenchSetup'/.test(cli))
check('⑨ 有独立优先级', /d\.kind === 'workbenchSetup'\) return \d+/.test(cli))

// ── ⑩ 9 个调用点未改签名（迁移不碰调用点）
{
  const calls = idx.match(/this\.runSubagent\(([^)]*)/g) || []
  check('⑩ runSubagent 定义仍为 4 参', /async runSubagent\(text, label, agent, timeoutMs\)/.test(idx))
  check('⑩ 调用点数 = 9', calls.length === 9, 'actual=' + calls.length)
}

// ── ⑪ 迁移必须挂工作台 parent，且保留回退
check('⑪ parent 优先工作台', /const parent = this\._workbenchParent \|\| agent \|\| this\._lastAgent/.test(idx))

// ── ⑫ 门控语义：未就绪返回空串（= 不发任何信息）
{
  const seg = idx.slice(idx.indexOf('async runSubagent('), idx.indexOf('async runSubagent(') + 2200)
  check('⑫ 未就绪 return 空串', /workbench not ready[\s\S]{0,120}return ''/.test(seg))
}

// ── ⑬ P5 周期设置项：前端可选 + 后端有默认值 + 重试退避可配
check('⑬ 后端有 workbenchRetryMs 默认', /workbenchRetryMs: 30000/.test(idx))
// ★E5（2026-09-25）：口径由「两周/月」改为「天」，以下判据同步改写——
//   真语义（周期可配 + 有默认值 + 前端能改）不变，只换掉锁在旧枚举/旧键上的代理判据。
check('⑬ 前端设置项=天数输入框（1–3650）', /type: 'number', min: 1, max: 3650, value: \(cfg\.workbenchPeriodDays/.test(cli))
// ★E3-FIX-3（2026-09-26 二合一）：配置入口**有意迁移**——周期不再独立可调，改为跟随「归档阈值」。
//   按纪律「守的语义未变、对象被有意移除」改写：保留面（仍能配置周期）+ 反向断言（防口径回退）。
check('⑬ 设置项写回配置（入口迁移到归档阈值）', /set\('autoArchiveDays'/.test(cli))
check('⑬ 反向：周期不再独立写回（防二旋钮回退）', !/set\('workbenchPeriodDays'/.test(cli))
check('⑬ 反向：周期显示项为只读（跟随归档阈值）', /value: \(cfg\.workbenchPeriodDays[\s\S]{0,80}readOnly: true/.test(cli))
check('⑬ 后端期长只认 autoArchiveDays（单一来源）', /_workbenchPeriodDays\(\) \{[\s\S]{0,200}Number\(this\.config\.autoArchiveDays\)/.test(idx))
check('⑬ 旧枚举 biweekly/monthly 已清除（防口径回退）', !/'biweekly'/.test(cli) && !/'monthly'/.test(cli))

// ── ⑭ 宿主的 ensureWorkbench/workbenchStatus 都在（路由与门控都依赖）
check('⑭ ensureWorkbench 存在且可 await', /async ensureWorkbench\(/.test(idx))
check('⑭ workbenchStatus 存在', /async workbenchStatus\(\)/.test(idx))
check('⑭ 路由 handler 走 engine 方法', /await engine\.workbenchStatus\(\)/.test(idx) && /await engine\.ensureWorkbench\(\{ consent: true \}\)/.test(idx))
// ★D9-B 同意门加固：唯一的「建立」入口（用户点「同意并建立」）**必须显式传 consent**，
//   否则 ensureWorkbench 会静默新建，绕过门控（对话框承诺「只有你点了「同意并建立」才会写入」）。
check('⑭ 同意门：建立入口显式传 consent + 无 consent 不建',
  /await engine\.ensureWorkbench\(\{ consent: true \}\)/.test(idx) && /consentRequired: true/.test(idx))

// ── ⑮ 启动语义（★2026-09-24 用户裁定后改判据）
//   旧判据「启动即 action:setup 自动建立」已被用户新流程取代：
//     原话「提示我们会建一个什么东西…用户点击同意后，自动开始建立」⇒ 必须**先说明再征得同意**。
//   但该守卫守的不变量本体**未变**：① 不能一上来就弹窗打扰；② 只有未就绪才弹；③ 不轮询。
//   判据改写为「只读检测 + 未就绪才 offer 相位」，并**新增**更强的一条：建立动作唯一（=同意门）。
{
  const i = cli.indexOf('function checkWorkbenchPre')
  const seg = cli.slice(i, cli.indexOf('function loadWelcomeConfigPre'))
  check('⑮ 启动检测为只读（不带 action ⇒ 宿主走只读诊断分支）', /apiPost\(API\.workbench, \{\}\)/.test(seg))
  // ★新不变量：`action:'setup'` 全仓**只允许一处** —— 就是弹窗里「同意并建立」按钮的处理函数。
  //   任何把 setup 悄悄加回检测路径的改动都会让这条变红。
  check('⑮ 建立动作唯一（同意门：setup 仅出现在弹窗内）', (cli.match(/action: 'setup'/g) || []).length === 1)
  // ★S8→v3.1.8（2026-09-24）：就绪分支的实现随新流程再变一次，**不变量本体不变**：
  //   启动路径（fromTour 为假）就绪 ⇒ 静默撤窗（不瞎弹）；向导路径就绪 ⇒ 回一屏 exists（用户要求「已经有就说已经有」）。
  //   无论哪条，**只有未就绪**才落到最后的 offer 弹窗。
  check('⑮ 就绪分支：向导回 exists / 启动静默撤窗，之后才轮到 offer 弹窗',
    /if \(fromTour\) openDialog\(\{ kind: 'workbenchSetup', phase: 'exists'[\s\S]{0,200}?else dismissWorkbenchSetupPre\(\)[\s\S]{0,120}?openDialog\(\{ kind: 'workbenchSetup', phase: 'offer'/.test(seg))
  check('⑮ 检测路径无 setInterval（不瞎弹）', !/setInterval/.test(seg))
}

// ── ⑯ 依赖接线：_ctxRef / _disposed 必须有写入点（否则权限设置静默失败 → 永久门控）
{
  const ctxWrites = (idx.match(/[A-Za-z_$][\w$.]*\._ctxRef\s*=/g) || []).length
  const disWrites = (idx.match(/[A-Za-z_$][\w$.]*\._disposed\s*=/g) || []).length
  check('⑯ _ctxRef 有写入点（权限服务可达）', ctxWrites >= 1, 'writes=' + ctxWrites)
  check('⑯ _disposed 有写入点', disWrites >= 1, 'writes=' + disWrites)
  check('⑯ 权限服务读取路径存在', /r\.get\('permissionPresets'\)/.test(idx))
}

// ── ⑰ 真语义：**工作台会话绝不被删**（轮换 + 归档删除两条路径都守）
// 真语义 = 「不得删除工作台会话」。旧判据把它写成了**代理判据**「一条删除调用都不许有」；
// F 线（2026-09-25 归档/删除自持）引入删除能力后该代理判据已失真。
// 实测依据（artifacts/_f4-guard17-probe.mjs）：旧断言只在 `ensureWorkbench` 起 6600 字符的**切片内**匹配，
// 该切片 = lib/index.js L8699–L8810，而新增的删除能力落在 `async sessionArchiveSweep`（L9433）
// ⇒ **物理不重叠**：旧断言会继续 PASS，却什么都没守（范围性运气绿）。
// ⇒ 按既有纪律「守的语义未变、对象被有意移除」处理：保留原两条不变量，再把真语义改写为四条可判定断言。
{
  // ① 原不变量（保留）：轮换函数切片内不得出现删除动作
  const i = idx.indexOf('async ensureWorkbench(')
  const seg = idx.slice(i, i + 6600)
  const del = /agents\.(remove|delete|destroy)|sessionController\.(remove|delete)|rmSync\s*\(|rmdirSync\s*\(|unlinkSync\s*\(/.test(seg)
  check('⑰a 轮换不删除旧工作台会话目录（删=重新制造幽灵条目）', i > 0 && !del,
    i > 0 ? (del ? '⚠️ 发现删除调用' : '无删除调用') : 'ensureWorkbench 未找到')
  // ② 原不变量（保留）：GC 不得接管工作台会话（否则它会被搬走 ⇒ 同一后果）
  const gi = idx.indexOf('subagentGcSweep')
  const gseg = gi > 0 ? idx.slice(gi, gi + 3200) : ''
  check('⑰b 子代理 GC 不触碰工作台会话', gi > 0 && !/workbench/i.test(gseg),
    gi > 0 ? 'gc段内含workbench=' + /workbench/i.test(gseg) : 'GC 未找到')

  // ── 以下四条**全仓**判定（非切片），用于真正守住 F 线新增的删除能力 ──

  // ③ 行为断言：删除入口必须把工作台会话（workbench.json 的 current/previous）拒掉
  //    判据：受保护集合由 workbenchSessionIds() 填充，且该集合原样传给 planDelete 的**保护参数**
  //    注意 detail 里的复核正则必须容纳 seeds.map((s) => s.id) 内部的括号，故用 [\s\S] 而非 [^)]
  const wbAt = idx.indexOf('this.workbenchSessionIds()')
  const planWired = /planDelete\(rows,[\s\S]{0,80}?protectedReason\)/.test(idx)
  check('⑰c1 工作台会话被收进受保护集合并传给 planDelete',
    wbAt > 0 && idx.includes("protectedReason.set(id, 'workbench')") && planWired,
    'workbenchSessionIds@' + wbAt + ' 保护参数接线=' + planWired)

  // ④ 保留面：受保护理由至少覆盖 workbench 与 running(live) 两类（四类口径的两条硬底线）
  check('⑰c2 受保护集合覆盖 workbench 与 live 两类理由',
    idx.includes("protectedReason.set(id, 'workbench')") && idx.includes("protectedReason.set(String(id), 'live')"),
    'workbench=' + idx.includes("protectedReason.set(id, 'workbench')") +
      ' live=' + idx.includes("protectedReason.set(String(id), 'live')"))

  // ⑤ 路径断言：物理删除必须经受控入口 removeSessionDir(dir, root)
  //    （根外/逃逸软链的拒绝由该函数内部 realpath 复验保证 —— 不在此重复实现判据）
  check('⑰c3 物理删除经受控入口 removeSessionDir(dir, root)',
    /removeSessionDir\(index\.byId\.get\(id\), root\)/.test(idx),
    'removeSessionDir 调用点数=' + count(idx, 'removeSessionDir('))

  // ⑥ 幂等断言：无可删项时**完全不写盘**（先提前 return，其后才写归档账本）
  //    注意：saveArchiveLedger 在**归档**分支也调用一次 ⇒ 必须限定在**删除分支内**比较顺序，
  //    否则会拿归档分支的调用来比（本次实测踩过：ledger 位置反而在 guard 之前 ⇒ 假红）
  const delBranch = idx.indexOf('if (cfg.autoDeleteEnabled !== false) {')
  const delSeg = delBranch > 0 ? idx.slice(delBranch, delBranch + 2600) : ''
  const guardAt = delSeg.indexOf('if (plan.targets.length === 0) return rep')
  const liveAt = delSeg.indexOf('if (live.length === 0) return rep')
  const ledgerAt = delSeg.indexOf('this.saveArchiveLedger(ledger)')
  check('⑰c4 无可删项时提前返回且不写账本（幂等）',
    delBranch > 0 && guardAt > 0 && liveAt > guardAt && ledgerAt > liveAt,
    'delBranch@' + delBranch + ' guard@' + guardAt + ' live@' + liveAt + ' ledger@' + ledgerAt)
}

// ── ⑱ 两条 spawn 路径都必须被回收
// 历史缺陷：回退路径用**独立变量**接住 run，而 finally 的 dispose 与 recycleSubagentSession
// 只看主路径变量 ⇒ 走回退(UNKNOWN_MODEL)时子代理永不回收、在 ~/.dsh/sessions 下堆积。
{
  // 用真实函数边界切片（不要用魔法长度 —— 切片太短会让断言假红）
  const s = idx.indexOf('async runSubagent(')
  const e = idx.indexOf('async recycleSubagentSession(')
  const fn = s > 0 && e > s ? idx.slice(s, e) : ''
  const starts = (fn.match(/await subagents\.start\(/g) || []).length
  const stray = (fn.match(/\brun\d+\b/g) || []).length
  check('⑱ runSubagent 内含 2 条 spawn（主 + 回退）', starts === 2, 'starts=' + starts + ' len=' + fn.length)
  check('⑱ 无 run2 之类独立变量（否则回退路径不被回收）', stray === 0, 'stray=' + stray)
  // finally 里必须同时有 dispose 与 recycle
  const fi = fn.indexOf('} finally {')
  const fin = fi > 0 ? fn.slice(fi) : ''
  check('⑱ finally 仍做 dispose + recycleSubagentSession',
    /run\.dispose/.test(fin) && /recycleSubagentSession/.test(fin),
    'finally.len=' + fin.length)
}

console.log('══ 工作台迁移 · 结构不变量守卫 ══\n')
for (const s of ok) console.log('  PASS  ' + s)
for (const s of bad) console.log('  FAIL  ' + s)
console.log('\nPASS ' + ok.length + ' / FAIL ' + bad.length)
process.exit(bad.length ? 1 : 0)
