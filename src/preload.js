const { contextBridge, ipcRenderer, webUtils } = require('electron');
contextBridge.exposeInMainWorld('fastConvert', {
  pathForFile: file => {
    try { return webUtils.getPathForFile(file); } catch { return null; }
  },
  chooseFiles: () => ipcRenderer.invoke('choose-files'),
  chooseOutputFolder: () => ipcRenderer.invoke('choose-output-folder'),
  startJobs: jobs => ipcRenderer.invoke('start-jobs', jobs),
  cancelJob: id => ipcRenderer.invoke('cancel-job', id),
  openFile: file => ipcRenderer.invoke('open-file', file),
  showInFolder: file => ipcRenderer.invoke('show-in-folder', file),
  systemInfo: () => ipcRenderer.invoke('system-info'),
  statFile: file => ipcRenderer.invoke('stat-file', file),
  onProgress: fn => ipcRenderer.on('job-progress', (_e, data) => fn(data)),
  onDone: fn => ipcRenderer.on('job-done', (_e, data) => fn(data)),
  onError: fn => ipcRenderer.on('job-error', (_e, data) => fn(data)),
  onCancelled: fn => ipcRenderer.on('job-cancelled', (_e, data) => fn(data))
});
