'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const {
  loadSettings, openExistingSettings, createNewSettings, saveSettings, selectedUserAfterReload, validateSettings
} = require('../src/features/settings/shared-settings');
const {loadLocalSettings, saveLocalSettings} = require('../src/platform/local-settings');
const {createSettingsSession} = require('../src/features/settings/session');
const {scratch, fixture} = require('./helpers');

async function unusedDriveRoot() {
  for (const letter of 'QRSTUVWXYZ') {
    try {
      await fs.stat(`${letter}:\\`);
    } catch (error) {
      if (error.code === 'ENOENT') return `${letter}:\\`;
    }
  }
  return null;
}

test('shared settings save, reopen, stale revision conflict, and deleted identity', async t => {
  const dir = await scratch(t);
  const file = path.join(dir, 'folderapp.json');
  const first = await loadSettings(file);
  first.data.standards.docTemplates = fixture().templates;
  first.data.standards.structures = [fixture().structure];
  const saved = await saveSettings(file, first.data, first.revision);
  const reopened = await loadSettings(file);
  assert.equal(reopened.revision, saved.revision);
  assert.equal(reopened.data.standards.structures[0].name, 'Generic');
  await assert.rejects(saveSettings(file, first.data, first.revision), /changed since/);
  const userId = reopened.data.users[0].id;
  assert.equal(selectedUserAfterReload(reopened.data.users, userId), userId);
  assert.equal(selectedUserAfterReload([{id: 'another'}], userId), null);
});

test('a missing shared file in a reachable folder is created on disk with valid defaults', async t => {
  const dir = await scratch(t);
  const file = path.join(dir, 'folderapp.json');
  const created = await loadSettings(file);
  const onDisk = JSON.parse(await fs.readFile(file, 'utf8'));
  assert.doesNotThrow(() => validateSettings(onDisk));
  assert.equal(onDisk.users[0].position, 'Admin');
  assert.deepEqual(onDisk.standards.structures, []);
  assert.equal((await loadSettings(file)).revision, created.revision);
});

test('an unreachable shared folder is reported and nothing is created', async t => {
  const dir = await scratch(t);
  const missingFolder = path.join(dir, 'disconnected-share');
  await assert.rejects(loadSettings(path.join(missingFolder, 'folderapp.json')), /cannot be reached.*Nothing was created/s);
  await assert.rejects(fs.stat(missingFolder), {code: 'ENOENT'});
  // A directory where the file should be is an unreadable file, not a missing one.
  await fs.mkdir(path.join(dir, 'folderapp.json'));
  await assert.rejects(loadSettings(path.join(dir, 'folderapp.json')), /cannot be reached/);
});

test('an unmapped drive letter behaves like a disconnected mapped drive', async t => {
  const drive = await unusedDriveRoot();
  if (!drive) return t.skip('no unused drive letter');
  await assert.rejects(loadSettings(path.join(drive, 'Shared', 'folderapp.json')), /cannot be reached/);
});

test('invalid or unsupported shared files produce an error and stay byte-for-byte intact', async t => {
  const dir = await scratch(t);
  const broken = path.join(dir, 'broken.json');
  const unsupported = path.join(dir, 'future.json');
  await fs.writeFile(broken, '{"schemaVersion": 1, "users": [');
  await fs.writeFile(unsupported, '{"schemaVersion": 99}\n');
  await assert.rejects(loadSettings(broken), /not valid JSON.*left unchanged/s);
  await assert.rejects(loadSettings(unsupported), /Unsupported settings schema.*left unchanged/s);
  await assert.rejects(openExistingSettings(broken), /not valid JSON/);
  assert.equal(await fs.readFile(broken, 'utf8'), '{"schemaVersion": 1, "users": [');
  assert.equal(await fs.readFile(unsupported, 'utf8'), '{"schemaVersion": 99}\n');
});

test('open existing never creates and create new never replaces', async t => {
  const dir = await scratch(t);
  const file = path.join(dir, 'folderapp.json');
  await assert.rejects(openExistingSettings(file), /does not exist/);
  await assert.rejects(fs.stat(file), {code: 'ENOENT'});
  await createNewSettings(file);
  const before = await fs.readFile(file, 'utf8');
  await assert.rejects(createNewSettings(file), /already exists/);
  assert.equal(await fs.readFile(file, 'utf8'), before);
});

test('local settings are created when missing, keep older fields, and stay intact when invalid', async t => {
  const dir = await scratch(t);
  const file = path.join(dir, 'profile', 'local.json');
  assert.deepEqual(await loadLocalSettings(file), {schemaVersion: 1, settingsPath: null, userId: null});
  assert.equal(JSON.parse(await fs.readFile(file, 'utf8')).schemaVersion, 1);

  // A file from the checkpoint build has no schemaVersion; it loads and keeps unknown fields on save.
  await fs.writeFile(file, JSON.stringify({settingsPath: 'P:\\folderapp.json', userId: 'u1', later: {keep: true}}));
  const legacy = await loadLocalSettings(file);
  assert.equal(legacy.settingsPath, 'P:\\folderapp.json');
  await saveLocalSettings(file, {...legacy, userId: 'u2'});
  assert.deepEqual(JSON.parse(await fs.readFile(file, 'utf8')).later, {keep: true});

  await fs.writeFile(file, 'not json');
  await assert.rejects(loadLocalSettings(file), /Local settings.*not valid JSON/s);
  assert.equal(await fs.readFile(file, 'utf8'), 'not json');
});

test('session remembers shared path and user across restarts and keeps the path while unreachable', async t => {
  const dir = await scratch(t);
  const localFile = path.join(dir, 'profile', 'local.json');
  const shareFolder = path.join(dir, 'share');
  const sharedFile = path.join(shareFolder, 'folderapp.json');
  await fs.mkdir(shareFolder);

  const first = createSettingsSession({localFile});
  await first.loadLocal();
  const created = await first.useNew(sharedFile);
  const adminId = created.data.users[0].id;
  await first.selectUser(adminId);

  const restarted = createSettingsSession({localFile});
  await restarted.loadLocal();
  const reopened = await restarted.current();
  assert.equal(reopened.path, sharedFile);
  assert.equal(reopened.selectedUserId, adminId);

  await fs.rename(shareFolder, `${shareFolder}-offline`);
  await assert.rejects(restarted.current(), /cannot be reached/);
  assert.equal(restarted.status().settingsPath, sharedFile);
  await assert.rejects(fs.stat(shareFolder), {code: 'ENOENT'});
  await fs.rename(`${shareFolder}-offline`, shareFolder);
  assert.equal((await restarted.current()).selectedUserId, adminId);
});

test('session does not overwrite an invalid local file', async t => {
  const dir = await scratch(t);
  const localFile = path.join(dir, 'local.json');
  await fs.writeFile(localFile, '{"schemaVersion": 7}');
  const session = createSettingsSession({localFile});
  await session.loadLocal();
  assert.match(session.status().localError, /Unsupported local settings schema/);
  assert.equal(await session.current(), null);
  await assert.rejects(session.useNew(path.join(dir, 'folderapp.json')), /not saved/);
  assert.equal(await fs.readFile(localFile, 'utf8'), '{"schemaVersion": 7}');
});
