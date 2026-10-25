# 全量回归终态（我实跑）· 2026-10-25 00:12

## 结果

```
PASS 455 / FAIL 4 / TIMEOUT 0   (166.3s)
```

**对比轨迹**：起点 439/10/1（C 线报）→ 我实跑 450/9/0 → **现在 455/4/0**。
**净改善**：+16 PASS / -6 FAIL / -1 TIMEOUT。

## 4 个失败逐个归因

| # | 套件 | 原因 | 归属 | 处置 |
|---|---|---|---|---|
| 1 | `smoke-test-i332-write-contract` | `⑦ 变异后③的失败回执消失 ⇒ ③确有鉴别力（非恒真）` —— **变异判据失效** | 🔴 **A 线** | 需查：H2 改动是否影响该变异注入点 |
| 2 | `smoke-test-p23-wb-sidecar` | `M8 legacy 默认零行为: P3 工具注册闸门(读 engine.config)` | 🟡 **判据过期** | H0 已把闸门解耦，该断言守的是旧行为 ⇒ 改判据 |
| 3 | `smoke-test-r26-cross-layer` | `R129` 宿主 `index.js` 基线锁（归一化 sha 变化） | 🟡 **判据过期** | A 线 5 步改动累积 ⇒ 按 2026-10-01 裁定重钉 |
| 4 | `smoke-test-issue164-plan-processes` | `ERR_INVALID_ARG_TYPE: path must be string, received undefined`（L18 `readFile`） | 🔴 **需查** | 疑似 H2 改了 plan 相关路径 |

**归类：2 条需查（都可能与 H2 相关）+ 2 条判据过期。**

## 关键判断

**没有一条是「H1 写入层」或「event-store 字段」引入的** —— 那两块我验过（75 PASS / 契约 25/0 / 变异闭环）。
4 条里 2 条是 H2（memory_note 改 plan/handoff 分支）可能引入，2 条是 H0 判据过期。

## 已确认无问题的项（我亲自验过）

| 项 | 结果 |
|---|---|
| `verify-docs` | **全部一致**（工具 20/20） |
| `check-write-contract-await` | **36 host writer calls 通过** |
| `smoke-test-handoff` | **66/0** |
| `smoke-test-graph-mode` | **38/0** |
| `smoke-test-p6b-rules-kind` | **21/21** |
| `smoke-test-v4-h4-eventstore-percept` | **75/0** |
| 我的独立负路径（plan 镜像漂移） | ✅ 漂移被捕获 + 诊断记录 + 0 写原语 |
| 我的独立变异（H0 闸门加回） | ✅ 5 条全红，还原 sha 逐字节一致 |

## 下一步

1. A 线查 `i332` 与 `issue164`（都在 `index.js` 写域）
2. A 线重钉 `r26` 基线锁（按裁定 + 写演进原因）
3. `p23` 判据过期：H0 已解耦，改判据
4. 全绿后再标 task-7 complete
