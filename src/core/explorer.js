'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');

async function listDirectoryPage(actual, offset = 0, pageSize = 500) {
  const entries = await fs.readdir(actual, {withFileTypes: true});
  const sorted = entries.map(e => ({name: e.name, path: path.join(actual, e.name), kind: e.isDirectory() ? 'folder' : e.isSymbolicLink() ? 'link' : 'file'})).sort((a, b) => (a.kind === 'folder' ? 0 : 1) - (b.kind === 'folder' ? 0 : 1) || a.name.localeCompare(b.name));
  const start = Number.isInteger(offset) && offset >= 0 ? offset : 0;
  return {path: actual, total: sorted.length, nextOffset: start + pageSize < sorted.length ? start + pageSize : null, entries: sorted.slice(start, start + pageSize)};
}
async function requireConfiguredRoot(target, roots) {
  const actual = await fs.realpath(target);
  for (const root of roots) {
    try {
      const canonicalRoot = await fs.realpath(root);
      const diff = path.relative(canonicalRoot, actual);
      if (!diff || (diff !== '..' && !diff.startsWith(`..${path.sep}`) && !path.isAbsolute(diff))) return actual;
    } catch (error) { if (error.code !== 'ENOENT' && error.code !== 'ENOTCONN') throw error; }
  }
  throw new Error('Folder is outside saved Explorer roots. Add its parent drive folder in Settings before creating or opening a project.');
}
module.exports = {listDirectoryPage, requireConfiguredRoot};
