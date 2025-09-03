const test = require('node:test');
const assert = require('node:assert');
const Module = require('module');

function loadPreload() {
  let exposed;
  const ipcRenderer = {
    invoke: (...args) => {
      loadPreload.invokeArgs = args;
      return Promise.resolve(true);
    },
    on: () => {},
    send: (...args) => {
      loadPreload.sendArgs = args;
    },
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

test('closePrompter sends channel', () => {
  const api = loadPreload();
  api.closePrompter();
  const args = loadPreload.sendArgs;
  assert.strictEqual(args[0], 'close-prompter');
  delete global.window;
});

test('destroyPrompter sends channel', () => {
  const api = loadPreload();
  api.destroyPrompter();
  const args = loadPreload.sendArgs;
  assert.strictEqual(args[0], 'destroy-prompter');
  delete global.window;
});
