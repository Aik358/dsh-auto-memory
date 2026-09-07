$ErrorActionPreference = 'Continue'
$base = "$env:USERPROFILE\.dsh\sessions\--D-dsh-auto-memory--"
$src = Join-Path $base ('0cc956d5-049a-4eff-9969-de69bf82fbc9\session.jsonl.zstd')
$dst = 'D:\dsh-auto-memory\_d2.jsonl'
zstd -dc $src 2>$null | Out-File $dst -Encoding UTF8
$t = Get-Content $dst -Raw -Encoding UTF8
[System.IO.File]::WriteAllText('D:\dsh-auto-memory\_d2_pretty.txt', ($t -replace '\}\,', "}" + [char]10))
Write-Output done