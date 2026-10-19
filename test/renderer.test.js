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
