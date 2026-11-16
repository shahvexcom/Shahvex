$ErrorActionPreference = 'Stop'
$usb = Get-Volume -DriveLetter F
if ($usb.FileSystemLabel -ne 'PHILIPS' -or $usb.SizeRemaining -lt 70GB) { throw 'Expected PHILIPS USB with at least 70 GB free.' }
$destination = 'F:\Shahvex-Backup'
New-Item -ItemType Directory -Force -Path $destination | Out-Null
$status = Join-Path $destination 'BACKUP-IN-PROGRESS.txt'
'Backup is incomplete. Do not erase Windows or the original disk.' | Set-Content -LiteralPath $status
Write-Output 'Preparing Linux inventory and separate website database backup...'
wsl -d Ubuntu-24.04 -u root -- bash /mnt/e/Shahvex/scripts/prepare-usb-migration.sh
if ($LASTEXITCODE -ne 0) { throw 'Linux preparation failed. Original data remains unchanged.' }
foreach ($source in @('E:\Shahvex','C:\Shahvex-AI')) {
  if (Test-Path -LiteralPath $source) {
    $name = Split-Path $source -Leaf
    $fileName = if ($name -eq 'Shahvex') {'Shahvex-project.tar'} else {'Windows-AI-files.tar'}
    $projectArchive = Join-Path $destination $fileName
    if (Test-Path -LiteralPath $projectArchive) { throw "Existing archive found: $fileName. Refusing overwrite." }
    Write-Output "Archiving complete $source..."
    tar -cf "$projectArchive.partial" -C (Split-Path $source -Parent) $name
    if ($LASTEXITCODE -ne 0) { throw "Archive failed for $source. Backup incomplete." }
    Move-Item -LiteralPath "$projectArchive.partial" -Destination $projectArchive
    Write-Output "Verifying $fileName..."
    tar -tf $projectArchive > (Join-Path $destination "inventory\$name-archive-contents.txt")
    if ($LASTEXITCODE -ne 0) { throw "Archive listing failed for $source." }
  }
}
foreach ($name in @('.cloudflared','.ssh')) {
  $source = Join-Path 'C:\Users\Nazeer Ahmed' $name
  if (Test-Path -LiteralPath $source) {
    $settingsLog = Join-Path $destination "$name-copy.log"
    robocopy $source (Join-Path $destination "windows-settings\$name") /E /COPY:DAT /DCOPY:D /FFT /XJ /R:1 /W:1 /NP /NFL /NDL "/LOG:$settingsLog"
    if ($LASTEXITCODE -ge 8) { throw "Settings copy failed: $name" }
  }
}
$archive = Join-Path $destination 'Ubuntu-24.04.tar.gz'
if (Test-Path -LiteralPath $archive) { throw 'Existing Ubuntu archive found; refusing to overwrite.' }
Write-Output 'Stopping WSL services and exporting complete Ubuntu. Keep USB connected...'
wsl --shutdown
if ($LASTEXITCODE -ne 0) { throw 'WSL shutdown failed.' }
wsl --export Ubuntu-24.04 $archive --format tar.gz
if ($LASTEXITCODE -ne 0) { throw 'WSL export failed. Backup incomplete.' }
Write-Output 'Reading archive to verify integrity. This can take time...'
tar -tf $archive > (Join-Path $destination 'inventory\ubuntu-archive-contents.txt')
if ($LASTEXITCODE -ne 0) { throw 'Ubuntu archive verification failed.' }
Write-Output 'Calculating SHA256 fingerprints...'
Get-FileHash -Algorithm SHA256 -LiteralPath $archive,(Join-Path $destination 'website-postgresql.dump'),(Join-Path $destination 'Shahvex-project.tar'),(Join-Path $destination 'Windows-AI-files.tar') | Format-List | Out-File (Join-Path $destination 'SHA256.txt')
@'
USB backup completed: all archives were listed successfully and SHA256 fingerprints saved; database export listed.
No full native Ubuntu restore has been performed. Keep original data until restoration is tested.
Ubuntu-24.04.tar.gz contains the Linux filesystem, models and installed environments.
Shahvex-project.tar contains all of E:\Shahvex including hidden .env and .git; Windows-AI-files.tar contains C:\Shahvex-AI.
The raw Shahvex folder is an INCOMPLETE earlier copy: use the verified project archive for restoration.
website-postgresql.dump is the separate Neon PostgreSQL logical backup.
This USB contains private credentials. Keep it secure; do not use it as the Ubuntu installer USB.
C, D and E are partitions of the same ADATA disk. Erase Disk can delete all three.
Native Ubuntu requires compatible GPU drivers and some environment/path setup; existing model weights can be restored without downloading again.
'@ | Set-Content -LiteralPath (Join-Path $destination 'BACKUP-RESULT.txt')
Remove-Item -LiteralPath $status
Write-Output 'BACKUP COMPLETE. Review BACKUP-RESULT.txt on USB. Do not erase the source until restore is planned.'
