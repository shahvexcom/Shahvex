[CmdletBinding()]
param()
$ErrorActionPreference='Stop'
$repoRoot=Split-Path $PSScriptRoot -Parent
$store=Join-Path $repoRoot '.data\pc-ai'
$mutex=[Threading.Mutex]::new($false,'Local\Shahvex-PcAi-Watchdog')
if(!$mutex.WaitOne(0)) { exit 0 }
$wslProcess=$null
try {
  while($true) {
    try {
      if(!$wslProcess -or $wslProcess.HasExited) {
        # An explicit long-lived WSL command keeps the distro alive. systemd
        # services alone do not guarantee WSL stays running.
        $wslProcess=Start-Process -FilePath "$env:SystemRoot\System32\wsl.exe" -ArgumentList @('-d','Ubuntu-24.04','--exec','/bin/sleep','infinity') -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $store 'wsl-keepalive.stdout.log') -RedirectStandardError (Join-Path $store 'wsl-keepalive.stderr.log')
      }
      $occupied=$false
      $probe=[Net.Sockets.TcpClient]::new()
      try { $occupied=$probe.ConnectAsync('127.0.0.1',8774).Wait(2000) -and $probe.Connected } catch {} finally { $probe.Dispose() }
      if(!$occupied) { & (Join-Path $PSScriptRoot 'Start-PcAiAdapter.ps1') -Action Start }
      @{checkedAt=[DateTime]::UtcNow.ToString('o');identity=[Security.Principal.WindowsIdentity]::GetCurrent().Name;wslPid=$wslProcess.Id;adapterListener=$occupied} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $store 'watchdog-status.json')
    } catch { ([DateTime]::UtcNow.ToString('o')+' Startup check failed; retrying.') | Add-Content -LiteralPath (Join-Path $store 'watchdog-errors.log') }
    Start-Sleep -Seconds 15
  }
} finally { $mutex.ReleaseMutex();$mutex.Dispose() }
