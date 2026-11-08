"""Strict error/cancellation assertions; synthetic ephemeral server only."""
import json
from pathlib import Path
import subprocess
import threading
from datetime import datetime,timezone
from http.server import ThreadingHTTPServer
from transport_client_matrix import Fixture,traces
ROOT=Path(__file__).resolve().parents[1]
server=ThreadingHTTPServer(('127.0.0.1',0),Fixture)
assert server.server_port not in (3000,8765,8787,8788,11434)
thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
script="""
const {probe}=require('./gateway/transport-probe.cjs');
(async()=>{for(const client of ['fetch','http','http-window'])for(const mode of ['truncate','reset','length-long','length-short','cancel','timeout'])console.log(JSON.stringify({...await probe(process.argv[1]+'/'+mode+'/232364',{client,id:client+'-'+mode,timeoutMs:mode==='timeout'?25:5000,...(mode==='cancel'?{abortAfterMs:25}:{})}),mode}));})().catch(()=>process.exitCode=1);
"""
try:
    completed=subprocess.run(['node','-e',script,f'http://127.0.0.1:{server.server_port}'],cwd=ROOT,capture_output=True,text=True,check=True,timeout=30)
    rows=[json.loads(l) for l in completed.stdout.splitlines()]
    output=ROOT/'dist'/('transport-faults-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')+'.json')
    output.write_text(json.dumps({'synthetic':True,'productionRequests':0,'clients':rows,'server':traces},indent=2))
    assert len(rows)==18
    for r in rows:
        assert not(r['integrity'] and r.get('wavLengthIntegrity',False)),r
        if r['mode']=='cancel':assert r.get('intentionalCancel') and r['abortObserved'],r
        if r['mode']=='timeout':assert r['abortObserved'] and not r.get('intentionalCancel'),r
    print(str(output));print('PASS: 18 truncation/reset/length/cancellation/deadline cases rejected; no live services called')
finally:server.shutdown();server.server_close();thread.join()
