const { app, BrowserWindow, Tray, Menu, ipcMain, dialog, nativeImage, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const http = require('node:http');
const { loadConfig, saveConfig } = require('./agent/config');

let mainWindow = null;
let tray = null;
let agentProcess = null;
let mcpProcess = null;
let tunnelProcess = null;
let quitting = false;
let agentStartedAt = 0;
let mcpStartedAt = 0;
let tunnelStartedAt = 0;
const logBuffer = [];
const MAX_LOG_ENTRIES = 1500;
const sessionToken = crypto.randomBytes(32).toString('hex');

const hasSilentFlag = process.argv.includes('--silent');
const hasStopFlag = process.argv.includes('--stop');
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

function paths() {
  const base = app.getPath('userData');
  return {
    config: path.join(base, 'config.json'),
    audit: path.join(base, 'audit.jsonl'),
    runtimeLog: path.join(base, 'runtime.log')
  };
}

function redactLogMessage(message) {
  return String(message || '')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, 'sk-[REDACTED]')
    .replace(new RegExp(sessionToken, 'g'), '[SESSION_TOKEN_REDACTED]');
}

function appendLog(source, level, message) {
  const lines = redactLogMessage(message).split(/\r?\n/).filter(Boolean);
  if (!lines.length) return;
  fs.mkdirSync(path.dirname(paths().runtimeLog), { recursive: true });
  for (const raw of lines) {
    const entry = {
      timestamp: new Date().toISOString(),
      source,
      level,
      message: raw.length > 4000 ? `${raw.slice(0, 4000)}…` : raw
    };
    logBuffer.push(entry);
    if (logBuffer.length > MAX_LOG_ENTRIES) logBuffer.splice(0, logBuffer.length - MAX_LOG_ENTRIES);
    try {
      fs.appendFileSync(paths().runtimeLog, `[${entry.timestamp}] [${source}] [${level.toUpperCase()}] ${entry.message}\n`, 'utf8');
    } catch {}
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('logs:entry', entry);
  }
}

function ensureConfig() {
  const p = paths().config;
  if (!fs.existsSync(p)) saveConfig(p, {});
  return loadConfig(p);
}

function processRunning(proc) {
  return Boolean(proc && !proc.killed && proc.exitCode === null);
}

function attachProcessLogs(proc, source, onExit) {
  proc.stdout?.on('data', (data) => appendLog(source, 'info', data.toString('utf8').trim()));
  proc.stderr?.on('data', (data) => appendLog(source, 'error', data.toString('utf8').trim()));
  proc.on('error', (error) => appendLog(source, 'error', `process error: ${error.message}`));
  proc.on('exit', (code, signal) => {
    appendLog(source, code === 0 ? 'info' : 'warning', `process exited code=${code ?? '-'} signal=${signal || '-'}`);
    onExit();
    notifyStatus();
  });
}

function baseStatus() {
  const config = ensureConfig();
  return {
    agent: {
      running: processRunning(agentProcess),
      pid: processRunning(agentProcess) ? agentProcess.pid : null,
      port: Number(config.port || 8787),
      started_at: agentStartedAt || null
    },
    mcp: {
      running: processRunning(mcpProcess),
      pid: processRunning(mcpProcess) ? mcpProcess.pid : null,
      port: Number(config.mcpPort || 8788),
      endpoint: `http://127.0.0.1:${Number(config.mcpPort || 8788)}/mcp`,
      started_at: mcpStartedAt || null
    },
    tunnel: {
      running: processRunning(tunnelProcess),
      pid: processRunning(tunnelProcess) ? tunnelProcess.pid : null,
      enabled: Boolean(config.tunnel?.enabled),
      tunnel_id: config.tunnel?.tunnelId || '',
      health_port: Number(config.tunnel?.healthPort || 8790),
      runtime_key_present: Boolean(process.env.CONTROL_PLANE_API_KEY),
      started_at: tunnelStartedAt || null
    }
  };
}

function httpRequestStatus({ port, route, token, timeout = 1500 }) {
  return new Promise((resolve) => {
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    const req = http.request({ hostname: '127.0.0.1', port, method: 'GET', path: route, headers, timeout }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode || 0));
    });
    req.on('timeout', () => { req.destroy(); resolve(0); });
    req.on('error', () => resolve(0));
    req.end();
  });
}

async function getStackStatus() {
  const status = baseStatus();
  const checks = [];
  if (status.agent.running) {
    checks.push(httpRequestStatus({ port: status.agent.port, route: '/health', token: sessionToken }).then((code) => { status.agent.healthy = code === 200; }));
  } else status.agent.healthy = false;
  if (status.mcp.running) {
    checks.push(httpRequestStatus({ port: status.mcp.port, route: '/health' }).then((code) => { status.mcp.healthy = code === 200; }));
  } else status.mcp.healthy = false;
  if (status.tunnel.running) {
    checks.push(httpRequestStatus({ port: status.tunnel.health_port, route: '/readyz' }).then((code) => { status.tunnel.healthy = code >= 200 && code < 300; }));
  } else status.tunnel.healthy = false;
  await Promise.all(checks);
  return status;
}

function notifyStatus() {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('stack:status-changed', baseStatus());
  refreshTrayMenu();
}

function spawnNodeScript(scriptPath, env, source) {
  const proc = spawn(process.execPath, [scriptPath], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', ...env },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  appendLog('app', 'info', `started ${source} pid=${proc.pid || '-'}`);
  return proc;
}

function startAgent() {
  if (processRunning(agentProcess)) return baseStatus().agent;
  const config = ensureConfig();
  agentProcess = spawnNodeScript(path.join(__dirname, 'agent', 'server.js'), {
    GPTLB_TOKEN: sessionToken,
    GPTLB_PORT: String(config.port || 8787),
    GPTLB_CONFIG_PATH: paths().config,
    GPTLB_AUDIT_PATH: paths().audit
  }, 'agent');
  agentStartedAt = Date.now();
  const current = agentProcess;
  attachProcessLogs(current, 'agent', () => {
    if (agentProcess === current) agentProcess = null;
    agentStartedAt = 0;
  });
  notifyStatus();
  return baseStatus().agent;
}

function startMcpBridge() {
  if (processRunning(mcpProcess)) return baseStatus().mcp;
  if (!processRunning(agentProcess)) startAgent();
  const config = ensureConfig();
  mcpProcess = spawnNodeScript(path.join(__dirname, 'mcp', 'server.mjs'), {
    GPTLB_AGENT_TOKEN: sessionToken,
    GPTLB_AGENT_PORT: String(config.port || 8787),
    GPTLB_MCP_PORT: String(config.mcpPort || 8788)
  }, 'mcp');
  mcpStartedAt = Date.now();
  const current = mcpProcess;
  attachProcessLogs(current, 'mcp', () => {
    if (mcpProcess === current) mcpProcess = null;
    mcpStartedAt = 0;
  });
  notifyStatus();
  return baseStatus().mcp;
}

function startTunnel() {
  if (processRunning(tunnelProcess)) return baseStatus().tunnel;
  const config = ensureConfig();
  if (!config.tunnel?.enabled) throw new Error('Secure MCP Tunnel 未启用。请先在设置中启用并保存。');
  if (!config.tunnel?.tunnelId) throw new Error('缺少 Tunnel ID。请先配置 OpenAI Secure MCP Tunnel ID。');
  if (!process.env.CONTROL_PLANE_API_KEY) throw new Error('未检测到 CONTROL_PLANE_API_KEY 环境变量。密钥不会保存在 GPT Local Bridge 配置中。');
  if (!processRunning(mcpProcess)) startMcpBridge();

  const executable = config.tunnel.executable || 'tunnel-client';
  const healthPort = Number(config.tunnel.healthPort || 8790);
  const mcpUrl = `http://127.0.0.1:${Number(config.mcpPort || 8788)}/mcp`;
  const args = [
    'run',
    '--control-plane.tunnel-id', String(config.tunnel.tunnelId),
    '--control-plane.api-key', 'env:CONTROL_PLANE_API_KEY',
    '--mcp.server-url', mcpUrl,
    '--health.listen-addr', `127.0.0.1:${healthPort}`,
    '--log.level', 'info',
    '--log.format', 'struct-text'
  ];
  appendLog('app', 'info', `starting tunnel-client for tunnel=${config.tunnel.tunnelId} mcp=${mcpUrl}`);
  tunnelProcess = spawn(executable, args, {
    env: { ...process.env },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false
  });
  tunnelStartedAt = Date.now();
  const current = tunnelProcess;
  attachProcessLogs(current, 'tunnel', () => {
    if (tunnelProcess === current) tunnelProcess = null;
    tunnelStartedAt = 0;
  });
  notifyStatus();
  return baseStatus().tunnel;
}

async function waitUntil(check, timeoutMs = 6000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return false;
}

async function startStack() {
  const config = ensureConfig();
  appendLog('app', 'info', 'start bridge stack requested');
  startAgent();
  const agentReady = await waitUntil(async () => (await httpRequestStatus({ port: Number(config.port || 8787), route: '/health', token: sessionToken })) === 200);
  if (!agentReady) appendLog('app', 'warning', 'Local Agent did not become healthy within 6 seconds');

  if (config.autoStartMcpBridge !== false) {
    startMcpBridge();
    const mcpReady = await waitUntil(async () => (await httpRequestStatus({ port: Number(config.mcpPort || 8788), route: '/health' })) === 200);
    if (!mcpReady) appendLog('app', 'warning', 'MCP Bridge did not become healthy within 6 seconds');
  }

  if (config.tunnel?.enabled && config.tunnel?.autoStart) {
    try { startTunnel(); }
    catch (error) { appendLog('tunnel', 'error', error.message); }
  }
  notifyStatus();
  return getStackStatus();
}

function forceKillProcessTree(pid) {
  if (!pid) return;
  if (process.platform === 'win32') spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true });
  else { try { process.kill(pid, 'SIGKILL'); } catch {} }
}

function stopManagedProcess(proc, source, clearRef) {
  return new Promise((resolve) => {
    if (!processRunning(proc)) {
      clearRef();
      resolve();
      return;
    }
    const pid = proc.pid;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearRef();
      appendLog('app', 'info', `stopped ${source} pid=${pid || '-'}`);
      notifyStatus();
      resolve();
    };
    proc.once('exit', finish);
    try { proc.kill('SIGTERM'); }
    catch { finish(); return; }
    setTimeout(() => { if (!done) forceKillProcessTree(pid); }, 2200).unref();
    setTimeout(finish, 3600).unref();
  });
}

async function stopTunnel() {
  const proc = tunnelProcess;
  await stopManagedProcess(proc, 'tunnel', () => {
    if (tunnelProcess === proc) tunnelProcess = null;
    tunnelStartedAt = 0;
  });
  return baseStatus().tunnel;
}

async function stopMcpBridge() {
  const proc = mcpProcess;
  await stopManagedProcess(proc, 'mcp', () => {
    if (mcpProcess === proc) mcpProcess = null;
    mcpStartedAt = 0;
  });
  return baseStatus().mcp;
}

async function stopAgent() {
  const proc = agentProcess;
  await stopManagedProcess(proc, 'agent', () => {
    if (agentProcess === proc) agentProcess = null;
    agentStartedAt = 0;
  });
  return baseStatus().agent;
}

async function stopStack() {
  appendLog('app', 'info', 'stop bridge stack requested');
  await stopTunnel();
  await stopMcpBridge();
  await stopAgent();
  notifyStatus();
  return getStackStatus();
}

function requestAgent(method, route, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : '';
    const req = http.request({
      hostname: '127.0.0.1',
      port: Number(ensureConfig().port || 8787),
      method,
      path: route,
      headers: {
        Authorization: `Bearer ${sessionToken}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      },
      timeout: 5000
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error('Invalid response from local agent.')); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('Local agent request timed out.')));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function setWindowsLogin(config) {
  if (process.platform !== 'win32' || !app.isPackaged) return;
  app.setLoginItemSettings({ openAtLogin: Boolean(config.startWithWindows), args: ['--silent'] });
}

function showWindow() {
  if (!mainWindow) return;
  mainWindow.show();
  mainWindow.focus();
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1080,
    height: 820,
    minWidth: 900,
    minHeight: 680,
    show: false,
    title: 'GPT Local Bridge',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.on('close', (event) => {
    if (!quitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
  mainWindow.on('closed', () => { mainWindow = null; });
}

function refreshTrayMenu() {
  if (!tray) return;
  const running = processRunning(agentProcess) || processRunning(mcpProcess) || processRunning(tunnelProcess);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '显示控制面板', click: showWindow },
    { type: 'separator' },
    { label: '启动 Bridge', click: () => startStack().catch((error) => appendLog('app', 'error', error.message)) },
    { label: '停止 Bridge', enabled: running, click: () => stopStack() },
    { type: 'separator' },
    { label: '退出', click: async () => { quitting = true; await stopStack(); app.quit(); } }
  ]));
  tray.setToolTip(`GPT Local Bridge - ${running ? '运行中' : '已停止'}`);
}

function createTray() {
  const icon = nativeImage.createFromDataURL('data:image/svg+xml;charset=utf-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" rx="7" fill="#2b5bd7"/><path d="M9 10h14v3H9zm0 6h14v3H9zm0 6h9v3H9z" fill="white"/></svg>'));
  tray = new Tray(icon);
  tray.on('double-click', showWindow);
  refreshTrayMenu();
}

function registerIpc() {
  ipcMain.handle('stack:status', async () => getStackStatus());
  ipcMain.handle('stack:start', async () => startStack());
  ipcMain.handle('stack:stop', async () => stopStack());
  ipcMain.handle('mcp:start', async () => { startMcpBridge(); return getStackStatus(); });
  ipcMain.handle('mcp:stop', async () => { await stopMcpBridge(); return getStackStatus(); });
  ipcMain.handle('tunnel:start', async () => { startTunnel(); return getStackStatus(); });
  ipcMain.handle('tunnel:stop', async () => { await stopTunnel(); return getStackStatus(); });
  ipcMain.handle('config:get', async () => ensureConfig());
  ipcMain.handle('config:save', async (_event, next) => {
    const previous = ensureConfig();
    const saved = saveConfig(paths().config, { ...previous, ...next });
    setWindowsLogin(saved);
    const portsChanged = Number(previous.port) !== Number(saved.port) || Number(previous.mcpPort) !== Number(saved.mcpPort) || Number(previous.tunnel?.healthPort) !== Number(saved.tunnel?.healthPort);
    const tunnelChanged = previous.tunnel?.executable !== saved.tunnel?.executable || previous.tunnel?.tunnelId !== saved.tunnel?.tunnelId || previous.tunnel?.enabled !== saved.tunnel?.enabled;
    appendLog('app', 'info', 'configuration saved');
    if ((portsChanged || tunnelChanged) && (processRunning(agentProcess) || processRunning(mcpProcess) || processRunning(tunnelProcess))) {
      appendLog('app', 'info', 'runtime-relevant configuration changed; restarting bridge stack');
      await stopStack();
      if (saved.autoStartService) await startStack();
    }
    return saved;
  });
  ipcMain.handle('workspace:choose', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
    return result.canceled ? null : result.filePaths[0];
  });
  ipcMain.handle('agent:rpc', async (_event, payload) => {
    if (!processRunning(agentProcess)) throw new Error('Local Agent is not running.');
    return requestAgent('POST', '/rpc', { request_id: crypto.randomUUID(), method: payload.method, params: payload.params || {} });
  });
  ipcMain.handle('logs:get', async () => [...logBuffer]);
  ipcMain.handle('logs:clear', async () => { logBuffer.length = 0; return true; });
  ipcMain.handle('logs:open-file', async () => {
    const logPath = paths().runtimeLog;
    if (!fs.existsSync(logPath)) fs.writeFileSync(logPath, '', 'utf8');
    shell.showItemInFolder(logPath);
    return logPath;
  });
  ipcMain.handle('external:open', async (_event, key) => {
    const urls = {
      tunnels: 'https://platform.openai.com/settings/organization/tunnels',
      tunnelClient: 'https://github.com/openai/tunnel-client/releases/latest',
      mcpHelp: 'https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt'
    };
    if (!urls[key]) throw new Error('Unknown external link.');
    await shell.openExternal(urls[key]);
    return true;
  });
}

app.on('second-instance', async (_event, argv) => {
  if (argv.includes('--stop')) {
    appendLog('app', 'info', 'stop requested by second instance');
    await stopStack();
    return;
  }
  showWindow();
});
app.on('before-quit', () => { quitting = true; });

app.whenReady().then(async () => {
  if (hasStopFlag) {
    app.quit();
    return;
  }
  const config = ensureConfig();
  setWindowsLogin(config);
  registerIpc();
  createWindow();
  createTray();
  appendLog('app', 'info', `GPT Local Bridge ${app.getVersion()} started${hasSilentFlag ? ' in silent mode' : ''}`);
  if (config.autoStartService) await startStack();
  if (!hasSilentFlag && !config.startMinimized) showWindow();
});

app.on('quit', () => {
  for (const proc of [tunnelProcess, mcpProcess, agentProcess]) {
    if (proc?.pid) forceKillProcessTree(proc.pid);
  }
});
