const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tokenBreak', {
  // AI state
  onAiStateChange: (callback) => ipcRenderer.on('ai-state-change', (_, state) => callback(state)),
  getAiState: () => ipcRenderer.invoke('get-ai-state'),
  setActiveTools: (tools) => ipcRenderer.invoke('set-active-tools', tools),
  getMonitorConfig: () => ipcRenderer.invoke('get-monitor-config'),

  // Language
  onLanguageChanged: (callback) => ipcRenderer.on('language-changed', (_, lang) => callback(lang)),
  getLanguage: () => ipcRenderer.invoke('get-language'),
  getTranslations: () => ipcRenderer.invoke('get-translations'),
  changeLanguage: (lang) => ipcRenderer.invoke('change-language', lang),

  // Window controls
  minimize: () => ipcRenderer.invoke('window-minimize'),
  maximize: () => ipcRenderer.invoke('window-maximize'),
  close: () => ipcRenderer.invoke('window-close'),

  // External links
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
});
