# DSH 上游报告 —— v0→v1 迁移器拒绝历史 `subagent/descriptor` v2，毒化整个 session-query 索引

> **状态**：已完工 · 2026-09-29
> **性质**：研究结论 —— 本文为**完成后的技术记录**，不再作为待执行计划。
> **落点**：目标仓库 deepseek-ai/deepseek-harness（Discussion 或 Issue）；正文为可直接粘贴的英文；与 `GH-DISCUSSION-5732-COMMENT.md` 同一通道。插件侧缓解已落地（`lib/index.js` `lexicalSessionScanFallback` + `tests/smoke/smoke-test-session-search-fallback.mjs`）
> **验收**：本机证据：报错样本会话 `~/.dsh/sessions/--D-dsh-auto-memory--/01740c44-f3d5-4a93-b528-049383dadd36/session.jsonl.zstd`（2026-08-19，47 帧，seq 5 = descriptor v2）；全机只读扫描 164 个 v0 会话中 39 个含 descriptor v2、9 个含 v3

## 摘要

本文是给 DSH 上游的报告（Discussion 或 Issue 可直接粘贴的英文正文），报告 v0→v1 会话迁移器只接受 `data.version === 3`，对早期构建写入的 `subagent/descriptor` v2 事件整份拒绝，而 `dsh-session-query-sqlite` 在持久化观察期会重新索引冷会话，导致一条此类会话就让每次 `searchSessions()` 调用失败，整个会话搜索功能失效。文末附本机证据清单供用户自查：报错样本会话路径、全机只读扫描结果（164 个 v0 会话中 39 个含 descriptor v2，全部 2026-08-19~23），以及插件侧已落地的缓解（捕获 `SESSION_QUERY_PERSISTENCE_FAILED` 后走插件内词法兜底扫描）。遗留项为待用户粘贴（PAT 无权外仓发言，需用户浏览器操作）。

---


> 状态：**草稿待用户粘贴**（与 GH-DISCUSSION-5732-COMMENT.md 同一通道：PAT 无权外仓发言，需用户浏览器操作）。
> 目标仓库：deepseek-ai/deepseek-harness（Discussion 或 Issue）。下面是可直接粘贴的英文正文。

---

**Title:** Session search permanently fails on pre-v3 `subagent/descriptor` events: v0→v1 migrator rejects descriptor version 2 (`SESSION_QUERY_PERSISTENCE_FAILED`)

## Summary

Sessions written by earlier DSH builds contain `subagent/descriptor` events with `data.version === 2`. The current v0→v1 session migrator only accepts `data.version === 3`, refuses the whole artifact ("source v0 artifact remains unchanged"), and because `dsh-session-query-sqlite` re-indexes cold sessions during its persistence observation, **one such session makes every `searchSessions()` call fail** — the entire session-search feature is dead until the offending file is removed or the migrator is fixed.

## Evidence (from an unmodified 0.1.x install)

1. Writer side (historical): a session created 2026-08-19 has at seq 5:
   ```json
   {"type":"subagent/descriptor","seq":5,"data":{"version":2,"mode":"one-shot","provider":"spawn","label":"Find closest prior art"}}
   ```
   Header is `{ "type":"session", "version":0, ... }` (v0 artifact). 39 sessions on this machine (2026-08-19 ~ 08-23) carry descriptor v2; 9 later ones carry v3. For `mode:"one-shot"` the v2 payload shape `{version, mode, provider, label?}` is **field-for-field identical to the v3 shape** — only the version constant differs.

2. Reader side (current): `@deepseek-ai/dsh-session-format-v0-to-v1` `assertReleasedEventPayload`:
   ```js
   if (event.type === "subagent/descriptor" && data["version"] !== 3) {
       const descriptorVersion = sessionFormatCount(data["version"], ...);
       if (version === 0) throw new SessionFormatUnsupportedMigrationError(
         `${event.type} ${event.seq} uses unsupported descriptor version ${descriptorVersion}`);
       return;
   }
   ```
   and `subagentDescriptorValue` hard-pins `literalValue(data["version"], [3], ...)`.

3. Blast radius: `dsh-session-query-sqlite` `_observeStable()` → `readColdSessionLog()` for each persisted session needing (re)index → any `SessionFormatUnsupportedMigrationError` propagates:
   ```
   session-search persistence observation failed: subagent/descriptor 5 uses unsupported
   descriptor version 2; source v0 artifact remains unchanged
   (SessionQueryError, SESSION_QUERY_PERSISTENCE_FAILED)
   ```
   The observation loop retries once and fails again ⇒ every search fails, not just the offending session.

## Impact

- Any workspace with pre-v3 subagent sessions (anything spawned via one-shot subagents before the descriptor v3 bump) permanently loses session search after a cold re-index. Downstream consumers (e.g. plugins calling `ctx.get('sessionQuery')`) surface this as a hard channel failure.
- The 39 sessions are valid user history; the migrator treating them as permanently un-migratable effectively brickes the index for the whole workspace.

## Suggested fixes (either would do; both is better)

1. **Accept & normalize v2 descriptors** during legacy normalization: for `mode:"one-shot"`, v2 and v3 key sets are identical (`version/mode/provider` + optional `label`), so mapping `version: 2 → 3` is schema-faithful. For `mode:"continuable"` please confirm whether v2 payloads are also shape-compatible.
2. **Per-session quarantine instead of global failure**: if one artifact cannot migrate, skip that session (record it as skipped in index state) and let the observation stabilize with the remaining sessions — one stale file should not take down search for the entire workspace.

## Repro

1. Take any v0 `session.jsonl.zstd` containing a `subagent/descriptor` with `data.version === 2`.
2. Remove/expire the session-query SQLite index so a cold re-index triggers (or point the query service at a fresh `DSH_HOME`).
3. Call `searchSessions({ query: "anything" })` → `SESSION_QUERY_PERSISTENCE_FAILED` every time.

---

## 附：本机证据清单（不放正文，供用户自查）

- 报错样本会话：`~/.dsh/sessions/--D-dsh-auto-memory--/01740c44-f3d5-4a93-b528-049383dadd36/session.jsonl.zstd`（2026-08-19，47 帧，seq 5 = descriptor v2 "Find closest prior art"）。
- 全机扫描（只读）：164 个 v0 会话中 39 个含 descriptor v2（全部 2026-08-19~23），9 个含 v3。
- 插件侧缓解已落地：`searchSessionHistory` 捕获 `SESSION_QUERY_PERSISTENCE_FAILED` 后走插件内词法兜底扫描（见 lib/index.js `lexicalSessionScanFallback` + tests/smoke/smoke-test-session-search-fallback.mjs）。
