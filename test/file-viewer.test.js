'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {spawn} = require('node:child_process');
const {readFile, saveFile, typeFor, MAX_BYTES, listSavePoints, restoreSavePoint} = require('../src/features/file-viewer/service');

async function fixture(run) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'folder-viewer-'));
  try { await run(dir, path.join(dir, 'points')); }
  finally { await fs.rm(dir, {recursive: true, force: true}); }
}

test('in-place save preserves BOM, CRLF, creation time, inode, hard links and named stream', () => fixture(async (dir, points) => {
  const file = path.join(dir, 'notes.md'), link = path.join(dir, 'linked.md');
  await fs.writeFile(file, Buffer.from([0xef, 0xbb, 0xbf, ...Buffer.from('# First\r\nline\r\n')]));
  await fs.link(file, link);
  let stream = false;
  if (process.platform === 'win32') {
    try { await fs.writeFile(`${file}:viewer-test`, 'stream-data'); stream = true; } catch { /* Filesystem may not support named streams. */ }
    assert.equal(stream, true, 'local NTFS test volume must permit a named stream');
  }
  const opened = await readFile(file), before = await fs.stat(file);
  assert.equal(opened.source, '# First\nline\n');
  assert.equal(opened.bom, true);
  assert.equal(opened.lineEnding, 'CRLF');
  const saved = await saveFile(file, '# First\nchanged\n', opened.hash, false, points);
  assert.equal(saved.conflict, false);
  const expected = Buffer.from([0xef, 0xbb, 0xbf, ...Buffer.from('# First\r\nchanged\r\n')]);
  assert.deepEqual(await fs.readFile(file), expected);
  assert.deepEqual(await fs.readFile(link), expected);
  const after = await fs.stat(file);
  assert.equal(after.birthtimeMs, before.birthtimeMs);
  assert.equal(after.ino, before.ino);
  if (stream) assert.equal(await fs.readFile(`${file}:viewer-test`, 'utf8'), 'stream-data');
  assert.deepEqual(await listSavePoints(points), []);
  assert.deepEqual((await fs.readdir(dir)).sort(), ['linked.md', 'notes.md', 'points']);
  assert.equal(typeFor('x.markdown'), 'markdown');
  for (const ext of ['txt', 'log', 'csv', 'json', 'xml', 'yaml', 'yml', 'ini']) assert.equal(typeFor(`x.${ext}`), 'text');
  assert.equal(typeFor('x.pdf'), 'other');
}));

test('hash catches same-size same-timestamp edit and overwrite resolves it', () => fixture(async (dir, points) => {
  const file = path.join(dir, 'note.txt');
  await fs.writeFile(file, 'one\n');
  const opened = await readFile(file), stamp = (await fs.stat(file)).mtime;
  await fs.writeFile(file, 'two\n');
  await fs.utimes(file, stamp, stamp);
  const conflict = await saveFile(file, 'mine\n', opened.hash, false, points);
  assert.equal(conflict.conflict, true);
  assert.equal(await fs.readFile(file, 'utf8'), 'two\n');
  assert.equal((await saveFile(file, 'mine\n', opened.hash, true, points)).conflict, false);
  assert.equal(await fs.readFile(file, 'utf8'), 'mine\n');
}));

test('output over 5 MiB is refused with edits and disk intact', () => fixture(async (dir, points) => {
  const file = path.join(dir, 'note.txt');
  await fs.writeFile(file, 'keep\n');
  const opened = await readFile(file);
  await assert.rejects(saveFile(file, 'x'.repeat(MAX_BYTES + 1), opened.hash, false, points), /exceeds 5 MB/);
  assert.equal(await fs.readFile(file, 'utf8'), 'keep\n');
  assert.deepEqual(await listSavePoints(points), []);
  await fs.writeFile(file, Buffer.from([65, 0, 66]));
  assert.match((await readFile(file)).reason, /binary/);
  await fs.writeFile(file, Buffer.alloc(MAX_BYTES + 1, 65));
  assert.match((await readFile(file)).reason, /5 MB/);
}));

test('simulated mid-write failure restores original from save point', () => fixture(async (dir, points) => {
  const file = path.join(dir, 'note.txt');
  await fs.writeFile(file, 'keep\n');
  const opened = await readFile(file);
  await assert.rejects(saveFile(file, 'new\n', opened.hash, false, points, {afterWrite: () => { throw new Error('simulated failure'); }}), /simulated failure/);
  assert.equal(await fs.readFile(file, 'utf8'), 'keep\n');
  assert.deepEqual(await listSavePoints(points), []);
}));

test('leftover save point can restore original after startup', () => fixture(async (dir, points) => {
  const file = path.join(dir, 'note.txt');
  await fs.writeFile(file, 'before\n');
  const opened = await readFile(file);
  // Force the automatic restore to fail once, leaving the journal for the next launch.
  const originalOpen = fs.open;
  let restoreAttempts = 0;
  fs.open = async (...args) => {
    if (args[0] === file && args[1] === 'r+' && ++restoreAttempts === 2) throw new Error('share disconnected');
    return originalOpen(...args);
  };
  try { await assert.rejects(saveFile(file, 'after\n', opened.hash, false, points, {afterWrite: () => { throw new Error('fault'); }}), /Automatic restore failed/); }
  finally { fs.open = originalOpen; }
  const pending = await listSavePoints(points);
  assert.equal(pending.length, 1);
  assert.equal(pending[0].path, file);
  await restoreSavePoint(points, pending[0].id);
  assert.equal(await fs.readFile(file, 'utf8'), 'before\n');
  assert.deepEqual(await listSavePoints(points), []);
}));

test('read-only and missing files are refused without changes', () => fixture(async (dir, points) => {
  const file = path.join(dir, 'note.txt');
  await fs.writeFile(file, 'keep\n');
  const opened = await readFile(file);
  await fs.chmod(file, 0o444);
  await assert.rejects(saveFile(file, 'lost\n', opened.hash, false, points), /read-only/);
  assert.equal(await fs.readFile(file, 'utf8'), 'keep\n');
  await fs.chmod(file, 0o666);
  await fs.rename(file, `${file}.offline`);
  await assert.rejects(saveFile(file, 'lost\n', opened.hash, false, points), /missing or unavailable/);
}));

test('hidden attribute survives in-place save on Windows', {skip: process.platform !== 'win32'}, () => fixture(async (dir, points) => {
  const file = path.join(dir, 'hidden.txt');
  await fs.writeFile(file, 'old');
  const {execFileSync} = require('node:child_process');
  execFileSync('attrib', ['+H', file]);
  const before = execFileSync('attrib', [file], {encoding: 'utf8'});
  const opened = await readFile(file);
  await saveFile(file, 'new', opened.hash, false, points);
  const after = execFileSync('attrib', [file], {encoding: 'utf8'});
  assert.equal(after.match(/^\s*([A-Z\s]+?)\s+[A-Z]:/m)?.[1], before.match(/^\s*([A-Z\s]+?)\s+[A-Z]:/m)?.[1]);
}));

test('exclusive Windows lock refuses save before changing file', {skip: process.platform !== 'win32'}, () => fixture(async (dir, points) => {
  const file = path.join(dir, 'locked.txt');
  await fs.writeFile(file, 'old');
  const opened = await readFile(file);
  const script = '$h=[System.IO.File]::Open($env:VIEWER_LOCK_FILE,[System.IO.FileMode]::Open,[System.IO.FileAccess]::ReadWrite,[System.IO.FileShare]::None); [Console]::WriteLine("LOCKED"); [Console]::ReadLine() | Out-Null; $h.Dispose()';
  const child = spawn('powershell', ['-NoProfile', '-Command', script], {env: {...process.env, VIEWER_LOCK_FILE: file}, stdio: ['pipe', 'pipe', 'pipe']});
  try {
    await new Promise((resolve, reject) => { child.stdout.once('data', data => data.toString().includes('LOCKED') ? resolve() : reject(new Error(data.toString()))); child.once('error', reject); });
    await assert.rejects(saveFile(file, 'new', opened.hash, false, points), /locked|access was denied/);
  } finally {
    child.stdin.write('\n'); child.stdin.end();
    await new Promise(resolve => child.once('exit', resolve));
  }
  assert.equal(await fs.readFile(file, 'utf8'), 'old');
}));
