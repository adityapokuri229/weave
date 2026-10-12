const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('weaveAPI', {
  // Window controls
  minimize: () => ipcRenderer.send('weave:window-minimize'),
  maximize: () => ipcRenderer.send('weave:window-maximize'),
  close: () => ipcRenderer.send('weave:window-close'),

  // Bot & Google Status
  getStatus: () => ipcRenderer.invoke('weave:get-status'),
  onStatusUpdate: (callback) => {
    ipcRenderer.on('weave:status-update', (_event, data) => callback(data));
  },

  // QR Code stream
  onQrUpdate: (callback) => {
    ipcRenderer.on('weave:qr-update', (_event, data) => callback(data));
  },

  // Google OAuth Flow
  startGoogleLogin: () => ipcRenderer.invoke('weave:google-login'),

  // Config & Handle
  updateHandle: (newHandle) => ipcRenderer.invoke('weave:update-handle', newHandle),
  getProjects: () => ipcRenderer.invoke('weave:get-projects'),
  addProject: (alias, folderPath) => ipcRenderer.invoke('weave:add-project', { alias, folderPath }),
  bindGroup: (groupJid, alias) => ipcRenderer.invoke('weave:bind-group', { groupJid, alias }),

  // Logs stream
  onLog: (callback) => {
    ipcRenderer.on('weave:log', (_event, log) => callback(log));
  },

  // Task execution
  runPrompt: (prompt, projectAlias) => ipcRenderer.invoke('weave:run-prompt', { prompt, projectAlias }),
  stopTask: () => ipcRenderer.invoke('weave:stop-task'),
});
