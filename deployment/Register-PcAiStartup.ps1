[CmdletBinding()]
param()
$ErrorActionPreference='Stop'
$repoRoot=Split-Path $PSScriptRoot -Parent
$account=[Security.Principal.WindowsIdentity]::GetCurrent().Name
if($account -match 'CodexSandbox') { throw 'Register under the actual Windows user who owns the Ubuntu distro.' }
$script=Join-Path $PSScriptRoot 'Watch-PcAi.ps1'
$action=New-ScheduledTaskAction -Execute "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -Argument ('-NoProfile -NonInteractive -WindowStyle Hidden -File "'+$script+'"') -WorkingDirectory $repoRoot
$boot=New-ScheduledTaskTrigger -AtStartup
$boot.Delay='PT30S'
$logon=New-ScheduledTaskTrigger -AtLogOn -User $account
$principal=New-ScheduledTaskPrincipal -UserId $account -LogonType S4U -RunLevel Limited
$settings=New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName 'Shahvex-PC-AI-Autostart' -Action $action -Trigger @($boot,$logon) -Principal $principal -Settings $settings -Description 'Start WSL AI services and maintain the authenticated loopback PC adapter.' -Force | Out-Null
Start-ScheduledTask -TaskName 'Shahvex-PC-AI-Autostart'
@{registeredAt=[DateTime]::UtcNow.ToString('o');account=$account;task='Shahvex-PC-AI-Autostart'} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $repoRoot '.data\pc-ai\startup-registration.json')
Write-Output 'Boot/logon startup task registered under the Ubuntu-owning Windows user; verification pending.'
