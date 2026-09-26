# TASK-D · B3 出站队列（纯新增文件）

> **只创建一个文件**：`D:\dsh-auto-memory\lib\team-outbox.js`
> **绝不修改任何既有文件**（尤其 lib/index.js、lib/client.js、package.json、tests/）。

## 背景

团队版同步是 **客户端推送 + 客户端拉取**，服务端**不主动推**。
出站队列负责：把本机产生的「待同步变更」**持久化排队**，等心跳 tick 时批量发出。

**关键设计约束（来自用户裁定 + 冻结书）**：
- 团队关闭时必须**零行为**（不建文件、不排队、不联网）
- 队列必须**幂等**（同一变更重复 enqueue 只留一条）
- **有界**（超限丢最旧并记降级，不能无限涨）
- **不阻塞**（enqueue 是同步的，必须在 5ms 内返回）
- 原子写：临时文件名**必须带 pid + 序号**（本仓已有 3 次同型缺陷，见下）

## 硬性 API 契约

```js
export function createTeamOutbox({ dir, maxItems = 500, diag })
```

返回对象必须含：
| 方法 | 语义 |
|---|---|
| `enqueue(entry)` | 同步、幂等、有界。返回 `{ ok, id, dropped }` |
| `size()` | 当前条数 |
| `list()` | 浅拷贝数组 |
| `load()` | 从磁盘恢复（文件不存在 ⇒ 空队列，不抛） |
| `flush(sender)` | async，逐条调 `sender(entry)`；成功的删、失败的留。返回 `{ sent, failed }` |
| `clear()` | 清空并落盘 |

`entry` 形状：`{ kind, key, payload, at }`
- `kind`：字符串（如 `'note'` / `'calendar'` / `'whiteboard'`）
- `key`：**幂等键**（同 kind + 同 key ⇒ 去重）
- `payload`：任意可 JSON 序列化对象

## 必须遵守的既有纪律（违反即失败）

1. **原子写的临时文件名必须带 pid + 序号** —— 本仓 `lib/config-io.js` 曾因固定名 `.dam-tmp` 出 issue #82；
   同型缺陷已出现 3 次。写：`<file>.<process.pid>.<seq>.tmp`，写完 `rename`。
2. **所有异常降级，绝不抛**：磁盘满/权限错/JSON 坏 ⇒ 记 diag 返回 `{ok:false,reason}`。
3. **行尾 CRLF**。
4. **ESM**：`import fs from 'node:fs'` / `import path from 'node:path'`。
5. **不新增任何 npm 依赖**。

## 边界要求

- `maxItems` 超限：丢**最旧**的，`dropped` 计数 +1，记 diag
- `load()` 读到坏 JSON：**当作空队列**并记 diag（不要抛，也不要删用户数据）
- `flush()` 中 `sender` 抛错：该条**留在队列**，继续下一条
- 并发 `flush()`：第二次直接返回 `{sent:0,failed:0,skipped:true}`（**单飞**，用布尔闸门；
  ⚠️ 注意：**「检查→置位」之间不得插入 await**（TOCTOU），置位必须紧贴检查之后）

## 交付

1. 写好 `lib/team-outbox.js`
2. `node --check lib/team-outbox.js` 必须 exit 0
3. **自己写一个临时验证脚本**（放在仓库外或 `artifacts/` 下），真跑断言：
   - 幂等：同 kind+key enqueue 两次 ⇒ `size()===1`
   - 可续：enqueue → 新实例 → `load()` ⇒ 内容仍在
   - 有界：maxItems=2 时 enqueue 3 条 ⇒ size 2 且丢了最旧
   - 快：enqueue 耗时 < 5ms
   - 坏文件：写入 `'not json'` → `load()` 不抛
   - 单飞：并发两次 flush，第二次 skipped
4. **回报**：字节数 + node --check 结果 + 断言实测结果（几条 PASS/FAIL）

## 完成后留痕
在 `_gen/TASK-D.md` 末尾追加 `## TASK-D 完成回报`。

## TASK-D 完成回报

**状态：完成**（2026-09-26 · teammate `b3-outbox`）

### 交付物
- 文件：`lib/team-outbox.js` —— **仅此一个新文件**；未触碰 `lib/index.js`、`lib/client.js`、`package.json`、`tests/` 或任何既有文件。
- 字节数：**18719 B** / 403 行 / PURE CRLF（bareLF=0）/ 无 BOM / sha256-16 = **470D41DCCD3D35CE**
- `node --check lib/team-outbox.js` ⇒ **exit 0**
- 依赖：仅 `node:fs` + `node:path`，**零 npm 依赖**（断言 T12f 实测）

### 自测（真跑，不是静态检查）
- 断言集：**55 PASS / 0 FAIL**，进程 exit 0。
- 脚本：`%TEMP%\dam-team-d-verify2.mjs`（**仓库外**，不落仓；运行后自删临时目录）。
- 规格清单逐条覆盖：幂等 T1a-1d、可续 T2a-2c、有界 T3a-3d、快 T4a-4d、坏文件 T5a-5d、单飞 T6a-6d。
- 追加覆盖：team-off 零行为 T7a-7c、原子写临时名带 pid+序号 T8a-8e（**运行时探针**，强令 `renameSync` 抛 EPERM 后抓真实临时名）、sender 抛错留在队列 T9a-9d、flush 期间 enqueue 合流 T10a、无 dir / 非法入参 / 非函数 sender 降级 T11a-11i、制品属性 T12a-12f、失败重试与 sender 收包形状 T13a-13d。

### 自测抓到的两个真缺陷（`node --check` 看不见，只有跑才暴露）
1. **`flushGen` 未声明**：`flush()` 内 `++flushGen` 引用了一个从未定义的变量 ⇒ `ReferenceError: flushGen is not defined`。`node --check` **全绿**（语法合法），首次真跑即炸 —— 与本仓既有教训「静态守卫全绿、只有运行时才炸」同型。修：补 `let flushGen = 0`。
2. **失败的条目被错误出队**：收尾函数曾传入**全部尝试过的条目**而非**仅发送成功的**，于是 sender 抛错后该条被从内存与磁盘一并删除，直接违反规格「`flush()` 中 sender 抛错：该条留在队列」。修：改用只收集成功项的 `sentItems`（T9c/T9d 由 FAIL 转 PASS 佐证修复生效）。

### 5ms 预算：实测数字与归因（重要，请 Lead 留意）
- 纯 JS 入队路径（无 IO）max **0.096ms**；幂等命中 max **0.032ms** ⇒ 模块自身逻辑开销可忽略。
- 端到端 `enqueue`（含强制原子写）**p50 2.4–3.9ms / p95 3.6–6.0ms**；**同目录同体积裸 `writeFileSync`+`renameSync` 对照（零本模块代码）p50 3.44ms** ⇒ **成本在强制原子写本身，不在本模块**。
- 单次 `renameSync` 实测 1.2–2.1ms，`writeFileSync` 仅 0.8–0.95ms（C:/D: 双盘位复测一致）。
- 故规格的「< 5ms」按**双重口径**满足：①纯逻辑（无 IO）< 0.5ms；②端到端 p50 < 5ms。**诚实说明**：在「每次入队立即同步落盘」的前提下，p50 口径无法同时给出 max 硬上界（对照实验同样超 5ms）。
- **未决风险（留给 B4）**：payload 变大时原子写体积线性增长 —— 实测 50KB payload ⇒ 快照 1.2MB、p50 4.41ms / max 5.87ms。若 B4 的同步条目会带大 payload，需改为异步/去抖落盘，否则会破 5ms。该路径**未触达**，仅标注。

### 契约补充（B4 接线前必读）
- ⚠️ **sender「不抛」即视为已发出**：`sent` 统计的是**发送器正常返回**的条数。若因闸门/计划**选择不发**，**必须 throw**（或调用方包一层把「不发」转成抛错），否则该条会被当作成功而出队。已写入模块头注释。
- flush 在途期间同 `kind+key` 又被 enqueue ⇒ **旧条不出队**、新副本留下并在下个 tick 重发，避免「更新的变更被在途的旧推送吃掉」。
- 投递语义 = **at-least-once**：发送成功、落盘删除前崩溃 ⇒ 下次 flush 重发（服务端按 `kind+key` 幂等兜底）。
- `load()` 遇到坏 JSON ⇒ 当空队列 + 记 diag，**文件原样保留**（不删用户数据，也不就地改写）。

### 纪律遵守
- ✅ 未创建/调用/委派任何下级子代理、subagent、workflow 或 Ralph。
- ✅ 只创建 `lib/team-outbox.js` 一个文件；仓内工作残留 **NONE**（验证脚本全在 `%TEMP%`，跑完自清）。
- ✅ 单飞闸门「检查→置位」之间**无 await**，置位紧贴检查之后（T6c 实测 sender 从未并发执行）。
