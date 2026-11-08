"""Gated 65,324-byte fixture for an approved metadata trace; no production services."""
import argparse
import json
import os
import subprocess
import threading
import time
from pathlib import Path
from transport_tail_matrix import Server, Replay, records


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    output = Path(args.output).resolve()
    output.mkdir(exist_ok=False)
    server = Server(('127.0.0.1', 0), Replay)
    assert server.server_port not in (3000, 8765, 8787, 8788, 11434)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        (output / 'ready.json').write_text(json.dumps({'fixturePid': os.getpid(), 'port': server.server_port,
                                                      'responseBytes': 65324, 'productionRequests': 0}))
        print('Ready; waiting for capture-go in ' + str(output), flush=True)
        wait = time.monotonic() + 120
        while not (output / 'capture-go').exists():
            if time.monotonic() > wait:
                raise TimeoutError('No approved trace start; no fixture requests sent')
            time.sleep(.1)
        script = """
const {once}=require('./tests/transport-tail-clients.cjs');
(async()=>{for(let n=1;n<=5;n++)for(const client of ['fetch','http','raw'])
 console.log(JSON.stringify(await once(Number(process.argv[1]),client,'normal',65324,client+'-trace-'+n)));})().catch(()=>process.exitCode=1);
"""
        began = time.time_ns() // 1000000
        result = subprocess.run(['node', '-e', script, str(server.server_port)],
                                cwd=Path(__file__).resolve().parents[1], capture_output=True, text=True, timeout=45)
        clients = [json.loads(line) for line in result.stdout.splitlines()]
        (output / 'application.json').write_text(json.dumps({'beginUnixMs': began, 'endUnixMs': time.time_ns() // 1000000,
                                                            'clients': clients, 'server': records, 'childExit': result.returncode}, indent=2))
        (output / 'done').write_text('Fixture requests finished; stop only the owned trace session.\n')
        print(json.dumps({'attempts': len(clients), 'complete': sum(r['complete'] for r in clients), 'productionRequests': 0}))
    finally:
        server.shutdown()
        server.server_close()
        thread.join()


if __name__ == '__main__':
    main()
