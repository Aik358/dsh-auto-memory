# E8 删除记录（第三批：demo 专属规则）

Lead 裁决：`.demo-*` 不是「本期没做」，而是「本插件根本不需要」—— 白名单是放「有计划但没做」的，不能放「不需要的」。

## 删除清单（共 15 行 / 4 个类）

| 类 | 规则数 | 为什么删 |
|---|
| `.demo-switch` | 8 | 原型「演示模式」开关（切 fixtures / concurrent-demo.json）。本插件是真实产品，不该有并发演示开关 |
| `.demo-banner` | 3 | demo 专属横幅（h3 / p），同上 |
| `.demo-tag` | 1 | demo 徽标 |
| `.demo-stat` | 3 | demo 统计条 |

> 注：`.demo-rail` **保留**（已补进 DOM，是真实 demo 事件的 tick 样式，属第一批补 DOM 范围）。

## 验证

```
删除前备份：lib/client.js.bak-e8b-1792918855664
删除行数：15
grep -c "demo-switch|demo-banner|demo-tag|demo-stat" lib/client.js  →  0
node --check lib/client.js  →  OK
bareLF  →  0
```