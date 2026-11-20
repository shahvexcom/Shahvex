#!/usr/bin/env python3
"""Read-only actual Next -> voice-service check. No config writes/restarts/call creation."""
import json
import os
from pathlib import Path
import re
import subprocess
import hashlib
import hmac
import time
import uuid
import urllib.request
import urllib.error
from urllib.parse import urlparse, urljoin

EXPECTED = 'REC413-source-v12'

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

def env_for(proc):
    return dict(p.decode(errors='replace').split('=', 1) for p in (proc/'environ').read_bytes().split(b'\0') if b'=' in p)

def effective_env(proc, root):
    startup=env_for(proc)
    # /proc/environ omits values Next loaded from env files after process launch.
    # Load those files with Next's own parser in an isolated read-only child.
    code="const{createRequire}=require('node:module');const r=createRequire(require.resolve('next/package.json'));(async()=>{const load=r('next/dist/server/config').default;const{PHASE_PRODUCTION_SERVER}=r('next/constants');const cfg=await load(PHASE_PRODUCTION_SERVER,process.cwd());let paths={};try{const ts=r('typescript');paths=ts.readConfigFile('tsconfig.json',ts.sys.readFile).config?.compilerOptions?.paths||{}}catch{};process.stdout.write('SHAHVEX_ENV_JSON'+JSON.stringify({env:process.env,distDir:cfg.distDir||'.next',paths}));})().catch(()=>process.exitCode=1);"
    result=subprocess.run([str((proc/'exe').resolve()),'-e',code],cwd=root,env=startup,capture_output=True,text=True,timeout=8)
    marker='SHAHVEX_ENV_JSON'
    if result.returncode!=0 or marker not in result.stdout:
        print('Next environment-file resolution unavailable; routing conclusion is incomplete.',flush=True)
        return startup,False,'.next',{}
    value=json.loads(result.stdout.rsplit(marker,1)[1])
    return value['env'],True,value['distDir'],value.get('paths',{})

def request_result(url, headers, body=None, revision_header='x-shahvex-flow-revision'):
    req = urllib.request.Request(url, data=body, headers=headers, method='POST' if body is not None else 'GET')
    opener = urllib.request.build_opener(NoRedirect())
    try:
        response = opener.open(req, timeout=6)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        raw = response.read(4096)
        try:
            data = json.loads(raw)
            if not isinstance(data, dict):
                data = {}
        except (ValueError, UnicodeError):
            data = {}
        return response.code, data, response.headers.get(revision_header, 'MISSING')

def safe_error(data, env):
    value = data.get('error') or data.get('message') or data.get('code')
    if not isinstance(value, str):
        return 'No structured error message'
    for name, secret in env.items():
        if any(word in name.upper() for word in ('SECRET', 'TOKEN', 'PASSWORD', 'KEY', 'DATABASE_URL', 'DIRECT_URL')) and len(secret) >= 8:
            value = value.replace(secret, '[redacted]')
    value = re.sub(r'https?://\S+', '[URL]', value)
    return re.sub(r'[\x00-\x1f\x7f]', ' ', value)[:180]

def probe(label, base, env, cloudflare=False):
    headers = {'x-shahvex-ai-key': env.get('SHAHVEX_PC_AI_SECRET', '')}
    if cloudflare:
        headers.update({'CF-Access-Client-Id': env.get('SHAHVEX_CF_CLIENT_ID', ''), 'CF-Access-Client-Secret': env.get('SHAHVEX_CF_CLIENT_SECRET', '')})
    status = None
    try:
        code, data, revision_header = request_result(urljoin(base, '/internal/status'), headers)
        revision = data.get('flowRevision', 'MISSING')
        status = (code, revision)
        print(label+' status HTTP:', code)
        print(label+' actual revision:', revision)
        if code != 200:
            print(label+' status error:', safe_error(data, env))
    except Exception as error:
        print(label+' status check:', type(error).__name__)
    # A deliberately nonexistent diagnostic session must be rejected before STT.
    # This never uses a real call/session or creates a session.
    headers.update({'x-shahvex-owner':'runtime-probe-readonly','x-shahvex-session':'runtime-probe-no-session','x-shahvex-turn':'runtime-probe-readonly','x-shahvex-turn-final':'1','content-type':'audio/wav'})
    try:
        code, data, revision_header = request_result(urljoin(base, '/tester/listen'), headers, b'')
        print(label+' listen route HTTP:', code)
        print(label+' listen route message:', safe_error(data, env))
        print(label+' listen response revision header:', revision_header)
        print(label+' shared-handler rejection matches expected:', code == 404 and data.get('error') == 'Test session expired. Start again.')
    except Exception as error:
        print(label+' listen route check:', type(error).__name__)
    return status

def inspect_build(root,dist_dir):
    server=root/dist_dir/'server'
    entries=list(server.glob('app/**/api/telephony/vicidial/route.js'))
    print('Compiled VICIdial route found in resolved build:',bool(entries),flush=True)
    if entries:
        sources=[]
        for entry in entries:
            files=[entry]
            trace=Path(str(entry)+'.nft.json')
            if trace.exists():
                try:
                    files.extend((entry.parent/item).resolve() for item in json.loads(trace.read_text()).get('files',[]) if item.endswith(('.js','.cjs','.mjs')) and 'node_modules/' not in item)
                except (OSError,ValueError):pass
            for file in files:
                try:
                    if file.is_file() and file.stat().st_size<15000000:sources.append(file.read_text(errors='replace'))
                except OSError:pass
        print('Traced call-route code contains expected revision:',any(EXPECTED in x for x in sources),flush=True)
        print('Traced call-route code contains flow-ready:',any('flow-ready' in x for x in sources),flush=True)
    shadows=[]
    for folder in ['lib','src/lib']:
        for stem in ['vicidial-callback','agent-test-session','agent-test-speculative','agent-context-answer']:
            for ext in ['.ts','.js','.cjs','.mjs']:
                if (root/folder/(stem+ext)).is_file():shadows.append(folder+'/'+stem+ext)
    print('Existing handler source candidates:',', '.join(shadows),flush=True)

def native_probe():
    print('\nSigned website listen-schema check (no call ID; cannot operate a real call):',flush=True)
    found=False
    for proc in Path('/proc').iterdir():
        if not proc.name.isdigit():continue
        try:
            args=[x.decode(errors='replace') for x in (proc/'cmdline').read_bytes().split(b'\0') if x]
            if not any(x.endswith('/tools/native-campaign-bridge.cjs') for x in args):continue
            config=json.loads(Path(args[-1]).read_text())
            base=config.get('websiteUrl','');key=config.get('secret','');connection=config.get('connectionId','')
            if base not in ('http://127.0.0.1:3000','http://127.0.0.1:3000/') or len(key)<32 or not connection:
                print('Protected bridge settings do not match this check; skipped.');continue
            found=True
            for with_final in [False,True]:
                body={'action':'listen','eventId':str(uuid.uuid4()),'externalCallId':uuid.uuid4().hex}
                if with_final:body['turnFinal']=True
                raw=json.dumps(body,separators=(',',':')).encode();stamp=str(int(time.time()*1000))
                sig=hmac.new(key.encode(),(stamp+'\nPOST\n/api/telephony/vicidial\n').encode()+raw,hashlib.sha256).hexdigest()
                headers={'content-type':'application/json','x-shahvex-connection':connection,'x-shahvex-timestamp':stamp,'x-shahvex-signature':sig}
                code,data,revision=request_result(urljoin(base,'/api/telephony/vicidial'),headers,raw,revision_header='x-shahvex-callback-revision')
                print('Website listen WITH final flag:' if with_final else 'Website listen WITHOUT final flag:',code,safe_error(data,{'SECRET':key}),flush=True)
                print('Website callback revision:',revision,flush=True)
                print('Current callback schema expected:',code==400 and data.get('error')=='Call ID required' and revision==EXPECTED,flush=True)
        except Exception as error:print('Signed schema check:',type(error).__name__,flush=True)
    if not found:print('Readable native bridge process/config unavailable.',flush=True)

def process_start(proc):
    boot = int(next(line.split()[1] for line in Path('/proc/stat').read_text().splitlines() if line.startswith('btime ')))
    # comm may contain spaces; field 22 is index 19 after the final closing parenthesis.
    ticks = float((proc/'stat').read_text().rsplit(')', 1)[1].split()[19])
    return boot + ticks / os.sysconf('SC_CLK_TCK')

def main():
    print('SHAHVEX ACTUAL ROUTE CHECK — expected', EXPECTED, flush=True)
    print('No files changed; no restarts; no real call/session used.', flush=True)
    found = False
    for proc in Path('/proc').iterdir():
        if not proc.name.isdigit():
            continue
        try:
            args = [p.decode(errors='replace') for p in (proc/'cmdline').read_bytes().split(b'\0') if p]
        except OSError:
            continue
        if not args or not (args[0].startswith('next-server') or any(arg.endswith('/next/dist/bin/next') for arg in args)):
            continue
        found = True
        print('\nWebsite PID:', proc.name, flush=True)
        try:
            root = (proc/'cwd').resolve()
            env, env_resolved, dist_dir, alias_paths = effective_env(proc, root)
            print("Next startup/current-file environment resolved:", env_resolved, flush=True)
            print('Resolved production build directory:', dist_dir, flush=True)
            print('Resolved @/* paths:', alias_paths.get('@/*', 'not configured'), flush=True)
            build = root/dist_dir/'BUILD_ID'
            inspect_build(root,dist_dir)
            for name in ['next.config.ts','next.config.js','next.config.mjs']:
                file=root/name
                if file.exists():
                    print('Next config modified after website start:', file.stat().st_mtime>process_start(proc)+2,flush=True)
            if build.exists():
                stale = process_start(proc) + 2 < build.stat().st_mtime
                print('Website process started BEFORE current build:', stale, flush=True)
                if stale:
                    print('ACTION: current build was produced after this process started. Restart the website through its existing launcher after finishing calls; the disk marker alone cannot prove loaded code.', flush=True)
            base = env.get('SHAHVEX_PC_AI_URL', '').strip()
            print('Website uses configured external PC voice adapter:', bool(base), flush=True)
            port = int(env.get('SHAHVEX_PC_TESTER_PORT', '8774'))
            if not 1 <= port <= 65535:
                raise ValueError('Invalid loopback port')
            local = probe('LOCAL TESTER', 'http://127.0.0.1:'+str(port)+'/', env)
            if base:
                url = urlparse(base)
                if url.scheme != 'https' or url.username or url.password or url.path not in ('', '/') or url.query or url.fragment:
                    print('Configured PC adapter does not match the allowed HTTPS root format; not probing it.')
                    continue
                print('Configured PC adapter host:', url.hostname, flush=True)
                remote = probe('WEBSITE-CONFIGURED ADAPTER', base, env, True)
                if local == (200, EXPECTED) and remote != (200, EXPECTED):
                    print('FINDING: website target is not verified as the same V11 tester. Updating the local tester does not update that target.', flush=True)
                elif remote == (200, EXPECTED):
                    print('FINDING: the configured adapter reports V11; listen-route result above distinguishes handler/proxy rejection.', flush=True)
            else:
                print('FINDING: resolved configuration has no PC adapter URL; voice sessions run in Next, so local tester status does not verify that worker.' if env_resolved else 'PC adapter URL is absent from readable startup environment; current file resolution failed, so the route remains unknown.', flush=True)
        except Exception as error:
            print('Website inspection failed:', type(error).__name__, flush=True)
    if not found:
        print('No readable running Next website process found. Run as the same Linux user as the website.')
    native_probe()
    print('\nSend this complete output. No credentials or full environment values are printed.', flush=True)

if __name__ == '__main__':
    main()
