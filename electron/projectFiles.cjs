const fs = require('fs');
const path = require('path');

function sanitizeFilename(name) {
  if (!name || typeof name !== 'string') return null;
  const base = path.basename(name);
  const sanitized = base.replace(/[\\/:*?"<>|]/g, '_').trim();
  if (!sanitized || sanitized === '.' || sanitized === '..') return null;
  return sanitized;
}

function ensureDocxExtension(name) {
  return name.toLowerCase().endsWith('.docx') ? name : `${name}.docx`;
}

function stripDocxExtension(name) {
  return name.replace(/\.docx$/i, '');
}

async function readJsonFile(filePath, fallback) {
  try {
    const raw = await fs.promises.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function readScriptOrder(projectDir) {
  const orderPath = path.join(projectDir, 'scripts.json');
  const data = await readJsonFile(orderPath, {});
  return Array.isArray(data.order) ? data.order : [];
}

async function resolveUniqueDocxName(projectDir, desiredName, options = {}) {
  const safeName = sanitizeFilename(desiredName);
  if (!safeName) return null;

  const normalized = ensureDocxExtension(safeName);
  const rootName = stripDocxExtension(normalized);
  const excludedLower = options.excludeName?.toLowerCase() || null;

  let entries = [];
  try {
    entries = await fs.promises.readdir(projectDir);
  } catch {
    entries = [];
  }

  const usedRoots = new Set(
    entries
      .filter((entry) => entry.toLowerCase().endsWith('.docx'))
      .filter((entry) => entry.toLowerCase() !== excludedLower)
      .map((entry) => stripDocxExtension(entry).toLowerCase()),
  );

  let candidate = rootName;
  let counter = 1;
  while (usedRoots.has(candidate.toLowerCase())) {
    candidate = `${rootName} ${counter}`;
    counter += 1;
  }

  return ensureDocxExtension(candidate);
}

async function buildProjectListing(baseDir, metadata) {
  let dirEntries = [];
  try {
    dirEntries = await fs.promises.readdir(baseDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const metadataMap = new Map(
    (metadata.projects || []).map((project) => [project.name, project]),
  );

  const discoveredProjects = await Promise.all(
    dirEntries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const projectName = entry.name;
        const scriptsDir = path.join(baseDir, projectName);
        const [files, order] = await Promise.all([
          fs.promises.readdir(scriptsDir, { withFileTypes: true }),
          readScriptOrder(scriptsDir),
        ]);

        const scriptFiles = files.filter(
          (file) => file.isFile() && file.name.toLowerCase().endsWith('.docx'),
        );

        const scripts = await Promise.all(
          scriptFiles.map(async (file) => {
            const stats = await fs.promises.stat(path.join(scriptsDir, file.name));
            const added = stats.birthtimeMs || stats.ctimeMs || stats.mtimeMs;
            return { name: file.name, added };
          }),
        );

        const remaining = new Map(scripts.map((script) => [script.name, script]));
        const ordered = [];

        for (const name of order) {
          if (!remaining.has(name)) continue;
          ordered.push(remaining.get(name));
          remaining.delete(name);
        }

        for (const script of remaining.values()) {
          ordered.push(script);
        }

        const metadataEntry = metadataMap.get(projectName) || {};

        return {
          name: projectName,
          scripts: ordered,
          added: metadataEntry.added || 0,
          archived: !!metadataEntry.archived,
          archivedAt: metadataEntry.archivedAt || 0,
        };
      }),
  );

  const discoveredMap = new Map(
    discoveredProjects.map((project) => [project.name, project]),
  );
  const orderedProjects = [];

  for (const entry of metadata.projects || []) {
    const project = discoveredMap.get(entry.name);
    if (!project) continue;
    orderedProjects.push(project);
    discoveredMap.delete(entry.name);
  }

  for (const project of discoveredProjects) {
    if (discoveredMap.has(project.name)) {
      orderedProjects.push(project);
      discoveredMap.delete(project.name);
    }
  }

  return orderedProjects;
}

module.exports = {
  buildProjectListing,
  ensureDocxExtension,
  readJsonFile,
  readScriptOrder,
  resolveUniqueDocxName,
  sanitizeFilename,
};
