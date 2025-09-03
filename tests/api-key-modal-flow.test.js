import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';

// Regression test: ensure API key is requested via IPC flow instead of window.prompt

test('App uses IPC modal flow for API key', () => {
  const source = fs.readFileSync('./src/App.jsx', 'utf8');
  assert.ok(!source.includes('window.prompt'), 'should not use window.prompt');
  assert.ok(/electronAPI\.promptOpenAIKey/.test(source), 'should request key via promptOpenAIKey');
  assert.ok(/electronAPI\.saveOpenAIKey/.test(source), 'should save key via electronAPI.saveOpenAIKey');
});
