"""Fixture-only socket boundary comparisons. No elevated trace, live AI or settings changes."""
import contextlib
import argparse
import hashlib
import io
import json
import random
import socket
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from http.server import ThreadingHTTPServer
from chatterbox_transport_test import handler_from
from transport_tail_matrix import SOURCE
from fixture_tcp_info import snapshot

records = []
CAPTURE_INFO = False
base = handler_from(SOURCE.read_text())
BODY = (b'RIFF' + (65324-8).to_bytes(4, 'little') + b'WAVEfmt ' + (16).to_bytes(4, 'little') +
        (1).to_bytes(2, 'little') * 2 + (24000).to_bytes(4, 'little') + (48000).to_bytes(4, 'little') +
        (2).to_bytes(2, 'little') + (16).to_bytes(2, 'little') + b'data' + (65280).to_bytes(4, 'little') +
        bytes((i * 17) % 256 for i in range(65280)))
assert len(BODY) == 65324


class ObservedSocket(socket.socket):
    def mark(self, event, **fields):
        # Only synthetic connection metadata, byte counts and hashes; never log buffers.
        if len(self.record['events']) < 60:
            self.record['events'].append({'event': event, 'atNs': time.perf_counter_ns(), **fields})

    def sendall(self, data, flags=0):
        self.mark('sendall-enter', bytes=len(data), sha256=hashlib.sha256(data).hexdigest())
        try:
            result = super().sendall(data, flags)
            self.mark('sendall-return', returnedNone=result is None)
            if CAPTURE_INFO:
                self.mark('after-sendall-counters', counters=snapshot(self))
            return result
        except OSError as e:
            self.mark('sendall-error', errorType=type(e).__name__, errno=e.errno)
            raise

    def send(self, data, flags=0):
        self.mark('send-enter', bytes=len(data), sha256=hashlib.sha256(data).hexdigest())
        result = super().send(data, flags)
        self.mark('send-return', accepted=result)
        return result

    def shutdown(self, how):
        self.mark('shutdown-enter', how=how)
        if CAPTURE_INFO:
            self.mark('before-shutdown-counters', counters=snapshot(self))
        try:
            result = super().shutdown(how)
            self.mark('shutdown-return')
            return result
        except OSError as e:
            self.mark('shutdown-error', errorType=type(e).__name__, errno=e.errno)
            raise

    def close(self):
        if hasattr(self, 'record'):
            self.mark('close-enter', fd=self.fileno())
        super().close()
        if hasattr(self, 'record'):
            self.mark('close-return', fd=self.fileno())


class Fixture(base):
    def log_message(self, *_):
        pass

    def end_headers(self):
        if getattr(self.connection, 'mode', None) == 'coalesced-sameheaders':
            self._headers_buffer.append(b'\r\n')
            header = b''.join(self._headers_buffer)
            self._headers_buffer.clear()
            self.connection.record['headerBytes'] = len(header)
            self.connection.sendall(header + BODY)
            self.skip_body = True
        else:
            super().end_headers()

    def do_POST(self):
        self.rfile.read(int(self.headers['Content-Length']))
        self.connection.record.update(id=self.headers['X-Diagnostic-Id'], mode=self.path.strip('/'))
        self.connection.mode = self.path.strip('/')
        if self.connection.mode == 'coalesced-sameheaders':
            # Same header fields/order as reviewed send_data, only send boundary differs.
            self.send_response(200)
            self.send_header('Content-Type', 'audio/wav')
            self.send_header('Content-Length', str(len(BODY)))
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Connection', 'close')
            self.end_headers()
            self.close_connection = True
            return
        if self.connection.mode == 'buffered-body':
            # Header/body buffering is a fixture-only differential; not a proposed fix.
            self.wfile = io.BufferedWriter(self.wfile, buffer_size=16384)
        if self.connection.mode == 'coalesced':
            # Fixed headers, identical entity body, single sendall; framing remains valid.
            head = b'HTTP/1.0 200 OK\r\nContent-Type: audio/wav\r\nContent-Length: 65324\r\nConnection: close\r\n\r\n'
            self.connection.record['headerBytes'] = len(head)
            self.connection.sendall(head + BODY)
            self.close_connection = True
        else:
            self.connection.record['sendDataReturned'] = self.send_data(200, 'audio/wav', BODY)


class Server(ThreadingHTTPServer):
    def get_request(self):
        conn, address = super().get_request()
        observed = ObservedSocket(fileno=conn.detach())
        observed.record = {'clientPort': address[1], 'expectedBodyBytes': len(BODY),
                           'expectedBodySha256': hashlib.sha256(BODY).hexdigest(), 'events': []}
        records.append(observed.record)
        return observed, address

    def shutdown_request(self, request):
        if getattr(request, 'mode', None) == 'halfclose-wait':
            # Explicit upper bound; never change system TCP options or sleep indefinitely.
            request.shutdown(socket.SHUT_WR)
            request.settimeout(.2)
            try:
                request.record['peerEofBeforeClose'] = request.recv(1) == b''
            except OSError as e:
                request.record['peerEofError'] = type(e).__name__
            self.close_request(request)
        else:
            super().shutdown_request(request)


def receive(port, mode, trial):
    row = {'id': str(trial), 'mode': mode, 'events': [], 'receivedBytes': 0}
    began = time.perf_counter_ns()
    body = bytearray()
    try:
        with socket.create_connection(('127.0.0.1', port), timeout=1) as s:
            s.settimeout(1)
            def recv(count):
                try:
                    return s.recv(count)
                except TimeoutError:
                    if CAPTURE_INFO:
                        row['countersAtTimeout'] = snapshot(s)
                    raise
            s.sendall((f'POST /{mode} HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Length: 2\r\n'
                       f'Connection: close\r\nX-Diagnostic-Id: {trial}\r\n\r\n{{}}').encode())
            header = bytearray()
            while b'\r\n\r\n' not in header:
                chunk = recv(8192)
                if not chunk:
                    raise EOFError('header')
                header.extend(chunk)
                if len(header) > 8192:
                    raise ValueError('header bound')
            head, first = bytes(header).split(b'\r\n\r\n', 1)
            row['headerBytes'] = len(head)+4
            row['declaredBytes'] = int(next(l.split(b':', 1)[1] for l in head.split(b'\r\n') if l.lower().startswith(b'content-length:')))
            body.extend(first)
            row['events'].append({'event': 'headers-parsed', 'atNs': time.perf_counter_ns(), 'cumulativeBody': len(body)})
            while True:
                chunk = recv(65536)
                row['events'].append({'event': 'recv' if chunk else 'eof', 'atNs': time.perf_counter_ns(),
                                      'bytes': len(chunk), 'cumulativeBody': len(body)+len(chunk)})
                if not chunk:
                    row['eof'] = True
                    if CAPTURE_INFO:
                        row['countersAtEof'] = snapshot(s)
                    break
                body.extend(chunk)
                if len(body) > 65324:
                    raise ValueError('body bound')
    except Exception as e:
        row['errorType'] = type(e).__name__
        row['errorAtNs'] = time.perf_counter_ns()
    row.update(receivedBytes=len(body), bodySha256=hashlib.sha256(body).hexdigest(), totalMs=(time.perf_counter_ns()-began)/1e6)
    row['complete'] = bool(row.get('eof') and len(body) == row.get('declaredBytes') == 65324 and bytes(body) == BODY)
    return row


def main():
    global CAPTURE_INFO
    parser = argparse.ArgumentParser()
    parser.add_argument('--repeats', type=int, default=10, choices=range(1, 31))
    parser.add_argument('--seed', type=int, default=11032026)
    parser.add_argument('--modes', default='baseline,buffered-body,coalesced,halfclose-wait')
    parser.add_argument('--tcp-info', action='store_true')
    args = parser.parse_args()
    CAPTURE_INFO = args.tcp_info
    modes = args.modes.split(',')
    assert modes and all(m in ('baseline', 'buffered-body', 'coalesced', 'halfclose-wait', 'coalesced-sameheaders') for m in modes)
    server = Server(('127.0.0.1', 0), Fixture)
    assert server.server_port not in (3000, 8765, 8787, 8788, 11434)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    trials = [mode for mode in modes for _ in range(args.repeats)]
    random.Random(args.seed).shuffle(trials)
    try:
        with contextlib.redirect_stdout(io.StringIO()):
            rows = [receive(server.server_port, mode, n) for n, mode in enumerate(trials, 1)]
        output = Path(__file__).resolve().parents[1] / 'dist' / ('transport-socket-boundaries-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ') + '.json')
        output.write_text(json.dumps({'productionRequests': 0, 'systemCapture': False,
                                     'responseBodySha256': hashlib.sha256(BODY).hexdigest(),
                                     'clients': rows, 'server': records}, indent=2))
        print(output)
        for mode in set(trials):
            sub = [r for r in rows if r['mode'] == mode]
            print(json.dumps({'mode': mode, 'attempts': len(sub), 'complete': sum(r['complete'] for r in sub),
                              'failedReceivedBytes': [r['receivedBytes'] for r in sub if not r['complete']]}))
    finally:
        server.shutdown()
        server.server_close()
        thread.join()


if __name__ == '__main__':
    main()
