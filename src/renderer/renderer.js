const els = {
  badge: document.getElementById('statusBadge'), endpoint: document.getElementById('endpoint'), pid: document.getElementById('pid'), health: document.getElementById('health'),
  start: document.getElementById('startBtn'), stop: document.getElementById('stopBtn'), refresh: document.getElementById('refreshBtn'),
  autoStartService: document.getElementById('autoStartService'), startMinimized: document.getElementById('startMinimized'), startWithWindows: document.getElementById('startWithWindows'),
  port: document.getElementById('port'), addWorkspace: document.getElementById('addWorkspaceBtn'), workspaceList: document.getElementById('workspaceList'),
  save: document.getElementById('saveBtn'), saveState: document.getElementById('saveState'), test: document.getElementById('testBtn'), output: document.getElementById('output')
};
let config = null;

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

async function refreshStatus() {
  try {
    const status = await window.bridge.getStatus();
    els.badge.textContent = status.running ? '服务运行中' : '服务已停止';
    els.badge.className = `badge ${status.running ? 'running' : 'stopped'}`;
    els.endpoint.textContent = `127.0.0.1:${status.port}`;
    els.pid.textContent = status.pid || '-';
    els.health.textContent = status.running ? (status.healthy ? '正常' : '未就绪') : '-';
    els.start.disabled = status.running;
    els.stop.disabled = !status.running;
  } catch (error) {
    els.output.textContent = error.message;
  }
}

async function loadConfig() {
  config = await window.bridge.getConfig();
  els.autoStartService.checked = Boolean(config.autoStartService);
  els.startMinimized.checked = Boolean(config.startMinimized);
  els.startWithWindows.checked = Boolean(config.startWithWindows);
  els.port.value = config.port;
  renderWorkspaces();
}

els.start.addEventListener('click', async () => {
  await window.bridge.startService();
  setTimeout(refreshStatus, 250);
});
els.stop.addEventListener('click', async () => {
  await window.bridge.stopService();
  refreshStatus();
});
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
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    els.saveState.textContent = '端口必须在 1024-65535。';
    return;
  }
  config = await window.bridge.saveConfig({
    ...config,
    port,
    autoStartService: els.autoStartService.checked,
    startMinimized: els.startMinimized.checked,
    startWithWindows: els.startWithWindows.checked
  });
  els.saveState.textContent = '已保存。';
  setTimeout(() => { els.saveState.textContent = ''; }, 1800);
  refreshStatus();
});
els.test.addEventListener('click', async () => {
  els.output.textContent = '执行中...';
  try {
    els.output.textContent = JSON.stringify(await window.bridge.rpc('list_files', { path: '.', depth: 1 }), null, 2);
  } catch (error) {
    els.output.textContent = error.message;
  }
});

Promise.all([loadConfig(), refreshStatus()]).then(() => setInterval(refreshStatus, 3000));
