'use strict';

// Explorer rules: which folders are inside the configured roots, and paged directory listings.

const fs = require('node:fs/promises');
const path = require('node:path');

const PAGE_SIZE = 500;

// The one place that reads where roots are stored; the planned move to local settings changes only this.
function configuredRoots(settings) {
  return settings.data.standards.roots;
}

function entryKind(entry) {
  if (entry.isDirectory()) return 'folder';
  return entry.isSymbolicLink() ? 'link' : 'file';
}

async function listDirectoryPage(actual, offset = 0, pageSize = PAGE_SIZE) {
  const entries = await fs.readdir(actual, {withFileTypes: true});
  const folderFirst = item => (item.kind === 'folder' ? 0 : 1);
  const sorted = entries
    .map(e => ({name: e.name, path: path.join(actual, e.name), kind: entryKind(e)}))
    .sort((a, b) => folderFirst(a) - folderFirst(b) || a.name.localeCompare(b.name));
  const start = Number.isInteger(offset) && offset >= 0 ? offset : 0;
  return {
    path: actual,
    total: sorted.length,
    nextOffset: start + pageSize < sorted.length ? start + pageSize : null,
    entries: sorted.slice(start, start + pageSize)
  };
}

// Resolves links and junctions before comparing, so a path cannot escape the roots through one.
async function requireConfiguredRoot(target, roots) {
  const actual = await fs.realpath(target);
  for (const root of roots) {
    try {
      const diff = path.relative(await fs.realpath(root), actual);
      if (!diff || (diff !== '..' && !diff.startsWith(`..${path.sep}`) && !path.isAbsolute(diff))) return actual;
    } catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'ENOTCONN') throw error;
    }
  }
  throw new Error('Folder is outside saved Explorer roots. Add its parent drive folder in Settings before creating or opening a project.');
}

async function listConfiguredFolder(settings, target, offset = 0) {
  const actual = await requireConfiguredRoot(target, configuredRoots(settings));
  return listDirectoryPage(actual, offset);
}

module.exports = {configuredRoots, listDirectoryPage, requireConfiguredRoot, listConfiguredFolder};
