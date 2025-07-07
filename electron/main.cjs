const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const mammoth = require('mammoth');

let mainWindow;
const prompterWindows = new Set();

const log = (...args) => console.log('[LOG]', ...args);
const error = (...args) => console.error('[ERROR]', ...args);

const getUserDataPath = () => path.join(app.getPath('home'), 'LeaderPrompt');
const getProjectsPath = () => path.join(getUserDataPath(), 'projects');
const getProjectMetadataPath = () => path.join(getUserDataPath(), 'projects.json');
const projectsDir = path.join(app.getPath('userData'), 'projects');

function ensureDirectories() {
  if (!fs.existsSync(getUserDataPath())) {
    fs.mkdirSync(getUserDataPath());
    log('Created LeaderPrompt user data directory');
  }

  if (!fs.existsSync(getProjectsPath())) {
    fs.mkdirSync(getProjectsPath());
    log('Created projects directory');
  }

  if (!fs.existsSync(getProjectMetadataPath())) {
    fs.writeFileSync(getProjectMetadataPath(), JSON.stringify({ projects: [] }, null, 2));
    log('Created projects.json metadata file');
  }

  if (!fs.existsSync(projectsDir)) {
    fs.mkdirSync(projectsDir, { recursive: true });
    log('Created sandboxed projects directory (userData path)');
  }
}

function getProjectMetadata() {
  const raw = fs.readFileSync(getProjectMetadataPath(), 'utf-8');
  return JSON.parse(raw);
}

function updateProjectMetadata(projectName) {
  const metadata = getProjectMetadata();
  if (!metadata.projects.some((p) => p.name === projectName)) {
    metadata.projects.push({ name: projectName });
    fs.writeFileSync(getProjectMetadataPath(), JSON.stringify(metadata, null, 2));
    log(`Metadata updated with new project: ${projectName}`);
  }
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 700,
    webPreferences: {
      preload: path.resolve(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
    },
    backgroundColor: '#000000',
  });

  mainWindow.loadURL('http://localhost:5173');
  log('Main window created and loaded');
}

function createPrompterWindow(initialHtml) {
  prompterWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.resolve(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
    },
    backgroundColor: '#000000',
  });

  win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  prompterWindows.add(win);
  win.on('closed', () => {
    prompterWindows.delete(win);
  });
  log('Prompter window opened');
}

// --- Electron App Lifecycle ---
app.whenReady().then(() => {
  log('App ready');
  ensureDirectories();
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });

  // --- IPC Handlers ---
  ipcMain.on('open-prompter', (_, html) => {
    log('Received request to open prompter');
    if (!prompterWindow || prompterWindow.isDestroyed()) {
      createPrompterWindow(html);
    } else {
      prompterWindow.focus();
      prompterWindow.webContents.send('load-script', html);
    }
  });

  ipcMain.on('update-script', (_, html) => {
    prompterWindows.forEach((win) => {
      if (!win.isDestroyed()) {
        win.webContents.send('load-script', html);
      }
    });
  });

  ipcMain.on('update-script', (_, html) => {
    prompterWindows.forEach((win) => {
      if (!win.isDestroyed()) {
        win.webContents.send('load-script', html);
      }
    });
  });

  ipcMain.handle('get-all-projects-with-scripts', async () => {
    log('Fetching all projects with scripts');
    try {
      const baseDir = getProjectsPath();
      if (!fs.existsSync(baseDir)) return [];

      const projects = fs.readdirSync(baseDir).filter((file) => {
        const fullPath = path.join(baseDir, file);
        return fs.statSync(fullPath).isDirectory();
      });

      const result = projects.map((projectName) => {
        const scriptsDir = path.join(baseDir, projectName);
        const scripts = fs.readdirSync(scriptsDir).filter((file) => file.endsWith('.docx'));
        return { name: projectName, scripts };
      });

      return result;
    } catch (err) {
      error('[get-all-projects-with-scripts] Failed:', err);
      return [];
    }
  });

  ipcMain.handle('select-project-folder', async () => {
    log('Project selection invoked');
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'question',
      buttons: ['Select Existing Project', 'Create New Project', 'Cancel'],
      message: 'Choose a project folder option:',
    });

    if (response === 2) return null; // Cancel

    if (response === 0) {
      const metadata = getProjectMetadata();
      const choices = metadata.projects.map((p) => p.name);
      const choice = await dialog.showMessageBox(mainWindow, {
        type: 'question',
        buttons: [...choices, 'Cancel'],
        message: 'Select a project:',
      });
      return choice.response === choices.length ? null : choices[choice.response];
    } else {
      // Placeholder prompt - improve later
      log('Creating new project via fallback name');
      const projectName = 'Untitled Project';
      const newFolder = path.join(getProjectsPath(), projectName);
      fs.mkdirSync(newFolder, { recursive: true });
      updateProjectMetadata(projectName);
      return projectName;
    }
  });

  ipcMain.handle('create-new-project', async (_, projectName) => {
  log(`Creating new project: ${projectName}`);
  try {
    const projectPath = path.join(getProjectsPath(), projectName);
    if (!fs.existsSync(projectPath)) {
      fs.mkdirSync(projectPath, { recursive: true });
      updateProjectMetadata(projectName);
      log(`Project created: ${projectPath}`);
      return true;
    } else {
      log(`Project already exists: ${projectPath}`);
      return false;
    }
  } catch (err) {
    error('Error creating new project:', err);
    return false;
  }
});

  ipcMain.handle('select-files', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Word Docs', extensions: ['docx'] }],
    });

    return canceled ? null : filePaths;
  });

ipcMain.handle('import-scripts-to-project', async (_, filePaths, projectName) => {
  log(`Importing scripts to project: ${projectName}`);
  if (!Array.isArray(filePaths) || !filePaths.length || !projectName) {
    error('Invalid import attempt: missing files or project name');
    return;
  }

  const destDir = path.join(getProjectsPath(), projectName);
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
    log(`Created missing destination directory for project: ${destDir}`);
  }

  for (const file of filePaths) {
    if (!file || typeof file !== 'string') {
      error('Skipped invalid file path:', file);
      continue;
    }

    try {
      const fileName = path.basename(file);
      const dest = path.join(destDir, fileName);
      fs.copyFileSync(file, dest);
      log(`Copied script: ${fileName} → ${dest}`);
    } catch (err) {
      error(`Failed to copy file ${file}:`, err);
    }
  }

  updateProjectMetadata(projectName);
});

  ipcMain.handle('get-projects', () => {
    log('Fetching list of projects');
    const metadata = getProjectMetadata();
    return metadata.projects.map((p) => p.name);
  });

  ipcMain.handle('get-scripts-for-project', (_, projectName) => {
    log(`Fetching scripts for project: ${projectName}`);
    const folderPath = path.join(getProjectsPath(), projectName);
    return fs.readdirSync(folderPath).filter((f) => f.endsWith('.docx'));
  });

  ipcMain.handle('load-script', async (_, projectName, scriptName) => {
    const scriptPath = path.join(getProjectsPath(), projectName, scriptName);
    log(`Loading script: ${scriptPath}`);
    try {
      const result = await mammoth.convertToHtml({ path: scriptPath });
      return result.value;
    } catch (err) {
      error('Failed to load script:', err);
      return null;
    }
  });

  ipcMain.handle('delete-script', async (_, projectName, scriptName) => {
    const scriptPath = path.join(getProjectsPath(), projectName, scriptName);
    log(`Deleting script: ${scriptPath}`);
    try {
      if (fs.existsSync(scriptPath) && scriptPath.endsWith('.docx')) {
        fs.unlinkSync(scriptPath);
        return true;
      }
      return false;
    } catch (err) {
      error('Failed to delete script:', err);
      return false;
    }
  });
});

// --- App Exit Handler ---
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
