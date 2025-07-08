const { contextBridge, ipcRenderer } = require('electron');

console.log('[PRELOAD] Preload script loaded ✅');

contextBridge.exposeInMainWorld('electronAPI', {
  // Prompter controls
  openPrompter: (html) => ipcRenderer.send('open-prompter', html),
  onScriptLoaded: (callback) =>
    ipcRenderer.on('load-script', (_, data) => callback(data)),
  onScriptUpdated: (callback) =>
    ipcRenderer.on('update-script', (_, data) => callback(data)),
  sendUpdatedScript: (html) => ipcRenderer.send('update-script', html),

  // Project management
  selectProjectFolder: () => ipcRenderer.invoke('select-project-folder'),
  createNewProject: (name) => ipcRenderer.invoke('create-new-project', name),
  renameProject: (oldName, newName) =>
    ipcRenderer.invoke('rename-project', oldName, newName),

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
  deleteScript: (projectName, scriptName) =>
    ipcRenderer.invoke('delete-script', projectName, scriptName),
  renameScript: (projectName, oldName, newName) =>
    ipcRenderer.invoke('rename-script', projectName, oldName, newName),
});
