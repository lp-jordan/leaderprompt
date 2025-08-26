const test = require('node:test');
const assert = require('node:assert');
const Module = require('module');

function loadPreload() {
  let exposed;
  const ipcRenderer = {
    invoke: (...args) => {
      loadPreload.invokeArgs = args;
      return Promise.resolve([]);
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

test('spellCheck forwards word', () => {
  const api = loadPreload();
  api.spellCheck('spel');
  const args = loadPreload.invokeArgs;
  assert.strictEqual(args[0], 'spell-check');
  assert.strictEqual(args[1], 'spel');
  delete global.window;
});
