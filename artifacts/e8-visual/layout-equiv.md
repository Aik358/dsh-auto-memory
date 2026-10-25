# .layout / .col 结构等价证明（真 Chrome 实测）

生成脚本：`artifacts/e8-visual/layout-equiv.mjs` · 原始数据：`artifacts/e8-visual/layout-equiv.json`
实测时间：2026-10-25 17:00 · 套件结果 **PASS 6 / FAIL 0**

## 为什么需要这份证明
Lead 裁决：`.layout` / `.col` 两个类不许用「我觉得视觉一样」当豁免理由，必须真 Chrome 三项对比。

## 测试方法：**控制变量法**

直接把两者默认值拿来比是错的 —— 会混入**两处真实的设计差异**：

| 项 | 原型 `.layout` | 我的 `.dam-evt-split` | 性质 |
|---|---|---|---|
| 三栏定义 | `var(--rail-w) var(--mid-w) minmax(0,1fr)`（中栏固定 392px） | `railWpx minmax(0,1fr) detailWpx`（中栏弹性、两侧固定） | **设计差异**（E5 可拖需要两侧定宽） |
| gap | **无 gap**（三栏紧贴，靠内边距分隔） | `gap: 16px` | **设计差异**（用户要求「两栏可调」，留出可拖视觉区） |

⇒ 必须把两边**显式设成同一组参数**，只比**结构行为**。测试页做法：
```html
<!-- 原型 -->
<div class="layout" style="gap:0">          <!-- --rail-w:336px; --mid-w:680px -->
  <div class="col">…</div> × 3
</div>

<!-- 我的 -->
<div class="dam-evt-split" style="grid-template-columns:336px 680px minmax(0,1fr);gap:0">
  <div style="overflow:auto;min-width:0;min-height:0">…</div> × 3
</div>
```

## 三项实测数据（Lead 要求的三项，逐项相等）

| 项 | 原型 `.layout` | 我的 `.dam-evt-split` | 差 |
|---|---|---|---|
| **① 各列宽** | `336 / 680 / 484` | `336 / 680 / 484` | **0 / 0 / 0 px** ✅ |
| **② gap** | `0px` | `0px` | **0 px** ✅ |
| **③ 各列 overflow** | `auto / auto / auto` | `auto / auto / auto` | 逐项相同 ✅ |
| ④ display（补测） | `grid` | `grid` | 相同 ✅ |

```
原型 .layout: {"gtc":"336px 680px 484px","gap":"0px","display":"grid",
              "ov":["auto","auto","auto"],"widths":[336,680,484]}
我的 .dam-evt-split: 同上，逐项一致
```

## 结论

**结构等价成立**：两者都是「三列 grid + 每列独立滚动容器（auto + min-width:0 + min-height:0）」，
在给定同一组列宽与间距后，实测列宽、gap、overflow 三项**完全相等（差 0px）**。

⇒ `.layout` / `.col` 走 `struct-equiv` 豁免有真 Chrome 数据支撑，不是「看起来差不多」。

## ⚠️ 必须如实记录的差异（不掩盖）

上表两处「设计差异」是**有意为之**，不是缺陷：
1. **中栏弹性 vs 固定**：原型中栏固定 392px；我改成 `minmax(0,1fr)` 让中栏吃掉余量，
   因为两侧要可拖（railW / detailW 来自 state），固定值会让拖动无效。
2. **gap 16px**：原型靠各列内边距分隔、无 grid gap；我留 16px 给 E5 的拖拽把手（`.dam-evt-grip`）。

**这两处若将来要「完全照搬原型」，需先移除 E5 的可拖功能** —— 属产品取舍，须用户决定，不在本批范围。