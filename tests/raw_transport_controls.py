"""Layer controls for the same synthetic Python fixture. No live AI requests."""
import contextlib
import io
import json
from pathlib import Path
import subprocess
import threading
import time
import urllib.request
from datetime import datetime,timezone
from http.server import ThreadingHTTPServer
from transport_client_matrix import Fixture,traces

ROOT=Path(__file__).resolve().parents[1]
server=ThreadingHTTPServer(('127.0.0.1',0),Fixture)
assert server.server_port not in (3000,8765,8787,8788,11434)
thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
script="""
const net=require('node:net');
function once(port,id){return new Promise(resolve=>{
 const r={client:'node-net',requestVersion:'HTTP/1.1',id,received:0,expected:null};let header=Buffer.alloc(0),ready=false,finished=false;const start=performance.now();
 const s=net.connect({host:'127.0.0.1',port:Number(port)});const timer=setTimeout(()=>finish('deadline'),5000);
 function finish(error){if(finished)return;finished=true;clearTimeout(timer);r.error=error??null;r.totalMs=performance.now()-start;r.complete=!error&&r.received===r.expected;s.end();s.destroy();resolve(r);}
 function body(c){r.received+=c.length;if(r.received===r.expected)finish();else if(r.received>r.expected)finish('excess');}
 s.on('connect',()=>s.write('GET /normal/2000044 HTTP/1.0\\r\\nHost: 127.0.0.1\\r\\nConnection: close\\r\\nX-Shahvex-Diagnostic-Id: '+id+'\\r\\n\\r\\n'));
 s.on('data',c=>{if(ready){body(c);return;}header=Buffer.concat([header,c]);const at=header.indexOf('\\r\\n\\r\\n');if(at<0){if(header.length>8192)finish('headers too large');return;}const match=/content-length:\\s*(\\d+)/i.exec(header.subarray(0,at).toString('ascii'));if(!match){finish('no length');return;}r.expected=Number(match[1]);ready=true;body(header.subarray(at+4));header=Buffer.alloc(0);});
 s.on('end',()=>{if(!finished)finish('premature end');});s.on('error',e=>finish(e.code));
 });}
(async()=>{for(let n=1;n<=10;n++)console.log(JSON.stringify(await once(process.argv[1],'raw-'+n)));})().catch(()=>process.exitCode=1);
"""
try:
    with contextlib.redirect_stdout(io.StringIO()):
        result=subprocess.run(['node','-e',script,str(server.server_port)],cwd=ROOT,capture_output=True,text=True,check=True,timeout=60)
        rows=[json.loads(l) for l in result.stdout.splitlines()]
        for n in range(10):
            start=time.perf_counter();row={'client':'python-urllib','id':'python-'+str(n+1),'received':0,'expected':None}
            try:
                req=urllib.request.Request(f'http://127.0.0.1:{server.server_port}/normal/2000044',headers={'X-Shahvex-Diagnostic-Id':row['id']})
                with urllib.request.urlopen(req,timeout=5) as response:
                    row['expected']=int(response.headers['Content-Length'])
                    while True:
                        chunk=response.read(65536)
                        if not chunk:break
                        row['received']+=len(chunk)
                row['complete']=row['received']==row['expected']
            except Exception as e:row.update(complete=False,errorType=type(e).__name__)
            row['totalMs']=(time.perf_counter()-start)*1000;rows.append(row)
    output=ROOT/'dist'/('transport-raw-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')+'.json')
    output.write_text(json.dumps({'synthetic':True,'productionRequests':0,'clients':rows,'server':traces},indent=2))
    print(str(output))
    for client in ('node-net','python-urllib'):
        sub=[r for r in rows if r['client']==client];print(json.dumps({'client':client,'attempts':len(sub),'complete':sum(r['complete'] for r in sub),'failures':[r for r in sub if not r['complete']]}))
finally:server.shutdown();server.server_close();thread.join()
