"""Benchmark the existing voice via its localhost API; no models loaded or changed."""
import io
import json
import os
import time
import urllib.request
import wave
import argparse


def idle():
    token = os.environ.get('SHAHVEX_GATEWAY_TOKEN', '')
    if not token:
        raise RuntimeError('Existing Gateway credential must be supplied privately')
    req = urllib.request.Request('http://127.0.0.1:8787/health', headers={'Authorization': 'Bearer ' + token})
    with urllib.request.urlopen(req, timeout=5) as response:
        data = json.load(response)
    if not data.get('ready') or data.get('activeSessions') != 0 or data['queue']['active'] != 0 or data['queue']['pending'] != 0:
        raise RuntimeError('Gateway not ready and idle; no synthesis attempted')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--sample', type=int, choices=(1, 2, 3))
    args = parser.parse_args()
    # Synthetic, noncustomer text; no returned audio or transcript is saved.
    texts = ['Hello there.',
             'I am Jennifer, your automated Shahvex assistant.',
             'I can explain the service and answer your questions. What would you like to know?']
    for index, text in enumerate(texts):
        if args.sample and args.sample != index + 1:
            continue
        idle()
        started = time.perf_counter()
        req = urllib.request.Request('http://127.0.0.1:8765/synthesize', data=json.dumps({'text': text}).encode(), headers={'Content-Type': 'application/json'})
        headers_ms, expected, received = None, None, 0
        print(json.dumps({'stage': 'benchmark-start', 'sample': index + 1, 'characters': len(text)}), flush=True)
        try:
            with urllib.request.urlopen(req, timeout=45) as response:
                headers_ms = (time.perf_counter() - started) * 1000
                expected = int(response.headers.get('Content-Length', '0'))
                print(json.dumps({'stage': 'benchmark-headers', 'sample': index + 1, 'httpHeadersMs': round(headers_ms, 1), 'expectedBytes': expected}), flush=True)
                chunks = []
                while True:
                    chunk = response.read(65536)
                    if not chunk:
                        break
                    chunks.append(chunk)
                    received += len(chunk)
                    if received > 4000000 or time.perf_counter() - started > 60:
                        raise RuntimeError('Bounded synthesis response exceeded')
                body = b''.join(chunks)
        except Exception as error:
            print(json.dumps({'stage': 'benchmark-failure', 'sample': index + 1, 'characters': len(text),
                              'httpHeadersMs': round(headers_ms, 1) if headers_ms is not None else None,
                              'elapsedMs': round((time.perf_counter() - started) * 1000, 1),
                              'expectedBytes': expected, 'receivedBytes': received, 'errorType': type(error).__name__,
                              'winerror': getattr(error, 'winerror', None)}), flush=True)
            raise SystemExit(1)
        complete_ms = (time.perf_counter() - started) * 1000
        if len(body) > 4000000:
            raise RuntimeError('Synthesis response exceeds bound')
        with wave.open(io.BytesIO(body), 'rb') as audio:
            duration = audio.getnframes() / audio.getframerate()
        idle()
        print(json.dumps({'sample': index + 1, 'characters': len(text), 'httpHeadersMs': round(headers_ms, 1),
                          'totalHttpMs': round(complete_ms, 1), 'audioSeconds': round(duration, 3),
                          'realTimeFactor': round(complete_ms / 1000 / duration, 3),
                          'nativeGpuInferenceMs': None, 'note': 'Resident approved voice; HTTP includes possible queue/conversion, no models/settings changed'}), flush=True)


if __name__ == '__main__':
    main()
