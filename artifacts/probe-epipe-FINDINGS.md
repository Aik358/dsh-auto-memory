# EPIPE self-ignition probe: results (2026-09-14)

Node v24.18.0, Windows 10/11, pwsh 7. Probe = `artifacts/probe-epipe-selfignite.mjs`,
runner = `artifacts/probe-epipe-runner.ps1`, raw evidence = `artifacts/probe-epipe-runs/`.

## Repro commands

```pwsh
$r = 'D:\dsh-auto-memory\artifacts\probe-epipe-runner.ps1'
# PipeState Broken = child stdio are real cmd.exe pipes whose read end is closed by a sink
#                    (node probe-epipe-selfignite.mjs --sink) that exits immediately
& pwsh -File $r -Mode old            -Label old-broken-pipe           -PipeState Broken -ExtraArgs '--keep-streams --breaker=none' -TimeoutSec 10
& pwsh -File $r -Mode old-stream     -Label old-stream-broken-pipe    -PipeState Broken -ExtraArgs '--keep-streams --breaker=none' -TimeoutSec 10
& pwsh -File $r -Mode new            -Label new-broken-pipe           -PipeState Broken -ExtraArgs '--keep-streams --breaker=none' -TimeoutSec 10
& pwsh -File $r -Mode new-noswallow  -Label new-noswallow-broken-pipe -PipeState Broken -ExtraArgs '--keep-streams --breaker=none' -TimeoutSec 10
& pwsh -File $r -Mode old            -Label old-open-pipe-control     -PipeState Open   -ExtraArgs '--keep-streams --breaker=none' -TimeoutSec 10
& pwsh -File $r -Mode old            -Label old-endbreaker-brokenpipe -PipeState Broken -ExtraArgs '--breaker=both' -TimeoutSec 8
```

## Measured matrix

| shape (uncaughtException handler) | stdio state | exit | wall s | CPU ms | CPU %wall | verdict file | runner had to kill |
|---|---|---|---|---|---|---|---|
| `old` = quoted shape, `console.error` | broken pipe | 0 (own) | 2.32 | 78 | 3.4 | written | no |
| `old-stream` = quoted shape, raw `process.stderr.write` | broken pipe | **killed** | 10.43 | 9391 | **90.0** | written @1.5s, then spun | yes |
| `new` = fix (check+try/catch+gate+swallow) | broken pipe | 0 (own) | 1.90 | 78 | 4.1 | written | no |
| `new-noswallow` = fix minus `damSwallowStreamErrors` | broken pipe | **killed** | 10.42 | 9453 | **90.7** | written @1.5s, then spun | yes |
| `old-stream` | `end()` + broken pipe | **killed** | 8.52 | 7297 | **85.6** | written @1.5s, then spun | yes |
| `new` | `end()` + broken pipe | 0 (own) | 1.87 | 78 | 4.2 | written | no |
| `old` | `end()` + broken pipe | 0 (own) | 2.05 | 62 | 3.0 | written | no |
| `old` / `new` (controls) | healthy pipe | 0 (own) | 2.1-2.2 | 78-94 | 3.4-4.5 | written | no |
| all four shapes | `end()`, stdio redirected to FILES | 0 (own) | 1.9 | 62-94 | <=5 | written | no |

Spin rate after the verdict: `old-stream` +8.59 s CPU over 8.93 s wall = 96 % of one core until killed.

## Handler re-entry counters (same broken-pipe harness)

| handler write path | handler entries | first 3 lines |
|---|---|---|
| `console.error(...)` | **1** (`probe-boom` only) | `#1 probe-boom` |
| `process.stderr.write(...)` | unbounded | `#1 probe-boom`, `#2 EPIPE`, `#3 EPIPE`, ... |
| `process.stderr.write(..., cb)` | unbounded (a write callback does NOT help) | `#1 probe-boom`, `#2 EPIPE`, `#3 EPIPE` |
| with an `'error'` listener attached | 1 (the listener swallows; loop broken) | `#1 probe-boom`, `EVENT stderr EPIPE` |

## Mechanism

* Pipe read end closed -> the raw write fails; the failure is delivered ASYNCHRONOUSLY as an
  `'error'` event (code `EPIPE`). No write path produced a synchronous throw on this host.
* `'error'` with no listener -> EventEmitter throw -> `uncaughtException` -> handler writes again
  -> next EPIPE -> ... self-sustaining loop; timers keep running (the verdict file is still
  written at 1.5 s), the process never exits and burns ~90-96 % of one core.
* `console.error` cannot start this loop: `kWriteToConsole` passes a write callback AND installs a
  temporary `noop` `'error'` listener (`createWriteErrorHandler`), so console write failures are
  swallowed by design (Node lib/internal/console/constructor.js).
* `process.stdout.destroy()` / `process.stderr.destroy()` are no-ops for process stdio on Node 24:
  after calling them `destroyed === false`, `writable === true`, later writes still succeed.
  `stream.end()` is the in-process way to make later writes fail.

## Effect of each constraint in the fix (lib/index.js 6578-6605)

* `damSwallowStreamErrors` (`stream.on('error', () => {})`, line 6602) is the ONLY effective guard:
  removing it restores the full 90.7 % spin (`new-noswallow`).
* `_damDiagDepth` re-entry gate (6590-6591): ineffective here - async re-entry happens on a fresh
  stack with depth 0.
* `try/catch` (6592-6594): covers synchronous throws only; none reproducible on this host.
* writability pre-check (6593): the `destroyed` half is inert for process stdio (destroy is a
  no-op); the `writableEnded` half does work (fix skips the write when the stream was ended).
* residual coupling: the fix replaced the self-protecting `console.error` with a bare
  `stream.write` (line 6593), so its safety depends entirely on those permanent noop `'error'`
  listeners staying attached to `process.stdout`/`process.stderr`.

## Artifacts

* `artifacts/probe-epipe-selfignite.mjs` - the probe (modes `old`, `old-stream`, `new`,
  `new-noswallow`, plus the `--sink` pipe-closure helper)
* `artifacts/probe-epipe-runner.ps1` - bounded runner (exact-PID CPU sampling, `taskkill /PID <pid> /T /F`)
* `artifacts/probe-epipe-runs/` - per-run `*.metrics.json`, `*.trace.jsonl`, `*.verdict.json`
