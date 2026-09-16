const { app, BrowserWindow, Tray, Menu, ipcMain, dialog, nativeImage } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const http = require('node:http');
const { loadConfig, saveConfig } = require('./agent/config');

let mainWindow = null;
let tray = null;
let agentProcess = null;
let quitting = false;
let startedAt = 0;
const sessionToken = crypto.randomBytes(32).toString('hex');

const hasSilentFlag = process.argv.includes('--silent');
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

function paths() {
  const base = app.getPath('userData');
  return {
    config: path.join(base, 'config.json'),
    audit: path.join(base, 'audit.jsonl')
  };
}

function ensureConfig() {
  const p = paths().config;
  if (!fs.existsSync(p)) saveConfig(p, {});
  return loadConfig(p);
}

function effectivePort() {
  return Number(ensureConfig().port || 8787);
}

function setWindowsLogin(config) {
  if (process.platform !== 'win32' || !app.isPackaged) return;
  app.setLoginItemSettings({
    openAtLogin: Boolean(config.startWithWindows),
    args: ['--silent']
  });
}

function getServiceStatus() {
  return {
    running: Boolean(agentProcess && !agentProcess.killed),
    pid: agentProcess?.pid || null,
    port: effectivePort(),
    started_at: startedAt || null
  };
}

function startService() {
  if (agentProcess && !agentProcess.killed) return getServiceStatus();
  const config = ensureConfig();
  const serverPath = path.join(__dirname, 'agent', 'server.js');
  const env = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    GPTLB_TOKEN: sessionToken,
    GPTLB_PORT: String(config.port || 8787),
    GPTLB_CONFIG_PATH: paths().config,
    GPTLB_AUDIT_PATH: paths().audit
  };
  agentProcess = spawn(process.execPath, [serverPath], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  startedAt = Date.now();
  agentProcess.stdout.on('data', (data) => console.log(`[agent] ${data.toString().trim()}`));
  agentProcess.stderr.on('data', (data) => console.error(`[agent] ${data.toString().trim()}`));
  agentProcess.on('exit', () => { agentProcess = null; startedAt = 0; notifyStatus(); });
  notifyStatus();
  return getServiceStatus();
}

function forceKillProcessTree(pid) {
  if (!pid) return;
  if (process.platform === 'win32') spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true });
  else { try { process.kill(pid, 'SIGKILL'); } catch {} }
}

function stopService() {
  return new Promise((resolve) => {
    if (!agentProcess) return resolve(getServiceStatus());
    const proc = agentProcess;
    const pid = proc.pid;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      if (agentProcess === proc) agentProcess = null;
      startedAt = 0;
      notifyStatus();
      resolve(getServiceStatus());
    };
    proc.once('exit', finish);
    try { proc.kill('SIGTERM'); } catch { finish(); return; }
    setTimeout(() => { if (!done) forceKillProcessTree(pid); }, 2000).unref();
    setTimeout(finish, 3500).unref();
  });
}

function requestAgent(method, route, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : '';
    const req = http.request({
      hostname: '127.0.0.1',
      port: effectivePort(),
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

function notifyStatus() {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('service:status-changed', getServiceStatus());
  refreshTrayMenu();
}

function showWindow() {
  if (!mainWindow) return;
  mainWindow.show();
  mainWindow.focus();
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 980,
    height: 720,
    minWidth: 820,
    minHeight: 620,
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
  const running = Boolean(agentProcess && !agentProcess.killed);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '显示控制面板', click: showWindow },
    { type: 'separator' },
    { label: '启动服务', enabled: !running, click: () => startService() },
    { label: '停止服务', enabled: running, click: () => stopService() },
    { type: 'separator' },
    { label: '退出', click: async () => { quitting = true; await stopService(); app.quit(); } }
  ]));
  tray.setToolTip(`GPT Local Bridge - ${running ? '服务运行中' : '服务已停止'}`);
}

function createTray() {
  const icon = nativeImage.createFromDataURL('data:image/svg+xml;charset=utf-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" rx="7" fill="#2b5bd7"/><path d="M9 10h14v3H9zm0 6h14v3H9zm0 6h9v3H9z" fill="white"/></svg>'));
  tray = new Tray(icon);
  tray.on('double-click', showWindow);
  refreshTrayMenu();
}

function registerIpc() {
  ipcMain.handle('service:status', async () => {
    const base = getServiceStatus();
    if (!base.running) return { ...base, healthy: false };
    try { return { ...base, healthy: Boolean((await requestAgent('GET', '/health')).ok) }; }
    catch { return { ...base, healthy: false }; }
  });
  ipcMain.handle('service:start', async () => startService());
  ipcMain.handle('service:stop', async () => stopService());
  ipcMain.handle('config:get', async () => ensureConfig());
  ipcMain.handle('config:save', async (_event, next) => {
    const previous = ensureConfig();
    const saved = saveConfig(paths().config, { ...previous, ...next });
    setWindowsLogin(saved);
    if (agentProcess && previous.port !== saved.port) {
      await stopService();
      if (saved.autoStartService) startService();
    }
    return saved;
  });
  ipcMain.handle('workspace:choose', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
    return result.canceled ? null : result.filePaths[0];
  });
  ipcMain.handle('agent:rpc', async (_event, payload) => {
    if (!agentProcess) throw new Error('Local Agent is not running.');
    return requestAgent('POST', '/rpc', { request_id: crypto.randomUUID(), method: payload.method, params: payload.params || {} });
  });
}

app.on('second-instance', () => showWindow());
app.on('before-quit', () => { quitting = true; });

app.whenReady().then(() => {
  const config = ensureConfig();
  setWindowsLogin(config);
  registerIpc();
  createWindow();
  createTray();
  if (config.autoStartService) startService();
  if (!hasSilentFlag && !config.startMinimized) showWindow();
});

app.on('quit', () => { if (agentProcess?.pid) forceKillProcessTree(agentProcess.pid); });
