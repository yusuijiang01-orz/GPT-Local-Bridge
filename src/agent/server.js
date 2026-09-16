const http = require('node:http');
const crypto = require('node:crypto');
const { loadConfig } = require('./config');
const { executeTool } = require('./tools');
const { AuditLog } = require('./audit');

const configPath = process.env.GPTLB_CONFIG_PATH;
const token = process.env.GPTLB_TOKEN;
const audit = new AuditLog(process.env.GPTLB_AUDIT_PATH);
let config = loadConfig(configPath);
const port = Number(process.env.GPTLB_PORT || config.port || 8787);
const startedAt = Date.now();

if (!token) {
  console.error('GPTLB_TOKEN is required.');
  process.exit(2);
}

function send(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store'
  });
  res.end(payload);
}

function authorized(req) {
  const header = req.headers.authorization || '';
  const supplied = header.startsWith('Bearer ') ? header.slice(7) : '';
  const a = Buffer.from(supplied);
  const b = Buffer.from(token);
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}

function readJson(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (Buffer.byteLength(data) > limit) {
        reject(Object.assign(new Error('Request body too large.'), { code: 'BODY_TOO_LARGE' }));
        req.destroy();
      }
    });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch { reject(Object.assign(new Error('Invalid JSON body.'), { code: 'INVALID_JSON' })); }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  if (!authorized(req)) {
    console.warn(`[rpc] unauthorized method=${req.method || '-'} route=${req.url || '-'}`);
    return send(res, 401, { ok: false, error: { code: 'UNAUTHORIZED', message: 'Invalid local bridge token.' } });
  }

  if (req.method === 'GET' && req.url === '/health') {
    return send(res, 200, { ok: true, service: 'gpt-local-bridge-agent', pid: process.pid, uptime_ms: Date.now() - startedAt, port });
  }

  if (req.method === 'POST' && req.url === '/rpc') {
    const began = Date.now();
    let body;
    try {
      body = await readJson(req);
      const requestId = body.request_id || crypto.randomUUID();
      config = loadConfig(configPath);
      const result = await executeTool(config, body.method, body.params || {});
      const duration = Date.now() - began;
      audit.write({ request_id: requestId, tool: body.method, ok: true, duration_ms: duration });
      console.log(`[rpc] request_id=${requestId} tool=${body.method || '-'} ok=true duration_ms=${duration}`);
      return send(res, 200, { request_id: requestId, ok: true, tool: body.method, result, error: null, redactions: [] });
    } catch (error) {
      const requestId = body?.request_id || crypto.randomUUID();
      const duration = Date.now() - began;
      const errorCode = error.code || 'INTERNAL_ERROR';
      audit.write({ request_id: requestId, tool: body?.method || null, ok: false, error_code: errorCode, duration_ms: duration });
      console.warn(`[rpc] request_id=${requestId} tool=${body?.method || '-'} ok=false error_code=${errorCode} duration_ms=${duration}`);
      return send(res, 400, { request_id: requestId, ok: false, tool: body?.method || null, result: null, error: { code: errorCode, message: error.message }, redactions: [] });
    }
  }

  send(res, 404, { ok: false, error: { code: 'NOT_FOUND', message: 'Unknown endpoint.' } });
});

server.listen(port, '127.0.0.1', () => {
  console.log(`GPT Local Bridge agent listening on 127.0.0.1:${port}`);
});

server.on('error', (error) => {
  console.error(`[agent] server error code=${error.code || 'UNKNOWN'} message=${error.message}`);
});

function shutdown() {
  console.log('[agent] shutdown requested');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
