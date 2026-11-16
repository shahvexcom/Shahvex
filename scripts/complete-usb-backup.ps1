$ErrorActionPreference='Stop'
$usb=Get-Volume -DriveLetter F
if($usb.FileSystemLabel -ne 'PHILIPS'){throw 'Expected PHILIPS USB F:'}
$destination='F:\Shahvex-Backup'
$stage='E:\Shahvex-Backup-Staging'
New-Item -ItemType Directory -Force -Path $stage,$destination | Out-Null
$log=Join-Path $destination 'backup-run.log'
Start-Transcript -Path $log -Append | Out-Null
try {
  'BUILDING complete website and AI archives on internal SSD. USB backup is not complete yet.' | Set-Content (Join-Path $destination 'BACKUP-STATUS.txt')
  wsl -d Ubuntu-24.04 -u root -- bash /mnt/e/Shahvex/scripts/build-migration-archives.sh
  if($LASTEXITCODE -ne 0){throw 'SSD archive creation failed. See staging archive error logs.'}
  $linux=Join-Path $stage 'Ubuntu-24.04.tar.gz'
  if(-not(Test-Path -LiteralPath $linux)) {
    'EXPORTING complete Ubuntu filesystem including AI models to internal SSD. Keep PC running.' | Set-Content (Join-Path $destination 'BACKUP-STATUS.txt')
    wsl --shutdown
    if($LASTEXITCODE -ne 0){throw 'WSL shutdown failed'}
    wsl --export Ubuntu-24.04 "$linux.partial" --format tar.gz
    if($LASTEXITCODE -ne 0){throw 'Ubuntu export failed'}
    Move-Item -LiteralPath "$linux.partial" -Destination $linux
  }
  tar -tf $linux > (Join-Path $stage 'ubuntu-archive-contents.txt')
  if($LASTEXITCODE -ne 0){throw 'Ubuntu archive validation failed'}
  foreach($name in @('Shahvex-project.tar','Windows-AI-files.tar','Ubuntu-24.04.tar.gz')) {
    "COPYING verified $name to USB. Keep PC running and USB connected." | Set-Content (Join-Path $destination 'BACKUP-STATUS.txt')
    $copyLog=Join-Path $stage "$name-copy.log"
    robocopy $stage $destination $name /J /R:1 /W:1 /COPY:DT /NP "/LOG:$copyLog"
    if($LASTEXITCODE -ge 8){throw "USB copy failed: $name"}
    $originalHash=(Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $stage $name)).Hash
    $usbHash=(Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $destination $name)).Hash
    if($originalHash -ne $usbHash){throw "USB checksum mismatch: $name"}
    "$usbHash  $name" | Add-Content -LiteralPath (Join-Path $destination 'VERIFIED-SHA256.txt')
  }
  if(-not(Test-Path -LiteralPath (Join-Path $destination 'website-postgresql.dump'))){throw 'Website database dump missing'}
  Copy-Item -LiteralPath (Join-Path $stage 'website-validation.json') -Destination (Join-Path $destination 'inventory\website-validation.json') -Force
  @'
BACKUP VERIFIED: website and Windows AI archives, complete Ubuntu filesystem/models, and separate Neon website database dump.
All three large archive USB SHA256 hashes matched their internal SSD originals.
Historical exceptions: .data/recovery/gateway-20261110-003104 is access-denied; backups/security/init.quarantined.txt and postcss.quarantined.txt are unreadable quarantine artifacts. These historical recovery/quarantine artifacts are not included; active website code is included.
Use Shahvex-project.tar, Windows-AI-files.tar and Ubuntu-24.04.tar.gz for restoration. The raw Shahvex folder and older .partial file are incomplete earlier attempts.
No native Ubuntu restore has been tested. Existing model weights are included; compatible GPU drivers and environment/path setup may still be required.
C, D, E share one physical disk. This is an AI/website backup, not a backup of all personal data on those partitions. Do not erase the original disk until the restore/install plan is checked.
Keep this USB private: it contains credentials. Use a different USB for the Ubuntu installer.
'@ | Set-Content -LiteralPath (Join-Path $destination 'BACKUP-RESULT.txt')
  'COMPLETE - USB archives verified. Read BACKUP-RESULT.txt for restore notes and historical exceptions.' | Set-Content (Join-Path $destination 'BACKUP-STATUS.txt')
  Remove-Item -LiteralPath (Join-Path $destination 'BACKUP-IN-PROGRESS.txt') -ErrorAction SilentlyContinue
  Write-Output 'USB BACKUP VERIFIED COMPLETE'
} catch {
  'FAILED BEFORE COMPLETION - source data remains intact. See backup-run.log and staging archive error logs.' | Set-Content (Join-Path $destination 'BACKUP-STATUS.txt')
  throw
} finally {Stop-Transcript | Out-Null}
