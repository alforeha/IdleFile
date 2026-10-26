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
  assert.deepEqual(await loadLocalSettings(file), {schemaVersion: 2, settingsPath: null, userId: null, explorerRoots: [], folderPins: [], theme: 'system'});
  assert.equal(JSON.parse(await fs.readFile(file, 'utf8')).schemaVersion, 2);

  // A file from the checkpoint build has no schemaVersion; it loads and keeps unknown fields on save.
  await fs.writeFile(file, JSON.stringify({settingsPath: 'P:\\folderapp.json', userId: 'u1', later: {keep: true}}));
  const legacy = await loadLocalSettings(file);
  assert.equal(legacy.schemaVersion, 1);
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

test('version-1 roots import once, stay local, and a reset starts empty', async t => {
  const dir = await scratch(t);
  const sharedFile = path.join(dir, 'shared.json');
  const localFile = path.join(dir, 'local.json');
  const root = path.join(dir, 'Projects');
  const extra = path.join(dir, 'Extra');
  await fs.mkdir(root);
  await fs.mkdir(extra);
  const shared = await loadSettings(sharedFile);
  shared.data.standards.roots = [root, root + path.sep, path.join(dir, 'Disconnected')];
  await saveSettings(sharedFile, shared.data, shared.revision);
  const sharedBefore = await fs.readFile(sharedFile, 'utf8');
  await fs.writeFile(localFile, JSON.stringify({schemaVersion: 1, settingsPath: sharedFile, userId: null, keep: 'yes'}));
  const session = createSettingsSession({localFile});
  await session.loadLocal();
  await session.current();
  assert.deepEqual(session.roots(), [root, path.join(dir, 'Disconnected')]);
  assert.ok((await fs.readFile(localFile, 'utf8')).includes('importedFrom'));
  assert.equal(JSON.parse(await fs.readFile(localFile, 'utf8')).keep, 'yes');
  assert.equal(await fs.readFile(sharedFile, 'utf8'), sharedBefore);
  await session.addRoot(root + path.sep);
  assert.equal(session.roots().length, 2);
  await session.addRoot(extra);
  await session.setTheme('dark');
  const restarted = createSettingsSession({localFile});
  await restarted.loadLocal();
  await restarted.current();
  assert.deepEqual(restarted.roots(), [root, path.join(dir, 'Disconnected'), extra]);
  assert.equal(restarted.status().theme, 'dark');
  await restarted.removeRoot(root);
  assert.equal(restarted.roots().includes(root), false);
  await fs.rm(localFile);
  await restarted.loadLocal();
  await restarted.current();
  assert.deepEqual(restarted.roots(), []);
  assert.equal(restarted.status().theme, 'system');
});

test('versionless local profile imports roots once, preserves shared bytes, and reset stays fresh', async t => {
  const dir = await scratch(t);
  const sharedFile = path.join(dir, 'shared.json');
  const localFile = path.join(dir, 'local.json');
  const root = path.join(dir, 'Projects');
  await fs.mkdir(root);
  const shared = await loadSettings(sharedFile);
  shared.data.standards.roots = [root, root + path.sep];
  await saveSettings(sharedFile, shared.data, shared.revision);
  const before = await fs.readFile(sharedFile, 'utf8');
  await fs.writeFile(localFile, JSON.stringify({settingsPath: sharedFile, userId: null, extra: 'kept'}));
  const first = createSettingsSession({localFile});
  await first.loadLocal(); await first.current();
  assert.deepEqual(first.roots(), [root]);
  assert.equal(JSON.parse(await fs.readFile(localFile, 'utf8')).extra, 'kept');
  const second = createSettingsSession({localFile});
  await second.loadLocal(); await second.removeRoot(root);
  const third = createSettingsSession({localFile});
  await third.loadLocal(); await third.current();
  assert.deepEqual(third.roots(), []);
  assert.equal(await fs.readFile(sharedFile, 'utf8'), before);
  await fs.rm(localFile);
  await third.loadLocal(); await third.current();
  assert.deepEqual(third.roots(), []);
  assert.equal(third.status().theme, 'system');
});

test('local pins persist independently and shared suggestions preserve unrelated data with conflicts', async t => {
  const dir = await scratch(t);
  const sharedFile = path.join(dir, 'shared.json');
  const localFile = path.join(dir, 'local.json');
  const folder = path.join(dir, 'outside-root');
  const file = path.join(folder, 'note.md');
  await fs.mkdir(folder); await fs.writeFile(file, '# note');
  const session = createSettingsSession({localFile});
  await session.loadLocal();
  const original = await session.useNew(sharedFile);
  await session.addPin(folder);
  const reopened = createSettingsSession({localFile});
  await reopened.loadLocal();
  assert.deepEqual(reopened.pins(), [folder]);
  const proposed = structuredClone(original.data);
  proposed.suggestedLocations = [{id: 'one', label: 'Outside', type: 'folder', path: folder}, {id: 'two', label: 'Note', type: 'file', path: file}];
  const saved = await reopened.save(proposed, original.revision);
  assert.equal(saved.data.users.length, original.data.users.length);
  assert.deepEqual(saved.data.perUser, original.data.perUser);
  assert.deepEqual(saved.data.standards, original.data.standards);
  assert.deepEqual(saved.data.branding, original.data.branding);
  await assert.rejects(reopened.save(proposed, original.revision), /changed since/);
  const revised = structuredClone(saved.data);
  revised.suggestedLocations[0].label = 'Renamed';
  revised.suggestedLocations.splice(1, 1);
  const edited = await reopened.save(revised, saved.revision);
  assert.deepEqual(edited.data.suggestedLocations.map(item => item.label), ['Renamed']);
  assert.deepEqual(edited.data.standards, original.data.standards);
  const unavailable = structuredClone(edited.data);
  unavailable.suggestedLocations.push({id: 'offline', label: 'Offline share', type: 'folder', path: path.join(dir, 'disconnected-share', 'folder')});
  const withOffline = await reopened.save(unavailable, edited.revision);
  assert.equal(withOffline.data.suggestedLocations[1].label, 'Offline share');
  await reopened.removePin(folder);
  assert.deepEqual(reopened.pins(), []);
  assert.equal((await fs.readFile(file, 'utf8')), '# note');
  proposed.suggestedLocations[0].type = 'file';
  await assert.rejects(reopened.save(proposed, withOffline.revision), /type does not match/);
  proposed.suggestedLocations[0].path = 'relative\\folder';
  await assert.rejects(reopened.save(proposed, withOffline.revision), /full local or network path/);
});
