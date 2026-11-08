'use strict';
const http = require('node:http');
const { timingSafeEqual, randomBytes } = require('node:crypto');
const { Gateway } = require('./core.cjs');
const { AudioStream } = require('./audio-stream.cjs');
const { createServices, loadContract } = require('./services.cjs');
const { loadIntelligence } = require('./agent-intelligence.cjs');
const equal = (a, b) => { const x = Buffer.from(a || ''), y = Buffer.from(b || ''); return x.length === y.length && timingSafeEqual(x, y); };
const log = event => process.stdout.write(`${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`);

function createServer({ token, services = createServices(loadContract()), intelligence = loadIntelligence(), maxSessions = 1, sessionTtlMs = 300000, logger = log, endpointSilenceMs = 400 } = {}) {
  if (!Number.isInteger(endpointSilenceMs) || endpointSilenceMs < 300 || endpointSilenceMs > 1000 || endpointSilenceMs % 20) throw Error('Endpoint silence must be 300–1000ms in 20ms steps');
  if (!token || token.length < 32) throw Error('Set a gateway token of at least 32 characters');
  const gateway = new Gateway({ ...services, intelligence, maxSessions, log: logger, telephony: { transfer: async () => { throw Error('VICIdial adapter not configured'); } } });
  const sessions = new Map();
  const send = (res, status, body) => { res.writeHead(status); res.end(JSON.stringify(body)); };
  const dispose = id => { const s = sessions.get(id); if (!s) return; s.stream?.close(); gateway.close('local-service', id); sessions.delete(id); };
  const timer = setInterval(() => { for (const [id, s] of sessions) if (Date.now() >= s.expires) { s.response?.destroy(); dispose(id); } }, 1000); timer.unref();
  const server = http.createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store');
    const admin = equal(req.headers.authorization, `Bearer ${token}`);
    const match = /^\/sessions\/([a-f0-9-]+)(\/stream)?$/.exec(req.url || '');
    const session = match && sessions.get(match[1]);
    const authorized = session && Date.now() < session.expires && equal(req.headers.authorization, `Bearer ${session.token}`);
    if (!admin && !authorized) return send(res, 401, { error: 'Unauthorized' });
    try {
      if (admin && req.method === 'GET' && req.url === '/health') {
        const health = await services.health();
        return send(res, 200, { service: 'Shahvex AI Gateway', live: true, ...health, telephonyReady: false, activeCallCapacityVerified: false, activeSessions: sessions.size, queue: { active: gateway.queue.active, pending: gateway.queue.pending.length } });
      }
      if (admin && req.method === 'POST' && req.url === '/sessions') {
        let size = 0; const chunks = [];
        for await (const chunk of req) { size += chunk.length; if (size > 24000) return send(res, 413, { error: 'Configuration too large' }); chunks.push(chunk); }
        const config = JSON.parse(Buffer.concat(chunks).toString());
        const id = gateway.create('local-service', config); const access = randomBytes(32).toString('base64url');
        sessions.set(id, { token: access, expires: Date.now() + sessionTtlMs, stream: null });
        logger({ sessionId: id, stage: 'session-created' });
        return send(res, 201, { id, sessionToken: access, expiresInSeconds: sessionTtlMs / 1000, format: 'pcm_s16le', sampleRate: 16000, channels: 1, frameBytes: 640 });
      }
      if (!authorized) return send(res, 403, { error: 'Per-call token required' });
      if (req.method === 'DELETE' && !match[2]) { session.response?.destroy(); dispose(match[1]); return send(res, 200, { closed: true }); }
      if (req.method !== 'POST' || match[2] !== '/stream') return send(res, 404, { error: 'Unknown route' });
      if (session.stream) return send(res, 409, { error: 'A stream is already attached' });
      if (req.headers['content-type'] !== 'audio/pcm;rate=16000;channels=1') return send(res, 415, { error: 'Expected negotiated PCM16 content type' });
      res.setHeader('Content-Type', 'application/x-ndjson'); res.flushHeaders();
      const emit = async (event, signal) => {
        if (signal?.aborted) throw Error('Cancelled');
        if (res.destroyed) throw Error('Stream disconnected');
        if (!res.write(`${JSON.stringify(event)}\n`)) await new Promise((resolve, reject) => {
          const cleanup = () => { clearTimeout(timeout); res.off('drain', drained); res.off('close', closed); signal?.removeEventListener('abort', aborted); };
          const drained = () => { cleanup(); resolve(); };
          const closed = () => { cleanup(); reject(Error('Stream disconnected')); };
          const aborted = () => { cleanup(); reject(Error('Cancelled')); };
          const timeout = setTimeout(() => { cleanup(); reject(Error('Slow audio consumer')); }, 5000);
          res.once('drain', drained); res.once('close', closed); signal?.addEventListener('abort', aborted, { once: true });
        });
      };
      const stream = new AudioStream(gateway, 'local-service', match[1], emit, { silenceFrames: endpointSilenceMs / 20 }); session.stream = stream; session.response = res;
      res.on('close', () => { stream.close(); session.stream = null; session.response = null; });
      req.on('aborted', () => stream.close());
      try {
        for await (const chunk of req) { session.expires = Date.now() + sessionTtlMs; await stream.push(chunk); }
        await stream.end(); res.end();
      } catch { logger({ sessionId: match[1], stage: 'stream-error' }); res.destroy(); }
    } catch (error) {
      logger({ stage: 'request-error', category: error instanceof SyntaxError ? 'invalid-json' : 'validation-or-capacity' });
      if (!res.headersSent) send(res, error.message.includes('capacity') ? 429 : 400, { error: error instanceof SyntaxError ? 'Invalid JSON' : error.message }); else res.destroy();
    }
  });
  server.requestTimeout = 0; server.headersTimeout = 5000;
  server.on('connection', socket => socket.setTimeout(30000, () => socket.destroy()));
  server.on('close', () => { clearInterval(timer); for (const id of sessions.keys()) dispose(id); });
  return server;
}
if (require.main === module) {
  const telemetry = require('./telemetry.cjs').createTelemetry(process.env.SHAHVEX_TIMING_LOG);
  const server = createServer({ token: process.env.SHAHVEX_GATEWAY_TOKEN, maxSessions: Number(process.env.SHAHVEX_MAX_SESSIONS || 1), endpointSilenceMs: Number(process.env.SHAHVEX_ENDPOINT_SILENCE_MS || 400), logger: telemetry.log });
  server.listen(Number(process.env.SHAHVEX_GATEWAY_PORT || 8787), '127.0.0.1', () => telemetry.log({ stage: 'listening', host: '127.0.0.1', port: server.address().port }));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { server.closeAllConnections(); server.close(() => telemetry.close()); });
}
module.exports = { createServer };
