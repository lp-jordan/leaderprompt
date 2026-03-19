const { app, BrowserWindow, ipcMain, dialog, Menu, globalShortcut } = require('electron');
const { autoUpdater } = require('electron-updater');
const http = require('http');
const path = require('path');
const fs = require('fs');
const mammoth = require('mammoth');
const htmlToDocx = require('html-to-docx');
const { spawn } = require('child_process');
const SpellChecker = require('simple-spellchecker');
const {
  buildProjectListing,
  ensureDocxExtension,
  readScriptOrder,
  resolveUniqueDocxName,
  sanitizeFilename,
} = require('./projectFiles.cjs');
const { buildPdfExportHtml, extractPdfText, textToHtml } = require('./pdfUtils.cjs');
const { transcribeWithWhisperCpp } = require('./whisperLocal.cjs');
const lposBridge = require('./lposProjectBridge.cjs');

// OpenAI API key is provided at runtime via the OPENAI_API_KEY environment
// variable. The key should never be committed to source control.
let OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';

// Model and prompt configuration for AI rewrites
const OPENAI_MODEL = 'gpt-4o';

const REWRITE_PROMPT = `You punch up lines for spoken delivery.

Given a text selection, produce three alternative phrasings suitable for a teleprompter reader.
If a line beginning with "Context:" follows the selection, use it to keep suggestions natural in the surrounding sentence but rewrite only the selection itself.
Constraints:
- Preserve meaning, tense, and point of view.
- Keep proper nouns and numbers exactly as written.
- Keep roughly the same length (+/− 15%). If the selection is one or two words, each suggestion must contain the same number of words as the selection.
- Natural spoken cadence; avoid jargon and filler.
- No preambles, no labels, no explanations.

Return ONLY valid JSON with this shape:
{"suggestions": ["string1", "string2", "string3"]}`;

module.exports = { OPENAI_MODEL, REWRITE_PROMPT };

// Toggle automatic update behavior with an environment variable. All update
// logic remains in place so it can be re-enabled easily.
const ENABLE_AUTO_UPDATES = process.env.ENABLE_AUTO_UPDATES === 'true';

// Resolve a path to a static asset. During development assets live in the
// `public` folder. When packaged, Vite copies them to `dist` so adjust the
// root accordingly.
const assetPath = (...segments) =>
  app.isPackaged
    ? path.join(__dirname, '..', 'dist', ...segments)
    : path.join(__dirname, '..', 'public', ...segments);

let mainWindow;
let prompterWindow;
let speechFollowInspectorWindow;
let devConsoleWindow;
const pendingLogs = [];
let viteProcess;
let isAlwaysOnTop = false;
let currentScriptHtml = '';
let currentProjectName = '';
let prompterOpenRequestId = 0;
const rewriteControllers = new Map();
let projectListCache = null;
const PROMPTER_LOAD_TIMEOUT_MS = 5000;
const PROMPTER_READY_TIMEOUT_MS = 3000;

function sendLog(msg) {
  if (devConsoleWindow && !devConsoleWindow.isDestroyed()) {
    devConsoleWindow.webContents.send('log-message', msg)
  } else {
    pendingLogs.push(msg)
  }
}

const log = (...args) => {
  console.log(...args);
  sendLog(args.join(' '));
};
const error = (...args) => {
  console.error(...args);
  sendLog(`[ERROR] ${args.join(' ')}`);
};
const warn = (...args) => {
  console.warn(...args);
  sendLog(`[WARN] ${args.join(' ')}`);
};

let spellChecker;
try {
  spellChecker = SpellChecker.getDictionarySync('en-US');
  log('Spell checker loaded');
} catch (err) {
  error('Failed to load spellchecker', err);
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
    shell: true,
    stdio: ['inherit', 'pipe', 'pipe'],
  });
  viteProcess.stdout.on('data', (data) => {
    const msg = data.toString();
    process.stdout.write(msg);
  });
  viteProcess.stderr.on('data', (data) => {
    const msg = data.toString();
    process.stderr.write(msg);
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
const getProjectSettingsPath = (project) =>
  path.join(getProjectsPath(), project, 'settings.json');
const getAppConfigPath = () => path.join(getUserDataPath(), 'config.json');
const getSpeechDebugPath = () => path.join(getUserDataPath(), 'speech-debug');
const getSpeechSnapshotPath = () => path.join(getUserDataPath(), 'speech-snapshots');
const makeSpeechDebugChunkPath = (chunkId) => {
  const safeChunkId = String(chunkId || 'chunk').replace(/[^a-z0-9_-]/gi, '_');
  const uniqueSuffix = `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
  return path.join(getSpeechDebugPath(), `chunk-${safeChunkId}-${uniqueSuffix}.wav`);
};

function readAppConfig() {
  try {
    if (!fs.existsSync(getAppConfigPath())) return {};
    return JSON.parse(fs.readFileSync(getAppConfigPath(), 'utf8'));
  } catch (err) {
    error('Failed to read config file:', err);
    return {};
  }
}

// ── LPOS Sync ──────────────────────────────────────────────────────────────────

const getLposSyncConfigPath = () => path.join(getUserDataPath(), 'lpos-sync.json');

function readLposSyncConfig() {
  try {
    if (!fs.existsSync(getLposSyncConfigPath())) return { serverUrl: '', projectLinks: {} };
    return JSON.parse(fs.readFileSync(getLposSyncConfigPath(), 'utf8'));
  } catch { return { serverUrl: '', projectLinks: {} }; }
}

function writeLposSyncConfig(config) {
  fs.writeFileSync(getLposSyncConfigPath(), JSON.stringify(config, null, 2));
}

// Per-project link file: ~/leaderprompt/projects/{name}/lpos-links.json
// Tracks which LP script files correspond to which LPOS scriptIds + last-seen updatedAt
function getLposLinksPath(projectName) {
  return path.join(getProjectsPath(), projectName, 'lpos-links.json');
}

function readLposLinks(projectName) {
  const p = getLposLinksPath(projectName);
  if (!fs.existsSync(p)) return { lposProjectId: null, scripts: {} };
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch { return { lposProjectId: null, scripts: {} }; }
}

function writeLposLinks(projectName, links) {
  fs.writeFileSync(getLposLinksPath(projectName), JSON.stringify(links, null, 2));
}

let lposSyncStatus = { status: 'idle', lastSync: null, error: null };

function notifyLposSyncUpdate() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('lpos-sync-update', lposSyncStatus);
  }
}

async function lposFetchUrl(fullUrl, options = {}) {
  return fetch(fullUrl, { ...options, signal: AbortSignal.timeout(10000) });
}

async function lposPollOnce() {
  // Keep bridge index fresh + notify renderer of any structural changes
  const { projectsChanged, scriptsChangedFor } = await lposBridge.refreshProjects();
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (projectsChanged) {
      mainWindow.webContents.send('lpos-projects-updated');
    }
    for (const projectName of scriptsChangedFor) {
      mainWindow.webContents.send('lpos-scripts-updated', { projectName });
    }
  }

  const config = readLposSyncConfig();
  if (!config.serverUrl) return;

  const base = config.serverUrl.replace(/\/$/, '');
  let anyError = false;

  for (const [lpProjectName, lposProjectId] of Object.entries(config.projectLinks ?? {})) {
    try {
      const res = await lposFetchUrl(`${base}/api/projects/${lposProjectId}/scripts`);
      if (!res.ok) { anyError = true; continue; }

      const { scripts } = await res.json();
      if (!Array.isArray(scripts)) continue;

      const projectDir = path.join(getProjectsPath(), lpProjectName);
      if (!fs.existsSync(projectDir)) fs.mkdirSync(projectDir, { recursive: true });

      const links = readLposLinks(lpProjectName);
      links.lposProjectId = lposProjectId;
      links.scripts = links.scripts || {};
      let changed = false;

      for (const script of scripts) {
        // Find existing LP filename for this LPOS scriptId (if any)
        const existing = Object.entries(links.scripts).find(([, v]) => v.lposScriptId === script.scriptId);
        const existingName = existing ? existing[0] : null;
        if (existingName && links.scripts[existingName]?.updatedAt === script.updatedAt) continue;

        // Download the raw .docx
        const fileRes = await lposFetchUrl(`${base}/api/projects/${lposProjectId}/scripts/${script.scriptId}/file`);
        if (!fileRes.ok) continue;

        const buffer = Buffer.from(await fileRes.arrayBuffer());
        const finalName = existingName ?? ensureDocxExtension(script.name);
        const destPath = path.join(projectDir, finalName);

        fs.writeFileSync(destPath, buffer);
        links.scripts[finalName] = { lposScriptId: script.scriptId, updatedAt: script.updatedAt };
        changed = true;

        // Add to scripts.json order if this is a new script
        if (!existingName) {
          const orderPath = path.join(projectDir, 'scripts.json');
          let order = [];
          try {
            if (fs.existsSync(orderPath)) order = JSON.parse(fs.readFileSync(orderPath, 'utf8')).order || [];
          } catch {}
          if (!order.includes(finalName)) order.push(finalName);
          fs.writeFileSync(orderPath, JSON.stringify({ order }, null, 2));
        }
      }

      if (changed) {
        writeLposLinks(lpProjectName, links);
        invalidateProjectListCache();
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('lpos-scripts-updated', { projectName: lpProjectName });
        }
      }
    } catch (err) {
      error(`LPOS sync error for "${lpProjectName}":`, err.message);
      anyError = true;
    }
  }

  lposSyncStatus = {
    status: anyError ? 'error' : 'synced',
    lastSync: new Date().toISOString(),
    error: anyError ? 'One or more projects failed to sync' : null,
  };
  notifyLposSyncUpdate();
}

async function lposPushScript(projectName, scriptName, buffer) {
  try {
    const config = readLposSyncConfig();
    if (!config.serverUrl) return;

    const links = readLposLinks(projectName);
    const scriptLink = links.scripts?.[scriptName];
    if (!scriptLink || !links.lposProjectId) return;

    const base = config.serverUrl.replace(/\/$/, '');
    const res = await lposFetchUrl(
      `${base}/api/projects/${links.lposProjectId}/scripts/${scriptLink.lposScriptId}/file`,
      {
        method: 'PUT',
        body: buffer,
        headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
      },
    );

    if (res.ok) {
      // Stamp our local updatedAt so we don't re-download our own push on next poll
      links.scripts[scriptName].updatedAt = new Date().toISOString();
      writeLposLinks(projectName, links);
      log(`LPOS: pushed "${scriptName}" from "${projectName}"`);
    } else {
      error(`LPOS push failed: HTTP ${res.status}`);
    }
  } catch (err) {
    error('LPOS push error:', err.message);
  }
}

let lposPollInterval = null;

function startLposPolling() {
  if (lposPollInterval) return;
  setTimeout(() => { void lposPollOnce(); }, 3000);
  lposPollInterval = setInterval(() => { void lposPollOnce(); }, 30000);
  log('LPOS polling started');
}

function stopLposPolling() {
  if (lposPollInterval) { clearInterval(lposPollInterval); lposPollInterval = null; }
}

function resolveExistingPath(candidates) {
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  return '';
}

function getBundledWhisperRoot() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'whispercpp')
    : path.join(__dirname, '..', 'vendor', 'whispercpp');
}

function getWhisperConfig() {
  const config = readAppConfig();
  const bundledRoot = getBundledWhisperRoot();
  const platformFolder = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux';
  const executableCandidates = process.platform === 'win32'
    ? ['whisper-cli.exe', 'main.exe']
    : ['whisper-cli', 'main'];

  const executablePath = resolveExistingPath([
    process.env.WHISPER_CPP_PATH,
    config.WHISPER_CPP_PATH,
    ...executableCandidates.map((name) => path.join(bundledRoot, platformFolder, name)),
    ...executableCandidates.map((name) => path.join(bundledRoot, 'bin', name)),
  ]);

  const modelPath = resolveExistingPath([
    process.env.WHISPER_MODEL_PATH,
    config.WHISPER_MODEL_PATH,
    path.join(bundledRoot, 'models', 'ggml-tiny.en.bin'),
    path.join(bundledRoot, 'models', 'ggml-base.en.bin'),
    path.join(bundledRoot, 'models', 'ggml-small.en.bin'),
  ]);

  return {
    executablePath,
    modelPath,
    configured: Boolean(executablePath && modelPath),
    source: app.isPackaged ? 'bundled' : 'dev-bundled',
  };
}

function loadOpenAIKey() {
  let key = process.env.OPENAI_API_KEY;

  if (!key) {
    try {
      const envPath = path.join(__dirname, '..', '.env');
      if (fs.existsSync(envPath)) {
        const match = fs
          .readFileSync(envPath, 'utf8')
          .match(/^OPENAI_API_KEY=(.*)$/m);
        if (match) key = match[1].trim();
      }
    } catch (err) {
      error('Failed to read .env file:', err);
    }
  }

  if (!key) {
    try {
      const cfg = readAppConfig();
      if (cfg.OPENAI_API_KEY) key = cfg.OPENAI_API_KEY;
    } catch (err) {
      error('Failed to read config file:', err);
    }
  }

  if (key) process.env.OPENAI_API_KEY = key;
  return key;
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

  if (!fs.existsSync(getSpeechSnapshotPath())) {
    fs.mkdirSync(getSpeechSnapshotPath(), { recursive: true });
    log('Created speech snapshot directory');
  }

}

function setupAutoUpdates() {
  if (!ENABLE_AUTO_UPDATES) {
    log('Auto updates disabled');
    return;
  }
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
  if (!ENABLE_AUTO_UPDATES) {
    log('Auto updates disabled');
    return;
  }
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

function saveProjectMetadata(metadata) {
  fs.writeFileSync(getProjectMetadataPath(), JSON.stringify(metadata, null, 2));
}

function getProjectMetadata() {
  try {
    const raw = fs.readFileSync(getProjectMetadataPath(), 'utf-8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.projects)) {
      parsed.projects = [];
    }
    return parsed;
  } catch (err) {
    error('Failed to read or parse project metadata:', err);
    const fallback = { projects: [] };
    try {
      saveProjectMetadata(fallback);
    } catch (writeErr) {
      error('Failed to recreate projects.json:', writeErr);
    }
    return fallback;
  }
}

function updateProjectMetadata(projectName) {
  const metadata = getProjectMetadata();
  const existing = metadata.projects.find((project) => project.name === projectName);
  if (existing) {
    if (typeof existing.archived === 'undefined') existing.archived = false;
    return projectName;
  }

  metadata.projects.push({
    name: projectName,
    added: Date.now(),
    archived: false,
    archivedAt: 0,
  });
  saveProjectMetadata(metadata);
  log('Metadata updated with new project: ' + projectName);
  return projectName;
}

function setProjectArchivedState(projectName, archived) {
  const metadata = getProjectMetadata();
  const project = metadata.projects.find((entry) => entry.name === projectName);
  if (!project) return false;

  project.archived = !!archived;
  project.archivedAt = archived ? Date.now() : 0;
  saveProjectMetadata(metadata);
  invalidateProjectListCache();
  return true;
}

function readProjectSettings(projectName) {
  const settingsPath = getProjectSettingsPath(projectName);
  try {
    const raw = fs.readFileSync(settingsPath, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    error('Failed to read or parse project settings:', err);
    const fallback = {};
    try {
      fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
      fs.writeFileSync(settingsPath, JSON.stringify(fallback, null, 2));
    } catch (writeErr) {
      error('Failed to recreate settings.json:', writeErr);
    }
    return fallback;
  }
}

function writeProjectSettings(projectName, settings) {
  const settingsPath = getProjectSettingsPath(projectName);
  try {
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    return true;
  } catch (err) {
    error('Failed to write project settings:', err);
    return false;
  }
}

function invalidateProjectListCache() {
  projectListCache = null;
}

function buildImportResult(importedCount = 0, renamedCount = 0) {
  return { importedCount, renamedCount };
}

const SUPPORTED_IMPORT_EXTENSIONS = new Set(['.docx', '.pdf']);

function isSupportedImportName(fileName) {
  return SUPPORTED_IMPORT_EXTENSIONS.has(path.extname(fileName || '').toLowerCase());
}

function stripExtension(fileName) {
  return path.basename(fileName, path.extname(fileName));
}

async function ensureProjectDirectory(projectName) {
  const destDir = path.join(getProjectsPath(), projectName);
  await fs.promises.mkdir(destDir, { recursive: true });
  updateProjectMetadata(projectName);
  invalidateProjectListCache();
  return destDir;
}

async function importHtmlToProject(destDir, sourceName, html, options = {}) {
  const targetName = await resolveUniqueDocxName(destDir, sourceName, options);
  if (!targetName || !html?.trim()) return null;

  const buffer = await htmlToDocx(html);
  const destPath = path.join(destDir, targetName);
  await fs.promises.writeFile(destPath, buffer);

  const safeSourceName = sanitizeFilename(sourceName);
  const normalizedSourceName = safeSourceName
    ? ensureDocxExtension(path.basename(safeSourceName, path.extname(safeSourceName)))
    : null;

  return {
    destPath,
    fileName: targetName,
    renamed:
      normalizedSourceName !== null &&
      normalizedSourceName.toLowerCase() !== targetName.toLowerCase(),
  };
}

async function convertImportBufferToHtml(sourceName, buffer) {
  const extension = path.extname(sourceName || '').toLowerCase();
  if (extension === '.docx') {
    const result = await mammoth.convertToHtml({ buffer });
    return result.value || '';
  }

  if (extension === '.pdf') {
    const text = await extractPdfText(buffer);
    return textToHtml(text);
  }

  return '';
}

async function convertImportPathToHtml(sourcePath) {
  const extension = path.extname(sourcePath || '').toLowerCase();
  if (extension === '.docx') {
    const result = await mammoth.convertToHtml({ path: sourcePath });
    return result.value || '';
  }

  if (extension === '.pdf') {
    const buffer = await fs.promises.readFile(sourcePath);
    return textToHtml(await extractPdfText(buffer));
  }

  return '';
}

async function importBufferToProject(destDir, sourceName, buffer, options = {}) {
  const html = await convertImportBufferToHtml(sourceName, buffer);
  return importHtmlToProject(destDir, sourceName, html, options);
}

async function importPathToProject(destDir, sourcePath, options = {}) {
  const html = await convertImportPathToHtml(sourcePath);
  return importHtmlToProject(destDir, path.basename(sourcePath), html, options);
}

async function renderPdfBuffer(title, html) {
  const pdfWindow = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true },
    backgroundColor: '#ffffff',
  });

  try {
    await pdfWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(buildPdfExportHtml(title, html)));
    await pdfWindow.webContents.executeJavaScript(
      'document.fonts && document.fonts.ready ? document.fonts.ready.then(() => true) : true',
      true,
    );
    return await pdfWindow.webContents.printToPDF({
      printBackground: true,
      preferCSSPageSize: true,
    });
  } finally {
    if (!pdfWindow.isDestroyed()) pdfWindow.destroy();
  }
}

async function exportScriptFile(projectName, scriptName, format, destinationPath) {
  const sourcePath = lposBridge.getLocalScriptPath(projectName, scriptName)
    ?? path.join(getProjectsPath(), projectName, scriptName);
  if (format === 'docx') {
    await fs.promises.copyFile(sourcePath, destinationPath);
    return destinationPath;
  }

  const result = await mammoth.convertToHtml({ path: sourcePath });
  const pdfBuffer = await renderPdfBuffer(stripExtension(scriptName), result.value || '');
  await fs.promises.writeFile(destinationPath, pdfBuffer);
  return destinationPath;
}

async function resolveUniqueExportPath(destDir, baseName, extension) {
  const safeBase = sanitizeFilename(baseName) || 'Export';
  const sanitizedBase = path.basename(safeBase, path.extname(safeBase));
  let candidate = `${sanitizedBase}.${extension}`;
  let counter = 1;

  while (fs.existsSync(path.join(destDir, candidate))) {
    candidate = `${sanitizedBase} ${counter}.${extension}`;
    counter += 1;
  }

  return path.join(destDir, candidate);
}

async function getOrderedProjectScripts(projectName) {
  const projectDir = path.join(getProjectsPath(), projectName);
  const [entries, savedOrder] = await Promise.all([
    fs.promises.readdir(projectDir, { withFileTypes: true }),
    readScriptOrder(projectDir),
  ]);

  const scripts = entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.docx'))
    .map((entry) => entry.name);

  const remaining = new Set(scripts);
  const ordered = [];

  for (const name of savedOrder) {
    if (remaining.has(name)) {
      ordered.push(name);
      remaining.delete(name);
    }
  }

  for (const name of scripts) {
    if (remaining.has(name)) ordered.push(name);
  }

  return ordered;
}

async function exportProjectFiles(projectName, format, destinationDir) {
  const scripts = await getOrderedProjectScripts(projectName);
  let exportedCount = 0;

  for (const scriptName of scripts) {
    const destinationPath = await resolveUniqueExportPath(
      destinationDir,
      stripExtension(scriptName),
      format,
    );
    await exportScriptFile(projectName, scriptName, format, destinationPath);
    exportedCount += 1;
  }

  return { exportedCount, destinationDir };
}

function sanitizeSnapshotBaseName(value) {
  return sanitizeFilename(value || 'speech-follow-snapshot')
    .replace(/\.[^.]+$/, '')
    || 'speech-follow-snapshot';
}

async function writeSpeechFollowSnapshot(snapshotPayload = {}, destinationPath) {
  const json = JSON.stringify(snapshotPayload, null, 2);
  await fs.promises.mkdir(path.dirname(destinationPath), { recursive: true });
  await fs.promises.writeFile(destinationPath, json, 'utf8');
  return destinationPath;
}
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1180,
    minHeight: 760,
    webPreferences: {
      preload: path.resolve(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
    },
    icon: assetPath('logos', 'LP_white.png'),
    backgroundColor: '#000000',
  });

  if (app.isPackaged) {
    mainWindow.loadFile(path.join('dist', 'index.html'));
  } else {
    mainWindow.loadURL('http://localhost:5173');
  }

  log('Main window created and loaded');
}

function createDevConsoleWindow() {
  if (devConsoleWindow) return
  devConsoleWindow = new BrowserWindow({
    width: 800,
    height: 400,
    show: false,
    webPreferences: {
      preload: path.resolve(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
    },
    title: 'Dev Console',
  })

  if (app.isPackaged) {
    devConsoleWindow.loadFile(path.join('dist', 'index.html'), { hash: '/dev-console' })
  } else {
    devConsoleWindow.loadURL('http://localhost:5173/#/dev-console')
  }
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

  if (!prompterWindow || prompterWindow.isDestroyed()) {
    prompterWindow = new BrowserWindow({
      ...baseOptions,
      backgroundColor: '#000000',
      frame: true,
      transparent: false,
    })
    log('[prompter] BrowserWindow created', JSON.stringify({ id: prompterWindow.id, visible: prompterWindow.isVisible() }))
    prompterWindow.setAlwaysOnTop(isAlwaysOnTop)
    prompterWindow.once('ready-to-show', () => {
      log('[prompter] ready-to-show', JSON.stringify({ id: prompterWindow?.id, destroyed: prompterWindow?.isDestroyed?.() ?? true }))
    })
    prompterWindow.webContents.on('did-finish-load', () => {
      log('[prompter] did-finish-load', JSON.stringify({ id: prompterWindow?.id, url: prompterWindow?.webContents?.getURL?.() || '' }))
    })
    prompterWindow.webContents.on('did-fail-load', (_, code, description, url) => {
      error('[prompter] did-fail-load', JSON.stringify({ code, description, url }))
    })
    prompterWindow.on('show', () => log('[prompter] show event', JSON.stringify({ id: prompterWindow?.id })))
    prompterWindow.on('focus', () => log('[prompter] focus event', JSON.stringify({ id: prompterWindow?.id })))
    prompterWindow.webContents.on('render-process-gone', (_, details) => {
      error('[prompter] render-process-gone', JSON.stringify(details || {}))
    })
    prompterWindow.on('closed', () => {
      prompterWindow = null
      if (speechFollowInspectorWindow && !speechFollowInspectorWindow.isDestroyed()) {
        speechFollowInspectorWindow.close()
      }
      speechFollowInspectorWindow = null
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('prompter-closed')
      }
    })
    if (app.isPackaged) {
      prompterWindow.loadFile(path.join('dist', 'index.html'), { hash: '/prompter' })
    } else {
      prompterWindow.loadURL('http://localhost:5173/#/prompter')
    }
    await new Promise((resolve, reject) => {
      let settled = false
      let timeoutId = null

      const cleanup = () => {
        if (timeoutId) {
          clearTimeout(timeoutId)
          timeoutId = null
        }
        prompterWindow?.removeListener('ready-to-show', handleReadyToShow)
        prompterWindow?.removeListener('closed', handleClosed)
        prompterWindow?.webContents?.removeListener('did-finish-load', handleDidFinishLoad)
        prompterWindow?.webContents?.removeListener('did-fail-load', handleDidFailLoad)
      }

      const settle = (callback) => {
        if (settled) return
        settled = true
        cleanup()
        callback()
      }

      const handleReadyToShow = () => settle(() => resolve('ready-to-show'))
      const handleDidFinishLoad = () => settle(() => resolve('did-finish-load'))
      const handleDidFailLoad = (_, code, description, url) => {
        settle(() => reject(new Error(`Prompter failed to load (${code}): ${description} [${url || 'no-url'}]`)))
      }
      const handleClosed = () => settle(() => reject(new Error('Prompter window closed before it finished loading')))

      prompterWindow.once('ready-to-show', handleReadyToShow)
      prompterWindow.once('closed', handleClosed)
      prompterWindow.webContents.once('did-finish-load', handleDidFinishLoad)
      prompterWindow.webContents.once('did-fail-load', handleDidFailLoad)
      timeoutId = setTimeout(() => {
        settle(() => {
          warn(`[prompter] load wait timed out after ${PROMPTER_LOAD_TIMEOUT_MS}ms; continuing without ready-to-show`)
          resolve('timeout')
        })
      }, PROMPTER_LOAD_TIMEOUT_MS)
    })
  }

  log('Prompter window initialized')
}
async function createSpeechFollowInspectorWindow() {
  const prompterBounds = prompterWindow && !prompterWindow.isDestroyed()
    ? prompterWindow.getBounds()
    : { x: 100, y: 100, width: 1200, height: 800 }

  const preferredWidth = 460
  const inspectorX = prompterBounds.x + prompterBounds.width + 16
  const inspectorY = prompterBounds.y

  if (!speechFollowInspectorWindow || speechFollowInspectorWindow.isDestroyed()) {
    speechFollowInspectorWindow = new BrowserWindow({
      width: preferredWidth,
      height: Math.max(700, prompterBounds.height),
      minWidth: 420,
      minHeight: 640,
      x: inspectorX,
      y: inspectorY,
      show: false,
      backgroundColor: '#0a1018',
      title: 'Speech Follow',
      webPreferences: {
        preload: path.resolve(__dirname, 'preload.cjs'),
        contextIsolation: true,
        sandbox: true,
        backgroundThrottling: false,
      },
      icon: assetPath('logos', 'LP_white.png'),
      titleBarStyle: 'default',
    })

    speechFollowInspectorWindow.on('closed', () => {
      speechFollowInspectorWindow = null
      if (prompterWindow && !prompterWindow.isDestroyed()) {
        prompterWindow.webContents.send('speech-follow-inspector-closed')
      }
    })

    if (app.isPackaged) {
      speechFollowInspectorWindow.loadFile(path.join('dist', 'index.html'), { hash: '/speech-follow-inspector' })
    } else {
      speechFollowInspectorWindow.loadURL('http://localhost:5173/#/speech-follow-inspector')
    }

    await new Promise((resolve) => speechFollowInspectorWindow.once('ready-to-show', resolve))
  }
}
// ── LPOS Sync IPC handlers ────────────────────────────────────────────────────

ipcMain.handle('lpos-get-config', () => readLposSyncConfig());

ipcMain.handle('lpos-save-config', (_, config) => {
  writeLposSyncConfig(config);
  stopLposPolling();
  startLposPolling();
  return true;
});

ipcMain.handle('lpos-get-status', () => lposSyncStatus);

ipcMain.handle('lpos-sync-now', async () => {
  await lposPollOnce();
  return lposSyncStatus;
});

// Fetch the LPOS project list so the UI can offer a dropdown for linking
ipcMain.handle('lpos-get-remote-projects', async (_, serverUrl) => {
  try {
    const base = (serverUrl || '').replace(/\/$/, '');
    const res = await lposFetchUrl(`${base}/api/projects`);
    if (!res.ok) return { error: `Server returned ${res.status}` };
    return await res.json();
  } catch (err) {
    return { error: err.message };
  }
});

// --- Electron App Lifecycle ---
app.whenReady().then(async () => {
  OPENAI_API_KEY = loadOpenAIKey();
  if (!OPENAI_API_KEY) {
    error('OpenAI API key not set. Rewrite requests will fail.');
  }
  log('App ready');
  startViteServer();
  if (!app.isPackaged) {
    await waitForVite();
  }
  ensureDirectories();
  createMainWindow();
  setupAutoUpdates();
  startLposPolling();

  // Notify renderer when LPOS connection state changes
  lposBridge.onConnectionChange((connected) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('lpos-connection-changed', { connected });
    }
  });
  createAppMenu();

  globalShortcut.register('CommandOrControl+Shift+D', () => {
    if (devConsoleWindow && !devConsoleWindow.isDestroyed()) {
      if (devConsoleWindow.isVisible()) {
        devConsoleWindow.hide();
      } else {
        devConsoleWindow.show();
        devConsoleWindow.focus();
      }
    } else {
      createDevConsoleWindow();
      if (devConsoleWindow && !devConsoleWindow.isDestroyed()) {
        devConsoleWindow.show();
        devConsoleWindow.focus();
      }
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });

  // --- IPC Handlers ---
  ipcMain.on('open-prompter', async (_, html, project) => {
    log('Received request to open prompter');

    if (!String(html || '').trim()) {
      warn(`[prompter] Refusing to open with empty HTML for project "${project || ''}"`)
      return
    }

    currentScriptHtml = html;
    currentProjectName = project;
    const requestId = ++prompterOpenRequestId;
    let readyTimeoutId = null;

    const showWindow = (reason = 'renderer-ready') => {
      if (requestId !== prompterOpenRequestId) return;
      if (readyTimeoutId) {
        clearTimeout(readyTimeoutId);
        readyTimeoutId = null;
      }
      if (prompterWindow && !prompterWindow.isDestroyed()) {
        prompterWindow.show();
        prompterWindow.focus();
        prompterWindow.setAlwaysOnTop(isAlwaysOnTop)
        prompterWindow.webContents.send('load-script', {
          html: currentScriptHtml,
          project: currentProjectName,
        });
        log(`Prompter window shown (${reason})`);
      }
    };

    const handlePrompterReady = () => showWindow('renderer-ready');

    if (!prompterWindow || prompterWindow.isDestroyed()) {
      ipcMain.once('prompter-ready', handlePrompterReady);
      readyTimeoutId = setTimeout(() => {
        warn(`[prompter] renderer-ready not received after ${PROMPTER_READY_TIMEOUT_MS}ms; showing window anyway`)
        showWindow('ready-timeout')
      }, PROMPTER_READY_TIMEOUT_MS);
      try {
        await createPrompterWindow();
      } catch (err) {
        if (readyTimeoutId) {
          clearTimeout(readyTimeoutId);
          readyTimeoutId = null;
        }
        ipcMain.removeListener('prompter-ready', handlePrompterReady);
        error('[prompter] Failed to create window', err);
        if (prompterWindow && !prompterWindow.isDestroyed()) {
          prompterWindow.close();
        }
        prompterWindow = null;
      }
    } else {
      showWindow('existing-window');
    }
  });
  ipcMain.on('update-script', (_, html) => {
    currentScriptHtml = html;
    if (prompterWindow && !prompterWindow.isDestroyed()) {
      prompterWindow.webContents.send('update-script', html);
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-script', html);
    }
    log('Updated script content');
  });

  ipcMain.on('set-prompter-always-on-top', (_, flag) => {
    isAlwaysOnTop = !!flag;
    if (prompterWindow && !prompterWindow.isDestroyed()) {
      prompterWindow.setAlwaysOnTop(isAlwaysOnTop)
    prompterWindow.once('ready-to-show', () => {
      log('[prompter] ready-to-show', JSON.stringify({ id: prompterWindow?.id, destroyed: prompterWindow?.isDestroyed?.() ?? true }))
    })
    prompterWindow.webContents.on('did-finish-load', () => {
      log('[prompter] did-finish-load', JSON.stringify({ id: prompterWindow?.id, url: prompterWindow?.webContents?.getURL?.() || '' }))
    })
    prompterWindow.webContents.on('did-fail-load', (_, code, description, url) => {
      error('[prompter] did-fail-load', JSON.stringify({ code, description, url }))
    })
    prompterWindow.on('show', () => log('[prompter] show event', JSON.stringify({ id: prompterWindow?.id })))
    prompterWindow.on('focus', () => log('[prompter] focus event', JSON.stringify({ id: prompterWindow?.id })))
    prompterWindow.webContents.on('render-process-gone', (_, details) => {
      error('[prompter] render-process-gone', JSON.stringify(details || {}))
    });
    }
    log(`Prompter always on top: ${isAlwaysOnTop}`);
  });

  ipcMain.on('close-prompter', () => {
    if (speechFollowInspectorWindow && !speechFollowInspectorWindow.isDestroyed()) {
      speechFollowInspectorWindow.close();
    }
    speechFollowInspectorWindow = null;
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

  ipcMain.on('open-speech-follow-inspector', async () => {
    await createSpeechFollowInspectorWindow();
    if (speechFollowInspectorWindow && !speechFollowInspectorWindow.isDestroyed()) {
      speechFollowInspectorWindow.show();
      speechFollowInspectorWindow.focus();
    }
  });

  ipcMain.on('close-speech-follow-inspector', () => {
    if (speechFollowInspectorWindow && !speechFollowInspectorWindow.isDestroyed()) {
      speechFollowInspectorWindow.close();
    }
    speechFollowInspectorWindow = null;
  });

  ipcMain.handle('get-current-script', () => ({
    html: currentScriptHtml,
    project: currentProjectName,
  }));

  ipcMain.handle('get-whisper-config', () => getWhisperConfig());
  ipcMain.handle('transcribe-whisper-chunk', async (_, payload = {}) => {
    const whisperConfig = getWhisperConfig();
    if (!whisperConfig.configured) {
      return { ok: false, reason: 'not_configured', message: 'Local speech follow engine is not installed in this app build yet.' };
    }

    const chunkId = payload.chunkId || String(Date.now());
    const saveDebugAudio = Boolean(payload.saveDebugAudio);
    const blankToken = String(payload.blankToken || '').trim();
    const debugWavPath = saveDebugAudio
      ? makeSpeechDebugChunkPath(chunkId)
      : '';

    if (saveDebugAudio) {
      await fs.promises.mkdir(getSpeechDebugPath(), { recursive: true });
    }

    try {
      const result = await transcribeWithWhisperCpp({
        executablePath: whisperConfig.executablePath,
        modelPath: whisperConfig.modelPath,
        samples: payload.samples,
        sampleRate: payload.sampleRate || 16000,
        language: payload.language || 'en',
        keepWavPath: debugWavPath,
      });

      const rawOutput = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
      const text = result.text || '';
      const isBlank = Boolean(blankToken) && rawOutput.includes(blankToken);
      const shouldKeepAudio = saveDebugAudio && (isBlank || !text);
      if (saveDebugAudio && !shouldKeepAudio && debugWavPath) {
        await fs.promises.unlink(debugWavPath).catch(() => {});
      }

      return {
        ok: true,
        text,
        rawOutput,
        stderr: result.stderr || '',
        stdout: result.stdout || '',
        durationMs: result.durationMs || 0,
        wavPath: shouldKeepAudio ? debugWavPath : '',
        executablePath: whisperConfig.executablePath,
        modelPath: whisperConfig.modelPath,
        isBlank,
      };
    } catch (err) {
      error('Local whisper transcription failed:', err);
      return {
        ok: false,
        reason: 'transcription_failed',
        message: err?.message || 'Local whisper transcription failed.',
        rawOutput: [err?.stdout, err?.stderr].filter(Boolean).join('\n').trim(),
        stderr: err?.stderr || '',
        stdout: err?.stdout || '',
        durationMs: err?.durationMs || 0,
        wavPath: err?.wavPath || debugWavPath || '',
        executablePath: whisperConfig.executablePath,
        modelPath: whisperConfig.modelPath,
      };
    }
  });

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

  ipcMain.handle('spell-check', (_, word) => {
    try {
      if (!spellChecker || !word) return [];
      if (spellChecker.spellCheck(word)) return [];
      return spellChecker.getSuggestions(word).slice(0, 5);
    } catch (err) {
      error('Spell check failed:', err);
      return [];
    }
  });

  ipcMain.handle('get-all-projects-with-scripts', async () => {
    log('Fetching all projects with scripts (LPOS)');
    try {
      return await lposBridge.getAllProjects();
    } catch (err) {
      error('[get-all-projects-with-scripts] Failed:', err);
      return [];
    }
  });

  ipcMain.handle('select-project-folder', async () => {
    log('Project selection invoked but disabled');
    return null;
  });

  ipcMain.handle('create-new-project', async (_, projectName, clientName) => {
    log(`Creating new project in LPOS: ${projectName} (client: ${clientName || 'none'})`);
    try {
      return await lposBridge.createProject(projectName, clientName || '');
    } catch (err) {
      error('Error creating new project:', err);
      return false;
    }
  });

  ipcMain.handle('lpos-get-client-names', () => lposBridge.getClientNames());

  ipcMain.handle('select-files', async () => {
    try {
      const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
        title: 'Select script files',
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: 'Scripts', extensions: ['docx', 'pdf'] }],
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
    log(`Renaming project in LPOS: ${oldName} -> ${newName}`);
    if (!oldName || !newName || oldName === newName) return false;
    try {
      return await lposBridge.renameProject(oldName, newName);
    } catch (err) {
      error('Error renaming project:', err);
      return false;
    }
  });

  ipcMain.handle('delete-project', async (_, projectName) => {
    log(`Deleting project in LPOS: ${projectName}`);
    try {
      return await lposBridge.deleteProject(projectName);
    } catch (err) {
      error('Failed to delete project:', err);
      return false;
    }
  });

  ipcMain.handle('archive-project', (_, projectName) => {
    log('Archiving project (LP-only flag): ' + projectName);
    return lposBridge.setProjectArchived(projectName, true);
  });

  ipcMain.handle('restore-project', (_, projectName) => {
    log('Restoring project (LP-only flag): ' + projectName);
    return lposBridge.setProjectArchived(projectName, false);
  });

  ipcMain.handle('export-project', async (_, projectName, format) => {
    if (!projectName || !['docx', 'pdf'].includes(format)) return { success: false };

    try {
      const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
        title: 'Export ' + projectName,
        properties: ['openDirectory', 'createDirectory'],
      });

      if (canceled || !filePaths?.[0]) {
        return { success: false, canceled: true };
      }

      const result = await exportProjectFiles(projectName, format, filePaths[0]);
      return { success: true, ...result };
    } catch (err) {
      error('Failed to export project:', err);
      return { success: false, error: err.message };
    }
  });
ipcMain.handle('rename-script', async (_, projectName, oldName, newName) => {
    log(`Renaming script in LPOS: ${oldName} -> ${newName} in ${projectName}`);
    if (!projectName || !oldName || !newName) return false;
    try {
      // newName from LP is the display name (may or may not have .docx)
      const displayName = newName.replace(/\.docx$/i, '');
      return await lposBridge.renameScript(projectName, oldName, displayName);
    } catch (err) {
      error('Error renaming script:', err);
      return false;
    }
  });

  ipcMain.handle('create-new-script', async (_, projectName, scriptName) => {
    log(`Creating new script in LPOS: ${scriptName} in ${projectName}`);
    if (!projectName || !scriptName) return { success: false };
    try {
      const displayName = scriptName.replace(/\.docx$/i, '');
      return await lposBridge.createScript(projectName, displayName);
    } catch (err) {
      error('Failed to create new script:', err);
      return { success: false };
    }
  });

ipcMain.handle('import-scripts-to-project', async (_, filePaths, projectName) => {
  log(`Importing scripts to project: ${projectName}`);
  if (!Array.isArray(filePaths) || !filePaths.length || !projectName) {
    error('Invalid import attempt: missing files or project name');
    return buildImportResult();
  }

  const destDir = await ensureProjectDirectory(projectName);

  const gatherDocx = async (dir) => {
    let collected = [];
    let entries;
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return collected;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        collected = collected.concat(await gatherDocx(full));
      } else if (entry.isFile() && isSupportedImportName(full)) {
        collected.push(full);
      }
    }
    return collected;
  };

  let expanded = [];
  for (const p of filePaths) {
    if (!p || typeof p !== 'string') continue;
    let stat;
    try {
      stat = await fs.promises.lstat(p);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      expanded = expanded.concat(await gatherDocx(p));
    } else if (stat.isFile() && isSupportedImportName(p)) {
      expanded.push(p);
    }
  }

  expanded = Array.from(new Set(expanded));

  let importedCount = 0;
  let renamedCount = 0;
  for (const file of expanded) {
    try {
      const imported = await importPathToProject(destDir, file);
      if (!imported) continue;
      log(`Imported script: ${imported.fileName} -> ${imported.destPath}`);
      importedCount++;
      if (imported.renamed) renamedCount++;
    } catch (err) {
      error(`Failed to import file ${file}:`, err);
    }
  }
  invalidateProjectListCache();
  return buildImportResult(importedCount, renamedCount);
});

ipcMain.handle('import-files-to-project', async (_, files, projectName) => {
  log(`Importing dropped files to LPOS project: ${projectName}`);
  if (!Array.isArray(files) || !files.length || !projectName) return buildImportResult();
  try {
    return await lposBridge.importFilesToProject(files, projectName);
  } catch (err) {
    error('Failed to import files to LPOS:', err);
    return buildImportResult();
  }
});

ipcMain.handle('import-folders-data-as-projects', async (_, folders) => {
  if (!Array.isArray(folders)) return buildImportResult();

  let importedCount = 0;
  let renamedCount = 0;

  for (const folder of folders) {
    if (!folder || !folder.name || !Array.isArray(folder.files)) continue;
    const baseName = sanitizeFilename(folder.name);
    if (!baseName) continue;

    let projectName = baseName;
    let destDir = path.join(getProjectsPath(), projectName);
    const metadata = getProjectMetadata();
    if (
      fs.existsSync(destDir) ||
      metadata.projects.some((p) => p.name === projectName)
    ) {
      let counter = 1;
      while (
        fs.existsSync(path.join(getProjectsPath(), `${baseName}-${counter}`)) ||
        metadata.projects.some((p) => p.name === `${baseName}-${counter}`)
      ) {
        counter++;
      }
      projectName = `${baseName}-${counter}`;
      destDir = path.join(getProjectsPath(), projectName);
      dialog.showMessageBox({
        type: 'info',
        title: 'Project Exists',
        message: `Project "${baseName}" already exists. Imported as "${projectName}".`,
      });
    }

    try {
      await ensureProjectDirectory(projectName);
      for (const file of folder.files) {
        if (!file || !file.name || !file.data) continue;
        try {
          const buffer = Buffer.from(file.data);
          const imported = await importBufferToProject(destDir, file.name, buffer);
          if (!imported) continue;
          importedCount++;
          if (imported.renamed) renamedCount++;
        } catch (err) {
          error('Failed to import file from folder:', err);
        }
      }
    } catch (err) {
      error('Failed to import folder as project:', err);
    }
  }

  invalidateProjectListCache();
  return buildImportResult(importedCount, renamedCount);
});

ipcMain.handle('filter-directories', async (_, paths) => {
  const dirs = [];
  if (!Array.isArray(paths)) return dirs;
  for (const p of paths) {
    if (!p || typeof p !== 'string') continue;
    try {
      const stat = await fs.promises.lstat(p);
      if (stat.isDirectory()) dirs.push(p);
    } catch {
      // ignore
    }
  }
  return dirs;
});

ipcMain.handle('import-folders-as-projects', async (_, folderPaths) => {
  if (!Array.isArray(folderPaths)) return buildImportResult();

  let importedCount = 0;
  let renamedCount = 0;

  for (const folder of folderPaths) {
    if (!folder || typeof folder !== 'string') continue;
    let stats;
    try {
      stats = await fs.promises.stat(folder);
    } catch {
      stats = null;
    }
    if (!stats || !stats.isDirectory()) continue;
    const baseName = sanitizeFilename(path.basename(folder));
    if (!baseName) continue;

    const metadata = getProjectMetadata();
    let projectName = baseName;
    let destDir = path.join(getProjectsPath(), projectName);
    if (
      fs.existsSync(destDir) ||
      metadata.projects.some((p) => p.name === projectName)
    ) {
      let counter = 1;
      while (
        fs.existsSync(path.join(getProjectsPath(), `${baseName}-${counter}`)) ||
        metadata.projects.some((p) => p.name === `${baseName}-${counter}`)
      ) {
        counter++;
      }
      projectName = `${baseName}-${counter}`;
      destDir = path.join(getProjectsPath(), projectName);
      dialog.showMessageBox({
        type: 'info',
        title: 'Project Exists',
        message: `Project "${baseName}" already exists. Imported as "${projectName}".`,
      });
    }

    try {
      await ensureProjectDirectory(projectName);
      const entries = await fs.promises.readdir(folder, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile() || !isSupportedImportName(entry.name)) continue;
        const src = path.join(folder, entry.name);
        try {
          const imported = await importPathToProject(destDir, src);
          if (!imported) continue;
          log(`Imported script: ${imported.fileName} -> ${imported.destPath}`);
          importedCount++;
          if (imported.renamed) renamedCount++;
        } catch (err) {
          error(`Failed to import file ${src}:`, err);
        }
      }
    } catch (err) {
      error('Failed to import folder', folder, err);
    }
  }

  invalidateProjectListCache();
  return buildImportResult(importedCount, renamedCount);
});

  ipcMain.handle('get-projects', () => {
    log('Fetching list of projects');
    const metadata = getProjectMetadata();
    return metadata.projects.filter((p) => !p.archived).map((p) => p.name);
  });

  ipcMain.handle('get-project-settings', (_, project) => readProjectSettings(project));
  ipcMain.handle('save-project-settings', (_, project, settings) =>
    writeProjectSettings(project, settings)
  );

  ipcMain.handle('get-scripts-for-project', async (_, projectName) => {
    log(`Fetching scripts for project (LPOS): ${projectName}`);
    try {
      return await lposBridge.getScriptsForProject(projectName);
    } catch (err) {
      error('Failed to get scripts:', err);
      return [];
    }
  });

  ipcMain.handle('load-script', async (_, projectName, scriptName) => {
    log(`Loading script from LPOS: ${scriptName} in ${projectName}`);
    try {
      return await lposBridge.loadScript(projectName, scriptName);
    } catch (err) {
      error('Failed to load script:', err);
      return null;
    }
  });

  ipcMain.handle('save-script', async (_, { projectName, scriptName, html }) => {
    log(`Saving script to LPOS: ${scriptName} in ${projectName}`);
    try {
      return await lposBridge.saveScript(projectName, scriptName, html);
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
      invalidateProjectListCache();
      return true;
    } catch (err) {
      error('Failed to save script order:', err);
      return false;
    }
  });

  ipcMain.handle('reorder-projects', async (_, order) => {
    log('Reordering projects');
    if (!Array.isArray(order)) return false;
    try {
      const metadata = getProjectMetadata();
      const existing = new Map(metadata.projects.map((project) => [project.name, project]));
      const reordered = [];

      for (const name of order) {
        const project = existing.get(name);
        if (!project) continue;
        reordered.push(project);
        existing.delete(name);
      }

      for (const project of metadata.projects) {
        if (existing.has(project.name)) {
          reordered.push(project);
          existing.delete(project.name);
        }
      }

      metadata.projects = reordered;
      saveProjectMetadata(metadata);
      invalidateProjectListCache();
      return true;
    } catch (err) {
      error('Failed to save project order:', err);
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

        invalidateProjectListCache();
        return true;
      } catch (err) {
        error('Failed to move script:', err);
        return false;
      }
    },
  );

  ipcMain.handle('delete-script', async (_, projectName, scriptName) => {
    log(`Deleting script from LPOS: ${scriptName} in ${projectName}`);
    try {
      return await lposBridge.deleteScript(projectName, scriptName);
    } catch (err) {
      error('Failed to delete script:', err);
      return false;
    }
  });

  ipcMain.handle('export-script', async (_, projectName, scriptName, format) => {
    if (!projectName || !scriptName || !['docx', 'pdf'].includes(format)) {
      return { success: false };
    }

    try {
      const defaultPath = path.join(
        app.getPath('documents'),
        stripExtension(scriptName) + '.' + format,
      );
      const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
        title: 'Export ' + stripExtension(scriptName),
        defaultPath,
        filters: [{ name: format.toUpperCase(), extensions: [format] }],
      });

      if (canceled || !filePath) {
        return { success: false, canceled: true };
      }

      await exportScriptFile(projectName, scriptName, format, filePath);
      return { success: true, filePath };
    } catch (err) {
      error('Failed to export script:', err);
      return { success: false, error: err.message };
    }
  });
  ipcMain.handle('export-speech-follow-snapshot', async (_, payload = {}) => {
    try {
      const exportedAt = new Date().toISOString();
      const snapshotBaseName = sanitizeSnapshotBaseName(
        payload.projectName || payload.snapshotName || 'speech-follow-snapshot',
      );
      const snapshotDirectory = getSpeechSnapshotPath();
      const filePath = path.join(
        snapshotDirectory,
        `${snapshotBaseName}-${Date.now()}.json`,
      );

      const snapshotPayload = {
        appVersion: app.getVersion(),
        exportedAt,
        ...payload,
      };
      await writeSpeechFollowSnapshot(snapshotPayload, filePath);
      return { success: true, filePath, snapshotDirectory };
    } catch (err) {
      error('Failed to export speech follow snapshot:', err);
      return { success: false, error: err.message };
    }
  });
  ipcMain.handle(
    'rewrite-selection',
    async (event, id, text, modifier, context) => {
      const controller = new AbortController();
      rewriteControllers.set(id, controller);
      try {
        if (!text) return [];
      const truncated = text.slice(0, 1000);
      const ctx = typeof context === 'string' ? context.trim() : '';
      const contextTruncated = ctx ? ctx.slice(0, 1000) : '';
      const userContent = contextTruncated
        ? `${truncated}\nContext: ${contextTruncated}`
        : truncated;
      const style = typeof modifier === 'string' ? modifier.trim() : '';
      log(`Rewrite selection request length: ${text.length}`);
      const apiKey = OPENAI_API_KEY;
      if (!apiKey) {
        log('OpenAI API key not set');
        return { error: 'Missing OpenAI API key' };
      }
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: OPENAI_MODEL,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: REWRITE_PROMPT },
            ...(style
              ? [{ role: 'system', content: `Rewrite the text to sound ${style}.` }]
              : []),
            { role: 'user', content: userContent },
          ],
        }),
        signal: controller.signal,
      });
      if (res.status === 429) {
        warn('Rewrite selection rate limited (429)');
        return { error: 'Rate limit exceeded' };
      }
      if (!res.ok) {
        error('Rewrite selection request failed:', res.statusText);
        return { error: 'Request failed' };
      }
      const data = await res.json();
      const content = data.choices?.[0]?.message?.content?.trim();
      if (!content) return { error: 'No suggestions' };
      try {
        const parsed = JSON.parse(content);
        const suggestions = Array.isArray(parsed)
          ? parsed
          : parsed.suggestions;
        if (
          !Array.isArray(suggestions) ||
          suggestions.length !== 3 ||
          !suggestions.every((s) => typeof s === 'string')
        ) {
          throw new Error('Expected array of 3 strings');
        }
        const selectionWordCount = truncated
          .trim()
          .split(/\s+/)
          .filter(Boolean).length;
        const normalized =
          selectionWordCount <= 2
            ? suggestions.map((s) =>
                s
                  .split(/\s+/)
                  .slice(0, selectionWordCount)
                  .join(' '),
              )
            : suggestions;
        return normalized;
      } catch (err) {
        error('Failed to parse suggestions:', err);
        return { error: 'Invalid response format' };
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        log('Rewrite selection aborted');
        return [];
      }
      error('Rewrite selection failed:', err);
      return { error: 'Request failed' };
    } finally {
      rewriteControllers.delete(id);
    }
  });

  ipcMain.on('rewrite-selection-abort', (event, id) => {
    const ctrl = rewriteControllers.get(id);
    if (ctrl) {
      ctrl.abort();
      rewriteControllers.delete(id);
    }
  });

  ipcMain.handle('check-for-updates', () => {
    if (!ENABLE_AUTO_UPDATES) {
      log('Auto updates disabled');
      return null
    }
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

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('quit', () => {
  log('App quitting');
  stopViteServer();
  stopLposPolling();
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

















