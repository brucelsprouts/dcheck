// ═══════════════════════════════════════════════════════════
//  dcheck — Preload Script
//  Secure IPC bridge between main process and renderer
// ═══════════════════════════════════════════════════════════

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dcheck', {
  // Request historical ping data (filtered by range in seconds, 0 = all)
  getHistory: (rangeSec) => ipcRenderer.invoke('get-history', rangeSec),

  // Get aggregate stats (total, drops, uptime, last ping)
  getStats: () => ipcRenderer.invoke('get-stats'),

  // Listen for real-time ping updates
  onPingUpdate: (callback) => {
    ipcRenderer.on('ping-update', (_event, data) => callback(data));
  },

  // Listen for full data push (when window opens)
  onFullData: (callback) => {
    ipcRenderer.on('full-data', (_event, data) => callback(data));
  },

  // Close/hide the window
  closeWindow: () => ipcRenderer.send('close-window'),

  // Get and Save settings configuration
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
});
