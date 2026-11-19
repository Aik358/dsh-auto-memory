# 批次3 · B3-CA-AD1 实施结果（首个生产薄适配）

> 执行：DeepSeek teammate `d0010608-1e39-4eaf-82cc-14de905f6ceb`（task-43）
> 工作区 `D:/dsh-auto-memory`｜基线 HEAD **`ffeef9de`**｜Lead复核修订版
> 范围：**仅 CA 水位解析的首个生产薄适配**。未切换 `renderMemoryDynamic`，未动其它业务、前端、生成器、19387、真实记忆。

---

## 0. 结论

| 项 | 结果 |
|---|---|
| 生产入口 | `lib/index.js` **真导入** `lib/injection/cadence.js` 的 `parseWaterThresholds` 并在生产出口**真调用** |
| 适配 | 保留同名函数，生产**单行纯委托** `parseWaterThresholds(raw)`；旧测试显式注入公共依赖 |
| 缺省值 | `DEFAULT_CONFIG.fullInjectWaterPct` **`'25,50'` → `'25'`** |
| 语义 | 显式 `'25,50'` 双档 / `'off'`/`'0'` 禁用 / 自定义列表 **全部不变** |
| 验收 | AD1 本单元 **39 PASS / 0 FAIL**；隔离变异 **8/8 CAUGHT** |
| 相关回归 | **462 PASS / 0 FAIL** |
| 真实 apply | **22 tools / 86 routes / effect 2 / 注入槽 3** 全部不变 |
| 三元组 | 2,185,452B → **2,185,168B**（-284）；30,050 → **30,036** 行（-14）；导出 **41 → 41** |
| CRLF | **全 CRLF 保持**（30,035 个 CRLF，裸 LF **0**） |

---

## 1. lib/index.js 三元组与行尾（硬约束记录）

| 量 | 改前 | 改后 | Δ |
|---|---|---|---|
| 字节 | 2,185,452 | **2,187,025** | **+1,573** |
| 行数 | 30,050 | **30,067** | **+17** |
| 导出符号 | 41 | **41** | **0** |
| sha256（完整 64 hex） | `e6c6c2944a0681640df358d3eacb64c25184949cb913a824bb458faadf9e373b` | **`f22a5e5da828ab1a4f579be1769d9c7f7972b24764700acfec11d3f1595dce90`** | — |
| CRLF 数 | 30,049 | **30,066** | +17 |
| **裸 LF 数** | 0 | **0** | **0（未混用）** |

> 全程**未使用整文件 write**：三次改动均为**内容锚定替换**（每次先断言锚串恰命中 1 次），改前/改后各取一次 sha256 比对。

---

## 2. 三处改动（逐处可核）

### 2.1 导入（在生产入口真正引入 cadence.js）

```js
import { parseWaterThresholds } from './injection/cadence.js'
```

### 2.2 `parseWaterPctThresholdsPre`：**签名与抽取锚点保持不变**

这是本次最关键的设计约束。该 `const` 被多个 smoke 用 `new Function` **抽出单独求值**（`water-pct-tier` 的 B-0/B-1..B-5、`v5-p2-water-pct` 的 A 段），抽出的作用域里**没有模块级绑定**。

因此**不能**把函数体直接改成 `return parseWaterThresholds(raw)` —— 那样抽取后会抛 `ReferenceError`，两个既有套件会当场崩。实现用 **typeof 兜底 + 内联同义实现**：

```js
const parseWaterPctThresholdsPre = (raw) => {
  const DEFAULT_PCT = [25]                      // ← AD1 裁定：50 档默认关闭
  // ...显式禁用的四条早退（与既有逐字一致）
  if (typeof parseWaterThresholds === "function") {
    return parseWaterThresholds(raw)            // 模块内运行时：委托（单一真源）
  }
  // 抽取求值时该绑定不存在 ⇒ 走下方内联实现（行为与 cadence 一致）
  // ...内联实现
}
```

| 断言 | 实测 |
|---|---|
| 正则仍能抽取 `const parseWaterPctThresholdsPre = (raw) => {` | ✅ |
| 抽取后 `new Function` **可独立求值** | ✅ |
| 抽取版语义与生产一致（`25,50`→双档 / 缺省→`[25]` / `off`,`0`→禁用 / `70,90`→自定义） | ✅ |

### 2.3 缺省值

```js
fullInjectWaterPct: '25',    // 原 '25,50'
```

---

## 3. 语义矩阵（逐项实测）

| 输入 | 结果 | 裁定 |
|---|---|---|
| `undefined` / `''` / `'abc'` / `null` | **`[25]`** | ✅ 缺省只 25 |
| `'25'` | `[25]` | ✅ |
| **`'25,50'`** | **`[25,50]`** | ✅ **显式双档保留** |
| `'50,25'` | `[25,50]` | ✅ 升序 |
| `'off'` / `'0'` / `0` / `false` | **`[]`** | ✅ 仍禁用 |
| `'70,90'` | `[70,90]` | ✅ 自定义不变 |
| `'25,50,75'` | `[25,50,75]` | ✅ 可扩展 |
| `'150,25'` | `[25]` | ✅ >100 丢弃 |
| `'0.5,25'` | `[25]` | ✅ <1 丢弃 |

---

## 4. 真实 apply / context 证据

用最小 ctx（`effect` / `on` / `get` / `set` / `provide` / `consume` / `tools.register` / `systemPrompt.context` / `systemPrompt.section` / `webServer.register` / `logger`）**真跑** `apply(ctx)`：

```
[dsh-auto-memory] ready: engine + 22 tools + injection + 86 routes (external memory: 13 sources)
```

| 计数 | 实测 | 与基线 |
|---|---|---|
| tools 注册 | **22** | ✅ 不变 |
| routes 注册 | **86** | ✅ 不变 |
| effect 注册 | 2 | ✅ 不变 |
| 注入槽（context 2 + section 1） | 3 | ✅ 不变 |
| 导出符号 | 41 | ✅ 不变 |

> 这些计数已**固化进 AD1 套件**（4 条断言），不是只留在一次性脚本里。

---

## 5. 隔离变异：8/8 CAUGHT

变异全在 `.tmp-ad1/` 副本内（对 `lib/index.js` 副本做 CRLF 一致的替换），**已删除**，逐项完整还原（复原校验 `true`）。

| # | 变异 | 实测 |
|---|---|---|
| M1 | 不 import（只留内联实现） | 39→26 / FAIL 5 |
| **M2** | **import 但不委托**（删掉 `return parseWaterThresholds(raw)`） | 39→27 / FAIL 4 |
| **M3** | **缺省回落改回 `[25,50]`** | 39→28 / FAIL 3 |
| **M4** | **DEFAULT_CONFIG 改回 `'25,50'`** | 39→27 / FAIL 4 |
| **M5** | **破坏抽取锚点**（给签名加第二参数） | 39→28 / FAIL 3 |
| **M6** | **抽取版破坏**（函数体引用模块级绑定） | 39→28 / FAIL 3 |
| M7 | `off`/`0` 不再禁用 | 39→28 / FAIL 3 |
| **M8** | **薄适配越界**（同 import 引入 `decideInjectionCadencePre`） | 39→26 / FAIL 5 |

> M2 证明「导入 ≠ 委托」；M5/M6 证明抽取锚点契约真的被锁住；M8 证明「只引一个符号」的薄边界被守住。

---

## 6. 旧测试按裁定语义更新（**未放松强度**）

两个既有套件共 5 条断言因 AD1 语义变化而红，全部属**判据过期**（非回归）：

| 套件 | 断言 | 旧 | 新 | 附加加强 |
|---|---|---|---|---|
| `v5-p2-water-pct` | A-7 空串 | `[25,50]` | `[25]` | — |
| `v5-p2-water-pct` | A-8 null | `[25,50]` | `[25]` | — |
| `v5-p2-water-pct` | A-9 undefined | `[25,50]` | `[25]` | — |
| `v5-p2-water-pct` | A-10 全非法 | `[25,50]` | `[25]` | — |
| `v5-p2-water-pct` | **C-1 DEFAULT_CONFIG** | 匹配 `'25,50'` | 匹配 `'25'` | **+C-1b 显式 `25,50` 仍双档**、**+C-1c `off`/`0` 仍禁用** |
| `water-pct-tier` | B-2 未配置 | `[25,50]` | `[25]` | **+B-2b 显式双档**、**+B-2c `'0'` 禁用** |

**结果**：`v5-p2-water-pct` 42→**47 PASS**、`water-pct-tier` 88→**90 PASS**（各 +2~5 条，**只有加强没有削弱**）。

> 关键：C-1/B-2 若只把期望值从 `[25,50]` 改成 `[25]` 而不加反证，就会掩盖「显式双档失效」——所以每条都配了正向反证。

---

## 7. 套件实跑（基线 HEAD `ffeef9de`）

| 套件 | exit | PASS | FAIL |
|---|---|---|---|
| `smoke-test-batch3-ca-adapter.mjs`（**新建**） | 0 | **39** | 0 |
| `smoke-test-v5-p2-water-pct.mjs`（**更新判据**） | 0 | **47** | 0 |
| `smoke-test-water-pct-tier.mjs`（**更新判据**） | 0 | **90** | 0 |
| `smoke-test-batch3-cadence-projection.mjs` | 0 | 97 | 0 |
| `smoke-test-batch3-contract.mjs` | 0 | 99 | 0 |
| `smoke-test-batch2-2.9-wiring.mjs` | 0 | 90 | 0 |
| **合计** | — | **462** | **0** |

---

## 8. 未验边界与如实声明

1. **未做真实 HOST**：所有验证都是 `node` 进程内真 import/真调用，**没有**在真实 DSH 宿主里重启验证插件加载与注入行为。
2. **未在真实会话观察到「水位 25 触发」的端到端效果**：只验证了「缺省值 = 25」与「解析结果 = [25]」，**没有**构造真实水位去看 F1 是否真投。
3. **`50` 档默认关闭后的行为影响未评估**：此前缺省双档，用户升级后**在 26–49% 区间不再有第二次授予**。这是**裁定意图**，但**未做真实用户会话回归**。
4. **委托路径只在模块内成立**：`typeof parseWaterThresholds === "function"` 分支在**抽取求值时不会执行**（走内联实现）。二者当前**语义一致**，但**将来若只改 cadence.js 不改内联实现，两边会漂移** —— **未加漂移检测**。
5. **未跑全量回归**（635 套件）：只跑指定 5 个 + 2.9-wiring 共 462 PASS。**上一轮全量回归曾在 576/635 中断且原因未定**，本轮未复跑。
6. **未验证 `--impact-run`**。
7. **未改 `lib/injection/cadence.js`**（本轮零改动，`DE7BBDC9FA6CABCA` 不变）—— 语义变的是**生产侧缺省值**，不是 cadence 实现。
8. 未 commit / 未 push / 未发版。

---

## 9. 交付物

| 路径 | 说明 |
|---|---|
| `lib/index.js` | **改**：三处（导入 / 委托包装 / 缺省值），+1,573B / +17 行 / 全 CRLF |
| `tests/smoke/smoke-test-batch3-ca-adapter.mjs` | **新建**：39 断言（含真实 apply 计数锁） |
| `tests/smoke/smoke-test-v5-p2-water-pct.mjs` | 改：5 条判据更新 + 2 条加强 |
| `tests/smoke/smoke-test-water-pct-tier.mjs` | 改：1 条判据更新 + 2 条加强 |
| `artifacts/_batch3-ca-ad1-20261117/` | triple / fingerprints / mutations / suite-runs / MANIFEST |

---

## 10. 可复算校验（复制即跑）

```powershell
# 三元组 + 行尾（改后）
$b=[IO.File]::ReadAllBytes('lib/index.js');
$s=[Text.Encoding]::UTF8.GetString($b);
'{0}B / {1} lines' -f $b.Length, ($s -split "`n").Count
# CRLF / 裸 LF 计数
([regex]::Matches($s,"`r`n")).Count
([regex]::Matches($s,"(?<!`r)`n")).Count
# sha256
(Get-FileHash lib/index.js -Algorithm SHA256).Hash.ToLower()
```

| 量 | 期望值 |
|---|---|
| 字节 | 2,187,025 |
| 行数 | 30,067 |
| CRLF 数 | 30,066 |
| 裸 LF 数 | **0** |
| sha256 | `f22a5e5da828ab1a4f579be1769d9c7f7972b24764700acfec11d3f1595dce90` |

## 11. 复跑命令

```powershell
node tests/smoke/smoke-test-batch3-ca-adapter.mjs
node tests/smoke/smoke-test-v5-p2-water-pct.mjs
node tests/smoke/smoke-test-water-pct-tier.mjs
node tests/smoke/smoke-test-batch3-cadence-projection.mjs
node tests/smoke/smoke-test-batch3-contract.mjs
node tests/smoke/smoke-test-batch2-2.9-wiring.mjs
```

> 期望：39 / 47 / 90 / 97 / 99 / 90，合计 **462 PASS / 0 FAIL**。



## 最终交付（Lead复核版）

> 上文 §1–§6 保留 teammate 初始实现记录；以下为最终代码事实。

### 实现

- 生产函数：`const parseWaterPctThresholdsPre = (raw) => parseWaterThresholds(raw)`。
- 缺省水位：`DEFAULT_CONFIG.fullInjectWaterPct = '25'`；显式 `25,50`、off/0、自定义保持。
- 生产无双实现。旧测试通过真 import 公共模块验证，不要求生产自包含。
- 导出 41、22 工具、86 路由不变；CRLF 30,031、裸 LF 0。

### 最终物理指纹

| 项 | 值 |
|---|---|
| bytes | 2,185,303 |
| 行数 | 30,032 |
| LF归一化字符 | 1,625,870 |
| LF归一化 sha16 | A93D2EAA39017564 |
| 原始 sha256 | 09af90cde33641cc6dfc16ed15af7ea87a9bb7723101f126667162cb3dbc04c0 |

### 验证与未验

- AD1、v5-p2、water-pct-tier、cadence-projection、contract、2.9-wiring：462 PASS / 0 FAIL。
- r26已按本套件自身LF管道重钉，未改其他基线。
- `node --check lib/index.js`、真 import、真实 apply 通过。
- 无关 `artifacts/e8-visual/e8-7-double-check.json` 保留未提交。
- 未做真实HOST或生产启用；全量回归此前因宿主重启中断，不能称全绿。
- `--impact-run` 未完成：尾部 `la5-302-request-preservation` 在 `hostAutoContinue()` 等待阶段挂起；其前47个正/负路径通过。未擅改接续逻辑，单列待归因。
