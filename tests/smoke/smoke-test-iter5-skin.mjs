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
// ★2026-10-08 第十八次演进（R83 · Minervaowl7 批 A-2 · #288 + #289，增量归因 · 手写区）：
//   ①#288：AutoContinueHost 轮询分支优先级重排 —— 旧实现先处理 lastOk 并 return，早于读 s.armed，
//     导致「宿主已 armed + 10 分钟窗内仍有历史 lastOk」时确认卡被吞；现将 armed 判定提到 lastOk 之前
//     （armed 生效时确认卡优先、历史成功文案让位），并把卡片写入收口成 applyArmCard()。
//   ②#289：poll 加请求代次 pollSeq + 会话身份收口 acFresh()（迟到/乱序/跨会话响应整份丢弃）；
//     跳转前重读 currentSessionIdClient 与请求期 sidQ 比对（未切会话时该跳转照常发生，行为守恒）；
//     load 轮询同样加 loadSeq + 身份复核。
//   取证（用本文件 14-22 行 classic 表达式**原样 eval**，非另写简化剥离）：
//     · HEAD（167208f，本批开工前）：recomputed bd574416… == 当时锁值 ⇒ 当时自洽；
//     · 本批改动后：recomputed f3546096… ⇒ 按实测值重钉（2026-10-01 裁定：判据随有意演进上移，不回滚成果）。
//   守卫语义不变：生成块之外的任何**非意外**改动仍会被本锁抓住。
// ★2026-10-08 L-A7 重钉（R83 → R84）：lib/client.js **有意演进** —— 批 D #287 成功提示重挂载重播 + #290 降级标注：
//   #287：关闭身份原只存 useRef ⇒ 组件重挂载（切页签/面板重开/宿主重连）即丢，同一条成功提示立刻重播
//     （用户报障「关不掉」）；且过期分支只清错误文本（/^✗/），历史成功文本一直留驻。
//     改法：localStorage 持久化「已关闭的那一条」身份键（口径同 #278 = at|sessionId），10 分钟有效期 +
//     容量上限 64（超出淘汰最旧）；读取一律 fail-soft（非法 JSON/超长/形态不符/未来时间戳 ⇒ 按「未关闭」）；
//     过期分支改按 /^[✗✓]/ 清显示。★铁律守恒：关闭类状态**只跳过显示**，sessions.open 搭线副作用原地不动。
//   #290：成功提示在 modelDegraded 时如实标注降级（中英双语），并区分「未确认」态。
//   取证（用本文件 14-22 行 classic 表达式**原样 eval**，非另写简化剥离）：
//     · HEAD（2d0330d）：recomputed f3546096… == 当时锁值 ⇒ 当时自洽（已复算确认）；
//     · 本道改动后：recomputed 1c6763a7… ⇒ 按实测值重钉（2026-10-01 裁定：判据随有意演进上移，不回滚成果）。
//   守卫语义不变：生成块之外的任何**非意外**改动仍会被本锁抓住。
// ★2026-10-08 重钉（R84 → R85）：**补钉一次漏钉**。lib/client.js 在 934bca0（v3.2.12）**有意演进**
//   （指纹行 3.2.11→3.2.12 + 应用内 CHANGELOG 增 3.2.12 条目 + 会话页铺满：
//   `body[data-dam-fullpage]` 两条 CSS 与 Iter5Surface(kind='page') 的 IntersectionObserver 标记 useEffect），
//   但**当时没有同步重钉本锁** ⇒ 基线红被带进 3.2.12 发布。经复核：
//     · 该红属**判据过期**（代码有意演进、常量没跟着上移），**非功能回归**（2026-10-01 裁定：改判据、不回滚成果）；
//     · 归因取证：把 v3.2.11 与 HEAD 的 lib/client.js 分别按**本文件 37-40 行的原样剥离表达式**处理后逐行 diff，
//       差异**全部**落在上述三处有意改动上，未见任何非预期字节。
//   （重钉值 c224996b653bef8423d5af86c34cfd29be2e8a893c2e74c0b41bb150be100f19 由本套件自身表达式复算得出。）
// ★2026-10-08 重钉（R85 → R86）：**v3.2.13 发版三件套之一**（有意演进，同提交内重钉，正是上一条补钉的教训）。
//   lib/client.js 本轮改动两处，均在生成块之外：①第 10 行界面指纹行 v3.2.12→v3.2.13；
//   ②`var CHANGELOG` 顶部新增 `'3.2.13'` 条目（zh 10 条 / en 10 条）。
//   本锁守的是「剥掉生成区后的经典档」，故发版文案改动会正常触发它 ⇒ 按实测值重钉。
//   判据守恒：生成块之外任何**非意外**改动仍会被抓住（同上条）。
//   （重钉值 92f272b923342eb78caaec3349d3749ae26874767d85d33de0392436049a724a 由本套件自身表达式复算得出 ——
//    即运行本套件时它自己打印的 `actual`；**注意不要手工另写简化剥离**，本文件的剥离管道有 9 条 replace，
//    少抄一条就会得到完全不同的哈希。）
// ⚠️ 另注：v3.2.12 的 CHANGELOG 写有「回归 321 套件全绿」，与实测（320/1，唯一红就是本锁）**不符**；
//   本锁重钉后该表述才真正成立。后续发版务必在改 client.js 的同一提交内重钉本锁。
// ★2026-10-10 重钉（R86 → R87，用户批准 · 判据过期非缺陷）：
//   #330 多宿主工作台会话争抢修复改了 lib/client.js **5 处，全部在生成区之外**（已正面核验：
//   生成区 L10377-L12774，改动落在 L16782-L16865）——新增 host-conflict 中英文案、WB_RANK 定级、
//   相位判据（host-conflict 走 offer 而非 exists）、按钮文案「本机接管」。
//   ▶ 生成区安全性的**强证明**：`node tools/build-iter5-skin.mjs --check --strict` 报 SYNC-OK
//     （= 生成器算出的产物与磁盘 lib/client.js **逐字节一致**）⇒ 重跑生成器会原样保留这些改动。
//   判据守恒：本锁守的是「剥掉生成区的经典档」基线，生成区之外任何**非意外**改动仍会被抓住。
//   （重钉值由本套件自身剥离表达式复算 —— 即运行本套件时它自己打印的 `actual`：
//     **注意不要手工另写简化剥离**，本文件剥离管道有 9 条 replace，少抄一条就会得到完全不同的哈希。）
// ★2026-10-13 CI 修复：本锁必须**行尾无关**。
//   仓库 blob 存 LF（CI 检出即 LF），开发机检出是 CRLF ⇒ 直接哈希文件内容会得到两个值，
//   于是「同一份源码」在 Windows 绿、在 Linux 红。锁要守的是**内容**，不是行尾。
//   归一 EOL 后两侧一致；同时保留严格比对（内容真变仍会红）。
// 2026-10-27 **R4 看板事件范围筛选（用户裁定 Q7）**：新增 filterEventsByScopePre / readEventScopePre / writeEventScopePre + EVENT_SCOPE_KEY + EventView 的 evScope 状态与「活跃/全部」两按钮 —— **全部落经典档手写区（生成块之外）** ⇒ 按实测 actual 重钉 4141f989… → b79eb655…。判据意图不变（经典侧字节守恒）。
// ★归因取证：`build-iter5-skin --check --strict` = SYNC-OK ⇒ 生成区未被触碰。
// ★R155 重钉由本套件自身表达式算出 actual，非手工推算。
// 
// 2026-10-14 R109: scoped issue fixes intentionally update shared API/session guards,
// Python setup/runtime state, recall source actions and batch import receipts.
// The byte lock stays enabled; issue regressions and the fixed-base review cover behavior.
// ★★R160 重钉（2026-10-31 · 3.4.0-alpha.1 发版）：版本号 3.3.17→3.4.0-alpha.1 改变 client.js 字节 ⇒ 必须再钉一次。
//   本轮仅改：①L10 指纹行 ②CHANGELOG 字典新增 3.4.0-alpha.1 条目。生成区未动（build-iter5-skin --check 为既有 H3-1 红灯，与本次无关）。
// ★★R159 重钉（2026-10-31 · D 系列四件）：client.js 增 v4 说明 —— 欢迎页新增「v4 一件事一个事件」步骤、设置页新增 boardMode（白板形态=事件投影）说明分区。两处均在**手写区**，build-iter5-skin --check --strict = SYNC-OK 证明生成区与源一致。判据意图不变（经典区不得无痕漂移）。
// ★★R158 重钉（2026-10-31 · 团队共享线 B3：团队模式「基线发布/订阅」双按钮弹窗）：classicLF → a28f1bc314cc5a63… / 1,401,297 字符（自 R157 的 1,397,297 起 Δ+3,944）。
//   归因（可复算）：① `build-iter5-skin --check --strict` = **SYNC-OK** ⇒ 生成区未被手改，本批全部改动在经典档手写区
//   （UpgradePopup 增 isTeamMode 分支 + onSearchRemote/onSelfUpgrade 两个处理器）；② 值取自套件自身打印的 actual（未手写简化剥离管道）。
//   判据意图不变（经典区不得无痕漂移）；依据 2026-10-01 用户裁定「判据有问题就更新判据，不得把做完的直接回滚」。
// ★★R157 重钉（2026-10-31 · 团队共享线 B6「事件归属三形态头像」+ 前端 API 表补 2 键）：classicLF → 8b5942f0255533f4… / 1,397,297 字符（自 R156 的 1,390,144 起 Δ+7,153）。
//   归因（可复算，三段取证）：
//     ① `build-iter5-skin --check --strict` = **SYNC-OK** ⇒ 生成区与生成源逐字节一致、**生成区未被手改**；
//        本批全部改动落在**经典档手写区**（TeamBadge / teamAvatarShapePre / 头像 CSS / TeamMemberList 接线）。
//     ② 数量对得上：`git diff --stat lib/client.js` 实测 **+142 / −19 行**；diff 内逐字统计新增 ≈10,148 字符、
//        删除 ≈1,780 字符 ⇒ 净增 ≈8,368；扣除 CRLF 归一与两处 span 改写后与 Δ+6,947 同量级。
//     ③ 反向复核：`git show HEAD:lib/client.js` 跑本文件**同款 9 条 replace 管道** ⇒ classicLF = 1,389,130 /
//        2f4f7d49…，即 HEAD 本身就低于旧锁值 1,390,144（差 1,014）⇒ **旧锁在我本批开工前就已不等**（不是本轮引入）。
//   判据意图不变：本锁守「剥掉生成区的经典档不得无痕漂移」，本轮改动是**有意演进**且已逐项列明。
//   依据 2026-10-01 用户裁定：「判据有问题就更新判据，不得把做完的直接回滚」。
// ★★R156 重钉（2026-10-31 · 用户裁定「记忆窗格里的白板看板映射隐藏」）：classicLF → 3be2d91e2d834dbb… / 1390144 字符。
//   归因（可复算）：① PlanTab 摘除事件视图挂载 + 存量转换提示条（该页签只留 PLAN.md 快照）；
//   ② 顶栏「白板看板」整页入口外包一层 data-dam-event-surface 空 div（无 style，不影响原有布局）。
//   取证：build-iter5-skin --check --strict = SYNC-OK ⇒ 生成区未被手改；本值由套件自身表达式算出。
// ★★R155 重钉（2026-10-29 · 研究报告 D5）：classicLF → e611b873956dc1eb… / 1389917 字符（Δ+250）。
//   归因（可复算）：D5 把静态纪律两节拆成可配置层，客户端 lib/client.js 的 27 层镜像**同提交补齐**
//   两个新键（staticPerceptDiscipline / staticCalendarDiscipline，均为空串）⇒ 经典区手写段新增 2 行 (+250 字符)。
//   这是 G4-6d「客户端与服务端逐键逐字一致」的**强制要求**，不是意外污染（--check = SYNC-OK）。
// ★★R154 重钉（2026-10-29）：classicLF sha256 → 8a927dd86f5674c0… / 1,389,667 字符。
//   归因（可复算，已实测）：① 上一会话的 lib/client.js 未提交改动（设置页刷新超时 120→240、
//   EV4 检查点四段 fallback 等 5 个 hunk，共 +537 字符）把经典区基线推到此值；
//   ② 本会话只把 skins/legacy/iter5-325.js.frozen 的对应行同步为 240 并重跑 build-iter5-skin，
//   使生成源与产物重新一致（--check = SYNC-OK）。
//   证据：HEAD 版跑同管道 = 1,389,130 / 2f4f7d49… ⇒ **旧锁值 0316e09b… 在本批开工前
//   就已不等**（不是本轮引入）；把本轮 240 回滚成 120 后哈希**不变**（仍 8a927dd8…）
//   ⇒ 本轮对该锁零影响。判据意图不变（经典区不得无痕漂移），按 2026-10-01 裁定复算重钉。
const classicLF = classic.replace(/\r\n/g, '\n')

// ★2026-10-18 R113 重钉（R112 → R113，判据侧更新 · 依据 2026-10-01 用户裁定「判据有问题就更新判据，不得回滚成果」）：
//   本次改动（用户报「所有上下文注入都没用了」的归因修复批次）在**手写区**，逐项：
//     · 设置面文案纠正 3 组（中/英双语，共 6 处）：
//       ① fInboxGateHint「默认关」→「默认开（2026-09-30 裁定）+ 与自动记忆引擎是 AND」
//          —— 后端 activationInboxEnabled 默认早已是 true，文案未同步 ⇒ 用户无法判断开关真实含义；
//       ② fAssocEngineHint 补「与唤回总闸 AND」说明；
//       ③ fFullEverySlimsHint「默认 3」→「默认 10（2026-10-06 由 3 抬升）」
//          —— 后端 DEFAULT_FULL_EVERY_SLIM 早已是 10、DEFAULT_FULL_EVERY_SLIMS_PREV=3，文案停留在旧值。
//     · 门控读数区（data-dam-gate-readout）三面各 +1 行「索引就绪」：
//       实测「唤回显示已投递但模型收不到」时 semantic-status 报 indexReady=false 且
//       engineSwitch.error='sync-in-progress'，而旧读数只显示档位与 emitMode ⇒ 看不出
//       「引擎在跑但索引没建好」。老读数把「资产就绪」误当「可用」。
//     · 经典面（冻结源 skins/legacy/iter5-325.js.frozen）与 v4 面同步同一行；
//       iter5 面由生成器从 client.js 的 SettingsPage 切片带出 ⇒ 不在本锁口径内。
//   取证：node tools/build-iter5-skin.mjs --check → SYNC-OK（产物 == 源，生成区零手工修复）；
//        node --check lib/client.js → OK；本值即运行本套件时它自己打印的 actual。
// ★2026-10-18 R112 重钉（R111 → R112，判据侧更新 · 依据 2026-10-01 用户裁定「判据有问题就更新判据，不得回滚成果」）：
//   本锁的**鉴别力与语义一字未改**，仍锁「剥掉生成区后的经典档 = 评审基线」；只更新被锁的字节值。
//   本次增量全部落在**生成区之外的手写区**（两处前端缺陷修复，均非发版文案）：
//     · #425（A26 同批）：经典 StorageTab 迁移预览改为消费 plan.blockedByAncestor ——
//       migPreview 计算 migBlockedN 并在有阻塞时把「预览 ✓」换成「预览：N 条路径不可写…」；
//       计划面板在 warnings 行之前新增一行 [data-dam-blocked-by-ancestor] 渲染 path(ancestor:kind) 清单。
//     · task-12（#443 同族残留）：DialogHost 的 semSetup「立即下载」按钮由空 catch 改为
//       then/catch 双分支 —— 失败时 openDialog notice 回执（dlFailTextPre 人话翻译），成功才静默。
//   取证：node tools/build-iter5-skin.mjs --check → SYNC-OK（产物 == 源，生成区无手工修复）；
//         v4 面与 frozen 面的同步修复见 smoke-test-frozen-mirror / settings-parity / a26 套件。
//   ⚠️ 重钉值必须用**本套件自己的算法**复算（第 130–146 行既有教训：另写简化剥离会连错两次）；
//      本值即运行本套件时它自己打印的 actual（classic chars = 1,045,841）。
// ★2026-10-17 R111 重钉（R110 → R111，判据侧更新 · 依据 2026-10-01 用户裁定「判据有问题就更新判据，不得回滚成果」）：
//   本锁的**鉴别力与语义一字未改**，仍锁「剥掉生成区后的经典档 = 评审基线」；只更新被锁的字节值。
//   ★归因分两步（先既有漂移、再本次增量，两者必须分开说明 —— 本锁在本批开工前**已经是红的**）：
//   ① 【既有漂移，非本批引入】开工基线 a4a3d029…，本批之前就已红。
//      取证（用本文件 37–51 行 classic 表达式**原样**复算，非另写简化剥离）：
//        git show HEAD:lib/client.js → 同管道复算 = a4a3d029… == 当时盘上实际值 ⇒ 该红**先于**本批存在，
//        属 R109/PR420 之后经典区改动未重钉（与 A01-A24-BASELINE 记录的既有漂移一致）。
//   ② 【本次增量】a4a3d029… → a647b08a…（中间值 5e577dd7… 是「向导面尚未修好」的半成状态，
//      在补上 mount-time auto-start effect 的回执后再次上移），增量全部落在**生成区之外的手写区**：
//      · A23/#443：新增 dlReasonTextPre + dlFailTextPre 两个模块级纯函数；经典档 SettingsPage 的
//        startDl/cancelDl 由空 catch 改为写 err 槽；欢迎向导 startDl 改由 wizSt.dlError 承载并接进 dlPhaseTxt。
//      · A21/#441：StatsTab.reset 改为显式检查 res.ok / body.ok（fetch 对 4xx/5xx 不 reject，这是本条关键）。
//      · A06/#426：MemoryHubTab 的「直接激活」判据补 !(requiresApproval && !approved)（与后端同源门一致）。
//      · 向导面（#443 第 4 个渲染面）真正生效的下载入口是 DialogHost 的 mount-time
//        「无语义引擎自动引导」effect（实测：同作用域内那个 startDl 变量**零调用点**，是死代码）。
//        该 effect 原为空 catch，现把回执写进 wizSt.dlError 并由 dlPhaseTxt 链首显示 ⇒ 手写区再 +1 处。
//      · v4 变体三面（Iter5Settings/Iter5Stats/Iter5Skills）由生成器从上述手写切片带出 ⇒ 不在本锁口径内。
//      取证：node tools/build-iter5-skin.mjs --check → SYNC-OK（产物 == 源，生成区无手工修复）。
//   ⚠️ 重钉值必须用**本套件自己的算法**复算（第 130–146 行既有教训：另写简化剥离会连错两次）；
//      本值即运行本套件时它自己打印的 actual。
// ★2026-10-18 R124 重钉（c278d6ac… → 7a1caba2…）：v3.3.5 版本标识两处改动，均在手写区——
//   ① lib/client.js 顶部指纹行 v3.3.4 → v3.3.5；
//   ② 应用内更新说明字典顶部新增 '3.3.5' 条目（zh/en 各 5 条）。
//   判据意图不变（经典区不得无痕漂移）。★归因：把这两处版本标识还原后用同一 8 条 replace 管道复算
//   = c278d6ac…（与上一轮锁逐字节相等）⇒ 本次漂移 100% 来自版本标识，无其他内容混入。
// ★2026-10-18 R118 重钉（554fb70f… → c278d6ac…）：本批在**经典档手写区**改了设置面文案——
//   · fEmitModeHint（zh/en/ja 三语）补「JS 5 秒生效 / Python 需重启 dsh web 才生效」；
//   · fShadowRetrievalHint / fContextBridgeHint（zh/en 双语）纠正为与 DEFAULT_CONFIG 真值一致
//     （原写「默认关」，而 DEFAULT_CONFIG 实为 true），并说明关掉后整条通道停摆而非「只不投递」；
//   · 新手导向导 shadowRetrievalEnabled 的 sub 同步纠正。
//   全部在生成块之外 ⇒ 本锁随动。判据意图不变（经典区不得无痕漂移）。
//   ★归因：HEAD 版本用本套件自身 8 条 replace 管道复算 = 554fb70f…（与旧锁逐字节相等），
//     证明本次漂移 100% 来自本批文案修改，无历史漂移混入。
//   判据意图不变；重钉值 = 本套件自身打印的 actual（9caf68af…，含 v3.3.13 版本标识两处）。
//   重钉值 = 本套件自身打印的 actual（24d7f96f…，含 v3.3.14 版本标识两处）。
// ★2026-10-21 重钉（… → 24d7f96f… → 7d3fc06e…）：v3.3.15 前端 waitForRefresh 区间对齐后端
//   （15–600→15–900、默认 90000→120000 毫秒）+ 版本标识两处。判据意图不变，值 = 套件自打印 actual。
// ★2026-10-21 重钉（9caf68af… → e87766a7… → 24d7f96f…）：v3.3.14 接续刷新仪式超时可配 —— 设置页三面各新增 2 个控件
//   （刷新仪式超时 / 单次探测超时）+ i18n zh/en 各 +4 键。均在生成区之外（手写区与 .frozen 源）⇒ 本锁随动；
//   判据意图不变（经典区不得无痕漂移）；重钉值 = 本套件自身打印的 actual。
// ★2026-10-21 重钉（127db190… → 8b0952bf… → 9caf68af…）：v3.3.13 补 issue #451 遗留「半修」——经典档水位卡新增（指纹行
//   v3.3.11→v3.3.12、应用内更新说明字典新增 '3.3.12' 条目），均在经典档**手写区**（生成区之外）⇒ 本锁随动，
//   行为代码零改动。判据意图不变（经典区不得无痕漂移）；重钉值 = **本套件自身打印的 actual**（127db190…）。
//   ★中间值 eabd1d54… 是版本号一度写成 3.4.0 时的实测值，用户裁定「小更新末位 +1」后作废。
//   ★注意：本套件的剥离管道是「先把整文件 CRLF→LF，再做 8 条 replace」；
//     若手工复算时把归一放到最后，会得到 ffbf1319…（错误值，已作废）。此类锁一律以 actual 为准。
// ★2026-10-21 重钉（08aa7ef7… → d4ed8a23…）：线上团队同步 12GB 事故的**设置面新增两个键**。
//   改动全在经典档**手写区**（生成区之外），逐项：
//     · zh 标签表 `teamPullPageLimit` / `teamPushPath` 两行；
//     · en 标签表同两行；
//     · `TEAM_SETTING_KEYS` 增 2 键（与字段表 F 同步扩，守恒断言 fk === kk 仍成立）；
//     · 字段表 F 增 ['teamPullPageLimit','number'] / ['teamPushPath','text']。
//   判据意图不变（经典区不得无痕漂移）；重钉值 = 本套件自身打印的 actual（未手写简化剥离管道）。
//   ★归因取证：把 lib/client.js 的这 8 行删除后复算 = 08aa7ef7…（与旧锁逐字节相等）⇒ 漂移 100% 来自本批。
//   ★副产物：本批同时把「三面同步」扩到 111 键（settings-parity 实测 classic 109 → 111）。
// ★2026-10-22 重钉（08aa7ef7… → be100acb…）：v3.3.16 版本标识两处（指纹行 v3.3.15→v3.3.16、
//   应用内更新说明字典新增 3.3.16 条目），均在前端**手写区**（生成区之外）⇒ 本锁随动，行为代码零改动。
//   ★归因取证（实测，非推断）：把 lib/client.js 还原成 HEAD（v3.3.15）后跑本套件 = PASS（旧锁绿）；
//   换回本批改动 = 红。⇒ 漂移 100% 来自版本标识两处，属**判据过期**，非缺陷。判据意图不变。
//   重钉值 = 本套件自身打印的 actual（未手写剥离管道）。
// ★2026-10-20 重钉（6031ed74… → 08aa7ef7…）：v3.3.11 版本标识两处（指纹行 v3.3.10→v3.3.11、应用内更新说明字典新增 3.3.11 条目），均在经典档**手写区**（生成区之外）⇒ 本锁随动，行为代码零改动。
//   判据意图不变（经典区不得无痕漂移）；重钉值 = 本套件自身打印的 actual。
// PR420: reviewed six-line classic SearchTab change retains result + structured hits for source actions.
// ★2026-10-19 重钉（f6d9ebda… → 5bb3923d…）：v3.3.10 版本标识两处（指纹行 v3.3.9→v3.3.10、应用内更新说明
//   字典新增 '3.3.10' 条目）均在经典档手写区（生成区之外）⇒ 本锁随动，行为代码零改动。
//   ★归因：旧锁 f6d9ebda… 对应 v3.3.9 状态；提交 8ea0c1b 改了 client.js 但**漏了重钉本锁**（判据过期，非缺陷）。
//   判据意图不变（经典区不得无痕漂移）；重钉值 = 本套件自身打印的 actual（未手写简化剥离管道）。
// ★2026-10-25 重钉（3666486b… → a74e70fa…）：用户裁定方案 A —— workflow 视图的 lane 提取
//   从「status 冒充线」改为**原型规则**（title/name + summary 提 Pn/Rn/Gn/E线/F线，集合成员关系）。
//   改动落点为新增模块级纯函数 LANE_RE_PRE / tokensOfLanePre / lanesOfEventPre + EventView 内薄封装，
//   全部在**经典区手写面**（生成区之外）⇒ 本锁随动，其余行为代码零改动。
//   判据意图不变（经典区不得无痕漂移）；重钉值 = 本套件自身打印的 actual。
// ★2026-10-25 21:05 重钉（82c54aa1… → d7fcfb6b…）：★★**用户实报「白板页转圈→插件崩→闪退」的根因修复**。
//   根因：S1 把 EventView 改成 iframe 时用了 `useMemo(...)`，但 client.js **从来没有定义过 useMemo**
//   （无 `var useMemo = React.useMemo` 别名、无本地 function 定义）⇒ 真渲染白板页抛
//   `ReferenceError: useMemo is not defined` ⇒ React 整棵树崩 ⇒ 插件闪退。
//   修法：在 hook 别名区补 `var useMemo = React.useMemo`（+1324 B，全部注释 + 1 行代码）。
//   改动落点：经典档手写区（生成区之外）⇒ 按套件自身打印的 actual 重钉。判据意图不变（经典侧字节守恒）。
//   ★同批新增守卫 `smoke-test-v4-ev4-free-vars.mjs`（15 条）：对组件函数体做自由标识符分析，
//     这类「用了没定义的标识符」以后会被当场抓住，不再依赖四条全绕开的旧判据。
// ★R145 = R144 + 2026-10-25 P3（task-32 · C 线）：白板页默认全屏（挂载即 mark(true) + IO 只撤销
//   + missStreak≥2 + **可见性闸门 elLooksVisible** 防「对话页被误打标导致打不了字」）
//   + computeFullpageHeightPre 纯函数（Lead 裁决签名）+ fit() 改调纯函数
//   —— 全部落经典档手写区（生成块之外）⇒ 剥掉生成块后经典侧字节变化
//   ⇒ 按**实测 actual** 重钉 d7fcfb6b… → 3dce7ff6…。
//   ★归因（可复算）：`build-iter5-skin --check --strict` = SYNC-OK 证明生成区未被触碰；
//   改动逐处用内容锚定补丁落在 skins/iter5/surfaces.js（源）+ 重建，均在生成区外。
//   判据意图不变（经典侧字节守恒）。
// ★R146 = R145 + 2026-10-25 P5（task-32 收口）：snapshotSlimMaintain 客户端镜像按服务端定稿同步
//   （430 → 515 字符，+147 B，逐字一致）—— 该常量在经典档手写区（生成块之外）
//   ⇒ 经典侧字节再变 ⇒ 按**实测 actual** 重钉 3dce7ff6… → 1ee21889…。
//   ★归因可复算：build-iter5-skin --check --strict = SYNC-OK（生成区零改动）；
//   抽取比对：服务端 515 / 客户端 515 逐字一致（三常量全 ✅）。判据意图不变（经典侧字节守恒）。
// ★R147 = R146 + 2026-10-25 P5 收尾：两个镜像常量上方各加 3 行「防第 N 次漂移」事前防呆注释
//   （Lead 要求：G4-6b/6d 是事后断言，注释让下一个改动者动手前就知道要成对改）。
//   注释在经典档手写区（生成块之外）⇒ 经典侧字节再变（+540 B）⇒ 按**实测 actual** 重钉
//   1ee21889… → 5b6f669e…。归因可复算：build-iter5-skin --check --strict = SYNC-OK。
//   判据意图不变（经典侧字节守恒）。
// ★R148 = R147 + 2026-10-25 task-35（C 线 · 用户实报「全屏还是不生效 / 工作区还是取错」）：
//   ① 缺陷 A：可见性闸门**不再引用 el 自身高度**（防与 fit() 死循环）——改 surfaces.js 源后重建；
//   ② 缺陷 B：新增 sessionIdForWorkspaceClient / pageSessionIdClient 三级会话解析 + EventView 用 evSid
//      + surface 透传 props.sessionId —— 全部落经典档手写区（生成块之外）。
//   ⇒ 经典侧字节再变 ⇒ 按**实测 actual** 重钉 5b6f669e… → ccc2fc9d…。
//   ★归因可复算：build-iter5-skin --check --strict = SYNC-OK（生成区零改动）。
// ★R149 = R148 + 2026-10-26 审计施工批次（§1.3 M3 + §1.4）：
//   ① §1.3 M3：本套件新增「真读 skin.css + 真层叠判定」组（N7，7 条）——只改测试、产品 CSS 零改动；
//   ② §1.4：lib/client.js 的 apiGet 把 event-list / upgrade-status 纳入 sessionId 注入名单
//      （修「不带 sid 静默拿别的工作区数据」，实测 event-list 无 sid 时返回 29 检查点/别的工作区）。
//   ② 落在**经典档手写区**（生成区之外）⇒ 经典侧 sha 随动。
//   ★归因可复算：build-iter5-skin --check --strict = SYNC-OK（生成区零改动）；
//   抽取比对：把 apiGet 那行还原成旧条件（只有 external/file）后本锁复绿（已实测）。
//   判据意图不变（经典区不得无痕漂移）。重钉值 = 本套件自身打印的 actual。
// ★★R145 = R144 + 2026-10-26 「白板时间 1970 + 右栏点不开」两项前端修复（用户实报）：
//   改动全部落在**经典档手写区 / 原型块源**（生成区外）⇒ 经典侧 sha 随动：
//     ① lib/ev4-prototype-blocks.js：窄屏 sheet 阈值 1023px → 560px（用户裁定「只有贴近手机比例才用手机逻辑」）
//        + applyDrawer 增 DETAIL_MIN_W=240，空间不足时诚实收起（原来 0 宽空壳却显示「收起右栏」）；
//     ② lib/ev4-adapter.js：adaptEventPre 时间改多级兜底 pickMsPre，不再把「拿不到时间」伪造为 0（1970）；
//     ③ lib/event-store.js：list() 投影**不改**（保持 7 key 硬契约），改由消费侧用 updatedAt 兜底；
//     ④ lib/client.js：自研层 3 处 1023px 断点同步改 560px。
//   ★归因可复算：build-iter5-skin --check --strict = SYNC-OK（生成区零改动）；
//   把这批改动 stash 后本锁复绿（旧锁 d60c23… 为绿，已实测）。判据意图不变（经典区不得无痕漂移）。
//   重钉值 = 本套件自身打印的 actual。
// ★★R146 = R145 + 2026-10-26 审计 §2.1 修复（HTML 注释锚点清洗）：
//   lib/ev4-adapter.js 新增清洗层 stripHtmlCommentsPre / stripMetaPrefixPre / cleanSectionTextPre / titlePre，
//   并接到 adaptEventPre 的 title / summary / rationale / sections 四段上。
//   改动全部落在**经典档手写区**（adapter 源 + client.js 生成区内联）⇒ 经典侧 sha 随动。
//   ★归因可复算：build-iter5-skin --check --strict = SYNC-OK（生成区已同步）；
//   用户实报证据：事件卡「理由」开头是 type=dead-end 注释，整卡被撑到近 2000 字符。
//   判据意图不变（经典区不得无痕漂移）。重钉值 = 本套件自身打印的 actual。
// ★★R147 = R146 + 2026-10-26 真机白屏事故修复（清洗层未内联）：
//   ① lib/ev4-adapter.js 补 export 4 个清洗函数（stripHtmlCommentsPre/stripMetaPrefixPre/
//      cleanSectionTextPre/titlePre）—— 之前没 export ⇒ gen 工具取不到 ⇒ 内联不进 client.js
//      ⇒ adaptEventPre 在真机调用未定义函数 ⇒ ReferenceError: titlePre is not defined
//      ⇒ EventView 整棵树崩 ⇒ 白板空白（用户实报「白板写崩了」）。
//   ② tools/gen-ev4-blocks.mjs 新增 ADAPTER_CLEAN_FNS 白名单 + 内联循环。
//   ③ quoteLine 也接 cleanSectionTextPre（检查点正文里也有锚点）。
//   改动全部落在经典档手写区（client.js 生成区内联）⇒ 经典侧 sha 随动。
//   ★归因可复算：build-iter5-skin --check --strict = SYNC-OK；本锁值 = 本套件自身打印的 actual。
//   判据意图不变（经典区不得无痕漂移）。
// ★R150 = R149 + 2026-10-26 **v5-P1 注入截流方案 P1 批 · T1 设置页文案**（改测试不改产品）。
//   改动内容：fSnapGapHint 三语（zh/en/ja）把「默认 10」修正为「默认 20」，并各补一句上调归因。
//   ★为什么是判据过期而非缺陷：常量 DEFAULT_SNAPSHOT_MIN_GAP_ROUNDS 早已是 20（lib/index.js L513 唯一真源），
//     本机配置 snapshotMinGapRounds=20 亦生效 —— 只有设置页文案滞留在 10（用户实报「10 还是太短了」）。
//   ★归因（实测复算，可复现）：HEAD 版 client.js 跑本文件同款 9 条 replace 管道 ⇒ classicLF = 1,370,801 字符 /
//     sha256 eb1d798e…（与旧锁值逐字节一致 ⇒ 证明管道与本方法正确）；本批改后 = **1,370,952 字符 / bb19b7ce…**
//     （Δ **+151 字符**，恰为三语新增文案的长度）。判据意图不变（经典区不得无痕漂移）。
//   ★同步重钉：smoke-test-r26-cross-layer 的 R150_CHARS 1263158 → 1269644（index.js 侧，见该文件 L801）。
// ★R151 = R150 + 2026-10-26 **v5-P2 F1 水位阈值口径**（用户裁定：250k 累计 → 25%/50% 水位阈值）。
//   改动内容：① 删 fullInjectTokenGap，加 fullInjectWaterPct（百分比阈值列表，默认 25,50）
//   ② 新增 parseWaterPctThresholdsPre / decideWaterPctFirePre 两个纯函数
//   ③ 注入侧接入水位判定（跨阈值 + 真人请求 ⇒ 授予完整版，标记 _waterPctFired）
//   ④ 设置页三面加控件 + 三语文案（frozen 源 + settings-copy 源 + SettingsPage 真源）。
//   归因（实测复算）：HEAD 版 client.js 跑本文件同款 9 条 replace 管道 ⇒ classicLF = 1,370,801 字符 /
//     sha256 eb1d798e…（与 R150 之前的旧锁值逐字节一致 ⇒ 证明管道正确）；
//     本批改后 = **1,371,755 字符 / 92dec88c…**（Δ **+954 字符**，全部来自设置页控件与三语文案）。
//   判据意图不变（经典区不得无痕漂移）。
//   同步重钉：smoke-test-r26-cross-layer 的 R151_CHARS 1269644 → 1277242（index.js 侧，Δ+7598）。
assert.equal(createHash('sha256').update(classicLF).digest('hex'), '65a5dd78dfe3723bb30c019a2c5a30d1438e20d75d2fb3ae3fb1bb867c657fdc', 'Reviewed native-reference entry (LF-normalized) baseline（★R153 = R152 + 2026-10-29 **检查点四段空白修复 · 前端回退**：`ev4-adapter.js` 的 `adaptCheckpointPre` 在「四段全空」时回落到后端补的 `fallbackText`（label=「正文」，不冒充 GOAL/STATE/DEAD/NEXT）⇒ 经 gen-ev4-blocks 落入生成区 ⇒ 经典档字节变化。★归因（可复算）：`git diff lib/client.js` 显示改动仅 12 行 = ① 生成区头部 sha16 行（98A7C1B2…→27315682…）② fallback 逻辑 11 行；`build-iter5-skin --check --strict` = SYNC-OK 证明生成区与源一致、手写区未被触碰 ⇒ **有意演进，非意外污染**。旧锁 2f4f7d49… 在本批开工前为绿（R152 刚重钉），本次按实测 actual 重钉。判据意图不变（经典区不得无痕漂移）。；R152 = R147 + 2026-10-27 **前端映射批**：① 手写区 ev4ProtoCheckpointPre 的 ms 兜底两级加 `<= 0` 守卫（P9 真根因：占位检查点 at="" ⇒ Number("")=0 骗过 isFinite）；② gen 重生成（adaptEventPre 排序 / rationale 不再回落 deadend / normConfPre 不伪造 medium / 消费 checkpointQuad）。★归因（可复算，已验证）：照抄本文件同款管道 ⇒ 当前 classicLF = 1,388,310 字符，与套件 actual 逐字节一致；把本次两类改动（生成区 + 手写区）都换回 HEAD 后 = 1,381,163 ⇒ 本批净增 7,147 字符。★注意：旧锁 f38e75a6… 在**本批开工前就已红**（工作区在 HEAD 之上另有未提交改动），故本次一并按实测 actual 重钉，并在下面 E3c 以「实际长度」独立复核。判据意图不变（经典区不得无痕漂移）。★R147 = R146 + 2026-10-27 **P9 真根因二连修**：① `adaptCheckpointPre` 的 `ms = NaN` → `undefined`（NaN 经 JSON 序列化变 null，`null < Infinity` 为 true ⇒ 污染 min ⇒ 兜底失效）；② `adaptEventPre` 的 `startMs/endMs = NaN` → `undefined`（同陷阱，且导致 `Number(null)=0` 使兜底的 `s0>0` 判据为假 ⇒ 整段跳过）。新增守卫 smoke-test-v4-json-roundtrip（11 条，含负路径）。重钉 e3dddf09… → 本值。★R146 = R145 + 2026-10-27 泳道/甘特时间轴兜底。★R145 = R144 + 2026-10-27 白板事件视图·检查点数修复 + 占位检查点不伪造时间：`ev4-adapter.js` 的 `adaptEventPre` 原先只认 `ev.checkpoints`，而 `event-store.list()` 按 7 键硬契约**只返回 `checkpointCount`** ⇒ `cps.length` 恒 0 ⇒ UI 每个事件都显示「0 个检查点」（用户实测 10 个事件全 0，而磁盘实有 311）。修法：列表态按 `checkpointCount` 生成等长轻量占位检查点供计数/宽窄/甘特使用，正文仍由 /event-detail 补；并加 `_hasRealTimes` 守卫——占位检查点无时间，若直接用 `cps[0].ms` 会让时间回到 1970（此回归被 wb-time-and-drawer A-3/A-4 当场拦下，已修）。经 gen-ev4-blocks 重新生成 ⇒ 按实测 actual 重钉 8570474b… → c18c1247…。判据意图不变。★R144 = R143 + 2026-10-25 P1 右栏抽屉（C 线）：新增 DETAIL_OPEN_KEY/readDetailOpenPre/writeDetailOpenPre/applyDetailWidthPre/createSpringPre/driveDetailPre/prefersReducedMotionPre + renderDetailPanePre + `.dam-evt-split` 三栏 grid 与收起态末列 0px + 窄屏 sheet —— 全部落经典档手写区（生成块之外）⇒ 按实测 actual 重钉 50ed388f… → 51b9c000…。判据意图不变。★R143 = R142 + 2026-10-24 P1 三视图 + 空档 + 倒序（C 线）：新增 VIEW_MODES/VIEW_MODE_KEY/GAP_HOURS/normalizeViewModePre/readViewModePre/writeViewModePre/eventSpanOfPre/computeGapsPre/computeLaneStatsPre/computeWorkflowGroupsPre/scrollToBottomPre/isAtBottomPre + renderStream/Lanes/WorkflowViewPre + renderGapRowPre；EventView 改三档状态机 —— 全部落经典档手写区 ⇒ 按实测 actual 重钉 7dd2a9e8… → 50ed388f…。判据意图不变。★R142 = R141 + 2026-10-24 P0 检查点折叠 + 六类 panel（C 线）：新增 `renderCheckpointListPre`/`PANEL_KIND_UI`/`PANEL_KINDS_UI`/`toggleCheckpointPre`（默认全折叠 0fr↔1fr）+ `.dam-cp-body` CSS（复用 --dur-fast，未新造时长）+ EventCard 接入 —— 全部落经典档手写区（生成块之外）⇒ 按实测 actual 重钉 b3f028f8… → 7dd2a9e8…。判据意图不变。★R141 = R140 + 2026-10-24 D1 收口修正：确认弹窗边框原用 `--dam-state-warn`（全文件 0 定义 ⇒ 静默回退）改为既有 `--dsw-alias-state-warn-primary → --dam-dec-prefetch`（总监裁定 A：收敛不扩张）⇒ 手写区字节再变，按实测 actual 重钉 2058e285… → b3f028f8…。判据意图不变。★R140 = R139 + 2026-10-24 v4 H4/H10 前端（C 线）：EventCard 加四 percept + panelDigest 渲染、统计条第 5 卡「有值才显示」、PlanTab 存量转换三步 UI、DEFAULT 修 unarchivedTotal 取数 bug —— **全部落经典档手写区（生成块之外）** ⇒ 剥掉生成块后的经典侧字节变化 ⇒ 按实测 actual 重钉 2573c706… → 2058e285…。★归因（可复算）：本次改动逐处用内容锚定补丁落在 EventCard/EventView/PlanTab/DAM_STAT_META 四处，均在生成区外；`build-iter5-skin --check --strict` = SYNC-OK 证明生成区未被触碰。判据意图不变（经典侧字节守恒）。R139 = R138 + 2026-10-24 v4 批次 D 检索（P3 铭文把 scope="events" 写回，经典档手写区）⇒ 按实测 actual 重钉 512f90ad… → 91969ff1…。★归因（实测）：仅回退该句文案 ⇒ 旧锁绿，换回即红 ⇒ 漂移 100% 来自这句。判据意图不变（经典侧字节守恒）。（R138 = R137 + 2026-10-24 v4 批次 C-2 P2/P3（snapshotSlimMaintain +第7项 memory_event、「六项」→「七项」；snapshotSlimGuide +事件卡片入口、白板账本语义改四段式）——两段均在**经典档手写区**（生成块之外）⇒ 经典侧内容变化 ⇒ 本锁按实测 actual 重钉 8866638c… → 512f90ad…。★归因（实测）：P2/P3 回退后本套件全绿（旧锁绿），换回本批改动即红 ⇒ 漂移 100% 来自这两段文案，无历史内容混入。判据意图不变（经典侧字节守恒）。R119 = R118 + 2026-10-23 v3.3.17 版本身份三件套：指纹行 v3.3.16→v3.3.17 + 应用内 CHANGELOG 新增 3.3.17 条目（zh/en 各 5 条），两处均在生成块之外 ⇒ 剥掉生成块后的经典侧内容变化 ⇒ 本锁按**实测 actual** 重钉 be100acb… → 8866638c…。★归因已实测：git stash 还原 client.js 到 HEAD 后本套件 exit=0（旧锁为绿）⇒ 判据过期非缺陷。；R118 = R117 + 2026-10-19 v3.3.9 版本号与应用内 CHANGELOG 3.3.9 条目：经典档手写区删 1 个 field 控件 + 3 个语言文案键（zh/en/ja），生成源 skins/legacy/iter5-325.js.frozen 同步删除 ⇒ 剥掉生成块后的经典侧内容变化 ⇒ 本锁按实测 actual 重钉 aa3a3360… → 94d42899…。；R108 = R107 + 2026-10-13 #356 启动自检：经典档手写区新增两处——① 模型缺失时静默发起内置 JS 档下载（替代「弹卡等用户点」）；② 模型已就绪但引擎配置缺失时开机静默补建（写 shadow，不改既有行为）。均在生成区之外 ⇒ 本锁随动，按实测 actual 重钉 0f991681… → b8fefefa…。；R98 = R97 + 2026-10-13 注入节奏两项用户裁定（服务端 DEFAULT_CONFIG.snapshotMinGapRounds 5→10 + 强制覆盖迁移；精简版按 slimEveryRounds 真正节流）；连带 `fSnapGap` 设置项默认 5→10（冻结档源 + 三处镜像同形））← R97 = R96 + 2026-10-13 #333② 后续（尾部铭文零语义损失压缩：删冗词保全部判据，铭文 1409→1317；客户端镜像同步；archive 三处 result 注入增强）← R96 = R95 + 2026-10-13 #333②（客户端镜像 +1 层 `snapshotInscriptionArchive`：归档取回通道暴露）← R95 = R94 + 2026-10-12 #335b 修正（新增 `plugins.detail.section` 落点：插件管理页详情页，按包名认领、非本包返回 null；在手写区）；原 R94 = R93 + v3.3.0 版本身份三处（应用内更新说明字典新增「3.3.0」段 + 指纹行 → v3.3.0，均在手写区）；原 R93 = R92 + 2026-10-12 #335 第三批自检修复（设置入口开关的 /config 刷新改为**单飞 + 仅有效值变化才重注册 slot**：emit() 有 27 个调用点含拖动/缩放等高频路径，原实现每次广播都发请求并重建 slot）；原 R92 = R91 + 2026-10-12 #335 第三批（尾部铭文补「技能库分工作区库/通用库 · 写接口无 scope ⇒ 直写恒入通用库」并把上限 1200→1400）；原 R91 = R90 + 2026-10-12 #335 第二批（尾部铭文 snapshotInscription 补 action=update/activate 两条通路提示：服务端 index.js 与浏览器 client.js 镜像逐字一致、长度 1181≤1200；该段在手写区 ⇒ 经典档基线随动）；原 R90 = R89 + 2026-10-12 #335 吸收（用户裁定「都放」+ 可关）：① lib/index.js DEFAULT_CONFIG 新增 settingsEntryInDsSettings / settingsEntryInPluginsPage 两键（白名单=Object.keys(DEFAULT_CONFIG)）；② 生成区外经典档 SettingsPage 的「外观与目录」组加两个开关；③ settings.section 与新增的 settings.plugins.tab 两处注册改受 settingsEntryPre() 条件控制 + 双关纠正；④ 新增 helper/缓存刷新器并订阅唯一写出口广播；重钉值取本套件自身打印的 actual）← R88 = R87 + 2026-10-10 v3.2.15 发版三件套（client.js 指纹行 + 应用内 CHANGELOG 3.2.15 条目，均在生成块之外）← R87 = R86 + 2026-10-10 #330 多宿主工作台会话争抢（client.js 新增 host-conflict 文案/定级/相位/按钮，均在生成区外）← R86 = R85 + 2026-10-08 v3.2.13 发版三件套（client.js 指纹行 + 应用内 CHANGELOG 3.2.13 条目，均在生成块之外）；原 R85 = R84 + 2026-10-08 重钉补漏（l\u0069b/client.js 于 934bca0 有意演进未同步重钉：v3.2.12 指纹行 + 应用内 CHANGELOG 3.2.12 条目 + 会话页铺满 fullpage 标记）；原 R78 = R77 + 2026-10-05 批次 Y（PR#212 #5/#6 + PR#213 前端拆取，生成器线一次过）：①共享草稿设施 memoryNoteDrafts/memoryCalendarDrafts/memoryDraftIdentity(sessionId|ws)/memoryNoteWrites/calendarWrites/memoryOperations/useMemoryOperation/submitMemoryOperation/prepareSettingsPatch/TeamSecretInput 落手写区；②面板 close() 前置草稿脏确认 + beforeunload 保护；③refreshSem 加 WeakMap 代次（迟到的旧状态不覆盖新状态）；④经典 NotesTab/CalendarTab 草稿接入 + 按身份重挂；⑤两 I5 实例：i5Read/i5Busy/i5ConfigGeneration/i5Initialized/i5AppliedRead 五 ref + 统一 i5ApplyConfig（草稿恢复 i5Initialized 单次 + 已有草稿只提示不覆盖 + psec 水合）+ save/onEngineModeChange 推进代次并回显 migrated/warning 回执 + setBusy 包 ref 同步；⑥gateOk 改读生效基线 i5Base（草稿态不再冒充已生效）+ gate-readout 归入主闸卡；⑦生效水位读数 data-dam-effective-water（handoff-state 实测，广播重取）；⑧browseTo/openBrowser 请求代次守卫 + D2 广播重取升级为 i5Busy 感知 + 请求号；⑨migPickInto 三份统一 migAlive 幂等守卫（修 pr-213 frozen 份 request 未声明 ReferenceError 点名缺陷）；⑩ConnectTab/Iter5External 异步取数身份守卫（去 pr-213 重复行）；⑪#212 前端：三份 iter5MemorySnapshot 注入 noteSessionId + 三份 Iter5Note 发 sessionId+expectedNotesPath（X2 服务端必填）；⑫设置分组再平衡（fExclude/model 移区、slims 死键控件摘除、fJsExcerpt/fWaterThreshold disabled+说明、即时项 L3 标签、团队 http/folder 禁选+TeamSecretInput 密码框）；⑬字典修正（fAutoContinue/handoffSwitch/fHandoff/fWaterWindow zh/en/ja + fAutoMargin 0.3-1 + settings-copy fJsCooldown 分钟→轮）；⑭skins 源 views/ui/native-panel/settings-copy 同步 + frozen LF 镜像 + 生成器 replaceT/切片补丁/断言化（--check SYNC-OK）。；原 R77 = R76 + 2026-10-05 发版三件套（v3.2.9：指纹行 + 应用内 CHANGELOG 字典 3.2.9 条目；内容见 CHANGELOG.md 同版段）；原 R76 = R75 + 2026-10-04 发版三件套（v3.2.8：指纹行 + 应用内 CHANGELOG 字典 3.2.8 条目；内容见 CHANGELOG.md 同版段）；原 R75 = R74 + 2026-10-04 issue #211 前端：Python 引擎卸载按钮（二次确认）+ pyUninstall 路由键 + 三语体积披露；原 R74 = R72 + 2026-10-02 审计修复批 A+B（增量归因：手写区 DebugCenter 收敛为只读 GET + 团队层接 4 条专用路由（API 表新增 5 键）+ TeamTab 挂载补回调 + L3 段共享订阅轮询）；原 R72 = R71 + 2026-10-01 ①接续开关默认开 + 欢迎向导开关 ②经典档接入 GlobalBriefRow 简报抽屉 ③damSharedSurfaceCss classic 分支归零修复；原 R71 = R70 + 2026-10-01 全局动态简报批（client.js 三面各加 8 个 globalBrief* 控件 + frozen 面补齐上批遗漏的 slimEveryRounds/fullEverySlims 两键）；原 R70 = R69 + #160/#162 修复：python 向导轮询/取消渲染、规则草稿与内容锚定、首屏 tour hero 挂载复原；生成块之外任何**非意外**改动仍会被本锁抓住）')
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
assert.equal(stepBtns.length,10,'All actual welcome steps remain reachable (★D3 2026-10-31: +v4 事件单元步骤 9→10)')
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
