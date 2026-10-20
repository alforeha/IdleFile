'use strict';

const {app, BrowserWindow} = require('electron');
const path = require('node:path');
const {createSettingsSession} = require('../features/settings/session');
const {createProjectService} = require('../features/project-creation/service');
const {registerIpc} = require('./ipc');

// Running from source (npm run dev) uses its own profile, so it never touches the installed app's
// local settings or recovery records. The installed app keeps Electron's default userData folder.
const DEV_PROFILE = 'folder-app-dev';
if (!app.isPackaged) app.setPath('userData', path.join(app.getPath('appData'), DEV_PROFILE));

app.whenReady().then(async () => {
  const userData = app.getPath('userData');
  const session = createSettingsSession({localFile: path.join(userData, 'local.json')});
  await session.loadLocal();
  const projects = createProjectService({session, journalDir: path.join(userData, 'recovery')});
  registerIpc({session, projects});
  const window = new BrowserWindow({
    width: 1280, height: 840, minWidth: 900, minHeight: 600,
    webPreferences: {preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true}
  });
  await window.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
