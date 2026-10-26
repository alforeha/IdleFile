'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const PAGE_SIZE = 500;
const METADATA_CONCURRENCY = 8;
let activeMetadata = 0;
const waitingMetadata = [];

async function bounded(worker) {
  if (activeMetadata >= METADATA_CONCURRENCY) await new Promise(resolve => waitingMetadata.push(resolve));
  else activeMetadata++;
  try { return await worker(); }
  finally {
    if (waitingMetadata.length) waitingMetadata.shift()();
    else activeMetadata--;
  }
}

function fullPath(target) {
  if (typeof target !== 'string' || !target.trim() || !path.isAbsolute(target) || target.includes('\0'))
    throw new Error('Enter a full local or network path.');
  if (process.platform === 'win32') {
    if (!/^[A-Za-z]:[\\/]/.test(target) && !/^\\\\[^\\/]+[\\/][^\\/]+/.test(target))
      throw new Error('Enter a full drive or UNC path.');
    const tail = target.slice(path.parse(target).root.length);
    const reserved = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$/i;
    for (const segment of tail.split(/[\\/]+/).filter(Boolean)) {
      if (/[<>:"|?*\x00-\x1f]/.test(segment) || /[. ]$/.test(segment) || reserved.test(segment))
        throw new Error(`Invalid Windows path segment: ${segment}`);
    }
  }
  return path.normalize(target);
}

async function resolvedKind(target) {
  const requested = fullPath(target);
  const actual = await fs.realpath(requested);
  const stat = await fs.stat(actual);
  return {path: requested, actual, kind: stat.isDirectory() ? 'folder' : stat.isFile() ? 'file' : 'other'};
}

async function mapLimited(items, worker, limit = METADATA_CONCURRENCY) {
  const result = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({length: Math.min(limit, items.length)}, async () => {
    while (next < items.length) { const index = next++; result[index] = await bounded(() => worker(items[index])); }
  }));
  return result;
}

async function hasChild(folder) {
  let handle;
  try { handle = await fs.opendir(folder); return !(await handle.read()) ? 'empty' : null; }
  catch (error) { return ['ENOENT', 'EACCES', 'EPERM', 'ENOTCONN', 'ENETUNREACH', 'EHOSTUNREACH', 'ETIMEDOUT', 'EIO', 'ENODEV'].includes(error.code) ? 'unavailable' : null; }
  finally { if (handle) await handle.close(); }
}

async function listDirectoryPage(folder, offset = 0, pageSize = PAGE_SIZE, sort = 'name', direction = 'asc') {
  const {kind} = await resolvedKind(folder);
  if (kind !== 'folder') throw new Error('This path is not a folder.');
  const actual = fullPath(folder);
  const entries = await fs.readdir(actual, {withFileTypes: true});
  const mapped = entries.map(entry => ({name: entry.name, path: path.join(actual, entry.name), kind: entry.isDirectory() ? 'folder' : entry.isSymbolicLink() ? 'link' : 'file'}));
  async function metadata(item) {
    let modified = null;
    let kind = item.kind;
    try {
      const stat = await fs.stat(item.path);
      modified = stat.mtime.toISOString();
      if (kind === 'link') kind = stat.isDirectory() ? 'folder' : 'file';
    } catch { /* A disappearing entry remains visible until refresh. */ }
    return {...item, kind, modified};
  }
  // Resolve links before sorting: a linked directory belongs with directories on every page.
  const sortable = await mapLimited(mapped, item => item.kind === 'link' || sort === 'modified' ? metadata(item) : item);
  const multiplier = direction === 'desc' ? -1 : 1;
  const treeOrder = sort === 'tree';
  sortable.sort((a, b) => (a.kind === 'folder' ? (treeOrder ? 1 : 0) : (treeOrder ? 0 : 1)) - (b.kind === 'folder' ? (treeOrder ? 1 : 0) : (treeOrder ? 0 : 1)) || multiplier * (
    sort === 'modified' ? (a.modified || '').localeCompare(b.modified || '') :
    sort === 'type' ? path.extname(a.name).localeCompare(path.extname(b.name)) : 0
  ) || multiplier * a.name.localeCompare(b.name));
  const start = Number.isInteger(offset) && offset >= 0 ? offset : 0;
  const count = Math.min(PAGE_SIZE, Number.isInteger(pageSize) && pageSize > 0 ? pageSize : PAGE_SIZE);
  const page = sort === 'modified' ? sortable.slice(start, start + count) : await mapLimited(sortable.slice(start, start + count), metadata);
  const checked = await mapLimited(page, async item => item.kind === 'folder' ? {...item, status: await hasChild(item.path)} : item);
  return {path: actual, total: sortable.length, nextOffset: start + count < sortable.length ? start + count : null, entries: checked};
}

// Project creation alone continues to require a saved local root.
async function requireConfiguredRoot(target, roots) {
  const actual = (await resolvedKind(target)).actual;
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

async function inspectFile(target) {
  const info = await resolvedKind(target);
  if (info.kind !== 'file') throw new Error('This path is not a file.');
  const stat = await fs.stat(info.actual);
  return {path: info.path, name: path.basename(info.path), type: path.extname(info.path).slice(1).toUpperCase() || 'File', modified: stat.mtime.toISOString()};
}

module.exports = {PAGE_SIZE, METADATA_CONCURRENCY, fullPath, resolvedKind, mapLimited, hasChild, listDirectoryPage, requireConfiguredRoot, inspectFile};
