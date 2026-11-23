# 交接账本 · 批次5 施工卡点说明

**时间**：2026-11-23 11:05 ｜ **交接方**：Lead ｜ **状态**：❌ **批次5 未收口，工作树有未提交改动**

---

## 一、任务状态

批次5 两事项（铭文落盘 `9b2ec568` / 运行档默认关闭 `c7ee3b10`）已提交到本地 `preview`，
但**验收发现两类真实缺陷 + 一类测试未对齐**，均未解决完。**不能 push、不能发版。**

| 项 | 状态 |
|---|---|
| 铭文提交 `9b2ec568` | ⚠️ 有缺陷（丢失 5 条纠偏语句），**已在本工作树修复，未提交** |
| 运行档提交 `c7ee3b10` | ❌ 有缺陷（关掉后 `<memory_system>` 整块消失），**已在本工作树修复，未提交** |
| 工作树 | **14 个已跟踪文件被改**（2 产品 + 1 产物 + 11 测试），全部未提交 |

---

## 二、目标

1. **铭文升级**：换成用户逐字审批的版本，修正 6 条工具契约缺陷 + 补画像段。
2. **降占用**：`run_full` / `run_slim` 默认关闭、可手动打开，**且不得连坐** `human_slim` / `post_compact`。

---

## 三、已解决的问题（本工作树内已完成，未提交）

### 3.1 ❗ 铭文压缩丢失 5 条纠偏语句（真实回归）

| 丢失内容 | 后果 |
|---|---|
| 「改过 lib/ 下任何文件 ⇒ **必写** memory_note(kind=handoff)」 | 「必写」退化为「要写」 |
| 「**kind=note 不等于**白板/账本」 | 模型可能只写 note 就宣称更新了白板 |
| 「只写 note 却宣称已更新是**失职**」 | 定性用语消失，约束强度下降 |
| 「**write 直接写 docs/ 不算**插件记忆」 | 模型可能以为写文件就等于写插件记忆 |
| 四段式账本措辞 | 降级为「content 四段」 |

**这 5 条是 `smoke-test-t7bcd.mjs` 的 T7d 断言专门守护的**，测试注释原文写着
「本轮用户报的*行为对不上*根因」—— 即用户曾亲自报告过的行为问题。

**用户裁定方案乙**（补回但极度压缩）。已实施：

```
模板 1,601 → 1,671 字符（+70）
完整帧 1,723 → 1,793（含日期与前导 LF），护栏 1,900，余量 107
渲染 SHA256: 5fe771981bdaeff8 → 42f6e31b25ecd241
```

验证：`t7bcd` **15/0**。

### 3.2 ❗ 运行档关闭后 `<memory_system>` 整块消失（真实缺陷）

**根因**（`lib/index.js` 原 `:24227`）：`renderRunReminder()` 只返回铭文，
**绕过了 `renderMemoryDynamic` 的完整帧组装** ⇒ 开合标签、状态行、检索指引全部消失。

**用户裁定方案甲**：骨架必须保留，只省白板/账本/事件卡/画像等大段正文。

已实施：`renderRunReminder` 改为「手写骨架 + 铭文」。

**关键坑**：不能用 `renderSlimSnapshotPre()` 复用 —— 它含 `snapshotSlimRecallNote`，
其正文有 `[Retrieved memory reference` 字面串，会撞 `m53` 的 C8 断言（实测 37/1）。

验证：动态上下文 1,723 → **3,518 字符**，`smoke-test.mjs` 通过。

### 3.3 其他已修（全部未提交）

| 问题 | 修法 |
|---|---|
| `lib/client.js` 镜像未同步（G4-6b/6d 红） | 同步客户端铭文字面量 |
| 8 个套件锚点过期（`finalizePre` 签名加了 `hangGranted` 参数） | 逐个更新锚点字符串 |
| G4-6 长度登记（1601→1671、1723→1793、SHA 前缀） | 按实测更新 |
| r26 哈希与基线锁 | **按守卫报出的 actual 重钉**：`1C5A01947DF2D475` / `1668010` |

---

## 四、❌ 当前卡点（唯一未解项）

### `tests/smoke/smoke-test-delivery-policy-runtime.mjs` 仍有 **3 红**

三条测试名：

1. `Batch 5 suppresses both run snapshots by default and restores byte-identical output when enabled`
2. `Batch 5 leaves human full/slim, post-compaction and handoff delivery intact`
3. `Batch 5 applies units frame caps to the reminder with the independent static cost`

**根因**：这三条是 Codex 为「关闭时只剩裸铭文」这个**行为**写的：

```js
assert.deepEqual(disabled.rows, Array(5).fill(reminder));  // reminder 原=裸铭文
```

而「只剩裸铭文」正是要修掉的缺陷形态。**测试把缺陷固化成期望值。**

**已尝试但未成功**：

- 把 `reminder` 改为「骨架 + 铭文」并逐字节重构骨架 ⇒ 失败
- 改为语义判据（骨架闭合 + 检索指引在场 + 以铭文收尾 + 不含大段正文）⇒ 仍 3 红

**未定位的原因**：`fixture(host, config, { actual: true })` 走真实渲染路径，
内部 `host.bindDynamic(engine)` 的精确输出未知，无法判断 `rows[0]` 与期望差在哪。

**建议下一步**：

1. 在测试里临时打印 `disabled.rows[0]` 与期望的前 200 字符 + 长度，定位差异；
2. 或直接问 Codex（这三条它写的，只有它清楚 fixture 路径）；
3. **不要**为了让绿而删断言 —— 应改为「骨架在场」的语义判据。

---

## 五、⚠️ 流程层面的两个教训（比代码更重要）

### 5.1 Lead 的审批清单漏了一类

批准提案时逐项核对了「11 项内容保全」（15 条归属判据 / 四类感知 / 画像条件 / 四段键 / 泳道 tag …），
**但清单里没有「纠偏措辞与定性用语」这一类**。
结果：功能条目齐全、行为约束强度却下降了。

**新判据**：压缩类改动的验收清单必须包含「纠偏措辞与定性用语」（「必写」vs「要写」、「失职」是否还在）。

### 5.2 Codex 的回执在自己写的测试上跑绿 = 自证

Codex 报「运行专项 17/0、四档逐档一致」，但那 17 条是它为「关闭时 0 次快照渲染」自己写的断言。
**「0 次快照渲染」正是缺陷本身**（连记忆块一起没了），于是断言通过。
真正抓到缺陷的是**旧有的** `smoke-test.mjs` 里那条 `dynamic context missing memory_system block`。

**新判据**：验收「关闭某功能」时，断言必须校验**用户可观察的结果仍然存在**，
不能只校验「实现路径被执行 0 次」——后者等于把缺陷当预期。

---

## 六、工作树现状（未提交，14 个文件）

```
M lib/index.js                                       ← 骨架修复 + 5 条纠偏语句回补
M lib/client.js                                      ← 镜像同步
M artifacts/e8-visual/e8-7-double-check.json         ← 测试产物（时间戳）
M tests/smoke/smoke-test-g4-whiteboard.mjs           ← 长度/SHA 登记更新
M tests/smoke/smoke-test-r26-cross-layer.mjs         ← 锁重钉
M tests/smoke/smoke-test-delivery-policy-runtime.mjs ← 3 红未解
M tests/smoke/smoke-test-cold-start-ready.mjs        ┐
M tests/smoke/smoke-test-human-turn-grant.mjs        │
M tests/smoke/smoke-test-inj3-same-turn-dedup.mjs    │ 8 个套件的
M tests/smoke/smoke-test-inj4-slim-throttle.mjs      │ finalizePre 锚点
M tests/smoke/smoke-test-inj5-step-cadence.mjs       │ 已全部更新为
M tests/smoke/smoke-test-inject-frame-fidelity.mjs   │ (txt, hangGranted = false)
M tests/smoke/smoke-test-tiered-branches.mjs         │
M tests/smoke/smoke-test-tiered-cadence-runtime.mjs  ┘
```

**当前物理量**：

```
lib/index.js   tpl 1,671 / arch 117 / 完整帧 1,793 字符
               UTF-8 2,887 字节（渲染）/ 2,888（含前导 LF）
               渲染 SHA256 前缀 42f6e31b25ecd241
lib/client.js  镜像已同步（G4-6b/6d 绿）
```

---

## 七、已验证通过的套件（本工作树）

| 套件 | 结果 |
|---|---|
| `smoke-test-g4-whiteboard` | **11/0** |
| `smoke-test-r26-cross-layer` | **26/0** |
| `smoke-test-t7bcd` | **15/0** |
| `smoke-test-m53` | **38/0** |
| `smoke-test-tiered-cadence-runtime` | **20/0** |
| cold-start-ready / human-turn-grant / inj3 / inj4 / inj5 / inject-frame-fidelity / tiered-branches | 全绿 |
| `smoke-test`（独立） | 通过（动态上下文 3,518 字符） |
| **`delivery-policy-runtime`** | ❌ **14 pass / 3 fail** |

---

## 八、下一步（可直接执行的第一条）

```powershell
# 1. 定位三条差异：在 test 1 的 assert 前打印 disabled.rows[0] 与期望的前 200 字符与长度
# 2. 按差异改为语义判据（骨架在场 + 铭文收尾），不要删断言
# 3. 转绿后跑全量：
node tools/run-smoke.mjs --jobs=8 --timeout=180000

# 4. 全绿后拆两个 commit 提交：
git add lib/index.js lib/client.js tests/smoke/smoke-test-g4-whiteboard.mjs tests/smoke/smoke-test-r26-cross-layer.mjs
#    commit 1: fix(batch5) 铭文补回纠偏语句 + 恢复关闭运行档时的记忆骨架
git add tests/smoke/smoke-test-*.mjs
#    commit 2: chore(tests) 套件锚点与锁同步（含 8 个 finalizePre 锚点）
```

**仍未做**：真实模型对照实验（提案 §六 有方案，未执行）；`verify-docs` 需复跑确认仍为 22/87/183。
