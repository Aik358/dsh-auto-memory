# 后续待办 · #425 前端预览期缺「祖先阻塞」说明（2026-10-17）

## 发现（tier0-fixer 只读取证，非推断）

#425 的安全修复**已完整**（计划层 + 写入链双层拦截，根外文件实测不存在），但**前端未消费** `plan.blockedByAncestor`：

```
后端（已透传，实测）:
  view.ok                    = true           ← 预览只读，本身不该失败
  view.plan.ok               = false          ← ★ 计划层如实报"不可写"
  view.plan.blockedByAncestor= [{path:'linkdir/PLAN.md', ancestor:'linkdir', kind:'link-outside'}]
  view.plan.errors           = ['ancestor-not-writable:linkdir/PLAN.md(linkdir:link-outside)']

前端（未消费）:
  grep blockedByAncestor lib/client.js = 0 命中
  预览成功分支只判 j.ok（client.js:7601-7613，另 12624/15936 两处镜像同形）
```

## 用户实际会看到什么

| 阶段 | 表现 |
|---|---|
| **预览期** | 提示语 **「预览 ✓ …」**（正的）；计划面板里一行 `警告: path-changed \| nothing-to-write \| ancestor-blocked`（**原始码，无人话解释，无路径清单**）；`plan.errors` 完全不渲染 |
| **导入期** | `migFail` 拼 error+errors ⇒ 用户看到 `ancestor-not-writable:linkdir/PLAN.md(linkdir:link-outside)` |

## 定性

| 维度 | 判定 |
|---|---|
| 数据安全 | ✅ **无缺口**（双层拦截生效，a05 的 E1/E7/E8 三次物理证据） |
| 完全静默 | ❌ 不成立（有 warning 码 + 导入期带路径错误串） |
| 预览期可读性 | ⚠️ **不足** —— 用户要先点导入才知道「哪几条路径、为什么」；「预览 ✓」措辞会误导 |

## 建议改法（二选一）

- **(a) 映射人话**（最小）：i18n 表加 `ancestor-blocked` ⇒ 「N 条路径因上级是根外链接/不可用条目被拦下」。拿不到路径清单。
- **(b) 渲染清单**（推荐）：计划面板 warnings 行之前插一行，条件 `(plan.blockedByAncestor||[]).length`：
  `⚠ N 条路径不可写（祖先为 <kind>）：<path> · <path> …`，并把 `migNote` 从「预览 ✓」改成条件文案。

## ★改前须知（前端三面纪律）

涉及四个面，改完必须 `build-iter5-skin --check` = SYNC-OK + 重钉 iter5 指纹锁：

| 面 | 位置 |
|---|---|
| 经典手写区 | `client.js:7601-7613`（逻辑）、`7714-7729`（渲染） |
| v4 生成区 | `client.js:12624-12650` / `12735-12750`（由 `StorageTab` 切片带出） |
| v4 生成区 | `client.js:15936-15960` |
| 冻结旧款 | `skins/legacy/iter5-325.js.frozen` 对应段 |

⇒ **建议单独立批，不混进 #425 的 bug 修复批**。

## 归口
- 不在本批（A01–A24）范围：本批只修「能写到根外」这个安全缺陷，已修完。
- 记入 3.3.5 或后续 UX 批次。
