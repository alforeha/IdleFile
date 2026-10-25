'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const {listDirectoryPage, listConfiguredFolder, inspectConfiguredFile, requireConfiguredRoot} = require('../src/features/explorer/explorer');
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

test('folder sorting is global, metadata is real, and removed roots deny browsing', async t => {
  const dir = await scratch(t);
  const root = path.join(dir, 'root');
  await fs.mkdir(root);
  await fs.mkdir(path.join(root, 'Folder'));
  await fs.writeFile(path.join(root, 'b.md'), '# Beta');
  await fs.writeFile(path.join(root, 'a.pdf'), 'PDF');
  const listing = await listConfiguredFolder([root], root, 0, 'type', 'desc');
  assert.deepEqual(listing.entries.map(item => item.name), ['Folder', 'a.pdf', 'b.md']);
  assert.ok(listing.entries.every(item => item.modified && !Number.isNaN(Date.parse(item.modified))));
  assert.equal((await inspectConfiguredFile([root], path.join(root, 'b.md'))).type, 'MD');
  await assert.rejects(listConfiguredFolder([], root), /outside local Explorer roots/);
  await assert.rejects(inspectConfiguredFile([], path.join(root, 'b.md')), /outside local Explorer roots/);
});
