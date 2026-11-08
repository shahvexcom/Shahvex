"""Test only packaged HTTP method AST; no torch/model/server imports or startup."""
import ast
import io
import zipfile

with zipfile.ZipFile('dist/Shahvex-Multiturn-Review-v1.zip') as package:
    source = package.read('optional-chatterbox/chatterbox_voice_server.py').decode()
tree = ast.parse(source)
handler = next(n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == 'Handler')
method = next(n for n in handler.body if isinstance(n, ast.FunctionDef) and n.name == 'send_data')
namespace = {}
exec(compile(ast.fix_missing_locations(ast.Module(body=[method], type_ignores=[])), '<reviewed-send-method>', 'exec'), namespace)


for failure in ['headers', 'body', 'flush']:
    class Sink(io.BytesIO):
        def write(self, data):
            if failure == 'body':
                raise ConnectionAbortedError(10053, 'fixture abort')
            return super().write(data)

        def flush(self):
            if failure == 'flush':
                raise ConnectionAbortedError(10053, 'fixture abort')

    class FakeHandler:
        send_data = namespace['send_data']
        responses = 0
        wfile = Sink()

        def send_response(self, _status):
            self.responses += 1

        def send_header(self, *_args):
            pass

        def end_headers(self):
            if failure == 'headers':
                raise ConnectionAbortedError(10053, 'fixture abort')

    h = FakeHandler()
    h.send_data(200, 'audio/wav', b'fixture')
    h.send_data(500, 'application/json', b'should never send')
    assert h.responses == 1
    assert h.close_connection is True
print('PASS: aborted headers/body/flush never send a second response; no models imported')
