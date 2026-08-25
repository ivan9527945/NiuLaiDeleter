// 預載入橋:渲染程序唯一入口(不暴露 Node/fs,保持 contextIsolation 安全預設)
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  scanCharacters: () => ipcRenderer.invoke('scan-characters'),
  getLastCharacter: () => ipcRenderer.invoke('get-last-character'),
  saveLastCharacter: (id) => ipcRenderer.invoke('save-last-character', id),
  getManualTargeting: () => ipcRenderer.invoke('get-manual-targeting'),
  saveManualTargeting: (v) => ipcRenderer.invoke('save-manual-targeting', v),
  updateContextMenuName: (name) => ipcRenderer.invoke('update-context-menu-name', name),
  trashFile: (f) => ipcRenderer.invoke('trash-file', f),
  openAssetsDir: () => ipcRenderer.invoke('open-assets-dir'),
  readCharacterConfig: (folder) => ipcRenderer.invoke('read-character-config', folder),
  writeCharacterConfig: (folder, content) => ipcRenderer.invoke('write-character-config', folder, content),
  // 磁碟機代號絕對路徑 → file:// URL(img/audio/src 用;asar 里路徑自動由 Electron 處理)
  // 注:沙箱 preload 裡沒有 pathToFileURL,手工拼(encodeURI 處理空格/#/?
  // 但保留中文原樣;素材檔名不含 %)
  toFileUrl: (p) => 'file:///' + encodeURI(p.replace(/\\/g, '/')),
  swapCharacter: () => ipcRenderer.send('open-character-window-for-swap'),
  swapCharacterSelected: (id) => ipcRenderer.send('swap-character-selected', id),
  closeApp: () => ipcRenderer.send('show-window-close'),
  onInitShow: (cb) => ipcRenderer.on('init-show', (e, d) => cb(d)),
  onAutoTarget: (cb) => ipcRenderer.on('auto-target', (e, p) => cb(p)),
  onAutoTargetFailed: (cb) => ipcRenderer.on('auto-target-failed', (e) => cb()),
  onSwapDone: (cb) => ipcRenderer.on('swap-done', (e, id) => cb(id)),
});
