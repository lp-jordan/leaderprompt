const fs = require('fs');
const test = require('node:test');
const assert = require('node:assert');

test('Prompter uses project settings hook and hydration-safe settings state', () => {
  const source = fs.readFileSync('./src/Prompter.jsx', 'utf8');
  assert.match(source, /useProjectSettings\(/);
  assert.match(source, /resetSettings/);
});

test('TipTapEditor applies incoming content without triggering update loops', () => {
  const source = fs.readFileSync('./src/TipTapEditor.jsx', 'utf8');
  assert.match(source, /setContent\(initialHtml, false\)/);
});

test('FileManager switches back to manual order when dragging scripts', () => {
  const source = fs.readFileSync('./src/FileManager.jsx', 'utf8');
  assert.match(source, /setSortBy\(\(current\) => \(\{ \.\.\.current, \[projectName\]: '' \}\)\)/);
  assert.match(source, /\[dragInfo\.projectName\]: ''/);
  assert.doesNotMatch(source, /Clear sorting before reordering scripts/);
  assert.match(source, /draggable/);
});

test('FileManager supports midpoint drop targeting and project reordering', () => {
  const source = fs.readFileSync('./src/FileManager.jsx', 'utf8');
  const preloadSource = fs.readFileSync('./electron/preload.cjs', 'utf8');
  const mainSource = fs.readFileSync('./electron/main.cjs', 'utf8');
  assert.match(source, /getDropPosition/);
  assert.match(source, /handleProjectDragStart/);
  assert.match(source, /reorderProjects\?/);
  assert.match(source, /sort-menu-option/);
  assert.match(preloadSource, /reorderProjects: \(order\)/);
  assert.match(mainSource, /ipcMain\.handle\('reorder-projects'/);
});

test('FileManager exposes archive and export actions in context menus', () => {
  const source = fs.readFileSync('./src/FileManager.jsx', 'utf8');
  assert.match(source, /Archive project/);
  assert.match(source, /Restore project/);
  assert.match(source, /Export project \(\.pdf\)/);
  assert.match(source, /Export \(\.docx\)/);
});


test('Speech follow keeps advanced tools available while simplifying the default prompter UI', () => {
  const prompterSource = fs.readFileSync('./src/Prompter.jsx', 'utf8');
  const windowSource = fs.readFileSync('./src/SpeechFollowWindow.jsx', 'utf8');
  const prompterCss = fs.readFileSync('./src/Prompter.css', 'utf8');
  assert.match(prompterSource, /Advanced/);
  assert.match(prompterSource, /System default microphone/);
  assert.match(prompterSource, /Microphone needs attention/);
  assert.match(prompterSource, /BroadcastChannel/);
  assert.match(windowSource, /Input Device/);
  assert.match(windowSource, /Advanced Speech Tools/);
  assert.match(prompterCss, /speech-follow-recovery/);
  assert.match(windowSource, /Heard Words/);
});

test('FileManager starts a draft instead of creating a Quick Scripts file', () => {
  const source = fs.readFileSync('./src/FileManager.jsx', 'utf8');
  assert.match(source, /const handleNewScript = \(\) => \{/);
  assert.match(source, /onCreateDraft\?\.\(\)/);
  assert.doesNotMatch(source, /window\.electronAPI\?\.createNewScript/);
});

test('ScriptViewer keeps drafts out of autosave until first manual save', () => {
  const source = fs.readFileSync('./src/ScriptViewer.jsx', 'utf8');
  assert.match(source, /if \(draftSessionRef\.current\?\.id\) return;/);
  assert.match(source, /<span className="panel-kicker">Save Draft<\/span>/);
  assert.match(source, /Existing Project/);
  assert.match(source, /New Project/);
  assert.match(source, /Manual save required before autosave begins/);
});

test('ScriptViewer allows renaming from the header for drafts and saved scripts', () => {
  const source = fs.readFileSync('./src/ScriptViewer.jsx', 'utf8');
  assert.match(source, /Click to rename/);
  assert.match(source, /window\.electronAPI\?\.renameScript/);
  assert.match(source, /onDraftStateChangeRef\.current\?\.\(\{ title: nextTitle \}\)/);
});

test('Keyboard support covers dialogs, menus, and library toggles', () => {
  const confirmSource = fs.readFileSync('./src/ConfirmModal.jsx', 'utf8');
  const fileManagerSource = fs.readFileSync('./src/FileManager.jsx', 'utf8');
  const viewerSource = fs.readFileSync('./src/ScriptViewer.jsx', 'utf8');
  assert.match(confirmSource, /event\.key === 'Escape'/);
  assert.match(confirmSource, /event\.key === 'Enter'/);
  assert.match(fileManagerSource, /role="button"[\s\S]*tabIndex=\{0\}/);
  assert.match(fileManagerSource, /handleMenuKeyDown/);
  assert.match(fileManagerSource, /handleRenameKeyDown/);
  assert.match(viewerSource, /handleSaveDialogKeyDown/);
  assert.match(viewerSource, /event\.key === 'Escape'/);
});


