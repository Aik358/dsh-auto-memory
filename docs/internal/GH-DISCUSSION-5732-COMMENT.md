## Independent confirmation from a Chinese community user (3 cases, one new finding)

I run a third-party plugin (dsh-auto-memory) and help maintain a plugin community. We hit this exact failure **three times in one night** on `dsh 0.1.5-rc.1`, Windows, via a strict relay (`Console Go` → upstream OpenAI-compatible). Confirming #5732's diagnosis and adding one detail the original report could not show.

### Symptom is identical
Every follow-up fails with:
```
400 invalid_request_error: Duplicate 'call_id': call_01_IBQv9P78wRhPI72L2XVh2573_call_01_IBQv9P78wRhPI72L2XVh257.
// and, on another model in the same session:
400 Duplicate value for 'tool_call_id' of call_01_IBQv9P78wRhPI72L2XVh2573|call_01_IBQv9P78wRhPI72L2XVh2573 in message[3]
```
The session becomes permanently unusable (every model fails — the broken history is re-sent each time), and the UI also fails to render: `[session-controller] event feed subscriber failed: conversation Context 20:trajectory-tool-call <id>|<id> received more than one start Match`.

### New finding: it does **not** require aborting a turn
The second and third occurrences happened during **normal turn flow** — no cancellation, no `turn/end reason:aborted`. Timeline from the on-disk log (all events same second, `turn` intact):

```
979  tool/call    call_00_wNCqnnajJD3I7N3n9x253480|call_00...
981  tool/call    call_01_UKmzZe2AlTekpCR0whQV6449|call_01...
983  tool/call    call_01_UKmzZe2AlTekpCR0whQV6449|call_01...   <-- same id written again in the same step
```
So this is not only "abort re-appends the in-flight batch" (our 1st/2nd cases, which *were* aborts, `turn/end reason:aborted` then a duplicated batch of 3 tool calls). The model itself emitted the **same tool_call id twice within one step**, and DSH persisted both verbatim — matching #5732's "came verbatim from the model response".

### Storage form (for anyone writing a repair tool)
- On disk: `~/.dsh/sessions/<ws>/<sid>/session.v3.jsonl.zstd`, **append-style multi-frame zstd, one event per frame**; the first frame must be *exactly* one header line, otherwise boot fails with `corrupt Zstandard session log: first frame is not exactly one header line` (we learned this the hard way — compressing the repaired text into a single frame bricks startup. Repair tools must preserve frame-per-line).
- Damaged ids appear as `<id>|<id>` in `data.callId` of `tool/call` and `data.message.source.callId` of `tool/result`; a duplicate pair is `tool/call` + its `tool/result` appended a second time.
- Repair that works: drop the second `tool/call`+`tool/result` pair (keep the first), keep every other event and the frame structure, then the session resumes normally after a host restart. We did this three times (sessions `1ef5cee8`, `a82b8e44`, `9cc01f76`; 6/4/2 events removed respectively).

### Addendum: two distinct shapes, only one of them bricks the session

Scanning all 164 local session files, duplicated tool ids appear in **30 of them**, but they fall into two very different shapes:

| shape | example gap | count | effect |
|---|---|---|---|
| **adjacent double-write** (same step) | 2 events apart (seq 981 -> 983) | 3 sessions - the ones that bricked | **session permanently unusable** (400 on every turn) |
| **cross-turn reuse** (same id, different turn) | tens of thousands of events apart (seq 493 -> 84330, 1369 -> 426207) | 27 sessions, still running fine | tolerated by our relay default path |

So the id-uniqueness guarantee #5732 asks for is genuinely needed (those 27 sessions are one strict-provider switch away from the same fate), but the **acute** trigger is the adjacent double-write, which is what produces the byte-identical duplicated id string we see in `data.callId`. Two symptoms, one root cause.

### Suggested fix (fully agreeing with the report)
Deduplicate/rewrite `toolCallId` at **history append** (rewrite the later occurrence to a fresh id and remap the matching `tool` message), so any provider sees a unique id space — and, for the UI side, the assembler should not fatal-throw on `received more than one start Match` but isolate the bad block (same ask as the #5692 family).

Happy to provide the raw (redacted) event excerpts or the repair script if useful. Environment: Windows 11, Node 24, dsh `0.1.5-rc.1`; relay = Console Go (strict unique-id check).