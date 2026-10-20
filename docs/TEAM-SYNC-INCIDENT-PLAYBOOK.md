# 团队同步服务端爆炸处置手册（records.jsonl 12GB / 进程 RSS 29GB）

> **适用版本**：客户端 v3.3.12 起（本手册随该版本发布）。
> **面向读者**：自己搭了团队同步服务端、运行 dsh-auto-memory 团队版的人。
> **一句话**：**先把服务端停下来止血，再升级客户端，最后改服务端三处，不要先动数据文件。**

---

## 0. 先判断你遇到的是不是这个问题

按顺序看，命中 2 条以上基本就是：

| 现象 | 怎么查 | 是这个问题时的样子 |
|---|---|---|
| 服务端数据文件单调变大 | `ls -lh /path/store/records.jsonl`，隔 10 分钟再看 | 只增不减，涨速和客户端数量相关 |
| 服务端进程内存远大于文件 | `ps -o rss= -p <pid>`（KB）与文件大小比 | RSS ≈ 文件的 2~2.5 倍（12GB 文件 → 29GB 常驻） |
| 客户端侧看不出任何报错 | 面板「团队」页看同步状态 | 一直显示同步中/无异常，但服务端仍在膨胀 |
| 服务端日志里大量请求 | 数 `/v1/changes` 或 `api/team/sync/push` 的条数 | 每台客户端**每 5 秒**一次，且 `since` 参数**永远是 0** |

**关键判据**：服务端日志里 `since=0` 反复出现 —— 这就是「游标卡死」，是本问题的核心。

---

## 1. 止血（5 分钟，先做这个）

**顺序很重要：先停服务端，再动客户端。** 反过来会让客户端在服务端不在时继续排队重试。

### 1.1 停服务端

```bash
# 你当初怎么起的就怎么停（systemd / pm2 / 裸 node 都行）
systemctl stop team-server        # 或
pm2 stop team-server              # 或
kill <pid>
```

### 1.2 停客户端同步

每台客户端上都做（**两台电脑都要做**）：

- 打开 DSH → 插件设置 → **团队** 分区 → 把「启用团队同步」**关掉**（`teamEnabled = false`）。
- 关掉后客户端**零行为**：不建定时器、不联网、不读盘。可以先安全地处理服务端。

> ⚠️ 只关一台没用：另一台仍会每 5 秒打一次。

### 1.3 备份，但**不要**先删数据

```bash
cp /path/store/records.jsonl /path/store/records.jsonl.bak-$(date +%Y%m%d)
```

**为什么先不删**：现在删了，升级后的客户端会从 `since=0` 重新拉一遍 —— 如果服务端还是旧实现，会再炸一次。**先把服务端改对，再决定清不清。**

---

## 2. 升级客户端（新版才带这些修复）

```bash
npm i -g @a9i5k4/dsh-auto-memory@latest
```

或在 DSH 插件市场里更新。**必须重启 DSH**（插件是宿主进程内加载的，不重启不生效）。

升级后每台客户端会多两个配置项（默认值即安全值，通常不用改）：

| 配置键 | 默认 | 作用 |
|---|---|---|
| `teamPullPageLimit` | `200` | 每次拉取的条数上限（拼成 `&limit=`）。服务端不认就忽略，老服务端零影响 |
| `teamPushPath` | 空（= `api/team/sync/push`） | 上行端点路径。照 04 卷文档实现服务端的人把它设成 `v1/apply` |

**升级后客户端会做什么**（这是我们改的部分）：

1. **推送体带幂等键** `idemKey`（值 = outbox 里持久化的 `eventId`，没有则回退 `kind|key`）⇒ 服务端终于有东西可比对，可以 UPSERT 而不是 append。
2. **游标认字符串**（`c_0001250` 这种）也认数字 ⇒ 不再因为 `Number('c_0001250')` = NaN 而永远 `since=0`。
3. **游标落盘**（`~/.dsh/memory/team/pull-cursor.json`）⇒ 重启不再归零重拉全史。
4. **服务端回抛我方没请求的 kind 时不再卡死**（旧实现会让游标永久不动，形成每 5 秒重拉全史的活锁）。
5. **响应体上限 32MB** ⇒ 服务端真返回超大响应时明确报 `response-too-large`，而不是把整份读进内存把自己撑爆。

---

## 3. 改服务端（三处，缺一不可）

客户端改完只解决「不再重复拉」，**服务端不改，文件仍然只增不减**。

### 3.1 上行：按 `idemKey` UPSERT，不要 append

客户端现在发的每条变更都带 `idemKey`。服务端要做的：

```js
// 伪代码：收到 POST（api/team/sync/push 或 /v1/apply）
const { kind, key, idemKey, at, payload, member } = req.body

// ★ 关键：以 (teamId, idemKey) 为唯一键做 UPSERT
//    旧实现每条都 append ⇒ 文件单调膨胀 12GB 的直接原因
await store.upsert(
  { teamId, idemKey },              // 唯一键
  { kind, key, at, payload, member, updatedAt: Date.now() }
)
```

- 如果用的是数据库：给 `(team_id, idem_key)` 加**唯一索引**，用 `INSERT ... ON CONFLICT DO UPDATE`。
- 如果用的是 JSONL 文件：**别在原地无限 append**。要么定期 compact（同名 key 只留最新一条），要么换 SQLite（`INSERT OR REPLACE`）。

### 3.2 下行：`since` 要真的能用

客户端会发 `GET /v1/changes?since=<游标>&kinds=fact&limit=200`。

| 要求 | 说明 | 不做的后果 |
|---|---|---|
| 必须**认** `since` | 只返回该游标之后的变更 | 忽略它 = 每次都返回全量 = 现在的 12GB 事故 |
| 响应体必须带 `cursor` 字段 | 数字或字符串都行（客户端两种都认），但**必须是单调递增且可比** | 没有 `cursor` ⇒ 客户端无法前进 ⇒ 永远重拉 |
| 支持 `limit`（可选但强烈建议） | 一次最多返回 N 条 | 游标一旦失效，一次能拉回整个历史 |

响应形状：

```json
{
  "cursor": "c_0001250",
  "changes": [
    { "kind": "fact", "key": "f_123", "payload": { ... }, "member": { "id": "u_1024" } }
  ]
}
```

> **游标可以是字符串**（如 `c_0001250`），不必是数字 —— 客户端两种都接受。但**别返回 `"NaN"` / `"Infinity"`**，客户端会明确拒收（这是有意的，防止假前进）。

### 3.3 别再全量载入内存

`29GB 常驻 / 12GB 文件 ≈ 2.4 倍` 这个比值就是「把整份 JSON 解析成 JS 对象」的典型膨胀。

**不要**：
```js
const all = JSON.parse(fs.readFileSync('records.jsonl', 'utf8'))   // ← 29GB 的来源
```

**要**：
- 用 SQLite / PostgreSQL，查询带 `WHERE cursor > ?`，让数据库做增量扫描；
- 或至少用流式逐行读（`readline`），不要整份 `readFileSync + JSON.parse`；
- 如果短期内必须继续用 JSONL，**至少加个内存上限**：读满 N 条就停，剩下的等下一次 `since` 游标再来取。

---

## 4. 处理已经膨胀的数据

服务端改好、客户端升级完之后，再处理存量：

### 方案 A：保留但压缩（推荐，不丢历史）

```bash
# 按 (kind, idemKey) 去重，只保留每条的最新版本
node -e '
const fs = require("fs"), rl = require("readline");
const seen = new Map();
const f = process.argv[1];
(async () => {
  for await (const line of rl.createInterface({ input: fs.createReadStream(f) })) {
    if (!line.trim()) continue;
    let o; try { o = JSON.parse(line) } catch (_) { continue }
    const k = (o.idemKey || (o.kind + "|" + o.key));
    seen.set(k, line);                       // 后写覆盖前写 = 保留最新
  }
  const out = f + ".compact";
  fs.writeFileSync(out, [...seen.values()].join("
") + "
");
  console.log("原 " + fs.statSync(f).size + " B -> " + fs.statSync(out).size + " B, 条数 " + seen.size);
})();
' /path/store/records.jsonl
```

跑完先核对条数是否合理，再替换：

```bash
mv /path/store/records.jsonl.compact /path/store/records.jsonl
```

### 方案 B：只留近期（数据能丢就用这个，最快）

```bash
# 只留最近 7 天的记录（按 at 字段的毫秒时间戳）
node -e '
const fs = require("fs"), rl = require("readline");
const cutoff = Date.now() - 7*24*3600*1000;
const f = process.argv[1]; const out = [];
(async () => {
  for await (const line of rl.createInterface({ input: fs.createReadStream(f) })) {
    if (!line.trim()) continue;
    let o; try { o = JSON.parse(line) } catch (_) { continue }
    if ((Number(o.at) || 0) >= cutoff) out.push(line);
  }
  fs.writeFileSync(f + ".recent", out.join("
") + "
");
  console.log("保留 " + out.length + " 条，体积 " + fs.statSync(f + ".recent").size + " B");
})();
' /path/store/records.jsonl
```

⚠️ **两种方案都必须先停服务端**，否则边写边压缩会丢数据。

---

## 5. 重新开启并验收

### 5.1 顺序

1. 起服务端（改好的版本）。
2. 客户端打开「启用团队同步」。
3. **在面板点一次「重置同步游标」**（团队页 → 调试 → 重置同步游标，或 `POST /api/dsh-auto-memory/team-control {"action":"reset-cursor","confirm":true}`）—— 让新游标从干净状态开始。

### 5.2 验收：四条都要过

| 检查 | 命令 / 位置 | 通过标准 |
|---|---|---|
| ① 游标在涨 | 服务端日志看 `since=` | 第二次开始不再是 `since=0` |
| ② 文件不再单调涨 | `ls -lh records.jsonl` 隔 10 分钟对比 | 稳定或缓慢增长，且**发同一条变更两次后条数不增加** |
| ③ 内存不随文件线性涨 | `ps -o rss= -p <pid>` | 不再等于文件的 2 倍以上 |
| ④ 客户端状态可观测 | 面板团队页，或 `GET /api/dsh-auto-memory/team-state` | `pull.since` 不再是 0；`pull.cursorPersisted` 为 `true`；`pull.cursorLoops` 在涨 |

**最强的验收**：在两台机器上各改一次同一份 `MEMORY.md`，服务端 `records` 的条数**不应该因为同一条内容的重复推送而增加**。

### 5.3 出问题时的回退

- 客户端：团队页关掉「启用团队同步」，回到纯单机（**完全零行为**，不影响本机任何功能）。
- 客户端游标文件：`~/.dsh/memory/team/pull-cursor.json` 可直接删掉（等价重置）。
- 服务端：恢复第 1.3 步的 `.bak` 备份。

---

## 5.4 服务端最小参考实现（可直接照抄的 40 行）

如果你的服务端现在是「读整个 JSONL → 数组 → append」，可以直接换成下面这个骨架（Node，零依赖）：

```js
import http from 'node:http'
import { readFileSync, appendFileSync, writeFileSync } from 'node:fs'

const FILE = '/home/douni/services/team-server/store/records.jsonl'
let seq = 0                      // 单调递增的变更序号 —— 就是 cursor
const index = new Map()          // idemKey -> 最新记录（内存里只放索引，不放全量正文）
const recent = []                // 只保留最近 N 条给 since 用（滚动窗口）
const WINDOW = 5000

// 启动：流式读一遍，建立索引 + 最近窗口（不要 readFileSync 全量 parse）
for (const line of readFileSync(FILE, 'utf8').split('\n')) {
  if (!line.trim()) continue
  let o; try { o = JSON.parse(line) } catch { continue }
  seq = Math.max(seq, Number(o.seq) || 0)
  const k = o.idemKey || (o.kind + '|' + o.key)
  index.set(k, o)
  recent.push(o); if (recent.length > WINDOW) recent.shift()
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x')
  const json = (code, body) => { res.writeHead(code, {'content-type':'application/json'}); res.end(JSON.stringify(body)) }

  // ── 上行：按 idemKey UPSERT（★关键：同键不追加，只覆盖）
  if (req.method === 'POST' && url.pathname.endsWith('/sync/push')) {
    let raw = ''; req.on('data', c => raw += c)
    req.on('end', () => {
      let body; try { body = JSON.parse(raw) } catch { return json(400, {ok:false, reason:'bad-json'}) }
      const k = body.idemKey || (body.kind + '|' + body.key)
      const prev = index.get(k)
      const rec = { seq: ++seq, idemKey: k, kind: body.kind, key: body.key, payload: body.payload, member: body.member, at: Date.now() }
      index.set(k, rec); recent.push(rec); if (recent.length > WINDOW) recent.shift()
      appendFileSync(FILE, JSON.stringify(rec) + '\n')   // 追加日志，但 index 只有一条 ⇒ 语义上是覆盖
      json(200, { ok: true, cursor: 'c_' + String(seq).padStart(7,'0'), replaced: !!prev })
    })
    return
  }

  // ── 下行：认 since、给 cursor、支持 limit
  if (req.method === 'GET' && url.pathname.endsWith('/changes')) {
    const sinceRaw = url.searchParams.get('since') || '0'
    const sinceSeq = (function (v) {
      const m = /^(?:c_)?0*(\d+)$/.exec(String(v)); return m ? Number(m[1]) : 0
    })(sinceRaw)
    const limit = Math.min(Number(url.searchParams.get('limit')) || 200, 1000)
    const changes = recent.filter(r => r.seq > sinceSeq).slice(0, limit)
    return json(200, { cursor: 'c_' + String(sinceSeq + changes.length).padStart(7,'0'), changes })
  }

  json(404, { ok: false })
}).listen(19387, '0.0.0.0')
```

**这份骨架做对的四件事**（对照 §3 的三条 + 一条）：

| # | 做对了什么 | 对应事故成因 |
|---|---|---|
| 1 | `index` 按 `idemKey` 只留一条 ⇒ 同键**不增加**逻辑记录 | 「没有替换」 |
| 2 | `since` 真的参与过滤，`cursor` 一定返回且单调 | 「全打包」 |
| 3 | 启动只建**索引 + 最近窗口**，不全量 parse | 「直接炸了」 |
| 4 | `limit` 封顶 1000 | 游标失效时的兜底 |

> ⚠️ 这只是**最小可跑**骨架，**不是生产实现**：`recent` 是滚动窗口（超过 5000 条的旧游标会拉不到，需换 SQLite 才能真正增量）、没有鉴权校验、没有多租户隔离。真要长期用请按 §3.3 换成 SQLite/PostgreSQL。

---
## 6. 三个常见误解（避免走弯路）

1. **「是不是客户端在上传我的文件内容？」** —— 不是。推送体只有 216 字节的**指针**（路径 + 变更类型 + 来源），不含正文。文件膨胀是「同一条指针被重复推送了几千万次」造成的。
2. **「把 outbox 清掉就完事了？」** —— 没用。outbox 有界（默认 500 条），真正无界的是**服务端记录**和**客户端每 5 秒的全量拉取**。
3. **「重启一下客户端就好了？」** —— 旧版恰好相反：**每次重启都会让游标归零**，等于再拉一遍全史。所以升级前别反复重启。

---

## 附：本手册对应的代码改动（供核对版本）

| 文件 | 改动 |
|---|---|
| `lib/team-sync.js` | 推送体加 `idemKey`（+ `eventId` 兼容副本）；端点可由 `teamPushPath` 覆盖 |
| `lib/team-pull.js` | 新增 `normalizeCursorPre`（字符串/数字双形状）；游标落盘（注入式 `loadCursor`/`saveCursor`）；`no-applier` 按「是否本次请求的 kind」分流；请求带 `limit`；`status()` 增 `cursorPersisted`/`cursorLoops`/`pageLimit` |
| `lib/team-auth.js` | 响应体 32MB 硬上限（`content-length` 预检 + 实测兜底），超限返回 `response-too-large` |
| `lib/index.js` | 装配 `loadCursor`/`saveCursor`（`~/.dsh/memory/team/pull-cursor.json`，原子写 + 隔离开读）；新增配置键 `teamPushPath` / `teamPullPageLimit` |

**验证**：`node tests/smoke/smoke-test-team-sync-livelock.mjs` —— 71 条断言，含 5 组变异必红。
