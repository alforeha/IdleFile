'use strict';

const {app, BrowserWindow, dialog, ipcMain} = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const {loadSettings, saveSettings, writeAtomic, selectedUserAfterReload} = require('./core/settings');
const {requiredValues, buildProjectPlan} = require('./core/templates');
const {previewTarget, startCreation, resumeCreation, listJobs} = require('./core/creation');
const {listDirectoryPage, requireConfiguredRoot} = require('./core/explorer');

let selectedSettingsPath = null;
let selectedUserId = null;
const localFile = () => path.join(app.getPath('userData'), 'local.json');
const journalDir = () => path.join(app.getPath('userData'), 'recovery');

async function loadLocal() {
  try {
    const local = JSON.parse(await fs.readFile(localFile(), 'utf8'));
    selectedSettingsPath = local.settingsPath || null;
    selectedUserId = local.userId || null;
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
}
async function saveLocal() { await writeAtomic(localFile(), `${JSON.stringify({settingsPath: selectedSettingsPath, userId: selectedUserId}, null, 2)}\n`); }
async function currentSettings() {
  if (!selectedSettingsPath) return null;
  const result = await loadSettings(selectedSettingsPath);
  if (selectedUserId && !selectedUserAfterReload(result.data.users, selectedUserId)) {
    selectedUserId = null;
    await saveLocal();
  }
  return {...result, path: selectedSettingsPath, selectedUserId};
}
async function chooseExistingSettings() {
  const result = await dialog.showOpenDialog({title: 'Open shared settings JSON', properties: ['openFile'], filters: [{name: 'JSON', extensions: ['json']}], buttonLabel: 'Open settings'});
  if (result.canceled || !result.filePaths.length) return currentSettings();
  const file = result.filePaths[0];
  const loaded = await loadSettings(file);
  if (!loaded.revision) throw new Error('Selected settings file does not exist.');
  selectedSettingsPath = file;
  selectedUserId = null;
  await saveLocal();
  return currentSettings();
}
async function chooseNewSettings() {
  const result = await dialog.showSaveDialog({title: 'Create shared settings JSON', defaultPath: 'folderapp.json', filters: [{name: 'JSON', extensions: ['json']}], buttonLabel: 'Use this path'});
  if (result.canceled || !result.filePath) return currentSettings();
  try { await fs.lstat(result.filePath); throw new Error('A file already exists at this path. Open it as existing settings or choose another path.'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  selectedSettingsPath = result.filePath;
  selectedUserId = null;
  await saveLocal();
  return currentSettings();
}
async function chooseFolder() {
  const result = await dialog.showOpenDialog({properties: ['openDirectory'], title: 'Choose folder on network drive'});
  return result.canceled ? null : result.filePaths[0];
}
function makePlan(settings, structureId, values) {
  const structure = settings.data.standards.structures.find(s => s.id === structureId);
  if (!structure) throw new Error('Structure no longer exists. Reload settings.');
  return buildProjectPlan(structure, settings.data.standards.docTemplates, values);
}
async function preview({parent, structureId, values}) {
  const settings = await currentSettings();
  if (!settings) throw new Error('Choose a settings file first.');
  if (!selectedUserId) throw new Error('Select your user first.');
  const plan = makePlan(settings, structureId, values);
  await requireConfiguredRoot(parent, settings.data.standards.roots);
  const root = await previewTarget(parent, plan);
  const fingerprint = crypto.createHash('sha256').update(JSON.stringify({parent, plan, revision: settings.revision})).digest('hex');
  return {plan, root, fingerprint};
}
async function createProject(request) {
  const ready = await preview(request);
  if (ready.fingerprint !== request.fingerprint) throw new Error('Preview changed. Preview again before creating.');
  const job = await startCreation(request.parent, ready.plan, journalDir());
  return job;
}
async function listFolder(target, offset = 0) {
  const settings = await currentSettings();
  if (!settings) throw new Error('Choose settings first.');
  const actual = await requireConfiguredRoot(target, settings.data.standards.roots);
  return listDirectoryPage(actual, offset);
}
function registerIpc() {
  ipcMain.handle('bootstrap', async () => {
    let settings = null, settingsError = null;
    try { settings = await currentSettings(); } catch (error) { settingsError = error.message; }
    return {settings, settingsError, jobs: await listJobs(journalDir())};
  });
  ipcMain.handle('settings.open', chooseExistingSettings);
  ipcMain.handle('settings.new', chooseNewSettings);
  ipcMain.handle('folder.choose', chooseFolder);
  ipcMain.handle('settings.reload', currentSettings);
  ipcMain.handle('settings.save', async (_, {data, revision}) => {
    if (!selectedSettingsPath) throw new Error('Choose settings first.');
    await saveSettings(selectedSettingsPath, data, revision);
    return currentSettings();
  });
  ipcMain.handle('user.select', async (_, id) => {
    const settings = await currentSettings();
    if (!settings?.data.users.some(u => u.id === id)) throw new Error('User no longer exists.');
    selectedUserId = id;
    await saveLocal();
    return currentSettings();
  });
  ipcMain.handle('projects.required', async (_, structureId) => {
    const settings = await currentSettings();
    const structure = settings?.data.standards.structures.find(s => s.id === structureId);
    if (!structure) throw new Error('Choose a structure.');
    return requiredValues(structure, settings.data.standards.docTemplates);
  });
  ipcMain.handle('projects.preview', (_, request) => preview(request));
  ipcMain.handle('projects.create', (_, request) => createProject(request));
  ipcMain.handle('projects.resume', async (_, id) => resumeCreation(id, journalDir()));
  ipcMain.handle('projects.jobs', () => listJobs(journalDir()));
  ipcMain.handle('explorer.list', (_, target, offset) => listFolder(target, offset));
}
app.whenReady().then(async () => {
  await loadLocal();
  registerIpc();
  const window = new BrowserWindow({width: 1280, height: 840, minWidth: 900, minHeight: 600, webPreferences: {preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true}});
  await window.loadFile(path.join(__dirname, 'renderer', 'index.html'));
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
