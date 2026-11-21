#!/usr/bin/env bash
set -euo pipefail
# Run as root inside this computer's Ubuntu WSL; no production VICIdial changes.
project=/mnt/e/Shahvex
node_home=/opt/shahvex-node
if [ ! -x "$node_home/bin/node" ]; then
  work=$(mktemp -d)
  cd "$work"
  curl -fsSLO https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt
  archive=$(awk '$2 ~ /^node-v22\..*-linux-x64.tar.xz$/ {print $2; exit}' SHASUMS256.txt)
  test -n "$archive"
  curl -fsSLO "https://nodejs.org/dist/latest-v22.x/$archive"
  grep "  $archive$" SHASUMS256.txt | sha256sum -c -
  mkdir -p "$node_home"
  tar -xJf "$archive" --strip-components=1 -C "$node_home"
fi
install -d -o asterisk -g asterisk -m 0750 /var/lib/shahvex-vicidial
install -d /opt/shahvex-vicidial
install -d /var/lib/asterisk/agi-bin
for file in manual-test-server.cjs server.cjs ai-recording.cjs input-speech.cjs; do
  install -m 0644 "$project/deployment/vicidial-bridge/$file" /opt/shahvex-vicidial/
done
install -m 0755 "$project/deployment/vicidial-bridge/register-call.py" /var/lib/asterisk/agi-bin/register-call.py
python3 - <<'PY'
import json, os, secrets
agi_path='/var/lib/asterisk/agi-bin/register-call.py'
with open(agi_path,'rb') as source: agi_source=source.read().replace(b'\r\n',b'\n')
with open(agi_path,'wb') as target: target.write(agi_source)
config_path='/etc/shahvex-vicidial-manual.json'
if not os.path.exists(config_path):
    config=json.load(open('/mnt/e/Shahvex/deployment/vicidial-bridge/manual-test.json.example'))
    config.update(enabled=True,secret=secrets.token_hex(32),testWindowSeconds=900)
    config['tester'].update(url='http://127.0.0.1:8774/',secret=secrets.token_hex(32))
    config['agent'].update(name='Jennifer',voice='jennifer',script='You are Jennifer, an AI assistant for Shahvex. This is a local audio connection test. Explain that this call tests two-way audio with the AI assistant. Ask whether the caller can hear you clearly. Answer questions briefly and truthfully. Do not collect personal details, make offers, or transfer calls. When the caller finishes testing, thank them and end the conversation.')
    with open(config_path,'w') as out: json.dump(config,out,indent=2)
    os.chmod(config_path,0o640)
config=json.load(open(config_path))
with open('/etc/shahvex-local-tester.env','w') as out:
    out.write('SHAHVEX_PC_AI_SECRET='+config['tester']['secret']+'\nSHAHVEX_PC_TESTER_PORT=8774\n')
os.chmod('/etc/shahvex-local-tester.env',0o600)
PY
chown root:asterisk /etc/shahvex-vicidial-manual.json
cat > /etc/systemd/system/shahvex-local-tester.service <<'UNIT'
[Unit]
Description=Shahvex local isolated AI tester
After=network.target
[Service]
WorkingDirectory=/mnt/e/Shahvex
EnvironmentFile=/etc/shahvex-local-tester.env
ExecStart=/opt/shahvex-node/bin/node /mnt/e/Shahvex/gateway/tester-service.cjs
Restart=no
UNIT
cat > /etc/systemd/system/shahvex-local-audio-test.service <<'UNIT'
[Unit]
Description=Shahvex local manual AudioSocket test (15 minute window)
After=shahvex-local-tester.service
Requires=shahvex-local-tester.service
[Service]
User=asterisk
Group=asterisk
WorkingDirectory=/opt/shahvex-vicidial
ExecStart=/opt/shahvex-node/bin/node /opt/shahvex-vicidial/manual-test-server.cjs /etc/shahvex-vicidial-manual.json
Restart=no
UMask=0077
UNIT
install -m 0644 "$project/deployment/vicidial-bridge/extensions-manual-test.conf.example" /etc/asterisk/extensions-shahvex-manual.conf
python3 - <<'PY'
from pathlib import Path
p=Path('/etc/asterisk/extensions.conf')
text=p.read_text()
if '#include extensions-shahvex-manual.conf' not in text:
    Path('/etc/asterisk/extensions.conf.before-shahvex-test').write_text(text)
    text += '\n#include extensions-shahvex-manual.conf\n[public](+)\ninclude => shahvex-ai-manual-test\n[default](+)\ninclude => shahvex-ai-manual-test\n'
    p.write_text(text)
PY
systemctl daemon-reload
systemctl restart shahvex-local-tester
systemctl restart shahvex-local-audio-test
asterisk -rx 'dialplan reload'
sleep 2
systemctl is-active shahvex-local-tester shahvex-local-audio-test
asterisk -rx 'dialplan show 3524@public'
