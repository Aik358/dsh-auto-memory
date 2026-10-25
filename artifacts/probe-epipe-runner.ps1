# artifacts/probe-epipe-runner.ps1
# ---------------------------------------------------------------------------
# Runs artifacts/probe-epipe-selfignite.mjs once and measures the DECISIVE metrics of the exact
# child PID (wall clock, CPU time, exit code, whether it got killed by the timeout).
#
# Why the pipe plumbing looks odd: on this host the only way to make a Node process-level stream
# write actually FAIL is to close the real pipe read end from outside the process
#   - process.stdout.destroy() / process.stderr.destroy() are verified NO-OPS on Node 24
#     (destroyed stays false, writable stays true, later writes still succeed)
#   - .NET Process.StandardOutput.Close() does NOT close the pipe handle either
#     (Process wraps it in a SafeFileHandle with ownsHandle:false)
# So PipeState=Broken runs the probe through a real cmd.exe pipeline whose reader is
# `node probe-epipe-selfignite.mjs --sink` (a process that exits immediately), and
# PipeState=Open captures the control run into log files.
#
# Safety: the runner NEVER kills by image name. It reads the probe's own pid from its trace file
# and calls taskkill /PID <that pid> /T /F only, after a hard timeout.
#
# Usage:
#   pwsh -File artifacts/probe-epipe-runner.ps1 -Mode old -Label old-broken-pipe
#   pwsh -File artifacts/probe-epipe-runner.ps1 -Mode new -Label new-broken-pipe
#   pwsh -File artifacts/probe-epipe-runner.ps1 -Mode old -Label old-open-pipe -PipeState Open -ExtraArgs '--keep-streams --breaker=none'
# ---------------------------------------------------------------------------
param(
  [ValidateSet('old', 'old-stream', 'new', 'new-noswallow')][string]$Mode = 'old',
  [ValidateSet('Broken', 'Open')][string]$PipeState = 'Broken',
  [int]$TimeoutSec = 10,
  [string]$ExtraArgs = '',
  [int]$BoomDelayMs = 800,
  [string]$Label = '',
  [string]$Script = '',
  [string]$PidFile = '',
  [string]$OverrideCmd = ''
)

$ErrorActionPreference = 'Stop'
$root = 'D:\dsh-auto-memory'
$probe = if ($Script) { $Script } else { Join-Path $root 'artifacts\probe-epipe-selfignite.mjs' }
$node = (Get-Command node).Source
if (-not $Label) { $Label = "$Mode-$($PipeState.ToLower())" }
$runDir = Join-Path $root 'artifacts\probe-epipe-runs'
New-Item -ItemType Directory -Force -Path $runDir | Out-Null

$verdict = Join-Path $root "artifacts\probe-epipe-verdict-$Mode.json"
$trace = if ($PidFile) { $PidFile } else { Join-Path $root "artifacts\probe-epipe-trace-$Mode.jsonl" }
$outLog = Join-Path $runDir "$Label.stdout.txt"
$errLog = Join-Path $runDir "$Label.stderr.txt"
Remove-Item -Force -ErrorAction SilentlyContinue $verdict, $trace, $outLog, $errLog

$common = if ($OverrideCmd) { $OverrideCmd } else { "$node $probe $Mode --boom-delay=$BoomDelayMs --verdict-delay=$($BoomDelayMs + 700)" }
if ($ExtraArgs) { $common = "$common $ExtraArgs" }
if ($PipeState -eq 'Broken') {
  # 2>&1 merges stderr into the pipe; the sink exits immediately -> read end gone -> writes fail
  $inner = "$common 2>&1 | $node $probe --sink"
} else {
  $inner = "$common > `"$outLog`" 2>&1"
}

$sw = [System.Diagnostics.Stopwatch]::StartNew()
$cmdProc = Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', $inner -PassThru -WindowStyle Hidden
$cmdPid = $cmdProc.Id

# discover the probe's own pid from its trace file (written at startup)
$nodePid = $null
$discoverDeadline = (Get-Date).AddSeconds(6)
while ((Get-Date) -lt $discoverDeadline) {
  if (Test-Path $trace) {
    $first = Get-Content $trace -TotalCount 1 -ErrorAction SilentlyContinue
    if ($first) { try { $nodePid = (ConvertFrom-Json $first).pid } catch { } }
    if ($nodePid) { break }
  }
  Start-Sleep -Milliseconds 100
}

$exitedOnOwn = $false
$cpuMs = $null
$deadline = (Get-Date).AddSeconds($TimeoutSec)
if ($nodePid) {
  while ((Get-Date) -lt $deadline) {
    $p = Get-Process -Id $nodePid -ErrorAction SilentlyContinue
    if (-not $p) { $exitedOnOwn = $true; break }
    $cpuMs = [math]::Round($p.TotalProcessorTime.TotalMilliseconds, 1)
    Start-Sleep -Milliseconds 200
  }
} else {
  Start-Sleep -Seconds $TimeoutSec
}
$sw.Stop()
$wallSec = [math]::Round($sw.Elapsed.TotalSeconds, 2)

$killed = $false
if ($nodePid) {
  $p = Get-Process -Id $nodePid -ErrorAction SilentlyContinue
  if ($p) {
    try { $cpuMs = [math]::Round($p.TotalProcessorTime.TotalMilliseconds, 1) } catch { }
    & taskkill /PID $nodePid /T /F | Out-Null   # exact pid only
    $killed = $true
    Start-Sleep -Milliseconds 500
  }
}
# the cmd.exe wrapper we started must not linger
Start-Sleep -Milliseconds 300
$cmdStillAlive = $null -ne (Get-Process -Id $cmdPid -ErrorAction SilentlyContinue)
if ($cmdStillAlive) { & taskkill /PID $cmdPid /T /F | Out-Null; Start-Sleep -Milliseconds 300 }
$nodeAliveAfter = if ($nodePid) { $null -ne (Get-Process -Id $nodePid -ErrorAction SilentlyContinue) } else { $null }
$cmdAliveAfter = $null -ne (Get-Process -Id $cmdPid -ErrorAction SilentlyContinue)

# evidence
$traceLines = @()
if (Test-Path $trace) { $traceLines = Get-Content $trace }
$exitRecord = $null
foreach ($l in $traceLines) { try { $o = ConvertFrom-Json $l; if ($o.ev -eq 'exit') { $exitRecord = $o } } catch { } }
$brokenRecord = $null
foreach ($l in $traceLines) { try { $o = ConvertFrom-Json $l; if ($o.ev -eq 'streams-broken') { $brokenRecord = $o } } catch { } }
$verdictExists = Test-Path $verdict
$verdictJson = $null
if ($verdictExists) {
  Copy-Item -Force $verdict (Join-Path $runDir "$Label.verdict.json")
  try { $verdictJson = Get-Content -Raw $verdict | ConvertFrom-Json } catch { }
}
if ($traceLines.Count) { $traceLines | Set-Content -Encoding utf8 (Join-Path $runDir "$Label.trace.jsonl") }

[pscustomobject]@{
  label            = $Label
  mode             = $Mode
  pipeState        = $PipeState
  extraArgs        = $ExtraArgs
  boomDelayMs      = $BoomDelayMs
  probePid         = $nodePid
  cmdPid           = $cmdPid
  exitedOnOwn      = $exitedOnOwn
  ownExitCode      = $exitRecord.code
  wallSec          = $wallSec
  cpuMs            = $cpuMs
  cpuPctOfWall     = if ($wallSec -gt 0 -and $null -ne $cpuMs) { [math]::Round(100.0 * ($cpuMs / 1000.0) / $wallSec, 1) } else { $null }
  killedByRunner   = $killed
  probeAliveAfter  = $nodeAliveAfter
  cmdAliveAfter    = $cmdAliveAfter
  verdictWritten   = $verdictExists
  verdict          = $verdictJson
  streamsBroken    = $brokenRecord
  traceEvents      = @($traceLines | ForEach-Object { try { (ConvertFrom-Json $_).ev } catch { } })
} | ConvertTo-Json -Compress -Depth 6 | Tee-Object -FilePath (Join-Path $runDir "$Label.metrics.json")
