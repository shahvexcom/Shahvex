"""Metadata-only exact-size synthetic replay of reviewed Python send_data. No AI imports/requests."""
import contextlib
import hashlib
import inspect
import io
import json
import socket
import socketserver
import subprocess
import threading
import time
import wave
from datetime import datetime, timezone
from http.server import ThreadingHTTPServer
from pathlib import Path
from chatterbox_transport_test import handler_from

ROOT = Path(__file__).resolve().parents[1]
SOURCE = Path(r'C:\Shahvex-AI\chatterbox-testing\chatterbox_voice_server.py')
records = []
sockets = {}
base = handler_from(SOURCE.read_text())


class Replay(base):
    def log_message(self, *_):
        pass

    def send_header(self, name, value):
        if name.lower() == 'content-length' and self.mode == 'overdeclare44':
            value = str(int(value) + 44)
        return super().send_header(name, value)

    def do_POST(self):
        self.mode, size = self.path.strip('/').split('/')
        size = int(size)
        assert size in (65324, 2000044)
        self.rfile.read(int(self.headers['Content-Length']))
        out = io.BytesIO()
        with wave.open(out, 'wb') as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(24000)
            w.writeframes(bytes((i * 17) % 256 for i in range(size - 44)))
        data = out.getvalue()
        trace = {'id': self.headers.get('X-Diagnostic-Id'), 'mode': self.mode,
                 'clientPort': self.client_address[1], 'serverPort': self.server.server_port,
                 'wavBytes': len(data), 'expectedSha256': hashlib.sha256(data).hexdigest(),
                 'writes': [], 'acceptedBytes': 0, 'atUnixMs': time.time_ns() // 1000000}
        records.append(trace)
        sockets[id(self.connection)] = trace
        original = self.wfile
        began = time.perf_counter()

        class Sink:
            headers = False

            def write(s, block):
                if not s.headers:
                    s.headers = True
                    trace['headerBytes'] = len(block)
                    return original.write(block)
                if self.mode in ('delayed', 'cancel'):
                    time.sleep(.08)
                if self.mode == 'drop44':
                    sent = original.write(block[:-44])
                    trace['acceptedBytes'] += sent
                    trace['writes'].append({'requested': len(block), 'accepted': sent})
                    raise ConnectionAbortedError('synthetic final 44-byte loss')
                sent = original.write(block)
                trace['acceptedBytes'] += sent
                trace['writes'].append({'requested': len(block), 'accepted': sent,
                                        'ms': (time.perf_counter() - began) * 1000})
                return sent

            def __getattr__(s, name):
                return getattr(original, name)

        self.wfile = Sink()
        trace['sendDataReturned'] = self.send_data(200, 'audio/wav', data)
        trace['sendCompleteMs'] = (time.perf_counter() - began) * 1000
        trace['closeRequested'] = self.close_connection
        self.wfile = original


class Server(ThreadingHTTPServer):
    def shutdown_request(self, request):
        trace = sockets.get(id(request))
        if trace is not None:
            trace['socketShutdownBeginUnixMs'] = time.time_ns() // 1000000
        try:
            super().shutdown_request(request)
        finally:
            if trace is not None:
                trace['socketShutdownReturnedUnixMs'] = time.time_ns() // 1000000


def python_raw(port, repeat):
    row = {'id': 'python-raw-' + str(repeat), 'client': 'python-raw', 'mode': 'normal',
           'size': 65324, 'receivedBytes': 0}
    began = time.perf_counter()
    body = bytearray()
    try:
        with socket.create_connection(('127.0.0.1', port), timeout=2) as s:
            s.settimeout(2)
            s.sendall(('POST /normal/65324 HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Length: 2\r\n'
                       'Connection: close\r\nX-Diagnostic-Id: ' + row['id'] + '\r\n\r\n{}').encode())
            header = bytearray()
            while b'\r\n\r\n' not in header:
                block = s.recv(8192)
                if not block:
                    raise EOFError('missing header')
                header.extend(block)
                if len(header) > 8192:
                    raise ValueError('header bound')
            raw, initial = bytes(header).split(b'\r\n\r\n', 1)
            body.extend(initial)
            row['declaredBytes'] = int(next(l.split(b':', 1)[1] for l in raw.split(b'\r\n') if l.lower().startswith(b'content-length:')))
            while True:
                block = s.recv(65536)
                if not block:
                    row['bodyEnded'] = True
                    break
                body.extend(block)
                if len(body) > 2100000:
                    raise ValueError('body bound')
    except Exception as e:
        row['errorType'] = type(e).__name__
    row.update(receivedBytes=len(body), bodySha256=hashlib.sha256(body).hexdigest(), totalMs=(time.perf_counter()-began)*1000)
    row['missingBytes'] = row.get('declaredBytes', 0)-len(body)
    row['complete'] = bool(row.get('bodyEnded') and len(body) == row.get('declaredBytes'))
    return row


def main():
    server = Server(('127.0.0.1', 0), Replay)
    assert server.server_port not in (3000, 8765, 8787, 8788, 11434)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        # Handler reports deliberately injected errors; suppress unstructured stdout only.
        with contextlib.redirect_stdout(io.StringIO()):
            result = subprocess.run(['node', 'tests/transport-tail-clients.cjs', str(server.server_port)],
                                    cwd=ROOT, capture_output=True, text=True, timeout=100, check=True)
        rows = [json.loads(line) for line in result.stdout.splitlines()]
        rows.extend(python_raw(server.server_port, n) for n in range(1, 11))
        paired = {r['id']: r for r in records}
        for r in rows:
            r['expectedBodyHashMatches'] = r['bodySha256'] == paired[r['id']]['expectedSha256']
        report = {'synthetic': True, 'productionRequests': 0,
                  'serverSourceSha256': hashlib.sha256(SOURCE.read_bytes()).hexdigest(),
                  'socketWriterImplementation': inspect.getsource(socketserver._SocketWriter.write),
                  'nodeVersion': subprocess.check_output(['node', '-p', 'process.version'], text=True).strip(),
                  'clients': rows, 'server': records}
        output = ROOT / 'dist' / ('transport-tail-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ') + '.json')
        output.write_text(json.dumps(report, indent=2))
        print(str(output))
        for client in ('fetch', 'http', 'raw', 'python-raw'):
            normal = [r for r in rows if r['client'] == client and r['mode'] == 'normal']
            print(json.dumps({'client': client, 'normalAttempts': len(normal),
                              'complete': sum(r['complete'] and r['expectedBodyHashMatches'] for r in normal),
                              'failures': [r for r in normal if not r['complete']]}))
        faults = [r for r in rows if r['mode'] in ('drop44', 'overdeclare44', 'cancel')]
        assert len(rows) == 52 and len(faults) == 9 and all(not r['complete'] for r in faults)
        print('PASS: all 9 controlled loss/framing/cancellation cases rejected.')
        # A normal/delayed failure is evidence, never silently considered a passing transport test.
        normal = [r for r in rows if r['mode'] in ('normal', 'delayed')]
        assert all(r['complete'] and r['expectedBodyHashMatches'] for r in normal), 'FAIL: spontaneous synthetic delivery failure retained in journal'
    finally:
        server.shutdown()
        server.server_close()
        thread.join()


if __name__ == '__main__':
    main()
