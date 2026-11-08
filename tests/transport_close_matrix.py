"""Synthetic loopback close-lifecycle differential; never accesses AI services."""
import contextlib
import io
import json
from pathlib import Path
import socket
import subprocess
import threading
import time
from datetime import datetime,timezone
from http.server import ThreadingHTTPServer
from transport_client_matrix import Fixture,traces

ROOT=Path(__file__).resolve().parents[1]
closed=[]
class Graceful(ThreadingHTTPServer):
    def shutdown_request(self,request):
        began=time.perf_counter();row={'startedUnixMs':time.time_ns()//1000000,'peerEof':False,'graceLimitMs':250}
        try:
            request.shutdown(socket.SHUT_WR)
            deadline=time.perf_counter()+.25
            # Bound both time and unexpected pipelined bytes; never retry writes.
            for _ in range(4):
                remaining=deadline-time.perf_counter()
                if remaining<=0:break
                request.settimeout(remaining)
                if not request.recv(1024):row['peerEof']=True;break
        except OSError as e:row['errorType']=type(e).__name__;row['errno']=e.errno
        finally:
            self.close_request(request);row['durationMs']=(time.perf_counter()-began)*1000;closed.append(row)

def main():
    servers=[ThreadingHTTPServer(('127.0.0.1',0),Fixture),Graceful(('127.0.0.1',0),Fixture)]
    threads=[]
    for server in servers:
        assert server.server_port not in (3000,8765,8787,8788,11434)
        t=threading.Thread(target=server.serve_forever,daemon=True);t.start();threads.append(t)
    script="""
const {probe}=require('./gateway/transport-probe.cjs');
(async()=>{
for(let repeat=1;repeat<=5;repeat++)for(const mode of ['normal','normal11'])for(const size of [232364,2000044])for(const client of ['fetch','http'])for(const variant of (repeat%2?['immediate','graceful']:['graceful','immediate'])){
 const base=process.argv[variant==='immediate'?1:2];
 console.log(JSON.stringify({...await probe(base+'/'+mode+'/'+size,{client,timeoutMs:5000,id:client+'-'+variant+'-'+mode+'-'+size+'-'+repeat}),variant,mode,size,repeat}));
}})().catch(()=>process.exitCode=1);
"""
    try:
        with contextlib.redirect_stdout(io.StringIO()):
            result=subprocess.run(['node','-e',script,*[f'http://127.0.0.1:{s.server_port}' for s in servers]],cwd=ROOT,capture_output=True,text=True,check=True,timeout=120)
        rows=[json.loads(line) for line in result.stdout.splitlines()]
        output=ROOT/'dist'/('transport-close-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')+'.json')
        output.write_text(json.dumps({'synthetic':True,'productionRequests':0,'clients':rows,'server':traces,'gracefulClosures':closed},indent=2))
        print(str(output))
        for variant in ('immediate','graceful'):
            for client in ('fetch','http'):
                subset=[r for r in rows if r['variant']==variant and r['client']==client]
                print(json.dumps({'variant':variant,'client':client,'attempts':len(subset),'complete':sum(r['integrity'] for r in subset),'failures':[{'id':r['id'],'received':r['receivedBytes'],'expected':r['declaredBytes'],'abort':r['abortObserved']} for r in subset if not r['integrity']]}))
    finally:
        for s in servers:s.shutdown();s.server_close()
        for t in threads:t.join()

if __name__=='__main__':main()
