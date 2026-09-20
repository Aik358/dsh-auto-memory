# 上游 issue 第三批核验（2026-09-20）· pre 线适用性判定

> 来源：https://github.com/Aik358/dsh-auto-memory/issues
> 背景：用户问「能不能合并一起改」+「逐步改完逐步回归时间太长就明天再说」
> **纪律**：先实跑核验是否适用于当前 pre 线版本，**不照单全修**（仓库既有铁律）

---

## 一、分类结论

### A 类 · pre 线已重构掉，**不适用**（4 条，零动作）

| issue | 上游说法 | pre 线实测 |
|---|---|---|
| **#83** | `lib/ledger-criteria.js` 与 `wb-contract.js` 同名异体重复实现 | **`lib/ledger-criteria.js` 根本不存在** ⇒ 已重构掉 |
| **#86-1** | `rerank-host.js` 的 `sha256Hex` 实为 FNV-1a 同名异义 | **`lib/rerank-host.js` 不存在** ⇒ 已移除 |
| **#86-2** | `canonicalJson` 双份（`m7-wire.js` + `state-commit.js`） | **`lib/state-commit.js` 不存在** ⇒ 双份已消解 |
| **#100-⑦** | 倒计时小数秒 `Math.ceil(msDiff)/1000` | **`Math.ceil(msDiff)` 零命中** ⇒ 已重构 |

### B 类 · **确实适用**，但风险分级不同（5 条）

| issue | pre 线实测 | 风险 | 今晚做？ |
|---|---|---|---|
| **#82** | 写侧 `:10528` 仍裸 `readFileSync→writeFileSync` 非原子、无队列；加载侧 `:1861/:1878` 仍 `_mergeConfigPre(null)` 静默回落 | **中**（配置写路径，触及启动） | ⏸ 明天 |
| **#86-4** | 水位 `0.75` **7 处内联**（`:2989 :3318 :3504 :4111 :4117 :4136 :5489`），真源 `:366` | **低**（纯常量化） | ✅ 可做 |
| **#86-3** | `DSH_HOME` 解析 **20 处**（跨 6+ 文件） | **中**（跨文件重构） | ⏸ 明天 |
| **#84** | `volatileEvents ≤16`（`:48`）；`unhandledRejection` 守卫 `:8896` 无计数 | **中低**（新增诊断文件） | ⏸ 明天 |
| **#99-③** | **已有** `removeArm` 两步武装（`:3559-3561`） | 待核 | ⏸ 明天 |

### C 类 · 已在早前批次处理过（历史）

`#73`（17 个 smoke 红）— pre 线全量回归 **PASS 134 / FAIL 0**，该 issue 基于 `main@d816497(v3.0.0)`，结论**整体过时**。

---

## 二、今晚执行：**#86-4 水位常量化**（唯一低危项）

### 为什么单独做这一条

1. **零行为变更**：`|| 0.75` 与常量 `DEFAULT_WATER_LEVEL_THRESHOLD = 0.75` **取值完全相同**，只是把散落的魔法数字收敛到一处；
2. **价值成立**：该默认值历史上**全局调过一次**（0.8 → 0.75），下次再调极易漏站点——7 处任何一处漏改就是静默不一致；
3. **可验证**：改后全量回归必须仍然 **134/0**，且新增断言锁住「内联 0.75 归零」。

### 改动方式（最小改法）

- 在 `DEFAULT_CONFIG` 附近新增 `export const DEFAULT_WATER_LEVEL_THRESHOLD = 0.75`；
- 7 处 `|| 0.75` 全部替换为 `|| DEFAULT_WATER_LEVEL_THRESHOLD`；
- `DEFAULT_CONFIG.waterLevelThreshold` 引用该常量（消除「真源也没引用常量」的漏洞）；
- **不动** `Math.max(..., 0.1)` 的下限逻辑（那是另一件事）。

### 验收（已实跑完成）

| 项 | 结果 |
|---|---|
| `node --check` | ✅ |
| 新增套件 `smoke-test-t7a-defaults-pre.mjs` | ✅ **5 / 5** |
| 变异验证 `artifacts/_mutate-t7a.mjs` | ✅ **4 / 4 真红**（含「耦合」靶点） |
| 字节一致还原 | ✅ SHA256 `E3271975…2B45` |
| **全量回归** | ✅ **PASS 135 / FAIL 0 / TIMEOUT 0（136.5s）**（134→135，新增 T7-a 套件） |

### ★ 执行中的两个重要发现（都已处置）

**① 差点把两个独立开关耦合成一个（初版错误，当场修正）**

首版脚本用一条正则 `\|\| 0\.75(?=[,)])` 全量替换，把 `autoContinueThreshold` 的两处兜底
**也**换成了 `DEFAULT_WATER_LEVEL_THRESHOLD`。但 `autoContinueThreshold` 是**独立配置项**
（注释只说它俩历史上被同时下调过一次）——共用常量会让「只调水位、不动自动接续」变成不可能，
**违反本仓「功能开关必须解耦」纪律**。

处置：建**第二个**常量 `DEFAULT_AUTO_CONTINUE_THRESHOLD = 0.75`（附注释说明为何故意不复用），
并新增断言 **T7-4** 专门锁「两个开关不得共用同一常量」——变异验证确认该断言真红。

**② 新增模块级常量会打破所有「源码抽取式」测试（连锁 3 个套件）**

`lib/index.js` 里有若干套件用 `new Function` 把方法体从源码里抽出来执行（`extractFn` + `new Function(...names, ...)`），
作用域里**没有模块级绑定**。常量一抽，这些套件立刻 `ReferenceError: DEFAULT_..._THRESHOLD is not defined`：

| 套件 | 表现 | 处置 |
|---|---|---|
| `smoke-test-switch-decouple-pre.mjs` | 组件常量未注入，直接崩 | 注入 2 个常量（同值 0.75） |
| `smoke-test-handoff-pre.mjs` | `renderMemoryDynamic` 抽取体引用崩 | `helperCode` 拼上常量声明 |
| `smoke-test-autocont-host-pre.mjs` | **最隐蔽**：`ReferenceError` 被 `armAutoContinue` 自身 catch 吞掉 ⇒ 表现为「水位达标却不 arm」，报 `Cannot read properties of undefined (reading 'armed')` | 注入 2 个常量 |

⇒ **纪律**：此后凡被抽出的函数新增外部依赖（模块级绑定/全局），都必须同步加进该套件的注入表，
否则以「静默不生效」形式失败。已写入技能库。

---

## 三、明天待办（登记防遗忘）

1. **#82 配置读写链**（中）：写侧原子化 + 队列串行；加载侧损坏文件改名 `.corrupt-<ts>` 保留 + 面板可见
2. **#86-3 `resolveDshHome()` 统一**（中）：20 处、三种口径（trim 与否 / 回退次序）
3. **#84 诊断留痕**（中低）：有界 NDJSON + diag 行补 ID + rejection 计数入 debugView
4. **#86-5 `scanZstdFrames` 双解析器**（低）
5. **#99-③ 核实**：三联动删除的二次确认现状
6. **上游 PR #96–#100 的评阅**：它们是同一审计员的提交，**基线都是 `upstream/main@11f0d98`**，需逐条核验是否已在我的 pre 线修复（本次已核 4 条不适用）

---

## 四、给用户的判断

**「合并一起改」不建议**——理由：这 5 条 B 类触及**三个不同子系统**（配置读写 / 诊断通道 / 水位），合并成一个 PR 会让「回归红了定位不到是哪条引起」的成本远高于收益。

**建议按子系统分三批**：① 水位（今晚，已完成）② 配置读写（明天）③ 诊断通道（明天）。每批独立回归，基线清晰。
