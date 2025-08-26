import test from 'node:test';
import assert from 'node:assert';
import { readAllFiles, parseDataTransferItems } from '../src/utils/dragHelpers.js';

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
