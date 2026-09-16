const els = {
  overallBadge: document.getElementById('overallBadge'),
  agentDot: document.getElementById('agentDot'), agentStatus: document.getElementById('agentStatus'), agentEndpoint: document.getElementById('agentEndpoint'), agentPid: document.getElementById('agentPid'),
  mcpDot: document.getElementById('mcpDot'), mcpStatus: document.getElementById('mcpStatus'), mcpEndpoint: document.getElementById('mcpEndpoint'), mcpPid: document.getElementById('mcpPid'),
  tunnelDot: document.getElementById('tunnelDot'), tunnelStatus: document.getElementById('tunnelStatus'), activeTunnelId: document.getElementById('activeTunnelId'), runtimeKeyState: document.getElementById('runtimeKeyState'),
  startStack: document.getElementById('startStackBtn'), stopStack: document.getElementById('stopStackBtn'), refresh: document.getElementById('refreshBtn'),
  startTunnel: document.getElementById('startTunnelBtn'), stopTunnel: document.getElementById('stopTunnelBtn'),
  autoStartService: document.getElementById('autoStartService'), autoStartMcpBridge: document.getElementById('autoStartMcpBridge'), startMinimized: document.getElementById('startMinimized'), startWithWindows: document.getElementById('startWithWindows'),
  port: document.getElementById('port'), mcpPort: document.getElementById('mcpPort'),
  tunnelEnabled: document.getElementById('tunnelEnabled'), tunnelAutoStart: document.getElementById('tunnelAutoStart'), tunnelExecutable: document.getElementById('tunnelExecutable'), tunnelId: document.getElementById('tunnelId'), tunnelHealthPort: document.getElementById('tunnelHealthPort'),
  openTunnels: document.getElementById('openTunnelsBtn'), openTunnelClient: document.getElementById('openTunnelClientBtn'), openMcpHelp: document.getElementById('openMcpHelpBtn'),
  addWorkspace: document.getElementById('addWorkspaceBtn'), workspaceList: document.getElementById('workspaceList'),
  save: document.getElementById('saveBtn'), saveState: document.getElementById('saveState'), test: document.getElementById('testBtn'), output: document.getElementById('output'),
  logFilter: document.getElementById('logFilter'), autoScroll: document.getElementById('autoScroll'), clearLogs: document.getElementById('clearLogsBtn'), openLogFile: document.getElementById('openLogFileBtn'), logs: document.getElementById('logs')
};

let config = null;
let runtimeLogs = [];
let refreshing = false;

function validPort(value) {
  return Number.isInteger(value) && value >= 1024 && value <= 65535;
}

function setDot(element, state) {
  element.className = `dot ${state}`;
}

function statusText(item) {
  if (!item.running) return '已停止';
  return item.healthy ? '正常' : '运行中 / 未就绪';
}

function renderStatus(status) {
  const agent = status.agent;
  const mcp = status.mcp;
  const tunnel = status.tunnel;

  els.agentStatus.textContent = statusText(agent);
  els.agentEndpoint.textContent = `127.0.0.1:${agent.port}`;
  els.agentPid.textContent = agent.pid || '-';
  setDot(els.agentDot, agent.healthy ? 'ok' : agent.running ? 'warn' : 'off');

  els.mcpStatus.textContent = statusText(mcp);
  els.mcpEndpoint.textContent = mcp.endpoint;
  els.mcpPid.textContent = mcp.pid || '-';
  setDot(els.mcpDot, mcp.healthy ? 'ok' : mcp.running ? 'warn' : 'off');

  els.tunnelStatus.textContent = !tunnel.enabled ? '未启用' : statusText(tunnel);
  els.activeTunnelId.textContent = tunnel.tunnel_id || '-';
  els.runtimeKeyState.textContent = tunnel.runtime_key_present ? '已检测到环境变量' : '未检测到 CONTROL_PLANE_API_KEY';
  setDot(els.tunnelDot, tunnel.healthy ? 'ok' : tunnel.running ? 'warn' : 'off');

  const localReady = Boolean(agent.healthy && mcp.healthy);
  const tunnelReady = Boolean(tunnel.enabled && tunnel.healthy);
  if (tunnelReady) {
    els.overallBadge.textContent = 'Tunnel 已就绪';
    els.overallBadge.className = 'badge running';
  } else if (localReady) {
    els.overallBadge.textContent = '本地 MCP 已就绪';
    els.overallBadge.className = 'badge local';
  } else if (agent.running || mcp.running || tunnel.running) {
    els.overallBadge.textContent = 'Bridge 启动中';
    els.overallBadge.className = 'badge warning';
  } else {
    els.overallBadge.textContent = 'Bridge 已停止';
    els.overallBadge.className = 'badge stopped';
  }

  els.startStack.disabled = agent.running && mcp.running;
  els.stopStack.disabled = !(agent.running || mcp.running || tunnel.running);
  els.startTunnel.disabled = !tunnel.enabled || tunnel.running;
  els.stopTunnel.disabled = !tunnel.running;
}

async function refreshStatus() {
  if (refreshing) return;
  refreshing = true;
  try {
    renderStatus(await window.bridge.getStatus());
  } catch (error) {
    els.output.textContent = `状态读取失败：${error.message}`;
  } finally {
    refreshing = false;
  }
}

function renderWorkspaces() {
  els.workspaceList.innerHTML = '';
  if (!config.workspaces.length) {
    const li = document.createElement('li');
    li.textContent = '尚未配置工作区。';
    els.workspaceList.appendChild(li);
    return;
  }
  config.workspaces.forEach((workspace, index) => {
    const li = document.createElement('li');
    const code = document.createElement('code');
    code.textContent = workspace;
    const button = document.createElement('button');
    button.textContent = '移除';
    button.addEventListener('click', () => {
      config.workspaces.splice(index, 1);
      renderWorkspaces();
    });
    li.append(code, button);
    els.workspaceList.appendChild(li);
  });
}

async function loadConfig() {
  config = await window.bridge.getConfig();
  els.autoStartService.checked = Boolean(config.autoStartService);
  els.autoStartMcpBridge.checked = config.autoStartMcpBridge !== false;
  els.startMinimized.checked = Boolean(config.startMinimized);
  els.startWithWindows.checked = Boolean(config.startWithWindows);
  els.port.value = config.port;
  els.mcpPort.value = config.mcpPort || 8788;
  els.tunnelEnabled.checked = Boolean(config.tunnel?.enabled);
  els.tunnelAutoStart.checked = Boolean(config.tunnel?.autoStart);
  els.tunnelExecutable.value = config.tunnel?.executable || 'tunnel-client';
  els.tunnelId.value = config.tunnel?.tunnelId || '';
  els.tunnelHealthPort.value = config.tunnel?.healthPort || 8790;
  renderWorkspaces();
}

function formatLog(entry) {
  const time = new Date(entry.timestamp).toLocaleTimeString();
  return `[${time}] [${String(entry.source).toUpperCase()}] [${String(entry.level).toUpperCase()}] ${entry.message}`;
}

function renderLogs() {
  const filter = els.logFilter.value;
  const visible = runtimeLogs.filter((entry) => filter === 'all' || entry.source === filter).slice(-700);
  els.logs.textContent = visible.length ? visible.map(formatLog).join('\n') : '暂无匹配日志。';
  if (els.autoScroll.checked) els.logs.scrollTop = els.logs.scrollHeight;
}

async function loadLogs() {
  runtimeLogs = await window.bridge.getLogs();
  renderLogs();
}

async function runAction(action, busyText) {
  els.output.textContent = busyText;
  try {
    await action();
    els.output.textContent = '操作完成。详情请查看实时日志。';
  } catch (error) {
    els.output.textContent = `操作失败：${error.message}`;
  }
  await refreshStatus();
}

els.startStack.addEventListener('click', () => runAction(() => window.bridge.startStack(), '正在启动 Local Agent 与 MCP Bridge...'));
els.stopStack.addEventListener('click', () => runAction(() => window.bridge.stopStack(), '正在停止 Bridge...'));
els.startTunnel.addEventListener('click', () => runAction(() => window.bridge.startTunnel(), '正在启动 Secure MCP Tunnel...'));
els.stopTunnel.addEventListener('click', () => runAction(() => window.bridge.stopTunnel(), '正在停止 Secure MCP Tunnel...'));
els.refresh.addEventListener('click', refreshStatus);

els.addWorkspace.addEventListener('click', async () => {
  const chosen = await window.bridge.chooseWorkspace();
  if (chosen && !config.workspaces.includes(chosen)) {
    config.workspaces.push(chosen);
    renderWorkspaces();
  }
});

els.save.addEventListener('click', async () => {
  const port = Number(els.port.value);
  const mcpPort = Number(els.mcpPort.value);
  const tunnelHealthPort = Number(els.tunnelHealthPort.value);
  if (![port, mcpPort, tunnelHealthPort].every(validPort)) {
    els.saveState.textContent = '所有端口必须在 1024-65535。';
    return;
  }
  if (new Set([port, mcpPort, tunnelHealthPort]).size !== 3) {
    els.saveState.textContent = '三个本机端口不能重复。';
    return;
  }
  if (els.tunnelEnabled.checked && !els.tunnelId.value.trim()) {
    els.saveState.textContent = '启用 Tunnel 时必须填写 Tunnel ID。';
    return;
  }

  try {
    config = await window.bridge.saveConfig({
      ...config,
      port,
      mcpPort,
      autoStartService: els.autoStartService.checked,
      autoStartMcpBridge: els.autoStartMcpBridge.checked,
      startMinimized: els.startMinimized.checked,
      startWithWindows: els.startWithWindows.checked,
      tunnel: {
        ...(config.tunnel || {}),
        enabled: els.tunnelEnabled.checked,
        autoStart: els.tunnelAutoStart.checked,
        executable: els.tunnelExecutable.value.trim() || 'tunnel-client',
        tunnelId: els.tunnelId.value.trim(),
        healthPort: tunnelHealthPort
      }
    });
    els.saveState.textContent = '已保存。';
    setTimeout(() => { els.saveState.textContent = ''; }, 1800);
    await refreshStatus();
  } catch (error) {
    els.saveState.textContent = `保存失败：${error.message}`;
  }
});

els.test.addEventListener('click', async () => {
  els.output.textContent = '执行中...';
  try {
    els.output.textContent = JSON.stringify(await window.bridge.rpc('list_files', { path: '.', depth: 1 }), null, 2);
  } catch (error) {
    els.output.textContent = `测试失败：${error.message}`;
  }
});

els.openTunnels.addEventListener('click', () => window.bridge.openExternal('tunnels'));
els.openTunnelClient.addEventListener('click', () => window.bridge.openExternal('tunnelClient'));
els.openMcpHelp.addEventListener('click', () => window.bridge.openExternal('mcpHelp'));
els.logFilter.addEventListener('change', renderLogs);
els.autoScroll.addEventListener('change', renderLogs);
els.clearLogs.addEventListener('click', async () => {
  await window.bridge.clearLogs();
  runtimeLogs = [];
  renderLogs();
});
els.openLogFile.addEventListener('click', () => window.bridge.openLogFile());

window.bridge.onLog((entry) => {
  runtimeLogs.push(entry);
  if (runtimeLogs.length > 1500) runtimeLogs.splice(0, runtimeLogs.length - 1500);
  renderLogs();
});
window.bridge.onStatus(() => refreshStatus());

Promise.all([loadConfig(), loadLogs(), refreshStatus()]).then(() => {
  setInterval(refreshStatus, 3000);
});
