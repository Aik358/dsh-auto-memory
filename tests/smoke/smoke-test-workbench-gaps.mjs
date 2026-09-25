/** 工作台相关守卫：缺口①（工作区注册）、③（greeting loop）、⑤（打开复查） */
import fs from 'node:fs'
const idx = fs.readFileSync('D:/dsh-auto-memory/lib/index.js', 'utf8')
const cli = fs.readFileSync('D:/dsh-auto-memory/lib/client.js', 'utf8')

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
  /try \{[\s\S]{0,400}?reg\.create\(cwd[\s\S]{0,300}?catch \(eW\)/.test(idx))

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
ck('S1 路径闸允许空串（= 回到自动）', /if \(!rawPath\.trim\(\)\) \{ if \(key === 'workbenchRoot'\) patch\[key\] = ''/.test(idx))
ck('S1 status 回显解析后的默认落点', /rootDefault: path\.join\(dshHome\(\), WORKBENCH_DIRNAME\)/.test(idx))
ck('S1 _workbenchCwd 读 config.workbenchRoot',
  /_workbenchCwd\(\) \{\r?\n\s+const raw = String\(this\.config\.workbenchRoot/.test(idx))
ck('S1 路径收窄到 dshHome 之下（非法 ⇒ fail-soft 回默认）',
  /path\.relative\(dshHome\(\), p\)[\s\S]{0,200}?return fallback/.test(idx))
ck('S1 设置页有「工作台工作区」路径项 + 搜索索引', /set\('workbenchRoot'/.test(cli) && /key: 'workbenchRoot'/.test(cli))
ck('S1 目录选择器按调用方指定的键回填（不串改另一个设置）',
  /function openBrowser\(targetKey\)/.test(cli) && /set\(_targetKey, d\.dir\)/.test(cli) &&   /set\(browseKey \|\| 'memoryRoot', browsePath\)/.test(cli))
ck('S1 设置页占位显示 aik_auto_memory_use（留空=自动）',
  /placeholder: 'aik_auto_memory_use'/.test(cli) && /value: \(cfg\.workbenchRoot \|\| ''\)/.test(cli))
ck('S1 workbenchRoot 走宿主路径闸（与 memoryRoot 同口径）',
  /key === 'memoryRoot' \|\| key === 'userMemoryDir' \|\| key === 'workbenchRoot'/.test(idx))
// S6：必须同时校验「工作区登记」与「会话存在」（用户原话「检测到底有没有这个工作区和对话出现」）
ck('S6 校验工作区登记（workspace-unregistered）', /workspace-unregistered/.test(idx))
ck('S6 用 registry.list() 只读判定（不产生副作用）', /wbReg\.list\(\)/.test(idx))
ck('S6 未登记时就地补登记，且先 list 查重（不重复 create）',
  /workbench workspace re-registered/.test(idx) && /if \(!exists\) \{ const w2 = await regFix\.create/.test(idx))
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
ck('D9 同意门不得拦复用/瞬态分支（否则重启自愈被堵死）',
  /session-not-loaded', epoch, sessionId: v\.sessionId, transient: true, retry: true/.test(idx))
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
  /if \(norm\(w\.path\) === keep\) continue/.test(idxNoCmt))

console.log('\nPASS ' + P + ' / FAIL ' + F)
process.exit(F ? 1 : 0)
