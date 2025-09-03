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

test('saveOpenAIKey forwards key', async () => {
  const api = loadPreload();
  await api.saveOpenAIKey('abc');
  const args = loadPreload.invokeArgs;
  assert.strictEqual(args[0], 'save-openai-key');
  assert.strictEqual(args[1], 'abc');
  delete global.window;
});
