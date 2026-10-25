'use strict';

// Explorer rules: which folders are inside the configured roots, and paged directory listings.

const fs = require('node:fs/promises');
const path = require('node:path');

const PAGE_SIZE = 500;

// The one place that reads where roots are stored; the planned move to local settings changes only this.
function configuredRoots(localRoots) { return localRoots; }

function entryKind(entry) {
  if (entry.isDirectory()) return 'folder';
  return entry.isSymbolicLink() ? 'link' : 'file';
}

async function listDirectoryPage(actual, offset = 0, pageSize = PAGE_SIZE, sort = 'name', direction = 'asc') {
  const entries = await fs.readdir(actual, {withFileTypes: true});
  const folderFirst = item => (item.kind === 'folder' ? 0 : 1);
  const mapped = entries.map(e => ({name: e.name, path: path.join(actual, e.name), kind: entryKind(e)}));
  async function withModified(item) {
    let modified = null;
    try { modified = (await fs.lstat(item.path)).mtime.toISOString(); }
    catch { /* Keep the entry visible when its metadata cannot be read. */ }
    return {...item, modified};
  }
  const sortable = sort === 'modified' ? await Promise.all(mapped.map(withModified)) : mapped;
  const multiplier = direction === 'desc' ? -1 : 1;
  const sorted = sortable.sort((a, b) => folderFirst(a) - folderFirst(b) || multiplier * (
    sort === 'modified' ? (a.modified || '').localeCompare(b.modified || '') :
    sort === 'type' ? path.extname(a.name).localeCompare(path.extname(b.name)) : 0
  ) || multiplier * a.name.localeCompare(b.name));
  const start = Number.isInteger(offset) && offset >= 0 ? offset : 0;
  const page = sorted.slice(start, start + pageSize);
  return {
    path: actual,
    total: sorted.length,
    nextOffset: start + pageSize < sorted.length ? start + pageSize : null,
    entries: sort === 'modified' ? page : await Promise.all(page.map(withModified))
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
  throw new Error('Folder is outside local Explorer roots. Add its parent folder in Explorer before creating or opening a project.');
}

async function listConfiguredFolder(roots, target, offset = 0, sort = 'name', direction = 'asc') {
  const actual = await requireConfiguredRoot(target, configuredRoots(roots));
  if (!(await fs.stat(actual)).isDirectory()) throw new Error('This path is not a folder.');
  return listDirectoryPage(actual, offset, PAGE_SIZE, sort, direction);
}

async function inspectConfiguredFile(roots, target) {
  const actual = await requireConfiguredRoot(target, roots);
  const info = await fs.stat(actual);
  if (!info.isFile()) throw new Error('This path is not a file.');
  return {path: actual, name: path.basename(actual), type: path.extname(actual).slice(1).toUpperCase() || 'File', modified: info.mtime.toISOString()};
}

module.exports = {configuredRoots, listDirectoryPage, requireConfiguredRoot, listConfiguredFolder, inspectConfiguredFile};
