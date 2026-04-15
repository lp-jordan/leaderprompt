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
  const itemList = Array.from(dataTransfer?.items || []);
  const fileList = Array.from(dataTransfer?.files || []);

  const folders = [];
  const files = [];

  if (!itemList.length && fileList.length) {
    files.push(...fileList);
    return { folders, files };
  }

  for (let index = 0; index < itemList.length; index++) {
    const item = itemList[index];
    if (item.kind !== 'file') {
      continue;
    }

    let handle = null;
    if (item.getAsFileSystemHandle) {
      try { handle = await item.getAsFileSystemHandle(); } catch { handle = null; }
    } else if (item.webkitGetAsEntry) {
      handle = item.webkitGetAsEntry();
    }

    if (handle && (handle.kind === 'directory' || handle.isDirectory)) {
      const dirFiles = await readAllFiles(handle);
      folders.push({ name: handle.name, files: dirFiles });
      files.push(...dirFiles);
      continue;
    }

    let file = typeof item.getAsFile === 'function' ? item.getAsFile() : null;
    if (!file && handle?.getFile) {
      try { file = await handle.getFile(); } catch {}
    }
    if (!file) {
      const fallback = fileList[index] || fileList[0];
      if (fallback) {
        files.push(fallback);
      }
    } else {
      files.push(file);
    }
  }

  if (!files.length && fileList.length) {
    files.push(...fileList);
  }

  return { folders, files };
};

export const isSupportedImportFile = (file) => {
  const name = typeof file === 'string' ? file : file?.name;
  const lowerName = name?.toLowerCase?.() || '';
  return lowerName.endsWith('.docx') || lowerName.endsWith('.pdf');
};

export const buildImportPayload = async (files) => {
  const supportedFiles = files.filter((file) => isSupportedImportFile(file));
  return Promise.all(
    supportedFiles.map(async (file) => ({
      name: file.name,
      data: await file.arrayBuffer(),
    })),
  );
};
