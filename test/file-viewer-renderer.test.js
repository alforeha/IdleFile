'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {JSDOM} = require('jsdom');

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
test('Markdown viewer edits, sanitizes, handles conflict choices, and closes with a dirty prompt', async () => {
  const root = 'C:\\Viewer', file = `${root}\\Notes.md`;
  let disk = '# Intro\n# Intro\n[bad](javascript:alert(1))\n![remote](https://example.com/x.png)\n![traversal](%2e%2e/secret.png)\n![absolute](C:/secret.png)\n![unc](\\\\server\\share\\secret.png)\n![local](image.png)\n[web](https://example.com)\n[Text](other.txt)\n[Folder](sub/)\n<script>alert(1)</script>\n';
  let version = 1, changed, closeRequest, dirty = false, saved = 0, finished = 0, external;
  const result = () => ({path: file, name: 'Notes.md', type: 'markdown', size: disk.length, modified: new Date().toISOString(), version: String(version), hash: String(version), supported: true, source: disk, bom: false, lineEnding: 'LF'});
  const dom = await JSDOM.fromFile(path.resolve(__dirname, '../src/renderer/index.html'), {
    runScripts: 'dangerously', resources: 'usable',
    beforeParse(window) {
      window.structuredClone = structuredClone;
      window.folderApp = {
        bootstrap: async () => ({settings: null, jobs: [], explorerRoots: [root], viewerPreferences: {markdownMode: 'preview', textWrap: true}}),
        listJobs: async () => [], rootStatus: async () => [{path: root, available: true}], locationStatus: async items => items,
        listFolder: async target => ({path: target, entries: [{name: 'Notes.md', path: file, kind: 'file'}], total: 1, nextOffset: null}),
        readViewerFile: async () => result(), openViewerFile: async () => ({handle: 'test-handle', info: result()}), inspectFile: async target => { if (target.endsWith('sub\\')) throw new Error('folder'); return {path: target, type: 'MD'}; }, openExternal: async url => { external = url; },
        saveViewerFile: async (_, source, overwrite) => {
          if (String(version) !== dom.window.eval('beta.files.get(beta.active.path).info.hash') && !overwrite) return {conflict: true, info: result()};
          disk = source; version++; saved++; return {conflict: false, info: result()};
        },
        viewerDirty: async value => { dirty = value; }, closeViewerFile: async () => {},
        setViewerPreferences: async () => {}, onFolderChanges: cb => { changed = cb; },
        onWindowCloseRequest: cb => { closeRequest = cb; }, finishWindowClose: async () => { finished++; }
      };
    }
  });
  try {
    await new Promise(resolve => dom.window.addEventListener('load', resolve, {once: true})); await pause(30);
    dom.window.document.querySelector('#side-content [data-open-item]').click(); await pause(30);
    dom.window.document.querySelector('#beta-content [data-item]').dispatchEvent(new dom.window.MouseEvent('dblclick', {bubbles: true})); await pause(30);
    assert.ok(dom.window.document.querySelector('.viewer-preview h1'));
    assert.equal(dom.window.document.querySelector('.viewer-preview script'), null);
    assert.equal(dom.window.document.querySelector('.viewer-preview img'), null);
    assert.deepEqual([...dom.window.document.querySelectorAll('.viewer-image-placeholder')].map(node => node.textContent), ['remote', 'traversal', 'absolute', 'unc', 'local']);
    assert.ok([...dom.window.document.querySelectorAll('.viewer-preview a:not([href])')].some(link => link.textContent === 'bad'));
    const links = [...dom.window.document.querySelectorAll('.viewer-preview a[data-viewer-link]')];
    links.find(link => link.textContent === 'web').click(); await pause();
    assert.equal(external, 'https://example.com');
    links.find(link => link.textContent === 'Text').click(); await pause(30);
    assert.equal(dom.window.eval('beta.active.path'), `${root}\\other.txt`);
    await dom.window.eval(`openFile(${JSON.stringify(file)})`);
    const folderLink = [...dom.window.document.querySelectorAll('.viewer-preview a[data-viewer-link]')].find(link => link.textContent === 'Folder');
    folderLink.click(); await pause(30);
    assert.equal(dom.window.eval('beta.active.path'), `${root}\\sub\\`);
    await dom.window.eval(`openFile(${JSON.stringify(file)})`);
    dom.window.document.querySelector('[data-viewer="convert"]').click();
    assert.equal(dom.window.document.querySelector('[data-viewer-convert]').hidden, false);
    assert.equal(dom.window.document.querySelector('[data-viewer-convert] button').disabled, true);
    dom.window.document.querySelector('[data-viewer="info"]').click();
    dom.window.document.querySelector('[data-viewer="go-folder"]').click(); await pause(30);
    assert.equal(dom.window.eval('beta.active.kind'), 'folder');
    assert.equal(dom.window.eval('beta.selected'), file);
    assert.ok(dom.window.eval(`beta.files.has(${JSON.stringify(file)})`));
    await dom.window.eval(`openFile(${JSON.stringify(file)})`);
    dom.window.document.querySelector('[data-viewer="contents"]').click();
    assert.equal(dom.window.document.querySelectorAll('[data-viewer-heading]').length, 2);
    assert.equal(dom.window.document.querySelectorAll('.viewer-preview h1')[1].id, 'intro-1');
    let scrolled;
    dom.window.HTMLElement.prototype.scrollIntoView = function () { scrolled = this.id; };
    dom.window.document.querySelectorAll('[data-viewer-heading]')[1].click();
    assert.equal(scrolled, 'intro-1');
    dom.window.document.querySelector('[data-viewer="mode:raw"]').click();
    const editor = dom.window.document.querySelector('.viewer-raw');
    editor.value += '\nnew'; editor.dispatchEvent(new dom.window.Event('input', {bubbles: true})); await pause();
    assert.equal(dirty, true);
    dom.window.document.querySelector('[data-viewer="info"]').click();
    assert.equal(dom.window.document.querySelector('[data-viewer-menu]').hidden, false);
    assert.match(dom.window.document.querySelector('[data-viewer="save"]').getAttribute('aria-label'), /unsaved changes/);
    assert.ok(dom.window.document.querySelector('.save-icon b'));
    disk = 'external'; version++; changed([root]); await pause(180);
    assert.match(dom.window.document.querySelector('.viewer-notice').textContent, /Changed on disk/);
    dom.window.document.querySelector('[data-viewer="save"]').click(); await pause();
    assert.ok(dom.window.document.querySelector('#viewer-dialog').open);
    dom.window.document.querySelector('[data-choice="Cancel"]').click(); await pause();
    assert.equal(saved, 0);
    dom.window.document.querySelector('[data-viewer="save"]').click(); await pause();
    dom.window.document.querySelector('[data-choice="Overwrite"]').click(); await pause(40);
    assert.equal(saved, 1);
    assert.equal(dirty, false);
    dom.window.document.querySelector('.viewer-raw').value += 'conflicting edit';
    dom.window.document.querySelector('.viewer-raw').dispatchEvent(new dom.window.Event('input', {bubbles: true}));
    disk = 'disk version'; version++; changed([root]); await pause(180);
    dom.window.document.querySelector('[data-viewer="info"]').click();
    dom.window.document.querySelector('[data-viewer="save"]').click(); await pause();
    dom.window.document.querySelector('[data-choice="Reload"]').click(); await pause(40);
    assert.equal(dom.window.document.querySelector('.viewer-raw').value, 'disk version');
    assert.equal(dirty, false);
    dom.window.document.querySelector('.viewer-raw').value += 'again';
    dom.window.document.querySelector('.viewer-raw').dispatchEvent(new dom.window.Event('input', {bubbles: true})); await pause();
    dom.window.document.querySelector('[data-viewer="close"]').click(); await pause();
    assert.ok(dom.window.document.querySelector('#viewer-dialog').open);
    dom.window.document.querySelector('[data-choice="Cancel"]').click(); await pause();
    assert.ok(dom.window.document.querySelector('.viewer-frame'));
    dom.window.document.querySelector('.file-pill [data-close-file]').click(); await pause();
    assert.ok(dom.window.document.querySelector('#viewer-dialog').open);
    dom.window.document.querySelector('[data-choice="Discard"]').click(); await pause();
    assert.equal(dom.window.document.querySelector('.viewer-frame'), null);
    assert.ok(closeRequest);
    dom.window.document.querySelector('#beta-content [data-item]').dispatchEvent(new dom.window.MouseEvent('dblclick', {bubbles: true})); await pause();
    dom.window.document.querySelector('[data-viewer="mode:raw"]').click();
    dom.window.document.querySelector('.viewer-raw').value += 'pending';
    dom.window.document.querySelector('.viewer-raw').dispatchEvent(new dom.window.Event('input', {bubbles: true}));
    await dom.window.eval(`openFile(${JSON.stringify(`${root}\\Second.md`)})`);
    dom.window.document.querySelector('[data-viewer="mode:raw"]').click();
    dom.window.document.querySelector('.viewer-raw').value += 'second pending';
    dom.window.document.querySelector('.viewer-raw').dispatchEvent(new dom.window.Event('input', {bubbles: true}));
    closeRequest(); await pause();
    dom.window.document.querySelector('[data-choice="Discard"]').click(); await pause();
    assert.ok(dom.window.document.querySelector('#viewer-dialog').open, 'second dirty tab is prompted');
    dom.window.document.querySelector('[data-choice="Cancel"]').click(); await pause();
    assert.equal(finished, 0);
    closeRequest(); await pause();
    dom.window.document.querySelector('[data-choice="Discard"]').click(); await pause();
    dom.window.document.querySelector('[data-choice="Discard"]').click(); await pause();
    assert.equal(finished, 1);
  } finally { dom.window.close(); }
});
