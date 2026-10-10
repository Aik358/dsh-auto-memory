/** 工作台相关守卫：缺口①（工作区注册）、③（greeting loop）、⑤（打开复查） */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// 仓库根：由本文件位置推导（tests/smoke/*.mjs → 上两级）。
// 2026-09-26 修：原先硬编码 'D:/dsh-auto-memory'，CI 在 /home/runner/... 下必 ENOENT。
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const idx = fs.readFileSync(path.join(ROOT, 'lib/index.js'), 'utf8')
const cli = fs.readFileSync(path.join(ROOT, 'lib/client.js'), 'utf8')

let P = 0, F = 0
const ck = (name, ok, detail) => {
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? '  ' + detail : ''))
  ok ? P++ : F++
}

console.log('\n══ 缺口①：工作区注册 ══')
ck('workspaceRegistry.create 被调用（而非只读）',
  /workspaceRegistry[\s\S]{0,200}?typeof reg\.create === 'function'/.test(idx) || /reg\.create\(cwd, /.test(idx),
  'idx')
ck('注册后写 diag（可观测）', /workbench workspace registered/.test(idx))
ck('注册失败不影响工作台（try 包住）',
  // ★C-1b：登记块由「就地补登记」收敛为「复用优先 + 缺登记才 create」（PR#237），
  //   两分支仍完整包在同一 try/catch 内 ⇒ 判据意图不变（注册失败不影响工作台）。
  /let wsId = '[\s\S]{0,1400}?reg\.create\(cwd[\s\S]{0,400}?catch \(eW\)/.test(idx))

console.log('\n══ 缺口③：greeting loop（S4 纠错后：换**子代理代次**，不换会话）══')
ck('workbench.json 写入 greetCount', /greetCount: 0,/.test(idx))
ck('loop 上限可配（workbenchGreetLoop，默认 10）',
  /Number\(this\.config\.workbenchGreetLoop\) \|\| 10/.test(idx))
// ★S4 纠错（2026-09-24 用户明确纠正）：循环的是**子代理代次**，不是工作台会话。
//   旧判据守 loop-exhausted（=满 10 换会话），与规格相反；现改守 bumpGenFor + 会话不变。
ck('❌ 不得再有「满 10 换会话」判据', !/reason: 'loop-exhausted'/.test(idx))
ck('新增分类代次计数 bumpGenFor', /async bumpGenFor\(label\)/.test(idx))
ck('代次按 label 分别落盘', /st\.gen\[label\]/.test(idx))
ck('满 loopSize ⇒ gen+1（会话不变）', /cur\.gen \+= 1/.test(idx) && /session unchanged/.test(idx))
ck('greet 走代次计数', /bumpGenFor\('greet'\)/.test(idx))
ck('状态回显 gen 视图', /gen: \(st && st\.gen/.test(idx))

console.log('\n══ 缺口⑤：打开时复查（不轮询）══')
ck('visibilitychange 复查', /visibilitychange/.test(cli))
ck('focus 复查', /addEventListener\('focus'/.test(cli))
ck('未新增 setInterval 用于工作台',
  // ★必须先剥注释：注释里那句「无 setInterval」会命中字面量 ⇒ 假红（第 15 次判据错）
  (() => {
    const noCmt = cli.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
    const hits = [...noCmt.matchAll(/setInterval\s*\(/g)].map((m) => {
      const ln = noCmt.slice(0, m.index).split('\n').length
      return noCmt.split('\n').slice(Math.max(0, ln - 8), ln + 2).join(' ')
    })
    return !hits.some((h) => /workbench/i.test(h))
  })(),
  '去注释后判定')

console.log('\n══ 既有不变式（回归保护）══')
ck('门控仍在（未就绪不发信息）', /gated: workbench not ready/.test(idx))
ck('⑰ 轮换不删旧会话（无删除 API 调用）', !/agents\.(remove|delete|destroy)\(/.test(idx))
ck('⑱ 无 runN 独立变量', !/\brun\d+\b/.test(idx.slice(idx.indexOf('async runSubagent('), idx.indexOf('async recycleSubagentSession('))))
ck('居中弹窗壳仍在', /data-dam-tour-backdrop/.test(cli) && /data-dam-wb-risk/.test(cli))
ck('设置项 workbenchPeriod 仍在', /workbenchPeriod/.test(cli))

console.log('\n══ S1/S6/S8/S9（2026-09-24 · 对齐 docs/internal/WORKBENCH-SPEC.md）══')
// S1：工作台工作区路径必须来自**插件设置**（用户原话「只不过是在插件设置的工作区里面」），不得再硬推导
// ★2026-09-24 口径变更（用户原话「在 DeepSeek harness 这个软件本体里面新建一个文件夹…就叫 aik_auto_memory_use…跨平台性最好」）：
//   默认值由硬编码 '~/.dsh/memory' 改为**空串 = 自动**，真实落点用 dshHome() 推导
//   （硬编码 ~/.dsh 会在 DSH_HOME 被改过的机器上与路径闸分叉 ⇒ 值被静默丢弃、读不到记忆）。
ck('S1 工作台目录名常量 = aik_auto_memory_use', /const WORKBENCH_DIRNAME = 'aik_auto_memory_use'/.test(idx))
ck('S1 默认值为空串（= 自动，不再硬编码 ~/.dsh/memory）',
  /workbenchRoot: '',/.test(idx) && !/workbenchRoot: '~\/\.dsh\/memory'/.test(idx))
ck('S1 落点用 dshHome() 推导（跨平台 + 与路径闸同口径）',
  /path\.join\(dshHome\(\), WORKBENCH_DIRNAME\)/.test(idx))
// ★2026-10-05 判据随源码演进（批次 Z/PR#213 claim4）：/config 逐键路径闸升级为字段级校验
//   all-or-nothing（validateSettingsPatch/validateSettingsPaths，位于 lib/settings-safety.js），
//   三路径键同闸 + 祖先 realpath 防 symlink 逃逸；workbenchRoot 空串显式合法（=自动）。
//   守卫跨双文件取证（idx=index.js 调用面 + safety=校验实现面），防校验被静默旁路。
ck('S1 路径闸（批次 Z 后形态）：/config 走字段级校验且 import 齐全',
  /const fields = \{ \.\.\.validateSettingsPatch\(patch\), \.\.\.await validateSettingsPaths\(patch, dshHome\(\)/.test(idx)
  && /import \{ migrateSettingsTree, validateSettingsPatch, validateSettingsPaths, readSettingsForSave \} from '\.\/settings-safety\.js'/.test(idx))
ck('S1 workbenchRoot 走宿主路径闸（与 memoryRoot 同口径，三键同闸 + 空串合法）',
  (function () {
    const safety = fs.readFileSync(path.join(ROOT, 'lib/settings-safety.js'), 'utf8')
    return /\['memoryRoot', 'userMemoryDir', 'workbenchRoot'\]/.test(safety)
      && /key === 'workbenchRoot' && patch\[key\] === ''\) continue/.test(safety)
      && /validateSettingsPaths/.test(idx)
  })())
ck('S1 status 回显解析后的默认落点', /rootDefault: path\.join\(dshHome\(\), WORKBENCH_DIRNAME\)/.test(idx))
ck('S1 _workbenchCwd 读 config.workbenchRoot',
  /_workbenchCwd\(\) \{\r?\n\s+const raw = String\(this\.config\.workbenchRoot/.test(idx))
// ★2026-10-05 判据随源码演进（社区报告：Android `/data/user/0` ↔ `/data/data` 符号链接别名恒 cwd-mismatch）：
//   路径收窄与 fail-soft 回默认的逻辑本体未变，只是两侧先经 `_canonPath`（realpath）归一再比较 ——
//   守卫同步钉住归一形态，防止未来有人把字面比较改回去（那会让符号链接环境再次恒判 cwd-mismatch）。
  // ★C-1b（PR#237）：rel 的越界判据由「前缀匹配」改为「组件级」（恰为 '..' 或 '..' + sep 开头）——
  //   否则同级的 `..foo` 目录会被误判为越界。**判据意图不变**：仍钉住「先从归一父根算 rel、
  //   越界与绝对路径一律 fail-soft 回默认」。
  ck('S1 路径收窄到 dshHome 之下（非法 ⇒ fail-soft 回默认）——归一形态',
    /path\.relative\(this\._canonPath\(dshHome\(\)\), this\._canonPath\(p\)\)[\s\S]{0,400}?return this\._canonPath\(fallback\)/.test(idx))
  // ★2026-10-06 批次 V2-1 判据演进：realpath 实现已收敛到 lib/file-boundary.js 单一来源，
  //   引擎的归一函数改为**委托**（原两处自带实现细节随之消失）。**判据意图不变**：仍钉住
  //   「归一函数存在 + verify/登记两处比较点都走归一」，只是按委托形态取证（改回字面比较仍必红）。
  //   ⚠️ 注释不得逐字抄回被替换的旧写法——否则会把「旧写法已归零」类断言喂饱（本仓踩过）。
  ck('S1+ 归一函数存在且 verify/登记两处比较点都走归一（防字面比较回流）',
    /_canonPath\(p\) \{ return canonPath\(p\) \}/.test(idx)
    && /this\._pathKey\(cwd\) !== this\._pathKey\(this\._workbenchCwd\(\)\)/.test(idx)
    && /this\._pathKey\(w\.path\) === wsPath/.test(idx)
    && /_pathKey\(p\) \{ return pathKey\(p\) \}/.test(idx)
    && /export function canonPath\(p\) \{/.test(fs.readFileSync(path.join(ROOT, 'lib/file-boundary.js'), 'utf8')))
// ★2026-09-28 口径收窄：本条原断言 `set('workbenchRoot')` **且** `key: 'workbenchRoot'` 同时成立，
//   把两件事混在一起——（a）设置页有工作台目录项（b）向导里也有同名开关。
//   向导侧的目录项已被**更合理的布尔开关** `workbenchEnabled` 取代：旧写法把**目录路径（字符串）**
//   当开关用，而向导开关形态走 `!!c[key]` ⇒ 非空值恒判「开」，点一下还会把布尔写进路径配置
//   （同一类缺陷此前在 workbenchPeriod 上已修过一次）。故本守卫按其**真实意图**收窄为两条：
ck('S1 设置页有「工作台工作区」路径项 + 搜索索引',
  /set\('workbenchRoot'/.test(cli) && /cfg\.workbenchRoot/.test(cli))
ck('S1 向导的工作台开关用布尔键 workbenchEnabled（不把路径当开关）',
  /key: 'workbenchEnabled'/.test(cli) && !/key: 'workbenchRoot'/.test(cli))
ck('S1 目录选择器按调用方指定的键回填（不串改另一个设置）',
  /function openBrowser\(targetKey\)/.test(cli) && /set\(_targetKey, d\.dir\)/.test(cli) &&   /set\(browseKey \|\| 'memoryRoot', browsePath\)/.test(cli))
ck('S1 设置页占位显示 aik_auto_memory_use（留空=自动）',
  /placeholder: 'aik_auto_memory_use'/.test(cli) && /value: \(cfg\.workbenchRoot \|\| ''\)/.test(cli))
ck('S1 workbenchRoot 走宿主路径闸（批次 Z 后形态已上移到 validateSettingsPaths 双文件取证，见上）', true)
// S6：必须同时校验「工作区登记」与「会话存在」（用户原话「检测到底有没有这个工作区和对话出现」）
ck('S6 校验工作区登记（workspace-unregistered）', /workspace-unregistered/.test(idx))
ck('S6 用 registry.list() 只读判定（不产生副作用）', /wbReg\.list\(\)/.test(idx))
  // ★C-1b（PR#237）：补登记由「触发式 re-register」收敛为「登记块内复用优先」。
  //   判据意图不变：**复用已有登记而不是重复 create**（原为 list 查重 + regFix.create，
  //   现为 list().find 复用 + 仅缺失时 create）。
  ck('S6 登记缺失时复用已有 id，缺登记才 create（不重复建）',
    /existing = reg\.list\(\)\.find/.test(idx) && /this\._pathKey\(w\.path\) === this\._pathKey\(cwd\)/.test(idx)
    && /else if \(reg && typeof reg\.create === 'function'\)/.test(idx)
    // ★C-1b：PR#237 原判据断言补登记块被整体删除；本批**有意保留**该块（它保「复用分支」在登记缺失时
    //   也能自愈，删掉会让该路径不再自愈）⇒ 判据改为「补登记块存在且同样先查重、判据走 _pathKey、
    //   不再自写第二份 toLowerCase」。
    && /if \(!exists\) \{ const w2 = await regFix\.create/.test(idx)
    && /this\._pathKey\(w\.path\) === this\._pathKey\(cwd\)\) \} catch \(eL\)/.test(idx)
    && !/const norm2 = \(x\) => String/.test(idx))
ck('S6 弹窗展示第 ④ 行「工作区登记」', /④ 工作区登记/.test(cli))
// S8：后端自动配置成功 ⇒ 居中弹窗**自动消失**（用户原话「或者等它自动配置完再消失」）
ck('S8 有撤窗助手 dismissWorkbenchSetupPre', /function dismissWorkbenchSetupPre\(\)/.test(cli))
// ★v3.1.8（2026-09-24 用户裁定后改判据）：
//   旧判据要求「就绪 ⇒ 无条件撤窗」。新流程下**向导路径**就绪时要回一屏「已经有，直接可以使用」
//   （用户原话「如果已经有，就显示已经有，直接可以使用」），所以不再是无条件撤窗。
//   守卫守的不变量本体**未变**：**启动路径**就绪必须静默撤窗（不瞎弹）。
// ★D8（2026-09-25）判据升级：守的不变量本体未变（**启动路径**就绪必须静默撤窗），
//   但判据从 `st.ready` 换成唯一同源判据 `wbExistsPre(st)` —— 原写法只看宿主进程内的内存态，
//   重启后恒 false ⇒ 实测 verify.ok=true 仍误弹「建立「记忆中枢」」。
ck('S8 启动路径就绪即静默撤窗（向导路径回 exists 屏）',
  /if \(wbExistsPre\(st\)\) \{[\s\S]{0,220}?else dismissWorkbenchSetupPre\(\)/.test(cli))
// ★D8 加固：开窗门与渲染相位**必须同源** —— 两处各写一份判据正是本次缺陷的根因
//   （开窗门用内存态 ready、渲染相位用真值 verify.ok，且开窗时 phase 显式传入 ⇒ 后者被短路）。
ck('S8 工作台存在性只有一份判据 wbExistsPre（定义 + 开窗门 + 渲染相位三处引用）',
  /function wbExistsPre\(st\)/.test(cli) && (cli.match(/wbExistsPre\(/g) || []).length >= 3)
// ★D8：服务端 ready 必须报真值（内存态 **或** verify 通过），并带可诊断来源
//   —— `ensureWorkbench` 只在「用户点建立」与「runSubagent 惰性门控」两处被调，
//   重启后无人主动算它 ⇒ 只报内存态会让客户端恒判「没建」。
ck('D8 服务端 ready 报真值 + readySource 可诊断',
  /ready: !!\(v && v\.ok\)/.test(idx) && /readySource:/.test(idx) && /memoryReady:/.test(idx))
// ★D8b 加固：ready **不得**与内存态取或 —— 取或会让期号轮换后 stale-true 掩盖 epoch-mismatch
//   ⇒ 客户端漏报轮换 + runSubagent 门控跳过重建（本期会话永不重建）。
ck('D8b ready 不与内存态取或（防期号轮换漏报）',
  !/ready: !!\(this\._workbenchReady \|\| \(v && v\.ok\)\)/.test(idx))
ck('D8b 验证不通过时同步清内存就绪位（让惰性门控可重跑）',
  /if \(!\(v && v\.ok\)\) \{[\s\S]{0,200}?this\._workbenchReady = false/.test(idx))
// ★D9-B 同意门：门控本体在客户端（唯一 action:'setup' 点在弹窗按钮上）；服务端惰性路径必须拿不到同意。
ck('D9 同意门：结构性失败时未经同意不得新建（只回报 needPrompt）',
  /opts && opts\.consent === true/.test(idx) && /consentRequired: true/.test(idx))
ck('D9 唯一建立入口显式传 consent', /ensureWorkbench\(\{ consent: true \}\)/.test(idx))
// ★2026-10-10 判据重钉（#330，判据过期非缺陷）：
//   本守卫守的**不变量本体未变** —— 「瞬态分支必须先于同意门返回 `transient+retry`，把重启自愈路径堵死」。
//   #330 让该分支多了一种归因（`host-conflict` = 另一宿主 writer-held）并加了 `resolveError`，
//   于是那行返回从**单行字面量**变成**多行对象**，原逐字正则匹配不到（形态守卫钉文本的固有脆性）。
//   按判据**意图**改钉：仍要求该分支返回 transient+retry，且**仍在 consent 门之前**返回（顺序不变）。
//   新增两条更贴近意图的断言：① host-conflict 只在显式同意时才越过；② 非 host-conflict 一律不越。
ck('D9 同意门不得拦复用/瞬态分支（否则重启自愈被堵死）',
  /reason: this\._workbenchReason, epoch, sessionId: v\.sessionId,\s*transient: true, retry: true/.test(idx)
  && /if \(v\.reason === 'session-not-loaded'\) \{/.test(idx)
  && /if \(!\(wbHostConflict && opts && opts\.consent === true\)\) \{/.test(idx))
// S9：新手引导 → 工作台设置窗 → **才** changelog（用户原话「配置好才能让它正常使用…或者它配置完以后再弹 change log」）
ck('S9 changelog 受工作台就绪闸门约束', /var wbPending = \(wbReady === false\)/.test(cli))
ck('S9 三处 update 弹窗全走闸门', (cli.match(/dialogQueue\.push\(_upd\d\)/g) || []).length === 3)
ck('S9 先定就绪状态再分发（同批触发）', /dispatchStartupDialog\(pair\[0\], cfg, workbenchReadyState\)/.test(cli))
ck('S9 就绪判定有 5s 一次性上限（拒绝=未知 ⇒ 不阻塞更新通知）',
  /Promise\.race\(\[[\s\S]{0,240}?setTimeout\(function \(\) \{ r\(null\) \}, 5000\)/.test(cli))
ck('S9 设置窗去重键带状态（关掉后可再次弹出，否则失败后永远配不上）',
  /'workbenchSetup:' \+ \(\(\(d\.status \|\| \{\}\)\.reason\) \|\| 'unknown'\)/.test(cli))
// 负向：补登记不得引入删除（与守卫⑰同源）
// ★2026-09-24 口径精化（修假红 + 收紧语义）：
//   ① 本文件既有纪律（见上方 L37-39）：**先剥注释再匹配**，否则注释里的字面量造成假红；
//   ② 守卫 ⑰ 的真实意图 = **不删会话**（删会话会让 subagentCatalog 指向不存在目录，正是要根治的幽灵条目）；
//      官方 dsh-api-workspace-controller 的 delete docstring 明确「不删目录、不删任何 session 日志」，
//      故「删工作区登记」不违反 ⑰；
//   ③ 但登记删除必须**仅**经受控入口，且该入口须带三条自保判据（标题/空会话/非当前路径）。
const idxNoCmt = idx.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
ck('S6/⑰ 未引入任何**会话**删除调用', !/agents\.(remove|delete|destroy)\(/.test(idxNoCmt))
ck('S6/⑰ 无裸 workspaceRegistry 删除调用（必须走受控入口）',
  !/workspaceRegistry\.(remove|delete)/.test(idxNoCmt))
ck('S6/⑰ 工作区登记删除仅经受控入口（含三条自保判据）',
  /_pruneStaleWorkbenchWorkspaces\(keepCwd\)/.test(idxNoCmt) &&
  /String\(w\.title \|\| ''\) !== '记忆中枢'/.test(idxNoCmt) &&
  /Array\.isArray\(w\.sessionIds\) \? w\.sessionIds : \[\]/.test(idxNoCmt) &&
  /if \(ids\.length > 0\) continue/.test(idxNoCmt) &&
  /if \(!w\.path \|\| this\._pathKey\(w\.path\) === keep\) continue/.test(idxNoCmt))

console.log('\nPASS ' + P + ' / FAIL ' + F)
process.exit(F ? 1 : 0)
