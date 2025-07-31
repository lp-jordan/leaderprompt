const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const { autoUpdater } = require('electron-updater');
const http = require('http');
const path = require('path');
const fs = require('fs');
const mammoth = require('mammoth');
const htmlToDocx = require('html-to-docx');
const { spawn } = require('child_process');

const pathToFile = (file, hash = '') =>
  `file://${path.resolve(__dirname, '..', file).replace(/\\/g, '/')}${hash}`;

// Resolve a path to a static asset. During development assets live in the
// `public` folder. When packaged, Vite copies them to `dist` so adjust the
// root accordingly.
const assetPath = (...segments) =>
  app.isPackaged
    ? path.join(__dirname, '..', 'dist', ...segments)
    : path.join(__dirname, '..', 'public', ...segments);

let mainWindow;
let prompterWindow;
let devConsoleWindow;
const pendingLogs = [];
let viteProcess;
let isAlwaysOnTop = false;
let currentScriptHtml = '';

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

function sendUpdateStatus(data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update-status', data)
  }
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
  const base = path.basename(name);
  const sanitized = base.replace(/[\\/:*?"<>|]/g, '_').trim();
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

function setupAutoUpdates() {
  if (!app.isPackaged) return;
  autoUpdater.on('error', (err) => {
    error('Auto update error:', err)
    sendUpdateStatus({ status: 'error', message: err.message })
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-error', err.message)
    }
  })
  autoUpdater.on('checking-for-update', () => {
    log('Checking for update')
    sendUpdateStatus({ status: 'checking' })
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('checking-for-update')
    }
  })
  autoUpdater.on('update-available', (info) => {
    log('Update available')
    sendUpdateStatus({ status: 'available', info })
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-available', info)
    }
    dialog.showMessageBox({
      type: 'info',
      title: 'Update Available',
      message:
        'A new version is being downloaded and will be installed after restart.',
    })
  })
  autoUpdater.on('update-not-available', () => {
    log('No updates available')
    sendUpdateStatus({ status: 'none' })
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-not-available')
    }
  })
  autoUpdater.on('download-progress', (progress) => {
    sendUpdateStatus({ status: 'downloading', progress })
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('download-progress', progress)
    }
  })
  autoUpdater.on('update-downloaded', (info) => {
    log('Update downloaded and ready')
    sendUpdateStatus({ status: 'downloaded', info })
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-downloaded', info)
    }
  })

  autoUpdater.checkForUpdates()
}

function manualCheckForUpdates() {
  if (!app.isPackaged) {
    dialog.showMessageBox({
      type: 'info',
      title: 'Check for Updates',
      message: 'Updates are only available in packaged builds.',
    });
    return;
  }

  const notifyLatest = () => {
    dialog.showMessageBox({
      type: 'info',
      title: 'No Updates Available',
      message: 'You are running the latest version.',
    });
    autoUpdater.removeListener('update-not-available', notifyLatest);
  };

  autoUpdater.once('update-not-available', notifyLatest);
  autoUpdater.checkForUpdates();
}

function createAppMenu() {
  const template = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'Check for Updates…',
          click: manualCheckForUpdates,
        },
        process.platform === 'darwin' ? { role: 'close' } : { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
    { role: 'help' },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
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
    metadata.projects.push({ name: projectName, added: Date.now() });
    fs.writeFileSync(getProjectMetadataPath(), JSON.stringify(metadata, null, 2));
    log(`Metadata updated with new project: ${projectName}`);
  }
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 300,
    minHeight: 500,
    webPreferences: {
      preload: path.resolve(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
    },
    icon: assetPath('logos', 'LP_white.png'),
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
    ? pathToFile('dist/index.html', '#/dev-console')
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
    minWidth: 1200,
    minHeight: 800,
    show: false,
    webPreferences: {
      preload: path.resolve(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
    },
    icon: assetPath('logos', 'LP_white.png'),
    titleBarStyle: 'default',
  };

  const url = app.isPackaged
    ? pathToFile('dist/index.html', '#/prompter')
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
  if (!app.isPackaged) {
    await waitForVite();
  }
  ensureDirectories();
  createMainWindow();
  setupAutoUpdates();
  createAppMenu();

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

      const metadata = getProjectMetadata();

      const projects = fs.readdirSync(baseDir).filter((file) => {
        const fullPath = path.join(baseDir, file);
        return fs.statSync(fullPath).isDirectory();
      });

      const result = projects.map((projectName) => {
        const scriptsDir = path.join(baseDir, projectName);
        const scriptFiles = fs
          .readdirSync(scriptsDir)
          .filter((file) => file.endsWith('.docx'));

        const scripts = scriptFiles.map((file) => {
          const stats = fs.statSync(path.join(scriptsDir, file));
          const added = stats.birthtimeMs || stats.ctimeMs || stats.mtimeMs;
          return { name: file, added };
        });

        let order = [];
        const orderPath = path.join(scriptsDir, 'scripts.json');
        if (fs.existsSync(orderPath)) {
          try {
            const raw = JSON.parse(fs.readFileSync(orderPath, 'utf-8'));
            if (Array.isArray(raw.order)) order = raw.order;
          } catch (err) {
            error(`Failed to parse order file for ${projectName}:`, err);
          }
        }

        const map = new Map(scripts.map((s) => [s.name, s]));
        const ordered = [];
        if (order.length) {
          for (const name of order) {
            if (map.has(name)) {
              ordered.push(map.get(name));
              map.delete(name);
            }
          }
        }
        // Append any scripts not in the order file
        for (const [name, info] of map.entries()) {
          ordered.push(info);
        }

        const meta = metadata.projects.find((p) => p.name === projectName);
        const added = meta?.added || 0;
        return { name: projectName, scripts: ordered, added };
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
      let baseExists = true;
      try {
        await fs.promises.stat(base);
      } catch (statErr) {
        if (statErr.code === 'ENOENT') baseExists = false;
        else throw statErr;
      }
      if (!baseExists) {
        await fs.promises.mkdir(base, { recursive: true });
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
      const templatePath = assetPath('template.docx');
      try {
        await fs.promises.copyFile(templatePath, dest);
      } catch (copyErr) {
        const buffer = await htmlToDocx('<p></p>', null, {});
        await fs.promises.writeFile(dest, buffer);
      }
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

  ipcMain.handle('reorder-scripts', async (_, projectName, order) => {
    log(`Reordering scripts for ${projectName}`);
    if (!projectName || !Array.isArray(order)) return false;
    try {
      const base = path.join(getProjectsPath(), projectName);
      const metaPath = path.join(base, 'scripts.json');
      const data = { order };
      fs.writeFileSync(metaPath, JSON.stringify(data, null, 2));
      return true;
    } catch (err) {
      error('Failed to save script order:', err);
      return false;
    }
  });

  ipcMain.handle(
    'move-script',
    async (_, projectName, newProjectName, scriptName, index) => {
      log(
        `Moving script ${scriptName} from ${projectName} to ${newProjectName}`,
      );
      if (!projectName || !newProjectName || !scriptName) return false;
      try {
        const srcPath = path.join(
          getProjectsPath(),
          projectName,
          scriptName,
        );
        const destDir = path.join(getProjectsPath(), newProjectName);
        const destPath = path.join(destDir, scriptName);

        if (!fs.existsSync(srcPath) || fs.existsSync(destPath)) {
          error('Move failed: source missing or destination exists');
          return false;
        }

        await fs.promises.mkdir(destDir, { recursive: true });
        fs.renameSync(srcPath, destPath);

        const updateOrder = async (proj, modify) => {
          const metaPath = path.join(getProjectsPath(), proj, 'scripts.json');
          let order = [];
          if (fs.existsSync(metaPath)) {
            try {
              const raw = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
              if (Array.isArray(raw.order)) order = raw.order;
            } catch (err) {
              error(`Failed to read order for ${proj}:`, err);
            }
          }
          order = modify(order);
          try {
            fs.writeFileSync(metaPath, JSON.stringify({ order }, null, 2));
          } catch (err) {
            error(`Failed to update order for ${proj}:`, err);
          }
        };

        await updateOrder(projectName, (order) =>
          order.filter((n) => n !== scriptName),
        );

        await updateOrder(newProjectName, (order) => {
          let targetIndex = Number(index);
          if (Number.isNaN(targetIndex) || targetIndex < 0 || targetIndex > order.length) {
            targetIndex = order.length;
          }
          const next = [...order];
          next.splice(targetIndex, 0, scriptName);
          return next;
        });

        return true;
      } catch (err) {
        error('Failed to move script:', err);
        return false;
      }
    },
  );

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

  ipcMain.handle('check-for-updates', () => {
    if (!app.isPackaged) {
      dialog.showMessageBox({
        type: 'info',
        title: 'Check for Updates',
        message: 'Updates are only available in packaged builds.',
      })
      return null
    }
    return autoUpdater.checkForUpdates()
  })

  ipcMain.handle('quit-and-install', () => {
    autoUpdater.quitAndInstall()
  })
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
