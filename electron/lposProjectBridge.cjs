/**
 * lposProjectBridge.cjs
 *
 * Makes LeaderPrompt use LPOS as the source of truth for projects and scripts.
 *
 * Cache layout (~/leaderprompt/):
 *   lpos-raw-cache.json               – last good LPOS project+script snapshot
 *   lpos-archive.json                 – LP-only archive flags (never sent to LPOS)
 *   cache/{projectId}/{scriptId}.docx – working copy of each script
 *
 * In-memory index lets handlers keep their existing (projectName, scriptName)
 * string interface without changes to FileManager or ScriptViewer.
 *
 * Sync flow summary:
 *   LPOS → LP : poll every 30 s; detects project adds/removes and script
 *               adds/removes/content-changes via updatedAt comparison.
 *   LP → LPOS : every write op (createProject, saveScript, deleteScript, etc.)
 *               immediately calls the relevant LPOS API endpoint.
 *   Archive    : LP-only flag stored in lpos-archive.json — LPOS never sees it.
 */

'use strict';

const { app }    = require('electron');
const path       = require('path');
const fs         = require('fs');
const mammoth    = require('mammoth');
const htmlToDocx = require('html-to-docx');

// ── Paths ─────────────────────────────────────────────────────────────────────

const getUserDataPath    = () => path.join(app.getPath('home'), 'leaderprompt');
const getRawCachePath    = () => path.join(getUserDataPath(), 'lpos-raw-cache.json');
const getArchiveFlagsPath= () => path.join(getUserDataPath(), 'lpos-archive.json');
const getScriptCacheDir  = (projectId) => path.join(getUserDataPath(), 'cache', projectId);
const getScriptCachePath = (projectId, scriptId) =>
  path.join(getScriptCacheDir(projectId), `${scriptId}.docx`);
const getLposSyncConfigPath = () => path.join(getUserDataPath(), 'lpos-sync.json');

// ── Config ────────────────────────────────────────────────────────────────────

function readSyncConfig() {
  try {
    const p = getLposSyncConfigPath();
    if (!fs.existsSync(p)) return { serverUrl: '', apiToken: '' };
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch { return { serverUrl: '', apiToken: '' }; }
}

function getBaseUrl() {
  return readSyncConfig().serverUrl?.trim().replace(/\/$/, '') || null;
}

function getApiToken() {
  return readSyncConfig().apiToken?.trim() || null;
}

// ── Connection state ──────────────────────────────────────────────────────────

let lposConnected = false;
const connectionListeners = [];

function setConnected(val) {
  if (lposConnected === val) return;
  lposConnected = val;
  connectionListeners.forEach((cb) => cb(val));
}

function onConnectionChange(cb) {
  connectionListeners.push(cb);
  return () => {
    const i = connectionListeners.indexOf(cb);
    if (i !== -1) connectionListeners.splice(i, 1);
  };
}

function isConnected() { return lposConnected; }

// ── Socket.io push listener (LPOS → LP) ──────────────────────────────────────
// Replaces the 30-second poll for content changes with instant push.
// LP→LPOS direction is already immediate via HTTP PUT; this covers the reverse.
//
// Loop prevention: when LP saves a script it stores the LPOS-assigned updatedAt
// from the PUT response. If a scripts:changed event arrives with the same
// updatedAt, we know LP triggered it and silently skip to avoid a needless
// re-download of the same bytes.

let ioSocket = null;
let socketConnectUrl = null;
const scriptChangedListeners = [];

function onScriptChangedPush(cb) {
  scriptChangedListeners.push(cb);
  return () => {
    const i = scriptChangedListeners.indexOf(cb);
    if (i !== -1) scriptChangedListeners.splice(i, 1);
  };
}

function fireScriptChangedPush(projectName) {
  scriptChangedListeners.forEach((cb) => cb(projectName));
}

function startSocket() {
  const base = getBaseUrl();
  if (!base) return;
  if (ioSocket && socketConnectUrl === base) return; // already connected to this server
  stopSocket();
  socketConnectUrl = base;

  // socket.io-client is an Electron dependency, loaded lazily so it doesn't
  // break anything if the package isn't installed in older environments.
  let io;
  try { ({ io } = require('socket.io-client')); }
  catch { return; } // package not available — fall back to poll-only

  const token = getApiToken();
  ioSocket = io(base, {
    transports:          ['websocket'],
    auth:                token ? { token } : {},
    reconnection:        true,
    reconnectionDelay:   2000,
    reconnectionDelayMax: 30000,
  });

  ioSocket.on('scripts:changed', ({ projectId, scriptId, updatedAt }) => {
    for (const [projectName, entry] of Object.entries(lposIndex)) {
      if (entry.projectId !== projectId) continue;
      for (const [, sEntry] of Object.entries(entry.scripts || {})) {
        if (sEntry.scriptId !== scriptId) continue;
        // Skip if we already have this exact version (LP triggered this save)
        if (updatedAt && updatedAt === sEntry.updatedAt) return;
        if (updatedAt) sEntry.updatedAt = updatedAt;
        fireScriptChangedPush(projectName);
        return;
      }
    }
  });
}

function stopSocket() {
  if (ioSocket) {
    ioSocket.disconnect();
    ioSocket = null;
    socketConnectUrl = null;
  }
}

// ── LP-only archive flags (never synced to LPOS) ──────────────────────────────
// Stored as { [projectName]: archivedAtTimestamp }

function readArchiveFlags() {
  try {
    const p = getArchiveFlagsPath();
    if (!fs.existsSync(p)) return {};
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch { return {}; }
}

function writeArchiveFlags(flags) {
  try {
    fs.mkdirSync(getUserDataPath(), { recursive: true });
    fs.writeFileSync(getArchiveFlagsPath(), JSON.stringify(flags, null, 2));
  } catch {}
}

// ── In-memory index ───────────────────────────────────────────────────────────
// projectName → { projectId, added,
//                 scripts: { "ScriptName.docx": { scriptId, updatedAt } } }
// Note: archived/archivedAt are NOT stored here — they come from lpos-archive.json

let lposIndex = {};

// ── Raw cache ─────────────────────────────────────────────────────────────────

function saveRawCache(raw) {
  try {
    fs.mkdirSync(getUserDataPath(), { recursive: true });
    fs.writeFileSync(getRawCachePath(), JSON.stringify(raw, null, 2));
  } catch {}
}

function readRawCache() {
  try {
    const p = getRawCachePath();
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch { return null; }
}

// ── Build index from raw LPOS data ────────────────────────────────────────────

function buildIndexFromRaw(raw) {
  const index = {};
  for (const p of raw.projects || []) {
    const scripts = (raw.scripts || {})[p.projectId] || [];
    const scriptMap = {};
    for (const s of scripts) {
      // LP identifies scripts by a .docx filename — derive from LPOS display name
      const lpFilename = s.name.endsWith('.docx') ? s.name : `${s.name}.docx`;
      scriptMap[lpFilename] = { scriptId: s.scriptId, updatedAt: s.updatedAt };
    }
    index[p.name] = {
      projectId: p.projectId,
      added:     p.createdAt ? new Date(p.createdAt).getTime() : Date.now(),
      scripts:   scriptMap,
      // archived is intentionally NOT stored — LP owns that flag locally
    };
  }
  return index;
}

// ── Convert index → LP getAllProjectsWithScripts format ───────────────────────

function indexToLpFormat() {
  const archiveFlags = readArchiveFlags();
  return Object.entries(lposIndex).map(([name, p]) => ({
    name,
    archived:   name in archiveFlags,
    archivedAt: archiveFlags[name] || 0,
    added:      p.added,
    scripts:    Object.keys(p.scripts).map((filename) => ({ name: filename })),
  }));
}

// ── LPOS HTTP helper ──────────────────────────────────────────────────────────

async function lposFetch(urlPath, options = {}) {
  const base  = getBaseUrl();
  if (!base) throw new Error('LPOS server URL not configured');
  const token = getApiToken();
  const headers = {
    ...(options.headers ?? {}),
    ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
  };
  return fetch(`${base}${urlPath}`, { ...options, headers, signal: AbortSignal.timeout(10000) });
}

// ── Change detection snapshot ─────────────────────────────────────────────────
// Captures { projectName → { filename → updatedAt } } so we can detect
// both structural changes (added/removed scripts) and content changes.

function snapshotScripts() {
  const snap = {};
  for (const [name, entry] of Object.entries(lposIndex)) {
    const map = {};
    for (const [filename, info] of Object.entries(entry.scripts || {})) {
      map[filename] = info.updatedAt;
    }
    snap[name] = map;
  }
  return snap;
}

// ── Fetch + refresh ───────────────────────────────────────────────────────────

async function refreshProjects() {
  const prevNames   = new Set(Object.keys(lposIndex));
  const prevScripts = snapshotScripts();

  try {
    const res = await lposFetch('/api/projects');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { projects } = await res.json();

    const scriptFetches = await Promise.all(
      projects.map(async (p) => {
        try {
          const sr = await lposFetch(`/api/projects/${p.projectId}/scripts`);
          if (!sr.ok) return [p.projectId, []];
          const d = await sr.json();
          return [p.projectId, d.scripts || []];
        } catch { return [p.projectId, []]; }
      }),
    );

    const raw = { projects, scripts: Object.fromEntries(scriptFetches) };
    saveRawCache(raw);
    lposIndex = buildIndexFromRaw(raw);
    setConnected(true);

    const newNames = new Set(Object.keys(lposIndex));

    // Project-level changes: any project added or removed
    const projectsChanged =
      newNames.size !== prevNames.size ||
      [...newNames].some((n) => !prevNames.has(n)) ||
      [...prevNames].some((n) => !newNames.has(n));

    // Script-level changes: within existing projects, detect additions,
    // removals, or content updates (updatedAt changed)
    const scriptsChangedFor = [];
    for (const [name, entry] of Object.entries(lposIndex)) {
      const prev = prevScripts[name];
      if (!prev) continue; // new project — covered by projectsChanged
      const curr = entry.scripts || {};
      const changed =
        Object.keys(curr).length !== Object.keys(prev).length ||
        Object.entries(curr).some(([k, v]) =>
          prev[k] === undefined || prev[k] !== v.updatedAt,
        );
      if (changed) scriptsChangedFor.push(name);
    }

    return { projects: indexToLpFormat(), projectsChanged, scriptsChangedFor };
  } catch {
    setConnected(false);
    const cached = readRawCache();
    if (cached) lposIndex = buildIndexFromRaw(cached);
    return { projects: indexToLpFormat(), projectsChanged: false, scriptsChangedFor: [] };
  }
}

// ── Index lookup helpers ──────────────────────────────────────────────────────

function getProjectEntry(projectName) {
  return lposIndex[projectName] || null;
}

function getScriptEntry(projectName, scriptFilename) {
  return lposIndex[projectName]?.scripts?.[scriptFilename] || null;
}

// ── Public API ────────────────────────────────────────────────────────────────

async function getAllProjects() {
  if (Object.keys(lposIndex).length === 0) {
    const { projects } = await refreshProjects();
    return projects;
  }
  // Return cached index immediately; refresh in background
  void refreshProjects();
  return indexToLpFormat();
}

async function getScriptsForProject(projectName) {
  const entry = getProjectEntry(projectName);
  if (!entry) return [];
  return Object.keys(entry.scripts);
}

async function loadScript(projectName, scriptFilename) {
  const entry  = getProjectEntry(projectName);
  const sEntry = getScriptEntry(projectName, scriptFilename);
  if (!entry || !sEntry) return null;

  const cachePath = getScriptCachePath(entry.projectId, sEntry.scriptId);

  // Must download if no local copy exists
  let needsDownload = !fs.existsSync(cachePath);

  // Must re-download if LPOS has a newer version than our cached file.
  // Compare LPOS's updatedAt timestamp against the local file's mtime —
  // this is reliable because we always update the file mtime on write.
  if (!needsDownload && sEntry.updatedAt) {
    try {
      const fileMtime = fs.statSync(cachePath).mtime;
      if (new Date(sEntry.updatedAt) > fileMtime) needsDownload = true;
    } catch { needsDownload = true; }
  }

  if (needsDownload && isConnected()) {
    try {
      const res = await lposFetch(
        `/api/projects/${entry.projectId}/scripts/${sEntry.scriptId}/file`,
      );
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        fs.mkdirSync(getScriptCacheDir(entry.projectId), { recursive: true });
        fs.writeFileSync(cachePath, buf);
        // mtime is now fresh — no need to touch sEntry.updatedAt
      }
    } catch {}
  }

  if (!fs.existsSync(cachePath)) return null;
  try {
    const result = await mammoth.convertToHtml({ path: cachePath });
    return result.value;
  } catch { return null; }
}

async function saveScript(projectName, scriptFilename, html) {
  const entry  = getProjectEntry(projectName);
  const sEntry = getScriptEntry(projectName, scriptFilename);
  if (!entry || !sEntry) return false;

  try {
    const buffer    = await htmlToDocx(html);
    const cachePath = getScriptCachePath(entry.projectId, sEntry.scriptId);
    fs.mkdirSync(getScriptCacheDir(entry.projectId), { recursive: true });
    fs.writeFileSync(cachePath, buffer);
    // mtime is now updated — future staleness check will be correct

    // Push to LPOS immediately (fail silently if offline)
    if (isConnected()) {
      try {
        const res = await lposFetch(
          `/api/projects/${entry.projectId}/scripts/${sEntry.scriptId}/file`,
          {
            method:  'PUT',
            body:    buffer,
            headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
          },
        );
        // Store LPOS's authoritative updatedAt so the socket loop-prevention
        // check can match it exactly when the scripts:changed event arrives.
        if (res.ok) {
          try {
            const data = await res.json();
            if (data?.updatedAt) sEntry.updatedAt = data.updatedAt;
          } catch {
            // LPOS may not return a body — use current file mtime as proxy
            sEntry.updatedAt = new Date(fs.statSync(cachePath).mtime).toISOString();
          }
        }
      } catch {}
    }
    return true;
  } catch { return false; }
}

function getClientNames() {
  const raw = readRawCache();
  if (!raw?.projects?.length) return [];
  const names = raw.projects
    .map((p) => (p.clientName || '').trim())
    .filter(Boolean);
  return [...new Set(names)].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

async function createProject(name, clientName = '') {
  const base = getBaseUrl();
  if (!base) return false;
  try {
    const res = await lposFetch('/api/projects', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ name, clientName: clientName.trim() }),
    });
    if (!res.ok) return false;
    await refreshProjects();
    return true;
  } catch { return false; }
}

async function renameProject(oldName, newName) {
  const entry = getProjectEntry(oldName);
  if (!entry) return false;
  try {
    const res = await lposFetch(`/api/projects/${entry.projectId}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ name: newName }),
    });
    if (!res.ok) return false;
    // Migrate any archive flag to the new name
    const flags = readArchiveFlags();
    if (oldName in flags) {
      flags[newName] = flags[oldName];
      delete flags[oldName];
      writeArchiveFlags(flags);
    }
    await refreshProjects();
    return true;
  } catch { return false; }
}

async function deleteProject(projectName) {
  const entry = getProjectEntry(projectName);
  if (!entry) return false;
  try {
    const res = await lposFetch(`/api/projects/${entry.projectId}`, { method: 'DELETE' });
    if (!res.ok) return false;
    // Clean local cache and archive flag
    try {
      const cacheDir = getScriptCacheDir(entry.projectId);
      if (fs.existsSync(cacheDir)) fs.rmSync(cacheDir, { recursive: true, force: true });
    } catch {}
    const flags = readArchiveFlags();
    if (projectName in flags) { delete flags[projectName]; writeArchiveFlags(flags); }
    await refreshProjects();
    return true;
  } catch { return false; }
}

// Archive is LP-only — never touches LPOS
function setProjectArchived(projectName, archived) {
  const flags = readArchiveFlags();
  if (archived) {
    flags[projectName] = Date.now();
  } else {
    delete flags[projectName];
  }
  writeArchiveFlags(flags);
  return true; // synchronous, always succeeds locally
}

async function createScript(projectName, scriptDisplayName) {
  const entry = getProjectEntry(projectName);
  if (!entry) return { success: false };
  try {
    const buffer   = await htmlToDocx('<p></p>', null, {});
    const formData = new FormData();
    formData.append('file', new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    }), `${scriptDisplayName}.docx`);

    const res = await lposFetch(
      `/api/projects/${entry.projectId}/scripts`,
      { method: 'POST', body: formData, signal: AbortSignal.timeout(15000) },
    );
    if (!res.ok) return { success: false };
    const data = await res.json();
    await refreshProjects();
    const finalName = data.script?.name
      ? (data.script.name.endsWith('.docx') ? data.script.name : `${data.script.name}.docx`)
      : `${scriptDisplayName}.docx`;
    return { success: true, scriptName: finalName };
  } catch { return { success: false }; }
}

async function renameScript(projectName, oldFilename, newDisplayName) {
  const entry  = getProjectEntry(projectName);
  const sEntry = getScriptEntry(projectName, oldFilename);
  if (!entry || !sEntry) return false;
  try {
    const res = await lposFetch(
      `/api/projects/${entry.projectId}/scripts/${sEntry.scriptId}`,
      {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ name: newDisplayName }),
      },
    );
    if (!res.ok) return false;
    await refreshProjects();
    return true;
  } catch { return false; }
}

async function deleteScript(projectName, scriptFilename) {
  const entry  = getProjectEntry(projectName);
  const sEntry = getScriptEntry(projectName, scriptFilename);
  if (!entry || !sEntry) return false;
  try {
    const res = await lposFetch(
      `/api/projects/${entry.projectId}/scripts/${sEntry.scriptId}?deleteFile=true`,
      { method: 'DELETE' },
    );
    if (!res.ok) return false;
    try { fs.unlinkSync(getScriptCachePath(entry.projectId, sEntry.scriptId)); } catch {}
    await refreshProjects();
    return true;
  } catch { return false; }
}

async function importFilesToProject(files, projectName) {
  const entry = getProjectEntry(projectName);
  if (!entry) return { importedCount: 0, renamedCount: 0 };

  let importedCount = 0;
  for (const file of files) {
    try {
      const buf      = Buffer.from(file.data);
      const formData = new FormData();
      formData.append(
        'file',
        new Blob([buf], { type: file.type || 'application/octet-stream' }),
        file.name,
      );
      const res = await lposFetch(
        `/api/projects/${entry.projectId}/scripts`,
        { method: 'POST', body: formData, signal: AbortSignal.timeout(30000) },
      );
      if (res.ok) importedCount++;
    } catch {}
  }
  if (importedCount > 0) await refreshProjects();
  return { importedCount, renamedCount: 0 };
}

// Returns the local cache path for a script (used by export-script handler)
function getLocalScriptPath(projectName, scriptFilename) {
  const entry  = getProjectEntry(projectName);
  const sEntry = getScriptEntry(projectName, scriptFilename);
  if (!entry || !sEntry) return null;
  return getScriptCachePath(entry.projectId, sEntry.scriptId);
}

// ── LP update check ───────────────────────────────────────────────────────────

async function checkLpUpdate() {
  try {
    const res = await lposFetch('/api/lp-updates/version');
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

module.exports = {
  refreshProjects,
  getAllProjects,
  getClientNames,
  getScriptsForProject,
  loadScript,
  saveScript,
  createProject,
  renameProject,
  deleteProject,
  setProjectArchived,
  createScript,
  renameScript,
  deleteScript,
  importFilesToProject,
  getLocalScriptPath,
  onConnectionChange,
  isConnected,
  startSocket,
  stopSocket,
  onScriptChangedPush,
  checkLpUpdate,
};
