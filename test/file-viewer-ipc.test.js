'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

test('IPC read grants no write access; open handle is bound to file and revoked on close', async () => {
  const handlers = new Map();
  const electron = {dialog: {}, ipcMain: {handle: (name, fn) => handlers.set(name, fn)}, BrowserWindow: {fromWebContents: () => ({})}, shell: {openExternal: async () => {}}};
  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) { return request === 'electron' ? electron : originalLoad.call(this, request, parent, isMain); };
  let registerIpc;
  try { ({registerIpc} = require('../src/app/ipc')); }
  finally { Module._load = originalLoad; }
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'folder-viewer-ipc-'));
  registerIpc({session: {}, projects: {}, savePointDir: path.join(dir, 'points')});
  try {
    const file = path.join(dir, 'outside.txt'), other = path.join(dir, 'other.txt');
    await fs.writeFile(file, 'before\n');
    await fs.writeFile(other, 'other\n');
    const event = {sender: {}};
    assert.equal((await handlers.get('viewer.read')(event, file)).source, 'before\n');
    await assert.rejects(handlers.get('viewer.save')(event, 'no-handle', 'after\n', false), /open file tab/);
    const {handle, info} = await handlers.get('viewer.open')(event, file);
    assert.equal(info.source, 'before\n');
    await assert.rejects(handlers.get('viewer.save')({sender: {}}, handle, 'wrong sender\n', false), /open file tab/);
    const saved = await handlers.get('viewer.save')(event, handle, 'after\n', false);
    assert.equal(saved.conflict, false);
    assert.equal(await fs.readFile(file, 'utf8'), 'after\n');
    // Extra renderer arguments cannot redirect a handle to another path.
    await handlers.get('viewer.save')(event, handle, 'again\n', false, other);
    assert.equal(await fs.readFile(file, 'utf8'), 'again\n');
    assert.equal(await fs.readFile(other, 'utf8'), 'other\n');
    await fs.writeFile(file, 'external\n');
    assert.equal((await handlers.get('viewer.reload')(event, handle)).source, 'external\n');
    assert.equal((await handlers.get('viewer.save')(event, handle, 'accepted\n', false)).conflict, false);
    assert.equal(await fs.readFile(file, 'utf8'), 'accepted\n');
    handlers.get('viewer.closed')(event, handle);
    await assert.rejects(handlers.get('viewer.reload')(event, handle), /open file tab/);
    await assert.rejects(handlers.get('viewer.save')(event, handle, 'late\n', false), /open file tab/);
    assert.deepEqual(await handlers.get('viewer.save-points')(), []);
  } finally { await fs.rm(dir, {recursive: true, force: true}); }
});
