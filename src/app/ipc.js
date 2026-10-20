'use strict';

// IPC channel table. Each channel matches one method exposed by preload.js; dialogs stay here so
// feature services can run without Electron in tests.

const {dialog, ipcMain} = require('electron');
const {listConfiguredFolder} = require('../features/explorer/explorer');

const JSON_FILTER = [{name: 'JSON', extensions: ['json']}];

function registerIpc({session, projects}) {
  // Re-reads local settings each time, so a deleted local file is recreated on refresh.
  ipcMain.handle('bootstrap', async () => {
    await session.loadLocal();
    let settings = null;
    let settingsError = null;
    try {
      settings = await session.current();
    } catch (error) {
      settingsError = error.message;
    }
    return {settings, settingsError, ...session.status(), jobs: await projects.jobs()};
  });

  ipcMain.handle('settings.open', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Open shared settings JSON', properties: ['openFile'], filters: JSON_FILTER, buttonLabel: 'Open settings'
    });
    if (result.canceled || !result.filePaths.length) return session.current();
    return session.useExisting(result.filePaths[0]);
  });

  ipcMain.handle('settings.new', async () => {
    const result = await dialog.showSaveDialog({
      title: 'Create shared settings JSON', defaultPath: 'folderapp.json', filters: JSON_FILTER, buttonLabel: 'Use this path'
    });
    if (result.canceled || !result.filePath) return session.current();
    return session.useNew(result.filePath);
  });

  ipcMain.handle('folder.choose', async () => {
    const result = await dialog.showOpenDialog({properties: ['openDirectory'], title: 'Choose folder on network drive'});
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('settings.reload', () => session.current());
  ipcMain.handle('settings.save', (_, {data, revision}) => session.save(data, revision));
  ipcMain.handle('user.select', (_, id) => session.selectUser(id));
  ipcMain.handle('projects.required', (_, structureId) => projects.required(structureId));
  ipcMain.handle('projects.preview', (_, request) => projects.preview(request));
  ipcMain.handle('projects.create', (_, request) => projects.create(request));
  ipcMain.handle('projects.resume', (_, id) => projects.resume(id));
  ipcMain.handle('projects.jobs', () => projects.jobs());
  ipcMain.handle('explorer.list', async (_, target, offset) => listConfiguredFolder(await session.requireCurrent(), target, offset));
}

module.exports = {registerIpc};
