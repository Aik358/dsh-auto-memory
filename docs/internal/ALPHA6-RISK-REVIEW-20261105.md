# alpha.5 → alpha.6 差异与社区核实清单

> 面向社区开发者。范围：`v3.4.0-alpha.5`（`b989a5f9`）→ `v3.4.0-alpha.6`（`7d46ebb3`，preview 分支）。
> 本版**未发布到 npm**，仅供 preview 分支试用。
> 本文不按文件罗列，而是**按风险维度归类**，每条都给出可自行复算的命令。

## 0. 总量

```bash
git diff --stat b989a5f9..7d46ebb3 | tail -1
# 162 files changed, 30386 insertions(+), 671 deletions(-)
```

| 区域 | 主要变化 |
|---|---|
| `lib/` | 21 个文件，+5,312 / −228；新增 6 个模块（`hub-access` / `upgrade-{apply,draft,estimate,links,pending}`）|
| `lib/client.js` | +1,759 / −114（升级向导三页 UI + 双版互达）|
| `skins/` | 4 个文件（身份轮询签名修复）|
| `tests/` | 19 个新套件 + 假绿防线 |
| `site/` `.github/` | 官网改版、issue 模板 |

---

## 1. 高风险：**默认行为变更**（老用户会感到不同）

### 1.1 升级子代理超时：600 秒 → **无限**

```bash
grep -n "UPGRADE_SUBAGENT_TIMEOUT_MS" lib/index.js
# :697  const UPGRADE_SUBAGENT_TIMEOUT_MS = Number.POSITIVE_INFINITY
```

**原行为**：记忆整理向导里的子代理跑满 **600,000ms** 被强制掐断，实测 `finishedAt-startedAt = 600,435ms`，**内容被砍成空串**但向导仍报成功。

**现行为**：不设超时，子代理按自己节奏跑完。

**请核实**：
- 大库（几百条记忆）整理时，单次可能跑很久，是否可接受？
- 是否需要保留一个**用户可配**的上限，而不是干脆无限？

### 1.2 记忆"旧格式"判定收窄（`legacy = !anchors`）

```bash
sed -n '570,580p' lib/rules-layer.js
```

**原判据**：四条全满足才判 legacy（无锚点 + 无 status 行 + …）。
**现判据**：**只看「无锚点」**，status 行降为 advisory。

**理由**（实测）：status 行只由 `memory-writer.js` 为**新追加记录**写入，全库没有「给存量已锚定条目回填 status」的路径 ⇒ 把 status 缺失当旧格式会把大量正常库误判。

**请核实**：有自建迁移脚本的开发者，若依赖旧的"四条全满足"语义，行为会变。

---

## 2. 高风险：**用户可感范围变化**

### 2.1 升级向导的「范围选择」从空壳变成真生效

```bash
grep -n "resolveUpgradeScopeRowsPre" lib/index.js | head -3
```

**原状**：界面选「仅当前工作区」，后端**零读取** `workspaceKeys`，实际整理**全部**工作区。

**现状**：真按所选范围过滤；提示词同步写明「其余 N 个区不在本次范围，不要去扫、不要报成遗漏」。

**请核实**：
- 此前依赖"选什么都整理全部"的用户，现在**真的只整理所选**。
- 逐区进度仍是**清单级**（`perWorkspace` 写的是"纳入范围+整批终态"），**没有**逐区完成时间 —— UI 文案不得暗示实时逐区进度。

### 2.2 团队模式 + 旧格式库：弹窗归属改了

两个弹窗（团队卡片 / 三页向导）此前会**同时弹出、遮罩重叠**。现在由 `upgradeSurfaceOwnerPre` 单点裁决。

**请核实**：团队用户在 `running` 态重新开跑时，前台会切回向导（卡片展示的是上一轮过期结果）。这个优先级判断是否符合你的直觉。

---

## 3. 中风险：**安全 / 权限路径**

### 3.1 跨工作区写权限矩阵（新模块）

```bash
cat lib/hub-access.js
```

新增 `WRITE_DENY`：`NO_BOUND`（会话未绑定）/ `NOT_HUB`（非中枢）/ `NOT_IN_SCOPE`（不在允许清单）。

**请核实**：任何**自建工具**或**脚本直接调用记忆写入**的路径，若没走会话绑定，现在会被拒。这是有意的收紧，但会影响外部集成。

### 3.2 握手免验签收窄 + `plain_token` 签名前校验（#531）

**请核实**：若你有**自己实现的团队节点**（非本仓 `team-transport`），握手协议的这一处收紧可能不兼容。建议先跑 `smoke-test-a03-team-get-gate`。

### 3.3 响应体上限改为**流式**读取（#534）

```bash
grep -n "readBoundedText\|readBoundedBytes" lib/*.js | head -5
```

**原状**：`response.text()` 之后才判大小 ⇒ 上限等于没设（超大响应已经全读进内存）。
**现状**：读取阶段就限流，超限 `cancel()`。

**请核实**：超限时返回的是**截断**还是**报错**，是否符合你的调用方预期。

---

## 4. 中风险：**注入面内容变化**（影响模型行为，不易察觉）

本版在提示词里新增了 **45 行**含强制措辞（必须/禁止/不要）的行（「必须 / 禁止 / 不要」）。

```bash
git diff b989a5f9..7d46ebb3 -- lib/index.js lib/migration-prompt.js | grep -cE "^\+.*(必须|禁止|不要)"
```

**请核实**：如果你观察到自己环境里模型行为有变（更容易拒绝、更啰嗦、更少主动扩展），先怀疑这里。

同时确认：**注入面分档未变**（首帧完整 / 次帧精简的节流阈值仍是 `snapshotMinGapRounds=20`）。

---

## 5. 低风险但请留意

| 项 | 说明 | 复算 |
|---|---|---|
| `#543` `memory_log` 话题归属 | 不传 `eventId` 时按话题匹配（阈值 0.34），**匹配不上就新建事件** —— 此前是挂到最近事件 | `grep -n "0.34" lib/index.js` |
| `#523` `inflightIds` 参数名 | 此前写侧 `inflightJobIds`、读侧 `inflightIds` 不一致 ⇒ 在跑任务被判孤儿并**重启**（重复执行） | `grep -n "inflightIds" lib/team-baseline.js` |
| `#528` 团队同步字段 | `skills`/`outcomes` 双向对称 | `smoke-test-a03-team-get-gate` |
| `#529` append 重放检测 | 提到 `closed` 检查之前（修同步游标堵塞） | `smoke-test-issue347-evidence-retention` |
| 前端身份轮询签名 | 旧版把字符串当函数调用 ⇒ TypeError 被 try/catch **静默吞掉**，setter 实际 0 次、页面停在旧数据 | `node tests/smoke/smoke-test-upgrade-wizard-client.mjs` |

---

## 6. 本版**未**包含（已裁定延后）

| 项 | 原因 |
|---|---|
| PR #522（接续仪式有界重试）| 需先在 alpha.7 处理 `partial:true` 无消费者的语义问题 |
| PR #475（tier0 观测）| 新功能，非修 bug |
| `autoContinueRefreshAttempts` 设置 UI | 依赖 #522 |

---

## 7. 已知限制（诚实披露）

- **全部修复未经真实用户实机反馈**，只有自动化套件 + 本机手工验证。
- **`--jobs=8` 并行回归存在并发假红**：同一提交下会不稳定出现 1 条失败（实测命中过 `issue207-processes`、`v4-u6-memory-upgrade`、`issue347`、`m78-host`，全部单跑 3 次 EXIT=0）。**`--jobs=3/4` 稳定 568 PASS / 0 FAIL**。这是运行器层面的既有问题。
- **`v3314-continuation-timeout` 单跑 161s**，直接决定全量回归墙钟下限。

---

## 如何自己复核

```bash
git fetch origin preview
git diff --stat v3.4.0-alpha.5..origin/preview
node tools/run-smoke.mjs --jobs=3 --timeout=300000   # 期望 568 PASS / 0 FAIL
```

发现问题请直接开 issue 并引用本条清单的编号（如「§1.1 超时改无限」），便于定位。
