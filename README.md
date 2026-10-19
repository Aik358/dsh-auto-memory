# dsh-auto-memory — minimal core

[中文说明](README.zh-CN.md)

DSH memory with six capabilities: automatic extraction, consolidation, short-summary injection, on-demand search, correction/deletion, and source tracing.

This branch replaces the former plugin with a small Node.js implementation. It has no Python runtime, embedding model, memory agents, reflection jobs, skill lifecycle, whiteboard, calendar, skin system, or updater.

## How it works

1. At the end of a root conversation turn, save its redacted text events locally.
2. After the workspace has been idle for 60 seconds, call the host's configured LLM directly. Extract reusable facts and merge them into existing automatic memories. Each call handles at most 24,000 source characters and 16,000 characters of candidate memories. Pending chunks continue during idle periods.
3. At prompt assembly, inject a short summary, capped at 3,000 characters by default. Search and source tools retrieve the details only when requested.
4. Manual corrections are version-checked and protected from automatic overwrite. Deletion removes the memory and retires its evidence from search and extraction.

All records use one JSON store, with project scope or cross-project user scope. Original text events are separate files. Atomic replacement and a process lock protect concurrent writes. The model has no tools during extraction. Errors leave source cursors unchanged and appear in the memory page; retry there or after another conversation turn.

## Install this branch

Requires Node.js 22.19+ and a DSH host with `llm`, `tools`, `systemPrompt`, `webServer`, and the `conversation.view` client slot. The host integration follows the public DSH contracts at commit `687f282e8625c6b8d11ff58211a90524be2e4317`.

In a local checkout:

```sh
npm test
npm pack
```

Install the resulting `a9i5k4-dsh-auto-memory-4.0.0-alpha.1.tgz` through DSH's plugin installation flow. The package retains its existing plugin identity and bundle patch. Restart DSH after replacing the old version.

The **记忆 / Memory** conversation tab provides search, add, correction, deletion, source reading, and retry of pending extraction. It follows the selected workspace session. A completed model request supplies the extraction route; no additional API key is required.

## Storage and migration

Default directory: `$DSH_HOME/memory-core`, or `~/.dsh/memory-core`.

- `memory.json`: records, scopes, source metadata, processing cursors and deletion guards.
- `sources/src_*.json`: redacted source text with session and turn identifiers.

On first use of each workspace, import the previous plugin's `MEMORY.md` and dated daily logs, including the `archive` directory. Both the old centralized workspace directory and the project's `.dsh-memory` directory are recognized. The old `dsh-auto-memory.json` is read only for storage paths. Imports are durable and processed once. The old files remain untouched and the old configuration does not enable removed features.

Deletion removes a memory from the active store. Its evidence is excluded from search and future extraction; its original file remains accessible by source ID for the provenance of other memories sharing that source. This does not erase the DSH conversation history. An explicit new user statement can create new evidence. Common credential patterns are redacted; this is not a guarantee of arbitrary secret detection. Back up the entire directory when moving or restoring the store.

Global preferences can be read across projects. A project's full conversation source can only be read in its original workspace, including when a user preference was derived from it.

## Configuration

Optional values on the existing plugin row in the DSH profile:

```yaml
- id: auto-memory
  name: '@a9i5k4/dsh-auto-memory'
  config:
    autoExtract: true
    idleMs: 60000
    requestTimeoutMs: 120000
    summaryChars: 3000
    # directory: /absolute/path/to/memory-core
    # provider: configured-provider-id
    # model: configured-model-id
```

By default, extraction inherits the most recent model route of the workspace. Disabling `autoExtract` pauses background model calls; source capture, search and manual editing remain available. Extraction stops when a new turn starts. Pending originals are retained across restarts and resume after the workspace is opened with an available model route.

## Tools

| Tool | Purpose |
| --- | --- |
| `memory_search` | Keyword search; optionally include original text |
| `memory_read` | Full memory, current version, source IDs |
| `memory_source` | Paginated original text |
| `memory_write` | Add or correct; edits require `expectedVersion` |
| `memory_delete` | Delete with a version check |

Search uses normalized words and Chinese bigrams, without embeddings or a database service. The local HTTP endpoint is `/api/dsh-auto-memory/core`, limited to loopback and same-origin requests. Every request resolves a session to its workspace.

## Development

```sh
npm test
npm pack --dry-run
```

Tests exercise persistence, concurrent processes, host lifecycle contracts, model failures, scope isolation, deletion guards, migration and HTTP access. No paid model calls are needed for the suite. A live DSH model run is still required to evaluate extraction quality on your own conversations.

The simplification follows the useful Codex memory pattern: background extraction and consolidation, a small injected summary, and files read on demand. It is an independent DSH implementation. Legacy implementation and release history remain in Git.

License: BSD-3-Clause.
