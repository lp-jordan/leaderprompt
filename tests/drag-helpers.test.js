import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import {
  readAllFiles,
  parseDataTransferItems,
  buildImportPayload,
  isSupportedImportFile,
} from '../src/utils/dragHelpers.js';

test('readAllFiles recursively collects files from directories', async () => {
  const fileAHandle = {
    kind: 'file',
    async getFile() {
      return { name: 'a.txt', type: 'text/plain' };
    },
  };
  const fileBHandle = {
    kind: 'file',
    async getFile() {
      return { name: 'b.txt', type: 'text/plain' };
    },
  };
  const innerDirHandle = {
    kind: 'directory',
    async *entries() {
      yield ['fileB', fileBHandle];
    },
  };
  const rootDirHandle = {
    kind: 'directory',
    async *entries() {
      yield ['fileA', fileAHandle];
      yield ['inner', innerDirHandle];
    },
  };

  const files = await readAllFiles(rootDirHandle);
  assert.deepStrictEqual(
    files.map((f) => f.name).sort(),
    ['a.txt', 'b.txt'],
  );
});

test('parseDataTransferItems returns folders and files', async () => {
  const fileHandle = {
    kind: 'file',
    async getFile() {
      return { name: 'inner.txt', type: 'text/plain' };
    },
  };
  const dirHandle = {
    kind: 'directory',
    name: 'root',
    async *entries() {
      yield ['inner.txt', fileHandle];
    },
  };
  const folderItem = {
    kind: 'file',
    type: '',
    async getAsFileSystemHandle() {
      return dirHandle;
    },
  };
  const fileItem = {
    kind: 'file',
    type: 'text/plain',
    getAsFile() {
      return { name: 'loose.txt', type: 'text/plain' };
    },
  };
  const dataTransfer = {
    items: [folderItem, fileItem],
    files: [],
  };

  const { folders, files } = await parseDataTransferItems(dataTransfer);
  assert.strictEqual(folders.length, 1);
  assert.strictEqual(folders[0].name, 'root');
  assert.deepStrictEqual(
    folders[0].files.map((f) => f.name),
    ['inner.txt'],
  );
  assert.deepStrictEqual(
    files.map((f) => f.name).sort(),
    ['inner.txt', 'loose.txt'],
  );
});

function makeFile(name) {
  return {
    name,
    arrayBuffer: async () => new TextEncoder().encode(name).buffer,
  };
}

test('isSupportedImportFile accepts docx and pdf', () => {
  assert.strictEqual(isSupportedImportFile(makeFile('a.docx')), true);
  assert.strictEqual(isSupportedImportFile(makeFile('a.pdf')), true);
  assert.strictEqual(isSupportedImportFile(makeFile('a.txt')), false);
});

test('buildImportPayload filters and maps supported files', async () => {
  const files = [makeFile('a.docx'), makeFile('b.pdf'), makeFile('c.txt')];
  const payload = await buildImportPayload(files);
  assert.deepStrictEqual(payload.map((p) => p.name), ['a.docx', 'b.pdf']);
  assert.ok(payload[0].data instanceof ArrayBuffer);
});

test('App handleLeftDrop uses buildImportPayload', () => {
  const source = fs.readFileSync('./src/App.jsx', 'utf8');
  assert.match(source, /buildImportPayload\(/);
});

test('FileManager handleDrop uses buildImportPayload', () => {
  const source = fs.readFileSync('./src/FileManager.jsx', 'utf8');
  assert.match(source, /buildImportPayload\(/);
});
