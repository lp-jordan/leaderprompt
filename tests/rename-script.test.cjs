const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert');

function sanitizeFilename(name) {
  if (!name || typeof name !== 'string') return null;
  const base = path.basename(name);
  const sanitized = base.replace(/[\\/:*?"<>|]/g, '_').trim();
  if (!sanitized || sanitized === '.' || sanitized === '..') return null;
  return sanitized;
}

function renameScript(base, oldName, newName) {
  if (!base || !oldName || !newName || oldName === newName) return false;
  const safeName = sanitizeFilename(newName);
  if (!safeName) return false;
  let targetName = safeName;
  if (!targetName.toLowerCase().endsWith('.docx')) {
    targetName += '.docx';
  }
  const oldPath = path.join(base, oldName);
  const newPath = path.join(base, targetName);
  if (!fs.existsSync(oldPath) || fs.existsSync(newPath)) return false;
  fs.renameSync(oldPath, newPath);
  return true;
}

test('renameScript returns false for invalid new name', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-test-'));
  const oldPath = path.join(dir, 'old.docx');
  fs.writeFileSync(oldPath, 'dummy');
  const result = renameScript(dir, 'old.docx', '..');
  assert.strictEqual(result, false);
  assert.ok(fs.existsSync(oldPath));
});

test('renameScript renames valid file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-test-'));
  const oldPath = path.join(dir, 'old.docx');
  fs.writeFileSync(oldPath, 'dummy');
  const result = renameScript(dir, 'old.docx', 'new');
  assert.strictEqual(result, true);
  assert.ok(fs.existsSync(path.join(dir, 'new.docx')));
  assert.ok(!fs.existsSync(oldPath));
});
