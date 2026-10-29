'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {JSDOM} = require('jsdom');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

test('mixed-case slash notices refresh open file tabs and collapsed folder empty status', async () => {
  const root = 'C:\\View', child = `${root}\\Child`, file = `${root}\\NOTE.md`;
  let changed, childStatus = 'empty', source = 'old', version = 1;
  const dom = await JSDOM.fromFile(path.resolve(__dirname, '../src/renderer/index.html'), {
    runScripts: 'dangerously', resources: 'usable',
    beforeParse(window) {
      window.structuredClone = structuredClone;
      window.folderApp = {
        bootstrap: async () => ({settings: null, jobs: [], explorerRoots: [root]}), listJobs: async () => [],
        rootStatus: async () => [{path: root, available: true, status: 'nonempty'}],
        locationStatus: async items => items.map(item => ({...item, available: true, status: childStatus})),
        listFolder: async (target, _offset, sort) => ({path: target, entries: sort === 'tree' ? [{path: file, name: 'NOTE.md', kind: 'file'}, {path: child, name: 'Child', kind: 'folder', status: childStatus}] : [{path: file, name: 'NOTE.md', kind: 'file'}], total: sort === 'tree' ? 2 : 1, nextOffset: null}),
        readViewerFile: async () => ({path: file, name: 'NOTE.md', type: 'markdown', supported: true, source, version: String(version), hash: String(version), size: source.length, modified: new Date().toISOString()}),
        viewerDirty: async () => {}, setVisibleFolders: async () => {}, onFolderChanges: cb => { changed = cb; }
      };
    }
  });
  try {
    await new Promise(resolve => dom.window.addEventListener('load', resolve, {once: true})); await pause(25);
    assert.equal(dom.window.eval("pathKey('C:/VIEW/Child')"), dom.window.eval("pathKey('c:\\\\view\\\\child')"));
    assert.equal(dom.window.eval("pathKey('\\\\\\\\SERVER\\\\Share')"), dom.window.eval("pathKey('//server/share/')"));
    dom.window.document.querySelector('[data-expand]').click(); await pause(30);
    const childRow = [...dom.window.document.querySelectorAll('.tree-row-beta')].find(row => row.dataset.menuPath === child);
    assert.ok(childRow.querySelector('.tree-name-beta .icon'));
    childStatus = 'nonempty';
    changed(['c:/view/CHILD']); await pause(190);
    const updated = [...dom.window.document.querySelectorAll('.tree-row-beta')].find(row => row.dataset.menuPath === child);
    assert.equal(updated.querySelectorAll('.tree-name-beta .icon').length, 1, 'empty icon is removed');
    dom.window.document.querySelector('[data-open-item][data-kind="folder"]').click(); await pause(25);
    dom.window.document.querySelector('#beta-content [data-item]').dispatchEvent(new dom.window.MouseEvent('dblclick', {bubbles: true})); await pause(25);
    source = 'new'; version++;
    changed(['c:/VIEW']); await pause(200);
    assert.match(dom.window.document.querySelector('.viewer-preview').textContent, /new/);
  } finally { dom.window.close(); }
});
