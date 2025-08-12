const test = require('node:test');
const assert = require('node:assert');
const Module = require('module');

// Helper to load preload with mocked electron module
function loadPreload() {
  let exposed;
  const ipcRenderer = {
    invoke: (...args) => {
      loadPreload.invokeArgs = args;
      return Promise.resolve();
    },
    on: () => {},
    send: () => {},
  };
  const contextBridge = {
    exposeInMainWorld: (key, api) => {
      exposed = api;
    },
  };
  const electronPath = require.resolve('electron');
  const original = Module._cache[electronPath];
  Module._cache[electronPath] = { exports: { ipcRenderer, contextBridge } };
  delete require.cache[require.resolve('../electron/preload.cjs')];
  global.window = {};
  require('../electron/preload.cjs');
  if (original) {
    Module._cache[electronPath] = original;
  } else {
    delete Module._cache[electronPath];
  }
  return exposed;
}

test('rewriteSelection forwards modifier', () => {
  const api = loadPreload();
  api.rewriteSelection('hello', 'formal');
  const args = loadPreload.invokeArgs;
  assert.strictEqual(args[0], 'rewrite-selection');
  assert.strictEqual(args[2], 'hello');
  assert.strictEqual(args[3], 'formal');
  assert.strictEqual(typeof args[1], 'string');
  delete global.window;
});
