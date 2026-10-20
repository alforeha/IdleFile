'use strict';

// Main-process settings session: which shared settings file and user this PC has selected.
// The selection is remembered in the local settings file; the shared file is re-read on each request.

const {loadLocalSettings, saveLocalSettings} = require('../../platform/local-settings');
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
    return {localPath: localFile, localError, settingsPath: local?.settingsPath || null};
  }

  return {loadLocal, current, requireCurrent, useExisting, useNew, save, selectUser, status};
}

module.exports = {createSettingsSession};
