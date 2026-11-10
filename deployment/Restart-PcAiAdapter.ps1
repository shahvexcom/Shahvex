[CmdletBinding()]
param()
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$store=Join-Path $root '.data\pc-ai'
$line=Get-Content -LiteralPath (Join-Path $store '.env.pc-ai') | Where-Object {$_ -like 'SHAHVEX_PC_AI_SECRET=*'}
$headers=@{'x-shahvex-ai-key'=$line.Substring('SHAHVEX_PC_AI_SECRET='.Length)}
$status=Invoke-RestMethod 'http://127.0.0.1:8774/internal/status' -Headers $headers -TimeoutSec 5
if($status.sessions -gt 0 -or $status.busy -gt 0){throw 'Active sessions exist; no restart performed'}
$record=Get-Content -LiteralPath (Join-Path $store 'process.json') -Raw | ConvertFrom-Json
$process=Get-CimInstance Win32_Process -Filter "ProcessId=$($record.pid)"
$expected=[DateTimeOffset]::Parse($record.startedAt).UtcDateTime
if($process.Name -ne 'node.exe' -or [Math]::Abs(($process.CreationDate.ToUniversalTime()-$expected).TotalMilliseconds) -gt 10){throw 'Adapter process identity mismatch'}
$result=Invoke-CimMethod -InputObject $process -MethodName Terminate
if($result.ReturnValue -ne 0){throw 'Windows denied adapter restart; run as Administrator'}
for($attempt=0;$attempt -lt 45;$attempt++){
  Start-Sleep -Seconds 1
  try{
    $newRecord=Get-Content -LiteralPath (Join-Path $store 'process.json') -Raw | ConvertFrom-Json
    if($newRecord.pid -ne $record.pid){
      $null=Invoke-RestMethod 'http://127.0.0.1:8774/internal/status' -Headers $headers -TimeoutSec 3
      @{reloadedAt=[DateTime]::UtcNow.ToString('o');pid=$newRecord.pid} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $store 'reload-result.json')
      Write-Output 'Idle adapter reloaded by watchdog; engines unchanged.'
      return
    }
  }catch{}
}
throw 'Watchdog restart not confirmed'
