'use strict';
const {contextBridge, ipcRenderer} = require('electron');
const call = (channel, ...args) => ipcRenderer.invoke(channel, ...args);
contextBridge.exposeInMainWorld('folderApp', Object.freeze({
  bootstrap: () => call('bootstrap'),
  openSettings: () => call('settings.open'),
  newSettings: () => call('settings.new'),
  chooseFolder: () => call('folder.choose'),
  reloadSettings: () => call('settings.reload'),
  saveSettings: payload => call('settings.save', payload),
  selectUser: id => call('user.select', id),
  requiredValues: id => call('projects.required', id),
  previewProject: request => call('projects.preview', request),
  createProject: request => call('projects.create', request),
  resumeProject: id => call('projects.resume', id),
  listJobs: () => call('projects.jobs'),
  listFolder: (target, offset = 0, sort = 'name', direction = 'asc') => call('explorer.list', target, offset, sort, direction),
  inspectFile: target => call('explorer.file', target),
  addRoot: () => call('roots.add'),
  removeRoot: target => call('roots.remove', target),
  rootStatus: () => call('roots.status'),
  setTheme: theme => call('theme.set', theme),
  windowControl: action => call('window.control', action)
}));
