"""No network requests: ABI and production-socket exclusion checks for diagnostic reads."""
import ctypes
import unittest
from fixture_tcp_info import TcpInfo, snapshot


class Tests(unittest.TestCase):
    def test_documented_windows_v0_layout(self):
        self.assertEqual(ctypes.sizeof(TcpInfo), 88)
        self.assertEqual(TcpInfo.ConnectionTimeMs.offset, 8)
        self.assertEqual(TcpInfo.BytesOut.offset, 48)
        self.assertEqual(TcpInfo.BytesIn.offset, 56)
        self.assertEqual(TcpInfo.SynRetrans.offset, 84)

    def test_refuses_production_or_nonloopback_sockets_before_query(self):
        class Fake:
            def getsockname(self):
                return ('127.0.0.1', 8765)

            def getpeername(self):
                return ('127.0.0.1', 45678)
        with self.assertRaises(AssertionError):
            snapshot(Fake())


if __name__ == '__main__':
    unittest.main()
