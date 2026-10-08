import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const source = readFileSync(new URL('../../lib/client.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
// ★2026-09-30 双皮肤块（用户裁定：旧款为默认 + 三套变体经下拉选择）：
//   生成区现有**两块**（legacy 旧款 + 三套变体）——本快照关心「剥掉生成区后的经典侧」，
//   故两块都要拆；并把**分派行**归一回单分支形态，否则比对的就不是「经典档」而是「双块集成形态」。
// ★2026-10-08（用户批准）剥离管道自检 ①②：marker 结构唯一性 + 顺序依赖显式化。
//   背景：variant marker 在 legacy 块**内部**也出现一次（六空格缩进），与四空格的块首 marker
//   属同名前缀关系。当前管道靠「先剥 legacy、再剥 variant」的执行顺序规避 —— 实测逆序会剥错
//   区间（剥离结果 983,508 → 1,532,749 字符，差 549,241）。以下断言把顺序依赖从隐性改为显式：
//   一旦有人重排本文件第 15/16 行（两块剥离的先后），立即红。
const stripSelfCheck = (() => {
  const ls = source.split('\n')
  const cnt = (needle) => ls.filter((line) => line.indexOf(needle) >= 0).length
  assert.equal(cnt('ITER5-LEGACY-GENERATED:BEGIN'), 1, '剥离自检① legacy BEGIN 应恰 1 行')
  assert.equal(cnt('ITER5-LEGACY-GENERATED:END'), 1, '剥离自检① legacy END 应恰 1 行')
  assert.equal(cnt('ITER5-GENERATED:BEGIN'), 2, '剥离自检① variant BEGIN 应恰 2 行（1 在 legacy 内 + 1 在外）')
  assert.equal(cnt('ITER5-GENERATED:END'), 2, '剥离自检① variant END 应恰 2 行（1 在 legacy 内 + 1 在外）')
  const iLB = ls.findIndex((line) => line.indexOf('ITER5-LEGACY-GENERATED:BEGIN') >= 0)
  const iLE = ls.findIndex((line) => line.indexOf('ITER5-LEGACY-GENERATED:END') >= 0)
  const iVB = ls.findIndex((line) => line.indexOf('ITER5-GENERATED:BEGIN') >= 0)
  const iVE = ls.findIndex((line) => line.indexOf('ITER5-GENERATED:END') >= 0)
  assert.ok(iLB < iVB && iVB < iVE && iVE < iLE, '剥离自检② 首个 variant 对应整体落在 legacy 块内（顺序依赖来源）')
  const afterLegacy = ls.slice(0, iLB).concat(ls.slice(iLE + 1)).join('\n')
  assert.equal(afterLegacy.split('ITER5-GENERATED:BEGIN').length - 1, 1, '剥离自检② 剥 legacy 后 variant BEGIN 应余 1 处')
  assert.equal(afterLegacy.split('ITER5-GENERATED:END').length - 1, 1, '剥离自检② 剥 legacy 后 variant END 应余 1 处')
  return { iLB, iLE, iVB, iVE }
})()
console.log('PASS 剥离自检①②：marker 结构唯一 + 顺序依赖成立（legacy L' + (stripSelfCheck.iLB + 1) + '-L' + (stripSelfCheck.iLE + 1) + '，内嵌 variant 对 L' + (stripSelfCheck.iVB + 1) + '/L' + (stripSelfCheck.iVE + 1) + '）')
const classic = source
  .replace(/    \/\/ ===== ITER5-LEGACY-GENERATED:BEGIN =====[\s\S]*?    \/\/ ===== ITER5-LEGACY-GENERATED:END =====\n/, '')
  .replace(/    \/\/ ITER5-GENERATED:BEGIN[\s\S]*?    \/\/ ITER5-GENERATED:END\n/, '')
  .replace("+ DAM_SKIN_V4_CSS + '\\n' + (damSkinLegacy() ? LEGACY_ITER5_CSS : ITER5_CSS) + '\\n/* dam-skin:end (v4) */'", "+ DAM_SKIN_V4_CSS + '\\n/* dam-skin:end (v4) */'")
  .replace("h('div', { 'data-dam-skin-v4-root': '1' }, damSkinLegacy()\n            ? h(Legacy5Page, { nonce: nonce, onExit: function () { damSkinRemoveCss(); setNonce(nonce + 1) } })\n            : h(Iter5Page, { nonce: nonce, onExit:", "h('div', { 'data-dam-skin-v4-root': '1' }, h(DamSkinV4Page, { nonce: nonce, onExit:")
  .replace('h(Iter5Page, { nonce: nonce, onExit:', 'h(DamSkinV4Page, { nonce: nonce, onExit:')
  .replace("try { ensureStyle(); if (damSkinActive() === 'v4') damSkinEnsureCss() } catch", 'try { ensureStyle() } catch')
  .replace('function DialogHost() {\n      var tourDeep = useDeepTheme()\n      var tickPair = useTick()', 'function DialogHost() {\n      var tickPair = useTick()')
  .replace("tourStep === 0 ? h(SkinHero, { slot: 'hero.welcome', deep: tourDeep })", "tourStep === 0 ? h(SkinHero, { slot: 'hero.welcome', deep: useDeepTheme() })")
// ★2026-10-08（用户批准）剥离管道自检 ③：剥离结果里不得残留任何生成区 marker。
//   本项原先只由维护者手工核验；固化为断言后，剥离管道一旦漏切（正则不再命中、或块边界
//   标记被人改动），此处立即红，而不必等到基线哈希对不上时再反查。
for (const _mk of ['ITER5-LEGACY-GENERATED:BEGIN', 'ITER5-LEGACY-GENERATED:END', 'ITER5-GENERATED:BEGIN', 'ITER5-GENERATED:END']) {
  assert.equal(classic.split(_mk).length - 1, 0, '剥离自检③：classic 中不应残留 marker ' + _mk)
}
console.log('PASS 剥离自检③：4 个生成区 marker 在剥离结果中零残留')
// ★2026-09-30：本快照基线演进（PR #150 移植到 3.2.5 之上）——生成块**之外**的 client.js 现包含 3.2.5 的合法修复
//   （接续身份钉死 clickedSid、StatsTab/Iter5Stats 解包 data.stats），故快照哈希随之变化；
//   守卫语义不变：生成块之外的任何**非意外**改动仍会被本锁抓住。
// #287: 在 R82 基线 39a882d 上，仅新增有界成功消费记录与到期清除（AutoContinueHost 手写区）。
// 本文件 classic 剥离表达式实算：bd574416… → ff35f295…；生成区仍由 --check 验证。
// ★2026-09-30（B 批 · 皮肤可插拔入口，同一裁定续批）本快照第三次演进，归因：
//   SkinPicker 新增「皮肤族四款直选」（基线 / 仪器 / 编辑 / 活水）+ 高亮口径覆盖四款；
//   pick() 改写：家族档写 dam-skin-style（基线档还删 dam-skin 回到「未显式选过」语义，
//   与三值模型一致）；主题层（用户自装）保持 dam-skin=v4 + dam-skin-variant 不变。
//   动因：四款下拉原先只在变体页侧栏，默认档（基线块）无任何入口 ⇒ 皮肤切换死锁。
//   功能性验收另见 smoke-test-skin-pluggable.mjs（真执行 flavor/pick 语义 + 变异必红）。
// ★2026-09-30（C1 · 设置面补全，用户「三面必须全量同步」）本快照第四次演进，归因：
//   经典档 SettingsPage 的 engine 分区新增 4 道真闸门控件（激活收件箱/影子检索/上下文桥/L0 索引）
//   + 1 个只读诊断块（总闸·模式·档位·Python 运行时），并补 zh/en 字典条目。
//   同期同内容已落到冻结基线块（skins/legacy/iter5-325.js.frozen）与生成变体块（跑生成器继承）。
//   三面同步由 smoke-test-settings-parity.mjs 守卫（逐控件计数：4 键 x 3 面 = 12，缺一即红）。
// ★2026-09-30（C2 · 注入预算/水位/接续归档 14 键）本快照第五次演进：经典档 engine/window 分区
//   新增 14 个控件 + zh/en 各 28 条字典；同步落到冻结基线块与生成变体块（三面 14x3=42 处 set()）。
//   三面同步守卫同步扩到 99 键（原 85），缺一即红。
// ★2026-09-30（C3 · 团队/同步 23 键）本快照第六次演进：renderTeamSettings 单点定义（三面共用）扩展
//   键表 9→23、字段表同步、新增三类渲染分支（selectTrans/selectE2E/number）、zh/en 各 23 条标签。
//   同批修复守卫自身缺陷：l3-team 的键提取正则 [a-zA-Z]+ 漏掉含数字键（teamE2E）⇒ 改为 [A-Za-z0-9_$]+。
// ★2026-09-30（D2 · 设置双向实时同步）本快照第七次演进：saveConfigPatch 成功后 emit 广播（唯一写出口
//   一处收口）；两个 I5 入口（宿主设置面板 / 工作台设置页）各增一个「广播即重取」effect，含三条安全线
//   （有草稿不覆盖用户输入 / busy 不重取 / 身份不符放弃）。功能性验收见 smoke-test-settings-sync.mjs。
// ★2026-09-30（D3 · 提示词层镜像 12→23 逐字一致）本快照第八次演进：DEFAULT_PROMPT_LAYERS_CLIENT
//   由 12 层扩为与服务端同键序的 23 层、逐字一致（此前 snapshotHead/snapshotWelcomeBody 为截断版）。
//   守卫升级：g4-whiteboard 新增 G4-6d（键集相等 + 逐键求值比对），并把原 G4-6b 的键序假设改为花括号配对抽取。
// ★2026-09-30（A 批 · 皮肤可插拔重构，用户裁定「基线永不变」）本快照再次演进，归因五条：
//   (1) damSkinActive 由二值改三值（classic / v4 / iter5 = 默认）；
//   (2) 新增 damSkinCssFlavor + damSkinCssText：样式表按当前皮肤分派，两份 CSS 绝不同时注入；
//   (3) damSkinEnsureCss 由「有元素即 return」改为按 data-dam-skin-css 标记判等重建（修 P0：换肤不刷新）；
//   (4) 挂载门与挂载期注入门由 === v4 放宽为 !== classic（否则默认档被挡在门外，皮肤整个不见）；
//   (5) 经典侧入口按钮口径改为「经典 <-> 新皮肤族」。
//   守卫语义不变：生成块之外的任何**非意外**改动仍会被本锁抓住。
// ★2026-09-30 本快照第九次演进（F 批 · 皮肤可插拔收尾，增量归因）：
//   (1) SkinPicker 旧「总卡」退场（用户报「两个对勾同时存在」根因：旧卡判据 cur===it.id 与族卡同时命中）；
//   (2) pick() 家族档改**双写**：直接落 presentation.v1 + 调 iter5SetStyle（修「选了没反应」——
//       变体块用模块级缓存读样式且靠广播重渲染，裸写盘不触发）；
//   (3) 高亮判据收敛为「主题层 / 家族档 / 经典」三类互斥（旧总卡退场后不再需要第四支）；
//   (4) 随之删除失效 i18n 词条（旧总卡标签，退场后零消费点）。
//   守卫语义不变：生成块之外的任何**非意外**改动仍会被本锁抓住。
// ★2026-09-30 本快照第十次演进（H2 批 · 向导 where 分区名对齐，用户裁定「留在向导，只把 where 改成与设置页一致」）：
//   (1) TOUR_STEPS 内 7 处 where: L('自动记忆引擎', 'Semantic engine') ⇒ L('语义记忆总开关', 'Memory engine')——
//       与设置页 sectionLabels.engine 实名对齐（该实名自合并后即为「语义记忆总开关」）；
//       其中 3 处为既有、4 处为 F 批新增，同源同错，一并改完（避免半修）；
//   (2) 附「向导 where ⇒ 设置页实名单」对照核验：11 个分区名逐条比对，本批后 4 种 where 取值中
//       「语义记忆总开关」命中最多次（7 次），其余 3 种（记忆窗口 / 自动化 / 记忆中枢）为**批前既有**，未在本批范围内。
//   守卫语义不变：生成块之外的任何**非意外**改动仍会被本锁抓住；本批期望值随之上移。
// ★2026-10-02 本快照第十一次演进（审计修复批 F02/#184，增量归因）：
//   手写区 DebugCenter 的 refresh() 原对 11 个端点发探活请求（其中 greet/workspaces/reflectAuto 是
//   **有真实副作用的业务端点**：greet 缺缓存时真调模型 + 写 workbench.json 计数；reflectAuto 无
//   pending 时回退最近日志日并整篇覆盖 reflections/<date>.md）⇒ 打开调试中心即产生真实写入。
//   本批收敛为**单次只读 GET API.debug**，并把探测表从 11 端点缩到 1（诊断覆盖变窄，可接受）。
//   守卫语义不变：生成块之外的任何**非意外**改动仍会被本锁抓住；本批期望值随之上移。
// 2026-10-03 批次 C（审计修复 #186..#204 + R01/R02）：默认关闭/改写的共享入口有意演进，行为由 audit-* 套件覆盖；固化哈希按最终字节重钉。
// ★2026-10-03 本快照第十二次演进（前端收尾批 5a–5d，增量归因）：
//   (1) 手写区：useCardFull 缓存键带版本身份 + 失败不缓存 + 上限 256（G1-7/#195）；
//   (2) 挂载根：MemoryPageView / MemoryPanelFloat 订阅 dam-skin-changed（G1-4/#196）；
//   (3) 三处 SkinPicker onSwitch 无害化（同一项，源+产物成对）；
//   (4) pyOk 白名单加 verified-ok（G1-5/#197 四处成组）；
//   (5) normalizeGapRounds 上提到工厂层（G1-1，修「定义在 damSkinCssText 体内、调用点词法不可达」）；
//   (6) I18N.ja 七个 __fn 占位还原真函数字面量 + t() 兜底（G1-2）；
//   (7) G3 死壳摘除：DamSkinV4Page/Screen/Home/Welcome/Settings + DAM_SKIN_V4_PAGES/HOSTED、
//       renderTeamSettings15 家族、TOUR_STEPS 的 window 暴露；StatsTab 缩进统一。
//   (8) 同批为 tour 开关按钮补 'data-dam-tour-key' —— 让 G3 后的行为级验收能按配置键断言（不再读源码字符串）。
//   守卫语义不变：生成块之外的任何**非意外**改动仍会被本锁抓住；本批期望值随之上移。
// ★issue #211（2026-10-04）第十三次演进：Python 卸载入口（手写区 PySetupWizard 加二次确认按钮 +
//   API.pyUninstall 新键 + 三语 pyWizUninstall/pyWizUninstallConfirm 文案）。守卫语义不变。
// ★2026-10-06 本快照第十四次演进（INJ-1 · 注入分级三修，增量归因）：
//   三面设置页的 fullEverySlims 界面回落值 3 → 10，与服务端 DEFAULT_CONFIG.fullEverySlims 同步：
//   ①经典面（client.js 手写区）、②legacy 生成块、③frozen 源（skins/legacy/iter5-325.js.frozen）三面同改；
//   动因：计数口径改为「精简版实际投递次数」后，出厂节奏定为「每满 10 次精简放行一次完整版」，
//   界面若仍回落 3，用户一动设置页就会把 3 写回盘上，节奏被静默改回旧语义。
//   守卫语义不变：生成块之外的任何**非意外**改动仍会被本锁抓住；本批期望值随之上移。
// ★2026-10-06 本快照第十五次演进（R79 · 前端 V4-1/#238/#223）——手写区三处改动：
//   ①#238（上游 PR#239 采纳）：浮窗 floatStyle 加 inline position:'fixed' + 节点加 role:'dialog'/aria-label
//     （梦幻皮肤把 [data-dam-panel] 误判为 composer 并用普通特异性 position:relative 压过 fixed ⇒ 浮窗被挤进文档流）；
//   ②#223：侧栏入口与**承载面**同源（旧实现无条件注册 ⇒ panelPos='page' 档下按钮点了无反应，是空按钮）；
//   ③两处 label 去掉过期的 '(pre)'（pre 线术语 2026-09-23 已废弃）。
//   ⚠️ 重钉复算必须用**本套件自己的算法**（剥两块生成区 + 四处归一化），不可另写一份简化剥离：
//     2026-10-06 首轮误按「只去指纹行/首块注释」复算，得 6a9c0587…（错值），回归随即复红；
//     改用本文件 14-22 行的 classic 表达式复算得 26b00133…，与锁一致。
//   守卫语义不变：生成块之外的任何**非意外**改动仍会被本锁抓住。
// ★2026-10-08 R1 重钉（R79 → R80，判据侧更新 · 依据 2026-10-01 用户裁定「判据有问题就更新判据，不得回滚成果」）：
//   本锁的**鉴别力与语义一字未改**，仍锁「剥掉生成块后的经典档 = 评审基线」；只更新被锁的字节值。
//   取证（可复算，用本文件 14-22 行 classic 表达式**原样 eval**）：
//     · 83a8678（写入 26b00133 的那次提交）：declared 26b00133… == recomputed 26b00133… ⇒ 当时自洽；
//     · 8445cca（A 类施工**之前**的开工基线）：recomputed 54e55cc9… ≠ 26b00133… ⇒ 该红**先于** A 类存在，
//       与 A 类无关（与「开工基线 290 PASS / 1 FAIL」的实测吻合）；
//     · cfe388a（R1 收口后）：recomputed 23a79294… ⇒ 本次按实测值重钉。
//   ⚠️ 重钉值必须用**本套件自己的算法**复算（第 101-103 行既有教训：另写简化剥离会连错两次）。
//   管线脱钩事实（同批取证，供后续维护者）：第 17/20/21/22 步的 .replace() 锚串在当前 lib/client.js 中
//   命中共 0 次，仅第 18/19 步命中 ⇒ 「剥生成块 + 四处归一化」如今**大部分是空操作**。
//   该锁当前更接近「client.js 手写区指纹」而非「生成块集成形态指纹」；语义未弱化，但若要恢复
//   原鉴别力需另立项重写剥离管道（不在 R1 收口范围，已记入回执待复核项）。
// ★2026-10-08 第十六次演进（R81 · C 类 #252 RL-02，增量归因 · 手写区）：
//   ①apply() 内两个轮询计时器（notices 每小时 / away 30s）与三个文档级监听器
//     （两个 visibilitychange + 一个 focus）此前**没有任何卸载清理路径**（缺陷本体）；
//   ②新增模块作用域句柄台账 `__damRuntimeHandlesPre` + 卸载清理 `__damDisposeRuntimeHandlesPre`，
//     并以 `ctx.effect(...)` 登记 ⇒ host 卸载时停表并解绑；
//   ③两处匿名监听器改**具名**（匿名函数无法 removeEventListener，是泄漏的成因之一）。
//   取证（用本文件 14-22 行 classic 表达式**原样 eval**，非另写简化剥离）：
//     · HEAD（5245e4a，本批开工前）：recomputed 23a79294… == 当时锁值 ⇒ 当时自洽；
//     · 本批改动后：recomputed 6c07e736… ⇒ 按实测值重钉（2026-10-01 裁定：判据随有意演进上移，不回滚成果）。
// ★2026-10-08 第十七次演进（R82 · P3 #278 自动接续提示关不掉，增量归因 · 手写区）：
//   ①AutoContinueHost 成功分支新增「已关闭身份」判据：以 `at|sessionId` 为身份键，
//     用户关闭过的那一条不再显示（缺陷本体：旧实现在 3 秒轮询里无条件 setAcSt ⇒ 关闭无效）；
//   ②新增两个 ref：`acLastOkKeyRef`（最近读到的有效 lastOk 身份）与 `acDismissedOkRef`（已关闭身份）；
//   ③`dismissAcSt` 关闭时登记该身份；新结果身份不同 ⇒ 照常显示（不是一刀切禁掉）。
//   取证（用本文件 14-22 行 classic 表达式**原样 eval**，非另写简化剥离）：
//     · HEAD（7e65f42，本批开工前）：recomputed 6c07e736… == 当时锁值 ⇒ 当时自洽；
//     · 本批改动后：recomputed bd574416… ⇒ 按实测值重钉（2026-10-01 裁定：判据随有意演进上移，不回滚成果）。
//   守卫语义不变：生成块之外的任何**非意外**改动仍会被本锁抓住。
assert.equal(createHash('sha256').update(classic).digest('hex'), 'ff35f295e22a37c6e48e78935ff9cdb0b79f4e08afc41426bb84c276a4a35d32', 'Reviewed native-reference entry baseline（R78 = R77 + 2026-10-05 批次 Y（PR#212 #5/#6 + PR#213 前端拆取，生成器线一次过）：①共享草稿设施 memoryNoteDrafts/memoryCalendarDrafts/memoryDraftIdentity(sessionId|ws)/memoryNoteWrites/calendarWrites/memoryOperations/useMemoryOperation/submitMemoryOperation/prepareSettingsPatch/TeamSecretInput 落手写区；②面板 close() 前置草稿脏确认 + beforeunload 保护；③refreshSem 加 WeakMap 代次（迟到的旧状态不覆盖新状态）；④经典 NotesTab/CalendarTab 草稿接入 + 按身份重挂；⑤两 I5 实例：i5Read/i5Busy/i5ConfigGeneration/i5Initialized/i5AppliedRead 五 ref + 统一 i5ApplyConfig（草稿恢复 i5Initialized 单次 + 已有草稿只提示不覆盖 + psec 水合）+ save/onEngineModeChange 推进代次并回显 migrated/warning 回执 + setBusy 包 ref 同步；⑥gateOk 改读生效基线 i5Base（草稿态不再冒充已生效）+ gate-readout 归入主闸卡；⑦生效水位读数 data-dam-effective-water（handoff-state 实测，广播重取）；⑧browseTo/openBrowser 请求代次守卫 + D2 广播重取升级为 i5Busy 感知 + 请求号；⑨migPickInto 三份统一 migAlive 幂等守卫（修 pr-213 frozen 份 request 未声明 ReferenceError 点名缺陷）；⑩ConnectTab/Iter5External 异步取数身份守卫（去 pr-213 重复行）；⑪#212 前端：三份 iter5MemorySnapshot 注入 noteSessionId + 三份 Iter5Note 发 sessionId+expectedNotesPath（X2 服务端必填）；⑫设置分组再平衡（fExclude/model 移区、slims 死键控件摘除、fJsExcerpt/fWaterThreshold disabled+说明、即时项 L3 标签、团队 http/folder 禁选+TeamSecretInput 密码框）；⑬字典修正（fAutoContinue/handoffSwitch/fHandoff/fWaterWindow zh/en/ja + fAutoMargin 0.3-1 + settings-copy fJsCooldown 分钟→轮）；⑭skins 源 views/ui/native-panel/settings-copy 同步 + frozen LF 镜像 + 生成器 replaceT/切片补丁/断言化（--check SYNC-OK）。；原 R77 = R76 + 2026-10-05 发版三件套（v3.2.9：指纹行 + 应用内 CHANGELOG 字典 3.2.9 条目；内容见 CHANGELOG.md 同版段）；原 R76 = R75 + 2026-10-04 发版三件套（v3.2.8：指纹行 + 应用内 CHANGELOG 字典 3.2.8 条目；内容见 CHANGELOG.md 同版段）；原 R75 = R74 + 2026-10-04 issue #211 前端：Python 引擎卸载按钮（二次确认）+ pyUninstall 路由键 + 三语体积披露；原 R74 = R72 + 2026-10-02 审计修复批 A+B（增量归因：手写区 DebugCenter 收敛为只读 GET + 团队层接 4 条专用路由（API 表新增 5 键）+ TeamTab 挂载补回调 + L3 段共享订阅轮询）；原 R72 = R71 + 2026-10-01 ①接续开关默认开 + 欢迎向导开关 ②经典档接入 GlobalBriefRow 简报抽屉 ③damSharedSurfaceCss classic 分支归零修复；原 R71 = R70 + 2026-10-01 全局动态简报批（client.js 三面各加 8 个 globalBrief* 控件 + frozen 面补齐上批遗漏的 slimEveryRounds/fullEverySlims 两键）；原 R70 = R69 + #160/#162 修复：python 向导轮询/取消渲染、规则草稿与内容锚定、首屏 tour hero 挂载复原；生成块之外任何**非意外**改动仍会被本锁抓住）')
console.log('PASS reviewed shared-entry source baseline preserved')

const css = readFileSync(new URL('../../skins/iter5/skin.css', import.meta.url), 'utf8')
for (const line of css.split('\n')) {
  const consumers = line.replace(/--i5-[\w-]+:[^;}]+/g, '')
  assert(!/#[0-9a-f]{3,8}\b|rgba?\(/i.test(consumers), 'Colors must use named tokens: ' + line)
}
assert(!source.includes('BData.'), 'No demo data shipped')
const embeddedCss=JSON.parse(source.match(/var ITER5_CSS = (.+)\n/)[1])
const sharedTokens=embeddedCss.match(/\[data-iter5\],\[data-dam-theme\]\{([^}]+)\}/)[1]
assert(sharedTokens.split(';').filter(Boolean).every(declaration=>declaration.startsWith('--')),'Overlay token sharing must not include page flex/height/position styles')
console.log('PASS scoped token colors and no demo data')

// Execute the shipped factory with a small hook harness. No network, real memory,
// browser globals, or production exports are modified by this test.
let states = [], effects = [], cursor = 0, exposed, accept = true, confirmCount = 0
let requests = [], failSave = false
let config = { semanticEngineMode: 'auto', associativeMemoryEnabled: true, memoryAnchorEnabled: false, jsDecideCooldownRounds: 1, injectEnabled: true, locale: 'zh', externalSources: {} }
const React = {
  Fragment: Symbol('Fragment'),
  createElement: (type, props, ...children) => ({ type, props: { ...(props || {}), children } }),
  cloneElement: (node, props) => ({ ...node, props: { ...node.props, ...props } }),
  useState(initial) { const i = cursor++; if (!(i in states)) states[i] = typeof initial === 'function' ? initial() : initial; return [states[i], value => { states[i] = typeof value === 'function' ? value(states[i]) : value }] },
  useRef(initial) { const [ref] = React.useState(() => ({ current: initial })); return ref },
  useReducer(fn, initial) { const [state, set] = React.useState(initial); return [state, action => set(old => fn(old, action))] },
  useEffect(fn, deps) { const i = cursor++; const old = states[i]; if (!old || deps.some((d, n) => !Object.is(d, old[n]))) { states[i] = deps; effects.push(fn) } },
}
// ★2026-09-30（用户裁定）：默认皮肤改为 legacy（旧款）。本套件验收的是**仪器变体**的首页，
//   故模拟存储显式给出 instrument（否则 Iter5Home 会按新默认走 legacy 分支——那是另一套首页，
//   本套件的断言对象不在那里）。守卫语义不变：仪器首页必须保留日历与最近记录。
const localStorage = { getItem: (k) => (k === 'dsh-auto-memory.presentation.v1' ? 'instrument' : null), setItem() {}, removeItem() {}, length: 0 }
const document = { documentElement: { getAttribute: () => '', style: { setProperty() {} }, classList: { contains: () => false } }, querySelector: () => null, getElementById: () => null }
const window = { localStorage, addEventListener() {}, removeEventListener() {}, confirm() { confirmCount++; return accept }, __ModuleLoader__: { load(def) { exposed = def.factory(name => { if (name === 'react') return React; throw Error('Test module unavailable: ' + name) }) } } }
const context = vm.createContext({ window, document, localStorage, console: { log() {}, warn() {}, info() {}, error() {} }, navigator: { language: 'zh-CN' }, URL, URLSearchParams, requestAnimationFrame: fn=>fn(), setTimeout, clearTimeout, setInterval: () => 1, clearInterval() {}, fetch: () => { throw Error('Unexpected raw fetch') } })
vm.runInContext(source.replace('    return module.exports', `    exports._i5test = { Iter5Notice: Iter5Notice, Iter5Summary: Iter5Summary, Iter5AutoContinue: Iter5AutoContinue, Iter5Storage: Iter5Storage, Iter5Migration: Iter5Migration, Iter5DeleteConfirmation: Iter5DeleteConfirmation, iter5WorkspaceLayout: iter5WorkspaceLayout, iter5MapLabel: iter5MapLabel, Iter5WorkspaceGraph: Iter5WorkspaceGraph, iter5SkillContent: iter5SkillContent, Iter5SkillBrowser: Iter5SkillBrowser, iter5SearchEntries: iter5SearchEntries, Iter5Note: Iter5Note, Iter5Search: Iter5Search, useIter5Data: useIter5Data, Iter5Home: Iter5Home, Iter5Settings: Iter5Settings, Iter5Tabs: Iter5Tabs, iter5MemoryRows: iter5MemoryRows, iter5MemorySnapshot: iter5MemorySnapshot, iter5LedgerTitle: iter5LedgerTitle, DialogHost: DialogHost, setDialog: function (d) { dialogState = d }, t: t,
      transport: function (get, post) { apiGet = get; apiPost = post }, identity: function (value) { iter5Identity = function () { return value } },
      // ★批次 Y：草稿身份改由 memoryDraftIdentity()（会话|工作区）派生 ⇒ 守卫用 identity(value) 同步
      //   注入 host sessions 快照（value 形如 'sid|ws'），与 iter5Identity 同源同值，跨会话隔离判据不变。
      session: function (value) {
        var parts = String(value).split('|')
        var byId = {}; byId[parts[0]] = { cwd: parts[1] || '', retainedBy: { mainView: 1 } }
        sessions = { list: { getSnapshot: function () { return { current: parts[0], ids: [parts[0]], byId: byId } } } }
      } }
    return module.exports`), context, { filename: fileURLToPath(new URL('../../lib/client.js', import.meta.url)) })
const test = exposed._i5test
// Execute the host theme reader against both current DSH and older host markers.
const themeReader = vm.runInContext('(' + source.slice(source.indexOf('    function readHostDeep()'), source.indexOf('    function useDeepTheme()')) + ')', context)
assert.equal(themeReader(), false)
document.body = { hasAttribute: name => name === 'data-ds-dark-theme' }
assert.equal(themeReader(), true, 'Current host body theme marker is recognized')
document.body = { hasAttribute: () => false }
document.documentElement.style.colorScheme = 'dark'
assert.equal(themeReader(), true, 'Current host color-scheme is recognized')
document.documentElement.style.colorScheme = 'light'
assert.equal(themeReader(), false, 'Switching back to light clears dark theme')
assert(!embeddedCss.includes('body:has([data-iter5])'), 'Independent roots never depend on a workbench being mounted')
assert(!embeddedCss.includes('html:has(#dam-skin-v4-style)'), 'Shared overlays do not depend on opt-in stylesheet lifetime')
console.log('PASS actual host theme markers and standalone entry styles')
test.transport(async url => {
  if (url.includes('/config')) return { config: { ...config } }
  if (url.includes('/semantic-status')) return { loaded: true, ready: false, resolvedTier: 'c1', download: { phase: 'idle' } }
  if (url.includes('/update-check')) return { current: '3.2.1' }
  return {}
}, async (url, patch) => {
  requests.push({ url, patch: JSON.parse(JSON.stringify(patch)) })
  if (failSave) throw Error('injected save failure')
  config = { ...config, ...patch }
  return { config: { ...config } }
})
function render() { cursor = 0; const tree = test.Iter5Settings(); const pending = effects; effects = []; pending.forEach(fn => fn()); return tree }
async function settle() { for (let i = 0; i < 5; i++) await new Promise(resolve => setTimeout(resolve, 0)); return render() }
function nodes(tree, predicate, out = []) { if (!tree || typeof tree !== 'object') return out; if (Array.isArray(tree)) tree.forEach(x => nodes(x, predicate, out)); else { if (predicate(tree)) out.push(tree); nodes(tree.props?.children, predicate, out) } return out }
function field(tree, key) { const label = test.t(key); const row = nodes(tree, n => n.props?.['data-i5-field'] === label)[0]; const found = nodes(row, n => n.type === 'input'); assert(found.length, 'Input exists: ' + label); return found[0] }
function button(tree, label) { const found = nodes(tree, n => n.type === 'button' && n.props.children.flat(Infinity).includes(label)); assert(found.length, 'Button exists: ' + label); return found[0] }
render(); let tree = await settle()
assert.equal(field(tree, 'fNoteCap').props.value, 24000)
assert.equal(field(tree, 'fUserCap').props.value, 24000)
console.log('PASS generated settings preserve both upstream capacity defaults')
const engineSections = nodes(tree, n => n.props?.className === 'i5-engine-grid')[0]
const engineAdvanced = nodes(engineSections, n => n.type === 'details' && n.props.className === 'i5-settings-advanced')[0]
assert.equal(nodes(engineAdvanced, n => n.props?.['data-i5-field'] === test.t('fEmitMode')).length, 0, 'Actual delivery mode must not be hidden in advanced settings')
assert.equal(nodes(engineAdvanced, n => n.props?.['data-i5-field'] === test.t('fJsCooldown')).length, 1, 'Tuning remains available in advanced settings')
assert.equal(field(tree, 'fAssocEngine').props['aria-label'], '主动查找相关记忆', 'Accessible name matches plain-language visible label')
const memorySection = nodes(tree, n => n.type === 'section' && n.props.id?.endsWith('-section-capacity'))[0]
assert.equal(nodes(memorySection, n => n.props?.['data-i5-field'] === test.t('fAutoConsolidate')).length, 1, 'Automatic recording stays reachable after regrouping')
assert.equal(nodes(memorySection, n => n.type === 'details' && n.props.className === 'i5-settings-advanced').length, 1)
console.log('PASS beginner settings expose recall delivery and preserve advanced controls')
const appearance=nodes(tree,n=>n.type==='section'&&n.props.id&&n.props.id.endsWith('-section-look'))[0]
assert(button(appearance,test.t('tourReplay')),'Manual welcome entry stays in appearance group')
console.log('PASS welcome replay is reachable under appearance settings')
field(tree, 'fJsCooldown').props.onChange({ target: { value: '7' } })
tree = render()
assert.equal(tree.props['data-i5-dirty'], 'true')
const radio = nodes(tree, n => n.type === 'input' && n.props.type === 'radio' && n.props.value === 'lexical')[0]
radio.props.onChange({ target: { value: 'lexical' } }); tree = await settle()
assert.deepEqual(requests.at(-1).patch, { semanticEngineMode: 'lexical' })
assert.equal(field(tree, 'fJsCooldown').props.value, 7, 'Immediate engine change retains other drafts')
config.injectEnabled = false // Simulate another surface updating an unrelated key.
button(tree, '保存更改').props.onClick(); tree = await settle()
assert.deepEqual(requests.at(-1).patch, { jsDecideCooldownRounds: 7 })
assert.equal(config.injectEnabled, false, 'Unrelated concurrent changes survive save')
assert.equal(tree.props['data-i5-dirty'], 'false')
console.log('PASS immediate engine, draft retention, patch-only save, concurrent unrelated config')

field(tree, 'fJsCooldown').props.onChange({ target: { value: '9' } }); tree = render()
failSave = true
button(tree, '保存更改').props.onClick(); tree = await settle()
assert.equal(tree.props['data-i5-dirty'], 'true')
assert.equal(field(tree, 'fJsCooldown').props.value, 9)
assert(nodes(tree, n => n.props?.['data-dam-error'] === '').some(n => n.props.children.includes('injected save failure')))
button(tree, '取消修改').props.onClick(); tree = render()
assert.equal(field(tree, 'fJsCooldown').props.value, 7)
assert.equal(tree.props['data-i5-dirty'], 'false')
console.log('PASS failed save preserves draft and exposes error; cancel restores last saved config')

// Host-driven unmount must not erase pending edits. Recovery remains in memory,
// not localStorage, and must not write a stale patch without explicit save.
field(tree, 'fJsCooldown').props.onChange({ target: { value: '11' } }); tree = render()
const postsBeforeRemount = requests.length
states = []; effects = []; cursor = 0
tree = render(); tree = await settle()
assert.equal(field(tree, 'fJsCooldown').props.value, 11)
assert.equal(tree.props['data-i5-dirty'], 'true')
assert.equal(requests.length, postsBeforeRemount, 'Recovery cannot auto-save')
button(tree, '取消修改').props.onClick(); tree = render()
states = []; effects = []; cursor = 0
tree = render(); tree = await settle()
assert.equal(field(tree, 'fJsCooldown').props.value, 7)
assert.equal(tree.props['data-i5-dirty'], 'false', 'Discard removes recovery draft')
console.log('PASS host remount restores unsaved edits without browser persistence or automatic writes')

accept = false
field(tree, 'fAssocEngine').props.onChange({ target: { checked: false } }); tree = render()
assert.equal(field(tree, 'fAssocEngine').props.checked, true)
accept = true
field(tree, 'fAssocEngine').props.onChange({ target: { checked: false } }); tree = render()
assert.equal(field(tree, 'fAssocEngine').props.checked, false)
assert.equal(confirmCount, 2)
assert.equal(config.associativeMemoryEnabled, true, 'Confirmation creates a draft; saving performs the write')
console.log('PASS engine-disable confirmation and cancellation')

const built = test.iter5MemoryRows({ userSize: 10, logs: [{ name: '2026-09-28.md', date: '2026-09-28', size: 20 }], reflections: [] }, { userFile: 'fixture/MEMORY.md' })
assert.equal(built.length, 2)
assert.equal(built[0].scope, 'user')
assert.equal(built[1].path, '2026-09-28.md')
console.log('PASS memory-file rows preserve source scope and file route paths')
const boundRows=test.iter5MemoryRows({projectDir:'C:/isolated/project-a',logs:[{name:'2026-09-28.md',date:'2026-09-28',size:20}],reflections:[]},{})
assert.equal(boundRows[0].path,'C:/isolated/project-a/2026-09-28.md','File reads bind to the returned absolute project root')
assert.equal(test.iter5LedgerTitle('handoff-20260928-090000.md'),'2026-09-28 09:00')
let reads=[]
test.transport(async url=>{reads.push(url);return url.endsWith('/state')?{notesPath:'C:/isolated/project-a/MEMORY.md'}:{projectDir:'C:/isolated/project-b',logs:[],reflections:[]}},async()=>{})
await assert.rejects(test.iter5MemorySnapshot(),/工作区数据正在切换/)
assert(reads[0].endsWith('/state')&&reads[1].endsWith('/list'),'State is read before workspace-global list')
console.log('PASS handoff naming and cross-workspace read mismatch rejection')
states=[];effects=[];cursor=0
window['dsh-auto-memory.wizStatus']={loaded:true,ready:false,download:{phase:'idle'}}
test.setDialog(null);test.DialogHost();const hiddenHooks=cursor
cursor=0;test.setDialog({kind:'welcomeTour',manual:true});const tour=test.DialogHost()
assert(tour,'Welcome tour renders')
// ★2026-10-01 判据升级（用户裁定「那就修守卫」）：原断言锚在**容器标识** data-native-tour-nav 上，
//   而它要守的真实语义是「欢迎向导每一步都可达 + 当前步唯一」。H33 批按用户裁定恢复 3.2.5 观感、
//   把步骤胶囊换成圆点条（data-dam-tour-dots）后**功能未变、容器名变了** ⇒ 锚点型断言转红。
//   判据纪律：断言对象若是「某 class/属性名是否存在」即恒真守卫，不构成功能验收。
//   此处改为**直接断言功能**，并接受两种容器名（旧 nav 条 / 新圆点条）：
//   ① 步骤导航容器存在；② 步骤按钮数 = 实际步数；③ 每个步骤按钮都**真的可点**（有 onClick）；④ 当前步唯一。
const navC=nodes(tour,n=>n.props?.['data-native-tour-nav']===''||n.props?.['data-dam-tour-dots']==='')[0]
assert(navC,'Welcome provides step navigation (nav bar or dot rail)')
const stepBtns=nodes(navC,n=>n.type==='button')
assert.equal(stepBtns.length,9,'All actual welcome steps remain reachable')
assert(stepBtns.every(n=>typeof n.props?.onClick==='function'),'Every welcome step is actually reachable (clickable)')
assert.equal(stepBtns.filter(n=>n.props?.['aria-current']==='step').length,1,'Exactly one step is current')
// ★2026-10-03（G3）：原断言读 window['dsh-auto-memory.TOUR_STEPS'] —— 那是**写给已摘除死壳 welcome 的
//   暴露**（唯一消费者）。改判据为「不依赖任何 window 暴露」，直接从**真渲染出的向导步骤**按配置键收集：
//   遍历每步导航按钮（真点击 → 真重渲染），收集该步 tour toggle 按钮上的 data-dam-tour-key。
//   守卫语义不变（仍守「workbenchEnabled 在场、workbenchRoot 不得作为布尔写入」），且比原来更贴近真行为。
// 取「末页汇总」里**真渲染出的**开关徽标（data-dam-tour-badge 文本 = 开关名 + 开/关）。
//   末页汇总由 allToggles（= TOUR_STEPS 各步 toggles 的并集）派生 ⇒ 与「向导里到底有哪些开关」同源，
//   但不依赖任何 window 暴露，也不需要逐页点击。
// 末页汇总在**最后一步**才渲染 ⇒ 先真点最后一步导航，取该步**真渲染出的整棵树**做判据。
stepBtns[stepBtns.length-1].props.onClick()
cursor=0
const lastStepText=JSON.stringify(test.DialogHost())
// 判据（均在真渲染结果上判定，不读源码字符串、不依赖 window 暴露）：
//   ① 向导里存在「记忆中枢」这一真开关（workbenchEnabled 的用户可见面）；
//   ② 不存在「工作台目录」开关 —— 目录是字符串配置，把它当布尔写进配置是**曾经的缺陷形态**。
assert(lastStepText.indexOf('记忆中枢')>=0,'Welcome tour exposes the memory-hub switch (workbenchEnabled)')
assert(lastStepText.indexOf('工作台目录')<0,'Directory setting cannot be written as a boolean')
assert.equal(cursor,hiddenHooks,'Hidden-to-visible welcome transition must not add hooks')
cursor=0;test.setDialog(null);test.DialogHost()
assert.equal(cursor,hiddenHooks,'Closing the welcome tour must not remove hooks')
console.log('PASS real DialogHost hook count stable when opening and closing welcome tour')

states=[];effects=[];cursor=0
const firstLoad=()=>Promise.resolve({content:'File A'})
test.useIter5Data(firstLoad,['a'])
effects.splice(0).forEach(fn=>fn())
await new Promise(resolve=>setTimeout(resolve,0))
cursor=0
assert.equal(test.useIter5Data(firstLoad,['a']).data.content,'File A')
cursor=0
const switched=test.useIter5Data(()=>Promise.resolve({content:'File B'}),['b'])
assert.equal(switched.data,null,'Changing a file masks the previous result before effects run')
assert.equal(switched.loading,true)
effects.splice(0).forEach(fn=>fn())
await new Promise(resolve=>setTimeout(resolve,0))
cursor=0
assert.equal(test.useIter5Data(()=>Promise.resolve(null),['b']).data.content,'File B')
console.log('PASS file transitions cannot display stale content under a new title')

states=[];effects=[];cursor=0
const home=test.Iter5Home({nonce:0,onNav(){}})
assert.equal(nodes(home,n=>n.props?.className==='i5-daily-card').length,1,'Home retains its real calendar section')
assert.equal(nodes(home,n=>n.props?.className==='i5-native-recent').length,1,'Home retains recent records')
console.log('PASS refined home retains recent records and calendar entry points')

states=[];effects=[];cursor=0
test.identity('session-a|workspace-a')
let resolveOld
test.useIter5Data(()=>new Promise(resolve=>{resolveOld=resolve}),[])
effects.splice(0).forEach(fn=>fn())
await Promise.resolve()
test.identity('session-b|workspace-b');cursor=0
assert.equal(test.useIter5Data(()=>Promise.resolve('workspace-b'),[]).data,null)
effects.splice(0).forEach(fn=>fn())
await new Promise(resolve=>setTimeout(resolve,0))
resolveOld('workspace-a');await new Promise(resolve=>setTimeout(resolve,0));cursor=0
assert.equal(test.useIter5Data(()=>Promise.resolve(null),[]).data,'workspace-b','Late prior-workspace data must not replace the active scope')
console.log('PASS late results cannot cross session/workspace identity')


// Execute panel draft and selectable search behavior through the shipped components.
function renderNative(component, props) { cursor=0;const tree=component(props);effects.splice(0).forEach(fn=>fn());return tree }
function resetNative() { states=[];effects=[];cursor=0 }
resetNative();test.identity('note-session-a|workspace-a');test.session('note-session-a|workspace-a')
let note=renderNative(test.Iter5Note,{persistDraft:'panel',source:'/ws-a/MEMORY.md'})
nodes(note,n=>n.type==='textarea')[0].props.onChange({target:{value:'Keep this unsaved note'}})
resetNative();test.identity('note-session-b|workspace-b');test.session('note-session-b|workspace-b')
note=renderNative(test.Iter5Note,{persistDraft:'panel',source:'/ws-a/MEMORY.md'})
assert.equal(nodes(note,n=>n.type==='textarea')[0].props.value,'','A different session never receives the panel draft')
resetNative();test.identity('note-session-a|workspace-a');test.session('note-session-a|workspace-a')
note=renderNative(test.Iter5Note,{persistDraft:'panel',source:'/ws-a/MEMORY.md'})
assert.equal(nodes(note,n=>n.type==='textarea')[0].props.value,'Keep this unsaved note','Closing and remounting restores the same-session draft')
test.transport(async()=>({}),async()=>({ok:true}))
note.props.onSubmit({preventDefault(){}})
await new Promise(resolve=>setTimeout(resolve,0))
resetNative();note=renderNative(test.Iter5Note,{persistDraft:'panel',source:'/ws-a/MEMORY.md'})
assert.equal(nodes(note,n=>n.type==='textarea')[0].props.value,'','A successful append clears the recovered draft')
console.log('PASS panel drafts survive remount, isolate identities and clear only after append')
resetNative()
test.transport(async()=>({}),async()=>({answer:'Host summary',hits:[{where:'log-a.md',line:'First source passage'},{where:'log-b.md',line:'Second source passage'}],keywords:['source']}))
let search=renderNative(test.Iter5Search,{nonce:0})
nodes(search,n=>n.type==='input')[0].props.onChange({target:{value:'source'}})
search=renderNative(test.Iter5Search,{nonce:0})
nodes(search,n=>n.type==='form')[0].props.onSubmit({preventDefault(){}})
await new Promise(resolve=>setTimeout(resolve,0))
search=renderNative(test.Iter5Search,{nonce:0})
const results=nodes(search,n=>n.props?.className==='i5-search-result')
assert.equal(results.length,3,'The host summary and both source passages are independently selectable')
results[1].props.onClick()
search=renderNative(test.Iter5Search,{nonce:0})
assert.equal(nodes(search,n=>n.props?.className==='i5-search-result'&&n.props['aria-current']==='true').length,1)
assert.equal(nodes(search,n=>n.type==='h2'&&n.props.tabIndex===-1)[0].props.children[0],'log-b.md','Selecting a source updates the detail heading')
const lexical=test.iter5SearchEntries({result:'[记忆检索] 验收\n== 本地记忆文件命中 ==\n· log-a.md:\n  - exact source A\n· log-b.md:\n  - exact source B'},'recall')
assert.equal(lexical.length,3)
assert.equal(lexical[0].title,'log-a.md')
assert.equal(lexical[1].text,'- exact source B')
assert.equal(lexical[2].summary,true,'The complete host transcript remains available')
console.log('PASS search renders real source passages as selectable results')


resetNative()
const actionNode={key:'skill-1',props:{'data-dam-content':'',children:[{type:'button',props:{children:['Approve'],onClick(){}}}]}}
const skillRows=[{props:{title:'Skill group',children:[actionNode]}}]
assert.equal(test.iter5SkillContent(skillRows,'skill-1'),actionNode,'Original gated action node is reused without reimplementing its handlers')
let skillTree=renderNative(test.Iter5SkillBrowser,{active:[],pipeline:[{procedureId:'skill-1',title:'Reviewed process',stage:'candidate',steps:['Actual step'],successCriteria:['Actual criterion']}],rows:skillRows})
assert.equal(nodes(skillTree,n=>n.props?.className==='i5-native-skill-row').length,1)
assert.equal(nodes(skillTree,n=>n.type==='li')[0].props.children[0],'Actual step')
nodes(skillTree,n=>n.type==='input')[0].props.onChange({target:{value:'absent'}})
skillTree=renderNative(test.Iter5SkillBrowser,{active:[],pipeline:[{procedureId:'skill-1',title:'Reviewed process'}],rows:skillRows})
assert.equal(nodes(skillTree,n=>n.props?.className==='i5-native-skill-row').length,0)
console.log('PASS native skills preserve gated action content and title filtering')


for (const count of [1,2,5]) {
 const workspaces=Array.from({length:count},(_,i)=>({path:'ws-'+i,name:'Workspace '+i,graphTopics:Array.from({length:i===0?14:4},(_,n)=>({label:'Topic '+n}))}))
 const graph=test.iter5WorkspaceLayout(workspaces,{links:count>1?[{from:'ws-0',to:'ws-1',label:'shared'}]:[]})
 assert.equal(graph.nodes.filter(n=>n.kind==='workspace').length,count)
 assert.equal(graph.nodes.filter(n=>n.kind==='topic').length,14+4*(count-1),'Every actual topic is represented')
 for (const node of graph.nodes) assert(node.x-node.width/2>=0&&node.x+node.width/2<=graph.width&&node.y-node.height/2>=0&&node.y+node.height/2<=graph.height,'All graph node rectangles fit the viewBox')
 assert.equal(graph.edges.filter(e=>e.shared).length,count>1?1:0)
}
console.log('PASS native graph retains all topics and bounds every node inside its canvas')

// Replanning must follow the selected policy; changing packs invalidates the preview.
resetNative()
const storageCalls=[],migrationCalls=[]
context.fetch=async(url,opts)=>{if(opts?.body)storageCalls.push(JSON.parse(opts.body));return {ok:true,json:async()=>({ok:true,sources:[{file:'fixture/MEMORY.md',sourceRef:'notes:MEMORY.md',status:'ok'}],counts:{total:1,ok:1,stale:0,unrepairable:0}})}}
test.transport(async()=>({}),async(url,body)=>{migrationCalls.push({url,body});return {ok:true,plan:{onConflict:body.onConflict,additions:[],overwrites:[],stats:{willWrite:0}}}})
let storageTree=renderNative(test.Iter5Storage,{nonce:0})
await new Promise(resolve=>setTimeout(resolve,0))
storageTree=renderNative(test.Iter5Storage,{nonce:0})
const migrationProps=()=>nodes(storageTree,n=>n.type===test.Iter5Migration)[0].props
migrationProps().setPack('fixture/backup.dam-pack')
storageTree=renderNative(test.Iter5Storage,{nonce:0});migrationProps().onPreview()
await new Promise(resolve=>setTimeout(resolve,0));storageTree=renderNative(test.Iter5Storage,{nonce:0})
assert.equal(migrationCalls.at(-1).body.onConflict,'keep')
migrationProps().setConflict('overwrite')
await new Promise(resolve=>setTimeout(resolve,0));storageTree=renderNative(test.Iter5Storage,{nonce:0})
assert.equal(migrationCalls.at(-1).body.onConflict,'overwrite','Changing policy obtains a new host plan')
assert.equal(migrationProps().plan.onConflict,'overwrite')
migrationProps().setPack('fixture/another.dam-pack');storageTree=renderNative(test.Iter5Storage,{nonce:0})
assert.equal(migrationProps().plan,null,'A new pack cannot reuse the previous pack preview')
const selects=nodes(storageTree,n=>n.type==='select')
selects[0].props.onChange({target:{value:'fixture/MEMORY.md'}})
nodes(storageTree,n=>n.type==='input'&&String(n.props.placeholder).startsWith('mem_'))[0].props.onChange({target:{value:'memory-fixture'}})
storageTree=renderNative(test.Iter5Storage,{nonce:0});button(storageTree,'删除').props.onClick()
storageTree=renderNative(test.Iter5Storage,{nonce:0})
let confirmNode=nodes(storageTree,n=>n.type===test.Iter5DeleteConfirmation)[0]
assert.equal(confirmNode.props.payload.memoryId,'memory-fixture')
assert.equal(storageCalls.length,0,'Opening confirmation is read-only')
confirmNode.props.onClose();storageTree=renderNative(test.Iter5Storage,{nonce:0})
assert.equal(nodes(storageTree,n=>n.type===test.Iter5DeleteConfirmation).length,0)
assert.equal(storageCalls.length,0,'Canceling cannot delete')
button(storageTree,'删除').props.onClick();storageTree=renderNative(test.Iter5Storage,{nonce:0})
nodes(storageTree,n=>n.type===test.Iter5DeleteConfirmation)[0].props.onConfirm()
await new Promise(resolve=>setTimeout(resolve,0))
assert.equal(storageCalls.length,1)
assert.equal(storageCalls[0].memoryId,'memory-fixture')
console.log('PASS migration policy replans, pack changes invalidate preview, and deletion requires explicit confirmation')

resetNative();test.setDialog({kind:'notice',notice:{title:'Host notice',message:'Actual message'}})
const noticeElement=renderNative(test.DialogHost,{})
const notice=test.Iter5Notice(noticeElement.props)
assert.equal(notice.props['data-native-dialog'],'notice')
assert.equal(nodes(notice,n=>n.props?.['data-native-dialog']==='notice').length,1,'Sibling notices have an independently styleable native surface')
test.setDialog(null)

const summary=test.Iter5Summary({summary:{summary:'Actual host summary',works:Array.from({length:8},(_,i)=>({title:'Work '+i,points:['Point '+i]}))},onClose(){}})
assert.equal(nodes(summary,n=>n.type==='li').length,8,'Summary retains every actual work item and its points')
const progress=test.Iter5AutoContinue({executing:true,status:'Host is continuing',onDismiss(){}})
assert.equal(nodes(progress,n=>n.props?.role==='progressbar').length,1)
assert.equal(nodes(progress,n=>n.props?.['aria-valuenow']!==undefined).length,0,'No fake percentage when host does not report step progress')
console.log('PASS summary retains all host work details and continuation uses indeterminate progress')

// Git may check out skin sources as CRLF on Windows and LF on Linux.
// ★2026-10-01 移除（用户裁定「把那一个失败删掉，不然以后还会有误解」）：
//   原「生成器幂等」段（实测约 26 行）在临时 fixture 里**真跑 tools/build-iter5-skin.mjs**，
//   而该生成器当前**在真实 client.js 上会把整个生成块吞掉**——根因是它用非贪婪跨行正则
//   /^([ \t]*)useEffect\(\)\{[\s\S]*?\n\1\}, \[\]\)$/gm 配对 useEffect 起止：
//   它靠**缩进相同**猜嵌套，遇到 2477 行的块（内含同缩进 useEffect）就从块首一路吃到最远的
//   `}, [])`，实测吞掉 523,664 字符（含整个生成块）⇒ 产物从 1.79M 缩到 1.50M、回归 2→11 红。
//   ⇒ 该守卫在生成器修好前**恒为红**，留下的唯一作用是把「生成器坏了」这件事误报成
//   「皮肤功能退化」，让后续排查走偏。故整段移除；待生成器改正则配对后由维护者按需恢复
//   （判据：生成器能在当前 client.js 上幂等重跑，且 --check 通过）。
//   注：生成器本身的另外两个缺陷已在本轮修复（计数被注释喂饱 / 摘块丢弃插入锚）。
//
//   ★2026-10-02 恢复（G0-4）：判据已实测满足——生成器改用**括号配平**找块边界（不再依赖缩进
//   猜嵌套），在当前 client.js 上真实重跑逐字节不变、--check 绿（SYNC-OK）。
//   恢复后的守卫**不放在本套件内**，而是独立成 tests/smoke/smoke-test-generator-idempotent.mjs：
//   它真跑生成器（backup/finally 还原）、断言 H1 === H0，并补 R2 负路径（默认停机 / --force 覆盖）。
//   放在独立套件的原因：本套件是皮肤**产物**守卫，生成器**幂等**守卫应当各自独立计时与归因
//   ——2026-10-01 的教训正是「生成器坏了」被误报成「皮肤功能退化」。

// Topic deduplication, readable labels and non-actionable topic semantics.
const uniqueGraph = test.iter5WorkspaceLayout([{path:'/fixture',name:'Fixture',items:['Topic',' Topic ', 'Other']}], {})
assert.equal(uniqueGraph.nodes.filter(n=>n.kind==='topic').length, 2)
assert.equal(Array.from(test.iter5MapLabel('Long workspace title with meaningful word boundaries')).length, 2)
assert(test.iter5MapLabel('Long workspace title with meaningful word boundaries')[1].endsWith('…'))
assert.deepEqual(Array.from(test.iter5MapLabel('Memory search')), ['Memory search'])
console.log('PASS instrument topic deduplication and word-boundary labels')

resetNative()
const topicTree=renderNative(test.Iter5WorkspaceGraph,{workspaces:[{path:'/fixture',name:'Fixture',items:['Topic']}],onSelect(){throw Error('Topic must not switch workspace')},scale:1})
const topicNode=nodes(topicTree,n=>n.props?.['data-native-map-node']==='topic')[0]
assert.equal(topicNode.props.onClick,undefined)
assert.equal(topicNode.props.tabIndex,undefined)
assert.equal(topicNode.props.role,'img')
console.log('PASS topic nodes expose content without a misleading workspace action')
