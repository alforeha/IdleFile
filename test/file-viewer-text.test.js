'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {JSDOM} = require('jsdom');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

test('text Wrap and Markdown mode choices persist through the local preference API', async () => {
  const root = 'C:\\Text', file = `${root}\\readme.txt`;
  let preferences;
  const dom = await JSDOM.fromFile(path.resolve(__dirname, '../src/renderer/index.html'), {
    runScripts: 'dangerously', resources: 'usable',
    beforeParse(window) {
      window.structuredClone = structuredClone;
      window.folderApp = {
        bootstrap: async () => ({settings: null, jobs: [], explorerRoots: [root], viewerPreferences: {markdownMode: 'split', textWrap: true}}),
        listJobs: async () => [], rootStatus: async () => [{path: root, available: true}],
        listFolder: async () => ({path: root, entries: [{path: file, name: 'readme.txt', kind: 'file'}], total: 1, nextOffset: null}),
        readViewerFile: async () => ({path: file, name: 'readme.txt', type: 'text', supported: true, source: 'one\ntwo', size: 7, modified: new Date().toISOString(), version: '1'}),
        setViewerPreferences: async value => { preferences = {...value}; }, viewerDirty: async () => {}
      };
    }
  });
  try {
    await new Promise(resolve => dom.window.addEventListener('load', resolve, {once: true})); await pause(25);
    dom.window.document.querySelector('#side-content [data-open-item]').click(); await pause(25);
    dom.window.document.querySelector('#beta-content [data-item]').dispatchEvent(new dom.window.MouseEvent('dblclick', {bubbles: true})); await pause(25);
    assert.ok(dom.window.document.querySelector('.viewer-raw.wrap'));
    assert.equal(dom.window.document.querySelector('.viewer-preview'), null);
    dom.window.document.querySelector('[data-viewer="wrap"]').click(); await pause();
    assert.equal(dom.window.document.querySelector('.viewer-raw.wrap'), null);
    assert.deepEqual(preferences, {markdownMode: 'split', textWrap: false});
  } finally { dom.window.close(); }
});
