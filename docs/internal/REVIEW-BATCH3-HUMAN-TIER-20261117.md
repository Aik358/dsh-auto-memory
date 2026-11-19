# 追加复核：human_full / human_slim 与 CA 帧节奏的关系

> 用户要求复核 human full / human slim。实测发现 **A 批公共 CA 的档位输出与生产八档不一致**，属 P0 缺口。

## 一、生产侧的真实语义（已核实源码）

`lib/index.js:2147`：

```js
if (o.isHuman) return o.isFull ? INJECT_TIERS.HUMAN_FULL : INJECT_TIERS.HUMAN_SLIM
```

即生产是 **isHuman × isFull 四象限**：

| | isFull=true | isFull=false |
|---|---|---|
| 真人 | `human_full` | `human_slim` |
| 非真人 | `run_full` | `run_slim` |

`lib/index.js:1946` 的 `isHumanTierPre` 明确把 `human_full` / `human_slim` 同归「用户发声档」。

## 二、公共 CA 的实际输出（实测）

| 输入 | 返回 tier | grants |
|---|---|---|
| 真人 | **`full`** | `["human-turn"]` |
| 真人 + 水位 26% | **`full`** | `["water-25"]` |
| 真人 + 刚 full 过 | **`full`** | `["human-turn"]` |
| 无人值守 | **`slim`** | `["unattended"]` |
| 非真人 + 99% 水位 | **`slim`** | `[]` |

**`tier` 取值域实测只有 `full` / `slim`**，`human_full` / `human_slim` / `run_full` / `run_slim` **从未被输出**。

而 `CADENCE_TIERS` 导出的却是 10 档：

```
["human_full","human_slim","run_full","run_slim","post_compact","handoff_carry","hang_compensate","legacy","full","slim"]
```

## 三、两个缺口

### P0-1：`tier` 是帧节奏值，不是内容档位值 —— 声明与实现不符

- `CADENCE_TIERS` 声明 10 档，实现只输出 2 档；
- B 批接线时若把 `tier` 直接当八档用，会得到 `full`/`slim` 两个**非法内容档**；
- 若一律映射 `full → human_full`，则**无人值守的 full 被标成人类帧**，full 豁免/预算口径全错。

### P0-2：`human_slim` 在公共模块中**不可达**

公共模块中**真人永远 full**（真人旁路优先于 fullGap 与 slim 节流），
因此 `human_slim` 永远不会产生——而生产明确存在该档。

实测：`真人 + 刚 full 过` ⇒ `tier=full`（而非 human_slim）。

## 四、裁定

### 关于 P0-1：**必须补明确输出**

公共 CA 必须额外返回二者之一（或全部）：

1. `isHuman: boolean` —— 让适配器按生产公式组合八档；
2. 直接输出 `humanFull/humanSlim/runFull/runSlim` 四象限。

**推荐 (1)**：最小改动、语义清晰，且与生产 `o.isHuman` 命名一致。

### 关于 P0-2：**需要用户裁定**

两种可能，我无法单方面决定：

| 方案 | 语义 | 与现状关系 |
|---|---|---|
| A | 真人永远 full（`human_slim` 废弃） | 保住「人说话必给完整版」，但删掉一个生产在用的档 |
| B | 真人也可 slim（`human_slim` 可达） | 与生产八档一致，但可能违背「人说话必给完整版」 |

**我倾向 B**：生产代码已经区分 `isHuman ✕ isFull` 四象限，且 `isHumanTierPre` 同时认两档，
说明设计上允许「真人但精简」。而且「真人必 full」若成立，`human_slim` 这一档在生产的全部代码都是死路径，需要单独审计。

**但这是产品语义决定，请用户裁定。**

## 五、对当前 A 批的影响

- A 批仍**不可合并**：P0-1 是接线前置条件，P0-2 影响八档完整性；
- 已落盘的 r3 六补丁**保留**（P1 真人旁路本身正确）；
- 17 项测试提案**暂不应用**，等 P0 裁定后一并处理；
- B 批继续挂起。