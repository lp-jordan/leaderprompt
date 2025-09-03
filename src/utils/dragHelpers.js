const DEBUG_DRAG =
  import.meta.env?.VITE_DEBUG_DRAG === 'true' && !import.meta.env?.PROD;

const debugLog = (...args) => {
  if (DEBUG_DRAG) console.log(...args);
};

export const readAllFiles = async (handle) => {
  const files = [];
  if (!handle) return files;
  if (handle.kind === 'file' || handle.isFile) {
    const file = handle.getFile
      ? await handle.getFile()
      : await new Promise((res, rej) => handle.file(res, rej));
    files.push(file);
  } else if (handle.kind === 'directory' || handle.isDirectory) {
    if (handle.entries) {
      for await (const [, child] of handle.entries()) {
        files.push(...(await readAllFiles(child)));
      }
    } else if (handle.values) {
      for await (const child of handle.values()) {
        files.push(...(await readAllFiles(child)));
      }
    } else if (handle.createReader) {
      const reader = handle.createReader();
      const readEntries = () => new Promise((resolve) => reader.readEntries(resolve));
      let entries = await readEntries();
      while (entries.length) {
        for (const entry of entries) {
          files.push(...(await readAllFiles(entry)));
        }
        entries = await readEntries();
      }
    }
  }
  return files;
};

export const parseDataTransferItems = async (dataTransfer) => {
  debugLog('Parsing data transfer items');

  // SNAPSHOT first; never touch dataTransfer after awaits
  const itemList = Array.from(dataTransfer?.items || []);
  const fileList = Array.from(dataTransfer?.files || []);

  debugLog('DataTransfer items', itemList.map(i => ({ kind: i.kind, type: i.type })));
  debugLog('DataTransfer files', fileList.map(f => ({ name: f.name, type: f.type })));

  const folders = [];
  const files = [];

  // Fast path: no items → just use files snapshot
  if (!itemList.length && fileList.length) {
    files.push(...fileList);
    debugLog('Parsed items via files fallback', files.map(f => ({ name: f.name, type: f.type })));
    return { folders, files };
  }

  for (let index = 0; index < itemList.length; index++) {
    const item = itemList[index];
    if (item.kind !== 'file') {
      debugLog('Skipping non-file item', { kind: item.kind, type: item.type });
      continue;
    }
    debugLog('Processing item', { kind: item.kind, type: item.type });

    // Try to get a handle (directory vs file detection)
    let handle = null;
    if (item.getAsFileSystemHandle) {
      try { handle = await item.getAsFileSystemHandle(); } catch { handle = null; }
    } else if (item.webkitGetAsEntry) {
      handle = item.webkitGetAsEntry();
    }

    if (handle && (handle.kind === 'directory' || handle.isDirectory)) {
      debugLog('Reading directory', handle.name);
      const dirFiles = await readAllFiles(handle);
      folders.push({ name: handle.name, files: dirFiles });
      files.push(...dirFiles);
      debugLog('Directory files', dirFiles.map(f => ({ name: f.name, type: f.type })));
      continue;
    }

    // File path
    let file = typeof item.getAsFile === 'function' ? item.getAsFile() : null;
    if (!file && handle?.getFile) {
      try { file = await handle.getFile(); } catch { /* ignore */ }
    }
    if (!file) {
      // IMPORTANT: use the SNAPSHOT, not dataTransfer.files[index]
      const fallback = fileList[index] || fileList[0]; // some platforms misalign indices
      if (fallback) {
        debugLog('Adding file via files snapshot fallback', { name: fallback.name, type: fallback.type });
        files.push(fallback);
      } else {
        debugLog('No file obtained from item');
      }
    } else {
      debugLog('Adding file', { name: file.name, type: file.type });
      files.push(file);
    }
  }

  // Last-resort safety: if nothing captured from items, but files exist, use them
  if (!files.length && fileList.length) {
    debugLog('Using files snapshot as last-resort fallback');
    files.push(...fileList);
  }

  debugLog('Parsed items result', {
    folders: folders.map(f => ({ name: f.name, files: f.files.map(fl => ({ name: fl.name, type: fl.type })) })),
    files: files.map(f => ({ name: f.name, type: f.type })),
  });

  return { folders, files };
};

export const buildDocxPayload = async (files) => {
  const docxFiles = files.filter((f) => f?.name?.toLowerCase().endsWith('.docx'));
  return Promise.all(
    docxFiles.map(async (file) => ({
      name: file.name,
      data: await file.arrayBuffer(),
    })),
  );
};
