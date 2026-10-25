'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {JSDOM} = require('jsdom');

test('first-use creation loads fields for the first available structure', async () => {
  const settings = {
    path: 'P:\\folderapp.json', revision: 'saved', selectedUserId: 'user',
    data: {
      users: [{id: 'user', name: 'Alex', initials: 'AX', position: 'Admin'}],
      standards: {roots: [], namingTags: [], structures: [{id: 'one', name: 'Project'}], docTemplates: []}
    }
  };
  const calls = [];
  let fields = ['PROJECT'];
  const dom = await JSDOM.fromFile(path.resolve(__dirname, '..', 'src', 'renderer', 'index.html'), {
    runScripts: 'dangerously', resources: 'usable',
    beforeParse(window) {
      window.structuredClone = structuredClone;
      window.folderApp = {
        bootstrap: async () => ({settings, jobs: []}),
        requiredValues: async id => { calls.push(id); return fields; },
        listJobs: async () => [],
        saveSettings: async () => settings
      };
    }
  });
  try {
    await new Promise(resolve => dom.window.addEventListener('load', resolve, {once: true}));
    await new Promise(resolve => setTimeout(resolve, 20));
    dom.window.document.querySelector('[data-page="create"]').click();
    let input;
    for (let i = 0; i < 30; i++) {
      input = dom.window.document.querySelector('[data-value="PROJECT"]');
      if (input) break;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.ok(input, 'first structure field must appear without changing structure selection');
    assert.ok(calls.includes('one'));
    fields = ['PROJECT', 'CLIENT'];
    dom.window.document.querySelector('[data-page="settings"]').click();
    dom.window.document.querySelector('#save-settings').click();
    await new Promise(resolve => setTimeout(resolve, 20));
    dom.window.document.querySelector('[data-page="create"]').click();
    let added;
    for (let i = 0; i < 30; i++) {
      added = dom.window.document.querySelector('[data-value="CLIENT"]');
      if (added) break;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.ok(added, 'saving edited settings must reload fields for the same structure');
  } finally { dom.window.close(); }
});

test('beta shell browses a real-shaped folder page, opens a file tab, and persists theme choice', async () => {
  const root = 'C:\\Beta';
  const file = `${root}\\Notes.md`;
  let chosenTheme = null;
  let available = true;
  const dom = await JSDOM.fromFile(path.resolve(__dirname, '..', 'src', 'renderer', 'index.html'), {
    runScripts: 'dangerously', resources: 'usable',
    beforeParse(window) {
      window.structuredClone = structuredClone;
      window.folderApp = {
        bootstrap: async () => ({settings: null, jobs: [], explorerRoots: [root], theme: 'system'}),
        listJobs: async () => [],
        rootStatus: async () => [{path: root, available}],
        listFolder: async () => ({path: root, entries: [{name: 'Notes.md', path: file, kind: 'file', modified: '2026-10-25T12:00:00.000Z'}], total: 1, nextOffset: null}),
        inspectFile: async () => ({path: file, name: 'Notes.md', type: 'MD', modified: '2026-10-25T12:00:00.000Z'}),
        setTheme: async value => { chosenTheme = value; return value; },
        removeRoot: async () => []
      };
    }
  });
  const pause = () => new Promise(resolve => setTimeout(resolve, 20));
  try {
    await new Promise(resolve => dom.window.addEventListener('load', resolve, {once: true}));
    await pause();
    dom.window.document.querySelector('#side-content [data-folder]').click();
    await pause();
    const row = dom.window.document.querySelector('#beta-content [data-item]');
    assert.ok(row, 'real folder listing is displayed');
    row.click();
    assert.equal(dom.window.document.querySelector('#beta-content [data-item]'), row, 'selection keeps the row mounted for a real double-click');
    assert.equal(dom.window.document.querySelector('.properties-trigger').hidden, false);
    row.dispatchEvent(new dom.window.MouseEvent('dblclick', {bubbles: true}));
    await pause();
    assert.match(dom.window.document.querySelector('#beta-content').textContent, /File viewer comes in Stage 5/);
    assert.ok(dom.window.document.querySelector('.file-pill'));
    const theme = dom.window.document.querySelector('#theme-select');
    theme.value = 'dark';
    theme.dispatchEvent(new dom.window.Event('change', {bubbles: true}));
    await pause();
    assert.equal(chosenTheme, 'dark');
    assert.equal(dom.window.document.documentElement.dataset.theme, 'dark');
    available = false;
    dom.window.dispatchEvent(new dom.window.Event('legacy-boot'));
    await pause();
    assert.match(dom.window.document.querySelector('#side-content').textContent, /Disconnected or missing/);
    dom.window.document.querySelector('[data-remove-root]').click();
    await pause();
    assert.match(dom.window.document.querySelector('#beta-content').textContent, /root was removed/);
  } finally { dom.window.close(); }
});

test('Explorer type filter keeps folders visible and Enter opens a nested folder tab', async () => {
  const root = 'C:\\Beta';
  const child = `${root}\\Drawings`;
  const nested = `${child}\\90_Percent`;
  const make = (name, path, kind) => ({name, path, kind, modified: '2026-10-25T12:00:00.000Z'});
  const dom = await JSDOM.fromFile(path.resolve(__dirname, '..', 'src', 'renderer', 'index.html'), {
    runScripts: 'dangerously', resources: 'usable',
    beforeParse(window) {
      window.structuredClone = structuredClone;
      window.folderApp = {
        bootstrap: async () => ({settings: null, jobs: [], explorerRoots: [root]}),
        listJobs: async () => [],
        rootStatus: async () => [{path: root, available: true}],
        listFolder: async target => {
          const entries = target === root ? [make('Drawings', child, 'folder'), make('Notes.md', `${root}\\Notes.md`, 'file'), make('Plan.pdf', `${root}\\Plan.pdf`, 'file')]
            : target === child ? [make('90_Percent', nested, 'folder')] : [];
          return {path: target, entries, total: entries.length, nextOffset: null};
        }
      };
    }
  });
  const pause = () => new Promise(resolve => setTimeout(resolve, 20));
  try {
    await new Promise(resolve => dom.window.addEventListener('load', resolve, {once: true}));
    await pause();
    dom.window.document.querySelector('#side-content [data-folder]').click();
    await pause();
    dom.window.document.querySelector('[data-file-type="MD"]').click();
    assert.equal(dom.window.document.querySelectorAll('#beta-content [data-item]').length, 2);
    assert.ok(dom.window.document.querySelector('#beta-content [data-kind="folder"]'));
    const row = dom.window.document.querySelector('#beta-content [data-kind="folder"]');
    row.click();
    row.dispatchEvent(new dom.window.KeyboardEvent('keydown', {key: 'Enter', bubbles: true}));
    await pause();
    assert.match(dom.window.document.querySelector('#beta-content').textContent, /90_Percent/);
    assert.ok(dom.window.document.querySelector('#side-content [data-open-item]'), 'opening a folder expands its root in the sidebar');
    assert.ok([...dom.window.document.querySelectorAll('.breadcrumbs [data-folder]')].some(button => button.dataset.folder === root), 'root breadcrumb is navigable');
    dom.window.document.querySelector('#beta-content [data-kind="folder"]').dispatchEvent(new dom.window.MouseEvent('dblclick', {bubbles: true}));
    await pause();
    assert.ok(dom.window.document.querySelector('.nested-branch'), 'active ancestor expands with its child tab');
  } finally { dom.window.close(); }
});
