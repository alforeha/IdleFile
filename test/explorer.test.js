'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const {listDirectoryPage, inspectFile, requireConfiguredRoot, fullPath, mapLimited} = require('../src/features/explorer/explorer');
const {scratch} = require('./helpers');

test('explorer pagination reaches entries after the first 500', async t => {
  const dir = await scratch(t);
  await Promise.all(Array.from({length: 501}, (_, index) => fs.writeFile(path.join(dir, `item-${String(index).padStart(3, '0')}.txt`), '')));
  const first = await listDirectoryPage(dir);
  assert.equal(first.entries.length, 500);
  assert.equal(first.nextOffset, 500);
  const second = await listDirectoryPage(dir, first.nextOffset);
  assert.equal(second.entries.length, 1);
  assert.equal(second.entries[0].name, 'item-500.txt');
  assert.equal(second.nextOffset, null);
});

test('tree pages put all files before folders, including directory links', async t => {
  const dir = await scratch(t);
  const outside = await scratch(t);
  await fs.mkdir(path.join(dir, 'ordinary-folder'));
  await Promise.all(Array.from({length: 501}, (_, index) => fs.writeFile(path.join(dir, `file-${String(index).padStart(3, '0')}.txt`), '')));
  try { await fs.symlink(outside, path.join(dir, 'linked-folder'), process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { if (['EPERM', 'EACCES'].includes(error.code)) return t.skip('directory links require local privilege'); throw error; }
  const first = await listDirectoryPage(dir, 0, 500, 'tree');
  const second = await listDirectoryPage(dir, 500, 500, 'tree');
  assert.equal(first.entries.length, 500);
  assert.ok(first.entries.every(item => item.kind === 'file'));
  assert.deepEqual(second.entries.map(item => [item.name, item.kind]), [
    ['file-500.txt', 'file'], ['linked-folder', 'folder'], ['ordinary-folder', 'folder']
  ]);
  const main = await listDirectoryPage(dir);
  assert.deepEqual(main.entries.slice(0, 2).map(item => item.name), ['linked-folder', 'ordinary-folder']);
});

test('project parent must be under a saved explorer root for reopening', async t => {
  const dir = await scratch(t);
  const root = path.join(dir, 'shared-root');
  const projectParent = path.join(root, 'Projects');
  const other = path.join(dir, 'unconfigured');
  await fs.mkdir(projectParent, {recursive: true});
  await fs.mkdir(other);
  assert.equal(await requireConfiguredRoot(projectParent, [root]), await fs.realpath(projectParent));
  await assert.rejects(requireConfiguredRoot(other, [root]), /outside local Explorer roots/);
});

test('folder sorting is global, metadata is real, and browsing is independent of roots', async t => {
  const dir = await scratch(t);
  const root = path.join(dir, 'root');
  await fs.mkdir(root);
  await fs.mkdir(path.join(root, 'Folder'));
  await fs.writeFile(path.join(root, 'b.md'), '# Beta');
  await fs.writeFile(path.join(root, 'a.pdf'), 'PDF');
  const listing = await listDirectoryPage(root, 0, 500, 'type', 'desc');
  assert.deepEqual(listing.entries.map(item => item.name), ['Folder', 'a.pdf', 'b.md']);
  assert.ok(listing.entries.every(item => item.modified && !Number.isNaN(Date.parse(item.modified))));
  assert.equal((await inspectFile(path.join(root, 'b.md'))).type, 'MD');
  assert.equal((await listDirectoryPage(dir)).entries[0].name, 'root');
  assert.throws(() => fullPath('relative/folder'), /full local or network path/);
  assert.throws(() => fullPath('C:\\bad?name'), /Invalid Windows path segment/);
  assert.throws(() => fullPath('\\on-current-drive'), /full drive or UNC path/);
});

test('metadata worker concurrency stays bounded and folder read errors remain visible', async t => {
  let active = 0, peak = 0;
  const values = await mapLimited(Array.from({length: 70}, (_, index) => index), async index => {
    active++; peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 1));
    active--; return index;
  });
  assert.deepEqual(values, Array.from({length: 70}, (_, index) => index));
  assert.ok(peak <= 8);
  const dir = await scratch(t);
  const original = fs.readdir;
  fs.readdir = async () => { const error = new Error('Access denied'); error.code = 'EACCES'; throw error; };
  try { await assert.rejects(listDirectoryPage(dir), {code: 'EACCES'}); }
  finally { fs.readdir = original; }
});
