import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import { buildDocxPayload } from '../src/utils/dragHelpers.js';

function makeFile(name) {
  return {
    name,
    arrayBuffer: async () => new TextEncoder().encode(name).buffer,
  };
}

test('buildDocxPayload filters and maps docx files', async () => {
  const files = [makeFile('a.docx'), makeFile('b.txt')];
  const payload = await buildDocxPayload(files);
  assert.deepStrictEqual(payload.map((p) => p.name), ['a.docx']);
  assert.ok(payload[0].data instanceof ArrayBuffer);
});

test('App handleLeftDrop uses buildDocxPayload', () => {
  const source = fs.readFileSync('./src/App.jsx', 'utf8');
  const hasHelperCall = /buildDocxPayload\(/.test(source);
  assert.ok(hasHelperCall);
});

test('FileManager handleDrop uses buildDocxPayload', () => {
  const source = fs.readFileSync('./src/FileManager.jsx', 'utf8');
  const hasHelperCall = /buildDocxPayload\(/.test(source);
  assert.ok(hasHelperCall);
});
