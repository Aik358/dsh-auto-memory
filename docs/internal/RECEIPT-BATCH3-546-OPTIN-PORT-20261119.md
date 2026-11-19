# 批次3 · #546 后半截移植（迁移 opt-in UI 接线）回执 · 2026-11-19

性质：把 PR #546 未合入 HEAD 的后半截（`7188203e`）**搬进生成源**后重建产物，而不是改 `lib/client.js` 产物。用户裁定：「要」，判据 = 套件 37/0 + `--check --strict` SYNC-OK + 三面文案一致。

## 0. 结论（三判据全过）

| 判据 | 结果 |
|---|---|
| `smoke-test-migration-optin-compat` | **37 PASS / 0 FAIL**（原 30/7） |
| `build-iter5-skin --check --strict` | **SYNC-OK: sources × generator == lib/client.js** |
| `lib/client.js` 三面一致 | 6 请求点 / 3 确认状态 / 3 勾选框 / 1 份 HELPER，全部命中（见 §2） |
| 全量回归 | **PASS 644 / FAIL 0 / TIMEOUT 0 / FLAKY 0**（329.5s） |
| verify-docs | VDEXIT=0，全部一致 |

## 1. 移植路径（源 → 生成器 → 产物）

`lib/client.js` 是「源 + 产物」同体：手写区是源，两对生成区标记之间的内容每次 `build-iter5-skin` 都会被重算。因此**任何只在产物里的接线都会在一次重建后消失**。这次的落点：

| 面 | 落点（源） | 处理 |
|---|---|---|
| HELPER（`globalThis.__damMigrationOptIn`） | `lib/client.js` 顶部手写区 | 从 `lib/migration-optin-contract.js` 的 HELPER 区间**程序化取出**并 CRLF 化后内联（52 行 / +1,611 B）；C6b 逐字守护防漂移 |
| 经典 StorageTab | `lib/client.js` 手写区（`function StorageTab`…`function NotesTab` 切片内） | 3 行确认状态 + 2 个请求点包 `Object.assign({...}, body(migPack, migConfirmedLegacyPack))` + 1 个勾选框 |
| 旧款皮肤面 | `skins/legacy/iter5-325.js.frozen`（LF） | 同样的三处（生成器包 IIFE 时统一 +2 缩进） |
| 变体十屏面 | 由生成器 `storage` 切片从经典源派生 | 自动继承；**seam 从「整段 apiPost」改为「只替换 onConflict 的值」**（源变 `Object.assign` 形态后旧锚点消失会硬停） |
| `Iter5Migration` 共享组件 | `skins/iter5/native-storage.js` | 工具栏下加勾选框，读 `props.confirmedLegacyPack` / `props.setConfirmedLegacyPack` |
| 大屏页 props 透传 | `tools/build-iter5-skin.mjs` 的 `migRows` 模板 | 加 `confirmedLegacyPack` / `setConfirmedLegacyPack` 两项 |

## 2. 三面一致的复算证据

```
lib/client.js:
  __damMigrationOptIn.required()        → 3 处（三面各 1）
  data-dam-migration: 'legacy-opt-in'   → 3 处（三面各 1）
  var migConfirmedLegacyPackPair        → 3 处（三面各 1）
  migrateInspect/Import 走 body(...)    → 6 处（三面 × 预览/导入）
  /* === HELPER-BEGIN === */            → 1 处（唯一，无重复定义）

落点行号（改后）：经典 13285/13306/13439 · 旧款 18932/18953/19051 · 变体 22054（组件）+ 23652/23673
```

`node tools/apply-migration-optin.mjs --dry-run` 的独立幂等校验：`{"requestsWithBody":6,"boxes":3,"states":3,"unconditionalTrue":0,"helperInline":true,"helperUnique":1,"syntax":true,"ok":true}` ⇒ 与手工移植结果**同一形态**（该工具现在对当前树报 `NOOP_ALREADY_PATCHED`，不再是修复者，只作交叉校验）。

## 3. 附带的必要改动（都是「源变了 ⇒ 守卫/基线必须跟上」）

1. **`tests/smoke/smoke-test-migrate-host-wiring.mjs` 整文件取 `7188203e` 版**（40/0）。依据：其工作树 blob 与 `7188203e^` **逐字节相同**（`dc25ee4b`），所以是干净前向移植，不是三方合并。新增 H6 组 16 条：6 处接线 + 不得无条件传 true + 3 勾选框 + 3 状态 + 中英文案 + 「勾选写包路径而非布尔」+ 后端路由透传 + 四种契约状态真执行。
2. **`tests/smoke/smoke-test-iter5-skin.mjs` 重钉 R196**：classicLF `1,555,333 → 1,557,861` 字符 / `19743d1e… → c8ed05c1…`。归因已写进套件注释（四处改动全在经典侧；SYNC-OK 证明生成区与源一致）。

## 4. 物理量

| 文件 | 字节 | 行 | sha16 |
|---|---|---|---|
| `lib/client.js` | 3,038,864（+4,889） | 27,353（+73） | `9154599dd272c142` |
| `lib/index.js` | 2,214,208（**不变**） | 30,415 | `89bcc7e8e38c76b9` |
| `skins/legacy/iter5-325.js.frozen` | 361,809 | 2,579 | `fd7e35913f39f05f` |
| `skins/iter5/native-storage.js` | 10,478 | 72 | `1f566f51cda34ecf` |
| `tools/build-iter5-skin.mjs` | 85,642 | 966 | `ec240b20b38de9d8` |
| `tests/smoke/smoke-test-iter5-skin.mjs` | 133,809 | 1,108 | `1f56231b8703e7b8` |
| `tests/smoke/smoke-test-migrate-host-wiring.mjs` | 12,363 | 185 | `f73e70cf220967b8` |
| `lib/migration-optin-contract.js` | 4,271（**不变**） | 103 | `a592161840d08676` |

行尾纪律：`lib/client.js` = **纯 CRLF 27,353 / bareLF 0**；`git -c core.whitespace=cr-at-eol diff --check` = exit 0；`node --check` = exit 0。

## 5. 安全边界（这次放开的到底是什么）

放开的是 `lib/migrate-pack.js:288` 的 fail-closed 分支：v3.1.3–3.3.4 产出的历史包里，`userFiles`（含**用户日历**）没有逐文件校验和，旧版本会在**预览阶段**就拒掉（`userfiles-unproven-by-checksum`），用户连「确认导入」都到不了。

现在的行为：
- 默认 `allowUnprovenUserFiles=false`（fail-closed 不变）；
- 勾选框写入的是**当前包路径**而不是布尔 ⇒ 换包自动失效（`body(P,'')=false`、`body(Q,P)=false` 有断言）；
- 契约层 `required()` 由后端 `capabilities` 协商：后端不再需要显式确认时，**彻底不发该字段、也不渲染勾选框**（C3/C2 组断言）；
- 界面文案中英并列，明说「用户级文件（如日历）未被摘要保护」。

## 6. 未验证 / 未做

1. **未在真实宿主里点过这个勾选框**（隔离宿主有该 UI 但未做端到端迁移导入）。真实判定依赖后端路由（`lib/index.js:29012 / :29038` 已透传，未改动）。
2. **未随版本发布**；工作树仍未提交（HEAD `96bfded8`）。
3. `tools/apply-migration-optin.mjs` 保留为**交叉校验器**（对当前树恒为 NOOP）；它已不是修复路径，如果将来有人再跑它去改产物，生成器会再次硬停。
