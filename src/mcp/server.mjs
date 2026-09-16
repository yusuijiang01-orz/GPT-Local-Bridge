import http from 'node:http';
import crypto from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

const agentPort = Number(process.env.GPTLB_AGENT_PORT || 8787);
const mcpPort = Number(process.env.GPTLB_MCP_PORT || 8788);
const agentToken = process.env.GPTLB_AGENT_TOKEN || '';
const startedAt = Date.now();
const transports = new Map();

if (!agentToken) {
  console.error('GPTLB_AGENT_TOKEN is required.');
  process.exit(2);
}

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store'
  });
  res.end(payload);
}

function readJson(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (Buffer.byteLength(data) > limit) {
        reject(new Error('MCP request body too large.'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch { reject(new Error('Invalid MCP JSON body.')); }
    });
    req.on('error', reject);
  });
}

function callAgent(method, params = {}) {
  return new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID();
    const payload = JSON.stringify({ request_id: requestId, method, params });
    const req = http.request({
      hostname: '127.0.0.1',
      port: agentPort,
      method: 'POST',
      path: '/rpc',
      headers: {
        Authorization: `Bearer ${agentToken}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      },
      timeout: 120000
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data || '{}');
          if (!parsed.ok) {
            const error = new Error(parsed.error?.message || 'Local Agent rejected the request.');
            error.code = parsed.error?.code || 'AGENT_ERROR';
            reject(error);
            return;
          }
          resolve(parsed.result);
        } catch (error) {
          reject(new Error(`Invalid response from Local Agent: ${error.message}`));
        }
      });
    });
    req.on('timeout', () => req.destroy(new Error('Local Agent request timed out.')));
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function textResult(value) {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

function errorResult(error) {
  return {
    isError: true,
    content: [{ type: 'text', text: `${error.code || 'ERROR'}: ${error.message}` }]
  };
}

function createMcpServer() {
  const server = new McpServer({ name: 'gpt-local-bridge', version: '0.2.0' });

  server.registerTool('list_files', {
    title: 'List workspace files',
    description: 'List files and directories inside an explicitly allowed local workspace. Paths outside configured workspaces are rejected.',
    inputSchema: {
      path: z.string().optional().describe('Relative path inside the allowed workspace. Defaults to .'),
      depth: z.number().int().min(0).max(8).optional(),
      include_hidden: z.boolean().optional(),
      workspace_root: z.string().optional().describe('Exact allowed workspace root when multiple roots are configured.')
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  }, async (params) => {
    console.log('[mcp] tool=list_files start');
    try {
      const result = await callAgent('list_files', params);
      console.log('[mcp] tool=list_files ok=true');
      return textResult(result);
    } catch (error) {
      console.warn(`[mcp] tool=list_files ok=false error_code=${error.code || 'ERROR'}`);
      return errorResult(error);
    }
  });

  server.registerTool('read_file', {
    title: 'Read workspace file',
    description: 'Read a bounded range of a text file inside an explicitly allowed local workspace. Sensitive paths and binary files are rejected.',
    inputSchema: {
      path: z.string().min(1),
      start_line: z.number().int().min(1).optional(),
      end_line: z.number().int().min(1).optional(),
      encoding: z.string().optional(),
      workspace_root: z.string().optional()
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  }, async (params) => {
    console.log('[mcp] tool=read_file start');
    try {
      const result = await callAgent('read_file', params);
      console.log('[mcp] tool=read_file ok=true');
      return textResult(result);
    } catch (error) {
      console.warn(`[mcp] tool=read_file ok=false error_code=${error.code || 'ERROR'}`);
      return errorResult(error);
    }
  });

  server.registerTool('search_files', {
    title: 'Search workspace text',
    description: 'Search text in an explicitly allowed local workspace with bounded result counts and sensitive-file exclusions.',
    inputSchema: {
      query: z.string().min(1),
      path: z.string().optional(),
      max_results: z.number().int().min(1).max(1000).optional(),
      workspace_root: z.string().optional()
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  }, async (params) => {
    console.log('[mcp] tool=search_files start');
    try {
      const result = await callAgent('search_files', params);
      console.log('[mcp] tool=search_files ok=true');
      return textResult(result);
    } catch (error) {
      console.warn(`[mcp] tool=search_files ok=false error_code=${error.code || 'ERROR'}`);
      return errorResult(error);
    }
  });

  server.registerTool('run_command', {
    title: 'Run allowlisted validation command',
    description: 'Run only Local Agent allowlisted read-only or test commands. Arbitrary shell strings, build, write and destructive categories remain blocked.',
    inputSchema: {
      command: z.string().min(1),
      args: z.array(z.string()).optional(),
      category: z.enum(['read_only', 'test']).optional(),
      cwd: z.string().optional(),
      workspace_root: z.string().optional(),
      timeout_ms: z.number().int().positive().optional()
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false }
  }, async (params) => {
    console.log('[mcp] tool=run_command start');
    try {
      const result = await callAgent('run_command', params);
      console.log('[mcp] tool=run_command ok=true');
      return textResult(result);
    } catch (error) {
      console.warn(`[mcp] tool=run_command ok=false error_code=${error.code || 'ERROR'}`);
      return errorResult(error);
    }
  });

  return server;
}

async function createSessionTransport() {
  let transport;
  transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => crypto.randomUUID(),
    enableJsonResponse: true,
    onsessioninitialized: (sessionId) => {
      transports.set(sessionId, transport);
      console.log(`[mcp] session initialized id=${sessionId}`);
    }
  });
  transport.onclose = () => {
    if (transport.sessionId) {
      transports.delete(transport.sessionId);
      console.log(`[mcp] session closed id=${transport.sessionId}`);
    }
  };
  const server = createMcpServer();
  await server.connect(transport);
  return transport;
}

const httpServer = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/health') {
      return json(res, 200, {
        ok: true,
        service: 'gpt-local-bridge-mcp',
        pid: process.pid,
        uptime_ms: Date.now() - startedAt,
        port: mcpPort,
        active_sessions: transports.size
      });
    }

    if (req.url !== '/mcp') {
      return json(res, 404, { ok: false, error: 'NOT_FOUND' });
    }

    const sessionId = req.headers['mcp-session-id'];
    let transport = sessionId ? transports.get(String(sessionId)) : undefined;

    if (req.method === 'POST') {
      const body = await readJson(req);
      if (!transport && !sessionId && isInitializeRequest(body)) {
        transport = await createSessionTransport();
      }
      if (!transport) {
        return json(res, 400, { ok: false, error: 'INVALID_MCP_SESSION' });
      }
      await transport.handleRequest(req, res, body);
      return;
    }

    if (req.method === 'GET') {
      if (!transport) return json(res, 400, { ok: false, error: 'INVALID_MCP_SESSION' });
      await transport.handleRequest(req, res);
      return;
    }

    if (req.method === 'DELETE') {
      if (!transport) return json(res, 400, { ok: false, error: 'INVALID_MCP_SESSION' });
      await transport.handleRequest(req, res);
      if (sessionId) transports.delete(String(sessionId));
      return;
    }

    res.writeHead(405, { Allow: 'GET, POST, DELETE' });
    res.end();
  } catch (error) {
    console.error(`[mcp] request error message=${error.message}`);
    if (!res.headersSent) json(res, 500, { ok: false, error: 'MCP_INTERNAL_ERROR' });
    else if (!res.writableEnded) res.end();
  }
});

httpServer.listen(mcpPort, '127.0.0.1', () => {
  console.log(`GPT Local Bridge MCP listening on http://127.0.0.1:${mcpPort}/mcp`);
});

httpServer.on('error', (error) => {
  console.error(`[mcp] server error code=${error.code || 'UNKNOWN'} message=${error.message}`);
});

function shutdown() {
  console.log('[mcp] shutdown requested');
  for (const transport of transports.values()) {
    try { transport.close(); } catch {}
  }
  transports.clear();
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
