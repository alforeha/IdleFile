'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {JSDOM} = require('jsdom');
const {sidebarWidthForRows} = require('../src/renderer/sidebar-width');

test('sidebar width uses visible rows, a 266 px minimum, and a 40% or 360 px main-area cap', () => {
  assert.equal(sidebarWidthForRows([180], 1200), 266);
  assert.equal(sidebarWidthForRows([380], 1200), 380);
  assert.equal(sidebarWidthForRows([900], 1200), 480);
  assert.equal(sidebarWidthForRows([900], 800), 320);
  assert.equal(sidebarWidthForRows([900], 700), 280);
});

test('live branch re-read retains expansion, loaded pages, selection, and scroll', async () => {
  const root = 'C:\\Live';
  let names = Array.from({length: 501}, (_, i) => `file-${String(i).padStart(3, '0')}.txt`);
  let changed;
  const visible = [];
  const calls = [];
  const blockedReads = [];
  let holdReads = false;
  const dom = await JSDOM.fromFile(path.resolve(__dirname, '..', 'src', 'renderer', 'index.html'), {
    runScripts: 'dangerously', resources: 'usable',
    beforeParse(window) {
      window.structuredClone = structuredClone;
      window.folderApp = {
        bootstrap: async () => ({settings: null, jobs: [], explorerRoots: [root]}), listJobs: async () => [],
        rootStatus: async () => [{path: root, available: true}], locationStatus: async () => [],
        setVisibleFolders: async items => { visible.push(items); },
        onFolderChanges: callback => { changed = callback; },
        listFolder: async (_path, offset = 0, sort = 'name') => {
          calls.push([offset, sort]);
          if (holdReads) await new Promise(resolve => blockedReads.push(resolve));
          const entries = names.slice(offset, offset + 500).map(name => ({name, path: `${root}\\${name}`, kind: 'file', status: null}));
          return {path: root, entries, total: names.length, nextOffset: offset + 500 < names.length ? offset + 500 : null};
        }
      };
    }
  });
  const pause = (ms = 30) => new Promise(resolve => setTimeout(resolve, ms));
  try {
    await new Promise(resolve => dom.window.addEventListener('load', resolve, {once: true})); await pause();
    dom.window.document.querySelector('[data-expand]').click(); await pause();
    dom.window.document.querySelector('[data-tree-more]').click(); await pause();
    assert.equal(dom.window.document.querySelectorAll('#side-content [data-open-item][data-kind="file"]').length, 501);
    dom.window.document.querySelector('#side-content [data-open-item]').click(); await pause();
    dom.window.document.querySelector('#beta-content [data-action="more"]').click(); await pause();
    assert.equal(dom.window.document.querySelectorAll('#beta-content [data-item]').length, 501);
    const selected = dom.window.document.querySelector('#beta-content [data-item]');
    selected.click();
    const selectedPath = selected.dataset.item;
    dom.window.document.querySelector('#side-content').scrollTop = 145;
    dom.window.document.querySelector('#beta-content').scrollTop = 220;
    const treeRow = dom.window.document.querySelector('#side-content [data-open-item][data-kind="file"]');
    const folderRow = dom.window.document.querySelector('#beta-content [data-item].active');
    holdReads = true;
    changed([root]); await pause(160);
    assert.ok(blockedReads.length > 0, 'background check reached the filesystem');
    assert.equal(dom.window.document.querySelector('#side-content [data-open-item][data-kind="file"]'), treeRow, 'tree stays mounted during a background check');
    assert.equal(dom.window.document.querySelector('#beta-content [data-item].active'), folderRow, 'folder view stays mounted during a background check');
    holdReads = false;
    blockedReads.splice(0).forEach(resolve => resolve());
    await pause(230);
    assert.equal(dom.window.document.querySelector('#side-content [data-open-item][data-kind="file"]'), treeRow, 'unchanged tree is not redrawn');
    assert.equal(dom.window.document.querySelector('#beta-content [data-item].active'), folderRow, 'unchanged folder view is not redrawn');
    names = [...names.filter(name => name !== 'file-500.txt'), 'new-file.txt'];
    changed([root]); await pause(350);
    assert.equal(dom.window.document.querySelector('[data-expand]').getAttribute('aria-expanded'), 'true');
    assert.equal(dom.window.document.querySelectorAll('#side-content [data-open-item][data-kind="file"]').length, 501);
    assert.ok([...dom.window.document.querySelectorAll('#side-content [data-open-item]')].some(node => node.dataset.openItem.endsWith('new-file.txt')));
    assert.equal(dom.window.document.querySelector('#side-content').scrollTop, 145);
    assert.equal(dom.window.document.querySelector('#beta-content').scrollTop, 220);
    assert.equal(dom.window.document.querySelector('#beta-content [data-item].active')?.dataset.item, selectedPath);
    assert.equal(dom.window.document.querySelectorAll('#beta-content [data-item]').length, 501);
    assert.ok(calls.some(([offset, sort]) => offset === 500 && sort === 'tree'));
    assert.ok(visible.some(items => items.some(item => item.path === root && item.watch)));
    assert.equal(dom.window.document.querySelector('#side-content [data-tree-refresh]'), null);
    dom.window.document.querySelector('#side-content [data-expand]').click(); await pause();
    assert.equal(visible.at(-1).find(item => item.path === root)?.watch, true, 'open tab retains the watch');
    dom.window.document.querySelector('[data-close-folder]').click(); await pause();
    assert.equal(visible.at(-1).find(item => item.path === root)?.watch, false, 'closing the tab releases a collapsed branch watch');
  } finally { dom.window.close(); }
});

test('an unavailable visible branch recovers after a change notification', async () => {
  const root = 'C:\\Return';
  let available = false;
  let now = 1000;
  let changed;
  const dom = await JSDOM.fromFile(path.resolve(__dirname, '..', 'src', 'renderer', 'index.html'), {
    runScripts: 'dangerously', resources: 'usable',
    beforeParse(window) {
      window.structuredClone = structuredClone;
      window.Date.now = () => now;
      window.folderApp = {
        bootstrap: async () => ({settings: null, jobs: [], explorerRoots: [root]}), listJobs: async () => [],
        rootStatus: async () => [{path: root, available}], locationStatus: async () => [],
        onFolderChanges: callback => { changed = callback; },
        listFolder: async () => {
          if (!available) throw new Error('Offline');
          return {path: root, entries: [{name: 'restored.txt', path: `${root}\\restored.txt`, kind: 'file'}], total: 1, nextOffset: null};
        }
      };
    }
  });
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  try {
    await new Promise(resolve => dom.window.addEventListener('load', resolve, {once: true})); await pause(30);
    dom.window.document.querySelector('#side-content [data-expand]').click(); await pause(30);
    assert.match(dom.window.document.querySelector('#side-content').textContent, /Offline/);
    available = true;
    now += 5001;
    changed([root]); await pause(220);
    assert.match(dom.window.document.querySelector('#side-content').textContent, /restored.txt/);
    assert.equal(dom.window.document.querySelector('#side-content [data-expand]').getAttribute('aria-expanded'), 'true');
  } finally { dom.window.close(); }
});

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
    dom.window.document.querySelector('[data-settings-area="shared"]').click();
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
    dom.window.document.querySelector('#side-content [data-open-item]').click();
    await pause();
    const row = dom.window.document.querySelector('#beta-content [data-item]');
    assert.ok(row, 'real folder listing is displayed');
    row.click();
    assert.equal(dom.window.document.querySelector('#beta-content [data-item]'), row, 'selection keeps the row mounted for a real double-click');
    assert.equal(dom.window.document.querySelector('.properties-trigger').hidden, false);
    row.dispatchEvent(new dom.window.MouseEvent('dblclick', {bubbles: true}));
    await pause();
    assert.match(dom.window.document.querySelector('#beta-content').textContent, /Preview unavailable/);
    assert.ok(dom.window.document.querySelector('.file-pill'));
    dom.window.document.querySelector('#home-add').click();
    dom.window.document.querySelector('[data-workflow="settings"]').click();
    const theme = dom.window.document.querySelector('#pc-theme');
    theme.value = 'dark';
    theme.dispatchEvent(new dom.window.Event('change', {bubbles: true}));
    await pause();
    assert.equal(chosenTheme, 'dark');
    assert.equal(dom.window.document.documentElement.dataset.theme, 'dark');
    dom.window.document.querySelector('.file-pill [data-file]').click();
    available = false;
    dom.window.dispatchEvent(new dom.window.Event('legacy-boot'));
    await pause();
    assert.ok(dom.window.document.querySelector('#side-content .shortcut-warning, #side-content .tree-name-beta .icon'));
    dom.window.document.querySelector('[data-remove-root]').click();
    await pause();
    assert.match(dom.window.document.querySelector('#beta-content').textContent, /Preview unavailable/);
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
    dom.window.document.querySelector('#side-content [data-expand]').click();
    await pause();
    dom.window.document.querySelector('#side-content [data-open-item]').click();
    await pause();
    dom.window.document.querySelector('[data-file-type="MD"]').click();
    assert.equal(dom.window.document.querySelectorAll('#beta-content [data-item]').length, 2);
    assert.ok(dom.window.document.querySelector('#beta-content [data-kind="folder"]'));
    const row = dom.window.document.querySelector('#beta-content [data-kind="folder"]');
    row.click();
    row.dispatchEvent(new dom.window.KeyboardEvent('keydown', {key: 'Enter', bubbles: true}));
    await pause();
    assert.match(dom.window.document.querySelector('#beta-content').textContent, /90_Percent/);
    assert.ok(dom.window.document.querySelector('#side-content [data-open-item]'), 'expanded root keeps children visible');
    assert.ok([...dom.window.document.querySelectorAll('.breadcrumbs [data-folder]')].some(button => button.dataset.folder === root), 'root breadcrumb is navigable');
    dom.window.document.querySelector('#beta-content [data-kind="folder"]').dispatchEvent(new dom.window.MouseEvent('dblclick', {bubbles: true}));
    await pause();
    assert.ok(dom.window.document.querySelector('.nested-branch'), 'active ancestor expands with its child tab');
  } finally { dom.window.close(); }
});

test('deep tree branches retain expansion and Up reaches a sibling outside saved roots', async () => {
  const root = 'C:\\Root', a = `${root}\\A`, b = `${a}\\B`, other = 'C:\\Other';
  const entry = (folder, name, kind) => ({name, path: `${folder}${folder.endsWith('\\') ? '' : '\\'}${name}`, kind, modified: null});
  const listing = new Map([[root, [entry(root, 'A', 'folder')]], [a, [entry(a, 'B', 'folder')]], [b, [entry(b, 'note.md', 'file')]], ['C:\\', [entry('C:\\', 'Other', 'folder'), entry('C:\\', 'Root', 'folder')]], [other, [entry(other, 'outside.md', 'file')]]]);
  const dom = await JSDOM.fromFile(path.resolve(__dirname, '..', 'src', 'renderer', 'index.html'), {
    runScripts: 'dangerously', resources: 'usable',
    beforeParse(window) {
      window.structuredClone = structuredClone;
      window.folderApp = {
        bootstrap: async () => ({settings: null, jobs: [], explorerRoots: [root]}), listJobs: async () => [],
        rootStatus: async () => [{path: root, available: true}], locationStatus: async () => [],
        listFolder: async target => ({path: target, entries: listing.get(target) || [], total: (listing.get(target) || []).length, nextOffset: null}),
        inspectFile: async target => ({path: target, type: 'MD', modified: null})
      };
    }
  });
  const pause = () => new Promise(resolve => setTimeout(resolve, 20));
  const find = (selector, key, value) => [...dom.window.document.querySelectorAll(selector)].find(node => node.dataset[key] === value);
  try {
    await new Promise(resolve => dom.window.addEventListener('load', resolve, {once: true})); await pause();
    find('[data-expand]', 'expand', root).click(); await pause();
    find('[data-expand]', 'expand', a).click(); await pause();
    find('[data-expand]', 'expand', b).click(); await pause();
    assert.ok(find('[data-open-item]', 'openItem', `${b}\\note.md`));
    find('[data-expand]', 'expand', a).click();
    assert.equal(find('[data-expand]', 'expand', a).getAttribute('aria-expanded'), 'false');
    find('[data-expand]', 'expand', a).click();
    assert.equal(find('[data-expand]', 'expand', b).getAttribute('aria-expanded'), 'true');
    find('[data-open-item]', 'openItem', root).click(); await pause();
    assert.equal(find('[data-expand]', 'expand', root).getAttribute('aria-expanded'), 'true');
    dom.window.document.querySelector('[data-action="up"]').click(); await pause();
    assert.ok(find('#beta-content [data-item]', 'item', other));
    find('#beta-content [data-item]', 'item', other).dispatchEvent(new dom.window.MouseEvent('dblclick', {bubbles: true})); await pause();
    assert.ok(find('#beta-content [data-item]', 'item', `${other}\\outside.md`));
    assert.equal(dom.window.document.querySelectorAll('#side-content [data-expand]').length, 3, 'outside browsing does not add a saved root');
    assert.ok(find('.breadcrumbs [data-folder]', 'folder', 'C:\\'));
    dom.window.document.querySelector('[data-action="back"]').click(); await pause();
    assert.ok(find('#beta-content [data-item]', 'item', other));
    dom.window.document.querySelector('[data-action="forward"]').click(); await pause();
    assert.ok(find('#beta-content [data-item]', 'item', `${other}\\outside.md`));
    find('.breadcrumbs [data-folder]', 'folder', 'C:\\').click(); await pause();
    assert.ok(find('#beta-content [data-item]', 'item', other));
  } finally { dom.window.close(); }
});

test('Suggested editor changes a draft while file suggestions open without Pin', async () => {
  const folder = 'C:\\Shared', file = `${folder}\\note.md`;
  const settings = {path: 'C:\\settings.json', revision: 'one', selectedUserId: 'u', data: {
    users: [{id: 'u', name: 'User', initials: 'US', position: 'Admin'}], perUser: {u: {pins: [], recentPins: []}},
    standards: {roots: [], namingTags: [], structures: [], docTemplates: []}, branding: {},
    suggestedLocations: [{id: 'folder', label: 'Shared', type: 'folder', path: folder}, {id: 'file', label: 'Note', type: 'file', path: file}]
  }};
  const dom = await JSDOM.fromFile(path.resolve(__dirname, '..', 'src', 'renderer', 'index.html'), {
    runScripts: 'dangerously', resources: 'usable',
    beforeParse(window) {
      window.structuredClone = structuredClone;
      window.folderApp = {bootstrap: async () => ({settings, jobs: []}), listJobs: async () => [], rootStatus: async () => [],
        locationStatus: async items => items.map(item => ({...item, available: true})),
        listFolder: async target => ({path: target, entries: [], total: 0, nextOffset: null}),
        inspectFile: async target => ({path: target, type: 'MD', modified: null}),
        saveSettings: async ({data}) => ({...settings, data, revision: 'two'})};
    }
  });
  const pause = () => new Promise(resolve => setTimeout(resolve, 20));
  try {
    await new Promise(resolve => dom.window.addEventListener('load', resolve, {once: true})); await pause();
    dom.window.document.querySelector('[data-side="suggested"]').click();
    assert.equal(dom.window.document.querySelectorAll('#side-content [data-open-item]').length, 2);
    const fileRow = [...dom.window.document.querySelectorAll('#side-content [data-menu-path]')].find(node => node.dataset.menuPath === file);
    fileRow.dispatchEvent(new dom.window.MouseEvent('contextmenu', {bubbles: true, clientX: 10, clientY: 10}));
    assert.doesNotMatch(dom.window.document.querySelector('.item-menu').textContent, /Pin/);
    fileRow.querySelector('[data-open-item]').click(); await pause();
    assert.match(dom.window.document.querySelector('#beta-content').textContent, /Preview unavailable/);
    dom.window.document.querySelector('#home-add').click();
    dom.window.document.querySelector('[data-page="settings"]').click();
    dom.window.document.querySelector('[data-settings-area="shared"]').click();
    dom.window.document.querySelector('[data-editor="suggested"]').click();
    dom.window.document.querySelector('#suggest-add').click();
    dom.window.document.querySelector('#suggest-label').value = 'Extra';
    dom.window.document.querySelector('#suggest-path').value = 'C:\\Extra';
    dom.window.document.querySelector('#suggest-apply').click();
    assert.match(dom.window.document.querySelector('#settings-body').textContent, /Extra/);
    dom.window.document.querySelector('#save-settings').click(); await pause();
    assert.equal(settings.data.suggestedLocations.length, 2);
    assert.equal(dom.window.document.querySelectorAll('#side-content [data-open-item]').length, 3);
  } finally { dom.window.close(); }
});
