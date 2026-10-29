'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {JSDOM} = require('jsdom');

test('Home lists leftover save points at startup and offers restore or dismiss', async () => {
  const points = [{id: '11111111-1111-1111-1111-111111111111', path: 'C:\\Work\\note.txt', createdAt: '2026-10-29T12:00:00.000Z'}];
  let restored = 0, dismissed = 0;
  const dom = await JSDOM.fromFile(path.resolve(__dirname, '../src/renderer/index.html'), {
    runScripts: 'dangerously', resources: 'usable',
    beforeParse(window) {
      window.structuredClone = structuredClone;
      window.folderApp = {
        bootstrap: async () => ({settings: null, jobs: [], savePoints: points, explorerRoots: []}),
        rootStatus: async () => [], locationStatus: async () => [], listJobs: async () => [],
        listSavePoints: async () => points,
        restoreSavePoint: async id => { assert.equal(id, points[0].id); restored++; points.length = 0; },
        dismissSavePoint: async id => { assert.equal(id, points[0].id); dismissed++; points.length = 0; },
        viewerDirty: async () => {}
      };
    }
  });
  try {
    await new Promise(resolve => dom.window.addEventListener('load', resolve, {once: true}));
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.match(dom.window.document.querySelector('#home').textContent, /File save recovery/);
    assert.match(dom.window.document.querySelector('#home').textContent, /C:\\Work\\note.txt/);
    dom.window.document.querySelector('[data-restore-point]').click();
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(restored, 1);
    assert.equal(dom.window.document.querySelector('[data-restore-point]'), null);
    points.push({id: '11111111-1111-1111-1111-111111111111', path: 'C:\\Work\\note.txt', createdAt: '2026-10-29T12:00:00.000Z'});
    dom.window.eval('state.savePoints = [{id:"11111111-1111-1111-1111-111111111111",path:"C:\\\\Work\\\\note.txt",createdAt:"2026-10-29T12:00:00.000Z"}]; renderHome()');
    dom.window.document.querySelector('[data-dismiss-point]').click();
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(dismissed, 1);
  } finally { dom.window.close(); }
});
