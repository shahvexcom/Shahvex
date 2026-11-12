"""Exercise the real AGI process using Asterisk-style stdin and a local bridge."""
import hashlib
import hmac
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import unittest
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

SCRIPT = Path(__file__).resolve().parents[1] / 'deployment/vicidial-bridge/register-call.py'
SECRET = 'fixture-only-bridge-secret-at-least-32-characters'


class RegisterCallTests(unittest.TestCase):
    def run_agi(self, config_path, caller='Y0316001655000402028', manual=False):
        environment = dict(os.environ, SHAHVEX_VICIDIAL_CONFIG=str(config_path), SHAHVEX_VICIDIAL_MANUAL_CONFIG=str(config_path))
        result = subprocess.run(
            [sys.executable, str(SCRIPT), *(['manual-test', '--manual-test'] if manual else ['9001'])],
            input=f'agi_calleridname: {caller}\nagi_uniqueid: 1794439901.50\n\n200 result=1\n200 result=1\n',
            text=True, capture_output=True, env=environment, timeout=10, check=True,
        )
        self.assertNotIn(SECRET, result.stdout + result.stderr)
        return result.stdout

    def test_manual_extension_is_rejected_without_fabricating_a_call_id(self):
        output = self.run_agi('missing-config.json', 'ext 78601')
        self.assertIn('Invalid VICIdial caller-code', output)
        self.assertIn('SET VARIABLE SHAHVEX_AUDIO_UUID ""', output)

    def test_missing_config_has_a_safe_actionable_diagnostic(self):
        with tempfile.TemporaryDirectory(prefix='shahvex-agi-') as folder:
            output = self.run_agi(Path(folder) / 'missing.json')
        self.assertIn('Bridge config file missing', output)

    def test_invalid_config_does_not_leak_file_contents(self):
        with tempfile.TemporaryDirectory(prefix='shahvex-agi-') as folder:
            config_path = Path(folder) / 'config.json'
            config_path.write_text('{bad-json: ' + SECRET, encoding='utf-8')
            output = self.run_agi(config_path)
        self.assertIn('Invalid JSON', output)

    def test_manual_registration_requires_opt_in_and_an_isolated_bridge(self):
        received = []

        class Handler(BaseHTTPRequestHandler):
            manual = False

            def log_message(self, *args):
                pass

            def do_GET(self):
                self.send_response(200)
                self.end_headers()
                self.wfile.write(json.dumps({'testOnly': self.manual}).encode())

            def do_POST(self):
                received.append(json.loads(self.rfile.read(int(self.headers['content-length']))))
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b'{"accepted":true}')

        server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        try:
            with tempfile.TemporaryDirectory(prefix='shahvex-agi-') as folder:
                config_path = Path(folder) / 'manual.json'
                config = {'enabled': False, 'secret': SECRET, 'controlUrl': f'http://127.0.0.1:{server.server_port}'}
                config_path.write_text(json.dumps(config), encoding='utf-8')
                self.assertIn('Manual audio testing is disabled', self.run_agi(config_path, 'ext 78660', manual=True))
                config['enabled'] = True
                config_path.write_text(json.dumps(config), encoding='utf-8')
                self.assertIn('not the production bridge', self.run_agi(config_path, 'ext 78660', manual=True))
                self.assertEqual(received, [])
                Handler.manual = True
                output = self.run_agi(config_path, 'ext 78660', manual=True)
                self.assertEqual(len(received), 1)
                payload = received[0]
                self.assertTrue(payload['manualTest'])
                self.assertEqual(payload['agentUser'], 'manual-test')
                self.assertEqual(payload['externalCallId'], 'manual-' + payload['uuid'].replace('-', ''))
                self.assertIn(payload['uuid'], output)
        finally:
            server.shutdown()
            server.server_close()
            worker.join(timeout=2)

    def test_signed_registration_and_safe_http_failure_diagnostics(self):
        received = []

        class Handler(BaseHTTPRequestHandler):
            code = 200

            def log_message(self, *args):
                pass

            def do_POST(self):
                body = self.rfile.read(int(self.headers['content-length']))
                received.append((self.path, dict(self.headers), body))
                self.send_response(self.code)
                self.end_headers()
                self.wfile.write(json.dumps({'accepted': True, 'internal': SECRET}).encode())

        server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        try:
            with tempfile.TemporaryDirectory(prefix='shahvex-agi-') as folder:
                config_path = Path(folder) / 'config.json'
                config_path.write_text(json.dumps({'secret': SECRET, 'controlUrl': f'http://127.0.0.1:{server.server_port}/'}), encoding='utf-8')
                output = self.run_agi(config_path)
                value = output.split('SHAHVEX_AUDIO_UUID "', 1)[1].split('"', 1)[0]
                self.assertEqual(str(uuid.UUID(value)), value)
                path, headers, body = received[0]
                self.assertEqual(path, '/register')
                payload = json.loads(body)
                self.assertEqual(payload['uuid'], value)
                self.assertEqual(payload['externalCallId'], 'Y0316001655000402028')
                self.assertEqual(payload['agentUser'], '9001')
                stamp = headers['X-Shahvex-Timestamp']
                expected = hmac.new(SECRET.encode(), f'{stamp}\nPOST\n/register\n'.encode() + body, hashlib.sha256).hexdigest()
                self.assertEqual(headers['X-Shahvex-Signature'], expected)
                for code, message in [(401, 'authentication rejected'), (409, 'line not prepared'), (429, 'capacity reached')]:
                    with self.subTest(code=code):
                        Handler.code = code
                        output = self.run_agi(config_path)
                        self.assertIn(message, output)
                        self.assertIn('SET VARIABLE SHAHVEX_AUDIO_UUID ""', output)
        finally:
            server.shutdown()
            server.server_close()
            worker.join(timeout=2)


if __name__ == '__main__':
    unittest.main()
