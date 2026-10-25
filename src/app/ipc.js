'use strict';

// IPC channel table. Each channel matches one method exposed by preload.js; dialogs stay here so
// feature services can run without Electron in tests.

const {dialog, ipcMain, BrowserWindow} = require('electron');
const fs = require('node:fs/promises');
const {listConfiguredFolder, inspectConfiguredFile} = require('../features/explorer/explorer');

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
  ipcMain.handle('roots.add', async () => {
    const result = await dialog.showOpenDialog({title: 'Add local Explorer root', properties: ['openDirectory']});
    return result.canceled ? session.roots() : session.addRoot(result.filePaths[0]);
  });
  ipcMain.handle('roots.remove', (_, folder) => session.removeRoot(folder));
  ipcMain.handle('roots.status', async () => Promise.all(session.roots().map(async root => {
    try { return {path: root, available: (await fs.stat(root)).isDirectory()}; }
    catch (error) { return {path: root, available: false, error: error.message}; }
  })));
  ipcMain.handle('theme.set', (_, theme) => session.setTheme(theme));
  ipcMain.handle('window.control', (event, action) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return;
    if (action === 'minimize') window.minimize();
    else if (action === 'maximize') window.isMaximized() ? window.unmaximize() : window.maximize();
    else if (action === 'close') window.close();
  });
  ipcMain.handle('settings.save', (_, {data, revision}) => session.save(data, revision));
  ipcMain.handle('user.select', (_, id) => session.selectUser(id));
  ipcMain.handle('projects.required', (_, structureId) => projects.required(structureId));
  ipcMain.handle('projects.preview', (_, request) => projects.preview(request));
  ipcMain.handle('projects.create', (_, request) => projects.create(request));
  ipcMain.handle('projects.resume', (_, id) => projects.resume(id));
  ipcMain.handle('projects.jobs', () => projects.jobs());
  ipcMain.handle('explorer.list', (_, target, offset, sort, direction) => listConfiguredFolder(session.roots(), target, offset, sort, direction));
  ipcMain.handle('explorer.file', (_, target) => inspectConfiguredFile(session.roots(), target));
}

module.exports = {registerIpc};
