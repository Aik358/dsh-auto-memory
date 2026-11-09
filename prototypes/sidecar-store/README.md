# 模块化 SidecarStore 原型

这是可运行的内部模块原型，入口为 `prototypes/sidecar-store/index.js`，类型声明在 `index.d.ts`。业务只调用 API，索引条目、倒排、并发锁、日志恢复和压实分别由模块负责。生产 `lib/`、`tests/`、`tools/` 未接线；示例与测试只写 `artifacts/_index-gov-20261109/`。

本次验证环境：Node v24.18.0 / Windows；不新增 npm 依赖。这个目录依赖仓内既有的共享锁和 Markdown 纯函数，不能单独复制出去后声称已是独立 npm 包。

## 直接运行

```powershell
# 不需要真实记忆数据：创建小白板、更新、另一个实例读到变化、压实、兼容导出。
node prototypes/sidecar-store/examples/basic.mjs

# 用上轮已封存的2,848条fixture运行真实模块 API，不读取/改写在线记忆。
node prototypes/sidecar-store/examples/fixture.mjs

# 自动发现两个测试文件；含真实多进程写入与指定边界SIGKILL。
node prototypes/sidecar-store/tests/run-contracts.mjs
```

第一条示例完全自包含。第二条需要前次调查保留的 `work/poc-a/base.json` 和 `out/fixture-meta.json`。它在内存验证原索引 SHA，另建独立原型目录，避免重新复制一份原始7 MB文件。脚本每次创建自己的随机子目录，不清理其它会话数据。

## 调用 API

```js
import path from 'node:path'
import { SidecarStore, MarkdownSidecarAdapter } from './prototypes/sidecar-store/index.js'

const workspaceKey = '--my-workspace--'
const store = await SidecarStore.open({
  directory: path.resolve('artifacts/my-sidecar-prototype'),
  workspaceKey,
  durable: true,
})

try {
  const markdown = new MarkdownSidecarAdapter(store, { workspaceKey })
  const first = await markdown.indexDocument({
    source: 'handoff/PLAN.md',
    text: '# 白板\n\n## 当前状态\n完成 API 原型。tag:索引治理\n',
    kind: 'plan',
    expectedRevision: null,
  }, { operationId: 'plan:first' })

  const tagged = await store.findByTag('tag:索引治理')
  const entries = await store.listSource('handoff/PLAN.md')
  const sourceRevision = await store.getSourceRevision('handoff/PLAN.md')

  // 一份 source 内全部新条目作为同一个事务；也可以一次替换多个 source。
  await store.replaceSource({
    source: 'handoff/PLAN.md',
    expectedRevision: sourceRevision,
    sourceRevision: 'my-source-revision:2',
    entries: entries.map(entry => ({ ...entry, preview: '继续验证并发' })),
  }, { operationId: 'plan:edit:2' })

  const view = await store.loadView()              // 完整八字段，交给现有消费者
  const text = await store.exportLegacySnapshot()  // 最新兼容 JSON；由调用方决定是否导出
  const status = await store.getStatus()           // seq、generation、日志字节等
  await store.compact()                           // 显式压实，正常更新不改 checkpoint
} finally {
  await store.close()
}
```

`replaceSource` 的 entries 是该文档**全部**新索引条目；`listSource()` 用于取得全体，`indexDocument()` 则直接从完整正文派生。`indexDocument` 只更新派生索引，Markdown 正文仍由原来的唯一写入口保存和归档。

## API 与职责

| API | 职责 |
|---|---|
| `SidecarStore.open({directory, workspaceKey, ...})` | 显式打开隔离目录，建立/恢复索引；无默认生产记忆目录 |
| `replaceSource(change, options)` | 一份 source 的原子替换，旧条目删除、新条目加入 |
| `replaceSources(changes, options)` | 多份 source 一条日志事务，预检全部变化后才提交 |
| `removeSources([{source, expectedRevision}], options)` | 删除条目并保留修订墓碑，防旧写复活 |
| `loadView()` | 返回旧消费者需要的八字段快照，外部修改不会污染内存 |
| `getEntry / findByTag / findByCue / listSource` | 返回条目深拷贝，保留原有条目和 posting 顺序 |
| `getSourceRevision(source)` | 读取当前修订；null表示缺修订键，不保证该source从未有条目（旧格式有缺键） |
| `readSnapshot()` | 同次读出 `{view, revision:{generation,seq}}`，供显式重建CAS |
| `rebuild(snapshot, {expectedState,...})` | 全量基础条目重建，必须携带全局读版本；正常写不调用它 |
| `compact()` | 同锁写新checkpoint/空日志，原子换manifest；seq不变，generation变化 |
| `importLegacy(snapshot)` | 仅未使用的store可导入旧格式；拒未知version，不改原文件 |
| `exportLegacySnapshot()` | 返回完整v1 JSON字符串；常态写不再生成整份旧磁盘JSON |
| `getStatus / close` | 状态和生命周期；close等待已受理调用完成，拒绝新调用 |
| `MarkdownSidecarAdapter` | 复用现有确定性解析器；导入文件、派生文档、显式文档范围重建 |

目录与实现分层：

```text
业务 / 原有引擎写入口
        ↓ 只调用
index.js                         公共导出 + index.d.ts
  ├─ sidecar-store.js            事务API、CAS、幂等、生命周期
  ├─ markdown-adapter.js         Markdown → entries；source revision
  ├─ index-state.js              entries/source桶/倒排/保序/八字段视图
  └─ journal-storage.js          同workspace共享锁、追尾、恢复、原子换代
       └─ codec.js               schema/checksum/错误类型
```

内存层不做文件IO。存储层不知道 Markdown 如何切分。公共API没有向调用者暴露可修改的内部 Map 或文件句柄。

## 数据与事务规则

- 一份store对应一个物理目录和workspace；adapter必须与store的workspace一致。不同实例/进程通过同一共享锁协作；不同workspace目录可独立写。
- `expectedRevision` 缺省不做source CAS；`null`要求当前无修订键；字符串要求相等。删除后修订为 `deleted:...`，重新创建须以墓碑为基线。
- 同一source revision、同一解析版本、相同entries返回no-change，日志零追加。相同修订/解析版本却对应不同内容会拒绝，避免修订身份失真。
- Markdown适配器的PLAN revision沿用 `planRevisionPre`，其它文档使用正文SHA；title/ts/mtime/kind/criteria/status的指纹进入该source的解析版本。同正文同元数据零写；元数据改变属于有效索引更新。
- 同一id更新保留原槽位，新id追加；不允许把已有id转移到另一source。未知entry字段保留。倒排posting顺序与当前生产构造函数一致。
- `operationId` 标识一次请求。已提交变更在最近256条窗口内（可配置）同ID同输入重试返回alreadyApplied，同ID异输入拒绝；窗口写入checkpoint，跨重启/压实保持。no-change不落幂等receipt，窗口之外不承诺永久去重，调用方应使用CAS。
- 调用时就复制校验入参，排队期间外部修改原对象不会改变已受理事务。持久化成功后才发布内存变化；失败清缓存并从已提交日志恢复。
- IO错误可能发生在完整行写出之后，调用失败不等价于磁盘一定未提交。使用相同operationId和同一请求重试；恢复后以日志校验结果裁决。

数据布局：

```text
<显式 directory>/
  manifest.json                      小文件，只初始化/压实时换代
  checkpoint-<generation>.json        基础条目、修订、解析版本、幂等窗口
  journal-<generation>.jsonl          每行一个source或多source事务
  manifest.json.lock[.acquire]        复用仓内共享锁协议，释放时移除
```

checkpoint 不存 by_tag/by_cue；它们只在内存维护。兼容输出仍有 `version/ws/rebuilt_at/entries/by_tag/by_cue/versions/sourceRevisions` 八字段。versions导入时保留旧值；触及条目按当前archive entry规则更新，不擅自扩展现行卡→历史卡血缘。

每次读API在共享锁内检查manifest并读取新日志后缀，避免另一个进程写后本实例一直用旧缓存；这不是无IO的Map.get。同generation已校验日志前缀按协议不可修改；外部同长篡改已缓存前缀可能要冷重开才检出。

## 恢复、压实和原型边界

完整记录必须同时满足checksum、workspace/generation和连续seq。只有无终止换行的残尾能在独占锁内截断；完整坏行、中段坏记录、seq缺口和manifest/数据文件消失明确拒绝，保留证据，**不会静默建空库**。`durable:true`在文件写入/恢复确认时调用sync，未承诺父目录刷盘或真实掉电下所有文件均存活。

压实采用简单可验证的版本：**全程持同一workspace锁**，checkpoint包含最新seq=N，新日志为空，下一次写N+1，最后atomic发布manifest。它会短暂阻塞该workspace写入；不在这里实现锁外压实、自动压实策略、旧代/orphan GC。旧代保留便于检查，不代表可以直接拿过期代当最新回滚。初始化发布中途留下代际文件却没有manifest时，要求显式恢复处理。

此原型未接生产的Markdown写锁、配置切根admission/drain、stale诊断与自动修复，也未自动扫描真实Markdown验证新鲜度。接线时由引擎持源文件锁、完成原有CAS/M1/归档/正文提交后调用API；sidecar失败仍须显式标记stale。勿直接启用2.5自动重绘。

旧客户端直接读磁盘 `handoff/index.json` 不会自动读到新格式。后续应将原有五个存储门改为调用本模块，并让 `?file=index.json` 返回 `exportLegacySnapshot()`；如每次事务又整份写旧JSON，写放大仍会回来。

## 本次实测

原始输出：`artifacts/_index-gov-20261109/out/prototype-fixture.json`、`prototype-basic.json`、`prototype-tests.json`、`prototype-tests.tap`。耗时是本机热缓存墙钟采样，不是生产工具端到端。

| 项目 | 结果 |
|---|---:|
| 固定真实输入 | 2,848条 /原文件7,382,763 B；导入导出SHA完全一致 |
| 模块API更新PLAN的5条entries | **33,568 B/事务**，只追加日志；manifest/checkpoint不变 |
| 正常写时延 | **13.265 ms中位**，2次预热+7样本；含共享锁、文件sync、内存更新 |
| 另一个实例追尾9次事务后按tag读取 | 单次11.504 ms，含追尾与完整查询，不是Map.get下界 |
| checkpoint导入发布 | 356.748 ms，原型API导入，不含fixture文件读取 |
| 显式压实 | 单次347.963 ms，持锁；新checkpoint5,658,779 B，不存两倒排 |
| 无变化 | 0 B追加，seq不变 |
| 自动测试 | **27/27通过**，含24次双进程更新、版本竞争、3处真实进程强杀、恢复后继续写 |

上轮1.38 ms是简易append实验；现在13.265 ms测的是带API校验、共享锁、sync和状态发布的模块路径，不能混用两种口径。逻辑字节不等于SSD物理写量；完整生产接线和Electron运行时验证仍待实施。
