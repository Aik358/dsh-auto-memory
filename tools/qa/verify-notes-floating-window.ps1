# Requires a browser-skill session showing an isolated DSH web host in Chinese,
# with dream skin loaded and the memory floating panel already open.
param([Parameter(Mandatory=$true)][string]$Session, [string]$ResultsPath)
$ErrorActionPreference = 'Stop'
$taskBsk = Join-Path $env:USERPROFILE '.local\bin\bsk.exe'
$taskResults = @()
function Click-Fresh([string]$Label) {
  $taskObservation = & $taskBsk observe --session $Session
  $taskPattern = '(@e\d+) button "' + [regex]::Escape($Label) + '"'
  $taskRef = [regex]::Match(($taskObservation -join "`n"), $taskPattern)
  if (!$taskRef.Success) { throw "Control absent: $Label" }
  & $taskBsk click $taskRef.Groups[1].Value --session $Session | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Click failed: $Label" }
}
$taskExpression = @'
(async()=>{await new Promise(r=>setTimeout(r,350));const p=document.querySelector('[data-dam-panel]');if(!p)return {visible:false,reason:'absent'};const r=p.getBoundingClientRect();const chat=document.querySelector('[data-composer-input], [contenteditable="true"][role="textbox"]');return {position:getComputedStyle(p).position,role:p.getAttribute('role'),marker:p.getAttribute('data-dsh-dream-skin-composer'),editor:!!p.querySelector('textarea'),rect:{top:r.top,bottom:r.bottom,left:r.left,right:r.right},viewport:[innerWidth,innerHeight],visible:r.top>=0&&r.left>=0&&r.bottom<=innerHeight&&r.right<=innerWidth,chatMarked:!!chat?.closest('[data-dsh-dream-skin-composer]'),skinLoaded:!!document.getElementById('dsh-dream-skin:material:liquid-glass')}})()
'@
function Check-Panel([string]$Step, [bool]$ExpectMarker=$false) {
  $taskRaw = & $taskBsk evaluate $taskExpression --session $Session --json
  $taskResponse = ($taskRaw -join "`n") | ConvertFrom-Json
  if (!$taskResponse.ok) { throw "Evaluation failed at $Step" }
  $taskValue = $taskResponse.value
  if (!$taskValue.visible -or $taskValue.position -ne 'fixed' -or !$taskValue.editor -or !$taskValue.skinLoaded -or $taskValue.role -ne 'dialog') { throw "Panel check failed at ${Step}: $($taskValue | ConvertTo-Json -Compress -Depth 6)" }
  if (!$taskValue.chatMarked) { throw "Host chat composer lost its skin marker at $Step" }
  if (!$ExpectMarker -and $taskValue.marker) { throw "Composer discovery included notes at $Step" }
  $script:taskResults += @{ step=$Step; geometry=$taskValue }
  Write-Output "PASS $Step : fixed, Notes editor inside viewport"
}
for ($taskRun=1; $taskRun -le 3; $taskRun++) {
  Click-Fresh '概览'
  Click-Fresh '笔记'
  Check-Panel "click-$taskRun"
  Click-Fresh '✕'
  Click-Fresh '记忆'
  Check-Panel "reopen-$taskRun"
}
# Exercise the independent positioning fallback with an old/foreign marker.
try {
  $taskProbe = & $taskBsk evaluate "(()=>{const p=document.querySelector('[data-dam-panel]');p.setAttribute('data-dsh-dream-skin-composer','1');const probe=document.createElement('span');probe.setAttribute('data-dam-qa-probe','');p.append(probe);return true})()" --session $Session --json
  if (!(($taskProbe -join "`n") | ConvertFrom-Json).ok) { throw 'Marker probe failed' }
  Check-Panel 'foreign-marker-and-DOM-insertion' $true
} finally {
  & $taskBsk evaluate "(()=>{const p=document.querySelector('[data-dam-panel]');p?.removeAttribute('data-dsh-dream-skin-composer');p?.querySelector('[data-dam-qa-probe]')?.remove();return true})()" --session $Session --json | Out-Null
}
if ($ResultsPath) { $taskResults | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $ResultsPath -Encoding utf8 }
