#!/usr/bin/env bash
set -euo pipefail
mountpoint -q /mnt/f || { mkdir -p /mnt/f; mount -t drvfs F: /mnt/f; }
dest=/mnt/f/Shahvex-Backup
mkdir -p "$dest/inventory"
dpkg-query -W > "$dest/inventory/ubuntu-packages.txt"
systemctl list-unit-files --no-pager > "$dest/inventory/ubuntu-services.txt"
find /etc/systemd/system -maxdepth 2 -type f > "$dest/inventory/service-files.txt"
nvidia-smi > "$dest/inventory/gpu.txt" 2>/dev/null || true
if ! command -v /usr/lib/postgresql/18/bin/pg_dump >/dev/null; then
  install -d /usr/share/postgresql-common/pgdg
  curl -fsS https://www.postgresql.org/media/keys/ACCC4CF8.asc -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc
  fingerprint=$(gpg --with-colons --show-keys /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc 2>/dev/null | awk -F: '$1=="fpr" {print $10; exit}')
  test "$fingerprint" = B97B0AFCAA1A47F044F244A07FCC7D46ACCC4CF8
  printf '%s\n' 'Types: deb' 'URIs: https://apt.postgresql.org/pub/repos/apt' 'Suites: noble-pgdg' 'Architectures: amd64' 'Components: main' 'Signed-By: /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc' > /etc/apt/sources.list.d/shahvex-backup-pgdg.sources
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends postgresql-client-18
fi
python3 - <<'PY'
import os, subprocess, urllib.parse, pathlib
values={}
for line in pathlib.Path('/mnt/e/Shahvex/.env').read_text().splitlines():
    if '=' in line and not line.lstrip().startswith('#'):
        key,value=line.split('=',1); values[key.strip()]=value.strip().strip('"').strip("'")
url=urllib.parse.urlsplit(values['DATABASE_URL'])
env=os.environ.copy()
env.update(PGHOST=url.hostname,PGPORT=str(url.port or 5432),PGUSER=urllib.parse.unquote(url.username or ''),PGPASSWORD=urllib.parse.unquote(url.password or ''),PGDATABASE=urllib.parse.unquote(url.path.lstrip('/')),PGSSLMODE='require',PGCONNECT_TIMEOUT='30')
target='/mnt/f/Shahvex-Backup/website-postgresql.dump'
if pathlib.Path(target).exists():
    subprocess.run(['/usr/lib/postgresql/18/bin/pg_restore','--list',target],stdout=subprocess.DEVNULL,check=True)
    print('Existing database backup archive verified; retained without overwrite')
    raise SystemExit(0)
result=subprocess.run(['/usr/lib/postgresql/18/bin/pg_dump','--format=custom','--no-owner','--no-acl','--file',target+'.partial'],env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
if result.returncode: raise SystemExit('Database backup failed; no credentials printed. Do not erase the source.')
os.rename(target+'.partial',target)
with open('/mnt/f/Shahvex-Backup/inventory/database-contents.txt','w') as out:
    subprocess.run(['/usr/lib/postgresql/18/bin/pg_restore','--list',target],stdout=out,check=True)
print('Database export and archive listing verified')
PY
sync
