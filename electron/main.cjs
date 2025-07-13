const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const http = require('http');
const path = require('path');
const fs = require('fs');
const mammoth = require('mammoth');
const htmlToDocx = require('html-to-docx');
const { spawn } = require('child_process');

const pathToFile = (file, hash = '') =>
  `file://${path.resolve(__dirname, '..', file).replace(/\\/g, '/')}${hash}`;

let mainWindow;
let prompterWindow;
let devConsoleWindow;
const pendingLogs = [];
let viteProcess;
let isAlwaysOnTop = false;
let currentScriptHtml = '';
const NEW_PROJECT_SENTINEL = '__NEW_PROJECT__';

function sendLog(msg) {
  if (devConsoleWindow && !devConsoleWindow.isDestroyed()) {
    devConsoleWindow.webContents.send('log-message', msg)
  } else {
    pendingLogs.push(msg)
  }
}

const log = (...args) => {
  const msg = args.join(' ')
  console.log(...args)
  sendLog(msg)
}
const error = (...args) => {
  const msg = args.join(' ')
  console.error(...args)
  sendLog(`[ERROR] ${msg}`)
}

function startViteServer() {
  if (viteProcess || app.isPackaged) return;
  viteProcess = spawn('npm', ['run', 'dev'], {
    cwd: path.resolve(__dirname, '..'),
    stdio: 'inherit',
    shell: true,
  });
  log('Vite dev server started');
}

function waitForVite() {
  const url = 'http://localhost:5173';
  return new Promise((resolve) => {
    const attempt = () => {
      const req = http.get(url, () => {
        req.destroy();
        resolve();
      });
      req.on('error', () => {
        setTimeout(attempt, 200);
      });
    };
    attempt();
  });
}

function stopViteServer() {
  if (viteProcess) {
    viteProcess.kill('SIGTERM');
    viteProcess = null;
    log('Vite dev server stopped');
  }
}

const getUserDataPath = () => path.join(app.getPath('home'), 'leaderprompt');
const getProjectsPath = () => path.join(getUserDataPath(), 'projects');
const getProjectMetadataPath = () => path.join(getUserDataPath(), 'projects.json');

function sanitizeFilename(name) {
  if (!name || typeof name !== 'string') return null;
  const sanitized = name.replace(/[\\/:*?"<>|]/g, '_').trim();
  if (!sanitized || sanitized === '.' || sanitized === '..') return null;
  return sanitized;
}

function ensureDirectories() {
  log('Ensuring data directories');
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

}

function getProjectMetadata() {
  try {
    const raw = fs.readFileSync(getProjectMetadataPath(), 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    error('Failed to read or parse project metadata:', err);
    const fallback = { projects: [] };
    try {
      fs.writeFileSync(
        getProjectMetadataPath(),
        JSON.stringify(fallback, null, 2),
      );
    } catch (writeErr) {
      error('Failed to recreate projects.json:', writeErr);
    }
    return fallback;
  }
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
    icon: path.resolve(__dirname, '..', 'public', 'logos', 'LP_white.png'),
    backgroundColor: '#000000',
  });

  const startUrl = app.isPackaged
    ? pathToFile('dist/index.html')
    : 'http://localhost:5173';

  mainWindow.loadURL(startUrl);

  log('Main window created and loaded');
}

function createDevConsoleWindow() {
  if (devConsoleWindow) return
  devConsoleWindow = new BrowserWindow({
    width: 800,
    height: 400,
    webPreferences: {
      preload: path.resolve(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
    },
    title: 'Dev Console',
  })

  const url = app.isPackaged
    ? pathToFile('index.html', '#/dev-console')
    : 'http://localhost:5173/#/dev-console'

  devConsoleWindow.loadURL(url)
  devConsoleWindow.on('closed', () => {
    devConsoleWindow = null
  })
  devConsoleWindow.webContents.on('did-finish-load', () => {
    pendingLogs.forEach((m) => devConsoleWindow.webContents.send('log-message', m))
    pendingLogs.length = 0
  })
  log('Dev console window created')
}

async function createPrompterWindow() {
  log('Creating prompter window')

  const baseOptions = {
    width: 1200,
    height: 800,
    show: false,
    webPreferences: {
      preload: path.resolve(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
    },
    icon: path.resolve(__dirname, '..', 'public', 'logos', 'LP_white.png'),
    titleBarStyle: 'default',
  };

  const url = app.isPackaged
    ? pathToFile('index.html', '#/prompter')
    : 'http://localhost:5173/#/prompter';

  if (!prompterWindow || prompterWindow.isDestroyed()) {
    prompterWindow = new BrowserWindow({
      ...baseOptions,
      backgroundColor: '#000000',
      frame: true,
      transparent: false,
    })
    prompterWindow.setAlwaysOnTop(isAlwaysOnTop)
    prompterWindow.on('closed', () => {
      prompterWindow = null
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('prompter-closed')
      }
    })
    prompterWindow.loadURL(url)
    await new Promise((resolve) => prompterWindow.once('ready-to-show', resolve))
  }

  log('Prompter window initialized')
}

// --- Electron App Lifecycle ---
app.whenReady().then(async () => {
  log('App ready');
  startViteServer();
  await waitForVite();
  ensureDirectories();
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });

  // --- IPC Handlers ---
  ipcMain.on('open-dev-console', () => {
    createDevConsoleWindow();
    if (devConsoleWindow && !devConsoleWindow.isDestroyed()) {
      devConsoleWindow.show();
      devConsoleWindow.focus();
    }
  });
  ipcMain.on('open-prompter', async (_, html) => {
    log('Received request to open prompter');

    currentScriptHtml = html;

    const showWindow = () => {
      if (prompterWindow && !prompterWindow.isDestroyed()) {
        prompterWindow.show();
        prompterWindow.focus();
        log('Prompter window shown');
      }
    };

    if (!prompterWindow || prompterWindow.isDestroyed()) {
      ipcMain.once('prompter-ready', showWindow);
      await createPrompterWindow();
    } else {
      showWindow();
    }

    if (prompterWindow && !prompterWindow.isDestroyed()) {
      prompterWindow.setAlwaysOnTop(isAlwaysOnTop);
      prompterWindow.webContents.send('load-script', currentScriptHtml);
    }
  });

  ipcMain.on('update-script', (_, html) => {
    currentScriptHtml = html;
    if (prompterWindow && !prompterWindow.isDestroyed()) {
      prompterWindow.webContents.send('update-script', html);
    }
    log('Updated script content');
  });

  ipcMain.on('set-prompter-always-on-top', (_, flag) => {
    isAlwaysOnTop = !!flag;
    if (prompterWindow && !prompterWindow.isDestroyed()) {
      prompterWindow.setAlwaysOnTop(isAlwaysOnTop);
    }
    log(`Prompter always on top: ${isAlwaysOnTop}`);
  });

  ipcMain.on('close-prompter', () => {
    if (prompterWindow && !prompterWindow.isDestroyed()) {
      prompterWindow.close();
    }
    prompterWindow = null;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('prompter-closed');
    }
    log('Prompter window closed');
  });

  ipcMain.on('minimize-prompter', () => {
    if (prompterWindow && !prompterWindow.isDestroyed()) {
      prompterWindow.minimize();
    }
    log('Prompter window minimized');
  });

  ipcMain.handle('get-current-script', () => currentScriptHtml);

  ipcMain.handle('get-prompter-bounds', () => {
    if (prompterWindow && !prompterWindow.isDestroyed()) {
      return prompterWindow.getBounds();
    }
    return null;
  });

  ipcMain.on('set-prompter-bounds', (_, bounds) => {
    if (prompterWindow && !prompterWindow.isDestroyed() && bounds) {
      prompterWindow.setBounds(bounds);
    }
    log(`Prompter bounds set: ${JSON.stringify(bounds)}`);
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
    log('Project selection invoked but disabled');
    return null;
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
    try {
      const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
        title: 'Select script files',
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: 'Scripts', extensions: ['docx'] }],
      });
      if (canceled) {
        log('File selection cancelled');
        return null;
      }
      log(`Files selected: ${filePaths.join(', ')}`);
      return filePaths;
    } catch (err) {
      error('File selection failed:', err);
      return null;
    }
  });

  ipcMain.handle('rename-project', async (_, oldName, newName) => {
    log(`Renaming project: ${oldName} -> ${newName}`);
    if (!oldName || !newName || oldName === newName) return false;
    try {
      const oldPath = path.join(getProjectsPath(), oldName);
      const newPath = path.join(getProjectsPath(), newName);
      if (!fs.existsSync(oldPath) || fs.existsSync(newPath)) {
        error('Rename failed: source missing or destination exists');
        return false;
      }
      fs.renameSync(oldPath, newPath);
      const metadata = getProjectMetadata();
      const project = metadata.projects.find((p) => p.name === oldName);
      if (project) project.name = newName;
      fs.writeFileSync(getProjectMetadataPath(), JSON.stringify(metadata, null, 2));
      log('Project rename complete');
      return true;
    } catch (err) {
      error('Error renaming project:', err);
      return false;
    }
  });

  ipcMain.handle('delete-project', async (_, projectName) => {
    log(`Deleting project: ${projectName}`);
    try {
      const projPath = path.join(getProjectsPath(), projectName);
      if (!fs.existsSync(projPath)) return false;
      fs.rmSync(projPath, { recursive: true, force: true });
      const metadata = getProjectMetadata();
      metadata.projects = metadata.projects.filter((p) => p.name !== projectName);
      fs.writeFileSync(getProjectMetadataPath(), JSON.stringify(metadata, null, 2));
      return true;
    } catch (err) {
      error('Failed to delete project:', err);
      return false;
    }
  });

  ipcMain.handle('rename-script', async (_, projectName, oldName, newName) => {
    log(`Renaming script: ${oldName} -> ${newName} in ${projectName}`);
    if (!projectName || !oldName || !newName || oldName === newName) return false;
    try {
      const base = path.join(getProjectsPath(), projectName);
      const oldPath = path.join(base, oldName);
      let targetName = newName;
      if (!targetName.toLowerCase().endsWith('.docx')) {
        targetName += '.docx';
      }
      const newPath = path.join(base, targetName);
      if (!fs.existsSync(oldPath) || fs.existsSync(newPath)) return false;
      fs.renameSync(oldPath, newPath);
      return true;
    } catch (err) {
      error('Error renaming script:', err);
      return false;
    }
  });

  ipcMain.handle('create-new-script', async (_, projectName, scriptName) => {
    const safeName = sanitizeFilename(scriptName);
    log(`Creating new script ${scriptName} in project ${projectName}`);
    if (!projectName || !safeName) return { success: false };
    try {
      const base = path.join(getProjectsPath(), projectName);
      if (!fs.existsSync(base)) {
        fs.mkdirSync(base, { recursive: true });
        updateProjectMetadata(projectName);
      }

      let finalName = safeName;
      if (!finalName.toLowerCase().endsWith('.docx')) {
        finalName += '.docx';
      }
      const rootName = finalName.replace(/\.docx$/i, '');

      const existingFiles = await fs.promises.readdir(base);
      const names = new Set(
        existingFiles
          .filter((f) => f.toLowerCase().endsWith('.docx'))
          .map((f) => f.replace(/\.docx$/i, '')),
      );

      let candidate = rootName;
      let counter = 1;
      while (names.has(candidate)) {
        candidate = `${rootName} ${counter}`;
        counter += 1;
      }
      finalName = `${candidate}.docx`;
      const dest = path.join(base, finalName);
      const template = path.join(
        __dirname,
              'resources',
      );
      fs.copyFileSync(template, dest);
      return { success: true, scriptName: finalName };
    } catch (err) {
      error('Failed to create new script:', err);
      return { success: false };
    }
  });

ipcMain.handle('import-scripts-to-project', async (_, filePaths, projectName) => {
  log(`Importing scripts to project: ${projectName}`);
  if (!Array.isArray(filePaths) || !filePaths.length || !projectName) {
    error('Invalid import attempt: missing files or project name');
    return;
  }

  const destDir = path.join(getProjectsPath(), projectName);
  try {
    await fs.promises.mkdir(destDir, { recursive: true });
  } catch (err) {
    error('Failed to ensure destination directory:', err);
    return;
  }

  for (const file of filePaths) {
    if (!file || typeof file !== 'string') {
      error('Skipped invalid file path:', file);
      continue;
    }

    try {
      const result = await mammoth.convertToHtml({ path: file });
      const html = result.value || '';

      let safeName = sanitizeFilename(path.basename(file));
      if (!safeName) {
        error('Invalid sanitized file name for', file);
        continue;
      }
      if (!safeName.toLowerCase().endsWith('.docx')) {
        safeName += '.docx';
      }

      const dest = path.join(destDir, safeName);
      const buffer = await htmlToDocx(html);
      await fs.promises.writeFile(dest, buffer);
      log(`Imported script: ${safeName} → ${dest}`);
    } catch (err) {
      error(`Failed to import file ${file}:`, err);
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

  ipcMain.handle('save-script', async (_, { projectName, scriptName, html }) => {
    const dest = path.join(getProjectsPath(), projectName, scriptName);
    log(`Saving script: ${dest}`);
    try {
      const buffer = await htmlToDocx(html);
      fs.writeFileSync(dest, buffer);
      return true;
    } catch (err) {
      error('Failed to save script:', err);
      return false;
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
  log('All windows closed');
  if (process.platform !== 'darwin') app.quit();
});

app.on('quit', () => {
  log('App quitting');
  stopViteServer();
});

process.on('exit', () => {
  log('Process exiting');
  stopViteServer();
});
process.on('SIGINT', () => {
  log('Received SIGINT');
  stopViteServer();
  process.exit(0);
});
