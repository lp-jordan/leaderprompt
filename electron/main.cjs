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
let prompterWindowOpaque;
let prompterWindowTransparent;
const prompterWindows = new Set();
let devConsoleWindow;
const pendingLogs = [];
let viteProcess;
let isAlwaysOnTop = false;
let currentScriptHtml = '';
let currentTransparent = false;

function mirrorInactiveBoundsFrom(source) {
  if (!source || source.isDestroyed() || prompterWindow !== source) return;
  const target =
    source === prompterWindowOpaque ? prompterWindowTransparent : prompterWindowOpaque;
  if (target && !target.isDestroyed()) {
    const bounds = source.getBounds();
    target.setBounds(bounds);
  }
}

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

const getUserDataPath = () => path.join(app.getPath('home'), 'LeaderPrompt');
const getProjectsPath = () => path.join(getUserDataPath(), 'projects');
const getProjectMetadataPath = () => path.join(getUserDataPath(), 'projects.json');

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

async function createPrompterWindow(needTransparent = false) {
  log('Creating prompter windows')

  const baseOptions = {
    width: 1200,
    height: 800,
    show: false,
    webPreferences: {
      preload: path.resolve(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
    },
    icon: path.resolve(__dirname, '..', 'public', 'logos', 'LP_white.png'),
    titleBarStyle: 'default',
  };

  const url = app.isPackaged
    ? pathToFile('index.html', '#/prompter')
    : 'http://localhost:5173/#/prompter';

  if (!prompterWindowOpaque || prompterWindowOpaque.isDestroyed()) {
    prompterWindowOpaque = new BrowserWindow({
      ...baseOptions,
      backgroundColor: '#000000',
      frame: true,
      transparent: false,
    });
    prompterWindowOpaque.setAlwaysOnTop(isAlwaysOnTop);
    prompterWindowOpaque.on('move', () =>
      mirrorInactiveBoundsFrom(prompterWindowOpaque)
    );
    prompterWindowOpaque.on('resize', () =>
      mirrorInactiveBoundsFrom(prompterWindowOpaque)
    );
    prompterWindows.add(prompterWindowOpaque);
    prompterWindowOpaque.on('closed', () => {
      prompterWindows.delete(prompterWindowOpaque);
      if (prompterWindow === prompterWindowOpaque) prompterWindow = null;
      prompterWindowOpaque = null;
    });
    prompterWindowOpaque.loadURL(url);
    await new Promise((resolve) =>
      prompterWindowOpaque.webContents.once('did-finish-load', resolve)
    );
    prompterWindowOpaque.webContents.send('set-transparent', false);
    prompterWindowOpaque.show();
  }

  if (needTransparent && (!prompterWindowTransparent || prompterWindowTransparent.isDestroyed())) {
    prompterWindowTransparent = new BrowserWindow({
      ...baseOptions,
      backgroundColor: '#00000000',
      frame: false,
      transparent: true,
      skipTaskbar: true,
    });
    prompterWindowTransparent.setAlwaysOnTop(isAlwaysOnTop);
    if (prompterWindowOpaque && !prompterWindowOpaque.isDestroyed()) {
      prompterWindowTransparent.setBounds(prompterWindowOpaque.getBounds());
    }
    prompterWindowTransparent.on('move', () =>
      mirrorInactiveBoundsFrom(prompterWindowTransparent)
    );
    prompterWindowTransparent.on('resize', () =>
      mirrorInactiveBoundsFrom(prompterWindowTransparent)
    );
    prompterWindows.add(prompterWindowTransparent);
    prompterWindowTransparent.on('closed', () => {
      prompterWindows.delete(prompterWindowTransparent);
      if (prompterWindow === prompterWindowTransparent) prompterWindow = null;
      prompterWindowTransparent = null;
    });
    prompterWindowTransparent.loadURL(url);
    await new Promise((resolve) =>
      prompterWindowTransparent.webContents.once('did-finish-load', resolve)
    );
    prompterWindowTransparent.webContents.send('set-transparent', true);
    prompterWindowTransparent.hide();
  }

  log('Prompter windows initialized');
}

// --- Electron App Lifecycle ---
app.whenReady().then(async () => {
  log('App ready');
  startViteServer();
  await waitForVite();
  ensureDirectories();
  createMainWindow();
  createDevConsoleWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });

  // --- IPC Handlers ---
  ipcMain.on('open-prompter', async (_, html, transparentFlag) => {
    log('Received request to open prompter');

    const desiredTransparent = !!transparentFlag;
    currentScriptHtml = html;

    await createPrompterWindow(desiredTransparent);

    const active = desiredTransparent
      ? prompterWindowTransparent
      : prompterWindowOpaque;
    const inactive = desiredTransparent
      ? prompterWindowOpaque
      : prompterWindowTransparent;

    if (inactive && !inactive.isDestroyed()) {
      if (active && !active.isDestroyed()) {
        inactive.setBounds(active.getBounds());
      }
      inactive.hide();
    }

    if (active && !active.isDestroyed()) {
      prompterWindow = active;
      currentTransparent = desiredTransparent;
      active.setAlwaysOnTop(isAlwaysOnTop);

      ipcMain.once('prompter-ready', () => {
        if (active && !active.isDestroyed()) {
          active.show();
          active.focus();
          log(`Prompter window shown (transparent: ${desiredTransparent})`);
        }
      });

      active.webContents.send('load-script', currentScriptHtml);
      active.webContents.send('set-transparent', desiredTransparent);
    }
  });

  ipcMain.on('update-script', (_, html) => {
    currentScriptHtml = html;
    const targets = new Set();
    if (prompterWindow && !prompterWindow.isDestroyed()) {
      targets.add(prompterWindow);
    }
    prompterWindows.forEach((win) => {
      if (win && !win.isDestroyed()) {
        targets.add(win);
      }
    });
    targets.forEach((win) => {
      win.webContents.send('update-script', html);
    });
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
    [prompterWindowOpaque, prompterWindowTransparent].forEach((win) => {
      if (win && !win.isDestroyed()) {
        win.close();
      }
      prompterWindows.delete(win);
    });
    prompterWindow = null;
    prompterWindowOpaque = null;
    prompterWindowTransparent = null;
    log('Prompter windows closed');
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
      const other =
        prompterWindow === prompterWindowOpaque
          ? prompterWindowTransparent
          : prompterWindowOpaque;
      if (other && !other.isDestroyed()) {
        other.setBounds(bounds);
      }
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
    log(`Creating new script ${scriptName} in project ${projectName}`);
    if (!projectName || !scriptName) return { success: false };
    try {
      const base = path.join(getProjectsPath(), projectName);
      if (!fs.existsSync(base)) {
        fs.mkdirSync(base, { recursive: true });
        updateProjectMetadata(projectName);
      }

      let finalName = scriptName;
      if (!finalName.toLowerCase().endsWith('.docx')) {
        finalName += '.docx';
      }
      const rootName = finalName.replace(/\.docx$/i, '');
      let candidate = rootName;
      let counter = 1;
      while (fs.existsSync(path.join(base, `${candidate}.docx`))) {
        candidate = `${rootName} ${counter}`;
        counter += 1;
      }
      finalName = `${candidate}.docx`;
      const dest = path.join(base, finalName);
      const template = path.join(
        __dirname,
        '..',
        'node_modules',
        'mammoth',
        'test',
        'test-data',
        'empty.docx'
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
