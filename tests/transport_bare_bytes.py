"""Bare TCP control: no HTTP, WAV, Node, native engine, credentials or production ports."""
import hashlib
import json
import socket
import socketserver
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

records = []


class Handler(socketserver.BaseRequestHandler):
    def handle(self):
        size = int(self.request.recv(16).decode().strip())
        assert size in (65324, 65536)
        body = bytes((i * 17) % 256 for i in range(size))
        row = {'size': size, 'expectedSha256': hashlib.sha256(body).hexdigest()}
        records.append(row)
        self.request.sendall(body)
        row['sendallReturned'] = True


def main():
    server = socketserver.ThreadingTCPServer(('127.0.0.1', 0), Handler)
    assert server.server_address[1] not in (3000, 8765, 8787, 8788, 11434)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    rows = []
    try:
        for repeat in range(1, 11):
            for size in (65324, 65536):
                row = {'repeat': repeat, 'expectedBytes': size}
                began = time.perf_counter()
                body = bytearray()
                try:
                    with socket.create_connection(server.server_address, timeout=2) as s:
                        s.settimeout(2)
                        s.sendall((str(size) + '\n').encode())
                        while True:
                            chunk = s.recv(65536)
                            if not chunk:
                                row['eof'] = True
                                break
                            body.extend(chunk)
                            if len(body) > 65536:
                                raise ValueError('bound')
                except Exception as e:
                    row['errorType'] = type(e).__name__
                row.update(receivedBytes=len(body), sha256=hashlib.sha256(body).hexdigest(),
                           totalMs=(time.perf_counter()-began)*1000)
                row['complete'] = bool(row.get('eof') and len(body) == size)
                rows.append(row)
        output = Path(__file__).resolve().parents[1] / 'dist' / ('transport-bare-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ') + '.json')
        output.write_text(json.dumps({'productionRequests': 0, 'clients': rows, 'server': records}, indent=2))
        print(output)
        print(json.dumps({'attempts': len(rows), 'complete': sum(r['complete'] for r in rows), 'failures': [r for r in rows if not r['complete']]}))
    finally:
        server.shutdown()
        server.server_close()
        thread.join()


if __name__ == '__main__':
    main()
