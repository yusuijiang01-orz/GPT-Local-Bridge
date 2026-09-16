const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bridge', {
  getStatus: () => ipcRenderer.invoke('service:status'),
  startService: () => ipcRenderer.invoke('service:start'),
  stopService: () => ipcRenderer.invoke('service:stop'),
  getConfig: () => ipcRenderer.invoke('config:get'),
  saveConfig: (config) => ipcRenderer.invoke('config:save', config),
  chooseWorkspace: () => ipcRenderer.invoke('workspace:choose'),
  rpc: (method, params) => ipcRenderer.invoke('agent:rpc', { method, params })
});
