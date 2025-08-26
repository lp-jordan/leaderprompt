const { contextBridge, ipcRenderer } = require('electron');
console.log('[PRELOAD] Preload script loaded ✅');

const randomUUID = () => {
  if (window?.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const api = {
  // Prompter controls
  openPrompter: (html, project) =>
    ipcRenderer.send('open-prompter', html, project),
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
  reorderScripts: (projectName, order) =>
    ipcRenderer.invoke('reorder-scripts', projectName, order),
  moveScript: (projectName, newProjectName, scriptName, index) =>
    ipcRenderer.invoke('move-script', projectName, newProjectName, scriptName, index),

  // Project settings
  getProjectSettings: (projectName) =>
    ipcRenderer.invoke('get-project-settings', projectName),
  saveProjectSettings: (projectName, settings) =>
    ipcRenderer.invoke('save-project-settings', projectName, settings),

  // Script import/load controls
  importScriptsToProject: (filePaths, projectName) =>
    ipcRenderer.invoke('import-scripts-to-project', filePaths, projectName),
  importFilesToProject: (files, projectName) =>
    ipcRenderer.invoke('import-files-to-project', files, projectName),
  importFoldersAsProjects: (folderPaths) =>
    ipcRenderer.invoke('import-folders-as-projects', folderPaths),
  importFoldersDataAsProjects: (folders) =>
    ipcRenderer.invoke('import-folders-data-as-projects', folders),
  filterDirectories: (paths) => ipcRenderer.invoke('filter-directories', paths),
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

  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  restartAndInstall: () => ipcRenderer.invoke('quit-and-install'),
  onUpdateChecking: (callback) => {
    const handler = () => callback()
    ipcRenderer.on('checking-for-update', handler)
    return () => ipcRenderer.removeListener('checking-for-update', handler)
  },
  onUpdateAvailable: (callback) => {
    const handler = (_, info) => callback(info)
    ipcRenderer.on('update-available', handler)
    return () => ipcRenderer.removeListener('update-available', handler)
  },
  onUpdateNotAvailable: (callback) => {
    const handler = () => callback()
    ipcRenderer.on('update-not-available', handler)
    return () => ipcRenderer.removeListener('update-not-available', handler)
  },
  onUpdateError: (callback) => {
    const handler = (_, message) => callback(message)
    ipcRenderer.on('update-error', handler)
    return () => ipcRenderer.removeListener('update-error', handler)
  },
  onUpdateProgress: (callback) => {
    const handler = (_, progress) => callback(progress)
    ipcRenderer.on('download-progress', handler)
    return () => ipcRenderer.removeListener('download-progress', handler)
  },
  onUpdateDownloaded: (callback) => {
    const handler = (_, info) => callback(info)
    ipcRenderer.on('update-downloaded', handler)
    return () => ipcRenderer.removeListener('update-downloaded', handler)
  },
};

api.rewriteSelection = (text, modifier, context) => {
  const id = randomUUID();
  const promise = ipcRenderer.invoke(
    'rewrite-selection',
    id,
    text,
    modifier,
    context,
  );
  return { id, promise };
};

api.abortRewrite = (id) => ipcRenderer.send('rewrite-selection-abort', id);

api.spellCheck = (word) => ipcRenderer.invoke('spell-check', word);

contextBridge.exposeInMainWorld('electronAPI', api);
