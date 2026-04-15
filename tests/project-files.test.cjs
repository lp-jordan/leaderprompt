const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert');
const {
  buildProjectListing,
  ensureDocxExtension,
  readScriptOrder,
  resolveUniqueDocxName,
  sanitizeFilename,
} = require('../electron/projectFiles.cjs');

test('sanitizeFilename strips invalid path characters', () => {
  assert.strictEqual(sanitizeFilename('bad:/name?.docx'), 'name_.docx');
});

test('ensureDocxExtension appends docx once', () => {
  assert.strictEqual(ensureDocxExtension('Script'), 'Script.docx');
  assert.strictEqual(ensureDocxExtension('Script.docx'), 'Script.docx');
});

test('resolveUniqueDocxName preserves duplicates by suffixing', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-project-files-'));
  fs.writeFileSync(path.join(dir, 'My Script.docx'), 'first');
  fs.writeFileSync(path.join(dir, 'My Script 1.docx'), 'second');

  const next = await resolveUniqueDocxName(dir, 'My Script.docx');
  assert.strictEqual(next, 'My Script 2.docx');
});

test('resolveUniqueDocxName excludes current file during rename', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-project-files-'));
  fs.writeFileSync(path.join(dir, 'Current.docx'), 'current');
  fs.writeFileSync(path.join(dir, 'Current 1.docx'), 'other');

  const next = await resolveUniqueDocxName(dir, 'Current.docx', {
    excludeName: 'Current.docx',
  });
  assert.strictEqual(next, 'Current.docx');
});

test('readScriptOrder returns configured order when present', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-project-files-'));
  fs.writeFileSync(
    path.join(dir, 'scripts.json'),
    JSON.stringify({ order: ['b.docx', 'a.docx'] }),
  );

  const order = await readScriptOrder(dir);
  assert.deepStrictEqual(order, ['b.docx', 'a.docx']);
});

test('buildProjectListing respects saved order and metadata map', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-project-list-'));
  const projectDir = path.join(root, 'Project A');
  fs.mkdirSync(projectDir, { recursive: true });
  fs.writeFileSync(path.join(projectDir, 'a.docx'), 'a');
  fs.writeFileSync(path.join(projectDir, 'b.docx'), 'b');
  fs.writeFileSync(
    path.join(projectDir, 'scripts.json'),
    JSON.stringify({ order: ['b.docx'] }),
  );

  const listing = await buildProjectListing(root, {
    projects: [{ name: 'Project A', added: 123 }],
  });

  assert.strictEqual(listing.length, 1);
  assert.strictEqual(listing[0].name, 'Project A');
  assert.strictEqual(listing[0].added, 123);
  assert.deepStrictEqual(
    listing[0].scripts.map((script) => script.name),
    ['b.docx', 'a.docx'],
  );
});

