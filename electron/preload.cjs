const { contextBridge, ipcRenderer } = require('electron');

console.log('[PRELOAD] Preload script loaded ✅');

contextBridge.exposeInMainWorld('electronAPI', {
  // Prompter controls
  openPrompter: (html) => ipcRenderer.send('open-prompter', html),
  onScriptLoaded: (callback) => {
    const handler = (_, data) => callback(data)
    ipcRenderer.on('load-script', handler)
    return () => ipcRenderer.removeListener('load-script', handler)
  },
  onScriptUpdated: (callback) => {
    const handler = (_, data) => callback(data)
    ipcRenderer.on('update-script', handler)
    return () => ipcRenderer.removeListener('update-script', handler)
  },
  sendUpdatedScript: (html) => ipcRenderer.send('update-script', html),
  getCurrentScript: () => ipcRenderer.invoke('get-current-script'),

  // Project management
  selectProjectFolder: () => ipcRenderer.invoke('select-project-folder'),
  createNewProject: (name) => ipcRenderer.invoke('create-new-project', name),
  renameProject: (oldName, newName) =>
    ipcRenderer.invoke('rename-project', oldName, newName),
  deleteProject: (name) => ipcRenderer.invoke('delete-project', name),
  renameScript: (projectName, oldName, newName) =>
    ipcRenderer.invoke('rename-script', projectName, oldName, newName),
  createNewScript: (projectName, scriptName) =>
    ipcRenderer.invoke('create-new-script', projectName, scriptName),

  // Script import/load controls
  importScriptsToProject: (filePaths, projectName) =>
    ipcRenderer.invoke('import-scripts-to-project', filePaths, projectName),
  getScriptsForProject: (projectName) =>
    ipcRenderer.invoke('get-scripts-for-project', projectName),
  getAllProjectsWithScripts: () =>
    ipcRenderer.invoke('get-all-projects-with-scripts'),
  selectFiles: () => ipcRenderer.invoke('select-files'),
  loadScript: (projectName, scriptName) =>
    ipcRenderer.invoke('load-script', projectName, scriptName),
  saveScript: (projectName, scriptName, html) =>
    ipcRenderer.invoke('save-script', { projectName, scriptName, html }),
  deleteScript: (projectName, scriptName) =>
    ipcRenderer.invoke('delete-script', projectName, scriptName),

  onLogMessage: (callback) => {
    const handler = (_, msg) => callback(msg)
    ipcRenderer.on('log-message', handler)
    return () => ipcRenderer.removeListener('log-message', handler)
  },

  openDevConsole: () => ipcRenderer.send('open-dev-console'),

  setPrompterAlwaysOnTop: (flag) =>
    ipcRenderer.send('set-prompter-always-on-top', flag),

  closePrompter: () => ipcRenderer.send('close-prompter'),
  minimizePrompter: () => ipcRenderer.send('minimize-prompter'),

  onPrompterClosed: (callback) => {
    const handler = () => callback()
    ipcRenderer.on('prompter-closed', handler)
    return () => ipcRenderer.removeListener('prompter-closed', handler)
  },

  getPrompterBounds: () => ipcRenderer.invoke('get-prompter-bounds'),
  setPrompterBounds: (bounds) =>
    ipcRenderer.send('set-prompter-bounds', bounds),

  prompterReady: () => ipcRenderer.send('prompter-ready'),
});
