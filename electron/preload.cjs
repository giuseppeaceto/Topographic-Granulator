const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // File operations
  showOpenDialog: (options) => ipcRenderer.invoke('show-open-dialog', options),
  showSaveDialog: (options) => ipcRenderer.invoke('show-save-dialog', options),
  getDesktopSources: () => ipcRenderer.invoke('get-desktop-sources'),
  
  // Update events
  onUpdateAvailable: (callback) => {
    ipcRenderer.on('update-available', (event, info) => callback(info));
  },
  onDownloadProgress: (callback) => {
    ipcRenderer.on('download-progress', (event, progress) => callback(progress));
  },
  onUpdateDownloaded: (callback) => {
    ipcRenderer.on('update-downloaded', (event, info) => callback(info));
  },
  
  // Beta expiration events (soft expiration - warnings only)
  onBetaExpirationWarning: (callback) => {
    ipcRenderer.on('beta-expiration-warning', (event, info) => callback(info));
  },
  onBetaExpirationInfo: (callback) => {
    ipcRenderer.on('beta-expiration-info', (event, info) => callback(info));
  },
  
  // Manual update check events
  onCheckingForUpdateManual: (callback) => {
    ipcRenderer.on('checking-for-update-manual', (event) => callback());
  },
  onUpdateNotAvailable: (callback) => {
    ipcRenderer.on('update-not-available', (event, info) => callback(info));
  },
  onUpdateError: (callback) => {
    ipcRenderer.on('update-error', (event, error) => callback(error));
  },
  onUpdateInstallError: (callback) => {
    ipcRenderer.on('update-install-error', (event, error) => callback(error));
  },
  
  // Platform info
  platform: process.platform,
  isElectron: true,
  
  // App version
  getVersion: () => ipcRenderer.invoke('get-app-version'),
  
  // Restart and install update
  restartAndInstallUpdate: () => ipcRenderer.invoke('restart-and-install-update'),
});

