"""Isolated socket matrix. No AI models, credentials or production HTTP requests."""
import contextlib
import io
import json
import os
from pathlib import Path
import socket
import struct
import subprocess
import threading
import time
import wave
from datetime import datetime,timezone
from http.server import ThreadingHTTPServer
from chatterbox_transport_test import handler_from,SOURCE

ROOT=Path(__file__).resolve().parents[1]
traces=[]
handler=handler_from(SOURCE.read_text())
class Fixture(handler):
    def log_message(self,*_):pass
    def do_GET(self):
        mode,size=self.path.strip('/').split('/');size=int(size)
        self.protocol_version='HTTP/1.1' if mode=='normal11' else 'HTTP/1.0'
        out=io.BytesIO()
        with wave.open(out,'wb') as f:
            f.setnchannels(1);f.setsampwidth(2);f.setframerate(24000);f.writeframes(b'\0'*(size-44))
        data=out.getvalue();declared=size+(128 if mode=='length-long' else -128 if mode=='length-short' else 0)
        trace={'id':self.headers.get('X-Shahvex-Diagnostic-Id'),'mode':mode,'declared':declared,'wavBytes':len(data),'completedWriteBytes':0}
        traces.append(trace);self.close_connection=True
        try:
            self.send_response(200);self.send_header('Content-Length',str(declared));self.send_header('Content-Type','audio/wav');self.send_header('Connection','close');self.end_headers()
            transfer=data[:195840] if mode in ('truncate','reset') else data
            for offset in range(0,len(transfer),65536):
                if mode in ('delayed','cancel','timeout') and offset:time.sleep(.05)
                block=transfer[offset:offset+65536];self.wfile.write(block);trace['completedWriteBytes']+=len(block)
            self.wfile.flush();trace['allWritesCompleted']=True
            if mode=='reset':self.connection.setsockopt(socket.SOL_SOCKET,socket.SO_LINGER,struct.pack('HH' if os.name=='nt' else 'ii',1,0));self.connection.close()
        except OSError as e:trace.update(errorType=type(e).__name__,errno=e.errno,winerror=getattr(e,'winerror',None))


def main():
    server=ThreadingHTTPServer(('127.0.0.1',0),Fixture)
    assert server.server_port not in (3000,8765,8787,8788,11434)
    thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
    script="""
    const {probe}=require('./gateway/transport-probe.cjs');
    (async()=>{
      for(let repeat=1;repeat<=3;repeat++)for(const client of ['fetch','fetch-gateway','fetch-reader','fetch-buffer','http','http-candidate'])for(const mode of ['normal','normal11'])
        console.log(JSON.stringify(await probe(process.argv[1]+'/'+mode+'/2000044',{client,id:client+'-'+mode+'-'+repeat,timeoutMs:5000})));
      for(const client of ['fetch','http','http-candidate'])for(const mode of ['normal','delayed','truncate','reset','length-long','length-short','cancel'])
        console.log(JSON.stringify(await probe(process.argv[1]+'/'+mode+'/232364',{client,id:client+'-'+mode,timeoutMs:5000,...(mode==='cancel'?{abortAfterMs:25}:{})})));
    })().catch(()=>process.exitCode=1);
    """
    try:
        completed=subprocess.run(['node','-e',script,f'http://127.0.0.1:{server.server_port}'],cwd=ROOT,capture_output=True,text=True,timeout=100,check=True)
        rows=[json.loads(l) for l in completed.stdout.splitlines()]
        output=ROOT/'dist'/('transport-matrix-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')+'.json')
        output.write_text(json.dumps({'synthetic':True,'productionRequests':0,'node':subprocess.check_output(['node','-p','process.version'],text=True).strip(),'clients':rows,'server':traces},indent=2))
        print(str(output))
        for client in ('fetch','fetch-gateway','fetch-reader','fetch-buffer','http','http-candidate'):
            normal=[r for r in rows if r['client']==client and ('-normal-' in r['id'] or '-normal11-' in r['id'])]
            print(json.dumps({'client':client,'normalAttempts':len(normal),'complete':sum(r['integrity'] and r.get('wavLengthIntegrity',False) for r in normal),'failures':[{k:r.get(k) for k in ('id','declaredBytes','receivedBytes','errorCode','abortObserved')} for r in normal if not r['integrity']]}))
        faults=[r for r in rows if not any(x in r['id'] for x in ('normal','delayed'))]
        assert all(not(r['integrity'] and r.get('wavLengthIntegrity',False)) for r in faults)
        assert all(r.get('intentionalCancel') for r in rows if r['id'].endswith('-cancel'))
        print('PASS: injected framing/closure/cancellation failures rejected; spontaneous normal failures retained as evidence, not hidden')
    finally:server.shutdown();server.server_close();thread.join()


if __name__=='__main__':main()
