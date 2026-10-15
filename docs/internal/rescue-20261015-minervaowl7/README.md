# 抢救留档 · Minervaowl7 上游 issue 全量台账

> **事件**：贡献者 `Minervaowl7` 账号被 GitHub 封控（`GET /users/Minervaowl7` → **404**）。
> 其 **193 issue / 104 PR** 对象已全部不可访问（按号查一律 404）；仓库 `open_issues_count` 27 → **1**，PR 总数 100+ → **6**。

> **抢救时间**：2026-10-15　**范围**：本机 473 个会话转录（1.1 GB）+ 4 份仓库副本 + git 全历史（516 提交）

## 一、首要结论：代码未被回滚

三层独立证据：

1. **他仍是 `origin/main` 历史实质部分** —— **146 / 516** 提交，跨度 2026-09-07 → 2026-10-14。
2. **关键 merge 仍是祖先** —— `PR#394` merge `7e379262`、`PR#420` merge `394fdbe2`（force-push 会抹掉该关系，未发生）。
3. **v3.3.4 内容实测在位** —— `__unchangedByCreateOnly`、`tools/check-write-contract-await.mjs`、R26 基线 `3C375E3D8D9E34BD`。

**被抹除的仅是 GitHub 平台的 issue/PR 对象，代码与 git 历史完整无损。**

## 二、本目录内容

| 文件 | 内容 |
|---|---|
| `UPSTREAM-LEDGER.md` | **主交付**：全量编号台账 + 完整元数据条 |
| `SNAPSHOT-66-20261014.md` | 封控前 API 实时快照（open issue 66 条：#/作者/时间/标题）|
| `issues-metadata.json` | 同上，机器可读 |
| `ledger-full.json` | 全量台账（含来源标记）|
| `missing-numbers.json` | 缺口编号（从未在任何本机来源出现）|
| `per-issue/issue422.md … issue444.md` | **#422–#444 共 23 条完整正文**（78.4 KB）|
| `INDEX.md` / `RAW-transcript-extract.md` | #422–#444 索引 / 原始提取件 |

## 三、统计

| 指标 | 值 |
|---|---|
| 全量台账条目 | 92 |
| 含完整元数据（作者/时间/优先级）| 68 |
| 采集到标题 | 342 |
| 完整正文留档 | 23（#422–#444）|
| 缺口编号 | 328 |

## 四、提取方法（可复用）

1. **会话转录 = 多帧 zstd**：`~/.dsh/sessions/<ws>/session-*/session.v*.jsonl.zstd` 为逐条追加的多帧流。
   整包 `zstdDecompressSync` 只出首帧（本案 199 字节），必须**按魔数 `28 B5 2F FD` 切帧后逐帧解压**（9238 帧，0 失败，解出 215 MB）。
2. **JSONL 外壳剥离**：转录为 JSONL，文本内 `\n` 转义 ⇒ 正则跨行必失败。须递归抽 `text` 字段生成干净语料后再检索。
3. **多形态采集**：issue 在转录中有 4 种形态 —— ① 实时 API 快照 `#N | author | date | title`；② 状态台账 `#N [ISSUE closed] [Prio] title`；③ 批次交接行；④ 报告标题行。
4. **完整性校验**：按 issue 头部 `--- body (N chars) ---` 声明字符数逐条比对实际长度（23/23 吻合）。

## 五、教训

- **平台侧对象不受本仓备份保护**：账号一旦被封控，其 issue/PR 立即从仓库视图消失，**唯一副本是本机会话转录**。
- 此后外部贡献者提交的重要 issue，应**当轮**落盘归档正文，不依赖 GitHub 侧留存。
- `~/.dsh/sessions/` 转录会被 GC 清理 —— 需要的内容必须及时提取。
