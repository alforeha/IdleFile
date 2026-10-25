'use strict';

// Main-process settings session: which shared settings file and user this PC has selected.
// The selection is remembered in the local settings file; the shared file is re-read on each request.

const {loadLocalSettings, saveLocalSettings} = require('../../platform/local-settings');
const fs = require('node:fs/promises');
const path = require('node:path');
const {loadSettings, openExistingSettings, createNewSettings, saveSettings, selectedUserAfterReload} = require('./shared-settings');

function createSettingsSession({localFile}) {
  let local = null;
  let localError = null;

  async function loadLocal() {
    try {
      local = await loadLocalSettings(localFile);
      localError = null;
    } catch (error) {
      local = null;
      localError = error.message;
    }
  }

  // Refuses to write while the local file is invalid, so a damaged file is never overwritten.
  async function updateLocal(changes) {
    if (!local) throw new Error(`Local settings are not loaded, so this choice was not saved. ${localError || ''}`.trim());
    local = await saveLocalSettings(localFile, {...local, ...changes});
  }

  // Null when no shared file is selected. Errors keep the remembered path.
  async function current() {
    const file = local?.settingsPath;
    if (!file) return null;
    const result = await loadSettings(file);
    if (local.schemaVersion === 1 && local.explorerRoots === undefined) {
      await updateLocal({schemaVersion: 2, explorerRoots: normalizeRoots(result.data.standards.roots), theme: local.theme || 'system', importedFrom: {path: file, revision: result.revision}});
    }
    if (local.userId && !selectedUserAfterReload(result.data.users, local.userId)) await updateLocal({userId: null});
    return {...result, path: file, selectedUserId: local.userId};
  }

  async function requireCurrent() {
    const settings = await current();
    if (!settings) throw new Error('Choose a settings file first.');
    return settings;
  }

  async function useExisting(file) {
    await openExistingSettings(file);
    await updateLocal({settingsPath: file, userId: null});
    return current();
  }

  async function useNew(file) {
    await createNewSettings(file);
    await updateLocal({settingsPath: file, userId: null});
    return current();
  }

  async function save(data, revision) {
    if (!local?.settingsPath) throw new Error('Choose settings first.');
    await saveSettings(local.settingsPath, data, revision);
    return current();
  }

  async function selectUser(userId) {
    const settings = await current();
    if (!settings?.data.users.some(u => u.id === userId)) throw new Error('User no longer exists.');
    await updateLocal({userId});
    return current();
  }

  function status() {
    return {localPath: localFile, localError, settingsPath: local?.settingsPath || null,
      explorerRoots: local?.explorerRoots || [], theme: local?.theme || 'system'};
  }

  function roots() { return local?.explorerRoots || []; }
  async function ensureRootMigration() {
    if (local?.schemaVersion === 1 && local?.explorerRoots === undefined && local.settingsPath) await current();
  }
  async function addRoot(folder) {
    await ensureRootMigration();
    const actual = path.resolve(folder);
    if (!(await fs.stat(actual)).isDirectory()) throw new Error('Choose a folder.');
    const key = process.platform === 'win32' ? actual.toLowerCase() : actual;
    if (roots().some(root => (process.platform === 'win32' ? path.resolve(root).toLowerCase() : path.resolve(root)) === key)) return roots();
    await updateLocal({schemaVersion: 2, explorerRoots: [...roots(), actual]});
    return roots();
  }
  async function removeRoot(folder) {
    await ensureRootMigration();
    const key = process.platform === 'win32' ? path.resolve(folder).toLowerCase() : path.resolve(folder);
    await updateLocal({schemaVersion: 2, explorerRoots: roots().filter(root => (process.platform === 'win32' ? path.resolve(root).toLowerCase() : path.resolve(root)) !== key)});
    return roots();
  }
  async function setTheme(theme) {
    if (!['system', 'light', 'dark'].includes(theme)) throw new Error('Invalid theme.');
    await updateLocal({theme});
    return theme;
  }

  return {loadLocal, current, requireCurrent, useExisting, useNew, save, selectUser, status, roots, addRoot, removeRoot, setTheme};
}

function normalizeRoots(roots) {
  const seen = new Set();
  return roots.map(root => path.resolve(root)).filter(root => {
    const key = process.platform === 'win32' ? root.toLowerCase() : root;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

module.exports = {createSettingsSession};
