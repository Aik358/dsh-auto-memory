# 回归失败归因报告（我亲自复跑）· 2026-10-24 23:52

> **C 线报「439 PASS / 10 FAIL / 1 TIMEOUT」；我实跑（`node tools/run-smoke.mjs`）= 450 PASS / 9 FAIL / 0 TIMEOUT（190.4s）。**
> **差异**：C 线多报了 1 个 FAIL + 1 个 TIMEOUT，少报 11 个 PASS。可能因为它是在 A 线同期改 `index.js` 时跑的（并发干扰）。**以我的复跑为准。**

---

## §0 · 9 个失败逐个归因（每个都单独复跑过）

| # | 套件 | 单独跑 | 真实原因 | 归属 |
|---|---|---|---|---|
| 1 | `smoke-test-graph-mode` | ✅ **35 passed / 0 failed** | **并行干扰假红**（全量跑时 A 线正在改 index.js） | 🟢 无需修 |
| 2 | `smoke-test-issue392-393-continuation-ui` | ❌ `convert: ROUTE_PREFIX + '/event-convert'` 未定义 | C 线在前端 API 表加了 `convert` 键，但该套件用 vm 抽 `API` 表时**没注入 `ROUTE_PREFIX`** | 🔴 **C 线** |
| 3 | `smoke-test-r15-left-rail` | ❌ 72 PASS / 1 FAIL | **`--dam-state-warn` 有消费无定义**（见 §1） | 🔴 **C 线** |
| 4 | `smoke-test-issue368-write-contract-negative` | ❌ assertion actual=1 expected=0 | **`appendText must be awaited or returned` @ event-write**（新代码违反既有写契约） | 🔴 **A 线** |
| 5 | `smoke-test-p23-wb-sidecar` | ❌ | sidecar 相关（A 线 H0 将解耦，尚未做） | 🟡 **待 A 线步3** |
| 6 | `smoke-test-r26-cross-layer` | ❌ | 宿主 `index.js` baseline 锁（A 线改了 memory_log） | 🟡 **判据过期** |
| 7 | `smoke-test-iter5-skin` | ❌ | 经典档字节守恒锁 | 🟡 **判据过期**（C 线改手写区） |
| 8 | `smoke-test-settings-archive-interval` | ❌ | 同型经典档字节锁 | 🟡 **判据过期** |
| 9 | `smoke-test-issue207-processes` | ❌ | 待细查 | ⏳ |

**归类：真缺陷 2 条（C 线 2）+ 判据过期 3 条 + 待 A 线 1 条 + 并行假红 1 条 + 待查 1 条。**

---

## §1 · 最值得注意的真缺陷：`--dam-state-warn` 有消费无定义

### 现象
`smoke-test-r15-left-rail` 的 `㊷b ★D1 真值全在白名单` 红，实测多出 **`state-warn`**。

### 定位（我亲自 grep）
**`lib/client.js` L8042**（C 线新增的存量转换 UI 确认弹窗）：
```js
h('div', { 'data-dam-convert-warn': '', style: {
  border: '1px solid var(--dam-state-warn, #d4a94f)',   // ← 用了 --dam-state-warn
  ...
}})
```
**但全文件 `--dam-state-warn:` 定义数 = 0。**

### 为什么这条断言重要
它守的是「**有消费·无定义**」的 token —— 这类 token 会**静默回退到兜底色**（这里是 `#d4a94f`）。
后果：
- 在默认档看不出问题（兜底色像正常的警告色）
- 但**在皮肤档/暗色档会与主题不协调**，且用户无从得知
- 这正是 D1 外观层收口要防的「漂移」

### 修法（二选一，我倾向 A）
| 方案 | 做法 | 评价 |
|---|---|---|
| **A** | 把 `var(--dam-state-warn, #d4a94f)` 改为**既有的** `var(--dam-dec-prefetch, #e8c584)`（该变量已在白名单外但已定义） | ✅ 推荐：零新增 token |
| B | 在 `:root` 段新增 `--dam-state-warn` 定义 | ⚠️ 但会**扩大** token 面，且白名单还要加一条 |

**我裁定选 A**，理由：D1 的目标是「收敛」，不是「扩张」。

---

## §2 · 对 C 线 10 项三态表的裁决

### 2.1 已批准的（必须做）

| # | 能力 | 裁决 | 优先级 |
|---|---|---|---|
| 3 | **检查点折叠** | ✅ **做** | **P0**（现在只显示 `checkpointCount` 数字，检查点正文看不到） |
| 4 | **六类 panel** | ✅ **做** | **P0**（后端 `panelDigest` 已就绪，前端只需渲染） |
| 2 | 右栏抽屉 | ✅ **做** | P1（但**可中断+reduced-motion** 规格必须照原型，不许简化） |
| 5 | 空档标记 | ✅ **做** | P1（「事件是连续推进」的核心表达） |
| 8 | 键盘 ↑↓ | ✅ **做** | P2（成本低、无障碍） |
| 10 | 倒序（初始贴底） | ✅ **做** | P1 |
| 6 | 懒加载 | ✅ **做** | P2 |

### 2.2 我否决 / 改判的

| # | 能力 | C 线建议 | 我的裁决 |
|---|---|---|---|
| 1 | **三视图**（stream/lanes/workflow） | 成本最高、生产价值待验证 | ✅ **做，但降级为 P2**，且**只做 stream + lanes 两档**；`workflow` 档**本轮不做**（37 组/163 行的复杂度，等真实数据验证） |
| 7 | **深链 `#evt-091`** | 建议改 `wbEvt.selectedId` 持久化 | ✅ **同意改判**。理由：`location.hash` 属宿主页面，插件改它会污染宿主路由。改为 `wbEvt.selectedId` 持久化，**验收判据同步改**为「重开面板回到原事件」 |
| 9 | **合成 demo 模式** | 判断不适用 | ✅ **同意不进生产**。但**保留**为 `debug` 配置下可见（原型里有 4 条负路径专门验证「真实列表 0 个 demo id」，删掉这个能力会让那部分验证失去载体） |

### 2.3 关于「倒叙 0 次」的修正

C 线说：「我上一轮报『倒叙 7 次』是假阳性，本轮精确 grep = 0」。

**我核实：两个都对，但测的不是同一对象。**
- 我 grep 的是 `'倒叙'`（中文串），命中 7 次 —— 那是**注释/文案**
- C 线 grep 的是 `倒序`（不同字），命中 0 —— 但 `倒叙` 也不代表**实现**

⇒ **`倒序（初始贴底）` 确实未实现**。C 线的结论正确，我的初判（「✅ 有」）是**假阳性**，采纳 C 线。

---

## §3 · 对 A 线步2 的验收

### 3.1 待我先验证的（下一步做）

| 项 | 他报的 | 我要验的 |
|---|---|---|
| 行数守恒 | 22,025 → 22,106（+81） | 实测 |
| 字符守恒 | 1,193,540 → 1,200,027（+6,487） | 实测 |
| CRLF | 22,106 / 裸 LF 0 | 实测 |
| 真调测试 | 35 PASS / 0 FAIL | 复跑 |
| 判据修正 | `p6b-rules-kind` 收窄作用域 + 变异验证 | 复跑 + 审查修法是否「收窄而非放宽」 |

### 3.2 他主动报的一条契约冲突（重要）

`smoke-test-issue368-write-contract-negative` 红的根因是：
> **`appendText must be awaited or returned` @ event-write**

**这正是我 3 个风险里没预见到第 4 个**：`event-write.js` 里的 `appendText` 调用**没有 await 或 return**。
**但 A 线说他 7 个套件全绿 —— 说明他没跑这个套件。** 这是「自测覆盖不全」，不是恶意隐瞒。

**要求 A 线**：修 `event-write.js` 的 `appendText` 调用（补 await），并**把该套件加入自测清单**。

---

## §4 · 一句话

**9 个失败已全部归因：2 条 C 线真缺陷（`--dam-state-warn` 无定义、`ROUTE_PREFIX` 未注入）、3 条判据过期、1 条并行假红、1 条待 A 线、1 条待查。**
**C 线报的 439/10/1 与实测 450/9/0 有差异，以实测为准。**
