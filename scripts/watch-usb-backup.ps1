param([Parameter(Mandatory=$true)][int]$BackupProcessId)
$destination='F:\Shahvex-Backup'
$statusPath=Join-Path $destination 'BACKUP-STATUS.txt'
while (Get-Process -Id $BackupProcessId -ErrorAction SilentlyContinue) {
  $progress=@('IN PROGRESS - keep this USB connected and PC running.')
  foreach($name in @('Shahvex-project.tar.partial','Shahvex-project.tar','Windows-AI-files.tar.partial','Windows-AI-files.tar','Ubuntu-24.04.tar.gz','website-postgresql.dump')) {
    $file=Get-Item -LiteralPath (Join-Path $destination $name) -ErrorAction SilentlyContinue
    if($file){$progress+=('{0}: {1:N2} GB' -f $name,($file.Length/1GB))}
  }
  $progress | Set-Content -LiteralPath $statusPath
  Start-Sleep -Seconds 20
}
if(Test-Path -LiteralPath (Join-Path $destination 'BACKUP-RESULT.txt')) {
  'COMPLETE - read BACKUP-RESULT.txt. Native Ubuntu restore has not yet been tested.' | Set-Content -LiteralPath $statusPath
} else {
  'STOPPED BEFORE COMPLETION - do not erase Windows or source data. Ask to inspect the backup errors.' | Set-Content -LiteralPath $statusPath
}
