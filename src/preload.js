const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bridge', {
  getStatus: () => ipcRenderer.invoke('stack:status'),
  startStack: () => ipcRenderer.invoke('stack:start'),
  stopStack: () => ipcRenderer.invoke('stack:stop'),
  startMcp: () => ipcRenderer.invoke('mcp:start'),
  stopMcp: () => ipcRenderer.invoke('mcp:stop'),
  startTunnel: () => ipcRenderer.invoke('tunnel:start'),
  stopTunnel: () => ipcRenderer.invoke('tunnel:stop'),
  getConfig: () => ipcRenderer.invoke('config:get'),
  saveConfig: (config) => ipcRenderer.invoke('config:save', config),
  chooseWorkspace: () => ipcRenderer.invoke('workspace:choose'),
  rpc: (method, params) => ipcRenderer.invoke('agent:rpc', { method, params }),
  getLogs: () => ipcRenderer.invoke('logs:get'),
  clearLogs: () => ipcRenderer.invoke('logs:clear'),
  openLogFile: () => ipcRenderer.invoke('logs:open-file'),
  openExternal: (key) => ipcRenderer.invoke('external:open', key),
  onLog: (callback) => {
    const listener = (_event, entry) => callback(entry);
    ipcRenderer.on('logs:entry', listener);
    return () => ipcRenderer.removeListener('logs:entry', listener);
  },
  onStatus: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on('stack:status-changed', listener);
    return () => ipcRenderer.removeListener('stack:status-changed', listener);
  }
});
