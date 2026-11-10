import sys
import threading
from pathlib import Path
from types import SimpleNamespace
sys.path.insert(0,str(Path(__file__).parents[1]/'deployment'))
from native_stream_policy import fresh_native_stream

model=SimpleNamespace(model=SimpleNamespace(token_hop_len=100))
lock=threading.RLock()
def native():
    assert model.model.token_hop_len==25
    model.model.token_hop_len=100
    yield b'pcm'
for _ in range(20):
    assert list(fresh_native_stream(model,lock,native))==[b'pcm']
    assert model.model.token_hop_len==100
def broken():
    assert model.model.token_hop_len==25
    raise ValueError('fixture')
    yield b''
try:list(fresh_native_stream(model,lock,broken))
except ValueError:pass
else:raise AssertionError('Exception was swallowed')
assert model.model.token_hop_len==100
print('PASS native first-chunk reset, repeated requests, state restoration and failure cleanup')
