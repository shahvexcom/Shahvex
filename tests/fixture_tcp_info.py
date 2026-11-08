"""Read-only Windows counters for a caller-owned isolated socket; no connection-table scan."""
import ctypes
import socket


class TcpInfo(ctypes.Structure):
    _fields_ = [('State', ctypes.c_uint32), ('Mss', ctypes.c_uint32),
                ('ConnectionTimeMs', ctypes.c_uint64), ('TimestampsEnabled', ctypes.c_uint8),
                *[(n, ctypes.c_uint32) for n in ('RttUs', 'MinRttUs', 'BytesInFlight', 'Cwnd', 'SndWnd', 'RcvWnd', 'RcvBuf')],
                ('BytesOut', ctypes.c_uint64), ('BytesIn', ctypes.c_uint64),
                *[(n, ctypes.c_uint32) for n in ('BytesReordered', 'BytesRetrans', 'FastRetrans', 'DupAcksIn', 'TimeoutEpisodes')],
                ('SynRetrans', ctypes.c_uint8)]


def snapshot(s):
    assert s.getsockname()[0] == s.getpeername()[0] == '127.0.0.1'
    assert not {s.getsockname()[1], s.getpeername()[1]}.intersection({3000, 8765, 8787, 8788, 11434})
    lib = ctypes.WinDLL('Ws2_32.dll')
    call = lib.WSAIoctl
    call.argtypes = [ctypes.c_size_t, ctypes.c_uint32, ctypes.c_void_p, ctypes.c_uint32,
                     ctypes.c_void_p, ctypes.c_uint32, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p]
    call.restype = ctypes.c_int
    version, info, returned = ctypes.c_uint32(0), TcpInfo(), ctypes.c_uint32(0)
    result = call(s.fileno(), 0xD8000027, ctypes.byref(version), 4,
                  ctypes.byref(info), ctypes.sizeof(info), ctypes.byref(returned), None, None)
    row = {'tcpInfoReturnedBytes': returned.value, 'tcpInfoStructBytes': ctypes.sizeof(info)}
    if result == 0 and returned.value == ctypes.sizeof(info):
        row.update({name: getattr(info, name) for name, _ in TcpInfo._fields_})
    else:
        row['tcpInfoError'] = lib.WSAGetLastError()
    pending = ctypes.c_uint32(0)
    ioctl = lib.ioctlsocket
    ioctl.argtypes = [ctypes.c_size_t, ctypes.c_long, ctypes.c_void_p]
    ioctl.restype = ctypes.c_int
    if ioctl(s.fileno(), 0x4004667F, ctypes.byref(pending)) == 0:
        row['applicationReadableBytes'] = pending.value
    else:
        row['fionreadError'] = lib.WSAGetLastError()
    return row
