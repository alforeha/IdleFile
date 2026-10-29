'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const {writeAtomic} = require('../../platform/files');

const MAX_BYTES = 5 * 1024 * 1024;
const MARKDOWN = new Set(['.md', '.markdown']);
const TEXT = new Set(['.txt', '.log', '.csv', '.json', '.xml', '.yaml', '.yml', '.ini']);
const ID = /^[0-9a-f-]{36}$/i;
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function typeFor(file) {
  const ext = path.extname(file).toLowerCase();
  return MARKDOWN.has(ext) ? 'markdown' : TEXT.has(ext) ? 'text' : 'other';
}
function friendly(error) {
  if (['ENOENT', 'ENOTDIR'].includes(error.code)) return new Error('File is missing or unavailable. Your edits remain in this tab.');
  if (['EACCES', 'EPERM', 'EROFS', 'EBUSY', 'ETXTBSY'].includes(error.code)) return new Error('File is read-only, locked, or access was denied. Your edits remain in this tab.');
  return new Error(`File could not be saved: ${error.message}. Your edits remain in this tab.`);
}
async function facts(file) {
  const stat = await fs.stat(file);
  if (!stat.isFile()) throw new Error('This path is not a regular file.');
  return {path: file, name: path.basename(file), size: stat.size, modified: stat.mtime.toISOString(), version: `${stat.size}:${stat.mtimeMs}`, type: typeFor(file)};
}
async function readFile(file) {
  try {
    const info = await facts(file);
    if (info.type === 'other') return {...info, supported: false, reason: 'This file type does not have a viewer yet.'};
    if (info.size > MAX_BYTES) return {...info, supported: false, reason: 'Files over 5 MB use the placeholder viewer.'};
    const bytes = await fs.readFile(file);
    const digest = hash(bytes);
    if (bytes.includes(0)) return {...info, hash: digest, supported: false, reason: 'This file looks binary.'};
    const bom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
    const source = (bom ? bytes.subarray(3) : bytes).toString('utf8');
    if (source.includes('\ufffd')) return {...info, hash: digest, supported: false, reason: 'This file is not valid UTF-8 text.'};
    return {...info, hash: digest, supported: true, source: source.replace(/\r\n/g, '\n'), bom, lineEnding: source.includes('\r\n') ? 'CRLF' : 'LF'};
  } catch (error) { throw friendly(error); }
}
function bytesFor(source, original) {
  const bom = original.length >= 3 && original[0] === 0xef && original[1] === 0xbb && original[2] === 0xbf;
  const text = (bom ? original.subarray(3) : original).toString('utf8');
  const normalized = String(source).replace(/\r\n|\r/g, '\n');
  const output = text.includes('\r\n') ? normalized.replace(/\n/g, '\r\n') : normalized;
  return Buffer.concat([bom ? Buffer.from([0xef, 0xbb, 0xbf]) : Buffer.alloc(0), Buffer.from(output, 'utf8')]);
}
async function readHandle(handle) {
  const stat = await handle.stat();
  if (!stat.isFile() || stat.size > MAX_BYTES) throw new Error('Only an open text file up to 5 MB can be saved.');
  const bytes = Buffer.alloc(stat.size);
  let offset = 0;
  while (offset < bytes.length) {
    const result = await handle.read(bytes, offset, bytes.length - offset, offset);
    if (!result.bytesRead) throw new Error('File changed while reading it.');
    offset += result.bytesRead;
  }
  if ((await handle.stat()).size !== bytes.length) throw new Error('File changed while reading it.');
  return bytes;
}
function pointPaths(dir, id) { return {data: path.join(dir, `${id}.bin`), record: path.join(dir, `${id}.json`)}; }
async function removePoint(dir, id) {
  const point = pointPaths(dir, id);
  await fs.rm(point.record, {force: true});
  await fs.rm(point.data, {force: true});
}
async function createPoint(dir, file, bytes, stat) {
  await fs.mkdir(dir, {recursive: true});
  const id = crypto.randomUUID();
  const point = pointPaths(dir, id);
  const backup = await fs.open(point.data, 'wx', 0o600);
  try { await backup.writeFile(bytes); await backup.sync(); } finally { await backup.close(); }
  const record = {schemaVersion: 1, id, path: file, hash: hash(bytes), createdAt: new Date().toISOString(), dev: String(stat.dev), ino: String(stat.ino)};
  try { await writeAtomic(point.record, `${JSON.stringify(record, null, 2)}\n`); }
  catch (error) { await fs.rm(point.data, {force: true}); throw error; }
  return record;
}
async function listSavePoints(dir) {
  let names;
  try { names = await fs.readdir(dir); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const records = [];
  for (const name of names.filter(name => ID.test(name.slice(0, -5)) && name.endsWith('.json'))) {
    try {
      const record = JSON.parse(await fs.readFile(path.join(dir, name), 'utf8'));
      if (record.schemaVersion === 1 && `${record.id}.json` === name && typeof record.path === 'string') records.push(record);
    } catch { /* Keep an unreadable record for manual inspection. */ }
  }
  return records.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
async function getPoint(dir, id) {
  if (!ID.test(id)) throw new Error('Invalid save point.');
  const record = JSON.parse(await fs.readFile(pointPaths(dir, id).record, 'utf8'));
  if (record.id !== id || record.schemaVersion !== 1 || typeof record.path !== 'string') throw new Error('Invalid save point.');
  const bytes = await fs.readFile(pointPaths(dir, id).data);
  if (hash(bytes) !== record.hash) throw new Error('The saved original did not pass verification.');
  return {record, bytes};
}
async function writeInPlace(handle, bytes) {
  await handle.truncate(0);
  let offset = 0;
  while (offset < bytes.length) {
    const result = await handle.write(bytes, offset, bytes.length - offset, offset);
    if (!result.bytesWritten) throw new Error('No bytes were written.');
    offset += result.bytesWritten;
  }
  await handle.sync();
}
async function restoreSavePoint(dir, id) {
  const {record, bytes} = await getPoint(dir, id);
  const handle = await fs.open(record.path, 'r+');
  try {
    const stat = await handle.stat();
    if (String(stat.dev) !== record.dev || String(stat.ino) !== record.ino) throw new Error('The original file was replaced; restore was refused.');
    await writeInPlace(handle, bytes);
    if (hash(await readHandle(handle)) !== record.hash) throw new Error('Restored file failed verification.');
  } finally { await handle.close(); }
  await removePoint(dir, id);
}
async function dismissSavePoint(dir, id) { await getPoint(dir, id); await removePoint(dir, id); }
async function saveFile(file, source, expectedHash, overwrite = false, savePointDir, hooks = {}) {
  let handle, point, writeStarted = false;
  try {
    if (!savePointDir) throw new Error('Save-point folder is required.');
    if ((await fs.lstat(file)).isSymbolicLink()) throw new Error('Saving through a file link is not supported.');
    const before = await readFile(file);
    if (!before.supported) throw new Error('Only an open UTF-8 text file can be saved.');
    if (!overwrite && before.hash !== expectedHash) return {conflict: true, info: before};
    const stat = await fs.stat(file);
    if (!(stat.mode & 0o222)) throw Object.assign(new Error('Read-only file.'), {code: 'EACCES'});
    await fs.access(file, require('node:fs').constants.W_OK);
    handle = await fs.open(file, 'r+');
    const held = await handle.stat();
    if (String(held.dev) !== String(stat.dev) || String(held.ino) !== String(stat.ino)) throw new Error('File changed while opening it.');
    const current = await readHandle(handle);
    if (!overwrite && hash(current) !== expectedHash) return {conflict: true, info: await readFile(file)};
    const bytes = bytesFor(source, current);
    if (bytes.length > MAX_BYTES) throw new Error('The edited file exceeds 5 MB. Nothing was written; your edits remain in this tab.');
    // Overwrite accepts the current bytes as the original, so recovery restores the precise pre-write state.
    point = await createPoint(savePointDir, file, current, held);
    const finalBytes = await readHandle(handle);
    if (hash(finalBytes) !== hash(current)) return {conflict: true, info: await readFile(file)};
    writeStarted = true;
    await writeInPlace(handle, bytes);
    await hooks.afterWrite?.();
    if (hash(await readHandle(handle)) !== hash(bytes)) throw new Error('Saved file failed verification.');
    await handle.close(); handle = null;
    await removePoint(savePointDir, point.id); point = null;
    return {conflict: false, info: await readFile(file)};
  } catch (error) {
    if (writeStarted && point) {
      try {
        if (handle) { await handle.close(); handle = null; }
        await restoreSavePoint(savePointDir, point.id);
        point = null;
      } catch (restoreError) {
        throw new Error(`${friendly(error).message} Automatic restore failed: ${restoreError.message}. The original is kept in the app's save points.`);
      }
    }
    throw friendly(error);
  } finally {
    if (handle) await handle.close().catch(() => {});
    if (point && !writeStarted) await removePoint(savePointDir, point.id).catch(() => {});
  }
}
module.exports = {MAX_BYTES, typeFor, readFile, saveFile, facts, listSavePoints, restoreSavePoint, dismissSavePoint};
