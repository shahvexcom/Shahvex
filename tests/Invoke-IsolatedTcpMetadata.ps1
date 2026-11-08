param([Parameter(Mandatory=$true)][string]$FixtureDirectory,[switch]$Approved,[switch]$AllowHostWideTcpMetadata)
$ErrorActionPreference='Stop'
if(!$Approved){throw 'Explicit approval for elevated temporary TCP metadata tracing required'}
if(!$AllowHostWideTcpMetadata){throw 'Blocked: this profile is host-wide. Fixture-only approval does not authorize it. Separate explicit approval for unrelated TCP metadata is required.'}
$identity=[Security.Principal.WindowsIdentity]::GetCurrent()
if(!([Security.Principal.WindowsPrincipal]::new($identity)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'Run only this capture terminal as Administrator after approval'}
$root=(Resolve-Path -LiteralPath $FixtureDirectory).Path
$workspace=(Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\dist')).Path.TrimEnd('\')+'\'
if(!$root.StartsWith($workspace,[StringComparison]::OrdinalIgnoreCase)){throw 'Fixture directory must be inside repository dist'}
$ready=Get-Content -LiteralPath (Join-Path $root 'ready.json') -Raw | ConvertFrom-Json
if($ready.productionRequests -ne 0 -or $ready.responseBytes -ne 65324 -or $ready.port -in @(3000,8765,8787,8788,11434)){throw 'Unexpected fixture'}
if(([DateTime]::UtcNow-(Get-Item -LiteralPath (Join-Path $root 'ready.json')).LastWriteTimeUtc).TotalSeconds -gt 110){throw 'Fixture readiness expired'}
$process=Get-CimInstance Win32_Process -Filter "ProcessId = $($ready.fixturePid)"
if(!$process -or $process.CommandLine -notmatch 'transport_tcp_trace_fixture\.py'){throw 'Fixture process identity changed'}
$listeners=@(Get-NetTCPConnection -State Listen -LocalPort $ready.port -ErrorAction Stop)
if($listeners.Count -ne 1 -or $listeners[0].LocalAddress -ne '127.0.0.1' -or $listeners[0].OwningProcess -ne $ready.fixturePid){throw 'Unexpected isolated fixture listener'}
if(Test-Path -LiteralPath (Join-Path $root 'capture-go')){throw 'Fixture already started; use a new run directory'}
& (Join-Path $PSScriptRoot 'Review-TcpMetadata.ps1') -Output (Join-Path $root 'schema-review.json')
$profile=(Join-Path $PSScriptRoot 'Shahvex-TcpMetadata.wprp')+'!ShahvexTcp'
$instance='ShahvexSyntheticTcp-'+[Guid]::NewGuid().ToString('N')
$etl=Join-Path $root 'tcp-metadata.etl'
$owned=$false
try{
  & wpr.exe -start $profile -instancename $instance
  if($LASTEXITCODE -ne 0){throw 'Trace start failed; fixture was not triggered'}
  $owned=$true
  @{instance=$instance;startedUtc=[DateTime]::UtcNow.ToString('o');fixturePort=$ready.port} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $root 'trace-owner.json')
  New-Item -ItemType File -Path (Join-Path $root 'capture-go') | Out-Null
  $deadline=[DateTime]::UtcNow.AddSeconds(55)
  while(!(Test-Path -LiteralPath (Join-Path $root 'done')) -and [DateTime]::UtcNow -lt $deadline){Start-Sleep -Milliseconds 200}
}finally{
  if($owned){
    & wpr.exe -stop $etl -skipPdbGen -instancename $instance
    if($LASTEXITCODE -ne 0){Write-Warning "Own trace stop failed. Retry only: wpr -stop `"$etl`" -skipPdbGen -instancename $instance"}
  }
}
Write-Host 'Only the owned temporary trace was stopped. No service or network setting changed. Trace analysis is still required.'
