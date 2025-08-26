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
  console.log('Parsing data transfer items');
  const items = Array.from(dataTransfer?.items || []);
  console.log(
    'DataTransfer items',
    items.map((i) => ({ kind: i.kind, type: i.type })),
  );
  console.log(
    'DataTransfer files',
    Array.from(dataTransfer?.files || []).map((f) => ({ name: f.name, type: f.type })),
  );
  const folders = [];
  const files = [];
  if (!items.length && dataTransfer?.files?.length) {
    files.push(...Array.from(dataTransfer.files));
    console.log(
      'Parsed items via files fallback',
      files.map((f) => ({ name: f.name, type: f.type })),
    );
    return { folders, files };
  }
  for (const item of items) {
    if (item.kind !== 'file') {
      console.log('Skipping non-file item', { kind: item.kind, type: item.type });
      continue;
    }
    console.log('Processing item', { kind: item.kind, type: item.type });
    let handle = null;
    if (item.getAsFileSystemHandle) {
      try {
        handle = await item.getAsFileSystemHandle();
      } catch {
        handle = null;
      }
    } else if (item.webkitGetAsEntry) {
      handle = item.webkitGetAsEntry();
    }
    if (handle && (handle.kind === 'directory' || handle.isDirectory)) {
      console.log('Reading directory', handle.name);
      const dirFiles = await readAllFiles(handle);
      folders.push({ name: handle.name, files: dirFiles });
      files.push(...dirFiles);
      console.log(
        'Directory files',
        dirFiles.map((f) => ({ name: f.name, type: f.type })),
      );
    } else {
      const file = item.getAsFile
        ? item.getAsFile()
        : handle?.getFile
          ? await handle.getFile()
          : null;
      if (file) {
        console.log('Adding file', { name: file.name, type: file.type });
        files.push(file);
      } else {
        console.log('No file obtained from item');
      }
    }
  }
  console.log(
    'Parsed items result',
    {
      folders: folders.map((f) => ({
        name: f.name,
        files: f.files.map((fl) => ({ name: fl.name, type: fl.type })),
      })),
      files: files.map((f) => ({ name: f.name, type: f.type })),
    },
  );
  return { folders, files };
};
