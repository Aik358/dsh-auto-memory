# 抢救留档 · Minervaowl7 上游批次 #422–#444（23 条 issue）

> **抢救时间**：2026-10-15
> **原因**：贡献者账号 `Minervaowl7` 被 GitHub 临时封控，其 issue/PR 对象在仓库中已不可访问（API 返回 404）。
> **来源**：本机会话转录 `session-2a0bcb89-24eb-4e74-a7f5-9b07b70812bb`（v4.jsonl.zstd，9238 帧全解压，0 失败）。
> **声明**：此为**原始正文留档**，非二次转述。审计基线 SHA `3d55c4552fc0662ce9f5ba03a62d5f98effb50f0`（PR #420 head）。

## 索引

| # | 编号 | 标题 | 正文字符 | 留档 |
|---|---|---|---|---|
| 422 | A01 | Python 健康缓存过期后，显式召回无法发布新探测结果而持续降级 | 3131 | [`issue422.md`](per-issue/issue422.md) |
| 423 | A03 | 团队 viewer 的 GET 下行被统一写权限门阻断 | 2783 | [`issue423.md`](per-issue/issue423.md) |
| 424 | A04 | 技能明确弃用后只更新状态，已有导出 SKILL.md 未退休 | 3851 | [`issue424.md`](per-issue/issue424.md) |
| 425 | A05 | 迁移导入新增子路径可穿过目标内已有目录链接写到记忆根外 | 3389 | [`issue425.md`](per-issue/issue425.md) |
| 426 | A06 | 高风险技能编辑撤销批准后，activate 可重新激活且召回误称已确认 | 4298 | [`issue426.md`](per-issue/issue426.md) |
| 427 | A07 | 技能标题含冒号空格时 description 未做 YAML 引用，自检仍成功 | 3048 | [`issue427.md`](per-issue/issue427.md) |
| 428 | A08 | 会话切换模型后，事件扫描可把旧模型窗口嫁接到新模型 | 3003 | [`issue428.md`](per-issue/issue428.md) |
| 429 | A09 | 官方压缩模型策略缺省字段不继承所属预设，相同配置也误判歧义 | 3218 | [`issue429.md`](per-issue/issue429.md) |
| 430 | A10 | 会话片段超过 64 条时同时 shift 两个摘要数组，仍保留的用户目标消失 | 3156 | [`issue430.md`](per-issue/issue430.md) |
| 431 | A11 | 撤回或被取代记忆通过 Tier-0 原文目录重新标为 current 注入 | 3786 | [`issue431.md`](per-issue/issue431.md) |
| 432 | A12 | “不让 AI 使用的来源”只过滤 hits，Tier-0 原文目录绕过排除 | 4045 | [`issue432.md`](per-issue/issue432.md) |
| 433 | A13 | 注入统计读取不存在的 segment.text，已注入段字符数被记为 0 | 3293 | [`issue433.md`](per-issue/issue433.md) |
| 434 | A14 | 白板不同章节同名卡片自动生成重复 ID，保存后单卡编辑恒冲突 | 3673 | [`issue434.md`](per-issue/issue434.md) |
| 435 | A15 | 存储索引修复成功未使常驻语料缓存失效，恢复记忆仍无法召回 | 3950 | [`issue435.md`](per-issue/issue435.md) |
| 436 | A16 | EvidenceEventStore 多分片清理落入夹层，强制 sweep 后仍超过 32MiB | 2905 | [`issue436.md`](per-issue/issue436.md) |
| 437 | A17 | Python 向量构建异常仍确认 accepted，JS 缓存 ready 后同版本不再重试 | 4539 | [`issue437.md`](per-issue/issue437.md) |
| 438 | A18 | 迁移包校验和漏掉 userFiles，日历内容损坏仍通过完整性检查 | 3783 | [`issue438.md`](per-issue/issue438.md) |
| 439 | A19 | 预算丢弃的联想记忆仍生成 seen，投递引用与证据数量不一致 | 3834 | [`issue439.md`](per-issue/issue439.md) |
| 440 | A20 | AI 蒸馏成功分支绕过容量门，项目笔记满额仍追加 | 3101 | [`issue440.md`](per-issue/issue440.md) |
| 441 | A21 | 清空召回统计落盘失败仍返回成功，重启恢复旧记录 | 2951 | [`issue441.md`](per-issue/issue441.md) |
| 442 | A22 | 外部来源关闭期间旧扫描仍可发布，禁用来源继续缓存与检索 | 4278 | [`issue442.md`](per-issue/issue442.md) |
| 443 | A23 | JS 模型下载开始/取消请求失败被空 catch 吞掉，界面无错误回执 | 3088 | [`issue443.md`](per-issue/issue443.md) |
| 444 | A24 | Python 重启后旧进程迟到 error 清空新进程引用，并误拒新请求 | 3217 | [`issue444.md`](per-issue/issue444.md) |

**合计**：23 条，正文 80,320 字符（78.4 KB）
