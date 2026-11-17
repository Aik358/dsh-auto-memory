# 批次3 · B3-RP-AD1 实施结果（规则出口生产薄适配）

> 执行：DeepSeek teammate `d0010608-1e39-4eaf-82cc-14de905f6ceb`（task-44）
> 工作区 `D:/dsh-auto-memory`｜基线 HEAD **`f8e6f8ad`**（未 commit / 未 push）
> 范围：**仅 RP 规则出口薄适配**。未动 NT/BD/FM/EV/CO、前端、生成器、19387、真实记忆。

---

## 0. 结论

| 项 | 结果 |
|---|---|
| 生产入口 | `lib/index.js` 真 import `render-rules.js`，规则出口**真调用** `renderRulesForTierPre` |
| 完整档 | `human_full`/`post_compact`/`handoff_carry`/`legacy` ⇒ **完整正文** |
| 指针档 | `slim`/`run_slim`/`human_slim` ⇒ **只给指针** |
| `human_slim` | **额外**带维护块，文本取**真实** `DEFAULT_PROMPT_LAYERS.snapshotSlimMaintain` |
| `legacy` | `legacy-pointer` 模式（公共模块侧） |
| note / retired | `（说明）` 前缀与 retired 过滤**由公共模块负责**，生产不复制业务 |
| 验收 | AD1 本单元 **44 PASS / 0 FAIL**；隔离变异 **8/8 CAUGHT** |
| 相关回归 | **491 PASS / 0 FAIL** |
| 真实 apply | **22 tools / 86 routes / effect 2 / 注入槽 3 / 导出 41** 全部不变 |
| 三元组 | 2,185,303B → **2,187,608B**（+2,305）；30,032 → **30,060** 行（+28）；导出 **41 → 41** |
| 行尾 | 全 CRLF 保持（30,031 → **30,059**），裸 LF **0**，孤立 CR **1**（与基线同为既有那处） |

---

## 1. lib/index.js 三元组与行尾

| 量 | 改前 | 改后 | Δ |
|---|---|---|---|
| 字节 | 2,185,303 | **2,187,608** | **+2,305** |
| 行数 | 30,032 | **30,060** | **+28** |
| 导出符号 | 41 | **41** | **0** |
| sha256 | `09AF90CDE33641CC…` | **`0a62f7d487fa3be2548a73b384c5da6f1c07f3ef722f8d9c169052e5127ae0b2`** | — |
| CRLF | 30,031 | **30,059** | +28 |
| 裸 LF | 0 | **0** | **0** |
| 孤立 CR | 1 | **1** | **0（既有，非本轮引入）** |

> 未使用整文件 write；改动用「按 CR 分段抽取真实行 + 逐行重建」（见 §6）。

---

## 2. 改动

### 2.1 导入

```js
import { renderRulesForTierPre } from './injection/render-rules.js'
```

### 2.2 规则出口：纯委托 + typeof 兜底

```js
if (typeof renderRulesForTierPre === 'function') {
  try {
    const _rpTier = _rulesFullTierInline ? 'human_full'
      : (_tier === _T.HUMAN_SLIM ? 'human_slim' : 'slim')
    const _rp = renderRulesForTierPre({
      rules: rulesLayer,
      tier: _rpTier,
      legacy: false,
      maintainText: (typeof L === 'function' ? L("snapshotSlimMaintain") : '') || '',
    })
    if (_rp && typeof _rp.text === 'string') _rulesOut = _rp.text
  } catch (_eRp) { /* fail-open 到既有路径 */ }
} else if (!_rulesFullTierInline && rulesSection.text) {
  // ← 改造前**逐字保留**的原路径（仅抽取式套件的沙箱会走到）
}
```

### 2.3 ★为什么 typeof 兜底不是「双实现」

`renderMemoryDynamic` 被 **20+ 个套件用 `new Function` 抽取执行**，沙箱里没有模块级绑定。裸调用会 `ReferenceError` 被 catch 吞掉 ⇒ **规则段恒空**。

| 场景 | 模块级绑定 | 走哪条 |
|---|---|---|
| **生产运行时** | 一定存在 | **恒走委托**（唯一真源） |
| 抽取式套件 | 不存在 | 走既有路径（不炸、测原语义） |

**判据边界**：`else` 分支是**为抽取式套件保留的既有路径**，不是第二份业务实现；生产永不可达。变异 M7（删 typeof 兜底）与 M8（删 else）都能被抓 —— 前者证生产走委托，后者证该路径真的被依赖。

---

## 3. 档位语义（逐项实测）

| 档位 | mode | rendered | 正文 | 维护块 |
|---|---|---|---|---|
| `full` | `full` | 2 | **完整** | 无 |
| `human_full` | `full` | 2 | **完整** | 无 |
| `slim` | `pointer` | 0 | 指针 | 无 |
| `run_slim` | `pointer` | 0 | 指针 | **无** |
| **`human_slim`** | **`slim-maintain`** | 0 | 指针 | **有（真实配置）** |
| `legacy` | `legacy-pointer` | 0 | legacy 指针 | 无 |

### 3.1 note 前缀与 retired 过滤

| 断言 | 实测 |
|---|---|
| `note` 条目带 `（说明）` 前缀 | ✅ |
| **retired 条目被过滤**（`已退役丙` 不出现在正文） | ✅ |
| `excludedRetired` 如实报数 | ✅ 1 |
| `counts.note` / `counts.rule` 分计 | ✅ 1 / 1 |

### 3.2 ★维护块取真实配置（非硬编码副本）

用**真实** `DEFAULT_PROMPT_LAYERS.snapshotSlimMaintain` 与占位文案各渲染一次，**输出必须不同**：

| 断言 | 实测 |
|---|---|
| `snapshotSlimMaintain` 真实存在 | ✅ 有长度 |
| 换 maintainText 输出即变 | ✅ 两版文本不同 |
| 真实文案**逐字出现**在结果里 | ✅ |
| 未传 ⇒ 回落 `SLIM_MAINTAIN_BLOCK` | ✅ |

---

## 4. 真实 apply / context

```
[dsh-auto-memory] ready: engine + 22 tools + injection + 86 routes (external memory: 13 sources)
```

| 计数 | 实测 |
|---|---|
| tools / routes / effect / 注入槽 / 导出 | **22 / 86 / 2 / 3 / 41 全部不变** |

---

## 5. 隔离变异：8/8 CAUGHT（崩溃 0 次）

| # | 变异 | 实测 |
|---|---|---|
| M1 | 不 import | 44→39 / FAIL 1 |
| **M2** | **import 但不委托** | 44→38 / FAIL 2 |
| **M3** | **完整档也走指针** | 44→39 / FAIL 1 |
| **M4** | **human_slim 不映射** | 44→39 / FAIL 1 |
| **M5** | **维护块硬编码（不用真实配置）** | 44→39 / FAIL 1 |
| **M6** | **越界多引符号** | 44→36 / **FAIL 4** |
| **M7** | **删掉 typeof 兜底（裸调用）** | 44→39 / FAIL 1 |
| **M8** | **删掉兜底 else 分支** | 44→38 / FAIL 2 |

---

## 6. ★两处修正（都不是产品缺陷）

### 6.1 我的断言是恒真式伪判据

首轮「薄适配边界」断言用**全文件 `indexOf`** 判泄漏 ⇒ 把我**自己写的注释里提到的符号名**当成泄漏。属「凡断言源码里是否含某字符串即恒真守卫」。

**修正**：改为只解析 **import 语句的标识符集合**。

### 6.2 ★我引入了 4 个孤立 CR（已修）

拼装 import 注释时用了「CR + 换行」但**每行缺 LF**，产生 4 处 `\r` 后紧跟非 `\n`。

**实证**：改前孤立 CR=1（既有）→ 中间态 **5** → 修正后**回到 1**。

**判据**：行尾不能只看「有没有混用」或「裸 LF 是否为 0」，必须**同列 CRLF / 裸 LF / 孤立 CR 三个计数**并与基线逐个比对 —— 只看裸 LF=0 会漏掉孤立 CR 这一类。

---

## 7. 存量基线重钉（改 lib/index.js 的必然后果）

r26 是「宿主 index.js 不得无痕漂移」的基线锁，改 `lib/index.js` 必红。两条：

| 锁 | 改前 | 改后 |
|---|---|---|
| LF 归一化 sha16 | `A93D2EAA39017564` | **`ECCE98675BA50AC4`** |
| `R153_CHARS`（LF 归一化长度） | 1,625,870 | **1,627,450**（Δ **+1,580**） |

**归因**（唯一漂移源 = 本轮三处，全在 `lib/index.js` 手写区）：① import 行 + 3 行说明注释；② 出口改纯委托（含 else 兜底）；③ 出口注释。

**复算口径**：用**套件自身**的 `IX = readFileSync(...).replace(/\r\n/g,'\n')` 管道实测，非手填。验证：`git show HEAD:lib/index.js` 按同一管道算得 1,625,870 / `A93D2EAA39017564` —— **与改前锁精确相等**，证明归因无遗漏。

> `R153_CHARS` 是 **LF 归一化后**长度，不是文件字节数，两者不可互相套用。

---

## 8. 套件实跑（HEAD `f8e6f8ad`）

| 套件 | exit | PASS | FAIL |
|---|---|---|---|
| `smoke-test-batch3-rp-adapter.mjs`（**新建**） | 0 | **44** | 0 |
| `smoke-test-p6a-rules-layer.mjs` | 0 | 125 | 0 |
| `smoke-test-batch3-rules-render.mjs` | 0 | 68 | 0 |
| `smoke-test-batch3-contract.mjs` | 0 | 99 | 0 |
| `smoke-test-r26-cross-layer.mjs`（**重钉**） | 0 | 26 | 0 |
| `smoke-test-batch3-ca-adapter.mjs` | 0 | 39 | 0 |
| `smoke-test-batch2-2.9-wiring.mjs` | 0 | 90 | 0 |
| **合计** | — | **491** | **0** |

---

## 9. 未验边界与如实声明

1. **未做真实 HOST**：全部为 node 进程内真 import / 真调用 / 真 apply，**未在真实 DSH 宿主重启验证**。
2. **未在真实会话观察规则注入**：只验证「出口调用公共模块且档位正确」，**没有**在真实会话查看 prompt 里规则段的实际形态。
3. **档位映射是本轮约定**：生产 `_tier` 有 8 个值，本轮只覆盖 4 类；`run_full` / `hang_compensate` 归入完整档，**未逐档验证**。
4. **★生产路径永远走不到公共模块的 `legacy-pointer`**：`legacy: false` 恒传，且 `_tier === LEGACY` 落在 `_rulesFullTierInline` 内 ⇒ LEGACY 走 `human_full`。这是**沿用既有行为**（改前 LEGACY 也投全文），但公共模块的 legacy 分支**生产不可达**，仅测试验证。
5. **`_renderRulesSlimInline` 仍在**（else 分支）。生产不可达，但它与公共模块 slim 档文案**是否逐字一致未逐条比对**。
6. **未跑全量回归**（只跑 7 个相关套件 491 PASS）。
7. **未验 `--impact-run`**。
8. **`render-rules.js` 本轮零改动**（`4DE1F438EEEFEC3A` 不变）。
9. 未 commit / 未 push / 未发版。

---

## 10. 交付物

| 路径 | 说明 |
|---|---|
| `lib/index.js` | **改**：导入 + 出口纯委托 + 兜底 else（+2,305B / +28 行） |
| `tests/smoke/smoke-test-batch3-rp-adapter.mjs` | **新建**：44 断言 |
| `tests/smoke/smoke-test-r26-cross-layer.mjs` | 改：两条基线锁按套件自身管道重钉 |
| `artifacts/_batch3-rp-ad1-20261117/` | triple / fingerprints / mutations / suite-runs / MANIFEST |

## 11. 复算与复跑

```powershell
# 期望：2,187,608 B / 30,060 行 / sha256 0a62f7d487fa3be2…
(Get-FileHash lib/index.js -Algorithm SHA256).Hash.ToLower()
(Get-Item lib/index.js).Length
```

```powershell
node tests/smoke/smoke-test-batch3-rp-adapter.mjs   # 期望 44 PASS
node tests/smoke/smoke-test-r26-cross-layer.mjs     # 期望 26 PASS
node tests/smoke/smoke-test-p6a-rules-layer.mjs     # 期望 pass=125
```

> 行尾核验：CRLF 应为 30059、裸 LF 应为 0、孤立 CR 应为 1（既有）。


## Lead复核修订（最终）

- 生产八档显式映射：human_full/post_compact/handoff_carry/hang_compensate完整；human_slim维护块；legacy指针；run_full/run_slim指针。
- legacy不再硬编码false，新增生产出口实参映射断言，不只测公共模块。
- RP适配53 PASS/0 FAIL；rules-render68、p6a125、contract99、r26 26通过。真实apply 22工具/86路由/导出41。
- 未改前端/生成器/19387/真实记忆；未真实HOST、未全量。


### 用户反馈后的最终词表修订

- run_full不在生产入口改名为slim；原tier原样传入RP。
- RP的RENDER_TIERS显式加入run_full，并在摘要/指针档处理；legacy同样由公共词表处理。
- p6a真实输出复核通过，修复了生产档位枚举在注入上下文中不存在的风险。
