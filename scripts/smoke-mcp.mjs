import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const children = [];
const diagnostics = [];

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

function startChild(label, script, env) {
  const child = spawn(process.execPath, [script], {
    cwd: repoRoot,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  children.push(child);
  child.stdout.on('data', (chunk) => diagnostics.push(`[${label}] ${chunk.toString('utf8').trim()}`));
  child.stderr.on('data', (chunk) => diagnostics.push(`[${label}:err] ${chunk.toString('utf8').trim()}`));
  return child;
}

async function waitFor(url, options = {}, timeoutMs = 10000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url, options);
      if (response.ok) return response;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function mcpPost(port, body, sessionId = null) {
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream'
  };
  if (sessionId) {
    headers['Mcp-Session-Id'] = sessionId;
    headers['MCP-Protocol-Version'] = '2025-11-25';
  }
  return fetch(`http://127.0.0.1:${port}/mcp`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });
}

function terminate(child) {
  if (!child || child.exitCode !== null) return;
  try { child.kill('SIGTERM'); } catch {}
}

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gpt-local-bridge-smoke-'));

try {
  const agentPort = await freePort();
  const mcpPort = await freePort();
  const token = `smoke-${crypto.randomUUID()}`;
  const configPath = path.join(tempDir, 'config.json');
  const auditPath = path.join(tempDir, 'audit.jsonl');

  fs.writeFileSync(configPath, JSON.stringify({
    port: agentPort,
    mcpPort,
    workspaces: [repoRoot],
    limits: {
      maxFileBytes: 262144,
      maxListEntries: 1000,
      maxSearchResults: 100,
      maxSearchBytes: 262144,
      commandTimeoutMs: 120000
    }
  }, null, 2));

  startChild('agent', path.join(repoRoot, 'src', 'agent', 'server.js'), {
    GPTLB_TOKEN: token,
    GPTLB_PORT: String(agentPort),
    GPTLB_CONFIG_PATH: configPath,
    GPTLB_AUDIT_PATH: auditPath
  });

  await waitFor(`http://127.0.0.1:${agentPort}/health`, {
    headers: { Authorization: `Bearer ${token}` }
  });

  startChild('mcp', path.join(repoRoot, 'src', 'mcp', 'server.mjs'), {
    GPTLB_AGENT_TOKEN: token,
    GPTLB_AGENT_PORT: String(agentPort),
    GPTLB_MCP_PORT: String(mcpPort)
  });

  await waitFor(`http://127.0.0.1:${mcpPort}/health`);

  const initResponse = await mcpPost(mcpPort, {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'gpt-local-bridge-smoke', version: '1.0.0' }
    }
  });
  if (!initResponse.ok) throw new Error(`initialize failed with HTTP ${initResponse.status}: ${await initResponse.text()}`);
  const initPayload = await initResponse.json();
  if (!initPayload.result?.serverInfo?.name) throw new Error('initialize response missing serverInfo');
  const sessionId = initResponse.headers.get('mcp-session-id');
  if (!sessionId) throw new Error('initialize response missing Mcp-Session-Id');

  const initializedResponse = await mcpPost(mcpPort, {
    jsonrpc: '2.0',
    method: 'notifications/initialized'
  }, sessionId);
  if (!initializedResponse.ok) throw new Error(`notifications/initialized failed with HTTP ${initializedResponse.status}`);

  const toolsResponse = await mcpPost(mcpPort, {
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/list',
    params: {}
  }, sessionId);
  if (!toolsResponse.ok) throw new Error(`tools/list failed with HTTP ${toolsResponse.status}: ${await toolsResponse.text()}`);
  const toolsPayload = await toolsResponse.json();
  const names = new Set((toolsPayload.result?.tools || []).map((tool) => tool.name));
  for (const required of ['list_files', 'read_file', 'search_files', 'run_command']) {
    if (!names.has(required)) throw new Error(`tools/list missing ${required}`);
  }

  const callResponse = await mcpPost(mcpPort, {
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: {
      name: 'list_files',
      arguments: { path: '.', depth: 0, workspace_root: repoRoot }
    }
  }, sessionId);
  if (!callResponse.ok) throw new Error(`tools/call failed with HTTP ${callResponse.status}: ${await callResponse.text()}`);
  const callPayload = await callResponse.json();
  if (callPayload.result?.isError) throw new Error(`list_files returned MCP error: ${JSON.stringify(callPayload.result)}`);
  const text = callPayload.result?.content?.find((item) => item.type === 'text')?.text || '';
  const listed = JSON.parse(text);
  if (!Array.isArray(listed.entries)) throw new Error('list_files result did not contain entries');

  console.log(`MCP smoke test passed: ${names.size} tools, ${listed.entries.length} root entries.`);
} catch (error) {
  console.error(error.stack || error.message);
  if (diagnostics.length) console.error(diagnostics.join('\n'));
  process.exitCode = 1;
} finally {
  for (const child of children.reverse()) terminate(child);
  await new Promise((resolve) => setTimeout(resolve, 350));
  fs.rmSync(tempDir, { recursive: true, force: true });
}
