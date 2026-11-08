"""Production Handler, fake synthesis, real loopback sockets and Node clients only."""
import contextlib
import hashlib
import io
import json
from pathlib import Path
import subprocess
import threading
import unittest
import wave
from datetime import datetime,timezone
from http.server import ThreadingHTTPServer
from chatterbox_transport_test import handler_from,SOURCE

class Tests(unittest.TestCase):
    def test_integrity_normal_truncated_reset_and_slow_body(self):
        traces=[]
        handler=handler_from(SOURCE.read_text())
        class Replay(handler):
            def log_message(self,*_): pass
            def do_GET(self):
                size=int(self.path.split('/')[-1]);wav=io.BytesIO()
                with wave.open(wav,'wb') as f:
                    f.setnchannels(1);f.setsampwidth(2);f.setframerate(24000);f.writeframes(b'\0'*(size-44))
                data=wav.getvalue();original=self.wfile;mode=self.path.split('/')[1]
                record={'mode':mode,'declared':len(data),'acceptedBytes':0};traces.append(record)
                class Sink:
                    def write(s,chunk):
                        # Header writes are passed intact; inject only WAV body faults.
                        if not getattr(s,'headers',False):
                            s.headers=True;return original.write(chunk)
                        remaining=195840-record['acceptedBytes']
                        if mode=='truncate' and remaining<len(chunk):
                            if remaining>0:original.write(chunk[:remaining]);record['acceptedBytes']+=remaining
                            raise ConnectionAbortedError(10053,'controlled write failure')
                        if mode=='slow':
                            import time;time.sleep(.02)
                        result=original.write(chunk);record['acceptedBytes']+=len(chunk);return result
                    def flush(s):return original.flush()
                    def __getattr__(s,name):return getattr(original,name)
                self.wfile=Sink()
                record['sent']=self.send_data(200,'audio/wav',data)
        server=ThreadingHTTPServer(('127.0.0.1',0),Replay);runner=threading.Thread(target=server.serve_forever,daemon=True);runner.start()
        base=f'http://127.0.0.1:{server.server_port}'
        script="const {probe}=require('./gateway/transport-probe.cjs');(async()=>{for(const client of ['fetch','http'])for(const mode of ['normal','slow','truncate'])for(const size of [211244,232364,2000044])console.log(JSON.stringify(await probe(process.argv[1]+'/'+mode+'/'+size,{client,timeoutMs:5000,id:client+'-'+mode+'-'+size})));})().catch(()=>process.exitCode=1);"
        try:
            with contextlib.redirect_stdout(io.StringIO()):
                completed=subprocess.run(['node','-e',script,base],capture_output=True,text=True,timeout=30,cwd=Path(__file__).resolve().parents[1],check=True)
            rows=[json.loads(line) for line in completed.stdout.splitlines()]
            output=Path(__file__).resolve().parents[1]/'dist/transport-isolated-lifecycle.json'
            output.write_text(json.dumps({'synthetic':True,'productionServicesUsed':False,'clients':rows,'server':traces},indent=2))
            journal=output.with_name('transport-isolated-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')+'.json')
            journal.write_bytes(output.read_bytes())
            self.assertEqual(len(rows),18)
            for row in rows:
                if '-truncate-' not in row['id']:
                    self.assertTrue(row['integrity'],json.dumps(row))
                    self.assertEqual(row['receivedBytes'],row['declaredBytes']);self.assertFalse(row['abortObserved'])
                else:
                    self.assertEqual(row['receivedBytes'],195840);self.assertEqual(row['missingBytes'],row['declaredBytes']-195840);self.assertFalse(row['abortObserved'])
            self.assertEqual(sum(r['integrity'] for r in rows),12)
            output=Path(__file__).resolve().parents[1]/'dist/transport-isolated-lifecycle.json'
            output.write_text(json.dumps({'synthetic':True,'productionServicesUsed':False,'clients':rows,'server':traces},indent=2))
            print('PASS: 12 exact normal/slow WAV transfers; 6 injected truncated transfers rejected; both clients; no native models loaded')
        finally:server.shutdown();server.server_close();runner.join()

if __name__=='__main__':unittest.main()
