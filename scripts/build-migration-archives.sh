#!/usr/bin/env bash
set -euo pipefail
stage=/mnt/e/Shahvex-Backup-Staging
mkdir -p "$stage"
if [ ! -f "$stage/Shahvex-project.tar" ] && [ ! -f "$stage/Shahvex-project.tar.partial" ]; then
  tar -cf "$stage/Shahvex-project.tar.partial" \
    --exclude='Shahvex/.data/recovery/gateway-20261110-003104' \
    --exclude='Shahvex/backups/security/init.quarantined.txt' \
    --exclude='Shahvex/backups/security/postcss.quarantined.txt' \
    -C /mnt/e Shahvex 2> "$stage/website-archive-errors.log"
fi
python3 - <<'PY'
import os, pathlib, tarfile, json
root=pathlib.Path('/mnt/e/Shahvex')
excluded={'Shahvex/.data/recovery/gateway-20261110-003104','Shahvex/backups/security/init.quarantined.txt','Shahvex/backups/security/postcss.quarantined.txt'}
final=pathlib.Path('/mnt/e/Shahvex-Backup-Staging/Shahvex-project.tar')
candidate=final if final.exists() else pathlib.Path(str(final)+'.partial')
with tarfile.open(candidate) as archive:
    names={member.name.rstrip('/') for member in archive}
missing=[]
def fail(error): raise error
for directory,dirs,files in os.walk(root,onerror=fail):
    prefix='Shahvex/'+str(pathlib.Path(directory).relative_to(root)).replace('\\','/')
    prefix=prefix.rstrip('/.')
    dirs[:]=[d for d in dirs if prefix+'/'+d not in excluded]
    for file in files:
        relative=prefix+'/'+file
        if relative not in excluded and relative not in names: missing.append(relative)
pathlib.Path('/mnt/e/Shahvex-Backup-Staging/website-validation.json').write_text(json.dumps({'archiveEntries':len(names),'missingReadableFiles':missing,'excludedHistoricalPaths':sorted(excluded)},indent=2))
if missing: raise SystemExit('Website archive missing current source files; do not erase source')
if candidate!=final: candidate.rename(final)
print('Website archive validated against all readable current source files')
PY
if [ ! -f "$stage/Windows-AI-files.tar" ]; then
  tar -cf "$stage/Windows-AI-files.tar.partial" -C /mnt/c Shahvex-AI 2> "$stage/windows-ai-archive-errors.log"
  mv "$stage/Windows-AI-files.tar.partial" "$stage/Windows-AI-files.tar"
fi
tar -tf "$stage/Windows-AI-files.tar" > "$stage/windows-ai-archive-contents.txt"
sync
echo 'Website and Windows AI archives ready on SSD'
