[CmdletBinding()]
param()
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$health=Invoke-RestMethod 'http://127.0.0.1:8776/candidate/health' -TimeoutSec 5
if(!$health.ready -or $health.mode -ne 'native-first-chunk-reset'){throw 'Separate local TTS candidate is not ready'}
$probe=[Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,3002)
try{$probe.Start()}finally{$probe.Stop()}
$env:SHAHVEX_LOCAL_FAST_TTS='1'
$env:SHAHVEX_PHRASE_STREAM='1'
$env:SHAHVEX_PC_AI_URL=''
$cli=Join-Path $root 'node_modules\next\dist\bin\next'
$preview=Start-Process -FilePath (Get-Command node.exe).Source -ArgumentList @(('"'+$cli+'"'),'start','--hostname','127.0.0.1','--port','3002') -WorkingDirectory $root -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $root '.data\pc-ai\native-local-next.stdout.log') -RedirectStandardError (Join-Path $root '.data\pc-ai\native-local-next.stderr.log')
@{pid=$preview.Id;startedAt=$preview.StartTime.ToUniversalTime().ToString('o');port=3002;ttsPort=8776} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $root '.data\pc-ai\native-local-next.json')
Write-Output 'Separate local candidate preview launched on loopback 3002; live adapter unchanged.'
